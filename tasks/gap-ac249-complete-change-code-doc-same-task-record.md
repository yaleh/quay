---
id: gap-ac249-complete-change-code-doc-same-task-record
title: AC-249 没有生产者：载体里没有 ac=GOAL-016-AC-249 的记录 —— 同一任务的 commit_files
  必须代码面（src/|scripts/）与 ADR-007 文档面同时非空，单边不算
status: done
labels:
  - gap
  - mechanism
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac248-adr-check-differential-record-producer
goal_ac: AC-249
---
## Proposal

**症状（机械可复算，2026-09-12 实测）**：GOAL-016 的 AC-249 要求载体 `.quay/productization-verification.jsonl` 里存在一条 `ac=GOAL-016-AC-249` 记录。**该记录一条都没有**：

```
载体：82 条记录；`grep -c '"GOAL-016' .quay/productization-verification.jsonl` ⇒ 0
                        （ac 取值集合里含 GOAL-016 的 = 0；含 GOAL-009 的 9 种、AC85..AC168-marketplace 若干）
grep -rn 'GOAL-016' plugin/scripts/                        ⇒ 0 命中（生产者不存在，不是"有生产者但没跑"）
grep -rn '^goal_ac: AC-249' tasks/*.md                     ⇒ 0（无人认领）
判据干跑 ⇒ exit 1（AC-249 正文自陈「2026-09-12 干跑 exit 1」）
```

**目标态判据要求（逐字取自 `goals/AC-249-*.md`，⛔ 本任务不改判据文件）**：记录须满足
`host≠本机` ∧ `project_root` realpath ∉ 本仓库 ∧ `task_id` 非空 ∧ `commit_files` 是非空列表，
且**同时** ≥1 条路径以 `src/` 或 `scripts/` 开头（代码修复）∧ ≥1 条路径含 `ADR-007` 或以 `docs/adr` 开头（文档同步）。
缺 ⇒ exit 1；载体缺失 ⇒ exit 3（NOT-EVALUATED，⛔ 不与合格同形）。**只改代码不改文档、或只改文档不改代码，均 exit 1。**

**为什么既有选择器结构上产不出这条记录（本任务的核心缺陷面，⛔ 不是"没跑"）**：既有
`ac207_select_implementation_commit`（`plugin/scripts/verify-deliver-coldstart.sh:674`）返回**单条**"最新实现提交"，
`AC207_COMMIT_FILES_JSON` 是**那一条提交**的文件（同文件 `:806-810`）。而判据正文逐字要求的是
「**同一 task_id 下的 commit_files 并集**满足双向条件」。⇒ 一个把代码与文档拆成两个提交的任务，
在"只取一条提交"的选择器下**必然只看到一半**：选中的是代码提交 ⇒ 文档谓词假；选中文档提交（它那一刻更晚）
⇒ 代码谓词假。**两个方向都判红，而任务本身完全合格** ⇒ 这是恒假，不是"没干成"
（硬规则 4c：量的产生处到读取处之间隔了一层"只取一条"的中间层，判据点名的量到不了验收那一刻）。

**区分量是「并存」，⛔ 不是「有非记账文件」**：AC-248 的谓词是"≥1 条不在 tasks/ goals/ .quay/ 之下"，
AC-249 是"代码面与文档面**同时**非空"。一个只改 `src/` 的完美修复满足 AC-248、**不**满足 AC-249。
⇒ 两条 AC 不能互相冒充，记录也必须各写各的（沿用既有约定：每条 AC 自己的 `write_acXXX_record()` +
自己的 `ACxxx_*` 变量，否则两条无法分别 pass/fail）。

**靶子侧的形状已实测存在（不是假想，2026-09-12 本会话 probe）**：

```
ad-arm1（hostname instance-20221019-1509）:/home/yale/work/archguard，master @ 14ea9e63
  src/                     ✔ 存在（代码面；实际豁免注释全在 src/cli/mcp/tools/*.ts）
  scripts/check-adr.ts     ✔ 存在（archguard 自己的 ADR-007 检查器，quay 不拥有）
  quay-adr/ADR-007.md      ✔ 存在，:193「Currently suppressed」只登记 2 条
                             （archguard_get_ccb / archguard_get_cognitive_summary）
  src/ 里 `// adr-ok: ADR-007` 实测 8 条（get_ccb / get_cognitive_summary / get_gim_context /
    detect_shape_smells(2 处) / get_literal_dispersion / get_metric_trend / get_package_metrics /
    get_evidence_pack）⇒ 文档清单与源码实际**已经**漂移
  docs/adr/007-cli-mcp-interface-parity.md 已被改成跳转 stub（指向 quay-adr/ADR-007.md）
```

⇒ 判据的两个路径谓词在这个靶子上都有真实载体：`src/cli/mcp/tools/*.ts` 满足 `src/` 前缀，
`quay-adr/ADR-007.md` 含 `ADR-007`（改 `docs/adr/*` 那个 stub 则命中 `docs/adr` 分支）。
**⚠️「有文件可改」≠「驱动的任务一定会改两边」**——后者正是本 AC 要测的东西，⛔ 不许用产侧夹具顶替。

<!-- dedup-ref -->
**与既有任务的关系（仅追溯，不构成任何依赖声明）**：`gap-ac247-stalled-project-clean-takeover-record`（AC-247，ready）
建"从零安装 + 接管停摆项目 + driver 真活"的生产者与传输；`gap-ac248-adr-check-differential-record-producer`（AC-248，todo）
建**同一次**驱动里 `adr_check_before/after_detects` 翻转的生产者。两者都写 `commit_files`，但**都没有**
"并集同时含代码面与文档面"这个判据，也没有任何跨提交的文件并集枚举。本任务只补这条缺失的字段级谓词 +
生产者步骤，⛔ 不复用它们的字段当真——AC-248 的 `commit_files` 是单条实现提交的，拿它冒充 AC-249 会得到恒假。

## Plan

1. **先定读数，再写代码**——每个字段一个直接量，全部在**目标机**读、由目标项目自己的 git 产生：
   - `commit_files`（AC-249 唯一被 criterion 读的字段）← **同一 task_id 名下全部提交的文件并集**，按**位置**归属
     （⛔ 不按提交信息文本）：以 `task/<task_id>` 分支上的提交为主，fan-in 后分支被删的形态用
     「`git log --no-merges` 中触及 `tasks/<task_id>.md` 的提交」补齐；并集去重、**仓库相对路径原样**
     （⛔ 不加 `./` 前缀、不取绝对路径——criterion 用 `startswith("src/")`，一个 `./` 前缀即恒假）。
   - `task_id` ← 本次驱动到 done 的那个任务的 id（与 AC-247/248 的 e2e 段**同一个** task，⛔ 不新造一个"给 AC-249 看的"任务）。
   - `host` / `project_root` ← 目标机 `hostname` / 项目根 `realpath`（目标机读，⛔ 不由驱动方传入）。
   - 复用既有 **AC 编号无关**的辅助 `ac207_commit_files` / `ac207_files_to_json`（⛔ 不复刻一份：复刻出来的绿不证明
     产品绿，硬规则 4 推论三）；**但 `ac207_select_implementation_commit` 不能复用**——它的"只取一条"正是本任务的缺陷面。
2. **生产者步骤（目标侧，`plugin/scripts/verify-deliver-coldstart.sh`）**：新增 opt-in flag（形如
   `--ac249-complete-change --target-root <项目根> --task-id <id>`），与 AC-248 的步骤**同一趟真跑**用同一个 task_id
   （AC-249 正文逐字要求两条绑在同一次驱动产出上）。新增 `write_ac249_record()`，用自己的 `AC249_*` 变量，
   **写入必须走既有唯一补锚 choke point `ac89_append_goal009`**（它统一补 top-level `ts`/`build_sha`）
   ——⛔ 不在新写入点再写一份 `"build_sha"` 字面量（既有注释逐字禁止：多一个补锚点 = 下次改锚格式必漏一处）。
3. **双向 fail-closed（本 AC 与 AC-248 的判别处）**：写记录前**两个谓词都必须真**——
   `any(p.startswith("src/") or p.startswith("scripts/"))` ∧ `any("ADR-007" in p or p.startswith("docs/adr"))`。
   任一为假 ⇒ **零记录** + 可区分的 `NOT-EVALUATED` / `AC249-INCOMPLETE-CHANGE` 痕迹 + 退出非 0
   （⛔ 不写一条"只改了一边"的记录充数——那正是判据要取假的方向）。三态实测可区分：完整 ⇒ 1 条；只代码 ⇒ 0 条；只文档 ⇒ 0 条。
4. **缺值 ≠ 不合格（硬规则 3b）**：并集读不出（任务没有提交 / 两条归属路径都空 / git 读失败）⇒ **不写** +
   `NOT-EVALUATED` + 非 0，⛔ 不写 `commit_files: []`。
5. **传输步骤（驱动侧，`plugin/scripts/develop-deliver-tgz.sh`）**：与既有 `--verify-coldstart` / `--verify-upgrade`
   **同形**地 scp 回证据文件，经既有 `transport_evidence_append`（按 `(ts, ac, host, project_root)` 去重）追加进
   **驱动方 repo root** 的 `.quay/productization-verification.jsonl`；证据缺失/不可读/零行 ⇒ 非 0 + `NOT-EVALUATED`
   （⛔ 不静默 exit 0）。
6. **记录必须落在生产 root 的载体里**：判据由生产 goal-driver 在 `/home/yale/work/quay` 求值 ⇒ 传输落点必须是
   **该 root** 的 `.quay/`。worktree 里先跑通，再把证据传输/追加进生产 root，并在**生产 root** 下干跑判据核
   exit 0（⛔ 不在 worktree 的 `.quay/` 里自证——那是另一份载体）。
7. **真跑一次（唯一能产出记录的路）**：在 ad-arm1 的 `/home/yale/work/archguard`，由该项目**自己的 drivers**
   驱动**一条**任务到 done，该任务同时触及 `src/`（或 `scripts/`）与 `quay-adr/ADR-007.md`（或 `docs/adr/*`）。
   **目标侧任务文本只给症状 + 复现入口 + 期望行为**（GOAL-016 风险 4：写进根因/修法/正则所在行 ⇒ 测到的是
   "能驱动施工"而非"能驱动开发"）：症状 = ADR-007 文档里那份 suppressed 清单与源码里
   `// adr-ok: ADR-007` 的实际条数不一致；期望 = 由 archguard **自己的** `npm run check:adr` 判"改了没有"，
   且**文档里那份清单与源码实际一致**（后者是"成套"的可观测面，⛔ 不是修法）。
   ⛔ 不给根因、不给修法、不给文件行号、⛔ 不点名正则。
8. **负控制（能取假，逐条留档）**：
   a) **单边两方向**：只含 `src/…` 的并集 ⇒ 零记录；只含 `quay-adr/ADR-007.md` 的并集 ⇒ 零记录
      （各带可区分痕迹与退出码）。
   b) **"只取一条提交"的退化（本任务缺陷面的守门人）**：夹具构造「代码提交在前、文档提交在后（最新那条是文档）」
      ⇒ 用**并集**的实现**写出 1 条**，而误用单条选择器的实现**写不出**（两条读数并列留档）。
      ⛔ 没有这条负控制，一个只取最新提交的实现会绿着通过全部正控制。
   c) **路径前缀形态**：并集用 `./src/...` 形态 ⇒ 零记录（证明判据的 `startswith` 分支真的在起作用，⛔ 不是"反正都会绿"）。
   d) **缺值**：读不出并集 ⇒ 零记录 + NOT-EVALUATED（未测量 ≠ 不合格）。
   e) **判据三态**：载体副本删该记录 ⇒ exit 1；移走载体 ⇒ exit 3；与 exit 0 并列留档。
9. **夹具与自检**：新步骤要有 hermetic 正/负控制（同既有 `--selfcheck` 形态）并进套件；正控制直接调
   **产品函数** `write_ac249_record()`，⛔ 不让夹具复刻判定逻辑（硬规则 4 推论三：只能被夹具复刻满足的判据不算被测）。
   若引入新脚本，同步三处注册面（capability-catalog / outline / laydown）。

**⚠️ 已知陷阱（先看一眼，省几小时）**：

- **`git show --name-only <merge>` 输出为空**：fan-in 后目标项目的 master 上会有 merge 提交，`ac207_commit_files`
  对 merge 返回空 ⇒ 并集枚举必须 `--no-merges`（或按分支两点差），否则"任务明明改了代码"却读到空并集
  （硬规则 3b：读不懂输入 ⇒ 伪装成没改）。
- **主检出里的 `packages/quay/plugin/` 是 9-10 遗留的生成残件**，从源码树跑 CLI 时它可能赢得 walk-up 从而遮蔽真
  `plugin/`（既有实证）⇒ 取证前先核 CLI 实际解析到的 plugin root 是哪一个。
- **`verify-deliver-coldstart.sh` 的 `$SCRIPT_DIR` 依赖是手工 scp 枚举的**：若新增对同目录 sibling 文件的依赖，
  必须同步改 `develop-deliver-tgz.sh` 的随行清单，否则远端恒 unreadable 而本机 selfcheck 照样绿（既有实证）。
- **本任务与 AC-248 的步骤必须在同一趟 e2e 里产出**（AC-249 正文逐字："两条都绑在同一次驱动产出上"）
  ⇒ 若 AC-248 的生产者尚未落地，本任务先到"机制 + 夹具 + 负控制"这一层，真跑读数待其落地后补：
  frontmatter 的前序边即为此设（指向 AC-248 的生产者任务）。

## Acceptance Criteria

- [x] **AC1 生产者存在且双向 fail-closed（能取假）**：`grep -c 'GOAL-016-AC-249' plugin/scripts/verify-deliver-coldstart.sh` ≥ 1；hermetic 自检打印三组读数原文——完整（代码+文档同任务）⇒ 写出 1 条；只代码 ⇒ **零记录**；只文档 ⇒ **零记录**（后两组各带可区分的 NOT-EVALUATED/INCOMPLETE-CHANGE 痕迹与退出码）。
- [x] **AC2 并集是并集，不是"最新一条提交"**：hermetic 负控制构造「代码提交在前、文档提交在后（最新 = 文档）」⇒ 产品实现**仍写出 1 条**，且同一夹具下用单条选择器（`ac207_select_implementation_commit`）跑 ⇒ **写不出**，两条读数并列留档；`grep` 证明写入路径不调用单条选择器来构造 `commit_files`（引用任一计数前先打印前 3 条实际内容，硬规则 2）。
- [x] **AC3 路径形态是直接量且穿过所有中间层**：留档证明 `commit_files` 里每条都是**仓库相对路径原样**（无 `./` 前缀、无绝对路径）；负控制：注入 `./src/x.ts` 形态的并集 ⇒ 零记录（证明 criterion 的 `startswith("src/")` 分支真在作用）。
- [x] **AC4 真跑真驱动（生产载体上的判据翻转）**：`/home/yale/work/quay/.quay/productization-verification.jsonl` 里存在 `ac=GOAL-016-AC-249` 的记录（打印该行原文 + 行数）；逐字段满足 criterion：host≠本机 ∧ project_root=ad-arm1 的 archguard ∧ task_id 非空 ∧ commit_files 非空 ∧ ≥1 条 `src/`|`scripts/` 前缀 ∧ ≥1 条含 `ADR-007`|`docs/adr` 前缀。随后在**生产 root** 下**逐字取 `goals/AC-249-*.md` 的判据干跑**：改前 exit 1、改后 exit 0，两条读数并列（翻转的成因是载体内容，⛔ 不是环境）。目标侧任务文本只给症状+复现入口+期望行为（附任务文本原文）。
- [x] **AC5 外部交叉核对（硬规则 4b）**：经 ssh 在 ad-arm1 上 `git -C /home/yale/work/archguard show --pretty=format: --name-only <该任务的全部提交>` 核验并集与记录里的 `commit_files` **逐条一致**；并核这两类路径确实分别在 `src/`（或 `scripts/`）与 `quay-adr/ADR-007.md`（或 `docs/adr/*`）下——命令与输出原文留档，⛔ 不采信载体自述（GOAL-016 非目标第一条：不推 origin ⇒ 只能经 ssh 取真读数）。
- [x] **AC6 未测量 ≠ 不合格，三态可区分**：并集读不出 ⇒ **零记录** + NOT-EVALUATED + 非 0（打印被拒的输入与返回码）；载体副本删记录 ⇒ exit 1、移走载体 ⇒ exit 3，与 exit 0 并列留档。
- [ ] **AC7 全量套件绿 —— 外层 verification-round 验证**（本条的量产生在 fan-in / 外层 suite 轮，⛔ 不是 worker 自己的读数；scoped 门绿不等于全量绿）

## Definition of Done

**AC-249 criterion 在生产载体上 exit 0**，且该记录是一次**真安装、真驱动、真读数**的产物：`task_id` 指向 ad-arm1 上
archguard 自己的 driver 驱动到 done 的那一个任务，`commit_files` 是**该任务全部提交的文件并集**（⛔ 不是单条提交、
⛔ 不是记账路径），**代码面（`src/`|`scripts/`）与文档面（含 `ADR-007`|`docs/adr`）同时非空**，
host 与 project_root 都指向外部项目。

⛔ 以下不算达成：

- 只改代码不改文档、或只改文档不改代码 ⇒ 判据 **exit 1**，⛔ 不得写记录（单边不算，逐字取自判据正文）；
- 用**单条**最新提交的文件冒充并集（本任务的缺陷面：一个完全合格的任务会被它判成恒假）；
- 用 `./src/...` / 绝对路径形态让 `startswith` 分支恒假，或反过来靠路径形态凑绿；
- 只在 worktree 的 `.quay/` 里自证，而生产 root 的载体上没有该记录；
- 用夹具 / 手写一条记录塞进载体（硬规则 4 推论三：能产出 ≠ 已产出）；
- 让"给 AC-249 看的"另一个任务产出这两个路径（必须是**同一次**驱动产出、同一个 task_id——判据正文逐字要求）；
- 在目标侧任务文本里写进根因/修法/正则所在行（GOAL-016 风险 4）。

## Touches

- plugin/scripts/verify-deliver-coldstart.sh
- plugin/scripts/develop-deliver-tgz.sh
- plugin/scripts/task-file-bypass-check.ts
- plugin/test/verify-deliver-coldstart.test.mjs
- plugin/test/develop-deliver-tgz-evidence-transport.test.mjs
- plugin/test/ac249-complete-change-record.test.mjs (new)
- .quay/productization-verification.jsonl
- tasks/gap-ac249-complete-change-code-doc-same-task-record.md

<!-- filed by the gap-filer for GOAL-016 AC-249; sibling producers: AC-247 takeover record, AC-248 adr-check flip record -->