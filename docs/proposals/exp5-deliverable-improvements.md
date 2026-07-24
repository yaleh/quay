# exp5 交付物改进：实验 → 插件的差距分析

日期: 2026-07-24  
状态: proposed  
标签: deliverables, plugin, gap-analysis, dual-copy

## 概述

本文档对 `experiments/quay-perpetual-stream/` 和 `plugin/`（已交付的 quay Claude Code 插件）进行了结构性对比。它识别出：已交付的内容，仅实验存在的内容，以及最关键的部分——已经可移植但尚未打包到插件中的能力。

这包括插件脚本和实验脚本之间的双重副本结构性问题，即使它们是二进制完全相同的。

---

## 已交付：plugin/ 中的内容

### 探针规范（3）

| 文件 | 仪器 | 范围 |
|---|---|---|
| `plugin/probes/self-validation.md` | none | 基于代码的对抗性自反驳 |
| `plugin/probes/architecture-analysis.md` | archguard | 结构性：循环、上帝包、重复 |
| `plugin/probes/history-mining.md` | meta-cc | 会话历史缺陷 / ADR / 模式挖掘 |

### 例程基础架构（6 个脚本）

| 文件 | 作用 |
|---|---|
| `plugin/scripts/routine-scheduler.ts` | 触发逻辑（`every(N)`，`on(event)`）+ 到期评估 |
| `plugin/scripts/read-probe-spec.ts` | 探针规范加载器 / 验证器（故障关闭） |
| `plugin/scripts/routine-file-gate.ts` | 质量 / 去重 / 速率门控，用于例程发现 |
| `plugin/scripts/concurrent-batch-scheduler.ts` | 接触点不相交的批量组装 |
| `plugin/scripts/serial-fanin-absorb.ts` | 确定性串行扇入计划 |
| `plugin/scripts/anti-drift-touches-check.ts` | 事后接触点护栏 |

### 任务模式（3 个脚本）

| 文件 | 作用 |
|---|---|
| `plugin/scripts/task-schema.ts` | 规范的任务创作模式（验证器即模式） |
| `plugin/scripts/task-schema-check.ts` | task-schema 上的独立 CLI |
| `plugin/scripts/task-schema-check.sh` | 面向循环的 bash 封装器 |

### 正交性检查

| 文件 | 作用 |
|---|---|
| `plugin/scripts/touches-orthogonality-check.ts` | 前期接触点不相交性（DIR-044） |

### 技能（4）

| 技能 | 作用 |
|---|---|
| `plugin/skills/author/SKILL.md` | 驱动任务 todo → ready |
| `plugin/skills/execute/SKILL.md` | 驱动任务 ready → done |
| `plugin/skills/loop-driver/SKILL.md` | 持久化的 select→isolate→build→gate→audit→land 循环 |
| `plugin/skills/quay-directive/SKILL.md` | 将指令记录为任务规范的任务 |

### 测试（3）

| 文件 | 验证的内容 |
|---|---|
| `plugin/test/plugin-packaging.test.mjs` | 清单 + 技能与源二进制完全相同 |
| `plugin/test/plugin-vendor-standalone.test.mjs` | 供应商捆绑包在没有 node_modules 的情况下运行 |
| `plugin/test/probe-spec-wiring.test.mjs` | readProbeSpec + resolveRoutineAction 连接 |

### 核心供应商

`plugin/vendor/quay/` — 通过 `sync-vendor.sh`（DIR-040）与 `packages/quay` 保持同步的 `packages/quay/{bin,src,package.json}` 的生成镜像。

---

## 差距 1：门控引擎实现（最大的缺口）

`inherited-core.md` 将约 12 个门视为固定的方法论文本。它们的**实现**存在于 `experiments/quay-perpetual-stream/scripts/` 中，但不在 `plugin/scripts/` 中。`.quay/config.yml` 的 `gates:` 部分按名称引用它们，但指向实验本地的路径。安装了 quay 插件的外部工作区获得了门控**注册表**（名称），但没有门控**实现**（脚本）。

### 可移植的门（可交付，未打包）

| 门 | governance 来源 | 实现 | 打包后的用途 |
|---|---|---|---|
| DoD meta-enforcer | inherited-core §992，13 条款 | `experiments/scripts/it0-dod-check.ts` | 任何工作区强制执行任务完成完整性 |
| V_meta consolidation-lag | Clause 2 | `experiments/scripts/vmeta-lag-check.ts` | V_meta 指标健康度 |
| Split-or-commit | Clause 9, DIR-026 | `experiments/scripts/it0-split-or-commit-check.ts` | 父任务完成当且仅当所有子任务完成 |
| Tree hygiene | Clause 10 | `experiments/scripts/tree-hygiene-check.sh` | 仓库清洁度（无孤立文件） |
| Worktree/branch hygiene | Clause 11 | `experiments/scripts/worktree-branch-hygiene-check.sh` | Git 工作树 / 分支清洁度 |
| Audit independence | Clause 12, DIR-032/034 | `experiments/scripts/audit-independence-check.ts` | 审计运行于新的上下文中 |
| Enforcement-with-design | ADR-011 | `experiments/scripts/it0-enforcement-with-design-check.ts` | 每个强制执行规则都有一个相应的设计文档 |
| Human-steered classify | DIR-062 | `experiments/scripts/human-steered-classify.ts` | 排除任务自动选择的 3 条款规则 |
| Load-bearing test | ADR-001 | `experiments/scripts/loadbearing-test-gate.ts` | 关键路径测试必须在合并前通过 |
| L_D code-doc ratio | ADR-007 | `experiments/scripts/git-lens-l-d-code-doc-ratio.ts` | 代码与文档的一致性代理 |
| L_G structural drift | ADR-007 | `experiments/scripts/git-lens-l-g-structural-drift.ts` | 结构漂移代理 |
| L_S behavior variance | ADR-007 | `experiments/scripts/git-lens-l-s-behavior-variance.ts` | 行为方差代理 |
| Design-only → IMPL row | DIR-016 | `experiments/scripts/it0-impl-row-check.sh` | 禁止"仅设计"任务在没有相应实现的情况下通过 |
| Drivable workspace | DIR-062 | `experiments/scripts/drivable-workspace-check.ts` | 验证外部工作区可达性 |
| Anti-gaming guard | DIR-038-A | `experiments/scripts/anti-gaming-guard.ts` | `honestNotInflated` 保护 |
| Dogfood evidence | M-GATES | `experiments/scripts/it0-dogfood-evidence-gate.sh` | 要求通过实际使用获得可证明的证据 |
| Impl-row | inherited-core | `experiments/scripts/it0-impl-row-check.sh` | 实现行必须与设计一致 |

### 修复方法

1. 将这些脚本或其在 `plugin/scripts/` 下的 TypeScript 等效脚本复制过去
2. 更新 `.quay/config.yml` 的 `gates:` 部分，引用 `plugin/scripts/` 下的路径
3. 外部工作区随后获得 `quay gate --gate dod-meta-enforcer` 等，无需安装任何实验代码

---

## 差距 2：工作流编排器不在插件中

| 工作流 | 位置 | 问题 |
|---|---|---|
| `run-routines.js` | `.claude/workflows/` | 仅安装了插件的消费者获取脚本（调度器、探针加载器、文件门控），但**没有端到端的编排器**来运行完整的 Schedule→Dispatch→Gate→Verify 管道。工作流引用了 `${CLAUDE_PLUGIN_ROOT}/scripts/` ——它已经是可移植的，只是被放在了错误的位置。 |
| `execute-milestone.js` | `.claude/workflows/` | 更复杂的打包工作；它引用了实验特定的门（`vmeta-lag`，`impl-row`，`it0-dod-check`），这些门在差距 1 被解决之前不会在插件中存在。 |

### 修复方法

将 `run-routines.js` 打包到 `plugin/workflows/`（或等效结构）中。`execute-milestone.js` 随后跟进，一旦门控脚本可用。

---

## 差距 3：方法论文本技能留在 `.claude/skills/` 中

| 技能 | 位置 | 可重用性 | 注释 |
|---|---|---|---|
| `quay-task-to-plan` | `.claude/skills/` | 高 | 提案→计划管道，包含子agent提示。在任何 quay 工作区中都有用。 |
| `quay-native-methodology` | `.claude/skills/` | 中等 | 模式提取库、门控机制参考、V-meta 分析。可重用的内容；实验特定的案例研究。 |
| `quay-core-bootstrap-methodology` | `.claude/skills/` | 低 | 主要是实验历史 + 库存。 |
| `quay-webui-bootstrap-methodology` | `.claude/skills/` | 中等 | 视觉审查机制规则（`visual-review-mechanism.md`），V-meta 上限分析。规则是可重用的；参考是实验本地的。 |

已交付的 4 个技能（author、execute、loop-driver、quay-directive）已经存在于 `plugin/skills/` 中。以上这些是**额外的**——目前仅在实验的 `.claude/skills/` 中。

---

## 差距 4：双重副本结构性问题

### 问题

10 个脚本同时存在于 `plugin/scripts/` 和 `experiments/quay-perpetual-stream/scripts/` 中：

| 文件 | 状态 |
|---|---|
| `anti-drift-touches-check.ts` | 完全相同 |
| `concurrent-batch-scheduler.ts` | 完全相同 |
| `read-probe-spec.ts` | 完全相同 |
| `routine-file-gate.ts` | 完全相同 |
| `routine-scheduler.ts` | 完全相同 |
| `serial-fanin-absorb.ts` | 完全相同 |
| `touches-orthogonality-check.ts` | 完全相同 |
| `task-schema.ts` | 微小差异（注释中的 `exp5 /` 前缀） |
| `task-schema-check.ts` | 微小差异（注释中的 `exp5 /` 前缀） |
| `task-schema-check.sh` | 微小差异（注释中的 `exp5 /` 前缀） |

**不存在同步机制。** `sync-vendor.sh` 处理 `packages/quay` → `plugin/vendor/quay` 方向。不存在等效的 `plugin/scripts/` → `experiments/scripts/` 同步。随着时间的推移，这些副本**将会**产生差异——这是具有前瞻性后果的 DIR-013 漂移模式。

### 选项

**选项 A：使插件成为单一事实来源。** 从 `experiments/scripts/` 中删除重复的脚本。实验脚本引用 `${CLAUDE_PLUGIN_ROOT}/scripts/<name>`（就像 `run-routines.js` 工作流已经做的那样）。消除了双重副本，但要求实验会话加载插件。

**选项 B：添加同步脚本。** 创建一个 `sync-experiment-scripts.sh`，作为 `sync-vendor.sh` 的等效脚本，将 `plugin/scripts/` 复制到 `experiments/scripts/`。防止漂移，但保留双重副本。

**选项 C：使实验脚本成为符号链接。** `experiments/scripts/routine-scheduler.ts` → `../../../plugin/scripts/routine-scheduler.ts`。零拷贝，零漂移，但要求 git 正确跟踪符号链接。

**选项 A 是首选方案**（单一事实来源），与 ADR-004 和 DIR-028 保持一致。选项 C 是一个实用的替代方案，可以在不完全重新连接 `experiments/scripts/` 中所有调用点的情况下消除双重副本。

---

## 仅实验存在（不适合作为交付物）

这些脚本与实验特定的数据（`dashboard.md`、VT 图表、里程碑计数器、自检固定装置）耦合。将它们移动到 `plugin/` 是没有意义的——它们是实验的*消费者*，而不是通用交付物。

| 类别 | 脚本 |
|---|---|
| VT 图表数学 | `chart-headroom.ts`, `chart-saturation-check.ts`, `chart2-s1/s2/s3-*.ts` |
| 循环自我停止 | `rolling-slope-check.ts`, `termination-delta-v-check.ts`, `milestones-since-transition.ts` |
| SELECT 阶段 | `explore-exploit-cadence.ts`, `deliverable-governor.ts`, `governance-product-ratio-check.ts` |
| 积压工作/仪表板 | `it0-backlog-projection-check.ts`, `it0-backlog-regen.ts`, `outward-vt-check.ts` |
| 章程门控 | `it0-ceiling-check.sh`, `it0-ceiling-line-budget-check.sh`, `it0-gate-hash-check.sh`, `it0-dashboard-line-budget-check.sh`, `dod-fixture-selfcheck.sh`, `restart-readiness-check.sh` |
| 迁移 | `it0-task-bulk-write.ts`, `golden-replay-dir044.ts` |
| 自检固定装置 | 所有 `*-selfcheck.sh`（10+ 个文件） |

---

## 差距 5：未来的探针

当前的 3 个探针在 `plugin/probes/` 中已交付，但第四个——一个由 chrome-devtools/playwright 驱动的 `browser-explorer` 探针，用于探索 `quay serve` 的 Web UI 交付物——尚不存在。这在 DIR-069 中作为单独的指令进行了涵盖。一旦构建完成，它将在 `plugin/probes/` 中与其他探针共存。

---

## 建议的操作顺序

| 优先级 | 操作 | 影响 |
|---|---|---|
| 1 | **将门控脚本移动到 `plugin/scripts/`** ——差距 1 | 外部工作区获得 17 个可重用的门。完成了 ADR-007/ADR-011/DIR-026/DIR-032 的执行条款。 |
| 2 | **解决双重副本问题** ——差距 4 | 在复制文件产生差异之前防止未来的漂移。首选选项 A（插件作为单一事实来源）。 |
| 3 | **将 `run-routines.js` 打包到插件中** ——差距 2 | 消费者获得端到端的例程跟踪。 |
| 4 | **将 `quay-task-to-plan` 打包为插件技能** ——差距 3 | 最实用的未打包方法论文本。 |
| 5 | **`browser-explorer` 探针** ——差距 5，DIR-069 | 将 L_T 保持在真实的 Web UI 轴上；关闭 ADR-010 延期部分。 |
| 6 | **打包剩余的方法论文本技能** ——差距 3 | 为外部工作区提供 quay 自身的引导方法论文本。 |

---

## 相关文档

- `tasks/DIR-068.md` — quay serve --host 选项（独立功能缺口）
- `tasks/DIR-069.md` — Browser-explorer 例程探针（独立功能缺口）
- `adr/ADR-004.md` — 单一事实来源；工作流作为权威
- `adr/ADR-007.md` — 收敛代理（L_D/L_G/L_S 透镜）
- `adr/ADR-010.md` — 计划性里程碑端到端，包含浏览器测试（已提议，未强制执行）
- `adr/ADR-011.md` — 通过设计强制执行不变性
- `tasks/DIR-026.md` — 拆分或提交
- `tasks/DIR-028.md` — 任务规范（计划 A）
- `tasks/DIR-032.md` — 审计独立性
- `tasks/DIR-044.md` — 接触点护栏
- `tasks/DIR-062.md` — 人类引导的任务分类
- `experiments/quay-perpetual-stream/inherited-core.md` — 第 992 节（DoD 条款）、第 809 节（人类引导）、第 519 节（Web UI 证据规则）
