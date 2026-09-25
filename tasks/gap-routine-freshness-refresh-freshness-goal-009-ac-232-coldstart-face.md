---
id: gap-routine-freshness-refresh-freshness-goal-009-ac-232-coldstart-face
title: "freshness-refresh [remedy-blocked] Only 19 of 200 commits of window
  remain (0.095) while a coldstart-face run started now needs 2.34h during which
  the delivery face can advance 56 "
status: needs-human
labels:
  - gap
  - routine-filed
  - freshness-refresh
parent: null
children: []
extra: {}
---
## Finding
- remedy-availability：`blocked` · subject：`GOAL-009-AC-232` · host-execution-probe：`host-b-ssh`

Only 19 of 200 commits of window remain (0.095) while a coldstart-face run started now needs 2.34h during which the delivery face can advance 56 commits at the worst observed bucket (24/h) - the tip crosses the window before the run finishes.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1790308195712` · ts `2026-09-25T03:49:55.712Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的
quality / dedup 两道闸机械立案，并按 `remedy-availability` = `blocked` 改走**人可见通道**
（`status: needs-human`，⛔ 不进派发候选）—— ⛔ 不是由人转抄，也不是由探针自行执行。

- subject：`GOAL-009-AC-232`
- 涉及文件：
- `.quay/productization-verification.jsonl:287`
- `plugin/freshness-producers.json:37`
- `.quay/goal-freshness-margin.json:1`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
⛔ **本立案的补救在【本机】不可执行** —— 例程机械执行 `plugin/freshness-producers.json` 声明的
可达性探针 `host-b-ssh`，读到的是**明确的授权拒绝**（`blocked`），不是网络故障、
也不是「没读出来」（那两种是另一个取值）。⇒ 本任务⛔ **不进派发候选**，只走人可见通道。

- 逐字观测：`yale@orangevps.wan.hwang.men: Permission denied (publickey,password).`
- 目标机：`yale@orangevps.wan.hwang.men`
- 补救（一）：把本机 `~/.ssh/id_ed25519.pub` 逐字追加到 `yale@orangevps.wan.hwang.men` 的 `~/.ssh/authorized_keys`（目标侧动作，需人授权）
- 补救（二）：或改在**一台已被 B 授权的主机**上跑本 finding 自己那条 producer 命令（逐字见本文件 `producers[].command`），⛔ 不在此处复制第二份
- 本 finding 自己的 producer 命令（逐字，来自 `plugin/freshness-producers.json`）：
  `bash plugin/scripts/develop-deliver-tgz.sh --verify-coldstart --ac207-e2e --hosts "B C" --force --root <main-checkout>`
- ⛔ 读数不变（仍是 `blocked`）时**不重复立案同一主体**：`GOAL-009-AC-232` 已在板上 ⇒ 不再升级第二次。

（finding 自己的 suggestedAction，逐字：）
re-run coldstart-face on a host authorized to B and C (blocked on this host: ssh Permission denied, see notes)

## AC
- [ ] 上面那台机上那条补救被执行（或本机授权被开通），且 `.quay/routine-findings.jsonl` 里 `GOAL-009-AC-232` 的证据记录 `ts` 晚于本次升级
- [ ] 处置结论可核：要么真的重跑了产出者并把新记录落进载体，要么写明是哪一侧的授权/磁盘前置仍不满足，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 本任务**不是**派发任务：补救在**另一台机**上、或需要目标侧 `authorized_keys` 变更（人授权）；⛔ 例程不代跑，⛔ 也没有「可机械再入队」的路径（人 2026-09-20 裁定）

## Touches
- `plugin/freshness-producers.json`
- `tasks/gap-routine-freshness-refresh-freshness-goal-009-ac-232-coldstart-face.md`