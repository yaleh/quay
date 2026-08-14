---
id: gap-ac63-judgment2-no-carrier
title: AC63 判据2 无载体——lock-events 无 doc 检查字段，结构上无法判「有 ff 而无 doc 检查」（manager 11:1xZ 报）
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**（AC63 判据2 无载体——manager 11:1xZ 实测）**。

**现状**：`.quay/fan-in-merge-lock-events.jsonl` 的 keys 打印为：
```
[agentId, epoch, event, pid, runId, taskId, ts]
```
**无任何 doc 检查字段** ⇒ 判据2「有 ff 而无 doc 检查」（fan-in 走了 ff-only 但没跑 `--static-checks-doc`）**结构上无法判**——记录里没有这个信息，判据恒无法取假（硬规则 4：结构上不可能取假的量不是测量）。

**判据1**：判据2 的载体落地——per-task 记录里带上 doc 检查的痕迹（如 `docChecked` 字段或 doc 检查的 runId/退出码），使「有 ff 而无 doc 检查」可判。**⚠️ 与 AC72 的 per-task-suite-record 的关系**：AC72 已落 per-task suite 记录（第三方可读）；doc 检查痕迹可并入该记录（不另起文件）或补 lock-events 字段。
**判据2（能取假）**：构造/回放一条「有 ff 而无 doc 检查」的真实记录 ⇒ 判据必须红；现状（无字段）⇒ 判据结构上无法评估（NOT-EVALUATED 或恒绿）即为真样本。
**判据3**：与 AC72（per-task suite 记录）合并或互相 depends_on——不重复造记录文件。

**不覆盖**：不改 fan-in 协议本体；不规定 doc 检查的格式（实现面）。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 AC72 的 per-task-suite-record（现有记录形态）+ AC63 判据2 原文。
2. 判据1：doc 检查痕迹载体落地（并入 per-task-suite-record 或 lock-events 补字段）。
3. 判据2 能取假：「有 ff 而无 doc 检查」回放红；现状无字段回放为结构上不可判（真样本）。
4. 判据3：与 AC72 合并/互 depends_on，不重复造文件。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1 判据1：doc 检查痕迹载体落地（可判「有 ff 而无 doc 检查」）。
- [x] AC2 判据2 能取假：「有 ff 而无 doc 检查」回放红；现状无字段为真样本（结构上不可判）。
- [x] AC3 判据3：与 AC72 per-task-suite-record 合并或互 depends_on。
- [x] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] AC63 判据2 载体落地：doc 检查痕迹（如 docChecked 字段或并入 per-task-suite-record）使「有 ff 而无 doc 检查」结构上可判
- [x] 能取假：「有 ff 而无 doc 检查」的真实记录回放红；现状无字段（结构上不可判）为真样本
- [x] 与 AC72 per-task-suite-record 合并或互相 depends_on，不重复造记录文件

## Touches

- plugin/scripts/per-task-suite-record.ts（doc 检查痕迹载体——与 AC72 合并，不另起文件：可选字段 `docChecked`/`docCheckExit`、flag `--doc-checked`/`--doc-check-exit`、present 时 fail-closed 校验）
- plugin/scripts/per-task-suite-record-check.ts（判据2 更新：doc-check 痕迹形状校验（present 时）+ AC63 判据2 `checkDocChecked`（has-ff-but-no-doc-check，能取假，taskId 为 join key）+ `REAL_FF_NO_DOC_CHECK` 真实样本 + `--lock-events`/`--replay-real-samples`）
- plugin/test/per-task-suite-record-check.test.mjs（补测 15 条：AC63 判据1/判据2 + writer fail-closed + CLI replay）
- tasks/gap-ac63-judgment2-no-carrier.md（自身）

## Test-Files

- plugin/test/per-task-suite-record-check.test.mjs（AC63 判据1/判据2 负控制 + writer doc-check 痕迹 fail-closed + CLI `--replay-real-samples`/`--lock-events` replay；连同既有 fan-in-ff-merge.test.mjs 由 scoped 门选中）

## Evidence

**判据1（载体落地，与 AC72 合并不另起文件）**：`plugin/scripts/per-task-suite-record.ts` 记录新增**可选** doc-check 痕迹字段 `docChecked`（boolean）/`docCheckExit`（integer 0..255）——可选而非必填，因为 pre-AC63 记录【本来就无】该字段，而那个无字段正是判据2 要抓的「有 ff 而无 doc 检查」真样本。flag `--doc-checked true|false` + `--doc-check-exit <0..255>`；`--doc-check-exit` 必须搭配 `--doc-checked`（无 "did it run" flag 的退出码是歧义痕迹，fail-closed 不写——硬规则 3b）。实测：
```
$ node --experimental-strip-types plugin/scripts/per-task-suite-record.ts --task-id gap-x --run-id fm-x-4 \
    --state green --lane-count 4 --duration-ms 1000 --started-at 2026-08-14T00:00:00.000Z \
    --finished-at 2026-08-14T00:01:00.000Z --doc-checked false --record-file /tmp/r4.jsonl
per-task-suite-record: appended gap-x run fm-x-4 (green) → /tmp/r4.jsonl
{"ts":"…","taskId":"gap-x","runId":"fm-x-4","state":"green","laneCount":4,"durationMs":1000,
 "failedFiles":[],"startedAt":"…","finishedAt":"…","docChecked":false}
$ node … --doc-checked yes …            # 非布尔 ⇒ exit 2，不写
$ node … --doc-check-exit 0 …           # 无 --doc-checked ⇒ exit 2，不写
```

**判据2（能取假）**：`plugin/scripts/per-task-suite-record-check.ts` 新增纯函数 `checkDocChecked(ffs, records)`——给定真实 ff 集（lock-events 的 acquire 事件）与记录集，每个 ff 过的 task 必须 ≥1 条 `docChecked===true` 的记录，否则红。**join key 是 taskId 而非 runId**：lock-event 的 runId（`fm-…`）是 fan-in 操作 id、per-task-suite-record 的 runId（full-suite-state 的 suite runId）是套件运行 id，两个 namespace 不对应。`REAL_FF_NO_DOC_CHECK` 内嵌 11 条**真实** lock-event ff（从主检出 `.quay/fan-in-merge-lock-events.jsonl` 逐字捕获；该文件存在、11 个唯一 acquire 对），全部无 doc-check 痕迹 ⇒ 回放红：
```
$ node --experimental-strip-types plugin/scripts/per-task-suite-record-check.ts --record-file /tmp/empty.jsonl --replay-real-samples
per-task-suite-record-check: FAIL — per-task-suite-record-violation
  [record-shape] ok (NOT-EVALUATED) — record-file-absent (NOT-EVALUATED)
  [expected-suite-runs] RED — missing-record (7/7 expected per-task suite run(s) not recorded)
  [ff-no-doc-check] RED — has-ff-but-no-doc-check (11/11 ff'd task(s) have no doc-check trace)
  missing=fm-gap-ac67-…,fm-gap-ac72-…,fm-gap-ac73-…,fm-gap-ac66-…,fm-gap-ac78-…,fm-gap-ac76-…,
          fm-gap-idle-watch-…,fm-gap-touches-…,fm-DIR-127-…,fm-DIR-128-…,fm-gap-fan-in-execute-…
exit=1
$ node … --lock-events /home/yale/work/quay/.quay/fan-in-merge-lock-events.jsonl   # 同一真值：RED 11/11
```
现状（per-task-suite-records.jsonl 不存在、任何记录都无 doc-check 痕迹）即为「有 ff 而无 doc 检查」的**真样本**——在载体落地前该判据结构上恒无法取假（硬规则 4）。**默认每轮 run_static_checks 调用仍 NOT-EVALUATED**（不关联历史——与 AC72 判据3 同款：永久红的默认是噪音不是测量）：
```
$ node --no-warnings --experimental-strip-types plugin/scripts/per-task-suite-record-check.ts --root <repo>
per-task-suite-record-check: OK — nothing-to-judge (NOT-EVALUATED)
  [record-shape] ok (NOT-EVALUATED) — record-file-absent (NOT-EVALUATED)
exit=0
```

**判据3（与 AC72 合并）**：doc 检查痕迹并入 AC72 的 per-task-suite-record（`docChecked`/`docCheckExit` 字段），**不另起记录文件**；检查逻辑并入 `per-task-suite-record-check.ts`，测试并入 `per-task-suite-record-check.test.mjs`。lock-events 协议本体（`fan-in-ff-merge.sh` / `fan-in-ff-protocol-check.ts`）未动——本任务不覆盖「不改 fan-in 协议本体」。

**AC4（scoped 门 + ts-typecheck + 既有测试）**：
```
$ bash scripts/test.sh --for-task gap-ac63-judgment2-no-carrier --allow-thin
→ EXIT=0；47 tests / 47 pass / 0 fail
  （含 per-task-suite-record-check.test.mjs 35 条——新增 AC63 判据1/判据2 15 条全绿 +
    fan-in-ff-merge.test.mjs 回归绿；scoped 静态检查全 PASS）
$ node --experimental-strip-types plugin/scripts/fan-in-ts-typecheck-gate.ts --task gap-ac63-judgment2-no-carrier --worktree $(pwd) --merge-target develop
fan-in-ts-typecheck-gate: no new/moved .ts in the declared write surface — no typecheck gate needed
fan-in-ts-typecheck-gate: ADMITTED (exit 0)
```
（本任务修改的是**既有** .ts——AC72 已落的 `per-task-suite-record.ts`/`per-task-suite-record-check.ts`，非新增/移动，故 ts-typecheck 闸不触发；改动已被 35 条测试运行时覆盖。）

**接线说明（不在本任务范围）**：AC72 的 C17「A6 无锁段加一步调 `per-task-suite-record.ts`」仍是建议、未接线（主检出无 `.quay/per-task-suite-records.jsonl`）；fan-in 流程真正写 doc 检查痕迹（`--doc-checked` 参数）属于该接线落地后的后续。本任务交付载体 + 判据 + 负控制，使该判据**结构性可判**。**落地 commit**：见 git（worktree 内，未 merge；status 保持 ready）。
