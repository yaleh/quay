---
id: DIR-124-F-core
title: "Ground-truth registry data + CLI: inject, validate, promote from seed facts"
status: todo
labels:
  - directive
  - human-steered
  - milestone-candidate
parent: DIR-124-F
children: []
extra:
  schema: v1
---

**PAUSED (2026-08-02, prepare-pipeline reduction — `docs/analysis/prepare-pipeline-reduction-plan.md`):**
`blocked-by: prepare-pipeline-reduction`. This task's premise assumes the CURRENT prepare
pipeline shape (ProposalReview + 3-round PlanCheck). That shape is being reduced to three
mechanical confirmations (mechanism count, AC executability, Touches completeness), which
changes this task's value. NOT cancelled — re-evaluate after stage B–D of the reduction plan
lands and real dispatch data is available. Do not schedule until then.

**type:** execution

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

### Registry shape

```json
{
  "schemaVersion": "ground-truth-v1",
  "version": 1,
  "contentHash": "<sha256 of canonicalized sorted facts>",
  "facts": [
    {"id": "cli-quay-ts-path", "category": "cli-paths", "fact": "CLI binary is packages/quay/bin/quay.ts, not quay.js", "adrRef": "ADR-019"},
    ...
  ]
}
```

### CLI surface

- `--inject [--categories <cat,...>]` — emit subset as prompt-ready text
- `--validate [--receipt <preparation.json>]` — schema + category whitelist + hash
- `--promote <fact-json>` — schema/category validate, append, version bump, recompute hash
- `--selftest` — verify internal invariants
- `--version`, `--hash`

### Categories (from repo-ground-truth.md)

cli-paths, coverage-format, touches-matching, provider-defaults, module-signatures,
evidence-surface, subprocess, gate-resolution

## Acceptance Criteria

- [ ] AC1: `ground-truth-registry.json` exists, seeded from 8 repo-ground-truth.md sections with M205 correction
- [ ] AC2: `ground-truth-registry.ts` CLI module exists (both mirrors, byte-identical)
- [ ] AC3: `--inject` emits all facts as prompt-ready text (or subset by category)
- [ ] AC4: `--validate` checks schema, category whitelist, contentHash — non-zero exit on mismatch
- [ ] AC5: `--promote` appends a fact, bumps version, recomputes hash — rejects duplicate exact-match or unknown category
- [ ] AC6: `--selftest` verifies internal invariants (version > 0, contentHash matches, facts all have valid categories)
- [ ] AC7: `prepare-milestone.js` injects registry facts into PlanAuthor/PlanCheck prompts via `_groundTruthAgentCall`
- [ ] AC8: Template hygiene: `extractSection("Touches")` rejects prose after `## Touches` (`touches-overbroad`), surfaced via `prepare-admission-check.ts`
- [ ] AC9: M205 correction applied: the false parenthetical-backtick-breaking claim is replaced with the true undeclared-Plan-Files-line cause

## Definition of Done

Standard `inherited-core.md` DoD clauses apply.

- [ ] Tests pass: both mirrors byte-identical, `--validate` passes on seeded registry, `--promote` + `--validate` round-trip
- [ ] `prepare-milestone.js` PlanAuthor/PlanCheck prompts include injected facts
- [ ] Independent wiring audit confirms zero stale facts (M205 correction verified)

## Contract

measure   registry_seeded = `grep -c '"id":' plugin/scripts/ground-truth-registry.json` 输出的计数（seed 后的事实条数）
band      registry_seeded = ≥ 8（8 类至少各 1 条，seed 完成）
invariant mirrors_byte_identical = 1（plugin/ 与 experiments/ 两镜像 diff 为空）
invariant validate_passes = 1（`ground-truth-registry.ts --validate` 对已播种 registry 退出 0）
invoke    `node --experimental-strip-types plugin/scripts/ground-truth-registry.ts --validate`
control   --validate 退出 0 且 contentHash 与 --hash 一致；两镜像 diff 为空
resume    registry 数据文件 + CLI 模块分步提交；AC1/AC2 完成即写盘

## Touches

- experiments/quay-perpetual-stream/scripts/ground-truth-registry.json
- plugin/scripts/ground-truth-registry.json
- experiments/quay-perpetual-stream/scripts/ground-truth-registry.ts
- plugin/scripts/ground-truth-registry.ts
- .claude/workflows/prepare-milestone.js
- plugin/workflows/prepare-milestone.js
- experiments/quay-perpetual-stream/scripts/task-schema.ts
- plugin/scripts/task-schema.ts
- experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts
- plugin/scripts/prepare-admission-check.ts

## Dispatch review

reviewer: none
at: 2026-08-09
changed: 无（本任务补 ## Contract 六键晋级 Contract，非新派发，无 review 记录）
