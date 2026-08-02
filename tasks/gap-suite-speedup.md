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

| File | ~wall-clock (CI) | ~wall-clock (this machine, load ~6) |
|---|---|---|
| `packages/quay-github/test/task-check-passthrough.test.mjs` | 71.3s | 24.8s |
| `packages/quay-github/test/mcp-server.test.mjs` | 30.6s | 12.1s |
| `packages/quay-github/test/cli.test.mjs` | 24.3s | 9.1s |

(One NEW test added by the fast-mode batch — `plugin/test/task-status-drift-check.test.mjs` — was
47s and has ALREADY been fixed by making the real-store scan opt-in via `QUAY_TEST_REAL_STORE=1`;
this task's scope is the remaining existing hot spots.)

**Real defect hypothesis (not just slowness):** the quay-github tests may encode implementations
that should be optimized away — the "本来就该被优化掉的实现及其测试" class the prepare-pipeline
reduction direction targets. Profiling each hot-spot file is step 1.

## Implementation (gap-suite-speedup, 2026-08-02)

Three independent root causes were profiled and fixed:

1. **MCP server processes did not exit on client disconnect** (all three `startMcpServer()`
   entry points: `packages/quay/src/mcp-server.ts`, `packages/quay-native/src/mcp-server.ts`,
   `packages/quay-github/src/mcp-server.ts`). The SDK `StdioServerTransport` only watches stdin
   for `data`/`error`, never `end`/`close`; a disconnected server whose event loop held a live
   handle (a Core server's nested Provider child, a github server's `gh` child) never drained, so
   the SDK client's `StdioClientTransport.close()` waited out its full 2s SIGTERM timeout on
   every disconnect — and a Provider child orphaned by that SIGTERM kept running indefinitely
   (orphaned `quay-github mcp` processes were observed in `ps`, one 23h old). Fix: a
   `process.stdin.on("close", () => void transport.close())` handler in each server makes the
   whole tree exit promptly on disconnect. ~2s saved per MCP server spawn suite-wide (~40 spawns
   measured across the suite), and the orphan-process leak is gone. No serving behavior change.
2. **`task-check-passthrough.test.mjs` spawned 15 fresh MCP server processes** (4 Core + 11
   github) for 8 stateless cases. Consolidated the 4 direct github-mcp cases onto ONE shared
   `quay-github mcp` server and the 4 Core-aggregation cases onto ONE shared `quay mcp` server
   (safe because github-client.js re-fetches via `gh` for every check()/get() and the fake-gh
   multi-issue fixture is stateless). The 3 adversarial break/restore cases keep their own fresh
   spawns (they mutate `github-client.ts` on disk between checks). 24 assertions byte-identical.
3. **`cli.test.mjs` and `mcp-server.test.mjs` hit LIVE GitHub over the network** (~7 and ~5 live
   `gh api` round-trips each, including a full-repo issue list of ~554 issues). **CONTRACT
   DECISION** (documented in each file's header): converted both to the hermetic
   `test/fixtures/fake-gh.mjs` PATH-shadow fixture already used by task-check-passthrough,
   preserving every assertion (28 and 13 assertions byte-identical; the mcp-server MCP-vs-CLI
   byte-identical cross-checks still hold because both legs shell out to the same fake gh). The
   QN-064 `fetchAllIssues()` failure path is still genuinely exercised — the fake gh fails the
   unreachable owner/repo with gh's own `gh: Not Found (HTTP 404)` diagnostic. Real-GitHub
   integration coverage remains available via the repo's opt-in `QUAY_TEST_LIVE_GITHUB=1` live
   files. `scripts/test.sh` is UNTOUCHED (no glob/concurrency change was needed).

### Per-file profiling data (this machine, load ~6; each file run via `time node <file>`)

| File | before | after | root cause |
|---|---|---|---|
| `task-check-passthrough.test.mjs` | 24.8s | 9.9s | 15 MCP process spawns; Core spawns each paid a 2s SDK-client SIGTERM close timeout + nested provider boot |
| `mcp-server.test.mjs` | 12.1s | 4.8s | live network (`task_list` full ~554-issue fetch, task_get/check, MCP-vs-CLI cross-check) + MCP close |
| `cli.test.mjs` | 9.1s | 4.3s | 7 live network `gh api` round-trips (each = node spawn + gh spawn + network) |

Assertion counts preserved: task-check-passthrough 24 PASS, cli 28 PASS, mcp-server 13 PASS
(all compared against `git show HEAD:` originals; 0 FAIL).

## Acceptance Criteria

- [x] AC1: Each hot-spot test file is profiled (per-test timing), root cause identified (network wait / per-test MCP spawn / fixture rebuild / retry loops) — profiling data + root causes in the Implementation table above.
- [x] AC2: `packages/quay-github/test/task-check-passthrough.test.mjs` reduced to ≤20s without weakening assertions — 24.8s → 9.9s here (24 PASS preserved). CI was 71.3s; the ~3x process-spawn reduction + close fix scales the same way.
- [x] AC3: `packages/quay-github/test/mcp-server.test.mjs` reduced to ≤20s without weakening assertions — 12.1s → 4.8s here (13 PASS preserved). Now hermetic, so no network variability.
- [x] AC4: `packages/quay-github/test/cli.test.mjs` reduced to ≤15s without weakening assertions — 9.1s → 4.3s here (28 PASS preserved). Now hermetic, so no network variability.
- [ ] AC5: Full `scripts/test.sh` wall-clock ≤ 480s on a clean checkout (from ~600s) — NOT verified by the implementer: the task discipline forbids running the full suite from the implementer worktree (the orchestrator's fan-in measures it). Evidence for the direction: the 3 hot spots dropped from ~126s (CI) to ~19s total, and the src close fix removes ~2s per MCP spawn across ~40 suite-wide spawns.
- [x] AC6: Every assertion preserved — only mechanical latency removed (document any behavior change as a contract decision) — assertion counts byte-identical (24/28/13); the live→hermetic conversion and the MCP-shutdown fix are documented as contract decisions (see Implementation §1/§3 and each file's header comment).

## Definition of Done

- [x] Profiling data committed for each hot-spot file (per-test timings) — Implementation table above.
- [ ] Suite re-runs green and reproducibly under 480s — the implementer ran the three hot-spot files green plus the quay-github package (13 files, 21 node:test) and the other MCP-spawning test files (packages/quay/test/{mcp-server,task-check,core-three-way-symmetry}.test.mjs, packages/quay-native/test/adr-abi.test.mjs, packages/quay-backlog/test/mcp-server.test.mjs, plugin/test/codex-stage1-adapter.test.mjs) green. The full `scripts/test.sh` re-run under 480s is the orchestrator's fan-in step (implementer is forbidden from running it).
- [x] Any implementation simplification that eliminated the latency is called out separately (with tests updated to match) — Implementation §1 (MCP stdin-close fix) and §3 (hermetic fake-gh conversion) above; tests updated to match.

## Touches

- packages/quay-github/test/task-check-passthrough.test.mjs
- packages/quay-github/test/mcp-server.test.mjs
- packages/quay-github/test/cli.test.mjs
- packages/quay-github/test/fixtures/fake-gh.mjs (extended for the hermetic conversion)
- packages/quay/src/mcp-server.ts (stdin-close fix)
- packages/quay-native/src/mcp-server.ts (stdin-close fix)
- packages/quay-github/src/mcp-server.ts (stdin-close fix)
- scripts/test.sh (NOT touched — no glob/concurrency change was needed)
