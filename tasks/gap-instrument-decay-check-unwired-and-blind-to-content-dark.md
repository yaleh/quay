---
id: gap-instrument-decay-check-unwired-and-blind-to-content-dark
title: 仪器腐烂检测器 instrument-decay-check 自称常驻却没有任何机制调用（手动一跑即报 3
  个未裁定告警），且只认识「停止写入」，看不见「照常写入但内容是未评估或过期」的两种暗形态
status: done
labels:
  - gap
  - defect
  - meta
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**已有机制**：`plugin/scripts/instrument-decay-check.ts`（gap-archguard-p5-instrument-decay-standing-guard 落地）检测「载体写入速率归零，而写入者仍在运行」，有 A（never-wrote：从未写过）、B（rate-stopped：速率归零）两种形态，用伴生分组做对照，不设绝对速率阈值。本任务**扩展这个检测器，不另造平行机制**（单一来源）。

**事实一：它没有接到线上。** 自称「常驻检测器」，但 quality-gate-driver、manager-tick-readings 和任何例程都没有调用它；它也只认识两个载体（fan-in-step-trace.jsonl、fan-in-lock-events.jsonl）。2026-10-22 对真实仓库手动运行一次（`--no-block --json`）：`ok:false, decayedCount:3`，三个都在 fan-in-step-trace.jsonl，类型都是 rate-stopped——`verification-round-record`（末次写入 2026-10-14）、`catch-up-develop`（2026-10-10）、`suite-recovery-blocked`（2026-10-20）。**这三个尚未裁定**：可能是真的腐烂，也可能是本来就很少发生的事件。此前没有任何人看到过它们。

**事实一补充：已有的过期信号亮着，也没有下游。** arch-cycle 最近一条记录的记录级 `stale` 早已是 `true`（`artifactAgeMs=3948443656`，约 45.7 天，`staleIntervalMs=21600000`），没有任何东西消费它。仪器诚实地发出信号不够，信号必须被接到下游。

**事实二：它看不见另外两种暗形态。** 下面两种情况下载体都照常写入，所以 A/B 都不会命中：
- **C 内容全暗**：载体持续写入，但从上线起每一条都是 `evaluated:false`。实例：`.quay/arch-cycle-history.jsonl` 25/25 条为 false（首条 2026-10-18T10:25Z）。
- **D 过期的已评估**：记录为 `evaluated:true`，但它读的产物早于其所覆盖源码的最新提交。实例：arch-cycle 的 src scope 读为「已评估、0 环」，读的是 2026-10-21T16:17Z 的产物，而目录环在 16:26Z / 16:27Z 引入。D 比 C 更危险，因为它和真正的健康状态从外部看完全相同。

**发生率（硬规则 12）**：C 已实测 1 例（arch-cycle，持续 4 天）；D 已实测 1 例（src scope）；同族的历史先例：ADR-007 的 git-lens 探针被归档后变成悬空软链，自检脚本仍打出看似通过的一行，「the rot went unnoticed for six days」（ADR-007 frontmatter 下的 enforcement 注释，2026-09-13 记录）；以及本检测器自身未接线、手动一跑即有 3 个告警。

**立案检查（2026-10-22 补做）**：合并判断 = separate——与 `gap-arch-cycle-report-never-evaluated-aggregate-and-stale-artifacts` 共享 `quality-gate-driver.ts` 与其测试文件（task-granularity-advice 实测 peers 仅此一条），但机制不同，由调度器按 Touches 串行。AC1 已写成与两者落地先后无关的形式。

## Plan

1. **载体描述符注册（扩展点）**：检测器从一个描述符注册表读取要检查的载体——每个描述符写明载体路径、分组字段、是否带 `evaluated` 字段、读的是否为持久化产物（若是，记录的哪个字段是产物时间戳、覆盖哪些源路径）。现有两个载体迁成描述符；新增 arch-cycle-history、arch-coverage-history、design-evolution-history 三个描述符。新的常驻例程只需登记描述符即可被覆盖，不改检测器逻辑。
2. **形态 C**：一个带 `evaluated` 字段的载体，从首条起每条都是 false，且至少有 2 条记录（只有 1 条可能是冷启动时序，这是最小的结构条件，不是调出来的阈值）⇒ `content-dark`。
3. **形态 D**：最新一条 `evaluated:true` 记录的产物时间戳，早于触及其覆盖源路径的最新提交 ⇒ `stale-evaluated`。直接读 git 的例程（如 design-evolution-readings）标为 not-applicable。
4. **未覆盖要列出来**：没有 `evaluated` 字段、也未登记描述符的载体（如 measure-history.jsonl）列为 `uncovered`，不得计入健康。
5. **接线**：在 quality-gate-driver 里作为声明式只读例程运行（配置段 `loop.instrument_decay:`，与 arch_cycle_report 同族；不声明则不装配，AC144 的「恰好四条内建例程」不变）。每轮写一个 Fact，状态取独立值 `instrument-dark`（与 `not-evaluated`、`verified` 都不同形），reason 点名载体与形态；对每个（载体，形态）经已有 gap-filing 通道立案，按机制去重——有在开 gap 不重立，已 done 的按 gap-arch-gap-filing-dedup-any-status-blocks-refile 的规则先核对当前源码。
6. **裁定现有 3 个告警**：对 verification-round-record、catch-up-develop、suite-recovery-blocked 逐个给出 FACT（写入路径是否仍存在、触发条件近期是否出现过）与 JUDGMENT（真腐烂，还是本来就罕见）。罕见事件按检测器自身的机制声明，不得为了让读数变绿而删分组。

## Acceptance Criteria

- [x] AC1 形态 C（真实载体，与落地顺序无关）：检测器报告暗区间，而不只报告当前状态。对主检出运行，`.quay/arch-cycle-history.jsonl` 必须满足其一：当前仍全为 false ⇒ 当前读为 `content-dark`；或修复任务 `gap-arch-cycle-report-never-evaluated-aggregate-and-stale-artifacts` 已写入首条 true ⇒ 报告一个已结束的暗区间，起点为 2026-10-18T10:25Z、覆盖 ≥25 条记录，当前不再判暗。两种情况都贴出读数。`.quay/arch-coverage-history.jsonl`（31/31 为 true）不命中（负对照）。
- [x] AC2 形态 D：一份产物时间戳早于覆盖源路径最新提交的记录读为 `stale-evaluated`；夹具中产物时间晚于所有覆盖提交的记录不命中（负对照）。贴出两次输出。
- [x] AC3 未覆盖不算健康：`.quay/measure-history.jsonl` 出现在 `uncovered` 列表中，且不计入健康载体数。贴出读数。
- [x] AC4 扩展点：测试只通过注册一个合成描述符，就让一个新载体被检查，不修改检测器逻辑文件；不注册时同一断言失败（负对照）。贴出测试名与输出。
- [x] AC5 可见信号：一轮例程运行写出一个状态为 `instrument-dark` 的 Fact，并经 gap-filing 通道立案或报告已有 gap；紧接的第二轮不重复立案。贴出两轮的 Fact 与立案结果。
- [x] AC6 现有 3 个告警逐个裁定：每个都附 FACT（命令与原始输出）与 JUDGMENT，并写明处置方式。

## Definition of Done

- [x] 六条 AC 全绿；`scripts/test.sh` 相关泳道通过；合并进 develop。
- [x] 读数验证使用真实载体；夹具只用于 AC2、AC4 的负对照。
- [x] 不在 fan-in 热路径上运行。

## Evidence

> 2026-10-22，worktree `task/gap-instrument-decay-check-unwired-and-blind-to-content-dark`。
> 真实载体读数一律对主检出只读运行（`--root /data/home/yale/work/quay`）；夹具只用于 AC1 第二支、AC2、AC4 的对照。

### AC1 形态 C（真实载体）+ 负对照

命令：

```
node --experimental-strip-types plugin/scripts/instrument-decay-check.ts --root /data/home/yale/work/quay --no-block --json
```

读数（`.quay/arch-cycle-history.jsonl`，当前仍全 false ⇒ 第一支成立）：

```
"contentDark": {
  "state": "dark", "records": 25, "falseRecords": 25,
  "reason": "all 25 record(s) are evaluated:false since the first record (2026-10-18T10:25:51.593Z)",
  "darkInterval": { "startTs": "2026-10-18T10:25:51.593Z", "endTs": "2026-10-21T23:14:05.363Z", "records": 25, "ended": false }
}
```

负对照（`.quay/arch-coverage-history.jsonl`，31/31 为 true ⇒ 不命中）：

```
"contentDark": { "state": "healthy", "records": 31, "falseRecords": 0, "reason": null, "darkInterval": null }
```

第二支（修复落地后的形态，夹具 25 条 false + 1 条 true）：

```
✔ 形态 C — 修复落地后（首条 true 出现）报告一个【已结束】的暗区间，当前不再判暗（AC1 第二支）
  state=healthy
  darkInterval={ startTs: "2026-10-18T00:25:51.593Z", endTs: "2026-10-20T00:25:51.593Z", records: 25, ended: true }
  decayed(content-dark)=0   // 已结束的区间是历史，不是当前 finding
```

（夹具的首条 ts 用 00:25 只是生成方便；真实载体的起点是 10:25:51.593Z。）`darkInterval` 同时进入 quality-round Fact（例程直接携带整个 `contentDark` 读数），因此修复不会抹掉「曾经从 2026-10-18T10:25Z 起暗了 25 条」的证据。

### AC2 形态 D（stale 正例 + fresh 负对照）

夹具：临时 git 仓库，`packages/quay/src/a.ts` 在 `2026-10-21T16:26:00Z` 被提交；carrier 记录里的 `artifactTimestamp` 分别取 16:17:56Z（早于提交）与 22:00:00Z（晚于提交）。

```
--- stale fixture: artifact 16:17:56Z < newest commit 16:26:00Z ---
{ "state": "stale",
  "scopes": [{ "scope": "src", "source": "packages/quay/src",
               "artifactTs": "2026-10-21T16:17:56.117Z",
               "commitTs": "2026-10-21T16:26:00.000Z", "state": "stale" }],
  "staleFindings": ["src"] }
--- fresh fixture (negative control): artifact 22:00:00Z > newest commit 16:26:00Z ---
{ "state": "fresh",
  "scopes": [{ "scope": "src", "source": "packages/quay/src",
               "artifactTs": "2026-10-21T22:00:00.000Z",
               "commitTs": "2026-10-21T16:26:00.000Z", "state": "fresh" }],
  "staleFindings": [] }
```

真实载体上同一读数：`staleEvaluated.state = "stale"`，`recordStale = true`（载体自己的 `stale` 信号现在随 Fact 被消费），4 个已评估作用域全部早于其覆盖路径的最新提交（src / scripts / quay-native-src / experiments-scripts，逐条时间戳见 AC6 附带的 JSON）。

### AC3 未覆盖不算健康

```
"uncovered": [
  { "file": "fan-in-failure-classification.jsonl", "reason": "evaluated-but-undescribed", "present": true },
  { "file": "measure-history.jsonl", "reason": "declared-uncovered", "present": true }
],
"uncoveredCount": 2, "healthyCount": 3
```

`measure-history.jsonl` 在列表中；`healthyCount` 只数「已登记 + 可评估 + 无腐烂读数」的三个载体，未覆盖的两个不在其中。发现型 uncovered（`fan-in-failure-classification.jsonl` 首条记录带布尔 `evaluated` 却无描述符）是登记表自身漂移的可见面——检测器不假装它被检查过。

### AC4 扩展点（测试名 + 输出）

```
✔ AC4 — 注册一个合成描述符 ⇒ 新载体被检查；不注册 ⇒ 同一断言失败（负对照） (1.065246ms)
```

测试对同一份 `synthetic-evaluated-carrier.jsonl`（2 条全 false）：传入合成描述符 ⇒ `carriers.length=1`、`contentDark.state="dark"`、`decayedCount=1`；传空 manifest ⇒ `carriers.length=0`、`decayedCount=0`（负对照）。全程不改 `instrument-decay-check.ts` 的判定逻辑。

### AC5 一轮写出 `instrument-dark` Fact + 两轮不重复立案（真实载体）

第 1 轮（对主检出真实载体，gap-filing 通道用替身记录 argv / 报告已存在的 gap）：

```
state: "instrument-dark"
reason: "instrument-dark: 8 finding(s) — fan-in-step-trace.jsonl: rate-stopped (3); arch-cycle-history.jsonl: content-dark (1); arch-cycle-history.jsonl: stale-evaluated (4); filings: filed=3 already-filed=0 deferred=0; 2 uncovered carrier(s) NOT counted healthy (fan-in-failure-classification.jsonl, measure-history.jsonl)"
filings:
  fan-in-step-trace.jsonl|rate-stopped    → filed (exit 0), summary: "existing gap: gap-arch-cycle-report-never-evaluated-aggregate-and-stale-artifacts (open, needs-human) ... no new task filed"
  arch-cycle-history.jsonl|content-dark   → filed (exit 0), summary: 同上
  arch-cycle-history.jsonl|stale-evaluated → filed (exit 0), summary: 同上
gap-filing spawns: 3
```

第 2 轮（紧接；去重输入 = 上一轮写进 round 载体的 Fact）：

```
state: "instrument-dark"
reason: "... filings: filed=0 already-filed=3 deferred=0; ..."
filings: 三个 pair 全部 already-filed
gap-filing spawns: 3 (delta=0)
```

去重没有第二份台账：`readPriorInstrumentDecayFilings` 只读 `.quay/quality-round.jsonl` 尾部，取上一轮 `instrument-decay` Fact 里 `filing:"filed"` 的 pair 键。`deferred`（halted / 资源门）不写入去重集合，下一轮会重试。prompt 逐对点名 `carrier=<file> shape=<kind>` 并携带 open/done 两条机制查重规则。

### AC6 现有 3 个告警逐个裁定

#### 1. `verification-round-record`（末次 2026-10-14T11:41:51Z，7 条）

FACT（命令与原始输出）：

```
$ grep -n 'traceSuiteEvent("verification-round-record"' plugin/scripts/worker-fan-in.ts
2824:      traceSuiteEvent("verification-round-record", {
$ grep -n "suiteRunsOutsideRunner(worktree)) return" plugin/scripts/worker-fan-in.ts
2808:      if (!o?.force && !suiteRunsOutsideRunner(worktree)) return;
$ grep -n "suite_runner" .quay/config.yml
144:  suite_runner: quay-buckets
$ python3 -c "..."（统计 fan-in-step-trace.jsonl 该 step 的条数与末 3 条）
verification-round-record count 7 last3 [
  ('2026-10-14T10:36:17.238Z', 'gap-discovery-closed-loop-acceptance-report-finding-to-merge-to-effect-on-real-hosts', 'wk-prod-anchor', True, None),
  ('2026-10-14T11:21:18.387Z', 'gap-discovery-closed-loop-acceptance-report-finding-to-merge-to-effect-on-real-hosts', 'wk-prod-anchor', True, None),
  ('2026-10-14T11:41:51.225Z', 'gap-discovery-closed-loop-acceptance-report-finding-to-merge-to-effect-on-real-hosts', 'wk-prod-anchor', True, None)]
```

JUDGMENT：**稀有但活着，不是腐烂。** 写手路径存在（`recordDelegatedRound` → `traceSuiteEvent`）。在 quay 形态（`suite_runner: quay-buckets`）下，普通红/绿轮由 full-suite-runner 入账并由 `suiteRunsOutsideRunner` 早返回挡住；本组只在**本轮 suite 没有任何结论**（看门狗 SIGKILL 整组 / 从未 spawn）时以 `force:true` 写。7 条全部集中在 2026-10-14 同一个任务上，正是一次看门狗事件的特征，不是写手坏死。

处置：**保留分组**（不删、不加豁免），并把「仅例外路径可达」写进描述符 note；本轮不立案。

#### 2. `catch-up-develop`（末次 2026-10-10T19:13:58Z，96 条）

FACT：

```
$ grep -n '"catch-up-develop"' plugin/scripts/worker-fan-in.ts
2633:      a = await step("catch-up-develop", ["git", "-C", worktree, "merge", "--no-edit", "develop"], 120_000);
2634:      if (!a.ok) return fail("catch-up-develop", a);
$ git log -1 --format="%cI %h %s" --grep="merge: goal/"
2026-10-11T03:24:05+08:00 eb89d042e merge: goal/GOAL-036 into develop (...)
$ git log --since=2026-10-11 --oneline --grep="merge: goal/" | wc -l
0
（该 step 全部 96 条记录均来自 goal-036-* 任务，末条 2026-10-10T19:13:58.281Z）
```

JUDGMENT：**事件驱动，不是腐烂。** 写手只在 `mergeTarget !== "develop"`（goal 分支落地）时执行；最后一次 goal 落地是 2026-10-11T03:24+08（= 2026-10-10T19:24Z），就在本组最后一次写入后约 10 分钟，此后零 goal 落地 ⇒ 结构上没有触发条件。

处置：**保留分组**；本轮不立案。

#### 3. `suite-recovery-blocked`（末次 2026-10-20T23:23:36Z，18 条）

FACT：

```
$ grep -n '"suite-recovery-blocked"' plugin/scripts/worker-fan-in.ts
3089:            traceSuiteEvent("suite-recovery-blocked", {
（触发条件：`certifiedRun === null` — 恢复阶梯 64/48/32 全部没有产出完整判词）
（该 step 18 条；最后一条 2026-10-20T23:23:36.537Z，距本次运行 2 天）
```

JUDGMENT：**稀有但活着，不是腐烂。** 只有恢复阶梯整体耗尽才写；最近一次发生在 2 天前，写手显然仍在工作。

处置：**保留分组**；本轮不立案。

**三者的共同处置**：全部保留在 Shape B 的分组集合里（⛔ 不为了让读数变绿而删分组或加豁免）；MANIFEST 描述符 note 已记录各自的例外触发条件。真正在腐烂的是 arch-cycle 的 C/D 两形态，已有在开 gap `gap-arch-cycle-report-never-evaluated-aggregate-and-stale-artifacts`（needs-human）覆盖，按机制查重不重立。

## 落地后操作（不属于本任务完成条件）

本仓库 `.quay/config.yml` 不入库，合并后需要在 live 配置中声明 `loop.instrument_decay:` 段，例程才会运行。quality 驱动只在启动时读一次配置；合并本身会触发 anchor 自动重启，所以最好在合并之前声明。现有代码不认识这个键，提前声明不会产生任何作用。

## Touches

- tasks/gap-instrument-decay-check-unwired-and-blind-to-content-dark.md
- plugin/scripts/instrument-decay-check.ts
- plugin/test/instrument-decay-check.test.mjs
- plugin/scripts/quality-gate-driver.ts
- plugin/test/quality-gate-driver.test.mjs
- plugin/scripts/driver-runtime.ts

## Blocker

**2026-10-22T00:13:22.769Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: AssertionError [ERR_ASSERTION]: the real publish script FAILED (exit 1): [baseline A/B: HARD RED (changed-assertion) — the task's red set is NOT a subset of the develop baseline red set: added=plugin/test/shipped-shell-reachability.test.mjs,plugin/test/shipped-shell-reachability.test.mjs,plugin/test/shipped-shell-reachability.test.mjs,plugin/test/shipped-shell-reachability.test.mjs changed=packages/quay/test/build-plugin-dist.test.mjs]
- run_id：wk-prod-anchor
- session_id：f425f148-7942-451e-ba75-1c1361578d9a

## Round-2 补记（2026-10-22）：bundle 入口守卫改为 name-form

### 上一轮 suite 红的根因

上一轮（run `wk-prod-anchor`，suite 日志 `fan-in-suite-gap-instrument-decay-check-unwired-and-blind-to-content-dark~wk-prod-anchor~1792627415235-0ffef8.log`）红的 4 个文件里，3 个同因：`quality-gate-driver.ts` / `meta-driver.ts` / `goal-driver.ts` 静态 import `instrument-decay-check.ts` 后，esbuild 把它内联进 driver bundle；而它的入口守卫是 URL 形式（`path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)`），在宿主 bundle 里恒真 ⇒ 会跑检测器的 `main()` 而不是 driver 的。`build-plugin-dist` 拒绝构建（`findEntryGuardHijacks` 报 3 条 `inlined entry-guard hijack`），连带 `npm-pack-e2e`（11）、`shipped-shell-reachability`（4）、`build-plugin-dist`（1）全红。第四个红文件 `task-granularity-advice.test.mjs`（1 条 production 分布断言）在 develop 基线红集里同样红，与本任务无关。

### 修法与读数

修法：守卫迁移到 `gate-script-base.ts` 的 name-form —— `isDirectEntry(import.meta, process.argv[1], "instrument-decay-check")`（内联后 inert，直接执行时仍跑 `main()`）。行为不变，只是不再依赖 URL。

```
$ node --input-type=module -e "import {findEntryGuardHijacks} from './packages/quay/scripts/build-plugin-dist.mjs'; console.log(findEntryGuardHijacks('plugin'))"
[]
$ node --test packages/quay/test/build-plugin-dist.test.mjs        # tests 45, pass 45, fail 0
$ node --test plugin/test/shipped-shell-reachability.test.mjs      # tests 8,  pass 8,  fail 0
$ node --test packages/quay/test/npm-pack-e2e.test.mjs             # tests 11, pass 11, fail 0
$ node --test plugin/test/instrument-decay-check.test.mjs          # tests 27, pass 27, fail 0
$ bash scripts/test.sh --for-task gap-instrument-decay-check-unwired-and-blind-to-content-dark --allow-thin  # exit 0
```

## Dark-axis record

该轴仍暗,理由:本任务只做仪器腐烂检测器的接线与扩展（外加一处 bundle 入口守卫的 name-form 迁移），没有对依赖结构 / 重复抽象做新的测量，没有可解析的 L_D/L_G 读数可贴。
