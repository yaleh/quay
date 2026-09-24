---
id: gap-routine-freshness-refresh-stale-goal-009-ac-239
title: "freshness-refresh: Newest AC-239 evidence shares the same run and
  build_sha (fa1cae20, ts 2026-09-19T11:06:09Z) as AC-238, d=194 of K=200;
  margin/K=0.03 is far under the upgrade-fa"
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
Newest AC-239 evidence shares the same run and build_sha (fa1cae20, ts 2026-09-19T11:06:09Z) as AC-238, d=194 of K=200; margin/K=0.03 is far under the upgrade-face threshold 0.238 and the AC-239 leg has no separate command, so it ages out with AC-238.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1790211057582` · ts `2026-09-24T00:50:57.582Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`upgrade-face`、`verify-upgrade`、`GOAL-009-AC-239`
- 涉及文件：
- `.quay/goal-freshness-margin.json:1`
- `plugin/freshness-producers.json:65`
- `plugin/freshness-producers.json:66`
- `plugin/freshness-producers.json:77`
- `.quay/productization-verification.jsonl:270`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
Same single run as AC-238 — re-running upgrade-face on host B after the disk-headroom check refreshes both subjects in one pass; do not attempt a standalone AC-239 command, none exists.

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `stale-goal-009-ac-239`（routine `freshness-refresh`，runId `freshness-refresh-1790211057582`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence

**处置 = 【复核为真（①）+ 机制逐环节定位到失败的那一步（②）+ 把这个主体**特有**的刷新形态按其自己的机制登记进 mapping（③）】。**
⛔ 不是「已注意到」；也 ⛔ 不是「证据已刷新」——**本任务没有、也无法刷新 AC-239 的证据**（理由 = ②，与同轮兄弟任务 `gap-routine-freshness-refresh-stale-goal-009-ac-238` 同一处断点）。

### ① 复核：finding 为真（独立重算，⛔ 不采信 finding 自报值）

| 量 | finding 自报 | 本任务独立重算 |
|---|---|---|
| AC-239 最新载体记录 | `fa1cae20` @ `2026-09-19T11:06:09Z` | 同值（`.quay/productization-verification.jsonl` 第 270 行逐字；其 `project_root=/home/yale/quay-verify-upgrade-fa1cae20-root` 与第 269 行 AC-238 的**逐字相同** ⇒ finding 的「same run / same build_sha / 同一现场」为真） |
| `d`（该 sha → develop tip，交付面） | 194 | `git rev-list --count fa1cae202e02138a983f4118d108aa9fdd73917a..develop -- <交付面路径>` = **195**（finding 写下后 develop 又前进 1 个交付面提交） |
| `margin` / `K` / `margin/K` | 6 / 200 / 0.03 | `200−195` = **5** ⇒ 0.025 |
| 阈值 `(W+I)·R/K` | 0.238 | W=0.38（mapping 实测值）+ I=2h（`.quay/config.yml:235` `interval:120m`）+ R=**20** c/h（7 天窗内交付面**最坏 clock-hour 桶**，当场实测：390 提交 / 92 个非空小时，最坏桶 = 20）+ K=200 ⇒ **0.238**，与 finding 逐字一致 |

⇒ `0.025 ≤ 0.238` ⇒ 探针**按自己的规格必然立案**，不是误报。
交付面路径集按判据**同一规则**机械推导（`packages/quay/package.json` 的 `files` 逐条 `existsSync` 滤存在项 + `plugin` + `packages/quay-native/src`；本次得 **9** 条 —— `packages/quay/plugin` 写在 `files` 里但盘上不存在，故被同一个滤器滤掉。⛔ 不手写清单）。

判据本体实跑（criterion 用**本仓自己的 `yaml` 包**从 `goals/AC-214-交付证据必须新鲜-四条载体型判据不得-一旦转绿即永久绿.md` 首份 frontmatter 取出，原样交 `bash`；⛔ 不手抄、不引述；cwd = **主检出**，载体是 gitignored 运行产物、只在主检出存在）：

```
freshness GOAL-009-AC-201: 147/200 (margin 53)
freshness GOAL-009-AC-232: 147/200 (margin 53)
freshness GOAL-009-AC-205: 147/200 (margin 53)
freshness GOAL-009-AC-207: 147/200 (margin 53)
freshness GOAL-009-AC-203: 147/200 (margin 53)
freshness GOAL-009-AC-238: 195/200 (margin 5)
freshness GOAL-009-AC-239: 195/200 (margin 5)   ← 本 finding 的主体
EXIT=0
```

⚠️ `EXIT=0` 的含义：该 criterion 只在 `d > K` 时转红，此刻它是**绿的后备闸**（margin 5，与 `.quay/goal-freshness-margin.json` 的 `d:195/margin:5` 自洽）——
⛔ 它**不是**本 finding 的触发器；触发器是探针（② 第 2 行）。若那条 0 号前置长期不解除，约 **5 个交付面提交**后它会转红（后果，⛔ 不是补救）。

### ② 「失败在哪一步」—— 机制逐环节，断点具名到一步

| 环节 | 机件 | 本次读数 |
|---|---|---|
| 硬回退闸 | goal AC-214 criterion（仅 `d > K` 转红） | **绿**（margin 5）—— ⛔ 后备，不是触发器 |
| 早警 | `plugin/probes/freshness-refresh.md`（阈值 `(W+I)R/K`） | **立案**（0.025 ≤ 0.238）✓ |
| 立案 | `plugin/scripts/routine-file-gate.ts` 三道闸 | ✓ filed（`filing-round` 逐字 `errors: []`，`filed:[…ac-238, …ac-239]`） |
| FILE-ONLY | 探针不执行产出者 | ✓ 契约逐字 `⛔ FILE ONLY. DO NOT EXECUTE ANY PRODUCER.` |
| **执行** | **派发链重跑 `upgrade-face`** | ✗ **失败在这一步** —— 与 AC-238 同一步（同一次运行，见 ③(i)） |

**断点读数**（用**产出者自己**的 ssh 参数；`ssh_opts` / `host_target[B]` 逐字取自 `plugin/scripts/develop-deliver-tgz.sh:183` 与 `:1402`）：

```
$ ssh -o BatchMode=yes -o ConnectTimeout=8 yale@orangevps.wan.hwang.men 'df -h /'
yale@orangevps.wan.hwang.men: Permission denied (publickey,password).
rc=255
```

`BatchMode=yes` ⇒ ⛔ 无口令回退 ⇒ 产出者在 `scp`（同文件 `:1625` / `:1785`）第一步就被挡住，远端 ⑦/⑦b 无从谈起。
该 0 号前置（含补救 = 目标侧人授权动作）已由同轮兄弟任务登记进 `plugin/freshness-producers.json` 的 `upgrade-face.preconditions[0]` —— **AC-239 逐字继承它**：AC-239 没有别的刷新路径（③(i)）。
⇒ **本主体这一侧的失败步骤没有独立的新断点**；本轮新增的是 ③ 那两条**AC-239 特有**的形态。

### ③ 处置动作：把这个主体特有的刷新形态登记进 mapping（本任务唯一的改动面，commit `86dcb2578`）

`plugin/freshness-producers.json` 的 `upgrade-face` 条目加 **2** 条：一个**新描述性键** `_ac239_refresh_shape`（按本文件既有约定用 `_` 前缀；`ProducerEntry` 的声明 schema 只要求 `id`/`command`/`wallclock_hours`/`subjects` 四键，`_`-键是非 schema 的说明面 —— 本文件已有 `_wallclock_measured`/`_aged_source`/`_same_run_as` 三个同类先例），以及 `preconditions` 数组里**新增一条**。⛔ 未动 `wallclock_hours`（改它会移动探针阈值，且本任务没测出端到端 W）。

**(i) `_ac239_refresh_shape`（新键）** —— finding 题面那句「the AC-239 leg has no separate command，所以它会随 AC-238 一起老化」的**机器可核版本**：
- **无独立命令**（按位置）：⑦b 的调用点 `verify-deliver-coldstart.sh:8803-8804` 嵌在 `if [ "$UPGRADE_EXISTING" = 1 ]`（同文件 `:8796`）之内；`--ac239-e2e` 在 `develop-deliver-tgz.sh` 里只有两个读数点（`:1743` / `:1826`），两处都在 `verify_upgrade_mode` 函数体内。
  ⚠️ 且它**不是 no-op**（这一点本轮实测纠正了「单独传 = 什么都不做」的直觉读法）：单独传 `--ac239-e2e` 会静默落进**默认交付路径**（同文件 §5 收尾 `:3034-3047`：build → scp → install → serve 验证），那条路径与 ⑦b 无关、照样撞同一个 ssh 墙。
  ⇒ ⛔ 不存在「只刷新 AC-239」的命令；唯一刷新路径 = AC-238 那条，且必须**同时**带 `--verify-upgrade` 与 `--ac239-e2e`。
- **耦合是单向的**（这条 ⛔ 不是好消息）：`transport_evidence_append`（`:1806`）先把取回的整份 evidence **追加进载体**，**之后**才跑 `check_evidence_completeness`（`:1816`，本次声明集 `GOAL-009-AC-238 GOAL-009-AC-239`，见 `:1754`）与 `check_upgrade_pairing`（`:1826`）；这两个判定只改**退出码**（`rc=2` = PARTIAL + `UPGRADE_PAIR_MISSING=1` / `missing=GOAL-009-AC-239`，见 `:1844-1846`），⛔ **不回滚**已追加的记录。
  ⇒ **一次只产出 AC-238 的运行会刷新 AC-238 的 margin，而 AC-239 留在旧读数上**。即：finding 那句「ages out with AC-238」只在**成功**方向上成立；失败方向上二者**不**同进退。⇒ 读到 `--verify-upgrade PARTIAL` 必须读成「AC-239 未刷新」，⛔ 不是「这次没跑」。

**(ii) `preconditions` 新增一条** —— ⑦b 自己那道门，**严格多于 AC-238 侧**（逐条按位置）：`AC239_E2E=1`（`:1660`）∧ `AC238_EVALUATED=1 ∧ AC238_PROJECT_ROOT==$root`（`:1664`，函数头注释逐字：这是「本 AC 防自证的全部机制」）∧ `AC238_RUNTIME_REPLACED=1`（`:1668`）；其后还要求升级后副本 `AC239_PROFILES_STATUS=configured`（`:1686`）、登录 shell 能解析到 `go`（`:1703`）、落地基线 `develop` 非 divergent/absent（`:1735`）。另有 `AC239_POLL_SECS` 默认 **3600s** 墙钟上界（`develop-deliver-tgz.sh:1751`），超时即不写记录。
⇒ 任一不成立就**不写 AC-239 记录**（fail-closed 且取值可区分），而**此时 AC-238 的记录已经落账**（见 (i) 第二条）。⇒ 「re-run the producer」这句话对 AC-239 而言前置严格多于对 AC-238 而言 —— 这正是 `preconditions` 字段存在的理由（文件头 `_comment` 逐字）。

**判定侧双向可核（硬规则 3b 守住，⛔ 不是只测一个方向）** —— 用**真实的 step**跑，夹具在 `/tmp`，⛔ 未碰真实载体：

```
$ node --experimental-strip-types plugin/scripts/develop-deliver-python-steps.ts upgrade-pairing <AC-238-only 夹具>
PARTIAL UPGRADE_PAIR_MISSING=1 host=hostB AC238_roots=['/home/verify/up-root'] AC239_roots=[]        rc=2
$ node --experimental-strip-types plugin/scripts/develop-deliver-python-steps.ts evidence-completeness <同上> "GOAL-009-AC-238 GOAL-009-AC-239"
PARTIAL present=1 missing=1 list=GOAL-009-AC-239                                                     rc=2
```

⇒ **AC-238-only 这个方向（= 恰好会丢掉 AC-239 窗口的那个方向）今天是被挡住的**，不是静默通过。
**覆盖检查**：`freshness-producer-coverage-check.ts` ⇒ `PASS — consistent — 7 observed subject(s), 7 registered, margin snapshot 7 subject(s)`，`rc=0`。
**它的负控制**（证明那条 PASS ⛔ 不是空转）：把 `GOAL-009-AC-239` 从 `subjects` 撤登后重跑 ⇒ `FAIL — 2 finding(s): GOAL-009-AC-239[unregistered], GOAL-009-AC-239[margin_unregistered]`，`rc=1`。

### ④ 本任务⛔未做的事（逐条，不以沉默代替）

- ⛔ **未跑 `upgrade-face`**：**跑不了**（② 的读数，同一个 0 号前置），⛔ 不是没跑；也没有把失败截断在 build 之前。
- ⛔ 未 ssh 到 B 复核盘量/授权：通道就是 ② 断掉的那一步。
- ⛔ 未在 B 上删任何文件、未改 B 上任何东西：对外、难逆、需人授权。
- ⛔ 未改 `plugin/scripts/develop-deliver-tgz.sh`、`plugin/scripts/verify-deliver-coldstart.sh`（**均不在 Touches**）—— ⑤ 的两条观察正是落在它们身上，故只记观察。
- ⛔ 未改 `goals/`、未改 K、未改 criterion、未动两个载体（`.quay/*.jsonl` 只读；实测用夹具走 `/tmp`）、未改探针、未改 AC-238 的任务文件。
- ⛔ 未把任务置 `needs-human`：本 AC 的第二个分支（写明「已有机制在管、失败在哪一步」）**已可满足**。

### ⑤ 观察项（⛔ 无发生率读数者不得升为前置 —— 硬规则 12）

1. **`selfcheck_upgrade_pairing` 的负控制是单侧的**（`develop-deliver-tgz.sh:793-840`）：它有 AC-239-only / different-roots / not-produced-by-driver / empty 四条，**没有 AC-238-only（AC-239 缺席）这一条** —— 而那正是会丢掉 AC-239 窗口的方向。本任务按位置取真实 step 手工跑了它，**今天判对**（上面 `rc=2`），所以这不是「当前坏了」，而是「坏了没有控制能发现」。一条 `printf` 夹具即可补齐（⛔ 需改 `develop-deliver-tgz.sh`，不在 Touches）。**发生率 = 本仓首次实测，n=1 ⇒ 只记观察、⛔ 不立前置、⛔ 本任务不扩面。**
2. **同形态的兄弟实例（硬规则 5b 的产物）**：按位置扫 `develop-deliver-tgz.sh` 全部选项标志，**top-level 解析但只在 mode 函数体内被读**的共 **2** 个 —— `--ac239-e2e`（本主体）与 `--ac207-e2e`（coldstart 面的 AC-207 腿，`:1584` / `:1674`，两处都在 `verify_coldstart_mode()` 内）。⇒ 「单独传该标志不产对应记录」不是 AC-239 独有的形态，是这对脚本的**成簇**形态；本任务只登记自己那一个（AC-207 归它自己的派发链，⛔ 不代裁）。其余 6 个 mode 标志（`--verify-coldstart/-upgrade/-takeover/-adr-flip/-ac257/-ac258`）无此形态。
3. **落账顺序（③(i) 第二条）是个机制层面的观察**：`transport_evidence_append` 先于两个判定 ⇒ 「只刷一半」时载体已被写入。判定侧可区分（PARTIAL + UPGRADE_PAIR_MISSING / missing=…），所以 **硬规则 3b 是守住的**；但**「载体写入了 = 记录已落账」与「本次运行合格」在这里不同形却共用一个载体**。发生率 n=1（本仓首次读数）⇒ 只记观察。可能的补救形态（⛔ 本任务不实施、不推荐具体方案）：把追加挪到两个判定之后，或让 PARTIAL 时对「未配对的那一半」不落账。

## Touches
- `plugin/freshness-producers.json`
- `tasks/gap-routine-freshness-refresh-stale-goal-009-ac-239.md`
