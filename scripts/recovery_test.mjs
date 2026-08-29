// Cold-start recovery verification (Continue + Discard branches), driven on the
// REAL simulator via miniprogram-automator.
//
// Key lesson from earlier probing: a page's onShow is a FRAMEWORK wrapper
// ([native code]); calling it manually is a no-op. The recovery code only runs
// when the framework fires onShow (cold start / page re-show). So we trigger it
// via the real wx.reLaunch API (NOT mp.reLaunch, which throws in this env),
// after writing a KNOWN unfinished session to storage. That exercises the exact
// production recovery path:
//   storage has an unfinished session -> framework reLaunch -> Home.onShow -> card.
//
// Page state is read back through mp.evaluate (the automator currentPage().data()
// bridge does not reliably reflect nested setData values).
//
//   1. Discard branch: inject + reLaunch -> card shows -> tap 放弃 -> card cleared
//   2. Continue branch: inject + reLaunch -> card shows -> tap 继续训练 -> timer resumes
//   3. cleanup: tap 停止/退出 so the simulator is left tidy
import automator from 'miniprogram-automator';

const WS = process.env.WS_ENDPOINT || 'ws://127.0.0.1:9420';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (ok, label, extra = '') => { if (ok) pass++; else fail++; console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : '')); };

const mp = await automator.connect({ wsEndpoint: WS });

const readData = async (route) => {
  for (let i = 0; i < 6; i++) {
    try {
      const d = await mp.evaluate((rt) => {
        const t = getCurrentPages().find((p) => (p.route || p.__route__) === rt);
        return t ? t.data : null;
      }, route);
      if (d) return d;
    } catch (_) {}
    await sleep(700);
  }
  return null;
};

const injectAndFire = async () => {
  await mp.evaluate(() => {
    const now = Date.now();
    const rounds = [
      { name: '第一组', workSec: 600, restSec: 60 },
      { name: '第二组', workSec: 600, restSec: 60 },
      { name: '第三组', workSec: 600, restSec: 60 }
    ];
    const s = { status: 'running', phase: 'work', currentRoundIndex: 1, rounds, phaseStartedAt: now, endTimestamp: now + 600000, startedAt: now, updatedAt: now };
    wx.setStorageSync('group-timer-session', s);
    wx.reLaunch({ url: '/pages/home/home' }); // framework re-show -> real onShow
  });
  await sleep(1500);
};

// ---- Discard branch (stays on Home) ----
await injectAndFire();
let hd = await readData('pages/home/home');
let card = hd && hd.recovery;
check(!!card, 'Discard: recovery card rendered on cold start', JSON.stringify(card));
check(card && card.round === 2 && card.name === '第二组', 'Discard: card shows injected round 2 / 第二组', card ? 'round=' + card.round + ' name=' + JSON.stringify(card.name) : 'no card');
if (card) {
  const btns = await (await mp.currentPage()).$$('button');
  // recovery card is the first wx:if block -> btns[0]=继续训练 btns[1]=放弃
  await btns[1].tap();
  await sleep(1600);
  const after = await readData('pages/home/home');
  check(after && after.recovery === null, 'Discard: 放弃 clears the recovery card', after ? 'recovery=' + JSON.stringify(after.recovery) : 'no data');
  const stored = await mp.evaluate(() => wx.getStorageSync('group-timer-session'));
  check(stored === '' || stored === undefined || stored === null || (stored && stored.status === 'completed'), 'Discard: session removed from storage', JSON.stringify(stored).slice(0, 80));
}

// ---- Continue branch ----
await injectAndFire();
hd = await readData('pages/home/home');
card = hd && hd.recovery;
check(!!card, 'Continue: recovery card rendered on cold start', JSON.stringify(card));
check(card && card.round === 2 && card.name === '第二组', 'Continue: card shows injected round 2 / 第二组', card ? 'round=' + card.round + ' name=' + JSON.stringify(card.name) : 'no card');
let resumed = false;
if (card) {
  const btns = await (await mp.currentPage()).$$('button');
  await btns[0].tap(); // 继续训练
  await sleep(2500);
  const tr = await readData('pages/timer/timer');
  resumed = !!tr;
  check(resumed, 'Continue: timer page active with resumed session', tr ? 'group=' + tr.group + ' name=' + JSON.stringify(tr.name) : 'no timer data');
  if (resumed) {
    check(tr.group === 2 && tr.name === '第二组', 'Continue: timer resumed on round 2 / 第二组', 'group=' + tr.group + ' name=' + JSON.stringify(tr.name) + ' display=' + tr.display);
  }
}

// ---- cleanup: stop/exit from timer returns Home with no session ----
if (resumed) {
  try {
    const stopBtn = await (await mp.currentPage()).$('.stop');
    await stopBtn.tap();
    await sleep(1800);
  } catch (_) {}
  await mp.evaluate(() => { try { wx.removeStorageSync('group-timer-session'); } catch (_) {} });
}

console.log('');
console.log('RESULT  pass=' + pass + ' fail=' + fail);
await mp.disconnect();
process.exit(fail === 0 ? 0 : 1);
