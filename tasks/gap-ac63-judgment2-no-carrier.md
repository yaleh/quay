---
id: gap-ac63-judgment2-no-carrier
title: AC63 判据2 无载体——lock-events 无 doc 检查字段，结构上无法判「有 ff 而无 doc 检查」（manager 11:1xZ 报）
status: ready
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
- plugin/scripts/per-task-suite-record-check.ts（判据2 更新：doc-check 痕迹形状校验（present 时）+ AC63 判据2 `checkDocChecked`（has-ff-but-no-doc-check，能取假，taskId 为 join key）+ `REAL_FF_NO_DOC_CHECK` 真实样本 + `--lock-events`/`--replay-real-samples` + **AC72 判据3 条件式** `checkEmptyCarrierAgainstBoundary`（空载体 ≠ 合格：空载体 + enforcement boundary 后发生过 per-task suite ⇒ RED；没跑过 ⇒ NOT-EVALUATED，`ENFORCEMENT_BASELINE_EPOCH`/`--enforcement-baseline-ts` + `resolveBoundaryEpoch`/`--boundary-ts`））
- plugin/test/per-task-suite-record-check.test.mjs（补测 23 条：AC63 判据1/判据2 + AC72 判据3 条件式 + writer fail-closed + CLI replay/boundary）
- tasks/gap-ac63-judgment2-no-carrier.md（自身）

## Test-Files

- plugin/test/per-task-suite-record-check.test.mjs（AC63 判据1/判据2 + AC72 判据3 条件式负控制 + writer doc-check 痕迹 fail-closed + CLI `--replay-real-samples`/`--lock-events`/`--enforcement-baseline-ts` replay；43 条全绿）

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
现状（per-task-suite-records.jsonl 不存在、任何记录都无 doc-check 痕迹）即为「有 ff 而无 doc 检查」的**真样本**——在载体落地前该判据结构上恒无法取假（硬规则 4）。**默认每轮 run_static_checks 调用当前 NOT-EVALUATED**——但不是「没查」：AC72 判据3 条件式（见下）已接进默认路径，当前无红是因为所有现存 ff 都在 enforcement baseline（`ENFORCEMENT_BASELINE_EPOCH=1786710672`，2026-08-14T12:31:12Z，即本条件式落地时刻）**之前**（`没跑过 suite [after boundary]` ⇒ NOT-EVALUATED，不误红）：
```
$ node --no-warnings --experimental-strip-types plugin/scripts/per-task-suite-record-check.ts --root <repo>
per-task-suite-record-check: OK — nothing-to-judge (NOT-EVALUATED)
  [record-shape] ok (NOT-EVALUATED) — record-file-absent (NOT-EVALUATED)
  [empty-carrier-boundary] ok (NOT-EVALUATED) — no-per-task-suite-after-enforcement-boundary (NOT-EVALUATED)
exit=0
```

**AC72 判据3 条件式（resume：fold-into-ac63-retry——空载体 ≠ 合格，硬规则 4）**：`plugin/scripts/per-task-suite-record-check.ts` 新增纯函数 `checkEmptyCarrierAgainstBoundary(ffsAfterBoundary, records)`，把空载体分成可区分的两态：**查过且空（应红）**——空载体 且 enforcement boundary 后发生过 per-task 全量 suite（fan-in lock-events acquire 事件，每个 ff 隐含无锁段全量 suite）⇒ exit 1，正是 AC72 判据3「7 轮 cert 回放必须红」满足（真实缺席样本找到零记录）；**没查成（NOT-EVALUATED）**——没跑过 suite（不误红）。enforcement boundary = `ENFORCEMENT_BASELINE_EPOCH`（可 `--enforcement-baseline-ts` 覆盖）；mechanism-landed boundary（`resolveBoundaryEpoch`，git 解析加了 writer 的 AC72 commit）作上下文报告。默认路径读共享检出 `.quay/fan-in-merge-lock-events.jsonl`（每轮 run_static_checks 即此路径）。实测：
```
# 查过且空 ⇒ RED（空载体 + past baseline 后的 ff）
$ node … per-task-suite-record-check.ts --record-file /tmp/empty.jsonl \
    --lock-events /tmp/lock.jsonl --enforcement-baseline-ts 2026-08-14T09:00:00Z
per-task-suite-record-check: FAIL — per-task-suite-record-violation
  [record-shape] ok (NOT-EVALUATED) — no-records (NOT-EVALUATED)
  [empty-carrier-boundary] RED — empty-carrier-with-fan-in-after-enforcement-boundary (1 per-task suite(s)
    ran after the enforcement boundary; the record carrier is empty — AC72 判据3 real-absence is RED)
exit=1
# 没跑过 ⇒ NOT-EVALUATED（future baseline）
$ node … --record-file /tmp/empty.jsonl --lock-events /tmp/lock.jsonl \
    --enforcement-baseline-ts 2026-08-14T20:00:00Z
  [empty-carrier-boundary] ok (NOT-EVALUATED) — no-per-task-suite-after-enforcement-boundary (NOT-EVALUATED)
# 非空载体 ⇒ 条件式惰性（判据2 形状检查管）
  [empty-carrier-boundary] ok — carrier-not-empty (record shape checks judge)
```

**判据3（与 AC72 合并）**：doc 检查痕迹并入 AC72 的 per-task-suite-record（`docChecked`/`docCheckExit` 字段），**不另起记录文件**；检查逻辑并入 `per-task-suite-record-check.ts`，测试并入 `per-task-suite-record-check.test.mjs`。lock-events 协议本体（`fan-in-ff-merge.sh` / `fan-in-ff-protocol-check.ts`）未动——本任务不覆盖「不改 fan-in 协议本体」。

**AC4（scoped 门 + ts-typecheck + 既有测试）**：
```
$ bash scripts/test.sh --for-task gap-ac63-judgment2-no-carrier --allow-thin
→ EXIT=0；43 tests / 43 pass / 0 fail
  （per-task-suite-record-check.test.mjs 43 条——AC63 判据1/判据2 + AC72 判据3 条件式全绿；
    scoped 静态检查全 PASS，含每轮 per-task-suite-record-check 默认 NOT-EVALUATED）
$ node --experimental-strip-types plugin/scripts/fan-in-ts-typecheck-gate.ts --task gap-ac63-judgment2-no-carrier --worktree $(pwd) --merge-target develop
fan-in-ts-typecheck-gate: no new/moved .ts in the declared write surface — no typecheck gate needed
fan-in-ts-typecheck-gate: ADMITTED (exit 0)
```
（本任务修改的是**既有** .ts——AC72 已落的 `per-task-suite-record.ts`/`per-task-suite-record-check.ts`，非新增/移动，故 ts-typecheck 闸不触发；改动已被 43 条测试运行时覆盖。checker-mutation-check --run RESULT: PASS——per-task-suite-record mutation case 不受影响。）

**接线说明（不在本任务范围）**：AC72 的 C17「A6 无锁段加一步调 `per-task-suite-record.ts`」仍是建议、未接线（主检出无 `.quay/per-task-suite-records.jsonl`）；fan-in 流程真正写 doc 检查痕迹（`--doc-checked` 参数）属于该接线落地后的后续。本任务交付载体 + 判据 + 负控制，使该判据**结构性可判**。**⚠️ enforcement 生效后果**：`ENFORCEMENT_BASELINE_EPOCH`（本条件式落地时刻）之后，任一 fan-in 在空载体下发生 ⇒ 每轮 checker 红 ⇒ 会挡后续 full suite，直到 C17 接线（写记录）或 `--enforcement-baseline-ts` 调界——这是「空载体 ≠ 合格」的强制力，outer 裁定 fold-into-ac63-retry 的一部分。**落地 commit**：见 git（worktree 内，未 merge；status 保持 ready）。
