# M128 iteration-0 — post-M127 architecture audit (mandatory explore)

**Milestone:** M128 · **Task:** exp5-M-ARCH-AUDIT-M128-EXPLORE
**Iteration:** 0 · **Type:** explore (FILE-ONLY, no source changes)

## Archguard sweep results

### packages/ scope (direct comparison to M123 baseline)

| Metric | M123 | M128 | Δ |
|--------|------|------|---|
| entities | 144 | 144 | 0 |
| relations | 201 | 201 | 0 |
| cycles | 0 | 0 | 0 |
| packages | 11 | 11 | 0 |

**IDENTICAL.** M126 (version-consistency-check script under scripts/) and M127 (chart-saturation-check scripts under experiments/) introduced zero structural changes to packages/ — as expected.

### Top by outDegree (packages/ scope)

| Function | outDegree | Status |
|----------|-----------|--------|
| startServer | 7 | UNCHANGED since M93, WONTFIX (ARCH-M93-003) |
| createAdrStore | 5 | UNCHANGED |
| createDocumentStore | 5 | UNCHANGED |
| runGate | 5 | UNCHANGED |
| makeIt0Gate | 5 | UNCHANGED |

### Top depended-on (packages/ scope)

| Entity | dependentCount |
|--------|---------------|
| Task | 11 |
| ProviderClient | 9 |
| Manifest | 8 |
| GateConfig | 7 |
| resolveRunnerOptions | 6 |

### Full-tree summary

Full-tree (including experiments/ + plugin/): entities=455, relations=367, 17 packages.
Largest package by entity count: `experiments/quay-perpetual-stream/scripts` (145 entities, 26 files) — the method-infra script suite.

## FILE-ONLY confirmation

```
$ git diff --stat master~1..master
# Only this report + the task file changed — no source files touched.
```

## Conclusion

No new findings. The packages/ entity graph is identical to M123 — M126/M127 were purely experiments-layer additions with zero impact on the product architecture. startServer outDegree=7 remains the only WONTFIX god-function tracked since M93. 0 cycles across all scopes.

**Explore verdict: CLEAN — no new structural defects found.**
