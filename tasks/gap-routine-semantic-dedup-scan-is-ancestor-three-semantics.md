---
id: gap-routine-semantic-dedup-scan-is-ancestor-three-semantics
title: "semantic-dedup-scan: The same git ancestry question returns three
  different value sets in Core (tri-state true/false/null vs
  fold-all-errors-to-false fail-open vs 10s-timeout false"
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
The same git ancestry question returns three different value sets in Core (tri-state true/false/null vs fold-all-errors-to-false fail-open vs 10s-timeout false), while plugin/scripts already consolidated onto the tri-state `ancestry`.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1793162251891` · ts `2026-10-28T04:37:31.891Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`isAncestor`、`ancestry`
- 涉及文件：
- `packages/quay/src/core/branch-model.ts:205`
- `packages/quay/src/goal-merge.ts:77`
- `packages/quay/src/observation.ts:556`
- `plugin/scripts/git-runner.ts:109`
- kind：`divergent-implementation`
- verdict：`divergent-implementation`

## Requested action
merge

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-28T04:37:31.891Z

## 处置（本任务实际执行）
finding 复核成立：`.quay/routine-findings.jsonl` 确有该记录（`findingId":"is-ancestor-three-semantics"`，
`verdict":"divergent-implementation`），三个 Core 调用点确实是三套值域，plugin 侧已是三态。
处置 = **修掉**（同一个谓词收到一个叶子，三个调用点各自把自己那套折叠**写下来**），不是「已注意到」：

- 新叶子 `packages/quay/src/core/ancestry.ts`（零项目依赖，只用 `node:child_process`；**为什么在 `core/` 而不在 src 根见下方「目录环」**）：
  `ancestry(root, ancestor, descendant, { timeoutMs? }) -> boolean | null`；
  `true` = git 答「是」，`false` = 答「否」（exit 1，一个**实测的否定**），
  `null` = 问不到（对象不存在 / 不是仓库 / 进程没起来 / 超时被杀）。折叠⛔不下沉到叶子（硬规则 3b）。
- `packages/quay/src/core/branch-model.ts`：删掉本地 `merge-base` 调用，改为委托；20s 预算保留，`null` 本来就透传。
- `packages/quay/src/goal-merge.ts`：改为委托；`null ⇒ false`（fail-open，保 `already-merged` 语义）在调用点写明理由
  —— 调用方先查分支存在性（`branch-missing`），所以「问不到」只可能是真错误。
- `packages/quay/src/observation.ts`：改为委托；`null ⇒ false` 在调用点写明理由 —— 保守方向是**退回全量重建**
  （代价多一次历史遍历，而假阳会永久供应半张 map）；10s 预算保留。
- `plugin/scripts/git-runner.ts`：**代码未改**，只在 `ancestry` 文档注释里加**一段**交叉引用（写明它指向的 Core 叶子
  是 `packages/quay/src/core/ancestry.ts`）。两层镜像是有意的（`plugin/scripts` 不 import `packages/quay` 模块图），
  本任务已复核，⛔ 下一轮 dedup 不应再按 divergent-implementation 立案。
- 护栏 `packages/quay/test/ancestry.test.mjs`：§1-§5 钉**值域**（true / false / null / 不抛 / timeout 转发），
  §6-§8 是 ratchet（叶子保留 null 臂 · 三个载体按**位置**已不再声明该调用 · 每个载体都必须 import 叶子）。

### 目录环（上一轮 fan-in suite 打红 → 本轮修掉）
叶子最初落在 `packages/quay/src/ancestry.ts`（src **根**）。于是 `core/branch-model.ts` 出现 `../ancestry.ts`
—— 全树**唯一**的 `core -> .` 边；而 `. -> core` 本就存在，这一条边就闭上了
`packages/quay/test/directory-cycle.test.mjs`（AC-916）守护的 7 目录 SCC
`{".", core, gate, gate/config, gate/factories, gate/shared, observation}`。
（机械 relatedness 提示把该测试判为 UNRELATED —— 那是按「测试文件的直接 import 是否与本任务 delta 相交」算的，
而环是**目录级**的，所以提示漏掉了它；实测复现后按真 finding 处理。）

修法 = 叶子改落 `core/ancestry.ts`，**不改任何调用点的折叠语义**：
- `core/branch-model.ts` → `./ancestry.ts`（同目录 ⇒ 不产生边）
- `goal-merge.ts` / `observation.ts` → `./core/ancestry.ts`（即既有的 `. -> core` 边）

⇒ **与本任务分支相比，去重后的目录对集合与 develop 完全相同：新增 0 对，`core -> .` 消失。**
⛔ 不要再把该叶子移回 src 根 —— 会把环重新闭上（守卫会正确打红）。

实跑读数（本任务 worktree，Node strip-types）：
- `node --test packages/quay/test/ancestry.test.mjs` → tests 8 / pass 8 / fail 0。
- `node --test packages/quay/test/directory-cycle.test.mjs` → 5 pass / 0 fail；arm 1 读数 edges 312 / dirs 18 / sccs **0**。
- 负控制（硬规则 2 的零计数半边）：同一个按位置判定器跑 **develop 上的旧文件** →
  `codeOnlyText(...).indexOf("merge-base")` = 29366（observation.ts）/ 4495（goal-merge.ts）/ 11036（branch-model.ts），
  三者均 ≠ -1 ⇒ 它会打红；本分支修复后三者均为 **-1**。
- 既有消费者：`branch-model.test.mjs` + `goal-merge.test.mjs` → 77 pass / 0 fail；`observation.test.mjs` → 63 pass / 0 fail；
  `serve-task.test.mjs` → 12 pass / 0 fail；`plugin/test/git-runner.test.mjs` → 17 pass / 0 fail。
- `for d in packages/*/; do npx tsc --noEmit -p "$d" || exit 1; done`（本工作区 ts-typecheck gate 的命令）→ 全绿。
- `scripts/test.sh --for-task gap-routine-semantic-dedup-scan-is-ancestor-three-semantics --allow-thin` → exit 0。

## ADR-007 暗轴
该轴仍暗,理由:本次是把 Core 内同一个 git 谓词的三份实现收敛到一个零出边叶子（只 import node:child_process），未新增/删除任何模块间依赖边（去重目录对集合与 develop 逐对相同，已在「目录环」一节给出读数），没有 archguard 的 L_D/L_G 读数可作真实测量。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `is-ancestor-three-semantics`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1793162251891`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay/src/core/ancestry.ts` (new)
- `packages/quay/test/ancestry.test.mjs` (new)
- `packages/quay/src/core/branch-model.ts`
- `packages/quay/src/goal-merge.ts`
- `packages/quay/src/observation.ts`
- `plugin/scripts/git-runner.ts`
- `packages/quay/test/branch-model.test.mjs`
- `packages/quay/test/goal-merge.test.mjs`
- `packages/quay/test/observation.test.mjs`
- `packages/quay/test/serve-task.test.mjs`
- `plugin/test/git-runner.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-is-ancestor-three-semantics.md`

## Blocker

**2026-10-28T05:20:30.315Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: AssertionError [ERR_ASSERTION]: directory cycle(s) under packages/quay/src: [[".","core","gate","gate/config","gate/factories","gate/shared","observation"]] [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=packages/quay/test/directory-cycle.test.mjs changed=-]
- run_id：wk-prod-anchor

**已解除（2026-10-28，本轮）**：根因是叶子落在 src 根引入 `core -> .` 边，已按「目录环」一节改落 `core/ancestry.ts`；
`directory-cycle.test.mjs` 5/5 绿，目录对集合与 develop 相同。上方记录保留为事故档案。
