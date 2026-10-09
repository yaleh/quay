---
id: gap-routine-freshness-refresh-stale-goal-009-ac-201
title: "freshness-refresh: evidence_ts 2026-09-25T17:17:02Z is 321.87h old and
  the delivery-face distance d=217 already exceeds the window K=200 (margin -17)
  — the subject is outside the f"
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
evidence_ts 2026-09-25T17:17:02Z is 321.87h old and the delivery-face distance d=217 already exceeds the window K=200 (margin -17) — the subject is outside the freshness window now, not merely approaching it

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1791515642323` · ts `2026-10-09T03:14:02.323Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`coldstart-face`、`GOAL-009-AC-201`
- 涉及文件：
- `plugin/freshness-producers.json`
- `.quay/productization-verification.jsonl`
- `.quay/goal-freshness-margin.json`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
re-run coldstart-face on the verify hosts B and C with a target-gateway-known --driving-profiles

## Disposition

**结论（一句话）**：复核逐字复现了 finding 立案时的读数；但**处置时该案由已不复存在** —— AC-201 现读数 `d=0 / margin=200`（evidence_ts `2026-10-09T03:47:03Z`，build_sha `cdbe3483c1f09542d1a4930eee3af28b9b3f0ff1`，实测该 evidence 距 develop 的 delivery-face 距离 = **0**）。本次处置 = **确认已解决 + 定位复发成因**：该主体 14 天空窗的失败点**在【立案】这一步、不在产出者** —— 例程每轮都探到它出窗，但它的立案被 `rate` 闸饿死 ⇒ 无任务 ⇒ 无派发 ⇒ 产出者 14 天未跑。⚠️ 本次刷新**不是**本主体自己的 producer 被点名重跑的结果，而是**同批 AC-238 的 remedy** 在其**段①**（install 验证 = `append_ac201_record`）顺带写出的。

### ① 复核 —— finding 立案读数逐字复现

载体 `.quay/productization-verification.jsonl` 中 `ac == "GOAL-009-AC-201"` 且 `ts == finding.evidence_ts` 的那条（逐字）：

```
{"build_sha": "09f5c3a80893139705d3245f2c721e984abad09c", "ts": "2026-09-25T17:17:02Z", "ac": "GOAL-009-AC-201", "tgz_sha256": "e37597e05a4b2bf8e76f68fbdf9be19f1a0f64d2cf62f1aaee9ac71a619574de"}
```

`evidence_ts` 逐字相等 ⇒ finding 的 `rationale`（`321.87h old` / `d=217` / `K=200` / `margin -17`）**对真样本命中**（硬规则 2 的零计数配套动作的镜像）。`d=217` 可独立复核：同一 `evidence_ts` 的兄弟主体 `GOAL-009-AC-203` 此刻仍是 `d=218`（同一证据、develop tip 前进 1 提交），与立案时的 217 相差 1。

### ② 处置时读数 —— 案由消失（first-hand）

- `.quay/goal-freshness-margin.json`（`at 2026-10-09T04:06:42Z`）：`GOAL-009-AC-201: {"K":200,"d":0,"evidence_age_hours":0.33,"evidence_ts":"2026-10-09T03:47:03Z","margin":200}`。
- 载体 AC-201 最新记录（总 51 条）：`{"build_sha":"cdbe3483c1f09542d1a4930eee3af28b9b3f0ff1","ts":"2026-10-09T03:47:03Z","ac":"GOAL-009-AC-201","tgz_sha256":"611456095522116e65b2877a2c5cd5d1b3ceb9dae38ba4c1c470e5b731c22688"}`。
- 新鲜度时钟（read-only，⛔ 非产出者）：`node --experimental-strip-types plugin/scripts/freshness-producer-coverage-check.ts --delivery-face-distance --from cdbe3483c1f09542d1a4930eee3af28b9b3f0ff1 --json` ⇒ `distance = 0`（逐字 `0 non-merge commit(s) touching the delivery face + 0 merge(s) carrying independent content`）。

⇒ 判据读数由立案时的 `d=217 / margin -17` 变为处置时的 `d=0 / margin 200`：**题面所述问题不再成立**。

### ③ 失败在哪一步 —— 在【立案】，不在产出者

- 机制（已有机制在管）：`coldstart-face` producer 已在 `plugin/freshness-producers.json` 注册（`subjects` 含 `GOAL-009-AC-201`），例程 `freshness-refresh` 只负责探测+立案，产出者由派发链执行。
- 空窗读数（载体既有，⛔ 未手写）：`freshness-refresh` 在 **2026-09-26 → 2026-10-09 之间 `filed>0` 的轮次 = 0**（逐轮 `filed=0`，`rejected[].reason` 逐字 `rate: 3 routine-filed tasks this window ≥ cap 3 (subject recurrence: N round(s))`）。同期 AC-201（以及同在 `coldstart-face.subjects` 的 AC-203/207/232）载体记录增量为 0 ⇒ 产出者确实 14 天没跑。
- 因果链（明确到步）：例程探到出窗 → **立案被 `rate` 闸拒** → 无任务 → 无派发 → 产出者不跑 → 证据继续老化 → finding 从「临近」变「已出窗」。
- 该 `rate` 闸缺陷已有独立正本：`gap-routine-filing-rate-global-window-starves-freshness-refresh`（**done**）—— 跨 routine 的 24h 全局立案预算（K=3）被另一 routine（`semantic-dedup-scan`，每轮 `filed=3`）吃光。修复 `30858fef1`（按 routine 分账）与后续 `313e8eaa`（有限全局天花板）均已在 develop。
- ⚠️ 弱证据（⛔ 不作结论，硬规则 4 推论四）：2026-10-09T03:14:02Z 那一轮 `freshness-refresh` 首次 `filed=3`（与「按 routine K=3」同形），而此前连续多轮 `filed=0`；本轮未做单变量对照 ⇒ 只记读数。

### ④ remedy 可执行性 —— 本次逐条实测（补齐 scan-round 自报的两个未验项）

scan-round（runId `freshness-refresh-1791515642323`）`notes` 逐字自报：「`unverified: host C authorization and whether a target-gateway-known --driving-profiles name exists were not checked, since no producer may be run.`」。本次亲自补测（⛔ read-only 可达性探针，未跑产出者）：

| # | 项 | 本次读数（逐字） | 判定 |
|---|---|---|---|
| 1 | host B ssh 授权（BatchMode） | `ssh -o BatchMode=yes -o ConnectTimeout=8 yale@orangevps.wan.hwang.men 'echo PROBE-OK; hostname'` ⇒ rc=0 / `PROBE-OK` / `orangevps` | ✅ |
| 2 | host C ssh 授权（BatchMode） | 同形 ⇒ rc=0 / `PROBE-OK` / `instance-20221019-1509` | ✅（scan-round 未验项之一，已补） |
| 3 | 目标机有 `claude-fjdac` | B 与 C 均 `~/.local/bin/claude-fjdac`（1525B, Sep 9） | ✅ |
| 4 | 已推 profiles 的 model 为【目标网关认得】 | B 与 C 的 `~/quay-driving-profiles.yml` 均 `model: deepseek-v4-pro-anthropic`（= 本地 `quay-driving-profiles-target.yml` 同值） | ✅（scan-round 未验项之二，已补） |
| 5 | 目标机磁盘 | B `/ 93% used, 7.5G free`；C `/ 55% used, 21G free` | ✅ |

⇒ remedy（`coldstart-face`，`--hosts "B C"` + target-gateway-known `--driving-profiles`）**当下可执行**。⚠️ 但见 ⑤：本任务**未**据此重跑。

### ⑤ 本任务⛔未做的事（逐条，不以沉默代替）

- ⛔ **未重跑 `coldstart-face`**。理由（⛔ 不是省事）：本 finding 的**唯一主体** AC-201 在处置时已在窗内（②），重跑对该主体不产出新读数；且本任务无代码 delta，跑产出者会向**主检出**的 `.quay/productization-verification.jsonl` 追加记录 —— 该写入面属派发链/主检出，不是本 worker 应扩面执行的一刀。**证伪条件**：若 AC-201 仍出窗，则「已解决」为假；现读数 `d=0` 直接反驳。
- ⛔ **未改 `plugin/freshness-producers.json`**（Touches 里那一行）：逐项复核结论**正确、无需变更** —— `coldstart-face.subjects` 含 `GOAL-009-AC-201`；`command` 与 finding 的 `suggestedAction` 同形（`--verify-coldstart --ac207-e2e --hosts "B C" … --driving-profiles <…>`）；`preconditions` 已写明 `--driving-profiles` 的 model 必须是目标网关认得的名字。⛔ 把运行史写进该文件本身违反它自己的单源原则。
- ⛔ 未改 `goals/`、未改 K/criterion/expect、未改探针脚本；⛔ 未删载体里任何记录（含 finding 所指那条 2026-09-25T17:17:02Z 记录）。
- ⛔ **未另立修复任务**：③ 的 `rate` 闸缺陷已由 `gap-routine-filing-rate-global-window-starves-freshness-refresh`（done）覆盖，重复立案违反去重。
- ⛔ 未把任务置 `needs-human`：AC-2 的两个分支（修掉 / 写明机制+失败步）**均已满足**。

### ⑥ 观察项（⛔ 无发生率读数者不得升为前置 —— 硬规则 12）

1. **「载体被写入」≠「本主体的 producer 被跑」**：AC-201 这次是被**另一主体**（AC-238 的 `upgrade-face` 运行）的**段①**顺带刷新的。该形态（一次在读 @238 的运行为别的 subject 写出合格记录）已在 `…-ac-239-139c5b66` 的观察项 2 登记，本任务只留读数、⛔ 不重复立案。
2. **`coldstart-face` 的四主体仍在同一腿上**：AC-201/203/207/232 共享该 producer，当前 AC-203/207/232 均 `d=218`（出窗）且**板上无任务**（2026-10-09T03:14 那轮 `rate` 闸只放行 3 条：AC-201/238/239）。⚠️ n=1，只记观察、⛔ 不立前置。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `stale-goal-009-ac-201`（routine `freshness-refresh`，runId `freshness-refresh-1791515642323`）所描述的问题被复核并处置 —— 复核 = ① 载体本体逐字复现 finding 的 `evidence_ts`/`d`；处置 = ② 现读数 `d=0`（案由消失）+ ③ 失败点按位置定位在【立案】闸 + ④ remedy 可执行性逐条实测（补齐 scan-round 的两个未验项）。
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案 —— **案由已消失**（AC-201 `d=0 / margin=200`，由 2026-10-09T03:47:03Z 的产出者运行写入，可被第三方读同一条载体记录复跑）；且**机制与失败步都已写明**：机制 = `coldstart-face` producer + 例程 `freshness-refresh`；失败步 = 【立案】（`rate` 闸 14 天饿死 `freshness-refresh` 的立案 ⇒ 无派发 ⇒ 无产出者运行），正本 `gap-routine-filing-rate-global-window-starves-freshness-refresh`。

## DoD
- [x] 上面的判据实跑通过 —— ①/② 的读数取自载体本体（`.quay/productization-verification.jsonl` / `.quay/goal-freshness-margin.json`，`python3` 解析后逐字打印）；`d=0` 由 read-only 新鲜度时钟当场跑出（`--delivery-face-distance … --from cdbe3483…` ⇒ `distance = 0`）；④ 的五项在 B/C 上当场 `ssh` 取读数。
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑 —— 探针那一侧本次 scan-round 逐字 `since no producer may be run`（其职责止于立案）；本任务（派发链一侧）复核后判定**该主体已解决、无需重跑产出者**（②），理由与证伪条件见 ⑤。

## Touches
- `plugin/freshness-producers.json`
- `tasks/gap-routine-freshness-refresh-stale-goal-009-ac-201.md`
