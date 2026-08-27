import fs from 'fs';
import vm from 'vm';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let store = {};
const chrome = {
  storage: {
    local: {
      get: (k) => Promise.resolve(store[k] === undefined ? {} : { [k]: JSON.parse(JSON.stringify(store[k])) }),
      set: (obj) => { Object.assign(store, JSON.parse(JSON.stringify(obj))); return Promise.resolve(); },
    },
  },
};
const ctx = vm.createContext({ chrome, console, Promise, Date, Math, Object, Array, JSON, String, Number });
for (const f of ['src/lib/constants.js', 'src/lib/dates.js', 'src/lib/storage.js']) {
  vm.runInContext(fs.readFileSync(`${ROOT}/${f}`, 'utf8'), ctx, { filename: f });
}
const LCT = ctx.LCT;

let fails = 0;
const eq = (name, a, b) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { fails++; console.log(`FAIL ${name}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); }
  else console.log(`ok   ${name}`);
};

// --- dates ---
const wed = new Date(2026, 7, 26, 15, 0, 0); // Wed 2026-08-26
eq('localDayKey', LCT.dates.localDayKey(wed), '2026-08-26');
eq('weekKeys mon', LCT.dates.weekKeys(1, wed), ['2026-08-24','2026-08-25','2026-08-26']);
eq('weekKeys sun', LCT.dates.weekKeys(0, wed), ['2026-08-23','2026-08-24','2026-08-25','2026-08-26']);
eq('monthKeys len', LCT.dates.monthKeys(wed).length, 26);
eq('monthKeys first', LCT.dates.monthKeys(wed)[0], '2026-08-01');
eq('lastNDays', LCT.dates.lastNDays(3, wed), ['2026-08-24','2026-08-25','2026-08-26']);
const sun = new Date(2026, 7, 23, 9, 0, 0); // Sunday
eq('weekKeys mon on sunday', LCT.dates.weekKeys(1, sun), ['2026-08-17','2026-08-18','2026-08-19','2026-08-20','2026-08-21','2026-08-22','2026-08-23']);
eq('weekKeys sun on sunday', LCT.dates.weekKeys(0, sun), ['2026-08-23']);
// month boundary
const first = new Date(2026, 8, 1, 1, 0, 0);
eq('monthKeys on the 1st', LCT.dates.monthKeys(first), ['2026-09-01']);
// DST-ish: keysBetween must not skip/duplicate across a spring-forward day (US 2026-03-08)
const dst = new Date(2026, 2, 10, 12, 0);
eq('keysBetween across DST', LCT.dates.keysBetween(new Date(2026, 2, 7), dst), ['2026-03-07','2026-03-08','2026-03-09','2026-03-10']);
eq('daysAgo', LCT.dates.daysAgo('2026-08-24', wed), 2);

// --- storage ---
const t = LCT.dates.localDayKey();
const r1 = await LCT.storage.recordComment('a', 'comment');
eq('first record counted', r1.counted, true);
eq('first record today', r1.summary.today, 1);
const r2 = await LCT.storage.recordComment('a', 'comment');
eq('duplicate id ignored', r2.counted, false);
eq('duplicate leaves count', r2.summary.today, 1);
const r3 = await LCT.storage.recordComment('b', 'reply');
eq('reply counts to total', r3.summary.today, 2);
eq('reply tracked separately', store.lct.days[t].replies, 1);

// concurrent writes must not lose an increment
await Promise.all(['c','d','e','f','g'].map((id) => LCT.storage.recordComment(id, 'comment')));
eq('concurrent increments', (await LCT.storage.getSummary()).today, 7);

eq('adjust down', (await LCT.storage.adjust(t, -3)).today, 4);
eq('adjust cannot go negative', (await LCT.storage.adjust(t, -99)).today, 0);
eq('empty day removed', store.lct.days[t], undefined);
eq('adjust up from zero', (await LCT.storage.adjust(t, 2)).today, 2);

// seenIds cap
store.lct.seenIds = Array.from({ length: LCT.MAX_SEEN_IDS + 50 }, (_, i) => 'x' + i);
await LCT.storage.recordComment('new-one', 'comment');
eq('seenIds capped', store.lct.seenIds.length, LCT.MAX_SEEN_IDS);
eq('newest id retained', store.lct.seenIds[store.lct.seenIds.length - 1], 'new-one');

// prune
store.lct.days['2020-01-01'] = { total: 5, replies: 0 };
await LCT.storage.prune();
eq('old day pruned', store.lct.days['2020-01-01'], undefined);
eq('today survives prune', store.lct.days[t].total, 3);

// settings + summary respects weekStart
await LCT.storage.setSetting('weekStart', 0);
eq('setting persisted', store.lct.settings.weekStart, 0);
// corrupt state recovery
store.lct = { garbage: true };
eq('migrates junk state', (await LCT.storage.getSummary()), { today: 0, week: 0, month: 0 });

// --- detection source gating ---
store.lct = LCT.storage.emptyState();
const dom1 = await LCT.storage.recordComment('dom-1', 'comment', 'dom');
eq('dom counts while network is unproven', dom1.counted, true);
const net1 = await LCT.storage.recordComment('net-1', 'comment', 'network');
eq('network always counts', net1.counted, true);
eq('network marked as working', store.lct.detection.networkSeen, true);
const dom2 = await LCT.storage.recordComment('dom-2', 'comment', 'dom');
eq('dom ignored once network works', dom2.counted, false);
eq('dom ignore reason', dom2.reason, 'dom fallback ignored, network detection works');
eq('total after gating', (await LCT.storage.getSummary()).today, 2);
eq('last source recorded', store.lct.detection.lastVia, 'network');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
