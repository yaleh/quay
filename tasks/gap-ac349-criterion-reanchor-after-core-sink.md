---
id: gap-ac349-criterion-reanchor-after-core-sink
title: AC-349 判据重锚：GOAL-032 并入形态检查保留，生产委托改为 develop 上位置无关的委托检查
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-349
---
**type:** execution

## Proposal

AC-349 当前记录为 FALSE（本轮直接重跑判据，不是账本尾巴：`exit 1`，`CAUSE=production-not-delegated-fidelity — develop's criterion-fidelity.ts does not delegate`）。但被测量的保证本身仍然成立——偏掉的是判据里的**路径钉**。

**为什么上一次的修复没能保持**：任务 `gap-goal032-preview-merge-and-postmerge-verify`（done）在提交 `ec0b1a8f7` 把委托落在 `packages/quay/src/criterion-fidelity.ts`，AC-349 于 2026-10-09 判过 pass。之后提交 `35dc5da93`（`refactor(core): sink the gate substrate into src/core to break the ""<->gate directory SCC`）把实现整体下沉到 `packages/quay/src/core/criterion-fidelity.ts`，src 根文件改为纯转发（`export * from "./core/criterion-fidelity.ts";`）。没有机制把「判据钉的路径」与「实现实际所在的路径」对齐检查，于是代码没退化、判据却转红。这是 AC-347 同一个 core 下沉的兄弟实例，但本任务重锚的是 AC-349 自己的 record 与它独有的并入形态检查。

**当前事实（本轮在主检出实测，不是推断）**：

- 并入形态仍然正确：`goal-merge-result` 记录 `landedSha=0da918926afe058fa46358e35f310057ba225ebe`、`tipSha=c0f192a8d0cd2849fe24eeed6c8b4a8ee9fa5cdf`；landed 在 `develop` first-parent 链上、恰好两个父提交、`landed^2 == tip`、`landed^1..tip` 无提交泄漏到 first-parent。
- `packages/quay/src/kernel/verdict-parse.ts:39` — `export function parseBinaryVerdict(...)`。
- `packages/quay/src/core/criterion-fidelity.ts:76-78` — `parseFidelityVerdict` 薄包装，`return parseBinaryVerdict(stdout, exitCode, "faithful", "vacuous");`。
- `plugin/scripts/goal-driver.ts:1205` — `parseSemanticSufficiencyVerdict` 薄包装，`return parseBinaryVerdict(stdout, exitCode, "covered", "insufficient");`。
- `packages/quay/src/criterion-fidelity.ts` — 只剩转发 re-export（文件头明令禁止把实现加回来）。
- 在 `develop` 上 `git grep -l -E '^export function parseFidelityVerdict\(' develop -- packages/quay/src` 恰好命中 1 个文件（`packages/quay/src/core/criterion-fidelity.ts`）。

**所以修法是 re-anchor，不是搬代码，也不是往转发文件里塞关键字**：把「实现落点」改成位置无关的谓词，并把生产读数锚到 `develop` ref（AC 的语义本来就是「develop 上确已委托」），而不是工作树里的某一串路径。

<!-- dedup-ref -->
相关但独立：`gap-ac347-criterion-reanchor-after-core-sink` 重锚的是 AC-347 record 的同类路径钉（不同 goal record、不同验收项）；本任务只重锚 AC-349 的 record，并保留本 AC 独有的并入形态检查，因此不合并。既有 `gap-goal032-preview-merge-and-postmerge-verify` 是 done 状态的前一次修复，不是重复任务。

## Plan

1. 在暂存文件 `.quay/ac349-reanchor-criterion.sh` 写出重锚后的判据（临时文件、不提交；untracked 不进 `git diff`），保持三态契约：0 = pass；1 = fail 且首行带 `CAUSE=`；3 = 未评估。必须包含：
   - a. 并入形态四项**逐字保留**（从 record 原判据复制）：landed 在 `git rev-list --first-parent develop` 中、`git rev-list --parents -n1 "$landed"` 词数 = 3、`landed^2 == tip`、`landed^1..tip` 无提交出现在 first-parent。
   - b. fidelity 委托改成**位置无关 + develop ref**：`fid_defs=$(git grep -l -E '^export function parseFidelityVerdict\(' develop -- packages/quay/src)` 恰好命中 1 个文件；数量 ≠ 1 ⇒ `CAUSE=fidelity-not-thin-wrapper-or-duplicated`（0 = 函数被删；≥2 = 半搬壳/重复实现）；该文件（去掉 `develop:` 前缀后用 `git show develop:<path>` 读）必须含 `parseBinaryVerdict`，否则 `CAUSE=production-not-delegated-fidelity`。
   - c. sufficiency 委托也从 `develop` ref 读：`git show develop:plugin/scripts/goal-driver.ts | grep -q 'parseBinaryVerdict'`，否则 `CAUSE=production-not-delegated-sufficiency`。
   - d. 公共导入面未破：`git show develop:packages/quay/src/criterion-fidelity.ts | grep -q 'export \* from "./core/criterion-fidelity.ts"'`，否则 `CAUSE=fidelity-public-import-surface-broken`。
   - e. 判据内用 `#` 注释写明这是 re-anchor（理由是 core 下沉后的转发结构）；⛔ 不要把已退役的 src 根路径当作理由，也不要通过往转发文件里加 `parseBinaryVerdict` 字样来“修绿”。
2. 新增位置无关的所有权回归测试 `packages/quay/test/verdict-parse-ownership.test.mjs`（首行 `// @test-group product`）：递归扫描 `packages/quay/src` 下的 `.ts`，断言 `export function parseFidelityVerdict(` 的定义恰好 1 处，且该定义文件使用 `parseBinaryVerdict`；断言 `plugin/scripts/goal-driver.ts` 的 `parseSemanticSufficiencyVerdict` 使用 `parseBinaryVerdict`；断言 kernel `packages/quay/src/kernel/verdict-parse.ts` 导出 `parseBinaryVerdict`。⛔ 不要钉具体参数拼写（函数增参不应误红），只钉「是否委托」。
3. 两侧验证（硬规则 2：会通过的量必须同时给出会失败的读数）：
   - **必须通过**：在当前树上原样跑新判据 ⇒ `PASS` / exit 0。
   - **必须能假（负对照 A）**：在 `/tmp` 建一个一次性 git 仓库桩（含 `develop` 分支 + 一个定义了 `parseFidelityVerdict` 但**不**调用 `parseBinaryVerdict` 的实现 + 其余被钉的文件），用同一判据运行 ⇒ exit 1 / `CAUSE=production-not-delegated-fidelity`。
   - **必须能假（负对照 B）**：同一个桩里改为两份 `export function parseFidelityVerdict` 定义 ⇒ exit 1 / `CAUSE=fidelity-not-thin-wrapper-or-duplicated`。
   - 三条退出码与首行输出都贴进 `## Evidence`。
4. 把新判据写入 goal record（AC-349 的正本是 record 本身，不是任务体）：
   `node packages/quay/bin/quay.js goal write AC-349 --criterion "$(cat .quay/ac349-reanchor-criterion.sh)" --expect "<同样 0/1/3 契约，CAUSE 列表有变就同步>" --root /data/home/yale/work/quay`
   确认 `goals/AC-349-*.md` 内含新判据；store 若未自动提交，就随本任务一起提交该 goal 文件。⛔ 不手工改 AC-349 的 status——它由 goal driver 依 gate verdict 翻转。
5. 用 **record 自己的**判据再跑一次（不是跑副本）：`node packages/quay/bin/quay.js goal gate AC-349 --root /data/home/yale/work/quay` ⇒ exit 0 / `pass`。这一条读数才是把账本尾巴翻绿的那条。
6. 自检并落地：`node plugin/scripts/task-schema-check.ts tasks/gap-ac349-criterion-reanchor-after-core-sink.md` exit 0；`node packages/quay/bin/quay.js task check gap-ac349-criterion-reanchor-after-core-sink --json` 的 `missing` 为 `[]`；`node --test packages/quay/test/verdict-parse-ownership.test.mjs` exit 0；随后只提交 goal record、新测试与本任务文件。

## Acceptance Criteria

- [ ] AC1：AC-349 record 内已含重锚后的判据——`node packages/quay/bin/quay.js goal show AC-349 --json --root /data/home/yale/work/quay` 的输出里可见：(i) 四项并入形态检查，(ii) 位置无关的 `export function parseFidelityVerdict` 唯一性扫描（`git grep` against `develop`），(iii) develop ref 上的 goal-driver 委托检查，(iv) src 根转发检查，(v) 新增的 CAUSE 名；命令 exit 0
- [ ] AC2：判据在当前树为真——`node packages/quay/bin/quay.js goal gate AC-349 --root /data/home/yale/work/quay` 报 `pass` / exit 0；把同一判据抽出为脚本单独跑也输出 `PASS` / exit 0（两者都贴）
- [ ] AC3：判据能取假——负对照 A（缺委托）⇒ `CAUSE=production-not-delegated-fidelity` / exit 1；负对照 B（两份定义）⇒ `CAUSE=fidelity-not-thin-wrapper-or-duplicated` / exit 1（贴命令与输出）。⛔ 给不出这两条读数的判据视为空转
- [ ] AC4：所有权回归测试落地且为真——`node --test packages/quay/test/verdict-parse-ownership.test.mjs` exit 0；把同一测试文件复制进一个「只有未委托实现」的一次性桩树（相同的 `packages/quay/src` + `plugin/scripts` 布局）后运行 ⇒ exit ≠ 0，且失败信息点名未委托的文件（贴命令与输出）
- [ ] AC5：未搬代码、未越界——`git diff --name-only develop` 只出现 `goals/AC-349-*.md`、`packages/quay/test/verdict-parse-ownership.test.mjs`、`tasks/gap-ac349-criterion-reanchor-after-core-sink.md`；`packages/quay/src/criterion-fidelity.ts` 仍以 `export * from "./core/criterion-fidelity.ts";` 转发；`packages/quay/src/core/criterion-fidelity.ts` 与 `plugin/scripts/goal-driver.ts` 的委托实现逐字未变
- [ ] AC6：留痕——本任务 `## Evidence` 含 before（`exit 1`、`CAUSE=production-not-delegated-fidelity`）与 after（`exit 0`、`PASS`）读数、两条负对照读数、新测试的正/负读数、以及承载新判据的 commit sha

## Definition of Done

AC-349 的 record 本身携带重锚后的判据；该已记录判据对当前树判 `pass`（exit 0），对「委托被摘掉」的桩判 `CAUSE=production-not-delegated-fidelity`（exit 1），对「两份定义」的桩判 `CAUSE=fidelity-not-thin-wrapper-or-duplicated`（exit 1）；新所有权测试在真实树上绿、在未委托桩上红；委托实现仍在 `packages/quay/src/core/criterion-fidelity.ts` 与 `plugin/scripts/goal-driver.ts`，src 根文件仍是转发 re-export；goal record、新测试与新任务文件的变更已提交。

## Notes

- 本轮立案时实测：原判据 exit 1 / `CAUSE=production-not-delegated-fidelity`；重锚草案在同一棵树 exit 0（草案读数，不算验收）。
- 已核查 `git rev-list --first-parent develop` 含 landed；`landed^2 == tip`；`landed^1..tip` 无 first-parent 泄漏。并入形态本身无需改动。
- 不触碰 routine-quota 四个文件、不回搬实现、不改任何既有测试断言、不改 AC-347 的 record（由 `gap-ac347-criterion-reanchor-after-core-sink` 独立处理）。

## Evidence

（待执行者填写：before/after 退出码、两条负对照、测试正/负读数、commit sha）

## Touches

- goals/AC-349-并入形态-并入后生产核验-goal-032-以恰好一个合并提交进入-develop-两处调用方在-develop-上确已.md
- packages/quay/test/verdict-parse-ownership.test.mjs (new)
- tasks/gap-ac349-criterion-reanchor-after-core-sink.md
