---
id: gap-no-formalized-bare-metal-session-bootstrap
title: "there is no formalized step for bootstrapping the tmux session layout quay:cold-start assumes already exists — tonight's manager/inner/outer windows were all built by hand"
status: todo
parent: gap-quay-has-never-self-hosted-its-own-cold-start
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

Child of [[gap-quay-has-never-self-hosted-its-own-cold-start]] (SH2 in
`orchestration/SPEC-quay-self-hosts-its-own-cold-start.md`).

`quay:cold-start` (`plugin/skills/cold-start/SKILL.md`) assumes a Claude Code session is already
running — reasonable, since a skill needs a Claude Code process to execute it (chicken-and-egg:
this task does NOT ask for a skill that bootstraps its own runner). But the step BEFORE that —
going from bare metal to "a tmux window layout exists with a Claude Code process live in each
pane" — has zero formalized product, script, or AC anywhere in this repo. Tonight's `quay-0`
session (`manager` / `inner` / `outer` windows, `inner` running `claude-deepseek --model
deepseek-v4-flash --permission-mode bypassPermissions`, `outer` running this session) was entirely
hand-typed tmux commands, with no record of what was typed or why those specific flags.

## Chosen mechanism

A plain shell script (explicitly NOT a skill — a skill needs a running Claude Code session, which
is exactly the thing this step produces) plus its own AC list:

```
plugin/scripts/session-bootstrap.sh <root> <layout>
```

- `<layout>` is a named window set (`manager/inner/outer` or `inner/outer` per the SPEC) — reuse
  whatever layout convention already exists in this repo's own `quay-0` session and
  `orchestration/session-liveness.env`'s `SESSION_TMUX_SESSION` convention rather than inventing
  new naming
- For each named window: create it if absent (idempotent — re-running against an already-built
  session must not duplicate windows), launch the Claude Code process with the layout's
  documented model/env-var convention, and **verify the process is actually alive** — not "the
  command was sent" but a real liveness check (e.g. the same process-detection approach
  `session-liveness.sh` already uses, reused not reinvented)
- Exit non-zero, naming which window failed, if any window's process cannot be confirmed alive —
  fail-closed, matching this repo's established convention for every other bootstrap step

**Not doing**: not making this a skill (chicken-and-egg, explicitly out of scope); not inventing
a new liveness-detection mechanism (reuse `session-liveness.sh`'s).

## Acceptance Criteria

- [ ] AC1: running the script against bare tmux (no windows) produces the named layout, each
      window's Claude Code process confirmed live (real command + output pasted)
- [ ] AC2: idempotent — re-running against an already-built session does not duplicate windows or
      kill/restart already-live processes (real run pasted)
- [ ] AC3: a window whose process fails to start is reported by name, script exits non-zero, and
      no other window is silently left half-built without being named too
- [ ] AC4: `quay:cold-start`'s own precondition check ("inner session reachable") can run
      immediately after this script with no additional manual step
- [ ] AC5: tests use `node:test` or the repo's existing bash-test convention for scripts,
      `// @test-group product`

## Definition of Done

- [ ] AC1-AC3 real-run outputs pasted into this task body
- [ ] Full suite 2x green (`fail 0` and `cancelled 0`)
- [ ] Task body records: this closes the gap `quay:cold-start`'s own docs name ("now it is truly
      one command — before, it was 'hand-build the session, then one command'")

## Touches

- plugin/scripts/session-bootstrap.sh (new)
- plugin/test/session-bootstrap.test.mjs (new)
- plugin/skills/cold-start/SKILL.md

## Dispatch review

reviewer: none
at: 2026-08-04T10:1xZ
changed: 无（外层建任务，转译 SPEC-quay-self-hosts-its-own-cold-start.md 的 SH2；未经正式闸口审查）
