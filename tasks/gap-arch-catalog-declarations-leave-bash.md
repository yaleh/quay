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

（**设计分岔已选 (a)**：数据 = `plugin/scripts/capability-catalog-declarations.json`，渲染器 = `plugin/scripts/capability-catalog.ts`，派生集 343→344。理由：渲染器是真实机件，放在 `plugin/scripts/` 之外会让它对 sh-census / import-graph / catalog 自己的清单结构性不可见（正是本方法论要消灭的可见性洞）；`.json` 不进派生集已有先例 `judged-object-registry.json`；而 (b) 的新目录对闭包推导不可见，失效形态是消费者项目里的 `ERR_MODULE_NOT_FOUND`。落地时**原清单未列齐、必须先补进再改**的文件：`registry-bare-filename-scan.ts`（它按名把 `capability-catalog.sh` 排除为「种群描述而非引用」——该角色随表迁到数据文件，排除对象必须跟着换位，否则 344 条声明会把「每个脚本都被引用」灌进死集闭包）、`outer-retirement-precondition-check.ts`、`registry-bare-filename-scan.test.mjs`、`guard-lineage-check.test.mjs`、`shipped-entry-runnable.test.mjs`、`select-static-checks-for-touches.test.mjs`、`plugin/skills/quay-file-task/SKILL.md`（立案 skill 指向登记文件的那句）、以及 `plugin/sh-census-baseline.json`（本改动**正是**该基线 `structuralNote` 预告的 Phase 4 收缩：capability-catalog.sh 有效行 2199→14 ⇒ embeddedInterpreterLines 11690→9505，差 2185 = 2199−14，残差 0）。）

## AC

- [ ] **AC1（判据本体在真实仓库根取真值）** 逐字提取 `goals/AC-311-*.md` 的 `criterion` 并在真实仓库根执行 ⇒ `exit 0`；同一次的 `grep -cE '^\s*\[[A-Za-z0-9._-]+\]="' plugin/scripts/capability-catalog.sh` = `0`，`bash plugin/scripts/capability-catalog.sh --summary` = `exit 0`。⛔ 不得用 fixture、自造输出或别的模式代替这次真读数；命令与原始输出逐字贴进 notes。
- [ ] **AC2（搬移无损，逐条枚举不是布尔）** 10 张表**逐表**给出「迁移前行数 / 迁移后数据文件内对应条目数」，并对每张表做一次**排序后的 (key→value) diff 为空**；合计 1907 行**全部有家**（每张表 → 数据文件中落点的映射写进 notes）。⛔ 抽查不算。12 个非派生条目（逐字：`accounting-emit-layer-map.ts`、`blocked-signal-check.sh`、`dead-loop-check.sh`、`fan-in-runid-check.ts`、`laydown-set-check.sh`、`process-budget.sh`、`slot-refill.ts`、`stage-receipt.ts`、`suite-state-trigger.ts`、`threshold-scope-check.ts`、`trend-check.ts`、`workflow-journal.ts`）必须在数据文件中都存在，逐个断言。
- [ ] **AC3（入口闸迁前迁后各取假一次）** ①**迁移前**、②**迁移后**，各在 `plugin/scripts/` 放一个未声明的新文件（如 `zzz-undeclared-probe.ts`）⇒ `--summary` 与 `--json` **均非零退出**且报出 unclassified；删除后 ⇒ `exit 0`。③ 若数据文件被移走/改名/损坏 ⇒ 入口必须**非零退出并带 CAUSE**，⛔ 不得把表读成空后静默 `exit 0`（硬规则 3b）。三次注入都在 worktree 内进行、**当场撤销**，收尾 `git status --porcelain` 干净（硬规则 11/11b）。
- [ ] **AC4（其余模式逐字等价）** 迁移前后各跑一次并对比：`--json`（340 条逐条 diff）、`--table`、`--entry-surface`、`--entry-surface --summary`、`--superseded-check`；退出码相同、输出相同（若选 (a) 使 N 340→341，差异必须**只有本次引入的新文件那一行**，逐行署名，其余 340 条逐字不变）。迁移前/后的 `--summary` 两行**原文**贴进 notes。
- [ ] **AC5（读源文本的消费者已全部换位 + 5b 扫描）** 对六处逐个给出「改动前红（负控）/ 改动后绿」：`guard-lineage-check.ts`（并跑它自己的 mutation case）、`trend-check.test.mjs:373`、`red-on-omission-audit.test.mjs:263`、`repo-root-unification.test.mjs:141`、`archive-exclusion-wiring.test.mjs:106`、`capability-catalog.test.mjs:200`。**5b 扫描**：贴出 `grep -rn 'capability-catalog' …` 的**命中数与前 3 条**，并给出逐条判定「是否陈述了表的位置」的结论。
- [ ] **AC6（fixture / laydown / 打包面实跑）** 三个 mutation fixture 各跑一次 `bash plugin/scripts/checker-mutation-cases/<name>.sh <workdir>` ⇒ `exit 0`，且**改动前先跑一次作为负控**（预期 catalog 与 rhythm 两个在 baseline 就红，若 fixture 不同步拷新文件）；`quay-init.sh` 的 laydown 集合含新增文件，并在临时目标树上实跑一次 laydown（或 `plugin/test/capability-catalog.test.mjs` 的 Wiring 用例）证明**落地后**入口 `--summary` = `exit 0`；暂存副本上 `bash packages/quay/plugin/scripts/capability-catalog.sh --entry-surface` = `exit 0`。
- [ ] **AC7（AC5 门不变成恒绿）** 对「数据值含反引号或 `$(`」注入一次 ⇒ 入口（或其数据完整性检查）**非零退出**；撤销 ⇒ `exit 0`。若判定该门退役，写明「格式已消除危险」的理由**并**给出替代完整性检查（如数据文件必须可被解析且键值非空），且替代检查自己取假一次（注入即红）。⛔ 不得让 `capability-catalog.test.mjs:200` 在搬表后继续绿着却什么也没验到。
- [ ] **AC8（入口形态未变）** `packages/quay/scripts/package.sh:132` 与 `plugin/scripts/select-static-checks-for-touches.ts:84` 的调用形态保持 `bash …/capability-catalog.sh <mode>`（或同步更新并给出理由）；未新增 CLI 参数/子命令；`CLAUDE.md` 里「`bash plugin/scripts/capability-catalog.sh`（唯一清单）」这句仍然成立（贴出实跑）。

## DoD

真实落地标准：**AC-311 的 `criterion` 在 fan-in 后的生产树（develop / 主检出）上 `exit 0`**，且该次 `--summary` 满足 `declared == scripts`、`unclassified == 0`、`ship` 与迁移前一致（或与迁移前逐字相同，见 AC4 的分支判读）。AC2 的 10 张表逐表 diff 为空 + 1907 行落点映射在 notes 里；AC3 的入口闸注入（**迁前迁后各一次**）与 AC7 的数据完整性注入各有「注入 ⇒ 红、撤销 ⇒ 绿」的实做留痕；AC5 的六处含**改动前负控**（证明修的是真缺陷、不是「本来就绿」）；AC6 的三个 fixture、laydown 落地与暂存副本实跑留痕齐备；worktree `git status --porcelain` 干净、无残留注入。⛔ 不是「加了一个数据文件就算了」——是**判据在真实仓库根取真值、且两支 CAUSE 与入口闸都仍能取假**。
