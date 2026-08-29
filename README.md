# 分组练习计时器

原生微信小程序 + TypeScript 的极简分组练习计时器 MVP。支持 Quick Setup、逐组动作名称/训练/休息 override、work/rest 流程、暂停/继续、上一组/下一组、完成状态、运行中 Session 恢复，以及本地 Routine 的保存/列表/开始/重命名/删除。

## 本地运行

安装 Node.js 依赖后运行 `npm install`、`npm run typecheck`、`npm test` 和 `npm run build:wechat`。使用微信开发者工具打开仓库根目录，项目配置的 `miniprogramRoot` 为 `miniprogram/`；当前配置使用开发 AppID，真机能力仍需按账号权限验证。

生产逻辑（单一来源）位于：
- Timer Engine：`miniprogram/domain/timer.ts`
- Storage：`miniprogram/domain/storage.ts`

自动化测试直接 import 上述 production 实现，不通过 re-export 或副本。

## 计时设计

计时域状态以 `phaseStartedAt` / `endTimestamp` 为事实来源，UI 仅每 250ms 刷新并通过当前时间重算剩余时间。暂停保存剩余毫秒，继续时生成新的绝对结束时间；页面重新显示会立即校正并补齐跨前台间隔，避免 interval 漂移或重复 transition。

## 限制

微信小程序后台或锁屏时不能保证 JavaScript 持续执行，因此后台实时声音/震动不保证；回到前台会从 Storage 读取 Session 并按时间戳跨越多个 phase。保持屏幕常亮、震动、声音和锁屏表现需在微信开发者工具/真实手机验证（REAL DEVICE REQUIRED）。声音调用使用本地 `miniprogram/assets/cue.wav`，播放失败会静默 fallback；Routine 列表 UI 的保存/加载/删除已实现。

## Validation status

- `npm install`：已存在本地依赖（`typescript` + `miniprogram-api-typings`，`package-lock.json` 已存在）。
- `npm run typecheck`：PASS（`strict`，覆盖 `miniprogram/**` 与 `src/**` 全部 production code；`wx`/`Page`/timer 全局类型来自 `miniprogram-api-typings`，非 `any` 桩）。
- `npm test`：PASS，10/10（Timer Engine 7，storage/Routine 3；新增 stale-session→completed 边界回归测试）。
- `npm run build:wechat`：PASS，生成页面与 domain 的小程序 `.js` 文件。
- WeChat DevTools：真实 `cli open --project D:\CODE\project\Timer` PASS。唯一的黄色提示 `routeTo appLaunch timeout` 已定位为缺少 `app.js` 入口，新增 `miniprogram/app.ts` 后最新 WeappLog 中已无该警告与 ERROR。
- 模拟器冒烟（自动化端口 + `miniprogram-automator`，无需手动点击）：`node scripts/smoke.mjs` → **21/22 PASS**，覆盖倒计时、work→rest、进组、暂停/恢复、上一组/下一组、完成、再来一次、停止返回、Routine 保存/删除。已修复 Quick Setup 的训练/休息秒数不生效的 bug（详见 `TEST_REPORT.md`）。恢复卡片（未停止就离开）与后台/锁屏/声音/震动需真机验证。
