---
id: gap-meta-criterion-capability
title: AC-927 criterion 命令形态改为 goal-store 可认证
status: ready
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
脚本已交付（Task A done）但 AC-927 criterion 仍用 `cd packages/quay && bash ../../plugin/scripts/...`，criterion-capability 从 gate cwd 解析不到路径 ⇒ 30 轮 not-evaluated 不清

本轮读数（criteria.AC-927.verdict）= `"not-evaluated"`，采于 2026-10-29T12:08:36Z，由 meta-driver 机械采集。
⚠️ 机制词 `criterion-capability` 命中【已完成】任务：gap-ac925-admission-dispatch-criterion-test.md[done]、gap-criterion-side-effect-unguarded-at-write-and-execution-surface.md[done]、gap-meta-writegoalstatus.md[done]、gap-routine-architecture-analysis-god-function-creategoalstore.md[done]、gap-src-root-gate-cycle-break.md[done]——问题仍在而任务已 done ⇒ 先查那些任务为何没解决它，⛔ 不要在它们旁边新造一个并行机制。

## 结论
已有机制在管、只是 criterion 形态与 capability judge 不兼容：`core/criterion-capability.ts` 的 `executedArtifacts` 把 `../../plugin/scripts/codex-stage1-spawn-verify.sh` 相对 gate cwd（goal-GOAL-912 worktree）解析到不存在的位置 ⇒ `uncertifiable-executed-artifact` ⇒ 判 before-execution not-evaluated。修 AC-927 的 criterion 本身（改为 judge 可解析的 `bash plugin/scripts/codex-stage1-spawn-verify.sh`），⛔ 不新建并行机制。Task A 的脚本此前只落在 goal/GOAL-912 分支，本任务按字节搬入 develop（forward-looking：goal 分支并入后 criterion 落主检出仍可跑）。

## AC（draft）
- [x] `node --experimental-strip-types packages/quay/src/core/goal-store.ts gate AC-927 2>&1 | grep -q 'not-evaluated' && exit 1 || exit 0` ⇒ goal-store gate AC-927 不再报 not-evaluated（返回确定 pass/fail），且把 criterion 改回 cd-prefixed 形态时判据变红

## DoD（draft）
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `goals/AC-927-codex-mcp-从任意工作根连上-quay-spawn-initialize-校验.md`
- `plugin/scripts/codex-stage1-spawn-verify.sh`
- `tasks/gap-meta-criterion-capability.md`

该轴仍暗,理由:本任务仅改 goals/AC-927 的 criterion 字段、按字节搬入一个 shell 脚本、并修 task 自身 AC 命令路径，未触及 packages/* 源码依赖结构，L_D/L_G 无可测增量。

## Evidence
- 正向：`node --experimental-strip-types packages/quay/src/core/goal-store.ts gate AC-927` ⇒ `verdict: pass`、exit 0（capabilityCode=null，脚本在 goal-GOAL-912 worktree 实跑 spawn+initialize PASS）。
- 负控制（判据能取假）：把 criterion 改回 `cd packages/quay && bash ../../plugin/scripts/codex-stage1-spawn-verify.sh` ⇒ `verdict: not-evaluated`、cause=capability、capabilityCode=criterion-capability-unevaluable ⇒ AC 命令 grep 命中 not-evaluated ⇒ exit 1（红）。
- 脚本搬入 develop：与 goal/GOAL-912 分支字节一致（diff 空）。