---
id: gap-routine-semantic-dedup-scan-p197
title: "semantic-dedup-scan: diff proves the bodies are byte-identical at module
  level too (same __dirname/MANIFEST_PATH constants); the only delta is the
  two-line header comment naming th"
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
diff proves the bodies are byte-identical at module level too (same __dirname/MANIFEST_PATH constants); the only delta is the two-line header comment naming the provider, and each header says it mirrors the other, the classic extract-me signal.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790592211995` · ts `2026-09-28T10:43:31.995Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`readManifest`
- 涉及文件：
- `packages/quay-backlog/src/manifest.ts:14`
- `packages/quay-github/src/manifest.ts:14`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract (a copy that names its source)

**处置：⛔ 不 extract —— 逐包副本就是正确形态。** 观测成立：复核后两文件去注释正文仍是同一哈希
`689ba07da3d4d0a8`，且是 `packages/*/src` 下（122 文件）**唯一**一对。但 requested action 在四条
机械读数下不成立：
① **依赖边界** —— `quay-github`/`quay-backlog` 的 `package.json` **不声明 `quay` 依赖**，其唯一 Core
触点是 `import type`（运行期抹除）；共享 loader 必须从 Core import，等于给两个「证明 ABI 可迁移」的
provider 加上其刻意不拥有的**运行期**依赖（只有 `quay-native` 声明了 `"quay": "*"`）。
② **可共享的余量只有一行**（`YAML.parse(raw) as Manifest`）；路径派生按构造就是逐模块的 ——
`quay-native` 的参数化形态**仍然**自带 `DEFAULT_MANIFEST_PATH`，证明共享 helper 并不能消除它。
③ **该模块是打包接缝** —— `quay-native` 正因 `import.meta.url` 在 SEA 下为空才需要
`scripts/manifest.sea-shim.js` + esbuild `--alias`；上提到 Core 会把一个每位 provider 必须自控的接缝
放到它控制不到的地方。
④ **该 finding 点名的危害（静默 drift）在整段历史中发生 0 次**（硬规则 12：无发生率读数不立新机制）。
同一次扫描的兄弟候选 `p141` 以同一条依赖理由得出同一结论。

**在管的机制与失败在哪一步**：`plugin/scripts/routine-file-gate.ts` 的三道闸，经
`plugin/scripts/probe-routine.ts` 的**有序**立案环驱动。失败在「同一 dedup 主语下相互矛盾的候选之间
**没有比较步**」：该轮 226 候选只立案 3 条，而同一符号集 `{readManifest}` 下三条候选结论互相矛盾 ——
`p141` `leave`（依赖边界）被 `action:` 闸按「a measurement, not work」丢弃、`p197` `extract` 取得立案位、
`p198` `merge` 被 `dedup:` 闸拒绝；而 `dedup:` 的键正是三者**完全相同**的符号集，故它只能拒绝
「键已在板上」之后到达的候选，结构上无法比较键的主人与同键对手的结论。⇒ 声明了 action 的候选按到达
顺序取胜，证据最充分的那条（`leave`）反而不可达。完整证据、逐字闸记录与可复跑命令见
`docs/analysis/provider-manifest-reader-is-a-per-package-copy.md`（含建议的后续：给闸加一个同主语矛盾步；
按硬规则 12 记为观察项，⛔ 不作阻塞）。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `p197`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790592211995`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay-backlog/src/manifest.ts`
- `packages/quay-github/src/manifest.ts`
- `docs/analysis/provider-manifest-reader-is-a-per-package-copy.md`
- `tasks/gap-routine-semantic-dedup-scan-p197.md`