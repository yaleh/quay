---
id: gap-routine-semantic-dedup-scan-normalize-path-triple
title: "semantic-dedup-scan: Three byte-identical 'realpathSync else
  path.resolve' helpers under three spellings across both surfaces."
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
Three byte-identical 'realpathSync else path.resolve' helpers under three spellings across both surfaces.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1794222946369` · ts `2026-11-09T11:15:46.369Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`normalizeFsPath`、`normalisePath`、`normalizeProjectPath`
- 涉及文件：
- `plugin/scripts/archguard-runner.ts:536`
- `plugin/scripts/resolve-quay-cli.ts:193`
- `packages/quay/src/core/loaded-version.ts:388`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-09T11:15:46.369Z

## Disposition
**复核结论：finding 属实（`real-duplication`），处置 = 修掉（extract，且修全）。**

**为什么「只修点名的三处」是错的**：同一个 body 在 `.quay/routine-findings.jsonl` 里已被立案 **8 次**
（`normalize-path-realpath-or-resolve` 2026-10-28 → `normalise-path-copy` → `path-normalization` → `B2` →
`path-normalization-3x` → `path-normalization-quad` 2026-11-07 → 本条 2026-11-09），且每次都多认出几处。
只修三处 ⇒ 下一轮以 pair 形态再立案 ⇒ 本条自己的 Effect Prediction 直接作废。

**改法（每个面各一个正本；为什么不是「全仓一个」写在下面）**
- **内核**：新叶子 `plugin/scripts/fs-path.ts`，导出 `realpathOrResolve`（**精确**谓词：realpath 优先，
  失败回落 `path.resolve`）。6 个载体改为 import：`archguard-runner` / `resolve-quay-cli` / `meta-driver` /
  `slice-readings` / `routine-file-gate` / `arch-coverage-report`（后者保留 `canonicalPath` 作为本地别名再导出，
  历史调用点不动）。
- **Core**：`packages/quay/src/core/fs-path.ts` 的 `realpathOrSelf`（**更宽**的谓词：路径不存在时沿**最近存在
  祖先**解析再拼回剩余段）。`loaded-version.ts` 改用它；`goal-store-criterion-address.ts` 改为**再导出**
  （⛔ 不是复制 —— 硬规则 5b），`goal-store.ts` / `driver-runtime.ts` / `goal-preview.ts` / `goal-driver.ts`
  的历史 import 路径全部不变。
- **⛔ 为什么不是「一个实现全仓通用」**：① Core 不得 import 内核 —— `import-graph-check` 的 `reverseEdges`
  棘轮（实测 baseline=0 / head=0）；② 插件缓存目录不含 `packages/` 树（`resolve-quay-cli` 的消费者约束）。
  ⇒ 两面各需一份，能达到的最大值是**每面各一份、且各有唯一一个定义**。两者只在「路径不存在」这一档不同，
  而全部调用点都是**字符串比较**；`resolve-quay-cli` 与 `loaded-version` 实现同一条 tier 规则，路径不存在时
  任何拼写都不可能命中存在的 `root` ⇒ 宽写法不会把匹配翻过来。两处注释互相点名这条边界。

**取证（实跑，不是推断）**
- **归零读数**：谓词 `grep -rl 'return fs.realpathSync(p);' --include=*.ts --include=*.mjs plugin packages | grep -v /test/`
  **改前 = 3**（finding 点名的三处）；**改后 = 5 命中但只剩 1 条同 body**（`plugin/scripts/fs-path.ts` 正本），
  其余 4 条**回落不同**、不是同一谓词：`driver-runtime.ts:296` 与 `loop-shipping-exclusion-data.mjs:129`
  回落 `p`；`plugin-root.ts:135` 与 `verify-plugin-channel-assertions.ts:129` 回落 `null`（`realpathOrNull` 一族）。
- **位置判据（新守卫，机械产物）**：`plugin/test/fs-path.test.mjs` 把 body 做**空白归一化 + 参数名反向引用**，
  扫 `plugin/scripts` + `packages/*/src`（非 test）⇒ 命中集合**恰好** `["plugin/scripts/fs-path.ts"]`；
  并断言扫描面 >100 文件（空面不得与「干净」同形，硬规则 3b）。⚠️ 写法注意：`export { x as y } from` **不会**
  在模块作用域产生本地绑定 —— `arch-coverage-report` 必须 `import { realpathOrResolve as canonicalPath }`
  再 `export { canonicalPath }`（本轮实测踩到：13 个测试 `ReferenceError: canonicalPath is not defined`）。
- `realpathOrSelf` 全仓**定义**数 = 1（`core/fs-path.ts`），`goal-store-criterion-address.ts` 为再导出。
- **单测**：`fs-path.test.mjs` 3/3；`routine-file-gate` 33/33；`slice-readings` 9/9；`meta-driver` 189/189；
  `arch-coverage-report` 20/20；`archguard-structural-gate-fan-in` + `driver-runtime-loaded-version-drift` 36/36。
- **静态**：`npx tsc --noEmit` 四个 package 全绿；`import-graph-check` valueSccs=0 typeSccs=0 reverseEdges=0；
  `capability-catalog.sh --summary` = **418 scripts | 418 declared | 0 unclassified**（新脚本已按六字段登记，
  `plugin/test/archive-exclusion-wiring.test.mjs` 的「catalog must stay green」因此不红）。
  `deriveEntries(plugin)` = **136**（worktree）对 **136**（主检出）⇒ 新叶子不是 bundle entry，交付面文件数不变。

**scoped gate 实跑读数**：`bash scripts/test.sh --for-task gap-routine-semantic-dedup-scan-normalize-path-triple --allow-thin`
⇒ **exit 0**，`tests 349 / pass 349 / fail 0`，静态层全 PASS（含 `import-graph-check` 0/0/0、`sh-census`、
`test-isolation`、`test-file-snapshot: OK`、`capability-catalog --superseded-check`）；
`worker-driver --verify-run` ⇒ `classification":"green"` exitCode=0 wallMs=62300；
`--verify-rerun` ⇒ `not-evaluated(reason=verify-state-missing)` 并 `fellBackToScopedGate:true`（同一 scoped gate，绿）。
`anti-drift-touches-check --merge-target develop` ⇒ **OK — 13 actual file(s), all within declared Touches (13 glob(s))**。

**5b 扫描（同载体内的同形点，⛔ 不只修被报出来的三个）**：除 finding 点名的 3 处外，同一 body 还存在于
`meta-driver.ts`、`slice-readings.ts`、`arch-coverage-report.ts`（函数体）与 `routine-file-gate.ts`（两处内联）；
**全部改掉**。谓词同上的「改后 = 5 命中」逐条分类见上（4 条不同回落已点名排除）。

**残留（⛔ 不声称更多）**：同一 body 的副本数 = **0**；两种谓词各有唯一实现并互相交叉引用。本条不声称
「所有 realpath 用法都已统一」—— `evaluationContext` / `kernelSelfPath` / `realpathOrNull` 一族是**别的**
回落语义（保留原路径 / 回落 `p` / 回落 `null`），不在本条范围。

## Dark axes (ADR-007)
- L_G archguard: valueSccs=0 typeSccs=0 reverseEdges=0 (plugin/scripts/import-graph-check.ts --root . on this worktree)

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `normalize-path-triple`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1794222946369`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/archguard-runner.ts`
- `plugin/scripts/resolve-quay-cli.ts`
- `plugin/scripts/meta-driver.ts`
- `plugin/scripts/slice-readings.ts`
- `plugin/scripts/routine-file-gate.ts`
- `plugin/scripts/arch-coverage-report.ts`
- `plugin/scripts/fs-path.ts`
- `plugin/scripts/capability-catalog-declarations.json`
- `plugin/test/fs-path.test.mjs`
- `packages/quay/src/core/loaded-version.ts`
- `packages/quay/src/core/fs-path.ts`
- `packages/quay/src/core/goal-store-criterion-address.ts`
- `tasks/gap-routine-semantic-dedup-scan-normalize-path-triple.md`

## Blocker

**2026-11-09T12:07:59.832Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: AssertionError [ERR_ASSERTION]: The input did not match the regular expression /^NOT-EVALUATED\(reading-unavailable: .*moduleGraph.*\) l-g\/cycle-repo/m. Input: [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=plugin/test/git-lens-selfcheck.test.mjs changed=-]
- run_id：wk-prod-anchor
- session_id：9c639da6-dd9d-43b3-bf7b-5e1a530508c3
