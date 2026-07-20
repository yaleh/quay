---
id: DIR-036-B
title: "DIR-036 child B (Level 3 — application): the single-sourced methodology
  kit drives ONE real OUTER-LOOP milestone DEVELOPING archguard, DoD-audited by
  it0-dod-check keyed to that real foreign-repo milestone (the V_meta transfer
  test) — depends on DIR-036-A"
status: todo
labels:
  - directive
  - human-steered
parent: DIR-036
children: []
extra:
  dirStatus: pending
  schema: v1
  authorized: "2026-07-20 (human): APPROVED. Executed THROUGH [[DIR-045]]'s
    real-landing (the loop-executable formalized driver skill, whose DoD
    literally IS 'drive a real archguard iteration from a params file') — NOT a
    separate human bootstrap and NOT directly loop-SELECTable: the exp5 loop
    develops quay on master and CANNOT develop archguard directly (the
    bootstrapping paradox), so DIR-036-B stays human-steered while its execution
    is delegated to DIR-045. Audit 口径 = [[DIR-042-A]]'s runner-agnostic gate set
    (archguard's vitest as .quay/gates.yml DATA), NOT a full it0 port
    (SUPERSEDED). Residual human step: the coexistence decision (pause
    archguard's Backlog.md loop: touch backlog/.loop-stop). SATISFIED when
    DIR-045's archguard real-landing produces a real archguard diff + a
    DIR-042-A gate PASS gated IN the worktree (needs [[DIR-046]]). A rough first
    instance already ran hand-driven (meta-cc 8b74052c) but does NOT satisfy the
    DoD (hand-prompt not skill, gate ran in the wrong tree, work left on a
    branch)."
  blockedBy: "DIR-045 (execution vehicle: its real-landing drives archguard) +
    DIR-046 (gate-cwd, so the audit validates the worktree). DIR-040/041 done;
    the it0-port requirement is SUPERSEDED by DIR-042-A."
---
## Proposal
Level 3 of ADR-013's Validation Ladder — the methodology KIT (single-sourced at [[DIR-035-D]]) drives ONE real OUTER-LOOP milestone DEVELOPING archguard, DoD-audited by the it0 meta-enforcer. This is the **V_meta transfer test**: the loop's methodology, moved off quay's own repo, produces a real code milestone on a foreign product. The loop's `V_meta` has never had an external gradient — every prior milestone developed quay itself; this is the first time the methodology is measured against a repo it did not grow up in. Depends on [[DIR-036-A]] (product deployed on archguard first). Child of [[DIR-036]].

## Plan
N/A — resolved via an archguard-development milestone.

## Finding
The kit is single-sourced and versioned ([[DIR-035-D]] / M52 audit PASS: exactly one live `inherited-core.md`, SHA-pinned "Kit version" section) — droppable into a new project as one unit. What has never happened: the kit driving a real milestone on a repo that is NOT quay. That is the actual `V_meta` external gradient the 2026-07-20 evaluation calls for (the successor value source to exp5's saturated inward VT).

> **Execution + audit口径 reconciled 2026-07-20 (from the real archguard iteration, meta-cc `8b74052c`):** DIR-036-B is executed THROUGH [[DIR-045]]'s real-landing (the loop-executable formalized driver skill drives a real archguard iteration from a params file) — NOT a separate human bootstrap, and NOT directly loop-SELECTable (the exp5 loop develops quay on master; it cannot develop archguard directly — the bootstrapping paradox). The DoD audit is **[[DIR-042-A]]'s runner-agnostic gate set** (archguard's vitest as `.quay/gates.yml` DATA), gated IN the worktree ([[DIR-046]]) — **NOT a full it0-dod-check port (SUPERSEDED)**. Residual human step: the coexistence pause (`touch backlog/.loop-stop`). References to `it0-dod-check` below read as "the DIR-042-A runner-agnostic gate."

## Requested action
1. Stand up a NEW archguard-development experiment dir whose methodology IS the single-sourced kit (a kit-version pin, NOT a copied `inherited-core.md`) — via [[DIR-045]]'s driver + `.quay/loop.yml` params, not a hand-written prompt.
2. Run ONE real OUTER-LOOP milestone on archguard: SELECT → build a real archguard code change → DoD-audit via the [[DIR-042-A]] runner-agnostic gate (archguard's vitest via `gates.yml`), gated in the worktree ([[DIR-046]]), keyed to that milestone.
3. Record the milestone + its `it0-dod-check` GateEvent under the archguard experiment.

## Acceptance Criteria
- [ ] A NEW archguard-development experiment dir exists whose methodology is the single-sourced kit (a kit-version pin, NOT a duplicated `inherited-core.md`) — `grep -rl 'inherited-core' <archguard experiment>` shows a version pin/reference, not a second full copy.
- [ ] One real archguard code milestone was driven end-to-end by the kit, producing a REAL diff on archguard (commit/PR id captured in the record).
- [ ] `it0-dod-check` (the kit's DoD meta-enforcer) ran and PASSed keyed to that milestone, evidenced by a GateEvent / engine-written status referencing the real archguard milestone id.

## Definition of Done
Bar is REAL LANDING. A milestone dir / a passing fixture are necessary-not-sufficient. Done ONLY when:
- [ ] A REAL archguard code change (a real diff on archguard, not quay) was produced by a kit-driven milestone — durable evidence: the archguard commit/PR + the milestone record.
- [ ] The DoD audit ran on that REAL milestone (`it0-dod-check` GateEvent keyed to it), not on a fixture.
- [ ] The kit was consumed as the single-sourced unit (no per-experiment `inherited-core` duplication reintroduced) — else [[DIR-035-D]] is regressed.
- [ ] Per DIR-026: lands done or `needs-human`.

## Human verification when exp5 marks this done
1. Is there a real archguard diff/commit produced by a kit-driven milestone (not a quay-repo milestone, not a demo)?
2. Did `it0-dod-check` run keyed to THAT milestone with a real GateEvent?
3. Was the kit dropped in as one versioned unit (no duplicated `inherited-core`)?
4. If only an experiment dir exists but no real archguard code shipped through the loop → NOT landed, send back.