---
id: gap-routine-freshness-refresh-stale-subject-goal-009-ac-203
title: "freshness-refresh: 28.5% of the window is left (margin 57 of K=200) and
  margin/K is at/below the 0.2925 threshold: at the worst observed delivery-face
  burst (25 commits/h) the rema"
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
28.5% of the window is left (margin 57 of K=200) and margin/K is at/below the 0.2925 threshold: at the worst observed delivery-face burst (25 commits/h) the remaining margin is consumed in 2.34h (2.34*25 = 58.5 > 57), i.e. before a coldstart-face run started now could finish.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1789704102583` · ts `2026-09-18T04:01:42.583Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`coldstart-face`、`develop-deliver-tgz.sh`
- 涉及文件：
- `.quay/productization-verification.jsonl`
- `.quay/goal-freshness-margin.json`
- `plugin/freshness-producers.json`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
re-run coldstart-face on hosts B and C: bash plugin/scripts/develop-deliver-tgz.sh --verify-coldstart --ac207-e2e --hosts "B C" --force --root <main-checkout>

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `stale-subject-goal-009-ac-203`（routine `freshness-refresh`，runId `freshness-refresh-1789704102583`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence

**处置 = 【已修掉】（⛔ 不是观察项、不是「已注意到」）。** 产出者**由本 worker 实跑**（⛔ 不是「别的任务已经跑过」那句模板），判据本体修复前后各逐字干跑一次，谓词在两个方向都取到真样本。

### ① 修复动作（本任务 = 派发链；DoD 第 2 条）

命令逐字（= finding 的 `suggestedAction`，`--root` = 主检出）：

```
bash plugin/scripts/develop-deliver-tgz.sh --verify-coldstart --ac207-e2e --hosts "B C" --force --root /home/yale/work/quay
```

| 量 | 读数 |
|---|---|
| 起止（本地墙钟） | `04:19:12Z` → `04:41:01Z` = **21m49s** ⇒ 映射的 `wallclock_hours: 0.34`（20m36s）**复核成立** |
| 运行日志 | `.quay/ac203-coldstart-rerun-20260918T041912Z.log` |
| host B `orangevps` | `remote verify rc=0 evidence_lines=10`、`evidence-completeness COMPLETE present=6`、`e2e-pairing E2E-PAIR OK` |
| host C `instance-20221019-1509` | `remote verify rc=0 evidence_lines=9`、`evidence-completeness PARTIAL present=5 missing=1 list=GOAL-009-AC-205`、`e2e-pairing E2E-PAIR OK` |
| 末行 | 逐字 `develop-deliver: --verify-coldstart PARTIAL (some hosts transported evidence but are missing expected records …)` |

⚠️ **退出码如实说明**：nohup 后台运行、进程已回收，未直接捕获 `$?`。上面末行是 `verify_coldstart_mode` 中 `partial=1` 分支的打印，该分支源码处为 `exit 2` ⇒ **本次运行按 PARTIAL（2）收场，且唯一缺失项是 host C 的 AC-205**（成因见 ⑤，是登记在册的前置，⛔ 不是本次修复的失败）。远端 stdout 存档 `.quay/verify-coldstart-remote-{B,C}-2d3a6fa3.log`（两机均 `VERIFY-RC 0`，均 `E2E_CLOSURE_AC203_WRITTEN_THIS_RUN=1` / `…AC207_WRITTEN_THIS_RUN=1`，且 `E2E_CLOSURE_AC203_ROOT` 与 `…AC207_ROOT` 逐字相同 ⇒ 闭环自证）。

### ② 判据本体逐字跑（抽取器 = 本仓自己的 `yaml`，⛔ 不手抄、不引述本任务文本）

抽取脚本 `.quay/ac203-verify/extract.mjs`（`createRequire` 加载本仓 `yaml`，取 `goals/AC-214-*.md` 首份 frontmatter 的 `criterion`，原样交 `bash -c`，cwd = 主检出；取出 121 行存 `.quay/ac203-verify/ac214-criterion.txt`）：

```
$ bash -c "$(cat .quay/ac203-verify/ac214-criterion.txt)"     # BEFORE（04:2xZ）
freshness GOAL-009-AC-201: 59/200 (margin 141)
freshness GOAL-009-AC-232: 144/200 (margin 56)
freshness GOAL-009-AC-205: 144/200 (margin 56)
freshness GOAL-009-AC-207: 144/200 (margin 56)
freshness GOAL-009-AC-203: 144/200 (margin 56)     ← 本 finding 的主体
freshness GOAL-009-AC-238: 59/200 (margin 141)
freshness GOAL-009-AC-239: 59/200 (margin 141)
EXIT=0

$ bash -c "$(cat .quay/ac203-verify/ac214-criterion.txt)"     # AFTER（04:4xZ）
freshness GOAL-009-AC-201: 0/200 (margin 200)
freshness GOAL-009-AC-232: 0/200 (margin 200)
freshness GOAL-009-AC-205: 0/200 (margin 200)
freshness GOAL-009-AC-207: 0/200 (margin 200)
freshness GOAL-009-AC-203: 0/200 (margin 200)     ← 主体
freshness GOAL-009-AC-238: 59/200 (margin 141)
freshness GOAL-009-AC-239: 59/200 (margin 141)
EXIT=0
```

stderr 两次皆空；stdout 存档 `.quay/ac203-verify/{before,after}-stdout.txt`。

⚠️ **两次 EXIT 都是 0，这一点必须写明**：本 finding **不是**「判据已红」，而是例程的**提前量**报警（`margin/K = 0.28` 仍在 K 内）。这正是该例程存在的理由 —— 它要在判据转红**之前**把产出者启动起来（此前 5 天越界 4 次，每次都是转红之后才救火）。⇒ 本任务「修好了」的判据**不是**红转绿，而是 **`margin` 从 56 回到 200**（②第二段）。把这个差别说清楚，读者才能判断这条处置是真的有效还是同形。

### ③ 独立重算 `d`（⛔ 不采信 `.quay/goal-freshness-margin.json` 的自报值）+ 谓词双向真样本

交付面路径按判据**同一规则**机械推导（`packages/quay/package.json` 的 `files` ∩ 存在 + `plugin` + `packages/quay-native/src`，共 **10** 条，⛔ 不手写清单）：

| 证据 build_sha | `d = git rev-list --count <sha>..develop -- <paths>` | margin |
|---|---|---|
| `5c55ada8b391`（finding 时的最新） | **144** | **56** — 与快照自报 `d=144` 一致，且逐字复现 finding 的「28.5% / margin 57」 |
| `b29affe9d0b9`（09-17 那批） | 59 | 141 |
| `2d3a6fa35809`（本次修复后的最新） | **0** | **200** |

**三行全部取到真样本** ⇒ 谓词既不是恒红也不是恒绿，且第一行是「对着一个已知为真的样本干跑」那一半（硬规则 2 的零计数配套动作）。

### ④ 「失败在哪一步」——逐条写明（结论是「已修掉」也必须写）

- **检测半边：灵的。** 例程 `04:01:42.583Z` 把本 finding 追加进 `.quay/routine-findings.jsonl`（runId `freshness-refresh-1789704102583`，`kind: finding`，`verdict: act-now`），早于它自己算出的窗口关闭时刻（2.34h）。
- **立案半边：灵的。** 同一 runId 的 `filing-round` 记录依赖 `routine-file-gate.ts` 三道闸机械立案出**本任务**；同轮另 3 条被拒（`stale-subject-goal-009-ac-205` = rate 闸「3 routine-filed tasks this window ≥ cap 3」；`…-207` / `…-232` = dedup 闸「an equivalent finding is already on the board」）⇒ **该闸会拒，不是无条件开火**（硬规则 3b 的负控制）。
- **执行半边：本次由本 worker 执行（①）。** ⚠️ 这是本条与本 finding 四个兄弟任务（`…-freshness-goal-009-ac-203/205/207/238`）**唯一的实质差别**：那四条的处置结论都是「产出者已由**别的**任务的派发链跑过」。**本次立案之后没有任何在飞产出者** —— 上一次冷启动面运行是 `2026-09-15T20:18:36Z`（本次运行启动前 **2 天 8 小时**），期间载体里零条新的冷启动面记录。⇒ **若本任务照抄那句模板，就是一次硬规则 4b 意义上的空转**（该模板与产出者运行日志之间**没有任何机械核对** —— 这一观察已由兄弟任务 `…-ac-239-upgrade-face` 的 §⑥观察项 2 记录在案，本条为它提供了一个**反例**：同一句模板在本次会与事实相反）。
- **产出者自身没有自动触发器 —— 这是机制的真实边界，如实记（⛔ 不因此另立任务、⛔ 不据此提新前置）**：`develop-deliver-tgz.sh` 文件头逐字写着它的 per-merge 触发已随 land 路径迁移而退役；实测全仓库调用点只有 `plugin/scripts/integration-batch-merge.sh:578`（该脚本本身已按 AC48 退役 —— `retired-clause-check.ts:120` 的 `R22` 正钉着它的退役标记）与其自身测试。⇒ **刷新动作今天只有两条路径：人手工，或派发链里的 worker（本条即后者）**。这与 DoD 第 2 条（探针只立案、执行归派发链）是同一件事的两面。

### ⑤ host C 的 AC-205 缺失 = 判据在工作，⛔ 不是本次修复的失败

`evidence-completeness PARTIAL present=5 missing=1 list=GOAL-009-AC-205` 的成因，逐字取自远端日志 `.quay/verify-coldstart-remote-C-2d3a6fa3.log:51-58`：

```
== ⑦ session delivery (AC-205): installed dist/send-to-session.js → same-host target → transcript-verified ==
  target: pid=3801624 sessionId=21725c8c-4629-4d5e-a39e-6f58687d7cdf (name from registry)
  shipped_from_installed_artifact=1 transcript_confirmed=0 evaluated=1 host=instance-20221019-1509
  delivery_outcome=held hold_precheck=will-hold send_rc=0
  NOTE: AC-205 record NOT written (delivery_outcome=held hold_precheck=will-hold transcript_confirmed=0 —
        send exit 0 但 transcript 未物化 ⇒ 不落账，负控制 AC4。三态互不同形：held=被扣下待批 /
        absent=查无此文本 / send-failed=连接失败)
```

同日志 `:57` 逐字贴出了那条扣下记录本体（`type:"system"` / `subtype:"informational"` / `Held peer message — from an unidentified session …`，`cwd /home/yale/work/archguard`）。这与 `plugin/freshness-producers.json` 的 `session-delivery.preconditions` **逐字吻合**（「本前置不由本仓库保证」）。

**AC-205 在 host B 上确实被刷新了**：`GOAL-009-AC-205 | orangevps | 2026-09-18T04:20:31Z | transcript_confirmed: true` ⇒ 与映射「host B 满足 ⇒ 可产出；host C 不满足 ⇒ 产不出」逐字吻合。

⚠️ **一次自解的观察（⛔ 不另立任务，硬规则 12）**：兄弟任务 `gap-routine-freshness-refresh-freshness-goal-009-ac-205` 的 §⑨ 逐字写着「`preconditions` 的直接读数（host C ⇒ `delivery_outcome=held`）只存在于 `bb03f5b96` 的提交信息，任何**已产出载体**的日志里都还没有该形态 —— 下一次产出者运行才会产出该形态的读数」。**本次运行就是那次运行**：该三态形态现已第一次出现在**生产载体**的远端日志里（上面那段逐字）。发生率 1。

### ⑥ 载体侧新增（⛔ 不靠「日志说成功」反推）

`.quay/productization-verification.jsonl`：`md5 009a7042d44b35b6dca5decdbe4b5926`（249 行）→ **`c5a0939f9e717a13e3f66125d24c36ff`（268 行）**，新增 **11** 条 `build_sha=2d3a6fa3…` 记录：

| 主体 | host B（`ts 04:20:31Z`） | host C（`ts 04:32:56Z`） |
|---|---|---|
| **`GOAL-009-AC-203`（本 finding 的主体）** | ✅ ×2（`kind=promotion` / `kind=goal`） | ✅ ×2 |
| `GOAL-009-AC-207` | ✅ `produced_by_driver=true task_status=done commit_sha=89374ca6` | ✅ …`commit_sha=a9d79dd6` |
| `GOAL-009-AC-232` | ✅ | ✅ |
| `GOAL-009-AC-201` | ✅ | ✅ |
| `GOAL-009-AC-205` | ✅ `transcript_confirmed=true` | ⛔（held，见 ⑤） |

⇒ 本 finding 的**同轮兄弟 finding**（`…-207`、`…-232`，被 dedup 闸拒绝、未单独立案）所描述的同一次陈旧，**由本次运行一并刷新**（同为冷启动面主体）—— 这是它们「已有等价 finding 在板上」那句 dedup 理由的实际后果，如实记。

### ⑦ 本任务自身未做的事（⛔ 逐条，不以沉默代替）

- ⛔ **未改 `plugin/freshness-producers.json`**（Touches 里那一行）：逐项复核后**判定无需改** —— `coldstart-face.command` 与 finding 的 `suggestedAction` 同形；`wallclock_hours: 0.34` 与本次实测 **21m49s** 同量级；`subjects` 含 `GOAL-009-AC-203`；`session-delivery.preconditions` 与本次 host C 实测形态**逐字吻合**（⑤）。把本次运行史写进该文件违反它自己的单源原则（其头注释逐字禁止「第二份拷贝」/单源漂移）。
- ⛔ 未改 `goals/`、未改 K、未改 `criterion`/`expect`；未动 `.quay/routine-findings.jsonl`（md5 跑前跑后同为 `c99e8c2c6240a8b3d54704149871513e`）；`.quay/productization-verification.jsonl` 的全部变更**来自产出者自身**（⑥），本任务没有手工写它一行。
- ⛔ 未把 host C 的 AC-205 held 当缺陷另立任务（它是登记在册的前置，⑤）；⛔ 未改 AC-205 的映射条目。
- ⛔ 未自行改探针的 `R` 口径或任何阈值（见 ⑧）。

### ⑧ 未被本任务验证的边界（如实）

- `margin` 是**时点量**：`0/200` 是 `04:4xZ` 读到的值，develop 每前进一个交付面提交它就 −1。本任务**不**声称「窗口此后再不会收窄」（那是判据每轮的职责）。
- 本次修复的**有效期 = 下一个 K 窗口**；刷新动作仍**无自动触发器**（④）⇒ 同一 finding 会在 `margin/K ≤ 阈值` 时**再次出现**，且每次都需要一条派发链任务来执行 —— 这是该例程的设计内形态，⛔ 不是本任务能关闭的缺口。
- **`R` 口径差（探针自己已披露，本任务独立复现，⛔ 不认定为缺陷、不改任何文件）**：本轮 scan-round 的 `notes` 逐字写着 `R=25 is the worst SINGLE-HOUR bucket per the spec, and under the 4h-smoothed worst (18/h) the four filed subjects would NOT fire (thresholds 0.2106/0.2142), so this run is deliberately on the early side`。本任务按探针 §③ 同一方法独立复测交付面速率（近 14 天按桶）⇒ 最坏 **1h = 25/h**（`2026-09-13T10:00Z`）、最坏 **4h = 18/h**、近 7 天均值 **4.54/h** —— **两个数都逐字复现**。⇒ 本 finding 落在两个口径之间的**提前量**一侧，且探针已在自己的 `notes` 里披露该不对称（「高估 R 只导致早报，低估才会丢窗口」）。该口径选择是探针契约 §③「用最坏值」的**逐字执行** ⇒ 本任务**不据此改契约、不改 `.quay/config.yml` 的推导注释、不另立前置**（硬规则 12：给不出发生率的「必须先 X」降为观察项；本条连发生率都不必给 —— 它是契约明文选择）。
- **本任务的处置是「本任务修掉了它」**（⛔ 与四个兄弟任务相反）：产出者由本 worker 在 `04:19:12Z`–`04:41:01Z` 实跑，不是在飞或历史运行。

## Touches
- `plugin/freshness-producers.json`
- `tasks/gap-routine-freshness-refresh-stale-subject-goal-009-ac-203.md`