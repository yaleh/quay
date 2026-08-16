---
id: gap-fan-in-delta-scope-doc-only-skip
title: "fan-in delta-scope 缺口：闸门只看单轮 fan-in delta，代码经更早分支历史静默进 develop，从未跑全量轮（发生率 16-32）"
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：manager 2026-08-16 21:5xZ（发生率 16，我复算 32）+ AC97 实证（21:3xZ 发现）。

**问题**：`fan-in-execute.js` step2 的 delta 判定（`:86-89`）用 `git diff --name-only "$fork" $mergeTarget` 只看**本轮 fan-in 合并引入的 delta**。当任务的代码改动在**更早的分支历史**里已随分支进入 develop（如 AC97：fae3322f 改 serve-handlers.ts 在分支上，767c574d 是 develop→branch 合并，21a09091 最终 branch→develop 时 step2 的 diff 只剩 5 个 tasks/*.md），闸门看到 doc-only delta ⇒ 判 `doc-only-delta` 跳过全量 suite ⇒ **生产代码落地 develop 后从未被全量轮覆盖**。记录器诚实（`fullSuiteRan:false` + `skipReason`），⛔ 不改记录器——错的是接受它的闸门。

**实证（AC97，git 直接读）**：
```
fae3322f（serve-handlers.ts，4 行）在 AC97 分支
767c574d（21:28:42）= develop→branch 合并（非代码上 develop）
round222（21:11，验 48fda354）不覆盖 fae3322f（--is-ancestor NO）
21a09091（21:31）= branch→develop fan-in 最终合并，step2 delta 只见 5 个 tasks/*.md
⇒ 分类器诚实判 doc-only-delta，serve-handlers.ts 改动从未被全量轮验证
```

**发生率（per-task-suite-records.jsonl 实读，83 条记录）**：
```
fullSuiteRan=false      64 条（doc-only-delta 57 / no-develop-delta 6 / empty-delta 1）
涉及不同任务            47 个
从未跑过全量轮          34 个
doc-only-delta 跳过 + Touches 声明非 doc 路径   32 个（我数）/ 16 个（manager 数）
```
**⚠️ 方法限度（⛔ 写入，别当确数）**：32 按任务体声明的 `## Touches` 数，非实际 diff——可能高估（声明了没真改）也可能低估（改了没声明）。**真值要逐任务 diff = 本任务第一条 AC**。16 vs 32 方法差已解：manager 把 `orchestration/` 当 doc，**我核实它是错的**——`tick-core-static-check.ts:69-76` 硬编码 5 个 `orchestration/*.md` 为输入，且该检查器测试在套件里跑 11 次 ⇒ **改 orchestration/*.md 能把套件弄红，它不是 doc**。⇒ **32 更接近真值**。

**⊢ 「doc」的判据定义（manager 22:0xZ 建议，本任务采用）**：**doc ≠ "文件名以 .md 结尾"或任何手写路径表**——doc 应该定义为「**没有任何套件检查器读这个路径**」。理由：手写正则表都会漂（manager 漏 orchestration/，下次可能漏 .claude/workflows/ 或 docs/references/），两个人各拍一张表不会比一个人拍得准。**可机械化形式**：套件检查器各自声明（或被枚举出）它读哪些路径 ⇒ **doc-only 的定义 = delta ∩ (所有检查器读的路径集合) = ∅**——这个集合可从代码算出，不用人维护。**取假**：往 `orchestration/manager-tick-core.md` 塞违反 (src:N) 的改动，若闸门仍判 doc-only ⇒ 判据假。

**⊢ 反向核（manager 特意做的，⛔ 别读成安全证据）**：历史上 `orchestration/*.md` 改动弄红套件的计数 = **0**。**这【不是】"所以它安全"的证据**（硬规则④：没发生过 ≠ 结构上不可能）。⛔ 别让这个 0 被读成「orchestration 归 doc 也没问题」。

**⚠️ 名单里两条刺眼（单独写）**：
- `gap-gitignored-carriers-absent-in-verify-worktree` → 改 `plugin/scripts/full-suite-runner.ts` + `scripts/test.sh`（**套件机器本身，自己没跑过全量轮**）
- `gap-not-yet-flipped-blocks-retreated-ac83-class` → 改 `packages/quay/src/gate/lifecycle.ts`（**产品代码 gate 生命周期**）

## Acceptance Criteria

- [ ] AC1: **枚举存量（修法之前先数清）**——对 `per-task-suite-records.jsonl` 里所有「fullSuiteRan=false ∧ skipReason=doc-only-delta ∧ 从未 fullSuiteRan=true」的任务，逐任务 `git diff` 核对其实际改动的文件，**用「无套件检查器读该路径 = doc」的可计算定义**（枚举套件检查器读的路径集合，delta ∩ 该集合 = ∅ 才算 doc-only）判定，产出**确数清单**（任务 id + 实际改动的非 doc 路径）。AC1 以这份清单为准，⛔ 不以 Touches 声明数代替（那是 32 那个估计值），⛔ 不用手写路径正则表。
- [ ] AC2: **修法**——fan-in delta 判定改看**分支整体相对 develop 的变更**（含更早进入分支历史的代码），不是单轮 fan-in 合并的 diff；且 doc-only 判定改用「无套件检查器读该路径」的可计算定义（枚举检查器读路径集合，非手写正则表）。取假一：代码在更早分支提交、fan-in 单轮 delta 只见 doc ⇒ 必须仍判需跑全量。取假二：`orchestration/manager-tick-core.md` 塞违反 (src:N) 的改动 ⇒ 不得判 doc-only。
- [ ] AC3: 修法后**新的** code 型 fan-in 不再出现「代码进 develop 但全量轮未覆盖」（判据：per-task-suite-records 新增记录中，Touches/实际 diff 声明非 doc 而 fullSuiteRan=false 的任务数为 0）。
- [ ] AC4: **存量处置**——AC1 枚举出的已 done 但未验证任务，逐个标注「落地未经全量轮验证」（如 manager 给 AC97 的 2df28ee4 样式），并判定是否需补跑全量轮。

## Definition of Done

- [ ] delta 判定覆盖分支整体变更；存量已枚举 + 已标注；新 code 型 fan-in 不再漏覆盖。

## Touches

- plugin/workflows/fan-in-execute.js（step2 delta 判定范围）
- plugin/scripts/per-task-suite-record.ts（若需记录「未验证」标记）
- plugin/test/fan-in-execute-paths.test.mjs（取假对照）
- tasks/*.md（AC1 枚举出的存量任务加「未验证」标注）
- tasks/gap-fan-in-delta-scope-doc-only-skip.md（自身）
