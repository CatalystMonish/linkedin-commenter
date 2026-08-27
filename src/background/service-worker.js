/* MV3 service worker: dedupe, count, badge. Classic worker so it can
   importScripts the shared libs (no bundler in this project). */
importScripts('/src/lib/constants.js', '/src/lib/dates.js', '/src/lib/storage.js');

const { MSG } = LCT;

function badgeText(n) {
  if (!n) return '';
  return n > 999 ? '999+' : String(n);
}

async function refreshBadge(summary) {
  const s = summary || (await LCT.storage.getSummary());
  await chrome.action.setBadgeBackgroundColor({ color: '#0a66c2' });
  await chrome.action.setBadgeText({ text: badgeText(s.today) });
  return s;
}

function broadcast(summary) {
  // Popup/widget also watch storage.onChanged, so a missing receiver is fine.
  try {
    const p = chrome.runtime.sendMessage({ type: MSG.SUMMARY_UPDATED, summary });
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (e) { /* no listeners */ }
}

/* Observed-request reports arrive in bursts; batch them so a busy feed doesn't
   hammer storage. */
let observedQueue = [];
let flushTimer = null;

function queueObserved(item) {
  observedQueue.push(item);
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    const batch = observedQueue;
    observedQueue = [];
    flushTimer = null;
    LCT.storage.noteObserved(batch);
  }, 2000);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return;

  if (message.type === MSG.HELLO) {
    LCT.storage.noteHello(message.which, message.at || Date.now());
    return;
  }

  if (message.type === MSG.OBSERVED) {
    queueObserved(message);
    return;
  }

  if (message.type === MSG.RESET_DIAG) {
    LCT.storage.resetDiag().then(sendResponse);
    return true;
  }

  if (message.type === MSG.COMMENT_CREATED) {
    // Only trust events relayed from a LinkedIn tab.
    const url = sender && sender.url ? sender.url : '';
    if (!/^https:\/\/[a-z.]*linkedin\.com\//.test(url)) {
      console.debug('[LCT] event rejected, sender is not LinkedIn:', url);
      return;
    }

    LCT.storage.recordComment(message.id, message.kind, message.via).then(async ({ counted, reason, summary }) => {
      console.debug('[LCT]', message.via || 'network', 'event', message.kind, counted ? 'counted' : 'ignored: ' + reason, summary);
      if (message.via === 'dom') LCT.storage.noteDomSubmit(Date.now());
      if (!counted) return;
      await refreshBadge(summary);
      broadcast(summary);
    });
    return; // no response needed
  }

  if (message.type === MSG.GET_SUMMARY) {
    LCT.storage.getSummary().then(sendResponse);
    return true;
  }

  if (message.type === MSG.ADJUST) {
    LCT.storage.adjust(message.dayKey || LCT.dates.localDayKey(), message.delta | 0).then(async (summary) => {
      await refreshBadge(summary);
      broadcast(summary);
      sendResponse(summary);
    });
    return true;
  }

  if (message.type === MSG.SET_SETTING) {
    LCT.storage.setSetting(message.key, message.value).then(sendResponse);
    return true;
  }
});

async function init() {
  await LCT.storage.prune();
  await refreshBadge();
}

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);
// The worker also wakes for messages; keep the badge honest across day rollover.
init();
