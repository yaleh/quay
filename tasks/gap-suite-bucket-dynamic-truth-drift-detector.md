---
id: gap-suite-bucket-dynamic-truth-drift-detector
title: 桶归因动态真值 + 漂移检测——fs 访问追踪建 ground truth（抓变量 path.join 等静态盲区），checker 对比静态
  vs 真值报 RED
status: needs-human
labels:
  - gap
  - feature
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`suite-bucket-attribution.ts` 的静态归因是**代理**（静态引用闭包），本质不完备。已修两层盲区（path.join 字面片段 / Run: 头字面），但**每个新隐藏模式就扩大缺口**：实证 `worktree-root-fs-check.test.mjs`——`const pluginDir = path.resolve(__dirname, '..')`（=plugin）再 `path.join(pluginRoot, 'scripts', 'quay-init.sh')`，path.join 的 **pluginRoot 是变量片段** ⇒ 静态归因 M 信号丢失，S 单例。下一层必然：helper 函数返回路径 / 动态 import / 共享 fixture 常量。

**机制升级方向**：用**运行时观测**（动态真值）取代/校验静态猜测，并让「漏选」成为可检测状态。

## Plan

**阶段 A——动态真值（文件访问追踪）**：
1. 包装 `suite-lpt-runner.mjs` / `node --test` 的 fs 访问：对每个测试文件，记录它运行时实际读取/写入的 repo 文件（`fs.readFileSync`/`spawnSync` 的 argv 里的路径，`path.resolve` 归一化）→ 产出 `test → {reads, writes}` 的 ground truth map。
2. 增量缓存：`test → {subjects, 内容 hash}`，只对新增/变更的测试重跑 trace。
3. 关键验证：`worktree-root-fs-check.test.mjs` 的动态 trace 应捕获 `plugin/scripts/quay-init.sh`（静态归因漏的）。

**阶段 B——漂移检测器（把静默变响亮）**：
4. checker 对比「静态归因 vs 动态真值」：某测试静态归 S 单例、动态真值触达 M 文件 ⇒ **RED**（报 `static-vs-truth-drift`）。
5. 对比「动态真值 vs 任务变更文件」：任务改了某文件、其动态真值测试未被选中 ⇒ **RED**（报 `truth-selection-drift`）。
6. 接入 fan-in 的 scoped-gate / 静态检查链，让漏选成为可检测红，而非恒绿假装覆盖（硬规则 3b）。

## Acceptance Criteria

- [ ] ②-AC1（能取假，trace 捕获变量片段路径）：`worktree-root-fs-check.test.mjs` 的动态真值含 `plugin/scripts/quay-init.sh`（⛔ 静态归因漏的、动态也漏 ⇒ 假）。
- [ ] ②-AC2（能取假，增量缓存）：未变更的测试不重跑 trace（⛔ 每次全量重跑 ⇒ 假）。
- [ ] ③-AC1（能取假，漂移 RED）：静态归 S 单例但动态触 M 的测试 ⇒ 漂移检测 RED（⛔ 静默 ⇒ 假）。
- [ ] ③-AC2（能取假，负控制）：静态归因正确的测试不报漂移（⛔ 误报 ⇒ 假）。
- [ ] ③-AC3（能取假，接入）：漂移检测在 scoped-gate/静态检查链里生效（⛔ 独立存在不接线 ⇒ 假）。

## Definition of Done

动态真值捕获静态盲区（变量 path.join 实证）；增量缓存；漂移检测器对静态/真值不一致 RED；接入检查链；②-AC1/②-AC2/③-AC1/③-AC2/③-AC3 全勾。

## Touches

- plugin/scripts/suite-lpt-runner.mjs（fs 访问 trace 包装）
- scripts/test.sh（fs 访问 trace 包装）
- plugin/scripts/suite-bucket-attribution.ts（静态归因导出给漂移检测比对）
- plugin/scripts/suite-bucket-drift-check.ts (new)
- plugin/test/suite-bucket-drift-check.test.mjs (new)
- tasks/gap-suite-bucket-dynamic-truth-drift-detector.md（自身）

## Needs-Human

**执行 2026-08-28T18:44:08.386Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
