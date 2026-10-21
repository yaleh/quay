---
id: gap-routine-freshness-refresh-freshness-stale-goal-009-ac-205-ceacd300
title: "freshness-refresh: AC-205 is already past the window (d=201 > K=200,
  margin -1) with its newest evidence 209.43h old (2026-10-12T21:59:06Z), while
  producer_latest_ts=2026-10-20T10:"
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
AC-205 is already past the window (d=201 > K=200, margin -1) with its newest evidence 209.43h old (2026-10-12T21:59:06Z), while producer_latest_ts=2026-10-20T10:03:31Z shows that run refreshed the other four coldstart subjects (all margin 172) but not this one.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1792596458238` · ts `2026-10-21T15:27:38.238Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`session-delivery`、`GOAL-009-AC-205`
- 涉及文件：
- `.quay/productization-verification.jsonl`
- `plugin/freshness-producers.json`
- `plugin/scripts/verify-deliver-coldstart.sh`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
re-run session-delivery on host B (and C) — but only a live, inbound-permitting session on either host will actually append an AC-205 record

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `freshness-stale-goal-009-ac-205`（routine `freshness-refresh`，runId `freshness-refresh-1792596458238`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/freshness-producers.json`
- `plugin/scripts/verify-deliver-coldstart.sh`
- `tasks/gap-routine-freshness-refresh-freshness-stale-goal-009-ac-205-ceacd300.md`

## Evidence

**处置 = 复核完毕 + 处置完毕：已有机制在管，失败步骤具名到「哪台机、哪个取值」。⛔ 不是「已注意到」；也⛔ 不是重跑产出者（它的前置今天为假）。**

### ① finding 题面复核（读数取自载体 + 判据同一实现，⛔ 不采信快照自报）

| 量 | finding 立案时（15:27:38Z） | 本次复核（2026-10-21T15:33Z） |
|---|---|---|
| AC-205 最新载体记录 | `.quay/productization-verification.jsonl` ts `2026-10-12T21:59:06Z` | 仍是同一条（`grep -n '"ac":"GOAL-009-AC-205"' … \| tail -1` ⇒ `:360`，build_sha `61a1ebb0600f49269849d18757232fd8dfb28a13`，host `orangevps`）⇒ 本轮无新记录 |
| `d`（交付面**内容**距离，K=200） | 201 | **201**（独立重算，见下） |
| `margin = K − d` | −1 | **−1** ⇒ 窗口已越过 |
| `evidence_age_hours` | 209.43 | 209.53（`.quay/goal-freshness-margin.json`，`at` `2026-10-21T15:31:09Z`） |

独立重算 —— 跑判据与探针的**同一实现** `.delivery_face.command`（⛔ 不手写第二份交付面路径清单；cwd = 本任务 worktree）：

```
node --experimental-strip-types plugin/scripts/freshness-producer-coverage-check.ts \
  --delivery-face-distance --from 61a1ebb0600f49269849d18757232fd8dfb28a13 --json
→ {"state":"computed","distance":201,"contentCommits":198,"contentMerges":3,"bookkeepingMerges":101,"tip":"d59ed30ebf16860892d6cd91f2f4a9ba2da11340"}
```

**负控制（判据能取假，硬规则 4）**：同一谓词对 2026-09-20 的旧证据 sha `c80040ad49b335df44269ac07ea829d2a3511843` 干跑 ⇒ `{"state":"computed","distance":740,…}` ≫ K=200 ⇒ 它不是恒绿。

**精确性（⛔ 不把两种「红」混为一谈）**：红的是 **AC-214 的新鲜度窗口**（该主体 margin=−1）；**AC-205 自身的转录判据仍由 2026-10-12 那条记录满足**（host≠本机 ∧ transcript_confirmed=true ∧ shipped_from_installed_artifact=true）。

### ② 失败步骤（今天当场用机件量，⛔ 不是推理）

- **可达性**（15:33Z）：`ssh -o BatchMode=yes -o ConnectTimeout=8 yale@orangevps.wan.hwang.men true` ⇒ rc=0；`… yale@ad-arm1.wan.hwang.men true` ⇒ rc=0 ⇒ `execution_probe`（id `host-b-ssh`）读 `executable` —— 但它**只证明可达**。
- **host B ⇒ `no-target`**：`~/.claude/sessions/*.json` 共 **66** 项；`pgrep -a -x claude` 空；逐登记项取 `pid` 再 `kill -0` ⇒ 活 pid = **0**；最新登记项 mtime `2026-10-12 21:59` —— 恰是最后一条 AC-205 记录的时刻 ⇒ 服务过本腿的那条会话已死。
- **host C ⇒ `will-hold`**：`pid=3801624` 活且选择器条件全部成立（`kill -0` 活；`/proc/3801624/stat` 第 22 字段 `354138895` 与登记项 `procStart` 逐字相等；socket `/run/user/1002/cc-socks/3801624.sock` 与 key `~/.claude/sessions/3801624.4e1ac10ea9502c15e83f501199c461a3771030ff66e3fdd7d05b052e2f2ca56b.key` 都在）⇒ ⑦ **会**选中它。随后用**安装物本身**取判据的直接量：

```
$ node …/plugins/cache/quay/quay/0.9.0/scripts/dist/send-to-session.js --pid 3801624 --precheck
hold-precheck=will-hold
  evidence: /home/yale/.claude/settings.json: defaultMode=<unset> crossSessionInbound=<unset> | /home/yale/work/archguard/.claude/settings.json: defaultMode=<unset> crossSessionInbound=<unset> | /home/yale/work/archguard/.claude/settings.local.json: defaultMode=<unset> crossSessionInbound=<unset>
rc=0
```

（该会话 argv 里也没有 `--permission-mode` / `--settings` 面。）⇒ 发送会带 `--allow-hold` 并落 `held`、**不落账**。

### ③ 结论（AC2 的第二个分支，逐字写明）

- **已有机制在管**：freshness-refresh 每轮机械检出该主体；⑦ 的结局词表 `no-target | no-transcript | send-failed | delivered | held | absent` 六态互不同形（本轮 B=`no-target`、C=`held`）；该前置登记在 `plugin/freshness-producers.json` 的 `session-delivery.preconditions`（2026-10-20 反例 + 六态词表，13:27Z 复核，**本条新增 15:27Z/15:33Z 复核**）。
- **失败在哪一步**：⑦ `find_ac205_target_session` 之后的**会话前置** —— B 无活会话、C 的活会话两键皆无。⛔ 不在 build / scp / install / AC-207 腿。
- **为什么本任务不重跑**：finding 的 Requested action 自己把它列为**条件**（`only a live, inbound-permitting session on either host will actually append an AC-205 record`），该条件今天为假；重跑只会花 ~20–35 分钟并复现 2026-10-20 的形态（其余四条主体落账、AC-205 零记录），而那四条主体当前 margin=172（远在阈值之外）。
- **为什么不在本任务修掉前置**：它落在验证机上、取决于**别的项目**的会话配置（host C 的唯一活会话 cwd=/home/yale/work/archguard；host B 注册表里没有任何活进程）；制造/改动它是目标侧的持久状态变更，需人授权。
- **补救（需人，逐字）**：在 `--hosts` 声明的任意一台上持有一个**活且允许入站**的会话（`--permission-mode bypassPermissions` 或 settings 里 `crossSessionInbound: accept`），然后运行登记面 `producers[].command` 那条命令（单一来源，⛔ 不在此复制）。AC-205 判据要求 `host ≠ 本机` ⇒ 必须在 B 或 C。

### ④ 本次唯一的代码侧 delta

`plugin/freshness-producers.json` 的 `session-delivery.preconditions` 末尾新增 2026-10-21T15:27Z/15:33Z 复核记录（d=201 与负控制 740、B 活 pid 0、C `will-hold` 的逐字读数 + 指向本节）。**为什么这是处置而不是注释**：该文件是探针与人工升级通道**唯一的**前置来源；把它钉在登记面，下一轮读到 `remedy_availability=executable` 的读者不会再把「可达」译成「重跑即刷新 AC-205」，也看得到「AC-214 窗口已越过」这一升级事实。

**5b 扫描**：`grep -n '"preconditions"' plugin/freshness-producers.json` ⇒ **3** 处（`coldstart-face` / `session-delivery` / `upgrade-face`），三条都各自登记了环境前置 ⇒ 该形状没有未登记的兄弟实例。

⛔ 未改：`goals/`、K、criterion、`.quay/routine-findings.jsonl`、任何验证机会话配置；未跑产出者（理由见 ③）。`plugin/scripts/verify-deliver-coldstart.sh` 未改 —— 本轮的失败点不在脚本（六态落痕正确工作），而在它无法控制的外部会话前置。