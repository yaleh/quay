---
id: gap-goal-achieved-failing-folds-not-evaluated-into-red
title: quay goal check --achieved-failing 把 not-evaluated
  折成红：verdictFromAcceptance 只 import 不调用，exit 3/timeout 落 achievedButFailing，会在
  goal standings 立 phantom gap
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**atom H10**：判据读最新 run 派生字段、派生未算完 ⇒ underivable（NOT-EVALUATED 与红同形），不是假绿。

**carrier**：`code`（只承载了三态映射，消费侧丢弃）。

**carrierRef 目标**：`packages/quay/src/core/goal-store-checks.ts:211-213`。

**负臂读数（现在）**：`packages/quay/src/core/goal-store-checks.ts:15` 只 `import { runAcceptance, verdictFromAcceptance }` 而从不调用；`:212` 是 `if (!res.ok) achievedButFailing.push(String(ac.id))`。而 `verdictFromAcceptance`（`packages/quay/src/core/acceptance-runner.ts:121-140`）已经能区分 `pass / fail / not-evaluated(cause ∈ timeout|spawn|not-runnable|declared)`。⇒ exit 3（declared）、timeout、spawn 全被计成「已达成的判据红了」。

**危害**：`plugin/scripts/goal-driver.ts:427-434` 解析该 JSON，`:2294` 用 `achievedButFailing` 建 `standingFailing` 集合——也就是说这个折叠会在 goal standings 里**立 phantom gap**，是生产可见的错误事实，不只是读起来难看。

**同构先例（支持独立桶，不是新发明）**：同一函数已有第三桶 `capabilityRefused`，注释明写「"we would not run it" 是不同于 "we ran it and it is red" 的事实」。

**D 收缩预期**：H10 fresh→stale，|D| 14→13（⛔ 不作验收）。

## Plan

1. 改 `checkAchievedFailing`（`goal-store-checks.ts:150-220`）：每个 AC 的 `runAcceptance` 结果改用 `verdictFromAcceptance(res)` 三态分派——`fail` ⇒ `achievedButFailing`；`not-evaluated` ⇒ 新桶 `achievedNotEvaluated.push({ id, cause, reason })`；`pass` ⇒ 都不进。
2. 返回类型加 `achievedNotEvaluated: Array<{ id: string; cause: string; reason: string }>`，**与 `capabilityRefused` 同构**（含 `evaluated/scopeSize/inScope` 不变）。
3. 退出码（`packages/quay/src/core/goal-store.ts:2095`，现状 `return r.achievedButFailing.length === 0 && r.evaluated ? 0 : 1;`）**显式三态**：`achievedButFailing` 非空 ⇒ 1；**仅** `achievedNotEvaluated` 非空 ⇒ **不得为 0**（实现前先枚举已占用退出码——已知 0/1/3 被用——选一个未占用的并写进 `quay goal check --help`）；两者皆空且 `evaluated` ⇒ 0；`!evaluated` ⇒ 保持非 0。
4. gap 消费者排除：`plugin/scripts/goal-driver.ts:427-434` 的解析与 `:2294` 的 `standingFailing` 必须显式不受 `achievedNotEvaluated` 影响；若需要可见性，单独带出该桶，⛔ 不得并入 failing。

## Acceptance Criteria

- [x] AC1: `verdictFromAcceptance` 被**真正调用**且三态生效——行为测试：criterion exit 3 ⇒ `achievedNotEvaluated(cause="declared")`；exit 1 ⇒ `achievedButFailing`；timeout ⇒ `achievedNotEvaluated(cause="timeout")`。负臂读数：改前 `grep -n verdictFromAcceptance packages/quay/src/core/goal-store-checks.ts` 只有 import 行命中（给出逐字输出）。
  - 改前负臂（逐字，仅 import 行，无调用点）:
    ```
    $ grep -n verdictFromAcceptance packages/quay/src/core/goal-store-checks.ts
    15:import { runAcceptance, verdictFromAcceptance } from "./acceptance-runner.ts";
    ```
  - 改后同一条命令（第 229 行是真调用点；132/192 是注释）:
    ```
    15:import { runAcceptance, verdictFromAcceptance } from "./acceptance-runner.ts";
    132:  // (a real non-zero verdict, i.e. `verdictFromAcceptance` said `fail`) ⇒ "achieved but no longer
    192:    // `verdictFromAcceptance` — and this path was the one consumer importing it without calling it.
    229:        const verdict = verdictFromAcceptance(res);
    ```
  - 三条行为读数（真 CLI，`env -u QUAY_GOAL_ACCEPTANCE_ACTIVE` 因为宿主设了重入闸变量）:
    ```
    RED   (criterion "echo 'CAUSE=red' >&2; exit 1")   exit=1 achievedButFailing=["AC-001"] achievedNotEvaluated=[]
    NE    (criterion "echo 'CAUSE=not-measurable' >&2; exit 3") exit=4 achievedButFailing=[] achievedNotEvaluated=["AC-001:declared"]
    TIMEOUT (criterion "sleep 2", QUAY_ACCEPTANCE_TIMEOUT_MS=1000) exit=4
      "achievedButFailing": [],
      "achievedNotEvaluated": [{"id":"AC-001","cause":"timeout","reason":"not-evaluated (timeout): acceptance timed out after 1000ms (killed) — raise QUAY_ACCEPTANCE_TIMEOUT_MS"}]
    ```
  - 可复跑测试（2 passed）: `node --experimental-strip-types --test --test-name-pattern="H10" packages/quay/test/goal-store.test.mjs`

- [x] AC2: `quay goal check --achieved-failing` 退出码**显式三态**并写进 `--help`——仅 `achievedNotEvaluated` 非空时退出码**不得为 0**；给出三条实测读数（红 / 仅未评估 / 全绿）。
  - 已占用退出码枚举（改前该子命令区域 `grep -n "return [0-9]" packages/quay/src/core/goal-store.ts`）: `0 / 1 / 2(usage) / 3(--stale-pass 的 NOT-EVALUATED)` ⇒ 选未占用的 **4**。
  - 三条实测读数（逐字）:
    ```
    GREEN exit=0 achievedButFailing=[] achievedNotEvaluated=[]
    RED   exit=1 achievedButFailing=["AC-001"] achievedNotEvaluated=[]
    NE    exit=4 achievedButFailing=[] achievedNotEvaluated=["AC-001:declared"]
    ```
  - `--help` 逐字（`node --experimental-strip-types packages/quay/bin/quay.ts goal --help`）:
    ```
    --achieved-failing  achieved ACs whose criterion is currently FAILING (I5);
                        exit 0 = every in-scope criterion PASSED,
                        1 = at least one FAILING (or nothing evaluated),
                        4 = none failing, but at least one NOT-EVALUATED
                        (timeout / spawn / not-runnable / declared exit 3)
    ```
  - 可复跑测试（含空作用域既有非 0 的回归臂）: `node --experimental-strip-types --test --test-name-pattern="H10 AC2" packages/quay/test/goal-store.test.mjs`

- [x] AC3: gap 消费者排除——列出 `goal-driver.ts` 的解析点与 `standingFailing` 点；负臂：构造仅 not-evaluated 的输入，确认**不立 gap**（给出命令与读数）。
  - 解析点：`plugin/scripts/goal-driver.ts` 的 `checkAchievedFailing()`——`achievedNotEvaluated` 作为**独立字段**逐条 `{id, cause, reason}` 带出；`achievedButFailing` 的取值路径逐字未变（⛔ 两桶不交叉）。
  - 立 gap 点：`computeGoalGaps()` 里 `const standingFailing = standings === null ? null : new Set(standings.achievedButFailing);`（只读 failing 桶）；新增 **独立集合** `standingNotEvaluated`，命中 ⇒ `state: "not-evaluated", taskCount: null`，且 `isFilingGapState("not-evaluated") === false`（⛔ 不 spawn）。它排在 `!standingFailing.has(id)` 之前——否则「测不了」会掉进 `standing-ok`（镜像假绿）。
  - 负臂读数（逐字，真跑 `computeGoalGaps`）:
    ```
    not-evaluated-only: {"goal":"GOAL-001","ac":"AC-001","state":"not-evaluated","taskCount":null} isFilingGapState=false
    failing-control:    {"goal":"GOAL-001","ac":"AC-001","state":"standing-violated","taskCount":0} isFilingGapState=true
    ```
    （第二行是**正控**：同一 fixture 换成真红照旧立案 ⇒ 负臂不是「一律不立」的恒真。）
  - 可复跑测试（1 passed）: `node --experimental-strip-types --test plugin/test/goal-driver-s03.test.mjs`（用例名 `H10 AC3`）

## Definition of Done

- 三条 AC 勾选，每条附可复跑命令与逐字读数（⛔ 不是「文件存在」或「测试绿了」）。
- `scripts/test.sh --for-task gap-goal-achieved-failing-folds-not-evaluated-into-red` 绿；全量 suite 不回归。
- JSON 输出**三桶同时出现**；`--help` 写明退出码含义。
- ⛔ 完成证据中不得出现「|D| 下降」或类似计数下降。

## Dark-axis record

- L_D archguard: cycles=0, maxScc=1, bridges=0 (package scope 8b51e3aa, fresh @ 994d70e640f3)
- L_G archguard: entities=6168, relations=15084 (typescript scope 8b51e3aa)

## Touches

- packages/quay/src/core/goal-store-checks.ts
- packages/quay/src/core/goal-store.ts
- packages/quay/src/cli/help.ts
- packages/quay/test/goal-store.test.mjs
- plugin/scripts/goal-driver.ts
- plugin/test/goal-driver-s03.test.mjs
- tasks/gap-goal-achieved-failing-folds-not-evaluated-into-red.md
