---
id: gap-ac106-dist-verify-node-floor-ran
title: AC106 dist-verify-node-floor 在当前流程上真实运行过（job success 新于 2026-08-20，非配置看起来对）
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**来源**：当前阶段管线第 4 步。AC104（版本 bump）→ AC105（build tgz）→ AC106（dist-verify 真实运行）→ AC107（跨主机机制化验证）→ AC108（推送发布）→ AC109（记录）→ AC118/119（第三方验证）。AC104/AC105 已 land。人裁定「AC104-109 落笔归属 outer（立案/驱动）+ inner（产品代码）」。

**判据正本**：`orchestration/manager-phase-goal.md` AC106（:51-57）。

**⚠️ 判据或已满足（外层 2026-08-20 19:1xZ 核实）**：`gh run list --workflow=ci.yml --branch=develop` 显示 run 32375298855（2026-08-20 13:37Z，本次阶段切换后）中 `dist-verify-node-floor` job **conclusion=success**（run 整体因 `test` job 失败标红，但 AC106 判据逐字只要求 dist-verify-node-floor job success）。`version-consistency` job 也 success。**inner 需核实**：该 success 是否在 develop 分支、时刻是否新于切换、是否结构性真实（非 fixture/配置）。

**⛔ 判据精神**：AC86 原文「配置看起来对了 ≠ 真实运行过」——AC106 要求的是 dist-verify-node-floor **job** conclusion=success（不是「ci.yml 里有这个 job」）。

**为什么 inner 执行**：判据用 `gh run list` 查 GitHub（CI 产物），读 CI 记录属 inner 域执行。

## Plan

1. `gh run list --workflow=ci.yml --branch=develop --limit 20` 核实 dist-verify-node-floor job success 的存在 + 时刻新于 2026-08-20。
2. 若 success 确凿：把 run id / job id / 时刻 / commit 记入 `.quay/productization-verification.jsonl`（`ac="AC106"`）。
3. 若实测发现仍未真跑过（如 job 被 skip / 只存在于配置）——按缺陷处置，如实报外层立案，⛔ 不手工触发一次充数。

## Acceptance Criteria

- [ ] AC1: `gh run list --workflow=ci.yml --branch=develop` 核实 dist-verify-node-floor job conclusion=success 且时刻新于 2026-08-20（能取假：不存在或旧于切换 ⇒ 未达成）。
- [ ] AC2: 达成证据写入 `.quay/productization-verification.jsonl`（`ac="AC106"`，含 run id + 时刻 + commit）。

## Definition of Done

- [ ] dist-verify-node-floor job success 已核实（真实 run，非配置）；记录已写入 productization-verification.jsonl；若发现未真跑则按缺陷立案。

## Touches

- .quay/productization-verification.jsonl（记录）
- tasks/gap-ac106-dist-verify-node-floor-ran.md（自身）
