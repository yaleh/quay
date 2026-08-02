---
id: gap-suite-speedup
title: "scripts/test.sh full-suite speedup — hot-spot files dominate wall-clock"
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

`scripts/test.sh` full-suite wall-clock grew to ~600s (committed-state measurement 2026-08-02,
dev-session-handoff §4), exceeding the 900s CI timeout on one run. Three existing
`packages/quay-github/test/` files are the largest hot spots:

| File | ~wall-clock | Note |
|---|---|---|
| `packages/quay-github/test/task-check-passthrough.test.mjs` | 71.3s | existing |
| `packages/quay-github/test/mcp-server.test.mjs` | 30.6s | existing |
| `packages/quay-github/test/cli.test.mjs` | 24.3s | existing |

(One NEW test added by the fast-mode batch — `plugin/test/task-status-drift-check.test.mjs` — was
47s and has ALREADY been fixed by making the real-store scan opt-in via `QUAY_TEST_REAL_STORE=1`;
this task's scope is the remaining existing hot spots.)

**Real defect hypothesis (not just slowness):** the quay-github tests may encode implementations
that should be optimized away — the "本来就该被优化掉的实现及其测试" class the prepare-pipeline
reduction direction targets. Profiling each hot-spot file is step 1.

## Acceptance Criteria

- [ ] AC1: Each hot-spot test file is profiled (per-test timing), root cause identified (network wait / per-test MCP spawn / fixture rebuild / retry loops)
- [ ] AC2: `packages/quay-github/test/task-check-passthrough.test.mjs` reduced to ≤20s without weakening assertions
- [ ] AC3: `packages/quay-github/test/mcp-server.test.mjs` reduced to ≤20s without weakening assertions
- [ ] AC4: `packages/quay-github/test/cli.test.mjs` reduced to ≤15s without weakening assertions
- [ ] AC5: Full `scripts/test.sh` wall-clock ≤ 480s on a clean checkout (from ~600s)
- [ ] AC6: Every assertion preserved — only mechanical latency removed (document any behavior change as a contract decision)

## Definition of Done

- [ ] Profiling data committed for each hot-spot file (per-test timings)
- [ ] Suite re-runs green and reproducibly under 480s
- [ ] Any implementation simplification that eliminated the latency is called out separately (with tests updated to match)

## Touches

- packages/quay-github/test/task-check-passthrough.test.mjs
- packages/quay-github/test/mcp-server.test.mjs
- packages/quay-github/test/cli.test.mjs
- scripts/test.sh (only if a glob/concurrency change is the fix)
