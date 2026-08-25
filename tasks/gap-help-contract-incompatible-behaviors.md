---
id: gap-help-contract-incompatible-behaviors
title: --help 四种互不相容行为，其中两种有害（exit 2 被 harness 当失败、静默跑完整检查含副作用）
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

14 个带 `--help` 的 checker 有四种互不相容行为：
```
usage + exit 0（5/14）        正常（gate-script-base.parseArgs 契约已实现）
usage 但 exit 2（2/14）       会被 harness 当失败
拒绝（2/14）                  anti-drift-touches-check → "ERROR: manifest not found: --help"
                              ready-pool-check → "unknown flag: --help (run with --help ...)"  ← 自相矛盾
静默忽略并跑完整检查（5/14）   landing-target（扫 1485 任务）、strategic-doc-staleness、
                              task-status-drift、trend-check、measure-trend-check
```
⇒ **`measure-trend-check --help` 有副作用是明确 bug**：会真的往 `.quay/measure-history.jsonl`（23MB）追加一轮记录。`--help` 契约要求「用法在前、退出 0、无业务副作用」（gap-scripts-sprawl 已定过这条）。基座 `gate-script-base.parseArgs` 已实现该契约但只有 5/77 采纳。

## Plan

全量 `.ts` checker（77 个）的 `--help` 统一到「用法在前、退出 0、无业务副作用」契约（优先让它们走 `gate-script-base.parseArgs`）；先修有副作用/有害的那几个（measure-trend-check 有副作用、2 个 exit 2 被当失败、2 个拒绝、5 个静默跑）。⛔ 逐个修，不假设全部同构。

## Acceptance Criteria

- [ ] AC1（能取假，全量 exit 0 无副作用）：全部 77 个 `.ts` checker 的 `--help` 退出 0 且无业务副作用；负控制 = 对每个 checker 跑 `--help` 前后比对工作树与 `.quay/` 的 mtime 集合，必须无变化（现在 measure-trend-check 会变）；（⛔ 仍有 exit≠0 或 mtime 变化 ⇒ 假）。
- [ ] AC2（能取假，自相矛盾消除）：`ready-pool-check --help` 不再报「unknown flag: --help (run with --help)」，改为正常打印用法退出 0；（⛔ 仍自相矛盾 ⇒ 假）。
- [ ] AC3（能取假，有副作用消除）：`measure-trend-check --help` 不追加 `.quay/measure-history.jsonl`（跑前后 mtime/行数不变）；（⛔ 仍追加 ⇒ 假）。

## Definition of Done

77 个 `.ts` checker 的 `--help` 契约统一（exit 0 无副作用）；AC1/AC2/AC3 全勾；`--help` 前后 `.quay/` 与工作树 mtime 集合零变化（尤其 measure-history.jsonl）。

## Touches

- plugin/scripts/（77 个 .ts checker 的 --help 契约统一，重点 measure-trend-check / ready-pool-check / anti-drift-touches-check / landing-target / strategic-doc-staleness / task-status-drift / trend-check）
- plugin/test/（--help 无副作用契约测试）
- tasks/gap-help-contract-incompatible-behaviors.md（自身）
