---
id: gap-driver-fanin-hardcoded-test-sh-third-party
title: fan-in 的 doc-check/scoped-gate 硬编码
  <worktree>/scripts/test.sh，第三方项目无此文件——exit 127 阻断整条 fan-in，config 的
  test_command 从未被读
status: done
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-207
---
## Proposal

**实测复现（2026-09-10，orangevps `/home/yale/work/ac207-third-party`，非主张）**：`e2e-verify-207` 的实现（`e2e-marker.txt` 提交）本身完全正确，但 worker-driver 的机械 fan-in 在 `doc-check` 步骤 `exit 127`：

```
{"step":"doc-check","exit":127,"ok":false,"reason":"bash: /home/yale/work/verify-coldstart-worktrees/e2e-verify-207/scripts/test.sh: No such file or directory"}
```

**根因（位置判定）**：

```
plugin/scripts/worker-driver.ts:3761  const docCmd = opts.docCheckCommand ?? ["bash", path.join(worktree, "scripts", "test.sh"), "--static-checks-doc"];
plugin/scripts/worker-driver.ts:1171  scopedGateCommandFor(task, worktree) → ["bash", path.join(worktree, "scripts", "test.sh"), "--for-task", task, "--allow-thin"]
```

两处都硬编码 `<worktree>/scripts/test.sh`——这是**本仓库自己的**测试入口约定（`CLAUDE.md`："跑测试：scripts/test.sh（唯一入口）"），quay-init 铺给第三方项目的面里**从来没有这个文件**（裁定 6 不复制脚本）。

**更关键的一层**：`.quay/config.yml` 的 `loop.test_command` 字段（本项目实际配置为 `test_command: node --test`）**正是为这个用途设计的**——但全仓 `grep -rl 'test_command' plugin/scripts/*.ts` 只命中 `packages/quay/src/config.ts`（配置解析本身），**没有任何 driver 代码读取并使用它**。这个字段目前只被单项目 `quay:loop-driver` 的 `iterate` 单循环消费，两层 worker-driven 模型（本项目实际驱动方式）完全没有接线。

**⚠️ 范围扩展（2026-09-10 追加实测，人已裁定合并处理而非另开任务）**：用手工 shim 解锁 doc-check/scoped-gate 两步后，fan-in 走到了第三步 `suite-end`，**同一个架构性缺口在这里以更大规模重现**——`defaultMechanicalSuiteCommand`（`worker-driver.ts:3420`）派发 `full-suite-runner.ts` 去跑"suite"，而 `full-suite-runner.ts` 内部至少 **5 处**独立的 naive `path.join(__dirname, ...)` 拼接（未经 `resolveKernelPluginRoot`/`resolveKernelSibling` 的 dist-感知解析），第三方项目下逐一 `Cannot find module`/`No such file`：

```
plugin/scripts/full-suite-runner.ts:1495/:1509  provision-verify-worktree.sh
plugin/scripts/full-suite-runner.ts:1535        resource-gate.sh
plugin/scripts/full-suite-runner.ts:1977        worktree-process-reaper.ts
plugin/scripts/full-suite-runner.ts:2164        suite-load-sampler.ts
plugin/scripts/runner-concurrency.ts:70         process-budget.sh
```

**逐个修补这 5 处不是正确修法**——`full-suite-runner.ts` 是本仓库自己的 bucket 化测试基建（找测试文件、分桶、并发调度），第三方项目根本没有这套概念可对应；即使补完这 5 处，下一层大概率还有更多依赖同样假设仓库结构的调用。**正确修法与 doc-check/scoped-gate 同源**：第三方项目（无 `plugin/`，走 `test_command` 配置）的 suite 步骤根本不该调用 `full-suite-runner.ts`，应直接委托 `test_command`。三步（doc-check / scoped-gate / suite）在第三方项目里是**同一个退化路径**：都退化为"有没有等价配置，没有就跳过/委托，不尝试调用本仓库专属脚本"。

## Plan

1. `docCheckCommand`/`scopedGateCommandFor` 的默认值改为：优先读 `.quay/config.yml` 的 `loop.test_command`（若存在），委托给它并传相应标志/上下文：
   - **doc-check**：第三方项目大概率没有对应概念，缺省应是**跳过**（no-op ok:true），而不是尝试调用一个不存在的脚本。
   - **scoped-gate**：通用形态退化为跑 `test_command`（全量，因为没有"scoped"这个能力）。
2. **`defaultMechanicalSuiteCommand`（suite 步骤）同法退化**：第三方项目（无 `plugin/`）下不调用 `full-suite-runner.ts`，直接执行 `test_command`（`opts.suiteCommand` 已是可覆盖测试缝，缺省值改为条件分支）；⛔ 不去逐个修 `full-suite-runner.ts` 内部的 `__dirname` 锚点——那是治标，第三方项目本就不该走这条代码路径。
3. `scripts/test.sh` 不存在时 fail-closed 但报**可区分的**取值（"third-party-no-doc-check-tooling"），⛔ 不与"文档检查真的跑了且失败"同形（硬规则 3b）。
4. 双向负控制：本仓库场景（有 `scripts/test.sh`）三步行为逐字不变；第三方场景（无该文件，`test_command` 存在）doc-check 跳过、scoped-gate/suite 都走 `test_command`，fan-in 能走完全程翻 done。
5. 生产复跑：orangevps 第三方项目移除手工 shim，重装本次修复后的安装物，`e2e-verify-207` 的 fan-in 不再在任一步报 exit 127/Cannot find module。

## Acceptance Criteria

- [x] AC1（位置判定）：`grep -n 'path.join(worktree, "scripts", "test.sh")' plugin/scripts/worker-driver.ts` 的两处调用点、以及 `defaultMechanicalSuiteCommand` 对 `full-suite-runner.ts` 的调用，都改为条件分支（先判是否存在 `test_command` 配置/`scripts/test.sh` 文件），不再是唯一硬编码路径。
- [x] AC2（双向负控制）：无 `scripts/test.sh` 但有 `test_command` 的第三方场景下，doc-check 返回 ok:true（跳过，可区分取值）、scoped-gate 与 suite 均实际执行 `test_command`；反向：本仓库场景（`scripts/test.sh` 存在）三步行为与修改前逐字一致。
- [ ] AC3（生产复现，移除手工 shim 后复跑）：orangevps 第三方项目移除 `scripts/test.sh` 手工 shim，重装本次修复后的安装物，`e2e-verify-207` 完整走完 fan-in（merge→delta→doc-check→typecheck→scoped门→suite→ff）翻 done，`.quay/fan-in-step-trace.jsonl` 中该任务全部步骤 `ok:true`。（待外部）
- [ ] AC4（全量绿）：`scripts/test.sh` 全量绿（含 `worker-driver.test.mjs` 新增负控制）。（待外部）

## Definition of Done

- 第三方项目不再需要手工制造 `scripts/test.sh` 才能让任务通过 fan-in 翻 done——以 AC3 的生产复现（移除手工 shim 后仍能走完，且不再需要逐个修补 `full-suite-runner.ts` 的内部锚点）为准。
- 全量绿。
- 完成后知会 `gap-ac207-e2e-target-driver-driven-real-commit-task-done` 与预防性任务 `gap-third-party-fixture-smoke-test-driver-family`——后者的夹具测试应把三步（doc-check/scoped-gate/suite）全部纳入回归覆盖。

## Touches

- plugin/scripts/worker-driver.ts
- plugin/test/worker-driver.test.mjs
- tasks/gap-driver-fanin-hardcoded-test-sh-third-party.md