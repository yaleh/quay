---
id: gap-suite-read-verb-current-and-recent-rounds
title: suite 没有只读 CLI 面：外部消费者只能直接读 4.6KB state + 102MB
  verification-round.jsonl，需要 --limit/--since 的有界 JSON 动词
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Finding

外部只读消费者（claudecodeui）为了显示 Tests 页，当前直接读 quay 的内部载体：`.quay/full-suite-state.json`（4.6KB）与 `.quay/verification-round.jsonl`（对方 102MB；本仓库 246MB），靠从文件尾部流式读。suite **没有任何 CLI/MCP 读取面**：`quay driver log` / `quay driver live` 只覆盖 worker 与在飞；没有 suite 动词。

仓库里已经有这些读数的单一实现，但它们只在 serve 内部可达：

- `.quay/full-suite-state.json` → `packages/quay/src/observation/liveness.ts:376` 的 `readFullSuiteStateRaw` 与 `:399` 的 `readCurrentSuiteRun`（后者只投影 state/runner/startedAt/runId/scope，缺 reason/finishedAt/durationMs/laneCount/commit/taskId）；
- `.quay/verification-round.jsonl` → `packages/quay/src/observation.ts:2683` 的 `TestRunRecord` 与 `readTests`（约 `:2922`，30s TTL 缓存，但**整文件读取 + 逐行解析**，成本 ∝ 载体大小）。

所以缺的不是数据，是一个**有界、可轮询、JSON 输出**的只读出口，并且必须复用上面两个 reader（⛔ 不写第二套 parser）。

## AC

- [x] AC1（动词与形状）：新增顶层只读动词 `quay suite --json`（分派/usage/help/delivery-manifest 四处同步，见 Touches），输出固定形状：
  `{ "current": {state,reason,runner,scope,startedAt,finishedAt,durationMs,laneCount,commit,taskId,runId}|null, "rounds": [{round,startedAt,durationMs,pass,fail,state}], "carrier": {state:"ok"|"absent"|"unreadable"|"empty-writer-zero-records", reason}, "evaluated": true|false }`
  贴一条真实 workspace 的实跑输出。
- [x] AC1b（单位陷阱）：真实 `.quay/full-suite-state.json` 里 `startedAt` 是 ISO 字符串，而 `finishedAt` 是 **epoch 秒整数**（实测 `startedAt:"2026-10-25T22:14:20.100Z"`、`finishedAt:1792967664`）。输出必须把两者归一成同一口径（建议都用 ISO 字符串）并在 help 里写明，⛔ 不得原样混合两种单位交给消费者。贴归一前后的字段读数。
- [x] AC2（`--limit` / `--since`）：`--limit N` 只返回最近 N 轮（默认 20）；`--since <ISO8601>` 只返回 `startedAt >= since` 的轮次；两者可组合。贴三次实跑（默认 / `--limit 3` / `--since`）。
- [x] AC3（有界读取，本任务最重要）：`verification-round.jsonl` ≥100MB 时 `quay suite --json` **不得整读**该文件。贴 ① ≥100MB 合成载体（或真实载体）上的墙钟与峰值 RSS；② 一条证明「只读了尾部窗口」的读数（reader seam 统计读取字节数，或把文件前半段替换成不可解析噪声后结果不变）。⛔ 不允许「先整读再 slice」。
- [x] AC4（三态）：`full-suite-state.json` 缺失 / 存在但不可解析 / 可读 三态在 `current` + `carrier.state` 上可区分（缺失 ⇒ `current:null` + `"absent"`；不可解析 ⇒ `current:null` + `"unreadable"` + reason）；rounds 侧「文件缺失」「存在但 0 条有效」「可读」三态同样可区分。贴四条实跑。
- [x] AC5（单一实现）：复用 `readFullSuiteStateRaw` / `parseVerificationRound`（或把 `readCurrentSuiteRun` 扩成富投影并让 dashboard 继续用同一个），⛔ 不新增第二个 `full-suite-state.json` 解析点、不新增第二个 round 行 parser。贴解析点 grep 计数（前后不变）。
- [x] AC6（能力探测）：响应带稳定字段集合，消费者可按「有没有 `current`/`rounds` 键」探测；`help.ts` 登记起始版本。

## DoD

- 新增 `packages/quay/src/cli/suite.ts`（handler），分派加在 `packages/quay/bin/quay.ts`；四处 verb 表面同步：dispatch、fallback usage 行、`help.ts` synopsis + `packages/quay/test/cli.test.mjs` block14 的 `dispatchVerbs` 数组、`delivery-manifest.json` 的 capabilities。
- 尾部窗口读取与 `.quay/worker-round.jsonl` 的既有尾部读法同源（同一套 helper），⛔ 不各写一遍。
- `packages/quay/test/cli-suite.test.mjs` 覆盖 AC2/AC3/AC4，fixture 用临时 workspace，文件头 `// @test-group product`。
- ⛔ 不启动 serve、不依赖 serve 进程。

## Touches

- `tasks/gap-suite-read-verb-current-and-recent-rounds.md`（自指）
- `packages/quay/src/cli/suite.ts`（新）
- `packages/quay/bin/quay.ts`
- `packages/quay/src/cli/help.ts`
- `packages/quay/src/observation.ts`
- `packages/quay/src/observation/liveness.ts`
- `packages/quay/src/observation/records.ts`（既有尾部读法正本；泛化成 `scanJsonlTail` 供 suite 与 worker-round 共用 —— DoD「同一套 helper」要求的唯一落点）
- `packages/quay/test/cli-suite.test.mjs`（新）
- `packages/quay/test/cli.test.mjs`
- `delivery-manifest.json`

## Evidence

### AC1 —— 真实 workspace 实跑（2026-10-26，root=`/data/home/yale/work/quay`）

```
$ node --experimental-strip-types packages/quay/bin/quay.ts suite --json --root /data/home/yale/work/quay
{
  "current": {
    "state": "green", "reason": null, "runner": "inner", "scope": "worktree",
    "startedAt": "2026-10-25T22:14:20.100Z", "finishedAt": "2026-10-25T22:34:24.000Z",
    "durationMs": 1204025, "laneCount": 123,
    "commit": "bc11214a52b86008077c6e9ed1aed2b67408f177",
    "taskId": "gap-routine-architecture-analysis-god-package-serve-fanout-556",
    "runId": "mfi-gap-routine-architecture-analysis-god-package-serve-fanout-556-1792966438217-bc0929"
  },
  "rounds": [ {"round":3101,"startedAt":"2026-10-25T22:14:23.952Z","durationMs":1190852,"pass":12398,"fail":5,"state":"red"}, … 共 20 条 ],
  "carrier": {
    "state": "ok", "reason": null,
    "suiteState": {"state":"ok","reason":null},
    "rounds": {"state":"ok","reason":null,"bytesRead":5505024,"exhausted":false}
  },
  "evaluated": true
}
```

顶层键恰为 `current / rounds / carrier / evaluated`（AC6 的探测契约）。

### AC1b —— 归一前后

| 字段 | 载体原值 | 输出值 |
|---|---|---|
| `startedAt` | `"2026-10-25T22:14:20.100Z"`（string, ISO） | `"2026-10-25T22:14:20.100Z"`（ISO，不变） |
| `finishedAt` | `1792967664`（number, epoch **秒**） | `"2026-10-25T22:34:24.000Z"`（ISO） |

交叉核对：`1792967664 * 1000 === Date.parse("2026-10-25T22:34:24.000Z")`；且 `startedAt + durationMs` = 22:14:20.100 + 1,204,025 ms = 22:34:24.125，与 finishedAt（秒精度）一致。毫秒容器同样归一（测试里把同一值写成 `1792967664000`，输出与上表逐字相同）。规则写在 `help.ts` 的 `quay suite --help`：有限数值 < 1e11 视为秒、≥ 1e11 视为毫秒；两种都发布为 ISO 8601 UTC。归一实现 = `liveness.ts:suiteTimestampToIso`（唯一一处）。

### AC2 —— 三次实跑（同一真实 workspace）

| 调用 | 返回轮次 | 条数 | bytesRead |
|---|---|---|---|
| 默认 | 3101, 3100, 3099, 3098, 3097 … | 20（= `SUITE_ROUNDS_DEFAULT_LIMIT`） | 5,505,024 |
| `--limit 3` | 3101, 3100, 3099 | 3 | 1,310,720 |
| `--since 2026-10-25T21:00:00Z` | 3101 (22:14:23.952Z), 3100 (21:26:42.986Z), 3099 (21:01:36.166Z) | 3 | 1,310,720 |

（`--since` 正确排除了 3098 @ 2026-10-25T20:41:52.012Z，它早于截止时刻。）组合用法 `--since … --limit 2` 在 `cli-suite.test.mjs` AC2 块有断言；空窗口（`--since 2027-01-01`）exit 0 且 `carrier.rounds.state:"ok"` —— 「窗口空」不是「载体坏」。

### AC3 —— 有界读取（真实 250MB 载体 + 噪声对照）

- 载体：`.quay/verification-round.jsonl` = **250,302,491 字节**（3101 行，单行约 80KB）。
- 默认 `quay suite --json`：**bytesRead = 5,505,024 字节 = 载体的 2.2%**，`exhausted:false`；墙钟 **0.13 s**，峰值 RSS **114,588 KB**（`/usr/bin/time -v`）。⛔ 不是「先整读再 slice」：250MB 读进内存本身就 >200MB RSS。
- `--limit 3`：bytesRead = 1,310,720 字节（0.52%）。
- 读取字节数是**直接量并对外暴露**（`carrier.rounds.bytesRead`），消费者不必自证。
- **噪声对照**（`cli-suite.test.mjs` AC3，16MB 合成载体）：把文件**前 60%** 替换成不可解析噪声（`"!!! NOT JSON !!!"` 重复，解析计数 0）后，`rounds` 与替换前**逐字节相同**且 `exhausted:false` ⇒ 前半段从未被读取。同一测试断言 `bytesRead < size/4`。对照的对照：显式校验注入噪声里可解析行数 = 0（否则该负控制是空的）。
- `--since` 同样有界：截止点落在最近 20 轮内时窗口只长到覆盖边界，不读整个（含噪声的）载体。

### AC4 —— 三态 × 两侧（实跑）

| fixture | `current` | `carrier.state` | `suiteState.state` | `rounds.state` | `evaluated` | exit |
|---|---|---|---|---|---|---|
| 两个载体都不存在 | `null` | `absent` | `absent` | `absent` | true | 0 |
| state 文件存在但非 JSON | `null` | `unreadable` | `unreadable`（带 reason） | `absent` | false | 1 |
| state 可读、ledger 缺失 | `{state:"green",…}` | `absent` | `ok` | `absent` | true | 0 |
| state 可读、ledger 存在但 0 条有效 | `{state:"green",…}` | `empty-writer-zero-records` | `ok` | `empty-writer-zero-records` | true | 0 |
| 两侧都可读 | `{state:"green",…}` | `ok` | `ok` | `ok` | true | 0 |

`unreadable` 的 stderr：`quay suite: .quay/full-suite-state.json is not valid JSON: Expected property name or '}' at position 2`。⛔ 「缺失」与「读不懂」不同形（硬规则 3b）；「缺载体」仍是**已评估**读数，只有「存在但读不懂」是 `evaluated:false` + exit 1。

### AC5 —— 解析点 grep（前 = develop `f40d5afd0`，后 = 本任务分支）

| 量 | 前 | 后 |
|---|---|---|
| `full-suite-state.json` 的 `JSON.parse` 代码点（`observation/liveness.ts`，排除注释） | 1 | 1（`readFullSuiteStateCarrier`；`readFullSuiteStateRaw` 改为它的薄包装） |
| `parseVerificationRound` **定义** | 1 | 1 |
| `parseVerificationRound` **消费点** | 1（`parseRoundLines`） | 2（`parseRoundLines` + `readRecentSuiteRounds`），同一份定义 |
| 反向增长窗口循环（`window * 4`） | 1（`lastRoundInFlightTasksInFile`） | 1（`scanJsonlTail`），消费者 2 个：worker-round 尾读 + suite rounds |

⇒ 没有第二个 state 解析点，没有第二个 round 行 parser，没有第二套尾部读法。

### AC6 / DoD

- 响应键集合恒定；空载体时仍是 `current:null` + `rounds:[]` 而非缺键。
- `quay --help` synopsis 增加 `quay suite [--json] [--limit <n>] [--since <ISO8601>] [--root <path>]   (first shipped in 0.24.0-dev)`（v0.23.0 已发布且不含本动词，故起始版本记 0.24.0-dev）；`quay suite --help` 有独立详解段（含单位归一规则）。
- `delivery-manifest.json` capabilities 增加 `{"name":"suite","kind":"cli-command","verifiedBy":"packages/quay/test/cli-suite.test.mjs"}`；`capability-manifest-check` PASS（cli-command source=24 manifest=24）。
- 测试：`cli-suite.test.mjs` 6/6 通过；`cli.test.mjs`、`cli-live.test.mjs`、`lanes-cli.test.mjs`、六个 dashboard/tests 页测试全部通过；`tsc --noEmit -p packages/*/` 四个包全绿；`scripts/test.sh --for-task gap-suite-read-verb-current-and-recent-rounds --allow-thin` EXIT=0。
- ⛔ 未启动 serve、未依赖 serve 进程（读取仅限 root 下两个文件）。

## Dark-axis record (ADR-007)

- 该轴仍暗,理由:本轮未取 L_D/L_G 读数——worktree 内无 `.archguard/query`（archguard_detect_cycles 直接返回 "No query data found"），且本任务是只读 CLI 出口、不改变包间依赖结构，故不声称任何 L_D/L_G 数值。
