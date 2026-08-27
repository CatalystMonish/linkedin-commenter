/* Local-timezone day keys. Every total is derived from these at read time,
   so nothing has to be reset at midnight. */
(function (root) {
  const LCT = (root.LCT = root.LCT || {});

  /** YYYY-MM-DD in the user's local timezone. */
  function localDayKey(date) {
    const d = date || new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function addDays(date, n) {
    const d = new Date(date.getTime());
    d.setDate(d.getDate() + n);
    return d;
  }

  function keysBetween(start, end) {
    const keys = [];
    let cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    while (cur <= last) {
      keys.push(localDayKey(cur));
      cur = addDays(cur, 1);
    }
    return keys;
  }

  /** Day keys from the start of the current week through today. */
  function weekKeys(weekStart, now) {
    const today = now || new Date();
    const start = (weekStart === 0 || weekStart === 1) ? weekStart : 1;
    const back = (today.getDay() - start + 7) % 7;
    return keysBetween(addDays(today, -back), today);
  }

  /** Day keys from the 1st of the current calendar month through today. */
  function monthKeys(now) {
    const today = now || new Date();
    return keysBetween(new Date(today.getFullYear(), today.getMonth(), 1), today);
  }

  /** The last n day keys, oldest first, ending today. */
  function lastNDays(n, now) {
    const today = now || new Date();
    return keysBetween(addDays(today, -(n - 1)), today);
  }

  function daysAgo(dayKey, now) {
    const [y, m, d] = dayKey.split('-').map(Number);
    const then = new Date(y, m - 1, d);
    const today = now || new Date();
    const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return Math.round((base - then) / 86400000);
  }

  /** "Mon 27" style short label for charts. */
  function shortLabel(dayKey) {
    const [y, m, d] = dayKey.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString(undefined, { weekday: 'short' });
  }

  LCT.dates = { localDayKey, addDays, keysBetween, weekKeys, monthKeys, lastNDays, daysAgo, shortLabel };
})(typeof self !== 'undefined' ? self : globalThis);
