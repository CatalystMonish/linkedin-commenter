/* chrome.storage.local access. All writes go through a promise chain so two
   comments landing in the same tick can't lose an increment. */
(function (root) {
  const LCT = (root.LCT = root.LCT || {});
  const { STORAGE_KEY, SCHEMA_VERSION, MAX_SEEN_IDS, RETENTION_DAYS, DEFAULT_SETTINGS } = LCT;

  let queue = Promise.resolve();

  function emptyState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      days: {},          // "YYYY-MM-DD" -> { total, replies }
      settings: { ...DEFAULT_SETTINGS },
      seenIds: [],       // FIFO of recent event ids, newest last
    };
  }

  function migrate(state) {
    if (!state || typeof state !== 'object') return emptyState();
    const next = { ...emptyState(), ...state };
    next.days = state.days && typeof state.days === 'object' ? state.days : {};
    next.settings = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
    next.seenIds = Array.isArray(state.seenIds) ? state.seenIds : [];
    next.schemaVersion = SCHEMA_VERSION;
    return next;
  }

  function getState() {
    return chrome.storage.local.get(STORAGE_KEY).then((res) => migrate(res[STORAGE_KEY]));
  }

  function setState(state) {
    return chrome.storage.local.set({ [STORAGE_KEY]: state }).then(() => state);
  }

  /** Serialise a read-modify-write. `fn(state)` mutates and returns anything. */
  function update(fn) {
    const run = queue.then(async () => {
      const state = await getState();
      const result = fn(state);
      await setState(state);
      return { state, result };
    });
    // Keep the chain alive even if one update throws.
    queue = run.catch(() => {});
    return run;
  }

  function dayBucket(state, dayKey) {
    if (!state.days[dayKey]) state.days[dayKey] = { total: 0, replies: 0 };
    return state.days[dayKey];
  }

  function sum(state, keys) {
    let n = 0;
    for (const k of keys) n += (state.days[k] && state.days[k].total) || 0;
    return n;
  }

  function summarise(state, now) {
    const d = LCT.dates;
    const weekStart = state.settings.weekStart;
    return {
      today: sum(state, [d.localDayKey(now)]),
      week: sum(state, d.weekKeys(weekStart, now)),
      month: sum(state, d.monthKeys(now)),
    };
  }

  function getSummary() {
    return getState().then((state) => summarise(state));
  }

  /**
   * Record one comment. Returns { counted, summary } — counted is false when
   * the event id was already seen.
   */
  function recordComment(eventId, kind) {
    return update((state) => {
      if (eventId && state.seenIds.includes(eventId)) return { counted: false };
      if (eventId) {
        state.seenIds.push(eventId);
        if (state.seenIds.length > MAX_SEEN_IDS) {
          state.seenIds.splice(0, state.seenIds.length - MAX_SEEN_IDS);
        }
      }
      const bucket = dayBucket(state, LCT.dates.localDayKey());
      bucket.total += 1;
      if (kind === 'reply') bucket.replies += 1;
      return { counted: true };
    }).then(({ state, result }) => ({ counted: result.counted, summary: summarise(state) }));
  }

  /** Manual correction from the popup. Never goes below zero. */
  function adjust(dayKey, delta) {
    return update((state) => {
      const bucket = dayBucket(state, dayKey);
      bucket.total = Math.max(0, bucket.total + delta);
      bucket.replies = Math.min(bucket.replies, bucket.total);
      if (bucket.total === 0 && bucket.replies === 0) delete state.days[dayKey];
    }).then(({ state }) => summarise(state));
  }

  function setSetting(key, value) {
    return update((state) => {
      state.settings[key] = value;
    }).then(({ state }) => state.settings);
  }

  /** Drop day buckets past the retention window. */
  function prune() {
    return update((state) => {
      for (const key of Object.keys(state.days)) {
        if (LCT.dates.daysAgo(key) > RETENTION_DAYS) delete state.days[key];
      }
    }).then(({ state }) => state);
  }

  LCT.storage = {
    emptyState, getState, setState, getSummary, summarise,
    recordComment, adjust, setSetting, prune, STORAGE_KEY,
  };
})(typeof self !== 'undefined' ? self : globalThis);
