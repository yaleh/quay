---
id: gap-routine-freshness-refresh-freshness-stale-goal-009-ac-205
title: "freshness-refresh: AC-205's newest evidence (ts 2026-10-12T21:59:06Z) is
  205.43h old and only 3 delivery-face commits from the k=200 window edge; the
  most recent producer run (2026"
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
AC-205's newest evidence (ts 2026-10-12T21:59:06Z) is 205.43h old and only 3 delivery-face commits from the k=200 window edge; the most recent producer run (2026-10-20T10:03:31Z) wrote AC-201/203/207/232 but no AC-205 record, so the session-delivery leg is the one that aged out.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1792582022361` · ts `2026-10-21T11:27:02.361Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`GOAL-009-AC-205`、`session-delivery`
- 涉及文件：
- `.quay/productization-verification.jsonl:360`
- `.quay/goal-freshness-margin.json:1`
- `plugin/freshness-producers.json:156`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
re-run session-delivery (develop-deliver-tgz.sh --verify-coldstart --ac207-e2e --hosts "B C") from a host authorized to B AND C and holding a live inbound-accepting session on the verify host (its declared precondition), with --driving-profiles naming a model the target-host gateway accepts

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `freshness-stale-goal-009-ac-205`（routine `freshness-refresh`，runId `freshness-refresh-1792582022361`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/freshness-producers.json`
- `tasks/gap-routine-freshness-refresh-freshness-stale-goal-009-ac-205.md`

## Evidence

**处置 = 复核完毕 + 处置完毕：已有机制在管，失败步骤具名到「哪台机、哪个取值」**（⛔ 不是「已注意到」）。
本次**没有重跑产出者**，理由不是省略，而是 ④ 的当场读数表明：重跑也只会在同一处失败。

### ① 立案读数 → 复核读数（判据本体逐字跑）

| 量 | finding 立案时 | 本次复核（2026-10-21） |
|---|---|---|
| AC-205 最新载体记录 | carrier `:360`，ts `2026-10-12T21:59:06Z`，build_sha `61a1ebb0600f49269849d18757232fd8dfb28a13` | 仍是同一条（`grep -n '"ac":"GOAL-009-AC-205"' .quay/productization-verification.jsonl \| tail -1` ⇒ `:360`）⇒ 本轮**没有**新记录 |
| `d`（交付面内容距离，K=200） | 197（由 margin 3 反推） | **197**（独立重算，见下） |
| `margin = K − d` | 3 | **3** |
| `evidence_age_hours` | 205.43 | **205.52**（`.quay/goal-freshness-margin.json`，`at` 2026-10-21T11:30:29Z） |

判据本体（`goals/AC-214-交付证据必须新鲜-….md` 的 `criterion:` 折叠块，用 `YAML.parseAllDocuments()[0]` 取出后
`bash` 执行，cwd = **主检出** —— 载体是 gitignored 运行产物，只在主检出存在；stdout 逐字）：

```
freshness GOAL-009-AC-201: 24/200 (margin 176)
freshness GOAL-009-AC-232: 24/200 (margin 176)
freshness GOAL-009-AC-205: 197/200 (margin 3)
freshness GOAL-009-AC-207: 24/200 (margin 176)
freshness GOAL-009-AC-203: 24/200 (margin 176)
freshness GOAL-009-AC-238: 159/200 (margin 41)
freshness GOAL-009-AC-239: 159/200 (margin 41)
EXIT=0
```

`d` 的独立重算（⛔ 不采信快照自报值）—— 跑 `.delivery_face.command`（判据与探针的**同一实现**，
⛔ 不手写第二份交付面路径清单）：

```
node --experimental-strip-types plugin/scripts/freshness-producer-coverage-check.ts \
  --delivery-face-distance --from 61a1ebb0600f49269849d18757232fd8dfb28a13 --json
→ {"state":"computed","distance":197,"contentCommits":194,"contentMerges":3,"bookkeepingMerges":101,...}
```

**负控制（硬规则 4「能取假」）**：同一谓词对 2026-09-14 的旧证据 sha 干跑 ⇒
`{"state":"computed","distance":1059,...}` > K=200 ⇒ 判据在该 sha 上确实会红，**不是恒绿**。
两个 sha 都在 develop 上（`git merge-base --is-ancestor <sha> develop` 均 = YES）。

### ② 载体侧复核 finding 的那半句：「写了 4 条、唯独没写 AC-205」

`.quay/productization-verification.jsonl` 里 `ts` = `2026-10-20T09:48:21Z`（host B）与 `2026-10-20T10:03:31Z`（host C）
的记录集：`GOAL-009-AC-201` / `-203` / `-207` / `-232` 各在册（另有 AC-204/206/234/AC88），
build_sha 全为 `ce13d764f90b79c01b37650a20ef3c1b1b1a2a13`；而 `ac=="GOAL-009-AC-205"` 在该窗口**零条**。
⇒ finding 题面成立，且**不是**「没跑产出者」：那次运行跑了，落账了其余主体。

### ③ 失败步骤（AC 要求写明「失败在哪一步」）—— 逐字来自那次运行的两份远端日志

同一份日志（`.quay/verify-coldstart-remote-B-ce13d764.log` / `.quay/verify-coldstart-remote-C-ce13d764.log`）
的第 ⑦ 段 `== ⑦ session delivery (AC-205): installed dist/send-to-session.js → same-host target → transcript-verified ==`：

- **host B**（`:51-53`）：`NOTE: AC-205 record NOT written (no live same-host target session in ~/.claude/sessions — 缺目标会话≠合格)`，`delivery_outcome=no-target hold_precheck=not-run send_rc=-`
- **host C**（`:51-58`）：找到活会话 `pid=3801624 sessionId=21725c8c-…`（cwd=`/home/yale/work/archguard`），`send_rc=0`，但 `delivery_outcome=held hold_precheck=will-hold transcript_confirmed=0`；held_record 逐字含 `Held peer message … The sending session's permission mode class doesn't match this session's. … or set "crossSessionInbound" to "accept".`

⇒ 失败点 = **⑦ 的 `find_ac205_target_session` + 发送前置**（`plugin/scripts/verify-deliver-coldstart.sh`），
⛔ 不在 build / scp / install / AC-207 / AC-238 / AC-239：同一次运行两腿 `VERIFY-RC 0`，AC-201/203/207/232 全部落账。

⇒ **已有机制在管，且能区分结局**：`AC205_DELIVERY_OUTCOME` 的六态
`no-target | no-transcript | send-failed | delivered | held | absent`。
本轮 host B 落 `no-target`、host C 落 `held` —— 两种**不同形**的失败，⛔ 未被压成同一句「NOT written」。

### ④ 今天当场复核「重跑产出者」的前置（证明它此刻不是一条补救）

| 前置 | 2026-10-21 实测读数 |
|---|---|
| 本机 → host B ssh | `ssh -o BatchMode=yes -o ConnectTimeout=8 yale@orangevps.wan.hwang.men 'df -h /'` ⇒ **rc=0**，`/dev/sda1 96G 80G 17G 84% /` |
| 本机 → host C ssh | 同形 BatchMode ssh ⇒ **rc=0** |
| host B 上活会话 | `ps -eo pid,etime,args \| grep '[c]laude'` ⇒ **零条**（只有本次 ssh 自己）⇒ 此刻重跑，⑦ 仍会是 `no-target` |
| host C 上活会话 | `pid 3801624` 活着（35 天），`~/.claude/settings.json` 里 `permissions.defaultMode` / `crossSessionInbound` **两键皆无** ⇒ precheck 仍是 `will-hold` ⇒ 此刻重跑，⑦ 仍会是 `held` |

⇒ **重跑无法刷新 AC-205**：卡点在这条腿自己的环境前置 —— 验证机上要有一台「**活**且**允许入站**」的会话。
该前置按登记面自己写明「**不由本仓库保证**」（它取决于验证机上别的项目的会话配置）。

⛔ 本任务**没有**去验证机上另起一个长活会话，也⛔ 没有改 C 上 `archguard` 会话的 settings：前者是对另一台机器的
持久状态变更，后者属于别的项目 —— 且 finding 的 Requested action 把该前置列为**运行前提**（"holding a live
inbound-accepting session on the verify host"），⛔ 不是本任务要制造的对象。

**补救（需人）**：在一台 `--hosts` 声明的验证机上持有一个活会话并让它允许入站
（`--permission-mode bypassPermissions` 或 `crossSessionInbound: accept`），然后重跑登记面里的那条命令
（`producers[].command`，逐字单一来源，⛔ 不在此复制第二份）。

### ⑤ 代码侧 delta：把「可达性 ≠ 可执行性」钉进登记面

`plugin/freshness-producers.json`（本任务的 Touches）的 `session-delivery.preconditions` 顶部新增一条：
`execution_probe`（id `host-b-ssh`）的 `executable` 只证明 ssh **可达**，⛔ 不证明这条产出者可执行；
并写清六态词表与 2026-10-20 的逐字反例（host B `no-target` / host C `held`），附「日期是观测、不是常量，引用前当场复核」。

**为什么这是修复而不是注释**：本轮立案记录 `.quay/routine-findings.jsonl:2897` 的
`remedy_availability` 取值为 **`executable`**，而同一轮 AC-205 的补救在结构上不可执行。
一个读者（或下一轮的探针）若把 `executable` 译成「重跑即刷新 AC-205」，就会重复本次的弯路。
该条把它钉在探针唯一的输入面上。

**5b 扫描（同载体内同形点）**：`execution_probe.producers` 三条里只有 `session-delivery` 带有 ssh 可达性覆盖不到的
会话前置；`coldstart-face` 的四条主体在最近一次运行里全部落账（24/200），`upgrade-face` 的前置（aged source /
磁盘）已在它自己的 `preconditions` 与 `_aged_source` 里登记。⇒ 其余条目本轮无需改动。

### ⑥ 未做（如实）

- **未跑产出者**：理由见 ④（跑了也只在 ⑦ 失败，且会在主检出载体留下一条「没有 AC-205」的噪声记录）。
- 未改 `goals/`、未改 K、未改 `.quay/routine-findings.jsonl`、未改 C 上任何会话配置。
- 残留观察项（⛔ 不在本任务 Touches，未修）：`execution_probe` 的取值词表没有「可达但前置未满足」这一态，
  于是 AC-205 类 finding 会被立案成**可派发**的 `ready` 任务。发生率读数（逐字）：
  `.quay/routine-findings.jsonl:2894` 的 rate 拒绝理由含 `subject recurrence: 15 round(s)`。
  本条记为观察项，不阻塞本任务（硬规则 12）。

### ⑦ 判据覆盖（L_T/L_C/L_D/L_G/L_S）

本任务为新鲜度登记面的处置，无产品代码 delta ⇒ 未做 L_D/L_G 测量；L_T 读数即 ① 的判据实跑（EXIT=0，AC-205 margin 3）。
