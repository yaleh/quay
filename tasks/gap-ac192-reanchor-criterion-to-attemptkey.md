---
id: gap-ac192-reanchor-criterion-to-attemptkey
title: AC-192 判据仍按 runId 分组而 per-cycle 键已改为 attemptKey ⇒ 判据测错字段恒红（exit 1）；重锚判据到
  attemptKey
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-192
---
## Proposal

AC-192 判据当前取假（2026-09-07 干跑 `node packages/quay/src/goal-store.ts gate AC-192` → `verdict: fail`，exit 1；`.quay/fan-in-retries.jsonl` 里 7 个 runId 横跨 >1 taskId）。但这是**测错字段**，不是保证被违反：判据按 `runId` 分组，而 `runId` 语义在 `gap-ff-retry-counter-runid-no-longer-per-dispatch`（done）之后已变为**驱动进程生命期**（`wk-prod-<epoch>`，driver-runtime.ts 每进程生成一次），per-cycle 计数键是新增的 `attemptKey`（`ff-merge.ts:421` `countKey = attemptKey ?? runId`，机械 fan-in 传 `mfi-<task>-<epoch>-<rand>`）。故「runId 跨多任务」是进程级语义的合法形态，判据的前提（runId=per-cycle）在激活后变了——判据自身成了 GOAL-007 要抓的那类「后来变假的判据」（硬规则 4b/4c：测的量穿过中间层后不再是原来那个量）。人已裁定【丁：不修，上移 goal 层】，AC-192 正是那条承载保证的 goal AC，但它现在测错字段等于没测到保证。本任务把判据重锚到真正的 per-cycle 键 `attemptKey`，不碰计数侧、不改 runId 生成侧、不建新机制。

## Plan

1. 读 `packages/quay/src/fan-in/ff-merge.ts:414-432` 与 `plugin/scripts/driver-runtime.ts` 确认：计数键 = `attemptKey ?? runId`、写键 = `attemptKey`、runId = 进程级 `wk-prod-<epoch>`。
2. 重锚判据（改 `goals/AC-192-ff-retry-counter-per-cycle.md` 的 `criterion` 字段），约束：
   - 正确字段：跨任务累计的检查对象由 `runId` 改为 `attemptKey`；`runId` 跨任务不再判违。
   - 时间窗（硬规则 4c/推论三）：只计带 `attemptKey` 的记录（修复前 251 条仅 runId 自动排除），⛔ 不写死绝对时间戳。
   - 不静默通过（硬规则 3b）：载体有记录但无一条带 `attemptKey` ⇒ 判 exit 非零或 not-evaluated，⛔ 不与 pass 同形。
   - 可证伪（硬规则 4）：`attemptKey` 含 task id ⇒ 「attemptKey 横跨 >1 task」结构上几乎恒真，须有取假缝——注入「两个 taskId 共享同一 attemptKey」fixture 必须 exit 1。
3. 用 `node packages/quay/src/goal-store.ts write AC-192 --title … --status active --goal GOAL-007 --criterion … --expect "exit 0" --origin …` 重写（origin 更新为点名本缺陷：判据前提 runId=per-cycle 已变，per-cycle 键现为 attemptKey）。
4. 双向负控制实跑贴输出：改动前 `gate AC-192` fail（exit 1）已记录；改动后 `gate AC-192` pass（exit 0，读真实载体）；注入共享 attemptKey fixture → exit 1。
5. `node packages/quay/bin/quay.ts task check gap-ac192-reanchor-criterion-to-attemptkey --json` 的 `missing` 为 `[]`。

## AC

- [x] `node packages/quay/src/goal-store.ts gate AC-192` 在生产工作树 exit 0（读真实 `.quay/fan-in-retries.jsonl`，⛔ 非 fixture）
- [x] 双向负控制：改动前 `gate AC-192` → fail（exit 1）已记录；注入「两个 taskId 共享同一 attemptKey」fixture 跑同一判据 → exit 1
- [x] 正确字段：判据分组键为 `attemptKey`；`runId` 跨任务不再判违（一条读载体的命令可核，非转述）
- [x] 不静默通过：载体有记录但无一条带 `attemptKey` ⇒ 判据 exit 非零或 not-evaluated，⛔ 不读成 pass（硬规则 3b）
- [x] 时间窗不写死绝对时间戳：只计带 `attemptKey` 的记录，修复前仅 runId 的 251 条自动排除
- [x] `node packages/quay/bin/quay.ts task check gap-ac192-reanchor-criterion-to-attemptkey --json` 的 `missing` 为 `[]`

## DoD

`goals/AC-192-ff-retry-counter-per-cycle.md` 的 `criterion` 重锚到 `attemptKey`，`node packages/quay/src/goal-store.ts gate AC-192` 在生产工作树上 exit 0（读真实载体）——不是靠 fixture 注入当正判断据；注入共享 attemptKey 的 fixture 后同一判据 exit 1（能取假，双向负控制实跑贴输出）。仅改字符串而 gate 仍 fail、或判据只在 fixture 下 pass 而生产读不出 pass ⇒ 不算完成。

## Touches

- goals/AC-192-ff-retry-counter-per-cycle.md（criterion 重锚）
- tasks/gap-ac192-reanchor-criterion-to-attemptkey.md（自身）