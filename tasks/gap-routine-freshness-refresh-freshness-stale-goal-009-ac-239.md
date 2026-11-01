---
id: gap-routine-freshness-refresh-freshness-stale-goal-009-ac-239
title: "freshness-refresh: margin 9 (d=191, evidence_ts 2026-10-22T12:00:12Z,
  age 242.31h) -> margin/K=0.045 <= threshold 0.0714: window would be exhausted
  by tip advance before a producer"
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
margin 9 (d=191, evidence_ts 2026-10-22T12:00:12Z, age 242.31h) -> margin/K=0.045 <= threshold 0.0714: window would be exhausted by tip advance before a producer run finishes (AC-239 has no separate command; it refreshes with AC-238)

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1793542937322` · ts `2026-11-01T14:22:17.322Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`GOAL-009-AC-239`、`upgrade-face`
- 涉及文件：
- `plugin/freshness-producers.json`
- `.quay/goal-freshness-margin.json`
- `.quay/productization-verification.jsonl`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
re-run upgrade-face on host B (same command as AC-238; --ac239-e2e leg refreshes AC-239)

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `GOAL-009-AC-239` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-01T14:22:17.322Z

## Disposition

**结论（一句话）**：remedy 已由**同轮兄弟任务** `gap-routine-freshness-refresh-freshness-stale-goal-009-ac-238-79f43e79` 真跑并**一并刷新了本主体** —— AC-239 与 AC-238 是同一次 `upgrade-face` 运行的 UPGRADE-PAIR，那次运行已把 AC-239 的新鲜度从 `d=191 / margin 9` 变为 `d=5 / margin 195`。⛔ 不是「已注意到」；本任务**不重复跑**产出者（一次成功即已刷新，重跑会再驱动一个隔离副本缺陷任务，纯浪费）。

### ① finding 复核为真（判据本体独立重算，⛔ 不采信 finding 自报值）

`delivery_face.command` 的**同一实现**独立重算（cwd = 本任务 worktree）：

```
$ node --experimental-strip-types plugin/scripts/freshness-producer-coverage-check.ts --delivery-face-distance --from 6b91fa84b37e9780637f6ac23c81b910f009bd12 --json
state=computed, distance=196, contentCommits=191, contentMerges=5, bookkeepingMerges=118, tip=6a39887fa
```

- 旧证据 `build_sha=6b91fa84…` / `ts=2026-10-22T12:00:12Z`（finding 逐字所指的那条）到 develop tip 的交付面距离 = **196**（finding 立案时记 `d=191`，此后 develop 又前进 5 个交付面提交；margin 已由 9 跌到 4，仍在窗口内但**已被探针按自己的阈值算术正确提前立案**）。
- `.quay/goal-freshness-margin.json`（`at 2026-11-01T15:34:55Z`）逐字记录 AC-239 的**旧**读数 `d=191 / margin=9 / evidence_ts=2026-10-22T12:00:12Z` ⇒ finding 的 `d` / `margin` / `evidence_ts` **逐字复现**（硬规则 2 零计数配套动作：谓词对真样本命中）。

⚠️ 把两件事分开（硬规则 3b）：**AC-239 自身的判据此刻是绿的**（载体 `2a70808c1b2a…` 那条记录各项齐全）；finding 立案时红的是 **AC-214 的新鲜度窗口**（margin 9，探针阈值 `(W+I)·R/K=0.0714` 提前触发）。⇒ 本 finding 的问题是「陈旧预警」，⛔ 不是「记录不合格」。

### ② 处置 = 已被同轮 AC-238 的产出者运行刷新（UPGRADE-PAIR，一次运行覆盖两主体）

本 finding 的 requested action（re-run upgrade-face on host B）已由**同轮兄弟任务** `gap-routine-freshness-refresh-freshness-stale-goal-009-ac-238-79f43e79`（同一次 `freshness-refresh-1793542937322` 立案）的派发链在 `2026-11-01T14:42:45Z` 真跑执行（其 `## Disposition` 逐字 `EVIDENCE-TRANSPORT appended=4` / `COMPLETE present=2` / `UPGRADE-PAIR OK` / `AC239_WRITTEN_THIS_RUN=1 AC239_PRODUCED_BY_DRIVER=1` / `VERIFY-RC 0`）。AC-239 腿在该次运行内产出：

```
{"build_sha":"2a70808c1b2ab30b332b4071d246d4222f12e4b8","ts":"2026-11-01T14:42:45Z","ac":"GOAL-009-AC-239","host":"orangevps","project_root":"/home/yale/quay-verify-upgrade-2a70808c-root","commit_sha":"026b57d50ba64dee227df2958fa70f9bec325cb7","commit_files":["internal/version/ldflags_test.go"],"task_id":"ac239-subagent-session-id-scan","task_status":"done","gate_events":159,"produced_by_driver":true}
```

关键字段：`build_sha=2a70808c1b2a…`、`project_root=/home/yale/quay-verify-upgrade-2a70808c-root`（与 AC-238 记录**逐字相同** ⇒ UPGRADE-PAIR 成立）、`produced_by_driver=true`、`task_status=done`。这正是 `plugin/freshness-producers.json` `_ac239_refresh_shape` 记的形态：「AC-239 无独立命令，唯一刷新路径 = AC-238 那条，且须同时带 `--verify-upgrade` 与 `--ac239-e2e`」。

### ③ 改后读数（同一判据、同一 cwd）

```
$ node --experimental-strip-types plugin/scripts/freshness-producer-coverage-check.ts --delivery-face-distance --from 2a70808c1b2ab30b332b4071d246d4222f12e4b8 --json
state=computed, distance=5, contentCommits=4, contentMerges=1, bookkeepingMerges=2, tip=6a39887fa
```

- `GOAL-009-AC-239`：**d=191 → 5（margin 9 → 195）**。
- `.quay/goal-freshness-margin.json`（`at 2026-11-01T15:34:55Z`）AC-239 `{"d":5,"margin":195,"evidence_ts":"2026-11-01T14:42:45Z","evidence_age_hours":0.87}`。
- 七主体全部在窗口内（AC-238/AC-239/AC-201 由本次运行刷新；其余主体 margin 8 是**别的** subject 的老化，由同轮立案覆盖）。

### ④ 处置结论（可核）

1. **修掉了**（就本 finding 的主体而言）：AC-239 新鲜度 `margin 9 → 195`，d `191 → 5`，载体新增一条 `build_sha=2a70808c1b2a…` 的合格记录，与 AC-238 在**同一 `project_root`** 上成对落账。
2. **机制侧没有新缺陷**：`_ac239_refresh_shape`（AC-239 无独立命令、随 AC-238 一起刷新的单向耦合）本轮按预期工作 —— AC-238 腿成功 ⇒ AC-239 腿一并成功（`AC239_WRITTEN_THIS_RUN=1`）。
3. **无配置改动**：`plugin/freshness-producers.json`（Touches 里那一行）逐项复核结论是「正确、无需变更」—— 本 finding 未引入任何未被 `_ac239_refresh_shape` / `preconditions` 覆盖的新事实，⛔ 不追加运行史。
4. **探针只立案不执行**：产出者由**派发链**（同轮兄弟任务的 worker）执行，探针职责止于立案。

- L_G：该轴仍暗,理由:本次处置仅复核 finding 并确认 AC-239 已由同轮 AC-238 的产出者运行刷新为 d=5/margin 195，未改 packages/ 依赖结构，未运行 archguard 仪器

### ⑤ 本任务 ⛔ 未做的事（逐条，不以沉默代替）

- ⛔ **未重复跑产出者**：同一次 `upgrade-face` 运行已把 AC-238 与 AC-239 一并刷新（②），重跑只会再驱动一个隔离副本缺陷任务（~23min），纯浪费。
- ⛔ 未改 `K`、`goals/`、AC-214/AC-238/AC-239 的 criterion 或 expect、`plugin/probes/freshness-refresh.md` 的阈值。
- ⛔ 未删/未改载体 `.quay/productization-verification.jsonl` 的任何既有行。
- ⛔ 未改 `plugin/freshness-producers.json`（复核后无需变更，见 ④.3）。
- ⛔ 未在 host B 上做任何动作。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `freshness-stale-goal-009-ac-239`（routine `freshness-refresh`，runId `freshness-refresh-1793542937322`）所描述的问题被复核并处置 —— 复核 = ① 旧证据 `6b91fa84…` 的交付面距离独立重算复现 finding 的 `d=191` / `margin=9`；处置 = ② 同轮 AC-238 的产出者运行已把 AC-239 一并刷新（UPGRADE-PAIR）→ ③ 改后 `d=5 / margin=195`。
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案 —— **已修掉**：AC-239 的 margin 由 9 变为 195（③），载体新增 `ts 2026-11-01T14:42:45Z` / `build_sha=2a70808c1b2a…` 的成对记录（②，`project_root=/home/yale/quay-verify-upgrade-2a70808c-root` 与 AC-238 逐字相同）。

## DoD
- [x] 上面的判据实跑通过 —— 改前（①）与改后（③）各用 `delivery_face.command` 的同一实现独立重算一次；`.quay/goal-freshness-margin.json` 与载体记录均逐字核对。
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑 —— 产出者由**派发链**（同轮兄弟任务的 worker）执行，探针职责止于立案（④.4）。

## Touches
- `plugin/freshness-producers.json`
- `tasks/gap-routine-freshness-refresh-freshness-stale-goal-009-ac-239.md`