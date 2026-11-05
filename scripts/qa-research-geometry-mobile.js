window.__gevMobile = (async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 240 && !(window.__gevIncidents?.composer && document.querySelector('#incident-composer-input')); i++) await wait(500);
  await wait(3000);
  const api = window.__gevIncidents, input = document.querySelector('#incident-composer-input'), form = document.querySelector('#incident-composer');
  let calls = 0; const orig = api.client.constructScene;
  api.client.constructScene = async function (...a) { calls++; return orig.apply(this, a); };
  const out = { startedAtUtc: new Date().toISOString() };
  try {
    input.value = 'Location: Burj Khalifa\nHypothetical illustrative visitor gathering at the Burj Khalifa and Dubai Mall forecourt.';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
    await wait(1500);
    out.callsAfterPaste = calls;
    document.querySelector('#incident-composer-submit svg').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const t = Date.now();
    await wait(400);
    while (Date.now() - t < 290000 && !(!api.composer.state.busy && ['done', 'error'].includes(form.dataset.state))) await wait(400);
    const g = api.getState().sceneGeometry; const legend = document.querySelector('#scene-geometry-legend'); const r = legend?.getBoundingClientRect();
    Object.assign(out, { calls, state: form.dataset.state, status: g?.status, points: g?.points?.length, lines: g?.lines?.length, areas: g?.areas?.length, citations: g?.citations?.length,
      legend: r ? { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) } : null, innerWidth, innerHeight, scrollWidth: document.documentElement.scrollWidth });
    out.ok = calls === 1 && out.callsAfterPaste === 0 && form.dataset.state === 'done' && r && r.left >= 0 && r.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth;
  } catch (e) { out.error = String(e); out.ok = false; }
  finally { api.client.constructScene = orig; out.finishedAtUtc = new Date().toISOString(); window.__gevMobileResult = out; }
  return out.ok;
})();
true;
