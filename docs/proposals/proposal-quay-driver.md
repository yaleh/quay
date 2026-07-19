# Proposal: QENG-4 — the driver `quay run` (autonomous loop as code)

Status: proposed · Scope: `packages/quay` only · AC source of truth: `tasks/QENG-4.md`

## Background (capstone)

QENG-4 is the CAPSTONE of the epicd-engine port. It composes the three DONE-on-master
pieces without restating them:

- **QENG-1** gate engine + GateEvent log — `packages/quay/src/gate/engine.js` (`runGate`),
  `packages/quay/src/gate/gate-event-store.js` (`appendGateEvent`), `.../gate/gate-log.js`
  (`resolveGateLogPath`).
- **QENG-2** acceptance meter — `packages/quay/src/gate/registry.js` (`acceptance` gate reads
  `task.extra.acceptance`, **fail-closed** when unset), `.../gate/acceptance-runner.js`.
- **QENG-3** lifecycle — `packages/quay/src/gate/lifecycle.js` (`runComplete({client,id,logPath})`:
  requires `status==='ready'`, runs the acceptance gate, pass→`done`, fail→exit 1 status-unchanged;
  the `TRANSITIONS` table).

`quay run` is the autonomous loop AS CODE: scan the board for `ready` tasks, drive each through
`runComplete`, stop at a fixpoint or a sentinel. It is what would eventually replace exp5's
~330-line prose `OUTER-LOOP.md` — the loop calls one command instead of interpreting prose.

## Goals / Non-goals

**Goals**
- `quay run --once`: process ONE actionable task via QENG-3 `runComplete`; exit 0.
- `quay run`: bounded loop of `--once` until fixpoint OR stop sentinel.
- A documented POC analogy: `quay run --once` performs the SAME CLASS of transition as one
  exp5 OUTER-LOOP ABSORB step (`ready` gate runs → `done`), proven on a quay task-board fixture.

**Non-goals** (explicitly dropped from the epicd port)
- No manda dispatch, no worktree spawn, no supervisor, no sandbox, no single-active-driver
  claim/lease machinery. `quay run` is a synchronous in-process scan→complete loop.
- No new Provider ABI: reuse only `taskList` / `taskWrite` (via `runComplete`) / `taskCheck`
  (via the acceptance gate) already on `provider-client.js`.
- No modification of anything under `experiments/quay-perpetual-stream/**` (the POC uses a
  self-contained fixture; it never reads/runs/edits exp5).

## Design

New thin module **`packages/quay/src/gate/driver.js`** + one verb-less CLI branch `cmd === "run"`
in `packages/quay/bin/quay.js`, wired exactly like the existing `complete` branch
(`id` handling, `withProvider(fn)→fn(client,cfg)`, `resolveGateLogPath`, `QUAY_ACCEPTANCE_CWD`).

### Scan predicate — what is "actionable"

A task is actionable iff **`status === "ready"` AND `typeof task.extra?.acceptance === "string"`
with a non-empty trimmed value.**

Justification (the load-bearing decision): the `acceptance` gate is **fail-closed** — a `ready`
task with no meter returns `{ok:false, "no acceptance command defined"}` (registry.js), so
`runComplete` would exit 1 and leave the task in `ready`. If the predicate were bare
`status==='ready'`, the very next scan would re-select that same un-completable task → the loop
**spins forever**. Requiring a meter makes such tasks **not actionable → skipped** (never selected,
never mutated), so a board of only-meterless `ready` tasks is a clean fixpoint (`--once` prints
`nothing to do`, exit 0). This is a *skip*, not a fail-closed abort: skipping is what keeps the
loop from spinning; the fail-closed gate still fires for any task that IS selected (has a meter)
but whose meter command fails — that task stays `ready` with a recorded fail GateEvent and,
within a `quay run` loop, is added to a `seen` set that subsequent scans subtract (see runLoop
below) so a genuinely failing meter is attempted at most once per run and the loop still reaches a
clean fixpoint. (`quay run --once` is a single process with no `seen` state; see runOnce's note on
why it deliberately re-picks the same failing task rather than pretending to make progress.)

### Ordering / determinism

Scan sorts actionable candidates **by `id` ascending** (same total order the CLI's
`--sort id` uses). So `--once` always selects a well-defined task (the lowest actionable id),
making the command deterministic and testable.

### Module signatures — `packages/quay/src/gate/driver.js`

```js
// Pure predicate — no I/O, unit-testable in isolation.
export function isActionable(task) {
  return task?.status === "ready"
      && typeof task?.extra?.acceptance === "string"
      && task.extra.acceptance.trim() !== "";
}

// Deterministic scan: fetch ready tasks, filter by meter, sort by id asc.
// Returns the id list (lowest first). Reuses client.taskList only — which
// returns FULL task objects incl. `extra` (store.list→get→toViewModel), so the
// meter is read directly off the scan result; no per-candidate taskGet needed.
// `seen` (default empty) removes ids already attempted this run (see runLoop).
export async function scanActionable(client, seen = new Set()) {
  const tasks = await client.taskList({ status: "ready" });
  return tasks.filter(isActionable).map((t) => t.id)
    .filter((id) => !seen.has(id))
    .sort();
}

// Process exactly ONE actionable task via QENG-3 runComplete.
//   pass → task advances to `done`   (runComplete writes it)
//   fail → task stays `ready` + a fail GateEvent is recorded (runComplete)
// No actionable task → { processed: null } and the caller prints "nothing to do".
// NOTE: --once is a SINGLE observation. It always picks the lowest actionable
// id; if that task's meter FAILS it stays `ready` and a subsequent `--once`
// (a fresh process, no `seen` state) will pick the SAME task again. That is by
// design (one process = one deterministic observation, exit 0), NOT progress on
// other tasks — forward progress across a failing task is the job of `quay run`
// (runLoop), whose in-run `seen` set steps past it. See AC1.
// Returns { processed: string|null, ok: boolean|null, reason: string|null }.
export async function runOnce({ client, logPath, actor = "quay-cli" }) {
  const [id] = await scanActionable(client);
  if (!id) return { processed: null, ok: null, reason: null };
  const { ok, reason } = await runComplete({ client, id, logPath, actor });
  return { processed: id, ok, reason };
}

// Bounded loop until fixpoint OR stop sentinel. Each iteration scans MINUS the
// `seen` set and processes the lowest remaining actionable id.
//   sentinel: <cfg.workspaceRoot>/.quay/.stop  (checked BEFORE each iteration)
//   cap:      maxIterations (default 1000) — hard ceiling so it cannot hang
// Anti-spin: a task is added to `seen` after it is ATTEMPTED (pass or fail). A
// pass leaves the board (status→done, no longer `ready`); a fail leaves it
// `ready`, so `seen` is what stops it being re-picked. Because scanActionable
// subtracts `seen`, once every actionable id has been attempted the scan returns
// [] → clean FIXPOINT (not cap). This is the load-bearing correction: without
// subtracting `seen` the scan would keep re-surfacing a failing `ready` task and
// the loop would only ever stop at the cap.
// Returns { iterations, completed: string[], stopped: "fixpoint"|"sentinel"|"cap" }.
export async function runLoop({ client, cfg, logPath, actor = "quay-cli", maxIterations = 1000 }) {
  const seen = new Set();
  const completed = [];
  const stopFile = path.join(cfg.workspaceRoot, ".quay", ".stop");
  let iterations = 0;
  while (true) {
    if (fs.existsSync(stopFile)) return { iterations, completed, stopped: "sentinel" };
    if (iterations >= maxIterations) return { iterations, completed, stopped: "cap" };
    const [id] = await scanActionable(client, seen);
    if (!id) return { iterations, completed, stopped: "fixpoint" };
    iterations++;
    seen.add(id);
    const { ok } = await runComplete({ client, id, logPath, actor });
    if (ok) completed.push(id);
  }
}
```

`runComplete` is imported from `./lifecycle.js`; `fs`/`path` (node builtins) back the sentinel
check. The driver adds **no new gate logic** and touches **no** Provider ABI beyond `taskList`
(scan) + whatever `runComplete`/the acceptance gate already use (`taskWrite`, `taskCheck`).
Confirmed against `quay-native/src/store.js`: `taskList` returns full task objects incl. `extra`,
so the meter is read off the scan result directly — the driver does NOT `taskGet` each candidate.

Three independent stops (see `runLoop` above): **sentinel** (top-of-iteration `.quay/.stop`, clean
boundary, never mid-write), **fixpoint** (`scanActionable(client, seen)` returns `[]` — the normal
exit), **cap** (`maxIterations` 1000 — a hard backstop, `stopped:"cap"`, the only nonzero exit).

### CLI wiring — `packages/quay/bin/quay.js` (new `cmd === "run"` branch)

Mirrors the `complete` branch verbatim in plumbing:

```js
if (cmd === "run") {
  await withProvider(async (client, cfg) => {
    const logPath = resolveGateLogPath(cfg.workspaceRoot, { file: flags.file });
    process.env.QUAY_ACCEPTANCE_CWD = cfg.workspaceRoot;          // pin acceptance cwd (QENG-2)
    if (flags.once) {
      const r = await runOnce({ client, logPath });
      if (!r.processed) console.log("nothing to do");
      else console.log(`${r.processed}: ${r.ok ? "PASS — done" : `FAIL — ${r.reason} (left ready)`}`);
      // exit 0 always: a fail leaves the task ready + records a GateEvent; that is a
      // successful driver OBSERVATION, not a driver error (matches AC1 "processes one … exit 0").
      // runComplete sets process.exitCode=1 on a meter fail, so the driver must RESET it —
      // the `--once` contract is "one observation made, exit 0", distinct from `complete`'s
      // "this task passed/failed" exit code. (runLoop needs no reset: it never surfaces an
      // individual runComplete's exit code.)
      process.exitCode = 0;
    } else {
      const r = await runLoop({ client, cfg, logPath });
      console.log(`run: ${r.completed.length} completed in ${r.iterations} iters (stop=${r.stopped})`);
      if (r.stopped === "cap") process.exitCode = 1;               // only the safety ceiling is nonzero
    }
  }, { providerId: flags.provider });
  return;
}
```

`--once` and `run` (loop) both exit 0 on normal outcomes; only the runaway-cap guard exits nonzero.
`--file` overrides the GateEvent log path, consistent with `complete`/`gate`.

## Acceptance Criteria (mirroring `tasks/QENG-4.md` — every AC a runnable command + exit code)

- [ ] **AC1** — `quay run --once` processes one ready task end-to-end (scan → gate → complete)
  and exits **0**. Reproducible: seed a workspace with exactly one actionable task
  `A {status:ready, extra.acceptance:"true"}`; `quay run --once; echo $?` prints `A: PASS — done`
  and `0`, and `quay task view A` now shows `[done]`. A second `quay run --once` on the same board
  (A now `done`, no other actionable task) prints `nothing to do` and `0` (fixpoint). Determinism:
  with two actionable tasks the LOWEST id is always the one selected (scan sorts by id).
- [ ] **AC2** — `quay run` honors the stop sentinel: with `<workspaceRoot>/.quay/.stop` present
  before the run, `quay run; echo $?` exits cleanly at the top of the first iteration (**0**),
  reporting `stop=sentinel`. A normal fixpoint (no actionable tasks) likewise exits **0**; only the
  runaway `stop=cap` case exits nonzero (**1**).
- [ ] **AC3 (POC)** — one exp5 OUTER-LOOP ABSORB step is expressed as a `quay run --once`
  invocation reproducing the same board transition (`ready` + meter → gate runs → `done`) on a
  **self-contained quay task-board fixture** (a temp workspace seeded with one `ready` task whose
  `extra.acceptance` is `true`), asserted in `packages/quay/test/driver.test.mjs`. Does NOT touch
  `experiments/quay-perpetual-stream/**`.
- [ ] **AC4** — tests ≥ 80% on `driver.js`, actually run:
  `node --test --experimental-test-coverage packages/quay/test/driver.test.mjs` (paste output).

**AC3 POC scope:** the analogy — exp5's OUTER-LOOP ABSORB step advances a `ready` milestone task
whose meter passes to `done`; `quay run --once` on fixture `POC-1 {status:ready, extra.acceptance:
"true"}` does the **same class** of transition (asserts `taskGet(POC-1).status === "done"` + a
`complete` pass GateEvent). Fixture built entirely in the test's temp workspace via the native
provider (as `lifecycle.test.mjs` does); exp5 is referenced as prose only, never read or executed.

## Trade-offs / Risks

- **In-process synchronous loop vs epicd's tick/spawn driver.** Drops the whole
  detect→spawn→adjudicate→merge machinery; no parallelism/worktree isolation. Faithful because exp5's
  OUTER-LOOP is itself sequential and each unit of work is one deterministic `runComplete`.
- **Runaway / spinning** (headline risk) — three layers: (1) the predicate excludes meterless
  `ready` tasks so they are never selected; (2) `runLoop`'s `seen` set (subtracted by
  `scanActionable`) attempts a *failing*-meter task at most once per run, so the scan drains to
  `[]` → fixpoint rather than re-surfacing it forever; (3) `maxIterations` (1000) is a hard ceiling.
- **Meter-required predicate skips meterless `ready` tasks** silently. Acceptable:
  `quay task list --status ready` already surfaces them; selecting them reintroduces the spin.
- **Sentinel never mid-write** — checked only at the top of each iteration, so an in-flight
  `runComplete` always finishes first: no half-applied transition.
- **No log-path drift / no ABI creep** — `resolveGateLogPath` is the single path authority; scan is
  `taskList({status:"ready"})` and all writes go through QENG-3 `runComplete`. No new Provider tool.

## Architect review notes

Reviewed against real code; edits applied directly.
1. **`taskList` returns `extra` — CONFIRMED.** `quay-native/store.js` `list()`→`get()`→`toViewModel()`
   emits full objects incl. `status` + `extra` (`extra: frontmatter.extra ?? {}`). The predicate reads
   the meter off the scan result; the driver does NOT `taskGet` each candidate. Doc updated to state this.
2. **Anti-spin CORRECTED (was a latent bug).** The prior `scanActionable` did not subtract `seen`, so a
   failing-meter `ready` task would re-surface every scan and the loop would stop only at the cap, never
   fixpoint. Now `scanActionable(client, seen)` subtracts `seen`; `runLoop` adds each attempted id to
   `seen` → the scan drains to `[]` → clean fixpoint, with forward progress on OTHER ready tasks. This is
   correct and terminating.
3. **`--once` re-pick made explicit + exit-0 fixed.** `--once` has no `seen` state, so it deliberately
   re-picks the same failing task (one process = one observation); documented in `runOnce`. Added the
   missing `process.exitCode = 0` reset in the CLI branch (`runComplete` sets it to 1 on a meter fail).
4. **Determinism / sentinel / POC scope confirmed.** Scan sorts by id (driver-owned, not relying on
   `taskList` order); sentinel checked at top-of-iteration only; AC3 is a self-contained temp-workspace
   fixture and does not touch `experiments/quay-perpetual-stream/**`. Test path corrected to
   `packages/quay/test/driver.test.mjs`; every AC is a runnable exit-code command.
