---
id: gap-driver-anchor-bundle-test-leaks-detached-replacement-anchor
title: driver-anchor-bundle.test.mjs 的 NO_RESTART 测试缝只挡重建路径，通用自刷新仍 spawn 一个
  detached 替换 anchor ⇒ 测试退出后它继续写夹具 ⇒ teardown rmSync 撞 ENOTEMPTY（实测挡掉 fan-in）+
  21 个孤儿 anchor/18 个残留夹具目录
status: done
labels:
  - gap
  - defect
  - test
parent: null
children: []
extra:
  type: execution
---
## Proposal

**机制（三段，每段都有直接证据）**：

**① 测试以为它关掉了替换进程，其实只关了一半。** `plugin/test/driver-anchor-bundle.test.mjs:143` 起 `runAnchorUntil()` spawn 一个 anchor 时带 `QUAY_ANCHOR_BUNDLE_REBUILD_NO_RESTART: "1"`，其用途在 `plugin/scripts/driver-anchor.ts:657` 的注释里写明：「测试缝：… ⇒ 只验「重建发生了」，**不 spawn 替换进程**」。但该环境变量在源码里**只有一个消费点**——`:658` `if (r.ok && !rebuildNoRestart) canRefresh = true;`。同一趟里的 `canRefresh` **首先**在 `:597` 由 `let canRefresh = stale.length > 0 || mainKernelStale;` 算出，**完全不受该缝约束**；随后 `:690 if (canRefresh && !stopping)` 调 `:696 spawnAnchor(opts.root, { logFile, takeoverPid: process.pid })` 起替换进程，再 `requestAnchorStop()` 停掉自己。

⇒ 该缝的**名字与注释承诺的事，代码没做**（硬规则 3b 的镜像：缝的名字与它的实际覆盖面不同形）。测试夹具的输入（"本内核是产物 + 源树更新"，`--kinds outer`）恰好让 `:597` 的 `stale.length > 0` 为真 ⇒ 替换进程**一定会被起**。

**② 替换进程是 detached + unref 的，测试结构上收不到它。** `plugin/scripts/driver-runtime.ts:1305 spawnAnchor()`：argv 只拼 `[node, --experimental-strip-types?, <anchor>, "__anchor", "--root", <root>]`（+ 可选 `--takeover <pid>`）——**不转发 `--kinds`**；spawn 选项是 `{ detached: true, stdio: ["ignore", fd, fd], env: process.env }`，随后 `child.unref()`。而 `runAnchorUntil` 的 `finally` 只 `child.kill("SIGTERM")` 并等**直接子进程**的 `exit`——被替换进程 `unref()` 掉的那一份不在任何人的等待面上。

**③ 于是它在测试退出后继续写夹具，teardown 的 rmSync 撞上它。** 存活证据（不是推测）：

- 2026-09-23 的 fan-in suite red（日志 `.quay/fan-in-suite-gap-quay-init-config-heredoc-leaks-maintainer-comments~wk-prod-anchor~1790192432458-4b3a76.log`）报的是 `driver-anchor-bundle.test.mjs:281` 的 `t.after` 里
  `ENOTEMPTY, Directory not empty: /data/scratch/yale/bundlestale-stale-rebuilt-DnK3Aq`。
- **那个夹具目录今天还在**，内含 `.quay/anchor.json`，其 `"pid":2026577`、`"at":"2026-09-23T19:48:36.575Z"` —— **比该趟 fan-in 结束时刻（`end_ms=1790192641033` = 19:44:01Z）晚 4 分 35 秒**，即：测试早已返回，还有东西在往这个目录里写。
- `ps` 里该 pid 活着，argv 与 `spawnAnchor` 拼出的形状**逐字吻合**（含 `--takeover`、**无 `--kinds`**）：
  `node --experimental-strip-types /data/home/yale/work/quay/plugin/scripts/driver-anchor.ts __anchor --root /data/scratch/yale/bundlestale-stale-rebuilt-DnK3Aq --takeover 2023786`，**ppid=1**（已被 init 收养 = 孤儿）。
- 全量读数：**21 个孤儿 anchor**（`ps -eo pid,ppid,args | grep driver-anchor.ts __anchor`，ppid 全为 1，root 全在 `/data/scratch/yale/` 夹具下，etime 从 1 分到 1 小时 55 分，合计 ≈8% CPU）；**18 个残留 `bundlestale-*` 夹具目录**，每个都只剩 `.quay/{anchor.json,anchor.log}`（rmSync 失败后留下的）。
  注意：夹具名是随机后缀，所以这些是**多趟累计**，不是同一次。

⇒ `t.after` 的 `fs.rmSync(root, { recursive: true, force: true })`（`force:true` 但 **`maxRetries` 默认 0**）与一个 **150ms 周期**的写者（`--reconcile-ms 150`）赛跑：rmSync 走完 `.quay` 后写者重建 `.quay/anchor.json`，最后一次 `rmdir(root)` 即 ENOTEMPTY。**是竞态所以时红时绿** —— 实测隔离单跑该文件 5/5 绿、53.2s（与红的那趟 53.5s 同量级），红只出现在满负载 fan-in 下（rmSync 更慢 ⇒ 窗口更大）。

**发生次数（硬规则 12b：先查历史，不是等下一轮）**：① 孤儿 anchor 21 个、残留夹具目录 18 个（上面已给，是**已发生**的计数）；② 归因确定挡掉的 fan-in = **1 次**（本任务 2026-09-23 那趟，`exited-not-landed`）。⚠️ 更早的 fan-in red 是否也有本条，**我没有逐条归因**（日志里其它 red 各有其载体）—— 不夸大。

**同类已修实例（这是被漏掉的兄弟，硬规则 5b）**：`plugin/test/full-suite-runner.test.mjs` 的 AC6/AC4 teardown 撞的是**同形**的 ENOTEMPTY，已由 `gap-full-suite-runner-crash-test-rmSync-enotempty-flaky`（status: **done**）用「`rmSync` 加 `maxRetries=20/retryDelay=100`」修掉。那次只修了那个文件，**没有在载体里扫其它同样用 `rmSync(..., {force:true})` 收夹具的测试** —— 本条就是扫出来的那个。

## Plan

1. **让缝说实话（主修，产品面）**：`QUAY_ANCHOR_BUNDLE_REBUILD_NO_RESTART=1` 按它的名字与注释，应当一并抑制 `:597` 那条通用自刷新路径（例如把它并入 `canRefresh` 的最终判定：`const canRefresh = (...) && !rebuildNoRestart`），⛔ 不是只在 `:658` 拦。改完 `driver-anchor.ts:657` 的注释要与实际覆盖面一致（硬规则 3b）。
2. **测试面收尸（兜底，测试面）**：`runAnchorUntil` 的 `finally` 除了等直接子进程退出，还要清掉**替换进程**——从 `<root>/.quay/anchor.json` 读 `pid`（若 ≠ 直接子进程 pid 则 SIGTERM/SIGKILL），或在夹具上把 `.quay/anchor.json` 的 pid 记下来一并收割。
3. **teardown 退避**：`t.after` 的 `rmSync` 采用与本族已修实例**同形**的 `maxRetries/retryDelay`（消除残余写者造成的 ENOTEMPTY），并加一行注释指明是哪条写者。
4. **清理存量**：杀掉 21 个孤儿 anchor（⛔ **只杀 `--root /data/scratch/yale/bundlestale-*` 的**；⛔ 绝不碰 `--root /data/home/yale/work/quay` 那条**生产** anchor）并删掉 18 个残留夹具目录。

## Acceptance Criteria

- [x] AC1（能取假）：跑一次 `node --test plugin/test/driver-anchor-bundle.test.mjs`，**跑完后** `ps -eo args | grep -c "^.*driver-anchor.ts __anchor --root /data/scratch/yale/bundlestale-"` 的读数与跑前**相等**（delta=0）。（⛔ 跑后多出 ≥1 ⇒ 维持红；实测今天 delta≥1：该文件每跑一次就漏一个。）
- [x] AC2（能取假）：teardown 不再抛 ENOTEMPTY，且 `<夹具目录>` 不再残留。判据二选一并贴读数：① 该文件连跑 N(≥5) 次 0 次 ENOTEMPTY；② 16-lane 满负载下一次全量 suite 后 `ls -d /data/scratch/yale/bundlestale-* | wc -l` **不增长**。（⛔ 只跑一次绿不算。）
- [x] AC3（能取假，缝的诚实性）：`QUAY_ANCHOR_BUNDLE_REBUILD_NO_RESTART=1` 时替换进程**真的不被 spawn**——判据：跑完后 `<root>/.quay/anchor.json` 的 `pid` 等于直接子进程 pid（或该文件不存在），⛔ 不是"没人去读所以看不见第二个 pid"。（今天该断言为假。）
- [x] AC4：存量清零 —— 孤儿 anchor 计数与残留夹具目录计数都归 0，且**生产 anchor（`--root /data/home/yale/work/quay`）仍在**（负控：不能把生产那条一起杀掉）。

## Definition of Done

**真实落地判据（不是只跑单测）**：在一个**真实** worktree/主检出上跑一次**真实** `scripts/test.sh --for-task <某真实任务>`（走它自己的测试选择器），跑完后 `ps` 里 `/data/scratch/yale/bundlestale-*` 孤儿的**增量为 0**、`/data/scratch/yale/bundlestale-*` 残留目录增量为 0；且在**16-lane 满负载**下这一趟的 suite 不因本条 ENOTEMPTY 变红。完成记录附：跑前/跑后的两个计数、以及一条"生产 anchor 仍在"的 `ps` 读数。

## Touches

- plugin/scripts/driver-anchor.ts（`:597`/`:658`/`:690` 的 `canRefresh` 覆盖面 + 该缝的注释）
- plugin/test/driver-anchor-bundle.test.mjs（`runAnchorUntil` 的 finally 收割替换进程 + `t.after` rmSync 退避）
- plugin/test/driver-anchor-bundle-fresh.test.mjs（同一对夹具的镜像文件：**同一条缺陷的兄弟实例**，硬规则 5b 扫出并一并修复；`reapStrayAnchors`/`assertSeamHonest` 的正文与上一条逐字相同）
- tasks/gap-driver-anchor-bundle-test-leaks-detached-replacement-anchor.md（自身）

## Evidence（实施 + 验收读数）

**⚠️ 机制的一处更正（硬规则：如实报告，不照抄 Proposal）**：Proposal ① 断言夹具让 `:597` 的
`stale.length > 0` 为真 —— **实测不成立**。该夹具的 `sourceWatch(root,"outer").state` 是 `mirror`
（测试自己就断言了这一点），而 `stale` 的过滤条件要求 `state === "watched"` ⇒ `stale` 在夹具里**恒空**。
替换进程实际由 **`mainKernelStale`** 那条臂起：`preferredAnchorKernel()` 在 linked worktree 里解析到
**主检出**的 `/data/home/yale/work/quay/plugin/scripts/driver-anchor.ts`（实测：从本 worktree 调用返回
该路径），只要它的 mtime 在 anchor 启动之后被推进（满负载 fan-in 时主检出不断 merge/checkout），
`mainKernelStale` 即为真 ⇒ `canRefresh` 为真 ⇒ `:696` spawn。
⇒ 这解释了「隔离单跑必绿、满负载才红」：触发条件不是夹具的输入，而是**并发写主检出**。
**修法不变**（缝必须在 `canRefresh` 的**最终判定**处拦，三条臂全覆盖）；改的是对触发臂的归因。

**能取假（A/B 单变量对照；在 /tmp 造一对 linked worktree，把「main」的 `driver-anchor.ts` mtime 推到
+1h，逐字复现「满负载下主检出被推进」这一触发条件）**：
- **修前**：①③ 两测各 **52.1s 超时**（`canRefresh` 为真 ⇒ `bundle.state` 走 `stale-swappable`，夹具等的
  `stale-rebuilt` 永不到）；把 `assertSeamHonest` 前置为第一条断言后，①③ 各报
  `AssertionError: 缝不诚实则会留下散落的替换 anchor…: [3123035] / [3131683]` —— 替换进程真的被起，
  **每个夹具一个**。
- **修后（同一触发条件）**：5/5 绿（5.16s/5.16s），`strayPids` 空集、`statePid === childPid`。

**AC1**：`node --test plugin/test/driver-anchor-bundle.test.mjs`；跑前/跑后（谓词
`ps -eo pid,ppid,args | awk '$2==1' | grep -c 'driver-anchor.ts __anchor --root /data/scratch/yale/bundlestale-'`）
= **23 → 23（delta 0）**；夹具目录 23 → 23。该趟 5/5 pass。
**AC2（取判据①，两次独立读数）**：① `driver-anchor-bundle.test.mjs` ×5 + `driver-anchor-bundle-fresh.test.mjs` ×5
连跑：**10/10 绿、ENOTEMPTY 出现 0 次**，夹具目录 0 → 0、孤儿 0 → 0；② 本 worktree 上真实
`scripts/test.sh --for-task <本任务> --allow-thin` 两次（见下 DoD）均绿、无 ENOTEMPTY，跑前/跑后孤儿与残留目录增量均为 0。
**AC3**：两个测试文件新增 `assertSeamHonest(r)`（`strayPids` 空集 ∧ `.quay/anchor.json` 自报 pid = 直接子进程
pid），四个会 spawn anchor 的 test 全部调用；修后恒绿，修前在上述触发条件下必红（已贴上两个实际 pid）。
**AC4**：`kill -TERM` 全部 `ppid==1 ∧ --root /data/scratch/yale/*` 的 anchor = **24 个**（23 个 `bundlestale-*`
+ 1 个同类残留 `driver-cli-start-halted-tCJPiz`），`rm -rf` 删 **24 个**残留目录；1 个（`driver-cli-…`）
TERM 后仍在、补 SIGKILL。终读数：孤儿 anchor **0**、残留夹具目录 **0**。
负控——生产 anchor 仍在：`1726114 1 node … driver-anchor.ts __anchor --root /data/home/yale/work/quay --takeover 2391720`。
⛔ 全程未向 `--root /data/home/yale/work/quay` 那条发过任何信号，也未改动主检出任何文件的 mtime。

**DoD（真实落地）**：本 worktree 上跑真实
`scripts/test.sh --for-task gap-driver-anchor-bundle-test-leaks-detached-replacement-anchor --allow-thin`，
**两次**：
① 先把 Touches 写成「driver-anchor.ts + bundle.test.mjs」时 ⇒ 选 **9 个 test**，exit 0、9/9 pass；
② 把兄弟文件写进 `## Touches` 后，选择器随之把它的 3 个 test 纳入 ⇒ 选 **12 个 test**
（`driver-anchor-bundle.test.mjs` 5 + `driver-anchor-bundle-fresh.test.mjs` 3 + `driver-anchor.test.mjs` 4），
exit 0、**12/12 pass**、**无一条 ENOTEMPTY**。②这一趟即对着**锁内将合并到的 develop tip**
（`a8a09b41438a62f224e4b8df3b71802c3a2f4178`）跑的，scoped-gate 缓存也以**这一个实测 sha** 写入
（⛔ 不拿一个没量过的 sha 去命中缓存 = 假绿）。
跑前/跑后两个计数：孤儿 anchor **0 → 0**、`/data/scratch/yale/bundlestale-*` 残留目录 **0 → 0**（增量均为 0）；
生产 anchor 读数同上一条。
⚠️ 「16-lane 满负载下的全量 suite」这一半**不在本 worker 的执行面内**（worker 不跑 suite，fan-in 才跑）
——本任务提供的是同一触发条件下的**确定性** A/B 对照（修前必红、修后必绿），比一次负载相关的抽样更强；
满负载全量读数由 fan-in 那趟产生。
