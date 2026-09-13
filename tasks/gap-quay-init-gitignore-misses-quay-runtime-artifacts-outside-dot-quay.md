---
id: gap-quay-init-gitignore-misses-quay-runtime-artifacts-outside-dot-quay
title: quay-init 的 .gitignore 只覆盖 .quay/，遗漏 quay 自己写到别处的运行时产物 —— 污染工作树后 fan-in 的
  ff 永久失败
status: todo
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**后果先说（已实际发生）**：第三方项目 quay-fleet 的一条任务，fan-in 一路走到
`anti-drift-land → ac-gate → flip-done`、suite 55/55 全绿，**最后卡死在 `ff` 步骤**：

```
step=ff exit=2 reason="fan-in-ff-merge: working tree not clean in /home/yale/work/quay-fleet
  ?? milestones/
  ?? tasks/.quay-parse-cache.json"
```

⇒ **实现完全正确、验收全绿的任务，因为两个 quay 自己写出来的文件而永远落不了地。**
而且错误信息只说「working tree not clean」，**不指向 quay 自己是那两个文件的作者**，
排查者会先去怀疑自己的改动。

**根因：init 的忽略清单只覆盖了 `.quay/` 这一处运行时状态。** 实测对照：

```
quay-init 写给第三方项目的 .gitignore（quay 贡献的全部内容）：
    .quay/*
    !.quay/config.yml
    !.quay/profiles.yml

quay 自己的 .gitignore 另有（且带解释性注释，说明 quay 明知它们是运行时产物）：
    :471  # persistent parse cache — a runtime derived artifact written to <tasksDir>/.quay-parse-cache.json
    :476  **/.quay-parse-cache.json
    :449  milestones/fast-mode-telemetry/*.json
```

**`tasks/.quay-parse-cache.json` 的要害在于它写在 `tasksDir` 下、不在 `.quay/` 下**，
所以 `.quay/*` 这条规则覆盖不到它。而它由 quay 自己的**读**路径写出——
`task_list` / `task_get`，以及 fan-in 自己的 `ac-precheck` / `anti-drift` 步骤都会碰它。
⇒ **只要 quay 读过一次任务台账，第三方项目的工作树就脏了，此后每一条任务的 ff 都会失败。**
这不是某一条任务的问题，是**装了 quay 就注定发生**。

**这是「双副本漂移」的又一实例**：quay 自己的 `.gitignore` 里那份清单是真相源，
init 模板是它的一份人工同步副本，而副本落后了。同工作区已知同形：
「修了一个副本、生产用的是另一个」。

## Plan

1. **让 init 的忽略清单从 quay 自己的 `.gitignore` 派生，而不是人工重列**：
   把 quay 的 `.gitignore` 里标注为「quay 运行时产物」的条目做成一份**可被两边共同消费的清单**
   （单一真相源），init 读它生成；⛔ 不接受"再手工补两行"——那只修了被报出来的那一个实例（硬规则 5b）。
2. 至少立即覆盖已知的两条：`**/.quay-parse-cache.json`、`milestones/fast-mode-telemetry/*.json`。
3. **加一条防漂移静态检查**：quay 自己 `.gitignore` 中标记为运行时产物的条目集合，
   必须被 init 写出的忽略清单覆盖；新增一条而 init 未跟进 ⇒ 红。
4. **顺带收紧错误信息**（可选但高价值）：`fan-in-ff-merge` 报「working tree not clean」时，
   若脏文件命中 quay 自己的运行时产物清单，应在 reason 里点明「这是 quay 运行时写的，
   应加入 .gitignore」，而不是让排查者去怀疑自己的改动。

## Acceptance Criteria

- [ ] AC1（负控制，改前必须红）：在干净临时目录跑一次真 `quay-init`，改前其 `.gitignore`
      **不含** `.quay-parse-cache.json`；改后包含。同样断言 `milestones/fast-mode-telemetry`。
- [ ] AC2（后果级，端到端）：在该临时项目里跑一次会写 parse-cache 的 quay 命令
      （如 `quay task list`），改前 `git status --porcelain` **非空**且含 `tasks/.quay-parse-cache.json`；
      改后为**空**。这条是本缺陷的真实后果，⛔ 不要只断言文件内容。
- [ ] AC3（防漂移，结构性）：静态检查比对「quay 自己 `.gitignore` 中标为运行时产物的条目集」
      与「init 写出的忽略清单」，前者未被后者覆盖即红。双向控制：给 quay 的 `.gitignore`
      加一条新的运行时条目而 init 未跟进 ⇒ 必须红；两边一致 ⇒ 绿。
- [ ] AC4：全量 `scripts/test.sh` 绿。

## Definition of Done

在一个**真实的第三方项目**上（非 fixture）：跑完一轮 `quay task list` 后 `git status --porcelain` 为空，
且一条任务的 fan-in 能走完 `ff` 步骤而不因 quay 自身运行时产物失败。
fixture 满足不算数（硬规则 4 推论三）。

## Touches

- plugin/scripts/quay-init.sh
- plugin/scripts/gitignore-runtime-coverage-check.ts
- plugin/test/gitignore-runtime-coverage-check.test.mjs
- tasks/gap-quay-init-gitignore-misses-quay-runtime-artifacts-outside-dot-quay.md
