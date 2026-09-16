---
id: gap-standing-violated-false-spawn-no-prefiling-recheck
title: AC-233 常设判据真值为真却被 standing-violated 立案——单次环境类（ENOSPC）误读即
  spawn「保证已回归」agent：给 standing 分支补立案前直接量复核 + 读数环境留痕
status: todo
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-233
---
## Finding

① **AC-233 的判据此刻为真（直接量，2026-09-16T11:31–11:45Z，主检出 `/home/yale/work/quay`）**：`node --no-warnings --experimental-strip-types --test plugin/test/shipped-entry-runnable.test.mjs` 连跑 **11 次全绿（7.3–8.1s，exit 0）**，输出含 `declared-bin-not-runnable=0 | bin-entry-not-declared=0` 与反向控制那条 ✔。`quay goal check --achieved-failing --store --root /home/yale/work/quay` 连跑 **3 次（各 33s）**，`achievedButFailing` 恒为 `["AC-242"]`，**AC-233 从不出现**。台账 `.quay/gate-events.jsonl` 尾四条 AC-233 全 pass（11:05/11:13/11:19/11:25）。`.quay/goal-round.jsonl` 自 2026-09-11T18:22Z 起每轮 `gaps` 中 AC-233 恒为 `standing-ok`（round 34–58 逐轮核过）。

② **但 2026-09-16T11:30Z 那一轮 spawn 了本 agent，prompt 逐字断言「A STANDING goal criterion (AC) — declared long-term: true, already achieved — now FAILS again: the guarantee it asserts has regressed」** = `plugin/scripts/goal-driver.ts:2124` 的 standing 分支 ⇒ 该轮 `gap.state` 为 `standing-violated`（需 `standings.achievedButFailing` 含 AC-233 且无在飞认领）。证据：`ps -eo pid,ppid,lstart,cmd` 实测 pid 2668756 是 anchor 2345029 的子进程、命令行为 `claude -n quay-fix-worker`，且 prompt 与 `buildGapWorkerPrompt` 的 standing 分支逐字一致。**该轮轮记录（含 `gap_spawns[].stdout`）在 agent 退出后才落盘**，故此处不引它自证。

③ **成因（有独立证人，非推断）：同一时窗内宿主根文件系统被写满（ENOSPC）**。`.quay/anchor.log:2721-2736` 是同期在跑的 `gap-release-yml-drop-sea-npm-gate-on-plugin-channel-instead` worker 的自述，逐字给出：`The root filesystem hit 100% full mid-run (/ 97G, 1.1M free)`、`my own Bash calls were dying with 'pwd: write error: No space left on device'`、它的 suite 日志**在同一行被截断**（截断是 ENOSPC 指纹，不是 load flake）、`After freeing 21G, the same test passes`（其自身测试 7.65s ✔）。时窗吻合三点：AC-233 在 11:25:57 的 ring 轮次仍 pass（写满之前）；11:31 之后本 agent 复跑全绿（释放之后）；中间正是那一轮。**AC-233 的判据是 28 条在域 AC 里最吃磁盘/临时目录的一条**——`npm pack --dry-run`（在 `packages/quay` 解析整棵文件树）+ `fs.mkdtempSync` + `copyFileSync` 到 `node_modules/quay/` + spawn `node dist/quay.js --version`。⇒ 宿主写满时它失败，**与它所断言的保证无关**。⚠️ 诚实标注：该 worker 同时指出另有 worker 并发跑 suite，「写满」与「宿主争用」无法完全分离——两者同属环境类，都不是 AC-233 的 delta。

<!-- dedup-ref -->
④ **本任务要修的缺口（机制侧，且是新的）**：`standing-violated` 分支**凭一次读数就 spawn 一个断言「保证已回归」的 agent——立案前不做任何直接量复核，也不记录读数的环境**。同类缺口在**冻结**分支上早已被点名并修复：`recheckFrozenFailing`（提交 `32d8ddd4d`，2026-09-15T10:17:10Z）即「立案前对 `failing` 命中的 AC 真跑一次 criterion，`cleared` 则不立案」，其正本是 `gap-frozen-violated-files-on-stale-verdict`（done），其活内核激活是的 `gap-ac259-resident-kernel-never-runs-landed-prefiling-recheck`（done）——本任务**不重复实现它们**。**standing 分支至今没有这一层**：`computeGoalGaps`（`goal-driver.ts:1838`）的 ② 分支只读 `standings.achievedButFailing` 后直接进 spawn，`recheckFrozenFailing` 只喂 ③ 冻结population。⇒ 后果：宿主一旦进入不健康态（今天实测 ENOSPC），**每一轮都会为真值为真的常设判据 spawn 一个「保证已回归」agent**；被 spawn 的 agent 若照 prompt 办事就会立一条**假前提任务**，再烧掉一个 worker + scoped 门 + 全量 suite + fan-in（约 20+ 分钟宿主）。本次只因本 agent 逐条复测才发现前提不成立。

<!-- dedup-ref -->
⑤ **发生率（硬规则 12，如实给）：本形态 = 1 次（本次）**。⛔ 不声称更高频次：`gap_spawns` 全史中 AC-233 仅 1 条 else（2026-09-10T14:37:54Z，state=`gap`，非本形态）。故本条据「已实测 1 次 + 有独立证人指向成因」立案；**本条不要求任何别的任务先落地**，也不因此挡住任何其它任务。若本形态再现（≥2 次），应升为检测器条目。

## Requested action

1. **给 ② standing 分支补上 ③ 已有的「立案前直接量复核」**（复用同一实现，⛔ 不另写一份跑判据的代码）：对 `standings.achievedButFailing` 命中的每条 AC，在 spawn 前经 `gateCriterion` 重跑一次 criterion，结局**三态互不同形**（硬规则 3b）：`cleared` ⇒ **不 spawn**、不产生缺口读数；`confirmed-failing` ⇒ 照旧 spawn；`not-evaluated`（命令读不出 / 闸拒绝）⇒ 独立取值，⛔ 不与「复核通过」同形。
2. **让读数可归因**：spawn（以及不 spawn）的那一轮，把**立案前复核的原始读数**落进轮记录——至少 `{ac, outcome, verdict, durationMs}`，并带上当时宿主健康量（根文件系统可用字节 / load1）——使「环境类误读」与「真的回归」事后可区分。今天要区分二者，只能靠跨进程取证（本 agent 走的正是这条：从锚进程 cmdline → `gap_spawns` 史 → `anchor.log` 的 ENOSPC 证人）。
3. ⛔ **不改 AC-233 的判据、不改 `packages/quay/package.json` 的 `files`、不要求把判据改快**——保证本身没有被破坏，动它会把这把尺子从「安装位置可运行」挪走。

## AC

- [ ] AC1 正向（能取假）：夹具中让某条常设 AC 的 criterion **首次失败、复核那次通过** ⇒ `computeGoalGaps` 不再产出 `standing-violated`，且 `runGapSpawnPass` 的 `spawned` = 0。⛔ 只断言「干净时 spawned=0」不算（恒绿形）。负控制（区分「复核真的跑了」与「复核被跳过」）：criterion **两次都失败** ⇒ 仍产出 `standing-violated` 且 `spawned` = 1；复核 `not-evaluated` ⇒ 产出独立态，⛔ 既不是 `standing-ok` 也不是 `standing-violated`。
- [ ] AC2 轮记录里出现立案前复核读数：存在一条轮 fact / `gap_spawns` 元素含 `{ac, outcome, verdict, durationMs, hostFreeBytes|load1}`；**负控制**：改动前的轮记录里该键**缺失**（两者可区分，⛔ 不靠「字段存在」自证）。
- [ ] AC3 真值不动：`node --no-warnings --experimental-strip-types --test plugin/test/shipped-entry-runnable.test.mjs` ⇒ exit 0（2 pass / 0 fail）；`quay goal check --achieved-failing --store --root /home/yale/work/quay` 的 `achievedButFailing` 不含 `AC-233`；`git diff --name-only` 证明本任务**未改** `plugin/test/shipped-entry-runnable.test.mjs` 与 `packages/quay/package.json`。
- [ ] AC4 `node plugin/scripts/task-schema-check.ts tasks/gap-standing-violated-false-spawn-no-prefiling-recheck.md` ⇒ exit 0。

## DoD

跑着的 goal 内核上，**一次环境类误读不再产生 `standing-violated` spawn**——生产载体留痕：一次真实轮次的轮记录里含 AC1 要求的复核读数（`outcome` 取 `cleared` / `confirmed-failing` / `not-evaluated` 三者之一，⛔ 不与「通过」同形），且 AC-233 判据在落地后仍为真。⛔ 只写「加了复核函数」而生产轮记录里取不到该读数不算达成（硬规则 4 推论三：只被 fixture 满足的实现与「没实现」同形）。

## Touches

- plugin/scripts/goal-driver.ts
- plugin/test/goal-driver.test.mjs
- tasks/gap-standing-violated-false-spawn-no-prefiling-recheck.md

<!-- dedup-ref -->
溯源（⛔ 非前置）：AC-233 的两条既有认领 `gap-shipped-entry-files-not-runnable`（done）与 `gap-shipped-entry-test-treats-every-shebang-plugin-script-as-entry`（done）修的都是**判据/产物面**（包的 `files` 装入面、测试的 entry 判定过宽），不是本次的**读数与 spawn 面**。按 driver 规则 done 不算重复、而是「earlier fix 没扛住」的证据——但此处 earlier fix **扛住了**（判据实测为真），故本任务明确写「保证未被破坏、⛔ 不要重修判据」。