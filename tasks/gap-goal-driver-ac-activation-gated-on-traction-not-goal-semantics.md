---
id: gap-goal-driver-ac-activation-gated-on-traction-not-goal-semantics
title: goal-driver 的 AC 激活判据是"有没有任务牵引"而非目标语义——与立案机制互为前提，构成无出口的循环依赖
status: done
labels:
  - gap
  - defect
  - meta-driver
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**结构性发现（已实测核实，非推测）**：一条 `draft` 且无关联任务的 AC，在当前机制下**没有任何自动路径能变成 active**：

- `triageDraftAc`（plugin/scripts/goal-driver.ts）的 `activate` 分支要求 `hasTraction` —— 必须已存在 `goal_ac` 指向该 AC、且处于 todo/ready/needs-human 的任务；否则落到兜底分支判 `hold`。
- 而立案机制 `computeGoalGaps` 的第一道过滤就是 `if (String(r.status ?? "") !== "active") continue` —— **只为 active 的 AC 计缺口**；下游 `gaps.filter(g => g.state === "gap")` → `spawnGapWorker` 因此只会给 active 的 AC 立任务。

⇒ 要 active 得先有任务；而给它立任务的机制只看 active。环无出口，唯一破法是人手写 `--status active`。triage 那句 hold 理由"待人工激活/补任务"不是建议，是构造上的唯一出口。

**语义论点**：`active` 的含义是"这条件计入该 GOAL 的达成判定"，这是关于**目标定义**的陈述；"有没有人排了工作"是下游调度事实，回答的是*怎么满足*而非*算不算数*。用后者决定前者，等价于"只把已经决定要做的条件算进要求里"——**一个 GOAL 只要对不方便的条件始终不立任务，就能干净地关闭**。失败方向是反的：保守默认应为"计入，除非显式退役"。这在形态上重演了 GOAL-010 自己要修的 draft 死信缺陷（参见已 done 的 gap-goal-driver-draft-ac-invisible-yet-blocking 的"三头不占"），只是更隐蔽。

**整类盲区**：观测/验证型 AC（判据只需随时间累积生产证据，无物可实现）天然永远不会产生 traction，被这条规则结构性地排除在自动激活之外——而这正是硬规则「推论三」认定最重要的一类（"AC 必须至少有一条【读生产载体】"）。GOAL-011 的 AC-220/AC-221 就是实例：二者是该 GOAL 退出条件②③本身，却因无任务而被判 hold，最终靠人手工激活才进入判定。

**与人的裁定的关系**：裁定原文是「晋升应当是语义的」（且已解除"暂不做自动晋升"的"暂"）。而当前实现选的判据"有没有任务"是一个**记账事实**，不是语义判断。裁定要的与实现给的之间差了这一层。

**两个概念本有各自机件**：`computeGoalGaps` 的四态（in-progress / gap / stalled / done-unresolved）就是专门读"有没有牵引"的；该读数应驱动**立任务与报停滞**，不应驱动**是否纳入判定**。

## Plan

把激活判据从"任务是否存在"改为"这条 AC 作为判据是否就绪"，即 `triageDraftAc` 保留前三道闸、只改兜底分支：

1. `re-anchor`（goal 锚缺失/非法）—— 原样保留。
2. `needs-human`（criterion 缺失/空 ⇒ 无法评估）—— 原样保留。这也是"半成品 AC 不该悄悄按住"的正确归宿。
3. `hold`（goal 声明 posture）—— **原样保留**。这是人「先测量后承诺」的显式杠杆（AC-215），是唯一正当的"暂不纳入判定"表达。
4. 兜底分支（结构完备 + active goal + 无 posture）：`hold` → **`activate`**。"无任务"随后自然流向立案机制——此时 AC 已 active，`computeGoalGaps` 能看见它，会给它立任务。因果方向也正过来：**是"这条件必须成立"才使得该给它立任务**。

`hasTraction` 变量本身在改动后不再参与 activate 判定；若无其它消费者应一并清理，避免留下误导性死变量。

**已实测的影响面（blast radius，逐条 grep 核实，不要重新猜）**——会红的断言只有 2 条，且都是同一条语义（"无牵引 ⇒ hold"）的编码：
- `plugin/test/goal-triage-fresh-draft-not-retire.test.mjs:74` —— 实环断言 `assert.equal(triageEntry.decision, 'hold', '无牵引 ⇒ 分诊判 hold')`
- `plugin/test/goal-triage-activate-executed.test.mjs:81` —— 负控制 (a)：AC-902（criterion 真 + 无牵引）不被激活

**不受影响**（posture 分支在 traction 之前触发，AC-215 完全不动）：
- `plugin/test/goal-triage.test.mjs:72,74`（posture='measure-only'）
- `plugin/test/goal-posture-blocks-activate.test.mjs:110`（posture）
- `plugin/test/goal-triage-activate-executed.test.mjs:116`（posture）
- `plugin/test/goal-triage-fresh-draft-not-retire.test.mjs:46` —— 该纯函数断言本就写作 `assert.ok(['hold','activate'].includes(e.decision))`，**本身即允许 activate**

⇒ **重要**：AC-219 的语义意图是「无任务牵引 ≠ 死信，不得判退役」，与本改动**相容**（activate 比 hold 更不像死信）；只有它那条实环断言把 `hold` 写死了、以及 activate-executed 的负控制 (a) 选错了对象（用"无牵引"当作"不该激活"的样例）。实现时应把这两条断言改为断言其**真实意图**（⛔ 不判 retire / ⛔ 不翻 needs-human；负控制 (a) 改用 posture 或 criterion-空 的样例），而不是简单删除断言。

## Acceptance Criteria

- [x] `triageDraftAc` 对「goal 锚合法 + criterion 非空 + 无 posture + 无任务牵引」的 draft AC 判 `activate`（不再 `hold`）：`node --no-warnings --experimental-strip-types --test plugin/test/goal-triage.test.mjs` exit 0，且新增/改写的用例逐条断言该形状
- [x] 三道前置闸原样有效（负控制，⛔ 不得因本改动放宽）：goal 锚非法 ⇒ `re-anchor`；criterion 空 ⇒ `needs-human`；goal 有 posture ⇒ `hold`（AC-215 不受影响）；`node --no-warnings --experimental-strip-types --test plugin/test/goal-posture-blocks-activate.test.mjs` exit 0
- [x] 循环依赖已解除的端到端证据：真实环下，一条 active GOAL 名下结构完备且**零关联任务**的 draft AC，跑一轮后 status 变 active，且同轮或次轮被 `computeGoalGaps` 计为 `gap`（即立案机制现在看得见它）；`node --no-warnings --experimental-strip-types --test plugin/test/goal-triage-activate-executed.test.mjs` exit 0
- [x] `goal-triage-fresh-draft-not-retire.test.mjs` 与 `goal-triage-activate-executed.test.mjs` 中被本改动波及的 2 条断言，已改为断言其**原始意图**（⛔ 不判 retire、⛔ 不翻 needs-human；负控制 (a) 改用 posture / criterion-空 样例），⛔ 不是删除断言了事；两文件 exit 0
- [x] `triageDraftAc` 函数头注释与 `runGoalRound` 的实际行为一致（现注释仍写「判决只【记录】，⛔ 不 flip 任何 AC status」，而调用侧已会对 activate 判决调 `writeGoalStatus` 落地——本轮一并修正该既有漂移）
- [x] `scripts/test.sh` 全量绿

## Definition of Done

改动已随本任务 fan-in 落到 develop；且在**生产**上取得一次真实读数：`.quay/goal-round.jsonl` 中存在实现落地【之后】的轮次，其 `goal-ring` fact 的 `triage` 数组里有一条判决为 `activate` 且该 AC 此前无任何关联任务（证明新路径在生产上真的走通，而非仅测试绿——硬规则「推论三」：读生产载体、且只计落地之后的时间窗）。若该时间窗内生产恰无此形状的 AC，则记录实测为零并说明，⛔ 不得以 fixture 冒充生产读数。

## Touches
- plugin/scripts/goal-driver.ts
- plugin/test/goal-triage.test.mjs
- plugin/test/goal-triage-fresh-draft-not-retire.test.mjs
- plugin/test/goal-triage-activate-executed.test.mjs
- plugin/test/goal-driver.test.mjs
- plugin/test/goal-posture-blocks-activate.test.mjs
- tasks/gap-goal-driver-ac-activation-gated-on-traction-not-goal-semantics.md