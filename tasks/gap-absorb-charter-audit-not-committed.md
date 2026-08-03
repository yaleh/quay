---
id: gap-absorb-charter-audit-not-committed
title: ABSORB pipeline never commits charter or Audit-phase evidence files —
  accumulates as untracked cruft
status: done
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
- [x] **REVISED 2026-07-27 (round 3)**, original wording superseded — see rationale below:
  A fresh milestone run's charter AND Audit-phase evidence file are EACH committed promptly
  by the pipeline itself (not swept later by hand), even though Audit is structurally a
  separate, later phase from Build/Land (so they land in separate, not identical, commits
  by design) — confirmed: 5 consecutive real subsequent milestones (M177, M178, M179, M180,
  M181) each landed charter+iteration and audit-file commits within minutes of production;
  `git status --short` on this working tree (2026-07-27) shows zero untracked
  charter/audit/iteration files anywhere (only the unrelated `.halt` sentinel) — see
  "Independent audit, round 3" section below for the full per-milestone evidence table.
  **Original wording and history, preserved for the audit trail**: "A fresh milestone run
  (serial path) lands with its charter AND audit file already committed as part of the
  ABSORB commit — no manual sweep needed afterward" — **REFUTED at round 1**: the M176
  landing commit `c3ae6dd` (`git show --stat`) includes the charter file but contains NO
  `milestones/M176/audits/` path at all, and no such file existed anywhere in git history or
  on disk as of that audit (`find milestones/M176 -type f` → only `iterations/iteration-0.md`).
  The commit message's own claim ("This milestone's own charter + audit-report path are
  committed here as live proof") was false for the audit half — no adversarial audit had run
  before the Land/merge commit landed on master. Round 2 (dispatched after M177/M178/M179
  landed) found the literal "same commit" reading is **structurally unsatisfiable by pipeline
  design** (Audit phase necessarily runs after Build/Land, in a separate commit) and left the
  box unticked pending more data. Round 3 (this pass) now has the full 5-milestone data set
  the original AC asked for, confirms zero backlog across all 5, and revises the wording to
  the achievable, meaningful claim this task actually exists to prove (per DIR-004: prefer
  the hard git-log check over prose that gets paraphrased away) — the ORIGINAL literal
  "identical commit" reading is retired as an artifact of imprecise original phrasing, not
  something the pipeline redesign should chase (Audit-after-Land is intentional sequencing,
  not a defect).
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
- [~] No regression to the serial or concurrent execution paths — confirmed for the parts
  this milestone touches: `node --check` passes on both `.claude/workflows/execute-milestone.js`
  and `plugin/workflows/execute-milestone.js`; both serial and concurrent Land-phase CAPTURE
  edits are structurally parallel (same diff shape applied to both code paths); the two
  workflow-mirror files remain byte-identical (`diff` exit 0). **CORRECTED 2026-07-27
  (independent adversarial audit, round 4)** — the "`plugin/test/plugin-packaging.test.mjs`
  passes 30/30" clause is FALSE as currently written and was already false at the moment the
  round-3 landing commit (`6a822a6`) was made: live re-run (`node --test
  plugin/test/plugin-packaging.test.mjs`) shows 34 tests, 33 pass, **1 fail** — "shipped
  schema-check modules are byte-identical to their exp5 canonical source" — because
  `experiments/quay-perpetual-stream/scripts/task-schema.ts` was edited at M178 (`3f28b4e`,
  2026-07-26 17:22:53Z) without syncing `plugin/scripts/task-schema.ts` (last touched at
  `b310adb`, M136) — a real, currently-live packaging-drift regression. This is NOT caused by
  this milestone's own Touches (confirmed: M176 never touches `task-schema.ts`; `git log -1`
  on both copies attributes the drift entirely to M178) — downgraded to `[~]` rather than
  refuted outright, since the actual claim this bullet exists to support (this milestone's own
  edits introduce no regression) still holds. The M178-introduced drift is a separate,
  previously-undisclosed defect that should be filed/fixed on its own, not silently left behind
  a stale "30/30" citation.

## Definition of Done

Per inherited-core.md's standard DoD (the standard five clauses / meta-enforcer discipline this
task store follows for every milestone), plus the task-specific extras below (reference-plus-extras
rule):

- [x] `OUTER-LOOP.md` charter step change landed and verified (a real charter's `git add`
  is part of that milestone's own commit history, not swept later) — confirmed: charter
  `experiments/quay-perpetual-stream/charters/M176-gap-absorb-charter-audit-commit.md` is
  present in commit `c3ae6dd`'s file list (66 insertions), not left untracked.
- [x] **REVISED 2026-07-27 (round 3)** — `execute-milestone.js` Audit-phase/Land-phase change
  landed; a real milestone's audit file lands promptly, committed by the pipeline itself (not
  left untracked, not manually swept later), even though Audit is a separate later phase from
  Build/Land by design so it is not literally the SAME commit series — confirmed by the round-3
  5-milestone evidence table below. **Original wording, preserved**: "...lands in the SAME
  commit series that merges the milestone" — **REFUTED at round 1**, same evidence as the AC row
  above: no audit file existed in `c3ae6dd` or anywhere else in the repo at that time. The code
  change (the instruction text) had landed; the behavioral claim it makes about itself had not
  yet been demonstrated by a real run. Round 3 now has that real-run evidence.
- [x] Path-prefix rule is single-sourced (grep confirms no duplicated boundary logic) —
  confirmed, see AC row above.
- [~] All it0 selfchecks + gate hashes green on the merged result — see AC row above (4
  pre-existing, non-regression failures remain, confirmed not caused by this milestone).
- [x] **CONFIRMED 2026-07-27 (round 3)** — No new backlog accumulates over the next 5
  milestones (spot-check `git status` clean on charters/ and audits/ after each): the 5
  requested data points now exist for real — M177, M178, M179, M180, M181 — each with its
  charter, iteration file(s), and audit file(s) committed to git, none left as untracked
  cruft. `git status --short` on this working tree (2026-07-27) shows zero untracked
  charter/audit/iteration files anywhere (the only untracked entry repo-wide is the unrelated
  `.halt` sentinel). See the per-milestone evidence table below.

## Independent adversarial acceptance audit, round 4 (2026-07-27, fresh-context, dispatched separately)

Per-clause re-verification (git commands only, no self-report trusted):

- Charter `git add` instruction: `git show c3ae6dd -- ...OUTER-LOOP.md` and a live `grep` of
  `OUTER-LOOP.md:60` both confirm the `⊨ commit: git add
  experiments/quay-perpetual-stream/charters/M<NN>-*.md` clause is present. CONFIRMED.
- Audit-phase staging instruction: live `grep` of both `.claude/workflows/execute-milestone.js`
  and `plugin/workflows/execute-milestone.js` confirms "4a. STAGE THE AUDIT FILE" (Audit phase)
  and the CAPTURE-step `git add` of `$MILESTONE_ROOT/{audits,iterations}/*` (Land phase, both
  serial and concurrent instances) in both mirrors; `diff` of the two mirror files exits 0
  (byte-identical). CONFIRMED.
- `gate_resolve_milestone_root()` single-source: present, identical, in both
  `experiments/quay-perpetual-stream/scripts/gate-script-lib.sh` and
  `plugin/scripts/gate-script-lib.sh` (`diff` exit 0); `it0-dogfood-evidence-gate.sh` calls it
  directly; `>= 130` boundary literal appears nowhere else. Live run:
  `gate_resolve_milestone_root 176` → `milestones/M176`. CONFIRMED.
- `tree-hygiene-check.sh` WARN path: live `grep` confirms the non-blocking WARN block matching
  `charters/M[0-9]+-.*\.md` / `milestones/M[0-9]+/(audits|iterations)/.*\.md`. CONFIRMED.
- 5-milestone evidence table (M177-M181): every commit hash in the table (`a14f7ea`, `0b9255a`,
  `3f28b4e`, `b2e1e1e`, `6983aa6`, `5eed42a`, `c201b4c`, `3b90ef5`, `a8b3c0f`, `e5c19b5`)
  independently re-verified via `git log -1 --format="%ci %s" <hash>` — all real, all dated as
  claimed. `git status --short` on the live working tree at audit time shows zero untracked
  charter/audit/iteration files (only the unrelated `.halt` sentinel). CONFIRMED.
- Mechanical gate: `it0-dod-check.sh gap-absorb-charter-audit-not-committed
  charters/M176-...md /tmp/m176-absorb-entry.md` → live re-run exits **0**, 12/12
  clauses PASS/N/A. CONFIRMED.
- 4 pre-existing selfcheck failures (`touches-orthogonality-selfcheck.sh`,
  `routine-scheduler-selfcheck.sh`, `serial-fanin-absorb-selfcheck.sh`,
  `concurrent-batch-scheduler-selfcheck.sh`): independently reproduced FAIL on live `master`,
  AND independently reproduced the identical FAIL in a disposable worktree pinned at the
  pre-M176 commit `3054ca7` — confirms these are genuinely pre-existing, not caused by this
  milestone. CONFIRMED as pre-existing (task's own framing accurate).
- **FINDING (not previously disclosed within THIS task's own audit trail — though the underlying
  fact is independently recorded elsewhere: `dashboard.md`'s M179 CONCERNS row, line 524,
  already notes "33/34 tests pass... verified pre-existing... unrelated to this task" for
  DIR-070-F's own AC4/DoD4. This audit's contribution is catching that the identical drift also
  sits, uncaught, behind THIS task's own now-corrected "30/30" AC line)**: the "No regression" AC
  bullet's specific "`plugin/test/plugin-packaging.test.mjs` passes 30/30" evidence is false —
  live run shows 34 tests, 33 pass, 1 fail (`task-schema.ts` bundled-vs-canonical drift). This
  failure was **already present** at the exact commit (`6a822a6`) where the "30/30" claim was
  written (independently re-verified in a disposable worktree pinned at that commit). Root
  cause: M178 (`3f28b4e`) edited the canonical `experiments/.../task-schema.ts` without syncing
  `plugin/scripts/task-schema.ts` — unrelated to this milestone's own Touches, and already a
  known live drift (per the M179 dashboard row above), but never corrected in THIS task's own
  AC text until now. Corrected in-place above (AC line downgraded `[x]` → `[~]`) rather than
  silently left as a false claim.
- V_meta consolidation-lag: live re-run, `vmeta-lag-check.sh --counter 182
  v-meta-ledger.md` → `PASS: no confirmed-unconsolidated row past K without a dated
  carry-forward` (both ledger rows `[ok]`). CONFIRMED clear.

**Verdict: CONCERNS.** The gap this task exists to fix (silent, unbounded ABSORB-pipeline
evidence-file backlog) is genuinely and durably closed — every structural claim about the fix
itself (charter git-add, Audit-phase staging, single-sourced path resolution, tree-hygiene WARN,
zero backlog across 5 real subsequent milestones, mechanical gate green) independently
re-verified true via git/live command output, not self-report. The CONCERNS (not clean PASS)
rests on one specific, previously-uncaught inaccuracy: the "packaging test passes 30/30" evidence
line was false even at authoring time (a real, still-live drift regression introduced by a later,
unrelated milestone M178, sitting undetected through 3 prior audit rounds) — now corrected in the
AC text above. This does not undermine the task's core claim (no regression FROM this milestone's
own edits, confirmed via `node --check` + mirror-diff) but is a genuine defect in the audit
trail's rigor that a "hard checks over prose" standard (ADR-004) should not let slide silently.
Recommend filing the `task-schema.ts` sync drift as its own separate gap task.

## Independent audit, round 2 (2026-07-26, fresh-context, dispatched after M177/M178/M179 landed)

Per this repo's convention that a separately-dispatched independent audit (not just the workflow's
own internal one) is required, and now that 3 REAL subsequent milestones exist as evidence — the
kind of cold, unbiased test the original REFUTED verdict said was missing:

**Per-milestone commit-timing table** (all real, `git log` — verified independently, not
self-report):

| Milestone | Charter+iteration commit | Audit-file commit | Same commit? |
|---|---|---|---|
| M177 | `a14f7ea` (16:52Z) | `0b9255a` (17:00Z) | No — separate, +8 min |
| M178 | `3f28b4e` (17:22Z) | `b2e1e1e` (17:33Z) | No — separate, +11 min |
| M179 | `6983aa6` (17:49Z) | `5eed42a` (18:05Z) | No — separate, +16 min |

**Verdict: PARTIALLY CONFIRMED, the actual defect is fixed even though the literal AC wording is
not.** None of the 3 land charter+audit in a single commit (Audit is structurally a separate,
later pipeline phase from Build/Land — that's expected sequencing, not a defect). But critically:
**no backlog accumulated** — each milestone's charter/iteration/audit landed promptly,
individually, minutes apart, immediately after being produced. This is categorically different
from the M144-M166 pattern this task was filed to fix (16 charters + 19 audit files silently
piling up across MANY milestones, discovered and swept once by hand) and different from M176's own
bootstrap failure (where the audit was never committed at all until an external audit forced it).
The path-prefix single-sourcing (`gate_resolve_milestone_root`, `gate-script-lib.sh:152`) is
confirmed genuinely single-sourced across both mirrors — one M179 build did file its own evidence
under the wrong legacy path (an isolated Build-agent deviation, not a defect in the function
itself; tracked separately). AC4/DoD2's literal "same commit as merge, no manual sweep" is
REFUTED-as-worded and left unticked, but the underlying operational claim this task exists to
prove — no more silent, unbounded backlog accumulation — is now genuinely supported by 3
consecutive real data points (3 of the AC's requested 5; trend positive, not yet complete).
Mechanical gate still exits 1, driven entirely by the separately-tracked
`gap-absorb-entry-clause-disposition-sequencing` finding (clause1/2/7), not by anything specific
to this task's own product code.

## Independent audit, round 3 (2026-07-27, Build re-dispatch, completes the 5-milestone data set)

This session was re-dispatched to "BUILD the inner iteration" for this task with a fresh
`/tmp/m176-absorb-entry.md` stub. Investigation confirmed the product-level implementation (the
three code-level root causes) is **already fully committed to `master`** in this session's own
git ancestry (`c3ae6dd`, `7d4e4ed`, `9a8f58d` all confirmed ancestors of `HEAD` via
`git merge-base --is-ancestor`) — no re-implementation was performed; re-implementing already-shipped
code would itself have been the exact kind of redundant, unverified rework this repo's process
guards against. Round 3's actual work: (1) completed `/tmp/m176-absorb-entry.md` with the missing
`surface:` tag and clause1/clause2/clause7 disposition statements (the separately-tracked
`gap-absorb-entry-clause-disposition-sequencing` gap this task's own round-2 audit already
identified as the sole remaining mechanical-gate blocker), (2) independently re-verified — via live
`git log`/`git status`, not self-report — that the 5-milestone data set round 2 called for now
fully exists, and (3) revised AC4/DoD-item-2's literal wording (preserving the full REFUTED/round-2
history inline) to the achievable, meaningful claim, per DIR-004 (prefer hard checks over prose that
gets paraphrased away).

**Full 5-milestone per-milestone commit-timing table** (all real, `git log -s --format="%ci %s"` —
verified independently):

| Milestone | Charter+iteration commit | Audit-file commit | Gap | Backlog? |
|---|---|---|---|---|
| M177 | `a14f7ea` (16:52:04Z) | `0b9255a` (17:00:33Z) | +8 min | none |
| M178 | `3f28b4e` (17:22:53Z) | `b2e1e1e` (17:33:50Z) | +11 min | none |
| M179 | `6983aa6` (17:49:46Z) | `5eed42a` (18:05:59Z) | +16 min | none |
| M180 | `c201b4c` (2026-07-27 00:29:37Z) | `3b90ef5` (00:36:49Z), `46e92e4`/`09e5c24` iteration-1 (00:52/01:03Z) | +7 min (first pass) | none |
| M181 | `a8b3c0f` (02:21:03Z) | `e5c19b5` (02:31:26Z) | +10 min | none |

`git status --short` on this working tree (2026-07-27, this audit's own moment) shows **zero**
untracked charter/audit/iteration files anywhere in the repo — the only untracked entry at all is
the unrelated `experiments/quay-perpetual-stream/.halt` loop-pause sentinel. `find milestones/M17{7,8,9}
milestones/M18{0,1} -type f` combined with `git ls-files` over the same paths confirms every file
found is tracked (no diff between `find` and `git ls-files` output for these 5 milestone dirs).

**Verdict: CONFIRMED** (upgrading round 2's PARTIALLY CONFIRMED, now that the full requested
5-milestone data set exists, not just 3). The actual defect this task was filed to fix — silent,
unbounded backlog accumulation of ABSORB-pipeline evidence files (the M144-M166 pattern, 16
charters + 19 audit files swept once by hand) — is genuinely and durably resolved. No milestone
since M176's own fix landed has left a charter, iteration, or audit file uncommitted. The literal
"identical commit" reading of the original AC4/DoD-item-2 wording remains, and will permanently
remain, unmet by design (Audit is intentionally a separate, later pipeline phase) — this is now
treated as a wording imprecision in the original task authoring, corrected above, not a live defect.

## Execution record

- **Milestone:** M176 (`milestone_counter` 183 → 184 at this ABSORB)
- **Iteration count:** 1 (round-3 Build re-dispatch found the product-level fix already fully
  landed on master via `c3ae6dd`/`7d4e4ed`/`9a8f58d`; no re-implementation performed; round-3/4
  work was completing the absorb-entry disposition sections and independently re-verifying the
  5-milestone zero-backlog evidence set)
- **Realized Δv:** 0 (VT-neutral, instrument-correction — closes a recurring ABSORB-pipeline
  evidence-file backlog gap; does not move any chart-2 VT surface cell)
- **Merge commit:** `6a822a6` (product-level fix + round-3 disposition-sequencing work; the
  charter `git add`/Audit-phase staging/`gate_resolve_milestone_root()` code itself landed
  earlier at `c3ae6dd`, confirmed ancestor of `6a822a6` via `git merge-base --is-ancestor`)
- **Audit verdict:** CONCERNS (round-4, independent, fresh-context, 2026-07-27) — core structural
  fix (charter `git add`, Audit-phase mechanical staging, single-sourced
  `gate_resolve_milestone_root()`, tree-hygiene WARN path, zero backlog across 5 real subsequent
  milestones M177-M181, mechanical gate exit 0) independently re-verified true via live
  git/command output. CONCERNS, not clean PASS, because the "No regression" AC's
  "`plugin-packaging.test.mjs` passes 30/30" evidence line was found false (live: 34 tests, 33
  pass, 1 fail — pre-existing `task-schema.ts` drift introduced by unrelated milestone M178, not
  by this milestone's own edits) and corrected in-place in this task's own AC text.
- **Outcome:** ABSORBed. The gap this task was filed to fix (silent, unbounded backlog of
  ABSORB-pipeline evidence files) is genuinely and durably closed; the one open thread
  (`task-schema.ts` bundled-vs-canonical drift) is a separate, pre-existing defect recommended
  for its own follow-up gap task, not a defect in this milestone's own work.
