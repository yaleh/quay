---
id: exp5-M-TS-MIGRATION-P3
title: "TS migration P3 (per-package, ADR-012): port the packages internally to TS
  — quay-native store → Core CLI/serve/mcp → quay-github — behavior-preserving,
  autonomous under the golden-diff discipline; split per-package at SELECT."
status: todo
labels:
  - milestone-candidate
  - crystallization
parent: exp5-M-TS-MIGRATION
children: []
extra:
  schema: v1
---
## Proposal
Phase P3 of [[exp5-M-TS-MIGRATION]] (ADR-012). With the ABI boundary typed (P2), migrate the packages'
INTERNAL implementation JS→TS, package by package, in dependency order: **quay-native store → Core
(CLI/serve/mcp) → quay-github**. Each file becomes `.ts`, typechecks against the P2 ABI interfaces, and
runs under Node 25 native type-stripping with no build step (`allowJs` lets un-migrated files coexist,
so the port is strictly file-by-file).

Behavior-preserving-by-construction; runs AUTONOMOUSLY (parent's `human-steered` gate cleared by human
directive 2026-07-21) with the executable behavior-preserving discipline (Plan/DoD) as the replacement
safety. This is the broadest phase (touches the most product code), so the golden-diff discipline is
load-bearing here.

**Scope:** internal implementation of `packages/**` (quay-native, quay, quay-github).
**Out of scope:** exp5 method-infra scripts under `experiments/**` (P4); any runtime behavior change.

## Plan
N/A — a multi-package program; **split-or-commit at SELECT (DIR-026): P3 MUST be split into per-package
(and, if still over-ceiling, per-module) children at SELECT** — never attempt all three packages in one
milestone. Each child:
- ports its files to `.ts`, passes `tsc --noEmit` (the P0 gate), and typechecks against the P2 ABI types;
- keeps the FULL existing suite + selfchecks + gates green before/after (golden-diff on load-bearing
  behavior) — net zero runtime change; the two LIVE-GitHub suites (serve-github, provider-ABI
  conformance) included where the package touches them;
- TDD/red-green per ADR-001; fresh-context adversarial audit per DIR-044/048.

## Acceptance Criteria
- [ ] Each package's internal implementation is `.ts`, runs under Node native type-stripping (no build step), passes `tsc --noEmit`, and typechecks against the P2 ABI interfaces.
- [ ] Behavior-preserving per package: the full existing test + selfcheck + gate suite is green before AND after; a golden-diff shows no runtime behavior change (incl. the LIVE-GitHub suites for the packages that touch them).
- [ ] Split-or-commit honored: P3 was split into per-package children at SELECT (each with its own AC/DoD), never driven as one over-ceiling milestone.

## Definition of Done
References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts:
- [ ] All three packages' internals run on TypeScript, `tsc --noEmit` passes, full suite/selfchecks/gates green throughout — behavior-preserving on each real per-package milestone (pasted evidence).
- [ ] No dual source / no behavior drift (ADR-004); the it0 DoD meta-enforcer passes; TDD per ADR-001; fresh-context adversarial audit per package confirms no runtime drift.
- [ ] Per DIR-026 SPLIT-OR-COMMIT: each per-package child lands done-or-`needs-human`; parent [[exp5-M-TS-MIGRATION]] is done only when ALL children (P0–P4) are done.
