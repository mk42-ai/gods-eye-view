import test, { describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  orchestrateSceneVideos,
  extractJson,
  parseSearchHits,
  captionOffsetFromSnippet,
  matchIncidentHint,
  breakerOpen,
  __resetBreakers,
  SCENE_VIDEO_PLUGINS,
  createShortUrlResolver,
} from './orchestrator.js';
import { buildVideoQueryPlan, parseSceneHash, findPlaces } from './plan.js';
import { createSceneVideoRoutes, allowedMediaUrl } from './routes.js';

const NOW = new Date('2026-10-23T04:00:00Z');
const HASH =
  '#v=2&lat=13.9425&lon=48.9231&alt=712168&heading=0&pitch=-55&roll=360&style=normal&bloom=0&sharpen=0&bi=50&bv=2&si=65&hud=tactical&hv=1&dm=OFF&dd=50&da=elastic&kf=7&ko=1&cr=0&sc=1&scf=11&map=esri-imagery&l=&lo=f.e.1&ui=c.c.1_c.p.0_l.c.1_l.p.0_d.c.1_v.c.1_r.c.1_s.c.0_g.c.1_p.c.1_m.c.0';

/** Fake OnDemand invoker: answers per (pluginId, query) like the live plugins did on 2026-10-23. */
function fakeInvoker({ tiktokQuota = true, delays = {} } = {}) {
  const calls = [];
  const invoke = async (pluginId, query) => {
    calls.push({ pluginId, query });
    await new Promise((r) => setTimeout(r, delays[pluginId] || 1));
    const at = new Date().toISOString();
    const reply = (answer) => ({
      answer,
      startedAt: at,
      finishedAt: at,
      sessionId: 'x',
    });
    if (pluginId === SCENE_VIDEO_PLUGINS.search.pluginId) {
      if (query.includes('site:youtube.com'))
        return reply(
          JSON.stringify([
            {
              url: 'https://www.youtube.com/shorts/AAAAAAAAAAA',
              title: 'Crash on Umm Suqeim Street Dubai Police',
              published: '2026-10-22',
              snippet: '[0:12] intro [0:52] the accident on Umm Suqeim',
            },
            {
              url: 'https://www.youtube.com/watch?v=RHjCaPIWJVc',
              title: 'Dubai Real Estate 2026 Crash Explained Umm Suqeim',
              published: null,
            },
            {
              url: 'https://www.youtube.com/watch?v=ZZZZZZZZZZZ',
              title: 'Beach day in Dubai',
              published: null,
            },
          ]),
        );
      if (query.includes('site:tiktok.com'))
        return reply(
          JSON.stringify([
            {
              url: 'https://www.tiktok.com/@nasnews_ar/video/7689822370613169415',
              title: 'حادث على شارع أم سقيم',
              snippet: 'حادث على شارع أم سقيم نتيجة فقدان السائق السيطرة',
            },
          ]),
        );
      if (query.includes('site:instagram.com')) return reply('[]');
    }
    if (
      pluginId === SCENE_VIDEO_PLUGINS.youtubeOembed.pluginId ||
      pluginId === SCENE_VIDEO_PLUGINS.tiktokOembed.pluginId
    ) {
      const urls = [...query.matchAll(/^- (\S+)$/gm)].map((m) => m[1]);
      return reply(
        JSON.stringify(
          urls.map((url) => ({
            url,
            ok: true,
            title: `oembed:${url.slice(-11)}`,
            author_name: 'chan',
          })),
        ),
      );
    }
    if (pluginId === SCENE_VIDEO_PLUGINS.tiktokSearch.pluginId)
      return reply(
        tiktokQuota
          ? '{"message":"You have exceeded the MONTHLY quota for Scraping API on your current plan, BASIC."}'
          : '{"data":{"videos":[]}}',
      );
    if (pluginId === SCENE_VIDEO_PLUGINS.instagramDownload.pluginId) {
      if (query.includes('Ddyb6fvQ-Yn'))
        return reply(
          '{"items":[{"type":"video","shortUrl":"https://is.gd/HNpafE"}]}',
        );
      return reply('{"items":[{"type":"image","shortUrl":null}]}');
    }
    if (pluginId === SCENE_VIDEO_PLUGINS.youtubeCaptions.pluginId)
      return reply('{"error":"field key is missing in agent plugin config"}');
    if (pluginId === SCENE_VIDEO_PLUGINS.perplexity.pluginId)
      return reply('{"sourcesWithContent":[]}');
    if (pluginId === SCENE_VIDEO_PLUGINS.instagramUserInfo.pluginId)
      return reply('{"user":{"username":"dubaipolicehq","isVerified":true,"followerCount":1117818}}');
    throw new Error(`unexpected plugin ${pluginId}`);
  };
  return { invoke, calls };
}

const HINTS = [
  {
    id: 'umm-suqeim-2026-09-26',
    title: 'Crash on Umm Suqeim Street',
    reported_at: '2026-09-26T00:00:00Z',
    place: 'Umm Suqeim',
    lat: 25.1425,
    lon: 55.2055,
    match: ['umm suqeim'],
    sources: ['https://www.gulftoday.ae/x'],
    outletRecords: [
      {
        outlet: 'Dubai Police',
        url: 'https://www.instagram.com/p/DdvxagPqlbL',
        handles: ['dubaipolicehq'],
        published_at: '2026-09-26T00:00:00Z',
      },
    ],
    videoHints: [
      {
        url: 'https://www.instagram.com/reel/Ddyb6fvQ-Yn',
        note: 'Dubai collision reel',
      },
      {
        url: 'https://www.instagram.com/p/DdyBfSdl-zh',
        note: 'Gulf Today post',
      },
      {
        url: 'https://www.tiktok.com/@emirates_news/video/7627044985581374741',
        note: 'Dubai Police crash footage',
      },
    ],
  },
];

describe('query planner', () => {
  test('EN + AR keywords, places, bbox and time window for the Umm Suqeim prompt', () => {
    const plan = buildVideoQueryPlan(
      'rebuild the car crash reported in Umm Suqeim',
      { now: NOW, hash: HASH },
    );
    assert.deepEqual(plan.bbox, [55.17, 25.12, 55.24, 25.17]);
    assert.equal(plan.anchor.source, 'gazetteer');
    assert.ok(plan.places.includes('Umm Suqeim'));
    assert.ok(plan.places.includes('Jumeirah Street'));
    assert.ok(plan.keywordsEn.includes('crash'));
    assert.ok(plan.keywordsEn.includes('Dubai Police'));
    assert.ok(plan.keywordsAr.includes('حادث'));
    assert.ok(plan.keywordsAr.includes('أم سقيم'));
    assert.ok(plan.keywordsAr.includes('شرطة دبي'));
    assert.equal(plan.queriesEn[0], 'Umm Suqeim crash');
    assert.equal(plan.timeWindow.end, NOW.toISOString());
    assert.equal(plan.timeWindow.days, 60);
  });
  test('unknown place falls back to the URL-hash camera (scene state)', () => {
    const plan = buildVideoQueryPlan('explosion near the port', {
      now: NOW,
      hash: HASH,
    });
    assert.equal(plan.anchor.source, 'url-hash');
    assert.equal(plan.anchor.lat, 13.9425);
    assert.equal(plan.anchor.lon, 48.9231);
    assert.ok(plan.keywordsAr.includes('انفجار'));
  });
  test('parseSceneHash reads lat/lon/alt from the approved hash; findPlaces is most-specific first', () => {
    assert.deepEqual(parseSceneHash(HASH), {
      lat: 13.9425,
      lon: 48.9231,
      alt: 712168,
    });
    assert.deepEqual(parseSceneHash(''), { lat: null, lon: null, alt: null });
    assert.equal(
      findPlaces('crash in Dubai near Umm Suqeim')[0].name,
      'Umm Suqeim',
    );
    assert.equal(findPlaces('حادث في أم سقيم')[0].name, 'Umm Suqeim');
  });
});

describe('parsing helpers', () => {
  test('extractJson tolerates prose and fences', () => {
    assert.deepEqual(extractJson('Here:\n```json\n[{"a":1}]\n```'), [{ a: 1 }]);
    assert.deepEqual(extractJson('{"x":2} trailing'), { x: 2 });
    assert.equal(extractJson('none'), null);
  });
  test('parseSearchHits falls back to bare URLs', () => {
    assert.deepEqual(
      parseSearchHits(
        'see https://www.tiktok.com/@a/video/7627044985581374741.',
      ).map((h) => h.url),
      ['https://www.tiktok.com/@a/video/7627044985581374741'],
    );
  });
  test('captionOffsetFromSnippet finds the first keyword timestamp', () => {
    assert.equal(
      captionOffsetFromSnippet('[0:12] hello [0:52] the accident happened', [
        'accident',
      ]),
      52,
    );
    assert.equal(captionOffsetFromSnippet('[1:02:03] crash', ['crash']), 3723);
    assert.equal(captionOffsetFromSnippet('no stamps', ['crash']), 0);
  });
  test('matchIncidentHint picks the incident named in the prompt', () => {
    const plan = buildVideoQueryPlan(
      'rebuild the car crash reported in Umm Suqeim',
      { now: NOW },
    );
    assert.equal(matchIncidentHint(plan, HINTS).id, 'umm-suqeim-2026-09-26');
    assert.equal(
      matchIncidentHint(
        buildVideoQueryPlan('fire in Sharjah', { now: NOW }),
        HINTS,
      ),
      null,
    );
  });
});

describe('orchestrateSceneVideos', () => {
  beforeEach(() => __resetBreakers());

  test('fans out in parallel, streams clips, dedupes, ranks and labels across 3 platforms', async () => {
    const { invoke, calls } = fakeInvoker();
    const events = [];
    const r = await orchestrateSceneVideos(
      { prompt: 'rebuild the car crash reported in Umm Suqeim', hash: HASH },
      {
        invoke,
        now: NOW,
        hints: HINTS,
        emit: (e, d) => events.push([e, d]),
        resolveShortUrl: async () => null,
      },
    );
    // progressive event order: plan → incident → sources … clips … done (last)
    assert.equal(events[0][0], 'plan');
    assert.equal(events[1][0], 'incident');
    assert.equal(events[1][1].rebuild, true);
    assert.equal(events.at(-1)[0], 'done');
    const clipEvents = events.filter(([e]) => e === 'clip');
    assert.ok(clipEvents.length >= 3);
    assert.deepEqual(r.counts, { youtube: 2, tiktok: 2, instagram: 1 });
    // the off-topic "Beach day" result is dropped by the relevance filter
    assert.ok(!r.clips.some((c) => c.platformId === 'ZZZZZZZZZZZ'));
    // Instagram: the shortUrl is the playable target; the image post is skipped
    const ig = r.clips.find((c) => c.platform === 'instagram');
    assert.equal(ig.playableUrl, 'https://is.gd/HNpafE');
    assert.equal(ig.provenance.pluginId, 'plugin-1762980461');
    assert.equal(r.sources.instagram.imagesSkipped, 1);
    // TikTok quota → breaker tripped, fallback search + oEmbed verification used
    assert.equal(r.sources.tiktok.primary, 'quota_exhausted');
    assert.ok(breakerOpen(SCENE_VIDEO_PLUGINS.tiktokSearch.pluginId));
    assert.ok(
      r.clips
        .filter((c) => c.platform === 'tiktok')
        .every((c) => c.provenance.pluginId === 'plugin-1792727179'),
    );
    // YouTube caption offset parsed from the transcript snippet
    assert.equal(
      r.clips.find((c) => c.platformId === 'AAAAAAAAAAA').captionStartOffset,
      52,
    );
    // every clip is labelled and nothing older than 24 h is LIVE
    for (const c of r.clips) {
      assert.ok(['LIVE', 'RECENT', 'ARCHIVAL'].includes(c.tier));
      if (c.tier === 'LIVE') assert.ok(c.ageHours <= 24);
      assert.ok(c.provenance.pluginId?.startsWith('plugin-'));
      assert.ok(c.provenance.timestamp);
      assert.ok(c.fetched_at);
    }
    // sorted by score desc
    for (let i = 1; i < r.clips.length; i += 1)
      assert.ok(r.clips[i - 1].score >= r.clips[i].score);
    // per-plugin call log: TikTok quota error carried verbatim, captions config error recorded
    assert.ok(r.pluginCalls.length === calls.length);
    assert.ok(
      r.pluginCalls.some(
        (c) =>
          c.pluginId === SCENE_VIDEO_PLUGINS.tiktokSearch.pluginId &&
          !c.ok &&
          /MONTHLY quota/.test(c.error),
      ),
    );
    assert.match(r.sources.youtube.captions, /^config_error: field key is missing/);
    assert.equal(events.at(-1)[1].pluginCalls.length, r.pluginCalls.length);
    // verification lane: Perplexity empty + verified IG handle of the dated record
    assert.equal(r.verification.perplexity.empty, true);
    assert.equal(r.verification.handles.dubaipolicehq.verified, true);
    assert.ok(events.some(([e]) => e === 'verification'));
    // every provider call went through a plugin id (no direct provider calls)
    assert.ok(calls.every((c) => /^plugin-\d{10}$/.test(c.pluginId)));
  });

  test('lanes run concurrently (wall time ≈ slowest lane, not the sum)', async () => {
    const { invoke } = fakeInvoker({
      delays: {
        [SCENE_VIDEO_PLUGINS.search.pluginId]: 60,
        [SCENE_VIDEO_PLUGINS.instagramDownload.pluginId]: 60,
      },
    });
    const t0 = Date.now();
    await orchestrateSceneVideos(
      { prompt: 'car crash in Umm Suqeim' },
      { invoke, now: NOW, hints: HINTS },
    );
    assert.ok(Date.now() - t0 < 400, `took ${Date.now() - t0} ms`);
  });

  test('second run skips the quota-exhausted TikTok scraper (circuit breaker)', async () => {
    const first = fakeInvoker();
    await orchestrateSceneVideos(
      { prompt: 'crash Umm Suqeim' },
      { invoke: first.invoke, now: NOW, hints: HINTS },
    );
    const second = fakeInvoker();
    const r = await orchestrateSceneVideos(
      { prompt: 'crash Umm Suqeim' },
      { invoke: second.invoke, now: NOW, hints: HINTS },
    );
    assert.ok(
      !second.calls.some(
        (c) => c.pluginId === SCENE_VIDEO_PLUGINS.tiktokSearch.pluginId,
      ),
    );
    assert.match(r.sources.tiktok.primary, /circuit open/);
  });

  test('a failing lane does not sink the others', async () => {
    const { invoke } = fakeInvoker();
    const flaky = async (pluginId, q, o) => {
      if (pluginId === SCENE_VIDEO_PLUGINS.instagramDownload.pluginId)
        throw new Error('upstream_500');
      return invoke(pluginId, q, o);
    };
    const r = await orchestrateSceneVideos(
      { prompt: 'crash Umm Suqeim' },
      { invoke: flaky, now: NOW, hints: HINTS },
    );
    assert.equal(r.counts.instagram, 0);
    assert.ok(r.counts.youtube > 0 && r.counts.tiktok > 0);
    assert.ok(r.sources.instagram.errors.some((e) => /upstream_500/.test(e)));
  });
});

describe('routes', () => {
  function mockRes() {
    const chunks = [];
    return {
      statusCode: 0,
      headers: {},
      headersSent: false,
      setHeader(k, v) {
        this.headers[k.toLowerCase()] = v;
      },
      flushHeaders() {
        this.headersSent = true;
      },
      write(c) {
        chunks.push(String(c));
        return true;
      },
      end(c) {
        if (c) chunks.push(String(c));
        this.ended = true;
      },
      get body() {
        return chunks.join('');
      },
    };
  }
  function mockReq(method, body, headers = {}) {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    return {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      on(evt, fn) {
        if (evt === 'data' && payload) fn(payload);
        if (evt === 'end') fn();
        return this;
      },
      off() {},
      async *[Symbol.asyncIterator]() {
        if (payload) yield payload;
      },
    };
  }

  test('media allow-list: is.gd + Instagram/Facebook CDN only, https only', () => {
    assert.equal(
      allowedMediaUrl('https://is.gd/HNpafE'),
      'https://is.gd/HNpafE',
    );
    assert.ok(
      allowedMediaUrl(
        'https://scontent-cph2-1.cdninstagram.com/o1/v/x.mp4?a=1',
      ),
    );
    assert.equal(
      allowedMediaUrl('http://scontent.cdninstagram.com/x.mp4'),
      null,
    );
    assert.equal(allowedMediaUrl('https://evil.example.com/x.mp4'), null);
    assert.equal(allowedMediaUrl('https://cdninstagram.com.evil.io/x'), null);
    assert.equal(allowedMediaUrl('https://is.gd/../../etc'), null);
  });

  test('POST /scene/videos streams SSE events ending in done', async () => {
    __resetBreakers();
    const { invoke } = fakeInvoker();
    const handler = createSceneVideoRoutes({ invoke, now: () => NOW });
    const res = mockRes();
    const handled = await handler(
      mockReq('POST', {
        prompt: 'rebuild the car crash reported in Umm Suqeim',
        hash: HASH,
      }),
      res,
      {
        path: '/scene/videos',
        method: 'POST',
        url: new URL('http://x/scene/videos'),
      },
    );
    assert.equal(handled, true);
    assert.match(res.headers['content-type'], /text\/event-stream/);
    const events = [...res.body.matchAll(/^event: (\w+)$/gm)].map((m) => m[1]);
    assert.equal(events[0], 'plan');
    assert.ok(events.includes('clip'));
    assert.equal(events.at(-1), 'done');
    assert.ok(res.ended);
  });

  test('missing prompt → 400; media proxy rejects foreign hosts; unknown /scene path falls through', async () => {
    const handler = createSceneVideoRoutes({
      invoke: async () => ({ answer: '[]' }),
    });
    const r1 = mockRes();
    await handler(mockReq('POST', {}), r1, {
      path: '/scene/videos',
      method: 'POST',
      url: new URL('http://x/'),
    });
    assert.equal(r1.statusCode, 400);
    const r2 = mockRes();
    await handler(mockReq('GET'), r2, {
      path: '/scene/media',
      method: 'GET',
      url: new URL('http://x/scene/media?u=https://evil.example.com/a.mp4'),
    });
    assert.equal(r2.statusCode, 400);
    assert.equal(
      await handler(mockReq('GET'), mockRes(), {
        path: '/scene/other',
        method: 'GET',
        url: new URL('http://x/'),
      }),
      false,
    );
  });

  test('media proxy follows is.gd once, passes Range, maps expired CDN 403 → 410', async () => {
    const seen = [];
    const fetchImpl = async (url, init) => {
      seen.push([url, init?.method, init?.headers?.range]);
      if (url.startsWith('https://is.gd/'))
        return new Response(null, {
          status: 301,
          headers: {
            location: 'https://scontent-cph2-1.cdninstagram.com/v/x.mp4?oe=1',
          },
        });
      return new Response(null, { status: 403 });
    };
    const handler = createSceneVideoRoutes({
      fetch: fetchImpl,
      invoke: async () => ({ answer: '' }),
    });
    const res = mockRes();
    await handler(mockReq('GET', null, { range: 'bytes=0-' }), res, {
      path: '/scene/media',
      method: 'GET',
      url: new URL(
        'http://x/scene/media?u=' + encodeURIComponent('https://is.gd/HNpafE'),
      ),
    });
    assert.equal(res.statusCode, 410);
    assert.equal(seen[0][1], 'HEAD');
    assert.equal(seen[1][2], 'bytes=0-');
  });

  test('short-url resolver only accepts Instagram/Facebook CDN redirects', async () => {
    const ok = createShortUrlResolver(
      async () =>
        new Response(null, {
          status: 301,
          headers: { location: 'https://scontent.cdninstagram.com/x.mp4' },
        }),
    );
    assert.equal(
      await ok('https://is.gd/HNpafE'),
      'https://scontent.cdninstagram.com/x.mp4',
    );
    const bad = createShortUrlResolver(
      async () =>
        new Response(null, {
          status: 301,
          headers: { location: 'https://evil.example/x' },
        }),
    );
    assert.equal(await bad('https://is.gd/HNpafE'), null);
    assert.equal(await ok('https://bit.ly/x'), null);
  });
});
