---
id: gap-fan-in-ff-protocol-check-false-positive-task-branch-merge
title: fan-in-ff-protocol-check 判据2a 误判 task/ 特性分支 merge 进 main/manager-doc 为非-ff fan-in（regex 不区分目标分支）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`fan-in-ff-protocol-check.ts` 判据2a 的 regex `FAN_IN_MERGE_SUBJECT_RE = /\bmerge: fan-in |Merge (remote-tracking )?branch 'task\//i` 的第二替代 `Merge … branch 'task/` 匹配**任何**「Merge branch 'task/…'」提交，**不区分目标分支**。commit `58eaaa2d0`（`Merge branch 'task/quay-file-task-skill' into main/manager-doc`，2 父 9fb23e1fd+e259728d7，14:15:07Z）是合法特性/skill 分支 merge 进 **main/manager-doc**（doc 分支），经 doc→develop 同步带到 develop，被误判为非-ff fan-in ⇒ 判据2a RED，14:15Z 起**确定性挡所有 fan-in**。

**根因**：fan-in ff 协议约束的是 **develop** 历史（fan-in 的 ff-merge 目标是 develop），而 `58eaaa2d0` 的目标是 **main/manager-doc**（doc 分支特性合并）。两者提交信息都含 `branch 'task/`，regex 只匹配前缀不匹配「into <目标分支>」⇒ 分不开。

**⛔ 死锁（修复须直落 develop，不能走 fan-in）**：本 checker 在机械 fan-in 的 gate 链里从主检出（未修代码）跑——「修 checker」的任务走 fan-in 会撞同一个未修 checker，修不进去。修复须**绕过 fan-in 直落 develop**（需人授权）。

## Plan

三选一（推荐①根因）：
1. **收紧 regex（根因）**：判据2a 只查「merge 进 develop」——regex 改 `Merge (remote-tracking )?branch 'task\/[^']*' into develop`（或排除 `into main/manager-doc`）。
2. **advance baseline（停药）**：`runner-static-gate.ts:522` `--baseline 19fea6f0` 前推到 58eaaa2d0 之后（跳过误判，regex 假阳性仍在）。
3. **linearize develop**：⛔ 不推荐（改写共享历史）。

验证：`fan-in-ff-protocol-check.ts --root /home/yale/work/quay --baseline 19fea6f0 --json` → ok:true（58eaaa2d0 不触发）；负控制：真非-ff fan-in（merge task 分支进 develop）仍触发。

## Acceptance Criteria

- [ ] AC1（能取假）：`58eaaa2d0`（Merge task 分支进 main/manager-doc）不再触发判据2a——check ok:true；（⛔ 仍 RED ⇒ 假）。
- [ ] AC2（能取假，负控制）：构造真非-ff fan-in（merge task 分支进 develop）仍触发判据2a；（⛔ 误放行 ⇒ 假）。

## Definition of Done

判据2a 区分目标分支（只查 merge 进 develop）；AC1/AC2 勾；check 对 58eaaa2d0 ok:true；真 fan-in 仍触发；全量 suite 绿；fan-in 解除阻塞。

## Touches

- plugin/scripts/fan-in-ff-protocol-check.ts（判据2a regex 收紧目标分支）
- plugin/test/fan-in-ff-protocol-check.test.mjs（负控制：main/manager-doc 特性合并不触发、真 fan-in 触发）
- tasks/gap-fan-in-ff-protocol-check-false-positive-task-branch-merge.md（自身）
