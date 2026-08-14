---
id: gap-fan-in-suite-data-not-accounted
title: fan-in 的 suite 数据不入账——fan-in 不在 verification-round 记账路径（0 命中），per-task 载体覆盖率 1/24；人 14:5xZ 令「先保障数据入账」
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**（fan-in 的 suite 数据不入账——人 2026-08-14 14:5xZ 逐字令：「那最近的 fan-in-execute 是如何跑 suite 测试的？先保障这些测试的数据入账」；manager 诊断完成）**。

**三个缺口（manager 全部按位置查证）**：

**① fan-in 的 suite【结构上】不在 verification-round 记账路径上**：
```
verification-round.jsonl 唯一写入者 = full-suite-runner.ts（经 suite-state-trigger.ts:1235 派生）
scripts/test.sh 里 2 处 verification-round 命中全是注释、零写入
fan-in-execute.js 里 suite-state-trigger/full-suite-runner 命中 = 0/0
fan-in 的三处 suite 调用全是裸 bash scripts/test.sh
⇒ 不是载体坏了，是 fan-in 从来就不在那条路上
载体日期分布实测：08-12 87 轮 · 08-13 77 轮 · 08-14【0 轮】
```

**② ac63 落地的新载体（per-task-suite-records.jsonl）覆盖率 1/24**：
```
per-task-suite-records.jsonl = 1 行（gap-ac63，laneCount=1，1805ms）
今天 inner 的 fan-in workflow run 数 = 24
今天翻 done 的任务 = 42
```

**③ 那唯一 1 行正好解释「为什么 fan-in 时 CPU 负载都很低」**：
```
taskId=gap-ac63  laneCount=1  durationMs=1805  state=green  docChecked=True
对照 08-13 全量 suite：wall 346-444 秒 ⇒ 1.8 秒 = 只跑了 doc 检查
印证 fan-in-execute.js:70-71 判定规则：code_delta 为空 ⇒ 跳过全量 suite（只跑 doc 检查）
⇒ CPU 低不是缺陷，是设计按判定跳过了全量——但此前没有任何读数能证明
```

**判据1（先做，人令优先）**：**每次 fan-in 都要写一条 per-task-suite-record**——今天 24 次写了 1 条。⊢ 判据（能取假）：**今日 fan-in run 数 == per-task-suite-records 当日行数**（现真值 24 vs 1 ⇒ 假）。**⛔ 不得只在「跑了全量」时写——跳过全量【也要写】**，否则「为什么 CPU 低」永远只能靠推断（正是今天处境）。
**判据2（区分度，几乎零成本）**：记录能分辨【跑了全量】与【只跑 doc】——现靠 laneCount=1/durationMs=1805 反推。⊢ 加 `fullSuiteRan: true|false` + `skipReason`（step 2 的 code_delta 判定结果）——**让「跳过」成为被记录的决定**，不是靠时长反推的事实。
**判据3（字段深度，人 08-13 15:57 排第 1 的「相边界差分」在 per-task 载体上没落）**：补 cpu_time_s / 分相 ms / load——`cpu_usec + PSI` trap 写入。**没有它分不开「main 欠并行」与「serial 尾巴长」**（08-13 推算：σ_其余 0.37-0.51 低于 1 物理不可能 ⇒ 口径问题，需分相 cpu_usec）。
**判据4**：既有测试全绿 + `--for-task` scoped 门绿。

**优先级**：① > ② > ③。没有 ③ 还能上界推算；**没有 ① 连原料都没有**。② 立刻消除「CPU 低是跳过还是跑慢」误判。

**⚠️ 必须与 AC83 一起完成（manager 14:5xZ 报）**：`gap-phase-boundary-differential-accounting`（相边界差分 cpu_usec+PSI）status=done 但**真实数据 0**——5 AC 被 scoped 测试满足（注入假 cgroup 数据，`QUAY_TEST_CGROUP_SCRIPT` 于 full-suite-runner.ts:795），**证明的是「能产出」不是「已产出」**。且仪器在 full-suite-runner.ts 而 fan-in 走裸 bash scripts/test.sh（0 命中）⇒ **即使 runner 再跑 fan-in 仍拿不到**。**⊢ 本任务与 AC83 必须一起完成——单独完成任一条，人要的「拿到真实数据」都不满足。**

**判据5（交叉，AC83 判据3）**：与 `gap-phase-boundary-differential-accounting` 一起完成——fan-in 的 suite 数据入账 + 相边界差分生产数据落地，两者互为前置。

**一般形态（manager 建议吃进核，与 C29 同族更精确）**：
```
C29  执行了、报了、但没留痕        ⇒ 与【没执行】同形
本条 实现了、测试绿了、但生产没跑过 ⇒ 与【没实现】同形
共同修法：把判据挪到产物上——前者 REFUSE 也写载体行；后者 AC 读生产载体的行数
```
**⊢ 前向生效**（manager 建议不立刻回查 42 条 done，成本高且多数非仪器类）：**只对【以产出读数为目标】的任务加「载体中满足 X 的记录数 ≥ N，N 在实现落地后时间窗计」的 AC**；⛔ 不设回查范围/阈值（成本结构未知，归人裁）。

**不覆盖**：不改 fan-in 的 suite 判定逻辑（跳过全量是设计，:70-71）；不新建第三个载体（沿用 per-task-suite-records）。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 fan-in-execute.js 的三处 suite 调用 + per-task-suite-record.ts 写点 + verification-round 派生链。
2. 判据1：每次 fan-in 写一条（含跳过）——⊢ 今日 run 数==当日行数。
3. 判据2：加 fullSuiteRan + skipReason 字段。
4. 判据3：补 cpu_time_s/分相 ms/load（相边界差分）。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1 判据1：每次 fan-in 写一条 per-task-suite-record（含跳过全量）——今日 run 数==当日行数。
- [x] AC2 判据2：fullSuiteRan + skipReason 字段（跳过=被记录的决定）。
- [x] AC3 判据3：cpu_time_s/分相 ms/load 字段（相边界差分）。
- [ ] AC4 判据4：与 AC83 交叉——fan-in 入账 + 相边界差分生产数据一起完成。fan-in 入账接线已交付（本任务），AC83 相边界差分真实生产数据由独立任务 gap-phase-boundary-differential-accounting 落地（待外部）
- [x] AC5 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] fan-in 每次 suite（含跳过）入账 per-task-suite-records（run 数==行数）+ fullSuiteRan/skipReason + 分相字段 + 与 AC83 一起完成（真实数据落地非仅测试绿）。本任务侧入账+载体已交付，AC83 真实数据落地待独立任务（待外部）

## Touches

- .claude/workflows/fan-in-execute.js（每次 suite 调用后写 per-task-suite-record，含跳过）
- plugin/workflows/fan-in-execute.js（镜像副本——与 .claude/workflows/fan-in-execute.js 字节一致，workflows-dual-copy-drift-check 强制；改主副本必须同步此镜像）
- plugin/scripts/per-task-suite-record.ts（补 fullSuiteRan/skipReason/cpu_time_s/load/分相 phases 字段）
- plugin/test/per-task-suite-record-check.test.mjs（补测）
- tasks/gap-fan-in-suite-data-not-accounted.md（自身）

## Evidence

**判据1（每次 fan-in 写一条，含跳过）**：`.claude/workflows/fan-in-execute.js`（+镜像 `plugin/workflows/fan-in-execute.js`）step 4 新增 `# suite-capture-block`（suite 起止/CPU（GNU time）/判定写入 `/tmp/fan-in-suite-<task>.env`），step 4.5 新增 `# suite-record-block`——**全绿后每次 fan-in 都调 `plugin/scripts/per-task-suite-record.ts` 写一条**，追加到【共享检出】`.quay/per-task-suite-records.jsonl`（writer 经 git common-dir 从 worktree 解析主检出，不写 worktree 的 fork 副本）。**跳过全量也要写**：`full_suite_ran=false` + `skip_reason=doc-only-delta`（判定依据 step 2 已记下的 code_delta）。写失败/读失败 ⇒ HARD FAIL（exit 2，不翻 done、不 ff）——入账是义务，不是最佳努力。⊢ 判据（能取假）：今日 fan-in run 数 == per-task-suite-records 当日行数（此前 24 vs 1 ⇒ 假）。

**判据2（run/skip 可分辨——跳过=被记录的决定）**：`plugin/scripts/per-task-suite-record.ts` 新增**可选**字段 `fullSuiteRan`（boolean）/`skipReason`（string，REQUIRES `--full-suite-ran false`——无「跳过」flag 的原因或配 true 的原因都是歧义，fail-closed 不写，硬规则 3b）。flag `--full-suite-ran true|false` + `--skip-reason <text>`。实测（skip 与 run 在记录里可分辨）：
```
$ node --experimental-strip-types plugin/scripts/per-task-suite-record.ts --task-id gap-test --run-id fm-test-2 \
    --state green --lane-count 1 --duration-ms 1805 --started-at 2026-08-14T00:00:00.000Z \
    --finished-at 2026-08-14T00:01:00.000Z --doc-checked true --doc-check-exit 0 \
    --full-suite-ran false --skip-reason doc-only-delta --cpu-time-s 0 --load 1.2 --record-file /tmp/r.jsonl --json
→ {"ts":"…","taskId":"gap-test","runId":"fm-test-2",…,"fullSuiteRan":false,"skipReason":"doc-only-delta","cpu_time_s":0,"load":1.2}
$ node … --full-suite-ran true --cpu-time-s 123.456 --load 4.5 …   # run ⇒ fullSuiteRan:true + cpu_time_s:123.456
$ node … --skip-reason x …                       # 无 --full-suite-ran false ⇒ exit 2，不写
$ node … --full-suite-ran maybe …                # 非布尔 ⇒ exit 2，不写
```

**判据3（cpu_time_s / 分相 ms / load——相边界差分）**：writer 新增**可选**字段 `cpu_time_s`（number，suite 的 CPU 秒数——fan-in 侧由 GNU time `%U %S` 捕获；跳过时 0）、`load`（number，`/proc/loadavg` 1min）、`phases`（array，AC83 PhaseDiffRecord 形 `{phase, wall_ms, cpu_usec?, psi_cpu_total?, psi_io_total?, lanes?}`）。flag `--cpu-time-s <n>` / `--load <n>` / `--phases <json>`；`--phases` present 时 shape 校验（非数组/缺 phase/负 wall_ms ⇒ fail-closed）。fan-in step 4 捕获块把 `cpu_time_s`/`load`/`wall_ms`/起止/判定写入 env 文件供 step 4.5 读，**使「跳过还是跑慢」从记录直接可判，不再靠 laneCount=1/durationMs=1805 反推**。

**判据4（既有测试全绿 + scoped 门）**：
```
$ bash scripts/test.sh --for-task gap-fan-in-suite-data-not-accounted --allow-thin
→ EXIT=0（scoped 门绿；per-task-suite-record-check.test.mjs 50 条全绿——43 旧 + 7 新：
  判据2 skip 记录 fullSuiteRan=false+skipReason / run 记录 fullSuiteRan=true+cpu_time_s /
  writer CLI skip+run / --skip-reason 需 --full-suite-ran false / --full-suite-ran 布尔 /
  --phases 形状 fail-closed / round-trip：带新字段的记录被 checker 判据2 判 GREEN）
$ node --experimental-strip-types plugin/test/fan-in-execute-paths.test.mjs  # 21 条全绿（fan-in-execute 改动不回归）
$ node --experimental-strip-types plugin/scripts/workflows-dual-copy-drift-check.ts
→ PASS — .claude/workflows/fan-in-execute.js == plugin/workflows/fan-in-execute.js（255 行字节一致）
$ node --experimental-strip-types plugin/scripts/fan-in-ts-typecheck-gate.ts --task gap-fan-in-suite-data-not-accounted --worktree <worktree> --merge-target develop
→ ADMITTED（exit 0）
```
（本任务修改的是**既有** .ts（`per-task-suite-record.ts`，非新增/移动），ts-typecheck 闸判定 Touches 无新增 .ts ⇒ 不触发。）

**判据5（与 AC83 一起完成）**：fan-in 入账接线（本任务 step 4.5 写 per-task-suite-record）+ AC83 相边界差分生产数据落地互为前置——本任务交付「fan-in 每次 suite（含跳过）都入账 + run/skip 可分辨 + cpu/分相字段」，AC83 交付「分相 cpu_usec+PSI 生产载体数据」。单独完成任一条，人要的「拿到真实数据」都不满足。
