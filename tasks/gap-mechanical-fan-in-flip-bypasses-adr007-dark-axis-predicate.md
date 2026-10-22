---
id: gap-mechanical-fan-in-flip-bypasses-adr007-dark-axis-predicate
title: 机械 fan-in 翻 done 绕过 ADR-007 dark-axis 判定：2026-09-14 起 816 条 complete 事件对
  36 条 dark-axis 事件， 795 条来自 driver 的落地没有一条经过判定；按当前任务体回放，793 个 driver 落地任务中 782
  个会被判 MISSING
status: ready
labels:
  - gap
  - defect
  - meta
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**机制**：ADR-007 的 per-milestone 判定（HALF 2）唯一实现是 `classifyDarkAxisRecord`（`packages/quay/src/gate/dark-axis-record.ts:179`），强制点是 `enforceDarkAxis`（`packages/quay/src/gate/lifecycle.ts:276`），只被 `runComplete`（:329）、`runCompleteLoop`（:390）、`runCompleteOutOfBand`（:483）调用。生产上的主落地路径是机械 fan-in，它不走这些 lifecycle 动词：
- **翻 done 的确切位置**：`plugin/scripts/worker-fan-in.ts` 的 `flipTaskDone`（:1777，经 `task-ops.ts` 的 `patchStatusField(…, "done")` 直接改 frontmatter 并提交），由 `runMechanicalFanIn`（:2290）在 :3228 调用；它之前的唯一完成度闸是 `ac-gate` 步（:3225，`fan-in-ac-completion-gate.ts`，只数 AC/DoD 勾选）。`complete` GateEvent 由 :3274 的 `appendCompleteGateEvent`（:1906，actor `quay-driver`）补写。
- `plugin/scripts/worker-driver.ts` 本身不写 `status: done`，它 import 并调起 `runMechanicalFanIn`（:422/:512）。`grep -n "enforceDarkAxis\|classifyDarkAxisRecord\|dark-axis" plugin/scripts/worker-driver.ts plugin/scripts/worker-fan-in.ts plugin/scripts/driver-filters.ts plugin/scripts/fan-in-ac-completion-gate.ts` ⇒ 0 行。
- ADR-007 的 enforcement 注释已自承：「⚠️ NOT ENFORCED on the mechanical fan-in flip … closing it needs a change in the driver, which is a different task's scope」。本任务就是那个 task。

**读数**（2026-10-22，命令：逐行解析 `.quay/gate-events.jsonl`，`timestamp >= 2026-09-14`，按 gate/actor/verdict 计数）：
- `complete` 事件 816 条（之前粗读为 815）：`quay-driver` pass 795、`quay-cli` pass 20、`quay-fan-in-workflow` pass 1。
- `dark-axis` 事件 36 条（pass 23 / fail 13），约为 complete 的 4.4%；全部来自 CLI/MCP 的 lifecycle 路径。
- **回放**：对这 795 条 driver complete 事件涉及的 793 个不同任务，用同一个 `classifyDarkAxisRecord`（经 `plugin/scripts/dark-axis-record-check.ts` 导出的 `classifyDarkAxisRecord` + `taskBodyOf`）判定当前任务体 ⇒ **MISSING 782，DISCLAIMED 11，RECORDED 0**。即：若这条路径过去就 fail-closed，98.6% 的机械落地会被拒。

**由此得出的方案约束**：只在 flip 前加一道 fail-closed 判定，会让几乎所有落地变成 exited-not-landed（重试上限 3 ⇒ needs-human）。所以判定必须与「worker 被告知要写读数或声明」一同落地；worker 派发 prompt（`worker-driver.ts:2503` `buildWorkerPrompt` 与 :4214 `buildContinueWorkerPrompt`）目前对 dark-axis 只字未提。

**同族错误陈述（硬规则 5b）**：`plugin/scripts/capability-catalog-declarations.json` 中 `dark-axis-record-check.ts` 的「谁按」条目写着「Core 的 ready→done 落地路径每里程碑自动按」——对机械 fan-in 而言是假的，需一并更正。

## Plan

1. **判定只有一份**：在 `worker-fan-in.ts` 的 `runMechanicalFanIn` 中，`ac-gate` 之后、`flipTaskDone` 之前加一步 `dark-axis`，读 **worktree 中的任务体**，调用 `classifyDarkAxisRecord`（import 同一模块，⛔ 不在 plugin 侧另写一份正则）。是否启用沿用 `workspaceEnforcesDarkAxis(root)`（同一开关，不新增配置面）。
2. **三态 + 未评估**：RECORDED / DISCLAIMED ⇒ 继续 flip；MISSING ⇒ `failClean("dark-axis", …)`，任务 exited-not-landed、worktree 保留，原因写明缺什么；NOT-EVALUATED ⇒ 同样 fail-closed，但 reason 与 MISSING 可区分（硬规则 3b）。
3. **每次判定都留痕**：无论结果，经既有 gate-event-store 写一条 `dark-axis` GateEvent（actor `quay-driver`，与 `appendCompleteGateEvent` 同款动态 import），使「complete 对 dark-axis」的比值成为可直接读出的量。
4. **告诉 worker**：`buildWorkerPrompt` 与 `buildContinueWorkerPrompt` 各加一句：落地前须在任务体记录一条 L_D/L_G 读数（行首轴名 + 数值，例：`- L_G archguard: cycles=0`），或写显式的「该轴仍暗」声明（带理由，格式同 `dark-axis-record.ts` 头注释）；机械 fan-in 会拒绝两者皆无的任务。续做 prompt 在上一轮因 dark-axis 被拒时引用该 reason。
5. **更正目录条目**：修订 `capability-catalog-declarations.json` 中 `dark-axis-record-check.ts` 的「谁按」描述；ADR-007 enforcement 注释中「NOT ENFORCED on the mechanical fan-in flip」一段改为已强制并注明落点（经 `quay adr` / `adr_write`）。

## Acceptance Criteria

- [ ] AC1 夹具（改动前为红）：一个任务体 AC/DoD 全勾、但既无读数也无声明的夹具任务跑 `runMechanicalFanIn`（注入式测试缝），结果为未落地、失败步为 `dark-axis`、mergeTarget 上该任务 status 仍为 `ready`、载体中追加一条 verdict 为 fail 的 `dark-axis` 事件。同一测试在改动前的代码上运行时任务被翻为 `done`（贴出改动前后两次测试输出）。
- [ ] AC2 负对照：同一夹具任务体分别加入一行 RECORDED 形态的读数（行首轴名 + 数值，格式见 `dark-axis-record.ts` 头注释）或一行带理由的 DISCLAIMED 形态声明后，fan-in 正常翻 done，并写出 verdict 为 pass 的 `dark-axis` 事件；任务体不可读（夹具删去任务文件正文）时失败原因含 `NOT-EVALUATED`，与 MISSING 的 reason 不同（贴出三次输出）。
- [ ] AC3 判定同源（读生产载体）：对 2026-09-14 以来 `.quay/gate-events.jsonl` 中全部 `quay-driver` complete 事件涉及的任务（当前 793 个），新步骤导出的判定函数与 `node --experimental-strip-types plugin/scripts/dark-axis-record-check.ts <id>` 的退出码逐一一致（0 ⇔ RECORDED/DISCLAIMED，1 ⇔ MISSING，2 ⇔ NOT-EVALUATED），不一致数为 0；贴出三态计数与不一致数。
- [ ] AC4 worker 被告知：`buildWorkerPrompt("x", root)` 与 `buildContinueWorkerPrompt` 的输出都含「该轴仍暗」声明格式与 L_D/L_G 读数格式说明；删去该句的临时副本使对应测试变红（贴出测试名与输出）。
- [ ] AC5 目录条目不再说假话：`grep -n "每里程碑自动按" plugin/scripts/capability-catalog-declarations.json` 在 `dark-axis-record-check.ts` 条目内不再声称 lifecycle 动词是唯一落地路径，且新条目点名 `worker-fan-in.ts` 的 dark-axis 步（贴出该条目）。
- [ ] AC6 生产比值：本任务落地后首批 ≥5 次 `quay-driver` complete 事件，每一条都在其之前 10 分钟内有同一 `item_id` 的 `dark-axis` 事件（只计落地提交时刻之后的事件；贴出配对表）（待外部）

## Definition of Done

- [ ] AC1–AC5 全绿（AC6 标注为待外部，由读生产载体的人或例程核对）；`scripts/test.sh` 相关泳道与 `--for-task` scoped 静态检查通过，合并进 develop。
- [ ] 判定只有 `classifyDarkAxisRecord` 一份实现；plugin 侧没有新的 L_D/L_G 正则或关键词匹配。
- [ ] ADR-007 enforcement 注释已改为如实描述机械 fan-in 的强制点；未通过删除 `gates.adr` 中的 ADR-007 来规避判定。

## Touches

- tasks/gap-mechanical-fan-in-flip-bypasses-adr007-dark-axis-predicate.md
- plugin/scripts/worker-fan-in.ts
- plugin/scripts/worker-driver.ts
- plugin/scripts/capability-catalog-declarations.json
- adr/ADR-007-instrument-the-dark-axes-lg-ld-ls.md
- plugin/test/worker-fan-in.test.mjs
- plugin/test/fan-in-driver-mechanical-orchestration.test.mjs
- plugin/test/worker-driver.test.mjs
- plugin/test/dark-axis-record-check.test.mjs
