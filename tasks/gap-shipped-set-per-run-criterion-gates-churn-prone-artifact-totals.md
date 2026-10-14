---
id: gap-shipped-set-per-run-criterion-gates-churn-prone-artifact-totals
title: AC-334 的常驻判据每轮门禁产物【自身总量】——该量按 shipped-set-rules.ts
  头注释的设计只归发布门禁（有人在场），per-run 门禁会因无关改动误报并被盲目 re-anchor 直到失去意义（实测 6 天内 5
  次抬升、其中一次手抄错，本轮因一次合法新增 experiment-manifest.js 再红）
status: ready
labels:
  - gap
  - defect
  - priority:p1
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-334
---
## Proposal

AC-334（GOAL-029，人 2026-10-07 裁定）的判据是一条**常驻**判据：`plugin/test/shipped-set.test.mjs` 必须在 55 秒内通过。本轮**直接实跑**该判据（AC 记录里那条脚本原样）：

```
$ timeout 55 node --experimental-strip-types --test plugin/test/shipped-set.test.mjs
rc=1   CAUSE=shipped-set-test-red-rc1
ℹ tests 10 / pass 7 / fail 3 / duration_ms 17272
```

⇒ **`rc=1`，不是 124**：不是超时，是测试自己红了。上一轮那条「55s 预算零余量」的缺陷已被修掉（57.7s → 14.9s，余量充足），红的是另一件事。

### 三条红，同一个根因

| 失败测试 | 断言的量 | 实测 vs 记录 |
|---|---|---|
| `AC2: the published artifact carries no dev-only content…` | `judgeShippedSize(...).over == []` | `{"files":286,"bytes":61456364,"shLines":7345}` vs `{"files":285,"bytes":61116610,"shLines":7345}` ⇒ `over: ["files"]` |
| `AC2 control: a foo.test.mjs dropped into a clean artifact turns it RED` | 收尾断言「clean artifact 仍 PASS」 | `'FAIL' !== 'PASS'` |
| `the CLI gates the real artifact green and the unfiltered one red` | `check(..., {sizeCeiling:true}).code === 0` | `1 !== 0` |

后两条是**级联**：二者都要重新断言「干净产物是 PASS」，而干净产物已因总量超上限而为 FAIL。⇒ 唯一根因是**产物自身总量比入库基线多 1 个文件**。`bytes` 也超了，但 `SIZE_GATED_AXES = ["files","shLines"]`（`plugin/scripts/shipped-set-rules.ts:370`）只门禁这两轴，所以红的是 `files` 一轴。

### 那 +1 个文件是什么（实测，不是推断）

取上一次 re-anchor 的提交 `9b83e1f6b` 当时的整棵树（`git archive 9b83e1f6b …`，**不注册 worktree**），用**各自树里那份** `publish-dist-branch.sh` 在 `/tmp` 一次性 stub 仓里各装配一次、`git archive` 出产物、逐文件对照：

```
$ diff old-files.txt current-files.txt
84a85
> scripts/dist/experiment-manifest.js
```

**恰好 +1，就是它**：`plugin/scripts/experiment-manifest.ts` 的 bundle。落地提交 `9218503f7`（"gap-resumable-long-experiments: manifest + checkpoint + resume plan, wired into the existing worker-driver dispatch path"，2026-10-14），**在上次 re-anchor（2026-10-13T17:50）之后**。`files 285 → 286`。

对照口径：两次装配都是 `--no-build` + 一次性 stub；`plugin/vendor/` 是 gitignore 的构建输入，两边都从现树补，故它不参与差异 —— 差异只有上面这一行。

### 该 ship 吗？——该，且是同类第 5 例

`experiment-manifest.js` **是运行期必需的**，三条独立读数：

1. `plugin/scripts/worker-driver.ts:2157` 在**运行期**按 `kernelSiblingArgv("experiment-manifest.ts")` spawn 它（回退到 `resolveKernelPluginRoot()/scripts/experiment-manifest.ts`）；
2. `plugin/scripts/experiment-manifest.ts:655` 有显式的 `export const ENTRY_BASE = "experiment-manifest"` 直入标记 ⇒ 被 bundle 入口推导收为 dist 入口；
3. **产物自己**证明：`<artifact>/scripts/dist/worker-driver.js` 里引用了 `experiment-manifest`。不 ship 它 ⇒ 装出去的 worker-driver 一 spawn 就 MODULE_NOT_FOUND，可恢复长实验在非 quay 仓里直接坏掉。

同批落地的另两个新脚本（`duration-report.ts`、`discovery-closed-loop-report.ts`）**正确地没有** ship：全仓 `kernelSiblingArgv(...)` / `resolveKernelSibling(...)` spawn 点对它们零命中，产物里也只有 `capability-catalog-declarations.json` 提到它们（那是声明，不是 spawn）。

⇒ 与上次 re-anchor 那 4 个 bundle（`guard-lineage-check` / `deletion-closure-check` / `judgment-consumer-check` / `suite-load-sampler`）**完全同类**：入口推导覆盖 `kernelSiblingArgv` 形状后，新脚本随产物发出。**这次的增长是合法的，不是缺陷。**

<!-- dedup-ref -->
两个既有任务都挂 `goal_ac: AC-334` 且都是 `done`，故不构成重复立案，而是「上一次修复没有守住」的证据：`gap-shipped-plugin-tree-excludes-dev-only-content-and-has-a-shrink-only-size-ratchet`（造了本测试与棘轮，基线取 2026-10-07 那天的产物 283）；`gap-shipped-set-test-exceeds-55s-budget-sequential-bundling`（把预算从 57.7s 压到 14.9s，完成记录**明写「未 reanchor」**、期望「产物不变」）。两个都没有动**这条判据依赖的那个量本身**。

### 根因：常驻判据门禁了一个【设计上禁止每轮门禁】的量

`plugin/scripts/shipped-set-rules.ts` 的头注释 ⛔ 段就是权威设计陈述：

> ⛔ WHY THE RATCHET'S AXES ARE THE FORBIDDEN READING AND NOT THE ARTIFACT'S OWN TOTALS … the artifact is dominated by 112 REGENERATED `dist/*.js` bundles … so its byte count moves whenever ANY bundled source changes … A per-run exact ratchet there would fire on unrelated code edits, **and a ratchet that fires on unrelated edits is re-anchored blindly until it means nothing** … **the size ceiling is enforced where a human is in the loop (the release gate)**.

同一条设计在 `plugin/shipped-set-baseline.json` 的 `_axes` 里逐字写着：三个棘轮轴是 `files` / `bytes` / `shLines` **的「被排除内容在产物中出现的量」（正确发布时恒为 0）**；而 `shipped` 是「**the artifact's OWN totals … compared by the release gate's shipped-set-clean**」。

设计很清楚：**per-run 只门禁 `forbidden` 读数（按政策恒为 0，稳定）；产物自身总量 `shipped` 由发布门禁 `verify-plugin-channel-assertions.ts` 把关（有人在场）。**

但 `plugin/test/shipped-set.test.mjs` 把 `shipped` 也做成了 per-run 门禁（AC2 里无条件 `assert.deepEqual(size.over, [])`；CLI 那条 `check(..., {sizeCeiling:true}).code === 0`），而 **AC-334 的判据跑的正是这个测试**。于是模块预言的那条路径原样发生：无关改动触发误报 → 盲目 re-anchor → 直到失去意义。

`_reanchorLog` 就是这条路径的流水：6 天内 **5 次抬升** —— 283 → 264（降）→ 266 → 281 → 284 → 285，其中最后一条自己承认上一次**手抄错了**（记 284，实际 285，`281+4=285`）。本轮第 6 次：286。

触发这次的不是「无关改动」，是一次**合法的产品新增**，这只能说明 per-run 门禁的误报面比模块预言的还大。

且 **GOAL-029 已 `achieved`** —— 没有活着的 driver 会去 re-anchor 它。于是：合法新增 → 常驻判据红 → 无人有责 → gap-filer 每轮重立案。这是**结构性死循环**，不是一次偶发。

### 修法

两半，缺一不可：

1. **把入库基线改成产物自身的真实读数**（一次 re-anchor，`shipped.files 285 → 286`，附 `_reanchorLog` 理由：`experiment-manifest.js` 是 `worker-driver` 运行期 spawn 的 dist 入口）。否则发布门禁 `shipped-set-clean` 也是陈旧的。
2. **把常驻判据的 per-run 门禁收回到设计边界**：`plugin/test/shipped-set.test.mjs` 不再对产物**自身总量**做「超上限即判据红」的断言（`totals` 照旧**打印**，作为读数留痕），`forbidden` 三轴棘轮与两条 RED 控制原样保留。总量这条保证**不消失**，它留在 `plugin/scripts/verify-plugin-channel-assertions.ts` 的 `shipped-set-clean`（AC5 用负控制钉住它仍咬得住）。

> **AC-334 的 `expect` 不会被这一步削掉**：它要求「对文件数、字节数与 .sh 行数设有只减不增的基线」，而棘轮的三个轴**恰好就叫** `files` / `bytes` / `shLines`（见基线 `_axes`）。总量门禁是**同一条保证在错误节拍上的第二份**，不是那份保证本身。

⛔ 不许把这条判据「修」成通过：不得调高 55s 上限；不得把控制退化成 fixture 重实现；不得删弱 forbidden 棘轮或它的任何一条 RED 控制；不得改动 AC 记录里的 `criterion` 文本（AC 记录变更不在本任务范围）。

## AC

- [x] AC-334 的判据实跑退出 0 且**不为 124**，完成记录贴出原始输出：`timeout 55 node --experimental-strip-types --test plugin/test/shipped-set.test.mjs`（AC 记录里那条 criterion 的等价命令）。
- [x] 常驻判据不再门禁「会被一次合法发布增长作废的手抄常量」：完成记录贴出改动前后 `grep -n 'judgeShippedSize\|size\.over\|shippedOf' plugin/test/shipped-set.test.mjs` 的命中对照，并说明每一处对产物**自身总量**的判定为何不再使这条常驻判据转红（对齐 `plugin/scripts/shipped-set-rules.ts` 头注释 ⛔ 段：per-run 只门禁 `forbidden`，`totals` 留在发布门禁）。若选择**保留** per-run 总量门禁，则必须证明它不再依赖手抄常量（例如在装配期由产物自身读数派生），并贴出「再合法新增一个 dist 入口后判据仍绿」的实跑证据；给不出 ⇒ 本 AC 不成立。
- [x] 发布门禁那一侧仍咬得住（负控制，证明总量这条保证只是换了执行点、没有被整体删掉）：完成记录贴出【一个超过 `baseline.shipped` 上限的产物被 `plugin/scripts/verify-plugin-channel-assertions.ts` 的 `shipped-set-clean` 判 `FAIL`】的实跑输出。
- [x] forbidden 棘轮的两向控制未被削弱：`grep -c 'AC2 control' plugin/test/shipped-set.test.mjs` ≥ 2；完成记录贴出【把 `plugin/scripts/publish-dist-branch.sh` 的 rsync 排除表恢复成全量后该测试转红】的实跑输出（`rc≠0`，失败信息指名 `test` / `fixtures` / `scripts/checker-mutation-cases` 之一）。
- [x] 入库基线是产物自身的真实读数，且「工作树抬基线」仍红：`plugin/shipped-set-baseline.json` 的 `shipped.files` 与 `shipped.shLines` 同一次真实装配的产物读数**逐位相同**（两侧读数都贴出），并贴出 `AC3: a baseline raised past git HEAD is RED` 那条断言仍通过的实跑输出。
- [x] `bash scripts/test.sh --for-task gap-shipped-set-per-run-criterion-gates-churn-prone-artifact-totals` 退出 0 且执行 ≥1 个测试文件。

## DoD

真实落地：AC-334 的判据在本机**实跑**变绿，**且不再依赖一个会被一次正常产品新增作废的手抄常量** —— 否则下一轮 gap-filer 还会站在同一个地方。完成记录必须同时贴出：①判据命令的退出码；②改动前后总量断言的命中对照；③发布门禁负控制的实跑输出；④两条 forbidden RED 控制的实跑输出；⑤入库基线读数与产物自身读数的逐位对照。

⛔ 不算完成：只做一次 re-anchor（那是第 6 次抬升，模块头注释已逐字预言其结局）；把 55s 上限调高；把控制削成 fixture 重实现；删掉或绕过 forbidden 棘轮及其任何一条 RED 控制；改动 AC 记录里的 `criterion` 文本。

## Touches

- `plugin/test/shipped-set.test.mjs`
- `plugin/shipped-set-baseline.json`
- `plugin/scripts/shipped-set-rules.ts`
- `plugin/scripts/verify-plugin-channel-assertions.ts`
- `plugin/test/verify-plugin-channel-assertions.test.mjs`
- `tasks/gap-shipped-set-per-run-criterion-gates-churn-prone-artifact-totals.md`

## Blocker

**2026-10-14T16:03:28.332Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: AssertionError [ERR_ASSERTION]: the real publish script FAILED (exit 1): [baseline A/B: HARD RED (changed-assertion) — the task's red set is NOT a subset of the develop baseline red set: added=plugin/test/goal-driver-s04.test.mjs,packages/quay/test/serve-ac95-views.test.mjs,packages/quay/test/serve-ac95-views.test.mjs,plugin/test/shipped-shell-reachability.test.mjs,plugin/test/shipped-shell-reachability.test.mjs,plugin/test/shipped-shell-reachability.test.mjs,plugin/test/shipped-shell-reachability.test.mjs,plugin/test/ownership-active-loop.test.mjs,packages/quay/test/observation.test.mjs,packages/quay/test/build-plugin-dist.test.mjs,packages/quay/test/build-plugin-dist.test.mjs,plugin/test/fan-in-driver-mechanical-orchestration.test.mjs,plugin/test/fan-in-driver-mechanical-orchestration.test.mjs,packages/quay/test/serve-board.test.mjs,plugin/test/supervisor-observe.test.mjs,plugin/test/supervisor-observe.test.mjs,plugin/test/supervisor-observe.test.mjs,plugin/test/full-suite-runner-s10.test.mjs,plugin/test/full-suite-runner-s10.test.mjs,plugin/test/full-suite-runner-s10.test.mjs,plugin/test/live-web-address.test.mjs,plugin/test/live-web-address.test.mjs,plugin/test/full-suite-runner-s12.test.mjs,plugin/test/full-suite-runner-s12.test.mjs,plugin/test/full-suite-runner-s07.test.mjs,plugin/test/full-suite-runner-s07.test.mjs,plugin/test/full-suite-runner-s07.test.mjs,packages/quay/test/serve-handlers.test.mjs,plugin/test/worker-driver.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs changed=plugin/test/full-suite-runner-cgroup.test.mjs,plugin/test/full-suite-runner-cgroup.test.mjs,plugin/test/full-suite-runner-cgroup.test.mjs]
- run_id：wk-prod-anchor
- session_id：2cbdc46f-bfb4-48fb-8bf3-4990d5eb6aaa
