---
id: exp5-M-ARCH-AUDIT-M93-EXPLORE
title: "explore: archguard architecture audit — post-TypeScript-migration
  structural analysis (M93)"
status: done
labels:
  - milestone-candidate
  - explore
  - milestone:M-93
parent: null
children: []
extra:
  schema: v1
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-M-ARCH-AUDIT-M93-EXPLORE
    experiments/quay-perpetual-stream/charters/M93-arch-audit-explore.md
    /tmp/m93-absorb-entry.md
---
## Proposal

Run a systematic archguard architecture analysis of the current quay codebase (post-TypeScript migration, post-probe-wiring) to surface structural issues: dependency cycles, god packages, code duplication, architectural drift. File each finding as an evidence-backed task on the board. This is an explore milestone — it DISCOVERS unknown structural defects, it does NOT fix them.

The last archguard audit was M83-arch-audit-post-ts-p3. Since then:
- M84-M86: TypeScript migration continued
- M86: probe spec infrastructure landed
- M87: config consolidation (DIR-050)
- M89: YAML frontmatter crash fix
- M92: probe-spec SKILL wiring + real-fire proof

The codebase structure may have shifted. The `architecture-analysis` probe spec (`plugin/probes/architecture-analysis.md`, `instrument: archguard`) is now wired via the loop-driver SKILL but has not fired in a real archguard session since M83.

## Plan

Methodology/design-class explore:
1. Dispatch a fresh-context Explore agent with the archguard MCP tool to analyze the current quay codebase for: dependency cycles, god packages, code duplication, reinvented abstractions.
2. For each finding: produce an evidence-backed task file with concrete archguard metric evidence (file/package names, fan-in/fan-out values, cycle paths).
3. File each finding through `routine-file-gate.mjs` (rate-cap + novelty gate).
4. Update the task store with the filed findings.

## Acceptance Criteria
- [x] Archguard analysis run against the current quay codebase packages (`packages/quay`, `packages/quay-native`, `packages/quay-github`).
- [x] At least 1 concrete finding filed as a `milestone-candidate` task with real archguard metric evidence (not a prose summary).
- [x] All findings are backed by concrete archguard output (package name, metric value, proposed remediation).
- [x] FILE-ONLY: this explore does not modify product or methodology code — only new task files.

## Definition of Done
References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts:
- [x] Real archguard MCP analysis run (not a synthetic query); findings documented with tool output pasted.
- [x] At least 1 filed finding task with archguard evidence (DIR-026 real object) that independently reproduces (the archguard call can be re-run to confirm the metric).
- [x] Fresh-context adversarial audit confirms findings are real (not archguard tool noise or already-known issues).
- [x] FILE-ONLY invariant confirmed: git status shows only new task files, no product/method code changes.

## Execution record

**Milestone:** M93  
**Iteration:** iteration-0  
**Realized Δv:** 0 (v̂=0 — explore; findings filed as new milestone-candidates)  
**Merge SHA:** 6096cc6  
**Outcome:** done — archguard analysis completed; 4 findings filed (ARCH-M93-001..004); audit NO REFUTATION FOUND.

**Archguard evidence summary:**

- ARCH-M93-001: `gate/` sub-package god-package — fanOut=62, fanIn=7, entityCount=52 (59.8% of all 87 entities). `gate/registry.ts` (736 lines) holds 7 gate factory functions with no decomposition.
- ARCH-M93-002: `startMcpServer` god-function — outDegree=10 (highest in codebase), 797-line file, 15 MCP tool handlers inlined in a single function body with no router abstraction.
- ARCH-M93-003: `startServer` god-function — outDegree=6, 1085-line file, 675-line function body with 5 inline route handlers, all routing/rendering/security co-located.
- ARCH-M93-004: ABI boundary violation — `quay-native/src/mcp-server.ts` imports `createAdrStore` from `quay/src/adr-store.ts` (concrete Core implementation, not ABI type). `adr-store.ts` fanIn=1 confirms the sole cross-boundary import.

**Gate results:** All 4 findings passed `routine-file-gate.mjs --board tasks --k 5` (ACCEPT: actionable, novel, within rate).  
**Adversarial audit:** `milestones/M93/audits/iteration-0-acceptance-audit.md` — NO REFUTATION FOUND.
