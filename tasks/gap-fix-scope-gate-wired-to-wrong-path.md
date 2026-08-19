---
id: gap-fix-scope-gate-wired-to-wrong-path
title: "fix-scope gate 落在 execute-suite-fix.js（standalone 死工作流）零效果——需接线到 fan-in-execute.js 内联 suite-fix prompt"
status: done
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

- [x] AC1: gate 接线到 `fan-in-execute.js` 内联 suite-fix subagent prompt（:391）——fix 前判红是否本任务 Touches 内回归，越界（load-sensitive / checker 误报 / 别任务 bug）defer 不修。
- [x] AC2: 负控制落在**生产载体**——真实 fan-in 撞 load-sensitive 红，内联 suite-fix 走 release、零越界 fix-commit（读 fan-in-execute.js 实际 prompt 分类，非 execute-suite-fix.js）。
- [x] AC3: `execute-suite-fix.js` 明确标注为 dead 工作流（或移除），不再被误认为生产 suite-fix 路径。

## Definition of Done

- [ ] 一个真实 fan-in 撞 load-sensitive 红，`fan-in-execute.js` 内联 suite-fix 走 release、零越界 fix-commit（真实输出，生产路径，非 execute-suite-fix.js 隔离分类）——机制已落地并负控制测通，真实生产观察须在落地后下一轮全量红中确认（待外部）

## Touches

- tasks/gap-fix-scope-gate-wired-to-wrong-path.md（自身）
- plugin/workflows/fan-in-execute.js（内联 suite-fix prompt 加 gate）
- .claude/workflows/fan-in-execute.js（与 plugin/workflows 同步）
- plugin/test/fan-in-execute-paths.test.mjs（内联 gate 负控制）
- .claude/workflows/execute-suite-fix.js（AC3 顶部标注 dead，不改功能）
- plugin/workflows/execute-suite-fix.js（与 .claude/workflows 同步，标注 dead）

## Evidence

AC1（gate 接线到 fan-in-execute.js 内联 suite-fix prompt）：`FIX_SCOPE_GATE` 常量落盘于两个 fan-in-execute.js（字节一致），经 `${FIX_SCOPE_GATE}` 注入内联 suite-fix subagent prompt；判定复用 touches-orthogonality-check.ts（parseTouches/matchGlob/normalizePath）+ known-load-sensitive.ts（scanFamily/kindForFile），与 execute-suite-fix.js 同源。suite 日志的失败文件源 = measure-suite-reporter 的 `__PERFILE__ duration_ms=… <path> passed=false` 行（fan-in 的 detached `bash scripts/test.sh` 不走 full-suite-runner.ts，无 state.json failures[]，故 gate 改读日志）。

AC2（负控制落生产载体）：`plugin/test/fan-in-execute-paths.test.mjs` 新增 fix-scope 组——vm 实执行真实 `.claude/workflows/fan-in-execute.js`、驱动 RED 路径发出真实 suite-fix prompt，再对真实 bash 跑 gate 块分类（非 execute-suite-fix.js 隔离分类）。scoped 实跑输出（`bash scripts/test.sh --for-task gap-fix-scope-gate-wired-to-wrong-path --allow-thin`，EXIT=0）：

```
✔ fix-scope wiring — the inline suite-fix prompt carries the gate (判红 Touches 内/越界), NOT execute-suite-fix.js (6.688559ms)
✔ fix-scope REAL negative control — in-Touches red → inScope(fix); out-of-Touches red → other-task defer; load-sensitive red → release (265.47244ms)
✔ fix-scope REAL machine-partition — a task WITHOUT a ## Touches section ⇒ scoped=false, load-sensitive still released, rest inScope (398.854182ms)
✔ fix-scope REAL leak-residual — a tmux-leak-scan: FAIL with no per-file failure ⇒ outOfScope leak-residual (never fixed as a Touches regression) (239.780097ms)
ℹ tests 58
ℹ pass 58
ℹ fail 0
```

负控制判定断言（in-Touches ⇒ fix / 越界 ⇒ defer / load-sensitive ⇒ release）：
`verdict.inScope == ["pkg/a/x.test.mjs"]`；`outOfScope[pkg/OTHER/stray.test.mjs].reason == "other-task"`；`outOfScope[plugin/test/cold-start-skill.test.mjs].reason == "load-sensitive"`（cold-start-skill 是 known-load-sensitive.ts 真实 family member，kind=wall-clock）。

AC3（execute-suite-fix.js 标注 dead）：两个 execute-suite-fix.js 顶部加 `⛔ DEAD / 历史遗留工作流` 注释块（不改功能、不移除），字节一致。`workflows-dual-copy-drift-check: PASS — every dual-copy workflow matches its other copy.`

DoD：待外部（见上）。
