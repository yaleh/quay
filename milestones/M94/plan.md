# Plan — M94 PROBE-SV-M92-001 (acceptance gate cwd threading fix)

**Milestone:** M94
**Task:** PROBE-SV-M92-001
**Plan authored:** 2026-07-22

## Scope clarification (from check round 1)

The CLI path (`quay gate <task> --gate acceptance --cwd <worktree>`) is ALREADY FIXED — `pinAcceptanceEnv` at `bin/quay.js:206` sets `QUAY_ACCEPTANCE_CWD` from `--cwd` and is called at all CLI gate entry points (lines 1050, 1100, 1129, 1173). AC1 is already satisfied by existing code.

The ONLY remaining gap is the MCP `gate_run` handler (`mcp-server.ts:417`): it has NO `cwd` parameter, so MCP callers cannot pass a worktree path different from `workspaceRoot`.

`lifecycle_complete` (line 511) and `lifecycle_promote` (line 573) have the same bare `QUAY_ACCEPTANCE_CWD = cfg.workspaceRoot` pattern and no `cwd` param. These are **explicitly OUT OF SCOPE for M94** (deferred to a follow-on task) — fixing `gate_run` is the bounded target per PROBE-SV-M92-001 and the charter.

## Stage 1 [code] — MCP gate_run handler: add cwd param + env-var pin

**Files:** `packages/quay/src/mcp-server.ts`

**Lines:** 417–458 (the `gate_run` `registerTool` block)

**Changes:**

1. `inputSchema` (lines 426–432, after the `file` field): add
   `cwd: z.string().optional().describe("Override the acceptance runner's working directory (default: workspaceRoot). Mirrors \`quay gate --cwd\`. Highest precedence over workspaceRoot default.")`

2. Handler signature (line ~434): destructure `cwd` alongside existing `provider, id, gate, timeoutMs, file`.

3. **Before the `try` block** (before line 438): save the current env var:
   `const prevCwd = process.env.QUAY_ACCEPTANCE_CWD;`

4. Env-pin block (line 439 — currently `process.env.QUAY_ACCEPTANCE_CWD = cfg.workspaceRoot`): replace with conditional pin:
   ```
   if (cwd) {
     process.env.QUAY_ACCEPTANCE_CWD = cwd;
   } else if (!process.env.QUAY_ACCEPTANCE_CWD) {
     process.env.QUAY_ACCEPTANCE_CWD = cfg.workspaceRoot;
   }
   // else: pre-set env var wins — leave untouched (mirrors pinAcceptanceEnv in bin/quay.js:206)
   ```

5. `finally` block (lines 452–456 — currently only restores `QUAY_ACCEPTANCE_TIMEOUT_MS`): **add a new QUAY_ACCEPTANCE_CWD restore branch** (the existing finally block has NO QUAY_ACCEPTANCE_CWD logic):
   ```
   if (prevCwd === undefined) delete process.env.QUAY_ACCEPTANCE_CWD;
   else process.env.QUAY_ACCEPTANCE_CWD = prevCwd;
   ```

Note: `pinAcceptanceEnv` lives only in `bin/quay.js:206` (not exported from a module). The 4-line conditional above is inlined with a comment `// mirrors pinAcceptanceEnv in bin/quay.js — see DIR-046`.

**Line budget:** ~12L code (+4L comment)

**TDD acceptance:** Stage 2 tests cover the changed code path; all three branches covered (explicit cwd / pre-set env wins / default workspaceRoot).

---

## Stage 2 [code] — Tests: verify cwd threading through MCP gate_run

**Files:** `packages/quay/test/mcp-server.test.mjs`

**Location:** Append inside existing block 12 (QENG gate/lifecycle MCP tools, line 1339), after existing `gate_run` assertions (lines 1394–1410), before `gate_log`.

**Note on AC1:** The CLI path (`quay gate --cwd`) is ALREADY WORKING and exercised by `gate-ergonomics.test.mjs`. These new tests target the **MCP `cwd` parameter** specifically — not the CLI flag.

**Changes:** Add 3 new `gate_run` cwd assertions:

1. **Explicit cwd wins (MCP path):** Create task `GATE-CWD-EXPLICIT` (status=ready) with `extra.acceptance = 'test "$(pwd)" = "<worktreeDir>"'` where `worktreeDir = mkdtempSync(...)` distinct from `gateWorkspaceRoot`. Call `gate_run` with `{ id: "GATE-CWD-EXPLICIT", cwd: worktreeDir }`. Assert `ok: true`. Also call `gate_run` WITHOUT `cwd` for the same task — assert `ok: false` (it runs in `gateWorkspaceRoot`, not `worktreeDir`).

2. **Default → workspaceRoot:** Create task `GATE-CWD-DEFAULT` (status=ready) with `extra.acceptance = 'test "$(pwd)" = "<gateWorkspaceRoot>"'`. Call `gate_run` without `cwd`. Assert `ok: true`.

3. **Pre-set env wins, not clobbered:** This case (`QUAY_ACCEPTANCE_CWD` already set in outer process) cannot be easily isolated in the MCP subprocess test. Add a code comment explaining this limitation (the case is structurally covered by the conditional `else if (!process.env.QUAY_ACCEPTANCE_CWD)` branch and the CLI-layer tests in `gate-ergonomics.test.mjs`).

**Cleanup:** `worktreeDir` temp dir must be added to the block's existing `fs.rmSync` cleanup (lines 1527–1528 in the block's scope).

**Line budget:** ~30L

**TDD acceptance:** Tests pass; the explicit-cwd assertion (`ok: true` with `cwd: worktreeDir`) is the decisive regression guard.

---

## Stage 3 [prose] — Update PROBE-SV-M92-001 ## Plan section with execution record

**Files:** task body (via `mcp__quay__task_write`)

**Changes:** Replace `## Plan\n\nN/A — quay-task-to-plan pipeline will settle...` with an execution record documenting: what was changed in `mcp-server.ts` (which lines), which test assertions were added in block 12 of `mcp-server.test.mjs`.

**TDD acceptance (prose branch):** Mechanical check — task body `## Plan` is non-empty execution record; `it0-dod-check` gate passes on PROBE-SV-M92-001.

---

## Dependency order

Stage 1 → Stage 2 (tests depend on the implementation) → Stage 3 (prose, after stages 1+2 pass)

---

## Total line budget

~46L total: ~16L stage 1 + ~30L stage 2 + stage 3 (prose, negligible)

---

## Out-of-scope (deferred)

- `lifecycle_complete` (mcp-server.ts:511) and `lifecycle_promote` (mcp-server.ts:573) have the same bare `QUAY_ACCEPTANCE_CWD = cfg.workspaceRoot` pattern and no `cwd` param. Deferred to a follow-on task for scope discipline.
