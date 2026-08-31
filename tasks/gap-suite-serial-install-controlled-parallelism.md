---
id: gap-suite-serial-install-controlled-parallelism
title: 串行 install 家族受控并行——serial_concurrency 1→2-4 作对照实验（预期 2-4× 墙降）
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

最慢单文件 = quay-init-loop-runtime 208s（16 test / 20 次真运行·拷贝）/ quay-init-loop 143s（8 test / 7 runInit）/ quay-init-loop-driver 130s（17 test / 4 runInit）/ npm-pack-e2e 115s / install-config-e2e-upgrade 107s。install 家族 ~700s 串行是墙的主要构成。`serial_concurrency` 旋钮已存在（suite-params.ts:42，QUAY_SERIAL_CONCURRENCY，schema int≥1，默认 1）；install 家族已收编 concurrency-1 serial 相（known-load-sensitive.ts:52）。方案 = config 里 serial_concurrency 从 1 提到 2-4 作受控实验（同 QUERY_MAIN_TAIL_OVERLAP 模式：对照轮 + 墙读 + flake 门），预期 2-4× 墙降（~700s→~175-350s）。

**风险**：serial_concurrency 全局影响 A/B-class（nested-suite-spawn）→ 并行资源爆炸风险。缓解：flake 门拦截；若 A/B-class 真 flake 则第二阶段收窄作用域（A2：install 家族 per-file 并发上限）。

## Plan

1. config 里 serial_concurrency 提到 2（起步值，人确认 A1 全局先试），作对照轮 + 墙读 + flake 门。

## 落地实测 / Finding（2026-08-31 worker）

**结论：任务前提已过时——`serial_concurrency` 早已不是默认 1，1→2 对照实验早已做过并落地，install 家族慢文件根本不跑在 serial 相。本任务无需任何代码/配置改动。AC1/AC4 由既有机制+证据满足，AC2/AC3 的「suite 绿」由 fan-in 机械 suite 轮验证（本 worker 不跑 suite）。**

**前提①「serial_concurrency 默认 1」不成立**：`scripts/test.sh:576` `SERIAL_CONCURRENCY="${QUAY_SERIAL_CONCURRENCY:-$(serial_lowconc_host_default)}"`，默认是 host-derived（`serial_lowconc_host_default` = `max(1, floor(nproc ÷ (S×P)))`，`test.sh:563-574`）。本机 nproc=16、S=1（无 `.quay/.concurrency`）、P=2（phase overlap 默认 1）⇒ 默认 **8**，不是 1。`suite-params.ts:29-32` 明写 serial/lowconc 并发 host-derived、**故意不落 shipped config 字面量**（硬规则 4 推论二）——把 `serial_concurrency: 2` 写进 config 违反该机制的设计，且在本机是 **8→2 的降级**。

**前提②「1→2 作对照实验（预期 2-4× 墙降）」已做过并落地**：`test.sh:548-550` 记录 2026-08-10 实验——A/B-class serial 子集 cc=1 WALL_MS=455613 vs cc=2 WALL_MS=289579 = **−36%**（1.58×，非 2-4×），0-cancelled；real-install e2e cc=2 实测 0-cancelled。默认已据此上调（先 2、后经 AC44/AC74 改读宿主）。

**前提③「install 家族 ~700s 串行是墙的主要构成」已被兄弟任务证伪**：`gap-suite-serial-install-copy-one-subprocess-batching`（done）实测这 7 个慢文件跑在 **16-lane 并行主池**（laneCount=16，全库无 laneCount=1），1321s 是 total_work 非 serial 墙钟（跨 16 lane 摊开 ~87s）。本 worker 复核 @test-group：quay-init-loop-runtime / quay-init-loop / quay-init-loop-driver = `engine`，npm-pack-e2e / install-config-driven-e2e-* / real-target-verify = `product`——**无一个在 serial 相**（serial 相只收 `@test-group serial`，如 quay-init-drift-report / quay-init-laydown-closure / select-tests-for-touches）。

**⇒ 落地形式**：无代码/配置改动。`.quay/config.yml` 是 gitignored（`.gitignore` `/ .quay/config.yml`），serial_concurrency 字面量既落不了 develop、也不该落（no-literal + 本机是降级）。DoD 原写「serial_concurrency=2 在 develop 上可见」结构上不可达，已按实际重写。

**Needs-Human 根因**：此前「连续修满重试上限仍不合格」的直接根因是任务前提过时——任何 fix-worker 试图「把 serial_concurrency 提到 2」都会撞 gitignore 墙 + 违反 no-literal 机制 + 在本机是降级，闸反复拒是正确行为。

## Acceptance Criteria

- [x] AC1（能取假）：serial_phase_ms 在 QUAY_SERIAL_CONCURRENCY=2 下 vs 基线(1) 有可测墙降——已由 2026-08-10 对照实验满足（test.sh:548-550：cc=1 WALL_MS=455613 → cc=2 WALL_MS=289579，−36%，0-cancelled；可测墙降成立；「2-4×」为目标非判据，实测 1.58×）。
- [ ] AC2（能取假，无 flake）：并行后无新增 flake——全量 suite 绿 + @load-sensitive 家族 ≥3 轮对照零退出（或 flake 率≤基线）。（待外部）
- [ ] AC3（能取假）：完整 suite 绿（落地后真实一轮）。（待外部）
- [x] AC4（能取假，回滚）：unset QUAY_SERIAL_CONCURRENCY → host-derived 默认（test.sh:576 的 `:-` 形，天然 one-key rollback）。

## Definition of Done

serial_concurrency 保持 host-derived 默认（本机=8，不落字面量——no-literal + gitignored + 本机写 2 是降级）；发现与证据已记录在「落地实测 / Finding」段；suite 绿由 fan-in 机械 suite 轮验证（AC2/AC3 待外部）。

## Touches

- tasks/gap-suite-serial-install-controlled-parallelism.md（自身——落地实测/Finding + AC 状态；无代码/配置改动）

## Needs-Human

**执行 2026-08-31T09:01:33.370Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：连续修满 3 次仍不合格（闸在重验证后仍判不合格）

**2026-08-31 worker 复核：根因 = 任务前提过时**（详见「落地实测 / Finding」段）——serial_concurrency 默认已是 host-derived（本机 8 非 1）、1→2 实验已做过并落地（test.sh:548-550）、install 家族慢文件跑在主池（engine/product）非 serial 相。fix-worker 反复失败是撞 gitignore + no-literal + 本机降级三重墙，非修复不力。
