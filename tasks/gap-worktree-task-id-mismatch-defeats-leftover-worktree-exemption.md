---
id: gap-worktree-task-id-mismatch-defeats-leftover-worktree-exemption
title: worktree/分支名与任务 id 不精确匹配（如被截断）时 leftover-worktree 豁免与 superseded-reclaim 双双静默失效
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: finding
---
## Finding

`ready-pool-check.ts` 的 `notYetFlipped()`（:987-1015）用「存在一个匹配任务 id 的 leftover worktree」作为豁免信号——只要 `hasLeftoverWorktree` 为真，就直接判定该 `ready` 任务仍需保持可派发，跳过 `allChecked`/`doneFlipReady` 两条可能误判的分支。这个豁免的唯一判据是 `worktreeMatchesTask`（`fast-mode-telemetry.ts:400-407`）：要求 worktree 路径的 basename，或去掉 `refs/heads/`/`task/` 前缀后的分支名，与任务 id **逐字相等**。

**真实实例（本次会话实测，2026-09-15）**：任务 `gap-worker-driver-counts-transient-rate-limit-as-fast-death-and-parks-task-needs-human` 的实际实现提交 `d3d22dc16`（2026-09-14T02:06:53Z）只落在它自己隔离出的任务分支上——`git show develop:plugin/scripts/worker-driver.ts` / `git show master:...` / 主检出工作树里 `grep -n "classifyQuickDeathCause\|quick_death_cause\|parseRateLimitResetAtMs"` 全部零命中，即从未落地到 develop/master。而它对应的 worktree 路径是 `/home/yale/work/quay-worktrees/gap-worker-driver-counts-transient-rate-limit`，分支是 `task/gap-worker-driver-counts-transient-rate-limit`——**都缺了任务 id 的后缀 `-as-fast-death-and-parks-task-needs-human`**。因为 `worktreeMatchesTask` 要求逐字相等，这个真实存在、确有未落地工作的 worktree 完全匹配不上任务 id，`hasLeftoverWorktree` 判为 `false`，任务被直接放行进 `allChecked` 分支——该分支只看任务体里 `## AC` 的复选框是否全部打勾（这些勾是 worker 自己在隔离 worktree 里的自评，不是生产事实），判定为 `not-yet-flipped`（"已经落地，只是状态没翻"）。结果是这条任务被永久排除在 `ready` 池外（`ready-pool-check.ts --json` 的 `excluded` 数组），从其 worktree 最后一次提交（2026-09-14T02:16:17Z）到本次发现（2026-09-15T08:xx）已卡住超过 30 小时，且没有任何信号提示"这是因为一个命名不匹配"——从 `ready-pool-check` 的输出看，它和"这条任务的工作真的已经全部完成，只是漏了状态翻转"是同一个形状，无法区分（硬规则 3b）。

**同一个根因还静默污染了另一个消费者**：`worker-driver.ts` 的 `reclaimSupersededWorktrees`（:972）经 `enumerateTaskWorktreeTasksAsync`（:735）**直接把 worktree/分支名字符串当成任务 id** 去查状态（`statusOf(taskId)`）。因为同一个截断名字，`.quay/worker-round.jsonl` 里 `superseded_reclaim.perTask` 对这条任务的记录是 `{"taskId":"gap-worker-driver-counts-transient-rate-limit","status":"unreadable"}`——用截断名去查真实任务库自然查不到，被判 `unreadable`，而不是报告"这个 worktree 的名字对不上任何已知任务"。

**已验证的临时修复（本次手工操作，非机制修复）**：确认 worktree 无未提交改动后，`git worktree remove` 该 worktree、`git branch -m` 把分支改名为完整任务 id、再用完整任务 id 路径 `git worktree add` 重建。修复后 `ready-pool-check.ts --json` 的 `excluded` 立刻清空该任务，`superseded_reclaim.perTask` 也正确读到该任务真实状态（`ready`，不再是 `unreadable`）。这证明诊断成立，但只解决了这一个实例——机制本身仍然脆弱：**任何未来出现的 worktree/分支名与任务 id 不精确匹配（不管是人手误、agent 自己建 worktree 时写错/截断，还是别的原因）都会重现同一个静默失效**，且截至本次调查我们**没有定位到是哪一步产生了这个截断名字**（可能是最初起 worktree 的 worker/agent 自己的行为，不一定是某处程序化截断逻辑），本任务不预设根因，只按已实测的失效面来修。

相关但不重复的既有任务（已修复，覆盖的是别的绕过分支，不是本任务描述的「id 不精确匹配」这个失效面）：`gap-nyf-doneflipready-arm-bypasses-leftover-worktree-exemption`（done，doneFlipReady 臂绕过整个豁免）、`gap-ready-pool-notyflipped-allchecked-leftover-worktree-exemption`（done，allChecked 臂的豁免顺序问题）、`gap-worktree-exists-blind-to-unprefixed-task-branch`（done，缺 `task/` 前缀导致判不存在）。这三条修的都是「豁免逻辑本身的结构缺陷」；本任务修的是「豁免的匹配判据本身不健壮，且失配时零可见信号」，是同一个安全网上的另一个洞。

## Acceptance Criteria

- [ ] AC1（能取假，回归控制）：把本次实例的真实失配形态（worktree basename/去前缀分支名 = 任务 id 去掉某个真实存在的后缀）做成测试 fixture，固定进 `ready-pool-check.test.mjs` 或 `fast-mode-telemetry.test.mjs`——修复前该 fixture 必须重现 `hasLeftoverWorktree === false`（对着一个已知有真实未落地工作的 worktree）；修复后同一 fixture 必须被正确识别（不再无声放过）。
- [ ] AC2（可见性，硬规则 3b——不得用与「合格」同形的值代表「查不清」）：修复后，当扫描到一个 `quay-worktrees` 目录下的 worktree/分支，其 basename 或去前缀分支名**不能与任务库中任何一个任务 id 精确匹配**时，机制必须产出一条独立、可读的诊断记录（例如落进某个 round/诊断载体的一条 `mismatched-worktree-name` 类型条目，或等价的日志行），且这条记录与「一切正常」在结构上不同形——不能只是静默地什么都不做，也不能被处理成某个已有的、代表"正常"的默认值。
- [ ] AC3（回归控制，双向对照）：`reclaimSupersededWorktrees`/`enumerateTaskWorktreeTasksAsync` 路径对同一个失配 fixture 跑一次，`perTask` 里对应条目**不得**再是 `status: "unreadable"`（这是"用错误字符串查不到"的伪装成"读不懂"）——要么正确关联回真实任务 id，要么用 AC2 定义的诊断记录明确标注"这个 worktree 名字对不上任何任务"。
- [ ] AC4（生产验证，硬规则 4 推论三）：修复落地之后，对 `/home/yale/work/quay` 当前 `git worktree list` 里所有真实 `quay-worktrees/*` 条目跑一次修复后的扫描逻辑，报告是否发现新的名字不匹配实例（不要求发现，但必须实际跑过、把读数写进本任务体，不能只在 fixture 里验证过）。

## Definition of Done

- 机制变更真实落地在 `plugin/scripts/ready-pool-check.ts` / `plugin/scripts/fast-mode-telemetry.ts` / `plugin/scripts/worker-driver.ts`（视最终修法涉及哪些文件），不是只加测试或只加注释。
- AC1-AC3 的测试在 `scripts/test.sh` 选择集里跑绿，且负控制（还原修复前代码）能让它们红——证明测试真的在测这个失效面，不是空转。
- AC4 的生产扫描读数（哪怕是"零发现"）写进本任务体，作为真实运行过的证据，不是假设。
- 不需要定位「最初是谁/哪一步产生了截断名字」作为完成条件——本任务的落地标准是「失配发生后機制不再静默」，根因调查是加分项不是门槛。

## Touches

- plugin/scripts/ready-pool-check.ts（`notYetFlipped`/`hasLeftoverWorktree` 附近，:987-1015）
- plugin/scripts/fast-mode-telemetry.ts（`worktreeMatchesTask`/`worktreeExists`/`listWorktrees`，:400-424 附近）
- plugin/scripts/worker-driver.ts（`enumerateTaskWorktreeTasksAsync`:735、`reclaimSupersededWorktrees`:972 附近）
- plugin/test/ready-pool-check.test.mjs
- plugin/test/fast-mode-telemetry.test.mjs
- plugin/test/worker-driver.test.mjs
- tasks/gap-worktree-task-id-mismatch-defeats-leftover-worktree-exemption.md（自身）