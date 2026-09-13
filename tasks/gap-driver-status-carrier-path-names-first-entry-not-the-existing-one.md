---
id: gap-driver-status-carrier-path-names-first-entry-not-the-existing-one
title: driver status 报了一个不存在文件的 carrier_path，而 carrier_records 却是真实数字
status: done
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**现象（实测，第三方项目 quay-fleet）**：

```
$ quay driver status --kind worker
worker-driver: kind=worker · supervisor pid=72296 alive=1 · driver pid=72641 alive=1 · running=1
 · supervisor_stale=fresh · carrier_path=/home/yale/work/quay-fleet/.quay/worker-outcome.jsonl
 · carrier_records=51 · last_record_ts=2026-09-13T08:45:41.113Z
```

**那个 `carrier_path` 指向的文件根本不存在。** quay-fleet 的 `.quay/` 下实际只有：
```
promotion-round.jsonl  52 行      worker-round.jsonl  53 行
outer-round.jsonl      59 行      goal-round.jsonl    59 行      checker-cost.jsonl
```
**没有任何 `-outcome` 文件**。而四个 driver 报的 `carrier_records` 分别是 52/52/58/59
——**正是那些 `-round` 文件的行数**。

⇒ **`carrier_path` 与 `carrier_records` 来自不同来源**：count 汇总真实存在的载体，
path 却报另一个名字。合起来看像正常读数（有路径、有计数、有新鲜时间戳），
**实际是一个「读不到」被伪装成「正常」**（硬规则 3b）。

**根因（定位到行）**：`plugin/scripts/driver-runtime.ts`

```ts
/** 载体文件（相对 .quay/；首个 = 主载体，作 status 的 carrier_path）。 */   // :131
carriers: ["promotion-outcome.jsonl", "promotion-round.jsonl"],            // :150
carriers: ["worker-outcome.jsonl",    "worker-round.jsonl"],               // :162
```
`carrier_path` 取列表**首个**（`stats.primaryPath`，:1186/:1197），而不是取**实际存在/实际被写的那个**。

**为什么 quay 自测发现不了**：quay 自己的 `.quay/` 下 **`promotion-outcome.jsonl` 与
`promotion-round.jsonl` 同时存在**（历史遗留），首个恰好存在 ⇒ 缺陷被掩盖。
只有在「只写新名字」的干净第三方项目上才暴露。**同硬规则 4：在开发检出里跑的测试结构上无法取假。**

**附带的第二个小缺陷（同一输出）**：`driver status` 非 `--json` 路径的输出**不以换行结尾**，
管道/终端里会与后续输出粘连（实测 260 字节无尾随 `\n`）。

**查重（立案时，按机制）**：`primaryPath` 命中 **0** 条（该谓词已用 `taskWorktreeOpen` 命中 2 条
校准，确为真零）；`carrier_path` 命中 7 条全部 status=done、全部属 AC139 族
（`gap-ac139-unified-driver-subcommand` 等——那条**造**了 `carrier_path`/`carrier_records`/
`last_record_ts` 这三个字段，AC3 只要求「status 带 last_record_ts、不得只报计数」），
**没有任何一条谈「取列表首个而非实际存在者」**。⇒ 本条是那条机制的下游缺陷，非重复。

## Plan

1. `primaryPath` 改为「carriers 中**实际存在**的第一个」；一个都不存在时，
   `carrier_path` 必须表达为「无」（null 或显式标记），**不得**报一个不存在的路径，
   且此时 `carrier_records` 必须为 0 或 `not-evaluated`——两个字段必须同源、同态。
2. status 输出补 carriers 的存在性分解（哪个存在、哪个没有），让「新旧载体名并存」
   这件事在读数上可见，而不是靠读代码才知道。
3. 非 `--json` 输出补尾随换行。

## Acceptance Criteria

- [x] AC1（负控制，改前必须红）：构造一个 `.quay/` 下只有 `<kind>-round.jsonl`、
      无 `<kind>-outcome.jsonl` 的 workspace，改前 `driver status --kind worker --json` 的
      `carrier_path` 指向不存在的文件而 `carrier_records > 0`；改后 `carrier_path` 指向
      实际存在的那个文件，且 `fs.existsSync(carrier_path)` 为真。
- [x] AC2：一个 carrier 都不存在时，`carrier_path` 为 null/显式「无」，且 `carrier_records`
      不是一个正数——两字段不得一真一假。
- [x] AC3：`driver status`（非 --json）输出以 `\n` 结尾——断言最后一个字节是换行。
- [ ] AC4：全量 `scripts/test.sh` 绿。（待外部）

## Definition of Done

在真实第三方项目 /home/yale/work/quay-fleet 上，四个 kind 的 `driver status --kind <k> --json`
其 `carrier_path` 全部指向实际存在的文件（`fs.existsSync` 为真）。fixture 满足不算数。

## Touches

- plugin/scripts/driver-runtime.ts
- plugin/test/driver-status-carrier-path.test.mjs
- tasks/gap-driver-status-carrier-path-names-first-entry-not-the-existing-one.md（自身）
