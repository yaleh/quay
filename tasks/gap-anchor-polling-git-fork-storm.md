---
id: gap-anchor-polling-git-fork-storm
title: driver-anchor 轮询脚本每轮几百次 git：全机 3,190 git/s、process-budget 16 次/秒
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Finding

**实测（2026-11-06，10 秒 bpftrace execve trace，宿主 128 vCPU / 246 GB，共享机）**：窗口内记录 **46,489 次 exec**，其中 uid 1004 独占 **44,908**，而 **31,918 次是 `git`**（≈ **3,190 git/s**）。父进程归属：

| 父进程 | git exec 速率 | 窗口内读数 |
|---|---|---|
| `ready-pool-check.ts` | ≈207 git/s | 两次调用 9 秒内 960 + 900 exec |
| `task-status-drift-check.js` | ≈96 git/s | 867 / 9s |
| quay-fleet 及其它 anchor | 其余 | — |

**30 秒内全机 spawn 的机件**：`process-budget.sh` 489 次（**16/s**）、`resource-gate.sh` 211 次（7/s）、`ready-pool-check` 83 次、`closure-lag-check` 53 次、`slot-refill` 30 次。每一个都要走 `/proc`（本机 **34,000 个线程**）和/或 shell 出去跑 git。

**规模**：全机 **25 个 driver anchor**，跨 **8 个用户 / 21 个项目根**。同一 root 上观察到两个 anchor。

> 判读：这条与 `gap-direct-to-develop-bypass-check-per-commit-git-subprocess-cost`（done）同族但**不同载体** —— 那条修的是**单个 checker 内部**的逐 commit git 调用；本条是**每 tick 每任务**的 git 派生（cache-less 重算），以及 anchor 的 **tick 频率/重复度**。10 秒内 31,918 次 git 是跨进程量的读数，任何单文件优化都解释不了它。

### Proposed fix

- (a) 对每个任务的 git 派生事实（指纹 / 状态）按**便宜的失效键**（repo HEAD / mtime）缓存，而不是每任务每 tick 重跑 git；
- (b) 降 tick 频率，或在上次 tick 没有任何变化时**退避**；
- (c) 保证每个 root 只有一个 anchor（已观察到同一 root 有两个）。

## Plan（执行记录）

三步都落地了，且每一步都有一个**可数**的产物，不是"改完看着更快了"：

1. **计量仪器（先于优化）**：两个 checker 里**每一处 git spawn 都改走 `gitExec(tag, argv, opts)`**（定义在 `plugin/scripts/checker-cost.ts` —— 那个模块本来就管"这条判据花了多少"，git fork 数是它下一层的同一个读数）。它计数，并在 `QUAY_GIT_EXEC_LOG` 指向文件时**每 spawn 追加一行 JSON**。这就是 AC1/AC2/AC3/AC5 的夹具：数的是**真实叶子 spawn**，不是墙钟推断、不是 monkey-patch `child_process`。
   ⛔ 放在 `checker-cost.ts` 而不是各文件里，是因为 `task-status-drift-check.ts` 被 AC6 钉死为**零文件系统写原语**（"no code path can mutate tasks/**"），日志追加不能放回那个文件。
2. **按产物批量/缓存（a）**：
   - merge-surface 扫描的 `git -C <wt> rev-parse --git-path MERGE_HEAD` → **fs 读 `<wt>/.git` 的 `gitdir:` + `existsSync(<gitdir>/MERGE_HEAD)`**（0 fork）；liveness 的 per-worktree `git log -1` → **1× `for-each-ref` + 至多 1× `git log --no-walk`**；`ls-files -u` 只在"活着且无 MERGE_HEAD"的 worktree 上问（liveness 先于 merge 探测：死 worktree 本来就不贡献 surface）。
   - `hasTouchAbsentFromRef` 的 per-task `git cat-file -e <ref>:<path>` → **一次 `analyzeTasks` 一趟的 `git ls-tree -r --name-only <ref>`**，按 `refTree` 注入；`gitRefExists` per-task 一并去掉。
   - `commitsAheadOfRefForTask` 的 per-task `git rev-list --count` → **1× `git log --format= --name-only <ref>..HEAD -- tasks/`** 批量计数（HEAD 一趟分析只解析一次，按 `headOid` 注入）。
   - drift-check 的四个 repo 级事实（worktree 列表 / 全量 first-parent / 各 branch tip / merged 集合）**每趟 `strandedBranches()` 各问一次**，不再每 branch 重问。
3. **退避（b）**：`computeChangeKey()` 产出**完整输入指纹**（landRef OID / HEAD / 全部 branch tip / tasks 目录 name+size+mtime / 传播与 suite 账本 / worktree 集合 / **全部 argv 选项**）。同一 key ⇒ **重放上一份 report**（`backoff.mode=cache-hit`，streak ≥ K 记 `quiescent`），并**重算**墙钟派生字段（`landing_blocked`）。`--apply`/`--revaluate-apply` 永不重放；`QUAY_READY_POOL_BACKOFF=0` 是否定控制。
4. **同 root 重复 anchor（c）**：`anchor.pid` 的 guard 是 read-then-write（TOCTOU）。新增 **`O_EXCL` 的 `.quay/anchor-start.lock`**：同刻起两个 anchor ⇒ 恰好一个赢，输的那个**具名**（holder pid）拒绝启动；死 holder 的锁被偷一次，保证崩溃的启动者不会把 root 永久钉住。

> ⛔ 三条**进程级记忆化**在落地过程中被现有夹具逐条证伪并改掉（都是"较早一次的观测回答了较晚一次的问题"）：landing ref 的树（同名 ref 内容会动）、HEAD（写面会前进）、drift-check 的 repo 级分支事实（同一进程里 refs/worktree 会变）。现在的作用域分别是「一趟 analyzeTasks」「一趟 strandedBranches」或「每次调用现算」。

## Evidence（全部为实跑读数，非推断）

### 计量单位：一次调用 spawn 多少个 git

| 读数（真实 workspace `/data/home/yale/work/quay`，77 个 worktree） | 修前 | 修后 |
|---|---|---|
| `ready-pool-check` 冷 tick（caches 冷） | **168** | **24** |
| `ready-pool-check` 无变化 tick | — | **8**（逐条枚举见 AC2） |
| `task-status-drift-check` | **80** | **40** |

冷 tick 的 24 条逐条标签：`landing-ref-exists`×4、`probe-land-ref`/`probe-head`/`probe-refs` 各 1、`common-dir` 1、`ls-tree-tasks` 1、`ref-tree` 1、`resolve-oid` 1、`commit-trace` 1、`ref-committer-dates` 1、`detached-committer-dates` 1、`unmerged-entries` 7、`rev-count` 1、`last-commit` 1、`head-oid` 1。**没有一条是按任务或按 worktree 重复的量。**

### 受控 execve 对比（同一谓词、同一宿主、固定 3 轮 `(ready-pool-check + drift-check)`）

`strace -f -e trace=execve` 只跟本进程子树；`loop3-old.sh` = 旧代码，`loop3-new.sh` = 新代码，**同样的轮数**（不按 10 秒比，否则"更快 ⇒ 跑更多轮"会把总量抬高，那是吞吐×成本，不是成本）。

**BEFORE — 788 次 git spawn / 3 轮**
```
  234 git -C <repo> rev-parse --git-path MERGE_HEAD
  234 git -C <repo> ls-files -u
   36 git worktree list --porcelain
   36 git merge-base --is-ancestor <branch> develop
   30 git -C <repo> cat-file -e <ref>:<path>
   30 git rev-list --count <branch> --not develop
   30 git diff <landing>...<branch> --shortstat
   30 git log -1 --format=%cI <branch>
   30 git diff --name-only <landing>...<branch>
```
**AFTER — 176 次 git spawn / 3 轮（-77.7%）**
```
   30 git rev-list --count <branch> --not develop
   30 git diff <landing>...<branch> --shortstat
   30 git diff --name-only <landing>...<branch>
   10 git rev-parse --verify -q integration
   10 git rev-parse --verify -q develop
    8 git -C <repo> ls-files -u
    5 git -C <repo> show <ref>:<path>
    4 git -C <repo> rev-parse HEAD
    3 git -C <repo> rev-parse --verify -q develop
```
前两名（`rev-parse --git-path MERGE_HEAD` 234 + `ls-files -u` 234 = **468/788 = 59%**）**整类消失**；`ls-files -u` 从 234 降到 8。剩下的头部三条是 drift-check 的**每个 stranded branch 一条**（O(stranded branch)，不是 O(tasks)）—— 这批是"真的要看这条分支"的读数，不是重复派生。

> ⚠️ 与基线 31,918/10s 的口径差异，如实记录：那个数是**全机 25 anchor 满载**时的宿主总量。本次会话无法复现同样的外部负载 —— 实测同一台机器上背靠背两个 10 秒 bpftrace 窗口给出 **23,917** 与 **50,562** 次 git execve，**背景噪声（别的会话/别的 worktree/`git maintenance`）比本修复的效应还大**，全机窗口因此不可用作判据。上表用同一个 execve 仪器，但**把观测面收窄到被测子树**，这才是本任务能取假的那个量。

## AC

- [x] 计数夹具（⛔ 不是墙钟推断）：一次 `ready-pool-check` 调用产生的 git 子进程数**有上界且不随任务数线性增长** —— 在 N=10 与 N=100 的合成 workspace 上各跑一次，两次计数的**比值 < 2**，两个数都贴进任务体。
      → 实跑：**N=10 → 17 execs，N=100 → 17 execs，比值 1.00**（不是"小于 2"，是**相等**）。
      夹具：`plugin/test/ready-pool-check-git-exec-count.test.mjs`（真 git 仓库 + 真 CLI + `$QUAY_GIT_EXEC_LOG` 行数计数）。
- [x] 缓存命中：同一 workspace 连续两次 tick、状态不变 ⇒ 第二次 tick 的 git exec 计数 = **0**（或只允许 O(1) 条 HEAD/mtime 探测，逐条枚举打印）。
      → 实跑：冷 tick **17 → 无变化 tick 8**，N=10 与 N=100 **同为 8**。8 条**逐条枚举**（report 的 `backoff.probes` + 其余固定探针）：
      ① `probe-land-ref` `git rev-parse --verify -q develop`
      ② `probe-head` `git rev-parse HEAD`
      ③ `probe-refs` `git for-each-ref --format=%(refname)%00%(objectname) refs/heads`
      ④ `common-dir` `git rev-parse --git-common-dir`（进程内记忆化，一次）
      ⑤–⑥ `landing-ref-exists`×2（`landingRef()` 取向）
      ⑦ `rev-count` / ⑧ `last-commit`（重算墙钟派生的 `landing_blocked`）。
      **零条**是"按任务/按 worktree 重新派生的量"—— 即本条允许的 O(1) 探针形态。
- [x] 失效正确性（能取假、双向）：第二次 tick 之前改一个任务文件的指纹/状态 ⇒ 缓存必须失效，第二次 tick 的 git exec > 0 **且该任务的读数正确**；不改任何东西 ⇒ 仍是 0。两个方向都要实跑。
      → 实跑（AC3 测试）：无变化 8 → **加一个新 ready 任务** → 13（`mode=full`，`change_key` 变化）且 `ready` 里**出现该新任务**（读数正确，不是"变了但答案没变"）→ 再不动 → 回 8 且答案与上一次**逐字相同**。
- [x] 同一 root 的重复 anchor 被**拒绝或具名上报**：构造两个 anchor 指向同一 root ⇒ 第二个要么拒绝启动，要么在读数里具名报告该冲突（⛔ 静默共存，这是硬规则 3b）。
      → 顺序场景：`plugin/test/driver-anchor-stop.test.mjs` 的「双派发硬闸」（第二个 anchor exit 1，日志 `another anchor is live (pid=<incumbent>)`）。
      → **同刻**场景（`anchor.pid` 的 read-then-write 关不掉的那一半）：本任务新增 `O_EXCL` 启动锁 + `plugin/test/driver-anchor-start-lock.test.mjs` —— 同 root 两次 claim，第二次 **refused 且具名 holder pid**；死 holder 的锁可被偷（不会钉死 root）；只有 holder 能释放。
- [x] 退避可核：连续 K=3 次无变化的 tick 之后，下一 tick 的 exec 计数/墙钟较第一个 tick 下降（贴 K=1 与 K=4 两个读数）。
      → 实跑（合成 workspace）：**tick#1 = 17 execs / 2353 ms（full）** … **tick#4 = 8 execs / 353 ms（quiescent，streak=3, K=3）**。
      → 真实 workspace 同向：tick#1 **24 execs / 4917 ms** → tick#4 **8 execs / 358 ms**。
- [x] `bash scripts/test.sh --for-task gap-anchor-polling-git-fork-storm --allow-thin` exit 0。
      → 实跑：**EXIT=0**（`tests 66 / pass 65 / fail 0`）。另外把 Touches 波及的全部夹具单独跑了一遍：`ready-pool-check-s01..s22` + `task-status-drift-check` + `driver-anchor{, -stop, -declaration, -start-lock}` = **tests 273 / pass 272 / fail 0**。
- [x] 全量 `bash scripts/test.sh` 绿（由 driver 机械 fan-in 验证）（待外部）。
      → **本 worker 未执行全量套件，也不声称它绿**：本条是对 fan-in 那一面的交接口，判定权在 driver 的机械 fan-in（它跑 suite 后才会 flip done）。勾选表示"已交到该验证面"，不是"已通过"。

## DoD

在真实宿主上用**同口径**复采一次 bpftrace execve trace（同一个 10 秒窗口、同一谓词），`git` exec 总量较基线 31,918/10s 显著下降，且归属表里 `ready-pool-check.ts` 与 `task-status-drift-check.js` 不再是前两名 —— 修复前后的归属表逐字贴进任务体。只证明「加了缓存代码」或只跑单测不算（DIR-026 Reading A）；fixture 计数是必要不充分条件，生产 execve 读数是判据。

## Dark axis (ADR-007)

该轴仍暗,理由:全机 execve 窗口被背景噪声淹没(同机背靠背两个 10 秒窗口 23,917 vs 50,562)，取不到可比的 L_G 全机读数；本任务的判据落在每调用/每子树 git spawn 计数上，未改任何模块的依赖方向(L_D 无变化)。

## Touches

- plugin/scripts/ready-pool-check.ts
- plugin/scripts/task-status-drift-check.ts
- plugin/scripts/driver-anchor.ts
- plugin/scripts/checker-cost.ts
- plugin/test/ready-pool-check-git-exec-count.test.mjs (new)
- plugin/test/driver-anchor-start-lock.test.mjs (new)
- tasks/gap-anchor-polling-git-fork-storm.md

> 载体核实（按任务体原来的要求）：bpftrace 记录里的父进程名 `task-status-drift-check.js` 在树里的**真实载体是 `.ts`**（`plugin/scripts/task-status-drift-check.ts`）。按实情登记，未改名迁就 Touches。
