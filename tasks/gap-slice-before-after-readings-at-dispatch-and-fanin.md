---
id: gap-slice-before-after-readings-at-dispatch-and-fanin
title: 重构切片缺自动 before/after 读数——派发时与 fan-in 后各手工跑一次 archguard，没有「同任务同基线」的成对记录
status: ready
labels:
  - gap
  - defect
  - meta
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**来源（人 2026-10-22 指示本会话与 claudecodeui 会话「Quay 的 OO 设计重构」通信后立项）**：该会话在 claudecodeui 做 OO 重构时，每一刀都是**手工在两个时间点各跑一次 archguard 再对照**。它明确期望：quay 在派发时抓一次基线、fan-in 后再抓一次，写进 task evidence。

**quay 侧现状（两条不同的读数，别混）**：
- `plugin/scripts/design-evolution-readings.ts` 已有**跨窗口趋势**读数（中心文件增长占比，载体 `.quay/design-evolution-history.jsonl`）；
- 但**没有单任务的前后成对读数**：没有「派发那一刻的 HEAD + 结构量」与「fan-in 后同一 scope 的结构量」被绑在同一条记录里。于是每次对照都靠人记得在两个时间点各跑一次，且两次的 scope 设置可能不一致（同口径问题没人守）。

**它实际在用、而我们没有自动化的量**：中心文件行数、call out-degree（同口径）、以及扩展点负对照（后者由 `gap-extension-point-refactor-criteria-scaffold` 承担，本条只管**读数**）。对方报告的示例：driver `outDegree` 203→187、文件 6662→5811。

**已知的读数陷阱（都已在别处被实证）**：
1. **`methodCount` 混了方法体与方法壳**——公开方法壳留在契约上，方法体搬走时它几乎不降（对方实测 88→86）。成对记录必须同时存 `methodCount` 与「方法体计数 / call out-degree」，并标明口径，⛔ 不得只存 `methodCount`。
2. **archguard 可执行体可能解析不到**——`resolveArchguardCli()`（`plugin/scripts/archguard-runner.ts`）只查 PATH 与环境变量，本机安装位置在 plugin 运行时缓存里；解析失败时**必须记 `evaluated:false` + reason，不得写 0**（硬规则 3b）。同族的产物过期问题见 `tasks/gap-arch-cycle-report-never-evaluated-aggregate-and-stale-artifacts.md`。
3. **worktree 拆除后不得再抓**——post 读数必须在 worktree 存活期间、在 fan-in 提交之后抓；worktree 已拆的任务记录为 `NOT-EVALUATED`，不回填。

## Plan

1. **新脚本 `plugin/scripts/slice-readings.ts`**，两条子命令：
   - `--baseline --task-id <id> --scope <subsystem> --head <sha>` → 写 `.quay/slice-readings/<task-id>.json`（gitignored，主检出）；
   - `--post --task-id <id>` → 读同文件的基线，在**同一 scope、同一口径**下再取一次，写 `delta` 与两侧 `headSha`。
   记录 schema（最小键）：`{taskId, phase, evaluated, reason, headSha, scope, metrics:{centralFileLines, centralFileBodyLines, callOutDegree, methodCount, methodShellCount, cycles}}`，外加 `metricBasis`（`summary` 或 `cognitive-summary`，逐量标注）。
2. **接在两条生产路径上**：
   - 派发时（worker 派发路径，`plugin/scripts/worker-driver.ts`）写 baseline；
   - 机械 fan-in 翻转处（`plugin/scripts/worker-fan-in.ts` 的 `flipTaskDone` 附近）写 post，并在 GateEvent / 任务 evidence 里留一行指针（任务体本身仍只经 ABI 写）。
3. **成本**：只分析任务声明的 scope，不跑全仓 analyze；单次新增墙钟时间要实测并记录（不设阈值——成本结构未测之前不设数值门槛，硬规则 4 推论）。
4. **负对照（结构式，不用阈值）**：同一 HEAD 上连跑 baseline 与 post，所有 delta 必须**精确为 0**。这是幂等性，不依赖任何经验阈值。
5. **登记**：新脚本进 `plugin/scripts/capability-catalog-declarations.json`。
6. **口径对照（等对方回答后再做，⛔ 本任务不承诺）**：claudecodeui 的 `centralΔ` 与 quay 的「中心文件增长占比」是否同定义——已发澄清；回答到达前，本条不引用 0.21 与 1% 的可比性。

## Acceptance Criteria

- [ ] AC1 baseline 记录可读：对任一历史提交运行 `--baseline`，`.quay/slice-readings/<id>.json` 中 `evaluated:true`，且 `metrics` 含 `centralFileLines`、`centralFileBodyLines`、`callOutDegree`、`methodCount`、`methodShellCount` 五个键与逐量 `metricBasis`；贴该 JSON 原文。
- [ ] AC2 post 与 baseline 绑定：`--post` 写出的记录 `baselineHeadSha` 等于 AC1 记录的 `headSha`，`scope` 与两侧 `metricBasis` 完全相同，且 `delta` 每个键都有值；贴 complete JSON 与两次 `headSha`。
- [ ] AC3 未评估态独立：把 archguard 解析强制失败（例如 PATH 与 `ARCHGUARD_RUNNER_CLI` 都指向不存在的位置），记录必须是 `evaluated:false` + 非空 `reason`，且 `metrics` 里**不出现 0 值**；贴 CLI 输出与生成的 JSON。同名正对照：正常环境下 `evaluated:true`。
- [ ] AC4 幂等负对照：同一 HEAD 连续跑 baseline 与 post，`delta` 所有数值键精确为 0；贴两份记录与 `jq` 结果。
- [ ] AC5 读生产提交（非 fixture）：用新脚本回放一组成对的**已存在**提交区间（例如 plantuml-js `gap-elk-layout-engine-split-responsibilities` 的拆分提交与其后 8 个功能提交，或 quay `2440b52d0` 窗口），产出两端 `evaluated:true` 的记录并贴出 `centralFileLines` / `callOutDegree` 的两个端点值。**必须使用仓库里真实存在的提交，不得用注入数据。**
- [ ] AC6 接线可见：`grep -n 'slice-readings' plugin/scripts/worker-driver.ts plugin/scripts/worker-fan-in.ts` 各至少 1 行，且贴这两行。
- [ ] AC7 成本读数：跑一次 baseline + post，报告两者各自墙钟秒数与所用 scope；只报数，不设阈值。

## Definition of Done

- 两条生产路径（派发 / 机械 fan-in）都调用新脚本，且有一条真实任务在 fan-in 后留下成对记录（`.quay/slice-readings/` 中同一 `taskId` 的 `baseline` 与 `post` 各一条、都 `evaluated:true`）。
- 失败路径（archguard 不可用、worktree 已拆）都有独立取值，不与「delta=0」同形。
- 新脚本已登记到 capability catalog 且 `--summary` 显示 0 unclassified。

## Touches

- plugin/scripts/slice-readings.ts
- plugin/scripts/worker-driver.ts
- plugin/scripts/worker-fan-in.ts
- plugin/test/slice-readings.test.mjs
- plugin/scripts/capability-catalog-declarations.json
- tasks/gap-slice-before-after-readings-at-dispatch-and-fanin.md
