---
id: exp5-M-TS-MIGRATION-P3-C
title: "TS migration P3-C: port quay-github package to TypeScript"
status: ready
labels:
  - milestone-candidate
  - crystallization
parent: exp5-M-TS-MIGRATION-P3
children: []
extra:
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-M-TS-MIGRATION-P3-C
    experiments/quay-perpetual-stream/charters/M81-ts-migration-p3c.md
    /tmp/m81-absorb-entry.md
---
## Context

Part of the ADR-012 TS migration program. P3-C covers `packages/quay-github/` — the GitHub Issues provider.

Files in scope: all `.js` files in `packages/quay-github/src/`.

## Acceptance Criteria

- [ ] All `.js` files in `packages/quay-github/src/` ported to `.ts` with named types
- [ ] `npx tsc --noEmit` exits 0 across the repo
- [ ] Test suite baseline maintained: 342/338/4 (or better)
- [ ] No runtime behavior change (golden-diff discipline)

## Definition of Done

- [ ] `packages/quay-github/src/*.ts` files exist (replacing `.js` counterparts)
- [ ] `tsc --noEmit` exits 0
- [ ] Test suite 338/342 pass (≥98.8%)
- [ ] Acceptance gate PASS

## Notes

- Requires live GitHub for full testing (serve-github.test.mjs) — use offline exclusions as in P1/P2
- ABI types from abi.ts (M79) should be importable cross-package
