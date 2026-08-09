---
id: gap-workflow-metadata-warn-omissions
title: "Workflow metadata WARN-level omissions — decide fix or document"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

**Created 2026-08-02 (dev-session-handoff-2026-08-02b item 1 follow-up):** the
workflow-metadata-conformance checker (DIR-124-A4) reports 14 WARNs on the live tree. These are
metadata OMISSIONS (the meta surface does not mention a mechanism that exists in the body), not
false claims — the 6 false-claim FAILs were fixed in the item-1 commit. The audit scoped the WARNs
out of item 1 ("值得修就单独建任务不要顺手扩大"), so this task exists so the detection is not left
unattended.

## Proposal

The checker's 14 WARNs on the live tree, by class:

1. **worktree isolation not mentioned in metadata** — execute-milestone.js has 40+ references to
   `_useWorktree`/`_isolationPlan`/`isolationMode` but neither `meta.description` nor any
   `meta.phases[]` entry addresses worktree isolation (DIR-123 is a substantial mechanism with zero
   metadata mention). prepare-milestone.js's worktree isolation (gap-prepare-milestone-no-worktree-
   isolation) has the same omission.
2. **cache/resume logic not mentioned** — execute-milestone.js's Verify cache-fingerprint/resume
   and prepare-milestone.js's `--decide-resume`/checkpoint continuation are not flagged in metadata.
3. **re-entrant phase multiplicity not annotated** — prepare-milestone.js calls `phase('Preflight')`
   at two logically distinct sites (content vs plan-shape preflight), `phase('ProposalAuthors')` and
   `phase('Adjudicate')` at resume/cold sites; the meta surface has no convention for this.
4. **node-invocation convention divergence** — execute uses `node --experimental-strip-types` (18
   sites, no `--no-warnings`), prepare always uses `--no-warnings` (8 sites); no documented rationale.

## Acceptance Criteria

- [ ] AC1: For each WARN class, decide: (a) fix the metadata to mention the mechanism, or (b) document why the omission is acceptable
- [ ] AC2: The checker's WARN count on the live tree drops to 0 (if fixing) or each remaining WARN has a documented rationale in a metadata-omission registry
- [ ] AC3: Mirror byte-identity preserved; workflow-metadata-conformance tests updated to the new WARN baseline

## Definition of Done

- [ ] Either the metadata mentions the mechanisms OR a documented decision records the omission as intentional
- [ ] `workflow-metadata-conformance.mjs` reports the decided state; tests pin it

## Contract

measure   warn_count = `node --no-warnings --experimental-strip-types experiments/quay-perpetual-stream/scripts/workflow-metadata-conformance.mjs 2>&1 | grep -c 'WARN'` 输出的计数
band      warn_count = 0（修复后）或每剩余 WARN 有文档 rationale
invariant mirror_byte_identity = 1（两份 workflow 镜像 diff 为空——AC3）
invariant tests_pinned = 1（workflow-metadata-conformance 测试更新到新基线）
invoke    `bash scripts/test.sh --for-task gap-workflow-metadata-warn-omissions`
control   scoped 门绿；WARN 计数与决策记录一致
resume    逐 WARN 类决策（修 or 记录）分步提交

## Touches

- .claude/workflows/execute-milestone.js
- plugin/workflows/execute-milestone.js
- .claude/workflows/prepare-milestone.js
- plugin/workflows/prepare-milestone.js
- plugin/test/workflow-metadata-conformance.test.mjs
- experiments/quay-perpetual-stream/scripts/workflow-metadata-conformance.mjs

## Dispatch review

reviewer: none
at: 2026-08-09
changed: 无（本任务补 ## Contract 六键晋级 Contract，非新派发，无 review 记录）
