---
id: gap-ac214-eleventh-crossing-repeat-remedy-rejected-by-filing-gate
title: "AC-214 第十一次转红（AC-238/239 = 201/200，margin −1）：升级面的补救 finding 自
  2026-10-09 起被立案闸【每一轮都拒】（rate 6 轮 / collision 1 轮）⇒ 产出者零次重跑；`verdict: act-now`
  + `remedyAvailability: executable` 的 finding 没有消费者"
status: ready
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

## AC

- [ ] AC1 改前读数（能取假，复跑 `⛔` 非引述）：抽出 `goals/AC-214-*.md` 的 `criterion:` 折叠块逐字跑 ⇒ **exit 1**；贴 stdout 七行 + stderr 逐字 + `.quay/productization-verification.jsonl` 行数（372）与 AC-238/239 最新记录的 `(ts, build_sha)` 表 + `git merge-base --is-ancestor e0535b83 develop` 的退出码 + `.quay/goal-freshness-margin.json` 中 AC-238/239 两项全文。
- [ ] AC2 回归而非恒红：贴 `.quay/gate-events.jsonl`（`item_id=AC-214, gate=goal`）的 verdict **翻转序列**（连续去重）：11 次 fail（首发 `2026-09-09T06:47:59.559Z`，本轮 `2026-10-13T18:00:32.852Z`）与期间的 pass（最近一条 `2026-10-09T14:40:00.311Z`）；并逐字给出**两次独立测量**（gate-event 的 `payload.reason` 与 AC1 的复跑读数相同）。
- [ ] AC3 根因按位置 + **双侧对照**（硬规则 4 推论四）：① 贴 `.quay/routine-findings.jsonl` 中 `2026-10-13` 的 6 条 `filing-round` 的 `rejected` 逐字（含 `rate:` 前缀、cap、`subject recurrence` 计数），与 `2026-10-12T21:38:59Z` 那条的 `collision:` 逐字；② 贴 `probe-routine.ts:485-490` 与 `routine-file-gate.ts:255-272` / `:934` 的改前逐字；③ **对照**：用真机件把 done-owned 的撞车文件从判定输入里拿掉（或 neuter 那一条 `reject("collision")`），证明**同一条候选**由 `{accept:false}` 变为可获新 id —— 两侧逐字读数。给不出对照 ⇒ 本条降为假说。
- [ ] AC4 兄弟扫描（硬规则 5b 产物）：`grep -n 'reject("collision"\|countRecentFilings\|recurrenceOrder' plugin/scripts/probe-routine.ts plugin/scripts/routine-file-gate.ts` 的**全部**命中逐条判定（"需改 / 已正确 / 不适用"），命中数与"需改"数一并贴出。
- [ ] AC5 真跑产出者刷新证据（硬规则 4 推论三：读**生产载体**）：贴逐字命令、rc、`EVIDENCE-TRANSPORT` 行，以及**主检出** `.quay/productization-verification.jsonl` 中 `ac ∈ {GOAL-009-AC-238, GOAL-009-AC-239}` 且 `ts` **晚于落地时刻**的新记录**各 ≥1**（打印条数与前 3 条）。"载体里有记录"不算；夹具/注入读数不算。
- [ ] AC6 判据本体干跑 **exit 0**（七行 margin 全正）+ `node packages/quay/bin/quay.js goal gate AC-214 --root .` exit 0。`⛔` 通过改 K / 删主体 / 改 `expect` / 改 `criterion` 达成不算。
- [ ] AC7 机制半边**能取假**（正/负两次读数）：新增/扩展的测试断言「同一主体、同一 findingId 的第 N(≥3) 次立案能拿到一个不覆盖既有文件的新 id」与「连续 ≥2 轮被拒 ⇒ 走人可见通道」；把对应修复 neuter 掉 ⇒ **转红**，恢复 ⇒ 绿。贴两次读数 + `bash scripts/test.sh --for-task <本任务 id>` exit 0。
- [ ] AC8 未改判据 / 无手写搬运：`git diff --exit-code -- goals/` 为空；跑判据前后 `.quay/productization-verification.jsonl` 的差异**只**来自 AC5 的新记录（`md5sum` + 行数）；`⛔` 无手写/搬运证据记录。

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
