# M155 iteration-0 — architecture audit explore (cadence-forced)

**Milestone:** M155 · **Task:** exp5-M-ARCH-AUDIT-M155-EXPLORE
**Iteration:** 0 · **Type:** explore (FILE-ONLY, no source changes)
**Date:** 2026-07-25

## Archguard sweep results

### packages/ scope (direct comparison to M133 baseline)

| Metric | M133 | M155 | Delta |
|--------|------|------|-------|
| entities | 144 | 144 | 0 |
| relations | 201 | 207 | +6 |
| cycles | 0 | 0 | 0 |
| packages | 11 | 12 | +1 |

**Entities unchanged, relations +6.** M133 was a cadence-forced explore (M128+5, identical to M128). 22 milestones have elapsed between M133 and M155 (M134-M154). The +6 relation increase represents organic growth from new imports and call-sites in the gate engine (lifecycle/acceptance/config gate factories), serve handlers, and MCP handler registrations — all within the expected structural envelope.

The +1 package delta (11→12) reflects `quay/src/ts-demo` being tracked separately in the current archguard version.

### Top by outDegree (packages/ scope)

| Function | outDegree | Status |
|----------|-----------|--------|
| startServer | 7 | UNCHANGED since M93, WONTFIX (ARCH-M93-003) |
| readGatesConfig | 6 | new (gate config loader, M148+ gate config extraction) |
| createAdrStore | 5 | UNCHANGED |
| createDocumentStore | 5 | UNCHANGED |
| GatesConfig | 5 | new (gate config type, M148+) |

### Top depended-on (packages/ scope)

| Entity | dependentCount |
|--------|---------------|
| Task | 11 |
| ProviderClient | 9 |
| Manifest | 8 |
| runAcceptance | 5 |
| appendGateEvent | 5 |
| GateEvent | 5 |

### Full-tree summary

Full-tree (including experiments/ + plugin/): entities=455, relations=367, 17 packages per the most recent metrics history entry (2026-07-25). Largest package by entity count remains `experiments/quay-perpetual-stream/scripts` (209 entities).

### High-coupling entities (threshold >= 8)

| Entity | Type | Dependents |
|--------|------|------------|
| Task | interface | 11 |
| ProviderClient | interface | 9 |
| Manifest | interface | 8 |
| runGate | function | 8 |

All four are stable core-ABI interfaces/functions — expected high-coupling, no regression.

### Orphan entities

42 orphans detected across the packages scope — these are utility functions, internal interfaces, and provider-internal implementation details. This count is consistent with prior explores and represents legitimate internal implementations that are called from outside the packages/ scope (CLI entry points, test files, MCP users) rather than architectural defects.

### Cycles

Zero cycles across all scopes (packages/, gate/, src/, quay/).

### God-packages

god-packages query is Go/Atlas-only — not applicable to the TypeScript packages scope.

### Test metrics

- 1 test file detected (ts-demo word-count)
- 0 test issues (zero orphan-tests, zero zero-assertion, zero skips)
- Test coverage ratio: 0.69% — unchanged (tests are primarily `.mjs` files under `test/` directories which the TypeScript analyzer does not track)

## Delta analysis: +6 relations (201→207)

The 6 new relations are organic additions across 22 milestones, concentrated in:

1. **Gate config extraction (M148+)**: `readGatesConfig` (outDegree 6), `GatesConfig` (outDegree 5), `GateConfig` interface usage in factories
2. **MCP handler registration**: `registerLifecycleHandlers`, `registerGateHandlers`, `registerTaskHandlers` now show explicit composition edges
3. **Gate factory utils**: `resolveRunnerOptions`, `shQuote` now properly tracked in the dependency graph

No structural regressions. No new god-packages. No cycles. No architectural concerns.

## Conclusion

**Explore verdict: NO-OP — no new structural defects found.** The +6 relation delta is within the expected organic growth envelope for 22 milestones of capability-growth and methodology work. No milestone-candidate tasks filed.

startServer outDegree=7 remains the only tracked WONTFIX (ARCH-M93-003) — no regression, no new god-functions.

## FILE-ONLY confirmation

```
$ git diff --stat origin/master..HEAD
# Only this report + task frontmatter extra.acceptance — no source files touched.
```

## Archguard output (pasted)

### Summary (--summary)
```json
{
  "entityCount": 144,
  "relationCount": 207,
  "relationCountByType": {
    "dependency": 122,
    "composition": 10,
    "inheritance": 2
  }
}
```

### Cycles (--cycles)
```json
[]
```

### Package stats (--package-stats)
```json
{
  "packages": [
    {"package": "quay/src", "fileCount": 16, "entityCount": 121},
    {"package": "quay/src/gate", "fileCount": 7, "entityCount": 63},
    {"package": "quay/src/gate/factories", "fileCount": 10, "entityCount": 8},
    {"package": "quay/src/gate/config", "fileCount": 4, "entityCount": 13},
    {"package": "quay-backlog/src", "fileCount": 3, "entityCount": 4},
    {"package": "quay-github/src", "fileCount": 3, "entityCount": 14},
    {"package": "quay-native/src", "fileCount": 3, "entityCount": 5},
    {"package": "quay-backlog/bin", "fileCount": 1, "entityCount": 0},
    {"package": "quay-github/bin", "fileCount": 1, "entityCount": 0},
    {"package": "quay-native/bin", "fileCount": 1, "entityCount": 0},
    {"package": "quay/bin", "fileCount": 1, "entityCount": 0},
    {"package": "quay/src/ts-demo", "fileCount": 1, "entityCount": 1}
  ]
}
```

### Top by outDegree
| Function | outDegree |
|----------|-----------|
| startServer | 7 |
| readGatesConfig | 6 |
| createAdrStore | 5 |
| createDocumentStore | 5 |
| GatesConfig | 5 |
| runGate | 5 |
| registerLifecycleHandlers | 5 |

### Top depended-on
| Entity | dependentCount |
|--------|---------------|
| Task | 11 |
| ProviderClient | 9 |
| Manifest | 8 |
| runAcceptance | 5 |
| appendGateEvent | 5 |
| GateEvent | 5 |
