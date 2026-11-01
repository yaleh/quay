---
id: gap-routine-freshness-refresh-freshness-stale-goal-009-ac-238-79f43e79
title: "freshness-refresh: margin 9 (d=191, evidence_ts 2026-10-22T12:00:12Z,
  age 242.31h) -> margin/K=0.045 <= threshold 0.0714: window would be exhausted
  by tip advance before a producer"
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
margin 9 (d=191, evidence_ts 2026-10-22T12:00:12Z, age 242.31h) -> margin/K=0.045 <= threshold 0.0714: window would be exhausted by tip advance before a producer run finishes

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1793542937322` · ts `2026-11-01T14:22:17.322Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`GOAL-009-AC-238`、`upgrade-face`
- 涉及文件：
- `plugin/freshness-producers.json`
- `.quay/goal-freshness-margin.json`
- `.quay/productization-verification.jsonl`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
re-run upgrade-face on host B (--upgrade-source <aged third-party project>, --driving-profiles <target-gateway profile>)

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `GOAL-009-AC-238` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-01T14:22:17.322Z

## Disposition

**结论（一句话）**：remedy **真跑了**并**成功刷新了该主体** —— AC-238/AC-239 的新鲜度读数从 `d=191 / margin 9` 变为 `d=5 / margin 195`；同一次运行按设计一并刷新 AC-201。⛔ 不是「已注意到」，也不是「re-run 就完事了」：四条前置当场逐条实测、实跑输出逐字记录、改前/改后判据各干跑一次。

### ① 改前读数（干跑判据本体，⛔ 不是引述）

`delivery_face.command` 的**同一实现**独立重算（`--from 6b91fa84b37e9780637f6ac23c81b910f009bd12 --json`）⇒ `state=computed, distance=191, contentCommits=187, contentMerges=4, tip=2a70808c1b2a`；`.quay/goal-freshness-margin.json`（`at 2026-11-01T14:30:06Z`）AC-238 `d=191 / margin=9 / evidence_ts=2026-10-22T12:00:12Z / evidence_age_hours=242.5` ⇒ finding 的 `d` / `margin` / `evidence_ts` / age **逐字复现**（硬规则 2 的零计数配套动作：谓词对真样本命中）。

⚠️ 把两件事分开（硬规则 3b）：**AC-238 自身的判据此刻是绿的**（`AC238_EXIT=0`，载体那条记录各项齐全）；红的是 **AC-214 的新鲜度窗口**（margin 9，即将耗尽）。⇒ 本 finding 的问题是「陈旧」，⛔ 不是「记录不合格」。

### ② remedy 的四条前置：当场逐条实测（⛔ 不引述 preconditions 散文）

| # | 前置 | 实测读数（2026-11-01T14:3xZ） | 判定 |
|---|---|---|---|
| 0 | 本机 → B 的 ssh 授权（BatchMode，无口令回退） | `ssh -o BatchMode=yes -o ConnectTimeout=8 yale@orangevps.wan.hwang.men 'echo PROBE-OK; hostname; df -h /'` ⇒ rc=0 / `PROBE-OK` / `orangevps` / `16G free` | ✅ |
| 1 | aged 源（旧 vendored 布局） | `~/work/meta-cc-aged-ac238-copy/.quay/runtime/bin/` 下 `quay` `quay-native` `quay-native.js` `quay.js` 俱在；`du -sh` = 749M；`.git` 在 | ✅ |
| 2 | 目标机磁盘 | `df -h /` ⇒ `16G free`（749M 隔离副本 ✓） | ✅ |
| 3 | 目标机网关认得的 `--driving-profiles` | `claude-fjdac -p "reply with exactly: MODEL-OK" --model deepseek-v4-pro-anthropic` ⇒ stdout `MODEL-OK` / rc=0（另有非致命 `unrecognized_model` 装饰警告，同 `plugin/freshness-producers.json` 既有注记） | ✅ |

⇒ 四条前置**全部成立** ⇒ 按探针的 `remedy_availability=executable` 真跑一次是**应当**的动作。

### ③ 实跑（跨机，host B）—— 逐字命令与读数

```
$ bash plugin/scripts/develop-deliver-tgz.sh --verify-upgrade \
    --upgrade-source work/meta-cc-aged-ac238-copy --ac239-e2e --hosts B --force \
    --root /data/home/yale/work/quay \
    --driving-profiles /tmp/quay-ac238-producer-79f43e79/profiles.yml

develop-deliver: develop tip = 2a70808c1b2a (2a70808c1b2ab30b332b4071d246d4222f12e4b8)
  → .quay/deliver-worktree-2a70808c1b2a/packages/quay/quay-0.31.0-dev.tgz
  → .quay/deliver-worktree-2a70808c1b2a/packages/quay-native/quay-native-0.31.0-dev.tgz
develop-deliver: B (orangevps.wan.hwang.men) remote stdout persisted → .quay/verify-upgrade-remote-B-2a70808c.log (rc=0)
EVIDENCE-TRANSPORT appended=4 carrier=…/productization-verification.jsonl
develop-deliver: evidence-completeness COMPLETE present=2
develop-deliver: upgrade-pairing UPGRADE-PAIR OK host=orangevps roots=/home/yale/quay-verify-upgrade-2a70808c-root
develop-deliver: --verify-upgrade OK
```

远端 ⑦（升级动作）逐字：`upgrade action: shipped quay-init (config-preserving branch) rc=0`、`post: tasks=103 taskset_stable=1 runtime_replaced=1`、`ac238 record written → …/quay-verify-upgrade-evidence-2a70808c.jsonl`。

远端 ⑦b（AC-239 腿）逐字：`target-profiles: configured (launcher=claude-fjdac model=deepseek-v4-pro-anthropic)`、`go toolchain: /home/yale/go-sdk/bin (go1.24.4)`、`real defect-fix task created: ac239-subagent-session-id-scan`、`driver start: promotion rc=0 worker rc=0`、`poll finished: task_status=done`、`AC239_WRITTEN_THIS_RUN=1 AC239_PRODUCED_BY_DRIVER=1`、`VERIFY-RC 0`。

载体新增 4 条（`ts 2026-11-01T14:42:45Z`）。AC-238/AC-239 两条关键字段：`build_sha=2a70808c1b2ab30b332b4071d246d4222f12e4b8`、`host=orangevps`、`project_root=/home/yale/quay-verify-upgrade-2a70808c-root`；AC-238 另带 `runtime_replaced=true task_list_ok=true`。

### ④ 改后读数（同一判据、同一 cwd）

```
$ bash /tmp/ac214-crit-now.py
freshness GOAL-009-AC-201: 5/200 (margin 195)
freshness GOAL-009-AC-232: 192/200 (margin 8)
freshness GOAL-009-AC-205: 192/200 (margin 8)
freshness GOAL-009-AC-207: 192/200 (margin 8)
freshness GOAL-009-AC-203: 192/200 (margin 8)
freshness GOAL-009-AC-238: 5/200 (margin 195)
freshness GOAL-009-AC-239: 5/200 (margin 195)
CRITERION-EXIT=0
```

- `GOAL-009-AC-238`：**191/200 (margin 9) → 5/200 (margin 195)**；`GOAL-009-AC-239` 同；`GOAL-009-AC-201` 由本次运行按设计一并刷新（187→5，margin 13→195）。
- `.quay/goal-freshness-margin.json`（`at 2026-11-01T15:28:17Z`）：AC-238 `{"d":5,"margin":195,"evidence_ts":"2026-11-01T14:42:45Z","evidence_age_hours":0.76}`。
- 判据整体 **EXIT 0**（七主体全部在窗口内）；目标判据本体复跑：`AC238_EXIT=0`、`AC239_EXIT=0`。

### ⑤ 处置结论（可核）

1. **修掉了**（就本 finding 的主体而言）：AC-238/AC-239 新鲜度 `margin 9 → 195`，d `191 → 5`，载体新增一条 `build_sha=2a70808c1b2a…` 的合格记录；AC-239 在同一 `project_root` 上成对落账（`UPGRADE-PAIR OK`）。
2. **机制侧没有新缺陷**：2026-10-09 之前的阻断点（`verify-deliver-coldstart.sh:1456` 用 shell-入口时代的 flags 调 `bin/quay` 而缺 `init` 子命令）已由 `8d382f8a1` 修复；本轮 ⑦ 逐字 `rc=0` 佐证。
3. **无配置改动**：`plugin/freshness-producers.json`（Touches 里那一行）逐项复核结论是「正确、无需变更」—— 四条 preconditions 本轮逐条复跑均成立，preconditions[0] 结尾的 2026-10-22 注记（「remedy 在本主机可执行」）继续为真，⛔ 不追加运行史（把运行史写进该文件违反它自己的单源原则）。
4. **探针只立案不执行**：本轮 scan-round 逐字 `findings=7` / `remedy_availability.status=executable`（`.quay/routine-findings.jsonl` runId `freshness-refresh-1793542937322`），产出者由**派发链**（本 worker）执行。

- L_G：该轴仍暗,理由:本次只跑跨机产出者并更新载体，未改 packages/ 依赖结构，未运行 archguard 仪器

### ⑥ 本任务 ⛔ 未做的事（逐条，不以沉默代替）

- ⛔ 未改 `K`、`goals/`、AC-214/AC-238/AC-239 的 criterion 或 expect、`plugin/probes/freshness-refresh.md` 的阈值。
- ⛔ 未动其它主体（AC-203/205/207/232）的新鲜度 —— 它们的 margin 本轮读数 8，是**别的** subject 的老化，已由同轮立案覆盖（如 AC-205 `ceacd300-r20261101T142217Z`），不在本任务范围。
- ⛔ 未删/未改载体 `.quay/productization-verification.jsonl` 的任何既有行（只由产出者的 transport 追加：418 → 422 行）。
- ⛔ 未再跑第二次 producer（一次成功即已刷新）。
- ⛔ 未在 host B 上删除任何东西（`~/quay-verify-upgrade-2a70808c*` 是本次运行自己的产物）。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `freshness-stale-goal-009-ac-238`（routine `freshness-refresh`，runId `freshness-refresh-1793542937322`）所描述的问题被复核并处置 —— 复核 = ① 改前读数逐字复现 finding 的 `d=191` / `margin=9` / `evidence_ts=2026-10-22T12:00:12Z`；处置 = ② 四条前置逐条实测（全成立）→ ③ 用映射声明的命令**真跑**一次跨机产出者（`EVIDENCE-TRANSPORT appended=4` / `COMPLETE present=2` / `UPGRADE-PAIR OK` / `VERIFY-RC 0`）→ ④ 改后判据 `d=5 / margin=195`（criterion EXIT 0）。
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案 —— **已修掉**：AC-238/AC-239 的 margin 由 9 变为 195（④），载体新增 `ts 2026-11-01T14:42:45Z` / `build_sha=2a70808c1b2a…` 的两条成对记录（③，`project_root=/home/yale/quay-verify-upgrade-2a70808c-root`），目标判据 `AC238_EXIT=0` / `AC239_EXIT=0`。

## DoD
- [x] 上面的判据实跑通过 —— AC-214 判据在改前（①，margin snapshot + delivery-face distance 干跑）与改后（④，`bash /tmp/ac214-crit-now.py` ⇒ EXIT 0）各干跑一次；remedy 用映射声明的命令真跑一次（③，`VERIFY-RC 0`）。
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑 —— 产出者由**派发链**（本 worker）执行；探针该轮逐字 `remedy_availability.status=executable`，其职责止于立案（⑤.4）。

## Touches
- `plugin/freshness-producers.json`
- `tasks/gap-routine-freshness-refresh-freshness-stale-goal-009-ac-238-79f43e79.md`