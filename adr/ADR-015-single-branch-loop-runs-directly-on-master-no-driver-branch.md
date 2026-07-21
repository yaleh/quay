---
id: ADR-015
title: "SINGLE-BRANCH: exp5 loop runs directly on master — no driver branch; per-milestone
  work in iteration worktrees off master; human-steering hygiene via .halt or private worktree"
status: accepted
date: 2026-07-21
tags:
  - process
  - methodology
  - git
applies-to:
  - "experiments/quay-perpetual-stream/OUTER-LOOP.md"
  - "experiments/quay-perpetual-stream/inherited-core.md"
  - "tasks/DIR-027.md"
enforcement: "N/A — human-steering hygiene discipline; the absence of an exp5-outer-driver branch is observable via `git branch --list exp5-outer-driver` (empty = compliant) but is not mechanically gated per-milestone"
---
## Context

DIR-018 (M23) put the autonomous loop on a dedicated `exp5-outer-driver` branch to isolate
human commits on `master` from the loop's in-flight state. In practice this isolation did not
prevent the human/loop race — it relocated the conflict into stranded-branch reconciliation:

- During heavy human steering mid-M41 (implementing DIR-025), a parallel human effort
  landed the same work on `master` while the loop's iteration was based on a stale driver.
  M41's work was stranded on a conflicting base, recoverable only by cherry-picking onto
  `master`, not a clean merge.
- The driver drifted 6 commits behind `master` within a single human-steered session.
- The working-tree half of the isolation (DIR-018 item 4) was never built — the loop and
  human shared the main working tree, so `quay serve` showed the driver's stale task
  bodies, not `master`'s.

Net: in a heavily human-steered mode, the driver branch added a DRAIN/publish merge dance and
a stale-base stranding hazard without delivering the race-freedom it promised. DIR-027 retired
it.

## Decision

1. **The exp5 loop runs directly on `master`.** There is no integration branch (the
   `exp5-outer-driver` branch is deleted and must not be recreated). The canonical loop
   state is always `master`.

2. **Per-milestone work in iteration worktrees.** Each milestone's development work still
   happens in isolated `milestones/M<NN>/worktrees/iteration-{0,1}` worktrees branched off
   `master` HEAD; ABSORB merges them back to `master`. This per-milestone worktree isolation
   is unchanged and independent of the (now-retired) driver model.

3. **Human-steering hygiene (replaces the branch isolation).** Since there is no longer a
   branch buffer, the primary race-prevention discipline is: (a) pause the loop via the
   `.halt` sentinel (`experiments/quay-perpetual-stream/.halt`) before any human edit that
   touches the loop's domain; OR (b) work in a private git worktree off `master` and
   fast-forward at a clean window. Never race the loop on `master` directly.

4. **Historical records preserved.** `dashboard.md` log entries referencing the prior driver
   model are left intact (they record what actually happened); only operative OUTER-LOOP.md
   instructions were updated.

## Consequences

- **Forbids:** recreating an `exp5-outer-driver` integration branch; routing loop iterations
  off any branch other than `master`; editorial history rewrites in `dashboard.md`.
- **Enables:** simpler git topology (one integration point); human edits always see the same
  `tasks/` state the loop sees; the DRAIN/publish merge dance is eliminated.
- **Enforcement:** N/A for mechanical per-milestone gating. Compliance is observable: after
  any milestone ABSORB, `git branch --list exp5-outer-driver` must be empty and the merge
  commit's parent must be `master`. Human-steering hygiene is a process discipline, not an
  automated check — the `.halt` sentinel and the worktree pattern are the operational tools.
- **Source:** canonical decision is THIS ADR; DIR-027 (tasks/DIR-027.md) is the originating
  directive and points here. See [[DIR-027]] for the full finding + evidence.
