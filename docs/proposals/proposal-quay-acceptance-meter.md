# Proposal: QENG-2 — AC-as-runnable-meter (`quay gate` runs `task.acceptance`)

AC checklist: `tasks/QENG-2.md`. Scope: `packages/quay` product code only.
QENG-3/4 and `experiments/quay-perpetual-stream/**` are OUT of scope.

## Background (extends QENG-1)

QENG-1 shipped the gate engine — `runGate` (`src/gate/engine.js`), the `dod` gate
(`src/gate/registry.js`), the append-only GateEvent log (`src/gate/gate-event-store.js`,
`src/gate/gate-log.js`), and the `quay gate <task> [--gate <name>]` CLI wiring
(`bin/quay.js`, the `cmd === "gate"` handler). That plumbing is reused verbatim.
QENG-2 adds one field (`acceptance`) and one gate (`acceptance`) that runs it — epicd
ADR-019's "runnable meter" (harness `runShellCommands`/`Bun.spawn`; adapted to Node).
No new event-log, engine, or exit-code plumbing is introduced.

## Goals

- Store a runnable shell command on a task and execute it from `quay gate`.
- Child exit code → verdict, with an enforced timeout that kills a hanging command.
- `quay gate <task>` (no `--gate`) defaults to `acceptance`; `--gate dod` still works.

## Non-goals

- No change to the Provider ABI surface (`task_get`/`task_write`/`task_check`).
- No shell allow-listing / container sandbox — cwd-scoped + timeout only (see Risks).
- No new gate-event schema; the existing `{ ok, reason }` → GateEvent path is reused.

## Design

### 1. Storage: `extra.acceptance` (no ABI change)

`acceptance` lives in `extra.acceptance` (a string), NOT a new first-class frontmatter
field. Justification: `store.js#write()` already round-trips `extra` untouched
(`if (extra !== undefined) frontmatter.extra = extra`, L474; `toViewModel` returns
`extra: frontmatter.extra ?? {}`, L248), and `provider-client.js#taskWrite` forwards it
generically. So `task.extra.acceptance` is readable by any gate fn today with **zero**
change to `store.js`, the MCP ABI, or the view-model shape. A first-class field would
require editing the `write()` destructure, `toViewModel`, and the Provider ABI surface —
rejected as unnecessary churn. Value is a single string; a trivial list is joined with
`&&` at edit time (see §2), so the stored value is always one string the gate runs as-is.

### 2. `quay task edit <id> --acceptance '<cmd>'`

Wire one flag in the existing `task edit` handler (`bin/quay.js`, `cmd === "task" && sub === "edit"`).
It sets `extra.acceptance` via a read-merge-write so it does not clobber other `extra` keys.
Two placement facts drive the wiring (verified against real `bin/quay.js`):

- The "at least one of…" guard (L538) runs **before** `withProvider`, and the merge needs
  `client.taskGet(id)` (only available inside `withProvider`). So the guard must count
  `--acceptance` **syntactically** (flag present), and the merge must happen inside the
  `withProvider` callback where `client` exists — not in the pre-guard patch block.

```js
// (a) pre-guard validation + guard participation, BEFORE withProvider (near L526–538):
if (flags.acceptance !== undefined
    && typeof flags.acceptance !== "string" && !Array.isArray(flags.acceptance)) {
  console.error("quay task edit: --acceptance requires a command string");
  process.exitCode = 1; return;
}
// guard (L538): treat --acceptance as patch-producing:
//   Object.keys(patch).length === 0 && flags["append-notes"] === undefined
//   && flags.acceptance === undefined
```
```js
// (b) read-merge-write INSIDE withProvider, before the taskWrite call (near L634):
if (flags.acceptance !== undefined) {
  const cmd = Array.isArray(flags.acceptance) ? flags.acceptance.join(" && ") : flags.acceptance;
  const current = await client.taskGet(id);              // merge into existing extra
  patch.extra = { ...(current?.extra ?? {}), ...(patch.extra ?? {}), acceptance: cmd };
}
```

Add `--acceptance` to `printHelp()`'s `task edit` block and the help usage line.

### 3. The `acceptance` gate (`src/gate/registry.js`)

Add one entry to `gateRegistry`, keeping the `(task, client) => { ok, reason }` contract
QENG-1's engine already calls (`engine.js` L33). It runs the command in a runner and maps
exit → verdict. Signature of the runner (new file `src/gate/acceptance-runner.js`):

```js
// runAcceptance({ command, cwd, timeoutMs }) -> { ok, reason, code, signal, timedOut }
import { spawnSync } from "node:child_process";
export function runAcceptance({ command, cwd, timeoutMs = 60000 }) {
  const r = spawnSync(command, {
    cwd, shell: true, timeout: timeoutMs, killSignal: "SIGKILL",
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.error && r.error.code === "ETIMEDOUT")
    return { ok: false, code: null, signal: "SIGKILL", timedOut: true,
             reason: `acceptance timed out after ${timeoutMs}ms (killed)` };
  if (r.error)
    return { ok: false, code: null, signal: r.signal ?? null, timedOut: false,
             reason: `acceptance failed to spawn: ${r.error.message}` };
  const ok = r.status === 0;
  return { ok, code: r.status, signal: r.signal ?? null, timedOut: false,
           reason: ok ? "acceptance passed (exit 0)"
                      : `acceptance failed (exit ${r.status}${r.signal ? `, signal ${r.signal}` : ""})` };
}
```

Gate fn (registry.js) — reads `extra.acceptance`, passes `workspaceRoot` as cwd:

```js
acceptance: async (task) => {
  const command = task.extra?.acceptance;
  if (typeof command !== "string" || command.trim() === "")
    return { ok: false, reason: "no acceptance command defined (set with `quay task edit <id> --acceptance '<cmd>'`)" };
  const cwd = process.env.QUAY_ACCEPTANCE_CWD || process.cwd();
  const timeoutMs = Number(process.env.QUAY_ACCEPTANCE_TIMEOUT_MS) || 60000;
  const { ok, reason } = runAcceptance({ command, cwd, timeoutMs });
  return { ok, reason };
},
```

cwd = repo/workspace root. The engine passes only `(task, client)`, so the gate resolves
cwd itself: `QUAY_ACCEPTANCE_CWD` (set by the CLI handler to `cfg.workspaceRoot`) else
`process.cwd()`. The CLI `gate` handler (`bin/quay.js`) sets `process.env.QUAY_ACCEPTANCE_CWD = cfg.workspaceRoot`
before `runGate` — this keeps the registry's `(task, client)` signature unchanged (no
engine ABI edit) while pinning cwd deterministically. Timeout likewise overridable via
`QUAY_ACCEPTANCE_TIMEOUT_MS` (used by the tests to force a short timeout).

### 4. Default-gate resolution (`acceptance`, but `--gate dod` still works)

`engine.js#runGate` defaults `gate = "dod"` (L28). The real CLI handler (`bin/quay.js` L743)
currently passes `gate: flags.gate` verbatim — so today, no `--gate` reaches `runGate` as
`undefined` and falls back to `dod`. QENG-2 changes the default at the **CLI** layer only
(engine keeps its explicit-arg contract), inside the existing `withProvider` callback so
`cfg` is in scope:

```js
// replaces L742–745 in the `cmd === "gate"` handler:
const logPath = resolveGateLogPath(cfg.workspaceRoot, { file: flags.file });
const gate = flags.gate ?? "acceptance";   // no --gate => acceptance; --gate dod => dod
process.env.QUAY_ACCEPTANCE_CWD = cfg.workspaceRoot;
const { ok, reason } = await runGate({ client, id, gate, logPath });
```

`quay gate X` → `acceptance`; `quay gate X --gate dod` → QENG-1's `dod` gate unchanged;
`quay gate --list` prints both. `runGate`'s own `gate = "dod"` default is left as-is (only
reached by direct programmatic callers, out of scope), so QENG-1 tests stay green.

### 5. Timeout / kill (deterministic, testable)

`spawnSync(..., { shell: true, timeout: timeoutMs, killSignal: "SIGKILL" })`: on timeout Node
kills the child and the result object carries **both** signals at once (verified, node v25.8.0):
`status === null`, `signal === "SIGKILL"`, **and** `error.code === "ETIMEDOUT"`. The runner keys
off `error.code === "ETIMEDOUT"` first (correct — that branch is unambiguous and precedes the
generic `r.error` and `r.status === 0` checks). A normal failing command is `status !== 0` with
no `error`; a clean pass is `status === 0`; a spawn failure (e.g. bad shell) is `r.error` with a
non-ETIMEDOUT code. All three non-pass shapes map to `{ ok: false }` → verdict `fail`
→ CLI `process.exitCode = 1`; only `status === 0` maps to pass.
Deterministic test (AC 3): `--acceptance 'sleep 30'` with `QUAY_ACCEPTANCE_TIMEOUT_MS=200`
→ killed at 200ms → `quay gate X` prints `FAIL` and exits 1. `spawnSync` (not async `spawn`)
keeps the runner a pure, synchronously-testable function driving real process I/O.

## Acceptance Criteria (verbatim from `tasks/QENG-2.md`)

- [ ] `quay task edit X --acceptance 'exit 0'` then `quay gate X` exits 0.
- [ ] `quay task edit X --acceptance 'exit 1'` then `quay gate X` exits 1.
- [ ] Acceptance runs at repo root with an enforced timeout; a hanging command is killed and reported as fail (exit 1).
- [ ] tests >=80% on the acceptance-runner, actually run (paste output).

Mapped: AC1/AC2 → §2 + §3 + §4 (exit code propagated verbatim via §4 `process.exitCode`).
AC3 → §3 cwd + §5 timeout/SIGKILL. AC4 → `runAcceptance` is a small pure module; the test
drives it over a tmp cwd with `exit 0`, `exit 1`, and `QUAY_ACCEPTANCE_TIMEOUT_MS=200` + `sleep 30`.

## Trade-offs

- **`extra.acceptance` vs first-class field**: chosen for zero ABI/store change; cost is
  one extra dereference (`task.extra?.acceptance`) and no schema-level validation. Accepted.
- **`spawnSync` vs async `spawn`**: gates are one-shot CLI calls, not a hot loop; sync
  keeps the runner a trivially-testable pure function and the timeout/kill semantics
  built-in. Accepted.
- **`shell: true`**: required so an author can write a real command (`&&`, pipes). This is
  a command-execution surface — see Risks.
- **cwd via `QUAY_ACCEPTANCE_CWD` env (side channel)**: honestly a side channel — the gate
  reads process env instead of receiving cfg through the engine. Accepted for v0 because the
  clean alternative (thread `cfg`/`opts` through `runGate` → `fn(task, client, opts)`) is a
  QENG-1 engine-ABI change touching the `dod` gate and its tests — out of scope here. The env
  is set immediately before `runGate` in the one CLI handler and read once; no concurrency
  concern (single one-shot CLI process). Revisit if a second gate ever needs cfg.

## Risks

- **Arbitrary command execution.** `acceptance` runs whatever string is stored, with the
  caller's privileges. This is the feature (a runnable meter), but it means running an
  untrusted task's gate executes untrusted code. Mitigation for v0: cwd is pinned to
  `workspaceRoot`; document that `quay gate` runs `task.acceptance` as-is. Container/allow-list
  sandboxing is explicitly deferred (Non-goals).
- **Unset acceptance verdict (decision).** If `extra.acceptance` is unset/empty → **fail**
  with reason `"no acceptance command defined (…)"`. Justification: `quay gate X` defaults
  to `acceptance`, so a silent pass on a task with no meter would let unverified work slip
  through the default gate — the exact verifiability hole QENG-2 closes. Fail-closed with an
  actionable reason (points at `--acceptance`) is safer than a distinct non-fail "unset" verdict.
- **Log-path / default-gate drift.** Default resolves in one place (CLI `flags.gate ?? "acceptance"`);
  engine default untouched, so no split-brain with QENG-1's `dod`.
- **Timeout portability.** `killSignal: "SIGKILL"` is POSIX; tests pin `QUAY_ACCEPTANCE_TIMEOUT_MS`
  low so AC3 is fast and deterministic on CI.

## Architect review notes

Reviewed against real `bin/quay.js`, `src/gate/engine.js`, `src/gate/registry.js`,
`store.js`, `provider-client.js`. Changes made:
1. §2: fixed an ordering bug — the "at least one of…" guard (L538) runs *before*
   `withProvider`, but the `extra` merge needs `client.taskGet`. Split into a
   pre-guard syntactic check + an in-callback read-merge-write near L634.
2. §4: corrected to match real code — L743 passes bare `gate: flags.gate` today
   (not `?? "acceptance"`); showed the exact L742–745 replacement, `cfg` in scope.
3. §5: verified Node timeout semantics on node v25.8.0 — timeout sets BOTH
   `status===null && signal==="SIGKILL"` AND `error.code==="ETIMEDOUT"`; runner's
   ETIMEDOUT-first ordering is correct. Documented all four exit shapes.
4. Trade-offs: flagged `QUAY_ACCEPTANCE_CWD` as an honest side channel, named the
   clean alternative (thread cfg through `runGate`), scoped it out with reason.
Confirmed: `extra.acceptance` round-trips with NO Provider ABI change; `--gate dod`
stays green (explicit arg still routes to `dod`, `runGate`'s default untouched).
