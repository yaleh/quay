---
id: gap-routine-semantic-dedup-scan-git-showfile-headexists
title: "semantic-dedup-scan: Both bodies byte-identical modulo line wrapping and
  a comment saying it mirrors the other file."
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
Both bodies byte-identical modulo line wrapping and a comment saying it mirrors the other file.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792847536579` · ts `2026-10-24T13:12:16.579Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`gitShowFile`、`gitHeadExists`
- 涉及文件：
- `plugin/scripts/test-framework-policy-check.ts:302`
- `plugin/scripts/test-framework-policy-check.ts:313`
- `plugin/scripts/test-isolation-check.ts:1012`
- `plugin/scripts/test-isolation-check.ts:1021`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-24T13:12:16.579Z

## Disposition
**已修掉（real duplication → extract）。** 两个函数体逐字相同（仅换行与那句「mirrors the other file」的注释不同），
现从既有的共享 git 模块 `plugin/scripts/git-runner.ts` 取用——不是新造第二个库：

- `headExists(root): boolean | null` —— 三态（`true` = HEAD 可解析；`false` = git 答「没有」；`null` = git 无法作答，
  即进程没跑起来）。⛔ 库不替调用方折叠（硬规则 3b）；两个调用点各自把**两个非 true 态**折叠成既有的 fail-closed
  `exit 2`（「请传 `--baseline-file`」），对两者都是保守方向，行为与改前一致。
- `showFile(root, ref, rel): string | null` —— `git show <ref>:<rel>`。
- `test-framework-policy-check.ts` / `test-isolation-check.ts`：删除本地两份实现，改为 `import { headExists, showFile } from "./git-runner.ts"`；
  后者因 `execFileSync` 再无真实调用点而一并删除该 import（其余命中全是正则/夹具字符串字面量）。
- `plugin/test/git-runner.test.mjs`：新增 6 条状态测试（`headExists` 的 repo / 非 repo / **git 不存在 ⇒ null**；
  `showFile` 的 present / absent / 坏 ref）+ 3 条回归钉（按**位置**经 `buildNonCodeMask` 判定：任一载体重新声明
  `rev-parse` 探针或丢掉共享 import 即红）。

**同一载体的其余适用点（硬规则 5b，在 `plugin/scripts/` 内按位置 grep `execFileSync("git"` 得 27 个文件）**：
改后这两个载体不再自带 HEAD 探针。剩余 git 包装器**契约不同、并非本 finding 的字节同一体**，前 3 条：
`checked-in-write-check.ts:199` `runGit → {ok,out}`、`crystallization-half-life.ts:229` `runGit → string|null`、
`landing-target-check.ts:106` `gitOut → throws`（另有 `fan-in-materialize-check.ts:204` 的局部 `show` 闭包）。
它们属于**另一条 finding** `git-gitout`（同 runId，`divergent-implementation`）：合并它们等于在四个不同 stdout 契约里选一个，
那是语义决策，不是本次逐字提取的范围；`tasks/` 中目前尚无该 finding 的任务。

**实跑证据（均在任务 worktree 内）**：
- `test-framework-policy-check.ts --selftest` → `22 passed, 0 failed`
- `test-isolation-check.ts --selftest` → `58 passed, 0 failed`
- 两个检查器真实模式（非 selftest）→ PASS（33 exemptions / 21 baselined violations，均未增长）
- `plugin/test/git-runner.test.mjs` → `17 passed, 0 failed`
- 非 git 目录实测：`headExists=false`、`showFile=null`；仓库内：`headExists=true`、`showFile` 取到 blob
- L_D（`import-graph-check.ts`，改后）：`valueSccs=0 typeSccs=0 reverseEdges=0` —— 新增的两条 import 边未引入环

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `git-showfile-headexists`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792847536579`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## ADR-007 暗轴记录
- L_D: valueSccs=0 typeSccs=0 reverseEdges=0
  （`plugin/scripts/import-graph-check.ts` 在任务 worktree 内、改动之后实跑；两条新增 import 边 = 两个检查器 → git-runner）

L_G 未在本轮重测：本次只是把两个函数体搬进既有共享模块（该模块此前已被 4 个脚本依赖），不改变包边界或抽象归属，
故不给该轴的编造读数。

## Touches
- `plugin/scripts/test-framework-policy-check.ts`
- `plugin/scripts/test-isolation-check.ts`
- `plugin/scripts/git-runner.ts`
- `plugin/test/git-runner.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-git-showfile-headexists.md`

## Blocker

**2026-10-24T13:46:00.755Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: AssertionError [ERR_ASSERTION]: at least one bin is under-sampled (otherwise the rule is vacuous) [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=experiments/quay-perpetual-stream/test/symlink-mirror-invocation.test.mjs changed=-]
- run_id：wk-prod-anchor
- session_id：30f158b5-2394-49a3-99b9-49269069e746
