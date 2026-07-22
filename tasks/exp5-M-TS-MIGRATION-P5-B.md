---
id: exp5-M-TS-MIGRATION-P5-B
title: "TS migration P5-B (quay-backlog provider, DIR-058): migrate 3 src/*.js
  files to .ts"
status: todo
labels:
  - milestone-candidate
  - crystallization
parent: exp5-M-TS-MIGRATION-P5
children: []
extra:
  schema: v1
---
## Proposal

P5-B of [[exp5-M-TS-MIGRATION-P5]] (DIR-058): migrate `packages/quay-backlog/src/*.js` (3 files) to
`.ts`, behavior-preserving, under the ADR-012 golden-diff discipline:

- `packages/quay-backlog/src/manifest.js`
- `packages/quay-backlog/src/backlog-client.js`
- `packages/quay-backlog/src/mcp-server.js`

(`packages/quay-backlog/bin/quay-backlog.js` is covered by [[exp5-M-TS-MIGRATION-P5-A]], not here.)

`quay-backlog` is the 4th, read-only Backlog.md Provider, added after/outside ADR-012's original P3
scope (which only enumerated quay-native/quay-github/quay Core) — this is its first TS migration pass.

## Plan
N/A — mechanical per-file port, same pattern as P3-C (quay-github, M81): a full package's internal
implementation, smaller surface (3 files, one package).

## Acceptance Criteria
- [ ] All 3 `src/*.js` files renamed/ported to `.ts`, typechecking against the Provider ABI (`packages/quay/src/abi.ts`) the same way quay-native/quay-github do.
- [ ] `npx tsc --noEmit` (root tsconfig, once these files are included) exits 0 or with only the pre-existing documented TS2589 errors (no NEW errors from these 3 files).
- [ ] `packages/quay-backlog`'s own test suite (if one exists at execution time) is green before/after; if none exists, this AC is explicitly stated N/A with the reason (not silently skipped).
- [ ] Full non-flaky `packages/quay` suite green before/after (golden-diff), since quay Core's MCP client talks to this provider.

## Definition of Done
References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts:
- [ ] All 3 files are `.ts` on `master`, `git log --follow` shows the rename commit for each.
- [ ] `tsc --noEmit` + relevant suite(s) pasted as evidence in the Resolution.
- [ ] No behavior change (golden-diff: quay-backlog provider behaves identically before/after, pasted evidence).




## Not selected (M115)

Not selected M115 — exp5-DEFECT-M114-AUDIT-SESSION-ID-MECHANISM selected instead (smaller, higher-leverage governance fix this pass). Good next exploit pick.