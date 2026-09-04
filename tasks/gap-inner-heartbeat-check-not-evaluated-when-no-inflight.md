---
id: gap-inner-heartbeat-check-not-evaluated-when-no-inflight
title: inner-wakeup-heartbeat-check 不传在飞集 ⇒ 恒假 DEAD（runMachineSlotRefill 默认空，END 四合取恒成立）——应报 NOT-EVALUATED 而非 DEAD（inner 17:0xZ 抓到 + outer 按位置核实）
status: done
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

**（inner-wakeup-heartbeat-check 恒假 DEAD——inner 2026-08-14 17:0xZ 抓到根因，outer 按位置核实）**。

**现象**：A13 心跳检查器对健康自驱的 inner 恒报 DEAD（`inner-round-ended-with-dispatchable-work`），与 A21 直接量（inner 活着、在提交）矛盾。今早+下午各一次都被归档成「写-查时差伪影家族」——**错**（原归档 455a2011 已由 outer 更正为真根因）。

**根因（机械）**：`inner-wakeup-heartbeat-check.ts` 重算 slot-refill 走 `runMachineSlotRefill({ inFlightIds = [] })`（:455 默认空）——:436-437 注释明写「The checker is run by OUTER, who may not know inner's in-flight set: pass `--in-flight` when the caller knows it; **DEFAULT EMPTY**」。空在飞集 ⇒ step-4 的 touches-overlap-in-flight 判不出（无在飞可比对）⇒ `no_refill_reason` 恒 null ⇒ END 四合取 `dispatchable_disjoint>0 ∧ no_refill_reason empty` 恒成立 ⇒ **恒假 DEAD**。

**A/B 复现（outer 核实，唯一差别=在飞集）**：
```
checker 不传 --in-flight ⇒ DEAD（reason=inner-round-ended-with-dispatchable-work）
checker 传 --in-flight "gap-ac80-prompt-canonical-and-invariant-checker,gap-fan-in-flip-no-ac-completion-check" ⇒ ALIVE（heartbeat-fresh, ageSecs 1250）
```

**最贵的部分（硬规则 3b 正例）**：恒假 DEAD 被归档成「已知家族不重升级」⇒ **真 DEAD 时没人看**——恒红=零信息，与恒绿同害。「没有检查」是已知空白；「一个恒红的检查」是假的保证，后者更贵。

**与 gap-ac53-gate-not-wired-to-running-set（done，c2add65d）同源不同支**：那条修了 `slots_free` 走 running-subagent 集；`no_refill_reason` 这条支没修——不传在飞集则它结构上永远是 null。

**判据1（硬规则 3b：读不懂不得与合格/不合格同形）**：checker **不传在飞集**时，END 不变式【无法评估】⇒ 报 **NOT-EVALUATED**（独立取值，含 `evaluated:false`），**不得报 DEAD**。DEAD 保留给「真违约」（在飞集已传入且四合取真）。
**判据2（能取假·真样本不构造）**：inner 健康自驱 + 不传在飞集 ⇒ 现恒 DEAD（假）；修后该情形报 ALIVE 或 NOT-EVALUATED，**不再恒 DEAD**。负控制：传入真实在飞集（ac80,flip-no-ac）⇒ 仍 ALIVE（现真值已对）。
**判据3**：传在飞集 + 真违约（有可派但不派）⇒ 仍报 DEAD（真阳性不被削弱——本修只针对「无法评估」态，不吞真违约）。
**判据4**：既有测试全绿 + `--for-task` scoped 门绿。

**不覆盖**：不改 slot-refill.ts 的判定逻辑（它按传入在飞集判，逻辑没问题——缺的是 checker 不传）；不动 END 不变式语义（四合取真违约仍 DEAD）；不新造「写时刻快照」机制（那是早前误判的修法，根因已改）。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 inner-wakeup-heartbeat-check.ts 的 runMachineSlotRefill 调用点（:455 默认空 + main() :607-608 inFlightIds 解析）+ END 不变式判定（analyzeSlotRefill 消费）。
2. 判据1：不传在飞集 ⇒ NOT-EVALUATED（独立取值 + evaluated:false），传了才判 DEAD/ALIVE。
3. 判据2 能取假：不传在飞集 + inner 健康 ⇒ 不再恒 DEAD（现恒 DEAD）；传入在飞集负控制仍 ALIVE。
4. 判据3：传在飞集 + 真违约仍 DEAD（不吞真阳性）。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：checker 不传在飞集 ⇒ END 不变式报 NOT-EVALUATED（独立取值 + evaluated:false），不报 DEAD。
- [ ] AC2 判据2 能取假：不传在飞集 + inner 健康 ⇒ 不再恒 DEAD；传在飞集负控制仍 ALIVE。
- [ ] AC3 判据3：传在飞集 + 真违约 ⇒ 仍 DEAD（真阳性不削弱）。
- [ ] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] inner-wakeup-heartbeat-check 不传在飞集时报 NOT-EVALUATED 而非 DEAD（恒假 DEAD 消除）+ 真违约仍 DEAD + 测试绿。

## Touches

- plugin/scripts/inner-wakeup-heartbeat-check.ts（无在飞集 ⇒ NOT-EVALUATED 分支；DEAD 仅留给真违约）
- plugin/test/inner-wakeup-heartbeat-check.test.mjs（补测：不传在飞集 NOT-EVALUATED / 传在飞集 ALIVE / 真违约 DEAD）
- tasks/gap-inner-wakeup-heartbeat-invisible.md（观察项已由 outer 更正为真根因，见 17:0xZ 段）
- tasks/gap-inner-heartbeat-check-not-evaluated-when-no-inflight.md（自身）

## Evidence

**实现前 A/B 复现（outer 2026-08-14 17:0xZ，唯一差别=在飞集）**：
```
checker 不传 --in-flight ⇒ DEAD（reason=inner-round-ended-with-dispatchable-work）
checker 传 --in-flight "ac80,flip-no-ac" ⇒ ALIVE（heartbeat-fresh, ageSecs 1250）
```
checker `runMachineSlotRefill({ inFlightIds = [] })` 默认空（:436-437 注释自证「DEFAULT EMPTY」）⇒ step-4 touches-overlap-in-flight 判不出 ⇒ `no_refill_reason` 恒 null ⇒ END 四合取恒成立 ⇒ 恒假 DEAD。原 455a2011「写-查时差」归档已由 outer 更正。

**实现后（本任务，worktree fixture：一可派 ready 任务 + 健康心跳）**：
```
checker 不传 --in-flight                      ⇒ NOT-EVALUATED（status=end-invariant-not-evaluated,
                                               evaluated:false, verdict=NOT-EVALUATED, exit 0）
checker 传 --in-flight "gap-fixture-dispatchable" ⇒ ALIVE（should_refill=false, exit 0）
checker 传 --in-flight ''（测得真零）            ⇒ DEAD（invariant-violated, exit 1）——真违约不削弱（AC3）
```

**表示**：NOT-EVALUATED = 独立取值（`verdict:"NOT-EVALUATED"` + `status:"end-invariant-not-evaluated"` + `endInvariant.evaluated:false`）+ **exit 0（不升级）**。DEAD 保留给真违约（在飞集已传 + 四合取真）。

**`--for-task` scoped 门**：`bash scripts/test.sh --for-task gap-inner-heartbeat-check-not-evaluated-when-no-inflight --allow-thin` → **exit 0，79/79 绿**（含 3 条新增 AC2/AC3 测试 + 10 条既有测试按新语义补 `--in-flight ''` 使 END 不变式可判）。
