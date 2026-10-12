---
id: gap-routine-freshness-refresh-stale-goal-009-ac-207
title: "freshness-refresh: AC-207's newest evidence (ts 2026-10-09T12:32:43Z,
  81.22h old, d=165) leaves margin/K=0.1750 below the 0.2223 threshold; the
  coldstart-face producer is its only "
status: done
labels:
  - gap
  - routine-filed
  - freshness-refresh
parent: null
children: []
extra: {}
---
## Finding
AC-207's newest evidence (ts 2026-10-09T12:32:43Z, 81.22h old, d=165) leaves margin/K=0.1750 below the 0.2223 threshold; the coldstart-face producer is its only owner and last ran 2026-10-09.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1791841139196` · ts `2026-10-12T21:38:59.196Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`GOAL-009-AC-207`、`coldstart-face`
- 涉及文件：
- `.quay/goal-freshness-margin.json`
- `plugin/freshness-producers.json`
- `.quay/productization-verification.jsonl`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
re-run coldstart-face on hosts B+C from this host, passing --driving-profiles with a model name the TARGET host's gateway accepts

## Disposition

**结论（一句话）**：finding 的三条断言逐条从载体本体复现；但**处置时案由已不存在** —— AC-207 现读数 `d=0 / margin=200`（evidence_ts `2026-10-12T22:06:56Z`，build_sha `61a1ebb0600f`），由**同一产出者 `coldstart-face` 在 `2026-10-12T21:56:11Z → 22:12:20Z` 的一次运行**写出（`PRODUCER_RC=2` PARTIAL，B/C 两条腿 `remote verify rc=0`）。该运行由**派发链**执行——就是同批兄弟任务 `gap-routine-freshness-refresh-stale-goal-009-ac-203` 的处置——⛔ 不是本任务重跑：本任务复核后判定**无需重跑**（② 现读数 margin 已顶格 `200 = K`，重跑对该主体不产出新读数）。⛔ 这不是「已注意到」。

### ① 复核 —— finding 的三条断言逐条复现（立案时成立，⛔ 非引述）

| finding 的断言 | 本轮读数 | 复现命令（同一谓词、同一载体） |
|---|---|---|
| 最新证据 `ts 2026-10-09T12:32:43Z`（`81.22h old`） | 载体中 `ac=="GOAL-009-AC-207"` 共 **20** 条；刷新前的那条 = `ts 2026-10-09T12:32:43Z`，`host orangevps`，`project_root /home/yale/quay-verify-coldstart-4094d899-root`，`build_sha 4094d899ca72f76df432b03c1b776461898f20a8`（现为**次新**一条） | `python3` 逐行解析 `.quay/productization-verification.jsonl` 后按 `ts` 取最大/次大 |
| `d=165`（K=200） | `distance=165` = `contentCommits 161 + contentMerges 4`（剔除 80 条记账 merge）。⚠️ **口径必须指向立案时刻的 tip**，否则复现不出这个数 | `node --experimental-strip-types plugin/scripts/freshness-producer-coverage-check.ts --delivery-face-distance --from 4094d899ca72f76df432b03c1b776461898f20a8 --tip 8e7cd49efe79c6fc723cfba0d3f11aee1b69b55f --json`（`--tip` = `git rev-list -1 --before=2026-10-12T21:38:59Z develop`） |
| `margin/K=0.1750 < 0.2223` | `margin = K − d = 200 − 165 = 35` ⇒ `35/200 = 0.1750` ✓ | 由上两条读数算术得出；`K=200` 逐字读自 `.quay/goal-freshness-margin.json` 的 `k` |

**阈值 `0.2223` 的代入复核**（⛔ 不照抄 finding 的结论）：正本 = `plugin/probes/freshness-refresh.md` ②
`THRESHOLD_fraction(p) = (W_p + I) × R / K`。代入 `W_p=0.34`（`plugin/freshness-producers.json` →
`coldstart-face.wallclock_hours`）、`I=2.0`（`.quay/config.yml` 的 `trigger: interval:120m` ⇒ 120/60）、
`K=200` ⇒ `0.2223 × 200 / 2.34 = 19.0` ⇒ finding 用的 `R ≈ 19 提交/h` 是**探针当场实测的最坏小时桶**（⛔ 不是常量）。

本轮用**同一条谓词**复测 `R`：

| 口径 | 读数 | 代入的 R |
|---|---|---|
| 近 24h | `--since "24 hours ago"` ⇒ `distance=73` | 3.04 c/h（均值） |
| 近 24h 最坏单小时桶 | 24 桶全扫，峰值在第 3→4 小时 ⇒ **14** 提交 | 14 c/h |
| 近 7 天 | `--since "7 days ago"` ⇒ `distance=292` | 1.74 c/h |

⇒ finding 的 `R=19` **高于本轮三个读数** ⇒ 它的阈值方向是【保守】（高估 R ⇒ 更早立案，正是探针规格要求的那个方向）。
⛔ 本任务**不动** R / K / 阈值（都不在 Touches 内，也没有取假判据支持改动）。

**谓词不是恒零的（硬规则 2 的「零计数配套动作」）**：本轮 `d=0` 是零，故必须证明同一谓词在别的输入上取到非零 ——
`--from 4094d899ca72…` ⇒ **165**、`--since "7 days ago"` ⇒ **292**、`--since "1 hours ago"` ⇒ **1**。
⇒ `d=0` 是真实读数，⛔ 不是「谓词恒零」的假象。

### ② 处置 —— 案由已消失（读数为证，⛔ 非「已注意到」）

- 快照 `.quay/goal-freshness-margin.json` 逐字：`GOAL-009-AC-207: {"K":200,"d":0,"evidence_age_hours":0.29,"evidence_ts":"2026-10-12T22:06:56Z","margin":200}` ⇒ `margin/K = 1.00`，远高于阈值 `0.2223`。
- 载体 AC-207 最新两条（逐字字段）：`ts 2026-10-12T21:59:06Z / host orangevps` 与 `ts 2026-10-12T22:06:56Z / host instance-20221019-1509`；两条均 `build_sha 61a1ebb0600f`、`task_id e2e-verify-207`、`task_status done`、`gate_events 1`、`produced_by_driver true`、`commit_files ["e2e-marker.txt"]`（⛔ 不是 `tasks/`|`goals/`|`.quay/` 下的记账文件）。
- 该 build_sha 到**当前** develop 的距离（新鲜度时钟当场跑）：`--from 61a1ebb0600f49269849d18757232fd8dfb28a13 --json` ⇒ `{"state":"computed","distance":0, ...}`。
- 判据本体（goal 层自己的验收跑，⛔ 不是本任务复述）：`goal_gate AC-207` ⇒ `verdict: "pass"` / `reason: "acceptance passed (exit 0)"`。
- 产出者那次运行的日志本体（`.quay/ac203-verify/ac203-coldstart-20261012T215611Z.log` 逐字末段）：`develop tip = 61a1ebb0600f` / `B … remote verify rc=0 evidence_lines=10` / `evidence-completeness COMPLETE present=6` / `C … remote verify rc=0 evidence_lines=9` / `evidence-completeness PARTIAL present=5 missing=1 list=GOAL-009-AC-205` / `PRODUCER_RC=2` / `Mon Oct 12 10:12:20 PM UTC 2026`。
  ⚠️ `rc=2` 是 **PARTIAL**（三态 0 COMPLETE / 2 PARTIAL / 1 NOT-EVALUATED），⛔ 不是「跑失败」：唯一缺席项 `GOAL-009-AC-205` 不是本主体的主体，其成因是 mapping 已逐字声明、且明确不归本仓库保证的活会话前置。

⇒ 判据读数由立案时的 `d=165 / margin 35` 变为处置时的 `d=0 / margin 200`：**题面所述问题不再成立**。

### ③ 机制与「失败在哪一步」

- **机制（已有机制在管，三条都在册）**：`coldstart-face`（`plugin/freshness-producers.json` → `producers[]`，逐字核对过：它是**唯一** `subjects` 含 `GOAL-009-AC-207` 的产出者）+ 例程 `freshness-refresh`（只探测 + 机械立案，FILE-ONLY）+ 派发链（执行产出者）。
- **本轮链条四步全留痕，⛔ 本主体没有「失败在哪一步」需要具名**：立案 `2026-10-12T21:38:59.196Z`（该轮 `filed=3`）→ 晋升 `21:48:25Z`（`todo→ready`，promotion-driver 机械晋升）→ 产出者运行 `21:56:11Z` → 首条 AC-207 记录 `21:59:06Z`（**立案后 20m07s**）→ C 腿 `22:06:56Z`。
- **「证据为何 81h 旧」的成因是结构性的、且探针规格已逐字声明**（`plugin/probes/freshness-refresh.md` ① 的 ⚠️ 段：margin 健康 ≠ 产出者刚跑过）。本轮实测该段在本主体上成立：立案前窗口内共 **36 个 filing-round**（`2026-10-09T13:56:07Z → 2026-10-12T21:38:59Z`），其中 **34 轮 `candidates=0`**，另 1 轮的 candidate 是 AC-238/239（⛔ 不含本主体）—— 即 AC-207 **始终在窗内**，例程按设计不立案（`margin = K − d` 量的是**交付面距离**，⛔ 不是墙钟年龄：81h 里交付面只前进了 165 提交）。它是在 `2026-10-12T21:38:59Z` 越过阈值（`0.1750 < 0.2223`）时才立案的 ⇒ **判据在按设计工作**。
- 对照（同轮被拒的 4 条，逐字）：`rate: 3 routine-filed tasks this window ≥ cap 3`（AC-205 / AC-232）+ `collision: tasks/gap-routine-freshness-refresh-stale-goal-009-ac-238-79f43e79.md already exists and is not this finding ⇒ not overwriting`（AC-238 / AC-239）—— 三道闸都留了痕，⛔ 没有静默丢弃。

### ④ 本任务⛔未做的事（逐条，⛔ 不以沉默代替）

- ⛔ **未重跑 `coldstart-face`**。理由（⛔ 不是省事）：本 finding 的唯一主体 AC-207 在处置时已在窗内**且 margin 顶格**（②），重跑对它不产出新读数；而请求动作（`re-run coldstart-face …`）在本 workspace **已经被派发链执行过**（③），主体证据即那次运行的产物。**证伪条件**：若 AC-207 仍出窗，则「案由已消失」为假 —— 现读数 `d=0`（②）直接反驳它。
- ⛔ **未改 `plugin/freshness-producers.json`**（Touches 里那一行）：逐项复核后结论**正确、无需变更** —— `coldstart-face.subjects` 含 `GOAL-009-AC-207`；`command` 与 finding 的 `suggestedAction` 同形（`--verify-coldstart --ac207-e2e --hosts "B C" --force --root <main-checkout> --driving-profiles <目标网关认得的 profile>`）；`preconditions` 已逐字写明 `--driving-profiles` 的 model 必须是**目标主机网关**认得的名字（2026-09-25 那次 `v4.1flash-anthropic` 被 B/C 拒的实测也在其中）。⛔ 把运行史写进该文件本身违反它自己的单源原则。
- ⛔ 未改 `goals/`（AC-207 的 `criterion` / `expect`）、未改 K、未改探针规格、未改任何脚本；⛔ 未删载体里任何记录（含 finding 所指那条 `2026-10-09T12:32:43Z` 记录）。
- ⛔ **未另立修复任务**：③ 里唯一可能的候选（见 ⑤）按硬规则 12 记为观察项。
- ⛔ 未把任务置 `needs-human`：AC-2 的两个分支（修掉 / 写明机制+失败步）**均已满足**。

### ⑤ 观察项（⛔ 无发生率读数者不得升为前置 —— 硬规则 12）

**同一个产出者的一次运行会同时结清多个主体，而立案是按主体逐条做的。** `coldstart-face.subjects` = `AC-201/203/207/232`，**四个主体一次运行全刷新**；本轮 `2026-10-12T21:38:59Z` 一轮就为其中 3 个各立了一条任务 ⇒ 兄弟任务 AC-203 的 worker 一跑，`AC-201-e398b211` 与 `AC-207` 两条就「到达即已解决」。
**发生率**（本轮当场从 `.quay/routine-findings.jsonl` 全部 **287** 个 filing-round 数出）：**8 轮**存在「同一轮立出 ≥2 条共享同一产出者的任务」，其中 `coldstart-face` 占 **5 轮**（含 2026-09-25T03:46:19Z 那轮一次立 4 条 coldstart 主体）。
⚠️ 这只是**读数**，⛔ 不构成前置：例程的 dedup 键是**按主体**的（`matchedKey: symbols:coldstart-face,goal-009-ac-207`），改成按产出者合并会改变立案语义，不在本任务范围；且「到达即已解决」的处置成本是**一次复核**（本任务即为其一例），不是缺陷。同形观察已由 `gap-routine-freshness-refresh-stale-goal-009-ac-201`（done）的观察项 2 登记。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `stale-goal-009-ac-207`（routine `freshness-refresh`，runId `freshness-refresh-1791841139196`）所描述的问题被复核并处置 —— 复核 = ① finding 的三条断言逐条从载体本体复现（最新 `ts 2026-10-09T12:32:43Z` / `d=165` / `margin/K=0.1750`，谓词与逐字读数见 ①）；处置 = ② 现读数 `d=0 / margin=200`（案由消失，证据为同批兄弟任务派出的一次 `coldstart-face` 真实运行）+ ③ 机制与链条四步按时刻具名 + ④ 逐条列明本任务未做的五项（含证伪条件）。
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案 —— **案由已消失**（AC-207 `d=0 / margin=200`，由 `2026-10-12T21:56:11Z → 22:12:20Z` 那次 `coldstart-face` 运行写入；第三方可用**同一条载体记录 + 同一条新鲜度时钟命令**复跑，命令逐字见 ②）；**机制已具名**（`coldstart-face` producer + 例程 `freshness-refresh` + 派发链）；**「失败在哪一步」在本主体上不适用**——本轮四步全留痕（③），唯一需要具名的成因是探针规格自己已逐字声明的「margin 健康 ≠ 产出者刚跑过」，其读数（36 轮里 34 轮 `candidates=0`）见 ③。

## DoD
- [x] 上面的判据实跑通过 —— ①/② 的读数取自载体本体（`.quay/productization-verification.jsonl` 逐行解析 / `.quay/goal-freshness-margin.json` 逐字读）；`d=0` 与 `d=165` 由 read-only 新鲜度时钟当场跑出（`--from 61a1ebb0600f…` ⇒ `distance=0`；`--from 4094d899ca72… --tip 8e7cd49efe79…` ⇒ `distance=165`）；判据本体由 goal 层自己跑（`goal_gate AC-207` ⇒ `pass` / `exit 0`）；产出者运行读数取自该次运行的日志本体（逐字见 ②）。
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑 —— 探针那一侧最近一轮 scan-round（`2026-10-12T18:59:43.040Z`）`notes` 逐字 `NO producer run (file-only boundary held)`（其职责止于立案）；本任务（派发链一侧）复核后判定**该主体已解决、无需重跑产出者**（②），理由与证伪条件见 ④。

## Touches
- `plugin/freshness-producers.json`
- `tasks/gap-routine-freshness-refresh-stale-goal-009-ac-207.md`