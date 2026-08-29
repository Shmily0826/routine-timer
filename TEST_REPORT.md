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

## Real-device validation remaining
Android physical device: background/foreground, lock screen, process kill + cold start, rapid taps, sound, silent/media volume, vibration, keep-screen-on, long session, Routine save/start/rename/delete, Continue/Discard recovery.
