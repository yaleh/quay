---
id: gap-routine-freshness-refresh-freshness-stale-goal-009-ac-205-ceacd300-r20261101T142217Z
title: "freshness-refresh: margin 13 (d=187, evidence_ts 2026-10-22T14:52:36Z,
  age 239.44h) -> margin/K=0.065 <= threshold 0.0702: window would be exhausted
  before a producer run finishes "
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
margin 13 (d=187, evidence_ts 2026-10-22T14:52:36Z, age 239.44h) -> margin/K=0.065 <= threshold 0.0702: window would be exhausted before a producer run finishes (AC-205 additionally needs a live inbound-allowed session on B or C)

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1793542937322` · ts `2026-11-01T14:22:17.322Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`GOAL-009-AC-205`、`session-delivery`
- 涉及文件：
- `plugin/freshness-producers.json`
- `.quay/goal-freshness-margin.json`
- `.quay/productization-verification.jsonl`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
re-run session-delivery on hosts B C (same command as coldstart-face; AC-205 leg also requires a live inbound-allowed session on B or C)

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `GOAL-009-AC-205` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-01T14:22:17.322Z

## Disposition

**结论（一句话）**：remedy **真跑了**并**成功刷新了该主体** —— AC-205 的新鲜度读数从 `d=192 / margin 8` 变为 `d=0 / margin 200`，载体新增一条 `build_sha=e823c014…` / `transcript_confirmed=true` 的合格记录（host B，第 429 行）。⛔ 不是「已注意到」，也不是「re-run 就完事了」：前置当场逐条实测、实跑输出逐字记录、改前/改后判据各干跑一次。

### ① 改前读数（干跑判据本体，⛔ 不是引述）

`delivery_face.command` 的**同一实现**独立重算（`--from 5a69424613da9790a758a92f9cab258f4ff8f7c8 --json`，cwd = 本任务 worktree）⇒ `state=computed, distance=192, contentCommits=187, contentMerges=5, bookkeepingMerges=116, tip=e823c014ccce`。finding 立案时记 `d=187 / margin=13`；本轮复核时 develop 已再前进 5 个交付面提交 ⇒ `d=192 / margin=8`（`.quay/goal-freshness-margin.json` at `2026-11-01T15:50:30Z` 逐字 `{"d":192,"margin":8,"evidence_ts":"2026-10-22T14:52:36Z"}`）⇒ finding 的 `d` / `margin` / `evidence_ts` **逐字复现**（硬规则 2 零计数配套动作：谓词对真样本命中）。

⚠️ 把两件事分开（硬规则 3b）：**AC-205 自身的判据此刻是绿的**（旧载体记录 `transcript_confirmed=true` 各项齐全）；红的是 **AC-214 的新鲜度窗口**（margin 8，即将耗尽）。⇒ 本 finding 的问题是「陈旧预警」，⛔ 不是「记录不合格」。

### ② remedy 的前置：当场逐条实测（⛔ 不引述 preconditions 散文）

| # | 前置 | 实测读数（2026-11-01T15:4xZ） | 判定 |
|---|---|---|---|
| 0 | 本机 → B/C 的 ssh 授权（BatchMode，无口令回退） | `ssh -o BatchMode=yes -o ConnectTimeout=8 yale@orangevps.wan.hwang.men 'true'` rc=0；`yale@ad-arm1.wan.hwang.men 'true'` rc=0 | ✅ |
| 1 | 目标网关认得的 `--driving-profiles` | `claude-fjdac -p "reply with exactly: MODEL-OK" --model deepseek-v4-pro-anthropic` ⇒ B/C 均 stdout `MODEL-OK` / rc=0（非致命 `unrecognized_model` 装饰警告，同 `plugin/freshness-producers.json` 既有注记）；两机 `claude-fjdac` 版本 B=2.1.309 / C=2.1.274 | ✅ |
| 2 | 活会话前置（AC-205 腿专用） | host B 有活会话 pid 207544（`permissions.defaultMode=bypassPermissions`，sock `/run/user/1000/cc-socks/207544.sock` 存在，procStart 相符）⇒ ⑦ 腿可投递；host C 唯一活会话无 bypassPermissions / crossSessionInbound ⇒ 预期 held | ✅（B 满足） |

⇒ 前置**成立**（AC-205 腿的活会话前置在 host B 成立）⇒ 按探针的 `remedy_availability=executable` 真跑一次是**应当**的动作。

### ③ 实跑（跨机，hosts B C）—— 逐字命令与读数

```
$ bash plugin/scripts/develop-deliver-tgz.sh --verify-coldstart --ac207-e2e --hosts "B C" --force \
    --root /data/home/yale/work/quay \
    --driving-profiles /tmp/quay-ac205-producer-ceacd300/profiles.yml

develop-deliver: develop tip = e823c014ccce
  → .quay/deliver-worktree-e823c014ccce/packages/quay/quay-0.31.0-dev.tgz
  → .quay/deliver-worktree-e823c014ccce/packages/quay-native/quay-native-0.31.0-dev.tgz
develop-deliver: B (orangevps.wan.hwang.men) remote verify rc=0 evidence_lines=10
EVIDENCE-TRANSPORT appended=10 carrier=…/productization-verification.jsonl
develop-deliver: evidence-completeness COMPLETE present=6
develop-deliver: e2e-pairing E2E-PAIR OK host=orangevps roots=/home/yale/quay-verify-coldstart-e823c014-root
develop-deliver: C (ad-arm1.wan.hwang.men) remote verify rc=0 evidence_lines=9
EVIDENCE-TRANSPORT appended=9 carrier=…/productization-verification.jsonl
develop-deliver: evidence-completeness PARTIAL present=5 missing=1 list=GOAL-009-AC-205
develop-deliver: --verify-coldstart PARTIAL (some hosts transported evidence but are missing expected records)
```

远端 ⑦（AC-205 腿）在 host B 逐字：`target: pid=207544 sessionId=ea545acf-…`、`delivery_outcome=delivered hold_precheck=direct send_rc=0` ⇒ `ac205 record written`，落账：

```
{"build_sha":"e823c014ccce21afb344df1f4ca0f438a2f6386f","ts":"2026-11-01T15:58:05Z","ac":"GOAL-009-AC-205","host":"orangevps","shipped_from_installed_artifact":true,"transcript_confirmed":true}
```

关键字段：`build_sha=e823c014…`（本次运行的 develop tip）、`host=orangevps`（B）、`shipped_from_installed_artifact=true`、`transcript_confirmed=true`（安装物 transcript-delivery-check 判 delivered，⛔ 不是 send 的退出码）。

远端 ⑦ 在 host C 逐字：`delivery_outcome=held hold_precheck=will-hold send_rc=0`，held_record 逐字 `Held peer message — from an unidentified session … permission mode class doesn't match this session's … set "crossSessionInbound" to "accept"`。⛔ 这不是缺陷，是判据在工作 —— host C 的活会话无 inbound-allowed 设置 ⇒ ⑦ 腿不落账，与 host B 的「已产出」**三态不同形**（`held` ≠ `delivered`）。

### ④ 改后读数（同一判据、同一 cwd）

```
$ node --experimental-strip-types plugin/scripts/freshness-producer-coverage-check.ts --delivery-face-distance --from e823c014ccce21afb344df1f4ca0f438a2f6386f --json
state=computed, distance=0, contentCommits=0, contentMerges=0, bookkeepingMerges=0, tip=e823c014ccce
```

- `GOAL-009-AC-205`：**d=192 → 0（margin 8 → 200）**。
- 载体 `.quay/productization-verification.jsonl`：422 → 441 行（B 追加 10 条 + C 追加 9 条），其中 AC-205 那条在 **第 429 行**（`build_sha=e823c014…` / `ts 2026-11-01T15:58:05Z`）。
- 反方向对照（⛔ 用于排除「整个快照被重置」这一解释）：同一快照里其余主体由各自证据锚定 —— AC-238/AC-239 已由同轮 upgrade-face 刷新为 margin 195；AC-203/AC-207/AC-232 由本次 coldstart-face 运行按设计一并刷新（B/C 各有 `E2E-PAIR OK`），⛔ 不是 AC-205 一条触发的全盘重置。

### ⑤ 处置结论（可核）

1. **修掉了**（就本 finding 的主体而言）：AC-205 新鲜度 `margin 8 → 200`，d `192 → 0`，载体新增一条 `build_sha=e823c014…` / `transcript_confirmed=true` 的合格记录（③）。
2. **机制侧没有新缺陷**：`session-delivery` 与 `coldstart-face` 共用同一条命令（`_same_run_as`）、AC-205 由同一次运行的 ⑦ `--ac205-session` 腿产出 —— 本轮按预期工作（host B 活会话前置成立 ⇒ `delivered`；host C 无 inbound-allowed 会话 ⇒ `held`，两种结局落痕不同形）。本轮 `--verify-coldstart PARTIAL` 的退出码 2 正是 host C `held` 的**可区分**表达（`missing=1 list=GOAL-009-AC-205`），⛔ 不是机制故障。
3. **无配置改动**：`plugin/freshness-producers.json`（Touches 里那一行）逐项复核结论是「正确、无需变更」—— `session-delivery` 的 `command` / `subjects` / `preconditions` 本轮逐条复跑均成立，⛔ 不追加运行史（把运行史写进该文件违反它自己的单源原则）。
4. **探针只立案不执行**：产出者由**派发链**（本 worker）执行；探针该轮逐字 `remedy_availability.status=executable`，其职责止于立案。

- L_G：该轴仍暗,理由:本次只跑跨机产出者刷新 AC-205 并更新载体，未改 packages/ 依赖结构，未运行 archguard 仪器

### ⑥ 本任务 ⛔ 未做的事（逐条，不以沉默代替）

- ⛔ 未改 `K`、`goals/`、AC-214/AC-205 的 criterion 或 expect、`plugin/probes/freshness-refresh.md` 的阈值。
- ⛔ 未删/未改载体 `.quay/productization-verification.jsonl` 的任何既有行（只由产出者的 transport 追加：422 → 441 行）。
- ⛔ 未再跑第二次 producer（一次成功即已刷新）。
- ⛔ 未改 `plugin/freshness-producers.json`（复核后无需变更，见 ⑤.3）。
- ⛔ 未在 host B/C 上手工删除任何东西（`~/quay-verify-coldstart-e823c014*` 是本次运行自己的产物）。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `freshness-stale-goal-009-ac-205`（routine `freshness-refresh`，runId `freshness-refresh-1793542937322`）所描述的问题被复核并处置 —— 复核 = ① 旧证据 `5a694246…` 的交付面距离独立重算复现 finding 的 `d` / `margin` / `evidence_ts`（立案时 d=187，复核时 develop 已前进 ⇒ d=192 / margin=8）；处置 = ② 前置逐条实测（全成立）→ ③ 用映射声明的命令**真跑**一次跨机产出者（B `VERIFY-RC 0` / `COMPLETE present=6` / AC-205 `delivered`；C `held` 不落账、`PARTIAL missing=AC-205`）→ ④ 改后判据 `d=0 / margin=200`。
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案 —— **已修掉**：AC-205 的 margin 由 8 变为 200（④），载体新增 `ts 2026-11-01T15:58:05Z` / `build_sha=e823c014…` / `transcript_confirmed=true` 的合格记录（③，第 429 行）。

## DoD
- [x] 上面的判据实跑通过 —— AC-214 判据在改前（①，`--from 5a694246…` 干跑 `distance=192`）与改后（④，`--from e823c014…` 干跑 `distance=0`）各干跑一次；remedy 用映射声明的命令真跑一次（③，B `VERIFY-RC 0`）。
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑 —— 产出者由**派发链**（本 worker）执行；探针该轮逐字 `remedy_availability.status=executable`，其职责止于立案（⑤.4）。

## Touches
- `plugin/freshness-producers.json`
- `tasks/gap-routine-freshness-refresh-freshness-stale-goal-009-ac-205-ceacd300-r20261101T142217Z.md`