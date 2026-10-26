---
id: gap-suite-read-verb-current-and-recent-rounds
title: suite 没有只读 CLI 面：外部消费者只能直接读 4.6KB state + 102MB
  verification-round.jsonl，需要 --limit/--since 的有界 JSON 动词
status: ready
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

- [ ] AC1（动词与形状）：新增顶层只读动词 `quay suite --json`（分派/usage/help/delivery-manifest 四处同步，见 Touches），输出固定形状：
  `{ "current": {state,reason,runner,scope,startedAt,finishedAt,durationMs,laneCount,commit,taskId,runId}|null, "rounds": [{round,startedAt,durationMs,pass,fail,state}], "carrier": {state:"ok"|"absent"|"unreadable"|"empty-writer-zero-records", reason}, "evaluated": true|false }`
  贴一条真实 workspace 的实跑输出。
- [ ] AC1b（单位陷阱）：真实 `.quay/full-suite-state.json` 里 `startedAt` 是 ISO 字符串，而 `finishedAt` 是 **epoch 秒整数**（实测 `startedAt:"2026-10-25T22:14:20.100Z"`、`finishedAt:1792967664`）。输出必须把两者归一成同一口径（建议都用 ISO 字符串）并在 help 里写明，⛔ 不得原样混合两种单位交给消费者。贴归一前后的字段读数。
- [ ] AC2（`--limit` / `--since`）：`--limit N` 只返回最近 N 轮（默认 20）；`--since <ISO8601>` 只返回 `startedAt >= since` 的轮次；两者可组合。贴三次实跑（默认 / `--limit 3` / `--since`）。
- [ ] AC3（有界读取，本任务最重要）：`verification-round.jsonl` ≥100MB 时 `quay suite --json` **不得整读**该文件。贴 ① ≥100MB 合成载体（或真实载体）上的墙钟与峰值 RSS；② 一条证明「只读了尾部窗口」的读数（reader seam 统计读取字节数，或把文件前半段替换成不可解析噪声后结果不变）。⛔ 不允许「先整读再 slice」。
- [ ] AC4（三态）：`full-suite-state.json` 缺失 / 存在但不可解析 / 可读 三态在 `current` + `carrier.state` 上可区分（缺失 ⇒ `current:null` + `"absent"`；不可解析 ⇒ `current:null` + `"unreadable"` + reason）；rounds 侧「文件缺失」「存在但 0 条有效」「可读」三态同样可区分。贴四条实跑。
- [ ] AC5（单一实现）：复用 `readFullSuiteStateRaw` / `parseVerificationRound`（或把 `readCurrentSuiteRun` 扩成富投影并让 dashboard 继续用同一个），⛔ 不新增第二个 `full-suite-state.json` 解析点、不新增第二个 round 行 parser。贴解析点 grep 计数（前后不变）。
- [ ] AC6（能力探测）：响应带稳定字段集合，消费者可按「有没有 `current`/`rounds` 键」探测；`help.ts` 登记起始版本。

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
- `packages/quay/test/cli-suite.test.mjs`（新）
- `packages/quay/test/cli.test.mjs`
- `delivery-manifest.json`