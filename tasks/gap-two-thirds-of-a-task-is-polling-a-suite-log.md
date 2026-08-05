---
id: gap-two-thirds-of-a-task-is-polling-a-suite-log
title: 64% of inner task time is waiting on suite logs — the mechanism that
  removes it is already documented and already implemented, and neither is used
status: ready
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**规格**：`orchestration/SPEC-cut-the-waiting.md`（管理者，2026-08-04，基于 meta-cc 对内层 session
`9957a092` 02:43–04:27 共 104.4 分钟的**实测**，不是推算）。

| | |
|---|---|
| 间隔 >2 分钟的段落合计 | **4020 秒 = 64%** |
| 那些段落前后的命令 | `grep -cE '^(✔\|✖)' full-suite-N.log`、`pgrep -fc 'node --test'`、`sleep 120` ⇒ **全是轮询套件** |
| 剩余 36%（37 分钟） | 约 90 条命令，每条 5–60 秒 ⇒ **真工作** |
| 同期全量套件 | **6 次**，6 × ~500s = **3000 秒** |

**两条砍法，两个机制都已经存在**：

1. **`scripts/test.sh --for-task <id>`**——外层实测**确在 `scripts/test.sh:518`**，
   按 `## Touches` 选测试集。迭代用它，全量只留给 DoD。
2. **后台派发 + `<task-notification>` 唤醒**——外层实测
   `plugin/loop/fast-mode-loop-tick.md:81` **逐字写着**「后台 agent 完成时会自动触发
   `<task-notification>` 重新唤起会话——**那是主要的推进信号**」。

**⇒ 这不是缺机制，是「存在≠生效」的第三次**（前两次：契约检查器没有执行者、
`loop-driver` 注册表没人写）。**轮询不只浪费墙钟——每次轮询是一个 LLM 回合**，
占 token、占延迟，且期间不能干别的。

## Contract

```
measure waiting_pct = `meta-cc 查内层 session 相邻命令间隔，>2 分钟段落秒数 / 总秒数` 输出的占比字段
measure full_suite_runs = `ls /home/yale/work/quay-worktrees/full-suite-*.log | wc -l` 输出的个数字段
measure polling_forms = `grep -cE "sleep [0-9]+; *pgrep|for i in .*grep .*\.log" plugin/loop/fast-mode-loop-tick.md` 输出的计数字段
measure dod_full_runs = `grep -c "连跑 2 次全绿" plugin/loop/fast-mode-loop-tick.md` 输出的计数字段
band polling_forms = 0
band dod_full_runs >= 1
invariant 砍的是中间的迭代跑，不是闸；DoD 的最后两次全量全绿一条都不许少
invoke `bash scripts/test.sh --for-task <id>`
control DoD 的「最后连跑 2 次全量全绿」必须仍然存在且仍被执行——把本任务读成「少跑全量」就是把方向 C 做成方向 A
resume 先改 tick 文档的等待形态，再谈迭代跑法
```

## Chosen mechanism

**tick 文档里的等待形态收敛到一种**：后台派发 + `<task-notification>`。
迭代用 `--for-task`，**全量只用于 DoD 要求的最后两次**。

**不做**：**不放宽 DoD**（见 `control`）；不新写任何调度机制（两个都已存在）；
不把「少跑全量」当成目标——**目标是砍等待，不是砍验证**。

## Acceptance Criteria

- [ ] AC1: **tick 文档的等待形态只有一种**——后台派发 + `<task-notification>`；
      文档与实践里不再出现 `sleep N; pgrep`、`for i in 1..N do grep 日志` 这类轮询（实跑 grep 贴出）
- [ ] AC1b（**2026-08-04 追加：规格漏掉的另一半来源，管理者 meta-cc 实测**）:
      **派发形态必须是 `run_in_background: true`。**
      **实测**：今天全部 **9 次 `Agent` 派发，`run_in_background` 全部是 `false`，零例外**；
      而 `plugin/loop/fast-mode-loop-tick.md:303` 写的派发形态是**后台 `Agent` + `run_in_background`**。
      **并发本身是真的**（遥测区间重叠 5 对、同时在飞峰值 3，如 both-gates 与 blocked-channel
      01:12–01:32 重叠 20 分钟、install-rewrites 与 drift-check 01:44–02:02 重叠 18 分钟），
      **但那个并发是靠一条消息里发多个 `Agent` 调用拿到的**——harness 会并发执行，
      **不是靠后台派发**。
      **差别很实际**：前台派发下**内层阻塞到整批返回**，不能交错、拿不到先完成那个的早期反馈、
      **期间什么也做不了**，而 tick 文档设计的 `<task-notification>` 唤醒流**从来没被触发过**。
      **这是本规格先前漏掉的一半**：只看到了轮询循环，**而前台阻塞那部分连命令都不产生，
      在会话日志里是纯空白**——所以按间隔统计时它被算进了等待，却找不到成因。
      **判据**：meta-cc 查 `Agent` 调用的 `run_in_background` 字段**全为 `true`**。
      **可直接查，不需要新仪器。**
- [ ] AC2: **开发迭代用 `--for-task`**；**全量只用于 DoD 要求的最后两次**
- [ ] AC3（可判收口）: **每任务的全量套件次数从 6 降到 ≤3**（数 `full-suite-*.log` 或遥测记录）
- [ ] AC4（**负控制，必须显式**）: **DoD 的「最后连跑 2 次全量全绿」不许放宽**。
      砍的是中间的迭代跑，**不是闸**。**把 AC2 读成「少跑全量就行」就是把方向 C 做成方向 A，人已明确排除方向 A**
- [ ] AC5（**效果验证，用 meta-cc 不要用墙钟**）: 改后再查一次会话间隔分布，
      **等待占比应从 64% 降到 ~35%**。**不许用套件墙钟验证**——σ=297.6s 会把它吃掉
- [ ] AC6: 测试用 `node:test` 且带恰当的 `// @test-group`

## Definition of Done

- [ ] AC1 与 AC5 的实跑输出都贴进任务体（形态清零一份、间隔分布一份）
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）——**本任务自己也受 AC4 约束**
- [ ] 任务体记录：**这是「存在≠生效」的第三次**，并列出前两次

## Touches
- tasks/gap-two-thirds-of-a-task-is-polling-a-suite-log.md（自身文件：勾 AC + 贴 invoke 证据授权）

- plugin/loop/fast-mode-loop-tick.md
- docs/analysis/fast-mode-batch2-prompt.md

## Dispatch review

reviewer: outer
at: 2026-08-04T05:00:00Z
changed: **管理者交规格，外层核实其可机械检查的断言后原样落为 AC，并补两点。**

**外层逐条查实的**：`--for-task` **确在 `scripts/test.sh:518`**；
`fast-mode-loop-tick.md:81` **逐字**写着 `<task-notification>` 是主要推进信号；
`full-suite-*.log` 现为 **7 个**（规格写作时 6 个，其后又跑了一次，与规格一致而非矛盾）。

**外层补的第一点——基线归因**：那 6 次全量里**至少 1 次是外层造成的**。
外层 03:40Z 要求撤掉一条死重排除项，分支 03:54:42 rebase，run5 在 6 秒后起跑。
**AC3 把基线定为 6，而其中一次不是内层的迭代行为** ⇒
**收口时若只降到 4，不等于机制没生效**。这一点写进任务体，免得用一个含外层噪声的基线判内层的收口。

**外层补的第二点——AC4 是本条最容易被读反的一条，外层把理由再钉一遍**：
`--for-task` 跳资源闸、只跑 `## Touches` 选出的测试集，**它对「这次改动有没有破坏别处」是无知的**。
所以它只能用在迭代中途；**DoD 那两次全量是唯一能回答「有没有破坏别处」的东西**。
**砍它等于把一个吞吐优化变成一个验证降级**，而那正是人已明确排除的方向 A。

**外层对 AC5 的补充**：本条**必须**用 meta-cc 间隔分布验证，理由与
[[gap-node-compile-cache-is-never-enabled-and-every-spawn-reparses]] 完全同源——
σ=297.6s 会吃掉效果，**用墙钟验证一个真实改进，得到的结论必然是「没有改进」**。
**这已经是今晚第三次遇到同一个陷阱**（优化判据、验证判据、现在是收口判据）。

**排期**：只动两份 tick/prompt 文档，**与在飞的 3b、与新立的编译缓存/spawn 判据均不相交**。
**它是吞吐类里唯一不需要先改代码的**——两个机制都已就位，缺的只是用。

## 一条确证：遥测的 `--task-start` 记录是可靠的（管理者，2026-08-04）

遥测里**三个零时长记录**——`one-condition` / `tmux-guess` / `finding-shape`——
**正是 OOM 当时在飞的那三个**，**也正是从 tmpfs 抢救出来的那三个 worktree**。

**两条独立线索互相印证**（遥测侧 vs 抢救现场侧）⇒ **`--task-start` 记录本身是可靠的**。

**外层记明这条的用处**：本班一直在说「遥测不可用」，
**那句话必须被限定在正确的范围内，否则会把一个可靠的部件一起丢掉**：
- **不可靠的是**：崩溃后没有 `--task-end` 的在飞集合（幽灵）、
  以及重启会话补记的 `--task-start`（失真，见
  [[gap-a-crash-leaves-phantom-in-flight-tasks-and-the-one-signal-that-fires-is-documented-backwards]] AC7）；
- **可靠的是**：`--task-start` 记录本身——**它与抢救现场逐条对上**。

**⇒ 对账机制可以信任 `--task-start` 的存在与时刻，去修 `--task-end` 的缺失**，
而不必推倒重来。
