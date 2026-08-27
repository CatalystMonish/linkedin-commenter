import fs from 'fs';
import process from 'process';
import vm from 'vm';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const captured = [];
const listeners = [];
let nextResponse = { status: 200, ok: true };

class FakeXHR {
  open(method, url) { this._m = method; this._u = url; }
  send() {}
  addEventListener(type, fn) { (this._l = this._l || {})[type] = fn; }
  finish(status) { this.status = status; if (this._l && this._l.loadend) this._l.loadend(); }
}

const window = {
  location: { origin: 'https://www.linkedin.com', href: 'https://www.linkedin.com/feed/' },
  localStorage: { getItem: () => null },
  crypto: { randomUUID: () => 'id-' + captured.length },
  addEventListener: (t, fn) => { if (t === 'message') listeners.push(fn); },
  postMessage: (msg) => captured.push(msg),
  fetch: (input, init) => {
    const res = { status: nextResponse.status, ok: nextResponse.ok };
    return Promise.resolve(res);
  },
  XMLHttpRequest: FakeXHR,
};
window.window = window;

const ctx = vm.createContext({
  window, XMLHttpRequest: FakeXHR, console, Promise, Date, Math, URL, URLSearchParams, Blob,
  FormData: undefined, Object, String, Number, JSON, setTimeout,
});
vm.runInContext(fs.readFileSync(`${ROOT}/src/interceptor.js`, 'utf8'), ctx, { filename: 'interceptor.js' });

const tick = () => new Promise((r) => setTimeout(r, 5));
let fails = 0;

async function expectFetch(name, url, body, expected, opts = {}) {
  nextResponse = opts.response || { status: 200, ok: true };
  const before = captured.length;
  await window.fetch(url, { method: opts.method || 'POST', body });
  await tick();
  const events = captured.slice(before);
  const got = events.length === 0 ? null : events[0].kind;
  const ok = got === expected && events.length <= 1;
  if (!ok) { fails++; console.log(`FAIL ${name}: got ${JSON.stringify(events)} want ${expected}`); }
  else console.log(`ok   ${name}`);
}

const HOST = 'https://www.linkedin.com';
const CREATE = JSON.stringify({ commentary: { text: 'great post', attributes: [] }, threadUrn: 'urn:li:activity:7123' });
const REPLY = JSON.stringify({ commentary: { text: 'thanks!' }, threadUrn: 'urn:li:activity:7123', parentComment: 'urn:li:comment:(activity:7123,999)' });
const LEGACY = JSON.stringify({ comment: { values: [{ value: { string: 'hi' } }] }, threadUrn: 'urn:li:activity:1' });
const EDIT = JSON.stringify({ patch: { $set: { commentary: { text: 'edited' } } } });
const REACTION = JSON.stringify({ variables: { threadUrn: 'urn:li:activity:7123', reactionType: 'LIKE' }, queryId: 'socialDashReactions.abc' });
const FOLLOW = JSON.stringify({ patch: { $set: { following: true } } });

// --- should count ---
await expectFetch('rest create', `${HOST}/voyager/api/socialDash/normComments?decorationId=x`, CREATE, 'comment');
await expectFetch('rest reply', `${HOST}/voyager/api/socialDash/normComments`, REPLY, 'reply');
await expectFetch('dash-style path', `${HOST}/voyager/api/voyagerSocialDashNormComments?action=create`, CREATE, 'comment');
await expectFetch('legacy contentcreation', `${HOST}/voyager/api/contentcreation/normComments`, LEGACY, 'comment');
await expectFetch('graphql comment create', `${HOST}/voyager/api/graphql?action=execute&queryId=socialDashNormComments.abc`, CREATE, 'comment');
await expectFetch('relative url', `/voyager/api/socialDash/normComments`, CREATE, 'comment');

// --- should NOT count ---
await expectFetch('edit (urn in path)', `${HOST}/voyager/api/socialDash/normComments/urn%3Ali%3Acomment%3A(activity%3A1,2)`, EDIT, null);
await expectFetch('delete action', `${HOST}/voyager/api/socialDash/normComments/urn%3Ali%3Acomment%3A(activity%3A1,2)?action=delete`, '', null);
await expectFetch('graphql reaction', `${HOST}/voyager/api/graphql?action=execute&queryId=socialDashReactions.abc`, REACTION, null);
await expectFetch('graphql feed fetch', `${HOST}/voyager/api/graphql?queryId=feedDashMainFeed.abc`, JSON.stringify({ variables: {} }), null);
await expectFetch('follow patch', `${HOST}/voyager/api/feed/dash/follows`, FOLLOW, null);
await expectFetch('failed request 422', `${HOST}/voyager/api/socialDash/normComments`, CREATE, null, { response: { status: 422, ok: false } });
await expectFetch('failed request 500', `${HOST}/voyager/api/socialDash/normComments`, CREATE, null, { response: { status: 500, ok: false } });
await expectFetch('GET on comment path', `${HOST}/voyager/api/socialDash/normComments?q=comments`, null, null, { method: 'GET' });
await expectFetch('non-voyager POST', `${HOST}/api/analytics/track`, CREATE, null);
await expectFetch('graphql create without commentary', `${HOST}/voyager/api/graphql?queryId=socialDashNormComments.abc`, JSON.stringify({ variables: { x: 1 } }), null);

// --- Request-object input (LinkedIn sometimes builds a Request) ---
{
  const before = captured.length;
  nextResponse = { status: 201, ok: true };
  const req = {
    url: `${HOST}/voyager/api/socialDash/normComments`,
    method: 'POST',
    clone: () => ({ text: () => Promise.resolve(CREATE) }),
  };
  await window.fetch(req);
  await tick();
  const got = captured.slice(before);
  if (got.length === 1 && got[0].kind === 'comment') console.log('ok   Request object input');
  else { fails++; console.log('FAIL Request object input:', JSON.stringify(got)); }
}

// --- XHR path ---
{
  const before = captured.length;
  const xhr = new ctx.XMLHttpRequest();
  xhr.open('POST', `${HOST}/voyager/api/socialDash/normComments`);
  xhr.send(CREATE);
  xhr.finish(201);
  await tick();
  const got = captured.slice(before);
  if (got.length === 1 && got[0].kind === 'comment') console.log('ok   xhr create');
  else { fails++; console.log('FAIL xhr create:', JSON.stringify(got)); }
}
{
  const before = captured.length;
  const xhr = new ctx.XMLHttpRequest();
  xhr.open('POST', `${HOST}/voyager/api/socialDash/normComments`);
  xhr.send(CREATE);
  xhr.finish(403);
  await tick();
  if (captured.length === before) console.log('ok   xhr failure not counted');
  else { fails++; console.log('FAIL xhr failure not counted'); }
}

// --- endpoints that moved / other shapes ---
const SHARE = JSON.stringify({ commentary: { text: 'my new post' }, visibility: 'ANYONE', origin: 'FEED', allowedCommentersScope: 'ALL' });
await expectFetch('feed/comments path (no "norm")', `${HOST}/voyager/api/feed/comments`, CREATE, 'comment');
await expectFetch('unknown path, thread in body', `${HOST}/voyager/api/socialDash/somethingNew`, CREATE, 'comment');
await expectFetch('post creation not counted', `${HOST}/voyager/api/contentcreation/normShares`, SHARE, null);
await expectFetch('post creation via ugcPosts', `${HOST}/voyager/api/ugcPosts`, SHARE, null);
await expectFetch('comments/<urn> edit', `${HOST}/voyager/api/feed/comments/urn%3Ali%3Acomment%3A123`, CREATE, null);

// non-string bodies
{
  const before = captured.length;
  nextResponse = { status: 200, ok: true };
  await window.fetch(`${HOST}/voyager/api/socialDash/normComments`, { method: 'POST', body: new ctx.Blob([CREATE]) });
  await tick();
  const got = captured.slice(before);
  if (got.length === 1) console.log('ok   blob body');
  else { fails++; console.log('FAIL blob body:', JSON.stringify(got)); }
}
{
  const before = captured.length;
  const xhr = new ctx.XMLHttpRequest();
  xhr.open('POST', `${HOST}/voyager/api/socialDash/normComments`);
  xhr.send(new ctx.Blob([REPLY]));
  xhr.finish(201);
  await tick();
  await tick();
  const got = captured.slice(before);
  if (got.length === 1 && got[0].kind === 'reply') console.log('ok   xhr blob reply');
  else { fails++; console.log('FAIL xhr blob reply:', JSON.stringify(got)); }
}

// --- a failing request must not surface as an extension error ---
// The wrapper must hand back the ORIGINAL promise. Returning a derived one
// makes the page's own unhandled rejections get blamed on this extension
// (chrome://extensions: "Uncaught (in promise) TypeError: Failed to fetch").
{
  const rejection = Promise.reject(new TypeError('Failed to fetch'));
  rejection.catch(() => {}); // keep node quiet; identity is what we assert
  const original = { p: rejection };
  window.fetch = () => original.p;
  // re-wrap a fresh interceptor over this fetch
  const ctx2 = vm.createContext({
    window: { ...window, __LCT_PATCHED__: false, fetch: () => original.p },
    XMLHttpRequest: FakeXHR, console, Promise, Date, Math, URL, URLSearchParams, Blob,
    Object, String, Number, JSON, setTimeout,
  });
  ctx2.window.window = ctx2.window;
  vm.runInContext(fs.readFileSync(`${ROOT}/src/interceptor.js`, 'utf8'), ctx2, { filename: 'interceptor.js' });
  const returned = ctx2.window.fetch(`${HOST}/voyager/api/socialDash/normComments`, { method: 'POST', body: CREATE });
  returned.catch(() => {});
  if (returned === original.p) console.log('ok   failed fetch returns the original promise');
  else { fails++; console.log('FAIL failed fetch returns the original promise'); }

  let unhandled = null;
  process.on('unhandledRejection', (e) => { unhandled = e; });
  await tick();
  if (!unhandled) console.log('ok   no unhandled rejection from the wrapper');
  else { fails++; console.log('FAIL unhandled rejection:', unhandled && unhandled.message); }
}

// --- event shape + unique ids ---
const ids = new Set(captured.map((c) => c.id));
if (ids.size !== captured.length) { fails++; console.log('FAIL duplicate ids emitted'); }
else console.log('ok   ids unique');
if (captured.every((c) => c.source === 'LCT' && c.type === 'comment_created' && !JSON.stringify(c).includes('great post'))) {
  console.log('ok   event shape carries no comment text');
} else { fails++; console.log('FAIL event shape'); }

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
