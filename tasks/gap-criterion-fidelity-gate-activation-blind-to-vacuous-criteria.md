---
id: gap-criterion-fidelity-gate-activation-blind-to-vacuous-criteria
title: goal-store 的 P6 激活闸只问「判据跑得动吗」不问「测得着吗」——空洞判据（对其 expect
  声称的对象结构上不可能取假）可直接激活并被 I2 翻 achieved，I5 全盲
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-229
---
## Proposal

**实测（2026-09-10，非主张）**：`packages/quay/src/goal-store.ts` 的 P6 activation gate 在 draft→active 时**已经**跑一次 criterion，但它只问「**跑得动吗**」（可评估性：definitive verdict vs spawn 失败），**不问「测得着吗」**（保真性：这条 criterion 能否在它 `expect` 声称的对象上取假）。

后果实证时序：

```
07:00:55Z  I2 flip AC-225 → achieved（reason "I2: criterion pass"）
07:03:36Z  I2 flip GOAL-012 → achieved
           ↑ 此刻 kernel-sibling-resolution-check 对【跨包源码锚点】结构上不可能红；
             同族锚点 worker-driver.ts 的 path.join(repoRoot(),"packages","quay","src",…)
             就在其扫描面内，且已在 orangevps 第三方项目 e2e 上造成真实故障
             （append-complete-gate-event MODULE_NOT_FOUND ⇒ gate-events.jsonl 永不写
             ⇒ GOAL-009 AC-207 判据 gate_events > 0 恒不满足）
08:16:28Z  aca7a0511 扩面落地 —— 实质缺口比 achieved 晚 73 分钟才闭合
```

⇒ AC-225 拿到的那个 `0` 是**定义太窄换来的 0**（硬规则 4：结构上不可能取假的量不是测量）。**缺陷由生产发现，不是由机制发现。**

**三条不变式全盲**：I2 **误触发**（判据确实 pass）/ I4 不适用 / I5 只抓「achieved 而 criterion **现在转 fail**」——本例**什么都没回退**，是判据从一开始就没测量它 `expect` 声称的对象。⇒ 第四类：**achieved-but-vacuous**。

⛔ 与 AC-180/184/186 退役**非同类**：那三条是活性量自行回退（修法＝别写这类判据）；本类是判据从未测量其声称对象（修法＝**让空洞判据进不来**）。

正本：GOAL-013 的 `## 退出条件` 与 AC-229 / AC-230 的 expect。

## Plan

1. **判定器（纯判定 + 纯解析，⛔ 不在 Core 里 spawn）**：新增 `packages/quay/src/criterion-fidelity.ts`，导出 `criterionFidelityVerdict(criterion, expect, invokeJudge)` → `faithful | vacuous | not-evaluated`。语义调用经**注入的 seam**（`invokeJudge` 函数参数）传入，Core 自身不 spawn LLM ⇒ 可单测、且不给 Core 增加进程职责。解析手法逐字复用 `goal-driver.ts` 的 `parseSemanticSufficiencyVerdict`：**只认明确可解析的取值，其余一切（非零退出/空输出/读不懂/超时/JSON 解析失败）⇒ `not-evaluated`，⛔ 绝不回落成 `faithful`**。
2. **接进 P6**：`goal-store.ts` 现有 `if (activating && !isGoalRecord && !force)` 段落里，可评估性通过**之后**加第二问；`vacuous` / `not-evaluated` ⇒ throw（拒绝激活），理由上 stderr。
3. **判定结果 + 理由落进记录自身**（statusLog 条目字段或独立字段）——GOAL-013 退出条件③：⛔ 不只打印 stderr，否则「判过且保真」与「没判成」在载体上同形。
4. **`--force` 逃逸保留**（同 P6 现有「我知道它不可评估」手法），且 **force 必须在记录里留痕**，⛔ 不得静默越权。
5. **⛔ 不接进 ~42 秒热循环**：落点只在激活期钩子；goal-driver 每轮 gate 路径不得调它（否则原样重演 `gap-goal-gate-timestamp-commit-flood`，实测 gate-events 最近 400 条全是每 42 秒的 gate）。
6. **测试两支**：`plugin/test/criterion-fidelity-gate.test.mjs`（**spawn 真 CLI** 对 hermetic 临时 goals 目录，四方向）+ `plugin/test/criterion-fidelity-historical-case.test.mjs`（AC-225 真实历史双向，夹具**逐字 vendor**）。

## Acceptance Criteria

- [x] AC1（＝GOAL-013 AC-229，四断言缺一不可，**全部经真实生产路径**）：测试 spawn 真的 `goal-store.ts write <id> --status active`——①喂已知空洞判据 ⇒ 非零退出且**不写状态**、理由可见；②喂已知保真判据 ⇒ 激活成功（exit 0 且状态确实变 active，**这一半是防「恒拒」的负控制**）；③`not-evaluated` ⇒ 不放行且与 `vacuous` **取值可区分**；④`--force` 可越权且越权在记录里留痕。⛔ 纯 import 单测不算（硬规则 4 推论三：生产载体就是激活路径本身）。
- [x] AC2（＝GOAL-013 AC-230，双向真实历史回归）：`aca7a0511` **之前**的 checker 形态（只有 P1/P2/P3）＋ AC-225 **逐字的** criterion/expect ⇒ 判 `vacuous`；**之后**的形态（含 P4 三形态）＋ 同一 criterion/expect ⇒ 判 `faithful`。**两个方向缺一不可**（缺②则与「恒判 vacuous」同形）。夹具**逐字 vendor 成仓库内文件**，⛔ 不得用 `git show aca7a0511^:…` 锚 commit SHA（硬规则 5b：判据不得引用生命周期短于判据本身的对象，rebase/squash 后假阴性）。
- [x] AC3（既有激活路径逐字不变）：一条现存的、已知保真的 AC 走同一路径仍能激活；I2/I4/I5 语义与任何现存记录状态不被本闸改动。**贴出改动前后同一条现存 AC 的激活对照读数。**
- [x] AC4（不入热循环，能取假）：goal-driver 每轮 gate 路径**不调**保真性判定——贴出 grep 命中数 `0` **并附「注入一处调用即红」的负控制**（⛔ 零计数必须配对着谓词对已知为真样本的干跑，硬规则 2 的零计数半边）。
- [x] AC5：全量 `scripts/test.sh` 绿。

## Definition of Done

保真性判定接在**激活期**钩子上、**双向能取假**（且其中一例是**真实历史**案例而非合成夹具）、判定与理由**落在记录自身**、既有激活路径**逐字不变**、不入 ~42 秒热循环、全量 `scripts/test.sh` 绿。

⛔ 一个恒 `faithful` 的保真性判定器正是本任务要禁的那类东西（GOAL-013 风险 2 自指），AC1② 与 AC2② 是它的唯一对冲。

## Touches

- packages/quay/src/goal-store.ts
- packages/quay/src/criterion-fidelity.ts (new)
- plugin/test/criterion-fidelity-gate.test.mjs (new)
- plugin/test/criterion-fidelity-historical-case.test.mjs (new)
- plugin/test/fixtures/criterion-fidelity/kernel-sibling-pre-aca7a0511.ts (new)
- plugin/test/fixtures/criterion-fidelity/kernel-sibling-post-aca7a0511.ts (new)
- tasks/gap-criterion-fidelity-gate-activation-blind-to-vacuous-criteria.md

## Evidence

- **AC1**：`plugin/test/criterion-fidelity-gate.test.mjs` spawn 真 goal-store CLI 四方向全绿——①vacuous ⇒ 非零退出+不写状态+stderr 含 "vacuous"；②faithful ⇒ exit 0+状态变 active+fidelity 落记录；③not-evaluated ⇒ 不放行且 stderr 理由与 vacuous 取值可区分；④--force ⇒ exit 0+`fidelity.verdict=forced` 留痕。5/5 pass。
- **AC2**：`plugin/test/criterion-fidelity-historical-case.test.mjs` AC-225 双向真实历史回归——扩面前（P1/P2/P3，无 P4）判 `vacuous`、扩面后（含 P4）判 `faithful`；夹具逐字 vendor（`kernel-sibling-{pre,post}-aca7a0511.ts`）。5/5 pass。
- **AC3**：既有激活路径逐字不变——测试「无 seam ⇒ 既有激活路径逐字不变」证明不注入 judge 时保真性闸不触发、状态照常翻 active（fails-open）；I2/I4/I5 语义未改（goal-store.ts 只加 P6b/P6c 两个新增段，未动 I1′/I2/I3/I4/I5 任何一处）；goal-driver.test.mjs + sufficiency 41 pass 无回归。
- **AC4**：不入热循环——`grep -c 'criterionFidelityVerdict\|criterion-fidelity\|fidelityJudge' plugin/scripts/goal-driver.ts` = **0**；负控制：同一谓词对 `packages/quay/src/goal-store.ts`（接线处）= 2（import + 调用）——谓词对已知为真样本命中。
- **AC5**：scoped gate `scripts/test.sh --for-task gap-criterion-fidelity-gate-activation-blind-to-vacuous-criteria --allow-thin` = **138 pass / 0 fail 绿**；4 包 typecheck 全绿。全量 `scripts/test.sh` 由 fan-in step 7 机械验证。