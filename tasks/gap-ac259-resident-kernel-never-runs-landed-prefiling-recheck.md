---
id: gap-ac259-resident-kernel-never-runs-landed-prefiling-recheck
title: AC-259 台账读数仍为假且每轮被重复立案的真因：常驻 anchor 从未加载 10:17
  落地的「立案前直接量复核」（recheckFrozenFailing）——它跑的是 packages/quay/plugin/scripts/dist/
  这棵 07:35 的 gitignored 暂存树
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-259
---
## Finding

**① 判据真值 = 真（2026-09-15T18:43:52Z，主检出 `/home/yale/work/quay` 逐字跑）**

```
$ node --experimental-strip-types packages/quay/bin/quay.ts goal gate AC-259 --dry-run --root /home/yale/work/quay
{ "id": "AC-259", "verdict": "pass", "reason": "acceptance passed (exit 0)",
  "timestamp": "2026-09-15T18:43:52.681Z", "dryRun": true }   EXIT=0
```

8 个版本承载文件实测全为 `0.7.0-dev`（`plugin/VERSION` = `0.7.0-dev\n`，od 逐字节核过）；载体 `.quay/productization-verification.jsonl` 两条合格记录俱在：`GOAL-018-AC-258`（host=orangevps, quay_version=0.7.0-dev, task_status=done, ts=2026-09-15T16:27:15Z, build_sha=e37f44f1）、`GOAL-018-AC-257`（host=ad-arm1, 同 quay_version, done, ts=2026-09-15T17:34:56Z / 17:55:43Z）。

**② 读数 = 假**：`quay goal check --stale-pass --root /home/yale/work/quay` → **exit 1**、`failing: ["AC-259"]`、`frozenScope: 86`、`lastSweepAt: 2026-09-15T18:40:34.368Z`。

成因（可核，非推断）：AC-259 最后一条**轮转** verdict = `2026-09-15T17:35:05.096Z` `actor=goal-sweep` `verdict=fail` `criterionHash=8ccfd00300ded08f`（= 现行判据指纹，故不走 `amendedUnverified` 桶），落在 `DEFAULT_STALE_PASS_MAX_AGE_MS`(4h) 内 ⇒ `checkStalePass` 在 `packages/quay/src/goal-store.ts` 取它，**不读**其后 17:39:50 / 17:47:59 / 17:48:27 / 17:49:29 四条 `actor=goal-cli` 的 pass（判定面只认 `goal-sweep`/`goal-amend`）。

**③ 那条 fail 是竞态窗口，不是回归**：判据第二合取项要求存在 `GOAL-018-AC-257` 的 done 记录，而该记录的 `ts` 是**远端整趟运行的开始时刻**（17:34:56Z），落盘却在 ~17:39Z ⇒ 17:35:05Z 那轮轮转**合理地**看不到它。真值当时确实为假，**修复本身没有回退**（同 `gap-ac259-frozen-reading-stale-staging-kernel` Finding ③）。

**④ 本任务要修的缺口：本该阻止这次立案的机制，从来没有在生产上执行过。**

- 防误立案的机制是 `recheckFrozenFailing`（立案前对 `failing` 命中的 AC **真跑一次** criterion，`cleared` 则不立案、⛔ 不再凭台账尾断言），提交 `32d8ddd4d`，落地 **2026-09-15T10:17:10Z**；`git merge-base --is-ancestor 32d8ddd4d develop` = 真。
- 跑着的 goal 内核 = anchor `pid 4014875`（`ps` 实测 `startedAt=2026-09-15T02:15:14.983Z`，cmdline = `/home/yale/.nvm/versions/node/v24.19.0/bin/node /home/yale/work/quay/packages/quay/plugin/scripts/dist/driver-anchor.js __anchor --root /home/yale/work/quay`；`.quay/anchor.json` 记 `kinds:["quality","promotion","worker","outer","goal","meta"]`）。它加载的 goal 模块 = `/home/yale/work/quay/packages/quay/plugin/scripts/dist/goal-driver.js`，**mtime = 2026-09-15T07:35:49Z，早于修复 2h41m**；在该文件上实测 `grep -c 'recheckFrozenFailing'` = **0**、`grep -c 'No other mechanism re-runs it'` = **1**。同一 pid 也是 `.quay/goal-round.jsonl` 每轮 fact 里的 `pid` ⇒ goal 环确实跑在这份 bundle 上。
- **直接量证据，无需推断**：派给本 agent 的 dispatch prompt 逐字含有 `No other mechanism re-runs it, so without a task it stays false forever`——这正是该修复**删掉**的那句，而 `plugin/test/goal-driver.test.mjs:1414-1416` 现在逐字断言该串**不得出现**（`assert.ok(!p.includes('No other mechanism re-runs it'))`）。⇒ 写这条 prompt 的是 10:17 之前的代码，且把一个不存在的缺陷指给了下游。

**⑤ 为什么「重启」也不换版本——这是它不只是「一时陈旧」的原因**

常驻 anchor 加载的是 **`<repo>/packages/quay/plugin/` 这棵 dev-tree 构建暂存树**（`plugin/scripts/driver-runtime.ts:1495` 的注释逐字写着这个形态：`<repo>/packages/quay/plugin/scripts/dist/driver-anchor.js __anchor --root <repo>`）。实测三处对照（2026-09-15T18:5xZ）：

| 路径 | mtime | `recheckFrozenFailing` | `kernelSourceScriptsDir` |
|---|---|---|---|
| `packages/quay/plugin/scripts/dist/goal-driver.js`（**跑着的**） | 2026-09-15 07:35:49 | 0 | 0 |
| `plugin/scripts/dist/goal-driver.js`（源树已构建产物） | 2026-09-15 12:39:48 | 3 | 0 |
| `plugin/scripts/driver-runtime.ts`（源） | 2026-09-15 18:36:39 | — | 有 |

⇒ 源树的构建产物**也**落后于它自己的源（`kernelSourceScriptsDir` 只在 18:36 落地的 `b4157cdab`/`a87688a63` 里，尚未重新构建）。而暂存树 `packages/quay/plugin/` 是**构建暂存、不是装好的产物**：`.gitignore:26` 明确忽略它，`git ls-files packages/quay/plugin` = **0** 条。

**⑥ 引导缺口（本任务的核心，且是新的）**

先例 `gap-ac259-frozen-reading-stale-staging-kernel`（done）落地的自刷新（`sourceWatch` / `kernelSourceScriptsDir` / `bundleStale`）**只在「跑着的内核已含本修复」时才生效**——而跑着的正是那棵 07:35 的暂存树 ⇒ **该修复自己也没跑过**；其 AC1/AC2 至今未勾（标注 `（待外部）`）。本任务是它的**激活半边**：把已写好、已被测试钉住、但从未在生产进程里执行过的复核真正跑起来（同硬规则 4 推论三：只被 fixture 满足的实现，与「没实现」同形）。

<!-- dedup-ref -->
溯源（⛔ 非前置）：`gap-frozen-violated-files-on-stale-verdict`（done）是**立案侧**修复 `recheckFrozenFailing` 的正本，本任务不重复实现它；`gap-ac259-frozen-reading-stale-staging-kernel`（done）是**读数侧**的正本（内核陈旧可见性 + 自刷新代码），本任务只做它的**激活与生产载体验证**。两者均已落地，本任务不依赖它们再次落地。

**⑦ 代价**：每一轮 goal 环，`computeGoalGaps` 都据**陈旧台账读数**立案、且不重跑判据 ⇒ 本任务自身就是该缺口的一个实例。

## Requested action

让**跑着的那份内核**真正加载已落地的修复，并留下可核的激活痕迹。三个动作，缺一不可：

1. **重建源树构建产物**：`node packages/quay/scripts/build-plugin-dist.mjs <repo>/plugin`。判据：`plugin/scripts/dist/{goal-driver,driver-runtime}.js` 均含 `recheckFrozenFailing` **与** `kernelSourceScriptsDir`。
2. **同步进常驻内核实际加载的那棵树**：`rsync -a <repo>/plugin/scripts/dist/ <repo>/packages/quay/plugin/scripts/dist/`（⛔ 只覆盖 `scripts/dist`，不动暂存树的其它文件）。
3. **让常驻进程重新加载**：用户面是 `quay driver start|stop --kind X`（经 `driver-runtime` 调 `__anchor`），而它解析到的仍是**同一个暂存 dist 目录** ⇒ ⛔ 只重启不换版本，必须**先做 1、2**。⚠️ `plugin/scripts/server-restart-inflight-verify.ts` 的目录条目所记：阶段 C（anchor 承载）下按 kind 的 restart 是**事件循环层 respawn**（`driver-anchor.ts:88` 的 `await import(pathToFileURL(sibling.path).href)` 对同一 URL 命中 ESM 模块缓存）——实现者须**实测**「重启后 `ps -o cmd= -p $(cat .quay/anchor.pid)` 指向的那份 goal 模块真的换了」，⛔ 不要假定它换了。若实测证明进程内 respawn 换不了模块，就把「自宿主 anchor 从 gitignored 暂存树加载陈旧 bundle」这一形态在**启动时**修掉（或拒绝启动），并在 `## Resolution` 说明选择。

⛔ 只改注释、只重启、或只对**源树**文件求值，都不算完成。

## AC

- [x] AC1 读数是**直接量**，且指向**跑着**的那份代码：`ps -o cmd= -p $(cat .quay/anchor.pid)` 取出内核路径 → 按 `resolveKernelSibling` 同一口径解析该内核会加载的 goal 模块 → 对该**文件**求值 `grep -c 'recheckFrozenFailing'` ≥ 1 **且** `grep -c 'No other mechanism re-runs it'` = 0。**现状：0 / 1**。⛔ 对 `plugin/scripts/goal-driver.ts`（源侧）求值不算——源侧本来就过，是空转形。 **【已满足：3 / 0，见 `## Resolution` §AC1】**
- [ ] AC2 **活的内核**上复核真的跑了：激活后经一轮真实 goal 环，`.quay/goal-round.jsonl` 该轮 fact 的 `frozenRecheck.ran` = `true`；若该轮 `failing` 命中 AC-259，其 entry 的 `outcome` = `cleared` / `cause` = `now-true`。**负控制**：激活前最后一轮该字段必须取 `false` 或缺失，二者可区分。⛔ 只断言「函数存在」不算。 **【未满足，且在本状态不可达：激活后 7 轮全为 `failing=[]` ⇒ `ran=false`。见 `## Resolution` §AC2 —— 这是 AC 集的次序缺陷（AC3 的动作消灭了 AC2 的前置），非实现缺失。⛔ 不做假勾。】**
- [x] AC3 AC-259 的 `--stale-pass` 读数转 `verifiedFresh`：`quay goal check --stale-pass --root /home/yale/work/quay` → **exit 0** 且 `failing` 不含 `AC-259`。**负控制（区分「轮转真的重取过」与「等它自己掉出去」）**：`.quay/gate-events.jsonl` 里存在满足 `pipeline_id="AC-259" ∧ gate="goal" ∧ actor ∈ {goal-sweep, goal-amend} ∧ verdict="pass" ∧ timestamp > 2026-09-15T17:35:05.096Z ∧ payload.criterionHash == "8ccfd00300ded08f"` 的事件。⛔ 后写的 `goal-cli` pass 判定面**不读**，不算。（老化不产生新事件，故这条能取假。）若轮转尚未取到 AC-259，可调用同一条有界轮转的动作面 `quay goal check --stale-pass --sweep [--budget N] [--min-age-ms N] [--wall-ms N]` 让它真跑一次——⛔ 不得改写/删除台账事件来伪造 pass。 **【已满足：exit 0；负控事件 `2026-09-15T19:09:27.729Z goal-sweep pass hash=8ccfd00300ded08f`。见 `## Resolution` §AC3】**
- [x] AC4 陈旧内核这一形态在**生产载体**上可见（`sourceWatch` 修复的落地验证；硬规则 4 推论三要求 AC 至少有一条读生产载体）：`quay driver status --json`（或 `aliveness()` 同一口径）在**活着的** anchor 上给出 `source_watch` 与 `source_watch_dir`，且 `source_watch ∈ {watched, mirror, unwatched}` 是**独立取值**（⛔ 不与「新鲜」同形）。**两臂对照**：激活后 `source_watch_dir` 必须指向真实存在且被监视的源（非空、非 `unwatched`），而**激活前**同一读数取不到该键或为 `unwatched`。只给一臂不算过。 **【已满足（两臂）：激活前**无该键**；激活后六 kind 全为 `mirror` + `/home/yale/work/quay/plugin/scripts`。见 `## Resolution` §AC4】**

## DoD

- 跑着的 self-host 内核加载的 goal 模块**含** `recheckFrozenFailing`，且不再逐字携带 `No other mechanism re-runs it…`——证据取自**跑着内核的路径**（AC1 口径），不是源文件。
- 通过 `quay driver start|stop` 用户面完成重启，且**重启后仍是 anchor 承载形态**（`ps` 有 anchor 进程、六 kind 仍在其内、`.quay/anchor.json` 的 `kinds` 未缩），⛔ 不为换版本而退回逐 kind supervisor 形态。
- AC-259 的判据仍为真（`quay goal gate AC-259` → exit 0）**且**读数 exit 0（AC3 负控事件真实存在）。
- 落地后不再出现「据陈旧台账读数、不重跑判据就为 AC-259 立案」的轮次——`## Resolution` 里贴出激活后的那轮 `frozenRecheck` 读数。
- `## Resolution` 留有可复核的：内核 pid + cmdline + 其加载模块的**绝对路径** + 该路径上的两个 grep 读数 + AC2/AC3/AC4 的读数与负控。下一轮无需重新推导。

## Touches

- plugin/scripts/driver-anchor.ts
- plugin/scripts/driver-runtime.ts
- plugin/test/driver-anchor.test.mjs
- tasks/gap-ac259-resident-kernel-never-runs-landed-prefiling-recheck.md

注：前置**已落地，勿重复实现**——`b4157cdab` / `a87688a63`（`sourceWatch` / `kernelSourceScriptsDir`）已在源树，`32d8ddd4d`（`recheckFrozenFailing`）在 develop。本任务是**激活 + 生产载体验证**；若实测发现必须改代码（例如进程内 respawn 换不了模块），才改上面三个文件。

## Resolution

激活已完成并逐条留痕（2026-09-15T19:0x–20:0xZ，主检出 `/home/yale/work/quay`）。**未改任何代码**（理由见 §为何不改代码）。

### 跑着的内核（激活后，AC1 口径）

```
$ cat .quay/anchor.pid            # 1713778
$ ps -o cmd= -p 1713778
/home/yale/.nvm/versions/node/v24.19.0/bin/node /home/yale/work/quay/plugin/scripts/dist/driver-anchor.js __anchor --root /home/yale/work/quay
```

该内核按 `resolveKernelSibling` 口径加载的 goal 模块 = `/home/yale/work/quay/plugin/scripts/dist/goal-driver.js`（内核目录里没有 raw `goal-driver.ts` ⇒ 取同目录 bundle；mtime `2026-09-15 19:05:18`）：

- `grep -c 'recheckFrozenFailing'` = **3**（≥1 ✓）
- `grep -c 'No other mechanism re-runs it'` = **0** ✓

**与 Finding ④ 的同一个量对照**：激活前 = `packages/quay/plugin/scripts/dist/goal-driver.js`（mtime 07:35:49）**0 / 1**；激活后 = `plugin/scripts/dist/goal-driver.js`（mtime 19:05:18）**3 / 0**。**跑着的内核路径已不在 gitignored 暂存树上。**

### 三个动作与实测结果

1. `node packages/quay/scripts/build-plugin-dist.mjs /home/yale/work/quay/plugin` → `103 bundled entrypoints → /home/yale/work/quay/plugin/scripts/dist`；产物 `goal-driver.js` 含 `recheckFrozenFailing`(3)、删句计数 0；`driver-runtime.js` 含 `kernelSourceScriptsDir`(7) / `sourceWatch`(11) / `source_watch`(3)。（12:39 那版只有 `recheck`，无 `kernelSourceScriptsDir` —— 正是 Finding ⑤ 的第三行。）
2. `rsync -a plugin/scripts/dist/ packages/quay/plugin/scripts/dist/` → `diff -r` 为空（两树逐字节相同，各 101 个条目）。⛔ 只覆盖 `scripts/dist`。
3. **重启**：实测确认了任务预期的那条——
   - **按 kind 的 `stop`/`start` 换不了模块**：anchor 承载下 `stop --kind X` 只摘该 kind 的循环（`driver-runtime.ts:2639-2642` → `stopKindViaAnchor`，⛔ 不杀 anchor），`start --kind X` 经 `driver-anchor.ts:88` 的 `import(pathToFileURL(sibling.path).href)` 对**同一 URL** 命中 ESM 模块缓存 ⇒ 同进程内模块不换。
   - **只有整进程替换才换**：先 `quay driver stop --kind {promotion,outer,quality,meta,goal}`（五个循环在 60s 停超时点同时退出，锚日志 19:04:34 五行 `loop stopped`），再 `stop --kind worker`（`remaining=[]` ⇒ 对旧 anchor 发 SIGTERM/SIGKILL；该次 stop 返回 **1** 是**预期**的 still-running —— 本 worker 自身在飞，循环不肯 break），最后 `quay driver start --kind {goal,promotion,worker,outer,quality,meta}`。
   - **对照（直接量）**：内核由 `packages/quay/plugin/…/driver-anchor.js`（pid **4014875**，02:15 起）换成 `plugin/scripts/dist/driver-anchor.js`（pid **1713778**，19:05:22 起）。
   - **anchor 形态未缩**：`.quay/anchor.json` = `{"pid":1713778,"startedAt":"2026-09-15T19:05:22.727Z","kinds":["goal","promotion","worker","outer","quality","meta"],"host":"anchor"}`；六个 `*-driver.pid` 全为 `1713778`，distinct live pid = **1**。⛔ 未退回逐 kind supervisor 形态。

### AC 逐条读数

**AC1 ✓** —— 见上（3 / 0，取自跑着内核的路径）。⛔ 未对 `plugin/scripts/goal-driver.ts` 求值（源侧永远过，是空转形）。

**AC2 ✗（不可达）** —— 激活后 goal 环已跑 **7 轮**（round 1…7，`pid=1713778`，ts `19:13:51.904Z` … `20:0xZ`）。每轮 fact：

```
frozenFailing = {"failing":[],"judgment":"clean","cause":null,"frozenScope":86}
frozenRecheck = {"ran":false,"attempted":0,"entries":[],"guardRefused":false}
```

**负控成立**：激活前最后一轮（round 114，`pid=4014875`，`18:57:13.313Z`）**没有** `frozenRecheck` 键（absent），且 `frozenFailing.failing=["AC-259"]`、`judgment="violated"`。⇒ 两臂可区分（**缺失** vs `ran:false`）。

但 AC2 要求的那一臂（`ran=true`）**没有发生**，成因是机械的、可核的：

- `recheckFrozenFailing`（`plugin/scripts/goal-driver.ts:519-527`）**仅在** `reading.judgment === "violated"` 时才跑；而 `judgment === "violated"` ⇔ `check --stale-pass` **exit 1** ⇔ `failing.length > 0`（`packages/quay/src/goal-store.ts:3029-3034`，读代码核实）。
- AC3 要求的轮转落定后 `failing` 已空（86/86 `verifiedFresh`），故 `ran=false` 是**正确**行为。

**⇒ AC2 与 AC3 有次序依赖，且任务文本未写明**：`.quay/goal-round.jsonl` 全历史 6570 轮里 `judgment=violated` 的 111 轮，**最后 12 轮 `failing` 恒为 `["AC-259"]`**——AC-259 是唯一一条 frozen-failing。AC3 的动作（把 AC-259 复验为 pass）恰好**消灭**了 AC2 唯一的前置。正确次序是**先等一轮 goal 环**（AC2：`ran=true` + `AC-259 → cleared/now-true`），**再**做轮转（AC3）。本任务在 **19:09:27** 先做了轮转，而新内核第一轮落在 **19:13:51** —— 差 **4 分钟**。⛔ 未做假勾：AC2 的字面谓词为假，且在冻结 population 全绿期间不可达（穷举轮转 86 条：85 pass + 1 次暂态 not-evaluated，**无一条 fail**；六 kind 心跳全 <7min ⇒ AC-255 两条失败路径都不可达）。**这是本任务 AC 集的缺陷，不是实现缺失**——建议人改 AC2 的措辞（接受 `ran=false ∧ failing=[]` 作「此刻无可复核」这一独立取值，与「没跑」不同形），或把它显式排在 AC3 之前。

**AC3 ✓** —— `node --experimental-strip-types packages/quay/bin/quay.ts goal check --stale-pass --root /home/yale/work/quay` → **EXIT=0**，`failing=[]`（不含 AC-259）、`notEvaluated=[]`、`staleUnverified=[]`、`verifiedFresh=86`、`rotation={"sweptEver":86,"lastSweepAt":"2026-09-15T19:09:29.099Z","minAgeMs":3600000,"maxAgeMs":14400000}`。

负控（判定面**真读**的那条事件，⛔ 非 `goal-cli`）：

```json
{"pipeline_id":"AC-259","gate":"goal","actor":"goal-sweep","verdict":"pass",
 "timestamp":"2026-09-15T19:09:27.729Z","payload":{"criterionHash":"8ccfd00300ded08f"}}
```

满足全部四项：`> 2026-09-15T17:35:05.096Z` ✓、`actor=goal-sweep` ✓、`verdict=pass` ✓、`payload.criterionHash` = 现行指纹 ✓（⇒ 不是「老化掉出去」）。驱动它的动作是任务授权的那条有界轮转：`quay goal check --stale-pass --sweep --budget 40 --min-age-ms 5400000 --wall-ms 780000`（AC-259 rank 31/94，oldest-first）。⛔ 未改写/删除任何台账事件。

真值仍为真：`quay goal gate AC-259 --dry-run` → **EXIT=0**（`AC-259: acceptance passed (exit 0)`）。

**AC4 ✓（两臂）**

- **激活前**：`quay driver status --kind goal --json` **无** `source_watch` / `source_watch_dir` 键（07:35 的暂存 bundle 早于 18:17 的 `b4157cdab`）。
- **激活后**：六 kind 全为 `"source_watch":"mirror"`、`"source_watch_dir":"/home/yale/work/quay/plugin/scripts"`、`"host":"anchor"`、`"anchor_pid":1713778`。该目录**真实存在且被监视**（`plugin/scripts/*.ts` 在位）⇒ 非空、非 `unwatched` ✓。三态里取的是 `mirror`（内核是构建产物、源树在）——独立取值，⛔ 不与「新鲜」同形。

### 为何不改代码

任务把改代码设为**条件**（「若实测证明进程内 respawn 换不了模块，才改上面三个文件」）。实测：

- 「按 kind 的 restart 换不了模块」**成立**（ESM 模块缓存，见 §三个动作 第 3 条），但它**没有被需要**——整进程替换换得动，且已实测换成。
- 「自宿主 anchor 从 gitignored 暂存树加载陈旧 bundle」这一**形态**已由数据纠正：`preferredAnchorKernel` 的 ③ 分支（`plugin/scripts/driver-runtime.ts:959-968`，`b4157cdab` 已落地）在「源树 bundle 比本内核新」时优先源树。⚠️ 注意 `rsync -a` **保留 mtime** ⇒ 只 build 一次时两树 mtime 相等，③ 的 `srcMtime > selfMtime` 不成立、anchor 会**又落回暂存树**；所以我**多跑了一次 build**（19:05:17），让源树 bundle **严格**新于暂存树。跑着的 anchor 因此落在 `<repo>/plugin/scripts/dist/`。

⛔ 未改 `plugin/scripts/driver-anchor.ts` / `driver-runtime.ts` / `plugin/test/driver-anchor.test.mjs`：没有任何 AC 要求，且对一个「保住六个 driver 命」的机制做**未被任何判据测过**的行为改动，风险大于收益（同硬规则 12：给不出发生率的前置/改动不得阻塞）。

### 残留（下一轮无需重新推导）

1. **同一路径原地重建不自刷新**：anchor 跑在 `<repo>/plugin/scripts/dist/driver-anchor.js` 时，重建后 `preferredAnchorKernel()` 的候选**就是它自己**，而 `driver-anchor.ts` 的 `canRefresh` 含 `cand.path !== me` ⇒ 只打 `STALE BUNDLE … rebuild the bundle to clear this`（该行在「已重建、只差重启」时是**误导**的）。⇒ 下一次运行期修复落地后仍需「重建 + 整进程重启」。
2. **暂存树会被重新 staging**：`packages/quay/scripts/package.sh:93-95` 每次 `npm pack` 前 `rm -rf` 再 `cp -R plugin/. packages/quay/plugin/`，副本 mtime = 当时 ⇒ 暂存树再次新于源树，重启后 anchor 会**再次**落回暂存树。根治点在 Core 的 `resolvePluginRoot()` 走查（`packages/quay/src/plugin-root.ts:136` `resolvePluginRootFrom`）：它从 `packages/quay/src` 起走查，**先**命中 `packages/quay/plugin/`（pack-time 暂存），**后**才是仓库根的 `plugin/`。⛔ 该文件不在本任务 Touches 内，未改。
3. **AC-255 判据的载体尾脆弱**（实测到的一次暂态，非本任务引入）：`.quay/quality-round.jsonl` 的**最后一行**若是 judge 记录（有 `judgedAt`、**无 `ts`**），AC-255 即 `exit 3`，进而使 `--stale-pass` 整体 exit 3。19:16:25 实测触发；19:21:16 在 quality 环写出带 `ts` 的轮次记录后复验为 pass（该次 not-evaluated 已由轮转覆盖，⛔ 未删改事件）。
