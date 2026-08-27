/* Tests for the click detector against a hand-rolled DOM that mimics
   LinkedIn's current markup: obfuscated classes, a componentkey on the real
   submit button, and a toolbar toggle that only opens the editor. */
import fs from 'fs';
import vm from 'vm';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ---- minimal DOM ---- */
class El {
  constructor(tag, { attrs = {}, text = '', children = [] } = {}) {
    this.tagName = tag.toUpperCase();
    this.attrs = attrs;
    this.ownText = text;
    this.children = children;
    this.parentElement = null;
    children.forEach((c) => { c.parentElement = this; });
  }
  get className() { return this.attrs.class || ''; }
  get textContent() { return this.ownText + this.children.map((c) => c.textContent).join(''); }
  get innerText() { return this.textContent; }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; }
  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name); }

  matchesPart(part) {
    let rest = part.trim();
    const tagMatch = rest.match(/^[a-z]+/i);
    if (tagMatch) {
      if (this.tagName !== tagMatch[0].toUpperCase()) return false;
      rest = rest.slice(tagMatch[0].length);
    }
    for (const m of rest.matchAll(/\.([\w-]+)|\[([\w-]+)(\*?)=?'?([^'\]]*)'?\]/g)) {
      if (m[1]) { if (!this.className.split(/\s+/).includes(m[1])) return false; continue; }
      const [, , name, star, value] = m;
      const actual = this.getAttribute(name);
      if (actual === null) return false;
      if (value === '') continue;              // [attr] — presence only
      if (star ? !actual.includes(value) : actual !== value) return false;
    }
    return true;
  }
  matches(sel) { return sel.split(',').some((p) => this.matchesPart(p)); }
  closest(sel) {
    let n = this;
    while (n) { if (n.matches(sel)) return n; n = n.parentElement; }
    return null;
  }
  querySelector(sel) {
    for (const c of this.children) {
      if (c.matches(sel)) return c;
      const found = c.querySelector(sel);
      if (found) return found;
    }
    return null;
  }
}

const document = { addEventListener() {} };
const chrome = {
  runtime: { sendMessage: () => Promise.resolve() },
  storage: { local: { get: () => Promise.resolve({}) }, onChanged: { addListener() {} } },
};
const ctx = vm.createContext({ document, chrome, console, Promise, Date, Math, Object, String, JSON });
for (const f of ['src/lib/constants.js', 'src/lib/dates.js', 'src/lib/storage.js', 'src/dom-detect.js']) {
  vm.runInContext(fs.readFileSync(`${ROOT}/${f}`, 'utf8'), ctx, { filename: f });
}
const D = ctx.LCT.domDetect;

let fails = 0;
const check = (name, got, want) => {
  if (got === want) console.log(`ok   ${name}`);
  else { fails++; console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
};

const editor = (label = 'Add a comment…') =>
  new El('div', { attrs: { contenteditable: 'true', class: 'ql-editor', 'aria-label': label } });

/* The real submit button: obfuscated class, componentkey, next to the editor. */
function submitButton({ componentkey = 'urn-commentButtonSectionzKIZ4-FEED_RELEVANCE', label = 'Add a comment', replyEditor = false } = {}) {
  const btn = new El('button', {
    attrs: { class: 'a0Xy9_zz', componentkey, 'aria-label': label },
    children: [new El('span', { text: 'Comment' })],
  });
  const wrap = new El('div', {
    attrs: { class: 'b7Qk2_ww' },
    children: [editor(replyEditor ? 'Add a reply…' : 'Add a comment…'), btn],
  });
  return { btn, wrap, span: btn.children[0] };
}

/* The toolbar action that only opens the comment box. */
function toggleButton() {
  const btn = new El('button', {
    attrs: { 'aria-label': 'Comment', 'aria-expanded': 'false', class: 'x1' },
    children: [new El('svg', {}), new El('span', { text: 'Comment' })],
  });
  const bar = new El('div', { attrs: { class: 'feed-shared-social-action-bar' }, children: [btn] });
  // the post also keeps a collapsed editor further up, as LinkedIn does
  new El('article', { attrs: { class: 'post' }, children: [bar, editor()] });
  return { btn, svg: btn.children[0], span: btn.children[1] };
}

const S = submitButton();
check('real submit button counts', D.isCommentSubmitClick(S.btn), true);
check('click on its label span counts', D.isCommentSubmitClick(S.span), true);

const T = toggleButton();
check('toolbar toggle ignored', D.isCommentSubmitClick(T.btn), false);
check('toggle is recognised as a toggle', D.isToggleControl(T.btn), true);
check('click on toggle icon ignored', D.isCommentSubmitClick(T.svg), false);
check('click on toggle label ignored', D.isCommentSubmitClick(T.span), false);

// no componentkey: proximity to the editor carries it
const P = submitButton({ componentkey: '' });
check('submit next to editor counts without componentkey', D.isCommentSubmitClick(P.btn), true);

// componentkey present but no editor anywhere near
const lone = new El('button', {
  attrs: { componentkey: 'x-commentButtonSectionAB-FEED', 'aria-label': 'Comment' },
  children: [new El('span', { text: 'Comment' })],
});
check('componentkey alone is enough', D.isCommentSubmitClick(lone), true);

// unrelated controls
const like = new El('button', { attrs: { 'aria-label': 'Like' }, children: [new El('span', { text: 'Like' })] });
check('Like button ignored', D.isCommentSubmitClick(like), false);
const far = new El('button', { attrs: { 'aria-label': 'Comment settings' }, children: [new El('span', { text: 'Comment' })] });
check('comment-labelled button with no editor nearby ignored', D.isCommentSubmitClick(far), false);
check('null target', D.isCommentSubmitClick(null), false);

// decorative click targets inside the real button
const icon = new El('svg', {});
S.btn.children.push(icon); icon.parentElement = S.btn;
check('click on decorative icon inside submit ignored', D.isCommentSubmitClick(icon), false);

// reply vs top-level
check('reply editor gives reply', D.kindFor(submitButton({ replyEditor: true }).btn), 'reply');
check('comment editor gives comment', D.kindFor(S.btn), 'comment');

// the shallow walk must not reach a post-level editor
const deep = new El('button', { attrs: { 'aria-label': 'Comment' }, children: [new El('span', { text: 'Comment' })] });
new El('div', { children: [new El('div', { children: [new El('div', { children: [deep] })] }), editor()] });
check('editor 3+ levels away does not count', D.isCommentSubmitClick(deep), false);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
