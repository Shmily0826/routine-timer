# 分组练习计时器

原生微信小程序 + TypeScript 的极简分组练习计时器 MVP。支持 Quick Setup、逐组动作名称/训练/休息 override、work/rest 流程、暂停/继续、上一组/下一组、完成状态、运行中 Session 恢复，以及本地 Routine 的保存/列表/开始/重命名/删除。

## 本地运行

安装 Node.js 依赖后运行 `npm install`、`npm run typecheck`、`npm test` 和 `npm run build:wechat`。使用微信开发者工具打开仓库根目录，项目配置的 `miniprogramRoot` 为 `miniprogram/`；`project.config.json` 已配置正式 AppID `wxbd0de427d588fa95`，真机调试、预览与上传均可用。

生产逻辑（单一来源）位于：
- Timer Engine：`miniprogram/domain/timer.ts`
- Storage：`miniprogram/domain/storage.ts`

自动化测试直接 import 上述 production 实现，不通过 re-export 或副本。

## 计时设计

计时域状态以 `phaseStartedAt` / `endTimestamp` 为事实来源，UI 仅每 250ms 刷新并通过当前时间重算剩余时间。暂停保存剩余毫秒，继续时生成新的绝对结束时间；页面重新显示会立即校正并补齐跨前台间隔，避免 interval 漂移或重复 transition。

## 限制

微信小程序后台或锁屏时不能保证 JavaScript 持续执行，因此后台实时声音/震动不保证；回到前台会从 Storage 读取 Session 并按时间戳跨越多个 phase。计时页 `onHide` 会 `clearInterval` 停止 250ms tick、`onShow` 才重启并补一次渲染，因此**自动提示仅在小程序前台且屏幕亮着时触发**，锁屏或切走微信期间不触发，回前台只补最后一次（已真机验证，见「真机验证」一节）。声音调用使用本地 `miniprogram/assets/cue.wav`，播放失败会静默 fallback；Routine 列表 UI 的保存/加载/删除已实现。

## Validation status

- `npm install`：已存在本地依赖（`typescript` + `miniprogram-api-typings`，`package-lock.json` 已存在）。
- `npm run typecheck`：PASS（`strict`，覆盖 `miniprogram/**` 与 `src/**` 全部 production code；`wx`/`Page`/timer 全局类型来自 `miniprogram-api-typings`，非 `any` 桩）。
- `npm test`：PASS，10/10（Timer Engine 7，storage/Routine 3；新增 stale-session→completed 边界回归测试）。
- `npm run build:wechat`：PASS，生成页面与 domain 的小程序 `.js` 文件。
- WeChat DevTools：真实 `cli open --project D:\CODE\project\Timer` PASS。唯一的黄色提示 `routeTo appLaunch timeout` 已定位为缺少 `app.js` 入口，新增 `miniprogram/app.ts` 后最新 WeappLog 中已无该警告与 ERROR。
- 模拟器冒烟（自动化端口 + `miniprogram-automator`，无需手动点击）：八个 harness 全绿 —— `smoke` **22/22**、`recovery` **8/8**、`prefs` **8/8**、`routine-edit` **12/12**、`routine-dup` **6/6**、`history` **8/8**、`fixes` **9/9**、`edge` **11/11**（2026-08-31 复验，详见 `TEST_REPORT.md`）。覆盖倒计时、work→rest、进组、暂停/恢复、上一组/下一组、完成、再来一次、停止返回、Routine 保存/编辑/复制/删除、偏好持久化、训练历史。已修复 Quick Setup 的训练/休息秒数不生效的 bug。恢复卡片（未停止就离开）已由 `recovery` harness 覆盖（8/8）。
- `edge` 套件补的是其它套件没走的边界路径：休息 0 秒会跳过 rest 相位直接进下一组（不会卡住或自旋）、完成时只写**一条**历史记录且字段正确、完成后的 250ms tick 不会重复追加记录、训练历史上限 100 条（新的在前、最旧的被丢弃）。

### 真机验证（Xiaomi 15 Pro / Android 16 / HyperOS V816，adb 驱动）

| 项目 | 方法 | 结果 |
| --- | --- | --- |
| 屏幕常亮 keepScreenOn | 临时把屏幕超时改为 15s，静置 32s 后读 `mWakefulness` | ✅ 保持 `Awake`，未熄屏 |
| 自动阶段提示（work→rest / rest→work / 完成） | 临时在计时页插桩显示 cue 计数，让计时器自动跑完 8 组 | ✅ 计数 0 → 17，三种切换均触发 `cue()` |
| 锁屏 / 后台计时 | adb 锁屏 15s 后唤醒，对比剩余时间 | ✅ 未归零、未冻住，继续跑完并显示完成汇总 |
| 提示音的**实际感知** | 用户主观确认 | ✅ 用户在真机上听到「滴」（`obeyMuteSwitch:false` 生效） |
| 震动的**实际感知** | 用户主观确认 | ⏳ 未确认 —— 根因是系统 `haptic_feedback_enabled=0`（非代码 / 非微信权限问题），需用户在 设置 → 声音与触感 打开「触感反馈」后复测 |
| 恢复卡片（未停止就离开） | 中途退出再进入小程序 | ✅ 真机显示「发现未完成的训练」（模拟器 `recovery` 8/8 亦通过） |
| 进程被杀 + 冷启动恢复 | `am force-stop com.tencent.mm` 后重开，读取剩余时间 | ✅ 两次均正确：恢复后倒计时与理论剩余一致（07:53/07:55、04:52/04:54） |
| 热恢复（切后台再切回） | 按 HOME 53 秒后通过「最近使用」切回 | ✅ 02:16 vs 理论 02:18，直接回到计时页，未丢进度 |
| 自动阶段切换 / 0 秒休息跳过 | 1 组 999 秒跑完后观察 | ✅ 自动进入第 2 组，无 rest 卡帧；`edge` 套件亦覆盖 |
| 完成页汇总 + 历史写入 | 1 组 5 秒短会话跑完 | ✅ 完成页显示「训练5秒－休息0秒／总时长5秒」，历史记录第一条与之一致 |
| 停止/退出后卡片残留 | 计时页点「停止／退出」回到首页 | ✅ 已修复：原 `home.onShow` 无 `else` 分支，停止后恢复卡片仍残留；点「继续训练」会误重开新会话 |
| iOS | — | ⏳ 代码已加 `wx.setInnerAudioOption({obeyMuteSwitch:false})`，待真机验证；静音键理论上不再屏蔽提示音 |
| 连点 / 长会话 | — | ⏳ 待真机复测 |

自动提示的修正是 commit `abfaf2b`：`render()` 内检测 `phase` / `currentRoundIndex` / `completed` 变化后自动触发 `cue()`，并去掉 `goNext` 里重复的显式调用。
