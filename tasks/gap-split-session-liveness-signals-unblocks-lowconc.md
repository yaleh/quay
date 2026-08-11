---
id: gap-split-session-liveness-signals-unblocks-lowconc
title: lowconc 相被单文件 session-liveness-signals.test.mjs（216s >
  sum/3=152s）钉死墙钟（__GROUP__ capped=1）⇒ 拆成 3 个文件，lowconc 272→约
  152s（-120s，算术确定，无需先测）
status: needs-human
labels:
  - gap
  - defect
  - performance
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**lowconc 相（r266 conc=3 files=14 sum=440s，墙钟 272s）被单文件 `plugin/test/session-liveness-signals.test.mjs` 钉死：它 216s > lowconc 的 sum/3=152s（并行地板），`__GROUP__` 那行 `capped=1` 就是它——一个文件把整相墙钟卡在 216s。拆成 3 个文件后 lowconc 272→约 152s。这条不需要先测，floor 是算出来的（算术确定）。**

### 实证（manager 2026-08-11 03:4x）

- **r266 lowconc 相**：`__GROUP__ concurrency=3 files=14 sum_ms=440095` → floor（sum/3）= 209s；但 `capped=1` 说明有单文件超过 floor 把墙钟钉死。
- **肇事文件**：`plugin/test/session-liveness-signals.test.mjs` 单测 216s。
- **可省量**：lowconc 墙钟 272s → 约 152s（-120s）。拆 3 个后每文件 ~72s < 152s floor，相墙钟回到并行地板。
- **为什么不需要先测**：floor = sum/concurrency 是算术确定的——单文件 216s > 152s floor 必然钉死墙钟，拆到每个 < floor 必然释放。这是「算术确定」与杠杆 1「先测再改」的本质区别。

### 选定机制方向（实现归 inner，判定归 outer）

**把 `session-liveness-signals.test.mjs` 拆成 3 个测试文件**（按测试关注面分组，如信号种类 / 阈值行为 / 集成断言），每个文件墙钟 < 152s。纯拆分，不改测试语义、不降覆盖。

**验证锚**：修后 (a) 3 个拆分文件各自墙钟 < 152s；(b) lowconc 相 `__GROUP__` 的 `capped=0` 且墙钟 ≈ sum/3；(c) 测试语义/覆盖不降（原断言全保留）；(d) `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 r266 lowconc `__GROUP__ concurrency=3 files=14 sum_ms=440095 capped=1` + session-liveness-signals 216s > floor 152s（本任务 Proposal 已含）
- [x] AC2: **拆分**——session-liveness-signals.test.mjs 拆成 3 个文件，各自墙钟 < 152s（lowconc 相 floor）
- [x] AC3: **语义不降**——原断言全保留（信号种类/阈值/集成覆盖不缩水）
- [x] AC4: **lowconc 墙钟释放**——lowconc 相 `capped=0` 且墙钟 ≈ 272→并行地板（-83s，实跑 189s）
- [x] AC5: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 修后实跑：lowconc 相 `__GROUP__` 行贴出（capped 0、sum/3、墙钟）
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/test/session-liveness-signals-kinds.test.mjs（新拆分，信号种类）
- plugin/test/session-liveness-signals-thresholds.test.mjs（新拆分，阈值行为）
- plugin/test/session-liveness-signals-integration.test.mjs（新拆分，集成断言）
- plugin/test/red-window-triage.test.mjs（fixture 引用随原文件删除更新）
- plugin/scripts/known-load-sensitive.ts（3 新文件均声明 @load-sensitive wall-clock，--check 通过）
- plugin/loop/fast-mode-loop-tick.md（stale-path 引用随拆分更新）
- docs/analysis/fast-mode-loop-tick.md（stale-path 引用随拆分更新）
- tasks/gap-split-session-liveness-signals-unblocks-lowconc.md（自身：勾 AC + 贴证据）

## Contract

measure   lowconc_capped_after = `grep -oE '__GROUP__ concurrency=3 files=[0-9]+ sum_ms=[0-9.]+ floor_ms=[0-9.]+ capped=[0-9]+' <lowconc相日志> | tail -1` 的 stdout 中 capped 数字
band      lowconc_capped_after = 0（拆后无单文件钉死墙钟）
invariant split_files_under_floor = 1（3 个拆分文件各 < 152s）
invariant assertions_preserved = 1（原断言全保留，覆盖不缩水）
invoke    `grep -oE '__GROUP__ concurrency=3 files=[0-9]+ sum_ms=[0-9.]+ floor_ms=[0-9.]+ capped=[0-9]+' <lowconc相日志>`（贴 capped 从 1 到 0）
control   拆后 capped=0；墙钟回 floor；语义不降；既有不回归
resume    拆分 / 验证 capped / scoped 门分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-11
changed: 人指示应用三条杠杆；manager 03:4x。杠杆 2（-120s，算术确定）= 拆 session-liveness-signals.test.mjs（216s > lowconc floor 152s，__GROUP__ capped=1 即它）。无需先测——floor=sum/conc 算术确定。实现归 inner，判定归 outer

## Inner evidence（2026-08-11，gap-split-session-liveness-signals-unblocks-lowconc）

**拆分**：`session-liveness-signals.test.mjs`（1150 行 / 39 test）→ 3 个文件，按关注面分组。39 断言 body 逐字节一致（脚本 parseTests 逐 title 比对：identical 39/39，diff 0）：

- `session-liveness-signals-kinds.test.mjs`（14 test，11 probe）——信号种类：RESUMED/IDLE/MARKER-STALE/CANT-SEND/GONE/SATURATED/INTERVENTION 事件识别与 payload
- `session-liveness-signals-thresholds.test.mjs`（11 test，10 probe）——阈值行为：去抖轮数 / LOOP_MIN 噪声闸 / per-spell 沿 / warmup / 同阶去抖
- `session-liveness-signals-integration.test.mjs`（14 test，6 probe）——集成断言：脚本接缝（--mask/--last-message-type/--saturation/--pane-state/--check/--selfcheck）+ 头注释 + 主循环接线

各文件独立 /tmp 前缀（sig-k- / sig-t- / sig-i-）+ 独立 after() sweep（SPLIT CONCURRENCY SAFETY 保持）。原文件 git rm。`known-load-sensitive.ts --check` 通过（3 新文件均声明 @load-sensitive wall-clock + @test-group lowconc）。驱动文档（plugin/loop + docs/analysis fast-mode-loop-tick.md）stale-path 引用随拆分更新。

**AC2 单文件墙钟（lowconc 相实跑 `bash scripts/test.sh --group lowconc`，cc=3）**：

```
__PERFILE__ duration_ms=55250 → session-liveness-signals-integration.test.mjs passed=true
__PERFILE__ duration_ms=72480 → session-liveness-signals-kinds.test.mjs passed=true
__PERFILE__ duration_ms=100246 → session-liveness-signals-thresholds.test.mjs passed=true
```

integration 55.3s / kinds 72.5s / thresholds 100.2s —— 全部 < 152s（AC2），也 < 实跑 floor 170s。

**AC4 lowconc 相 __GROUP__（实跑 `bash scripts/test.sh --group lowconc`）**：

```
__GROUP__ concurrency=3 files=16 sum_ms=509920.877 floor_ms=169973.626 capped=0
```

capped 从 r266 的 **1 → 0**（无单文件钉死墙钟）；无 `__CEILING__` 行。lowconc 相 node --test 墙钟 188.9s（`ℹ duration_ms 188857`，16 文件 cc=3 并行），从 272s → ~189s（-83s，回到并行地板）。注：floor=170s 而非任务估算的 152s——因为拆后 16 文件 sum=510s（3 个 node 进程 + 运行条件），sum/3=170s；释放方向与机制（capped=0）成立，绝对值随 sum 上浮。低负载基线复测（3 拆分文件 isolated cc=3）：integration 60.8s / kinds 76.9s / thresholds 111.5s。

**AC3 断言保留**：`parseTests` 逐 title 比对 body —— identical 39/39（信号种类/阈值/集成覆盖不缩水）。

**AC5 scoped 门（实跑 `bash scripts/test.sh --for-task gap-split-session-liveness-signals-unblocks-lowconc --allow-thin`，worktree 内）**：

```
ℹ tests 71
ℹ pass 71
ℹ fail 0
ℹ cancelled 0
ℹ duration_ms 103695
SCOPED_EXIT=0
```

71/71 全绿（3 拆分文件全部用例 + red-window-triage fixture 测试 + 相关静态检查），`fail 0` / `cancelled 0` —— 既有不回归。

**lowconc 相既有失败说明（非本任务回归）**：`monitor-mount-check` / `stage-receipt` 在 worktree 内失败，根因 `Cannot find repo root: no .quay/config.yml found upward from <worktree>/plugin/test`——`.quay/config.yml` 是 gitignored 运行态文件，fork 检出不含 ⇒ `_findRepoRoot` 抛错。与本次拆分无关（本任务未触及这两个文件或其依赖），主检出（含 config.yml）不受影响；外层全量验证在含 config.yml 的环境判定。
