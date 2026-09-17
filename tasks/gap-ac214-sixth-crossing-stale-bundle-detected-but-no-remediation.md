---
id: gap-ac214-sixth-crossing-stale-bundle-detected-but-no-remediation
title: AC-214 第六次转红（升级面 AC-238/239 = 204/200，margin −4）：陈旧 bundle
  有检测、有如实日志，**没有消费者** —— 第五次的立案步落了源、没落进【在跑的产物】（anchor 加载的 dist builtAt
  2026-09-15T19:05:17Z，早于该步落地 22 分钟、2 天未重建）⇒ 生产上 0 条 filing-round、AC-238/239 的
  finding 三次无人接
status: todo
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

- [ ] AC1 改前读数（能取假）：在 `/home/yale/work/quay` 用**仓库自己的 YAML 解析器**抽出 `goals/AC-214-*.md` 的 `criterion:` 折叠块并逐字跑 ⇒ **exit 1**，stderr 逐字含 `GOAL-009-AC-238:204/200 (margin -4)` 与 `GOAL-009-AC-239:204/200 (margin -4)`；贴 stdout 七行 + `.quay/goal-freshness-margin.json` 全文；并贴 `.quay/goal-round.jsonl` 中 AC-214 最后一次 pass（`2026-09-17T04:01:41.613Z`）与本次 fail 两个时刻，证明是回归而非恒红。⛔ 引述本任务不算，须复跑。
- [ ] AC2 「在跑的是 dist」是直接读不是推断：贴 `ps` 里 anchor 的 cmdline + `.quay/anchor.json` 全文 + 该 anchor 的 kernel 目录下 `resolveKernelSibling("probe-routine.ts")` 的解析结果（raw `.ts` 不存在 ⇒ 落到 bundled `.js`）；并贴 `plugin/scripts/dist/probe-routine.js` 与源 `plugin/scripts/probe-routine.ts` 的 mtime 对照 + dist 中 `scan-round` 存在而 `fileRoutineTask`/`selectFilings`/`filing-round` 缺失的 grep 读数。
- [ ] AC3 陈旧条件已被检测且如实留痕：贴 `.quay/anchor.log` 中 STALE BUNDLE 行的**逐字全文**（含 `builtAt=2026-09-15T19:05:17.881Z` 与 `rebuild the bundle to clear this`），并指出该消息的补救动词**没有任何机械消费者**（给出你用来判定「无消费者」的谓词与命中数，⛔ 硬规则 5：搜不到须先证明来源对它是完备的）。
- [ ] AC4 立案步在生产上不存在 + 反例对照：贴 `.quay/routine-findings.jsonl` 中 `kind:"filing-round"` 计数 = 0，与 `.quay/quality-round.jsonl` 中 `freshness-refresh` fact 的 `recordsAppended`（= 3，⛔ 非 4）；**并给出可区分对照**：若只是被 rate/去重挡下，应存在 `filed: []` 的 `filing-round` 记录（append 在 `probe-routine.ts:785`、位于 `filingEnabled` 分支之外无条件执行）⇒ 零记录判别「没有该步」。
- [ ] AC5 产出者真跑 + 判据真转绿：按 `plugin/freshness-producers.json` 跑 `upgrade-face`，贴命令、退出码、实测墙钟、全部 `develop-deliver:` 行；在**主检出**载体上贴出 `ts` 晚于本次运行开始时刻的 AC-238/239 两条记录全文（各自 `build_sha` 为 40-hex）；随后 AC-214 criterion 干跑 **exit 0** + 七行 margin 全正 + `goal gate AC-214 --root .` exit 0。⛔ 通过放宽 criterion / 改 K / 删主体达成不算。若 AC-239 腿确实结构性不可达 ⇒ 如实贴 fail-closed 读数并说明。
- [ ] AC6 陈旧 bundle 有了动作面且能取假（硬规则 4 推论三：判据须读**生产**载体）：给出实现落点（文件:行）+ **双向负控制**（① 陈旧 ⇒ 触发或落成可被消费的独立取值；② 不陈旧 ⇒ 不触发）；并贴**生产读数**——修复落地后 `.quay/routine-findings.jsonl` 里出现 `filing-round` 记录，且该记录为 AC-238/239 的 finding 立案（对应任务文件路径 + `ts` 晚于修复落地时刻）。⛔ 只由夹具满足的判据不算产出。
- [ ] AC7 未修 `goals/` 且判据本体只读：`git diff --exit-code -- goals/` 为空；只跑 criterion 前后 `md5sum .quay/productization-verification.jsonl` 相同。

## Definition of Done

主检出载体上 AC-238/239 的证据回到窗口内且 **AC-214 判据本体干跑 exit 0**（七行 margin 全正）；**在跑的 anchor 加载的内核不再早于其源树**（`STALE BUNDLE` 不再出现，或该条件已有一个会动作的消费者）；**立案步在生产载体上真的执行过**——`.quay/routine-findings.jsonl` 里出现由它产出的 `filing-round` 记录并对应到任务文件，`ts` 晚于修复落地时刻；且在「不陈旧」的对照下**不**触发补救（⛔ 不是恒有输出）。

⛔ 不接受的替代物：改 K / 删主体 / 改 `expect` / `criterion`；手写或搬运证据记录；**只读源码文件就宣称「在跑」**；只把记录写进任务 worktree 的 `.quay/`（判据读主检出 ⇒ 空转）；把 AC6 降格成又一条观察项（只报不接消费者）；用「日志里有 STALE BUNDLE 行」冒充「陈旧已被处理」——**这正是本条的全部要点**。

## Touches

- `plugin/scripts/driver-anchor.ts`（`bundleStale` 分支：给它一个动作面 / 独立取值）
- `plugin/scripts/driver-runtime.ts`（`resolveKernelSibling` / `sourceWatch` / `kernelBuiltAt` 既有读数，若需暴露给消费者）
- `plugin/test/driver-anchor.test.mjs`（双向负控制）
- `plugin/freshness-producers.json`（若 upgrade-face 的 `wallclock_hours` / caveat 需按本轮实测更正）
- `plugin/probes/freshness-refresh.md`（若产出契约需带新字段）
- `tasks/gap-ac214-sixth-crossing-stale-bundle-detected-but-no-remediation.md`（自身文件：勾 AC + 贴实跑证据）
- `.quay/routine-findings.jsonl`（生产载体：本条要在它上面取证 `filing-round`；⚠️ 该文件 git-tracked，故声明）
- `.quay/productization-verification.jsonl`（gitignored：产出者 append 的落点，⛔ 非可提交物）
