---
id: gap-suite-blocking-experiment-rounds-count-toward-consecutive-red
title: suite_blocking 把一次性对照实验轮计入 consecutive_red——r268（lane8 对照，--lane-count 8
  非默认）的红是实验结论的一部分、不是回归，却贡献 3 次连红中的 1 次直接推窗激活；实验轮机械可辨（laneCount 非默认值），应从
  consecutive_red 计数排除
status: ready
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

**suite_blocking 把一次性对照实验轮计入 consecutive_red：r268（lane8 对照，`--lane-count 8` 非默认）的红是实验结论的一部分、不是回归，却贡献 3 次连红中的 1 次直接把窗推到激活。实验轮机械可辨（laneCount 非默认值），应从 consecutive_red 计数排除。**

### 实证（manager 2026-08-11 04:3x + outer 复核）

- **三次连红**：r268（lane8 对照）+ r269（invoke-evidence，已修）+ r270（plugin-packaging，workflow Fix 中）⇒ `consecutive_red:3 == min_red_window:3` ⇒ 窗激活。
- **r268 是实验轮**：manager 建议的一次性对照（`--lane-count 8`，同 commit 9b08ed62，回答 916b1feb 缺的那半证据）；其红=实验结论（lane8 撞 60s 窗），非回归。
- **若排除实验轮**：r269 + r270 = 2 < 3 ⇒ 窗不激活 ⇒ 自锁解除（配合 gap-suite-blocking-self-lock 的豁免）。
- **机械可辨**：verification-round.jsonl 已记 `laneCount` 字段；默认 lane = nproc（4），非默认 lane 即实验轮。

### 选定机制方向（实现归 inner，判定归 outer）

**从 consecutive_red 计数排除实验轮**（laneCount ≠ 默认值）：
1. `computeSuiteBlocking` 读 verification-round 时跳过 `laneCount != default`（nproc）的轮次——实验轮不计入 consecutive_red。
2. 实验轮的红仍写 state/reason（保留结论），只是不推动连红窗。

**验证锚**：修后 (a) 构造 [实验红, 真红, 真红] 序列 ⇒ consecutive_red=2（实验轮不计）；(b) [真红, 真红, 真红] ⇒ 3 正常计；(c) `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 r268 lane8 实验轮计入连红推窗激活 + 机械可辨（laneCount 字段）（本任务 Proposal 已含）
- [x] AC2: **实验轮不计连红**——computeSuiteBlocking 跳过 laneCount ≠ 默认的轮次
- [x] AC3: **真红仍计**——默认 lane 的真红轮正常累计
- [x] AC4: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [x] AC1–AC4 全部勾上
- [x] 修后实跑：构造 [实验红, 真红, 真红] ⇒ consecutive_red=2（贴输出）
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/ready-pool-check.ts（computeSuiteBlocking 跳过实验轮）
- plugin/test/ready-pool-check.test.mjs（新增实验轮不计连红用例）
- tasks/gap-suite-blocking-self-lock-blocks-fix-family.md（交叉标注——同族）
- tasks/gap-suite-blocking-experiment-rounds-count-toward-consecutive-red.md（自身：勾 AC + 贴证据）

## Contract

measure   consecutive_red_excluding_exp = `node --no-warnings --experimental-strip-types plugin/scripts/ready-pool-check.ts --root "$PWD" --cap 5 --json` 的 stdout 中 suite_blocking.consecutive_red 数字
band      consecutive_red_excluding_exp = 只含真红轮（实验轮不计）
invariant experiment_round_identifiable = 1（laneCount ≠ 默认 = 实验轮）
invariant real_red_still_counts = 1（默认 lane 真红正常累计）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/ready-pool-check.ts --root "$PWD" --cap 5 --json`（贴 suite_blocking.consecutive_red）
control   实验轮不计；真红仍计；窗激活正确；既有不回归
resume    跳过实验轮 / 测试分步提交，任一步完成即写盘

## Implementation evidence（inner 2026-08-11）

### 改了什么

- `plugin/scripts/ready-pool-check.ts`：
  - 新增 `isExperimentRound(r, defaultLane)`——仅**显式非默认 laneCount** 才算实验轮（无 laneCount 的 legacy 行、laneCount == default 的真轮正常计）。
  - `computeSuiteBlocking` 读 verification-round 时**跳过实验轮**（`rounds.filter(r => !isExperimentRound(r, defaultLane))`），consecutive_red 与失败归因都只吃真红轮；实验轮的红仍留在 round 记录本身（state/reason 保留），只是不推连红窗。
  - default lane 用 full-suite-runner 的 `defaultLaneCount()`（nproc 派生，**单一来源**，未复制 nproc 公式），`defaultLane` 可注入供 hermetic 测试。
- `plugin/test/ready-pool-check.test.mjs`：新增用例 `[实验红(lane8), 真红, 真红] ⇒ consecutive_red=2 且 min3 窗不激活`；`[真红 ×3] ⇒ 3 且窗激活、归因命中`；中间实验轮透明（不计也不断）。

### 实跑证据（Contract invoke：`ready-pool-check.ts --root <tmp> --cap 5 --json` 的 suite_blocking 字段）

Scenario A：`[实验红(268, lane8), 真红(269), 真红(270)]`（r268 复现形态）

```
suite_blocking.consecutive_red = 2
suite_blocking.window_active   = false
suite_blocking.tasks          = []
```

⇒ 实验轮不计，2 < 3 窗不激活——r268+r269+r270 的 3 连红自锁解除（r269+r270 = 2）。

Scenario B：`[真红 ×3]`（默认 lane）

```
suite_blocking.consecutive_red = 3
suite_blocking.window_active   = true
suite_blocking.tasks          = ["gap-wd"]
```

⇒ 真红仍正常累计，窗激活并归因到 Touches 命中任务。

### scoped 门（`--for-task`，exit 0）

- 静态检查全过：test-framework-policy / test-isolation（44 baseline）/ test-impl-census（328 clean）/ task-contract-check（strict-subset 本任务+同族，no violations）/ superseded-capability / tick-core-static / delivery-inventory-drift。
- 测试：`plugin/test/ready-pool-check.test.mjs` 64 通过（含新增用例）· fail 0 · cancelled 0。
- 全量套件绿留待外层 verification-round 验证（未勾）。

## Dispatch review

reviewer: outer
at: 2026-08-11
changed: manager 04:3x——r268 lane8 对照实验轮计入 consecutive_red（红=实验结论非回归），直接把窗推激活。实验轮机械可辨（laneCount 非默认）。处方：consecutive_red 排除实验轮。实现归 inner，判定归 outer