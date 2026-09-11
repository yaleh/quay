---
id: gap-ac207-commit-sha-points-at-bookkeeping-flip-not-implementation-commit
title: AC-207 记录的 commit_sha 指向「翻 done」记账提交而非实现提交，而判据只查该字段非空 ⇒ 一个零实现、只有记账提交的项目同样能让它通过
status: todo
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-207
---
## Proposal

**背景（本条不否定 AC-207 的达成）**：AC-207 已于 2026-09-11T01:21:19Z 产出首条记录并转 achieved，**其端到端场景经 ssh 外部核实为真**——远端项目 `/home/yale/quay-verify-coldstart-a2a5aac0-root`（orangevps，非本机、非本仓库）里，由该项目**自己的 drivers** 完成了全链：

```
86fc16f  chore(quay-init): initialize quay project files (plugin v0.6.1)
06e48e4  tasks: e2e-verify-207 todo→ready（promotion-driver 机械晋升）
12899cd  feat(e2e-verify-207): add e2e-marker.txt marker (ac207)   ← 真实实现提交（+1 行；已在 develop 与 main；文件实际存在于工作树）
7779407  tasks: 翻 e2e-verify-207 done（driver 机械 fan-in）
.quay/gate-events.jsonl = 1 条
```

**缺陷**：落进载体的那条记录，其 `commit_sha` 是 **`77794075…`（上表最后一行，「翻 done」的记账提交，改动为 `tasks/e2e-verify-207.md | 2 +-`）**，而**不是**实现提交 `12899cd`（`e2e-marker.txt | 1 +`）。

完整记录逐字：

```json
{"build_sha":"a2a5aac0366f74d2a3af509664ab8cc9046aa83d","ts":"2026-09-11T01:21:19Z",
 "ac":"GOAL-009-AC-207","host":"orangevps",
 "project_root":"/home/yale/quay-verify-coldstart-a2a5aac0-root",
 "commit_sha":"77794075008c776d289539111f73b422d1bb03e3",
 "task_id":"e2e-verify-207","task_status":"done","gate_events":1,"produced_by_driver":true}
```

**为什么这是缺陷而不只是「选错了一条」**：`goals/AC-207-*.md` 的 criterion 对该字段只要求**非空**（`commit_sha/task_id 非空`）。⇒ **一个 quay-init 之后只发生了任务状态翻转、零实现提交的项目，同样会写出非空的 `commit_sha` 并让判据 exit 0。** 而 GOAL-009 的退出条件逐字要的是「在该项目自身的 git 历史里留下**可核的开发提交**」——**该字段没有承载这个性质**（硬规则 4b：代理量与它要代表的东西脱节；硬规则 4：一个不能区分两种情形的量，对这两种情形而言不是测量）。

任务体原文也点名了这一点：「`commit_sha` = 第三方项目 `git log`（**任务 worktree 提交**）」、「产生**实现提交**（⛔ 排除 `chore(quay-init):` auto-commit）」。当前实现只排除了 `chore(quay-init):` 这一种，**没有排除 driver 自己的记账提交**（`tasks: 翻 … done`／`tasks: … todo→ready`／`tasks: … task_write by cli:…`／`goals: … create by cli:…`）——而这些在一次 e2e 里恰恰是**多数**（9 条提交里 7 条是记账类）。

## Plan

1. **让写入点选对提交**：`verify-deliver-coldstart.sh` 的 AC-207 段在取 `commit_sha` 时，从第三方项目 git 历史中筛出**非记账提交**——排除的前缀集合至少含 `chore(quay-init):`、`tasks: `、`goals: `（前两类是 driver/Provider ABI 的机械提交，第三类是 goal 记录写入）。⛔ 不要用「取最新一条」——本缺陷正是这么来的。
2. **判据同步收紧**：`goals/AC-207-*.md` 的 criterion 增加一条——记录须另带一个可区分字段（如 `impl_commit_sha` 或 `commit_is_implementation: true`），或 `commit_sha` 必须满足「其 `git show --stat` 触及的文件不全在 `tasks/`、`goals/`、`.quay/` 之下」。⛔ 仅改写入点而不收紧判据 ⇒ 下次换个写法又能绕过。
3. **fail-closed**：筛不出任何非记账提交 ⇒ **不写记录**并留可区分痕迹（硬规则 3b），⛔ 不得退化成写记账提交充数。

## Acceptance Criteria

- [ ] AC1 缺陷存证（改前读数）：贴现有那条 AC-207 记录全文，以及远端 `git show --stat` 两条对照——`77794075`（改 `tasks/e2e-verify-207.md`）与 `12899cd`（改 `e2e-marker.txt`），说明前者是记账提交。
- [ ] AC2 写入点选对（能取假）：改后在一次真实跨机 e2e 中，记录的 `commit_sha` 指向**实现提交**；贴该 sha 与其 `git show --stat`（触及的文件不在 `tasks/`/`goals/`/`.quay/` 下）。
- [ ] AC3 负控制：构造一个「只有记账提交、无实现提交」的第三方项目状态 ⇒ 该步**不写记录**且留下可区分痕迹（非静默、非写记账提交充数）；贴输出与载体行数不变的前后读数。
- [ ] AC4 判据已收紧（能取假）：把一条 `commit_sha` 指向记账提交的记录注入载体 ⇒ AC-207 criterion **仍 exit 1**；换成指向实现提交的记录 ⇒ exit 0。贴两次干跑输出；验证后移除注入记录、不污染生产载体。
- [ ] AC5 既有达成不被推翻：收紧后用**同一次真实运行**的实现提交补一条合规记录 ⇒ AC-207 criterion exit 0；贴记录与干跑输出。⛔ 不得为了让判据过而放宽 AC4 的负控制。
- [ ] AC6 全量绿：`scripts/test.sh` 全量绿。

## Definition of Done

AC-207 的记录 `commit_sha`（或新增的实现提交字段）指向一条**触及非记账路径**的提交，且判据能对「只有记账提交」取假；筛不出实现提交时 fail-closed 且留痕。⛔ 把判据放宽成「非空即可」⇒ 不算达成（那正是本缺陷）；⛔ 把记账提交改名绕过前缀过滤 ⇒ 不算达成（判据要看**触及的文件**，不是提交信息文本，硬规则②按位置不按关键词）。

## Touches

- plugin/scripts/verify-deliver-coldstart.sh
- packages/quay/plugin/scripts/verify-deliver-coldstart.sh
- plugin/test/verify-deliver-coldstart.test.mjs
- goals/AC-207-端到端-目标项目自己的-drivers-驱动出真实开发提交且任务翻-done.md
- tasks/gap-ac207-commit-sha-points-at-bookkeeping-flip-not-implementation-commit.md
