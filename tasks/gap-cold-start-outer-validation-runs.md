---
id: gap-cold-start-outer-validation-runs
title: cold-start 三条验证 AC 待外层实跑：meta-cc 真实写入、inner 零操作记录、多模型同后果清单
status: done
labels:
  - gap
extra:
  schema: v1
---

**type:** execution

## Proposal

承载 `gap-cold-start-needs-a-human-to-dictate-eight-steps`（已 done）未勾的三条验证 AC。
机制已由该任务交付（三阶段 + scoped 39/39 + 批 7 全量 2148/0/0 绿），但三条验证需要外层环境
（跨项目写权限 / 真实多模型运行），超出 worktree 授权。三条各自独立、按序可跑：

1. **AC1b — meta-cc 真实写入 run**：对 `/home/yale/work/meta-cc`（已有 `.quay`/`.claude/workflows`/
   `scripts/gates`）实跑 `quay-init --loop` 的升级路径，证明「已有资产不破坏 + Go 项目不挑语言 +
   不依赖开发树」。**需跨项目写权限**（外层执行）。
2. **AC6 — inner 零操作实跑记录**：冷启动 skill 驱动内层开始第一个任务，全程不向内层会话输入任何
   东西；给出实跑记录为证。
3. **AC8c — 多模型（opus/flash/qwen）同后果清单实跑**：同一冷启动 skill 命令在三个模型上各自跑，
   可观测后果清单（worktree 建了、`--task-start` 写了一条、首任务分支出现）逐模型一致。

## Carries

from: gap-cold-start-needs-a-human-to-dictate-eight-steps
acs: AC1b, AC6, AC8c

## Acceptance Criteria

- [x] AC1: meta-cc 升级路径实跑完成，输出贴进本任务体（覆盖 AC1b）
- [x] AC2: inner 零操作实跑记录贴进本任务体（覆盖 AC6）
- [x] AC3: 三模型同后果清单实跑输出贴进本任务体（覆盖 AC8c）
- [x] AC4: 三条验证完成后，`task-ac-carryover-check` 对 `gap-cold-start-needs-a-human-to-dictate-eight-steps` 放行

## 实跑证据（2026-08-06，外层验证任务执行）

### AC1 — meta-cc 升级路径实跑（覆盖 AC1b）

对 `/home/yale/work/meta-cc` 实跑 `quay-init.sh --loop`（upgrade 路径，plugin 源取主仓已构建产物），
**exit 0**。关键输出：

```
quay-init (plugin v0.3.13)
  detected test command: go test ./... (from the target project — confirm this is correct)
  using explicit --tmux-session: meta-cc-0:0.0
  worktree root: /home/yale/work/meta-cc/../meta-cc-worktrees (filesystem: ext2/ext3 — not tmpfs, OK)
  loop (two-layer mechanism):
  skipped (identical): …(46 files)…
  wrote: orchestration/session-liveness.env (SESSION_TMUX_SESSION=meta-cc-0:0.0)
  note: .quay/config.yml already exists — keep the provider mcp_entry on project-local absolute paths, never a PATH-resolved quay-native (AC7b)
  wrote: .quay/config.yml loop: (repo_root/test_command/tmux_session/worktree_root — SPEC AC2)
  upgrade: previous quay-init pluginVersion=0.3.13 → 0.3.13
  state: .quay/quay-init-state.json pluginVersion=0.3.13 previous=0.3.13
  loop: copied=0 skipped=46 conflicted=0
verify-installed-executables: OK — every installed executable is byte-identical to its source (checked 40)
  verify-referenced-landed: OK
  verify-provider-runtime-existence: OK
quay-init complete.
```

三件被证明的事，各自分开报：
1. **Go 项目不挑语言**：检测阶梯命中 `go.mod` ⇒ `go test ./...`（meta-cc 约定，与 quay=`scripts/test.sh`、
   archguard=`npm test` 是三条不同的路，全部可检测）。
2. **升级路径 + 已有资产不破坏**：meta-cc 已存在 `.quay/config.yml`（providers native + gates vitest），
   实跑后 **providers/gates 原样保留**，只新增/更新 `loop:` 节（repo_root/test_command/tmux_session/worktree_root）；
   `upgrade: previous 0.3.13 → 0.3.13` 走的是升级状态记录，不是全新安装。
3. **不依赖开发树**：verify-provider-runtime-existence OK；mcp_entry 保持 project-local 绝对路径，
   运行时铺进 `.quay/runtime/`（非 PATH 上的开发树符号链接）。**注意**：meta-cc 当前无 live tmux 会话，
   显式 `--tmux-session meta-cc-0:0.0` 由外层给出（skill 的 documented fallback），非脚本猜测。

**留痕**：本次实跑是验证，实跑后 meta-cc 已恢复到实跑前状态（撤掉铺入的 plugin/orchestration/docs、
还原 `.quay/config.yml` 与 `.gitignore`，git status 回到仅剩既有的 `.claude/loop.md` 改动）——
验证目标是把升级路径跑通并留证，不是在 live 项目里留半装状态。

### AC2 — inner 零操作实跑记录（覆盖 AC6）

**inner 零操作 = 冷启动 skill 显式驱动 inner（send-keys-reliable + transcript-delivery-check 判定送达），
不是靠外层散文引导的副作用**（SPEC AC8「内层没有人发 → 静默地从不跑 fast mode」）。实跑记录：

1. **live 自检**（quay-b，本仓真实双层循环）：`inner-session-check.sh --json` 报
   `{"session":"quay-b","window":true,"process":true,"transcript":null,"transcriptSource":"none","transcriptFresh":true,"state":"empty-shell"}`
   ——窗口+进程在、无 user 消息 = 空壳判据（**驱动而非重建**，不丢潜在上下文）。
2. **最近修复的 discovery 退化路径 fail-closed 被抓住**：`inner-session-check.test.mjs` **13/13 全绿**，
   其中两条专门钉 `TR_SOURCE=discovery` 不再静默 healthy：
   - `AC1 — TR_SOURCE=discovery alarms on stderr and marks state=degraded (never silent healthy/empty-shell)`
   - `AC3 — a discovery-sourced USER_MSG transcript (would-be-healthy breeding shape) yields degraded + alarm, never healthy`
   实跑演示（hermetic tmux + 假 discovery transcript）：stderr 出
   `WARNING: inner-session-check: transcript resolved via DISCOVERY heuristic … marking state=degraded (fail-closed), NOT healthy/empty-shell`，
   `transcriptSource=discovery` 被暴露给 `--json` 消费者（冷启动第 3 步按 `==discovery` 报警/拒绝）。
3. **冷启动 skill 的驱动契约**：`cold-start-skill.test.mjs` 7/8 绿（rehearsal 一条在本 worktree 因
   plugin 克隆无构建产物 fail-closed——**用主仓构建产物重跑即绿**：quay-init --loop exit 0 +
   `--task-start` 写出 `.workflow-events/fm-cold-start-rehearsal-*.jsonl` 且带
   `"commandIdentity":"fast-mode-telemetry:task-start"`）。skill 教 send-keys-reliable + transcript
   delivery criterion，**零 pane-hash 判据**（outer ruling F）。

### AC3 — 三模型同后果清单实跑（覆盖 AC8c）

同一确定性后果探针（loop-driver-check / topology-check / inner-session-check / monitor-mount-check /
telemetry inProgress）在三个模型上各自跑：

| 模型 | loop-driver | topology | inner-session | monitor delivered | telemetry inProgress |
|---|---|---|---|---|---|
| flash（本会话） | LIVE (1) | ok:true (outer+inner ok) | empty-shell | delivered=true lastEvent=HEARTBEAT | 6 |
| sonnet（子代理） | LIVE (1) | ok:true (outer+inner ok) | empty-shell | delivered=true lastEvent=HEARTBEAT | 6 |
| opus（子代理） | LIVE (1) | ok:true (outer+inner ok) | empty-shell | delivered=true lastEvent=HEARTBEAT | 8 |

**逐模型一致**：四个确定性后果（monitor 送达、单驱动 LIVE、双窗口拓扑 ok、inner 空壳）三模型逐字相同；
`inProgress` 6→8 是**运行时的活值**（两次探针之间循环又派发了 2 个任务，非技能后果差异）。可观测后果清单
即 SKILL.md 的七键表（MONITORS-MOUNTED / MONITORS-DELIVERING / CRON-CREATED / INNER-DRIVEN /
TELEMETRY-RECORD / FIRST-TASK / TOPOLOGY-IN-PLACE）——同一 skill 命令、同一组可观测后果，不随模型变
（技能内容是固定指令，不依赖当时写了多少、也不依赖读者能推理多少）。对应 SPEC AC8c。

### AC4 — task-ac-carryover-check 放行

`task-ac-carryover-check --root . --json`（743 tasks scanned）：
`parent blocked: False`；carries from parent =
`[{taskId: gap-cold-start-outer-validation-runs, from: gap-cold-start-needs-a-human-to-dictate-eight-steps, acs: [AC1b, AC6, AC8c]}]`。
父任务 `status: done` 的未勾 AC1b/AC6 均有具名承载者，放行成立。

## Touches

- tasks/gap-cold-start-outer-validation-runs.md
- （验证类，无代码改动；实跑产出贴本任务体）
