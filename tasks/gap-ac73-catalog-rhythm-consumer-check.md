---
id: gap-ac73-catalog-rhythm-consumer-check
title: AC73 capability-catalog 节奏栏消费检测——非「按需」机件必须有按位置命中的调用点，否则红
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**AC73（capability-catalog 节奏栏消费检测 —— manager 2026-08-14 05:2xZ 报，今日第三例「正确的东西造好了、零消费者」）**。

**背景（发生率=4，且各例互不相关 ⇒ 够支撑造检测器，硬规则 12 门槛给）**：
```
per_suite_lane_budget=8       算对、打印、无 reader             → AC68（已修：test.sh 读它）
fan-in-ff-protocol-check.ts   造好、测试绿、无 caller           → 本条（AC62 判据2 能取假但结构上不可能红）
checkSplitRecommendation      零非测试调用者（CLAUDE.md 已记）  → 既有
tick-core-drift-check         已接线但 --no-block（2026-08-14） → 第 4 种形态：有消费者但被静音
```
**AC62 的实例最具体**：`fan-in-ff-protocol-check.ts` 全仓零调用者（test.sh=0、三层执行核=0、其余 0——逐条打印核过），catalog 节奏栏写「按需」（capability-catalog.sh:412）。**判据2 字面要求「必须红」，但它不运行 ⇒ 结构上不可能红**。develop 真出现非 ff fan-in merge，没有任何东西报红。**对一个协议检查器，「按需」等于「从不」**——它的价值全在连续性，没人会在违规那一刻想起来手跑它。

**⚠️ 第 4 种形态（manager 2026-08-14 05:2xZ 报，今日第四例）**：`tick-core-drift-check` **已接线**（`scripts/test.sh:627`）**但带 `--no-block`**（`gap-tick-core-drift-check-not-in-suite`），今天输出逐字 **3 pairs, 0 consistent / 3 drifted**、`fast-mode` 那对 12 hunks / +29/-15——**但它报了不改变任何结果，于是「报了」和「没报」在下游无法区分**（与「按需」同构：结构上不能取假——恒绿，因为它不阻）。**接线前我们【知道】那份义务没被执行；接线后套件每轮打印 PASS ⇒ 记录上看起来它正在被执行——恒绿检查是假的保证（硬规则 3/9）**。

**判据（manager 建议形态，已并入第 4 形态）**：
- **判据1**：**凡节奏非「按需」的机件必须在 `scripts/test.sh` 或某个执行核里有一处按位置命中，否则红**——产物是本来就要维护的 capability-catalog，不是新增打卡。
- **判据2**：**「按需」本身也要被约束**——一个判据类机件若声明为「按需」，必须在 catalog 里写明**谁在什么条件下按它**，否则「按需」就是「无人」。
- **判据3**：**凡 `--no-block` 的检查器，必须写明【谁在什么时候读它的输出并据此动作】，否则红**——与判据2 同一句话的另一半：`--no-block` 报而不改结果，「报了/没报」下游不可区分 ⇒ 判据必须带消费方（manager ③ 逐字建议，2026-08-14）。
- **能取假（两个现成真实缺席样本，均 D2 不构造）**：
  - AC62 的 `fan-in-ff-protocol-check.ts`（零调用者 + 节奏「按需」且无「谁按它」）⇒ 回放必须红。
  - `tick-core-drift-check --no-block`（已接线但无消费方——今天 3 pairs 全漂、无人据此动作）⇒ 回放必须红。

**⚠️ AC62 的阶段 AC 保持未勾**（manager 已明确：任务 AC 全满足可 done，阶段判据2 因无接线不能勾）——本任务接线落地后，AC62 判据2 才可能红，manager 才勾。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 capability-catalog.sh 节奏栏（:411/:412 等）+ test.sh + 三层执行核的调用点形态。
2. 判据1：节奏非「按需」的机件 → 在 test.sh 或执行核按位置命中（无则红）。
3. 判据2：「按需」机件 → catalog 写明谁在什么条件下按它（无则红）。
4. 判据3：`--no-block` 检查器 → 写明谁在什么时候读它的输出并据此动作（无则红）。
5. 能取假（双样本，D2）：AC62 fan-in-ff-protocol-check（零调用者 + 无「谁按它」）+ tick-core-drift-check `--no-block`（无消费方）回放必须红。
6. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：节奏非「按需」的机件在 test.sh 或执行核有按位置命中，否则红。
- [ ] AC2 判据2：「按需」判据类机件在 catalog 写明谁在什么条件下按它，否则红。
- [ ] AC3 判据3：`--no-block` 检查器写明谁在什么时候读其输出并据此动作，否则红。
- [ ] AC4 能取假：fan-in-ff-protocol-check（零调用者 + 无「谁按它」）与 tick-core-drift-check `--no-block`（无消费方）双样本回放必须红——真样本不构造（D2）。
- [ ] AC5 接线后 AC62 判据2 可能红（manager 才勾阶段 AC）。
- [ ] AC6 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] catalog 节奏消费检测落地（非按需必有调用点 + 按需必写谁按 + `--no-block` 必写消费方）+ fan-in-ff-protocol-check 与 tick-core-drift-check 双样本回放红。

## Touches

- plugin/scripts/capability-catalog.sh（节奏栏「按需」机件补「谁在什么条件下按」+ `--no-block` 检查器补消费方）
- plugin/scripts/（新检查器——节奏消费检测 + 负控制 fixture）
- scripts/test.sh / 三层执行核（非按需机件的调用点接线——AC62 判据2 的 fan-in-ff-protocol-check 入其中之一；tick-core-drift-check 的 `--no-block` 补消费方）
- tasks/gap-ac73-catalog-rhythm-consumer-check.md（自身）

## Evidence

（落地后回填）
