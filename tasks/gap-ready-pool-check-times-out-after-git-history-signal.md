---
id: gap-ready-pool-check-times-out-after-git-history-signal
title: "ready-pool-check went from seconds to >150s (timeout) after the gitHistoryLanded signal landed — per-task taskWorkLanded --check is 0.8s, but the pool check aggregates ~30-50 taskWorkLanded calls each issuing `git log --full-history` per specific Touches path (O(history) each) → tick step 3.6 / outer pool maintenance hang; fix: batch git operations (one `git log` pass, match in memory) or memoize per-path results"
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**`ready-pool-check` 从秒级退化到 >150s（timeout）——`gitHistoryLanded` 信号落地后的聚合性能回归。**

**证据（2026-08-05 20:1xZ 实测）**：
- 本会话 defect-fix（`gap-ready-pool-taskworklanded-underdetects-prose-ac-merged-tasks`）落地前：
  `ready-pool-check.ts --root` 秒级返回（本会话跑过十几次全绿）。
- 落地后：`timeout 150 node .../ready-pool-check.ts --root` **未在 150s 内完成**（2 次实测）；60s timeout 亦未完成。
- 单任务 `task-status-drift-check.ts --check <id>`：**0.8s**（fast）——per-task git-history 不慢。

**根因**：`taskWorkLanded` 的新 `gitHistoryLanded` 信号对任务每个 **specific code-root Touches 路径** 发一次
`git log --full-history -- <path>`（O(history)，且 --full-history 禁 path-simplification 使代价更高）。
ready-pool-check 对 ~30 status:ready + ~30 todo 候选每个调 taskWorkLanded ⇒ ~50-60 次 × 每任务多路径 ×
每路径一次全历史扫描 = 分钟级。**单个 0.8s × 60 次 ≈ 48s 都嫌慢，实况更慢**（含 expandDeclaredTouches
glob 展开 + MIS 子集算法的叠加）。

**为什么重要**：tick 步骤 3.6（就绪池维护）与派发闸（步骤 4 读池）都依赖 ready-pool-check——它挂起 ⇒
内层无法补晋/无法确认池可派发，外层 closure 也用它。这是**循环的池维护闸门被性能回归卡死**。

**选定机制方向**：
1. **批量 git 操作**：把 per-task `git log --full-history` 换成**一次** `git log --full-history --name-only`
   全仓扫描（或 `git rev-list --all` + `git log --all --format=%H%x00%an%x00%s`），在内存里按「提交 message
   引用任务 kernel + 该提交修改了任务 specific Touches 路径」匹配——从 O(任务数×路径数) 次 git 调用降到 O(1) 次。
2. **memoize**：同路径跨任务复用结果（很多任务共享 `plugin/scripts/*.ts` 等路径）。
3. **负控制**：行为不变（web-board/upgrade-channel/measure-claude-p 判定不变），只改性能。
4. 若 batch 方案不可行：给 git-history 信号加**每任务/每路径超时或缓存**（磁盘缓存 `git log` 结果，带
   HEAD 指纹失效）。

**基准**：本会话秒级是回归前基线；修复后 `ready-pool-check --root` 应回到 <10s。

## Acceptance Criteria

- [x] AC1: `ready-pool-check --root "$(pwd)"` 回到 <10s（timeout 150 不再触发）
- [x] AC2: 判定不变——web-board/upgrade-channel/measure-claude-p 的 landed=true 保持（回归不破）
- [x] AC3: `notYetFlipped` 排除集不变（web-board/measure-claude-p/ready-pool-floor 仍 excluded）
- [x] AC4: 负控制——未派发 todo 仍不判 landed；glob/(new) 不参与（既有 AC4 夹具全绿）
- [x] AC5: 测试 `node:test` + `// @test-group governance`（沿用 ready-pool-check 自身测试组）

## Evidence

**修复实现**（两处，均在 `plugin/scripts/` + 镜像）：
1. `task-status-drift-check.ts`：新增 `buildGitHistoryIndex()` —— **一次** `git log master --full-history
   -m --name-only --no-renames` 全仓扫描建 path→commit 内存索引（`-m` 使 merge 逐 parent 出文件、按 hash 取
   并集，与 per-task 路径受限 `--full-history` 的 merge 判定语义完全一致——merge 对某路径「touched」当且仅当
   其结果与任一 parent 不同）。`gitHistoryLanded` 在 `opts.gitIndex` 存在时走内存匹配；否则保持原 per-task
   `git log -- <paths>`（单任务 `--check` 路径不变）。
2. `ready-pool-check.ts`：`analyzeTasks` **每进程一次** `buildGitHistoryIndex(root)`，经 `notYetFlipped`
   透传给全部 taskWorkLanded；另将 `expandDeclaredTouches` 的 **walk-once** 文件列表（select-preflight
   既有模式）共享给 O(n²) 的 pairwise checkTouchesPair，避免每对重走全树。
3. `concurrent-batch-scheduler.ts`：`expandDeclaredTouches(globs, root, files=null)` 新增可选预计算文件列表
   （缺省行为不变）。

**Before/after（2026-08-05 19:47-19:56Z 实跑，4 核 load 5-13 的负载机）**：
- before：`timeout 25` 未完成（EXIT=124，25s 截断；任务体记录 >150s ×2）。
- after：`time node .../ready-pool-check.ts --root "$(pwd)"` = **7.2–8.2s**（3 次：7.630s / 7.248s /
  8.223s，load≈8）；`analyzeTasks` profile = 7.1s。
- 组件 profile：taskWorkLanded×39 用索引 **1.2s** vs 不用索引 **8.9s**；checkTouchesPair×741 共享 walk
  **0.46s** vs 每对重走 **39s**；buildGitHistoryIndex **1.5s**（git log 1.3s + 解析）。

**判定回归（Contract invoke / control）**：
- `task-status-drift-check.ts --check gap-web-board-...` = `landed=true`（0.6s）。
- `--check gap-upgrade-channel-cant-sync-build-artifacts-dist-stale` = `landed=true`；
  `--check gap-measure-claude-p-headless-third-party-roundtrip-and-exit-semantics` = `landed=true`。
- pool-check `excluded`（not-yet-flipped）含 web-board / measure-claude-p / ready-pool-floor —— AC3 排除集不变。
- 真实仓 landed 计数：索引路径 **26** == per-task 路径 **26**（无判定漂移）。

**Scoped 测试（`bash scripts/test.sh --for-task gap-ready-pool-check-times-out-after-git-history-signal --allow-thin`）**：
- EXIT=0；静态检查全 PASS（test-framework-policy / test-isolation / task-contract-check **no violations**）。
- 测试 **69 tests, 68 pass, 0 fail, 0 cancelled**（1 skipped 为 opt-in 真实仓）。
- 新增 3 条 batch-index 路径等价测试（web-board 正向 + never-dispatched/shared-kernel/glob+(new)/overshoot
  负向，索引路径 == per-task 路径）。

## Definition of Done

- [ ] AC1–AC5 全部勾上；AC1 实跑输出贴任务体（pool check real 秒数 <10）
- [ ] 性能修复落地：ready-pool-check 回到 <10s；150s timeout 不再触发
- [ ] 判定回归不破（web-board/upgrade-channel/measure-claude-p landed 不变、排除集不变）
- [ ] 全量套件绿（fail 0 且 cancelled 0 且 FULL-SUITE-EXIT=0）

## Touches

- tasks/gap-ready-pool-check-times-out-after-git-history-signal.md（自身文件：勾 AC + 贴 invoke 证据授权）

- plugin/scripts/ready-pool-check.ts（消费端——聚合调 taskWorkLanded）
- plugin/scripts/task-status-drift-check.ts（gitHistoryLanded 批量化/缓存——性能根因）
- plugin/test/ready-pool-check.test.mjs（AC1 性能 + AC2/AC3 回归）
- plugin/test/task-status-drift-check.test.mjs（AC4 负控制回归）
- tasks/gap-ready-pool-taskworklanded-underdetects-prose-ac-merged-tasks.md（交叉标注：gitHistoryLanded 来源）

## Contract

measure   pool_check_ms = `time node --experimental-strip-types plugin/scripts/ready-pool-check.ts --root "$(pwd)"` stdout 的 real 秒数
band      pool_check_ms = < 10（回归前秒级基线；150s timeout 不再触发）
invoke    `time node --experimental-strip-types plugin/scripts/task-status-drift-check.ts --check gap-web-board-needs-an-inconsistency-verdict-it-does-not-have`
control   web-board/upgrade-channel/measure-claude-p 判定不变（AC2）；未派发 todo 不判 landed（AC4）
resume    批量化与回归分两步提交，任一步完成即写盘

## Dispatch review

reviewer: none
at: 2026-08-05T19:4xZ
changed: contract-ratchet compliance，外层补齐（未审——inner 新立任务）；agent 补录实现改动：gitHistoryLanded 批量索引 + ready-pool-check walk-once + 镜像同步，见下方 AC（reviewer: inner 原注，格式补录无语义）。
