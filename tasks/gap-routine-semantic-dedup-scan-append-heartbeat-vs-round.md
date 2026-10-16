---
id: gap-routine-semantic-dedup-scan-append-heartbeat-vs-round
title: "semantic-dedup-scan: Byte-identical mkdir+JSONL-append+return-file
  bodies, and driver-runtime.ts:2104 explicitly declares this 'one append
  implementation shared by both drivers' — "
status: done
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
Byte-identical mkdir+JSONL-append+return-file bodies, and driver-runtime.ts:2104 explicitly declares this 'one append implementation shared by both drivers' — worker-driver re-implements it under a new name, and outer-driver/suite-driver already import the original.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792168649663` · ts `2026-10-16T16:37:29.663Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`appendHeartbeatLine`、`appendRoundToFile`
- 涉及文件：
- `plugin/scripts/driver-runtime.ts:2107`
- `plugin/scripts/worker-driver.ts:1983`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
merge — import appendHeartbeatLine in worker-driver

## Disposition（复核结论：**已修掉**，不是「已注意到」）

**复核**：finding 属实。`worker-driver.ts:1983` 的 `appendRoundToFile` 与 `driver-runtime.ts:2107` 的
`appendHeartbeatLine` 函数体**逐字节相同**（`mkdirSync(dirname,{recursive:true})` +
`appendFileSync(JSON.stringify(record)+"\n")` + `return file`），只差签名上的类型注解；
而 driver-runtime.ts:2104 自述「⛔ 一条 append 的单一实现，两 driver 共用」，outer-driver.ts:45 /
suite-driver.ts:35 都 import 它，worker-driver 却留着私有副本 —— 且它早已从同一模块 import 别的东西，
所以「不想引入重依赖」不成立。

**为什么一直没被别的机制挡住**（AC2 那一半，如实写）：唯一发现它的一直是 semantic-dedup-scan 例程自己。
同一簇在 `.quay/routine-findings.jsonl` 里自 2026-09-18 起被反复立案（`jsonl-append-family`、
`append-helpers`、`appendheartbeatline-appendroundtofile`、`appendheartbeat-appendround`、
`appendheartbeat-worker-driver-copy`、`p042`、`heartbeat-append-line`、`append-heartbeat-vs-round`…），
但例程的 rate 闸每轮上限 3、findingKey 每轮按重写后的文本重算 ⇒ 它们是「同一处缺陷的第 N 次立案」，
而不是 N 处缺陷；同时**没有任何检查盯这份实现的同一性**（`identity-replication-check.ts` 报的是名字/
路径字面量的重复声明，不是函数体族）。⇒ 这不是「例程噪音」，是「一处真实漂移面至今没有棘轮」，
所以本轮处置＝修掉 + 补棘轮。

**处置（requested action: merge → 单一定义点）**：
- `plugin/scripts/worker-driver.ts` 删掉私有函数体，改为从 driver-runtime import `appendHeartbeatLine`，
  两处调用点（round / error-round 落盘）直接调它；`appendRoundToFile` 作为
  `export { appendHeartbeatLine as appendRoundToFile }` **导出别名**保留 —— 它绑的是同一个函数对象，
  ⛔ 不是第二份实现。既有消费者因此逐字不变（`plugin/test/touches-relax-filter-trace.test.mjs` 的 import、
  `orchestration/worker-driver-log-carriers.md` 对 `.quay/worker-round.jsonl` 写手的点名）。
- ⚠️ 用「import 出本地绑定 + 在其上再 `export { … as … }`」，**不是** `export { … } from` 纯转发：
  后者只绑导出表、不绑模块作用域（同族前例：`gap-routine-semantic-dedup-scan-hostparallelism-missed-import`
  的 `export { hostParallelism };` 处置段）。
- `plugin/scripts/driver-runtime.ts` **未改动**（它本来就是共享家），`## Touches` 保留该路径只为标出 SSOT 落点。
- 新增棘轮落在 **`plugin/test/worker-driver.test.mjs`**（既有文件，⛔ 不新开文件）：scoped 门按 basename
  把 `plugin/scripts/worker-driver.ts` 配对到它，新文件名的测试不会被选中。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `append-heartbeat-vs-round`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792168649663`）所描述的问题被复核并处置 —— 复核：属实（逐字节同体、两个定义点）；处置：按 requested action 合并为单一定义点（worker-driver 私有函数体删除、改 import `appendHeartbeatLine`，老名字降为同一函数对象的导出别名）
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案 —— 已修掉；失败在哪一步也写明了（例程 rate 闸每轮上限 3 + findingKey 逐轮重算 ⇒ 同一簇被反复重立案而无人盯同一性）；可核产物＝声明点计数 + 同一性断言 + 谓词负控制三半棘轮，且变异实跑可红（见 Evidence）

## DoD
- [x] 上面的判据实跑通过 —— scoped 门（`scripts/test.sh --for-task … --allow-thin`）148/148 绿；棘轮两次变异各自变红并点名；消费方 `plugin/test/touches-relax-filter-trace.test.mjs` 6/6 绿（见 Evidence）—— 全部实跑读数
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑 —— 修复由本任务的派发链（worker 会话）执行；例程只读 `plugin/scripts` 立案，未代跑任何产出者；本任务的 Touches 也由 worker 提交

## Evidence

### 修前（finding 的形态）
`plugin/scripts/worker-driver.ts:1983` 与 `plugin/scripts/driver-runtime.ts:2107` 的函数体逐字节相同，
只有签名上的类型注解不同（`ReturnType<typeof computeWorkerRoundRecord>` vs `Record<string, unknown>`）。

### 修后 —— 定义点只剩一个（按位置匹配行首声明，⛔ 不数注释/字符串里的提及）

```
$ grep -rnE '^export function appendRoundToFile\(' plugin/scripts --include=*.ts --include=*.mjs --include=*.js
(0 命中)
$ grep -rnE '^export function appendHeartbeatLine\(' plugin/scripts --include=*.ts --include=*.mjs --include=*.js
plugin/scripts/driver-runtime.ts:2107:export function appendHeartbeatLine(file: string, record: Record<string, unknown>): string {
```

### 同一性（运行时读数，⛔ 不是 import 层的回声）

```
$ node --experimental-strip-types -e '<import worker-driver + driver-runtime 后比较>'
alias === shared implementation: true
typeof: function arity: 2
```

### 棘轮能取假（两次变异实跑，cp 备份 / 复原，md5 核对）

1. 把私有函数体写回 worker-driver（替换掉别名行）⇒ 棘轮红：
   `AssertionError: appendRoundToFile 必须是 driver-runtime.appendHeartbeatLine 本身（同一函数对象），⛔ 不是第二份实现`
   `actual [Function: appendRoundToFile] / expected [Function: appendHeartbeatLine]`
2. 复原后，在 `plugin/scripts/zz-mutation-probe.ts` 里另声明一份同名函数 ⇒ 棘轮红并**点名命中**：
   `AssertionError: plugin/scripts 下 appendRoundToFile 的声明应恰好 0 处 …；实际命中：[{"file":"zz-mutation-probe.ts","line":1,…}]`
   （探针文件已删；复原后 worker-driver.ts md5 `2146b932eb6ce2e10f5676f7d9c04b1a` 与变异前一致）
3. 棘轮内建的谓词负控制：对合成样本（一行同名声明）干跑 ⇒ 谓词命中 1 处
   ⇒ 第 2 条的「0 处」是真读数，不是空转（硬规则 2 的零计数半边）。

### 消费方仍绿（别名保留的意义）

```
$ node --test plugin/test/touches-relax-filter-trace.test.mjs
ℹ tests 6 / pass 6 / fail 0
```
该测试经 `appendRoundToFile` 走【生产写入器】把 round 落进 `.quay/worker-round.jsonl`（其 DoD 逐字要求），
别名保证它读到的仍是同一个写手。

### 门

```
$ bash scripts/test.sh --for-task gap-routine-semantic-dedup-scan-append-heartbeat-vs-round --allow-thin
ℹ tests 148 / pass 148 / fail 0        (exit 0；含新增的那条棘轮)
```
typecheck：`plugin/scripts` 不在任何 tsconfig 的 include 面内（根 tsconfig 只 include `packages/**/src|bin`，
per-package 同），但按 workspace 声明的 ts-typecheck 门实跑
`for d in packages/*/; do npx tsc --noEmit -p "$d"; done` ⇒ 4/4 exit 0，并做负控制
（在 `packages/quay/src/` 暂放一个 `const x: number = "s"` ⇒ TS2322 / exit 1，探针已删）
⇒ 该「exit 0」是真读数，不是空跑。

## Touches
- `plugin/scripts/driver-runtime.ts`
- `plugin/scripts/worker-driver.ts`
- `plugin/test/worker-driver.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-append-heartbeat-vs-round.md`
