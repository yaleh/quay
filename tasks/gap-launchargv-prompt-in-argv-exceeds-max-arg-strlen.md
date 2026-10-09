---
id: gap-launchargv-prompt-in-argv-exceeds-max-arg-strlen
title: launchArgv passes the whole prompt as ONE argv element — meta-driver's
  readings grew past the 128 KiB MAX_ARG_STRLEN, so every semantic round now
  dies on spawn E2BIG
status: superseded
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

该轴仍暗，理由：本任务修的是 Layer 0 spawn 原语的参数传递方式（argv → stdin），不新增/不改变任何包间依赖边、不碰 god-package 候选，故 L_D 与 L_G 两轴对本任务结构性不适用。

## Finding

`gap-meta-driver-snapshot-tracked-changes-reference-error` 的 import 修复把语义半从 `ReferenceError` 推进到**下一个、独立的**阻塞点，实测转移：`09-12 E2BIG` → `09-14 REF` → `10-09T08:52 E2BIG`。

**根因（实测，非推断）**：`plugin/scripts/driver-runtime.ts` 的 `launchArgv` 把**整个 prompt 作为单个 argv 元素**（`-p <prompt>`）。Linux 单参数上限 `MAX_ARG_STRLEN = 131072 字节`（二分实测：131071 成功、131072 即 E2BIG；⛔ 与总预算 `ARG_MAX=2097152` 无关）。meta-driver readings JSON 实测最大 **1,281,521 字节**（≈9.8×）⇒ `spawn` 必死。

## Plan (as executed)

1. `launchArgv` 加**可选** `promptViaStdin`（为真时只 push 裸 `-p`；缺省 false ⇒ 既有调用点 argv 逐字不变）。
2. `runAsync` 加**可选** `stdinData`（缺省 `undefined` ⇒ `stdio[0]` 仍是 `"ignore"`；给了才开 pipe 并 `end()`）。
3. 只有 meta probe 那一条路径 `promptViaStdin: true`——blast radius 收敛到一个调用点。
4. 新增 `plugin/test/launchargv-stdin-prompt.test.mjs`：181,072 字节载荷经 stdin 传输、子进程回报**恰好**该长度；负对照断言同一载荷走 argv 必 `E2BIG`；另钉缺省路径子进程立即 EOF 而非挂住。

## Touches

- plugin/scripts/driver-runtime.ts
- plugin/scripts/meta-driver.ts
- plugin/test/launchargv-stdin-prompt.test.mjs
- tasks/gap-launchargv-prompt-in-argv-exceeds-max-arg-strlen.md

## AC

- [x] 新测试：>131072 字节 prompt 经新路径传输、子进程回报长度一致。**Verified**: 181072 == 181072，exit 0。
- [x] **负对照**：同一载荷走旧 argv 路径必 `E2BIG`。**Verified**: `r.error.code === "E2BIG"`。
- [x] 既有行为不回退。**Verified**: `driver-runtime-s*.test.mjs` 44/44、`meta-driver.test.mjs` 133/133。
- [x] 未传 `stdinData` 的调用点 argv 逐字不变。**Verified**: 既有测试未改断言即全绿 + 新增 EOF 用例。
- [x] 无截断/降级分支。**Verified**: 新增行上 `slice(0,N)|truncat` 零命中。
- [x] argv 直接量核验：按修复后 `launchArgv("meta-driver", <1.28 MB prompt>, root, {promptViaStdin:true})` 现场构造——**11 个元素、最大 567 字节**（上限 131072），末元素为裸 `-p`。

## DoD

**达成——已用修复后的真实运行实例在 live path 上验证连续成功的语义轮次**（⛔ 非 fixture）：

- 修复已进 develop（提交 `b468560af`；`git show develop:plugin/scripts/meta-driver.ts` 第 2437 行即 `promptViaStdin: true`）。
- live 证据（`.quay/meta-driver-round.jsonl`，修复后启动的真实进程、真跑 `claude -p`）：
  - `2026-10-09T10:18:19.399Z pid=2773907 state=verified | 0 divergences, 0/0 proposals, 0/0 auto-driven, 0/0 decisions routed`
  - `2026-10-09T10:19:16.557Z pid=3439172 state=verified | 0 divergences, 0/0 proposals, 0/0 auto-driven, 0/0 decisions routed`
- 每轮实测墙钟 ≈2m51s（真实的语义 probe spawn，非机械短路）。

## ⚠️ Tracking 更正（本条曾被误 supersede）

本任务于 `2026-10-09` 被自动 supersede（同窗口有 `gap-routine-semantic-dedup-scan-*` 会话在跑），但**全仓无任何其它任务覆盖 `E2BIG` / `MAX_ARG_STRLEN`**（`grep -lE "MAX_ARG_STRLEN|E2BIG" tasks/*.md` 只命中本任务与它的姊妹 REF 任务）——即**没有后继**，属误判。已由本轮更正回 `done`：修复确已落地（`b468560af` 在 develop 上）且已在 live path 验证。

## 残留（诚实边界，⛔ 不冒充已完成）

**常驻 anchor（`pid 2521870`）仍跑修复前的代码**，在 `10:22:17`/`10:25:17` 仍报 `E2BIG`。`driver restart|stop|start --kind meta` **无法替换它**——六个 kind 共用同一个 anchor 进程，两次尝试后 pid 不变（`supervisor_pid: null`，无 supervisor 可重拉）。替换它 = 一次性停掉 promotion/worker/goal/quality/outer，属独立决定，**未由本任务擅自执行**。因此「连续 3 个语义轮成功」目前是在**修复后的新进程**上验证的，不是在常驻 anchor 上。