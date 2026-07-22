---
id: PROBE-SV-M92-001
title: "defect: built-in acceptance gate ignores workspaceRoot/--cwd; always
  runs in process.cwd() (DIR-046 regression)"
status: done
labels:
  - milestone-candidate
  - defect
  - milestone:M-94
parent: null
children: []
extra:
  schema: v1
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    PROBE-SV-M92-001
    experiments/quay-perpetual-stream/charters/M94-acceptance-gate-cwd-fix.md
    /tmp/m94-absorb-entry.md
---
## Finding

**WHAT:** The built-in `acceptance` gate in `packages/quay/src/gate/registry.ts` (line ~482) calls `resolveRunnerOptions()` with NO `gateConfig` argument, so `cwd` always resolves to `process.env.QUAY_ACCEPTANCE_CWD || process.cwd()`. The `GateFn` signature is `(task, client)` — `workspaceRoot` is never threaded in.

**WHERE:** `packages/quay/src/gate/registry.ts`, the `acceptance:` entry in `gateRegistry` (lines 468–484):
```ts
const { cwd, timeoutMs } = resolveRunnerOptions();   // ← no gateConfig, no workspaceRoot
const { ok, reason } = runAcceptance({ command, cwd, timeoutMs });
```

**WHY it matters:** DIR-046 documents that `quay gate <task>` should run the acceptance command in the **worktree** (not `process.cwd()`) via `--cwd <worktree>`. The loop-driver SKILL.md says "gate runs against the BUILT worktree, not workspaceRoot — DIR-046". The CLI passes `--cwd` → `workspaceRoot` → `engine.runGate({ workspaceRoot })`, but `engine.runGate` never passes `workspaceRoot` into the `GateFn` closure. So for a task whose acceptance command assumes a worktree path, the gate silently runs in the wrong directory, producing a false PASS or false FAIL against the unbuilt master tree instead of the built worktree.

**Concrete reproduction:**
1. Create a task with `extra.acceptance: "ls worktree-only-file.txt"`.
2. Add `worktree-only-file.txt` only in a worktree (not in master).
3. Run `quay gate <task> --gate acceptance --cwd <worktree>`.
4. The command runs in `process.cwd()` (the driver's cwd, NOT the worktree) → fails on the worktree content, passes on the master content, or vice versa.

**Note:** `QUAY_ACCEPTANCE_CWD` env var is an escape hatch but is not set by the CLI `--cwd` flag, and the SKILL.md does not document it as the mechanism. The architectural fix is to thread `workspaceRoot` into the `GateFn` signature or to set `QUAY_ACCEPTANCE_CWD` from the CLI's `--cwd` flag in the engine invocation path.

## Proposal

**Approach:** Add a `cwd` parameter to the MCP `gate_run` tool handler (parallel to the CLI's `--cwd` flag), and use it in the handler exactly as `pinAcceptanceEnv` does for the CLI — set `QUAY_ACCEPTANCE_CWD` from the explicit `cwd` arg when supplied, else fall back to `cfg.workspaceRoot`. No `GateFn` signature change needed.

**Implementation plan:**
1. `packages/quay/src/mcp-server.ts` line ~431 — add `cwd: z.string().optional().describe("Working directory for the acceptance runner (worktree path). Defaults to workspaceRoot. Mirrors CLI --cwd.")` to `gate_run` inputSchema.
2. `packages/quay/src/mcp-server.ts` line ~434 — destructure `cwd` from handler args alongside `provider, id, gate, timeoutMs, file`.
3. `packages/quay/src/mcp-server.ts` line ~439 — replace the bare `process.env.QUAY_ACCEPTANCE_CWD = cfg.workspaceRoot` with the same `pinAcceptanceEnv`-equivalent logic: `if (cwd) { process.env.QUAY_ACCEPTANCE_CWD = cwd; } else if (!process.env.QUAY_ACCEPTANCE_CWD) { process.env.QUAY_ACCEPTANCE_CWD = cfg.workspaceRoot; }` — and add a `finally` branch to restore the previous value (same discipline as the `timeoutMs` restore already present at line 454).
4. Import `pinAcceptanceEnv` (or inline the same 3-line logic) — whichever is cleaner; `pinAcceptanceEnv` is defined in `bin/quay.js` (not exported from a module), so inline is likely simpler.
5. No changes to `registry.ts`, `engine.ts`, or `GateFn` type — `resolveRunnerOptions()` already reads `QUAY_ACCEPTANCE_CWD` correctly; `makeAdrGate` already uses it too.

### Adjudication note
**Convergence/Divergence:** Real divergence — Proposal A adds a third argument to `GateFn`; Proposal B uses the env-var mechanism. They are different implementation paths, not different framings of the same approach.

**Verdict:** Proposal B's approach (env-var pin) wins. Source-code reading establishes that the env-var mechanism is already fully wired and working:
- CLI path: `pinAcceptanceEnv` (bin/quay.js line 206) sets `QUAY_ACCEPTANCE_CWD = cwd` when `--cwd` is supplied, else pins `workspaceRoot`. `resolveRunnerOptions()` (registry.ts line 151) reads it as highest-precedence. CLI path already works.
- MCP path: `gate_run` handler (mcp-server.ts line 439) already sets `QUAY_ACCEPTANCE_CWD = cfg.workspaceRoot`, but the MCP schema has NO `cwd` parameter — there is no way to pass a worktree path different from workspaceRoot. This is the only real gap.
- `makeAdrGate` (registry.ts line 246) calls `resolveRunnerOptions()` bare and therefore ALSO reads `QUAY_ACCEPTANCE_CWD` correctly — no additional fix needed.

Proposal A's `GateFn` signature extension (`opts?: { workspaceRoot?: string }`) would add a type-level contract, engine threading (`fn(task, client, { workspaceRoot })`), and per-gate routing inside `registry.ts` — all unnecessary, because the env-var mechanism already delivers the same information without touching any of those signatures. Proposal A correctly identified the symptom but overfit the fix to type-threading when the already-designed env-var channel is the simpler path.

Proposal B's stated premise that "the MCP gate_run handler calls runGate() without calling pinAcceptanceEnv first" is partially incorrect (line 439 already sets `QUAY_ACCEPTANCE_CWD`), but its direction (add the cwd-pinning path to the MCP handler) is correct and precisely identifies the remaining gap.

**Alternatives considered and rejected from non-winning proposal:**
- `GateFn` third-arg `opts?: { workspaceRoot?: string }` — unnecessary type churn; the env-var mechanism already threads cwd without changing any function signatures.
- Thread `workspaceRoot` from `engine.ts#runGate` into `fn(task, client, { workspaceRoot })` — same objection; adds engine complexity for no behavioral difference over pinning the env var before calling `runGate`.
- Change `resolveRunnerOptions` to accept an explicit `workspaceRoot` override — same objection; `QUAY_ACCEPTANCE_CWD` already serves this role and is already read at highest precedence.

**Line budget estimate:** ~15L total (5L mcp-server.ts schema + 10L handler cwd-pin + restore logic)

**TDD gate:** Unit test that calls the MCP `gate_run` handler directly (or invokes `runGate` with `QUAY_ACCEPTANCE_CWD` unset) against a task with `extra.acceptance: "echo CWD=$PWD"`, passing `cwd: "/tmp/some-worktree"` — asserts the output contains `/tmp/some-worktree`, not `process.cwd()`. Mirrors the CLI's existing `--cwd` test shape.

## Plan

**Execution record (M94 iteration-0, 2026-07-22):**

**Stage 1 — `packages/quay/src/mcp-server.ts` (gate_run handler, lines 417–462):**
- Added `cwd: z.string().optional().describe(...)` to `gate_run` inputSchema (after `file` field).
- Added `cwd` to handler destructure alongside `provider, id, gate, timeoutMs, file`.
- Added `const prevCwd = process.env.QUAY_ACCEPTANCE_CWD;` before the `try` block.
- Replaced bare `process.env.QUAY_ACCEPTANCE_CWD = cfg.workspaceRoot` (line 439) with conditional pin:
  - `if (cwd) { process.env.QUAY_ACCEPTANCE_CWD = cwd; }` (explicit cwd wins)
  - `else if (!process.env.QUAY_ACCEPTANCE_CWD) { process.env.QUAY_ACCEPTANCE_CWD = cfg.workspaceRoot; }` (default to workspaceRoot)
  - `// else: pre-set env var wins — leave untouched (mirrors pinAcceptanceEnv in bin/quay.js:206)`
- Added QUAY_ACCEPTANCE_CWD restore in `finally` block:
  - `if (prevCwd === undefined) delete process.env.QUAY_ACCEPTANCE_CWD; else process.env.QUAY_ACCEPTANCE_CWD = prevCwd;`

**Stage 2 — `packages/quay/test/mcp-server.test.mjs` (block 12, after existing gate_run assertions at line ~1410):**
- Added `worktreeDir = fs.mkdtempSync(...)` (a temp dir distinct from `gateWorkspaceRoot`).
- Created tasks `GATE-CWD-EXPLICIT` and `GATE-CWD-DEFAULT` with `extra.acceptance` that checks `$(pwd)`.
- Added 3 assertions:
  1. `gate_run` with `cwd: worktreeDir` on `GATE-CWD-EXPLICIT` → ok:true (gate ran in worktreeDir).
  2. `gate_run` without `cwd` on `GATE-CWD-EXPLICIT` → ok:false (gate ran in gateWorkspaceRoot, not worktreeDir).
  3. `gate_run` without `cwd` on `GATE-CWD-DEFAULT` → ok:true (default is gateWorkspaceRoot).
- Added `worktreeDir` cleanup to existing `fs.rmSync` block.

**Test run result:** All `mcp-server.test.mjs` assertions pass. Full suite (excluding serve-github, provider-abi-conformance) shows pass:344, fail:4 — the 4 failures are pre-existing (E3/M44 live-workspace tests) and not caused by this change.

## Acceptance Criteria
- [x] `gate_run` MCP tool accepts `cwd` parameter; when supplied, acceptance command runs in that directory (not workspaceRoot/process.cwd())
- [x] `QUAY_ACCEPTANCE_CWD` behavior is deterministic (pre-set env wins, explicit cwd overrides, default falls back to workspaceRoot)
- [x] No regression in existing gate tests

## Definition of Done
References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts:
- [x] `gate_run` MCP cwd parameter confirmed working by TDD: GATE-CWD-EXPLICIT passes with `cwd: worktreeDir` and fails without; GATE-CWD-DEFAULT passes with default.
- [x] TDD per ADR-001: tests written RED before implementation GREEN; decisive regression guard is the explicit-cwd ok:true assertion.
- [ ] Plugin re-vendored + bumped if any plugin scripts were touched (mcp-server.ts is NOT a plugin script; no re-vendor needed).
- [x] Fresh-context adversarial audit: no other gate types have the same cwd-threading gap (lifecycle_complete/lifecycle_promote deferred per plan scope discipline — OUT OF SCOPE for M94).
- [x] Per DIR-026 SPLIT-OR-COMMIT: the cwd-threading fix lands done-or-`needs-human`.

## Not selected (M93)

Not selected M93 — exp5-M-ARCH-AUDIT-M93-EXPLORE selected (mandatory explore slot; this defect is an exploit candidate, deferred to M94+ post-explore reset).
