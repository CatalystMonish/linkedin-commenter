/* Isolated-world relay: page events -> service worker. */
(function () {
  const LCT = globalThis.LCT;
  const { MSG_SOURCE, MSG } = LCT;

  const ALLOWED = new Set([MSG.COMMENT_CREATED]);

  function send(message) {
    try {
      const p = chrome.runtime.sendMessage(message);
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) {
      // "Extension context invalidated" after a reload — the page will pick the
      // new context up on its next load.
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.source !== MSG_SOURCE) return;
    if (!ALLOWED.has(data.type)) return;

    send({
      type: MSG.COMMENT_CREATED,
      id: typeof data.id === 'string' ? data.id : null,
      kind: data.kind === 'reply' ? 'reply' : 'comment',
    });
  });

  /** Mirror the debug setting into the page world. */
  function pushDebug(value) {
    window.postMessage({ source: MSG_SOURCE, type: MSG.SET_DEBUG, value: !!value }, window.location.origin);
  }

  LCT.storage.getState().then((state) => pushDebug(state.settings.debug)).catch(() => {});

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[LCT.STORAGE_KEY]) return;
    const next = changes[LCT.STORAGE_KEY].newValue;
    if (next && next.settings) pushDebug(next.settings.debug);
  });
})();
