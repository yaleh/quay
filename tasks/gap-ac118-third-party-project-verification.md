---
id: gap-ac118-third-party-project-verification
title: "AC118 第三方项目验证：用当前版本真实驱动 archguard/meta-cc，补回 AC16②/AC88 收窄掉的要求"
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：人 2026-08-20 14:0xZ 裁定「在这次发布里补回这条」——AC16② 要求「B/C 用真实第三方项目（archguard/meta-cc）做接受方，防亲代环境掩盖亲代缺陷」，该要求 08-16 被 AC88 静默收窄成「quay-init 自建演示任务（INNER-1/QX-001）」，无人裁定支撑这次收窄。现补回。

**背景**：在 quay 自己仓库上测自己，测到的是「开发树还在不在」这种结构上不可能为假的绿。只有在一个 quay 团队不定制的项目上跑，author→ready 闸、任务生命周期这些机制才可能真的暴露问题。当年实测强度：archguard 上真跑 61 任务、28 条逐条核实从 `todo` 起始走完 author→ready 闸→done，8 小时、3 处真实产品代码变更。

**判据**（完整原文在 orchestration/manager-phase-goal.md AC118，本任务体不复制）：
1. 目标项目 `.quay/config.yml` 的 `default_task_status` **不得为 `ready`**（历史坑：该配置让 `todo` 从不出现）
2. 安装源 = 本阶段 AC105/AC107 产出的**当前版本** tgz，驱动该第三方项目自己的代码/任务板
3. ≥3 条该项目任务 `git log --diff-filter=A` 可查**首次入库状态为 `todo`**、走过真实 author→ready 闸、翻到 `done`
4. 这些任务在该项目自己的仓库里有**真实非 doc-only 产品代码提交**（`git show --stat` 可核）
5. 验证时刻新于 2026-08-20，不接受引用历史 61 任务记录充数

**目标项目**：archguard 或 meta-cc（二选一）。**主机**：B=orangevps 或 C=ad-arm1（**不得用 A**——亲代环境无法验证自己）。

**⛔ 前置依赖**：本任务需要 AC104（版本 bump 0.6.0）→ AC105（build 当前 tgz）→ AC107（跨主机机制化安装）完成后的当前版本产物。这些未完成前本任务无法执行。

## Plan

1. **前置确认**：AC104/105/107 完成后（当前版本 tgz + commit sha + 产物 sha256），在目标主机（B/C）的干净目录全新安装。
2. **核实 default_task_status**：目标项目 `.quay/config.yml` 的 `default_task_status` 非 `ready`（显式核实，历史坑）。
3. **驱动 3+ 任务走完整生命周期**：在该第三方项目上建立任务，从 `todo` 起始、过 author→ready 闸、到 `done`，每个任务带真实非 doc-only 产品代码提交。
4. **验证记录**：每个任务的 `git log --diff-filter=A` 首次入库状态 = `todo`，最终 status = `done`，`git show --stat` 有真实产品代码。
5. **写记录**：`.quay/productization-verification.jsonl`，`ac="AC118"`，含目标项目名 / 任务 id 列表 / 各任务 commit sha。

## Acceptance Criteria

- [ ] AC1: 目标项目 `.quay/config.yml` 的 `default_task_status` 显式核实非 `ready`（不能是 `ready`，否则 todo 从不出现）。
- [ ] AC2: 安装源 = 本阶段 AC105/AC107 产出的当前版本 tgz（记录 commit sha + 产物 sha256，非历史产物）。
- [ ] AC3: ≥3 条该项目任务 `git log --diff-filter=A` 可查首次入库状态为 `todo`，走过 author→ready 闸，最终 `done`。
- [ ] AC4: 这些任务在该项目自己的仓库有真实非 doc-only 产品代码提交（`git show --stat` 可核）。
- [ ] AC5: 验证时刻新于 2026-08-20（不引用 08-06/08-12 历史记录）；记录写入 `.quay/productization-verification.jsonl`（`ac="AC118"`，含项目名/任务 id 列表/commit sha）。

## Definition of Done

- [ ] 判据 1-5 全满足；`.quay/productization-verification.jsonl` 有 `ac="AC118"` 记录；若发现真实缺陷（数据形状差异等）按缺陷处置立案，不为了勾 AC 回避。

## Touches

- .quay/productization-verification.jsonl（记录）
- 目标第三方项目（archguard 或 meta-cc）的任务板 + 产品代码（该主机 B/C 上，非本仓库）
- tasks/gap-ac118-third-party-project-verification.md（自身）
