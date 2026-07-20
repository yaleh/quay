---
id: ADR-011
title: Enforcement lands WITH design — no new rule/clause/method-step is done
  without its executable enforcement + fixture in the same milestone (no phased
  deferral)
status: accepted
date: 2026-07-20
tags:
  - methodology
  - enforcement
---
## Context
The cross-experiment ANALYSIS found the #1 recurring structural fault is a single thing wearing three masks: **designed-not-wired**, **form-vs-substance dilution**, and **phased-deferral**. A rule/clause/step is written as prose or "designed," and its enforcement is deferred to "later" — where it is paraphrased away, never wired, or shelved indefinitely (exp4's worktree-isolation rule diluted 13×; exp5's DIR-014 shelfware for 25 milestones). This is the timing-specific corollary of ADR-004 (hard-over-soft): ADR-004 says load-bearing rules must be *executable*; this ADR says the executable enforcement must land **at the same time as the design**, never phased.

## Decision
A new rule / DoD-clause / method-step is **NOT "done" unless its executable enforcement (a gate/check/code) AND a fixture that proves it land in the SAME milestone.** Phased "design now, wire the enforcement later" is prohibited — a design without its landed enforcement is `pending`, not done (this is DIR-026's "a slice is not done" applied to method changes). "Necessary but not sufficient": a passing fixture is necessary; the enforcement operating on a real object is what makes it done.

## Consequences
- **Forbids:** accepting a design-only new rule/clause; deferring its gate to a follow-up milestone; marking a method change done on the strength of prose alone.
- **Enabled/partially enforced today:** it0-dod-check Clause 5 (no-self-exemption), the DoD real-landing bar, and the B7 load-bearing-test-gate each catch a slice of this. The **full** mechanical gate — one that HARD-blocks a milestone adding a new rule/clause without a matching enforcement+fixture — is the remaining deliverable, tracked as `exp5-M-CRYST-INV`.
- **Scope:** governs every future milestone from restart; folded into `inherited-core.md` so the loop operates under it. Sharper-timing corollary of ADR-004 (see also ADR-003 dilution, DIR-026 item 5).
<!-- enforcement (INV, deferred): applies-to method-changes; a gate that fails a milestone which adds a rule/clause with no matching executable enforcement+fixture. Tracked as exp5-M-CRYST-INV. -->
