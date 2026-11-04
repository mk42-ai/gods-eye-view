/**
 * Prompt-derived seed for the Blender scene-spec.
 *
 * Every Build sends `seed` = first 32 bits (masked to 31) of sha256 over the
 * whitespace/case-normalised prompt. The render service recomputes the same
 * value (render_service/pipeline.py prompt_seed) and uses it for asset
 * placement jitter and the camera orbit phase, so each prompt yields a unique
 * but reproducible staging. Keep both implementations in sync.
 */
import { createHash } from 'node:crypto';

export function normalisePrompt(prompt) {
  return String(prompt ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function promptHash(prompt) {
  return createHash('sha256')
    .update(normalisePrompt(prompt), 'utf8')
    .digest('hex');
}

export function promptSeed(prompt) {
  return Number.parseInt(promptHash(prompt).slice(0, 8), 16) & 0x7fffffff;
}

/** GPUs Blender may use (PCI_BUS_ID order). 0,3,4,5 = DeepSeek pods, 1 = Gemma. */
export const ALLOWED_RENDER_GPUS = Object.freeze(['2', '6']);

/** Returns the list of advertised GPUs that violate the policy (empty = OK). */
export function gpuPolicyViolations(health) {
  const gpus = Array.isArray(health?.gpus) ? health.gpus.map(String) : [];
  return gpus.filter((g) => !ALLOWED_RENDER_GPUS.includes(g));
}
