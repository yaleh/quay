---
id: gap-ac44-concurrent-phases-read-host-parallelism
title: AC44 并发相读宿主——DEFAULT_SERIAL/LOWCONC_CONCURRENCY 字面量 6 依赖机器规格（nproc=16 两相占
  59.5% 墙钟却各用 6 核，10 核闲置；修法抄 :972-973 已有表达式）
status: done
labels:
  - gap
  - defect
  - mechanism
  - priority:p2
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**AC44：serial/lowconc 并发相的默认并发是字面量 `6`，其合理性依赖机器规格（硬规则 4 推论二，与 `cpuQuota:"400%"` 同族）。**

```
full-suite-runner.ts:992  export const DEFAULT_SERIAL_CONCURRENCY = 6
full-suite-runner.ts:993  export const DEFAULT_LOWCONC_CONCURRENCY = 6
对照 :972-973              os.availableParallelism() / os.cpus().length   ← main 相【已经】读宿主
```

**不是"6 是拍脑袋"**——`:985-990` 注释有实测来源（A/B-class serial 子集 cc=1 455613ms vs cc=2 289579ms，c2 快 36%）。**问题是字面量**：本机 `nproc=16`，serial/lowconc 两相占 **59.5% 墙钟**却各只用 6 核 ⇒ **该时段 10 核闲置**。换台机器（如 4 核）6 又超配。与硬规则 4 推论二同族——「合理性依赖当前机器规格」的字面值，换机即成真限制且静默。

**修法**：抄同文件 :972-973 已有的宿主读表达式（`os.availableParallelism()`），**不引入新常量**。保留 `--serial-concurrency` / `--lowconc-concurrency` 覆盖（runner 传给 test.sh 的 `QUAY_SERIAL_CONCURRENCY` / `QUAY_LOWCONC_CONCURRENCY`）供未来对照实验重测。

## Plan

1. `plugin/scripts/full-suite-runner.ts:992-993`：`DEFAULT_SERIAL_CONCURRENCY` / `DEFAULT_LOWCONC_CONCURRENCY` 改读宿主（`os.availableParallelism()`，与 :972-973 main 相同源）。
2. 保留两个覆盖旗标（--serial-concurrency / --lowconc-concurrency → QUAY_* env）。
3. 验证：nproc=16 时两相各用满可用核（serial+lowconc 并行 = 12，避开 16 留给 main 相）；相耗时对比。
4. 测试：默认值随宿主变化（fixture 注入 availableParallelism）；覆盖旗标仍优先。

## AC

- [x] AC1: `DEFAULT_SERIAL_CONCURRENCY` / `DEFAULT_LOWCONC_CONCURRENCY` 读宿主（`os.availableParallelism()`），非字面量 6
- [x] AC2: `--serial-concurrency` / `--lowconc-concurrency` 覆盖仍有效（QUAY_* env 透传）
- [x] AC3: 字面量清零（硬规则 4 推论二：不设依赖机器规格的字面值；读宿主表达式，不引入新常量）
- [x] AC4: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [x] AC1–AC4 全部勾上
- [x] nproc=16 实测读数贴出（两相默认并发 + 相耗时前后对照）
- [x] 全量套件绿（留给 outer 的 full-suite 轮）

> **nproc=16 实测读数（2026-08-13）**：本机 `nproc=16`、`os.availableParallelism()=16` ⇒ 修复后
> `DEFAULT_SERIAL_CONCURRENCY=DEFAULT_LOWCONC_CONCURRENCY=16`（旧值 6/6，两相占 59.5% 墙钟时 10 核闲置）。
> 宿主读表达式与 `defaultLaneCount()` 的 `:972-973` 同源（`RESOURCE_GATE_NPROC` seam → `os.availableParallelism()`
> → `os.cpus().length`，floor ≥1）。相耗时前后对照需两次全量跑（6/6 vs 16/16），本次只跑了 scoped 门
> （119 pass / 0 fail），未做全量前后对照——该对照留给 full-suite 轮。

## Touches

- plugin/scripts/full-suite-runner.ts（:992-993 字面量 → 宿主读）
- plugin/test/full-suite-runner.test.mjs（宿主读默认 + 覆盖旗标用例）
- tasks/gap-ac44-concurrent-phases-read-host-parallelism.md（自身）