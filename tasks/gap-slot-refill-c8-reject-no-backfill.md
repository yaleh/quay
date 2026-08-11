---
id: gap-slot-refill-c8-reject-no-backfill
title: "slot-refill 候选被逐候选门（C8 self-touch 等）拒掉后无回填——22 ready 中 5 缺 self-touch，17 本可派却报「本 tick 无可派」；候选循环不查 C8、派发侧拒了不补位"
status: ready
labels:
  - gap
  - defect
  - dispatch-critical
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**`slot-refill.ts` 的候选循环（`:305`）只做它自己的 step-4 检查（touches-resolve / deps-ready / concurrency-disjoint / not-yet-flipped），不查 inner 派发侧的实际门（C8 self-touch 等）。于是它推荐出的候选，inner 在派发时被 C8 逐条拒掉，且**没有从排序里更后的候选补位**——「池子有 17 个可派」和「本 tick 无可派」同时为真。**

### 实证（manager 2026-08-10 21:4x，用仓库自己的机件）

- `touches-orthogonality-check.ts --self-touch-scan`：`SELF-TOUCH-SCAN: 22 ready task(s), 5 missing self-file entry — NOT all dispatchable`。
- 5 条缺 self-touch：`gap-ac38-outer-doc-drift` / `gap-quay-self-hosting-e2e-proof`（池里 strategic、value 4.5，本阶段交付面关键路径 AC16③/AC40）/ `gap-quay-last-pane-txt-untracked-dirties-tree` / `gap-suite-concurrency-8-…` / `gap-suite-red-verdict-carries-empty-failures-payload`。
- C8 判据（`plugin/loop/fast-mode-tick-core.md:64`）：`## Touches` 必须含 `tasks/<id>.md` 且不带 `(new)`，缺 ⇒ 不派发。
- **机制问题**：22 个 ready 里只有 5 个缺 self-touch ⇒ **另外 17 个本可派**。但 inner 心跳报「本 tick 无可派（3 候选缺 self-touch C8）」——它拿到的候选只有 3 个，且恰好都在这 5 个里。⇒ `slot-refill` 按相关性排序取前若干作候选，**候选被 C8 逐个拒掉后没有用次序更后的补位**。
- 与 18:4x `gap-slot-refill-repeats-done-eligible-recommendations` 同族：**信号算了，没接进推荐路径**。

### 选定机制方向（实现归 inner，判定归 outer）

**候选被逐候选门拒绝后，从排序里回填下一个**，直到填满 cap 或候选耗尽：
- `slot-refill` 的候选循环（`:305`）增一个「可派发闸」参数/回调：被拒候选（任何逐候选门：C8 self-touch / touches-resolve / deps / 并发 / nyf）不入 recommended，且**继续遍历排序里更后的候选补位**，不因前几个被拒就停。
- 或等价：inner 派发侧收到推荐后逐条过 C8，被拒就从 `slot-refill` 的完整排序输出里取下一条（当前只给了前 N 条）。
- **关键判据**：不能让「池子有 17 个可派」和「本轮无可派」长期并存；`pool` 已跌破 floor（18 < 20，deficit=2）。

**验证锚**：修后 (a) 构造「前 3 候选缺 self-touch、第 4+ 可派」⇒ recommended 包含第 4+（补位）；(b) 全候选都被拒 ⇒ 无可派（不虚构）；(c) 既有 step-4 检查不回归；(d) `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 self-touch-scan 5 missing 清单 + inner 心跳「3 候选缺 C8」+ 17 本可派与无可派并存的机制原因（本任务 Proposal 已含）
- [x] AC2: **候选回填**——候选被逐候选门（含 C8 self-touch）拒掉后从排序更后补位，直到 cap 填满或候选耗尽
- [x] AC3: **既有不回归**——`--for-task` scoped 门绿；slot-refill 既有 step-4 检查不破坏
- [x] AC4: **不虚构可派**——全候选都被拒 ⇒ 如实报无可派（不因补位逻辑编造）

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 修后实跑：构造「前 3 缺 self-touch、第 4+ 可派」⇒ recommended 补位含第 4+（贴候选列表前后对比）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/slot-refill.ts（候选循环回填：被逐候选门拒后从排序更后补位）
- plugin/test/slot-refill.test.mjs（新增用例：前 3 缺 self-touch ⇒ 补位第 4+；全拒 ⇒ 无可派）
- plugin/scripts/capability-catalog.sh（若改动声明问题——slot-refill 已在 catalog？）
- tasks/gap-slot-refill-c8-reject-no-backfill.md（自身：勾 AC + 贴证据）

## Contract

measure   backfill_present = `grep -cE "backfill|continue.*recommended|candidate.*next" plugin/scripts/slot-refill.ts` 的 stdout 数字
band      backfill_present >= 1（回填逻辑已接线）
invariant c8_rejected_candidate_backfilled = 1（缺 self-touch 的候选被拒 ⇒ 排序更后的候选补位）
invariant all_rejected_no_fake = 1（全候选被拒 ⇒ 如实无可派，不虚构）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/slot-refill.ts --root <repo> --json`（贴 recommended：含补位候选）
control   候选被拒 ⇒ 补位；全拒 ⇒ 无可派；既有 step-4 不回归
resume    回填逻辑 / scoped 门 / 全量验证分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: manager 21:4x 实证——22 ready 中 5 缺 self-touch（touches-orthogonality-check --self-touch-scan），inner 报「3 候选缺 C8」而 17 本可派。根因：slot-refill 候选循环不查 C8，派发侧拒了不补位。处方：候选被逐候选门拒后从排序更后补位。outer 已做止血（5 任务补 self-touch，791a8909），本任务做结构解。实现归 inner，判定归 outer

## Evidence（inner 2026-08-11 实跑）

**scoped 门**：`bash scripts/test.sh --for-task gap-slot-refill-c8-reject-no-backfill --allow-thin` ⇒ `tests 66 / pass 66 / fail 0 / cancelled 0 / skipped 0`，`EXIT=0`。

**Contract invoke（构造「前 3 缺 self-touch、第 4+ 可派」，cap=3，`--root` 指向临时 fixture）**：
- 修前（develop 基线 slot-refill.ts）：`recommended: ["c8-a","c8-b","c8-c"]`，`should_refill: true` —— 前 3 恰缺 self-touch ⇒ 派发侧逐条被 C8 拒 ⇒ 「本 tick 无可派」（实证复现）。
- 修后（本分支 slot-refill.ts）：`recommended: ["c8-d","c8-e"]`，`should_refill: true` —— C8 拒掉前 3 后从排序更后补位（`c8_rejected_candidate_backfilled`）。
- 负控制：全 3 候选都缺 self-touch ⇒ `recommended: []`，`should_refill: false`，`no_refill_reason` 含 `no dispatchable candidate`（`all_rejected_no_fake`，不虚构）。

**backfill_present（Contract measure）**：`grep -cE "backfill|continue.*recommended|candidate.*next" plugin/scripts/slot-refill.ts` = 4（≥1）。

**新增测试**（plugin/test/slot-refill.test.mjs）：前 3 缺 self-touch ⇒ 补位第 4+；全拒 ⇒ 无可派；`(new)`-tagged self-file 非 self-touch 授予（拒）；带 self-file 的候选仍被推荐（不误杀）。既有 47 例 + 新增 4 例全绿（51/51）。

## 交叉标注（gap-judgment-computed-not-wired-to-action，2026-08-11）

本任务即类级任务「判据算出没接到『会因它而动』的那一步」的**实例 2（21:4x）**——self-touch-scan 判据算出来，但候选循环不查 C8、派发侧拒了不补位（信号算了，没接进推荐路径）。消费方已接线：`slot-refill.ts` C8 self-touch 拒后回填（`judgment-consumer-check.ts` registry `self_touch_scan` 条目机械核对该接线）。
