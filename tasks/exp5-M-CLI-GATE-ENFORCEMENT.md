---
id: exp5-M-CLI-GATE-ENFORCEMENT
title: "quay task edit --status: decide and implement whether the CLI write
  path should itself enforce the task check gate, or explicitly document it
  as an unguarded setter (Skill-level discipline only)"
status: done
labels:
  - milestone-candidate
  - surface:cli
  - milestone:M31-cli-gate-enforcement
extra: {}
---
## Forward-looking candidate provenance
Forward-looking milestone-candidate task, created at m28 DRAIN/SELECT boundary (2026-07-18) once
the standing backlog (all 20 prior milestone-candidate rows DONE/STALE, DIR-001 fully closed)
was exhausted — mirrors the M24-task-backlog-projection-impl forward-looking-creation pattern.

## Source
M28-outcome-eval outcome-eval-report.md, Scenario 3, gap G-S3-01 (found by iteration-0;
iteration-1 independently hit the identical failure mode live during its own Scenario 3 attempt,
self-caught and redone — see that report's Scenario 3 section).

## Value type / cadence
governance-integrity (primary — this is the same "gate is both contestant and judge" class already
self-documented in the `quay:author`/`quay:execute` Skills' own "Gaps" sections, now confirmed to
have a CLI-level instance too), exploit (secondary), method infra, VT points likely small/zero —
this is a correctness/enforcement question, not a new capability.

## Notes (verbatim provenance from M28's outcome-eval-report.md)
`quay task edit --status <x>` does NOT enforce the `task check` gate — it silently succeeds even
when the target status transition's gate conditions (missing artifacts, unchecked AC boxes, etc.)
are not met, because `task edit` is a raw unguarded status setter; gate enforcement is currently
Skill-level process discipline only, not CLI-level. This means ANY caller — human, or an agent
following `quay:author`/`quay:execute` Skill discipline but making a mistake — can bypass
`task check` silently. Confirmed live in BOTH M28 iterations: iteration-0 found it directly (see
that report's Scenario 3 section); iteration-1 independently made the identical mistake on its own
first attempt at the same scenario, caught it, discarded the improperly-driven fixture, and redid
the scenario cleanly (documented in iteration-1's own "skepticism self-report" as evidence of
genuine, non-rubber-stamp engagement).

This is a genuine product-design question, not a straightforward bug fix: a future charter
selecting this candidate must first decide (and record the decision, with reasoning) whether:
(a) the CLI write path (`task edit --status`) should itself call the same gate-check logic as
`task check` and refuse an ungated transition (the stricter fix, but changes existing CLI
semantics — any script relying on `task edit`'s current unguarded-setter behavior would break); or
(b) the current behavior is intentional-by-design (CLI as a low-level primitive, gate enforcement
deliberately left to the Skill layer, mirroring how `git commit --no-verify` deliberately allows
bypassing hooks) and should instead be more prominently documented as such, with a `--force`-style
explicit flag required for any future "guarded by default" mode; or
(c) some middle ground — a warning/confirmation prompt on ungated transitions, without a hard
block.
Given this is a design decision with real backwards-compatibility implications, this is an
`explore`-flavored charter component even though the surface itself (CLI) is well-understood.

## Status mirror
done (ABSORBed @m31, 2026-07-19 — decision (b) implemented: `task edit --status` stays an
unguarded-by-default low-level primitive, new opt-in `--enforce-gate` flag reuses `client.taskCheck`
(the same logic `task check` calls) rather than duplicating gate logic. Merged to `exp5-outer-driver`
at `8b3af67`. Adversarial audit verdict: NO REFUTATION FOUND, one non-blocking CONCERNS item (missing
automated test coverage for the combined `--append-notes`+`--status`+`--enforce-gate` path, closed
manually by the audit's live probes). Realized Δv=0 (governance-integrity, no VT chart cell). Full
details: `dashboard.md`'s "ABSORB m31" entry;
`experiments/quay-perpetual-stream/milestones/M31-cli-gate-enforcement/audits/adversarial-audit.md`.)

---
## Not selected (M29)
2026-07-18: Not selected — M-QUAY-CLI-CREATE-ERGONOMICS chosen instead (GAP-002 severity). This
candidate also needs more design deliberation before charter-ready (a genuine product-design
decision with backwards-compatibility implications, not a mechanical fix — see its own Notes
section options (a)/(b)/(c)); recommend a future SELECT pass settle the design question at
charter-authoring time rather than rushing a default.
