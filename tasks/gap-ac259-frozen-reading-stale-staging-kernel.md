---
id: gap-ac259-frozen-reading-stale-staging-kernel
title: AC-259 台账读数「此刻为假」的成因不止轮转排队：跑着的 goal 内核是 gitignored dev-tree 暂存 dist（07:35
  构建，早于 10:17 落地的立案前复核）⇒ 已落地的修复从未生效，且该内核结构上永不自刷新（实测 sourceFilesMaxMtimeMs 恒 0 /
  supervisorStaleness 报 fresh）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-259
---
## Finding

**① 真值 = 真（2026-09-15T17:56Z，主检出 `/home/yale/work/quay`，逐字跑）**

- `node --experimental-strip-types packages/quay/bin/quay.ts goal gate AC-259 --dry-run --root /home/yale/work/quay` → `verdict: "pass"`，`reason: "acceptance passed (exit 0)"`，timestamp `2026-09-15T17:56:15.950Z`。
- 另把 criterion 从 frontmatter 抽出直接 `bash` 跑 → **exit 0**。
- 两台机器的载体记录都在 `.quay/productization-verification.jsonl`：第 183 行 `GOAL-018-AC-257`（host=ad-arm1, quay_version=0.7.0-dev, task_status=done, ts=2026-09-15T17:34:56Z, build_sha=0c77b527）、第 184 行同一 ac 重落（ts=2026-09-15T17:55:43Z, build_sha=7f0ee27e）、第 182 行 `GOAL-018-AC-258`（host=orangevps, 0.7.0-dev, done, ts=2026-09-15T16:27:15Z, build_sha=e37f44f1）。

**② 读数 = 假**

`quay goal check --stale-pass --root /home/yale/work/quay` → **exit 1**，`frozenScope: 86`、`failing: ["AC-259"]`。

成因（`checkStalePass` 口径，可核、非推断）：AC-259 最后一条**轮转** verdict 是 `2026-09-15T17:35:05.096Z` 的 `fail`（`actor=goal-sweep`，`payload.criterionHash=8ccfd00300ded08f`），落在 `DEFAULT_STALE_PASS_MAX_AGE_MS`（4h）内 ⇒ 判定面直接取它，**压过**更新的尾事件：AC-259 在 `17:48:27.316Z` 与 `17:49:29.044Z` 各有一条 `actor=goal-cli` 的 **pass**（`quay goal gate` 写的），而判定面只认 `goal-sweep`/`goal-amend`，**不读** `goal-cli`。

**③ 那条 fail 是竞态，不是回归**

criterion 第二个合取项要求存在 `GOAL-018-AC-257` 的 done 记录。该记录的 `ts` 字段是**远端整趟运行的开始时刻**（17:34:56Z），它**落盘**却在 17:39Z 左右（`.quay/productization-verification.jsonl` 在 17:56:0x 实测 mtime = `2026-09-15 17:39`）⇒ 17:35:05Z 的那轮轮转**合理地**看不到它。真值当时确实为假，**修复本身没有回退**。

**④ 本任务与 AC-162 先例的分界（本任务的核心，且是新的）**

<!-- dedup-ref -->
先例 `gap-ac162-frozen-verdict-predates-fix`（done）把同类分叉解释为「轮转队列排空，等生产轮转即自愈」；本任务实测到一个它没有的、更强的成因：**为防这种误立案而落地的修复，从来没有执行过。**

- 防误立案的机制是 `recheckFrozenFailing`（立案前对 `failing` 命中的 AC **真跑一次** criterion，`cleared` 则不立案），提交 `32d8ddd4d`，落地时刻 **2026-09-15T10:17:10Z**。
- 跑着的 goal 内核是 anchor `pid 4014875`（`ps` 实测 `startedAt=2026-09-15T02:15:14.983Z`；cmdline = `/home/yale/work/quay/packages/quay/plugin/scripts/dist/driver-anchor.js __anchor --root /home/yale/work/quay`）。它经 `resolveKernelSibling` 加载的 goal 模块是 `/home/yale/work/quay/packages/quay/plugin/scripts/dist/goal-driver.js`。
- 该 bundle 的 `mtime = 2026-09-15T07:35:49.685Z`，比 `32d8ddd4d` **早 2 小时 41 分**。实测：`grep -c 'recheckFrozenFailing'` = **0**；`grep -c 'RE-RAN its criterion directly before filing'` = **0**；而**旧句**逐字在内：`…is recorded as CURRENTLY FALSE in the gate ledger. No other mechanism re-runs it, so without a task it stays false forever.`
- **直接量证据（无需推断）**：本轮派给本 agent 的 dispatch prompt 就逐字引用了那句**已被删除**的话——而 `plugin/test/goal-driver.test.mjs:1414` 现在逐字断言该串**不得出现**（`assert.ok(!p.includes('No other mechanism re-runs it'))`）。⇒ 写这条 prompt 的代码是 10:17 之前的版本。

**⑤ 该内核结构上永远逃不出去（这是它不只是「一时陈旧」的原因）——实测，非推断**

`sourceFilesMaxMtimeMs`（`plugin/scripts/driver-runtime.ts:1455-1465`）用 `path.join(resolveKernelScriptsDir(), rel)` stat `rel ∈ watchedSourceFiles(kind)`；kind=goal 的集合是 `goal-driver.ts` + `SHARED_SOURCE_FILES`（`driver-filters.ts`/`driver-runtime.ts`/`driver-result.ts`/`driver-shared.ts`/`driver-config.ts`/`driver-anchor.ts`）。

跑着的内核的 `resolveKernelScriptsDir()` = `path.dirname(kernelSelfPath())` = `…/plugin/scripts/dist/`，该目录**只有 `.js`、一个 `.ts` 都没有**（逐名实测：7 个里 0 个 `.ts` 存在，3 个有同名 `.js`）⇒ 每次 stat 抛错 ⇒ `catch { /* 缺失 → 跳过 */ }` 跳过 ⇒ `max` 恒 **0**。

按同一口径实测（2026-09-15T17:5xZ）：

```
sourceFilesMaxMtimeMs(kind=goal) = 0
anchor startedAt                 = 1789438514983        (= 2026-09-15T02:15:14.983Z)
sourceChangedSince               = false
supervisorStaleness              = fresh
```

⇒ 两条自刷新路径**同时**失效：`sourceChangedSince` 恒 false；`preferredAnchorKernel()` 也回到同一个文件（`mainCheckoutKernelDir()` 在 `main === selfRepo` 时返回 `here`，故 `cand.path === me`，`mainKernelStale` 分支同样不成立）。

**⚠️ 连带后果（先例的检测器在此部署下也是瞎的）**：`gap-supervisor-never-self-refreshes-no-detector`（done）新增的检测器 `supervisorStaleness`（`:1557-1576`）判据逐字是 `sourceMtimeMs > supervisorStartedAt ? "stale" : "fresh"`，输入正是上面那个恒 0 的 `sourceFilesMaxMtimeMs` ⇒ `0 > startedAt` 为假 ⇒ **它对一个陈旧 2h41m 的内核报 `fresh`**。即：一个「源码陈旧检测器」的输入是常量，其输出与「一切正常」同形（硬规则 3b/4b）。

`driver-runtime.ts:1451-1454` 的注释把这个恒 0 判为「正确：装好的 bundle 是静态的，无源码可推进」。**前提不成立**：`packages/quay/plugin/` 不是装好的产物，而是本仓库 dev tree 里的**构建暂存目录**——`.gitignore:26` 明确忽略它，`git ls-files packages/quay/plugin` = **0** 条，且它会在原地被重建（今天 07:35 就被重建过一次，而 anchor 那时已在跑）。

⇒ **任何对 `plugin/scripts/*.ts`（及 `SHARED_SOURCE_FILES`）的落地改动，在这个常驻内核里都是静默不生效的——不是「要重启」，是重启也不会换版本**（重启后 `resolveKernelScriptsDir()` 仍是那个 dist 目录）。

**⑥ 一个派生观察（⛔ 观察项，非判据）**

`DEFAULT_FAIL_RECHECK_DIVISOR=6` 让 fail 的 AC 提前到 `minAgeMs/6` = 10 min 可重扫（`packages/quay/src/goal-store.ts:189-196` 的注释承诺「re-runs it within one driver round … 于是那条 fail 不再当台账尾」），但 `eligible` 的排序是 `ageOf` 降序（最久未验优先，`:1811-1826`）⇒ 刚 fail 的 AC 是最**年轻**的候选，排**最后**。实测：AC-259 自 `17:45:05` 起合格，`17:47:05` 那轮取走 6 条（AC-172/228/143/144/145/162）、`17:54:09` 那轮又取走 6 条（AC-146/148/150/151/152/153），**两轮都没取到它**。⇒ 注释承诺的「一个 driver 轮内」在 `frozenScope=86 > budget=6` 时不成立。**本任务不为它立论**（是设计取舍还是缺陷需 owner 判），此处只落读数；它与 ④⑤ 独立——④⑤ 修好后误立案会停，与这条无关。

## Requested action

让**跑着的那份内核**不再执行 10:17 之前的目标模块，并让「内核在跑陈旧 dev-tree 暂存 bundle」这件事**可见**：要么自刷新到源内核，要么在 `aliveness()` / `quay driver status` 里以**独立取值**报陈旧，⛔ 不得与「新鲜」同形（硬规则 3b）。

方向（实现者选其一或组合，但 AC3 的对照必须造出来）：

- 让 `sourceChangedSince` / `preferredAnchorKernel` 认出「本内核位于 `<repo>/packages/quay/plugin/`（`plugin/` 的 dev-tree 暂存副本）而其源内核 `<repo>/plugin/scripts/` 已推进」这一形态，从而自刷新到源内核；或
- 让 `sourceFilesMaxMtimeMs` 在「被监视的 `.ts` 一个都 stat 不到」时返回**独立取值**（`not-evaluated` / 显式 stale），不再与「未变更」共用那个恒 0；或
- 让 `quay driver start` 拒绝/修复从 gitignored 暂存目录启动自宿主内核。

⛔ 只改 `driver-runtime.ts:1451-1454` 的注释不算完成：注释不是产物。

## AC

- [ ] AC1 读数是**直接量**，且指向跑着的那份代码：`ps -o cmd= -p $(cat .quay/anchor.pid)` 取出内核路径 → 按 `resolveKernelSibling` 同一口径解析该内核会加载的 goal 模块 → 对该**文件**求值 `grep -c 'recheckFrozenFailing'` ≥ 1 **且** `grep -c 'No other mechanism re-runs it'` = 0。（⛔ 对 `plugin/scripts/goal-driver.ts` 求值不算——源侧本来就过，是空转形，硬规则 4c 推论三。）
- [ ] AC2 **活的内核**上复核：修复后经一轮真实 goal 环，`grep -c 'RE-RAN its criterion directly before filing'` 在该轮实际写出的 gap-filing prompt 载体上 ≥ 1（或在跑内核加载的模块上 ≥ 1，AC1 同口径）。
- [ ] AC3 **区分对照**（硬规则 4c 推论四：必须给出「若假设为假则结果会不同」的对照）：对「内核在 gitignored dev-tree 暂存目录」这一输入，两臂预测相反并各有落痕——
  **(a) 源内核未推进** ⇒ 读数/行为 = `fresh`（不自刷新、不报陈旧）；**(b) 源内核已推进** ⇒ 读数/行为 = 陈旧（自刷新到源内核，或以独立取值报出）。只给一臂不算过。
- [ ] AC4 回归钉子接进常规套件（`plugin/test/driver-anchor.test.mjs` 或 `plugin/test/kernel-sibling-resolution-check.test.mjs`，路径须匹配 `scripts/test.sh` 的 glob），且该测试**能取假**：把修复回退 ⇒ 它必红（⛔ 不许用只断言「函数存在」的形状）。
- [ ] AC5 AC-259 的 `--stale-pass` 读数转 `verifiedFresh`：`quay goal check --stale-pass --root /home/yale/work/quay` → **exit 0** 且 `failing` 不含 `AC-259`；**负控制**：`.quay/gate-events.jsonl` 里存在满足 `pipeline_id="AC-259" ∧ gate="goal" ∧ actor ∈ {goal-sweep, goal-amend} ∧ verdict="pass" ∧ timestamp > 2026-09-15T17:35:05.096Z ∧ payload.criterionHash == "8ccfd00300ded08f"` 的事件。（老化不产生新事件；后写的 `goal-cli` pass 判定面不读 ⇒ 这条能区分「轮转真的重取过」与「等它自己掉出去」。）

## DoD

- 跑着的 self-host 内核加载的 goal 模块**含** `recheckFrozenFailing`，且不再逐字携带 `No other mechanism re-runs it…` 那句——证据取自**跑着内核的路径**（AC1 口径），不是源文件。
- 「内核跑在 dev-tree 暂存目录 ⇒ 静默陈旧」这一形态被消除或被报出（AC3 两臂实测落痕）；`driver-runtime.ts:1451-1454` 那句「装好的 bundle 是静态的」所依赖的前提被写清（暂存目录 ≠ 装好的产物），或该注释与代码一并更正。
- AC-259 的判据仍为真（`quay goal gate AC-259` → exit 0），且读数 exit 0 / `failing` 不含它，AC5 的负控事件真实存在。
- `## Resolution` 留有可复核的：内核 pid + cmdline + 其加载模块的**绝对路径** + 该路径上的两个 grep 读数 + AC3 两臂读数 + AC5 事件 timestamp。下一轮无需重新推导。

## Touches

- plugin/scripts/driver-runtime.ts
- plugin/scripts/driver-anchor.ts
- plugin/test/driver-anchor.test.mjs
- plugin/test/kernel-sibling-resolution-check.test.mjs
- tasks/gap-ac259-frozen-reading-stale-staging-kernel.md
