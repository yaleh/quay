---
id: gap-ready-pool-check-s22-cache-regression-asserts-wall-clock-ratio
title: ready-pool-check-s22 的缓存回归测试断言墙钟比值 < 0.75——并行 suite
  下比值落在阈值上方（0.76/0.78/0.76/0.87），反复卡住 goal 并入与任务 fan-in
status: todo
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

- [ ] `plugin/test/ready-pool-check-s22.test.mjs` 里该用例不再对墙钟比值做断言：`grep -n 'tUncached \* 0.75' plugin/test/ready-pool-check-s22.test.mjs` 无输出；比值仍通过 `t.diagnostic` 报告。
- [ ] 同一用例新增确定性断言：缓存臂对任务文件的读取次数远小于 N（或为 0），旁路臂的读取次数不少于 N；两个数在失败信息里都被打印。
- [ ] 取假：把缓存旁路临时改成空操作（用 `cp` 备份恢复，⛔ 不用 `git checkout --`，即还原到修复前「kill-switch 无效、两臂都全量读取」的形态）后，上面新增的读取次数断言变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [ ] 负载无关性读数：在 `## Evidence` 贴出同时并行跑该文件 4 份、重复 5 轮（共 20 次）的结果，要求 20/20 通过（命令形如 `seq 4 | xargs -P4 -I{} node --test plugin/test/ready-pool-check-s22.test.mjs`，重复 5 轮）。
- [ ] `node --test plugin/test/ready-pool-check-s22.test.mjs` 退出 0。

## DoD

真实落地判据：落地之后，全量 suite 里这条用例不再因负载漂移变红。生产读数是之后的 fan-in / goal 并入的 suite 日志里不再出现 `cached analyzeTasks must beat the uncached baseline`；落地时可能还没有足够多的样本，完成记录里须写明已观察了几次全量 suite。

## Touches

- plugin/test/ready-pool-check-s22.test.mjs
- plugin/scripts/ready-pool-check.ts
- tasks/gap-ready-pool-check-s22-cache-regression-asserts-wall-clock-ratio.md
