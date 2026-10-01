---
id: gap-routine-semantic-dedup-scan-readcpustall-dup
title: "semantic-dedup-scan: two byte-identical private /proc/pressure/cpu
  readers (a third same-named reader, cap-from-gate.ts:341, is genuinely
  different)"
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
two byte-identical private /proc/pressure/cpu readers (a third same-named reader, cap-from-gate.ts:341, is genuinely different)

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790851304231` · ts `2026-10-01T10:41:44.231Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`readCpuStall`
- 涉及文件：
- `plugin/scripts/psi-failure-correlation-check.ts:223`
- `plugin/scripts/suite-load-sampler.ts:52`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract — shared psi helper

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `readcpustall-dup`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790851304231`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence
**复核（finding 属实）**：两处 private `readCpuStall` 函数体逐字节相同（`psi-failure-correlation-check.ts:223` / `suite-load-sampler.ts:52`），kind `byte-identical-body`、verdict `real-duplication` 与 finding 一致。

**处置 = 抽取出单一实现**（不是「已注意到」）：
- `readCpuStall` 现在只有**一处定义**：`plugin/scripts/suite-load-sampler.ts:63`（`export function readCpuStall`）。选它作落点，是因为该模块**本就拥有三个结构信号读取器**（`readLoadavg` / `readCpuStall` / `readMemAvailMb`），且它是套件每轮 spawn 的热路径进程 —— 反向（让 sampler import 相关系数模块）会给热路径平白拉进 6 个模块。
- `plugin/scripts/psi-failure-correlation-check.ts:102` 改为 `import { readCpuStall } from "./suite-load-sampler.ts";`，删除本地副本；该文件 3 处调用点（`s0` / 轮询 `s` / `s1`）不改。

**第三个同名 reader 保持独立（与 finding 一致，不是漏网）**：`cap-from-gate.ts:341` 的 `readCpuStallFromGate` 不自己解析 `/proc`，而是经 `resource-gate.sh`（shell 正本）REPORT 模式读取，是**不同函数**而非副本。

**5b 同载体扫描（同一原则的其它适用点）**：`plugin/scripts/` 内对 `/proc/pressure/cpu` 的逐字节条数现为 **1**。同类候选 `checker-cost.ts` `getLoad1` 与 `suite-load-sampler.ts` `readLoadavg` **不是副本** —— 前者有 `CHECKER_COST_LOAD_OVERRIDE` test seam 且失败返回 `0`（fail-open），后者无 seam 且失败返回 `null`（fail-closed），语义不同，故不并。

**判据可核（命令）**：
- `grep -rc 'readFileSync("/proc/pressure/cpu", "utf8")' plugin/scripts/*.ts | grep -v ':0$'` ⇒ 仅 `suite-load-sampler.ts:1`
- `grep -rn '^export function readCpuStall\|^function readCpuStall' plugin/scripts/*.ts` ⇒ 仅 `suite-load-sampler.ts:63`（`readCpuStallFromGate` 是另一个符号）

**运行对照（若「已是单一实现」为假则结果会不同）**：直接 import 共享 reader 并与独立解析 `/proc/pressure/cpu` 对比 ⇒ 两侧同为 `0.77`（原始行 `some avg10=0.77 …`）。另在本 Node 上验证「具名 import 不存在」会在 link 期抛 `SyntaxError: The requested module … does not provide an export named …`；`psi-failure-correlation-check.ts` 无本地定义且能正常加载 ⇒ 其调用点全部解析到该唯一导出，而非残留私有副本。

**scoped gate**：`scripts/test.sh --for-task gap-routine-semantic-dedup-scan-readcpustall-dup --allow-thin` ⇒ **exit 0**（static 检查全 PASS）。⚠️ 诚实标注：selector 选中 **0 个测试文件**（thin 允许）⇒ 该绿**不构成**对本次 delta 的测试覆盖，全量 suite 在 fan-in 跑；上面的运行对照是本轮对 delta 的直接验证。

**续做轮复核（2026-10-01）**：重跑上述两条 `grep` 判据，结果不变 —— `/proc/pressure/cpu` 逐字节 reader 仍为 1（`suite-load-sampler.ts`）、`readCpuStall` 定义仍为 1（`suite-load-sampler.ts:63`），`psi-failure-correlation-check.ts` 无本地定义且 import 该唯一导出。据此勾选 AC/DoD。

## Touches
- `plugin/scripts/psi-failure-correlation-check.ts`
- `plugin/scripts/suite-load-sampler.ts`
- `tasks/gap-routine-semantic-dedup-scan-readcpustall-dup.md`
## Needs-Human

**执行 2026-10-01T10:55:04.528Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：suite 红但归因不出任何失败测试文件（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 2 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (parser attributed no failing file (failure-line count unavailable on this judgment)); stopping instead of spending another worker session
- 失败步/判词：step=suite: # fail 46
- run_id：wk-prod-anchor
- session_id：372ddc35-65e5-4bdc-a524-f9da896dca30
- suite 日志：/data/home/yale/work/quay/.quay/fan-in-suite-gap-routine-semantic-dedup-scan-readcpustall-dup~wk-prod-anchor~1790852035798-669a78.log
- fan-in 日志：/data/home/yale/work/quay/.quay/fan-in-gap-routine-semantic-dedup-scan-readcpustall-dup-wk-prod-anchor.log
