---
id: gap-full-suite-runner-missing-load-sensitive-entry
title: full-suite-runner.test.mjs 缺 @load-sensitive-entry → AC4 分级闸红挡所有
  full-suite fan-in（develop 全库 rot）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`429fdc7bd "fix: full-suite-runner.test.mjs 纳入 load-sensitive 族（child-spawn）"` 给该文件加了 `@load-sensitive child-spawn` + KNOWN-LOAD-SENSITIVE 注释，但立案时 develop 一度缺 `// @load-sensitive-entry <date> <reason>` 记录行 ⇒ `known-load-sensitive.test.mjs:322` AC4 分级闸对 serial-group family member 要求 entry，缺即 fail-closed ⇒ 全量红挡所有 full-suite fan-in（retire-governance 的 fan-in 撞上，3×ENL 根因之一）。

## 已核实收尾（2026-08-30，前提已满足）

- **AC1（develop 含 entry）：已满足**——`git show develop:plugin/test/full-suite-runner.test.mjs` 第 3 行含 `// @load-sensitive-entry 2026-08-27 child-spawn (...)`（entry 已落 develop，早于本任务立案）。
- **AC2（闸通过、full-suite 转绿）：已满足**——实跑 `node --experimental-strip-types plugin/test/known-load-sensitive.test.mjs` 28/28 pass（含 real-repo `--check-exit` 系列）；`.quay/full-suite-state.json` 现 green（scope=worktree，692s）。
- 该 entry 落地 ⇒ `gap-retire-governance-group-merge-into-bucket` 2026-08-28 的 3×ENL（撞全量红）已消，A 现具备重派条件。

**→ 任务以「前提已满足」收尾，无待实现改动。**

## Acceptance Criteria

- [x] AC1（能取假）：develop 的 full-suite-runner.test.mjs 含 `@load-sensitive-entry <date> <reason>`；**已核实 2026-08-30**：develop 第 3 行含 `@load-sensitive-entry 2026-08-27 child-spawn (...)`（⛔ 仍无 entry ⇒ 假——已不成立）。
- [x] AC2（能取假）：`known-load-sensitive --check-exit` 通过、full-suite 转绿，fail 3 → 0；**已核实 2026-08-30**：known-load-sensitive 28/28 pass、full-suite-state green（⛔ 仍红 ⇒ 假——已不成立）。

## Definition of Done

entry 记录已存在（develop，2026-08-27）；AC1/AC2 全勾（核实证据见「已核实收尾」）；develop 全库 suite 绿；full-suite fan-in 不再因缺 entry 红。