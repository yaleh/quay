---
id: gap-direct-to-develop-check-reflog-to-revlist
title: direct-to-develop-bypass-check ground truth 从 reflog 改 rev-list/DAG
status: needs-human
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：manager 裁定（机制缺陷，⛔ 非某任务回归）。develop reflog 被全局修剪（剩 1 条，master=0/HEAD=1，同一秒清零、无 gc.log、无 expire 配置、排除自身脚本）⇒ `direct-to-develop-bypass-check` 的 ground truth `git log -g develop`（reflog）失去全部历史直投记录 ⇒ AC3 测试 cddc55e2 不在候选。

**架构性理由（⛔ 不是「这次巧合」）**：该 check 判的是「这个 commit 是不是绕过 fan-in 直接落 develop」——**这个判据可以完全不依赖 reflog**：fan-in 落地的提交是**合并提交**（`git rev-list --parents` 父数 ≥2），绕过路径落的是**单父提交**直接出现在 develop 历史。单父/双父来自 commit 对象本身（DAG 结构），提交时刻永久写死，⛔ 不随本地 reflog 存续而变。reflog 是本地可被 gc/expire 清空的操作日志，rev-list 读对象库不可变 DAG——硬规则 4b「别用易失代理量当真相源」教科书应用。

## Plan

1. `direct-to-develop-bypass-check` 的 ground truth 从 `git log -g develop`（reflog action）改为 `git rev-list --parents develop`（父提交数判定：合并 ≥2 父 = fan-in 落、单父 = 直接落）。
2. AC3 的历史直投样本（cddc55e2 等）在新实现下仍可枚举（能取假）。

## Acceptance Criteria

- [ ] AC1（ground truth 改 DAG）：check 改用 `git rev-list --parents develop` 判父提交数（合并 ≥2 = fan-in 落、单父 = 直接落），⛔ 不再依赖 reflog。
- [ ] AC2（能取假）：AC3 的历史直投样本（cddc55e2 等）在新实现下仍可枚举到（报 RED，⛔ 因 reflog 剪而漏报 ⇒ 假）。

## Definition of Done

- [ ] ground truth 改 rev-list/DAG + 历史直投样本仍可枚举；AC1-2 全勾；land 到 develop。

## Retires

- reflog 作为 direct-to-develop 判定 ground truth 的用途

## Touches

- plugin/scripts/direct-to-develop-bypass-check.ts（ground truth reflog → rev-list --parents）
- plugin/test/direct-to-develop-bypass-check.test.mjs（AC3 样本在新实现下仍 RED）
- tasks/gap-direct-to-develop-check-reflog-to-revlist.md（自身）

## Worker 判定（2026-08-23 — premise broken，退回 needs-human）

Proposal 前提「fan-in 落地的提交是合并提交（父数 ≥2）」是事实错误：fan-in 持锁段是 `git merge --ff-only task/<id>`（fan-in-ff-merge.sh），只移 ref、不建 commit——fan-in 落地的 task 提交在 DAG 上与直投完全一样（单父线性链），这正是检测器当初选 reflog 当 ground truth 的原因（direct-to-develop-bypass-check.ts 头注释 :14-19 已写明）。

**负控制**（若前提为真，以下都不会成立）：
1. `9a074ff1`（worker-driver 实现，触 plugin/scripts/worker-driver.ts）单父（父=25eff436）、经 reflog `merge task/gap-worker-driver-no-record-on-abnormal-death: Fast-forward` 落地，该次 fan-in 无任何 merge commit；`90329c7d`（翻 done）亦单父。
2. develop 最近 300 提交：240 单父、其中 41 触代码面，几乎全是 fan-in 落地的 task 提交（worker-driver/promotion-driver/…）——「单父=直投」会把这 41 条全误红。
3. 现有测试 `CLI — fan-in ff 落地不误报`（direct-to-develop-bypass-check.test.mjs :698）已断言「ff 落地不计入 direct」，按 Proposal 实现该测试必红。

**真正缺陷成立但修法要重选**：reflog 被 gc 全局剪 ⇒ 全量扫描路径（`gitReflogDirectCommits`）失能（test :591 被 skip 的根因）。可行修法：(a) fan-in 改 `--no-ff`（每次都建 merge commit，父数判定才成立，动机制面大）；(b) 直投改记持久化台账（git 提交 ledger，同 lock-events 模式）；(c) 防 reflog 剪（`gc.reflogExpire` / reflog 快照 ledger）。均非本任务 Plan 所述。等 manager 重定范围。
