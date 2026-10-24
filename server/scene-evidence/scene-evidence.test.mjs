import test from 'node:test';
import assert from 'node:assert/strict';
import { runSceneEvidence, createEvidenceCache } from './pipeline.js';
import { createSources, parsePluginHits, SourceError, createEvidenceInvoker } from './sources.js';
import { createSceneEvidenceRoutes } from './routes.js';
import { sanitizeDiagnostic } from './safety.js';
const NOW = new Date('2026-10-24T06:00:00Z');
const input = { place: 'Dubai Marina', text: 'Dubai Marina', lat: 25.08, lon: 55.14, windowHours: 1, requestId: 'test-request' };
const fixture = (id, { delay = 0, rows = [], fail, configured = true, budgetMs = 1000 } = {}) => ({ id, name: id, platforms: ['youtube'], kind: 'video', budgetMs, credentials: ['TEST_SOURCE'], configured: () => configured, docs: 'isolated-test-fixture',
  async run(ctx, emit) { await new Promise((r) => setTimeout(r, delay)); if (fail) throw fail; for (const raw of rows) emit({ type: 'item', raw }); return { count: rows.length }; } });
const row = (extra = {}) => ({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'isolated fixture', ...extra });
const eligibleRow = () => row({ mediaType: 'video', evidence: { kind: 'provider-record', verified: true },
  mediaLocation: { sourceVerified: true, basis: 'recording-location', field: 'recordingDetails.location', geometry: { type: 'Point', coordinates: [55.14,25.08] } },
  recordingTime: { sourceVerified: true, basis: 'recorded', field: 'recordingDetails.recordingDate', value: '2026-10-24T05:45:00Z', precision: 'second' },
  playback: { authorized: true, type: 'official-embed' } });
const base = (sources) => ({ sources, now: NOW, env: {}, defaultEndpointId: 'documented-endpoint', emit() {} });

test('parallel providers stream qualified items and candidates separately; failures independent', async () => {
  const events = [], start = Date.now();
  const r = await runSceneEvidence(input, { ...base([
    fixture('fast', { delay: 5, rows: [row({ url: 'https://www.tiktok.com/@a/video/7690936936990592274' })] }),
    fixture('source-backed', { delay: 20, rows: [eligibleRow()] }),
    fixture('late', { delay: 100, rows: [row()], budgetMs: 35 }),
    fixture('denied', { fail: new SourceError('quota', 'quota unavailable') }),
    fixture('unconfigured', { configured: false, rows: [eligibleRow()] }),
  ]), emit: (e,d) => events.push([e,d]) });
  assert.ok(Date.now() - start < 300);
  assert.equal(r.items.length, 1); assert.equal(r.candidates.length, 1); assert.equal(r.totals.verifiedVideos, 1); assert.equal(r.totals.playbackVerified, 0);
  assert.equal(r.sources.find(s => s.id === 'late').state, 'timeout');
  assert.equal(r.sources.find(s => s.id === 'denied').state, 'quota');
  assert.equal(r.sources.find(s => s.id === 'unconfigured').state, 'credentials_required');
  assert.equal(events[0][0], 'plan'); assert.equal(events.at(-1)[0], 'done');
  assert.ok(events.every(([,d]) => d.requestId === input.requestId));
  const count = events.length; await new Promise(r => setTimeout(r, 120)); assert.equal(events.length, count, 'timed-out provider cannot emit late items');
});

test('Build/rebuild never silently returns cached footage as fresh', async () => {
  const cache = createEvidenceCache(); let calls = 0;
  const s = fixture('a', { rows: [row()] }); const run = s.run; s.run = (...args) => { calls++; return run(...args); };
  const deps = { ...base([s]), cache };
  await runSceneEvidence(input, deps); await runSceneEvidence(input, deps);
  assert.equal(calls, 2); assert.equal(cache.size(), 1);
});

test('abort stops pipeline side effects even if adapter ignores signal', async () => {
  const abort = new AbortController(), events = [];
  const p = runSceneEvidence(input, { ...base([fixture('slow', { delay: 80, rows: [eligibleRow()] })]), signal: abort.signal, emit: (e) => events.push(e) });
  setTimeout(() => abort.abort(), 5); await assert.rejects(p, /superseded/);
  const count = events.length; await new Promise(r => setTimeout(r,100)); assert.equal(events.length, count); assert.ok(!events.includes('item'));
});

test('all production source calls use OnDemand; direct provider fetch is never used', async () => {
  let fetches = 0; const plugins = [];
  const r = await runSceneEvidence(input, { ...base(createSources()), env: { ONDEMAND_API_KEY: 'test-runtime-only' },
    fetch: async () => { fetches++; throw new Error('direct provider access forbidden'); },
    invoke: async (plugin, query) => { plugins.push(plugin); assert.match(query, /2026-10-24T05:00:00.000Z/); return { answer: '{"results":[]}', status: 'completed' }; },
  });
  assert.equal(fetches, 0); assert.equal(plugins.length, 6); assert.equal(r.items.length, 0); assert.equal(r.sources.filter(s => s.state === 'unsupported').length,4);
});

test('LLM output cannot manufacture verified metadata or authors', () => {
  const hits = parsePluginHits(JSON.stringify([{ url: row().url, title: 'claimed title', published: NOW.toISOString(), coords: { lat:25.08, lon:55.14 }, recordedAt: NOW.toISOString(), author: { name:'invented' } }]));
  assert.equal(hits.length,1); assert.equal(hits[0].publishedAt,null); assert.equal(hits[0].coords,undefined); assert.equal(hits[0].author,undefined);
  assert.equal(parsePluginHits('https://evil.test/youtube.com/watch?v=dQw4w9WgXcQ').length,0);
});

test('diagnostics redact exact secrets, bearer values and signed query strings', () => {
  const env = { TEST_API_KEY:'synthetic-secret-value' };
  const text = sanitizeDiagnostic('failed synthetic-secret-value Bearer abcdef https://x.com/v.mp4?token=abc&signature=secret', env);
  assert.doesNotMatch(text, /synthetic-secret-value|abcdef|signature=|token=abc/);
});

test('documented OnDemand session/query shapes carry abort and sanitized correlation', async () => {
  const calls = [], diagnostics = [];
  const client = { sessions: { create: async (body, opts) => { calls.push(body); assert.ok(opts.signal); opts.onResponse({status:200,method:'POST',path:'/chat/v1/sessions',ms:2}); return {id:'abcdefabcdefabcdefabcdef'}; } },
    query: { sync: async (id, body, opts) => { calls.push(body); opts.onResponse({status:200,method:'POST',path:'/chat/v1/sessions/:sessionId/query',ms:3}); return {data:{answer:'{"results":[]}',status:'completed'}}; } } };
  const invoke = createEvidenceInvoker({ client, defaultEndpointId:'test-endpoint' });
  await invoke('plugin-test','test query',{onTransport: x => diagnostics.push(x),requestId:'r'});
  assert.deepEqual(calls[0].pluginIds,['plugin-test']); assert.equal(calls[1].responseMode,'sync'); assert.equal(calls[1].fulfillmentOnly,false); assert.equal(calls[1].reasoningEffort,undefined); assert.equal(diagnostics.length,2);
});

function res() { const chunks = []; return {statusCode:0,headers:{},chunks,setHeader(k,v){this.headers[k.toLowerCase()]=v;},write(c){chunks.push(String(c));},flushHeaders(){},on(){},off(){},end(c){if(c)chunks.push(String(c));this.writableEnded=true;}}; }
test('HTTP validation rejects partial/invalid coords and invalid windows before a provider call', async () => {
  let calls=0;const h=createSceneEvidenceRoutes({env:{},sources:[],invoke:async()=>{calls++;},now:()=>NOW});
  for (const query of ['', '?place=hi&lat=25&lon=55', '?place=Dubai&lat=25','?place=Dubai&lat=91&lon=55','?place=Dubai&lat=25&lon=55&windowHours=abc','?place=Dubai&lat=25&lon=55&timeMode=historical&windowStart=bad']) {
    const r=res();await h({headers:{},on(){},off(){}},r,{path:'/scene/evidence',method:'GET',url:new URL('http://x/scene/evidence'+query)});assert.ok(r.statusCode>=400);
  } assert.equal(calls,0);
});
test('SSE includes request identity, exact interval and truthful empty result', async () => {
  const h=createSceneEvidenceRoutes({env:{},sources:[fixture('none',{configured:false})],invoke:async()=>({answer:'[]'}),now:()=>NOW});
  const r=res();await h({headers:{},on(){},off(){}},r,{path:'/scene/evidence',method:'GET',url:new URL('http://x/scene/evidence?place=Dubai&lat=25&lon=55&requestId=my-id')});
  const text=r.chunks.join('');assert.equal(r.statusCode,200);assert.equal(r.headers['x-scene-request-id'],'my-id');assert.match(text,/event: done/);assert.match(text,/No verified recent footage/);assert.match(text,/2026-10-24T05:00:00.000Z/);assert.doesNotMatch(text,/event: item/);
});
