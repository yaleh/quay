---
id: gap-direct-to-develop-check-reflog-to-revlist
title: direct-to-develop-bypass-check 直投判定改持久化 ledger（fan-in ff 落地记台账，reflog 剪后退 NOT-EVALUATED）
status: ready
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

**来源**：manager 2026-08-23 裁定方案(b)（原「ground truth 改 rev-list/DAG」被 worker 证伪前提后重定范围）。

**真缺陷（成立）**：develop reflog 被 gc 全局剪 ⇒ `direct-to-develop-bypass-check` 的全量扫描路径（`gitReflogDirectCommits`）失能（test :591 被 skip 的根因）——历史直投记录丢失后，checker 无法枚举。

**⛔ 原前提证伪（worker retreat 正确）**：原 Proposal 假设「fan-in 落地 = 合并提交（父数 ≥2）、绕过 = 单父」是事实错误——fan-in 持锁段是 `git merge --ff-only task/<id>`（fan-in-ff-merge.sh），只移 ref 不建 commit，fan-in 落地的 task 提交在 DAG 上与直投**同形（单父线性链）**。实测：`9a074ff1`（单父）经 reflog `Fast-forward` 落地、`90329c7d`（单父）——「单父=直投」会把 develop 上 41 条代码面提交（几乎全 fan-in 落地）全误红；且 `direct-to-develop-bypass-check.ts` 自己的判据是 **reflog action 标签**（`commit:` vs `merge task/<id>: Fast-forward`，:14/:459），从未依赖 DAG 形状——所以「rev-list/DAG 判父数」从一开始就和已验证机制原理不一致。

**方案(b)（manager 裁定，⛔ 不新造机制、复用已有的那一个）**：
- **否决 (a)**（fan-in 改 `--no-ff`）：改变全部未来 fan-in 的 DAG 形状是大范围机制面改动，且不解决「过去已 ff 落地、reflog 已被剪」的历史（本任务原始动机），还连带影响依赖「fan-in=ff-only 线性」假设的地方。
- **否决 (c)**（防 reflog 剪/定期快照）：`git config` 防剪脆弱（可被 `git gc --prune=now`/重 clone 绕过）；定期快照有窗口期（快照间隔内产生又被剪的条目仍丢），非零 gap。
- **(b) 取胜**：`fan-in-ff-merge.sh` **已经在用同款机制**——`.quay/fan-in-merge-lock-events.jsonl`，事件发生当下就 append、不依赖任何后续可被回收的易失状态。复用这个 append 时机与写入路径。

**⊢ 附带观察（写进 Proposal 留给以后，⛔ 本任务不要求改）**：这个 ledger 未来也应成为 `direct-to-develop-bypass-check.ts` 自己的备用信源——它现在完全依赖 reflog，早晚会撞「老 commit 的 reflog 条目过期」同一个问题。

## Plan

1. `fan-in-ff-merge.sh` 每次真实 ff 落地时，**复用现有 append 时机与写入路径**，往 `.quay/fan-in-merge-lock-events.jsonl` 记一条「commit `<sha>` 是 fan-in 落地」的持久化事实（⛔ 不另起新 jsonl；新字段或姊妹记录均可，落点由实现方定，但必须同一文件同一 append）。
2. `direct-to-develop-bypass-check.ts` 检测逻辑改为三态：rev-list 全量扫描 develop 历史 → 对每条命中的 commit 查这个 ledger——**在 ledger 里 ⇒ 判定 fan-in 落地、不算直投**；不在 ledger 里 ⇒ 走原有 reflog 判定（reflog 还在的话）；reflog 也不在 ⇒ **保持 NOT-EVALUATED 诚实标注，⛔ 不伪装成「未发现 direct」**。

## Acceptance Criteria

- [ ] AC1（ledger 写入，能取假）：fan-in 真实 ff 落地后，`fan-in-merge-lock-events.jsonl` 记了该 commit 的「fan-in 落地」事实；⛔ ff 落地后 ledger 无对应记录 ⇒ 假。
- [ ] AC2（ledger 判定，能取假）：rev-list 命中的 commit 在 ledger 里 ⇒ 判 fan-in 落地不算直投（不报 RED）；不在 ledger 里且 reflog 有「直接 commit」标签 ⇒ 报 RED（真直投仍红）。
- [ ] AC3（NOT-EVALUATED 诚实）：ledger 无记录且 reflog 也查不到 ⇒ 判 NOT-EVALUATED（⛔ 不伪装成「未发现 direct」——硬规则 3b）。

## Definition of Done

- [ ] fan-in ff 落地记持久化 ledger + checker 三态判定（ledger → reflog 回退 → NOT-EVALUATED）落地；AC1-3 全勾；land 到 develop。

## Retires

- reflog 作为 direct-to-develop 判定【唯一】ground truth 的用途（降为 ledger 之后的回退信源）

## Touches

- plugin/scripts/fan-in-ff-merge.sh（真实 ff 落地时往 fan-in-merge-lock-events.jsonl 记「fan-in 落地」事实）
- plugin/scripts/direct-to-develop-bypass-check.ts（检测逻辑改三态：ledger → reflog 回退 → NOT-EVALUATED）
- plugin/test/fan-in-ff-merge.test.mjs（test：ff 落地记 ledger）
- plugin/test/direct-to-develop-bypass-check.test.mjs（test：ledger 判定 + NOT-EVALUATED）
- tasks/gap-direct-to-develop-check-reflog-to-revlist.md（自身）
