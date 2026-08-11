---
id: gap-mcp-server-test-deadlocks-at-high-test-concurrency
title: packages/quay/test/mcp-server.test.mjs 在 --test-concurrency=16 下死锁（ep_poll 持 socket 句柄不释放, 14+ 分钟无 CPU 进展, pcpu≈0.9%）——同机 conc=4 23.2s passed、orangevps conc=4 20.2s passed ⇒ 只在高并发触发, 是并发相关的资源竞争/死锁非环境缺失; 影响 16-32 核机器的并发验证, 建议修复
status: todo
labels:
  - gap
  - defect
  - performance
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**mcp-server.test.mjs 在高测试并发下死锁（manager 2026-08-11 10:2x，已复现已确认，非猜测）**：`--test-concurrency=16` 下卡 `ep_poll`，持有若干 socket 句柄不释放，14+ 分钟无 CPU 进展（strace wchan=ep_poll, pcpu≈0.9%）。同一文件同机 conc=4 = 23.2s passed；orangevps conc=4 = 20.2s passed ⇒ **只在高并发下触发，并发相关的资源竞争/死锁，不是环境缺失**。现场进程已 `kill -9` 终止（批次继续），死锁证据（PID/句柄快照）未保留；复现建议：16-32 核机器 `--test-concurrency=16` 单跑该文件循环多次。

**影响面**：boheidc lane16（16核，无 systemd 配额）main 相撞此死锁；剔除异常值后 sum=1493s/289 文件、理论地板(÷16)≈93.3s（未经验证轮，死锁修复后重跑拿真值）。

### 机制推断（manager 现场确认 + outer 复核）

`packages/quay/src/mcp-server.ts` 用 `StdioServerTransport`（@modelcontextprotocol/sdk），server 注册资源/工具、子进程经 stdio 通道。死锁形状 = **socket 句柄不释放 + ep_poll 无 CPU 进展**，与 32-48 并发进程共享同一批 socket 描述符的争用/泄漏一致。**这不是能由 manager 修的产品代码，归属 inner 任务**（判定归 outer）。

### 复现（DoD 前须完成）

16-32 核机器：`node --test-concurrency=16 --test packages/quay/test/mcp-server.test.mjs` 循环 ≥3 次，任一命中断言前挂起 >5min 且 wchan=ep_poll 即复现。

### 验证锚

修后 (a) conc=16 单跑该文件循环 ≥3 次全绿、无挂起；(b) conc=4 回归不坏（本机 23.2s 基线）；(c) socket/句柄无泄漏（修复后 16 并发下 fd 计数稳定）；(d) `--for-task` scoped 门绿；(e) 全量套件不回归。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录死锁证据（ep_poll/socket 句柄/14+ 分钟/pcpu≈0.9%）+ conc=4 对照（本机 23.2s / orangevps 20.2s）+ 影响面（boheidc lane16 1493s 剔除异常值）（本任务 Proposal 已含）
- [ ] AC2: **根因定位**——定位 mcp-server.test.mjs 或 mcp-server.ts 中高并发下持 socket 句柄不释放的路径（stdio transport / 资源注册 / 子进程通道）
- [ ] AC3: **修复**——并发下句柄正确释放（或测试隔离），conc=16 单跑循环 ≥3 次全绿无挂起
- [ ] AC4: **低并发不回归**——conc=4 回归（本机 23.2s 基线量级）；`--for-task` scoped 门绿
- [ ] AC5: **全量不回归**——全量套件绿（外层 verification-round 验证）

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：conc=16 循环复现无挂起（贴 3 次结果）+ conc=4 回归数字
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- packages/quay/test/mcp-server.test.mjs（复现/修复落点）
- packages/quay/src/mcp-server.ts（若根因在此：stdio transport / 资源 / 子进程通道句柄释放）
- packages/quay/test/mcp-server-deadlock-repro.test.mjs（若新增：conc=16 循环复现测试）
- tasks/gap-mcp-server-test-deadlocks-at-high-test-concurrency.md（自身：勾 AC + 贴证据）

### Finding：并发死锁实证（manager 2026-08-11 10:2x，落点 Finding 不进 Contract）

**已复现、已用 /proc + ep_poll 确认，非猜测**：`--test-concurrency=16` 下 mcp-server.test.mjs 卡 ep_poll，socket 句柄不释放，14+ 分钟无 CPU（strace wchan=ep_poll, pcpu≈0.9%）。conc=4 本机 23.2s passed、orangevps 20.2s passed ⇒ 只高并发触发。现场 kill -9 已终止，句柄快照未保留。

**数据修正（随本任务）**：两机最初 31 失败 = 同一根因 `.quay/config.yml` 缺失（gitignored、quay-init 生成、新 clone 没有）；scp 修复后单跑 27/27、46/46 绿，失败归零（除死锁）。**orangevps 干净重跑 main_phase_ms 从带 31 假失败的 117s 变 170s**——那 31 个瞬间报错把 sum_ms 拉低，**此前任何用那批数据的外推作废**。boheidc lane16 sum=1493s/289 文件、理论地板≈93.3s（未经验证轮）。两机单核速度比 boheidc/orangevps 中位 2.12x（短 1.86x/长 2.28x），16 核数量优势更大 ⇒ 整体预测快约 1.8x（未确认）。SERIAL/LOWCONC_CONCURRENCY 均可 env 覆盖，不受 --test-concurrency 影响。
