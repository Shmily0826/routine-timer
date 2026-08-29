// Verify a session reaches `completed`.
// The automator loses the page node after ~8s of timer-page activity, so this
// uses a config that finishes inside that window: 2 rounds x 2s work, 0s rest
// (restSec=0 skips the rest phase entirely) => completes at ~4s.
import automator from 'miniprogram-automator';

const WS = process.env.WS_ENDPOINT || 'ws://127.0.0.1:9420';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mp = await automator.connect({ wsEndpoint: WS });

let page = null;
for (let i = 1; i <= 12; i++) {
  try { const p = await mp.currentPage(); if (p && p.path) { page = p; break; } } catch (_) {}
  await sleep(2500);
}
console.log('page:', page && page.path);

const sample = async () => {
  try { return await (await mp.currentPage()).data(); } catch (e) { return { __err: e.message }; }
};

if (page.path.includes('home')) {
  const ins = await page.$$('input');
  await ins[0].input('2');  // groups
  await ins[1].input('2');  // work 2s
  await ins[2].input('0');  // rest 0s -> skip rest
  await sleep(600);
  const d0 = await sample();
  console.log('configured items:', JSON.stringify(d0.items.map((i) => `${i.work}/${i.rest}`)));
  await (await page.$('button.start')).tap();
  await sleep(1500);
}

console.log('\n--- polling for completion (10s) ---');
const seen = [];
let completed = null;
for (let i = 0; i < 40; i++) {
  const d = await sample();
  seen.push(`${d.phase}:${d.display}${d.completed ? ':DONE' : ''}${d.__err ? '(err)' : ''}`);
  if (d.completed === true) { completed = d; break; }
  await sleep(250);
}
console.log(seen.join('  '));

console.log('\n' + (completed
  ? 'RESULT: PASS - session reached completed=true at ' + completed.display
  : 'RESULT: FAIL - never observed completed=true (last=' + JSON.stringify(seen.slice(-3)) + ')'));

// also confirm the completed screen offers 再来一次 / 返回首页
if (completed) {
  try {
    const btns = await (await mp.currentPage()).$$('button');
    console.log('buttons on completed screen:', btns.length);
  } catch (e) { console.log('could not read completed-screen buttons:', e.message); }
}

await mp.disconnect();
process.exit(completed ? 0 : 1);
