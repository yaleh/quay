---
id: gap-touches-parser-strip-annotation-nested-parens
title: touches-parser stripTouchAnnotation 正则无法处理嵌套全角括号 ⇒ anti-drift 误判 HARD FAIL（2 次复发：a23 + provisioning 任务的 Touches 注解含嵌套（…））
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**（2026-08-15 复发 2 次后立案，硬规则⑫ 发生率已到）**。

**现象**：`plugin/scripts/touches-parser.ts` 的 `stripTouchAnnotation` 用 `\s*（[^）]*）\s*$` 剥离 Touches 行尾注解——`[^）]*` 无法跨过一个 `）`，故**注解内含嵌套全角括号**时剥离失败 ⇒ 解析出的 glob = 整行（含注解串）⇒ `matchGlob` 对干净路径不命中 ⇒ anti-drift-touches HARD FAIL（假阳性）。

**两次实证**：
- a23 任务：`outer-tick-log-check.sh（...；\`（新增…）\` 注解会被...）` —— 注解内嵌 `（新增…）` ⇒ 剥离失败 ⇒ fan-in 被 anti-drift 误拦（修法：改写注解去嵌套括号）。
- provisioning 任务：`refresh-worktree-quay.sh（新：主检出 .quay/（config/gates/运行时载体）...）` —— 注解内嵌 `（config/gates/运行时载体）` ⇒ 同上误拦（修法：改写注解）。

**每次都是「改写注解绕过」，parser 缺陷本身没修**——第 3 次同形就会再拦。硬规则⑫：发生率 2 已到立案门槛。

**修法（供 inner 选）**：
① `stripTouchAnnotation` 改剥离**第一个 `（` 到最后一个 `）`**（跨嵌套）；
② 或改支持 ASCII `(...)` + 全角 `（...）` 混合；
③ 或换非正则解析（找注解的平衡括号）。
**⛔ 不改阻断语义**：真实越界（实际 diff 不在 Touches 内）仍必须 HARD FAIL；只修「注解剥离」这半边。

**判据1**：`stripTouchAnnotation` 对含嵌套全角括号的 Touches 行正确剥离注解（glob = 干净路径）。
**判据2（能取假·两次实证样本）**：a23 与 provisioning 任务的 Touches 注解（嵌套括号形态）解析出干净 glob + matchGlob 命中；真实越界样本仍不命中（HARD FAIL 保留）。
**判据3**：既有测试全绿；`--for-task` scoped 门绿。

**不覆盖**：不改 anti-drift-touches 检查本身（只修 parser）；不批量改写既有注解（新 parser 兼容它们）。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 touches-parser.ts stripTouchAnnotation（当前正则）+ 其测试。
2. 修法（① 首（→末）剥离 / ② ASCII+全角 / ③ 平衡括号）——按实现代价 + 向后兼容。
3. 判据2 能取假：a23 + provisioning 的嵌套括号注解样本解析正确 + 真实越界仍 HARD FAIL。
4. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：stripTouchAnnotation 处理嵌套全角括号注解（glob = 干净路径）。
- [ ] AC2 判据2 能取假：a23 + provisioning 样本解析正确 + 真实越界仍 HARD FAIL。
- [ ] AC3 判据3：既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] stripTouchAnnotation 处理嵌套括号（a23/provisioning 样本干净 glob + 越界仍 FAIL）+ 测试绿。

## Touches

- plugin/scripts/touches-parser.ts（stripTouchAnnotation 嵌套括号修复）
- plugin/test/touches-parser-parity.test.mjs（嵌套括号用例：a23/provisioning 样本 + 越界仍不命中）
- tasks/gap-touches-parser-strip-annotation-nested-parens.md（自身）

## Evidence

**2026-08-15 落地**：`stripTouchAnnotation` 全角剥离由 `\s*（[^）]*）\s*$` 改为平衡括号扫描（只数全角 `（`/`）`，从末位 `）` 回走至配对 `（`，跨嵌套；ASCII `(` 文字不误判，`（…）` 后接 ASCII 注解的顺序双剥保留），随后 ASCII `(…)` pass 不变。
- 新增 AC1/AC2 用例：a23 形态 `…（…\`（新增…）\`…）` 与 provisioning 形态 `…（新：…（config/gates/运行时载体）…）` → 干净 glob + matchGlob 命中；真实越界样本仍不命中（checkTaskAntiDrift ok:false，out-of-declared 保留）。
- 向后兼容：对仓库全部 4275 条既有 Touches 行做旧/新剥离对比，4273 条逐字节相同；2 条相异均为旧正则剥离失败的嵌套括号注解（gap-ac63-judgment2-no-carrier、gap-cross-machine-readonly-observation-orchestration-not-a-tool）——即本缺陷的既有潜伏实例，新实现正确修复。
- 测试：touches-parser-parity 10/10 绿；touches-orthogonality/bare-dir/touches-one-entry/self-touch/task-status-drift/fan-in-ts-typecheck/fan-in-execute-paths 172 过 0 失 1 预置 skip；quay-init-loop-core 过。
