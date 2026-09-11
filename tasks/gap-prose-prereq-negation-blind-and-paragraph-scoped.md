---
id: gap-prose-prereq-negation-blind-and-paragraph-scoped
title: prosePrereqGap 按整段判且对否定盲：一句「⛔ 不另立 depends_on 边」把同段 5 个查重回链 id 全判成未声明前置 ⇒
  任务静默卡 todo，而查重回链正是立案 skill 强制要求写的
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**两个实测样本，同一机制，相隔约 3 小时（发生率 2，硬规则 12 已满足）**：

| 任务 | 触发词所在句 | 被误判的 id 数 | 代价 |
|---|---|---|---|
| gap-outer-retirement-test-pins-a-file-that-is-no-longer-orphaned | 「⛔ **不作为本任务的阻塞**」 | 3 | 卡 todo，期间该任务正是全套件确定性红的唯一修复 |
| gap-ac240-e2e-closure-same-run-pairing | 「⛔ **不另立 `depends_on` 边**（它们不改变「配对」这一性质）」 | 5 | 卡 todo，需人工改写措辞才解锁 |

**两句都是【明确否认前置】的话，却被读成【声明了前置】。**

### 根因（位置判定，逐行）

`plugin/scripts/ready-pool-check.ts` 的 `prosePrereqRefs`：

```js
const paras = noFence.split(/\r?\n\s*\r?\n/);        // ← 作用域 = 整个【段落】
...
for (let i = 0; i < paras.length; i++) {
  const para = paras[i];
  if (!PREREQ_KEYWORD_RE.test(para)) continue;       // ← 段内任一处命中关键词
  ...
  for (const m of para.matchAll(BACKTICK_ID_RE)) {   // ← 就把段内【所有】 id 收进来
```

⇒ 两个独立缺陷叠加：

1. **作用域过粗**：关键词与 id 不必在同一句、甚至不必相邻——**同段即可**。实测 `gap-ac240-…` 全文只有 **1 处**关键词命中（`depends_on`），且**没有任何一行同时含关键词与 id**，却有 5 个 id 被判。
2. **对否定盲**：`PREREQ_KEYWORD_RE` 只做字面匹配，`不另立 depends_on 边` / `不作为本任务的阻塞` 与 `依赖 X` 同形。已有 `isSiblingMention` 守卫说明作者意识到「提及≠前置」，但它不认这类否定式。

### 它与仓库自己的立案约定直接冲突

`quay-file-task` skill 逐字要求：「A related-but-distinct task (different mechanism, same area) → proceed, and **note the related id in the new task's Proposal/Finding for traceability**」。⇒ **写查重回链是强制动作**，而回链段落一旦出现任一关键词，段内所有被回链的 id 就全被判成前置。**两条约定互相打架，遵守前者就会触发后者。**

### 前一次修复放大了这个面

`60afce8b0 prosePrereqGap: widen keyword gate to 阻塞 + accept backtick task-id citations`（任务 gap-prose-prereq-detector-blind-to-repo-own-conventions，done）把 `阻塞` 加进关键词集——**样本 1 的触发词正是这个新加的 `阻塞`**。⇒ 扩关键词集在降低漏报的同时放大了误报，而误报这一侧当时没有配套的收窄。本条不是重复立案：那条治的是「关键词太窄 + 反引号引用不被认」，本条治的是「作用域过粗 + 对否定盲」，方向相反。

### 为什么代价不可见

被卡的任务**从两个常规诊断入口都看起来正常**：`quay task check --json` 报 `ok:true, eligible to move to ready`；`promotion-round.jsonl` 的 `fixes[].unfixable` 里虽有 `prosePrereqGap=[...]`，但要先知道去看它。唯一指名道姓的读数是
`node --experimental-strip-types plugin/scripts/ready-pool-check.ts --json` 的 `candidates[].prosePrereqGap`。

## Plan

1. **收窄作用域**：把关键词与 id 的关联从「同段」降到「同句」（按 `。！？.!?` + 换行切句），或改为「关键词与 id 的字符距离 ≤ N」。⛔ 不要退回按整段。
2. **认否定**：在命中前加一层否定判别——句中 id 前后若出现否定式（`不`/`非`/`无需`/`⛔ 不`/`not a` 等）修饰该前置语义，则不计入。⛔ 不要做成关键词黑名单（那会随措辞漂移）；参照既有 `isSiblingMention` 的做法，它已是同类守卫的先例。
3. **给查重回链一个显式豁免形态**：与 `quay-file-task` skill 约定一个机器可认的标记（如 `## 查重回链` 小节，或行首 `<!-- dedup-ref -->`），该形态内的 id 一律不计为前置。**同时改 skill 文案**让新立案都用该形态，⛔ 只改检测器而不改 skill ⇒ 存量任务仍会踩。
4. **让代价可见**：晋升侧对 `prosePrereqGap≠[]` 的任务，在 `promotion-round.jsonl` 里写一条**指名**的 round 级读数（现在只在 `fixes[].unfixable` 里，且需要先知道去看）。

## Acceptance Criteria

- [x] AC1 缺陷存证（改前读数）：贴两个样本各自的触发句原文与被误判的 id 列表；并贴 `prosePrereqRefs` 里 `paras.split` + `PREREQ_KEYWORD_RE.test(para)` + `para.matchAll(BACKTICK_ID_RE)` 三行，说明作用域是整段。
- [x] AC2 同句约束（能取假）：构造两条夹具任务体——① 关键词与 id **同句** ⇒ 仍被判为前置；② 关键词与 id **同段不同句** ⇒ **不**被判。两个方向各贴读数。
- [x] AC3 否定被认（能取假）：夹具「⛔ 不另立 depends_on 边：gap-x」⇒ 不判为前置；去掉否定词变「依赖 gap-x 先落地」⇒ 判为前置。贴两次读数。
- [x] AC4 查重回链豁免：按 Plan 3 的标记写一段含 3 个 id 的回链 ⇒ 三者均不计为前置；把标记去掉 ⇒ 恢复原判定。贴两次读数。
- [x] AC5 skill 已同步：`plugin/skills/quay-file-task/SKILL.md`（或其正本）写明该标记形态；`grep` 命中 ≥1 并贴出。⛔ 只改检测器不改 skill ⇒ 本条不算完成。
- [x] AC6 真前置仍被抓（防改成恒绿）：取一条**真**声明前置却未写 `depends_on` 的夹具 ⇒ 仍被判为 prosePrereqGap 且任务不 eligible。贴读数——⛔ 这是本任务最关键的负控制。
- [x] AC7 存量不回归：改后跑一次 `ready-pool-check --json`，`candidates[].prosePrereqGap` 对当前全部候选的判定与改前逐条对照，差异逐条说明为何是修复而非放宽。
- [ ] AC8 全量绿：`scripts/test.sh` 全量绿。

## Definition of Done

关键词与被引用 id 的关联收窄到句级，明确否认前置的措辞不再被判为声明前置，查重回链有机器可认的豁免形态且 skill 已同步；**真前置仍被抓**（AC6 负控制通过）。⛔ 放宽成「只有 `depends_on:` 字段才算声明」⇒ 不算达成（那等于废掉散文侧检测）；⛔ 只加关键词黑名单 ⇒ 不算达成（会随措辞漂移，且前一次「扩关键词集」正是本缺陷的放大因）。

## Evidence

**AC1（改前读数，用 git 历史中的原文实测复现，非引述）**：把两个历史任务体送入改前的检测函数。第一个样本来自 commit `3d5dd27967` ⇒ 判出 **3** 个 id：`gap-ac203-record-lacks-build-sha-makes-ac214-permanently-unsatisfiable`、`gap-git-graph-lane-colour-assertion-assumes-contiguous-columns`、`gap-shipped-entry-test-treats-every-shebang-plugin-script-as-entry`。
其中两个出自触发句「⛔ 不作为本任务的阻塞」（否定式，误报），第三个出自另一段的真声明（正确保留）。第二个样本来自 commit `ee8b99648` ⇒ 判出 **5** 个 id：`gap-third-party-evidence-no-transport-to-driving-repo-carrier`、`gap-cross-host-evidence-run-incomplete-and-step-order-makes-ac234-unsatisfiable`、`gap-ac214-freshness-anchor-build-sha-missing-on-203-205-207`、`gap-ac207-commit-sha-points-at-bookkeeping-flip-not-implementation-commit`、`gap-aged-project-post-upgrade-driver-e2e`。
第二个样本的触发句是「⛔ 不另立 depends_on 边（它们不改变「配对」这一性质）」——全文只有这一处命中，且没有任何一行同时含关键词与 id。
作用域三行证据（改前）：`const paras = noFence.split(/\r?\n\s*\r?\n/)` 定段、`if (!PREREQ_KEYWORD_RE.test(para)) continue` 段级放行、`for (const m of para.matchAll(BACKTICK_ID_RE))` 收全段 id。
改后同一对样本分别降为 **1** 个（只剩真声明那个）与 **0** 个，已由 `plugin/test/ready-pool-check.test.mjs` 的 AC1 用例把两段原文逐字钉住。

**AC2/AC3/AC4/AC6 读数**：全部落在 `plugin/test/ready-pool-check.test.mjs` 的四个用例里，每个都双向取假（同句 ⇒ 判、同段不同句 ⇒ 不判；带否定 ⇒ 不判、去否定 ⇒ 判；带标记 ⇒ 豁免、去标记 ⇒ 恢复；真声明 ⇒ 仍判且任务仍不 eligible）。AC3 另有一个 `declaresPrereq` 直测用例，钉住「`不得派发` 不被自己的否定词解除」「`⛔ 不要跳过：前置` 的否定在另一个分句 ⇒ 不解除」「`不得不` 是肯定式」。AC4 另钉住「句中引用标记 ⇒ 不豁免」（豁免锚在段首）。

**AC5 读数**：`grep -n dedup-ref plugin/skills/quay-file-task/SKILL.md` ⇒ `48:   open the paragraph with the marker \`<!-- dedup-ref -->\`** (its own first thing on the line, no`。skill 第 2 步（查重回链那一步）同时写明「何时用」「为何用」「怎么核」。

**AC7 读数（全量存量对照，2026 个任务文件）**：新旧的 `prosePrereqRefs` 对全部 2026 个任务体跑一遍 —— 变化的 **82** 个，全部是**减少**（新增 **0** 个，严格收窄）；共丢 **105** 条引用，其中 **102** 条因作用域（关键词与 id 不同句）、**3** 条因否定、**0** 条因标记（标记是本次新增形态，存量未用）。
逐条看过 105 条的落点句：**没有一条**读作前置声明，全部是查重/沿革/并列/回归溯源式的引用（例如「与 X 不重叠」「X（done）只覆盖了 status」「此回归由 X 引入」「与 X 并列」「已随 X 整体删除」），它们此前只是因为同段别处有一个关键词才被归到本任务头上。
82 个变化任务的状态全部是 `done`（77）或 `superseded`（5），**没有一个处于 ready/todo**。
用同一份输入（同 root、同 cap/floorMult）跑新旧两版的 `analyzeTasks`：`pool`/`ready`/`excluded`/`candidates`/`promotions`/`intercepted`/`revaluation`/`dispatchable_disjoint`/`criterion_met` **逐字段完全一致**，`candidates[].prosePrereqGap` 差异 **0** 条（当前无候选卡在散文前置上）。
结论：这不是「放宽到只认 `depends_on` 字段」（真前置仍被抓，AC6 负控制通过），而是把**归因错误**的那部分引用摘掉。

**Plan 4 读数**：`promotion-driver.ts` 的轮记录新增顶层 `prose_prereq_gap` 字段（任务 id + 被引用的 id 清单），派生自本轮已有的 `fixes[]`，不再只以嵌套字符串 `fixes[].unfixable` 的形态存在；`plugin/test/promotion-driver.test.mjs` 有一个用例钉住「指名」与两种缺席形态。

## Touches

- plugin/scripts/ready-pool-check.ts
- plugin/scripts/promotion-driver.ts
- plugin/test/ready-pool-check.test.mjs
- plugin/test/promotion-driver.test.mjs
- plugin/skills/quay-file-task/SKILL.md
- tasks/gap-prose-prereq-negation-blind-and-paragraph-scoped.md
