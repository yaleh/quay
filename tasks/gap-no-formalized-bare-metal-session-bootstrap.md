---
id: gap-no-formalized-bare-metal-session-bootstrap
title: "there is no formalized step for bootstrapping the tmux session layout quay:cold-start assumes already exists — tonight's manager/inner/outer windows were all built by hand"
status: done
parent: gap-quay-has-never-self-hosted-its-own-cold-start
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

> **翻 done（outer 2026-08-12, r314-green 686b5540 覆盖）**：代码落地 develop + AC 勾选 + measure 复核通过。

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

- [x] AC1: running the script against bare tmux (no windows) produces the named layout, each
      window's Claude Code process confirmed live (real command + output pasted)
- [x] AC2: idempotent — re-running against an already-built session does not duplicate windows or
      kill/restart already-live processes (real run pasted)
- [x] AC3: a window whose process fails to start is reported by name, script exits non-zero, and
      no other window is silently left half-built without being named too
- [x] AC4: `quay:cold-start`'s own precondition check ("inner session reachable") can run
      immediately after this script with no additional manual step
- [x] AC5: tests use `node:test` or the repo's existing bash-test convention for scripts,
      `// @test-group product`

### Invoke evidence (AC1-AC3 real runs, hermetic tmux on a private socket)

The liveness check is the same `/proc` process-detection `session-liveness.sh` uses (a pane process
or child whose cmdline contains `claude`); the hermetic runs below use the repo's established
`claude-probe` stand-in (`exec -a claude-probe sleep`, the session-topology test convention), and the
REAL launch command the script uses by default is proven separately via `quay-launch.sh --dry-run`.

**AC1 — bare tmux → named layout, each window's process confirmed live (exit 0):**

```
create-session: tmux new-session -d -s sb-ev -n inner
  launched: sb-ev:inner
create-window: tmux new-window -t sb-ev -n outer
  launched: sb-ev:outer
  verified: sb-ev:inner (claude process live)
  verified: sb-ev:outer (claude process live)
bootstrap ok: sb-ev layout 'inner outer' all windows live
exit=0
```

**AC2 — idempotent re-run (no duplicates, live processes untouched, exit 0; windows stay `inner outer`):**

```
in-place: sb-ev:inner (claude process present)
in-place: sb-ev:outer (claude process present)
  verified: sb-ev:inner (claude process live)
  verified: sb-ev:outer (claude process live)
bootstrap ok: sb-ev layout 'inner outer' all windows live
exit=0
windows after re-run: inner outer
```

(The test additionally asserts the SAME pane pid survives the re-run — no kill/restart.)

**AC3 — a window whose process fails to start is reported BY NAME, exit non-zero, other window named too:**

```
create-session: tmux new-session -d -s sb-ev3 -n inner
  launched: sb-ev3:inner
create-window: tmux new-window -t sb-ev3 -n outer
  launched: sb-ev3:outer
FAILED: sb-ev3:inner (no claude process after 3s)
  verified: sb-ev3:outer (claude process live)
bootstrap FAILED: sb-ev3 layout 'inner outer'
exit=1 (non-zero = fail-closed)
```

**The layout's documented model/env-var convention — the real launch command the script uses
(`quay-launch.sh <role> --dry-run`, no claude started):**

```
  manager -> claude --settings <…launch.settings.json…> --exclude-dynamic-system-prompt-sections --prompt-suggestions false -n quay-manager
  outer   -> claude-deepseek --settings <root>/.claude/launch.settings.json --exclude-dynamic-system-prompt-sections --prompt-suggestions false --model deepseek-v4-flash -n quay-outer
  inner   -> claude-deepseek --settings <root>/.claude/launch.settings.json --exclude-dynamic-system-prompt-sections --prompt-suggestions false --model deepseek-v4-flash -n quay-inner
```

**Scoped test + static-check gate (AC5; `scripts/test.sh --for-task gap-no-formalized-bare-metal-session-bootstrap`):**

```
PASS: every test file uses node:test or is a listed legacy exemption; exemption list is at/below the ratchet ceiling…
PASS: all 44 violation(s) are baselined in plugin/test-isolation-violations.txt…
task-contract-check: no violations. (strict-subset on the touched task file)
PASS: active whole-screen-hash violations (1) within band (0..1)
✔ AC1 … ✔ AC1 (manager layout) … ✔ AC2 … ✔ AC3 … ✔ AC4 … ✔ AC5 … ✔ AC5 (SKILL wiring) … ✔ layout validation … ✔ --dry-run
tests 9 · pass 9 · fail 0 · cancelled 0
```

AC4 is exercised by the test: after `session-bootstrap.sh <root> inner/outer` (session name read
from `<root>/orchestration/session-liveness.env`, no `--session` passed), `tmux list-panes -t
<session>` succeeds — exactly cold-start's "inner session reachable" precondition. The SKILL now
names `session-bootstrap.sh` as the bare-metal step in its Preconditions and in step 2.

**Gap closure note (DoD):** this closes the gap `quay:cold-start`'s own docs name — cold start was
"hand-build the session, then one command"; it is now truly one command
(`bash <root>/plugin/scripts/session-bootstrap.sh <root> inner/outer` → then `/quay:cold-start`).

## Definition of Done

- [ ] AC1-AC3 real-run outputs pasted into this task body
- [ ] Full suite 2x green (`fail 0` and `cancelled 0`)
- [ ] Task body records: this closes the gap `quay:cold-start`'s own docs name ("now it is truly
      one command — before, it was 'hand-build the session, then one command'")

## Contract

measure   bootstrap_script = `test -f plugin/scripts/session-bootstrap.sh && grep -c 'verify' plugin/scripts/session-bootstrap.sh` 的计数
band      bootstrap_script = ≥ 1（脚本存在且含 liveness verify）
invariant idempotent = 1（重复运行不重复建窗口、不杀活进程）
invariant fail_closed = 1（任一窗口进程失败即非零退出并指名窗口）
invoke    `bash scripts/test.sh --for-task gap-no-formalized-bare-metal-session-bootstrap`
control   scoped 门绿；AC1-AC3 实跑输出已贴任务体
resume    script + 测试 + SKILL 接线分步提交

## Touches

- tasks/gap-no-formalized-bare-metal-session-bootstrap.md
- plugin/scripts/session-bootstrap.sh (new)
- plugin/test/session-bootstrap.test.mjs (new)
- plugin/skills/cold-start/SKILL.md

## Dispatch review

reviewer: none
at: 2026-08-04T10:1xZ
changed: 无（外层建任务，转译 SPEC-quay-self-hosts-its-own-cold-start.md 的 SH2；未经正式闸口审查）
