(function () {
  const { MSG, dates, storage } = LCT;

  const $ = (sel) => document.querySelector(sel);
  const els = {
    today: $('[data-k="today"]'),
    week: $('[data-k="week"]'),
    month: $('[data-k="month"]'),
    todayCount: $('#todayCount'),
    bars: $('#bars'),
    peak: $('#peak'),
    date: $('#date'),
    minus: $('#minus'),
    plus: $('#plus'),
    widgetEnabled: $('#widgetEnabled'),
    weekStart: $('#weekStart'),
    debug: $('#debug'),
  };

  function send(message) {
    return chrome.runtime.sendMessage(message);
  }

  function renderSummary(summary) {
    els.today.textContent = summary.today;
    els.week.textContent = summary.week;
    els.month.textContent = summary.month;
    els.todayCount.textContent = summary.today;
  }

  function renderChart(state) {
    const keys = dates.lastNDays(7);
    const values = keys.map((k) => (state.days[k] && state.days[k].total) || 0);
    const peak = Math.max(1, ...values);
    const todayKey = dates.localDayKey();

    els.peak.textContent = `peak ${Math.max(...values)}`;
    els.bars.textContent = '';
    keys.forEach((key, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'bar-wrap';
      const bar = document.createElement('div');
      bar.className = 'bar' + (key === todayKey ? ' today' : '');
      bar.style.height = Math.round((values[i] / peak) * 40) + 'px';
      bar.title = `${key}: ${values[i]}`;
      const label = document.createElement('span');
      label.className = 'bar-label';
      label.textContent = dates.shortLabel(key).slice(0, 1);
      wrap.append(bar, label);
      els.bars.appendChild(wrap);
    });
  }

  function renderSettings(settings) {
    els.widgetEnabled.checked = !!settings.widgetEnabled;
    els.weekStart.value = String(settings.weekStart);
    els.debug.checked = !!settings.debug;
  }

  async function refresh() {
    const state = await storage.getState();
    renderSummary(storage.summarise(state));
    renderChart(state);
    renderSettings(state.settings);
  }

  async function adjust(delta) {
    const summary = await send({ type: MSG.ADJUST, dayKey: dates.localDayKey(), delta });
    if (summary) renderSummary(summary);
    const state = await storage.getState();
    renderChart(state);
  }

  els.minus.addEventListener('click', () => adjust(-1));
  els.plus.addEventListener('click', () => adjust(1));

  els.widgetEnabled.addEventListener('change', () =>
    send({ type: MSG.SET_SETTING, key: 'widgetEnabled', value: els.widgetEnabled.checked })
  );
  els.debug.addEventListener('change', () =>
    send({ type: MSG.SET_SETTING, key: 'debug', value: els.debug.checked })
  );
  els.weekStart.addEventListener('change', async () => {
    await send({ type: MSG.SET_SETTING, key: 'weekStart', value: Number(els.weekStart.value) });
    refresh();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === MSG.SUMMARY_UPDATED) refresh();
  });

  els.date.textContent = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  refresh();
})();
