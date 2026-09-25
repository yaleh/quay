---
id: gap-routine-freshness-refresh-freshness-stale-goal-009-ac-201
title: "freshness-refresh: margin 20/K=200 = 10% of the window left, below the
  23.4% the producer+interval can consume at the measured burst rate; newest
  evidence frozen at 2026-09-20T13:5"
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
margin 20/K=200 = 10% of the window left, below the 23.4% the producer+interval can consume at the measured burst rate; newest evidence frozen at 2026-09-20T13:50:36Z (build_sha c80040ad49b3).

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1790303081218` · ts `2026-09-25T02:24:41.218Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`coldstart-face`
- 涉及文件：
- `plugin/scripts/develop-deliver-tgz.sh`
- `.quay/productization-verification.jsonl`
- `.quay/goal-freshness-margin.json`
- `plugin/freshness-producers.json`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
re-run coldstart-face on a host already authorized to B (this host is NOT: ssh BatchMode rc=255) — see _suggestedAction_note

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `freshness-stale-goal-009-ac-201`（routine `freshness-refresh`，runId `freshness-refresh-1790303081218`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence

**处置 = 【复核为真（且更糟）+ 真跑了产出者、按位置定位失败步 + 具名「已有机制在管」并给出它在生产上的正面读数 + 修掉 Touches 内那处真实缺陷】。**
⛔ 不是「已注意到」；也⛔ **不是「已修掉主体」** —— 本主体（`GOAL-009-AC-201` 的载体证据）在本任务结束时**仍是 `c80040ad49b3` / margin 2**：刷新它必须从一台**已被 B 与 C 同时授权**的主机跑，本机不是。

### ① finding 复核为真 —— 判据本体独立重跑（⛔ 不采信 finding 自报值）

判据从 `goals/AC-214-交付证据必须新鲜-四条载体型判据不得-一旦转绿即永久绿.md` 的 frontmatter `criterion` **原样取出**（`createRequire` 加载本仓 `yaml`，交 `bash -c`），cwd = 本任务 worktree，载体以**只读 symlink** 指到生产文件 ⇒ **对主检出零写入**（快照写在 worktree 的 `.quay/` 里）。stdout / stderr 逐字：

```
freshness GOAL-009-AC-201: 198/200 (margin 2)
freshness GOAL-009-AC-203: 198/200 (margin 2)
freshness GOAL-009-AC-205: 198/200 (margin 2)
freshness GOAL-009-AC-207: 198/200 (margin 2)
freshness GOAL-009-AC-232: 198/200 (margin 2)
freshness GOAL-009-AC-238: 246/200 (margin -46)
freshness GOAL-009-AC-239: 246/200 (margin -46)
EXIT=1
stderr: stale evidence: GOAL-009-AC-238:246/200 (margin -46), GOAL-009-AC-239:246/200 (margin -46)
```

⛔ 上表的 `d` 不来自任何快照自报值：交付面路径按判据**同一规则**机械推导（`packages/quay/package.json` 的 `files` ∩ exists + `plugin` + `packages/quay-native/src`，⛔ 不手写清单），对每个 sha 各跑一次 `git rev-list --count <sha>..develop -- <paths>`：

| 量 | 立案时（finding ts `2026-09-25T02:24:41.218Z`） | 处置时（`2026-09-25T04:21:39Z`） |
|---|---|---|
| AC-201 最新载体记录 | `build_sha c80040ad49b3` / `ts 2026-09-20T13:50:36Z` | **同一条**（载体零追加） |
| `d`（K=200） | 180 | **198** |
| `margin = K − d` | **20**（= finding 自报的 10%） | **2** |

**谓词能取假的负控制**（硬规则 2 的零计数半边 —— ⛔ 只做「非零查命中」这一半是错的）：同一谓词对 `develop` tip 自身取到 **0**、对 `fa1cae202`（AC-238 的证据）取到 **246** ⇒ 它既不恒绿也不恒红。
⇒ **finding 成立，且比立案时更糟**：`198/200` = 窗口只剩 1%。

### ② 失败在哪一步 —— **真跑了产出者**（派发链的动作，⛔ not-evaluated 与 blocked 分开取证）

mapping 登记的那条命令**逐字真跑**（⛔ 不是引述）：

```
bash plugin/scripts/develop-deliver-tgz.sh --verify-coldstart --ac207-e2e --hosts "B C" --force --root /data/home/yale/work/quay
```

**20 秒**跑完（`develop tip = 5fd1128a68aa`，`build_date 2026-09-25T12:16:45+08:00`），`rc=1`。日志逐字：

```
develop-deliver: creating build worktree on branch deliver-build-5fd1128a68aa at develop tip: …
  → …/packages/quay/quay-0.13.0-dev.tgz
  → …/packages/quay-native/quay-native-0.13.0-dev.tgz
develop-deliver: B (orangevps.wan.hwang.men) — scp verify-deliver-coldstart.sh + its FULL closure …
develop-deliver: orangevps.wan.hwang.men — closure scp FAILED (flat set: verify-deliver-coldstart.sh + $SCRIPT_DIR siblings + SPEC) ⇒ yale@orangevps.wan.hwang.men: Permission denied (publickey,password).
develop-deliver: B (orangevps.wan.hwang.men) — scp FAILED (NOT-EVALUATED)
develop-deliver: C (ad-arm1.wan.hwang.men) — closure scp FAILED (flat set: …) ⇒ yale@ad-arm1.wan.hwang.men: Permission denied (publickey).
develop-deliver: C (ad-arm1.wan.hwang.men) — scp FAILED (NOT-EVALUATED)
develop-deliver: --verify-coldstart PARTIAL FAILURE (some hosts NOT-EVALUATED — no transport for those hosts)
```

⇒ **失败步 = ssh 传输腿（`ship_verify_closure` 的 flat-set scp）**，⛔ 不是构建、不是工具链、不是交付物、不是远端磁盘。三步按位置：

1. **构建：通过** —— 两个 tgz 均产出（`0.13.0-dev`）。这同时是 `151465ddd`（detached-HEAD 构建回归的修）落地 5 天后的**活体对照**：该步现在不是第一失败步。
2. **传输：失败** —— **B 与 C 同时拒绝**。成因这次**就在运行日志里**（`2>&1` 的那 15 条 ssh/scp 腿，`67a1e3cb5`）⇒ ⛔ 不再需要一条带外手跑 ssh 才定名。
3. **远端 ⑦：未发生** ⇒ 零追加。

**载体 fail-closed 的机器核对（跑前 / 跑后各取一次）**：`.quay/productization-verification.jsonl` = `md5 3617e696d0d374bc140d0938c106b9a1` / **291 行**，两次逐字相同 ⇒ **零追加**（⛔ 与「合格」不同形；硬规则 3b）。

**与声明的可达性探针同值（两条独立通道）**：`plugin/freshness-producers.json` 的 `execution_probe.command` 逐字跑 ⇒ 逐字 `yale@orangevps.wan.hwang.men: Permission denied (publickey,password).`、`rc=255` ⇒ `blocked`（⛔ 不是 `not-evaluated`：这是**明确的授权拒绝**）。

**是回归、⛔ 不是「从未授权」**：同一宿主、同一密钥（`~/.ssh/id_ed25519` mtime `2026-09-16`，**早于** 09-19 那次成功运行 ⇒ 本机侧未轮换）在 `2026-09-19` **成功**跑完了全部跨机传输 ⇒ 变化落在**目标机侧**的 `authorized_keys`，本机侧无任何可修项。

### ③ 已有机制在管 —— 且本轮取到它在**生产**上的正面读数（⛔ 不是「代码存在」）

机制链（逐环，⛔ 只此一条、无第二份）：

`plugin/freshness-producers.json` 的 `execution_probe`（`id: host-b-ssh`，`blocked_pattern: "Permission denied"`，`remedy`）
→ `plugin/probes/freshness-refresh.md` frontmatter 的 `remedy_availability`（声明词表 `[executable, blocked, not-evaluated]` 并写明消费者）
→ `plugin/scripts/probe-routine.ts` ⑥b（机械跑声明的那条可达性探针，取值记进 scan-round 记录的**顶层** `remedy_availability`，⛔ 不与 `inventory`/`notes` 散文混写）+ ⑦（`selectFilings` 带上 `remedy`）
→ `plugin/scripts/routine-file-gate.ts` 的 `remedyGatesProducer` / `gateEscalation`：`blocked` ⇒ 该 finding **只**走人可见通道（`status: needs-human`、标题前缀 `[remedy-blocked]`、体内第一行 `escalationMarkerLine`），**⛔ 绝不进派发候选**，且**同一主体在读数不变时不重复立案**（按身份、不占 rate 窗口）。

**机制在生产上是活的 —— 证据是这条本轮真实落账的 `filing-round`**（`.quay/routine-findings.jsonl`，`ts 2026-09-25T03:49:55.712Z`）：

```
remedy_availability: blocked
filed:     [ …ac-201-coldstart-face, …ac-203-coldstart-face, …ac-205-session-delivery, …ac-207-coldstart-face, …ac-232-coldstart-face ]
escalated: [ 同上五条 ]        ← 五条【全部】走人可见通道
```

**时间次序（这解释了本任务是什么）**：本任务的 finding 由 runId `freshness-refresh-1790303081218` 在 `02:24:41.218Z` 产出；`remedy_availability` 机制的三条提交落在 `03:37:44Z` / `03:41:33Z` / `03:46:00Z`（`0df4c408f` / `6ef04472f` / `b7c77343a`）；上面这条 `filing-round` 在 `03:49:55.712Z`。
⇒ **本任务是【机制落地之前】的产物**：同一次运行把 AC-201 与 AC-238 立成了**可派发** `ready`（正是该机制要关掉的形态）。机制落地后，**同一个主体 `GOAL-009-AC-201` 已被改走人可见通道**（`gap-routine-freshness-refresh-freshness-goal-009-ac-201-coldstart-face`，`status: needs-human`）⇒ 本任务在**处置意义**上已被后继产物接管，且机制按身份**禁止**再升级第二次。
**同族的形**：`…ac-203/205/207/232` 四条 `needs-human` 升级体，与 14 条更早的 `done`（真的重跑并刷新过）。本任务出池后，本族不再有「可派发但本机跑不动」的残留。

**⇒ 结论：机制在管的是【立案形态】，⛔ 不是主体本身。** 主体仍红（margin 2），补救仍在**目标侧且需人授权**。

### ④ 本任务修掉的那一处（Touches 内，且是真实缺陷）

**缺陷**：`execution_probe.remedy.action` 只让「把本机公钥加进 **B** 的 `authorized_keys`」，而该探针 gate 的三条 producer 里有两条（`coldstart-face` / `session-delivery`）在**自己**的 `--hosts` 里声明了 **B 与 C 两台**。只加 B ⇒ 探针读到 `executable`，这两条 producer **仍跑不动** —— 而这正是该机制存在的理由（本文件自己的 `_comment`：`'re-run the producer' is not always a complete remedy`；此前这句话只用在了【前置维】，⛔ 没用在【主机维】上）。

**改动**：`remedy.action` / `remedy.alternative` 改为覆盖**该 finding 自己的 producer 在 `--hosts` 里声明的每一台**（B 与 C），并把今天这条实测写进去当判据。⛔ 不动 schema / consumer / `command`（`command` 的形状被下面那条测试按「必须是 non-interactive ssh」钉住 —— 见 ⑥-1）。提交 `2a67e6416`（本任务 worktree 分支）。

**该文件自己的读者与测试覆盖这条改动**：`plugin/test/freshness-refresh-remedy-availability.test.mjs` **14/14**（含 `DECLARATION` 那条对 remedy 的断言：必须含 `authorized_keys` 且 `host` 必须是 `user@host`）、`plugin/test/routine-file-gate.test.mjs` **10/10**、`freshness-producer-coverage-check.ts --root .` ⇒ `PASS — consistent — 7 observed subject(s), 7 registered`。

### ⑤ 本任务**未**做的事（⛔ 逐条，不以沉默代替）

- ⛔ **未刷新本主体**：本机到 B 与 C 的 ssh 都未授权（`rc=255`）× ⇒ AC-201 的载体证据在本任务结束时**仍是 `c80040ad4` / margin 2**。⛔ 不伪造绿、⛔ 不手写/注入记录。
- ⛔ **未在 B 或 C 上做任何动作**（改 `authorized_keys`、清盘）：目标侧、对外、需人授权。补救 = 把本机 `~/.ssh/id_ed25519.pub` 加进 **B 与 C 两台**的 `authorized_keys`，或改在一台**已被该 producer `--hosts` 全部主机授权**的主机上跑。
- ⛔ **未改已立案的那 5 条 `needs-human` 升级体**：它们体内的补救文本是**立案时刻**对 mapping 的逐字引用（时序快照，⛔ 不是漂移），其 AC/DoD 也原样保留；那 5 条仍只写 B。⚠️ 这一条**有代价、不是「无关」**：**人若只照那 5 条体内的话做（只加 B），coldstart-face / session-delivery 仍跑不动**（见 ④）。⛔ 未改的理由：改它们要重写 5 个**别的任务**的全文（`task_write` 是整体替换）并各加一条 Touches，而机制按身份**禁止**重立同一主体 ⇒ 收益是「同一句话被提前读到」、风险是动到 5 条人可见工单；**故此处选择写明，⛔ 不选择改**。
- ⛔ 未改 `goals/`、未改 `K`、未改 `criterion`/`expect`、未动 `.quay/routine-findings.jsonl`、⛔ **未改 `plugin/scripts/develop-deliver-tgz.sh`**（Touches 里列着，但本 delta 对它**零改动**：它只被**跑**了）。
- ⛔ 未把本任务置 `needs-human`：AC 的第二个分支**已可满足**，⛔ 不拿「需要人授权」当停全局的理由（硬规则 12）。

### ⑥ 观察项（⛔ 无发生率读数者不升为前置 —— 硬规则 12）

1. **探针只读 B 一台，而它 gate 的 producer 有两条要 B 与 C**（`command` 是 single-host argv，其形状被 `freshness-refresh-remedy-availability.test.mjs` 的 `DECLARATION` 判据按「必须是 non-interactive ssh」钉住 ⇒ 改成 multi-host 要同时改 schema + consumer + 那条测试，**不在本任务 Touches 内**）。失败面（**本任务未观测到**，故只记不修）：把 B 授权而 C 未授权时，探针读 `executable` ⇒ 机制会立一条**可派发**的 `ready`，而派发链跑它会在 20 秒内死在 C 的 scp 上 —— 本机制要关掉的形态从**它自己的探针**漏回来。**发生率：0**（B 与 C 今日同时拒绝）。④ 修了 remedy 文本这一半，⛔ 结构那一半留给后续。
2. **本主体会随 develop 前进持续加深**（每 1 交付面提交 ⇒ margin −1；今日 `02:24 → 04:21` 已 `20 → 2`）⇒ 下一轮 `freshness-refresh` 仍会立案（受 rate 闸 ≤3/窗口 约束）。本机无任何产出者能刷新它。
3. **本 finding 的 `suggestedAction` 里的 `_suggestedAction_note` 全仓无定义**（`git log -S` 只命中产出它的那次例程提交）—— 一个指向不存在注释的指针。探针自撰散文的形态问题，⛔ 不在本任务 Touches（探针规格）内，仅记录。
4. **AC-203/205/207/232 与 AC-201 同步老化**（同一次运行产出）：`198/200（margin 2）`，全部已由 ③ 的机制走人可见通道，⛔ 本任务不代裁它们。

## Touches
- `plugin/scripts/develop-deliver-tgz.sh`
- `plugin/freshness-producers.json`
- `tasks/gap-routine-freshness-refresh-freshness-stale-goal-009-ac-201.md`