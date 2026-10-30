#!/usr/bin/env node
/**
 * Live validation of server/ondemand/foundation/* against the real OnDemand
 * API. Requires ONDEMAND_API_KEY (or ON_DEMAND_API_KEY) in the environment.
 * Prints a REDACTED JSON evidence array (no key, no long tokens) suitable for
 * pasting into docs/agent-execution/TEST_RESULTS.md.
 *
 *   npm run ondemand:foundation:live
 */
import {
  createOnDemandClient,
  OnDemandHttpError,
  redact,
} from '../server/ondemand/foundation/client.js';
import { createConversationStore } from '../server/ondemand/foundation/conversation-store.js';
import { createFoundationHandler } from '../server/ondemand/foundation/proxy-route.js';
import { createToolInvoker } from '../server/ondemand/foundation/tool-contracts.js';
import { contractRegistry } from '../server/ondemand/foundation/contracts.js';
import { __reloadConfigForTests } from '../server/ondemand/config.js';
import { makeReq, makeRes } from '../server/ondemand/test-helpers.mjs';

if (!process.env.ONDEMAND_API_KEY && process.env.ON_DEMAND_API_KEY) {
  process.env.ONDEMAND_API_KEY = process.env.ON_DEMAND_API_KEY;
}
__reloadConfigForTests();
const key = process.env.ONDEMAND_API_KEY || '';
const ts = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const rows = [];
const ok = (test, result, evidence) => {
  rows.push({
    test,
    result,
    evidence: redact(
      typeof evidence === 'string' ? evidence : JSON.stringify(evidence),
      key,
    ).slice(0, 500),
    timestamp: ts(),
  });
  console.error(`[${rows.at(-1).timestamp}] ${result.padEnd(5)} ${test}`);
};
const ENDPOINT =
  process.env.ONDEMAND_FULFILLMENT_ENDPOINT_ID || 'predefined-gpt-6-luna';
const USER = 'gev-foundation-live';
const client = createOnDemandClient({ log: () => {} });
const store = createConversationStore({ backend: 'memory' });
const handler = createFoundationHandler({
  client,
  store,
  audit: () => {}, // audit lines go to stdout in production; keep this script's JSON clean
  toolInvoker: createToolInvoker(), // B-13: repo tools run in-process inside /investigate
});

async function call(method, url, body, headers = {}) {
  const res = makeRes();
  await handler(
    makeReq({ method, url, headers: { host: 'localhost', ...headers }, body }),
    res,
  );
  return res;
}

try {
  if (!key) throw new Error('ONDEMAND_API_KEY not set');
  // 1 client: session create + list + get
  const t0 = Date.now();
  const s = await client.sessions.create({
    externalUserId: USER,
    pluginIds: ['plugin-1713924030'],
  });
  ok(
    'client.sessions.create (externalUserId + 1 pluginId)',
    /^[0-9a-f]{24}$/.test(s.id) ? 'PASS' : 'FAIL',
    { ms: Date.now() - t0, pluginIds: s.pluginIds },
  );
  const l = await client.sessions.list({ externalUserId: USER, limit: 2 });
  ok(
    'client.sessions.list pagination',
    Array.isArray(l.data) ? 'PASS' : 'FAIL',
    { count: l.data.length, pagination: l.pagination },
  );
  const g = await client.sessions.get(s.id);
  ok('client.sessions.get', g?.externalUserId === USER ? 'PASS' : 'FAIL', {
    keys: Object.keys(g || {}),
  });
  // 2 client: sync query
  const t1 = Date.now();
  const q = await client.query.sync(s.id, {
    // 2026-10-21: the phrasing 'Reply with exactly: FOUNDATION-LIVE-OK' started
    // returning 403 content_policy_violation upstream (platform drift, BLOCKERS
    // B-14); the same token with 'Respond with only this text:' passes.
    query: 'Respond with only this text: FOUNDATION-LIVE-OK',
    endpointId: ENDPOINT,
    fulfillmentOnly: true,
    reasoningEffort: 'low',
  });
  ok(
    `client.query.sync fulfillmentOnly (${ENDPOINT})`,
    q?.data?.answer?.includes('FOUNDATION-LIVE-OK') ? 'PASS' : 'FAIL',
    { ms: Date.now() - t1, answer: q?.data?.answer, status: q?.data?.status },
  );
  // 3 client: stream with abort propagation
  const t2 = Date.now();
  const st = await client.query.stream(s.id, {
    query: 'In one sentence, what is a spatial intelligence workstation?',
    endpointId: ENDPOINT,
    fulfillmentOnly: true,
    reasoningEffort: 'low',
  });
  const types = [];
  let text = '';
  let first = 0;
  for await (const e of st.events) {
    if (!first) first = Date.now() - t2;
    types.push(e.event);
    if (e.answer) text += e.answer;
    if (e.event === 'done') break;
  }
  ok(
    'client.query.stream SSE parse (deltas, metricsLog, heartbeat, [DONE])',
    types.includes('done') && text.length > 10 ? 'PASS' : 'FAIL',
    {
      ttfbMs: first,
      totalMs: Date.now() - t2,
      events: types.length,
      distinct: [...new Set(types)],
      text: text.slice(0, 80),
    },
  );
  const ctrl = new AbortController();
  const st2 = await client.query.stream(
    s.id,
    {
      query: 'Count slowly from one to fifty in words.',
      endpointId: ENDPOINT,
      fulfillmentOnly: true,
    },
    { signal: ctrl.signal },
  );
  let n = 0;
  let aborted = false;
  try {
    for await (const e of st2.events) {
      n += 1;
      if (n === 3) ctrl.abort();
    }
  } catch (e) {
    aborted = e?.name === 'OnDemandAbortError';
  }
  ok(
    'client.query.stream abort propagation (caller abort stops upstream read)',
    aborted || n <= 5 ? 'PASS' : 'FAIL',
    { eventsBeforeAbort: n, abortedError: aborted },
  );
  // 4 client: plugin query (RAG)
  const t3 = Date.now();
  const pq = await client.query.sync(s.id, {
    query:
      'Give one current news headline about Abu Dhabi with its source URL.',
    endpointId: ENDPOINT,
    pluginIds: ['plugin-1713924030'],
    reasoningEffort: 'low',
  });
  ok(
    'client.query.sync with plugin-1713924030 (Internet web search)',
    pq?.data?.answer ? 'PASS' : 'FAIL',
    { ms: Date.now() - t3, answer: pq?.data?.answer?.slice(0, 160) },
  );
  // 5 client: inactive plugin → typed error, no retry storm
  try {
    await client.sessions.create({
      externalUserId: USER,
      pluginIds: ['plugin-1785777296'],
    });
    ok(
      'client: inactive plugin-1785777296 rejected upstream',
      'FAIL',
      'unexpected success',
    );
  } catch (e) {
    ok(
      'client: inactive plugin-1785777296 → OnDemandHttpError 400 (not retried)',
      e instanceof OnDemandHttpError && e.status === 400 ? 'PASS' : 'FAIL',
      { status: e.status, message: e.upstream?.message },
    );
  }
  // 6 client: workflow execute + follow (polling)
  const wfId = '6aace534859f7b0abb53d99a';
  const wf = await client.workflows.get(wfId);
  ok(
    'client.workflows.get (ONDEMAND_SPATIAL_WORKFLOW_ID real id)',
    wf?.isActive ? 'PASS' : 'FAIL',
    {
      name: wf?.name,
      isActive: wf?.isActive,
      nodes: wf?.nodes?.length,
      trigger: wf?.trigger?.type,
    },
  );
  const ex = await client.workflows.execute(wfId);
  let last;
  let logs = 0;
  for await (const snap of client.workflows.follow(ex.executionID, {
    intervalMs: 3000,
    maxMs: 45_000,
  })) {
    last = snap;
    logs += snap.newLogs.length;
  }
  ok(
    'client.workflows.execute + follow (status + logs polling)',
    ex.executionID && logs > 0 ? 'PASS' : 'FAIL',
    { status: last?.status, terminal: last?.terminal, logLines: logs },
  );
  // 7 proxy route end-to-end (no client key anywhere)
  let r = await call('GET', '/health');
  ok(
    'route GET /api/ondemand/v2/health',
    r.statusCode === 200 && r.json().keySource === 'server' ? 'PASS' : 'FAIL',
    r.json(),
  );
  r = await call('GET', '/contracts');
  ok(
    'route GET /api/ondemand/v2/contracts',
    r.statusCode === 200 &&
      r.json().contracts.length === contractRegistry.size()
      ? 'PASS'
      : 'FAIL',
    { contracts: r.json().contracts.length },
  );
  const ctx = {
    objectType: 'aircraft',
    objectId: 'live-A6-EVN',
    label: 'EK203 (test object)',
    position: { lat: 25.25, lon: 55.36, alt: 10668 },
    provenance: { provider: 'test', fetchedAt: ts() },
  };
  const t4 = Date.now();
  r = await call(
    'POST',
    '/chat',
    {
      externalUserId: USER,
      objectContext: ctx,
      query:
        'What object am I looking at and at what altitude? Answer from the context only.',
      responseMode: 'sync',
      endpointId: ENDPOINT,
    },
    { 'x-ondemand-key': 'client-key-must-be-ignored' },
  );
  const j1 = r.json();
  ok(
    'route POST /chat sync — object-context grounded, client key header ignored',
    r.statusCode === 200 &&
      /10668|10,668|EK203/.test(j1.answer || '') &&
      r.getHeader('x-ondemand-key-source') === 'server'
      ? 'PASS'
      : 'FAIL',
    {
      ms: Date.now() - t4,
      status: r.statusCode,
      reused: j1.reused,
      objectContextKey: j1.objectContextKey,
      answer: (j1.answer || j1.error || '').slice(0, 140),
    },
  );
  r = await call('POST', '/chat', {
    externalUserId: USER,
    objectContext: ctx,
    query: 'Repeat the altitude.',
    responseMode: 'sync',
    endpointId: ENDPOINT,
  });
  ok(
    'route POST /chat sync — second turn reuses the SAME session (isolation key user+object)',
    r.json().reused === true && r.json().sessionId === j1.sessionId
      ? 'PASS'
      : 'FAIL',
    {
      reused: r.json().reused,
      sameSession: r.json().sessionId === j1.sessionId,
    },
  );
  r = await call('POST', '/chat', {
    externalUserId: USER + '-other',
    objectContext: ctx,
    query: 'Repeat the altitude.',
    responseMode: 'sync',
    endpointId: ENDPOINT,
  });
  ok(
    'route POST /chat sync — different externalUserId gets a DIFFERENT session',
    r.json().sessionId && r.json().sessionId !== j1.sessionId ? 'PASS' : 'FAIL',
    { different: r.json().sessionId !== j1.sessionId },
  );
  const t5 = Date.now();
  r = await call('POST', '/chat', {
    externalUserId: USER,
    objectContext: {
      objectType: 'camera',
      objectId: 'live-cam-1',
      label: 'Test camera',
    },
    query: 'Say OK.',
    responseMode: 'stream',
    endpointId: ENDPOINT,
  });
  const body = r.text();
  ok(
    'route POST /chat stream — SSE relay (session preamble, message events, done)',
    r.getHeader('content-type')?.includes('event-stream') &&
      body.includes('event: session') &&
      body.includes('event: done')
      ? 'PASS'
      : 'FAIL',
    { ms: Date.now() - t5, bytes: body.length, head: body.slice(0, 160) },
  );
  r = await call(
    'GET',
    `/messages?externalUserId=${USER}&objectContextKey=aircraft:live-A6-EVN&limit=5`,
  );
  ok(
    'route GET /messages (history via conversation key)',
    r.statusCode === 200 && Array.isArray(r.json().data) ? 'PASS' : 'FAIL',
    { count: r.json().data?.length },
  );
  r = await call('GET', `/conversations?externalUserId=${USER}`);
  ok(
    'route GET /conversations (per-user listing)',
    r.statusCode === 200 && r.json().conversations.length >= 2
      ? 'PASS'
      : 'FAIL',
    { conversations: r.json().conversations.length },
  );
  r = await call('DELETE', '/conversations', {
    externalUserId: USER,
    objectContextKey: 'aircraft:live-A6-EVN',
  });
  ok(
    'route DELETE /conversations (close mapping)',
    r.json().closed === true ? 'PASS' : 'FAIL',
    r.json(),
  );
  r = await call('POST', '/workflows/execute', { workflowId: wfId });
  ok(
    'route POST /workflows/execute',
    r.statusCode === 202 && r.json().executionID ? 'PASS' : 'FAIL',
    {
      status: r.statusCode,
      streamPath: r.json().streamPath?.replace(/[0-9a-f]{24}/, '<id>'),
    },
  );
  // ---- cycle 2 (2026-10-20): Phase C/D/E/G surfaces against the LIVE platform ----
  // 23 sync chat with object context: citations + confidence + provenance
  const tC = Date.now();
  r = await call(
    'POST',
    '/chat',
    {
      externalUserId: `${USER}-c2`,
      objectContext: {
        objectType: 'earthquake',
        objectId: 'live-probe-1',
        label: 'M4.1 probe near Abu Dhabi',
        position: { lat: 24.45, lon: 54.65 },
      },
      query:
        'In one sentence, what is this object context about? Cite nothing.',
      responseMode: 'sync',
    },
    { 'x-workstation-user': `${USER}-c2` },
  );
  ok(
    'route POST /chat sync with objectContext → provenance.keySource=server, confidenceBasis present',
    r.statusCode === 200 &&
      r.json().provenance?.keySource === 'server' &&
      typeof r.json().confidenceBasis === 'string' &&
      r.json().objectContextKey === 'earthquake:live-probe-1'
      ? 'PASS'
      : 'FAIL',
    {
      ms: Date.now() - tC,
      status: r.statusCode,
      basis: r.json().confidenceBasis,
      answerChars: String(r.json().answer || '').length,
      injectionFlags: r.json().injectionFlags,
    },
  );
  // 24 authz mismatch
  r = await call(
    'POST',
    '/chat',
    { externalUserId: `${USER}-c2`, query: 'x', responseMode: 'sync' },
    { 'x-workstation-user': 'somebody-else' },
  );
  ok(
    'route POST /chat with mismatching X-Workstation-User → 403 user_mismatch',
    r.statusCode === 403 && r.json().error === 'user_mismatch'
      ? 'PASS'
      : 'FAIL',
    r.json(),
  );
  // 25 HUD summary on OnDemand (replaces the OpenAI bypass)
  const tH = Date.now();
  r = await call('POST', '/summaries/hud', {
    placeLabels: ['Abu Dhabi', 'Al Maryah Island'],
    streetLabels: ['Corniche Road'],
    nearbyPlaceLabels: ['Louvre Abu Dhabi'],
    enabledLayerLabels: ['Live Flights', 'Earthquakes'],
  });
  ok(
    'route POST /summaries/hud → five-word summary from the fulfilment endpoint',
    r.statusCode === 200 &&
      String(r.json().summary || '').split(' ').length === 5 &&
      r.json().provenance?.provider === 'OnDemand'
      ? 'PASS'
      : 'FAIL',
    {
      ms: Date.now() - tH,
      status: r.statusCode,
      summary: r.json().summary,
      error: r.json().error,
    },
  );
  // 26 three concurrent users on the same object → three distinct sessions; same user+object reused
  const users = ['iso-a', 'iso-b', 'iso-c'].map((u) => `${USER}-${u}`);
  const tI = Date.now();
  const iso = await Promise.all(
    users.map((u) =>
      call(
        'POST',
        '/chat',
        {
          externalUserId: u,
          objectContext: { objectType: 'organization', objectId: 'iso-org' },
          query: `Reply with exactly: ISO-${u.slice(-1).toUpperCase()}`,
          responseMode: 'sync',
        },
        { 'x-workstation-user': u },
      ),
    ),
  );
  const isoSessions = iso.map((x) => x.json().sessionId);
  const isoAnswers = iso.map((x) => String(x.json().answer || '').trim());
  const again = await call(
    'POST',
    '/chat',
    {
      externalUserId: users[0],
      objectContext: { objectType: 'organization', objectId: 'iso-org' },
      query: 'Reply with exactly: ISO-A2',
      responseMode: 'sync',
    },
    { 'x-workstation-user': users[0] },
  );
  ok(
    'isolation: 3 concurrent users × same object → 3 distinct sessions, answers not crossed, same user reuses',
    iso.every((x) => x.statusCode === 200) &&
      new Set(isoSessions).size === 3 &&
      isoAnswers[0].includes('ISO-A') &&
      isoAnswers[1].includes('ISO-B') &&
      isoAnswers[2].includes('ISO-C') &&
      again.json().sessionId === isoSessions[0] &&
      again.json().reused === true
      ? 'PASS'
      : 'FAIL',
    {
      ms: Date.now() - tI,
      distinctSessions: new Set(isoSessions).size,
      answers: isoAnswers,
    },
  );
  // 27 investigation: parallel plugin retrieval + synthesis (bounded to 1 plugin to keep the probe short)
  const tV = Date.now();
  r = await call(
    'POST',
    '/investigate',
    {
      externalUserId: `${USER}-inv`,
      objectContext: {
        objectType: 'newsArticle',
        objectId: 'abu-dhabi-probe',
        label: 'Abu Dhabi',
      },
      question:
        'What is one verifiable recent news item about Abu Dhabi? Cite the URL.',
      maxPlugins: 1,
    },
    { 'x-workstation-user': `${USER}-inv` },
  );
  const rep = r.json();
  ok(
    'route POST /investigate → plan + sources + objects + synthesis (live plugin retrieval)',
    r.statusCode === 200 &&
      rep.schema === 'ondemand-workstation/investigation/1' &&
      rep.sources.some((x) => x.status === 'ok') &&
      rep.provenance?.keySource === 'server'
      ? 'PASS'
      : 'FAIL',
    {
      ms: Date.now() - tV,
      status: r.statusCode,
      plan: rep.plan?.plugins,
      sources: rep.sources?.map(
        (x) => `${x.contract}:${x.status}${x.error ? ':' + x.error : ''}`,
      ),
      counts: rep.counts,
      citations: rep.objects
        ?.flatMap((o) => o.citations?.map((c) => c.url) || [])
        .slice(0, 3),
      synthesisParsed: rep.synthesis?.parsed,
      synthesisError: rep.synthesisError,
      timings: rep.timings,
    },
  );
  // 28 stream relay carries provenance event before done
  const tS = Date.now();
  r = await call(
    'POST',
    '/chat',
    {
      externalUserId: `${USER}-c2`,
      objectContext: { objectType: 'graphEdge', objectId: 'a-b' },
      query: 'Reply with exactly: STREAM-OK',
    },
    { 'x-workstation-user': `${USER}-c2` },
  );
  const streamText = r.text();
  ok(
    'route POST /chat stream → session, deltas, provenance, done (in order)',
    r.statusCode === 200 &&
      streamText.indexOf('event: session') <
        streamText.indexOf('event: provenance') &&
      streamText.indexOf('event: provenance') <
        streamText.indexOf('event: done') &&
      streamText.includes('STREAM')
      ? 'PASS'
      : 'FAIL',
    {
      ms: Date.now() - tS,
      bytes: streamText.length,
      events: [...streamText.matchAll(/^event: (\w+)/gm)]
        .map((m) => m[1])
        .filter((v, i, a) => a.indexOf(v) === i),
    },
  );

  // ---- cycle 3 (2026-10-21): voice turn, plugin lifecycle, registry-derived tools ----
  // 29 voice health
  r = await call('GET', '/voice/health');
  const vh = r.json();
  ok(
    'route GET /voice/health → configured, STT+TTS services, turn-based transport',
    r.statusCode === 200 &&
      vh.ok === true &&
      vh.configured === true &&
      Array.isArray(vh.services) &&
      vh.services.includes('speech_to_text') &&
      vh.services.includes('text_to_speech')
      ? 'PASS'
      : 'FAIL',
    vh,
  );
  // 30 voice turn (transcript path): STT skipped → chat stream → TTS, SSE in order, done with metrics
  const tVt = Date.now();
  r = await call(
    'POST',
    '/voice/turn',
    {
      externalUserId: `${USER}-voice`,
      transcript: 'In one short sentence, what is the local time zone of Dubai?',
      objectContext: {
        objectType: 'mapMarker',
        objectId: 'dubai-voice-probe',
        label: 'Dubai',
        position: { lat: 25.2, lon: 55.27 },
      },
      tts: true,
    },
    { 'x-workstation-user': `${USER}-voice` },
  );
  const vt = r.text();
  const vEvents = [...vt.matchAll(/^event: ([\w_-]+)/gm)].map((m) => m[1]);
  const ttsLine = vt.match(/^event: tts\ndata: (.*)$/m);
  let ttsUrl = null;
  try {
    ttsUrl = ttsLine ? JSON.parse(ttsLine[1]).audioUrl : null;
  } catch {
    /* no tts */
  }
  ok(
    'route POST /voice/turn (transcript) → turn, session, delta…, answer, tts(https), done — same-origin SSE, server key',
    r.statusCode === 200 &&
      vEvents.indexOf('turn') === 0 &&
      vEvents.includes('answer') &&
      vEvents.includes('done') &&
      vEvents.indexOf('answer') < vEvents.indexOf('done') &&
      typeof ttsUrl === 'string' &&
      /^https:\/\//.test(ttsUrl)
      ? 'PASS'
      : 'FAIL',
    {
      ms: Date.now() - tVt,
      status: r.statusCode,
      events: vEvents.filter((v, i, a) => a.indexOf(v) === i),
      deltas: vEvents.filter((e) => e === 'delta').length,
      ttsHttps: typeof ttsUrl === 'string' && ttsUrl.startsWith('https://'),
      keySource: r.headers?.['x-ondemand-key-source'],
    },
  );
  // 31 voice turn validation: neither transcript nor audioUrl → 400
  r = await call(
    'POST',
    '/voice/turn',
    { externalUserId: `${USER}-voice` },
    { 'x-workstation-user': `${USER}-voice` },
  );
  ok(
    'route POST /voice/turn without transcript/audioUrl → 400 validation (no upstream call)',
    r.statusCode === 400 ? 'PASS' : 'FAIL',
    { status: r.statusCode, body: r.text().slice(0, 160) },
  );
  // 32 voice turn authz: mismatching principal → 403
  r = await call(
    'POST',
    '/voice/turn',
    { externalUserId: `${USER}-voice`, transcript: 'hello' },
    { 'x-workstation-user': 'someone-else' },
  );
  ok(
    'route POST /voice/turn with mismatching X-Workstation-User → 403 user_mismatch',
    r.statusCode === 403 ? 'PASS' : 'FAIL',
    { status: r.statusCode, body: r.text().slice(0, 120) },
  );
  // 33 plugin lifecycle snapshot: every contract starts discovered/inactive, no fabricated READY
  r = await call('GET', '/plugins');
  const snap = r.json();
  ok(
    'route GET /plugins → lifecycle snapshot (contracts listed, nothing READY before a real probe)',
    r.statusCode === 200 &&
      Array.isArray(snap.plugins) &&
      snap.plugins.length >= 30 &&
      !snap.plugins.some((p) => p.state === 'ready')
      ? 'PASS'
      : 'FAIL',
    {
      count: snap.plugins?.length,
      states: snap.plugins?.reduce((a, p) => {
        a[p.state] = (a[p.state] || 0) + 1;
        return a;
      }, {}),
    },
  );
  // 34 plugin verify: real session + probe → ready (internet web search); inactive X MCP → failed
  const tPv = Date.now();
  r = await call(
    'POST',
    '/plugins/verify',
    {
      externalUserId: `${USER}-plugins`,
      names: ['internet_web_search', 'x_mcp_connector'],
    },
    { 'x-workstation-user': `${USER}-plugins` },
  );
  const ver = r.json();
  const web = ver.plugins?.find((p) => p.name === 'internet_web_search');
  const xm = ver.plugins?.find((p) => p.name === 'x_mcp_connector');
  ok(
    'route POST /plugins/verify → internet_web_search READY via live session+probe; x_mcp_connector FAILED inactive_on_account (honest)',
    r.statusCode === 200 &&
      web?.state === 'ready' &&
      typeof web.verifiedAt === 'string' &&
      xm?.state === 'failed' &&
      xm?.error?.code === 'inactive_on_account'
      ? 'PASS'
      : 'FAIL',
    {
      ms: Date.now() - tPv,
      web: web && { state: web.state, latencyMs: web.latencyMs, verifiedAt: web.verifiedAt },
      xMcp: xm && { state: xm.state, code: xm.error?.code },
    },
  );
  // 35 /contracts now carries the registry-derived tool contracts (21 tools)
  r = await call('GET', '/contracts');
  const cl = r.json().contracts || [];
  ok(
    'route GET /contracts → 33 contracts incl. 21 ondemand-tool contracts derived from server/tools/registry.js',
    r.statusCode === 200 &&
      cl.length === 33 &&
      cl.filter((c) => c.kind === 'ondemand-tool').length === 21
      ? 'PASS'
      : 'FAIL',
    { total: cl.length, tools: cl.filter((c) => c.kind === 'ondemand-tool').length },
  );
  // 36 investigate on an earthquake object: repo tool runs IN-PROCESS (B-13 closed) + plugin
  const tI2 = Date.now();
  r = await call(
    'POST',
    '/investigate',
    {
      externalUserId: `${USER}-inv2`,
      objectContext: {
        objectType: 'earthquake',
        objectId: 'eq-tokyo-probe',
        label: 'Earthquake near Tokyo',
        position: { lat: 35.68, lon: 139.69 },
      },
      question: 'How many earthquakes above M2.5 were recorded within 300 km in the last 7 days?',
      maxPlugins: 1,
    },
    { 'x-workstation-user': `${USER}-inv2` },
  );
  const rep2 = r.json();
  const toolRow = rep2.sources?.find((x) => x.contract === 'earthquake_search');
  ok(
    'route POST /investigate (earthquake) → earthquake_search tool executed in-process (status ok, not skipped) + plugin',
    r.statusCode === 200 && toolRow && toolRow.status === 'ok' ? 'PASS' : 'FAIL',
    {
      ms: Date.now() - tI2,
      sources: rep2.sources?.map(
        (x) => `${x.contract}:${x.status}${x.error ? ':' + x.error : ''}${x.reason ? ':' + x.reason : ''}`,
      ),
      counts: rep2.counts,
    },
  );
} catch (err) {
  ok('fatal', 'FAIL', {
    name: err?.name,
    message: err?.message,
    status: err?.status,
    upstream: err?.upstream,
  });
}
const pass = rows.filter((r) => r.result === 'PASS').length;
console.log(
  JSON.stringify(
    { generatedUtc: ts(), pass, fail: rows.length - pass, rows },
    null,
    1,
  ),
);
process.exit(rows.length - pass === 0 ? 0 : 1);
