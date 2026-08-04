---
id: gap-adr-016-alternatives-rejected-one-shot-claim-is-factually-wrong
title: ADR-016's Alternatives-rejected section calls claude -p "one-shot" — a
  factually wrong reason on an accidentally-right conclusion, which the next
  person will overturn with the same wrong reasoning
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

管理者交办（依据 `orchestration/RESEARCH-claude-p-streaming-2026-08-04.md`，人指定方向的调研）。

ADR-016「Alternatives rejected」段原文：

> **`claude -p` (headless/print mode):** one-shot — runs a prompt, returns, exits.
> Does not fit a *perpetual* loop with background agents + scheduled wakeups.

- **「one-shot」这个事实判断是错的** —— `--input-format stream-json` 的流式输入**不是** one-shot
  （`headless.md` / `cli-reference.md` 记载每行一条 user message，流式）。会话在 **stdin 保持打开
  期间存活**（`headless.md`）。
- **但结论碰巧是对的**：`-p` 不适合永久循环——真实原因是三条硬约束：
  1. **`Monitor` 工具完全不可用**（`tools-reference.md`）；
  2. **`CronCreate` 等是会话作用域**，会话退出即消失（`scheduled-tasks.md`）；
  3. **后台进程在 final result 返回且 stdin 关闭后 ~5 秒被杀**（`headless.md`，v2.1.163 起）。

**为什么必须改**：理由错了的正确结论，会被下一个人用同样的错误理由推翻——要么误以为「流式输入
存在 = 可以迁移」，要么拿错误的 one-shot 论断继续拒绝一个其实可行的形态。**改理由，不改结论。**

**替代形态已存在（调研 §2）**：一个长驻**驱动进程**握着 stdin 就是持久会话——它本身就是调度器
（按时往 stdin 写，不需要 `CronCreate`）和观测者（自己看存活/事件，不需要 `Monitor`）。调度与观测
从「会话记得自己建过 cron」这种会话内状态，搬进可交付、可检查、可测试的脚本。

**时机**：A（`gap-adr-016-carve-out-...`）刚落地 ADR-016 第一次 Amendment（`d36bbaaf`，commit `d3104bbc`
合并），**没有触及 Alternatives 段**——现在改成本最低。

## Acceptance Criteria

- [x] AC1: ADR-016 追加 `## Amendment 2026-08-04 (second)`，落在「Alternatives rejected」段或其
      紧邻处：`claude -p` 条目的理由改为**三条真实硬约束**（Monitor 不可用 / cron 会话作用域 /
      后台进程 final result + stdin 关闭后被杀），**结论句原样保留**（「Does not fit a *perpetual*
      loop…」）
- [x] AC2: Amendment 同时写明**替代形态存在**——长驻驱动进程握 stdin = 持久会话，自任调度与观测；
      引用 `orchestration/RESEARCH-claude-p-streaming-2026-08-04.md` §2/§6 为出处
- [x] AC3: **可核验性**——Amendment 后，原文的「one-shot」作为**理由**不再出现（除非在引用原文的
      引号内，且紧接「此理由已被 2026-08-04 Amendment 推翻」的标注）；结论句保持逐字
- [x] AC4: 不引入新违例——`adr016-screen-use-check.ts` 实跑仍 PASS（本任务只动文本，不引入
      `capture-pane`+`md5` 同现）
- [x] AC5: 一致性——若仓库内其它文档（CLAUDE.md / tick 文档）有 `claude -p` = one-shot 的同型
      描述，同步该句（grep 全仓核对；无则记「无其它实例」）

## Definition of Done

- [x] AC1–AC5 全部勾上；AC3 的 grep 输出贴任务体（one-shot 作为理由已消除）
- [x] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

### invoke 实跑证据（task-contract-check 消费者：done 任务必须展示 invoke 入口路径）

`node --experimental-strip-types plugin/scripts/adr016-screen-use-check.ts` → **PASS**：scanned 98 shell scripts，active whole-screen-hash violations 1（`session-liveness.sh:636`，已在带内 0..1），retired 2（send-keys-verified 旧哈希）。本任务只动文本、不引入 `capture-pane`+`md5` 同现，checker 实跑通过（AC4）。
批量 fan-in 全量：tests 2298 / fail 0 / cancelled 0 / skipped 27。

## Touches

- adr/ADR-016-cross-workspace-autonomous-operation-via-tmux-remote-drive.md
- CLAUDE.md（AC5 若发现同型描述）
- orchestration/RESEARCH-claude-p-streaming-2026-08-04.md（引用出处，不改）

## Contract

measure   amendments_count = `grep -c '^## Amendment 2026-08-04' adr/ADR-016-cross-workspace-autonomous-operation-via-tmux-remote-drive.md` stdout 的数字字段
band      amendments_count = 2（第一次 carve-out + 本次 Alternatives 理由修正）
invariant conclusion_kept = 1（"Does not fit a *perpetual* loop" 结论句逐字保留）
invoke    `node --experimental-strip-types plugin/scripts/adr016-screen-use-check.ts`
control   adr016 checker 实跑必须仍 PASS（AC4：本任务不得引入新违例）
resume    Amendment 与一致性同步分两次提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-04T15:5xZ
changed: 外层受管理者交办立案。三处收紧：
(1) **改理由不改结论是硬约束**——AC3 钉住「结论句逐字保留」，防止有人顺手把结论也改了（结论是对的，
只是理由错）；
(2) **AC2 把替代形态写进去**——否则修完理由，下一个人还会问「那 -p 到底能不能用于循环」；
(3) **AC4 与 A 的检查器挂钩**——本任务在 A 刚合并的同一文件上操作，不能把 A 的 checker 弄红。
status: todo——排在内层当前批 fan-in 之后。
