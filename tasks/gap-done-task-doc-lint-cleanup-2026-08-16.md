---
id: gap-done-task-doc-lint-cleanup-2026-08-16
title: "清理：15 个 done 任务的文件文档 lint×18（invoke-evidence×10 / contract-line×4 / dispatch-review×2 / measure-no-field×1 / contract-measure-no-name×1）——独立于 suite-fix，非红成因"
status: done
labels:
  - gap
  - cleanup
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：suite-fix 红基线诊断的副产品（manager 2026-08-16 复算 + 负控制）。

**关键事实（负控制证否）**：这 18 条 `tasks/*.md` 文档 lint 出现在红轮的 failures 里，但**不是红的成因**——
08-15 09:00–13:00 红→绿→红窗口内，这 15 个任务文件**改动 0 次**，绿轮跑时这 18 条原封不动在树里
⇒ 它们是静态门失败时一并打印的附带输出。**修它们不改变门状态**（门的状态由
`direct-to-develop-bypass-check` 决定，见 suite-fix 任务）。

**⇒ 独立清理项**：不并进 suite-fix 的 AC（避免「基线绿」依赖一件无关的事）。这是 15 个
**已完成（status=done）**任务的文档债——机械、低风险。

## Plan

1. 枚举 18 条 lint 所在的 15 个任务文件（invoke-evidence-missing×10 / contract-line-unknown×4 /
   dispatch-review-missing×2 / measure-no-field×1 / contract-measure-no-name×1）。
2. 逐条补齐（Evidence 记录 / Contract 行 / Dispatch review / measure 字段），使文档 lint 清零。
3. 只改已 done 任务的文档段，不改 frontmatter 状态（done 保持 done）。

## Acceptance Criteria

- [x] AC1: 18 条文档 lint 清零（跑产生它们的检查器，violations=0）。
- [x] AC2: 只改 done 任务的文档段，status: done 保持不变。
- [x] AC3: 不依赖 suite-fix 的 bypass-check 门结果——本任务独立达成。

## Definition of Done

- [x] 15 个 done 任务的文档 lint 全清（机械可核），与 suite-fix 解耦。

## Evidence

**清理范围与逐条对应**（15 个 done 任务，19 条原始 lint；按 code 去重后 17 条唯一）：
- **invoke-evidence-missing ×11**（gap-inner-heartbeat / gap-judgepoolcandidate / gap-loop-completion / gap-manager-layer / gap-quay-has-never-self-hosted / gap-quay-init-launch-settings / gap-red-round / gap-serial-install / gap-split-session-liveness / gap-superseded / gap-workflow-metadata）——在任务体 Evidence 段补 invoke 入口路径（entry path 出现于 ## Contract 之外）。
- **contract-line-unknown ×4**（gap-quay-has-never-self-hosted ×2：invariant 多行展开；gap-quay-init-laydown ×2：control 多行展开）——Contract 行折叠为单行。
- **dispatch-review-missing ×2**（gap-ac37 / gap-quay-init-laydown）——补 `## Dispatch review` 段。
- **measure-no-field ×1**（gap-init-scaffolds）——measure 值补字段描述符（exit code）。
- **contract-measure-no-name ×1**（gap-release-freshness）——band 行补 name（`=` 声明）。
- **范围外保留**：`tasks/gap-touches-one-entry-detector-not-enforcer.md`（status=ready，非 done）的 `bare-dir-uncertain-touch` 不在本任务范围，未动。

**机械验证（AC1）**：`node --experimental-strip-types plugin/scripts/task-contract-check.ts --strict-subset <15 个文件>` → `no violations` / `violations: 0` / exit 0（修复前 17 条唯一违规）。

**AC2 验证**：15 个任务文件 `grep -m1 '^status:'` 全为 `done`（frontmatter 未动）。

**AC3 独立性**：本任务不触碰 `direct-to-develop-bypass-check` 相关文件；清理只改任务文档段，不改变门状态。

## Touches

- tasks/gap-ac37-exec-core-ships-with-package.md
- tasks/gap-init-scaffolds-mcp-entry-to-raw-ts-fails-on-installed-copy.md
- tasks/gap-inner-heartbeat-fields-shrunk-no-minimal-contract.md
- tasks/gap-judgepoolcandidate-keyword-vs-position.md
- tasks/gap-loop-completion-path-produces-zero-gateevents.md
- tasks/gap-manager-layer-no-verified-install-vector.md
- tasks/gap-quay-has-never-self-hosted-its-own-cold-start.md
- tasks/gap-quay-init-launch-settings-template-missing-permissions-and-exclude-dynamic.md
- tasks/gap-quay-init-laydown-dominant-red-suite-blocker.md
- tasks/gap-red-round-loses-overhead-phase-decomposition.md
- tasks/gap-release-freshness-no-recut-mechanism.md
- tasks/gap-serial-install-family-shared-prebuilt-fixture.md
- tasks/gap-split-session-liveness-signals-unblocks-lowconc.md
- tasks/gap-superseded-modeled-as-task-lifecycle-terminal.md
- tasks/gap-workflow-metadata-warn-omissions.md
- tasks/gap-done-task-doc-lint-cleanup-2026-08-16.md（自身）
