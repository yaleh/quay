---
id: gap-fan-in-delta-scope-doc-only-skip
title: "fan-in delta-scope 缺口：闸门只看单轮 fan-in delta，代码经更早分支历史静默进 develop，从未跑全量轮（发生率 16-32）"
status: done
labels:
  - gap
  - mechanism
parent: null
children:
  - gap-fan-in-delta-scope-inventory-annotate
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
**⚠️ 发生率是【增长的】，不是历史存量（manager 2026-08-16 22:4xZ）**：立案（22:01:40Z）后 10 分钟，`gap-touches-one-entry-detector-not-enforcer` 又以 doc-only-delta（22:11:53Z）放走 precommit-guard.ts:65 的 import 改动；27 分钟后 concurrency-literal 的全量 suite 抓红（4 fails，单一根因 = 该 import）。**⇒ 闸门在持续放水，每轮 fan-in 都可能新增一条。优先级理由 = "持续放水" 而非 "存量 32"。**
**⚠️ 方法限度（⛔ 写入，别当确数）**：32 按任务体声明的 `## Touches` 数，非实际 diff——可能高估（声明了没真改）也可能低估（改了没声明）。**真值要逐任务 diff = 本任务第一条 AC**。16 vs 32 方法差已解：manager 把 `orchestration/` 当 doc，**我核实它是错的**——`tick-core-static-check.ts:69-76` 硬编码 5 个 `orchestration/*.md` 为输入，且该检查器测试在套件里跑 11 次 ⇒ **改 orchestration/*.md 能把套件弄红，它不是 doc**。⇒ **32 更接近真值**。

**⊢ 「doc」的判据定义（manager 22:0xZ 建议，本任务采用）**：**doc ≠ "文件名以 .md 结尾"或任何手写路径表**——doc 应该定义为「**没有任何套件检查器读这个路径**」。理由：手写正则表都会漂（manager 漏 orchestration/，下次可能漏 .claude/workflows/ 或 docs/references/），两个人各拍一张表不会比一个人拍得准。**可机械化形式**：套件检查器各自声明（或被枚举出）它读哪些路径 ⇒ **doc-only 的定义 = delta ∩ (所有检查器读的路径集合) = ∅**——这个集合可从代码算出，不用人维护。**取假**：往 `orchestration/manager-tick-core.md` 塞违反 (src:N) 的改动，若闸门仍判 doc-only ⇒ 判据假。

**⊢ 反向核（manager 特意做的，⛔ 别读成安全证据）**：历史上 `orchestration/*.md` 改动弄红套件的计数 = **0**。**这【不是】"所以它安全"的证据**（硬规则④：没发生过 ≠ 结构上不可能）。⛔ 别让这个 0 被读成「orchestration 归 doc 也没问题」。

**⚠️ 名单里两条刺眼（单独写）**：
- `gap-gitignored-carriers-absent-in-verify-worktree` → 改 `plugin/scripts/full-suite-runner.ts` + `scripts/test.sh`（**套件机器本身，自己没跑过全量轮**）
- `gap-not-yet-flipped-blocks-retreated-ac83-class` → 改 `packages/quay/src/gate/lifecycle.ts`（**产品代码 gate 生命周期**）

## Acceptance Criteria

- [x] AC1: **枚举存量（修法之前先数清）**——对 `per-task-suite-records.jsonl` 里所有「fullSuiteRan=false ∧ skipReason=doc-only-delta ∧ 从未 fullSuiteRan=true」的任务，逐任务 `git diff` 核对其实际改动的文件，**用「无套件检查器读该路径 = doc」的可计算定义**（枚举套件检查器读的路径集合，delta ∩ 该集合 = ∅ 才算 doc-only）判定，产出**确数清单**（任务 id + 实际改动的非 doc 路径）。AC1 以这份清单为准，⛔ 不以 Touches 声明数代替（那是 32 那个估计值），⛔ 不用手写路径正则表。**⚠️ 清单必须【带时间戳且可增量】——闸门还开着，今天数完明天就少一条（立案后已新增 12510d87/touches）⇒ ⛔ 别产出一个静态数字当结论。**
- [x] AC2: **修法**——fan-in delta 判定改看**分支整体相对 develop 的变更**（含更早进入分支历史的代码），不是单轮 fan-in 合并的 diff；且 doc-only 判定改用「无套件检查器读该路径」的可计算定义（枚举检查器读路径集合，非手写正则表）。取假一：代码在更早分支提交、fan-in 单轮 delta 只见 doc ⇒ 必须仍判需跑全量。取假二：`orchestration/manager-tick-core.md` 塞违反 (src:N) 的改动 ⇒ 不得判 doc-only。
- [ ] AC3: 修法后**新的** code 型 fan-in 不再出现「代码进 develop 但全量轮未覆盖」（判据：per-task-suite-records 新增记录中，Touches/实际 diff 声明非 doc 而 fullSuiteRan=false 的任务数为 0）。**⚠️ 时间窗必须从【修法落地之后】起算，⛔ 不用立案时刻**——已有一个立案后违例样本（`gap-touches-one-entry-detector-not-enforcer` @ 22:11:53Z，doc-only-delta skip 放走 precommit-guard.ts:65 改动），若用立案时刻会把它算进去判假。**⛔ 发生率是增长的（不是历史存量）：立案后 10 分钟又放走一条，闸门在持续放水。** 时间窗自本提交落地 develop 后起算，观察 per-task-suite-records 新增记录（待外部）
- [ ] AC4: **存量处置（拆为后继任务 `gap-fan-in-delta-scope-inventory-annotate`）**——AC1 枚举出的已 done 但未验证任务，逐个标注「落地未经全量轮验证」（如 manager 给 AC97 的 2df28ee4 样式）。**⛔ AC4 不在本任务做**：它写 `tasks/*.md`（目录级），与「本任务可派发」冲突（见 Touches 自锁说明）——拆到后继任务，等空窗跑（待外部）
  **⊢ 拆分原因（manager 2026-08-16 22:3xZ）**：本任务 Touches 曾含目录级 `tasks/*.md`，使本任务与任何在飞任务 self-touch 冲突 ⇒ 结构上永不可派（delta-scope 自身也是一把全局锁形状）。AC1-AC3 对 tasks/ 是**只读**（枚举/diff/判据），不需声明 `tasks/*.md`；仅 AC4 写 tasks/。AC4 拆出后本任务可派。

## Definition of Done

- [ ] delta 判定覆盖分支整体变更（已落地，AC2）；存量已枚举（AC1）但「已标注」拆至后继任务 gap-fan-in-delta-scope-inventory-annotate（AC4）；新 code 型 fan-in 不再漏覆盖需修法落地 develop 后观察（待外部）

## Evidence

**AC1 确数清单（带时间戳，2026-08-17T01:21:15Z，来源：main checkout `.quay/per-task-suite-records.jsonl` 94 条 + git 逐任务 diff + `isDocPath` 判定）**：
- 记录集：`fullSuiteRan=false ∧ skipReason=doc-only-delta ∧ 从未 fullSuiteRan=true` = **52 条 / 35 个去重任务**。
- **假跳过 21 个**（doc-only-delta skip 但实际改动了非 doc 文件）——含任务标题：DIR-103-B（packages/quay/src/gate/engine.ts 等）、gap-ac65、gap-ac66、gap-ac80、gap-ac81、gap-ac86、gap-ac88、gap-ac89、gap-ac90、gap-ac92、gap-ac93、gap-ac97-webui-zero-cost-gaps（**serve-handlers.ts——AC97 实证**）、gap-direct-to-develop-exclude-manager、gap-ff-livelock-trigger-no-action（fan-in-ff-merge.sh 等 5 文件）、gap-gitignored-carriers-absent（full-suite-runner.ts + scripts/test.sh——任务体点名刺眼条）、gap-quay-init-laydown（quay-init.sh）、gap-refresh-worktree-quay、gap-spec-reference-doc、gap-static-check-red-failures0、gap-tick-core-drift-fast-mode（16 个非 doc）、gap-touches-one-entry-detector-not-enforcer（**precommit-guard.ts——立案后新增违例样本**）。
- 真 doc-only 14 个；无 flip 0 个。
- ⚠️ 清单带时间戳且可增量（闸门在修法落地前仍开，枚举脚本逻辑见 `/tmp/ac1-enum2.mjs` 复算路径：git flip 提交 `翻 <task> done` → `git rev-list F --grep="develop.*into task/<t>"` 取最近 merge → `git diff M^2 F` 取实际改动文件 → `isDocPath` 分类）。

**AC2 修法落地**：
- `plugin/workflows/fan-in-execute.js` + `.claude/workflows/fan-in-execute.js`（双副本同步）step2：`delta=$(git diff --name-only "$fork" HEAD)` —— 分支整体相对 develop 的变更（含更早进入分支历史的代码），取代旧的 `git diff --name-only "$fork" ${mergeTarget}`（单轮 develop-side delta）。
- `code_delta=$(node --experimental-strip-types plugin/scripts/select-static-checks-for-touches.ts --classify-delta $delta) || code_delta="__CLASSIFY_FAILED__"` —— doc 判定由手写正则表改为**可计算定义**（解析 scripts/test.sh 每个 change/full 层检查器的 `@static-object` 声明 = 检查器读的路径集合；`orchestration/*-tick-core.md` 被 rhythm-consumer 读取 ⇒ 非 doc）。分类脚本失败 ⇒ fail-closed 重跑全量。
- `plugin/scripts/select-static-checks-for-touches.ts`：新增 `isDocPath()` + `--classify-delta` CLI 模式（复用 parseStaticCheckRegistry —— 单一事实源，非手写表）。

**测试（plugin/test/fan-in-execute-paths.test.mjs，28/28 绿）**：
- 取假一：分支更早历史代码（packages/quay/src/serve-handlers.ts）在 develop-side delta 只见 doc 时仍判 code ⇒ 需全量。
- 取假一 structural：delta 行必须 `diff --name-only "$fork" HEAD`，不得回退到 `develop`。
- 取假二：orchestration/manager-tick-core.md 判 code（非 doc-only）。
- doc 面（tasks/docs/adr/.quay/measurements/milestones）仍判 doc ⇒ 可跳过。

**跑测**：`bash scripts/test.sh --for-task gap-fan-in-delta-scope-doc-only-skip --allow-thin`（见提交信息 / 本任务 scoped 结果）。

## Touches

- plugin/workflows/fan-in-execute.js（step2 delta 判定范围：分支整体 delta + 可计算 doc 判定）
- .claude/workflows/fan-in-execute.js（双副本漂移——与 plugin/workflows 字节一致，workflows-dual-copy-drift-check 要求）
- plugin/scripts/select-static-checks-for-touches.ts（isDocPath 可计算 doc 判定 + --classify-delta CLI，fan-in step2 的实现落点）
- plugin/test/fan-in-execute-paths.test.mjs（取假对照：取假一 / 取假二）
- tasks/gap-fan-in-delta-scope-doc-only-skip.md（自身）

**⚠️ 拆分说明（manager 2026-08-16 22:3xZ，唯一可行路径）**：本任务 Touches **已去掉目录级 `tasks/*.md`**（AC4 拆到后继任务 `gap-fan-in-delta-scope-inventory-annotate`，见 AC4）。**拆分原因**：
1. **永久饥饿实证**：任何任务在飞 ⇒ `tasks/*.md` 目录级撞 self-touch ⇒ deferred；0 在飞 ⇒ assembleBatch 含它的团只能 {它自己}（大小 1），不含它的团大小 4 ⇒ 永远输。**不是等窗口，是永久轮不到。**
2. **AC1-AC3 对 tasks/ 只读**（枚举/diff/判据），不需声明 `tasks/*.md`；仅 AC4 写 tasks/。
3. **第二把锁（剩余，两持有者）**：本任务 touches `plugin/test/fan-in-execute-paths.test.mjs`，而 **`gap-concurrency-literal` 和 `gap-delivery-laydown` 两者**都声明目录级 `plugin/test/*` ⇒ **必须两者都 land 本任务才可派**（manager 逐个隔离验证：仅 ac100 在飞 ⇒ 可派 ✓；ac100+delivery ⇒ 仍 deferred）。**⛔ 别只盯 concurrency 一个**。拆完 ≠ 立刻可派；等 concurrency ∧ delivery 都 land。**⛔ 不再拆第二次**（fan-in-execute-paths.test.mjs 是 AC2 取假对照要真写的测试，声明诚实）。
4. **被 assembleBatch 静默丢弃的候选不进 deferred 不留理由（3b，manager 发现，发生率 1）**——0 在飞那轮 deferred=[] 而 delta-scope 被丢弃，正常读输出看不出来。
