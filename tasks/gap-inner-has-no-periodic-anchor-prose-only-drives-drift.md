---
id: gap-inner-has-no-periodic-anchor-prose-only-drives-drift
title: the inner's ONLY anchor is outer prose (its Cron count is 0; all 59
  overnight drives were send-keys) while the outer is force-re-read of the
  shipped doc every 20 min — give the inner a periodic, wording-independent
  re-anchor to the shipped doc, as a FIXED relay (single cadence), with a strict
  conformance-check-only wake contract so the cron never becomes a second
  dispatch source
status: ready
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

- [ ] AC1: 外层 tick（`orchestrator-loop-tick.md`）新增**重锚步**——inner 空闲时转发**固定重锚 prompt**
      （check-in 常量/脚本，每次原样），指向重读出厂 `fast-mode-loop-tick.md`；忙时不转发
- [ ] AC2: 重锚 prompt 的**唤醒契约 = 一致性核对**——重读出厂文档 + 核对当前状态是否符合（在飞/
      池/收尾/停止条件四查）+ 明确偏差向文档自我修正；**prompt 文本零派发指令**
- [ ] AC3: **防双调度源机械保证**——重锚 prompt 不含「派发/排序/batch/批」措辞（grep 断言；
      修正派发逐字照搬出厂文档规则，不是重锚的新决策）
- [ ] AC4: **措辞独立**——重锚是固定常量（check-in），非外层每次现写散文；tick 转达的是常量不是新段落
      （grep/断言验证）
- [ ] AC5: 出厂文档加「**状态自检清单**」小节——inner 重锚时逐项核对的机械清单（在飞数/池/收尾/停止
      条件），让「核对状态是否符合」可机械执行而非散文
- [ ] AC6: **真实使用**——至少一次重锚：inner 重读出厂文档后要么报符合（no-op）要么修正明确偏差，
      证据记录；若期间有驱动文本偏差，展示下周期重锚自我对齐（非必须但优先）
- [ ] AC7: 测试用 `node:test` 且带 `// @test-group governance`（重锚常量 + 转发步若成脚本）

## Definition of Done

- [ ] AC1–AC7 全部勾上；AC6 实跑证据贴任务体
- [ ] inner 有周期锚：重锚转发生效（至少一个周期 inner 重读出厂文档）；措辞独立（固定常量）
- [ ] 无第二调度源：重锚 prompt 零派发措辞（grep 证明）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- plugin/loop/orchestrator-loop-tick.md（重锚步）
- plugin/loop/fast-mode-loop-tick.md（AC5 状态自检清单小节）
- plugin/scripts/（重锚常量/转发 helper，若成脚本）
- plugin/test/（若成脚本）
- orchestration/QUAY-OUTER-HANDOFF.md（重锚惯例落文档，若适用）

## Contract

measure   reanchor_cycles = 最近窗口内 inner 重读出厂文档的周期数（重锚转发记录）
band      reanchor_cycles >= 1（生效期间至少一个重锚周期）
invariant reanchor_has_no_dispatch_language = 1（重锚 prompt 零「派发/排序/batch」措辞）
invoke    `grep -n '派发\|排序\|batch\|批' <重锚 prompt 常量文件>`
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
