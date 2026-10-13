---
id: gap-guard-lineage-runtime-carrier-not-evaluated
title: "守卫谱系把 gitignored 运行时载体的快照缺席读成「对象已删」：file: 声明须有 runtime: 类并报
  NOT-EVALUATED（P4-missing-guard-object 假阳性）"
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**来源**：architecture-review 的机械聚类把一条结论判为 actionable
（`cluster P4-missing-guard-object [P4] verdict=uncertain (round 0)`）：`guard-lineage-check.ts --json` 的
`declared[]` 里有 2 条 `present:false` / note「object MISSING」，`architecture-review-cluster.ts` 的
`clusterLineageReport()` 随即按 `d.present === false` 聚成
「2 declared guard object(s) no longer present (file:<path> missing)」。judge 复核判定：**这不是删除债**——
两条对象都是 gitignored 运行时遥测，只存在于活的检出、任何 export/snapshot 里都不存在。

**缺陷链（一个机制，三处串起来）**：

1. `plugin/scripts/guard-lineage-check.ts` 的 `classifyDeclaration()`（:90-95）只认两种前缀：`file:` 与
   「无前缀 = invariant」；`checkObjectPresent()`（:134-149）对 `kind === "file"` 就是一句
   `fs.existsSync(path.join(root, dec.filePath))` ⇒ `present: exists`。
2. `plugin/scripts/capability-catalog-declarations.json` 的 `GUARD_OBJECT` 表把两条 tick-log 守卫声明成
   `file:` 对象：
   - `manager-tick-log-check.sh → file:orchestration/manager-tick-log.md`
   - `outer-tick-log-check.sh  → file:orchestration/tick-log.md`

   两者都被 `.gitignore` 忽略（`.gitignore:542` / `:549`），活检出里存在（5.2MB / 2.1MB），
   而 **任何 export / 快照 / 新 `git worktree` / clone 里必然不存在**（被 ignore 的文件不进 checkout）。
3. `plugin/scripts/architecture-review-cluster.ts` 的 `clusterLineageReport()`（:210）消费
   `declared[].present === false` ⇒ 在快照根上产出假阳性簇 `P4-missing-guard-object`。

**为什么属于「读不懂 ⇒ 伪装成一次真实检查结果」家族（硬规则 3b）**：`fs.existsSync` 对
「对象真的被删了」与「该对象是 gitignored 运行时载体、本根结构上就不该有它」返回**同一个 `false`**，
下游无法区分 ⇒ 一次从未发生的删除被报成已发生的删除。根因是 `checkObjectPresent` 的输出词表里
**没有「未评估」这一态**。

**本次要做的（检测器 + 声明约定侧，⛔ 不碰两个 checker 本体）**：

- 给「gitignored 运行时载体」一个**独立取值**：声明前缀新增一类（例如 `runtime:<path>`），
  `classifyDeclaration()` 认它，`checkObjectPresent()` 对它返回 NOT-EVALUATED
  （`present` **非** `false`；`kind` 与 `"file"`/`"invariant"` 可区分；note 说明「运行时载体，快照存在性不可判」）。
- 把上列 2 条 `GUARD_OBJECT` 声明改成该新形态（它们的对象本就是 `.gitignore` 里的运行时遥测）。
- `clusterLineageReport()` **显式**不把 runtime 载体当作「缺失对象」——⛔ 不是靠「`present:null` 恰好
  不等于 `false`」这种隐式巧合；`LineageReportView.declared[]` 的视图类型要能看见那个 kind。
- 新前缀写进 `guard-lineage-check.ts` 头部的声明约定注释，让下一个声明者知道该用哪个前缀。
- 连带（硬规则 5b）：`plugin/scripts/checker-mutation-cases/manager-tick-log-check.sh:5` 的头部注释逐字引用了
  旧声明形态，声明形态一变它就是同一条漂移的兄弟实例，一并更新。

**⛔ 两条硬边界**：

- **不得合并两个 checker**。`manager-tick-log-check.sh` 与 `outer-tick-log-check.sh` 是两个独立守卫
  （judge 明确裁定 do NOT merge the two distinct checkers）——本任务只改**声明分类 + 检测器读数 + 聚类**，
  两个脚本文件保持存在、各自保留自己的 `GUARD_OBJECT` 条目。
- **不得一刀切**。修法不能把「任何 file 对象缺失」都变成 NOT-EVALUATED ——那会把真正的删除藏起来
  （硬规则 3b 的镜像失败）。真正的 `file:` 对象缺失必须**仍然**报 `present:false` / MISSING，簇必须**仍然**产出。

<!-- dedup-ref -->
相关但不同机制（各自独立验收，无依赖关系）：[[gap-archguard-p4-guard-lineage-declaration-and-registry]]（done）
落地了本检测器与首批声明，其 DoD 自己就写着那两条 file 对象「只存在于主检出」——但它没有给这种载体一个可区分的取值；
[[gap-architecture-review-detectors-not-runnable-off-quay-repo]]（ready）修的是**可部署性**（检测器在出厂安装形态下
根本跑不起来：raw-.ts 解析 / 未随包发布 / 目标仓必须有 `plugin/scripts`），与本条的**语义分类**是两件事，
只是恰好都要动 `guard-lineage-check.ts`，由调度器按 Touches 串行即可。

## AC

- [x] AC1（复现·现状读数，生产载体）：在一个**必然不含那两个 gitignored 载体**的根上（新 `git worktree add`
      本仓，或等价 export；被 ignore ⇒ 不进 checkout），跑现状检测器
      `node --experimental-strip-types <main>/plugin/scripts/guard-lineage-check.ts --root <该根> --json`，
      贴出 `declared[]` 里那两条 `"present": false` / `"note": "object MISSING"` 的逐字行；并贴出把该 `--json`
      喂给 `clusterLineageReport()` 得到的 `P4-missing-guard-object` 簇（`files` / `rawCount` / `label`）。
      【⛔ 这一条要在动手改之前取读数；若已改，用基线 commit 或临时 `--catalog` 缝复现之】
- [x] AC2（修后·生产读数，NOT-EVALUATED 与 MISSING 取值可区分）：在**同一个**无载体根上，修后重跑同一条命令，
      `declared[]` 里那两条对象的取值**不再是 `present:false`**：`kind` 与 `"file"`/`"invariant"` 可区分，
      note 说明是运行时载体、快照存在性不可判（⛔ 不是 "object MISSING"）。贴出两行逐字。
- [x] AC3（负控制·修法不得一刀切）：一个**真正缺失**的 `file:` 声明对象仍报 `present:false` / MISSING，
      且簇仍产出 `P4-missing-guard-object`。用一个真实 `file:` 声明指向一个不存在路径来造这个样本
      （临时 `--catalog` 文件，或测试里的裸 fixture 根）。贴出两条输出（检测器行 + 簇），与 AC2 形成对照。
      【硬规则 2 两半：非零查「命中的是不是我要的」，零查「谓词对真样本命不命中」】
- [x] AC4（聚类回归钉住双向）：`plugin/test/architecture-review-cluster.test.mjs` 新增/更新用例，同时钉住
      ①runtime 载体 ⇒ **不**产出 `P4-missing-guard-object`；②真缺 `file:` 对象 ⇒ **仍**产出该簇。
      `node --experimental-strip-types plugin/test/architecture-review-cluster.test.mjs` exit 0，贴出运行输出。
- [x] AC5（声明约定 + 不合并两个 checker）：`capability-catalog-declarations.json` 的 `GUARD_OBJECT` 里那两条
      tick-log 守卫改为新形态（贴出改后的两条 `GUARD_OBJECT` 行）；新前缀写进 `guard-lineage-check.ts` 头部
      声明约定注释（贴出该注释行）；且 `ls plugin/scripts/manager-tick-log-check.sh
      plugin/scripts/outer-tick-log-check.sh` 两个文件**都在**、各自仍是**独立的** `GUARD_OBJECT` 键（贴出两行）
      ——⛔ 未合并成一个 checker。
- [x] AC6（回归）：`node --experimental-strip-types plugin/test/guard-lineage-check.test.mjs` exit 0
      （含新增的 runtime-kind 用例）；`bash scripts/test.sh --for-task gap-guard-lineage-runtime-carrier-not-evaluated`
      绿（或等价 scoped 静态门）。贴出两条输出。

## DoD

AC2 的 NOT-EVALUATED 读数取自检测器的**生产读数**——在一个真实不含 gitignored 载体的根上跑出的 `--json`，
而不是 fixture 注入或回显（硬规则 4 推论三：证明「能产出」≠ 证明「已产出」）。AC1 的现状读数与 AC3 的负控制读数
都在**真实对象**上取到并贴出，两半合起来才证明新取值是在**按「是不是运行时载体」这一个差别**分辨，
而不是把所有缺失都吞掉。修法**只是给「运行时载体」一个可区分的取值**，⛔ 不靠放宽或改掉聚类阈值来消掉这条
（阈值区分不了「读不懂」与「真的缺」，硬规则 3b），⛔ 也不合并那两个 checker。最终 `git status` 只含本任务
Touches 清单内的文件，两个测试文件绿。

## Touches

- plugin/scripts/guard-lineage-check.ts
- plugin/scripts/capability-catalog-declarations.json
- plugin/scripts/architecture-review-cluster.ts
- plugin/scripts/checker-mutation-cases/manager-tick-log-check.sh
- plugin/test/guard-lineage-check.test.mjs
- plugin/test/architecture-review-cluster.test.mjs
- tasks/gap-guard-lineage-runtime-carrier-not-evaluated.md