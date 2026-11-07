---
id: gap-routine-semantic-dedup-scan-check-main-root-json-argv-loop
title: "semantic-dedup-scan: The eight-line --root/--root=/--json loop is
  byte-identical in five check scripts that already import gate-script-base,
  whose parseArgs supports the same spec "
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
The eight-line --root/--root=/--json loop is byte-identical in five check scripts that already import gate-script-base, whose parseArgs supports the same spec form; only the post-check printf differs

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1794036444725` · ts `2026-11-07T07:27:24.725Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`main`
- 涉及文件：
- `plugin/scripts/serve-binding-literal-check.ts:213`
- `plugin/scripts/worktree-namespace-literal-check.ts:127`
- `plugin/scripts/registry-path-literal-check.ts:155`
- `plugin/scripts/freshness-producer-coverage-check.ts:742`
- `plugin/scripts/probe-fallback-path-check.ts:363`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-07T07:27:24.725Z

## Disposition
**处置：修掉（extract 落地），⛔ 不是「已有机制在管」。** 共享 parser 早就在（五个文件都已 import
`plugin/scripts/gate-script-base.ts`），只是这五处仍在私有手搓 token loop —— 正是 finding 说的
「shared home existed, copies were pure maintainability debt」。

- `serve-binding-literal-check` / `worktree-namespace-literal-check` / `registry-path-literal-check`：
  逐字节相同的 8 行 `--root`/`--root=`/`--json` 循环 → `parseArgs` 的 spec 形式；`unknown: "skip"`
  逐字保留旧循环的 unknown-flag 行为（丢掉 token，不吃它后面那个 token）。
- `probe-fallback-path-check` / `freshness-producer-coverage-check`：同样三臂再各自加了自己的 flag →
  同一 parser + `help:"return"` / `errors:"return"`，逐字保留两者的 help 文本与 unknown-flag 出口
  （probe：stderr + exit 2；freshness：stdout + `helpExit`）。
- `plugin/test/gate-script-base-adoption.test.mjs`：五个载体并入 family ratchet，日后任一处再现私有
  token loop 直接变红，不依赖有人记得更新名单。

可核读数（在本任务 worktree 实跑，非断言）：
- `grep -c 'baseParseArgs(' <五个文件>` ⇒ 各 1（5/5 走共享 parser）
- 同五文件的私有 token 比较（`=== "--…"` / `startsWith("--")`）⇒ 各 0
- `plugin/test/gate-script-base-adoption.test.mjs` ⇒ 22 tests / 0 fail（含新增 5 条载体用例）
- 五个载体的既有端到端测试 ⇒ 70 tests / 0 fail
- scoped gate `scripts/test.sh --for-task <id> --allow-thin` ⇒ exit 0（`ℹ fail 0`）
- 载体 finding 仍在 `.quay/routine-findings.jsonl:3893`，runId/dupKind/verdict 与本 Finding 一致

ADR-007 暗轴记录：
- L_G archguard(package-cycles, snapshot 03:31Z): cycles=0, maxScc=1

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `check-main-root-json-argv-loop`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1794036444725`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/serve-binding-literal-check.ts`
- `plugin/scripts/worktree-namespace-literal-check.ts`
- `plugin/scripts/registry-path-literal-check.ts`
- `plugin/scripts/freshness-producer-coverage-check.ts`
- `plugin/scripts/probe-fallback-path-check.ts`
- `plugin/test/gate-script-base-adoption.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-check-main-root-json-argv-loop.md`
