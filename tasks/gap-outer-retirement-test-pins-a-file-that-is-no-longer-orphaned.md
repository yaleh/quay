---
id: gap-outer-retirement-test-pins-a-file-that-is-no-longer-orphaned
title: 全量套件确定性红 1 条：outer-retirement 测试硬钉
  retiredWithMarker==['outer-anchor-check.ts']，而该文件已不再是孤儿（检查器自己 ok:true）⇒ 每次
  fan-in 都在 suite 步被烧
status: done
labels:
  - gap
  - defect
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-214
---
## Proposal

**现状（实测，2026-09-11T00:4x–00:5xZ，两个独立环境各复现一次）**：全量套件**确定性红 1 条**，4351 条测试中 `# pass 4350 / # fail 1`。

失败的是 `plugin/test/outer-retirement-precondition-check.test.mjs:134`：

```
✖ real repo is GREEN — orphan-checker N=0 (outer-anchor-check.ts explicitly retired)
  AssertionError [ERR_ASSERTION]: outer-anchor-check.ts must be explicitly retired
  + actual   []
  - expected [ 'outer-anchor-check.ts' ]
```

**两个环境都红**（⛔ 不是环境依赖）：① 一次机械 fan-in 的 suite（worktree 环境，`suite-end exit=1 ok=false reason:"suite red"`，238 757 ms）；② 主检出直接跑该测试文件同样红。

**⇒ 它正在烧每一次 fan-in**：上述 fan-in 已因此失败一次并退回 ready 等重试。GOAL-009 的 AC-214 那条链要往前走，同样得先经这条 suite，所以影响面不止一个任务。

**根因（位置判定 + 直接量，⛔ 非推测）**：检查器**自己是绿的**。实测 `node plugin/scripts/outer-retirement-precondition-check.ts --root . --json`：

```
ok = true            evaluated = true
referencedCount = 28 checkerCount = 9
orphanCheckers = []  retiredWithMarker = []  undischarged = []
surviving 含 outer-anchor-check.ts: True
```

`retiredWithMarker` 的产生逻辑（`outer-retirement-precondition-check.ts:322-333`）只遍历 `orphanCheckers`——**一个文件只有在「被执行核引用 ∧ 不在 surviving」时才会进这个列表**。而 `outer-anchor-check.ts` 现在**在 surviving 里**，所以它既不是孤儿、也不会出现在 `retiredWithMarker` 中。⇒ `[]` 是**正确输出**。

红的是测试在 `:142` 额外钉的一条**快照式期望**：

```js
assert.deepEqual(res.retiredWithMarker, ["outer-anchor-check.ts"], "outer-anchor-check.ts must be explicitly retired");
```

它把「当前恰好有哪一个文件处于『孤儿且已标退役』状态」写成了硬期望——**该状态只在那个文件仍是孤儿时成立**，而孤儿归类会随合法改动变化。同文件最近一次提交逐字为 `70787b719 fix: gap-b4 修 suite 红（双因）——棘轮 REQUIRED_ADOPTERS 入 orphan-checker NON_CALLER_BASENAMES + 补 help-contract`——**给另一条 suite 红做的修复改了 NON_CALLER_BASENAMES，于是该文件不再被判为孤儿**，这条快照期望随之失效。

**真正要守的性质已经被同一个测试的上一行守住了**：`assert.deepEqual(res.undischarged, [], ...)`——**任何孤儿 checker 都不得缺少处置**。这条与孤儿集合是否为空无关，永远有意义。而 `:142` 那条只是把「此刻孤儿集合恰好等于某个单元素集」当成了不变量。

**⚠️ 同形观察（仅记录，不改变本任务范围）**：本晚已出现三条同族——git-graph 配色计数断言（强于渲染器承诺的不变量）、shipped-entry 入口枚举面（强于「入口」的真实定义）、以及本条（把一次快照当不变量）。三者都是**测试断言强于机制承诺**，且都以「烧掉别人 fan-in 的无关红」显形。若出现第四条，宜造一个针对该形态的检测器，而不是继续逐条修。

## Plan

1. 把 `:142` 的硬期望改成**与机制承诺一致**的形态。候选（择一并写明理由）：
   - (a) **删除该断言**——真正的性质由上一行 `undischarged == []` 覆盖；但须确认「标了退役 marker 的孤儿会被正确归类」这条还有别处守着，⛔ 不能删成无人验证。
   - (b) 改成**条件断言**：若 `orphanCheckers` 含 `outer-anchor-check.ts`，则它必须出现在 `retiredWithMarker` 中；否则该断言不适用。
   - (c) 改成**集合关系**：`retiredWithMarker ∪ undischarged == orphanCheckers` 且 `undischarged == []`。⇒ 表达「每个孤儿都被分类、且都有处置」，不依赖具体有几个孤儿。
   **建议 (c)**：它是这段代码真正的不变量，对孤儿集合为空/非空都成立，且仍能取假（分类漏掉某个孤儿立刻红）。
2. **保住取假能力**：改后必须仍能对「一个孤儿 checker 缺处置」取假——注入一个被执行核引用、不在 surviving、且不含退役 marker 的 checker ⇒ 测试变红；移除 ⇒ 转绿。⛔ 缺这条双向控制等于把测试改成恒绿。
3. ⛔ **不要改检查器去迎合测试**——`outer-retirement-precondition-check.ts` 的输出已实测正确（`ok:true`），改它会把一个正确的机制弄坏来让一条过期断言变绿。

## Acceptance Criteria

- [x] AC1 缺陷存证（改前读数）：贴该测试的失败输出（`actual []` / `expected ['outer-anchor-check.ts']`），以及检查器 `--json` 的实测读数（`ok:true`、`orphanCheckers:[]`、`surviving` 含该文件），说明 `[]` 是正确输出。
- [x] AC2 套件转绿（直接量）：改后 `bash scripts/test.sh plugin/test/outer-retirement-precondition-check.test.mjs` exit 0；退出码取自 `test.sh` 本身，⛔ 不得取自管道末段。
- [x] AC3 取假能力保留（最关键的负控制）：注入一个「被执行核引用 ∧ 不在 surviving ∧ 不含退役 marker」的 checker ⇒ 该测试**变红**并点名它；移除后转绿。贴两次输出与还原后 `git diff` 为空。
- [x] AC4 对两种孤儿归类都成立：分别在「`outer-anchor-check.ts` 在 surviving」（当前状态）与「人为让它成为孤儿且带 marker」两种情形下跑该测试，**两次均绿**；贴两次读数与当次的 `orphanCheckers`/`retiredWithMarker`。
- [x] AC5 检查器未被改动：`git diff --stat plugin/scripts/outer-retirement-precondition-check.ts` 为空（本任务只改断言，不改机制）。
- [ ] AC6 全量绿：`scripts/test.sh` 全量绿，`# fail 0`；贴 `# tests / # pass / # fail` 三行。（待外部）

**AC1 改前读数**：主检出复现失败（`AssertionError [ERR_ASSERTION]: outer-anchor-check.ts must be explicitly retired`，`actual: []` / `expected: ['outer-anchor-check.ts']`）；检查器 `--json` 实测 `ok:true`、`orphanCheckers:[]`、`retiredWithMarker:[]`、`undischarged:[]`、`surviving` 含 `outer-anchor-check.ts` ⇒ 该状态（孤儿集为空）下 `retiredWithMarker=[]` 是正确输出，`:142` 的快照期望 `["outer-anchor-check.ts"]` 失效。⛔ 该「anchor 在 surviving」态来自主检出的嵌套 worktree（`listExecutableFiles` 递归扫进 `.claude/worktrees/*` 里的引用），干净 worktree 里 anchor 是「带 marker 的孤儿」（`orphanCheckers=['outer-anchor-check.ts']`/`retiredWithMarker=['outer-anchor-check.ts']`）——同一条快照断言在两种环境给出相反结果，正是它必须被替换的直接证据。

**AC2 套件转绿**：改后 `bash scripts/test.sh plugin/test/outer-retirement-precondition-check.test.mjs` 在 worktree exit **0**（15 pass / 0 fail；退出码取自 `test.sh` 本身 `EXIT_CODE=$?`）。

**AC3 取假能力保留**：注入 `plugin/scripts/orphan-injection-check.ts`（执行核引用、无载体/注册表/marker）+ 执行核加引用行 ⇒ `node --test` 红并点名 `orphan-injection-check.ts`（`AssertionError: no orphan checker may lack a disposition: orphan-injection-check.ts`）；移除 ⇒ 绿（15 pass / 0 fail）；还原后 `git diff` 仅剩测试文件改动。

**AC4 两种孤儿归类**：(a) 注入外部载体 `tmp-survivor-carrier.ts`（`import ... from "./outer-anchor-check.ts"`）⇒ `orphanCheckers=[]`/`retiredWithMarker=[]` ⇒ 绿；(b) 干净 worktree（anchor 带 marker 孤儿）⇒ `orphanCheckers=['outer-anchor-check.ts']`/`retiredWithMarker=['outer-anchor-check.ts']` ⇒ 绿。两次均绿。

**AC5 检查器未被改动**：`git diff --stat plugin/scripts/outer-retirement-precondition-check.ts` 为空。

**AC6 全量绿**：由 driver 机械 fan-in 的 suite 步验证（worker 只跑 scoped gate，不跑全量 suite——worker-driver 分工）。

## Definition of Done

全量套件 `# fail 0`；该测试的断言与检查器实际承诺的不变量一致（对孤儿集合为空与非空两种情形都成立），且仍能对「孤儿 checker 缺处置」取假；`outer-retirement-precondition-check.ts` 逐字未改。⛔ 把断言删成无人验证、或把期望改成当前实际值（再来一次快照）⇒ 不算达成——后者只会在下次孤儿归类变化时重演本缺陷。

## Touches

- plugin/test/outer-retirement-precondition-check.test.mjs
- tasks/gap-outer-retirement-test-pins-a-file-that-is-no-longer-orphaned.md
