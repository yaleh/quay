---
name: quay-loop-driver
description: "Drive a workspace's quay task board through a single `iterate` cycle (or iterate* until Stop): select a ready task, isolate it in a dependency-ready worktree, build+test it, gate it, record evidence, and land. Parameterised by `.quay/loop.yml` — the same skill, different params, for any workspace (exp5, archguard, …). Runner-agnostic and workspace-portable."
allowed-tools: Bash, Read
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
  · coexist: pause(peer-loop) if coexist ≠ ∅
  · evidence real ≠ fixture
  · runner ∈ workspace .quay/gates.yml ONLY (never the driver)
  · params ∈ workspace .quay/loop.yml ONLY (never hardcoded in this skill)
  · execution=dispatched: build subagent ⊥ driver context ; FAIL-CLOSED if no Agent tool
  · audit=adversarial: auditor ⊥ build context (fresh-context) ; refutation blocks land
```

## Params — `.quay/loop.yml` (REQUIRED, fail-closed if absent/malformed)

```yaml
# Schema: board REQUIRED, gates REQUIRED, stop/policy/coexist/execution/audit OPTIONAL
board:     native            # provider name (matches .quay/config.yml providers key)
gates:     [vitest]          # gate name(s) from .quay/gates.yml; PASS iff all pass
stop:      once              # once | until(.halt) | until(empty) | until(<condition>)
policy:    ready-first       # select ranking: ready-first | value-typed-ledger | …
coexist:   null              # pause-hook (e.g. "pause(backlog/.loop-stop)") or null
execution: dispatched        # dispatched (DEFAULT) | inline — build isolation
audit:     adversarial       # adversarial (DEFAULT) | none — independent fresh-context verify
```

The skill reads this file first via `readLoopParams` (`src/loop-params.js`). If absent or malformed, it refuses to run (FAIL-CLOSED). No runner name, project name, or workspace path is hardcoded in this skill.

**Default behavior (no `execution`/`audit` keys):** build runs in a fresh background subagent (`execution: dispatched`) and a fresh-context adversarial auditor runs before land (`audit: adversarial`). This is the two-layer model. To opt out to single-context/self-gated behavior (constrained/trivial workspaces), set `execution: inline` + `audit: none` explicitly in `loop.yml`.

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
If `params.coexist` names a peer sentinel: test for it. If present, log and pause before proceeding.

### 2. Select
```
select :: Board ⇀ Task        ⊨ exclude label:human-steered
```
`quay task list --status ready --provider <params.board>` (or MCP `task_list`). Apply `params.policy` ranking. Take first result that lacks `label:human-steered`. If empty → idle (ScheduleWakeup or return if `stop=once`).

### 3. Isolate
```
isolate :: Task → Worktree    ⊨ ¬on-master ; ⊨ deps-ready
```
`git worktree add <path> -b <branch>` off HEAD. Branch name: `milestones/<ws>/<task.id>` (workspace-local convention). Ensure deps are present in the worktree: symlink `node_modules` (or `venv`) from the main workspace, or install. The runner MUST work in the worktree without manual intervention.

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
Implement the task in the worktree directly in the driver's own context (today's behavior). For trivial single-file tasks or environments where spawning a subagent is impossible. This is an explicit opt-out — declare it in `loop.yml`, not the default.

### 5. Gate
```
gate :: Task → {PASS, FAIL}    ⊨ fail-closed ; ⊨ cwd = worktree ; ⊨ runner ∉ driver
```
`quay gate <task.id> --gate <params.gates[0]> --cwd <worktree> --provider <params.board>` (or iterate over `params.gates`). Exit 0 = PASS; nonzero = FAIL. The runner (`vitest`, `node --test`, etc.) lives in `.quay/gates.yml` — not in this skill. The `--cwd` flag (DIR-046) ensures the gate runs against the BUILT worktree, not workspaceRoot.

### 6. Record
```
record :: Diff × Gate → Evidence    ⊨ real-object (DIR-026) ≠ fixture
```
Capture the gate output and any real diff/artefact. Evidence must be a real operated object (a real test run, a real diff), not a synthetic fixture.

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
Skip adversarial audit. Gate output only is the record. For throwaway/experimental boards as an explicit opt-out declared in `loop.yml`.

### 7. Land
```
land :: Diff → Commit ⊕ needs-human    ⊨ done ∨ needs-human (SPLIT-OR-COMMIT)
```
- PASS: commit the diff in the worktree, `quay task edit <id> --status done --provider <params.board>`, remove the worktree.
- FAIL: capture gate output, `quay task edit <id> --status needs-human --provider <params.board>`, leave worktree for inspection. First FAIL goes straight to `needs-human` — no retry loop.

### 8. Continue / stop
If `params.stop = once`: return.
If `params.stop = until(.halt)`: loop back to step 1 (halt check).
If `params.stop = until(empty)`: loop back to step 1 until no ready tasks remain, then idle (ScheduleWakeup).
