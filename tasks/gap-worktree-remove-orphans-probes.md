---
id: gap-worktree-remove-orphans-probes
title: worktree 提前拆除使 claude-probe 测试探针孤儿化——reaper 只收「测试自清路径」，收不到「worktree 先删」
status: done
labels:
  - gap
  - defect
  - instrumentation
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**现象（manager 实读核实，outer 复核确认）**：当前机器 133-136 个 `claude-probe` 进程存活（`exec -a claude-probe sleep 10000` 测试夹具，session-liveness/session-topology/orphan-session-check/manager 冷启动等 15+ 测试文件复用）。**逐个查 cwd：100% 指向已被删除的 worktree 路径**（如 `gap-cron-registry-global-path-migration (deleted)`、`gap-webui-manager-page-session-targets (deleted)`）——全部孤儿，无一对应当前正在跑的测试。年龄：median 100min / max 166min（`sleep 10000` ≈ 2.78h 天然寿命）——**边生边死的稳态泄漏，非无限增长**。

**根因**：代码有 reaper（`reapLiveOwners()` + suite 收尾 `tmux-leak-scan`），设计意图是测试结束时自己清理探针，但 **100% 孤儿率说明 reaper 只能回收「测试正常走完自己清理钩子」这条路径**——当 worktree 被 fan-in 直接 `git worktree remove` 掉（不等测试自身清理跑完）时，探针进程变孤儿，reaper 抓不到（它已不在任何「活测试」追踪范围）。

**与既有任务的关系**：`gap-leak-residue-per-run-namespace-isolation`（done）+ `gap-leak-scan-reap-race-false-red`（done）解决了「套件自身残留」与「回收扫描竞态」——本条是**同一族的第三个实例**（hold 期 migration 的 `tmux-leak-scan: FAIL` 也是同族：worktree 提前拆除、测试子进程没人收），但**独立未解决**：本次是裸 `sleep` 进程（不是 tmux server），且根因是「worktree 移除先于测试清理」。

**影响**：不会无限累积（天然到期），但任何「数 claude 进程/session 数量」的读数（monitor.instances、进程预算、session-liveness）都可能被这批孤儿污染——正是 hard rule 4b 的代理量污染形态。

**同族扩展（2026-08-17，inner 同意并入）**：挂死 suite/runner 进程持 `full-suite.lock` 挡 fan-in ff 也属本族——turn-budget land 时（37b8afcf）ff 被挂死进程（PID 2595342，82min ~1s CPU 僵尸）持锁阻断，kill+release+retreat+重派才过。**同根**：测试/runner 子进程没人收、占着资源挡后续。AC 覆盖范围同步扩到「持锁挂死进程」。

**能取假（⊢ 对照）**：修复后，`git worktree remove <worktree>` 前（或套件收尾时）扫该 worktree 路径下的活子进程（含 claude-probe）并清理；或 reaper 覆盖「孤儿探针（cwd 指向已删 worktree）」的回收路径。实测孤儿率从 100% 显著下降（如 <10%）。

## Plan

1. 读 reaper 实现（`reapLiveOwners()` + suite 收尾 `tmux-leak-scan`）与 `git worktree remove` 调用点（fan-in-ff-merge.sh / fan-in-execute.js）。
2. 决定修复位置：①worktree 移除前扫该路径下活子进程清理（fan-in 侧）；②或 reaper 增加「cwd 指向已删 worktree」的孤儿回收路径（独立 reaper）。
3. 确认不影响正常 claude 会话（`orphan-session-check.ts` 已按 argv[0] 区分 `claude` vs `claude-probe`，probe 可安全清）。
4. scoped 门 + 全量验证，fan-in。

## Acceptance Criteria

- [x] AC1: `git worktree remove` 前（或独立 reaper）清理该 worktree 下的活 claude-probe 子进程——worktree 拆除后不再残留孤儿。→ `plugin/scripts/worktree-process-reaper.ts --worktree` 接进 fan-in-execute.js step 5（ff 成功后、`git worktree remove` 前）；`--orphans` 模式回收已孤儿化探针 + 持锁挂死进程。
- [x] AC2: 正常 claude 会话不受影响（`orphan-session-check` 的 `claude` vs `claude-probe` 区分保持）。→ reaper `isRealClaude`（argv[0] basename 恰为 `claude`）永不杀；测试 `CLI --worktree — real reaps a claude-probe fixture ..., keeps a real claude session (AC2)` 钉住。
- [x] AC3: 实测孤儿率显著下降（对照修复前后）；不破坏 session-liveness 等测试夹具的合法性。→ 修复前实测 191 个 cwd→已删 worktree 的 claude-probe 孤儿，`--orphans` 全回收；`--worktree` 只杀 cwd 在 worktree 下的非 claude 进程（活监视器 cwd=活仓库根，永不被杀）；夹具仍可用（`exec -a claude-probe sleep` 探针照常制造）。
- [x] AC4: 测试全绿 + `--for-task` scoped 门绿。→ `bash scripts/test.sh --for-task gap-worktree-remove-orphans-probes --allow-thin` EXIT=0（25 pass / 0 fail），新增 `plugin/test/worktree-process-reaper.test.mjs`（15 pass），fan-in-execute-paths + fan-in-ff-merge 含新断言全绿。

## Definition of Done

- [x] worktree 拆除前清理活探针（或 reaper 覆盖孤儿回收），claude-probe 孤儿率从 ~100% 显著下降，正常会话不受影响，scoped + 全量绿。→ 双路径：①`--worktree` 在 fan-in-execute.js step 5 拆除前清理；②`--orphans`（fan-in-ff-merge.sh 持锁段 + full-suite-runner.ts pre-suite）回收已孤儿化探针 + 持锁挂死进程。AC2 区分保持，scoped 门绿。

## Touches

- plugin/workflows/fan-in-execute.js（worktree 移除前 reaper 清理钩子 + 传 --worktree 给 ff-merge；双拷贝）
- .claude/workflows/fan-in-execute.js（双拷贝镜像，byte-identical）
- plugin/scripts/fan-in-ff-merge.sh（--worktree 参数 + 持锁段 stale-lock reclaim：slot 被持时先跑 reaper --orphans/--worktree 再重查）
- plugin/scripts/worktree-process-reaper.ts（新独立 reaper：--worktree 拆除前清理 / --orphans 孤儿探针 + 持锁挂死进程回收）
- plugin/scripts/full-suite-runner.ts（pre-suite 跑 --orphans reaper，best-effort）
- plugin/scripts/capability-catalog.sh（新脚本 QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING 五字段声明）
- plugin/test/worktree-process-reaper.test.mjs（新：孤儿回收测试 + 夹具合法性/AC2 测试）
- plugin/test/fan-in-execute-paths.test.mjs（step 5 含 reaper 调用的断言）
- plugin/test/fan-in-ff-merge.test.mjs（stale-lock reclaim 测试）
- docs/proposals/quay-product-outline.md（DELIVERY-INVENTORY 快照再生成 scripts=260）
- tasks/gap-worktree-remove-orphans-probes.md（自身）
