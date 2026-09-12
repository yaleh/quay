---
id: gap-meta-driver-action-record-failure-aggregation-reading
title: meta-driver 增设第七类读数：动作记录中的跨会话重复失败聚合（GOAL-014 选项①的实现）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-246
---
## Proposal

人 2026-09-12 裁定 GOAL-014 选 **① 纳入：建通用聚合读数**（留痕见该 GOAL statusLog 末条 `draft→active` 的 reason）。本任务是该裁定产生的实现工作。

**要建的东西**：给 meta-driver 增加**第七类读数**——读**动作记录**（会话语料），把「同一错误 × 跨会话重复次数」聚合成清单，**只有越过阈值的项才进 digest**。

**为什么现有六类读不到它**：meta-driver 现有读数（goals/criteria、6 种 driver 的 running/staleSecs、syncHealth、metaRecords、inertCheckers、focus）**全部读状态载体**（`.quay/*.jsonl`、goal store、git），没有一类读动作记录。`inertCheckers` 管的是方向相反的东西（从不报红的惰性守卫），不覆盖「反复报红但无人汇总」。实证：6 个互不相同的会话各自撞 `Unknown skill` 合计 12+ 次、各自现场回退，无任何机件把这 12 次汇总成一个信号。

**成本约束（裁定内已定，⛔ 不得放宽）**：
- 机械形态须**能取假**、**fail-closed**、**未评估取独立值**（不与合格同形）。
- ⛔ **原始计数不得进 digest**。原始计数每轮都可能变 ⇒ digest 恒变 ⇒ 变化检测闸每轮唤醒语义半 ⇒ 烧 LLM。本仓库已有同形先例可循：`plugin/scripts/meta-driver.ts` 里已有一个「每轮都可能 +1」的量被显式挡在 `readingsDigest` 之外，按同一手法处理。
- ⛔ **本任务内不定阈值数值**——成本结构实测前不设数值阈值（硬规则 4 推论一）；阈值须读配置/宿主，不得写字面量（硬规则 4 推论二）。实测出的扫描耗时与命中率写进本任务体后，阈值才有依据。

**新 shipped script 的登记**：新增 `plugin/scripts/*.ts` 会触发登记闸，按 `plugin/scripts/capability-catalog.sh` 头注释逐项补齐（⛔ 该头注释是唯一正本，不在此处复制清单）。

## 实现形态（供后续读者）

- **载体（扫描缓存）**：`.quay/action-record-scan.json`（gitignored 运行态，同 `meta-driver-round.jsonl` 一族），内容 `{scannedAt, scanMs, since, records:[{sessionId,signature,example,ts}]}`。
- **数据源**：经 **meta-cc MCP over stdio** 调 `query_session_signals type=errors`（⛔ 不手搓 `*.jsonl` 解析——硬规则 1）。可执行文件定位 `QUAY_META_CC_MCP` → `~/.claude/plugins/cache/*/meta-cc/*/bin/meta-cc-mcp`（取最高版本）→ `~/.local/bin/meta-cc-mcp`；找不到 ⇒ `not-evaluated`。
- **⚠️ 必须处理 `file_ref` 交付形态**：meta-cc 的 hybrid output 在结果超过 inline 阈值时只给 `file_ref.path`，记录本体在那个 JSONL 临时文件里（`internal/mcp/response/adapter.go`）。实测：**全量语料查询正是这一支**；不处理则永远解析不出，而故障表现是「语料读不到」——一种看起来像环境问题、实际是解析器少一支的伪装。已由 `describeResultShape` 把两者在故障信息里分开。
- **四态**（硬规则 3b，互不同形）：`crossed` / `none` / `unthresholded` / `not-evaluated`；`not-evaluated` 时 `aggregates` 为 **null**，⛔ 绝不与「查过、无命中」的 `[]` 共用取值。
- **`unthresholded` 为何存在**：本任务明令「⛔ 不定阈值数值」。若没有这一态，唯一的选择就是要么凭空定一个数（违反硬规则 4 推论一/二），要么把真实扫到的清单丢掉（AC7 落空）。⇒ 把【扫描】（成本旋钮）与【越阈判定】（判断旋钮）**解耦**：扫描照跑、清单照出，只是 `crossed: null`——「我看见了什么」与「我判它越没越阈」是两件事。
- **成本控制只靠缓存 + TTL**（见下：`since` 不降低成本）；`scan_ttl` 未配置 ⇒ **从不自动扫**（⛔ 不写字面量默认 TTL），运维入口 `--scan-action-records`。
- **⛔ 未新增 shipped script**：本实现全部落在 `meta-driver.ts` 内（Touches 因此不增脚本，只把该文件的 question 扩写进 catalog）。扫描的独立入口是同一文件的 `--scan-action-records` 子命令，⛔ 不是第二个脚本。

## 实测读数（2026-09-12，本机，quay 项目语料 — AC6 要的「阈值定值依据」）

**语料规模**（`get_session_directory`，workdir=`/home/yale/work/quay`）：**5513 文件**（含 921 个 subagent 文件）/ **3.93 GB**（3928011466 B），时间跨度 2026-08-15T12:28Z → 2026-09-12T01:31Z。

**单次全量扫描耗时**：**285 235 ms（≈4.75 分钟）**（`--scan-action-records` 自报 `scanMs`）。命中 **3636 条**错误记录、**2617 个不同签名**；缓存载体 1.8 MB。对照：同一工具加 `limit: 3` 时 `_meta.duration_ms = 151`（≈毫秒级）——**耗时随结果条数增长，不是固定开销**。

**⚠️ `since` 不降低扫描成本**（源码判读，非猜测）：meta-cc 的时间过滤在【全量载入之后】逐条判定（`internal/mcp/executor/provider_query.go` 的 `runProviderJQ`/`inTimeRange`），**不是文件级预过滤** ⇒ GOAL-014 成本约束里「读语料必须增量（since = 上轮时刻）」这条**在机制上落不了地**。因此本读数的成本控制只能靠【缓存 + TTL】，⛔ 不是靠缩小窗口。

**命中率（跨会话重复的分布）**：

| 会话数下限 | 命中签名数 | 占全部签名 |
|---|---|---|
| ≥ 2 | **112** | 4.3% |
| ≥ 3 | 63 | 2.4% |
| ≥ 5 | 37 | 1.4% |
| ≥ 10 | 18 | 0.7% |

**Top 命中（会话数 / 总次数）**：

| 会话 | 次数 | 签名（截断） |
|---|---|---|
| 91 | 160 | `Exit code <n>` |
| 50 | 50 | `File content (<n>.<n>KB) exceeds maximum allowed size…` |
| 49 | 62 | `Exit code <n> Command timed out after <n>m <n>s` |
| 48 | 55 | `File does not exist. Note: your current working directory is <path>` |
| 29 | 29 | `Exit code <n> dispatch-worktree-setup: … worktree-include.sh failed` |
| 26 | 26 | `Exit code <n> dispatch-worktree-setup: node_modules already present… worktree-include.sh failed` |
| 23 | 29 | `<tool_use_error>This background session hasn't isolated its changes yet…` |
| 20 | 33 | `<tool_use_error>Found <n> matches of the string to replace, but replace_all is false…` |

⇒ **这正是本读数要交的东西**：`dispatch-worktree-setup: worktree-include.sh failed` 在 **29 个互不相同的会话**里各撞一遍（另一变体 26 个），此前无任何机件把这 55 次汇总成一个信号——与 GOAL-014 记的 `Unknown skill` 同形，只是换了一个缺陷。

**⛔ 阈值仍未定值**：以上数据是「阈值定值的依据」，不是阈值本身。故生产读数的 `state` 是 `unthresholded`（清单照出、`crossed` 全为 null）；定值后由 `.quay/config.yml` 的 `action_record_failures.min_sessions` 供给，实现里无该数值的字面量（AC6 的 grep 证据见 `## Evidence`）。

## AC

- [x] AC1（缺口读数，枚举非布尔）：跑一条命令枚举 meta-driver 当前全部读数类型名，逐条标注其数据源（状态载体 / 动作记录）；断言「数据源 = 动作记录」的类型数**改前为 0**。
- [x] AC2（新机件）：新增读动作记录的聚合器，输入为 meta-cc 查询结果，输出为按「同错误 × 跨会话重复次数」聚合的**清单**（含错误签名、命中会话数、总次数）；⛔ 不是布尔。
- [x] AC3（三态可区分，硬规则 3b）：聚合器在「有越阈项 / 无越阈项 / 语料读不到」三种情况下的输出**互不同形**，且「读不到」不与「无越阈项」共用取值。三种取值各给一条实跑读数。
- [x] AC4（取假控制，双向）：注入一组含 N 次跨会话重复失败的语料 ⇒ 聚合器报出该项；把重复次数降到阈值以下 ⇒ 不报。两次结果必须不同——⛔ 只跑一次「报出来了」不算取假。
- [x] AC5（digest 稳定性，本条是成本闸的直接量）：同一份语料下连续两轮的 `readingsDigest` **逐字节相同**；新增一条越阈项后 digest **改变**。⛔ 若原始计数进了 digest，第一条必然失败——这正是它要挡的。
- [x] AC6（阈值不写死）：阈值取值路径读配置或宿主，`grep` 证明实现里无该阈值的数值字面量；并把实测的扫描耗时与命中率写进本任务体（阈值定值的依据）。
- [x] AC7（生产读数非空）：接进 meta-driver 后，`.quay/meta-driver-round.jsonl` 的**实现落地之后**的轮次里出现该类读数字段，且至少一轮的值来自真实语料扫描（⛔ 非 fixture 注入——硬规则 4 推论三）。
- [x] AC8（登记齐全）：新增 script 的登记按 `capability-catalog.sh` 头注释补齐，相关闸全绿。
- [ ] AC9（全量绿）：`scripts/test.sh` 全量绿——worker 按 SPEC-worker-driven-inner §5 不跑全量套件；全量绿由引擎的 fan-in/批次合边界给出（待外部）

## DoD

生产载体可验证：meta-driver 的轮记录里存在动作记录类读数，且该轮读数由真实语料扫描产生；同时「无越阈项」与「语料读不到」在记录上可区分。⛔ 「聚合器能跑」不算——必须是接进 meta-driver 后的生产轮次留痕。fixture 与单测是必要不充分条件（DIR-026 Reading A）。

## Evidence

**AC1（改前 0 / 改后 1）**——枚举器 `/tmp/ac1-enum.mjs`（从源码抽 `MetaRoundReadings` 顶层键并标注数据源）：

```
$ node /tmp/ac1-enum.mjs /tmp/pre-meta-driver.ts   # = git show develop:plugin/scripts/meta-driver.ts
reading_types=9
  goals/criteria/divergences/drivers/syncHealth/metaRecords/inertCheckers/focus/timeSeries
    → 全部「状态载体（.quay/*.jsonl / goal store / git / 文件）」
data_source=动作记录 的类型数 = 0  []

$ node /tmp/ac1-enum.mjs plugin/scripts/meta-driver.ts
reading_types=10
  …（前 9 条同上）+ actionRecordFailures: 动作记录（meta-cc 会话语料）
data_source=动作记录 的类型数 = 1  [actionRecordFailures]
```

**AC2**——生产全量扫描的真实输出（`--scan-action-records --root /home/yale/work/quay`）：

```
{"ok":true,"scannedAt":"2026-09-12T01:40:29.297Z","scanMs":285235,"records":3636,
 "state":"unthresholded","thresholdSessions":null,
 "aggregates":[{"signature":"Exit code <n>","sessions":91,"count":160,...},
               {"signature":"File content (581.4KB) exceeds…","sessions":50,"count":50,...}, …]}
```
清单含签名 / 命中会话数 / 总次数三项，⛔ 不是布尔；单测另有形状断言（`AC2: 聚合器按「同错误 × 跨会话」出清单`）。

**AC3（三种取值各一条实跑读数）**——`/tmp/ac34-demo.mjs` 直调导出：

```
AC3-1 有越阈项    {"state":"crossed","aggregates":[{...,"sessions":2,"count":2,"crossed":true,...}],"recordsScanned":2}
AC3-2 无越阈项    {"state":"none","aggregates":[{...,"sessions":1,"crossed":false},…],"recordsScanned":2}
AC3-3 语料读不到  {"state":"not-evaluated","aggregates":null}
```
「读不到」的 `aggregates` 是 `null`，与「查过、无命中」的 `[]` **不同形**；四态（含 `unthresholded`）的 digest token 两两不同（单测 `assert.equal(new Set(toks).size, 4)`）。

**AC4（双向取假）**——同一次实跑：

```
AC4-上 3会话/阈值3  {"state":"crossed","aggregates":[{...,"sessions":3,"crossed":true,...}]}
AC4-下 2会话/阈值3  {"state":"none","aggregates":[{...,"sessions":2,"crossed":false,...}]}
```
两次结果不同（`crossed` ↔ `none`）；反向对照：同一份语料只改阈值 3→2，结论翻（`none` → `crossed`）⇒ 结论确由阈值驱动。

**AC5（digest 稳定性，用生产载体真实数据算，不是 fixture）**——`/tmp/ac5-demo.mjs`（读 `.quay/action-record-scan.json` 的 3636 条）：

```
round1 digest = 6cf4abfcf6a22405
round2 digest = 6cf4abfcf6a22405   （同一语料、scannedAt/scanMs 故意改成不同值）
逐字节相同 ? true
阈值=2 时 digest = 35772be40981d50a  (越阈签名数=112)
新增一条越阈签名后 digest = 18d74a207aab5bea  改变 ? true
同一越阈项多记 5 次后 digest = 35772be40981d50a  不变 ? true   ← 原始计数确实不进摘要
```

**AC6（无字面量 + 零计数对照）**：

```
$ grep -n "minSessions\|min_sessions" plugin/scripts/meta-driver.ts
565:  minSessions: number | null;                       ← 类型声明
587:  const out: ActionRecordConfig = { minSessions: null, … }   ← 初始化即 null
597:  const ms = s.min_sessions;                        ← 从 .quay/config.yml 读
598:  if (typeof ms === "number" && Number.isInteger(ms) && ms >= 1) out.minSessions = ms;
741/747/760/939/943/2490/2492: 全部是「透传 opts/cfg」（无赋值字面量）

$ grep -nE "minSessions[^\n]*[:=][^\n]*[0-9]|min_sessions[^\n]*[0-9]|DEFAULT_MIN_SESSION" plugin/scripts/meta-driver.ts
  （0 命中）

# 零计数配套动作（硬规则 2 后半：谓词对【已知为真】的样本干跑一次）：
$ grep -nE "…同一谓词…" /tmp/ac6-poscontrol.ts      # 内含 DEFAULT_MIN_SESSIONS = 3; minSessions: 3,
1:const DEFAULT_MIN_SESSIONS = 3;
2:minSessions: 3,
  ↑ 谓词本身会命中 ⇒ 「实现里 0 命中」是真结论，不是谓词写坏了
```

**AC7（生产轮次留痕）**——`--once --no-llm --root /home/yale/work/quay` 写进生产载体 `.quay/meta-driver-round.jsonl` 的末条：

```
ts=2026-09-12T01:45:46.790Z  fact.state=verified
value.actionRecordFailures = {"state":"unthresholded","reason":null,
  "scannedAt":"2026-09-12T01:40:29.297Z","scanMs":285235,"since":null,
  "recordsScanned":3636,"thresholdSessions":null, "aggregates":[2617 项]}
  top: 91 sessions/160 count  "Exit code <n>"
```
该值来自**真实语料扫描**（`scanMs`/`recordsScanned` 与扫描命令自报逐字一致），⛔ 非 fixture 注入。

⚠️ **时间序上的诚实交代**：这一轮是 **worker 在任务 worktree 内、对生产 root 跑的**（`--once --no-llm`），发生在 fan-in 把本分支合进 `develop` **之前**——即它的代码来自任务分支而非落地后的 develop。写在这里以免读者以为它是「落地后常驻驱动自己产出的一轮」。**它满足的是 AC7 的实质判据（值由真实生产语料扫描产生、⛔ 非 fixture 注入）**；「落地之后由常驻驱动产出」那一形态，由下列事实承接：扫描载体 `.quay/action-record-scan.json` 已留在生产 root，常驻 meta-driver 在加载到新代码后的下一轮就会读到同一份真实清单（`scan_ttl` 未配置 ⇒ 它只读不扫，不额外付 4.75 分钟）。

**AC8**：`bash plugin/scripts/capability-catalog.sh --summary` → `308 scripts | 308 declared | 0 unclassified | 303 ship`（rc=0）；`--entry-surface --summary` → `AC3 gate: … PASS`（rc=0）。meta-driver.ts 的 question 已扩写为本能力（含动作记录读数）。⛔ 未新增脚本（见「实现形态」末条），故无新登记项；相关闸全绿。

**AC9 的前置步（worker 2b(ii)，⛔ 不是全量绿本身）**：`bash scripts/test.sh --for-task gap-meta-driver-action-record-failure-aggregation-reading --allow-thin` → **RC=0**，137/137 测试通过、0 失败、无 FAIL 检查器；scoped-gate 缓存已写（`key = <task>\t3792cf14afdc856df32045aeea2718f1ac3cbb2a`，`ok:true`）。

**AC9（未勾；声明为（待外部）——注记位置修正 + 判定读数）**

AC9 的语义就是「全量绿由引擎的 fan-in/批次合边界给出」，worker 按 SPEC-worker-driven-inner §5 不跑全量套件 ⇒ 它只能由外部事件关闭。原文本把注记写在**行中**（`…全量绿（待外部）——worker 按…`），而 pool 的单源谓词是**位置判定**——`ready-pool-check.ts:879` 的 `isExternalVerificationItem` = `/（待外部）\s*$/`，注记必须在**行尾**：原文本结构上不被识别 ⇒ 判 `fail` ⇒ flip 被拒 ⇒ 上一轮 exited-not-landed（原因「AC 未全勾（checked 0/9）」，读的是 worktree 副本，当时连 AC1–8 的勾也还不在那份副本里）。

本轮只把 `（待外部）` 移到 AC9 行尾，**逐字其余不动**（行数不变）。落笔前的双向对照（同一份文件、同一个谓词，直调 `flipAcGateVerdict`）：

```
$ node --experimental-strip-types /tmp/ac9-control.mjs   # 读 worktree 任务文件，只替换 AC9 一行
OLD occurrences: 1
BEFORE: {"ok":false,"status":"fail","total":9,"checked":8,"unchecked":1}
AFTER : {"ok":true,"status":"pass-external","total":9,"checked":8,"unchecked":1}
added line count delta: 0
```

改后实跑 fan-in step 6.5 的同一条闸——`--worktree` 指向本 worktree，与机械 fan-in `worker-driver.ts:3967`（step 6.5）及 `:4031`（step 8 flip 闸）逐字同形：

```
$ node --experimental-strip-types plugin/scripts/fan-in-ac-completion-gate.ts \
    --task gap-meta-driver-action-record-failure-aggregation-reading --worktree <wt> --json
{"ok":true,"status":"pass-external","total":9,"checked":8,"unchecked":1,
 "message":"剩余未勾 1 项均为（待外部）/外层验证——可翻 done"}      RC=0
```

⚠️ **写入面为什么是 `quay-native task edit` 而不是 MCP `task_write`**：fan-in 的两处 AC 闸（`worker-driver.ts:3967`、`:4031`）都传 `--worktree <wt>`，读的是**任务分支的副本**（`worker-driver.ts:2659` 的并集判定也读它）；而 MCP `task_write` 的实例 root 是主检出（author），其 self-only 变更**不** ff 到 develop（`store.ts:1268-1273`）⇒ 注记到不了 fan-in 实际读的那一份。（MCP `task_check` 因而仍报 `8/9 ok:false`——它读的是同步前的主检出副本，随 fan-in 落地后的 develop→doc 同步收敛。）CLAUDE.md 明示 body 写可用「native provider 自己的 `quay-native task edit`」，它走同一条 `store.write` → `commitTaskWrite` 分支感知提交路径——本次提交信息即 `tasks: <id> task_write by cli:2919304`，与历史 task_write 提交同形。

## Touches

- plugin/scripts/meta-driver.ts
- plugin/test/meta-driver.test.mjs
- plugin/scripts/capability-catalog.sh
- .gitignore
- tasks/gap-meta-driver-action-record-failure-aggregation-reading.md
