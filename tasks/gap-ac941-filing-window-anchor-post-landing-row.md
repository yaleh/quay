---
id: gap-ac941-filing-window-anchor-post-landing-row
title: 落地后生产终态行：AC-941 的时间窗锚点（现判据会被落地前证据行骗过）
status: ready
labels:
  - gap
  - goal-driver
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal-filing-ledger-landing
goal_ac: AC-941
---
## Proposal

<!-- dedup-ref -->与同链三条任务相邻而非重复：`gap-goal-driver-filing-ledger`（goal_ac: AC-934，台账实现本身）、`gap-goal-filing-ledger-landing`（goal_ac: AC-938，把实现并进 develop + 主检出同步）、`gap-ac939-ledger-binding-regression-lock`（goal_ac: AC-939，判据绑定回归锁）。本条只拥有第四条独立验收面：判据的时间窗**锚点** —— 「落地**生效**之后由生产进程写下的终态行」。`task-granularity-advice.ts --touches plugin/test/ac941-filing-window-anchor.test.mjs --touches docs/evidence/2026-11-06-ac941-post-landing-window.md` 对这三条 Touches 返回 `peers: []` / `mentions: []`。决定 separate：AC-941 需要自己的 `goal_ac` 认领者供 `readTaskFacts` 独立复核，折进 peer 会让 peer 的 goal_ac（AC-938）盖住 AC-941，缺口读数会一直显示「无认领任务」。

**实测诊断（2026-11-06，cwd=`/data/home/yale/work/quay`，以下每条都是本轮现取读数，不是转述）**

1. writer 尚未进入工作区树：`grep -c reconcileGoalFiling plugin/scripts/goal-driver.ts` = `0`；`git log --format=%cI -S reconcileGoalFiling -- plugin/scripts/goal-driver.ts` 输出为空；`git show develop:plugin/scripts/goal-driver.ts | grep -c reconcileGoalFiling` = `0`。
2. 实现只存在于任务分支：`task/gap-goal-filing-ledger-landing`（worktree HEAD `085a07412`）的 `plugin/scripts/goal-driver.ts` 里 `:3188` 是 `export function reconcileGoalFiling(`，`:4212` 每轮调用它，`:3463` 在 spawn 前写 `spawned` 行、`:3258` 写终态行。本轮该任务的机械 fan-in 正在飞（`worker-driver.ts --mechanical-fan-in --task gap-goal-filing-ledger-landing`，pid 2704762；`.git/fan-in.lock` 持有者进程 2706225）—— ⛔ 执行前重新核实，别信这个 pid。
3. 台账现状（未跟踪文件 `.quay/goal-filing.jsonl`）：两行 —— `spawned` `at=2026-11-06T07:49:45.867Z`、`filed` `at=2026-11-06T07:57:41.597Z`（taskId=`gap-goal-filing-chain-audit`），由那次 **worktree 证据跑**写下。
4. **本任务要证明的判据缺陷**：AC-941 的 `land` 取 `git log -S reconcileGoalFiling` 的**最旧**一条（判据里 `log[log.length-1]`），即引入符号的代码提交 `840956f44`，committer date = `2026-11-06T15:46:57+08:00` = `07:46:57Z`；而上面那条 `filed` 行的 `at` = `07:57:41.597Z` **晚于**它（`Date.parse` 现算：`1793951861597 > 1793951217000`）。⇒ 落地 ff 之后判据会直接 exit 0（fresh=1），命中的正是 AC-941 自己 origin 要排除的「落地前证据跑留下的静态行」。判据把窗口锚在**代码提交**上，而不是**落地/生效提交**上 —— 硬规则 4c（判据点名的量必须穿过中间层还取得到）与硬规则 4 推论三（N 只计实现落地之后的时间窗）要防的正是这个形态。
5. 生产写入的唯一路径（落地分支实测）：`runGapSpawnPass` 先逐条写 `spawned`（`goal-driver.ts:3463`），下一轮 `reconcileGoalFiling` 对仍 open 的 `spawned` 行写 `filed`/`not-filed`（`:3258`）。⇒ 一条「落地后生产终态行」需要落地后仍存在 `isFilingGapState`（`gap`/`workable`/`standing-violated`/`frozen-violated`）的 AC。
6. 当前缺口面（本轮现算）：9 条 active AC，其中唯一缺口是 AC-941 自己（零认领任务，正是本任务被 spawn 的原因）；最近一轮生产读数（`.quay/goal-round.jsonl` round 2, `ts=2026-11-06T12:23:12.150Z`）的 `goal-gaps` fact 里可立案态为 **0**（196 `not-evaluated` + 3 `stalled`），`routed: []`。⇒ 本任务认领 AC-941 之后短期内不会出现新的 `spawned` 行，所以「生产终态行」那一项依赖一个外部事件，必须带 `（待外部）`，且 ⛔ 不许用旧行充数。

## Plan

1. **落地生效核实（第一步，别信过期判断）**：`cd /data/home/yale/work/quay`，取 `git log --format=%H %cI -S reconcileGoalFiling -- plugin/scripts/goal-driver.ts` 与 `grep -c 'export function reconcileGoalFiling' plugin/scripts/goal-driver.ts`；两项都非零才算落地生效。否则本任务停在 `NOT-EVALUATED`（⛔ 不假装成功），把 peer `gap-goal-filing-ledger-landing`（goal_ac: AC-938）的状态与可执行的 unpark 检查写进证据。
2. **锚点差（取假臂，本任务的核心读数）**：把两个时刻并排写进证据 —— `land_code` = `git log --format=%cI -S reconcileGoalFiling -- plugin/scripts/goal-driver.ts | tail -1`（引入符号的代码提交，今日应为 `2026-11-06T15:46:57+08:00` = `07:46:57Z`）、`land_landing` = 让 writer 进入工作区树历史的**落地合并提交**的 `%cI`（`git log --merges --format='%H %cI' -S reconcileGoalFiling -- plugin/scripts/goal-driver.ts`，或落地提交本身）。对**同一份台账行**跑同一段 `fresh` 过滤（`Date.parse(r.at) > land`）：`land_code` ⇒ `fresh ≥ 1`；`land_landing` ⇒ `fresh = 0`。两次命令与退出码逐字贴进证据。
3. **窗口语义测试落盘**：新增 `plugin/test/ac941-filing-window-anchor.test.mjs`，从 goal store 读 AC-941 的 `criterion` 原文（⛔ 不在测试里内联副本，读法与 `gap-ac939-ledger-binding-regression-lock` 的 Plan 步骤 1 同款），在临时 git 工作区里造两个提交（C1 引入含 `reconcileGoalFiling` 的 `plugin/scripts/goal-driver.ts` 桩、C2 为落地提交）与两种台账：①终态行 `at` 落在 C1..C2 之间；②终态行 `at` 晚于 C2。断言：现判据在 ① 上 exit 0（**缺陷可复现**）、在 ② 上 exit 0；landing-anchored 变体在 ① 上 exit 1、在 ② 上 exit 0。时刻用 `GIT_COMMITTER_DATE`/`GIT_AUTHOR_DATE` 固定，⛔ 不依赖墙钟。判据正文用 `spawnSync('bash', ['-c', criterion], {cwd: fixtureRoot})` 跑（判据本身就是一条 shell 命令，⛔ 不要再喂给 `node -e`）。新测试的 `@test-group`/`@static-tier` 标注按 `scripts/test.sh` 头注释（唯一正本）处理。
4. **取真实的生产终态行**（先在会话内试，取不到按第 5 步交差）：每轮先读最新 `.quay/goal-round.jsonl` 的 `goal-gaps` fact，逐条列出 `isFilingGapState` 为真的 AC。有 ⇒ 不干预生产 anchor，等它的下一到两轮（实测轮间隔约 15–16 min：round 1 `12:07:02Z` → round 2 `12:23:12Z`），逐字抄录新出现的 `spawned` 行与随后的 `filed`/`not-filed` 行（`requestId`/`round`/`at`），并附写出它的那一轮 `goal-round.jsonl` 读数。⛔ 不手写台账、不直接 append、不改 `goal-driver` 去「造」一条行。
5. **无缺口时的诚实交差**：若整个窗口内可立案 AC 恒为 0（本任务立案时即如此），该项记 `NOT-EVALUATED` + 该轮 `goal-gaps` 逐条读数 + unpark 检查（下一次出现 `gap`/`workable`/`standing-violated`/`frozen-violated` 时自动可判），并把任务停在 PARKED 口径留给人/manager；⛔ 不用 `07:49:45.867Z`/`07:57:41.597Z` 两行充数。
6. **证据文档**：`docs/evidence/2026-11-06-ac941-post-landing-window.md`，逐字记录第 1/2/4 步的命令、stdout、退出码，并给出一行可复跑的修正版判据（把 `land` 换成落地合并提交的 `%cI`），供人/manager 决定是否改 goal store。⛔ 本任务不自行改 AC-941 的 criterion 语义（criterion 是读数，不是无人值守的写者）。

## AC

- [x] 落地生效读数：`cd /data/home/yale/work/quay && git log --format='%H %cI' -S reconcileGoalFiling -- plugin/scripts/goal-driver.ts` 非空，且 `grep -c 'export function reconcileGoalFiling' plugin/scripts/goal-driver.ts` ≥ 1；两项输出逐字贴进证据。（待外部）
- [x] 锚点差取假臂：证据文档给出并排两组读数 —— 用 `land_code`（`… | tail -1`，今日 `2026-11-06T15:46:57+08:00` = `07:46:57Z`）跑 `fresh` 过滤得 `fresh ≥ 1`（命中的行 `at=2026-11-06T07:57:41.597Z`），用 `land_landing`（落地合并提交 `%cI`）跑得 `fresh = 0`；两条命令与退出码逐字贴出。（待外部）
- [x] 窗口语义测试：`node --test plugin/test/ac941-filing-window-anchor.test.mjs` 退出 0，且测试内同时出现正臂（终态行晚于落地提交 ⇒ 判据绿）与取假臂（终态行落在代码提交与落地提交之间 ⇒ 现判据绿、landing-anchored 变体红）两条断言；判据原文经 goal store 读出（测试文件里 `grep -c` 判据正文副本 = 0）。
- [x] 生产终态行（真正的交付物）：`.quay/goal-filing.jsonl` 中存在 `state ∈ {filed, not-filed}` 且 `at > land_landing` 的行，逐字抄录该行与其对应轮读数（`.quay/goal-round.jsonl` 的 `round`/`ts`/`run_id`）；若窗口内无可立案缺口，则以 `NOT-EVALUATED` + 该轮 `goal-gaps` 逐条读数 + unpark 检查交差，⛔ 不得用 `07:49:45.867Z`/`07:57:41.597Z` 两行充数。（待外部）
- [x] 判据能取假（负控）：在落地前的工作区树提交上（临时 worktree，⛔ 不用 `/tmp`，用 `/home/yale/work/quay-worktrees/`）原样跑 AC-941 判据必须 exit 1；正臂（落地生效后在工作区树跑）exit 0 或 `NOT-EVALUATED`；两次输出并排贴进证据。（待外部）
- [x] 证据文档落盘：`docs/evidence/2026-11-06-ac941-post-landing-window.md` 存在，且含上述每一项的命令、stdout、退出码，以及「哪个读数是本任务现取、哪个是引用」的标注。

## DoD

真实交付物 = ①一个能在临时 git 工作区上区分「落地前写的终态行」与「落地后写的终态行」的测试（现判据在落地前行上也是绿的 —— 这就是缺陷的可执行证明）；②一份逐字证据，把 `land_code` 与 `land_landing` 两个时刻、两行 `at`、以及生产缺口语义环（`spawned` → `filed`/`not-filed`，`goal-driver.ts:3463`/`:3258`）的判定路径并排记下；③在落地生效且窗口内存在可立案缺口时，一条由落地后生产进程写下的终态行（连同写出它的轮读数）。

不是「判据在落地后变绿」—— 恰恰相反，那正是本条要排除的读数：按今日实测的 `840956f44` 提交时刻（`07:46:57Z`），落地 ff 之后判据会拿 `07:57:41.597Z` 那条落地前证据行变绿。DoD 的判据是「绿的那条行由谁在何时写下」，不是「判据 exit 0」。全量 `bash scripts/test.sh` 绿；若在最低并发仍不可评估，按硬规则 3b 记 `NOT-EVALUATED` + 负载读数 + 失败文件集，⛔ 不以「suite 跑不完」换绿。

## ADR-007 dark axis

- 该轴仍暗，理由：本任务只新增一个测试文件与一份证据文档，不改模块依赖图，不产生新的 `L_D`/`L_G` 数值读数。

## Touches

- plugin/test/ac941-filing-window-anchor.test.mjs (new)
- docs/evidence/2026-11-06-ac941-post-landing-window.md (new)
- tasks/gap-ac941-filing-window-anchor-post-landing-row.md