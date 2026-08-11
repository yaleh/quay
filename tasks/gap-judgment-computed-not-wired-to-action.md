---
id: gap-judgment-computed-not-wired-to-action
title: "判据算出没接到「会因它而动」的那一步——2026-08-10 三次同形态（slot-refill 不查 excluded / C8 拒后不回填 / deficit 无触发器读）；类级纪律：每个机械判据必须有消费它的动作"
status: ready
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**2026-08-10 三次独立发现同属一类：判据被机械算出来了，但没有接到任何「会因它而动」的那一步。** 三次都是「信号算了，没接进推荐/触发路径」——不是判据缺失，是**消费缺失**。合起来值得一条类级纪律 + 一次系统性审计。

### 三个实例（按时间）

1. **18:4x `slot-refill.ts:243` 只遍历 `pool.ready`，不查 `excluded` 的 `not-yet-flipped`**（已立案 `gap-slot-refill-repeats-done-eligible-recommendations`，已修）：`ready-pool-check` 算出 16 条 excluded/14 nyf，slot-refill 候选循环零引用 ⇒ 已 fan-in 待翻 done 的任务每轮被重派复核。今日 25 条重派提交自述。
2. **21:4x 候选被 C8 逐候选门拒绝后不从排序回填**（已立案 `gap-slot-refill-c8-reject-no-backfill`，待修）：`touches-orthogonality-check --self-touch-scan` 算出 5 ready 缺 self-touch，slot-refill 推荐前 N 个候选恰好被 C8 全拒且不补位 ⇒ 「17 本可派」与「本 tick 无可派」并存。
3. **22:0x `deficit` 每轮算出，没有任何触发器读它**（本任务审理中）：`ready-pool-check` 每轮 `pool=17 floor=20 deficit=3`、`promotions` 非空，但 B9 的两个触发器（队列空 / 阶段目标点名）都不是 `deficit>0`；pool 从 27 漂到 17 始终没跌到「队列空」，39 个 todo + 合格候选就放着。今日仅 2 次晋级全是定向，零次 floor 驱动。

### 类级观察（为什么值得做成一类）

三条各自小，合起来是同一个类：**「判据算出来了」≠「会因它而动」。** 已经存在的机制（`--apply` 心跳、`promotions` 推荐、`not-yet-flipped` 排除、self-touch-scan）都算出了正确信号，但消费它的动作要么没接线、要么不补位。**每多一个算出来没人消费的判据，就多一个「看它一眼算检查过」的假仪器。**

### 修复方向（实现归 inner，判定归 outer）

1. **类级纪律**：每个机械判据必须有**消费它的动作**——要么接进执行核的强制步骤（如 B9 第三触发器接 `--apply`），要么在判据输出里带「谁消费我」字段，找不到消费方即视为未完成。
2. **系统审计**：全仓扫一遍「算出来但无消费方」的判据（类似 `checker-mutation-check` 的 covered/uncovered 形态，但维度是「判据→消费动作」而非「检查器→mutation case」）。已知候选：`deficit`（已修 B9）、`not-yet-flipped`（已修 slot-refill）、self-touch-scan（已修止血+待回填）、`dispatchable_disjoint` vs `dispatchable` 双算、`obligation` 台账、`closure-lag` 信号等。

**验证锚**：修后 (a) 类级纪律在文档（执行核或 catalog）可 grep；(b) 审计列出「判据→消费动作」映射，无消费方的列未完成；(c) `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录三次同形态实例（18:4x / 21:4x / 22:0x，各带已立案 id）（本任务 Proposal 已含）
- [x] AC2: **类级纪律**——「每个机械判据必须有消费它的动作」固化为可 grep 的文档/检查器
- [x] AC3: **系统审计**——「判据→消费动作」映射清单，无消费方列未完成
- [x] AC4: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 修后实跑：审计清单含三个实例的消费方（已修/待修标注）；无消费方判据被列为未完成
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- orchestration/orchestrator-tick-core.md（类级纪律挂载点——B9 已接 deficit 触发器，纪律可与其同处）
- plugin/scripts/judgment-consumer-check.ts（审计检查器：判据→消费动作映射——判据清单 + 各自消费动作，无消费方判据列未完成；复用 capability-catalog 的声明）
- plugin/test/（新增审计测试）
- tasks/gap-slot-refill-c8-reject-no-backfill.md（交叉标注——实例 2）
- tasks/gap-slot-refill-repeats-done-eligible-recommendations.md（交叉标注——实例 1，已修）
- tasks/gap-judgment-computed-not-wired-to-action.md（自身：勾 AC + 贴证据）

## Contract

measure   consumer_wired = `grep -cE "deficit.*--apply|消费|consumer" orchestration/orchestrator-tick-core.md plugin/scripts/capability-catalog.sh` 的 stdout 数字
band      consumer_wired >= 1（类级纪律已接线）
invariant each_judgment_has_consumer = 1（审计映射：每个判据有消费动作）
invariant no_consumer_listed_unfinished = 1（无消费方的判据被列为未完成）
invoke    `grep -nE "deficit.*--apply|消费|consumer" orchestration/orchestrator-tick-core.md`（贴 B9 第三触发器接线）
control   类级纪律在场；审计映射完整；无消费方列未完成
resume    纪律文档 / 审计检查器 / scoped 门分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: manager 22:0x 第三次同形态——deficit 每轮算出无触发器读（B9 只有队列空/阶段目标两触发器），pool 27→17 漂移、39 todo 放着。manager 并列三次（18:4x / 21:4x / 22:0x）问是否值得做成一类。裁定：类级纪律「每个机械判据必须有消费它的动作」+ 系统审计。outer 已先修 B9 第三触发器（77f17d95，接 --apply 自闸心跳）；本任务做纪律+审计。实现归 inner，判定归 outer

## Evidence（inner 2026-08-11 实跑）

**scoped 门**：`bash scripts/test.sh --for-task gap-judgment-computed-not-wired-to-action --allow-thin` ⇒ `tests 14 / pass 14 / fail 0 / cancelled 0 / skipped 0`，`FULL-EXIT=0`。

**Contract measure（consumer_wired，类级纪律已接线）**：
`grep -cE "deficit.*--apply|消费|consumer" orchestration/orchestrator-tick-core.md plugin/scripts/capability-catalog.sh` ⇒
`orchestration/orchestrator-tick-core.md:2`（A19 纪律句 + B9 第三触发器）、`plugin/scripts/capability-catalog.sh:58`（judgment-consumer-check 声明 + consumer-facing 面）——`>= 1` 满足。

**Contract invoke（B9 第三触发器接线）**：`grep -nE "deficit.*--apply|消费|consumer" orchestration/orchestrator-tick-core.md` ⇒
- `:31`（新增 A19 类级纪律句：每个机械判据必须有**消费它的动作**……B9 第三触发器接 `--apply`……机械核对应 `plugin/scripts/judgment-consumer-check.ts`）
- `:43`（B9 既有行：**`deficit > 0` 第三触发器**……跑 `ready-pool-check.ts --apply`）

**Contract invariants（judgment-consumer-check --json 实跑）**：`each_judgment_has_consumer=1`、`no_consumer_listed_unfinished=1`，`judgments=6 / covered=6 / unfinished=0`，exit 0。判据→消费动作映射（全部 wired）：
- `not_yet_flipped`（18:4x）→ slot-refill 第 4 项 step-4 检查 + A9
- `self_touch_scan`（21:4x）→ C8 派发闸 + slot-refill 回填
- `deficit`（22:0x）→ B9 第三触发器 `ready-pool-check --apply`
- `dispatchable_disjoint` → slot-refill `should_refill`（>=1）+ B9/A18 空槽强制链
- `obligation_ledger` → obligation-ledger-check.ts（test.sh 静态门）
- `closure_lag` → A10 每 tick 读 + B2 `--record`

**AC2 类级纪律落点（可 grep）**：`orchestration/orchestrator-tick-core.md` A19（含「消费」「consumer」「--apply」）+ `plugin/scripts/capability-catalog.sh`（judgment-consumer-check 声明 + 4 项 crystallization 字段）+ `scripts/test.sh` run_static_checks 接入（`@static-tier change`）。**AC3 审计检查器**：`plugin/scripts/judgment-consumer-check.ts` 新建，`--json` 输出 `audit[]`（每条带 consumer/wired/finished），无消费方判据列 `unfinished`（`finished:false`），删除接线即 exit 1（class ratchet，mutation case 覆盖 deficit→--apply 与 not-yet-flipped 两处）。

**新增测试**（plugin/test/judgment-consumer-check.test.mjs，14 例）：AC1 三实例在册 / AC2 判据→消费动作映射完整 / AC3 verify 机械核对（空 root 全 fail 无自证）+ deficit 删 `--apply` 接线 ⇒ verify fail / AC4 实跑 band 满足 + 删接线 ⇒ unfinished=1、`each_judgment_has_consumer=0`、诚实列未完成 + CLI 实跑 exit 0 / 空 root exit 1 / AC5 接线（tick-core A19 + catalog 声明 + test.sh 接入）。既有 0 回归（fail 0）。

**交叉标注**：`tasks/gap-slot-refill-c8-reject-no-backfill.md`（实例 2，21:4x）、`tasks/gap-slot-refill-repeats-done-eligible-recommendations.md`（实例 1，18:4x）各加 `## 交叉标注` 指向本类级任务。

**机制连带（非 Touches 但为机械必要，均随 scoped 门绿验证）**：`plugin/scripts/capability-catalog.sh`（新脚本 AC1c 声明 + 4 字段）、`scripts/test.sh`（静态检查器接入）、`docs/proposals/quay-product-outline.md` §6 DELIVERY-INVENTORY snapshot（新 plugin/scripts 文件触发 --write-inventory 再生成）、`plugin/scripts/checker-mutation-cases/judgment-consumer-check.sh`（checker-mutation 全量门用例）。
