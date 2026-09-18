---
id: META-010
title: 更正 META-008 的处置前提：把 gap-git-history-window-notes-ref-dominates 排上仍不够——它的
  anti-drift 因 touches-parser 的段提取劫持而恒红（实测 9 violations，声明读成 0 条），故它无法落地；已单独立案
status: proposed
handler: meta-driver
---
**只报告，不代裁** —— 该缺陷不在我这条任务的 `## Touches` 内，且受害体（别的任务的任务体）我没有写权限。

## 一、结论：META-008 请求的处置（"让 `gap-git-history-window-notes-ref-dominates` 被排上"）**不足以**解除阻塞

该任务**已经**被派发过（在飞 worktree + 分支 + 5 个提交，含实现 `65e53f76a fix(git-history): exclude refs/notes/*`），
它的 scoped 门绿（`tests 169 / pass 169 / fail 0`），但它**卡在 fan-in 的第一步 anti-drift**：

```
.quay/fan-in-gap-git-history-window-notes-ref-dominates-wk-prod-anchor.log
{"ts":"2026-09-18T12:22:45.599Z","step":"anti-drift","exit":1,"ok":false,
 "reason":"ANTI-DRIFT HARD FAIL: task gap-git-history-window-notes-ref-dominates — 9 violation(s)"}
```

## 二、根因（实测 + 对照；⛔ 不是推断）

`plugin/scripts/touches-parser.ts:210-227` 的 `extractTouchesSection` 取**第一个**标题文本匹配
`/^touches\b/i` 者为段起点，并在其后第一个任意级标题处 break。该任务体里有一个位于真 `## Touches`
**之前**的 `### Touches 最终清单（…）` 子标题 ⇒ 段被下一个 `###` 截断 ⇒ **真 `## Touches` 从未被读到**
⇒ `globs = []`。下游 anti-drift 把 `globs=[]` 与实际改动集求交 ⇒ **每个文件都报
`matches no declared Touches glob`**，而它 **9 个文件全部逐条声明过**（三份副本 md5 相同）。

只读复核（未改任何东西）：

```
$ anti-drift-touches-check.ts --task gap-git-history-window-notes-ref-dominates \
      --worktree /home/yale/work/quay-worktrees/gap-git-history-window-notes-ref-dominates --merge-target develop
ANTI-DRIFT HARD FAIL: … — 9 violation(s)
  out-of-declared: task wrote packages/quay/src/observation.ts (matches no declared Touches glob)   ← 它声明过
```

**对照（能区分）** —— 同一函数、同一文件，只改**一行标题**：

```
as-is             parseTouches(body).globs.length = 0    []
heading renamed   (### Touches 最终清单 → ### 最终清单（Touches）)  = 10
heading deleted   = 10
```

**⇒ 该任务的 worker 无论怎么改 `## Touches` 都过不了这道闸**，而报错文案把它引向"声明写错了"。

## 三、发生率（硬规则 12）与全仓含义

对 `tasks/*.md` 全部 **2281** 个体跑同一函数：`有 touches 标题 ∧ globs === 0` = **3** 条
（在飞阻塞器 1 条 + 已 done 2 条）；体内 >1 个 touches 标题者 = **9** 条。
⇒ 这不是一次性事故，是**任何**写了 `### Touches …` 式小标题的任务体的静默失效。

**链条**：touches-parser 劫持 → 该任务 anti-drift 恒红 → 它无法落地 → git-history 窗口继续被
`refs/notes/quay-cmv-merge` 占满 → **每个 code-delta fan-in 在 `step=suite` 恒红**
（我已实测：本任务 `gap-webui-lang-switcher-control` 连续两轮红在同一条与本任务 delta 无关的断言上；
`judgeRetryExemption` 判 `unrelated-flaky-exempt` ⇒ 按 `worker-driver.ts:5398` **不计重试上限、无限重派**，
每轮烧一个完整会话、成功率 0）。

## 四、我请求的处置（按代价排序，⛔ 均不在我授权面内）

1. **类修（治本，但落地需要闸面先能跑）**：已按纪律单独立案
   `gap-touches-parser-early-subheading-latch-hides-declaration`（todo，plan 形，6 条 AC）。
   它本身也**落不了地**（fan-in 全量 suite 仍红）⇒ 需要与下面第 2 条配合，或由人直投。
2. **单次解扣（把 1 行标题改掉即可，代价最小）**：受害体 `tasks/gap-git-history-window-notes-ref-dominates.md`
   把 `### Touches 最终清单（⛔ 实现前定稿，与 \`## Touches\` 逐条一致，无追加）` 改成**不以 `touches` 开头**的标题
   （如 `### 最终清单（Touches）`）⇒ 该任务下一次 fan-in 的 anti-drift 立刻转 OK ⇒ 它落地 ⇒
   notes 占窗消失 ⇒ 全仓 code-delta fan-in 解锁 ⇒ 第 1 条随之可以正常落地。
   **该写权限属于它自己的 agent 或人**：`manager-tick-log.md:7303` 引 `touches-orthogonality-check.ts:440-444`
   的 self-touch 授权模型（「the executing agent has **no authorization** …」）——故我**没有**改它，只诊断到这一行。
3. **不建议**：把 `refs/notes/quay-cmv-merge` 删/剪（它是 `cross-machine-verify.sh` 的活跃跨机状态载体，
   已推 origin）、或在主检出热补 `touches-parser.ts`（违反 DIR-027 卫生：主检出是生产读面）。

## 五、我这一侧的可核事实

本任务 `gap-webui-lang-switcher-control`：4 个提交（3 文件：`serve-render.ts` / `serve-i18n.ts` / 新增
`serve-lang-switcher.test.mjs`）、AC 7/7 经 `task_check` 确认（`ok:true`）、scoped 门
`bash scripts/test.sh --for-task gap-webui-lang-switcher-control --allow-thin` **EXIT=0（95/95）**、
scoped-gate cache 已写（developSha `42f4c0414`）、`tsc` 面无改动。**本轮我不会落地**——不是因为实现有问题，
而是因为上面那条与本任务无关的断言。
