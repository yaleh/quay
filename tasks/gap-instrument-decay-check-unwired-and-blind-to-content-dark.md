---
id: gap-instrument-decay-check-unwired-and-blind-to-content-dark
title: 仪器腐烂检测器 instrument-decay-check 自称常驻却没有任何机制调用（手动一跑即报 3
  个未裁定告警），且只认识「停止写入」，看不见「照常写入但内容是未评估或过期」的两种暗形态
status: ready
labels:
  - gap
  - defect
  - meta
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**已有机制**：`plugin/scripts/instrument-decay-check.ts`（gap-archguard-p5-instrument-decay-standing-guard 落地）检测「载体写入速率归零，而写入者仍在运行」，有 A（never-wrote：从未写过）、B（rate-stopped：速率归零）两种形态，用伴生分组做对照，不设绝对速率阈值。本任务**扩展这个检测器，不另造平行机制**（单一来源）。

**事实一：它没有接到线上。** 自称「常驻检测器」，但 quality-gate-driver、manager-tick-readings 和任何例程都没有调用它；它也只认识两个载体（fan-in-step-trace.jsonl、fan-in-lock-events.jsonl）。2026-10-22 对真实仓库手动运行一次（`--no-block --json`）：`ok:false, decayedCount:3`，三个都在 fan-in-step-trace.jsonl，类型都是 rate-stopped——`verification-round-record`（末次写入 2026-10-14）、`catch-up-develop`（2026-10-10）、`suite-recovery-blocked`（2026-10-20）。**这三个尚未裁定**：可能是真的腐烂，也可能是本来就很少发生的事件。此前没有任何人看到过它们。

**事实二：它看不见另外两种暗形态。** 下面两种情况下载体都照常写入，所以 A/B 都不会命中：
- **C 内容全暗**：载体持续写入，但从上线起每一条都是 `evaluated:false`。实例：`.quay/arch-cycle-history.jsonl` 25/25 条为 false（首条 2026-10-18T10:25Z）。
- **D 过期的已评估**：记录为 `evaluated:true`，但它读的产物早于其所覆盖源码的最新提交。实例：arch-cycle 的 src scope 读为「已评估、0 环」，读的是 2026-10-21T16:17Z 的产物，而目录环在 16:26Z / 16:27Z 引入。D 比 C 更危险，因为它和真正的健康状态从外部看完全相同。

**发生率（硬规则 12）**：C 已实测 1 例（arch-cycle，持续 4 天）；D 已实测 1 例（src scope）；同族的历史先例：ADR-007 的 git-lens 探针被归档后变成悬空软链，自检脚本仍打出看似通过的一行，「the rot went unnoticed for six days」（ADR-007 frontmatter 下的 enforcement 注释，2026-09-13 记录）；以及本检测器自身未接线、手动一跑即有 3 个告警。

## Plan

1. **载体描述符注册（扩展点）**：检测器从一个描述符注册表读取要检查的载体——每个描述符写明载体路径、分组字段、是否带 `evaluated` 字段、读的是否为持久化产物（若是，记录的哪个字段是产物时间戳、覆盖哪些源路径）。现有两个载体迁成描述符；新增 arch-cycle-history、arch-coverage-history、design-evolution-history 三个描述符。新的常驻例程只需登记描述符即可被覆盖，不改检测器逻辑。
2. **形态 C**：一个带 `evaluated` 字段的载体，从首条起每条都是 false，且至少有 2 条记录（只有 1 条可能是冷启动时序，这是最小的结构条件，不是调出来的阈值）⇒ `content-dark`。
3. **形态 D**：最新一条 `evaluated:true` 记录的产物时间戳，早于触及其覆盖源路径的最新提交 ⇒ `stale-evaluated`。直接读 git 的例程（如 design-evolution-readings）标为 not-applicable。
4. **未覆盖要列出来**：没有 `evaluated` 字段、也未登记描述符的载体（如 measure-history.jsonl）列为 `uncovered`，不得计入健康。
5. **接线**：在 quality-gate-driver 里作为声明式只读例程运行（配置段 `loop.instrument_decay:`，与 arch_cycle_report 同族；不声明则不装配，AC144 的「恰好四条内建例程」不变）。每轮写一个 Fact，状态取独立值 `instrument-dark`（与 `not-evaluated`、`verified` 都不同形），reason 点名载体与形态；对每个（载体，形态）经已有 gap-filing 通道立案，按机制去重——有在开 gap 不重立，已 done 的按 gap-arch-gap-filing-dedup-any-status-blocks-refile 的规则先核对当前源码。
6. **裁定现有 3 个告警**：对 verification-round-record、catch-up-develop、suite-recovery-blocked 逐个给出 FACT（写入路径是否仍存在、触发条件近期是否出现过）与 JUDGMENT（真腐烂，还是本来就罕见）。罕见事件按检测器自身的机制声明，不得为了让读数变绿而删分组。

## Acceptance Criteria

- [ ] AC1 形态 C（真实载体）：对主检出运行，`.quay/arch-cycle-history.jsonl` 读为 `content-dark`（贴出读数）；`.quay/arch-coverage-history.jsonl`（31/31 为 true）不命中（负对照）。
- [ ] AC2 形态 D：一份产物时间戳早于覆盖源路径最新提交的记录读为 `stale-evaluated`；夹具中产物时间晚于所有覆盖提交的记录不命中（负对照）。贴出两次输出。
- [ ] AC3 未覆盖不算健康：`.quay/measure-history.jsonl` 出现在 `uncovered` 列表中，且不计入健康载体数。贴出读数。
- [ ] AC4 扩展点：测试只通过注册一个合成描述符，就让一个新载体被检查，不修改检测器逻辑文件；不注册时同一断言失败（负对照）。贴出测试名与输出。
- [ ] AC5 可见信号：一轮例程运行写出一个状态为 `instrument-dark` 的 Fact，并经 gap-filing 通道立案或报告已有 gap；紧接的第二轮不重复立案。贴出两轮的 Fact 与立案结果。
- [ ] AC6 现有 3 个告警逐个裁定：每个都附 FACT（命令与原始输出）与 JUDGMENT，并写明处置方式。

## Definition of Done

- [ ] 六条 AC 全绿；`scripts/test.sh` 相关泳道通过；合并进 develop。
- [ ] 读数验证使用真实载体；夹具只用于 AC2、AC4 的负对照。
- [ ] 不在 fan-in 热路径上运行。

## 落地后操作（不属于本任务完成条件）

本仓库 `.quay/config.yml` 不入库，合并后需要在 live 配置中声明 `loop.instrument_decay:` 段，例程才会运行。quality 驱动只在启动时读一次配置；合并本身会触发 anchor 自动重启，所以最好在合并之前声明。现有代码不认识这个键，提前声明不会产生任何作用。

## Touches

- tasks/gap-instrument-decay-check-unwired-and-blind-to-content-dark.md
- plugin/scripts/instrument-decay-check.ts
- plugin/test/instrument-decay-check.test.mjs
- plugin/scripts/quality-gate-driver.ts
- plugin/test/quality-gate-driver.test.mjs
