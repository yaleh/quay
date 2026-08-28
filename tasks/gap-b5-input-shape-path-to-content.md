---
id: gap-b5-input-shape-path-to-content
title: B5·层 3 输入形状 path→content——判定逻辑对字符串纯函数，先 3-5 checker 示范测收益
status: ready
labels:
  - gap
  - feature
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

SPEC §1.4 实测：~70% checker 吃【文件系统路径】⇒ 85 个 checker 测试中 70 个要 mkdtemp 建 fixture。真正的可测试性杠杆是【输入形状 path→content】——判定逻辑对【字符串】纯函数，I/O 留薄 CLI 壳。样板已存在：`experiments/quay-perpetual-stream/scripts/audit-independence-check.ts`（纯函数 39 断言 0.49s 零 spawn，对照 checker 测试中位 2.53s）。⛔ 不以「缩短套件时间」为论据（§1.5② 已自证否定：checker 测试折叠 ≈ 705s 轮次 1.5%，93% 在 packages/）。真实论据 = checker 测试撰写/维护成本（32,881 行）。

## Plan

先 3 个 checker 做示范（用 audit-independence-check.ts 作模板，把判定逻辑抽成对字符串的纯函数导出 + 薄 main() CLI 壳）：`adr016-screen-use-check.ts` / `concurrency-literal-check.ts` / `cap-counts-subagents-check.ts`（⛔ 若实现中发现某个不适合，改自身任务 Touches 换一个再动手，anti-drift 按最终 Touches 判）。测出实际收益（测试耗时下降 + 撰写成本下降）再决定是否推广。⛔ 不凭已被否定的「缩短套件」链条推广，先测后写。

## Acceptance Criteria

- [x] AC1（能取假，纯函数导出）：≥3 个 checker 导出对【字符串/内容】的纯判定函数（非路径），其测试可零 spawn 零 mkdtemp 运行（grep + 实测测试耗时）；（⛔ 仍吃路径 ⇒ 假）。
- [x] AC2（能取假，负控制）：该纯函数测试确实覆盖判定逻辑（注掉判定逻辑一处，测试须红）；（⛔ 注掉不红 ⇒ 假）。
- [x] AC3（能取假，收益实测）：示范 checker 的测试耗时（vs 改造前）记录在案，作推广/不推广的依据（先测后写，不凭链条）；（⛔ 无收益记录 ⇒ 假）。

## Definition of Done

≥3 个 checker 示范 path→content；AC1/AC2/AC3 全勾；收益实测记录（决定推广与否）。

## Result（path→content 示范实测）

**AC1 — 纯函数导出（非路径, 测试零 spawn 零 mkdtemp）**：3 个 checker 均已导出对字符串/内容的纯判定函数, 每个 .ts 头部加了 `path→content` 标记注释:

- `adr016-screen-use-check.ts`：`detectFileViolations(rel, source)` / `detectTickDocViolations(rel, source)` / `stripShellComments(src)` / `judgeBand(activeCount)`（新增——把 main() 里的 `active<=1` 带判断抽成纯函数）。
- `concurrency-literal-check.ts`：`scanText(rel, src)`（逐条命中分类 定义点/已声明例外/违规）。
- `cap-counts-subagents-check.ts`：`judgeSlotRefillCanonical` / `judgeWorktreeVsSubagent` / `judgeReportLine` / `judgeC24Retirement` / `judgeC24Coverage` / `judgeLiveVsTaskStatus`。

测试直调这些纯函数（inline 字符串 + committed fixture），判定逻辑零 spawn 零 mkdtemp；唯一保留 mkdtemp 的是 cap-counts 判据2 `countActiveSubagentTranscripts`（第三方文件系统【读法】, 非判定, mtime 无法用 committed fixture 表达）。

**AC2 — 负控制（注掉判定一处 ⇒ 测试红, 逐条实测）**：
| checker | 注掉的一处判定 | fail |
|---|---|---|
| adr016 | same-command push 行 | 3 |
| concurrency-literal | fallback-marker → declared-exception | 3 |
| cap-counts | live-misreport 谓词 `done/needs-human/absent` | 2 |

**AC3 — 测试耗时（改造前 spawn+mkdtemp vs 改造后 零 spawn）**：
| checker | 改造前 | 改造后 | 测试数 |
|---|---|---|---|
| adr016 | 4.70s | 1.38s | 15→14（移除的 1 条是 I/O 壳属性测试「.md 不被当 shell 收集」, 判定等价面由 prose-exempt 纯测试 + 全仓扫描测试覆盖） |
| concurrency-literal | 11.66s | 6.33s | 24→24 |
| cap-counts | 4.32s | 1.24s | 27→27 |
| 合计 | 20.68s | 8.95s | — |

**结论（先测后写, 不凭链条）**：时间主杠杆是 spawn 消除（合计 -11.7s, ~57%）；concurrency 改造后仍 6.33s 是 2 次 in-process 全仓真实语料扫描（`--gate`/`--scan` 集成测试）的 I/O 成本, 其判定纯函数本身已快。撰写成本下降是主收益——判定测试 = inline 字符串, 零 fixture 目录、零 spawn 样板。推广建议：**抽取纯判定函数 + 薄 main() I/O 壳**值得推广；但**不**以「缩短套件时间」为论据（与 Proposal 一致）, 且集成测试（真实语料扫描）的 I/O 成本不会因 path→content 消失。

## Touches

- plugin/scripts/adr016-screen-use-check.ts（抽纯函数 + 薄 main 壳）
- plugin/scripts/concurrency-literal-check.ts（抽纯函数 + 薄 main 壳）
- plugin/scripts/cap-counts-subagents-check.ts（抽纯函数 + 薄 main 壳）
- plugin/test/adr016-screen-use-check.test.mjs（纯函数测试）
- plugin/test/concurrency-literal-check.test.mjs（纯函数测试）
- plugin/test/cap-counts-subagents-check.test.mjs（纯函数测试）
- plugin/test/fixtures/concurrency-literal/.claude/workflows/bad.js（AC2 负控制 committed fixture）
- tasks/gap-b5-input-shape-path-to-content.md（自身）
