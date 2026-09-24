---
id: gap-routine-freshness-refresh-stale-goal-009-ac-238
title: "freshness-refresh: Newest AC-238 evidence is build_sha fa1cae20 at ts
  2026-09-19T11:06:09Z, already d=194 of K=200 delivery-face commits behind the
  develop tip; margin/K=0.03 is fa"
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
Newest AC-238 evidence is build_sha fa1cae20 at ts 2026-09-19T11:06:09Z, already d=194 of K=200 delivery-face commits behind the develop tip; margin/K=0.03 is far under the upgrade-face threshold 0.238, so the subject crosses out of the freshness window before a producer started now could land.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1790211057582` · ts `2026-09-24T00:50:57.582Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`upgrade-face`、`verify-upgrade`、`GOAL-009-AC-238`
- 涉及文件：
- `.quay/goal-freshness-margin.json:1`
- `plugin/freshness-producers.json:65`
- `plugin/freshness-producers.json:66`
- `plugin/freshness-producers.json:76`
- `.quay/productization-verification.jsonl:269`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
Verify host B has disk headroom first (`ssh orangevps 'df -h /'`; measured 100% full on 2026-09-19) and only then re-run upgrade-face on host B (--hosts B) against the aged source; if disk is still full this is a human-authorized ops step, not a producer re-run.

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `stale-goal-009-ac-238`（routine `freshness-refresh`，runId `freshness-refresh-1790211057582`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence

**处置 = 【复核为真（①）+ 机制逐环节定位到失败的那一步（②）+ 按 mapping 自己的机制登记该前置（③）】。**
⛔ 不是「已注意到」；也⛔ 不是「证据已刷新」——**本任务没有、也无法刷新 AC-238 的证据**（理由就是 ② 的读数）。

### ① 复核：finding 为真（判据本体重跑 + 独立重算，⛔ 不采信 finding 自报值）

| 量 | finding 自报 | 本任务独立重算 |
|---|---|---|
| AC-238 最新载体记录 | `fa1cae20` @ `2026-09-19T11:06:09Z` | 同值（`.quay/productization-verification.jsonl` 第 269 行逐字） |
| `d`（该 sha → develop tip，交付面） | 194 | `git rev-list --count fa1cae202e02138a983f4118d108aa9fdd73917a..develop -- <10 条路径>` = **194** |
| `margin` / `K` / `margin/K` | 6 / 200 / 0.03 | `200−194` = **6** ⇒ 0.03 |
| 阈值 `(W+I)·R/K` | 0.238 | W=0.38（mapping 实测值）+ I=2h（`.quay/config.yml` `trigger: interval:120m`）+ R=**20** c/h（7 天窗内交付面 clock-hour 最坏桶，当场实测）+ K=200 ⇒ **0.238**，与 finding 逐字一致 |

⇒ `0.03 ≤ 0.238` ⇒ 探针**按自己的规格必然立案**。阈值算术自洽复核：`0.238×200/2.38 = 20` = 上表实测的最坏桶。
交付面路径集按判据**同一规则机械推导**（`packages/quay/package.json` 的 `files` 过滤存在项 + `plugin` + `packages/quay-native/src`，共 10 条，⛔ 不手写清单）。

判据本体实跑（`criterion` 用 YAML 解析器从 `goals/AC-214-交付证据必须新鲜-….md` 的 frontmatter 取出后 `bash` 执行，⛔ 不是引述；cwd = **主检出**，载体是 gitignored 运行产物、只在主检出存在）：

```
freshness GOAL-009-AC-238: 194/200 (margin 6)
EXIT=0
```

**负控制**（谓词能取假）：同一谓词在旧 sha `b29affe9d0b955647c4a215ad6b9fbf0d662ec9f` 上取到 `d=366` ≠ 194 ⇒ 不是恒值。
⚠️ 注意 `EXIT=0` 的含义：该 criterion 只在 `d > K` 时转红，此刻它是**绿的后备闸**（margin 6），⛔ 它**不是**本 finding 的触发器 —— 触发器是探针（见 ② 第 2 行）。

### ② 「失败在哪一步」—— 机制逐环节，断点具名到一步

| 环节 | 机件 | 本次读数 |
|---|---|---|
| 硬回退闸 | goal AC-214 criterion（仅 `d > K` 转红） | **绿**（margin 6）——⛔ 后备，不是触发器 |
| 早警 | `plugin/probes/freshness-refresh.md`（阈值 `(W+I)R/K`） | **立案**（0.03 ≤ 0.238）✓ |
| 立案 | `plugin/scripts/routine-file-gate.ts` 三道闸 | ✓ filed（⚠️ 09-19 那一轮同一 finding 被 **rate 闸**挡下：`rate: 3 routine-filed tasks this window ≥ cap 3`；本轮窗口重置后才立上） |
| FILE-ONLY | 探针不执行产出者 | ✓ 本轮 `filing-round` 逐字 `errors: []` |
| **执行** | **派发链重跑 `upgrade-face`** | ✗ **失败在这一步** |

**断点读数**（用**产出者自己**的 ssh 参数；`ssh_opts` 逐字 = `plugin/scripts/develop-deliver-tgz.sh:183`，
`host_target[B]="orangevps.wan.hwang.men"` 逐字 = 同文件 `:1402`）：

```
$ ssh -o BatchMode=yes -o ConnectTimeout=8 -o ServerAliveInterval=30 -o ServerAliveCountMax=10 \
      yale@orangevps.wan.hwang.men 'df -h /'
yale@orangevps.wan.hwang.men: Permission denied (publickey,password).
rc=255
```

`BatchMode=yes` ⇒ ⛔ 无口令回退；`SSH_AUTH_SOCK` 未设、`ssh-add -l` 报
`Could not open a connection to your authentication agent` ⇒ 也没有 agent 密钥能改变这个结论。
⇒ 产出者的 `scp`（同文件 `:1625` / `:1785`）在**第一步**就被挡住，远端 ⑦ 无从谈起；
**连带**：前置里那条磁盘读数**也复核不了**（复核它本身要先 ssh）。
实测时刻 `2026-09-24`，宿主 = 本工作区驱动主机 `VM-16-5-ubuntu`。
**方向同向的佐证**（⛔ 不单独构成结论）：本载体 291 行中 `ts >= 2026-09-23` 的记录数为 **0**（末条 `2026-09-20T13:50:36Z`）⇒ 本驱动主机上交付面产出者**一条记录都没产出过**。

**纠正一条**（`Requested action` 与磁盘前置里那句复现命令）：短别名 `ssh orangevps 'df -h /'` 在**本机**报
`ssh: Could not resolve hostname orangevps: Temporary failure in name resolution`（rc=255）——本机无 `~/.ssh/config`，
那是与磁盘、与授权都无关的**第三种**失败形态，⛔ 别把它读成网络故障。可复现形式 = 上面那个 FQDN 形式。

⇒ **本 finding 的 `suggestedAction`（先复核盘量、再重跑）在它被写下的那一刻就不可执行**：它假设的
「当场复核盘量」这一步，本身被一条**更早的**前置挡住了。补救是**目标侧人授权动作**
（把本机 `~/.ssh/id_ed25519.pub` 加进 `yale@orangevps.wan.hwang.men` 的 `authorized_keys`，
或改在一台**已被 B 授权**的主机上跑该产出者），⛔ 不是 producer 重跑、⛔ 也不由本仓的例程代做。

### ③ 处置动作：把这条前置按 mapping 自己的机制登记（本任务唯一的改动，commit `f33d7782e`）

`plugin/freshness-producers.json` 的 `upgrade-face.preconditions` 加 **2** 条：

1. **【0 号前置】ssh 授权** —— 排在磁盘前置**之前**、失败得更早；附逐字命令 + `rc=255` + 补救是目标侧人授权；
   并**纠正**短别名复现命令为 FQDN 形式（免后来读者读成网络故障）。
2. **「100% 满」是瞬时读数、已被同一天推翻** —— `2026-09-19T11:06:09Z` 那条记录**落账成功**，
   其自带字段 `isolated_copy:true` / `runtime_replaced:true` / `upgrade_init_rc:0` 只有 ⑦ 的 `cp -a`
   **成功**才可能出现。

本字段本就为该形态存在（文件头 `_comment` 逐字：`preconditions` "exists because 're-run the producer' is not
always a complete remedy"）⇒ ⛔ 不新造字段、⛔ 不动 `wallclock_hours`（改它会移动探针阈值；且本任务
没有测出端到端 W）。

**负控制**（证明 ③-2 那句不是推理）：同一天 `06:10:14Z` 那次 `cp -a` **失败** ⇒ 远端
`NOT-EVALUATED: cp -a '/home/yale/work/meta-cc-aged-ac238-copy' -> '…-097fe2d7-root' failed` +
`VERIFY-RC 1` + `EVIDENCE-ABSENT`，载体**零追加**（`.quay/ac238-20260919/producer-run.log` 逐字；
跑前 md5 `c5a0939f9e717a13e3f66125d24c36ff` / 268 行）⇒ 同一代码路径上，失败无记录、成功有记录。

机械复核：`node --experimental-strip-types plugin/scripts/freshness-producer-coverage-check.ts`
（把 gitignored 的载体与 margin 快照 staged 进 worktree 后跑，跑完即删）
⇒ `PASS — consistent — 7 observed subject(s), 7 registered, margin snapshot 7 subject(s)`。

### ④ 本任务⛔未做的事（逐条，不以沉默代替）

- ⛔ **未跑 `upgrade-face`**：**跑不了**（② 的读数），⛔ 不是没跑；也没有把失败截断在 build 之前。
- ⛔ 未 ssh 到 B 复核盘量：通道就是 ② 断掉的那一步。
- ⛔ 未在 B 上删任何文件：对外、难逆、需人授权。
- ⛔ 未改 `plugin/scripts/develop-deliver-tgz.sh`（不在 Touches）、未改 `goals/`、未改 K、未改 criterion、
  未动两个载体、未改探针。
- ⛔ 未把任务置 `needs-human`：本 AC 的第二个分支（写明失败在哪一步）**已可满足**。

### ⑤ 观察项（⛔ 无发生率读数者不升为前置 —— 硬规则 12）

1. **`--verify-upgrade` 缺 transport 前置**：`worker_preflight_every_host` 的调用点只有
   `develop-deliver-tgz.sh:2868` / `:2883`，**均在 `--verify-ac257` / `--verify-ac258` 分支内**；
   `if [ "${verify_upgrade}" -eq 1 ]` 那一块（`:1853`）**先 `build_develop_tgz` 再进 mode**（按位置判定，硬规则 2）。
   ⇒ 现在起跑它会先花一次 build、然后以 scp 失败收尾，而**不是** AC-258 那套五态具名 verdict。
   ⚠️ 发生率 1（本形态），只记观察、⛔ 不立前置、⛔ 不在本任务扩面（不在 Touches）。
2. 磁盘前置里那句复现命令在**本机**是坏的（② ）——已纠正；⚠️ 它是在**另一台**主机上写下的，
   ⛔ 本任务不据此断言那台机上它也坏。
3. AC-238/AC-239 是**一对**（同一次运行产出、同一 `project_root`）；本任务只处置 AC-238，
   AC-239 由它自己的派发链负责，⛔ 不代裁。
4. **硬回退闸的后果**：criterion 在 margin 6 时仍绿 ⇒ 若该前置长期不解除，约 **6 个交付面提交**后
   AC-238 会因 `d > K` 转红。这是**后果**，⛔ 不是补救。

## Touches
- `plugin/freshness-producers.json`
- `tasks/gap-routine-freshness-refresh-stale-goal-009-ac-238.md`