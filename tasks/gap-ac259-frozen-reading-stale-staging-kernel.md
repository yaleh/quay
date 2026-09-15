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

- [ ] AC1 读数是**直接量**，且指向跑着的那份代码：`ps -o cmd= -p $(cat .quay/anchor.pid)` 取出内核路径 → 按 `resolveKernelSibling` 同一口径解析该内核会加载的 goal 模块 → 对该**文件**求值 `grep -c 'recheckFrozenFailing'` ≥ 1 **且** `grep -c 'No other mechanism re-runs it'` = 0。（⛔ 对 `plugin/scripts/goal-driver.ts` 求值不算——源侧本来就过，是空转形，硬规则 4c 推论三。）——**待激活**：跑着的内核仍加载 07:35 的暂存 bundle（`recheckFrozenFailing`=0、旧句=1）。⛔ 这不是实现缺口，是**引导缺口**：修复的自刷新只在「跑着的内核已含本修复」时才生效，故需要一次外部激活（见 `## Resolution` 的激活配方）；激活后本判据在本修复的基线上自动成立，无需再改代码。**（待外部）**
- [ ] AC2 **活的内核**上复核：修复后经一轮真实 goal 环，`grep -c 'RE-RAN its criterion directly before filing'` 在该轮实际写出的 gap-filing prompt 载体上 ≥ 1（或在跑内核加载的模块上 ≥ 1，AC1 同口径）。——**待激活**（与 AC1 同一引导缺口、同一配方）。**（待外部）**
- [x] AC3 **区分对照**（硬规则 4c 推论四：必须给出「若假设为假则结果会不同」的对照）：对「内核在 gitignored dev-tree 暂存目录」这一输入，两臂预测相反并各有落痕——
  **(a) 源内核未推进** ⇒ 读数/行为 = `fresh`（不自刷新、不报陈旧）；**(b) 源内核已推进** ⇒ 读数/行为 = 陈旧（自刷新到源内核，或以独立取值报出）。只给一臂不算过。
  **落地**：`plugin/test/driver-anchor.test.mjs` 的 `内核源树两臂对照`（同一夹具、只改源树 mtime 这一处）：(a) ⇒ `mirror` + `fresh`；(b) ⇒ `stale`；并显式断言同一输入下**旧读法** = 0（正控制）。(b) 的**行为**半边 = `preferredAnchorKernelIn` 换到源树里更新的那份 bundle（测试 ii/iii 钉住「更旧不换 / 无源树不换」）。**活体读数**（跑着内核的路径，见 Resolution 表）：goal/promotion 均 `mirror` + `stale`。
- [x] AC4 回归钉子接进常规套件（`plugin/test/driver-anchor.test.mjs` 或 `plugin/test/kernel-sibling-resolution-check.test.mjs`，路径须匹配 `scripts/test.sh` 的 glob），且该测试**能取假**：把修复回退 ⇒ 它必红（⛔ 不许用只断言「函数存在」的形状）。
  **落地**：`plugin/test/driver-anchor.test.mjs` 三个测试（两臂对照 / fail-closed 三态 / `preferredAnchorKernelIn` 三态）。**突变实测 1/1 红**：把 `sourceFilesMaxMtimeMs` 回退成「只 stat 本内核目录」的旧 body ⇒ `内核源树两臂对照` 红（`ℹ fail 1`），恢复 ⇒ 3/3 绿。
- [ ] AC5 AC-259 的 `--stale-pass` 读数转 `verifiedFresh`：`quay goal check --stale-pass --root /home/yale/work/quay` → **exit 0** 且 `failing` 不含 `AC-259`；**负控制**：`.quay/gate-events.jsonl` 里存在满足 `pipeline_id="AC-259" ∧ gate="goal" ∧ actor ∈ {goal-sweep, goal-amend} ∧ verdict="pass" ∧ timestamp > 2026-09-15T17:35:05.096Z ∧ payload.criterionHash == "8ccfd00300ded08f"` 的事件。（老化不产生新事件；后写的 `goal-cli` pass 判定面不读 ⇒ 这条能区分「轮转真的重取过」与「等它自己掉出去」。）
  ——**待轮转**：轮转在推进中（18:20 那轮取了 AC-201/205/207/232/234/238），尚未取到 AC-259（当前 `failing: ["AC-259"]`、`frozenScope: 86`）。本条**与本修复无关**（是 Finding ③ 的竞态，靠轮转重取收敛），且**不需要激活**。**（待外部）**

## DoD

- 跑着的 self-host 内核加载的 goal 模块**含** `recheckFrozenFailing`，且不再逐字携带 `No other mechanism re-runs it…` 那句——证据取自**跑着内核的路径**（AC1 口径），不是源文件。**（待激活，见 AC1）**
- 「内核跑在 dev-tree 暂存目录 ⇒ 静默陈旧」这一形态被消除或被报出（AC3 两臂实测落痕）；`driver-runtime.ts:1451-1454` 那句「装好的 bundle 是静态的」所依赖的前提被写清（暂存目录 ≠ 装好的产物），或该注释与代码一并更正。**✅ 已做**：该注释整段重写为「一个目录里被监视 .ts 全缺 ⇒ 退回它的**源树**；源树也没有（真·装好的产物）⇒ `unwatched` 独立取值」，并新增 `kernelSourceScriptsDir` / `sourceWatch`。
- AC-259 的判据仍为真（`quay goal gate AC-259` → exit 0），且读数 exit 0 / `failing` 不含它，AC5 的负控事件真实存在。**（AC5 待轮转）**
- `## Resolution` 留有可复核的：内核 pid + cmdline + 其加载模块的**绝对路径** + 该路径上的两个 grep 读数 + AC3 两臂读数 + AC5 事件 timestamp。下一轮无需重新推导。**✅ 见下**

## Resolution

**实现（3 处，全在 kernel 自身安装位置的派生量上；⛔ 不拼 `--root`、⛔ 不碰 Core 的 `plugin-root.ts`）**

1. `driver-runtime.ts` 新增 `kernelSourceScriptsDir()` + `sourceWatch(root,kind)` **三态**（`watched` / `mirror` / `unwatched`）；`sourceFilesMaxMtimeMs` 改走它 ⇒ `mirror` 态比的是**源树**的 mtime，`unwatched` 是**独立取值**（⛔ 不再与「未变更」共用一个恒 0）。源树 = `<mainCheckoutRoot>/<本内核 plugin 树的同名树>/scripts`（取 basename，⛔ 不写死 `"plugin"` 字面量——driver 域的布局锚点被 `kernel-sibling-resolution-check` 的 DRIVER-SCOPE 规则判红）。⛔ **不用 `repoRoot`**：它兜底 `process.cwd()`，会让一个从 quay 检出目录里起来的**装好的**内核把 cwd 误当仓库根。
2. `supervisorStaleness` / `aliveness()` / `driver status --json` 带上 `sourceWatch` + `sourceWatchDir`（JSON 键 `source_watch` / `source_watch_dir`）——`fresh` 在 `unwatched` 下说的是「盘上没有源可推进」，在 `mirror` 下说的是「源码未推进到启动时刻之后」，⛔ 两者不再同形（硬规则 3b）。
3. `preferredAnchorKernel` 的**判定半边**拆成 `preferredAnchorKernelIn(here, mainDir, srcScripts)`（⇒ 可单测）：本内核是**构建产物**时优先**源树里更新的那份 dist bundle**；`runAnchor` 新增 `bundleStale` 支，判据 = 「源树最新 mtime > **本进程加载的那份 kernel 文件的 mtime**」（⛔ 不是 `> hostStartedAt`——那会被重启洗掉），换不动时**如实留痕**并留在原地（⛔ 不重启风暴、⛔ 不假装 fresh）。`runSupervisor` 的 sourceCheck 同口径（只对 `watched` 才重启 child——构建产物下 child 重启加载的是同一个 bundle，换不了版本）。**⛔ 全程保持 dist-kernel 形态**（bundle → bundle），不退回 raw：`gap-driver-runtime-driver-path-anchored-at-project-root-not-dist`（done）的第三方能力不受影响。

**活体读数（⛔ 直接量，取自跑着内核的路径）**

内核：`pid 4014875`，cmdline `/home/yale/work/quay/packages/quay/plugin/scripts/dist/driver-anchor.js __anchor --root /home/yale/work/quay`；它加载的 goal 模块 `/home/yale/work/quay/packages/quay/plugin/scripts/dist/goal-driver.js`（mtime `2026-09-15T07:35:49.685Z`；`grep -c 'recheckFrozenFailing'` = **0**，`grep -c 'No other mechanism re-runs it'` = **1**）。

按该内核的 `resolveKernelScriptsDir()` 基准跑本修复：

| kind | 旧读法 | `sourceWatch` | `dir` | mtime | vs 启动 02:15:14.983Z |
|---|---|---|---|---|---|
| goal | 0（恒 0） | `mirror` | `/home/yale/work/quay/plugin/scripts` | 2026-09-15T14:45:40.177Z | **stale** |
| promotion | 0（恒 0） | `mirror` | 同上 | 2026-09-15T12:28:38.947Z | **stale** |

⇒ 陈旧检测器从「对一个陈旧 2h41m 的内核报 `fresh`」变成 **`stale` + `sourceWatch=mirror`**。

**AC3 两臂 / AC4 突变实测**：见对应 AC 勾选处的落地与读数。

**⛔ AC1/AC2 的引导缺口与激活配方（需 manager/operator 权限；driver 生命周期是 manager 的常设权限）**

引导缺口：修复的自刷新（`preferredAnchorKernel` ③ + `bundleStale`）只在**跑着的内核已含本修复**时才生效；而 `quay driver start` 经 Core 的 `resolvePluginRoot()` 解析到的仍是**同一个暂存 dist**（`packages/quay/plugin`）⇒ 单靠重启不换版本。⇒ 需要一次**外部激活**：

```bash
# ① dev 产物（源树那份，<repo>/plugin/scripts/dist）重建到最新
node /home/yale/work/quay/packages/quay/scripts/build-plugin-dist.mjs /home/yale/work/quay/plugin
# ② 同步进运行内核所在的暂存树（只覆盖 scripts/dist；⛔ 不动暂存树的其它文件）
rsync -a /home/yale/work/quay/plugin/scripts/dist/ /home/yale/work/quay/packages/quay/plugin/scripts/dist/
# ③ 重启 anchor（stop 不杀 worker 在飞子进程，SPEC §6.9 不变式 3）；随后负控制：ps aux | grep driver-anchor
node /home/yale/work/quay/packages/quay/bin/quay.js driver restart --kind promotion   # 六个 kind 逐个
# ④ 复核 AC1：ps -o cmd= -p $(cat .quay/anchor.pid) → 同口径解析 goal 模块 → 两个 grep
```

激活后 AC1/AC2 在本修复的基线上自动成立（内核换到 `<repo>/plugin/scripts/dist/`，其 goal 模块为 12:39 版：`recheckFrozenFailing` = 3、旧句 = 0），**无需再改代码**；且此后源树产物一旦更新，内核会经 `bundleStale` 自行换过去（不再需要人工）。

**AC5 状态**：与本修复无关（Finding ③ 的竞态靠轮转重取收敛）。实测 18:2xZ：轮转在推进（18:20 那轮 AC-201/205/207/232/234/238），AC-259 未取到 ⇒ `failing: ["AC-259"]`、`frozenScope: 86`。事件 timestamp 待轮转写下（判据条件见 AC5 负控制）。

## Touches

- plugin/scripts/driver-runtime.ts
- plugin/scripts/driver-anchor.ts
- plugin/test/driver-anchor.test.mjs
- plugin/test/kernel-sibling-resolution-check.test.mjs
- tasks/gap-ac259-frozen-reading-stale-staging-kernel.md
