---
id: gap-meta-criterion-capability
title: AC-927 criterion 命令形态改为 goal-store 可认证
status: todo
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

## AC（draft）
- [ ] `node --experimental-strip-types packages/quay/src/goal-store.ts gate AC-927 2>&1 | grep -q 'not-evaluated' && exit 1 || exit 0` ⇒ goal-store gate AC-927 不再报 not-evaluated（返回确定 pass/fail），且把 criterion 改回 cd-prefixed 形态时判据变红

## DoD（draft）
- [ ] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [ ] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `goals/AC-927-codex-mcp-从任意工作根连上-quay-spawn-initialize-校验.md`
- `plugin/scripts/codex-stage1-spawn-verify.sh`
- `tasks/gap-meta-criterion-capability.md`