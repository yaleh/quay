---
id: DIR-035-C
title: "DIR-035 split C: experiment state is not product data — delivered product ships an empty/minimal example store, not the multi-experiment tasks/ backlog"
status: todo
labels:
  - directive
  - milestone-candidate
parent: DIR-035
children: []
extra:
  dirStatus: pending
  schema: "v1"
---
## Proposal
Third child slice of [[DIR-035]] (ADR-013) — NOT executed this milestone. Tracks ADR-013's
Decision item 3 / DIR-035 Requested action item 3: the delivered product must ship an empty or
minimal example task store, not the accumulated ~267-file multi-experiment `tasks/` backlog this
repo has grown as its own dogfooding history.

## Finding
`delivery-standalone-smoke.sh` does not currently score this directly (its `WS` fixture workspace
is already a fresh empty `tasks/`/`.quay/` dir it constructs itself), but ADR-013's Context/
Decision are explicit that "experiment state ≠ product data" is a THIRD standing rule distinct
from R2/R3/R4 (DIR-035-A) and R1/R5 (DIR-035-B): today `tasks/` at repo root — the DEMO/dogfood
backlog quay's own methodology loop runs on — is not itself part of `packages/quay`'s `files`
whitelist (so it is not literally shipped in the npm tarball today), but the DIRECTIVE'S own DoD
item 1 asks for something stronger: a documented, minimal SAMPLE store shipped WITH the product
(so a fresh `npm install quay` user has a working example workspace to start from), decoupled from
this repo's own live experiment backlog — currently there is no such sample store at all.

## Requested action
1. Author a minimal example/sample task store (a handful of illustrative tasks demonstrating the
   view-model shape: primitive/compound roles, labels, AC/DoD sections) as documented product data
   shipped alongside `packages/quay` (or `packages/quay-native`, wherever the reference sample
   belongs), separate from this repo's own `tasks/` experiment backlog.
2. Confirm no accumulated experiment backlog is ever part of any package's `files` whitelist (audit
   `packages/*/package.json` `files` arrays).
3. Document (README or DESIGN.md) that a delivered `quay`/`quay-native` install starts from the
   minimal sample, not from this repo's live 267-file backlog.

## Acceptance Criteria
- [ ] A minimal documented sample task store exists and is demonstrated to work with a fresh `quay-native mcp` + `quay task list` round-trip.
- [ ] `packages/*/package.json` `files` whitelists audited and confirmed to exclude this repo's own `tasks/` experiment backlog.
- [ ] README/DESIGN.md documents the sample-store-vs-live-backlog distinction.

## Definition of Done
References the standard inherited-core DoD clauses; the bar is REAL LANDING. Done ONLY when a
fresh `npm install quay-native` + default config actually boots against the minimal sample, not
prose-only.

## Not selected (M48)
Considered as this milestone's slice; NOT selected — smaller in scope than DIR-035-A's architecture
fix but has no dependency relationship forcing it first, and DIR-035's own Requested action orders
the ABI fix (A) before data-driven gates (B) before this item (C) as items 1/2/3; deferred to a
future milestone's SELECT, most naturally after B lands (a fresh non-exp5 workspace's gate list is
easier to demo cleanly once B's data-driven sourcing exists).
