/** Explicit Snapchat access, independent from the automatic three-platform evidence lane. */
export function snapchatRequestForScene(
  scene,
  { mode = 'strict', scope = null, now = () => new Date() } = {},
) {
  const anchor = scene?.anchor;
  if (!anchor || !Number.isFinite(anchor.lat) || !Number.isFinite(anchor.lon))
    return null;

  const rawScope = scope || mode;
  let effectiveScope = 'strict';
  if (rawScope === 'place-mentions' || rawScope === 'balanced') {
    effectiveScope = 'balanced';
  } else if (rawScope === 'wide') {
    effectiveScope = 'wide';
  } else if (rawScope === 'strict') {
    effectiveScope = 'strict';
  }

  const selected = scene.selectedTime || {};
  if (effectiveScope === 'strict' && selected.timeMode === 'historical') {
    const start = Date.parse(selected.windowStart || '');
    const end = Date.parse(selected.windowEnd || '');
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start ||
      end > now().getTime()
    )
      return null;
  }

  if (effectiveScope === 'wide') {
    let timeWindow = null;
    if (selected.timeMode === 'historical') {
      const s = Date.parse(selected.windowStart || '');
      const e = Date.parse(selected.windowEnd || '');
      if (Number.isFinite(s) && Number.isFinite(e) && e > s) {
        const span = e - s;
        timeWindow = {
          windowStart: new Date(s - span * 2).toISOString(),
          windowEnd: new Date(e).toISOString(),
          strictCaptureTime: false,
        };
      }
    } else {
      timeWindow = {
        windowHours: (Number(selected.windowHours) || 1) * 3,
        strictCaptureTime: false,
      };
    }
    return {
      trigger: 'explicit',
      lat: anchor.lat,
      lon: anchor.lon,
      placeName: anchor.name || scene.title || '',
      text: anchor.name || scene.title || '',
      sceneId: scene.id,
      clientTimeIso: now().toISOString(),
      scope: 'wide',
      strictBounds: false,
      radius: 5,
      timeWindow,
      scopeDisclosure:
        'Wide search (5 km radius, window ×3, transliterations); capture time and location unverified.',
    };
  }

  if (effectiveScope === 'balanced') {
    return {
      trigger: 'explicit',
      lat: anchor.lat,
      lon: anchor.lon,
      placeName: anchor.name || scene.title || '',
      text: anchor.name || scene.title || '',
      sceneId: scene.id,
      clientTimeIso: now().toISOString(),
      scope: 'balanced',
      strictBounds: false,
      timeWindow: null,
      scopeDisclosure:
        'Public place-name mentions only; capture time and location are unverified.',
    };
  }

  const timeWindow =
    selected.timeMode === 'historical'
      ? {
          windowStart: selected.windowStart,
          windowEnd: selected.windowEnd,
          strictCaptureTime: true,
        }
      : {
          windowHours: Number(selected.windowHours) || 1,
          strictCaptureTime: true,
        };
  return {
    trigger: 'explicit',
    lat: anchor.lat,
    lon: anchor.lon,
    placeName: anchor.name || scene.title || '',
    text: anchor.name || scene.title || '',
    sceneId: scene.id,
    clientTimeIso: now().toISOString(),
    scope: 'strict',
    strictBounds: true,
    radius: 1,
    timeWindow,
  };
}

export function createSceneFootageControls({
  document: doc = globalThis.document,
  window: win = globalThis.window,
} = {}) {
  let currentScene = null;
  // Snapchat discovery is OPTIONAL and fully separate from scene building:
  // collapsed by default, never consulted by Build scene, and its strict
  // bounds filter only Snapchat results.
  const root = doc.createElement('details');
  root.className = 'scene-snapchat-controls';
  root.id = 'scene-snapchat-controls';
  root.setAttribute('aria-label', 'Optional Snapchat discovery');
  root.setAttribute('data-affects-scene-build', 'false');
  root.open = false;
  const summary = doc.createElement('summary');
  summary.className = 'scene-snapchat-controls__summary';
  summary.textContent =
    'Optional · Snapchat discovery (separate from scene build)';
  const label = doc.createElement('label');
  label.textContent = 'Snapchat scope ';
  label.htmlFor = 'scene-snapchat-scope';
  const scope = doc.createElement('select');
  scope.id = 'scene-snapchat-scope';
  scope.setAttribute('aria-label', 'Snapchat matching policy');
  for (const [value, text] of [
    ['balanced', 'Balanced · candidates shown + playable (unverified)'],
    ['strict', 'Strict · 1 km + selected UTC recording window'],
    ['wide', 'Wide · 5 km radius, window ×3, transliterations'],
    ['place-mentions', 'Place mentions · time/location unverified'],
  ]) {
    const option = doc.createElement('option');
    option.value = value;
    option.textContent = text;
    scope.appendChild(option);
  }
  scope.value = 'balanced';
  const button = doc.createElement('button');
  button.id = 'scene-snapchat-discover';
  button.type = 'button';
  button.className = 'sfp__btn';
  button.setAttribute('data-snapchat-discovery', 'explicit');
  button.textContent = 'Discover Snapchat';
  button.disabled = true;
  button.title =
    'Construct a scene first. Snapchat is a separate, explicit public-source lookup.';
  const note = doc.createElement('span');
  note.id = 'scene-snapchat-scope-note';
  note.className = 'scene-snapchat-controls__note';
  note.setAttribute('role', 'status');
  function describe() {
    if (scope.value === 'strict') {
      note.textContent =
        'Strict bounds apply only to Snapchat results (they reject clips with unknown capture time or coordinates) and never affect scene building. The current Spotlight provider may return no qualifying records.';
    } else if (scope.value === 'wide') {
      note.textContent =
        'Wide scope applies only to Snapchat results: a 5 km radius, a longer recording window and more name variants (incl. transliterations). Clips are unverified candidates; scope changes never affect scene building.';
    } else {
      note.textContent =
        'Balanced scope applies only to Snapchat results: place-name mentions are shown as playable candidate clips labelled unverified (capture time and location unproven). Scope changes never affect scene building.';
    }
  }
  function search() {
    if (button.disabled) return;
    const detail = snapchatRequestForScene(currentScene, { mode: scope.value });
    if (detail)
      win.dispatchEvent(
        new (win.CustomEvent || CustomEvent)('gev:scene-footage', { detail }),
      );
  }
  scope.addEventListener('change', describe);
  button.addEventListener('click', search);
  label.appendChild(scope);
  root.append(summary, label, button, note);
  describe();
  return {
    element: root,
    setScene(scene) {
      currentScene = scene;
      button.disabled = !snapchatRequestForScene(scene);
    },
    destroy() {
      scope.removeEventListener('change', describe);
      button.removeEventListener('click', search);
      root.remove();
    },
  };
}
