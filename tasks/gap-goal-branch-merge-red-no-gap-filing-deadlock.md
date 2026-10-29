---
id: gap-goal-branch-merge-red-no-gap-filing-deadlock
title: goal 并入红（尤其 merge-conflict）不立案 gap task ⇒ tip 冻结 ⇒ 永不重试 ⇒ 死锁（裁定⑫ 失败升级未实现）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**机制**（`orchestration/SPEC-goal-branch-2026-10-03.md` §4.7 裁定⑫；读码 2026-10-30，主检出 author）：SPEC 要求 goal 并入「最近一次执行红」作为一个新 gap 形态交给 gap-filing 立案（去重键 `kind: goal-branch-unmerged` + GOAL id，`goal_ac` 指向本 goal 的某个 AC ⇒ 修复落 goal 分支 ⇒ tip 前进 ⇒ 自动重试）。但 source（0.25.0-dev）没实现立案那一半：`grep -rn goal-branch-unmerged packages/ plugin/` = 0 命中；红时 `plugin/scripts/worker-fan-in.ts` 只写 `goal-merge-result` 事件（SPEC 行 85 的「或写事件」选项），没有消费者拿它立案。于是死锁：`packages/quay/src/goal-merge.ts:407` 重试守卫 `prev.tipSha === tipSha && !requestSupersedesResult(request, prev)`——tip 不前进就不重跑（裁定⑳）。merge-conflict 红 ⇒ tip 冻结 ⇒ 无 gap ⇒ 无修复 ⇒ 永不重试。`requestSupersedesResult`（行 369，由 gap-goal-merge-infra-red-mislabelled-and-rerequest-never-retries 落地）只救「人重发请求」的 infra 红，救不了 merge-conflict（重发还是同一棵冲突树）。

**实测死锁实例（claudecodeui，quay 0.24.0）**：GOAL-051 请求 tip `748c77a3a` → merge-conflict 红（两个计数钉子文件 `scripts/suite-duration-baseline.tsv` + `server/shared/tests/quay-test-script.test.ts`，并集 474 个 server 测试文件 = merge-base 464 + goal 加 9 + develop 加 1，两侧零重叠）→ 4.5h 无自动恢复（goal-driver round 936→941 逐轮 `gaps GOAL-051: []`）→ 人手动追平 develop + 计数钉子取并集（commit `381a9d7b3`，测试 14/14 pass）→ tip 前进 → worker 下一轮自动重跑 → landed `867711d84`。

**修法（SPEC 已定方向，实现者可调）**：worker-driver 侧在 merge 红时立案 gap task（或把红结果交给 gap-filing 语义 agent 立案），去重键 `kind: goal-branch-unmerged` + GOAL id，`goal_ac` 指向该 goal 的 AC（§4.3 解析到 goal 分支），修复落 goal 分支后 tip 前进、自动重试并入。

<!-- dedup-ref -->
关联（traceability，非前置、非合并）：`gap-goal-merge-infra-red-mislabelled-and-rerequest-never-retries`（done）修了「infra 红误标 merge-conflict + 人重发请求重试」这半边；本任务修「merge 红 → 立案 gap task → 修复落地 → tip 前进 → 自动重试」这半边（裁定⑫ 的立案）。两半互补、机制不同，separate。

## AC

- [ ] 红即立案：临时仓库构造 branch-mode goal 的并入红（真实内容冲突），worker-driver 下一轮后 task store 里出现一条 gap 任务，其 `goal_ac` 指向该 goal 的某个 AC，且带 `kind: goal-branch-unmerged` 的去重身份（可用 `task_list` / grep 该 kind + GOAL id 核实）。
- [ ] 去重幂等：同一处红在后续轮不重复立案（去重键 `kind: goal-branch-unmerged` + GOAL id；连续两轮后该 gap 任务仍只有一条）。
- [ ] 修复落地自动重试：该 gap 任务的修复落到 goal 分支（tip 前进）后，worker-driver 自动重跑并入（裁定⑳），无需人重发请求（结果事件显示 outcome=landed）。
- [ ] 非内容冲突红同样立案（或至少不卡死）：构造 pre-merge-commit 钩子失败类的非冲突并入红（手法同 gap-goal-merge-infra-red-mislabelled 的测试），同样立案 gap task，而非依赖人重发请求。
- [ ] 取假：用 `cp` 备份恢复（不用 `git checkout --`）临时回退核心改动后，新增用例至少 1 条变红；Evidence 贴实跑输出与恢复后的绿输出。
- [ ] 新增/扩展测试文件覆盖上述（真临时仓库 + 真 git 冲突/子进程，不伪造读数），且 `bash scripts/test.sh --for-task gap-goal-branch-merge-red-no-gap-filing-deadlock` 退出 0。

## DoD

真实落地 = 一个 branch-mode goal 的并入红后，worker-driver 自动立案了 gap task；该 gap 的修复落 goal 分支、tip 前进后并入自动重试并成功落地——死锁类被移除，不再需要人手工追平 develop。生产读数可由 claudecodeui 下一个红在并入上的 goal（或复现 GOAL-051 场景）取得。

**如实注记（附带观察，非本任务阻塞）**：`runGoalMergeFanIn` 的结果事件 `tipSha = request.tipSha || rev-parse branch`，故结果事件记的 tipSha 始终是请求时的 tip，不是实际被 merge 的分支 tip（GOAL-051 的 landed 结果记 `748c77a3a` 而非 `381a9d7b3`）。重试守卫拿「当前分支 tip」对「结果事件 tipSha」恰好能触发重跑，但结果事件的 tipSha 字段本身不反映真实分支 tip——若实现者顺手修，补 Touches/测试；否则留作后续，不阻塞本任务。

## Touches

- packages/quay/src/goal-merge.ts
- plugin/scripts/worker-fan-in.ts
- plugin/scripts/worker-driver.ts
- packages/quay/test/goal-merge.test.mjs
- plugin/test/worker-driver.test.mjs
- tasks/gap-goal-branch-merge-red-no-gap-filing-deadlock.md
