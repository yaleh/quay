---
id: gap-ac36-recommended-exposes-sort-key
title: 'AC36 判据②不可机械核——slot-refill --json 的 recommended 是纯字符串数组，不暴露排序键；位次严格前移+负控制只能人工比对两次运行；处方=recommended 元素改带排序键对象（或另加 ranking 数组），判据②才能机械核对'
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

**AC36 判据②（打 label 任务位次严格前移 + 负控制：不打 label 同族位次不变）在当前 `--json` 输出下【无法机械核对】——`recommended` 是纯字符串数组，不暴露任何排序字段。只能人工比对两次运行，判据② 只能靠自述。**

### 实证（manager 2026-08-10 10:0x + outer 复核 slot-refill --json 顶层键）

- **`--json` 顶层键**（outer 复核）：`cap/base_cap/effective_cap/arbitration/floor_mult/in_flight_count/closed_but_live_count/occupied_slots/slots_free/pool/floor/dispatchable_disjoint/criterion_met/landing_blocked` — **没有任何排序字段**。
- **`recommended` 是纯字符串数组**（`recommended[0]` type = str）：`['gap-crystallization-five-directions', 'gap-ac37-exec-core-ships-with-package', …]` — 打没打 label、blocking_suite 与否、按哪个轴排的，输出里不可见。
- **判据② 原文**：「打了 label 的任务在 `--json` 的 `recommended` 里位次严格前移；负控制：不打 label 的同族任务位次不变」——当前形态下只能**人工跑两次比对**（打 label 前 / 后），无法用检查器机械断言「位次严格前移」且「同族不变」。

**为什么重要**：AC36 是产品化交付阶段的优先级机制，其判据② 是「应用（apply）」环的可机械验证。判据不可机械核 = 这条 AC 只能靠自述（正是 C17 / AC41 判据 3 反对的形态）。AC36 自己就是「应用环」的判据源，它不可验证会让整个链条的验证塌掉。

### 选定机制方向（实现归 inner，判定归 outer）

1. **`recommended` 元素带排序键**：从字符串数组改为对象数组（`{id, deliveryCritical, suiteBlocking, rank}`），或另加 `ranking` 数组（`[{id, axis, position}]`）——机械断言「deliveryCritical 任务位置严格前移」「同族 non-DC 位置不变」。
2. **判据② 机械化**：检查器读 `ranking`，断言 (a) DC 任务在打 label 前 → 后位置严格减小；(b) 同族非 DC 任务位置不变；(c) blocking_suite 仍在 DC 之上。

**验证锚**：修后 (a) `--json` 的 `recommended`（或 `ranking`）暴露每条的排序键（blocking_suite / delivery_critical / id 轴）；(b) 判据② 的「严格前移 + 负控制」可由检查器机械断言；(c) 既有输出不回归。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 recommended 纯字符串数组 + 顶层键无排序字段实证（本任务 Proposal 已含）
  - 证据：本任务 Proposal 已固化（`--json` 顶层键无排序字段；`recommended[0]` type=str）
- [x] AC2: **排序键暴露**——`--json` 的 recommended（或新增 ranking）暴露每条排序键（blocking_suite / delivery_critical / id）
  - 证据：`plugin/scripts/slot-refill.ts` 新增 `ranking` 数组（`[{id, deliveryCritical, suiteBlocking, rank}]`，与 `recommended` 并行；`recommended` 字符串数组保持原状）。见 `## Evidence` invoke 输出
- [x] AC3: **判据② 机械化**——检查器机械断言「DC 任务严格前移 + 同族非 DC 不变 + blocking_suite 之上」
  - 证据：`plugin/scripts/ac36-sortkey-criterion-check.ts`（新增）吃两次运行的 slot-refill JSON，机械断言 (a) DC rank 严格减小；(b) 同族非 DC 相对位次不变；(c) blocking_suite 仍在 DC 之上。见 `## Evidence` invoke 输出
- [x] AC4: **既有不回归**——`--for-task` scoped 门绿（含 slot-refill 既有测试）
  - 证据：worktree 内 `bash scripts/test.sh --for-task gap-ac36-recommended-exposes-sort-key` 退出 0——52 测试全绿（slot-refill 38 含新增 ranking 3 + ac36-sortkey-criterion-check 14）、全部 scoped 静态检查（delivery-inventory / capability-catalog / task-contract / tick-core-static / …）通过
- [ ] AC5: **全量套件绿**——verification-round 验证（外层 verification-round 判定，inner 不预勾）

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：--json 暴露排序键 + 检查器机械断言位次前移/负控制（贴输出）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/slot-refill.ts（AC2：recommended 带排序键或 ranking 数组）
- plugin/scripts/ac36-sortkey-criterion-check.ts（AC3：判据② 机械检查器——断言 DC 任务严格前移 + 同族非 DC 不变 + blocking_suite 之上）
- plugin/test/slot-refill.test.mjs（AC2/AC3：排序键暴露 + 机械断言测试）
- orchestration/manager-phase-goal.md（AC36 判据② 正本——本任务 Proposal 已引用）
- tasks/gap-ac36-delivery-critical-priority-axis.md（交叉标注——AC36 自身的可验证性缺口）
- tasks/gap-ac36-recommended-exposes-sort-key.md（自身：勾 AC + 贴证据）

## Contract

measure   recommended_exposes_sortkey = `node --no-warnings --experimental-strip-types plugin/scripts/slot-refill.ts --root "$PWD" --cap 5 --json` 的 stdout 中 recommended[0] 是否对象（含排序键）
band      recommended_exposes_sortkey = true（对象数组或 ranking 数组，暴露每条的轴）
invariant criterion2_mechanical = 1（判据② 由检查器机械断言，非人工比对）
invariant negative_control_preserved = 1（同族非 DC 位置不变）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/slot-refill.ts --root "$PWD" --cap 5 --json`（贴 recommended/ranking 带排序键）
control   排序键暴露；判据② 机械核；负控制不变；既有不回归
resume    排序键暴露 / 判据② 检查器 / 测试分步提交，任一步完成即写盘

## Evidence（内层实现 2026-08-11）

**AC2 排序键暴露（`plugin/scripts/slot-refill.ts`）**：`--json` 新增 `ranking` 数组——`[{id, deliveryCritical, suiteBlocking, rank}]`，与 `recommended` 字符串数组并行（`recommended` 保持原状，既有消费者/既有测试不回归）。`deliveryCritical` 复用 `parseCandidate`（同一解析源，无新解析器）；`suiteBlocking` 复用 `pool.suite_blocking.tasks`（sort 第一轴同一信号源）；`rank` = 该 id 在 `recommended` 内的下标。halted 时 `ranking` 为空（与 `recommended` 平行）。

**AC3 判据② 机械化（`plugin/scripts/ac36-sortkey-criterion-check.ts`，新增）**：吃两次运行的 slot-refill JSON（`--before <file> --after <file>`），机械断言 (a) DC 任务 rank 严格减小（或从窗口外移入窗口内）；(b) 同族非 DC 相对位次不变（DC 轴只重排 DC 任务，id 序轴不动）；(c) blocking_suite 仍在 DC 之上（`max(sb rank) < min(dc rank)`）。`--dc-id` 可显式指定打 label 任务；缺省自动检测「两次运行间从非 DC 变为 DC」的任务。退出码 0=PASS / 1=FAIL / 2=usage。

**Contract invoke（受控 fixture：三个同族 ready 任务 ac36-aaa/ac36-bbb/ac36-e2e，互不重叠 touches，`--cap 5 --json`）**：

1. **打 label 前（id 序，AC2 排序键暴露）**：
   ```
   recommended: ["ac36-aaa","ac36-bbb","ac36-e2e"]
   ranking: [{"id":"ac36-aaa","deliveryCritical":false,"suiteBlocking":false,"rank":0},…]
   ```
2. **负控制：只给 ac36-bbb 打 label（ac36-e2e 不打）——同族非 DC 相对位次不变**：
   ```
   recommended: ["ac36-bbb","ac36-aaa","ac36-e2e"]
   unlabeled ac36-aaa rank: 1 | ac36-e2e rank: 2（相对 id 序保持）
   ```
3. **打 label 后（ac36-e2e 加 `delivery-critical`）——位次严格前移**：
   ```
   recommended: ["ac36-bbb","ac36-e2e","ac36-aaa"]
   ranking: [{"id":"ac36-bbb","deliveryCritical":true,…,"rank":0},{"id":"ac36-e2e","deliveryCritical":true,…,"rank":1},…]
   STRICT IMPROVEMENT: ac36-e2e rank 2 -> 1
   ```
4. **判据② 机械核（checker，before vs after，DC 自动检测 = ac36-e2e flipped）**：
   ```
   PASS — AC36 判据② mechanically verified: DC ac36-e2e 2→1; negative control (1 same-family non-DC) unchanged; blocking_suite above DC
   checker exit: 0
   ```

**测试**：`plugin/test/slot-refill.test.mjs` 38/38（+3 新增 RANKING 暴露：并行数组 / suite-blocking 轴 / halted 空 ranking）、`plugin/test/ac36-sortkey-criterion-check.test.mjs` 14/14（新增：exposure 原语、DC 严格前移正/负、负控制正/负、blocking_suite 正/负、缺 ranking 失败、端到端 CLI）。`bash scripts/test.sh --for-task gap-ac36-recommended-exposes-sort-key` 退出 0（52 全绿 + 全部 scoped 静态检查通过）。

**随改的入口闸副作用（机件强制，非任务 Touches 直列）**：新增 `plugin/scripts/` 文件触发两道入口闸——(a) `delivery-inventory-drift-gate` ⇒ `docs/proposals/quay-product-outline.md` §6 DELIVERY-INVENTORY 快照重生成（scripts 198→199）；(b) `capability-catalog` AC1c/entry-gate ⇒ `plugin/scripts/capability-catalog.sh` 五个声明表（QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING）各加 `ac36-sortkey-criterion-check.ts` 一行。

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: manager 实测——AC36 判据② 不可机械核：recommended 纯字符串数组、顶层键无排序字段，位次前移只能人工比对。立案：recommended 带排序键 + 判据② 机械化。实现归 inner
