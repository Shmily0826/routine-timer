// Regression suite for the 2026-08-31 product fixes + routine naming.
// Drives the real simulator via miniprogram-automator (same prereqs as smoke.mjs:
// DevTools open on this project, `cli auto --auto-port 9420 --trust-project`).
// Covers:
//  - history.remove keeps RAW record fields (no display-shape write-back)
//  - round-count input clamps to 50 everywhere (page data + prefs storage)
//  - rename uses an editable modal (trimmed content, blank = no change)
//  - new routines are numbered past the max existing "Routine N" (no collision after deletes)
import automator from 'miniprogram-automator';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
process.on('unhandledRejection', async (e) => { try { await mp?.disconnect?.(); } catch (_) {} console.error('UNHANDLED REJECTION:', e && e.message); process.exit(1); });
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + '  :: ' + detail); } };

const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
async function findBtn(page, text) {
  const btns = await page.$$('button');
  for (const b of btns) { if (text === await b.text()) return b; }
  return null;
}
async function homeData() {
  return mp.evaluate(() => {
    const h = getCurrentPages().find((p) => (p.route || p.__route__) === 'pages/home/home');
    return h ? h.data : null;
  });
}

try {
  // ---------- history.remove keeps raw record shape ----------
  await mp.evaluate(() => {
    wx.setStorageSync('group-timer-history', [
      { id: 'h1', ts: 1000, rounds: 2, totalWorkSec: 60, totalRestSec: 30, label: '甲' },
      { id: 'h2', ts: 2000, rounds: 3, totalWorkSec: 90, totalRestSec: 15, label: '乙' }
    ]);
  });
  await mp.reLaunch('/pages/history/history');
  await sleep(1500);
  let page = await mp.currentPage();
  const delBtn = await findBtn(page, '删除'); // index 0 = newest (ts desc) = h2
  await delBtn.tap();
  await sleep(1200);
  let hist = await mp.evaluate(() => wx.getStorageSync('group-timer-history'));
  check('history remove: 1 record left', hist.length === 1, JSON.stringify(hist));
  check('history remove: removed the tapped newest record (乙/h2)', hist[0] && hist[0].id === 'h1', JSON.stringify(hist));
  check('history remove: remaining record keeps RAW fields (totalWorkSec=60, 甲)',
    hist[0] && hist[0].totalWorkSec === 60 && hist[0].totalRestSec === 30 && hist[0].label === '甲', JSON.stringify(hist[0]));

  // ---------- round-count clamp ----------
  await mp.reLaunch('/pages/home/home');
  await sleep(1500);
  page = await mp.currentPage();
  const ins = await page.$$('input');
  await ins[0].input('999');
  await sleep(600);
  let hd = await mp.evaluate(() => {
    const h = getCurrentPages().find((p) => (p.route || p.__route__) === 'pages/home/home');
    return { groups: h.data.groups, stored: wx.getStorageSync('group-timer-prefs').groups };
  });
  check('groups 999 clamps to 50 in page data', String(hd.groups) === '50', 'groups=' + hd.groups);
  check('groups 999 clamps to 50 in prefs storage', Number(hd.stored) === 50, 'stored=' + hd.stored);

  // ---------- rename via editable modal ----------
  await mp.evaluate(() => {
    wx.setStorageSync('group-timer-routines', [
      { id: 'rr1', name: '旧名字', createdAt: 1, updatedAt: 1, rounds: [{ name: 'X', workSec: 30, restSec: 0 }] }
    ]);
  });
  await mp.reLaunch('/pages/routines/routines');
  await sleep(1500);
  page = await mp.currentPage();
  const rnBtn = await findBtn(page, '重命名');
  await mp.mockWxMethod('showModal', { confirm: true, content: '  新名字  ' });
  await rnBtn.tap();
  await sleep(1200);
  let rl = await mp.evaluate(() => wx.getStorageSync('group-timer-routines'));
  check('rename applies modal content (trimmed)', rl[0] && rl[0].name === '新名字', JSON.stringify(rl[0] && rl[0].name));
  check('rename bumps updatedAt, keeps rounds', rl[0] && rl[0].updatedAt > 1 && rl[0].rounds.length === 1);
  await mp.mockWxMethod('showModal', { confirm: true, content: '   ' });
  await rnBtn.tap();
  await sleep(1000);
  rl = await mp.evaluate(() => wx.getStorageSync('group-timer-routines'));
  check('rename with blank name keeps old name', rl[0] && rl[0].name === '新名字', JSON.stringify(rl[0] && rl[0].name));

  // ---------- routine numbering skips deleted numbers ----------
  // Existing: Routine 1, Routine 3 (Routine 2 was "deleted"). Next must be Routine 4.
  await mp.evaluate(() => {
    wx.setStorageSync('group-timer-routines', [
      { id: 'a', name: 'Routine 1', createdAt: 1, updatedAt: 1, rounds: [{ name: 'X', workSec: 30, restSec: 0 }] },
      { id: 'b', name: 'Routine 3', createdAt: 2, updatedAt: 2, rounds: [{ name: 'X', workSec: 30, restSec: 0 }] }
    ]);
    wx.setStorageSync('active-rounds', [{ name: 'X', workSec: 30, restSec: 0 }]);
  });
  await mp.reLaunch('/pages/routines/routines');
  await sleep(1500);
  page = await mp.currentPage();
  const saveBtn = await findBtn(page, '保存当前设置');
  await saveBtn.tap();
  await sleep(1000);
  rl = await mp.evaluate(() => wx.getStorageSync('group-timer-routines'));
  check('save numbers past max existing (Routine 4, not 3)', rl[2] && rl[2].name === 'Routine 4', JSON.stringify(rl.map((r) => r.name)));

  await mp.evaluate(() => {
    wx.removeStorageSync('group-timer-history');
    wx.removeStorageSync('group-timer-routines');
    wx.removeStorageSync('group-timer-prefs');
    wx.removeStorageSync('active-rounds');
  });
} catch (e) {
  console.log('RAW ERROR:\n' + ((e && (e.stack || e.message)) || String(e)));
  check('fixes suite completed without exception', false, (e && e.message) || String(e));
}
console.log(`\nRESULT fixes: ${pass} pass / ${fail} fail`);
await mp.disconnect();
process.exit(fail ? 1 : 0);
