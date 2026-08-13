---
id: gap-value-priority-signal-degraded-to-1-over-cost
title: value 优先级信号退化成 1/touches——三实质轴（strategic/blocking/suite-blocking）0/9 全
  N，value=1/cost，大任务结构性垫底（试点永浮不上来）；复合指标静默退化同族
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**value 优先级信号退化成 `1/touches 数`——判别性输入在全体上取常值时，复合指标静默退化成剩下那一项，输出看起来完全正常（与 runner 恒 outer / node_comm_literal 恒零 / kind 零决策消费者同族）。**

**实测（manager 2026-08-13，`ready-pool-check --top 40`）**：9 个 todo 候选，全体 reason `value 0.333 · strategic N · blocking N · suite-blocking N · cost 3 touches`。三个实质轴（strategic/blocking/suite-blocking）取 Y 的条数 = **0 / 9（全 N）**。value 序列 `0.333 0.333 0.25 0.2 0.167 0.091 0 0` = **恰好 `1/3, 1/4, 1/5, 1/6, 1/11`** ⇒ `value` 现在就是 `1 / touches 数`。

**自洽的、带理由的、错的排序**：这不是报错——复合分退化成仅剩的成本项，输出结构完整、数字合理。**最难看的后果：任务越大排得越后**。试点（spec-11，大 touches）在这套排序里**结构上永远浮不上来**——而它恰是本阶段唯一能解锁「停全局轮」的那一件。

**前身**：`gap-value-prioritization-has-no-mechanism` 已 done（AC1-4 全勾），其 AC4 逐字「不削弱现有机制——gap>DIR 顺序保留」⇒ relevance 信号当初【被刻意隔离在晋升切线之外】。所以：机制建好了但有意不接切线；而现在即使接进去也没用，因为**它退化了**。

## Plan

1. 诊断 value 信号的三个轴为何全 N（strategic traceability 引用、blocking parent/children、suite-blocking）——在全体 todo 上取常值 = 信号源无判别力，还是取数 bug。
2. 修复：让 value 有真实判别输入（三个轴真正能取 Y），或改用别的可判别信号；value ≠ 1/cost。
3. 验证：`--top N` 下 value 序列非 1/cost 退化；大任务不再结构上垫底。
4. 与 `gap-priority-has-no-mechanism-reader`（排序读不读 label）是**两个独立缺陷**，分开处置。

## AC

- [x] AC1: value 信号不再是 `1/touches` 退化——三个实质轴（strategic/blocking/suite-blocking）在 todo 群上能取到 Y（非 0/9 全 N）
- [x] AC2: 大 touches 任务（如试点）不再结构性垫底——`--top N` 排序中可浮现
- [x] AC3: 复合指标可判别（不退化）——输入有判别力，输出非恒序
- [x] AC4: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [x] AC1–AC4 全部勾上
- [x] 修前（9/9 全 N、value=1/cost）vs 修后（轴可取 Y、value 非退化）对照贴出
- [ ] 全量套件绿（fan-in 后由全量套件门验证——scoped 门已绿）

## Touches

- plugin/scripts/ready-pool-check.ts（value 信号判别力）
- plugin/test/ready-pool-check.test.mjs（value 退化回归用例）
- tasks/gap-value-priority-signal-degraded-to-1-over-cost.md（自身）

## Closure（2026-08-13，worktree 实现）

**根因（两个取数 bug + 一个结构性阴性）**：
1. **strategic 取数 bug**：`STRATEGIC_REF_RE = /FINDING-|SYNTHESIS-|SPEC-|REVIEW-cadence/` 要求 `SPEC` 后紧跟连字符。试点任务实际引用形式是 `SPEC §11 阶段 2`（空格+节号），不匹配 `SPEC-` ⇒ 本阶段唯一战略优先级的试点读 strategic N。修：改为词边界匹配 `/\b(?:SPEC|FINDING|SYNTHESIS)\b|REVIEW-cadence/`，同时命中 `SPEC §11`（空格+节）与 `SPEC-per-task-suite-verification-2026-08-13.md`（连字符文件名）；仍区分大小写。
2. **blocking 取数 gap**：blocking 轴只读 `parent`/`children`，不读 `depends_on` 反向边——一个被其他任务 `depends_on` 的任务同样「落地即解锁依赖者」。修：`computeRelevance` 新增 `dependedOnCount`（每任务 `depends_on` 的反向索引），>0 即 flip blocking true。
3. **suite-blocking**：套件绿（0 连续红）时结构性地为 N——这是 AC4 阴性对照的正确行为，非 bug；红窗时已由既有测试证明可取 Y。

**修前 vs 修后对照（同一 worktree 实测，`ready-pool-check --top 100`）**：
- 试点 `gap-spec-11-stage-2-per-task-full-suite-pilot`：修前 `value 0.333 · strategic N · blocking N`（ready_relevance 第 7 位）→ 修后 `value 4.333 · strategic Y`（ready_relevance 第 2 位，仅次于既有 strategic+blocking 的 cold-start 任务）。大任务不再结构性垫底（AC2）。
- `gap-ac51-assertion-surface-split`：修前 `value 0.25 · strategic N` → 修后 `value 4.25 · strategic Y`。
- 三轴回归用例（`plugin/test/ready-pool-check.test.mjs` `value-degradation` 组）：strategic 取 `SPEC §11` 形式取 Y、blocking 经 `depends_on` 反向边取 Y、大 touches 战略任务在 `--top` 排序中浮到 plain 小任务之上（value 序列非单调 1/cost）。

**scoped 门**：`scripts/test.sh --for-task gap-value-priority-signal-degraded-to-1-over-cost --allow-thin` 绿（scoped 静态检查全 PASS；95/95 测试通过，含 3 条新增 value-degradation 回归）。