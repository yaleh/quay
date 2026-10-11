---
id: gap-routine-semantic-dedup-scan-isdirectinvocation-pair
title: "semantic-dedup-scan: Byte-identical bodies; fold the pair as-is, but do
  NOT retarget onto name-based isDirectEntry (that is a behavior change), and
  concurrent-batch-scheduler.ts's "
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
Byte-identical bodies; fold the pair as-is, but do NOT retarget onto name-based isDirectEntry (that is a behavior change), and concurrent-batch-scheduler.ts's basename variant is deliberate divergence

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791733865369` · ts `2026-10-11T15:51:05.369Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`isDirectInvocation`
- 涉及文件：
- `plugin/scripts/config-wiring-check.ts:693`
- `plugin/scripts/drivable-workspace-check.ts:247`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
merge

## Disposition

**复核（实测，非转述）**：两处 `isDirectInvocation()` 函数体逐字相同（`realpathSync(argv[1])` vs
`fileURLToPath(import.meta.url)`），`real-duplication` 成立。`concurrent-batch-scheduler.ts` 的同名变体是
basename 形式、bundling-safe，属**有意分歧**——未动（finding 已如此判定，复核一致）。

**处置 = 合并，且合并与修掉是同一处编辑**：删除两处本地 helper，改为复用 `gate-script-base.ts` 既有的共享
`isDirectEntry(import.meta, undefined, "<name>")`（名字身份，`expectedBase` 为必填字面量）。

为什么名字形式是**必须**的（finding 里「不要 retarget」的前提被实测证伪）：`drivable-workspace-check.ts` 被
`external-dogfooding-check.ts` 当作**库**静态 import ⇒ esbuild 把它 inline 进该 entry 的 bundle ⇒ bundle 内所有
inline 模块共享同一个 `import.meta.url` ⇒ 旧的 file-identity 守卫在 bundle 内**恒为真** ⇒ 出厂
`dist/external-dogfooding-check.js` 跑的是 **drivable 的 main()**，自己的 main 从不运行（该 probe 由
`plugin/loop/fast-mode-loop-tick.md` 等真实调用，不是死码）。

对照（若上述机理为假，前后不会不同）——用真 builder `bundleEntries(['scripts/external-dogfooding-check.ts'])`
在任务 worktree 内构建后运行：
- 修前：`usage: node drivable-workspace-check.ts <path> … --registry <file>` / exit 2
- 修后：`usage: node external-dogfooding-check.ts <mode> [args]` / exit 2（本模块自己的 main）

名字形式在**每一条真实调用路径**上仍成立：源码 `…/config-wiring-check.ts`、`experiments/quay-perpetual-stream/scripts/`
镜像 symlink（同名 basename，`gap-config-wiring-check-symlink-noop` 的原始场景）、bundle `…/config-wiring-check.js`；
被 inline 时则惰性、不误触发。

**成簇检查（硬规则 5b）**：遍历全部 entry 的 import closure，同为「顶层裸标识守卫 + URL 身份」形状的模块只有
`drivable-workspace-check.ts` 一处（`goal-store.ts`/`ff-merge.ts`/`pane-state-classify.ts` 等用
`.endsWith("…ts")`/basename 名字形式，安全）。既有的 `findEntryGuardHijacks` **看不见**这个形状——它只读顶层
`if (<cond>)` 的条件文本，而这里是裸标识 `isDirect` ⇒ 这条 hijack 从未被那台闸抓到。⛔ 该闸的盲区不在本任务
Touches 内，记为后续观察项，不在此扩面。

**实跑读数**：`experiments/quay-perpetual-stream/test/config-wiring-check.test.mjs` 2/2 PASS；
`symlink-mirror-invocation.test.mjs` 48/48 PASS（两个文件仍被 symlink 发现机制命中，守卫在两条路径上都开火）；
`plugin/test/external-dogfooding-check.test.mjs` 17/17 PASS；scoped gate
(`scripts/test.sh --for-task … --allow-thin`) exit 0。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `isDirectInvocation-pair`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791733865369`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/config-wiring-check.ts`
- `plugin/scripts/drivable-workspace-check.ts`
- `tasks/gap-routine-semantic-dedup-scan-isdirectinvocation-pair.md`
