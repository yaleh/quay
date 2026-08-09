---
id: DIR-119-D
title: Literally wire phase-DAG Build, read-only audit shards, and deterministic
  Reconcile into execute-milestone.js; add real manifest phase/shard synthesis;
  fix Gate-failure task attribution
status: needs-human
labels:
  - milestone-candidate
  - human-steered
parent: DIR-119
children:
  - DIR-119-D1
  - DIR-119-D2
  - DIR-119-D3
  - DIR-119-D4
  - DIR-119-D5
extra:
  dirStatus: applied
  schema: v1
---

**type:** execution

**ADR-022 关闭（2026-08-09，manager 代写，人 17:4x 裁定关闭，随父任务 DIR-119 一并关闭）**

本任务是 `execute-milestone.js` 里 phase-DAG Build/read-only audit shards/deterministic Reconcile
的接线工作。载体已被 ADR-022（2026-08-03 accepted）物理删除。

**子任务状态**：`DIR-119-D1` 已 `done`（历史记录，不动）；`DIR-119-D2`/`D3`/`D4` 此前已各自获得
outer 的详细 needs-human 裁定（逐条核实了 `concurrent-batch-scheduler.ts` 为什么是错误重开目标）——
本次关闭不覆盖那些裁定的具体推理；`DIR-119-D5` 同批按同一理由关闭。

意见：见父任务 `DIR-119` 关闭说明。

全文见 git 历史（`git log -p -- tasks/DIR-119-D.md`）。

## Proposal

Close, as literal callable production code, the execution-side gaps that DIR-119-B deliberately
left as tested-but-uninvoked contract modules and that DIR-119-C's real canary run neither
delivered nor (in its independent audit) checked for. **Split 2026-07-29 (DIR-026
SPLIT-OR-COMMIT)**, after a real `prepare-milestone.js` `ProposalReview` run against this task's
own (already wiring-coverage-complete, schema-passing) Proposal returned
`needs-human`/`split-recommended` with code `split-multi-mechanism` ("candidate contains 5
independently landable mechanisms (> 2)") — a real, mechanically-detected structural finding, not
an infrastructure fault (the same run also caught 3 genuine content defects in this task's own
prior text: a self-contradicting `select-preflight.js` "both wrappers" AC item, a missing
`## Touches` entry for the file the Proposal itself said it would edit, and a stale
`## Requested action` block written before the reconciled Proposal's actual fusion-not-isolation
mechanism existed).

Parent completion is exactly the completion of DIR-119-D1 through DIR-119-D5, in that dependency
order:

1. [[DIR-119-D1]] — real manifest phase/shard synthesis (`composite-manifest-synthesis.ts`) at the
   SELECT/dispatch boundary. No dependencies within this split.
2. [[DIR-119-D2]] — Build becomes a real phase-DAG dispatcher (`composite-build.ts`). Depends on D1.
3. [[DIR-119-D3]] — Audit becomes per-shard, mechanically-enforced read-only dispatch
   (`composite-audit.ts`). Depends on D1, D2.
4. [[DIR-119-D4]] — literal Reconcile phase as sole composite state writer, plus the Gate-failure
   attribution fix (`composite-reconcile.ts`). Depends on D1, D2, D3.
5. [[DIR-119-D5]] — Land as an atomic transaction validator (`composite-land.ts`), the single real
   end-to-end pipeline proof, and the fresh independent wiring audit DIR-119-D's own Requested
   action item 9 requires. Depends on D1 through D4 all being `done`.

This parent is not independently SELECTable — each child carries its own full Proposal/Plan/AC/DoD
and is dispatched (prepared + executed) on its own.

## Touches
- tasks/DIR-119-D.md（自身文件）
