---
id: gap-routine-freshness-refresh-stale-goal-009-ac-203
title: "freshness-refresh: AC-203's newest evidence (ts 2026-10-09T12:32:43Z,
  81.22h old, d=165) leaves margin/K=0.1750 below the 0.2223 threshold; only the
  coldstart-face producer refresh"
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
AC-203's newest evidence (ts 2026-10-09T12:32:43Z, 81.22h old, d=165) leaves margin/K=0.1750 below the 0.2223 threshold; only the coldstart-face producer refreshes it and it has not run since 2026-10-09.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1791841139196` · ts `2026-10-12T21:38:59.196Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`GOAL-009-AC-203`、`coldstart-face`
- 涉及文件：
- `.quay/goal-freshness-margin.json`
- `plugin/freshness-producers.json`
- `.quay/productization-verification.jsonl`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
re-run coldstart-face on hosts B+C from this host, passing --driving-profiles with a model name the TARGET host's gateway accepts

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `stale-goal-009-ac-203` —— 复核 = ① finding 的三条断言逐条从载体本体复现（最新 `ts 2026-10-09T12:32:43Z` / `d=165` / `margin/K=0.1750`，谓词与逐字读数见 `## Evidence` ①）；处置 = ② 实跑产出者 `coldstart-face`（**B 与 C 两面** `remote verify rc=0`、`E2E_CLOSURE_SELF_EVIDENCED=1`、`rc=2 PARTIAL`、16m09s），AC-203 在两台各落 `build_sha=61a1ebb0600f` 的记录（③）。
- [x] 处置结论可核 —— **修掉**，⛔ 不是「已注意到」：判据本体 AC-203 `165/200 → 0/200`、快照 `margin 35 → 200`（第三方可用同一条载体 + 同一谓词复跑，见 `## Evidence` ⑤）；唯一缺席项 = AC-205@C，其成因是 mapping **已逐字声明、且明确不归本仓库保证**的活会话前置（`delivery_outcome=held`，逐字见 ④）⇒ 「失败在哪一步」也已具名。

## DoD
- [x] 上面的判据实跑通过 —— `## Evidence` ①/③/⑤ 的每一格都是本轮当场取出的读数（载体 / 判据干跑 / 远端日志）；`--for-task gap-routine-freshness-refresh-stale-goal-009-ac-203 --allow-thin` exit 0（选择 0 个测试文件 —— 本任务 delta 不含代码，sibling 任务的同形先例见 `gap-routine-freshness-refresh-stale-goal-009-ac-201`）。
- [x] ⛔ 探针只立案不执行 —— 探针那一侧本轮逐字 `remedyAvailability=executable`（只读，未跑产出者）；产出者由**本任务（派发链一侧）**实跑，命令、rc、逐字远端日志与载体增量全在 `## Evidence` ②/③。

## Evidence

**处置 = 【修掉】：实跑产出者 `coldstart-face`（Requested action 的答复），主体 AC-203 的证据被刷新。**
⛔ 不是「已注意到」。下面每一格都是本轮当场取出的读数。

### ① 复核：finding 的三条断言逐条复现（案由成立，⛔ 非引述）

finding 只给出三个可复现的量。三个都在本轮从**载体本体**重新取出：

| finding 的断言 | 本轮读数 | 复现命令（同一谓词、同一载体） |
|---|---|---|
| 最新证据 `ts 2026-10-09T12:32:43Z`（`81.22h old`） | 最新记录 `ts=2026-10-09T12:32:43Z`，`build_sha=4094d899ca72`，`host=orangevps`，`project_root=/home/yale/quay-verify-coldstart-4094d899-root`；快照 `at=2026-10-12T21:52:44Z` ⇒ 年龄 **81.33h** | `python3` 读 `.quay/productization-verification.jsonl` 中 `ac=="GOAL-009-AC-203"` 的全部 45 条，取 `ts` 最大者 |
| `d=165`（K=200） | `distance=165`（`contentCommits=161` + `contentMerges=4`；80 条记账 merge 被剔除） | `node --experimental-strip-types plugin/scripts/freshness-producer-coverage-check.ts --delivery-face-distance --from 4094d899ca72 --json` |
| `margin/K=0.1750 < 0.2223` | 快照逐字：`{"K":200,"d":165,"evidence_age_hours":81.33,"evidence_ts":"2026-10-09T12:32:43Z","margin":35}` ⇒ **35/200 = 0.1750** | `.quay/goal-freshness-margin.json` 逐字读 |

**谓词不是恒绿的（零计数/正计数的对照）**：同一个 `--delivery-face-distance` 谓词在**旧** sha 上取到 165、
在 7 天窗口上取到 293（`--since "7 days ago"`，`state:"computed"`）⇒ 它确实在数交付面提交，不是恒零也不是恒真。

**`K` 与 `W/I` 的代入（把 finding 的阈值算术拆开，⛔ 不照抄结论）**：`THRESHOLD = (W_p + I) × R / K`
（正本 = `.quay/config.yml` 中 `freshness-refresh` 例程的 trigger 推导 + `plugin/probes/freshness-refresh.md` ②）。
代入 W=0.34（mapping 的 `coldstart-face.wallclock_hours`）、I=2.0（例程 `interval:120m`）、K=200：
`0.2223 × 200 / 2.34 = 19.0/h` ⇒ finding 用的 `R≈19/h` 即探针实测的**最坏小时桶**。
本轮复测该量：近 24h 交付面前进 73 提交（**均值 3.04/h**），单小时桶最大 **14/h**（第 3→4 小时）；
近 7 天 293/168h = **1.74/h**。⇒ finding 的阈值方向是【保守】（高估 R ⇒ 早立案，安全方向，
探针规格逐字写明这个方向是要保的）；⛔ 本任务**不动** R/K/阈值——它们不在 Touches 内，也没有取假判据支持改动。

### ② 处置：实跑产出者（逐字命令 + rc + 载体证据）

命令逐字（`--driving-profiles` 用**目标主机网关认得**的那个文件，⛔ 不是本仓 `.quay/profiles.yml`）：

```
bash plugin/scripts/develop-deliver-tgz.sh --verify-coldstart --ac207-e2e --hosts "B C" \
    --force --root /data/home/yale/work/quay \
    --driving-profiles /data/home/yale/work/quay-driving-profiles-target.yml
```

运行区间 `2026-10-12T21:56:11Z → 22:12:20Z`（**16m09s**，本机 `date -u` 两端读数；日志全文
`.quay/ac203-coldstart-20261012T215611Z.log`，落在工作树内）。**退出码 `rc=2` = PARTIAL**（`develop-deliver-tgz.sh`
的三态：COMPLETE=0 / PARTIAL=2 / NOT-EVALUATED=1）—— ⛔ 读成「跑失败」是错的，逐字理由见 ③。

`--driving-profiles` 用的是**目标主机网关认得**的那一份（`worker-default.model: deepseek-v4-pro-anthropic`）；
其可执行性本轮**当场复核**（⛔ 不是引述 `preconditions` 散文）：

```
$ ssh -o BatchMode=yes -o ConnectTimeout=8 yale@orangevps.wan.hwang.men 'true'   # B ⇒ rc=0
$ ssh -o BatchMode=yes -o ConnectTimeout=8 yale@ad-arm1.wan.hwang.men 'true'     # C ⇒ rc=0
$ ssh … yale@orangevps… 'tr "\0" "\n" < /proc/1154128/environ | grep ANTHROPIC_'
ANTHROPIC_BASE_URL=https://fjbigmodel.fjdac.cn/  ANTHROPIC_DEFAULT_SONNET_MODEL=deepseek-v4-pro-anthropic
$ ssh … yale@ad-arm1…    '… /proc/3801624/environ …'   # 同一网关、同一组模型名
```

⇒ 本 finding 的 remedy-availability = **executable**（与 scan-round 记录的 `executable` 一致），⛔ 不是 `blocked`。

### ③ 载体侧读数：主体 AC-203 在【两台】主机上都被刷新

主检出载体 `.quay/productization-verification.jsonl`：**353 → 372 行（+19）**，`md5 dc6d90ae…` → `db5f8323…`，
`163972 → 170244` bytes。新增记录**全部** `ts > 21:56:11Z`（运行起点），逐条如下（`--force` 语义：整批是本次运行的新记录，
⛔ 不是搬运/手写）。

| ac | host | ts | build_sha | project_root |
|---|---|---|---|---|
| **GOAL-009-AC-203** ×2 | `orangevps`(B) | `2026-10-12T21:59:06Z` | `61a1ebb0600f` | `/home/yale/quay-verify-coldstart-61a1ebb0-root` |
| **GOAL-009-AC-203** ×2 | `instance-20221019-1509`(C) | `2026-10-12T22:06:56Z` | `61a1ebb0600f` | 同上（**同一次运行、同一 `project_root`**） |
| GOAL-009-AC-201 / AC-207 / AC-232 | B 与 C 各一条 | `21:59:06Z` / `22:06:56Z` | `61a1ebb0600f` | 同上 |
| GOAL-009-AC-205 | B | `2026-10-12T21:59:06Z` | `61a1ebb0600f` | — |
| GOAL-009-AC-204 / AC-206 / GOAL-015-AC-234 / AC88 | B 与 C | 同上 | — | — |

远端自证逐字（`plugin/scripts/verify-deliver-coldstart.sh` 的输出，两面各一份，落在
`.quay/verify-coldstart-remote-{B,C}-61a1ebb0.log`）：

```
E2E_CLOSURE_SELF_EVIDENCED=1        E2E_CLOSURE_AC203_WRITTEN_THIS_RUN=1   E2E_CLOSURE_AC207_WRITTEN_THIS_RUN=1
  task_status=done commit_sha=31222768ec53 commit_files=["e2e-marker.txt"] gate_events=1 produced_by_driver=1   (B)
  task_status=done commit_sha=09994cdfcda6 commit_files=["e2e-marker.txt"] gate_events=1 produced_by_driver=1   (C)
  kind=promotion driver_alive=1 carrier_records=1 has_plugin_dir=0 evaluated=1     (AC-203 腿)
  kind=goal      driver_alive=1 carrier_records=1 has_plugin_dir=0 evaluated=1     (AC-203 腿)
VERIFY-RC 0
```

`has_plugin_dir=0` 是本判据的关键位（AC-203 的正文要求「无 plugin 的第三方项目里 driver 真活」）——
⛔ 两台的 e2e 提交都不是本仓库代跑：`produced_by_driver=1` ∧ 提交落在 `project_root` 内。

### ④ `rc=2 (PARTIAL)` 的逐字归因：唯一缺席的是 AC-205，且是【已声明的前置】在起作用

```
develop-deliver: evidence-completeness COMPLETE present=6            ← host B
develop-deliver: evidence-completeness PARTIAL  present=5 missing=1 list=GOAL-009-AC-205   ← host C
develop-deliver: e2e-pairing E2E-PAIR OK host=orangevps             roots=/home/yale/quay-verify-coldstart-61a1ebb0-root
develop-deliver: e2e-pairing E2E-PAIR OK host=instance-20221019-1509 roots=/home/yale/quay-verify-coldstart-61a1ebb0-root
```

C 面 AC-205 的成因**逐字**（来自该腿自己的三态落痕，⛔ 不是推测）：

```
held_record: {"… content":"Held peer message — from an unidentified session [verified pid 786940] …
   not delivered to Claude (1 held). The sending session's permission mode class doesn't match this
   session's. Review it below, or set \"crossSessionInbound\" to \"accept\".", … "cwd":"/home/yale/work/archguard" }
NOTE: AC-205 record NOT written (delivery_outcome=held hold_precheck=will-hold transcript_confirmed=0 …)
```

⇒ 这正是 `plugin/freshness-producers.json` → `session-delivery.preconditions` 第 2 条逐字声明的那件事
（验证机上活会话的 settings 必须带 `permissions.defaultMode=bypassPermissions` 或 `crossSessionInbound=accept`
之一；**该前置不由本仓库保证**，取决于验证机上别的项目的会话配置）。⇒ `rc=2` 不是本机制坏了，
是那条**已声明、且明确不归本仓库管**的前置在正常工作（脚本自己把 held / absent / send-failed 三态区分开）。

### ⑤ 处置后读数（同一谓词、同一载体，⛔ 非结论转述）

判据本体（从 `goals/AC-214-*.md` 的 `criterion:` 折叠块用仓库自己的 `yaml` 解析器逐字取出后跑，
cwd = 主检出，副本落在工作树 `.quay/ev/ac214-criterion.sh`）：

```
before（本轮复核时，产出者尚未运行）:  freshness GOAL-009-AC-203: 165/200 (margin 35)   EXIT=0（判据本体绿，是探针阈值在预警）
after （产出者跑完 + 载体落账后）:     freshness GOAL-009-AC-203:   0/200 (margin 200)  EXIT=0
```

七行逐字（after）：`AC-201 0/200`、`AC-232 0/200`、`AC-205 0/200`、`AC-207 0/200`、**`AC-203 0/200`**、
`AC-238 163/200 (margin 37)`、`AC-239 163/200 (margin 37)` —— 后两条属于**另一条产出者**（`upgrade-face`），
⛔ 不在本任务的对象内，也**不因本次处置而变化**（逐字证明本任务的作用域确实是 AC-203 那一族）。

`.quay/goal-freshness-margin.json`（由判据自己写，`at=2026-10-12T22:19:10Z`）逐字摘录：

```
"GOAL-009-AC-203": {"K":200,"d":0,"evidence_age_hours":0.2,"evidence_ts":"2026-10-12T22:06:56Z","margin":200}
"producer_latest_ts": "2026-10-12T22:06:56Z"
```

对照面（⛔ 拿得出手的反方向读数）：**同一份 mapping 里 AC-238/239 的 `d=163` 没有变** —— 说明本次刷新只动了
`coldstart-face`/`session-delivery` 那一次运行所覆盖的主体，不是「整个快照被重置」。

### ⑥ ⛔ 本任务**未**改 `plugin/freshness-producers.json`，逐条给出理由（不以沉默代替）

该文件在本任务的 `## Touches` 内，但本轮**实跑**没有暴露它任何一处失真：

- **命令行**：mapping 的 `coldstart-face.command` 与本轮逐字执行的命令一致（含 `--driving-profiles <…>` 位），⛔ 无需改。
- **`wallclock_hours: 0.34`（= 20m36s）**：本轮实测 **16m09s**（21:56:11Z→22:12:20Z）——**小于**声明值。
  该量只影响探针阈值，且方向是单向的（mapping 自己的话：W 只会上抬阈值；高估⇒早立案=安全，低估⇒晚立案=丢窗口）。
  三个样本 = 21min（09-18）/ **35.5min（09-20）** / **16.2min（本轮）**⇒ 0.34h 落在中间、且偏保守侧，
  ⛔ 没有取假判据支持改动它（改它 = 对一个阈值单源动手，不是本任务的副产品；且该腿时长由 e2e 驱动、天然可变）。
- **`preconditions`**：本轮踩到的每一条都已在册 —— `--driving-profiles` 的模型名前置（B/C 都满足）、
  `session-delivery` 的活会话/settings 前置（C 不满足 ⇒ 正是它解释 `rc=2`）。⛔ 无新增前置可登记。
- **`subjects`**：AC-203 在 `coldstart-face.subjects` 内（探针正是据此点名它），⛔ 无归属变更。

### ⑦ 处置结论（AC2 的答复）：**修掉**，不是「已注意到」

- finding 的三条断言逐条复现（①）⇒ 案由成立；
- remedy 从本机**可执行**（② 的两台 ssh rc=0 + 目标网关认得的那份 profile）；
- 产出者**实跑成功**，主体 AC-203 在 **B 与 C 两台**都落了 `build_sha=61a1ebb0600f`（= 当前 develop tip）的记录（③）；
- 唯一缺席项 = AC-205 @ C，其成因是 mapping **已逐字声明、且明确不归本仓库保证**的前置（④）；
- 判据本体对 AC-203 从 `165/200` 回到 **`0/200`**，快照 `margin 35 → 200`（⑤）。

### ⑧ 附：本轮**观察**到、但**不**在本任务 Touches 内、因而**未**处置的两条（⛔ 记录，不静默）

1. **`deliver-worktree-*` 孤儿累积（可复核，⛔ 不是推测）**：主检出里现存两个**未被回收**的构建工作树
   `.quay/deliver-worktree-63ffd6a8069f`（198M）与 `.quay/deliver-worktree-cdbe3483c1f0`（197M），
   连同各自的分支 `deliver-build-63ffd6a8069f` / `deliver-build-cdbe3483c1f0`（`git worktree list` 逐字）。
   成因按位置：`plugin/scripts/develop-deliver-tgz.sh:1531` 的分支清扫对「仍被工作树占着的分支」`git branch -D`
   **必然失败**，而该行以 `2>/dev/null || true` 结尾（**失败不可见**）；同函数里 `worktree remove` 只针对
   **当前** develop tip 的那一个 `${wt}`（`:1532`）⇒ 旧 tip 的工作树/分支永远不会被回收。
   ⛔ 本任务**没有**删它们：删共享检出里的工作树可能与其他排队中的生产者运行竞争，且它们不在 Touches 内。
   留给后续立案（对象 = 那两行清扫代码，⛔ 不是本 finding 的主体）。
2. **同一 producer 被同一轮 finding 立成多条可派发任务**：`freshness-refresh-1791841139196` 这一轮
   `filed=[ac-201, ac-203, ac-207]`（`.quay/routine-findings.jsonl` 的 filing-round 记录逐字），
   而这三个主体**同属一条 `coldstart-face` 命令**（`plugin/freshness-producers.json` 的 `subjects[]`）——
   即一次 ~16 分钟的跨机运行可覆盖三条任务。⛔ 立案链目前按**主体**去重/限流，不按**产出者命令**去重。
   本轮实际未浪费（另两条 `ready` 任务在我这次运行期间没有在飞，见 `git worktree list` / `ps` 无对应 worker）；
   但形态是可复现的。⛔ 未改：消费者在 `plugin/scripts/probe-routine.ts` / `routine-file-gate.ts`，**不在 Touches 内**。

## Touches
- `plugin/freshness-producers.json`
- `tasks/gap-routine-freshness-refresh-stale-goal-009-ac-203.md`