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

  // Cheap gate: a POST to the voyager API, or to anything with "comment" in it.
  const VOYAGER_RE = /\/voyager\/api\//i;
  const COMMENT_HINT_RE = /comment/i;
  // A segment after the comment collection means we address an existing
  // comment: an edit or a delete, not a new one.
  const EXISTING_COMMENT_RE = /(normComments|comments)\/[^/?#]+/i;
  // Creating a post also carries a "commentary" field, so posts/shares are
  // ruled out explicitly.
  const SHARE_RE = /(normShares|ugcPosts|shares|posts|articles)/i;
  // Comment creates always reference the thread they hang off.
  const THREAD_RE = /"(threadUrn|parentComment|parentCommentUrn|postUrn|objectUrn|commentsUrn)"\s*:/;

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

  function isPost(method) {
    return String(method || 'GET').toUpperCase() === 'POST';
  }

  function isCandidate(url, method) {
    if (!isPost(method)) return false;
    const u = String(url || '');
    return VOYAGER_RE.test(u) || COMMENT_HINT_RE.test(u);
  }

  /** Debug mode widens the net to every POST so a moved endpoint is visible. */
  function shouldInspect(url, method) {
    return isCandidate(url, method) || (debug && isPost(method));
  }

  /** Bodies arrive as strings, URLSearchParams, FormData or Blobs. */
  function bodyToText(body) {
    if (body == null) return Promise.resolve(null);
    if (typeof body === 'string') return Promise.resolve(body);
    try {
      if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
        return Promise.resolve(body.toString());
      }
      if (typeof Blob !== 'undefined' && body instanceof Blob && typeof body.text === 'function') {
        return body.text().catch(() => null);
      }
      if (typeof FormData !== 'undefined' && body instanceof FormData) {
        const parts = [];
        body.forEach((v, k) => parts.push(k + '=' + (typeof v === 'string' ? v : '[file]')));
        return Promise.resolve(parts.join('&'));
      }
      if (typeof body.text === 'function') return Promise.resolve(body.text()).catch(() => null);
    } catch (e) { /* fall through */ }
    return Promise.resolve(null);
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

  function skip(why) {
    return { match: false, why: why };
  }

  /**
   * Decide whether a finished request created a comment. Driven by the body
   * rather than the exact path, so LinkedIn moving the endpoint doesn't
   * silently stop the count.
   */
  function classify(url, body) {
    const pathname = pathOf(url);
    const full = String(url);
    if (!looksLikeComment(body)) return skip('body is not a comment create');
    if (EXISTING_COMMENT_RE.test(pathname)) return skip('addresses an existing comment (edit/delete)');

    const pathSaysComment = COMMENT_HINT_RE.test(pathname) || COMMENT_HINT_RE.test(full);
    if (SHARE_RE.test(pathname) && !pathSaysComment) return skip('post/share creation, not a comment');

    const bodySaysThread = THREAD_RE.test(body);
    if (!pathSaysComment && !bodySaysThread) return skip('no comment signal in path or body');

    return { match: true, kind: isReply(body) ? 'reply' : 'comment' };
  }

  function evaluate(url, body, status, ok) {
    const verdict = classify(url, body);
    if (debug) {
      const preview = body ? String(body).slice(0, 220) : '(no body)';
      log(
        'POST', status, pathOf(url),
        verdict.match ? 'MATCH ' + verdict.kind : 'skip: ' + verdict.why,
        ok ? '' : '(request failed)',
        '\n  body:', preview
      );
    }
    if (!verdict.match || !ok) return;
    window.postMessage(
      { source: SOURCE, type: 'comment_created', id: uuid(), kind: verdict.kind, via: 'network', ts: Date.now() },
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
        if (shouldInspect(url, method)) {
          if (init && init.body != null) {
            bodyPromise = bodyToText(init.body);
          } else if (input && typeof input === 'object' && typeof input.clone === 'function') {
            // Clone before the request is sent, otherwise the body is gone.
            bodyPromise = input.clone().text().catch(() => null);
          }
        } else {
          url = null;
        }
      } catch (e) {
        url = null;
      }

      const call = origFetch.apply(this, arguments);
      if (!url) return call;

      // Observe the call, but hand the caller back the original promise. A
      // derived promise would make the page's own unhandled rejections (blocked
      // trackers, aborted requests) surface as errors from this extension, and
      // would put us in the middle of LinkedIn's promise chain for no reason.
      call.then(
        (res) => {
          Promise.resolve(bodyPromise)
            .then((body) => evaluate(url, body, res.status, res.ok))
            .catch(() => {});
        },
        () => { /* request failed; nothing to count */ }
      );

      return call;
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
      if (meta && shouldInspect(meta.url, meta.method)) {
        const bodyPromise = bodyToText(body);
        const xhr = this;
        this.addEventListener('loadend', function () {
          bodyPromise
            .then((text) => evaluate(meta.url, text, xhr.status, xhr.status >= 200 && xhr.status < 300))
            .catch(() => {});
        });
      }
    } catch (e) { /* never break the page */ }
    return origSend.apply(this, arguments);
  };

  log('interceptor installed');
})();
