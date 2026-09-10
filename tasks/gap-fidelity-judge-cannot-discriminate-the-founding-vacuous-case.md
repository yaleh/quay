---
id: gap-fidelity-judge-cannot-discriminate-the-founding-vacuous-case
title: 保真性判定器对「扩面前（结构上不可能取假）」与「扩面后」两个逐字历史夹具给出同一判决 faithful——判别力实测为 0，闸接上也会放行
  AC-225 那条空洞判据（GOAL-013 风险 2 已实测发生）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-230
---
## Proposal

**实测原始输出已 vendor 在仓库里（⛔ 非自述、非注释声称）**：

```
plugin/test/fixtures/criterion-fidelity/real-judge-pre.stdout.txt   23B  {"verdict":"faithful"}
plugin/test/fixtures/criterion-fidelity/real-judge-post.stdout.txt  23B  {"verdict":"faithful"}
（2026-09-10 12:27 写入；判定器 = deepseek-v4-pro-anthropic 经 launchArgv("fix-worker")）
```

⇒ 真判定器对**扩面前**（只有 P1/P2/P3、对跨包源码锚点**结构上不可能红**）与**扩面后**（含 P4 三形态）两个逐字历史夹具**给出同一判决**。**判别力 = 0。**

⇒ **即使把真判定器接到缺省激活路径上，闸也会放行 AC-225 那条空洞判据** ⇒ GOAL-013 的业务目标（让 achieved-but-vacuous 进不来）此刻**不成立**——机制齐备、测试全绿、而它认不出自己的立条案例。

**GOAL-013 风险 2 已实测发生**：其原文写「判定器自己空洞——一个总是判 `faithful` 的保真性判定器，正是本 goal 要禁的那一类东西，且它会与『一切判据都保真』同形」。**风险 2 当时设想的是代码层的恒 faithful；实际发生在 LLM 判别力层——形态相同，更难修。**

⚠️ **两个单点读数不能区分「稳定不判别」与「那一次噪声」**（单点采样陷阱）。⇒ 本任务**第一步是取重复读数**，⛔ 不在分辨这两种成因之前选修法（否则重演「成因报得太早，害下游改错」）。

**与既有任务的分工**：`gap-fidelity-gate-not-wired-on-the-dominant-cli-activation-path` 管「闸在缺省路径上跑不跑」；**本任务管「跑了也判不出」**。两者都不成立时闸等于不存在；⛔ 修好任一条单独都不够。

## Plan

1. **先分辨形态（⛔ 不先改 prompt）**：对 pre/post 两个夹具各取 **N ≥ 5** 次真判定器读数，原始输出逐次落盘，统计 verdict 分布。
   - pre 稳定 `faithful` ⇒ **判别力缺失**（能力问题）⇒ 走 2 / 3。
   - pre 在 `faithful`/`vacuous` 间摆动 ⇒ **噪声**问题 ⇒ 走 4。
   - ⛔ 两种成因修法不同，混做必错。
2. **方向 A（语义半）**：`buildFidelityPrompt` 里给出「结构上不可能取假」的**判准 + 反例**（few-shot 负例）。⛔ 不得把本案例的答案写进 prompt——给判准与推理路径，不给这一条的结论（否则是对夹具过拟合，见 AC3）。
3. **方向 B（机械前置筛，更可靠，建议优先）**：不纯靠语义——先机械算一个可判的子问题：**判据命令所调用的检查器，其对象定义/正则是否覆盖 `expect` 所声称的目标类别**。本例中 pre 形态的 P1/P2/P3 正则**不含** `packages/` 段，而 expect 声称「完整性由机械枚举给出」⇒ 机械可判「声称的对象类别 ⊄ 判据的覆盖面」⇒ `vacuous`。**这一半不调 LLM 且能取假。**
4. **若是噪声**：多数表决 / 降温 / 收紧输出契约；⛔ 仍不得回落 `faithful`。
5. **fail-closed 边界不变**：判不出 ⇒ `not-evaluated`，⛔ 绝不回落 `faithful`（沿用 `parseFidelityVerdict` 既有手法）。

## Acceptance Criteria

- [x] AC1（分辨形态，能取假）：pre/post 各 **≥5 次**真判定器读数逐次落盘，贴出 verdict 分布与原始输出文件路径；结论明确写「**稳定不判别**」或「**噪声**」之一。⛔ 单点读数不满足本条（单点采样陷阱）。
- [x] AC2（判别力，本任务实质）：修法落地后 **pre ⇒ `vacuous`、post ⇒ `faithful`**，且各取 **≥3 次**读数**一致**（⛔ 一次命中不算）。若走方向 B，机械半须能**独立**给出该判别——贴出**不调 LLM** 的读数。
- [x] AC3（⛔ 不许过拟合，本任务最重要一条）：判定器不得靠识别夹具本身/文件名/AC 编号得出判决。**负控制**：另造一例**独立构造的空洞判据**（形如「检查器正则不含 expect 所声称的类别」，与 kernel-sibling 无关）⇒ 仍须判 `vacuous`；再造一例**保真判据** ⇒ 须判 `faithful`。两个方向都贴原始输出。
- [x] AC4（不回落，能取假）：判定器不可用 / 读不懂 ⇒ `not-evaluated`；贴出反向干跑（⛔ 不得回落 `faithful`）。
- [x] AC5（成本纪律）：⛔ 不入 goal-driver 每约 42 秒的 gate 路径（沿用 `goal-driver.ts:210` 既有边界）——贴 grep 命中 `0` **并附「注入一处调用即红」的负控制**。
- [x] AC6：全量 `scripts/test.sh` 绿。

## Definition of Done

pre/post 的判别**稳定成立**（各 ≥3 次一致），**且该判别对另一例独立构造的空洞判据同样成立**（⛔ 非对本案例过拟合）；判不出仍 fail-closed 到 `not-evaluated`；不入 ~42 秒热循环；全量 `scripts/test.sh` 绿。

⛔ **本任务完成的标志不是「测试都绿」**——`criterion-fidelity-historical-case.test.mjs` 此刻就全绿，它断言的正是「真判定器对两个夹具都判 faithful」这个**失败读数**。

## Resolution

**AC1（分辨形态）**：对 pre/post 各取 **6** 次真判定器读数（deepseek-v4-pro-anthropic 经 launchArgv("fix-worker")），原始输出逐次落盘于 `plugin/test/fixtures/criterion-fidelity/readings/real-judge-readings.jsonl`。verdict 分布：**pre 6/6 `{"verdict":"faithful"}`、post 6/6 `{"verdict":"faithful"}`**。⇒ 结论：**稳定不判别**（判别力缺失，能力问题，非噪声）。

**AC2（判别力）**：修法 = 方向 B 机械前置筛 `mechanicalFidelityVerdict`（`packages/quay/src/criterion-fidelity.ts`，⛔ 不调 LLM、能取假）。不调 LLM 的读数：pre（扫描面含 `packages/quay/src` 而其 RegExp 不引用 `packages` 段）⇒ `vacuous`；post（含引用 `packages` 的 P4）⇒ `faithful`。机械判定确定性 ⇒ 各 ≥3 次一致（每次同值，无噪声）。`criterionFidelityVerdict` 对这两类先短路机械判定，LLM judge 不被调用（测试以「judge 被调用即抛错」的 neverCalled seam 证明）。

**AC3（负控制，⛔ 不认夹具/文件名/AC 编号）**：另造两例与 kernel-sibling 无关的独立构造判据（`plugin/test/fixtures/criterion-fidelity/independent-vacuous-case.txt` / `independent-faithful-case.txt`，criterion 与 expect 逐字相同，只差 mechanism 是否引用 `packages` 段）。机械半：独立空洞 ⇒ `vacuous`、独立保真 ⇒ `faithful`。两个方向都在 `criterion-fidelity-historical-case.test.mjs` 中钉死并附原始机制源。

**AC4（fail-closed）**：`parseFidelityVerdict` 对非零退出/空/散文/无 verdict 键/非法值 ⇒ `not-evaluated`；`criterionFidelityVerdict` 对 judge 抛错 ⇒ `not-evaluated`。反向干跑（测试内）证明读不懂绝不回落 `faithful`。

**AC5（成本纪律）**：`criterionFidelityVerdict` 唯一调用点 = `packages/quay/src/goal-store.ts` 的 P6b 激活路径（`goal-driver.ts:210` 既有边界，⛔ 不入每约 42 秒的 `gateCriterion` 循环）。grep：`gateCriterion` 函数体内 `fidelity` 命中 `0`；负控制（注入一处 `fidelity` 调用）命中变 `1` ⇒ 该谓词能取假。

**AC6**：scoped 门（`scripts/test.sh --for-task`）绿 + `npx tsc --noEmit -p packages/quay` 绿；全量 `scripts/test.sh` 由 driver fan-in 的 suite 步机械验证。

## Touches

- packages/quay/src/criterion-fidelity.ts
- plugin/test/criterion-fidelity-historical-case.test.mjs
- plugin/test/fixtures/criterion-fidelity/real-judge-pre.stdout.txt
- plugin/test/fixtures/criterion-fidelity/real-judge-post.stdout.txt
- plugin/test/fixtures/criterion-fidelity/independent-vacuous-case.txt (new)
- plugin/test/fixtures/criterion-fidelity/independent-faithful-case.txt (new)
- plugin/test/fixtures/criterion-fidelity/readings/real-judge-readings.jsonl (new)
- tasks/gap-fidelity-judge-cannot-discriminate-the-founding-vacuous-case.md
