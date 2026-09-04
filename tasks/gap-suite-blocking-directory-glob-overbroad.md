---
id: gap-suite-blocking-directory-glob-overbroad
title: computeSuiteBlocking 用 failureFileMatches 把 Touches 的目录 glob（如
  plugin/test/）展开匹配任何测试失败——gap-crystallization-five-directions 的 Touches 含
  plugin/test/（各 AC 测试）⇒ 被判为 suite-blocker 排到 recommended 第
  1，而它并未真引起本轮失败；over-broad attribution 污染 blocking_suite 轴
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

**`computeSuiteBlocking` 的 suite-blocker 归因把 Touches 里的目录 glob（如 `plugin/test/`）展开后匹配【任何】测试失败——`gap-crystallization-five-directions` 的 Touches 含 `plugin/test/（各 AC 测试）` ⇒ 它被判为 suite-blocker 排到 `recommended` 第 1，而它并未真引起本轮失败。这是 over-broad attribution 污染 `blocking_suite` 轴。**

### 实证（manager 2026-08-10 10:0x 读数矛盾 + outer 复核）

- **读数矛盾（manager 报）**：`recommended` 第 1 位 `gap-crystallization-five-directions`（无 delivery-critical label），第 2 位才是带 label 的 AC37。按判据①「DC 低于 blocking_suite」，若 crystallization 不是 suite-blocker，这个排序就违反注释。
- **outer 复核**：`computeSuiteBlocking`（ready-pool-check.ts:666）用 `failureFileMatches(declared, f)` 匹配 Touches 展开 vs 失败文件。`gap-crystallization-five-directions` 的 Touches 含 **`plugin/test/（各 AC 测试）`——目录 glob**，展开后匹配 `plugin/test/checker-cost.test.mjs` 等**任何** test 失败 ⇒ 被归为 suite-blocker。**它确实在 `suite_blocking.tasks` 里**（outer 复核确认）。
- **真因**：不是 DC 轴的问题——DC 排序正确（`:276-284` `(blocking_suite, delivery_critical, id)`）。是 suite-blocking 归因把「目录 glob」当成「精确失败文件」。
- **连带影响**：`plugin/test/` 目录 glob 出现在任何任务 Touches 里，该任务就会在每次红窗被误判为 suite-blocker。blocking_suite 轴被污染 ⇒ DC 轴被挤到第 2 位（本该第 1）。

**为什么重要**：`blocking_suite` 是排序第一轴（AC36 判据① 明确「DC 低于 blocking_suite」）。它被 over-broad 归因污染后，真实 suite-blocker 和普通任务都会排到 DC 之前——优先级机制的实际行为与注释不符。这是归因粒度问题（failureFileMatches 对目录 glob 的匹配过宽），不是 AC36 的错。

### 选定机制方向（实现归 inner，判定归 outer）

1. **目录 glob 不归因**：`computeSuiteBlocking` 对 Touches 里的**目录 glob**（无通配符的裸目录，如 `plugin/test/`）不展开匹配失败文件——只匹配**具体文件路径 glob**（含通配符或明确文件名）。
2. **或**：`failureFileMatches` 加形状约束——目录 glob 匹配失败文件需更严格（如失败文件必须位于该目录且文件名与 Touches 里的某个具体项匹配）。
3. **负控制**：crystallization 类「Touches 含 plugin/test/ 目录」的任务不再被误判为 suite-blocker（除非其 Touches 含具体失败文件名）。

**验证锚**：修后 (a) `gap-crystallization-five-directions` 不再因 `plugin/test/` 目录 glob 被判 suite-blocker；(b) 真 suite-blocker（Touches 含具体失败文件名）仍正确归因；(c) DC 轴恢复「无 suite-blocker 时排第 1」。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录读数矛盾（crystallization #1 vs AC37 #2）+ outer 复核（Touches 含 plugin/test/ 目录 glob → failureFileMatches 匹配任何 test 失败）（本任务 Proposal 已含）
- [x] AC2: **目录 glob 不归因**——computeSuiteBlocking 对裸目录 glob 不展开匹配失败文件
- [x] AC3: **真 suite-blocker 不回归**——Touches 含具体失败文件名的任务仍正确归因
- [x] AC4: **DC 轴恢复**——无 suite-blocker 时 DC 任务排第 1；负控制
- [x] AC5: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 修后实跑：crystallization 不再因目录 glob 判 suite-blocker（贴 recommended 前 3 位）；真 blocker 仍归因
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Evidence (inner, 2026-08-11)

### 实跑 1 — 真红窗（round 283-285，合成于 worktree .quay）：crystallization 不再判 suite-blocker

`node --no-warnings --experimental-strip-types plugin/scripts/ready-pool-check.ts --root "$PWD" --cap 5 --json`
- window_active: true, consecutive_red: 3
- **crystallization in tasks: false** ✓（修前它在 suite_blocking.tasks 里）
- suite_blocking.tasks（全为「Touches 含具体失败文件名」的真 blocker，抽查确认）：
  `["DIR-118","gap-delivery-inventory-drift-needs-file-add-gate","gap-red-round-loses-overhead-phase-decomposition","gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests","gap-suite-tiering-kind-heavy-not-a-mechanism","gap-systemd-run-cancel-cpuquota-keep-memory-guardrail","gap-task-file-static-syntax-should-not-block-product-verification","gap-threshold-scope-load-flake-fifth-family-member","gap-write-ownership-extend-beyond-tasks-to-outer-core-and-hot-files"]`

### 实跑 2 — 同真红窗 slot-refill recommended（DoD「贴 recommended 前 3 位」）

`node --no-warnings --experimental-strip-types plugin/scripts/slot-refill.ts --root "$PWD" --cap 5 --json`
- recommended = ["gap-task-file-static-syntax-should-not-block-product-verification","gap-systemd-run-cancel-cpuquota-keep-memory-guardrail","gap-suite-blocking-self-lock-blocks-fix-family", ...]
- rank0 是「真 blocker + delivery-critical」双轴命中任务；**crystallization 不在 recommended 中**（修前它排第 1）
- 真 blocker 仍归因：rank0/rank1 的 suiteBlocking: true 均来自 Touches 里的具体失败文件名（如 plugin/test/threshold-scope-check.test.mjs、plugin/test/full-suite-runner.test.mjs、scripts/test.sh 命中的 test.sh bare-basename 失败）

### 实跑 3 — ghost 红窗（唯一失败 plugin/test/ghost-failure.test.mjs，无任务具体触碰）：suite_blocking.tasks = [] + DC 排第 1

- ready-pool-check: `suite_blocking.tasks: []`（目录 glob 不再展开匹配任何 test 失败）
- slot-refill: recommended[0] = gap-judgment-computed-not-wired-to-action, deliveryCritical: true, suiteBlocking: false, rank 0 ✓（AC4：无 suite-blocker ⇒ DC 任务排第 1）

### 实跑 4 — scoped 门（AC5）

`bash scripts/test.sh --for-task gap-suite-blocking-directory-glob-overbroad --allow-thin` → **EXIT=0**
- tests 75 / pass 75 / fail 0 / cancelled 0
- 新增测试全部在 scoped 门内跑：isDirectoryGlob 分类（AC2）/ computeSuiteBlocking 目录 glob 不归因+真 blocker+file-scoped 通配仍归因（AC2/AC3）/ analyzeTasks 集成级 AC4 负控制（无修则 2 fail，已证）

### 提交（worktree task/gap-suite-blocking-directory-glob-overbroad）

- `10277750` 归因收紧——computeSuiteBlocking 对目录 glob（裸目录/plugin/test/**）不展开匹配失败文件，只匹配 file-scoped glob（isDirectoryGlob helper）
- `8184b7ed` 形状约束——failureFileMatches 对 directory-shaped 声明项（裸目录 token）在 basename 反查中不匹配失败文件（防御纵深）
- `fd611683` 测试——isDirectoryGlob 分类 / computeSuiteBlocking AC2-AC3 / slot-refill DC 轴恢复
- `ba28da24` 测试补充——analyzeTasks 集成级 AC4 负控制

## Touches

- plugin/scripts/ready-pool-check.ts（AC2：computeSuiteBlocking 对目录 glob 不归因）
- plugin/scripts/（AC3：failureFileMatches 形状约束）
- plugin/test/ready-pool-check.test.mjs（AC2-AC4：目录 glob 不归因 / 真 blocker 不回归 / DC 恢复）
- tasks/gap-ac36-delivery-critical-priority-axis.md（交叉标注——DC 轴被污染）
- tasks/gap-ac36-recommended-exposes-sort-key.md（交叉标注——同 AC36 验证链）
- tasks/gap-suite-blocking-self-lock-blocks-fix-family.md（交叉标注——同族判据：本任务收窄「目录 glob 不归因」，它豁免「修 suite 任务不归因」——两个都是 suite_blocking 归因过宽/自锁的面，修法都在 computeSuiteBlocking 的归因循环）
- tasks/gap-suite-blocking-directory-glob-overbroad.md（自身：勾 AC + 贴证据）

## Contract

measure   directory_glob_not_suite_blocker = `node --no-warnings --experimental-strip-types plugin/scripts/ready-pool-check.ts --root "$PWD" --cap 5 --json` 的 stdout 中 suite_blocking.tasks 是否含 gap-crystallization-five-directions
band      directory_glob_not_suite_blocker = false（crystallization 不再仅因 plugin/test/ 目录 glob 被判 suite-blocker）
invariant real_suite_blocker_still_attributed = 1（真 blocker 仍归因）
invariant dc_axis_restored = 1（无 suite-blocker 时 DC 排第 1）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/ready-pool-check.ts --root "$PWD" --cap 5 --json`（贴 suite_blocking.tasks）
control   目录 glob 不归因；真 blocker 不回归；DC 恢复；既有不回归
resume    归因收紧 / 形状约束 / 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: manager 读数矛盾（crystallization #1 vs AC37 #2）+ outer 复核根因：computeSuiteBlocking 对 Touches 目录 glob（plugin/test/）展开匹配任何 test 失败 ⇒ over-broad 归因污染 blocking_suite 轴。非 AC36 之错，是归因粒度问题。立案：目录 glob 不归因。实现归 inner