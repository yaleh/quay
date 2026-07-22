# Charter M93-arch-audit-explore — Archguard architecture audit explore (exp5-M-ARCH-AUDIT-M93-EXPLORE)

**Milestone id:** M93  
**Task:** `tasks/exp5-M-ARCH-AUDIT-M93-EXPLORE.md` (milestone-candidate, explore)  
**Surface:** `packages/quay`, `packages/quay-native`, `packages/quay-github` — read-only analysis only  
**Type:** methodology-class / explore (investigation, not implementation)  
**Charter authored:** 2026-07-22  
**Base commit:** master HEAD (see `git rev-parse HEAD` at dispatch time)  
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

The last archguard architecture audit was M83-arch-audit-post-ts-p3. Since then the codebase has changed substantially:
- M84-M86: TypeScript migration (p3b1, p3b2, p3b3) — significant package changes
- M86: probe spec infrastructure added to `plugin/`
- M87: config consolidation (DIR-050) — loop.yml/config.yml changes
- M89: YAML frontmatter crash fix
- M92: probe-spec SKILL wiring + real probe fire

The architecture-analysis probe spec (`plugin/probes/architecture-analysis.md`, `instrument: archguard`) is now wired and configured in `experiments/quay-perpetual-stream/.quay/loop.yml`, but has not fired in a real session since M83. This explore milestone runs it explicitly.

**Explore rationale (mandatory):** 5 exploits have run since M88's last explore (M89, M90, M91, M92, and now M93 is mandatory explore). This milestone resets the explore counter.

## Scope

**In scope:**
1. Archguard analysis of `packages/quay`, `packages/quay-native`, `packages/quay-github` — dependency cycles, god packages, code duplication, reinvented abstractions.
2. File each finding as an evidence-backed task with concrete archguard metric evidence.
3. Rate-gate filed findings through `routine-file-gate.mjs`.

**Out of scope:**
- Any fix to found structural issues (that is a future exploit milestone's job).
- Analysis of `plugin/`, `experiments/`, `tasks/` (methodology layer, not product layer).
- Modifications to product or methodology code (FILE-ONLY invariant enforced).

## Class routing

**Methodology-class** — exploration/investigation only; no product code changes; no quay-task-to-plan pipeline required. Dispatch directly as baime:iteration-executor.

## Acceptance Criteria

- [ ] Archguard analysis run against the current quay codebase packages (`packages/quay`, `packages/quay-native`, `packages/quay-github`).
- [ ] At least 1 concrete finding filed as a `milestone-candidate` task with real archguard metric evidence (not a prose summary).
- [ ] All findings backed by concrete archguard output (package name, metric value, proposed remediation).
- [ ] FILE-ONLY: this explore does not modify product or methodology code — only new task files.

## Definition of Done

References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts:
- [ ] Real archguard MCP analysis run (not a synthetic query); findings documented with tool output pasted.
- [ ] At least 1 filed finding task with archguard evidence (DIR-026 real object) that independently reproduces.
- [ ] Fresh-context adversarial audit confirms findings are real (not archguard tool noise or already-known issues).
- [ ] FILE-ONLY invariant confirmed: git status shows only new task files, no product/method code changes.

## GATE-HASH-REF

`33de7bbae2cda1eaea5e31cd9199da82c65b1a391042ce7638d81157fed92deb`  
(SHA-256 of `experiments/quay-perpetual-stream/scripts/it0-dod-check.mjs` at charter time)
