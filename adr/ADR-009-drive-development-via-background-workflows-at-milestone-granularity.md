---
id: ADR-009
title: Drive development via background Claude Code workflows at milestone granularity
status: proposed
date: 2026-07-19
supersedes: []
superseded-by: []
tags:
  - methodology
  - workflow
  - process
---
## Context
Typical development on this repo is already executed by an autonomous outer loop (exp5, `OUTER-LOOP.md`) that builds quay one milestone at a time, run in the background on `master`. This ADR records that operating mode as a first-class decision rather than an incidental fact, so its granularity and hygiene constraints are explicit.

## Decision
Typical development activity is executed through a **Claude Code workflow, run in the background**, with granularity **aligned to a milestone** (one workflow episode ≈ one milestone). Human steering follows DIR-027 hygiene: pause via the `.halt` sentinel, or work in a private worktree off `master` and fast-forward at a clean window — never race the loop on `master`.

<!-- enforcement (E3, deferred): applies-to process; check a milestone's work landed via a workflow episode (worktree merged at ABSORB) rather than an ad-hoc direct commit that bypassed the loop; hard to mechanize fully — reserved -->

## Consequences
- **Forbids:** open-ended, granularity-free background runs that don't bottom out at a milestone boundary; racing the loop on `master`.
- **Enables:** predictable milestone-cadence checkpoints where scheduled e2e (ADR-010) and dark-axis instruments (ADR-007) attach.
- **Scope / relations:** pairs with ADR-010 (scheduled milestone e2e) as the two halves of the milestone cadence; the active phase per ADR-008 determines what the workflow does.
