# Charter M116-ts-migration-p5-a — TS migration P5-A (bin entrypoints, DIR-058)

**Milestone id:** M116
**Task:** `tasks/exp5-M-TS-MIGRATION-P5-A.md`
**Surface:** development-class / capability-growth (crystallization, JS-elimination observability)
**Charter authored (retroactive, ABSORB-time):** 2026-07-23
**Base commit:** master HEAD at dispatch was M115's merge (`a64d0b0`); implementation landed as `3667b02`
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

This charter is authored at ABSORB time, after the milestone's implementation already landed on
`master` (`3667b02feat(M116): TS migration P5-A (DIR-058)`) in the same working session that also
produced an out-of-band directive fix (DIR-059, commit `6f183ef`, addressing 3 confirmed host OOM
kills that were killing the loop's own sessions). The prior session's turn ended before the ABSORB
bookkeeping (charter file, it0 checks, adversarial audit, DoD gate, dashboard SELECT/ABSORB entries,
task write-back, `milestone_counter++`) was performed. This charter, and the ABSORB steps that follow
it, complete that bookkeeping against the real, already-landed code — per DIR-026 Reading A (done =
a real object actually operated through the mechanism), the code is real; what was missing was the
governance record, which is authored now, not re-derived by re-doing the work.

## Scope

Per DIR-058 (drained at M115, split into P5-A/P5-B children per DIR-026 split-or-commit): migrate the
4 CLI `bin/*.js` entrypoints to `.ts`, behavior-preserving (same CLI output, same exit codes), under
the ADR-012 golden-diff discipline (`tsc --noEmit` + full-suite-green, Node native type-stripping, no
build step):

- `packages/quay-native/bin/quay-native.js` → `.ts`
- `packages/quay-github/bin/quay-github.js` → `.ts`
- `packages/quay/bin/quay.js` → `.ts`
- `packages/quay-backlog/bin/quay-backlog.js` → `.ts`

Each package's `package.json` `bin` field, `.quay/config.yml`/`.mcp.json`/`plugin/.mcp.json`
`mcp_entry` paths, `esbuild-sea.mjs` bundler configs, and every test helper referencing a `bin/*.js`
path were updated to match.

**Out of scope (permanent exemption, DIR-058):** `packages/quay-native/scripts/manifest.sea-shim.js`,
`packages/quay/scripts/version-sea-shim.js` — esbuild `--alias` substitution targets for the SEA
single-executable build only.

**Also folded into this milestone's landed commit (bookkeeping only, not new scope):** "not selected"
notes on PROBE-M98-001, exp5-DEFECT-CLAUSE8-HYPHEN-LABEL-MISMATCH, exp5-DEFECT-M114-TESTSUITE-DRIFT,
exp5-M-ARCH-AUDIT-M98-EXPLORE, exp5-M-TS-MIGRATION-P5-B; two defects filed while doing this migration
(exp5-DEFECT-CONFIG-YML-STALE-MJS-REFS, exp5-DEFECT-QUAY-CORE-SEA-BUILD-CRASH — the latter explicitly
flagged as needing its own scoped milestone, not fixed here).

**Adjacent, separately-tracked directive landed the same session (DIR-059, commit `6f183ef`):** the
`ts-typecheck` gate was split into a per-package loop (was a single root `npx tsc --noEmit` peaking at
4-4.5GB anon-rss and OOM-killing the host 3x that day) + a duplicate-zod dedup via root `overrides`
(the real driver of the peak, `@modelcontextprotocol/sdk`'s permissive zod range let npm hoist a
second copy). This ABSORB also carries DIR-059's disposition (see dashboard ABSORB entry) since both
landed in the same commit pair and the per-package gate is what THIS milestone's own DoD meta-enforcer
gate now runs.

## Class routing

**Development-class** (deliverable is working product code — CLI entrypoint files). Per DIR-014, a
development-class milestone should route through `quay-task-to-plan` first; this milestone's Plan
section (task body) reads "N/A — mechanical per-file port, same pattern as P1", matching the P1–P4
precedent (M77 etc.) where the pipeline was judged unnecessary for a mechanical, behavior-preserving
rename with an established golden-diff pattern already proven 3 times (P1/P3/P4). No new design risk;
continuing that precedent here rather than retroactively demanding a pipeline run against
already-landed, already-verified code.

## Acceptance Criteria (from task, verified at this ABSORB)

- [ ] All 4 `bin/*.js` files renamed/ported to `.ts`, runnable directly via `node <path>.ts --help` (or equivalent) with exit code 0 and unchanged output.
- [ ] `npx tsc --noEmit` (root tsconfig, once these files are included) exits 0 or with only the pre-existing documented TS2589 errors (no NEW errors from these 4 files).
- [ ] Full non-flaky suite green before/after (golden-diff): `cd packages/quay && node --test $(ls test/*.mjs | grep -vE 'serve-github|provider-abi-conformance')`.
- [ ] The 2 SEA shims are explicitly named as out-of-scope in this task's Resolution (not silently ignored).

## Definition of Done

References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts:
- [ ] All 4 files are `.ts` on `master`, `git log --follow` shows the rename commit for each.
- [ ] `tsc --noEmit` + full suite pasted as evidence in the Resolution.
- [ ] No behavior change (golden-diff: identical CLI output/exit codes before and after, pasted evidence).

## GATE-HASH-REF

GATE-HASH-REF: 22c64fc383d6fc03ba375f8b9ce463abce3459d318c8787e33d8bcb321d876e1
