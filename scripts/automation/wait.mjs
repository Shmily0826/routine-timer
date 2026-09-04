// Shared waiting helpers for the automator suites.
//
// The suites used to `await sleep(1500)` after every navigation. That is both
// slow (~90s of pure waiting per full run) and racy: when the machine is busy
// the route has not flipped yet, the assertion reads the *previous* page's
// data, and the failure cascades — one missed navigation turned a 12-check
// suite into 2 pass / 10 fail, with two checks passing by accident.
//
// Poll for the state you actually need instead. A poll either gets there or
// times out loudly; a fixed sleep fails quietly and misattributes the blame.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Poll `fn` (run inside the mini program) until it returns something truthy.
 * `fn` receives `arg` and must be self-contained — it is serialised.
 * Returns the last value seen, which is falsy on timeout, so the caller's
 * own assertion still reports the real failure.
 */
async function waitUntil(mp, fn, arg, { timeout = 15000, interval = 150, label = '' } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await mp.evaluate(fn, arg).catch(() => undefined);
    if (last) return last;
    await sleep(interval);
  }
  if (label) console.log(`(timed out waiting for ${label})`);
  return last;
}

/** Wait until the top of the page stack is `route` (e.g. 'pages/home/home'). */
function waitForRoute(mp, route, options = {}) {
  return waitUntil(
    mp,
    (want) => {
      const pages = getCurrentPages();
      if (!pages || !pages.length) return null;
      const top = pages[pages.length - 1];
      return top.route === want || top.__route__ === want ? true : null;
    },
    route,
    { label: `route ${route}`, ...options },
  );
}

/**
 * Wait until `route` is in the page stack AND every key in `expected` matches
 * that page's data. This is the one that actually kills the flake: it waits for
 * onLoad(options) to have been *applied*, not merely for time to pass.
 *
 *   await waitForData(mp, 'pages/home/home', { editId: 'r1' });
 *
 * Deliberately takes a plain data object instead of a predicate function — the
 * mini program sandbox is hostile to eval/Function, so a serialised predicate
 * is not portable.
 */
function waitForData(mp, route, expected, options = {}) {
  return waitUntil(
    mp,
    ({ want, entries }) => {
      const pages = getCurrentPages();
      if (!pages || !pages.length) return null;
      const p = pages.find((x) => x.route === want || x.__route__ === want);
      if (!p) return null;
      for (const [key, wantValue] of entries) {
        // Supports 'editId' and 'routines[0].name' alike, so a caller can wait
        // on one field of an array without deep-comparing the whole thing.
        const got = key
          .replace(/\[(\d+)\]/g, '.$1')
          .split('.')
          .reduce((o, k) => (o == null ? o : o[k]), p.data);
        if (JSON.stringify(got) !== JSON.stringify(wantValue)) return null;
      }
      return true;
    },
    { want: route, entries: Object.entries(expected) },
    { label: `page ${route} with data ${JSON.stringify(expected)}`, ...options },
  );
}

/**
 * Wait for the simulator to be alive and showing at least one page. Cheap
 * insurance before the first reLaunch of a run: a reLaunch issued while the
 * app is still booting can be dropped entirely.
 */
async function warmUp(mp, { attempts = 20, interval = 1000 } = {}) {
  const ok = await waitUntil(
    mp,
    () => !!(getCurrentPages() && getCurrentPages().length),
    undefined,
    { timeout: attempts * interval, interval, label: 'simulator first page' },
  );
  // One extra beat: the first page existing is not the same as it having run
  // onLoad and rendered.
  await sleep(500);
  return ok;
}

/** Guard so a wedged run cannot leave a dangling websocket on :9420. */
function installGuards(getMp) {
  process.on('unhandledRejection', async (e) => {
    // getMp() can land in the temporal dead zone if connect() itself rejected
    // (the `const mp` is still unset), so it has to be its own try/catch.
    let m;
    try {
      m = getMp();
    } catch {
      m = undefined;
    }
    try {
      await m?.disconnect?.();
    } catch (_) {}
    console.error('UNHANDLED REJECTION:', e && e.message);
    process.exit(1);
  });
}

export { sleep, waitUntil, waitForRoute, waitForData, warmUp, installGuards };
