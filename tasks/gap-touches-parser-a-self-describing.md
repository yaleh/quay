---
id: gap-touches-parser-a-self-describing
title: Touches A：规则具名 + help 可枚举（s3-7 + sa5b-3/4）
status: done
labels:
  - gap
  - touches-parser
parent: null
children: []
extra:
  schema: execution
---
## Proposal

单源 parser **已经存在**：`plugin/scripts/touches-parser.ts` 委托 `packages/quay/src/kernel/touches-annotation.ts`，收敛记录在 `plugin/test/touches-parser-parity.test.mjs` 的头注释（`gap-task-body-has-n-parsers-and-no-authority`）。**本任务不做 parser 去重。**

真正的缺口是：3 条 Touches 规则（s3-7 全角/半角括号的注解剥离、sa5b-3 小节选取、sa5b-4 结构标签识别）**没有名字、没有 agent 可见的 code、没有可区分的正/负臂**；`quay task create --help` 今天**没有 Touches 文法**。实测基线（`7312015b`）：30 题负载集里 Touches 相关的 Q2/Q3 无法从产物面回答；Q2（`src/*` overbroad）属后续的 B 切片，本任务只覆盖 **Q3**。

影响：agent 只能靠读源码或撞错误来学习这些规则；错误消息不点名是哪条规则触发，无法区分「注解被当字面文本」与「标签不认识」。

**⛔** 不以「|D| 下降 / 原子数减少」作为任何 AC 或 DoD 的证据。「D 收缩预期」只作信息：s3-7 / sa5b-3 / sa5b-4 三条在项目侧被承接后可交 `/dsi:maintain` 评估删行。

## Plan

1. 在 `packages/quay/src/kernel/touches-annotation.ts` 加**两张独立纯数据表**（kernel 叶规则：零 import、只加数据）：`TOUCHES_PROBLEM_CODES`（4）与 `TOUCHES_READING_CODES`（3），每条 `{code, atom, rule, meaning}`。
   - problem（4）：`touches-annotation-halfwidth-literal`(s3-7)、`touches-section-ambiguous`(sa5b-3)、`touches-label-unrecognized`(sa5b-4)、`touches-label-fullwidth`(sa5b-4)
   - reading（3）：`touches-section-canonical`(sa5b-3)、`touches-label-new`(sa5b-4)、`touches-label-delete`(sa5b-4)
2. 在 `plugin/scripts/touches-parser.ts` 加 `diagnoseTouches(text, { rules })`，返回 `{problems[], readings[], section, tags}`。**既有 `parseTouchEntries` / `parseTouchEntriesWithTags` / `extractTouchesSection` 的签名与返回形状一律不变**——有 22 个导入者。
3. 在 `packages/quay/src/cli/help.ts` 的 `task create` 段增加「Touches grammar」小节：从 kernel 导入两张表，逐条渲染 `code [problem|reading] — meaning`。**⛔ 不在 help 里手写第二份 code 列表。**
4. 新增 `plugin/test/touches-parser-rules-a.test.mjs`：4 个 problem code 的正/负臂 + **区分矩阵**；3 个 reading code 的读数断言。
5. 新增 `plugin/test/touches-parser-help-surface.test.mjs`：`spawnSync` 跑真实的 `node packages/quay/bin/quay.js task create --help`，从 **stdout** 抽 `touches-[a-z-]+` 与 `[problem|reading]` 标记，得到 7 个 code，与两张表的并集**逐项相等**。
6. 既有 `plugin/test/touches-parser-parity.test.mjs` 保持绿；断言 `touches-parser.ts` 没有第二份 strip/parse 定义。

## Acceptance Criteria

- [x] AC1 跨层：`node --test plugin/test/touches-parser-help-surface.test.mjs`——用 `spawnSync` 跑**真实** `quay task create --help`，从 stdout 抽 code 与 `[problem|reading]` 标记，7 个 code 与两张表并集**逐项相等**。⛔ 不许 import 表再和表自己比（同义反复）。
      逐字读数（2026-11-07，worktree gap-touches-parser-a-self-describing）：`node --test plugin/test/touches-parser-help-surface.test.mjs` ⇒ `ℹ tests 3 · ℹ pass 3 · ℹ fail 0`。从**真实 stdout** 抽到 7 条：problem = touches-annotation-halfwidth-literal / touches-section-ambiguous / touches-label-unrecognized / touches-label-fullwidth；reading = touches-section-canonical / touches-label-new / touches-label-delete —— 与两张表并集**逐项相等**（code + kind + `rule <id>` + meaning 四项都比）。负控制：把 stdout 里 `touches-label-delete [reading]` 抹掉后抽取器只读到 6 条（抽取器能取假，不是恒真）。
- [x] AC2 区分矩阵：`node --test plugin/test/touches-parser-rules-a.test.mjs`——每个 problem code 有正/负臂；违反规则 X 的输入，`problems[]` 的 code 集合 === `{X}` 且**不含任何兄弟 code**；每个 reading code 有正臂（section 选择 / tag=new / tag=delete）。
      逐字读数：`node --test plugin/test/touches-parser-rules-a.test.mjs` ⇒ `ℹ tests 16 · ℹ pass 16 · ℹ fail 0`。四臂实测 code 集合：`- plugin/scripts/foo(bar).ts` ⇒ `["touches-annotation-halfwidth-literal"]`（且该输入实测被剥成 `plugin/scripts/foo`——规则指向的是真实缺陷，不是假想）；两节 `Touches` 标题 ⇒ `["touches-section-ambiguous"]`；`(add)` ⇒ `["touches-label-unrecognized"]`；`（new）` ⇒ `["touches-label-fullwidth"]`。四个负臂 4/4 不出现该 code，干净声明 problems = `[]`。reading 正臂：section-canonical = `exact` / `fallback` / `absent`，label-new = 2，label-delete = 2（`(delete)` 与 `(deleted)` 同 tag）。
- [x] AC3 正臂 + 负臂：**正臂**用真实注册表 + 真实 `--help` 渲染，断言 X 在场且含义一致；**负臂**用注入注册表删掉 X，断言 X 消失且同一输入的 section/tag/annotation 读数同时变化。两条都跑；⛔ 只做注入负臂不算测量（硬规则 4 推论三）。
      逐字读数（同一测试文件内，正负两臂都跑）：正臂——真实注册表对每个违规输入报出该 code，且真实 CLI 的 `task create --help` stdout 行里同时带 `[problem]`、`rule <id>` 与表内 meaning 逐字（4/4 problem + 3/3 reading）。负臂（逐规则注入）——去 s3-7 ⇒ code 消失、`tags[0].path` 由 `plugin/scripts/foo.ts` 变成 `plugin/scripts/foo.ts (new)`；去 sa5b-3 ⇒ `section.selection` `exact`→`latch`、`section.heading` `Touches`→`Touches 声明（说明段）`、section 读数 code 从 `readings[]` 消失；去 sa5b-4 ⇒ `tags` 全部 tag=null。三者消失的 code 同时落进 `notEvaluated[]`（硬规则 3b：规则关掉 ≠ 检查过且干净）。
- [x] AC4 单源不回退：`touches-parser.ts` 无第二份 strip/parse 定义；`plugin/test/touches-parser-parity.test.mjs` 仍绿。
      逐字读数：`node --test plugin/test/touches-parser-parity.test.mjs` ⇒ `ℹ tests 21 · ℹ pass 21 · ℹ fail 0`，其中新增断言 `AC4: touches-parser.ts carries no second strip/parse definition` —— 该文件本地 `function` 定义清单里无 stripTouchAnnotation / stripTrailingFullWidthAnnotation / stripTouchQuotes / normalizeTouchEntry / parseTouchBulletPaths / parseTouchEntries，且 `parseTouchEntries === kernel.parseTouchBulletPaths`、`stripTouchAnnotation === kernel.stripTouchAnnotation`（比较的是函数对象，等体复制品过不了）。
- [ ] AC5 DSI 侧（外部执行）：删掉 3 条 D 行后，A 的 guard 测试 + help 面仍能回答对应探针；A 只覆盖 30 题 Q3，**Q2 属 B**；section/label 没有对应题，用 guard 测试作读数，**不扩分母**。（待外部）

## Definition of Done

- 五条 AC 勾选，每条附**可复跑命令与逐字读数**（⛔ 不是「文件存在」或「测试绿了」）。
- `scripts/test.sh --for-task gap-touches-parser-a-self-describing` 绿；全量 suite 不回归。
- `node packages/quay/bin/quay.js task create --help` 的**真实输出**里能数出 7 个 code，且带 `[problem]/[reading]` 标记（贴逐字输出）。
- 低一档的做法不算交付：只加注释 / 只加一条「有报错」的测试 / 只 import 表对比表。
- ⛔ 完成证据中不得出现「|D| 下降」或类似计数下降。
- 落地读数（2026-11-07，worktree `gap-touches-parser-a-self-describing`）：`bash scripts/test.sh --for-task gap-touches-parser-a-self-describing --allow-thin` ⇒ exit 0，`ℹ tests 131 · ℹ pass 131 · ℹ fail 0`；`npx tsc --noEmit` ⇒ exit 0；`anti-drift-touches-check.ts --merge-target develop` ⇒ `ANTI-DRIFT OK — 6 actual file(s), all within declared Touches (7 glob(s))`。
- 真实 `--help` 逐字（片段，7 行 code 行）：`touches-annotation-halfwidth-literal  [problem]  rule s3-7 — …`、`touches-section-ambiguous             [problem]  rule sa5b-3 — …`、`touches-label-unrecognized            [problem]  rule sa5b-4 — …`、`touches-label-fullwidth               [problem]  rule sa5b-4 — …`、`touches-section-canonical             [reading]  rule sa5b-3 — …`、`touches-label-new                     [reading]  rule sa5b-4 — …`、`touches-label-delete                  [reading]  rule sa5b-4 — …`。
- L_D import-graph-check: files=563 edges=1747 valueEdges=1583 typeEdges=164 valueSccs=0 typeSccs=0 reverseEdges=0 kernelViolations=0 evaluated=true（`node --experimental-strip-types plugin/scripts/import-graph-check.ts . --json`，退出 0；口径限制：`notAnalyzed mjs=83 js=10`，本任务新增的两个测试是 .mjs，不在该图的解析范围内——这条读数覆盖生产面，不覆盖测试面）。
- L_G：该轴仍暗,理由:本 worktree 内没有可跑的 archguard CLI（`npx --no-install archguard --version` ⇒ `could not determine executable to run`），god-package / 重复抽象无读数；本次改动只加两张纯数据表 + 一个诊断读面 + 由表渲染的 help 段，未引入新的抽象或第二份实现。

## Touches

- packages/quay/src/kernel/touches-annotation.ts
- plugin/scripts/touches-parser.ts
- packages/quay/src/cli/help.ts
- plugin/test/touches-parser-parity.test.mjs
- plugin/test/touches-parser-rules-a.test.mjs (new)
- plugin/test/touches-parser-help-surface.test.mjs (new)
- tasks/gap-touches-parser-a-self-describing.md
