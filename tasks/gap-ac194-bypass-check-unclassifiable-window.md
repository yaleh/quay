---
id: gap-ac194-bypass-check-unclassifiable-window
title: AC-194 判据恒 fail：direct-to-develop-bypass-check 对 develop~100 窗 449/721
  提交不可分类（reflog 只记 ff tip）⇒ NOT-EVALUATED fail-closed；改 first-parent 扫描 + reflog
  括注分类使判据可评估 exit 0 且真直投仍红
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-194
---
## Proposal

正本：`goals/AC-194-no-direct-to-develop-bypass.md`（判据）+ `goals/GOAL-007-done-fixture.md`（三例之③）。

AC-194 判据当前取假（2026-09-07 干跑）：`node packages/quay/src/goal-store.ts gate AC-194` → `verdict: fail`（exit 1）。同判据底下的 checker `direct-to-develop-bypass-check.ts --root . --baseline develop~100 --json` 退出码 **3**（NOT-EVALUATED）：`reason: "unclassifiable-commits-in-range"`、`unclassifiableCommits: 449 / total: 721`、`classification.ratio: 0.377`、`totalDirectCommits: 0`、`candidates: []`。

不是「保证被违反」（零直投），是「判据读不懂输入」：checker 三态分类 `classifyLandingMode`（ledger → reflog direct → reflog seen → unclassifiable）依赖 develop reflog 作唯一 ground truth，而 reflog 有两个结构性缺口——① ff-merge 只在 reflog 记 tip：`git merge --ff-only` 只前移 ref、不建 commit，reflog 只记「merge task/<id>: Fast-forward」一条（tip sha），分支上被并入的中间 commit 各自无独立 reflog 条目；② reflog 深度有限（被 gc 剪）。实测：develop reflog 2016 条，`rev-list develop~100..develop` 全 DAG 721 条，其中 first-parent spine 仅 100 条、off-spine 621 条，spine 里也仅 66 个有 reflog 条目（34 个中间 commit 无）。两者叠加 ⇒ develop~100 窗 62% 不可分类 ⇒ 硬规则③b fail-closed ⇒ AC-194 `expect: exit 0` 结构上不可达。

`gap-direct-to-develop-check-reflog-to-revlist`（done）建了 ledger 但只记 ff tip、未覆盖中间 commit，且其 Proposal 已留「这个 ledger 未来也应成为 checker 自己的备用信源——它现在完全依赖 reflog，早晚会撞同一个问题」的注记；`gap-bypass-check-unclassifiable-exits-zero`（done）只把「读不懂 exit 0」改成 exit 3、未补分类覆盖。两者都不修本缺陷。人已裁定【丁：不修，上移 goal 层】，AC-194 正是承载「无直投 develop」保证的 goal AC——但它现在对整窗 NOT-EVALUATED，等于没测到保证。本任务把 checker 分类补齐到整窗可评估，不碰 fan-in 机制、不建新机件、不放松 fail-closed。

方向（机制，非手搓）：直投 commit 结构上必在 first-parent spine（直投那一刻成为 develop tip），off-spine commit 结构上不可能是直投（从未是 tip）⇒ 全窗判定不需要对 off-spine 逐条读 reflog。spine 上的中间 commit 用 reflog 括注推断：reflog 有序记录 develop tip 位置与 action，一个「merge Fast-forward」条目 T 与其前一条 reflog 条目 P 之间的 spine commit 全是那次 ff 并入的（fan-in delivered，非直投）；只有 `commit:` action 的 spine commit 才是直投候选。

## Plan

1. 读 `direct-to-develop-bypass-check.ts` 的 `gitDevelopDirectCommits`（:527）、`classifyLandingMode`（:387）、`buildReflogIndex`（:370），确认三态与 reflog 索引现况（`seen` = 任一 reflog 条目含 merge Fast-forward tip；`direct` = `commit:` action）。
2. 改分类，约束：
   - first-parent 扫描：`git rev-list --first-parent develop~100..develop`（100 条 spine），对齐 AC-194 origin「约 100 个 first-parent 提交」原意，⛔ 不再扫全 DAG 721 条；off-spine 621 条结构上非直投、不参与判定（附读数 off-spine = total − first-parent = 621）。
   - reflog 括注：spine 上 reflog 无独立条目的 commit，若落在某「merge Fast-forward」条目 T 与其前一 reflog 条目 P 之间 ⇒ 判 fan-in delivered（非直投、非 unclassifiable）；⛔ 落不进任何括注区间的老 commit 仍 NOT-EVALUATED（硬规则③b，不伪装成合格）。
   - 真直投仍红：`commit:` action 的 spine commit 仍走 files/epoch/message 逐条判定（codeSurface ∧ !inLockWindow ∧ !ac65 ∧ !ruled ⇒ bypass RED）；fixture 注入一个 `commit:` code-surface 直投必须仍 exit 1。
3. 双向负控制实跑贴输出：改动前 `gate AC-194` fail（exit 1，449/721 unclassifiable）已记录；改动后 `gate AC-194` exit 0（evaluated、unclassifiableCommits 0、totalDirectCommits 0）；注入 `commit:` 直投 fixture → checker exit 1（能取假，硬规则④）。
4. 既有测试全绿（`node --test plugin/test/direct-to-develop-bypass-check.test.mjs`）+ 新增一条钉住「ff 括注把中间 spine commit 判 fan-in delivered、unclassifiable 归零」的用例（改动前红）。
5. `node packages/quay/bin/quay.ts task check gap-ac194-bypass-check-unclassifiable-window --json` 的 `missing` 为 `[]`。

## AC

- [x] `node packages/quay/src/goal-store.ts gate AC-194` 在生产工作树 exit 0（读真实 develop~100，⛔ 非 fixture；贴输出含 evaluated/`totalDirectCommits: 0`）
- [x] 双向负控制：改动前 `gate AC-194` fail（exit 1，449/721 unclassifiable）已记录；注入 `commit:` code-surface 直投 fixture → 同一 checker exit 1（真直投仍红，能取假）
- [x] 分类归零：develop~100 窗 `unclassifiableCommits` 由 449 降为 0（读 `--json` 的 `denominator.unclassifiableCommits`，⛔ 非转述）
- [x] first-parent 对齐：扫描 `rev-list --first-parent`（100 条 spine），off-spine 621 条不参与判定（附读数）
- [x] 硬规则③b：落不进任何 reflog 括注区间、也非 `commit:` action 的老 commit 仍 NOT-EVALUATED（构造一个超出 reflog 保留的旧窗负控制验证，⛔ 不与合格同形）
- [x] 既有测试全绿 + 新增「ff 括注分类」用例在改动前红、改动后绿
- [x] `node packages/quay/bin/quay.ts task check gap-ac194-bypass-check-unclassifiable-window --json` 的 `missing` 为 `[]`

## DoD

`node packages/quay/src/goal-store.ts gate AC-194` 在生产工作树 exit 0（读真实 develop~100 载体、`unclassifiableCommits: 0`、`totalDirectCommits: 0`）——不是靠 fixture 注入当正判断据，也不是把 `expect` 从 exit 0 改成 exit 3 或放宽 fail-closed（那会把「读不懂」伪装成「测过了」，硬规则③b/④推论三）。注入 `commit:` code-surface 直投 fixture 后同一 checker exit 1（真直投仍被抓）。仅改 `--json` 输出字段而 gate 仍 fail、或只在 fixture 下 pass 而生产读不出 pass ⇒ 不算完成。

## Touches

- plugin/scripts/direct-to-develop-bypass-check.ts（first-parent 扫描 + reflog 括注分类）
- plugin/test/direct-to-develop-bypass-check.test.mjs（ff 括注 + 归零 + 直投仍红用例）
- tasks/gap-ac194-bypass-check-unclassifiable-window.md（自身）