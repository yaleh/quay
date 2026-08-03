---
id: gap-quantified-stop-conditions-have-no-scope
title: "A stop condition that says >=3 without naming its set and window
  deadlocked dispatch — check every quantified threshold in the driver docs"
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

2026-08-03 内层停止派发，理由是 `needs-human 积压 ≥ 3`。实际情况：那 7 个任务全部是历史遗留
（最后改动 07-29 至 08-02 05:54，**全部早于窗口起点 ≥12 小时**），窗口内新增为 **0**。

**这句话的意图**是「内层产出 needs-human 的速度超过消解速度，该停」；
**它被读成**「仓库里 needs-human 的总数，有史以来」。
按后者，**7 个历史任务永久卡死派发——因为解开它们需要派发**。

缺的不是执行者，是**范围**：`≥ 3` 没说**哪个集合**、**什么窗口**。

### 这不是孤例

`docs/analysis/normative-prose-audit.md` 对内层 tick 文档 49 条规范性语句逐条判定：
**36 条决策性语句，落地时只有 7 条有真执行者**。而带量词的停止条件是其中**歧义代价最高**的一类——
一条就卡死了派发，且症状是「系统看起来在正常等待」，不会自己暴露。

### 为什么只查这一类，不查全部

审计明确否掉了通用检查：36 条里 **1 条有意不机械化**（ADR-021 明示，覆盖判断边界表整块）、
**3 条本质不可机械化**（思维纪律，今晚由其中一条挡住过一次掩盖式修复）。
通用检查会对它们持续报假警，**而一个持续报假警的检查会被忽略**——正是
`docs/analysis/instrument-failure-mode.md` 记录的失效模式。

这两类现已在文档里用 `<!-- unmechanized: -->` / `<!-- unmechanizable: -->` 显式标记
（2026-08-03 外层直接编辑），**本检查必须跳过被标记的段落**——标记的存在就是为了让范围可判定。

## Contract

```
measure  unscoped_count = `node plugin/scripts/threshold-scope-check.ts --json` 输出的 violations 字段长度
measure  marked_count   = `node plugin/scripts/threshold-scope-check.ts --json` 输出的 skippedByMarker 字段长度
band     ceiling = 0 新增                                          # 与 contract-violations 同款 shrink-only
invariant 被扫描的文档集合在改前后一致                                # 变了则计数不可比
invoke   `node plugin/scripts/threshold-scope-check.ts --json`
control  `needs-human ≥ 3`（无集合无窗口）必须报出，`窗口内新增 needs-human ≥ 3` 必须不报——双向
resume   每扫完一个文档即写盘                                        # 文档数少，但保持一致
```

## Chosen mechanism

**只查一类：带量词的停止/触发条件。判据是「有没有说清集合与窗口」。**

### 扫描对象

`docs/analysis/fast-mode-loop-tick.md`、`orchestration/orchestrator-loop-tick.md`、`CLAUDE.md`。
**不扫 `tasks/`**——那是 `task-contract-check.ts` 的地盘，两者共用判定但对象不同
（Contract 管任务体的阈值，本检查管驱动文档的阈值）。

### 判定

一行如果含**量词模式**（`≥N` / `>= N` / `超过 N` / `N 次以上` / `N 分钟`），必须同时满足：

| 要求 | 反例（今晚的） | 正例 |
|---|---|---|
| 说明**集合** | `needs-human 积压 ≥ 3` | `needs-human ≥ 3` **的哪些**：窗口内新增的 |
| 说明**窗口** | 同上——没有窗口即默认「有史以来」 | `窗口内新增` |

**跳过**被 `<!-- unmechanized: -->` 或 `<!-- unmechanizable: -->` 标记的段落。

### 报出而不阻断

违规名单是数据文件 `docs/analysis/threshold-scope-violations.md`，**只能变短**——
与 `contract-violations.md`、`test-framework-policy-exemptions.txt` 同款棘轮。

**不做**：不检查阈值的**取值是否合理**（3 该不该是 3 是判断，不是格式）；
不扫 `tasks/`；不阻断任何流程。

## Acceptance Criteria

- [ ] AC1: `threshold-scope-check.ts` 实现，输出 `violations` 与 `skippedByMarker` 两个字段
- [ ] AC2: **双向负控制**——`needs-human ≥ 3`（无集合无窗口）必须报出；
      `窗口内新增 needs-human ≥ 3` 必须不报。两条实跑输出都贴进任务体
- [ ] AC3: 被 `<!-- unmechanized: -->` / `<!-- unmechanizable: -->` 标记的段落**不报**；
      用文档里现有的 3 处标记验证，并在输出里报 `skippedByMarker` 的数量（**跳过必须可见**——
      静默跳过与「没发现问题」不可区分）
- [ ] AC4: 匹配按**行内容**，剥离代码块与 HTML 注释内容
      （本仓库今晚已有 7 次「匹配到提到它的文本而非它本身」的教训）
- [ ] AC5: 在当前三份文档上实跑，违规清单贴进任务体；名单落盘为
      `docs/analysis/threshold-scope-violations.md`
- [ ] AC6: 名单是 shrink-only 棘轮，新增即失败；与 `contract-violations.md` 同款
- [ ] AC7: 报出而不阻断；接进 `scripts/test.sh` 的 governance 组
- [ ] AC8: 测试带 `// @test-group governance` 声明

## Definition of Done

- [ ] AC2 的双向负控制与 AC5 的违规清单贴进任务体
- [ ] `scripts/test.sh` 连跑 2 次全绿
- [ ] 明确记录：**缺的从来不是执行者，是范围**。`≥3` 本身没有歧义，
      「≥3 个什么、在什么窗口内」才是歧义所在——而正是这个歧义卡死了一次派发

## Touches

- plugin/scripts/threshold-scope-check.ts
- plugin/test/threshold-scope-check.test.mjs
- docs/analysis/threshold-scope-violations.md
- scripts/test.sh

## Dispatch review

reviewer: outer
at: 2026-08-03T03:26:00Z
changed: 范围从「所有决策性散文都要有执行者」收窄到「只查带量词的停止条件」——
  依据是 `normative-prose-audit.md` 的逐条判定：36 条里 4 条不该被修（1 条 ADR-021 有意不机械化、
  3 条是本质不可机械化的思维纪律），通用检查会对它们持续报假警而被忽略；
  并要求 AC3 显式报出 `skippedByMarker` 数量，因为静默跳过与「没发现问题」不可区分
