---
id: gap-goal032-selfhost-and-archguard-evidence
title: GOAL-032 ②：分支自举模块身份证明 + ArchGuard before/after 证据（duplicate group /
  canonical count / consumer convergence）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal032-verdict-parser-kernel-extraction
goal_ac: AC-348
---
**type:** execution

## Proposal

GOAL-032 的第二块：在任务①落地之后，在本 goal 的分支/worktree 上产出 AC-348 所需的证据。本次改动是纯函数重构（无新 driver/事件载体），因此**不复用 GOAL-030 的驱动进程沙盒级自举探针**（规模不匹配，GOAL-030 自己的 body 已写明"分支自举身份证明的规模应对应该 goal 的实际风险"）——改用规模相应缩小的**模块解析身份**核验：证明回归测试实际加载的是本分支 worktree 内的文件，不是主检出的旧副本。

## Plan

1. **模块解析身份证据**（`.quay/goal-032-evidence/selfhost-identity.json`）：在本任务的 worktree 内，写一小段探针——用 `import.meta.resolve` 或等价手段解析 `kernel/verdict-parse.ts`/`criterion-fidelity.ts`/`goal-driver.ts` 三者的 realpath，与当前 worktree 根目录比较，落盘 `{resolved: {...三个 realpath...}, worktreeRoot: <realpath>, allMatch: <boolean>}`。三者 realpath 都必须含子串 `goal-GOAL-032`（worktree 目录命名约定）。
2. **ArchGuard before/after 证据**（`.quay/goal-032-evidence/archguard-before-after.json`）：
   - before：对 `develop` 当前检出跑 ArchGuard `detect_duplicates`（确认该组仍命中，`duplicateGroupPresent: true`）+ `get_dependencies`/`get_package_metrics`（`criterion-fidelity.ts`/`goal-driver.ts` 各自 canonical 定义站点数 = 2，互不调用，`canonicalDefinitionCount` 此处指"两份独立实现"的计数口径，before 应为 2）。
   - after：对本 worktree（已含任务①的改动）跑同一组查询——`duplicateGroupPresent: false`（原重复组消失）、`canonicalDefinitionCount: 1`（kernel 一份实现）。
   - `consumerConvergenceEvidence`：至少两条，分别是 `criterion-fidelity.ts` 与 `goal-driver.ts` 调用 `parseBinaryVerdict` 的真实文本片段（grep 结果，不是推断）。
   - 落盘为 `{before: {...}, after: {...}, consumerConvergenceEvidence: [...]}`。
3. **import-graph-check 棘轮**：跑 `node --experimental-strip-types plugin/scripts/import-graph-check.ts --json`，确认 `verdict.ok === true`（AC-347 已有的护栏在这里再核一遍，发现新回归就早发现）。
4. **语义层记录（facts / declared rules / judgment 三层分离，⛔ 不合并成一张表）**：在本任务的 Evidence 里分别记录——facts（ArchGuard 原始读数）、declared rules（kernel 边界检查器 `import-graph-check.ts` 的 pass/fail，非语义判断）、judgment（本任务对"这是否真收敛、不是搬壳"的结论陈述，引用任务①的负对照证据）。不要求跑 `archguard:arch-layer-review` skill（本次改动规模小，三层记录可由任务体直接承载，不强制走该 skill——若实现者判断跑一次更有说服力，可选择性跑，不作为 AC 硬性要求）。

## Acceptance Criteria

- [ ] `.quay/goal-032-evidence/selfhost-identity.json` 存在，`allMatch === true` 且三个 realpath 均含子串 `goal-GOAL-032`
- [ ] `.quay/goal-032-evidence/archguard-before-after.json` 存在，`before.duplicateGroupPresent === true`、`after.duplicateGroupPresent === false`、`after.canonicalDefinitionCount === 1`、`consumerConvergenceEvidence` 长度 ≥2
- [ ] `node --experimental-strip-types plugin/scripts/import-graph-check.ts --json` 的 `verdict.ok === true`
- [ ] facts/declaredRules/judgment 三层分离记录已写入本任务 `## Evidence`，三者不合并成一张表
- [ ] 以上证据文件均已 `git add` 纳入本任务的提交（`.quay/` 若被 gitignore，改落盘到会被提交的路径，并同步更新 AC-348 criterion 里的路径引用——参照 GOAL-031 ②的先例处理方式）

## Definition of Done

两份证据文件落地且内容达标——`selfhost-identity.json` 的 `allMatch === true`、`archguard-before-after.json` 的 before/after 口径与 `consumerConvergenceEvidence` 均符合本任务 AC 的判定，AC-348 的判据能读到这些文件并判定为真。

## Touches

- .quay/goal-032-evidence/selfhost-identity.json (new)
- .quay/goal-032-evidence/archguard-before-after.json (new)
- plugin/scripts/goal032-selfhost-probe.mjs (new)
- tasks/gap-goal032-selfhost-and-archguard-evidence.md
