/**
 * streamView.js — rAF-paced typewriter UX for scene streaming.
 *
 * Buffer tokens in a queue; each animation frame reveals N characters where
 * N scales with backlog but is capped (never dumps a whole chunk).
 * Exposes flush() on completion.
 * Live chip: `model · ~N tok/s (est.) · M.M s`.
 * Skeleton rows for connecting/reconnecting states.
 * Stable auto-scroll with 'Jump to latest' pill when scrolled up.
 * Screen-reader: aria-live="polite" on a summary line only.
 */

export const STREAM_VIEW_CLASS = 'composer-stream-view';

export function createStreamView({
  document = globalThis.document,
  window = globalThis.window,
  requestAnimationFrame: rAF = globalThis.requestAnimationFrame?.bind(
    globalThis,
  ) || ((fn) => setTimeout(fn, 16)),
  cancelAnimationFrame: cAF = globalThis.cancelAnimationFrame?.bind(
    globalThis,
  ) || ((id) => clearTimeout(id)),
  minCharsPerFrame = 1,
  maxCharsPerFrame = 12,
} = {}) {
  const root = document.createElement('div');
  root.className = STREAM_VIEW_CLASS;
  root.dataset.state = 'connecting';

  // Live status chip
  const chip = document.createElement('div');
  chip.className = 'composer-stream-chip';
  chip.textContent = 'Connecting…';

  // Screen reader summary line (polite, only updated on milestone/completion)
  const srSummary = document.createElement('div');
  srSummary.className = 'composer-stream-sr';
  srSummary.setAttribute('aria-live', 'polite');
  srSummary.setAttribute('aria-atomic', 'true');
  srSummary.textContent = 'Scene construction in progress.';

  // Skeleton rows for connecting state
  const skeleton = document.createElement('div');
  skeleton.className = 'composer-stream-skeleton';
  for (let i = 0; i < 3; i++) {
    const row = document.createElement('div');
    row.className = 'composer-stream-skeleton-row';
    skeleton.appendChild(row);
  }

  // Scroll container
  const scrollArea = document.createElement('div');
  scrollArea.className = 'composer-stream-scroll';

  // Thinking notes / status
  const statusLine = document.createElement('div');
  statusLine.className = 'composer-stream-status';
  statusLine.hidden = true;

  // Typewriter body text
  const textBody = document.createElement('div');
  textBody.className = 'composer-stream-text';

  scrollArea.append(statusLine, textBody);

  // Jump to latest pill
  const jumpPill = document.createElement('button');
  jumpPill.type = 'button';
  jumpPill.className = 'composer-stream-jump';
  jumpPill.textContent = '↓ Jump to latest';
  jumpPill.hidden = true;

  root.append(chip, srSummary, skeleton, scrollArea, jumpPill);

  // Typewriter queue state
  let pendingChars = '';
  let displayedChars = '';
  let rAFId = null;
  let destroyed = false;
  let userScrolledUp = false;

  // Telemetry
  let modelName = 'fast-spec';
  let tokenCount = 0;
  let startTime = Date.now();
  let elapsedTimer = null;
  let finalRate = null;

  function updateChip() {
    if (destroyed) return;
    const elapsedSec = Math.max(0.1, (Date.now() - startTime) / 1000);
    const rate =
      finalRate !== null ? finalRate : Math.round(tokenCount / elapsedSec);
    chip.textContent = `${modelName} · ~${rate} tok/s (est.) · ${elapsedSec.toFixed(1)} s`;
  }

  function startTimer() {
    if (elapsedTimer || destroyed) return;
    startTime = Date.now();
    elapsedTimer = setInterval(updateChip, 200);
    // Never keep a Node test process alive because of the live chip.
    elapsedTimer.unref?.();
  }
  function stopTimer() {
    if (elapsedTimer) clearInterval(elapsedTimer);
    elapsedTimer = null;
  }

  function checkScroll() {
    if (!scrollArea) return;
    const { scrollTop = 0, scrollHeight = 0, clientHeight = 0 } = scrollArea;
    const threshold = 24;
    userScrolledUp = scrollHeight - (scrollTop + clientHeight) > threshold;
    jumpPill.hidden = !userScrolledUp;
  }

  scrollArea.addEventListener?.('scroll', checkScroll);

  function scrollToBottom() {
    if (scrollArea && !userScrolledUp) {
      scrollArea.scrollTop = scrollArea.scrollHeight;
    }
  }

  function jumpToLatest() {
    userScrolledUp = false;
    jumpPill.hidden = true;
    if (scrollArea) {
      scrollArea.scrollTop = scrollArea.scrollHeight;
    }
  }

  jumpPill.addEventListener?.('click', jumpToLatest);

  function stepTypewriter() {
    rAFId = null;
    if (destroyed || !pendingChars.length) return;

    // Scale characters per frame with backlog, capped to maxCharsPerFrame
    const backlog = pendingChars.length;
    let n = Math.max(minCharsPerFrame, Math.floor(backlog / 8));
    n = Math.min(n, maxCharsPerFrame);
    n = Math.min(n, backlog);

    const chunk = pendingChars.slice(0, n);
    pendingChars = pendingChars.slice(n);
    displayedChars += chunk;

    textBody.textContent = displayedChars;
    scrollToBottom();

    if (pendingChars.length > 0) {
      rAFId = rAF(stepTypewriter);
    }
  }

  function scheduleTypewriter() {
    if (rAFId === null && pendingChars.length > 0 && !destroyed) {
      rAFId = rAF(stepTypewriter);
    }
  }

  function appendToken(token) {
    if (destroyed || typeof token !== 'string') return;
    skeleton.hidden = true;
    pendingChars += token;
    tokenCount += 1;
    root.dataset.state = 'streaming';
    scheduleTypewriter();
  }

  function flush() {
    if (rAFId !== null) {
      cAF(rAFId);
      rAFId = null;
    }
    if (pendingChars.length > 0) {
      displayedChars += pendingChars;
      pendingChars = '';
      textBody.textContent = displayedChars;
    }
    scrollToBottom();
  }

  function setState(state, detail = '') {
    root.dataset.state = state;
    if (state === 'connecting') {
      pendingChars = '';
      displayedChars = '';
      textBody.textContent = '';
      tokenCount = 0;
      finalRate = null;
      statusLine.hidden = true;
      stopTimer();
      startTimer();
      skeleton.hidden = false;
      chip.textContent = 'Connecting…';
    } else if (state === 'reconnecting') {
      skeleton.hidden = false;
      chip.textContent = 'Reconnecting…';
    } else if (state === 'streaming') {
      skeleton.hidden = true;
      updateChip();
    } else if (state === 'complete') {
      flush();
      skeleton.hidden = true;
      stopTimer();
      const totalSec = Math.max(0.1, (Date.now() - startTime) / 1000);
      const rate =
        finalRate !== null ? finalRate : Math.round(tokenCount / totalSec);
      chip.textContent = `${modelName} · ~${rate} tok/s (est.) · ${totalSec.toFixed(1)} s`;
      srSummary.textContent = `Scene build complete. ${tokenCount} narration tokens delivered in ${totalSec.toFixed(1)}s.`;
    } else if (state === 'error') {
      flush();
      skeleton.hidden = true;
      stopTimer();
      chip.textContent = 'Stream error';
      srSummary.textContent = `Scene build error: ${detail || 'Request failed'}`;
    }
  }

  function setModel(name) {
    if (name) {
      modelName = String(name);
      updateChip();
    }
  }

  function setTokensPerSec(rate) {
    if (Number.isFinite(rate)) {
      finalRate = Math.round(rate);
      updateChip();
    }
  }

  function setStatus(stage, text) {
    if (text) {
      statusLine.textContent = text;
      statusLine.hidden = false;
      statusLine.dataset.stage = stage || '';
    }
  }

  function setThinking(note) {
    if (note) {
      statusLine.textContent = note;
      statusLine.hidden = false;
    }
  }

  function destroy() {
    destroyed = true;
    if (rAFId !== null) cAF(rAFId);
    stopTimer();
    scrollArea.removeEventListener?.('scroll', checkScroll);
    jumpPill.removeEventListener?.('click', jumpToLatest);
    root.remove?.();
  }

  return {
    element: root,
    chip,
    scrollArea,
    textBody,
    jumpPill,
    srSummary,
    appendToken,
    flush,
    setState,
    setModel,
    setTokensPerSec,
    setStatus,
    setThinking,
    jumpToLatest,
    getDisplayedText: () => displayedChars,
    getPendingText: () => pendingChars,
    isScrolledUp: () => userScrolledUp,
    destroy,
  };
}

export default createStreamView;
