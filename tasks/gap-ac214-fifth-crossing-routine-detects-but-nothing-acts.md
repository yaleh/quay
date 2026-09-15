---
id: gap-ac214-fifth-crossing-routine-detects-but-nothing-acts
title: AC-214 第五次转红（冷启动面 AC-203/205/207/232 = 201/200，margin
  −1）：第四次任务建的「刷新动作机械化」只机械化了【检测】——freshness-refresh 例程今日跑了 9 次、报了 30+ 条 stale 主体
  finding 落进 .quay/routine-findings.jsonl，而该载体【没有消费者】，10.5 小时预警窗内零动作
status: todo
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

**判据此刻为假（复跑读数，非引述）**：`bash /tmp/ac214-criterion.sh` ⇒ `EXIT=1`，逐字 stderr：
`stale evidence: GOAL-009-AC-232:201/200 (margin -1), GOAL-009-AC-205:201/200 (margin -1), GOAL-009-AC-207:201/200 (margin -1), GOAL-009-AC-203:201/200 (margin -1)`
stdout 七行：`AC-201/238/239 = 123/200 (margin 77)`；`AC-203/205/207/232 = 201/200 (margin −1)`。

**这是第 5 次越界，且不是恒红**：`.quay/goal-round.jsonl` 中 AC-214 的**最后一次 pass = 2026-09-15T18:57:13.313Z**，本次复跑（2026-09-15T19:0xZ）已 fail ⇒ 刚发生的回归。四次历史的关闭动作与主体见 `tasks/gap-ac214-upgrade-face-refresh-and-mechanical-freshness-trigger.md` 与 `tasks/gap-ac214-coldstart-face-evidence-aged-past-k-third-crossing.md`：01 冷启动面 → 02 升级面 → 03 冷启动面（202/200）→ 04 升级面（202/200），**本条是第 5 次，主体回到冷启动面**。

**本次与第 4 次的区别（这是本条的全部要点）**：第 4 次任务的 DoD 逐字要求「让缺口不再第 5 次出现」，其交付物是**刷新动作的机械化**——`plugin/probes/freshness-refresh.md` + `plugin/freshness-producers.json` + `.quay/config.yml` 的 `loop.routines` 条目（`trigger: interval:120m`）+ `plugin/scripts/freshness-producer-coverage-check.ts`。**该机制【确实跑起来了、也确实检测到了】**，实测（`.quay/quality-round.jsonl` 中 `facts[].name=="freshness-refresh"`）：

| 轮 | 时刻 (UTC) | findings | state |
|---|---|---|---|
| 1 | 02:17:52 | 0 | verified |
| 72 | 04:26:37 | 0 | verified |
| 148 | 06:28:12 | 0 | verified |
| **248** | **08:30:28** | **4** | verified |
| 323 | 10:29:47 | 4 | verified |
| 390 | 12:31:57 | 4 | verified |
| **473** | **14:36:50** | **6** | verified |
| 532 | 16:36:38 | 4 | verified |
| 617 | 18:37:51 | 4 | verified |

⇒ **interval:120m 被遵守（实际 ~2h 一次），且从 08:30 起就持续报出 4–6 条 stale 主体 finding。** 载体 `.quay/routine-findings.jsonl` 现在直接读得到 8 条 freshness finding（16:35 / 18:35 两轮各 4 条 `stale-subject`），与 scan-round 的 `inventory.subjects_filed: 4` 相符。

**⇒ 缺陷不在检测，在【检测没有动作面】。** 该例程的**机械通道**（`plugin/scripts/probe-routine.ts` → quality driver Layer-1b）的终点是**把结构化 finding 追加进 `.quay/routine-findings.jsonl`**；`plugin/scripts/capability-catalog.sh` 对它的 CONSUMER 声明（`:1925` 行）逐字止于此，全仓**没有任何机械消费者**把 finding 转成任务或触发产出者重跑。`routine-file-gate.ts`（立案闸）**只由 `plugin/skills/routines/SKILL.md` 的 agent 通道 Phase 3 调用**；而该 SKILL 自己第 20–31 行声明：两层 driver 架构下生效的是**机械通道**，且「两条通道不要同时驱动同一条 routine」——机械通道正是被启用的那条，**而它没有立案步**。

**后果（实测，非推断）**：08:30 首次报出陈旧 ⇒ ~19:00 判据越界 = **10.5 小时预警窗**，而冷启动面产出者一次墙钟仅 **20m36s**（`plugin/freshness-producers.json` 的 `coldstart-face.wallclock_hours: 0.34`）⇒ 窗口是关闭成本的 ~30 倍，**零动作**。

**5b 扫描（同载体内的同形点，⛔ 不只修被报出来的那一个）**：`.quay/routine-findings.jsonl` 现有 **61 条 finding 记录 / 57 个 distinct findingId**（`semantic-dedup-scan` 53 条 + `freshness-refresh` 8 条）。对全部 57 个 id 逐个 `grep -rl <id> tasks/`：**命中 6 个，且全部落在同一个文件** `tasks/gap-productize-deep-semantic-dedup-scan-routine.md`——那是**建该例程的任务自己在 body 里引用了探针输出**，不是由 finding 立案的任务。⇒ **没有任何一条例程 finding 曾经变成过任务**，形态遍及全部 routine，⛔ 不是 freshness 独有。（谓词干跑：`grep -rl freshness-refresh tasks/` 命中该机制自己的任务文件 ⇒ 谓词本身可命中。）

**第二处独立缺陷（同一条链的载体侧，实测）**：`.quay/routine-findings.jsonl` 是 **git-tracked** 文件（`git ls-files` 命中；唯一提交 `53cc833b5`），而其 append **不提交** ⇒ 工作树永久脏、且**会被静默回退**。实测：例程自报 `recordsAppended` 合计 33 条（轮 1/72/148 各 1 + 248/323/390 各 5 + 473 计 7），而文件当前只有 64 行 = HEAD 的 54 行 + 最后两轮的 10 行；**02:17–14:36 的 25 条 append 已不在文件里**，HEAD 那份 `grep -c freshness-refresh` = **0**、末条记录停在 `2026-09-13T18:03:58Z`。⇒ 08:30–12:31 那几轮**报出的 stale finding 本体已丢失**（这正是无法复核 14:36 那轮为何报 6 条的原因）。回退者尚未定位（候选类：共享主检出上的 tree-hygiene `git checkout`/`reset`；已排除 `meta-driver.ts:1214 settleEvidenceWrites`——它只作用 `goals/`，有 `-- goals` 限定）。**⛔ 不把候选当结论**：定位它是下方 AC7。

**为什么更早的修复没兜住（⛔ 不是那几条被证否）**：7 条 `status: done` 且顶层 `goal_ac: AC-214` 的任务里，四条修**可达性**（产出侧写 `build_sha`、主体集合机械推导、AC-232/238/239 接进 NEED），两条修**一次性刷新**（冷启动面 / 升级面各重跑一次）。它们的绿都是真的。**第 4 条把「刷新动作」机械化了，但机械化的是【发现】，不是【执行】**——它的 DoD 逐字写「⛔ 探针只 file 不 execute（重跑的决定仍归人/派发链）」，这本身正确；**而它假设存在的「既有的 routine→task filing 链」在机械通道里并不存在**（只在 agent 通道里）。⇒ 交付物每 2 小时产出一条无人读的记录，形态与「观察项」完全相同——而第 4 条的 DoD 逐字禁止「把后半降格成观察项了事」。**它没有降格，它造了一个看起来不是观察项的观察项**（硬规则 9：可见性 ≠ 执行；硬规则 3b：一个恒「已产出」的记录与「已处理」同形）。

**⛔ 本任务不做的事**：⛔ 不改 K、⛔ 不改 `criterion`/`expect`/`goals/`、⛔ 不删主体、⛔ 不自行 superseded 该 AC（需人裁定）。

## Requested action

1. **先关闭当前缺口**：按 `plugin/freshness-producers.json` 的 `coldstart-face` 条目在窗口内重跑冷启动面产出者，把 AC-203/205/207/232 四条记录刷到 develop tip 附近（`--root /home/yale/work/quay` 必传：该载体 gitignored，不随 worktree 的 merge 回到主检出，而 goal-driver 读的是主检出那一份）。判据本体干跑 exit 0 才算关闭。
2. **补上机械通道的立案步（本条的机制交付物）**：让 `probe-routine.ts` 在 append finding 之后，把 **actionable** finding 经既有 `routine-file-gate.ts`（质量 / 去重 / 限流三闸，复用 `meta-driver.ts:fileProposals` 的既有形态）落成**新任务文件**——**FILE-ONLY：只立案、⛔ 不执行**（缺口重跑仍归派发链）。判据必须能取假：夹具 finding 未登记产出者时变红、登记后转绿，**并对生产载体跑一次**（⛔ 只有夹具能满足的判据不是测量）。
3. **载体不再可被静默回退**：给出 `.quay/routine-findings.jsonl` 的落点决定（gitignore + append-only，或纳入提交），并**定位那 25 条记录丢失的回退者**（⛔ 候选不得当结论）。
4. **负控制**：把探针 dispatch seam 关掉后，新增的立案步必须不再产出任务（区分「立案步在工作」与「恒有输出」）。

## Acceptance Criteria

- [ ] AC1 改前读数（能取假）：在 `/home/yale/work/quay` 逐字跑 AC-214 criterion ⇒ **exit 1**，stderr 逐字含四条主体；贴 `.quay/goal-freshness-margin.json` 全文、`.quay/goal-round.jsonl` 中 AC-214 的最后一次 pass 与本次 fail 两个时刻、以及载体里 AC-203/205/207/232 最新记录的 `ts`/`build_sha`（证明停在 `2026-09-14T14:25:05Z` / `f19397c66473`）。⛔ 引述本任务不算，须复跑。
- [ ] AC2 冷启动面产出者真跑：贴命令、退出码、全部 `develop-deliver:` 行、实测墙钟、前置核读数；并在**主检出**载体上贴出 `ts` 晚于本次运行开始时刻的四条记录全文（各自 `build_sha` 为 40-hex）。
- [ ] AC3 判据真转绿：AC-214 criterion 干跑 **exit 0** + 七行 freshness（每条 `margin > 0`）+ margin 快照全文；`goal-store gate AC-214 --root .` exit 0。⛔ 通过放宽 criterion 达成不算。
- [ ] AC4 负控制：① `QUAY_GOAL009_FRESHNESS_K=1` 下 criterion ⇒ exit 1 且逐条指名；② `git diff --exit-code -- goals/` 为空；③ 只跑 criterion 前后 `md5sum .quay/productization-verification.jsonl` 相同（证明判据本体只读）。
- [ ] AC5 立案步存在且能取假：给出「机械通道 append 后把 actionable finding 经 `routine-file-gate.ts` 落成新任务文件」的实现落点（文件:行），并贴**双向负控制**（夹具 finding 未登记产出者 ⇒ 变红且逐条指名；登记后 ⇒ 转绿），**并对生产载体 `.quay/routine-findings.jsonl` 跑一次真实读数**（⛔ 只由夹具满足的判据不算产出）。
- [ ] AC6 立案步真在生产上生效（硬规则 4 推论三：判据须读**生产**载体且只计**实现落地之后**的时间窗）：贴出实现落地后**由例程 finding 立案**的 ≥1 条任务（路径 + `ts` 晚于落地时刻 + 其 `## Finding` 与该例程 finding 逐字对应）；并贴反向对照——**关掉探针 dispatch seam** 的那一趟不产出任何任务（证明不是恒有输出）。
- [ ] AC7 载体不再可被静默回退：贴出回退者的定位（文件:行 + 一次能复现的回退读数），或若判定应改落点，则贴落点决定 + 依据；并贴 HEAD 与工作树两份 `.quay/routine-findings.jsonl` 的行数 / 末条 `ts` 对照，证明 append 不再依赖「没人碰它」。
- [ ] AC8 5b 扫描产物：对 `.quay/routine-findings.jsonl` 全部 distinct findingId 重跑「是否曾立案」的谓词，贴**命中数与前 3 条**，证明本条的修法覆盖全部 routine（⛔ 不只覆盖被报出来的 freshness 一条）。

## Definition of Done

主检出载体的四条主体证据在窗口内（`build_sha` 到 develop-tip 的交付面提交距离 ≤ K=200），**AC-214 判据本体干跑 exit 0**（七行 margin 全正），且在 `QUAY_GOAL009_FRESHNESS_K=1` 负控制下仍能 exit 1、`goals/` diff 为空；**机械通道的 finding 有了立案动作面**（AC5 双向负控制 + AC6 生产载体读数 + 反向对照齐备），用「关 seam ⇒ 不产出」证明它不是恒有输出；载体回退者已定位或落点已决定（AC7）。

⛔ 不接受的替代物：改 K / 删主体 / 改 `expect` / `criterion`；手写或搬运证据记录；`--selfcheck` / `--check` 的输出；只把记录写进任务 worktree 的 `.quay/`（判据读主检出 ⇒ 空转）；把「立案步」降格成又一条观察项（只报不立案）；用「例程在跑、有 finding」冒充「缺口被处理」——**这正是本条的全部要点**。

## Touches

- `plugin/scripts/probe-routine.ts`（机械通道：append 后新增立案步）
- `plugin/scripts/routine-file-gate.ts`（复用；若需扩展以接受 finding 形状）
- `plugin/test/probe-routine.test.mjs`（双向负控制 + 生产载体读数）
- `plugin/probes/freshness-refresh.md`（若输出契约需带立案字段）
- `packages/quay/plugin/probes/freshness-refresh.md`（同一改动必须同步镜像，过 `mirror-pair-drift-check.ts`）
- `.quay/routine-findings.jsonl`（本条的载体：落点决定 = gitignored + append-only，或纳入提交）
- `.quay/productization-verification.jsonl`（gitignored：AC2 产出者 append 的落点，⛔ 非可提交物）
- `tasks/gap-ac214-fifth-crossing-routine-detects-but-nothing-acts.md`（自身文件：勾 AC + 贴实跑证据）
