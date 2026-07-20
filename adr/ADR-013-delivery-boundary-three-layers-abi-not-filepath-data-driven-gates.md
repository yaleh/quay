---
id: ADR-013
title: "Delivery boundary: quay is a three-layer deliverable — Core reaches providers ONLY via the ABI (never cross-package file paths), gate sets are data-driven (not hardcoded experiment paths), and experiment state is not product data; the standalone-smoke is the executable conformance gate"
status: accepted
date: 2026-07-20
supersedes: []
superseded-by: []
tags: [architecture, delivery, provider-abi, crystallization, packaging]
---
## Context
This repo simultaneously plays three roles that have never been separated, packaged, or validated as distinct deliverables (CLAUDE.md's opening admits "product + methodology/research coexist"):
- **Layer C (deliverable/reusable):** the product (`packages/**`) + the reusable "continuous-development-with-Claude-Code" methodology kit (the BAIME loop, `inherited-core`, the DoD meta-enforcer, the general gate scripts, ADR-001..011);
- **Layer B (this project):** quay's own architecture decisions, `CLAUDE.md`, `docs/`;
- **Layer A (current experiment):** `experiments/quay-perpetual-stream/` instance state + the exp5/DIR task backlog.

A `delivery-standalone-smoke` (packing the product as npm would ship it, into a workspace with no `experiments/` dir) proved the product **does not stand alone** — 5 RED blockers: (R1) 23 delivered lines reference exp5; (R2) `registry.js` imports `../../../quay-native/{adr-store,document-store,contract-validator}` — 3 cross-package relative imports; (R3) `gate --list` crashes standalone (`ERR_MODULE_NOT_FOUND` on `quay-native`); (R4) the whole CLI fails to load standalone (startup pulls the gate registry → R3); (R5) 5/5 built-in gate enforcement scripts live in `experiments/`, undelivered. R2/R3/R4 are one fault: the gate engine (added by E1/E3/D1) reaches into `quay-native` **by file path**, bypassing the Provider ABI that is quay's entire reason to exist ("Core is written against the task view-model only, never a specific backend"). R1/R5 are one fault: the **experiment is baked into the product** (hardcoded exp5 script paths + `ADR_GATE_IDS=["ADR-001"]`).

## Decision
Adopt an explicit, enforced **delivery boundary** with three standing rules:
1. **ABI, not file paths.** Core (`packages/quay`) MUST reach any provider capability — including the ADR-kind, document-kind, and contract-validator that E1/E3/D1 placed in `quay-native` — ONLY through the Provider ABI (the MCP/CLI provider surface), NEVER by a cross-package relative import (`../../../quay-native/...`). If a capability must be shared as code, it is a **declared dependency** on a Core-owned or shared package, not a reach across the workspace tree. This restores the invariant quay is built on.
2. **Data-driven gate sets.** The product ships the gate **engine + generic factories** only. A gate's check command is **data** — sourced from the workspace (an ADR/doc `enforcement:` field, or a `.quay/gates.yml`), NEVER a hardcoded `experiments/**` path. The `adr-<id>` gate (E3, derived from the ADR store) is the correct pattern; the `it0-*`/`vmeta-lag`/`audit-independence`/`dogfood-evidence` built-ins MUST be moved out of the product's default registry into exp5's own workspace config.
3. **Experiment state is not product data.** The delivered product ships an empty/minimal example store — NOT the accumulated multi-experiment `tasks/` backlog (267 files across 5 experiments). The reusable methodology kit is single-sourced (not duplicated per-experiment `inherited-core`); experiment dirs hold only mutable instance state + a kit-version pin.

**The executable conformance gate is `packages/quay/test/delivery-standalone-smoke.sh`.** The boundary is HELD when a real npm-delivered product passes it (5→0 RED) from a fresh workspace with no `experiments/` dir. "Delivered/reusable" is defined by that gate going green, not asserted in prose.

## Consequences
- **Forbids:** Core importing a sibling package by relative path; hardcoding experiment paths / experiment ADR ids into product default registries; shipping experiment backlog as product data; a second copy of the methodology kit per experiment.
- **Enables:** `npm install quay` works standalone; the product deploys onto a foreign repo (archguard/meta-cc) via the ABI; the methodology kit drops into a new project as one versioned unit; delivery regressions are caught mechanically (the smoke), not discovered at hand-off.
- **Validation ladder (beyond the standalone smoke):** (1) standalone-smoke green; (2) **deployment** — quay drives a real task on archguard/meta-cc via the ABI; (3) **application** — the methodology kit drives one real OUTER-LOOP milestone developing archguard, DoD-audited. Levels 2–3 are the transfer test moved OFF quay's own repo for the first time.
- Relates to: the Provider ABI rationale (DESIGN.md / quay-proposal.md) this restores; ADR-012 (the TS migration should preserve, not re-break, this boundary); ADR-011/INV (this ADR ships WITH its enforcement — the smoke). Steered for execution by DIR-035.
<!-- enforcement: applies-to packages/**; check — `bash packages/quay/test/delivery-standalone-smoke.sh` exits 0 (currently 5 RED, red-by-design until separation lands). Wire as a named delivery gate once the count reaches 0. -->
