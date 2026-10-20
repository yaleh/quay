---
id: gap-routine-freshness-refresh-freshness-goal-009-ac-203-4fab725f
title: "freshness-refresh: 27 delivery-face commits of margin (13.5% of K=200)
  is below the 30.4-commit threshold computed for coldstart-face at the worst
  observed hour (13 c/h) plus one o"
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
27 delivery-face commits of margin (13.5% of K=200) is below the 30.4-commit threshold computed for coldstart-face at the worst observed hour (13 c/h) plus one observation interval; evidence_ts 2026-10-12T22:06:56Z is 179.52h old.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1792489168017` · ts `2026-10-20T09:39:28.017Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`coldstart-face`、`GOAL-009-AC-203`
- 涉及文件：
- `.quay/goal-freshness-margin.json:1`
- `.quay/productization-verification.jsonl`
- `plugin/freshness-producers.json:139`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
re-run coldstart-face on this host against hosts B and C (both ssh-authorized, reachability rc=0) supplying a target-recognized --driving-profiles

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `freshness-goal-009-ac-203`（routine `freshness-refresh`，runId `freshness-refresh-1792489168017`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence

**处置 = 【修掉】：实跑产出者 `coldstart-face`（Requested action 的答复），主体 AC-203 的证据被刷新。**
⛔ 不是「已注意到」。下面每一格都是本轮当场取出的读数。

### ① 复核：finding 的三条断言逐条复现（案由成立，⛔ 非引述）

载体 `.quay/routine-findings.jsonl` 中 runId `freshness-refresh-1792489168017`、findingId `freshness-goal-009-ac-203` 的逐字记录（ts `2026-10-20T09:39:28.017Z`）：

> margin 27 delivery-face commits of margin (13.5% of K=200) is below the 30.4-commit threshold computed for coldstart-face at the worst observed hour (13 c/h) plus one observation interval; evidence_ts 2026-10-12T22:06:56Z is 179.52h old.

三条断言分别从载体本体重新取出：

| finding 的断言 | 本轮读数 | 复现命令（同一谓词、同一载体） |
|---|---|---|
| 最新证据 `ts=2026-10-12T22:06:56Z`（`179.52h old`） | 最新 AC-203 记录 `ts=2026-10-12T22:06:56Z`，`build_sha=61a1ebb0600f49269849d18757232fd8dfb28a13`，`host=instance-20221019-1509`(C)，`project_root=/home/yale/quay-verify-coldstart-61a1ebb0-root`；快照 `at=2026-10-20T09:41:57Z` ⇒ 年龄 **179.58h** | `python3` 读 `.quay/productization-verification.jsonl` 中 `ac=="GOAL-009-AC-203"` 的全部 49 条，取 `ts` 最大者 |
| `d=173`（K=200） | `distance=173`（`contentCommits=171` + `contentMerges=2`；92 条记账 merge 被剔除） | `node --experimental-strip-types plugin/scripts/freshness-producer-coverage-check.ts --delivery-face-distance --from 61a1ebb0600f --json` |
| `margin/K=0.135 < threshold` | 快照逐字：`{"K":200,"d":173,"evidence_age_hours":179.58,"evidence_ts":"2026-10-12T22:06:56Z","margin":27}` ⇒ **27/200 = 0.135** | `.quay/goal-freshness-margin.json` 逐字读 |

**阈值算术代入**（正本 = `plugin/probes/freshness-refresh.md` ②，`THRESHOLD = (W + I) × R / K`）：
`W=0.34`（`coldstart-face.wallclock_hours`）、`I=2.0`（例程 `interval:120m`）、`R=13 c/h`（finding 用的最坏小时桶）、`K=200`：
`(0.34+2.0)×13/200 = 30.42/200 = 0.1521`；`margin/K = 27/200 = 0.135 < 0.1521` ⇒ 立案算术复现成立；
`30.42` 即其标题中的 30.4-commit 阈值。

**R 的独立复测（同一实现，⛔ 不手搓第二份 rev-list）**：对每个小时边界 sha 取
`--delivery-face-distance --from <sha> --tip develop`，相邻边界相减得该小时前进量：
近 7 天合计 **160 提交 / 168h = 0.95 c/h（均值）**，单小时桶最大 **12 c/h**（截至 `2026-10-14T13:46Z` 的那个小时）。
finding 的 R=13 是同一数量级的更坏桶（立案时刻早 7 分钟、窗口右端点不同）⇒ 阈值方向【保守】（高估 R ⇒ 早立案，安全方向）。
⛔ 本任务**不动** R/K/阈值——不在 Touches 内，也没有取假判据支持改动。

### ② 处置：实跑产出者（逐字命令 + rc + 载体证据）

命令逐字（`--driving-profiles` 用**目标主机网关认得**的那个文件，⛔ 不是本仓 `.quay/profiles.yml`）：

```
bash plugin/scripts/develop-deliver-tgz.sh --verify-coldstart --ac207-e2e --hosts "B C" \
    --force --root /data/home/yale/work/quay \
    --driving-profiles /data/home/yale/work/quay-driving-profiles-target.yml
```

可执行性本轮**当场复核**（⛔ 不是引述 `preconditions` 散文）：

- `ssh -o BatchMode=yes -o ConnectTimeout=8 yale@orangevps.wan.hwang.men 'true'` ⇒ **rc=0**（hostname `orangevps`，x86_64）
- `ssh -o BatchMode=yes -o ConnectTimeout=8 yale@ad-arm1.wan.hwang.men 'true'` ⇒ **rc=0**（hostname `instance-20221019-1509`，aarch64）
- 目标网关 `https://fjbigmodel.fjdac.cn/v1/models` 的模型列表**逐字含** `deepseek-v4-pro-anthropic`
  = `--driving-profiles` 文件里的 `worker-default.model` ⇒ 该 profile 是 target-recognized，
  满足 `coldstart-face.preconditions[0]`。

运行区间 `2026-10-20T09:45:28Z → 10:16:31Z`（**31m03s**，本机 `date -u` 两端读数；日志全文
`.quay/ac203-coldstart-20261020T094528Z.log`，落在本工作树内）。
**退出码 `rc=2` = PARTIAL**（脚本三态：COMPLETE=0 / PARTIAL=2 / NOT-EVALUATED=1）——⛔ 读成「跑失败」是错的，
逐字归因见 ③。两台 host 的 `remote verify rc` **都是 0**。

### ③ 载体侧读数：主体 AC-203 在【两台】主机上都被刷新

主检出载体 `.quay/productization-verification.jsonl`：**376 → 394 行（+18，每台 +9）**，
`md5 0d38cb03fcf072adefed93b1110d3dcf` → `e673ea51dfd1478277ced59e46a7157c`。
新增记录**全部** `ts > 09:45:28Z`（运行起点），逐条如下（`--force` 语义：整批是本次运行的新记录，⛔ 不是搬运/手写）：

| ac | host | ts | build_sha |
|---|---|---|---|
| **GOAL-009-AC-203** ×2（`kind=promotion` + `kind=goal`） | `orangevps`(B) | `2026-10-20T09:48:21Z` | `ce13d764f90b` |
| GOAL-009-AC-201 / AC-207 / AC-232 | `orangevps`(B) | `2026-10-20T09:48:21Z` | `ce13d764f90b` |
| GOAL-009-AC-204 / AC-206 / GOAL-015-AC-234 / AC88 | `orangevps`(B) | `2026-10-20T09:48:21Z` | — |
| **GOAL-009-AC-203** ×2（`kind=promotion` + `kind=goal`） | `instance-20221019-1509`(C) | `2026-10-20T10:03:31Z` | `ce13d764f90b` |
| GOAL-009-AC-201 / AC-207 / AC-232 | `instance-20221019-1509`(C) | `2026-10-20T10:03:31Z` | `ce13d764f90b` |
| GOAL-009-AC-204 / AC-206 / GOAL-015-AC-234 / AC88 | `instance-20221019-1509`(C) | `2026-10-20T10:03:31Z` | — |

`ce13d764f90b…` = 本次运行起点的 develop tip。AC-203 的新记录落在 `project_root=/home/yale/quay-verify-coldstart-ce13d764-root`，
`has_plugin_dir=false ∧ driver_alive=1 ∧ carrier_records=1`（AC-203 正文要求的「无 plugin 的第三方项目里 driver 真活」）。
远端自证逐字（`plugin/scripts/verify-deliver-coldstart.sh` 输出，两面各一份，落在
`.quay/verify-coldstart-remote-{B,C}-ce13d764.log`）：

```
E2E_CLOSURE_SELF_EVIDENCED=1   E2E_CLOSURE_AC203_WRITTEN_THIS_RUN=1   E2E_CLOSURE_AC207_WRITTEN_THIS_RUN=1
  kind=promotion driver_alive=1 carrier_records=1 has_plugin_dir=0 evaluated=1      (AC-203 腿)
  kind=goal      driver_alive=1 carrier_records=1 has_plugin_dir=0 evaluated=1      (AC-203 腿)
  task_status=done commit_sha=f3f4955c99a9 commit_files=["e2e-marker.txt"] gate_events=1 produced_by_driver=1  (B)
  task_status=done commit_sha=67d64f46da62 commit_files=["e2e-marker.txt"] gate_events=1 produced_by_driver=1  (C)
VERIFY-RC 0
```

**`rc=2 (PARTIAL)` 的逐字归因：唯一缺席的是 AC-205，且是【已声明的前置】在起作用**（⛔ 与本任务的对象无关）：

```
develop-deliver: evidence-completeness PARTIAL  present=5 missing=1 list=GOAL-009-AC-205   ← B 与 C 各一条
develop-deliver: e2e-pairing E2E-PAIR OK host=orangevps             roots=/home/yale/quay-verify-coldstart-ce13d764-root
develop-deliver: e2e-pairing E2E-PAIR OK host=instance-20221019-1509 roots=/home/yale/quay-verify-coldstart-ce13d764-root
NOTE(B): AC-205 record NOT written (no live same-host target session in ~/.claude/sessions)
NOTE(C): AC-205 record NOT written (delivery_outcome=held hold_precheck=will-hold transcript_confirmed=0 …)
```

这正是 `plugin/freshness-producers.json` → `session-delivery.preconditions` 声明的「验证机上必须有一个
符合前置的活会话」——**不由本仓库保证**。⇒ `rc=2` 是那条已声明前置在正常工作，⛔ 不是本机制坏了。

### ④ 处置后读数（同一谓词、同一载体，⛔ 非结论转述）

判据本体从 `goals/AC-214-*.md` 的 `criterion:` 折叠块用仓库自己的 `yaml` 解析器逐字取出后实跑
（cwd = 主检出，脚本副本 `/tmp/ac214-criterion-from-goal.sh`）：

```
before（产出者运行前，快照 at=2026-10-20T09:41:57Z）:  freshness GOAL-009-AC-203: 173/200 (margin 27)
after （产出者跑完 + 载体落账后，本次实跑）:            freshness GOAL-009-AC-203:   0/200 (margin 200)   EXIT=0
```

七行逐字（after）：`AC-201 0/200`、`AC-232 0/200`、`AC-205 173/200 (margin 27)`、`AC-207 0/200`、
**`AC-203 0/200 (margin 200)`**、`AC-238 135/200 (margin 65)`、`AC-239 135/200 (margin 65)` —— `EXIT=0`。

`.quay/goal-freshness-margin.json`（由判据自己写，`at=2026-10-20T10:16:51Z`）逐字摘录：

```
"GOAL-009-AC-203": {"K":200,"d":0,"evidence_age_hours":0.22,"evidence_ts":"2026-10-20T10:03:31Z","margin":200}
"producer_latest_ts": "2026-10-20T10:03:31Z"
```

对照面（⛔ 拿得出手的反方向读数）：**AC-205 仍为 `173/200 (margin 27)`**（其自身前置未满足），
**AC-238/239 仍为 `135/200 (margin 65)`**（另一条产出者 `upgrade-face`）——说明本次刷新只动了
`coldstart-face` 覆盖的主体，⛔ 不是「整个快照被重置」。

### ⑤ 处置结论（AC2 的答复）：**修掉**，不是「已注意到」

- finding 的三条断言逐条复现（①）⇒ 案由成立；
- remedy 从本机**可执行**（② 两台 ssh rc=0 + 目标网关认得那份 profile）；
- 产出者**实跑完成**，主体 AC-203 在 **B 与 C 两台**都落了 `build_sha=ce13d764f90b`（= 运行起点 develop tip）的记录（③）；
- 唯一缺席项 = AC-205，其成因是 mapping **已逐字声明、且明确不归本仓库保证**的前置（③）；
- 判据本体对 AC-203 从 `173/200` 回到 **`0/200`**，快照 `margin 27 → 200`（④）。

### ⑥ ⛔ 本任务**未**改 `plugin/freshness-producers.json`，逐条给出理由（不以沉默代替）

该文件在 Touches 内，但本轮实跑没有暴露它任何一处失真：

- **命令行**：mapping 的 `coldstart-face.command` 与本轮逐字执行的命令一致（含 `--driving-profiles <…>` 位），⛔ 无需改。
- **`wallclock_hours: 0.34`（= 20m36s）**：本轮实测 **31m03s**（`09:45:28Z→10:16:31Z`）。现有样本 =
  21min（09-18）/ 35.5min（09-20）/ 16.2min（10-12）/ **31.0min（本轮）**；该量**只上抬阈值**
  （高估 ⇒ 早立案 = 安全方向，低估 ⇒ 晚立案），且改它 = 对一个全局阈值单源动手、会移动其它主体的立案点，
  ⛔ 不是本任务的副产品（与上一轮同形处置）。⛔ 本轮**没有**取假判据支持改动它。
- **`preconditions`**：本轮踩到的每一条都已在册 —— `--driving-profiles` 的模型名前置（B/C 均满足）、
  `session-delivery` 的活会话前置（B/C 均不满足 ⇒ 正是它解释 `rc=2`）。⛔ 无新增前置可登记。
- **`subjects`**：AC-203 在 `coldstart-face.subjects` 内，⛔ 无归属变更。

### ⑦ 附：本轮**观察**到、但**不**在本任务 Touches 内、因而**未**处置的两条（⛔ 记录，不静默）

1. **`deliver-worktree-*` 孤儿累积（可复核，⛔ 不是推测）**：`git worktree list` 仍逐字列出
   `.quay/deliver-worktree-63ffd6a8069f`（198M）与 `.quay/deliver-worktree-cdbe3483c1f0`（197M）
   连同分支 `deliver-build-63ffd6a8069f` / `deliver-build-cdbe3483c1f0`；本轮新建的
   `.quay/deliver-worktree-ce13d764f90b` 已被正常回收，但其分支 `deliver-build-ce13d764f90b` 留下
   （清扫发生在每次运行**起点**，只对「仍被工作树占着的分支」失败，见 `develop-deliver-tgz.sh:1531`
   的 `git branch -D … 2>/dev/null || true`）。⛔ 本任务没有删它们（不在 Touches 内，且共享检出里的
   worktree 可能与其他排队中的运行竞争）。留给后续立案。
2. **同一条产出者被同一轮 finding 立成三条可派发任务**：`freshness-refresh-1792489168017` 这一轮
   `filed=[ac-203, ac-207, ac-232]`，而三者同属一条 `coldstart-face` 命令 ⇒ 一次运行即可覆盖三条。
   ⛔ 未改：去重/限流消费者在 `plugin/scripts/probe-routine.ts` / `routine-file-gate.ts`，**不在 Touches 内**。

## Touches
- `plugin/freshness-producers.json`
- `tasks/gap-routine-freshness-refresh-freshness-goal-009-ac-203-4fab725f.md`