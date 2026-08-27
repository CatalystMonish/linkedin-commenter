/* Floating counter card on LinkedIn. Isolated world + shadow DOM, so page CSS
   and our CSS can't reach each other. */
(function () {
  const LCT = globalThis.LCT;
  const { MSG } = LCT;

  const ROOT_ID = 'lct-root';
  const DRAG_THRESHOLD = 4; // px of movement before a press counts as a drag

  const CSS = `
    :host { all: initial; }
    .card {
      position: fixed;
      z-index: 2147483000;
      min-width: 168px;
      box-sizing: border-box;
      padding: 12px 14px;
      border-radius: 12px;
      background: #1a6dff;
      color: #fff;
      font: 400 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.28);
      user-select: none;
      -webkit-user-select: none;
      transition: opacity 120ms ease;
    }
    .card.dragging { opacity: 0.9; cursor: grabbing; }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      cursor: grab;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0.2px;
    }
    .card.dragging .head { cursor: grabbing; }
    .chev {
      opacity: 0.85;
      font-size: 11px;
      line-height: 1;
      transform: rotate(0deg);
      transition: transform 120ms ease;
    }
    .card.collapsed .chev { transform: rotate(-90deg); }
    .rows { margin-top: 8px; display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; }
    .card.collapsed .rows { display: none; }
    .label { opacity: 0.92; white-space: nowrap; }
    .value { font-weight: 700; font-variant-numeric: tabular-nums; text-align: right; }
    .today-inline { display: none; font-weight: 700; font-variant-numeric: tabular-nums; }
    .card.collapsed .today-inline { display: inline; }
    @media (prefers-color-scheme: dark) {
      .card { box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5); }
    }
  `;

  let host = null;
  let card = null;
  let els = null;
  let settings = { ...LCT.DEFAULT_SETTINGS };
  let observer = null;

  function build() {
    host = document.createElement('div');
    host.id = ROOT_ID;
    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = CSS;

    card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="head" part="head">
        <span>Comments <span class="today-inline">0</span></span>
        <span class="chev">&#9660;</span>
      </div>
      <div class="rows">
        <span class="label">Today</span><span class="value" data-k="today">0</span>
        <span class="label">This Week</span><span class="value" data-k="week">0</span>
        <span class="label">This Month</span><span class="value" data-k="month">0</span>
      </div>
    `;

    shadow.append(style, card);
    els = {
      today: card.querySelector('[data-k="today"]'),
      week: card.querySelector('[data-k="week"]'),
      month: card.querySelector('[data-k="month"]'),
      inline: card.querySelector('.today-inline'),
      head: card.querySelector('.head'),
    };

    wireDrag();
    applyCollapsed();
    applyPosition(settings.widgetPos);
    document.body.appendChild(host);
  }

  function render(summary) {
    if (!els || !summary) return;
    els.today.textContent = summary.today;
    els.week.textContent = summary.week;
    els.month.textContent = summary.month;
    els.inline.textContent = summary.today;
  }

  function applyCollapsed() {
    card.classList.toggle('collapsed', !!settings.widgetCollapsed);
  }

  function clamp(pos) {
    const rect = card.getBoundingClientRect();
    const w = rect.width || 180;
    const h = rect.height || 100;
    return {
      x: Math.min(Math.max(8, pos.x), Math.max(8, window.innerWidth - w - 8)),
      y: Math.min(Math.max(8, pos.y), Math.max(8, window.innerHeight - h - 8)),
    };
  }

  function applyPosition(pos) {
    if (!pos) {
      // Default: top right, below LinkedIn's fixed nav.
      card.style.left = '';
      card.style.bottom = '';
      card.style.right = '22px';
      card.style.top = '60px';
      return;
    }
    const p = clamp(pos);
    card.style.right = '';
    card.style.bottom = '';
    card.style.left = p.x + 'px';
    card.style.top = p.y + 'px';
  }

  function wireDrag() {
    let start = null;
    let moved = false;

    els.head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const rect = card.getBoundingClientRect();
      start = { px: e.clientX, py: e.clientY, x: rect.left, y: rect.top };
      moved = false;
      els.head.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    els.head.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dx = e.clientX - start.px;
      const dy = e.clientY - start.py;
      if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      moved = true;
      card.classList.add('dragging');
      applyPosition({ x: start.x + dx, y: start.y + dy });
    });

    function end(e) {
      if (!start) return;
      const wasDrag = moved;
      start = null;
      moved = false;
      card.classList.remove('dragging');
      try { els.head.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }

      if (wasDrag) {
        const rect = card.getBoundingClientRect();
        save('widgetPos', { x: Math.round(rect.left), y: Math.round(rect.top) });
      } else {
        settings.widgetCollapsed = !settings.widgetCollapsed;
        applyCollapsed();
        save('widgetCollapsed', settings.widgetCollapsed);
      }
    }

    els.head.addEventListener('pointerup', end);
    els.head.addEventListener('pointercancel', end);
  }

  function save(key, value) {
    settings[key] = value;
    LCT.storage.setSetting(key, value).catch(() => {});
  }

  function mount() {
    if (!settings.widgetEnabled) return unmount();
    if (host && host.isConnected) return;
    if (!document.body) return;
    if (host) {
      document.body.appendChild(host); // re-attach after a SPA re-render
      return;
    }
    build();
  }

  function unmount() {
    if (host && host.isConnected) host.remove();
  }

  /** LinkedIn is a SPA and can replace body children on navigation. */
  function watchDom() {
    if (observer) return;
    observer = new MutationObserver(() => {
      if (settings.widgetEnabled && host && !host.isConnected) mount();
    });
    observer.observe(document.documentElement, { childList: true });
    observer.observe(document.body, { childList: true });
  }

  async function init() {
    const state = await LCT.storage.getState();
    settings = state.settings;
    if (!settings.widgetEnabled) return;
    mount();
    render(LCT.storage.summarise(state));
    watchDom();

    window.addEventListener('resize', () => {
      if (settings.widgetPos && card) applyPosition(settings.widgetPos);
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[LCT.STORAGE_KEY]) return;
      const next = changes[LCT.STORAGE_KEY].newValue;
      if (!next) return;
      const prevEnabled = settings.widgetEnabled;
      settings = { ...LCT.DEFAULT_SETTINGS, ...(next.settings || {}) };
      if (!settings.widgetEnabled) {
        unmount();
        return;
      }
      if (!prevEnabled) mount();
      if (card) {
        applyCollapsed();
        applyPosition(settings.widgetPos);
      }
      render(LCT.storage.summarise({ ...next, settings }));
    });

    chrome.runtime.onMessage.addListener((message) => {
      if (message && message.type === MSG.SUMMARY_UPDATED) render(message.summary);
    });
  }

  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init, { once: true });
})();
