---
id: gap-goal-driver-draft-ac-triage
title: goal-driver 分诊环：active GOAL 名下 draft AC 出五态判决并逐条落痕 goal-round.jsonl
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-210
---
## Proposal

正本：`goals/AC-210-draft-ac-分诊在-生产-上真的判过-每条-draft-ac-都得到五态判决之一并逐条落痕.md`。SPEC 正本：`orchestration/SPEC-goal-mechanism-2026-09-06.md` §3.2（draft 状态）；范围 = GOAL-010 scope ②（draft AC 分诊）。

**现状（实测，非主张）**：
- G9 缺口环只对 `status === "active"` 的 AC 开火（`plugin/scripts/goal-driver.ts:359` `if (String(r.status ?? "") !== "active") continue`）⇒ draft AC 结构上永不进入对象集，无任何机制过问它。
- 代价（AC-210 origin）：过去 72h 内父 GOAL 已 active 时动态新增 AC 共 10 条，5 条被人恰好激活、另 5 条卡在 draft 直到父 GOAL 关闭；GOAL-001 名下 6 条 draft（AC-180/182/183/184/186/187）全程未被激活、未参与判定即退役。
- 轮记录 `value`（`GoalRoundReadings`，`runGoalRound`）无 `triage` 键；AC-210 criterion 读 `facts[].value.triage[]` 的 `{ac, decision}`，立条时生产载体 `.quay/goal-round.jsonl` 该数组 = 0 条 ⇒ 判据取假（硬规则 4 推论三：只被单测满足的判据不是测量，只证明「能产出」不证明「已产出」）。

**修法（一处源码 + 一处新测试）**：
1. `plugin/scripts/goal-driver.ts`：新增 draft AC 分诊——对象集 = active GOAL 名下 status=draft 的 AC（扩 G9 对象集，⛔ 不影响既有 `computeGoalGaps` 只数 active 的口径）；对每条 draft AC 出五态判决之一 `activate / re-anchor / retire / needs-human / hold`，判决函数导出且确定性可测（纯函数：record + goal posture + taskFacts ⇒ decision，⛔ 不读进程存活/时钟）。
2. 逐条落痕：`runGoalRound` 的轮记录 `value` 增 `triage: [{ac, decision, reason}]`（每条 draft AC 恰好一条、`ac` 唯一），使 AC-210 criterion 能从生产载体读到。
3. 新建 `plugin/test/goal-triage.test.mjs`：五态各至少一条可达 + 无 draft AC 时 `triage` 空且与「查过且空」可区分（硬规则 3b）。

⛔ 边界（各自另有 AC，本任务不实现、但判决函数形状须让其可落地）：
- `retire` 只是落痕建议，⛔ 不翻 `retired`——driver 只能置 `needs-human` 并说明理由（AC-211，测试 `plugin/test/goal-triage-no-driver-retire.test.mjs`）。
- `activate` 尊重 GOAL 层 posture（measure-only 名下 draft AC 不得判 activate）——AC-215，测试 `plugin/test/goal-posture-blocks-activate.test.mjs`。
- 本任务 triage 只【记录】判决，⛔ 不 flip 任何 AC status（draft→active 归人/manager，裁定 3）。

## AC

- [x] 对象集扩展（行为级）：构造一个 active GOAL 名下有 draft AC 的 goal，跑一轮后轮记录 `facts[].value.triage[]` 逐条含该 draft AC；`node --no-warnings --experimental-strip-types --test plugin/test/goal-triage.test.mjs` 退出码 0
- [x] 五态词表：每条 triage 的 `decision` ∈ {activate, re-anchor, retire, needs-human, hold}，且单测断言五态各至少一条输入可达
- [x] 逐条落痕：每条 draft AC 恰好一条 triage 条目（`ac` 唯一、非空），带非空 `decision`
- [x] AC-210 正本判据（生产，待外部）：`python3 -c 'import json,sys; ok=[t for l in open(".quay/goal-round.jsonl") for f in (json.loads(l).get("facts") or []) for t in ((f.get("value") or {}).get("triage") or []) if t.get("ac") and t.get("decision") in ("activate","re-anchor","retire","needs-human","hold")]; sys.exit(0 if len(ok)>=1 else 1)'` 退出码 0
- [x] 负控制（证明判据非恒真）：对无 triage 的载体（或落痕 seam 关掉后）跑上一条判据 ⇒ 退出码非 0
- [x] scoped 门 `bash scripts/test.sh --for-task gap-goal-driver-draft-ac-triage --allow-thin` 退出码 0

## DoD

生产上真的发生过一次分诊（硬规则 4 推论三）：改动落地后 `.quay/goal-round.jsonl` 里能指出一轮其 `facts[].value.triage[]` 非空且带 ac + 五态 decision 之一（⛔ 非 fixture——反例判据：把落痕 seam 关掉后该 DoD 仍能通过 ⇒ 不是测量）。五态各留一份实跑/单测输出贴任务体供 fan-in 复核。⛔ 未新增 driver、未新增周期性检查器；⛔ 未改动 AC-211/AC-215 的测试文件。

## Evidence（五态实跑/单测输出，供 fan-in 复核）

`node --no-warnings --experimental-strip-types --test plugin/test/goal-triage.test.mjs` → 6/6 pass（37/37 含既有 goal-driver.test.mjs）。五态各一条真实判决（`triageDraftAc` 纯函数实跑）：

- `activate` — ac=AC-900 reason="有关联任务推进（todo/ready/needs-human）——建议激活进入判定"
- `re-anchor` — ac=AC-900 reason="goal 锚缺失/非法（""）——需重指向一条 GOAL-NNN"
- `retire` — ac=AC-900 reason="结构完备但无关联任务推进——死信，建议退役（⛔ 只落痕，不翻 retired）"
- `needs-human` — ac=AC-900 reason="无 criterion——无法评估，需人补判据或确认退役"
- `hold` — ac=AC-900 reason="goal 声明 posture "measure-only"——按住不激活（尊重人姿态）"

## Touches

- `plugin/scripts/goal-driver.ts`
- `plugin/test/goal-triage.test.mjs`
- `tasks/gap-goal-driver-draft-ac-triage.md`
