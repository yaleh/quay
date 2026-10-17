---
id: gap-architecture-review-not-triggered-lacks-per-detector-state
title: architecture-review 的 not-triggered 缺 per-detector 状态——「无候选宇宙」与「三检测器都评估且干净」同形
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`plugin/scripts/quality-gate-driver.ts:941` 把 not-triggered 原因写死为「no candidate clusters (three detectors produced zero suspicious groupings)」。在非 quay 树上检测器可能没有候选宇宙（space instrument 同款问题），此时 `not-triggered` 与「三个检测器都评估过且都干净」同形。实测 ClaudeCodeUI 的 architecture-review 83/83 轮全零即被读成「干净」——实则检测器无候选宇宙。

## Plan

1. `computeArchReviewTrigger` 返回 `detectors: [{ id, evaluated: boolean, reason, clusters }]`（每个检测器自报是否评估过、有无候选宇宙）。
2. 新增 `not-evaluated` 状态；`not-triggered` 仅在三个检测器全部 `evaluated:true` 且 `clusters=[]` 时成立。
3. 把 per-detector 状态写进 `architecture-review-round.jsonl` 每条记录。

## Acceptance Criteria

- [x] AC1（能取假·状态可分）任一 detector `evaluated:false` 时 round state 为 `not-evaluated` 且记录带该 detector 的 reason；仍写 `not-triggered` 即假。
- [x] AC2（干净的真条件）`not-triggered` 仅在 `detectors.every(d => d.evaluated && d.clusters.length===0)` 时成立——一条命令可从 round jsonl 验证该蕴含。
- [x] AC3（载体可读）`architecture-review-round.jsonl` 每条含 `detectors` 数组，其成员带 id/evaluated/reason/clusters。

## Definition of Done

round 状态三态化（judged / not-triggered / not-evaluated），per-detector evaluated+reason 入载体；AC1–AC3 勾。

## Touches

- plugin/scripts/architecture-review-cluster.ts（computeArchReviewTrigger + round 记录类型）
- plugin/scripts/quality-gate-driver.ts（:941 处 not-triggered 判定改用 detectors）
- plugin/test/architecture-review-cluster.test.mjs（四态纯函数 + 载体写端：AC1/AC2/AC3 的直接单测）
- plugin/test/quality-gate-driver.test.mjs（driver 边界：fixtures 补 rootSurface；AC1 的 not-evaluated 与负控制翻转）
- tasks/gap-architecture-review-not-triggered-lacks-per-detector-state.md

## Evidence

- 单元测试：`node --experimental-strip-types --test plugin/test/architecture-review-cluster.test.mjs` ⇒ 29 pass / 0 fail（新增：四态可分、AC1 任一 evaluated:false ⇒ not-evaluated、AC2 差分翻转、AC3 缺 detectors 拒写、AC2 从写出的 jsonl 回读蕴含）。
- driver 测试：`node --experimental-strip-types --test plugin/test/quality-gate-driver.test.mjs` ⇒ 59 pass / 0 fail（新增 AC1 driver 边界：无 rootSurface ⇒ not-evaluated + 记录带 reason；补 full ⇒ 翻成 not-triggered）。
- 真实检测器 · 非 quay 根（mktemp，仅 `src/index.ts`）：identity `rootSurface.kind="absent"`、guard-lineage `kind="absent"`；`runArchitectureReview` ⇒ `state=not-evaluated`，载体记录逐检测器带 reason（P2/P4 absent note + P1 上游未评估），不再写 `not-triggered`。
- AC2 一条命令（在写出的 `.quay/architecture-review-round.jsonl` 上）：`jq -e 'select(.state=="not-triggered") | [.detectors[] | (.evaluated and ((.clusters|length)==0))] | all'` ⇒ `true`（exit 0）；同一载体里的 `not-evaluated` 记录是负控制（`evaluated:false` 与 not-triggered 可区分）。
- AC3 载体形态：两条记录分别为 `{"state":"not-triggered","detectors":[{id,evaluated,reason,clusters},…]}` 与 `{"state":"not-evaluated","detectors":[…evaluated:false + reason…]}`；`appendArchReviewRound` 对缺 `detectors` 的记录拒写。
- 真实检测器 · 本 quay worktree：identity/guard-lineage `rootSurface.kind="full"`，P1 无候选构件但上游已评估 ⇒ `evaluated:true`（reason 点明 measured-empty candidate universe），触发态 `triggered`（有 1 个 P2 簇）。

## Blocker

**2026-10-17T05:19:29.125Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: AssertionError [ERR_ASSERTION]: the on/off wall-clock delta is within the 1% budget (measured 2.16%) [baseline A/B: HARD RED (changed-assertion) — the task's red set is NOT a subset of the develop baseline red set: added=- changed=plugin/test/full-suite-runner-cgroup.test.mjs]
- run_id：wk-prod-anchor
- session_id：637b8f97-73fd-48ae-9d6e-f61333c1a03d
