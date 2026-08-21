---
id: gap-ac122-suite-bucket-hub-list-full-suite
title: AC122 枢纽文件显式清单 + 触及任一即退回全量（22 个含 H 任务回放 22/22）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac120-suite-bucket-attribution-mechanism
---

**type:** execution

## Proposal

**来源**：`orchestration/manager-phase-goal.md` 当前阶段 AC122。

**判据**：显式落一份**枢纽文件清单**（至少含 `scripts/test.sh`、`plugin/scripts/full-suite-runner.ts`、`plugin/scripts/runner-grouping*`、`plugin/scripts/select-tests-for-touches.ts`）；变更触及清单中任一文件 ⇒ **无条件全量**，⛔ 不试图精算扇出。

**取假**：拿基线里那 22 个「含 H 枢纽」的真实任务回放，**必须 22/22 判为全量**；漏判任一条 ⇒ 本 AC 未达成。

**为什么 inner 执行**：枢纽清单 + 全量退回逻辑是分桶执行机制的一部分（`plugin/scripts/` 或 `scripts/test.sh` 接线）→ inner 域。

## Plan

1. 落一份显式枢纽文件清单（文件内清单，非启发式；至少含上述 4 类）。
2. 分桶执行接线：变更触及枢纽清单任一文件 ⇒ 无条件全量。
3. 用 22 个「含 H 枢纽」真实任务回放，确认 22/22 判为全量。
4. fan-in land。

## Acceptance Criteria

- [ ] AC1: 显式枢纽文件清单已落（含 `scripts/test.sh`、`full-suite-runner.ts`、`runner-grouping*`、`select-tests-for-touches.ts`），非启发式。
- [ ] AC2: 变更触及清单任一文件 ⇒ 无条件全量（不精算扇出）。
- [ ] AC3: 22 个「含 H 枢纽」真实任务回放 22/22 判为全量。

## Definition of Done

- [ ] 枢纽清单 + 全量退回接线完成，22/22 回放绿；land 到 develop；AC1-3 全勾。

## Touches

- plugin/scripts/suite-bucket-hub-list（枢纽清单，载体名可 inner 定）
- tasks/gap-ac122-suite-bucket-hub-list-full-suite.md（自身）
