---
title: ABSORB pipeline never commits charter or Audit-phase evidence files —
  accumulates as untracked cruft
status: todo
labels:
  - gap
  - human-steered
extra:
  schema: v1
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    gap-absorb-charter-audit-not-committed
    experiments/quay-perpetual-stream/charters/M176-gap-absorb-charter-audit-commit.md
    /tmp/m176-absorb-entry.md
---

## Finding

Two artifacts the ABSORB pipeline itself creates are never explicitly `git add`ed by any
step in the pipeline, so they accumulate as untracked files on `master` until someone
notices and sweeps them manually (16 charters + 19 audit files were found backlogged
2026-07-26, spanning M144–M166 — see commit `bfc5289`).

### Root cause 1: charter files

`experiments/quay-perpetual-stream/charters/M<NN>-*.md` is authored in the OUTER-LOOP
main session's "charter" step — outside any workflow or worktree. A full-text search of
`plugin/workflows/execute-milestone.js` (both `.claude/workflows/` and `plugin/workflows/`
copies) for `git add`/`charter` shows the charter file is read-only input everywhere
(scope checks, gate-hash verification) — no step anywhere in the pipeline stages or
commits it.

### Root cause 2: Audit-phase evidence file

`execute-milestone.js`'s Audit phase (`phase('Audit')`, ~line 167) instructs the fresh-context
auditor:

```
Output to milestones/M<NN>/audits/iteration-0-acceptance-audit.md.
```

using a bare relative path — no `cd <worktree>` prefix, no `git add`/`git commit`
instruction. Compare to the Land phase (~line 296), which explicitly does
"1. MERGE the iteration worktree into master" — but by the time Land runs, the Audit
file was already written directly into the MAIN workspace tree (not inside the isolated
worktree branch), so the merge operation has nothing to pick up: the file was never part
of any commit on either side to begin with. It simply sits as untracked cruft in `master`'s
working directory.

The Land phase's step 2 ("CAPTURE then PRUNE... if a non-primary iteration produced
evidence not on master, cherry-pick JUST that evidence file") is prose-driven and aimed at
a DIFFERENT scenario (a failed/retry iteration's evidence) — it does not cover "the
primary iteration's own Audit-phase file landed in the wrong place."

### Root cause 3 (minor, same mechanism): inconsistent milestones/ path prefix

`it0-dogfood-evidence-gate.sh` supports both `milestones/` (M130+, current) and
`experiments/quay-perpetual-stream/milestones/` (legacy, M01-M125). M144 is exactly at
this boundary and got written to BOTH paths with identical content — a stray duplicate
(fixed in the sweep commit `bfc5289` by keeping the legacy path, since M144's
`iterations/iteration-0.md` was already committed there). All milestones M145+ correctly
use only the top-level path, so this is a one-off at the transition boundary, not an
ongoing issue — but it confirms the Audit-phase write step has no single, authoritative
path-resolution logic; it is inferred fresh each time.

### Why this hasn't blocked ABSORB gates

The Gate phase runs `tree-hygiene-check.sh` ("un-gitignored scratch on master → HARD
BLOCK"), but evidently this check does not flag genuinely-wanted-but-uncommitted evidence
files as blocking — only recognized scratch/junk patterns (per `.gitignore`'s own comment
about `*.bak`/`*.tmp`/etc.). A real evidence file with a legitimate path is invisible to it.

## Proposal

Close the gap at its source rather than sweeping again next time:

1. **Charter commit**: after `batch_assemble`/charter authoring in OUTER-LOOP.md step
   1-2, add an explicit `git add experiments/quay-perpetual-stream/charters/M<NN>-*.md`
   (or fold it into the same commit the charter-authoring step already produces, if any).
2. **Audit-file commit**: in `execute-milestone.js`'s Audit phase prompt, add an explicit
   instruction to `git add milestones/M<NN>/audits/iteration-0-acceptance-audit.md` after
   writing it — OR, cleaner: have the Land phase's step 2 (CAPTURE) mechanically check for
   `milestones/M<NN>/audits/*` as an expected artifact to stage, not just prose-driven
   "if a non-primary iteration produced evidence."
3. **Path resolution**: pin ONE authoritative rule for which `milestones/` prefix a given
   milestone number uses (e.g. `M<NN> >= 130 → top-level; else legacy`), referenced by BOTH
   the Audit-phase write instruction and `it0-dogfood-evidence-gate.sh`'s own lookup, so
   they can never disagree (single-source, ADR-004).
4. Consider making `tree-hygiene-check.sh` warn (not block) on an untracked file matching
   `experiments/quay-perpetual-stream/charters/M*.md` or `milestones/M*/audits/*.md` at
   Gate time — so future drift surfaces at ABSORB time instead of silently accumulating.

## Plan

N/A — resolved via a milestone. Implementation touches:
- `experiments/quay-perpetual-stream/OUTER-LOOP.md` (charter step: explicit `git add`)
- `plugin/workflows/execute-milestone.js` (Audit phase: explicit commit instruction or
  Land-phase mechanical capture of the audit file path)
- `experiments/quay-perpetual-stream/scripts/it0-dogfood-evidence-gate.sh` (single-source
  path-prefix rule, if not already centralized)
- `experiments/quay-perpetual-stream/scripts/tree-hygiene-check.sh` (optional: warn on
  untracked charter/audit files at Gate time)

## Acceptance Criteria

- [x] OUTER-LOOP.md charter-authoring step explicitly `git add`s the new charter file —
  confirmed: `git show c3ae6dd -- experiments/quay-perpetual-stream/OUTER-LOOP.md` adds
  `⊨ commit: git add experiments/quay-perpetual-stream/charters/M<NN>-*.md as part of THIS
  milestone's own commit sequence...` to the `charter ::` step, consistent with the file's
  existing `⊨`-clause idiom for procedural instructions.
- [x] `execute-milestone.js` Audit phase either commits its own output file, or Land phase
  step 2 mechanically stages `milestones/M<NN>/audits/*` (not just prose "if...") —
  confirmed both: Audit-phase prompt diff adds step "4a. STAGE THE AUDIT FILE...git add this
  audit file"; Land phase CAPTURE step (serial + concurrent, both `.claude/workflows/` and
  `plugin/workflows/` mirrors, verified byte-identical via `diff`) changed from prose
  "if a non-primary iteration produced evidence" to unconditional `git add` of everything
  under `$MILESTONE_ROOT/{audits,iterations}/`.
- [x] A single authoritative rule decides the `milestones/` path prefix for a given
  milestone number; both the Audit-phase write and the dogfood-evidence-gate lookup use it —
  confirmed: `gate_resolve_milestone_root()` added to `gate-script-lib.sh` (both copies
  identical); `it0-dogfood-evidence-gate.sh` calls it directly (verified by running
  `it0-dogfood-evidence-gate.sh --milestone M176` → resolves `milestones/M176` correctly);
  `execute-milestone.js` prompts reference the same function name in both phases.
  `grep -rn "gate_resolve_milestone_root\|-ge 130"` across scripts/workflows shows the
  numeric `130` boundary exists ONLY inside that one function; every other hit is a comment
  referencing it by name.
- [ ] A fresh milestone run (serial path) lands with its charter AND audit file already
  committed as part of the ABSORB commit — no manual sweep needed afterward — **REFUTED**:
  the M176 landing commit `c3ae6dd` (`git show --stat`) includes the charter file but
  contains NO `milestones/M176/audits/` path at all, and no such file exists anywhere in git
  history or on disk as of this audit (`find milestones/M176 -type f` → only
  `iterations/iteration-0.md`). The commit message's own claim ("This milestone's own
  charter + audit-report path are committed here as live proof") is false for the audit half
  — no adversarial audit had run before the Land/merge commit landed on master, so the very
  claim this AC is meant to prove (fix works end-to-end on a real run) was never actually
  exercised. This audit is the first Audit-phase pass for M176 and necessarily lands in a
  LATER, separate commit — which is itself the "manual sweep" pattern the task set out to
  eliminate, not proof it's eliminated.
- [x] `tree-hygiene-check.sh` (or a new check) surfaces an untracked charter/audit file at
  Gate time as at least a WARNING, so future drift is visible before it accumulates —
  confirmed: ran `bash experiments/quay-perpetual-stream/scripts/tree-hygiene-check.sh` live
  (this milestone's own audit file is untracked at the moment of writing) and observed
  `tree-hygiene: WARN — untracked ABSORB-pipeline evidence file(s)...` with exit 0
  (non-blocking, as designed).
- [~] Existing it0 selfchecks + gate hashes stay green — PARTIALLY: `dod-fixture-selfcheck.sh`
  (17/17), `audit-independence-selfcheck.sh` (7/7), `vmeta-lag-selfcheck.sh` (8/8),
  `task-schema-selfcheck.sh` (14/14), `loadbearing-test-gate-selfcheck.sh`, and
  `it0-gate-hash-check.sh --by-reference` all PASS. However `touches-orthogonality-selfcheck.sh`,
  `routine-scheduler-selfcheck.sh`, `serial-fanin-absorb-selfcheck.sh`, and
  `concurrent-batch-scheduler-selfcheck.sh` all FAIL — confirmed via a throwaway worktree at
  the pre-M176 commit (`3054ca7`) that these 4 fail identically there too, so they are
  **pre-existing breakage, not a regression introduced by this milestone**. Left unticked
  because the literal AC text ("Existing it0 selfchecks... stay green") is not met in
  absolute terms, even though this milestone caused none of the 4 failures.
- [x] No regression to the serial or concurrent execution paths — confirmed for the parts
  this milestone touches: `node --check` passes on both `.claude/workflows/execute-milestone.js`
  and `plugin/workflows/execute-milestone.js`; both serial and concurrent Land-phase CAPTURE
  edits are structurally parallel (same diff shape applied to both code paths); the two
  workflow-mirror files remain byte-identical (`diff` exit 0); `plugin/test/plugin-packaging.test.mjs`
  passes 30/30 (the packaging-regression the implementer caught and fixed mid-build).

## Definition of Done

- [x] `OUTER-LOOP.md` charter step change landed and verified (a real charter's `git add`
  is part of that milestone's own commit history, not swept later) — confirmed: charter
  `experiments/quay-perpetual-stream/charters/M176-gap-absorb-charter-audit-commit.md` is
  present in commit `c3ae6dd`'s file list (66 insertions), not left untracked.
- [ ] `execute-milestone.js` Audit-phase/Land-phase change landed; a real milestone's audit
  file lands in the SAME commit series that merges the milestone (not left untracked) —
  **REFUTED**, same evidence as the AC row above: no audit file exists in `c3ae6dd` or
  anywhere else in the repo prior to this audit pass. The code change (the instruction text)
  landed; the behavioral claim it makes about itself has not been demonstrated by a real run.
- [x] Path-prefix rule is single-sourced (grep confirms no duplicated boundary logic) —
  confirmed, see AC row above.
- [~] All it0 selfchecks + gate hashes green on the merged result — see AC row above (4
  pre-existing, non-regression failures remain).
- [ ] No new backlog accumulates over the next 5 milestones (spot-check `git status` clean
  on charters/ and audits/ after each) — cannot be confirmed yet; 0 milestones have landed
  since M176 as of this audit (2026-07-26). Forward-looking criterion, unverifiable at audit
  time.
