---
id: gap-ready-pool-check-s22-cache-regression-asserts-wall-clock-ratio
title: ready-pool-check-s22 的缓存回归测试断言墙钟比值 < 0.75——并行 suite
  下比值落在阈值上方（0.76/0.78/0.76/0.87），反复卡住 goal 并入与任务 fan-in
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on: []
---
## Proposal

**机制**（2026-10-03 至 10-05，GOAL-904/905 合并演练中连续读到）：`plugin/test/ready-pool-check-s22.test.mjs:195` 的用例「AC5 regression: on an N=2000 store the cached call must beat the uncached baseline」用**墙钟耗时比值**断言缓存生效：`assert.ok(tCached < tUncached * 0.75, …)`（`:231` 附近，两臂各取 2 次的最小值）。它与全量 suite 的其它测试并行跑，墙钟耗时随主机负载漂移，而这台主机上该比值本来就落在阈值附近。

**生产读数**（本会话里该断言在全量 suite 中的失败，每条都带断言原文）：
- GOAL-904 并入尝试：`cached=2099ms uncached=2748ms`（比值 0.76）；
- 一次任务 fan-in：`cached=2064ms uncached=2383ms ratio=0.87`；
- GOAL-905 并入第一次：`cached=1755ms uncached=2319ms ratio=0.76`（2026-10-05T16:23:36Z）；
- GOAL-905 并入第二次：`cached=2014ms uncached=2595ms ratio=0.78`（2026-10-05T17:05:37Z）。
四次都是**刚好高于 0.75**，不是离谱的值；同一个文件在主检出里隔离重跑每次都过（13 个用例、约 14 秒，至少 6 次）。主机负载读数 13–16/128。

**为什么这是缺陷而不是「偶发」**：这条断言想证明的是机制——缓存臂**绕过了对任务库的读取**；它却去测一个受负载影响的派生量。结果是：（1）每个需要全量 suite 的落地（任务 fan-in、goal 并入）都有一个与自己改动无关的红；（2）读数连续落在阈值上方时，重试也不再是抛硬币（GOAL-905 连续两次），人只能反复手工重发请求；（3）只加宽阈值会把同一个耦合留着，只是把红挪到更高的负载上。

**修法（方向，实现者可调）**：把断言改成**确定性的机制判据**——数两臂对任务文件的读取次数：缓存臂不应读取（或读取数远小于 N），旁路臂应读取约 N 次；读取计数的手段由实现者定（对 `fs` 读取做计数桩，或经该模块已有的可注入读取缝），⛔ 不要为此改产品逻辑。墙钟比值保留为 `t.diagnostic` 的读数（不再断言）。⛔ 不要只把 0.75 改大。

<!-- dedup-ref -->相关但机制不同：`ready-pool-check` 的缓存本身没有缺陷，本任务只修它的回归测试的断言形态。

## AC

- [x] `plugin/test/ready-pool-check-s22.test.mjs` 里该用例不再对墙钟比值做断言：`grep -n 'tUncached \* 0.75' plugin/test/ready-pool-check-s22.test.mjs` 无输出；比值仍通过 `t.diagnostic` 报告。
- [x] 同一用例新增确定性断言：缓存臂对任务文件的读取次数远小于 N（或为 0），旁路臂的读取次数不少于 N；两个数在失败信息里都被打印。
- [x] 取假：把缓存旁路临时改成空操作（用 `cp` 备份恢复，⛔ 不用 `git checkout --`，即还原到修复前「kill-switch 无效、两臂都全量读取」的形态）后，上面新增的读取次数断言变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [x] 负载无关性读数：在 `## Evidence` 贴出同时并行跑该文件 4 份、重复 5 轮（共 20 次）的结果，要求 20/20 通过（命令形如 `seq 4 | xargs -P4 -I{} node --test plugin/test/ready-pool-check-s22.test.mjs`，重复 5 轮）。
- [x] `node --test plugin/test/ready-pool-check-s22.test.mjs` 退出 0。

## DoD

真实落地判据：落地之后，全量 suite 里这条用例不再因负载漂移变红。生产读数是之后的 fan-in / goal 并入的 suite 日志里不再出现 `cached analyzeTasks must beat the uncached baseline`；落地时可能还没有足够多的样本，完成记录里须写明已观察了几次全量 suite。

## Touches

- plugin/test/ready-pool-check-s22.test.mjs
- plugin/scripts/ready-pool-check.ts
- tasks/gap-ready-pool-check-s22-cache-regression-asserts-wall-clock-ratio.md

## Evidence

落地：commit `b3accc8f4`，**只改 `plugin/test/ready-pool-check-s22.test.mjs`**（`plugin/scripts/ready-pool-check.ts` 未改——计数桩在模块自己的 git 边界上，未触碰产品逻辑）。

**AC1**（不再断言墙钟比值；比值仍走 `t.diagnostic`）：

```
$ grep -n 'tUncached \* 0.75' plugin/test/ready-pool-check-s22.test.mjs
$ echo $?
1
```

无输出（该字面量已从用例移除）。比值仍在通过路径上报告 —— 见 AC2 的 diagnostic 行。

**AC2**（确定性读取计数；两个数都打印）：

```
✔ AC5 regression: on an N=2000 store the cached call BYPASSES the store read and the bypass arm reads the whole store (9861ms)
ℹ AC5 N=2000: cached=1547ms uncached=2111ms ratio=0.73 · task-blob reads cached=0 uncached=4000
```

新断言（`assert.ok(cachedReads * 10 < N, …)` 与 `assert.ok(uncachedReads >= N, …)`）——失败信息含两个读数：

```
task-blob reads on an N=2000 store: cached=${cachedReads} uncached=${uncachedReads} (pre-fix: both arms read N)
```

计数手段：一个 `git` PATH 垫片记录两臂经 `git cat-file --batch`（内容读取的缝；请求 id 在 stdin 上）请求的任务文件行数。缓存臂 = 0（内容寻址缓存命中），旁路臂 = N。

**AC3**（取假：kill-switch 改成空操作 ⇒ 变红；`cp` 恢复 ⇒ 绿）：
mutation = `rpcCacheEnabled()` 的 `return process.env.QUAY_READY_POOL_CACHE !== "0";` → `return true;`（`cp` 备份到 `/tmp/rpc-mutation-backup.ts`）。
红（mutation 在位）：

```
✖ AC5 regression ... (8680ms)
ℹ AC5 N=2000: cached=1520ms uncached=1535ms ratio=0.99 · task-blob reads cached=0 uncached=0
  AssertionError [ERR_ASSERTION]: the bypass arm must read the whole store — task-blob reads on an N=2000 store: cached=0 uncached=0 (pre-fix: both arms read N)
ℹ pass 0  ℹ fail 1
```

`cp` 恢复后：`md5sum` 前后同为 `88eb8b8726a74e4a57c525a46867e88e`；`git diff --stat -- plugin/scripts/ready-pool-check.ts` 空 ⇒ 工作树干净、byte-identical。恢复后绿：

```
✔ AC5 regression ... (9915ms)
ℹ AC5 N=2000: cached=1544ms uncached=2144ms ratio=0.72 · task-blob reads cached=0 uncached=4000
ℹ pass 1  ℹ fail 0
```

**AC4**（负载无关性：并行 4 份 × 5 轮 = 20 次）：

命令 `seq 4 | xargs -P4 -I{} node --test --experimental-strip-types plugin/test/ready-pool-check-s22.test.mjs`（重复 5 轮）：

```
round 1: runs=4 total_pass=52 total_fail=0
round 2: runs=4 total_pass=52 total_fail=0
round 3: runs=4 total_pass=52 total_fail=0
round 4: runs=4 total_pass=52 total_fail=0
round 5: runs=4 total_pass=52 total_fail=0
20 runs -> pass=260 fail=0
```

20 次并行运行的读取计数**全部**为 `cached=0 uncached=4000`（20/20 各一条 diagnostic）；墙钟比值在 0.72–0.74 间漂移，但已不再被断言。

**AC5**（`node --test plugin/test/ready-pool-check-s22.test.mjs` 退出 0）：

```
$ node --test --experimental-strip-types plugin/test/ready-pool-check-s22.test.mjs; echo exit=$?
ℹ tests 13   ℹ pass 13   ℹ fail 0
exit=0
```

**DoD 记录**：本 worker 按协议**不跑全量 suite**，故本任务完成的**全量 suite 观察次数 = 0**。旧红是墙钟比值对负载的耦合；现已替换为确定性计数，并在 4 路并行负载下 20/20 通过。生产读数是落地后 fan-in / goal 并入的 suite 日志中不再出现 `cached analyzeTasks must beat the uncached baseline`。

**fan-in 前置**：`git merge --no-edit develop` → Already up to date；scoped 门 `scripts/test.sh --for-task gap-ready-pool-check-s22-cache-regression-asserts-wall-clock-ratio --allow-thin` → exit 0（13/13）。scoped-gate cache 已写（develop sha `01706371c`）。
