/*
 * Click detection, isolated world.
 *
 * LinkedIn's class names are obfuscated and rotate, so this identifies the
 * "post comment" button by purpose rather than by styling: a control whose
 * label mentions a comment, which is not the toolbar toggle that merely opens
 * the editor, and which is either stamped with LinkedIn's commentButtonSection
 * componentkey or sits right next to the editor's text input.
 *
 * The service worker ignores these events once network detection has proved
 * itself, so the two can never both count the same comment.
 */
(function () {
  const LCT = globalThis.LCT;
  const { MSG } = LCT;

  const INTERACTIVE_SEL = "button, [role='button'], a[href]";
  const EDITOR_SEL = "[contenteditable='true'], textarea, .ql-editor";
  const SOCIAL_BAR_SEL = "[class*='social-actions'], [class*='feed-shared-social-action-bar']";
  // Stamped on the real submit button; the toolbar toggle doesn't carry it.
  const COMPONENT_KEY_RE = /commentbuttonsection/;
  const DECORATIVE_TAGS = ['svg', 'path', 'use', 'img', 'i'];
  /** Ignore a repeat click on the same element (double submit guard). */
  const REPEAT_MS = 400;

  let debugOn = false;
  let lastTarget = null;
  let lastAt = 0;

  function log() {
    if (debugOn) console.debug('[LCT dom]', ...arguments);
  }

  function norm(value) {
    return (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function attr(el, name) {
    return el && el.getAttribute ? el.getAttribute(name) : null;
  }

  function isDecorativeIcon(el) {
    if (!el || !el.tagName) return false;
    return DECORATIVE_TAGS.includes(el.tagName.toLowerCase());
  }

  function interactiveAncestor(el) {
    return el && el.closest ? el.closest(INTERACTIVE_SEL) : null;
  }

  /**
   * The toolbar "Comment" action opens the editor; it toggles aria-expanded and
   * lives in the post's social-actions bar alongside Like/Repost/Send.
   */
  function isToggleControl(control) {
    if (control.hasAttribute && control.hasAttribute('aria-expanded')) return true;
    return !!(control.closest && control.closest(SOCIAL_BAR_SEL));
  }

  /**
   * The submit button sits one or two wrappers from the editor's text input.
   * This walk must stay shallow: a post keeps its collapsed editor in the DOM,
   * so walking further up finds an editor that isn't actually next to the
   * button.
   */
  function nearbyEditor(control) {
    let node = control;
    for (let i = 0; i < 2 && node; i += 1) {
      const input = node.querySelector ? node.querySelector(EDITOR_SEL) : null;
      if (input) return input;
      node = node.parentElement;
    }
    return null;
  }

  function hasSubmitComponentKey(control) {
    return COMPONENT_KEY_RE.test(norm(attr(control, 'componentkey')));
  }

  function isSubmitControl(control) {
    if (!control) return false;
    if (isToggleControl(control)) return false;
    if (hasSubmitComponentKey(control)) return true;
    return !!nearbyEditor(control);
  }

  /** Full check for a click target: does this click post a comment? */
  function isCommentSubmitClick(target) {
    if (!target || !target.tagName) return false;
    const control = interactiveAncestor(target);
    if (!control) return false;
    if (isDecorativeIcon(target)) return false;

    const label = [
      norm(attr(control, 'aria-label')),
      norm(attr(control, 'title')),
      norm(attr(control, 'data-control-name')),
      norm(control.innerText || control.textContent),
    ].join(' ');
    if (!/comment/.test(label)) return false;

    // When the click landed on a child, that child has to be the label itself,
    // not some unrelated node inside the button.
    if (target !== control) {
      const tag = target.tagName.toLowerCase();
      const text = norm(target.innerText || target.textContent);
      if (!['span', 'div', 'p'].includes(tag) || !/comment/.test(text)) return false;
    }

    return isSubmitControl(control);
  }

  /** LinkedIn's editor announces itself as a reply when replying. */
  function kindFor(control) {
    const editor = nearbyEditor(control);
    const hint = norm(
      attr(editor, 'aria-label') || attr(editor, 'data-placeholder') || attr(editor, 'placeholder')
    );
    return /reply/.test(hint) ? 'reply' : 'comment';
  }

  function fire(control) {
    const kind = kindFor(control);
    log('comment submit ->', kind);
    try {
      const p = chrome.runtime.sendMessage({
        type: MSG.COMMENT_CREATED,
        id: 'dom-' + Date.now() + '-' + Math.random().toString(16).slice(2),
        kind,
        via: 'dom',
      });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) { /* extension reloaded */ }
  }

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!isCommentSubmitClick(target)) return;

    const now = Date.now();
    if (target === lastTarget && now - lastAt < REPEAT_MS) return log('repeat click ignored');
    lastTarget = target;
    lastAt = now;

    fire(interactiveAncestor(target));
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
  LCT.domDetect = {
    isCommentSubmitClick, isSubmitControl, isToggleControl, nearbyEditor,
    hasSubmitComponentKey, kindFor,
  };
})();
