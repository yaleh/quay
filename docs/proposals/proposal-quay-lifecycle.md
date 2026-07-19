# Proposal: QENG-3 — phase pipeline + complete/adjudicate/retreat lifecycle

AC checklist: `tasks/QENG-3.md`. Depends on QENG-1 + QENG-2 (both DONE on master).

## Background (builds on QENG-1/2)

QENG-1 shipped the gate engine (`engine.js#runGate`, `registry.js`,
`gate-event-store.js`) + verb-less `quay gate`/`gate-log`. QENG-2 added the CLI-default
`acceptance` gate (runnable meter in `task.extra.acceptance`). quay's status model
(`quay-native/src/store.js#check()`) is `{todo, ready, done, needs-human}`, status-relative:
`todo→author→ready`, `ready→execute→done`, `done`=terminal, `needs-human`=soft-stop. QENG-3
adds a thin layer that *writes* status (which the engine and `check()` never do) behind
gate + legal-transition guards, plus an independent adjudication pass. No new gate logic,
no Provider ABI change.

## Goals

- `quay complete <task>` — precondition `status=ready`; run acceptance gate; on pass set
  `status=done` and log a pass GateEvent; on fail exit 1, status UNCHANGED, log a fail
  GateEvent. Not-`ready` → exit 1, no gate, no write (`store.write` does not enforce edges).
- `quay adjudicate <task>` — independent audit pass logging an `audit` GateEvent
  visible in `quay gate-log`.
- `quay promote <task>` / `quay retreat <task> --reason <r>` — one legal step
  forward/back over an explicit transition table; illegal transition → nonzero exit.
- `src/gate/lifecycle.js` module with tests ≥80% (actually run, output pasted).

## Non-goals

- QENG-4 (`quay run` driver) — OUT of scope; no autonomous loop, no worktree/merge.
- No epicd multi-phase pipeline data model (`implementing/awaiting-children/…`).
  quay's `{todo, ready, done, needs-human}` statuses ARE the phases — we reuse them,
  not port epicd's `Pipeline`/`PipelineState`.
- No retreat gap-fingerprint/three-way-contract/`gap_history` machinery
  (epicd `retreat.ts` schema #2/#3) — a v0 retreat is one legal step + a reason.
- No Provider ABI change: only existing `client.taskGet/taskWrite/taskCheck`
  (`src/provider-client.js`) are used. No `experiments/**` code.

## Design

New module `packages/quay/src/gate/lifecycle.js`, sibling to `engine.js`, reusing its
imports (`gateRegistry`, `appendGateEvent`, `randomUUID`). Four new verb-less commands in
`bin/quay.js` alongside `gate`/`gate-log`, using the same `withProvider(fn)→fn(client,cfg,
provider)` + `process.exitCode = ok?0:1` plumbing and `id = sub` extraction.

### The legal-transition table

Legal edges are the forward gate transitions `check()` already models, plus their one-step
inverses for retreat — an explicit adjacency map in `lifecycle.js`:

```js
// direction: forward = promote target, back = retreat target
export const TRANSITIONS = {
  todo:          { forward: "ready", back: null },        // author gate (check todo→ready)
  ready:         { forward: "done",  back: "todo" },       // execute gate (check ready→done)
  done:          { forward: null,    back: "ready" },       // terminal forward; may retreat to rework
  "needs-human": { forward: null,    back: null },          // soft stop — only a human edits out (task edit)
};
```

Each forward edge is a gate `check()` already models; back edges are single-step rework
rollbacks (the only backward edges — recording *why* is the point, reason → payload).
`needs-human` has NO automated edge in/out — `check()` treats it as a soft stop; clearing
it is a deliberate `quay task edit --status` write (the M31 `--no-verify`-style escape
hatch), never a lifecycle verb. `done` forward=`null` matches `check()`'s terminal branch.

Helpers (pure, unit-testable without a provider — where the ≥80% coverage lands):

```js
export function legalForward(status)  // → next status | null
export function legalBack(status)     // → prev status | null
// throws Error(`illegal transition: <status> cannot <dir>`) for null edges
export function assertTransition(status, dir /* "forward"|"back" */)
```

### Which gate(s) each command runs

Reuse `runGate({client, id, gate, logPath, actor})` from `engine.js` verbatim — it already appends the GateEvent.

- **`complete` runs `acceptance` only** (the QENG-2 CLI-default gate) — a runnable,
  status-INDEPENDENT meter (`task.extra.acceptance` → real exit code) that fails-closed
  when unset. `dod` is EXCLUDED: it wraps status-RELATIVE `check()`, and `complete` also
  *writes* `status=done`, after which a second `dod` run hits `check()`'s terminal branch
  (`gate:"none"`) — running it inside `complete` would couple to pre-write status and
  double-count the checkbox gate `promote`/`task check` already covers. (A `--with-dod`
  opt-in is a possible future flag; v0 ships acceptance-only.)

- **`adjudicate` runs no registry gate.** It is an *independent* pass, not a re-run of
  the completion gate (epicd's `adjudicate` is a fresh-context judgment, distinct from
  the mechanical `adjudicate.ts` DoD verdict). v0 records the current mechanical state
  it can observe — `client.taskCheck(id)` — as an `audit` GateEvent, WITHOUT delegating
  its verdict to it.

- **`promote`/`retreat` run no registry gate themselves**; they enforce the transition
  table. `promote` from `ready` delegates to `runComplete` (shared below) so a task cannot
  reach `done` past a failing acceptance meter.

### Command semantics

All four log via `appendGateEvent(logPath, event)` with the QENG-1 GateEvent shape
(`{id, item_id, pipeline_id, gate, actor, verdict, timestamp, payload}`, `item_id=
pipeline_id=<task id>`; `logPath` from `resolveGateLogPath(cfg.workspaceRoot,{file:flags.file})`).
Status writes reuse `client.taskWrite({id, status, expectedStatus})` — passing `expectedStatus`
= the current status makes each write a compare-and-swap (store.js `ConflictError`, QN-015).

**`quay complete <task>`** → `lifecycle.js#runComplete({client, id, logPath, actor})`:
1. **Precondition: status MUST be `ready`.** `store.write()` does NOT enforce the
   transition table (it validates only `status ∈ VALID_STATUSES`), and `acceptance`
   is status-INDEPENDENT — so without this guard, `complete` on a `todo` task would
   write `todo→done` directly, skipping the author gate. `runComplete` first reads
   `task = client.taskGet(id)`; if `task.status !== "ready"`, print
   `illegal transition: <status> cannot complete (must be ready)`, `process.exitCode = 1`,
   RETURN — no gate run, no write. (`done` is not re-completable; retreat to `ready` first.)
2. `runGate({client, id, gate:"acceptance", logPath, actor})` — appends the
   pass/fail GateEvent for the acceptance run itself.
3. If `!ok`: print `FAIL — <reason>`, `process.exitCode = 1`, RETURN — status unchanged.
4. If `ok`: `client.taskWrite({id, status:"done", expectedStatus:"ready"})`; append a
   second GateEvent `{gate:"complete", verdict:"pass", payload:{from:"ready", to:"done"}}`;
   print `PASS — status=done`. (CLI sets `process.env.QUAY_ACCEPTANCE_CWD =
   cfg.workspaceRoot` before the call, as the `gate` handler does.)

**`quay adjudicate <task>`** → `lifecycle.js#runAdjudicate({client, id, logPath,
actor})`:
1. `r = client.taskCheck(id)` — read-only observation, no status write.
2. Append `{gate:"audit", verdict: r.ok ? "pass" : "fail", payload:{reason: r.reason,
   observed_status: <task.status>}}`.
3. **Record-only in v0:** exit 0 after logging regardless of `r.ok`; status is never
   changed by `adjudicate`. This makes the audit visible in `quay gate-log` (AC2) without
   giving an automated pass authority to flip status (that stays with `complete`/`promote`
   + gates). `needs-human`-on-refute deferred (Trade-offs). Print `AUDIT <pass|fail> — <reason>`.

**`quay promote <task>`** → `lifecycle.js#runPromote(...)`:
1. `task = client.taskGet(id)`; `assertTransition(task.status, "forward")` (throws →
   top-level catch → exit 1, `illegal transition: <status> cannot forward`); `next = legalForward(task.status)`.
2. If `task.status === "ready"` (the `ready→done` edge): delegate to `runComplete`
   (runs acceptance gate + writes done + logs) — one path to `done`, gate-guarded.
3. Else (`todo→ready`): `runGate({client, id, gate:"dod", logPath, actor})` — the
   author gate for a `todo` task; on fail exit 1, status unchanged; on pass
   `client.taskWrite({id, status:next, expectedStatus:task.status})` and append
   `{gate:"promote", verdict:"pass", payload:{from:task.status, to:next}}`.

**`quay retreat <task> --reason <r>`** → `lifecycle.js#runRetreat({client, id, reason,
logPath, actor})`:
1. `--reason` is REQUIRED — missing/empty is a usage error (exit 1, no write), because
   the reason IS the deliverable of a retreat.
2. `task = client.taskGet(id)`; `prev = legalBack(task.status)`;
   `assertTransition(task.status, "back")` (throws → exit 1, illegal message).
3. `client.taskWrite({id, status:prev, expectedStatus:task.status})`; append
   `{gate:"retreat", verdict:"pass", payload:{from:task.status, to:prev, reason}}`;
   print `RETREAT <status> → <prev> (<reason>)`. No gate runs — retreat rolls back regardless.

### Module surface (`packages/quay/src/gate/lifecycle.js`)

```js
export const TRANSITIONS
export function legalForward(status): string|null
export function legalBack(status): string|null
export function assertTransition(status, dir): void            // throws on illegal
export async function runComplete({client, id, logPath, actor}): {ok, reason}
export async function runAdjudicate({client, id, logPath, actor}): {ok, reason}
export async function runPromote({client, id, logPath, actor}): {ok, reason, to}
export async function runRetreat({client, id, reason, logPath, actor}): {ok, to}
```

`bin/quay.js` adds four verb-less branches (mirroring the `gate` branch, id=`sub`), each
opening `withProvider`, resolving `logPath` via `resolveGateLogPath`, setting `process.exitCode`,
printing one line. Pure helpers + the four `run*` fns (driven against a stub client + tmp
`logPath`, the `test/gate.test.mjs` style) carry the ≥80% coverage.

### Acceptance Criteria (verbatim from tasks/QENG-3.md)

- [ ] `quay complete <task-with-failing-gate>` exits 1 and leaves status unchanged;
      `quay complete <task-all-gates-pass>` exits 0 and sets status=done.
- [ ] `quay adjudicate <task>` records an audit GateEvent (visible in `quay gate-log`).
- [ ] An illegal phase transition is rejected with a nonzero exit and a clear message.
- [ ] tests >=80% on the lifecycle module, actually run (paste output).

Command-level mapping:
- AC1 (both fixtures start at `status=ready` — complete's precondition; set via
  `quay task edit <id> --status ready`, `--acceptance '<cmd>'`):
  `quay complete <ready+failing-meter>` → exit 1, status stays `ready` (fail GateEvent);
  `quay complete <ready+passing-meter>` → exit 0, `status=done` (pass GateEvent).
  Precondition guard: `quay complete <todo-task>` → exit 1, status unchanged, no gate run.
- AC2: `quay adjudicate <id>` → exit 0; `quay gate-log <id> --gate audit` lists it.
- AC3: `quay retreat <todo-task> --reason x` (`todo` has `back:null`) → exit 1,
  `illegal transition: todo cannot back`; likewise `quay promote <done-task>` → exit 1.
- AC4: `node --test` coverage over `lifecycle.js` ≥80% (`node --experimental-test-coverage`),
  output pasted into the DoD.

## Trade-offs

- **acceptance-only `complete` (not dod):** simpler, status-independent verdict; cost is
  the checkbox `dod` gate is enforced by the `todo→ready` `promote` path and `task check`,
  not by `complete`. Accepted: double-running a status-relative gate in a status-writing
  verb is the larger hazard.
- **record-only `adjudicate`:** minimal and safe; cost is a refuting audit has no automated
  effect (a human reads `gate-log` and acts). `--on-refute needs-human` is a future flag.
- **Reuse statuses as phases (no epicd Pipeline port):** keeps quay light and avoids a
  parallel phase model diverging from `check()`; cost is no multi-phase
  `awaiting-children`/`adjudicating` states — not needed without QENG-4's driver.
- **CAS via `expectedStatus`:** every status write passes the pre-read status as
  `expectedStatus`, so a concurrent change makes `store.write()` throw `ConflictError`
  (QN-015) → nonzero exit the caller retries — correct, not silent last-writer-wins.

## Risks

- **Log-path drift:** all four commands MUST resolve `logPath` via `resolveGateLogPath`
  (never hardcoded) so `gate-log` reads the same file QENG-1 writes. AC2 round-trips it.
- **Double GateEvent on `complete`:** `runComplete` intentionally logs two events (the
  `acceptance` run via `runGate`, then a `complete` verdict). Tests assert exactly two,
  the `acceptance` one QENG-1-shaped.
- **`needs-human` trap:** no legal lifecycle edge by design — a future reader must not add
  one; clearing it is a deliberate `task edit --status` (M31 escape hatch). AC3 asserts it.
- **Compound tasks:** `complete` writing `done` on an epic does not re-check children, but
  `check()`'s `done` branch re-verifies them on any later `task check`/`dod` run (QN-012),
  so a stale-done epic is still caught downstream (children pre-check deferred to QENG-4).

## Architect review notes

- Verified real: `withProvider(fn)→fn(client,cfg,provider)` (quay.js:130); verb-less `id=sub`
  + `resolveGateLogPath(cfg.workspaceRoot,{file})` + `process.exitCode` + `QUAY_ACCEPTANCE_CWD`
  (quay.js:762-781); `runGate({client,id,gate,logPath,actor})` + GateEvent shape (engine.js:28-46);
  `appendGateEvent` (gate-event-store.js). All four new commands wire the SAME way — confirmed.
- `taskWrite({id,status,expectedStatus})` real: MCP `task_write` accepts `expectedStatus`
  (mcp-server.js:103) → `store.write()` CAS-checks inside the write lock, throwing
  `ConflictError` on mismatch (store.js:462, QN-015). Correct.
- Transition table matches `store.js#check()`: todo→ready, ready→done, done=terminal,
  needs-human=soft stop. Confirmed.
- **Fixed (correctness):** `store.write()` does NOT enforce edges (validates only
  `status∈VALID_STATUSES`) and `acceptance` is status-independent, so the original `complete`
  would write `todo→done`, skipping the author gate. Added a hard `status==="ready"` precondition
  to `runComplete` (else exit 1, no gate/write), a precondition AC1 case + `--status ready` fixture.