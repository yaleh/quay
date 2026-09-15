---
id: gap-routine-freshness-refresh-freshness-goal-009-ac-205
title: "freshness-refresh: delivery-face evidence for AC-205 (build_sha
  f19397c6, 2026-09-14T14:25:05Z) is d=190 commits behind the develop tip; only
  10 commits of margin remain against th"
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
delivery-face evidence for AC-205 (build_sha f19397c6, 2026-09-14T14:25:05Z) is d=190 commits behind the develop tip; only 10 commits of margin remain against the 42.12 commits (2.34h) a coldstart-face run plus one observation interval needs to land inside K=200.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1789490129772` · ts `2026-09-15T16:35:29.772Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`coldstart-face`、`develop-deliver-tgz.sh`
- 涉及文件：
- `plugin/freshness-producers.json:31`
- `.quay/goal-freshness-margin.json:1`
- `.quay/productization-verification.jsonl`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
re-run coldstart-face on hosts B C (bash plugin/scripts/develop-deliver-tgz.sh --verify-coldstart --ac207-e2e --hosts "B C" --force --root <main-checkout>)

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `freshness-goal-009-ac-205`（routine `freshness-refresh`，runId `freshness-refresh-1789490129772`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence

**处置 = 【已修掉】（⛔ 不是观察项）。判据能取假，三处独立读数互相印证：**

| 量 | 立案时（finding ts `16:35:29.772Z`） | 本次复核（`2026-09-15T22:01Z`） |
|---|---|---|
| 主体最新载体记录 | `f19397c6` @ `2026-09-14T14:25:05Z` | `5c55ada8b391` @ `2026-09-15T20:06:42Z` (host B/orangevps) |
| `d`（交付面提交距离，K=200） | **190** | **9** |
| `margin = K − d` | **10** | **191** |
| 探针阈值 `(W+I)×R` = (0.34+2.0)×18 | 42.12 | 42.12 |

**① 判据本体逐字跑**（从 `goals/AC-214-交付证据必须新鲜-…md` frontmatter 折叠块 `criterion:` 用
`YAML.parseAllDocuments()[0]` 取出后 `bash` 执行，⛔ 不是引述；cwd = **主检出** —— 载体
`.quay/productization-verification.jsonl` 是 gitignored 运行产物，只在主检出存在；stdout 逐字，stderr 空）：

```
freshness GOAL-009-AC-201: 9/200 (margin 191)
freshness GOAL-009-AC-232: 9/200 (margin 191)
freshness GOAL-009-AC-205: 9/200 (margin 191)
freshness GOAL-009-AC-207: 9/200 (margin 191)
freshness GOAL-009-AC-203: 9/200 (margin 191)
freshness GOAL-009-AC-238: 132/200 (margin 68)
freshness GOAL-009-AC-239: 132/200 (margin 68)
EXIT=0
```

**② 独立重算 `d`（⛔ 不采信快照自报值）**：交付面路径按判据同一规则**机械推导**
（`packages/quay/package.json` 的 `files` 映射 + `plugin` + `packages/quay-native/src`，共 10 条，
⛔ 不手写清单）：`git rev-list --count 5c55ada8b391..develop -- <paths>` = **9**。
**负控制（硬规则 4「能取假」）**：同一谓词对 finding 自己钉的 pre-fix sha 干跑 ⇒
`f19397c6..develop` = **210 > K=200** ⇒ 判据在该 sha 上确实会红，**不是恒绿**。
`git merge-base --is-ancestor 5c55ada8b391 develop` = **YES**（血缘成立，不是孤立提交）。

**③ 产出者确实跨机跑过**（⛔ 不靠「记录存在」反推）：载体 L227 逐字
`{"build_sha":"5c55ada8b391ecc45e250076baeb3f332caff04d","ts":"2026-09-15T20:06:42Z","ac":"GOAL-009-AC-205","host":"orangevps","shipped_from_installed_artifact":true,"transcript_confirmed":true}`；
host B 远端日志 `.quay/verify-coldstart-remote-B-5c55ada8.log` 同步块逐字：

```
== ⑦ session delivery (AC-205): installed dist/send-to-session.js → same-host target → transcript-verified ==
  target: pid=1154128 sessionId=0b1253ed-d3fc-4652-9750-295dd26d2eda (name from registry)
  shipped_from_installed_artifact=1 transcript_confirmed=1 evaluated=1 host=orangevps
  ac205 record written → /home/yale/quay-verify-coldstart-evidence-5c55ada8.jsonl
```

该次运行用的是**安装物**（`/home/yale/quay-verify-coldstart-5c55ada8.npm/lib/node_modules/quay/…`），
构建自 `5c55ada8b391`（同轮 AC88 记录：`build_date=2026-09-15T19:50:56+00:00 sha256_quay=2f80acf9…`）。

**④ 谁修的（⛔ 不是本任务）**：产出者重跑由**派发链**执行，执行者 = `gap-ac214-fifth-crossing-routine-detects-but-nothing-acts`
的 worker。时间线（全部取自载体 `ts` / `git log`，可逐条复核）：

| 时刻 | 事件 |
|---|---|
| `16:35:29.772Z` / `18:35:40.613Z` | 例程**两轮**把本 finding 追加进载体（`d`=190 → 192） |
| `19:26:58Z` | commit `4c7e5c230` 落地：机械立案步接进 `probe-routine.ts`（**此前 finding 只进载体、不成任务**） |
| `19:30:42Z` | 本任务被该通道立案（`7267ae9c6`） |
| `20:06:42Z` | **AC-205 的刷新记录落账**（载体 L227） |
| `20:56:33Z` | todo→ready（`be2c72bab`），派发到本 worker |

⇒ **本任务立案（19:30:42Z）早于它所描述的陈旧被修掉（20:06:42Z）36 分钟** —— 这一次不是「迟到立案」，
而是产出者与立案并行、产出者后到。

**⑤ AC-205 与其余四个主体的差异（本任务真正独有的部分）**：
- **host C 结构性产不出**：C 的 AC-205 腿逐字 `transcript_confirmed=0 evaluated=1 host=instance-20221019-1509`
  ＋ `NOTE: AC-205 record NOT written (transcript_confirmed=0 — send exit 0 但 transcript 未物化 ⇒ 不落账，负控制 AC4)`；
  映射 `preconditions` 记 C 的唯一活会话（cwd=/home/yale/work/archguard）两键皆无 ⇒ held。
  ⇒ **AC-205 只有 host B 一条产出路径。**
- **host B 也不是每次都产出**：同一轮派发链在 B 上跑了 **3 次**（`c529e425`×2 → 载体 `19:18:53Z`/`19:37:21Z`；
  `5c55ada8`×1 → `20:06:42Z`），**只有第 3 次写出 AC-205**。保留下来的那次失败日志逐字
  `NOTE: AC-205 record NOT written (send-to-session failed to connect — 缺值≠合格)`，
  且选中的目标会话在**别的项目**里（`-home-yale-quay-verify-upgrade-10c664c9-root`，pid 1003072）。
- 该缺口 = 目标会话选择器只查 socket 文件存在、不查进程活 ⇒ **已由 `3b9eac322`（`2026-09-15T20:04:38Z`）修掉**
  （提交信息逐字点名同一个 pid `1003072`）。⇒ **写出 AC-205 的那次运行（构建 `19:50:56Z`）早于该修复 14 分钟
  ⇒ 它是「碰巧选对」，⛔ 不是「选择器已修」的读数**；新鲜度是真的，但本任务不据它声称选择器已验。

**⑥ 机制失败在哪一步（结论是「已修掉」也必须写明）**：
- **检测半边是灵的** —— `16:35:29Z` / `18:35:40Z` 两轮都产出了 finding。
- **立案半边此前缺席** —— 机械立案步 `19:26:58Z` 才落地；本任务 `19:30:42Z` 才被它立案。
- **执行半边**归派发链（DoD 第 2 条），已执行（见 ④）。
- 该缺口主题 = `gap-ac214-fifth-crossing-routine-detects-but-nothing-acts`（status done），本条不改它。

**⑦ 负控制：立案步不是无条件开火**（硬规则 3b —— 恒有输出与「在工作」同形）：
`21:20:11.726Z` 的 scan-round 独立复核了快照并对五个主体给出
`margin/K=0.980 vs threshold (0.34+2.0)*25/200=0.2925 - comfortably inside` ⇒ **正确地没有立案**
（该轮 `findings=2`，全部来自 upgrade-face 主体，⛔ 不是这五个）。

**⑧ 本任务自身未做的事（⛔ 逐条，不以沉默代替）**：
- ⛔ **未重跑产出者** —— 判据已绿、`d`=9，且 DoD 第 2 条把产出者重跑归派发链（已跑）。
- ⛔ **未改 `plugin/freshness-producers.json`** —— 逐条复核后**判定无需改**：(i) `bb03f5b96` 把 AC-205 单列
  `session-delivery` + `preconditions`，与产出者命令一致 —— `verify-deliver-coldstart.sh:5264` 的 AC-205 腿
  **显式带 `--allow-hold`**（`:5257` 注释：本腿就是要观察 held 结局本身），故 host C 的
  `delivery_outcome=held ⇒ 不落账` 正是该命令会产生的形态；(ii) host B 那两次 `failed to connect` 是
  **已修缺陷**（`3b9eac322`）的症状，把它写进登记面 = 把「已修缺陷的历史症状」记成**前置**，
  正是该文件头注释禁止的运行史/第二份拷贝，且**方向上有害**（会让读者以为 B 现在仍不可靠）。
- ⛔ 未改 K、未改 `criterion`、未动载体 `.quay/productization-verification.jsonl` / `.quay/routine-findings.jsonl`、
  未改 `files:`/`symbols:` 观测面。

**⑨ 未被本任务验证的边界（如实）**：`preconditions` 里的直接读数（host C `hold-precheck=will-hold`
⇒ `delivery_outcome=held`）**只存在于 `bb03f5b96` 的提交信息（真机实测，含逐字 Held peer message 与
单变量夹具对照）**；任何**已产出载体**的日志里都还没有该形态 —— 因为当前载体的 AC-205 证据
（构建 `19:50:56Z`）早于该机制（`21:22:59Z`）。⇒ 下一次产出者运行才会产出该形态的读数。
这是**自解**（下一轮自然产出），⛔ 不是缺口；本任务不为此另立前置（硬规则 12：给不出发生率的「必须先 X」降为观察项）。

## Touches
- `plugin/freshness-producers.json`
- `tasks/gap-routine-freshness-refresh-freshness-goal-009-ac-205.md`
