---
id: gap-retire-needs-human-cause-enumeration
title: 退役 needs_human_cause 三态枚举与 blockedOutsideTaskResolved——零读者、零
  blocked-outside-task 样本，needs-human 的原因是异常，不该用枚举做逻辑控制
status: todo
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

- [ ] 删除前干跑谓词：`git grep -c "needs_human_cause\|NEEDS_HUMAN_CAUSE\|classifyNeedsHumanCause\|blockedOutsideTaskResolved\|tallyNeedsHumanCauses\|patchNeedsHumanCauseField\|frontmatterNeedsHumanCause\|HUMAN_ADJUDICATION_STEPS" <删除前的 develop 提交> -- plugin/scripts/driver-filters.ts` 命中 ≥1（证明谓词能命中真样本）。
- [ ] 删除后同一谓词对 `plugin/scripts packages/*/src` 下非测试 `.ts` 命中 0 条（贴出命令与输出）。
- [ ] `node --test plugin/test/driver-filters.test.mjs` exit 0，且其中不再有引用被删符号的用例；新增/保留一条用例断言 `markNeedsHuman` 写出的任务体仍含 `## Needs-Human`、阻碍原因、失败步/判词、run_id、日志路径行，且**不含**「成因类」与 `needs_human_cause`（回归对照）。
- [ ] 惰性遗留：对一个磁盘上已带 `needs_human_cause: human-adjudication` 的任务（如取自 `git grep -l "^needs_human_cause:" -- tasks | head -1`）运行 `node plugin/scripts/task-schema-check.ts <该文件>`，退出码与本任务前相同（读数贴出），且 `git diff --name-only develop -- tasks/` 只含本任务文件与被取代任务文件。
- [ ] 被取代任务 `gap-needs-human-overloaded-two-populations-one-state` 的任务体追加一节「被 <本任务 id> 取代」（含日期、人的逐字裁定、37/29/8/0 读数）；本任务提交信息含「被删词条 → 去向」映射（每个被删符号的去向：删除 / 无替代），硬规则 5。
- [ ] `scripts/test.sh --for-task gap-retire-needs-human-cause-enumeration` exit 0。

## DoD

在真实仓库上，`markNeedsHuman` 对一个真实 ready 任务翻转后，任务文件不含 `needs_human_cause`，注记事实行齐全；全仓非测试代码对被删符号零引用；已有 37 个遗留字段任务文件字节未变。不引入任何替代枚举或再入队路径。

## Touches

- plugin/scripts/driver-filters.ts
- plugin/test/driver-filters.test.mjs
- tasks/gap-needs-human-overloaded-two-populations-one-state.md
- tasks/gap-retire-needs-human-cause-enumeration.md
