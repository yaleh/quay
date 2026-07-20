# Charter M46-dir033-worktree-hygiene — DIR-033: wire capture-then-prune
# worktree/branch hygiene into ABSORB (+ fold in DIR-031's sibling wiring gap)

**Milestone id:** M46-dir033-worktree-hygiene · **surface:** method-infra (edits
`experiments/quay-perpetual-stream/OUTER-LOOP.md`'s ABSORB step + `.gitignore`; performs a real
worktree/branch prune; NO product code under `packages/`) · **type:** governance-integrity (primary
— closes the enforcement half of an already-shipped check, the governance/infra hard floor)
**Source:** `DIR-033` (`tasks/DIR-033.md`, human-authored directive, `dirStatus: pending`) →
`exp5-M-DIR033-WORKTREE-HYGIENE` (`tasks/exp5-M-DIR033-WORKTREE-HYGIENE.md`). Also resolves the
identically-shaped sibling gap in `DIR-031` (`tasks/DIR-031.md`).
**Charter authored:** m45→m46 boundary, 2026-07-20. Base commit: `master` HEAD `9c416a0` (SELECT
commit, no out-of-band human commits since m45's ABSORB `7ec534d`).
**Human-steered:** YES (`label:human-steered` on the task) — scope requires editing
`OUTER-LOOP.md` itself, the driver-self-rewrite hazard class the D2/D3/F1 fence names. Executed
under D3's behavior-preserving discipline (the ABSORB step's substance — five conditions, gate
ordering, DoD clauses — is unchanged; only an additive close-out sub-step + evidence format is
added). Not a precedent for future unattended autonomous SELECT of driver-doc edits.
**Nested-subagent constraint (DIR-032/this dispatch's own instruction):** this milestone is itself
running as a dispatched background subagent and CANNOT dispatch further subagents (the
`audit-independence` gate would HARD-fail a self-audit attempt). Steps 0-5 and the non-audit parts
of step 6 are executed directly by this session; the adversarial-audit sub-step is explicitly
deferred to top-level dispatch (see "Note for ABSORB").

## SELECT reasoning
Re-DRAINed the task store directly this pass (`task_list --label directive`,
`task_list --label milestone-candidate --status todo`) rather than trusting the prior pass's
flag verbatim. Confirmed: `DIR-033` is genuinely still `dirStatus: pending`, `label:human-steered`,
with live measured evidence in its own Finding (38 worktrees/branches pre-restart, 1 orphaned M07
report — since independently verified: the M07 report IS present on master today and the hygiene
check IS green, meaning the *check itself* was already shipped pre-restart, commits `d2f350a`/
`800c274` — but the *wiring into ABSORB* and an actual applied prune never happened; 2 iteration
worktrees (M44, M45) and their now-merged branches are dangling on the live tree TODAY).

**Chosen: `exp5-M-DIR033-WORKTREE-HYGIENE`**, over `exp5-M-CRYST-INV` and the standing
crystallization backlog (B4/E2/C1). Value-typed ledger reasoning (full text also on
`tasks/exp5-M-DIR033-WORKTREE-HYGIENE.md` and each compared candidate's own `## Not selected (M46)`):
- **Value type:** governance-integrity (the SAME class as DIR-032/M44 — a shipped-but-unenforced
  mechanism, exactly the DIR-002/DIR-006 pattern the hard floor exists to catch) + a smaller
  risk-option component (un-pruned worktrees compound every milestone if left unaddressed).
- **Governance/infra hard floor (mandatory, applied at SELECT):** DIR-033's own scope already
  covers both halves (check — done; wiring — this milestone), so no rejection/resize was needed;
  DIR-031's sibling gap is folded in explicitly BECAUSE leaving it open after fixing DIR-033 would
  itself be a half-fixed floor violation (same failure shape, same missing half, discovered while
  auditing DIR-033's own state).
- **Watch items weighed (cp-45):** flat VT chart-1 for 10 milestones, declining qualifying rate
  (17.1%→15.0%→13.3%), and a 2nd consecutive zero-exploit 5-window were all real inputs to this
  SELECT — but NONE of them make DIR-033 the wrong pick THIS pass: DIR-033 is governance-integrity,
  not exploit/exploit-vs-explore-typed, so it does not itself extend or shorten the exploit drought;
  deferring it again to chase an exploit-typed pick this pass would repeat exactly the "compensate
  the VT-blind instrument with ad hoc prose deferral" failure `inherited-core.md`'s ledger section
  warns against. No candidate in the live `milestone-candidate --status todo` set is currently
  labeled/typed `exploit` and ready (the CLI-UX/DIRTASK/DOCS candidates are flagged `stale, not
  selected`); an exploit-typed pick is recommended explicitly for m47/m48 once this pass's
  governance debt clears, per this charter's "Note for ABSORB".
- **INV disposition:** compared directly — same governance/infra-floor shape, but forward-looking
  (guards FUTURE rule-additions) vs. DIR-033's present, measured, live drift (`## Not selected (M46)`
  on `tasks/exp5-M-CRYST-INV.md`). B4/E2/C1: no fresh urgency this pass, deferred again with brief
  notes.

## Acceptance Criteria
Mirrors the task's own 4 Acceptance Criteria (`tasks/exp5-M-DIR033-WORKTREE-HYGIENE.md`) exactly:
- [ ] `OUTER-LOOP.md`'s ABSORB step (step 6) states the capture-then-prune close-out (hygiene-check
  run + paste output, worktree remove, branch delete, non-primary-report-capture check) in its own
  text, not by reference only.
- [ ] After this milestone's own ABSORB, `git worktree list | grep -c worktrees/iteration` and the
  merged-iteration-branch count are BOTH reduced to only the current (M46) milestone's entries — the
  M44/M45 dangling worktrees/branches from before this milestone are gone.
- [ ] `scripts/worktree-branch-hygiene-check.sh` output is pasted GREEN in this milestone's own ABSORB
  entry, run AFTER the prune.
- [ ] DIR-031's sibling gap closed alongside: `OUTER-LOOP.md` states the "clean between atomic
  commits" close-out, and `.gitignore` carries the known scratch patterns (`tree-hygiene-check.sh`
  GREEN on the live tree pasted as evidence).

## Definition of Done
References the standard `inherited-core.md` Definition of Done clauses (0 AC/DoD-present
[checklist-aware], 1 per-milestone acceptance audit [UNCONDITIONAL, but see nested-subagent
constraint above — this pass drafts a PENDING placeholder, top-level dispatch completes it], 2
V_meta consolidation-lag, 3 line-budget, 4 impl-row — N/A [this milestone's own output IS the real
landing, not a design doc awaiting a future `-IMPL` row], 5 no-self-exemption, 6 escrow-Δv — N/A
[not design-only], 7 test-floor — **N/A, methodology/design-class, no product code under
`packages/`** [state explicitly at ABSORB, do not silently omit], 8 task canonical-lifecycle-record,
9 split-or-commit [this candidate was NOT split — the wiring + DIR-031 fold-in + one real prune fit
one milestone per the sizing check below]). No task-specific exemption from any clause.

## Value hypothesis
- Value type(s): **governance-integrity** (primary), small **risk/option** (secondary).
- **Δv̂:** no VT chart cell expected (governance/method-infra, same no-VT-cell precedent as the
  DoD-program lineage, DIR-032/M44, DIR-030-cluster milestones M41-43). Value measured directly by
  metric `Y` below, not by a VT delta.
- Metric `Y`: the task's 4 Acceptance Criteria, verbatim — specifically, whether `OUTER-LOOP.md`'s
  ABSORB step states the capture-then-prune + clean-between-commits close-outs, whether a REAL prune
  of the M44/M45 dangling worktrees/branches lands as part of THIS milestone's own ABSORB, and
  whether both hygiene-check scripts are pasted GREEN post-prune.

## Current-state notes (re-verified directly against source at charter-authoring time)
- `scripts/worktree-branch-hygiene-check.sh` and `scripts/tree-hygiene-check.sh` both ALREADY EXIST
  (shipped pre-restart, commits `d2f350a`/`800c274`/`d9e9864`) and both currently exit 0 on the live
  tree (worktree-branch-hygiene: "clean — no orphaned milestone evidence"; informational counts:
  2 prunable merged iteration branches, 2 registered iteration worktrees).
- `git worktree list` today shows exactly 2 registered `worktrees/iteration-0` entries beyond the
  main tree: `M44-dir032-audit-independence/worktrees/iteration-0` (branch
  `m44-dir032-audit-independence-iteration-0`) and `M45-cryst-d1-doc-management/worktrees/iteration-0`
  (branch `m45-cryst-d1-doc-management-iteration-0`) — both already merged into `master` (per M44/M45
  ABSORB commits), so pruning them is pure cruft removal, no drift risk.
- `git cat-file -e master:experiments/quay-perpetual-stream/milestones/M07-vmeta-gate/iterations/
  iteration-0.md` exits 0 — the DIR-033-cited orphan is ALREADY on master (rescued pre-restart).
- `OUTER-LOOP.md`'s ABSORB step (step 6, lines ~237-408) currently has NO capture-then-prune or
  clean-between-commits close-out text — this is the exact gap to fill.
- `.gitignore` currently has NO `*.l-s-backup`/`*.bak`/`*.tmp`/etc. scratch patterns — DIR-031's own
  gap, confirmed via direct grep.

## In scope
1. `OUTER-LOOP.md` ABSORB step (step 6) edit: add an explicit "ABSORB close-out: capture then prune"
   sub-step, textually stating (a) run `worktree-branch-hygiene-check.sh`, paste output; (b) for the
   milestone just merged, `git worktree remove` its iteration worktree(s) + `git branch -d` their
   now-merged branches; (c) verify (don't blindly assume) whether a non-primary iteration's report
   still needs capturing to `master` before pruning its branch. Also add the "clean between atomic
   per-step commits" close-out language (DIR-031 item 2) to the same step-6 area, since both are the
   identical missing-enforcement-half shape.
2. `.gitignore`: add the known scratch patterns (`*.l-s-backup`, `*.bak`, `*.tmp`, `*.orig`, `*.swp`,
   `*.swo`, `*.rej`, `.mutation-backup/`).
3. Real prune: remove the M44 and M45 iteration-0 worktrees (`git worktree remove`) and delete their
   now-merged branches (`git branch -d`); paste before/after `git worktree list`/`git branch` counts.
4. This milestone's OWN worktree/branch, once merged at ITS OWN ABSORB, follows the SAME newly-wired
   close-out (dogfooding the fix on itself) — paste that evidence too.
5. Mark `DIR-033` and `DIR-031` `dirStatus: applied` with a `## Resolution` section on each, citing
   this milestone's ABSORB entry + merge commit SHA.
6. Paste BOTH hygiene-check scripts' GREEN output, run AFTER the prune (not before).

## Explicitly OUT of scope
- Any change to the `worktree-branch-hygiene-check.sh`/`tree-hygiene-check.sh` scripts' internal
  logic (they are already correct and shipped; this milestone wires/exercises them, never
  reimplements or forks a second copy — single-source, per the task's own DoD clause 3).
- Retroactively re-verifying every one of exp4's ~19 `experiment-4-iteration-*` branches or the
  `salvage/exp5-m01-attempt-1` branch (pre-exp5-restart legacy; out of this DIR's own stated scope,
  which is the per-milestone ABSORB close-out going forward).
- Any change to the transcluded/by-reference HARD GATES text itself (unrelated to this directive).
- Picking an exploit-typed candidate this pass (recommended explicitly for m47/m48 instead, per the
  SELECT reasoning above — not this milestone's charge).

## Done-when (binary clauses)
Mirrors the task's 4 Acceptance Criteria exactly (see task file) plus:
1. `grep -n 'capture-then-prune' experiments/quay-perpetual-stream/OUTER-LOOP.md` — paste real output
   showing the new close-out text inside step 6.
2. `git worktree list` and `git branch | grep -c iteration` before/after the prune — paste both real
   outputs, showing the M44/M45 entries gone (and, at THIS milestone's own later ABSORB, this
   milestone's own entries gone too).
3. `bash experiments/quay-perpetual-stream/scripts/worktree-branch-hygiene-check.sh` and
   `bash experiments/quay-perpetual-stream/scripts/tree-hygiene-check.sh` — paste both real GREEN
   outputs, run post-prune.
4. `grep -n 'l-s-backup\|\.bak\|\.tmp' .gitignore` — paste real output showing the patterns present.

## HARD GATES (by-reference — see `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md`
lines 100-131 for the full literal text; both dispatched/executed iteration prompts must include it
verbatim):
GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)
gate-hash-by-reference mode: `it0-gate-hash-check.sh --by-reference` against this charter file, run
immediately before dispatch and re-confirmed unchanged. The manda healthz gate and port-4173
reachability gate are N/A this milestone (no Web UI surface touched) — state N/A explicitly, do not
silently omit.

## it0 checks (run at charter-authoring time, before dispatch)
- `it0-ceiling-check.sh`: N/A — this milestone cites no `gap-list.md` gap/directive ID in the legacy
  sense; source is a live task (`exp5-M-DIR033-WORKTREE-HYGIENE`) and two live directives (`DIR-033`,
  `DIR-031`), both read directly from the task store.
- `it0-ceiling-line-budget-check.sh` against this charter: run before dispatch (see below); small,
  direct-precedent scope (one OUTER-LOOP.md prose addition + one `.gitignore` patch + one real prune
  operation + two directive dispositions, same shape/size class as M39/E3/M43/M44's charters).
- `it0-impl-row-check.sh`: N/A — this milestone's own output is the real-landing proof itself, not a
  design doc.
- Domain-misfit audit-channel: an independent mechanism IS reachable in principle — the adversarial
  audit can independently re-run both hygiene-check scripts against the post-prune live tree and
  independently inspect `git worktree list`/`git branch` counts and the `OUTER-LOOP.md` diff, exactly
  mirroring M38/39/42/43/44's own audit discipline. No misfit.

## Per-milestone acceptance audit (UNCONDITIONAL, `inherited-core.md` Clause 1)
Dispatch a fresh-context, out-of-band adversarial-audit subagent at ABSORB, refute-first stance
against this task's 4 AC clauses + DoD, mirroring M38/39/41/42/43/44's own audit discipline. The
audit should specifically probe: (a) does `OUTER-LOOP.md`'s new close-out text genuinely appear in
step 6 (not just SELECT/charter prose), (b) is the prune REAL — re-run `git worktree list`/
`git branch` independently and confirm the M44/M45 (and this milestone's own) entries are actually
gone, not merely claimed, (c) do both hygiene-check scripts genuinely exit 0 post-prune (re-run
independently), (d) does `.gitignore` genuinely carry the scratch patterns, (e) are DIR-033/DIR-031
genuinely marked `dirStatus: applied` with a real `## Resolution` citing a real commit SHA that
resolves to real content. Per DIR-020/M34's standing write-back mechanism, the audit ticks `- [x]`
on each AC/DoD checklist item it confirms, with an inline evidence citation per item.

**Per THIS pass's explicit instruction (DIR-032/nested-subagent constraint):** this dispatch CANNOT
itself invoke the audit sub-step — no Agent-tool access to spawn a genuinely independent fresh-context
subagent from a nested background-worker context. The ABSORB entry drafted by this pass states the
adversarial-audit verdict as an explicit "PENDING — top-level dispatch" placeholder (same pattern as
M44 `milestones/M44-dir032-audit-independence/audits/iteration-0-acceptance-audit.md` and M45
`milestones/M45-cryst-d1-doc-management/audits/iteration-0-acceptance-audit.md`). `master` is NOT
merged into by this pass; `milestone_counter` is NOT incremented. The top-level session completes the
audit sub-step, the merge, and the counter increment.

## Note for ABSORB
1. Remember the Clause 2 exact-phrase requirement: dashboard text must contain the literal substring
   "V_meta consolidation-lag" (or "V_meta consolidation lag").
2. `it0-dod-check.sh` invocation convention: task id (not milestone id) as the first argument —
   `exp5-M-DIR033-WORKTREE-HYGIENE`.
3. This milestone's ABSORB should invoke `quay gate exp5-M-DIR033-WORKTREE-HYGIENE` as its own DoD
   meta-enforcer check (minus the `audit-independence` clause, per this pass's own hard constraint —
   that gate will correctly refuse a self-audit; it is expected to be re-run and cleared at top-level
   ABSORB, not faked here).
4. Recommend an exploit-typed SELECT at m47/m48 explicitly (cp-45's own flagged watch items: flat VT
   chart-1 for 10 milestones, declining qualifying rate, 2nd consecutive zero-exploit window) — this
   milestone does not itself resolve that watch item, it is orthogonal governance-integrity work.
5. **Checkpoint cadence:** last checkpoint written was cp-45 at m45 (every-5 cadence); next DUE at
   m50 — NOT due at this ABSORB (`milestone_counter` would become 46).
6. `milestone_counter` stays at 45 until top-level ABSORB completes the audit + merge + increment.

## Dispatcher notes
Methodology/design-class (per `inherited-core.md`'s two-class diversity policy — deliverable is a
process/doc substrate edit, not development-class product code): whole-milestone independent
dual-iteration is the standard pattern, but per THIS pass's explicit nested-subagent constraint (no
Agent-tool access to dispatch `baime:iteration-executor`), both "iterations" are executed directly by
this orchestrator in the isolated worktree — iteration-0 builds the deliverable, iteration-1
independently re-derives/verifies it from the same charter in a fresh pass over the same worktree
(re-run both hygiene checks and re-diff `OUTER-LOOP.md` against the charter's stated scope) before
merge-prep, preserving the pattern's intent (independent re-derivation) even without a second
subagent dispatch. State explicitly in the milestone report which pattern was used and why (mirrors
M41/42/43/44's own precedent under the same constraint).
