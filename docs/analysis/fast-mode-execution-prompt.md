# 快速模式执行 Prompt

**用法：** 在 `/home/yale/work/quay` 启动一个新的 Claude Code 会话，把下面 `---` 之间的全部内容作为首条消息粘贴进去。

---

你在 `/home/yale/work/quay` 工作。按**快速模式**执行下列任务——不使用 `prepare-milestone` / `execute-milestone` workflow，直接实现。

## 为什么是快速模式

232 次真实 prepare-milestone dispatch 的遥测：成功率 6.9%，73.5 小时 wall-clock 只有 12.1 小时产出可用收据。两个散文审查阶段（ProposalReview + PlanCheck）占 55%，且 PlanCheck 93% 用满 3 轮、79% 失败——因为审查对象是散文，缺陷无界，收敛判据不可达。

对照 7 月 31 日：13 次内联对抗审查，全部收敛。差别只有一个——**审查对象是已写好的代码 + 真实测试输出，判据有界**。

依据 `adr/ADR-021-adaptive-budget-self-regulating-methodology.md` 和 `docs/analysis/prepare-pipeline-reduction-plan.md`。

## 执行纪律

每个任务按这个循环：

0. **遥测开始**（必做，见下方「遥测」节）：实现开始前先发 `--task-start` 事件，拿住打印的 `runId`
1. **读任务文件** `tasks/<id>.md` 的 `## Proposal` / `## Acceptance Criteria` / `## Touches`
2. **读真实代码**——不要从任务描述推断现状。任务体可能过时（下面「已知陷阱」有实例）
3. **实现**——先写测试（RED），再实现，再跑测试（GREEN）
4. **对抗审查**：实现完成后，用 `Agent` 起一个**独立的**审查子代理，让它**尝试反驳**你的实现（不是让它确认）。它必须自己跑测试、自己读代码，不能只读你的总结
5. **修**审查发现的真实问题，需要就再来一轮。收敛判据：审查者跑完测试后找不出真实缺陷
6. **同步镜像**（见下）
7. **跑测试**（见下）
8. **关闭任务状态**（见下）——用 `task-status-drift-check.ts` 检测器核对：实现已落地的任务若仍 `todo`/`ready` 会被标为 `status-drift-suspect`，逐个复核后关闭
9. **提交**
10. **遥测结束**（必做，见下方「遥测」节）：提交前发 `--task-end` 事件；可跑 `--report` 确认汇总落盘

## 遥测（必做，gap-fast-mode-no-telemetry 落地后生效）

每个快速模式任务必须为一次完整的任务执行发一对 stage event——这是 **1 任务/小时** 目标唯一的计量来源
（`prepare-milestone` / `execute-milestone` 两条 workflow 的 `_emitStageEvent` 在直接模式下不会触发）。

用 `fast-mode-telemetry.ts`（复用 A1a `workflow-event-schema.mjs`，不发明第二套格式）：

```bash
# 实现开始前：发出 start 事件，打印 runId（自己拿好）
RUN=$(node --no-warnings --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts \
  --task-start --taskId <id>)

# ... 实现 + 审查 + 修 + 同步镜像 + 跑测试 ...

# 实现完成、准备提交前：发出 end 事件
node --no-warnings --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts \
  --task-end --taskId <id> --runId "$RUN" --outcome done
```

- `outcome` 三选一：`done`（AC/DoD 全部证明）、`needs-human`（需要人工介入 / 真实 dispatch 验证）、
  `abandoned`（中途放弃、没有完成 commit）。
- 原始事件落在 `.workflow-events/`（gitignored）。`--report` 把汇总写到
  `milestones/fast-mode-telemetry/<date>.json`（提交保留）——这就是 1 小时目标对账用的持久化数据。
- 汇总：`node --no-warnings --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --report [--since <iso>] [--json]`

## 硬性约束

**镜像字节一致。** 这些成对文件必须 `cmp` 干净：

| 单一来源 | 镜像 |
|---|---|
| `experiments/quay-perpetual-stream/scripts/*.ts` | `plugin/scripts/*.ts` |
| `.claude/workflows/*.js` | `plugin/workflows/*.js` |
| `experiments/quay-perpetual-stream/test/*.test.mjs` | `plugin/test/*.test.mjs`（仅当该测试确实需要在 CI 跑） |

改完必用 `cmp -s A B && echo OK || echo DIFF` 验证。

**测试基线必须是绿的。** 批次 0（下面第一组任务）的目标就是把 `scripts/test.sh` 修到 **0 失败**。在那之前不要开始批次 1。

理由：非零基线让「我是否弄坏了什么」变成对一个移动目标做计数差分，新失败会藏在旧失败里。基线绿了之后，**任何**失败都是真信号。

批次 0 完成后，**任务内的测试验证**用下面的 `--for-task` 机械选择器（不再手挑文件、也不跑全量）；**全量套件保留给 fan-in**（merge 到 master 前）跑，期望值恒为 0。

**任务内测试步骤（`--for-task`，gap-test-selection-not-scoped-to-touches）。** 用机械选择器按任务的 `## Touches` 决定测试集，消除手挑文件的隐性判断：

```bash
scripts/test.sh --for-task <task-id>            # 只跑该任务 Touches 解析出的测试集
scripts/test.sh --for-task <task-id> --allow-thin  # 覆盖 <50% 时仍要跑（降级为警告）
node --experimental-strip-types plugin/scripts/select-tests-for-touches.ts --task <id> --json  # 查看选中集与 unresolved 明细
```

- 解析规则（最特定优先）：直接 `*.test.mjs` → basename 配对 `<dir>/foo.ts` → `*/test/foo.test.mjs` → 镜像折叠（`experiments/.../scripts/X.ts` ≡ `plugin/scripts/X.ts`）→ 任务体可选的 `## Test-Files` 声明 → 解析不到的 Touches 条目进 `unresolved`，**绝不静默丢弃**。
- 覆盖 <50% 会 fail-loud（exit 1，`test-selection-thin`）；确需放行用 `--allow-thin`（降级为 stderr 警告，exit 0）。
- 透传 flag（如 `--test-name-pattern=X`）要放在**文件列表之前**——node --test 只认文件前的 `--test-name-pattern`（放文件后被忽略，等于跑全文件）。
- **全量套件仍只属于 fan-in**：merge 前跑一次无参 `scripts/test.sh`。任务内用 `--for-task` 覆盖不了的部分（如 `docs/`、`scripts/test.sh` 自身）由 fan-in 兜底。

**测试文件放哪（gap-test-suite-has-no-layer-grouping）。** `scripts/test.sh` 的 glob 现在覆盖全部三个目录：`packages/*/test/*.test.mjs`、`plugin/test/*.test.mjs`、`experiments/quay-perpetual-stream/test/*.test.mjs`。`experiments/.../test/` 的 44 个此前不可见的测试**现在总会出现在输出里**。分组是**声明**不是位置：每个测试文件顶部一行 `// @test-group <name>`（`product` / `engine` / `governance`，缺省 `engine`）。`governance` 组（exp5 度量层）**封存而非删除**——默认跑 `product,engine`，governance 文件靠 in-file 自跳过报 `skipped` 而非缺席。`experiments/.../test/` 下指向 `plugin/test/` 的 12 个符号链接按 `realpath` 去重，不会跑两遍。若两处都放，注意 repo root 深度不同（`plugin/test/` 是 2 层，`experiments/.../test/` 是 3 层）——用向上查找标记目录的方式求根，别硬编码层数。

**关闭任务状态。** 这是当前流程的真实缺口：直接执行时没有任何机制更新任务状态，我刚发现 7 个任务的代码已在树里但 status 仍是 `todo`。实现完成后，先跑检测器核对，再手动改 `tasks/<id>.md` 的 `status:`：

```bash
node --experimental-strip-types plugin/scripts/task-status-drift-check.ts   # 报告 status-drift-suspect 供人工复核
```

- 全部 AC 已由测试证明 → `done`
- 代码完成但某条 AC 要求「真实 dispatch 验证」→ `ready`（不是 `done`）

## 已知陷阱

**任务体可能与代码不符。** 实例：`gap-planauthor-shape-rules-not-injected` 原本写「stage 格式没注入 PlanAuthor」——读代码发现格式**早就注入了**，真正缺的是另外两个约束。任务描述被修正后实现才正确。**先读代码，发现不符就先修任务体，再实现。**

**不要为了让测试通过而放宽断言。** 若已有测试与你的改动冲突，判断哪个是对的：若测试编码的是你正在改变的旧行为，改测试并在 commit message 说明；若测试是对的，改你的实现。

## 任务清单（严格按此顺序）

### 批次 0 — 先把项目搞干净（必须全部完成后才进批次 1）

**0.1 `gap-green-test-baseline`** ⭐ 最先做

`scripts/test.sh` 18 个失败 / 8 个根因，其中至少 4 组是**真实缺陷**：

| 根因 | 失败数 | 是否真缺陷 |
|---|---|---|
| `tsc --noEmit` 2 个类型错误（`gate/config/loader.ts:178`、`mcp-handlers.ts:673`） | 3 | **是——产品类型错误** |
| gate loader 新增 `srcFile` 字段，3 个 deepEqual 测试未更新 | 3 | 测试滞后 |
| 诊断严重度 WARNING→ERROR，且**实现自相矛盾**（header 印 `(2 warnings)`，body 印 `ERROR:`） | 2 | **是——输出自相矛盾** |
| `plugin/scripts/tree-hygiene-check.sh` 泄漏 `experiments/quay-perpetual-stream` 路径 | 2 | **是——破坏 plugin 可移植性** |
| `sync-vendor.sh --check` 非零退出 | 1 | 可能与上同源 |
| execute-milestone golden replay「phase sequence must be unchanged」 | 4 | **是——防漂移哨兵正在报警** |
| `adr list --applies-to` | 2 | 待诊断 |
| `prepare-milestone-size-estimate` | 1 | 待诊断 |

最后一组之外，第 6 组尤其要重视：**golden replay 测试存在的唯一目的就是在 phase 序列被无意改动时失败。它正在失败。**把它当背景噪音就等于废掉这个机制。

任务体已列出修复顺序和 12 条 AC。对每个根因：判断是**实现**还是**测试**编码了正确契约，修那一边，并在 commit message 说明这个判断。**绝不为了变绿而放宽断言。**

**0.2 `gap-task-status-closeout-not-mechanized`**

直接执行模式没有任务状态关闭步骤——已实测 7 个任务代码在树里但 status 仍是 `todo`（详见任务体表格）。后果：任务板谎报完成情况，调度读的就是这块板，已完成的任务可能被再次选中、准备、派发。

做一个**检测器**（不是门禁）：`task-status-drift-check.ts`，扫描 todo/ready 任务，若其 AC 中声明的符号已在代码中出现且 Touches 文件全部存在，则报告 `status-drift-suspect` 供人工复核。永远退出 0，永远不写 `tasks/**`——`done` 还是 `ready` 取决于 AC 是否要求真实 dispatch，脚本判断不了。

任务体明确说明了「不做阻塞门禁」的理由（假阳性必然存在，模糊信号上的硬门禁比它防的泄漏更糟）。

**0.3 全量核对任务体与代码**

跑 0.2 的检测器，复核输出。对每个 suspect：读代码确认，然后改 `status`（`done` 或 `ready`）。

同时注意反向漂移——任务体描述与代码矛盾。已确认实例：`gap-planauthor-shape-rules-not-injected` 原本断言「stage 格式没注入 PlanAuthor」，读代码发现**早就注入了**（1482-1489 行），真正缺的是另外两个约束。发现此类矛盾时：**先修任务体，再实现**。

---

### 批次 1 — 机制修复（批次 0 全绿后才开始）

**1.1 `gap-extract-mechanism-claims-calibration`** ⭐

`extractMechanismClaims`（`experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts`）是收缩后 prepare 仅存三项机械确认之一的基础，当前**两个方向都错**。我已实测：

| 任务 | 真实机制数 | 提取数 | 偏差 |
|---|---|---|---|
| DIR-124-A1b | 1 | **24** | 过计 24× |
| DIR-124-A4 | 1 | **18** | 过计 18× |
| DIR-126-D | 1 | **21** | 过计 21× |
| DIR-124-A | 5 | **22** | 过计 4.4× |
| DIR-124-B | 4 | **2** | **欠计——真该拆的没拆** |

复现脚本（直接可跑）：

```js
const R = "/home/yale/work/quay";
const { extractMechanismClaims } = await import(`${R}/experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts`);
const { extractSection } = await import(`${R}/experiments/quay-perpetual-stream/scripts/task-schema.ts`);
// 对 tasks/<id>.md 取 ## Proposal，喂给 extractMechanismClaims，数长度
```

注意函数里已有一个 `_patternKey` 的 RC1 合并逻辑（别的会话加的），**它不够**——上表就是加了它之后的结果。欠计的 DIR-124-B 尤其要小心：修过计时不要把真正独立的机制也合并掉。

任务体的 AC 已列出这 5 个校准目标。上表的实测数字请写进任务体作为 grounded fact。

**1.2 `DIR-124-F-plancheck`**

PlanCheck 输出 schema 从标量 `{findings: number}` 扩展为带 `classification` 的类型化数组。这是让 `planCheckNextAction` 的 blocking-only 判据发挥全部效力的前提——当前走标量回退路径。

相关代码已落地：`proposal-convergence.ts` 的 `planCheckNextAction`，`.claude/workflows/prepare-milestone.js` 的 `_planCheckNextActionInline` 和 PlanCheck 循环（agent schema 已含 `blocking` 字段）。你要做的是让 `classification` 也类型化，并让它流到收据。

**1.3 `DIR-124-A1b`**

1 个机制：在 8 个阶段边界发射 stage event。A1a（`workflow-event-schema.mjs`）已完成，直接引用。任务体已重分类并补了 10 条 AC。

**1.4 `DIR-124-A4`**

1 个机制：`workflow-metadata-conformance.mjs` 一致性检查脚本 + DoD clause 13。任务体已补 11 条 AC。注意它的 8 个 WIRING-CLAIM 是同一脚本的实现细节，不是 8 个机制。

**1.5 `DIR-124-B1`**

RunIdentity 铸造。8 AC / 235 行。DIR-124-B 的 4 路拆分是正确拆分，B1 无依赖可直接做。

**1.6 `gap-build-evidence-manifest-missing`**（status 已是 `ready`）

余下 2 个机制（per-phase 证据消费、git 失败 fail-soft）。机制 1（输出路径）已在 `2b1d67c2` 提交。

## 提交

每个任务独立提交。commit message 说明：改了什么机制、测试证据、镜像已同步、任务状态改成了什么。不要把多个任务挤进一个 commit。

## 开始前

先跑一次 `scripts/test.sh`，确认失败数是 18（若不是，说明树已变动，先搞清为什么）。
然后从 **0.1** 开始。

**批次 0 未全绿之前不要进批次 1。** 这不是流程洁癖——非零基线下你无法判断自己是否引入了回归，而批次 1 要改的正是决定拆分与收敛的核心机制，最需要可靠信号。

---

## 附：本批任务的上下文来源

| 文档 | 内容 |
|---|---|
| `adr/ADR-021-adaptive-budget-self-regulating-methodology.md` | 四项原则：元机制更简单、Phase 0 优先、数据校准、按代码路由 |
| `docs/analysis/prepare-pipeline-reduction-plan.md` | 收缩方案、量化依据、任务调整 |
| `docs/analysis/prepare-pipeline-cost-and-split-containment.md` | 232 条遥测的成本分解 |
| `docs/analysis/split-correctness-review.md` | 9 次拆分只有 2 次正确的逐任务分析 |
| commit `4f8495a7` | 已落地的 5 项机制（递归守卫、拆分终局性、blocking-only、收益递减、约束注入） |
| commit `5f20d228` | 遥测归档 + 任务调整 |
