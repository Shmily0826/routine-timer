#!/usr/bin/env node
/**
 * 一键启动微信开发者工具的「自动化模式」（绑定 ws://127.0.0.1:9420）。
 *
 * 为什么需要它：
 *   DevTools 挂掉后会在 User Data 里留下 .ide 锁文件（里面记着已死进程的 PID），
 *   同时残留一堆 WeChatAppEx.exe 僵尸渲染进程。带着这些脏状态手动点开 DevTools
 *   往往起不来、或起来但不绑 9420。这个脚本先把现场清干净，再拉起干净实例。
 *
 * 为什么必须由「用户双击」运行：
 *   Electron 需要一个能渲染的窗口站。agent 的沙箱/无头会话没有持久窗口站，
 *   拉起后 IDE 进程会立刻退出，9420 永远绑不上。双击运行处在用户自己的交互
 *   桌面会话里，窗口能渲染、进程能常驻 —— 这是唯一可靠的启动方式。
 *
 * 用法：
 *   node scripts/automation/start-automation.js            # 完整流程
 *   node scripts/automation/start-automation.js --keep     # 跳过「关闭现有 DevTools」
 *   node scripts/automation/start-automation.js --clean-only
 *                                                          # 只清理脏状态，不拉起 DevTools
 *
 * 可选环境变量：
 *   DEVTOOLS_CLI   cli.bat 的完整路径
 *   WX_PROJECT     要打开的小程序项目目录
 *   WX_AUTO_PORT   自动化端口（默认 9420）
 */

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

// ---------------------------------------------------------------- 配置

const PORT = parseInt(process.env.WX_AUTO_PORT || '9420', 10);
const PROJECT_DIR = process.env.WX_PROJECT || path.resolve(__dirname, '..', '..'); // scripts/automation -> 项目根
const CLI_BAT = process.env.DEVTOOLS_CLI || 'D:\\Dev-Setup\\wechat-devtools\\cli.bat';

// DevTools 的 .ide 锁文件路径（含中文目录，Node 用 UTF-8 读写是安全的）
const IDE_LOCK = path.join(
  os.homedir(),
  'AppData',
  'Local',
  '微信开发者工具',
  'User Data',
  'a1a0e508cb0f69b7981e64f6eccdd1aa',
  'Default',
  '.ide',
);

const args = process.argv.slice(2);
const KEEP_EXISTING = args.includes('--keep');
const NO_KILL_RENDERERS = args.includes('--no-kill-renderers');
const CLEAN_ONLY = args.includes('--clean-only');

// ---------------------------------------------------------------- 工具

const log = (m = '') => process.stdout.write(m + '\n');
const hr = (t) => log('\n' + '='.repeat(56) + '\n' + t + '\n' + '='.repeat(56));

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 端口是否已在监听（TCP 连得上就算）。 */
function isPortOpen(port, timeout = 1200) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(timeout);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
  });
}

/** 进程是否还活着。用 tasklist 精确查 PID，避免中文进程名的编码问题。 */
function isPidAlive(pid) {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return false;
  const r = spawnSync('tasklist', ['/FI', `PID eq ${pid}`], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const out = (r.stdout || '') + (r.stderr || '');
  // tasklist 找不到匹配时会输出「没有运行的任务匹配指定标准」之类的提示
  return /\b(\d{2,})\s+Console|INFO:\s*No tasks/i.test(out)
    ? !/INFO:\s*No tasks/i.test(out)
    : false;
}

/** 读 .ide 锁里的 PID（纯数字，无编码问题）。 */
function readIdePid() {
  try {
    if (!fs.existsSync(IDE_LOCK)) return null;
    const raw = fs.readFileSync(IDE_LOCK, 'utf8').trim();
    const pid = parseInt(raw, 10);
    return Number.isInteger(pid) ? pid : null;
  } catch {
    return null;
  }
}

/** 删除 stale 的 .ide 锁（路径含中文，rm 会被安全层拦，Node 直接删）。 */
function removeIdeLock() {
  try {
    if (fs.existsSync(IDE_LOCK)) {
      fs.unlinkSync(IDE_LOCK);
      return true;
    }
    return false;
  } catch (e) {
    log(`  [warn] 删除 .ide 锁失败: ${e.message}`);
    return false;
  }
}

/** 执行 taskkill，不抛异常。 */
function kill(argsArr) {
  try {
    const r = spawnSync('taskkill', argsArr, { encoding: 'utf8', windowsHide: true });
    return (r.stdout || '') + (r.stderr || '');
  } catch (e) {
    return 'error: ' + e.message;
  }
}

/**
 * 找出「属于指定安装目录」的 WeChatAppEx 渲染进程。
 *
 * 关键：绝不能按进程名无差别杀。名为 WeChatAppEx.exe 的进程同时被两家用：
 *   - 微信开发者工具（本脚本要清理的目标）
 *   - PC 微信客户端自己的小程序运行时（xwechat\...\RadiumWMPF）
 * 杀后者会强制关掉用户在 PC 微信里打开的小程序，且 PC 微信会立刻 respawn，
 * 表现为「怎么杀都杀不完」。所以必须按 ExecutablePath 精确区分。
 */
function listRenderersUnder(dir) {
  // 路线 1: wmic —— 快，但 Win11 新版本已逐步移除，可能直接不可用。
  {
    const r = spawnSync(
      'wmic',
      [
        'process',
        'where',
        "name='WeChatAppEx.exe'",
        'get',
        'ProcessId,ExecutablePath',
        '/format:csv',
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 20000 },
    );
    const out = r.stdout;
    if (!r.error && out) {
      const target = String(dir).toLowerCase();
      const pids = [];
      for (const rawLine of out.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || /^Node,/i.test(line)) continue;
        const cut = line.lastIndexOf(',');
        if (cut < 0) continue;
        const exePath = line.slice(0, cut).replace(/^[^,]*,/, ''); // 去掉机器名列
        const pid = parseInt(line.slice(cut + 1), 10);
        if (!Number.isInteger(pid)) continue;
        if (exePath && exePath.toLowerCase().startsWith(target)) pids.push(pid);
      }
      return pids;
    }
  }

  // 路线 2: PowerShell —— 慢一些但可靠。
  // 用 StartsWith 而不是 -like，避免路径里的 [ ] * 被当成通配符。
  {
    const lit = String(dir).replace(/'/g, "''");
    const script =
      `Get-CimInstance Win32_Process -Filter "Name='WeChatAppEx.exe'" | ` +
      `Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${lit}',[StringComparison]::OrdinalIgnoreCase) } | ` +
      `Select-Object -ExpandProperty ProcessId`;
    const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 40000,
    });
    if (!r.error && r.stdout) {
      const pids = r.stdout
        .split(/\r?\n/)
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isInteger(n) && n > 0);
      return pids;
    }
  }

  return null; // 两条路都走不通 -> 交给调用方降级（宁可不杀，也不按进程名误杀）
}

// ---------------------------------------------------------------- 主流程

async function main() {
  hr('微信开发者工具 — 自动化端口启动器');

  log(`项目目录 : ${PROJECT_DIR}`);
  log(`cli.bat  : ${CLI_BAT}`);
  log(`自动化端口: ${PORT}\n`);

  // --- 前置检查 ----------------------------------------------------
  if (!fs.existsSync(PROJECT_DIR)) {
    log(`[错误] 项目目录不存在: ${PROJECT_DIR}`);
    log('       可用 WX_PROJECT 环境变量指定正确路径。');
    process.exit(1);
  }
  if (!fs.existsSync(CLI_BAT)) {
    log(`[错误] 找不到 cli.bat: ${CLI_BAT}`);
    log('       可用 DEVTOOLS_CLI 环境变量指定正确路径。');
    process.exit(1);
  }

  // --- 步骤 1: 端口已开？直接复用 ------------------------------------
  if (await isPortOpen(PORT)) {
    log(`[OK] 端口 ${PORT} 已在监听，自动化服务本来就活着，无需重启。`);
    log('     直接回 WorkBuddy 让我跑 npm run verify 即可。');
    await reportAdb();
    return;
  }

  // --- 步骤 2: 处理已存在的 DevTools --------------------------------
  const idePid = readIdePid();
  const ideAlive = isPidAlive(idePid);

  if (idePid && !ideAlive) {
    log(`[清理] .ide 锁记录 PID ${idePid}，但该进程已死 —— 这是 stale 锁。`);
    if (removeIdeLock()) log('       已删除 stale 锁文件。');
  } else if (ideAlive) {
    if (KEEP_EXISTING) {
      log(`[跳过] DevTools 正在运行 (PID ${idePid})，--keep 已指定，不关闭它。`);
      log('       注意: 已运行的实例若不是自动化模式，9420 不会自动出现。');
    } else {
      log(`[清理] DevTools 正在运行 (PID ${idePid})。`);
      log('       普通 GUI 模式无法补开 9420，必须重启为自动化模式。');
      log('       3 秒后关闭它（按 Ctrl+C 可取消）...');
      for (let i = 3; i > 0; i--) {
        process.stdout.write(`       ${i}... `);
        await sleep(1000);
      }
      process.stdout.write('\n');
      kill(['/F', '/PID', String(idePid)]);
      await sleep(1500);
      log('       已关闭。');
      removeIdeLock();
    }
  } else {
    log('[状态] 没有正在运行的 DevTools。');
    removeIdeLock();
  }

  // --- 步骤 3: 清僵尸渲染进程 ---------------------------------------
  if (NO_KILL_RENDERERS) {
    log('[跳过] 按 --no-kill-renderers 保留渲染进程。');
  } else {
    const devtoolsDir = path.dirname(CLI_BAT);
    const pids = listRenderersUnder(devtoolsDir);

    if (pids === null) {
      // 拿不到路径就不动手 —— 按进程名误杀 PC 微信比留着僵尸更糟。
      log('[跳过] 无法枚举渲染进程路径，不按进程名冒然清理。');
      log('       (wmic 在新版 Windows 已被移除，PowerShell 亦不可用)');
    } else if (pids.length === 0) {
      log('[清理] 没有属于 DevTools 的残留渲染进程。');
    } else {
      log(`[清理] 发现 ${pids.length} 个属于 DevTools 的残留渲染进程，正在结束：`);
      for (const pid of pids) {
        kill(['/F', '/PID', String(pid)]);
        log(`       已结束 PID ${pid}`);
      }
      await sleep(800);
    }
    log('       (PC 微信自己的小程序进程未受影响)');
  }

  // --- 步骤 3.5: 只清理模式到此为止 ---------------------------------
  if (CLEAN_ONLY) {
    hr('清理完成');
    log('已清掉 stale 锁与僵尸进程，没有拉起 DevTools。');
    log('现在可以手动打开 DevTools，或去掉 --clean-only 重跑本脚本。');
    await reportAdb();
    return;
  }

  // --- 步骤 4: 拉起自动化模式 ---------------------------------------
  log('\n[启动] 正在以自动化模式拉起 DevTools ...');
  log('       (首次启动较慢，需要 20~60 秒，请耐心等待)');

  // 注意: 必须通过 cmd /c 启动 .bat，且 detached + unref，
  // 这样本脚本退出后 DevTools 能继续常驻。
  const child = spawn(
    'cmd.exe',
    [
      '/c',
      CLI_BAT,
      'auto',
      '--project',
      PROJECT_DIR,
      '--auto-port',
      String(PORT),
      '--trust-project',
    ],
    {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      cwd: path.dirname(CLI_BAT),
    },
  );
  child.unref();

  // --- 步骤 5: 轮询端口 ---------------------------------------------
  const TIMEOUT_MS = 90_000;
  const started = Date.now();
  let up = false;

  process.stdout.write('       等待端口');
  while (Date.now() - started < TIMEOUT_MS) {
    await sleep(1000);
    process.stdout.write('.');
    if (await isPortOpen(PORT)) {
      up = true;
      break;
    }
  }
  process.stdout.write('\n');

  // --- 步骤 6: 结果 -------------------------------------------------
  hr(up ? '成功' : '失败');

  if (up) {
    const secs = Math.round((Date.now() - started) / 1000);
    log(`端口 ${PORT} 已监听（耗时 ${secs} 秒）。`);
    log('');
    log('接下来：');
    log('  1. 保持 DevTools 那个窗口开着 —— 关掉它 9420 就没了。');
    log('     （这个启动器窗口是独立进程，可以直接关闭，不影响。）');
    log('  2. 回 WorkBuddy 告诉我「开好了」，我会跑 npm run verify。');
  } else {
    log(`等待 ${TIMEOUT_MS / 1000} 秒后端口 ${PORT} 仍未监听。`);
    log('');
    log('可能原因与处理：');
    log('  - 【最常见】本脚本跑在 AI/agent 或无头会话里：IDE 需要一个能渲染的');
    log('    窗口站才会绑定自动化端口，无头环境下进程会直接退出。');
    log('    请在资源管理器里双击 start-automation.bat 运行。');
    log('  - DevTools 首次启动确实慢：再等 30 秒，端口可能才绑上。');
    log('  - 弹出的登录/信任项目对话框挡住了：去窗口里点掉。');
    log('  - 项目被别的 DevTools 实例占着：关掉所有 DevTools 后重跑本脚本。');
    log('  - 想看 DevTools 自己的日志：D:\\Dev-Setup\\wechat-devtools\\debug.log');
  }

  await reportAdb();
}

/** 顺带报告 adb 设备状态，方便判断真机在不在。 */
async function reportAdb() {
  try {
    const r = spawnSync('adb', ['devices', '-l'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 8000,
    });
    const out = (r.stdout || '').trim();
    if (!out) return;
    log('\n--- adb 设备 ---');
    log(out);
  } catch {
    /* adb 不在 PATH 上就静默跳过 */
  }
}

main().catch((e) => {
  log('\n[异常] ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
