// Simulator verification: routine editing (no real device needed).
// Covers: (A) prefill via ?edit=<id> on real onLoad, (B) saveRoutine overwrites existing
// routine by id (count unchanged), (C) saveRoutine creates new routine when no editId.
import automator from 'miniprogram-automator';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name); } };

const ROUTINES = 'group-timer-routines';
const seedR1 = () => ({
  id: 'r1', name: 'Editing', createdAt: 1, updatedAt: 1,
  rounds: [ { name: 'X', workSec: 50, restSec: 8 }, { name: 'Y', workSec: 50, restSec: 8 } ]
});

const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
try {
  // Seed one routine; clear prefs so onLoad fallback doesn't interfere.
  await mp.evaluate((seed) => {
    wx.removeStorageSync('group-timer-prefs');
    wx.setStorageSync('group-timer-routines', [ seed ]);
    wx.reLaunch({ url: '/pages/home/home?edit=r1' }); // real onLoad with options.edit
  }, seedR1());
  await sleep(1500);

  // (A) prefill
  let home = await mp.evaluate(() => {
    const h = getCurrentPages().find((p) => (p.route || p.__route__) === 'pages/home/home');
    return { editId: h.data.editId, items: h.data.items, groups: h.data.groups };
  });
  check('edit prefill editId=r1', home.editId === 'r1');
  check('edit prefill items.length=2', home.items && home.items.length === 2);
  check('edit prefill item[0].work=50', home.items && home.items[0] && home.items[0].work === 50);
  check('edit prefill item[0].name=X', home.items && home.items[0] && home.items[0].name === 'X');

  // (B) modify and save back -> overwrites r1, count stays 1
  await mp.evaluate(() => {
    const h = getCurrentPages().find((p) => (p.route || p.__route__) === 'pages/home/home');
    h.setData({ items: [ { name: '改了', work: 45, rest: 15, ow: true, or: true } ] });
    h.saveRoutine(); // -> wx.reLaunch to routines page
  });
  await sleep(1500);
  let after = await mp.evaluate((KEY) => {
    const list = wx.getStorageSync(KEY) || [];
    const r = list.find((x) => x.id === 'r1');
    return { count: list.length, r };
  }, ROUTINES);
  check('overwrite count stays 1', after.count === 1);
  check('overwrite rounds.length=1', after.r && after.r.rounds.length === 1);
  check('overwrite rounds[0].name=改了', after.r && after.r.rounds[0].name === '改了');
  check('overwrite rounds[0].workSec=45', after.r && after.r.rounds[0].workSec === 45);
  check('overwrite rounds[0].restSec=15', after.r && after.r.rounds[0].restSec === 15);

  // (C) save as new (no editId) -> appends
  await mp.evaluate(() => wx.reLaunch({ url: '/pages/home/home' })); // editId null
  await sleep(1500);
  await mp.evaluate(() => {
    const h = getCurrentPages().find((p) => (p.route || p.__route__) === 'pages/home/home');
    h.setData({ items: [ { name: '新', work: 20, rest: 3, ow: false, or: false } ] });
    h.saveRoutine();
  });
  await sleep(1500);
  let created = await mp.evaluate((KEY) => {
    const list = wx.getStorageSync(KEY) || [];
    return { count: list.length, last: list[list.length - 1] };
  }, ROUTINES);
  check('create appends (count=2)', created.count === 2);
  check('create last rounds[0].name=新', created.last && created.last.rounds[0].name === '新');
  check('create last rounds[0].workSec=20', created.last && created.last.rounds[0].workSec === 20);

  await mp.evaluate((KEY) => wx.removeStorageSync(KEY), ROUTINES);
} catch (e) {
  console.log('ERROR ' + e.message);
  fail++;
}
console.log(`\nRESULT routine-edit: ${pass} pass / ${fail} fail`);
await mp.disconnect();
process.exit(fail ? 1 : 0);
