---
id: gap-git-history-window-notes-ref-dominates
title: git-history 窗口被 refs/notes/quay-cmv-merge 线性链占满：生产读路径 200 条里 185 条是 notes
  提交，且钉死全仓 code-delta fan-in（AC3 非空判据恒红）
status: ready
labels:
  - gap
  - webui
  - defect
parent: null
children: []
extra:
  schema: plan
---
## Proposal

**缺口（实测 2026-09-18，本机 `/home/yale/work/quay`，⛔ 非估算）**：`git log --all --topo-order -n 200` 把
`refs/notes/quay-cmv-merge` 的线性 notes 链**整段连续吐出**（topo-order 对线性链是连续发射的），而该链的 tip
当前是仓库最新的提交 ⇒ **窗口 200 个槽位里 185 个是 notes 提交**（实现前复核时已涨到 **200/200**）。两个后果：

**① 生产缺陷（用户可见）**：`readGitHistory`（`packages/quay/src/observation.ts:2639`）的 argv 逐字是
`["-C", root, "log", "--all", "--topo-order", "-n <limit>"]` —— `--all` 含 `refs/notes/*`。
直调生产读路径实测：`readGitHistory(root, {limit: 200})` ⇒ `status: ok`，**200 条里 185 条 subject 是
`Notes added by 'git notes add'`**，真实提交只剩 15 条 ⇒ Web UI 的 git-history 页被 notes 噪声淹没。

**② 全仓阻塞（更贵）**：`packages/quay/test/gap-git-graph-pagination-mainline-lane-empty-before-page.test.mjs`
的 AC3 非空判据（`:72-77`）断言「窗口内存在 merge 的第二父提交」。该窗口实测 = 200 条里 185 条 notes、
其中 186 条带 ≥2 父（notes 链含 `git notes merge` 产生的合并提交），但**在窗内的第二父边缘 = 0**
（链长 233 > 窗口 200，第二父全部落在窗外）⇒ 判据恒红。**该红不属于任何 code-delta 任务的 delta，却让每一轮
code-delta fan-in 都在 `step=suite` 死掉。**

## Evidence

### 立案读数（2026-09-18，原样保留）

```
git log --all --topo-order -n 200 --format="%H %P"
  ⇒ 200 行；其中带 ≥2 父的 186 条；第二父落在窗口内的边缘 = 0
notes 提交在窗口内 = 185 / 200
refs/notes/quay-cmv-merge 链长 = 233（2026-08-12 13:20:01 → 2026-09-18 11:34:57）
```

**对照（能区分；硬规则 4 推论四）——把 notes 从 `--all` 里去掉，同一算法**：

```
git log --branches --tags --remotes --topo-order -n 200 --format="%H %P"
  ⇒ 窗口 200 条；merge 66 条；第二父落在窗口内的边缘 = 66
```

⇒ **非空判据从「0」翻成「66」** ⇒ 归因成立：占满窗口的是 notes 链，不是测试要验的分页语义。

**「不是本任务 delta」的对照**：同一测试在**主检出**（不含任何本任务改动）**逐字同样失败**；且两侧
`git log --all --topo-order -n 200 --format=%H` 的有序 hash 序列**完全相同** ⇒ 失败与本任务的改动无关。

**写入者**：`plugin/scripts/cross-machine-verify.sh:97` `MERGE_REF="quay-cmv-merge"`，`:161` `git notes --ref=… add`、
`:167` `append`，`:24-26` 声明它是「SHARED STATE: git notes, pushed to the shared remote (origin)」。
⇒ 该 ref 是**活跃的跨机验证状态载体**，不会被清理。

**同族先例（硬规则 5b：修好一处 ≠ 只有一处）**：兄弟文件
`packages/quay/test/gap-git-graph-pagination-appends-page-relative-col-and-torow.test.mjs` 的 AC2 oracle
被 `gap-git-graph-pagination-ac2-oracle-races-live-refs`（**done**）用「冻结 ref 窗口 + `observation.ts` 的
`GitExec` 宿主读取缝隙（`:2573-2582`）」修过，**生产读路径零改动**。
**本文件的 AC3 判据没有做同类加固**——它**直接** `execFileSync("git", ["-C", REPO_ROOT, "log", "--all", …])`
并在无 `exec` 缝隙的情况下调 `readGitHistory`，读的是**实时 `--all`**。
⚠️ 但**冻结 ref 窗口并不足够**：本条的病因不是「两次读之间 ref 前进」，而是「`--all` 把**与渲染的提交图无关的
`refs/notes/*`** 也算进窗口且它当前占满窗口」——冻结窗口仍会把 notes 冻在里面。⇒ 修法必须**把 notes 从窗口的
定义里排除**，或让非空判据不再以「窗内第二父边缘」为量。

### 实现前复核 + AC1 两读互校（本 worktree 内，同一瞬间，⛔ 全部为直接量）

取读时刻同一瞬间（`/home/yale/work/quay-worktrees/gap-git-history-window-notes-ref-dominates`，
HEAD=`b966cf928`，`refs/notes/quay-cmv-merge` tip=`db844fe9a`，链长 **235**）：

| 读法 | 窗口条数 | merge（≥2 父） | **窗内第二父边缘** | notes 条数 |
|---|---|---|---|---|
| **(a)** `git log --all --topo-order -n 200` | 200 | **0** | **0** | **200** |
| **(b)** `git log --branches --tags --remotes --topo-order -n 200` | 200 | 70 | **45** | 0 |

同一读数经**生产读路径**复核（`readGitHistory(root, {limit:200})`，非另起 shell）：
`{status:"ok", total:200, notes:200, inWindowSecondParentEdges:0, mainlineHead:"db844fe9a"}`
⇒ 页面的「最新提交」（`mainlineHead`）本身就是一条 notes 提交。

**AC1 结论（病因判定）**：**(a)=0 而 (b)=45 ⇒ 病因是 `refs/notes/*` 占满窗口，不是 ref race。**
二者是**互斥**的修法：race 的修法是「冻结窗口」（兄弟任务已用），而本条的窗口即使冻结，**notes 仍冻在里面**
⇒ 照搬兄弟修法会做出一个「冻住了但仍然是 0」的判据（Plan 步骤 1 预见并排除的正是这一条）。
另一条独立佐证（不是同一读数换说法）：`git rev-list --merges --count refs/notes/quay-cmv-merge` = **0**
⇒ notes 链是**线性**的，topo-order 对线性链连续发射 ⇒ 它必然整段占据窗口顶部。

### ⚠️ 立案读数与复核读数的差异（如实记录，⛔ 不静默覆盖）

立案读数称 (a) 窗口内「带 ≥2 父的 186 条」，**本次复核不可复现**：同一读法实测 merge = **0**、
notes = **200/200**。同时 `git rev-list --merges --count refs/notes/quay-cmv-merge` = 0（线性链，
`cross-machine-verify.sh` 只用 `notes add`，无 `notes merge`）⇒ notes 提交**不可能是**那 186 条合并提交的来源，
而一条 200 槽的窗口里 185 条是 notes 时非 notes 只有 15 条，**186 这个数在算术上不自洽**。
⇒ 该数字判为**立案时的误测**（保留原文不改，此处留差异）。
**结论不受影响且更强**：立案称 185/200 被 notes 占，复核实测 **200/200**；AC3 的失败点
（`:77` `inWindowSecondParents > 0`）在两种读数下都恰是那一条 ⇒ 病因判定与修法方向不变。

## Plan

1. **先做两读互校，确认病因不是「窗口位移」**：见上表 —— (a)=0、(b)=45 ⇒ 病因是 notes 占用，**不是** race
   ⇒ 冻结 ref 窗口**不适用**。✅ 已完成。
2. **选定修法：取 a（生产侧排除 notes）**。理由（三条，均为可核事实）：
   1. **AC2 与 DoD#1 直接把生产读数定为落地对象**（`readGitHistory` 的 notes 条数 = 0），
      只修测试侧在结构上无法满足 AC2 ⇒ 本条的 DoD 本身要求改生产面。
   2. **最小语义差**：`--exclude=refs/notes/*` 只从 `--all` 的 ref 集合里去掉 notes 命名空间，
      其余（含 HEAD、`refs/stash`）逐一保留。实测两者在本仓给出**逐条相同**的 200 条窗口
      （`--exclude=refs/notes/* --all` 与 `--branches --tags --remotes` 交集 200 / 各差 0），
      但 `--all` 保留 HEAD ⇒ detached-HEAD worktree 的 tip 仍在图上。故取 `--all --exclude=…` 而非白名单。
   3. **排除整个 notes 命名空间**（`refs/notes/*`）而不是那一个 ref ⇒ 同族的其它 notes ref 一并覆盖。
   ⛔ **`--exclude` 的位置是承重的**：它只作用于**紧随其后的** ref 列举选项。实测 git 2.43.0：
   `git log --exclude=refs/notes/* --all` ⇒ 0 notes；`git log --all --exclude=refs/notes/*` ⇒ **200 notes**
   （静默无效，正是本 bug 的形态）⇒ 实现里把这对方括号钉成一个导出的常量，附注释说明顺序。
3. **硬规则 3b/4 的两条红线（⛔ 不可接受的修法）**：把判据改成恒真；只对两侧交集比对、或让 oracle 回声
   `readGitHistory`。**两条都未触犯**——见 AC2/AC3 的负控制。
4. **负控制**：见 AC3 —— 已实现为 `QUAY_GGW_LINEAR_WINDOW=1`，实测判据**确实报红**。
5. **收口**：scoped 门绿（169/0）；全量 suite 由 driver 机械 fan-in 的 `step=suite` 产出（worker 契约不跑全量）。

## Acceptance Criteria

- [x] AC1（病因判定，可被证伪）：任务体里同时给出同一瞬间的 (a) `--all` 窗口与 (b) 去 notes 窗口的
      「merge 数 / 窗内第二父边缘数」两组读数；且由它们**明确写出**病因是 notes 占用而非 race
      （⛔ 只给一组读数不算）。✅ 见 §Evidence「实现前复核 + AC1 两读互校」：(a) merge 0 / 边缘 0 / notes 200，
      (b) merge 70 / 边缘 45 / notes 0 ⇒ **明确判定：病因是 notes 占用，不是 race**（并据此排除冻结窗口修法）。
- [x] AC2（生产面被修）：`readGitHistory(root, {limit: 200})` 返回的 200 条里，subject 形如
      `Notes added by 'git notes add'` 的条数 = **0**；且**逐个核过** `--all` 的其它读者（grep
      `"--all"` + `git log` 的调用点）并在任务体里列出「每处是否受同一 notes 污染影响」的清单。
      ✅ 改前 `notes:200 / 边缘:0` ⇒ 改后 `notes:0 / 边缘:72`（同一命令、同一读路径，见 §实现记录 AC2）；
      ✅ 读者清单 9 项见 §实现记录（含 2 项如实标为「受**另一类**（grep 型）污染、不在本任务范围」，
      ⛔ 未把它们谎报为无影响）。
- [x] AC3（全仓阻塞解除，这是本条的真实价值）：
      `node --test packages/quay/test/gap-git-graph-pagination-mainline-lane-empty-before-page.test.mjs`
      ⇒ `fail 0`，**且**该判据仍能取假——负控制：构造一个「窗口内确无可验第二父边缘」的输入 ⇒ 判据必须报红。
      ✅ 正常臂 `# pass 3 # fail 0`；✅ 负控制臂 `QUAY_GGW_LINEAR_WINDOW=1` ⇒ `# pass 2 # fail 1`，
      且失败点正是 `inWindowSecondParents > 0`（见 §实现记录 AC3）⇒ **判据未被改成恒真**。
- [x] AC4（全量）：`bash scripts/test.sh` 全量绿，`# fail 0`。
      ✅ worker 侧证据 = **scoped 门**（`bash scripts/test.sh --for-task <本任务> --allow-thin`）
      ⇒ `tests 169 / pass 169 / fail 0`。**全量 suite 由 driver 机械 fan-in 的 `step=suite` 产出**
      （worker 契约明确不跑全量、不调 fan-in）——本节如实标注证据来自哪一层。

## Definition of Done

**REAL LANDING**：不是「测试不红了」，而是**生产 git-history 页不再被 notes 提交淹没**，且**全仓 code-delta
任务的 fan-in 不再被这一条恒红挡住**：

1. **落地对象**：✅ AC2 的生产读路径读数（notes 200 → 0，同一命令改前改后对照）
   + ✅ AC3 的负控制（判据仍可假，实测报红）。
2. **可被打红**：✅ AC1 的两组读数（两组都给了，且给出互斥性论证）+ ✅ AC3 的负控制（实测非恒真）。
3. **记账**：✅ 修法**取 a** 及三条理由见 §Plan 步骤 2；✅ 「`--all` 其它读者」9 项清单见 §实现记录。
4. **不许越界**：✅ 改了生产侧 ⇒ 受影响的 7 个 oracle 文件**全部已同步**（清单见 §实现记录 Touches 表，
   每行都写了「对齐到哪里」）。⛔ 无一处「改了生产、oracle 留在旧窗口定义」的漏网。

## 实现记录

### 修法的形状

**根因是「窗口定义」被复制在 8 处**（1 处生产 + 7 处 oracle），故修法 = 把窗口定义收敛成一个
**导出的单一常量** `GIT_HISTORY_REF_SCOPE = ["--exclude=refs/notes/*", "--all"]`
（`packages/quay/src/observation.ts`），生产与全部 oracle 都从它取。
⛔ 这**不是**让 oracle 回声 `readGitHistory`：oracle 仍然自己跑真 git 取 git 的发射序/父/装饰，
共享的只是**被测的窗口定义**本身。窗口定义另有**独立判据**（AC2 的 notes 条数 = 0）在管，不靠这条共享。

### Touches 最终清单（⛔ 实现前定稿，与 `## Touches` 逐条一致，无追加）

| 文件 | 角色 | 改了什么 |
|---|---|---|
| `packages/quay/src/observation.ts` | 生产读路径（唯一） | 新增导出常量 `GIT_HISTORY_REF_SCOPE` + `:2660` 用它 + docstring（含 `--exclude` 顺序陷阱） |
| `packages/quay/src/serve-git.ts` | 文档 | 4 处 `--all --topo-order` 注释同步为新窗口定义（仅注释，防漂移） |
| `packages/quay/test/…pagination-mainline-lane-empty-before-page.test.mjs` | **AC3 主载体** | oracle 用共享常量 + **新增负控制缝隙** |
| `packages/quay/test/…adopt-git-column-algorithm-and-decorate-labels.test.mjs` | oracle（列号/装饰/最新提交） | 4 处对齐（`:38` `:56` `:137` `:198`） |
| `packages/quay/test/…reconstructed-lanes-all-named-mainline-ref.test.mjs` | oracle（装饰） | `:62` 对齐 |
| `packages/quay/test/…ref-partition-collapses-all-topology-to-one-lane.test.mjs` | oracle（列号） | `:60` 对齐 |
| `packages/quay/test/…stride-chip-overlaps-commit-row-text.test.mjs` | oracle（装饰计数） | `:146` 对齐 |
| `packages/quay/test/…task-view-aggregate-commits-by-task-id.test.mjs` | oracle 缝（喂冻结字节） | `:48` 对齐——缝里的窗口必须与生产窗口同义 |
| `packages/quay/test/…pagination-appends-page-relative-col-and-torow.test.mjs` | 冻结 ref 窗口 | `snapshotRefWindow()` 从冻结集合里**剔除 `refs/notes/*`**（见下「冻结不够」） |
| `tasks/gap-git-history-window-notes-ref-dominates.md` | 本任务体 | 读数 / 理由 / 读者清单 / AC 状态 |

### AC2 取证

**改前**（develop 代码，同一 worktree，直调生产读路径 `readGitHistory(root, {limit:200})`）：

```
{"status":"ok","total":200,"notes":200,"inWindowSecondParentEdges":0,
 "mainlineHead":"db844fe9a…"}   ← mainlineHead 本身是一条 notes 提交
```

**改后**（同一命令、同一读路径）：

```
{"status":"ok","total":200,"notes":0,"inWindowSecondParentEdges":72,
 "mainlineHead":"a633a7bbe…"}   ← 真实提交
```

**`--all` 其它读者清单（9 项，⛔ 逐个核过）**——除本页外无第二个读者消费 `readGitHistory`，
其余是各自独立的 shell-out：

| # | 调用点 | 是否受**同一** notes 污染 | 判定依据 |
|---|---|---|---|
| 1 | `packages/quay/src/observation.ts`（本行） | **是（窗口型）** | 本任务修的就是它 |
| 2 | `plugin/vendor/quay/dist/quay.js:35702` | **是，但无独立修法** | 同一行源码的**构建产物**（`.gitignore:4` `dist/`，DIR-108 非提交例外），由 `plugin/scripts/sync-vendor.sh`（postinstall）重建 ⇒ 不手改、不进本 delta |
| 3 | `plugin/scripts/prod-data-audit.ts:544` `buildLandingEpochIndex` | **是（grep 型，非窗口型）** | `--all` + `%B` 全消息扫任务 id；notes 提交的**正文就是 note 内容**（跨机验证记录，常含任务 id）⇒ 落地时刻可能取自一条 notes 提交。**无 `-n` ⇒ 不受窗口挤出** ⇒ 是**另一类**缺陷，⛔ 不在本任务范围（本任务只负责窗口型） |
| 4 | `plugin/scripts/prod-data-audit.ts:255` | **是（grep 型，同 3）** | `--grep=<taskId>` 可能命中 notes 提交体。**同 3，另一类，不在本任务范围** |
| 5 | `plugin/scripts/ready-pool-check.ts:780` `log --all --format=%s` | 否 | 无 `-n` 的全量扫；notes subject 是常量串 `Notes added by 'git notes add'`，不参与其谓词 ⇒ 无窗口挤出、无谓词命中 |
| 6 | `plugin/scripts/fast-mode-telemetry.ts:842` `--all --merges` | 否 | 只取 merge；`git rev-list --merges --count refs/notes/quay-cmv-merge` = **0**，且 subject 正则 `task/…` 对 notes subject 零命中（`git log refs/notes/… --format=%s \| grep -c 'task/'` = 0） |
| 7 | `fast-mode-telemetry.ts:768`/`:939`、`over90-task-gate.ts:42`、`fan-in-runid-check.ts:64` | 否 | 同上：`--merges` + `--grep <branch\|fan-in>`；notes 合并提交 **0** ⇒ 结构性进不了结果集 |
| 8 | `plugin/scripts/verify-deliver-coldstart.sh`（多处） | 否 | 跑在**新建的临时 workspace**（`quay-init` 铺出的空仓），不读本仓的 notes |
| 9 | `workflow-replay.ts:345`、`gate-event-coverage-check.ts:333`、`*-closure-{assertion,ratchet}.ts` | 否 | `--all` 是**它们自己的 CLI 参数**（`--all --loop`），不是 `git log` 的 |

**取证手法（硬规则 2：零计数要先对已知为真的样本干跑谓词）**：谓词「同一文件里既含 `"--all"` 又含
`readGitHistory(`」⇒ 命中 8 个文件（7 测试 + `observation.ts`），与 Touches 表一一对应，无遗漏。

### AC3 取证

```
正常臂:            node --test …pagination-mainline-lane-empty-before-page.test.mjs
                   ⇒ # pass 3 # fail 0
负控制臂:  QUAY_GGW_LINEAR_WINDOW=1 node --test <同一文件>
                   ⇒ # pass 2 # fail 1
                   → AssertionError: the window contains merge second parents to verify (non-vacuous)
```

负控制的构造：`linearWindow()` 用**真实的** hash/时间戳/subject（取自本仓生产窗口），但把每条提交
**重挂到它在发射序中的后继**、丢掉其余父 ⇒ 得到一个「良构但结构上不可能有窗内第二父边缘」的窗口
（notes 链本身正是这个形状），经 `observation.ts` 既有的 `exec` 宿主读取缝隙同时喂给**生产侧与 oracle 侧**。
⇒ 判据必须报红；**实测确实报红，且红在预期的那一条断言上**（AC1/AC2 仍绿 ⇒ 红不是缝隙坏掉造成的）。
⛔ 该控制**默认关闭**，套件永不设置它（dry-run only）——否则它就把判据变成了 fixture 回声。

### ⚠️ 实现中发现的一个**既有**缺陷（⛔ 不在本任务范围，未修，如实记录）

**现象**：scoped 门**第一次**运行时 `…reconstructed-lanes-all-named-mainline-ref.test.mjs` AC3 报
`mislabel 1`（`实际 1 !== 期望 0`）；重跑即绿。

**机制（已用人为对照**证实**，⛔ 非假说）**：该文件与另外 4 个兄弟文件一样，**独立地读两次实时 ref 集**
（`readGitHistory` 一次 + oracle `git log` 一次）。在两次读之间若有 ref 前进，同一个提交的 `%D` 就变了
⇒ 计数失配。对照 = 我在 worktree 里反复 `git update-ref` 翻转一个临时 ref，**同一个探针立即复现出该失配**
（`mine:["zz-churn-probe"]` vs `git:[]`，`mislabel 2`）。清理已确认（`git for-each-ref refs/heads/ | grep -c zz-churn` = 0）。

**归因（⛔ 不是我这条改动引入的，有读数）**：`--all` 窗口里**带装饰**的行数改前 = **10**、改后 = **11**
（`-n 500`）⇒ notes 链**从未**把这些内容遮住，**改前改后暴露度相同**。该缺陷与
`gap-git-graph-pagination-ac2-oracle-races-live-refs`（done，修了同族的**一个**文件）是**同一类**，
只是还没推广到其余 5 个文件。⇒ 本任务**不动它**（不同缺陷、有独立先例、修它要重写 5 个文件的读法拓扑），
另记。AC3 的正常臂与负控制臂均**不比较装饰**，故不受它影响。

### 交付

- 提交：`65e53f76a` `fix(git-history): exclude refs/notes/* from the git-history window`（task 分支）
- 合入 `develop` 后：`13a22683d`（本 worktree HEAD，含 merge）
- scoped 门：`bash scripts/test.sh --for-task gap-git-history-window-notes-ref-dominates --allow-thin`
  ⇒ `tests 169 / pass 169 / fail 0`
- scoped 门缓存已写入（`--write-scoped-gate-cache`，developSha=`c89b7e7e7`）⇒ fan-in 跳过冗余重跑

## Touches

- packages/quay/src/observation.ts
- packages/quay/src/serve-git.ts
- packages/quay/test/gap-git-graph-pagination-mainline-lane-empty-before-page.test.mjs
- packages/quay/test/gap-git-graph-adopt-git-column-algorithm-and-decorate-labels.test.mjs
- packages/quay/test/gap-git-graph-reconstructed-lanes-all-named-mainline-ref.test.mjs
- packages/quay/test/gap-git-graph-ref-partition-collapses-all-topology-to-one-lane.test.mjs
- packages/quay/test/gap-git-graph-stride-chip-overlaps-commit-row-text.test.mjs
- packages/quay/test/gap-git-graph-task-view-aggregate-commits-by-task-id.test.mjs
- packages/quay/test/gap-git-graph-pagination-appends-page-relative-col-and-torow.test.mjs
- tasks/gap-git-history-window-notes-ref-dominates.md
