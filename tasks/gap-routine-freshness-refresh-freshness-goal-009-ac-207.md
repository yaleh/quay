---
id: gap-routine-freshness-refresh-freshness-goal-009-ac-207
title: "freshness-refresh: delivery-face evidence for AC-207 (build_sha
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
delivery-face evidence for AC-207 (build_sha f19397c6, 2026-09-14T14:25:05Z) is d=190 commits behind the develop tip; only 10 commits of margin remain against the 42.12 commits (2.34h) a coldstart-face run plus one observation interval needs to land inside K=200.

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
- [x] `.quay/routine-findings.jsonl` 中 finding `freshness-goal-009-ac-207`（routine `freshness-refresh`，runId `freshness-refresh-1789490129772`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence

**处置 = 【已修掉】（⛔ 不是观察项）。判据能取假，四处独立读数互相印证。**

| 量 | 立案时（finding runId `freshness-refresh-1789490129772`，ts `16:35:29.772Z`） | 本次复核（`2026-09-15T22:2xZ`） |
|---|---|---|
| 主体最新载体记录的 `build_sha` | `f19397c66473698968f016bcfce916c388b5d7fb` @ `2026-09-14T14:25:05Z`（host `orangevps`） | `5c55ada8b391ecc45e250076baeb3f332caff04d` @ `2026-09-15T20:18:36Z`（host `instance-20221019-1509`） |
| `d`（交付面提交距离，K=200） | **190**（第二轮 `18:35:40.613Z` 读到 **192**） | **9** |
| `margin = K − d` | **10**（→ 8） | **191** |
| 探针阈值 `(W+I)×R` | 42.12 提交（finding 自身 `rationale` 逐字） | 42.12 提交（不变） |
| AC-214 判据退出码 | （`19:13:51.904Z` 转红，见 ④） | **0（pass）** |

**① 判据本体逐字跑**（从 `goals/AC-214-交付证据必须新鲜-…md` frontmatter 的折叠块 `criterion:` 用
`YAML.parseAllDocuments()[0]` 取出后 `bash` 执行，⛔ 不是引述；cwd = **主检出** —— 载体
`.quay/productization-verification.jsonl` 是 gitignored 运行产物，只在主检出存在；stdout 逐字）：

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
（`packages/quay/package.json` 的 `files` 映射 + `plugin` + `packages/quay-native/src`，共 **10** 条，
⛔ 不手写清单）：`git rev-list --count 5c55ada8b391..develop -- <paths>` = **9**（与判据读数一致）。
**负控制（硬规则 4「能取假」）**：同一谓词对 finding 自己钉的 pre-fix sha 干跑 ⇒
`f19397c6..develop` = **210 > K=200** ⇒ 判据在该 sha 上确实会红，**不是恒绿**。
`git merge-base --is-ancestor 5c55ada8b391 develop` = **YES**（血缘成立，不是孤立提交）。

**③ 产出者确实跨机跑过、且两机都产出**（⛔ 不靠「记录存在」反推）：`19:18:53Z`–`20:18:36Z` 之间本主体共写出
**6 条**载体记录（两机 × 两个构建）：

| ts | build_sha | host |
|---|---|---|
| `19:18:53Z` / `19:37:21Z` | `c529e4258b44` | `orangevps`（B） |
| `19:29:36Z` / `19:44:58Z` | `c529e4258b44` | `instance-20221019-1509`（C） |
| `20:06:42Z` | `5c55ada8b391` | `orangevps`（B） |
| `20:18:36Z` | `5c55ada8b391` | `instance-20221019-1509`（C） |

最新记录全文（逐字）：
```
{"build_sha":"5c55ada8b391ecc45e250076baeb3f332caff04d","ts":"2026-09-15T20:18:36Z","ac":"GOAL-009-AC-207","host":"instance-20221019-1509","project_root":"/home/yale/quay-verify-coldstart-5c55ada8-root","commit_sha":"3a483de280f7a8d6a1fa7c18775b54849a9a102d","commit_files":["e2e-marker.txt"],"task_id":"e2e-verify-207","task_status":"done","gate_events":1,"produced_by_driver":true}
```

两机远端日志同步块逐字（`.quay/verify-coldstart-remote-{B,C}-5c55ada8.log`，两机均 `VERIFY-RC 0`）：
```
== ⑤ end-to-end (AC-207): third-party project's own *-drivers drive a real commit → task done ==
  task_status=done commit_sha=3a483de280f7 commit_files=["e2e-marker.txt"] gate_events=1 produced_by_driver=1 evaluated=1 host=...
  ac207 record written → /home/yale/quay-verify-coldstart-evidence-5c55ada8.jsonl
E2E_CLOSURE_SELF_EVIDENCED=1
E2E_CLOSURE_AC203_WRITTEN_THIS_RUN=1 E2E_CLOSURE_AC207_WRITTEN_THIS_RUN=1
E2E_CLOSURE_AC203_ROOT=/home/yale/quay-verify-coldstart-5c55ada8-root E2E_CLOSURE_AC207_ROOT=/home/yale/quay-verify-coldstart-5c55ada8-root
```

**闭环自证独立复核**（⛔ 不采信 `E2E_CLOSURE_*` 自报值）：对 build `5c55ada8`，载体里 AC-203 与 AC-207 的
`project_root` **同为** `/home/yale/quay-verify-coldstart-5c55ada8-root`，两机各一对 ⇒
「同一个真实第三方项目被它自己的 \*-drivers 驱动到 done」这条直接量成立。

**⟂ AC-207 与 AC-205 的差异（本主体独有，⛔ 不要把 AC-205 的 `preconditions` 套到本主体上）**：
`plugin/freshness-producers.json` 把 AC-207 归 `coldstart-face`（与 201/203/232 同组），⛔ 不是 `session-delivery`。
证据：同一轮运行里 host C 的 **AC-205 腿**逐字 `transcript_confirmed=0 … NOTE: AC-205 record NOT written`（held），
而**同一次运行的 AC-207 腿在 C 上照常写出** ⇒ AC-207 **不含**「验证机上必须有一个活会话」那条前置，
「重跑即刷新」对它是完整的。这也解释了为什么 C 上 AC-207 有记录而 AC-205 没有。

**④ 谁修的（⛔ 不是本任务）**：产出者重跑由**派发链**执行，执行者 = `gap-ac214-fifth-crossing-routine-detects-but-nothing-acts`
的 worker。时间线（全部取自载体 `ts` / `git log` / 远端日志，可逐条复核）：

| 时刻 | 事件 |
|---|---|
| `16:35:29.772Z` / `18:35:40.613Z` | 例程**两轮**把本 finding 追加进载体（`d`=190 → 192） |
| `19:13:51.904Z` | AC-214 判据**转红**（`reason` 含四条 stale 主体；上一次 pass = `18:57:13.313Z`） |
| `19:26:58Z` | commit `4c7e5c230` 落地：机械立案步接进 `probe-routine.ts`（**此前 finding 只进载体、不成任务**） |
| `19:30:43Z` | 本任务被该通道立案（`14134b6d8`） |
| `19:18:53Z`–`20:18:36Z` | 派发链跑产出者 **6 次**（两机 × 两构建）；最后一次 `20:05:20Z`→`20:25:28Z`，~20m08s |
| `20:06:42Z` / `20:18:36Z` | **AC-207 的刷新记录落账**（B / C） |
| `20:56:34Z` | todo→ready（`91da932fc`），派发到本 worker |

⇒ **本任务立案（19:30:43Z）早于它最终描述的陈旧被修掉（`20:06:42Z`/`20:18:36Z`）**，
且首条新鲜记录（`19:18:53Z`）也早于立案 12 分钟 —— 这一次不是「迟到立案」，
而是**产出者与立案并行、产出者后到**。判据在 `19:13:51Z` 确实红过 ⇒ 检测侧没有误报。

**⑤ 机制失败在哪一步（结论是「已修掉」也必须写明）**：
- **检测半边是灵的** —— `16:35:29.772Z` / `18:35:40.613Z` 两轮都产出了 finding，且 `19:13:51Z` 判据真的红过。
- **立案半边此前缺席** —— 机械立案步 `19:26:58Z`（`4c7e5c230`）才落地；本任务 `19:30:43Z` 才被它立案。
  **这是本 finding 与其处置之间唯一真实的一段延迟**（检测 `16:35` → 立案 `19:30`，≈2h55m），根因即该缺口，**已 done**。
- **执行半边**归派发链（DoD 第 2 条），已执行（见 ④）。
- 该缺口主题 = `gap-ac214-fifth-crossing-routine-detects-but-nothing-acts`（status done），本条不改它。

**⑥ AC-207 腿上的 `NOTE: goal write failed` 不是新缺口（逐字复核后判定，⛔ 不另立任务）**：
两机日志的 ⑤ 段都打印 `NOTE: goal write failed — 双载体 goal 侧未落地（不阻塞任务侧；AC-207 记录只读 task 侧）`。
核 `plugin/scripts/verify-deliver-coldstart.sh:1261`：该 NOTE 是脚本**自己声明的不阻塞路径**
（同段 `:1263` 对 task create 才是 fail-closed）；且根因与处置**已登记在册**：
`tasks/gap-ac232-downstream-goal-carrier-write-readback.md`（status **done**，其 Finding 逐字引用了同一条 NOTE，
根因 = `goal write` 缺 body ⇒ `goal-store.ts` `MIN_GOAL_BODY_CHARS=40` 拒绝）。
⇒ **已有机制在管、且已修**，本任务 ⛔ 不重复立案。

**⑦ 负控制：立案步不是无条件开火**（硬规则 3b —— 恒有输出与「在工作」同形）：
`21:20:11.726Z` 的 scan-round 独立复核了快照并对五个 coldstart-face 主体给出
`margin/K=0.980 vs threshold (0.34+2.0)*25/200=0.2925 - comfortably inside` ⇒ **正确地没有立案**
（该轮 `findings` 全部来自 upgrade-face 主体，⛔ 不是这五个）。

**⑧ 本任务自身未做的事（⛔ 逐条，不以沉默代替）**：
- ⛔ **未重跑产出者** —— 判据已绿、`d`=9，且 DoD 第 2 条把产出者重跑归派发链（已跑）。
- ⛔ **未改 `plugin/freshness-producers.json`** —— 逐条复核后**判定无需改**：AC-207 归 `coldstart-face`
  （与 201/203/232 同组），命令与登记一致、`wallclock_hours: 0.34` 与本次实测 ~20m08s 同量级、
  **不带** `preconditions`（见 ③ 的 ⟂ 段 —— 实际也不需要）。把它并进 `session-delivery` 那组会是**错的**
  （那条带着「验证机上必须有一个活会话」的前置，AC-207 不受此限）。
- ⛔ 未改 K、未改 `criterion`、未动载体 `.quay/productization-verification.jsonl` / `.quay/routine-findings.jsonl`、
  未改 `files:`/`symbols:` 观测面。

**⑨ 未被本任务验证的边界（如实）**：
- 本主体的 `d` 是**时点量** —— `d`=9 是 `22:2xZ` 读到的那一刻；develop 每前进一提交它就 +1。
  本任务**不**声称「窗口此后再不会收窄」（那是判据每轮的职责，不是本任务的）。
- 本任务的**处置**是「已修掉」而非「本任务修掉了它」—— 修复由派发链在 `19:18Z`–`20:18Z` 完成，早于本 worker 启动。

## Touches
- `plugin/freshness-producers.json`
- `tasks/gap-routine-freshness-refresh-freshness-goal-009-ac-207.md`