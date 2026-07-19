---
id: ADR-010
title: Scheduled milestone e2e incl. browser tests — keep L_T on the real axis
status: proposed
date: 2026-07-19
supersedes: []
superseded-by: []
tags:
  - methodology
  - verification
  - testing
  - process
---
## Context
The curl-vs-real-subagent lesson (`docs/references/geometry-as-llm-architecture-interface.md` §2): a first e2e used `curl` to impersonate a subagent, `L_T=0` passed — but the design was still wrong, because the sampling instrument flattened the one dimension the design turned on. A cheap proxy test gives `L_T=0` on the WRONG axis (pseudo-convergence along a blind dimension). Unit tests alone do not keep `L_T` measuring the real product surface — especially the web UI, which only a browser exercises truthfully.

## Decision
A **hard, scheduled mechanism** runs **end-to-end tests — including browser tests** (via Playwright / chrome-devtools) — at **milestone frequency**. The e2e must exercise the real product surface (the actual CLI/serve/web-UI path), not a cheap stand-in, so `L_T` is measured on the real axis. This is an instance of ADR-005 (cheap-but-real verification is the binding constraint) and the `L_T`-coverage discipline of ADR-006/007.

<!-- enforcement (E3, deferred): applies-to milestone; check a scheduled e2e (incl. at least one browser test against `quay serve`) ran for the milestone and is recorded fail-closed; reserved adr-010 gate -->

## Consequences
- **Forbids:** substituting a proxy (curl, a mocked surface) for the real e2e path and reporting `L_T=0` as green; skipping browser coverage for web-UI-affecting milestones.
- **Enables:** milestone-cadence confidence that `L_T` reflects real behavior; a concrete attach point for the ADR-009 background workflow.
- **Scope / relations:** instance-of ADR-005; complements ADR-007 (dark axes `L_G/L_D/L_S`) — together they cover all five loss axes at a milestone; runs at the ADR-009 milestone cadence.
