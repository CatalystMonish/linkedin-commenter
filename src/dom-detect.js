/*
 * Fallback detection, isolated world.
 *
 * Watches for the user submitting LinkedIn's comment editor — the submit button
 * or Enter in the editor — and reports it. The service worker ignores these
 * events entirely once the network interceptor has proved it works, so this
 * only carries the count when LinkedIn's request shape is one we don't match.
 */
(function () {
  const LCT = globalThis.LCT;
  const { MSG } = LCT;

  const EDITOR_SEL = '.ql-editor[contenteditable="true"], [role="textbox"][contenteditable="true"]';
  const BOX_SEL = '[class*="comments-comment-box"], [class*="comment-texteditor"], [class*="comments-comment-entity"], form';
  const REPLY_SEL = '[class*="comments-comment-item"], [class*="comments-comment-entity"], article[class*="comment"]';
  const SUBMIT_CLASS_RE = /comment.*submit|submit.*comment/i;
  const SUBMIT_TEXT_RE = /^(comment|reply|post)$/i;
  const CANCEL_TEXT_RE = /(cancel|close|discard|delete|dismiss)/i;
  /** LinkedIn empties the editor once the comment is accepted. */
  const CLEAR_CHECK_MS = 1500;
  /** One submit per editor per second: a click and an Enter can both fire. */
  const DEBOUNCE_MS = 1000;

  let debugOn = false;
  const lastSubmit = new WeakMap();

  function log() {
    if (debugOn) console.debug('[LCT dom]', ...arguments);
  }

  function editorText(box) {
    if (!box) return '';
    const editor = box.querySelector ? box.querySelector(EDITOR_SEL) : null;
    return editor ? (editor.textContent || '').trim() : '';
  }

  /** Is this element the submit control of a comment editor? */
  function isSubmitControl(el) {
    if (!el || !el.matches) return false;
    const cls = typeof el.className === 'string' ? el.className : '';
    if (SUBMIT_CLASS_RE.test(cls)) return true;
    const text = (el.textContent || '').trim();
    if (!SUBMIT_TEXT_RE.test(text)) return false;
    // A bare "Reply"/"Comment" button only counts inside a comment editor.
    return !!(el.closest && el.closest(BOX_SEL) && editorText(el.closest(BOX_SEL)));
  }

  /**
   * Arm a check after a plausible submit gesture: if the editor had text and is
   * empty a moment later, the comment went through. Independent of button
   * markup and of the request shape.
   */
  function armClearCheck(box, why) {
    const before = editorText(box);
    if (!before) return;
    setTimeout(() => {
      const after = editorText(box);
      if (after === '') fire(box, why + '+cleared');
      else log('editor not cleared after', why, '- not counting');
    }, CLEAR_CHECK_MS);
  }

  function isCancelControl(el) {
    const label = ((el && el.getAttribute && el.getAttribute('aria-label')) || (el && el.textContent) || '').trim();
    return CANCEL_TEXT_RE.test(label);
  }

  function kindFor(box) {
    return box && box.closest && box.closest(REPLY_SEL) ? 'reply' : 'comment';
  }

  function fire(box, why) {
    const now = Date.now();
    const key = box || document;
    if (now - (lastSubmit.get(key) || 0) < DEBOUNCE_MS) return log('debounced', why);
    lastSubmit.set(key, now);

    const kind = kindFor(box);
    log('submit detected via', why, '->', kind);
    try {
      const p = chrome.runtime.sendMessage({
        type: MSG.COMMENT_CREATED,
        id: 'dom-' + now + '-' + Math.random().toString(16).slice(2),
        kind,
        via: 'dom',
      });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) { /* extension reloaded */ }
  }

  document.addEventListener('click', (e) => {
    const el = e.target && e.target.closest ? e.target.closest('button, [role="button"]') : null;
    if (!el) return;
    const box = el.closest(BOX_SEL);
    if (!box || !editorText(box)) return;

    if (isSubmitControl(el)) {
      fire(box, 'click');
      return;
    }
    // Unknown control inside a comment editor: fall back to watching for the
    // editor being emptied, which only happens on a successful post.
    if (!isCancelControl(el)) armClearCheck(box, 'click');
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    const el = e.target && e.target.closest ? e.target.closest(EDITOR_SEL) : null;
    if (!el) return;
    const box = el.closest(BOX_SEL);
    if (!box) return;
    if (!(el.textContent || '').trim()) return;
    fire(box, 'enter');
    // Enter may only insert a newline in some editors; the clear check settles it.
    armClearCheck(box, 'enter');
  }, true);

  try {
    const hello = chrome.runtime.sendMessage({ type: MSG.HELLO, which: 'dom', at: Date.now() });
    if (hello && typeof hello.catch === 'function') hello.catch(() => {});
  } catch (e) { /* extension reloaded */ }

  LCT.storage.getState().then((state) => { debugOn = !!state.settings.debug; }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[LCT.STORAGE_KEY]) return;
    const next = changes[LCT.STORAGE_KEY].newValue;
    if (next && next.settings) debugOn = !!next.settings.debug;
  });

  // Exposed for the tests.
  LCT.domDetect = { isSubmitControl, isCancelControl, kindFor, editorText };
})();
