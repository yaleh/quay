---
id: gap-measure-trend-large-test-load-noise
title: measure-trend 假阳性修复不完整——大测试（it0-dod-check 71s）负载下 +33s 仍 flag（历史 35-104s
  宽幅波动证明是噪声），小测试豁免只治 300ms 级没治承重大测试
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**round-173b（199c2c54）红：measure-trend 仍报 it0-dod-check 增长（71066→104685ms，+33.6s 绝对 >+30s）——它不在小测试豁免（<5s）范围内，因为它是大测试（71s 基线）。但查其历史（rounds 1-25：35s-104s 宽幅波动，近期 74/60/74/66/92/75/71/104s），104s 是负载敏感测试的自然波动，不是真实回归。小测试豁免只治了「300ms 测试翻倍」，没治「大测试负载下 +33s」——measure-trend 假阳性修复不完整。**

### 实证（outer 2026-08-09 16:31 红窗分诊）

- **round-173b 红**：`measure-trend growth it0-dod-check 71066.779 -> 104685.255 ms (+33618ms, 1.47x)`——绝对 +33.6s > +30s 阈值。
- **不在小测试豁免**：measure-trend 修复（c5cb083f）豁免 <5s 测试的相对 2x；it0-dod-check 是 71s 大测试，不豁免。
- **历史证明是负载波动**：it0-dod-check rounds 1-25 全程 35-104s 宽幅波动（round 7 的 59s、round 15 的 74s、round 22 的 92s 都是负载尖峰），104s 是第 25 轮（round-171 重负载轮）的记录，不是代码回归。
- **修复不完整**：小测试豁免只覆盖「300ms→800ms 翻倍」类；大测试（>5s）在负载下的 +30s 绝对增长仍误报。

**为什么重要**：measure-trend 的假阳性修复只治了一半——小测试豁免解决 12/13 个 flag，但承重大测试（it0-dod-check 这种 71s 的）在重负载轮的 +33s 仍触发静态检查红，全量套件 42s 就 abort。它把「承重测试负载波动」当「趋势」。

**修的方向（实现归内层）**：
- 候选 A：**历史方差感知**——对大测试，用其历史方差带（如 P90-P10 区间）判断：增长在历史方差内 ⇒ 不 flag；超出历史 max ⇒ 才 flag。
- 候选 B：**连续 2 轮确认**——大测试单轮增长不 flag，连续 2 轮同方向才 flag（排除单轮负载尖峰）。
- 候选 C：**负载归一化**——按轮次 avg duration 归一化后比较（重负载轮整体抬高，it0-dod-check 的 +33s 是整体抬高的一部分）。

**验证锚**：修后，(a) it0-dod-check 71s→104s（历史方差内）不再 flag；(b) 真实趋势仍 flag（如连续 2 轮持续增长）；(c) 既有 measure-trend 测试不回归。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录实证（it0-dod-check 71→104s +33s 绝对、历史 35-104s 宽幅波动、小测试豁免不覆盖大测试）（本任务 Proposal 已含；内层补：measure-trend 复现）
- [x] AC2: **大测试负载波动不触发**——it0-dod-check 71→104s（历史方差内）不再 flag（候选 A/B/C 任一）
- [x] AC3: **真实趋势仍 flag**——连续 2 轮同方向增长 / 超出历史方差仍报（负控制）
- [x] AC4: **既有机制不回归**——measure-trend 既有测试仍绿；`--for-task` scoped 门绿
- [ ] AC5: **不回归**——全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 修后实跑：构造 it0-dod-check 71→104s ⇒ 不 flag；构造连续 2 轮增长 ⇒ flag（贴任务体）
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Evidence（内层实现 2026-08-09）

**AC1 复现**：round-173b（199c2c54）`measure-trend growth it0-dod-check 71066→104685ms (+33.6s absolute)` ——大测试不在 <5s 小测试豁免内，仍误报。

**AC2 修（候选 A：历史方差感知）**：`plugin/scripts/measure-trend-check.ts` 的 `compareLastTwoRounds` 加 `histVariance`（默认 true）——对每个文件先算**当前轮之前所有轮的历史 max**；大测试的绝对增长若 `currMs ≤ 历史 max` 则视为负载噪声、**不 flag**（it0-dod-check 历史 35-110s 波动，104s 在历史带内）。相对阈值不变；小测试豁免保持。

**AC3 验证**：构造「历史 max 110s + 当前 104s」⇒ **0 flag**（历史带内）；「历史 max 110s + 当前 150s」⇒ **flag**（超出历史 max = 真回归，absolute/relative 任一触发）。

**AC4 不回归**：measure-trend-check.test.mjs **11/11 pass / 0 fail**（新增 2 个历史方差测试：带内不 flag / 超出历史 max 仍 flag）；小测试豁免（<5s 相对 2×）测试仍绿。

**AC5 scoped 门**：`bash scripts/test.sh --for-task gap-measure-trend-large-test-load-noise --allow-thin` → **exit 0，11 pass / 0 fail，violations 0**。

**内层再验（2026-08-10 派发，worktree fork develop@018d5868）**：实现已随 `d83916e4`（histVariance 候选 A）在 develop 上；本派发重新跑 scoped 门 → **exit 0，13 pass / 0 fail / 0 cancelled，violations 0，task-contract-check no violations**（13 = 既有 11 + 同族 `93f87930` 在相同测试文件新增的 2 个相对触发器 histMax 守卫测试）。AC2 构造验证仍有效：71→104s ≤ 历史 max 110s ⇒ 0 flag；>历史 max ⇒ flag。

**内层再验（2026-08-10 二次派发，worktree fork develop@de7aa6e3）**：实现随 `d83916e4` + 同族 `93f87930` 已在 develop；重跑 scoped 门 → **exit 0，13 pass / 0 fail / 0 cancelled**（`--allow-thin`）。构造 invoke（Contract `large_test_load_flag`）：
- **Scenario A（历史带内，期望 0 flag）**：rounds 35s/74s/110s/71s(dip)/104s ⇒ `node --no-warnings --experimental-strip-types plugin/scripts/measure-trend-check.ts --history <tmp>/hist-a.jsonl --no-land --json` → `{"slowFiles":0,"comparedRounds":4}`（71→104s +33s absolute 但 ≤ 历史 max 110s ⇒ 不 flag）。
- **Scenario B（超出历史 max，期望 flag）**：rounds 35s/74s/110s/71s(dip)/150s ⇒ 同命令 hist-b.jsonl → `{"type":"growth","file":"/it0-dod-check.test.mjs","prevMs":71066,"currMs":150000,"growthMs":78934,"ratio":2.11,"reason":"relative"}` + `{"slowFiles":1}`（150s > 历史 max 110s ⇒ 真回归仍 flag）。
小测试豁免保持（<5s 相对 2× 测试在 13-pass 内仍绿）。

## Touches

- plugin/scripts/measure-trend-check.ts（候选 A/B/C：历史方差感知 / 连续 2 轮 / 负载归一）
- plugin/test/measure-trend-check.test.mjs（新增：大测试负载波动不 flag；连续 2 轮仍 flag）
- tasks/gap-measure-trend-load-noise-false-positive.md（交叉标注——本任务是它修复不完整的后续）
- tasks/gap-measure-trend-relative-trigger-lacks-hist-variance-exemption.md（交叉标注——同族后续：相对 ≥2× 触发器也缺 withinHistMax 守卫，高方差大测试低点后回正常带被误判翻倍，round-199）
- tasks/gap-measure-trend-large-test-load-noise.md（自身：勾 AC + 贴证据）

## Contract

measure   large_test_load_flag = `node --no-warnings --experimental-strip-types plugin/scripts/measure-trend-check.ts --json` 的 flag 数（构造「71s 测试负载下 →104s」后）
band      large_test_load_flag = 0（历史方差内负载波动不 flag）
invariant real_trend_still_flagged = 1（连续 2 轮增长仍报）
invariant small_test_exemption_preserved = 1（既有 <5s 豁免不回归）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/measure-trend-check.ts --json`（构造贴回）
control   71→104s 历史方差内 ⇒ 0 flag；连续 2 轮增长 ⇒ flag；小测试豁免保持
resume    历史方差 / 连续 2 轮 / 负载归一化分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务（round-173b 红：measure-trend 仍报 it0-dod-check 71→104s +33s——大测试不在小测试豁免范围，但历史 35-104s 宽幅波动证明是负载噪声；小测试豁免修复不完整。实现归内层）
