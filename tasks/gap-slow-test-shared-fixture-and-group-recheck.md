---
id: gap-slow-test-shared-fixture-and-group-recheck
title: quay-init-loop / cli / delivery-smoke 慢测试——共享 fixture 化 + 分组复核（按实测前后对照，不按预测数字）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

2026-08-12 的一轮套件日志（`.quay/full-suite-retrigger.log`）曾把以下 4 个文件列为慢测试候选：
`delivery-standalone-smoke-gate.test.mjs`（261s）、`cli.test.mjs`（157s）、
`quay-init-loop-core.test.mjs`（132s，误记为 product 组）、`gap002-create-ergonomics.test.mjs`
（116s，5.16x 增长）。**本任务落笔前用 `.quay/measure-history.jsonl` 最新一轮（2026-09-03）重新核实
了这 4 个文件的当前状态**——距那次分析已 3 周，期间 `gap-suite-extend-shared-install-cache`（done,
2026-08-30）等任务已经落地，前提发生了实质变化：

| 文件 | 08-12 分析 | 09-03 实测 | 现状 |
|---|---|---|---|
| delivery-standalone-smoke-gate.test.mjs | 261s | **57s**（-78%） | 已不在套件 Top20；文件头注释声称"2026-08-12 moved product→serial"但 `@test-group` 行仍是 `product`——**文档与代码不一致**，需要核实原委，不需要再做 npm 基线共享（已有 amortize baseline，见文件第 44-50 行） |
| cli.test.mjs | 157s | **92.6s**（-41%） | 已不在套件 Top20 |
| quay-init-loop-core.test.mjs | 132s（误记 product） | **139s** | `@test-group` 实际**已经是 `serial`**（非 product），套件 Top20 第 9 名 |
| gap002-create-ergonomics.test.mjs | 116s（5.16x↑） | **38s**（-67%） | 已不在套件 Top20 |

**结论：4 个目标里 3 个（delivery-smoke / cli.test / gap002）已经大幅改善，不再是当前瓶颈；真正
仍然慢、且缺共享 fixture 的是 `quay-init-loop.test.mjs`（122s，套件 Top20 第 15 名，**未 import
`sharedFixture`，只用 `makeTmp`/`cleanup`/`runInit`）和 `quay-init-loop-runtime.test.mjs`（124s，
Top20 第 14 名，已接 `sharedFixture` 但仍慢——说明缓存命中之外还有别的成本，需要先分解再动手，不能
假设"接 fixture = 变快"）。

**已核实的第二个前提问题**：[[gap-suite-cost-model-is-wrong-optimizations-buy-nothing]]（done）
用两次全量实测否定了"单文件耗时节省 ⇒ 等比例墙钟节省"的模型——118s 的单文件节省当时只换来 2s 的
墙钟改善（Σ duration_ms / 墙钟 ≈ 7.1-7.19 ≈ 并发度 8，套件处于 **lane 饱和** 状态：并发组里搬走
一个慢文件，其他文件填补空出的 lane，Σ 不变，墙钟未必下降）。**因此本任务的 AC 不设"预期节省 Xs"
这类无法验证的数值目标**（该模式已被 CLAUDE.md 硬规则 4 推论明确否定：「成本结构未知前不设数值
阈值」），改为要求每个改动都有**同机、干净基线上的前后实测对照**（隔离墙钟 + 套件内 Σ 贡献两个
量），数据说话。

**已核实的第三个约束**：`plugin/scripts/test-group-downgrade-check.ts` 存在，任何
`product|engine → serial|lowconc` 的 `@test-group` 改动必须在提交信息里带字面量标记
`@test-group-downgrade` 并说明理由，否则套件红。**本任务若要做任何分组降级，必须先用前后实测
证明净墙钟下降，再落地改动并按此规则提交**——不能像 delivery-standalone-smoke-gate 的文档注释
那样，声称移动了却未必真的落地（现状 tag 仍是 product，需要先搞清楚那次改动是被 revert 了还是
从未真正提交）。

## Plan

1. **核实 delivery-standalone-smoke-gate 的 product/serial 不一致**：`git log -p --follow -S
   '@test-group' -- packages/quay/test/delivery-standalone-smoke-gate.test.mjs` 找到 2026-08-12
   声称的那次改动，确认它是被 revert、从未提交、还是文档注释本身就是过期的（该文件当时可能被别的
   任务改回 product）。按结果二选一：文档过期就订正注释；若改动确实该落地就走
   `test-group-downgrade-check.ts` 的合规路径（前后实测 + commit 标记）。不预设答案。
2. **quay-init-loop.test.mjs 接入 sharedFixture**：参照 `quay-init-loop-runtime.test.mjs` 已经
   接入的方式（`plugin/test/quay-init-loop-helpers.mjs` 的 `sharedFixture` /
   `sharedFixtureVariant`），把该文件里重复的 `makeTmp` + 全新 install 换成 fixture 副本，不改变
   任何断言语义。
3. **分解 quay-init-loop-runtime.test.mjs 仍慢的原因**：它已经用了 `sharedFixture`（第 34-37 行
   注释自称 AC1 已接），却仍是 Top20 第 14 名（124s）——先用现有的断言汇聚点计时手法（同
   `gap-suite-cost-model-is-wrong-optimizations-buy-nothing` AC1b 对 cli/serve/mcp-server 的做法，
   env-gated、零断言改动）定位耗时集中在 fixture 命中前的一次性构建，还是命中后仍有的其他真实
   I/O，再决定要不要继续动它——**不假设"缓存已加=问题已解"**。
4. **cli.test.mjs 的工作区合并（低优先级，先复核是否仍值得）**：现状 92.6s、已不在 Top20；若
   步骤 1-3 完成后仍有余量，再评估是否合并前几个非 GitHub 测试的工作区初始化（GitHub 相关测试
   需要独立 QUAY_GITHUB_REPO，不能合并）。不作为本任务的强制交付项。
5. **前后对照**：同一 commit 上，改动前后各跑一次相关文件的隔离墙钟（`node --test <file>`）与一次
   全量套件（记录 Σ duration_ms 和总墙钟），两组数字都贴进 Measured。

## Acceptance Criteria

- [ ] AC1（能取假，历史核实）：`delivery-standalone-smoke-gate.test.mjs` 的 `@test-group` 与其
      文档注释「2026-08-12 moved product→serial」的不一致原因被写清（git log 证据贴入任务体），
      并按结果二选一处理（订正注释，或走 downgrade 合规路径）——不得两者都不做。
- [ ] AC2（能取假，实现）：`quay-init-loop.test.mjs` 改用 `sharedFixture`/`sharedFixtureVariant`
      后，该文件全部测试通过（隔离跑 `node --test plugin/test/quay-init-loop.test.mjs`），且不依赖
      测试执行顺序（任意顺序重跑仍通过）。
- [ ] AC3（能取假，测量）：`quay-init-loop-runtime.test.mjs` 的耗时用断言汇聚点计时法分解，输出
      ≥1000ms 间隔的分布（同 AC1b 手法），贴入任务体；据此明确回答「fixture 命中后剩余的 124s
      主要花在哪」，而不是停在"已经接了 sharedFixture"这句话上。
- [ ] AC4（能取假，前后对照，AC2 纪律 0-cancelled）：AC2 改动前后，`quay-init-loop.test.mjs` 的
      隔离墙钟对比（改动前基线 122s，见 09-03 实测）+ 全量套件的 Σ duration_ms 与总墙钟前后对比，
      都贴进 Measured；若 AC3 发现 runtime 文件仍有可动空间，同法测它。**不写"预期节省 Xs"，只写
      实测到的差值**。
- [ ] AC5（能取假，可选，仅在 AC1 判定需要真正降级时触发）：任何 `@test-group` 从
      `product|engine` 到 `serial|lowconc` 的改动，其提交信息含字面量 `@test-group-downgrade`，
      `node plugin/scripts/test-group-downgrade-check.ts` 通过（exit 0）。
- [ ] AC6：改动落地后，`scripts/test.sh` 全量跑通（0 failed，0 cancelled）。

## Definition of Done

`quay-init-loop.test.mjs` 接入共享 fixture 且隔离/套件内耗时的前后实测都在任务体里（不是预测）；
`quay-init-loop-runtime.test.mjs` 的剩余耗时来源已被分解定位（不是停留在"已接 fixture"）；
delivery-standalone-smoke-gate 的文档/tag 不一致已被核实并处理；全量套件保持 0 failed / 0
cancelled；本任务未凭空设立任何未经测量的墙钟目标数字。

## Touches

- plugin/test/quay-init-loop.test.mjs
- plugin/test/quay-init-loop-runtime.test.mjs
- plugin/test/quay-init-loop-helpers.mjs
- packages/quay/test/delivery-standalone-smoke-gate.test.mjs
- packages/quay/test/cli.test.mjs
- tasks/gap-slow-test-shared-fixture-and-group-recheck.md