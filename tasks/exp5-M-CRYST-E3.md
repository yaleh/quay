---
id: exp5-M-CRYST-E3
title: E3 adr-as-contract enforcement — applies-to scope + runnable check as a
  named adr-<id> quay gate (the 'continuously applied' half of E1)
status: done
labels:
  - milestone-candidate
  - crystallization
  - milestone:M42-cryst-e3
parent: exp5-M-CRYST
children: []
extra:
  schema: v1
---
## Proposal
E1 made ADRs a first-class STORED kind but explicitly deferred the "continuously applied" half — the piece that makes an ADR a standing constraint, not a static record. E3 builds it (it currently lives only as prose in ADR-001 / E1 / strategy §10, which by our own ADR-DILUTION standard is molten — this task pins it).

Mechanism (epicd's ADR-as-contract harness, which quay's gate engine can actually deliver — epicd left it a proposal): an ADR gains an `applies-to` scope + an `enforcement` field naming a runnable check. An enforceable ADR registers as a **named `adr-<id>` quay gate** via the QENG registry (`packages/quay/src/gate/registry.js` — same wrap-a-script mechanism as `acceptance`/`impl-row`/`line-budget`, no logic duplicated). Its GateEvents become the **"ADR honored" ledger** (`quay gate-log`). The `applies-to`/`enforcement` frontmatter fields ALREADY round-trip verbatim in `adr-store.js` (reserved in E1 for exactly this), so adding them is non-breaking. First wired case: **ADR-001 (TDD)'s enforcement = the B7 check** (load-bearing `scripts/*.mjs` need a sibling test) — E3 wires B7 as `adr-001`'s gate, closing the loop end-to-end. Consult surface: `accepted` ADRs whose `applies-to` matches a change are surfaced at SELECT / plan / review (not merely stored).

Depends on B7 (provides ADR-001's concrete check). Reference: epicd `docs/proposals/2026-07-03-adr-as-contract-harness.md`.

### Adjudicated approach (quay-task-to-plan pipeline, M42 SELECT, 2026-07-20)
Two proposal drafts converged on the core mechanism (a `makeAdrGate`-shaped factory reusing the
existing `runAcceptance` runner, registered as a STATIC `gateRegistry["adr-001"]` entry — no dynamic
per-id resolver, out of this task's AC scope) and diverged on how `enforcement` is shaped in ADR
frontmatter: a raw runnable-command STRING (same convention family as `task.extra.acceptance`) vs a
structured `{check, args}` object with an internal lookup table. **Adjudicated: the raw command
STRING wins** — B7's real invocation (`loadbearing-test-gate.sh --scripts <dir> [--tests <dir>]
...`) doesn't reduce to one-fixed-script-plus-positional-args the way `impl-row`/`line-budget` do, so
a structured shape adds indirection without a real safety gain (execution is `runAcceptance`'s
`spawnSync(shell:true)` either way). The one Proposal-2 refinement folded in: register via a small
declarative table (`ADR_GATE_IDS`) iterated once at module load, so a future ADR gets a one-line
addition rather than a copy-pasted call site.

**Final design:**
- `adr-store.js` view-model gains `appliesTo` (from `applies-to`) + `enforcement` (raw command
  string, verbatim) — additive, non-breaking; `list()` gains an `appliesTo` glob-match filter.
- `registry.js` gains `makeAdrGate(adrId, adrDir)`: reads the ADR **at gate-run time** (not
  module-load time — so an `enforcement` edit takes effect without a restart), fails closed if
  missing/not-`accepted`/no `enforcement`, else runs the command via the existing `runAcceptance`.
  `ADR_GATE_IDS = ["ADR-001"]` drives registration of `gateRegistry["adr-001"]`.
- ADR-001 gains `applies-to: ["experiments/quay-perpetual-stream/scripts/**"]` +
  `enforcement: "bash experiments/quay-perpetual-stream/scripts/loadbearing-test-gate.sh --scripts
  experiments/quay-perpetual-stream/scripts"`.
- Consult surface: `quay-native adr list --applies-to <path>` (+ MCP passthrough), extending the
  existing `list()` filter shape (mirrors `--status`/`--tag`).

Full N=2 proposal drafts + adjudication reasoning:
`experiments/quay-perpetual-stream/milestones/M42-cryst-e3-adr-gate/pipeline/{proposals,adjudication}.md`.
**Process-fidelity note:** no genuinely-isolated Task-agent dispatch tool was reachable this pass
(same finding as M41) — the two proposals were drafted sequentially by the same orchestrator
context (proposal 2 was not shown proposal 1's content beforehand, but same-context anchoring is a
real, undischarged risk), stated here rather than silently presented as true independent dispatch.

## Plan
`docs/plans/10-adr-gate-enforcement.md` (milestone-level plan record, quay-task-to-plan pipeline Stage
7.1) — product code across `adr-store.js` (surface applies-to/enforcement), the QENG gate registry
(register `adr-001` gate via `makeAdrGate`), and a consult surface; strict TDD per ADR-001 (red→green,
≥80% coverage).

## Acceptance Criteria
- [x] An `accepted` ADR carrying `applies-to` + `enforcement` registers as a named `adr-<id>` quay gate; running it appends a real GateEvent (`gate: "adr-<id>"`, verdict pass|fail) queryable via `quay gate-log`. — Confirmed by ABSORB adversarial audit (`experiments/quay-perpetual-stream/milestones/M42-cryst-e3-adr-gate/audit.md` AC1): fresh fixture task, `quay gate ... --gate adr-001` → PASS, `quay gate-log --json` returned a real `{"gate":"adr-001","verdict":"pass"}` GateEvent.
- [x] A change that VIOLATES an in-scope ADR makes its gate FAIL; a conforming change PASSES; fixtures pin both. — Confirmed (audit.md AC2): independently built tmp violating/conforming load-bearing-script trees from scratch, ran `loadbearing-test-gate.sh` directly against each — FAIL then PASS, both directions live.
- [x] ADR-001 is wired to the B7 check as its enforcement, and honoring/violating it is a GateEvent on a REAL object — not a prose claim. — Confirmed (audit.md AC3): `adr/ADR-001-*.md` frontmatter's `enforcement:` field literally invokes `loadbearing-test-gate.sh` against the real `experiments/quay-perpetual-stream/scripts`/`test` dirs.
- [x] A consult surface lists the `accepted` ADRs whose `applies-to` matches a given path/scope (so the loop can apply them at SELECT/plan/review). — Confirmed (audit.md AC4): `quay-native adr list --applies-to <path> --json` returns ADR-001 for an in-scope path, empty array for an out-of-scope path.
## Definition of Done
References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts:
- [x] A REAL ADR (ADR-001) is enforced by its named gate on a real change (GateEvent recorded), demonstrating "continuously applied", not asserted. — Confirmed (audit.md).
- [x] Single-source: the ADR's check LOGIC is one script; the quay gate WRAPS it (no second implementation) — same dual-source guard as D3/M39. — Confirmed (audit.md): `makeAdrGate` reuses the same `runAcceptance` runner every other gate uses; no duplicated spawn logic; check logic lives only in `loadbearing-test-gate.mjs`/`.sh`.
- [x] Strict TDD across the touched packages; no regression to the E1 ADR surfaces. — Confirmed (audit.md): `adr-store.js` 93.30% line/80.30% branch/100% funcs (13/13 tests); `registry.js` 94.15% line/86.96% branch (combined full-suite run); 164/165 quay tests pass (the 1 failure is a pre-existing unrelated browser-env issue, confirmed identical on pristine master).

## Not selected (M41)
DIR-030 ranks this #2 in the observe-and-enforce cluster (after G1). Not selected this pass: G1 is smaller/more self-contained (pure new metric scripts, no touch to `adr-store.js`/registry), and DIR-030's own ordering puts it first. Reconsider at M42.

## ABSORB (M42, 2026-07-20)
SELECTed and landed this pass — see `experiments/quay-perpetual-stream/charters/M42-cryst-e3-adr-gate.md`, `experiments/quay-perpetual-stream/milestones/M42-cryst-e3-adr-gate/{iterations/report.iteration-0.md,audit.md}`. All 4 ACs + 3 DoD clauses ticked above with audit evidence. DIR-030 window progress becomes 2/4 (G1 + E3) — still short of the ≥3/4 needed before D1 is eligible.