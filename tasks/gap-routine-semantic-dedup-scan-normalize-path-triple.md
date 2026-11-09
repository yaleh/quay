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
**复核结论：finding 属实（`real-duplication`），处置 = 修掉（extract）。** 三处不是「三份刚好长得像」，而是
**同一个概念的三份逐字节拷贝** —— 该概念**已有正本**：`packages/quay/src/core/goal-store-criterion-address.ts`
的 `realpathOrSelf`（`goal-store.ts` 公开导出、`driver-runtime.ts` / `goal-preview.ts` / `goal-driver.ts` 已在用）。
所以这是 copy-instead-of-call 债，不是缺失抽象。

**改法**：`realpathOrSelf` 移到一个**无依赖叶子** `packages/quay/src/core/fs-path.ts`，两侧都能 import：
Core（`loaded-version.ts` → `./fs-path.ts`）与内核（`archguard-runner.ts` → `../../packages/quay/src/core/fs-path.ts`；
plugin→packages 是受认可方向，反向才是 `import-graph-check` 的 `reverseEdges` 棘轮）。`goal-store-criterion-address.ts`
改为**再导出**（⛔ 不是复制 —— 硬规则 5b），故 `goal-store.ts` / `driver-runtime.ts` / `goal-preview.ts` /
`goal-driver.ts` 的历史 import 路径全部不变。

**行为取证（实跑，不是推断）**：`realpathOrSelf` 与三份拷贝只在**路径不存在**这一档分叉 —— 拷贝回落到
`path.resolve(p)`，正本沿**最近存在祖先**解析后再拼回剩余段。三个调用点都是**路径比较**（archguard manifest
`scopes[].sources` 对 `path.resolve(root, source)`；两处 `projectPath` 对 `root`），祖先解析只会让比较更准。
`archguard-runner` 反映得更直接：其注释本就写明「archguard normalizes with `realpathOrSelf(path.resolve(s))`」，
即**被匹配的那一侧一直用的是正本**，拷贝才是与它对不上的那一侧。

**⛔ 第三处有意保留（不是漏修）**：`plugin/scripts/resolve-quay-cli.ts` 的 `normalisePath` 仍是本地副本。该文件是
`docs/references/external-consumer-cli-location.md` 的**零依赖参考实现**，运行于**不含 `packages/` 树的插件缓存目录**
（其文件头明写「imports nothing outside `node:*`」）⇒ 改 import 会让交付产物启动即失败。已在原处注释里写明正本路径
与这条约束，⛔ 后来者不得靠 import `packages/**` 去「修」它。

**5b 扫描（同载体内的同形点，⛔ 不只修被报出来的三个）**：谓词 `grep -rl 'return fs.realpathSync(p);' --include=*.ts plugin packages | grep -v /test/`
**改前 = 3**（正是 finding 点名的三处）；**改后 = 6**，逐条分类：
- 真同形只剩 1：`resolve-quay-cli.ts`（上行说明的保留项）；
- 4 条**回落不同**，不是同一概念：`driver-runtime.ts:296`（回落 `p`）、`plugin-root.ts:135` 与
  `verify-plugin-channel-assertions.ts:129`（回落 `null`）—— 归 `realpathOrNull` 一族，不是本条；
- 2 条是**同一概念的另一种拼写**（非逐字节同体，探针未归并）：`meta-driver.ts:2094`、`slice-readings.ts:583`
  的一行式 `norm`。**本条不改**：它们的上下文（类型守卫 / 与 `abs` 的双向比较）与三份拷贝不同，改动超出 finding
  范围且引入行为面；留作后续探针若命中时的独立任务。

**残留读数是可判的**：`realpathOrSelf` 的完整实现只存在于 `fs-path.ts` 一处
（`grep -rn 'export function realpathOrSelf' packages plugin` ⇒ 1），三处调用点全部走它。

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `normalize-path-triple`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1794222946369`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/archguard-runner.ts`
- `plugin/scripts/resolve-quay-cli.ts`
- `packages/quay/src/core/loaded-version.ts`
- `packages/quay/src/core/fs-path.ts`
- `packages/quay/src/core/goal-store-criterion-address.ts`
- `tasks/gap-routine-semantic-dedup-scan-normalize-path-triple.md`
