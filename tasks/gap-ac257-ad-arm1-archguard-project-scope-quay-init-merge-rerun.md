---
id: gap-ac257-ad-arm1-archguard-project-scope-quay-init-merge-rerun
title: ad-arm1/archguard 真机重验：project scope 装 0.7.0 + quay-init 重跑（非空
  settings.json 合并语义）+ 真实 todo→done（GOAL-018/AC-257）
status: ready
labels:
  - gap
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-257
---
## Proposal

**要满足的判据（正本 `goals/AC-257-ad-arm1-archguard-project-scope-装-0-7-0-quay-init-重跑-非空-sett.md`）**：载体 `.quay/productization-verification.jsonl` 中存在一条记录，逐字满足 11 个谓词 —— `ac=GOAL-018-AC-257` ∧ `host="ad-arm1"` ∧ `project_root="/home/yale/work/archguard"` ∧ `install_scope="project"` ∧ `quay_version="0.7.0"` ∧ `quay_init_rerun is True` ∧ `merge_preserved is True` ∧ (`marketplace_path`|`provider_path`) 非空且**不**匹配 `verify-|probe|/tmp/` ∧ `task_status="done"` ∧ `commit_sha` 非空 ∧ `produced_by_driver is True`。exit 1 = 载体缺失或无合格记录。判据正文另逐字禁止引用 GOAL-016/AC-247..250 的历史记录充数（本 AC 要求 `install_scope` 与 `merge_preserved`，这两字段既往记录从未出现）。

**立案当轮实测（2026-09-14，直接 ssh ad-arm1 与本地 grep 读到，非推断）**：

| 读数 | 实测值 |
|---|---|
| 载体 `GOAL-018` 命中数 | **0**（`grep -c GOAL-018 .quay/productization-verification.jsonl`，共 157 行全属 GOAL-009/015/016） |
| `install_scope` / `merge_preserved` 全仓命中 | **0** ⇒ 产出侧 writer 从未存在，本 AC 从未被行使 |
| 仓库版本 | **0.6.1**（`node packages/quay/bin/quay.js --version`）⇒ `quay_version=0.7.0` 结构上不可满足 |
| ad-arm1 的 `claude` | **在**：`/home/yale/.local/bin/claude -> .../versions/2.1.238`。⚠️ **非登录 shell 的 PATH 里没有它** —— `ssh ad-arm1 'which claude'` 返回 NO_CLAUDE 是**非登录 shell 伪影**，`bash -lc` 才读到（硬规则 4b：代理量 vs 直接量） |
| ad-arm1 `installed_plugins.json` | `quay@quay` **只有 scope=user** 一条，installPath `~/.claude/plugins/cache/quay/quay/0.4.0` |
| ad-arm1 `known_marketplaces.json` | 只有 `claude-plugins-official`，**无 quay 条目** |
| archguard `.claude/settings.json` | 263 B，**只有** `hooks.Stop`（`npm run check:adr \| grep -E 'violation\|VIOLATION'`），**无 `enabledPlugins`**；项目内 `.claude/plugins/` 不存在 |
| archguard `.quay/config.yml` | `providers.native.path` 与 `mcp_entry` 均指向 `/home/yale/quay-verify-takeover-1d916698.npm/...` ⇒ **命中判据的 `verify-` 排除模式**，必须迁移到持久路径 |

**机制缺口（本 AC 的实质）**：`plugin/scripts/quay-init.sh:2605` 对**已存在**的 `.claude/settings.json` 的行为是跳过：不带 `--force` ⇒ 只打印一句 note 然后 `return`，什么都不写；带 `--force` ⇒ 走 `json.load` + `setdefault` 合并（`hooks.Stop` 按构造保留）。**「非空、非 quay 自己写的 settings.json 上合并语义真的成立」这条分支从未在任何真实项目上被行使过** —— GOAL-018 选 archguard 正是因为它有这条非空 Stop hook。

⚠️ **`merge_preserved=true` 必须由两条同时成立的读数支撑**，只取其一即落进硬规则 4 / 3b 的「结构上不可能取假」：① 重跑后 `hooks.Stop` 段与原文件**逐字相同**；② 重跑**确实写入了** quay 的 `enabledPlugins` 键。否则「不带 `--force` ⇒ 什么都没写」会让①平凡成立。

**产出侧缺口**：载体记录只能经 choke point `ac_record_append`（`plugin/scripts/verify-deliver-coldstart.sh:823`）写入，该函数先按 `AC_RECORD_SCHEMA`（同文件 :196 起）校验片段，**未登记的 AC 一律拒写**（fail-closed）⇒ 本任务必须同时登记 schema 行 + 写 `write_ac257_record()`，并保持 `--ac-record-schema-report` 的两向差集为 `[ok]`。

**与 GOAL-018 非目标的边界**：人 2026-09-14 裁定「验证过程中发现的新缺陷各自另立 `gap-*` 任务，不在本 GOAL 内解决」。本任务只承载「AC-257 这条记录的产生」；途中发现的机制缺陷按该条款另立并在此登记为读数，⛔ 不就地改产品实现 —— **除非**该缺陷结构上阻断本 AC 的产出（此时记 needs-human 并写明阻断点）。

<!-- dedup-ref -->
**与既有任务的关系（仅追溯，不构成前置声明）**：`gap-ac207-e2e-target-driver-driven-real-commit-task-done`（done）交付 GOAL-009-AC-207 的端到端形态与 `commit_files` 非记账判定 —— 本 AC 是一组**不同的谓词**（多出 `install_scope`/`merge_preserved`/`quay_version`，且 host 取字面 `ad-arm1` 而非 `C`），不接受其记录充数；`gap-ac161-user-scope-enable-repolluted-by-cli-materialization`（done）与 `gap-ac161-user-level-marketplace-only`（done）管的是 **user scope 被污染**这条机制，方向相反，机制不同；`gap-verify-deliver-coldstart-marketplace-channel-unverified`（done）交付 `--channel marketplace` 与当时「B/C 无 claude」的读数 —— 本立案当轮复测**该读数已过期**（claude 在，只是不在非登录 PATH）。

## Plan

**产物**：`.quay/productization-verification.jsonl` 中一条 `ac=GOAL-018-AC-257` 记录，逐字满足上述 11 个谓词，经 `ac_record_append` 写入。

**硬顺序（不可交换）**：

0. **当场重读现状**：`ssh ad-arm1 'bash -lc "..."'` 读三件事 —— quay 插件注册形态（`~/.claude/plugins/{installed_plugins,known_marketplaces}.json`）、archguard `.claude/settings.json` 的内容与 md5、archguard `.quay/config.yml` 的 provider 路径。⛔ 不采信本任务正文的立案读数（会过期）。
1. **版本 bump 0.6.1→0.7.0**：见下方「两清单漂移」注。以**两个清单的并集**为准：`packages/quay{,-native,-github,-backlog}/package.json`、`.claude-plugin/marketplace.json`、`plugin/.claude-plugin/marketplace.json`、`plugin/.claude-plugin/plugin.json`、`plugin/VERSION`、`plugin/vendor/quay/package.json`。
2. **构建 0.7.0 交付物**：走既有 `plugin/scripts/develop-deliver-tgz.sh`（⛔ 不手搓 `npm pack` 绕过交付面）。
3. **ad-arm1 上做 project-scope 安装**：quay 插件装到**持久**位置（⛔ 不是 `verify-`/`probe`/`/tmp/` 临时 npm 前缀），并让**项目级** `.claude/settings.json` 出现 quay 的 `enabledPlugins` 键。GOAL-018 正文把 project scope 的可核形态锚在「项目级 `.claude/settings.json` 的 `enabledPlugins` 键」上（原句：quay-init 重跑必须把 `enabledPlugins` **合并**进去而不覆盖已有内容）—— 以该句为准，不是以 `installed_plugins.json` 里某个 scope 字符串为准。
4. **`quay-init` 重跑（合并语义）**：在 archguard 上重跑，取「① `hooks.Stop` 逐字保留 ∧ ② quay 键新增」双读数。
5. **provider 路径去探测化**：把 archguard `.quay/config.yml` 的 `providers.native.path` / `mcp_entry` 从探测目录改到持久安装位置，并**实测**该路径可用（真能列到 archguard 自己的任务）。
6. **真实 todo→done**：在 archguard 任务仓建一条**真实任务**，由项目自己的 drivers 驱动 `todo→ready→done`，产出**非记账**提交（⛔ 排除 `chore(quay-init):` / `tasks: ` / `goals: ` 前缀，以及「文件全在 `tasks/`/`goals/`/`.quay/` 之下」的提交 —— 沿用 `verify-deliver-coldstart.sh` 已落地的 `ac207_select_implementation_commit` / `ac207_is_bookkeeping_commit` 判定手法，⛔ 不复刻第二份实现）。
7. **登记 + 落账**：`AC_RECORD_SCHEMA` 加 `GOAL-018-AC-257 host:str project_root:str install_scope:str quay_version:str quay_init_rerun:bool merge_preserved:bool marketplace_path:str task_status:str commit_sha:str produced_by_driver:bool`；写 `write_ac257_record()`（fail-closed：缺任一读数 `return 1`，⛔ 不静默跳过）；`--ac-record-schema-report` 两向差集须为 `[ok]`。
8. **正/负控制**：`--selfcheck`（hermetic fixture，不碰真实 ad-arm1）覆盖 `write_ac257_record` 的**全字段正例**与**至少一条缺字段负例**（缺 `merge_preserved` 或 `install_scope` ⇒ 不写且非 0）。硬规则 4 推论三：只能被夹具满足的判据不算测量，但它必须至少能被负例证伪，否则与判据同形。
9. **生产复跑**：ad-arm1 上真跑一遍，使 AC-257 判据 `exit 1 → exit 0`；**前后两次**读数都要贴。

**两清单漂移（立案当轮实测，必须在任务内同步）**：`scripts/version-consistency-check.ts` 的 `VERSION_ENTRIES` 8 项**含** `plugin/vendor/quay/package.json`、**不含** `plugin/VERSION`；而 AC-259 的判据清单**含** `plugin/VERSION`、**不含** `plugin/vendor/quay/package.json`。两个「单一真源」互不覆盖 ⇒ 以并集为准（9 个文件），并在 evidence 里贴 `node --experimental-strip-types scripts/version-consistency-check.ts` 的实际输出。⚠️ 本任务只做**使 `quay_version=0.7.0` 可满足所需的最小 bump**，⛔ 不宣称 AC-259 达成（AC-259 还要求 AC-258 的记录存在）。

**Touches 以「本任务可能改动的具体文件」为准**，含 `plugin/scripts/quay-init.sh` —— 仅当实测证明「非空 settings.json 的合并在 `--force` 路径下也不成立」时才在本任务内做最小修复；否则按 GOAL-018 非目标条款另立 gap 并把该判断写进 evidence。

## Touches

- tasks/gap-ac257-ad-arm1-archguard-project-scope-quay-init-merge-rerun.md
- plugin/scripts/verify-deliver-coldstart.sh
- plugin/scripts/develop-deliver-tgz.sh
- plugin/scripts/quay-init.sh
- plugin/test/verify-deliver-coldstart.test.mjs
- packages/quay/scripts/register-plugin.mjs
- packages/quay/package.json
- packages/quay-native/package.json
- packages/quay-github/package.json
- packages/quay-backlog/package.json
- .claude-plugin/marketplace.json
- plugin/.claude-plugin/marketplace.json
- plugin/.claude-plugin/plugin.json
- plugin/VERSION
- plugin/vendor/quay/package.json

## AC

- [ ] AC1 前置读数：贴 ad-arm1 三条当场读数（插件注册形态 / archguard `.claude/settings.json` 内容+md5 / `.quay/config.yml` provider 路径），并**显式标注**它们取自登录 shell（`bash -lc`），附一条「非登录 shell 会读到 NO_CLAUDE」的对照读数。
- [ ] AC2 版本 bump：`node --experimental-strip-types scripts/version-consistency-check.ts` exit 0，且 `plugin/VERSION` 与 `plugin/vendor/quay/package.json` 的版本同为 `0.7.0`（两清单并集，9 文件）；贴命令输出（前 5 行）。
- [ ] AC3 产出侧接线：`grep -c 'GOAL-018-AC-257' plugin/scripts/verify-deliver-coldstart.sh` ≥ 1 且 `AC_RECORD_SCHEMA` 含该行；`--ac-record-schema-report` 差集为 `[ok]`；贴前 3 条命中内容（硬规则 ②「引用计数前先打印命中」）。
- [ ] AC4 负控制（writer 可被证伪）：`--selfcheck` 里构造**缺 `merge_preserved`** 的片段，断言 `write_ac257_record` **不写**且非 0；再构造全字段正例断言写入。贴两次读数（正例写入行 + 负例退出码）。
- [ ] AC5 merge 语义双读数：重跑前后各取一次 archguard `.claude/settings.json` 的 `hooks.Stop` 段并 md5；断言 ①该段逐字相同 ∧ ②`enabledPlugins` 出现 quay 键。两条同时成立才记 `merge_preserved=true`；⛔ 只贴 ① 不算（结构上不可能取假）。
- [ ] AC6 provider 去探测化：`grep -nE 'verify-|probe|/tmp/' /home/yale/work/archguard/.quay/config.yml` 归零，且用该 config 真能列出 archguard 任务（贴命令与输出首行）。
- [ ] AC7 真实 todo→done：贴任务 id + 状态翻转的提交 sha + **实现提交**（非记账，按位置判定：至少一个改动文件不在 `tasks/`、`goals/`、`.quay/` 之下）。
- [ ] AC8 载体落账：贴 `.quay/productization-verification.jsonl` 里该行的**原样 grep 输出**，并逐字段对照 11 个谓词做一张 `谓词 → 实际值 → 满足?` 表。
- [ ] AC9 生产判据复跑：把 AC-257 的 `python3` 判据**原样**跑两次 —— 落账**前**（须 exit 1）与落账**后**（须 exit 0）；两次的 exit code 与 stderr 都贴。
- [ ] AC10 承接纪律：逐条列「途中发现的机制缺陷 → 另立的 `gap-*` 任务 id（或说明为何不阻断本 AC）」；无则明写「无」。

## DoD

真实落地 = ad-arm1 上**真的**重跑过一次 `quay-init`（Stop hook 逐字保留 ∧ quay 键新增）、provider 绑定**真的**摆脱探测路径、**真的**有一条任务被驱动到 `done` 并留下非记账提交，且载体里**真的**多出那条 `GOAL-018-AC-257` 记录，AC-257 判据 exit 1 的**前**读数与 exit 0 的**后**读数都在。

⛔ 只登记 schema + 写 writer 而不在 ad-arm1 真跑，不算达成 —— 本仓库自带 `plugin/`，任何只在本机跑通的验证在这类缺陷上永远绿（同 `gap-verify-deliver-coldstart-l1-asserts-retired-artifacts` / `gap-ac207-e2e-target-driver-driven-real-commit-task-done` 的既有纪律）。⛔ 用自报字符串凑 `install_scope` 不算：该字段须与项目级 `.claude/settings.json` 的实际形态交叉可核（GOAL-018 风险 4 逐字）。