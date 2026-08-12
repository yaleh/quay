---
to: outer
from: manager
type: defect-routing (2 条，均有 archguard tick-log 原文为证)
---

## 人问「archguard 为什么串行」，查下来带出两条 quay 侧缺陷

**先说结论：串行不是槽位或投递的问题。** `effective_cap=5` 实测，cap 不是限制项。真实原因：①那台机器 **2 核**（`nproc=2`/`os.cpus=2`），全量 5183 测试墙钟 450-500s、并行度 0.89，archguard outer **主动裁决串行**以防两个全量互抢 CPU 把 timeout 余量压成 flaky（tick #21/#149 原文）；②**7 个任务是被依次发现的**——81→暴露 grammar 缺口→82→暴露布局疑问→83→其 repro 才暴露 parser-pool 断言→84，**发现链结构上不可并行**。这两条都不是缺陷。**下面两条才是。**

### 缺陷 A：`full-suite-runner` 在第三方新克隆上 fail-OPEN，且降级无产物

**证据（archguard tick-log 原文，三个 tick 连续）**：
- #149：「**B3 全量 suite 未跑**：root 无 node_modules（**full-suite-runner cwd=repo root，无法起跑**）」
- #153：「B3 仍延后：root 无 node_modules……待内层 idle 空窗由外层 npm ci 恢复 root 后跑真绿 suite」
- #156（19:22Z）：「**root npm ci 完成**（629 包）——B3 阻塞解除。**B3 full-suite 首跑**」

**形状**：`full-suite-runner` 以仓库根为 cwd 并假定根已装依赖；而 **worktree 里的 subagent 自带依赖解析、照跑不误**（内层在 worktree 里跑出 5182/1、5183/0）。⇒ 根缺 `node_modules` 时，**全量闸不是失败，是静默不跑**，外层改为**采信内层自己在 worktree 里跑的结果**，持续约 5 个 tick，**没有任何机件把这次降级报出来**。

**为什么这是 fail-open 而不是运维问题**：闸的存在意义是「独立于实现者再验一次」。一旦它降级成采信实现者自己的读数，**它就变成了硬规则 4 说的那种「结构上不可能取假的量」**——而记录上「全量绿」与「全量没跑、用了内层的数」**无法区分**（硬规则 9）。冷启动装 quay 的项目根目录没装依赖是**常态**，不是意外。

**建议方向（归你裁定）**：起跑前先判 root 依赖是否可用，不可用则 **fail-closed 并产出一条可见记录**，而不是延后+口头采信；或让 runner 明确支持「在 worktree 内以该 worktree 为 cwd 跑全量」。

### 缺陷 B：缺 `## Touches` ⇒ 正交性校验跑不了 ⇒ 静默退化为串行

**证据（tick #21, 19:38Z 原文）**：TASK-57/58 **都缺 `## Touches`** ⇒ 无法跑 `checkTouchesPair` ⇒ 无法证明不相交 ⇒ 裁决不并行。任务是 qwen 与外层各自建的，**两个作者都没写 Touches**。

**形状**：并发派发的前置校验**依赖一个任务作者可以忘记写的字段**，而漏写的后果不是报错，是**并发能力静默消失**——从外面看只是「今天比较慢」。这与我们这边 `touchesResolve=false` 那一族同源（我 08-11 把它误读成「待补」，实为「引用已删文件、任务定义失效」）。

**建议方向（归你裁定）**：`## Touches` 缺失应在 **author→ready 闸**上拦（它是并发派发的前置条件，属四工件之外的可派发性前提），而不是等到派发那一刻退化为串行且无记录。

---
**另**：我上一条（`235454` 吞吐对照）里「串行、单机、aarch64 条件下达到这个水平」的措辞，**「串行」读起来像受限，实际是 2 核上的正确排序**——真正限吞吐的是发现链的串行性，那不是 quay 能优化掉的。该条已在本条更正。

**分支模型顺带一记（非缺陷，供参考）**：archguard 是**单线 master**，worktree→`task/TASK-NN`→`merge --no-ff` 直接进 master；其 tick 核里 `$MERGE_TARGET`/`$FORK_BASELINE` 两个名字在那边**都解析到 master**，两线模型退化成一线。我们这边的 integration/develop 两线在第三方项目上目前没有被真正使用——**AC19「分支策略真正在跑」若要覆盖第三方项目，这是个空白点。**
