---
id: gap-routine-freshness-refresh-stale-goal-009-ac-201-e398b211
title: "freshness-refresh: AC-201's newest carrier evidence (ts
  2026-10-09T13:18:40Z, 80.45h old, d=163) leaves margin/K=0.1850 at or below
  the 0.2223 fire threshold = the commits the tip "
status: ready
labels:
  - gap
  - routine-filed
  - freshness-refresh
parent: null
children: []
extra: {}
---
## Finding
AC-201's newest carrier evidence (ts 2026-10-09T13:18:40Z, 80.45h old, d=163) leaves margin/K=0.1850 at or below the 0.2223 fire threshold = the commits the tip advances in one 2.0h observation interval plus one 0.34h coldstart-face run at the worst measured 19 commits/h.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1791841139196` · ts `2026-10-12T21:38:59.196Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`GOAL-009-AC-201`、`coldstart-face`
- 涉及文件：
- `.quay/goal-freshness-margin.json`
- `plugin/freshness-producers.json`
- `.quay/productization-verification.jsonl`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
re-run coldstart-face on hosts B+C from this host (both answer BatchMode ssh rc=0), passing --driving-profiles with a model name the TARGET host's gateway accepts

## Disposition

**结论（一句话）**：finding 的四条断言逐条从载体本体复现（立案时成立，⛔ 非引述）；但**处置时案由已不存在** —— AC-201 现读数 `d=0 / margin=200`（evidence_ts `2026-10-12T22:06:56Z`，build_sha `61a1ebb0600f`），由**同一产出者 `coldstart-face` 在 `2026-10-12T21:56:11Z → 22:12:20Z` 的一次运行**写出（`PRODUCER_RC=2` PARTIAL，B/C 两条腿 `remote verify rc=0`）。该运行由**派发链**执行 —— 就是同批兄弟任务 `gap-routine-freshness-refresh-stale-goal-009-ac-203` 的处置（其 fan-in 于 `2026-10-12T22:23:05.393Z` 翻 done）—— ⛔ 不是本任务重跑，⛔ 也不是「已注意到」：本任务的 worker 在 `22:31:23.872Z` 被派发（`.quay/worker-dispatch.json` 逐字 `workerPid 4169102`），**晚于那次运行结束 19 分钟**，该主体**到达时已在窗内**。

### ① 复核 —— finding 的四条断言逐条复现（同一谓词、同一载体）

| finding 的断言 | 本轮读数 | 复现命令（⛔ 非引述） |
|---|---|---|
| 最新证据 `ts 2026-10-09T13:18:40Z` | 载体 `.quay/productization-verification.jsonl` 中 `ac=="GOAL-009-AC-201"` 共 **56** 条（立案前 54 条）；`ts < 立案 ts` 的最大者逐字 `{"build_sha":"e0535b83c268bc6a1fe566c65409f30f0b4697ce","ts":"2026-10-09T13:18:40Z","ac":"GOAL-009-AC-201","tgz_sha256":"ca260af9e8eb96ad738d184cedc789ba335cfd37741f99f064096ae3c385b45d"}` | `python3` 逐行解析该 JSONL，按 `ac` 过滤后按 `ts` 取 `ts < 2026-10-12T21:38:59.196Z` 的最大值 |
| `80.45h old` | `2026-10-09T13:18:40Z + 80.45h = 2026-10-12T21:45:40Z`；该轮 scan-round 的 `durationMs=507589`（8.5 min）⇒ 读数取自轮内 ≈21:45:40Z，⛔ 与 finding 的轮起点 ts 差 7 min 是**同一轮内的取样时刻**，不是矛盾 | 上述 ts 的算术；scan-round 记录的 `durationMs` |
| `d=163`（K=200） | `distance=163` = `contentCommits 159 + contentMerges 4`（剔除 **79** 条记账 merge）。⚠️ **口径必须指向立案时刻的 tip**，否则复现不出这个数 | `node --experimental-strip-types plugin/scripts/freshness-producer-coverage-check.ts --delivery-face-distance --from e0535b83c268bc6a1fe566c65409f30f0b4697ce --tip 8e7cd49efe79c6fc723cfba0d3f11aee1b69b55f --json`（`--tip` = `git rev-list -1 --before=2026-10-12T21:38:59Z develop`） |
| `margin/K=0.1850 ≤ 0.2223` | `margin = K − d = 200 − 163 = 37` ⇒ `37/200 = 0.1850` ✓；阈值 `0.2223 =(0.34+2.0)×19/200` ✓（`0.1850 ≤ 0.2223` 成立） | 由上一条读数算术得出；`K=200` 逐字读自 `.quay/goal-freshness-margin.json` 的 `k` |

**阈值 `0.2223` 的代入复核**（⛔ 不照抄 finding 的结论）：正本 = `plugin/probes/freshness-refresh.md` ② `THRESHOLD_fraction(p) = (W_p + I) × R / K`。代入 `W_p=0.34`（`plugin/freshness-producers.json` → `coldstart-face.wallclock_hours`，本轮逐字读）、`I=2.0`（`.quay/config.yml` → `freshness-refresh: trigger: interval:120m` ⇒ 120/60）、`K=200` ⇒ `0.2223 × 200 / 2.34 = 19.0` ⇒ finding 用的 `R ≈ 19 提交/h` 是**探针当场实测的最坏小时桶**（⛔ 不是常量，也不是配置注释里 2026-09-14 的 `R=18`）。

本轮用**同一条计数规则**（`delivery_face.command` 声明的交付面路径集）复测 `R`：

| 口径 | 读数 | 代入的 R |
|---|---|---|
| 近 7 天，非 merge 提交按**整点小时**分桶（83 桶，共 280 提交） | 最坏单桶 = **13** | 13 c/h |
| 近 24h，同上 | 最坏单桶 = **12** | 12 c/h |

⇒ finding 的 `R=19` **高于本轮两个读数**（探针自己的 notes 也报了 `--since 7d` 均值 1.75/h、整点桶最高 11/h，并说明 19 来自 15-min 网格的 `--from/--tip` 滑动窗口形式）⇒ 它的阈值方向是【保守】（高估 R ⇒ 更高阈值 ⇒ 更早立案，正是探针规格要求的那个方向）。⛔ 本任务**不动** R / K / 阈值（都不在 Touches 内，也没有取假判据支持改动）。

**谓词不是恒零的（硬规则 2 的「零计数配套动作」）**：② 的 `d=0` 是零，故必须证明同一谓词在别的输入上取到非零 —— 同一命令 `--from e0535b83c268…`（现 develop）⇒ **163**；`--from 4094d899ca72… --tip 8e7cd49efe79…` ⇒ 165（兄弟读数）。⇒ `d=0` 是真实读数，⛔ 不是「谓词恒零」的假象。

### ② 处置 —— 案由已消失（读数为证，⛔ 非「已注意到」）

- 快照 `.quay/goal-freshness-margin.json`（`at 2026-10-12T22:30:32Z`）逐字：`GOAL-009-AC-201: {"K":200,"d":0,"evidence_age_hours":0.39,"evidence_ts":"2026-10-12T22:06:56Z","margin":200}` ⇒ `margin/K = 1.00`，远高于阈值 `0.2223`。
- 载体 AC-201 最新两条（逐字）：`ts 2026-10-12T21:59:06Z` 与 `ts 2026-10-12T22:06:56Z`，两条均 `build_sha 61a1ebb0600f49269849d18757232fd8dfb28a13`、`tgz_sha256 12c87f157a327c0e74137b7df5871cf609f4f57b050054d171eaad4fe4fac11d`。立案所指的那条 `2026-10-09T13:18:40Z` 现为**次新**之一。
- 该 build_sha 到**当前** develop 的距离（新鲜度时钟当场跑，⛔ 非产出者）：`--from 61a1ebb0600f49269849d18757232fd8dfb28a13 --json` ⇒ `{"state":"computed","distance":0,"contentCommits":0,"contentMerges":0,"bookkeepingMerges":0}`。
- 产出者那次运行的日志本体（`.quay/ac203-verify/ac203-coldstart-20261012T215611Z.log` 逐字末段）：`develop tip = 61a1ebb0600f` / `B (orangevps.wan.hwang.men) remote verify rc=0 evidence_lines=10` / `evidence-completeness COMPLETE present=6` / `C (ad-arm1.wan.hwang.men) remote verify rc=0 evidence_lines=9` / `evidence-completeness PARTIAL present=5 missing=1 list=GOAL-009-AC-205` / `PRODUCER_RC=2` / `Mon Oct 12 10:12:20 PM UTC 2026`。
  ⚠️ `rc=2` 是 **PARTIAL**（三态 0 COMPLETE / 2 PARTIAL / 1 NOT-EVALUATED），⛔ 不是「跑失败」：唯一缺席项 `GOAL-009-AC-205` 不是本主体的主体，其成因是 mapping 已逐字声明的活会话前置（`session-delivery.preconditions`）。

⇒ 判据读数由立案时的 `d=163 / margin 37` 变为处置时的 `d=0 / margin 200`：**题面所述问题不再成立**。

### ③ 机制与「失败在哪一步」

- **机制（已有机制在管，三条都在册）**：`coldstart-face`（`plugin/freshness-producers.json` → `producers[]`，本轮逐字核对：`subjects` 含 `GOAL-009-AC-201`，是**登记的**唯一产出者）+ 例程 `freshness-refresh`（只探测 + 机械立案，FILE-ONLY）+ 派发链（执行产出者）。
- **本轮链条五步全留痕，⛔ 本主体没有「失败在哪一步」需要具名**（时刻取自 `.quay/task-status-events.jsonl` 与运行日志）：
  立案 `2026-10-12T21:38:59.196Z`（该轮 `candidates=7`，`filed=3`）→ 任务 create `21:47:29.431Z`（`todo`）→ 晋升 `21:48:25.563Z`（`todo→ready`，`actor.kind=promotion-driver`）→ 产出者运行 `21:56:11Z` → 首条 AC-201 记录 `21:59:06Z`（**立案后 20m07s**）→ C 腿 `22:06:56Z` → 运行结束 `22:12:20Z` → 兄弟任务 AC-203 fan-in 翻 done `22:23:05.393Z`。
- **「证据为何 80.45h 旧」的成因是结构性的、且探针规格已逐字声明**（`plugin/probes/freshness-refresh.md` ① 的 ⚠️ 段：「a healthy margin is NOT "this was recently re-verified" ... A criterion can be green while the newest evidence is days old」）。`margin = K − d` 量的是**交付面距离**，⛔ 不是墙钟年龄：该 80.45h 里交付面只前进了 163 提交，窗口**始终是开的**，例程按设计沉默；它在 `2026-10-12T21:38:59Z` 越过阈值（`0.1850 ≤ 0.2223`）时才立案 ⇒ **判据在按设计工作**。
- **本轮新读到的一个结构事实（⛔ 只是读数）**：AC-201 是七个主体中**唯一被两个产出者写入**的 —— `coldstart-face`（与 AC-203/204/205/206/207/232 同 ts 组）与 `upgrade-face`（与 AC-238/239 同 ts 组）。核实方式：把载体按 `ts` 分组，含 AC-201 的 61 个 ts 组中，一组同时含 `GOAL-009-AC-238`/`239` 的就是 upgrade-face 那次运行（逐字例：`ts 2026-10-09T13:18:40Z` 组 = `[AC88, GOAL-009-AC-201, GOAL-009-AC-238, GOAL-009-AC-239]`）。这正是立案前 AC-201 的最新 ts（`13:18:40Z`，d=163）比它的 coldstart 同批主体（`12:32:43Z`，d=165）**新 46 分钟 / 近 2 提交**的原因。⚠️ 后果仅是本主体比同批**更**新鲜，⛔ 无害、⛔ 不构成本任务要修的东西。
- 对照（同轮被拒的 4 条，逐字）：`rate: 3 routine-filed tasks this window ≥ cap 3`（AC-205 / AC-232）+ `collision: tasks/gap-routine-freshness-refresh-stale-goal-009-ac-238-79f43e79.md already exists and is not this finding ⇒ not overwriting`（AC-238 / AC-239）—— 三道闸都留了痕，⛔ 没有静默丢弃。

### ④ 本任务⛔未做的事（逐条，⛔ 不以沉默代替）

- ⛔ **未重跑 `coldstart-face`**。理由（⛔ 不是省事）：本 finding 的唯一主体 AC-201 在处置时已在窗内**且 margin 顶格**（②），重跑对它不产出新读数；且请求动作在本 workspace **已经被派发链执行过**（③），主体证据即那次运行的产物。**证伪条件**：若 AC-201 仍出窗，则「案由已消失」为假 —— 现读数 `d=0`（②）直接反驳它。附带理由：该产出者追加的载体是 `<main-checkout>/.quay/productization-verification.jsonl`（mapping 的 `carrier` 字段），那是**派发链/主检出**的写入面，⛔ 不是本 worker 应扩面执行的一刀。
- ⛔ **未改 `plugin/freshness-producers.json`**（Touches 里那一行）：逐项复核后结论**正确、无需变更** —— `coldstart-face.subjects` 含 `GOAL-009-AC-201`；`command` 与 finding 的 `suggestedAction` 同形（逐字 `bash plugin/scripts/develop-deliver-tgz.sh --verify-coldstart --ac207-e2e --hosts "B C" --force --root <main-checkout> --driving-profiles <profile-the-target-host-gateway-serves>`）；`preconditions` 已逐字写明 `--driving-profiles` 的 model 必须是**目标主机网关**认得的名字（含 2026-09-25 那次 `v4.1flash-anthropic` 被 B/C 拒的实测）。⛔ 把运行史写进该文件本身违反它自己的单源原则。
- ⛔ 未改 `goals/`（AC-201 的 `criterion` / `expect`）、未改 K、未改探针规格、未改任何脚本；⛔ 未删载体里任何记录（含 finding 所指那条 `2026-10-09T13:18:40Z` 记录）。
- ⛔ **未另立修复任务**：③ 里唯一候选是那个「两个产出者」的读数，按硬规则 12 记为观察项（⑤），⛔ 无发生率支持。
- ⛔ 未把任务置 `needs-human`：AC-2 的两个分支（修掉 / 写明机制+失败步）**均已满足**。

### ⑤ 观察项（⛔ 无发生率读数者不得升为前置 —— 硬规则 12）

1. **同一个产出者的一次运行会同时结清多个主体，而立案是按主体逐条做的。** `coldstart-face.subjects` = `AC-201/203/207/232`，**四个主体一次运行全刷新**；本轮 `2026-10-12T21:38:59Z` 一轮就为其中 3 个各立了一条任务 ⇒ 兄弟任务 AC-203 的 worker 一跑，`AC-201-e398b211` 与 `AC-207` 两条就「到达即已解决」。
   **本轮实测发生率**（当场从 `.quay/routine-findings.jsonl` 全部 **287** 个 `freshness-refresh` filing-round 数出，谓词：`findingId → ac-(\d+) → freshness-producers.json` 的 subject 映射）：**22 轮**的【候选 finding】含 ≥2 个共享同一产出者的主体（`coldstart-face` 19 轮、`upgrade-face` 21 轮）；**3 轮**的【accepted/已立案任务】共享同一产出者（`2026-09-25T04:19:13Z` upgrade-face×2、`2026-10-09T03:14:02Z` coldstart×1+upgrade×2、`2026-10-12T21:38:59Z` coldstart×3）。
   ⚠️ 这只是**读数**，⛔ 不构成前置：例程的 dedup 键是**按主体**的（本轮逐字 `matchedKey: symbols:coldstart-face,goal-009-ac-201`，且因板上已有 **done** 的 `gap-routine-freshness-refresh-stale-goal-009-ac-201.md` 而判 `state: done-only` ⇒ 加 hash 后缀 `-e398b211`），改成按产出者合并会改变立案语义，不在本任务范围；「到达即已解决」的处置成本是**一次复核**（本任务即为其一例），不是缺陷。同形观察已由 `gap-routine-freshness-refresh-stale-goal-009-ac-207`（done）与 `…-ac-201`（done）登记。
2. **AC-201 的 writer 集大于它的登记产出者集**（③ 末段）：`subjects_without_producer` 这个完备性判定只读登记映射，读不出「实际有第二个产出者也在写它」。⚠️ 本例的后果是无害的（让本主体更早刷新），⛔ n=1 个读数、⛔ 不立前置。
3. **`upgrade-face` 那一对主体此刻仍出窗**：AC-238/239 现读数 `d=163 / margin=37`（`0.1850 ≤ 0.2261`），但它们**不是本主体的主体**，且本轮已被 `collision` 闸拒绝（板上已有它们自己的任务）⇒ ⛔ 不在本任务范围，只记读数。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `stale-goal-009-ac-201`（routine `freshness-refresh`，runId `freshness-refresh-1791841139196`）所描述的问题被复核并处置 —— 复核 = ① finding 的四条断言逐条从载体本体复现（最新 `ts 2026-10-09T13:18:40Z` / `80.45h` / `d=163` / `margin/K=0.1850 ≤ 0.2223`，谓词与逐字读数见 ①）；处置 = ② 现读数 `d=0 / margin=200`（案由消失，证据为同批兄弟任务派出的一次 `coldstart-face` 真实运行）+ ③ 机制与链条五步按时刻具名 + ④ 逐条列明本任务未做的五项（含证伪条件）。
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案 —— **案由已消失**（AC-201 `d=0 / margin=200`，由 `2026-10-12T21:56:11Z → 22:12:20Z` 那次 `coldstart-face` 运行写入；第三方可用**同一条载体记录 + 同一条新鲜度时钟命令**复跑，命令逐字见 ②）；**机制已具名**（`coldstart-face` producer + 例程 `freshness-refresh` + 派发链）；**「失败在哪一步」在本主体上不适用** —— 本轮五步全留痕（③），唯一需要具名的成因是探针规格自己已逐字声明的「margin 健康 ≠ 产出者刚跑过」，其读数（交付面 80.45h 只前进 163 提交、窗口全程是开的）见 ③。

## DoD
- [x] 上面的判据实跑通过 —— ①/② 的读数取自载体本体（`.quay/productization-verification.jsonl` 逐行解析 / `.quay/goal-freshness-margin.json` 逐字读）；`d=163` 与 `d=0` 由 read-only 新鲜度时钟当场跑出（`--from e0535b83c268… --tip 8e7cd49efe79…` ⇒ `163`；`--from 61a1ebb0600f…` ⇒ `0`，且同谓词在别的输入上取到非零，⛔ 非恒零）；阈值 `0.2223` 由 `W_p=0.34`、`I=2.0`、`R=19`、`K=200` 当场代入（`R` 本轮独立复测得 12–13 c/h，低于 finding 的 19 ⇒ finding 方向保守）；产出者运行读数取自该次运行的日志本体（逐字见 ②）；链条时刻取自 `.quay/task-status-events.jsonl` 与 `.quay/worker-dispatch.json` 逐字字段。
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑 —— 探针那一侧本轮 scan-round（`2026-10-12T21:38:59.196Z`）`notes` 逐字 `no producer was executed (FILE-ONLY)`（其职责止于立案）；本任务（派发链一侧）复核后判定**该主体已解决、无需重跑产出者**（②），理由与证伪条件见 ④。

## Touches
- `plugin/freshness-producers.json`
- `tasks/gap-routine-freshness-refresh-stale-goal-009-ac-201-e398b211.md`
