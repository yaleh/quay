# exp5 Routine Track & Deliverable Gap Analysis

日期: 2026-07-24  
状态: proposed  
标签: methodology, routines, probes, deliverables, gap-analysis

## 概述

本文档记录了四部分分析：

1. **例程与检查点触发语义** — 低频流程何时以及如何触发
2. **手动触发器缺口** — `on(<event>)` 基础设施已存在但未连接
3. **特定功能缺口** — `quay serve --host` 和 `browser-explorer` 探针
4. **全面的 exp5-vs-交付物差距** — 已交付，仅实验存在，可交付但未打包

---

## 第一部分：低频流程目录

### 每个里程碑（频率 1）——热路径

| 步骤 | 流程 | 机制 |
|---|---|---|
| 0 | **DRAIN** — 处理待处理指令 | 在每个边界读取 `label:directive` 任务 |
| 1 | **explore-exploit-cadence.ts** | 强制 `≥1 per 5`；每次 SELECT 都会运行 |
| 1 | **deliverable-governor.ts** | 连续的；按里程碑累积 streak |
| 1 | **human-steered-classify.ts** | 每个候选者在 SELECT 时运行 |
| 边界 | **`.halt` 哨兵** | 在每个边界读取 |

### 每 5 个里程碑（检查点边界）

**触发条件：** `milestone_counter % 5 == 0`（在里程碑完成*之后*，而不是之前）

| 流程 | 何时触发 | 来源 |
|---|---|---|
| **CHECKPOINT** 写入 `checkpoints/cp-<NN>.md` | `counter % 5 == 0` | OUTER-LOOP.md 步骤 5 |
| **rolling-slope-check.ts** | 在检查点 | DIR-038-A；在 K≥5 上滚动 VT 斜率 |
| **governance-product-ratio-check.ts** | 在检查点 | DIR-066 将其降级为仅信息性 |
| **ROUTINE TRACK** → `self-validation` | `every(5)`（里程碑 5, 10, 15…） | 步骤 5a，`routine-scheduler.ts:38-39` |

### 每 10 个里程碑

| 流程 | 何时触发 | 仪器 |
|---|---|---|
| **`architecture-analysis`** 探针 | `every(10)`（里程碑 10, 20, 30…） | archguard MCP |
| **`history-mining`** 探针 | `every(10)`（里程碑 10, 20, 30…） | meta-cc MCP |

### 条件性（在检查点，仅在斜率触发时）

| 流程 | 触发条件 |
|---|---|
| **chart-saturation-check.ts** | 仅当 rolling-slope 触发 `HALT-RECOMMENDED` |
| **TRANSITION-DUE 子agent起草** | 仅当 chart-saturation 发出 `TRANSITION-DUE` |
| **termination-delta-v-check.ts** | ΔV<0.02 连续 2 次 → `TERMINATION-DUE` |

### 触发实现

`routine-scheduler.ts` 的 `isDue()`（第 38-44 行）：

```typescript
export function isDue(trigger, state = {}) {
  if (t.kind === "every") {
    const it = Number(state.iteration);
    return Number.isInteger(it) && it > 0 && it % t.n === 0;
  }
  // on(<event>) 触发时当 state.event === '<event>'
  return state.event != null && state.event === t.event;
}
```

`iteration > 0` 守卫确保在里程碑 0 时没有任何内容触发。`run-routines.js` 工作流传递 `--iteration <milestoneCounter> --event checkpoint`。

---

## 第二部分：手动触发器缺口

`routine-scheduler.ts` 已经支持两种触发类型：
- `every(N)` — 基于迭代次数
- `on(<event>)` — 基于事件（当 `state.event === '<event>'` 时触发）

`run-routines.js` 工作流硬编码了 `--event checkpoint`（第 24 行）。目前没有 `on(manual)` 例程，也没有手动触发事件的路径。

### 所需内容

1. 工作流接受一个可选参数 `event`（默认为 `"checkpoint"`）
2. 一个 `on(manual)` 例程连接到 `.quay/config.yml` 中
3. 一个 MCP 操作或 CLI 命令，用于触发 `quay routine run --event manual`
4. 当由人类触发时，仅事件模式（`iteration: 0` 抑制 `every(N)`）

---

## 第三部分：特定功能缺口

### 3a. `quay serve --host`（DIR-068）

**现状：** `serve.ts:90` 硬编码 `server.listen(port, "0.0.0.0", ...)`。`StartServerOptions` 只有 `port`。CLI 只有 `--port`，没有 `--host`。

**用例：** `127.0.0.1` 用于仅本地开发，`100.x.x.x` 用于仅 Tailscale 绑定，多实例部署。

**范围：** 在 `serve.ts`、CLI 标志解析和帮助文本中进行约 5 处代码更改。详见 `tasks/DIR-068.md`。

### 3b. Browser-explorer 例程探针（DIR-069）

**现状：** 三个探针中没有一个使用 chrome-devtools/playwright。Web UI 表面（`quay serve` 中的渲染、交互、视觉）对于例程跟踪是黑暗的。

**证据表明这是有价值的：** `serve-browser-render.test.mjs`（QN-046）使用 Playwright 发现了一个真正的错误（字符集编码导致 "Quay â€""），curl/单元测试都错过了。

**与 ADR-010 的关系：** ADR-010 要求在里程碑频率进行计划性浏览器端到端测试，但标记为"enforcement (E3, deferred)"。该探针提供了 ADR-010 所需的机制。

**范围：** 在 `plugin/probes/` 中创建第四个探针规范，连接到 `every(10)` 的例程中，仪器：`chrome-devtools` 备用 `playwright`。详情请参见 `tasks/DIR-069.md`。

---

## 第四部分：综合的 exp5-vs-交付物差距

### 已交付（在 `plugin/` 中）

| 类别 | 内容 |
|---|---|
| **探针规范 ×3** | `self-validation`, `architecture-analysis`, `history-mining` |
| **例程脚本 ×6** | `routine-scheduler.ts`, `read-probe-spec.ts`, `routine-file-gate.ts`, `concurrent-batch-scheduler.ts`, `serial-fanin-absorb.ts`, `anti-drift-touches-check.ts` |
| **任务模式 ×3** | `task-schema.ts`, `task-schema-check.ts`, `task-schema-check.sh`（微小的注释差异——`exp5 /` 前缀） |
| **正交性** | `touches-orthogonality-check.ts` |
| **技能 ×4** | `author`, `execute`, `loop-driver`, `quay-directive` |
| **核心供应商** | `vendor/quay/`（通过 `sync-vendor.sh` 与 `packages/quay` 同步） |
| **测试 ×3** | `plugin-packaging.test.mjs`, `plugin-vendor-standalone.test.mjs`, `probe-spec-wiring.test.mjs` |

所有共享脚本在 `plugin/scripts/` 和 `experiments/scripts/` 之间是二进制相同的（3 个任务模式文件存在微不足道的注释差异——没有逻辑差异）。

### 未交付：门控引擎实现（最大的缺口）

`inherited-core.md` 将约 12 个门视为固定的方法论文本。它们的实现存在于 `experiments/scripts/` 中，但不在 `plugin/scripts/` 中。外部 quay 工作区获得了门控*注册表*（`.quay/config.yml` 中的名称），但没有门控*实现*。

| 门 | 治理 | 实现 |
|---|---|---|
| DoD meta-enforcer（13 条款） | inherited-core §992 | `it0-dod-check.ts` |
| V_meta consolidation-lag | Clause 2 | `vmeta-lag-check.ts` |
| Split-or-commit（DIR-026） | Clause 9 | `it0-split-or-commit-check.ts` |
| 树 + 工作树卫生 | Clauses 10/11 | `tree-hygiene-check.sh`, `worktree-branch-hygiene-check.sh` |
| 审计独立性（DIR-032/034） | Clause 12 | `audit-independence-check.ts` |
| Enforcement-with-design（ADR-011） | 不变性 | `it0-enforcement-with-design-check.ts` |
| 人类引导的分类（DIR-062） | §809 | `human-steered-classify.ts` |
| 负载测试（ADR-001） | 固定 | `loadbearing-test-gate.ts` |
| L_D/L_G/L_S 透镜（ADR-007） | 检查点 | `git-lens-l-*.ts` |
| Design-only→IMPL 行 | DIR-016 | `it0-impl-row-check.sh` |
| 可驾驶工作区 | DIR-062 | `drivable-workspace-check.ts` |
| Anti-gaming guard | DIR-038-A | `anti-gaming-guard.ts` |

### 未交付：工作流编排器

| 工作流 | 位置 | 状态 |
|---|---|---|
| `run-routines.js` | `.claude/workflows/` | 不在插件中——仅安装了插件的消费者获取脚本，但没有端到端的例程管道 |
| `execute-milestone.js` | `.claude/workflows/` | 不在插件中；引用特定于实验的门（`vmeta-lag`，`impl-row`，`it0-dod-check` 等） |

### 未交付：方法论文本技能

| 技能 | 可重用性 |
|---|---|
| `quay-task-to-plan` | 高 — 提案→计划管道，适用于任何 quay 工作区 |
| `quay-native-methodology` | 中等 — 可重用的模式，实验特定的参考 |
| `quay-core-bootstrap-methodology` | 低 — 主要是实验历史 |
| `quay-webui-bootstrap-methodology` | 中等 — 视觉审查规则是可重用的 |

### 结构性问题：双重副本，无同步

10 个脚本在 `plugin/scripts/` 和 `experiments/quay-perpetual-stream/scripts/` 中都存在。`sync-vendor.sh` 处理 `packages/quay` → `plugin/vendor/quay`，但 `plugin/scripts/` → `experiments/scripts/` 方向没有等效的同步。没有任何机制阻止差异产生。

### 仅实验存在（不适合作为交付物）

脚本与实验特定的数据（仪表板、VT 图表、里程碑计数器、自检固定装置）耦合：

- `chart-headroom.ts`, `chart-saturation-check.ts`, `chart2-s1/s2/s3-*.ts`
- `rolling-slope-check.ts`, `termination-delta-v-check.ts`, `explore-exploit-cadence.ts`
- `governance-product-ratio-check.ts`, `outward-vt-check.ts`, `deliverable-governor.ts`
- `it0-backlog-projection-check.ts`, `it0-backlog-regen.ts`
- `it0-ceiling-check.sh`, `it0-ceiling-line-budget-check.sh`, `it0-gate-hash-check.sh`
- `it0-dogfood-evidence-gate.sh`, `it0-dashboard-line-budget-check.sh`, `dod-fixture-selfcheck.sh`
- `restart-readiness-check.sh`, `milestones-since-transition.ts`, `golden-replay-dir044.ts`
- 所有 `*-selfcheck.sh` 固定装置（10+ 个文件）

---

## 建议的优先级

按投资回报率排序：

1. **将门控脚本移动到 `plugin/scripts/`** — 12 个可移植的门实现。外部工作区获得 DoD 强制执行、审计独立性、负载测试、拆分或提交以及其他固定门，作为 `quay gate` 下的免费功能。使 `.quay/config.yml` 的 `gates:` 部分能够解析为插件路径。

2. **`browser-explorer` 探针**（DIR-069） — 关闭 ADR-010 延期部分；持续将 L_T 保持在真实的 Web UI 轴上。

3. **`quay serve --host`**（DIR-068） — 小型、高实用性功能。

4. **将 `run-routines.js` 打包到插件中** — 消费者获得端到端的例程跟踪（已包含调度器 + 探针 + 门控脚本）。

5. **将 `quay-task-to-plan` 打包为插件技能** — 最实用的未打包方法论文本。

6. **将 `on(manual)` 连接到调度器** — 一个很小的补充，实现了异步的人类触发的例程运行。

7. **来自 `plugin/scripts/` → `experiments/scripts/` 的同步机制** — 防止未来的漂移。

---

## 相关任务与指令

| ID | 标题 |
|---|---|
| DIR-051 | 例程跟踪基础架构（调度器 + 门控） |
| DIR-056 | 基于探针的例程分派（`probe:` 字段） |
| DIR-068 | 为 quay serve 添加 --host 选项 |
| DIR-069 | Browser-explorer 例程探针 |
| ADR-010 | 计划性里程碑端到端，包含浏览器测试（已提议，未强制执行） |
| QN-046 | serve-browser-render 测试（已验证价值） |
