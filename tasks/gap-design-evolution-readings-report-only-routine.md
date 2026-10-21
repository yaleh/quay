---
id: gap-design-evolution-readings-report-only-routine
title: 设计演进读数例程：把 RM1（分解后增量落回中心文件占比）与 RM2（热点文件并发争用）做成 quality-gate-driver
  的声明式只读例程（零 LLM），让「扩展点模板」这个元机制的效果被自动、持续地用外部直接量观测
status: todo
labels:
  - gap
  - architecture
  - meta
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**为什么要做**：DIR-133（人 2026-10-22 裁定）的裁定 3 要求元机制层优先，并且要用外部可核的直接量观测。目前 RM1 / RM2 只是写在元机制 finding（`gap-design-evolution-meta-mechanism-readings`，done）正文里的一次性命令。按硬规则 4b，靠人记得去复跑的读数迟早会断；而且同一天里这些一次性命令已经出过三次问题，都有实测记录：

- **口径不一**：serve 和 worker 两条命令的分母不同（worker 那条漏算了已存在非中心文件的增长），worker 基线从 88% 更正为 82%。worker 照原命令复跑，发现不了。
- **改路径读空**：serve 的中心文件从 `packages/quay/src/serve-handlers.ts` 搬到了 `packages/quay/src/serve/serve-handlers.ts`，旧命令在新树上读到 0 行，会算出一个无意义的占比。
- **搬家冒充增长**：GOAL-909 的两次提交（f19a95371、024f9d7f2）把 400 行从 worker-driver.ts 搬进 worker-pool.ts，跨过这两次提交量出的读数从 82% 掉到 69%，下降全部来自搬家。

另有两个用处：GOAL-909 的评价需要从它的落地提交起自动采集读数；DIR-133 讨论中暂缓的 (d) 项（给 Planner 增加一种准入 concern_kind）要求读数能被机械计算，一次性取数不满足这一条。

**发生率（硬规则 12）**：分解后回涨已实测 2 例（worker-driver +63%、worker-fan-in +113%）；一次性读数出错，同一天 3 例（见上）。

**做什么**：在 quality-gate-driver 同族里新增一个**声明式**例程 `design-evolution-readings`（配置段 `loop.design_evolution_readings:`）。不声明这一段就不装配，内建例程仍是 AC144 规定的「恰好四条」；`enabled:false` 是关闭开关，零报告、零写入。例程零 LLM、不 spawn 模型，只读 git 和 `.quay/worker-outcome.jsonl`；每轮向 `.quay/design-evolution-history.jsonl` 追加一行，并向 quality-round 写一个 Fact。同族先例：arch-coverage-report、arch-cycle-report（`loop.arch_cycle_report:`，`ARCH_CYCLE_ROUTINE_NAME`，`.quay/arch-cycle-history.jsonl`）。

**RM1 定义（需声明子系统）**：每个子系统声明 `name`、`baseline`（提交）、`central`（中心文件列表；文件改过路径的，可以分别写基线端路径和 HEAD 端路径）、`modules`（子系统范围的路径 glob）。只用一个公式：`share = centralΔ / (centralΔ + nonCentralΔ)`。centralΔ 是中心文件在 HEAD 与基线之间的行数差之和；nonCentralΔ 是子系统内全部非中心文件（在基线或 HEAD 存在，且匹配 modules）的行数差之和，包括基线之后新增的文件。三值规则（硬规则 3b）：基线解析不了、任何一个中心文件在任一端不存在、分母 ≤ 0，都记 `evaluated:false`，reason 写出具体是哪个路径或条件，`share` 为 null，绝不记成 0 或一个占比。另外每轮都附上窗口内对中心文件改动行数绝对值最大的那次提交（sha、它的 centralΔ 和 nonCentralΔ），这样窗口里如果夹着一次搬家，读者能直接看到，不会被吞进一个总数里。这里不设数值阈值去自动判定「是不是搬家」（硬规则 4 推论）。

**RM2 定义（零配置）**：扫描 `.quay/worker-outcome.jsonl`，按文件路径统计两种形态：形态 1，`selector_reason` 同时含该路径和争用词表里的词；形态 2，记录中出现 `Merge conflict in <路径>`。争用词表只在一处导出，不得复制。按两者之和取前 N 个文件（缺省 10），每个文件给出累计计数、本轮窗口（上一条记录之后）内的计数，以及前 3 条命中样本（任务 id + 时间）。载体缺失记 `evaluated:false`。每轮对一个内置的已知为真的样本行干跑两个谓词（硬规则 4 推论二的检测半边）；干跑不命中就记 `evaluated:false`，让「谓词坏了」不会以「零争用」的样子出现。

## Plan

1. 读 quality-gate-driver.ts 里 arch-cycle-report 的整套接线：`readArchCycleConfig` 解析配置段、`archCycleRoutineFromConfig` 装配（:3143 一带）、`runArchCycleRound` 读数并追加历史、`ARCH_CYCLE_HISTORY_REL`。按同一形状实现新例程，不另起一套机制。
2. 读数逻辑放进新文件 `plugin/scripts/design-evolution-readings.ts`，导出纯函数，由 quality-gate-driver 以库的形式 import。同时提供一个直接入口（`--root <repo> [--history <path>] --json`），方便人按需干跑；入口按 gate-script-base 的 isDirectEntry 惯例写。
3. 新载体 `design-evolution-history.jsonl` 登记到 `docs/carrier-registry.json`，写法与 arch-cycle-history 同族。
4. 如果新文件成为直接入口或打包入口，在 `plugin/scripts/capability-catalog-declarations.json` 补声明（问题栏与节奏栏都要有）；如果打包产物的文件数因此变化，按 `plugin/shipped-set-baseline.json` 自己的协议，用真实 `publish-dist-branch.sh` 产物重锚。注意这个上限是在发版时才检查的，不能留给发版去发现。
5. 测试放在新文件 `plugin/test/design-evolution-readings.test.mjs`；装配相关的断言补进 `plugin/test/quality-gate-driver.test.mjs`。
6. 行为边界：不改 quality-gate-driver 现有例程的行为，不改 `.quay/worker-outcome.jsonl` 的写入方。

## Acceptance Criteria

- [ ] AC1 声明式装配与关闭开关：配置段缺席时不装配，内建例程仍恰好四条；`enabled:false` 时记 `not-evaluated:disabled`，不写历史。测试覆盖两种情况，贴出测试名与通过输出。
- [ ] AC2 统一公式在真实历史上复现已知基线：用直接入口对主检出的真实 git 历史运行，声明 serve（基线 295e771b0，中心文件基线端 `packages/quay/src/serve-handlers.ts`、HEAD 端 `packages/quay/src/serve/serve-handlers.ts`，modules 为 serve 族）与 worker（基线 2440b52d0，读数提交 ff32d031d，中心文件 worker-driver.ts + worker-fan-in.ts，modules 为 `plugin/scripts/` 下文件名含 worker / pool / dispatch / fan-in 的 .ts）。输出必须是 serve 1%、worker 82%（与元机制 finding「口径更正」一节的表一致）。贴出命令与原始输出。
- [ ] AC3 改路径时必须返回「未评估」：对 serve 只写一个中心路径 `packages/quay/src/serve-handlers.ts`（它在 HEAD 已不存在），读数为 `evaluated:false`，reason 写出该路径，share 为 null。测试与真实主检出各跑一次，贴出输出。
- [ ] AC4 RM2 在真实载体上复现 finding 的读数：worker-driver.ts 形态 1 / 形态 2 = 5 / 6，worker-fan-in.ts = 1 / 0，goal-driver.ts = 2 / 0（载体增长了则 ≥ 这些值），每个非零计数附前 3 条样本；谓词自检通过。再用夹具把谓词改坏，读数必须变成 `evaluated:false`。贴出两次输出。
- [ ] AC5 一条真实生产读数：直接入口对主检出真实数据运行一次（历史写到临时路径），得到一条 `evaluated:true`、同时含 RM1 与 RM2 的记录，并附「窗口内单次最大中心文件变动提交」字段。贴出该记录原文。

## Definition of Done

- [ ] 五条 AC 全绿；`scripts/test.sh` 相关泳道通过；合并进 develop。
- [ ] 新载体已登记到 carrier-registry；若新文件成为入口，catalog 声明已补；若打包文件数变化，shipped-set 基线已用真实产物重锚并写明原因。
- [ ] 读数全部来自真实 git 历史与真实载体，不用夹具冒充生产读数（夹具只用于 AC1、AC3、AC4 里的负对照）。

## 落地后操作（不属于本任务的完成条件）

本仓库的 `.quay/config.yml` 不入库（`.gitignore:578`），代码合并后例程不会自动在生产上运行，需要由人或 manager 在主检出的 live 配置里声明下面这一段。GOAL-909 达成后，再给 worker 增加一个以其落地提交为基线的子系统条目，用来评价扩展点模板：

```yaml
loop:
  design_evolution_readings:
    enabled: true
    subsystems:
      - name: serve
        baseline: 295e771b0
        central:
          - { at_baseline: packages/quay/src/serve-handlers.ts, at_head: packages/quay/src/serve/serve-handlers.ts }
        modules: ["packages/quay/src/serve/*.ts"]
      - name: worker
        baseline: 2440b52d0
        central: [plugin/scripts/worker-driver.ts, plugin/scripts/worker-fan-in.ts]
        modules: ["plugin/scripts/*worker*.ts", "plugin/scripts/*pool*.ts", "plugin/scripts/*dispatch*.ts", "plugin/scripts/*fan-in*.ts"]
```

间隔沿用 arch_cycle_report 的写法与缺省值。

## Touches

- tasks/gap-design-evolution-readings-report-only-routine.md
- plugin/scripts/design-evolution-readings.ts
- plugin/scripts/quality-gate-driver.ts
- plugin/test/design-evolution-readings.test.mjs
- plugin/test/quality-gate-driver.test.mjs
- docs/carrier-registry.json
- plugin/scripts/capability-catalog-declarations.json
- plugin/shipped-set-baseline.json
