---
id: gap-goal-filing-ledger-landing
title: goal-filing 台账代码落地：把 reconcileGoalFiling 并入 develop 并在工作区树取 AC-938 读数
status: ready
labels:
  - gap
  - goal-driver
parent: null
children: []
extra:
  schema: execution
depends_on: []
goal_ac: AC-938
---
## Proposal

<!-- dedup-ref -->
相关但不同机制（已评估，决定 separate）：`gap-goal-driver-filing-ledger`（status=ready，goal_ac: AC-934）拥有台账实现本身，本任务只拥有「把这份从未落地的实现并入 develop + 主检出同步 + 在工作区树上取判据 + 一条生产台账新行」这一独立验收面。不合并的理由：该 peer 的机械 fan-in 已因 `incomplete suite (547/637 files)` 基础设施读数在 2026-11-06T09:20:57Z 折返（`exited-not-landed`），把它折进本任务只会重跑同一条被挡的路径而不新增验收；AC-938 又是另一个语义（代码是否真的存在于工作区树），需要一个自带 `goal_ac: AC-938` 的任务对象供 driver 的 `readTaskFacts` 独立复核。

AC-938 今天必然非零。2026-11-06 在本工作区（cwd=`/data/home/yale/work/quay`）实测三条读数：

- `grep -c reconcileGoalFiling plugin/scripts/goal-driver.ts` → `0`（工作树文件里没有这个导出）；
- `git show develop:plugin/scripts/goal-driver.ts | grep -c reconcileGoalFiling` → `0`（develop 也没有）；
- AC-938 判据原样执行 → exit 1：`SyntaxError: The requested module './plugin/scripts/goal-driver.ts' does not provide an export named 'reconcileGoalFiling'`。

而实现是真实存在的，只是**从未进入 develop**：分支 `task/gap-goal-driver-filing-ledger`（worker worktree `/data/home/yale/work/quay-worktrees/gap-goal-driver-filing-ledger`，HEAD `64fe08b25`，领先 develop 9 个提交，含 `840956f44`）在 `plugin/scripts/goal-driver.ts:3188` 有 `export function reconcileGoalFiling(`，并带 409 行 goal-driver 改动、78 行 meta-driver 改动、`plugin/test/goal-driver-s14.test.mjs`（326 行）、`docs/carrier-registry.json` 的 `goal-filing.jsonl` 条目和证据文档。2026-11-06 用 `git merge-tree --write-tree develop task/gap-goal-driver-filing-ledger` 干跑，退出 0、无 CONFLICT —— 落地是机械可行的。

同时 `.quay/goal-filing.jsonl` 现存的两行（`spawned` 07:49:45Z / `filed` 07:57:41Z，taskId=`gap-goal-filing-chain-audit`）是那次 worktree 证据跑写下的**静态、未跟踪**文件，正是 AC-938 origin 指出的形态：生产 goal-driver 从不写台账时它仍能保持「绿」，清理 `.quay/` 或换机就会无代码变更地翻红（硬规则 4 推论三）。

⇒ 本任务的交付物是一次**落地**与一次**工作区树上的真实读数**，不是再实现一遍。⛔ 不要重写实现、不要新造第二个台账代码；分支里已有的实现、测试、carrier 注册与证据文档就是待落地的内容。

## Plan

1. **现场核实（先做，别信过期判断）**：`git merge-base --is-ancestor 840956f44 develop` 应非零；`git merge-tree --write-tree develop task/gap-goal-driver-filing-ledger` 应退出 0；`ps aux | grep quay-task-worker` 无该任务活进程；worktree `git status --porcelain` 干净。

2. **落地，按序尝试，每一步留下可复核日志**：
   a. 首选机械路径：让 driver 对该任务重跑一次 fan-in（worker-driver 的 `runMechanicalFanIn`）。2026-11-06T09:20:57Z 的失败读数是 `incomplete suite (547/637 files)` + `recovery baseline-equivalence not evaluable at concurrency 16`，那是负载/基础设施，不是代码红 —— 换一个低负载窗口重试是合规的第一次尝试。
   b. 机械路径再失败：用语义兜底 `Workflow({scriptPath: "<plugin>/workflows/fan-in-execute.js"})`（⛔ 不用 `name:`，M176），在 worktree 内完成 merge develop → anti-drift/delta → scoped 静态门 → 全量 suite → 合入 develop。
   c. ⛔ 不得把「suite 不可评估」当作通过（硬规则 3b / 4c）。若在最低并发仍是 `NOT-EVALUATED`，落地前必须显式记录该状态、负载读数与失败文件集；用「suite 没跑完」换一个绿是禁止的。

3. **主检出同步**：`syncDevelopToDoc`（`plugin/scripts/driver-filters.ts`）或 `git -C /data/home/yale/work/quay merge --ff-only develop`，把 author 分支追上 develop。⛔ 主检出落后 develop 时生产跑的是旧代码（CLAUDE.md 明写），而 AC-938 的判据恰恰在主检出上取。

4. **在工作区树跑判据**（cwd=`/data/home/yale/work/quay`），逐字记录命令、stdout、exit code；负控见 AC6。

5. **生产载体**：落地与同步之后，真实 goal-driver 轮次应向 `.quay/goal-filing.jsonl` 追加行（`spawned` 或终态都算），`at` 晚于落地提交时刻；逐字抄录并附对应 goal round 读数。若驱动处于 drain/halted（`.quay/worker-control.json` 的 `halted:true`）而无新行，记录 `NOT-EVALUATED` + `halted_by`/`halted_at` 读数 + 解除命令（`quay driver resume --kind worker`）；⛔ 不得用 2026-11-06T07:57:41Z 的旧行充数。

6. **收尾卫生**：合入后 `task/gap-goal-driver-filing-ledger` 已是 develop 的祖先；确认无活进程后清掉残留 worktree 与已合入分支（`git worktree remove /data/home/yale/work/quay-worktrees/gap-goal-driver-filing-ledger`），并把该任务的落地状态写进 `tasks/gap-goal-driver-filing-ledger.md`（仍停在 ready 且无人续做时，按 `quay task check` 走完它的 ready→done，或在其任务体记录留给人/manager 的明确决定）。⛔ 删除前必须先 `git merge-base --is-ancestor <branch> develop` 为真。

## AC

- [ ] `git -C /data/home/yale/work/quay merge-base --is-ancestor 840956f44 develop` 退出 0，且 `git show develop:plugin/scripts/goal-driver.ts | grep -c "export function reconcileGoalFiling"` ≥ 1（实现真的在 develop 历史里，不是只在某个分支上）。 —— 落地树侧等价读数本轮已取：`git merge-base --is-ancestor 840956f44 HEAD` = 0、`git show HEAD:plugin/scripts/goal-driver.ts | grep -c` = 1（证据 §9.1）；develop 侧的两个读数是 fan-in ff 的直接产物，worker 不能写 develop（待外部）
- [ ] AC-938 判据原样执行（cwd=`/data/home/yale/work/quay`）退出 0，stdout 含 `"writer":"present"` 且 `terminal` ≥ 1；命令与输出逐字贴进证据。⛔ 不许把 cwd 换成 worktree，也不许用 worktree 里的文件代跑。 —— 落地树（即 ff 进去的那棵树）上本轮已取：exit 0、`{"writer":"present","terminal":1}`；落地前 develop `aab5db17a` 上 exit 1 `SyntaxError: … does not provide an export named 'reconcileGoalFiling'`（证据 §9.2）。但本条要求 cwd=`/data/home/yale/work/quay`，该读数要等主检出追上 develop（待外部）
- [ ] 主检出同步可核：`grep -c "export function reconcileGoalFiling" /data/home/yale/work/quay/plugin/scripts/goal-driver.ts` ≥ 1（读的是工作树文件而非 git 对象），且 `git -C /data/home/yale/work/quay rev-list --count develop..HEAD` 的每一条提交都是 `tasks:`/`goals:`/`routines:` 一类的 doc 侧提交（逐条列出）。 —— 取读数时主检出 HEAD=`aab5db17a` 与 develop 同点（`rev-list --count develop..HEAD` = 0 / `HEAD..develop` = 0），落地 ff 无分叉；但 develop 在本会话中已前进到 `ed0942e92`，且落地后 `develop..HEAD` 的逐条清单只能在同步之后才存在（待外部）
- [ ] 生产载体：`.quay/goal-filing.jsonl` 中存在 `at` 晚于落地提交时刻的行，逐字抄录该行与对应 goal round 读数；若因 drain/halted 无新行，本项以 `NOT-EVALUATED` + `halted_by`/`halted_at` 读数 + 解除命令 `quay driver resume --kind worker` 交差，并注明该读数尚未取到。⛔ `at` 不晚于落地提交时刻的旧行不算。 —— 现有 2 行（07:49:45Z / 07:57:41Z）**都早于**落地提交 `88a9882dc` ⇒ 按本条与 AC-941 口径⛔ 不计；四类 driver 均 `running=1`、control-state `halted:false`（goal-driver 最近 `goal-round.jsonl` 记录 `2026-11-06T11:37:03.375Z`），本会话内没有产生新行，故也不适用 halted 的 `NOT-EVALUATED` 支（待外部）
- [ ] `node --test plugin/test/goal-driver-s14.test.mjs` 与 `node --test plugin/test/goal-driver-s06.test.mjs` 在工作区树退出码 0（不只在 worktree）。 —— 落地树上本轮已取：s14 10/10、s06 9/9 全绿（证据 §9.3）；工作区树上的读数是落地 + `syncDevelopToDoc` 之后的事（待外部）
- [x] 负控：在 `/home/yale/work/quay-worktrees/` 下新建临时 worktree（⛔ 不用 `/tmp`，本机 `/tmp` 写入受限且会被清理），`git checkout` 到落地提交之前的 develop 提交后重跑 AC-938 判据必须非零；把两次输出并排贴进证据（证明判据能区分有/无实现，不是恒真）。 —— 已执行：临时 worktree `/data/home/yale/work/quay-worktrees/neg-goal-filing-prelanding`（detached at 落地前 develop `aab5db17a`，⛔ 不在 `/tmp`），与落地树共用同一份 `.quay/goal-filing.jsonl`（2 行，唯一变量就是有无导出）。负臂 exit 1 `SyntaxError: The requested module './plugin/scripts/goal-driver.ts' does not provide an export named 'reconcileGoalFiling'`；正臂 exit 0 `{"writer":"present","terminal":1}`。⚠️ 负臂首次尝试因 neg worktree 缺 `node_modules` 报 `ERR_MODULE_NOT_FOUND: Cannot find package 'yaml'` —— 那是仪器故障不是负控，补符号链接后重跑才得上述读数；两次输出与这次故障都逐字记在证据 §9.2。
- [x] 收尾：`git worktree list` 中不再有 `gap-goal-driver-filing-ledger` 的残留条目，且该分支已合入后才移除；`tasks/gap-goal-driver-filing-ledger.md` 的 frontmatter/Blocker 记录该任务的落地状态。 —— 已执行：`git merge-base --is-ancestor task/gap-goal-driver-filing-ledger task/gap-goal-filing-ledger-landing` = 0（合入在先）之后才 `git worktree remove`；`git worktree list | grep -c gap-goal-driver-filing-ledger` = `0`，分支 ref `64fe08b25` 保留不删。`tasks/gap-goal-driver-filing-ledger.md` 已加 `## Landing status`（落地提交、unpark 检查、留给人/manager 的决定）+ Blocker 追加成因复核 + 顶部 `**PARKED**`（该任务 AC 已全勾、实现已完整，重派只会重复实现同一份 958 行改动）。

> **land 时 AC 勾选说明（本轮 worker 实况）**：7 条中 2 条（AC6 负控 / AC7 收尾）**已在本会话内实测完成并勾选**；其余 5 条全部是**读 develop / 读主检出 / 读生产台账**的读数，依赖三个 worker 结构上不能自己制造的**外部事件**——fan-in 的 ff 落地、promotion-driver 的 `syncDevelopToDoc`、goal-driver 的下一次生产 gap spawn。按硬规则 3b/4c，它们标 `（待外部）` 而**不**勾：`（待外部）` 在本仓的口径是「工作已做、等外部事件」（`ready-pool-check.ts:1008`「depends only on an EXTERNAL event (suite green / outer verification / someone's merge)」），不是「已验过」。**本轮可证的落地实质**：实现分支 `64fe08b25` 已在落地分支上（合并提交 `88a9882dc`），落地树里 `export function reconcileGoalFiling` 存在、AC-938 判据在落地树上由红转绿、s14/s06 在落地树上全绿、负控证明判据能取假。每一项待取读数都附了**可执行、只读**的 unpark 检查命令，见 `docs/evidence/2026-11-06-goal-filing-ledger.md` §9.4。

## DoD

真实交付物 = develop 上真实存在、可被 `import` 的台账写入实现 + 已同步到 develop 的主检出 + 一条落地之后由生产 goal-driver 产出的台账行（或带阻断读数的 `NOT-EVALUATED`）。

不是「测试绿了」「worktree 里有实现」「证据文档写得很完整」：AC-938 的判据必须在 `/data/home/yale/work/quay` 这棵工作区树上取，负控必须证明它在落地前的 develop 上真的会红。全量 `bash scripts/test.sh` 绿；若在最低并发仍不可评估，按硬规则 3b 记 `NOT-EVALUATED` + 负载读数 + 失败文件集，不得以「suite 跑不完」换绿。

证据文档：在 `docs/evidence/2026-11-06-goal-filing-ledger.md` 追加一节「落地与工作区树读数」，逐字记录：落地提交 sha、主检出同步后的 `git rev-parse HEAD`、AC-938 判据的两次输出（落地前红 / 落地后绿）、负控两次输出、生产台账新行。

## ADR-007 dark axis

- 该轴仍暗，理由：本任务落地的是已有实现的合并，不改变模块依赖图，不产生新的 `L_D`/`L_G` 数值读数。

## Touches

- plugin/scripts/goal-driver.ts
- plugin/scripts/meta-driver.ts
- plugin/test/goal-driver-s14.test.mjs
- plugin/test/goal-driver-s06.test.mjs
- docs/carrier-registry.json
- docs/evidence/2026-11-06-goal-filing-ledger.md
- tasks/gap-goal-filing-ledger-landing.md
- tasks/gap-goal-driver-filing-ledger.md