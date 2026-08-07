---
id: gap-session-liveness-session-pid-blind-to-claude-as-pane-process
title: session-liveness session_pid is blind to claude-as-pane-process — outer
  monitor cannot see inner in the 3-window topology
status: done
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

- [x] `session_pid` detects claude when it IS the pane foreground process (pane_pid self-check) and when it's a descendant (same traversal as `has_claude_child`)
- [x] outer monitor targets the inner window (`quay-0:inner`), not the whole session's first pane
- [x] `session-liveness.sh --once` against the live inner reports `alive=1` with the pid
- [x] **管理者路径同样修复（2026-08-06 追加）**：`SESSION_TMUX_SESSION=quay-0:outer` 跑
      `--once` 报 `alive=1` + pid，使管理者能按人的要求用 session-liveness 观测 outer
      （配置已存在：`~/.quay-global/manager-session-liveness.env`，含 `SESSION_TARGETS` 与 `LOOP_MIN=0`）
- [x] **消费判据收紧（承重条，2026-08-06 追加，2026-08-07 达成）**：`monitor-mount-check` 的
      `mounted && targetOk` **不足以**判定"监视正常"——必须叠加 `alive=1`。修复后需给出一个能同时
      回答这三项的调用形态（或在 `monitor-mount-check` 的输出里补上 liveness 维度），
      **负控制**：构造"进程挂着但看不见目标"的状态 ⇒ 该调用形态必须报不正常；
      若仍报绿，说明假绿没有被消灭，本条不算达成。
      **证据**（plugin/scripts/monitor-mount-check.sh + plugin/test/monitor-mount-check.test.mjs）：
      `monitor-mount-check --json` 新增 `liveness` 与合并判据 `ok = mounted && targetOk &&
      liveness===true`（liveness 取不到 ⇒ null，fail-closed）。liveness 探针 = 对每个挂载进程，
      用它的 /proc/<pid>/environ 重建观测环境（SESSION_*/TMUX_*/QUAY_* 白名单 + PATH/HOME），跑一次
      `session-liveness.sh --once`（同一脚本同一观测机制，单源），解析 SESSION-STATUS：全部 alive=1
      ⇒ true；任一 alive=0 ⇒ false。**负控制实测**（AC5 NEGATIVE test）：hermetic 挂载一个 stub
      monitor，目标 pane 是无 claude 的纯 bash ⇒ `mounted=true targetOk=true liveness=false ok=false`——
      正是 2026-08-06 骗到管理者的那组数字（mounted+targetOk 全绿而监视器恒 alive=0），现在
      `ok=false` 显红；若仍报绿本条即不达成。正控制：目标 pane 有 claude ⇒ `liveness=true ok=true`。
      13/13 monitor-mount-check 测试绿（含新增正/负控制）。

## DoD

- [x] `session-liveness.sh --once` (targeting `quay-0:inner`) reports `alive=1` with pid while the inner claude is live
      **证据**（2026-08-07 实测，读-只）：`SESSION_TMUX_SESSION=quay-0:inner bash
      plugin/scripts/session-liveness.sh --once` → `SESSION-STATUS quay alive=1 pid=2989409 halted=0`
      （pid 与 `tmux list-panes -t quay-0:inner -F '#{pane_pid}\t#{pane_current_command}'` 的
      `2989409 claude` 一致——claude-as-pane-process 被识别）
- [x] Kill the inner claude → the outer's resident monitor emits SESSION-GONE within 1 round (≤ INTERVAL)
      **证据（hermetic DoD proxy，不扰动活 inner）**：挂载常驻监视器（INTERVAL=1）于 hermetic pane，
      其前台进程是 `exec -a claude-probe sleep 10000`（claude-as-pane-process 形态），`kill -9` 该
      进程后 ≤1 轮内打 `SESSION-GONE e2eproj 的会话进程消失（目标 dodprobe:outer）——立即报`。
      外加测试 `SESSION-GONE then SESSION-BACK`（child 形态）绿
- [x] Restart the inner → SESSION-BACK emitted; a following idle period is observable (SESSION-IDLE path, not permanent silence)
      **证据**：SESSION-BACK 由测试 `SESSION-GONE then SESSION-BACK fire when the probe's claude
      process vanishes and returns` 绿（kill 后 GONE、重启后 BACK，同一 hermetic pane）；SESSION-IDLE
      路径由既有 fused-idle 机制承担（Test A 的真实探针会话在当前机器缺席被 skip；idle 去抖与
      transcript 融合的 hermetic 覆盖仍在，见测试列表）
- [x] Full suite green (`scripts/test.sh`) with new tests covering the claude-as-pane-process detection
      **证据（scoped 层，完整套件由外层全量闸承接下来——本派发的 scoped 跳过按 CLAUDE.md 设计
      defer 到全量套件门禁，不虚报为本派发内实跑全量）**：
      `session-liveness.test.mjs` 全文件绿（新增 B2/B3/B4 + 既有 B/C/D/E/F/G 全绿；Test A 真实探针
      缺席 skip）+ `monitor-mount-check.test.mjs` 13/13 绿（新增 AC5 正/负控制）+ scoped 静态层绿。

## Evidence notes

- `inner-session-check --json --transcript <inner-tr>`: `{"session":"quay-0","window":true,"process":true,"state":"empty-shell"}` — process detection works when the pane_pid self-check is used.
- **第二个证据维度（2026-08-06 19:4x）假阳性**：outer 起 full-suite-runner 后，monitor 立刻发 `SESSION-BACK quay 的会话已恢复（pid 128773）`——pid 128773 是 suite runner 的 bash wrapper，其 cmdline 含 `/home/yale/.claude/shell-snapshots/...` 路径，`session_pid` 的 `grep -q claude` 匹配到了路径里的 `.claude` 子串。⇒ `session_pid` **既盲**（看不到 claude-as-pane-process → alive=0 恒静默）**又假阳**（任何 cmdline 含 ".claude" 子串的子进程都误报会话恢复）。修法不变：查 pane_pid 自身 + 后代，但匹配必须按进程名（`comm`/argv[0] 是 claude），不能 grep 整个 cmdline。
- This is the same "signal is dead" class as `gap-prefriction-count-trigger-regex-too-broad` (2026-08-06 15:53 filing): a shipped observer that structurally cannot produce its signal.

## Fix invocation evidence (execution agent, 2026-08-06)

**Fix** (worktree branch `task/gap-session-liveness-session-pid-blind-to-claude-as-pane-process`):

1. `session_pid()` now checks the pane_pid ITSELF first (claude-as-pane-process), then descendants — same traversal as `has_claude_child` / `inner_claude_pid`. Matching is by process NAME (`/proc/<pid>/comm` starting with `claude`, or argv[0] basename containing `claude`), NOT a whole-cmdline `grep claude` — that grep matched the `.claude` path substring in a non-claude child's cmdline (the 19:4x false-positive).
2. Per-role target resolution: a window-suffixed `SESSION_TMUX_SESSION` (`quay-0:inner` / `quay-0:outer`) is now used as the target directly (was being stripped to `<base>:outer`). A numeric pane suffix (quay-init's `:0.0`) still strips to `<base>:outer`. Also fixed a latent precedence bug: the env var is now captured BEFORE the env file is sourced (the file's `SESSION_TMUX_SESSION=quay-0` was silently overwriting `quay-0:inner`).
3. Regression tests B2/B3/B4 in `plugin/test/session-liveness.test.mjs`.

**Live verify (inner claude pid 2989409, outer pid 2989418 — pane cmdline IS claude):**
```
$ SESSION_TMUX_SESSION=quay-0:inner bash plugin/scripts/session-liveness.sh --once
SESSION-STATUS quay alive=1 pid=2989409 halted=0     ← was alive=0 before the fix
$ SESSION_TMUX_SESSION=quay-0:outer bash plugin/scripts/session-liveness.sh --once
SESSION-STATUS quay alive=1 pid=2989418 halted=0     ← was alive=0 before the fix
```

**Scoped tests** (`node --test plugin/test/session-liveness.test.mjs` — full file):
```
tests 53   pass 52   fail 0   skipped 1
```
(skip = Test A's real `quay-0:probe` session, absent here; new tests B2/B3/B4 plus existing B/C/D/E/F/G all green.)
New regression tests (each also passes when run alone):
```
✔ B2 — session_pid detects claude when it IS the pane foreground process (pane_pid self-check), not only as a child
✔ B3 — a child whose cmdline contains a .claude path substring but whose process name is NOT claude is NOT falsely reported (alive=0)
✔ B4 — window-suffixed SESSION_TMUX_SESSION targets the named window (quay-0:inner); bare session and numeric pane suffix resolve to :outer
```

**DoD proxy — SESSION-GONE from claude-as-pane-process death (hermetic, live inner untouched):** mount the resident monitor on a hermetic pane whose foreground process is `exec -a claude-probe sleep 10000` (the pane-self shape), then `kill` that process →
```
SESSION-GONE e2eproj 的会话进程消失（目标 e2e）——立即报
```
(within ≤1 INTERVAL=1 round). This is the mechanism proof for the DoD's "kill the inner → SESSION-GONE" bullet without disturbing the live inner.

**AC5 not implemented in this pass (deferred):** the `monitor-mount-check` `mounted && targetOk` → `+ alive=1` consumption-criterion change and its negative control require touching `monitor-mount-check.sh` (out of the script-side detection fix staged here). The script-side detection + target-resolution fix (this task's core, AC1-AC4) is complete.

## Fix re-application + AC5 (execution agent, 2026-08-07)

**Context:** the 2026-08-06 fix (commit a09ddb56) landed as part of the 40→6 integration merge that was
**reverted** (7642849a, red-window protocol — 35 real failures from the merge, catalog confirmed in
isolation). The current codebase therefore had the OLD blind `session_pid` again; this pass re-applied
the fix on a fresh worktree (branch `task/session-liveness-session-pid-blind-to-claude-as-pane-process`,
based on develop HEAD) and additionally implemented AC5 (deferred last pass).

**Re-application deltas vs a09ddb56 (per manager-tick precedent, gap-manager-tick-mechanical-checks-are-
eight-loose-bash-blocks-in-prose AC4):** the self-check now uses tmux's own read-only identity
`pane_pid` + `pane_current_command` (NOT `pgrep -P … | head -1` — the arbitrary-child grab that returned
MCP servers); the descendant traversal uses the kernel's `/proc/<pid>/task/<pid>/children` (one read,
zero subprocesses) + `_is_claude_pid` (comm / argv[0] basename — the supervisor-observe
process-comm-field-match criterion). Result: no `pgrep -P` anywhere in session-liveness.sh, tmux is
read-only (list-panes/capture-pane only), and the `.claude`-path substring false-positive is gone.

**AC5 (consumption-criterion tightening, 承重条):** `monitor-mount-check.sh` now emits `liveness` and
the combined `ok = mounted && targetOk && liveness===true`. The liveness probe runs the mounted
monitor's OWN observation (`session-liveness.sh --once` with the env reconstructed from
`/proc/<pid>/environ`) — single source, no logic duplication. **Negative control** (hermetic): a mounted
monitor whose target pane has no claude ⇒ `mounted=true targetOk=true liveness=false ok=false` — the
exact 2026-08-06 false-green (mounted+targetOk all green while the monitor is permanently silent) now
reports RED. **Positive control:** target pane has claude ⇒ `liveness=true ok=true`. 13/13
monitor-mount-check tests green.

**Scoped verify (2026-08-07):**
```
$ node --test plugin/test/session-liveness.test.mjs        # full file
tests 60   pass 59   fail 0   skipped 1      (skip = Test A real quay-0:probe, absent here)
$ node --test plugin/test/monitor-mount-check.test.mjs     # full file
tests 13   pass 13   fail 0   skipped 0
```
B2/B3/B4 (claude-as-pane-process / .claude-path false-positive / window-suffixed target resolution) all
green, plus every existing session-liveness test (B/C/D/E/F/G, multi-source heartbeat, idle noise-gate,
quay-init laydown). Full suite deferred to the outer full-suite gate (scoped skip per CLAUDE.md — never
overclaimed).

**Live verify (read-only `--once`, real 3-window topology — the defect's exact reproduction):**
```
$ SESSION_TMUX_SESSION=quay-0:inner bash plugin/scripts/session-liveness.sh --once
SESSION-STATUS quay alive=1 pid=2989409 halted=0     ← was alive=0 before the fix
$ SESSION_TMUX_SESSION=quay-0:outer bash plugin/scripts/session-liveness.sh --once
SESSION-STATUS quay alive=1 pid=2989418 halted=0     ← was alive=0 before the fix
```
(`tmux list-panes -t quay-0:inner/outer -F '#{pane_pid}\t#{pane_current_command}'` = `2989409 claude`
/ `2989418 claude` — pane_pid IS claude, the 3-window claude-as-pane-process shape.)

**DoD proxy re-confirmed (hermetic, live inner untouched):** resident monitor (INTERVAL=1) on a
hermetic claude-as-pane-process pane, `kill -9` the pane foreground claude → `SESSION-GONE … 立即报`
within ≤1 round; restart → SESSION-BACK (test B). Mechanism proof for DoD's GONE/BACK bullets.

## Touches

- plugin/scripts/session-liveness.sh
- plugin/scripts/monitor-mount-check.sh
- plugin/scripts/inner-session-check.sh
- plugin/test/session-liveness.test.mjs
- tasks/gap-session-liveness-session-pid-blind-to-claude-as-pane-process.md
