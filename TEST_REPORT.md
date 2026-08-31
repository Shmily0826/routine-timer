# Validation report

## Automated tests
`npm test` — 10/10 PASS.
- Timer Engine (7): countdown + exact boundary → rest; rest → next work; multi-phase background recovery → completion; pause freeze / resume restore; next/previous; zero rest + invalid values; stale running session reconciles to completed (new edge-case regression test).
- Storage / Routine (3): valid routine parsing + optional `lastUsedAt`; malformed storage safe fallback + session defensive parsing; round overrides normalize on reload.

Tests import the production implementation directly (`miniprogram/domain/timer.ts`, `miniprogram/domain/storage.ts`). No re-export shim, no duplicate logic.

## TypeScript
`npm run typecheck` — PASS. `tsc --noEmit` under `strict`. `tsconfig.json` `include` covers `src/**/*.ts` and `miniprogram/**/*.ts`. WeChat globals (`wx`, `Page`, `setInterval`, ...) come from `miniprogram-api-typings` (via `typeRoots`). `skipLibCheck` only skips the typings' own `.d.ts`, not production code.

## Dependencies
`npm install` succeeded: `typescript` + `miniprogram-api-typings` installed; `package-lock.json` generated. `node_modules/` is gitignored.

## Static checks
JSON config parses; pages registered in `miniprogram/app.json`; every WXML handler maps to a Page method; Page imports resolve within `miniprogramRoot`; `miniprogram/assets/cue.wav` is a valid 1644-byte RIFF/WAVE; single Timer Engine source (`miniprogram/domain/timer.ts`), no duplicate implementation.

## WeChat DevTools
INSTALLED (this run). Official Stable Build 2.02.2608060 (2026/08/25) from `devtools.wxqcloud.qq.com.cn`; Authenticode verified — `CN=Tencent Technology (Shenzhen) Company Limited`, DigiCert G4 Code Signing CA, timestamped. NSIS silent install to `D:\Dev-Setup\wechat-devtools` (not redirected to Program Files). CLI entry: `cli.bat` / `resources/app.asar.unpacked/js/common/cli/index.js`.

Real compile status: **PASS (2026-08-28)**.
- After enabling CLI Service Port in the IDE, `cli open --project D:\CODE\project\Timer` returned `√ open` and the simulator displayed the Home page and Timer page.
- `compile` is not a CLI subcommand; `cli open --project <path>` is what opens the project and triggers a real IDE compile.
- Prepared `D:\Dev-Setup\devtools_compile.ps1`: launches the IDE (interactive session, so the WeChat login QR can show), pipes `y` to enable the service port, runs `cli open` in a retry loop, and captures full output to `D:\Dev-Setup\devtools_open.log`. Simulator smoke + Android device testing still NOT RUN.

The first compile attempt exposed the missing TypeScript-to-JavaScript build output (`home.js` was absent). `npm run build:wechat` now emits the page/domain JavaScript into `miniprogram/`, and the generated files are gitignored. The single yellow warning visible in the console — `routeTo appLaunch timeout` in the PROJECT WeappLog — was traced to the same root cause extended to the app entry: `miniprogram/` had `app.json` but no `app.js`, so the IDE could not confirm `onLaunch` ran. Adding `miniprogram/app.ts` (`App({ onLaunch() {} })`) and rebuilding cleared the warning; the newest WeappLog after a forced IDE relaunch + reopen shows **0 `appLaunch` mentions and 0 ERROR lines**. `cue.wav` is present and loads. Simulator smoke and Android real-device regression still NOT RUN.

### Simulator smoke (2026-08-29) — driven headlessly via the automation port
DevTools exposes an automation port (`cli auto --project <path> --auto-port 9420 --trust-project`) that the
official `miniprogram-automator` SDK can drive, so the simulator was exercised WITHOUT manual clicking.
Two constraints found: programmatic navigation (`navigateTo`/`reLaunch`/`navigateBack`) throws
`Uncaught [object Object]` (so every transition uses real UI taps), and the automator drops the page node
after ~8s on the timer page (so each timer session is kept short).

`node scripts/smoke.mjs` → **21/22 PASS**:
- Quick setup applied and **rounds inherit the new work/rest** (`items=["3/1","3/1","3/1"]`) — the bug fix below.
- start → timer; round 1/total 3; countdown advances (`00:03 -> 00:02`); work → rest; advances to round 2.
- Session completes (`completed=true`); 再来一次 resets it; stop returns to home.
- Pause freezes (`01:00 -> 01:00`); resume restarts (`01:00 -> 00:59`); next `1 -> 2`; previous `2 -> 1`.
- Explicit stop **discards** the session (no recovery card) — correct: `stop()` calls `removeStorageSync`.
- Routines: page reached, save `0 -> 1`, delete `1 -> 0`.

NOT verified in the simulator (needs a real device):
- **Recovery card on return.** The only way off the timer page is 停止/退出, which discards the session by
  design; `cli close` + `cli open` did not surface a card and `callWxMethod('getStorageSync')` returns
  undefined, so the cold-start path is inconclusive rather than proven broken.
- Background / lock-screen behaviour, sound, vibration, keep-screen-on.

### Bug fixed: Quick Setup work/rest inputs were inert
`home.ts` set only the top-level `duration`/`rest`, but `start()` builds the session from `items[]`
(`workSec: x.work || duration`), and `items[]` still held the `onLoad` defaults (30/10). Setting 3s/1s
still ran a 30s/10s timer. Fix: `onDuration`/`onRest` now propagate to every item **not individually
overridden** (tracked via `ow`/`or` flags set by `onItemWork`/`onItemRest`). The flags never reach
storage — `start()` maps to a clean `{name, workSec, restSec}` shape.
Also: `tsconfig.json` now pins `types: ["miniprogram-api-typings"]`, because `miniprogram-automator`
pulls in stub `@types/*` packages (`xtend`, `xml2js`) that broke `tsc` with TS2688.

### Harness re-validation (2026-08-31, HEAD 36f4046)
Re-ran the full gate after the real-device work landed:
- `npm run typecheck` PASS; `npm test` 10/10 PASS.
- DevTools compile re-verified: `cli open` → simulator renders Home/Timer/Routines, real IDE compile OK.
- All six automator suites now green: `smoke` **22/22**, `recovery` **8/8**, `prefs` **8/8**, `routine-edit` **12/12**, `routine-dup` **6/6**, `history` **8/8**.
- Console audit with `console.error` / `wx.onError` / `wx.onUnhandledRejection` hooks installed before a clean full timer session (3×3s+1s): **0 errors**, session completed correctly. The 14 errors visible in the DevTools console earlier were accumulated during harness runs (intentional navigation exceptions injected by the tests), not product issues.
- Sound/vibration/keepScreenOn runtime: `cue()` (vibrateShort + InnerAudioContext) fired on every phase transition during the clean run with no runtime errors; physical perception remains device-verified only (see README 真机验证).

Three harness scripts were fixed to make the suites green — all were test bugs, no product changes:
- `smoke.mjs`: Home data stores input values as strings, so `=== 3` → `Number(...) === 3`; recovery-card check `=== null` → falsy (page uses `undefined`).
- `prefs_test.mjs`: `wx.reLaunch` inside `mp.evaluate` silently no-ops when already on the target page, so prefill checks read stale in-memory data — reload via automator `mp.reLaunch` instead; string-tolerant assertions.
- `routine_edit_test.mjs`: `saveRoutine()` builds rounds from the `groups` field, not `items.length` — tests now set `groups` consistently; `ow:false` means "inherit global duration", so the create-case sets `ow:true`; `work` string-tolerant assertion.

### Product fixes (2026-08-31, HEAD after dc66c0b)
Three fixes from the code review, each verified in the simulator (8/8 targeted checks) with all six suites green after:
- **history.remove corrupted stored records** (`pages/history/history.ts`): the page wrote its display-shaped view objects (durations pre-formatted, `totalWorkSec`/`totalRestSec` gone) back to storage on delete. Now the raw records are kept on the page and removal filters them by id.
- **Inconsistent round-count cap** (`pages/home/home.ts`): `onGroups` accepted up to 999 while `start`/`saveRoutine`/prefs used fallback 8 with cap 999. All round-count paths now share `parseGroups` (cap 50). Verified: typing 999 clamps to 50 in page data and prefs storage.
- **rename() was a placeholder** (`pages/routines/routines.ts`): it appended （已改名） unconditionally. Now it opens `wx.showModal({editable:true})`, applies the trimmed non-empty content, bumps `updatedAt`. Verified via `mp.mockWxMethod('showModal', …)` including the blank-name no-op case.

Harness note: the automator connection degrades after the IDE has been hammered for hours (symptoms: `timeout waiting for automator response`, stale page node after `navigateBack`, page staying on timer). `cli.bat close --project …` + `cli.bat open …` + `cli.bat auto …` restores it — smoke passed 22/22 immediately after a restart while failing 3× before. Also hardened `smoke.mjs` `configure()` with the existing retry helper.

### Countdown buzz + double completion cue (2026-08-31)
- **3-2-1 countdown buzz**: while running with ≤3s left in a phase, each second now fires `wx.vibrateShort({type:'light'})` (keyed by phase/round/second, so one buzz per second, none while paused). Phase switches keep the heavier cue (sound + `medium`). Verified in-simulator with a vibrateShort spy: paused session in the window → 0 buzzes; resume from 2s → exactly 2 lights then completion.
- **Double completion cue fixed**: on completion `cue()` fired twice — once from the `_cueKey` transition and once from an explicit call in the completed branch (the latter also re-fired on every later `onShow` render). Removed the explicit call; completion now cues exactly once. Verified: `["light","light","medium"]` for a 2s resume-to-completion run.
- **smoke.mjs hardening for lost taps**: the IDE silently drops automator taps that land during the timer page's 250ms re-render, and its page node lags behind `navigateBack`. Added `tapUntil` (re-tap until the page data reflects the effect, used for pause/resume) and a home-poll in `stopToHome`. With those, smoke is deterministic on a fresh IDE.

Harness note (updated): after ~1h of suite hammering the IDE starts silently dropping taps and `wx.reLaunch`-via-evaluate no-ops widen; `cli.bat close/open/auto` restores crisp behavior — rerun the suites after an IDE restart before suspecting product regressions.

### Edge-case suite: zero-rest, history write, 100-record cap (2026-08-31)
New harness `scripts/edge_test.mjs` (`npm run edge`, wired into `npm run verify`) covering paths no other suite exercised. **11/11 PASS**, no product bugs found:
- **rest = 0s is skipped, not parked** — a 2-round session with `restSec: 0` advances straight from round 1 work to round 2 work. `reconcile()` only enters a rest phase when `restSec > 0`, so a zero-length phase cannot spin the advance loop or stall the session.
- **completion writes exactly one history record** — a 2 × 1s session completes and appends one record with `rounds=2 / totalWorkSec=2 / totalRestSec=0 / label=甲`.
- **no duplicate records after completion** — ~10 further 250ms ticks on an already-completed session append nothing (the `recorded` guard works).
- **history capped at 100** — with 100 existing records, a new completion keeps exactly 100: newest first, oldest dropped.

Harness note: the timer page's `onHide()` persists the live session back to storage, so every case navigates away to home, injects storage, then re-enters the timer. Injecting before leaving gets overwritten by that persist.

## Real-device validation remaining
Already verified on the Xiaomi 15 Pro (see README 真机验证): keep-screen-on, lock-screen / background timing, automatic phase cue, recovery card (Continue / Discard), and the audible cue.
Still outstanding:
- **vibration perception** — blocked by the device setting `haptic_feedback_enabled=0`, not by code. Needs 设置 → 声音与触感 → 触感反馈 enabled, then a re-test.
- **process kill + cold start** — never tested; the key recovery path for a timer.
- **iOS** — mute-switch fallback (`setInnerAudioOption({obeyMuteSwitch:false})`) is coded but unverified on a real iPhone.
- rapid taps, long session, silent / low media volume edge cases.
