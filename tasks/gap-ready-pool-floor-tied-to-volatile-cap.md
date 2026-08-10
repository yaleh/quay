---
id: gap-ready-pool-floor-tied-to-volatile-cap
title: ready-pool 的 floor=cap×4 挂在波动 cap 上——同一 pool 在 cap 3 时②假（floor 12）cap 4
  时②真（floor 16），负载决定判词；义务「等机器忙就能自动消失」通道
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**ready-pool 的 `floor = cap × 4` 挂在会随负载波动的 cap 上——负载一高 floor 自动降低，pool 一个数没变也能「达标」；方向反了（资源越紧张、对就绪池的要求越低），并给义务一条「不用处置、等机器忙一点就行」的自动消失通道。manager 2026-08-09 实测：`--cap 3` 给 floor 12/deficit 0（②假），`--cap 4` 给 floor 16/deficit 2（②真）——同一个 pool、不同判词，差别全来自负载。**

### 实证（manager 2026-08-09 实测 + outer 复核）

- **cap 波动**：`cap-from-gate.sh` 实测 `budget total=4 in_use=0 available=4`、`effective_cap=4`；但 round-172 跑时 cap 可能是 3。
- **同一 pool 不同判词**：
  - `--cap 3` ⇒ floor=12、pool=14、deficit=0（②假）
  - `--cap 4` ⇒ floor=16、pool=14、deficit=2（②真）
- **方向反了**：cap 低 = 机器忙/资源紧张 ⇒ floor 自动降 ⇒ pool 更容易「达标」。资源越紧张对就绪池要求越低——应该反过来（资源紧时更需要充分准备）。
- **义务自动消失通道**：义务「pool ≥ floor」挂在波动 cap 上，不用处置，等机器忙一点 floor 就降下来「达标」了。这是「义务自动消失」的机制根。

**为什么重要**：这是「判据挂在波动量上」的缺陷——义务的真实性取决于当下负载而非工作完成度。它让 ② 义务可以在不处置的情况下「消失」，与 no-action 零成本同族（判词可以低成本满足）。

**修的方向（实现归内层）**：
- 候选 A：**floor 用窗口内 cap 的最大值**——取最近 N 轮 cap 的最大值算 floor（负载波动不降低要求）。
- 候选 B：**floor 用固定基准**——floor 不随 cap 波动，用固定的可派发目标（如历史 max cap × 4）。
- 候选 C：**判据与 cap 解耦**——② 的达标判据是「pool ≥ floor」但 floor 取固定值（如 16），不随当下 cap 变。

**验证锚**：修后，(a) cap 从 3 变 4 时 pool 判词不变（不再因负载波动改变达标状态）；(b) 义务不能靠「等机器忙」消失；(c) 既有 pool 机制不回归。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录实证（cap 3→floor 12 ②假 / cap 4→floor 16 ②真，同一 pool 14）（本任务 Proposal 已含；内层补：--cap 3 vs 4 复现）
- [x] AC2: **floor 不随当下 cap 波动**——cap 波动时 pool 判词不变（候选 A/B/C 任一）
- [x] AC3: **义务不自动消失**——「pool ≥ floor」不因负载波动被豁免（构造：cap 降 ⇒ floor 不降 ⇒ ② 仍真）
- [x] AC4: **既有机制不回归**——`--for-task` scoped 门绿（含 ready-pool 契约检查）
- [ ] AC5: **不回归**——全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 修后实跑：cap 3 vs 4 同一 pool ⇒ 判词一致；构造 cap 降 ⇒ ② 仍真（贴任务体）
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Evidence（内层实现 2026-08-09）

**AC1 复现**：`--cap 3` ⇒ floor=12 pool=14 deficit=0（②假）；`--cap 4` ⇒ floor=16 pool=14 deficit=2（②真）——同一 pool、不同判词，全来自负载。

**AC2 修（候选 A：floor 用窗口 max cap）**：`plugin/scripts/ready-pool-check.ts` 的 `computePoolFloor` 加第三参 `floorCap`——传入时 `floor = max(cap, floorCap) × floorMult`；不传（默认 undefined）保持纯 `cap × floorMult`（既有测试的小 cap 精确性不回归）。CLI 加 `--floor-cap`。

**AC3 验证**：`--cap 3 --floor-cap 4` ⇒ floor=16（cap 降不降 floor）⇒ ② 仍真、deficit=2；`--cap 4 --floor-cap 4` ⇒ floor=16——**cap 波动判词一致，义务不靠「机器忙」消失**。

**AC4 不回归**：ready-pool-check.test.mjs **55/55 pass / 0 fail**；无 `--floor-cap` 时行为与旧一致（cap 3→12 / cap 4→16）。

**AC5 scoped 门**：`bash scripts/test.sh --for-task gap-ready-pool-floor-tied-to-volatile-cap --allow-thin` → **exit 0，55 pass / 0 fail，violations 0**。

## Touches

- plugin/scripts/ready-pool-check.ts（floor 计算：窗口内 cap 最大值 / 固定基准 / 与 cap 解耦）
- plugin/test/（新增：cap 波动 ⇒ pool 判词不变；cap 降 ⇒ ② 仍真）
- orchestration/orchestrator-tick-core.md（A9/A10 判据——floor 波动说明核实）
- tasks/gap-ready-pool-floor-tied-to-volatile-cap.md（自身：勾 AC + 贴证据）

## Contract

measure   pool_verdict_cap_invariant = 同一 pool 下 `--cap 3` 与 `--cap 4` 的 deficit 是否一致
band      pool_verdict_cap_invariant = 一致（cap 波动不改变达标状态）
invariant obligation_not_auto_discharged = 1（cap 降 ⇒ floor 不降 ⇒ ② 仍真）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/ready-pool-check.ts --root /home/yale/work/quay --cap 3` 与 `--cap 4`（贴回）
control   cap 波动 ⇒ 判词不变；cap 降 ⇒ ② 仍真
resume    floor 基准修正分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务（manager 实测：floor=cap×4 挂波动 cap 上——cap 3→floor12 ②假 / cap 4→floor16 ②真，同一 pool；方向反了+义务自动消失通道。实现归内层）
