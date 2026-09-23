---
id: gap-registry-path-second-copy-five-checker-sites
title: runner-static-gate.ts 路径的单一正本（REGISTRY_BASENAME/REGISTRY_REL_CANDIDATES）被
  5 处 checker 各自手抄第二份副本——迁移这 5 处经候选表，保留 kernel-sibling-dev-tree-only 作用域
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**类型**：defect（自查声明的不变量未被任何机制维持）。

**被违反的自述不变量（位置判定）**：`plugin/scripts/select-static-checks-for-touches.ts:57-59` 逐字声明

```
/** The registry's FILE NAME — the ONE path literal in the repo (see REGISTRY_REL_CANDIDATES); every
 *  layout's location is derived from it, so a second copy can never drift from it. */
export const REGISTRY_BASENAME = "runner-static-gate.ts";
```

`:81-83` 的 `REGISTRY_REL_CANDIDATES` 由它派生两个布局。`packages/quay/src/fan-in/ff-merge.ts:757` 同族纪律逐字：「its REGISTRY_REL_CANDIDATES — ⛔ never a second copy of that list here (hard rule 5b)」。

**实测（2026-09-22，`grep -rn '"plugin", "scripts", "runner-static-gate.ts"' plugin/scripts/*.ts packages/quay/src/**/*.ts`，5 处，非测试）**：

```
plugin/scripts/axis-generator.ts:216                const staticGate = readFile(path.join(root, "plugin", "scripts", "runner-static-gate.ts"));
plugin/scripts/precommit-guard.ts:242               const staticGate = path.join(root, "plugin", "scripts", "runner-static-gate.ts");
plugin/scripts/rhythm-consumer-check.ts:286         path.join(root, "plugin", "scripts", "runner-static-gate.ts"),
plugin/scripts/rhythm-consumer-check.ts:388         const testShPath = path.join(root, "plugin", "scripts", "runner-static-gate.ts");
plugin/scripts/verification-marginal-return.ts:839  registry: over.registry ?? path.join(root, "plugin", "scripts", "runner-static-gate.ts"),
```

每处都带 `// kernel-sibling-dev-tree-only: dev-tree-only — repo-local plugin/scripts use, not third-party sibling resolution.`（5/5 实测）。第六个命中 `judgment-consumer-check.ts:133` 是字符串散句里的文件名，**不是路径副本**，不计（硬规则 2：按位置判定）。

**为什么这是缺陷而不是既成约定**：声明的性质是「**the ONE path literal in the repo**」「a second copy can never drift from it」——而盘上有 5 份 second copy。⚠️ 诚实标注：**此刻没有任何一处已经漂移**（5 份字面量与 `REGISTRY_REL_CANDIDATES[0]` 逐字相同，已核对）。缺陷是**声明的强制力为零**：该不变量由散文陈述、无任何检查器维持 ⇒ 改 `REGISTRY_BASENAME`、或改主布局（`plugin/scripts` → 别的）时，这 5 处**静默漂移**，与「一切正常」同形（硬规则 3b/9）。⛔ 不把「将来会漂移」写成已发生的故障。

**为什么现有检查器抓不到（已实测，不是推断）**：跑 `node --no-warnings --experimental-strip-types plugin/scripts/kernel-sibling-resolution-check.ts --root . --json` ⇒ `{"status":"pass","ok":true,"violations":[],"total":0}`，exit 0。原因是**设计性豁免**：该检查器 `:49-51` 逐字规定「其紧邻注释块携带标记 `kernel-sibling-dev-tree-only:`（带理由）即豁免」。⇒ 这 5 处被豁免**不是因为它们对**，而是因为**「dev-tree-only 解析」这一维度不适用**——本任务报的是**正交的另一个维度：路径字面量的份数**。

**为什么立新案而不并进已有任务（三条 adjacency 已逐条排除）**：

- `gap-ac225-kernel-sibling-naive-anchor-migration-zero`（done）：修的是**解析形态**（迁移到 `resolveKernelSibling`/`resolveKernelPluginRoot` 供 shipped 布局解析）。本任务**刻意不迁移到那两个 helper**：那会让这 5 处变成第三方布局感知，**违反**它们自述的 dev-tree-only 作用域。
- `gap-classify-delta-registry-path-layout-aware`（done）：修的是 `select-static-checks-for-touches.ts` 自己的布局感知查找（候选表本体）。本任务不碰候选表语义，只让 5 处消费者**读**它。
- `gap-identity-replication-requires-structural-relation`（done）：修的是**检测器判据**（关键词计数 vs 结构性关系），并逐字规定「修的是检测器的产地，⛔ 不是在聚类侧打补丁」。本任务不是聚类侧补丁，也不改检测器 —— 它修的是**被检出簇所指的那 5 处真实第二副本**。

先行先例（同族修复形态已两次走通）：`gap-repo-root-derivation-bypasses-shared-accessor`（done，24 处绕过 `repoRoot()` 单一访问器）、`gap-ac225`（done，9 处 naive sibling 锚点）——两者都是「散文声明单一正本 + N 处手抄 + 机械枚举归零」。

## Plan

1. 5 处改为读 `select-static-checks-for-touches.ts` 的既有导出，路径按 `path.join(root, REGISTRY_REL_CANDIDATES[0])` 构造（`REGISTRY_REL_CANDIDATES[0]` 逐字等于 `"plugin/scripts/runner-static-gate.ts"` ⇒ **行为逐字不变**）。
2. ⛔ **不得**改用 `resolveRegistryPath()`：那是布局感知（候选 2 = `<root>/scripts/runner-static-gate.ts`，shipped 形态），会把这 5 处从 dev-tree-only 扩成第三方布局感知，**违反其自述作用域**。若要替代，只允许 `REGISTRY_BASENAME` + 显式 `path.join(root, "plugin", "scripts", REGISTRY_BASENAME)`（同样只消掉文件名那一份字面量）。
3. 保留每处的 `kernel-sibling-dev-tree-only:` 注解（作用域未变，注解仍为真）——⛔ 不改注解、不删豁免。
4. **夹具传递闭包检查（已知烧人面，先查再改）**：这 4 个文件里若有被 hermetic 夹具**按硬编码清单** copy 进临时树的，新增 import 会 `ERR_MODULE_NOT_FOUND`。已探明两类：`plugin/test/precommit-guard.test.mjs` 的 `copyGuardScripts` 用**派生**闭包 `guardClosure()`（自动覆盖，注释 `:769` 已明说「source-derived closure ⇒ the new ④ dep is included」）；`plugin/test/driver-cli.test.mjs:39` 的 `KERNEL_DEPS` 是**手写清单**（本任务 4 个文件不在其内，但同形陷阱要按同一手法核）。⇒ 判定手段是**跑全量 suite**，不是推理（`gap-repo-root-derivation-bypasses-shared-accessor` B2 连踩三轮皆因此）。
5. 落地后给出**可重复的零计数谓词**（AC1 的命令），并记录它是否接入某个 gate —— 硬规则 9：可见性 ≠ 执行，若只迁不查，同一份散文会在下一次被重新手抄。
6. 全量 `scripts/test.sh` 绿。

## Acceptance Criteria

- [x] AC1（迁移到位，能取假）：`grep -rn '"plugin", "scripts", "runner-static-gate.ts"' plugin/scripts/*.ts packages/quay/src/**/*.ts` **命中 0 行**（贴命令与输出）。**配套零计数动作（硬规则 2 的另一半）**：把同一谓词对一个**已知为真**的样本干跑一次（例：`git show HEAD:plugin/scripts/axis-generator.ts | grep -c '"plugin", "scripts", "runner-static-gate.ts"'` 应 ≥1），证明谓词确实命中过该形态，而不是恒零。
  **实测（迁移后，worktree `task/gap-registry-path-second-copy-five-checker-sites`）**：`grep -rn '"plugin", "scripts", "runner-static-gate.ts"' plugin/scripts/*.ts packages/quay/src/**/*.ts` ⇒ **0 行**（grep exit 1）；另把扫描面放宽到两个根下的**全部文件类型**（`plugin/scripts` + `packages/quay/src`，含 `.sh`/`.mjs`/`.json`）仍为 0，证明零计数不是「只扫了 .ts」的产物。**零计数配套动作**：`git show HEAD:plugin/scripts/axis-generator.ts | grep -c '"plugin", "scripts", "runner-static-gate.ts"'` ⇒ **1**（谓词对该形态确实命中过 ⇒ 非恒零）；迁移前同一谓词在真仓命中 **5** 处。
- [x] AC2（行为逐字不变，能取假）：4 个 checker 在迁移前后的**退出码与关键输出逐字相同**——逐条贴 before/after：`node --experimental-strip-types plugin/scripts/rhythm-consumer-check.ts --check; echo $?`、`axis-generator.ts` 的 `enumerateStaticCheckers`（经 `plugin/test/axis-generator.test.mjs`）、`precommit-guard.ts` 的 `staticObjectPatterns`（经 `plugin/test/precommit-guard.test.mjs`）、`verification-marginal-return.ts` 的 `loadCarriers`（经 `plugin/test/verification-marginal-return.test.mjs`）。⛔ 任一处输出变化 ⇒ 说明 `REGISTRY_REL_CANDIDATES[0]` 与旧字面量不等价，停下来查。
  **实测（before/after 取自同一 worktree，仅换代码，未换机器/未换盘）**：`rhythm-consumer-check.ts --check` ⇒ before/after 全文 `diff` **空**、两者 exit 0（判据1 228 judged/0 violation、判据2 122/0、判据3 4/0、判据4 57 judged/57 report）。三个测试文件 before ⇒ after：axis-generator **10 pass**→**10 pass**、verification-marginal-return **41**→**41**、rhythm-consumer-check **16**→**16**，fail 均 0、exit 均 0，`diff` 逐字相同。`precommit-guard.test.mjs` **30 pass**→**30 pass**、exit 0，`diff` 逐字相同。**另加一条直接等价性证明**（不是靠输出相同反推）：`path.join(root, REGISTRY_REL_CANDIDATES[0])` 与 `path.join(root, "plugin", "scripts", "runner-static-gate.ts")` 对同一 `root` 求值 ⇒ `IDENTICAL = true`（`REGISTRY_BASENAME = "runner-static-gate.ts"`、`CANDIDATES[0] = "plugin/scripts/runner-static-gate.ts"`）。
- [x] AC3（作用域没被顺手扩大，位置判定）：5 处仍**只**引用 `REGISTRY_REL_CANDIDATES[0]` / `REGISTRY_BASENAME`，**不出现** `resolveRegistryPath` 或对候选表的循环；且 `grep -c 'kernel-sibling-dev-tree-only:' plugin/scripts/axis-generator.ts plugin/scripts/precommit-guard.ts plugin/scripts/rhythm-consumer-check.ts plugin/scripts/verification-marginal-return.ts` **每文件 ≥1**（注解保留）。
  **实测**：`grep -n 'resolveRegistryPath' <这 4 个文件>` ⇒ 无命中（exit 1）；5 处全部形如 `path.join(root, REGISTRY_REL_CANDIDATES[0])`，import 的只有 `REGISTRY_REL_CANDIDATES` 一个符号，⛔ 未使用布局感知的 `resolveRegistryPath()`（第二候选 = shipped 布局，会把 dev-tree-only 扩成第三方布局感知）。注解计数 **每文件与 HEAD 逐字相同**：axis-generator 1→1、precommit-guard 1→1、rhythm-consumer-check 3→3、verification-marginal-return 1→1（rhythm 的另 2 条在 `:267`（capability-catalog.sh）等处，属**迁移前既有**，未增未删）。
- [x] AC4（传递闭包没被打破）：`node --no-warnings --experimental-strip-types plugin/scripts/kernel-sibling-resolution-check.ts --root . --json` 仍 `violations: []`/exit 0（未被本迁移意外推红）；`scripts/test.sh` 全量绿。若发现某夹具用手写清单 copy 这 4 个文件而红，补清单（并说明是哪一个夹具、清单位于哪一行）。
  **实测**：（a）`kernel-sibling-resolution-check.ts --root . --json` ⇒ `violations: []`、`total: 0`、exit 0。（b）**夹具传递闭包这一已知烧人面已实查，且无需补任何清单**：唯一 copy 这 4 个文件的探针是 `plugin/test/precommit-guard.test.mjs` 的 `guardClosure()`（`:340`，**派生**闭包，读源码逐个跟 relative import），实测它**自动吸收**了新 dep —— 复算其闭包得 **11 个文件**，含 `select-static-checks-for-touches.ts` 与 `task-schema.ts`；该文件 30/30 仍绿即其 e2e（真 `git commit` 走 scratch 副本）证明模块解析成功。`driver-cli.test.mjs:39` 的 `KERNEL_DEPS` 手写清单**不含**这 4 个文件，故无影响。（c）**scoped 门**（驱动 fan-in 跑的同一条）：`bash scripts/test.sh --for-task gap-registry-path-second-copy-five-checker-sites --allow-thin` ⇒ **exit 0**（全绿），且 `select-static-checks-for-touches.ts --names` 确认新 checker `registry-path-literal-check` 在本次选中集内。（d）**全量 `scripts/test.sh` 由 worker 链之外的机械 fan-in 执行**（worker 的职责到此为止，不自行跑 suite）——本条后半在 fan-in 阶段判定，红灯则本任务不落地。
- [x] AC5（强制力决策落痕）：贴出 AC1 谓词的**可重复调用形态**（命令 + 预期 0），并明确记录其二选一处置：①接入为 checker —— 则须满足**新检查器四件套义务**（`capability-catalog.sh` 六表 + 登记进 `runner-static-gate.ts` 的 `run_static_checks`（带 `# @static-tier`/`# @static-object`）+ `checker-count` 自增 + `checker-mutation-cases/<name>.sh` 突变用例 + `rhythm-consumer-check.ts --check` exit 0）；②仅记为观察项 —— 则须写明「为何不设机械强制」（硬规则 12：前置不得凭空设立，但**已有 5 次实例**是实测读数，不属凭空）。⛔ 两种都不是「什么都不做」。
  **可重复调用形态（预期 0）**：`node --no-warnings --experimental-strip-types plugin/scripts/registry-path-literal-check.ts --root .` ⇒ `PASS — 0 second copies of the registry path in plugin/scripts or packages/quay/src`，exit 0（`--json` 给同一判定的机器可读形态；等价 grep 形态即 AC1 命令）。
  **处置 = ①（接入为 checker）**，理由是迁移实例**并不修掉本任务的缺陷**：被报的缺陷是「声明的强制力为零」，只迁 5 处则下次照样被手抄（硬规则 9：可见性 ≠ 执行）。且同族两次先例（`repo-root-derivation-check.ts`、`worktree-namespace-literal-check.ts`）都是**在本轮迁移里一并造防复发件**。
  **四件套义务逐条落痕**：⓪ 新增 `plugin/scripts/registry-path-literal-check.ts` —— needle **由 `REGISTRY_REL_CANDIDATES[0]` 派生**（各段 `JSON.stringify` + `escapeRegExp`），故**检查器自身不含那三段序列**、永不把自己算成第二处；读不懂声明（pattern 为 null）⇒ 返回**显式 NOT EVALUATED**、绝不与 PASS 同形（硬规则 3b）；数据/散文里的裸文件名（catalog 键、`find -name` glob）只报 advisory、永不判红（硬规则 2/5b）。① `capability-catalog-declarations.json` 六表齐备（QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING/CONSUMER）；`bash plugin/scripts/capability-catalog.sh --json` ⇒ exit 0，该脚本由 `question: null` 变为已分类。② 登记进 `runner-static-gate.ts` 的 `run_static_checks`，带 `# @static-tier change` + `# @static-object plugin/scripts/ packages/quay/src/ …`。③ `# @checker-count` **66 → 67**（`checker-count-drift-check.ts` 实测 declared 67 = measured 67）。④ `plugin/scripts/checker-mutation-cases/registry-path-literal-check.sh`（baseline GREEN → plugin 根注入 RED → 还原 GREEN → 产品根注入 RED → 还原 GREEN → 两条计数 RED → 还原 GREEN → 负控制（FIX 形态 + 数据提及）不误红；用例自身从**声明**读文件名，⛔ 不复写，跑通 exit 0）。⑤ `rhythm-consumer-check.ts --check` ⇒ exit 0。另加 `plugin/test/registry-path-literal-check.test.mjs` 双控（真仓 GREEN + 三条 RED + 一条负控制，7/7 pass）。
  **附一条本轮由本 checker 的兄弟检查器抓到的真实回归**（记录以证门有效）：新文件里 `const ADVISORY_PRINT_CAP = 8;` 被 `concurrency-literal-check` 判红——`*_CAP*` 是本仓「并发值」的**结构信号**。该常量实为显示上限而非并发值，故按**改名**（`ADVISORY_PRINT_LIMIT`）修，⛔ 不补 `concurrency-default-fallback` 例外（那是给**确实是并发默认值**用的；对一个从来不是并发值的量声明例外，正是在这种棘轮里造假）。

## Definition of Done

AC1–AC5 全绿：5 处第二副本归零（机械谓词命中 0 且已用已知真样本证明谓词非恒零）；4 个 checker 行为逐字不变；dev-tree-only 作用域与注解保留、未被顺手扩成第三方布局感知；传递闭包未破（kernel-sibling 检查器仍 exit 0 + 全量 suite 绿）；强制力处置（接入或观察项）已落痕。⛔ 本任务**不改检测器**（`identity-replication-check.ts` / `architecture-review-cluster.ts`）——判据产地属 `gap-identity-replication-requires-structural-relation`（已 done）；本任务只关被检出的那 5 处真实第二副本。

## Touches

- `plugin/scripts/axis-generator.ts`
- `plugin/scripts/precommit-guard.ts`
- `plugin/scripts/rhythm-consumer-check.ts`
- `plugin/scripts/verification-marginal-return.ts`
- `plugin/scripts/select-static-checks-for-touches.ts`
- `plugin/scripts/registry-path-literal-check.ts`
- `plugin/scripts/checker-mutation-cases/registry-path-literal-check.sh`
- `plugin/scripts/runner-static-gate.ts`
- `plugin/scripts/capability-catalog-declarations.json`
- `plugin/test/axis-generator.test.mjs`
- `plugin/test/precommit-guard.test.mjs`
- `plugin/test/rhythm-consumer-check.test.mjs`
- `plugin/test/verification-marginal-return.test.mjs`
- `plugin/test/registry-path-literal-check.test.mjs`
- `tasks/gap-registry-path-second-copy-five-checker-sites.md`
