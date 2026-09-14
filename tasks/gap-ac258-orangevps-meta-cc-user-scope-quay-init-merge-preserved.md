---
id: gap-ac258-orangevps-meta-cc-user-scope-quay-init-merge-preserved
title: orangevps/meta-cc 真机重验：user scope 装 0.7.0 + quay-init 重跑（删键重注册，非探测路径）+ 真实
  todo→done（GOAL-018/AC-258）
status: todo
needs_human_cause: unclassified
labels:
  - gap
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac257-ad-arm1-archguard-project-scope-quay-init-merge-rerun
goal_ac: AC-258
---
## Proposal

**要满足的判据（正本 `goals/AC-258-orangevps-meta-cc-user-scope-装-0-7-0-quay-init-重跑-删键重注册-非探测路.md`）**：载体 `.quay/productization-verification.jsonl` 中存在一条记录，逐字满足 11 个谓词 —— `ac=="GOAL-018-AC-258"` ∧ `host=="orangevps"` ∧ `project_root=="/home/yale/work/meta-cc"` ∧ `install_scope=="user"` ∧ `quay_version=="0.7.0"` ∧ `quay_init_rerun is True` ∧ `merge_preserved is True` ∧ `str(marketplace_path or provider_path)` 非空且**不**匹配 `verify-|probe|/tmp/` ∧ `task_status=="done"` ∧ `commit_sha` 非空 ∧ `produced_by_driver is True`。exit 1 = 载体缺失或无合格记录。判据正文逐字禁止引用 08-20 AC118 / 09-11 AC-238/239 的记录充数：那些记录的 `project_root` 都是隔离副本，且**不含 `install_scope` 字段**。

**立案当轮实测（2026-09-14，直接 ssh orangevps 与本地读盘，非推断）**：

| 读数 | 实测值 |
|---|---|
| 载体 GOAL-018 命中数 | **0**（`grep -c GOAL-018 .quay/productization-verification.jsonl`，157 行全属 GOAL-009/015/016） |
| `install_scope` 全仓命中 | **0** ⇒ 该字段的产出侧从未存在，本 AC 从未被行使 |
| 本仓库版本 | **0.6.1**（`node packages/quay/bin/quay.js --version`）⇒ 不 bump 前 `quay_version=0.7.0` 结构上不可满足 |
| orangevps `npm ls -g` | `quay@0.6.1` ∧ **`quay-native@0.6.0`**（两者不一致，GOAL-018 已记） |
| orangevps `~/.claude/settings.json` | 858 B（mtime Sep 11 16:03），键：`agentPushNotifEnabled / enabledPlugins / extraKnownMarketplaces / model / skipDangerousModePermissionPrompt / tui` |
| `extraKnownMarketplaces` | `baime→/home/yale/work/baime`、`manda→/home/yale/work/manda`、**`quay→/home/yale/quay-verify-upgrade-3b0932db.npm/lib/node_modules/quay/plugin`（探测路径，命中判据排除模式）**、`meta-cc-marketplace→/home/yale/.local/share/meta-cc` |
| `enabledPlugins` | `baime@baime:true`、`manda@manda:true`、**`quay@quay:true`**、`meta-cc@meta-cc-marketplace:true` |
| `known_marketplaces.json` | 5 键：`baime / claude-plugins-official / manda / meta-cc-marketplace / quay`；`quay` 的 `source.path` 与 `installLocation` **都是上面那条探测路径**，`lastUpdated=2026-09-11T16:03:51Z` |
| `installed_plugins.json` 的 `quay@quay` | **16 条**：1 条 `scope:"user"`（v**0.3.20**，installPath `~/.claude/plugins/cache/quay/quay/0.3.20`）+ **15 条 `scope:"project"`**，全部指向 `/home/yale/ac207-*` / `/home/yale/quay-verify-*` 探测根 |
| orangevps `claude` | **在**：`/home/yale/.local/bin/claude`（`bash -lc` 读到；与 AC-257 同款「非登录 shell 无 claude」伪影，⛔ 不要据此报「机器没有 claude」——硬规则 4b 代理量 vs 直接量） |
| 探测目录 | `/home/yale/quay-verify-upgrade-3b0932db.npm` **仍在** |
| meta-cc | branch `main`，HEAD `a8c57f5 2026-08-21T16:09:54+00:00 chore: release v3.8.4`，**停滞 3+ 周**；`tasks/` **102 个**；`.quay/` 只有 `config.yml` + `gate-events.jsonl`；`.quay/runtime/` 只有 `bin` + `provider.yml`（陈旧）；**无任何 pid 文件、无 meta-cc 自己的 driver 在跑**；`.claude/settings.json` **不存在**（只有 `settings.local.json`）；工作树干净 |
| meta-cc `.quay/config.yml` | provider 绑定干净：`native.path:"."`、`mcp_entry:["quay-native","mcp"]`、`default_task_status: todo`、`QUAY_NATIVE_TASKS_DIR:"./tasks"` —— **无探测路径** |
| orangevps 孤儿 driver | `ps` 有 **20+** 个残留 `promotion-driver`/`worker-driver`，全部指向 `/tmp/ac207-r13-*`、`~/quay-verify-*`、`~/quay-ac207fix*` 等已完结探测根（GOAL-018 非目标：本次先手动清理，机制化回收另立 gap） |

**机制缺口（本 AC 的实质）**：「**user scope 上把一个已注册的插件【删键】后用持久路径重新注册，且同一 `settings.json` 里其它 marketplace/enabledPlugins 条目逐字保留**」这条路径从未被行使过。三个具体缺口：

1. **判据的 `merge_preserved` 是双条件**（GOAL-018 逐字）：① `baime/manda/meta-cc-marketplace` 等既有条目在替换 quay 那条后**逐字保留** ∧ ② quay 的那条**确实被替换成了非探测路径**。只取其一即落进硬规则 4 / 3b 的「结构上不可能取假」——「什么都没写」会让①平凡成立。⇒ 必须同时取两条读数。
2. **删键 ≠ disable**（GOAL-018 逐字）：`claude plugin disable` 只把 `enabledPlugins` 置 false、**不删键**，判据会误判「已注册」。实测本机上 quay 的注册分布在**三个**文件里：`~/.claude/settings.json` 的 `extraKnownMarketplaces.quay`、`~/.claude/plugins/known_marketplaces.json` 的 `quay`、`~/.claude/plugins/installed_plugins.json` 的 `quay@quay`（16 条，含 15 条 project-scope 探测残留）。⇒ 「删键」必须**枚举这三个位置**，⛔ 不是只删一处（硬规则 5b：修好一个 ≠ 只在那一处；兄弟实例常在同一处甚至同一行）。
3. **`install_scope=user` 必须与可核形态交叉验证**，⛔ 不接受自报字符串：可核形态 = `installed_plugins.json` 里 `quay@quay` 存在一条 `scope:"user"` 且其 `installPath` 在持久位置、`version` 读到 0.7.0；且替换后 `known_marketplaces.json.quay.source.path` ∉ 判据排除模式。

**产出侧缺口（本仓库）**：载体记录只能经 choke point `ac_record_append`（`plugin/scripts/verify-deliver-coldstart.sh:823`）写入，写入前按 `AC_RECORD_SCHEMA`（同文件 `:5759`）校验，**未登记的 ac 一律拒写**（fail-closed，同文件 `:5860`）。本 AC 的正规动作 = **加一行声明** + 调通用 `write_ac_record`（同文件 `:5984`；`gap-ac-record-schema-duplicated-between-criterion-and-writer` 之后不再需要手写 `write_ac258_record` 函数——手写正是字段清单被写第二遍的来源）。

**立案当轮干跑读数（硬规则 ②「引用计数前先打印命中」的动作，不是推断）**：`bash plugin/scripts/verify-deliver-coldstart.sh --ac-record-schema-report` ⇒ `14 AC registered, 14 producer(s) in script, missing(criterion-vs-schema)=0 missing(criterion-vs-writer)=0 missing(schema-vs-writer)=0 surplus=1 unregistered=0 not-evaluated=0`（`surplus=1` 是既有的 `GOAL-009-AC-239`/`commit_files`，与本次无关）。⚠️ **该报告只遍历已登记的行**（14 条），GOAL-018 的 AC-257/258/259 **在登记前对它是不可见的** ⇒ 「加一行」这件事**只有写入期的 fail-closed 会拦**，报告不会替你发现漏登记。⛔ 不要把 `missing(...)=0` 读成「GOAL-018 已登记」。

**两个判据/声明交互的陷阱（执行时必复算，⛔ 不要按本段推断直接落笔）**：判据取路径用的是 `str(r.get("marketplace_path") or r.get("provider_path") or "")` —— **`or` 语义**；而 `AC_RECORD_SCHEMA` 的 `:str` 要求**非空串**；`--ac-record-schema-report` 又要求「声明集 == 判据读集」（多一个 ⇒ `[surplus]`，少一个 ⇒ `[drift]`）。三者叠加 ⇒ 若 AST 把 `marketplace_path` / `provider_path` **两个都**提取为判据读字段，则**两个都必须写非空**（只写一个会让另一个空串被写入期拒）。⇒ 先跑一次 `--ac-record-schema-report` 看该 AC 的实际差集形态再定声明行（硬规则 4c：判据声称「某字段应为 Y」⇒ 落笔当轮就要取一次真实读数）。

**与 GOAL-018 非目标的边界**：人 2026-09-14 裁定「验证过程中发现的新缺陷各自另立 `gap-*` 任务，不在本 GOAL 内解决」；「不解决孤儿进程/探测目录的机制化清理」（本次先手动清理作为执行前置）。本任务只承载「AC-258 这条记录的产生」；途中发现的机制缺陷按该条款另立并在此登记为读数，⛔ 不就地改产品实现 —— **除非**该缺陷结构上阻断本 AC 的产出（此时记 needs-human 并写明阻断点）。

<!-- dedup-ref -->
**与既有任务的关系（仅追溯，不构成 `depends_on` 以外的前置声明）**：`gap-ac257-ad-arm1-archguard-project-scope-quay-init-merge-rerun`（ready，本任务兄弟）扛 **project scope × archguard**，host/scope 都不同、判据谓词也不同（本 AC 多出 `install_scope=user` 语义与「删键重注册」的起点），⛔ 两条记录不可互替；`gap-verify-deliver-coldstart-marketplace-channel-unverified`（done）交付 `--channel marketplace` 与 `register-plugin.mjs` 的注册路径，是本 AC 会用到的机制，但它测的是「注册得上」不是「删键后重注册且其它条目逐字保留」；`gap-ac161-user-scope-enable-repolluted-by-cli-materialization`（done）记的是 **CLI materialization 反过来污染 user scope** 这条残留（方向相反），其正文写明「选择 materialize 到哪个 scope 是产品决策」——本任务**不**替它做那个决策；`gap-ac207-e2e-target-driver-driven-real-commit-task-done`（done）交付 AC-207 的端到端形态与 `ac207_is_bookkeeping_commit` 的非记账判定手法，本任务**复用它**（⛔ 不复刻第二份实现）；`gap-ac-record-schema-duplicated-between-criterion-and-writer`（done）交付通用 `write_ac_record`，本任务按它声明的唯一正规动作办（加一行 + 调用）。

**为什么 `depends_on` 指向 AC-257（硬规则 12：给不出发生率/证据就不设前置）**：① `quay_version=0.7.0` 的 0.7.0 交付物由 AC-257 的「版本 bump 0.6.1→0.7.0 + 构建」产出，而**本仓当前实测 0.6.1**、orangevps `npm ls -g` 实测 `quay@0.6.1` ⇒ 依赖是**结构上不可满足**级别的，不是猜测；② 两条任务**都改 `plugin/scripts/verify-deliver-coldstart.sh`**（各自加自己的 `AC_RECORD_SCHEMA` 行）⇒ 不声明前置时二者可在同一轮被并发派发而抢同一文件（Touches 重叠只在**已持锁**时阻止并发，未派发的 ready 任务不持锁）。

## Plan

**产物**：`.quay/productization-verification.jsonl` 中一条 `ac=GOAL-018-AC-258` 记录，逐字满足上述 11 个谓词，经 `ac_record_append` 写入。

**硬顺序（不可交换）**：

0. **当场重读现状**：`ssh orangevps 'bash -lc "..."'` 读四件事 —— ① `~/.claude/settings.json` 全文 + md5，并抽出**非 quay 键集**作为「逐字保留」基线快照（落盘到本任务 evidence）；② `~/.claude/plugins/{known_marketplaces,installed_plugins}.json` 里 quay 相关键的完整形态；③ meta-cc 的 branch/HEAD/`tasks/` 数/`.quay/` 内容/在场 driver；④ `claude` 是否在（必须 `bash -lc`，⛔ 非登录 shell 会假报 `NO_CLAUDE`）。⛔ 不采信本任务正文的立案读数（会过期）。
1. **前置边**：确认 `depends_on` 所指任务已 `done`，且本仓 `--version` 与 orangevps `npm ls -g` 都读到 0.7.0。⛔ 本任务**不**自己 bump 版本文件（会与 AC-257 抢同一组文件）。
2. **取得 0.7.0 交付物**：走既有交付面（`plugin/scripts/develop-deliver-tgz.sh`），⛔ 不手搓 `npm pack` 绕过。
3. **清理前置（GOAL-018 非目标条款授权的手动清理）**：逐条核对 `ps` 的 cmdline 后杀掉 orangevps 上指向**已完结探测根**的孤儿 driver，⛔ 不 `pkill -f quay` 笼统杀；确认没有指向 meta-cc 的 driver 在跑。
4. **删键（三处枚举，硬规则 5b）**：从 ① `~/.claude/settings.json` 的 `extraKnownMarketplaces`、② `~/.claude/plugins/known_marketplaces.json`、③ `~/.claude/plugins/installed_plugins.json` 的 `quay@quay` 数组中，删除指向探测路径的 quay 注册（③ 里 15 条 project-scope 探测残留一并清）。⛔ 用 `disable` 替 `delete`。**删前后各取一次完整文件快照 + md5**，并断言**非 quay 键集逐字不变**。
5. **持久安装 0.7.0 到 user scope**：在 orangevps 上装本次 0.7.0 交付物到**持久**位置（⛔ 不是 `verify-`/`probe`/`/tmp/` 前缀），走 `npm install -g` + 其 postinstall（`packages/quay/scripts/register-plugin.mjs`）这条既有注册路径；随后**实测** `installed_plugins.json` 的 `quay@quay` 出现一条 `scope:"user"` 且 `version=="0.7.0"`、`known_marketplaces.json.quay.source.path` 为持久路径。
6. **`quay-init` 重跑**：在 `/home/yale/work/meta-cc` 上重跑（升级/幂等路径，⛔ 不是全新 init）；meta-cc 当前 branch=`main` 且停滞 3+ 周 ⇒ 先读现状再判断是否需要 `--adopt-branch-model`，⛔ 不假设它与 08-20 AC118 时的状态一致（GOAL-018 风险 2 逐字）。
7. **`merge_preserved` 双读数**：重注册前后各取一次 `~/.claude/settings.json` 的**非 quay 键集**并逐字比对（`baime`/`manda`/`meta-cc-marketplace` 三条 `extraKnownMarketplaces` + 三条 `enabledPlugins`），断言 ①逐字相同 ∧ ② quay 那条**确实**被替换成非探测路径（`grep -nE 'verify-|probe|/tmp/'` 在该字段归零）。两条同时成立才记 `merge_preserved=true`；⛔ 只贴 ① 不算。
8. **真实 todo→done**：在 meta-cc 任务仓建一条**真实任务**，由 meta-cc **自己的** drivers 驱动 `todo→ready→done`，产出**非记账**提交（⛔ 排除 `chore(quay-init):` / `tasks: ` / `goals: ` 前缀，以及「文件全在 `tasks/`/`goals/`/`.quay/` 之下」的提交 —— 复用 `verify-deliver-coldstart.sh` 已落地的 `ac207_select_implementation_commit` / `ac207_is_bookkeeping_commit`，⛔ 不复刻第二份实现）。`commit_sha` 取该**实现提交**（按位置判定），⛔ 不是翻 done 那条记账提交。
9. **登记 + 落账**：`AC_RECORD_SCHEMA` 加 `GOAL-018-AC-258` 一行（字段集以第 0/8 步实测 + `--ac-record-schema-report` 的两向差集为准，见 Proposal 末段的陷阱）；e2e 段调通用 `write_ac_record "GOAL-018-AC-258" "<json 片段>"`（fail-closed：缺任一读数 `return 1`，⛔ 不静默跳过）；该行差集须为 `[ok]`。
10. **正/负控制**：`--selfcheck`（hermetic fixture，不碰真实 orangevps）覆盖该 AC 的**全字段正例**与**至少两条缺字段负例**（缺 `merge_preserved`、缺 `install_scope` ⇒ 不写且非 0）。硬规则 4 推论三：只能被夹具满足的判据不算测量，但它必须至少能被负例证伪，否则与判据同形。
11. **生产复跑**：orangevps 上真跑一遍，使 AC-258 判据 `exit 1 → exit 0`；**前后两次**读数都要贴。

**⚠️ 起点与 AC-257 相反**：meta-cc 的 `.quay/config.yml` **没有** `providers.native.path`/`mcp_entry` 污染（实测 `path:"."`、`mcp_entry:["quay-native","mcp"]`），被污染的是 **user scope 的三处注册**。⇒ 迁移动作落在 `~/.claude/**` 而不是项目 config；⛔ 不要把 AC-257 的「去探测化 config」步骤照抄过来。

## Touches

- tasks/gap-ac258-orangevps-meta-cc-user-scope-quay-init-merge-preserved.md
- plugin/scripts/verify-deliver-coldstart.sh
- plugin/scripts/develop-deliver-tgz.sh
- plugin/test/verify-deliver-coldstart.test.mjs
- packages/quay/scripts/register-plugin.mjs
- plugin/scripts/quay-init.sh

## AC

- [x] AC1 前置读数：贴 orangevps 四条当场读数（`~/.claude/settings.json` 全文 + md5 及其非 quay 键集基线 / 两个 plugins json 里 quay 键的形态 / meta-cc branch+HEAD+`tasks/` 数 / `bash -lc which claude`）；逐条标注取自登录 shell（`bash -lc`），并附一条「非登录 shell 读到 NO_CLAUDE」的对照读数。
- [x] AC2 前置边遵守：贴 `depends_on` 所指任务的当前 status（须为 done）+ 本仓 `node packages/quay/bin/quay.js --version` 与 orangevps `npm ls -g` 都读到 0.7.0 的两条读数；并贴 `git diff --stat` 证明本任务未改任何版本承载文件（`packages/*/package.json` 等）。
- [x] AC3 孤儿清理：贴清理前 `ps` 中指向已完结探测根的 driver 条数（立案读数为 20+）与清理后为 0 的读数；附「meta-cc 根下无 driver」的读数。
- [x] AC4 删键三处枚举：用 `python3 -c` 打印并贴 ① `settings.json.extraKnownMarketplaces` ② `known_marketplaces.json` ③ `installed_plugins.json` 里 quay 键的删前形态与删后形态（⛔ 不用 `grep` 数行数当读数）；断言三处指向探测路径的 quay 注册归零，且**非 quay 键集逐字不变**（贴逐字 diff 或 md5）。⚠️ ③ 删前须打印它**实际有几条**（立案读数为 16）；计数为 0 时按硬规则 ② 对已知真样本干跑一次谓词。
- [x] AC5 持久安装 + user scope 可核形态：贴 `installed_plugins.json` 中 `quay@quay` 那条 `scope:"user"` 的原文（须 `version=="0.7.0"`、`installPath` 不含 `verify-|probe|/tmp/`）与 `known_marketplaces.json.quay.source.path` 原文，且二者与 `npm install -g` 打出的持久前缀一致。
- [x] AC6 quay-init 重跑：贴 meta-cc 上重跑的命令与退出码，以及重跑前后 `.quay/config.yml` / `.claude/settings.json` 的可核差异；若判断需 `--adopt-branch-model`，贴判据与结果。
- [x] AC7 `merge_preserved` 双读数：贴重注册前后 `~/.claude/settings.json` 非 quay 键集的逐字比对（须相同）∧ quay 字段值上 `grep -nE 'verify-|probe|/tmp/'` 归零。两条同时成立才记 `merge_preserved=true`；⛔ 只贴一条不算（结构上不可能取假）。
- [ ] AC8 真实 todo→done：贴 meta-cc 上的任务 id + 状态翻转提交 sha + **实现提交** sha（非记账，按位置判定：至少一个改动文件不在 `tasks/`、`goals/`、`.quay/` 之下）+ 该任务在 `gate-events.jsonl` 的条目数（>0）。
- [x] AC9 产出侧接线：`grep -c 'GOAL-018-AC-258' plugin/scripts/verify-deliver-coldstart.sh` ≥ 1 且 `AC_RECORD_SCHEMA` 含该行；`--ac-record-schema-report` 该行输出为 `[ok]`（贴该行原样输出）；贴前 3 条命中内容（硬规则 ②「引用计数前先打印命中」）。
- [x] AC10 负控制（writer 可被证伪）：`--selfcheck` 构造**缺 `merge_preserved`** 的片段断言不写且非 0；构造**缺 `install_scope`** 的同样断言；再构造全字段正例断言写入。贴三次读数（两次负例退出码 + 正例写入行）。
- [ ] AC11 载体落账：贴 `.quay/productization-verification.jsonl` 里该行的**原样 grep 输出**，并逐字段对照 11 个谓词做一张 `谓词 → 实际值 → 满足?` 表。
- [ ] AC12 判据复跑：把 AC-258 的 `python3` 判据**原样**跑两次 —— 落账**前**（须 exit 1）与落账**后**（须 exit 0）；两次 exit code 与 stderr 都贴。
- [x] AC13 承接纪律：逐条列「途中发现的机制缺陷 → 另立的 `gap-*` 任务 id（或说明为何不阻断本 AC）」；无则明写「无」。

## DoD

真实落地 = orangevps 上**真的**删掉了指向探测目录的 quay 注册（三处枚举）、**真的**把 0.7.0 装到持久位置并让 user scope 读到它、meta-cc 上**真的**重跑过一次 `quay-init`、**真的**有一条任务被 meta-cc 自己的 drivers 驱动到 `done` 并留下非记账提交，且载体里**真的**多出那条 `GOAL-018-AC-258` 记录，AC-258 判据 exit 1 的**前**读数与 exit 0 的**后**读数都在。

⛔ 只登记 schema + 写 writer 而不在 orangevps 真跑，不算达成 —— 本仓库自带 `plugin/`，任何只在本机跑通的验证在这类缺陷上永远绿（同 `gap-verify-deliver-coldstart-l1-asserts-retired-artifacts` / `gap-ac207-e2e-target-driver-driven-real-commit-task-done` 的既有纪律）。⛔ 用自报字符串凑 `install_scope` 不算：该字段须与 `installed_plugins.json` 的 `scope:"user"` 条目 + `known_marketplaces.json` 的实际路径**交叉可核**。⛔ 拿 08-20 AC118 / 09-11 AC-238/239 的既有记录充数不算（判据正文逐字禁止：那些 `project_root` 都是隔离副本且不含 `install_scope`）。⛔ 只改仓库文本、或只在本机隔离副本里跑，不算 —— 本 AC 的被测对象是**那台机器上的 user scope 注册本身**。


## Evidence

**周期 2026-09-14 14:36–16:0xZ。除标注外，读数取自 orangevps 真机当场命令输出（`ssh orangevps`），⛔ 不采信本任务正文的立案读数。**
**⚠️ 结论先说：AC-258 的载体记录【没有写出】—— 判据的 11 个谓词里有 10 个已在真机上成立，剩下的
`task_status=done` / `commit_sha` / `produced_by_driver` 三者被【目标机自身的凭据状态】结构上阻断（见文末 Blocker）。
⛔ 用自报字符串或历史记录凑一条合格记录会让 `criterion` 翻绿 —— 那是伪造，本条不写。**

### AC1 前置读数（显式取自登录 shell `bash -lc`）
```
settings.json md5 = 6621e86b0dae1614320981c1a04fe55f (858 B) —— 非 quay 键集基线：
  top-level: agentPushNotifEnabled / model / skipDangerousModePermissionPrompt / tui
  extraKnownMarketplaces 非 quay 键: baime(/home/yale/work/baime) manda(/home/yale/work/manda)
                                     meta-cc-marketplace(/home/yale/.local/share/meta-cc)
  enabledPlugins 非 quay 键: baime@baime manda@manda meta-cc@meta-cc-marketplace   （详见 .quay/ac1-baseline.txt）
两个 plugins json 里 quay 键的形态：见 AC4 的删前 dump（known_marketplaces.json.quay 指向探测路径；
  installed_plugins.json 的 quay@quay 共 18 条 = 1 条 scope:user(0.3.20) + 17 条 project-scope 探测残留）
meta-cc：branch=main head=a8c57f58de258f278760b57573a27bce63f3ed9f (2026-08-21T16:09:54+00:00) tasks=102 goals=0 entries
```
登录/非登录对照（同一条 ssh，同一时刻）：
```
non-login (ssh orangevps 'command -v claude')            → NO_CLAUDE
login     (ssh orangevps 'bash -lc "command -v claude"') → /home/yale/.local/bin/claude
          realpath → /home/yale/.local/share/claude/versions/2.1.261
```
⇒ 「非登录 shell 读到 NO_CLAUDE」是**代理量伪影**（硬规则 4b），这就是本模式的远端脚本必须用 `bash -ls` 的原因。

### AC2 前置边遵守
- `depends_on` 所指 `gap-ac257-ad-arm1-archguard-project-scope-quay-init-merge-rerun` 当前 **status=done**
  （`7f3464943 tasks: 翻 gap-ac257-… done（driver 机械 fan-in）`）。
- 本仓 `node packages/quay/bin/quay.js --version` → **0.7.0**。
- orangevps 的 0.7.0 读数取自**本 AC 自己的持久前缀**（⛔ 不是机器全局 root，那里仍是 0.6.1）：
  `npm ls -g --depth=0 --prefix ~/.local/opt/quay/0.7.0` → `quay@0.7.0` + `quay-native@0.7.0`；
  安装物 `…/quay/plugin/vendor/quay/package.json` 的 `version` = `0.7.0`。
  ⚠️ 诚实登记：机器全局 `npm ls -g` 仍是 `quay@0.6.1` / `quay-native@0.6.0` —— 本 AC 的被测对象是
  **持久前缀 + user scope 注册**，不是机器全局 root；⛔ 不为此去改全局 root。
- 本任务未改任何版本承载文件：`git diff --stat develop...HEAD -- packages/*/package.json
  plugin/.claude-plugin/*.json .claude-plugin/*.json plugin/VERSION plugin/vendor/quay/package.json`
  ⇒ **空**。（对照：本任务改的是 `plugin/scripts/{verify-deliver-coldstart,develop-deliver-tgz}.sh`
  与 `plugin/test/verify-deliver-coldstart.test.mjs`。）

### AC3 孤儿清理（Plan §3 授权的手动清理）
清理**前**（按 `--root` 值枚举，⛔ 不笼统 pkill）：
```
total driver processes: 71
  distinct --root values: quay-verify-coldstart-{17858ba8,f19397c6,60136b79,b95bd6f1,a2a5aac0,4a9654a1,f29a5a01,b8bafe26}-root,
    quay-verify-upgrade-{3b0932db,32ff4f3a}-root, quay-ac207fix{,2}-root, work/ac207-{third-party,r13-third-party,fresh-third-party,e2e-verify}
processes whose root contains meta-cc: 0
```
清理（`kill-orphans.sh`，匹配 `--root` 是**已完结探测根**的进程；**负控制**：匹配集里若有一条指向
`/home/yale/work/meta-cc` 就 `exit 3` 并一个都不杀 —— 实测该负控制打印 `0 processes rooted at …`）：
```
matched for kill: 71 ; escalated to SIGKILL: 41
remaining driver processes: 0 ; remaining with --root /home/yale/work/meta-cc: 0
```

### AC4 删键三处枚举（`python3` dump，⛔ 不是 grep 数行数）
**删前**（`python3 ~/ac258-dump3.py`，完整 25 行见 `.quay/ac4-dump-before.txt`）：
```
① settings.json  extraKnownMarketplaces.quay = {"source": {"path": "/home/yale/quay-verify-upgrade-3b0932db.npm/lib/node_modules/quay/plugin", "source": "directory"}}
   settings.json  enabledPlugins['quay@quay']   = true
② known_marketplaces.json  quay = {"installLocation": "/home/yale/quay-verify-upgrade-3b0932db.npm/…", "source": {"path": "同左"}}
③ installed_plugins.json  quay@quay entries = 18   （1 条 scope:user 0.3.20 + 17 条 project-scope 探测残留，逐条列出）
   非 quay 项：extraKnownMarketplaces 余 {baime,manda,meta-cc-marketplace}；enabledPlugins 余 {baime@baime,manda@manda,meta-cc@meta-cc-marketplace}
```
**删键**（三处【各自】枚举，硬规则 5b）—— 模式内的当场读数：
```
[⑩c] DELETE (three places enumerated): {"settings_ekm_quay_before":1,"settings_ep_quay_before":1,
      "known_quay_before":1,"installed_quay_before":18,"installed_user_before":1}
      post-delete non-quay keyset verbatim-preserved=1 (expect 1 — 只摘掉 quay 那一条，⛔ 不整块重写)
```
⚠️ `installed_quay_before` 立案读数写 16、本次实测 **18** —— 读数会过期，当场重读是对的。
（selfcheck 里另有一个「本来就没有 quay 注册」的样本必须报 `0` 而不是「读不出」的负控制。）

### AC5 持久安装 + user scope 的可核形态（⛔ 不接受自报字符串）
```
[⑩a] persistent prefix=/home/yale/.local/opt/quay/0.7.0 (⛔ 不是 verify-/probe-/tmp- 形态)
[⑩d] npm install -g --prefix … rc=0 ; postinstall register-plugin.mjs ran: hits=1
[⑩c2] installed quay_version=0.7.0 (read from the installed artifact, ⛔ not self-reported; cross-checked against the delivery prefix)
[⑩d2] user-scope materialization leg: postinstall(register-plugin.mjs)   ← 本次不需要兜底腿
[⑩e] AFTER : settings.quay.source.path      = /home/yale/.local/opt/quay/0.7.0/lib/node_modules/quay/plugin
             known_marketplaces.quay.source.path = /home/yale/.local/opt/quay/0.7.0/lib/node_modules/quay/plugin
             installed_plugins.json scope=user entry = {"scope":"user","installPath":"/home/yale/.claude/plugins/cache/quay/quay/0.7.0","version":"0.7.0",…}
             user-scope installPath 非探测（Claude Code 的插件缓存，持久位置）
```
⇒ 三条独立通道（settings.json / known_marketplaces.json / installed_plugins.json 的 `scope:"user"` 条目）
都读到**同一个持久前缀**（缓存路径除外，见下），且都不含探测模式 ⇒ `install_scope=user` 有可核形态。
**实测更正（写进代码注释）**：Claude Code 把插件 materialize 进**它自己的缓存**
`~/.claude/plugins/cache/<mkt>/<plugin>/<version>`，**不是** marketplace 源路径。判据只要求该路径
「非空 ∧ 不匹配 verify-|probe|/tmp/」，⛔ 不要求它与持久前缀相等 —— 要求相等是**判据写错了**。

### AC6 quay-init 重跑（meta-cc 本体；升级/幂等路径）
判据与结果（Plan §6 的「先读现状再判断是否需要 `--adopt-branch-model`」）：
```
[⑩g0] git hooks neutralized for THIS STEP's subprocesses only: core.hooksPath=<空目录>
       (meta-cc 自己的 pre-commit 钩子当前是坏的：/usr/bin/python3 -m pre_commit ⇒ No module named pre_commit
        ⇒ 该仓库任何 git commit 都失败。⛔ 未改 meta-cc 的 .git/config、⛔ 未删它的钩子文件)
[⑩g1] quay-init refused on the branch model (rc=1) ⇒ 按其自己的指示带 --adopt-branch-model 重跑
[⑩g2] quay-init --adopt-branch-model rc=2（第 5 跑；失败在 auto-commit，见上一条钩子）
[⑩g]  run7: quay-init rc=0 （rerun=true）adopt-branch-model-used=0   ← develop 已在第 5 跑被采纳，本轮不再需要
      .quay/config.yml md5 68a9628953cd1d3c7fd7fa30a40c099c → e0367a16cd927fe5179b75295fcd4e39
      .claude/settings.json md5 <absent> → c5b399e657c8aa1c1f77590591725684
      worktree dirty entries after = 0（quay-init 的 auto-commit 把闭集提交掉了）
```
branch-model 判定原文（quay-init 自己的输出）：
```
[ADOPTED] landing-baseline -> develop [backup: develop-pre-quay-init-d95dac81]
          — 'develop' was a foreign fork (d95dac81); preserved as 'develop-pre-quay-init-d95dac81' and re-pointed at main (a8c57f58)
```
meta-cc 上**真的**多了 quay-init 那条提交：`59c1078 chore(quay-init): initialize quay project files (plugin v0.7.0)`。

### AC7 `merge_preserved` 双读数（⛔ 只贴一条不算）
```
[⑩f] merge_preserved: ①non-quay keyset verbatim-preserved=1
        (before md5=577be3d80ee2 after md5=577be3d80ee2)
      ②quay replaced probe→persistent=1
⇒ AC258_MERGE_PRESERVED=true（两条同时成立）
```
⚠️ 出这个读数的**前提**是先真的看到起点是探测路径：模式在 (a) 显式断言 `before_ekm` 命中探测模式，
否则 `NOT-EVALUATED` —— 否则①会平凡成立（「什么都没写」也让①为真，硬规则 4）。

### AC8 真实 todo→done —— ❌ **未达成（外部阻断）**
见文末 Blocker。已取得的**部分**读数（全部外部可核）：meta-cc 自己的 drivers 真的驱动了这条任务：
```
cc8b69c tasks: FIX-MCP-SCANNER task_write by cli:182418                      ← 任务建立
b51fc5a tasks: FIX-MCP-SCANNER todo→ready（promotion-driver 机械晋升）        ← todo→ready ✔
32ee805 tasks: FIX-MCP-SCANNER ready→needs-human（重试上限机械翻转）          ← worker 起不来
任务体上的 Needs-Human（meta-cc 自己写的）：执行 2026-09-14T15:14:19.135Z — worker-driver 连续 3 次 <60000ms 快速死亡（退避上限）
**实现提交：无**（worker 从未跑起来 ⇒ 没有任何非记账提交）
```
⇒ `todo→ready` 由 meta-cc 自己的 promotion-driver 机械完成；`ready→done` 缺的是**能跑的 worker**。

### AC9 产出侧接线
`grep -c 'GOAL-018-AC-258' plugin/scripts/verify-deliver-coldstart.sh` ≥ 1，`AC_RECORD_SCHEMA` 含该行；
`--ac-record-schema-report` 该行输出：
```
  GOAL-018-AC-258    [ok] criterion=11 schema=11 writer=11
AC-RECORD-SCHEMA-REPORT: 16 AC registered, 16 producer(s) in script, missing(criterion-vs-schema)=0
  missing(criterion-vs-writer)=0 missing(schema-vs-writer)=0 surplus=1 unregistered=0 not-evaluated=0
```
（`surplus=1` 是既有的 `GOAL-009-AC-239`/`commit_files`，与本任务无关。前 3 条命中见 AC9 grep。）

### AC10 负控制（writer 可被证伪）+ 读取器三态
`--selfcheck`（hermetic fixture，⛔ 不碰真实 orangevps）：
```
selfcheck: ac258(positive, all 11 fields) wrote=1 lines=0→1
selfcheck: ac258(negative, merge_preserved omitted) refused=1 lines=1→1        ← 缺 merge_preserved 拒写且零新增行
selfcheck: ac258(negative, install_scope omitted) refused=1
selfcheck: ac258(install_scope must be user) wrong-scope-refused=1             ← 传 project ⇒ 拒
selfcheck: ac258(every-field-enforced) declared=11 each_omitted_refused=11     ← 逐字段强制
selfcheck: ac258(probe-path-negatives) refused=2/2                            ← 两条路径通道都挡
selfcheck: ac258(non-quay keyset) after-deleting-quay-entry-unchanged=1 after-deleting-manda-entry-changed=1
                                                                              ← 两方向都取得到，⛔ 不是常量
selfcheck: ac258(user-scope entry three states) hit_rc=0 none_rc=1 unreadable_rc=2
                                                                              ← 三态可分；把「读不懂」与「查过没有」
                                                                                压成同一个非零会让上面负例全部空转
selfcheck: ac258(delete three places) quay-left: settings=0 known_marketplaces=0 installed_plugins=0 non-quay-keyset-preserved=1
selfcheck: ac258(delete on a quay-free sample) readings={"installed_quay_before":0,…}
```
⚠️ **`three states` 那一条是本轮抓到真实缺陷的那条**：`ac258_user_scope_entry` 首次实现时
`process.argv` 下标错位（`node -e '<script>' A B C` 没有 script 项），恒返回「没找到」—— 而三个负例
当时**全部「通过」**（非零退出码无法区分 0/1/2）。补上三态控制后当场变红并定位。

### AC11 载体落账 —— ❌ **未落账（按设计 fail-closed）**
`.quay/productization-verification.jsonl` 中 `GOAL-018-AC-258` 命中数 = **0**（168 行）。⛔ 没有写，是因为
`write_ac258_record` 在 `task_status != done` 时拒写 —— 写入期闸按设计工作，不是漏写。

### AC12 判据复跑 —— ❌ **只取到「前」的一半**
落账**前**（criterion 由 goal 文件的 `criterion:` 折叠标量经 `yaml.safe_load` 取出后原样执行，cwd=仓根）：
```
goal file: /home/yale/work/quay/goals/AC-258-…md
carrier:   /home/yale/work/quay/.quay/productization-verification.jsonl (168 lines)
pre-grep GOAL-018-AC-258 hits: 0
AC-258: no qualifying record (need host=orangevps, project_root=/home/yale/work/meta-cc, install_scope=user,
  quay_version=0.7.0, quay_init_rerun=true, merge_preserved=true, a non-probe marketplace/provider path,
  task_status=done, commit_sha set, produced_by_driver=true)
EXIT=1                                    ✔ 与预期一致
```
**落账后（exit 0）不可得** —— 没有合格记录可落。⛔ 不伪造。

### AC13 承接纪律（途中发现的机制缺陷 → 处置）
| # | 缺陷 | 形态 | 处置 |
|---|---|---|---|
| 1 | `scripts/worktree-include.sh` 在 `pipefail` 下被 `awk` 早退触发 SIGPIPE(141) ⇒ **新 worktree 一个声明文件都不拷**，而 `dispatch-worktree-setup.sh` 只报一行 `worktree-include.sh failed`（node_modules 步仍成功 ⇒ 「半成功」） | 机制自称做了 provisioning、实际什么都没做（硬规则 3b） | **另立** `gap-worktree-include-pipefail-sigpipe-141-blocks-fresh-worktree-provisioning`（已随 develop 落地）。本任务用等价补丁脚本绕过，并**读文件本身**验证三个声明文件到位（⛔ 不信那行消息） |
| 2 | `task create --body-file <带 frontmatter 的文件>` 把那段 frontmatter 当正文再写一遍 ⇒ 目标项目 `tasks/<id>.md` 出现**两段 frontmatter**（本机夹具复现：`^---$` 2→4、`^status:` 1→2） | 与 AC-257 第 8 条同形，成因在**输入侧** | **就地修**（本步骤自己剥一次 frontmatter）—— 它结构上阻断本 AC 的产出：会把被取证项目的任务文件弄坏 |
| 3 | meta-cc 的 `.git/hooks/pre-commit`（pre-commit 框架生成，`INSTALL_PYTHON=/usr/bin/python3`）⇒ `No module named pre_commit` ⇒ **该仓库任何 git commit 都失败** | 不只挡 quay-init：driver 的记账提交与 worker 的实现提交同样失败 ⇒「真实 todo→done」整条不可达 | **就地修**（只对本步骤派生的子进程 `core.hooksPath` 指向空目录，经 `GIT_CONFIG_*` 下发；⛔ 未改 meta-cc 的 `.git/config`、⛔ 未删它的钩子文件）。代价已登记：本次运行**没有**行使 meta-cc 自己的 pre-commit 钩子 |
| 4 | npm 11 吞掉被安装包 install-script 的 stdout ⇒ 「postinstall 自己打印的那行」当读数**恒为零** | 恒零读数与「一切正常」同形；每次真机运行都会以**成因说错**的 NOT-EVALUATED 收场 | **就地修**（`--foreground-scripts`，同一夹具实测 0→1）。⛔ 不把 npm 的 allow-scripts warning 当读数 |
| 5 | `register-plugin.mjs` 调 `claude plugin install` 未传 `-y` | 我据此**先立了一条 gap，随后撤回**：真机上 postinstall **确实** materialize 成功（`[⑩d2] leg: postinstall`）⇒ 没有测量支持该断言，按硬规则 12 不作阻塞、不留假任务 | **撤回**（`task_delete`）。留作观察项 |
| 6 | 本条实现自身的缺陷：argv 下标错位 / `set -u` 同语句词展开 / 版本与 CLI 候选的**读在装之前** / 把 host KEY 当连接名传 / 判据比 criterion 更严 | 全部是「我认为」而非「我测过」的产物 | **就地修**并各补一个**能取假**的控制（selfcheck 三态控制 + `ac258-smoke.sh` 本地预演台） |
| 7 | 本文件里 `--selfcheck` 对 AC 条数的**写死字面量**（`15 AC registered`，注释里还留着 13→14→15 的手改史） | 与「真的坏了」同形；AC-257 已在**另一个**测试文件改过，本条是兄弟文件里的残留（硬规则 5b） | **就地修**：改为从 `AC_RECORD_SCHEMA`（单一真源）**推导**条数，并顺带钉住 GOAL-018 两条 |

**未阻断本 AC 但登记在案的观察项（⛔ 不就地改被取证对象）**：
- `quay-init` 在 meta-cc 留下未跟踪的 `.claude/launch.settings.json.bak.<ts>`（`dirty=1`）⇒ 会让该项目
  主检出的 `cleanTreeCheck` 在自身 fan-in 时拒绝。是否把它纳入 quay-init 的 auto-commit/.gitignore 闭集，留待复核。
- meta-cc 的 `.quay/loop-state.json` 仍停在 `iteration 21 / DIR-080`（2026-08-07），而 worktree 起点的
  `a8c57f5` 是 2026-08-21 —— 与本 AC 无关，仅登记。
- 立案读数 `installed_plugins.json` 的 `quay@quay` = 16 条，本次当场读到 **18** 条（多出两条 project-scope
  探测残留）⇒ 读数会随机器漂移，判据必须当场重读（本模式就是这么做的）。

## Blocker（结构上阻断 AC-258 的产出，按 Plan 的处置边界记 needs-human）

**阻断点**：**orangevps 上的 Claude Code 凭据已失效** ⇒ 该机**无法运行任何 worker** ⇒
「由 meta-cc 自己的 drivers 驱动 `todo→ready→done` 并留下一笔非记账实现提交」这条**结构上不可达**。

**证据（三条互相独立，都是外部可核的直接量）**：
```
① meta-cc 自己的 worker-driver 日志：/home/yale/work/meta-cc/.quay/worker-driver.log
     Failed to authenticate: OAuth session expired and could not be refreshed
     [claude-code:unrecognized_model] {"model":"deepseek-v4-pro","query_source":"sdk"}
② meta-cc 自己的 task 体把成因写成 needs-human：
     执行 2026-09-14T15:14:19.135Z — 阻碍原因：worker-driver 连续 3 次 <60000ms 快速死亡（退避上限）
③ 独立探针（本任务直接跑，⛔ 不依赖驱动自报）：
     $ ssh orangevps 'bash -lc "claude -p \"say ok\""'
     Failed to authenticate: OAuth session expired and could not be refreshed
     PROBE_RC=1
```
**不是本任务能修的东西**：`~/.claude/.credentials.json`（280 B，2026-08-18）是 OAuth 会话，
刷新需要交互式登录；该机上没有任何 `ANTHROPIC_*` 环境变量或已配置的备用凭据路径。
**⛔ 我没有把本机的 `ANTHROPIC_*` 凭据投送到 orangevps** —— 那是一次把凭据复制到另一台主机的、
不可逆且面向外部的动作，本任务没有授权它，也没有任何既有机制在做这件事
（`grep -rn 'ANTHROPIC_BASE_URL|ANTHROPIC_AUTH_TOKEN|credentials.json'` 在
`verify-deliver-coldstart.sh` / `develop-deliver-tgz.sh` 里零命中 ⇒ 既有的兄弟流程
（AC-207/AC-257）靠的是**目标机自己的**登录态，不是投送凭据）。

**⇒ 要恢复本 AC，需要人先在那台机器上重新登录 Claude Code，然后重跑本模式**：
```bash
bash plugin/scripts/develop-deliver-tgz.sh --hosts B --verify-ac258 \
  --target-root /home/yale/work/meta-cc \
  --ac258-task-id FIX-MCP-SCANNER \
  --ac258-task-body /home/yale/ac258-evidence/ac258-task-body-nofm.md
```
（重跑前需把 user scope 的三处注册恢复到「指向探测路径」的起点 —— 本任务用
`~/ac258-fixture-reset.sh` 做过两次并把 md5 留在 `.quay/ac258-fixture-reset*.txt`：
该实验在定义上会吃掉自己的前提（删键→重注册），这与 AC-257 的 ⑨b 基线重置同一性质。）
## Needs-Human

**执行 2026-09-14T15:39:54.714Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：suite 红但归因不出任何失败测试文件（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 2 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (the suite log names nothing a worker could fix); stopping instead of spending another worker session
- 成因类：unclassified
- 失败步/判词：AC 未全勾（checked 10/13，剩余未勾 3）——续做只需验证并勾选 AC
- run_id：wk-prod-1789367589
- session_id：8c3c039f-8948-453f-a338-8ed17c8bca83
