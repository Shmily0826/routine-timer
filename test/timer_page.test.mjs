// Page-level tests for the timer screen, driven without the WeChat runtime.
//
// These exist because the automator suites never press 再来一次 ("again") —
// they all stop or navigate away — so a frozen clock on that path stayed green
// through 10 suites. Keep these fast and DevTools-free.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, matching } from './page_harness.mjs';

// Mirrors miniprogram/domain/storage.ts — kept as literals because the harness
// loads compiled JS and cannot import the TS module.
const KEYS = {
  active: 'active-rounds',
  session: 'group-timer-session',
  history: 'group-timer-history',
};

const TWO_ONE_SEC = [
  { name: 'A', workSec: 1, restSec: 0 },
  { name: 'B', workSec: 1, restSec: 0 },
];

function startTimer(rounds = TWO_ONE_SEC) {
  const h = loadPage('pages/timer/timer', { storage: { [KEYS.active]: rounds } });
  h.page.onLoad();
  h.page.onShow(); // onLoad does not tick; onShow starts the interval.
  return h;
}

test('runs to completion, stops ticking, writes one history record', (t) => {
  const h = startTimer();
  t.after(() => h.dispose());

  h.clock.advance(1000);
  assert.equal(h.page.data.group, 2, 'should have moved to the second round');
  assert.equal(h.page.data.completed, false);

  h.clock.advance(1000);
  assert.equal(h.page.data.completed, true);
  assert.deepEqual(h.page.data.summary, { rounds: 2, work: '2秒', rest: '0秒', total: '2秒' });
  assert.equal(h.clock.ticking, false, 'completed session must not keep polling');

  const history = h.store.get(KEYS.history);
  assert.equal(history.length, 1);
  assert.equal(history[0].rounds, 2);
  assert.equal(history[0].totalWorkSec, 2);
});

test('again restarts the clock (regression: interval was never recreated)', (t) => {
  const h = startTimer();
  t.after(() => h.dispose());

  h.clock.advance(2000);
  assert.equal(h.page.data.completed, true);

  h.page.again();
  assert.equal(h.page.data.completed, false);
  assert.equal(
    h.clock.ticking,
    true,
    'again must resume polling — the page never re-enters onShow',
  );

  h.clock.advance(1000);
  assert.equal(h.page.data.group, 2, 'clock is frozen if the round never advanced');
  h.clock.advance(1000);
  assert.equal(h.page.data.completed, true, 'second run must complete too');
  assert.equal(h.store.get(KEYS.history).length, 2, 'both runs are recorded');
});

test('again restores keep-screen-on (regression: it stayed off after completing)', (t) => {
  const h = startTimer();
  t.after(() => h.dispose());

  h.clock.advance(2000);
  assert.equal(
    matching(h.calls, 'keep=').pop(),
    'keep=false',
    'completing turns the screen lock off',
  );

  h.page.again();
  assert.equal(matching(h.calls, 'keep=').pop(), 'keep=true');
});

test('again does not fire a cue (regression: stale cue key rang immediately)', (t) => {
  // 30s rounds, not 1s: with a 1-second round the new session is already inside
  // its own 3-second countdown, so the countdown buzz is correct and would mask
  // the cue-key bug this case is guarding.
  const h = startTimer([
    { name: 'A', workSec: 30, restSec: 0 },
    { name: 'B', workSec: 30, restSec: 0 },
  ]);
  t.after(() => h.dispose());

  h.clock.advance(30000);
  h.clock.advance(30000);
  assert.equal(h.page.data.completed, true);
  const beforeVibrate = matching(h.calls, 'vibrate').length;
  const beforeAudio = matching(h.calls, 'audio:play').length;

  h.page.again();
  assert.equal(
    matching(h.calls, 'vibrate').length,
    beforeVibrate,
    'pressing again should be silent, not buzz',
  );
  assert.equal(
    matching(h.calls, 'audio:play').length,
    beforeAudio,
    'and should not replay the cue sound',
  );
});

test('pause freezes the countdown, stop clears the session', (t) => {
  const h = startTimer([
    { name: 'A', workSec: 30, restSec: 10 },
    { name: 'B', workSec: 30, restSec: 10 },
  ]);
  t.after(() => h.dispose());

  h.page.toggle();
  assert.equal(h.page.data.paused, true);

  const frozen = h.page.data.display;
  h.clock.advance(5000);
  assert.equal(h.page.data.display, frozen, 'paused remaining time must not drain');

  h.page.stop();
  assert.equal(h.store.has(KEYS.session), false, 'stopping must drop the saved session');
  assert.ok(h.calls.includes('navigateBack'));
  assert.equal(h.audio.destroyed, true, 'audio context must be released');
  assert.equal(matching(h.calls, 'keep=').pop(), 'keep=false');
});

test('leaving mid-session persists it, and reopening restores the paused state', (t) => {
  const h = startTimer([
    { name: 'A', workSec: 30, restSec: 10 },
    { name: 'B', workSec: 30, restSec: 10 },
  ]);
  t.after(() => h.dispose());

  h.page.toggle();
  h.page.onHide();
  const carried = Object.fromEntries(h.store);
  h.dispose();

  const reopened = loadPage('pages/timer/timer', { storage: carried });
  t.after(() => reopened.dispose());
  reopened.page.onLoad();

  assert.equal(reopened.page.data.paused, true, 'a paused session must come back paused');
  assert.equal(reopened.page.data.display, '00:30');
});

test('countdown buzzes once per second in the last three seconds', (t) => {
  const h = startTimer([{ name: 'A', workSec: 5, restSec: 0 }]);
  t.after(() => h.dispose());

  h.clock.advance(1000); // 4s left — quiet
  h.clock.advance(1000); // 3s
  h.clock.advance(1000); // 2s
  h.clock.advance(1000); // 1s
  assert.equal(matching(h.calls, 'vibrate:light').length, 3);

  h.clock.advance(1000); // done
  assert.equal(h.page.data.completed, true);
  assert.equal(matching(h.calls, 'vibrate:medium').length, 1, 'one completion cue');
});
