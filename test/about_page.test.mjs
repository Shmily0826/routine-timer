// Page-level tests for the 帮助与反馈 page: the data export/import logic.
//
// This is the one piece of the app that can lose a user's whole history on a
// phone swap, yet it has no automator coverage (the suites never open 关于).
// Driving it through the DevTools-free harness means a bad parse or a silent
// overwrite gets caught in milliseconds, not by a user losing data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, matching } from './page_harness.mjs';

// Mirrors miniprogram/domain/storage.ts — literals because the harness loads
// compiled JS and cannot import the TS module.
const KEYS = {
  active: 'active-rounds',
  session: 'group-timer-session',
  routines: 'group-timer-routines',
  prefs: 'group-timer-prefs',
  history: 'group-timer-history',
};

const ROUTINES = [
  {
    id: 'r1',
    name: 'Routine 1',
    rounds: [{ name: 'A', workSec: 30, restSec: 10 }],
    createdAt: 1,
    updatedAt: 1,
  },
];

function loadAbout(storage = {}, options = {}) {
  const h = loadPage('pages/about/about', { storage, ...options });
  h.page.onLoad();
  return h;
}

function parseClipboard(h) {
  const set = matching(h.calls, 'clipboard:set');
  if (!set.length) return null;
  return JSON.parse(h.clipboard ?? '');
}

test('onLoad reads a version string', (t) => {
  const h = loadAbout();
  t.after(() => h.dispose());
  assert.equal(typeof h.page.data.version, 'string');
});

test('export copies a JSON backup to the clipboard', (t) => {
  const h = loadAbout({ [KEYS.routines]: ROUTINES, [KEYS.history]: [{ id: 'h1' }] });
  t.after(() => h.dispose());

  h.page.exportData();

  const backup = parseClipboard(h);
  assert.ok(backup, 'clipboard should hold a backup');
  assert.equal(backup.app, 'routine-timer');
  assert.equal(backup.version, 1);
  assert.deepEqual(backup.data[KEYS.routines], ROUTINES);
  assert.deepEqual(backup.data[KEYS.history], [{ id: 'h1' }]);
  // A missing key is exported as null, never as the storage sentinel ''.
  assert.equal(backup.data[KEYS.prefs], null);
  assert.ok(matching(h.calls, 'toast:已复制到剪贴板').length > 0);
});

test('import writes a wrapped backup into storage', (t) => {
  const h = loadAbout();
  t.after(() => h.dispose());

  const backup = {
    app: 'routine-timer',
    version: 1,
    data: { [KEYS.routines]: ROUTINES, [KEYS.prefs]: { sound: false } },
  };
  h.setClipboard(JSON.stringify(backup));
  h.page.importData();

  assert.deepEqual(h.store.get(KEYS.routines), ROUTINES);
  assert.deepEqual(h.store.get(KEYS.prefs), { sound: false });
  assert.ok(matching(h.calls, 'toast:导入成功').length > 0);
});

test('import accepts a raw bag of keys', (t) => {
  const h = loadAbout();
  t.after(() => h.dispose());

  h.setClipboard(JSON.stringify({ [KEYS.routines]: ROUTINES }));
  h.page.importData();

  assert.deepEqual(h.store.get(KEYS.routines), ROUTINES);
});

test('import rejects garbage and writes nothing', (t) => {
  const h = loadAbout({ [KEYS.routines]: ROUTINES, [KEYS.prefs]: { sound: true } });
  t.after(() => h.dispose());

  h.setClipboard('not json at all');
  h.page.importData();

  assert.deepEqual(h.store.get(KEYS.routines), ROUTINES, 'original data must survive');
  assert.deepEqual(h.store.get(KEYS.prefs), { sound: true });
  assert.ok(matching(h.calls, 'toast:剪贴板不是有效的备份').length > 0);
});

test('import rejects a backup with a non-array routines', (t) => {
  const h = loadAbout({ [KEYS.routines]: ROUTINES });
  t.after(() => h.dispose());

  h.setClipboard(JSON.stringify({ [KEYS.routines]: 'oops' }));
  h.page.importData();

  assert.deepEqual(h.store.get(KEYS.routines), ROUTINES, 'must not overwrite with junk');
});

test('cancelling the import modal writes nothing', (t) => {
  const h = loadAbout({}, { modalConfirm: false });
  t.after(() => h.dispose());

  const backup = { version: 1, data: { [KEYS.routines]: ROUTINES } };
  h.setClipboard(JSON.stringify(backup));
  h.page.importData();

  assert.equal(h.store.has(KEYS.routines), false, 'cancel must not write');
});
