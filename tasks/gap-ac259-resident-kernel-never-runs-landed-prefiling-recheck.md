---
id: gap-ac259-resident-kernel-never-runs-landed-prefiling-recheck
title: AC-259 台账读数仍为假且每轮被重复立案的真因：常驻 anchor 从未加载 10:17
  落地的「立案前直接量复核」（recheckFrozenFailing）——它跑的是 packages/quay/plugin/scripts/dist/
  这棵 07:35 的 gitignored 暂存树
status: todo
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

- [ ] AC1 读数是**直接量**，且指向**跑着**的那份代码：`ps -o cmd= -p $(cat .quay/anchor.pid)` 取出内核路径 → 按 `resolveKernelSibling` 同一口径解析该内核会加载的 goal 模块 → 对该**文件**求值 `grep -c 'recheckFrozenFailing'` ≥ 1 **且** `grep -c 'No other mechanism re-runs it'` = 0。**现状：0 / 1**。⛔ 对 `plugin/scripts/goal-driver.ts`（源侧）求值不算——源侧本来就过，是空转形。
- [ ] AC2 **活的内核**上复核真的跑了：激活后经一轮真实 goal 环，`.quay/goal-round.jsonl` 该轮 fact 的 `frozenRecheck.ran` = `true`；若该轮 `failing` 命中 AC-259，其 entry 的 `outcome` = `cleared` / `cause` = `now-true`。**负控制**：激活前最后一轮该字段必须取 `false` 或缺失，二者可区分。⛔ 只断言「函数存在」不算。
- [ ] AC3 AC-259 的 `--stale-pass` 读数转 `verifiedFresh`：`quay goal check --stale-pass --root /home/yale/work/quay` → **exit 0** 且 `failing` 不含 `AC-259`。**负控制（区分「轮转真的重取过」与「等它自己掉出去」）**：`.quay/gate-events.jsonl` 里存在满足 `pipeline_id="AC-259" ∧ gate="goal" ∧ actor ∈ {goal-sweep, goal-amend} ∧ verdict="pass" ∧ timestamp > 2026-09-15T17:35:05.096Z ∧ payload.criterionHash == "8ccfd00300ded08f"` 的事件。⛔ 后写的 `goal-cli` pass 判定面**不读**，不算。（老化不产生新事件，故这条能取假。）若轮转尚未取到 AC-259，可调用同一条有界轮转的动作面 `quay goal check --stale-pass --sweep [--budget N] [--min-age-ms N] [--wall-ms N]` 让它真跑一次——⛔ 不得改写/删除台账事件来伪造 pass。
- [ ] AC4 陈旧内核这一形态在**生产载体**上可见（`sourceWatch` 修复的落地验证；硬规则 4 推论三要求 AC 至少有一条读生产载体）：`quay driver status --json`（或 `aliveness()` 同一口径）在**活着的** anchor 上给出 `source_watch` 与 `source_watch_dir`，且 `source_watch ∈ {watched, mirror, unwatched}` 是**独立取值**（⛔ 不与「新鲜」同形）。**两臂对照**：激活后 `source_watch_dir` 必须指向真实存在且被监视的源（非空、非 `unwatched`），而**激活前**同一读数取不到该键或为 `unwatched`。只给一臂不算过。

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
