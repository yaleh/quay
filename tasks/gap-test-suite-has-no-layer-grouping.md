---
id: gap-test-suite-has-no-layer-grouping
title: "Test suite has no layer grouping — 44 methodology tests are invisible to
  CI and governance tests cannot be parked"
status: needs-human
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

- [x] AC1: `// @test-group <name>` 声明约定被文档化，合法值为 `product` / `engine` / `governance`（scripts/test.sh 头注释 + docs/analysis/fast-mode-execution-prompt.md）
- [x] AC2: `scripts/test.sh` 的 glob 包含 `experiments/quay-perpetual-stream/test/*.test.mjs`
- [x] AC3: 符号链接按 `realpath` 去重——12 个链接文件不被跑两次（`--list-files` 总数为 157 == 去重后唯一 realpath 数；runner 测试断言）
- [x] AC4: 无参数运行默认组 = `product,engine`；`governance` 报 skipped 而非缺席（skip-mode 实测 13 文件报 skipped，0.8s）
- [x] AC5: `--group governance` 只跑 governance 组（`--list-files --group governance` = 13 个 governance 文件）
- [x] AC6: `--group product,engine` 等价于无参数（`--list-files` 输出字节一致）
- [x] AC7: 未声明组的文件视为 `engine`（runner 测试 AC7：临时无声明文件计入 engine）
- [x] AC8: governance 组的跳过发生在重量级 import **之前**——skip 分支在动态 `await import("../scripts/*.ts")` 之前；skip-mode 13 文件合计 0.8s 证明被测模块未加载
- [ ] AC9: 默认组墙钟 ≤416s（当前 378s 的 110%）——**我的估计不满足**，见下「Measured」；权威数字以 fan-in 全量跑为准
- [x] AC10: 三个组的文件数被报告：`scripts/test.sh --list-groups` 输出 product/engine/governance/total
- [x] AC11: 零测试文件被删除或移动。注：diff 还含（a）select-tests-for-touches.test.mjs 里 pin 旧 glob 的 AC11 结构断言被更新（glob 扩展正是本任务目的），（b）新增 plugin/test/runner-grouping.test.mjs + 3 个 fixture

## Definition of Done

- [x] 全部测试文件带组声明：156 个真实文件（86 product + 58 engine + 13 governance）。12 个 experiments 符号链接经 realpath 去重落到已声明的 plugin 文件。任务体原「165」计数已过期（未计入 quay-backlog 2 文件 + select-tests-for-touches 1 文件）
- [ ] 默认组绿——**不绿**：默认套件现在暴露此前不可见的 engine 文件里的 3 个**既有**失败（在 master 主 checkout 同样复现，非 worktree 环境）：symlink-mirror-invocation.test.mjs ×2（fast-mode-telemetry 符号链接调用 guard 未触发；milestone-worktree 输出含时变 nowMs 无法字节一致）、it0-enforcement-with-design-check.test.mjs ×1（D1 real-object 演示报 2 个 DESIGN-MISSING：Clause 10/14 有 enforcement 但 inherited-core.md 缺对应 heading）。这些文件的 diff 只有声明行，非本任务引入；属既有缺陷，需另行跟踪修复，不在本任务修
- [ ] `--group governance` 可单独运行并绿——**不绿**：chart2-s2-delivery-completeness.test.mjs 有 3 个既有失败（S2 交付完整性覆盖率对真实 repo 算成 0.0；master 原文件同样 3 fail）。candidate-synthesis.test.mjs 通过 24/24（早期归因错误，实为 node_modules 未就位时的加载失败误报）。封存期腐化，记录为发现，不在本任务修
- [x] `scripts/test.sh` 无参数行为对 `product`+`engine` 与当前等价（机制等价；runner 测试 7/7 绿）

## Measured (B3-2, worktree, load-caveat)

- governance 13 文件 **skip-mode**（默认组）：0.835s —— pre-import 自跳过生效，被测模块不加载
- governance 13 文件 **run-mode**（--group governance）：~4s，205 tests，202 pass / **3 fail（全在 chart2-s2-delivery-completeness，master 原文件同样 3 fail → 既有）；candidate-synthesis 24/24 通过**
- engine 31 文件（默认组新增运行）：**86.8s**，883 tests，880 pass / 3 fail（symlink-mirror-invocation ×2 + it0-enforcement-with-design-check ×1，均在 master 主 checkout 复现 → 既有）
- **AC9 估计**：当前基线 378s + engine 31 文件 ~87s + runner-grouping 测试 ~8s + governance skip ~1s ≈ **~474s**，约基线的 125%，**超出 416s 上限**。根因：任务成本模型假设「44 文件只有加载开销」，但 engine 组在默认组里**运行**（非仅加载），且其中 proposal-convergence（~63s）与 it0-dod-check（~60s）本身就很重。机制正确；AC9 以 fan-in 权威测量为准。

## Touches

- scripts/test.sh
- packages/quay/test/*.test.mjs
- packages/quay-native/test/*.test.mjs
- packages/quay-github/test/*.test.mjs
- plugin/test/*.test.mjs
- experiments/quay-perpetual-stream/test/*.test.mjs
- docs/analysis/fast-mode-execution-prompt.md
