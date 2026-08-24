---
id: gap-worker-print-bg-wait-ceiling-600s
title: worker 反复 exited-not-landed 根因：claude -p 模式后台任务等待上限 600s 掐死 fan-in——设
  PRINT_BG_WAIT_CEILING_MS=0 + driver 外部墙钟超时（SPEC 2026-08-16 裁定从未落地）
status: todo
labels:
  - gap
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**根因（manager 2026-08-24 确证，人已裁定立即立案）**：`claude -p` 单回合模式的**后台任务等待上限 600 秒**，把 worker 在 fan-in 阶段掐死。

**证据链（每条可复核）**：
1. worker 是 `-p` 单回合模式：`worker-driver.ts:588` → `quay-launch.sh task-worker -p <prompt>`。
2. worker 实现完后调 `Workflow(fan-in-execute)`——**后台运行、调用立即返回**，worker 说一句「我等完成通知」就结束本回合。
3. `-p` 模式回合结束后最多等后台任务 **600s**，超时**终止进程、退出码 0**。生产日志 `.quay/worker-driver.log` `grep -c "Background tasks still running"` = **45 次**，上下文紧接 worker 的「fan-in workflow 正在后台跑，我等通知」。
4. **算术上必死**：fan-in 链 = 全量 suite + merge + typecheck + flip done + ff-merge；`.quay/full-suite-state.json` 最近一次 `durationMs=516971`（517s）——光 suite 就逼近 600s 天花板，后面几步必然超。

**完美解释所有观察特征**：`exit_code=0`（被干净终止非崩溃）/ `timed_out=false`（driver 没设超时，天花板在 Claude Code 内部、driver 看不见）/ `status=ready + worktree still present`（没走到 flip done）/ 墙钟 29-46min（实现耗时 + ≤600s 等待）/ 同任务连死 3 次（结构性，每次撞同一堵墙）/ 偶尔一个能成（跟 600s 赛跑，suite 快就赢、负载高就输——外层 tick-log 记的「墙钟/load 族」即此）。

**⚠️ 关键：此修复 2026-08-16 已裁定，从未落地**。`orchestration/SPEC-worker-driven-inner-2026-08-16.md:31` 人逐字裁定：
> **3. 时长**：「设 `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`」+「**驱动有外部超时（单任务墙钟）。超时即杀 worker 会话，但保留 worktree。**」

全仓库 `grep -rn "PRINT_BG_WAIT_CEILING"` ⇒ **只有 SPEC 那一行，零实现**（launch.settings.json / quay-launch.sh / worker-driver.ts 全 0 命中）。「SPEC 裁定了但实现从没落地」，同「代码落地≠生产生效」族。

## Plan

两半缺一不可（原裁定完整形态，别只做前一半）：

**(a) 设 `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`**（无限等待）——落点 `.claude/launch.settings.json` 的 `_launchSpec.roles["task-worker"].env`（单点覆盖所有 worker，与现有 env 承载方式一致）。

**(b) driver 侧外部墙钟超时兜底**——`worker-driver.ts` 已有 `--timeout <ms>` 参数，当前缺省 0=无超时。⛔ 只做 (a) 不做 (b) 会把「600s 必死」换成「真跑飞的任务永久占槽」；原裁定明确要求两者并存：「超时即杀 worker 会话，**但保留 worktree**」。

**⛔ (a) 落地方式注意**：改 `_launchSpec.roles["task-worker"].env` 会动 `launch.settings.json`；`quay-launch.sh` 对有角色级 env 的角色走「合并成 JSON 字符串传 --settings」的 `SETTINGS_ARG` 分支，注意别破坏该路径现有语义（空串=删键）。

## Acceptance Criteria

- [ ] AC1（能取假）：**活 worker 进程** env 含 `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`（`tr '\0' '\n' < /proc/<worker-pid>/environ` 可查；⛔ 只改配置文件不算——必须是活进程读得到，同「代码落地≠生产生效」）。
- [ ] AC2（负控制）：一次 **fan-in 时长 >600s** 的真实任务能落地（`final_state=completed`）——证明天花板已拆除，非只改配置。
- [ ] AC3（能取假）：driver 外部墙钟超时生效，且**超时后 worktree 保留**（⛔ 误删 worktree ⇒ 假）。

## Definition of Done

- [ ] AC1-3 全勾；(a)(b) 两半都落地到 develop；生产 worker 进程 env 实测含该变量。

## Retires

- 无（关联：gap-worker-driver-periodic-exit-resident 已重定范围为文档化，其「周期 exit=0」观察与此根因同源但判定为设计 cadence；本任务管的是 -p 后台等待天花板）

## Touches

- .claude/launch.settings.json（_launchSpec.roles["task-worker"].env 加 PRINT_BG_WAIT_CEILING_MS=0）
- plugin/scripts/worker-driver.ts（外部墙钟超时接线/兜底）
- plugin/scripts/quay-launch.sh（SETTINGS_ARG 分支核对，勿破坏空串=删键语义）
- tasks/gap-worker-print-bg-wait-ceiling-600s.md（自身）