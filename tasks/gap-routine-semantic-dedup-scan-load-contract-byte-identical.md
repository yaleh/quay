---
id: gap-routine-semantic-dedup-scan-load-contract-byte-identical
title: "semantic-dedup-scan: Byte-identical body except the error noun;
  stage-1/stage-2 siblings that already share routine-engine-module-loader."
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
Byte-identical body except the error noun; stage-1/stage-2 siblings that already share routine-engine-module-loader.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1794127147981` · ts `2026-11-08T08:39:07.981Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`loadContract`
- 涉及文件：
- `plugin/scripts/unencapsulated-state-clue.ts:99`
- `plugin/scripts/unencapsulated-state-judge.ts:63`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract a loader factory into that shared module

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-08T08:39:07.981Z

## 处置结论（复核 → 修掉）

**复核：finding 成立（`real-duplication`）。** 两处 `loadContract` 的 body 逐字相同 —— 同一个
`resolveEngineModuleIn(root, CONTRACT_FILE, CONTRACT_DIR_REL)`、同一个 `r.path === null` 判空、同一句
`CAUSE=semantic-admission-contract-unresolved — … could not be found; tried …`、同一个
`importEngineModuleAt(r.path, contractCache)` —— 唯一差异是 refusal 里指代自家词表的那个名词
（`the clue vocabulary` / `the judge vocabulary`）。这正是硬规则 5b 的形态：将来改一次 refusal（换候选路径 /
补 `tried` 提示 / 改缓存规则）必须改两遍，漏掉的那份静默保留旧行为。

**处置：修掉**（不是「已有机制在管」）。按 finding 的 requested action，把 loader **工厂**放进两个 stage
本就共用的 `plugin/scripts/routine-engine-module-loader.ts`：

- 新增 `makeThrowingEngineModuleLoader(cache, dirRel, file, {cause, subject})` —— throw 风格的单模块
  loader，与既有 `makeEngineModuleLoader`（`unresolved[]` out-parameter 风格）并列。解析与运行时 import
  仍走同一对共用原语 `resolveEngineModuleIn` / `importEngineModuleAt`；工厂只多出那一句 refusal 的**形状**
  （句子共享，`cause` / `subject` 是仅有的两个 per-caller 旋钮，即两个 stage 唯一真正不同的东西）。
- `unencapsulated-state-clue.ts` / `unencapsulated-state-judge.ts` 的 `loadContract` 各变成**一行工厂调用**
  + 自家名词。两个文件里不再出现 `resolveEngineModuleIn(` / `importEngineModuleAt(` /
  `could not be found; tried`（新增测试的三条 source arm 机械钉住；每条谓词都先对着 pre-fix 样本干跑一次，
  证明它不是「匹配不到任何东西」的零 —— 硬规则 2）。
- 行为不变：`loadContract(REPO)` 在两个 stage 仍解析到**同一个** contract 模块对象（同一命中缓存规则），
  refusal 仍是 `CAUSE=semantic-admission-contract-unresolved` 且列出它试过的每一个候选路径（硬规则 3b）。

**为什么 scope 停在两个 stage（硬规则 5b 的 grep 结果）**：仓库里另外两处 throw 风格 loader
（`cross-project-dogfood-routine.ts` 的 `loadEngineModule`、`open-semantic-discovery-routine.ts` 的
`loadStreamDiagnostics`）的 refusal **句子形状本身就不同**（前缀不同、`tried` 连接词不同），且各自只有一份
—— 它们不是彼此的副本，且都已复用同一对原语。把它们的措辞塞进同一签名等于让这个工厂第二次长参数
（loader 头注释里「caller owns its refusal wording」那条设计即为此）。⇒ `loadContract` 的**逐字副本数 = 0**，
没有第三份。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `load-contract-byte-identical`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1794127147981`）所描述的问题被复核并处置 —— 复核见上「处置结论」首段（两处 body 逐字对比，唯一差异为 refusal 名词）；处置 = 抽工厂到共用 loader 模块，两处调用点各剩一行配置 + 自家名词。
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案 —— 实跑 `node --experimental-strip-types --test plugin/test/unencapsulated-state-admission.test.mjs` 7/7 pass；其中新增 `dedup(loadContract)` 一条同时给出 (a) 三条 source arm（两 stage 各 3 条 `doesNotMatch`，每条谓词先对 pre-fix 样本 `assert.match` 干跑验证非空）(b) 两条 live arm（两 stage 的 `loadContract(REPO)` 解析到同一个 `contract` 模块对象：`assert.equal(fromClue, contract)` 与 `(fromJudge, contract)`）(c) refusal arm（缺文件时抛 `CAUSE=…`，且 message 列出它试过的每个候选路径）。

## DoD
- [x] 上面的判据实跑通过 —— 目标测试 7/7；两个生产入口本身也实跑：`unencapsulated-state-clue.ts --root . --scan plugin/fixtures/unencapsulated-state --json` exit 0、`unencapsulated-state-judge.ts --subjects true-state-cluster.ts,memoized-probe.ts --json` exit 0（四条记录的 clue 状态与 judge 的三个 verdict 均与改动前一致）。
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑 —— 本任务由 worker 派发链执行；探针（`semantic-dedup-scan`）只写了 finding 行，未改动任何 tracked 文件。

## ADR-007 dark axis
- L_G archguard-runner --root . — 六 scope 全 PASS；本次改动所在 scope `plugin/scripts`: entities=4918 relations=11286 entitySccCount=0 directoryCycleCount=0 evaluated=true；`packages/quay/src`: entitySccCount=0 directoryCycleCount=0 evaluated=true。本改动只把一份重复实现收进既有共用模块，未新增包/目录依赖边（无新 import 边：两处都只是换了取自同一文件的符号）。

## Touches
- `plugin/scripts/routine-engine-module-loader.ts`
- `plugin/scripts/unencapsulated-state-clue.ts`
- `plugin/scripts/unencapsulated-state-judge.ts`
- `plugin/test/unencapsulated-state-admission.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-load-contract-byte-identical.md`