---
id: gap-routine-freshness-refresh-freshness-goal-009-ac-238-upgrade-face
title: "freshness-refresh: margin -4 is already negative (d=204 > K=200): the
  newest carrier evidence for AC-238 is 204 delivery-face commits behind the
  develop tip, so the goal layer's fr"
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
margin -4 is already negative (d=204 > K=200): the newest carrier evidence for AC-238 is 204 delivery-face commits behind the develop tip, so the goal layer's freshness criterion is already violated and degrades further with every commit; upgrade-face is the only producer whose subjects list contains it.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1789621383770` · ts `2026-09-17T05:03:03.770Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`GOAL-009-AC-238`、`upgrade-face`
- 涉及文件：
- `plugin/freshness-producers.json:65`
- `plugin/freshness-producers.json:70`
- `.quay/goal-freshness-margin.json:1`
- `.quay/productization-verification.jsonl`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
re-run upgrade-face (bash plugin/scripts/develop-deliver-tgz.sh --verify-upgrade --upgrade-source <aged-third-party-project> --ac239-e2e --hosts B --force --root <main-checkout>) on host B

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `freshness-goal-009-ac-238-upgrade-face`（routine `freshness-refresh`，runId `freshness-refresh-1789621383770`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence

**处置 = 【已修掉】（⛔ 不是观察项、不是「已注意到」）。** 判据本体逐字干跑 **EXIT=0**，主体 `4/200`（margin 196）；下面三处读数互校，且谓词在**两个方向**都取到了真样本。

### ① 判据本体逐字跑（抽取器 = 本仓自己的 `yaml`，⛔ 不手抄、不引述本任务文本）

抽取脚本 `.quay/ac238-verify/extract.mjs`（`createRequire` 加载本仓 `yaml`，取 `goals/AC-214-*.md` 首份 frontmatter 的 `criterion`，原样交 `bash -c`，cwd=`/home/yale/work/quay`）：

```
node .quay/ac238-verify/extract.mjs /home/yale/work/quay > .quay/ac238-verify/criterion.yaml.txt
bash -c "$(cat .quay/ac238-verify/criterion.yaml.txt)"
```

⇒ **EXIT=0**，stderr 空，stdout 七行逐字：

```
freshness GOAL-009-AC-201: 4/200 (margin 196)
freshness GOAL-009-AC-232: 85/200 (margin 115)
freshness GOAL-009-AC-205: 85/200 (margin 115)
freshness GOAL-009-AC-207: 85/200 (margin 115)
freshness GOAL-009-AC-203: 85/200 (margin 115)
freshness GOAL-009-AC-238: 4/200 (margin 196)   ← 本 finding 的主体
freshness GOAL-009-AC-239: 4/200 (margin 196)
```

判据本体只读：`md5sum .quay/productization-verification.jsonl` 跑前跑后同为 `ec731e1d0722bd47f2847c591e2c842b`（存档 `.quay/ac238-verify/carrier-md5-before.txt`）。
判据自己写的快照（`2026-09-17T06:57:59Z`）：`"GOAL-009-AC-238": {"K": 200, "d": 4, "margin": 196}`。

### ② 独立重算 `d` + 「谓词能取假」的对照（同一条谓词，两个证据 sha、两个 tip）

交付面路径按判据同一规则机械推导（`packages/quay/package.json` 的 `files` + `plugin` + `packages/quay-native/src`，⛔ 不手写清单）：

| 证据 sha | 载体来源 | tip 取 | `d` | margin |
|---|---|---|---|---|
| `10c664c9`（finding 时的最新） | `2026-09-14T23:14:12Z` | `609dd467`（探针观测时刻的 develop tip） | **204** | **−4** |
| `10c664c9` | 同上 | 今日 develop tip | 208 | −8 |
| `609dd467`（修复后的最新） | `2026-09-17T04:43:09Z` | `609dd467`（同上） | **0** | 200 |
| `609dd467` | 同上 | 今日 develop tip | **4** | **196** |

第 1 行**逐字复现了 finding 的 `d=204 > K=200`**（硬规则 2 的零计数配套动作：谓词对着一个已知为真的样本干跑 ⇒ 证明它能取假，不是恒绿）；第 3 行是同一谓词、同一观测时刻、对修复后 sha 的读数 ⇒ **两个方向都有真样本**。⛔ 未采信快照自报值。

### ③ 谁修的、什么时候（⛔ 不是本任务）

- 判据首次转红：`.quay/goal-round.jsonl` round 200，`ts 2026-09-17T04:24:54.916Z`，`verdict: fail`（reason 逐字含 `GOAL-009-AC-238:204/200 (margin -4)`）。
- **修复由派发链完成**：`tasks/gap-ac214-sixth-crossing-stale-bundle-detected-but-no-remediation.md`（`04:23:08Z` 立案 → `06:27:04Z` done，提交 `335ad7170`，`git merge-base --is-ancestor … develop` = YES）的 worker 跑了产出者 run 2：`--start 04:41:51Z` → 最后一行 `05:04:40Z`，`develop-deliver: --verify-upgrade OK`、`evidence-completeness COMPLETE present=2`、`UPGRADE-PAIR OK`。
- **本 finding 在它被观测的那一刻是真的**：探针窗口 `04:59:08.227Z–05:03:03.770Z`（= filing ts − `durationMs 235543`；读数取自 `.quay/quality-round.jsonl` 的 `freshness-refresh` fact：`fired: true / exit: 0 / recordsAppended: 3 / 2 filed`）。该窗口内载体最新 AC-238 记录仍是 `10c664c9` —— 新记录落盘于载体 mtime `05:04:39.153Z` ⇒ 表第 1 行的 −4 就是当时的真值。
- 但它**落进了一个已经在收尾的修复窗口**：修复起跑 `04:41:51Z` **早于立案 21m12s**；新证据落盘 `05:04:39.153Z` **晚于立案仅 1m35s**；判据随即 `05:09:30Z` 转绿（`d=0`）。红→绿全程 44m35s（`04:24:54.916Z → 05:09:30Z`）。

### ④ 「失败在哪一步」

**没有任何一步失败。** 主路径四步各就各位：判据转红（`04:24:54.916Z`）→ gap 任务立案并派发（`04:23:08Z`）→ 产出者跨机跑成（`04:41:51Z–05:04:40Z`）→ 判据转绿（`05:09:30Z`）。
例程这一侧同样按契约工作：探针契约逐字写着 `⛔ FILE ONLY. DO NOT EXECUTE ANY PRODUCER.`，本轮 scan-round 的 `notes` 逐字 `No producer was executed` ⇒ DoD 第 2 条成立（例程只立案，产出者是派发链跑的）。

**两条已量化的观察项（⛔ 无发生率读数，故不立前置 —— 硬规则 12）**：
1. 探针的输入是判据自己写的 margin 快照（`plugin/probes/freshness-refresh.md` §①），而快照只在判据跑时重写；探针 `04:59` 读的那一份是 `04:23:52Z` 写的，已 35m16s 旧。**同刻独立重算同样是 204**（②表第 1 行）⇒ 两种读法无法也无需区分：真值是 −4，不是快照伪影。这一形态（finding 落在一个已在收尾的修复窗口内）由 `(W+I)` 与判据复核节奏共同决定，属设计内的重复信号。
2. dedup 闸按 `## Finding` 的**文本**归一化去重（`routine-file-gate.ts:19/:45`）；同一 crossing 的 `gap-ac214-sixth-crossing-…` 在 `04:23:08Z` 已在板上（早于立案 40m），但其 finding 文案不同 ⇒ 不命中。文本去重检测不到「同一底层 crossing、不同症状文案」。

### ⑤ 本任务自身未做的事（⛔ 逐条，不以沉默代替）

- ⛔ **未重跑产出者**：主体 `4/200`、判据 EXIT=0，重跑是零边际收益的 23 分钟跨机动作；且 DoD 第 2 条把产出者重跑归派发链，而派发链已经跑过（③）。
- ⛔ **未改 `plugin/freshness-producers.json`**（Touches 里那一行）：逐项复核结论是**「正确、无需变更」** —— `upgrade-face.command` 与 finding 的 `suggestedAction` 同形；`wallclock_hours: 0.38` 正是本轮那次运行的端到端实测；`subjects` 含 `GOAL-009-AC-238`；`_aged_source` 记录的 aged 副本与实跑一致。且把运行史继续写进该文件本身就违反它自己的单源原则。
- ⛔ 未改 `goals/`、未改 K、未改 `criterion`/`expect`、未动 `.quay/routine-findings.jsonl` 与 `.quay/productization-verification.jsonl`（判据干跑前后 md5 相同）。
- **兄弟条目（⛔ 本任务不碰）**：`gap-routine-freshness-refresh-freshness-goal-009-ac-239-upgrade-face`（同 runId、同一对主体）状态仍为 `ready`，由它自己的派发链处置。

## Touches
- `plugin/freshness-producers.json`
- `tasks/gap-routine-freshness-refresh-freshness-goal-009-ac-238-upgrade-face.md`
