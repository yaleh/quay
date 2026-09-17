---
id: gap-routine-freshness-refresh-freshness-goal-009-ac-239-upgrade-face
title: "freshness-refresh: margin -4 is already negative (d=204 > K=200): AC-239
  shares the upgrade-face run with AC-238 and its evidence has aged past the
  window; the mapping records that"
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
margin -4 is already negative (d=204 > K=200): AC-239 shares the upgrade-face run with AC-238 and its evidence has aged past the window; the mapping records that the AC-239 half is itself structurally unreachable until the missing dist/driver-anchor.js defect is fixed, so this finding needs a producer run plus that precondition check.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1789621383770` · ts `2026-09-17T05:03:03.770Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`GOAL-009-AC-239`、`upgrade-face`
- 涉及文件：
- `plugin/freshness-producers.json:65`
- `plugin/freshness-producers.json:71`
- `.quay/goal-freshness-margin.json:1`
- `.quay/productization-verification.jsonl`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
re-run upgrade-face (bash plugin/scripts/develop-deliver-tgz.sh --verify-upgrade --upgrade-source <aged-third-party-project> --ac239-e2e --hosts B --force --root <main-checkout>) on host B

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `freshness-goal-009-ac-239-upgrade-face`（routine `freshness-refresh`，runId `freshness-refresh-1789621383770`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence

**处置 = 【已修掉】**（⛔ 不是观察项、不是「已注意到」）。判据本体逐字干跑 **EXIT=0**（AC-214 与 AC-239 各一次）。本任务全程对两个载体 **只读**：`md5sum .quay/productization-verification.jsonl` 跑前跑后同为 `009a7042d44b35b6dca5decdbe4b5926`；`.quay/routine-findings.jsonl` 同为 `513d9305696014c35352bc96f329d491`。

### ① 判据本体逐字跑（抽取器 = 本仓自己的 `yaml`，⛔ 不手抄、不引述本任务文本）

抽取脚本 `.quay/ac239-verify/extract.mjs`（`createRequire` 加载本仓 `yaml`，取 `goals/AC-214-*.md` 首份 frontmatter 的 `criterion`，原样交 `bash -c`，cwd=`/home/yale/work/quay`；抽出的 121 行 md5 `579c77b13147f22cdba1f1cde32b6a4e`）：

```
node .quay/ac239-verify/extract.mjs goals/AC-214-交付证据必须新鲜-四条载体型判据不得-一旦转绿即永久绿.md > .quay/ac239-verify/ac214-criterion.txt
bash -c "$(cat .quay/ac239-verify/ac214-criterion.txt)"
```

⇒ **EXIT=0**，stderr 空，stdout 七行逐字（存档 `.quay/ac239-verify/ac214-stdout.txt`）：

```
freshness GOAL-009-AC-201: 0/200 (margin 200)
freshness GOAL-009-AC-232: 85/200 (margin 115)
freshness GOAL-009-AC-205: 85/200 (margin 115)
freshness GOAL-009-AC-207: 85/200 (margin 115)
freshness GOAL-009-AC-203: 85/200 (margin 115)
freshness GOAL-009-AC-238: 0/200 (margin 200)
freshness GOAL-009-AC-239: 0/200 (margin 200)   ← 本 finding 的主体
```

同法抽 **AC-239 自己**的 `criterion`（`.quay/ac239-verify/ac239-criterion.txt`）逐字跑 ⇒ **EXIT=0**，stdout/stderr 皆空。

### ② 独立重算 `d`：finding 的 `−4` 逐字复现，且同一谓词两个方向都取到真样本

⛔ 不读 `.quay/goal-freshness-margin.json`（那是被测对象自己的产物 —— 硬规则 4b）。交付面路径按判据**同一规则**机械推导（`packages/quay/package.json` 的 `files` ∩ 存在 + `plugin` + `packages/quay-native/src`，共 10 条，逐条列在 `recompute-d.txt` 顶部），`d = git rev-list --count <sha>..<tip> -- <paths>`：

| 证据 build_sha | tip 取 | `d` | margin |
|---|---|---|---|
| `10c664c9`（finding 时最新，09-14T23:14:12Z） | `f2d67537`（**探针读到的那份快照被写出的时刻** 04:23:52Z 的 develop tip） | **204** | **−4** |
| `10c664c9` | `ef41dcc2`（立案时刻 05:03:03Z） | 205 | −5 |
| `10c664c9` | `7db3f155`（今日） | 208 | −8 |
| `609dd467`（run 2 的新证据） | `f2d67537` | **0** | 200 |
| `609dd467` | `7db3f155` | 4 | 196 |
| `b29affe9`（run 3 的新证据） | `7db3f155` | **0** | 200 |

第 1 行**逐字复现了 finding 的 `d=204 > K=200` / `margin −4`**（硬规则 2 的零计数配套动作：谓词对着一个已知为真的样本干跑 ⇒ 证明它能取假）；第 4/6 行是同一谓词、同一时刻对修复后 shas 的读数 ⇒ **两个方向都有真样本**，既不是恒绿也不是恒红。⛔ 未采信快照自报值。

### ③ 本 finding 特有的那条前提：**写它时是真的；被修掉之后没人更新它** —— 而探针逐字抄进了 `rationale`

finding 的 `rationale` 逐字：

> …the mapping records that the AC-239 half is itself structurally unreachable until the missing dist/driver-anchor.js defect is fixed, so this finding needs a producer run plus that precondition check.

它抄的是 `plugin/freshness-producers.json` 当时的 `_wallclock_measured`（`b74844c5e` 版，逐字存档 `.quay/ac239-verify/mapping-caveat-before.txt`）：

> …the upgrade face's AC-239 half is structurally unreachable — the shipped artifact carries no dist/driver-anchor.js, so `quay driver start` returns rc=1 in every installed layout…

**它不假**。写成 caveat 的那一刻（`2026-09-14T18:20:20`）它是对的 —— 4m41s 前那一轮（`fb0301b8`，远端 log 首行 `ts=2026-09-14T18:15:39Z`）逐字：

```
  [⑦b] driver start: promotion rc=1 worker rc=1 started=0
  [⑦b] not-evaluated: 升级后项目的 driver 起不来 ⇒ 记录 NOT written（这本身就是 AC-239 要测的失败，如实记）
```

**问题在于它之后没人更新。** 时间线（每条都可核）：

| 时刻 (UTC) | 事件 | 载体 |
|---|---|---|
| 09-14T18:15:39 | run `fb0301b8`：`driver start rc=1 started=0` ⇒ ⛔ 不写 AC-239 记录（fail-closed，对） | `.quay/verify-upgrade-remote-B-fb0301b8.log:29` |
| 09-14T18:20:20 | caveat 写进 mapping（**当时为真**） | `b74844c5e` |
| 09-14T21:42:17 | **修复落地** | `6b1aa601f`「dist-closure: … dist/driver-anchor.js never shipped」 |
| 09-14T23:14:12Z | 修复被**直接量**验证（对**发货 tarball** `tar tzf … \| grep driver-anchor` + 远端 `pgrep -af driver-anchor` 活进程），AC-239 记录产出 | `10c664c9`；见 `gap-ac214-upgrade-face-refresh-and-mechanical-freshness-trigger` Round 2 |
| 09-17T05:03:03.770 | 探针读到**仍未更新的** caveat，抄进 finding 的 `rationale` 与 scan-round `notes` | 本任务 |
| 09-17T05:11:51 | caveat 从 mapping 删除 | `6e96e6059` |

⇒ **caveat 在被证否之后仍在 mapping 里存活**：以修复被直接量验证的 `23:14:12` 起算 **2 天 5 小时 57 分**，以修复落地 `21:42:17` 起算 **2 天 7 小时 29 分**；写成至删除共 **2 天 10 小时 51 分**。

**那条全称断言（「每一个安装形态 `quay driver start` 恒 rc=1」）的读数面**（全表 `.quay/ac239-verify/ac239-driver-start-outcomes.txt`，取自产出者自己的远端 log）：

```
started=1 : 3b0932db 289a49dc 32ff4f3a 10c664c9 609dd467 b29affe9   (6 次)
started=0 : fb0301b8                                                  (1 次)
```

⛔ 哪几次构成该断言的**直接反证**取决于缺陷引入的时刻（`gap-ac214-upgrade-face-refresh-and-mechanical-freshness-trigger` Round 2 记其根因在**阶段 C** 之后 —— 本任务**不重新裁定**引入时刻）；**确定的是**：修复落地（`21:42:17`）之后产出者跑了 **3** 次且 **3/3** `driver start: promotion rc=0 worker rc=0 started=1`（`10c664c9`/`609dd467`/`b29affe9`），而 mapping 那条全称断言直到 `05:11:51` 才被删除。

**处置**：这一条已由**别人**修掉，本任务复核确认修得干净 —— `6e96e6059` 已把 caveat 从 mapping 删除，其替换文本 (i) 陈述 `plugin/scripts/dist/driver-anchor.js` 存在、(ii) 列出 AC-239 记录；两条本任务都独立复核为**真**（`1469991` bytes 在位；②④ 见下）。

### ④ 产出者真跑（两次），AC-239 记录现为最新

- **run 2**：`build_sha 609dd467`，远端 log 首行 `ts=2026-09-17T04:43:09Z`，同一日志 `:32` 逐字 `ac239 record written → /home/yale/quay-verify-upgrade-evidence-609dd467.jsonl (same root as AC-238: /home/yale/quay-verify-upgrade-609dd467-root) ✓`。该轮由 `gap-ac214-sixth-crossing-stale-bundle-detected-but-no-remediation` 的 worker 跑（该任务 Evidence ③）。
- **run 3**：`build_sha b29affe9`，本地 log `.quay/freshness-ac238-producer-run.log` 首行 `develop-deliver: develop tip = b29affe9d0b9`，末行 `upgrade-pairing UPGRADE-PAIR OK host=orangevps roots=/home/yale/quay-verify-upgrade-b29affe9-root`；载体追加时刻 `2026-09-17 07:07:08.759Z`（`.quay/productization-verification.jsonl` mtime）。
  **谁跑的**（⛔ 按位置判、不按关键词判 —— 会话 `040bcfd9-c6a5-4ff3-b026-06bbb634a30b` 的 transcript 里逐字的 `tool_use.input.command`）：

```
2026-09-17T06:39:27.835Z  Bash
nohup bash plugin/scripts/develop-deliver-tgz.sh --verify-upgrade --upgrade-source work/meta-cc-aged-ac238-copy \
  --ac239-e2e --hosts B --force --root /home/yale/work/quay > /home/yale/work/quay/.quay/freshness-ac238-producer-run.log 2>&1 &
```

  该会话的派发 prompt 逐字指向 **`gap-routine-freshness-refresh-freshness-goal-009-ac-238-upgrade-face`**（对侧任务，不是本任务）。本任务只陈述这条事实，⛔ 不代对侧裁定其 Evidence §⑤ 的读法。

⇒ 两个主体在**同一个 `project_root`** 上配对（AC-239 判据的关联要求）。载体里 5 条 AC-239 记录全部 `host=orangevps`（外机）、`task_status=done`、`gate_events>0`、`produced_by_driver=true`、`commit_sha`/`task_id` 非空。

### ⑤ 「失败在哪一步」：**没有任何一步失败**

| 步 | 时刻 (UTC) | 读数 |
|---|---|---|
| 判据转红 | 09-17T04:24:54.916 | `.quay/goal-round.jsonl` round 200（pid 2345029）`AC-214 verdict=fail`，reason 逐字含 `GOAL-009-AC-238:204/200 (margin -4), GOAL-009-AC-239:204/200 (margin -4)` |
| 派发链执行 | 04:41:51 → 05:04:40 | run 2（`609dd467`）跨机跑成，`UPGRADE-PAIR OK` |
| 判据转绿 | 本任务复跑 | AC-214 **EXIT=0**，`GOAL-009-AC-239: 0/200 (margin 200)`（①） |
| 主体自证 | 本任务复跑 | AC-239 自己的判据 **EXIT=0**（①） |

探针这一侧同样按契约工作：`plugin/probes/freshness-refresh.md` 逐字写着 `⛔ FILE ONLY. DO NOT EXECUTE ANY PRODUCER.`，本轮 scan-round 的 `notes` 逐字 `No producer was executed` ⇒ DoD 第 2 条成立（例程只立案；产出者是派发链跑的，④）。

⚠️ 一个**时间上的巧合**，如实披露：本 finding 立案（`05:03:03.770Z`）落在 run 2 的收尾窗口内 —— run 2 起跑 `04:41:51Z` **早于立案 21m12s**，其记录落盘 `05:04:39Z` **晚于立案 1m35s**。所以 finding 读到的 `−4` 在它被观测的那一刻是真的（② 第 1 行独立复现），但它描述的那次修复已经在飞。

### ⑥ 本任务自身未做的事（⛔ 逐条，不以沉默代替）

- ⛔ **未重跑产出者**：主体 `0/200`、两条判据 EXIT=0，且本 finding 的产出者已在 `04:41` 与 `06:39` 被**派发链跑过两次**（④）⇒ 第三次重跑是零边际收益的 23 分钟跨机动作。
- ⛔ **未改 `plugin/freshness-producers.json`**（Touches 里那一行）：逐项复核结论是**「正确、无需变更」** —— `command` 与 finding 的 `suggestedAction` 同形；`wallclock_hours: 0.38` 正是本轮那次运行（`04:41:51–05:04:40`）的端到端实测；`subjects` 含 `GOAL-009-AC-239`；`_aged_source` 与实跑一致；被删掉的 caveat 的**成因链**归它自己的两个任务（Round 1/2），把历史继续写进 mapping 违反它自己的单源原则。
- ⛔ 未改 `goals/`、未改 K、未改 `criterion`/`expect`、未动两个载体（md5 跑前跑后相同）、未改对侧任务文件。

**观察项（⛔ 无发生率读数者不得升为前置 —— 硬规则 12；两条各只发生 1 次，故不立前置）**：

1. **一条已死的阻断声明可以在版本化的 mapping 里静默存活**（③）：caveat 被 `6b1aa601f` 证否后仍在位 ≥2d5h57m，期间被探针逐字搬进一条 finding 的 `rationale`。`_wallclock_measured` / `_aged_source` 这类**散文字段**并不在探针契约 §① 的声明输入之列，却能被分析师读取并影响 `rationale`（本轮 scan-round 的 `notes` 也逐字引用了它）。发生率 1。
2. **findings family 的处置模板**里，「⛔ 未重跑产出者 … 派发链已经跑过」这一句在 `AC-203/205/207/238` 四个兄弟任务里逐字复用，而它与产出者运行日志之间**没有任何机械核对**。发生率 1（本任务实测到一例该模板的断言与一次在飞运行并存，④）。
