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
  gate    :: Task → {PASS, FAIL}     -- runner-agnostic ; ⊨ fail-closed ; ⊨ runner ∉ driver ; ⊨ cwd = worktree (gate the BUILT tree, not workspaceRoot — DIR-046)
  record  :: Diff × Gate → Evidence  -- ⊨ real-object (DIR-026) ≠ fixture
  land    :: Diff → Commit ⊕ needs-human  -- ⊨ done ∨ needs-human (SPLIT-OR-COMMIT)

invariants (∀ iteration):
  worktree ⊥ master
  · gate fail-closed
  · coexist: pause(peer-loop) if coexist ≠ ∅
  · evidence real ≠ fixture
  · runner ∈ workspace .quay/gates.yml ONLY (never the driver)
  · params ∈ workspace .quay/loop.yml ONLY (never hardcoded in this skill)
```

## Params — `.quay/loop.yml` (REQUIRED, fail-closed if absent/malformed)

```yaml
# Schema: board REQUIRED, gates REQUIRED, stop/policy/coexist OPTIONAL
board:   native              # provider name (matches .quay/config.yml providers key)
gates:   [vitest]            # gate name(s) from .quay/gates.yml; PASS iff all pass
stop:    once                # once | until(.halt) | until(empty) | until(<condition>)
policy:  ready-first         # select ranking: ready-first | value-typed-ledger | …
coexist: null                # pause-hook (e.g. "pause(backlog/.loop-stop)") or null
```

The skill reads this file first via `readLoopParams` (`src/loop-params.js`). If absent or malformed, it refuses to run (FAIL-CLOSED). No runner name, project name, or workspace path is hardcoded in this skill.

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
Implement the task in the worktree (TDD: write tests first, then code). Work exclusively in the worktree — never on master directly.

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
