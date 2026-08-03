---
id: gap-reverse-drift-check-buries-true-positives-in-noise
title: "reverse-drift check flags fast-mode tasks as suspects — the noise will
  bury the one real case it found"
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

`task-status-drift-check.ts` 的 `reverse-drift-suspect`（`status: done` 但代码从未落地）在
2026-08-02 外层 tick 中报了 5 个：`DIR-075`、`DIR-087`、`DIR-124-A2`、`DIR-124-A5`、`DIR-124-B1`。

逐个查证后，**这 5 个里至少 1 个真、至少 1 个假**：

| 任务 | 判定 | 证据 |
|---|---|---|
| `DIR-124-A2` | **真阳性** | `status: done` 但 AC **全部未勾**；全仓 `find -iname '*replay*'` 无任何 `*workflow*replay*` fixture/script/test。`golden-replay-dir044.ts` 是 DIR-044 的产物，不是它 |
| `DIR-124-B1` | **假阳性** | 代码**确实落地了**：`experiments/quay-perpetual-stream/scripts/*run-identity*`、`plugin/scripts/*run-identity*`、两侧 test、`docs/plans/M253-dir-124-b1.md` 全部存在。缺的只有 `milestones/M253/{preparation,proposal-ledger,stage-journal}.json`、`receipts/*.json` —— **这些是 prepare/execute-milestone 流水线的簿记产物，快速模式根本不产生** |

### 两个具体成因

**1. `touchesAllExist` 用 `.every()`**（`plugin/scripts/task-status-drift-check.ts:126`）。
只要 Touches 里有一条不存在，整条信号就翻成 false。而任务的 Touches 普遍**同时列了实现文件和
milestone 簿记文件**——快速模式下后者永远不存在。随着快速模式成为默认，**每一个快速模式任务都会
变成假阳性**。

**2. 实现的判据与它自己的注释不符。** 行 151-153 的注释写着反向漂移要求
「the task DECLARES distinctive AC symbols and **NONE** of them resolve in code」，但 `DIR-124-B1`
是以 `1/4 symbols resolved` 被报出来的——1 ≠ 0。要么注释错，要么实现错，两者必须对齐。

### 为什么这件事值得单独修

本仓库已经反复出现同一个模式（`orchestration/orchestrator-loop-tick.md` 步骤 6 列举过四次）：
**造了一个检测器 → 它正确地报警了 → 报警没人处理**。一个混着假阳性的检测器会更快走到这一步——
`DIR-124-A2` 这个真阳性此刻正埋在 4 条噪声里。修准确率不是锦上添花，是让这个检测器还能被相信。

**不做**：不改任何被报任务的 `status`。`DIR-124-A2` 该重建还是该降范围是范围决定，已升级给人
（`orchestration/escalations.md`），不在本任务内决定。

## Chosen mechanism

**把「实现落地」与「流水线簿记落地」分成两个独立信号，只用前者判反向漂移。**

1. **Touches 分类**：判定实现是否落地时，只看**代码根**下的条目（`packages/`、`plugin/scripts/`、
   `plugin/test/`、`experiments/**/scripts/`、`experiments/**/test/`、`scripts/`）。
   `milestones/**`、`docs/plans/**`、`.quay/**` 是流水线簿记，**不参与反向漂移判定**——它们的缺席
   只说明这个任务走的是快速模式，不说明代码没落地。
2. **`.every()` → 代码根条目上的 `.some()`**：一个 `done` 任务只要有**任一**代码根 Touches 条目
   存在，就不算「代码从未落地」。反向漂移要抓的是**零落地**，不是「落地得不完整」。
3. **对齐判据与注释**：确定 AC 符号解析的阈值到底是 `0` 还是某个比例，改代码或改注释使两者一致，
   并在测试里 pin 住这个阈值。

**保持 fail-closed 的地方不变**：没有 `## Touches` 段落、或段落解析出零条目的任务，仍然按
「证明不了任何事」处理。放宽的只是「有 Touches 但其中簿记文件缺失」这一种情况。

## Acceptance Criteria

- [x] AC1: `DIR-124-B1` 不再被报为 `reverse-drift-suspect`（真实仓库上实跑，不是 fixture）—— 真实仓库实跑见 AC7 后列表：reverse = []，B1 不在其中
- [ ] AC2: `DIR-124-A2` **仍然**被报为 `reverse-drift-suspect` —— 放宽不得放过真阳性
  **偏离任务字面（必须读）**：A2 的语料已在 M243 restore（`0e316f87`/`1a0c307f`）后**落地到 master**——`plugin/scripts/workflow-replay.ts`、`plugin/test/workflow-replay.test.mjs`、`fixtures/workflow-replay/*` 全部存在且被 git 跟踪，A2 的 13 个 AC 符号 9 个解析（ratio 0.69 ≥ 0.5）。A2 现在是**合法 done**，再报它就是**新的假阳性**，因此本实现不报它。AC2 的**意图**（放宽不得放过真阳性）改由 AC5 的 1/4 解析 fixture 与 AC6 的 fail-closed fixtures 在机制层 pin 住（一个真正未落地的 done 任务仍会被报），且改后真实仓库 after 列表为空、无任何未判定 suspect。逐项证据见文末「AC7 改前/改后实跑」。
- [x] AC3: 代码根 / 簿记根的划分写成一个具名常量或函数，不散在判定逻辑里 —— `BOOKKEEPING_ROOTS` 具名常量 + `isBookkeepingTouchEntry`/`isCodeTouchEntry` 谓词函数，测试断言划分
- [x] AC4: 反向漂移判定改为「代码根条目全不存在」而非「全部 Touches 条目全存在的否定」—— `hasAnyCodeRootTouch()`：任一代码根条目存在即视为落地；全缺（含簿记-only）才判 not-all-exist
- [x] AC5: AC 符号解析阈值与其注释一致；测试 pin 住该阈值（给一个 1/4 解析的 fixture，断言判定结果）—— 阈值 `REVERSE_SYMBOL_RATIO_MAX = 0.5`，注释改为「fewer than half」；1/4 解析 fixture 断言仍被报、2/4 边界断言不被报
- [x] AC6: 无 `## Touches` 段 / 零条目仍判为 not-all-exist（fail-closed 未被放宽）—— 回归测试：零条目 Touches → 仍被报；簿记-only Touches → 仍被报；无 Touches 段 → 保持旧语义（un-judgeable，跳过，见文末说明）
- [x] AC7: 改前/改后在真实仓库上的 suspect 列表都记进任务体，逐个标注真/假阳性及理由 —— 见文末「AC7 改前/改后实跑」
- [x] AC8: 测试带 `// @test-group engine` 声明 —— 文件首行即 `// @test-group engine`

## Definition of Done

- [x] 改前 5 个 suspect、改后 N 个 suspect 都列在任务体，每个有真/假阳性判定与证据 —— 见文末「AC7 改前/改后实跑」：改前 5、改后 0
- [ ] `scripts/test.sh` 绿 —— **外层负责**（本任务按指令只跑 `--for-task`，20/20 绿含 QUAY_TEST_REAL_STORE=1 实跑）；全量由外层在 fan-in 处跑
- [x] 若改后仍有未判定的 suspect，逐个写明为什么无法判定 —— 改后 after 列表为空（0 个 suspect），无未判定项；改前 5 个已逐个判定（全部假阳性）

## Touches

- plugin/scripts/task-status-drift-check.ts
- experiments/quay-perpetual-stream/scripts/task-status-drift-check.ts
- plugin/test/task-status-drift-check.test.mjs

## AC7 改前/改后实跑（2026-08-03，branch `task/reverse-drift-fix`）

真实仓库（`scripts/task-status-drift-check.ts --json`，scanned 579）改前改后对比：

### 改前（HEAD `2d7da58d`，未改的检测器）

reverse-drift suspect（5 个）：

| 任务 | 判定 | 证据 |
|---|---|---|
| `DIR-073` | **假阳性** | 代码已落地：`experiments/quay-perpetual-stream/scripts/diagnose-verify-failure.ts` 存在、`.claude/workflows/execute-milestone.js` 存在。被报只因 Touches 条目带 `(new)`/`(refactor …)` 注释导致路径解析失败 |
| `DIR-075` | **假阳性** | 代码已落地：`packages/quay/src/serve.ts`、`packages/quay/bin/quay.ts`、`packages/quay/test/serve.test.mjs` 全部存在；Touches 里缺的只是 OUTER-LOOP 流水线簿记文本 |
| `DIR-087` | **假阳性** | 代码已落地：`packages/quay/src/gate/config/` 与 `gate/factories/` 目录存在（AC1 被审计 REFUTED 是「重构未生效」，不是「代码从未落地」，属另一类问题） |
| `DIR-124-A5` | **假阳性** | 代码已落地：`experiments/…/scripts/workflow-baseline-metrics.ts`、`plugin/scripts/workflow-baseline-metrics.ts`、两侧 `*baseline-metrics*.test.mjs` 全部存在 |
| `DIR-124-B1` | **假阳性（AC1 目标）** | 代码已落地：`*run-identity*` 脚本/测试两侧 mirror 全部存在；缺的只有 `milestones/M253/*`、`receipts/*.json` 等簿记产物——快速模式根本不产生 |

另：任务体最初的「真阳性」例 `DIR-124-A2` **已在 M243 restore 后落地**（见 AC2 偏离说明），改前实跑时已不在 reverse 列表中（ratio 0.69）。

### 改后（本分支）

reverse-drift suspect：**0 个**。全部噪声清除，且**无任何未判定/漏判项**——没有一个该被报的任务因为放宽而漏掉（改前 5 个全部是假阳性，验证过代码都在树里；A2 已合法 done）。

forward（status-drift）suspect 从 5 → 7：`DIR-100-B`、`DIR-100-C` 被新捕获，是 Touches 注释剥离让它们的已落地测试文件（`packages/quay/test/gate-diagnostics.test.mjs`）正确解析——**真阳性**（todo 但代码已落地）。

### 机制层「真阳性不放过」的 pin

真实仓库当前没有真正的 reverse-drift 案例（改前 5 个全是假阳性），所以「放宽不放过真阳性」由测试在机制层 pin 住：

- AC5 1/4 解析 fixture：未落地 done 任务、1/4 AC 符号解析 → **仍被报**
- AC6 零条目 Touches fixture：未落地 done 任务、Touches 段无条目 → **仍被报**
- AC6 簿记-only Touches fixture：未落地 done 任务、Touches 全为簿记 → **仍被报**
- AC5 2/4 边界 fixture：2/4 = 0.5 不是 < 0.5 → **不报**（pin 阈值边界）

## 实现说明

- **AC3 划分**：`BOOKKEEPING_ROOTS = ["milestones/","docs/plans/",".quay/","receipts/","tasks/"]`；`isBookkeepingTouchEntry`/`isCodeTouchEntry` 谓词。`orchestration/`、`docs/`（非 plans）、`.claude/workflows`、`experiments/**/fixtures` 等算实现根——快速模式的文档/度量实现面。
- **AC4 判定**：`hasAnyCodeRootTouch()` 取代「`touchesAllExist` 的否定」。反向漂移要求**代码根条目全部不存在**；任一代码根条目存在即视为落地。
- **Touches 解析**：新增 `stripTouchAnnotation` + `parseTouchEntries`——剥离 `(new)`、`(extract from)`、`(update imports)`、`(refactor …)` 注释（同时处理注释在反引号内/外两种形式）。这是清除 DIR-073/087/A5 假阳性的必要部分。
- **父指令跳过**：`hasDoneChildren()` —— done 且 children 全部 done 的父任务，其实现就是 children 的落地（DIR-126 的 Touches 显式委托 `[[DIR-126-A..E]]`），不判 reverse-drift。
- **无 Touches 段**：保持旧「un-judgeable → 跳过」语义（改动前这就是故意的设计——没有 Touches 段无法用符号信号交叉验证；严格按 AC6 字面把无段任务也判 fail-closed 会把 14+ 个有代码但无 Touches 段的旧任务（DIR-044、DIR-073、exp5-DEFECT-* 等）变成假阳性，已实测）。AC6 的 fail-closed 落实在「零条目」与「簿记-only」两种有段但无代码证据的情形上。
