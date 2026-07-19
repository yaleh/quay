# Plan 11 — QENG-4: the `quay run` driver (autonomous loop as code)

Source proposal: `docs/proposals/proposal-quay-driver.md` (incl. **Architect review notes** — the
anti-spin `seen`-subtraction fix and the `--once` exit-0 reset are load-bearing).
AC checklist: `tasks/QENG-4.md`. CAPSTONE — composes QENG-1/2/3, reuses, does NOT rebuild:
`packages/quay/src/gate/{lifecycle,engine,registry,gate-event-store,gate-log,acceptance-runner}.js`.
Scope: `packages/quay` only. Do NOT touch `experiments/quay-perpetual-stream/**` (the AC3 POC uses a
self-contained temp-workspace fixture; it never reads/runs/edits exp5).

TDD throughout. Test file: `packages/quay/test/driver.test.mjs`.
Exact command (coverage pasted at execution):
`node --test --experimental-test-coverage packages/quay/test/driver.test.mjs`

---

## Phase A — pure module `packages/quay/src/gate/driver.js` (≤500 lines) — no deps

Imports: `runComplete` (`./lifecycle.js`); `fs`, `path` (node builtins) back the sentinel check.
Adds NO new gate logic; touches NO Provider ABI beyond `taskList` (scan) plus what
`runComplete`/the acceptance gate already use. **CONFIRMED (review note 1):** `client.taskList`
returns full task objects incl. `status` + `extra` (`quay-native/store.js` `list→get→toViewModel`),
so the meter is read off the scan result — the driver does NOT `taskGet` each candidate.

### Stage A1 — `isActionable` + `scanActionable` (≤120 lines) — deps: none
```js
export function isActionable(task)            // status==="ready" AND non-empty trimmed extra.acceptance string
export async function scanActionable(client, seen = new Set())
  // tasks = await client.taskList({ status:"ready" });
  // return tasks.filter(isActionable).map(t=>t.id).filter(id=>!seen.has(id)).sort();
```
`scanActionable` **subtracts `seen`** and **sorts by id ascending** (driver-owned total order, not
relying on `taskList` order). The meter-required predicate makes meterless `ready` tasks *not
actionable → skipped* (never selected, never mutated) — the first anti-spin layer.
Green: `node --test packages/quay/test/driver.test.mjs` — pure unit tests
(`isActionable`: ready+meter true; ready+no-meter/empty/whitespace false; todo+meter false;
`scanActionable`: filters meterless, subtracts `seen`, returns lowest-first sorted ids).

### Stage A2 — `runOnce` (≤80 lines) — deps: A1, `runComplete`
```js
export async function runOnce({ client, logPath, actor = "quay-cli" })
  // const [id] = await scanActionable(client);
  // if (!id) return { processed:null, ok:null, reason:null };   // caller prints "nothing to do"
  // const { ok, reason } = await runComplete({ client, id, logPath, actor });
  // return { processed:id, ok, reason };
```
`--once` is a SINGLE observation with no `seen` state: it always picks the lowest actionable id;
if that task's meter FAILS it stays `ready`, and a subsequent `--once` (fresh process) picks the
SAME task again — **by design** (one process = one deterministic observation), NOT progress on other
tasks. Forward progress across a failing task is `runLoop`'s job (A3).
Green: stub-client unit tests — pass-path (`processed=id, ok=true`), fail-path (`ok=false`, reason
surfaced, task stays `ready`), empty-board (`processed=null`).

### Stage A3 — `runLoop` (≤120 lines) — deps: A1, A2, `runComplete`
```js
export async function runLoop({ client, cfg, logPath, actor = "quay-cli", maxIterations = 1000 })
  // seen=new Set(); completed=[]; stopFile=path.join(cfg.workspaceRoot,".quay",".stop"); iterations=0;
  // loop:
  //   if fs.existsSync(stopFile) return {iterations, completed, stopped:"sentinel"};   // TOP of iteration
  //   if iterations >= maxIterations return {..., stopped:"cap"};
  //   const [id] = await scanActionable(client, seen);
  //   if (!id) return {iterations, completed, stopped:"fixpoint"};
  //   iterations++; seen.add(id);                         // attempted (pass OR fail) → seen
  //   const { ok } = await runComplete({ client, id, logPath, actor });
  //   if (ok) completed.push(id);
```
**Anti-spin CORRECTION (review note 2 — load-bearing):** an attempted id is added to `seen`; because
`scanActionable` subtracts `seen`, a failing-meter `ready` task is attempted at most once per run and
the scan drains to `[]` → **clean fixpoint** (not cap), while OTHER ready tasks still make forward
progress. Three independent stops: **sentinel** (top-of-iteration `.quay/.stop`, clean boundary, never
mid-write) · **fixpoint** (scan returns `[]`, the normal exit) · **cap** (`maxIterations` 1000, hard
ceiling, the only nonzero-mapped outcome).
Module surface exported: `isActionable`, `scanActionable`, `runOnce`, `runLoop`.
Green: stub-client unit tests — fixpoint (two passing tasks → both completed, `stopped:"fixpoint"`);
sentinel (`.stop` pre-created → `iterations:0, stopped:"sentinel"`); failing-meter task attempted
once then fixpoint (NOT cap); `maxIterations:1` cap path → `stopped:"cap"`. **Every loop test is
bounded/sentinel-terminated so it cannot hang.**

**Unit-test harness (Phase A)** — stub client + tmp `logPath` + tmp `cfg.workspaceRoot`
(mirrors `test/lifecycle.test.mjs`):
```js
function stubClient(tasks) {   // tasks: [{id,status,extra}]
  const state = new Map(tasks.map(t => [t.id, { ...t }]));
  return {
    async taskList({ status }) { return [...state.values()].filter(t => !status || t.status === status).map(t => ({ ...t })); },
    async taskGet(id) { return { ...state.get(id) }; },
    async taskCheck(id) { const m = state.get(id)?.extra?.acceptance; return { ok: m === "true", reason: "stub" }; },
    async taskWrite({ id, status, expectedStatus }) { const t = state.get(id); if (expectedStatus && t.status !== expectedStatus) throw new Error("ConflictError"); t.status = status; return { ...t }; },
    _state: state,
  };
}
```
Phase A green (all pure/stub tests): `node --test packages/quay/test/driver.test.mjs`

---

## Phase B — CLI wiring in `bin/quay.js` (≤180 lines) — deps: Phase A

### Stage B1 — verb-less `run` command (≤120 lines) — deps: A2, A3
Add a `cmd === "run"` branch beside `complete` (`bin/quay.js` ~line 824), mirroring it in plumbing:
NO positional id; `--once` flag; `withProvider(async (client, cfg) => {...})`;
`logPath = resolveGateLogPath(cfg.workspaceRoot, { file: flags.file })`;
`process.env.QUAY_ACCEPTANCE_CWD = cfg.workspaceRoot`.
```js
if (cmd === "run") {
  await withProvider(async (client, cfg) => {
    const logPath = resolveGateLogPath(cfg.workspaceRoot, { file: flags.file });
    process.env.QUAY_ACCEPTANCE_CWD = cfg.workspaceRoot;
    if (flags.once) {
      const r = await runOnce({ client, logPath });
      if (!r.processed) console.log("nothing to do");
      else console.log(`${r.processed}: ${r.ok ? "PASS — done" : `FAIL — ${r.reason} (left ready)`}`);
      process.exitCode = 0;                       // CRITICAL — see B2
    } else {
      const r = await runLoop({ client, cfg, logPath });
      console.log(`run: ${r.completed.length} completed in ${r.iterations} iters (stop=${r.stopped})`);
      if (r.stopped === "cap") process.exitCode = 1;   // ONLY the safety ceiling is nonzero
    }
  }, { providerId: flags.provider });
  return;
}
```
Import `{ runOnce, runLoop }` from `../src/gate/driver.js`. `--file` overrides the GateEvent log path,
consistent with `complete`/`gate`.

### Stage B2 — `--once` exit-0 reset + usage (≤60 lines) — deps: B1
**CRITICAL (review note 3):** `runComplete` sets `process.exitCode = 1` on a meter fail. AC1 requires
`quay run --once` to exit **0** (a fail leaves the task `ready` + records a GateEvent — a successful
driver OBSERVATION, not a driver error). So the `--once` branch MUST reset `process.exitCode = 0`
AFTER `runOnce` returns (already in B1's snippet — verify no path skips it). `runLoop` needs no reset:
it never surfaces an individual `runComplete`'s exit code; only `stop==="cap"` maps to exit 1.
Update the usage-fallback string + `--help` to list the `run` verb (`run [--once]`).
Green: `node --test packages/quay/test/driver.test.mjs` — CLI E2E cases (Phase C) go red→green here.

---

## Phase C — E2E fixtures + AC + coverage (≤200 lines) — deps: Phase B

### Stage C1 — real-workspace fixtures (≤80 lines) — deps: B1
`makeWorkspace(tag)` copied from `test/lifecycle.test.mjs` (native provider MAP form with `mcp_entry`,
`tasks_dir`, `env.QUAY_NATIVE_TASKS_DIR`); `runQuay(args, cwd)` returning `{status, stdout, stderr}`.
Actionable fixtures seeded via `quay task edit <id> --status ready --acceptance '<cmd>'`
(passing meter = `true`, failing = `false`). Helper to create the `<workspaceRoot>/.quay/.stop`
sentinel file for AC2.

### Stage C2 — AC E2E cases, each mapped to a Stage (≤120 lines) — deps: C1
Every AC verbatim from `tasks/QENG-4.md`, a runnable command with an exit code:

- **AC1** (Stage A2/B) — `quay run --once` processes one ready task end-to-end (scan→gate→complete),
  exit **0**. Seed one actionable task `A {status:ready, extra.acceptance:"true"}`;
  `quay run --once; echo $?` → `A: PASS — done` and `0`, and `quay task view A` shows `[done]`.
  A second `quay run --once` (A now `done`, no other actionable) → `nothing to do` and `0` (fixpoint).
  Determinism: with two actionable tasks the LOWEST id is selected (scan sorts by id).
- **AC2** (Stage A3/B) — `quay run` honors the stop sentinel: with `<workspaceRoot>/.quay/.stop`
  present before the run, `quay run; echo $?` exits cleanly at the top of the first iteration (**0**),
  reporting `stop=sentinel`. A normal fixpoint (no actionable tasks) likewise exits **0**; only the
  runaway `stop=cap` case exits nonzero (**1**).
- **AC3 POC** (Stage A2, in `driver.test.mjs`) — one exp5 OUTER-LOOP ABSORB step expressed as a
  `quay run --once` invocation reproducing the same board transition (`ready` + passing meter → gate
  runs → `done`) on a **self-contained quay temp-workspace fixture** (`POC-1 {status:ready,
  extra.acceptance:"true"}`, built via the native provider as `lifecycle.test.mjs` does). Asserts
  `taskGet(POC-1).status === "done"` + a `complete` pass GateEvent. exp5 is referenced as prose only,
  never read/run/edited; does NOT touch `experiments/quay-perpetual-stream/**`. **The loop-bearing
  tests are bounded/sentinel-terminated so they cannot hang.**
- **AC4** (this Stage) — coverage ≥80% on `driver.js` via
  `node --test --experimental-test-coverage packages/quay/test/driver.test.mjs`, output pasted into DoD.

### Stage C3 — coverage gate + regression (≤20 lines) — deps: C2
Coverage green: `node --test --experimental-test-coverage packages/quay/test/driver.test.mjs`
→ `driver.js` line coverage ≥80% (paste table).
**REGRESSION (QENG-1/2/3 intact):**
`node --test packages/quay/test/gate.test.mjs packages/quay/test/acceptance.test.mjs packages/quay/test/lifecycle.test.mjs`

---

## Commands the implementer runs

| Purpose | Command |
| --- | --- |
| Phase A/B/C TDD + AC4 coverage | `node --test --experimental-test-coverage packages/quay/test/driver.test.mjs` |
| AC1 | `quay run --once` on `A {ready, acceptance:"true"}` → `A: PASS — done`, exit 0; re-run → `nothing to do`, exit 0 |
| AC2 | create `<workspaceRoot>/.quay/.stop`, then `quay run; echo $?` → `stop=sentinel`, exit 0 (fixpoint also exit 0; `cap` exit 1) |
| AC3 POC | `driver.test.mjs` temp-workspace fixture `POC-1 {ready, acceptance:"true"}` → `quay run --once` → `taskGet(POC-1).status==="done"` + `complete` pass GateEvent (never touches exp5) |
| AC4 | coverage ≥80% on `driver.js` (paste table) |
| REGRESSION | `node --test packages/quay/test/gate.test.mjs packages/quay/test/acceptance.test.mjs packages/quay/test/lifecycle.test.mjs` |
