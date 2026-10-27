---
id: gap-ci-red-task-contract-violations-nonblocking
title: task-contract-check 的四份任务文件契约行 VIOLATION（--no-block 记账，未阻断 CI，跟进修）
status: todo
labels:
  - gap
  - ci-red
  - task-store
  - follow-up
parent: null
children: []
extra: {}
---
## Proposal

`plugin/scripts/task-contract-check.ts`（run_static_checks 里以 `--no-block` 运行，见
`runner-static-gate.ts:227`）在 develop 静态相位打印多行真实 VIOLATION，均不阻断 CI（--no-block 只记账
到 `.quay/task-file-violation-ledger.jsonl`），但属于真实任务文件契约缺陷：
- `tasks/T-903-drill.md` — contract-line-unknown（## Contract 里一段散文）+ dispatch-review-missing。
- `tasks/gap-ci-runner-container-needs-user-systemd.md` — 多条 contract-line-unknown（散文/```/列表）
  + dispatch-review-missing。
- `tasks/gap-cli-lanes-json-verb-for-gantt-consumers.md` — contract-line-unknown + 两条
  contract-measure-no-name + invoke-evidence-missing。
- `tasks/gap-ac264-quay-fleet-project-scope-plugin-only-deployment.md` — invoke-evidence-missing。

## Plan

逐文件按 task-contract-check 的契约修：## Contract 每行必须以 measure|band|invariant|invoke|control|
resume 之一开头（散文移出 Contract 段或改写为契约行）；measure/band 行补 NAME；补 `## Dispatch review`
段；done 任务的 invoke 行补可执行入口路径。全部经 task_write（ABI）整份正文替换，写后逐段 diff。

## AC

- [x] （本任务为跟进记录，尚未修）— 见 DoD 后续验收。
- [ ] `task-contract-check.ts --root <repo>` 无 --no-block 时 exit 0（零 VIOLATION）。

## DoD

四份任务文件的 VIOLATION 清空后，task-contract-check 的默认模式（无 --no-block）exit 0；
`git log` 里可见对应的 task_write 提交。

该轴仍暗,理由:纯任务文件正文修复，不改动 L_D/L_G 依赖结构，本次提交未记录读数