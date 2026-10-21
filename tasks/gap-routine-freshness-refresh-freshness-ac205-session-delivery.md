---
id: gap-routine-freshness-refresh-freshness-ac205-session-delivery
title: "freshness-refresh: AC-205's newest carrier record is
  2026-10-12T21:59:06Z (evidence_age_hours 207.47, d=198 of K=200); its margin
  of 2 delivery-face commits is below the 18.72-comm"
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
AC-205's newest carrier record is 2026-10-12T21:59:06Z (evidence_age_hours 207.47, d=198 of K=200); its margin of 2 delivery-face commits is below the 18.72-commit advance a producer started now would need, and it is the only one of the 7 tracked subjects under its threshold.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1792589258148` · ts `2026-10-21T13:27:38.148Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`session-delivery`、`GOAL-009-AC-205`
- 涉及文件：
- `plugin/freshness-producers.json:156`
- `.quay/goal-freshness-margin.json:1`
- `.quay/productization-verification.jsonl:360`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
re-run producer session-delivery on a host authorized to B and C (same run as coldstart-face) with --driving-profiles the target gateway recognizes, and only after confirming a live target session whose settings allow inbound

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `freshness-ac205-session-delivery`（routine `freshness-refresh`，runId `freshness-refresh-1792589258148`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/freshness-producers.json`
- `tasks/gap-routine-freshness-refresh-freshness-ac205-session-delivery.md`

## Evidence

**处置 = 复核完毕 + 处置完毕：已有机制在管，失败步骤具名到「哪台机、哪个取值」。⛔ 不是「已注意到」，也⛔ 不是重跑产出者。**

### ① finding 题面复核（读数取自载体，⛔ 不采信快照自报）

| 量 | finding 立案时（13:27:38Z） | 本次复核（2026-10-21） |
|---|---|---|
| AC-205 最新载体记录 | `.quay/productization-verification.jsonl:360`，ts `2026-10-12T21:59:06Z`，build_sha `61a1ebb0600f49269849d18757232fd8dfb28a13`，host `orangevps` | 仍是同一条（`grep -n '"ac":"GOAL-009-AC-205"' … \| tail -1` ⇒ `:360`）⇒ 本轮无新记录 |
| `d`（交付面**内容**距离，K=200） | 198 | **198**（独立重算，见下） |
| `margin = K − d` | 2 | **2** |
| `evidence_age_hours` | 207.47 | 207.47（`.quay/goal-freshness-margin.json`，`at` `2026-10-21T13:27:06Z`） |

独立重算 —— 跑判据与探针的**同一实现** `.delivery_face.command`（⛔ 不手写第二份交付面路径清单；cwd = 本任务 worktree）：

```
node --experimental-strip-types plugin/scripts/freshness-producer-coverage-check.ts \
  --delivery-face-distance --from 61a1ebb0600f49269849d18757232fd8dfb28a13 --json
→ {"state":"computed","distance":198,"contentCommits":195,"contentMerges":3,"bookkeepingMerges":101,"tip":"0dbdc36906afe758a07d5f67e26432efc4efe8d2"}
```

**负控制（判据能取假，硬规则 4）**：同一谓词对 2026-09-20 的旧证据 sha `c80040ad49b335df44269ac07ea829d2a3511843` 干跑 ⇒ `{"state":"computed","distance":737,…}` ≫ K=200 ⇒ 判据在该 sha 上确实会红，**不是恒绿**。两个 sha 都在 develop 上（`git merge-base --is-ancestor <sha> develop` 均 = YES）。

阈值算术（`scan-round` 的 `notes` 逐字）：`R = 8 提交/小时`（近 7 天均值 0.744/h、最坏小时桶 8/h @ 2026-10-14T13:28-14:28Z）、`W = 0.34h`（mapping）、`I = 2.0h`（`.quay/config.yml` 的 `interval:120m`）、`K = 200` ⇒ `(0.34+2.0)*8/200 = 0.0936`；`margin/K = 2/200 = 0.01 ≤ 0.0936` ⇒ **立案成立**（finding 里的 18.72 = `(0.34+2.0)*8`，逐字一致）。

### ② 失败步骤（今天当场用机件量，⛔ 不是推理）

- **可达性**：`ssh -o BatchMode=yes -o ConnectTimeout=8 yale@orangevps.wan.hwang.men true` ⇒ rc=0；`… yale@ad-arm1.wan.hwang.men true` ⇒ rc=0。⇒ `execution_probe`（id `host-b-ssh`）本轮读 `executable`，与 `filing-round` 记录逐字一致 —— **但它只证明可达**。
- **host B ⇒ `no-target`**：`~/.claude/sessions/*.json` 共 **66** 项，逐 pid `kill -0` ⇒ **活 pid = 0**；`pgrep -a -f claude` 空。最新登记项 mtime `2026-10-12 21:59` —— 恰是最后一条 AC-205 记录的时刻 ⇒ 服务过本腿的那条会话已死。
- **host C ⇒ `will-hold`**：选择器条件**全部成立**（`kill -0 3801624` 活；`/proc/3801624/stat` 第 22 字段 `354138895` 与登记项 `procStart` 逐字相等；socket `/run/user/1002/cc-socks/3801624.sock` 与 `3801624.<sha>.key` 都在）⇒ ⑦ **会**选中它。随后用**安装物本身**取判据的直接量：

```
$ node …/plugin/scripts/dist/send-to-session.js --pid 3801624 --precheck
hold-precheck=will-hold
  evidence: /home/yale/.claude/settings.json: defaultMode=<unset> crossSessionInbound=<unset> | /home/yale/work/archguard/.claude/settings.json: defaultMode=<unset> crossSessionInbound=<unset> | /home/yale/work/archguard/.claude/settings.local.json: defaultMode=<unset> crossSessionInbound=<unset>
rc=0
```

（该会话 argv 里也没有 `--permission-mode` / `--settings` 面。）⇒ 发送会带 `--allow-hold` 并落 `held`、**不落账**。

### ③ 结论（AC2 的第二个分支，逐字写明）

- **已有机制在管**：freshness-refresh 每轮机械检出该主体；⑦ 的结局词表 `no-target | no-transcript | send-failed | delivered | held | absent` 六态互不同形（本轮 B=`no-target`、C=`held`）；该前置早已登记在 `plugin/freshness-producers.json` 的 `session-delivery.preconditions`（2026-10-20 反例 + 六态词表，commit `5c253a53b`）。
- **失败在哪一步**：⑦ `find_ac205_target_session` 之后的**会话前置** —— B 无活会话、C 的活会话两键皆无。⛔ 不在 build / scp / install / AC-207 腿（同一次运行的这两条腿 `VERIFY-RC 0` 且其余四条主体落账）。
- **为什么本任务不重跑**：finding 的 Requested action 自己把它列为**条件**（`only after confirming a live target session whose settings allow inbound`），该条件今天为假；重跑只会花 ~20–35 分钟并复现 2026-10-20 的形态（其余四条主体落账、AC-205 零记录）。
- **为什么不在本任务修掉前置**：它落在验证机上、取决于**别的项目**的会话配置；制造/改动它是目标侧的持久状态变更，需人授权（该条目自己的 `preconditions` / `remedy` 已写明）。
- **补救（需人）**：在 `--hosts` 声明的任意一台上持有一个**活且允许入站**的会话（`--permission-mode bypassPermissions` 或 `crossSessionInbound: accept`），然后运行登记面里的那条命令（`producers[].command` 是单一来源，⛔ 不在此复制）。

### ④ 复发读数（为什么这是第 5 次立案）

`.quay/routine-findings.jsonl` 里 AC-205 相关任务立案共 **5** 次：2026-09-20T13:09Z、2026-09-25T03:46Z、2026-09-25T03:49Z、2026-10-21T11:27Z、2026-10-21T13:27Z（本条）。上一次处置（`gap-routine-freshness-refresh-freshness-stale-goal-009-ac-205`）于 `2026-10-21T11:45:54Z` 落 done（commit `fc770b9b6`），本 round 在其后 **1h42m** 再次立案；同日 09:26Z 那轮被 rate 闸拒（`subject recurrence: 15 round(s)`）。⇒ 该主体会以 2 小时节奏持续复发，直到 ② 的前置被满足；这是**已知且已登记**的形态，⛔ 不是新增缺陷。

### ⑤ 代码侧 delta（本任务唯一改动）

`plugin/freshness-producers.json` 的 `session-delivery.preconditions` 末尾新增一条 2026-10-21T13:27Z 复核记录（B 活 pid 0 / C `will-hold` 的逐字读数 + 指向本节，commit `cc5de7c71`）。**为什么这是处置而不是注释**：该文件是探针与人工升级通道**唯一的**前置来源；把它钉在登记面，下一轮读到 `remedy_availability=executable` 的读者（或探针）不会再把「可达」译成「重跑即刷新 AC-205」。

**5b 扫描**：`grep -n '"preconditions"' plugin/freshness-producers.json` ⇒ **2** 处（`session-delivery` 与 `upgrade-face`），两条都各自登记了环境前置；`coldstart-face` 的四条主体最近一次运行（2026-10-20）全部落账（margin 175）⇒ 该形状没有未登记的兄弟实例。

⛔ 未改：`goals/`、K、criterion、`.quay/routine-findings.jsonl`、任何验证机会话配置；未跑产出者（理由见 ③）。
