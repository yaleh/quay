# Proposal: quay gate engine + GateEvent log (QENG-1)

Deliverable **QENG-1** of the epicd-engine-port initiative. Tracked in
`tasks/QENG-0.md` (epic) and `tasks/QENG-1.md` (this deliverable's authored AC/DoD).

## Background

quay has a clean DATA layer (`packages/quay-native/src/store.js#check()`,
Core CLI `task check` / `task edit --enforce-gate` in
`packages/quay/bin/quay.js`) but no executable ENGINE layer. epicd already has
one; the relevant pillars are:

- `epicd/src/core/gate-event-store.ts` — `GateEvent` shape + append-only JSONL log (`appendGateEvent` / `queryGateEvents`).
- `epicd/src/engine/gate-log.ts` — read-only CLI wrapper over `queryGateEvents`.
- `epicd/src/engine/adjudicate-gate.ts` — a gate that returns a verdict.

QENG-1 ports these into quay's lighter, provider-based JS (`packages/quay`),
**generalizing** the existing `store.js#check()` into one named gate in a
registry rather than duplicating it. Reference discipline (epicd ADR-019): *the
meter is runnable, not asserted* — every AC below is a command with an exit
code.

## Goals

- `quay gate <task> [--gate <name>]` evaluates a named gate against a task; exit `0` = pass, `1` = fail.
- Every run appends one `GateEvent`, queryable via `quay gate-log <task> --json`.
- `quay gate --list` lists registered gates.
- One concrete `dod` gate wired so fixtures pass/fail deterministically.
- The `dod` gate reuses `taskCheck` (the existing `store.js#check()` path) — no gate logic is duplicated.

## Non-goals (scoped OUT — follow-up deliverables)

- **QENG-2** acceptance-field runnable meter (`--acceptance`, sandboxed runner). Not here.
- **QENG-3** phase pipeline + `complete`/`adjudicate`/`retreat` lifecycle. Not here.
- **QENG-4** `quay run` driver loop. Not here.
- No changes under `experiments/quay-perpetual-stream/**`. This is `packages/quay` product code only.
- No new Provider ABI tool. The gate engine is Core-side, consuming existing `taskGet`/`taskCheck`.

## Design

### File layout (all new, under `packages/quay`)

| Path | Responsibility |
|---|---|
| `packages/quay/src/gate/gate-event-store.js` | `GateEvent` shape + `appendGateEvent(path, event)` / `queryGateEvents(path, filter)`. Port of epicd `gate-event-store.ts`. JSONL, append-only. |
| `packages/quay/src/gate/registry.js` | `gateRegistry` map of `name -> async gateFn(task, client) -> {ok, reason}`; `listGates()`. Ships the `dod` gate. |
| `packages/quay/src/gate/engine.js` | `runGate({client, id, gate, logPath, actor})` — resolves gate, evaluates, appends a GateEvent, returns `{ok, reason, event}`. |
| `packages/quay/src/gate/gate-log.js` | `resolveGateLogPath(cwd, opts)` + `runGateLogQuery(cwd, opts)`. Port of epicd `gate-log.ts`. |
| `packages/quay/bin/quay.js` | Wire `gate` and `gate-log` subcommands (below). |
| `packages/quay/test/gate.test.mjs` | `node:test` coverage of store + registry + engine + CLI. |

Default log path: `<workspaceRoot>/.quay/gate-events.jsonl` (resolved from
`loadConfig().workspaceRoot`, mirroring epicd's `DEFAULT_GATE_LOG_RELATIVE_PATH`
convention; overridable with `--file`).

### GateEvent shape (`gate-event-store.js`)

Ported verbatim from epicd's interface, as a plain JS object (JSDoc, no TS):

```js
/** @typedef {{
 *   id: string,          // uuid/random per run
 *   item_id: string,     // task id
 *   pipeline_id: string, // task id (single-pipeline v0) — filter key
 *   gate: string,        // gate name, e.g. "dod"
 *   actor: string,       // who ran it (default "quay-cli")
 *   verdict: string,     // "pass" | "fail"
 *   timestamp: string,   // ISO 8601
 *   payload: unknown     // opaque: { reason, ...gateResult }; engine never matches on it
 * }} GateEvent */
```

`appendGateEvent` is append-only (no update/delete), one JSON line via
`fs.appendFileSync` — same primitive as `store.js`. `queryGateEvents(path,
{pipeline_id, gate, actor, since, until, limit, offset})` reads/filters/paginates
(AND-combined), same signature as epicd.

### Gate registry + the `dod` gate (`registry.js`)

```js
// name -> async (task, client) => { ok: boolean, reason: string }
export const gateRegistry = {
  dod: async (task, client) => {
    const r = await client.taskCheck(task.id); // reuse store.js#check() — no duplicate logic
    return { ok: r.ok === true, reason: r.reason };
  },
};
export function listGates() { return Object.keys(gateRegistry); }
```

The `dod` gate is a thin adapter over the existing `taskCheck` passthrough
(`packages/quay/src/provider-client.js`), so quay's already-shipped author→ready
/ execute→done gate becomes the first named engine gate — generalizing rather
than duplicating `store.js#check()`.

**`dod` pass/fail is status-relative** (inherited from `check()`, `store.js`
L573–708): `check()` runs whichever gate matches the task's *current* status —
`todo`→author→ready, `ready`→execute→done, `done`→terminal(`ok:true` for a
leaf), `needs-human`→`ok:false`. So the `dod` gate's verdict is "does this task
pass the gate for the status it is in now," not a fixed DoD-only check. The
fixtures below pin this: the compliant fixture is `status: todo` with all four
artifacts + all AC boxes checked (passes author→ready → `ok:true`); the
violating fixture is `status: todo` with an unchecked AC box (`ok:false`). This
is the precise, reproducible contract AC2 asserts.

### Engine (`engine.js`)

```js
export async function runGate({ client, id, gate = "dod", logPath, actor = "quay-cli" }) {
  const fn = gateRegistry[gate];
  if (!fn) throw new Error(`unknown gate: ${gate}`);
  const task = await client.taskGet(id);
  if (!task) throw new Error(`no such task: ${id}`);
  const { ok, reason } = await fn(task, client);
  const event = {
    id: randomUUID(), item_id: id, pipeline_id: id, gate, actor,
    verdict: ok ? "pass" : "fail", timestamp: new Date().toISOString(),
    payload: { reason },
  };
  appendGateEvent(logPath, event);
  return { ok, reason, event };
}
```

### CLI surface (`bin/quay.js`)

```
quay gate --list                          # list registered gates (exit 0)
quay gate <task> [--gate <name>] [--file <path>]               # evaluate; exit 0 pass / 1 fail; appends GateEvent
quay gate-log <task> [--gate <name>] [--json] [--file <path>]  # query events for a task
```

Arg-extraction note (quay's parser splits `[, , cmd, sub, ...rest]` in
`quay.js#main`, THEN runs `parseFlags(rest)`): `gate`/`gate-log` are top-level
commands with **no verb token**, so the task id lands in `sub`, not
`positional[0]` (unlike `task view <id>`). The handlers must therefore read the
id from `sub`, and `--list` is detected as `sub === "--list"` (parseFlags never
runs on it, so `flags.list` is always undefined). Both handlers dispatch on
`cmd` and must be added before the generic-usage fallback.

- `quay gate --list` (i.e. `sub === "--list"`) → prints `listGates()`, one per line, exit 0. No provider connection.
- `quay gate <task>` → `withProvider(...)` → `runGate({ client, id: sub, gate: flags.gate, logPath })`; prints `PASS`/`FAIL — <reason>`; `process.exitCode = ok ? 0 : 1`. Mirrors the `task check` handler's exit-code plumbing (`quay.js` L635–653). `logPath` defaults to `resolveGateLogPath(cfg.workspaceRoot, { file: flags.file })`.
- `quay gate-log <task>` → `runGateLogQuery(cfg.workspaceRoot, { pipelineId: sub, gate: flags.gate, file: flags.file })`; `--json` prints the event array (else one line per event), exit 0. Read-only, never appends.
- `--json` for `gate-log` is read directly off `flags.json`; the shared `jsonCommands` allowlist (`quay.js` L281–288) governs only the `--format json` alias validation for existing verbs and does **not** need to list `gate`/`gate-log` (plain `--json` still works). Adding them there is optional polish, not required for AC3.

### Fixtures

Two `tasks/*.md` fixtures created in the test's tmp store: one compliant
(all four artifacts present, all AC checkboxes ticked → `dod` passes) and one
violating (unchecked AC → `dod` fails), so the AC commands below are runnable.

## Acceptance Criteria (each a runnable command with an exit code)

Mirrors `tasks/QENG-1.md`. All run from `packages/quay`.

```sh
# 1. list registered gates, exit 0
quay gate --list && echo "AC1 ok"

# 2. dod gate passes on compliant fixture (exit 0), fails on violating (exit 1)
quay gate <compliant-fixture>  --gate dod;  test $? -eq 0 && echo "AC2a ok"
quay gate <violating-fixture>  --gate dod;  test $? -eq 1 && echo "AC2b ok"

# 3. each run appended a GateEvent, queryable as JSON. gate-log filters by
#    pipeline_id = <task>, so only this fixture's events return; assert at
#    least one and that the most recent is "pass" (append order = on-disk order).
quay gate-log <compliant-fixture> --json | node -e \
  'let e=JSON.parse(require("fs").readFileSync(0));process.exit(e.length>=1&&e[e.length-1].verdict==="pass"?0:1)' \
  && echo "AC3 ok"

# 4. tests >=80% coverage on the new gate module, actually run (paste output)
node --test --experimental-test-coverage test/gate.test.mjs
```

## Definition of Done

- AC1–AC3 above run green (exit 0).
- AC4: `node --test --experimental-test-coverage test/gate.test.mjs` passes and
  reports ≥80% line coverage on `src/gate/**` — **output pasted into the task**,
  not asserted in prose.
- Self-hosting check (QENG-0 AC): `quay gate QENG-1` runs and reports a verdict
  (green once QENG-1's own task body satisfies the `dod` gate).
- No file under `experiments/**` touched; no new Provider ABI tool added.

## Trade-offs

- **Reuse `taskCheck` vs. reimplement gate logic in-engine.** Chosen: reuse. The
  `dod` gate wraps the existing `store.js#check()` path, so there is one gate
  implementation, not two (matches `--enforce-gate`'s existing decision to call
  `client.taskCheck(id)` rather than duplicate). Cost: the engine's richest gate
  is only as strong as `check()`; richer runnable gates arrive with QENG-2.
- **JSONL append-only log vs. structured DB.** Chosen: JSONL, matching epicd's
  `gate-event-store.ts` and quay's file-first architecture. Cheap, greppable,
  no new dependency. Cost: full-scan queries (acceptable at this scale, same as
  `store.js#list()`).
- **Default log at `.quay/gate-events.jsonl` vs. per-provider.** Chosen: single
  Core-side log keyed by `pipeline_id = task id`. Provider-agnostic; the gate
  engine is Core-side and never routes through a Provider write.
- **`payload` opaque.** Kept opaque end-to-end (epicd ADR-011 boundary): the
  engine never matches on payload fields, keeping the log forward-compatible.

## Risks

- **`taskCheck` semantics differ per Provider** (native vs. github). Mitigation:
  the `dod` gate asserts only `r.ok`/`r.reason`, the ABI-uniform fields both
  Providers already return (`provider-abi-conformance.test.mjs`).
- **Log-path drift** between CLI and any future Web/MCP reader. Mitigation:
  single `resolveGateLogPath()` (epicd's pattern) — one place resolves the path.
- **Coverage gate flakiness** under `--experimental-test-coverage`. Mitigation:
  keep `src/gate/**` free of I/O side effects except the injected log path, so
  the test drives real file I/O against a tmp path (epicd's `GateEventStoreFs`
  injection pattern, simplified to a `logPath` arg).
- **Scope creep into QENG-2/3/4.** Mitigation: registry ships exactly one gate
  (`dod`); acceptance-runner, lifecycle, and driver are explicit non-goals.

## Architect review notes

Verified feasible against real code (`bin/quay.js`, `store.js#check()`,
`provider-client.js`, `config.js`, epicd `gate-event-store.ts`/`gate-log.ts`).
The port is faithful; `client.taskCheck(id)` returns the whole check result, so
`r.ok`/`r.reason` are valid. `loadConfig().workspaceRoot` exists. `.quay/` and
`tasks/` both resolve from `workspaceRoot`, so no path conflict with
`QUAY_NATIVE_TASKS_DIR`. Changes made:

1. **CLI arg-extraction (material).** quay splits `[cmd, sub, ...rest]` before
   `parseFlags(rest)`, so for the verb-less `gate`/`gate-log` the task id lands
   in `sub` (not `positional[0]`) and `--list` is `sub === "--list"`
   (`flags.list` never set). The pseudo-code hid this; added an explicit note so
   the implementer doesn't wire `positional[0]`/`flags.list` and get a null id.
2. **`dod` semantics (material).** Pinned that `check()` is status-relative;
   specified both fixtures as `status: todo` so AC2 pass/fail is reproducible.
3. **AC3 robustness.** Assert the most-recent (not `e[0]`) event of the
   pipeline_id-filtered log is `pass`, since the log is append-only across runs.
4. **jsonCommands allowlist.** Noted plain `--json` needs no allowlist change;
   only the `--format json` alias would, and that's optional polish.

Every AC remains a runnable command with an exit code. No bloat cut needed
(doc was already lean); no code implemented; nothing under `experiments/**` or
Provider ABI touched.
