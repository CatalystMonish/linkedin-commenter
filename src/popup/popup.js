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
    detection: $('#detection'),
    diag: $('#diag'),
    copyDiag: $('#copyDiag'),
    resetDiag: $('#resetDiag'),
  };

  let lastState = null;

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

  function renderDetection(detection) {
    const d = detection || {};
    const mode = d.networkSeen ? 'network' : 'click detection';
    const last = d.lastEventAt
      ? new Date(d.lastEventAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : 'nothing counted yet';
    els.detection.textContent = `Detection: ${mode} \u00b7 last: ${last}`;
  }

  function time(ts) {
    return ts ? new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : null;
  }

  function renderDiag(state) {
    const d = state.diag || {};
    const yes = (ts) => (ts ? `<span class="good">loaded ${time(ts)}</span>` : '<span class="bad">NOT LOADED</span>');
    const skips = (d.skips || [])
      .map((s) => `<li>${s.status} ${s.path} &mdash; ${s.why || 'counted'}</li>`)
      .join('');
    els.diag.innerHTML = `
      <div><span class="k">Interceptor:</span> ${yes(d.interceptorAt)}</div>
      <div><span class="k">DOM fallback:</span> ${yes(d.domAt)}</div>
      <div><span class="k">Candidate POSTs seen:</span> ${d.postsSeen || 0}</div>
      <div><span class="k">Last editor submit:</span> ${time(d.lastDomAt) || 'never'}</div>
      <div><span class="k">Network detection:</span> ${state.detection && state.detection.networkSeen ? '<span class="good">working</span>' : '<span class="bad">never matched</span>'}</div>
      ${skips ? `<div class="k" style="margin-top:6px">Recent rejects:</div><ul>${skips}</ul>` : ''}
    `;
  }

  async function refresh() {
    const state = await storage.getState();
    renderSummary(storage.summarise(state));
    renderChart(state);
    renderSettings(state.settings);
    renderDetection(state.detection);
    renderDiag(state);
    lastState = state;
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

  els.copyDiag.addEventListener('click', async () => {
    const payload = JSON.stringify(
      { diag: lastState && lastState.diag, detection: lastState && lastState.detection, days: lastState && lastState.days },
      null, 2
    );
    try {
      await navigator.clipboard.writeText(payload);
      els.copyDiag.textContent = 'Copied';
      setTimeout(() => { els.copyDiag.textContent = 'Copy'; }, 1200);
    } catch (e) {
      els.diag.textContent = payload; // clipboard blocked: show it instead
    }
  });

  els.resetDiag.addEventListener('click', async () => {
    await send({ type: MSG.RESET_DIAG });
    refresh();
  });

  els.date.textContent = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  refresh();
})();
