---
id: gap-archguard-p4-guard-lineage-declaration-and-registry
title: 落地 P4 守卫谱系（guard-lineage-check.ts）——头部声明块 + verdict 记录流，165 个守卫中今天 0% 已声明守卫对象
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  depends_on:
    - gap-checker-cost-jsonl-add-verdict-field
    - gap-archguard-p5-instrument-decay-standing-guard
---
**type:** execution

## Proposal

正本 `docs/proposals/archguard-generation-era-primitives.md` §3 P4（守卫谱系 Guard Lineage）已给出
定义（每个检测器机器可读地声明四元组 `⟨guards, wired-into, last-run, last-fired⟩`，工具核验前两项、
记录后两项）、计算方法、可证否的验收判据与反向判据。

依赖两个前置任务：
- [[gap-checker-cost-jsonl-add-verdict-field]] 提供 `verdict` 字段——P4 的"曾变红比例"今天算不出来，
  直接原因就是这个字段缺失（文档原文）；
- [[gap-archguard-p5-instrument-decay-standing-guard]] 的 `last-fired`/写入速率判断逻辑可直接复用，
  不重新实现一套时间序列分析。

两项须先落地本任务才能开工，本任务只做：① 守卫头部声明块（可复用现有
`plugin/scripts/capability-catalog.sh` 的登记位，新增字段声明该守卫"守的是什么对象/不变式"）；
② 把 verdict 记录流接进谱系查询。

## AC

- [ ] AC1：对本仓库全部守卫（文档测量口径见 §2.3：`plugin/scripts/` + `experiments/quay-perpetual-stream/scripts/`
      + `plugin/gate-scripts/` 按目录去重、排除 worktree 与 gitignored 镜像，文档记录 165 个），现场
      重新枚举一遍（数字可能已随开发变化，以现场跑出的为准，不照抄文档旧数字），工具须能报出"已
      声明守卫对象的比例"（文档记述今天应为 0%，落地时须现场核实此值是否已变——本任务的 AC3 会让
      它变为非零，AC1 测的是本任务开工前的现状）
- [ ] AC2：报出"窗口内曾变红的比例"（依赖 `verdict` 字段，若 [[gap-checker-cost-jsonl-add-verdict-field]]
      落地不完整则本 AC 标 `not-evaluated`，不得伪造非零值）
- [ ] AC3：为至少 5 个真实守卫脚本补上声明块作为试点——建议选文档 §2.3"职责重叠"表里 3 组之一
      （如 `manager-tick-log-check.sh` vs `outer-tick-log-check.sh`）+ `checker-mutation-check.sh`
      这类预防性守卫，覆盖正反两种形态；声明后工具能逐个回答"该守卫的对象是否仍存在"
- [ ] AC4（反向判据，文档已给）：不得把 `checker-mutation-check` 这类**预防性**守卫因"从未变红"报为
      可疑——判定必须同时采信 `last-fired` 与 `mutation-verified` 两项证据，须提供该负例的真实脚本
      输出
- [ ] AC5：新增单测 `plugin/test/guard-lineage-check.test.mjs`，
      `node --experimental-strip-types plugin/test/guard-lineage-check.test.mjs` exit 0

## DoD

AC1/AC2 的真实现场输出贴进任务体；AC3 的 5 个试点声明块真实写入对应脚本文件并被工具正确读出（贴
读出结果）。脚本接入 capability-catalog 登记。

## Touches

- plugin/scripts/guard-lineage-check.ts（新增）
- plugin/scripts/capability-catalog.sh（登记新脚本 + 试点声明块）
- plugin/test/guard-lineage-check.test.mjs（新增）
- tasks/gap-archguard-p4-guard-lineage-declaration-and-registry.md
