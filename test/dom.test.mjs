/* Predicate tests for the DOM fallback detector, on a hand-rolled fake tree.
   Verifies which controls count as a comment submit — no browser needed. */
import fs from 'fs';
import vm from 'vm';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

class Node {
  constructor({ sels = [], className = '', text = '', children = [] }) {
    this.sels = sels;
    this.className = className;
    this.textContent = text;
    this.children = children;
    children.forEach((c) => { c.parent = this; });
  }
  matches(sel) { return this.sels.some((s) => sel.includes(s)); }
  closest(sel) {
    let n = this;
    while (n) { if (n.matches(sel)) return n; n = n.parent; }
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
  get textOfSelf() { return this.textContent; }
}

const document = { addEventListener() {} };
const chrome = {
  runtime: { sendMessage: () => Promise.resolve() },
  storage: { local: { get: () => Promise.resolve({}) }, onChanged: { addListener() {} } },
};

const ctx = vm.createContext({ document, chrome, console, Promise, Date, Math, WeakMap, Object, String, JSON });
for (const f of ['src/lib/constants.js', 'src/lib/dates.js', 'src/lib/storage.js', 'src/dom-detect.js']) {
  vm.runInContext(fs.readFileSync(`${ROOT}/${f}`, 'utf8'), ctx, { filename: f });
}
const { isSubmitControl, kindFor, editorText } = ctx.LCT.domDetect;

let fails = 0;
const check = (name, got, want) => {
  if (got === want) console.log(`ok   ${name}`);
  else { fails++; console.log(`FAIL ${name}: got ${got} want ${want}`); }
};

const editor = (text) => new Node({ sels: ['.ql-editor[contenteditable="true"]'], text });

function box({ editorTextValue = 'great post', buttonText = 'Comment', buttonClass = '', reply = false } = {}) {
  const btn = new Node({ sels: ['button'], className: buttonClass, text: buttonText });
  const b = new Node({
    sels: reply
      ? ['[class*="comments-comment-box"]', '[class*="comments-comment-entity"]']
      : ['[class*="comments-comment-box"]'],
    children: [editor(editorTextValue), btn],
  });
  return { box: b, btn };
}

// class-based submit button
check('submit button by class', isSubmitControl(box({ buttonClass: 'comments-comment-box__submit-button--cr' }).btn), true);
// text-based, editor has content
check('"Comment" button with text typed', isSubmitControl(box({ buttonText: 'Comment' }).btn), true);
check('"Reply" button with text typed', isSubmitControl(box({ buttonText: 'Reply' }).btn), true);
// text-based, editor empty -> not a submit
check('"Reply" button, empty editor', isSubmitControl(box({ buttonText: 'Reply', editorTextValue: '' }).btn), false);
// unrelated buttons
check('"Follow" button ignored', isSubmitControl(box({ buttonText: 'Follow' }).btn), false);
check('"Like" button ignored', isSubmitControl(box({ buttonText: 'Like' }).btn), false);
check('null element', isSubmitControl(null), false);

// reply vs top-level
check('reply detected by ancestor', kindFor(box({ reply: true }).box), 'reply');
check('top-level comment', kindFor(box().box), 'comment');
check('editor text read', editorText(box({ editorTextValue: '  hi  ' }).box), 'hi');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
