// Runtime checks for the features that only exist at runtime and that the
// other suites do not look at: the history stats card, the dark-mode wiring,
// and the about / feedback page.
//
// This file was found already broken (it asserted a stats shape that no longer
// exists, and called require() from an .mjs) precisely because nothing ran it.
// It is now part of `npm run verify`.
import automator from 'miniprogram-automator';
import { readFileSync } from 'node:fs';
import { waitForRoute, warmUp, installGuards } from './automation/wait.mjs';

const HISTORY = 'group-timer-history';
let pass = 0,
  fail = 0;
const check = (n, c, d = '') => {
  if (c) {
    pass++;
    console.log('PASS ' + n);
  } else {
    fail++;
    console.log('FAIL ' + n + '  :: ' + d);
  }
};

let mp;
installGuards(() => mp);

try {
  mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  await warmUp(mp);

  // ===== 1. 历史统计卡片 =====
  await mp.evaluate((KEY) => {
    const now = Date.now();
    const day = 86400000;
    wx.setStorageSync(KEY, [
      { id: 'a', ts: now - day, rounds: 3, totalWorkSec: 90, totalRestSec: 20, label: '深蹲' },
      { id: 'b', ts: now - 2 * day, rounds: 5, totalWorkSec: 150, totalRestSec: 30, label: '平板' },
      { id: 'c', ts: now - 7 * day, rounds: 2, totalWorkSec: 60, totalRestSec: 10, label: '卷腹' },
    ]);
  }, HISTORY);
  await mp.reLaunch('/pages/history/history');
  await waitForRoute(mp, 'pages/history/history');

  const hist = await mp.evaluate(() => {
    const h = getCurrentPages().find((p) => (p.route || p.__route__) === 'pages/history/history');
    return h ? { stats: h.data.stats, items: h.data.items } : null;
  });
  // stats is { count, rounds, duration }; an older shape here used
  // sessions/totalRounds/totalSec/recentCount, which is what let this file rot.
  check(
    'stats.count = 3',
    hist && hist.stats && hist.stats.count === 3,
    JSON.stringify(hist && hist.stats),
  );
  check(
    'stats.rounds = 10',
    hist && hist.stats && hist.stats.rounds === 10,
    JSON.stringify(hist && hist.stats),
  );
  // 90+20 + 150+30 + 60+10 = 360s -> 「6分」
  check(
    'stats.duration = 6分',
    hist && hist.stats && hist.stats.duration === '6分',
    JSON.stringify(hist && hist.stats),
  );
  check(
    'history items rendered = 3',
    hist && hist.items && hist.items.length === 3,
    'items=' + (hist && hist.items && hist.items.length),
  );
  await mp.evaluate((KEY) => wx.removeStorageSync(KEY), HISTORY);

  // ===== 2. 深色模式配置 =====
  // miniprogram-automator does not expose computed styles, so check the wiring
  // instead: darkmode on, themeLocation set, and both palettes present.
  const appJson = readFileSync('miniprogram/app.json', 'utf8');
  check('app.json enables darkmode', appJson.includes('"darkmode": true'), '');
  check('app.json points at themeLocation', appJson.includes('theme.json'), '');
  const themeJson = JSON.parse(readFileSync('miniprogram/theme.json', 'utf8'));
  check('theme.json has light + dark', !!(themeJson.light && themeJson.dark), '');
  check(
    'theme.json defines bgPage for both',
    !!(themeJson.light.bgPage && themeJson.dark.bgPage),
    '',
  );

  const wxss = readFileSync('miniprogram/app.wxss', 'utf8');
  const rawBg = (wxss.match(/#f4f7fb/gi) || []).length;
  check('app.wxss has no raw #f4f7fb outside var() fallbacks', rawBg <= 1, 'found ' + rawBg);
  check(
    'every var() in app.wxss carries a fallback',
    // A var() with no fallback renders transparent in a theme that omits the
    // token, which is invisible in the simulator and obvious on a phone.
    (wxss.match(/var\(\s*--[a-zA-Z0-9]+\s*,/g) || []).length ===
      (wxss.match(/var\(\s*--[a-zA-Z0-9]+/g) || []).length,
    'var() count mismatch',
  );

  // ===== 3. 关于 / 反馈 =====
  // Reach it the way a user does, through the footer link on home, so a broken
  // bindtap is caught too.
  await mp.evaluate(() => wx.reLaunch({ url: '/pages/home/home' }));
  await waitForRoute(mp, 'pages/home/home');
  await (await (await mp.currentPage()).$('.footer')).tap();
  await waitForRoute(mp, 'pages/about/about');

  const about = await mp.evaluate(() => {
    const p = getCurrentPages().find((x) => (x.route || x.__route__) === 'pages/about/about');
    return p ? p.data : null;
  });
  check('about page loaded via the home footer link', !!about, 'no about page in the stack');
  check(
    'about shows a version or environment label',
    !!(about && about.version),
    JSON.stringify(about),
  );

  const buttons = await (await mp.currentPage()).$$('button');
  const labels = [];
  for (const b of buttons) labels.push((await b.text()).trim());
  check(
    'about renders the 意见反馈 button',
    labels.includes('意见反馈'),
    'buttons=' + JSON.stringify(labels),
  );
  // A typo in open-type does not throw — it just renders a dead button, which
  // is why this is asserted rather than assumed.
  const wxml = readFileSync('miniprogram/pages/about/about.wxml', 'utf8');
  check('feedback button uses open-type="feedback"', wxml.includes('open-type="feedback"'), '');
} catch (e) {
  console.log('RAW ERROR: ' + (e && (e.stack || e.message)));
  check('feature verification completed', false, e && e.message);
}

console.log(`\nRESULT features: ${pass} pass / ${fail} fail`);
await mp?.disconnect?.();
process.exit(fail ? 1 : 0);
