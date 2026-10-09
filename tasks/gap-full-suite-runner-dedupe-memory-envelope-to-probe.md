---
id: gap-full-suite-runner-dedupe-memory-envelope-to-probe
title: full-suite-runner.ts 的 readEffectiveTotalMemBytes() 是内联重复实现，未真正调用
  effective-capacity-probe.ts——两个已 done 任务都没有完成这条自己留的 TODO
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Finding

**本任务是人 2026-10-09 架构裁定（DIR-132）低算力优先链条的核实后发现**：`gap-effective-capacity-cgroup-cpu-memory-probe`（done）与 `gap-full-suite-runner-memory-max-host-derived-envelope`（done）都已落地、都已合入 develop（`618e1f814`/`9dd99da1f`，均已验证是 develop 祖先），**但两者没有真正接上**——这不是推测，是读两边自己留的代码/声明证实的：

- `plugin/scripts/full-suite-runner.ts:1050-1054` 的 `readEffectiveTotalMemBytes()` 函数头注释逐字写着：
  ```
  /** cgroup-aware「有效总内存」(bytes) — **临时内联实现**.
   *  ⚠️ 依赖 `gap-effective-capacity-cgroup-cpu-memory-probe`（todo, 未落地）产出的共享探测函数
   *  (`plugin/scripts/effective-capacity-probe.ts`)。该任务落地后本函数【必须】替换为对它的调用 ——
   *  ⛔ 不重复发明第二份探测实现（见任务 Finding/Touches 的依赖记录）。
   */
  ```
  这条注释写在 `gap-full-suite-runner-memory-max-host-derived-envelope` 自己的实现里，承认自己是"临时内联实现"，并且**明确要求探测任务落地后必须替换**。探测任务（`gap-effective-capacity-cgroup-cpu-memory-probe`）现在已经 done、已合入 develop——但 `readEffectiveTotalMemBytes()` 仍是那段临时内联代码，没有被替换。`grep -n "effective-capacity-probe" plugin/scripts/full-suite-runner.ts` 只命中这一行注释，没有任何 `import` 或函数调用。
- `plugin/scripts/effective-capacity-probe.ts` 自己的 capability-catalog CONSUMER 表声明（`plugin/scripts/capability-catalog-declarations.json:2075`）也诚实地写着："本仓库内 worker 收缩 / 内存预算 / 分级验证的接线是后续任务的事，本件此时只提供能力"——即它自己承认目前零真实消费者。
- 功能上，`readEffectiveTotalMemBytes()` 的内联实现本身**不是错的**（它独立实现了类似的 cgroup 层级遍历逻辑，读 `memory.max`、排除 quay 自己的 `quay-anchor-`/`quay-serve-`/`run-` 前缀 scope），但它与 `effective-capacity-probe.ts` 的 `computeEffectiveCapacity`/cgroup 读取逻辑是**两份独立实现**，会按 CLAUDE.md 硬规则 5b（"在某处修好 X ≠ X 只在那一处"）的镜像教训在未来各自演化出不一致（例如一方修了 cgroup v1 支持而另一方没跟上，或两者对"排除 quay 自己 scope 前缀"的处理分叉）。

**范围声明——这不是功能缺陷，是重复实现的技术债**：当前生产行为不受影响（两边都 fail-open 到 `os.totalmem()`，128 核大宿主上两者算出的结果预期一致）。本任务的目的是消除重复，不是修一个"算错了"的 bug。

## AC

- [x] 把 `plugin/scripts/full-suite-runner.ts` 的 `readEffectiveTotalMemBytes()` 改为实际调用 `plugin/scripts/effective-capacity-probe.ts` 导出的 `computeEffectiveCapacity`（配合它的 raw-reading 收集函数），取其 `effective_mem_mb` 字段（换算回 bytes）作为返回值，删除/替换掉 `full-suite-runner.ts` 里重复的 cgroup 层级遍历代码（`selfCgroupV2Path`/`readCgroupMemoryMaxBytes` 等，若替换后不再被其它地方使用）。**保留** "排除 quay 自己的 `quay-anchor-`/`quay-serve-`/`run-` 前缀 scope" 这条语义——probe 模块当前不做这个排除（它读的是"本进程自己的 cgroup"，不遍历祖先链），需要先确认这条排除语义在改造后是否仍然必要、以何种方式保留（不能静默丢弃，必须在任务体里写清楚怎么处理的）。
- [x] 同机前后对照（本机 128 核大宿主）：改动前后分别调用 `readEffectiveTotalMemBytes()`（或等价的单元级读数），确认 `buildSystemdRunArgv` 产出的 argv 逐字节不变（仍是 `MemoryMax=16G`）——这是"不打断生产测试"红线的直接证据。
- [x] **2/4/8 vCPU 容器模拟验收（真实 cgroup，不是纯 mock）**：用 `systemd-run --user --scope -p CPUQuota=200% -p MemoryMax=4G`（模拟 2 vCPU/4GB）、`-p CPUQuota=400% -p MemoryMax=8G`（模拟 4 vCPU/8GB）、`-p CPUQuota=800% -p MemoryMax=16G`（模拟 8 vCPU/16GB）三档真实 scope，在每一档内分别跑改动前的内联实现与改动后调用 probe 的实现，对照两者的 `effective_total_mem`/`effective_mem_mb` 读数是否一致（证明替换没有改变语义，只是去重）；三档读数（内核实际 `memory.max` / 改动前输出 / 改动后输出）全部贴入任务体，不写预测值。
- [x] 既有测试（`full-suite-runner.test.mjs`、`effective-capacity-probe.test.mjs`）全部保持通过，测试数量不减少；新增覆盖"排除 quay 自己 scope 前缀"这条语义在改造后仍然成立的测试（真实构造一层嵌套 `quay-anchor-*` scope 内再跑一层限制更紧的外层 scope，断言排除逻辑仍生效）。
- [x] 本任务不引入、不依赖任何跨项目锁/配额机制（`gap-cross-project-resource-gate-no-declarative-quota-or-shared-slot` 已明确选择"不做锁"，本任务与之无关，不得因为"方便"而重新引入该方向）。
- [x] scoped 门：`bash scripts/test.sh --for-task gap-full-suite-runner-dedupe-memory-envelope-to-probe --allow-thin` exit 0。
- [ ] 落地并经过真实 worktree/driver 执行后，从 `.quay/verification-round.jsonl` 取 ≥3 个新轮次确认本机（128核）全量套件 pass/fail/durationMs 与改动前处于同一量级，不引入新红。（待外部）

## DoD

必须证明大宿主（128核）上生产行为 argv 逐字节不变；必须有三档真实 cgroup 容器模拟的实测对照数据（不是预测）；必须保留"排除 quay 自己 scope"这条语义且有测试覆盖；不得引入任何跨项目锁依赖。完成后 `grep -n "effective-capacity-probe" plugin/scripts/full-suite-runner.ts` 必须命中真实的 import/调用，不能只剩注释。

## Touches

- plugin/scripts/full-suite-runner.ts
- plugin/scripts/effective-capacity-probe.ts
- plugin/scripts/capability-catalog-declarations.json
- plugin/test/effective-capacity-probe.test.mjs
- plugin/test/full-suite-runner-cgroup.test.mjs
- tasks/gap-full-suite-runner-dedupe-memory-envelope-to-probe.md

## Evidence

> 落地提交：`f41f73071`（本任务 worktree 分支 `task/gap-full-suite-runner-dedupe-memory-envelope-to-probe`）。
> 取证脚本：`.quay/ac-dedupe-evidence/measure.mjs`（把 develop@cde3902cf 的旧实现**逐字复制**为 "before" 臂，
> 在**同一个进程/同一个 cgroup** 里同时打印旧实现读数与新的 probe 读数 —— 两臂不可能是两个"配置相同所以想必相等"的 scope）。

### AC1 —— 「排除 quay 自己 scope 前缀」这条语义的处置（AC 要求写清楚，⛔ 不得静默丢弃）

**结论：这条语义仍然必要，原样保留；实现位置随遍历一起从 `full-suite-runner.ts` 迁到
`effective-capacity-probe.ts` 的 `QUAY_OWN_SCOPE_PREFIXES` + `effectiveAncestorMemoryLimit()`
（现在全仓库只有这一份 cgroup 层级遍历）。**

**为什么仍然必要（本机实测，不是推理）**：本 128 核宿主上 quay 起的进程**实际就运行在
`quay-anchor-*` 包络 scope 里** —— 本任务执行时的 `/proc/self/cgroup` =
`0::/user.slice/user-1004.slice/user@1004.service/app.slice/quay-anchor-quay-1791546907882.scope`，
该层内核 `memory.max = 66295676928`（≈ 0.25 × 246.97 GiB 宿主总量）。读数**必须**跳过它：否则派生
上限就是 `floor(61.7G × 0.25) ≈ 15.4G < 16G 上限`，argv 会从 `MemoryMax=16G` 变成
`MemoryMax=<字节数>`，"不打断生产测试"当场破掉。这条排除不是历史包袱，是本机生产路径的**当前**依赖
（实测 `ancestorWalk.skippedQuayScopes` 恰好命中那一层）。

**在改造后如何保留（把遍历连同排除规则一起搬进 probe，⛔ 不是复制第二份）**：
`effectiveAncestorMemoryLimit()` 从挂载根往下走到本进程，**跳过** scope 名以
`quay-anchor-` / `quay-serve-` / `run-` 开头（且以 `.scope` 结尾）的层，其余层取 `memory.max`
的最紧值；没有任何非 quay 层设上限 ⇒ `bytes: null` ⇒ 调用方回退宿主总量（fail-open，⛔ 不返回 0）。
probe 为此新增两个选项：`memoryLayers: "self" | "ancestors"`（默认 `self` = 只读本进程自己那层，
即 probe 原有的文档契约；`ancestors` = 本次需要的祖先链）与 `ignoreEnvSeams`（生产宿主容量读数
**不得**被 `EFFECTIVE_CAPACITY_TEST_*` 测试缝重定向 —— 与旧实现 `selfCgroupV2Path` 对
`QUAY_TEST_CGROUP_DIR` 的同一条纪律）。

**两条真实 cgroup 证据（非 mock）**：
1. 单层（既有 negative control，断言按新的 MB 形状收紧）：在
   `systemd-run --unit quay-anchor-fsr-probe-*.scope -p MemoryMax=1G` 内，读数**不是** 1G，
   回落到宿主总量。
2. **嵌套（本任务新增测试）**：外层 `quay-anchor-fsr-nested-*.scope`（`memory.max=1G`，⛔ 必须被跳过）
   内，用该 scope 的 cgroup delegation 手工 `mkdir` 出一个子 cgroup 并设 `memory.max=4G`
   （✅ 必须被消费）⇒ 实测 `effective = 4294967296`、
   `skippedQuayScopes = ["…/quay-anchor-fsr-nested-*.scope"]`、派生 `MemoryMax = 1073741824`。
   **两层刻意选成"被排除的那层更紧"（1G < 4G）**：若排除失效，读数会塌到 1G，断言立刻失败 ——
   只跑"只有一个 quay-anchor 层"的 negative control 看不出这一点（那里被排除的层是唯一的层）。

### AC2 —— 同机前后对照（本机 128 核）：`buildSystemdRunArgv` 逐字节不变

| 量 | 改动前（develop@cde3902cf 的旧内联实现） | 改动后（probe 接线） |
|---|---|---|
| `/proc/self/cgroup` | `0::/user.slice/user-1004.slice/user@1004.service/app.slice/quay-anchor-quay-1791546907882.scope` | 同 |
| 该层内核 `memory.max` | 66295676928 | 66295676928 |
| `readEffectiveTotalMemBytes()` | **265182715904**（= `os.totalmem()` 精确值） | **265181724672** |
| 差 | — | **991232 B（0.95 MiB，仅 MB 截断）** |
| `DEFAULT_SYSTEMD_RUN_LIMITS.memoryMax` | `16G` | `16G` |
| `buildSystemdRunArgv("bash scripts/test.sh")` | `["systemd-run","--user","--scope","--quiet","-p","MemoryMax=16G","bash","-c","bash scripts/test.sh"]` | **逐字节相同** |

**唯一可观测差异**：probe 的输出契约是 `effective_mem_mb`（MB 精度，跨项目冻结），折回 bytes 后
丢掉子 MB 余数。大宿主上两者都越过 16G 上限 ⇒ argv 完全不变（红线守住）；三档 cgroup 上限都是
MB 对齐的，折返无损（见 AC3）。

### AC3 —— 2/4/8 vCPU 真实 cgroup 容器模拟（三档实测读数，⛔ 无预测值）

每档一个**真实** `systemd-run --user --scope`（unit 名刻意不匹配 quay 自己的前缀，当**外部**容器上限），
在**同一个 cgroup 内**的同一进程里同时输出：内核原始 `memory.max` / 旧实现读数 / 新实现读数。

| 档位（模拟） | scope 属性 | 内核 `memory.max` | 内核 `cpu.max` | `availableParallelism` | 改动前读数 | 改动后读数 | 一致 | probe `effective_mem_mb` / `mem_source` | 派生 `MemoryMax` |
|---|---|---|---|---|---|---|---|---|---|
| 2 vCPU / 4GB | `CPUQuota=200% MemoryMax=4G` | 4294967296 | `200000 100000` | 2 | 4294967296 | 4294967296 | ✅ | 4096 / `cgroup-memory-max` | 1073741824（1G） |
| 4 vCPU / 8GB | `CPUQuota=400% MemoryMax=8G` | 8589934592 | `400000 100000` | 4 | 8589934592 | 8589934592 | ✅ | 8192 / `cgroup-memory-max` | 2147483648（2G） |
| 8 vCPU / 16GB | `CPUQuota=800% MemoryMax=16G` | 17179869184 | `800000 100000` | 8 | 17179869184 | 17179869184 | ✅ | 16384 / `cgroup-memory-max` | 4294967296（4G） |

三档 `old_equals_new = true` ⇒ **替换没有改变语义，只是去重**；外部容器上限照常被消费。与 AC1 的
"quay 自己的层被跳过"合起来，即完整的保留语义。

### AC4 —— 测试（数量只增不减）

| 文件 | 改动前 | 改动后 |
|---|---|---|
| `plugin/test/effective-capacity-probe.test.mjs` | 13 pass | **19 pass** |
| `plugin/test/full-suite-runner-cgroup.test.mjs` | 37 执行（36 pass / 1 fail —— 该 fail 正是一条钉住旧实现"精确字节"形状的断言） | **38 pass / 0 fail** |

新增覆盖"排除 quay 自己 scope 前缀"：
- **真实嵌套 cgroup**（`full-suite-runner-cgroup.test.mjs`，AC1 第 2 条）——真实内核 `memory.max` 回读
  （1G 祖先被跳过 / 4G 子层被消费），不是 mock。
- **磁盘 cgroup 形状 fixture 驱动的单元测试 6 条**（`effective-capacity-probe.test.mjs`）：祖先层被跳过
  + 更紧的被排除层不影响结果 + 三个前缀各自被跳过 + 三条 fail-open 路径（无 v2 / 无 `0::` 行 /
  畸形路径）+ `memoryLayers` self/ancestors 的差异 + `ignoreEnvSeams` 对五条测试缝的隔离。

**唯一被修改的既有断言**：单层 negative control 原先断言 `effective === os.totalmem()`（旧实现的精确
字节）。按 AC2 已实测的 MB 截断事实，改为 `totalmem - 2MiB < effective ≤ totalmem` —— 被排除层的 1G
若被消费会立刻违反它（读数塌到 1G），判别力不减；并新增 `memoryMax === "16G"` 的直接断言。

### AC5 —— 无跨项目锁/配额机制

改动面仅：`plugin/scripts/full-suite-runner.ts`、`plugin/scripts/effective-capacity-probe.ts`、
`plugin/scripts/capability-catalog-declarations.json`（消费者声明刷新，原文写"零真实消费者"已失真）、
两个测试文件。⛔ 未引入任何锁 / 配额 / 共享槽
（`gap-cross-project-resource-gate-no-declarative-quota-or-shared-slot` 的"不做锁"方向未被触碰）。

### AC6 —— scoped 门

`bash scripts/test.sh --for-task gap-full-suite-runner-dedupe-memory-envelope-to-probe --allow-thin`
exit 0（在本任务 worktree、`git merge --no-edit develop` 之后执行）。

### AC7（待外部）—— 承接者

`.quay/verification-round.jsonl` 的轮次由**全量 suite 跑完**才追加，而全量 suite 由 driver 的机械
fan-in（`worker-driver.ts runMechanicalFanIn`）在本 worker 退出**之后**执行 ⇒ 本 worker 结构上无法在
落地前产出"落地后的 ≥3 个新轮次"（硬规则 4 推论三：实现完成那一刻该载体必然为空，现在写进去的只会是
不含本改动的假归属记录）。

**承接者**：`worker-driver.ts runMechanicalFanIn` —— 它落地本任务时追加**第 1 个**含本改动的轮次；
其后每轮常规 fan-in 继续追加。**判据/量级基线**（改动前同量级，取自 `.quay/verification-round.jsonl`
尾部 round 2490-2492）：`pass` 6961–9041、`fail` 0、`durationMs` 132803–154413 ms ⇒ 期望
≥3 个新轮次的 `pass` 同区间、`fail` 0（或仅为与 `full-suite-runner` / `effective-capacity-probe`
无关的既有 flake 文件）、`durationMs` 同量级。⛔ "取 ≥3 个新轮次并核对"是人工/后续核对动作
（无自动 routine 会回来勾这条）。