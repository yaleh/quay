---
id: gap-routine-semantic-dedup-scan-read-current-state-duplicate
title: "semantic-dedup-scan: byte-identical JSON.parse-or-null state reader
  declared twice; no shared readJsonOrNull helper exists in plugin/scripts"
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
byte-identical JSON.parse-or-null state reader declared twice; no shared readJsonOrNull helper exists in plugin/scripts

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791536153223` · ts `2026-10-09T08:55:53.223Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`readCurrentState`、`readState`
- 涉及文件：
- `plugin/scripts/mirror-full-suite-state.ts:128`
- `plugin/scripts/red-window-triage.ts:159`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
merge into one shared readJsonOrNull

## Disposition
**Fixed** —— 两份 byte-identical 私有读者已合并为一个 `readJsonOrNull`，住在
`plugin/scripts/gate-script-base.ts`（同一条 routine 早先几次 finding 抽出的 `readJsonLines` /
`readJsonlLines` 旁，同一节）。

- `readJsonOrNull<T = any>(file: string): T | null` —— 解析整个文件；缺失 / 不可读 / 解析失败一律 `null`。
  这个「读不懂 ⇒ null」正是两个调用方分支所依赖的契约（无可用状态 ⇒ 当不存在、写新的）。
- `plugin/scripts/mirror-full-suite-state.ts` —— `readCurrentState` **保留原名与导出**
  （`worker-fan-in.ts:68` / `worker-driver.ts:270` / `plugin/test/mirror-full-suite-state.test.mjs:29`
  按该名 import），函数体改为委托 `return readJsonOrNull(file)`。
- `plugin/scripts/red-window-triage.ts` —— 私有 `readState` 删除，3 处调用点
  （`--partition` / `--record-verdict` / `--band`）改调 `readJsonOrNull(stateFile)`。
- 两个文件的 `node:fs` import 因之成为未用，已一并删除。

复核证据（均可重跑）：
- `node --no-warnings --test --experimental-strip-types plugin/test/gate-script-base.test.mjs`
  ⇒ 59 pass / 0 fail。新增的棘轮：`readJsonOrNull` 在 `plugin/scripts` 下**只有一处定义**；两个原载体
  **都不再内联该函数体、且各自 import** 共享实现；absent/corrupt/empty/EISDIR ⇒ `null` 的语义；
  以及「删掉共享导出 ⇒ 消费者 import 失败」的机制对照。
- `node --no-warnings --test --experimental-strip-types plugin/test/mirror-full-suite-state.test.mjs
  plugin/test/red-window-triage.test.mjs plugin/test/red-window-shared-gate.test.mjs` ⇒ 31 pass / 0 fail
  （两个载体的自测，行为未变）。
- **5b 完备性枚举**：全仓扫描 `plugin/scripts/*.ts` + `packages/*/src` 中形如
  `try { return JSON.parse(fs.readFileSync(…)) } catch { return null }` 的整函数体，修复前恰好是
  finding 点名的这两个，修复后为 0。其余「读 JSON 或 null」的读者
  （`concurrent-batch-scheduler.ts:loadReceiptTouches`、`fan-in-ff-protocol-check.ts:suiteRunInterval`、
  `ci-runs-collect.ts:readState`、`meta-driver.ts:readState`）都带额外校验 / 不同返回形状 ⇒ 非
  byte-identical，**有意不动**（同 `plugin/scripts/fs-walk.ts` 记录的非目标：不折叠语义不同的调用方）。
- `node --experimental-strip-types plugin/scripts/import-graph-check.ts` ⇒ PASS（valueSccs=0 /
  typeSccs=0 / reverseEdges=0；新增的 plugin→plugin 边不成环）。
- `node --experimental-strip-types plugin/scripts/instrument-failure-check.ts --gate` ⇒ PASS
  （5/5 族，FAMILY-5 43/43）。⚠️ 首版新注释行曾把 FAMILY-5 打到 45（该启发式把注释里的
  `full-suite-state` + 「read」+「state」同现当作「读派生视图断言实时」的假阳性）——已改写注释行消除，
  **基线未被抬高**。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `read-current-state-duplicate`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791536153223`）所描述的问题被复核并处置 —— 复核：finding 点名的两处私有读者条文逐字比对确认 byte-identical；处置：合并进 `gate-script-base.ts` 的 `readJsonOrNull`（见上）
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案 —— 结论是**已修掉**，判据见上「复核证据」：单一定义棘轮 + 两载体 import 棘轮 + 语义测试 + 5b 全仓枚举 + import-graph / instrument-failure 两闸 PASS

## DoD
- [x] 上面的判据实跑通过 —— `plugin/test/gate-script-base.test.mjs` 59/59、三份载体自测 31/31、import-graph-check PASS、instrument-failure-check --gate PASS（命令与读数见 `## Disposition`）
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑 —— 例程探针未重跑、未执行任何修复；修复由派发链（本 worker）在隔离 worktree 内完成

## Touches
- `plugin/scripts/gate-script-base.ts`
- `plugin/scripts/mirror-full-suite-state.ts`
- `plugin/scripts/red-window-triage.ts`
- `plugin/test/gate-script-base.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-read-current-state-duplicate.md`
