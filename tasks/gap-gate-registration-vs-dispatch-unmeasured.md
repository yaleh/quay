---
id: gap-gate-registration-vs-dispatch-unmeasured
title: "15 gates registered, 6 dispatched by the live Gate phase — nothing
  measures the difference"
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

`.quay/config.yml` registers **15 gates**. `execute-milestone.js`'s Gate phase dispatches **6**:

```
实跑：vmeta-lag · it0-dashboard-line-budget · tree-hygiene ·
      worktree-branch-hygiene · build-evidence · split-or-commit
```

注册但不在该路径上的 9 个：`impl-row`、`line-budget`（注意实跑的是 `it0-dashboard-line-budget-check.sh`，与注册的 `it0-ceiling-line-budget-check.sh` 是**不同脚本**）、`audit-independence`、`dogfood-evidence`、`drivable-workspace`、`delivery-standalone-smoke`、`anti-gaming`、`loadbearing-test`、`it0-dod-check-tests`、`ts-typecheck`。

它们可能在别处被调用——`it0-dod-check` 内部、手工 `quay gate`、CI job。**但没有任何机械证据说明哪个是哪个**，所以无法回答一个基本问题：注册了一个 gate，它到底会不会跑？

### 为什么现在做，以及为什么是「报告」而非「门禁」

exp6 scope（`docs/proposals/exp6-queue-driven-concurrent-executor.md` §0）确认交付分两阶段。**一个 gate 未被派发，在阶段 1 不等于死代码**——`delivery-standalone-smoke`、`dogfood-evidence` 这类是产品交付度量，阶段 2 才启用。

所以这个机制**报告事实，不做判决**。判决需要人看着两阶段的上下文做。做成阻塞门禁会在阶段 1 误杀阶段 2 要用的东西——正是 ADR-021 原则 1 警告的「在模糊信号上加硬门禁」。

## Chosen mechanism

`experiments/quay-perpetual-stream/scripts/gate-dispatch-coverage.ts`（`plugin/scripts/` 符号链接镜像，遵循既有约定）：

1. 解析 `.quay/config.yml` 的 `gates:` 段，得到注册集（名称 → script/command）
2. 静态扫描派发面，得到被引用集：
   - `.claude/workflows/*.js` 与 `plugin/workflows/*.js`（Gate 阶段与其它阶段的 shell 调用）
   - `experiments/quay-perpetual-stream/scripts/it0-dod-check.ts`（clause 内 shell-out）
   - `.github/workflows/*.yml`（CI job）
   - `experiments/quay-perpetual-stream/OUTER-LOOP.md`
3. 对每个注册 gate 输出：`dispatched-by`（引用点列表）或 `no-known-dispatcher`
4. 反向也报：**被派发但未注册**的脚本（`it0-dashboard-line-budget-check.sh` 目前就是这一类——实跑但注册的是另一个名字）
5. `--json` 输出机器可读；**恒定退出 0**

**不做**：不判定「死代码」，不删除，不阻塞。输出是一张待人工判读的表。

## Acceptance Criteria

- [ ] AC1: `gate-dispatch-coverage.ts` 存在，`plugin/scripts/` 为真文件、`experiments/` 为符号链接（既有约定）
- [ ] AC2: 解析 `.quay/config.yml` 得到全部 15 个注册 gate（数量可断言）
- [ ] AC3: 扫描 4 类派发面并对每个 gate 输出 `dispatched-by` 引用点（文件:行）
- [ ] AC4: 无已知派发者的 gate 报 `no-known-dispatcher`，不报「dead」
- [ ] AC5: 反向检测——被派发但未注册的脚本被列出（`it0-dashboard-line-budget-check.sh` 是已知实例，可作 fixture）
- [ ] AC6: 注册名与实跑脚本不一致的情况被识别（`line-budget` 注册 `it0-ceiling-...` 但实跑 `it0-dashboard-...`）
- [ ] AC7: `--json` 输出 `{registered:[{name,script,dispatchedBy:[...]}], undispatched:[...], unregistered:[...]}`
- [ ] AC8: 恒定退出 0——grep 确认无非零 exit 路径
- [ ] AC9: 零写入——grep 确认无 `writeFile`/`appendFile`
- [ ] AC10: 对当前仓库跑一次，输出提交到任务体作为阶段 1 基线

## Definition of Done

- [ ] 双镜像（真文件 + 符号链接），fixture 测试覆盖 AC2–AC6
- [ ] 对真实仓库的一次运行输出记录在任务体
- [ ] 测试带 `// @test-group engine` 声明（依赖 [[gap-test-suite-has-no-layer-grouping]]，若该任务未落地则用缺省）

## Touches

- plugin/scripts/gate-dispatch-coverage.ts
- experiments/quay-perpetual-stream/scripts/gate-dispatch-coverage.ts
- plugin/test/gate-dispatch-coverage.test.mjs
