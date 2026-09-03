// WeChat simulator smoke test, driven through the DevTools automation port.
//
// Constraints discovered while building this (all verified, not assumed):
//  1. Programmatic navigation (navigateTo/redirectTo/reLaunch/navigateBack)
//     throws "Uncaught [object Object]" here - so every transition goes through
//     REAL UI taps, which also exercises the actual button handlers.
//  2. The timer page setData's every 250ms; the automator then drops the page
//     node after roughly 8s on the timer page. So each timer session is kept
//     short and the checks are front-loaded.
//  3. Routines is last because that page has no back button.
//
// Prereq (DevTools open on this project, logged in):
//   cli auto --project D:\CODE\project\Timer --port <idePort> --auto-port 9420 --trust-project
// Run: node scripts/smoke.mjs     (start on the Home page)
import automator from 'miniprogram-automator';

const WS = process.env.WS_ENDPOINT || 'ws://127.0.0.1:9420';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
process.on('unhandledRejection', async (e) => {
  try {
    await mp?.disconnect?.();
  } catch (_) {}
  console.error('UNHANDLED REJECTION:', e && e.message);
  process.exit(1);
});
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  :: ' + detail : ''));
}

const mp = await automator.connect({ wsEndpoint: WS });
console.log('connected to', WS);

async function retry(label, fn, attempts = 3, delay = 700) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      console.log(`  ..retry ${i}/${attempts} ${label}: ${(e && e.message) || e}`);
      await sleep(delay);
    }
  }
  throw lastErr;
}
const readData = () => retry('data', async () => (await mp.currentPage()).data());
async function tap(index, label) {
  return retry(`tap(${label})`, async () => {
    const btns = await (await mp.currentPage()).$$('button');
    if (!btns[index]) throw new Error(`button[${index}] missing, n=${btns.length}`);
    await btns[index].tap();
  });
}
async function tapSel(sel, label) {
  return retry(`tap(${label})`, async () => {
    const el = await (await mp.currentPage()).$(sel);
    if (!el) throw new Error(`selector ${sel} not found`);
    await el.tap();
  });
}
// Tap and re-tap (up to 5x) until the page data actually reflects the effect —
// guards against taps lost to the 250ms re-render cycle.
async function tapUntil(index, label, predicate, attempts = 5, delay = 600) {
  for (let i = 1; i <= attempts; i++) {
    await tap(index, label);
    await sleep(delay);
    const d = await tryData();
    if (d && predicate(d)) return d;
    console.log(`  ..tapUntil ${label} ${i}/${attempts}: effect not observed yet`);
  }
  throw new Error(`tapUntil(${label}): effect never observed after ${attempts} taps`);
}
// Tolerant single-attempt read: the page node transiently disappears.
async function tryData() {
  try {
    return await (await mp.currentPage()).data();
  } catch (_) {
    return null;
  }
}
async function poll(predicate, timeoutMs = 15000, stepMs = 200) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    const d = await tryData();
    if (d) {
      last = d;
      if (predicate(d)) return d;
    }
    await sleep(stepMs);
  }
  return { __timeout: true, last };
}

async function configure(groups, work, rest) {
  // The automator connection occasionally times out mid-run ("timeout waiting
  // for automator response"); route every step through the retry helper so one
  // hiccup doesn't abort the whole suite.
  await retry(
    'configure(inputs)',
    async () => {
      const page = await mp.currentPage();
      const ins = await page.$$('input');
      await ins[0].input(String(groups));
      await ins[1].input(String(work));
      await ins[2].input(String(rest));
    },
    3,
    1000,
  );
  await sleep(500);
}
async function stopToHome() {
  const btns = await (await mp.currentPage()).$$('button');
  await btns[btns.length - 1].tap(); // 停止/退出 on the timer page
  // Poll until the back-navigation actually landed on Home — the automator page
  // node can keep reporting the timer page for a while after navigateBack.
  for (let i = 1; i <= 8; i++) {
    await sleep(700);
    try {
      const p = await mp.currentPage();
      if (p && p.path.includes('home')) return p;
    } catch (_) {}
    console.log(`  ..waiting for home after stop (${i})`);
  }
  return mp.currentPage();
}

try {
  // Always begin from Home, so this suite is chainable after any other suite.
  await mp.evaluate(() => {
    try {
      wx.reLaunch({ url: '/pages/home/home' });
    } catch (_) {}
  });
  await sleep(1500);
  // ---------- warm-up: the simulator may not have rendered a page yet ----------
  let page = null;
  for (let i = 1; i <= 12; i++) {
    try {
      const p = await mp.currentPage();
      if (p && p.path) {
        page = p;
        break;
      }
    } catch (_) {}
    console.log(`  ..waiting for the simulator page (${i})`);
    await sleep(2500);
  }
  if (!page) throw new Error('simulator never produced a page; is the project open in DevTools?');
  check('on home page', page.path.includes('home'), page.path);

  // ---------- Session A: 3 rounds / 3s work / 1s rest ----------
  await configure(3, 3, 1);
  let hd = await readData();
  check(
    'quick setup applied (3 / 3s / 1s)',
    Number(hd.groups) === 3 && Number(hd.duration) === 3 && Number(hd.rest) === 1,
    `groups=${hd.groups} duration=${hd.duration} rest=${hd.rest}`,
  );
  const inherited = hd.items.every((it) => Number(it.work) === 3 && Number(it.rest) === 1);
  check(
    'rounds inherit the new work/rest (Quick Setup fix)',
    inherited,
    'items=' + JSON.stringify(hd.items.map((i) => `${i.work}/${i.rest}`)),
  );

  await tapSel('button.start', 'start A');
  await sleep(1500);
  check(
    'start navigates to timer',
    (await mp.currentPage()).path.includes('timer'),
    (await mp.currentPage()).path,
  );

  let td = await readData();
  check(
    'timer starts at round 1 / total 3',
    td.group === 1 && td.total === 3,
    `group=${td.group} total=${td.total}`,
  );
  const d0 = td.display;
  await sleep(1200);
  td = await readData();
  check('countdown advances', td.display !== d0, `${d0} -> ${td.display}`);

  let rest = await poll((d) => d.phase === 'rest', 6000);
  check('work -> rest transition', !rest.__timeout, rest.__timeout ? 'timed out' : 'phase=rest');
  let r2 = await poll((d) => d.group === 2, 6000);
  check('advances to round 2', !r2.__timeout, r2.__timeout ? 'timed out' : 'group=' + r2.group);

  let home = await stopToHome();
  check('stop returns to home', home.path.includes('home'), home.path);

  // ---------- Session B: 2 rounds / 2s / 0s -> fits inside the 8s window ----------
  await configure(2, 2, 0);
  await tapSel('button.start', 'start B');
  await sleep(1200);
  let done = await poll((d) => d.completed === true, 10000);
  check(
    'session completes',
    !done.__timeout,
    done.__timeout ? 'timed out, last=' + JSON.stringify(done.last) : 'completed=true',
  );

  if (!done.__timeout) {
    await tap(0, 'again');
    await sleep(1200);
    const ad = await readData();
    check(
      'restart (再来一次) resets the session',
      ad.completed !== true,
      'completed=' + ad.completed,
    );
  } else {
    check('restart (再来一次) resets the session', false, 'skipped - never completed');
  }
  home = await stopToHome();
  check('session B stop returns to home', home.path.includes('home'), home.path);

  // ---------- Session C: 3 rounds / 60s / 5s -> pause, resume, next, previous ----------
  // Fresh page stack: after sessions A/B the automator timer-page node can go
  // stale (it drops the node after a few seconds on timer), so reLaunch Home to
  // get a clean timer instance for the pause/resume checks.
  await mp.evaluate(() => {
    try {
      wx.reLaunch({ url: '/pages/home/home' });
    } catch (_) {}
  });
  await sleep(1500);
  await configure(3, 60, 5);
  await tapSel('button.start', 'start C');
  await sleep(2000);
  // The page re-renders every 250ms and the automator tap can land on a node
  // that is about to be re-created (the event is silently lost). Like a real
  // user, re-tap until the state actually changes.
  await tapUntil(0, 'pause', (d) => d.paused === true);
  await sleep(400);
  const frozen = (await readData()).display;
  await sleep(1100);
  let stillPaused = await readData();
  check(
    'pause freezes countdown',
    stillPaused.paused === true && stillPaused.display === frozen,
    `paused=${stillPaused.paused} ${frozen} -> ${stillPaused.display}`,
  );

  await tapUntil(0, 'resume', (d) => d.paused === false);
  await sleep(1100);
  let resumed = await readData();
  check(
    'resume restarts countdown',
    resumed.paused === false && resumed.display !== frozen,
    `${frozen} -> ${resumed.display}`,
  );

  const gBefore = resumed.group;
  await tap(2, 'next');
  await sleep(700);
  let afterNext = await readData();
  check(
    'next increments the round',
    afterNext.group === gBefore + 1,
    `${gBefore} -> ${afterNext.group}`,
  );

  await tap(1, 'previous');
  await sleep(700);
  let afterPrev = await readData();
  check(
    'previous decrements the round',
    afterPrev.group === gBefore,
    `${afterNext.group} -> ${afterPrev.group}`,
  );

  home = await stopToHome();
  check('session C stop returns to home', home.path.includes('home'), home.path);

  // ---------- Recovery: start a long session, leave, discard ----------
  await configure(2, 180, 10);
  await tapSel('button.start', 'start recovery session');
  await sleep(2000);
  check('long session started', (await mp.currentPage()).path.includes('timer'), 'timer active');

  home = await stopToHome();
  let rec = await readData();
  // The timer page's 停止/退出 handler calls removeStorageSync(KEY), so an
  // explicit stop DISCARDS the session by design - a recovery card must NOT
  // appear. Recovery-on-return (leaving without stopping / cold start) is
  // covered separately by scripts/recovery_test.mjs, which restarts the
  // project with `cli close` + `cli open` to emulate a cold start.
  check(
    'explicit stop discards the session (no recovery card)',
    !rec.recovery,
    'recovery=' + JSON.stringify(rec.recovery),
  );

  // ---------- Routines (last: no back button on that page) ----------
  await tapSel('button.secondary', 'routines');
  await sleep(1800);
  check(
    'routines page reached',
    (await mp.currentPage()).path.includes('routines'),
    (await mp.currentPage()).path,
  );

  const before = (await readData()).routines.length;
  await tapSel('button.start', 'save routine');
  await sleep(1200);
  const rd = await readData();
  check('routine saved', rd.routines.length === before + 1, `${before} -> ${rd.routines.length}`);

  const cntBefore = (await readData()).routines.length;
  await tap(5, 'delete routine');
  await sleep(1500);
  const cntAfter = (await readData()).routines.length;
  check('routine deleted', cntAfter === cntBefore - 1, `${cntBefore} -> ${cntAfter}`);
} catch (e) {
  let detail = '';
  try {
    detail = e && (e.stack || e.message) ? e.stack || e.message : JSON.stringify(e);
  } catch (_) {
    detail = String(e);
  }
  console.log('RAW ERROR:\n' + detail);
  check('smoke run completed without exception', false, (e && e.message) || String(e));
} finally {
  await mp.disconnect();
}

const failed = results.filter((r) => !r.ok);
console.log('\n===== SUMMARY =====');
console.log(`passed ${results.length - failed.length}/${results.length}`);
failed.forEach((f) => console.log('FAILED: ' + f.name + (f.detail ? ' :: ' + f.detail : '')));
process.exit(failed.length ? 1 : 0);
