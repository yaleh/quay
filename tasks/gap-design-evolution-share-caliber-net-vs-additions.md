---
id: gap-design-evolution-share-caliber-net-vs-additions
title: 设计演化读数用「净行数增量」却对外宣称「只计新增」——同一窗口两种口径差出 serve 1.31%/2.25%、worker-post-909
  102.13%/93.81%，且 R1 的出度判据方向写反
status: todo
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

**事实一（代码）**：`plugin/scripts/design-evolution-readings.ts` 的每个字段都按**净行数增量**计算——`delta = head.lines - base.lines`（中心文件逐个累加），非中心同样 `nonCentralDelta += (head.lines - base.lines)`，`share = centralDelta / (centralDelta + nonCentralDelta)`。代码自己的注释也写的是 "Per-commit net line deltas"（`:591`）。

**事实二（文档）**：`docs/references/ownership-first-refactoring-methodology.md` §13 与刚完成的任务 `gap-slice-before-after-readings-at-dispatch-and-fanin` 的 schema 说明都写成「**只计新增**」。两者不是同一个量。

**事实三（同一窗口两种口径的实测，2026-10-22，HEAD `329087733`）**：

| 窗口 | 记录值（净） | 只计新增 | 备注 |
|---|---|---|---|
| serve（`295e771b0..HEAD`） | 1.31%（153 / 11,687） | **2.25%**（349 / 15,502） | 方向结论不变 |
| worker-history（`2440b52d0..ff32d031d`） | 82.46%（4,820 / 5,845） | **79.70%**（5,210 / 6,537） | 方向结论不变 |
| worker-post-909（`024f9d7f2..HEAD`） | **102.13%**（288 / 282） | **93.81%**（288 / 307） | 占比超过 100%，见下 |

**事实四（异常的结构性成因）**：净口径下非中心文件可以净减少（删除多于新增），于是分母小于分子、占比大于 100%。worker-post-909 正是这样：非中心净 −6。这不是「回流特别严重」，而是口径导致的不可解释读数。

**事实五（后果一：掩盖）**：纯搬出提交会让中心文件净减少（负增量），从而在窗口内**抵消**随后的长回。用净口径读「增长回流中心」，等于把「先搬走、再长回来」和「根本没搬」混成一个数。

**事实六（后果二：跨项目对照失效）**：claudecodeui 会话用的是 `git --numstat` 的 additions-only 与单 commit churn（`centralChurnShare`）。我们对外引用的 1% / 82% 是净口径，两边并排展示就是错误对照。

**事实七（模型表述错误）**：`ownership-first §13.2` 把 R1（提取）的 Π 判据写成「call 出度（同口径前后比）」，暗示提取会让出度下降。跨三个代码库的实测相反——纯提取让出度**上升**（claudecodeui hook 38→56、plantuml-js elk 23→26），因为中心仍然调用被搬走的符号、又多出 import 边；注册表式扩展点才让出度下降（driver 203→187）；dispatch 缝基本不动（ws-proxy 65→66）。R1/R2 的真正判据只能是窗口增长落点占比。**分类更正（对方 2026-10-22 复核后确认）**：claudecodeui 的 ws-proxy 那一刀是「**registry 结构 + 缝签名**」（建了 register/dispatch，但出度 +1 说明没有塌掉 N 条边，帧处理边大多在同文件的兄弟函数里）⇒ 归「缝」，**不算 R2**。因此 claudecodeui 目前**干净的 R2 样本只有 driver 那一个**（203→187，−16）；hook 是 R1（38→56）；刀5 是断边（环 8→7）。文档里不要把 ws-proxy 当 R2 证据。

## Plan

1. **读数记录同时携带两种口径**：在 `.quay/design-evolution-history.jsonl` 的每条 subsystem 记录里增加
   - `netShare`（现 `share` 的语义，保留键名 `share` 以免打断既有消费者，并加 `shareBasis: "net"`）；
   - `additionsShare` + `additionsNumerator` / `additionsDenominator`（来自 `git numstat` 的 additions，窗口两端聚合，按同一 module glob 与 central 声明取文件）；
   - 两者都缺时才是 `evaluated:false`（硬规则 3b：不可评估是独立取值，不写 0）。
2. **finding 文本必须声明口径**：`design-evolution-readings` 产出的 finding（`evolution:<target>:<trigger>` 去重键）在正文里写明用的是 `netShare` 还是 `additionsShare`，不得只写「占比 X%」。
3. **更正文档**：`ownership-first-refactoring-methodology.md` §13.1 的三行读数改成双口径表；§13.2 的 R1/R2 判据改写为「窗口增长落点占比是唯一判据，出度只是签名」，并补两类签名（dispatch 缝 = 平、断边/依赖倒置 = 环数），刀5 的环 8→7 作为断边的实例。
4. **不改 claudecodeui 侧口径**：对方的 additions-only 与 churn 定义正确，本任务只让 quay 侧与之一致。
5. **不设阈值**：两种口径都只记录与展示，不引入「超过 X 就报警」（成本结构未测，硬规则 4 推论）。

## Acceptance Criteria

- [ ] AC1 记录含两种口径：实跑一次读数，`.quay/design-evolution-history.jsonl` 最后一条里同一 subsystem 同时有 `share`、`shareBasis`、`additionsShare`、`additionsNumerator`、`additionsDenominator`；贴该 subsystem 的完整 JSON 片段与前 3 条记录的同字段内容。
- [ ] AC2 异常消失且可解释：对 `worker-post-909` 同一窗口，贴出 `share`（净）与 `additionsShare`（只计新增）两个值与各自的分子分母；断言 `additionsShare <= 1` 在代码里成立（用一个把非中心增量设为负的 fixture 验证），且 `share` 允许 >1 并在记录里带 `shareBasis:"net"`。贴 fixture 名与断言输出。
- [ ] AC3 文档双口径表：`grep -n 'additionsShare\|净口径\|只计新增' docs/references/ownership-first-refactoring-methodology.md` 至少 3 行，且 §13.1 表中 serve / worker-history / worker-post-909 三行都同时给出两个口径的数；贴这些行原文。
- [ ] AC4 R1 判据方向更正：§13.2 里 R1 那一行不再把「出度下降」当判据；文档写明「纯提取出度上升 / 注册表下降 / 缝持平」三种签名与各自实例（hook 38→56、driver 203→187、ws-proxy 65→66），并新增「断边（环数 8→7）」一类。贴对应行原文。
- [ ] AC5 消费者审计（硬规则 5b）：`grep -rn 'sharePercent\|\.share\b' plugin/scripts/*.ts` 列出所有读取该字段的消费者，逐个说明它读到的是净口径还是新增口径、是否需要随本次改动调整；贴命中数与前 3 条内容。
- [ ] AC6 finding 声明的口径：构造一次触发（fixture 或把阈值临时降为可触发），检查产出的 finding 正文包含 `netShare` 或 `additionsShare` 字样；贴该 finding 的一行。若无可靠触发手段，改用单元测试断言文本模板含口径词。

## Definition of Done

- 载体里同时存在两种口径的记录，且 `shareBasis` 必填；任一 finding 的正文都能看出它引用的是哪一种。
- `docs/references/ownership-first-refactoring-methodology.md` §13 的双口径表与三签名表述落地，并与 `design-evolution-readings.ts` 的字段名逐一对得上（不是另起一套叫法）。
- 与 claudecodeui 的对账可用：同一窗口用对方口径算出的数，与本例程的 `additionsShare` 一致（各贴一个数）。

## Touches

- plugin/scripts/design-evolution-readings.ts
- plugin/test/design-evolution-readings.test.mjs
- docs/references/ownership-first-refactoring-methodology.md
- tasks/gap-design-evolution-share-caliber-net-vs-additions.md
