/** Shared, deterministic intent/place extraction. No provider calls or coordinates. */

export const CONVERSATIONAL_HINT = 'Type a place in the UAE — e.g. "Dubai Marina" or "Burj Khalifa incidents".';

function isCoordinates(text) {
  return /^\s*[+-]?\d+(?:\.\d+)?\s*[, ]\s*[+-]?\d+(?:\.\d+)?\s*$/.test(text);
}

const CONVERSATIONAL_EXACT = new Set([
  'hi',
  'hello',
  'hey',
  'hey there',
  'hi there',
  'hello there',
  'heya',
  'howdy',
  'hola',
  'yo',
  'sup',
  'whats up',
  'what s up',
  'how are you',
  'how are you doing',
  'how r u',
  'hows it going',
  'how is it going',
  'good morning',
  'good afternoon',
  'good evening',
  'good night',
  'good day',
  'thanks',
  'thank you',
  'thank you very much',
  'thanks a lot',
  'thx',
  'ty',
  'ok',
  'okay',
  'k',
  'cool',
  'nice',
  'great',
  'awesome',
  'yes',
  'no',
  'yep',
  'nope',
  'nah',
  'sure',
  'test',
  'testing',
  'help',
  'help me',
  'info',
  'bye',
  'goodbye',
  'see you',
  'cya',
  'who are you',
  'what are you',
  'what can you do',
  'please',
  'pls',
]);

const CONVERSATIONAL_PHRASE = /^(?:hi|hello|hey|heya|howdy|hola|yo|sup|thanks?|thank you|good (?:morning|afternoon|evening|night|day)|bye|goodbye)\b(?:\s+(?:there|friend|mate|bot|assistant|everyone|all))?$/i;

/** Check whether a query is conversational/greeting/non-place rather than a geographic target. */
export function isConversationalQuery(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return true;
  if (isCoordinates(raw)) return false;

  const letters = (raw.match(/[\p{L}]/gu) || []).length;
  if (letters < 2) return true;

  const clean = raw.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ').trim().replace(/\s+/g, ' ');
  if (CONVERSATIONAL_EXACT.has(clean)) return true;
  if (CONVERSATIONAL_PHRASE.test(clean)) return true;

  return false;
}

/**
 * Strips stray trailing fragments such as a lone single letter or punctuation/emoji
 * when the preceding text has at least one word of 3+ letters. Never strips digits.
 */
export function stripTrailingNoise(str) {
  let current = String(str || '').trim();

  while (true) {
    // 1. Strip trailing punctuation, symbols, emoji, whitespace
    const withoutPunct = current.replace(/[^\p{L}\p{N}]+$/u, '').trim();
    if (withoutPunct !== current && withoutPunct.length > 0) {
      current = withoutPunct;
    }

    // 2. Strip trailing lone single letter token (except digits)
    // when the preceding text has at least one word of 3+ letters.
    const letterMatch = current.match(/\s+([a-zA-Z])$/i);
    if (letterMatch) {
      const preceding = current.slice(0, letterMatch.index).trim();
      const words = preceding.match(/[\p{L}\p{N}]+/gu) || [];
      const hasWordOf3PlusLetters = words.some((w) => /[\p{L}]{3,}/u.test(w));
      const hasMinLength = preceding.length >= 4 || words.length >= 2;

      if (hasWordOf3PlusLetters && hasMinLength) {
        current = preceding;
        continue;
      }
    }

    break;
  }

  const originalTrimmed = String(str || '').trim();
  const noiseStripped = current !== originalTrimmed;
  const strippedNoise = noiseStripped ? originalTrimmed.slice(current.length).trim() : undefined;

  return { clean: current, noiseStripped, strippedNoise };
}

export function parseIncidentQuery(value, { defaultIntent = 'incident_search' } = {}) {
  const text = String(value || '')
    .trim()
    .slice(0, 500);

  const noise = stripTrailingNoise(text);
  const cleanText = noise.clean;

  // Only descriptors immediately before "scene" belong to the command.
  // Keep connectors out of the descriptor so a location is never consumed.
  const sceneCommand = cleanText.match(
    /\b(?:build|generate|create)\s+(?:(?:a|an|the)\s+)?((?:(?!\b(?:scene|of|for|at|near|around|in|off)\b)[\w-]+\s+){0,8})scene\b/i,
  );
  const explicitScene =
    Boolean(sceneCommand) || /\b(?:rebuild|reconstruct|replay)\b/i.test(cleanText);
  let sceneStyle = sceneCommand?.[1].trim().toLowerCase() || undefined;
  const asksSearch =
    /\b(?:check|search|find|look\s+for|are\s+there|is\s+there|any\s+incidents?|what\s+happened)\b/i.test(
      cleanText,
    );
  const describesEvent =
    /\b(?:crash|collision|accident|fire|explosion|strike|rupture|incursion|flood|attack|bomb|threat|hotspot|seizure|protest)\b/i.test(
      cleanText,
    );
  let place = sceneCommand
    ? cleanText.slice(sceneCommand.index + sceneCommand[0].length).trim()
    : cleanText;
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
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .trim();
  // The AOI form's action is BUILD SCENE. A bare place there is a geographic
  // request, while explicit incident questions still search. Other callers keep
  // their historical search default; no coordinates or incident are invented.
  const intent =
    explicitScene || (!asksSearch && (describesEvent || sceneStyle || defaultIntent === 'build_scene'))
      ? 'build_scene'
      : 'incident_search';
  const hours = cleanText.match(
    /\b(?:last|past)\s+(\d+)\s*(hours?|hrs?|h|days?|d)\b/i,
  );
  const windowHours = hours
    ? Math.max(
        1,
        Math.min(168, Number(hours[1]) * (/^d/i.test(hours[2]) ? 24 : 1)),
      )
    : 72;
  const kind = isConversationalQuery(text) ? 'conversational' : 'place';

  return {
    originalText: text,
    place: place || cleanText || text,
    intent,
    kind,
    radiusKm: 5,
    windowHours,
    ...(sceneStyle ? { sceneStyle } : {}),
    ...(noise.noiseStripped
      ? { noiseStripped: true, strippedNoise: noise.strippedNoise }
      : { noiseStripped: false }),
  };
}
