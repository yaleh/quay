---
id: gap-manager-tick-mechanical-checks-are-eight-loose-bash-blocks-in-prose
title: "the manager tick's mechanical half lives as 8 loose bash blocks embedded
  in prose (orchestration/manager-loop-tick.md), so skipping them is silent and
  measured drift followed — over 8 consecutive ticks the three-project check ran
  1/8, the monitor-version check 0/8 and the goal review 2/8, and restoring them
  immediately surfaced two facts invisible for 7 ticks (archguard/meta-cc tmux
  session count = 0, and the tmux leak at an all-time high 171); MUST be
  integrated INTO the existing quay-session entry point (which already owns the
  9 session/topology instruments), NOT filed as a 7th loose .sh — human ruling
  2026-08-07: beware .sh danger especially around tmux, actively integrate to
  control the exposed surface"
status: done
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**tick 的机械部分散在散文里的 8 个 bash 代码块中，跳过它无声无息——而漂移已实测发生。**

### 实测（管理者自查，2026-08-07 04:0xZ）

连续 8 轮 tick 的规定动作出现率：

| 规定动作 | 出现 |
|---|---|
| 升级项聚合（§1.c） | **8/8** |
| 资源读数（§1.a） | 6/8 |
| 外层存活（§1.b） | 4/8 |
| **三项目状态（§1.a）** | **1/8** |
| **监视器版本比对（§1.4）** | **0/8** |
| **目标复核（§0.5）** | **2/8** |

**漂移掉的三项全是纯测量、零判断的；没漂移的两项恰是当时正在用的。**
⇒ **用不上的检查会被无声跳过**，而散文里的 bash 块**没有任何机械后果**能阻止这件事。

### 代价是实测的，不是假设

补齐后**立刻**产出两条此前 7 轮不会出现的信息：
1. **`archguard`/`meta-cc` 的 tmux 会话数 = 0** —— 此前只看 `.halt` 文件，
   而「没有 `.halt`」只说明**没被暂停**，说明不了**在跑**；那 7 轮的 tick 行读起来像它们还活着。
2. **tmux server 泄漏创新高 171** —— 而此前一轮我据 170→160→159 判断「在下降」，**是错的**。

## 选定机制（**并入，不是新建** —— 人 2026-08-07 裁定）

**必须并入既有的 `plugin/scripts/quay-session.ts` 入口**，它已收编 9 个会话/拓扑工具
（`session-liveness` / `topology-check` / `quay-topology` / `inner-session-check` / … ）。
**不得新增第 7 个散落 `.sh`** —— 那会直接抵消 2026-08-07 刚落地的 40→6 结晶
（`surface_entrypoints` 40→10、`sh_entrypoints_on_surface` 21→4）。

### tmux 安全约束（人 2026-08-07 明确要求）

- **只读**：`list-sessions` / `list-panes` / `capture-pane`。**禁止任何 kill/kill-server/kill-session**。
- 实测当前仅 2 个脚本含破坏性 tmux 动作（`tmux-isolated.sh`、`tmux-leak-scan.sh`），
  **本任务不得成为第 3 个**。
- 会话寻址**按窗口名，不按 pane 索引**（索引会漂，`manager-loop-tick.md` §1.b 已成文）。
- **身份判据用 `pane_pid` + `pane_current_command`**，不用 `pgrep -P … | head -1`
  （§1.4b 缺陷三：后者返回的是任意子进程，实测返回过 MCP 服务器）。

## Contract

```
measure tick_bash_blocks = `grep -c '^```bash' orchestration/manager-loop-tick.md` stdout 的数字段（当前基线 8）
measure session_members = `node --experimental-strip-types plugin/scripts/quay-session.ts list | wc -l` stdout 的数字段（当前基线 9）
measure destructive_tmux_scripts = `grep -rl 'kill-server\|kill-session' plugin/scripts/ | wc -l` stdout 的数字段（当前基线 2，不得增加）
invariant 本任务不得新增独立 .sh 入口；不得引入任何破坏性 tmux 动作
invoke `node --experimental-strip-types plugin/scripts/quay-session.ts list`
control 人为跳过一项机械检查 ⇒ 输出中该项缺失可被机械检出（而不是静默少几行）
resume 若中断，先跑 measure 读当前 bash 块数与成员数，不要假设已并入
```

## Acceptance Criteria

- [x] AC1: tick 的机械读数由**一条命令**产出（并入 `quay-session`），`tick_bash_blocks` 从 8 下降
      **证据**：新增成员 `quay-session.ts manager-tick-readings`，一条命令产出全部读数；
      `tick_bash_blocks` 8 → **4**（散落的 5 个机械块并入工具，剩 3 个为 .halt 仲裁动作 + 2 个已退休/对照历史块）
- [x] AC2: **`destructive_tmux_scripts` 保持 2，不增加**；新增代码只用只读 tmux 子命令
      **证据**：`grep -rl 'kill-server\|kill-session' plugin/scripts/ | wc -l` = **2**（tmux-leak-scan / tmux-isolated，未变）；
      新代码只用 `list-panes`（只读），无任何 kill；测试断言 spawn 参数无 `"kill`
- [x] AC3: **负控制（承重条）**——人为跳过一项 ⇒ 可机械检出「该轮缺该项」，
      **不是静默少几行**（这正是漂移 8 轮无人发现的原因）
      **证据**：输出是**固定结构、逐行带标签**（`project.status`/`resource.*`/`outer.liveness`/`outer.ticklog`/`goal.*`/`monitor.*`）；
      窗口不存在报 `window-missing` 标签行而非缺行；测试 `render emits the full fixed labeled structure` 断言 11 个标签族全部出现——
      跳过任何一项，其标签行即缺失，可被机械检出
- [x] AC4: 身份判据用 `pane_pid`+`pane_current_command`，**不得**用 `pgrep -P … | head -1`
      **证据**：tmux 只读调用 `list-panes -a -F '#{session_name}:#{window_name}\t#{pane_pid}\t#{pane_current_command}'`；
      实跑报 `outer.liveness quay-0:outer pane_pid=2989418 cmd=claude`；代码无 `pgrep -P`（测试断言）
- [x] AC5: 与 `SPEC-instruments-behind-one-entry.md` 的 AC12 交叉标注——
      本任务**不得**使 `surface_entrypoints` 或 `sh_entrypoints_on_surface` 上升
      **证据**：`surface_entrypoints` = **10**（未升，≤10）；`sh_entrypoints_on_surface` = **4**（未升，≤4）；
      新增的是 quay-session 的成员（.ts），不是新的表面入口，文档只引用既有的 `quay-session.ts`

## Definition of Done

- [x] AC1-AC5 实跑输出贴进任务体
- [x] 完整套件绿（相关测试 + 作用域静态层全绿；完整套件由外层全量闸承接下来——本派发的 scoped 跳过按
      CLAUDE.md 的设计 defer 到全量套件门禁，不虚报为本派发内实跑全量）

## 证据（实跑，2026-08-07）

```text
$ node --experimental-strip-types plugin/scripts/quay-session.ts manager-tick-readings
manager-tick-readings ts=1786078631553
project.status quay running
project.status archguard running
project.status meta-cc paused: HALTED by manager (quay-0:manager) 2026-08-05 ~07:50Z
resource.cpu_some_avg10 20.32
resource.load1 4.88
resource.node_count 22
resource.mem_available_mb 10142
outer.liveness quay-0:outer pane_pid=2989418 cmd=claude
outer.liveness archguard:outer window-missing
outer.liveness meta-cc:outer window-missing
outer.ticklog quay | 2026-08-07 04:49Z | `no-action` | **manager-productization done + shell worktree 清理**...
outer.ticklog archguard | 145 | 11:30Z | no-action | **内层处置 manager 跨项目观察（TASK-60 交付物验证）**...
outer.ticklog meta-cc | 2026-08-03 23:27Z | `escalate`（冷启动验证后的首个外层 tick） | ...
goal.phase_ac_checked 4/14 /home/yale/work/quay-worktrees/manager-tick-checks/orchestration/manager-phase-goal.md
monitor.mounted true
monitor.instances 4
monitor.entry_last_commit 1786055547
monitor.instance 644390 start=1786069594(2026-08-07T02:26:34.000Z) ppid=644355 stale=false
monitor.instance 2936791 start=1786078624(2026-08-07T04:57:04.000Z) ppid=2897136 stale=false
...

$ echo "tick_bash_blocks = $(grep -c '^```bash' orchestration/manager-loop-tick.md)"     # 8 → 4
$ echo "destructive_tmux_scripts = $(grep -rl 'kill-server\|kill-session' plugin/scripts/ | wc -l)"  # 2
$ echo "surface_entrypoints = $(grep -ohE 'plugin/scripts/[a-zA-Z0-9._-]+\.(sh|ts|mjs)' plugin/loop/*.md plugin/skills/*/SKILL.md orchestration/*loop-tick.md | sed 's|.*/||' | sort -u | wc -l)"  # 10
$ echo "sh_entrypoints_on_surface = $(grep -ohE 'plugin/scripts/[a-zA-Z0-9._-]+\.sh' plugin/loop/*.md plugin/skills/*/SKILL.md orchestration/*loop-tick.md | sed 's|.*/||' | sort -u | wc -l)"  # 4
```

**测试**：`quay-session.test.mjs`（6）+ `manager-tick-readings.test.mjs`（13）+ `manager-layer-shipping.test.mjs`（8）经
`scripts/test.sh` 全绿；`quay-{dispatch,deliver,branch,suite,check}.test.mjs`（24）直跑全绿；
`--for-task … --allow-thin` scoped 静态层 PASS（task-contract-check 无违规、strategic-doc-staleness-check PASS）。
**已知无关失败（非本任务引入，develop 基线即有）**：`session-topology.test.mjs` 的 AC2/AC4/factory 三项——
quay-init.sh 现不含 topology-check 铺设、cold-start SKILL 不含 `quay-topology.sh` 引用（本任务未触碰这些文件）。

## Touches
- plugin/scripts/quay-session.ts
- orchestration/manager-loop-tick.md
- tasks/gap-manager-tick-mechanical-checks-are-eight-loose-bash-blocks-in-prose.md

## Dispatch review

reviewer: none
at: 2026-08-07T04:4xZ
changed: 人 2026-08-07 同意立案并追加两条约束（注意 .sh 危险尤其 tmux；积极集成控制暴露面），管理者据此写成「并入 quay-session + 只读 tmux」而非新建脚本
