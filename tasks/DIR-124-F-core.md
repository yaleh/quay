---
id: DIR-124-F-core
title: "Ground-truth registry data + CLI: inject, validate, promote from seed facts"
status: done
labels:
  - directive
  - human-steered
  - milestone-candidate
parent: DIR-124-F
children: []
extra:
  schema: v1
---

**type:** execution

**ADR-022 关闭（2026-08-09，manager 代写，人 17:4x 裁定关闭，随父任务 DIR-124-F 一并关闭）**

原为 DIR-124-F 三个子任务之一（Registry 数据 + CLI + 种子 + 校验）。载体是 `prepare-milestone.js`
的 PlanAuthor/PlanCheck 注入点——**已被 ADR-022（2026-08-03 accepted）物理删除**。

意见：见父任务 `DIR-124-F` 关闭说明。

全文见 git 历史（`git log -p -- tasks/DIR-124-F-core.md`）。

## Proposal

Build a versioned, hash-bound `GroundTruthRegistry`: a checked-in JSON data file
(`experiments/quay-perpetual-stream/scripts/ground-truth-registry.json`, byte-identical mirror at
`plugin/scripts/ground-truth-registry.json`) and a TS CLI module (`ground-truth-registry.ts`)
owning the registry shape, validation, versioning, hashing, and promotion. Seed from the 8
sections of `docs/references/repo-ground-truth.md` with the M205 correction applied (the false §3
first bullet about parenthetical-backtick-breaking is REPLACED with the corrected fact: the real
`preflight-touches-mismatch` cause is an undeclared Plan `- Files:` line).

Merged from original DIR-124-F1 (template hygiene gate), F3 (touches coverage), F4 (fact-class
reconciliation), and F5 (seed integrity) — all are aspects of ONE mechanism: a single-source
registry of repo-invariant facts with a CLI surface.

## Touches
- tasks/DIR-124-F-core.md（自身文件）
