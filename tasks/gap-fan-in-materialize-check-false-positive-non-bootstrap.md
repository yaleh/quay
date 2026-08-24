---
id: gap-fan-in-materialize-check-false-positive-non-bootstrap
title: fan-in-materialize-check 对非 bootstrap 任务假阳性 RED（taskIsBootstrapHit 死代码）⇒
  阻断所有 fan-in
status: done
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`fan-in-materialize-check.ts` 对非 bootstrap 任务产生假阳性 RED，fail-closed 拖红全量 suite，当前阻断【所有】fan-in。现测：`node ... fan-in-materialize-check.ts --root ... --json` → ok:false，唯一 RED 条目 runId=wf_48b9d618-610 taskId=gap-worker-print-bg-wait-ceiling-600s verdict=red-worktree-exists-mismatch（"materialized script != worktree fan-in-execute.js"）。

**根因（已核实，代码位置）**：①print-bg-wait 的 ## Touches 无 fan-in 编排文件 ⇒ 非 bootstrap-hit；②`judgeRecord`（:251）Case 1（:267 worktree 文件仍在盘）只做字节精确比对、不查 `taskIsBootstrapHit`；③`taskIsBootstrapHit`（:335 已定义）但 `main()` 的 judgeRecord 调用处（:458）从不传/不调用 ⇒ 死代码；④该任务 worktree fan-in-execute.js 派发后被 bootstrap-sync/merge-develop 同步到 == 主检出（cmp 一致），而 materialized 记录（05:05Z）仍是派发时刻旧内容 ⇒ 字节不等 ⇒ 假 RED。

## Plan

让 `judgeRecord`/`main` 尊重 `taskIsBootstrapHit`——仅对 bootstrap-hit 任务 RED；非 bootstrap 任务 worktree-vs-materialized 不一致是良性（worktree 演化 / materialize 主版本本就正确）⇒ NOT-EVALUATED 或 GREEN。

## Acceptance Criteria

- [x] AC1（能取假，非 bootstrap 不假红）：非 bootstrap 任务（Touches 无 fan-in 编排文件）的 worktree-vs-materialized 不一致不再产生 RED（⛔ 仍 red-worktree-exists-mismatch ⇒ 假）。
- [x] AC2（能取假，bootstrap 仍红）：bootstrap-hit 任务（Touches 含 fan-in 编排文件）的 worktree-vs-materialized 不一致仍 RED（⛔ 漏报 ⇒ 假）。

## Definition of Done

taskIsBootstrapHit 接线到 judgeRecord/main 落地 develop；AC1-2 全勾；print-bg-wait 的假 RED 消除（AC1）、bootstrap 真 RED 保留（AC2）。

## Touches

- plugin/scripts/fan-in-materialize-check.ts（judgeRecord 接 taskIsBootstrapHit）
- plugin/test/fan-in-materialize-check.test.mjs（或对应测试）
- tasks/gap-fan-in-materialize-check-false-positive-non-bootstrap.md（自身）