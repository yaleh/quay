# Charter M83-arch-audit-post-ts-p3 — Architecture health audit post-TS-P3 migration

**Milestone id:** M83  
**Task:** `tasks/exp5-M-ARCH-AUDIT-POST-TS-P3.md` (milestone-candidate, crystallization, explore)  
**Surface:** cross-cutting — archguard L_D/L_G analysis over packages/quay, packages/quay-native, packages/quay-github  
**Type:** discovery + instrument-correction (explore slot per ≥1-in-5 explore rule)  
**Charter authored:** 2026-07-21  
**Base commit:** master HEAD (see `git rev-parse HEAD` at dispatch time)  
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

After five TS migration milestones (M77 P1, M79 P2, M80 P3-A, M81 P3-C, M82 P3-B-1), the
quay codebase has substantial TypeScript coverage for the first time:

- `packages/quay/src/*.ts` — all 10 utility modules (M82), `abi.ts` (M79), `provider-client.ts` (M77)
- `packages/quay-native/src/*.ts` — `store.ts`, `mcp-server.ts`, `manifest.ts` (M80)
- `packages/quay-github/src/*.ts` — `github-client.ts`, `mcp-server.ts`, `manifest.ts` (M81)

The remaining TS migration scope:
- P3-B-2: `packages/quay/src/gate/` (7 files, ~1316 lines)
- P3-B-3: `packages/quay/src/serve.js` + `mcp-server.js` (~1872 lines)
- P4: method-infra scripts

ADR-007 mandates consulting archguard (the L_D/L_G instrument) before calling milestones done.
M78-M82 have run the TS migration at exploit pace; this explore milestone is the scheduled
L_D/L_G gap-fill.

## Scope

**In-scope work:**

1. Run archguard MCP dependency analysis on all three packages.
2. Run archguard cycle detection — find any circular dependency chains.
3. Run archguard god-package detection — identify high-fan-out / high-fan-in smells.
4. Inspect the `gate/` directory (P3-B-2 scope) via archguard for its dependency surface.
5. Inspect `serve.js` + `mcp-server.js` (P3-B-3 scope) for their dependency surface.
6. Document all findings in `milestones/M83/audits/arch-audit.md`.
7. File any blocking architectural issues as new quay tasks before ABSORB.

**Behavior-preserving constraints:**
- NO product code changes. This is a pure discovery pass.
- Test suites must not regress (no changes → no regressions by construction).

**Out of scope:**
- Fixing any found issues (file tasks for the next milestone to address)
- Implementing archguard as a standing routine (that is DIR-053, which depends on DIR-051)
- Any TS migration work

## Value hypothesis

- **Y:** `milestones/M83/audits/arch-audit.md` documents the archguard findings; any cycles or god-package smells are filed as tasks or noted as none-found; P3-B-2/B-3 risks mapped.
- **Δv̂ = 0** (discovery, no VT chart cell — instrument-correction value type)
- **Value type:** discovery + instrument-correction

## Pre-dispatch it0 checks

**(a) ceiling/floor arithmetic:** N/A. Discovery pass; no line-count scope.

**(b) gate-hash (by-reference):**  
GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

**(c) dogfooding evidence gate:** N/A at charter time.

**(d) domain-misfit audit-channel:** N/A — deliverable is an audit report (prose artifact).

**(e) plan-time line-budget gate:** N/A — no code scope (discovery pass).

**Sizing:** one archguard analysis pass + report. Should complete within a single iteration.

## Class routing

**Research/discovery-class** (deliverable = audit report). Run archguard, document findings.

## Done-when (binary)

1. `milestones/M83/audits/arch-audit.md` exists with archguard output documented.
2. Cycles check: any circular dependency chains identified (or "none found" stated explicitly).
3. God-package check: any packages with fan-in > 5 or fan-out > 10 identified (or "none found" stated explicitly).
4. P3-B-2 risk: `packages/quay/src/gate/` dependency surface documented (which external modules it imports from).
5. P3-B-3 risk: `packages/quay/src/serve.js` + `mcp-server.js` dependency surface documented.
6. No product-code changes committed (no `.ts`/`.js` file modifications).
7. Any blocking issues filed as tasks (or "no blocking issues found" stated).

## Inner termination (§3.2)

1. All 7 Done-when confirmed.
2. Archguard tools unavailable or timeout → document the failure, file a task, accept partial report.
3. Past budget ~5 iterations (this is a single-pass explore; should need only 1).
4. External HALT.

## HARD GATES (by-reference):
GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

The manda healthz gate and port-4173 reachability gate are **N/A** this milestone (no Web UI surface touched). State N/A explicitly.

## Per-milestone acceptance audit (UNCONDITIONAL)

Specific charge:
1. Confirm `milestones/M83/audits/arch-audit.md` exists and covers all 7 Done-when items.
2. Verify no product-code `.ts`/`.js` changes in the commit (`git diff master -- packages/`).
3. Confirm cycle check was run and result stated.
4. Confirm god-package check was run and result stated.
5. Confirm P3-B-2 + P3-B-3 risk surfaces documented.

Output to `milestones/M83/audits/iteration-0-acceptance-audit.md`. Verdict: REFUTED / CONCERNS / NO REFUTATION FOUND.

## Note for ABSORB

- `it0-dod-check.sh` invocation: `bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh exp5-M-ARCH-AUDIT-POST-TS-P3 experiments/quay-perpetual-stream/charters/M83-arch-audit-post-ts-p3.md /tmp/m83-absorb-entry.md`
- `quay gate exp5-M-ARCH-AUDIT-POST-TS-P3`
- Worktree: `milestones/M83/worktrees/iteration-0` off master HEAD
- milestone_counter: do NOT increment until all gates clear
- Dashboard row: `m83 · exp5-M-ARCH-AUDIT-POST-TS-P3 · Δv=0 (v̂=0) · audit=<verdict> · merge=<sha> · → milestones/M83/`
- No Web UI verification required (no product code changes)
- VT Δ = 0
