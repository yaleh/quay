---
id: gap-ac214-eleventh-crossing-repeat-remedy-rejected-by-filing-gate
title: "AC-214 第十一次转红（AC-238/239 = 201/200，margin −1）：升级面的补救 finding 自
  2026-10-09 起被立案闸【每一轮都拒】（rate 6 轮 / collision 1 轮）⇒ 产出者零次重跑；`verdict: act-now`
  + `remedyAvailability: executable` 的 finding 没有消费者"
status: done
labels:
  - gap
  - defect
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-214
---
## Finding

**判据此刻为假（本轮复跑两次，`⛔` 非引述）**：用仓库自己的 YAML 解析器（`yaml`）从 `goals/AC-214-*.md` 的 `criterion: >-` 折叠块抽出判据逐字跑（cwd = 主检出 `/data/home/yale/work/quay`）⇒ **exit 1**。stdout 逐字：

```
freshness GOAL-009-AC-201: 38/200 (margin 162)
freshness GOAL-009-AC-232: 38/200 (margin 162)
freshness GOAL-009-AC-205: 38/200 (margin 162)
freshness GOAL-009-AC-207: 38/200 (margin 162)
freshness GOAL-009-AC-203: 38/200 (margin 162)
freshness GOAL-009-AC-238: 201/200 (margin -1)
freshness GOAL-009-AC-239: 201/200 (margin -1)
```

stderr 逐字：`stale evidence: GOAL-009-AC-238:201/200 (margin -1), GOAL-009-AC-239:201/200 (margin -1)`。

**两次独立测量**：① `.quay/gate-events.jsonl` 中 `item_id=AC-214, gate=goal` 的最后一条记录 = `timestamp 2026-10-13T18:00:32.852Z`、`verdict: fail`、`payload.reason` 逐字即上面那句；② 本轮 `2026-10-13T18:01:21Z` 我方独立抽出判据复跑，逐字复现同一读数（判据自己把结果写进 `.quay/goal-freshness-margin.json`）。

**唯二越界的主体** AC-238/239 在载体 `.quay/productization-verification.jsonl`（372 行）中最新记录均为
`{"ac":"GOAL-009-AC-238","build_sha":"e0535b83c268bc6a1fe566c65409f30f0b4697ce","ts":"2026-10-09T13:18:40Z", …}`（AC-239 同 `ts` 同 `sha`）。该 sha 是 develop 祖先（`git merge-base --is-ancestor e0535b83 develop` ⇒ 真），交付面距离经 `plugin/freshness-producers.json` 的 `delivery_face.command` 实测 **201**。

**同批对照（⛔ 同一机制在两条腿上表现相反 —— 这就是根因的判别式）**：冷启动面五条 AC-201/203/205/207/232 的证据 `ts` = `2026-10-12T22:06:56Z`（AC-205 为 `21:59:06Z`），d = **38**、margin **+162** ⇒ 刷新链路对冷启动面**在跑**，对升级面**没跑**。

### 根因：升级面的补救 finding 每一轮都被【立案闸】拒，且"被拒"这件事本身没有消费者

AC-238/239 由 `plugin/freshness-producers.json` 的 `producers[2]`（`--verify-upgrade … --ac239-e2e`）产出。该产出者自 `2026-10-09T13:18:40Z` 起**一次都没再跑过**。`⛔` 挡住它的不是产出者、不是跨机前置（本轮实测 `ssh -o BatchMode=yes -o ConnectTimeout=8 yale@orangevps.wan.hwang.men 'echo OK; date -u; df -h /'` ⇒ **rc=0**、`/dev/sda1 96G 90G 6.2G 94% /`），而是**从 finding 到派发的立案链**。

`.quay/routine-findings.jsonl` 逐字（`kind=filing-round, routine=freshness-refresh`）：AC-238/239 的 finding 每轮都被生成 —— `verdict: "act-now"`、`rationale` 逐字 "…only 7 of the 200-commit window remain and the upgrade face has not produced a record since 2026-10-09"、`suggestedAction` 给出完整 argv、`remedy_availability: "executable"` —— 然后**没有一次进入 `filed`**。两类逐字拒绝：

- **`rate:`**（2026-10-13 的 **6** 个连续轮次：`03:41:42Z` / `05:41:54Z` / `09:08:35Z` / `11:08:46Z` / `13:53:35Z` / `16:03:42Z`）
  `rate: 3 routine-filed tasks this window ≥ cap 3 (subject recurrence: 26 → 31 round(s))`
  —— `plugin/scripts/routine-file-gate.ts` 的 `routineQuotaDecision`（`:255-272`）+ `countRecentFilings(…, routine)`（`:934`）把预算算成**本例程自己的 24h 尾窗**；该窗被**同一例程**为冷启动面写的三条占满（`2026-10-12T21:38:59Z` 那条 `filing-round` 的 `filed` = AC-201/203/207）。`selectFilings` 按复现次数**降序**发预算（`plugin/scripts/probe-routine.ts:396-405` 的 `recurrenceOrder`）—— AC-238/239 复现**最高**（31 轮）却仍被限流 ⇒ 载体上"复现最高的主体"与"被拒"**同形**（硬规则 3）。
- **`collision:`**（`2026-10-12T21:38:59Z`）
  `collision: tasks/gap-routine-freshness-refresh-stale-goal-009-ac-238-79f43e79.md already exists and is not this finding ⇒ not overwriting`
  —— `plugin/scripts/probe-routine.ts:485-490`：派生 id 撞车时先追加 `sha1(findingKey)` 的 8 位后缀，**后缀也撞车就直接 `reject("collision")`，没有第三条路**。该 findingId（`stale-goal-009-ac-238`）的基名 `tasks/gap-routine-freshness-refresh-stale-goal-009-ac-238.md` 与后缀名 `…-79f43e79.md` **都在盘上且都是 `done`**（`-79f43e79` 正是 2026-10-09 那次立案写出的名字 —— 同一 findingId 两次同后缀、可复现）⇒ 同一 findingId 的第三次立案在**文件名空间**里写不出来。

⇒ **两个闸都把「这条 remedy 以前立过案」当成「以后不必再立」**，而 `done` 在这里的含义是**"修完过一次"**、不是**"这个状态不会再来"**：AC-238/239 的证据会随 develop 前进**永远重新变陈旧**（这正是本 AC 的主题）。**这是「一旦转绿即永久绿」在【立案闸空间】的同构形态** —— 判据侧刚被修好（第九次改计数规则、第十次修产出者调用点），**把判据逼红的供给侧**却仍是 once-and-done。

### 为什么前几次修复没兜住（第十一次，不是第一次）

- **第八次**（`gap-ac214-eighth-crossing-done-key-permanently-suppresses-escalation`，done）只修了 `boardKeys()` 的 dedup 键无 status 维度 —— 修后 10-13 各轮 `dedup_state` 逐字 `state: "done-only"` 且**已不再是拒绝闸**（拒绝闸改由 `quality-dedup-rate` 承担）。它**没有触及同一形态的第二处**：`selectFilings` 第 ④ 步的**文件名撞车**（硬规则 5b：缺陷成簇，兄弟实例常在同一文件）。
- 第八/九/十次都在给**上一个读数**接消费者（升级通道、计数规则、产出者调用点），而**"finding 被立案闸拒"这件事本身没有消费者**：`escalate` 分支（`plugin/scripts/probe-routine.ts:449-460` 的 `remedyGatesProducer` / `blocked-repeat`）只在 `remedy_availability == blocked` 时点亮；本机现在是 `executable`（本轮 `ssh` rc=0 实测）⇒ **被拒 = 静默**，每轮的 `rejected` 记录落进同一个载体、无人消费。这正是硬规则 3b/4b 的形态：一个如实记录的拒绝，与「一切照旧」同形。
- **限流轴的既有待办已被"只钉不改"钉死**：`gap-routine-filing-rate-global-window-starves-freshness-refresh`（done）与 `gap-routine-rate-gate-board-pressure-and-quota-ownership`（done）**逐字写明**了本轮的限流轴（方案 B：窗口只数立案次数、不数板上是否还压着工作），并明确"`routine-file-gate.ts` 生产代码零改动、只加 2 条特征化测试、修复方案留给人裁定" ⇒ 该轴**已知但未修**，本轮 AC-214 转红就是它在生产上的后果。

<!-- dedup-ref -->
（去重核实：`grep -rl 'goal_ac: *AC-214' tasks/` 命中的 15 个文件**全部 `done`**，无 in-flight 重复。本任务点名的**文件名撞车**闸在 `tasks/*.md` 中 0 命中、无既有任务覆盖。相关但**不重复**：`gap-routine-rate-gate-board-pressure-and-quota-ownership`（done）覆盖限流轴的**特征化**（只钉测试、不改生产），本任务承担它的**生产后果**并新增撞车轴。）

## Requested action

1. **先把 AC-214 判真**（关掉本轮转红）：用映射声明的那一条 argv 真跑升级面产出者，直到 AC-238/239 在**主检出**载体上有 `ts` 晚于落地时刻的新记录、且判据本体 exit 0：
   `bash plugin/scripts/develop-deliver-tgz.sh --verify-upgrade --upgrade-source work/meta-cc-aged-ac238-copy --ac239-e2e --hosts B --force --root /data/home/yale/work/quay --driving-profiles <B 的网关认得的 profile>`
   `⚠️` `--driving-profiles` 必须是**目标主机 B 的网关认得**的模型名，`⛔` 不要原样推本仓 `.quay/profiles.yml`（`worker-default.model: v4.1flash-anthropic` 是驱动主机专属，B 的网关会 400）。**2026-10-09 那次成功运行的配方逐字记录在** `.quay/deliver-worktree-63ffd6a8069f/tasks/gap-routine-freshness-refresh-stale-goal-009-ac-238-79f43e79.md` 的前置表：当场生成一份 `model: deepseek-v4-pro-anthropic` 的 profile（host B 的 `claude-fjdac` 导出），并**实测该模型在 B 上可用**（`claude-fjdac -p "reply with exactly: MODEL-OK" --model deepseek-v4-pro-anthropic` ⇒ `MODEL-OK` rc=0）。
2. **修文件名空间的耗尽**（`plugin/scripts/probe-routine.ts:485-490`）：候选 id 在"基名 + 8 位哈希后缀"都撞车时，`⛔` 不得直接 `reject("collision")` 把该主体永久封印 —— 应派生一个**不会覆盖既有文件**的新 id（例如把轮次/时间戳纳入后缀），并落可审计的痕（新 id 与其派生规则）。`⛔` 仍然**绝不覆盖**既有任务体。
3. **给"反复被拒"接消费者**（硬规则 9）：一条 finding 在其主体 margin 为负、且 `remedy_availability == executable` 时，若被 `rate:`/`collision:` **连续 ≥2 轮**拒下，必须走**人可见通道**（复用既有的 `escalate`/`needs-human` 机制 —— `⛔` 不新造成因枚举，人 2026-09-20 裁定），且在载体里与"被拒一次"**不同形**（硬规则 3）。`⛔` 本任务**不裁定**限流策略本身（方案 B/C/D 的选择仍留给人）—— 它只保证"策略拒绝 ≠ 静默"。

## Disposition

**一句话**：AC-214 第十一次转红（`2026-10-13T18:00:32.852Z`，AC-238/239 = 201/200，margin −1）的**供给侧**已修 —— `⛔` 判据本身、K、主体集合、`expect` 一个字节都没动（`git diff --exit-code -- goals/` ⇒ rc=0）：升级面产出者**真跑成功**并在**主检出**载体上为 AC-238/239 各写出 `ts` 晚于落地时刻的新记录，判据本体干跑 **exit 0**、`quay goal gate AC-214` **pass**；同时，"把 remedy 的立案挡成静默"的两条闸（**文件名空间耗尽** / **限流连续拒绝**）现在各自有了消费者。

### ① AC1 改前读数（判据逐字，cwd = 主检出 `/data/home/yale/work/quay`）

判据由仓库自己的 YAML 解析器从 `goals/AC-214-*.md` 的 `criterion: >-` 折叠块逐字抽出（`node extract-criterion.mjs` → 130 行 / 6030 字节），`bash` 直跑：

```
$ bash ac214-criterion.sh            # stdout 七行
freshness GOAL-009-AC-201: 38/200 (margin 162)
freshness GOAL-009-AC-232: 38/200 (margin 162)
freshness GOAL-009-AC-205: 38/200 (margin 162)
freshness GOAL-009-AC-207: 38/200 (margin 162)
freshness GOAL-009-AC-203: 38/200 (margin 162)
freshness GOAL-009-AC-238: 201/200 (margin -1)
freshness GOAL-009-AC-239: 201/200 (margin -1)
$ echo $?
1
# stderr 逐字：
stale evidence: GOAL-009-AC-238:201/200 (margin -1), GOAL-009-AC-239:201/200 (margin -1)
```

载体 `.quay/productization-verification.jsonl` 行数 **372**（跑前 `md5 db5f8323bbe80309d7a7095e78a477c7`）。AC-238/239 最新记录（两者同 `ts` 同 `sha`）：

| ac | ts | build_sha |
|---|---|---|
| `GOAL-009-AC-238` | `2026-10-09T13:18:40Z` | `e0535b83c268bc6a1fe566c65409f30f0b4697ce` |
| `GOAL-009-AC-239` | `2026-10-09T13:18:40Z` | `e0535b83c268bc6a1fe566c65409f30f0b4697ce` |

```
$ git merge-base --is-ancestor e0535b83 develop ; echo rc=$?
rc=0                      # ⇒ 该 sha 是 develop 祖先，交付面距离由它起算
```

`.quay/goal-freshness-margin.json`（判据自己写出的快照）中两项逐字：

```json
"GOAL-009-AC-238": {"K":200,"d":201,"evidence_age_hours":100.89,"evidence_ts":"2026-10-09T13:18:40Z","margin":-1}
"GOAL-009-AC-239": {"K":200,"d":201,"evidence_age_hours":100.89,"evidence_ts":"2026-10-09T13:18:40Z","margin":-1}
```

### ② AC2 回归而非恒红

`.quay/gate-events.jsonl`（`item_id=AC-214, gate=goal`，共 12751 条）的 verdict **翻转序列**（连续去重；`ts` 为该段首条）：

```
fail 2026-09-09T06:47:59.559Z ×921    → pass 2026-09-11T03:04:48.769Z ×652
fail 2026-09-11T17:08:48.739Z ×4      → pass 2026-09-11T17:17:00.692Z ×1199
fail 2026-09-13T11:02:20.337Z ×11     → pass 2026-09-13T11:39:53.463Z ×108
fail 2026-09-13T16:54:06.892Z ×20     → pass 2026-09-13T17:49:29.362Z ×248
fail 2026-09-14T14:11:58.168Z ×11     → pass 2026-09-14T14:44:27.848Z ×53
fail 2026-09-14T17:14:37.907Z ×72     → pass 2026-09-14T23:32:42.353Z ×167
fail 2026-09-15T19:07:48.174Z ×9      → pass 2026-09-15T20:17:21.445Z ×227
fail 2026-09-17T04:05:40.109Z ×3      → pass 2026-09-17T05:08:50.335Z ×1123
fail 2026-09-24T02:48:24.110Z ×837    → pass 2026-09-25T05:22:17.401Z ×5839
fail 2026-10-08T17:00:04.535Z ×258    → pass 2026-10-09T14:40:00.311Z ×985
fail 2026-10-13T18:00:32.852Z ×4      ← 本轮（首发 2026-09-09T06:47:59.559Z，共 11 段 fail）
```

⇒ **11 段 fail、10 段 pass**，判据**不是恒红**（每次转红都被一次真修复关掉）。最近一段 pass 的最后一条事件是 `2026-10-13T17:57:15.890Z`（该段自 `2026-10-09T14:40:00.311Z` 起，985 条）。

**两次独立测量逐字相同**：① gate-event `2026-10-13T18:00:32.852Z` 的 `payload.reason` = `acceptance failed (exit 1) — stale evidence: GOAL-009-AC-238:201/200 (margin -1), GOAL-009-AC-239:201/200 (margin -1)`；② 我方独立抽出的判据复跑 stderr = `stale evidence: GOAL-009-AC-238:201/200 (margin -1), GOAL-009-AC-239:201/200 (margin -1)`。**同一句**。本轮该段共 4 条 fail（`18:00:32Z` / `18:11:40Z` / `18:18:02Z` / `18:21:32Z`，四条 reason 逐字相同）。

### ③ AC3 根因按位置 + 双侧对照

**① 载体逐字**（`.quay/routine-findings.jsonl`，routine `freshness-refresh`，只列点名 AC-238/239 的 `rejected`）：`2026-10-13` 连续 **7** 轮（不止 6 轮 —— 第 7 轮 `18:11:14.824Z` 在本轮处置期间又发生了一次）：

```
ts 2026-10-12T21:38:59.196Z  findingId=stale-goal-009-ac-238  gate=collision
  reason=collision: tasks/gap-routine-freshness-refresh-stale-goal-009-ac-238-79f43e79.md already exists and is not this finding ⇒ not overwriting
ts 2026-10-13T03:41:42.429Z  findingId=stale-goal-009-ac-238-upgrade-face  gate=quality-dedup-rate
  reason=rate: 3 routine-filed tasks this window ≥ cap 3 (subject recurrence: 26 round(s))     # AC-239 同轮 25
ts 2026-10-13T05:41:54.300Z  findingId=freshness-stale-goal-009-ac-238    gate=quality-dedup-rate
  reason=rate: 3 routine-filed tasks this window ≥ cap 3 (subject recurrence: 27 round(s))     # 26
ts 2026-10-13T09:08:35.527Z  reason=rate: … (subject recurrence: 28 round(s))                  # 27
ts 2026-10-13T11:08:46.781Z  reason=rate: … (subject recurrence: 29 round(s))                  # 28
ts 2026-10-13T13:53:35.387Z  reason=rate: … (subject recurrence: 30 round(s))                  # 29
ts 2026-10-13T16:03:42.469Z  reason=rate: … (subject recurrence: 31 round(s))                  # 30
ts 2026-10-13T18:11:14.824Z  reason=rate: … (subject recurrence: 32 round(s))                  # 31
```

⚠️ **`findingId` 逐轮不同**（`stale-goal-009-ac-238` / `…-upgrade-face` / `freshness-stale-goal-009-ac-238`）——探针每轮重新生成 slug；**这是"按主体计连续"而不是"按 findingId"的实测依据**（按 findingId 会把 7 轮读成 3 段）。

**② 改前逐字**（改后见 ④/⑤）：

```ts
// plugin/scripts/probe-routine.ts（改前，原 :518-526）
let taskId = routineTaskId(o.routine, f.id);
if (fs.existsSync(path.join(o.tasksDir, `${taskId}.md`))) {
  taskId = `${taskId}-${createHash("sha1").update(findingKey(candidate)).digest("hex").slice(0, 8)}`;
}
if (fs.existsSync(path.join(o.tasksDir, `${taskId}.md`))) {
  reject("collision", `collision: tasks/${taskId}.md already exists and is not this finding ⇒ not overwriting`);
  continue;
}
```

```ts
// plugin/scripts/routine-file-gate.ts（改前）
// :260-272 routineQuotaDecision —— 纯 Policy，把「本 routine 窗口内条数」与 cap 比：counts.perRoutine >= config.k
//          ⇒ `rate: ${n} routine-filed tasks this window ≥ cap ${k}`（本任务 ⛔ 不动这条判据）
// :934    countRecentFilings(carrierPath, nowMs, windowMs, routine) —— 分子只数**该 routine 自己**尾窗里的 `filed.length`
```

**③ 双侧对照（硬规则 4 推论四）—— 用真机件，把同一条候选对着【生产输入】跑两次**：
输入全为生产输入、无一构造 —— 候选 = 载体自己 `runId freshness-refresh-1791841139196` 的 **7 条 finding 记录全部**（该轮的真实候选集）；撞车空间 = **主检出** `tasks/`（两个文件都在盘上且都是 `done`）；rate 窗口 = 主检出载体；`nowMs` = 该轮 ts − 1ms（该轮自己的 `filing-round` 是**判定之后**才 append 的，故判定时刻它还不存在）。

```
$ node ac3-control.mjs <worktree>            # 修复在场
candidate key       = symbols:goal-009-ac-238,upgrade-face
derived base        = gap-routine-freshness-refresh-stale-goal-009-ac-238
derived hash suffix = gap-routine-freshness-refresh-stale-goal-009-ac-238-79f43e79   # 与盘上那个名字逐字相同
base on disk = true   hashed on disk = true
{ "findingId":"stale-goal-009-ac-238", "accepted":true,
  "taskId":"gap-routine-freshness-refresh-stale-goal-009-ac-238-79f43e79-r20261012T213859Z",
  "gate":"filed", "idRule":"collision-escape", "escapedFrom":"…-79f43e79" }

$ AC214_NEUTER_COLLISION_ESCAPE=1 node ac3-control.mjs <worktree>     # 同一条命令，只 neuter 那一条逃逸
{ "findingId":"stale-goal-009-ac-238", "accepted":false, "taskId":null,
  "gate":"collision", "idRule":null,
  "reason":"collision: tasks/gap-routine-freshness-refresh-stale-goal-009-ac-238-79f43e79.md is taken, its hash suffix is taken, and every collision-escape candidate is taken (COLLISION_ESCAPE_MAX=100 exhausted) ⇒ no id can be derived without overwriting an existing task body" }
```

⇒ **同一条候选：`{accept:false}` → 可获新 id**，其他一切不变。

### ④ AC4 兄弟扫描（硬规则 5b 产物）

`grep -n 'reject("collision"\|countRecentFilings\|recurrenceOrder' plugin/scripts/probe-routine.ts plugin/scripts/routine-file-gate.ts` ⇒ **13 处命中，逐条判定**：

| # | 位置 | 判定 |
|---|---|---|
| 1 | `probe-routine.ts:53` | **不适用** —— import 名，非判定点 |
| 2 | `probe-routine.ts:64` | **不适用** —— import 名 |
| 3 | `probe-routine.ts:397` | **不适用** —— 注释（`windowMs` 的文档） |
| 4 | `probe-routine.ts:435` | **已正确** —— `recurrenceOrder` 只决定**顺序**，⛔ 不是拒绝闸（本任务不动优先级） |
| 5 | `probe-routine.ts:510` | **需改 → 已改** —— 逃逸空间**耗尽**才走到这里的 `reject("collision")`（改前是唯一出口；改后是第 3 级仍不可用时的具名兜底，reason 说得出"耗尽"） |
| 6 | `probe-routine.ts:539` | **已正确** —— per-routine 读数是**人已裁定保留**的轴（`gap-routine-filing-rate-global-window-starves-freshness-refresh` 的方案 A）；本任务 ⛔ 不裁定限流策略 |
| 7 | `probe-routine.ts:541` | **已正确** —— 全局读数同上 |
| 8 | `probe-routine.ts:619` | **需改 → 已改** —— 同 #5（第 ④ 步的另一出口） |
| 9 | `routine-file-gate.ts:230` | **已正确** —— `recurrenceOrder` 定义处 |
| 10 | `routine-file-gate.ts:331` | **不适用** —— 注释 |
| 11 | `routine-file-gate.ts:668` | **不适用** —— 注释 |
| 12 | `routine-file-gate.ts:806` | **不适用** —— 本任务新写的注释（说明 #5 的来由） |
| 13 | `routine-file-gate.ts:1182` | **已正确** —— `countRecentFilings` 定义处 |

⇒ 命中 **13**，"需改" **2**（同一缺陷的兄弟实例，同在第 ④ 步的两个出口），均**已改**。
**同族第二个兄弟（同一函数内、不在 grep 的三条模式里）**：`routineTaskId(routine, findingId)` 的 id 派生只有**两级**（基名 → 哈希后缀），而哈希后缀是 finding 的纯函数 ⇒ 与"一旦转绿即永久绿"**同构**：同一个主体永远撞同一对名字。本次一并修（第 3 级 + `collisionEscapeId`），**不覆盖既有任务体**由 `exists` 谓词逐级保证。

### ⑤ AC5 真跑产出者刷新证据（读**生产载体**）

逐字命令（`--driving-profiles` 是 **host B 的网关认得**的 profile：`model: deepseek-v4-pro-anthropic` + 三个 `ANTHROPIC_DEFAULT_*_MODEL` 对齐 B 的 `claude-fjdac` 导出；本仓 `.quay/profiles.yml` 的 `v4.1flash-anthropic` 是驱动主机专属，⛔ 没推过去）：

```
$ ssh -o BatchMode=yes -o ConnectTimeout=8 yale@orangevps.wan.hwang.men 'echo PROBE-OK; hostname; df -h /'
PROBE-OK / orangevps / /dev/sda1 96G 90G 6.2G 94% /                                  # rc=0（前置 0/1/2 逐条复核）
$ ssh … 'export PATH="$HOME/.local/bin:$PATH"; claude-fjdac -p "reply with exactly: MODEL-OK" --model deepseek-v4-pro-anthropic'
MODEL-OK                                                                              # rc=0（非致命 unrecognized_model 装饰警告）
$ bash plugin/scripts/develop-deliver-tgz.sh --verify-upgrade \
    --upgrade-source work/meta-cc-aged-ac238-copy --ac239-e2e --hosts B --force \
    --root /data/home/yale/work/quay \
    --driving-profiles /home/yale/work/ac214-eleventh-evidence/driving-profiles-b.yml
```

逐字读数（`rc=0`）：

```
develop-deliver: --verify-upgrade develop=d7381ed6e025 build_date=2026-10-14T02:09:19+08:00 source=$HOME/work/meta-cc-aged-ac238-copy
develop-deliver: B (orangevps.wan.hwang.men) remote stdout persisted → .quay/verify-upgrade-remote-B-d7381ed6.log (rc=0)
EVIDENCE-TRANSPORT appended=4 carrier=/data/home/yale/work/quay/.quay/productization-verification.jsonl evidence=…/verify-upgrade-evidence-B-d7381ed6.jsonl
develop-deliver: evidence-completeness COMPLETE present=2
develop-deliver: B (orangevps.wan.hwang.men) — declared ac set [GOAL-009-AC-238 GOAL-009-AC-239] transported into …/productization-verification.jsonl ✓
develop-deliver: upgrade-pairing UPGRADE-PAIR OK host=orangevps roots=/home/yale/quay-verify-upgrade-d7381ed6-root
develop-deliver: --verify-upgrade OK — GOAL-009-AC-238 record transported …
```

远端日志（`.quay/verify-upgrade-remote-B-d7381ed6.log`）关键行：`upgrade action: shipped quay-init (config-preserving branch) rc=0`（2026-10-09 那次是 **rc=1**，本轮的 `8d382f8a1` 已修）；`[⑦b] poll finished: task_status=done (poll window 3600s)`；`[⑦b] task_status=done commit_sha=d8b06faf6cad … gate_events=157 produced_by_driver=1 evaluated=1`。

**主检出载体**（372 → **376** 行，`md5 0d38cb03fcf072adefed93b1110d3dcf`）：

```
GOAL-009-AC-238: 1 record(s) newer than landing (landing = 2026-10-13T18:09:19Z)
   ts=2026-10-13T18:18:10Z  build_sha=d7381ed6e0254dcbdb43a38d312dd91d63306ad4  runtime_replaced=true  upgrade_init_rc=0
GOAL-009-AC-239: 1 record(s) newer than landing
   ts=2026-10-13T18:18:10Z  build_sha=d7381ed6e0254dcbdb43a38d312dd91d63306ad4  task_id=ac239-subagent-session-id-scan  task_status=done
```

⇒ 两个主体**各 ≥1 条** `ts` 晚于落地时刻的新记录，且是**产出者跑出来的**（⛔ 不是夹具、⛔ 不是手写：见 ⑧ 的逐字节归因）。

### ⑥ AC6 判据本体干跑

```
$ bash ac214-criterion.sh ; echo $?        # 与 ① 同一个文件（criterion 逐字）
freshness GOAL-009-AC-201: 1/200 (margin 199)
freshness GOAL-009-AC-232: 39/200 (margin 161)
freshness GOAL-009-AC-205: 39/200 (margin 161)
freshness GOAL-009-AC-207: 39/200 (margin 161)
freshness GOAL-009-AC-203: 39/200 (margin 161)
freshness GOAL-009-AC-238: 1/200 (margin 199)
freshness GOAL-009-AC-239: 1/200 (margin 199)
0
$ node packages/quay/bin/quay.js goal gate AC-214 --root .
{ "item_id":"AC-214", "gate":"goal", "verdict":"pass",
  "timestamp":"2026-10-13T18:28:47.839Z",
  "payload":{"reason":"acceptance passed (exit 0)","evaluationRoot":"/data/home/yale/work/quay","treeSha":"f2d1595c334cf2476519ef282b9352365c24686a"} }
EXIT=0
```

⛔ **不是**靠改 K / 删主体 / 改 `expect` / 改 `criterion`：`git diff --exit-code -- goals/` ⇒ **rc=0**；`NEED` 七条一条不少，七行全正。

### ⑦ AC7 机制半边**能取假**（正/负两次读数）

新增 6 条判定（`plugin/test/routine-file-gate.test.mjs` 的 ⑱–㉓ + `plugin/test/probe-routine.test.mjs` 的 FILING ⑪a/⑪b ×4），**每一条都有反面对照**：

- **id 空间**：`FILING ⑪a` 用**盘上真名字**（`routineTaskId` + `sha1(findingKey)[0:8]` 两个纯函数重建，与 21:38 那条记录逐字同名）造出"基名 + 哈希后缀都被占"，断言 **① 第 ≥3 次立案拿到第三级新 id**；**② 两个既有任务体逐字节未变**；**③ 载体 `filing-round.id_derivation` 记下新 id 与其派生规则**。反向：只占基名 ⇒ 仍是**老的**哈希后缀（`rule:"hash-suffix"`，⛔ 逃逸没有顶替既有规则）。
- **连续被拒**：`FILING ⑪b` 断言 margin<0 + remedy `executable` + 连续第 2 次限流拒绝 ⇒ 立案落 `needs-human`、标题带 `[repeat-rejected] `、`## Finding` 第一行是**另一种** marker、载体 `escalated` 有它而 `rejected` **没有**。反向两条：**首次拒绝**（`priorRateRejections:0`）⇒ 普通 `rate:` 拒绝、不立案；**margin 非负**（`+7`）⇒ 同样不立案（⛔ 这条挡住"升级变成限流绕过"），但 reason 里留下 `throttle-rejection #2 in a row (subject margin 7)` ⇒ 「拒绝一次」与「连续拒绝」在载体上**不同形**。第三条：升级已在板上 ⇒ 第三轮落 `blocked-repeat` 并**指名**那个文件。

**neuter ⇒ 红，恢复 ⇒ 绿**（两条轴各一次，同一份文件字节、只多一个 env 开关；neuter 后与 green 备份 `diff -q` 逐字节相同）：

```
green : node --test routine-file-gate.test.mjs probe-routine.test.mjs        ⇒ tests 57 / pass 57 / fail 0
neuter①: AC214_NEUTER_COLLISION_ESCAPE=1   …（collisionEscapeId → null）      ⇒ pass 54 / FAIL 3
         ✖ ⑲ collisionEscapeId …   ✖ ㉓ routineTaskId + collisionEscapeId …   ✖ FILING ⑪a …
neuter②: AC214_NEUTER_REPEAT_ESCALATION=1 …（repeatRejectionDecision → 恒 false）⇒ pass 54 / FAIL 3
         ✖ ㉑ repeatRejectionDecision … ✖ FILING ⑪b（两条）
restore: diff -q … 与 green 备份 ⇒ identical；全量复跑 ⇒ pass 57 / fail 0
```

`bash scripts/test.sh --for-task gap-ac214-eleventh-crossing-repeat-remedy-rejected-by-filing-gate --allow-thin` ⇒ **exit 0**（scoped 静态检查全过 + 61 用例全绿）。

**实现（按位置）**：
- `plugin/scripts/routine-file-gate.ts`：新增 `collisionEscapeId`（第 3 级 id 派生：`base-<sha1(findingKey)[0:8]>` 也被占时追加**该轮自己的 UTC 戳**，`exists` 谓词注入、⛔ 绝不返回已存在的名字，`COLLISION_ESCAPE_MAX` 用尽返回 `null`）、`isThrottleRejection`、`throttleRejectionStreakByKey`（按**主体**数连续拒绝轮次，三值：读不出 ⇒ `null`）、`repeatRejectionDecision`（四个前提各自可假，未评估独立取值）、`repeatRejectionMarkerLine` + 读取端一条正则认**两种** marker、`renderRoutineTaskBody` 的 `repeatRejection` 形态。
- `plugin/scripts/probe-routine.ts`：`ProbeFinding.margin`（探针契约里**本来就有**、此前被解析器丢掉的字段）；`selectFilings` 的 ④ 用单一实现 `deriveFilingTaskId`（三级），③ 之后新增「连续被拒 ⇒ 人可见通道」，`fileOnHumanChannel` 收 `blocked` 与 `repeat-rejection` 两种形态（⛔ 不写第二份）；载体新增 `filing-round.id_derivation` / `escalated_repeat_rejection` / `finding.margin`。
- ⛔ **未做**：改 `routineQuotaDecision` / `countRecentFilings` 的限流策略；新增 `needs-human` 成因枚举；新增"可机械再入队"路径（人 2026-09-20 裁定）；改 `goals/`、`plugin/freshness-producers.json`。

### ⑧ AC8 未改判据 / 无手写搬运

- `git diff --exit-code -- goals/` ⇒ **rc=0**（主检出与 worktree 各一次）。
- `.quay/productization-verification.jsonl`：跑判据前 `372` 行 / `md5 db5f8323bbe80309d7a7095e78a477c7`；AC5 之后 `376` 行 / `md5 0d38cb03fcf072adefed93b1110d3dcf`。新增的 **4 条**与远端 `~/quay-verify-upgrade-evidence-d7381ed6.jsonl` **排序后逐字节相同**（`diff` 空）⇒ 差异**只**来自产出者自己的传输，⛔ 无手写、无搬运行、无改写。
- ⛔ 本任务**未**运行任何"补证据"脚本，未删除载体任何一行；AC-238/239 的两条记录由 `develop-deliver-tgz.sh` 的 `EVIDENCE-TRANSPORT` 写成。

## AC

- [x] AC1 改前读数（能取假，复跑 `⛔` 非引述）：抽出 `goals/AC-214-*.md` 的 `criterion:` 折叠块逐字跑 ⇒ **exit 1**；贴 stdout 七行 + stderr 逐字 + `.quay/productization-verification.jsonl` 行数（372）与 AC-238/239 最新记录的 `(ts, build_sha)` 表 + `git merge-base --is-ancestor e0535b83 develop` 的退出码 + `.quay/goal-freshness-margin.json` 中 AC-238/239 两项全文。
- [x] AC2 回归而非恒红：贴 `.quay/gate-events.jsonl`（`item_id=AC-214, gate=goal`）的 verdict **翻转序列**（连续去重）：11 次 fail（首发 `2026-09-09T06:47:59.559Z`，本轮 `2026-10-13T18:00:32.852Z`）与期间的 pass（最近一条 `2026-10-09T14:40:00.311Z`）；并逐字给出**两次独立测量**（gate-event 的 `payload.reason` 与 AC1 的复跑读数相同）。
- [x] AC3 根因按位置 + **双侧对照**（硬规则 4 推论四）：① 贴 `.quay/routine-findings.jsonl` 中 `2026-10-13` 的 6 条 `filing-round` 的 `rejected` 逐字（含 `rate:` 前缀、cap、`subject recurrence` 计数），与 `2026-10-12T21:38:59Z` 那条的 `collision:` 逐字；② 贴 `probe-routine.ts:485-490` 与 `routine-file-gate.ts:255-272` / `:934` 的改前逐字；③ **对照**：用真机件把 done-owned 的撞车文件从判定输入里拿掉（或 neuter 那一条 `reject("collision")`），证明**同一条候选**由 `{accept:false}` 变为可获新 id —— 两侧逐字读数。给不出对照 ⇒ 本条降为假说。
- [x] AC4 兄弟扫描（硬规则 5b 产物）：`grep -n 'reject("collision"\|countRecentFilings\|recurrenceOrder' plugin/scripts/probe-routine.ts plugin/scripts/routine-file-gate.ts` 的**全部**命中逐条判定（"需改 / 已正确 / 不适用"），命中数与"需改"数一并贴出。
- [x] AC5 真跑产出者刷新证据（硬规则 4 推论三：读**生产载体**）：贴逐字命令、rc、`EVIDENCE-TRANSPORT` 行，以及**主检出** `.quay/productization-verification.jsonl` 中 `ac ∈ {GOAL-009-AC-238, GOAL-009-AC-239}` 且 `ts` **晚于落地时刻**的新记录**各 ≥1**（打印条数与前 3 条）。"载体里有记录"不算；夹具/注入读数不算。
- [x] AC6 判据本体干跑 **exit 0**（七行 margin 全正）+ `node packages/quay/bin/quay.js goal gate AC-214 --root .` exit 0。`⛔` 通过改 K / 删主体 / 改 `expect` / 改 `criterion` 达成不算。
- [x] AC7 机制半边**能取假**（正/负两次读数）：新增/扩展的测试断言「同一主体、同一 findingId 的第 N(≥3) 次立案能拿到一个不覆盖既有文件的新 id」与「连续 ≥2 轮被拒 ⇒ 走人可见通道」；把对应修复 neuter 掉 ⇒ **转红**，恢复 ⇒ 绿。贴两次读数 + `bash scripts/test.sh --for-task <本任务 id>` exit 0。
- [x] AC8 未改判据 / 无手写搬运：`git diff --exit-code -- goals/` 为空；跑判据前后 `.quay/productization-verification.jsonl` 的差异**只**来自 AC5 的新记录（`md5sum` + 行数）；`⛔` 无手写/搬运证据记录。

## DoD

**真实落地 = 升级面产出者真跑、AC-214 判据本体干跑 exit 0、且"重复被拒"这条路现在有消费者。**

- `plugin/scripts/develop-deliver-tgz.sh --verify-upgrade --upgrade-source work/meta-cc-aged-ac238-copy --ac239-e2e --hosts B --force …` **真跑一次**（跨机，host B），在**主检出**载体上为 AC-238 与 AC-239 **各**写出 `ts` 晚于落地时刻的新记录。
- AC-214 判据本体（criterion 逐字，cwd = 主检出）干跑 **exit 0**（七行 margin 全正），`quay goal gate AC-214 --root .` exit 0。
- `selectFilings` 在"基名 + 哈希后缀"都撞车时不再 `reject("collision")` 封印主体，而是派生新 id（有可审计落痕），且**从不覆盖**既有任务体；"连续 ≥2 轮被 `rate:`/`collision:` 拒且 margin 为负"的 finding 走人可见通道、且载体上与"被拒一次"不同形。
- 一条**能取假**的测试钉住上一条（neuter ⇒ 红，恢复 ⇒ 绿）。
- `goals/` 零 diff；`⛔` 未手写/搬运任何证据记录。
- `⛔` **不接受的替代物**：改 K / 删主体 / 改 `expect` 或 `criterion`；手写或搬运证据记录；只改一处闸；只把运行史写进 `plugin/freshness-producers.json`；把 AC5 降格成夹具读数；`⛔` 新增任何 needs-human 成因枚举或"可机械再入队"路径（人 2026-09-20 裁定）；`⛔` 本任务不裁定限流策略本身（方案 B/C/D 留给人）。

## Touches

- plugin/scripts/probe-routine.ts
- plugin/scripts/routine-file-gate.ts
- plugin/probes/freshness-refresh.md
- plugin/test/probe-routine.test.mjs
- plugin/test/routine-file-gate.test.mjs
- tasks/gap-ac214-eleventh-crossing-repeat-remedy-rejected-by-filing-gate.md（自身文件：勾 AC + 贴实跑证据）
- .quay/productization-verification.jsonl（gitignored：产出者 append 的落点；`⛔` 非可提交物）
