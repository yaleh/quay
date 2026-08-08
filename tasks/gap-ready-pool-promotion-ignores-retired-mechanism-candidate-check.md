---
id: gap-ready-pool-promotion-ignores-retired-mechanism-candidate-check
title: "ready-pool promotion promoted a task referencing a RETIRED mechanism (gap-prepare-milestone-no-size-aware-routing → prepare-milestone.js deleted under ADR-022) — the strategic-doc-staleness-check --pool-candidate control (review-cadence AC8) flags it, but ready-pool-check's promotion path doesn't consult it; fix: promotion runs the pool-candidate stale check before status todo→ready"
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

**ready-pool 补晋机制未消费 retired-mechanism 候选检查——本 tick 误晋了一个指向已删管线的任务。**

**证据（2026-08-06 00:5xZ 实测）**：
- tick 3.6 按机制补晋 8 个候选，其中 `gap-prepare-milestone-no-size-aware-routing` 被派发后 agent 发现：
  其目标机制 `prepare-milestone.js`/`execute-milestone.js` **已被 ADR-022（2026-08-03）物理删除**（两线快速
  模式为唯一模式）。任务 premise void，agent 正确未实现，只记 disposition（已 merge）。
- **该候选本可被拦截**：`plugin/scripts/strategic-doc-staleness-check.ts --pool-candidate <id>`（review-cadence
  任务 gap-establish-daily-review-cadence-mechanism 的 AC8 回归控制，commit 88a49faa 明确记「do NOT promote…
  ADR-022-retired pipeline task」）对 prepare-milestone 返回 **FAIL（retired mechanism）**，但 ready-pool-check
  的 promotion 路径**不调它**。
- 本会话其余 7 个补晋候选经 `--pool-candidate` 双查**全部 clean**（误晋隔离到这一个），但这是运气不是机制。

**根因**：ready-pool-check.ts 的 promotion 排序只做 touch-disjointness + gap>DIR + touchesResolve；
**不做 retired-mechanism 候选检查**。strategic-doc-staleness-check 的 `--pool-candidate` 存在（review-cadence
AC8），但消费端没接线到 promotion。

**为什么重要**：派发错任务 = 一整个 agent 轮次浪费（agent 发现 premise void、记录 disposition、零产出）。
review-cadence AC8 控制存在却被绕过，是「机制造了检测、检测没接线」的再次实例（本仓反复的失效模式）。

**选定机制方向**：
1. **promotion 接线**：ready-pool-check 补晋候选在 status todo→ready 前调
   `strategic-doc-staleness-check --pool-candidate <id>`，FAIL ⇒ 不补晋（标 needs-human 或记录不晋理由）。
2. 或把 `--pool-candidate` 检查并入 ready-pool-check 的 `touchesResolve` 判定（同一处，机械）。
3. 负控制：7 个 clean 候选仍正常补晋（不误伤）；retired 候选不晋。

**回归基准**：本次误晋（prepare-milestone）修复后 `--pool-candidate` FAIL 的候选不再进入 ready。

## Acceptance Criteria

- [x] AC1: ready-pool-check 补晋前调 `strategic-doc-staleness-check --pool-candidate <id>`，FAIL 不补晋
- [x] AC2: `gap-prepare-milestone-no-size-aware-routing` 不再被补晋（retired-mechanism 拦截）
- [x] AC3: 本会话其余 7 个 clean 候选（productize-manager/split-batch-vocab 等）仍正常补晋（负控制不误伤）
- [x] AC4: 拦截理由机械记录（不晋 = 有痕迹，非静默跳过）
- [x] AC5: 测试 `node:test` + `// @test-group governance`

## Definition of Done

- [ ] AC1-AC5 全勾（补晋前调 strategic-doc-staleness-check --pool-candidate，FAIL 不补晋；gap-prepare-milestone-no-size-aware-routing 被拦截；其余 clean 候选正常补晋负控制；拦截理由机械记录；测试 node:test + @test-group governance）
- [ ] retired-mechanism 候选被拦截实测 + clean 候选不误伤
- [ ] scoped 门 `scripts/test.sh --for-task gap-ready-pool-promotion-ignores-retired-mechanism-candidate-check` 绿

## Touches

- tasks/gap-ready-pool-promotion-ignores-retired-mechanism-candidate-check.md（自身文件：勾 AC + 贴 invoke 证据授权）

- plugin/scripts/ready-pool-check.ts（promotion 接线 --pool-candidate）
- plugin/scripts/strategic-doc-staleness-check.ts（保持；--pool-candidate 已存在）
- plugin/test/ready-pool-check.test.mjs（AC1-AC4 测试）
- tasks/gap-establish-daily-review-cadence-mechanism.md（交叉标注：AC8 控制消费端接线）

## Contract

measure   retired_filter = `node --experimental-strip-types plugin/scripts/ready-pool-check.ts --root "$(pwd)"` stdout 的 promotions 不含 prepare-milestone-no-size-aware-routing
band      retired_filter = 1（retired 候选不晋）
invoke    `node --experimental-strip-types plugin/scripts/strategic-doc-staleness-check.ts --pool-candidate gap-prepare-milestone-no-size-aware-routing`
control   clean 候选（productize-manager 等）仍晋（AC3）；prepare-milestone 不晋（AC2）
resume    接线与负控制分两步提交，任一步完成即写盘

## Execution evidence

**Invoke（Contract / AC2）** — `strategic-doc-staleness-check.ts --pool-candidate gap-prepare-milestone-no-size-aware-routing`（2026-08-08 实跑，exit 1）：
```
FLAGGED: 2 stale reference(s) to deleted classic-pipeline scripts (unannotated)
  tasks/gap-prepare-milestone-no-size-aware-routing.md:25  [prepare-milestone.js]  ...
  tasks/gap-prepare-milestone-no-size-aware-routing.md:28  [execute-milestone.js]  ...
FAIL: candidate references a retired mechanism
```

**Measure（Contract / AC1-AC4）** — `ready-pool-check.ts --root "$(pwd)"`（real store）：
- `promotions` 含 7 个 clean 候选（gap-dod-two-green-runs… / gap-quay-launch-sh… /
  gap-targeted-promotion-operation… / gap-test-concurrency… / gap-batch-merge… /
  gap-closed-bracket… / gap-known-load-sensitive…），**不含** prepare-milestone-no-size-aware-routing（AC2/AC3）。
- `intercepted` 数组机械记录 retired-mechanism 拦截（AC4，reason: retired-mechanism + refs）：
  DIR-119-C / DIR-119-D / DIR-124-A / gap-prepare-milestone-no-size-aware-routing-A/B/C / DIR-118 /
  DIR-124-B* / DIR-124-C / DIR-124-F* / DIR-124-D / DIR-124-A1 等 todo 候选——不晋 = 有痕迹，非静默跳过。

**接线（AC1/AC4）** — `plugin/scripts/ready-pool-check.ts`：
- `buildCandidate` 补晋前调 `judgePoolCandidate(root, id)`（`--pool-candidate` CLI 的同源函数），
  `retiredMechanism` ⇒ `eligible: false` + `retiredRefs`。
- bulk promotion 循环把拦截写进 `intercepted` 输出；`buildTargetedPromotion`（`--targeted`）同样拦截。

**测试（AC5）** — `scripts/test.sh plugin/test/ready-pool-check.test.mjs` → 42 pass / 0 fail
（新增 5 条 retired-mechanism 拦截测试，node:test + `// @test-group governance`）；
scoped 门 `scripts/test.sh --for-task gap-ready-pool-promotion-ignores-retired-mechanism-candidate-check --allow-thin`
→ exit 0，52 pass / 0 fail。

## Dispatch review

reviewer: outer
at: 2026-08-06T03:1xZ
changed: 补充 Dispatch review 段（红窗分诊：contract-check ratchet 报 dispatch-review-missing，
由外层补写；任务本身 todo 待派发，范围不变）。
