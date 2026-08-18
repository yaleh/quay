---
id: gap-fix-scope-gate-release-not-persistent
title: "fix-scope gate 的 load-sensitive release 是一次性 relaunch 非持久——relaunch 后仍红，第二轮 suite-fix 越界修（第 9+ 例）"
status: todo
labels:
  - gap
  - mechanism
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

gate 接对路径（`gap-fix-scope-gate-wired-to-wrong-path` 已 done）后**仍有持续性 gap**：journal 显示第一轮 suite-fix 走对了（`relaunched=True`，release 无 fix），但 relaunch 后 suite **又红**（load-sensitive 红持续），第二轮 suite-fix 不再走 release、直接越界修（`a76959c8` session-liveness teardown 第 9+ 例）。⇒ **gate 的 release 是一次性 relaunch，不是「持续 release」**——relaunch-fail 路径上第二轮转 fix，隔离重跑+释放形同虚设。

**修法方向**：gate 的 load-sensitive release 判定必须**幂等持久**——同一 load-sensitive 红无论 relaunch 几轮都 release，不得在某轮转成 fix。

## Acceptance Criteria

- [ ] AC1: gate 的 load-sensitive release 幂等持久——同一红无论 relaunch 几轮都 release（不转 fix）。
- [ ] AC2: 负控制落生产载体——真实 fan-in 撞 load-sensitive 红、relaunch 后仍红，第二轮 suite-fix 仍 release（零越界 fix）。
- [ ] AC3: relaunch-fail 路径的越界 fix 计数归零。

## Definition of Done

- [ ] 一个 load-sensitive 红 relaunch 后仍红，第二轮 suite-fix 仍走 release、零越界 fix（真实输出，生产路径）。

## Touches

- tasks/gap-fix-scope-gate-release-not-persistent.md（自身）
- plugin/workflows/fan-in-execute.js（release 持久化——relaunch-fail 路径仍 release）
- .claude/workflows/fan-in-execute.js（与 plugin/workflows 同步）
- plugin/test/fan-in-execute-paths.test.mjs（relaunch-fail 负控制）
