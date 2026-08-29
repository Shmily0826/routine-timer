// Decisive probe: does the countdown actually tick down during the REST phase,
// or does it freeze? Uses a long rest (30s) so there is plenty of time to sample.
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

if (page.path.includes('home')) {
  const ins = await page.$$('input');
  await ins[0].input('2');   // groups
  await ins[1].input('3');   // work 3s  -> get into rest quickly
  await ins[2].input('30');  // rest 30s -> long enough to sample
  await sleep(600);
  const btn = await page.$('button.start');
  await btn.tap();
  await sleep(2500);
}

const sample = async () => {
  try { return await (await mp.currentPage()).data(); } catch (e) { return { __err: e.message }; }
};

console.log('\n--- sampling until phase=rest ---');
let d = await sample();
for (let i = 0; i < 40 && d.phase !== 'rest'; i++) { d = await sample(); await sleep(500); }
console.log('reached rest:', d.phase, d.display);

console.log('\n--- sampling display every 1s for 15s during rest ---');
const seen = [];
for (let i = 0; i < 15; i++) {
  const s = await sample();
  seen.push(`${s.phase}:${s.display}${s.__err ? '(err ' + s.__err + ')' : ''}`);
  await sleep(1000);
}
console.log(seen.join('  '));
const unique = [...new Set(seen.map((s) => s.split(':')[1]))];
console.log('\nunique display values:', unique.join(', '));
console.log(unique.length > 3 ? 'RESULT: countdown TICKS (rest advances)' : 'RESULT: countdown FROZEN (rest never advances)');

await mp.disconnect();
process.exit(0);
