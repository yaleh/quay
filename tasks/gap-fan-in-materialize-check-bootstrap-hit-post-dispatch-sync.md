---
id: gap-fan-in-materialize-check-bootstrap-hit-post-dispatch-sync
title: fan-in-materialize-check Case-1 对 bootstrap-hit 任务「派发后 merge-develop 同步」假阳性 RED ⇒ 阻断跨任务 fan-in
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`fan-in-materialize-check.ts` 的 `judgeRecord` Case-1（worktree 文件仍在盘，`:277`）只做字节精确比对：`materialized == 当前 worktree` ⇒ green，否则立即 `red-worktree-exists-mismatch`。这漏了「**派发后 worktree 被 merge-develop 同步**」这一合法演化形态——materialized 记录是派发时刻的正确版本，但 worktree 随后 merge-develop 到新版本，字节不等 ⇒ 假 RED。与已 done 的 `gap-fan-in-materialize-check-false-positive-non-bootstrap` 同族，但那条只修了非 bootstrap 任务的早期返回（`isBootstrapHit === false → not-applicable`），**bootstrap-hit 任务 + 派发后同步**这一条仍在 Case-1 里假红。

**实证（2026-08-25，已核实，非推测）**：`gap-webui-session-lifecycle` fan-in 被 `red-worktree-exists-mismatch` 阻断，对象是别任务 `gap-suite-concurrent-session-liveness-cross-contamination`（status=ready，worktree 在盘，Touches 含 `plugin/scripts/full-suite-runner.ts` ⇒ bootstrap-HIT）。时间线：
- 05:12:33Z develop 的 `fan-in-execute.js` 改到 `9a7c9fec`（commit 13398785）；
- 06:29Z 派发 materialized `491f894e`（= 82f659a0，08-24 版本）——**此刻 cross-contamination worktree 尚未 merge-develop**（其 merge 提交 9e6e4e28 是 06:33:29Z，晚于派发）；
- 06:33:29Z worktree merge-develop 同步到 `9a7c9fec`；
⇒ 06:29Z 派发物化的 `491f894e` 是【派发时刻】的 worktree 正确版本，但 Case-1 拿它与【当前】worktree `9a7c9fec` 比对 ⇒ 字节不等 ⇒ 假 RED。checker 判红正确却判错了对象态（把「派发后同步」当成「fallback 到旧版本」）。

## Plan

扩展 Case-1：worktree 文件在盘且 `materialized != 当前 worktree` 时，**不立即 RED**，而是复用 Case-2 的 git 重建逻辑（`recon`：fanIn 态 / dispatch-HEAD 态 / base），按序比对：
- `materialized == worktree@fanIn` ⇒ green（最终 worktree 态）；
- `materialized == worktree@dispatch-HEAD` ⇒ green（派发时刻 worktree 态——本案的 491f894e 应落这里）；
- `materialized == base && task 自己 commit 改过该 workflow 文件` ⇒ 仍 RED（fallback 真阳性，保留）；
- 都不匹配 ⇒ not-evaluated（不可 pin 的中间演化，硬规则 3b，不伪装成 green）。
关键改动：`recon` 目前只在 worktree 消失（Case-2）时计算，需在 Case-1 的 mismatch 路径也计算（或把 Case-1 的 mismatch 直接 fall-through 到 Case-2 逻辑）。**⛔ 不得削弱真阳性**：fallback 到 base 且 task 改过该文件的 RED 必须保留。

## Acceptance Criteria

- [x] AC1（能取假，本案归 green）：构造「派发时刻 materialized == worktree@dispatch-HEAD，但当前 worktree 已 merge-develop 到新版本」的 case，checker 判 green（不 RED）；（⛔ 仍 RED ⇒ 假）。
- [x] AC2（能取假，真阳性不削弱）：构造「materialized == base（PRE-task）且 task 自己 commit 改过 fan-in-execute.js」的 case，checker 仍 RED（fallback 真阳性保留）；（⛔ 变 green ⇒ 削弱，假）。
- [x] AC3（能取假，真机回放）：对 2026-08-25 的 wf_c0f7d061-5e4（materialized 491f894e）真机回放，checker 不再报 red-worktree-exists-mismatch（判 green 或 not-evaluated，非 RED）。

## Definition of Done

Case-1 扩展落地 develop；AC1/AC2/AC3 全勾；`fan-in-materialize-check.test.mjs` + mutation case（`checker-mutation-cases/fan-in-materialize-check.sh`）补「派发后同步」负控制，`node --test` 绿；真机回放 wf_c0f7d061-5e4 不再 RED。

## Touches

- plugin/scripts/fan-in-materialize-check.ts（Case-1 扩展）
- plugin/test/fan-in-materialize-check.test.mjs（补负控制）
- plugin/scripts/checker-mutation-cases/fan-in-materialize-check.sh（补 mutation case）
- tasks/gap-fan-in-materialize-check-bootstrap-hit-post-dispatch-sync.md（自身）
