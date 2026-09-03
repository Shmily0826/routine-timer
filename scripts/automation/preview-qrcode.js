#!/usr/bin/env node
/**
 * 生成小程序「预览」二维码，手机扫码即可打开开发版。
 *
 * 为什么需要它 —— 和「真机调试」的区别：
 *   真机调试：手机上的小程序会挂起，等 DevTools 的调试器通过网络握手。
 *             这要求手机和电脑在同一网段且互通。校园网/公司网的 AP 隔离
 *             会直接让它失败，表现为页面空白 + 转圈 + "Disconnected"。
 *   预览二维码：代码上传到微信服务器，微信给你一个二维码，手机扫码直接从
 *             服务器拉包运行。**不要求同网段**，绕开一切局域网限制。
 *
 * 代价：预览版没有断点/vConsole 调试能力。但对验证 UI、震动、流程、
 *     计时准确性这类「用起来对不对」的场景完全够用。
 *
 * 用法：
 *   node scripts/automation/preview-qrcode.js
 *   node scripts/automation/preview-qrcode.js --no-open   # 生成后不自动打开图片
 *
 * 可选环境变量：
 *   DEVTOOLS_CLI  cli.bat 的完整路径
 *   WX_PROJECT    项目目录
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const PROJECT_DIR = process.env.WX_PROJECT || path.resolve(__dirname, '..', '..'); // scripts/automation -> 项目根
const CLI_BAT = process.env.DEVTOOLS_CLI || 'D:\\Dev-Setup\\wechat-devtools\\cli.bat';

const args = process.argv.slice(2);
const NO_OPEN = args.includes('--no-open');

// 二维码落在 .workbuddy 下（该目录已 gitignore，不会污染仓库）
const OUT_DIR = path.join(PROJECT_DIR, '.workbuddy');
const OUT_PNG = path.join(OUT_DIR, 'preview-qr.png');

const log = (m = '') => process.stdout.write(m + '\n');
const hr = (t) => log('\n' + '='.repeat(56) + '\n' + t + '\n' + '='.repeat(56));

function main() {
  hr('小程序预览二维码生成器');

  log(`项目目录: ${PROJECT_DIR}`);
  log(`cli.bat : ${CLI_BAT}`);
  log(`输出文件: ${OUT_PNG}\n`);

  // --- 前置检查 ---
  if (!fs.existsSync(PROJECT_DIR)) {
    log(`[错误] 项目目录不存在: ${PROJECT_DIR}`);
    process.exit(1);
  }
  if (!fs.existsSync(CLI_BAT)) {
    log(`[错误] 找不到 cli.bat: ${CLI_BAT}`);
    process.exit(1);
  }

  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  } catch (e) {
    log(`[错误] 无法创建输出目录: ${e.message}`);
    process.exit(1);
  }

  // 删掉旧二维码，避免生成失败时误扫到上一张过期的
  if (fs.existsSync(OUT_PNG)) {
    try {
      fs.unlinkSync(OUT_PNG);
    } catch {
      /* 删不掉就算了 */
    }
  }

  log('[生成] 正在编译并上传代码到微信服务器 ...');
  log('       (通常需要 30~90 秒，请耐心等待)');
  log('       如果卡住不动，多半是登录态过期，窗口里会有登录提示。\n');

  // stdio inherit: 让 CLI 自己的 spinner / 进度 / 错误直接显示在窗口里
  const r = spawnSync(
    'cmd.exe',
    [
      '/c',
      CLI_BAT,
      'preview',
      '--project',
      PROJECT_DIR,
      '--qr-format',
      'image',
      '--qr-output',
      OUT_PNG,
    ],
    {
      stdio: 'inherit',
      windowsHide: true,
      cwd: path.dirname(CLI_BAT),
      timeout: 240000, // 4 分钟上限
    },
  );

  log('');

  if (r.error) {
    hr('失败');
    log(`无法执行 cli.bat: ${r.error.message}`);
    process.exit(1);
  }

  const ok = fs.existsSync(OUT_PNG);
  const size = ok ? fs.statSync(OUT_PNG).size : 0;

  if (!ok || size < 100) {
    hr('失败');
    log('没有生成二维码文件。常见原因：');
    log('  1. 【最常见】在 AI/agent 或无头环境里跑 —— IDE 需要一个能渲染的');
    log('     窗口站，无头会话里它起不来（报 "wait IDE port timeout"）。');
    log('     请在资源管理器里双击 preview-qrcode.bat 运行。');
    log('  2. 登录态过期 —— 先在 DevTools 里登录，或运行: cli.bat login');
    log('  3. 项目没有填 appid —— 检查 project.config.json 的 appid');
    log('  4. 代码编译报错 —— 看上面 CLI 的输出');
    log('  5. 网络不通 —— preview 需要访问微信服务器');
    log('');
    log('想看 DevTools 自己的日志：D:\\Dev-Setup\\wechat-devtools\\debug.log');
    process.exit(1);
  }

  hr('成功');
  log(`二维码已生成: ${OUT_PNG} (${Math.round(size / 1024)} KB)`);
  log('');
  log('现在用手机微信扫这个二维码，就能打开最新的开发版。');
  log('');
  log('请注意：');
  log('  - 预览二维码有有效期（约 25 分钟），过期重新跑一次本脚本。');
  log('  - 预览版不带调试器，所以不会出现「等待调试器连接」的空白页面。');
  log('    想断点调试仍然要用 DevTools 的真机调试。');
  log('  - 每次改完代码都要重新生成二维码，手机才会拿到新版本。');

  // --- 自动打开图片 ---
  if (NO_OPEN) {
    log('');
    log(`(--no-open 已指定，请手动打开: ${OUT_PNG})`);
  } else {
    log('');
    log('正在用系统默认看图工具打开 ...');
    try {
      spawnSync('cmd.exe', ['/c', 'start', '', OUT_PNG], {
        stdio: 'ignore',
        windowsHide: true,
      });
      log('如果没弹出来，手动打开上面的路径即可。');
    } catch (e) {
      log(`自动打开失败: ${e.message}`);
      log(`请手动打开: ${OUT_PNG}`);
    }
  }
}

main();
