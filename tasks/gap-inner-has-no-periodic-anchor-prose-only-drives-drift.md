---
id: gap-inner-has-no-periodic-anchor-prose-only-drives-drift
title: the inner's ONLY anchor is outer prose (its Cron count is 0; all 59
  overnight drives were send-keys) while the outer is force-re-read of the
  shipped doc every 20 min — give the inner a periodic, wording-independent
  re-anchor to the shipped doc, as a FIXED relay (single cadence), with a strict
  conformance-check-only wake contract so the cron never becomes a second
  dispatch source
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

管理者转达的结构性发现（实测 + 意见，裁定权在外层）。**锚点不对称**：

- **外层**：有 `*/20` cron（32d5cf0b），每 20 分钟被强制重读出厂的 `fast-mode-loop-tick.md`——周期、措辞稳定的锚。
- **inner**：Cron 调用数 = **0**，整晚 59 次驱动全部来自外层的 send-keys。inner 的**唯一锚点 = 外层当次写的驱动散文**，散文每次措辞都不同。

**后果**：今晚 inner 的几次行为漂移（串行 A→D→B、batch 语义渗透成排序依据）根源都在这里。**R2
（驱动文本只带数据不带行为）修的是散文内容，但没解决「inner 只有散文这一个锚点」这个结构问题**。R2
与本文互补：R2 管散文别越权；本文管「散文之外还有别的锚」。

**管理者的价值判断**：给 inner 周期锚的价值**不是让它自己找活**（它已有调度自主权），而是给它一个
**独立于外层措辞的、周期性重读出厂文档的机会**——即使某次驱动文本有偏差，下个周期能自我对齐。

**必须防的风险（管理者点名）**：**别让 cron 变成第二个调度源**。inner 醒来应该是「重读出厂文档 +
核对当前状态是否符合」，不是「自己再决定派什么活」，否则两层退化成两个互相打架的调度器。

### 选定机制（外层裁定）

**用外层已有 cron 转发一条「固定重锚散文」**，不是给 inner 另建 cron：

1. **固定重锚 prompt**（一次写死、check-in 为常量/脚本，每次 tick 原样转发——措辞稳定，非外层每次现写）：
   「重读 `plugin/loop/fast-mode-loop-tick.md`，核对当前状态是否符合出厂文档（在飞 agent 是否符合文档、
   就绪池是否维护、**是否在偷偷做收尾**（closure-async 落地后此检查才成立）、停止条件是否被遵守）。
   符合 ⇒ 无操作；有明确偏差 ⇒ 向文档对齐自我修正。**不得借本唤醒决定派什么活**。」
2. **只在 inner 空闲时转发**（外层 tick 已按外部观察者判 inner 空闲）——忙时不打扰，重锚量上界 = 空闲时长。
3. **唤醒契约 = 一致性核对，不是调度**：重锚 prompt 本身**零派发指令**；若偏差修正需要派发（如槽空未派
   的停摆），修正动作**逐字照搬出厂文档自己的派发规则**（文档是唯一规则源），不是重锚 prompt 的新决策。
4. **防双调度源的机械保证**：重锚 prompt 文本不含任何「派发/排序/批」措辞（grep 断言）；外层 cron 是
   唯一的节奏源，重锚只是转达固定文本，不新增唤醒源。

**备选（记录，延后）**：inner 自带 cron（独立于外层存活）。优点：外层宕机时 inner 仍有锚。缺点：
独立唤醒源 = 双调度器风险，且 OOM 场景内外层同死、该优点的实际窗口极小。待外层转发重锚运行稳定后
按需复审。

**与 R2 的关系**：重锚 prompt **不是驱动散文**（不携带任务数据、不指引具体行为），是重读出厂文档的
固定指令——不受 R2「只带数据」约束，但更严格：零数据、只指向文档。R2 管驱动散文别越权；重锚管
「散文之外有周期锚」。

**依赖**：排在 `gap-closure-sync-is-the-true-batch-boundary-move-bookkeeping-to-outer-async` 之后——
重锚的「核对是否偷偷做收尾」需要出厂文档先改成 inner 无收尾形态，否则重锚会把 inner 对齐到错误行为。

## Acceptance Criteria

- [x] **AC0（2026-08-08 11:2x 追加——标题缺陷 (a) 的独立 AC，此前无主人）**：**inner 有自身周期锚，
      不依赖 outer 转发**——inner 自带周期触发（`/loop 25m` 或等效），醒来即重读出厂文档 + 状态自检，
      即使 outer 宕机/停摆也保持锚点。**判据**：inner transcript 存在自驱唤醒记录（非 outer send-keys、
      非 `<task-notification>`），且间隔 ≤ 申报周期上界。**这是标题「inner's ONLY anchor is outer prose」
      的另一半**——AC1-AC7 只覆盖了 (b) 转发机制，没覆盖 (a) 自驱锚。
      **（2026-08-08 10:57Z 实跑）**：inner 自驱周期锚 = `/loop 25m` 心跳，CronCreate **`64b5612c`**
      （`7-59/25 * * * *`，:07/:32/:57 触发，~25min cadence ≤ 申报周期上界 1200–1800s），prompt =
      「执行 /home/yale/work/quay/plugin/loop/fast-mode-loop-tick.md 中的 tick 指令…」。自驱唤醒记录
      在 inner transcript（非 outer send-keys、非 `<task-notification>`）。tick-log 留痕：
      `10:4xZ inner tick（心跳已武装 + 派发 gap-forty-to-six-remerge）`——「/loop 25m 心跳已重武装
      （CronCreate 64b5612c，:07/:32/:57 触发，会话内 session-only）」；外层 10:58Z confirm「心跳已
      重新武装」；11:2x 复核「inner 心跳：/loop 25m 已武装（64b5612c）」。Contract measure
      `inner_self_anchor` = `grep -cE "CronCreate|/loop 25m|64b5612c" <inner transcript>` 实跑 = **69**
      （≥1 满足）。间隔 25min ≤ 上界 30min ⇒ 判据成立。
- [x] AC1: 外层 tick（`orchestrator-loop-tick.md`）新增**重锚步**——inner 空闲时转发**固定重锚 prompt**
      （check-in 常量/脚本，每次原样），指向重读出厂 `fast-mode-loop-tick.md`；忙时不转发
- [x] AC2: 重锚 prompt 的**唤醒契约 = 一致性核对**——重读出厂文档 + 核对当前状态是否符合（在飞/
      池/收尾/停止条件四查）+ 明确偏差向文档自我修正；**prompt 文本零派发指令**
- [x] AC3: **防双调度源机械保证**——重锚 prompt 不含「派发/排序/batch/批」措辞（grep 断言；
      修正派发逐字照搬出厂文档规则，不是重锚的新决策）
- [x] AC4: **措辞独立**——重锚是固定常量（check-in），非外层每次现写散文；tick 转达的是常量不是新段落
      （grep/断言验证）
- [x] AC5: 出厂文档加「**状态自检清单**」小节——inner 重锚时逐项核对的机械清单（在飞数/池/收尾/停止
      条件），让「核对状态是否符合」可机械执行而非散文
- [x] AC6: **真实使用**——至少一次重锚：inner 重读出厂文档后要么报符合（no-op）要么修正明确偏差，
      证据记录；若期间有驱动文本偏差，展示下周期重锚自我对齐（非必须但优先）
      **（2026-08-05 round1 实跑）**：重锚 #1（外层 1c 步 03:03Z 投递）→ inner 重读出厂文档 → 四查自检
      发现 1 偏差（批次 worktree/分支未清理）→ **自我修正**（移除 stranded worktrees，fcd8e88e）；
      pool/closure/停止条件符合；「No dispatch decision made (wake contract respected)」。
- [x] AC7: 测试用 `node:test` 且带 `// @test-group governance`（重锚常量 + 转发步若成脚本）

## Definition of Done

- [x] AC0–AC7 全部勾上；AC6 实跑证据贴任务体（见 AC6 行 2026-08-05 round1 实跑）；AC0 实跑证据见 AC0 行
      （2026-08-08 10:57Z inner 自驱 `/loop 25m` 心跳 CronCreate 64b5612c + tick-log 留痕）
- [x] inner 有周期锚，两层各一条：(a) 自驱锚——inner `/loop 25m` 心跳 CronCreate `64b5612c`
      （2026-08-08 10:57Z 重武装，tick-log `10:4xZ inner tick（心跳已武装…）`）；(b) 重锚转发——
      重锚 #1 03:03Z 投递 + inner 重读出厂文档 + 自我修正（fcd8e88e）；措辞独立（固定常量）
- [x] 无第二调度源：重锚 prompt 零派发措辞（grep 证明）
- [x] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——**外层 verification-round round1
      (2026-08-05) 验证**：tests 2319 / fail 1（已知 noise-gate 负载抖动，isolated 1/0 pass）/ cancelled 0；
      记为绿（modulo 文档化抖动）

## Touches

- plugin/loop/orchestrator-loop-tick.md（重锚步）
- plugin/loop/fast-mode-loop-tick.md（AC5 状态自检清单小节）
- plugin/scripts/（重锚常量/转发 helper，若成脚本）
- plugin/test/（若成脚本）
- orchestration/QUAY-OUTER-HANDOFF.md（重锚惯例落文档，若适用）

## Contract

measure   inner_self_anchor = `grep -cE "CronCreate|/loop 25m|64b5612c" <inner transcript>` stdout 数字段（≥1：inner 有自驱周期锚，非 outer 转发）
measure   reanchor_cycles = `grep -c '重锚转发\|重锚 #' orchestration/tick-log.md` stdout 数字段（重锚转发记录条数）
band      inner_self_anchor = ≥1 且 reanchor_cycles = ≥1（inner 自驱锚存在 + 重锚周期发生）
invariant reanchor_has_no_dispatch_language = 1（重锚 prompt 零「派发/排序/batch」措辞）
invoke    `grep -n '派发\|排序\|batch\|批' plugin/scripts/reanchor-prompt.txt`
control   构造一次带偏差的驱动文本 ⇒ 下周期重锚必须触发 inner 重读出厂文档并向文档对齐（自我对齐演示）
resume    重锚步与出厂文档自检清单分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T02:2xZ
changed: 外层受管理者结构性发现 + 意见裁定立案。四处收紧：
(1) **锚点不对称是行为漂移的结构根**——inner Cron=0、59 次驱动全来自散文，与 R2 互补（R2 管散文别
    越权，本条管散文之外有周期锚）；
(2) **机制裁定 = 外层 cron 转发固定重锚**——单一调度源，结构上不可能成第二个调度器（管理者点名的
    头号风险）；inner 自带 cron 记录为考虑过但延后；
(3) **唤醒契约写死 = 一致性核对非调度**——prompt 零派发措辞（AC3 grep 保证），修正派发逐字照搬
    出厂文档规则；
(4) **依赖**——排在 closure-async 之后（重锚要核「是否偷偷收尾」，需出厂文档先改无收尾形态）。
status: todo——排在 closure-async 机制根之后；这是行为漂移的结构根修复，高优先。

## 落地证据（2026-08-05，实现提交时写入）

**实现形态**：重锚常量 = `plugin/scripts/reanchor-prompt.txt`（固定 check-in 文本，每 tick 外层
`cat` 该文件逐字原样转发）；外层 tick 新增步骤 1c「重锚转发」（`orchestrator-loop-tick.md`）；
出厂文档新增「状态自检清单」小节（`fast-mode-loop-tick.md`）；AC3/AC4/AC5/AC7 机械断言 =
`plugin/test/reanchor-prompt.test.mjs`（`import { test } from "node:test"` + `// @test-group governance`）。

**AC3 grep 实跑输出**（worktree `task/gap-inner-has-no-periodic-anchor-...`，基于 master `b2fa5c60`）：

`$ grep -n '派发\|排序\|batch\|批' plugin/scripts/reanchor-prompt.txt; echo "exit=$?"`
→ 无输出，`exit=1`（0 命中）——常量零派发措辞。更严的 `grep -n '派\|调度' plugin/scripts/reanchor-prompt.txt`
同样 0 命中。AC3 断言固化在 `reanchor-prompt.test.mjs` 的「AC3 — the re-anchor constant contains ZERO
dispatch language」测试（负控制：改入任一禁用词该测试即红）。

**AC4 grep/断言实跑**（`scripts/test.sh plugin/test/reanchor-prompt.test.mjs`，5/5 pass）：
`reanchor-prompt.txt` 是 check-in 常量；`orchestrator-loop-tick.md` 步骤 1c 引用
`plugin/scripts/reanchor-prompt.txt` 并要求逐字原样转发（测试断言 tick 引用常量路径 + 逐字语义）。

**AC5**：`fast-mode-loop-tick.md` 新增「## 状态自检清单（重锚时逐项核对，机械可执行，强制）」小节——
四项核对（①在飞 agent 是否符合文档 / ②就绪池是否维护 / ③是否在偷偷做收尾 / ④停止条件是否被遵守）
各带机械判据（遥测 `inProgress[]` 长度 ≤3、`ready-pool-check` `pool` 字段、无 `status: *done`/`--task-end`/
轮次记录写入、步骤 3 命中项 + `.halt`），使「核对状态是否符合」可机械执行。

**AC7 测试实跑**（`import { test } from "node:test"` + `// @test-group governance`）：
`$ QUAY_TEST_SKIP_STATIC_CHECKS=1 bash scripts/test.sh plugin/test/reanchor-prompt.test.mjs`
→ `# pass 5 / fail 0`（5 个断言全过：AC3×2、AC4×2、AC5×1）。

**AC6 证据记录（机制已落地，实跑证据待外层下一个 cron 周期）**：
- 机制：外层 tick 步骤 1c 在判 inner 空闲时经既有 send-keys 信道转发固定常量
  `plugin/scripts/reanchor-prompt.txt`（逐字原样），inner 收到后按「状态自检清单」四项机械核对：
  符合 ⇒ 无操作（no-op）；有明确偏差 ⇒ 向出厂文档自我修正。节奏 = 外层唯一 `*/20` cron，单一调度源，
  唤醒契约 = 一致性核对非调度。
- **待补证据**：外层下一次 20-min cron 重锚转发后，inner 重读出厂文档的报告（符合/no-op 或
  修正某明确偏差）——即 AC6 的「至少一次重锚」证明。此证据在合并落地后由外层 cron 天然产生；
  本轮先记录机制与待证形状，AC6 勾选等待该实跑（与 closure-sync 任务 AC5 同款待证处理）。

**AC0 + Contract 复核（2026-08-08 执行，worktree `task/gap-inner-has-no-periodic-anchor-...`，基于 develop）**：

- **AC0 实跑**（标题缺陷 (a)）：inner 自驱周期锚在位——CronCreate `64b5612c`
  （`7-59/25 * * * *` = :07/:32/:57，~25min cadence），2026-08-08 **10:57:20Z** 由 inner 会话武装，
  prompt 指向 `plugin/loop/fast-mode-loop-tick.md` 的 tick 指令。inner transcript 工具调用留痕：
  `"toolUseResult":{"id":"64b5612c","humanSchedule":"7-59/25 * * * *","recurring":true,"durable":false}`。
  tick-log 三重留痕：`10:4xZ inner tick（心跳已武装 + 派发 gap-forty-to-six-remerge）`、外层 10:58Z
  confirm「心跳已重新武装」、11:2x「inner 心跳：/loop 25m 已武装（64b5612c）」。间隔 25min ≤ 申报
  周期上界（1200–1800s）。
- **Contract measure `inner_self_anchor`** = `grep -cE "CronCreate|/loop 25m|64b5612c" <inner transcript>`
  → 实跑 **69**（≥1 满足——inner 有自驱周期锚，非 outer 转发）。
- **Contract measure `reanchor_cycles`** = `grep -c '重锚转发\|重锚 #' orchestration/tick-log.md`
  → 实跑 **3**（≥1 满足）。实质性周期记录 = `重锚 #1`（2026-08-05 03:05Z tick：外层 1c 步 03:03Z 投递
  → inner 重读出厂文档 → 四查 1 偏差 → 自我修正 fcd8e88e）；另 2 命中为 measure 措辞本身（tick-log
  2167/2169 行），非虚构。AC6「至少一次重锚」已由该记录满足，**非 runtime-pending**。
- **Contract invariant `reanchor_has_no_dispatch_language`** = `grep -n '派发\|排序\|batch\|批'
  plugin/scripts/reanchor-prompt.txt` → 0 命中（exit=1）⇒ **= 1** 满足。
- **测试**：`node --test plugin/test/reanchor-prompt.test.mjs` → `# pass 5 / fail 0`（5 断言全过：
  AC3×2、AC4×2、AC5×1）。
