---
id: gap-promotion-cadence-is-role-volition-not-product-mechanism
title: todo→ready promotion cadence/priority lives in an outer's voluntary AC —
  the tick doc has zero author/promote/晋级 hits, so no cold-start session
  inherits the behavior that keeps the ready pool healthy
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

人方向裁定（2026-08-04，经管理者转达）：**todo→ready 晋级的节奏与优先级，应当是冷启动后就该稳定
具备的产品行为，不该依赖某个会话记得自己那条自愿的 AC。**

### 证据（外层独立核实）

- `fast-mode-loop-tick.md` 全文 `grep -c 'author\|promote\|晋级'` = **0**——机制层面从未定义过
  「谁做晋级、多久做一次、按什么顺序选」。
- `AC8c` 六键（cold-start/SKILL.md）只证明循环**启动**（到 FIRST-TASK 为止），**不覆盖「循环持续
  健康」这个维度**。
- 现行做法是外层 `outer-phase-goal.md` 的一条**自愿 AC-queue**（就绪池 ≥3 真实可派发）——角色自觉，
  换了会话/模型就消失。

**「持续健康」≠「冷启动证明」**：冷启动证明「循环起来了」，持续健康要求「循环一直有得派」。
晋级速率是持续健康维度的第一个具体缺口。

### 选定机制

**把晋级变成 tick 文档调用的子机制**，任何未来冷启动本项目的会话（不管是谁、哪个模型）都会继承：

1. **机械检查器** `plugin/scripts/ready-pool-check.ts`：计算真实就绪池（排除 ① 本批已做完未翻 done
   的 ② `labels: fixture` 的 ③ PARKED 的）；`pool < 3` 时从 todo 积压按**定义好的顺序**推荐晋级候选
   （`gap-*` 缺陷 > `DIR-*` 新能力；依赖就绪；`## Touches` resolve 可派发；四件套齐全；非 fixture
   非 PARKED）。**顺序由脚本承载，不是散文**。
2. **tick 文档新增规范性步骤「就绪池维护」**（`fast-mode-loop-tick.md`，fan-in 之后、派发之前）：
   跑 `ready-pool-check.ts`；`pool < 3` ⇒ 按推荐补晋（缺四件套的先补齐，再 `status: todo → ready`）。
3. **外层自愿 AC-queue 降级为引用**：机制由 tick 文档承载，外层 AC 只引用它，不再独立维护。

> **交叉标注（2026-08-08，`gap-targeted-promotion-operation-does-not-exist` 落地时写）**：本条裁定在
> 补条的落地中被核对出**超额执行**——把「外层候选集构造规则整体搬进内层 checker（kind 排序
> gap→DIR→other，无阶段目标输入）」时，连「外层提供优先级输入」职责一起砍了。那个职责是**另一项
> 操作**：**定向晋级 targeted**（外层按阶段目标挑选 todo 任务，机械承载 = `ready-pool-check.ts
> --targeted <id>` + `quay promote <id>`，**不受 `pool<floor` 约束**——阶段目标任务被补充门挡在 todo
> 时由它提出来）。本条 = 机制默认存在（AC1-AC3 已落）；补条 = 外层优先级输入的操作落位（AC1-AC5）。
> 两条不重叠、同属 ready-pool-check 机制族；补条不改本条已有的 `pool<floor` 批量补充路径。

## Acceptance Criteria

- [x] AC1: `plugin/scripts/ready-pool-check.ts` 存在——计算真实就绪池（排除本批未翻 / fixture /
      PARKED）；`pool < 3` 时按定义顺序（gap-* > DIR-*；依赖就绪；touches resolve；四件套；非
      fixture）输出推荐晋级候选列表（含理由）
- [x] AC2: `fast-mode-loop-tick.md` 新增「就绪池维护」步骤（fan-in 后、派发前调 checker；pool<3
      按推荐补晋）。`grep -c 'author\|promote\|晋级' fast-mode-loop-tick.md` ≥ 1（原文 0 的缺口被
      消除——检查器与文档都出现「晋级」语义）
- [x] AC3: `orchestrator-loop-tick.md`（外层）同步——外层不再靠自愿 AC 维护就绪池，引用 tick 文档
      的子机制
- [x] AC4: **负控制（双向）**——构造 `pool < 3` 且 todo 积压有合格候选 ⇒ checker 必须推荐；
      `pool ≥ 3` 或无合格候选 ⇒ 必须不推荐（不误晋级）。两次实跑输出贴任务体
- [x] AC5: **候选顺序可判**——把一条 `gap-*` 与一条 `DIR-*` 同时放入候选 ⇒ `gap-*` 排前；把一条
      touches 不可 resolve 的与一条可 resolve 的放入 ⇒ 可 resolve 排前（实跑输出贴任务体）
- [x] AC6: 测试用 `node:test` 且带 `// @test-group governance`
- [x] AC7: `orchestration/SPEC-quay-self-hosts-its-own-cold-start.md` 增加「持续健康」维度（AC8c 之外）
      ——见 SPEC 同步任务，本任务引用

## Definition of Done

- [x] AC1–AC7 全部勾上；AC4/AC5 实跑输出逐字贴进本任务体
- [x] **一次真实继承证明**：在冷启动铺出的文档路径下跑 `ready-pool-check.ts` 对当前真实队列输出
      推荐（非构造夹具）——证明任何未来会话调用它即得同一行为
- [x] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

### invoke 实跑证据（task-contract-check 消费者：done 任务必须展示 invoke 入口路径）

`node --experimental-strip-types plugin/scripts/ready-pool-check.ts`（Contract invoke：对当前真实队列计算真实就绪池与推荐晋级候选）→ 验证时真实池 `pool = 6 ≥ 3`（无需补晋；排除 fixture/PARKED）。后续 `gap-ready-pool-check-counts-merged-not-flipped-tasks-in-the-pool` 将 notYetFlipped 判据从「AC 全勾」改为「工作已落 master」，merged 未翻任务从池中排除，真实池随后按该修正计数。
`scripts/test.sh plugin/test/ready-pool-check.test.mjs` → ℹ tests 11 / pass 11 / fail 0 / cancelled 0 / skipped 0。
批量 fan-in 全量：tests 2298 / fail 0 / cancelled 0 / skipped 27。

## Touches

- plugin/loop/fast-mode-loop-tick.md
- plugin/loop/orchestrator-loop-tick.md
- plugin/scripts/ready-pool-check.ts (new)
- plugin/test/ready-pool-check.test.mjs (new)
- orchestration/SPEC-quay-self-hosts-its-own-cold-start.md
- orchestration/outer-phase-goal.md（AC-queue 降级为引用）

## Contract

measure   ready_pool = `node --experimental-strip-types plugin/scripts/ready-pool-check.ts` stdout 的 pool 字段
band      ready_pool = ≥3（真实可派发；排除本批未翻/fixture/PARKED）
invariant promotion_order = gap-first（checker 输出里 gap-* 恒在 DIR-* 前）
invoke    `node --experimental-strip-types plugin/scripts/ready-pool-check.ts`
control   pool<3 且有合格候选 ⇒ 推荐；pool≥3 或无候选 ⇒ 不推荐（AC4）
resume    检查器与文档步骤分两次提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-04T16:0xZ
changed: 外层受人方向裁定立案。三处收紧：
(1) **不是把自愿 AC 抄进文档**——是把它变成 tick 文档调用的**子机制**（checker + 规范性步骤），
否则换了会话/模型照样丢；
(2) **AC5 把「顺序」从散文变成可判断言**——gap 优先、resolve 优先各构造双向实测，防止「顺序已定义」
    只是嘴上说；
(3) **DoD 要求真实继承证明**——在冷启动铺出的文档路径下对当前真实队列跑 checker（非构造夹具），
    证明任何未来会话调用即得同一行为，不是本会话记得。
status: todo——排在内层当前批（task-write/node-compile-cache/retirestate）之后。
