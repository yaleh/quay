# M136 — quay serve --host option

**Task:** quay serve --host option directive
**Milestone counter:** 136
**Chart:** 2
**Class:** development (capability-growth — product code)
**Value type:** capability-growth
**Cadence:** exploit (streak=2/4, not due for explore)
**Deliverable:** yes (shipped product code in packages/)
**Charter tokens:** ~1.0 K

## Value hypothesis

`Δv̂ = 0` (no chart-2 surface cell directly moves — this is a CLI capability gap below the
surface-level aggregation). Real value is product hardening: users can now bind `quay serve`
to a specific interface for security (localhost-only), Tailscale/VPN, or multi-instance use.

**Metric Y:** `quay serve --host 127.0.0.1` + `curl http://127.0.0.1:<port>` works;
`quay serve --help` shows `[--host <host>]`.

## Scope

Add `host?: string` to `StartServerOptions` in `packages/quay/src/serve.ts`, thread through
`server.listen(port, host, callback)` defaulting to `"0.0.0.0"`, add `--host <host>` CLI flag
in `packages/quay/bin/quay.ts`, update help text and log line. ~30 lines total.

## Done-when (binary)

1. `StartServerOptions.host` added, threaded to `server.listen()`. Default `"0.0.0.0"`.
2. `quay serve --host 127.0.0.1` binds localhost — verified via curl.
3. `quay serve` (no --host) binds `0.0.0.0` — backward-compatible.
4. `quay serve --help` shows `[--host <host>]`.
5. Log line: `quay serve: listening on http://<host>:<port>`.
6. `node --test packages/quay/test/serve.test.mjs` stays green.

## Inner termination

Done-when-complete (6 clauses) OR external HALT (.halt sentinel).

## it0 systematic-explore checks

**In-scope gap subset:** none — new capability, not tracked in exp4 gap-list.

### a. Ceiling arithmetic
~30 lines, well within ≤2000-line ceiling.

### b. Gate-hash (invariant 3)
GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

### c. Dogfooding evidence-gate
Self-dogfooding: `--host` option is tested by existing serve tests. Evidence is test output.

### d. Domain-misfit audit-channel
CI test suite + independent adversarial audit — same established pattern.

### e. Line-budget gate
Well within small-milestone norm.

## Charter pinned reference

inherited-core.md at `git rev-parse HEAD:experiments/quay-perpetual-stream/inherited-core.md`
