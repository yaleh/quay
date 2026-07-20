---
id: exp5-M-DIR033-WORKTREE-HYGIENE
title: "DIR-033: wire capture-then-prune worktree/branch hygiene into ABSORB
  (governance/infra hard floor — the enforcement half of an already-shipped
  check)"
status: done
labels:
  - milestone-candidate
  - governance-integrity
  - human-steered
  - milestone:M46-dir033-worktree-hygiene
parent: null
children: []
extra:
  schema: v1
  dirStatus: n/a
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-M-DIR033-WORKTREE-HYGIENE
    experiments/quay-perpetual-stream/charters/M46-dir033-worktree-hygiene.md
    /tmp/m46-absorb-entry.md
  auditIndependenceArgs:
    - --orchestrator-id
    - m46-inner-worker-builder-session
    - /tmp/m46-absorb-entry.md
---
## Proposal
DIR-033's mechanical check (`scripts/worktree-branch-hygiene-check.sh`) and the M07-orphan rescue
were already shipped pre-restart (commits `d2f350a`/`800c274`) and the live gate is GREEN today
(0 orphaned evidence). What remains — the governance/infra hard floor's own enforcement half,
per `inherited-core.md`'s "Value-typed SELECT ledger" section — is that the check is NOT wired
into `OUTER-LOOP.md`'s ABSORB step, and the loop has never actually PERFORMED a capture-then-prune
close-out on a real milestone: right now `git worktree list` still carries 2 registered
`worktrees/iteration-0` entries (M44, M45) and `git branch` still carries their 2 now-merged
iteration branches, un-pruned. This milestone:
1. Adds an explicit "ABSORB close-out: capture then prune" sub-step to `OUTER-LOOP.md`'s ABSORB
   section (step 6), stating: after the merge lands, (a) run `worktree-branch-hygiene-check.sh` and
   paste its output; (b) for the milestone just merged, `git worktree remove` its iteration
   worktree(s) and `git branch -d` their now-merged branches; (c) if a non-primary iteration's report
   is not yet on `master`, cherry-pick just that evidence file first (this pass has none — both M44
   and M45 iteration-0 were dual-run-then-merged/primary already captured; verify explicitly).
2. Performs the FIRST real application of that close-out against the two currently-dangling
   milestones (M44, M45) as part of THIS milestone's own ABSORB, proving the wiring operates on real
   state, not just a fixture.
3. Also folds in DIR-031's sibling wiring gap (identical shape, same governance/infra hard floor,
   already-shipped `tree-hygiene-check.sh` never wired into `OUTER-LOOP.md`): add the "tree stays
   clean between atomic per-step commits" close-out language + gitignore the known scratch patterns
   (`*.l-s-backup`, `*.bak`, `*.tmp`, `*.orig`, `*.swp`, `*.rej`, `.mutation-backup/`), since both
   DIRs are enforcement-half-missing instances of the exact same floor and DIR-031 is a named sibling
   of DIR-033 in its own body text — resolving them together avoids re-opening the identical wiring
   gap twice.

## Plan
N/A — a documentation/process-substrate edit (OUTER-LOOP.md ABSORB section) + a `.gitignore` patch +
a real one-time worktree/branch prune; no staged `docs/plans/*.md` doc warranted (methodology/design
class, per `inherited-core.md`'s two-class diversity policy — not development-class product code).

## Acceptance Criteria
- [x] `OUTER-LOOP.md`'s ABSORB step (step 6) states the capture-then-prune close-out (hygiene-check
      run + paste output, worktree remove, branch delete, non-primary-report-capture check) in its
      own text, not by reference only.
- [x] After this milestone's own ABSORB, `git worktree list | grep -c worktrees/iteration` and the
      merged-iteration-branch count are BOTH reduced to only the current (M46) milestone's entries —
      the M44/M45 dangling worktrees/branches from before this milestone are gone.
- [x] `scripts/worktree-branch-hygiene-check.sh` output is pasted GREEN in this milestone's own ABSORB
      entry, run AFTER the prune (proving the close-out and the check compose, not just that the
      check alone is green).
- [x] DIR-031's sibling gap closed alongside: `OUTER-LOOP.md` states the "clean between atomic
      commits" close-out, and `.gitignore` carries the known scratch patterns
      (`tree-hygiene-check.sh` GREEN on the live tree pasted as evidence).

## Definition of Done
References the standard inherited-core DoD clauses (Clauses 0-9, `it0-dod-check.mjs`). Real landing,
not artifacts-only:
- [x] The wiring is exercised on THIS real milestone's ABSORB (not merely stated in prose) — the
      worktree/branch counts before/after are pasted as evidence, and the hygiene-check outputs
      (both `worktree-branch-hygiene-check.sh` and `tree-hygiene-check.sh`) are pasted GREEN,
      post-prune.
- [x] DIR-033 and DIR-031 are both marked `dirStatus: applied` on their own task files with a
      `## Resolution` section citing this milestone's ABSORB entry + commit SHA, per OUTER-LOOP.md
      step 0's directive-disposition discipline. **(Corrected in this corrective pass, 2026-07-20,
      after an independent audit returned REFUTED against the record — see
      `audits/iteration-0-acceptance-audit.md`.)**
- [x] No dual source: the hygiene logic stays exactly where it already lives (the two `.sh` scripts,
      unmodified in logic — only the wiring/gitignore/OUTER-LOOP.md text change), never duplicated
      inline into OUTER-LOOP.md itself.
