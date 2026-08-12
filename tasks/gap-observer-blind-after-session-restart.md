---
id: gap-observer-blind-after-session-restart
title: session-liveness 观察者在会话重启后失明（绑定旧 transcript，误报 OVERDUE 且报不出真死）
status: done
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**实证（manager 2026-08-12，observer-registry-check + transcript mtime 对照）**：

- 观察者② `.quay/session-liveness.4002865.json`（05:12 起，targets=quay-0:inner）**在 inner 13:1x 重启后失明**——它绑定的是**启动时的 session id**（`session-liveness.sh:29`「会话 id 是配置不去推断」，SESSION_TRANSCRIPTS 启动时定），重启换了 session id 后无任何步骤重指向它。
- 后果两层：**表层**=永远误报 SESSION-OVERDUE（旧 transcript 不会再动）；**里层更危险**=已不在观测 inner——inner 真死它也报不出来（狼来了）。
- 观察者① `.quay/session-liveness.1564238.json`（07:18 起，targets=outer+inner）同病（也绑定旧 inner）。
- 副发现：`observer-registry-check.sh` 能发现观察者被杀（1564238 的注册与 /proc 不符），但**没人定期跑它**——「观察者被杀」本身无观察者（gap-sweeptmp-pkill 候选 D 的遗留缺口）。

**根因**：观察者在**启动时**把目标会话的 transcript 路径绑定死；会话重启（新 session id = 新 transcript 路径）后不重解析。

**修法（robust，manager 建议 2）**：观察者**每轮按 tmux 窗口名动态解析**目标 transcript（窗口名不变，session id 会变），而非启动时绑定 id。**尊重「不去推断」契约**：pid→transcript 映射经 /clear 与 --resume 会失真——所以解析必须**新鲜读窗口当前进程**（不是启动时缓存），且**解析不可靠时回退到配置的 SESSION_TRANSCRIPTS**（保持单源语义）。若 /clear/--resume 场景下窗口→transcript 解析确实不可靠，回退路径保底。

**附带**：重启程序（quay-launch.sh respawn 或手动）应包含「重挂/重指观察者」步骤（若动态解析落地则此步天然消失）。

**验证锚**：(a) 会话重启后观察者自动重解析到新 transcript（自愈，无需重挂）；(b) SESSION-OVERDUE 误报停止（旧 transcript 不再触发）；(c) 真死仍能报（负控制）；(d) 解析不可靠时回退配置（/clear/--resume 场景）；(e) 全量套件绿。

## Plan

1. 读 session-liveness.sh 的 transcript 解析（SESSION_TRANSCRIPTS 启动绑定 vs 动态）。
2. 改：每轮按目标窗口当前进程新鲜解析 transcript；不可靠回退配置。
3. 加测试：会话重启（新 transcript）→ 观察者自愈；/clear/--resume → 回退。
4. 验证 + 回归。

## AC

- [ ] AC1: 会话重启后观察者自动重解析新 transcript（自愈，无重挂）
- [ ] AC2: SESSION-OVERDUE 误报停止（旧 transcript 不触发）
- [ ] AC3: 真死仍报（负控制）；解析不可靠时回退配置（/clear/--resume 契约保留）
- [ ] AC4: observer-registry-check 每轮读数已接（外层 tick 或 READ_CMD，层归属已定）
- [ ] AC5: 全量套件绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 重启自愈 + 回退的实跑贴出（见 Evidence）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿——外层 verification-round 验证

## Touches

- plugin/scripts/session-liveness.sh（动态 transcript 解析 + 回退）
- plugin/test/session-liveness-*（自愈/回退测试）
- tasks/gap-observer-blind-after-session-restart.md（自身）
