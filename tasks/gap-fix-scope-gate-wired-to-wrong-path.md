---
id: gap-fix-scope-gate-wired-to-wrong-path
title: "fix-scope gate 落在 execute-suite-fix.js（standalone 死工作流）零效果——需接线到 fan-in-execute.js 内联 suite-fix prompt"
status: ready
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

`gap-suite-fix-workflow-no-load-sensitive-branch`（已 done）的 fix-scope gate 加在 `execute-suite-fix.js`，但该文件是 **standalone 死工作流**——`fan-in-execute.js` 根本不调它（grep 只命中 4 处注释「前例/实证」，无一处真调用），只被 plugin/sync.sh dual-copy + quay-init.sh 铺出。**生产 suite-fix 是 `fan-in-execute.js` 的内联 subagent**（:391 prompt「读失败日志、修根因、detached 重启 suite」）——直接修根因，不经 execute-suite-fix.js。

⇒ gate 落在 execute-suite-fix.js = **零效果**。越界修循环没断（`eb77b17e` 是第 7+ 例、gate land 后第一次复发）。

**这是「判据落在产物上」的反例（硬规则 4 推论三）**：gate 任务的 AC 负控制测的是 execute-suite-fix.js 的**隔离分类**，而生产 suite-fix 走 fan-in-execute.js 的**内联路径**——AC 没读生产载体，两不相交。

## Acceptance Criteria

- [ ] AC1: gate 接线到 `fan-in-execute.js` 内联 suite-fix subagent prompt（:391）——fix 前判红是否本任务 Touches 内回归，越界（load-sensitive / checker 误报 / 别任务 bug）defer 不修。
- [ ] AC2: 负控制落在**生产载体**——真实 fan-in 撞 load-sensitive 红，内联 suite-fix 走 release、零越界 fix-commit（读 fan-in-execute.js 实际 prompt 分类，非 execute-suite-fix.js）。
- [ ] AC3: `execute-suite-fix.js` 明确标注为 dead 工作流（或移除），不再被误认为生产 suite-fix 路径。

## Definition of Done

- [ ] 一个真实 fan-in 撞 load-sensitive 红，`fan-in-execute.js` 内联 suite-fix 走 release、零越界 fix-commit（真实输出，生产路径，非 execute-suite-fix.js 隔离分类）。

## Touches

- tasks/gap-fix-scope-gate-wired-to-wrong-path.md（自身）
- plugin/workflows/fan-in-execute.js（内联 suite-fix prompt 加 gate）
- .claude/workflows/fan-in-execute.js（与 plugin/workflows 同步）
- plugin/test/fan-in-execute-paths.test.mjs（内联 gate 负控制）
