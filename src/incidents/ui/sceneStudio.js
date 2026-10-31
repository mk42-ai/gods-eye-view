import { describeGeometry } from '../../scenes/sceneGeometry.js';
/** Scene-aware controls. All descriptions are derived from the committed plan,
 * never from retrieved footage or an alleged real incident. */
export const DEFAULT_NARRATION_CONFIG = Object.freeze({
  voiceId: 'JBFqnCBsd6RMkjVDRZzb',
  modelId: 'eleven_multilingual_v2',
  stability: 0.5,
  similarity_boost: 0.75,
  speed: 1,
  style: 0,
  use_speaker_boost: true,
  autoGenerate: false,
});

export function planOf(scene) {
  return scene?.structuredPlan || scene?.plan || null;
}
export function describeConstructedScene(scene) {
  const plan = planOf(scene);
  if (!plan)
    return 'This saved legacy scene has no structured entity plan. Rebuild it to use scene-aware refinements and narration.';
  const entities = (plan.entities || [])
    .map(
      (e) =>
        `${e.quantity} ${e.label || e.type} (${e.type}) at ${e.position.eastM} m east, ${e.position.northM} m north`,
    )
    .join('; ');
  const beats = (plan.beats || [])
    .map((b) => `${b.atSec}s: ${b.title}`)
    .join('; ');
  const research = scene?.geometry
    ? ` ${describeGeometry(scene.geometry)}`
    : '';
  return `Illustrative staging, not a confirmed incident. ${plan.title}. Location: ${scene.anchor?.name || plan.location.name}. Duration: ${plan.durationSec} seconds. Entities: ${entities || 'none'}. Camera: ${plan.camera.framing}, ${plan.camera.distanceM} m distance, heading ${plan.camera.heading}°, pitch ${plan.camera.pitch}°. Timed beats: ${beats}.${research}`;
}
export function measuredNarrationFit(duration, sceneDuration) {
  if (!(
    Number.isFinite(duration) &&
    duration > 0 &&
    Number.isFinite(sceneDuration) &&
    sceneDuration > 0
  ))
    return null;
  const rate = duration / sceneDuration;
  return {
    measuredDurationSec: duration,
    sceneDurationSec: sceneDuration,
    rate,
    canFit: rate >= 0.5 && rate <= 2,
  };
}
const safeLink = (value) => {
  try {
    const u = new URL(
      value,
      globalThis.location?.origin || 'https://local.invalid',
    );
    return ['https:', 'http:'].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
};

export function createSceneStudio({
  document: doc = globalThis.document,
  window: win = globalThis.window,
  onRefine,
  onNarration,
  onStateChange,
  onPlay,
  onPause,
} = {}) {
  let scene = null,
    generation = 0,
    controller = null,
    history = [],
    config = { ...DEFAULT_NARRATION_CONFIG };
  let measured = null,
    narration = null,
    destroyed = false;
  const cleanups = [];
  const el = (tag, className, text) => {
    const n = doc.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const listen = (n, name, fn) => {
    n.addEventListener(name, fn);
    cleanups.push(() => n.removeEventListener(name, fn));
  };
  const root = el('section', 'scene-studio');
  root.id = 'scene-studio';
  root.hidden = true;
  root.setAttribute(
    'aria-label',
    'Constructed scene, chat, cameras and narration',
  );
  root.append(el('h2', 'scene-studio__heading', 'Constructed scene'));
  root.append(
    el(
      'p',
      'scene-studio__notice',
      'Illustrative staging · not an asserted real incident',
    ),
  );
  const status = el('p', 'scene-studio__status');
  status.id = 'scene-studio-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const description = el('p', 'scene-studio__description');
  description.id = 'scene-studio-description';
  const entities = el('ul', 'scene-studio__entities');
  entities.id = 'scene-studio-entities';
  const beats = el('ol', 'scene-studio__beats');
  beats.id = 'scene-studio-beats';
  const sources = el('div', 'scene-studio__sources');
  sources.id = 'scene-studio-citations';
  const cameraHost = el('div', 'scene-studio__camera-host');
  cameraHost.id = 'scene-studio-camera-host';
  root.append(status, description, entities, beats, sources, cameraHost);

  const chat = el('section', 'scene-studio__chat');
  chat.setAttribute('aria-label', 'Scene-aware chat');
  chat.append(el('h3', '', 'Ask or refine this scene'));
  const log = el('div', 'scene-studio__chat-log');
  log.id = 'scene-studio-chat-log';
  log.setAttribute('aria-live', 'polite');
  const describe = el('button', '', 'Describe constructed scene');
  describe.type = 'button';
  describe.id = 'scene-studio-describe';
  const form = el('form', 'scene-studio__chat-form');
  const input = el('textarea', 'scene-studio__chat-input');
  input.id = 'scene-studio-chat-input';
  input.rows = 2;
  input.maxLength = 2000;
  input.placeholder =
    'Ask about the constructed entities, or refine their positions, duration and framing';
  input.setAttribute('aria-label', 'Question or scene refinement');
  const refine = el('button', '', 'Apply refinement');
  refine.type = 'submit';
  refine.id = 'scene-studio-refine';
  form.append(input, refine);
  chat.append(describe, log, form);
  root.append(chat);

  const voice = el('section', 'scene-studio__narration');
  voice.append(el('h3', '', 'Scene narration · ElevenLabs'));
  const voiceLabel = el('label', '', 'Voice ID');
  const voiceInput = el('input');
  voiceInput.value = config.voiceId;
  voiceInput.id = 'scene-narration-voice';
  voiceInput.maxLength = 80;
  voiceLabel.htmlFor = voiceInput.id;
  const modelLabel = el('label', '', 'Model');
  const modelInput = el('select');
  modelInput.id = 'scene-narration-model';
  modelLabel.htmlFor = modelInput.id;
  for (const value of [
    'eleven_multilingual_v2',
    'eleven_turbo_v2_5',
    'eleven_flash_v2_5',
  ]) {
    const option = el('option', '', value);
    option.value = value;
    modelInput.append(option);
  }
  modelInput.value = config.modelId;
  const generate = el('button', '', 'Generate narration');
  generate.type = 'button';
  generate.id = 'scene-narration-generate';
  const audio = el('audio');
  audio.id = 'scene-narration-audio';
  audio.controls = true;
  audio.preload = 'metadata';
  audio.setAttribute('aria-label', 'Current scene narration audio');
  const play = el('button', '', 'Play with scene');
  play.type = 'button';
  play.id = 'scene-narration-play';
  play.disabled = true;
  const pause = el('button', '', 'Pause');
  pause.type = 'button';
  pause.id = 'scene-narration-pause';
  pause.disabled = true;
  const mute = el('button', '', 'Mute');
  mute.type = 'button';
  mute.id = 'scene-narration-mute';
  mute.setAttribute('aria-pressed', 'false');
  const voiceStatus = el(
    'p',
    'scene-studio__status',
    'Generate audio for the completed scene. No sample soundtrack is substituted.',
  );
  voiceStatus.id = 'scene-narration-status';
  voiceStatus.setAttribute('role', 'status');
  voiceStatus.setAttribute('aria-live', 'polite');
  voice.append(
    voiceLabel,
    voiceInput,
    modelLabel,
    modelInput,
    generate,
    audio,
    play,
    pause,
    mute,
    voiceStatus,
  );
  root.append(voice);
  root.append(
    el(
      'p',
      'scene-studio__notice',
      'Social footage is separate evidence: YouTube, TikTok and Instagram only, requested after successful construction. It is neither CCTV nor generated staging.',
    ),
  );

  function renderHistory() {
    log.replaceChildren();
    for (const item of history.slice(-40)) {
      const p = el(
        'p',
        `scene-studio__message scene-studio__message--${item.role}`,
        `${item.role === 'user' ? 'You' : 'Scene'}: ${item.text}`,
      );
      log.append(p);
    }
  }
  function snapshot() {
    return {
      chat: history.map((m) => ({ ...m })),
      narrationConfig: { ...config },
    };
  }
  function changed() {
    onStateChange?.(snapshot());
  }
  function clearAudio() {
    controller?.abort();
    controller = null;
    narration = null;
    measured = null;
    audio.pause?.();
    audio.removeAttribute('src');
    delete audio.dataset.generation;
    audio.load?.();
    play.disabled = pause.disabled = true;
    root.dataset.audioState = 'idle';
    delete root.dataset.measuredDuration;
  }
  function invalidate() {
    generation++;
    clearAudio();
    generate.disabled = true;
    refine.disabled = true;
    status.textContent =
      'Prompt changed. Previous scene media is invalidated while the current revision is being constructed.';
  }
  function setScene(next) {
    generation++;
    clearAudio();
    scene = next;
    root.hidden = !next;
    root.dataset.sceneId = next?.id || '';
    if (!next) return;
    const plan = planOf(next);
    config = { ...DEFAULT_NARRATION_CONFIG, ...(next.narrationConfig || {}) };
    history = Array.isArray(next.chat)
      ? next.chat
          .slice(-40)
          .filter(
            (m) =>
              ['user', 'assistant'].includes(m.role) &&
              typeof m.text === 'string',
          )
          .map((m) => ({ role: m.role, text: m.text.slice(0, 8000) }))
      : [];
    voiceInput.value = config.voiceId;
    modelInput.value = config.modelId;
    audio.muted = Boolean(config.muted);
    mute.textContent = audio.muted ? 'Unmute' : 'Mute';
    mute.setAttribute('aria-pressed', String(audio.muted));
    description.textContent = describeConstructedScene(next);
    entities.replaceChildren();
    beats.replaceChildren();
    sources.replaceChildren();
    for (const e of plan?.entities || [])
      entities.append(
        el(
          'li',
          '',
          `${e.quantity} × ${e.label || e.type} · ${e.position.eastM} m east / ${e.position.northM} m north`,
        ),
      );
    for (const b of plan?.beats || [])
      beats.append(
        el(
          'li',
          '',
          `${b.atSec}s — ${b.title}${b.narration ? ': ' + b.narration : ''}`,
        ),
      );
    const seenSources = new Set();
    for (const c of [
      ...(next.citations || plan?.citations || []),
      ...(next.geometry?.citations || []),
    ]) {
      const href = safeLink(c.url);
      if (!href || seenSources.has(href)) continue;
      seenSources.add(href);
      const a = el('a', '', c.title || c.url);
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      sources.append(a);
    }
    status.textContent = plan
      ? 'Current scene constructed and schema-validated. All generated entity placements are illustrative.'
      : 'Legacy geographic scene; rebuild to construct an entity plan.';
    voiceStatus.textContent =
      'Narration is not generated yet. Playback and timing are verified only after real audio is loaded.';
    generate.disabled = !plan;
    refine.disabled = !plan;
    renderHistory();
  }
  listen(describe, 'click', () => {
    if (!scene) return;
    history.push({ role: 'assistant', text: describeConstructedScene(scene) });
    renderHistory();
    changed();
  });
  listen(form, 'submit', async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || !scene || !planOf(scene)) return;
    history.push({ role: 'user', text });
    input.value = '';
    renderHistory();
    changed();
    // Answers about the committed model require no speculative web research.
    if (
      /^(?:what|where|how many|describe|explain|list|which|when)\b/i.test(
        text,
      ) &&
      !/\b(?:change|move|add|remove|make|set|increase|reduce)\b/i.test(text)
    ) {
      history.push({
        role: 'assistant',
        text: describeConstructedScene(scene),
      });
      renderHistory();
      changed();
      return;
    }
    const current = ++generation;
    refine.disabled = true;
    status.textContent =
      'Applying refinement through the validated construction pipeline…';
    try {
      const result = await onRefine?.({
        text,
        scene,
        chat: history.map((m) => ({ ...m })),
      });
      if (destroyed || current !== generation) return;
      if (!result)
        status.textContent =
          'Refinement was not committed; inspect the composer for the current validation or provider error.';
    } catch (error) {
      if (current === generation)
        status.textContent = `Refinement failed: ${error.message}`;
    } finally {
      if (current === generation) refine.disabled = !planOf(scene);
    }
  });
  for (const n of [voiceInput, modelInput])
    listen(n, 'change', () => {
      config = {
        ...config,
        voiceId: voiceInput.value.trim(),
        modelId: modelInput.value,
      };
      generation++;
      clearAudio();
      generate.disabled = !planOf(scene);
      changed();
    });
  listen(generate, 'click', async () => {
    if (!scene || !planOf(scene) || !onNarration) return;
    const current = ++generation;
    clearAudio();
    controller = new AbortController();
    const abort = controller;
    generate.disabled = true;
    root.dataset.audioState = 'loading';
    voiceStatus.textContent = 'Generating scene-specific speech on the server…';
    try {
      const result = await onNarration(
        scene,
        { ...config },
        { signal: abort.signal },
      );
      if (destroyed || current !== generation || abort.signal.aborted) return;
      const url = safeLink(
        result?.audioUrl ||
          result?.url ||
          result?.audio?.url ||
          result?.mediaUrl,
      );
      if (!url)
        throw new Error(
          result?.message || 'Provider did not return a playable audio asset.',
        );
      narration = result;
      audio.dataset.generation = String(current);
      audio.src = url;
      audio.load?.();
      root.dataset.audioState = 'loading-metadata';
      voiceStatus.textContent =
        'Real provider audio received. Waiting for measured browser duration; synchronization is not yet verified.';
    } catch (error) {
      if (current === generation && !abort.signal.aborted) {
        root.dataset.audioState = 'error';
        voiceStatus.textContent = `Narration unavailable: ${error.message}`;
      }
    } finally {
      if (current === generation) generate.disabled = !planOf(scene);
    }
  });
  listen(audio, 'loadedmetadata', () => {
    if (!scene || !narration || audio.dataset.generation !== String(generation))
      return;
    measured = measuredNarrationFit(audio.duration, planOf(scene)?.durationSec);
    if (!measured) {
      voiceStatus.textContent =
        'Audio duration could not be measured; synchronized playback is disabled.';
      return;
    }
    root.dataset.audioState = 'ready';
    root.dataset.measuredDuration = String(measured.measuredDurationSec);
    play.disabled = false;
    pause.disabled = false;
    voiceStatus.textContent = `Measured audio ${measured.measuredDurationSec.toFixed(2)}s; scene ${measured.sceneDurationSec}s. ${measured.canFit ? 'Duration-fit playback is available. Word-to-beat alignment remains unverified unless provider timestamps are present.' : 'Duration mismatch exceeds the safe playback-rate range; narration plays independently.'}`;
  });
  listen(audio, 'error', () => {
    if (!narration || audio.dataset.generation !== String(generation)) return;
    root.dataset.audioState = 'error';
    play.disabled = pause.disabled = true;
    voiceStatus.textContent =
      'Audio could not be loaded or decoded. No fallback sample was used.';
  });
  listen(play, 'click', async () => {
    if (!measured || !scene) return;
    const current = generation;
    const playingScene = scene;
    try {
      audio.currentTime = 0;
      audio.playbackRate = measured.canFit ? measured.rate : 1;
      const fit = measured;
      await audio.play();
      if (
        destroyed ||
        current !== generation ||
        playingScene !== scene ||
        !narration
      ) {
        audio.pause();
        return;
      }
      if (fit.canFit) onPlay?.(playingScene);
      root.dataset.audioState = 'playing';
    } catch (error) {
      if (current === generation && !destroyed)
        voiceStatus.textContent = `Playback blocked: ${error.message}`;
    }
  });
  listen(pause, 'click', () => {
    audio.pause();
    onPause?.();
    root.dataset.audioState = 'paused';
  });
  listen(mute, 'click', () => {
    audio.muted = !audio.muted;
    mute.textContent = audio.muted ? 'Unmute' : 'Mute';
    mute.setAttribute('aria-pressed', String(audio.muted));
    config = { ...config, muted: audio.muted };
    changed();
  });
  listen(audio, 'ended', () => {
    root.dataset.audioState = 'ended';
  });
  return {
    element: root,
    cameraHost,
    setScene,
    invalidate,
    getSnapshot: snapshot,
    getState: () => ({
      sceneId: scene?.id || null,
      revision: generation,
      hasPlan: Boolean(planOf(scene)),
      chat: history,
      narrationConfig: config,
      audioState: root.dataset.audioState,
      measured,
      audio: {
        paused: audio.paused,
        muted: audio.muted,
        currentTime: audio.currentTime,
        readyState: audio.readyState,
      },
    }),
    setStatus: (text) => {
      status.textContent = text;
    },
    destroy() {
      destroyed = true;
      invalidate();
      cleanups.forEach((f) => f());
      root.remove();
    },
  };
}
