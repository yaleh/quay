---
id: gap-b15-pool-quality-judge-state-persist
title: B15 pool-quality-judge 完成态不持久化——读端在、写端缺，触发器恒 fire
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

**B15（pool-quality-judge 完成态不持久化 —— outer 2026-08-14 05:2xZ 发现，manager 裁定属 B3-戊族「永远响」）**。

**症状**：`.quay/pool-quality-judge-state.json`（`readLastJudgeRound` 的 `lastRound` 源）**不存在**，全仓 **2 处**命中 `pool-quality-judge-state` **都在 `pool-quality-judge.ts` 且都是读**（`:202` 注释、`:204` 路径）——**无写者**。`readLastJudgeRound:205` 逐字 `if (!fs.existsSync(p)) return 0` ⇒ `roundsSinceLastJudge = currentRound - 0 = currentRound` ⇒ **恒 ≫ 10 ⇒ 每 tick 恒 fire**。判过一次（outer 05:07 启动 workflow，05:09 完成判词记 tick-log）**没有让触发器重置**——每次假动作 ≈ 60 万 token / 8 agents / 214s。

**归属（manager 2026-08-14 裁定，B3-戊族）**：**不是 AC73 族**。区别在【谁坏了】：AC73 族=产出无消费者（输出在、无人读——零 reader/零 caller/按需/--no-block）；**本条=消费者在读、被读的量从不更新（条件恒真、永远响）**。manager 核内 B3-戊逐字：「**恒真使它【永远触发】——而戊的强制动作是「分诊+派发」，即一个恒定的、无对象的动作要求**」「**前提失效有两个方向：永不响 vs 永远响，后者更贵，因为它持续制造假动作**」。**本条是「后者更贵」的一次带价签的实证**（每次假动作 ≈ 60 万 token）。发生率 n=2（manager B3-戊今日已修 `7e34efe3` + 本条）⇒ **记为观察项，不造检测器**；但【这一个实例本身】要修——**不是新机制，是把一个只做了一半的机制补完**（读端在、写端缺）。立普通任务即可，不必挂 AC。

**判据（补写入端 + 显式回答 fail-open）**：
- **判据1（写端补齐）**：judge 完成时写 `.quay/pool-quality-judge-state.json`，`lastRound` = 当前 verification-round ⇒ 下次 `--plan` 的 `roundsSinceLastJudge` = 实际距上次 judge 的轮数，触发器在 10 轮内不 fire。
- **判据2（fail-open 三态，硬规则 3b）**：`readLastJudgeRound` 缺文件时的返回值**显式回答**——「没有输入」不得与「该跑了」同形（缺文件 fire 是 fail-open，会把「从没判过」当「该跑」；但「从没判过」第一次本来也该 fire）——**任务体必须写明三态语义**：缺文件 / 有文件 lastRound 有效 / 有文件 lastRound 损坏（JSON 解析失败），各归 fire 或 NOT-EVALUATED，且 NOT-EVALUATED 不得与 fire 同形。
- **判据3（能取假·真样本，D2 不构造）**：**本次真实触发回放**——05:07 判过一次后，05:22 的 `--plan` 仍报 `roundsSinceLastJudge=167`、`fired=true` ⇒ 写端补齐前回放必须红（判据1 不满足）；补齐后同回放必须绿。
- **判据4**：不新造检测器（n=2 门槛未到）；不并 AC73（不同族）。

**止损（C21，outer 已判）**：**本 tick 不重调**——13 分钟前刚跑完、pool 几乎相同、判词不变，重调代价 60 万 token。**⚠️ 绑此读数**：若 pool 实质变化（新任务入池 / deficit 明显移动）而写入端未补，「不重调」失效，需重判。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 `pool-quality-judge.ts` `readLastJudgeRound`(:202-205) + `--plan` 触发计算(:258-260) + workflow 完成路径(.claude/workflows/pool-quality-judge.js 末尾 return)。
2. 判据1：judge 完成写 `.quay/pool-quality-judge-state.json`（lastRound=当前 verification-round）——写入点取 workflow 完成路径或 `--aggregate`（实现面定，但要单写者）。
3. 判据2：`readLastJudgeRound` 缺文件/损坏文件三态语义写进任务体（fire / NOT-EVALUATED 可区分），不在代码里留未注意的默认值。
4. 判据3：05:07 判过后 05:22 仍 fire 的真样本回放——写端补齐前红、补齐后绿。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：judge 完成写 lastRound 到 `.quay/pool-quality-judge-state.json`，下次 `--plan` roundsSinceLastJudge 反映实际轮距、10 轮内不 fire。
- [ ] AC2 判据2：`readLastJudgeRound` 缺文件/损坏文件三态语义显式写进任务体（fire / NOT-EVALUATED 不得同形，硬规则 3b），不留未注意默认值。
- [ ] AC3 判据3 能取假：05:07 判过→05:22 仍 fire 真样本回放——写端前红、写端后绿（D2 不构造）。
- [ ] AC4 不新造检测器（n=2 未到门槛）；不并 AC73（不同族）。
- [ ] AC5 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] pool-quality-judge 写端补齐（lastRound 持久化）+ fail-open 三态语义显式化 + 真样本回放红→绿。

## Touches

- plugin/scripts/pool-quality-judge.ts（写端 + `readLastJudgeRound` 三态）
- .claude/workflows/pool-quality-judge.js（完成路径写 lastRound——若写入点在此）
- .gitignore（`.quay/pool-quality-judge-state.json` 运行时状态文件）
- （负控制 fixture + 真样本回放）
- tasks/gap-b15-pool-quality-judge-state-persist.md（自身）

## Evidence

（落地后回填）
