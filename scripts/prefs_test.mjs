// Simulator verification: preference persistence (no real device needed).
// Drives the real WeChat simulator via miniprogram-automator.
// Pattern: inject storage -> wx.reLaunch (fires real onLoad) -> read page data via evaluate.
import automator from 'miniprogram-automator';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
process.on('unhandledRejection', async (e) => { try { await mp?.disconnect?.(); } catch (_) {} console.error('UNHANDLED REJECTION:', e && e.message); process.exit(1); });
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name); } };

const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
try {
  // Inject known prefs, then cold-start Home via framework reLaunch (real onLoad).
  await mp.evaluate(() => {
    wx.removeStorageSync('group-timer-prefs');
    wx.setStorageSync('group-timer-prefs', {
      groups: 3, duration: 99, rest: 7,
      items: [ { name: 'A', work: 99, rest: 7 }, { name: 'B', work: 99, rest: 7 }, { name: 'C', work: 99, rest: 7 } ]
    });
    wx.reLaunch({ url: '/pages/home/home' });
  });
  await sleep(1500);
  let d = await mp.evaluate(() => {
    const h = getCurrentPages().find((p) => (p.route || p.__route__) === 'pages/home/home');
    return { duration: h.data.duration, rest: h.data.rest, items: h.data.items };
  });
  check('prefill duration=99', d.duration === 99);
  check('prefill rest=7', d.rest === 7);
  check('prefill items.length=3', d.items && d.items.length === 3);
  check('prefill item[0].work=99', d.items && d.items[0] && d.items[0].work === 99);
  check('prefill item[0].name=A', d.items && d.items[0] && d.items[0].name === 'A');

  // Change values, persist, cold-start again -> should remember.
  await mp.evaluate(() => {
    const h = getCurrentPages().find((p) => (p.route || p.__route__) === 'pages/home/home');
    h.setData({ duration: 42, rest: 5, items: [ { name: 'Z', work: 42, rest: 5, ow: false, or: false } ] });
    h.persistPrefs();
  });
  await mp.evaluate(() => wx.reLaunch({ url: '/pages/home/home' }));
  await sleep(1500);
  d = await mp.evaluate(() => {
    const h = getCurrentPages().find((p) => (p.route || p.__route__) === 'pages/home/home');
    return { duration: h.data.duration, rest: h.data.rest, items: h.data.items };
  });
  check('persist duration=42', d.duration === 42);
  check('persist rest=5', d.rest === 5);
  check('persist items.length=1', d.items && d.items.length === 1);

  await mp.evaluate(() => wx.removeStorageSync('group-timer-prefs'));
} catch (e) {
  console.log('ERROR ' + e.message);
  fail++;
}
console.log(`\nRESULT prefs: ${pass} pass / ${fail} fail`);
await mp.disconnect();
process.exit(fail ? 1 : 0);
