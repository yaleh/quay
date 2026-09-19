---
id: gap-arch-catalog-declarations-leave-bash
title: 架构棘轮：capability-catalog 声明表离开 bash —— 1907 行 [key]="…" 声明（10 张 declare -A
  表）→ 数据文件 + TS 渲染器，令 AC-311 取真值，同时保住 10 个调用方 / 13 个测试 / 3 个 mutation fixture /
  laydown / 打包面
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-arch-sh-census-check
goal_ac: AC-311
---
**type:** execution

## Proposal

**把 `plugin/scripts/capability-catalog.sh` 里 1907 行 `[key]="…"` 声明（10 张 `declare -A` 表）搬进数据文件、把渲染与「未声明即非零退出」入口闸改为 TS，使 AC-311 的判据在真实仓库根取到 exit 0；`bash plugin/scripts/capability-catalog.sh` 保留为薄入口（CLAUDE.md 指它为「唯一清单」，入口不可断）——同时保住 10 个调用方、13 个测试、3 个 mutation fixture、`quay-init` 的 laydown 集合与 `package.sh` 的 `--entry-surface` 门。**

来源：`goals/AC-311-capability-catalog-声明表离开-bash-….md`（判据正本，逐字引用其 `criterion`）+ GOAL-025「判据形态」+ `orchestration/SPEC-architecture-consolidation-ts-and-shell-2026-09-19.md` §5 Phase 4 / §2 P3（该 SPEC 位于分支 `worktree-spec-architecture-refactor`，本任务体自足，不依赖读到它）。

判据本体（逐字从 `goals/AC-311-*.md` 的 `criterion` 提取）：
```sh
n=$(grep -cE '^\s*\[[A-Za-z0-9._-]+\]="' plugin/scripts/capability-catalog.sh); [ "$n" -eq 0 ] || { echo "CAUSE=declaration-table-still-in-bash — capability-catalog.sh 仍含 $n 行 [key]=\"…\" 声明（表未数据化）" >&2; exit 1; }
bash plugin/scripts/capability-catalog.sh --summary >/dev/null 2>&1 || { echo "CAUSE=catalog-entry-gate-broken — --summary 非零（数据化后入口/未声明门失效）" >&2; exit 1; }
```

**立案实测（2026-09-19，机件独立读数，⛔ 不是抄 AC `origin` 里的数字）**：
```
$ grep -cE '^\s*\[[A-Za-z0-9._-]+\]="' plugin/scripts/capability-catalog.sh
1907
$ bash plugin/scripts/capability-catalog.sh --summary
capability-catalog: 340 scripts | 340 declared | 0 unclassified | 335 ship      # exit 0
$ bash plugin/scripts/capability-catalog.sh --json | jq length
340
```
⇒ 判据**第 2 支今天已为真**（入口活着），**第 1 支为假**（1907 ≠ 0）。两支都必须在迁移后各自成立，所以这不是「加个数据文件」，是「搬表且不弄坏入口」。

逐表行数（按 `declare -A` 边界逐行计数，⛔ 不是正则估）：
| 表 | 行数 | 表 | 行数 |
|---|---|---|---|
| QUESTION | 352 | CONSUMER | 145 |
| GUARD_OBJECT | 7 | SUPERSEDED | 5 |
| CADENCE | 341 | NOT_SHIPPED | 5 |
| INVALIDATION | 341 | PUBLIC_ENTRYPOINTS | 29 |
| LAST_REAFFIRMED | 341 | | |
| MATCHING | 341 | **合计** | **1907** |

**三个必须在迁移中被处理的既有事实（立案时实测，不是推测）**：

1. **QUESTION 352 行 ≠ 检查集 340 个。** `--json` 出 340 条；有 12 个被声明的名字**不在派生集里**：`accounting-emit-layer-map.ts`、`blocked-signal-check.sh`、`dead-loop-check.sh`、`fan-in-runid-check.ts`、`laydown-set-check.sh`、`process-budget.sh`、`slot-refill.ts`、`stage-receipt.ts`、`suite-state-trigger.ts`、`threshold-scope-check.ts`、`trend-check.ts`、`workflow-journal.ts`——它们是**历史/已退役条目的登记位**（`dead-loop-check.sh`、`process-budget.sh` 同时还在 `PUBLIC_ENTRYPOINTS` 里）。⇒ 数据文件必须**原样保留这些非派生条目**，否则 `--superseded-check` 与 `--entry-surface` 两支门的行为会静默改变（它们读的正是这些表）。⛔「QUESTION 行数应当等于脚本数」是错的，迁移不得据此裁剪。

2. **AC5 的「数据值不得含命令替换」静态门有 9 行盲区。** 该门的正则要求行首**恰好两个空格**（`^  \[`），而实测 1907 行里有 9 行不是两空格缩进（0 空格 1 行、3 空格 8 行；涉及 `[retired-clause-check.ts]` 与 `   [checked-in-write-check.ts]`）⇒ **它们逃过该扫描**。迁移把数据搬进数据文件后这个危险在结构上消失（JSON 值不被 shell 求值），但**该门不得因此变成一个恒绿的检查**（硬规则 3b：读不懂/已无对象 ⇒ 不得返回与合格同形的值）。二择一并写明理由：**要么**把它改写成对**全部**条目生效的数据完整性不变量（不再有缩进盲区），**要么**显式退役并给出替代检查（且替代检查自己必须能取假）。

3. **`--summary` 的自报量依赖派生集，而派生集是 `find "$SELF_DIR" -name '*.sh' -o -name '*.ts' -o -name '*.mjs'`**（`SELF_DIR` = `plugin/scripts/`，只排除 `checker-mutation-cases/**` 与 `archive/**`）。⇒ **任何落在 `plugin/scripts/` 下的新 `.ts` 都会把 N 从 340 变成 341**，AC 正文的「`N scripts` 自报值逐字一致」即不可字面满足。

**设计分岔（实现者必须显式选择，把选择、理由与实测贴进 notes）**：
- **（b，保持 N=340，与 AC 正文逐字相容）** 数据 + 渲染器放在 `plugin/scripts/` **之外**（如 `plugin/catalog/`），`capability-catalog.sh` 只做薄入口（exec 渲染器）。代价：渲染器本身不进 catalog 自己的清单，且**必须显式加进 `quay-init.sh` 的 laydown 集合**——因为它对闭包推导不可见（同类先例与后果写在 `plugin/scripts/quay-init.sh:995` 的 `shape-sections.ts` 注释里：漏了就是落地后 `ERR_MODULE_NOT_FOUND`）。
- **（a，N 340→341）** 数据放 `plugin/scripts/capability-catalog-declarations.json`（`.json` **不在**派生集里——先例 `plugin/scripts/judged-object-registry.json`），渲染器放 `plugin/scripts/capability-catalog.ts`（**进**派生集 ⇒ 必须自带六行登记：QUESTION / CADENCE / INVALIDATION / LAST_REAFFIRMED / MATCHING，按需 CONSUMER / GUARD_OBJECT）。此时 AC 正文的「逐字一致」按**「既有 340 条逐字不变 ∧ 增量恰为本次迁移引入的文件、逐条署名 ∧ unclassified 仍为 0」**交付，并把偏差理由写明。

**两条路都必须给出迁移前/后的 `--summary` 逐字两行 + 增量署名**（硬规则 5b：修好一处 ≠ 只此一处）。

**必须一起改的耦合面（逐条实测存在）**——

读 **catalog 源文本**（不是经 `--json`）的消费者，搬表后必红或静默失能：
- `plugin/scripts/guard-lineage-check.ts:81,409`——从 catalog 源文本解析 `GUARD_OBJECT` 声明块（`--catalog <file>` 默认值即该 `.sh`）；搬表后必须改读数据文件，且 `--help`/注释里的路径说明同步。
- `plugin/test/trend-check.test.mjs:373`——断言 catalog 源文本里有 `[trend-check.ts]="…"` ⇒ 搬表后必红。
- `plugin/test/red-on-omission-audit.test.mjs:263`——断言 catalog 源文本命中 `red-on-omission-audit`。
- `plugin/test/repo-root-unification.test.mjs:141`——断言 catalog 源文本命中 `repo-root.sh`（薄入口仍 `source` 它则可保留，但须显式确认）。
- `plugin/test/archive-exclusion-wiring.test.mjs:106`——把 catalog 源文本里的 `-not -path '*/archive/*'` 替换掉以取「撤排除即红」的负控；排除逻辑搬走后，负控的**注入目标必须换位**。
- `plugin/test/capability-catalog.test.mjs:200`——**AC5 门的负控靠往 `.sh` 源文本注入反引号/`$(`**；搬表后注入目标必须换到数据文件，否则该测试恒绿（= 假保证，正是硬规则 3b 的形态）。

按路径调用 catalog 的消费者（入口保留即可，但必须逐个复跑）：
- `plugin/scripts/select-static-checks-for-touches.ts:84`——scoped 门 `run_checker "capability-catalog" bash "${repo_root}/plugin/scripts/capability-catalog.sh" --json`，命令行走的是 `${repo_root}`（worktree 内即 worktree）。
- `plugin/scripts/select-static-checks-for-touches.ts:105`——`NEW_SCRIPT_REGISTRATION_REQUIRED = ["plugin/scripts/capability-catalog.sh"]`：**登记点是否随数据文件迁移必须显式决定并同步该常量**（决定后，其它新增脚本的任务要把新登记文件列进 Touches）。
- `plugin/scripts/rhythm-consumer-check.ts:260`——spawnSync `--json` 读 CONSUMER 字段。
- `packages/quay/scripts/package.sh:132`——在**暂存副本**（`packages/quay/plugin/`，由 `cp -R plugin/. →` 生成、gitignored）上跑 `--entry-surface`；新文件必须随暂存副本出现在那里。
- `plugin/scripts/quay-init.sh:1008`——laydown 集合把 `capability-catalog.sh` 与 `repo-root.sh` 逐字列出；**新增文件必须同时进这个集合**，否则 `quay-init --loop` 落地的目标项目里入口找不到自己的数据。

三个 mutation fixture（**只拷入口、不拷新文件 ⇒ baseline 当场红**；catalog 自己那个 fixture 会以 exit 4 打印 `baseline RED`）：
- `plugin/scripts/checker-mutation-cases/capability-catalog.sh`（拷 `.sh` + `repo-root.sh`）
- `plugin/scripts/checker-mutation-cases/rhythm-consumer-check.sh`（同上，跑 `--json`）
- `plugin/scripts/checker-mutation-cases/kernel-sibling-resolution-check.sh`（按路径引用 catalog，落地前须核其是否拷贝）

**注释级漂移（硬规则 5b 扫描）**：`plugin/scripts/checker-lib.ts:4,17` 等把「声明在 capability-catalog.sh 的 QUESTION / MATCHING 表」当作事实写进注释；搬表后这些句子变成假的。落地前跑一次 `grep -rn 'capability-catalog' plugin/scripts plugin/test plugin/loop plugin/skills packages/quay/scripts CLAUDE.md`，把**命中数与前 3 条**贴进 notes，逐条判定「是否陈述了表的位置」，需要改的文件**先补进 Touches 再改**。

**口径**：⛔ 不改 Provider ABI、不改公开 CLI/MCP 表面、不新增 CLI 参数或子命令；`bash plugin/scripts/capability-catalog.sh` 仍是唯一入口形态（`package.sh`、scoped 门、`CLAUDE.md` 都写死了它）。

<!-- dedup-ref -->
**与相邻任务的分工（仅追溯）**：本条管 AC-311，其余六条相邻任务各管 GOAL-025 的另一条量（`gap-arch-import-graph-check` AC-304 / `gap-arch-sh-census-check` AC-305 / `gap-arch-coverage-self-report` AC-306 / `gap-arch-reverse-edges-zero` AC-307 / `gap-arch-import-cycles-zero` AC-308 / `gap-arch-kernel-consumed-and-falsified` AC-309 / `gap-arch-duplicate-copies-zero` AC-310）。SPEC §9 的排序表把 Phase 4 的前置记为 0b，故本任务 `depends_on: gap-arch-sh-census-check`——0b 会新增一个 `plugin/scripts/*.ts`，因此要改同一张登记表，两条必须串行；0a/0c 同样会新增 `plugin/scripts/*.ts`，与本条的登记面相交（由 Touches 锁机械串行，不另加 `depends_on`）。

## Touches

- plugin/scripts/capability-catalog.sh
- plugin/scripts/capability-catalog.ts
- plugin/scripts/capability-catalog-declarations.json
- plugin/scripts/guard-lineage-check.ts
- plugin/scripts/select-static-checks-for-touches.ts
- plugin/scripts/rhythm-consumer-check.ts
- plugin/scripts/registry-bare-filename-scan.ts
- plugin/scripts/outer-retirement-precondition-check.ts
- plugin/scripts/sh-census-check.ts
- plugin/scripts/checker-lib.ts
- plugin/scripts/quay-init.sh
- plugin/scripts/checker-mutation-cases/capability-catalog.sh
- plugin/scripts/checker-mutation-cases/rhythm-consumer-check.sh
- plugin/scripts/checker-mutation-cases/kernel-sibling-resolution-check.sh
- plugin/test/capability-catalog.test.mjs
- plugin/test/guard-lineage-check.test.mjs
- plugin/test/select-static-checks-for-touches.test.mjs
- plugin/test/registry-bare-filename-scan.test.mjs
- plugin/test/trend-check.test.mjs
- plugin/test/red-on-omission-audit.test.mjs
- plugin/test/repo-root-unification.test.mjs
- plugin/test/archive-exclusion-wiring.test.mjs
- plugin/test/shipped-entry-runnable.test.mjs
- plugin/sh-census-baseline.json
- plugin/skills/quay-file-task/SKILL.md
- packages/quay/scripts/package.sh
- tasks/gap-arch-catalog-declarations-leave-bash.md

（**设计分岔已选 (a)**：数据 = `plugin/scripts/capability-catalog-declarations.json`，渲染器 = `plugin/scripts/capability-catalog.ts`，派生集 343→344。理由：渲染器是真实机件，放在 `plugin/scripts/` 之外会让它对 sh-census / import-graph / catalog 自己的清单结构性不可见（正是本方法论要消灭的可见性洞）；`.json` 不进派生集已有先例 `judged-object-registry.json`；而 (b) 的新目录对闭包推导不可见，失效形态是消费者项目里的 `ERR_MODULE_NOT_FOUND`。落地时**原清单未列齐、必须先补进再改**的文件：`registry-bare-filename-scan.ts`（它按名把 `capability-catalog.sh` 排除为「种群描述而非引用」——该角色随表迁到数据文件，排除对象必须跟着换位，否则 344 条声明会把「每个脚本都被引用」灌进死集闭包）、`outer-retirement-precondition-check.ts`、`sh-census-check.ts`（5b 扫描出的 3 处**日期化的实测引用**）、`registry-bare-filename-scan.test.mjs`、`guard-lineage-check.test.mjs`、`shipped-entry-runnable.test.mjs`、`select-static-checks-for-touches.test.mjs`、`plugin/skills/quay-file-task/SKILL.md`、以及 `plugin/sh-census-baseline.json`。）

## AC

- [x] **AC1（判据本体在真实仓库根取真值）** 逐字提取 `goals/AC-311-*.md` 的 `criterion` 并在真实仓库根执行 ⇒ `exit 0`；同一次的 `grep -cE '^\s*\[[A-Za-z0-9._-]+\]="' plugin/scripts/capability-catalog.sh` = `0`，`bash plugin/scripts/capability-catalog.sh --summary` = `exit 0`。⛔ 不得用 fixture、自造输出或别的模式代替这次真读数；命令与原始输出逐字贴进 notes。
- [x] **AC2（搬移无损，逐条枚举不是布尔）** 10 张表**逐表**给出「迁移前行数 / 迁移后数据文件内对应条目数」，并对每张表做一次**排序后的 (key→value) diff 为空**；合计 1907 行**全部有家**（每张表 → 数据文件中落点的映射写进 notes）。⛔ 抽查不算。12 个非派生条目必须在数据文件中都存在，逐个断言。
- [x] **AC3（入口闸迁前迁后各取假一次）** ①**迁移前**、②**迁移后**，各在 `plugin/scripts/` 放一个未声明的新文件 ⇒ `--summary` 与 `--json` **均非零退出**且报出 unclassified；删除后 ⇒ `exit 0`。③ 若数据文件被移走/改名/损坏 ⇒ 入口必须**非零退出并带 CAUSE**，⛔ 不得把表读成空后静默 `exit 0`（硬规则 3b）。三次注入都在 worktree 内进行、**当场撤销**，收尾 `git status --porcelain` 干净（硬规则 11/11b）。
- [x] **AC4（其余模式逐字等价）** 迁移前后各跑一次并对比：`--json`、`--table`、`--entry-surface`、`--entry-surface --summary`、`--superseded-check`；退出码相同、输出相同（选 (a) 使 N 343→344，差异**只有本次引入的新文件那一行**，逐行署名，其余逐字不变）。迁移前/后的 `--summary` 两行**原文**贴进 notes。
- [x] **AC5（读源文本的消费者已全部换位 + 5b 扫描）** 对六处逐个给出「改动前红（负控）/ 改动后绿」：`guard-lineage-check.ts`、`trend-check.test.mjs`、`red-on-omission-audit.test.mjs`、`repo-root-unification.test.mjs`、`archive-exclusion-wiring.test.mjs`、`capability-catalog.test.mjs`。**5b 扫描**：贴出 `grep -rn 'capability-catalog' …` 的**命中数与前 3 条**，并给出逐条判定「是否陈述了表的位置」的结论。
- [x] **AC6（fixture / laydown / 打包面实跑）** 三个 mutation fixture 各跑一次 ⇒ `exit 0`，且**改动前先跑一次作为负控**；`quay-init.sh` 的 laydown 集合含新增文件，并用 Wiring 用例证明入口 `--summary` = `exit 0`；暂存副本上 `bash packages/quay/plugin/scripts/capability-catalog.sh --entry-surface` = `exit 0`。
- [x] **AC7（AC5 门不变成恒绿）** 对「数据值含反引号或 `$(`」注入一次 ⇒ 入口**非零退出**；撤销 ⇒ `exit 0`。⛔ 不得让 `capability-catalog.test.mjs` 在搬表后继续绿着却什么也没验到。
- [x] **AC8（入口形态未变）** `packages/quay/scripts/package.sh:132` 与 `plugin/scripts/select-static-checks-for-touches.ts:84` 的调用形态保持 `bash …/capability-catalog.sh <mode>`；未新增 CLI 参数/子命令；`CLAUDE.md` 里「`bash plugin/scripts/capability-catalog.sh`（唯一清单）」这句仍然成立（贴出实跑）。

## DoD

真实落地标准：**AC-311 的 `criterion` 在 fan-in 后的生产树（develop / 主检出）上 `exit 0`**，且该次 `--summary` 满足 `declared == scripts`、`unclassified == 0`、`ship` 与迁移前一致（选 (a) 故为逐字增量比对）。AC2 的 10 张表逐表 diff 为空 + 行数落点映射在 notes 里；AC3 的入口闸注入（**迁前迁后各一次**）与 AC7 的数据完整性注入各有「注入 ⇒ 红、撤销 ⇒ 绿」的实做留痕；AC5 的六处含**改动前负控**；AC6 的三个 fixture、laydown 落地与暂存副本实跑留痕齐备；worktree `git status --porcelain` 干净、无残留注入。

## Notes — 落地留痕（全部为真实仓库根/worktree 内的实测读数）

### 分支选择与实际数字（立案数字已过期，⛔ 未沿用）
选 **(a)**。立案写「1907 行 / 340 scripts」，落地实测为 **1925 行 / 343 scripts** —— `gap-arch-coverage-self-report` / `import-graph-check` / `sh-census-check` 三条相邻任务在立案后落了地，各注册了新脚本。本任务全部按**自己的读数**交付。

### AC1（判据本体，逐字）
```
$ grep -cE '^\s*\[[A-Za-z0-9._-]+\]="' plugin/scripts/capability-catalog.sh
0
$ bash plugin/scripts/capability-catalog.sh --summary
capability-catalog: 344 scripts | 344 declared | 0 unclassified | 339 ship      # exit 0
$ <criterion 逐字执行>  → exit 0
```
迁移前同一支读数（真实仓库根 baseline，本会话开始时实测）：`capability-catalog: 343 scripts | 343 declared | 0 unclassified | 338 ship`（exit 0）。

### AC2（逐表 ledger，diff 全部为空）
1909 条 bash 唯一键（1925 声明行 = 1909 + 16 次重复赋值，bash **last-wins**；12 个重复在 QUESTION、1 个在 CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING）。数据文件 = **1915** 条（1909 + 6 条为 `capability-catalog.ts` 的登记）。

| 表 | 声明行 | bash 唯一键 | 数据文件 | 排序后 (key→value) diff |
|---|---|---|---|---|
| QUESTION | 355 | 343 | 344 | EMPTY（extra 仅 `capability-catalog.ts`） |
| GUARD_OBJECT | 7 | 7 | 7 | EMPTY |
| CADENCE | 344 | 343 | 344 | EMPTY（extra 仅 `capability-catalog.ts`） |
| INVALIDATION | 344 | 343 | 344 | **1 处署名修改**，0 丢失 |
| LAST_REAFFIRMED | 344 | 343 | 344 | EMPTY（extra 仅 `capability-catalog.ts`） |
| MATCHING | 344 | 343 | 344 | EMPTY（extra 仅 `capability-catalog.ts`） |
| CONSUMER | 148 | 148 | 148 | EMPTY |
| SUPERSEDED | 5 | 5 | 5 | EMPTY |
| NOT_SHIPPED | 5 | 5 | 5 | EMPTY |
| PUBLIC_ENTRYPOINTS | 29 | 29 | 30 | EMPTY（extra 仅 `capability-catalog.ts`） |
| **合计** | **1925** | **1909** | **1915** | |

落点映射：**全部 10 张表 → `plugin/scripts/capability-catalog-declarations.json` 的同名顶层键**（单文件单层，无分片）。

**无损性是对着 bash 自己的求值验的，不是重新解析**：把原 `declare -A` 块逐字抽进临时脚本、在干净 shell 里 source 后 dump `表\t键\t值`，与数据文件逐键比对 ⇒ **10 张表全等**（含 last-wins 折叠与 `\$` 反转义）。这是 AC2 的「排序后 diff 为空」的实际取证方式。

**唯一一处署名修改**（不是丢失）：`INVALIDATION[guard-lineage-check.ts]`。它的全文以「`capability-catalog.sh` 的 GUARD_OBJECT 声明块」为失效前提的登记处，并写明「若 GUARD_OBJECT 声明块迁出 capability-catalog.sh …本条失效」——**该触发句在本任务里恰好成立**，故同步为「capability-catalog 的 GUARD_OBJECT 表（声明数据 capability-catalog-declarations.json）」。其余 1908 条逐字不变。

12 个非派生登记位**逐个断言存在**：`accounting-emit-layer-map.ts`、`blocked-signal-check.sh`、`dead-loop-check.sh`、`fan-in-runid-check.ts`、`laydown-set-check.sh`、`process-budget.sh`、`slot-refill.ts`、`stage-receipt.ts`、`suite-state-trigger.ts`、`threshold-scope-check.ts`、`trend-check.ts`、`workflow-journal.ts` ⇒ 全部 `OK`。

### AC3（入口闸两支）
- **迁移前**（原 `.sh` = 1925 声明行，放进临时树）：clean `exit 0`；注 `zzz-undeclared-probe.ts` ⇒ `--summary exit 1`（`3 scripts | 2 declared | 1 unclassified`）∧ `--json exit 1`（`question: null` = probe）；删除 ⇒ `exit 0`。
- **迁移后**（worktree 内）：clean `exit 0`（344/344/0/339）；注 probe ⇒ `--summary exit 1`（345/344/1）∧ `--json exit 1`（unclassified = `['zzz-undeclared-probe.ts']`）；删除 ⇒ `exit 0`。**probe 当场删除，收尾 `git status --porcelain` 无该文件。**
- **③ 数据文件三态，三支各自不同 CAUSE，⛔ 均未静默 exit 0**：移走/改名 ⇒ `exit 3` `CAUSE=capability-catalog-declarations-missing`（bash 侧，入口 exec 之前）；截断 ⇒ `exit 3` `CAUSE=declarations-unparsable`；删掉 `GUARD_OBJECT` 表 ⇒ `exit 3` `CAUSE=declarations-table-missing`。撤销 ⇒ `exit 0`。

### AC4（模式等价）
`--summary` / `--table` / `--entry-surface` / `--entry-surface --summary` / `--superseded-check` 五个模式**迁移前后 stdout 逐字相同**（`--table` 与 `--summary` 的唯一差异是新脚本那一行与随之的 N/ship 数）。`--json` 逐条 diff = **恰好一行新增**（`capability-catalog.ts`，`surface: null`，question/cadence/invalidation/last_reaffirmed/matching 齐全）+ 上面那一条署名 INVALIDATION 修改；其余 343 条逐字不变。stderr 只多出 Node 对 plugin 下所有 `.ts` 都会打的 `MODULE_TYPELESS_PACKAGE_JSON` 提示（仓库既有形态，非本次引入）。
```
BEFORE: capability-catalog: 343 scripts | 343 declared | 0 unclassified | 338 ship
AFTER : capability-catalog: 344 scripts | 344 declared | 0 unclassified | 339 ship
```

### AC5（六处消费者 + 5b 扫描）
| 处 | 改动前（负控） | 改动后 |
|---|---|---|
| `guard-lineage-check.ts` | 旧解析器读新 `.sh` ⇒ **0** 个 GUARD_OBJECT（静默归零） | 新解析器读数据文件 ⇒ **7** 个（= 表大小） |
| `trend-check.test.mjs:373` | ✖ `trend-check.ts has a declared question…` | ✔ 16/0 |
| `red-on-omission-audit.test.mjs:263` | ✖ 同名 wiring 断言 | ✔ 18/0 |
| `repo-root-unification.test.mjs:141` | ✔（**改动前后都绿**） | ✔ 10/0 |
| `archive-exclusion-wiring.test.mjs:106` | ✖（注入目标消失 ⇒ 断言 notEqual 失败） | ✔ 6/0 |
| `capability-catalog.test.mjs:200` 等 | ✖ 5 个用例（AC1c / AC5 / AC3 / ①② 入口闸，fixture 缺数据文件一律 exit 3） | ✔ 16/0 |

**偏差必须写明**：`repo-root-unification.test.mjs:141` **没有**改动前红——薄入口仍 `source ${SCRIPT_DIR}/repo-root.sh`，这正是任务体要求「显式确认」的那一处，故保留原断言未动。`guard-lineage-check.ts` **没有自己的 mutation case**（`plugin/scripts/checker-mutation-cases/` 下无 `guard-lineage-check.sh`，实测），其行为覆盖是单元测试文件 + 上面的新旧解析器对照。

**5b 扫描**：`grep -rn 'capability-catalog' plugin/scripts plugin/test plugin/loop plugin/skills packages/quay/scripts CLAUDE.md` ⇒ **281 命中**（迁移前 275；增量来自本次新增文件的自述）。前 3 条：
```
plugin/scripts/sh-census-check.ts:10://   的程序（verify-deliver-coldstart.sh 6293 有效行、develop-deliver-tgz.sh 2346、capability-catalog.sh 2187 …），
plugin/scripts/sh-census-check.ts:123: *      内嵌形态（develop-deliver-tgz.sh / capability-catalog.sh 都是它）。把双引号整段掩掉会让
plugin/scripts/sh-census-check.ts:275:      // following line is masked as a body that never closes. Measured: capability-catalog.sh:2272
```
逐条判定**「是否陈述了表的位置」**：7 个文件**是**并已改（`checker-lib.ts`、`outer-retirement-precondition-check.ts`、`package.sh`、`quay-file-task/SKILL.md`、`shipped-entry-runnable.test.mjs`、`guard-lineage-check.ts`、`capability-catalog.test.mjs`）——其中 `package.sh` 的失败提示与 `quay-file-task` 的登记指引是**可执行的误导**，必须改。`CLAUDE.md:15/178` **判定为仍成立**（陈述的是「唯一入口」与「不得复制清单」，入口形态未变，AC8 已实测）⇒ 未改（本文件是本仓库最稀缺资源，不在 Touches 内，不做非必要改动）。`sh-census-check.ts` 的 3 处**判定为同类但不同子类**：它们说的是**该文件的行数/行号**（日期化的实测记录），不是表的存放处；仍按 5b 精神补注「该文件已于 2026-09-19 数据化」，⛔ 数字保留为立案时读数而非删改（删掉就是抹掉该判据的取证）。其余 271 条为路径调用、断言字符串、自身文档与相邻任务的任务体，不属于「陈述表的位置」。

### AC6（fixture / laydown / 打包面）
- 三个 mutation fixture：**迁移后全 `exit 0`**；**迁移前的负控实做**：`capability-catalog` fixture `exit 4`（`baseline RED … checker always-red?`）、`rhythm-consumer-check` fixture `exit 3`（`STAYED-GREEN — an unwired non-按需 mechanism did not redden the checker`）、`kernel-sibling-resolution-check` `exit 0`（它不拷 catalog，仅按路径引用）。
  ⚠️ `rhythm-consumer-check` fixture 的 INJECT **换了形态**：它原先靠「把 catalog 从 `scripts/test.sh` 里摘掉」取红，搬表后**不再红**——因为判据1 接受 strict(broad) 任一命中，而渲染器合法地在自己的头部写了入口 basename（真边）。故 INJECT 改为**注入一个「已声明非-按需但无人调用」的新探针**，这才是判据1真正禁止的形态。
- laydown：`bash plugin/scripts/laydown-set-check.sh --root <wt> --list`（**与 `--loop` laydown 同一个 single source**）含 `capability-catalog.sh`、`capability-catalog.ts`、`capability-catalog-declarations.json`、`repo-root.sh`、`repo-root.ts` —— 两个新文件**经闭包步 (d)** 自动进入（薄入口里 `${SCRIPT_DIR}/capability-catalog.ts` / `…-declarations.json` 两个引用），故**未改 `quay-init.sh`**（该显式清单的用途正是「闭包看不见的依赖」，再加一份即制造双份清单）。另外在临时目标树上实跑 `quay-init --loop`：catalog **不落地**（与 `Wiring` 用例一致），入口在插件内 standalone 通过。
- 打包面：**真跑 `bash packages/quay/scripts/package.sh`**（exit 0，`AC3 gate … → PASS`，dist 闭包门 100/100）。暂存副本 `bash packages/quay/plugin/scripts/capability-catalog.sh --entry-surface` ⇒ `exit 0`（75 shipped | 29 public | 46 internal，21 distinct .sh）。
  **这一步抓出一个真缺陷并已修**：`package.sh` 把 `.ts` 打进 `scripts/dist/`，渲染器原先以**自己的目录**为「检查集目录」⇒ 在**已发布的产物形态**下枚举到 0 个脚本、`--summary` 报 `0 scripts | 0 declared | 0 unclassified`（一个**与合格同形的空转读数**，硬规则 3b）。修法是让「检查集目录」锚在**声明数据文件所在目录**（两种形态下都正确）⇒ 产物形态复查 `87 scripts | 87 declared | 0 unclassified | 84 ship`，`--superseded-check` 与 `--entry-surface --json`（`ok: true`）均 `exit 0`。**开发树看不见这个形态**，只有真打包能看见。

### AC7（完整性门未恒绿）
数据值注入反引号 ⇒ `exit 1`，stderr：`FAIL (AC5 no-command-substitution): a declaration value in capability-catalog-declarations.json contains a command-substitution pattern…` + `QUESTION[capability-catalog.sh]: …`（**点名到表与键**）；注入 `$(` ⇒ 同样 `exit 1`；撤销 ⇒ `exit 0`。门的**扫描面从「两空格缩进的源码行」改为「10 张表的每一个值」**（今日 1915 个），故原先逃逸的 9 行非两空格缩进声明现在也在面内；`_comment` 这类下划线散文键除外（与旧门不扫注释行同构，且在渲染器注释里明写，⛔ 不隐含扩张）。

### AC8（入口形态）
`packages/quay/scripts/package.sh:133` 与 `plugin/scripts/select-static-checks-for-touches.ts:84` 的调用形态**逐字未变**（`bash …/capability-catalog.sh --entry-surface` / `run_checker "capability-catalog" bash "${repo_root}/plugin/scripts/capability-catalog.sh" --json`）；未新增 CLI 参数/子命令；`CLAUDE.md:15` 的「`bash plugin/scripts/capability-catalog.sh`（唯一清单）」经实跑仍成立。scoped 门里 `superseded-capability-check` 就是按该命令行调起来的（日志可见），是这条的机械复跑。

### 其它被本改动带动的棘轮（原 Touches 未列，已先补再改）
`plugin/sh-census-baseline.json`：本改动**正是**该基线 `structuralNote` 预告的 Phase 4 收缩。`embeddedInterpreterLines` **11690 → 9505**（−2185），归因 = `capability-catalog.sh` 有效行 **2199 → 14**（−2185），**残差 0**；`duplicateCopies` 37 不变。已在 `_reanchorLog` 追加一条（含 from/to/why/attribution/structuralNote）并由 `sh-census-check --check` 与它自己的测试（20/0）复核。⚠️ 注意该轴计的是「内嵌解释器的 .sh 有效行」——薄入口仍内嵌解释器，所以**减的是行数不是成员资格**。

### scoped 门与收尾
`bash scripts/test.sh --for-task gap-arch-catalog-declarations-leave-bash --allow-thin` ⇒ **exit 0，187/187 通过**（改动后又改过 5b 注释，重跑一次仍 exit 0，`checker-mutation-check --check-changed` 覆盖本 delta 的 5 个 checker 载体：capability-catalog / rhythm-consumer-check / outer-retirement-precondition-check / registry-bare-filename-scan / sh-census-check）。worktree `git status --porcelain` 干净、无残留注入、无打包遗留（`packages/quay/plugin/` 与 `.tgz` 均 gitignored）。全部提交在任务分支上，`develop` 只由 fan-in 移动。
