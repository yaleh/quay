---
id: gap-session-liveness-session-pid-blind-to-claude-as-pane-process
title: session-liveness session_pid is blind to claude-as-pane-process — outer
  monitor cannot see inner in the 3-window topology
status: ready
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra: {}
---
## Finding

`session-liveness.sh`'s `session_pid()` looks for a claude **CHILD** of the pane's first process (`pgrep -P <pane_pid> | head -1`). In the 2026-08-06 3-window topology (`quay-0`: windows `claude`(manager) / `inner` / `outer`, claude launched directly in each pane), `#{pane_pid}` **IS** the claude process; its children are only MCP servers → no child cmdline contains "claude" → `alive=0` ALWAYS. Because `alive=0` is the FIRST observed state (`PREV_ALIVE` unset→0), SESSION-GONE never fires (GONE needs a 1→0 transition), and IDLE/OVERDUE/RESUMED all gate on `alive=1` → the resident monitor is **permanently silent** even if the inner dies.

Measured (2026-08-06 16:1x, cold-start):
- `session-liveness.sh --once` (env SESSION_TMUX_SESSION=quay-0) → `SESSION-STATUS quay alive=0`
- `SESSION_TMUX_SESSION=quay-0:inner bash session-liveness.sh --once` → `SESSION-STATUS quay alive=0` (inner claude pid 2989409 present, pane cmdline IS `claude`)
- Inner claude children 2989553/2989559/2989561/2989582 = meta-cc-mcp + quay mcp (no "claude" substring → the child-check misses)
- Resident outer mount (Monitor task bhmi2p698, pid 2990310) silent from 16:14 → 16:24 (no event delivered; would also be silent if inner died)

## Related target defect

The outer's `SESSION_TMUX_SESSION=quay-0` (orchestration/session-liveness.env) points at the whole session; `session_pid` takes `list-panes -t quay-0 | head -1` = **manager** pane (0.0), NOT the inner (`quay-0:inner`). So even after the detection fix, the outer's monitor observes the manager — it must target the inner window. `inner-session-check.sh` / `topology-check.sh` correctly append `:inner`/`:outer` to the same env value, so the env value `quay-0` is the right SESSION name; the fix is session-liveness's per-role target resolution.

## 复现确认 + 影响升级（管理者 2026-08-06 16:5xZ，第五次崩溃恢复后实测）

**缺陷在崩溃恢复后的新会话上完全复现，且影响比原文记的更大——它同时让管理者层失明。**

实测（三个窗格经 `tmux list-panes` 确认全部是活的 `claude`）：

```
$ SESSION_TMUX_SESSION=quay-0:outer bash plugin/scripts/session-liveness.sh --once
SESSION-STATUS quay alive=0 halted=0          ← outer 活着，报 alive=0
$ SESSION_TMUX_SESSION=quay-0:inner bash plugin/scripts/session-liveness.sh --once
SESSION-STATUS quay alive=0 halted=0          ← inner 活着，报 alive=0
```

**新增的关键事实：这条缺陷让"检查监视器是否正常"这件事本身产生假绿。**
管理者在同一轮里先跑了 `monitor-mount-check.sh --json`，得到
`mounted=True targetOk=True targetRoot=/home/yale/work/quay pids=[2990310]`，
据此报告"outer 侧监视全部正确"——**这是错的**：`monitor-mount-check` 回答的是
「监视器进程挂没挂、指向哪个仓库」，**不回答「它看得见目标吗」**。
于是挂着的是一个**永久沉默的监视器**，而检查它的工具报绿。

⇒ **两条判据叠加才有意义**：`mounted && targetOk`（进程在、指对仓库）
**必须** 再加 `alive=1`（真的看得见目标）。当前任何只看前两条的消费者都会被骗——
管理者今天就是那个消费者。

**影响范围扩大（原文只记了 outer 看不见 inner）**：
按人 2026-08-06 的要求，**管理者也应当用 session-liveness 观测 outer**
（配置已存在于 `~/.quay-global/manager-session-liveness.env`，含
`SESSION_TARGETS="quay ... quay-0:outer"` + `LOOP_MIN=0`）。
本缺陷使这条路径同样失效——管理者观测 outer 会恒得 `alive=0`，
**管理者层的会话观测在本缺陷修复前无法建立**。这也是为什么管理者今天只能靠
手工 `ps` 查 CPU、`git log` 查提交来判断 outer 死活（今晚为此误判过两次：
一次漏判卡住、一次错判卡住）。

**为什么一直没被修**：本任务自立案起 `status: todo`，而就绪池只收 `ready`
（实测 `ready-pool-check` 的 ready 列表不含本任务）——**它从未进入过派发管线**。

## Contrast / fix pattern (already proven in-repo)

`inner-session-check.sh`'s `has_claude_child()` checks the **pane_pid itself** first (`case "$cmd" in *claude*)`), then descendants → correctly reports `"process":true` for the inner (`inner-session-check --json` = window:true, process:true). `session_pid()` should do the same: check the pane_pid cmdline for claude, then descendants, and return the pid.

## AC

- [ ] `session_pid` detects claude when it IS the pane foreground process (pane_pid self-check) and when it's a descendant (same traversal as `has_claude_child`)
- [ ] outer monitor targets the inner window (`quay-0:inner`), not the whole session's first pane
- [ ] `session-liveness.sh --once` against the live inner reports `alive=1` with the pid
- [ ] **管理者路径同样修复（2026-08-06 追加）**：`SESSION_TMUX_SESSION=quay-0:outer` 跑
      `--once` 报 `alive=1` + pid，使管理者能按人的要求用 session-liveness 观测 outer
      （配置已存在：`~/.quay-global/manager-session-liveness.env`，含 `SESSION_TARGETS` 与 `LOOP_MIN=0`）
- [ ] **消费判据收紧（承重条，2026-08-06 追加）**：`monitor-mount-check` 的 `mounted && targetOk`
      **不足以**判定"监视正常"——必须叠加 `alive=1`。修复后需给出一个能同时回答这三项的调用形态
      （或在 `monitor-mount-check` 的输出里补上 liveness 维度），
      **负控制**：构造"进程挂着但看不见目标"的状态 ⇒ 该调用形态必须报不正常；
      若仍报绿，说明假绿没有被消灭，本条不算达成

## DoD

- [ ] `session-liveness.sh --once` (targeting `quay-0:inner`) reports `alive=1` with pid while the inner claude is live
- [ ] Kill the inner claude → the outer's resident monitor emits SESSION-GONE within 1 round (≤ INTERVAL)
- [ ] Restart the inner → SESSION-BACK emitted; a following idle period is observable (SESSION-IDLE path, not permanent silence)
- [ ] Full suite green (`scripts/test.sh`) with new tests covering the claude-as-pane-process detection

## Evidence notes

- `inner-session-check --json --transcript <inner-tr>`: `{"session":"quay-0","window":true,"process":true,"state":"empty-shell"}` — process detection works when the pane_pid self-check is used.
- **第二个证据维度（2026-08-06 19:4x）假阳性**：outer 起 full-suite-runner 后，monitor 立刻发 `SESSION-BACK quay 的会话已恢复（pid 128773）`——pid 128773 是 suite runner 的 bash wrapper，其 cmdline 含 `/home/yale/.claude/shell-snapshots/...` 路径，`session_pid` 的 `grep -q claude` 匹配到了路径里的 `.claude` 子串。⇒ `session_pid` **既盲**（看不到 claude-as-pane-process → alive=0 恒静默）**又假阳**（任何 cmdline 含 ".claude" 子串的子进程都误报会话恢复）。修法不变：查 pane_pid 自身 + 后代，但匹配必须按进程名（`comm`/argv[0] 是 claude），不能 grep 整个 cmdline。
- This is the same "signal is dead" class as `gap-prefriction-count-trigger-regex-too-broad` (2026-08-06 15:53 filing): a shipped observer that structurally cannot produce its signal.

## Touches

- plugin/scripts/session-liveness.sh
- plugin/scripts/monitor-mount-check.sh
- plugin/scripts/inner-session-check.sh
- plugin/test/session-liveness.test.mjs
- tasks/gap-session-liveness-session-pid-blind-to-claude-as-pane-process.md
