---
id: gap-prose-prereq-negation-blind-and-paragraph-scoped
title: prosePrereqGap 按整段判且对否定盲：一句「⛔ 不另立 depends_on 边」把同段 5 个查重回链 id 全判成未声明前置 ⇒
  任务静默卡 todo，而查重回链正是立案 skill 强制要求写的
status: todo
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

- [ ] AC1 缺陷存证（改前读数）：贴两个样本各自的触发句原文与被误判的 id 列表；并贴 `prosePrereqRefs` 里 `paras.split` + `PREREQ_KEYWORD_RE.test(para)` + `para.matchAll(BACKTICK_ID_RE)` 三行，说明作用域是整段。
- [ ] AC2 同句约束（能取假）：构造两条夹具任务体——① 关键词与 id **同句** ⇒ 仍被判为前置；② 关键词与 id **同段不同句** ⇒ **不**被判。两个方向各贴读数。
- [ ] AC3 否定被认（能取假）：夹具「⛔ 不另立 depends_on 边：gap-x」⇒ 不判为前置；去掉否定词变「依赖 gap-x 先落地」⇒ 判为前置。贴两次读数。
- [ ] AC4 查重回链豁免：按 Plan 3 的标记写一段含 3 个 id 的回链 ⇒ 三者均不计为前置；把标记去掉 ⇒ 恢复原判定。贴两次读数。
- [ ] AC5 skill 已同步：`plugin/skills/quay-file-task/SKILL.md`（或其正本）写明该标记形态；`grep` 命中 ≥1 并贴出。⛔ 只改检测器不改 skill ⇒ 本条不算完成。
- [ ] AC6 真前置仍被抓（防改成恒绿）：取一条**真**声明前置却未写 `depends_on` 的夹具 ⇒ 仍被判为 prosePrereqGap 且任务不 eligible。贴读数——⛔ 这是本任务最关键的负控制。
- [ ] AC7 存量不回归：改后跑一次 `ready-pool-check --json`，`candidates[].prosePrereqGap` 对当前全部候选的判定与改前逐条对照，差异逐条说明为何是修复而非放宽。
- [ ] AC8 全量绿：`scripts/test.sh` 全量绿。

## Definition of Done

关键词与被引用 id 的关联收窄到句级，明确否认前置的措辞不再被判为声明前置，查重回链有机器可认的豁免形态且 skill 已同步；**真前置仍被抓**（AC6 负控制通过）。⛔ 放宽成「只有 `depends_on:` 字段才算声明」⇒ 不算达成（那等于废掉散文侧检测）；⛔ 只加关键词黑名单 ⇒ 不算达成（会随措辞漂移，且前一次「扩关键词集」正是本缺陷的放大因）。

## Touches

- plugin/scripts/ready-pool-check.ts
- plugin/test/ready-pool-check.test.mjs
- plugin/skills/quay-file-task/SKILL.md
- tasks/gap-prose-prereq-negation-blind-and-paragraph-scoped.md
