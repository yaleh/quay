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

- [ ] OUTER-LOOP.md charter-authoring step explicitly `git add`s the new charter file
- [ ] `execute-milestone.js` Audit phase either commits its own output file, or Land phase
  step 2 mechanically stages `milestones/M<NN>/audits/*` (not just prose "if...")
- [ ] A single authoritative rule decides the `milestones/` path prefix for a given
  milestone number; both the Audit-phase write and the dogfood-evidence-gate lookup use it
- [ ] A fresh milestone run (serial path) lands with its charter AND audit file already
  committed as part of the ABSORB commit — no manual sweep needed afterward
- [ ] `tree-hygiene-check.sh` (or a new check) surfaces an untracked charter/audit file at
  Gate time as at least a WARNING, so future drift is visible before it accumulates
- [ ] Existing it0 selfchecks + gate hashes stay green
- [ ] No regression to the serial or concurrent execution paths

## Definition of Done

- [ ] `OUTER-LOOP.md` charter step change landed and verified (a real charter's `git add`
  is part of that milestone's own commit history, not swept later)
- [ ] `execute-milestone.js` Audit-phase/Land-phase change landed; a real milestone's audit
  file lands in the SAME commit series that merges the milestone (not left untracked)
- [ ] Path-prefix rule is single-sourced (grep confirms no duplicated boundary logic)
- [ ] All it0 selfchecks + gate hashes green on the merged result
- [ ] No new backlog accumulates over the next 5 milestones (spot-check `git status` clean
  on charters/ and audits/ after each)
