---
id: gap-fan-in-ff-merge-benign-runtime-dirty-no-fast-path
title: fan-in-ff-merge pre-flight 对良性运行时文件脏无快速通道——exit 2 整轮重跑（~20-40min 含全量 suite），应像 status-only flip 一样自动收敛（live-ghost 4 次 105min 实证）
status: done
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`fan-in-ff-merge.sh` 对两种**同构的「无害外部变化」**待遇完全不同（我读码逐条复核，非采信自述）：

- **develop 前进 + 增量是 doc** ⇒ 【有】快速通道：锁内 `--classify-delta` 判惰性 ⇒ merge develop 进任务分支 + 立即重试 ff，毫秒级、不回阶段 1（`gap-fan-in-ff-retry-reruns-suite-on-inert-increment`）。
- **主检出被良性运行时文件弄脏** ⇒ 【无】快速通道：pre-flight 直接 `exit 2` 打回，整轮重跑（含 ~7min 全量 suite）。

**关键（已核实）**：pre-flight 在**锁外、且在锁内快速通道之前**；`exit 2` 路径**明确不写 retry record**（脚本注释逐字「exit 2 … NOT an ff failure, NO retry record」）⇒ 连「ff 失败」都不算，更走不到惰性快速通道。

**生产实证（gap-live-ghost-superseded-task-workflow-events-start）**：4 次 exited-not-landed 累计 105.5min（第 5 次仍在飞 >3h）；`.quay/fan-in-retries.jsonl` 0 条、`.quay/fan-in-ff-escalations.jsonl` 0 条（负控制：两账本分别 162/51 条其它任务记录 ⇒ 谓词没写错，0 是真 0）⇒ **它连 ff 那一步都没走到，全部止步 pre-flight**。弄脏检出的正是 `.quay/message-receipts.jsonl`（今日已 gitignore 修掉的那个）——与任务代码完全无关的运行时文件，本可毫秒级解决，却整轮重跑。

**已有先例（方向已接受，覆盖面不足）**：`gap-fan-in-clean-tree-auto-converge-promotion-status` 已为**一种**良性脏自动收敛（promotion-driver 未提交的 status-only flip 就地 commit 后放行）。⇒「良性脏可自动处置」设计已被接受，缺的是把覆盖面从「仅 status-only flip」扩到「gitignore 应覆盖但漏列的运行时文件」。

## Plan

pre-flight 判脏时，对「落在 `.quay/` 下、且与任务 Touches 无交集的 untracked 运行时文件」给一条与现有 status-only 收敛**并列**的良性分支。⛔ **具体机制（自动清理 / 自动加 gitignore / 仅放行不处置）由实现方设计**——涉及「web server 运行时可能随时再写一个新文件」这个动态问题，不能简单照抄 status-only 的就地 commit。⛔ 复用 `--classify-delta` / `checkTouchesPair` 已有的 Touches 交集判定，不新写一套。

## Acceptance Criteria

- [x] AC1（能取假，良性运行时脏自动收敛）：pre-flight 对「`.quay/` 下、与任务 Touches 无交集的 untracked 运行时文件」走良性分支，不再 `exit 2` 整轮重跑；（⛔ 仍 exit 2 整轮重跑 ⇒ 假）。
- [x] AC2（能取假，负控制真脏仍拒）：真正的脏（任务自己的未提交代码改动、或 Touches 内的文件）仍 `exit 2` 拒绝；（⛔ 误放行 ⇒ 假）。
- [x] AC3（能取假，生产回放）：回放 live-ghost 今天的场景（`message-receipts.jsonl` 脏检出），改造后不再 4 次 exited-not-landed 累计 105min，而是毫秒级通过 pre-flight；（⛔ 仍整轮重跑 ⇒ 假）。

## Definition of Done

pre-flight 对良性运行时文件脏的自动收敛落地；AC1-AC3 全勾；真脏负控制仍拒；live-ghost 场景回放毫秒级通过。

## Touches

- plugin/scripts/fan-in-ff-merge.sh（pre-flight 良性运行时文件脏分支，与 status-only 收敛并列）
- plugin/scripts/touches-orthogonality-check.ts（checkBenignRuntimeDirty 判定函数 + --runtime-dirty CLI，复用 parseTouches/matchGlob）
- plugin/test/（良性运行时脏收敛 + 真脏负控制 + 生产回放 测试）
- tasks/gap-fan-in-ff-merge-benign-runtime-dirty-no-fast-path.md（自身）
