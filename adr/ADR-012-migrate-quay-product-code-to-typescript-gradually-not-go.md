---
id: ADR-012
title: "Migrate quay product code to TypeScript (gradually, not Go) — to unlock archguard (the L_G/L_D instrument) + harden L_C via types"
status: accepted
date: 2026-07-20
supersedes: []
superseded-by: []
tags: [architecture, language, observability, crystallization]
---
## Context
quay's product code (`packages/quay`, `quay-native`, `quay-github`) is JavaScript/ESM on Node. **archguard** — the static-architecture instrument ADR-007 relies on to light the dark axes `L_G` (dependency cycles / god-packages / reinvented abstractions) and `L_D` (description length / compression) — does NOT read JavaScript, so quay's architecture is currently un-measurable by it (G1/M41 hit exactly this wall). Per the GIT lens (§2.3 natural-gradient parametrization-invariance), the implementation **language is a coordinate** — it does not change system quality — so "rewrite for quality" is not a valid reason. The valid, narrow reason is **observability**: the measurement instrument cannot read the subject's language (the §2 "can't-read-the-sampling-instrument → blind-axis pseudo-convergence" lesson). A secondary real benefit: TypeScript types are **`L_C` constraint-hardening** ("断言加固" — types cut the reachable program space, lower `L_S`, catch a class of LLM errors), i.e. types are themselves a crystallization move.

## Decision
Migrate quay **product code (`packages/**`) gradually to TypeScript — NOT Go.** Rationale: TS is a JS **superset**, so migration is **incremental and behavior-preserving-by-construction** — file-by-file `.mjs→.ts`, `allowJs` coexistence, Node 25 **native type-stripping** (runs TS with no build step; `tsc --noEmit` as a type gate), keeping npm workspaces, `node --test`, and the MCP SDK. Go is rejected as the default because it is a **big-bang rewrite** (new runtime, new test framework, a Go MCP SDK, whole-ABI rewrite) that would freeze/disrupt the live exp5 loop — Go is reconsidered ONLY if single-binary distribution (DIR-004) later becomes the dominant requirement, and then only for the CLI. The migration is a **tracked, phased program** (`exp5-M-TS-MIGRATION`, phases P0–P4), each phase verified behavior-preserving by the existing selfchecks/gates + golden-diff (the same discipline that landed the it0-dod-check restructure). **The migration MUST NOT block observability:** G1's `L_G/L_D` uses JS-native proxies (`madge`/`dependency-cruiser` for cycles/god-packages, `jscpd` for duplication) in the interim; archguard is the **post-migration upgrade**, not a precondition.

## Consequences
- **Forbids:** a big-bang rewrite; a Go cutover of the whole product (loses the gradual path + the Node/MCP ecosystem + JS-superset continuity); blocking G1/observability on the migration completing.
- **Enables:** archguard analysis of quay (lights `L_G/L_D`); compile-time type-safety on the Provider ABI and the gate engine (fewer LLM/human errors on the human+LLM channel); each migration phase is a behavior-preserving crystallization increment.
- **Scope / sequencing:** product code first (`packages/**`), then the exp5 method-infra scripts (load-bearing gates) under the golden-diff discipline. See `exp5-M-TS-MIGRATION` for P0–P4. Relates to ADR-004 (hard-over-soft — types are hard `L_C`), ADR-006/007 (the dark axes this unblocks), ADR-001 (TDD applies to the ported product code).
<!-- enforcement (E3, deferred): applies-to packages/**; check(s) — a `tsc --noEmit` type gate on migrated packages, and (post-migration) an archguard L_G gate (no new dependency cycle / god-package). Registered once phases land. -->
