window.__qaRun = (async () => {
  const PROMPT = window.__QA_PROMPT || "Kane's Boxing Gym Abu Dhabi";
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 240 && !(window.__gevIncidents?.composer && document.querySelector('#incident-composer-input')); i++) await wait(500);
  await wait(2500);
  const api = window.__gevIncidents;
  const input = document.querySelector('#incident-composer-input');
  const form = document.querySelector('#incident-composer');
  const out = { prompt: PROMPT, startedAtUtc: new Date().toISOString(), calls: 0 };
  let lastResult = null;
  const orig = api.client.constructScene;
  api.client.constructScene = async function (...a) {
    out.calls++;
    out.candidateSent = a[0]?.candidate || null;
    try { lastResult = await orig.apply(this, a); return lastResult; }
    catch (e) { out.constructError = String(e?.message || e); throw e; }
  };
  try {
    input.focus();
    input.value = PROMPT;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    await wait(1200);
    out.callsAfterTyping = out.calls;
    document.querySelector('#incident-composer-submit').click();
    const t = Date.now();
    await wait(500);
    while (Date.now() - t < 290000 && !(!api.composer.state.busy && ['done', 'error'].includes(form.dataset.state))) await wait(500);
    out.elapsedSec = Math.round((Date.now() - t) / 1000);
    out.formState = form.dataset.state;
    const g = api.getState().sceneGeometry || {};
    out.geometry = { status: g.status, points: g.points?.length || 0, lines: g.lines?.length || 0, areas: g.areas?.length || 0, citations: g.citations?.length || 0, legendVisible: g.legendVisible };
    out.pointLabels = (g.points || []).map((p) => p.label).slice(0, 8);
    out.citationUrls = (g.citations || []).map((c) => c.url).slice(0, 10);
    const loc = lastResult?.plan?.location;
    out.location = loc || null;
    out.locationResolution = lastResult?.locationResolution ? { precision: lastResult.locationResolution.precision, approximate: lastResult.locationResolution.approximate, confidence: lastResult.locationResolution.confidence, method: lastResult.locationResolution.method, alternatives: (lastResult.locationResolution.alternatives || []).map((a) => a.name + ' @ ' + (a.lat ?? '?') + ',' + (a.lon ?? '?')) } : null;
    out.model = lastResult?.provenance?.model || null;
    const badge = document.querySelector('#scene-location-badge');
    out.badgeText = badge && !badge.hidden ? badge.innerText.slice(0, 400) : null;
    out.resultText = (document.querySelector('#incident-composer')?.innerText || '').slice(0, 600);
    out.ok = out.callsAfterTyping === 0 && out.formState === 'done' && out.calls >= 1;
  } catch (e) { out.error = String(e); out.ok = false; }
  finally { api.client.constructScene = orig; out.finishedAtUtc = new Date().toISOString(); window.__qaResult = out; }
  return JSON.stringify(out);
})(); true;