---
id: gap-ac257-ad-arm1-archguard-project-scope-quay-init-merge-rerun
title: ad-arm1/archguard 真机重验：project scope 装 0.7.0 + quay-init 重跑（非空
  settings.json 合并语义）+ 真实 todo→done（GOAL-018/AC-257）
status: done
needs_human_cause: unclassified
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
- docs/analysis/quay-init-closure-ratchet.baseline.json
- plugin/scripts/develop-deliver-tgz.sh
- plugin/scripts/quay-init.sh
- plugin/test/verify-deliver-coldstart.test.mjs
- plugin/test/develop-deliver-tgz-evidence-transport.test.mjs
- plugin/test/supervisor-preempt-candidates.test.mjs
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
- plugin/README.md

## AC

- [x] AC1 前置读数：贴 ad-arm1 三条当场读数（插件注册形态 / archguard `.claude/settings.json` 内容+md5 / `.quay/config.yml` provider 路径），并**显式标注**它们取自登录 shell（`bash -lc`），附一条「非登录 shell 会读到 NO_CLAUDE」的对照读数。
- [x] AC2 版本 bump：`node --experimental-strip-types scripts/version-consistency-check.ts` exit 0，且 `plugin/VERSION` 与 `plugin/vendor/quay/package.json` 的版本同为 `0.7.0`（两清单并集，9 文件）；贴命令输出（前 5 行）。
- [x] AC3 产出侧接线：`grep -c 'GOAL-018-AC-257' plugin/scripts/verify-deliver-coldstart.sh` ≥ 1 且 `AC_RECORD_SCHEMA` 含该行；`--ac-record-schema-report` 差集为 `[ok]`；贴前 3 条命中内容（硬规则 ②「引用计数前先打印命中」）。
- [x] AC4 负控制（writer 可被证伪）：`--selfcheck` 里构造**缺 `merge_preserved`** 的片段，断言 `write_ac257_record` **不写**且非 0；再构造全字段正例断言写入。贴两次读数（正例写入行 + 负例退出码）。
- [x] AC5 merge 语义双读数：重跑前后各取一次 archguard `.claude/settings.json` 的 `hooks.Stop` 段并 md5；断言 ①该段逐字相同 ∧ ②`enabledPlugins` 出现 quay 键。两条同时成立才记 `merge_preserved=true`；⛔ 只贴 ① 不算（结构上不可能取假）。
- [x] AC6 provider 去探测化：`grep -nE 'verify-|probe|/tmp/' /home/yale/work/archguard/.quay/config.yml` 归零，且用该 config 真能列出 archguard 任务（贴命令与输出首行）。
- [x] AC7 真实 todo→done：贴任务 id + 状态翻转的提交 sha + **实现提交**（非记账，按位置判定：至少一个改动文件不在 `tasks/`、`goals/`、`.quay/` 之下）。
- [x] AC8 载体落账：贴 `.quay/productization-verification.jsonl` 里该行的**原样 grep 输出**，并逐字段对照 11 个谓词做一张 `谓词 → 实际值 → 满足?` 表。
- [x] AC9 生产判据复跑：把 AC-257 的 `python3` 判据**原样**跑两次 —— 落账**前**（须 exit 1）与落账**后**（须 exit 0）；两次的 exit code 与 stderr 都贴。
- [x] AC10 承接纪律：逐条列「途中发现的机制缺陷 → 另立的 `gap-*` 任务 id（或说明为何不阻断本 AC）」；无则明写「无」。

## DoD

真实落地 = ad-arm1 上**真的**重跑过一次 `quay-init`（Stop hook 逐字保留 ∧ quay 键新增）、provider 绑定**真的**摆脱探测路径、**真的**有一条任务被驱动到 `done` 并留下非记账提交，且载体里**真的**多出那条 `GOAL-018-AC-257` 记录，AC-257 判据 exit 1 的**前**读数与 exit 0 的**后**读数都在。

⛔ 只登记 schema + 写 writer 而不在 ad-arm1 真跑，不算达成 —— 本仓库自带 `plugin/`，任何只在本机跑通的验证在这类缺陷上永远绿（同 `gap-verify-deliver-coldstart-l1-asserts-retired-artifacts` / `gap-ac207-e2e-target-driver-driven-real-commit-task-done` 的既有纪律）。⛔ 用自报字符串凑 `install_scope` 不算：该字段须与项目级 `.claude/settings.json` 的实际形态交叉可核（GOAL-018 风险 4 逐字）。

## Evidence

**周期 2026-09-14 07:20–07:50Z。除标注外全部读数取自 ad-arm1 真机当场命令输出（`ssh ad-arm1`），⛔ 不采信本任务正文的立案读数。**

### AC1 前置读数（显式取自登录 shell `bash -lc`）
```
installed_plugins.json → quay@quay 两条：
    scope=user    installPath=~/.claude/plugins/cache/quay/quay/0.7.0
    scope=project installPath=同左  projectPath=/home/yale/work/archguard
known_marketplaces.json → quay.source.path=/home/yale/.local/opt/quay/0.7.0/lib/node_modules/quay/plugin
archguard .claude/settings.json → md5 c7af614e3bd693293d7213e9a65b8515
    仅 hooks.Stop：npm run check:adr 2>&1 | grep -E 'violation|VIOLATION' | head -10 || true
archguard .quay/config.yml → providers.native.path 已是持久前缀（见 AC6）
```
登录/非登录对照（同一条 ssh，同一时刻）：
```
non-login (ssh ad-arm1 'command -v claude')      → NO_CLAUDE
login     (ssh ad-arm1 'bash -lc "command -v claude"') → /home/yale/.local/bin/claude
          realpath → /home/yale/.local/share/claude/versions/2.1.238
```
⇒ 「非登录 shell 读到 NO_CLAUDE」是伪影（硬规则 4b：代理量 vs 直接量），且它正是下方第 2 条机件缺陷。

### AC2 版本 bump（两清单并集，9 文件）
`node --experimental-strip-types scripts/version-consistency-check.ts` → `VERSION-CONSISTENCY: OK`，exit 0，前 5 行：
```
VERSION-CONSISTENCY: OK
  packages/quay                                           0.7.0
  packages/quay-native                                    0.7.0
  packages/quay-github                                    0.7.0
  packages/quay-backlog                                   0.7.0
```
另实测 `plugin/VERSION` = `0.7.0`、`plugin/vendor/quay/package.json` 的 `version` = `0.7.0`
⇒ 两清单并集的 9 个文件同版（`VERSION_ENTRIES` 8 项 ∪ AC-259 清单的 `plugin/VERSION`）。
⚠️ 只做使 `quay_version=0.7.0` 可满足的最小 bump，⛔ 不宣称 AC-259 达成。
⚠️ 该并集的**计数口径随 develop 前进而漂移**（develop 新增 `plugin/README.md` 为承载文件）—— 见第三轮 ②，本轮已就地吸收，判据未变。

### AC3 产出侧接线
`grep -c 'GOAL-018-AC-257' plugin/scripts/verify-deliver-coldstart.sh` = **3**；前 3 条命中（硬规则 ②：引用计数前先打印命中）：
```
:1894  ac_record_append ","\"ac\":\"GOAL-018-AC-257\",\"host\":\"$host\",...
:6193  GOAL-018-AC-257 host:str project_root:str install_scope:str quay_version:str ...
:6938  # 它在目标机上做 ⑨ 的四件事并写一条 ac=GOAL-018-AC-257
```
`--ac-record-schema-report`（两向差集）：
```
  GOAL-018-AC-257    [ok] criterion=11 schema=11 writer=11
AC-RECORD-SCHEMA-REPORT: 15 AC registered, ... missing(criterion-vs-schema)=0
  missing(criterion-vs-writer)=0 missing(schema-vs-writer)=0 surplus=1 unregistered=0 not-evaluated=0
```

### AC4 负控制（writer 可被证伪）＋ 新增读取器控制
```
selfcheck: ac257(positive, all 11 fields) wrote=1 lines=0→1
selfcheck: ac257(negative, merge_preserved omitted) refused=1 lines=1→1   ← 缺字段拒写且零新增行
selfcheck: ac257(every-field-enforced) declared=11 each_omitted_refused=11
selfcheck: ac257(probe-path-negatives) refused=2/2
selfcheck: ac257(host-from-fqdn) label='ad-arm1' (expect 'ad-arm1')
selfcheck: ac257(host-from-fqdn negatives) resolved-but-foreign=refused unresolved=refused empty-fqdn=refused
selfcheck: ac257(marketplace-path) project='/srv/quay/plugin-proj' fallback-to-user='/srv/quay/plugin-user' neither='refused'
selfcheck: PASS
```
（后两组是本轮为两条**已发生**的读取器缺陷补的，见 AC10 第 1、6 条。）

### AC5 merge 语义双读数（两条同时成立）
真机远端读数（run 6 日志）：
```
[⑨b] settings baseline: reset-to-pre-quay-version(d2ad0a42^)   ← 基线=quay 键进入前那一版
[⑨c] BEFORE hooks.Stop md5=e5255b86660f ; enabledPlugins={}
[⑨d] quay-init --force rc=0 (rerun=true)
[⑨e] AFTER  hooks.Stop md5=e5255b86660f verbatim-preserved=1 ; enabledPlugins={"quay@quay":true} gained-quay-key=1
```
收尾后独立复读（不同时刻、不同命令，`ssh ad-arm1` 当场）：
`hooks.Stop` 段 md5 仍 = `e5255b86660f`；`enabledPlugins={"quay@quay": true}`；文件 md5 `7b3e5b21112b2aedf51b221e1718ffab`。
⇒ ①逐字保留 ∧ ②新增 quay 键，两条同时成立 ⇒ `merge_preserved=true`（⛔ 只贴 ① 不算）。
本机夹具预演（`.claude/settings.json` md5 与 archguard **逐字节相同**）独立复现同一结论，且 auto-commit 后工作树干净。

### AC6 provider 去探测化
```
$ ssh ad-arm1 'grep -nE "verify-|probe|/tmp/" /home/yale/work/archguard/.quay/config.yml'
（无输出）GREP_RC=1
$ ssh ad-arm1 'cd /home/yale/work/archguard && node <prefix>/dist/quay.js task list --root ... --json | head -3'
[
  {
    "id": "AC250PROBE-1",
```
远端 ⑨h 读数：`provider usable: task list returned 450638 bytes`。

### AC7 真实 todo→done
- 任务 id：`TASK-TSCONFIG-EXTENDS`（archguard 任务仓；真实缺陷 = `loadPathAliases()` 不跟随 tsconfig `extends`）
- 状态翻转提交：`e997bce1  tasks: 翻 TASK-TSCONFIG-EXTENDS done（driver 机械 fan-in）`
- gate 事件：`dad80095-… gate=complete actor=quay-driver verdict=pass payload={"from":"ready","to":"done"}`
- **实现提交**（非记账，按位置判定）：`3b67cf7f  fix(tsconfig-finder): follow \`extends\` when loading path aliases`
  —— 触及 `src/utils/tsconfig-finder.ts`（+137/−13）与 `tests/unit/utils/tsconfig-finder.test.ts`，**都不在** `tasks/` `goals/` `.quay/` 之下
- 远端 ⑨k：`task_status=done commit_sha=3b67cf7f5a44 files=["src/utils/tsconfig-finder.ts","tests/unit/utils/tsconfig-finder.test.ts"] gate_events=3 produced_by_driver=1 evaluated=1`

⚠️ 诚实登记：该任务由本任务的**前序轮次**在 archguard 建成并驱动到 done（本条 AC 的产物形态）；
本轮 ⑨ 读到的是它的**外部可核直接量**，⛔ 不是本轮新建任务。

### AC8 载体落账
`.quay/productization-verification.jsonl` 原样 grep：
```json
{"build_sha":"70908487e5a7ab1236df779203affea25b3e51e1","ts":"2026-09-14T07:47:21Z","ac":"GOAL-018-AC-257","host":"ad-arm1","project_root":"/home/yale/work/archguard","install_scope":"project","quay_version":"0.7.0","quay_init_rerun":true,"merge_preserved":true,"marketplace_path":"/home/yale/.local/opt/quay/0.7.0/lib/node_modules/quay/plugin","provider_path":"/home/yale/.local/opt/quay/0.7.0/lib/node_modules/quay/plugin/vendor/quay-native","task_status":"done","commit_sha":"3b67cf7f5a4470a51f50add83a264aaaf3c38ce9","produced_by_driver":true}
```
逐字段对照（由载体该行自动生成，⛔ 不手抄）：
| 谓词 | 实际值 | 满足? |
|---|---|---|
| `ac = GOAL-018-AC-257` | `GOAL-018-AC-257` | ✅ |
| `host = "ad-arm1"` | `ad-arm1` | ✅ |
| `project_root = "/home/yale/work/archguard"` | `/home/yale/work/archguard` | ✅ |
| `install_scope = "project"` | `project` | ✅ |
| `quay_version = "0.7.0"` | `0.7.0` | ✅ |
| `quay_init_rerun is True` | `true` | ✅ |
| `merge_preserved is True` | `true` | ✅ |
| `(marketplace|provider) 非空 ∧ 不匹配 verify-|probe|/tmp/` | `/home/yale/.local/opt/quay/0.7.0/lib/node_modules/quay/plugin` | ✅ |
| `task_status = "done"` | `done` | ✅ |
| `commit_sha 非空` | `3b67cf7f5a4470a51f50add83a264aaaf3c38ce9` | ✅ |
| `produced_by_driver is True` | `true` | ✅ |

**11/11 全部满足**（本表由载体该行自动生成 —— `json.loads` 读回后逐谓词比对，⛔ 不手抄）。

### AC9 生产判据复跑（原样跑两次）
落账**前**（2026-09-14 07:1xZ，载体 157 行、`grep -c GOAL-018` = 0）：
```
$ python3 <AC-257 criterion 原样>
AC-257: no qualifying record (need host=ad-arm1, project_root=/home/yale/work/archguard, install_scope=project,
  quay_version=0.7.0, quay_init_rerun=true, merge_preserved=true, a non-probe marketplace/provider path,
  task_status=done, commit_sha set, produced_by_driver=true)
EXIT_BEFORE=1
```
落账**后**（载体 158 行）：
```
$ python3 <AC-257 criterion 原样>
（无 stderr）
EXIT_AFTER=0
```
（criterion 由 goal 文件的 `criterion:` 折叠标量经 `yaml.safe_load` 取出后原样执行 —— 与 `ac_record_finalize` 同一读法。
落账时 `ac_record_finalize` 已自动复跑并落账 `criterion_rerun_rc=0`。）

### 收尾：首次 fan-in 套件红的真因（AC10 第 10 条 —— 测试里的陈旧字面量）

首次 fan-in 的套件红 `# fail 1`（**4862 tests / 4861 pass，全库只有这一条**）：
`⑥ shipped-set closure — the ENUMERATION is proven complete, not asserted (AC1..AC4)`
（`plugin/test/develop-deliver-tgz-evidence-transport.test.mjs:156`）。它断言 `develop-deliver-tgz.sh` 里
`if ! ship_verify_closure` 恰好出现 **5** 次，而本任务新增的 `--verify-ac257` 模式**正确地**作为第 6 个
走同一个枚举 ⇒ `6 !== 5`（同文件 :174 的 `$(verify_node_export_for "${hk}")` 也是同一个字面量 5）。

⚠️ 机械 `delta-relatedness` 提示把该测试判为 **UNRELATED**（"its direct imports do not intersect this
task's delta"）—— **该判定对本例是错的**：那个测试用 `readFileSync(SCRIPT)` 读 **shell 脚本文本**、
不是 `import`，所以一跳 import 检查结构上看不见这条依赖。worktree 内 `node --test <file>` 当场复现
（`6 !== 5`）⇒ 真因，不是环境噪声（同族：`delta-relatedness-hint-misses-two-hop-data-dependency`）。

**修法**：把字面量 `5` 换成**从模式定义推导**的计数，并按模式切片逐段断言「恰好 1 个 scp 站」。
它现在**比原来更强** —— 既抓「某模式 0 个站」（直接 scp，即 2026-09-11 那个缺陷的形态），
也抓「某模式 2 个站」；**总计数会被「一多一少」互抵，逐段断言不会**。第二处同形字面量一并改成同一推导。

**红控制（断言确实能取假，⛔ 不是空转）** —— 对真实脚本做变异后跑同一谓词：
```
REAL     -> [["verify_coldstart_mode",1],...,["verify_complete_change_mode",1]]   6 模式 × 1 站
DROP-1   -> [["verify_coldstart_mode",0],...]  bad=[["verify_coldstart_mode",0]]   ⇒ 判据红 ✓
DUP-1    -> [["verify_coldstart_mode",2],...]  bad=[["verify_coldstart_mode",2]]   ⇒ 判据红 ✓
NO-MODES -> []  ⇒ 由新增的 assert.ok(modeDefs.length >= 5) 兜住（否则循环为空、恒绿）✓
```
修复后 worktree 内 `node --test plugin/test/develop-deliver-tgz-evidence-transport.test.mjs` → `pass 16 / fail 0`。

**Touches 扩展（必须登记）**：本条的修复落在 `plugin/test/develop-deliver-tgz-evidence-transport.test.mjs`，
它**不在**本任务原 `## Touches` 内，而 `anti-drift-touches-check.ts` 对「写在自己的声明之外」是
**HARD FAIL**（`out-of-declared`）⇒ 已把该文件加进 `## Touches`。⛔ 不是放宽声明：本任务改了
`develop-deliver-tgz.sh` 的枚举面，钉住该面的守卫测试必须随之更新，两者是同一个改动。

**为何不另立 `gap-*`**：这一条不在 AC-257 的**产出路径**上（它不阻塞「记录落盘」），
但它**阻塞本任务落地**（套件红 ⇒ fan-in 红 ⇒ exited-not-landed）。按 Plan 的处置边界
（结构上阻断 ⇒ 就地修），它属「阻断本任务落地」一侧，且与 `develop-deliver-tgz.sh` 的改动是同一改动面
⇒ 就地修 + 登记 Touches。（下方 AC10 表内 1–9 条的分母不变：那 9 条是**产出路径**缺陷。）

### 第二轮（2026-09-14 10:3xZ 之后，本回合）：develop 追赶 + 第二次 fan-in 套件红的真因

**① merge develop（当时落后 32 提交，本回合合并体 = `bf87827f6`）**：唯一冲突
`docs/analysis/quay-init-closure-ratchet.baseline.json`（closure ratchet 基线：两侧 `files:3 bytes:1022`
**相同**，只有 `fingerprint` 行不同）。⛔ 不手拼两侧的 `sources` —— 走该基线自己的机械重锚
（正本 `plugin/scripts/quay-init-closure-ratchet.ts --reanchor`：跑**真实** laydown 后由 4 个源文件的
sha 重算）：
```
$ node --experimental-strip-types plugin/scripts/quay-init-closure-ratchet.ts --reanchor
PASS: quay-init-closure-ratchet: re-anchored baseline → 3 files / 1022 bytes (fingerprint a0e13664f5b2054e…, 4 source files)
$ node --experimental-strip-types plugin/scripts/quay-init-closure-ratchet.ts --check-stale
PASS: quay-init-closure-ratchet: laydown source fingerprint fresh (a0e13664f5b2054e…) — baseline in sync
```
⇒ 文件数/字节数与两侧**一致**（**未放宽 ratchet**），指纹是合并后源树的真实值
（两侧各自的值 `1666d725…` / `08ae0dcb…` 都不是合并后的真值 —— 手选任一侧都会留一个恒红的 freshness 闸）。
合并后 `node --experimental-strip-types scripts/version-consistency-check.ts` → `VERSION-CONSISTENCY: OK`
（8 文件 0.7.0，另 `plugin/VERSION` = 0.7.0）。

**② 第二次 fan-in 套件红的真因（AC10 第 10 条）**：`plugin/test/supervisor-preempt-candidates.test.mjs:150`
的 `assert.match(r.stdout, /95\.0 min/)` 失败，实收 **`95.1 min`**。

- **不是本任务 delta 造成的**：`git diff develop...HEAD -- <该测试> <其脚本>` = **空**（本分支一个字都没动它们）。
  同一条红在**前一次** fan-in（09:45 那次，同一分支同一 delta）里该文件是 `passed=true` ⇒ 它是**间歇**的。
- **真因是判据的形状**：被测脚本 `supervisor-preempt-candidates.ts:88` 用
  `Number(((nowMs − startedAtMs) / 60_000).toFixed(1))` —— **墙钟派生值再过四舍五入**；而测试把 bracket
  backdate **恰好 95 分钟** ⇒ 打印值 = `95.0 + δ/60`，δ = 「写 bracket」到「脚本自己取 `Date.now()`」之间的
  真实墙钟。`.toFixed(1)` 的舍入边界落在 **95.05 min = 3 秒**：δ 一旦超过 3 秒（全量套件并发下实测
  δ≈3–9 秒），字面量就从 `95.0` 翻成 `95.1`。该测试自己的头两行就写着 `@load-sensitive wall-clock`
  —— 作者已知这一族负载敏感，只是判据仍钉在四舍五入**之后**的字面量上。
- **对照（决定性 —— 同一夹具只改一个参数，两假设给出相反预测，硬规则 4 推论四）**：
```
A 真实夹具、无注入延迟   stdout "… 95.0 min  timeout-no-progress" ⇒ OLD GREEN / NEW GREEN
B 同一夹具 + 注入 4s 延迟 stdout "… 95.1 min  timeout-no-progress" ⇒ OLD **RED** / NEW GREEN   ← 逐字复现 fan-in 那条红
C 红控制：backdate 改 91 分钟（时长事实错） stdout "… 91.0 min …" ⇒ OLD RED / **NEW RED**    ← 新判据能取假
```
  ⇒ **B 证明旧字面量是负载敏感的**（同一次代码、同一夹具，只有延迟不同就翻），
  **C 证明新判据不是空转**（硬规则 4 推论三：在任何输入下都绿的判据不是测量）。
- **修法（就地、最小）**：把「匹配四舍五入后的字面量」换成「**解析该列 + 断区间 `[95,96)`**」，并补一条
  旧判据从未有的约束 `timeout-no-progress`（reason 列）。边界从 **3 秒**放宽到 **60 秒**，仍能红在
  「时长事实错」（C）。修复后 worktree 内 `node --test plugin/test/supervisor-preempt-candidates.test.mjs`
  → `pass 11 / fail 0`。
- **为何就地修而不是另立 `gap-*`**：它与本任务**落地**结构性冲突（套件红 ⇒ 本任务 exited-not-landed；
  本任务已因此烧满一次重试上限并进过 needs-human，本次再红即第二次）。按 Plan 处置边界属
  「结构上阻断本任务落地」一侧；并已按 `anti-drift-touches-check.ts` 的 HARD 要求把该文件登记进
  `## Touches`（⛔ 不是放宽声明：改了它的判据就必须声明它）。
- **已知残余（不隐藏）**：本轮只收了「判据形状」这一条，**没有**把它改路由到 serial/lowconc 泳道
  （它仍是 `@test-group engine` 并行泳道）——那是调度器改动，不在本任务内。若该族再现 ≥2 次，应按仓内
  既有做法（`known-load-sensitive.ts` 的分级闸 / `@load-sensitive-entry`）另立任务收编。

⚠️ **本任务正文里 `needs_human_cause: human-adjudication` 与末尾 `## Needs-Human` 段是 2026-09-14T10:26Z
那次「连续修满重试上限」的**历史审计记录**（确实发生过），不是当前状态；本回合是接手它继续修
（git 历史里第一次 fan-in 那条红的成因见上一节，第二次见本节）。⛔ 未删该记录（append-only 审计），
也⛔ 未自行改写 `status:`（该字段归 driver）。

### 第三轮（2026-09-14 12:5xZ，本回合）：develop 追赶 103 提交 + 版本冲突取 GOAL 钉的 0.7.0 + 承载集新增一个文件

**① merge develop（合并前落后 103 提交；合并体 `8b201b985`）** —— 10 处冲突，两类：

- **9 个版本承载文件**（`packages/quay{,-native,-github,-backlog}/package.json`、`plugin/VERSION`、
  `plugin/.claude-plugin/{plugin,marketplace}.json`、`.claude-plugin/marketplace.json`、
  `plugin/vendor/quay/package.json`）：develop = **0.6.3**，本分支 = **0.7.0** ⇒ **取 0.7.0**（⛔ 非 develop wins）。
  依据：版本是**单值、不可语义合并**，而**生效 GOAL 逐字钉住它** —— GOAL-018 标题即「…版本 bump 到 0.7.0」，
  AC-257 判据要求 `quay_version == "0.7.0"`（AC-257 已 `status: achieved`）。取 develop 的 0.6.3 会**同时**
  打坏 AC-257 与 AC-259。该理由已写进 merge commit message。
- **`docs/analysis/quay-init-closure-ratchet.baseline.json`**：两侧 `files:3 bytes:1022` **相同**、只有
  fingerprint/sources 不同 ⇒ ⛔ 不手选任一侧（任一侧都会留一个恒红的 freshness 闸），走**机械重锚**（同第二轮）：
  `--reanchor` → `3 files / 1022 bytes`（**footprint 未变 ⇒ ratchet 未放宽**）、`--check-stale` → PASS。
- 本分支上一轮的两处修复（`develop-deliver-tgz-evidence-transport.test.mjs` 的推导计数、
  `supervisor-preempt-candidates.test.mjs` 的区间断言）合并后**逐字保留**（已当场核）。

**② develop 给承载集新增了一个文件 ⇒ 9 → 10**：develop `b15fc2e2c`（`fix(ac169): put plugin/README.md
into the version-consistency canonical set`）把 `plugin/README.md` 加进 `VERSION_ENTRIES`，而该文件在
本分支上**从未被 bump** ⇒ 合并后 `version-consistency-check.ts` 报 `DRIFT DETECTED … plugin/README.md 0.6.3`。
**就地修**：`plugin/README.md:3` 的 `v0.6.3` → `v0.7.0`，并把该文件登记进 `## Touches`
（⛔ 不是放宽声明：**改了版本承载集就必须声明新增的承载文件**，否则 `anti-drift-touches-check.ts` 按
`out-of-declared` HARD FAIL）。复跑 `node --experimental-strip-types scripts/version-consistency-check.ts`
→ `VERSION-CONSISTENCY: OK`，末行 `All 9 files carry version 0.7.0`（9 个 entry 含 `plugin/README.md`）。

⚠️ **AC2 的「9 文件」计数口径随 develop 前进而漂移，显式登记**：立案当轮的并集 = `VERSION_ENTRIES`(8 项，
含 `plugin/vendor/quay/package.json`、不含 `plugin/VERSION`) ∪ AC-259 清单(含 `plugin/VERSION`) = **9**；
本轮 `VERSION_ENTRIES` 已是 **9 个 entry（含 `plugin/README.md`）** ⇒ 并集 = **10 个文件**。
AC2 的**可取假判据本身未变**（checker exit 0 ∧ `plugin/VERSION` 与 `plugin/vendor/quay/package.json`
同为 `0.7.0`）且已复跑通过；此处只登记计数真值，⛔ 不回头改判据迁就真值。

**③ anti-drift 前置核对（本回合当场实测，⛔ 不靠推断）**：合并后在工作树内跑
`anti-drift-touches-check.ts --task <id> --worktree <wt> --merge-target develop` ⇒ **恰好 1 条**
`out-of-declared: plugin/README.md (matches no declared Touches glob)`（⛔ 不是「Touches 陈旧」的泛指 ——
是逐条列出的、一条具体的违规）⇒ ② 的 Touches 登记正是**为它**而做；登记后按同一命令复跑（见本轮退出前的
scoped 门前置核对）。

### AC10 承接纪律
见下方「承接：本轮发现的机制缺陷」——9 条，全部在**本任务自己的产出路径**上（两个文件都在本任务 `## Touches` 内，且 Plan §7/§8 明令改它们），**9 条全部结构上阻断本 AC 的产出**（每一条都把「记录落盘」这条路堵死，而失败形态都是「记录没写出来」，与「机制坏了」同形）⇒ 全部就地修。唯一另立 `gap-*` 的是第 8 条的**产品侧半边**（`quay-native task create`，不属本任务 Touches 的产品面）。第 10 条（第二条套件红，见上）不在产出路径上但阻断落地 ⇒ 同上就地修。

### 承接：本轮发现的机制缺陷（9 条）

全部在**本任务自己的产出路径**上（`plugin/scripts/verify-deliver-coldstart.sh` / `develop-deliver-tgz.sh`，
两者都在本任务 `## Touches` 内，且 Plan §7/§8 明令改它们），且**全部只有真正跑过这个模式才看得见**——
此前它们只表现为「记录没写出来」，与「机制坏了」同形（硬规则 3b）。1–9 逐条：

| # | 缺陷 | 形态 | 处置 |
|---|---|---|---|
| 1 | `host` 字段读不出 criterion 要的字面 `ad-arm1` | 目标机 `hostname` 是实例名；实测目标机**无任何**直接量能读回 `ad-arm1`（/etc/hosts 无该名、`getent hosts <自身各地址>` 一律返回实例名、IPv4/IPv6 的 PTR 亦然） | 就地修：`--ac257-host-fqdn` 从驱动方连接名派生 label，并**当场核验**该名解析到目标机自己拥有的地址；核验不过 ⇒ NOT-EVALUATED（⛔ 不回落 hostname） |
| 2 | 远端跑的是**非登录** shell ⇒ `claude` 不在 PATH | `command -v claude` 取假 ⇒ 项目级安装整段被跳过 ⇒ `install_scope` 永远读不到 `project` | 就地修：该模式 remote 改 `bash -ls`（其余五个 verify 模式行为逐字不变） |
| 3 | 本模式**漏传 `--build-sha`**（其余五个模式逐字都传） | `ac_record_append` 的 anchored 模式在 BUILD_SHA 非 40-hex 时 fail-closed ⇒ 记录**永远**落不了盘 | 就地修：补传 `develop_tip` |
| 4 | 交付物 CLI 硬编码 `<plugin>/../bin/quay` | 实测 npm 装出来的 quay 包**没有 `bin/` 目录**（`package.json` 的 bin 是 `./dist/quay.js`）⇒ 模式在**门口** exit 1 | 就地修：从安装物自己的 `package.json` 的 `bin` 字段解析 |
| 5 | 任务体 scp 目标写 `$HOME/…` | 现代 scp 走 SFTP 子系统，**远端路径不做 shell 展开** ⇒ 那是个字面文件名 ⇒ 模式在门口 NOT-EVALUATED | 就地修：改 `~/…`（本文件其余五处 scp 本就写 `:~/`，本条是唯一例外） |
| 6 | `ac257_marketplace_path` **恒返回空**（argv 下标错位） | `node -e '<script>' A B C` 的 `process.argv` 是 `[node, A, B, C]`（`-e` 不给 argv[1] 留 script 项）；原实现名字取 `argv[2]`、文件取 `slice(3)` ⇒ 把**第一个文件路径**当 marketplace 名字、且**一个文件都没遍历** | 就地修：名字取 `argv[1]`、文件取 `slice(2)`；并补 selfcheck 三例（含「项目级无键⇒回落用户级」这一正是被漏掉的形态）。同文件其余四个 `node -e` 读取器下标已逐个核对，正确 |
| 7 | **实验不可重复**：夹具基线被上一次运行自己吃掉 | 步骤 (a) 原为「重置到 HEAD」，而本实验会把合并结果 auto-commit 进 HEAD（run4 留下 `d2ad0a42`，其 `settings.json` 已含 `quay@quay`）⇒ 第二次运行时 HEAD 已是 *quay 写的*，而本步骤要的是「非空、**非 quay 写的**」⇒ 必然 NOT-EVALUATED | 就地修：基线取 `git log -S'"quay@quay"' -- .claude/settings.json` 里**最早**那个提交的**父提交**那一版（项目无关的取法，⛔ 不硬编码 archguard） |
| 8 | **`quay-native task create` 对已存在的 id 返回 0，并把第二段 frontmatter【前置】进 `tasks/<id>.md`** | 实测 run5：archguard 一条 settled `done` 的任务被「创建」成 `todo`（ABI 读到前面那段），随后 promotion-driver 晋升它到 `ready`，而本步骤正等它 `done` ⇒ 结构上不可达；**并且把被取证项目的任务文件弄坏了** | 就地修（本步骤侧）：`task view` 先查存在性，读得到就**绝不调 create**。**产品侧缺陷另立** → 见下 |
| 9 | 对一条**已 done** 的任务启动 promotion/worker driver | 运行 ⑨i 会把 settled `done` 推回 `todo⇒ready` —— 不是「驱动」，是**破坏读数**（同族：`probing-a-ttl-cached-endpoint-warms-the-thing-you-measure`） | 就地修：已 done ⇒ 不起 driver、不轮询，直接读直接量（读的仍是任务状态 + 历史实现提交 + gate 事件，⛔ 不因跳过驱动放宽任何一条） |

**另立 `gap-*`（#8 的产品侧半边，⛔ 不在本 AC 内解决）**：`quay-native task create` 在**已存在 id** 上
返回 0 并前置第二段 frontmatter，**静默损坏任何项目的任务文件**、且把 ABI 读到的 status 改成 `todo`。
这不是本 AC 的机制，也不在本任务 `## Touches` 的产品面内（属 `packages/quay-native` 的 store/create 路径），
按 GOAL-018 非目标条款人 2026-09-14 裁定另立：见 `tasks/gap-quay-native-task-create-duplicate-id-prepends-frontmatter.md`
（本任务只登记读数，不就地修产品实现）。

**两条非缺陷的观察项（不作阻塞）**：
- `quay-init` 会在项目里留下未跟踪的 `.claude/launch.settings.json.bak.<ts>`（⑨d0 实测 = 1 entry）⇒
  被取证项目主检出变脏，其自身 fan-in 的 `cleanTreeCheck` 会拒。本轮由 ⑨d0 当场读出并在收尾时清掉；
  是否把该备份文件纳入 quay-init 的 auto-commit 闭集或 `.gitignore` 闭集，留待复核。
- 步骤 ⑨f 的 `claude plugin marketplace add --scope project` 会把一条 **machine-specific 绝对路径**
  写进项目级 `settings.json`（`extraKnownMarketplaces`），而 `quay-init` 自己的安装说明把 marketplace
  注册定为 **user scope「不提交」**。收尾时该行已退回 HEAD（⛔ 项目级 `enabledPlugins` 那条**未动**，
  它才是本 AC `install_scope=project` 的可核锚点）。

## Needs-Human

**执行 2026-09-14T10:26:19.180Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 成因类：human-adjudication
- 失败步/判词：step=suite: AssertionError [ERR_ASSERTION]: The input did not match the regular expression /95\.0 min/. Input:
- run_id：wk-prod-1789367589
- session_id：d4b5291f-ac8d-4361-a63d-d2da925035c0
- suite 日志：/home/yale/work/quay/.quay/fan-in-suite-gap-ac257-ad-arm1-archguard-project-scope-quay-init-merge-rerun~wk-prod-1789367589~1789379993178-4b51a8.log
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-ac257-ad-arm1-archguard-project-scope-quay-init-merge-rerun-wk-prod-1789367589.log

## Needs-Human

**执行 2026-09-14T11:18:10.828Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：suite 红但归因不出任何失败测试文件（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 2 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (the suite log names nothing a worker could fix); stopping instead of spending another worker session
- 成因类：unclassified
- 失败步/判词：adopted orphan worker exited (exit code unobservable) — task status=ready (not done) and leftover worktree task/gap-ac257-ad-arm1-archguard-project-scope-quay-init-merge-rerun still present
- run_id：wk-prod-1789367589

## Needs-Human

**执行 2026-09-14T12:49:49.350Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：suite 红但归因不出任何失败测试文件（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 3 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (the suite log names nothing a worker could fix); stopping instead of spending another worker session
- 成因类：unclassified
- 失败步/判词：adopted orphan worker exited (exit code unobservable) — task status=ready (not done) and leftover worktree task/gap-ac257-ad-arm1-archguard-project-scope-quay-init-merge-rerun still present
- run_id：wk-prod-1789367589
