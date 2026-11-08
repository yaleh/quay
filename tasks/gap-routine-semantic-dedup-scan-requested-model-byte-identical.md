---
id: gap-routine-semantic-dedup-scan-requested-model-byte-identical
title: "semantic-dedup-scan: Byte-identical 7-line argv model probe; the two
  routines are deliberate siblings but no shared helper exists."
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
Byte-identical 7-line argv model probe; the two routines are deliberate siblings but no shared helper exists.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1794127147981` · ts `2026-11-08T08:39:07.981Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`requestedModel`
- 涉及文件：
- `plugin/scripts/cross-project-dogfood-routine.ts:994`
- `plugin/scripts/open-semantic-discovery-routine.ts:4315`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract into the shared routine engine loader both already import

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-08T08:39:07.981Z

## Disposition
**已修掉**（不是「已有机制在管」）。按 finding 的 `suggestedAction`，把 REQUESTED-model 探针抽成
`requestedModelFromArgv(buildArgv, root, maxTurns)`，落 `plugin/scripts/routine-engine-module-loader.ts` ——
两个 routine **本来就已经 import 该模块**（dogfood 用它做 engine-module resolution；OSD 用
`importEngineModuleAt` / `makeEngineModuleLoader` / `resolveEngineModuleIn`），故无需新增依赖方向。
两个私有副本（`cross-project-dogfood-routine.ts:994` / `open-semantic-discovery-routine.ts:4315`）删除，改调共享探针。

**为什么落在这里而不是任一 routine**：该模块是**叶子**（不 import 任何 routine）。放进任一 routine 会让兄弟变成
兄弟的依赖；而 `--model` 问的是 launcher「被要求了什么」，不属于某个 routine。

**语义**：与退役副本在其可被喂入的每个 argv 上相同 —— 无 `--model`、`--model` 悬空（末位）、builder 抛异常，三态
都返回 `null`（调用方记为 `not-evaluated:model-unverified`，硬规则 3b：未知不得伪装成已验证）。argv 仍以
`tools:""` / `outputFormat:null` / `model:null` 构建 —— 即「真实调用在选模型之前」的同形 argv，故读到的是
REQUESTED 身份，而非流里的 ACTUAL 服务模型。

**⑤b 扫描**（同一原则在本载体的其它适用点）：迁移后 `plugin/scripts` 全量 `indexOf("--model")` 只剩 **1 处**
（= 定义处本身），无第三个生产副本；`plugin/test` 里的使用点都是**内联断言**，不是私有 helper 副本（不属本类）。
修复前同一谓词命中 **2 个文件**（两个前载体），修复后 1 个（唯一 home）。

**可核证据（一条命令）**：`node --test plugin/test/gap-routine-semantic-dedup-scan-requested-model-byte-identical.test.mjs`
—— 7 测试：单一定义棘轮 +「全 `plugin/scripts` 零私有副本」（结构化、名字无关谓词）+ 两个前载体均 **import 且 CALL**
+ 双向负控制（逐字退役体 / 改名 local / function 声明式必判为私有副本；adopted 调用 / 无 `+1` 读取 / 别的 flag /
别的 local 必不判）+ argv 形状（`tools:""` / `model:null` / `maxTurns` 透传）+ `null` 四态 + 与退役表达式的逐输入
一致。负控制已对**真前像**干跑：`git show develop:<两个 routine>` 的源码判 `true`，迁移后判 `false`。
受影响既有测试：cross-project-dogfood 32/32、open-semantic-discovery 132/132、discovery-method 60/60、
gate-script-base 91/91，全绿。

**Dark axis（ADR-007）** —— archguard 全量 analyze（`plugin/scripts` + `packages`）后查询：
- L_D archguard: cycles=0 in_cycles=0 high_coupling_threshold8=84 scripts_files=321

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `requested-model-byte-identical`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1794127147981`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/cross-project-dogfood-routine.ts`
- `plugin/scripts/open-semantic-discovery-routine.ts`
- `plugin/scripts/routine-engine-module-loader.ts`
- `plugin/test/gap-routine-semantic-dedup-scan-requested-model-byte-identical.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-requested-model-byte-identical.md`