# DIR-027

- status: applied (executed in the same human-directed pass that filed it — see "## Resolution")
- created_by: human (Yale Huang), asserted directly in this live conversation
- created_at: 2026-07-19
- title: Retire the DIR-018 driver-branch isolation — run exp5 DIRECTLY on `master`; delete `exp5-outer-driver` and remove OUTER-LOOP.md's master↔driver DRAIN/publish sub-steps and the off-driver iteration-worktree base point

## Finding

DIR-018 (M23-outer-driver-isolation) put the autonomous loop on a dedicated
`exp5-outer-driver` branch, publishing to `master` only at deliberate ABSORB merge
points, so human commits on `master` would not race the loop. In practice, under
heavy human steering, this isolation did **not** prevent the human/loop race — it
RELOCATED it into a stranded-branch reconciliation:

- While the loop was paused mid-`M41` (implementing DIR-025) on the driver, a
  parallel human effort implemented and landed the same DIR-025 area on `master`.
  M41's real work ended up **stranded on branches based on a stale driver base**,
  conflicting with the concurrent human edits — recoverable only by harvesting M41's
  correct pieces onto `master` (see DIR-025's Resolution), not by a clean merge.
- The driver also drifted **6 commits behind `master`** during a single human-steered
  session, and its only in-flight state (`M41`) became moot once the human closed
  DIR-025 first.
- The isolation's own working-tree half was never built anyway (DIR-018 item 4 was an
  explicit non-goal; DIR-019 item 5 flagged the gap): the loop still shared the main
  working tree, so a human serving `quay serve` from the main tree saw the driver's
  (stale) task bodies, not `master`'s — a live confusion this session actually hit.

Net: for the current, heavily human-steered mode, the driver model adds a
DRAIN/publish merge dance and a stale-base stranding hazard without delivering the
race-freedom it promised. Consolidating onto `master` is simpler and removes the
class of confusion above.

## Requested action

1. **Delete the `exp5-outer-driver` branch** (its only unmerged state was `M41`,
   already harvested to `master` per DIR-025; it holds nothing else valuable).
2. **Check out `master` in the main working tree** so on-disk state (incl. `tasks/`)
   matches the canonical branch — fixing the "serve shows stale bodies" confusion.
3. **Remove OUTER-LOOP.md's driver sub-steps**, replacing them with "work directly on
   `master`": (a) step 0's "Master → driver merge" DRAIN sub-step, (b) step 5a's
   "iteration worktrees off `exp5-outer-driver` HEAD" base point → off `master` HEAD,
   (c) step 6/7's "Driver → master publish" sub-step. Per-iteration work still happens
   in isolated `milestones/M<NN>/worktrees/iteration-{0,1}` worktrees (that isolation
   is unchanged and independent of the driver model) — only the driver INTEGRATION
   branch is removed; iterations now branch off and merge into `master` directly.
4. **Do NOT rewrite historical driver references** in `dashboard.md`'s log entries
   (they record what actually happened — leave them).
5. **Human-steering hygiene going forward (replaces the isolation it removes):** since
   there is no longer a branch buffer, prefer pausing the loop (`.halt`) OR using a
   private worktree off `master` for any human edit while the loop runs — the same
   race-free pattern DIR-018/DIR-019 already documented for human commits, now the
   primary discipline rather than the branch isolation.

## Acceptance Criteria (runnable)
- [x] `git branch --list exp5-outer-driver` is EMPTY (branch deleted).
- [x] `git branch --show-current` in the main tree is `master`, and
  `grep -c '## Finding' tasks/DIR-021.md` is ≥1 (on-disk tasks match master, not the
  stale driver body).
- [x] `grep -nE "exp5-outer-driver" experiments/quay-perpetual-stream/OUTER-LOOP.md`
  returns NO operative sub-step referencing the driver as the loop's base/integration
  branch (only, at most, a historical "DIR-018 retired by DIR-027" note).
- [x] `git worktree list | grep -c exp5-outer-driver` is 0 (no driver worktree).

## Definition of Done — REAL LANDING is the bar, not artifacts

Reading A preserved (DIR-026): a doc edit is necessary-not-sufficient. This is done
when the model is ACTUALLY consolidated: the driver branch is gone, the main tree is on
`master`, OUTER-LOOP.md no longer instructs the loop to use a driver branch, and — the
real-landing proof — **the next milestone the loop (or a human-driven milestone) runs
after this does so DIRECTLY on `master`** with its iteration worktrees based off
`master` and its ABSORB landing on `master` with no driver merge, verifiable by that
milestone's own git provenance (no `exp5-outer-driver` in its branch/merge graph). The
process changes (items 1-3) land now; the real-landing clause is confirmed by the first
post-consolidation milestone. Escrow: this DIR's `status` may read `applied` for the
executed process change, but the first-milestone-on-master confirmation is the standing
check a reviewer should run before trusting the consolidation held.

## Human verification when exp5 marks this DIR done
1. `git branch --list exp5-outer-driver` empty; `git branch --show-current` = `master`.
2. `grep exp5-outer-driver OUTER-LOOP.md` shows no operative driver base/integration
   instruction (historical note OK).
3. The first milestone after this: its iteration worktrees branch off `master` and its
   ABSORB merge lands on `master` — no driver branch anywhere in its provenance.
4. If a driver branch reappears or OUTER-LOOP still routes the loop through one, it is
   NOT landed — send back.

## Resolution
- resolved_by: this human-directed pass (2026-07-19) — the user authorized deleting the
  driver and continuing exp5 on `master` directly.
- outcome: applied — items 1 (driver deleted), 2 (main tree on `master`), 3 (OUTER-LOOP
  driver sub-steps removed), 4 (dashboard history left intact), 5 (human-steering
  hygiene noted) all executed in this pass. The first post-consolidation milestone
  confirms the real-landing clause (loop runs on `master`).
- evidence: this commit (driver deletion + OUTER-LOOP.md edits + this DIR); DIR-025's
  own Resolution (the M41 stranding that motivated retiring the driver).
