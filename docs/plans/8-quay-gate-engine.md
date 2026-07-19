# Plan 8 — quay gate engine + GateEvent log (QENG-1)

Implements **QENG-1** per `docs/proposals/proposal-quay-gate-engine.md` (read its
"Architect review notes" — CLI arg-extraction and status-relative `dod` are
load-bearing here). Scope: `packages/quay` product code only. **OUT:** QENG-2/3/4,
any Provider ABI tool, anything under `experiments/**`.

All commands run from `packages/quay/`. `quay` = `node bin/quay.js`.

## Top-level Acceptance (QENG-1 AC — verbatim, each a runnable command)

Reproduced from `tasks/QENG-1.md`. Each maps to the Stage that makes it green.

| # | AC (verbatim) | Runnable gate | Stage |
|---|---|---|---|
| AC1 | `quay gate --list` lists registered gates (exit 0). | `node bin/quay.js gate --list && echo AC1-ok` | B1 |
| AC2 | `quay gate <compliant-fixture> --gate dod` exits 0; `quay gate <violating-fixture> --gate dod` exits 1. | `node bin/quay.js gate <compliant> --gate dod; test $? -eq 0 && node bin/quay.js gate <violating> --gate dod; test $? -eq 1 && echo AC2-ok` | C1 |
| AC3 | Each gate run appends a GateEvent; `quay gate-log <task> --json` lists them. | `node bin/quay.js gate-log <compliant> --json \| node -e 'let e=JSON.parse(require("fs").readFileSync(0));process.exit(e.length>=1&&e[e.length-1].verdict==="pass"?0:1)' && echo AC3-ok` | C1 |
| AC4 | `node test` on the new gate module passes with ≥80% coverage on new lines (paste output). | `node --test --experimental-test-coverage test/gate.test.mjs` | C2 |

**AC4 rule (epicd ADR-019):** the coverage command's real stdout MUST be pasted
into QENG-1's validation section at execution time. Not asserted in prose.
Coverage target: ≥80% line coverage on `src/gate/**`.

Self-hosting check (QENG-0 AC, DoD-only, not an AC gate):
`node bin/quay.js gate QENG-1` runs and reports a verdict.

---

## Phase A — pure modules + unit tests (no CLI) — budget ≤500 LOC

Store, registry, engine, log-query as importable ES modules with injected paths
(no side effects except the injected `logPath`). Depends on: nothing.

### Stage A1 — gate-event-store — ≤120 LOC — deps: none
New file `src/gate/gate-event-store.js`. Port of epicd `gate-event-store.ts`.

- `GateEvent` typedef (JSDoc): `{ id, item_id, pipeline_id, gate, actor, verdict, timestamp, payload }`.
- `appendGateEvent(logPath, event)` — append-only, one JSON line via `fs.appendFileSync`; `mkdirSync(dirname, {recursive:true})` first.
- `queryGateEvents(logPath, filter = {})` — read file (missing → `[]`), parse per line, AND-filter on `{ pipeline_id, gate, actor, since, until }`, then `offset`/`limit`. Preserves append (on-disk) order.

Gate A1: `node --test --experimental-test-coverage test/gate.test.mjs` (store cases) green.

### Stage A2 — registry + `dod` gate — ≤60 LOC — deps: A1
New file `src/gate/registry.js`. Implements the `gateRegistry`/`listGates()`
shape from proposal §"Gate registry + the `dod` gate" verbatim — the `dod` gate
wraps `client.taskCheck(task.id)` (reuses `store.js#check()`; no duplicated gate
logic).

Gate A2: `node --test test/gate.test.mjs` (registry cases: `listGates()` includes `"dod"`; `dod` fn maps `taskCheck` result through a stub client) green.

### Stage A3 — engine + log-path resolver — ≤120 LOC — deps: A1, A2
New files `src/gate/engine.js`, `src/gate/gate-log.js`.

`engine.js`: `runGate({ client, id, gate="dod", logPath, actor="quay-cli" })` —
the exact body in proposal §"Engine (`engine.js`)" (resolve gate → `taskGet` →
run fn → append one `GateEvent` → return `{ok, reason, event}`; unknown-gate and
missing-task both throw).

`gate-log.js`:
- `resolveGateLogPath(workspaceRoot, opts = {})` → `opts.file` if set, else `path.join(workspaceRoot, ".quay", "gate-events.jsonl")`.
- `runGateLogQuery(workspaceRoot, { pipelineId, gate, actor, since, until, limit, offset, file } = {})` → `queryGateEvents(resolveGateLogPath(workspaceRoot,{file}), { pipeline_id: pipelineId, gate, actor, since, until, limit, offset })`.

Gate A3: `node --test test/gate.test.mjs` (engine appends one event, verdict tracks `ok`, unknown-gate throws, missing-task throws; `resolveGateLogPath` default + `--file` override) green.

**Phase A exit gate:** `node --test --experimental-test-coverage test/gate.test.mjs && echo PHASE-A-ok`

---

## Phase B — CLI wiring in `bin/quay.js` — budget ≤300 LOC

Wire `gate`, `gate-log`, `--list`. Depends on: Phase A. Honor the arg-extraction
note: `main()` does `const [, , cmd, sub, ...rest] = process.argv` then
`parseFlags(rest)` (`bin/quay.js` L243-244). For verb-less `gate`/`gate-log` the
**task id lands in `sub`**, NOT `positional[0]` (contrast `task check`, which
reads `positional[0]` because `check` is the `sub` token — L641). `--list` is
`sub === "--list"`; `flags.list` is never set. Add both handlers **before** the
generic-usage fallback.

### Stage B1 — `gate --list` + `gate <task>` handler — ≤120 LOC — deps: A3
Import `runGate`, `listGates`, `resolveGateLogPath` at top of `bin/quay.js`.

- `if (cmd === "gate" && sub === "--list")` → print `listGates().join("\n")`, exit 0, no provider connection. **[AC1]**
- `else if (cmd === "gate")` → `const id = sub;` → `withProvider(async (client, cfg) => { const logPath = resolveGateLogPath(cfg.workspaceRoot, { file: flags.file }); const { ok, reason } = await runGate({ client, id, gate: flags.gate, logPath }); console.log(ok ? "PASS" : \`FAIL — ${reason}\`); process.exitCode = ok ? 0 : 1; }, { providerId: flags.provider })`. Mirrors `task check` exit plumbing (L643-651).

Gate B1: `node bin/quay.js gate --list && echo AC1-ok` prints `dod` and exits 0.

### Stage B2 — `gate-log <task>` handler — ≤80 LOC — deps: A3, B1
- `if (cmd === "gate-log")` → `const id = sub;` → `withProvider(async (client, cfg) => { const events = runGateLogQuery(cfg.workspaceRoot, { pipelineId: id, gate: flags.gate, file: flags.file }); if (flags.json) printJson(events); else events.forEach(e => console.log(\`${e.timestamp} ${e.gate} ${e.verdict}\`)); }, ...)`. Read-only — never appends. `--json` read off `flags.json` (no `jsonCommands` allowlist change needed; that governs only the `--format json` alias — see proposal review note 4).

Gate B2: `node bin/quay.js gate-log QENG-1 --json` exits 0 and emits a JSON array (`[]` acceptable pre-fixture).

**Phase B exit gate:** `node bin/quay.js gate --list && node bin/quay.js gate-log QENG-1 --json >/dev/null && echo PHASE-B-ok`

---

## Phase C — fixtures + ACs green + coverage — budget ≤300 LOC

Depends on: Phase A, Phase B.

### Stage C1 — fixtures + AC2/AC3 wired in test — ≤160 LOC — deps: B2
In `test/gate.test.mjs`, build a disposable **workspace** — `mkdtemp` root with
`.quay/config.yml` (native provider + `tasks_dir`/`QUAY_NATIVE_TASKS_DIR`) and
run the CLI with `cwd = workspaceRoot` — mirroring `gap-cli-gate-enforcement.test.mjs`'s
`makeWorkspace()`, **not** `task-check.test.mjs` (that test drives the provider
client directly and never needs a `.quay/config.yml`; the `gate` CLI does, since
`gate <task>` routes through `withProvider()`→`loadConfig()`). Seed two
`tasks/*.md` fixtures — both `status: todo` (status-relative `dod`; see proposal
§"Gate registry"); each of the four artifact sections must exceed
`MIN_SECTION_CHARS` (40 non-ws chars, `store.js`) to count as present:

- **compliant** — all four artifacts + all AC checkboxes ticked → author→ready gate `ok:true` → `dod` passes (exit 0).
- **violating** — one unchecked AC box → `ok:false` → `dod` fails (exit 1).

Drive the real CLI via `node bin/quay.js gate <fixture> --gate dod --file <tmp.jsonl>` with `cwd = workspaceRoot`; assert exit 0 / 1 **[AC2]**. Then `gate-log <compliant> --json --file <tmp.jsonl>`; assert `length>=1` and `events[events.length-1].verdict==="pass"` **[AC3]**. (`--file` is the gate-log path; the fixtures live in the workspace's `tasks_dir` — two independent tmp locations.)

Gate C1 (AC2+AC3 — illustrative; the test runs these with `cwd = workspaceRoot`):
```sh
node bin/quay.js gate <compliant> --gate dod --file /tmp/g.jsonl; test $? -eq 0 \
 && node bin/quay.js gate <violating> --gate dod --file /tmp/g.jsonl; test $? -eq 1 \
 && node bin/quay.js gate-log <compliant> --json --file /tmp/g.jsonl \
    | node -e 'let e=JSON.parse(require("fs").readFileSync(0));process.exit(e.length>=1&&e[e.length-1].verdict==="pass"?0:1)' \
 && echo AC2+AC3-ok
```

### Stage C2 — coverage ≥80% on `src/gate/**` — ≤80 LOC — deps: C1
Add any unit cases needed to reach ≥80% line coverage on `src/gate/**`
(unknown-gate throw, missing-task throw, `queryGateEvents` filters/pagination,
missing-log → `[]`, `resolveGateLogPath` default + override).

Gate C2 (AC4 — **paste real output into QENG-1**):
```sh
node --test --experimental-test-coverage test/gate.test.mjs
```
Pass = all tests green AND `src/gate/**` line coverage ≥80%.

**Phase C exit gate = full AC sweep:**
```sh
node bin/quay.js gate --list \
 && (cd . && bash -c 'node bin/quay.js gate <compliant> --gate dod --file /tmp/g.jsonl; test $? -eq 0') \
 && (node bin/quay.js gate <violating> --gate dod --file /tmp/g.jsonl; test $? -eq 1) \
 && node bin/quay.js gate-log <compliant> --json --file /tmp/g.jsonl \
    | node -e 'let e=JSON.parse(require("fs").readFileSync(0));process.exit(e.length>=1&&e[e.length-1].verdict==="pass"?0:1)' \
 && node --test --experimental-test-coverage test/gate.test.mjs \
 && echo PHASE-C-ok
```

---

## Method
- **TDD:** write/extend `test/gate.test.mjs` cases before each Stage's module code; each Stage ends on its named green gate.
- **Coverage:** ≥80% line coverage on `src/gate/**` via `node --test --experimental-test-coverage test/gate.test.mjs`; real output pasted into QENG-1 (AC4 / DoD).
- **No side effects** in `src/gate/**` except the injected `logPath` (keeps coverage run driving real I/O against a tmp path).

## Files
| Path | Phase.Stage | New/Edit |
|---|---|---|
| `packages/quay/src/gate/gate-event-store.js` | A1 | new |
| `packages/quay/src/gate/registry.js` | A2 | new |
| `packages/quay/src/gate/engine.js` | A3 | new |
| `packages/quay/src/gate/gate-log.js` | A3 | new |
| `packages/quay/bin/quay.js` | B1, B2 | edit |
| `packages/quay/test/gate.test.mjs` | A1–C2 | new |
| `packages/quay/tasks/*.md` fixtures | C1 (tmp workspace, `makeWorkspace()`-style) | test-only |

## Definition of Done (QENG-1)
- AC1–AC3 run green (exit 0).
- AC4: coverage command passes, ≥80% on `src/gate/**`, **output pasted into QENG-1** (not prose).
- Self-hosting: `node bin/quay.js gate QENG-1` reports a verdict.
- No file under `experiments/**` touched; no new Provider ABI tool added.
