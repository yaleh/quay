# develop 基线红分类：60 个文件逐个单独跑两遍（2026-10-15）

> 任务：`gap-develop-baseline-red-classify-deterministic-vs-load`
> 判定规则（AC2 要求照录原文）：**「确定性红：两遍单独都红 ⇒ 真代码/夹具缺陷；隔离绿：两遍单独都绿 ⇒
> 只在全量时红（资源/负载/交互），交给内存与并发方向；不稳定：两遍结果不一致。」**
> ⛔ 本任务只做测量与立案，**没有改任何测试或产品代码**（Touches = 本文件 + 任务自身）。

## 0. 结论（先读这段）

| 类 | 文件数 |
|---|---|
| 确定性红 | **0** |
| 隔离绿 | **59** |
| 不稳定 | **1** |
| 合计 | **60** |

并集 60 个文件，与 Proposal 的读数「并集 **60 个文件**」**逐字一致**（§1.2 给取数命令与原始条数）。

**直读**：这 60 个文件在 develop tip（`dae398dd7abcacb312e0379355fc1a5bb8d169df`）上**单独**跑 120 趟，59/60 个文件趟趟全绿，
0 个确定性红。⇒ 载体的「基线红」不是文件自身的确定性缺陷，而是**全量套件内部**
这个上下文（并发 × 内存 × 交互）的产物 —— 与 Proposal 的判断一致，且现在有了逐文件、可复现的直接量。

（第二轮未执行）

## 1. 取数

### 1.1 先给 `blocked` 正名（否则下面每一行都会被读反）

载体 `.quay/baseline-red-rounds.jsonl` 的 `blocked` **不是**「develop 上本来就红的文件」，而是
「**task 树红了、develop 基线树重跑没红（或同 id 断言文本变了）**」的文件 —— 即 fan-in 判给该任务的
红点。任务标题里的「基线红」是这一档的简写；本文件按机制描述它。

判定与写入的代码位置（`plugin/scripts/worker-fan-in.ts`）：

```js
// :1345-1359  compareFailureSignatures(task, baseline)
for (const t of task) {
  if (baseKeys.has(signatureKey(t))) continue;               // 基线也红 ⇒ 不算任务的账
  const baseTexts = baseById.get(t.file);
  if (baseTexts !== undefined && !baseTexts.includes(t.text)) changed.push(...);
  else                                                        added.push(t);
}
// :3123-3127  只有 hard-red 轮才写入本载体
if (baselineEquivalence !== null && baselineEquivalence.verdict.kind === "hard-red") {
  appendBaselineRedRound(root, { task, signature, ts: Date.now(),
    blocked: [...added.map(a => a.file), ...changed.map(c => c.file)] });
}
```

且**基线树就是 develop**（`:2529` `git worktree add --detach <baseDir> <mergeTarget>`，`mergeTarget = develop`）。

⇒ 两条推论，本期都以直接量检验：① 一个在 develop 上确定性红的文件，A/B 两趟都会红 ⇒ 走 `exempt` ⇒
**结构性不会进入本载体**；② 因此载体成员应当是「只在全量负载下红」的那一类。

### 1.2 取数命令与原始读数

```bash
node --input-type=module -e '
  import fs from "node:fs";
  const rows = fs.readFileSync(".quay/baseline-red-rounds.jsonl","utf8").trim().split("\n").map(JSON.parse);
  const freq = new Map();
  for (const r of rows) for (const f of new Set(r.blocked)) freq.set(f,(freq.get(f)||0)+1);
  console.log("union:", freq.size);
  for (const [f,n] of [...freq].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))) console.log(n+"/8", f);
'
```

- 载体：`/data/home/yale/work/quay/.quay/baseline-red-rounds.jsonl`，**最近 8 轮**
- ts 区间：`1791911094183` – `1791995508088`（`2026-10-13T17:04:54.183Z` – `2026-10-14T16:31:48.088Z`），
  与 Proposal 的读数逐字一致
- 每轮 `blocked` 的**原始条数**：111 / 3 / 4 / 48 / 41 / 35 / 40 / 46
- 每轮**去重后**的文件数：22 / 2 / 3 / 22 / 24 / 17 / 18 / 16
  —— ⛔ 原始条数 > 去重条数（同轮里同一文件出现多次），所以「出现轮数」一律用**去重集合**算，
  口径与 Proposal 的 `6/8` 一致
- **并集：60 个文件**

### 1.3 develop tip（被测的那棵树）

```
develop = dae398dd7abcacb312e0379355fc1a5bb8d169df
```

测量 worktree `/home/yale/work/quay-worktrees/gap-develop-baseline-red-classify-deterministic-vs-load`，
由 `dispatch-worktree-setup.sh` 从该 fork point 建立（脚本自报 `fork-point PASS — HEAD contains develop`），
provisioning = `node_modules` 软链到主检出 + `.quay/config.yml`（worktree-include）。

## 2. 测量方法

### 2.1 每个文件的运行形态

```bash
# ① 先做一次 scripts/test.sh 的 build_dist_once（见下），使被测树与真套件同形
cd <worktree>
node packages/quay/scripts/build-dist.mjs
node packages/quay-native/scripts/build-dist.mjs
bash <worktree>/plugin/scripts/sync-vendor.sh --sync-dist
# ② 然后每个文件两遍：
env LC_ALL=C.UTF-8 LANG=C.UTF-8 TZ=UTC NODE_COMPILE_CACHE=<disk dir> \
  node --test --test-concurrency=1 --test-reporter=tap <file>
```

- **① 为什么必须有**（fidelity，不是可选项）：`scripts/test.sh` 在跑任何测试**之前**先 `build_dist_once`
  （`:1036-1078`：`packages/quay/dist/quay.js` + `packages/quay-native/dist/quay-native.js` + 镜像到
  `plugin/vendor/`）。worktree provisioning（`dispatch-worktree-setup.sh` / worktree-include）**只拷
  `plugin/vendor/quay/dist/*`，不建 `packages/*/dist`** ⇒ 不补这一步，被测树里的 `QUAY_CLI` 会退化成
  `... is MISSING; falling back to .../bin/quay.ts`（实测首轮日志第一行就是这个），与真套件**不同形**。
  本期在开跑前一次性补上（`Done in 2ms` / `77ms`），此后 120 趟共用同一棵树。⚠️ 这是本期**唯一**的
  fidelity 修正，且在第一次测量之后发现 ⇒ 已作废重跑（不是中途改口径）。
- cwd = 上面那个 worktree；**同一时刻只有一个 `node --test`**（脚本顺序 `await`，结构性并发 1）
- ⛔ 与 `scripts/test.sh <file>` 的差别只剩两处、且都朝「更严」方向：不跑静态检查层（那是 repo 级判定，
  不属于「这个文件单独跑」）、不设 `QUAY_TEST_NESTED=1`（于是测试内嵌套 spawn 的 `scripts/test.sh`
  会做完整构建而不是跳过——更慢，但语义相同）
- 环境与 `scripts/test.sh` 对齐：`unset FORCE_COLOR QUAY_GOAL_ACCEPTANCE_ACTIVE`（`:216`）、
  `LC_ALL/LANG=C.UTF-8`、`TZ=UTC`（`:312-314`）、`NODE_COMPILE_CACHE` 钉在**磁盘**上（`:339-341`）
- 每个文件**连续跑两遍**（pass 1 / pass 2），两趟之间无重叠
- 每趟独立进程；600s 未退则整组 SIGKILL（本期**一次都没触发**）

### 2.2 混淆量（必须一起读，否则分类会被过度解释）

测量期间**这台主机上还有别的 worker 在跑套件**，所以「单独跑」隔离了**本文件**，隔离不了**主机级负载**。
每趟都记了当时的读数：

- 主机：`nproc=128`、`MemTotal=252902 MB`、`node v24.21.0`
- `loadavg`(1min) 在本窗口内的范围：**16.2 – 169.4**（128 核机器）
- `/proc` 里可见的、cmdline 含 `--test` 的 node 进程数（**含本趟自己的 2 个**）：1 – 140
  （该计数器把被测对象自己也数进去了，方向是保守的；它的用途只是「有没有别的东西在跑套件」）

⇒ **本期最强的一句**：这 60 个文件在 loadavg 长期 16+ 的重载窗口里**单独**跑仍然全绿。
所以「基线红」不是主机整体在忙造成的，而是**全量套件自己的并发与内存足迹**造成的
（正是 Proposal 说的「交给内存与并发方向」）。

### 2.3 升级规则（对判定规则的唯一补充，先声明后执行）

规则只说了两遍。为让「确定性红」这个篮子不被**单次负载抖动**污染，对**首两遍双红**的文件追加**两遍**复核；
只有**全部趟次都红**才判「确定性红」，否则按「结果不一致」判「不稳定」。

本期触发的文件：**无（首两遍没有任何文件双红，故未触发升级）**

⛔ 这条补充只可能把文件从「确定性红」**移出**（判成不稳定），不会把任何文件**移进**「确定性红」——
即它只让 AC3 的立案更保守，不会凭空造出修复任务。

### 2.4 仪器正控（否则「0 红」这个读数不可信）

本期的主结论是**否定读数**（0 个确定性红）。否定读数只有在「仪器本来能看见红」时才有信息量
（硬规则 2 的零计数半边：把谓词对着一个**已知为真**的样本干跑一次）。所以用**同一套调用形态**
跑了一个必然红的控制文件（在 scratch 目录里，**不属于**那 60 个文件）：

```bash
node --test --test-concurrency=1 --test-reporter=tap positive-control/failing.test.mjs
# ⇒ exit=1 ; "not ok 2 - control: this one is deliberately red" ; "# pass 1 / # fail 1"
```

⇒ 退出码捕获与 TAP 解析这两条通路**都能取假**：红会被看见，并被记成 RED（不是被吞成 GREEN）。
配合 §2.3 的升级规则，「0 确定性红」是**测出来的**，不是**默认值**。

## 3. 分类表（AC2）

判定规则原文照录：**「确定性红：两遍单独都红 ⇒ 真代码/夹具缺陷；隔离绿：两遍单独都绿 ⇒ 只在全量时红
（资源/负载/交互），交给内存与并发方向；不稳定：两遍结果不一致。」**（§2.3 的升级规则在双红时把「两遍」扩到「全部趟次」）

`出现` = 该文件在这 8 轮的 `blocked` **去重集合**里出现的轮数；`pass 1` 四格 = **退出码 / 耗时 / TAP 失败数 / TAP 用例数**。

| # | 文件 | 出现 | pass 1（退出码 / 耗时 / fail / pass） | pass 2 | 类 |
|---|---|---|---|---|---|
| 1 | `plugin/test/full-suite-runner-cgroup.test.mjs` | 6/8 | 0 / 41.3s / 0 / 54 | 0 / 35.8s / 0 / 54 | **隔离绿** |
| 2 | `plugin/test/full-suite-runner-phases.test.mjs` | 6/8 | 0 / 52.7s / 0 / 71 | 0 / 49.8s / 0 / 71 | **隔离绿** |
| 3 | `plugin/test/full-suite-runner-s07.test.mjs` | 6/8 | 0 / 20.3s / 0 / 7 | 0 / 20.3s / 0 / 7 | **隔离绿** |
| 4 | `packages/quay/test/serve-ac95-views.test.mjs` | 5/8 | 0 / 14.4s / 0 / 22 | 0 / 14.0s / 0 / 22 | **隔离绿** |
| 5 | `plugin/test/full-suite-runner-s10.test.mjs` | 5/8 | 0 / 12.0s / 0 / 7 | 0 / 12.1s / 0 / 7 | **隔离绿** |
| 6 | `plugin/test/full-suite-runner-s12.test.mjs` | 5/8 | 0 / 14.3s / 0 / 6 | 0 / 14.2s / 0 / 6 | **隔离绿** |
| 7 | `plugin/test/supervisor-observe.test.mjs` | 5/8 | 0 / 10.7s / 0 / 8 | 0 / 9.8s / 0 / 8 | **隔离绿** |
| 8 | `plugin/test/worker-driver.test.mjs` | 5/8 | 0 / 31.1s / 0 / 147 | 0 / 38.3s / 0 / 147 | **隔离绿** |
| 9 | `plugin/test/live-web-address.test.mjs` | 4/8 | 0 / 14.5s / 0 / 17 | 0 / 13.3s / 0 / 17 | **隔离绿** |
| 10 | `plugin/test/shipped-shell-reachability.test.mjs` | 4/8 | 0 / 7.9s / 0 / 8 | 0 / 7.8s / 0 / 8 | **隔离绿** |
| 11 | `packages/quay/test/build-plugin-dist.test.mjs` | 3/8 | 0 / 6.7s / 0 / 45 | 0 / 6.5s / 0 / 45 | **隔离绿** |
| 12 | `plugin/test/full-suite-runner-s02.test.mjs` | 3/8 | 0 / 15.8s / 0 / 7 | 0 / 15.9s / 0 / 7 | **隔离绿** |
| 13 | `plugin/test/full-suite-runner-s05.test.mjs` | 3/8 | 0 / 14.4s / 0 / 7 | 0 / 15.0s / 0 / 7 | **隔离绿** |
| 14 | `plugin/test/full-suite-runner-s06.test.mjs` | 3/8 | 0 / 11.1s / 0 / 6 | 0 / 11.2s / 0 / 6 | **隔离绿** |
| 15 | `plugin/test/full-suite-runner-s08.test.mjs` | 3/8 | 0 / 16.4s / 0 / 7 | 0 / 16.3s / 0 / 7 | **隔离绿** |
| 16 | `plugin/test/trend-check.test.mjs` | 3/8 | 0 / 10.1s / 0 / 16 | 0 / 10.0s / 0 / 16 | **隔离绿** |
| 17 | `packages/quay/test/gap-ac179-criterion-cold-miss-dashboard-snapshot.test.mjs` | 2/8 | 0 / 15.0s / 0 / 8 | 0 / 15.1s / 0 / 8 | **隔离绿** |
| 18 | `packages/quay/test/npm-pack-e2e.test.mjs` | 2/8 | 0 / 11.8s / 0 / 11 | 0 / 11.3s / 0 / 11 | **隔离绿** |
| 19 | `packages/quay/test/serve-board.test.mjs` | 2/8 | 0 / 7.3s / 0 / 16 | 0 / 7.1s / 0 / 16 | **隔离绿** |
| 20 | `packages/quay/test/serve-handlers.test.mjs` | 2/8 | 0 / 8.7s / 0 / 63 | 0 / 18.0s / 0 / 63 | **隔离绿** |
| 21 | `packages/quay/test/serve-live-body-i18n.test.mjs` | 2/8 | 0 / 8.3s / 0 / 11 | 0 / 7.0s / 0 / 11 | **隔离绿** |
| 22 | `plugin/test/driver-anchor-takeover.test.mjs` | 2/8 | 0 / 15.0s / 0 / 10 | 0 / 14.6s / 0 / 10 | **隔离绿** |
| 23 | `plugin/test/fan-in-execute-paths-s06.test.mjs` | 2/8 | 0 / 13.1s / 0 / 10 | 0 / 13.1s / 0 / 10 | **隔离绿** |
| 24 | `plugin/test/full-suite-runner-oom-policy.test.mjs` | 2/8 | 0 / 33.3s / 0 / 23 | 0 / 33.1s / 0 / 23 | **隔离绿** |
| 25 | `plugin/test/goal-driver-s04.test.mjs` | 2/8 | 0 / 4.9s / 0 / 14 | 0 / 4.8s / 0 / 14 | **隔离绿** |
| 26 | `plugin/test/ownership-active-loop.test.mjs` | 2/8 | 0 / 20.4s / 0 / 60 | 0 / 19.7s / 0 / 60 | **隔离绿** |
| 27 | `plugin/test/worker-fan-in.test.mjs` | 2/8 | 0 / 10.3s / 0 / 5 | 0 / 10.2s / 0 / 5 | **隔离绿** |
| 28 | `packages/quay/test/ac291-criterion-address-derivation.test.mjs` | 1/8 | 0 / 3.5s / 0 / 13 | 0 / 3.6s / 0 / 13 | **隔离绿** |
| 29 | `packages/quay/test/ac302-criterion-address-derivation.test.mjs` | 1/8 | 0 / 3.9s / 0 / 19 | 0 / 4.1s / 0 / 19 | **隔离绿** |
| 30 | `packages/quay/test/branch-model.test.mjs` | 1/8 | 0 / 18.0s / 0 / 54 | 0 / 15.4s / 0 / 54 | **隔离绿** |
| 31 | `packages/quay/test/gap-dashboard-parallelize.test.mjs` | 1/8 | 0 / 3.8s / 0 / 13 | 0 / 3.9s / 0 / 13 | **隔离绿** |
| 32 | `packages/quay/test/lanes-cli.test.mjs` | 1/8 | 0 / 2.5s / 0 / 8 | 0 / 2.7s / 0 / 8 | **隔离绿** |
| 33 | `packages/quay/test/observation.test.mjs` | 1/8 | 0 / 17.9s / 0 / 60 | 0 / 17.6s / 0 / 60 | **隔离绿** |
| 34 | `packages/quay/test/serve-system-body-i18n.test.mjs` | 1/8 | 0 / 45.7s / 0 / 11 | 0 / 24.6s / 0 / 11 | **隔离绿** |
| 35 | `plugin/test/anchor-state-atomicity.test.mjs` | 1/8 | 0 / 6.6s / 0 / 3 | 0 / 7.4s / 0 / 3 | **隔离绿** |
| 36 | `plugin/test/driver-anchor-declaration.test.mjs` | 1/8 | 0 / 4.8s / 0 / 3 | 0 / 4.7s / 0 / 3 | **隔离绿** |
| 37 | `plugin/test/driver-anchor-stop.test.mjs` | 1/8 | 0 / 13.7s / 0 / 5 | 0 / 13.3s / 0 / 5 | **隔离绿** |
| 38 | `plugin/test/driver-cli.test.mjs` | 1/8 | 0 / 21.6s / 0 / 9 | 0 / 21.1s / 0 / 9 | **隔离绿** |
| 39 | `plugin/test/driver-resolves-code-root-separate-from-workspace.test.mjs` | 1/8 | 0 / 8.2s / 0 / 7 | 0 / 8.3s / 0 / 7 | **隔离绿** |
| 40 | `plugin/test/driver-restart-busy-e2e.test.mjs` | 1/8 | 0 / 34.4s / 0 / 7 | 1 / 58.4s / 1 / 6 | **不稳定** |
| 41 | `plugin/test/driver-runtime-loaded-version-drift.test.mjs` | 1/8 | 0 / 6.1s / 0 / 22 | 0 / 6.0s / 0 / 22 | **隔离绿** |
| 42 | `plugin/test/fan-in-driver-mechanical-orchestration.test.mjs` | 1/8 | 0 / 13.2s / 0 / 13 | 0 / 13.4s / 0 / 13 | **隔离绿** |
| 43 | `plugin/test/fan-in-execute-paths-s04.test.mjs` | 1/8 | 0 / 1.3s / 0 / 9 | 0 / 1.3s / 0 / 9 | **隔离绿** |
| 44 | `plugin/test/fan-in-execute-paths-s08.test.mjs` | 1/8 | 0 / 0.6s / 0 / 10 | 0 / 0.6s / 0 / 10 | **隔离绿** |
| 45 | `plugin/test/fan-in-execute-paths-s10.test.mjs` | 1/8 | 0 / 0.8s / 0 / 9 | 0 / 0.8s / 0 / 9 | **隔离绿** |
| 46 | `plugin/test/fan-in-execute-paths-s11.test.mjs` | 1/8 | 0 / 10.4s / 0 / 5 | 0 / 10.4s / 0 / 5 | **隔离绿** |
| 47 | `plugin/test/fan-in-execute-paths-s12.test.mjs` | 1/8 | 0 / 14.6s / 0 / 4 | 0 / 14.5s / 0 / 4 | **隔离绿** |
| 48 | `plugin/test/full-suite-runner-s01.test.mjs` | 1/8 | 0 / 7.7s / 0 / 7 | 0 / 7.5s / 0 / 7 | **隔离绿** |
| 49 | `plugin/test/full-suite-runner-s03.test.mjs` | 1/8 | 0 / 4.3s / 0 / 7 | 0 / 4.2s / 0 / 7 | **隔离绿** |
| 50 | `plugin/test/full-suite-runner-s04.test.mjs` | 1/8 | 0 / 7.6s / 0 / 7 | 0 / 7.6s / 0 / 7 | **隔离绿** |
| 51 | `plugin/test/full-suite-runner-s09.test.mjs` | 1/8 | 0 / 6.9s / 0 / 7 | 0 / 7.0s / 0 / 7 | **隔离绿** |
| 52 | `plugin/test/full-suite-runner-s11.test.mjs` | 1/8 | 0 / 4.0s / 0 / 7 | 0 / 4.0s / 0 / 7 | **隔离绿** |
| 53 | `plugin/test/measure-trend-check.test.mjs` | 1/8 | 0 / 1.4s / 0 / 19 | 0 / 1.4s / 0 / 19 | **隔离绿** |
| 54 | `plugin/test/ownership-active-slice-adapter.test.mjs` | 1/8 | 0 / 19.5s / 0 / 14 | 0 / 19.7s / 0 / 14 | **隔离绿** |
| 55 | `plugin/test/promotion-driver-s03.test.mjs` | 1/8 | 0 / 11.6s / 0 / 7 | 0 / 11.6s / 0 / 7 | **隔离绿** |
| 56 | `plugin/test/resource-gate-s08.test.mjs` | 1/8 | 0 / 11.9s / 0 / 8 | 0 / 11.8s / 0 / 8 | **隔离绿** |
| 57 | `plugin/test/shipped-set.test.mjs` | 1/8 | 0 / 23.4s / 0 / 11 | 0 / 29.1s / 0 / 11 | **隔离绿** |
| 58 | `plugin/test/suite-accounting.test.mjs` | 1/8 | 0 / 3.4s / 0 / 5 | 0 / 3.4s / 0 / 5 | **隔离绿** |
| 59 | `plugin/test/suite-driver.test.mjs` | 1/8 | 0 / 5.1s / 0 / 14 | 0 / 5.1s / 0 / 14 | **隔离绿** |
| 60 | `plugin/test/suite-state-trigger.test.mjs` | 1/8 | 0 / 5.7s / 0 / 60 | 0 / 5.8s / 0 / 60 | **隔离绿** |

**每行恰属一类**：三类计数之和 = 0 + 59 + 1 = 60 = 并集大小。无第四类（无未评估、无缺失文件）。


## 4. 逐文件逐趟原始读数（AC1）

原始 JSONL 在 `results.jsonl`（120 行），逐趟完整 stdout+stderr 在 `logs/`（每个文件每趟一份）。

| 文件 | 趟 | 开始时刻 (UTC) | 耗时 s | 退出码 | 判定 | TAP fail | TAP pass | 有 TAP | load1 | procs |
|---|---|---|---|---|---|---|---|---|---|---|
| `plugin/test/full-suite-runner-cgroup.test.mjs` | 1 | 2026-10-15T07:26:14.070Z | 41.3 | 0 | GREEN | 0 | 54 | yes | 91.4 | 74 |
| `plugin/test/full-suite-runner-cgroup.test.mjs` | 2 | 2026-10-15T07:26:56.945Z | 35.8 | 0 | GREEN | 0 | 54 | yes | 94.42 | 18 |
| `plugin/test/full-suite-runner-phases.test.mjs` | 1 | 2026-10-15T07:27:34.320Z | 52.7 | 0 | GREEN | 0 | 71 | yes | 89.83 | 80 |
| `plugin/test/full-suite-runner-phases.test.mjs` | 2 | 2026-10-15T07:28:28.570Z | 49.8 | 0 | GREEN | 0 | 71 | yes | 60.83 | 10 |
| `plugin/test/full-suite-runner-s07.test.mjs` | 1 | 2026-10-15T07:29:19.935Z | 20.3 | 0 | GREEN | 0 | 7 | yes | 42.76 | 14 |
| `plugin/test/full-suite-runner-s07.test.mjs` | 2 | 2026-10-15T07:29:41.766Z | 20.3 | 0 | GREEN | 0 | 7 | yes | 33.57 | 15 |
| `packages/quay/test/serve-ac95-views.test.mjs` | 1 | 2026-10-15T07:30:03.679Z | 14.4 | 0 | GREEN | 0 | 22 | yes | 30.39 | 5 |
| `packages/quay/test/serve-ac95-views.test.mjs` | 2 | 2026-10-15T07:30:19.606Z | 14.0 | 0 | GREEN | 0 | 22 | yes | 28.87 | 5 |
| `plugin/test/full-suite-runner-s10.test.mjs` | 1 | 2026-10-15T07:30:35.177Z | 12.0 | 0 | GREEN | 0 | 7 | yes | 25.66 | 14 |
| `plugin/test/full-suite-runner-s10.test.mjs` | 2 | 2026-10-15T07:30:48.776Z | 12.1 | 0 | GREEN | 0 | 7 | yes | 24.05 | 10 |
| `plugin/test/full-suite-runner-s12.test.mjs` | 1 | 2026-10-15T07:31:02.458Z | 14.3 | 0 | GREEN | 0 | 6 | yes | 22.15 | 4 |
| `plugin/test/full-suite-runner-s12.test.mjs` | 2 | 2026-10-15T07:31:18.307Z | 14.2 | 0 | GREEN | 0 | 6 | yes | 20.35 | 4 |
| `plugin/test/supervisor-observe.test.mjs` | 1 | 2026-10-15T07:31:34.046Z | 10.7 | 0 | GREEN | 0 | 8 | yes | 18.68 | 10 |
| `plugin/test/supervisor-observe.test.mjs` | 2 | 2026-10-15T07:31:46.336Z | 9.8 | 0 | GREEN | 0 | 8 | yes | 17.89 | 16 |
| `plugin/test/worker-driver.test.mjs` | 1 | 2026-10-15T07:31:57.664Z | 31.1 | 0 | GREEN | 0 | 147 | yes | 18.05 | 9 |
| `plugin/test/worker-driver.test.mjs` | 2 | 2026-10-15T07:32:30.273Z | 38.3 | 0 | GREEN | 0 | 147 | yes | 16.17 | 2 |
| `plugin/test/live-web-address.test.mjs` | 1 | 2026-10-15T07:33:10.150Z | 14.5 | 0 | GREEN | 0 | 17 | yes | 53.77 | 73 |
| `plugin/test/live-web-address.test.mjs` | 2 | 2026-10-15T07:33:26.199Z | 13.3 | 0 | GREEN | 0 | 17 | yes | 56.55 | 70 |
| `plugin/test/shipped-shell-reachability.test.mjs` | 1 | 2026-10-15T07:33:41.038Z | 7.9 | 0 | GREEN | 0 | 8 | yes | 51.04 | 7 |
| `plugin/test/shipped-shell-reachability.test.mjs` | 2 | 2026-10-15T07:33:50.458Z | 7.8 | 0 | GREEN | 0 | 8 | yes | 48.8 | 2 |
| `packages/quay/test/build-plugin-dist.test.mjs` | 1 | 2026-10-15T07:33:59.783Z | 6.7 | 0 | GREEN | 0 | 45 | yes | 43.92 | 2 |
| `packages/quay/test/build-plugin-dist.test.mjs` | 2 | 2026-10-15T07:34:08.076Z | 6.5 | 0 | GREEN | 0 | 45 | yes | 40.99 | 2 |
| `plugin/test/full-suite-runner-s02.test.mjs` | 1 | 2026-10-15T07:34:16.162Z | 15.8 | 0 | GREEN | 0 | 7 | yes | 42.9 | 5 |
| `plugin/test/full-suite-runner-s02.test.mjs` | 2 | 2026-10-15T07:34:33.520Z | 15.9 | 0 | GREEN | 0 | 7 | yes | 36.67 | 16 |
| `plugin/test/full-suite-runner-s05.test.mjs` | 1 | 2026-10-15T07:34:51.024Z | 14.4 | 0 | GREEN | 0 | 7 | yes | 30.45 | 9 |
| `plugin/test/full-suite-runner-s05.test.mjs` | 2 | 2026-10-15T07:35:06.962Z | 15.0 | 0 | GREEN | 0 | 7 | yes | 26.32 | 4 |
| `plugin/test/full-suite-runner-s06.test.mjs` | 1 | 2026-10-15T07:35:23.563Z | 11.1 | 0 | GREEN | 0 | 6 | yes | 25.1 | 14 |
| `plugin/test/full-suite-runner-s06.test.mjs` | 2 | 2026-10-15T07:35:36.227Z | 11.2 | 0 | GREEN | 0 | 6 | yes | 23.62 | 7 |
| `plugin/test/full-suite-runner-s08.test.mjs` | 1 | 2026-10-15T07:35:48.935Z | 16.4 | 0 | GREEN | 0 | 7 | yes | 22.87 | 6 |
| `plugin/test/full-suite-runner-s08.test.mjs` | 2 | 2026-10-15T07:36:06.930Z | 16.3 | 0 | GREEN | 0 | 7 | yes | 19.31 | 5 |
| `plugin/test/trend-check.test.mjs` | 1 | 2026-10-15T07:36:24.779Z | 10.1 | 0 | GREEN | 0 | 16 | yes | 18.59 | 4 |
| `plugin/test/trend-check.test.mjs` | 2 | 2026-10-15T07:36:36.427Z | 10.0 | 0 | GREEN | 0 | 16 | yes | 17.3 | 4 |
| `packages/quay/test/gap-ac179-criterion-cold-miss-dashboard-snapshot.test.mjs` | 1 | 2026-10-15T07:36:47.963Z | 15.0 | 0 | GREEN | 0 | 8 | yes | 17.88 | 6 |
| `packages/quay/test/gap-ac179-criterion-cold-miss-dashboard-snapshot.test.mjs` | 2 | 2026-10-15T07:37:04.564Z | 15.1 | 0 | GREEN | 0 | 8 | yes | 16.9 | 4 |
| `packages/quay/test/npm-pack-e2e.test.mjs` | 1 | 2026-10-15T07:37:21.270Z | 11.8 | 0 | GREEN | 0 | 11 | yes | 17.76 | 1 |
| `packages/quay/test/npm-pack-e2e.test.mjs` | 2 | 2026-10-15T07:37:34.622Z | 11.3 | 0 | GREEN | 0 | 11 | yes | 17.49 | 6 |
| `packages/quay/test/serve-board.test.mjs` | 1 | 2026-10-15T07:37:47.518Z | 7.3 | 0 | GREEN | 0 | 16 | yes | 16.63 | 9 |
| `packages/quay/test/serve-board.test.mjs` | 2 | 2026-10-15T07:37:56.330Z | 7.1 | 0 | GREEN | 0 | 16 | yes | 18.4 | 11 |
| `packages/quay/test/serve-handlers.test.mjs` | 1 | 2026-10-15T07:38:04.939Z | 8.7 | 0 | GREEN | 0 | 63 | yes | 18.37 | 5 |
| `packages/quay/test/serve-handlers.test.mjs` | 2 | 2026-10-15T07:38:15.226Z | 18.0 | 0 | GREEN | 0 | 63 | yes | 23.47 | 70 |
| `packages/quay/test/serve-live-body-i18n.test.mjs` | 1 | 2026-10-15T07:38:34.797Z | 8.3 | 0 | GREEN | 0 | 11 | yes | 83.62 | 140 |
| `packages/quay/test/serve-live-body-i18n.test.mjs` | 2 | 2026-10-15T07:38:44.681Z | 7.0 | 0 | GREEN | 0 | 11 | yes | 122.53 | 137 |
| `plugin/test/driver-anchor-takeover.test.mjs` | 1 | 2026-10-15T07:38:53.338Z | 15.0 | 0 | GREEN | 0 | 10 | yes | 150.26 | 135 |
| `plugin/test/driver-anchor-takeover.test.mjs` | 2 | 2026-10-15T07:39:09.930Z | 14.6 | 0 | GREEN | 0 | 10 | yes | 163.31 | 133 |
| `plugin/test/fan-in-execute-paths-s06.test.mjs` | 1 | 2026-10-15T07:39:26.062Z | 13.1 | 0 | GREEN | 0 | 10 | yes | 146.92 | 20 |
| `plugin/test/fan-in-execute-paths-s06.test.mjs` | 2 | 2026-10-15T07:39:40.726Z | 13.1 | 0 | GREEN | 0 | 10 | yes | 118.48 | 9 |
| `plugin/test/full-suite-runner-oom-policy.test.mjs` | 1 | 2026-10-15T07:39:55.375Z | 33.3 | 0 | GREEN | 0 | 23 | yes | 102.2 | 8 |
| `plugin/test/full-suite-runner-oom-policy.test.mjs` | 2 | 2026-10-15T07:40:30.233Z | 33.1 | 0 | GREEN | 0 | 23 | yes | 65.86 | 10 |
| `plugin/test/goal-driver-s04.test.mjs` | 1 | 2026-10-15T07:41:04.856Z | 4.9 | 0 | GREEN | 0 | 14 | yes | 42.18 | 4 |
| `plugin/test/goal-driver-s04.test.mjs` | 2 | 2026-10-15T07:41:11.343Z | 4.8 | 0 | GREEN | 0 | 14 | yes | 37.4 | 4 |
| `plugin/test/ownership-active-loop.test.mjs` | 1 | 2026-10-15T07:41:17.720Z | 20.4 | 0 | GREEN | 0 | 60 | yes | 36.01 | 4 |
| `plugin/test/ownership-active-loop.test.mjs` | 2 | 2026-10-15T07:41:39.645Z | 19.7 | 0 | GREEN | 0 | 60 | yes | 29.5 | 4 |
| `plugin/test/worker-fan-in.test.mjs` | 1 | 2026-10-15T07:42:00.893Z | 10.3 | 0 | GREEN | 0 | 5 | yes | 24.72 | 5 |
| `plugin/test/worker-fan-in.test.mjs` | 2 | 2026-10-15T07:42:12.771Z | 10.2 | 0 | GREEN | 0 | 5 | yes | 23.55 | 2 |
| `packages/quay/test/ac291-criterion-address-derivation.test.mjs` | 1 | 2026-10-15T07:42:24.564Z | 3.5 | 0 | GREEN | 0 | 13 | yes | 22.25 | 5 |
| `packages/quay/test/ac291-criterion-address-derivation.test.mjs` | 2 | 2026-10-15T07:42:29.606Z | 3.6 | 0 | GREEN | 0 | 13 | yes | 21.43 | 5 |
| `packages/quay/test/ac302-criterion-address-derivation.test.mjs` | 1 | 2026-10-15T07:42:34.728Z | 3.9 | 0 | GREEN | 0 | 19 | yes | 20.83 | 8 |
| `packages/quay/test/ac302-criterion-address-derivation.test.mjs` | 2 | 2026-10-15T07:42:40.184Z | 4.1 | 0 | GREEN | 0 | 19 | yes | 27.81 | 8 |
| `packages/quay/test/branch-model.test.mjs` | 1 | 2026-10-15T07:42:45.812Z | 18.0 | 0 | GREEN | 0 | 54 | yes | 41.39 | 5 |
| `packages/quay/test/branch-model.test.mjs` | 2 | 2026-10-15T07:43:05.361Z | 15.4 | 0 | GREEN | 0 | 54 | yes | 41.87 | 7 |
| `packages/quay/test/gap-dashboard-parallelize.test.mjs` | 1 | 2026-10-15T07:43:22.277Z | 3.8 | 0 | GREEN | 0 | 13 | yes | 35.44 | 10 |
| `packages/quay/test/gap-dashboard-parallelize.test.mjs` | 2 | 2026-10-15T07:43:27.645Z | 3.9 | 0 | GREEN | 0 | 13 | yes | 33.24 | 6 |
| `packages/quay/test/lanes-cli.test.mjs` | 1 | 2026-10-15T07:43:33.086Z | 2.5 | 0 | GREEN | 0 | 8 | yes | 32.18 | 13 |
| `packages/quay/test/lanes-cli.test.mjs` | 2 | 2026-10-15T07:43:37.120Z | 2.7 | 0 | GREEN | 0 | 8 | yes | 30.4 | 12 |
| `packages/quay/test/observation.test.mjs` | 1 | 2026-10-15T07:43:41.356Z | 17.9 | 0 | GREEN | 0 | 60 | yes | 33.25 | 12 |
| `packages/quay/test/observation.test.mjs` | 2 | 2026-10-15T07:44:00.843Z | 17.6 | 0 | GREEN | 0 | 60 | yes | 52.25 | 72 |
| `packages/quay/test/serve-system-body-i18n.test.mjs` | 1 | 2026-10-15T07:44:20.029Z | 45.7 | 0 | GREEN | 0 | 11 | yes | 56.6 | 73 |
| `packages/quay/test/serve-system-body-i18n.test.mjs` | 2 | 2026-10-15T07:45:16.159Z | 24.6 | 0 | GREEN | 0 | 11 | yes | 162.17 | 70 |
| `plugin/test/anchor-state-atomicity.test.mjs` | 1 | 2026-10-15T07:45:42.326Z | 6.6 | 0 | GREEN | 0 | 3 | yes | 169.45 | 78 |
| `plugin/test/anchor-state-atomicity.test.mjs` | 2 | 2026-10-15T07:45:50.538Z | 7.4 | 0 | GREEN | 0 | 3 | yes | 163.89 | 74 |
| `plugin/test/driver-anchor-declaration.test.mjs` | 1 | 2026-10-15T07:45:59.520Z | 4.8 | 0 | GREEN | 0 | 3 | yes | 154.54 | 68 |
| `plugin/test/driver-anchor-declaration.test.mjs` | 2 | 2026-10-15T07:46:05.906Z | 4.7 | 0 | GREEN | 0 | 3 | yes | 152.79 | 65 |
| `plugin/test/driver-anchor-stop.test.mjs` | 1 | 2026-10-15T07:46:12.162Z | 13.7 | 0 | GREEN | 0 | 5 | yes | 148.96 | 67 |
| `plugin/test/driver-anchor-stop.test.mjs` | 2 | 2026-10-15T07:46:27.404Z | 13.3 | 0 | GREEN | 0 | 5 | yes | 126.09 | 7 |
| `plugin/test/driver-cli.test.mjs` | 1 | 2026-10-15T07:46:42.259Z | 21.6 | 0 | GREEN | 0 | 9 | yes | 102.22 | 9 |
| `plugin/test/driver-cli.test.mjs` | 2 | 2026-10-15T07:47:05.421Z | 21.1 | 0 | GREEN | 0 | 9 | yes | 76.38 | 11 |
| `plugin/test/driver-resolves-code-root-separate-from-workspace.test.mjs` | 1 | 2026-10-15T07:47:28.090Z | 8.2 | 0 | GREEN | 0 | 7 | yes | 56.43 | 7 |
| `plugin/test/driver-resolves-code-root-separate-from-workspace.test.mjs` | 2 | 2026-10-15T07:47:37.853Z | 8.3 | 0 | GREEN | 0 | 7 | yes | 50.6 | 3 |
| `plugin/test/driver-restart-busy-e2e.test.mjs` | 1 | 2026-10-15T07:47:47.686Z | 34.4 | 0 | GREEN | 0 | 7 | yes | 45.59 | 3 |
| `plugin/test/driver-restart-busy-e2e.test.mjs` | 2 | 2026-10-15T07:48:23.662Z | 58.4 | 1 | RED | 1 | 6 | yes | 45.39 | 67 |
| `plugin/test/driver-runtime-loaded-version-drift.test.mjs` | 1 | 2026-10-15T07:49:23.577Z | 6.1 | 0 | GREEN | 0 | 22 | yes | 78.27 | 5 |
| `plugin/test/driver-runtime-loaded-version-drift.test.mjs` | 2 | 2026-10-15T07:49:31.252Z | 6.0 | 0 | GREEN | 0 | 22 | yes | 68.45 | 1 |
| `plugin/test/fan-in-driver-mechanical-orchestration.test.mjs` | 1 | 2026-10-15T07:49:38.827Z | 13.2 | 0 | GREEN | 0 | 13 | yes | 64.89 | 1 |
| `plugin/test/fan-in-driver-mechanical-orchestration.test.mjs` | 2 | 2026-10-15T07:49:53.548Z | 13.4 | 0 | GREEN | 0 | 13 | yes | 54.23 | 4 |
| `plugin/test/fan-in-execute-paths-s04.test.mjs` | 1 | 2026-10-15T07:50:08.506Z | 1.3 | 0 | GREEN | 0 | 9 | yes | 49.51 | 3 |
| `plugin/test/fan-in-execute-paths-s04.test.mjs` | 2 | 2026-10-15T07:50:11.382Z | 1.3 | 0 | GREEN | 0 | 9 | yes | 46.27 | 3 |
| `plugin/test/fan-in-execute-paths-s08.test.mjs` | 1 | 2026-10-15T07:50:14.237Z | 0.6 | 0 | GREEN | 0 | 10 | yes | 46.27 | 3 |
| `plugin/test/fan-in-execute-paths-s08.test.mjs` | 2 | 2026-10-15T07:50:16.361Z | 0.6 | 0 | GREEN | 0 | 10 | yes | 43.84 | 3 |
| `plugin/test/fan-in-execute-paths-s10.test.mjs` | 1 | 2026-10-15T07:50:18.488Z | 0.8 | 0 | GREEN | 0 | 9 | yes | 43.84 | 3 |
| `plugin/test/fan-in-execute-paths-s10.test.mjs` | 2 | 2026-10-15T07:50:20.831Z | 0.8 | 0 | GREEN | 0 | 9 | yes | 43.84 | 6 |
| `plugin/test/fan-in-execute-paths-s11.test.mjs` | 1 | 2026-10-15T07:50:23.155Z | 10.4 | 0 | GREEN | 0 | 5 | yes | 41.21 | 4 |
| `plugin/test/fan-in-execute-paths-s11.test.mjs` | 2 | 2026-10-15T07:50:35.123Z | 10.4 | 0 | GREEN | 0 | 5 | yes | 36.47 | 3 |
| `plugin/test/fan-in-execute-paths-s12.test.mjs` | 1 | 2026-10-15T07:50:47.078Z | 14.6 | 0 | GREEN | 0 | 4 | yes | 31.77 | 8 |
| `plugin/test/fan-in-execute-paths-s12.test.mjs` | 2 | 2026-10-15T07:51:03.230Z | 14.5 | 0 | GREEN | 0 | 4 | yes | 34.66 | 10 |
| `plugin/test/full-suite-runner-s01.test.mjs` | 1 | 2026-10-15T07:51:19.295Z | 7.7 | 0 | GREEN | 0 | 7 | yes | 43.65 | 7 |
| `plugin/test/full-suite-runner-s01.test.mjs` | 2 | 2026-10-15T07:51:28.539Z | 7.5 | 0 | GREEN | 0 | 7 | yes | 39.87 | 3 |
| `plugin/test/full-suite-runner-s03.test.mjs` | 1 | 2026-10-15T07:51:37.617Z | 4.3 | 0 | GREEN | 0 | 7 | yes | 35.86 | 7 |
| `plugin/test/full-suite-runner-s03.test.mjs` | 2 | 2026-10-15T07:51:43.425Z | 4.2 | 0 | GREEN | 0 | 7 | yes | 33.55 | 10 |
| `plugin/test/full-suite-runner-s04.test.mjs` | 1 | 2026-10-15T07:51:49.141Z | 7.6 | 0 | GREEN | 0 | 7 | yes | 31.74 | 10 |
| `plugin/test/full-suite-runner-s04.test.mjs` | 2 | 2026-10-15T07:51:58.265Z | 7.6 | 0 | GREEN | 0 | 7 | yes | 28.55 | 4 |
| `plugin/test/full-suite-runner-s09.test.mjs` | 1 | 2026-10-15T07:52:07.403Z | 6.9 | 0 | GREEN | 0 | 7 | yes | 26.47 | 4 |
| `plugin/test/full-suite-runner-s09.test.mjs` | 2 | 2026-10-15T07:52:15.825Z | 7.0 | 0 | GREEN | 0 | 7 | yes | 25.23 | 4 |
| `plugin/test/full-suite-runner-s11.test.mjs` | 1 | 2026-10-15T07:52:24.343Z | 4.0 | 0 | GREEN | 0 | 7 | yes | 23.48 | 8 |
| `plugin/test/full-suite-runner-s11.test.mjs` | 2 | 2026-10-15T07:52:29.928Z | 4.0 | 0 | GREEN | 0 | 7 | yes | 22.88 | 5 |
| `plugin/test/measure-trend-check.test.mjs` | 1 | 2026-10-15T07:52:35.483Z | 1.4 | 0 | GREEN | 0 | 19 | yes | 21.85 | 8 |
| `plugin/test/measure-trend-check.test.mjs` | 2 | 2026-10-15T07:52:38.422Z | 1.4 | 0 | GREEN | 0 | 19 | yes | 21.62 | 5 |
| `plugin/test/ownership-active-slice-adapter.test.mjs` | 1 | 2026-10-15T07:52:41.338Z | 19.5 | 0 | GREEN | 0 | 14 | yes | 21.57 | 8 |
| `plugin/test/ownership-active-slice-adapter.test.mjs` | 2 | 2026-10-15T07:53:02.373Z | 19.7 | 0 | GREEN | 0 | 14 | yes | 19.8 | 3 |
| `plugin/test/promotion-driver-s03.test.mjs` | 1 | 2026-10-15T07:53:23.613Z | 11.6 | 0 | GREEN | 0 | 7 | yes | 20.83 | 4 |
| `plugin/test/promotion-driver-s03.test.mjs` | 2 | 2026-10-15T07:53:36.734Z | 11.6 | 0 | GREEN | 0 | 7 | yes | 23.14 | 4 |
| `plugin/test/resource-gate-s08.test.mjs` | 1 | 2026-10-15T07:53:49.934Z | 11.9 | 0 | GREEN | 0 | 8 | yes | 21.42 | 7 |
| `plugin/test/resource-gate-s08.test.mjs` | 2 | 2026-10-15T07:54:03.340Z | 11.8 | 0 | GREEN | 0 | 8 | yes | 19.62 | 11 |
| `plugin/test/shipped-set.test.mjs` | 1 | 2026-10-15T07:54:16.684Z | 23.4 | 0 | GREEN | 0 | 11 | yes | 34.45 | 11 |
| `plugin/test/shipped-set.test.mjs` | 2 | 2026-10-15T07:54:41.700Z | 29.1 | 0 | GREEN | 0 | 11 | yes | 59.88 | 69 |
| `plugin/test/suite-accounting.test.mjs` | 1 | 2026-10-15T07:55:12.399Z | 3.4 | 0 | GREEN | 0 | 5 | yes | 100.59 | 22 |
| `plugin/test/suite-accounting.test.mjs` | 2 | 2026-10-15T07:55:17.377Z | 3.4 | 0 | GREEN | 0 | 5 | yes | 104.31 | 14 |
| `plugin/test/suite-driver.test.mjs` | 1 | 2026-10-15T07:55:22.325Z | 5.1 | 0 | GREEN | 0 | 14 | yes | 107.65 | 8 |
| `plugin/test/suite-driver.test.mjs` | 2 | 2026-10-15T07:55:28.970Z | 5.1 | 0 | GREEN | 0 | 14 | yes | 101.75 | 2 |
| `plugin/test/suite-state-trigger.test.mjs` | 1 | 2026-10-15T07:55:35.614Z | 5.7 | 0 | GREEN | 0 | 60 | yes | 104.65 | 9 |
| `plugin/test/suite-state-trigger.test.mjs` | 2 | 2026-10-15T07:55:42.874Z | 5.8 | 0 | GREEN | 0 | 60 | yes | 94.77 | 9 |

## 5. 确定性红 ⇒ 修复任务（AC3）

**本任务板上无需新立修复任务：120 趟单独运行里，没有任何文件判为「确定性红」。**

这是如实读数，不是省略：分类表 §3 的 60 行里 `确定性红` 计数为 **0**，AC2 的判定规则下无文件满足。

**为什么这与「基线不绿」并不矛盾**（先把机制说清，避免被读成「基线其实没事」）：

1. 载体 `.quay/baseline-red-rounds.jsonl` 的 `blocked` **不是**「develop 上本来就红的文件」，
   而是「**task 树红了、develop 基线树重跑没红**」的文件（§1.1 的代码位置）。能被判成
   `hard-red` 的前提，**恰恰是基线那一趟是绿的**。
2. ⇒ 一个在 develop 上**确定性红**的文件，A/B 两趟都会红 ⇒ 走 `exempt` ⇒ **结构性不会进入本载体**。
   也就是说：本载体的构成方式**已经蕴含**了「成员应当是只在负载下红的那一类」。
3. 本期测量把这个蕴含**验证**了，而不是假定了：同一棵树（develop tip）、同一个文件、**单独**跑，
   59/60 全绿。

⇒ **对 DoD 的直读结论**：DoD 里「确定性红修复任务全部落地」这一条在**本期是空集**（无可落地对象）；
剩下的方向正是 Proposal 已经指出的「内存与并发」——人 2026-10-15 已裁定套件 MemoryMax 可放大到 32G，
`.quay/config.yml` 当前声明 `suite.memory_max: 26G`（按声明值生效）。

**方向已有归属（查重结论；本任务不重复立案）**——下表是把 §3 的分类表与任务板对照后的结论：

| 方向 | 已有任务 | 状态 |
|---|---|---|
| 声明的套件 memory_max 被多 scope 分摊护栏静默压到 26G（人裁定可到 32G） | `gap-suite-declared-memory-max-swallowed-by-shared-host-split` | ready（在飞） |
| 重型文件优化 + 内存感知调度 + 32/48/64 并发同 commit 对照 | `gap-suite-heavy-files-and-phase-concurrency-under-16g-pressure-baseline-comparison` | todo |
| 套件内存遥测（anon/file/shmem、swap、PSI、实际 phase） | `gap-suite-memory-telemetry-anon-file-shmem-swap-psi-concurrency-process-tree-unknown-not-zero` | ready |
| fan-in 的 A/B 已把「既存红 ⊆」这一档做成机械豁免（本任务载体的来源） | `gap-fanin-suite-gate-no-baseline-equivalent-exception` | done |

⛔ 这四条都**不是**「某个测试文件坏了」，因此按 AC3 的字面要求（「每个确定性红文件对应一条任务 id」）
本期没有需要新立的对象；把它们列出来是为了让「0 确定性红」这个结论**可执行**（下一步该往哪走），
而不是把空集读成「没事」。

### 5b. 那 1 个「不稳定」文件的补充刻画（⛔ 不改判定，只补读数）

规则把它判成「不稳定」，但「不稳定」本身还不是结论 —— 它是「**红的那些趟发生在什么条件下**」
这个问题。下面是**同一套调用形态**、对同一个文件追跑的读数（`supp/results.jsonl`，同样逐趟记负载）：

**`plugin/test/driver-restart-busy-e2e.test.mjs`**

| 趟 | 组 | 开始时刻 (UTC) | 耗时 s | 退出码 | 判定 | TAP fail | 开始时 load1 | 开始时 node --test 进程数 |
|---|---|---|---|---|---|---|---|---|
| 1 | 主扫 | 2026-10-15T07:47:47.686Z | 34.4 | 0 | GREEN | 0 | 45.59 | 3 |
| 2 | 主扫 | 2026-10-15T07:48:23.662Z | 58.4 | 1 | **RED** | 1 | 45.39 | 67 |
| 1 | 追跑 | 2026-10-15T07:56:31.352Z | 34.2 | 0 | GREEN | 0 | 77.39 | 6 |
| 2 | 追跑 | 2026-10-15T07:57:07.086Z | 30.2 | 1 | **RED** | 1 | 50.51 | 3 |

红那趟失败的点名与断言原文（从该趟日志直读）：

```
not ok - AC2a-real — `restart --kind worker` with a genuinely in-flight worker: the pre-detach loop aborts; the shipped loop confirms in seconds, keeps + adopts the worker, fans it in once, and never double-dispatches
error: 'timed out waiting for the dispatched fixture worker to appear'
```

**逐用例、逐趟**（格内 = 判定 / 该用例耗时；**R** = 红）：

| 用例 | 主扫p1 | 主扫p2 | 追跑p1 | 追跑p2 |
|---|---|---|---|---|
| AC1 — mid-round `restart --kind quality` on the shipped-layout kernel confirms within the bound; the interrupted round is a distinct stopped-mid-round state, and no reservation is taken after the stop | G / 4.2s | G / 5.6s | G / 4.3s | G / 4.3s |
| AC4 — three consecutive `restart --kind quality` with no pause all confirm; the other kinds and the anchor pid are unchanged | G / 6.1s | G / 6.2s | G / 6.0s | G / 6.1s |
| AC5 — a loop that ignores every stop makes `restart` abort legibly, with desired state restored and exactly one loop | G / 4.9s | G / 4.8s | G / 4.9s | G / 4.9s |
| AC2a — `restart --kind worker` leaves the in-flight worker child alive (§6.9 inv.3) and starts exactly one new loop | G / 4.3s | G / 4.6s | G / 4.2s | G / 4.2s |
| **AC2a-real — `restart --kind worker` with a genuinely in-flight worker: the pre-detach loop aborts; the shipped loop confirms in seconds, keeps + adopts the worker, fans it in once, and never double-dispatches** | G / 13.6s | **R** / 35.8s | G / 13.4s | **R** / 8.7s |
| AC2b — an orphan worker that exits is ADOPTED and fanned in exactly once (not booked `failed`), and its task is never dispatched twice | G / 0.6s | G / 0.5s | G / 0.5s | G / 0.7s |
| AC3 — a dead orphan whose worktree carries commits resumes its fan-in (refused on its own AC grounds) and is NOT recorded `failed: orphaned`; a dead orphan with NO commits keeps the old outcome | G / 0.6s | G / 0.5s | G / 0.4s | G / 1.1s |

⇒ 红点**始终是同一个用例**（AC2a-real — `restart --kind worker` with a genuinely in-flight worker: the pre-detach loop aborts; the shipped loop confirms in seconds, keeps + adopts the worker, fans it in once, and never double-dispatches）：28 个「用例×趟」单元里共 2 个红，其余每个用例在每一趟都绿 —— 所以这不是「整个文件不稳」，而是**一条用例的定时假设**在部分趟次不成立。

⚠️ **不要用耗时判断这条红**：该用例绿的时候是 13.6s / 13.4s，红的时候是 35.8s / 8.7s —— 红的那两趟里有一次**比绿趟还短**（预算到点就报错，不等满）。

**负载相关性（说出来，但不夸大）**：4 趟里 2 绿 2 红。红趟开场时 `/proc` 里的 node `--test` 进程数是 67 / 3，绿趟是 3 / 6。主扫那一对（3 vs 67 进程，34.4s vs 58.4s）**同向**；⛔ 但追跑的 p2 在只有 3 个进程时也红了，⇒ 这个相关性是**提示**，不是已证的成因。可证伪的机制解释只有一条，且它由失败文案直接给出：

```
error: 'timed out waiting for the dispatched fixture worker to appear'
```

即「派发的夹具 worker 在预算内没出现」—— 一条**墙钟等待**，不是断言值算错。
本条在 4 趟里 2 次不成立，**不属于** Proposal 说的「全量套件才红」那一类（它在单独跑时也红），
也不属于「确定性红」（另 2 趟绿）。**按 AC2 规则它恰属「不稳定」**，且现在有了被点名的用例与 4 趟读数。

**归属（查重）**：该文件已有 `gap-busy-restart-e2e-ac2a-fixture-replaces-real-worker-driver-so-in-flight-restart-gate-is-untested`（done）与
`gap-driver-restart-anytime-busy-e2e-on-dist-kernel`（done）两条历史任务；**当前在飞**的
`gap-test-spawned-anchor-scopes-outlive-suite-again-ac1-stop-and-restart-ac5`（ready）正管着这个文件留下的 anchor scope 泄漏
（其实测读数：一次**全绿**的该文件运行也会留下 `quay-anchor-e2e-restart-ac2a-*.scope`，成员停在夹具自己的在飞子进程上）。
⇒ 本任务**不新立**该文件的修复任务：它此刻的「不稳定」读数与那条在飞任务所描述的资源形状同源，
且本期只做测量、⛔ 不改任何测试代码（Touches 不含该文件）。

## 6. 复现

测量脚本（**不在本仓库内**，跑在 `/data/scratch/yale/gap-dev-baseline-red-classify/`）：
`extract.mjs`（取数）→ `run.mjs`（逐文件两遍）→ `classify.mjs`（分类）→ `emit-doc.mjs`（本文）。

```bash
D=/data/scratch/yale/gap-dev-baseline-red-classify
W=/home/yale/work/quay-worktrees/gap-develop-baseline-red-classify-deterministic-vs-load
node $D/extract.mjs /data/home/yale/work/quay/.quay/baseline-red-rounds.jsonl $D
node $D/run.mjs "$W" $D          # 每文件两趟，顺序执行
node $D/classify.mjs $D
node $D/emit-doc.mjs $D "$W/docs/evidence/2026-10-15-develop-baseline-red-classification.md"
```
