// Simulator verification: session history recording (no real device needed).
// Drives the REAL completion path: inject a short RUNNING session, let the
// timer actually count it down to completion, and assert exactly one record is
// written to group-timer-history with correct round count and aggregated
// work/rest totals; then assert the history page renders it.
import automator from 'miniprogram-automator';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
process.on('unhandledRejection', async (e) => {
  try {
    await mp?.disconnect?.();
  } catch (_) {}
  console.error('UNHANDLED REJECTION:', e && e.message);
  process.exit(1);
});
let pass = 0,
  fail = 0;
const check = (name, cond) => {
  if (cond) {
    pass++;
    console.log('PASS ' + name);
  } else {
    fail++;
    console.log('FAIL ' + name);
  }
};

const HISTORY = 'group-timer-history';
const SESSION = 'group-timer-session';

const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
try {
  // A 2-round session, 1s work / 0s rest each -> completes in ~2.5s on the timer.
  await mp.evaluate(
    (p) => {
      const now = Date.now();
      const snap = {
        status: 'running',
        phase: 'work',
        currentRoundIndex: 0,
        rounds: [
          { name: '深蹲', workSec: 1, restSec: 0 },
          { name: '俯卧撑', workSec: 1, restSec: 0 },
        ],
        phaseStartedAt: now,
        endTimestamp: now + 1000,
        startedAt: now,
        updatedAt: now,
      };
      wx.removeStorageSync(p.hist);
      wx.removeStorageSync(p.sess);
      wx.setStorageSync(p.sess, snap);
      wx.reLaunch({ url: '/pages/timer/timer' });
    },
    { sess: SESSION, hist: HISTORY },
  );
  await sleep(3000); // let it count down + complete (spans several 250ms ticks -> guard must hold)

  const rec = await mp.evaluate((hist) => (wx.getStorageSync(hist) || [])[0], HISTORY);
  check('history recorded 1 entry', !!rec);
  check('history rounds=2', rec && rec.rounds === 2);
  check('history totalWorkSec=2', rec && rec.totalWorkSec === 2); // 1+1
  check('history totalRestSec=0', rec && rec.totalRestSec === 0);
  check('history label=深蹲', rec && rec.label === '深蹲');
  const len = await mp.evaluate((hist) => (wx.getStorageSync(hist) || []).length, HISTORY);
  check('no duplicate across render ticks', rec && len === 1);

  // History page renders the entry.
  await mp.evaluate(() => wx.reLaunch({ url: '/pages/history/history' }));
  await sleep(1200);
  const view = await mp.evaluate(() => {
    const h = getCurrentPages().find((p) => (p.route || p.__route__) === 'pages/history/history');
    return h ? h.data.items : null;
  });
  check('history page lists entry', view && view.length === 1);
  check('history page shows rounds', view && view[0] && view[0].rounds === 2);

  await mp.evaluate((hist) => wx.removeStorageSync(hist), HISTORY);
} catch (e) {
  console.log('ERROR ' + e.message);
  fail++;
}
console.log(`\nRESULT history: ${pass} pass / ${fail} fail`);
await mp.disconnect();
process.exit(fail ? 1 : 0);
