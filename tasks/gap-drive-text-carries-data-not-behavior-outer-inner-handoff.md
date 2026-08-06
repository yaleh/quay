---
id: gap-drive-text-carries-data-not-behavior-outer-inner-handoff
title: outer drive text re-narrated the dispatch contract in prose and overrode
  the shipped tick doc — the standing concurrent-dispatch directive dropped a
  second time, because behavior was restated instead of supplied by the doc
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

外层裁定 R2（`orchestration/outer-rulings-2026-08-04-A-F.md`，管理者观察第二条）。管理者提供的证据：

- 驱动文本首句是「本批实现三个任务，按 A→D→B 顺序」，纪律清单列了 worktree/分支/Contract/
  对抗审查/遥测括号/资源闸——**唯独没有并发后台派发**；
- 内层（deepseek-v4-flash）忠实执行散文：`Agent` 调用 0 次，在自己上下文串行做 A
  （6m11s / 58.2k tokens）；
- 出厂 `plugin/loop/fast-mode-loop-tick.md` §4 明确要求并发派发：line 280「并发上限 3 个在飞
  subagent」、line 317「派发形态：后台 `Agent(run_in_background)`」。内层 14:36:06 **确实读过它**，
  但仍串行——因为我的散文覆盖了产品。

这是「并发派发 + `run_in_background:true`」常驻指令的**第二次静默丢弃**（简报 §3 点名过一次：
「历史上各被静默丢弃过一次，这次显式点名」）。根因不是内层——它忠实执行了收到的指令——是外层
**把行为当数据复述**：外层说了「怎么派发」，而那个词本就该由出厂文档供给。

机械事实（本 tick 实跑）：`checkTouchesPair` 对 A/D、D/L0、A/L0 **全部 `disjoint:true`**——
没有任何技术理由需要 A 先于 D。

### 与 SPEC-quay-self-hosts-its-own-cold-start.md 的关系

- **SH 管启动**：冷启动（挂监视器、建 cron、驱动内层进 fast mode 并派发第一条任务）那一跳的交接。
- **本条管稳态**：启动之后**每一跳**的交接——外层每次驱动内层时，什么该随文本过去（数据）、
  什么不该（行为）。
- 两者都是「交接通道不失真」的实例：SH 是 boot 实例，本条是 per-tick 实例。SH 解决「循环怎么上来」，
  本条解决「上来之后每一跳的通道不被散文污染」。

### 选定机制（设计判据）

**驱动文本只携带数据，不复述行为。**

1. 驱动文本携带：任务 id、裁定结论、依赖事实（如「B 消费 D 的 classifyPaneState」）。
2. 行为（怎么派发、worktree 位置、纪律、上限）一律由出厂 `fast-mode-loop-tick.md` 供给——
   外层不重述。出厂文档的行为错了就**改文档**（内层的活），不用散文覆盖。
3. 若确需指定顺序：必须**附 checkTouchesPair 实际输出**（机械证据），否则不定顺序。
4. 内层 fail-safe：收到与出厂派发契约**矛盾**的驱动文本时，**以出厂文档为准**并向外层标注矛盾，
   不静默服从散文。

## Acceptance Criteria

- [x] AC1: `plugin/loop/fast-mode-loop-tick.md` §4 补一条规范性语句（「驱动文本只携带数据」+ 内层
      fail-safe 子句：与本节矛盾的驱动文本以本节为准并对外层标注）
- [x] AC2: `plugin/loop/orchestrator-loop-tick.md`（或外层交接文档）补「驱动文本只带数据」条目 +
      自检清单：列任务时要么不定顺序、要么附 `checkTouchesPair` 输出
- [x] AC3: 机械检查器 `plugin/scripts/drive-contract-check.ts`（接 `scripts/test.sh` 的
      `run_static_checks`）：检出「驱动文本断言了 `X→Y` 顺序且同文无 `checkTouchesPair` 输出」
      这一形态（按**位置**判：顺序断言与 checkTouchesPair 输出是否在同一驱动文本里；不按关键词——
      裁决文档必然写着「并发派发」等词）
- [x] AC4: AC3 的负控制——构造一条含 `按 A→B 顺序` 且无 checkTouchesPair 输出的驱动文本 ⇒ 检查器
      必须报出；补上输出 ⇒ 必须不报（两次实跑贴任务体）
- [x] AC5: 关系说明落地：`orchestration/QUAY-OUTER-HANDOFF.md` 或本任务体明写与
      `SPEC-quay-self-hosts-its-own-cold-start.md` 的分工（SH=启动交接，本条=稳态每跳交接）
- [x] AC6: 测试用 `node:test` 且带 `// @test-group governance`
- [x] AC7: **「在飞」词汇拆分 + 原始字段核实**（2026-08-04 第三次实锤后加）——外层核实并发必须读
      原始 Agent 工具调用的 `input.run_in_background` 字段（meta-cc transcript 查询），
      **不得用**遥测 START 事件或 pane UI 文字：START 只证「遥测括号在飞」，不证「subagent 在飞」。
      「在飞」一词在 tick 词汇里拆为两种含义，报告/队列状态里分别标注，混用会让并发指令看起来已满足。
      实例（本 tick）：内层唯一 Agent 调用 `run_in_background` 缺失，而 START 事件显示 A|D 双在飞——
      用错仪器导致静默满足，是本条要消灭的形态
- [x] AC8: **输入框残留污染——同一通道问题的另一端**（2026-08-04 第二次实锤后加）——外层不得把
      下一步备忘写进自己的输入框：它是**待提交缓冲区，不是笔记本**。`*/20` cron 触发时入队的 prompt
      会与框内残留文本拼接成乱码（前一条截断、后一条接在断口上——管理者 2026-08-04 实锤；外层当晚
      两次自踩）。下一步备忘一律落队列状态文件或 tick-log；输入框用完即空（`C-u`）。本条与 AC1–AC7
      是同一个「交接通道」问题的两端：发出去的内容被复述污染（AC1–AC7），没发出去的内容污染下一次
      发送（本条）
      **（第三次复发 + 机制洞察，2026-08-04 16:0xZ 追加）**：当晚第三次被抓到框内残留
      （「核实 retirestate 派发的原始字段 rib」）。实测发现两个此前未记录的事实：
      (a) **输入框同时收到「自己写的备忘」与「入站消息的回显」**——我的自捕显示框内出现过管理者
      消息正文本身，C-u 后仍在（自清/自证不可靠）；(b) **从会话内部清空/验证自己的输入框不可靠**——
      C-u 可能未生效或回显重新落框。⇒ 「别把备忘写进框」作为自律**不充分**：框会被动接收文本，
      而唯一可靠观察者是**外部会话**（管理者能看到我的框）。**落地要求**：R2 落地时，tick 文档/外层
      交接处补一条——每个驱动回合结束由外部观察者（或下次驱动前 capture-pane 核对）确认框空，
      并接受「框内残留可能来自入站回显而非自写备忘」这一事实（因此问责对象是「框里有文本」这一
      状态，不是「谁写的」）。

## Definition of Done

- [x] AC1–AC8 全部勾上；AC4 两个方向的实跑输出逐字贴进本任务体（见下）
- [ ] 一次真实驱动验证：外层此后一条驱动文本若断言顺序，必带 `checkTouchesPair` 输出
      （任务体记录至少一次实际发生的遵守实例——**待外层后续真实驱动后补记**）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`——**由外层异步 verification-round 验证**）

### AC4 负控制实跑（2026-08-05 逐字）

驱动文本构造：`本批实现三个任务，按 A→B 顺序。`

**方向 1 — 无 checkTouchesPair 输出 ⇒ 检查器必须报出（violations +1）**：

```
drive-contract-check --judge /tmp/drive-ac4/run1.md
VIOLATION: 1 order assertion(s) WITHOUT a checkTouchesPair output in the same text
  /tmp/drive-ac4/run1.md:1  [A→B]  本批实现三个任务，按 A→B 顺序。
FAIL: an order-asserting drive text lacks its checkTouchesPair evidence
exit=1
```

**方向 2 — 同文补上 checkTouchesPair 输出 ⇒ 检查器必须不报（violations 回落 0）**：

```
drive-contract-check --judge /tmp/drive-ac4/run2.md: clean (1 order assertion(s), pair output present)
exit=0
```

两向实跑由 `plugin/test/drive-contract-check.test.mjs`（AC4 前两条）与
`plugin/scripts/checker-mutation-cases/drive-contract-check.sh` 固化。

## Touches

- plugin/loop/fast-mode-loop-tick.md
- plugin/loop/orchestrator-loop-tick.md
- orchestration/QUAY-OUTER-HANDOFF.md
- plugin/scripts/drive-contract-check.ts (new)
- plugin/test/drive-contract-check.test.mjs (new)
- scripts/test.sh

## Contract

measure   drive_contract_violations = `node --experimental-strip-types plugin/scripts/drive-contract-check.ts` stdout 的 violations 字段
band      drive_contract_violations = 0（出现即超出）
invariant ordered_drive_text_has_pair_output = 1（每条带顺序断言的驱动文本都附 checkTouchesPair 输出）
invoke    `node --experimental-strip-types plugin/scripts/drive-contract-check.ts`
control   构造 `按 A→B 顺序` 无输出的文本 ⇒ violations 必须 +1；附输出 ⇒ 回落 0（AC4）
resume    文档修订与检查器分两次提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-04T14:5xZ
changed: 外层裁定 R2 立案。相对管理者观察的收紧：
(1) 根因定为「行为当数据复述」而非「内层不听话」——内层忠实执行了收到的散文，是外层把该由
出厂文档供给的行为写进了驱动文本；
(2) 机制的核心是**内层 fail-safe 子句**（AC1）——产品不被散文覆盖的机械承载：矛盾时以出厂文档
为准并标注，而不是指望外层永远记得不复述；
(3) AC3 检查器按「同一驱动文本里顺序断言与 checkTouchesPair 输出是否共存」判，不按关键词
（裁决文档必然写着并发派发等词，关键词式必 100% 自命中）；
(4) 与 SH 的分工写进 AC5——SH 管 boot 交接，本条管稳态每跳交接，两个实例同一通道不失真目标。
status: todo——排在 D/B/L0 之后（改的是 tick 文档与交接文档，触摸面与在飞任务 disjoint）。
