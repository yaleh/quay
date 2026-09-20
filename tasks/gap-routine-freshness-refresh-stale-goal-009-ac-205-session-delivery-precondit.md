---
id: gap-routine-freshness-refresh-stale-goal-009-ac-205-session-delivery-precondit
title: "freshness-refresh: AC-205's newest delivery evidence is the same aged
  build_sha 2d3a6fa3 (2026-09-18T04:20:31Z, carrier line 256), d=161 leaving
  margin 39 (0.195) under the 0.2808 "
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
AC-205's newest delivery evidence is the same aged build_sha 2d3a6fa3 (2026-09-18T04:20:31Z, carrier line 256), d=161 leaving margin 39 (0.195) under the 0.2808 threshold; it rides the coldstart-face command line but its registered preconditions (a LIVE session on the verification host whose settings allow inbound) are NOT guaranteed by this repo, so re-running is not by itself a complete remedy.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1789909757223` · ts `2026-09-20T13:09:17.223Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`session-delivery`、`develop-deliver-tgz.sh`、`find_ac205_target_session`、`GOAL-009-AC-205`
- 涉及文件：
- `plugin/freshness-producers.json:49`
- `plugin/freshness-producers.json:54`
- `plugin/scripts/verify-deliver-coldstart.sh:5114`
- `.quay/goal-freshness-margin.json:1`
- `.quay/productization-verification.jsonl:256`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
Re-run session-delivery's shared command (same run as coldstart-face) only on a host whose live session passes send-to-session.ts --pid <pid> --precheck printing hold-precheck=direct; the 2026-09-15 measurement found host C held.

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `stale-goal-009-ac-205-session-delivery-precondition`（routine `freshness-refresh`，runId `freshness-refresh-1789909757223`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence

**处置 = 【复核完毕 + 处置完毕】（⛔ 不是「已注意到」）。两半各自取到可取的假：**
**① 主体已被刷新** —— 读数 / 独立重算 / 负控制见 ①②③；**② finding 独有的那一半**（「重跑本身不是完整补救」）
**不是缺陷，已有机制在管辖、失败步骤具名到一行**，见 ④（同一次运行两台机的逐字日志）。
本节每个读数都附产生它的命令或逐字日志行，可逐条复核。

### ① 立案读数 → 复核读数

| 量 | 立案时（finding ts `2026-09-20T13:09:17.223Z`） | 复核时（`2026-09-20T14:30:43Z`，develop tip `812428b76`） |
|---|---|---|
| AC-205 最新载体记录 | `2d3a6fa3580947889d42f8234e9d2fe389386f18` @ `2026-09-18T04:20:31Z`（carrier line 256，逐字已核） | `c80040ad49b335df44269ac07ea829d2a3511843` @ `2026-09-20T13:23:10Z`（carrier line 279，`host:orangevps`） |
| `d`（交付面提交距离，K=200） | **161**（finding 自报）→ 本次独立重算 **163** | **2** |
| `margin = K − d` | **39** | **198** |
| `margin/K` vs 阈值 0.2808 | **0.195 ≤ 0.2808** ⇒ 立案 | **0.99 > 0.2808** ⇒ 情形已消失 |

阈值算术的可核来源（探针自测，逐字取自 `scan-round` 的 `notes`）：
`filed AC-203/205/207/232 (margin 39, fraction 0.195 <= threshold 0.2808)`，代入
`(W_p + I) × R / K = (0.34 + 2.0) × 24 / 200 = 0.2808`（W 读 `plugin/freshness-producers.json:52`，
I 读 `.quay/config.yml` 的 `interval:120m`；R 由探针当场实测，⛔ 不采 config.yml 注释里那 18 ——
这正是探针规格 ③ 要求「自己测 R」的理由）。
**取证层级如实标注**：`R=24` 是由探针自报的 `threshold=0.2808` **反解**出的（`0.2808 × 200 / 2.34`），
⛔ 不是逐字读数 —— `scan-round` 载体记录的键集里**没有** `r`（逐字核过：
`ts/kind/routine/probe/role/runId/findings/malformed/shards/inventory/notes/exit/durationMs`）。
这不影响本节任一结论（`margin` 与 `d` 都是逐字读数、并经 ② 独立重算），只标注这一项的取证层级。

### ② `d` 独立重算（⛔ 不采信 finding / 快照的自报值），且谓词能取假

路径集按判据同一规则**机械推导**（`packages/quay/package.json` 的 `files` 过滤存在项 + `plugin` + `packages/quay-native/src`，
共 **10** 条；⛔ 不手写清单）。谓词逐字 = `git rev-list --count <sha>..develop -- <paths>`，cwd = 主检出：

```
c80040ad49b3  (post, AC-205 最新记录) = 2     ← 与判据 stdout 的 `2/200` 一致
2d3a6fa35809  (pre, 【负控制】)        = 163   ← 同一谓词在旧 sha 上取到 163 ⇒ 不是恒绿
git merge-base --is-ancestor c80040ad4 develop ⇒ YES（血缘成立，⛔ 不是孤立提交）
```

判据本体逐字跑（criterion 用 YAML 解析器从 `goals/AC-214-交付证据必须新鲜-四条载体型判据不得-一旦转绿即永久绿.md`
的 frontmatter `criterion:` 取出后 `bash` 执行，⛔ 不是引述；cwd = **主检出** —— 载体
`.quay/productization-verification.jsonl` 是 gitignored 运行产物、**只在主检出存在**，本任务 worktree 里没有它；
stdout 逐字，stderr 空）：

```
freshness GOAL-009-AC-201: 2/200 (margin 198)
freshness GOAL-009-AC-232: 2/200 (margin 198)
freshness GOAL-009-AC-205: 2/200 (margin 198)   ← 本 finding 的主体
freshness GOAL-009-AC-207: 2/200 (margin 198)
freshness GOAL-009-AC-203: 2/200 (margin 198)
freshness GOAL-009-AC-238: 50/200 (margin 150)
freshness GOAL-009-AC-239: 50/200 (margin 150)
EXIT=0
```

### ③ 谁刷的：正是 finding 自己点名的那条【共享命令行】的那一次运行，由【派发链】执行，⛔ 不是例程

时间线（每条都来自生产落痕的 `ts` / 文件名 / `git log`，可逐条复核）：

| 时刻（UTC） | 事件 | 落点 |
|---|---|---|
| `13:09:17.223Z` | 探针轮结束：`scan-round`（7 主体 / 3 产出者 / 立案 4）+ 本 finding + `filing-round` | `.quay/routine-findings.jsonl` L467-472 |
| `13:16:37Z` | 第一次重跑尝试：`BUILD FAILED` | `.quay/ac203-coldstart-rerun-20260920T131637Z.log`（全文 4 行） |
| `13:21:57Z → 13:57:29Z` | **重跑成功**，命令逐字 = `bash plugin/scripts/develop-deliver-tgz.sh --verify-coldstart --ac207-e2e --hosts "B C" --force --root /home/yale/work/quay` | `.quay/ac203-coldstart-rerun-20260920T132157Z.log` |
| `13:23:10Z` | **AC-205 刷新记录落账**（host B） | carrier line 279 |
| `~14:2xZ` | 执行该重跑的**兄弟任务** `gap-routine-freshness-refresh-stale-goal-009-ac-203-coldstart-face` 转 done | HEAD `812428b76` |

⇒ **主体在立案（`13:09:17Z`）后 14 分钟被刷新**，而刷新它的正是 finding 自己写的那句「same run as coldstart-face」——
`session-delivery` 与 `coldstart-face` **共用同一条命令行**（`plugin/freshness-producers.json:50` 与 `:38` 逐字相同，
`:51` 的 `_same_run_as` 就是它的指针），所以 AC-203 的那次重跑**同时**产出了 AC-205。
⛔ 本任务没有重跑（理由见 ⑧），执行者是**派发链**（兄弟任务的 worker），符合 DoD 第 2 条。

**例程半边未执行，机械可证**：`plugin/scripts/probe-routine.ts:668-680` 的 FILE-ONLY 守卫 —— 探针 spawn 期间
任何 tracked 文件被改动即整轮判 `failed` 且**什么都不记录**（违反时的话逐字在 `:679`）；而 `filing-round` 记录逐字只有
`filed: [...]` / `errors: []`（L472）。两读数同向。

### ④ 「失败在哪一步」—— 前置那一半的具名读数（⛔ 不是推理：同一次运行、两台机的逐字日志）

期望集在**每台机上都含 AC-205**（`plugin/scripts/develop-deliver-tgz.sh:1776`：
`expected_acs="GOAL-009-AC-203 GOAL-009-AC-204 GOAL-009-AC-205 GOAL-009-AC-206 GOAL-009-AC-232 GOAL-015-AC-234"`）。

**host B（orangevps）—— 前置满足 ⇒ 产出**（`.quay/verify-coldstart-remote-B-c80040ad.log:51-57` 逐字）：

```
== ⑦ session delivery (AC-205): installed dist/send-to-session.js → same-host target → transcript-verified ==
  target: pid=1154128 sessionId=0b1253ed-d3fc-4652-9750-295dd26d2eda (name from registry)
  shipped_from_installed_artifact=1 transcript_confirmed=1 evaluated=1 host=orangevps
  delivery_outcome=delivered hold_precheck=direct send_rc=0
  ac205 record written → /home/yale/quay-verify-coldstart-evidence-c80040ad.jsonl
```

**host C（instance-20221019-1509）—— 前置不满足 ⇒ 失败就在这一步**（`.quay/verify-coldstart-remote-C-c80040ad.log:51-57` 逐字）：

```
== ⑦ session delivery (AC-205): installed dist/send-to-session.js → same-host target → transcript-verified ==
  target: pid=3801624 sessionId=21725c8c-4629-4d5e-a39e-6f58687d7cdf (name from registry)
  transcript: /home/yale/.claude/projects/-home-yale-work-archguard/21725c8c-4629-4d5e-a39e-6f58687d7cdf.jsonl
  shipped_from_installed_artifact=1 transcript_confirmed=0 evaluated=1 host=instance-20221019-1509
  delivery_outcome=held hold_precheck=will-hold send_rc=0
  held_record: {"type":"system","subtype":"informational","content":"Held peer message — from an unidentified
    session [verified pid 1281209] ... not delivered to Claude (1 held). The sending session's permission mode
    class doesn't match this session's. Review it below, or set \"crossSessionInbound\" to \"accept\".",
    "cwd":"/home/yale/work/archguard","sessionId":"21725c8c-...","gitBranch":"author"}
```

**⇒ 失败步骤具名到一行**：host C 上被选中的活会话属于**别的项目**（`cwd=/home/yale/work/archguard`，其主体不由本仓库管），
其 settings 既无 `permissions.defaultMode=bypassPermissions` 也无 `crossSessionInbound=accept`
⇒ `--precheck` 的**直接量**读到 `will-hold` ⇒ AC-205 腿带着 `--allow-hold` 仍发
（`plugin/scripts/verify-deliver-coldstart.sh:5257` 注释逐字：本腿【就是要观察 held 结局本身】）
⇒ 被扣下 ⇒ `delivery_outcome=held` ⇒ **⛔ 不落账**。
**这不是缺陷，是 `plugin/freshness-producers.json:54` 的 `preconditions` 第 3-4 条早已逐字写明的设计结局**
（该字段原文：「两者皆无 ⇒ probe 被按 `Held peer message` … 扣下 ⇒ 本腿落痕 delivery_outcome=held、不落账。
2026-09-15 实测 host C … ⇒ held。⛔ 这不是缺陷，是判据在工作。」）。

**且整轮不是「假绿」**（硬规则 3b）：`plugin/scripts/develop-deliver-tgz.sh:1911-1920` 三态可区分 ——
`partial=1 ⇒ exit 2` / `fail=1 ⇒ exit 1`（NOT-EVALUATED）/ OK ⇒ `return 0`。本次逐字即为

```
develop-deliver: evidence-completeness COMPLETE present=6          ← host B
develop-deliver: evidence-completeness PARTIAL present=5 missing=1 list=GOAL-009-AC-205   ← host C
develop-deliver: --verify-coldstart PARTIAL (some hosts transported evidence but are missing expected records …)
```

⇒ **缺一条记录不会被写成 COMPLETE**，且**缺的是哪一条逐条点名**。

### ⑤ 本 finding 独有的那条前置：现在**两个方向**都有生产读数了（闭合上一轮留下的边界）

上一轮同主体任务（`gap-routine-freshness-refresh-freshness-goal-009-ac-205`，status done）的第 ⑨ 节如实留了一条
未验证边界：「`hold-precheck=will-hold ⇒ delivery_outcome=held` 这个**直接读数**只存在于提交信息（真机实测）里，
**任何已产出载体的日志里都还没有该形态**；⇒ 下一次产出者运行才会产出该形态的读数（自解，⛔ 不是缺口）」。

**本次运行就是那「下一次」，且它发生了**：`hold_precheck=will-hold` + `delivery_outcome=held` + 逐字
`Held peer message` 三条**同时**出现在 host C 的生产日志里（见 ④）。对称地，host B 的
`hold_precheck=direct + delivery_outcome=delivered + ac205 record written` 也逐字在册。
⇒ **该边界已闭合**，⛔ 不需要另立任务、⛔ 不需要另设前置（硬规则 12：无发生率的「必须先 X」该降为观察项）。

### ⑥ 5b 扫描：同一载体里「前置不由本仓库保证」的其它适用点

`grep -n '"preconditions"' plugin/freshness-producers.json` ⇒ **2 处**（`:54` session-delivery / `:70` upgrade-face）。
3 条 producer 里 2 条带前置，**均已登记在册**（`coldstart-face` 不带，因为它的四条主体「重跑即刷新」）。
`upgrade-face` 的前置是**目标机磁盘余量**（实测 `2026-09-19T06:10:14Z` host B 根分区 100% 满 ⇒ `cp -a` 死在 ENOSPC），
形态同族但**已单独落痕**、⛔ 不是本 finding 的一部分。⇒ **该形状没有未登记的兄弟实例**，本任务无需扩面。
⛔ 该字段无第二份拷贝：读 `plugin/freshness-producers.json` 的只有 4 个消费者
（`plugin/probes/freshness-refresh.md` / `plugin/scripts/capability-catalog-declarations.json` /
`plugin/scripts/runner-static-gate.ts` / `plugin/scripts/freshness-producer-coverage-check.ts`）。

### ⑦ `suggestedAction` 逐字复核：它的**字面形态不可执行**，可执行的是它的等价形（如实记录，⛔ 不假装照办）

finding 写的是「Re-run … **only on a host** whose live session passes `--precheck` printing `hold-precheck=direct`」。
**这一条按字面办不到**：两条 producer 条目**共用同一条命令行**（`plugin/freshness-producers.json:50` ≡ `:38`），
而 `coldstart-face` 的另外四条主体（AC-201/203/207/232）**需要两台机都跑**（本次两台机各落了它们）。
⇒ 「只派前置满足的那台机」在本机制里**没有对应旋钮**。**能执行的等价形**正是本次发生的事：
两台都跑 → B 产出并落账、C 落 `held` 痕迹（`--allow-hold` 的存在理由就是让 C 这种结局**可观测**而不是静默跳过）。
⛔ 本任务未改这条命令行（改它要同时改两处、且会动到 coldstart-face 的主体覆盖，超出本任务范围）。

### ⑧ 本任务⛔未做的事（逐条，不以沉默代替）

- ⛔ **未重跑产出者**：主体已是 `d=2 / margin=198`（①②），DoD 第 2 条把重跑归**派发链**，而该链**已经跑过同一条命令**
  （③，`13:21:57Z`）。再跑一次是 35 分钟级的跨机动作（本轮实测 `13:21:57Z→13:57:29Z`），
  且 host C 的结局**按前置不变仍是 held** ⇒ 零新增信息。
- ⛔ **未改 `plugin/freshness-producers.json`**：逐条复核后判定**无需改** —— `session-delivery` 的 `preconditions`
  已逐字记下两个前置（活会话 + settings 允许 inbound）、`--allow-hold` 的语义、以及 2026-09-15 的真机实测。
  把**本次运行史**再写一条进去，正是该文件头注释禁止的「运行史 / 第二份拷贝」，且方向上**有害**
  （会让后来读者以为 host C 的 held 是新增故障）。
- ⛔ **未改 `plugin/scripts/verify-deliver-coldstart.sh`**：AC-205 腿的四态落痕（delivered / held / absent / send-failed）
  与 `--allow-hold` 语义均已正确 —— 本次运行的三条读数就是它**按设计工作**的产物。
- ⛔ 未改 `K`、未改 criterion、未动 `.quay/productization-verification.jsonl` / `.quay/routine-findings.jsonl`、
  未改本 finding 的 `files:` / `symbols:` 观测面。
- ⛔ **未 ssh 到 B/C 现场复核 `--precheck`**：今日生产日志里已有两台机各自的 `hold_precheck=` 读数（④），
  现场复核是额外的跨机动作、不增加判据能取的假。

### ⑨ 机制全景（「已有机制在管」这句话的**逐环节落点**，⛔ 不是一句概括）

| 环节 | 机件 | 本次读数 |
|---|---|---|
| 检测 | `plugin/probes/freshness-refresh.md`（读 `plugin/freshness-producers.json` + `.quay/goal-freshness-margin.json`，R 当场自测） | `scan-round`：7 主体 / 7 有产出者 / 3 产出者 / 立案 4 |
| 立案 | `plugin/scripts/routine-file-gate.ts` 三道闸（quality / dedup / rate） | `filing-round`：filed 2（含本任务）；AC-207/232 被 rate 闸挡（cap 3） |
| FILE-ONLY | `plugin/scripts/probe-routine.ts:668-680` | 例程未执行任何产出者 |
| 执行 | 派发链（worker）重跑产出者 | `13:21:57Z` 兄弟任务跑 → `13:23:10Z` 落账 |
| 记录 | AC-205 腿只在 `transcript_confirmed=1` 时落账（`plugin/scripts/verify-deliver-coldstart.sh:5304`） | host B 落账 / host C 不落账 |
| 缺席可见 | `check_evidence_completeness` 逐条点名 + `exit 2`（`develop-deliver-tgz.sh:1911-1913`） | `PARTIAL present=5 missing=1 list=GOAL-009-AC-205` |

## Touches
- `plugin/freshness-producers.json`
- `plugin/scripts/verify-deliver-coldstart.sh`
- `tasks/gap-routine-freshness-refresh-stale-goal-009-ac-205-session-delivery-precondit.md`