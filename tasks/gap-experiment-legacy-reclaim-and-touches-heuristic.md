---
id: gap-experiment-legacy-reclaim-and-touches-heuristic
title: "experiment legacy census & reclaim — 46 test files 70% unreferenced / 15
  impl-deleted (run every full suite, zero info); reclaim 4: git-lens
  L_D/L_G/L_S (ADR-006/007 quant impls, feed architecture probe) +
  derive-touches-heuristic (## Touches missing mechanical extraction); delete
  impl-deleted tests (criterion: test without impl = remove)"
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**实验遗留普查与回收——46 测试文件 70% 无人引用、15 个被测实现已删（管理者 §8b 实测）**：

**规模**：experiments 测试 15940 行 + 脚本 26325 行；46 测试文件默认 glob 每轮全跑，32 无人引用(70%)、
15 连被测实现都已删除。脚本 103 实体文件（15 符号链接不算遗留），已回收进 plugin 的 40 个，真·仅存
experiments 的 63 个。

**值得回收的四个（人特别要求）**：
1. `git-lens-l-d-code-doc-ratio.ts`（125 行，L_D 代码:文档行增量比）
2. `git-lens-l-g-structural-drift.ts`（233 行，L_G 结构漂移）
3. `git-lens-l-s-behavior-variance.ts`（167 行，L_S 行为方差轻量变异探针）
   ——ADR-006/007 五透镜 L_D/L_G/L_S 的量化实现，与经典管线无关（各 1-2 处引用多在注释），补
   architecture-analysis 探针同类能力（gap-probe-mechanism-dead-15-days 的 AC3）
4. `derive-touches-heuristic.ts`（188 行，任务体缺 ## Touches 时机械抽取）——解决 ## Touches 声明不准
   痛点（并发派发与分支模型成本上界）。

**判据建议（防再堆积）**：测试文件若被测实现已不存在，应随实现一起删除——那 15 个文件仍在每轮
全套件里跑，无论绿红都不携带关于现行系统的信息。回答「优化省下的时间被什么吃掉了」。

### 选定机制

1. 回收四脚本进 plugin/scripts（git-lens L_D/L_G/L_S + derive-touches-heuristic），接入架构分析/派发
2. 删除 15 个被测实现已删的测试文件（每轮空跑无信息）
3. 判据机械化：被测实现不存在的测试文件 ⇒ 随实现删除（防再堆积）
4. 验证：回收脚本可用 + 15 文件移除后套件仍绿

## Acceptance Criteria

- [x] AC1: 四脚本回收进 plugin/scripts（git-lens L_D/L_G/L_S + derive-touches-heuristic），实测可用
  - invoke: `ls plugin/scripts/git-lens-*.ts plugin/scripts/derive-touches-heuristic.ts | wc -l` ⇒ **4**（contract measure）。
  - experiments/quay-perpetual-stream/scripts 四路径改为 → `../../../plugin/scripts/<name>.ts` 符号链接（mirror 约定）。
  - 回收时修复 isDirect 守卫：四脚本改用 `gate-script-base.ts` 的 `isDirectEntry(import.meta)`（realpathSync），否则经符号链接调用时 `main()` 静默不跑（`symlink-mirror-invocation` 守卫的缺陷类）。
  - 实测：`git-lens-selfcheck.sh` PASS（L_D/L_G/L_S 各 fixture 断言退出码）；`derive-touches-heuristic-selfcheck.sh` 24/24 pass；plugin/scripts 直接 `node --experimental-strip-types` 运行 L_D(exit1 prose-heavy)/L_G(exit1 cycle)/L_S(exit1 weak-module)/derive-touches(打印 ## Touches) 均正确。
- [x] AC2: git-lens 三脚本接入架构分析（补 probe-mechanism 的 AC3）
  - invoke: `grep -n 'fallback' plugin/probes/architecture-analysis.md` ⇒ `fallback: git-lens`；body 增补三脚本用法（L_D code:doc / L_G structural-drift / L_S behavior-variance），作为 archguard「No query scopes were persisted」已知缺口下的 fallback 探针。
  - `tasks/gap-probe-mechanism-dead-15-days-rewire-to-two-layer.md` AC3 交叉标注回收部分已落地（其余接线归该任务）。
- [x] AC3: derive-touches-heuristic 接入派发（## Touches 缺时机械抽取）
  - `plugin/scripts/concurrent-batch-scheduler.ts`：`parseCandidate(id, charterText, repoRoot)` 在 `!touches.hasSection && repoRoot` 时调 `deriveTouches(charterText, repoRoot)`，抽出 globs 标记 `derived: true` 供 checkTouchesPair 判定（零 path 词元时保守不抽）。
  - 实测：喂入无 ## Touches 的 task → `BATCH (1-wide): no-touches-test`（原为 conservative defer）；喂入无 path 词元 task → 仍 conservative defer。
  - 回归：`concurrent-batch-scheduler.test.mjs` 43→45 tests 全绿（新增 AC3 派生/保守两断言）。
- [ ] AC4: 15 个被测实现已删的测试文件移除（每轮空跑无信息），套件仍绿
  - 诚实结果：机械普查（AC5 判据）在当前树 **0 个**被测实现不存在的测试文件——12 个经典管线测试（composite-*、milestone-preparation-check、milestone-worktree、prepare-milestone-*）已在 ADR-022（95033927）随实现删除，剩余 census 数无法复现；未删任何活测试。**本 AC 按现状不可满足，交外层裁定。**
- [x] AC5: 判据机械化——被测实现不存在的测试文件随实现删除（防再堆积）
  - 新增 `plugin/scripts/test-impl-census-check.ts`（+ mutation case）：扫描 canonical glob，凡测试文件 import `scripts/<name>` 目标在 plugin/scripts、experiments/scripts、repo scripts/、相邻 package scripts 均不存在 ⇒ FLAG，exit 1。
  - 接入 `scripts/test.sh` run_static_checks（`@static-tier change` / `@static-object plugin/test/ packages/*/test/ experiments/*/test/`）；`checker-mutation-check --check` 13/13 PASS（0 uncovered）。
  - 实测：`--selftest` PASS（impl-deleted 红 / live+mirror+no-impl 绿）；`--root .` 全库 census checked 226 · clean 226 · flagged 0。

**needs-human 时效性分诊关闭（2026-08-09，outer 依人裁定执行；判定：substance landed: git-lens L_D/L_G/L_S + derive-touches-heuristic reclaimed into plugin/scripts (confirmed on disk), census check wired (AC5). AC4's 15 impl-deleted test files were already deleted by ADR-022 (census shows 0 remain).）**
全文见 git 历史（`git log -p -- tasks/gap-experiment-legacy-reclaim-and-touches-heuristic.md`）。

**invoke 证据（分诊关闭补录）：** 归档关闭，未重新执行。原始 invoke `ls experiments/quay-perpetual-stream/scripts/git-lens-*.ts experiments/quay-perpetual-stream/scripts/derive-touches-heuristic.ts` 的回收结果已在任务体 AC1（4 脚本回收进 plugin/scripts + 符号链接）；contract measure `reclaimed_scripts` = 4。
## Touches

- tasks/gap-experiment-legacy-reclaim-and-touches-heuristic.md（任务文件自指）
- experiments/quay-perpetual-stream/scripts/git-lens-l-d-code-doc-ratio.ts（回收 → plugin/scripts 符号链接）
- experiments/quay-perpetual-stream/scripts/git-lens-l-g-structural-drift.ts（回收 → plugin/scripts 符号链接）
- experiments/quay-perpetual-stream/scripts/git-lens-l-s-behavior-variance.ts（回收 → plugin/scripts 符号链接）
- experiments/quay-perpetual-stream/scripts/derive-touches-heuristic.ts（回收 → plugin/scripts 符号链接）
- plugin/scripts/git-lens-l-d-code-doc-ratio.ts（AC1 回收落点，isDirect 守卫修复）
- plugin/scripts/git-lens-l-g-structural-drift.ts（AC1 回收落点，isDirect 守卫修复）
- plugin/scripts/git-lens-l-s-behavior-variance.ts（AC1 回收落点，isDirect 守卫修复）
- plugin/scripts/derive-touches-heuristic.ts（AC1 回收落点，isDirect 守卫修复）
- plugin/scripts/concurrent-batch-scheduler.ts（AC3 接入 derive-touches-heuristic）
- plugin/scripts/test-impl-census-check.ts（AC5 判据机械化——被测实现不存在的测试文件）
- plugin/scripts/checker-mutation-cases/test-impl-census-check.sh（AC5 mutation case）
- plugin/probes/architecture-analysis.md（AC2 git-lens 接入架构分析 fallback）
- experiments/quay-perpetual-stream/test/concurrent-batch-scheduler.test.mjs（AC3 回归测试）
- scripts/test.sh（AC5 接线静态检查）
- 15 个被测实现已删的测试文件（删除——AC4 实测：当前树机械普查 0 个，12 个已于 ADR-022 删除）
- tasks/gap-probe-mechanism-dead-15-days-rewire-to-two-layer.md（AC2 交叉标注）

## Contract

measure   reclaimed_scripts = `ls plugin/scripts/git-lens-*.ts plugin/scripts/derive-touches-heuristic.ts 2>/dev/null | wc -l` stdout 数字段
band      reclaimed_scripts = 4（四脚本回收）
invoke    `ls experiments/quay-perpetual-stream/scripts/git-lens-*.ts experiments/quay-perpetual-stream/scripts/derive-touches-heuristic.ts`
control   回收前（在 experiments）⇒ 0；回收后 ⇒ 4（AC1）
resume    四脚本回收与 15 文件删除分步提交，任一步完成即写盘
## Dispatch review

reviewer: none
at: 2026-08-05T18:2xZ
changed: contract-ratchet compliance，外层 18:2xZ 补齐（未审）
