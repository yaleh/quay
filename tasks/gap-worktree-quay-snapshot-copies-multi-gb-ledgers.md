---
id: gap-worktree-quay-snapshot-copies-multi-gb-ledgers
title: refresh-worktree-quay.sh 把约 4 GB 台账拷进每个 worktree —— 一轮 suite 就制造上千次 cp/mkdir
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**症状（实测，2026-11-06，本机；数字逐字取自现场读数）**

- 主检出 `.quay/` = **8.6 GB / 443,026 files / 1,939 dirs**。
- 每个任务 worktree 的 `.quay/` 快照 = **约 3.9–4.0 GB**（实测 `gap-routine-semantic-dedup-scan-readtasks-duplicate` 3.9G、`gap-goal-driver-filing-ledger` 4.0G）。构成：`meta-driver-round.jsonl` **2.0G**、`goal-round.jsonl` 350M、`measure-history.jsonl` 297M、`verification-round.jsonl` 275M、`gate-events.jsonl` 207M。
- `plugin/scripts/refresh-worktree-quay.sh` 把主检出 gitignored 的 `.quay/*` 复制进 worktree 快照；唯一排除项是 `.quay/node-compile-cache/**`（4.1G）与 dated/log/inbox 路径。**上面这些 append-only 台账不在排除集**，所以每轮 fan-in / scoped-gate 在 worktree 里都会重新拷一遍多 GB 文件（`cp -p`，幂等覆盖）。
- 实测代价：一次 `bash scripts/test.sh --for-task …` scoped-gate 运行期间，bpftrace execve 追踪记录到 **约 5 秒内 cp 1,638 / mkdir 1,637 / dirname 1,639 次 exec**（~1,000 execs/s），父进程全部是 `refresh-worktree-quay.sh`；所有测试套件停止之后，它仍是本机残余进程抖动的主导来源（当时 host loadavg 259，而真实 CPU 工作约 10 核）。
- 磁盘：7 个在飞 quay worktree × ~4 GB ≈ 28 GB，且各 worktree 的副本会陈旧、彼此不一致。

<!-- dedup-ref --> 相关历史（上下文，非重复立案）：`gap-fan-in-worktree-quay-provisioning`（done）**创建**了这个脚本；`gap-driver-round-carriers-unbounded-growth-retention-design`（done）处理过 `*-round.jsonl` 无界增长（当时 meta = 513M）——同一个载体今天已是 **2.0G**，即那条任务的前提被超过 4 倍。

**候选修法（形状留给实现者，择一或组合）**：① 把 append-only 历史台账从 worktree 快照里排除（worktree 套件需要 config/gates/runtime 载体，不需要主检出的全部历史）；② 用 `cp --reflink=auto` 或硬链接复制，使代价是 O(metadata) 而不是 O(bytes)；③ 在源头截断/轮转这些载体。无论选哪个，**排除集必须 data-driven，并断言一个快照大小上界**，使未来的新载体不能悄悄把它重新灌大。

## Plan

1. 先取直接量再动手：一次 refresh 前后 `du -sb` 快照、`strace -f -e trace=execve -c` 或既有计数口径的 cp/mkdir 次数，作为改动前基线（贴原文读数，⛔ 只报「变快了」不算）。
2. 选定修法并落到 `plugin/scripts/refresh-worktree-quay.sh`：排除集单一声明（数据，不是散落在条件里的字面量）；若选 reflink/硬链接，确认 worktree 内写入不会回写主检出（当前设计是副本、非 symlink，正是为了不污染主检出，这条约束不能丢）。
3. 加**快照大小上界**判据：算出大小并与声明上界比较；算不出 ⇒ 记 `NOT-EVALUATED` 并以可区分的输出暴露，⛔ 不得与「合格」同形（硬规则 3b）。
4. 补测试（含负控制：未列入排除集的载体仍必须被复制）并在本任务 worktree 内跑一次真实 scoped-gate 取前后对照。
5. 若实现新增了 `plugin/scripts/*` 文件或需要改刷新调用点 `scripts/test.sh`，**在合入 develop 之前**先用 task_write 把该文件补进 `## Touches`（anti-drift 读的是 worktree 内的任务文件，事后补会假红）。

## AC

- [ ] AC1 排除/去重生效（能取假）：构造 mock 主检出 `.quay/`（含一个 `truncate -s 500M` 造的 ledger）跑一次 refresh ⇒ worktree 快照里**不含**该 ledger（或它走 reflink/硬链接、块数不翻倍），并打印快照大小读数；**负控制**：同一 fixture 里放一个未列入排除集的载体 ⇒ 它**仍必须被复制**。两态读数贴出。
- [ ] AC2 exec 次数与台账字节数解耦：同一 fixture 用 5M 与 500M 两个 ledger 各跑一次 refresh，execve 计数差值 ≤ 一个小常量上界（写明该上界与理由），并贴出两次数值。
- [ ] AC3 排除集 data-driven 且可核：排除集在脚本头部以单一声明表达；测试读该声明与实际行为交叉核对——往声明里加一个载体名 ⇒ 测试回报它被排除；从声明里删掉 ⇒ 测试回报它被复制（两态贴出）。
- [ ] AC4 快照大小上界存在且能取假：refresh 结束时算快照大小并与 `plugin/scripts/refresh-worktree-quay.sh` 声明的上界比较，超界 ⇒ 非零退出或显式告警；算不出/读不懂 ⇒ `NOT-EVALUATED` 独立取值。贴「界内 pass」「人为超界 fail」两态。
- [ ] AC5 真实证据（本任务 worktree 内、合入之前）：改动后在该 worktree 跑一次 `bash scripts/test.sh --for-task gap-worktree-quay-snapshot-copies-multi-gb-ledgers`，记录 ① 快照大小（改前 vs 改后）② 一次 refresh 的 cp/mkdir exec 计数（改前 vs 改后）。⛔ 只贴 fixture 数字不贴生产读数 ⇒ 不算。

## Definition of Done

- 五条 AC 全部满足，AC5 有真实前后对照读数（快照大小与 exec 次数各一对）。
- 一个真实任务 worktree 的 refresh 后 `.quay` 快照**显著小于**改动前（给出具体数字，不是「更小」），且一次 refresh 的 cp/mkdir exec 次数不再随台账字节数增长。
- 负控制成立：未列入排除集的 `.quay` 载体仍被复制进 worktree（证明不是一刀切不拷、套件所需 config/gates/runtime 仍可读）。
- 项目自身闸门：`--for-task` scoped 门 + 全量套件绿；若改动了调用点或新增脚本，`## Touches` 已在合入前补齐。

## Touches

- plugin/scripts/refresh-worktree-quay.sh
- plugin/test/refresh-worktree-quay.test.mjs
- plugin/scripts/capability-catalog-declarations.json — 仅当本任务新增 plugin/scripts 文件时（同时按 capability-catalog.sh 头部登记 outline 条目）
- tasks/gap-worktree-quay-snapshot-copies-multi-gb-ledgers.md
