---
id: gap-semantic-observer-judge-stopped-awaiting
title: 'inner/outer 语义观测器——schema 字段只承载预先想到的需求类型，真实需求溢出到自由文本（心跳 reason 逐字「BUDGET HIT, dispatch stopped, awaiting /clear」而 blocked=[] 被清空、字段失效）；judge 读自由文本输出 {stopped, awaiting, needs, contradictsStructured, confidence}；触发=文本 hash 变化或 blocked==[] && agentDispatches>=agentLimit；产物=stopped:true 而 tick-log 无升级 ⇒ 变红（AC41③）'
status: todo
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

**inner/outer 的【语义观测器】。schema 字段只能承载【预先想到的】需求类型；真实需求会溢出到自由文本；机械读数看不见自由文本。今晚活体实证：`.quay/inner-wakeup-heartbeat.json` 两次写入，结构化字段说「无阻塞、预算不危急」，自由文本 `reason` 说「我完全停了，在等 `/clear`」。**

### 实证（manager 2026-08-10 11:3x 规格 + outer 复核原始记录）

- **11:13 版 heartbeat**：`blocked=[merge-conflict ×2]`、`budgetCritical=True`（outer 复核当时：字段名 `budgetCritical`）、`agentDispatches=201/agentLimit=200`。
- **11:28 版 heartbeat**（outer 复核当前文件）：`blocked=[]`、`budgetHit=true`（字段已改名）、`agentDispatches=201/agentLimit=200`，**自由文本 `reason` 逐字**：「tick heartbeat — **BUDGET HIT (200/200, dispatch stopped, awaiting outer /clear)**; conflicts handed to outer suite-fix (blocked cleared); AC41-③ queued post-budget-reset」。
- **矛盾**：机械字段 `blocked=[]` + `budgetHit=true` 说「无 merge-conflict 阻塞、预算已触顶」——但**「预算触顶」不是 `blocked` 想表达的那类阻塞**（`blocked` 是 merge-conflict 的槽位，转交后被清空）。真实状态「**我完全停了，派发停止，在等 outer /clear**」只存在于 `reason` 自由文本。
- **manager 11:2x 刚把 A3 改成读结构化字段**——若只读它们，下一轮会【再次】判「inner 无需支持」，且这次连怀疑的由头都没有。
- **三字段今晚各自失效**：`blocked[]` 转交后被清空（状态对，但「我因此不能派」没了）；`budgetCritical/budgetHit` 字段本身不可靠（True→改名→字段语义漂移）；`reason` 是唯一说清「停了/等谁/等什么」的地方，**而它不在任何机械判据里**。

**为什么重要**：这是 C17 / AC41③（不做会变红）在观测层的实例——schema 结构化字段是「预先想到的需求类型」的有限集合，真实需求必然溢出。机械读数把「读不到」当成「不存在」。今晚 inner 停 2.5h 我未发现，正是因为只读结构字段。

### 规格（四项）

1. **源 = 自由文本**：心跳 `reason` + 该层 tick 报告全文（transcript）。**pane 不用**（今晚三次不可靠：裸词 `Allow` 假阳性、`statusArea` 取最后两行被 agent 列表挤掉、agent 列表折叠致 `◯`=0）。
2. **判断 = schema'd judge**：输出 `{stopped:bool, awaiting:{who,what}, needs:[{what,owner,blocking,evidence}], contradictsStructured:bool, confidence}`。**`contradictsStructured` 是关键字段**——它就是本次失效的名字（结构化字段与自由文本矛盾）。
3. **触发 = 不是每轮**（成本）：自由文本内容 hash 变化 **或** 机械字段与自由文本可能不一致的启发式（如 `blocked==[] && agentDispatches>=agentLimit`——**正是本次形态**）。
4. **产物须满足 AC41③**：judge 输出 `stopped:true` 而本轮 tick-log 无对应升级记录 ⇒ 变红。

**形态**：subagent + schema 即可，不必 workflow（参考 `nyf-semantic-judge` 一步判断的成功先例）。**prompt 必须动作化（AC41 判据①）并钉死「读自由文本，不得只读结构化字段」**——否则退化成错误的自动化版本。三层对称：`--layer inner|outer`（manager 侧 manager 自己用）。

**优先级裁定（outer 2026-08-10）**：`delivery-critical`。理由：它直接防止今晚的失效类（漏看 inner 停止），且是 AC40（L2 可观测）与 AC41③（变红产物）的执行体。排在 AC37/38 之前——但 AC37 已 fan-in、AC38 是文档切分，本任务与它们不冲突，可按 delivery-critical 轴与 AC41 三条同批推进。

**验证锚**：修后 (a) judge 对今晚心跳输出 `stopped:true, awaiting:{who:outer, what:/clear}, contradictsStructured:true`；(b) `stopped:true` 而 tick-log 无升级 ⇒ 变红；(c) `--layer inner|outer` 均可用。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录心跳 11:13/11:28 结构化 vs 自由文本矛盾实证（blocked=[]+budgetHit 说无阻塞，reason 说「停了等 /clear」）+ 三字段失效（本任务 Proposal 已含）
- [x] AC2: **judge 实现**——schema'd judge 输出 `{stopped, awaiting, needs, contradictsStructured, confidence}`；读自由文本（reason + tick 报告），不只读结构化字段
- [x] AC3: **触发条件**——自由文本 hash 变化 **或** `blocked==[] && agentDispatches>=agentLimit` 启发式触发（不是每轮）
- [x] AC4: **变红产物（AC41③）**——judge `stopped:true` 而本轮 tick-log 无对应升级记录 ⇒ 变红
- [x] AC5: **三层对称 + 既有不回归**——`--layer inner|outer` 可用；`--for-task` scoped 门绿

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 修后实跑：judge 对今晚心跳输出 stopped/awaiting/contradictsStructured（贴输出）；变红触发
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped：54 tests / 0 fail / 0 cancelled / EXIT 0；重建于 integration 顶后含 integration 新增 catalog 测试）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

### 修后实跑证据（2026-08-10，takeover subagent）

**judge 对今晚心跳（`--layer inner`，读自由文本）**：

```json
{
  "layer": "inner",
  "stopped": true,
  "awaiting": { "who": "outer", "what": "/clear" },
  "needs": [ { "what": "/clear", "owner": "outer", "blocking": true, "evidence": "awaiting outer /clear" } ],
  "contradictsStructured": true,
  "confidence": 0.727,
  "readFreeText": true,
  "trigger": { "fired": true, "heuristic": true, "hashChanged": false, "hash": "4cbde09d0396198c" },
  "redOnOmission": false
}
```

**变红触发**：同一心跳 + tick-log 无升级记录 ⇒ `redOnOmission:true` 且 **exit 1**（AC41③）；tick-log 有 `escalate` 行 ⇒ `redOnOmission:false` 且 exit 0。

**触发启发式（AC3）**：`blocked==[] && agentDispatches(201)>=agentLimit(200)` ⇒ `semanticTriggerHeuristic=true`；hash 变化独立触发；hash 不变 + heuristic 假 ⇒ 不触发（不是每轮）。

**三层对称（AC5）**：`--layer inner` 与 `--layer outer` 均输出完整 schema（`plugin/test/semantic-observer-judge.test.mjs` AC5 用例逐层断言）。

## Touches

- plugin/scripts/semantic-observer-judge.ts（新 judge：读自由文本输出 schema'd 判定）
- plugin/test/semantic-observer-judge.test.mjs（AC1-AC5：今晚心跳 fixture 断言 + 触发 + 变红）
- orchestration/orchestrator-tick-core.md（A 段 A17：judge 触发 + 变红记录）
- plugin/scripts/inner-wakeup-heartbeat-check.ts（AC3：触发启发式接线）
- plugin/scripts/capability-catalog.sh（新 judge 入 catalog——AC1c 门：artifact 新脚本须声明所答问题）
- orchestration/manager-phase-goal.md（AC40/AC41③ 交叉标注——同域）
- tasks/gap-ac41-red-on-omission-artifact.md（交叉标注——变红产物判据）
- tasks/gap-semantic-observer-judge-stopped-awaiting.md（自身：勾 AC + 贴证据）

## Contract

measure   judge_detects_stopped = `node --no-warnings --experimental-strip-types plugin/scripts/semantic-observer-judge.ts --layer inner --root "$PWD" --json` 的 stdout 中 stopped 布尔
band      judge_detects_stopped = true（对今晚心跳：stopped:true, awaiting:{who:outer,what:/clear}, contradictsStructured:true）
invariant judge_reads_free_text = 1（读 reason + tick 报告，不只结构化字段）
invariant stopped_without_escalation_red = 1（stopped:true 而 tick-log 无升级 ⇒ 变红）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/semantic-observer-judge.ts --layer inner --root "$PWD" --json`（贴 judge 输出）
control   judge 抓 stopped；读自由文本；变红触发；三层对称
resume    judge / 触发 / 变红产物分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: manager 规格（人方向裁定「基于语义的观测，源=transcript 非 pane」）。实证：心跳 11:13/11:28 结构化 vs 自由文本矛盾（blocked=[]+budgetHit 说无阻塞，reason 说「停了等 /clear」）——outer 复核原始记录确认，字段实为 budgetHit=true。judge 读自由文本输出 stopped/awaiting/needs/contradictsStructured；触发=hash 变化或 blocked==[] && agentDispatches>=agentLimit；产物=stopped 无升级即变红（AC41③）。优先级=delivery-critical（防今晚失效类）。实现归 inner
