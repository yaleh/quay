---
id: gap-driver-fanin-hardcoded-test-sh-third-party
title: fan-in 的 doc-check/scoped-gate 硬编码
  <worktree>/scripts/test.sh，第三方项目无此文件——exit 127 阻断整条 fan-in，config 的
  test_command 从未被读
status: todo
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

**影响范围比之前发现的都大**：本轮先后发现的 5 处 A 类锚点缺陷只挡"driver 能不能启动/派发"；`DOC_BRANCH` 缺陷挡"状态写入能不能被派发看见"；**本缺陷挡的是 fan-in 全链路（merge→delta→doc-check→typecheck→scoped门→suite→ff）能不能走完**——只要 doc-check 或 scoped-gate 任一步 exit 127，整条 fan-in 中止，**任何第三方项目的任务永远无法真正翻 done**，即使实现完全正确。这是本次 AC-207 端到端验证目前发现的最严重的一条。

**当前务实解法（不是修复，是给本次验证解锁）**：已在 orangevps 该第三方项目根手工加了一个最小 `scripts/test.sh` shim（识别 `--static-checks-doc`/`--for-task --allow-thin` 两种调用形态，分别 no-op 或委托 `node --test`），仅解锁本次验证，⛔ 不是通用修法——真正的第三方项目不该被要求手写这个文件。

## Plan

1. `docCheckCommand`/`scopedGateCommandFor` 的默认值改为：优先读 `.quay/config.yml` 的 `loop.test_command`（若存在），委托给它并传相应标志/上下文（`--static-checks-doc`/`--for-task <id> --allow-thin` 这两个标志是本仓库 `scripts/test.sh` 的私有约定，对通用 `test_command` 不适用——需要重新设计"doc-check"和"scoped-gate"这两个概念在通用第三方项目里对应什么）：
   - **doc-check**（纯文档类静态检查）：第三方项目大概率没有对应概念，缺省应是**跳过**（no-op ok:true），而不是尝试调用一个不存在的脚本。
   - **scoped-gate**（该任务改动范围内的测试子集）：通用形态退化为跑 `test_command`（全量，因为没有"scoped"这个能力），或注解为"第三方项目暂不支持 scoped，直接进入全量 suite 步骤"。
2. `scripts/test.sh` 不存在时 fail-closed 但报**可区分的**取值（"third-party-no-doc-check-tooling"），⛔ 不与"文档检查真的跑了且失败"同形（硬规则 3b）。
3. 双向负控制：本仓库场景（有 `scripts/test.sh`）行为逐字不变；第三方场景（无该文件，`test_command` 存在）doc-check 跳过、scoped-gate 走 `test_command`，fan-in 能走到 suite/ff 步骤。
4. 生产复跑：orangevps 第三方项目移除手工 shim，重装本次修复后的安装物，`e2e-verify-207` 的 fan-in 不再在 doc-check/scoped-gate 报 exit 127。

## Acceptance Criteria

- [ ] AC1（位置判定）：`grep -n 'path.join(worktree, "scripts", "test.sh")' plugin/scripts/worker-driver.ts` 的两处调用点都改为条件分支（先判是否存在 `test_command` 配置/`scripts/test.sh` 文件），不再是唯一硬编码路径。
- [ ] AC2（双向负控制）：无 `scripts/test.sh` 但有 `test_command` 的第三方场景下，doc-check 返回 ok:true（跳过，可区分取值）、scoped-gate 实际执行 `test_command`；反向：本仓库场景（`scripts/test.sh` 存在）两步行为与修改前逐字一致。
- [ ] AC3（生产复现，移除手工 shim 后复跑）：orangevps 第三方项目移除 `scripts/test.sh` 手工 shim，重装本次修复后的安装物，`e2e-verify-207` 完整走完 fan-in（merge→delta→doc-check→typecheck→scoped门→suite→ff）翻 done，`.quay/fan-in-step-trace.jsonl` 中该任务全部步骤 `ok:true`。
- [ ] AC4（全量绿）：`scripts/test.sh` 全量绿（含 `worker-driver.test.mjs` 新增负控制）。

## Definition of Done

- 第三方项目不再需要手工制造 `scripts/test.sh` 才能让任务通过 fan-in 翻 done——以 AC3 的生产复现（移除手工 shim 后仍能走完）为准。
- 全量绿。
- 完成后知会 `gap-ac207-e2e-target-driver-driven-real-commit-task-done` 与预防性任务 `gap-third-party-fixture-smoke-test-driver-family`——后者的夹具测试应把本缺陷也纳入回归覆盖（无 `scripts/test.sh` 场景）。

## Touches

- plugin/scripts/worker-driver.ts
- plugin/test/worker-driver.test.mjs
- tasks/gap-driver-fanin-hardcoded-test-sh-third-party.md