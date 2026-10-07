---
id: gap-routine-semantic-dedup-scan-relative-time-mirror
title: "semantic-dedup-scan: Same algorithm under two names,
  statement-for-statement identical (sub-60s just now, then 60s/60m/24h
  thresholds); flags.ts documents it as a deliberate mirror"
status: ready
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
Same algorithm under two names, statement-for-statement identical (sub-60s just now, then 60s/60m/24h thresholds); flags.ts documents it as a deliberate mirror to avoid importing serve machinery, a reason that no longer applies to serve-render.ts.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791353789266` · ts `2026-10-07T06:16:29.266Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`relativeTimeCli`、`relativeTime`
- 涉及文件：
- `packages/quay/src/cli/flags.ts:160`
- `packages/quay/src/serve-render.ts:760`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract one relativeTime into a leaf and re-export both names

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `relative-time-mirror`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791353789266`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence

**处置（AC1/AC2）：修掉，不是「已注意到」。** 两份逐字相同的函数体（`cli/flags.ts` 的
`relativeTimeCli`、`serve-render.ts` 的 `relativeTime`）已合并为**一个叶子定义**
`packages/quay/src/relative-time.ts`，两个原名字各自 `export { … } from` 重新导出 ⇒
`bin/quay.ts` / `cli/shared.ts` / `serve-task.ts` / `serve-dashboard.ts` / `serve-live.ts` /
`serve-goal.ts` / `serve-needs-human.ts` / `serve.ts` 的导入路径与公开名字全部不变。
flags.ts 的轻模块约束（⛔ 不得拉入 provider 图）由「导入这个纯叶子」满足，**不是因为复制**——
这正是它当初自我声明为「deliberate mirror」的理由不再成立之处：那条理由针对的是 serve 机制，
不适用于纯叶子。（核过：两个宿主模块内部都没有引用该名字的模块作用域调用点，只有再导出行 ⇒
`export { x } from` 不绑定模块作用域这一陷阱在这里不适用。）

**本轮第二个 finding —— 上一轮 fan-in 的 suite 阻塞，已一并修掉。** 上一轮全量 suite 是
4201 tests / **恰好 1 red**，落在 `packages/quay/test/server-restart.test.mjs`（本任务 delta 之外；
`cli/server.ts` 与本任务改动的三个文件无 import 可达性，逐行核过其 import 清单）。真因**不是 stdout
丢失**，而是**该测试自身的读数竞态**：它只轮询 STDERR 记号，然后对着那一份**冻结快照**断言 STDOUT
也在其中 —— 而 fixture 子进程仍在向同一个文件追加（两个流共用同一个 fd：`stdio: ["ignore", fd, fd]`）。
读者每 50ms 轮询一次，写者在其两次写之间被抢占超过一个轮询周期时（suite 负载下会发生），快照即取在
半途 ⇒ **对着【确实已经落盘】的 stdout 行报红**。

- 隔离复跑 24/24 全绿（3 次串行 + 21 次并发加载），**隔离下未复现** ⇒ 负载敏感、非确定性。
- **对照（旧 vs 新读数纪律，驱动真实 `spawnHost`）**：令 fixture 在两次写之间延迟 300ms ⇒
  旧纪律 `FAIL`，而同一次运行中独立轮询确认 stdout **已在文件中**；新纪律 `PASS`。
- **空转对照（负控制）**：fixture **从不**写 stdout ⇒ 新断言仍然 `FAIL`。
  ⇒ 该修法不会把「真的丢了」伪装成通过（硬规则 4 推论三：能产出 ≠ 已产出，恒真的判据不是测量）。
- 修法不动断言强度：同一个文件仍必须在超时内带上 stdout；去掉的只是「两次写之间时间间隔」这一假设。

## Touches
- `packages/quay/src/cli/flags.ts`
- `packages/quay/src/serve-render.ts`
- `packages/quay/src/relative-time.ts`
- `packages/quay/test/server-restart.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-relative-time-mirror.md`