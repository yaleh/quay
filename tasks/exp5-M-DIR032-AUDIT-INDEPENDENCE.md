---
id: exp5-M-DIR032-AUDIT-INDEPENDENCE
title: "DIR-032: generic-vehicle OUTER-LOOP audit dispatch + machine-checkable audit-independence
  HARD gate (close both halves together, per SELECT's governance/infra hard floor)"
status: todo
labels:
  - milestone-candidate
  - governance-integrity
  - human-steered
  - milestone:M44-dir032-audit-independence
parent: null
children: []
extra:
  schema: "v1"
---
## Human-steered classification (self-declared at authoring time)
This candidate is labeled `human-steered` (like D2/D3/F1) because its scope requires editing
`experiments/quay-perpetual-stream/OUTER-LOOP.md` itself — the driver document — which is exactly
the driver-self-rewrite bootstrap hazard `OUTER-LOOP.md` step 1's fence exists to exclude from
*autonomous* SELECT. It is being executed here under **explicit human direction** (this pass was
dispatched by name, at human request, to resolve DIR-032), applying the **same discipline the fence
names as the one exception** — "the D3 behavior-preserving + golden-replay discipline": a small,
purely-additive/behavior-preserving edit (naming a different subagent vehicle in one prose block;
no change to the surrounding gate-hash-checked HARD GATES text) + a new, independently fixture-pinned
mechanical check, verified before merge, never silently absorbed into a normal autonomous SELECT
pass. A human must clear/remove this label for any FUTURE autonomous SELECT to pick this task up
again on its own; it is not being un-fenced as a precedent for other human-steered candidates.

## Proposal
Resolve DIR-032 in full, as ONE milestone covering BOTH of its requested-action halves together
(the SELECT governance/infra hard floor: a governance/infra candidate whose scope excludes its own
enabling/enforcement half must be rejected or resized, never dispatched partial — this is exactly
the DIR-002/DIR-006 "declared but not enforced" failure DIR-032 itself would repeat if only the doc
half or only the gate half were scoped):

1. **Enabling half (doc fix).** Edit `experiments/quay-perpetual-stream/OUTER-LOOP.md` §6 (the
   per-milestone acceptance-audit block) so it no longer names `baime:iteration-executor` as the
   audit vehicle. State explicitly: the audit MUST be dispatched by the **top-level loop session**
   (where the Agent tool is available, not a nested nested-subagent context) as a fresh-context
   generic `Explore`/`general-purpose` subagent; inability to dispatch a genuinely independent
   subagent is a **BLOCKING condition**, never a license to fall back to same-context self-audit.
2. **Enforcement half (mechanical gate).** Build `scripts/audit-independence-check.mjs`: given an
   audit artifact (e.g. `milestones/M<NN>/audits/*.md` plus a recorded session/agent id), it exits 1
   when that id is ABSENT or EQUALS the orchestrator/dispatching session's own id (self-audit —
   including the M41/M42/M43 self-audit shape, DEV-06/07/08), and exits 0 when a DISTINCT
   independent id is present. RED-then-GREEN fixtures pin both directions (ADR-001 TDD). Wire it
   into the ABSORB gate set (a new named engine gate, e.g. `audit-independence`, same
   `makeIt0Gate`-style thin-wrap pattern as `vmeta-lag`/`dogfood-evidence`, M39/M43 precedent) so a
   self-audit HARD-BLOCKS `milestone_counter++`, not prose-only.
3. **Retro-flag confirmation.** M41/M42/M43 are already flagged as self-audited (DEV-06/07/08 in
   `inherited-core.md`'s Deviation-record-schema table, done at M43 ABSORB) — this milestone does
   NOT re-do that (avoid duplicating M43's disposition); it only needs to confirm the rows still
   stand and that the dashboard's deviation table is the single source (no new duplicate rows).

Both halves are a small, tightly-scoped unit (one doc-section edit + one thin `scripts/*.mjs` +
fixtures + one registry wire-up) — sized to land in a single milestone pass, satisfying the hard
floor without needing a further split.

## Plan
N/A — no staged `docs/plans/*.md` warranted: this is a documented protocol-file edit + one small
new script module (TDD, RED-then-GREEN fixtures) + a thin `registry.js` gate wrapper, directly
analogous to the already-landed `vmeta-lag`/`dogfood-evidence` gates (M43) and `adr-001` gate (M42)
— reuse their factory pattern, no new design needed.

## Acceptance Criteria
- [ ] `grep -n 'baime:iteration-executor' experiments/quay-perpetual-stream/OUTER-LOOP.md` returns NO
      line inside the §6 acceptance-audit block; that block instead names a generic `Explore`/
      `general-purpose` subagent, states the audit is dispatched by the TOP-LEVEL loop session, and
      states inability-to-dispatch is BLOCKING (not a license to self-audit).
- [ ] `scripts/audit-independence-check.mjs` exits 1 against a RED fixture shaped like the real
      M41/M42/M43 self-audit artifacts (session/agent id absent or equal to the orchestrator's) and
      exits 0 against a GREEN fixture carrying a distinct independent id; both fixtures committed
      under this script's own test/fixture directory.
- [ ] The check is registered as a named engine gate (`quay gate --list` includes it) and wired into
      the ABSORB gate sequence so a self-audit HARD-BLOCKS `milestone_counter++` — demonstrated by
      running it for real against this milestone's own audit artifact.
- [ ] The dashboard's Deviation-record-schema DEV-06/07/08 rows are confirmed still present and are
      the single source (no duplicate second table created by this milestone).

## Definition of Done
References the standard inherited-core DoD clauses (0-9); the bar is REAL LANDING, not artifacts —
a script existing / a fixture green / a doc edited are necessary but NOT sufficient:
- [ ] A REAL milestone's ABSORB (this one, or the very next one after it) actually dispatches a
      genuinely independent fresh-context audit (distinct session/agent id, generic agent) AND the
      `audit-independence` gate runs at that real ABSORB and PASSES on the real artifact — durable
      GateEvent in `quay gate-log --json`, pasted into the ABSORB entry.
- [ ] The gate HARD-FAILS a real self-audit attempt, demonstrated at least once against an
      M41/M42/M43-style self-audit artifact as the RED fixture (proves the silent-degradation hole
      is closed, not merely designed).
- [ ] Single-source: the independence-check logic lives once, wrapped by exactly one named gate;
      `baime:iteration-executor` no longer named as the audit vehicle anywhere in `OUTER-LOOP.md`;
      DIR-027 (loop directly on `master`) is preserved, not reversed.
- [ ] If this milestone's OWN ABSORB cannot itself obtain a genuinely independent dispatch (the same
      nested-session constraint DIR-032 diagnoses), the doc+gate build still lands for real this
      pass, and the FIRST REAL independent-audit proof is deferred explicitly to the top-level
      session's next dispatch — NOT silently treated as already proven.
