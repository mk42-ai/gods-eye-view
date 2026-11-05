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

/** Physical host indices. The service must resolve these to UUID + PCI identity. */
export const ALLOWED_RENDER_GPUS = Object.freeze(['2', '6']);

/** Fail closed if the allowlist cannot be verified; absence is not permission. */
export function gpuPolicyViolations(health) {
  const gpus = Array.isArray(health?.gpus) ? health.gpus.map(String) : [];
  if (!gpus.length) return ['unverified_gpu_inventory'];
  const violations = gpus.filter((g) => !ALLOWED_RENDER_GPUS.includes(g));
  for (const expected of ALLOWED_RENDER_GPUS) {
    if (!gpus.includes(expected))
      violations.push(`missing_physical_gpu_${expected}`);
  }
  if (health?.gpu_policy?.backend && health.gpu_policy.backend !== 'OPTIX')
    violations.push('optix_required');
  if (
    health?.gpu_policy?.cpu_rendering === true ||
    health?.gpu_policy?.cpu_enabled === true
  )
    violations.push('cpu_rendering_forbidden');
  return violations;
}
