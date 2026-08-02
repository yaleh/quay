---
id: gap-test-suite-has-no-layer-grouping
title: "Test suite has no layer grouping — 44 methodology tests are invisible to
  CI and governance tests cannot be parked"
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

`scripts/test.sh`'s glob is `packages/*/test/*.test.mjs plugin/test/*.test.mjs`. Everything else is
silently absent — **44 test files under `experiments/quay-perpetual-stream/test/` (18,181 lines)
never run in CI**. They exist, they are maintained, and they produce no signal. That is worse than
either testing them or declaring them untested.

The problem is not just visibility. Per the exp6 scope record (`docs/proposals/exp6-queue-driven-concurrent-executor.md` §0),
the repo carries three distinct test populations with **different lifecycles**, and no way to
address them separately:

| 组 | 内容 | 阶段 1（现在） | 阶段 2（产品交付） |
|---|---|---|---|
| `product` | `packages/*/test/` — Core CLI、Provider ABI、gate engine、web UI | 跑 | 跑 |
| `engine` | 方法论**执行路径**：proposal-convergence、touches-orthogonality、milestone-worktree、composite-*、select-preflight、serial-fanin-absorb、it0-dod-check、it0-split-or-commit-check、wiring-coverage-check、milestone-preparation-check、task-schema、gate-script-base、workflow-event-schema、run-identity、fast-mode-telemetry | 跑（这是当前工作面） | 跑 |
| `governance` | exp5 度量层：chart2-s1/s2/s3、outward-vt-check、vmeta-lag-check、rolling-slope-check、portfolio-choice、deliverable-governor、git-lens-l-*、coupling-graph、preparation-feedback、candidate-* | **封存**（测的是阶段 1 几乎不动的量） | 启用 |

`governance` 必须是**封存而非删除**——它度量产品交付进度，阶段 2 会需要它。删掉等于在阶段 2 重建。

## Chosen mechanism

**声明式分组 + in-file 自跳过，遵循 ADR-019 决策 #1 的既有先例。**

ADR-019 已确立的模式：live-GitHub 测试**留在 glob 内**并自行 skip，所以无凭证的运行报 `skipped` 而非静默缺席。同样的理由适用于分组——被 glob 排除的组是不可见的，自跳过的组是可见的。

1. **每个测试文件声明所属组**，在文件顶部一行：
   ```js
   // @test-group engine
   ```
   缺省（无声明）视为 `engine`，因为那是当前的工作面——遗漏一个声明不会让它悄悄消失。

2. **`scripts/test.sh` 的 glob 扩展到全部三个目录**，包含 `experiments/quay-perpetual-stream/test/*.test.mjs`。44 个此前不可见的测试从此**总是出现在输出里**，要么 pass/fail，要么 skip。

3. **非默认组自跳过**，在任何重量级 import **之前**：
   ```js
   if (process.env.QUAY_TEST_GROUPS && !process.env.QUAY_TEST_GROUPS.split(",").includes("governance")) {
     test("governance group skipped", { skip: "set QUAY_TEST_GROUPS=governance to run" }, () => {});
   } else { /* real tests */ }
   ```
   跳过必须发生在 import 之前——否则被测脚本仍被加载，省不下时间。

4. **`scripts/test.sh --group <name[,name]>`** 设置 `QUAY_TEST_GROUPS`。无参数默认 `product,engine`。

5. **符号链接去重**：`experiments/.../test/` 下已有 12 个符号链接指向 `plugin/test/`（2026-08-02 建立）。glob 扩展后这些会被跑两次。runner 必须按 `realpath` 去重。

**成本约束**：扩展 glob 会引入 44 个文件的加载开销。跳过必须在 import 前发生，且分组后的默认套件墙钟**不得超过当前 378s 的 110%**（即 ≤416s）。这是 AC，不是期望。

**不做**：不删除任何 `governance` 组的测试或实现。不重新组织目录结构（分组是声明，不是位置）。

## Acceptance Criteria

- [ ] AC1: `// @test-group <name>` 声明约定被文档化，合法值为 `product` / `engine` / `governance`
- [ ] AC2: `scripts/test.sh` 的 glob 包含 `experiments/quay-perpetual-stream/test/*.test.mjs`
- [ ] AC3: 符号链接按 `realpath` 去重——12 个链接文件不被跑两次（可通过总测试数验证）
- [ ] AC4: 无参数运行默认组 = `product,engine`；`governance` 报 skipped 而非缺席
- [ ] AC5: `--group governance` 只跑 governance 组
- [ ] AC6: `--group product,engine` 等价于无参数
- [ ] AC7: 未声明组的文件视为 `engine`（遗漏声明不会静默消失）
- [ ] AC8: governance 组的跳过发生在重量级 import **之前**（grep 确认：skip 分支在 `await import` / 顶层 `import` 之前）
- [ ] AC9: 默认组墙钟 ≤416s（当前 378s 的 110%）——实测记录
- [ ] AC10: 三个组的文件数被报告：`scripts/test.sh --list-groups` 输出各组计数
- [ ] AC11: 零测试文件被删除或移动——`git diff --stat` 确认只有声明行新增和 `scripts/test.sh` 改动

## Definition of Done

- [ ] 全部 165 个测试文件带组声明（或明确依赖 AC7 的缺省）
- [ ] 默认组绿、墙钟实测记录在任务体
- [ ] `--group governance` 可单独运行并绿（若不绿，说明封存期间已腐化——记录为发现，不在本任务修）
- [ ] `scripts/test.sh` 无参数行为对 `product`+`engine` 与当前等价（无回归）

## Touches

- scripts/test.sh
- packages/quay/test/*.test.mjs
- packages/quay-native/test/*.test.mjs
- packages/quay-github/test/*.test.mjs
- plugin/test/*.test.mjs
- experiments/quay-perpetual-stream/test/*.test.mjs
- docs/analysis/fast-mode-execution-prompt.md
