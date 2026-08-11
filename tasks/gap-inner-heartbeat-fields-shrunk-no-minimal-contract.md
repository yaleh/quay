---
id: gap-inner-heartbeat-fields-shrunk-no-minimal-contract
title: .quay/inner-wakeup-heartbeat.json 字段收缩——本轮只写 3
  键（ts/reason/delaySeconds），此前
  runIds/blocked/budgetHit/effectiveCap/agentDispatches 全消失；A3 前提=这是唯一回答「inner
  需要什么」的产物，缺 blocked[] ⇒ 无法判 inner 是否卡住（硬规则 6
  缺键=未查≠无阻塞）；处方=心跳字段集最小契约检查，防静默退化成一行自由文本
status: needs-human
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**`.quay/inner-wakeup-heartbeat.json` 字段收缩：本轮（05:20）只写 3 个键（ts/reason/delaySeconds），此前 runIds/blocked/budgetHit/effectiveCap/agentDispatches 全部消失。A3 的前提是【这是唯一回答「inner 需要什么」的产物】——少了 blocked[]，无法从它判断 inner 是否卡住；按硬规则 6 缺键=未查、不等于无阻塞。**（manager 本轮用 slot-status 与 worktree 列表独立补齐，但这是绕法不是机制。）

### 实证（manager 2026-08-11 05:3x + outer 复核）

- **本轮心跳**（05:20）：`{"ts":..., "delaySeconds":1500, "reason":"tick heartbeat — dispatched quay-init-branch-model; prereq-gates needs-human; leaked worktree cleaned"}`——**3 键**。
- **此前心跳**：含 runIds/blocked/budgetHit/effectiveCap/agentDispatches（05:0x 及之前）。
- **后果**：A3 用该产物答「inner 是否卡住/需要什么」——缺 blocked[] 则无法判卡住（硬规则 6：缺键=未查，不等于无阻塞）。
- **观测退化**：心跳退化成一行自由文本（reason 散文），结构化字段消失 ⇒ 上层判断只能靠别的来源（slot-status/worktree）补齐，但那是绕法不是机制。

### 选定机制方向（实现归 inner，判定归 outer）

**给心跳字段集加最小契约检查**，防静默退化成一行自由文本：
1. **最小字段契约**：心跳必须含 ts/runIds/blocked/budgetHit/effectiveCap/agentDispatches/delaySeconds 等结构化键（至少 blocked[] + runIds）；缺任一 ⇒ 报「心跳字段缺失」（照 tick-core 缺值=未查的纪律）。
2. **退化成散文即红**：reason 散文可补充但不可替代结构化字段；检查器对缺键判不合规。

**验证锚**：修后 (a) 心跳含最小字段集（blocked[]/runIds/effectiveCap 等）；(b) 缺键 ⇒ 检查器报；`--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录本轮 3 键心跳 vs 此前全字段（runIds/blocked/budgetHit/effectiveCap/agentDispatches）+ 硬规则 6 缺键=未查（本任务 Proposal 已含）
- [x] AC2: **最小契约**——心跳必须含结构化键（blocked[]/runIds/effectiveCap 至少）；缺 ⇒ 检查器报
- [x] AC3: **散文不替代**——reason 散文可补充不可替代结构化字段
- [x] AC4: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [x] AC1–AC4 全部勾上
- [x] 修后实跑：心跳字段集检查器对缺键判不合规（贴输出）
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/inner-wakeup-heartbeat-check.ts（最小字段契约 + 缺键判不合规）
- plugin/test/inner-wakeup-heartbeat-check.test.mjs（新增缺键用例）
- plugin/scripts/inner-wakeup-heartbeat.ts 或写入方（补结构化字段）
- tasks/gap-inner-heartbeat-fields-shrunk-no-minimal-contract.md（自身：勾 AC + 贴证据）

### Finding：runIds 是 worktree 清理机制的前置依赖（manager 2026-08-11 07:3x，落点 Finding 不进 Contract）

**本任务不只是「可观测性退化」——它是 worktree 清理机制的前置依赖。** manager 复核确认：「分支已合」是活跃工作期间的瞬时状态（subagent 在 fan-in 之后、下次提交之前，其 worktree 在祖先判据下全像泄漏）；进程名匹配无效（subagent 是 `claude` 进程、argv 无任务 id）；`worktreeExists` 反过来（worktree 在就判存活 ⇒ 泄漏算在飞）。**唯一可靠判据 = inner 心跳的 `runIds`**——而本任务覆盖的字段缩水恰好删掉了它。⇒ **实现顺序**：先恢复 `runIds`（本任务），再让 worktree 清理机制读它（gap-worktree-leak 的 AC3 落地）；在此之前清理只能人工判别、不要机械化。详见 gap-worktree-leak-after-fan-in-occupies-slot-permanently Finding。

**第二个消费者——`--reconcile` 的存活判据也应改读 runIds（manager 2026-08-11 07:4x）**：现在 `--reconcile` 与清理机制共用 `worktreeExists`。对 reconcile 它的不可靠方向**是安全的**（worktree 在 ⇒ 判「未消失」⇒ 拒绝关闭 ⇒ 只漏关不误关；outer 已跑 --reconcile 验证：brackets 15→3、kept 3 条全是在飞 subagent）——与清理方向相反，故 **reconcile 不必等 runIds、清理必须等**。**但 runIds 落地后 `--reconcile` 也应改读它**——否则以后有人修了清理、忘了 reconcile。这是本前置依赖的第二个消费者。
## Contract

measure   heartbeat_field_count = `python3 -c "import json; print(len(json.load(open('.quay/inner-wakeup-heartbeat.json'))))"` 的 stdout 数字
band      heartbeat_field_count >= 7（ts/runIds/blocked/budgetHit/effectiveCap/agentDispatches/delaySeconds）
invariant blocked_field_present = 1（blocked[] 必须在场——A3 判卡住的前提）
invariant prose_does_not_replace = 1（reason 散文不可替代结构化字段）
invoke    `python3 -c "import json; d=json.load(open('.quay/inner-wakeup-heartbeat.json')); print(sorted(d.keys()))"`（贴心跳键集）
control   心跳含结构化字段；缺键判不合规；散文不替代
resume    契约检查 / 写入方补字段 / 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-11
changed: manager 05:3x——心跳本轮只写 3 键（ts/reason/delaySeconds），此前 runIds/blocked/budgetHit/effectiveCap/agentDispatches 全消失；A3 前提被破坏（缺 blocked[] 无法判卡住，硬规则 6 缺键=未查）。处方：最小字段契约检查。实现归 inner，判定归 outer

## Evidence (inner 实现证据, 2026-08-11)

**提交**（worktree `gap-inner-heartbeat-fields-shrunk-no-minimal-contract`，fork develop 51885b79）：
- `35f902cd` 契约检查：`inner-wakeup-heartbeat-check.ts` 最小字段契约（`REQUIRED_HEARTBEAT_FIELDS` = ts/runIds/blocked/budgetHit/effectiveCap/agentDispatches/delaySeconds）+ 缺键判 `fields-missing`；接线 B3/步骤 6 改走 writer 脚本
- `b552db95` 写入方补字段：新 `plugin/scripts/inner-wakeup-heartbeat.ts`（写全字段，缺键 fail-closed 拒写）+ capability-catalog 声明 + delivery-inventory 快照再生成
- `e3be96d5` 测试：`plugin/test/inner-wakeup-heartbeat.test.mjs`（writer 用例 + write→check 往返）
- `（本提交）` 任务体：勾 AC1-AC4 + 贴证据

**AC2 最小契约 + AC3 散文不替代（检查器缺键判不合规，实跑）**：

```
$ python3 -c "import json,time; d={'ts':int(time.time()),'delaySeconds':1500,'reason':'3键缺陷形态'}; open('<tmp>/.quay/inner-wakeup-heartbeat.json','w').write(json.dumps(d))"   # 3 键 = 缺陷形态
$ node --no-warnings --experimental-strip-types plugin/scripts/inner-wakeup-heartbeat-check.ts --root <tmp> --json
→ verdict: DEAD / status: fields-missing / exit 1
  reason: inner-wakeup-heartbeat-fields-missing
  fieldContract: { ok: false, fieldCount: 3,
    missing: ["runIds","blocked","budgetHit","effectiveCap","agentDispatches"], wrongType: [] }
```

**AC2 写入方产出全字段（Contract measure `heartbeat_field_count >= 7`）**：

```
$ node --no-warnings --experimental-strip-types plugin/scripts/inner-wakeup-heartbeat.ts --root <tmp> --blocked '[]' --run-ids '["run-abc123"]' --effective-cap 3 --agent-dispatches 1 --budget-hit false --agent-limit 200 --budget-critical false --delay-seconds 1500 --reason 'tick heartbeat'
→ inner-wakeup-heartbeat: written ... (10 fields)
$ python3 -c "import json; d=json.load(open('<tmp>/.quay/inner-wakeup-heartbeat.json')); print(sorted(d.keys()))"   # Contract invoke
→ ['agentDispatches','agentLimit','blocked','budgetCritical','budgetHit','delaySeconds','effectiveCap','reason','runIds','ts']   # field_count=10 >= 7
$ node ... inner-wakeup-heartbeat-check.ts --root <tmp> --json
→ verdict: ALIVE / status: alive / fieldContract.ok: true / exit 0
```

**AC4 既有不回归（`--for-task` scoped 门绿）**：

```
$ bash scripts/test.sh --for-task gap-inner-heartbeat-fields-shrunk-no-minimal-contract --allow-thin
→ ℹ tests 40 / pass 40 / fail 0 / cancelled 0   (exit 0)
  scoped static checks: capability-catalog（0 unclassified）/ delivery-inventory drift gate / test-framework-policy / test-isolation 全 PASS
```

**DoD 全量套件**：未在本 worktree 跑（inner 零全量自跑，C1）——留给外层 verification-round 验证。
