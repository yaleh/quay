---
name: quay-loop-driver
description: "Drive a workspace's quay task board through a single `iterate` cycle (or iterate* until Stop): select a ready task, isolate it in a dependency-ready worktree, build+test it, gate it, record evidence, and land. Parameterised by `.quay/config.yml` (loop: section) — the same skill, different params, for any workspace. Runner-agnostic and workspace-portable."
allowed-tools: Bash, Read, mcp__plugin_quay_quay__task_list, mcp__plugin_quay_quay__task_get, mcp__plugin_quay_quay__task_write, mcp__plugin_quay_quay__gate_run, mcp__plugin_quay_quay__gate_log, mcp__plugin_quay_quay__lifecycle_complete, mcp__plugin_quay_quay__lifecycle_promote, mcp__plugin_quay_quay__lifecycle_retreat, mcp__plugin_quay_quay__lifecycle_adjudicate, mcp__plugin_quay_quay__action_list, mcp__plugin_quay_quay__action_run, mcp__plugin_quay_quay__task_check
---

# quay-loop-driver

```
iterate :: Board × Kit × Gates → Milestone        -- once ; or iterate* until Stop
  select  :: Board ⇀ Task        -- ready·top-ranked ; ⊨ exclude label:human-steered
  isolate :: Task → Worktree     -- git worktree off HEAD ; ⊨ ¬on-master (DIR-027) ; ⊨ deps-ready (node_modules/venv present — symlink or install)
  build   :: Task × Worktree → Diff  -- TDD ; ⊨ behavior-preserving
                                      -- dispatched (DEFAULT): subagent builds; inline: driver builds
  gate    :: Task → {PASS, FAIL}     -- runner-agnostic ; ⊨ fail-closed ; ⊨ runner ∉ driver ; ⊨ cwd = worktree (gate the BUILT tree, not workspaceRoot — DIR-046)
  audit   :: Diff × AC/DoD → {NO-REFUTATION, REFUTATION-FOUND}
                                      -- adversarial (DEFAULT): fresh-context subagent refutes; none: skip
  record  :: Diff × Gate → Evidence  -- ⊨ real-object (DIR-026) ≠ fixture
  land    :: Diff → Commit ⊕ needs-human  -- ⊨ done ∨ needs-human (SPLIT-OR-COMMIT)

invariants (∀ iteration):
  worktree ⊥ master
  · gate fail-closed
  · evidence real ≠ fixture
  · runner ∈ workspace gates config ONLY (never the driver)
  · params ∈ workspace .quay/config.yml (loop: section) or .quay/loop.yml ONLY (never hardcoded in this skill)
  · execution=dispatched: build subagent ⊥ driver context ; FAIL-CLOSED if no Agent tool
  · audit=adversarial: auditor ⊥ build context (fresh-context) ; refutation blocks land
```

## Params — `.quay/config.yml` (loop: section) or `.quay/loop.yml` (REQUIRED, fail-closed if absent/malformed)

DIR-050: the reader tries `.quay/config.yml` (loop: section) first; falls back to `.quay/loop.yml`.

```yaml
# Schema: board REQUIRED, gates REQUIRED, stop/policy/execution/audit/concurrency OPTIONAL
# coexist: RETIRED (DIR-050) — silently ignored if present in legacy YAML
board:       native          # provider name (matches .quay/config.yml providers key)
gates:       [vitest]        # gate name(s) from gates config; PASS iff all pass
stop:        once            # once | until(.halt) | until(empty) | until(<condition>)
policy:      ready-first     # select ranking: ready-first | value-typed-ledger | …
execution:   dispatched      # dispatched (DEFAULT) | inline — build isolation
audit:       adversarial     # adversarial (DEFAULT) | none — independent fresh-context verify
concurrency: 1               # 1 (DEFAULT) = serial | N = max touches-disjoint batch width (DIR-049)
routines: []                 # [] (DEFAULT) = no routine track | [{name,trigger,dispatch?}] (DIR-051)
                             # probe: <name> (new, DIR-056) | dispatch: <action> (legacy back-compat)
```

The skill reads params via `readLoopParams` (`src/loop-params.js`). If absent or malformed, it refuses to run (FAIL-CLOSED). No runner name, project name, or workspace path is hardcoded in this skill.

**Default behavior (no `execution`/`audit` keys):** build runs in a fresh background subagent (`execution: dispatched`) and a fresh-context adversarial auditor runs before land (`audit: adversarial`). This is the two-layer model. To opt out to single-context/self-gated behavior (constrained/trivial workspaces), set `execution: inline` + `audit: none` explicitly in `.quay/config.yml` `loop:` section.

**Concurrency (`concurrency > 1`, DIR-049) — opt-in cross-milestone batching.** Default `1` = serial (one dispatched build per iterate = steps 2→7 below). Concurrency defaults OFF (unlike dispatch/audit which default ON) because it trades safety for throughput and is safe ONLY where ready tasks are touches-disjoint AND carry no SELECT←ABSORB learning dependency (e.g. archguard's independent refactors qualify; methodology milestones with cross-milestone learning dependencies do not). When `concurrency = N > 1`, one iterate = one BATCH, orchestrated by CALLING the DIR-044 scripts (single-source — never re-implement them):
1. **SELECT → batch:** run `node "${CLAUDE_PLUGIN_ROOT}/scripts/concurrent-batch-scheduler.ts" --root <workspaceRoot> <ready task .md files>` to assemble a maximal touches-disjoint, execution-type batch up to width N. (The DIR-044 scripts ship WITH the plugin under `${CLAUDE_PLUGIN_ROOT}/scripts/` — do NOT look for them in the workspace's own `scripts/`.) Tasks lacking a `## Touches` declaration, overbroad, or learning-type → conservative-serialize (not batched). A 1-wide result = fall back to serial (steps 2→7).
2. **Dispatch N (concurrent):** for each batched task run steps 3→6b — `isolate` (own worktree) + `build` (dispatched subagent) + `gate` + `6b audit` (fresh-context) — CONCURRENTLY. The driver stays a lean orchestrator and polls all N.
3. **Fan-in (serial):** collect the survivors (gate PASS **and** audit NO-REFUTATION). Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/anti-drift-touches-check.ts" <ran-batch-manifest.json>` on the REAL diffs — a mis-declared overlap HARD-FAILs the batch (NON-WAIVABLE, do not merge). Then `node "${CLAUDE_PLUGIN_ROOT}/scripts/serial-fanin-absorb.ts"` for the deterministic merge plan; merge each survivor one-at-a-time and mark it `done`. A build that FAILED gate or was REFUTED → `needs-human`, EXCLUDED from fan-in (partial-batch: disjoint survivors still land).
Guardrails (all from DIR-044): conservative-default-serialize, learning-never-batched, anti-drift HARD, native-only (no manda).

**Routines (`routines: [...]`, DIR-051) — a standing track parallel to SELECT.** Default `[]` = no routines (today's behavior). A routine is `{name, trigger, probe?, dispatch?}`: `trigger` is `every(N)` (LEGACY iteration-count back-compat — fire when a caller-supplied counter is a positive multiple of N), `interval:<N>m` (two-layer TIME — fire N minutes after the routine's last run; never-ran = due; needs `--last-run` state), or `on(<event>)` (fire on a named event such as `idle`/…). Two-layer mode (no iteration counter since ADR-022) configures `interval:<N>m` / `on(<event>)`. `probe: <name>` (new, DIR-056) is the primary form; `dispatch: <action>` is the legacy back-compat form (DIR-051). When both are present, `probe:` takes priority. A routine with neither `probe` nor `dispatch` is SKIP+logged — fail-closed per routine, never per loop.

Each iterate, AFTER SELECT (or when idle), evaluate which routines are DUE with `node "${CLAUDE_PLUGIN_ROOT}/scripts/routine-scheduler.ts" --now <epoch-ms> --last-run <workspaceRoot>/.quay/routine-last-run.json [--iteration <n>] [--event <e>] --plugin-root "${CLAUDE_PLUGIN_ROOT}" <routines.json>` (exit 0 + lists the due ones; exit 3 = none due). After firing, write each fired routine's `{ "<name>": <now-epoch-ms> }` back into the `--last-run` file so `interval:<N>m` routines do not re-fire within their window. The output line format is: `DUE: <name> (<trigger>) → probe <name>` (probe path) or `DUE: <name> (<trigger>) → dispatch <action>` (dispatch path).

**Probe path (new, DIR-056):** When the scheduler output line contains `→ probe <name>`:
1. Call `readProbeSpec(name, CLAUDE_PLUGIN_ROOT)` from `plugin/scripts/read-probe-spec.ts` to get `{ instrument, fallback, output_routing, objective }`. Fail-closed: if `readProbeSpec` throws (`PROBE-SPEC FAIL-CLOSED: …`), skip this routine for this iteration (log the error; never crash the loop).
2. **Instrument availability check.** If `instrument !== "none"`, verify the named MCP server (e.g. `meta-cc`, `archguard`) is available in the current session before dispatching. If unavailable and `fallback === "none"`, skip and log; the routine will fire again on its next trigger.
3. **Objective parameterization.** Prepend `WORKSPACE: <workspaceRoot>\n` to `spec.objective` so the dispatched agent can resolve workspace-relative paths without hardcoding.
4. **Dispatch** a fresh-context background agent (same `execution: dispatched` infra) with the combined objective prompt.
5. **Output routing.** When the probe agent files a candidate task, use `spec.output_routing[finding.type]` to set the task label. If `finding.type` is absent or unrecognized, use `spec.output_routing.default` (defaults to `"milestone-candidate"` if unset in the probe spec).

**Dispatch path (legacy back-compat):** When the output line contains `→ dispatch <action>`, dispatch a fresh-context background agent to perform its `dispatch` action (e.g. an adversarial self-probe, an archguard/proxy architecture read) — no behavior change from DIR-051.

The agent's findings are **FILED as evidence-backed tasks** (`## Finding`-bearing), each gated by the MECHANICAL `node "${CLAUDE_PLUGIN_ROOT}/scripts/routine-file-gate.ts" --board <tasksDir> --recent <N> --k <K> <candidate-task.md>` (exit 0 = ACCEPT: actionable finding with reproduction evidence, not a duplicate on the board, within the per-window rate cap; exit 1 = REJECT). Do NOT file a REJECTed candidate — the gate is a runnable check, not a prose promise. **FILE-ONLY invariant:** a routine NEVER executes its own findings — the SELECT track drives the filed tasks under the normal gate + audit (routines DISCOVER, SELECT+audit DECIDE). Backstop the invariant mechanically: after a routine fires, a routine run MUST have produced ONLY new task files and NO commits/diffs to product or method code — `git -C <ws> status --porcelain` should show only new `tasks/` (or board) entries; if a routine touched anything else, that is a FILE-ONLY violation → discard and flag. Routine scheduling never dispatches manda.

## Steps

### 0. Read params
```
params = readLoopParams(workspaceRoot)   -- src/loop-params.js ; throws FAIL-CLOSED if missing/invalid
```

### 1. Halt check
```
select :: Board ⇀ Task
```
If `params.stop = until(.halt)`: `test -f .halt` (workspaceRoot-relative). If present, log "halt sentinel present — stopping" and return. Never remove the file.
<!-- coexist retired (DIR-050): no peer-sentinel check. -->

### 2. Select
```
select :: Board ⇀ Task        ⊨ exclude label:human-steered
```
MCP `task_list` with `{ status: "ready", provider: <params.board> }`. Apply `params.policy` ranking. Take first result that lacks `label:human-steered`. If empty → idle (ScheduleWakeup or return if `stop=once`).

### 3. Isolate
```
isolate :: Task → Worktree    ⊨ ¬on-master ; ⊨ deps-ready
```
`git worktree add <path> -b <branch>` off HEAD. Branch name: `milestones/<ws>/<task.id>` (workspace-local convention). Ensure deps are present in the worktree: symlink `node_modules` (or `venv`) from the main workspace, or install.

**`deps-ready` includes untracked-but-required files (DIR-049 B2).** A fresh worktree contains only tracked files; any UNTRACKED file the gate needs (a generated fixture, a local `.agents/skills/**` reference, an un-committed config) is absent, and the gate then fails on an environmental gap, not a real defect. After creating the worktree, copy the workspace's untracked-but-required files into it — `git -C <mainWorkspace> ls-files --others --exclude-standard` lists candidates; sync those the runner reads. The runner MUST work in the worktree without manual intervention: under `execution: dispatched` there is no human to copy a missing file per build, and a DIR-049 concurrent batch has N worktrees each hitting this.

**Declared GITIGNORED files (`.worktreeinclude`).** The ad-hoc `ls-files --others --exclude-standard` pass above is for non-gitignored untracked files. A SEPARATE class is GITIGNORED-but-required files (`.quay/config.yml`, generated vendor bundles) — `git worktree add` never places them, `ls-files --others --exclude-standard` excludes them, and hand-copying misses (this repo's round-5 verification worktree lacked `.quay/config.yml` → "Error: Cannot find repo root: no .quay/config.yml found upward" ×15 → 72 file crashes). When the workspace declares a `.worktreeinclude` file (gitignore syntax listing the gitignored files every worktree needs), run its include entry point right after `git worktree add`: `bash scripts/worktree-include.sh <worktree-path>` (a mechanical copy of exactly the declared ∩ gitignored files from the primary checkout; see the script header for semantics). If the workspace has no `.worktreeinclude`, this step is a no-op.

### 4. Build
```
build :: Task × Worktree → Diff    ⊨ behavior-preserving (TDD)
```

**IF `params.execution = dispatched` (DEFAULT):**
Spawn a background subagent (Agent tool, `run_in_background=true`) to implement the task in the worktree using TDD. The subagent prompt MUST carry: full task body (AC/DoD verbatim), worktree absolute path, gate names. The driver session is a LEAN ORCHESTRATOR — do NOT implement the task inline.

Poll for completion: the completion notification is the primary wake signal; arm a fallback ScheduleWakeup in case notification is delayed. Do NOT conclude that the build failed just because the driver is waiting.

FAIL-CLOSED: if no Agent tool is available under `execution: dispatched` (or default), refuse with:
`"FAIL-CLOSED: execution=dispatched requires Agent tool; set execution: inline to opt-out"`
Never silently fall back to inline execution.

**IF `params.execution = inline`:**
Implement the task in the worktree directly in the driver's own context (today's behavior). For trivial single-file tasks or environments where spawning a subagent is impossible. This is an explicit opt-out — declare it in `.quay/config.yml` `loop:` section, not the default.

### 5. Gate
```
gate :: Task → {PASS, FAIL}    ⊨ fail-closed ; ⊨ cwd = worktree ; ⊨ runner ∉ driver
```
MCP `gate_run` with `{ id: <task.id>, gate: <params.gates[0]>, cwd: <worktree>, provider: <params.board> }` (or iterate over `params.gates`). Returns `{ ok, reason }` — `ok: true` = PASS; `ok: false` = FAIL. The runner (`vitest`, `node --test`, etc.) lives in `.quay/config.yml` `gates:` section — not in this skill. The `cwd` parameter (DIR-046) ensures the gate runs against the BUILT worktree, not workspaceRoot.

### 6. Record
```
record :: Diff × Gate → Evidence    ⊨ real-object (DIR-026) ≠ fixture
```
Capture the gate output and any real diff/artefact. Evidence must be a real operated object (a real test run, a real diff), not a synthetic fixture.

~~**Panel observation mechanism (state-transition expression)**~~（**已退役** 2026-09-01：`inner-panel-stale-check.ts` CLI 壳已删，纯函数迁 `plugin/scripts/agent-panel-classify.ts`——`gap-retire-inner-hygiene-delete-session-face`）。The pure classification logic (parseTimerSec/classifyLines/detectFrozen/runStaleCheck) lives in `agent-panel-classify.ts`.

### 6b. Adversarial Audit
```
audit :: Diff × AC/DoD → {NO-REFUTATION, REFUTATION-FOUND}    ⊨ fresh-context ≠ build-context
```

**IF `params.audit = adversarial` (DEFAULT):**
After gate PASS, before land: spawn a FRESH-CONTEXT subagent (Explore/general-purpose, `run_in_background=true`) to adversarially audit the diff against the task's AC/DoD. The auditor MUST originate from the top-level driver session (only the top-level context can spawn a genuinely independent fresh-context subagent).

The auditor prompt:
> "You are an adversarial auditor. REFUTE-FIRST: try to find reasons the following diff does NOT satisfy the task's AC/DoD. Read the diff and task body from [worktree paths]. Report exactly one of: REFUTATION FOUND (blocking — state the specific AC/DoD clause violated) or NO REFUTATION FOUND."

The auditor MUST NOT have seen the build session (fresh-context, `run_in_background`). A `REFUTATION FOUND` response blocks land and routes the task to `needs-human`. A `NO REFUTATION FOUND` response proceeds to land.

**IF `params.audit = none`:**
Skip adversarial audit. Gate output only is the record. For throwaway/experimental boards as an explicit opt-out declared in `.quay/config.yml` `loop:` section.

### 7. Land
```
land :: Diff → Commit ⊕ needs-human    ⊨ done ∨ needs-human (SPLIT-OR-COMMIT)
```
- PASS: commit the diff in the worktree, MCP `task_write` with `{ id: <id>, status: "done", provider: <params.board> }`, remove the worktree.
- FAIL: capture gate output, MCP `task_write` with `{ id: <id>, status: "needs-human", provider: <params.board> }`, leave worktree for inspection. First FAIL goes straight to `needs-human` — no retry loop.

### 8. Continue / stop
If `params.stop = once`: return.
If `params.stop = until(.halt)`: loop back to step 1 (halt check).
If `params.stop = until(empty)`: loop back to step 1 until no ready tasks remain, then idle (ScheduleWakeup).
