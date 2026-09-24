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

- [ ] AC1 复现固化：记录 `bash plugin/scripts/it0-split-or-commit-check.sh <repo-root>` 在**当前生产 root** 上的逐字输出与退出码，以及「它使静态层整体 fail-closed」的 CI 日志行（`STATIC_CHECK_FAILED … exit=1` 与 `static checks FAILED (fail-closed)`）。
- [ ] AC2 三值可区分：fixture「done 任务的 `depends_on` 含一条 `superseded`」⇒ 输出中出现**独立**读数，⛔ 既不与 `done` 合并、也不与 blocking 合并（硬规则 3b）。
- [ ] AC3 负控制·真样本仍红：同一 fixture 把该依赖换成 `todo` ⇒ **仍违规**（exit 1，或按选定读法对应的红态），且指名该依赖。⛔ 豁免不得扩成「任何非 done 都放行」。
- [ ] AC4 与 E6 的对应：结论节逐字引用 E6 的「不阻塞任何未来动作」，并给出**它今天为假的直接量**（即 AC1 的读数）；若选读法 ③，正面回应 E6 的语义论证。
- [ ] AC5 mutation case 仍能取假：`bash plugin/scripts/checker-mutation-cases/it0-split-or-commit-check.sh <workdir>` 通过；且把新规则**改坏**（注入缺陷）时它必须转红——⛔ 一个永不红的 mutation case 不是测量。
- [ ] AC6 生产载体：真实仓库上该 checker 的处置与选定读法一致。⚠️ 数据侧修复之后它**本就为绿** ⇒ ⛔ **不得**把它当作「机制生效」的证据（硬规则 4 推论三）；机制生效的证据是 AC2/AC3/AC5。

## DoD

- REAL LANDING：选定读法在真实仓库上生效，**且** mutation case 仍能取假（AC5），**且**本文件/帮助/注释里对该规则的描述与选定读法一致（⛔ 不留一处仍写着旧口径的措辞——硬规则 5b），**且** E6 那句「不阻塞任何未来动作」若仍为假，已在结论里被明确更正（⛔ 不得让一条被证伪的判据留在档案里继续当有效）。
- ⛔ 不以「fixture 绿了」为落地。

## Touches

- plugin/scripts/it0-split-or-commit-check.ts
- plugin/scripts/checker-mutation-cases/it0-split-or-commit-check.sh
- tasks/gap-it0-dep-done-iff-deps-blind-to-superseded.md

（若选定读法 ①，`done` 翻转侧的载体——由实现者定位，可能含 `plugin/scripts/worker-fan-in.ts` 或 `driver-filters.ts`——必须在派发时**补进本 `## Touches`**，⛔ 不得在未申报的情况下写它。）