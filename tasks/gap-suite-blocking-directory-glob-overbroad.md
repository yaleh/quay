---
id: gap-suite-blocking-directory-glob-overbroad
title: 'computeSuiteBlocking 用 failureFileMatches 把 Touches 的目录 glob（如 plugin/test/）展开匹配任何测试失败——gap-crystallization-five-directions 的 Touches 含 plugin/test/（各 AC 测试）⇒ 被判为 suite-blocker 排到 recommended 第 1，而它并未真引起本轮失败；over-broad attribution 污染 blocking_suite 轴'
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

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：crystallization 不再因目录 glob 判 suite-blocker（贴 recommended 前 3 位）；真 blocker 仍归因
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/ready-pool-check.ts（AC2：computeSuiteBlocking 对目录 glob 不归因）
- plugin/scripts/（AC3：failureFileMatches 形状约束）
- plugin/test/ready-pool-check.test.mjs（AC2-AC4：目录 glob 不归因 / 真 blocker 不回归 / DC 恢复）
- tasks/gap-ac36-delivery-critical-priority-axis.md（交叉标注——DC 轴被污染）
- tasks/gap-ac36-recommended-exposes-sort-key.md（交叉标注——同 AC36 验证链）
- tasks/gap-suite-blocking-directory-glob-overbroad.md（自身：勾 AC + 贴证据）

## Contract

measure   directory_glob_not_suite_blocker = `node --no-warnings --experimental-strip-types plugin/scripts/ready-pool-check.ts --root "$PWD" --cap 5 --json` 的 stdout 中 suite_blocking.tasks 是否含 gap-crystallization-five-directions
band      directory_glob_not_suite_blocker = false（crystallization 不再仅因 plugin/test/ 目录 glob 被判 suite-blocker）
invariant real_suite_blocker_still_attributed = 1（真 blocker 仍归因）
invariant dc_axis_restored = 1（无 suite-blocker 时 DC 排第 1）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/ready-pool-check.ts --root "$PWD" --cap 5 --json`（贴 suite_blocking.tasks）
control   目录 glob 不归因；真 blocker 不回归；DC 恢复；既有不回归
resume    归因收紧 / 形状约束 / 测试分步提交，任一步完成即写盘

## Evidence（内层实现 2026-08-11）

**AC2 实现**：`plugin/scripts/touches-orthogonality-check.ts` 的 `parseTouches` 新增返回 `dirGlobs`
（Set，记录「裸目录声明」经 DIR-106 Fix 3 变成的 `**` glob，如 `plugin/test/` → `plugin/test/**`，
向后兼容——既有调用方只解构 `{hasSection, globs}`，忽略新字段）。`plugin/scripts/ready-pool-check.ts`
的 `computeSuiteBlocking` 把 `parsed.dirGlobs` 从归因 glob 集排除后再 `expand`+`failureFileMatches`
——裸目录 glob（整棵子树）不再参与 suite-blocking 归因；只匹配具体文件路径 glob（含通配符或明确文件名）。

**AC3 不回归**：真 suite-blocker（Touches 含具体失败文件名，如 `code/wd.ts`、`plugin/test/checker-cost.test.mjs`、
`plugin/scripts/send-keys-verified.sh`）仍正确归因；同一任务「目录 glob + 具体文件」并存时，具体文件仍归因。

**AC4 负控制**：无红窗 ⇒ suite_blocking.tasks 空 ⇒ ready_relevance 排序与 pre-signal 字节一致（既有
`analyzeTasks: suite-blocking jumps ready_relevance; negative control unchanged` 测试覆盖）；crystallization
不再仅因 `plugin/test/` 目录 glob 被误判为 suite-blocker ⇒ DC 轴恢复「无真 suite-blocker 时排第 1」。

**Scoped invoke**（`bash scripts/test.sh --for-task gap-suite-blocking-directory-glob-overbroad --allow-thin`）：
**64 tests · pass 64 · fail 0 · cancelled 0 · skipped 0 · EXIT 0**。新增测试
`computeSuiteBlocking: bare-directory glob does NOT attribute (AC2 — gap-suite-blocking-directory-glob-overbroad)`
覆盖：crystallization 型任务（Touches 含 `plugin/test/（各 AC 测试）`）在 plugin/test 失败时不归因；仅目录 glob
的任务不归因；目录 glob + 具体文件并存时具体文件仍归因。`touches-parser-parity.test.mjs` 8/8 全绿（parseTouches
改动不破坏多解析器 parity）。

**真实 store 定向模拟**（3 连红窗、失败文件 `plugin/test/checker-cost.test.mjs`，`computeSuiteBlocking` 对
`tasks/` 全量）：
```
suite_blocking.tasks = []
crystallization flagged (dir glob)? false
window_active = true consecutiveRed = 3
spec-file task flagged (real blocker still attributed)? true
```

**交叉标注**：`tasks/gap-ac36-delivery-critical-priority-axis.md`（blocking_suite 轴污染修复）、
`tasks/gap-ac36-recommended-exposes-sort-key.md`（同 AC36 验证链）。

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: manager 读数矛盾（crystallization #1 vs AC37 #2）+ outer 复核根因：computeSuiteBlocking 对 Touches 目录 glob（plugin/test/）展开匹配任何 test 失败 ⇒ over-broad 归因污染 blocking_suite 轴。非 AC36 之错，是归因粒度问题。立案：目录 glob 不归因。实现归 inner
