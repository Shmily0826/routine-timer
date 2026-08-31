// Edge-case suite for timer-phase and history-write paths that no other suite covers.
// Drives the real simulator via miniprogram-automator (same prereqs as smoke.mjs:
// DevTools open on this project, `cli auto --auto-port 9420 --trust-project`).
// Covers:
//  - rest = 0s does NOT park the session in a rest phase (skips straight to next work)
//  - completing a session writes exactly ONE history record, with the right fields
//  - the 250ms tick after completion does not append duplicate history records
//  - history is capped at 100 records (newest first, oldest dropped)
//
// NOTE: the timer page's onHide() persists the live session back to storage, so every
// case navigates AWAY to home first, THEN injects storage, then re-enters the timer.
// Injecting before leaving would be overwritten by that onHide persist.
import automator from 'miniprogram-automator';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
process.on('unhandledRejection', async (e) => { try { await mp?.disconnect?.(); } catch (_) {} console.error('UNHANDLED REJECTION:', e && e.message); process.exit(1); });
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + '  :: ' + detail); } };

const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });

// The live session lives on the page instance (`this.session`), not in `data`.
async function timerState() {
  return mp.evaluate(() => {
    const p = getCurrentPages().find((x) => (x.route || x.__route__) === 'pages/timer/timer');
    if (!p || !p.session) return null;
    const s = p.session;
    return { status: s.status, phase: s.phase, idx: s.currentRoundIndex, rounds: s.rounds.length };
  });
}
const history = () => mp.evaluate(() => wx.getStorageSync('group-timer-history'));

// Park on home, inject storage, then re-enter the timer page with a fresh session.
async function enterTimer(inject) {
  await mp.reLaunch('/pages/home/home');
  await sleep(900);
  await mp.evaluate(inject);
  await mp.reLaunch('/pages/timer/timer');
}

try {
  // ---------- rest = 0s is skipped, not parked ----------
  await enterTimer(() => {
    wx.setStorageSync('active-rounds', [
      { name: 'A', workSec: 5, restSec: 0 },
      { name: 'B', workSec: 60, restSec: 0 }
    ]);
    wx.removeStorageSync('group-timer-session');
    wx.removeStorageSync('group-timer-history');
  });
  await sleep(1200);
  let s = await timerState();
  check('zero-rest: starts on round 1 / work', s && s.phase === 'work' && s.idx === 0, JSON.stringify(s));

  // 5s of work must elapse here (reLaunch + page load alone burn 1-2s, so allow plenty).
  await sleep(5200);
  s = await timerState();
  check('zero-rest: 0s rest skipped -> round 2 / work (never parked in rest)',
    s && s.idx === 1 && s.phase === 'work', JSON.stringify(s));
  check('zero-rest: session still running (not completed early)',
    s && s.status === 'running', JSON.stringify(s));

  // ---------- completion writes exactly one history record ----------
  await enterTimer(() => {
    wx.removeStorageSync('group-timer-history');
    wx.setStorageSync('active-rounds', [
      { name: '甲', workSec: 1, restSec: 0 },
      { name: '乙', workSec: 1, restSec: 0 }
    ]);
    wx.removeStorageSync('group-timer-session');
  });
  await sleep(4200); // 2 rounds x 1s
  s = await timerState();
  check('completion: both 1s rounds finish -> status completed', s && s.status === 'completed', JSON.stringify(s));

  let hist = await history();
  check('completion: exactly one history record written', Array.isArray(hist) && hist.length === 1, JSON.stringify(hist && hist.length));
  check('completion: record fields (rounds=2, work=2s, rest=0s, label=甲)',
    hist[0] && hist[0].rounds === 2 && hist[0].totalWorkSec === 2 && hist[0].totalRestSec === 0 && hist[0].label === '甲',
    JSON.stringify(hist[0]));

  // ---------- the 250ms tick after completion must not duplicate the record ----------
  await sleep(2600); // ~10 more render ticks while already completed
  hist = await history();
  check('completion: repeated ticks do not duplicate the record', Array.isArray(hist) && hist.length === 1, 'len=' + (hist && hist.length));

  // ---------- history cap = 100 ----------
  await enterTimer(() => {
    const many = [];
    for (let i = 0; i < 100; i++) many.push({ id: 'old' + i, ts: 1000 + i, rounds: 1, totalWorkSec: 1, totalRestSec: 0, label: 'old' + i });
    wx.setStorageSync('group-timer-history', many);
    wx.setStorageSync('active-rounds', [{ name: '新', workSec: 1, restSec: 0 }]);
    wx.removeStorageSync('group-timer-session');
  });
  await sleep(3600);
  hist = await history();
  check('cap: history stays at 100 records after a new completion', Array.isArray(hist) && hist.length === 100, 'len=' + (hist && hist.length));
  check('cap: newest record is stored first (label=新)', hist && hist[0] && hist[0].label === '新', JSON.stringify(hist && hist[0]));
  check('cap: oldest record dropped (old99 gone)', hist && !hist.some((r) => r.id === 'old99'), 'old99 still present');
  check('cap: earlier records kept (old0 present)', hist && hist.some((r) => r.id === 'old0'), 'old0 missing');

  await mp.evaluate(() => {
    wx.removeStorageSync('group-timer-history');
    wx.removeStorageSync('group-timer-session');
    wx.removeStorageSync('active-rounds');
  });
} catch (e) {
  console.log('RAW ERROR:\n' + ((e && (e.stack || e.message)) || String(e)));
  check('edge suite completed without exception', false, (e && e.message) || String(e));
}
console.log(`\nRESULT edge: ${pass} pass / ${fail} fail`);
await mp.disconnect();
process.exit(fail ? 1 : 0);
