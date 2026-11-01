---
id: gap-develop-shipped-set-baseline-stale-after-skills-restore
title: develop shipped-set 基线未随 skills 回归修复重锚（287，实际 315）
status: ready
labels:
  - gap
  - release
parent: null
children: []
extra:
  schema: execution
---
## Proposal

0.30.0 的 shipped-set 基线（files 287）是在「codex 技能窄化把共享 skills/ 收到 4 个」的错误 artifact 上测的。gap-codex-plugin-ship-human-facing-skills 的回归修复（skills/ 恢复全量 14 + .codex-plugin/skills/ 4）把 artifact 从 287 涨到 315 文件，但 develop 上的 plugin/shipped-set-baseline.json 从未重锚。0.30.1 hotfix 已在 hotfix 分支上重锚（315），develop 仍是 287。后果：下一次 develop 的 release-cut（0.31.0）preflight 会 `files 315 > ceiling 287` 失败。

## Plan

在 develop 上重锚：从 develop 用 publish-dist-branch.sh --no-push 构建 artifact → `shipped-set-rules.ts --reanchor <artifact>` → commit（记录 before/after 读数）。

## Acceptance Criteria

- [ ] AC1 重锚前读数：从 develop 构建 artifact，`shipped-set-rules.ts --check <artifact>` 报 files 315 > ceiling 287（贴命令输出）。
- [ ] AC2 重锚：`--reanchor` 后 baseline 的 `shipped` = develop artifact 真实 totals（贴 baseline shipped 片段 + `_reanchorLog` 末条）。
- [ ] AC3 重锚后检查通过：`shipped-set-rules.ts --check` 对同一 artifact 返回 ok/within（贴输出）。
- [ ] AC4 反向（能取假）：`git show develop:plugin/shipped-set-baseline.json` 的 shipped.files ≥ 315，且 `release-cut.sh 0.31.0 --dry-run` 的 shipped-set preflight 不再报 ceiling-exceeded（贴 preflight 输出）。

## Definition of Done

develop 的 shipped-set 基线反映「skills 全量恢复」后的真实 artifact 尺寸；下次 release-cut 的 shipped-set preflight 不再失败。

## Touches

- tasks/gap-develop-shipped-set-baseline-stale-after-skills-restore.md
- plugin/shipped-set-baseline.json