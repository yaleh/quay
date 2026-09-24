---
id: gap-it0-dep-done-iff-deps-blind-to-superseded
title: it0-split-or-commit-check 的 DEP-DONE-IFF-DEPS：E6
  判定的「不阻塞任何未来动作」已被实测证伪——单条陈旧退役边使全店静态层 fail-closed，阻塞每个提交与 release
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

**这一条不是「没人想到」，而是「想到过、逐字论证过、而那次论证的前提今天被实测证伪」。**

**前身裁定（逐字转引，`tasks/gap-superseded-dependency-blocks-dispatch-forever.md` 的 `### E6` 节）**：该任务在修「superseded 依赖不阻塞」时做了 5b 扫描，并**逐字审过**本 checker 的同一处（`plugin/scripts/it0-split-or-commit-check.ts:367` 的 `if (depStatus !== "done")`），判为**不适用**，理由原文：

> 该处判的不是「某任务能否准入/派发」，而是**对已 done 任务的回溯不变量**（`DEP-DONE-IFF-DEPS`：一个已 done 的任务，其 `depends_on` 前置必须都已 done）。两个判定的作用方向相反：本条的四点都在回答「**这件事能不能往前走**」（准入/派发/选择），把退役前置当「活的未满足前置」会让工作**永久停摆**；而 it0 那处在回答「**过去那次落地是否自洽**」，把退役前置算成「未满足」恰好**正是它该报的信号**（一条指向已退役前置的陈旧边值得浮出来给人改），**且它不阻塞任何未来动作**。⇒ 判为**不适用**。

**那次判定的语义半边今天仍然成立**（陈旧退役边值得浮出来给人改——本条的数据侧处置正是照此做的：把退役边换成其后继）。**但它的代价半边已被实测证伪**：

```
2026-09-24T04:38Z 起，develop 上【每一个】提交的 CI：
  STATIC_CHECK_FAILED: it0-split-or-commit-check exit=1
  checker-cost-lib: run_checker_parallel_wait — static checks FAILED (fail-closed)
  ⇒ `Run tests` 38 秒即退出，`node --test` 一行都没跑
本地逐字复现：
  $ bash plugin/scripts/it0-split-or-commit-check.sh <repo-root>
  FAIL: 1 split-or-commit violation(s) found:
    - DEP-DONE-IFF-DEPS: task "gap-ac194-production-criterion-owner" is done but has 1 non-done
      prerequisite(s) in depends_on:
      gap-reflog-fetch-form-unclassified-breaks-direct-to-develop-check (status: superseded)
  exit=1
```

⇒ 「**不阻塞任何未来动作**」这句话现在**是假的**：该规则以**全店不变式**注册在 `scripts/test.sh` 的 full-suite 静态层（`--changed` 的 delta 伴随模式只覆盖 scoped 门），**单条陈旧边即可让静态层整体 fail-closed**，从而阻塞每一个提交、每一个需要绿套件的落地，以及 release。全店扫描（2415 个任务，`status` + `depends_on` 全量配对）：**只有这 1 对**。

**根因是一个不对称，不是一个缺失**：这条不变式只在**读时**（全店、阻塞一切）被判，**不在写时**被判——把它引入的那次动作是 driver 的**机械 `done` 翻转**（`1ce02913f`，2026-09-24T04:38Z），而该翻转**不查** `DEP-DONE-IFF-DEPS`。⇒ **写者可以造出读者必然 fail-closed 的状态**，而没有任何一处实时拦住它。

**一个必须由实现者判定的设计岔口（⛔ 不要默认选边；选定后把理由与负控制写进结论）**：

- **读法 ①（写时门）**：让 `done` 翻转**先过这条不变式**，不合规即拒绝翻转（任务留在 `ready`）。⇒ 违规状态**结构上无法被引入**。代价：翻转路径新增一次全店判定，且需要一个「陈旧边该由谁改」的出口。
- **读法 ②（读时不全局化）**：保留「浮出陈旧边」这个**信号**（E6 判定的本意），但把它从「整层 fail-closed」降为**可区分的、带修复指引的读数**（指名后继任务 id），使它能被抓到而不拖垮无关提交。⛔ 不得把 retired 静默当成 `done`（那会把「它的前提没了」伪装成「它的前提做完了」，硬规则 3b 的反方向）。
- **读法 ③（豁免 retired）**：与 E6 判定的**本意相反**（那正是它要浮出的信号）⇒ 若选它，必须在结论里正面回应 E6 的语义论证，⛔ 不得写成「第三个消费者忘了跟上」（该说法与 E6 的逐字记录矛盾）。
- **读法 ④（不改机制）**：认定 checker 正确，靠**数据卫生**兜底。那么本任务范围收窄为：给「陈旧退役边」一个**发现即修复的载体**（谁在何时改了哪条边、留痕），否则下一次同类边仍会让 CI 全红。

## Plan

1. 先**复现并固化**当前读数（AC1），再选定读法（①–④），并把理由与 E6 论证的对应关系写进结论节。
2. 按选定读法改判定，⛔ 不新写第二份依赖判定：优先复用 `driver-filters.ts` 的 `judgeDeps` / `judgeDepStatus`（`ready-pool-check.ts` / `portfolio-choice.ts` 已是同一做法）；若该 import 会造成新的环或反向边（`plugin/scripts/import-graph-check.ts` 会拦），则在同文件内实现**同一口径**并在注释里指名它 mirror 的来源。
3. `--selftest` 补三个方向（ADR-018 selfcheck-fixture）：① retired 前置 ⇒ 按选定读法给出**可区分**输出；② `todo` / `needs-human` 前置 ⇒ **仍然违规**（负控制：豁免不得扩成「任何非 done 都放行」）；③（选读法①时）翻转被拒后任务**仍在 `ready`**，且理由指名那条边。
4. 生产读数落地。

## AC

- [x] AC1 复现固化：记录 `bash plugin/scripts/it0-split-or-commit-check.sh <repo-root>` 在**当前生产 root** 上的逐字输出与退出码，以及「它使静态层整体 fail-closed」的 CI 日志行（`STATIC_CHECK_FAILED … exit=1` 与 `static checks FAILED (fail-closed)`）。
- [x] AC2 三值可区分：fixture「done 任务的 `depends_on` 含一条 `superseded`」⇒ 输出中出现**独立**读数，⛔ 既不与 `done` 合并、也不与 blocking 合并（硬规则 3b）。
- [x] AC3 负控制·真样本仍红：同一 fixture 把该依赖换成 `todo` ⇒ **仍违规**（exit 1，或按选定读法对应的红态），且指名该依赖。⛔ 豁免不得扩成「任何非 done 都放行」。
- [x] AC4 与 E6 的对应：结论节逐字引用 E6 的「不阻塞任何未来动作」，并给出**它今天为假的直接量**（即 AC1 的读数）；若选读法 ③，正面回应 E6 的语义论证。
- [x] AC5 mutation case 仍能取假：`bash plugin/scripts/checker-mutation-cases/it0-split-or-commit-check.sh <workdir>` 通过；且把新规则**改坏**（注入缺陷）时它必须转红——⛔ 一个永不红的 mutation case 不是测量。
- [x] AC6 生产载体：真实仓库上该 checker 的处置与选定读法一致。⚠️ 数据侧修复之后它**本就为绿** ⇒ ⛔ **不得**把它当作「机制生效」的证据（硬规则 4 推论三）；机制生效的证据是 AC2/AC3/AC5。

## DoD

- REAL LANDING：选定读法在真实仓库上生效，**且** mutation case 仍能取假（AC5），**且**本文件/帮助/注释里对该规则的描述与选定读法一致（⛔ 不留一处仍写着旧口径的措辞——硬规则 5b），**且** E6 那句「不阻塞任何未来动作」若仍为假，已在结论里被明确更正（⛔ 不得让一条被证伪的判据留在档案里继续当有效）。
- ⛔ 不以「fixture 绿了」为落地。

## Evidence（结论 + 落地读数）

**选定读法：②（读时不全局化）** —— 保留 E6 的「信号」半边（陈旧退役边值得浮出来给人改），只去掉它被实测证伪的「代价」半边（「不阻塞任何未来动作」）。⛔ 不是读法 ③：E6 的语义半边是对的，本条正是照它做的（退役边**仍然**被浮出来，并附修复指引）。⛔ 也**不**写成「第三个消费者忘了跟上」—— E6 当时是**逐字审过**这一处的（原文见 AC4 段），它的结论只建立在一个今天被实测证伪的前提上。

### AC1 — 复现固化（authentic CI 日志 + 逐字复现）

filing 当轮的 CI（run `35956518852` / job `107495895218`，`headBranch: develop`，`createdAt 2026-09-24T04:38:39Z`；下列为 `gh run view --job 107495895218 --log` 的逐字行）：

```
2026-09-24T04:39:08.1897481Z FAIL: 1 split-or-commit violation(s) found:
2026-09-24T04:39:08.1899719Z   - DEP-DONE-IFF-DEPS: task "gap-ac194-production-criterion-owner" is done but has 1 non-done prerequisite(s) in depends_on: gap-reflog-fetch-form-unclassified-breaks-direct-to-develop-check (status: superseded) — a done task requires ALL its depends_on prerequisites done (gap-prerequisite-gates-prose-invisible-to-mechanisms)
2026-09-24T04:39:11.7048968Z STATIC_CHECK_FAILED: it0-split-or-commit-check exit=1
2026-09-24T04:39:11.7050243Z checker-cost-lib: run_checker_parallel_wait — static checks FAILED (fail-closed): it0-split-or-commit-check(exit=1)
```

⚠️ 关于本条的证据来源，如实登记：本地 `.quay/verification-round.jsonl` 里同一 checker 的 17 条 `STATIC_CHECK_FAILED: it0-split-or-commit-check exit=1` 最新一条是 `2026-09-04T08:16:12Z`（`reason: gate-failed`），属**更早**一次同形事故 ⇒ 本地台账**不是**本条时段的载体，故「静态层整体 fail-closed」一行引 CI 原文（`static checks FAILED (fail-closed)`）。

逐字复现（**pre-fix 代码** + filing 当时的真实形态；pre-fix 副本取自 `git show HEAD~1:plugin/scripts/it0-split-or-commit-check.ts`，跑完以 `git checkout --` 还原，`git status --porcelain` 复核为空）：

```
$ node --experimental-strip-types plugin/scripts/it0-split-or-commit-check.ts <filing-time 形态的 store>
FAIL: 1 split-or-commit violation(s) found:
  - DEP-DONE-IFF-DEPS: task "gap-ac194-production-criterion-owner" is done but has 1 non-done prerequisite(s) in depends_on: gap-reflog-fetch-form-unclassified-breaks-direct-to-develop-check (status: superseded) — a done task requires ALL its depends_on prerequisites done (gap-prerequisite-gates-prose-invisible-to-mechanisms)
exit=1
```

**当前生产 root**（数据侧已修复后）：`bash plugin/scripts/it0-split-or-commit-check.sh <repo-root>` ⇒ `PASS: 2416 task(s) checked — no split-or-commit violations …`、exit 0（worktree root 与主检出 root 各跑一次，均 0）。⚠️ 这个绿**不是**机制生效的证据（硬规则 4 推论三）——机制证据是下面的 AC2/AC3/AC5。

### AC4 — 与 E6 的逐字对照（结论）

E6（`tasks/gap-superseded-dependency-blocks-dispatch-forever.md` 的 `### E6` 节）原文逐字：

> 而 it0 那处在回答「**过去那次落地是否自洽**」，把退役前置算成「未满足」恰好**正是它该报的信号**（一条指向已退役前置的陈旧边值得浮出来给人改），**且它不阻塞任何未来动作**。⇒ 判为**不适用**。

**「且它不阻塞任何未来动作」今天为假的直接量 = AC1 的读数**：该判定以**全店不变式**注册在 `scripts/test.sh` 静态层（`--changed` 的 delta 伴随只覆盖 scoped 门，覆盖不到全店），**单条**陈旧边即让静态层整体 fail-closed，`Run tests` 38 秒退出、`node --test` 一行没跑 ⇒ 它阻塞了**每一个提交**、每一个需要绿套件的落地，以及 release。全店扫描（2415 个任务，`status` + `depends_on` 全量配对）：**只有这 1 对**。

**已在载体里更正**：commit `1005cd696` 经 Provider ABI（`quay-native task edit --append-notes`）在该任务 `### E6` 之后追加了一节 `## 2026-09-24 E6 的「代价半边」已被实测证伪（更正…）`，沿用本仓既有的「证伪（唯一保留处）」体例（`tasks/gap-fan-in-turn-budget-suite-timeout.md`）：**保留语义半边、只下修被证伪的代价半边**。该文件因此补入本任务 `## Touches`（本任务选定读法 ② ⇒ ⛔ 不涉及 `done` 翻转侧载体，无需按原文那段补 `worker-fan-in.ts`/`driver-filters.ts`）。

### AC2 — 三值可区分（硬规则 3b）

`--selftest` 的 `three-valued-done-with-superseded-dep` 用例（fixture：done 任务的 `depends_on` 含一条 `superseded`）：

```
SELFTEST PASS: three-valued-done-with-superseded-dep — correctly found no violations + 1 retired advisory readout(s)
  retired: RETIRED-DEP: task "dependent-done" is done and has 1 retired (superseded) prerequisite(s) in depends_on: retired-dep (status: superseded) — ⚠️ no successor is recorded for it in this store (…) — a retired prerequisite does NOT block and ⛔ is NOT counted as done; reported for visibility only, NOT a violation
```

该读数**独立成块**（CLI 输出里是 `ADVISORY —` 段）：⛔ 不与 `done` 合并（没有静默当成 satisfied），⛔ 也不与 blocking 合并（**不出现在** `FAIL:` 的 violation 列表里）。用例以**位置判定**钉住这件事 —— `retiredIncludes` 命中 ⇒ 该 id **必须**在 retired 读数里（`id (status:` 槽位）且**不得**出现在任何 violation 行。

读法 ② 要求的「带修复指引的读数」已落实且**数据驱动**：退休任务记录了 `superseded_by` ⇒ 读数**指名后继**（`three-valued-retired-dep-with-recorded-successor`：`re-point the edge to its recorded successor "successor-task"`）；**没记录** ⇒ 如实说 `no successor is recorded`（`three-valued-retired-dep-without-recorded-successor`）。⛔ 两种事实**不共用输出**（硬规则 6：缺值 = 未查，不得编一个后继出来）。

### AC3 — 负控制·真样本仍红

同一 fixture 把该依赖换成 `todo` ⇒ **exit 1**，violation 指名该依赖、且该 id **不在** retired 读数里：

```
SELFTEST PASS: three-valued-done-with-todo-dep — correctly detected 1 violation(s)
  violation: DEP-DONE-IFF-DEPS: task "dependent-done" is done but has 1 blocking prerequisite(s) in depends_on: todo-dep (status: todo) — …
```

另两条负控制：`needs-human`（同形，仍红）、**missing**（`three-valued-done-with-missing-dep` ⇒ 仍违规 —— ⛔「读不出」不得被当成 retired，fail-closed 保留）。最尖锐的一条是 `three-valued-mixed-retired-and-blocking`：同一 done 任务**同时**含一条 `superseded` 与一条 `todo` ⇒ violation **只**指名 todo 那条、retired 读数**只**指名 superseded 那条（两个状态同时可见、互不合并）。

### AC5 — mutation case 仍能取假

`bash plugin/scripts/checker-mutation-cases/it0-split-or-commit-check.sh <workdir>` ⇒ **exit 0**（基线 GREEN → 注入 blocking 依赖 RED → 还原 GREEN → 注入 retired 依赖 GREEN **且**读数可区分 → 还原 GREEN → mixed RED → 还原 GREEN → missing RED → 还原 GREEN）。框架侧同源读数：`bash plugin/scripts/checker-mutation-check.sh --check --only it0-split-or-commit-check` ⇒ `MUTATION it0-split-or-commit-check: pass`、`mutations_that_stayed_green: 0`、`mutations_that_always_red: 0`、`RESULT: PASS`。

**「把新规则改坏（注入缺陷）时它必须转红」——两个方向都实测**（注入后跑 mutation case，再 `git checkout --` 还原并复核 `git status` 为空）：

```
(a) 把 retired 折回 blocking（= 旧的布尔口径）⇒ MUTATION_CASE_EXIT=4  (ALWAYS-RED — …is still reported as blocking)
(b) 抑制 retired 读数（静默并入 done）       ⇒ MUTATION_CASE_EXIT=3  (STAYED-GREEN — …produced NO distinct RETIRED-DEP readout)
    控制（未注入）                            ⇒ MUTATION_CASE_EXIT=0
```

⇒ 该 mutation case 是新规则的**真测量**，不是恒绿的纹章（硬规则 4 推论三 / AC5 的 ⛔）。

### AC6 — 生产载体

真实仓库上该 checker 的处置与选定读法一致：whole-store `bash plugin/scripts/it0-split-or-commit-check.sh <repo-root>` ⇒ exit 0（无 violation）；把 filing 当时的形态重建后 ⇒ exit 0 **且**打出 `RETIRED-DEP:` 读数（即「退役 ⇒ 非阻塞、仍可区分」）。⚠️ 生产 root 的绿**本就如此**（数据侧已修复）⇒ ⛔ 不作为机制生效的证据；机制生效的证据是 AC2/AC3/AC5。

### 附 1 — 硬规则 5b 扫描（同一原则在本载体的其它适用点）

```
$ grep -rn "DEP-DONE-IFF-DEPS" --include=*.ts --include=*.sh --include=*.md .
→ 机制载体：本 checker 的 .ts/.sh + mutation case（均已改为三值口径）。
→ 其余命中只有【历史记录】，⛔ 不改（硬规则 8）：
   tasks/gap-prerequisite-gates-prose-invisible-to-mechanisms.md:110（描述当时口径的完成记录）
   tasks/gap-it0-split-or-commit-check-needs-change-tier-companion.md:74,157
   tasks/gap-superseded-dependency-blocks-dispatch-forever.md:218（其 E6 已由本任务更正）
   plugin/test/worker-driver-fan-in-s01.test.mjs:35（一条引用该规则名的注释）

$ grep -rn "all depends_on prerequisites done\|non-done prerequisite\|must all be done" \
      plugin/scripts/it0-split-or-commit-check.ts plugin/scripts/checker-mutation-cases/it0-split-or-commit-check.sh \
      plugin/scripts/runner-static-gate.ts scripts/test.sh
→ 0 hits（旧口径措辞在机制载体里已无残留）
```

### 附 2 — 机制读数（本次派发的一处偏差，如实登记）

派发 prompt 假定 MCP `task_write` 的勾选会「branch-aware 地自己提交」并「到达 fan-in 的 ac-precheck」。**实测不然**：`task_get`（MCP）读的是**主检出**的 store（以 `gap-superseded-dependency-blocks-dispatch-forever` 的追加节为探针：worktree 副本有、MCP 读回没有），而 fan-in 的 ac-precheck（`worker-fan-in.ts:1670` → `fan-in-ac-completion-gate.ts:110`）读的是 `<worktree>/tasks/<id>.md`。⇒ 勾选与 Evidence 必须**同时**落在两处：主检出（ABI 记录面）+ 任务分支（ac-precheck 的读取面，即本仓既有的 `tasks: carry the ABI-written task body onto the task branch` 体例）。本任务按该体例执行。

### 附 3 — 落地读数（scoped 门）

`bash scripts/test.sh --for-task gap-it0-dep-done-iff-deps-blind-to-superseded --allow-thin` ⇒ **EXIT=0**（scoped 静态检查全绿，含 `import-graph-check` 与 `checker-mutation-check --check-changed`；`ℹ tests 33 / pass 33 / fail 0`）。
`node --experimental-strip-types plugin/scripts/import-graph-check.ts --root <worktree>` ⇒ `valueSccs=0 ≤ 0, typeSccs=0 ≤ 0, reverseEdges=0 ≤ 0` ⇒ 复用 `judgeDeps` 的这条 import **没有**造成新的环或反向边（Plan 步 1 的「若该 import 会造成新的环或反向边则在同文件内实现同一口径」分支因此**未触发**）。

## Touches

- plugin/scripts/it0-split-or-commit-check.ts
- plugin/scripts/checker-mutation-cases/it0-split-or-commit-check.sh
- tasks/gap-it0-dep-done-iff-deps-blind-to-superseded.md

- tasks/gap-superseded-dependency-blocks-dispatch-forever.md

（原文那段：「若选定读法 ①，`done` 翻转侧的载体——由实现者定位，可能含 `plugin/scripts/worker-fan-in.ts` 或 `driver-filters.ts`——必须在派发时**补进本 `## Touches`**，⛔ 不得在未申报的情况下写它。」——**本任务选定读法 ②，不涉及翻转侧**。实际补入的唯一越界文件是上面第 4 条：AC4/DoD 要求在 E6 的**载体**里更正那条被实测证伪的判据，且已按原段的要求**先**补进本 `## Touches` 再写它。另：`tasks/gap-it0-dep-done-iff-deps-blind-to-superseded.md`（自身的勾选与 Evidence）经 Provider ABI 写入。）