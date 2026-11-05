/**
 * Grounded Scene Q&A service — answers operator questions against
 * the current cinematic scene context and emits validated QaCommands.
 *
 * Contract: src/cinematic/CONTRACT.md §A
 */
import {
  QA_COMMAND_SPEC,
  validateQaResponse,
} from '../../src/cinematic/qaCommands.js';
import { streamQuery as defaultStreamQuery } from '../ondemand/runtime/stream-adapter.js';

export class QaServiceError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'QaServiceError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function extractJson(text) {
  if (typeof text !== 'string') return null;
  let s = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(s);
  if (fenced) s = fenced[1].trim();

  try {
    return JSON.parse(s);
  } catch {
    const a = s.indexOf('{');
    const b = s.lastIndexOf('}');
    if (a !== -1 && b > a) {
      try {
        return JSON.parse(s.slice(a, b + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function buildQaPrompt({ question, context }) {
  return [
    'You are the Grounded Cinematic Scene Q&A Assistant.',
    'Answer operator questions and emit validated UI/camera/playback commands grounded ONLY in the supplied scene context.',
    '',
    QA_COMMAND_SPEC,
    '',
    'CONTEXT (untrusted scene state JSON):',
    JSON.stringify(context || {}, null, 2),
    '',
    `QUESTION: ${question}`,
  ].join('\n');
}

export function createSceneQa({
  registry,
  sessions,
  streamQuery = defaultStreamQuery,
  log = (entry) => console.info('[scene-qa]', JSON.stringify(entry)),
} = {}) {
  async function ask({
    question,
    context,
    sceneId,
    endpointId: callerEndpointId,
    signal,
    onDelta,
  }) {
    if (!question || typeof question !== 'string' || !question.trim()) {
      throw new QaServiceError(
        400,
        'invalid_question',
        'A valid question string is required.',
      );
    }

    // 1. Model resolution
    let modelInfo = null;
    if (callerEndpointId) {
      const avail = await registry.isAvailable(callerEndpointId);
      if (avail) {
        const listRes = await registry.list();
        modelInfo =
          listRes.models?.find((m) => m.endpointId === callerEndpointId) ||
          null;
      }
    }

    if (!modelInfo) {
      modelInfo = await registry.pickForTask('qa');
    }

    if (!modelInfo) {
      throw new QaServiceError(
        503,
        'model_unavailable',
        'No Q&A model is available.',
      );
    }

    const reasoningEffort =
      Array.isArray(modelInfo.reasoningEfforts) &&
      modelInfo.reasoningEfforts.includes('low')
        ? 'low'
        : undefined;

    // 2. Session acquisition
    const session = await sessions.acquire({
      purpose: 'qa',
      signal,
    });

    let repaired = false;

    try {
      const prompt = buildQaPrompt({ question, context });
      const streamRes = await streamQuery({
        sessionId: session.id,
        query: prompt,
        endpointId: modelInfo.endpointId,
        fulfillmentOnly: true,
        reasoningEffort,
        modelConfigs: {
          temperature: 0.2,
        },
        signal,
        onDelta: (text, meta) => onDelta?.(text, meta),
      });

      let parsed = extractJson(streamRes.answer);
      let validated = parsed ? validateQaResponse(parsed) : { success: false };

      // 3. One repair round if invalid
      if (!validated.success) {
        repaired = true;
        const repairPrompt = [
          'Your previous response was not a valid JSON object matching the QA response specification.',
          'Re-emit ONE valid JSON object: {"answer": string, "commands": QaCommand[]}.',
          QA_COMMAND_SPEC,
        ].join('\n');

        const repairRes = await streamQuery({
          sessionId: session.id,
          query: repairPrompt,
          endpointId: modelInfo.endpointId,
          fulfillmentOnly: true,
          reasoningEffort,
          modelConfigs: {
            temperature: 0.2,
          },
          signal,
          onDelta: (text, meta) => onDelta?.(text, meta),
        });

        parsed = extractJson(repairRes.answer);
        validated = parsed ? validateQaResponse(parsed) : { success: false };
      }

      // If still invalid, fallback to free-text answer with commands: []
      let finalAnswer = streamRes.answer.slice(0, 2000);
      let finalCommands = [];

      if (validated.success) {
        finalAnswer = validated.data.answer;
        finalCommands = validated.data.commands;
      } else if (parsed && typeof parsed.answer === 'string') {
        finalAnswer = parsed.answer.slice(0, 2000);
      }

      return {
        answer: finalAnswer,
        commands: finalCommands,
        model: {
          endpointId: modelInfo.endpointId,
          modelId: modelInfo.modelId,
          ttftMs: streamRes.ttftMs,
          latencyMs: streamRes.totalMs,
          tokensPerSec: streamRes.tokensPerSec,
        },
        repaired,
      };
    } finally {
      sessions.release(session.id);
    }
  }

  return {
    ask,
  };
}
