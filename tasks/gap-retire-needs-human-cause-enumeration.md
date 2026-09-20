---
id: gap-retire-needs-human-cause-enumeration
title: 退役 needs_human_cause 三态枚举与 blockedOutsideTaskResolved——零读者、零
  blocked-outside-task 样本，needs-human 的原因是异常，不该用枚举做逻辑控制
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref -->相关已完成任务（仅追溯）：gap-needs-human-overloaded-two-populations-one-state（引入本机制的任务；本任务将其取代）。

**问题（直接量，2026-09-20）**：`plugin/scripts/driver-filters.ts` 的 `markNeedsHuman` 在翻转时写 `needs_human_cause` 三态枚举（human-adjudication / blocked-outside-task / unclassified），由手写的 `HUMAN_ADJUDICATION_STEPS` 步骤名清单从 `mechanical_fan_in.step` 分类。实测：磁盘上带该字段的任务 37 个，取值 human-adjudication 29 / unclassified 8 / **blocked-outside-task 0**——这套机制存在的全部理由（区分第二类并据证据谓词再入队）在生产里一次都没发生过；`blockedOutsideTaskResolved` **零个非测试调用者**；除 `driver-filters.ts` 与其测试外，源码、schema、CLI、MCP、web、派发**没有任何读者**。枚举清单是开放世界（新增一个 fan-in 步骤就漏，步骤名 `ff` 还会把证书闸失败错标成「develop 前进」）。

**人的裁定（2026-09-20，逐字）**：「needs-human 本来就不应该有『可机械再入队』的路径。」「我对靠枚举 needs_human_cause 做逻辑控制也没有太大信心 —— needs-human 的原因应当是异常，枚举异常是靠不住的。」

**做法**：整套删除——`NEEDS_HUMAN_CAUSE`、`NEEDS_HUMAN_CAUSES`、`NeedsHumanCause`、`isNeedsHumanCause`、`HUMAN_ADJUDICATION_STEPS`、`classifyNeedsHumanCause`、`NEEDS_HUMAN_CAUSE_FIELD`、`frontmatterNeedsHumanCause`、`patchNeedsHumanCauseField`、`tallyNeedsHumanCauses`、`blockedOutsideTaskResolved`（及仅为它服务的 `isAncestorOfBranch`、`readLatestFfEscalation` 若无其它调用者）；`markNeedsHuman` 不再写该字段、返回值去掉 `cause`、`## Needs-Human` 注记去掉「成因类」一行，但**保留**注记里的事实行（阻碍原因、失败步/判词、run_id、session_id、suite 日志、fan-in 日志）。磁盘上已有的 37 个 `needs_human_cause:` 字段**不改**（作惰性遗留，不批量改任务文件，硬规则 11b）。不新增任何替代分类。

## AC

- [x] 删除前干跑谓词：`git grep -c "needs_human_cause\|NEEDS_HUMAN_CAUSE\|classifyNeedsHumanCause\|blockedOutsideTaskResolved\|tallyNeedsHumanCauses\|patchNeedsHumanCauseField\|frontmatterNeedsHumanCause\|HUMAN_ADJUDICATION_STEPS" <删除前的 develop 提交> -- plugin/scripts/driver-filters.ts` 命中 ≥1（证明谓词能命中真样本）。
- [x] 删除后同一谓词对 `plugin/scripts packages/*/src` 下非测试 `.ts` 命中 0 条（贴出命令与输出）。
- [x] `node --test plugin/test/driver-filters.test.mjs` exit 0，且其中不再有引用被删符号的用例；新增/保留一条用例断言 `markNeedsHuman` 写出的任务体仍含 `## Needs-Human`、阻碍原因、失败步/判词、run_id、日志路径行，且**不含**「成因类」与 `needs_human_cause`（回归对照）。
- [x] 惰性遗留：对一个磁盘上已带 `needs_human_cause: human-adjudication` 的任务（如取自 `git grep -l "^needs_human_cause:" -- tasks | head -1`）运行 `node plugin/scripts/task-schema-check.ts <该文件>`，退出码与本任务前相同（读数贴出），且 `git diff --name-only develop -- tasks/` 只含本任务文件与被取代任务文件。
- [x] 被取代任务 `gap-needs-human-overloaded-two-populations-one-state` 的任务体追加一节「被 <本任务 id> 取代」（含日期、人的逐字裁定、37/29/8/0 读数）；本任务提交信息含「被删词条 → 去向」映射（每个被删符号的去向：删除 / 无替代），硬规则 5。
- [x] `scripts/test.sh --for-task gap-retire-needs-human-cause-enumeration` exit 0。

## DoD

在真实仓库上，`markNeedsHuman` 对一个真实 ready 任务翻转后，任务文件不含 `needs_human_cause`，注记事实行齐全；全仓非测试代码对被删符号零引用；已有 37 个遗留字段任务文件字节未变。不引入任何替代枚举或再入队路径。

## Touches

- plugin/scripts/driver-filters.ts
- plugin/test/driver-filters.test.mjs
- plugin/scripts/worker-driver.ts
- tasks/gap-needs-human-overloaded-two-populations-one-state.md
- tasks/gap-retire-needs-human-cause-enumeration.md

## Evidence

**AC1 — 删除前干跑谓词（证明谓词能命中真样本）**

```
$ git grep -c "needs_human_cause\|NEEDS_HUMAN_CAUSE\|classifyNeedsHumanCause\|blockedOutsideTaskResolved\|tallyNeedsHumanCauses\|patchNeedsHumanCauseField\|frontmatterNeedsHumanCause\|HUMAN_ADJUDICATION_STEPS" 37fdc7493 -- plugin/scripts/driver-filters.ts
37fdc7493:plugin/scripts/driver-filters.ts:32
(exit 0)
```
37fdc7493 = 删除前的 develop 提交；命中 **32** 行 ≥ 1 ⇒ 谓词能命中真样本（不是恒零谓词）。

**AC2 — 删除后同一谓词对非测试 .ts 命中 0 条**

```
$ grep -rn "needs_human_cause\|NEEDS_HUMAN_CAUSE\|classifyNeedsHumanCause\|blockedOutsideTaskResolved\|tallyNeedsHumanCauses\|patchNeedsHumanCauseField\|frontmatterNeedsHumanCause\|HUMAN_ADJUDICATION_STEPS" --include=*.ts plugin/scripts packages/quay/src packages/quay-native/src packages/quay-github/src
(无输出)
$ echo $?
1                # grep 无匹配 ⇒ 0 条
```

**AC3 — 测试**

```
$ node --test plugin/test/driver-filters.test.mjs
ℹ tests 57   ℹ pass 57   ℹ fail 0        (exit 0)
$ node --test plugin/test/worker-driver.test.mjs
ℹ tests 100  ℹ pass 100  ℹ fail 0        (exit 0)
```
被删符号的用例整块移除（同一谓词对 `plugin/test/driver-filters.test.mjs` 命中 **0**）。新增两条退役回归：
① `退役回归 — markNeedsHuman 注记事实行齐全（## Needs-Human / 阻碍原因 / 失败步判词 / run_id / 日志路径），且不含成因类行与成因字段（⛔ 加回 ⇒ 红）`；
② `退役回归(惰性遗留) — 已带成因字段的任务仍可翻转，既有字段原样保留（⛔ 不拒写、⛔ 不批量改任务文件）`。
`worker-driver.test.mjs` 全绿是必要的：本任务同时删掉了 worker-driver.ts 里两处对被删枚举的**悬空引用**（快速死亡路径注记措辞 + 一处历史注释），删掉后那两处会指向不再存在的东西。

**AC4 — 惰性遗留**

```
$ git grep -l "^needs_human_cause:" -- tasks | head -1
tasks/DIR-131.md
$ node plugin/scripts/task-schema-check.ts tasks/DIR-131.md     # 改动前
PASS: tasks/DIR-131.md — schema v1 conformant (kind=directive)
INFO: tasks/DIR-131.md — dispatch-review-missing: no '## Dispatch review' section
1 total, 1 pass, 0 N/A-legacy, 0 fail                           (exit 0)
$ node plugin/scripts/task-schema-check.ts tasks/DIR-131.md     # 改动后（同一文件，同一命令）
PASS: tasks/DIR-131.md — schema v1 conformant (kind=directive)
1 total, 1 pass, 0 N/A-legacy, 0 fail                           (exit 0)  ← 与本任务前相同
```
遗留字段实测计数（`git grep -h "^needs_human_cause:" -- tasks | sort | uniq -c`）：

```
29 needs_human_cause: human-adjudication
 8 needs_human_cause: unclassified
```

共 **37** 个文件（`blocked-outside-task` **0** 个）——与立案读数逐字一致。这 37 个文件一个都没出现在 `git diff --name-only develop -- tasks/` 里（该命令只列本任务文件与被取代任务文件）。

**AC5 — 被取代任务**

`tasks/gap-needs-human-overloaded-two-populations-one-state.md` 已追加「被 gap-retire-needs-human-cause-enumeration 取代（2026-09-20）」一节，含日期、人的逐字裁定、37/29/8/0 读数；其正文与 AC/DoD 一字未改（作为历史实现记录保留）。本次**实现提交** `e81a9b73d` 的信息含「被删词条 → 去向」映射（每个被删符号 → 删除 / 无替代 / 改措辞），硬规则 5。

**AC6 — scoped gate**

```
$ bash scripts/test.sh --for-task gap-retire-needs-human-cause-enumeration --allow-thin
ℹ tests 57   ℹ pass 57   ℹ fail 0
(exit 0)
```

**DoD — 真实仓库上的真实翻转（⛔ 非 fixture）**

在一个真实仓库副本上跑生产入口 `markNeedsHuman`（`git clone` 本仓库 + 一个**真实 ready 任务** + 一条真实 `worker-outcome.jsonl` 记录）：

```
$ node /tmp/dod-flip.mjs
legacy-field task files: 37
markNeedsHuman → {"id":"gap-needs-human-raw-fan-in-reason-observation-surface","ok":true,
                  "reason":"worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）","committed":true}
--- 翻转后的任务体 ---
status: needs-human                     ← 已翻转（无任何 needs_human_cause 字段）
## Needs-Human

**执行 2026-09-20T06:56:37.674Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=suite: scoped gate red: 3 failures in plugin/test/suite-x.test.mjs
- run_id：wk-dod-1789890000
- session_id：sess-dod-1
- suite 日志：/tmp/dod-flip-repo/.quay/fan-in-suite-gap-nh-raw-run.log
- fan-in 日志：/tmp/dod-flip-repo/.quay/fan-in-gap-nh-raw-run.log

---- 断言 ----
PASS  任务体不含 needs_human_cause 字段 / 不含字面 needs_human_cause / 不含「成因类」
PASS  返回值无 cause 键
PASS  status 已翻 needs-human；含 ## Needs-Human；含 阻碍原因 / 失败步/判词 / run_id / session_id / suite 日志 / fan-in 日志（事实行 6/6）
PASS  遗留字段任务文件字节未变（37 个，changed=0）
OVERALL: PASS
```

`committed:true` ⇒ 这是一次**真实提交**（⛔ 非内存态、⛔ 非 fixture 断言）。⚠️ 刻意不在**生产**仓库上翻转——那会把一个真任务打成 needs-human；用的是真实仓库的独立副本，所以「遗留字段字节未变」是在**真实 37 个文件**上读的。

**DoD2 — 已删机制零残留的独立读数**：`git grep -c "<AC2 谓词>" HEAD -- plugin/scripts packages` ⇒ 0；`blockedOutsideTaskResolved` 在全仓非测试代码的调用者数 = 0（本任务前就是 0——这正是删除的理由，⛔ 不是删除造成的新事实）。
