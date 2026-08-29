// Diagnostic: does the simulator's local storage survive a project close+open?
// Distinguishes "tool limitation" from "session was never persisted".
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

for (const key of ['group-timer-session', 'active-rounds', 'group-timer-routines']) {
  try {
    const v = await mp.callWxMethod('getStorageSync', { key });
    const s = JSON.stringify(v);
    console.log(`${key} => ${s === undefined ? '(undefined)' : s.slice(0, 220)}`);
  } catch (e) {
    console.log(`${key} => callWxMethod failed: ${e.message}`);
  }
}

await mp.disconnect();
process.exit(0);
