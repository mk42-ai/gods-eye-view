/** Explicit Snapchat access, independent from the automatic three-platform evidence lane. */
export function snapchatRequestForScene(
  scene,
  { mode = 'strict', now = () => new Date() } = {},
) {
  const anchor = scene?.anchor;
  if (!anchor || !Number.isFinite(anchor.lat) || !Number.isFinite(anchor.lon))
    return null;
  const selected = scene.selectedTime || {};
  if (mode !== 'place-mentions' && selected.timeMode === 'historical') {
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
    ...(mode === 'place-mentions'
      ? {
          strictBounds: false,
          timeWindow: null,
          scopeDisclosure:
            'Public place-name mentions only; capture time and location are unverified.',
        }
      : { strictBounds: true, radius: 1, timeWindow }),
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
    ['strict', 'Strict · 1 km + selected UTC recording window'],
    ['place-mentions', 'Place mentions · time/location unverified'],
  ]) {
    const option = doc.createElement('option');
    option.value = value;
    option.textContent = text;
    scope.appendChild(option);
  }
  scope.value = 'strict';
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
    note.textContent =
      scope.value === 'place-mentions'
        ? 'Unverified place mentions: no capture-time or distance claim. Changing this option does not search and never affects scene building.'
        : 'Strict bounds apply only to Snapchat results (they reject clips with unknown capture time or coordinates) and never affect scene building. The current Spotlight provider may return no qualifying records.';
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
