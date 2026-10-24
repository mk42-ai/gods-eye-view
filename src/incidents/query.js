/** Shared, deterministic intent/place extraction. No provider calls or coordinates. */
export function parseIncidentQuery(value, { defaultIntent = 'incident_search' } = {}) {
  const text = String(value || '')
    .trim()
    .slice(0, 500);
  // Only descriptors immediately before "scene" belong to the command.
  // Keep connectors out of the descriptor so a location is never consumed.
  const sceneCommand = text.match(
    /\b(?:build|generate|create)\s+(?:(?:a|an|the)\s+)?((?:(?!\b(?:scene|of|for|at|near|around|in|off)\b)[\w-]+\s+){0,8})scene\b/i,
  );
  const explicitScene =
    Boolean(sceneCommand) || /\b(?:rebuild|reconstruct|replay)\b/i.test(text);
  let sceneStyle = sceneCommand?.[1].trim().toLowerCase() || undefined;
  const asksSearch =
    /\b(?:check|search|find|look\s+for|are\s+there|is\s+there|any\s+incidents?|what\s+happened)\b/i.test(
      text,
    );
  const describesEvent =
    /\b(?:crash|collision|accident|fire|explosion|strike|rupture|incursion|flood|attack|bomb|threat|hotspot|seizure|protest)\b/i.test(
      text,
    );
  let place = sceneCommand
    ? text.slice(sceneCommand.index + sceneCommand[0].length).trim()
    : text;
  // Place-first questions: "Burj Khalifa check if there is any incidents".
  const suffix = place.search(
    /\s+\b(?:check|search|find|look\s+for|are\s+there|is\s+there|what\s+happened)\b/i,
  );
  if (suffix > 0) place = place.slice(0, suffix);
  // An explicit style suffix is not part of a landmark's name. Require a
  // scene/camera noun; ordinary dashed place names remain untouched.
  const styleSuffix = place.match(/\s+(?:[—–|]|-)\s+(.+)$/);
  if (
    styleSuffix &&
    /\b(?:scene|orbit|flyover|flythrough|fly-through|panorama)(?:\s+scene)?$/i.test(
      styleSuffix[1],
    )
  ) {
    sceneStyle = styleSuffix[1].replace(/\s+scene$/i, '').trim().toLowerCase();
    place = place.slice(0, styleSuffix.index);
  }
  // Strip time windows before locating connectors: in "X in the last 24
  // hours", the word "in" introduces a time, not a different place.
  place = place.replace(
    /\s+(?:in\s+the\s+)?(?:last|past)\s+\d+\s*(?:hours?|hrs?|h|days?|d)\b.*$/i,
    '',
  );
  if (sceneCommand) place = place.replace(/^(?:of|for)\s+/i, '');
  // Intent-first questions and descriptions: "incidents near X", "fire at X".
  const located = place.match(/\b(?:at|near|around|in|off)\s+(.+)$/i);
  if (located) place = located[1];
  place = place
    .replace(
      /^(?:check|search|find|look\s+for)\s+(?:for\s+)?(?:any\s+)?(?:incidents?\s+(?:at|near|around|in)\s+)?/i,
      '',
    )
    .replace(/\s+(?:incidents?|please)$/i, '')
    .replace(
      /\s+(?:in\s+the\s+)?(?:last|past)\s+\d+\s*(?:hours?|hrs?|h|days?|d)\b.*$/i,
      '',
    )
    .replace(/^[\s,;:!?]+|[\s,;:!?]+$/g, '')
    .trim();
  // The AOI form's action is BUILD SCENE. A bare place there is a geographic
  // request, while explicit incident questions still search. Other callers keep
  // their historical search default; no coordinates or incident are invented.
  const intent =
    explicitScene || (!asksSearch && (describesEvent || sceneStyle || defaultIntent === 'build_scene'))
      ? 'build_scene'
      : 'incident_search';
  const hours = text.match(
    /\b(?:last|past)\s+(\d+)\s*(hours?|hrs?|h|days?|d)\b/i,
  );
  const windowHours = hours
    ? Math.max(
        1,
        Math.min(168, Number(hours[1]) * (/^d/i.test(hours[2]) ? 24 : 1)),
      )
    : 72;
  return {
    originalText: text,
    place: place || text,
    intent,
    radiusKm: 5,
    windowHours,
    ...(sceneStyle ? { sceneStyle } : {}),
  };
}
