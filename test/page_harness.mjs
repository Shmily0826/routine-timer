// Run a WeChat page's logic in plain Node — no DevTools, no automation port.
//
// The pages are plain objects handed to the global Page() factory, so stubbing
// Page/wx/timers is enough to drive them: require the compiled .js (built by
// `npm run build:wechat`), capture the definition, and call its lifecycle
// methods by hand with a controllable clock.
//
// This is what caught the frozen "again" (再来一次) bug: the automator suites
// never tap that path, but a unit-level harness reaches it in milliseconds.
import { existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// setData accepts dotted/bracket paths like `items[0].work`; WXML setData does,
// so the harness has to as well or page writes silently land in the wrong place.
function setPath(obj, key, value) {
  const tokens = key.replace(/\[(\d+)\]/g, '.$1').split('.');
  let cur = obj;
  for (let i = 0; i < tokens.length - 1; i++) {
    if (cur[tokens[i]] == null) cur[tokens[i]] = {};
    cur = cur[tokens[i]];
  }
  cur[tokens[tokens.length - 1]] = value;
}

export function loadPage(rel, options = {}) {
  const jsPath = path.join(ROOT, 'miniprogram', rel + '.js');
  const tsPath = path.join(ROOT, 'miniprogram', rel + '.ts');

  if (!existsSync(jsPath)) {
    throw new Error(`missing built page ${rel}.js — run: npm run build:wechat`);
  }
  // Guard against green tests on stale output: if the .ts changed after the
  // last build we are exercising old code.
  if (existsSync(tsPath) && statSync(jsPath).mtimeMs < statSync(tsPath).mtimeMs) {
    throw new Error(`stale build: ${rel}.js is older than ${rel}.ts — run: npm run build:wechat`);
  }

  const store = new Map(options.storage ? Object.entries(options.storage) : []);
  const calls = [];
  const setDataCalls = [];

  const real = {
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    DateNow: Date.now,
    wx: globalThis.wx,
    Page: globalThis.Page,
  };

  let now = options.startTime ?? Date.parse('2026-09-03T10:00:00Z');
  const intervals = new Map();
  let nextId = 1;
  // Simulated system clipboard, so export→import round-trips can be tested.
  let clipboard = typeof options.clipboard === 'string' ? options.clipboard : '';

  Date.now = () => now;
  globalThis.setInterval = (fn, ms) => {
    const id = nextId++;
    intervals.set(id, { fn, ms });
    return id;
  };
  globalThis.clearInterval = (id) => {
    intervals.delete(id);
  };

  const audio = {
    src: '',
    playing: false,
    destroyed: false,
    play() {
      this.playing = true;
      calls.push('audio:play');
    },
    stop() {
      this.playing = false;
      calls.push('audio:stop');
    },
    destroy() {
      this.destroyed = true;
      calls.push('audio:destroy');
    },
    onError() {},
  };

  globalThis.wx = {
    getStorageSync: (k) => (store.has(k) ? store.get(k) : ''),
    setStorageSync: (k, v) => store.set(k, v),
    removeStorageSync: (k) => store.delete(k),
    createInnerAudioContext: () => audio,
    setInnerAudioOption: (o) => calls.push('audioOption:' + JSON.stringify(o)),
    setKeepScreenOn: (o) => calls.push('keep=' + o.keepScreenOn),
    vibrateShort: (o) => calls.push('vibrate:' + (o && o.type)),
    navigateBack: () => calls.push('navigateBack'),
    navigateTo: (o) => calls.push('navigateTo:' + (o && o.url)),
    reLaunch: (o) => calls.push('reLaunch:' + (o && o.url)),
    showToast: (o) => calls.push('toast:' + (o && o.title)),
    showModal: (o) => {
      calls.push('modal:' + (o && o.title));
      // Resolve like a user tapping confirm, but allow opting out.
      if (o && o.success)
        o.success({
          confirm: options.modalConfirm !== false,
          cancel: options.modalConfirm === false,
        });
    },
    setClipboardData: (o) => {
      clipboard = o && o.data;
      calls.push('clipboard:set');
      if (o && o.success) o.success({ data: clipboard });
    },
    getClipboardData: (o) => {
      if (o && o.success) o.success({ data: clipboard });
    },
  };

  let def = null;
  globalThis.Page = (d) => {
    def = d;
  };

  // Fresh module instance per page load: pages keep module-level state (e.g.
  // nothing today, but the require cache would share it between tests).
  const resolved = require.resolve(jsPath);
  delete require.cache[resolved];
  require(jsPath);
  if (!def) throw new Error(`page ${rel} did not call Page()`);

  const page = Object.assign({}, def);
  page.data = JSON.parse(JSON.stringify(def.data ?? {}));
  page.setData = (patch) => {
    for (const k of Object.keys(patch)) setPath(page.data, k, patch[k]);
    setDataCalls.push(patch);
  };

  const runAll = () => {
    for (const { fn } of [...intervals.values()]) fn();
  };

  const clock = {
    get now() {
      return now;
    },
    get ticking() {
      return intervals.size > 0;
    },
    /** Move time forward, then fire every pending interval once. */
    advance(ms) {
      now += ms;
      runAll();
      return clock;
    },
    /** Fire pending intervals without moving time (for sub-tick assertions). */
    tick() {
      runAll();
      return clock;
    },
  };

  const dispose = () => {
    globalThis.setInterval = real.setInterval;
    globalThis.clearInterval = real.clearInterval;
    Date.now = real.DateNow;
    if (real.wx === undefined) delete globalThis.wx;
    else globalThis.wx = real.wx;
    if (real.Page === undefined) delete globalThis.Page;
    else globalThis.Page = real.Page;
  };

  return {
    page,
    store,
    calls,
    setDataCalls,
    clock,
    audio,
    dispose,
    setClipboard: (v) => (clipboard = v),
    get clipboard() {
      return clipboard;
    },
  };
}

/** Filter helper: `matching(h.calls, 'keep=')` → ['keep=true', 'keep=false'] */
export function matching(calls, prefix) {
  return calls.filter((c) => typeof c === 'string' && c.startsWith(prefix));
}

export { ROOT };
