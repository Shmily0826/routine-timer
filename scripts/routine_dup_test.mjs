// Simulator verification: routine duplicate / clone (no real device needed).
// Covers: duplicate clones a routine with a new id + （副本） suffix, keeps the
// same rounds, and does not mutate the source.
import automator from 'miniprogram-automator';
import { waitForData, warmUp, installGuards } from './automation/wait.mjs';

installGuards(() => mp);
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

const ROUTINES = 'group-timer-routines';
const seed = () => ({
  id: 'r1',
  name: 'Editing',
  createdAt: 1,
  updatedAt: 1,
  rounds: [
    { name: 'X', workSec: 50, restSec: 8 },
    { name: 'Y', workSec: 50, restSec: 8 },
  ],
});

const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
try {
  await warmUp(mp);
  await mp.evaluate(
    (KEY, s) => {
      wx.setStorageSync(KEY, [s]);
      wx.reLaunch({ url: '/pages/routines/routines' });
    },
    ROUTINES,
    seed(),
  );
  // Wait for the routines page to have *reloaded from the seeded storage*.
  // Sleeping here was the whole bug: the previous suite leaves this same page
  // on screen with its own list still in data, so if the reLaunch has not
  // landed yet, duplicate() clones from that stale list and writes it back —
  // producing 3 routines where 2 were expected, with the clone carrying the
  // previous suite's rounds.
  await waitForData(mp, 'pages/routines/routines', {
    'routines.length': 1,
    'routines[0].name': 'Editing',
    'routines[0].rounds[0].workSec': 50,
  });

  // Clone the first routine via its page method (synthetic event).
  await mp.evaluate(() => {
    const r = getCurrentPages().find((p) => (p.route || p.__route__) === 'pages/routines/routines');
    r.duplicate({ currentTarget: { dataset: { index: 0 } } });
  });
  // No wait: duplicate() writes storage synchronously and calls load(), so by
  // the time evaluate() resolves both are already done.

  const out = await mp.evaluate((KEY) => {
    const list = wx.getStorageSync(KEY) || [];
    return { count: list.length, src: list[0], clone: list[1] };
  }, ROUTINES);
  check('duplicate appends (count=2)', out.count === 2);
  check('source name unchanged', out.src && out.src.name === 'Editing');
  check('clone name has （副本）', out.clone && out.clone.name === 'Editing（副本）');
  check('clone new id', out.clone && out.clone.id !== 'r1');
  check('clone rounds preserved', out.clone && out.clone.rounds.length === 2);
  check('clone rounds[0].workSec=50', out.clone && out.clone.rounds[0].workSec === 50);

  await mp.evaluate((KEY) => wx.removeStorageSync(KEY), ROUTINES);
} catch (e) {
  console.log('ERROR ' + e.message);
  fail++;
}
console.log(`\nRESULT routine-dup: ${pass} pass / ${fail} fail`);
await mp.disconnect();
process.exit(fail ? 1 : 0);
