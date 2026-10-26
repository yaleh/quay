---
id: gap-driver-log-since-and-tail-read
title: driver log --kind worker 没有 --since 且整读 worker-outcome.jsonl；消费方要按时间尾部取
  fan-in attempts
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Finding

`quay driver log --kind worker --json` 是目前唯一输出 mechanical fan-in attempts 的读取面（`packages/quay/src/cli/driver.ts:199` 的 `runDriverLog` → `packages/quay/src/observation/records.ts:365` 的 `readFanInAttempts`）。它：

- **已有 `--limit`**（`driver.ts:214-217`；v0.22.0 起可用——消费方钉的 0.19.0 没有，所以对方看到的是「没有 --limit」）；
- **没有 `--since`**；
- `readFanInAttempts` 用 `readCarrierText` **整读** `.quay/worker-outcome.jsonl`（消费方 4.3MB / 1860 条；本仓库 8MB+），`limit` 是读完之后才 slice（`records.ts:383-385`）。

attempts 的字段已经齐全：`WorkerOutcomeRecord` 的 `ts/task/run_id/final_state/failure_reason` + `MechanicalFanInRecord` 的 `outcome/step/reason/lockHoldSecs/lockAcquireEpoch/lockReleaseEpoch/suiteFinishedEpoch`（`records.ts:108-116`）。

## AC

- [x] AC1（`--since`）：`quay driver log --kind worker --json --since <ISO8601>` 只返回 `ts >= since` 的 attempts；与 `--limit` 可组合（先按 since 过滤，再取尾部 N 条）。贴三次实跑（无 since / since / since+limit）。
- [x] AC2（有界读取）：`.quay/worker-outcome.jsonl` ≥50MB 时 `--limit N` 不得整读。贴 ① 合成载体上的墙钟与峰值 RSS；② 一条证明只读尾部窗口的读数（reader seam 统计字节数，或把前半段替换为噪声后结果不变）。⛔ 先整读再 slice。
- [x] AC3（三态 + 计数语义）：`carrier-absent` / `carrier-unreadable` / `malformed-lines` / `ok` 四态语义不变；尾部窗口内的 malformed 行数与「全文件行数」必须可区分——⛔ 不允许把「只读了尾部」谎报成 `totalLines` 是全文件。输出必须明确该键现在指什么（见 AC4）。贴四条实跑。
- [x] AC4（输出形状只追加）：不改变 `FanInAttemptsResult` 的既有键；新增信息只能是追加字段（如 `window: {fromByte, toByte, since, truncated}`）。贴改动前后同一 fixture 的 JSON diff。
- [x] AC5（help/版本）：`packages/quay/src/cli/help.ts` 的 driver 段登记 `--since`，并写明起始版本。

## Evidence

实现落点：`packages/quay/src/observation/records.ts`（`sinceMs` 参数 + 有界尾部臂 + `window` 追加字段 + 抽出唯一逐行解析器 `parseWorkerOutcomeRecordLine`）、`packages/quay/src/cli/driver.ts`（`--since` 解析 / 渲染 / inline usage）、`packages/quay/src/cli/help.ts`（`--since` 登记 + `DRIVER_LOG_SINCE_FIRST_SHIPPED`）。
提交：`dda989616`。测试：`observation.test.mjs` 三条 + `cli.test.mjs` block34（33 条断言）。

有界读取复用 `scanJsonlTail`（`.quay/worker-round.jsonl` / `.quay/verification-round.jsonl` 的同一具 helper）——⛔ 未新增第二份窗口循环；`scanJsonlTail` 只追加了 `fromByte/toByte/totalLines/unparseableLines` 四个读数（既有调用方不受影响）。
`plugin/scripts/driver-runtime.ts` 经核实**没有** attempts 读取路径（`grep readFanInAttempts plugin/` 只命中 fixtures 与 vendor dist 构建产物）⇒ 无需第二处同源化。

### AC1 — 三次实跑（生产载体 `/data/home/yale/work/quay/.quay/worker-outcome.jsonl`，8,381,161 B / 3475 行）

1. 无 `--since`（整文件臂）：
   `status=ok totalLines=3475 returned=3475 oldest=2026-08-23T07:54:29.704Z newest=2026-10-26T04:51:51.063Z`
   `window={fromByte:0,toByte:8381161,since:null,truncated:false,bytesRead:8381161}`
2. `--since 2026-10-25T00:00:00Z`：
   `status=ok returned=25 oldest=2026-10-25T05:08:17.950Z newest=2026-10-26T04:51:51.063Z`
   `attempts.every(a => Date.parse(a.ts) >= Date.parse(since)) === true`（⛔ 逐条复核，不是只看首尾）
   `window={fromByte:8119017,toByte:8381161,since:"2026-10-25T00:00:00.000Z",truncated:true,bytesRead:262144}`
3. `--since 2026-10-25T00:00:00Z --limit 3`：`returned=3`，task ∈ {`gap-routine-architecture-analysis-god-package-serve-fanout-556`, `gap-instrument-decay-suite-rerun-green-condition-misreads-not-evaluated`, `gap-suite-read-verb-current-and-recent-rounds`}，`window` 同 run 2。

组合语义（**先 since 过滤，再取尾部 N**）在 `observation.test.mjs` 的 10 条 fixture 上钉死：`--limit 3` 单独得 `r-7,r-8,r-9`；`--since 00:06 + --limit 3` 同样得 `r-7,r-8,r-9`；若实现反序（先 limit 后 since）会得 `r-6,r-7,r-8` ⇒ 该断言能咬。

### AC2 — 有界读取（合成载体 61,362,225 B / 6000 条，同一台机同一条命令）

| | 墙钟 | 峰值 RSS | `totalLines` | 实际 pread |
|---|---|---|---|---|
| 改前（develop 尖，`--limit 20`） | 0.26 s | 267,784 KB | 6000（整文件） | 61,362,225 B |
| 改后（本任务，`--limit 20`） | 0.12 s | 94,028 KB | 25（窗口） | 262,144 B |

（`/usr/bin/time -v` 的 `Elapsed (wall clock)` / `Maximum resident set size`。）

reader seam 读数：`window.bytesRead=262144`、`fromByte=61100081`、`toByte=61362225`、`truncated=true` ⇒ 只 pread 了载体尾部 256 KiB。
负控制（`observation.test.mjs`）：把载体**前半段**整段替换为不可解析噪声后，`--limit 5` 返回的 attempts 与替换前**逐字节相同** ⇒ 前半段从未被读（不是「读了但没用」）。
整文件臂无回归：无 `--since`/`--limit` 时 0.75 s → 0.66 s（同数量级；该臂仍是原有的单次整读，未被改成多轮窗口）。

### AC3 — 四态实跑（均带 `--since 2026-09-20T00:00:00Z`）

1. `carrier-absent`（无载体）：`status=carrier-absent, reason=null, totalLines=0, exit=0`
2. `carrier-unreadable`（`worker-outcome.jsonl` 是目录 ⇒ EISDIR）：`status=carrier-unreadable, reason=".quay/worker-outcome.jsonl could not be read: EISDIR: …", exit=1`
3. `malformed-lines`（整文件臂小 fixture，2 条坏行）：`totalLines=5, malformedLines=2, attempts=3`，`reason="2 of 5 line(s) in .quay/worker-outcome.jsonl could not be parsed as a JSON record"`
4. `ok`：见 AC1 run 2 / run 3

「窗口内 malformed」与「全文件行数」可区分（61 MB 载体尾部追加一条坏行，`--since … --limit 5`）：
`totalLines=26, malformedLines=1, truncated=true, bytesRead=262144`
`reason="1 of 26 line(s) in the last 262144 byte(s) (window 61100117..61362261) of .quay/worker-outcome.jsonl could not be parsed as a JSON record — ⚠️ these counts cover the WINDOW ONLY, not the whole carrier"`
⛔ 从未把 6000（全文件）报成 `totalLines`；`window.truncated` 是那个能独立取假的取值。窗口**之外**的坏行是 `UNKNOWN` 而非 0——由 `truncated=true` 表达（硬规则 6）。文本臂同一句照印：`window: bytes … truncated=true ⇒ the line counts above cover THIS TAIL WINDOW ONLY, not the whole carrier`。

### AC4 — 同一 fixture 的 JSON diff（`diff -u`，整文件臂）

```
@@ -77,5 +77,12 @@
     }
   ],
   "status": "ok",
-  "reason": null
+  "reason": null,
+  "window": {
+    "fromByte": 0,
+    "toByte": 572,
+    "since": null,
+    "truncated": false,
+    "bytesRead": 572
+  }
 }
```

纯追加：既有 6 个顶层键（`carrier/totalLines/malformedLines/attempts/status/reason`，连键序）与 attempt 的 21 个键逐字节未变 ⇒ 同一 fixture 上只多了 `window`。`cli.test.mjs` block34 机械钉住「新增顶层键只有 `window`」+ attempt 键表逐值相等 + `window` 自身键表。

### AC5 — help/版本

`quay driver --help` 的 driver 段新增：

```
  --since <ISO8601>           (log only) Keep only attempts whose `ts` is at or after this instant
                              (first shipped in 0.24.0-dev). Combinable with
                              --limit: filter by --since FIRST, then keep the newest n.
                              … ⚠️ CONSEQUENCE FOR `totalLines`: on a bounded read it is the number of
                              non-blank lines in the WINDOW that was read, NOT the carrier's total …
```

`--limit` 一并标注 `(shipped in 0.22.0)`。版本只有**一个**定义点（`help.ts` 的 `DRIVER_LOG_SINCE_FIRST_SHIPPED`），`cli/driver.ts` 的 inline usage 插值同一常量（⛔ 不手抄第二份）。block34 断言 `--since <ISO8601>` 与 `first shipped in 0.24.0-dev` 都在实打印的 help 里。

### ADR-007 dark-axis record

- L_D: import-graph-check on the merged tree — files=563 edges=1656 valueSccs=0 typeSccs=0 reverseEdges=0 (kernel violations=0, gateLayerViolations=0)
  god-package 轴（`L_G`）本任务未单独测：不新增 package、不改包间耦合；本改动只新增一条包内叶子 import（`cli/driver.ts → cli/help.ts`，取单一版本常量），无环、无反向边。

## DoD

- 尾部窗口读取复用 `packages/quay/src/observation/records.ts` 里已为 `worker-round.jsonl` 建立的 tail 读法（同一套 helper），⛔ 不新增第二份窗口逻辑。✅ 复用 `scanJsonlTail`（只给它追加了 `fromByte/toByte/totalLines/unparseableLines` 读数）。
- 若 `plugin/scripts/driver-runtime.ts` 也有 attempts 读取路径，保持同一 `readFanInAttempts`（⛔ 不新增第二解析）。✅ 核实无该路径；且逐行解析已收敛为唯一的 `parseWorkerOutcomeRecordLine`（整文件解析与尾部扫描共用）。
- `packages/quay/test/` 或 `plugin/test/` 有 `node:test` 覆盖 AC1/AC2/AC3。✅ `observation.test.mjs` 三条 + `cli.test.mjs` block34；scoped 门 `--for-task gap-driver-log-since-and-tail-read --allow-thin` 绿（155 tests, 0 fail）。
- `totalLines` 改动后的语义在输出与 help 里写明，⛔ 不得默默改变同一个键的含义。✅ JSON 里由 `window.truncated` 承载、文本臂印一整行、help 单列一段、malformed 的 `reason` 句子点名窗口。

## Touches

- `tasks/gap-driver-log-since-and-tail-read.md`（自指）
- `packages/quay/src/cli/driver.ts`
- `packages/quay/src/observation/records.ts`
- `packages/quay/src/cli/help.ts`
- `packages/quay/test/cli.test.mjs`
- `packages/quay/test/observation.test.mjs`
