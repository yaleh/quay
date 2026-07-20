---
id: DIR-035-B
title: "DIR-035 split B: data-driven gate set — move it0-*/vmeta-lag/audit-independence/dogfood-evidence built-ins out of the product's default registry (delivery-standalone-smoke blockers 1/5)"
status: done
labels:
  - directive
  - milestone-candidate
parent: DIR-035
children: []
extra:
  dirStatus: resolved
  schema: "v1"
---
## Proposal
Second child slice of [[DIR-035]] (ADR-013) — NOT executed this milestone (M48 scope was
[[DIR-035-A]] only, per DIR-026 SPLIT-OR-COMMIT). Tracks ADR-013's Decision item 2 / DIR-035
Requested action item 2: the product ships the gate ENGINE + generic factories only; a gate's check
command must be DATA (an ADR/doc `enforcement:` field or a `.quay/gates.yml`), never a hardcoded
`experiments/**` path baked into `packages/quay/src/gate/registry.js`.

## Finding
`packages/quay/src/gate/registry.js` currently hardcodes 5 absolute paths under
`experiments/quay-perpetual-stream/scripts/*.sh` (`IMPL_ROW_SCRIPT`, `LINE_BUDGET_SCRIPT`,
`VMETA_LAG_SCRIPT`, `AUDIT_INDEPENDENCE_SCRIPT`, `DOGFOOD_EVIDENCE_SCRIPT`) plus
`ADR_GATE_IDS = ["ADR-001"]`. `delivery-standalone-smoke.sh` blocker (1) counts the literal
`experiments/quay-perpetual-stream` path-string occurrences these constants introduce into the
delivered artifact; blocker (5) confirms none of the 5 referenced `.sh` scripts are actually
shipped (they live under `experiments/`, outside `packages/quay`'s `files` whitelist) — so a
delivered `quay gate --list` advertises 5 gate names whose backing scripts don't exist standalone.
Both blockers are the SAME root fault (hardcoded experiment-specific gate wiring in the default
registry) and should be fixed together.

## Requested action
1. Remove the 5 hardcoded `experiments/quay-perpetual-stream/scripts/*.sh` path constants and the
   `ADR_GATE_IDS = ["ADR-001"]` hardcoded array from `packages/quay/src/gate/registry.js`'s
   shipped default registry.
2. Source these 5 gate definitions (script path + args-key + label) from WORKSPACE DATA instead —
   follow the existing `adr-<id>` gate's pattern (E3: derived from the ADR store's `enforcement:`
   field at gate-run time, not baked into the module) — e.g. a `.quay/gates.yml` (or equivalent)
   read by the registry at gate-run time, so a non-exp5 workspace's `gate --list` shows only engine
   built-ins (`dod`, `acceptance`) plus THAT workspace's own data-driven gates, and exp5's
   instance-specific gates are sourced from exp5's OWN workspace config, not the product's shipped
   default.
3. Re-point exp5's own `.quay/config.yml` (or equivalent) to declare these 5 gates as its own
   workspace data, preserving their exact current behavior for exp5's own OUTER-LOOP ABSORB gate
   usage (no functional regression to the currently-passing DIR-034/M47 mechanization).

## Acceptance Criteria
- [x] `bash packages/quay/test/delivery-standalone-smoke.sh` blockers 1 and 5 both go GREEN (0 RED total, combined with DIR-035-A's already-green 2/3/4).
- [x] `grep -rnE 'experiments/quay-perpetual-stream' packages/quay/src packages/quay/bin` returns nothing.
- [x] A fresh non-exp5 workspace's `quay gate --list` shows only engine built-ins + that workspace's own data-driven gates (demonstrated with a real fresh `.quay/config.yml`, not asserted).
- [x] exp5's own ABSORB gate usage (`quay gate <milestone-task>` per OUTER-LOOP.md step 6) is behavior-preserved — a real milestone's DoD meta-enforcer run still passes exactly as before, evidenced by re-running it0-dod-check.mjs's own selfcheck fixtures green.

## Definition of Done
References the standard inherited-core DoD clauses; the bar is REAL LANDING. Done ONLY when:
- [x] The data-driven sourcing mechanism is demonstrated on a REAL foreign (non-exp5) workspace, not just asserted in prose.
- [x] Full existing test suite (excluding live-GitHub suites) shows no regressions.
- [x] `it0-dod-check.mjs`'s own fixture selfcheck (`dod-fixture-selfcheck.sh`) still passes unchanged.

## Not selected (M48)
Considered as this milestone's slice alongside DIR-035-A; NOT selected — DIR-026 SPLIT-OR-COMMIT
requires each milestone complete ONE whole child, and A (the architecture-violation half, "do
first" per DIR-035's own Requested action ordering) was smaller, more self-contained, and correctly
sequenced before B (which depends on A's move having already landed cleanly, since B's data-driven
registry refactor touches the same file A's import-path fix touches). Deferred to a future
milestone's SELECT.

## Resolution (2026-07-20, M49-dir035-b-data-driven-gates, commit `79e9e00`)

Built in worktree `.worktrees/M49-dir035-b` (commit `79e9e00`), independently re-verified by a
fresh-context adversarial audit subagent with NO access to the builder's self-report. **Audit
verdict: PASS.**

**Data-driven gate set landed as designed.** `packages/quay/src/gate/registry.js`'s 5 hardcoded
`experiments/quay-perpetual-stream/scripts/*.sh` path constants (`IMPL_ROW_SCRIPT`,
`LINE_BUDGET_SCRIPT`, `VMETA_LAG_SCRIPT`, `AUDIT_INDEPENDENCE_SCRIPT`, `DOGFOOD_EVIDENCE_SCRIPT`)
and the hardcoded `ADR_GATE_IDS = ["ADR-001"]` array are removed; the two generic factories
(`makeIt0Gate`, `makeAdrGate`) now read WHICH scripts/ADRs get wired from workspace data
(`<workspaceRoot>/.quay/gates.yml`) at gate-run time — mirroring the `adr-<id>` gate's existing
"derived from the ADR store's `enforcement:` field at gate-run time" discipline one level up. This
repo's own `.quay/gates.yml` re-declares the exact same 5 it0-style gates + 1 wired ADR, preserving
exp5's own OUTER-LOOP ABSORB gate usage byte-for-byte in behavior (audit diffed the constants
against the new YAML data and confirmed no drift).

**Delivery-standalone-smoke, before → after (combined DIR-035 A+B):** 5 RED → **0 RED**. Blockers 1
and 5 (this task's scope) join A's already-green 2/3/4:
```
=== 1) STATIC: delivered files must not reference the experiment ===
  ✅ no experiment references in delivered files
=== 5) DELIVERY: built-in gate enforcement scripts must be in the delivered artifact ===
  ✅ no undelivered gate scripts
=================== SMOKE VERDICT: 0 RED (delivery blockers) ===================
```

**Grep check:** `grep -rnE 'experiments/quay-perpetual-stream' packages/quay/src packages/quay/bin`
returns nothing (independently re-run, exit 1/no matches).

**Fresh foreign-workspace demonstration:** a real fresh workspace (`mktemp -d`, only `.quay/` +
`tasks/` dirs, no `.quay/gates.yml`, no `experiments/` present) run through the delivered
`quay gate --list` shows only `dod`, `acceptance`, `doc-quay-directive-skill` — no exp5-specific
gate leaks into a foreign workspace's default view. This repo's OWN root workspace (with its
committed `.quay/gates.yml`) still shows all 9 original gates (`dod`, `acceptance`,
`doc-quay-directive-skill`, `impl-row`, `line-budget`, `vmeta-lag`, `audit-independence`,
`dogfood-evidence`, `adr-001`) — confirming exp5's own gate usage is unchanged. `impl-row` and
`line-budget` gates independently exercised against a real task (`exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES`)
resolve and execute correctly (no "unknown gate" errors).

**No regressions:** `dod-fixture-selfcheck.sh` 17/17 PASS. Full test suite (excluding
serve-github/provider-abi-conformance) re-run in full (not just spot-checked): 253 tests, 249 pass,
4 fail — the 4 failures are the pre-existing master baseline (adr-gate E3 A2, dir032-audit-independence
M44 A2, dir032-audit-independence M44 C1, web-ui-browser), no new regressions introduced.
