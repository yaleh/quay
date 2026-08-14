---
id: gap-ac74-serial-lowconc-literal-direct-path
title: AC74 serial/lowconc 直调路径遗留字面量 2/3——AC44 只修了 runner 一侧，subagent 直调拿 8/8
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**AC74（serial/lowconc 直调路径遗留字面量 —— manager 2026-08-14 06:3xZ 报，历史链逐条核对）**。

**建议值历史链（全读正本）**：
```
最早    scripts/test.sh 硬编码 serial=1（"串行隔离是机制不变量、永不可配"）
实验    gap-load-sensitive-serial-phase-unbounded-growth-measure-first（2026-08-10，AC3 done）
        A/B-class serial 子集 6 文件：cc=1 WALL_MS=455613 vs cc=2 WALL_MS=289579 ⇒ c2 快 36% ⇒ serial 默认 1→2
AC44    gap-ac44-concurrent-phases-read-host-parallelism（done）「字面量 6 依赖机器规格」⇒ 改读宿主
        full-suite-runner.ts:1605-1606  DEFAULT_SERIAL/LOWCONC_CONCURRENCY = max(1, floor(hostParallelism()/concurrentSuiteSlots()))
        ⇒ 本机 16/2 = 【serial 8 / lowconc 8】
```
**⇒ 现行建议值 = serial 8 / lowconc 8**（与 main 相同 host÷slots），AC44 已 done，不是提案。

**缺陷（实质）**：AC44 只修了 **runner 一侧**；**直调一侧还是 AC44 之前的字面量**——
```
runner 路径   full-suite-runner.ts:2122-2123 传 env：QUAY_SERIAL_CONCURRENCY=8 / QUAY_LOWCONC_CONCURRENCY=8
              ⇒ test.sh 拿到 8/8（host÷slots）
subagent 路径  今天实测调用形态：cd <wt> && bash scripts/test.sh …  ← 直调，不经 runner ⇒ env 未设
              ⇒ 落到 scripts/test.sh:820-821 字面量
                SERIAL_CONCURRENCY="${QUAY_SERIAL_CONCURRENCY:-2}"
                LOWCONC_CONCURRENCY="${QUAY_LOWCONC_CONCURRENCY:-3}"
              ⇒ 实际跑 serial=2 / lowconc=3
且这两个值确在全量路径生效：scripts/test.sh:1370-1371 `node --test --test-concurrency="$SERIAL_CONCURRENCY"` 等
```
**⇒ 硬规则 4 推论二（依赖宿主的字面量）的原样复发——AC44 正是为治它而立的。** 与 AC73 姊妹形态：**同一个默认值在一条路径生效、另一条路径不生效**（AC73 是"一个量在一个方向有消费者、另一方向零"）。

**与人警告直接相关**：人 06:3xZ 逐字「后续我们还要继续优化 suite 测试耗时。这也是为什么对于 suite 测试的 lane 设置不能随便降低。」**这里不是有人提议降低，是【一条已被 AC44 提高的设置，在 subagent 直调路径上从未生效】。AC67 之后全量 suite 全部走 subagent 直调 ⇒ 这条会成为默认，而不是边角。**

**判据（形态：与 runner 同源的宿主推导）**：
- **判据1**：`scripts/test.sh:820-821` 的 `SERIAL_CONCURRENCY` / `LOWCONC_CONCURRENCY` 默认值改为**读宿主**（与 full-suite-runner.ts:1605-1606 同源：`max(1, floor(hostParallelism() / concurrentSuiteSlots()))`），或改为「env 缺失时读宿主」——不再遗留 2/3 字面量。
- **判据2（能取假）**：**同一台机器上，`bash scripts/test.sh`（直调）与经 runner 起的两条路径，`SERIAL_CONCURRENCY`/`LOWCONC_CONCURRENCY` 读数必须相同**——**现在就是红**（直调 2/3 vs runner 8/8）。D2 不构造。
- **判据3（不重定数值）**：不另设数值（人已警告 + AC44 已定值）；只统一两路径的推导源。
- **判据4**：`concurrency-literal-check` 为什么没拦——它扫的是裸字面量（`DEFAULT_SERIAL_CONCURRENCY=6`），而 test.sh:820 是 `:-2` env-fallback 形态，不是裸字面量 ⇒ 未被扫到。**这是覆盖缺口，但本任务不扩展它**（判据2 的两路径读数相同是主判据）。

**止损（C21，manager ⑤）**：**不需要 —— 现在生效的是 8/8**（subagent 跑 scoped `--for-task`，全量仍由 inner 主线程经 runner 起，今天实测 05:17:15Z）。**⚠️ 绑读数：AC67 落地那一刻止损失效**——那时全量 suite 改走 subagent 直调，2/3 立刻成为实际值、并发砍 4×。**⇒ 本任务应当在 AC67 落地前修完。**

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 scripts/test.sh:811-821（字面量 + env-fallback）+ full-suite-runner.ts:1605-1606（host 推导）+ :2122-2123（env 传递）。
2. 判据1：test.sh 默认值改读宿主（与 runner 同源），不遗留 2/3。
3. 判据2：直调 vs runner 两路径读数相同（现在红 2/3 vs 8/8，D2）。
4. 判据3：不重定数值，只统一推导源。
5. 判据4：concurrency-literal-check 未拦的原因记录（env-fallback 非裸字面量）。
6. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：test.sh 默认值读宿主（与 runner 同源），2/3 字面量消失。
- [ ] AC2 判据2 能取假：同一台机器直调 vs runner 两路径 SERIAL/LOWCONC 读数相同——现在红（2/3 vs 8/8），修后绿（D2 真样本）。
- [ ] AC3 判据3：不重定数值（人警告 + AC44 已定值），只统一推导源。
- [ ] AC4 判据4：concurrency-literal-check 未拦 env-fallback 的覆盖缺口记录（不扩展它）。
- [ ] AC5 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] test.sh 两字面量改为 host 推导（与 runner 同源）+ 两路径读数相同 + 不重定数值。

## Touches

- scripts/test.sh（:820-821 默认值改读宿主——与 full-suite-runner 同源）
- plugin/scripts/full-suite-runner.ts（导出推导函数供 test.sh 复用——若用共享源而非复制）
- （负控制 fixture + 两路径读数对比）
- tasks/gap-ac74-serial-lowconc-literal-direct-path.md（自身）

## Evidence

（落地后回填）
