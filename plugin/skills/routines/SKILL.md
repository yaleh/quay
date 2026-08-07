---
name: routines
description: Evaluate the standing routine track from .quay/config.yml loop: section — scheduler → readProbeSpec → dispatch probes → gate findings → FILE-ONLY verify. Replaces OUTER-LOOP.md step 5a.
allowed-tools: Bash, Read, Write, TaskCreate, TaskUpdate, TaskGet, TaskList, SendMessage, Skill, mcp__quay__task_get, mcp__quay__task_list, mcp__quay__task_write
---

# quay:run-routines

## Spec

Evaluate the standing routine track: read `.quay/config.yml` `loop:` section (legacy: `.quay/loop.yml`) routines config, schedule
due probes, dispatch them as background agents with instrument-awareness, gate
their findings through the routine-file-gate, and verify the FILE-ONLY invariant
(no product/method code touched).

    λ(workspaceRoot, tasksDir, milestoneCounter=0) → {fired, filed, rejected, fileOnlyViolation}

    schedule  :: Config → [{name, probe, trigger?}]
    dispatch  :: [{name, probe}] → [{probe, candidates, filed}]
    gate      :: [CandidatePath] → [{candidate, accepted}]
    verify    :: WorkspaceRoot → {violation, detail?}

## Pipeline

### Phase 1 — Schedule

1. Read `routines:` from `.quay/config.yml` `loop:` section (legacy fallback: `.quay/loop.yml`).
2. Write routines as a temporary JSON array (one object per routine with
   `{name, trigger, probe?, dispatch?}`).
3. Run the scheduler against the TWO-LAYER trigger quantities (ADR-022 retired the iteration
   counter — see `gap-probe-mechanism-dead-15-days-rewire-to-two-layer`):
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/routine-scheduler.ts" --now <epoch-ms>
   --last-run <workspaceRoot>/.quay/routine-last-run.json [--event <event>] --plugin-root
   "${CLAUDE_PLUGIN_ROOT}" /tmp/routines-<tick>.json`.
   `--now` is the current wall-clock epoch-ms; `--last-run` is the per-routine last-run map
   (`{ "<name>": <epoch-ms> }`, absent = never ran → due) that `interval:<N>m` triggers consult.
   Exit 0 + lists DUE routines (one per line: `DUE: <name> (<trigger>) -> probe <name>`);
   exit 3 = none due.
4. If none due or no routines configured, return `{fired: 0}` — rest is no-op.
5. **After Phase 2 dispatch, record last-run:** for each routine actually fired, write
   `{ "<name>": <now-epoch-ms> }` back into `<workspaceRoot>/.quay/routine-last-run.json`
   (merge, don't clobber) so `interval:<N>m` routines do not re-fire within their window.

### Phase 2 — Dispatch

For each DUE routine:

1. Call `readProbeSpec("<probe>", CLAUDE_PLUGIN_ROOT)` from
   `${CLAUDE_PLUGIN_ROOT}/scripts/read-probe-spec.ts` to get
   `{instrument, fallback, output_routing, objective}`. FAIL-CLOSED: if
   readProbeSpec throws, skip this routine — never crash the track.
2. **Instrument availability check:** if `instrument !== "none"`, verify the
   named MCP server (e.g. `meta-cc`, `archguard`, `chrome-devtools`,
   `playwright`) is available in the current session. If unavailable and
   `fallback === "none"`, skip and return `{filed: false}` — the routine will
   fire again on its next trigger.
3. Prepend `WORKSPACE: <workspaceRoot>\n` to the probe objective so the
   dispatched agent can resolve workspace-relative paths.
4. Dispatch a fresh-context background subagent (TaskCreate with `subagent_type`:
   tool-capable) with the combined objective prompt. The agent explores the
   workspace, finds real defects/gaps, and writes findings as candidate task
   files.
5. Record `{probe, routine, candidates: [<paths>], filed: true}`.

### Phase 3 — Gate

For each candidate finding file:

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/routine-file-gate.ts" --board
   <tasksDir> --recent 3 --k 3 <candidate-path>`.
2. Exit 0 = ACCEPT: actionable finding with reproduction evidence, not a
   duplicate on the board, within the per-window rate cap. MOVE the file into the
   board directory (`<tasksDir>/`) and label it per the probe's
   `output_routing[type]` (default `"milestone-candidate"`).
3. Exit 1 = REJECT: DISCARD the candidate file (do NOT move it to the board).

### Phase 4 — Verify

1. Run `git -C <workspaceRoot> status --porcelain`.
2. **ACCEPTABLE:** New files under `<tasksDir>/` (routine-filed findings).
3. **UNACCEPTABLE:** Any modified/deleted file anywhere, or any new file outside
   `<tasksDir>/`. If violation found: `git checkout -- <offending files>` to
   discard.
4. Return `{violation: true|false, detail: <what was discarded>}`.

## Contracts

1. **All scripts ship with the plugin.** Use `${CLAUDE_PLUGIN_ROOT}/scripts/`
   for `routine-scheduler.ts`, `read-probe-spec.ts`, `routine-file-gate.ts` —
   never look for workspace-local copies.
2. **Instrument-aware.** Probe dispatch checks MCP availability before firing.
   Unavailable instruments with `fallback: "none"` are skipped cleanly (not
   errors). Probes with `instrument: "none"` always dispatch.
3. **Fail-closed on probe spec errors.** If readProbeSpec throws (missing file,
   parse error), the routine is skipped — never crash the track.
4. **FILE-ONLY invariant.** The routine track produces ONLY new task files
   (`<tasksDir>/<candidate>.md`). Any change to product code, method docs,
   scripts, config, or anything outside the board directory is a violation and
   MUST be discarded.
5. **Gate self-reject handled.** The routine-file-gate.ts boardKeys() excludes
   the candidate file itself via realpath comparison — the candidate may sit
   wherever the probe agent writes it.

## Cross-cutting

- **Browser-explorer probe (DIR-069):** When `chrome-devtools` or `playwright`
  MCP is available, the `browser-explorer` probe can dispatch. When unavailable,
  it skips cleanly with `filed: 0`.
- **Works with scheduler triggers:** `every(N)` (LEGACY iteration-count, back-compat),
  `interval:<N>m` (two-layer TIME — fires N minutes after last run; never-ran = due),
  `on(<event>)` (event-based, e.g. `on(checkpoint)`) — the scheduler evaluates trigger
  conditions; the skill only fires what is DUE. Two-layer mode configures
  `interval:<N>m` / `on(<event>)` — not `every(N)` (no iteration counter exists).
- **Gate quality/dedup/rate:** routine-file-gate enforces finding quality
  (actionable + evidence-backed), deduplication (no duplicate on the board),
  and rate capping (k files per window).
