#!/usr/bin/env node
/**
 * 上传小程序代码为「开发版」，用于在真机上以体验版的形式长期验证。
 *
 * 为什么要有它 —— 三种真机跑法对比：
 *   真机调试(开发版)：要手机和电脑同网段且互通，还会死等调试器握手，
 *                    校园网/公司网 AP 隔离时必然失败（空白页 + 转圈）。
 *   预览二维码      ：不要求同网段，但二维码只有约 25 分钟有效期，
 *                    每次改代码都要重新生成、重新扫。
 *   体验版(本脚本)  ：代码传到微信服务器 → 后台把某个开发版「设为体验版」→
 *                    二维码长期有效，体验成员随时能扫。不依赖网络环境、
 *                    不需要连 DevTools，震动 / 屏幕常亮 / 深色模式 / iOS
 *                    这些只有真机能验的东西都能踏实验。
 *
 * 用法：
 *   node scripts/automation/upload-experience.js
 *   node scripts/automation/upload-experience.js --version 1.0.3
 *   node scripts/automation/upload-experience.js -v 1.0.3 -d "修掉再来一次卡住"
 *   node scripts/automation/upload-experience.js --no-build       # 跳过重新构建
 *   node scripts/automation/upload-experience.js --dry-run        # 只打印命令
 *
 * 版本号：不带 --version 时，从 .workbuddy/last-upload.json 读上次版本号并
 *        patch +1（首次为 1.0.0），上传成功后写回。
 *
 * 可选环境变量：
 *   DEVTOOLS_CLI  cli.bat 的完整路径
 *   WX_PROJECT    项目目录
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PROJECT_DIR = process.env.WX_PROJECT || path.resolve(__dirname, '..', '..'); // scripts/automation -> 项目根
const CLI_BAT = process.env.DEVTOOLS_CLI || 'D:\\Dev-Setup\\wechat-devtools\\cli.bat';

// 上次上传的版本号存在 .workbuddy 下（该目录已 gitignore）
const STATE_DIR = path.join(PROJECT_DIR, '.workbuddy');
const STATE_FILE = path.join(STATE_DIR, 'last-upload.json');

const log = (m = '') => process.stdout.write(m + '\n');
const hr = (t) => log('\n' + '='.repeat(56) + '\n' + t + '\n' + '='.repeat(56));

// ---------------------------------------------------------------- 参数解析

const argv = process.argv.slice(2);
const NO_BUILD = argv.includes('--no-build');
const DRY_RUN = argv.includes('--dry-run');

let version = null;
let desc = null;
const positional = [];

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--version' || a === '-v') version = argv[++i];
  else if (a === '--desc' || a === '-d') desc = argv[++i];
  else if (a.startsWith('--')) continue;
  else positional.push(a);
}

if (!version && positional.length) version = positional.shift();
if (!desc && positional.length) desc = positional.join(' ');

/** 读上次版本号并 patch +1；没有记录就从 1.0.0 开始。 */
function nextVersion() {
  let last = null;
  try {
    last = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).version;
  } catch {
    /* 没有记录就按首次上传处理 */
  }
  if (typeof last !== 'string' || !/^\d+\.\d+\.\d+$/.test(last)) return '1.0.0';
  const parts = last.split('.').map(Number);
  parts[2] += 1;
  return parts.join('.');
}

function stampedDesc() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------------------------------------------------------------- 主流程

function main() {
  hr('小程序体验版上传器');

  // --- 前置检查 ---
  if (!fs.existsSync(PROJECT_DIR)) {
    log(`[错误] 项目目录不存在: ${PROJECT_DIR}`);
    process.exit(1);
  }
  if (!fs.existsSync(CLI_BAT)) {
    log(`[错误] 找不到 cli.bat: ${CLI_BAT}`);
    log('       可用 DEVTOOLS_CLI 环境变量指定正确路径。');
    process.exit(1);
  }

  const configPath = path.join(PROJECT_DIR, 'project.config.json');
  let appid = '(未读到)';
  try {
    appid = JSON.parse(fs.readFileSync(configPath, 'utf8')).appid || appid;
  } catch {
    log('[警告] 读不到 project.config.json 的 appid，上传多半会失败。');
  }

  const resolvedVersion = version || nextVersion();
  const resolvedDesc = desc || stampedDesc();

  log(`项目目录: ${PROJECT_DIR}`);
  log(`appid   : ${appid}`);
  log(`cli.bat : ${CLI_BAT}`);
  log(`版本号  : ${resolvedVersion}${version ? '' : '  (自动递增，可用 -v 指定)'}`);
  log(`备注    : ${resolvedDesc}\n`);

  if (!/^\d+\.\d+\.\d+$/.test(resolvedVersion)) {
    log(`[错误] 版本号格式应为 x.y.z（三位数字），收到: ${resolvedVersion}`);
    process.exit(1);
  }

  const cliArgs = ['upload', '--project', PROJECT_DIR, '-v', resolvedVersion, '-d', resolvedDesc];

  if (DRY_RUN) {
    log('[dry-run] 将执行：');
    log('  npm run build:wechat');
    log(`  ${CLI_BAT} ${cliArgs.map((a) => (/[\s]/.test(a) ? `"${a}"` : a)).join(' ')}`);
    return;
  }

  // --- 步骤 1: 先构建 ---------------------------------------------
  // 小程序目录里的 .js 是 tsc 产物，必须先重新生成，否则上传的是旧代码。
  if (NO_BUILD) {
    log('[跳过] --no-build 已指定，不重新构建（请确保 miniprogram/*.js 是最新的）。\n');
  } else {
    log('[构建] 正在编译 TypeScript -> miniprogram/*.js ...');
    const build = spawnSync('npm', ['run', 'build:wechat'], {
      cwd: PROJECT_DIR,
      stdio: 'inherit',
      windowsHide: true,
      timeout: 180000,
    });
    log('');
    if (build.error || build.status !== 0) {
      hr('失败');
      log('构建没通过，已中止上传。请先修好编译错误。');
      process.exit(1);
    }
    log('       构建通过。\n');
  }

  // --- 步骤 2: 上传 -----------------------------------------------
  log('[上传] 正在编译并上传代码到微信服务器 ...');
  log('       (通常 30~90 秒；若卡住，多半是登录态过期，窗口里会有登录提示)\n');

  const r = spawnSync('cmd.exe', ['/c', CLI_BAT, ...cliArgs], {
    stdio: 'inherit',
    windowsHide: true,
    cwd: path.dirname(CLI_BAT),
    timeout: 300000, // 5 分钟上限
  });

  log('');

  if (r.error) {
    hr('失败');
    log(`无法执行 cli.bat: ${r.error.message}`);
    process.exit(1);
  }
  if (r.status !== 0) {
    hr('失败');
    log(`cli upload 返回码 ${r.status}。常见原因：`);
    log('  1. 【最常见】在 AI/agent 或无头环境里跑 —— IDE 需要一个能渲染的窗口站。');
    log('     请在资源管理器里双击 upload-experience.bat 运行。');
    log('  2. 登录态过期 —— 先在 DevTools 里登录，或运行: cli.bat login');
    log('  3. 微信号不是该小程序的开发者/管理员 —— 用有权限的号登录');
    log('  4. 版本号重复 —— 换一个版本号重试（-v 1.0.x）');
    log('  5. 代码编译报错 —— 看上面 CLI 的输出');
    log('');
    log('想看 DevTools 自己的日志：D:\\Dev-Setup\\wechat-devtools\\debug.log');
    process.exit(1);
  }

  // --- 步骤 3: 记录版本号 -----------------------------------------
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify(
        { version: resolvedVersion, desc: resolvedDesc, uploadedAt: new Date().toISOString() },
        null,
        2,
      ),
    );
  } catch {
    log('[警告] 版本号记录写入失败（不影响上传结果）。');
  }

  // --- 步骤 4: 后续操作指引 ---------------------------------------
  hr('上传成功');
  log(`版本 ${resolvedVersion} 已上传为「开发版」。\n`);
  log('接下来在网页上操作（只需做一次，之后重传会自动沿用）：');
  log('  1. 打开 https://mp.weixin.qq.com 登录，进入「管理 → 版本管理」。');
  log('  2. 在「开发版本」里找到刚上传的版本，点「设为体验版」。');
  log('  3. 到「成员管理 → 体验成员」把自己的微信号加进去');
  log('     （只有体验成员能扫体验版二维码，开发者本人默认不在里面）。');
  log('  4. 回到「版本管理」，点体验版二维码，用手机微信扫。');
  log('');
  log('这个二维码长期有效，直到你上传下一个版本并重新「设为体验版」。');
  log('所以改完代码再跑一次本脚本 + 重新设为体验版即可，不用每次重扫。');
  log('');
  log('想在真机上验什么，建议按这个顺序：');
  log('  - 计时准确性：设 2 组 × 30 秒，和手机秒表对一下');
  log('  - 震动：需要系统「设置 → 声音与触感 → 触感反馈」是开的');
  log('  - 屏幕常亮：计时中别碰屏幕，看它会不会熄');
  log('  - 深色模式：把系统切到深色，或等到 Night mode 自动切换');
  log('  - 后台恢复：计时中切到微信聊天再回来，看能不能续上');
  log('');
  log('准备正式发布时，见 RELEASE.md 的审核材料清单。');
}

main();
