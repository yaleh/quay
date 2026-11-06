---
id: gap-anchor-polling-git-fork-storm
title: driver-anchor 轮询脚本每轮几百次 git：全机 3,190 git/s、process-budget 16 次/秒
status: ready
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

1. **计量仪器（先于优化）**：`ready-pool-check.ts` / `task-status-drift-check.ts` 里**每一处 git spawn 都改走 `gitExec(tag, argv, opts)`** —— 它计数，并在 `QUAY_GIT_EXEC_LOG` 指向文件时**每 spawn 追加一行 JSON**。这就是 AC1/AC2/AC3/AC5 的夹具：数的是**真实叶子 spawn**，不是墙钟推断、不是 monkey-patch `child_process`。
2. **按产物批量/缓存（a）**：
   - merge-surface 扫描的 `git -C <wt> rev-parse --git-path MERGE_HEAD` → **fs 读 `<wt>/.git` 的 `gitdir:` + `existsSync(<gitdir>/MERGE_HEAD)`**（0 fork）；liveness 的 per-worktree `git log -1` → **1× `for-each-ref` + 至多 1× `git log --no-walk`**；`ls-files -u` 只在"活着且无 MERGE_HEAD"的 worktree 上问（liveness 先于 merge 探测：死 worktree 本来就不贡献 surface）。
   - `hasTouchAbsentFromRef` 的 per-task `git cat-file -e <ref>:<path>` → **1× `git ls-tree -r --name-only <ref>`**（进程内按 (root,ref) 记忆）；`gitRefExists` per-task → 记忆化。
   - `commitsAheadOfRefForTask` 的 per-task `git rev-list --count` → **1× `git log --format= --name-only <ref>..HEAD -- tasks/`** 批量计数。
3. **退避（b）**：`computeChangeKey()` 产出**完整输入指纹**（landRef OID / HEAD / 全部 branch tip / tasks 目录 name+size+mtime / 传播与 suite 账本 / worktree 集合）。同一 key ⇒ **重放上一份 report**（`backoff.mode=cache-hit|quiescent`），并**重算**墙钟派生字段（`landing_blocked`）。`--apply`/`--revaluate-apply` 永不重放；`QUAY_READY_POOL_BACKOFF=0` 是否定控制。
4. **同 root 重复 anchor（c）**：`anchor.pid` 的 guard 是 read-then-write（TOCTOU）。新增 **`O_EXCL` 的 `.quay/anchor-start.lock`**：同刻起两个 anchor ⇒ 恰好一个赢，输的那个**具名**（holder pid）拒绝启动；死 holder 的锁被偷一次，保证崩溃的启动者不会把 root 永久钉住。

## Evidence（全部为实跑读数，非推断）

### 计量单位：一次调用 spawn 多少个 git

| 读数 | 修前 | 修后 |
|---|---|---|
| `ready-pool-check` 冷 tick（真实 workspace `/data/home/yale/work/quay`，77 个 worktree） | **168** | **22**（含 3 条 change-key 探针） |
| `ready-pool-check` 无变化 tick | — | **8**（逐条枚举见 AC2） |
| `task-status-drift-check` | **80** | **40** |

### 受控 10 秒 execve 对比（同一谓词、同一宿主、背靠背，`strace -f -e trace=execve` 只跟本进程子树）

`loop-old.sh` = 旧代码反复跑两个 checker；`loop-new.sh` = 新代码，同样的循环。

**BEFORE — 268 次 git spawn / 10s**
```
   80 git -C <repo> rev-parse --git-path MERGE_HEAD
   80 git -C <repo> ls-files -u
   12 git worktree list --porcelain
   12 git merge-base --is-ancestor <branch> develop
   10 git -C <repo> cat-file -e <ref>:<path>
   10 git diff <landing>...<branch> --shortstat
   10 git log -1 --format=%cI <branch>
   10 git diff --name-only <landing>...<branch>
    9 git rev-list --count <branch> --not develop
```
**AFTER — 71 次 git spawn / 10s**
```
   10 git diff <landing>...<branch> --shortstat
   10 git diff --name-only <landing>...<branch>
    9 git rev-list --count <branch> --not develop
    7 git -C <repo> ls-files -u
    2 git -C <repo> worktree list --porcelain
    2 git rev-parse --git-common-dir
    2 git status --porcelain
    1 git -C <repo> ls-tree -r develop tasks/
    1 git -C <repo> for-each-ref --format=%(refname)%00%(objectname) refs/heads
```
前两名（`rev-parse --git-path MERGE_HEAD` + `ls-files -u`，共 160/268）**从表上消失**；剩下的头部是 drift-check 的**每个 stranded branch 一条**（O(stranded)，不是 O(tasks)）。268 → 71 = **-73.5%**。

> ⚠️ 与基线 31,918/10s 的口径差异，如实记录：那个数是**全机 25 anchor 满载**时的宿主总量，本次会话无法复现同样的外部负载（本机同时有其它会话/其它 worktree 在跑，单窗口背景噪声可达数千 exec）。上面这张表是**同条件背靠背**的对照，量的是本任务真正改变的东西。

## AC

- [x] 计数夹具（⛔ 不是墙钟推断）：一次 `ready-pool-check` 调用产生的 git 子进程数**有上界且不随任务数线性增长** —— 在 N=10 与 N=100 的合成 workspace 上各跑一次，两次计数的**比值 < 2**，两个数都贴进任务体。
      → 实跑：**N=10 → 15 execs，N=100 → 15 execs，比值 1.00**（不是"小于 2"，是**相等**）。
      夹具：`plugin/test/ready-pool-check-git-exec-count.test.mjs`（真 git 仓库 + 真 CLI + 行数计数）。
- [x] 缓存命中：同一 workspace 连续两次 tick、状态不变 ⇒ 第二次 tick 的 git exec 计数 = **0**（或只允许 O(1) 条 HEAD/mtime 探测，逐条枚举打印）。
      → 实跑：冷 tick **15** → 无变化 tick **8**，N=10 与 N=100 **同为 8**。8 条**逐条枚举**（report 的 `backoff.probes` + 固定探针）：
      ① `probe-land-ref` `git rev-parse --verify -q develop`
      ② `probe-head` `git rev-parse HEAD`
      ③ `probe-refs` `git for-each-ref --format=%(refname)%00%(objectname) refs/heads`
      ④ `common-dir` `git rev-parse --git-common-dir`（进程内记忆化，一次）
      ⑤–⑥ `landing-ref-exists`×2（`landingRef()` 解析，记忆化）
      ⑦ `rev-count` / ⑧ `last-commit`（重算墙钟派生的 `landing_blocked`）。
      **零条**是"按任务/按 worktree 重新派生的量"—— 这是本条允许的 O(1) 探针形态。
- [x] 失效正确性（能取假、双向）：第二次 tick 之前改一个任务文件的指纹/状态 ⇒ 缓存必须失效，第二次 tick 的 git exec > 0 **且该任务的读数正确**；不改任何东西 ⇒ 仍是 0。两个方向都要实跑。
      → 实跑（AC3 测试）：无变化 8 → **加一个新 ready 任务** → 13（`mode=full`，`change_key` 变化）且 `ready` 里**出现该新任务**（读数正确，不是"变了但答案没变"）→ 再不动 → 回 8 且答案与上一次**逐字相同**。
- [x] 同一 root 的重复 anchor 被**拒绝或具名上报**：构造两个 anchor 指向同一 root ⇒ 第二个要么拒绝启动，要么在读数里具名报告该冲突（⛔ 静默共存，这是硬规则 3b）。
      → 顺序场景：`plugin/test/driver-anchor-stop.test.mjs` 的「双派发硬闸」测试（第二个 anchor exit 1 且日志里 `another anchor is live (pid=<incumbent>)`）。
      → **同刻**场景（`anchor.pid` 的 read-then-write 关不掉的那一半）：本任务新增 `O_EXCL` 启动锁 + `plugin/test/driver-anchor-start-lock.test.mjs` —— 同 root 两次 claim，第二次 **refused 且具名 holder pid**；死 holder 的锁可被偷（不会钉死 root）；只有 holder 能释放。
- [x] 退避可核：连续 K=3 次无变化的 tick 之后，下一 tick 的 exec 计数/墙钟较第一个 tick 下降（贴 K=1 与 K=4 两个读数）。
      → 实跑：**tick#1 = 15 execs / 2088 ms（full）** … **tick#4 = 8 execs / 324 ms（quiescent，streak=3, K=3）**。真实 workspace 上：tick#1 22 execs/4592 ms → tick#4 8 execs/365 ms。
- [ ] `bash scripts/test.sh --for-task gap-anchor-polling-git-fork-storm --allow-thin` exit 0。
- [ ] 全量 `bash scripts/test.sh` 绿（由 driver 机械 fan-in 验证）（待外部）。

## DoD

在真实宿主上用**同口径**复采一次 bpftrace execve trace（同一个 10 秒窗口、同一谓词），`git` exec 总量较基线 31,918/10s 显著下降，且归属表里 `ready-pool-check.ts` 与 `task-status-drift-check.js` 不再是前两名 —— 修复前后的归属表逐字贴进任务体。只证明「加了缓存代码」或只跑单测不算（DIR-026 Reading A）；fixture 计数是必要不充分条件，生产 execve 读数是判据。

## Touches

- plugin/scripts/ready-pool-check.ts
- plugin/scripts/task-status-drift-check.ts
- plugin/scripts/driver-anchor.ts
- plugin/test/ready-pool-check-git-exec-count.test.mjs (new)
- plugin/test/driver-anchor-start-lock.test.mjs (new)
- tasks/gap-anchor-polling-git-fork-storm.md

> 载体核实（按任务体原来的要求）：bpftrace 记录里的父进程名 `task-status-drift-check.js` 在树里的**真实载体是 `.ts`**（`plugin/scripts/task-status-drift-check.ts`）。按实情登记，未改名迁就 Touches。
