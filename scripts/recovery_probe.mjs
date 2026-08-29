// Verifies the "leave without stopping, come back" recovery path.
//
// The timer page's 停止/退出 button explicitly removeStorageSync's the session,
// so recovery is NOT reachable by tapping stop. This probe emulates a cold
// start instead: the caller starts a long session, then restarts the project
// with `cli close` + `cli open` (which fires onHide -> persist, then a fresh
// Home onShow -> reconcile -> recovery card).
//
// Usage:
//   node scripts/recovery_probe.mjs start    # configure + start a long session
//   cli close --project ... && cli open --project ...
//   node scripts/recovery_probe.mjs check    # expect the recovery card
import automator from 'miniprogram-automator';

const WS = process.env.WS_ENDPOINT || 'ws://127.0.0.1:9420';
const mode = process.argv[2] || 'check';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mp = await automator.connect({ wsEndpoint: WS });

let page = null;
for (let i = 1; i <= 12; i++) {
  try { const p = await mp.currentPage(); if (p && p.path) { page = p; break; } } catch (_) {}
  await sleep(2500);
}
if (!page) { console.log('FAIL  no page'); await mp.disconnect(); process.exit(1); }
console.log('page:', page.path);

const data = async () => {
  for (let i = 0; i < 3; i++) {
    try { return await (await mp.currentPage()).data(); } catch (_) { await sleep(700); }
  }
  return null;
};

if (mode === 'start') {
  if (!page.path.includes('home')) { console.log('FAIL  not on home, got ' + page.path); await mp.disconnect(); process.exit(1); }
  const ins = await page.$$('input');
  await ins[0].input('2');
  await ins[1].input('180'); // long work so it is definitely unfinished
  await ins[2].input('10');
  await sleep(600);
  await (await page.$('button.start')).tap();
  await sleep(2500);
  const onTimer = (await mp.currentPage()).path.includes('timer');
  console.log(onTimer ? 'OK   long session started on the timer page' : 'FAIL  did not reach the timer page');
  await mp.disconnect();
  process.exit(onTimer ? 0 : 1);
}

// mode === 'check'
const d = await data();
if (!d) { console.log('FAIL  could not read page data'); await mp.disconnect(); process.exit(1); }

const hasCard = d.recovery !== null && d.recovery !== undefined;
console.log((hasCard ? 'PASS  ' : 'FAIL  ') + 'recovery card after cold start :: ' + JSON.stringify(d.recovery));

let discarded = false;
if (hasCard) {
  const btns = await (await mp.currentPage()).$$('button');
  // recovery card renders first: [0]=继续训练 [1]=放弃
  await btns[1].tap();
  await sleep(1600);
  const after = await data();
  discarded = after && after.recovery === null;
  console.log((discarded ? 'PASS  ' : 'FAIL  ') + 'discard clears the recovery card :: ' + JSON.stringify(after && after.recovery));
}

await mp.disconnect();
process.exit(hasCard && (discarded || !hasCard) ? 0 : 1);
