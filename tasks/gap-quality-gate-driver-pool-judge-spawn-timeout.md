---
id: gap-quality-gate-driver-pool-judge-spawn-timeout
title: quality driver B15（pool-quality-judge）spawnSync 超时
  3/3——ROUTINE_TIMEOUT_MS=180s 在真实主机负载下从未成功过一次
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Finding

**实测（2026-09-05 15:41–16:19，quality driver 首次在主检出生产激活后的真实运行，非 fixture）**：
`quality-gate-driver.ts` 的 B15 例程（`runPoolQualityJudge`，调用 `pool-quality-judge.ts`
的 schema agent judge）在 5 次被机械触发评估的轮次里，**3 次尝试、3 次全部失败，0 次成功**：

```
.quay/quality-round.jsonl（判词载体，逐条真实记录）：
{"round":1030,"judgedAt":"2026-09-05T15:41:18.749Z","state":"failed","reason":"judge exited 143: spawnSync claude-fjdac ETIMEDOUT"}
{"round":1032,"judgedAt":"2026-09-05T16:01:54.566Z","state":"failed","reason":"judge exited 143: spawnSync claude-fjdac ETIMEDOUT"}
{"round":1033,"judgedAt":"2026-09-05T16:12:07.818Z","state":"failed","reason":"judge exited 143: spawnSync claude-fjdac ETIMEDOUT"}

另 2 次被 resource-gate 正确推迟（未计入尝试次数,是三态区分正常工作的证据,非本条缺陷）：
round 15 (15:48): not-evaluated · resource-gate-wait（loadavg 47.74 > threshold*factor 64, cpu_stall_avg10 65.48 > cpu_limit 60）
round 63 (16:19): not-evaluated · resource-gate-wait（同类）
```

**根因定位（`plugin/scripts/quality-gate-driver.ts:80`）**：
```
export const ROUTINE_TIMEOUT_MS = 180_000;   // 3 分钟，字面量，B15/B17 共用
```
`runPoolQualityJudge`（`:265` 起）用 `spawnSync(argv[0], argv.slice(1), { timeout: ROUTINE_TIMEOUT_MS })`
**同步阻塞**调用 `claude-fjdac`（真实 `claude -p` schema agent 调用）。在本仓库当前真实并发负载下
（`ps aux` 实测同一时刻有 7+ 个真实任务 worktree 的 worker 会话 + 多个人工会话并发跑
`claude`），一次真实 LLM judge 调用**始终**超过 180s——3/3 次，不是偶发。

**代价**：B15 自 driver 激活以来**从未真正产出过一次判词**（`shouldRemoveIds` 与 `verdicts` 恒空），
`gap-ac144-quality-gate-shape-separated-driver` 的 AC3 与 `gap-pool-quality-verdicts-never-persisted`
的 AC5（均声称"依赖真实生产载体验证"）**目前都拿不到这个前提条件**——不是这两个任务的实现有问题，
是共用的调用形态本身在当前负载下结构性地跑不完。同一形态直接威胁
`gap-quality-driver-architecture-review-routine`（本轮新立的第三例程，同样要 spawnSync 一次
schema agent 才能满足其 AC5）——**不先修这条，新例程会复现同一个失败**。

**已有的同类先例（非重复，是修法模板）**：`gap-worker-driver-async-selector-readypool`（done）
已经在 worker-driver 里做过同一件事——把循环体内阻塞 `spawnSync` 改成非阻塞 `spawn`，
理由与本条完全一致（避免子进程调用占满/超出循环轮次预算）。本条是把同一个已验证的修法
应用到 quality-gate-driver 的 B15（B17 是纯机械审计、不发 LLM 调用，不受影响，不在本条范围）。

## Acceptance Criteria

- [x] AC1（不再用固定字面量阻塞，硬规则 4 推论：成本结构未知前不设数值阈值）：B15 的 judge
  调用改为非阻塞 `spawn`（同 `gap-worker-driver-async-selector-readypool` 的既有模式），
  或者把超时值从"读宿主/读历史耗时分布"推导，而不是继续用一个从未基于真实耗时数据设定的
  `180_000` 字面量——两者选一，但不得原地加大字面量了事（那只是把同一个未测量的假设换一个
  数字，硬规则 4 推论原文）。
- [x] AC2（三态不回归）：修复后 `.quay/quality-round.jsonl` 里"未触发/resource-gate 推迟/
  judge 失败/judge 成功"四态继续可区分（沿用现有 `state` 字段值），不得为了让"不超时"而把
  失败态悄悄合并进成功态。
- [x] AC3（B17 不受影响）：`judgment-consumer-check` 例程的调用路径/超时行为改动前后一致
  （它本来就不发 LLM 调用，2/2 次真实运行已成功，本条不得触碰它）。
- [ ] AC4（真实生产验证，硬规则 4 推论三，判据读生产不读测试）：修复落地**之后**，quality（待外部）
  driver 在**主检出**实际跑出 ≥1 条 B15 **成功**（`state` 非 `failed`/`not-evaluated`，含真实
  `verdicts` 或明确"本轮池内容为空"之外的结果）的记录，`judgedAt` 晚于本任务落地时刻——
  贴出该记录的实际内容。
- [x] AC5（负控制）：人为把 timeout 调回一个明显不够的值重跑一次，仍复现 `ETIMEDOUT`——
  证明修复对象是真实瓶颈而非巧合。
- [x] AC6（既有不回归）：`--for-task` scoped 门 + 全量 suite 绿；`plugin/test/quality-gate-driver.test.mjs`
  既有断言（含依赖 `ROUTINE_TIMEOUT_MS` 常量或其行为的用例）同步更新且仍过。

## Definition of Done

quality driver 在主检出的真实生产运行中，B15 至少成功完成一次真实 judge 调用并在
`.quay/quality-round.jsonl` 留下非 failed/not-evaluated 的记录（`judgedAt` 晚于落地时刻，
非 fixture、非注入）；AC1-AC6 全勾；scoped 门 + 全量 suite 绿；改动经 fan-in 落到 develop 并可
`git show develop:` 核验。**本任务不做**：改 B17 的任何行为、重新设计 pool-quality-judge 的
判词 schema、处理 `gap-ac144`/`gap-pool-quality-verdicts-never-persisted` 各自任务体本身的
status/AC 核对——那是另外的、需要人工授权走 `quay-task-operator` 的动作，本条只修
"为什么 B15 结构性地跑不完"这一个机制。

## Touches

- plugin/scripts/quality-gate-driver.ts（ROUTINE_TIMEOUT_MS 用法 / runPoolQualityJudge spawnSync→spawn 改动）
- plugin/test/quality-gate-driver.test.mjs（超时行为断言更新 + AC5 负控制用例）
- tasks/gap-quality-gate-driver-pool-judge-spawn-timeout.md（自身）
