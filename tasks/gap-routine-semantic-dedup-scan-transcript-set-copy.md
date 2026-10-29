---
id: gap-routine-semantic-dedup-scan-transcript-set-copy
title: "semantic-dedup-scan: Same transcript-path collector at Jaccard 1.0 (202
  vs 206 chars); the .mjs copy is import-free by design (documented carve-out)
  so the correct action is a plug"
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
Same transcript-path collector at Jaccard 1.0 (202 vs 206 chars); the .mjs copy is import-free by design (documented carve-out) so the correct action is a plugin/.mjs sibling, not a package import.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1793251416079` · ts `2026-10-29T05:23:36.079Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`transcriptSet`
- 涉及文件：
- `plugin/scripts/inner-forensics.mjs:62`
- `plugin/scripts/manager-observation-runtime-check.ts:301`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-29T05:23:36.079Z

## 处置（2026-10-29，修掉；不是「已注意到」）
按 finding 自己给出的方向做 **`plugin/scripts` 下的 `.mjs` sibling**（⛔ 不是 package import：两个消费者都要能
`node <file>` 单独跑并随插件包发布，故新模块只 import `node:` 内建）：

- 新增 `plugin/scripts/transcript-set.mjs` —— **唯一实现**（导出 `transcriptSet(file)`）。
- `plugin/scripts/inner-forensics.mjs` / `plugin/scripts/manager-observation-runtime-check.ts` 各自删掉本地 body，
  改为 `import { transcriptSet } from "./transcript-set.mjs"`。
- `plugin/scripts/capability-catalog-declarations.json` 声明新模块（QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING）。
- `packages/quay/src/init.ts` 的显式铺设清单加 `transcript-set.mjs` —— 它是 `inner-forensics.mjs` 的 ESM `./`
  传递依赖，`${SCRIPT_DIR}/` closure 看不见；不加的话目标项目会只铺到消费者、import 直接断。
- 新增 `plugin/test/transcript-set-single-implementation.test.mjs` —— finding 缺的那个产物：按代码位置判定
  （`codeOnlyText`）「全仓只有一个 `function transcriptSet(`」，加行为 fixture 与两组负控制。

实跑读数（本轮在本 worktree 上取得）：
- 修前（`git show develop:` 的两个 blob，`codeOnlyText` + `/function\s+transcriptSet\s*\(/`）：`inner-forensics.mjs`=true、
  `manager-observation-runtime-check.ts`=true ⇒ 两份都在（谓词对真样本命中，不是回声）。
- 修后 `node --test plugin/test/transcript-set-single-implementation.test.mjs` ⇒ **4/4 pass**（定义者集合恰为
  `["plugin/scripts/transcript-set.mjs"]`）。
- 消费者回归 `node --test plugin/test/inner-forensics.test.mjs plugin/test/manager-observation-runtime-check.test.mjs`
  ⇒ **36/36 pass**。
- `bash plugin/scripts/capability-catalog.sh --summary` ⇒ `405 scripts | 405 declared | 0 unclassified | 400 ship`，exit 0。
- `deriveLoopScripts` 实际派生 ⇒ 124 → **125**，`transcript-set.mjs` in set = true（铺设集闭合）。
- `identity-replication-check.ts --json` ⇒ `judgmentRewrites` 仍是**修前既有**的那 1 条（`full-suite-runner.ts:2994`），
  新模块没有引入新的可合并重复（carve-out 15 条，`inner-forensics` 不在任何列表里 —— 它本来就没有 proc-identity 重写）。

## ADR-007 暗轴
- 该轴仍暗,理由:本次是 plugin/scripts 内的一次同层函数抽取（两份 body 合为一份 .mjs sibling），未改 packages/ 的模块依赖结构，也未跑 archguard 的 L_D/L_G 读数。

## 套件红根因与处置（2026-10-29 第二轮，本 worktree 实跑 A/B）

上一轮的 suite 红**不是**本 delta 的代码缺陷：5 个红里没有一个是本任务改过的文件，全部落在
`packages/quay/plugin/` 这个 **gitignored 的 npm-pack 暂存镜像**上。

根因（可复现，不是「环境」）：
- `packages/quay/test/delivery-standalone-smoke.sh:51-56` 把整棵 `plugin/` 拷进 `$ROOT/packages/quay/plugin/`、
  跑 `npm pack`、再 `rm -rf` 掉。该 gate 按设计留在默认 `@test-group product` 泳道
  （2026-08-25 `gap-suite-move-27-evidenced-files-out-serial-lowconc`、22-60× 高压验证后从 serial 退回 product）。
- 于是「先 walk 列路径、再 readFileSync」的读者会读到**中途消失**的文件 ⇒ 未捕获 ENOENT ⇒ 红。
  仓库已为该竞态修过两处读者（`dead-code-after-return-check.test.mjs` 记过实测 186 次 ENOENT 全在
  `packages/quay/plugin/`；`adr016-screen-use-check.test.mjs` 有同款负控制），本条只是**同一族的另外三个读者**
  没跟上（硬规则 5b）。
- 本任务新增了一个测试文件 ⇒ 改变了确定性分批 ⇒ 把 stager 与这三个 walker 分进同一批 ⇒ 必红。

处置（窄口径，⛔ 不是放宽判据）：三处读者改成「**只在镜像前缀下**容忍 list→read 竞态，并**打印被跳过的路径**」；
镜像以外的 ENOENT 仍然硬失败（硬规则 3b：未评估既 ≠ 违规，也 ≠ 通过）。

A/B（同一批 4 文件、`--test-concurrency=4`，含 stager）：
- 修前 ⇒ exit 1，`ℹ pass 18 / fail 1`，`ENOENT ... packages/quay/plugin/.claude/launch.settings.json`
- 修后 ⇒ exit 0，`ℹ pass 19 / fail 0`，并打印
  `# staging-mirror walk→read race: skipped 677 packed path(s) under plugin/ — NOT judged`
- 单文件回归：`kernel-canonical-buckets` 4/4、`kernel-regex-escape` 6/6、`shipped-entry-runnable` 2/2。

未处置（**不属本任务**，留痕不修）：
- `plugin/test/integration-batch-merge-characterization.test.mjs` 的 `not-a-git-repo` 在 develop 基线与本分支
  **两边都红** ⇒ 既有红，不是本任务引入。
- `plugin/test/driver-runtime-control-plane.test.mjs` AC3 是 `port: 0` 分到的端口落进 undici 的 bad-port 名单
  （`[TypeError: fetch failed] [cause]: bad port`），宿主相关偶发，与本 delta 无关。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `transcript-set-copy`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1793251416079`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/transcript-set.mjs`
- `plugin/scripts/inner-forensics.mjs`
- `plugin/scripts/manager-observation-runtime-check.ts`
- `plugin/scripts/capability-catalog-declarations.json`
- `plugin/test/transcript-set-single-implementation.test.mjs`
- `packages/quay/src/init.ts`
- `packages/quay/test/kernel-canonical-buckets.test.mjs`
- `packages/quay/test/kernel-regex-escape.test.mjs`
- `plugin/test/shipped-entry-runnable.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-transcript-set-copy.md`
