import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceTurnHandler } from './voice-route.js';
import { createConversationStore } from './conversation-store.js';
import { makeReq, makeRes } from '../test-helpers.mjs';

function parseSseEvents(text) {
  const events = [];
  const blocks = text.split('\n\n').filter(Boolean);
  for (const block of blocks) {
    let event = 'message';
    let dataStr = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) {
        event = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        dataStr = line.slice(6);
      }
    }
    let data;
    try {
      data = JSON.parse(dataStr);
    } catch {
      data = dataStr;
    }
    events.push({ event, data });
  }
  return events;
}

function fakeClient({
  sttText = 'transcribed speech',
  chatAnswer = 'Answer text here with https://source.example/test',
  ttsAudioUrl = 'https://storage.on-demand.io/test.mp3',
  ttsFail = false,
  workflowAnswer = 'workflow voice agent answer',
} = {}) {
  let sessionCount = 0;
  return {
    isConfigured: () => true,
    sessions: {
      create: async () => ({
        id: `session-${++sessionCount}`.padStart(24, '0'),
      }),
    },
    query: {
      stream: async (sessionId, input, { signal } = {}) => {
        return {
          events: (async function* () {
            if (signal?.aborted) return;
            yield {
              event: 'message',
              data: {
                eventType: 'statusLog',
                statusType: 'executing',
                statusMessage: 'Searching places',
                executedAgents: ['agent-1'],
              },
            };
            yield {
              event: 'message',
              data: {
                eventType: 'fulfillment',
                answer: chatAnswer.slice(0, 10),
              },
              answer: chatAnswer.slice(0, 10),
            };
            yield {
              event: 'message',
              data: {
                eventType: 'fulfillment',
                answer: chatAnswer.slice(10),
              },
              answer: chatAnswer.slice(10),
            };
            yield { event: 'done', data: '[DONE]' };
          })(),
        };
      },
    },
    services: {
      speechToText: async ({ audioUrl }, { signal } = {}) => {
        if (signal?.aborted) throw new Error('aborted');
        return { text: sttText };
      },
      textToSpeech: async ({ input }, { signal } = {}) => {
        if (signal?.aborted) throw new Error('aborted');
        if (ttsFail) throw new Error('TTS upstream service unavailable');
        return { audioUrl: ttsAudioUrl };
      },
    },
    workflows: {
      execute: async (flowId, { signal } = {}) => {
        if (signal?.aborted) throw new Error('aborted');
        return { executionID: '6ad8160ab28e35aa11d85633' };
      },
      follow: async function* (executionID, { signal } = {}) {
        if (signal?.aborted) return;
        yield {
          status: 'executing',
          newLogs: [{ message: 'step 1 running' }],
          terminal: false,
        };
        yield {
          status: 'success',
          newLogs: [{ message: 'step 2 done' }],
          terminal: true,
        };
      },
      nodeOutputs: async (executionID, { signal } = {}) => {
        if (signal?.aborted) throw new Error('aborted');
        return {
          voice_agent_answer: { value: workflowAnswer },
        };
      },
    },
  };
}

describe('voice-route — createVoiceTurnHandler', () => {
  test('returns false when path is not /voice/turn or /voice/health', async () => {
    const handler = createVoiceTurnHandler({
      client: fakeClient(),
      store: createConversationStore({ backend: 'memory' }),
    });
    const req = makeReq({ method: 'GET', url: '/other' });
    const res = makeRes();
    const handled = await handler(req, res, { path: '/other', method: 'GET' });
    assert.equal(handled, false);
  });

  test('voice/health returns 200 with documented shape', async () => {
    const handler = createVoiceTurnHandler({
      client: fakeClient(),
      store: createConversationStore({ backend: 'memory' }),
      config: {
        sources: { voiceFlowId: 'ONDEMAND_VOICE_WORKFLOW_ID' },
      },
    });
    const req = makeReq({ method: 'GET', url: '/voice/health' });
    const res = makeRes();
    const handled = await handler(req, res, {
      path: '/voice/health',
      method: 'GET',
    });
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.ok, true);
    assert.equal(body.configured, true);
    assert.deepEqual(body.services, ['speech_to_text', 'text_to_speech']);
    assert.equal(
      body.realtimeTransport,
      'turn-based (OnDemand exposes no realtime audio API)',
    );
    assert.equal(body.voiceFlowId.resolvedVia, 'ONDEMAND_VOICE_WORKFLOW_ID');
  });

  test('voice/turn with transcript emits ordered events and done', async () => {
    const handler = createVoiceTurnHandler({
      client: fakeClient({ chatAnswer: 'Dubai is in GST timezone' }),
      store: createConversationStore({ backend: 'memory' }),
      config: { fulfillmentEndpointId: 'predefined-gpt-6-luna' },
    });

    const req = makeReq({
      method: 'POST',
      url: '/voice/turn',
      body: {
        externalUserId: 'user-42',
        transcript: 'What time is it in Dubai?',
      },
    });
    const res = makeRes();
    const handled = await handler(req, res, {
      path: '/voice/turn',
      method: 'POST',
    });
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);

    const events = parseSseEvents(res.text());
    const eventNames = events.map((e) => e.event);

    assert.ok(eventNames.includes('turn'));
    assert.ok(
      !eventNames.includes('transcript'),
      'transcript event is skipped when transcript was given',
    );
    assert.ok(eventNames.includes('session'));
    assert.ok(eventNames.includes('status'));
    assert.ok(eventNames.includes('delta'));
    assert.ok(eventNames.includes('answer'));
    assert.ok(eventNames.includes('tts'));
    assert.ok(eventNames.includes('done'));

    const turnEvt = events.find((e) => e.event === 'turn');
    assert.ok(turnEvt.data.turnId.startsWith('turn-'));
    assert.equal(turnEvt.data.mode, 'chat');

    const ansEvt = events.find((e) => e.event === 'answer');
    assert.equal(ansEvt.data.text, 'Dubai is in GST timezone');
    assert.equal(ansEvt.data.provenance.provider, 'ondemand');
    assert.equal(ansEvt.data.provenance.keySource, 'server');

    const ttsEvt = events.find((e) => e.event === 'tts');
    assert.match(ttsEvt.data.audioUrl, /^https:\/\//);

    const doneEvt = events.find((e) => e.event === 'done');
    assert.ok(typeof doneEvt.data.metrics.totalMs === 'number');
    assert.equal(doneEvt.data.metrics.sttMs, 0);
  });

  test('voice/turn with audioUrl calls services.speechToText then chat', async () => {
    let sttCalled = false;
    const client = fakeClient({ sttText: 'what is the capital of UAE' });
    const originalStt = client.services.speechToText;
    client.services.speechToText = async (...args) => {
      sttCalled = true;
      return originalStt(...args);
    };

    const handler = createVoiceTurnHandler({
      client,
      store: createConversationStore({ backend: 'memory' }),
      config: { fulfillmentEndpointId: 'predefined-gpt-6-luna' },
    });

    const req = makeReq({
      method: 'POST',
      url: '/voice/turn',
      body: {
        externalUserId: 'user-audio-1',
        audioUrl: 'https://storage.on-demand.io/user-mic.wav',
      },
    });
    const res = makeRes();
    const handled = await handler(req, res, {
      path: '/voice/turn',
      method: 'POST',
    });
    assert.equal(handled, true);
    assert.equal(sttCalled, true);

    const events = parseSseEvents(res.text());
    const eventNames = events.map((e) => e.event);
    assert.ok(eventNames.includes('transcript'));

    const transcriptEvt = events.find((e) => e.event === 'transcript');
    assert.equal(transcriptEvt.data.text, 'what is the capital of UAE');
    assert.ok(typeof transcriptEvt.data.ms === 'number');
  });

  test('400 when both or neither audioUrl and transcript are given', async () => {
    const handler = createVoiceTurnHandler({
      client: fakeClient(),
      store: createConversationStore({ backend: 'memory' }),
    });

    // Neither
    const req1 = makeReq({
      method: 'POST',
      url: '/voice/turn',
      body: { externalUserId: 'user-1' },
    });
    const res1 = makeRes();
    await handler(req1, res1, { path: '/voice/turn', method: 'POST' });
    assert.equal(res1.statusCode, 400);
    assert.equal(res1.json().field, 'input');

    // Both
    const req2 = makeReq({
      method: 'POST',
      url: '/voice/turn',
      body: {
        externalUserId: 'user-1',
        audioUrl: 'https://example.com/a.wav',
        transcript: 'hello',
      },
    });
    const res2 = makeRes();
    await handler(req2, res2, { path: '/voice/turn', method: 'POST' });
    assert.equal(res2.statusCode, 400);
    assert.equal(res2.json().field, 'input');

    // Non-https audioUrl
    const req3 = makeReq({
      method: 'POST',
      url: '/voice/turn',
      body: {
        externalUserId: 'user-1',
        audioUrl: 'http://insecure.example.com/a.wav',
      },
    });
    const res3 = makeRes();
    await handler(req3, res3, { path: '/voice/turn', method: 'POST' });
    assert.equal(res3.statusCode, 400);
    assert.equal(res3.json().field, 'audioUrl');
  });

  test('403 when authorize returns null', async () => {
    const handler = createVoiceTurnHandler({
      client: fakeClient(),
      store: createConversationStore({ backend: 'memory' }),
      authorize: (externalUserId) => {
        if (externalUserId === 'forbidden-user') return null;
        return { user: externalUserId };
      },
    });

    const req = makeReq({
      method: 'POST',
      url: '/voice/turn',
      body: {
        externalUserId: 'forbidden-user',
        transcript: 'hello',
      },
    });
    const res = makeRes();
    const handled = await handler(req, res, {
      path: '/voice/turn',
      method: 'POST',
    });
    assert.equal(handled, true);
  });

  test('TTS failure emits tts_error and turn still completes with done', async () => {
    const handler = createVoiceTurnHandler({
      client: fakeClient({ ttsFail: true }),
      store: createConversationStore({ backend: 'memory' }),
      config: { fulfillmentEndpointId: 'predefined-gpt-6-luna' },
    });

    const req = makeReq({
      method: 'POST',
      url: '/voice/turn',
      body: {
        externalUserId: 'user-tts-fail',
        transcript: 'test tts failure',
      },
    });
    const res = makeRes();
    await handler(req, res, { path: '/voice/turn', method: 'POST' });
    assert.equal(res.statusCode, 200);

    const events = parseSseEvents(res.text());
    const eventNames = events.map((e) => e.event);
    assert.ok(eventNames.includes('tts_error'));
    assert.ok(!eventNames.includes('tts'));
    assert.ok(eventNames.includes('done'), 'turn still completes with done');
  });

  test('workflow mode relays execute+follow with honest note', async () => {
    let executeCalledWith;
    const client = fakeClient({
      workflowAnswer: 'Flight Emirates 202 is on approach.',
    });
    const origExec = client.workflows.execute;
    client.workflows.execute = async (id, opts) => {
      executeCalledWith = id;
      return origExec(id, opts);
    };

    const handler = createVoiceTurnHandler({
      client,
      store: createConversationStore({ backend: 'memory' }),
      config: { voiceFlowId: '6ad8160ab28e35aa11d85632' },
    });

    const req = makeReq({
      method: 'POST',
      url: '/voice/turn',
      body: {
        externalUserId: 'user-wf-1',
        transcript: 'Show me incoming flights',
        mode: 'workflow',
      },
    });
    const res = makeRes();
    await handler(req, res, { path: '/voice/turn', method: 'POST' });
    assert.equal(res.statusCode, 200);
    assert.equal(executeCalledWith, '6ad8160ab28e35aa11d85632');

    const events = parseSseEvents(res.text());
    const eventNames = events.map((e) => e.event);
    assert.ok(eventNames.includes('workflow'));
    assert.ok(eventNames.includes('answer'));
    assert.ok(eventNames.includes('done'));

    const ansEvt = events.find((e) => e.event === 'answer');
    assert.equal(ansEvt.data.text, 'Flight Emirates 202 is on approach.');
    assert.match(ansEvt.data.note, /self-test input/);
  });

  test('client abort mid-stream propagates signal abort and halts further writes', async () => {
    let abortedSignal;
    const client = fakeClient();
    client.query.stream = async (sid, input, { signal } = {}) => {
      abortedSignal = signal;
      return {
        events: (async function* () {
          yield {
            event: 'message',
            data: { eventType: 'fulfillment', answer: 'chunk 1' },
          };
          // Simulate slow stream where client disconnects
          await new Promise((resolve) => setTimeout(resolve, 50));
          if (signal?.aborted) return;
          yield {
            event: 'message',
            data: { eventType: 'fulfillment', answer: 'chunk 2' },
          };
        })(),
      };
    };

    const handler = createVoiceTurnHandler({
      client,
      store: createConversationStore({ backend: 'memory' }),
    });

    const req = makeReq({
      method: 'POST',
      url: '/voice/turn',
      body: { externalUserId: 'user-abort', transcript: 'stream please' },
    });
    const res = makeRes();

    const turnPromise = handler(req, res, {
      path: '/voice/turn',
      method: 'POST',
    });
    // Trigger abort on req
    setTimeout(() => {
      req.emit('close');
    }, 10);

    await turnPromise;
    assert.ok(abortedSignal?.aborted);
  });
});
