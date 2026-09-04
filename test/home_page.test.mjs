// Page-level tests for the home screen, driven without the WeChat runtime.
//
// home.ts holds the parsing/normalising rules for every number the user types,
// plus the recovery-card logic. Those are exactly the branches the automator
// suites tend to exercise only through the happy path, and this harness can
// reach them in milliseconds with no DevTools.
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
};

const START = Date.parse('2026-09-03T10:00:00Z');

function loadHome(storage = {}, options = {}) {
  const h = loadPage('pages/home/home', {
    storage,
    startTime: START,
    ...options,
  });
  h.page.onLoad();
  return h;
}

function runningSession(overrides = {}) {
  return {
    status: 'running',
    phase: 'work',
    currentRoundIndex: 1,
    rounds: [
      { name: 'A', workSec: 30, restSec: 0 },
      { name: 'B', workSec: 30, restSec: 0 },
    ],
    phaseStartedAt: START,
    endTimestamp: START + 30000,
    startedAt: START,
    updatedAt: START,
    ...overrides,
  };
}

test('no stored prefs seeds eight default rows', (t) => {
  const h = loadHome();
  t.after(() => h.dispose());

  assert.equal(h.page.data.groups, '8');
  assert.equal(h.page.data.items.length, 8);
  assert.deepEqual(h.page.data.items[0], {
    name: '动作 1',
    work: '30',
    rest: '10',
    ow: false,
    or: false,
  });
});

test('stored prefs are restored', (t) => {
  const h = loadHome({
    [KEYS.prefs]: {
      groups: 3,
      duration: 45,
      rest: 15,
      items: [
        { name: '深蹲', work: 40, rest: 20 },
        { name: '俯卧撑', work: 30, rest: 10 },
      ],
    },
  });
  t.after(() => h.dispose());

  assert.equal(h.page.data.groups, '3');
  assert.equal(h.page.data.duration, '45');
  assert.equal(h.page.data.rest, '15');
  assert.equal(h.page.data.items[0].name, '深蹲');
  assert.equal(h.page.data.items[0].work, '40', 'numbers come back as strings for the inputs');
});

test('a saved pref list longer than 50 rows is truncated on read', (t) => {
  const items = Array.from({ length: 60 }, (_, i) => ({ name: `动作 ${i}`, work: 30, rest: 0 }));
  const h = loadHome({ [KEYS.prefs]: { groups: 60, duration: 30, rest: 0, items } });
  t.after(() => h.dispose());

  assert.equal(h.page.data.items.length, 50);
});

test('clearing the groups field does not truncate the rows', (t) => {
  // Regression: normalising on input clamped '' to 1, so wiping the field to
  // retype '12' dropped the list to one row and lost custom names.
  const h = loadHome({
    [KEYS.prefs]: {
      groups: 4,
      duration: 30,
      rest: 10,
      items: [
        { name: '深蹲', work: 30, rest: 10 },
        { name: '俯卧撑', work: 30, rest: 10 },
        { name: '平板支撑', work: 30, rest: 10 },
        { name: '波比跳', work: 30, rest: 10 },
      ],
    },
  });
  t.after(() => h.dispose());

  h.page.onGroups({ detail: { value: '' } });
  assert.equal(h.page.data.groups, '');
  assert.equal(h.page.data.items.length, 4, 'rows must survive an empty field');

  h.page.onGroups({ detail: { value: '12' } });
  assert.equal(h.page.data.items.length, 12);
  assert.equal(h.page.data.items[3].name, '波比跳', 'and the names typed before clearing');
  assert.equal(h.page.data.items[4].name, '动作 5', 'new rows get default names');
});

test('group count is capped at 50', (t) => {
  const h = loadHome();
  t.after(() => h.dispose());

  h.page.onGroups({ detail: { value: '999' } });
  assert.equal(h.page.data.items.length, 50);
});

test('a per-item override survives a global duration change', (t) => {
  const h = loadHome();
  t.after(() => h.dispose());

  h.page.onItemWork({ detail: { value: '60' }, currentTarget: { dataset: { index: 0 } } });
  assert.equal(h.page.data.items[0].ow, true);

  h.page.onDuration({ detail: { value: '20' } });
  assert.equal(h.page.data.items[0].work, '60', 'overridden row keeps its own value');
  assert.equal(h.page.data.items[1].work, '20', 'untouched rows follow the global field');
});

test('start writes the rounds, drops any old session and navigates', (t) => {
  const h = loadHome({ [KEYS.session]: runningSession({ status: 'paused' }) });
  t.after(() => h.dispose());

  h.page.onGroups({ detail: { value: '2' } });
  h.page.onDuration({ detail: { value: '25' } });
  h.page.onRest({ detail: { value: '5' } });
  h.page.start();

  assert.deepEqual(h.store.get(KEYS.active), [
    { name: '动作 1', workSec: 25, restSec: 5 },
    { name: '动作 2', workSec: 25, restSec: 5 },
  ]);
  assert.equal(h.store.has(KEYS.session), false, 'a new run must not inherit the old session');
  assert.ok(h.calls.includes('navigateTo:/pages/timer/timer'));
});

test('fractional seconds are floored so the stored value matches what runs', (t) => {
  // Regression: parseSec kept 30.5 while domain normalizeSeconds() runs 30, so
  // the routine advertised 30.5s and counted 30s.
  const h = loadHome();
  t.after(() => h.dispose());

  h.page.onDuration({ detail: { value: '30.5' } });
  h.page.start();

  assert.equal(h.store.get(KEYS.active)[0].workSec, 30);
});

test('an out-of-range duration falls back instead of producing NaN', (t) => {
  const h = loadHome();
  t.after(() => h.dispose());

  h.page.onDuration({ detail: { value: 'abc' } });
  h.page.start();
  assert.equal(h.store.get(KEYS.active)[0].workSec, 30, 'unparseable text uses the default');

  h.page.onDuration({ detail: { value: '-5' } });
  h.page.start();
  assert.equal(h.store.get(KEYS.active)[0].workSec, 1, 'negative clamps up to the minimum');
});

test('saving a routine numbers by the highest existing suffix, not list length', (t) => {
  // After deleting "Routine 2" a length-based name would collide with the
  // surviving "Routine 3".
  const h = loadHome({
    [KEYS.routines]: [
      { id: '1', name: 'Routine 1', rounds: [], createdAt: 0, updatedAt: 0 },
      { id: '3', name: 'Routine 3', rounds: [], createdAt: 0, updatedAt: 0 },
    ],
  });
  t.after(() => h.dispose());

  h.page.onGroups({ detail: { value: '1' } });
  h.page.saveRoutine();

  const list = h.store.get(KEYS.routines);
  assert.equal(list.length, 3);
  assert.equal(list[2].name, 'Routine 4');
  assert.equal(list[2].id, String(START));
  assert.ok(h.calls.includes('reLaunch:/pages/routines/routines'));
});

test('editing an existing routine updates it in place instead of appending', (t) => {
  const h = loadHome({
    [KEYS.routines]: [
      {
        id: 'r1',
        name: 'Routine 1',
        rounds: [{ name: '旧', workSec: 30, restSec: 10 }],
        createdAt: 0,
        updatedAt: 0,
      },
    ],
  });
  t.after(() => h.dispose());

  h.page.loadRoutineForEdit('r1');
  assert.equal(h.page.data.editId, 'r1');
  assert.equal(h.page.data.items[0].name, '旧');
  assert.equal(h.page.data.items[0].work, '30');

  h.page.onName({ detail: { value: '新' }, currentTarget: { dataset: { index: 0 } } });
  h.page.saveRoutine();

  const list = h.store.get(KEYS.routines);
  assert.equal(list.length, 1, 'edit must not create a second routine');
  assert.equal(list[0].rounds[0].name, '新');
  assert.equal(h.page.data.editId, null, 'and it exits edit mode');
});

test('onShow offers recovery for a live session', (t) => {
  const h = loadHome({ [KEYS.session]: runningSession() });
  t.after(() => h.dispose());

  h.page.onShow();
  assert.deepEqual(h.page.data.recovery, { round: 2, name: 'B' });
});

test('onShow clears the card once the session has completed', (t) => {
  const h = loadHome({ [KEYS.session]: runningSession({ status: 'completed' }) });
  t.after(() => h.dispose());

  h.page.onShow();
  assert.equal(h.page.data.recovery, null);
  assert.equal(h.store.has(KEYS.session), false, 'a finished session must be dropped');
});

test('onShow clears a leftover card when storage is empty', (t) => {
  // Regression: returning to a home page that still held last run's card left it
  // on screen after the session was stopped, tapping 继续 then resumed nothing.
  const h = loadHome({ [KEYS.session]: runningSession() });
  t.after(() => h.dispose());

  h.page.onShow();
  assert.ok(h.page.data.recovery, 'precondition: the card is showing');

  h.store.delete(KEYS.session);
  h.page.onShow();
  assert.equal(h.page.data.recovery, null, 'stale card must be cleared');
});

test('discard drops the session and hides the card', (t) => {
  const h = loadHome({ [KEYS.session]: runningSession() });
  t.after(() => h.dispose());

  h.page.onShow();
  h.page.discard();

  assert.equal(h.store.has(KEYS.session), false);
  assert.equal(h.page.data.recovery, null);
  assert.equal(matching(h.calls, 'navigateTo').length, 0, 'discard must not navigate');
});

test('about navigates to the about page', (t) => {
  const h = loadHome();
  t.after(() => h.dispose());

  h.page.about();
  assert.ok(
    h.calls.includes('navigateTo:/pages/about/about'),
    `expected a navigation to the about page, got ${JSON.stringify(h.calls)}`,
  );
});
