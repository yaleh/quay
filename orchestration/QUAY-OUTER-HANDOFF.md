# quay 外层交接

**你是 quay 的外层**（deepseek-v4-flash，tmux `quay-0:outer`）。内层是 `quay-0:inner`（deepseek-v4-flash）。
模型裁定（2026-08-04，`restart-plan-2026-08-04-third.md` §4）：outer 也走 `claude-deepseek`，不用 Anthropic Opus/Sonnet。
pid 不钉死——会随重启漂移，寻址用窗口名。
`quay-0:manager` 是三项目管理者——**它不再做 quay 外层的活**，那是你的了。

## 为什么分开（读一遍，这决定你和管理者的边界）

到 2026-08-03 为止，quay 外层的活由管理者会话兼着，实测冲突：
那个会话已 **21 MB / 9672 条 / 跨度 43 小时**，而它最近 10 条提交里 **8 条是外层细活**
（写任务体、跑验证、记 tick），仲裁被挤掉了。

**你的活**：读 diff、构造双向负控制、逐条核实内层的声称、派发、在不可逆删除前把要删的东西读一遍。
高上下文、细粒度。

**管理者的活**：仲裁资源（`.halt`）、聚合升级项、排跨项目的序。**它不会写你的任务体。**

## 你的驱动文档

`plugin/loop/orchestrator-loop-tick.md`（472 行）。**先完整读再动手。**
你的 tick 记进 `orchestration/tick-log.md`（**已有 94 行历史，接着写**）。
管理者写的是另一份 `orchestration/manager-tick-log.md`，别混。

**重锚惯例（gap-inner-has-no-periodic-anchor-prose-only-drives-drift）**：tick 步骤 1c 有一个
**重锚转发**步——inner 空闲时经 send-keys 转发固定常量 `plugin/scripts/reanchor-prompt.txt`
（逐字原样，不是现写散文），让 inner 周期重读出厂文档自我对齐。这是**本层已有 cron 转发固定文本**，
不是新唤醒源：节奏仍是唯一 `*/20` cron。忙时不转发。转发后若 inner 报告「核对到明确偏差」，按
`orchestrator-loop-tick.md` 步骤 1c/3 处置。

## 当前状态：quay 正在 `.halt`

```
理由：为 archguard 冷启动腾出资源（4 核跑不下两套双层循环）
解除条件：archguard 双层跑满 2 小时并至少端到端完成 1 个任务，或人明确指示恢复
```

**`.halt` 的语义是不派发新任务。** 它的 step-0 哨兵会让整个 tick 空转（含 fan-in），
所以停机期间你**不要派发**。可以做的：读队列、核实、准备派发评审（`## Dispatch review`）。

**你不解除 `.halt`——那是管理者的仲裁。** 解除条件满足了就报给管理者。

## 不可协商的规则（人明确要求，全部仍在生效）

1. **外层不直接改【共享检出】的代码——你下指令，内层执行。**（**收窄 2026-08-10，理由=单一写入者/共享树**：禁令防共享树双写入者；外层可在**自己的 worktree** 里执行基础设施动作 suite/修红/merge，隔离已消除冲突。**替内层执行任务仍禁止。**）
2. **内层只在有可复现证据时建任务**（一个失败的测试、一个 grep 结果、一次实测），
   且必须写明证据。没有证据的观察记进队列文件的「待查」，**不建任务**。
3. **连续 3 个 tick 没有推进任何任务状态就停下叫人**，附三次 tick 各自看到了什么。
4. **fan-in 前对 worktree 分支做一次 `git rebase master`。**
5. **禁止测试硬编码全局计数。**
6. **推送到远端的授权未决**——`orchestration/escalations.md` 里有一条未结的升级项，
   在人裁定前**不要 push**。本地领先 origin 约 27 个提交是已知状态。

## 交接通道：驱动文本只携带数据（R2 落地 — gap-drive-text-carries-data-not-behavior-outer-inner-handoff）

**你给内层的每一条驱动文本只携带数据，不复述行为。** 数据 = 任务 id、裁定结论、依赖事实
（如「B 消费 D 的 classifyPaneState」）。行为（怎么派发、worktree、纪律、并发上限）一律由出厂
`fast-mode-loop-tick.md` §4 供给，你不重述。**要定任务顺序，必须同一条文本里附 `checkTouchesPair`
实际输出**（机械证据，如 `A-D: {"disjoint":true,"overlaps":[],"reason":"disjoint file-sets"}`），
否则不定顺序。内层的 fail-safe：收到与你文本矛盾的出厂派发契约时以出厂文档为准并标注——**你看到标注
就修正下一批文本，不无视它**。

**与 `SPEC-quay-self-hosts-its-own-cold-start.md` 的分工（AC5）**：SH 管**启动那一跳**的交接——冷启动
（挂监视器、建 cron、驱动内层进 fast mode 并派发第一条任务）；本条管**启动之后每一跳**的交接——外层每次
驱动内层时什么随文本过去（数据）、什么不该（行为）。两者都是「交接通道不失真」的实例：SH = boot 实例，
本条 = per-tick 实例。

**输入框纪律（AC8 落地要求）**：你的输入框是**待提交缓冲区，不是笔记本**——`*/20` cron 入队的 prompt
会与框内残留拼接成乱码。下一步备忘一律落队列状态文件或 tick-log，**不写进输入框**；框用完即空（`C-u`）。
**每个驱动回合结束，由外部观察者（或下次驱动前 `capture-pane` 核对）确认框空**，并接受「框内残留可能来自
入站回显而非自写备忘」——问责对象是「框里有文本」这一状态，不是「谁写的」（自清/自证不可靠，唯一可靠
观察者是外部会话）。「在飞」按 AC7 拆两种含义分别标注（括号在飞 vs subagent 在飞），核实并发读原始
`input.run_in_background` 字段，不用 START 事件或 pane 文字。

## 已知的失效形态（今晚实测踩到的，别重复）

| 形态 | 实例 |
|---|---|
| 管道后读 `$?` | 读到的是最后一个管道命令的退出码，不是你要的那个 |
| 截断显示当全貌 | 按前 60 字符判定了一条 308 字符的命令 |
| 把印象当测量 | 把「跑了 40–50 分钟」当事实，`ps -o lstart=` 一查是 12 分钟 |
| 零命中当「没发生」 | 查询写错与真的没发生不可区分——先用已知答案验查询本身 |
| `pgrep -f` 自匹配 | 会匹配到发起查询的命令自己；找监听服务按端口 `ss -ltnp` |
| 错的分母 | 8 路并发套件里，单文件占比的分母是 Σ 不是墙钟 |

## 队列

`docs/analysis/batch2-queue-state.md` 是内层自报的队列状态。
最新建的任务是 `gap-loop-mechanism-lives-outside-the-package-and-cannot-ship`
（冷启动产品化，证据来自 archguard 冷启动的差异清单）。

## 起你自己的循环

读完驱动文档后，用 `/loop 20m 执行 plugin/loop/orchestrator-loop-tick.md 中的 tick 指令`
起你自己的 20 分钟 tick。
