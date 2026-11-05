/**
 * Cinematic Routes Middleware — HTTP & SSE endpoints for model discovery,
 * scene streaming, grounded Q&A, and patch validation.
 *
 * Contract: src/cinematic/CONTRACT.md §A
 */
import { randomUUID } from 'node:crypto';
import { createModelRegistry } from '../ondemand/runtime/model-registry.js';
import { createSessionManager } from '../ondemand/runtime/sessions.js';
import { createCinematicDirector, DirectorError } from './director.js';
import { createSceneQa, QaServiceError } from './qa.js';
import { createSceneEventStream } from './stream.js';
import {
  safeValidateScenePatch,
  OriginSchema,
} from '../../src/cinematic/sceneSchema.js';
import { RUNTIME_MODES } from '../../src/cinematic/events.js';
import {
  fetchWeatherObservation,
  buildWeatherPatch,
  OPEN_METEO_ATTRIBUTION,
} from './weather-intel.js';

function send(res, status, data) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 2000000) {
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      if (!data.trim()) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        const error = new Error('Malformed JSON body');
        error.statusCode = 400;
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

export function createCinematicMiddleware({
  registry,
  sessions,
  director,
  qa,
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const reg = registry || createModelRegistry({ env });
  const sess = sessions || createSessionManager();
  const dir =
    director || createCinematicDirector({ registry: reg, sessions: sess });
  const sceneQa = qa || createSceneQa({ registry: reg, sessions: sess });

  return async (req, res) => {
    const controller = new AbortController();
    const disconnected = () => {
      if (!res.writableEnded) controller.abort();
    };
    req.on?.('aborted', disconnected);
    res.on?.('close', disconnected);

    try {
      // 1. Client credentials check (reject per contract)
      if (req.headers?.['x-ondemand-key'] || req.headers?.apikey) {
        return send(res, 400, {
          ok: false,
          error: {
            code: 'client_credentials_rejected',
            message: 'Scene endpoints use server credentials only.',
          },
        });
      }

      // 2. Resolve relative path
      const fullPath = new URL(req.url || '/', 'http://scene.local').pathname;
      const path =
        fullPath
          .replace(/^\/api\/ondemand\/v2\/scene-plans/, '')
          .replace(/\/$/, '') || '/';

      // 3. Routing
      if (path === '/models' && req.method === 'GET') {
        const listRes = await reg.list();
        const assignments = reg.assignments();
        const health = reg.health();
        return send(res, 200, {
          ok: true,
          fetchedAt: listRes.fetchedAt,
          source: listRes.source,
          models: listRes.models,
          assignments,
          cerebrasAvailable: health.cerebrasAvailable,
        });
      }

      if (path === '/models/check' && req.method === 'POST') {
        const body = await readBody(req);
        const endpointId = body?.endpointId;
        if (
          !endpointId ||
          typeof endpointId !== 'string' ||
          endpointId.length > 120
        ) {
          return send(res, 400, {
            ok: false,
            error: {
              code: 'invalid_endpoint_id',
              message:
                'endpointId must be a valid string up to 120 characters.',
            },
          });
        }
        const listRes = await reg.list();
        const model = listRes.models?.find((m) => m.endpointId === endpointId);
        const available = Boolean(model?.available);
        return send(res, 200, {
          ok: true,
          endpointId,
          available,
          ...(model ? { model } : {}),
        });
      }

      if (path === '/patch/validate' && req.method === 'POST') {
        const body = await readBody(req);
        const parsed = safeValidateScenePatch(body?.patch);
        if (parsed.success) {
          return send(res, 200, { ok: true, patch: parsed.data });
        }
        return send(res, 400, {
          ok: false,
          error: {
            code: 'patch_invalid',
            message: parsed.error.issues
              .map((i) => `${i.path.join('.')}: ${i.message}`)
              .join('; '),
            issues: parsed.error.issues,
          },
        });
      }

      // Live Intelligence source: Open-Meteo weather → validated scene patch.
      // ingestion (fetch) → normalisation (regionalModel) → validation (zod
      // ScenePatch) → the browser's Live Intelligence Director applies it.
      if (path === '/intel/weather' && req.method === 'POST') {
        const body = await readBody(req);
        const lat = Number(body?.lat);
        const lon = Number(body?.lon);
        const sceneId = typeof body?.sceneId === 'string' ? body.sceneId : '';
        if (
          !Number.isFinite(lat) ||
          !Number.isFinite(lon) ||
          sceneId.length < 4
        ) {
          return send(res, 400, {
            ok: false,
            error: {
              code: 'invalid_request',
              message: 'lat, lon and sceneId are required.',
            },
          });
        }
        const obs = await fetchWeatherObservation({ lat, lon }, { fetchImpl });
        if (!obs.ok) {
          const status =
            obs.error?.code === 'provider_timeout'
              ? 504
              : obs.error?.code === 'invalid_point'
                ? 400
                : 502;
          return send(res, status, {
            ok: false,
            error: obs.error,
            provider: 'open-meteo',
            attribution: OPEN_METEO_ATTRIBUTION,
            latencyMs: obs.latencyMs ?? null,
          });
        }
        const built = buildWeatherPatch(obs, {
          sceneId,
          baseVersion: Number.isInteger(body?.baseVersion)
            ? body.baseVersion
            : 0,
          atSec: Number.isFinite(Number(body?.atSec)) ? Number(body.atSec) : 0,
        });
        if (!built.ok) {
          return send(res, 500, { ok: false, error: built.error });
        }
        return send(res, 200, {
          ok: true,
          provider: 'open-meteo',
          attribution: OPEN_METEO_ATTRIBUTION,
          observation: obs.observation,
          source: obs.source,
          latencyMs: obs.latencyMs,
          label: built.label,
          summary: built.summary,
          effect: built.effect,
          patch: built.patch,
        });
      }

      if (path === '/qa' && req.method === 'POST') {
        const body = await readBody(req);
        if (
          !body?.question ||
          typeof body.question !== 'string' ||
          !body.question.trim()
        ) {
          return send(res, 400, {
            ok: false,
            error: {
              code: 'invalid_question',
              message: 'A valid question string is required.',
            },
          });
        }

        try {
          const result = await sceneQa.ask({
            question: body.question,
            context: body.context,
            sceneId: body.sceneId,
            endpointId: body.endpointId,
            signal: controller.signal,
          });
          return send(res, 200, {
            ok: true,
            answer: result.answer,
            commands: result.commands,
            model: result.model,
          });
        } catch (err) {
          const status =
            err instanceof QaServiceError
              ? err.status
              : err?.status === 400 ||
                  err?.status === 429 ||
                  err?.status === 502 ||
                  err?.status === 503 ||
                  err?.status === 504
                ? err.status
                : 500;
          return send(res, status, {
            ok: false,
            error: {
              code: err.code || 'qa_failed',
              message: err.message || 'Scene Q&A failed.',
            },
          });
        }
      }

      if (path === '/director/stream' && req.method === 'POST') {
        const body = await readBody(req);

        // Validate prompt (3-6000 chars)
        if (
          !body?.prompt ||
          typeof body.prompt !== 'string' ||
          body.prompt.trim().length < 3 ||
          body.prompt.length > 6000
        ) {
          return send(res, 400, {
            ok: false,
            error: {
              code: 'invalid_prompt',
              message: 'Prompt must be a string between 3 and 6000 characters.',
            },
          });
        }

        // Validate origin
        const originRes = OriginSchema.safeParse(body?.origin);
        if (!originRes.success) {
          return send(res, 400, {
            ok: false,
            error: {
              code: 'invalid_origin',
              message:
                'Origin must have valid name, finite lat (-90..90), and finite lon (-180..180).',
              issues: originRes.error.issues,
            },
          });
        }

        const runId = body.runId || `run-${randomUUID()}`;
        const sceneId = body.sceneId || `scene-${randomUUID()}`;
        const mode = body.mode || RUNTIME_MODES.SIMULATION;

        const lastEventId =
          req.headers?.['last-event-id'] || body?.lastEventId || null;

        const stream = createSceneEventStream(res, {
          requestId: runId,
          lastEventId,
          signal: controller.signal,
        });

        if (stream.unavailable) return;

        let seq = 0;
        let sceneVersion = 0;
        let ttftMs = null;
        let firstSceneInstructionMs = null;
        let linesCount = 0;
        const startTime = Date.now();

        const emitWithEnvelope = (event, data) => {
          seq++;
          if (event === 'scene.patch') {
            sceneVersion++;
          }
          if (event === 'answer.delta' && ttftMs === null) {
            ttftMs = Date.now() - startTime;
          }
          if (
            (event === 'scene.object.created' || event === 'scene.patch') &&
            firstSceneInstructionMs === null
          ) {
            firstSceneInstructionMs = Date.now() - startTime;
          }
          if (
            event === 'scene.object.created' ||
            event === 'scene.patch' ||
            event === 'scene.planning'
          ) {
            linesCount++;
          }

          const correlation = {
            runId,
            sceneId,
            sceneVersion,
            seq,
          };

          const payload =
            data && typeof data === 'object' && !Array.isArray(data)
              ? { ...correlation, ...data }
              : { ...correlation, value: data };

          stream.emit(event, payload);
        };

        try {
          // 1. Emit run.started
          emitWithEnvelope('run.started', { mode });

          // 2. Direct scene
          const directResult = await dir.direct({
            prompt: body.prompt.trim(),
            origin: originRes.data,
            researchedRoutes: body.researchedRoutes || [],
            scenarioHint: body.scenarioHint,
            mode,
            durationHint: body.durationHint || 60,
            sceneId,
            runId,
            endpointId: body.endpointId,
            signal: controller.signal,
            emit: emitWithEnvelope,
          });

          const totalMs = Date.now() - startTime;

          // 3. Emit run.completed
          emitWithEnvelope('run.completed', {
            scene: directResult.scene,
            model: directResult.model,
            metrics: {
              ttftMs: ttftMs ?? directResult.model.ttftMs ?? 0,
              firstSceneInstructionMs: firstSceneInstructionMs ?? 0,
              totalMs,
              lines: linesCount,
              invalidLines: directResult.invalidLines?.length || 0,
              repairs: directResult.repairs || 0,
            },
          });
        } catch (error) {
          if (!controller.signal.aborted) {
            emitWithEnvelope('run.failed', {
              code: error?.code || 'director_failed',
              message:
                error?.message || 'Scene generation could not be completed.',
            });
          }
        } finally {
          stream.close();
        }
        return;
      }

      // 404 for unknown endpoint
      return send(res, 404, {
        ok: false,
        error: {
          code: 'not_found',
          message: `Unknown cinematic route: ${path}`,
        },
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      return send(res, err.statusCode || 500, {
        ok: false,
        error: {
          code: err.code || 'cinematic_service_error',
          message: err.message || 'The cinematic service encountered an error.',
        },
      });
    } finally {
      req.off?.('aborted', disconnected);
      res.off?.('close', disconnected);
    }
  };
}
