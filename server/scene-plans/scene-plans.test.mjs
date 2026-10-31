import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createScenePlanMiddleware,
  createScenePlanService,
  validateCandidate,
} from './index.js';
import { createChatTransport, parseProviderJson } from './transport.js';
import {
  createEventResearch,
  verifyCitation,
  isPublicAddress,
} from './research.js';
import {
  createNarration,
  buildSpeechSchedule,
  measureAudioDuration,
  narrationConfig,
  ELEVENLABS_PLUGIN_ID,
} from './narration.js';

// Synthetic transport/audio fixtures only: none of these tests claim live-provider success.
const candidate = () => ({
  name: 'Dubai fixture venue',
  lat: 25.2,
  lon: 55.3,
  verified: true,
  source: 'Fixture geocoder',
  sourceUrl: 'https://www.openstreetmap.org/node/123',
});
function planFromContext(query) {
  const { location, verification, citations } = JSON.parse(
    query.split('\nINPUT ')[1],
  );
  return {
    version: 1,
    title: 'Fixture generated scene',
    illustrative: true,
    durationSec: 12,
    location,
    camera: { distanceM: 400, heading: 50, pitch: -30, framing: 'wide' },
    entities: [
      {
        id: 'walkers',
        type: 'person',
        label: 'Illustrative walkers',
        quantity: 3,
        position: { eastM: 0, northM: 20 },
        heading: 90,
      },
    ],
    relationships: [],
    beats: [
      {
        atSec: 0,
        title: 'Gathering',
        narration: 'Three walkers gather at the illustrated venue.',
        entityIds: ['walkers'],
      },
      {
        atSec: 6,
        title: 'Departure',
        narration: 'The walkers depart together.',
        entityIds: ['walkers'],
      },
    ],
    citations,
    verification,
  };
}
function fixturePlan() {
  return planFromContext(
    'x\nINPUT ' +
      JSON.stringify({
        location: {
          name: 'Fixture location',
          lat: 25.2,
          lon: 55.3,
          sourceUrl: candidate().sourceUrl,
        },
        verification: {
          status: 'location_verified',
          locationSource: 'Fixture',
          checkedAt: '2026-01-01T00:00:00Z',
          limitations: ['Illustrative staging only.'],
        },
        citations: [],
      }),
  );
}
const generic = async () => ({
  kind: 'generic',
  status: 'generic',
  citations: [],
});
function transportFixture(queryImpl) {
  const calls = [];
  let sessions = 0;
  return {
    calls,
    configured: () => true,
    createSession: async (pluginIds) => ({
      id: `session-${++sessions}`,
      externalUserId: `fixture-${sessions}`,
      pluginIds,
    }),
    query: async (s, q, o) => {
      calls.push({ s, q, o });
      return {
        answer:
          typeof queryImpl === 'function'
            ? await queryImpl(q, calls.length)
            : JSON.stringify(planFromContext(q)),
        sessionId: s.id,
        messageId: 'fixture-message',
      };
    },
    media: async () => [],
  };
}
const constructBody = () => ({
  prompt: 'Place three walkers together at the verified location',
  candidate: candidate(),
  revision: 2,
});
function wav(seconds = 1) {
  const samples = 8000 * seconds;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24);
  buffer.writeUInt32LE(16000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
}
async function route(
  middleware,
  { url = '/construct', method = 'POST', body, headers = {} } = {},
) {
  let payload;
  const response = {
    setHeader() {},
    end(s) {
      payload = JSON.parse(s);
    },
  };
  await middleware({ url, method, body, headers }, response);
  return { status: response.statusCode, payload };
}

test('validated LLM plan preserves candidate coordinates, revision, actual scene entities', async () => {
  const t = transportFixture();
  const result = await createScenePlanService({
    transport: t,
    research: generic,
  }).construct(constructBody());
  assert.equal(result.plan.entities[0].quantity, 3);
  assert.equal(result.plan.location.lat, 25.2);
  assert.equal(result.revision, 2);
  assert.equal(result.provenance.attempts, 1);
  assert.equal(t.calls[0].o.fulfillmentOnly, true);
});
test('one corrective retry, no template fallback', async () => {
  const t = transportFixture(() => '{bad json');
  await assert.rejects(
    () =>
      createScenePlanService({ transport: t, research: generic }).construct(
        constructBody(),
      ),
    { code: 'scene_plan_validation_failed' },
  );
  assert.equal(t.calls.length, 2);
  assert.match(t.calls[1].q, /Correct only/);
});
test('one correction can replace an invalid plan with actual model JSON', async () => {
  let good;
  const t = transportFixture((q, n) => {
    if (n === 1) {
      good = planFromContext(q);
      return JSON.stringify({ ...good, durationSec: 999 });
    }
    return JSON.stringify(good);
  });
  const result = await createScenePlanService({
    transport: t,
    research: generic,
  }).construct(constructBody());
  assert.equal(result.provenance.attempts, 2);
});
test('model cannot substitute invented coordinates', async () => {
  let p;
  const t = transportFixture((q, n) => {
    if (n === 1) p = planFromContext(q);
    return JSON.stringify({ ...p, location: { ...p.location, lat: 0 } });
  });
  await assert.rejects(
    () =>
      createScenePlanService({ transport: t, research: generic }).construct(
        constructBody(),
      ),
    { code: 'scene_plan_validation_failed' },
  );
});
test('key order does not change semantic validity', async () => {
  const t = transportFixture((q) => {
    const p = planFromContext(q);
    p.location = Object.fromEntries(Object.entries(p.location).reverse());
    p.verification = Object.fromEntries(
      Object.entries(p.verification).reverse(),
    );
    return JSON.stringify(p);
  });
  assert.equal(
    (
      await createScenePlanService({
        transport: t,
        research: generic,
      }).construct(constructBody())
    ).ok,
    true,
  );
});
test('candidate rejects unverified, coerced, unbounded and secret data', () => {
  for (const edit of [
    (c) => (c.verified = false),
    (c) => (c.lat = '25'),
    (c) => (c.lon = 181),
    (c) => (c.source = ''),
    (c) => (c.sourceUrl = 'http://127.0.0.1'),
    (c) => (c.apiKey = 'never-accepted'),
  ]) {
    const c = candidate();
    edit(c);
    assert.throws(() => validateCandidate(c), { code: 'invalid_request' });
  }
});
test('construct rejects client-supplied credentials in body before providers', async () => {
  const t = transportFixture();
  await assert.rejects(
    () =>
      createScenePlanService({ transport: t, research: generic }).construct({
        ...constructBody(),
        apiKey: 'not-a-secret-fixture',
      }),
    { code: 'invalid_request' },
  );
  assert.equal(t.calls.length, 0);
});
test('documented transport uses pluginIds and server client, never request secrets', async () => {
  const seen = [];
  const t = createChatTransport({
    getSettings: () => ({
      apiKey: 'fixture-not-real',
      baseUrl: 'https://fixture.example',
      fulfillmentEndpointId: 'fixture-endpoint',
    }),
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      return {
        ok: true,
        json: async () =>
          url.endsWith('/query')
            ? {
                data: {
                  answer: '{}',
                  status: 'completed',
                  sessionId: 's1',
                  messageId: 'm1',
                },
              }
            : { data: { id: 's1' } },
      };
    },
  });
  const s = await t.createSession(['plugin-fixture']);
  await t.query(s, 'fixture');
  assert.deepEqual(seen[0].init.body.pluginIds, ['plugin-fixture']);
  assert.equal(seen[1].init.body.responseMode, 'sync');
  assert.equal('agentIds' in seen[1].init.body, false);
  assert.equal('apiKeyOverride' in seen[0].init, false);
});
test('provider errors never echo upstream body or thrown secrets', async () => {
  const t = createChatTransport({
    getSettings: () => ({
      apiKey: 'fixture',
      baseUrl: 'https://fixture.example',
    }),
    fetchImpl: async () => {
      throw new Error('SUPER-SECRET-FIXTURE');
    },
  });
  await assert.rejects(
    () => t.createSession([]),
    (e) =>
      e.code === 'provider_unavailable' && !e.message.includes('SUPER-SECRET'),
  );
});
test('missing server key is actionable and does not call network', async () => {
  const t = createChatTransport({
    getSettings: () => ({ apiKey: '' }),
    fetchImpl: () => {
      throw new Error('must not run');
    },
  });
  await assert.rejects(() => t.createSession([]), {
    code: 'server_key_unavailable',
  });
});
test('strict provider JSON allows only a whole JSON object or whole fenced JSON', () => {
  assert.deepEqual(parseProviderJson('```json\n{"x":1}\n```'), { x: 1 });
  for (const s of ['text {"x":1}', '[]', 'null'])
    assert.throws(() => parseProviderJson(s));
});
test('ambiguous named marathon never constructs an invented edition', async () => {
  const t = transportFixture(() =>
    JSON.stringify({
      kind: 'event',
      status: 'needs_clarification',
      citations: [],
    }),
  );
  const research = createEventResearch({ transport: t });
  await assert.rejects(
    () => research({ ...constructBody(), prompt: 'Dubai Marathon' }),
    { status: 422, code: 'needs_clarification' },
  );
});
test('named event cannot be mislabeled generic to bypass research', async () => {
  const t = transportFixture(() =>
    JSON.stringify({ kind: 'generic', status: 'generic', citations: [] }),
  );
  await assert.rejects(
    () =>
      createEventResearch({ transport: t })({
        ...constructBody(),
        prompt: 'Dubai Marathon',
      }),
    { code: 'needs_clarification' },
  );
});
test('research deduplicates event lookups within a revision and skips clearly generic staging', async () => {
  const t = transportFixture(() =>
    JSON.stringify({
      kind: 'event',
      status: 'verified',
      eventName: 'Dubai Marathon',
      edition: '2026',
      locationName: 'Dubai',
      citations: [
        {
          url: 'https://example.org/event',
          excerpt:
            'Dubai Marathon 2026 takes place in Dubai for this synthetic fixture.',
        },
      ],
    }),
  );
  const research = createEventResearch({
    transport: t,
    verifySource: async (c) => ({ ...c, verified: true }),
  });
  await research(constructBody());
  assert.equal(t.calls.length, 0);
  const input = {
    ...constructBody(),
    candidate: { ...candidate(), name: 'Dubai' },
    prompt: 'Dubai Marathon 2026',
  };
  await Promise.all([research(input), research(input)]);
  assert.equal(t.calls.length, 1);
  await research({ ...input, revision: 3 });
  assert.equal(t.calls.length, 2);
});
test('event research needs retrieved citation evidence and matching venue', async () => {
  const t = transportFixture(() =>
    JSON.stringify({
      kind: 'event',
      status: 'verified',
      eventName: 'Dubai Marathon',
      edition: '2026',
      locationName: 'Dubai',
      citations: [
        {
          url: 'https://example.org/event',
          excerpt: 'Dubai Marathon 2026 starts in Dubai at the race venue.',
        },
      ],
    }),
  );
  const research = createEventResearch({
    transport: t,
    verifySource: async (c) => ({
      ...c,
      verified: true,
      verificationMethod: 'fixture-only',
    }),
  });
  const result = await research({
    ...constructBody(),
    candidate: { ...candidate(), name: 'Dubai' },
    prompt: 'Dubai Marathon 2026',
  });
  assert.equal(result.edition, '2026');
  assert.equal(result.citations[0].verified, true);
  await assert.rejects(
    () =>
      research({
        ...constructBody(),
        prompt: 'Dubai Marathon 2026',
        candidate: { ...candidate(), name: 'Paris' },
      }),
    { code: 'needs_clarification' },
  );
});
test('citation verification checks real fetched text rather than a model URL', async () => {
  const c = {
    url: 'https://example.org/event',
    excerpt: 'Dubai Marathon 2026 begins at the Dubai venue near the park.',
  };
  const context = {
    edition: '2026',
    eventName: 'Dubai Marathon',
    locationName: 'Dubai',
  };
  const fetchSource = async () => ({
    bytes: Buffer.from('<p>' + c.excerpt + '</p>'),
    contentType: 'text/html',
  });
  assert.equal((await verifyCitation(c, context, fetchSource)).verified, true);
  assert.equal(
    await verifyCitation(
      {
        ...c,
        excerpt:
          'Dubai Marathon 2026 begins at an invented Dubai site instead.',
      },
      context,
      fetchSource,
    ),
    null,
  );
});
test('private IP ranges are forbidden during source downloads', () => {
  for (const ip of [
    '127.0.0.1',
    '10.1.1.1',
    '169.254.169.254',
    '172.16.0.2',
    '192.168.1.2',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
  ])
    assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress('8.8.8.8'), true);
});
test('beat transcript includes scene-specific narration and bounded schedule', () => {
  const schedule = buildSpeechSchedule(fixturePlan());
  assert.match(schedule[0].text, /illustrative reconstruction/);
  assert.match(schedule[0].text, /Three walkers/);
  assert.equal(schedule[1].atSec, 6);
  assert.equal(schedule[1].endSec, 12);
});
test('duration is measured from WAV bytes and malformed audio is unknown', () => {
  assert.equal(measureAudioDuration(wav(2)), 2);
  assert.equal(measureAudioDuration(Buffer.from('not audio')), null);
});
test('MPEG duration uses complete frame count, not guessed text timing', () => {
  const f = Buffer.alloc(417);
  f.set([0xff, 0xfb, 0x90, 0x00]);
  const b = Buffer.concat([f, f, f, f]);
  assert.ok(Math.abs(measureAudioDuration(b) - (4 * 1152) / 44100) < 0.000001);
  assert.equal(measureAudioDuration(b.subarray(0, b.length - 1)), null);
});
test('voice config exposes George multilingual default and validates settings', () => {
  assert.equal(narrationConfig().voiceId, 'JBFqnCBsd6RMkjVDRZzb');
  assert.equal(narrationConfig().modelId, 'eleven_multilingual_v2');
  assert.equal(narrationConfig({ speed: 0.8 }).speed, 0.8);
  for (const input of [
    { apiKey: 'no' },
    { speed: 2 },
    { style: NaN },
    { voiceId: '!' },
  ])
    assert.throws(() => narrationConfig(input), {
      code: 'invalid_narration_config',
    });
});
test('prose-only or old-session audio never becomes narration success', async () => {
  const t = transportFixture(
    () => '{"audioUrl":"https://example.org/old.mp3"}',
  );
  t.media = async () => [
    {
      sessionId: 'old',
      source: 'audio',
      plugins: [ELEVENLABS_PLUGIN_ID],
      url: 'https://example.org/old.mp3',
    },
  ];
  await assert.rejects(
    () =>
      createNarration({
        transport: t,
        fetchAudio: async () => ({ bytes: wav() }),
      })({ plan: fixturePlan() }),
    { code: 'narration_audio_unavailable' },
  );
});
test('fresh session-matched bytes succeed and honestly report duration mismatch', async () => {
  const t = transportFixture(() => '{"generated":true}');
  t.media = async (s) => [
    {
      id: 'media-fixture',
      sessionId: s.id,
      source: 'audio',
      plugins: [ELEVENLABS_PLUGIN_ID],
      url: 'https://example.org/fresh.wav',
    },
  ];
  const result = await createNarration({
    transport: t,
    fetchAudio: async () => ({ bytes: wav(2) }),
  })({ plan: fixturePlan(), revision: 12 });
  assert.equal(result.durationSec, 2);
  assert.equal(result.revision, 12);
  assert.equal(result.synchronization.exactAlignment, false);
  assert.equal(result.synchronization.requiresTimingReview, true);
  assert.equal(result.verification.audioBytesVerified, true);
});
test('HTML behind an audio URL is rejected', async () => {
  const t = transportFixture(() => 'generated');
  t.media = async (s) => [
    {
      sessionId: s.id,
      source: 'audio',
      plugins: [ELEVENLABS_PLUGIN_ID],
      url: 'https://example.org/not-audio',
    },
  ];
  await assert.rejects(
    () =>
      createNarration({
        transport: t,
        fetchAudio: async () => ({
          bytes: Buffer.from('<html>This is an error, not audio</html>'),
        }),
      })({ plan: fixturePlan() }),
    { code: 'narration_audio_unavailable' },
  );
});
test('middleware supports mounted and full paths, errors are structured', async () => {
  const middleware = createScenePlanMiddleware({
    transport: transportFixture(),
    research: generic,
  });
  assert.equal(
    (
      await route(middleware, {
        url: '/api/ondemand/v2/scene-plans/health',
        method: 'GET',
      })
    ).status,
    200,
  );
  assert.equal(
    (await route(middleware, { url: '/construct', body: constructBody() }))
      .status,
    200,
  );
  assert.equal(
    (
      await route(middleware, {
        body: {},
        headers: { 'x-ondemand-key': 'not-real' },
      })
    ).status,
    400,
  );
  assert.equal(
    (await route(middleware, { url: '/missing', method: 'GET' })).status,
    404,
  );
  assert.equal(
    (await route(middleware, { url: '/construct', method: 'GET' })).status,
    405,
  );
  const result = await route(middleware, { body: {} });
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.error.code, 'invalid_request');
});
test('middleware rejects oversized bodies and safely handles unknown failures', async () => {
  let result = await route(
    createScenePlanMiddleware({
      transport: transportFixture(),
      research: generic,
    }),
    { body: { prompt: 'x'.repeat(270000) } },
  );
  assert.equal(result.status, 413);
  result = await route(
    createScenePlanMiddleware({
      service: {
        construct: async () => {
          throw new Error('DO-NOT-EXPOSE');
        },
      },
    }),
    { body: {} },
  );
  assert.equal(result.status, 500);
  assert.equal(JSON.stringify(result.payload).includes('DO-NOT-EXPOSE'), false);
});

test('actual provider billing rejection becomes an actionable safe 503', async () => {
  const t = transportFixture(
    () =>
      'No speech was generated. {"code":"payment_issue","request_id":"NEVER-ECHO-FIXTURE"}',
  );
  await assert.rejects(
    () => createNarration({ transport: t })({ plan: fixturePlan() }),
    (e) =>
      e.status === 503 &&
      e.code === 'narration_provider_payment_required' &&
      !e.message.includes('NEVER-ECHO'),
  );
});

test('same-city citation about a different venue does not verify the requested venue', async () => {
  const c = {
    url: 'https://example.org/fixture',
    excerpt: 'Dubai Marathon 2026 is near the Dubai Museum at Al Fahidi.',
  };
  const fetchSource = async () => ({
    bytes: Buffer.from('<p>' + c.excerpt + '</p>'),
    contentType: 'text/html',
  });
  assert.equal(
    await verifyCitation(
      c,
      {
        edition: '2026',
        eventName: 'Dubai Marathon',
        locationName: 'Umm Suqeim Road',
      },
      fetchSource,
    ),
    null,
  );
});
test('a model cannot replace the requested marathon with an unrelated Dubai event', async () => {
  const t = transportFixture(() =>
    JSON.stringify({
      kind: 'event',
      status: 'verified',
      eventName: 'Dubai Food Festival',
      edition: '2026',
      locationName: 'Dubai',
      citations: [
        {
          url: 'https://example.org/event',
          excerpt: 'Dubai Food Festival 2026 is a test citation in Dubai.',
        },
      ],
    }),
  );
  const research = createEventResearch({
    transport: t,
    verifySource: async (c) => ({ ...c, verified: true }),
  });
  await assert.rejects(
    () =>
      research({
        ...constructBody(),
        candidate: { ...candidate(), name: 'Dubai' },
        prompt: 'Dubai Marathon 2026',
      }),
    { code: 'needs_clarification' },
  );
});
test('request AbortSignal reaches session and query HTTP requests', async () => {
  const signals = [];
  const abort = new AbortController();
  const t = createChatTransport({
    getSettings: () => ({
      apiKey: 'fixture',
      baseUrl: 'https://fixture.example',
      fulfillmentEndpointId: 'fixture',
    }),
    fetchImpl: async (url, init) => {
      signals.push(init.signal);
      return {
        ok: true,
        json: async () =>
          url.endsWith('/query')
            ? { data: { answer: '{}', status: 'completed' } }
            : { data: { id: 'fixture-session' } },
      };
    },
  });
  const session = await t.createSession([], { signal: abort.signal });
  await t.query(session, 'fixture', { signal: abort.signal });
  assert.equal(signals.length, 2);
  abort.abort();
  for (const signal of signals) assert.equal(signal.aborted, true);
});

test('a NOT a real incident disclaimer in an illustrative police scene is not an event claim', async () => {
  const research = createEventResearch({
    transport: {
      createSession: () =>
        assert.fail('generic training scene must not need event research'),
    },
  });
  const result = await research({
    ...constructBody(),
    prompt:
      'Location: Dubai Marina\nAn illustrative police training scene, NOT a real incident. Exactly 3 police officers stand beside 2 parked police vehicles.',
  });
  assert.equal(result.kind, 'generic');
  assert.equal(result.provider, 'not-required');
});
test('negated-incident disclaimers cannot bypass a named dated marathon verification', async () => {
  const t = transportFixture(() =>
    JSON.stringify({ kind: 'generic', status: 'generic', citations: [] }),
  );
  await assert.rejects(
    () =>
      createEventResearch({ transport: t })({
        ...constructBody(),
        prompt:
          'Fictional actors, NOT a real incident. Show Dubai Marathon 2024 at the real event venue.',
      }),
    { code: 'needs_clarification' },
  );
});
