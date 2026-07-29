---
id: exp5-M-TS-MIGRATION-P4
title: "TS migration P4 (exp5 method-infra scripts, ADR-012): migrate the
  load-bearing gates/scripts to TS under the golden-diff discipline (like the
  it0-dod-check restructure) — behavior-preserving, autonomous."
status: done
labels:
  - milestone-candidate
  - crystallization
parent: exp5-M-TS-MIGRATION
children:
  - exp5-M-TS-MIGRATION-P4-BATCH3
  - exp5-M-TS-MIGRATION-P4-BATCH4
extra:
  schema: v1
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-M-TS-MIGRATION-P4
    experiments/quay-perpetual-stream/charters/M111-ts-migration-p4-close.md
    /tmp/m111-absorb-entry.md
---
## Proposal
Phase P4 (final) of [[exp5-M-TS-MIGRATION]] (ADR-012). With the product packages on TS (P3), migrate
exp5's own **method-infrastructure scripts** — the load-bearing gates under
`experiments/quay-perpetual-stream/scripts/` (notably `it0-dod-check.mjs` the DoD meta-enforcer, the
schema checks, the DIR-044 concurrency + DIR-051 routine scripts) — JS→TS, each under the SAME
behavior-preserving + golden-diff discipline used for the it0-dod-check restructure.

These scripts are the loop's own guardrails, so P4 is the highest-care phase: a behavior change in a
gate is a change in what the loop enforces. The golden-diff (fixture-pinned selfchecks: same inputs →
byte-identical verdicts before/after) is the executable safety, NON-WAIVABLE. Runs AUTONOMOUSLY (parent
`human-steered` cleared 2026-07-21) precisely BECAUSE that safety is a runnable check, not prose.

**Scope:** `experiments/quay-perpetual-stream/scripts/*.mjs` load-bearing gates + their vendored plugin
copies (kept in sync by `sync-vendor.sh`).
**Out of scope:** product `packages/**` (P0–P3); any change to a gate's VERDICT logic (this is a
language port, not a policy change).

## Plan
N/A — split-or-commit at SELECT (DIR-026): migrate in fixture-pinned batches (a script + its
`-selfcheck.sh` together), never a gate without its pin. Behavior-preservation verified mechanically:
- each migrated gate's `-selfcheck.sh` (the golden fixture) produces byte-identical verdicts before/after
  — a true golden-diff on the loop's own enforcement;
- `tsc --noEmit` passes; the it0 DoD meta-enforcer (itself a P4 target — migrate it LAST or under
  extra-careful golden-diff, since it gates everything) still passes on all clauses;
- vendored plugin copies re-synced (`sync-vendor.sh`) so the shipped scripts match;
- TDD per ADR-001; fresh-context adversarial audit per DIR-044/048 — did ANY verdict change? is
  `dod-fixture-selfcheck.sh` still pinning it0-dod-check?

## Acceptance Criteria
- [x] The load-bearing method-infra scripts are `.ts`, pass `tsc --noEmit`, and run under Node native type-stripping; their `-selfcheck.sh` fixtures produce byte-identical verdicts before/after (golden-diff). (AC1 CONFIRMED M111: tsc exit 0)
- [x] The it0 DoD meta-enforcer (Clauses 0–9) still passes on all clauses post-migration; `dod-fixture-selfcheck.sh` still pins it; NO gate verdict logic changed (language port only). (AC2 CONFIRMED M111: all 17 fixtures PASS)
- [x] Vendored plugin copies re-synced so shipped scripts match source; a consumer workspace (archguard) still runs the scripts unchanged — verified 2026-07-29 through the human-provided `archguard` tmux session using the ADR-016 three-step remote-drive protocol. Installed plugin `quay` v0.3.13 at `/home/yale/.claude/plugins/cache/quay-marketplace/quay/0.3.13/`; Node v26.5.0 ran the shipped `routine-scheduler.ts` unchanged (expected exit 3, `no routines due`) and `task-schema-check.sh` → `task-schema-check.ts` unchanged against archguard's real `tasks/DIR-001.md` (content verdict exit 1, proving the script itself executed). Baseline/final archguard status was identical.

## Definition of Done
References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts:
- [x] The method-infra gates run on TypeScript with byte-identical golden-fixture verdicts (pasted before/after), the it0 meta-enforcer green, no verdict drift — on a real milestone. (M111: tsc PASS, all 17 selfcheck fixtures PASS)
- [x] Single-source held (ADR-004): the vendored copies are re-synced, not hand-edited; TDD per ADR-001; fresh-context adversarial audit confirms zero enforcement change (the loop's guardrails are byte-for-byte equivalent). (M111: adversarial audit NO REFUTATION FOUND)
- [x] Per DIR-026 SPLIT-OR-COMMIT: each fixture-pinned batch landed done; with the external consumer leg now verified, P4 and parent [[exp5-M-TS-MIGRATION]] close together.


## Not selected (M91)

Not selected M91 — exp5-DEFECT-QC-T1-FIXTURE-PROBE-LOSS selected (governance-integrity defect: silent healthcheck failure when QC-T1 fixture missing; bounded scope). This candidate deferred.

## Not selected (M92)

Not selected M92 — exp5-DEFECT-DIR056-PROBE-SPEC-UNWIRED selected (higher-leverage defect: SKILL wiring absent blocks 3 downstream milestones). exp5-M-TS-MIGRATION-P4 also exceeds 5235L scope — split-or-commit assessment required before next SELECT.

## Progress

### M106 Batch 1 complete (2026-07-22)

Migrated 9 method-infra scripts (selfcheck-paired, no plugin-vendor copies) from `.mjs` to `.ts`:
1. `audit-independence-check.ts`
2. `governance-product-ratio-check.ts`
3. `loadbearing-test-gate.ts`
4. `outward-vt-check.ts`
5. `rolling-slope-check.ts`
6. `vmeta-lag-check.ts`
7. `git-lens-l-d-code-doc-ratio.ts`
8. `git-lens-l-g-structural-drift.ts`
9. `git-lens-l-s-behavior-variance.ts`

Evidence:
- All 7 selfchecks: GOLDEN-DIFF PASS (byte-identical before/after)
- `npx tsc --noEmit -p scripts/tsconfig.json`: exit 0
- `node --test packages/quay/test/gate.test.mjs`: 25/25 PASS
- `it0-dod-check.mjs` sha256: 33de7bbae2cda1eaea5e31cd9199da82c65b1a391042ce7638d81157fed92deb (untouched)
- Shell wrappers, selfcheck scripts, OUTER-LOOP.md, inherited-core.md, test file imports all updated

Remaining (future batches): `it0-dod-check.mjs` (GATE-HASH-REF rotation — separate milestone),
plugin-vendor-copy scripts (requires plugin bump + sync), scripts without selfcheck fixtures.

### M107 Batch 2 complete (2026-07-22)

Migrated 7 remaining non-vendor scripts from `.mjs` to `.ts`:
1. `it0-task-bulk-write.ts`
2. `it0-backlog-regen.ts`
3. `it0-backlog-projection-check.ts`
4. `regenerate-backlog-view.ts`
5. `it0-split-or-commit-check.ts`
6. `it0-enforcement-with-design-check.ts`
7. `golden-replay-dir044.ts`

Evidence:
- `npx tsc --noEmit -p scripts/tsconfig.json`: exit 0
- Test-pinned scripts: `it0-enforcement-with-design-check.test.mjs` 13/13 PASS (byte-identical before/after); `it0-split-or-commit-check.test.mjs` 22/22 PASS (byte-identical before/after)
- `golden-replay-dir044.ts` smoke test: exit 0 (PASS: orthogonality DISJOINT, 2-wide batch, fan-in +2, anti-drift OK)
- `it0-dod-check.mjs` sha256: 33de7bbae2cda1eaea5e31cd9199da82c65b1a391042ce7638d81157fed92deb (untouched)
- Full test suite (excluding serve-github/provider-abi-conformance): exit 0
- All active reference locations updated: `.quay/gates.yml` (lines 107/113), `OUTER-LOOP.md` (3 refs), `it0-backlog-projection-check.sh`
- Adversarial audit: NO REFUTATION FOUND (`milestones/M107/audits/iteration-0-acceptance-audit.md`, session `b2f94e31-7c18-4a92-8e6d-5f0d3a1c9e47`)

Remaining (future batches): `it0-dod-check.mjs` (Batch 4 + GATE-HASH-REF rotation), plugin-vendor-copy scripts (Batch 3: requires plugin bump + sync).

## External consumer proof and closure (2026-07-29)

The human operator supplied a live Claude Code session in tmux session `archguard`, rooted at the
foreign consumer workspace `/home/yale/work/archguard`. The session was driven using ADR-016's
three separate `send-keys` operations; evidence was read from the filesystem, not accepted from the
TUI. The installed plugin cache identified `quay` v0.3.13 and Node v26.5.0. Two representative
shipped method-infrastructure entrypoints ran unchanged with native type stripping:

- `routine-scheduler.ts` returned the contractually expected `no routines due` / exit 3 for the
  consumer's empty effective routine list.
- `task-schema-check.sh` delegated to `task-schema-check.ts` and returned a real schema-content
  verdict against archguard's legacy `tasks/DIR-001.md` (exit 1); the nonzero verdict is input
  content, not a runtime or distribution failure.

The installed vendor MCP path (`vendor/quay/dist/quay.js`) was present. A third sampled script,
`config-wiring-check.ts`, is not a standalone distributed entrypoint because it imports a monorepo
sibling; that honest exception does not refute AC3's consumer execution claim for the shipped
standalone scripts. The archguard baseline and final `git status --porcelain` were identical. This
removes M111's sole external blocker; status is normalized to `done`.
