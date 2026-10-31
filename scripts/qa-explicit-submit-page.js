/* Run as ui-validator --eval "$(cat scripts/qa-explicit-submit-page.js)".
 * This drives the deployed UI using DOM input/keyboard events, not OS key injection.
 * The submit phase calls the real application API. No provider output is mocked here.
 * Follow with --eval 'window.__gevSubmitAudit.ok' and --eval 'window.__gevSubmitAudit'.
 */
(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const api = window.__gevIncidents;
  const input = document.querySelector('#incident-composer-input');
  const form = document.querySelector('#incident-composer');
  if (!api?.composer || !input)
    throw new Error('Existing scene composer is not mounted');
  const audit = (window.__gevSubmitAudit = {
    startedAtUtc: new Date().toISOString(),
    oldTypingTriggerMs: 300,
    kind: 'live-browser-dom-events-and-real-application-api',
    tests: {},
    apiOperations: [],
    network: [],
    downstreamProviderCallsObserved: false,
    limitation:
      'DOM-dispatched events exercise real handlers; physical IME/microphone hardware is not emulated.',
  });
  const mark = (id, ok, actual) => {
    audit.tests[id] = { status: ok ? 'passed' : 'failed', actual };
  };
  const originals = {};
  for (const name of ['locate', 'constructScene', 'search', 'ingest']) {
    originals[name] = api.client[name];
    api.client[name] = async function (...args) {
      const op = { operation: name, startedAtUtc: new Date().toISOString() };
      audit.apiOperations.push(op);
      try {
        const result = await originals[name].apply(this, args);
        op.outcome = 'response';
        return result;
      } catch (error) {
        op.outcome = error.name;
        op.httpStatus = error.status || null;
        throw error;
      } finally {
        op.finishedAtUtc = new Date().toISOString();
      }
    };
  }
  const before = performance
    .getEntriesByType('resource')
    .filter((r) => /\/scene-plans\/construct/.test(r.name)).length;
  const update = (value, inputType = 'insertText') => {
    input.value = value;
    input.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType, data: value }),
    );
  };
  const count = () => audit.apiOperations.length;
  try {
    input.focus();
    for (const value of [
      'Location:',
      'Location: Burj',
      'Location: Burj Khalifa',
      'Location: Burj Khalifa\nIllustrative scene',
    ]) {
      update(value);
      await wait(550);
    }
    mark(
      'slow-continuous-typing-beyond-300ms-zero-requests',
      count() === 0,
      count(),
    );
    await wait(1100);
    mark('pause-beyond-300ms-zero-requests', count() === 0, count());
    const pasted =
      '  Location: Burj Khalifa\nIllustrative scene with 3 people and 2 barriers.\nDuration: 18 seconds; camera distance: 180 metres.  ';
    update(pasted, 'insertFromPaste');
    await wait(700);
    mark(
      'paste-and-multiline-preserved-zero-requests',
      count() === 0 && input.value === pasted,
      { requests: count(), exactDraft: input.value === pasted },
    );
    const enter = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(enter);
    mark(
      'plain-enter-not-intercepted-as-submit',
      !enter.defaultPrevented && count() === 0,
      { prevented: enter.defaultPrevented, requests: count() },
    );
    input.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true }),
    );
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        ctrlKey: true,
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        ctrlKey: true,
        keyCode: 229,
        bubbles: true,
        cancelable: true,
      }),
    );
    input.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true, data: '' }),
    );
    for (const extra of [
      { ctrlKey: true, shiftKey: true },
      { metaKey: true, altKey: true },
      { ctrlKey: true, repeat: true },
    ])
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
          ...extra,
        }),
      );
    await wait(700);
    mark(
      'ime-composition-and-nonintentional-shortcuts-zero-requests',
      count() === 0,
      count(),
    );
    input.blur();
    input.focus();
    window.dispatchEvent(new Event('resize'));
    api.composer.setPlaybackState?.('idle');
    await wait(500);
    mark('focus-resize-render-update-zero-requests', count() === 0, count());
    const time = document.querySelector('#incident-composer-window');
    time.value = '6';
    time.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(700);
    mark('recording-window-does-not-initialize-scene', count() === 0, count());
    api.composer.restorePrompt(pasted, {
      selectedTime: { timeMode: 'recent', windowHours: 6 },
    });
    await wait(700);
    mark(
      'programmatic-restore-keeps-full-draft-zero-requests',
      count() === 0 && input.value === pasted,
      { requests: count(), exactDraft: input.value === pasted },
    );
    mark('all-idle-edit-paths-zero-generation', count() === 0, {
      construct: audit.apiOperations.filter(
        (r) => r.operation === 'constructScene',
      ).length,
      locate: audit.apiOperations.filter((r) => r.operation === 'locate')
        .length,
    });
    const button = document.querySelector('#incident-composer-submit');
    button.click();
    button.click();
    form.requestSubmit();
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    audit.submittedAtUtc = new Date().toISOString();
    const deadline = Date.now() + 135000;
    while (
      Date.now() < deadline &&
      (api.composer.state.busy ||
        !audit.apiOperations.some((r) => r.operation === 'constructScene'))
    ) {
      if (form.dataset.state === 'error' && !api.composer.state.busy) break;
      await wait(350);
    }
    const scene = api.getState().structuredScene;
    const constructs = audit.apiOperations.filter(
      (r) => r.operation === 'constructScene',
    );
    mark(
      'rapid-double-button-form-and-shortcut-one-construction',
      constructs.length === 1,
      constructs.length,
    );
    audit.network = performance
      .getEntriesByType('resource')
      .filter((r) => /\/scene-plans\/construct/.test(r.name))
      .slice(before)
      .map((r) => ({
        path: new URL(r.name).pathname,
        durationMs: Math.round(r.duration),
        httpStatus: r.responseStatus || null,
      }));
    mark(
      'exactly-one-completed-browser-construction-request',
      audit.network.length === 1,
      audit.network,
    );
    mark('completion-preserves-full-draft', input.value === pasted, {
      exactDraft: input.value === pasted,
      length: input.value.length,
    });
    mark(
      'live-provider-scene-success',
      form.dataset.state === 'done' && Boolean(scene?.plan),
      {
        state: form.dataset.state,
        sceneId: scene?.id || null,
        durationSec: scene?.plan?.durationSec || null,
        entityGroups: scene?.plan?.entities?.length || 0,
      },
    );
    const controls = document.querySelector('[data-snapchat-discovery]');
    mark(
      'snapchat-explicit-control-rendered',
      Boolean(controls && controls.getBoundingClientRect().width > 0),
      Boolean(controls),
    );
    audit.scene = scene
      ? {
          id: scene.id,
          title: scene.title,
          durationSec: scene.plan?.durationSec,
          entities: scene.plan?.entities?.map((e) => ({
            id: e.id,
            quantity: e.quantity,
            type: e.type,
            position: e.position,
          })),
          citations: scene.citations?.map((c) => c.url),
          illustrative: scene.plan?.illustrative,
          recordingWindow: scene.selectedTime,
        }
      : null;
    audit.viewport = {
      innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
    audit.ok = Object.values(audit.tests).every((t) => t.status === 'passed');
    audit.finishedAtUtc = new Date().toISOString();
    return audit.ok;
  } finally {
    for (const [name, original] of Object.entries(originals))
      api.client[name] = original;
  }
})();
