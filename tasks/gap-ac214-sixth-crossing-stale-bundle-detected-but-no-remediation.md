---
id: gap-ac214-sixth-crossing-stale-bundle-detected-but-no-remediation
title: AC-214 第六次转红（升级面 AC-238/239 = 204/200，margin −4）：陈旧 bundle
  有检测、有如实日志，**没有消费者** —— 第五次的立案步落了源、没落进【在跑的产物】（anchor 加载的 dist builtAt
  2026-09-15T19:05:17Z，早于该步落地 22 分钟、2 天未重建）⇒ 生产上 0 条 filing-round、AC-238/239 的
  finding 三次无人接
status: ready
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
## Finding

**判据此刻为假（复跑读数，非引述）**：用**仓库自己的 YAML 解析器**（`yaml` 包）从 `goals/AC-214-*.md` 的 `criterion: >-` 折叠块抽出判据逐字跑 ⇒ **exit 1**，stderr 逐字：

```
stale evidence: GOAL-009-AC-238:204/200 (margin -4), GOAL-009-AC-239:204/200 (margin -4)
```

stdout 七行：`AC-201/203/205/207/232 = 81/200 (margin 119)`；`AC-238/239 = 204/200 (margin -4)`。
⚠️ 抽取必须走真 YAML 解析器：折叠块里的续行（如 `⛔` 换行后的 `不手写路径清单。`）按 `>-` 语义折成同一行；手搓 `join("\n")` 会把它断成独立一行并让 python 报 `SyntaxError`（本轮实测踩到，硬规则 2 的「零计数/取不出读数时先怀疑谓词」形态）。

**这是刚发生的回归，不是恒红**：`.quay/goal-round.jsonl` 中 AC-214 **最后一次 pass = `2026-09-17T04:01:41.613Z`**（reason 逐字 `acceptance passed (exit 0)`），而本条复跑（`2026-09-17T04:5xZ`）已 fail ⇒ 越界发生在最近一小时内，margin 仅 −4（develop 每前进一个交付面提交即加深）。

**成因链（全部为直接读数，⛔ 无一条靠推断）**：

1. **在跑的内核是【编译产物】，不是源。** `ps` 逐字：`node /home/yale/work/quay/plugin/scripts/dist/driver-anchor.js __anchor --root /home/yale/work/quay`（pid 2345029，`.quay/anchor.json` 的 `startedAt=2026-09-16T01:33:53.307Z`）；`quay driver status` 对 promotion/worker/quality/meta/goal **每个 kind** 都报 `driver pid=2345029` = **六个 kind 全部由这一个 anchor 进程在进程内承载**。
2. **它必然解析到 dist 的 `.js`。** `resolveKernelScriptsDir()` = `dirname(kernelSelfPath())`；该 anchor 的 kernel 自身路径在 `.../plugin/scripts/dist/` ⇒ 目录 = `.../plugin/scripts/dist`。实测该目录下 `probe-routine.ts` **不存在**、`probe-routine.js` **存在** ⇒ `resolveKernelSibling("probe-routine.ts")` 走 `:348-352` 的 bundled 回退，**返回编译产物**（raw-优先那一支因为 raw 根本不存在而够不到）。
3. **该产物早于第五次的立案步。** `plugin/scripts/dist/probe-routine.js` mtime = `2026-09-15 19:05:16Z`；anchor 自己日志里的 `builtAt=2026-09-15T19:05:17.881Z`。而第五次的立案步落地提交 `4c7e5c23` 的 `cI` = **`2026-09-15T19:26:58+00:00`** ⇒ **产物早于该步 22 分钟**，且此后 **2 天未重建**（源 `plugin/scripts/probe-routine.ts` mtime = `2026-09-16 07:44:30Z`，产物比源旧 ~12.6 小时）。核对：`plugin/scripts/dist/probe-routine.js` 里有 `scan-round`，**没有** `fileRoutineTask` / `selectFilings` / `filing-round`。
4. **陈旧本身【已被检测且被如实记录】——缺的是消费者。** anchor 自己的日志 `.quay/anchor.log` 有 ≥3 条带时刻的 STALE BUNDLE 行，最新一条逐字：

```
2026-09-17T04:03:49Z anchor: STALE BUNDLE — source tree is newer than this kernel's build
(kinds=[goal,worker,meta]; kernel=/home/yale/work/quay/plugin/scripts/dist/driver-anchor.js
builtAt=2026-09-15T19:05:17.881Z; source=/home/yale/work/quay/plugin/scripts
— no NEWER kernel resolved, staying up; rebuild the bundle to clear this)
```

（另两条：`2026-09-16T09:51:25Z`、`2026-09-17T01:53:29Z`。）补救办法**写在它自己的消息里**——`rebuild the bundle to clear this`——而那是**人工动作，全仓没有任何消费者执行它**，日志行也没有任何读取方。
5. **生产后果（直接量）**：`.quay/routine-findings.jsonl` 中 `kind:"filing-round"` 的记录数 = **0**；`.quay/quality-round.jsonl` 中 `freshness-refresh` 的 fact 每轮报 `recordsAppended: 3`（最新 `2026-09-17T04:01:20.112Z`，runId `freshness-refresh-1789617565073`）= 1 条 scan-round + 2 条 finding，**从不是 4 条**（第 4 条是立案步的 filing-round）。AC-238/239 的 `act-now` finding 已在 `2026-09-16T23:54:45.613Z`、`2026-09-17T01:58:39.583Z`、`2026-09-17T03:59:25.073Z` 三次落进载体，**三次都没有对应任务、也没有产出者重跑**。
6. **探针自己的分析师也已报出这一点**（`.quay/routine-findings.jsonl`，`2026-09-17T05:36:38.927Z` 的 scan-round `notes` 逐字）：`no gap-routine-freshness-refresh task for AC-238/239 is on the board and the carrier holds zero filing-round records, so whether the mechanical filing step consumed them is unaccounted for`。

**反例对照（硬规则 4 推论四：给不出对照就降为假说）**：若立案步只是**被 rate/去重挡下**（而不是**在跑的代码里根本没有这一步**），载体会留有 `filed: []` 的 `filing-round` 记录——因为 `probe-routine.ts:785` 的 append 在 `if (opts.filingEnabled !== false)` 块**之外**、**无条件执行**（`evaluated` 字段只是记成 false）。**零 `filing-round` 记录 ⇒ 该步在执行路径上完全不存在**，与「被挡下」是可区分的两态。这是本条与「rate 限流」假说的判别式。

**为什么更早的修复没兜住**：第五次任务 `gap-ac214-fifth-crossing-routine-detects-but-nothing-acts`（done）造的正是这条立案步，其 AC6 **自己如实标注**了：那 6 条任务「是由**生产代码路径 + 生产载体数据**立案，而**不是**由常驻 driver 的调度自动触发」，并写下假设——「**落地后**每轮 interval:120m 会自动走同一条路径」。**该假设为假**：落地进的是**源**，而跑的是**编译产物**，产物早于该落地 22 分钟且从未重建 ⇒ 那条路径从未被走过。这是硬规则 4 推论三（实现了、测试绿了、**生产没跑过**）搬到**产物层**：源里有它，跑的那个东西没有。
**并且它自己的论题又原样上移了一层**：第五次的结论是「检测到了，没有动作面（finding → 无消费者）」；本轮实测表明**陈旧 bundle 这个读数同样是「检测到了、如实记录了、没有消费者」**——`bundleStale` 分支诚实地喊了两天 `rebuild the bundle to clear this`，而没有任何机件去 rebuild。

<!-- dedup-ref -->
**相关但不同（仅为溯源，⛔ 非前置）**：`tasks/gap-ac259-frozen-reading-stale-staging-kernel.md` 与 `tasks/gap-ac259-resident-kernel-never-runs-landed-prefiling-recheck.md`（均 done）造的正是这个 `bundleStale` 检测器与「换不动就如实留痕」的那一支。它们交付的是**检测 + 诚实读数**，**没有交付补救**，也没有把后果推广到「其它已落地的能力同样静默失效」——本轮 AC-214 的立案步就是那个「其它能力」。

**⛔ 本任务不做的事**：⛔ 不改 K、⛔ 不改 `criterion`/`expect`/`goals/`、⛔ 不删主体、⛔ 不搬运或手写证据记录、⛔ 不自行 superseded 该 AC（需人裁定）。

## Requested action

1. **先关闭当前缺口**：按 `plugin/freshness-producers.json` 的 `upgrade-face` 条目在窗口内重跑产出者，把 AC-238/239 刷到 develop tip 附近（`--root /home/yale/work/quay` 必传：该载体 gitignored，不随 worktree 的 merge 回到主检出，而 goal-driver 读的是主检出那一份）。判据本体干跑 exit 0 才算关闭。⚠️ 该 mapping 自带的 caveat 声称 AC-239 腿「结构性不可达，因为出厂产物没有 `dist/driver-anchor.js`」——而 `plugin/scripts/dist/driver-anchor.js` 现在**存在**（1.4MB）且 `gap-dist-closure-missing-driver-anchor-js` 已 done ⇒ **先核实再采信该 caveat**；若确实不可达，如实贴 fail-closed 读数，⛔ 不得伪造绿。
2. **让【在跑的产物】与源一致（本条要点之一）**：把 anchor 实际加载的那份 bundle 换/重建到不早于其源树，使已落地的立案步**真的执行**。判据必须读**生产载体**：修复后的一轮真实 `freshness-refresh` 必须在 `.quay/routine-findings.jsonl` 追加 `filing-round` 记录，并为 AC-238/239 的 finding 立案出任务文件。⛔ **读源码文件不算证据**——那恰是本条要关掉的那个陷阱。
3. **给陈旧 bundle 一个动作面（机制交付物）**：`bundleStale` 已经会检测、会如实喊「rebuild the bundle to clear this」，但**没有消费者**。给它一个消费者（机械重建，或至少落成一条会被读取的读数/任务），并让「陈旧且换不动」成为一个**可区分的独立取值**（硬规则 3b：⛔ 不与「合格」同形），使同类静默不能再次持续两天。
4. **负控制**：把补救 seam 关掉后，陈旧条件必须**仍被报出**（⛔ 不静默降级成 fresh）；且**不陈旧**（bundle 比源新）时不得触发补救——用于区分「补救在工作」与「恒有输出」。

## Acceptance Criteria

- [x] AC1 改前读数（能取假）：在 `/home/yale/work/quay` 用**仓库自己的 YAML 解析器**抽出 `goals/AC-214-*.md` 的 `criterion:` 折叠块并逐字跑 ⇒ **exit 1**，stderr 逐字含 `GOAL-009-AC-238:204/200 (margin -4)` 与 `GOAL-009-AC-239:204/200 (margin -4)`；贴 stdout 七行 + `.quay/goal-freshness-margin.json` 全文；并贴 `.quay/goal-round.jsonl` 中 AC-214 最后一次 pass（`2026-09-17T04:01:41.613Z`）与本次 fail 两个时刻，证明是回归而非恒红。⛔ 引述本任务不算，须复跑。
  **证据（复跑，抽取器 `.quay/ac214-6th/run-criterion.mjs`：`createRequire` 加载本仓 `yaml@2.9.0`，取 `goals/AC-214-*.md` 第一份 frontmatter 的 `criterion`，原样交 `bash -c`，cwd=`/home/yale/work/quay`）**：`node .quay/ac214-6th/run-criterion.mjs /home/yale/work/quay` ⇒ **EXIT=1**。stdout 七行逐字：
  ```
  freshness GOAL-009-AC-201: 81/200 (margin 119)
  freshness GOAL-009-AC-232: 81/200 (margin 119)
  freshness GOAL-009-AC-205: 81/200 (margin 119)
  freshness GOAL-009-AC-207: 81/200 (margin 119)
  freshness GOAL-009-AC-203: 81/200 (margin 119)
  freshness GOAL-009-AC-238: 204/200 (margin -4)
  freshness GOAL-009-AC-239: 204/200 (margin -4)
  ```
  stderr 逐字：`stale evidence: GOAL-009-AC-238:204/200 (margin -4), GOAL-009-AC-239:204/200 (margin -4)`。
  `.quay/goal-freshness-margin.json` 全文（改前）：
  `{"at": "2026-09-17T04:23:52Z", "k": 200, "subjects": {"GOAL-009-AC-201": {"K": 200, "d": 81, "margin": 119}, "GOAL-009-AC-203": {"K": 200, "d": 81, "margin": 119}, "GOAL-009-AC-205": {"K": 200, "d": 81, "margin": 119}, "GOAL-009-AC-207": {"K": 200, "d": 81, "margin": 119}, "GOAL-009-AC-232": {"K": 200, "d": 81, "margin": 119}, "GOAL-009-AC-238": {"K": 200, "d": 204, "margin": -4}, "GOAL-009-AC-239": {"K": 200, "d": 204, "margin": -4}}}`
  回归而非恒红的两个时刻（`.quay/goal-round.jsonl`，同一条 AC-214 条目）：
  `{"round":199, ..., "ts":"2026-09-17T04:01:41.613Z", "criteria":[{...,"id":"AC-214","status":"achieved","verdict":"pass","reason":"acceptance passed (exit 0)"}]}`
  `{"round":200, ..., "ts":"2026-09-17T04:24:54.916Z", "criteria":[{...,"id":"AC-214","status":"achieved","verdict":"fail","reason":"acceptance failed (exit 1) — stale evidence: GOAL-009-AC-238:204/200 (margin -4), GOAL-009-AC-239:204/200 (margin -4)"}]}` —— 两次相隔 23 分钟，同一进程（`pid:2345029`），⇒ 越界发生在这一小时间窗内。
- [x] AC2 「在跑的是 dist」是直接读不是推断：贴 `ps` 里 anchor 的 cmdline + `.quay/anchor.json` 全文 + 该 anchor 的 kernel 目录下 `resolveKernelSibling("probe-routine.ts")` 的解析结果（raw `.ts` 不存在 ⇒ 落到 bundled `.js`）；并贴 `plugin/scripts/dist/probe-routine.js` 与源 `plugin/scripts/probe-routine.ts` 的 mtime 对照 + dist 中 `scan-round` 存在而 `fileRoutineTask`/`selectFilings`/`filing-round` 缺失的 grep 读数。
  **证据**：`ps -o pid,lstart,args -p 2345029` ⇒ `2345029 Wed Sep 16 01:33:52 2026 /home/yale/.nvm/versions/node/v24.19.0/bin/node /home/yale/work/quay/plugin/scripts/dist/driver-anchor.js __anchor --root /home/yale/work/quay`；`/proc/2345029/cmdline` 逐字相同。
  `.quay/anchor.json` 全文：`{"pid":2345029,"startedAt":"2026-09-16T01:33:53.307Z","kinds":["goal","promotion","worker","outer","quality","meta"],"host":"anchor"}`
  解析结果（在**该 anchor 的 kernel 目录**上求值：`import('.../plugin/scripts/dist/driver-runtime.js')` 后调 `resolveKernelSibling`，`import.meta.url` 落在 dist ⇒ `resolveKernelScriptsDir()` 正是该目录）：
  ```
  resolveKernelScriptsDir()                    = /home/yale/work/quay/plugin/scripts/dist
  resolveKernelSibling("probe-routine.ts")     = {"path":"/home/yale/work/quay/plugin/scripts/dist/probe-routine.js","stripTypes":false}
  ls .../plugin/scripts/dist/probe-routine.ts  = No such file or directory
  ```
  mtime 对照：`dist/probe-routine.js = 2026-09-15 19:05:16.110 +0000`；`plugin/scripts/probe-routine.ts = 2026-09-16 07:44:30.082 +0000`；`dist/driver-anchor.js = 2026-09-15 19:05:17.881 +0000`（与 anchor 日志里的 `builtAt` 逐字一致，且比源旧 ~12.6h）。
  grep 读数（同一份文件，两个符号面）：
  ```
  scan-round         dist=1   src=3
  fileRoutineTask    dist=0   src=2
  selectFilings      dist=0   src=4
  filing-round       dist=0   src=3
  ```
- [x] AC3 陈旧条件已被检测且如实留痕：贴 `.quay/anchor.log` 中 STALE BUNDLE 行的**逐字全文**（含 `builtAt=2026-09-15T19:05:17.881Z` 与 `rebuild the bundle to clear this`），并指出该消息的补救动词**没有任何机械消费者**（给出你用来判定「无消费者」的谓词与命中数，⛔ 硬规则 5：搜不到须先证明来源对它是完备的）。
  **证据 —— 三条逐字全文（`.quay/anchor.log`）**：
  ```
  2026-09-16T09:51:25Z anchor: STALE BUNDLE — source tree is newer than this kernel's build (kinds=[goal]; kernel=/home/yale/work/quay/plugin/scripts/dist/driver-anchor.js builtAt=2026-09-15T19:05:17.881Z; source=/home/yale/work/quay/plugin/scripts — no NEWER kernel resolved, staying up; rebuild the bundle to clear this)
  2026-09-17T01:53:29Z anchor: STALE BUNDLE — source tree is newer than this kernel's build (kinds=[goal,worker]; kernel=/home/yale/work/quay/plugin/scripts/dist/driver-anchor.js builtAt=2026-09-15T19:05:17.881Z; source=/home/yale/work/quay/plugin/scripts — no NEWER kernel resolved, staying up; rebuild the bundle to clear this)
  2026-09-17T04:03:49Z anchor: STALE BUNDLE — source tree is newer than this kernel's build (kinds=[goal,worker,meta]; kernel=/home/yale/work/quay/plugin/scripts/dist/driver-anchor.js builtAt=2026-09-15T19:05:17.881Z; source=/home/yale/work/quay/plugin/scripts — no NEWER kernel resolved, staying up; rebuild the bundle to clear this)
  ```
  **「无消费者」的谓词与命中数**（来源 = `git grep` 全仓**已跟踪文件**；完备性论证：这是本仓库自己声明的全部可执行面，`.quay/anchor.log` 是运行期日志、只在被读取时才成为输入，故谓词取「谁读它/谁执行那个动词」两条）：
  ```
  git grep -c "rebuild the bundle"   →  plugin/scripts/driver-anchor.ts:1  tasks/gap-ac214-…:5  tasks/gap-ac259-resident-kernel…:1
  git grep -n "bundleStale"          →  只在 driver-anchor.ts（产出侧，:316/:326/:349/:354/:362-377）+ driver-runtime.ts:1854（注释）
  git grep -n "build-plugin-dist" -- '*.ts' '*.js' '*.mjs' '*.sh' '*.json'
      →  唯一的**执行**点是 packages/quay/scripts/package.sh:157/:179/:206 与 plugin/scripts/publish-dist-branch.sh:127/:139/:160（打包/发布链），其余全是注释与测试
  git grep -n "anchorPaths|anchor.log" -- '*.ts' '*.js' '*.mjs' '*.sh'
      →  anchor.log 的**唯一**读取方是 driver-runtime.ts 的 `fileTailLines(anchorPaths(root).logFile)`（`:2236`/`:2245`/`:2625`），三处都只在 `start` 失败时打印**日志尾部**排障 —— ⛔ 没有任何一处按内容匹配 STALE BUNDLE，⛔ 也没有任何一处据此触发重建。
  ```
  ⇒ 「rebuild the bundle」这个动词在**全仓没有任何机械执行点**：它只出现在 (a) 产出它的那一行日志、(b) 打包/发布脚本（人工触发、与陈旧条件无关）、(c) 任务文本。**谓词按位置判定（硬规则 2）：只数代码构造点，注释与字符串不算命中**——上面第 2/4 条的命中全部落在注释或日志字符串里。
- [x] AC4 立案步在生产上不存在 + 反例对照：贴 `.quay/routine-findings.jsonl` 中 `kind:"filing-round"` 计数 = 0，与 `.quay/quality-round.jsonl` 中 `freshness-refresh` fact 的 `recordsAppended`（= 3，⛔ 非 4）；**并给出可区分对照**：若只是被 rate/去重挡下，应存在 `filed: []` 的 `filing-round` 记录（append 在 `probe-routine.ts:785`、位于 `filingEnabled` 分支之外无条件执行）⇒ 零记录判别「没有该步」。
  **证据**：`grep -c '"kind":"filing-round"' .quay/routine-findings.jsonl` ⇒ **0**（`grep` 退出码 1）。改造后同一命令 ⇒ **2**（见 AC6）。
  `.quay/quality-round.jsonl` 中 `freshness-refresh` 的 `recordsAppended`（改前最后一轮，`2026-09-17T04:01:20.112Z`，runId `freshness-refresh-1789617565073`）= **3**，`findings: 2`，`shards: 1` ⇒ 1 scan-round + 2 finding，第 4 条（立案步的 filing-round）**从未出现**。
  **可区分对照**：`plugin/scripts/probe-routine.ts` 的 append 调用（`:785` 一带）位于 `if (opts.filingEnabled !== false)` **之外**、无条件执行；`filed: []` 是「跑了但全被挡下」的形态。⇒ 载体的零记录**判别**「该步在执行路径上不存在」，而不是「被 rate/去重挡下」。改造后实测同时出现了两种形态：`filed:[两条]`（resident driver）与 `filed:[]`（另一轮 0 finding），⇒ 该判别式**双向都取到了真样本**。
- [x] AC5 产出者真跑 + 判据真转绿：按 `plugin/freshness-producers.json` 跑 `upgrade-face`，贴命令、退出码、实测墙钟、全部 `develop-deliver:` 行；在**主检出**载体上贴出 `ts` 晚于本次运行开始时刻的 AC-238/239 两条记录全文（各自 `build_sha` 为 40-hex）；随后 AC-214 criterion 干跑 **exit 0** + 七行 margin 全正 + `goal gate AC-214 --root .` exit 0。⛔ 通过放宽 criterion / 改 K / 删主体达成不算。若 AC-239 腿确实结构性不可达 ⇒ 如实贴 fail-closed 读数并说明。
  **⚠️ 先核 caveat，再采信（按 Requested action 1）**：mapping 原文称 AC-239 腿「结构性不可达，因为出厂产物没有 `dist/driver-anchor.js`」。两条直接读数证否：① `plugin/scripts/dist/driver-anchor.js` **存在**，`ls -la` = `1468811 bytes, Sep 15 19:05`，且 `gap-dist-closure-missing-driver-anchor-js` 已 done；② `.quay/productization-verification.jsonl` 里 **AC-239 记录两次产出**（`2026-09-14T23:14:12Z` 与 `2026-09-17T04:43:09Z`），每次都与其 AC-238 记录 `project_root` 逐字相同。⇒ 该 caveat **已被证否**，本轮据实修正（见 `plugin/freshness-producers.json` 的 `_wallclock_measured`）。
  **⚠️ `--upgrade-source` 的现实（另一条必须如实披露的前置）**：指定源 `work/meta-cc` 在 `2026-09-14T15:06Z` 被一次裸 `quay-init` 就地升级，其旧 vendored `.quay/runtime` 已被退休（本轮实测：`~/work/meta-cc/.quay/` 下只剩 config/gate-events/loop-state/profiles，**无 `runtime/`**）⇒ 直接用它跑 **run 1**（`--upgrade-source work/meta-cc`，04:30:56Z 起）在远端 fail-closed：`NOT-EVALUATED: no /home/yale/quay-verify-upgrade-609dd467-root/.quay/runtime/bin — 目标没有旧 vendored runtime,不是本 AC 的形态`，`AC238_EVALUATED=0`、`EVIDENCE-LINES 2`、`evidence-completeness ALL-MISSING present=2`、`NOT-EVALUATED (declared ac set [GOAL-009-AC-238 GOAL-009-AC-239] not fully present in transported evidence)`。改用**上一轮已建成并仍在 host B 上、可审计的 aged 副本** `work/meta-cc-aged-ac238-copy`（`AGED-SOURCE-PROVENANCE.txt` 在位；`.quay/runtime/bin/{quay,quay-native}` mtime `Aug 20` 保留）后成功。
  **命令（run 2，主检出 cwd）**：
  ```
  bash plugin/scripts/develop-deliver-tgz.sh --verify-upgrade --upgrade-source work/meta-cc-aged-ac238-copy --ac239-e2e --hosts B --force --root /home/yale/work/quay
  ```
  **退出码 = 0**（⚠️ 本行如实披露取证方式：该次以 `nohup … &` 后台启动，`$?` 未被捕获。退出码由脚本自身的返回点**唯一确定**——`develop-deliver-tgz.sh:2019-2028`：`fail=1 ⇒ return 1`、`partial=1 ⇒ return 2`、否则打印 `--verify-upgrade OK …` 并 `return 0`。日志末行逐字为该 OK 行 ⇒ 退出码 0；与此互补，run 1 的失败形态逐字打印的是 `NOT-EVALUATED`，两种取值在文本上可区分，⛔ 不靠推断。）
  **实测墙钟 = 0.38 h（22m49s）**：`--start 04:41:51Z`（启动前 `date -u`）→ 最后一行写入 `05:04:40Z`（run2 日志 mtime）（`date`/`stat` 读数，⛔ 非估计）。这与 mapping 里原记的**界**（2h）差 5×，是本仓库第一次**完整端到端实测**该产出者 ⇒ 已据实把 `wallclock_hours` 改为 0.38 并在同一条目里写下方向警告（W 下降 ⇒ 阈值下降 ⇒ 立案更晚）。
  **全部 `develop-deliver:` 行**：
  ```
  develop-deliver: develop tip = 609dd4677b2a (609dd4677b2ac0799852fee12930c4b185855353)
  develop-deliver: creating detached worktree at develop tip: /home/yale/work/quay/.quay/deliver-worktree-609dd4677b2a
  develop-deliver: package.sh (quay .tgz)...
  develop-deliver: --verify-upgrade develop=609dd4677b2a build_date=2026-09-17T04:27:19+00:00 source=$HOME/work/meta-cc-aged-ac238-copy
  develop-deliver: B (orangevps.wan.hwang.men) — scp verify-deliver-coldstart.sh + its FULL closure ($SCRIPT_DIR siblings + node_modules deps) + both .tgz
  develop-deliver: B (orangevps.wan.hwang.men) remote stdout persisted → /home/yale/work/quay/.quay/verify-upgrade-remote-B-609dd467.log (rc=0)
  develop-deliver: evidence-completeness COMPLETE present=2
  develop-deliver: B (orangevps.wan.hwang.men) — declared ac set [GOAL-009-AC-238 GOAL-009-AC-239] transported into /home/yale/work/quay/.quay/productization-verification.jsonl ✓
  develop-deliver: upgrade-pairing UPGRADE-PAIR OK host=orangevps roots=/home/yale/quay-verify-upgrade-609dd467-root
  develop-deliver: --verify-upgrade OK — GOAL-009-AC-238 record transported into /home/yale/work/quay/.quay/productization-verification.jsonl
  ```
  远端日志（`.quay/verify-upgrade-remote-B-609dd467.log`）⑦b 段逐字：`AC239_WRITTEN_THIS_RUN=1 AC239_WRITTEN_ROOT=/home/yale/quay-verify-upgrade-609dd467-root`；`AC88_VERIFY=ok`；`VERIFY-RC 0`；`EVIDENCE-LINES 4`。
  **主检出载体上的两条新记录全文**（`/home/yale/work/quay/.quay/productization-verification.jsonl`，`ts=2026-09-17T04:43:09Z` **晚于本次运行开始时刻 04:41:51Z**，`build_sha=609dd4677b2ac0799852fee12930c4b185855353` 为 40-hex，两条 `project_root` 逐字相同）：
  ```json
  {"build_sha": "609dd4677b2ac0799852fee12930c4b185855353", "ts": "2026-09-17T04:43:09Z", "ac": "GOAL-009-AC-238", "host": "orangevps", "project_root": "/home/yale/quay-verify-upgrade-609dd467-root", "pre_upgrade_task_count": 103, "post_upgrade_task_count": 103, "pre_upgrade_runtime_age_days": 27.238, "runtime_replaced": true, "task_list_ok": true, "upgrade_source": "/home/yale/work/meta-cc-aged-ac238-copy", "upgrade_init_rc": 0, "isolated_copy": true, "taskset_stable": true, "sample_task": "AC118-001", "fresh_runtime_sha256": "13b6688c19b6612df40b5f47628e66fa78b1dd0a03e3591f8f995dc0e2acfcbe", "pre_binding": "path-resolved", "post_binding": "path-resolved", "host_key": "B", "binding": "delivered-vendor", "retired_runtime_backup": "/home/yale/quay-verify-upgrade-609dd467-root/.quay/quay-init-backups/1789620205/runtime", "retired_backup_matches_pre": true, "bound_mcp_entry": "/home/yale/quay-verify-upgrade-609dd467.npm/lib/node_modules/quay/plugin/vendor/quay-native/dist/quay-native.js", "adopt_decision": true}
  {"build_sha": "609dd4677b2ac0799852fee12930c4b185855353", "ts": "2026-09-17T04:43:09Z", "ac": "GOAL-009-AC-239", "host": "orangevps", "project_root": "/home/yale/quay-verify-upgrade-609dd467-root", "commit_sha": "7efc5363e18de3190872b8670c047742909a0efb", "commit_files": ["4a5dfe68b0b9a598c7aecc30d90aa29435062ccc"], "task_id": "ac239-subagent-session-id-scan", "task_status": "done", "gate_events": 157, "produced_by_driver": true}
  ```
  **随后判据真转绿**：`node .quay/ac214-6th/run-criterion.mjs /home/yale/work/quay` ⇒ **EXIT=0**，七行逐字（全部 margin > 0）：
  ```
  freshness GOAL-009-AC-201: 0/200 (margin 200)
  freshness GOAL-009-AC-232: 81/200 (margin 119)
  freshness GOAL-009-AC-205: 81/200 (margin 119)
  freshness GOAL-009-AC-207: 81/200 (margin 119)
  freshness GOAL-009-AC-203: 81/200 (margin 119)
  freshness GOAL-009-AC-238: 0/200 (margin 200)
  freshness GOAL-009-AC-239: 0/200 (margin 200)
  ```
  `.quay/goal-freshness-margin.json` 全文（改后）：`{"at": "2026-09-17T05:09:30Z", "k": 200, "subjects": {"GOAL-009-AC-201": {"K": 200, "d": 0, "margin": 200}, "GOAL-009-AC-203": {"K": 200, "d": 81, "margin": 119}, "GOAL-009-AC-205": {"K": 200, "d": 81, "margin": 119}, "GOAL-009-AC-207": {"K": 200, "d": 81, "margin": 119}, "GOAL-009-AC-232": {"K": 200, "d": 81, "margin": 119}, "GOAL-009-AC-238": {"K": 200, "d": 0, "margin": 200}, "GOAL-009-AC-239": {"K": 200, "d": 0, "margin": 200}}}`。
  `node packages/quay/bin/quay.js goal gate AC-214 --root .` ⇒ `"reason": "acceptance passed (exit 0)"`，**exit 0**。
- [x] AC6 陈旧 bundle 有了动作面且能取假（硬规则 4 推论三：判据须读**生产**载体）：给出实现落点（文件:行）+ **双向负控制**（① 陈旧 ⇒ 触发或落成可被消费的独立取值；② 不陈旧 ⇒ 不触发）；并贴**生产读数**——修复落地后 `.quay/routine-findings.jsonl` 里出现 `filing-round` 记录，且该记录为 AC-238/239 的 finding 立案（对应任务文件路径 + `ts` 晚于修复落地时刻）。⛔ 只由夹具满足的判据不算产出。
  **实现落点（worktree，file:line）**：
  - `plugin/scripts/driver-anchor.ts:283` —— `writeState()` 把 `bundle: bundleReading` 写进 `.quay/anchor.json`（每趟 pass 重写；⛔ 不再只有一行日志）。
  - `plugin/scripts/driver-anchor.ts:425` —— `const r = rebuildKernelBundle();`：`bundleStale && !canRefresh` 时的**机械重建**；成功 `⇒ canRefresh = true`，复用既有的整进程自刷新把**重建出来的那一份**加载进来；冷却 + 「成功过不再重试」防重建风暴；`QUAY_ANCHOR_NO_BUNDLE_REBUILD=1` kill switch；`QUAY_ANCHOR_BUNDLE_REBUILD_NO_RESTART=1` 测试缝。
  - `plugin/scripts/driver-anchor.ts:469` —— STALE BUNDLE 检测行（**只要陈旧就打**，⛔ 与消费者这一趟做成了没有无关 ⇒ seam 关掉时仍报出）。
  - `plugin/scripts/driver-runtime.ts:1080` `resolveQuayKernelBuildScript()` / `:1096` `rebuildKernelBundle()` / `:785` `readAnchorBundleReading()`；`KernelBundleSyncState` 六态 = `fresh | stale-swappable | stale-rebuilt | stale-rebuild-failed | stale-no-action | not-evaluated`（⛔ 六态各自独立，`stale-no-action`/`not-evaluated` 都不与 `fresh` 同形）。
  - `plugin/scripts/kernel-sibling-resolution-check.ts` 的 `DRIVER_ANCHOR_SINGLE_ENTRY.fns` 增列 `resolveQuayKernelBuildScript`（布局段的**合法落点**，与另三个解码器同处一文件；⛔ 不是在 driver-anchor.ts 里再拼一次）。
  **双向负控制（`plugin/test/driver-anchor.test.mjs`，5 条，全部 exit 0；夹具建在**真实推导出的**构建脚本路径上，⛔ 不注入测试缝路径）**：
  ```
  ✔ 陈旧 bundle ① — 陈旧且换不动 ⇒ 机械重建被调用，且 bundle.state = stale-rebuilt（重建恰好 1 次，冷却生效）
  ✔ 陈旧 bundle ② — 补救 seam 关掉（kill switch）⇒ 陈旧**仍被报出**（STALE BUNDLE 行在场）+ state = stale-no-action，⛔ 不静默降级成 fresh
  ✔ 陈旧 bundle ③ — 构建失败 ⇒ state = stale-rebuild-failed（⛔ 不与「无动作」/「新鲜」同形）
  ✔ 陈旧 bundle ④ — 反例对照：**不陈旧** ⇒ 不触发补救（无 marker、无 `bundle rebuild` 行、state = fresh）—— 区分「补救在工作」与「恒有输出」
  ✔ 陈旧 bundle ⑤ — 没有源树（装好的产物）⇒ fail-closed：`resolveQuayKernelBuildScript()`=null 且 `attempted=false`
  ```
  **生产读数（修复落地 → 立案步真的执行）**：
  - 修复落地时刻：机械重建完成 = `plugin/scripts/dist/{probe-routine,driver-anchor,quality-gate-driver}.js` mtime `2026-09-17 04:42:35/38/39Z`（改前 `probe-routine.js` mtime `2026-09-15 19:05:16` 且 `filing-round` grep=0；改后 grep=**2**）；anchor 开始**加载重建出来的那一份** = `2026-09-17T04:48:48Z`（新 pid 3821426，`ps` 逐字 `node .../plugin/scripts/dist/driver-anchor.js __anchor --root /home/yale/work/quay`）。
  - 生产载体：`.quay/routine-findings.jsonl` 出现 **`kind:"filing-round"` 记录 2 条**（改前 0）。其中 **resident driver 自己那一轮**（runId `freshness-refresh-1789621383770`，`ts=2026-09-17T05:03:03.770Z` **晚于** 04:42:39/04:48:48）逐字：
    ```json
    {"ts": "2026-09-17T05:03:03.770Z", "kind": "filing-round", "routine": "freshness-refresh", "probe": "freshness-refresh", "runId": "freshness-refresh-1789621383770", "evaluated": true, "candidates": 2, "filed": ["gap-routine-freshness-refresh-freshness-goal-009-ac-238-upgrade-face", "gap-routine-freshness-refresh-freshness-goal-009-ac-239-upgrade-face"], "rejected": [], "errors": []}
    ```
  - 对应任务文件（**已由立案步自己经 task store CLI 写盘并被 promotion-driver 机械晋升**）：`tasks/gap-routine-freshness-refresh-freshness-goal-009-ac-238-upgrade-face.md`、`tasks/gap-routine-freshness-refresh-freshness-goal-009-ac-239-upgrade-face.md`（mtime `Sep 17 05:08`；主检出 `git log` 逐字 `15058dfae tasks: gap-routine-…-ac-238-upgrade-face todo→ready（promotion-driver 机械晋升）`、`78c66104c …ac-239…`）。
  - 该轮的驱动侧读数（`.quay/quality-round.jsonl`，`2026-09-17T05:07:02.206Z`）：`freshness-refresh` state=**verified**、`fired: true`、`durationMs: 235543`、`exit: 0`、`runId freshness-refresh-1789621383770` —— 即**常驻 quality driver 自己调度并跑成**的那一轮（⛔ 不是夹具、⛔ 不是 `--selfcheck`）。
  - ⚠️ 如实披露的动作面：该轮之所以立刻 due，是因为 anchor 为加载重建产物而**整进程重启**（driver 的 `lastRun` 是进程内存态，重启 ⇒ 首轮例程均 due），叠加我把 `.quay/routine-last-run.json` 里 `freshness-refresh` 的持久窗口游标清空（该文件 gitignored；改前全文已存档）。两处都是**调度游标的复位**，⛔ 不伪造任何读数：探针、立案、任务写盘全部由产物自己在生产 root 上真实完成。
- [x] AC7 未修 `goals/` 且判据本体只读：`git diff --exit-code -- goals/` 为空；只跑 criterion 前后 `md5sum .quay/productization-verification.jsonl` 相同。
  **证据**：`git -C <worktree> diff --exit-code -- goals/` ⇒ **rc=0**（空）。`md5sum .quay/productization-verification.jsonl` 在 `node .qay/ac214-6th/run-criterion.mjs /home/yale/work/quay` 前后同为 `ec731e1d0722bd47f2847c591e2c842b`（criterion rc=0）⇒ 判据本体只读。
  ⛔ **本任务对 `goals/` 零改动**：`git diff --name-only develop...HEAD -- goals/` 为空；criterion / `expect` / K / 主体集合 / 正文一字未动。

## Definition of Done

主检出载体上 AC-238/239 的证据回到窗口内且 **AC-214 判据本体干跑 exit 0**（七行 margin 全正）；**在跑的 anchor 加载的内核不再早于其源树**（`STALE BUNDLE` 不再出现，或该条件已有一个会动作的消费者）；**立案步在生产载体上真的执行过**——`.quay/routine-findings.jsonl` 里出现由它产出的 `filing-round` 记录并对应到任务文件，`ts` 晚于修复落地时刻；且在「不陈旧」的对照下**不**触发补救（⛔ 不是恒有输出）。

**达成读数**：① 七行 margin 全正（`AC-238/239 = 0/200 margin 200`），判据 exit 0，`goal gate AC-214 --root .` exit 0；② 在跑的 anchor（`pid=3821426`，`.quay/anchor.json`）加载的是**重建于 04:42:39 的那份 dist**，而它的源树最新 mtime 早于它 ⇒ `bundleStale` 不再成立——**并且**该条件现在有一个会动作的消费者（`rebuildKernelBundle` + 整进程重启，见 AC6 落点）；③ `filing-round` 记录 2 条、其中 resident driver 那一条为 AC-238/239 立案出两个真实任务文件；④ 「不陈旧」对照下不触发（AC6 测试 ④ + 本轮生产形态本身：重建后不再有新的 STALE BUNDLE 行）。
⚠️ **残留（如实标注，⛔ 不声称已闭合）**：本轮把「陈旧 bundle」从「只喊不做」变成「检测 + 机械重建 + 整进程重启」的是**主检出 dist 的手工重建 + 手工重启**——即那条日志一直在要求的**人工动作**，本轮由本条任务执行；**消费者本身（新代码）此刻只在任务分支上**，要等本分支经 fan-in 落到 develop、主检出同步到 develop、且**下一次**该条件出现时，才会由 anchor 自己执行。另：诊断中发现当前 anchor 在「常驻例程跑 LLM 探针」期间**收不到 SIGTERM**（事件循环被阻塞，两次实测：SIGTERM 后 100s/180s 未进入停机；`/proc/<pid>/wchan=ep_poll`）——本条**未**处理该形态，另行记录。

⛔ 不接受的替代物：改 K / 删主体 / 改 `expect` / `criterion`；手写或搬运证据记录；**只读源码文件就宣称「在跑」**；只把记录写进任务 worktree 的 `.quay/`（判据读主检出 ⇒ 空转）；把 AC6 降格成又一条观察项（只报不接消费者）；用「日志里有 STALE BUNDLE 行」冒充「陈旧已被处理」——**这正是本条的全部要点**。

## Touches

- `plugin/scripts/driver-anchor.ts`（`bundleStale` 支：给它一个动作面 / 独立取值）
- `plugin/scripts/driver-runtime.ts`（`resolveKernelBuildScript` / `rebuildKernelBundle` / `readAnchorBundleReading` / `KernelBundleSyncState`）
- `plugin/scripts/kernel-sibling-resolution-check.ts`（`DRIVER_ANCHOR_SINGLE_ENTRY.fns` 增列布局段的合法落点）
- `plugin/test/driver-anchor.test.mjs`（双向负控制）
- `plugin/freshness-producers.json`（upgrade-face 的 `wallclock_hours` 按本轮实测更正 + caveat 修正 + `_aged_source`）
- `plugin/probes/freshness-refresh.md`（本轮**未改**：产出契约未变，探针的产出者登记面仍从该 mapping 读，无需新字段）
- `tasks/gap-ac214-sixth-crossing-stale-bundle-detected-but-no-remediation.md`（自身文件：勾 AC + 贴实跑证据）
- `.quay/routine-findings.jsonl`（生产载体：本条要在它上面取证 `filing-round`；⚠️ 该文件 git-tracked，故声明）
- `.quay/productization-verification.jsonl`（gitignored：产出者 append 的落点，⛔ 非可提交物）