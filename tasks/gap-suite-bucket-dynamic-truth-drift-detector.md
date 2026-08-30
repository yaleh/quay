---
id: gap-suite-bucket-dynamic-truth-drift-detector
title: 桶归因动态真值 + 漂移检测——fs 访问追踪建 ground truth（抓变量 path.join 等静态盲区），checker 对比静态
  vs 真值报 RED
status: ready
labels:
  - gap
  - feature
parent: null
children: []
extra: {}
---
> **RETREATED / 搁置（审计重新立案：原 done 掩盖采集器从未接进生产（trace cache 全环境不存在、--update 无调度），drift-check 恒 NOT-EVALUATED；③-AC4/③-AC5 新增待执行）**

**type:** execution

## Proposal

`suite-bucket-attribution.ts` 的静态归因是**代理**（静态引用闭包），本质不完备。已修两层盲区（path.join 字面片段 / Run: 头字面），但**每个新隐藏模式就扩大缺口**：实证 `worktree-root-fs-check.test.mjs`——`const pluginDir = path.resolve(__dirname, '..')`（=plugin）再 `path.join(pluginRoot, 'scripts', 'quay-init.sh')`，path.join 的 **pluginRoot 是变量片段** ⇒ 静态归因 M 信号丢失，S 单例。下一层必然：helper 函数返回路径 / 动态 import / 共享 fixture 常量。

**机制升级方向**：用**运行时观测**（动态真值）取代/校验静态猜测，并让「漏选」成为可检测状态。

## 重新执行理由（2026-08-30，审计实证——原任务「done」掩盖了采集器从未接进生产）

原任务 AC 全勾、status=done，但 **AC ③-AC3 只达成「checker 被调用」，未达成「checker 能检测」**：

- **`suite-fs-trace.ts`（采集器）无任何生产接线**：`.quay/suite-fs-trace.jsonl` 在主检出与全部 worktree **均不存在**（`find` 全空）；`suite-fs-trace.ts --update` 无调度/无调用方（grep 仅 checker 引用 + mutation fixture）。采集器头部自述「STANDALONE mechanism (opt-in CLI), NOT wired into the live suite」。
- **`suite-bucket-drift-check.ts`（checker）每轮恒 NOT-EVALUATED**：已注册进 `run_static_checks`（`runner-static-gate.ts:267`），但输入 trace cache 永远为空 ⇒ 每轮打印 `NOT-EVALUATED — no trace cache`，**从不产生判定**。NOT-EVALUATED 区分正确（硬规则 3b），但「恒 NOT-EVALUATED」与「检查不存在的空白」同形——这正是硬规则 3 推论三：**判据只能被 fixture 注入的数据满足 = 证明能产出，不证明已产出**。
- **代价**：分桶执行（`--buckets`，机械 fan-in 默认 suite）建立在**未经验证的静态归因**上；`worktree-root-fs-check` 那类「静态 S、动态 M」的漏测，动态验证侧从未生效。

## 二次审计补记（2026-08-30，重归因覆盖缺口——同批并入本任务）

重扫 `.quay/suite-bucket-reattribution.jsonl` 覆盖（精确谓词：`bucketSetOf` 按 `+` 拆 token，排除 `packages/*/test/`，realpath 去重，349 个 suite 文件）：

- **纯 S 未入重归因 = 0**（无「当壳被误归 S」的漏测风险——安全）。
- **含 S 信号（S+M / P+S+M）未入重归因 = 14 个**：其中 5 个为 8-28 后新增，**9 个早于 AC121 完成却不在重归因内**（`suite-bucket-select` 08-21、`suite-bucket-hub-list` 08-21、`suite-bucket-perfile-emit` 08-22、`worker-driver` 08-22、`suite-lpt-order` 08-24、`fan-in-driver-mechanical-orchestration` 08-27、`fan-in-workflow-lock` 08-27、`suite-driver` 08-27、`touches-orthogonality-check`）。⇒ **AC121 自称「重扫=0」未覆盖这 9 个**（行数 228 vs 声称 230 的对账缺口同源）。这 9 个是**安全方向**（S+M 过度选择、非漏测），但说明重归因覆盖保证本身不完整。
- 重归因文件含 **4 条僵尸条目**（指向已删测试：`ac66-a22-agent-id-check`/`fan-in-ff-executor-check`/`fan-in-workflow-check`/`halt-check`），行数与 AC121 记录需 reconcile。

## Plan

**阶段 A——动态真值（文件访问追踪）**：
1. 包装 `suite-lpt-runner.mjs` / `node --test` 的 fs 访问：对每个测试文件，记录它运行时实际读取/写入的 repo 文件（`fs.readFileSync`/`spawnSync` 的 argv 里的路径，`path.resolve` 归一化）→ 产出 `test → {reads, writes}` 的 ground truth map。
2. 增量缓存：`test → {subjects, 内容 hash}`，只对新增/变更的测试重跑 trace。
3. 关键验证：`worktree-root-fs-check.test.mjs` 的动态 trace 应捕获 `plugin/scripts/quay-init.sh`（静态归因漏的）。

**阶段 B——漂移检测器（把静默变响亮）**：
4. checker 对比「静态归因 vs 动态真值」：某测试静态归 S 单例、动态真值触达 M 文件 ⇒ **RED**（报 `static-vs-truth-drift`）。
5. 对比「动态真值 vs 任务变更文件」：任务改了某文件、其动态真值测试未被选中 ⇒ **RED**（报 `truth-selection-drift`）。
6. 接入 fan-in 的 scoped-gate / 静态检查链，让漏选成为可检测红，而非恒绿假装覆盖（硬规则 3b）。

**阶段 C——生产接线 + 重归因 ratchet（本次重新执行新增，原任务缺的）**：
7. 给 `suite-fs-trace.ts --update` 一个**生产触发点**（候选：`--buckets` 路径顺带增量 collect；或静态检查链低频触发）。内容 hash 缓存保证未变更测试不重跑，成本有界。
8. 产出**生产 trace cache**（非 fixture 注入），drift-check 至少一次读到非空 cache 并输出真实判定（覆盖数 + 漂移数）。
9. **重归因 ratchet checker（两层判据）**：
   - 第 1 层（防漏测，阻断）：新增测试静态**纯 S** 且不在重归因 ⇒ RED。基线 = 0，推进式（前向覆盖）。
   - 第 2 层（留痕，不阻断）：含 S 信号（S+M/P+S+M）未入重归因 ⇒ **只报计数不 gate**——现状 14（含 AC121 遗留 9），过度选择不是漏测，清单留痕供补判，不强制返工。
10. **重归因数据清理**：删除 4 条僵尸条目；行数与 AC121 记录 reconcile（228 vs 230 的对账缺口给出口径）。

**已决（2026-08-30，人裁，不改代码）**：`.quay/suite-bucket-effective.jsonl` 陈旧为**设计接受**（web 参考面非闸门，最老 = 上次 dispatch 时间）——方案 3，不接代码。

## Acceptance Criteria

- [x] ②-AC1（能取假，trace 捕获变量片段路径）：`worktree-root-fs-check.test.mjs` 的动态真值含 `plugin/scripts/quay-init.sh`（⛔ 静态归因漏的、动态也漏 ⇒ 假）。【已达成 2026-08-28，机件落地 + 测试在，本次重验】
- [x] ②-AC2（能取假，增量缓存）：未变更的测试不重跑 trace（⛔ 每次全量重跑 ⇒ 假）。【已达成 2026-08-28，机件落地 + 测试在，本次重验】
- [x] ③-AC1（能取假，漂移 RED）：静态归 S 单例但动态触 M 的测试 ⇒ 漂移检测 RED（⛔ 静默 ⇒ 假）。【已达成 2026-08-28，机件落地 + mutation case 在，本次重验】
- [x] ③-AC2（能取假，负控制）：静态归因正确的测试不报漂移（⛔ 误报 ⇒ 假）。【已达成 2026-08-28，机件落地 + 测试在，本次重验】
- [x] ③-AC3（部分达成，仅「checker 被调用」）：漂移检测注册进 scoped-gate/静态检查链（`runner-static-gate.ts:267` 已接）。⛔ 此 AC 达成的是**接线**，非**能检测**——「能检测」由下方 ③-AC4/③-AC5 承担。【接线已做，本次不重做】
- [ ] ③-AC4（能取假，生产有输入）：`suite-fs-trace.ts --update` 在生产路径有触发点，且 `.quay/suite-fs-trace.jsonl` 由真实运行产生（⛔ 仅测试 fixture 注入 ⇒ 假）。
- [ ] ③-AC5（能取假，读到真值）：drift-check 对生产产生的 trace cache 至少一次读到非空、输出真实判定（覆盖数 + 漂移数，而非每轮 NOT-EVALUATED）（⛔ 恒 NOT-EVALUATED ⇒ 假）。
- [ ] ③-AC6（能取假，ratchet 第 1 层防漏测）：新增一个静态纯 S 且未入重归因的测试 ⇒ ratchet checker RED（⛔ 静默 ⇒ 假；⛔ 基线非 0 ⇒ 假）。
- [ ] ③-AC7（能取假，ratchet 第 2 层留痕）：含 S 未判（S+M/P+S+M）文件被报告为**计数、不阻断**（⛔ 全量 RED 把安全文件当缺陷 ⇒ 假；⛔ 计数恒 0 ⇒ 假——现为 14）。
- [ ] ③-AC8（能取假，数据清理）：重归因文件中 4 条指向已删测试的僵尸条目被移除，行数与 AC121 记录 reconcile（⛔ 僵尸条目仍在 ⇒ 假）。

## Definition of Done

动态真值捕获静态盲区（变量 path.join 实证）；增量缓存；漂移检测器对静态/真值不一致 RED；接入检查链；**且采集器接进生产——trace cache 由真实运行产生、drift-check 至少一次读到非空并输出真实判定**；**重归因 ratchet（第 1 层阻断 + 第 2 层留痕）落地、僵尸条目清理**；②-AC1/②-AC2/③-AC1/③-AC2/③-AC3（已达成重验）+ ③-AC4/③-AC5/③-AC6/③-AC7/③-AC8（新增）全勾。

## Touches

- plugin/scripts/suite-fs-trace-preload.cjs (new — the `--require` node:fs/node:child_process tracer)
- plugin/scripts/suite-fs-trace.ts (new — the dynamic-truth collector + incremental cache)
- plugin/scripts/suite-bucket-attribution.ts（bucketsFromPaths 导出给漂移检测比对）
- plugin/scripts/suite-bucket-drift-check.ts (new — the static-vs-truth drift checker)
- plugin/scripts/suite-bucket-reattr-ratchet-check.ts (new — 重归因 ratchet checker，第 1 层阻断 + 第 2 层留痕)
- plugin/scripts/checker-mutation-cases/suite-bucket-drift-check.sh (new — mutation case)
- plugin/scripts/checker-mutation-cases/suite-bucket-reattr-ratchet-check.sh (new — mutation case)
- plugin/scripts/runner-static-gate.ts（注册 suite-bucket-drift-check + ratchet checker 进 run_static_checks）
- plugin/scripts/capability-catalog.sh（注册新脚本六表）
- plugin/test/suite-bucket-drift-check.test.mjs (new)
- plugin/test/suite-bucket-reattr-ratchet-check.test.mjs (new)
- .quay/suite-bucket-reattribution.jsonl（僵尸条目清理 + 行数 reconcile）
- tasks/gap-suite-bucket-dynamic-truth-drift-detector.md（自身）

## Needs-Human

**执行 2026-08-28T18:44:08.386Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）

**2026-08-30 审计重新立案（原任务 done 后生产从未接入采集器）——退回 todo 重新执行；③-AC4/③-AC5/③-AC6/③-AC7/③-AC8 为本轮新增，②-AC1/②-AC2/③-AC1/③-AC2/③-AC3 已达成待重验。B（重归因 ratchet）与 D（数据清理）并入本任务；C（effective 陈旧）人裁方案 3 接受为设计。**
