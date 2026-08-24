---
id: gap-promotion-driver-commit-bypasses-precommit-touches-guard
title: promotion-driver 自动提交绕过 pre-commit Touches 多路径守卫 → 多路径 bullet 静默进 develop
  阻断全量 fan-in
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

promotion-driver 的机械晋升自动提交（todo→ready）**不触发 pre-commit 钩子**（`touches-one-entry-one-path` / 多路径 Touches bullet 守卫），导致多路径 bullet 静默进 develop。生产实例（2026-08-24）：promotion-driver 机械晋升 `gap-worker-task-transcript-access-webui`（e7be44a0）带进 `serve-handlers.ts + serve.ts` 多路径 bullet，未被 pre-commit 拦下（晋升提交路径不触发该钩子）；随后**每个 fan-in 的 `git merge develop` 都被 pre-merge-commit 守卫的 Touches detector 拒**（touches-multi-path-bullet），逼得 fan-in subagent 走 direct-to-develop bypass（d2d23304）拆 bullet 才解锁。

**根因**：pre-commit 守卫只在【手动 commit】路径触发；promotion-driver 的自动提交是另一条路径，绕过了它 ⇒ 多路径 bullet 在 promotion 时静默进 develop，直到 merge 时才被 pre-merge-commit 守卫兜底拦下（晚、且代价是全量 fan-in 阻塞 + 逼出 bypass）。

## Plan

让 promotion-driver 的提交路径也触发/复用 Touches 多路径守卫——或（a）在 promotion-driver 提交前跑一次 `touches-one-entry-one-path`（或等价的 bullet 单路径检查），fail 即不提交并报；或（b）把守卫前移到任务文件写入/晋升判定处，任何路径（手动/晋升/worker）都过同一道闸。

## Acceptance Criteria

- [ ] AC1（能取假，晋升路径拦多路径）：promotion-driver 提交一个含多路径 Touches bullet 的任务时，该 bullet 被拦下（不进 develop）。⛔ 仍静默进 develop ⇒ 假。
- [ ] AC2（能取假，手动路径不退化）：手动 commit 的 pre-commit 守卫仍拦多路径 bullet（不因改动退化）。⛔ 手动路径失效 ⇒ 假。

## Definition of Done

promotion-driver 提交路径接入 Touches 多路径守卫落地 develop；AC1-2 全勾；负控制（e7be44a0 同形多路径 bullet 在晋升时被拦）实证通过。

## Touches

- plugin/scripts/promotion-driver.ts（提交前接 Touches 单路径守卫）
- plugin/scripts/touches-one-entry-one-path*（或现有多路径 bullet 守卫，如守卫在别处则列该处）
- tasks/gap-promotion-driver-commit-bypasses-precommit-touches-guard.md（自身）