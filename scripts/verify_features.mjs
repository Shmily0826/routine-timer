// 验证深色模式 + 历史统计卡片 的运行时正确性。
// - 历史统计：注入记录 → 打开历史页 → 断言 data.stats 正确。
// - 深色模式：检查 app.wxss 主题变量解析（通过 page snapshot）。
import automator from 'miniprogram-automator';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
process.on('unhandledRejection', async (e) => { try { await mp?.disconnect?.(); } catch {} console.error('UNH:', e && e.message); process.exit(1); });
let pass = 0, fail = 0;
const check = (n, c, d='') => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + '  :: ' + d); } };

try {
  // ===== 1. 历史统计卡片 =====
  // 注入 3 条历史，覆盖基础统计 + 多个日期
  await mp.evaluate(() => {
    const now = Date.now();
    wx.setStorageSync('group-timer-history', [
      { id: 'a', ts: now - 86400000, rounds: 3, totalWorkSec: 90, totalRestSec: 20, label: '深蹲' },
      { id: 'b', ts: now - 2 * 86400000, rounds: 5, totalWorkSec: 150, totalRestSec: 30, label: '平板' },
      { id: 'c', ts: now - 7 * 86400000, rounds: 2, totalWorkSec: 60, totalRestSec: 10, label: '卷腹' },
    ]);
    wx.removeStorageSync('group-timer-session');
    wx.removeStorageSync('active-rounds');
    wx.setStorageSync('group-timer-routines', []);
    wx.setStorageSync('group-timer-prefs', { duration: 30, rest: 10, groups: 8, expanded: false, items: [] });
  });
  await mp.reLaunch('/pages/history/history');
  await sleep(2000);
  const histData = await mp.evaluate(() => {
    const h = getCurrentPages().find((p) => (p.route || p.__route__) === 'pages/history/history');
    return h ? h.data : null;
  });
  check('history page has stats field', histData && 'stats' in histData, 'keys=' + Object.keys(histData || {}).join(','));
  check('stats.sessions = 3', histData && histData.stats && histData.stats.sessions === 3, JSON.stringify(histData && histData.stats));
  check('stats.totalRounds = 10', histData && histData.stats && histData.stats.totalRounds === 10, JSON.stringify(histData && histData.stats));
  // totalSec = 90+20 + 150+30 + 60+10 = 360
  check('stats.totalSec = 360', histData && histData.stats && histData.stats.totalSec === 360, JSON.stringify(histData && histData.stats));
  // 最近 7 天：a(1天前), b(2天前), c(7天前=168h, 应在7天边缘)
  // 计算: c 在 7*86400s 前，严格 ≤ 7d，应计 3 次（实现见源码用的是 ts/86400000 对比 now）
  check('stats.recentCount = 3 (within 7 days)', histData && histData.stats && histData.stats.recentCount === 3, JSON.stringify(histData && histData.stats));
  check('history items rendered = 3', histData && histData.items && histData.items.length === 3, 'items=' + (histData && histData.items && histData.items.length));

  // 截图历史页（用户也能看到实际效果）
  const histShot = await mp.evaluate(() => {
    const h = getCurrentPages().find((p) => (p.route || p.__route__) === 'pages/history/history');
    return h ? { hasStats: !!h.data.stats, stats: h.data.stats, itemCount: h.data.items.length } : null;
  });
  console.log('history snapshot:', JSON.stringify(histShot));

  // 清掉测试数据
  await mp.evaluate(() => {
    wx.removeStorageSync('group-timer-history');
  });

  // ===== 2. 深色模式配置正确 =====
  // 通过 mp.systemInfo 验证深色模式能力，或通过 app.wxss 解析检查主题变量
  // miniprogram-automator 不直接暴露 computed style；改为检查 app.json 配置 + theme.json 内容
  const appJson = require('fs').readFileSync('miniprogram/app.json', 'utf8');
  check('app.json enables darkmode', appJson.includes('"darkmode": true'), '');
  check('app.json points at themeLocation', appJson.includes('theme.json'), '');
  const themeJson = JSON.parse(require('fs').readFileSync('miniprogram/theme.json', 'utf8'));
  check('theme.json has light + dark', !!(themeJson.light && themeJson.dark), '');
  check('theme.json defines bgPage for both', !!(themeJson.light.bgPage && themeJson.dark.bgPage), '');

  // 简单验证 wxss 里没有裸的 #ffffff / #f4f7fb（应已被变量替代）
  const wxss = require('fs').readFileSync('miniprogram/app.wxss', 'utf8');
  // 容许少量硬编码（如阴影 alpha 通道），但核心背景色不应裸出现
  const hardBg = (wxss.match(/#f4f7fb/gi) || []).length;
  check('app.wxss no longer uses raw #f4f7fb', hardBg === 0, 'found ' + hardBg);
} catch (e) {
  console.log('RAW ERROR: ' + (e && (e.stack || e.message)));
  check('feature verification completed', false, e && e.message);
}

console.log(`\nRESULT features: ${pass} pass / ${fail} fail`);
await mp.disconnect();
process.exit(fail ? 1 : 0);
