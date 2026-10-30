// Diagnostic-only text; credentials and signed URLs never cross the boundary.
export function sanitizeDiagnostic(value, env = process.env) {
  let text = String(value?.message || value || '');
  for (const [name, secret] of Object.entries(env)) {
    if (/(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name) && typeof secret === 'string' && secret.length >= 6) text = text.split(secret).join('[redacted]');
  }
  return text.replace(/https?:\/\/[^\s"'<>]+/g, (s) => {
    try { const u = new URL(s); return `${u.protocol}//${u.host}${u.pathname}`; } catch { return '[url]'; }
  }).replace(/(?:Bearer\s+)[^\s"',}]+/gi, 'Bearer [redacted]')
    .replace(/((?:api[_-]?key|access[_-]?token|token|secret|password|authorization)["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1[redacted]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted-token]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 240);
}
export function providerFailure(error, env) {
  const text = sanitizeDiagnostic(error, env);
  const status = Number(error?.status) || null;
  const state = error?.state || (status === 401 || status === 403 ? 'credentials_required' : status === 429 ? 'quota' : /timeout|budget/i.test(text) ? 'timeout' : /abort/i.test(text) ? 'cancelled' : 'error');
  return { state, status, note: text || 'Provider request failed' };
}
