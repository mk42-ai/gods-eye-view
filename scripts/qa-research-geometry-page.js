/* Run as ui-validator --eval "$(cat /tmp/qa-research-geometry-page.js)".
 * Browser E2E verification script for scene composer geometry research workflow.
 * Sets window.__gevGeometryAudit and returns a boolean indicating overall pass.
 */
window.__gevGeometryRun = (async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  for (let i = 0; i < 240 && !(window.__gevIncidents?.composer && document.querySelector('#incident-composer-input')); i++) await wait(500);
  await wait(3000);
  const api = window.__gevIncidents;
  const input = document.querySelector('#incident-composer-input');
  const form = document.querySelector('#incident-composer');
  const audit = (window.__gevGeometryAudit = {
    startedAtUtc: new Date().toISOString(),
    tests: {},
    runs: [],
    ok: false,
    finishedAtUtc: null,
  });
  const mark = (id, ok, actual) => {
    audit.tests[id] = { status: ok ? 'passed' : 'failed', actual };
  };
  if (!api?.composer || !input || !form) {
    mark('composer-mounted', false, { hasApi: Boolean(api?.composer), hasInput: Boolean(input) });
    audit.finishedAtUtc = new Date().toISOString();
    return false;
  }
  const clientCalls = { constructScene: 0, locate: 0, search: 0, ingest: 0 };
  const originals = {};
  if (api.client) {
    for (const name of ['constructScene', 'locate', 'search', 'ingest']) {
      if (typeof api.client[name] === 'function') {
        originals[name] = api.client[name];
        api.client[name] = async function (...args) {
          clientCalls[name] = (clientCalls[name] || 0) + 1;
          return originals[name].apply(this, args);
        };
      }
    }
  }
  const getConstructNetworkEntries = () => {
    try {
      return (performance?.getEntriesByType?.('resource') || []).filter((r) =>
        /\/scene-plans\/construct/.test(r?.name || ''),
      );
    } catch { return []; }
  };
  const initialConstructNetworkCount = getConstructNetworkEntries().length;
  const waitForCompletion = async (timeoutMs = 150000) => {
    const deadline = Date.now() + timeoutMs;
    await wait(350);
    while (Date.now() < deadline) {
      const isBusy = Boolean(api.composer?.state?.busy);
      const formState = form?.dataset?.state;
      if (!isBusy && (formState === 'done' || formState === 'error')) return { ok: true, state: formState };
      await wait(350);
    }
    return { ok: false, state: form?.dataset?.state, busy: api.composer?.state?.busy };
  };
  const isGeometrySummaryValid = (g) => Boolean(
    g && typeof g === 'object' &&
    Array.isArray(g.points) && Array.isArray(g.lines) &&
    Array.isArray(g.areas) && Array.isArray(g.citations) && g.status
  );
  const getGeometryCoordsSignature = (g) => {
    if (!g || typeof g !== 'object') return '';
    const pts = (g.points || []).map((p) => `${p?.lat},${p?.lon}`).sort().join(';');
    const lns = (g.lines || []).map((l) => `${l?.first}>${l?.last}#${l?.vertices}`).sort().join(';');
    return `${g.signature}|P:[${pts}]|L:[${lns}]`;
  };

  try {
    input.focus();
    // a. Type multiline prompt (~30 incremental values with 120-400ms waits + plain Enter)
    const prompt1Lines = [
      'Location: Dubai Marina',
      'Hypothetical illustrative community gathering at Marina Walk and Dubai Marina Mall with spectators along the promenade.',
      'Camera distance: 250 metres; duration: 25 seconds.',
    ];
    const fullPrompt1 = prompt1Lines.join('\n');
    let currentValue = '';
    let enterDispatchedCount = 0;
    let enterPreventedCount = 0;
    const targetSteps = 30;
    const stepSize = Math.max(1, Math.floor(fullPrompt1.length / targetSteps));

    for (let i = 0; i < prompt1Lines.length; i++) {
      const line = prompt1Lines[i];
      for (let j = 0; j < line.length; j += stepSize) {
        currentValue += line.slice(j, j + stepSize);
        input.value = currentValue;
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: currentValue }));
        await wait(120 + Math.floor(Math.random() * 280));
      }
      if (i < prompt1Lines.length - 1) {
        enterDispatchedCount++;
        const enterEvt = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true });
        input.dispatchEvent(enterEvt);
        if (enterEvt.defaultPrevented) enterPreventedCount++;
        else {
          currentValue += '\n';
          input.value = currentValue;
          input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertLineBreak' }));
        }
        await wait(120 + Math.floor(Math.random() * 280));
      }
    }
    const networkAfterTyping = getConstructNetworkEntries().length;
    const zeroRequests = clientCalls.constructScene === 0 && clientCalls.locate === 0 && networkAfterTyping === initialConstructNetworkCount;
    mark('idle-typing-multiline-zero-requests', zeroRequests, {
      constructCalls: clientCalls.constructScene,
      locateCalls: clientCalls.locate,
      newNetworkEntries: networkAfterTyping - initialConstructNetworkCount,
    });
    mark('plain-enter-preserves-newline', enterDispatchedCount > 0 && enterPreventedCount === 0, {
      enterDispatchedCount, enterPreventedCount, exactDraft: input.value === fullPrompt1,
    });

    // b. Click svg/icon inside #incident-composer-submit with bubbling click + second click immediately
    const submitBtn = document.querySelector('#incident-composer-submit');
    const submitIcon = submitBtn?.querySelector('svg, [data-icon], span') ||
      document.querySelector('#incident-composer-submit svg, #incident-composer-submit [data-icon], #incident-composer-submit span');
    const clickEvt = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
    if (submitIcon) submitIcon.dispatchEvent(clickEvt);
    else submitBtn?.dispatchEvent(clickEvt);
    submitBtn?.click?.();

    // c. Wait up to 150s for completion, record citations, sceneGeometry summary, and legend
    await waitForCompletion(290000);
    mark('submit-icon-double-click-single-construct', clientCalls.constructScene === 1, {
      constructCalls: clientCalls.constructScene, iconFound: Boolean(submitIcon),
    });

    const state1 = api.getState?.() || {};
    const geom1 = state1.sceneGeometry;
    const citationsCount1 = state1.structuredScene?.citations?.length || 0;
    const legendEl1 = document.querySelector('#scene-geometry-legend');
    const legend1 = { present: Boolean(legendEl1), text: (legendEl1?.textContent || '').trim() };
    audit.runs.push({
      run: 1, prompt: fullPrompt1, citationsCount: citationsCount1,
      sceneGeometry: geom1 || null, legend: legend1, structuredSceneId: state1.structuredScene?.id || null,
    });
    mark('geometry-present', isGeometrySummaryValid(geom1), {
      present: Boolean(geom1), status: geom1?.status || null,
      pointsCount: geom1?.points?.length ?? null, linesCount: geom1?.lines?.length ?? null,
      areasCount: geom1?.areas?.length ?? null, citationsCount: geom1?.citations?.length ?? null,
    });
    const btn = document.querySelector('#incident-composer-submit');
    const svg = btn?.querySelector('svg');
    mark('build-button-single-native-button-with-icon-child', btn?.type === 'button' && Boolean(svg) && svg.closest('button') === btn && !document.querySelector('#incident-composer button[type=submit]'), { type: btn?.type, iconInside: Boolean(svg && svg.closest('button') === btn), pointerEvents: svg ? getComputedStyle(svg).pointerEvents : null });
    mark('run1-research-citations-and-drawn-geometry', (geom1?.citations?.length || 0) > 0 && (geom1?.points?.length || 0) + (geom1?.lines?.length || 0) + (geom1?.areas?.length || 0) > 0 && legendEl1?.dataset?.signature === geom1?.signature, { citations: geom1?.citations?.length, points: geom1?.points?.length, lines: geom1?.lines?.length, areas: geom1?.areas?.length, status: geom1?.status, legendSignature: legendEl1?.dataset?.signature, stateSignature: geom1?.signature, entities: geom1?.entities });
    mark('citations-and-legend-recorded', citationsCount1 !== undefined && legend1.present !== undefined, {
      citationsCount: citationsCount1, legend: legend1,
    });

    // d. Second prompt (Sheikh Zayed Road route prompt), single click, assert geometry differs
    const prompt2 = 'Location: Sheikh Zayed Road\nHypothetical illustrative charity run route along Sheikh Zayed Road from the World Trade Centre roundabout to Dubai Marina, with runners and water stations.\nCamera distance: 300 metres; duration: 30 seconds.';
    input.value = prompt2;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt2 }));
    await wait(300);

    const icon2 = document.querySelector('#incident-composer-submit svg, #incident-composer-submit [data-icon], #incident-composer-submit span') ||
      document.querySelector('#incident-composer-submit');
    icon2?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));

    await waitForCompletion(290000);
    const state2 = api.getState?.() || {};
    const geom2 = state2.sceneGeometry;
    const citationsCount2 = state2.structuredScene?.citations?.length || 0;
    const legendEl2 = document.querySelector('#scene-geometry-legend');
    const legend2 = { present: Boolean(legendEl2), text: (legendEl2?.textContent || '').trim() };
    audit.runs.push({
      run: 2, prompt: prompt2, citationsCount: citationsCount2,
      sceneGeometry: geom2 || null, legend: legend2, structuredSceneId: state2.structuredScene?.id || null,
    });

    mark('run2-research-citations-and-drawn-geometry', (geom2?.citations?.length || 0) > 0 && (geom2?.lines?.length || 0) + (geom2?.points?.length || 0) > 0 && legendEl2?.dataset?.signature === geom2?.signature, { citations: geom2?.citations?.length, points: geom2?.points?.length, lines: geom2?.lines?.length, areas: geom2?.areas?.length, status: geom2?.status, constructCalls: clientCalls.constructScene });
    const sig1 = getGeometryCoordsSignature(geom1);
    const sig2 = getGeometryCoordsSignature(geom2);
    mark('geometry-differs-between-runs', Boolean(sig1 && sig2 && sig1 !== sig2), {
      sig1, sig2, run1Points: geom1?.points?.length, run2Points: geom2?.points?.length,
    });

    // e. Change #incident-composer-window to different option, dispatch change, wait 1.5s
    const windowSelect = document.querySelector('#incident-composer-window');
    const constructBeforeWindow = clientCalls.constructScene;
    const sceneIdBeforeWindow = (api.getState?.() || {}).structuredScene?.id || null;
    const currentVal = windowSelect?.value || '1';
    const targetVal = currentVal === '6' ? '24' : '6';
    if (windowSelect) {
      windowSelect.value = targetVal;
      windowSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await wait(1500);

    const postWindowState = api.getState?.() || {};
    const postGeom = postWindowState.sceneGeometry;
    const observedWindowHours = postGeom?.selectedTime?.windowHours ?? postGeom?.windowHours ??
      postWindowState.selectedTime?.windowHours ??
      postWindowState.structuredScene?.selectedTime?.windowHours ??
      api.composer?.state?.extraction?.windowHours;
    const sceneIdAfterWindow = postWindowState.structuredScene?.id || null;

    const noNewConstruct = clientCalls.constructScene === constructBeforeWindow;
    audit.timeWindow = { rendersBefore: geom2?.renders, rendersAfter: postGeom?.renders, restylesBefore: geom2?.restyles, restylesAfter: postGeom?.restyles, windowLabelAfter: postGeom?.windowLabel, signatureBefore: geom2?.signature, signatureAfter: postGeom?.signature };
    mark('time-window-restyles-in-place-without-rebuild', postGeom?.renders === geom2?.renders && postGeom?.restyles === (geom2?.restyles || 0) + 1 && postGeom?.signature === geom2?.signature, audit.timeWindow);
    const windowUpdated = String(observedWindowHours) === String(targetVal) || Number(observedWindowHours) === Number(targetVal);
    const sceneIdPreserved = sceneIdBeforeWindow === sceneIdAfterWindow;
    mark('time-window-change-no-new-construct', noNewConstruct && windowUpdated && sceneIdPreserved, {
      noNewConstruct, windowUpdated, sceneIdPreserved,
      callsBefore: constructBeforeWindow, callsAfter: clientCalls.constructScene,
      targetWindow: targetVal, observedWindowHours, sceneIdBefore: sceneIdBeforeWindow, sceneIdAfter: sceneIdAfterWindow,
    });

    // f. Assert no element contains 'perimeter officers' and illustrative marker labels / legend
    const hasPerimeterOfficers = () => {
      try {
        const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, null);
        let n;
        while ((n = walker.nextNode())) {
          if (/perimeter officers/i.test(n.nodeValue || '')) return true;
        }
      } catch {}
      return /perimeter officers/i.test(document.body?.innerText || '');
    };
    const perimeterAbsent = !hasPerimeterOfficers();
    mark('no-perimeter-officers', perimeterAbsent, { perimeterOfficersFound: !perimeterAbsent });

    const legendNode = document.querySelector('#scene-geometry-legend');
    const legendText = (legendNode?.textContent || '').trim();
    const legendSaysIllustrative = /illustrative/i.test(legendText);

    const markerCandidates = Array.from(document.querySelectorAll(
      '.scene-anchor-label, .geographic-scene-marker, .incident-external-marker, [data-marker], [class*="marker-label"], .cesium-label'
    ));
    const visibleMarkers = markerCandidates.filter((el) => {
      try {
        const rect = el.getBoundingClientRect?.();
        const style = window.getComputedStyle?.(el);
        const hidden = el.hidden || (rect && rect.width === 0 && rect.height === 0) ||
          style?.display === 'none' || style?.visibility === 'hidden' || style?.opacity === '0';
        return !hidden && (el.textContent || '').trim().length > 0;
      } catch { return false; }
    });
    const visibleMarkerTexts = visibleMarkers.map((el) => (el.textContent || '').trim());
    const allMarkersIllustrative = visibleMarkerTexts.length > 0
      ? visibleMarkerTexts.every((t) => /illustrative/i.test(t))
      : false;
    mark('illustrative-disclosed', legendSaysIllustrative || allMarkersIllustrative, {
      legendSaysIllustrative, legendText, allMarkersIllustrative,
      visibleMarkerCount: visibleMarkerTexts.length, visibleMarkerTexts,
    });

    // Rollup
    audit.ok = Object.keys(audit.tests).length >= 9 && Object.values(audit.tests).every((t) => t.status === 'passed');
    mark('all-e2e-geometry-tests-passed', audit.ok, {
      totalTests: Object.keys(audit.tests).length,
      passedCount: Object.values(audit.tests).filter((t) => t.status === 'passed').length,
    });
    audit.ok = Object.values(audit.tests).every((t) => t.status === 'passed');
    audit.finishedAtUtc = new Date().toISOString();
    window.__gevAuditSummary = Object.entries(audit.tests).map(([k, v]) => `${v.status === 'passed' ? 'PASS' : 'FAIL'} ${k}`).join(' | ');
    return audit.ok;
  } catch (err) {
    mark('script-execution', false, { error: err?.message || String(err), stack: err?.stack || null });
    audit.ok = false;
    audit.finishedAtUtc = new Date().toISOString();
    return false;
  } finally {
    if (api?.client) {
      for (const [name, original] of Object.entries(originals)) {
        if (typeof original === 'function') api.client[name] = original;
      }
    }
  }
})();
true;
