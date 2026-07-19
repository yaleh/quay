# Plan 10 — QENG-3: complete / adjudicate / promote / retreat lifecycle

Source proposal: `docs/proposals/proposal-quay-lifecycle.md` (incl. Architect review notes —
`complete` requires `status==="ready"` precondition, else exit 1 / no gate / no write).
AC checklist: `tasks/QENG-3.md`. BUILDS ON QENG-1/2 — reuses, does NOT rebuild:
`packages/quay/src/gate/{engine,registry,gate-event-store,gate-log,acceptance-runner}.js`.
Scope: `packages/quay` only. OUT: QENG-4 (`quay run` driver). Do NOT touch `experiments/quay-perpetual-stream/**`.

TDD throughout. Test file: `packages/quay/test/lifecycle.test.mjs`.
Exact command (coverage pasted at execution):
`node --test --experimental-test-coverage packages/quay/test/lifecycle.test.mjs`

---

## Phase A — pure module `packages/quay/src/gate/lifecycle.js` (≤500 lines) — no deps

### Stage A1 — transition table + pure helpers (≤120 lines)
New file `packages/quay/src/gate/lifecycle.js`. Imports: `runGate` (engine.js),
`appendGateEvent` (gate-event-store.js), `randomUUID` (node:crypto).
```js
export const TRANSITIONS = {
  todo:          { forward: "ready", back: null },
  ready:         { forward: "done",  back: "todo" },
  done:          { forward: null,    back: "ready" },
  "needs-human": { forward: null,    back: null },
};
export function legalForward(status)            // → next|null
export function legalBack(status)               // → prev|null
export function assertTransition(status, dir)   // throws Error(`illegal transition: ${status} cannot ${dir}`) on null edge
```
Green: `node --test packages/quay/test/lifecycle.test.mjs` — table/helper unit tests
(`todo.back===null`, `done.forward===null`, `needs-human` both null; `assertTransition` throws on each null edge, no-throw on legal).

### Stage A2 — `runComplete` (≤120 lines) — deps: A1, `runGate`
`export async function runComplete({client, id, logPath, actor})`:
1. `task = await client.taskGet(id)`; if `task.status !== "ready"` →
   print `illegal transition: ${task.status} cannot complete (must be ready)`,
   `process.exitCode = 1`, return `{ok:false, reason}` — NO gate, NO write.
2. `{ok, reason} = await runGate({client, id, gate:"acceptance", logPath, actor})`.
3. `!ok` → print `FAIL — ${reason}`, `process.exitCode = 1`, return — status unchanged.
4. `ok` → `await client.taskWrite({id, status:"done", expectedStatus:"ready"})`;
   `appendGateEvent(logPath, {id:randomUUID(), item_id:id, pipeline_id:id, gate:"complete",
   actor, verdict:"pass", timestamp:new Date().toISOString(), payload:{from:"ready", to:"done"}})`;
   print `PASS — status=done`; return `{ok:true, reason}`.
Green: stub-client unit tests (below) — asserts precondition-reject (todo→no write/no gate),
fail-path (ready stays ready, 1 acceptance GateEvent), pass-path (status=done, exactly 2 events: `acceptance` then `complete`).

### Stage A3 — `runAdjudicate` + `runPromote` + `runRetreat` (≤160 lines) — deps: A1, A2, `runGate`
```js
export async function runAdjudicate({client, id, logPath, actor}) // read-only
  // r = await client.taskCheck(id); task = await client.taskGet(id);
  // appendGateEvent {gate:"audit", verdict: r.ok?"pass":"fail",
  //   payload:{reason:r.reason, observed_status: task.status}}
  // print `AUDIT ${r.ok?"pass":"fail"} — ${r.reason}`; exit 0 always; NO status write.

export async function runPromote({client, id, logPath, actor})
  // task = await client.taskGet(id); assertTransition(task.status,"forward"); next = legalForward(...)
  // ready→done: delegate to runComplete (single gate-guarded path to done)
  // todo→ready: runGate gate:"dod"; !ok → exit 1, no write; ok → taskWrite({id,status:next,
  //   expectedStatus:task.status}) + appendGateEvent {gate:"promote", payload:{from,to:next}}

export async function runRetreat({client, id, reason, logPath, actor})
  // reason required: missing/empty → print usage err, exit 1, NO write
  // task = await client.taskGet(id); assertTransition(task.status,"back"); prev = legalBack(...)
  // taskWrite({id,status:prev,expectedStatus:task.status}) + appendGateEvent
  //   {gate:"retreat", payload:{from:task.status, to:prev, reason}}; print `RETREAT ${status} → ${prev} (${reason})`; NO gate.
```
Module surface exported (proposal §"Module surface"): `TRANSITIONS`, `legalForward`, `legalBack`,
`assertTransition`, `runComplete`, `runAdjudicate`, `runPromote`, `runRetreat`.
Green: `node --test packages/quay/test/lifecycle.test.mjs` — stub-client unit tests for all three
(adjudicate logs `audit` event + exit 0; promote `done` throws illegal; retreat `todo` throws illegal; retreat missing reason → exit 1 no write).

**Unit-test harness (Phase A tests)** — stub client + tmp `logPath` (mirrors `test/gate.test.mjs` Phase A):
```js
function stubClient(task) {
  const state = { ...task };
  return {
    async taskGet() { return { ...state }; },
    async taskCheck() { return { ok: state.status === "ready" ? false : true, reason: "stub" }; },
    async taskWrite({ status, expectedStatus }) {
      if (expectedStatus && state.status !== expectedStatus) throw new Error("ConflictError");
      state.status = status; return { ...state };
    },
    _state: state,
  };
}
function tmpLog(tag){ return path.join(fs.mkdtempSync(path.join(os.tmpdir(),`quay-qeng3-${tag}-`)),"gate-events.jsonl"); }
```
Read appended events back via `queryGateEvents(logPath, {pipeline_id:id})` from gate-event-store.js
(the store's filter key is `pipeline_id`, snake_case — the `pipelineId` camelCase alias exists ONLY on the CLI wrapper `runGateLogQuery`/`gate-log.js`).
Phase A green (all pure/stub tests): `node --test packages/quay/test/lifecycle.test.mjs`

---

## Phase B — CLI wiring in `bin/quay.js` (≤180 lines) — deps: Phase A

### Stage B1 — four verb-less commands (≤120 lines) — deps: A2, A3
Add four branches beside the `gate` branch (`bin/quay.js` ~line 762), each mirroring it:
`id = sub`; `withProvider(async (client, cfg) => { logPath = resolveGateLogPath(cfg.workspaceRoot, {file: flags.file}); ... })`;
`process.env.QUAY_ACCEPTANCE_CWD = cfg.workspaceRoot` (before `complete`/`promote`, as `gate` does);
each `run*` sets `process.exitCode` itself.
```
if (cmd === "complete")   { const id=sub; await withProvider(async(client,cfg)=>{ …; await runComplete({client,id,logPath}); }, {providerId:flags.provider}); return; }
if (cmd === "adjudicate") { … runAdjudicate({client,id,logPath}); }
if (cmd === "promote")    { …QUAY_ACCEPTANCE_CWD; runPromote({client,id,logPath}); }
if (cmd === "retreat")    { …runRetreat({client,id,reason:flags.reason,logPath}); }
```
Import `{runComplete,runAdjudicate,runPromote,runRetreat}` from `../src/gate/lifecycle.js`.

### Stage B2 — illegal-transition → nonzero + message (≤60 lines) — deps: B1
Top-level `main().catch` (quay.js:806) already prints `err.stack` + sets `process.exitCode=1`;
`assertTransition`'s throw surfaces there → nonzero + `illegal transition: …` message. Verify no
branch swallows it. Update usage-fallback string (quay.js:802) + `--help` to list the 4 verbs.
Green: `node --test packages/quay/test/lifecycle.test.mjs` — CLI E2E cases (Phase C) go red→green here.

---

## Phase C — E2E fixtures + AC + coverage (≤200 lines) — deps: Phase B

### Stage C1 — real-workspace fixtures (≤80 lines) — deps: B1
`makeWorkspace(tag)` copied from `test/gap-cli-gate-enforcement.test.mjs` (native provider MAP form
WITH `mcp_entry`, `tasks_dir`, `env.QUAY_NATIVE_TASKS_DIR`); `runQuay(args, cwd)` returning
`{status, stdout, stderr}`; `runNative(args, tasksDir)`. Fixtures created via
`quay task edit <id> --status ready --acceptance '<cmd>'` (passing meter = `true`, failing = `false`).

### Stage C2 — AC E2E cases, each mapped to a Stage (≤120 lines) — deps: C1
Every AC is a runnable command with an exit code (verbatim from `tasks/QENG-3.md`):

- **AC1** (Stage A2) — `complete` fail/pass/precondition, both fixtures start `status=ready`:
  - `quay complete <ready+failing-meter>` → **exit 1**, status stays `ready`, fail GateEvent logged.
  - `quay complete <ready+passing-meter>` → **exit 0**, `status=done`, pass GateEvent logged.
  - precondition-reject: `quay complete <todo-task>` → **exit 1**, status unchanged, NO gate run.
- **AC2** (Stage A3/adjudicate) — `quay adjudicate <id>` → **exit 0**; then
  `quay gate-log <id> --gate audit --json` lists the `audit` GateEvent.
- **AC3** (Stage A1/A3) — illegal transition → nonzero + clear message:
  `quay retreat <todo-task> --reason x` → **nonzero**, message `illegal transition: todo cannot back`;
  and `quay promote <done-task>` → **nonzero**, `illegal transition: done cannot forward`.
- **AC4** (this Stage) — coverage ≥80% on `lifecycle.js` via
  `node --test --experimental-test-coverage packages/quay/test/lifecycle.test.mjs`, output pasted into DoD.

### Stage C3 — coverage gate + regression (≤20 lines) — deps: C2
Coverage green: `node --test --experimental-test-coverage packages/quay/test/lifecycle.test.mjs`
→ `lifecycle.js` line coverage ≥80% (paste table).
**REGRESSION (QENG-1/2 intact):** `node --test packages/quay/test/gate.test.mjs packages/quay/test/acceptance.test.mjs`

---

## Commands the implementer runs

| Purpose | Command |
| --- | --- |
| Phase A/B/C TDD + AC4 coverage | `node --test --experimental-test-coverage packages/quay/test/lifecycle.test.mjs` |
| AC1 fail | `quay complete <ready+failing-meter>` → exit 1, status stays `ready` |
| AC1 pass | `quay complete <ready+passing-meter>` → exit 0, status=done |
| AC1 precondition | `quay complete <todo-task>` → exit 1, status unchanged, no gate |
| AC2 | `quay adjudicate <id>` → exit 0; `quay gate-log <id> --gate audit --json` shows `audit` event |
| AC3 | `quay retreat <todo> --reason x` → nonzero `illegal transition: todo cannot back`; `quay promote <done>` → nonzero `illegal transition: done cannot forward` |
| REGRESSION | `node --test packages/quay/test/gate.test.mjs packages/quay/test/acceptance.test.mjs` |
