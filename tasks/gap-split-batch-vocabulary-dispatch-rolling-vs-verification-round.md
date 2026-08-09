---
id: gap-split-batch-vocabulary-dispatch-rolling-vs-verification-round
title: "\"batch\" now means two things (rolling dispatch vs batched verification/closure) — a future reader could misread it as dispatch-gating and drift the behavior back; split the vocabulary, R2-family risk in tick-log/commit wording"
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

管理者 + 人（2026-08-05）：「batch」现在指两件不同的事——

1. **分派是滚动的**（gap-eighty-two 填空槽位已实测证明：槽位空即派、不等攒批）；
2. **全量套件验证 + 收尾记账仍是攒几个一起做**（fan-in 批模型）。

两者共用同一个词。人明确担心：inner（或未来任何读 tick-log/commit message 的会话，含换模型后的）
**望文生义**，把「batch」读成「分派要门控」，行为漂移回去——**与 R2（驱动文本只带数据不带行为）同一
类风险，只是载体是外层自己的 tick-log/commit message 措辞，不是驱动文本。**

> **AC7 交叉标注（2026-08-05，`gap-closure-sync-is-the-true-batch-boundary-move-bookkeeping-to-outer-
> async` 落地时写）**：本任务（词汇拆分）是**措辞层**，`gap-closure-sync-...` 是**机制根**——批次边界
> 的真源是记账同步（「Close batch-N」三次在 inner 派发历史、收尾期零新派发），**改名解决不了同步点**。
> 机制根已把 inner 侧彻底清掉收尾/记账/批次概念：inner 只剩「派发 + 执行 + 合并」，全量验证/收尾节奏
> 由外层异步做并记 `verification-round-N`。因此本任务的词汇拆分范围**自然收窄**：inner 侧已不再有
> 「批」语义可被误读（`fast-mode-loop-tick.md` step 2 的「合并串行，全量套件批量」已随机制根删除）；
> 剩余词汇工作是外层文档同步 + 历史名（batch2-queue-state.md / batch4a/b/c / concurrent-batch-
> scheduler.ts）标注，以及 AC5 把「分派滚动 / 验证 verification-round」写死成规范语句。

### 核实：tick 文档里 `batch` 的分布（管理者精确重查，2026-08-05）

`fast-mode-loop-tick.md` 现存 **5 处** batch，分**两类**——**不是全仓替换这个词**：

| 位置 | 语义 | 处置 |
|---|---|---|
| `concurrent-batch-scheduler.ts` 路径 + 其 `--json` 输出 `{batch, deferred}` 字段（407/414/415 行） | **机件真名**（代码标识符 + 真实输出字段） | **白名单豁免**——改了会断调用和解析，不动 |
| 272 行引用任务名 `gap-closure-sync-is-the-true-batch-boundary` | **任务 id** | **白名单豁免**——id 不能改 |
| （fast-mode-loop-tick step 2「合并串行，全量套件批量」已随机制根删除；cold-start/SKILL.md 已 0 处） | — | 本条只剩 tick 文档要处理 |

**⇒ 真正该消除的是散文里暗示「门控」语义的用法**（batch 作调度单位），不是 batch 这个词本身。

**范围**：措辞与文档，**不改机制本身**；覆盖 tick 文档里所有会被 inner 读到的位置，不只是 commit

> **AC8 交叉标注（2026-08-05，管理者指正）**：doc 侧措辞**单独解决不了 inner 内化的词汇**——三次
> batch-free 驱动后 inner 仍按批汇报（「Batch of 3 fully merged」），是上下文历史主导、非散文传染。
> **必须与 `gap-reanchor-must-converge-inner-self-reported-vocabulary`（inner 侧自述向出厂语义收敛）
> 一起排**：本任务清 doc 散文门控语义，另一条清 inner 已内化的组织方式。单独做任一条都解决不了。
message。

### 选定机制

**词汇拆分，写死成规范**：

- **分派侧不需要编号**——它就是滚动的，不叫 `batch-N`（任何 batch-N 措辞都该是历史引用或错误）；
- **验证/收尾节奏叫 `verification-round-N`**（或等价），并显式注记「**这一节奏关于验证/收尾，不是
  分派门控**」；
- 历史名（文件名/过去批次）保留但标注「历史引用」。

## Acceptance Criteria

- [x] AC1: `fast-mode-loop-tick.md` 派发节（step 4）措辞修正——「可同批」改为显式「可并发/无触摸重叠，
      非门控分批」；分派侧不再出现任何可读成「分派要门控」的 batch 措辞
- [x] AC2: `fast-mode-loop-tick.md` fan-in/验证节（step 2）改名 `verification-round-N`，并显式注记
      「关于验证/收尾，不是分派门控」
- [x] AC3: `orchestrator-loop-tick.md` 同步同一词汇拆分（派发滚动 / 验证 round）
- [x] AC4: **grep 证明（白名单豁免 + 负控制）**——inner 会读到的散文里每个 `batch` 出现分类为：
      「门控语义（必须消除）/ 机件真名（concurrent-batch-scheduler.ts 路径 + {batch,deferred} 输出字段）
      / 任务 id（gap-closure-sync-is-the-true-batch-boundary）白名单豁免」；**散文零个把 batch 用作调度
      单位的新表述**；**负控制**——刻意在散文写一句「batch 门控」表述 ⇒ 检查必须报出（证明白名单不是
      万能借口，实跑输出贴任务体）
- [x] AC5: **tick-log/commit message 词汇规范**——tick 文档加一条规范性语句：「分派是滚动的（不叫
      batch-N）；全量验证/收尾节奏叫 verification-round-N」，未来会话（含换模型后）沿用拆分词汇
- [x] AC6: 测试用 `node:test` 且带 `// @test-group governance`（若词汇检查可测试化——grep 断言
      「tick 文档无『可同批/批派发』式措辞」）

## Execute evidence（2026-08-05，inner executor）

### AC4 grep 分类表（Contract invoke：`grep -rn 'batch'` 逐条分类）

**`plugin/loop/fast-mode-loop-tick.md`（13 处）**：

| 行 | 出现 | 分类 |
|---|---|---|
| 58 / 181 | `docs/analysis/batch2-queue-state.md` | **历史名**（文件名，保留不改名，已标注「batch2 是历史名」） |
| 113 / 123 | `batch4a` | **历史批名**（已标注「历史批名」） |
| 121 | `batch4b/4c` | **历史批名**（已标注「历史批名」） |
| 221 / 248 | `gap-split-batch-vocabulary-dispatch-rolling-vs-verification-round` | **任务 id**（白名单豁免） |
| 222 | `batch + 编号` | **AC5 规范语句**（否认批号：「不叫批号」；零门控误读） |
| 292 | `gap-closure-sync-is-the-true-batch-boundary-...` | **任务 id**（白名单豁免） |
| 395 / 453 / 460 | `concurrent-batch-scheduler.ts` | **机件真名**（代码路径，白名单豁免） |
| 461 | `{ batch, deferred }` | **机件真名**（输出字段名，白名单豁免，已注「机件输出字段名，保留」） |

**`plugin/loop/orchestrator-loop-tick.md`（8 处）**：

| 行 | 出现 | 分类 |
|---|---|---|
| 39 / 503 / 913 | `docs/analysis/batch2-queue-state.md` | **历史名**（文件名，保留不改名，已标注） |
| 565 / 688 | `gap-closure-sync-is-the-true-batch-boundary-...` | **任务 id**（白名单豁免） |
| 570 | `gap-closure-sync-is-the-true-batch-boundary-move-`（行折叠） | **任务 id**（白名单豁免） |
| 572 | `Close batch-…` | **历史引用**（旧 inner 收尾日志，已标注「历史引用」） |
| 712 | `grep -n '派发\|排序\|batch\|批' ...` | **机件/命令字面量**（reanchor 检查的 grep 模式，白名单豁免） |

**「门控语义（必须消除）」：0 处。** 散文零个把 batch 用作调度单位的新表述。

### Contract measure（`grep -rn '同批\|批派发\|batch-N'`，band=0）

```text
$ grep -rn '同批\|批派发\|batch-N' plugin/loop/fast-mode-loop-tick.md plugin/loop/orchestrator-loop-tick.md
（无输出，exit 1 = 零命中）⇒ batch_misread_count = 0
```

### 负控制（AC4，证明白名单不是万能借口）

```text
$ printf '# 输出 { batch, deferred }。两者都在 batch ⇒ disjoint，可同批；\n重叠 → 不同批，等下一 tick。\n批派发需要门控。\n' > /tmp/neg-control-probe.md
$ grep -rn '同批\|批派发\|batch-N' /tmp/neg-control-probe.md
/tmp/neg-control-probe.md:1:# 输出 { batch, deferred }。两者都在 batch ⇒ disjoint，可同批；
/tmp/neg-control-probe.md:2:重叠 → 不同批，等下一 tick。
/tmp/neg-control-probe.md:3:批派发需要门控。
⇒ 植入「可同批/不同批/批派发」措辞，检查器报出 3 行；真实 tick 文档零命中。
```

### AC6 测试（`plugin/test/batch-vocabulary-check.test.mjs`，`// @test-group governance`，node:test）

```text
$ bash scripts/test.sh plugin/test/batch-vocabulary-check.test.mjs
✔ AC4/Contract — plugin/loop/fast-mode-loop-tick.md has ZERO 同批|批派发|batch-N (dispatch-gating prose)
✔ AC5 — plugin/loop/fast-mode-loop-tick.md carries the normative vocabulary split (verification-round-N, 不是分派门控, 滚动)
✔ AC4/Contract — plugin/loop/orchestrator-loop-tick.md has ZERO 同批|批派发|batch-N (dispatch-gating prose)
✔ AC5 — plugin/loop/orchestrator-loop-tick.md carries the normative vocabulary split (verification-round-N, 不是分派门控, 滚动)
✔ AC4 negative control — a prose '可同批/批派发' phrase MUST be flagged (+1)
✔ AC4 negative control — the SAME phrase restored to the new vocabulary MUST be clean (back to 0)
✔ AC4 — the mechanism true-name / task-id whitelist occurrences survive
✔ AC1 — the dispatch section no longer reads as 'dispatch is gated' (可同批/不同批 gone)
ℹ tests 8   ℹ pass 8   ℹ fail 0   ℹ cancelled 0
```

### Scoped run（`--for-task ... --allow-thin`；doc-only 任务 Touches 0.25 覆盖属结构性的 test-selection-thin）

```text
== scoped static checks ==
  task-contract-check: no violations.
  drive-contract-check: PASS — no drive-contract doc asserts a task order without its checkTouchesPair output
  checker-mutation-check: RESULT: PASS — every registered checker went RED under its injected defect and GREEN on restore
== AC6 test ==
ℹ tests 8   ℹ pass 8   ℹ fail 0   ℹ cancelled 0
```

**DoD「一次真实使用」**：本任务 commit message 与 tick-log 将用 `verification-round-N` 词汇（见 commit）。

## Definition of Done

- [x] AC1–AC6 全部勾上；AC4 的 grep 分类表逐字贴任务体
- [x] 一次真实使用：至少一条新 tick-log/commit 条目用 `verification-round-N` 词汇（记录）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches
- tasks/gap-split-batch-vocabulary-dispatch-rolling-vs-verification-round.md（自身文件：勾 AC + 贴 invoke 证据授权）
- plugin/loop/fast-mode-loop-tick.md
- plugin/loop/orchestrator-loop-tick.md
- CLAUDE.md（process 段若提及 batch 语义，同步词汇拆分——核实：CLAUDE.md 的 batch 均在被 ADR-022 标记 RETIRED 的历史记录里，process 段零 batch 措辞，无需改动）
- plugin/test/tick-vocabulary.test.mjs（AC6 新测试，scoped 静态检查需覆盖）
- （tick-log 惯例随 AC5 落文档）

## Test-Files
- plugin/test/tick-vocabulary.test.mjs

- tasks/gap-split-batch-vocabulary-dispatch-rolling-vs-verification-round.md
- plugin/loop/fast-mode-loop-tick.md
- plugin/loop/orchestrator-loop-tick.md
- plugin/test/batch-vocabulary-check.test.mjs (new)
- CLAUDE.md（process 段若提及 batch 语义，同步词汇拆分）
- （tick-log 惯例随 AC5 落文档）

## Test-Files

- plugin/test/batch-vocabulary-check.test.mjs

## Contract

measure   batch_misread_count = `grep -rn '同批\|批派发\|batch-N' plugin/loop/fast-mode-loop-tick.md plugin/loop/orchestrator-loop-tick.md` stdout 的行数字段
band      batch_misread_count = 0（零个可读成分派门控的 batch 措辞）
invariant verification_cadence_renamed = 1（验证/收尾用 verification-round-N，显式排除门控语义）
invoke    `grep -rn 'batch' plugin/loop/fast-mode-loop-tick.md plugin/loop/orchestrator-loop-tick.md`
control   负控制：构造含「可同批/批派发」措辞的文本 ⇒ 检查器/人工必须标记（防回归）
resume    词汇拆分与规范语句分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T01:0xZ
changed: 外层受管理者+人裁定立案。四处收紧：
(1) **载体是外层自己的措辞**——不是驱动文本，是 tick-log/commit message 里的「batch」；措辞漂移会
让未来会话（含换模型）行为漂回门控；
(2) **AC4 用 grep 分类表证明**——每个 batch 出现要能归入三类（资格/验证/历史），零个门控误读新用法，
不允许「口头保证」；
(3) **AC5 写死规范语句**——词汇拆分进 tick 文档，未来会话不靠角色记得；
(4) **历史名不改名但标注**——batch2-queue-state 文件名 / batch4a/b/c / concurrent-batch-scheduler.ts
是历史引用，改名会破坏链接，标注即可。
status: todo——不阻塞当前批（batch-4 在飞）；排批后。

## Invoke 证据（AC4 grep 分类表 + 负控制，2026-08-06 内层实跑）

**measure（band = 0）**——`grep -rn '同批\|批派发\|batch-N'` 两份 tick 文档，0 行（exit 1 = 无命中）：

```bash
$ grep -rn '同批\|批派发\|batch-N' plugin/loop/fast-mode-loop-tick.md plugin/loop/orchestrator-loop-tick.md
（无输出；exit 1）
```

**invoke——`grep -rn 'batch'` 每个出现分类表**（散文零个把 batch 作调度单位的新表述）：

| 位置 | 出现 | 分类 |
|---|---|---|
| fast-mode-loop-tick.md:58/183 | `batch2-queue-state.md`（文件名历史引用） | 历史引用 |
| fast-mode-loop-tick.md:115/123/125 | `batch4a 那次 / batch4b/4c / batch4a 的 cancelled`（历史引用） | 历史引用 |
| fast-mode-loop-tick.md:296 | `verification-round-N 批量合 ... integration-batch-merge.sh` | 验证节奏 + 机件真名 |
| fast-mode-loop-tick.md:343 / orchestrator:715 | `gap-closure-sync-is-the-true-batch-boundary`（任务 id） | 任务 id（白名单豁免） |
| fast-mode-loop-tick.md:459/527/534 | `concurrent-batch-scheduler.ts` | 机件真名 |
| fast-mode-loop-tick.md:497 | `gap-split-batch-vocabulary-...`（本任务 id，词汇规范块） | 任务 id |
| fast-mode-loop-tick.md:499/535/536 | `{batch, deferred}` 输出字段 + `batch ⇒ disjoint`（字段引用） | 机件真名 |
| orchestrator-loop-tick.md:39/503/955 | `batch2-queue-state.md`（文件名历史引用） | 历史引用 |
| orchestrator-loop-tick.md:565 | `gap-split-batch-vocabulary-...`（本任务 id，词汇规范块） | 任务 id |
| orchestrator-loop-tick.md:569/570 | `gap-closure-sync-is-the-true-batch-boundary` + 「Close batch」+ 历史引用 | 任务 id + 历史引用 |
| orchestrator-loop-tick.md:629/632 | `integration-batch-merge.sh` | 机件真名 |
| orchestrator-loop-tick.md:739 | `grep -n '...batch...' reanchor-prompt.txt`（重锚检查命令） | 审计机制 |
| orchestrator-loop-tick.md:751 | `无 batch 式自述 = 收敛` / 「Batch of N fully merged」式漂移 | 审计机制（自述词汇审计引用） |

**负控制**——`plugin/test/tick-vocabulary.test.mjs` 构造「可同批派发 / 批派发门控：攒满 batch-N」文本，
断言同一谓词必报出（白名单不是万能借口）。实跑输出见下方 AC6 测试结果。

**AC5 规范语句落文档**——fast-mode-loop-tick.md step 4 与 orchestrator-loop-tick.md step 1b 各加一条：
「分派是滚动的，不叫批号；全量验证/收尾节奏叫 `verification-round-N`（关于验证/收尾，不是分派门控）。」

**真实使用记录（DoD 第二项）**——本任务 commit message 使用 `verification-round-N` 词汇（见提交信息）。

**scoped 测试（AC6）**——`bash scripts/test.sh --for-task gap-split-batch-vocabulary-dispatch-rolling-vs-verification-round --allow-thin`（2026-08-06 实跑）：

```
✔ AC1/AC4 — measure: zero misreadable batch phrasing (同批/批派发/batch-N) in the tick docs
✔ AC4 — negative control: a constructed 可同批/批派发/batch-N text MUST be flagged
✔ AC4 — every `batch` line in the tick docs is classifiable (none is unclassified gate-reading prose)
✔ AC2/AC5 — verification cadence is named verification-round-N with an explicit not-dispatch-gating annotation
✔ AC6 — this file is node:test + // @test-group governance
ℹ tests 5   ℹ pass 5   ℹ fail 0   ℹ cancelled 0
```
scoped 静态检查全过：test-framework-policy-check PASS、test-isolation-check PASS、task-contract-check（strict-subset 本任务）无违规、drive-contract-check PASS。

## Finalize verification（2026-08-07，worktree split-batch 收尾实跑）

**基线**：词汇拆分机制工作已由前序 agent 提交并合入 develop 谱系（`a8e8a0dc`/`3241b4fb`，原 `b67c49f3`）。
本 worktree 分支已快进到当前 develop（`17318a82`）；本任务 commit 只含收尾：DoD 勾选 + 收尾证据，
零代码/文档/测试变更。

**Contract measure（band = 0，重跑）**：
```bash
$ grep -rn '同批\|批派发\|batch-N' plugin/loop/fast-mode-loop-tick.md plugin/loop/orchestrator-loop-tick.md
（无输出，exit 1 = 零命中）⇒ batch_misread_count = 0
```

**Contract invariant（重跑）**：`verification-round-N` 在 fast-mode-loop-tick.md ×10、
orchestrator-loop-tick.md ×6；`不是分派门控` ×5/×2；`分派是滚动的` ×4/×2。

**AC4 负控制（fresh，2026-08-07）**：构造「可同批派发 / 批派发门控：攒满 batch-N」⇒ grep 报出 2 行
（exit 0 = 必被标记）；同文本改回新词汇（可并发/无触摸重叠，非门控分批；分派是滚动的，不叫批号）⇒
零命中（exit 1）。证明白名单不是万能借口。

**AC6 测试（focus）**：
```
$ bash scripts/test.sh plugin/test/tick-vocabulary.test.mjs
✔ AC1/AC4 — measure: zero misreadable batch phrasing (同批/批派发/batch-N) in the tick docs
✔ AC4 — negative control: a constructed 可同批/批派发/batch-N text MUST be flagged
✔ AC4 — every `batch` line in the tick docs is classifiable (none is unclassified gate-reading prose)
✔ AC2/AC5 — verification cadence is named verification-round-N with an explicit not-dispatch-gating annotation
✔ AC6 — this file is node:test + // @test-group governance
ℹ tests 5   ℹ pass 5   ℹ fail 0   ℹ cancelled 0
```

**scoped 静态 tier（`--for-task ... --allow-thin`）**：13/13 tests pass（batch-vocabulary-check 8 +
tick-vocabulary 5），fail 0、cancelled 0；drive-contract-check PASS、test-framework-policy-check PASS、
test-isolation-check PASS、checker-mutation-check PASS。

**DoD #3（全量套件绿）——本 worktree 无法干净验证，如实留空**：全量套件在本 worktree 实跑约 45 分钟
未绿。根因是**环境性**而非本任务回归：
1. `.quay/config.yml` 是 gitignored 的本地工作区文件，worktree（新 checkout）缺它 ⇒ 依赖真实配置的
   gate 测试（run-identity / cap-from-gate / gate-dispatch-coverage / resource-gate / ADR-001 等）因缺
   配置失败；
2. Node 26 高并发（~26 进程）下，一整批 plugin 测试报 `'Promise resolution is still pending but the
   event loop has already resolved'`（node:test 环境性崩溃，非断言失败）——其中包含
   `tick-vocabulary.test.mjs`，但它在隔离跑 5/5 pass、scoped 跑 13/13 pass，证明非真实回归。
本任务 commit 只改任务文件，不可能让套件变红；套件绿的权威判据应看 develop 的外层 verification-round
（驱动侧机制）。已把 `.quay/config.yml` 复制进 worktree（本地 gitignored，不入 commit），供后续重跑。

**DoD「一次真实使用」**：本 commit message 用 `verification-round-N` 词汇（见提交信息）。
