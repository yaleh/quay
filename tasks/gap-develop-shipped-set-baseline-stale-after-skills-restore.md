---
id: gap-develop-shipped-set-baseline-stale-after-skills-restore
title: develop shipped-set 基线未随 skills 回归修复重锚（287，实际 315）
status: done
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

- [x] AC1 重锚前读数：从 develop 用 release-shaped `publish-dist-branch.sh` 构建 artifact，`shipped-set-rules.ts --check <artifact> --size-ceiling` 报 `files 310 > ceiling 287`（见 ## 验证记录 ①；立案文本的 315 是 0.30.1 hotfix 从无版本 tag 的 detached head 构建、跳过 .sh prune 的读数，release.yml 从 tag 构建走 release-form + prune，实测 310）。
- [x] AC2 重锚：`--reanchor` 后 baseline 的 `shipped` = develop artifact 真实 totals = `{"files":310,"bytes":71419783,"shLines":7489}`（`_reanchorLog` 末条 shipped 同值，见 ## 验证记录 ②）。
- [x] AC3 重锚后检查通过：`shipped-set-rules.ts --check`（含 `--size-ceiling`）对同一 artifact 返回 ok/within（exit 0、`size.over=[]`、measured==ceiling==310，见 ## 验证记录 ③）。
- [x] AC4 反向（能取假）：重锚前 `git show develop:plugin/shipped-set-baseline.json` shipped.files=287、`release-cut.sh 0.31.0 --dry-run` 报 `files 310 > ceiling 287`（AC 取假）；重锚后（本任务分支 HEAD 62d261f89，fan-in ff 后即 develop）shipped.files=310 ≥ 287，`release-cut.sh 0.31.0 --dry-run --base 62d261f89` shipped-set preflight 不再报 ceiling-exceeded（见 ## 验证记录 ④）。

## Definition of Done

develop 的 shipped-set 基线反映「skills 全量恢复」后的真实 artifact 尺寸；下次 release-cut 的 shipped-set preflight 不再失败。

## ADR-007 dark-axis record

该轴仍暗,理由:仅重锚 plugin/shipped-set-baseline.json 基线数值,无包/依赖结构变化,L_D/L_G 无可测结构量。

## 验证记录

① AC1 重锚前（develop f5715ed7b，release-shaped 构建 artifact）：`--check <artifact> --size-ceiling --json` → totals `{"files":310,"bytes":71419783,"shLines":7489}`、`size.over=["files"]`、exit 1：`FAIL — files 310 > ceiling 287 (exceeds by 23) (bytes 71419783, +667549 vs recorded 70752234)`。

② AC2 重锚后 baseline：顶层 ratchet 轴 `{"files":0,"bytes":0,"shLines":0}`；`shipped={"files":310,"bytes":71419783,"shLines":7489}`；`_reanchorLog` 末条 `from.shipped={"files":287,...}`、`shipped={"files":310,"bytes":71419783,"shLines":7489}`。

③ AC3 重锚后：`--check <artifact>` → `PASS — no rule-excluded content; ratchet {0,0,0} ≤ baseline {0,0,0}`（exit 0）；`--check <artifact> --size-ceiling --json` → `size={"ok":true,"over":[],"measured":{"files":310,...},"ceiling":{"files":310,...}}`（exit 0）。

④ AC4 反向：重锚前 `release-cut.sh 0.31.0 --dry-run`（base=develop）→ `CAUSE=release-cut-shipped-set-ceiling-exceeded — files 310 > ceiling 287 (exceeds by 23)`；重锚后 `release-cut.sh 0.31.0 --dry-run --base 62d261f89` → `preflight: shipped-set size ceiling: files 310 / ceiling 310 · .sh lines 7489 / ceiling 7489 — within` + `dry-run: preflight PASSED`。

315→310 校正：0.30.1 hotfix 的 315 是在「无版本 tag 的 detached head」上构建 artifact（`stamp-version --mode build` NOT-EVALUATED ⇒ `.sh` prune 被跳过）测得的；release.yml 的 shipped-set-clean 与 release-cut.sh preflight 都在 release-shaped 分支（/ 版本 tag）上构建并执行 prune，实测 develop artifact = 310 文件 / 7489 .sh 行（与 dist-plugin 分支 310 文件一致）。

## Touches

- tasks/gap-develop-shipped-set-baseline-stale-after-skills-restore.md
- plugin/shipped-set-baseline.json