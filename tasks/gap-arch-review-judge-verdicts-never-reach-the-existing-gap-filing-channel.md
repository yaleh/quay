---
id: gap-arch-review-judge-verdicts-never-reach-the-existing-gap-filing-channel
title: architecture-review judge 一周 25+ 次同一结论从未立案 —— 立案通道存在，但只接机械漂移、不接语义结论
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**症状（2026-09-12 实测）**：`architecture-review-judge` 探针每小时运行一次；2026-09-06→09-09 期间 **25+ 次独立运行给出几乎相同的结论**——P1 簇的 `deletion-closure` 数值（DC=3200~3570，随时间递增）被 `.archguard/output/*`（archguard 自己的生成产物）与 `.claude/worktrees/*`（git worktree 全仓快照）灌入依赖图而污染，**建议在计算 closure 前排除这些目录**。**每一次都被判为「coincidental / 不采取行动」，`task_list` 检索确认无对应任务。**

**⚠️ 本条的前提经查证被修正过一次，⛔ 不要照抄「无人消费」那个说法**：立案通道**是存在的**——`plugin/scripts/quality-gate-driver.ts:314` 逐字写着「gap-filing（AC3）：drift 非空且未 halt 且资源门 GO ⇒ spawn 短命 agent 经 ABI 立案」，走 `quay-file-task` 且带**机制查重**（`:255`）。

**真正的缺口是接线，不是缺通道**：
- 立案通道的触发条件是 `report.drift.length > 0`（`:315`），而 `report.drift` 来自 **packaging-hygiene 的机械检测**（`config-key-consumer-check` / `shipped-entry-runnable`，见 `:254`），其 argv 构造器是 `buildPackagingGapWorkerArgv`（`:318`）。
- 而 architecture-review judge 走的是另一条路：`:618` `return launchArgv("pool-judge", archReviewJudgePrompt(clusters, root), root)`。

⇒ **两条路不通**：语义 judge 的结论**结构上到不了那个立案通道**。成本全付（每小时一次 LLM 调用），收益为零。

**为什么这条应先于「加更多语义检查」**：当前证据指向**语义产出没有去处**，而非检查数量不足。⛔ 在接线查明之前新增语义检查，只会按比例放大这个浪费。

## Plan

1. **先取直接量**：列出该探针最近 ≥20 次运行的**结论原文与各自处置**（打印原文与时间戳，⛔ 不只报计数）。
2. **定位接线缺口的确切位置**：`archReviewJudge` 的返回值流向何处、在哪一步被判为「不采取行动」、与 `report.drift` 的构造点相距多远。**用最小改动验证你的定位**（改一个条件看结论是否变化，再改回）。
3. **决定接法**：是把语义结论并入 `report.drift`，还是给语义结论单开一条同构的 gap-filing 路径。**给出选择理由**，⛔ 不要两条都做。
4. **防重复立案**：既有通道已带机制查重（`:255`），接线后必须复用它，⛔ 不新造第二套查重。
5. **防噪声**：25 次同一结论若接上通道会不会变成 25 条重复任务——说明你的去重/节流设计，并给出它**能取假**的验证。

## Acceptance Criteria

- [x] AC1 枚举而非布尔：给出该探针最近 ≥20 次运行的结论清单与各自处置（含时间戳，打印原文）。
- [x] AC2 接线可取假：构造一次「语义 judge 给出 actionable 结论」的输入 ⇒ 必须产生**恰好一条**立案（或命中既有任务的查重报告）；不给出 actionable 结论时 ⇒ **零立案**。两态输出贴出。
- [x] AC3 复用既有查重：立案路径经 `quay-file-task` 的机制查重，⛔ 无第二套查重实现（grep 计数 + 打印命中内容）。
- [x] AC4 节流可取假：同一结论连续出现 N 次只产生一条任务——贴出 N 次输入与最终任务数的实际读数。

## Definition of Done

- 四条 AC 满足，AC2/AC4 有实际两态输出留档。
- ⛔ **本任务只接线与去重，不修 deletion-closure 本身**——「排除 `.archguard/output/` 与 `.claude/worktrees/`」是那 25 次结论的**内容**，它该由接线后自动立出的任务去做；在本任务里顺手修掉会让 AC2 失去被验证的对象。
- 项目自身闸门（scoped 门 + 全量套件绿）。

## Touches

- .gitignore
- plugin/scripts/quality-gate-driver.ts
- plugin/scripts/architecture-review-cluster.ts
- plugin/test/quality-gate-driver.test.mjs
- plugin/test/architecture-review-cluster.test.mjs
- plugin/test/helpers/worker-driver-harness.mjs
- plugin/test/worker-driver-resident.test.mjs
- plugin/test/worker-driver-fan-in.test.mjs
- tasks/gap-arch-review-judge-verdicts-never-reach-the-existing-gap-filing-channel.md

## Evidence — AC1 · 探针最近 42 次运行的结论清单与各自处置（枚举，非布尔）

**量的产生处**：`.quay/architecture-review-round.jsonl`（judged 载体的 49 条记录，2026-09-06T08:13Z→2026-09-08T19:30Z）
——**不是** `.quay/quality-round.jsonl`（driver 的轮心跳只保留最近一窗）。
**可复现的提取命令**（读【主检出】的载体，⛔ worktree 的 `.quay/` 是主检出的前缀拷贝、不可作证据）：

```bash
python3 - <<'EOF'
import json
recs=[json.loads(l) for l in open(".quay/architecture-review-round.jsonl") if l.strip()]
for r in recs:
    if r.get("state")!="judged": continue
    for c in r["clusters"]:
        if c["clusterId"]=="P1-deletion-closure":
            print(r["judgedAt"], c["verdict"], "|", c["label"], "|", c["suggestedAction"])
EOF
```

**读数**：judged 记录 42 条，其中 P1 簇判词 42 条（**≥20 ✓**），另 7 条 `failed`（`judge output not a JSON array`，无判词 ⇒ 零产出）。
**处置**：`verdict` 取值只有 `coincidental`（40）与 `uncertain`（2）；**42 条全部 zero 立案**——`task_list` 检索无任何对应任务，
且驱动侧从无任何代码路径把这两类值送往立案通道（改动前 `runArchitectureReview` 的返回值只落在判词载体）。

**读数原文（DC 随时间单调递增 2827→3571，与结论「被生成产物/工作树快照灌入」一致）**：

| # | judgedAt (UTC) | verdict | 读数（原文） | suggestedAction（原文，未截断） |
|---|---|---|---|---|
| 1 | 2026-09-06T08:13:10.735Z | coincidental | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=2827 files, R=11.54 | Ignore; it measures fan-out of init/telemetry shell-outs, not mergeable debt |
| 2 | 2026-09-06T09:13:02.597Z | coincidental | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3196 files, R=13.04 | Exclude generated output + worktree snapshot dirs from closure computation; no product change. |
| 3 | 2026-09-06T11:14:53.135Z | coincidental | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3196 files, R=13.04 | Discard as clustering artifact; hub-ness of the 3 seeds is already known, not actionable debt. |
| 4 | 2026-09-06T12:14:16.806Z | coincidental | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3196 files, R=13.04 | Keep as-is; treat the three seeds as foundation, no merge. |
| 5 | 2026-09-06T13:14:43.922Z | coincidental | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3202 files, R=13.07 | Ignore as arithmetic noise; the 3 seed scripts are load-bearing but that is expected, not actionable debt. |
| 6 | 2026-09-06T14:15:53.801Z | coincidental | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3203 files, R=13.07 | Keep as-is; if re-flagged, exclude generated/worktree paths before judging. |
| 7 | 2026-09-06T15:14:25.146Z | coincidental | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3204 files, R=13.08 | Ignore; exclude generated/snapshot dirs before re-judging any deletion closure. |
| 8 | 2026-09-06T16:15:38.790Z | coincidental | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3206 files, R=13.09 | None — exclude worktrees and generated output from the deletion-closure metric so the R=13.09 signal reflects real consumers only. |
| 9 | 2026-09-06T17:17:20.524Z | coincidental | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3208 files, R=13.09 | Re-run the closure excluding generated output dirs and worktree snapshots; no abstraction warranted. |
| 10 | 2026-09-06T21:19:27.919Z | coincidental | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3211 files, R=13.16 | None — seeds are core infra, not removable. |
| 11 | 2026-09-06T22:19:56.595Z | coincidental | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3211 files, R=13.16 | Ignore as arithmetic; if anything, cap closure traversal to exclude generated/output+worktree paths before re-reading R=13.16 |
| 12 | 2026-09-06T23:20:44.139Z | coincidental | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3212 files, R=13.16 | Exclude .claude/worktrees/* and .archguard/output/* from the closure before judging; residual is legitimate shared-lib fan-in |
| 13 | 2026-09-07T00:22:17.071Z | coincidental | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3212 files, R=13.16 | keep as-is; re-run closure excluding worktree/output copies before reading any real ratio. |
| 14 | 2026-09-07T01:21:55.281Z | coincidental | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3212 files, R=13.16 | Ignore the closure metric; audit only the 3 scripts' direct consumers if ever removing them. |
| 15 | 2026-09-07T03:22:01.964Z | coincidental | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3212 files, R=13.16 | Ignore; if a 'god-script' smell is wanted, re-measure over git-tracked files only. |
| 16 | 2026-09-07T04:21:59.206Z | coincidental | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3212 files, R=13.16 | No abstraction; treat DC as noise and drop from clustering. |
| 17 | 2026-09-07T08:27:05.914Z | coincidental | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3562 files, R=14.60 | Exclude from merge consideration; it flags reachability, not replication. |
| 18 | 2026-09-07T10:25:58.331Z | coincidental | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3562 files, R=14.60 | Exclude .archguard/output/** and .claude/worktrees/** from deletion-closure analysis, then re-measure the real closure |
| 19 | 2026-09-07T11:25:29.324Z | coincidental | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3562 files, R=14.60 | Ignore; fix the deletion-closure seed to exclude .claude/worktrees/ and .archguard/output/ if it re-flags. |
| 20 | 2026-09-07T12:25:09.855Z | coincidental | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3562 files, R=14.60 | ignore as closure artifact; the underlying hub coupling is the same subprocess-naming pattern, not actionable duplication |
| 21 | 2026-09-07T15:28:08.923Z | coincidental | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3564 files, R=14.61 | Keep as-is; these are legitimately central shared entrypoints, not deletion debt. |
| 22 | 2026-09-07T16:26:50.766Z | coincidental | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3563 files, R=14.60 | Keep as-is; ignore closure over generated output/worktree copies. |
| 23 | 2026-09-07T17:28:54.818Z | uncertain | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3563 files, R=14.60 | Re-measure on tracked source only, per-component (quay-init.sh laydown closure is the real §2.9 question; gate-script-lib.sh must read low-R per reverse criterion) |
| 24 | 2026-09-07T18:29:39.669Z | uncertain | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3564 files, R=14.61 | re-measure closure over git ls-files tracked source only before treating as deletion debt |
| 25 | 2026-09-07T19:27:29.596Z | coincidental | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3564 files, R=14.61 | Exclude .archguard/output/, .claude/worktrees/, and generated artifacts from the archguard graph before recomputing DC/R. |
| 26 | 2026-09-07T20:28:24.338Z | coincidental | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3564 files, R=14.61 | Keep as-is; fix the closure metric to exclude .claude/worktrees/** and generated .archguard/output before re-judging. |
| 27 | 2026-09-08T00:29:34.465Z | coincidental | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3561 files, R=14.65 | Exclude generated outputs, worktree snapshots, and catalog/sync-vendor naming from the closure before trusting R=14.65. |
| 28 | 2026-09-08T01:34:56.095Z | coincidental | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3561 files, R=14.65 | Keep as-is; these are load-bearing shared scripts, not candidates for deletion or merge. |
| 29 | 2026-09-08T03:35:36.250Z | coincidental | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3561 files, R=14.59 | Keep as-is; exclude generated/worktree dirs from closure counting so R reflects real source only. |
| 30 | 2026-09-08T04:35:59.421Z | coincidental | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3561 files, R=14.59 | Exclude from abstraction; treat as a whole-repo deletion-impact measurement, not identity debt. |
| 31 | 2026-09-08T05:35:28.734Z | coincidental | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3561 files, R=14.59 | Ignore; not actionable. |
| 32 | 2026-09-08T06:36:55.895Z | coincidental | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3565 files, R=14.61 | Keep as-is; no deletion or merge — the seeds are load-bearing by design. |
| 33 | 2026-09-08T07:41:43.171Z | coincidental | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3566 files, R=14.61 | Recompute deletion-closure after modeling bash `source`/`.` and subprocess spawn as real accessors and excluding catalog name-lists. |
| 34 | 2026-09-08T08:41:23.055Z | coincidental | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3566 files, R=14.61 | Exclude .archguard/output and .claude/worktrees from the import graph and re-run the closure. |
| 35 | 2026-09-08T09:41:07.557Z | coincidental | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3566 files, R=14.61 | Keep as-is; exclude .archguard/output and .claude/worktrees from deletion-closure computation. |
| 36 | 2026-09-08T10:41:50.480Z | coincidental | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3567 files, R=14.62 | Exclude .claude/worktrees/**, .archguard/output/**, and other generated/mirror dirs from the deletion-closure walk before re-evaluating. |
| 37 | 2026-09-08T13:42:40.956Z | coincidental | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3569 files, R=14.63 | Exclude worktree + generated-artifact dirs from the closure before treating R as a signal; leave the 3 seeds as-is. |
| 38 | 2026-09-08T14:43:44.592Z | coincidental | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3569 files, R=14.63 | Exclude .claude/worktrees/ and .archguard/output/ from the closure walk and re-run; not deletion-closure debt. |
| 39 | 2026-09-08T15:42:07.859Z | coincidental | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3550 files, R=15.43 | Ignore; it is the seed files' reachable set, not a mergeable abstraction. |
| 40 | 2026-09-08T17:31:18.124Z | coincidental | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3551 files, R=15.44 | Exclude .archguard/output and .claude/worktrees from closure computation before trusting any deletion-closure ratio. |
| 41 | 2026-09-08T18:31:07.177Z | coincidental | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3551 files, R=15.44 | Drop the cluster; it names no real boundary. |
| 42 | 2026-09-08T19:30:58.969Z | coincidental | deletion closure of [gate-script-lib.sh, quay-init.sh, fast-mode-telemetry.ts]: DC=3551 files, R=15.44 | Exclude generated/output and worktree paths from deletion-closure before re-judging; no merge. |

**逐条处置观察**：`suggestedAction` 的表面措辞在 42 次里分成 4 类意图——①「排除生成/工作树目录再算/再判」（占比最高）；
②「keep as-is，这些是承重中心性、不是债」；③「drop/ignore，是算术伪影」；④「只在 `git ls-files` 跟踪的源上重测」。
①④ 与 ②③ **在同一 verdict 值（`coincidental`）下共存** ⇒ verdict 词表本身分不出「有活要干」与「判过且不干」，
这正是本次接线必须引入结构化 `actionable`（而不是让下游去解析 `suggestedAction` 自由文本）的原因。

## Evidence — AC2 / AC4 · 两态实际读数（留档）

**AC2 两态**（同一驱动、只改 judge 的 `actionable`）：

| 输入 | actionableCount | submittedKeys | gapFiled | gap-filing spawn 数 | 台账 |
|---|---|---|---|---|---|
| P1 簇 `actionable:true` + 其余 3 簇 `false` | 1 | `["P1-deletion-closure|coincidental"]` | true | **1** | 1 条 |
| 全部 4 簇 `actionable:false` | 0 | `[]` | false | **0** | 无（不写） |

真 CLI 复跑（`quality-gate-driver.ts --once`，假三检测器 + 假 judge + 假 gap worker），
P1 簇 `actionable:true`、reasoning=`DC inflated by .archguard/output + .claude/worktrees`：

```
round 1: state=verified actionableCount=1 submittedKeys=['P1-deletion-closure|coincidental'] gapFiled=True
         reason=judged 2 cluster(s): coincidental=2; actionable=1 submitted=1 gap-filing spawned (exit 0)
```
交付给 agent 的 prompt（末参数，原文节选）：
```
You are a gap-filing agent in the quay repo. ... marked them ACTIONABLE ...
Actionable conclusions:
  - cluster P1-deletion-closure [P1] verdict=coincidental (round 0): deletion closure of [...]: DC=1 files, R=1.00
      judge reasoning: DC inflated by .archguard/output + .claude/worktrees
      judge suggested action: exclude those dirs before computing closure
File exactly ONE gap task PER actionable conclusion above ...
Use the `quay-file-task` skill (Skill tool) ...
The quay-file-task skill performs MECHANISM-BASED dedup: if a task already claims the same defect (ANY status), do NOT file a duplicate ...
⛔ Do NOT fix the defect here, and ⛔ do NOT touch the detector sources ...
```
⇒ 这一条正是那 42 次里的**结论内容**（排除 `.archguard/output` 与 `.claude/worktrees`）；接线后它**第一次**有了去处，
而本任务 ⛔ 不代它实现（DoD：顺手修掉会让 AC2 失去被验证的对象）。

**AC4 节流两态 —— 同一结论连续 N=4 轮**（真 CLI 连跑 4 轮，同一 judge 输出）：

```
round 1: actionableCount=1 submittedKeys=['P1-deletion-closure|coincidental'] gapFiled=True
round 2: actionableCount=1 submittedKeys=[]                                 gapFiled=False
round 3: actionableCount=1 submittedKeys=[]                                 gapFiled=False
round 4: actionableCount=1 submittedKeys=[]                                 gapFiled=False
⇒ gap-filing spawn 总数 = 1（⛔ 不是 4）；台账键数 = 1
```
**能取假（负控制）**：同一簇、`verdict` 由 `coincidental` 改 `abstract` ⇒ 结论键变 ⇒ **再提交一次**（spawn 2）
——证明节流**不是**按 `clusterId` 永久封死（同一簇的**不同**结论仍会立案）。
单测覆盖同名用例：`plugin/test/quality-gate-driver.test.mjs` 的
`AC4 — 节流：同一结论连续 N=4 轮只提交一次；verdict 变了才再提交（能取假）`。

**AC3 查重复用（grep 计数 + 命中内容，按位置判定，⛔ 不裸计数）**：
`quay-file-task` 在 `plugin/scripts/quality-gate-driver.ts` 全文件命中 10 行，其中**两条位于 gap-filing prompt 构造函数体内**
（`buildPackagingGapWorkerPrompt` / `buildArchGapWorkerPrompt`），两条 prompt 都含 `MECHANISM-BASED dedup` 字样
⇒ 立案路径委派给既有技能、查重由它做。**反侧**：节流模块 `architecture-review-cluster.ts` 里
`task_list|taskList|tasks_dir|readdirSync(...tasks)` 命中 **0 行** ⇒ 节流**结构上读不到任务库**，
不可能是第二套查重（它只读自己的提交台账 `.quay/architecture-review-submissions.jsonl`）。
两层职责：**查重**保证「不重复立案」（在技能里，单一实现）；**节流**保证「不为已知结论重复付费」（在 driver 侧）。

**硬规则 3b（读不懂 ≠ 判过且不立案）**：judge 判词缺 `actionable` 字段时该簇记为 `actionable: null`（载体可见），
Fact 里单列 `actionabilityNotEvaluated=N`，reason 追加 `actionability unreadable for N cluster(s) — ⛔ NOT "judged not-actionable"`；
单测 `AC2/3b — judge 判词缺 actionable ⇒ 未评估`（4 簇缺字段 ⇒ 0 立案 ∧ 未评估计数 4 ∧ 载体全 null）。

## 观察 —— ⛔ 不在本任务范围（未修，未声明 Touches）

1. **接线在生产上暂时仍不会触发**：2026-09-11 起 95 条 `architecture-review` fact 全是
   `not-evaluated: unparseable identity-replication output (exit 1)`——`identity-replication-check.ts:169`
   `readFileSync` 撞上**悬空符号链接** `experiments/quay-perpetual-stream/scripts/git-lens-l-d-code-doc-ratio.ts`
   → `plugin/scripts/…`（该目标已于 2026-09-07 被移入 `archive/2026-09-07-zero-call-scripts/`）。
   症状级复现：`node --experimental-strip-types plugin/scripts/identity-replication-check.ts --root <repo> --json` ⇒ `ENOENT … exit 1`。
   **它是另一个缺陷**（检测器鲁棒性），本任务只接线 → 不在此处顺手修；建议后续单独立案（含：detector 对缺失输入应记 not-evaluated 而不是整条例程崩掉）。
2. judge 输出有 7 次 `judge output not a JSON array` ⇒ 该轮零判词（同族：judge 输出契约的鲁棒性），亦不在本任务范围。

## Evidence — 阻塞修复：worker-driver 常驻测试 after 钩子抛错 ⇒ 套件静默挂死（本轮实测并修复）

**为什么写在这里**：本任务上一轮 fan-in 被判 `step=suite` 红，而那条红**不是本任务代码的缺陷** ——
它是 develop 侧的系统性挂死，按「develop 侧红也计入本任务、要修 + 进 Touches」处理。⛔ 四条 AC 不变，
本节只记这次阻塞修复。

**实测（2026-09-12，直接读数，⛔ 不是推测）**：

- fan-in trace：`step=suite-end exit=null ok=false reason="silence watchdog killed the suite
  (no output ≥ silence timeout)"`（1229s，14:23:05→14:43:35）。
- 该 suite 日志里 `plugin/test/worker-driver-resident.test.mjs` **既无 `__PERFILE__` 行、也无 `ℹ tests`
  汇总** ⇒ 它就是静默的那个文件（`grep -c "worker-driver-resident"` = 1，只命中 lpt-order 行）。
- 该文件的测试进程与其 spawn 的常驻驱动在 30 分钟后**仍活着**；泄漏的 root 仍在盘上，
  `worker-round.jsonl` 仍在增长（6446 轮 / 3.4MB）。
- 同形实例（2026-09-10，另一 worktree `gap-meta-readings-no-timeseries-derivation`）：文件进程与
  驱动 **51 小时后仍活着** ⇒ 系统性，非本任务引入。

**根因（三件事，每件都独立实测过）**：

1. **node:test 的 after 钩子在前一个钩子抛错时会整体跳过其后的钩子** —— node 24 实测：
   `t.after(() => { throw … })` 之后注册的钩子一条都不执行。
2. 两个测试把清理钩（`fs.rmSync(root)`）注册在 `t.after(() => drv.stop())` **之前**
   （其余 8 个常驻测试的顺序是对的 —— 这两个是后加的，纪律回归了）。
3. **触发点**：清理与仍在写 `<root>/.quay/` 的常驻驱动赛跑 ⇒ 递归删除先删掉文件、再 rmdir 时目录
   又被驱动重建 ⇒ ENOTEMPTY（`fs.rm` 默认 `maxRetries:0` 不重试）⇒ 抛错 ⇒ `drv.stop()` 被跳过 ⇒
   驱动泄漏 ⇒ 泄漏驱动持着**本测试文件进程**的子进程句柄 ⇒ 文件进程永不退出 ⇒ 套件静默 ⇒
   看门狗杀整个套件。盘上留下的泄漏 root（文件被删、目录还在，驱动仍在写）正是「删到一半抛掉」的痕迹。

**负控制（能取假）**：同一测试体（spawn 常驻驱动后抛错）——`有文件级兜底` ⇒ 运行 1.9s 正常结束、
驱动被杀；`去掉兜底` ⇒ 运行挂死到 120s 超时（`Promise resolution is still pending but the event
loop has already resolved`）= 套件静默机制的复现。

**修法**（三处，任一单独都能防住这一类）：① `rmSafe`（after 钩子里的删除永不抛；两个文件共 93 处转换）；
② 共享 harness 注册表 + `stopAllResidentDrivers()`，两个文件各加一条**文件级** `after()` 兜底
（文件级钩子在测试级钩子抛错后**仍会执行**，实测）；③ 两个测试的钩子顺序改为**先 stop 后删目录**
（用 holder，因为 drv 在钩子注册之后才 spawn）。另加两条结构面判据（读本文件源码、两个针由片段拼出
避免自匹配；窗口数 < 10 判为「没解析到」而非「都合格」）。

**回归**：`worker-driver-resident.test.mjs` 43/43 绿（含新增判据）；fan-in 结构面判据绿。提交 `496c5594d`。
