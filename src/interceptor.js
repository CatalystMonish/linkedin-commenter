/*
 * Runs in the page's MAIN world at document_start.
 *
 * Patches fetch and XMLHttpRequest so we can see LinkedIn's own comment-create
 * request. Nothing but a boolean and a "comment"/"reply" label ever leaves the
 * page — comment text is never read out, stored or forwarded.
 */
(function () {
  if (window.__LCT_PATCHED__) return;
  window.__LCT_PATCHED__ = true;

  const SOURCE = 'LCT';

  // Cheap gate: anything worth a second look is a POST to the voyager API.
  const VOYAGER_RE = /\/voyager\/api\//i;
  // REST comment collection, e.g. /voyager/api/socialDash/normComments
  const REST_COMMENT_RE = /normComments(\/[^/]+)?\/?$/i;
  const GRAPHQL_RE = /\/voyager\/api\/graphql/i;
  // The graphql endpoint carries reactions, follows and feed fetches too, so a
  // create has to name itself.
  const GRAPHQL_CREATE_RE = /(normComments|createComment|commentCreate)/i;

  let debug = false;
  try {
    debug = window.localStorage.getItem('LCT_DEBUG') === '1';
  } catch (e) { /* storage can be blocked; ignore */ }

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.source !== SOURCE || d.type !== 'set_debug') return;
    debug = !!d.value;
  });

  function log() {
    if (!debug) return;
    console.debug('[LCT]', ...arguments);
  }

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'lct-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  function pathOf(url) {
    try {
      return new URL(url, window.location.origin).pathname;
    } catch (e) {
      return String(url).split('?')[0];
    }
  }

  function isCandidate(url, method) {
    return String(method || 'GET').toUpperCase() === 'POST' && VOYAGER_RE.test(String(url));
  }

  /**
   * A trailing URN segment after normComments means we are addressing an
   * existing comment — an edit or a delete, not a new one.
   */
  function isRestCreatePath(pathname) {
    const m = pathname.match(REST_COMMENT_RE);
    return !!m && !m[1];
  }

  function looksLikeComment(body) {
    if (!body) return false;
    // A partial update ({"patch":{"$set":...}}) is an edit.
    if (/"patch"\s*:/.test(body)) return false;
    if (/"commentary"\s*:/.test(body)) return true;
    if (/"commentV2"\s*:/.test(body)) return true;
    return /"comment"\s*:\s*\{[\s\S]{0,400}?"(text|values)"\s*:/.test(body);
  }

  function isReply(body) {
    return /"parentComment(Urn)?"\s*:\s*["{]/.test(body || '');
  }

  /** Decide whether a finished request created a comment. */
  function classify(url, body) {
    const pathname = pathOf(url);
    if (REST_COMMENT_RE.test(pathname)) {
      if (!isRestCreatePath(pathname)) return { match: false, why: 'urn in path (edit/delete)' };
      if (!looksLikeComment(body)) return { match: false, why: 'body is not a comment create' };
      return { match: true, kind: isReply(body) ? 'reply' : 'comment' };
    }
    if (GRAPHQL_RE.test(pathname)) {
      if (!GRAPHQL_CREATE_RE.test(String(url)) && !GRAPHQL_CREATE_RE.test(body || '')) {
        return { match: false, why: 'graphql, not a comment operation' };
      }
      if (!looksLikeComment(body)) return { match: false, why: 'graphql, body is not a comment create' };
      return { match: true, kind: isReply(body) ? 'reply' : 'comment' };
    }
    return { match: false, why: 'not a comment endpoint' };
  }

  function evaluate(url, body, status, ok) {
    const verdict = classify(url, body);
    log(ok ? 'POST' : 'POST (failed)', status, pathOf(url), verdict.match ? `MATCH ${verdict.kind}` : `skip: ${verdict.why}`);
    if (!verdict.match || !ok) return;
    window.postMessage(
      { source: SOURCE, type: 'comment_created', id: uuid(), kind: verdict.kind, ts: Date.now() },
      window.location.origin
    );
  }

  /* ---------- fetch ---------- */

  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      let url = null;
      let method = 'GET';
      let bodyPromise = null;
      try {
        if (typeof input === 'string' || input instanceof URL) {
          url = String(input);
          method = (init && init.method) || 'GET';
        } else if (input && typeof input === 'object') {
          url = input.url;
          method = (init && init.method) || input.method || 'GET';
        }
        if (isCandidate(url, method)) {
          if (init && typeof init.body === 'string') {
            bodyPromise = Promise.resolve(init.body);
          } else if (input && typeof input === 'object' && typeof input.clone === 'function') {
            // Clone before the request is sent, otherwise the body is gone.
            bodyPromise = input.clone().text().catch(() => null);
          } else if (init && init.body) {
            bodyPromise = Promise.resolve(null);
          }
        } else {
          url = null;
        }
      } catch (e) {
        url = null;
      }

      const call = origFetch.apply(this, arguments);
      if (!url) return call;

      return call.then((res) => {
        try {
          Promise.resolve(bodyPromise)
            .then((body) => evaluate(url, body, res.status, res.ok))
            .catch(() => {});
        } catch (e) { /* never break the page */ }
        return res;
      });
    };
  }

  /* ---------- XMLHttpRequest ---------- */

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      this.__lct = { method, url };
    } catch (e) { /* ignore */ }
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    try {
      const meta = this.__lct;
      if (meta && isCandidate(meta.url, meta.method)) {
        const bodyText = typeof body === 'string' ? body : null;
        const xhr = this;
        this.addEventListener('loadend', function () {
          try {
            evaluate(meta.url, bodyText, xhr.status, xhr.status >= 200 && xhr.status < 300);
          } catch (e) { /* ignore */ }
        });
      }
    } catch (e) { /* never break the page */ }
    return origSend.apply(this, arguments);
  };

  log('interceptor installed');
})();
