# Plan 9 — QENG-2: AC-as-runnable-meter (`quay gate` runs `task.acceptance`)

Source proposal: `docs/proposals/proposal-quay-acceptance-meter.md` (read incl. "Architect review notes").
Task + AC checklist: `tasks/QENG-2.md`. Scope: `packages/quay` product code only.

**EXTENDS shipped QENG-1** — reuse verbatim, do NOT rebuild:
`src/gate/engine.js` (`runGate`), `src/gate/registry.js` (`gateRegistry`, `listGates`),
`src/gate/gate-event-store.js`, `src/gate/gate-log.js`, and the `cmd === "gate"` CLI
handler in `bin/quay.js` (L736–748). No new event-log / engine / exit-code plumbing.

**Scope OUT:** QENG-3/4. Do NOT touch `experiments/quay-perpetual-stream/**`.

**Method:** strict TDD (red → green per Stage). Coverage output pasted at execution.
Primary test file: `packages/quay/test/acceptance.test.mjs`.
Primary command:
```
node --test --experimental-test-coverage packages/quay/test/acceptance.test.mjs
```
QENG-1 regression command (must stay green throughout):
```
node --test packages/quay/test/gate.test.mjs
```

---

## Phase A — pure runner + unit tests (≤500 lines; new code ≤~100)

Depends on: nothing. New file `src/gate/acceptance-runner.js` + tests. No CLI, no registry.

### Stage A1 — `src/gate/acceptance-runner.js` (≤~40 lines)
Pure function, exactly the proposal §3 signature:
```
runAcceptance({ command, cwd, timeoutMs = 60000 }) -> { ok, reason, code, signal, timedOut }
```
- `spawnSync(command, { cwd, shell: true, timeout: timeoutMs, killSignal: "SIGKILL", encoding: "utf8", stdio: ["ignore","pipe","pipe"] })`.
- Mapping order (proposal §5, verified node semantics): **ETIMEDOUT first** →
  `{ ok:false, code:null, signal:"SIGKILL", timedOut:true, reason:"acceptance timed out after <ms>ms (killed)" }`;
  then generic `r.error` → `{ ok:false, code:null, signal:r.signal??null, timedOut:false, reason:"acceptance failed to spawn: <msg>" }`;
  then `ok = r.status === 0` → pass `"acceptance passed (exit 0)"` / fail `"acceptance failed (exit <status>[, signal <sig>])"`.

### Stage A2 — unit tests for the runner (≤~120 lines, in `test/acceptance.test.mjs`)
Direct `import { runAcceptance }` — no CLI, real process I/O over a `mkdtemp` cwd:
- `exit 0` → `{ ok:true, code:0, timedOut:false }`.
- `exit 1` → `{ ok:false, code:1, timedOut:false }`.
- `sleep 30` with `timeoutMs: 200` → `{ ok:false, timedOut:true, signal:"SIGKILL", code:null }` (fast, deterministic).
- empty/whitespace handling is the gate fn's job (Phase B), not the runner's.

**Green A:** `node --test --experimental-test-coverage packages/quay/test/acceptance.test.mjs` (A-stage tests pass).

---

## Phase B — wire the gate + CLI (≤500 lines; new code ≤~40, all edits to existing files)

Depends on: Phase A. Edits `src/gate/registry.js` and `bin/quay.js` only. No engine ABI change.

### Stage B1 — register the `acceptance` gate in `src/gate/registry.js` (≤~15 lines)
Add the one `acceptance` gate-fn entry to `gateRegistry` **exactly as proposal §3** (the
`acceptance: async (task) => …` block), keeping the `(task, client) => { ok, reason }`
contract `engine.js` L33 already calls. Import `runAcceptance` from `./acceptance-runner.js`.
Load-bearing points that gate the stage:
- Unset/empty `task.extra?.acceptance` → **fail-closed** with the actionable reason (proposal Risks).
- cwd = `process.env.QUAY_ACCEPTANCE_CWD || process.cwd()`; timeout = `Number(process.env.QUAY_ACCEPTANCE_TIMEOUT_MS) || 60000` — env set by the CLI gate handler (B3).

### Stage B2 — `task edit --acceptance` wiring in `bin/quay.js` (≤~15 lines, per review note 1)
- **Pre-guard (before `withProvider`, near L526–538):** syntactic type check —
  if `flags.acceptance !== undefined && typeof !== "string" && !Array.isArray` → error, exit 1.
  Extend the L538 guard so `--acceptance` counts as patch-producing:
  `... && flags["append-notes"] === undefined && flags.acceptance === undefined`.
- **Read-merge-write INSIDE the `withProvider` callback (near L634, before `client.taskWrite`):**
```
if (flags.acceptance !== undefined) {
  const cmd = Array.isArray(flags.acceptance) ? flags.acceptance.join(" && ") : flags.acceptance;
  const current = await client.taskGet(id);
  patch.extra = { ...(current?.extra ?? {}), ...(patch.extra ?? {}), acceptance: cmd };
}
```
- Add `--acceptance <cmd>` to `printHelp()` `task edit` usage line + flag block.

### Stage B3 — default-gate + cwd in the `gate` handler (≤~5 lines, per review note 2)
Replace `bin/quay.js` L742–745 (inside the `cmd === "gate"` `withProvider` callback, `cfg` in scope):
```
const logPath = resolveGateLogPath(cfg.workspaceRoot, { file: flags.file });
const gate = flags.gate ?? "acceptance";           // no --gate => acceptance; --gate dod => dod
process.env.QUAY_ACCEPTANCE_CWD = cfg.workspaceRoot;
const { ok, reason } = await runGate({ client, id, gate, logPath });
```
Engine's own `gate = "dod"` default is left untouched (only direct programmatic callers hit it).

**Green B:** `node --test --experimental-test-coverage packages/quay/test/acceptance.test.mjs` (registry + CLI edit tests pass)
**+ regression:** `node --test packages/quay/test/gate.test.mjs` (QENG-1 still green — `--gate dod` routes unchanged).

---

## Phase C — fixtures, the four runnable ACs green, coverage ≥80% (≤500 lines)

Depends on: Phase B. Adds end-to-end CLI tests to `test/acceptance.test.mjs`, mirroring
`gate.test.mjs`'s `makeWorkspace()` (mkdtemp root + `.quay/config.yml` native provider,
run with `cwd = workspaceRoot`, invoked via `node bin/quay.js ...`).

### Stage C1 — E2E fixtures + AC1/AC2/AC3 (≤~160 lines)
Each AC below is a runnable command with an exit code, driven through the real CLI over a
disposable workspace. Reproduced **verbatim from `tasks/QENG-2.md`**:

| # | AC (verbatim) | Stage | Runnable check |
|---|---------------|-------|----------------|
| AC1 | `quay task edit X --acceptance 'exit 0'` then `quay gate X` exits 0. | C1 | `node bin/quay.js task edit X --acceptance 'exit 0'` → `node bin/quay.js gate X` ⇒ exit 0, prints `PASS` |
| AC2 | `quay task edit X --acceptance 'exit 1'` then `quay gate X` exits 1. | C1 | `node bin/quay.js task edit X --acceptance 'exit 1'` → `node bin/quay.js gate X` ⇒ exit 1, prints `FAIL` |
| AC3 | Acceptance runs at repo root with an enforced timeout; a hanging command is killed and reported as fail (exit 1). | C1 | `node bin/quay.js task edit X --acceptance 'sleep 30'` → `QUAY_ACCEPTANCE_TIMEOUT_MS=200 node bin/quay.js gate X` ⇒ killed at 200ms, prints `FAIL`, exit 1 |
| AC4 | tests >=80% on the acceptance-runner, actually run (paste output). | C2 | coverage line for `acceptance-runner.js` (+ new registry/CLI lines) ≥80%, output pasted at execution |

Also assert in C1: `--gate dod` on a fixture task still routes to QENG-1's `dod` gate (regression-in-suite).

### Stage C2 — coverage gate (AC4) (≤~20 lines)
Run the coverage command, confirm `acceptance-runner.js` and the new `registry.js` / `bin/quay.js`
lines are ≥80%. **Paste the `--experimental-test-coverage` table into the execution record.**

**Green C:**
```
node --test --experimental-test-coverage packages/quay/test/acceptance.test.mjs   # all ACs + coverage ≥80%
node --test packages/quay/test/gate.test.mjs                                       # QENG-1 regression green
```

---

## Acceptance section (aligned EXACTLY to `tasks/QENG-2.md`)

QENG-2 is Done when all four ACs pass as runnable commands:
- [ ] AC1 — `quay task edit X --acceptance 'exit 0'` then `quay gate X` exits 0. → **Stage C1** (B2+B1+B3).
- [ ] AC2 — `quay task edit X --acceptance 'exit 1'` then `quay gate X` exits 1. → **Stage C1** (B2+B1+B3).
- [ ] AC3 — Acceptance runs at repo root with an enforced timeout; a hanging command is killed and reported as fail (exit 1). → **Stage C1** using `QUAY_ACCEPTANCE_TIMEOUT_MS=200` + `--acceptance 'sleep 30'` (A1 timeout/SIGKILL + B3 cwd).
- [ ] AC4 — tests >=80% on the acceptance-runner, actually run (paste output). → **Stage A2 + C2**, coverage table pasted.

Final verification (implementer runs both, pastes output):
```
node --test --experimental-test-coverage packages/quay/test/acceptance.test.mjs
node --test packages/quay/test/gate.test.mjs
```

## Line budgets
- Stage A1 ≤40 · A2 ≤120 · B1 ≤15 · B2 ≤15 · B3 ≤5 · C1 ≤160 · C2 ≤20 (each ≤200).
- Phase A ≤500 · Phase B ≤500 · Phase C ≤500.
- Net new product code ≤~100 lines (`acceptance-runner.js`) + ~35 lines of edits to existing files.

## Dependencies
A (standalone) → B (needs `runAcceptance`) → C (needs gate + CLI wiring). QENG-1 modules reused as-is throughout.
