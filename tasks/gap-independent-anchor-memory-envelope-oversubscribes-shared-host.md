---
id: gap-independent-anchor-memory-envelope-oversubscribes-shared-host
title: 多个项目各自独立的 anchor/serve memory.max 包络（host×0.25）在共享宿主上求和超过主机总内存 2.2 倍——实测，非推测
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Finding

**本任务源于一次实测,不是推测**（2026-10-10，本机，`cat /sys/fs/cgroup/.../*.scope/memory.max` 直接读数）：

主机总内存 **247.0GB**（`free -b` 实测）。当前活着的 systemd user scope 逐一读数：

```
quay-anchor-quay-1791356167667.scope         memory.max=66295676928 (61.74GB)
quay-anchor-quay-1791631399397.scope         memory.max=66295676928 (61.74GB)   ← 同一项目两个 anchor 实例同时活着
quay-anchor-claudecodeui-1791629230428.scope memory.max=66295676928 (61.74GB)
quay-anchor-cantus-1791244278636.scope       memory.max=66295676928 (61.74GB)
quay-anchor-anchor-boundary-IfIFT6-...scope  memory.max=66295676928 (61.74GB)   ← 来源未查，疑似测试遗留
quay-serve-cantus-1791380761097.scope        memory.max=66295676928 (61.74GB)
quay-serve-dbg-serve-ws-71sgS2-...scope      memory.max=66295676928 (61.74GB)
run-u176787.scope / run-u176974.scope        memory.max=34359738368 (32.00GB) ×2  （suite 包络）
run-u180991.scope / run-u180997.scope        memory.max=17179869184 (16.00GB) ×2
run-u38233.scope                             memory.max=17179869184 (16.00GB)
```

**12 个 scope 的 memory.max 求和 = 584,328,822,784 bytes ≈ 544.2GB —— 是主机总内存 247.0GB 的 2.2 倍。**

**根因**：`driver-runtime.ts`/`full-suite-runner.ts` 的"宿主推导内存包络"公式（`gap-driver-anchor-runs-without-host-derived-memory-envelope`/`gap-full-suite-runner-memory-max-host-derived-envelope`，均 done）各自独立计算 `floor(os.totalmem()×0.25)`（或经 `gap-full-suite-runner-dedupe-memory-envelope-to-probe` 后的 cgroup-aware 等价值）——**这个公式隐含一个未声明的假设："宿主上只有我一个项目在做同样的事"**。本机实测至少 3 个不同项目（quay、claudecodeui、cantus）+1 个同项目的重复 anchor 实例 + 1 个来源未查的遗留 scope，全部独立套用同一公式，彼此互不知道对方存在。

**与已关闭的两个相邻任务的区别（不是同一个问题的重复立案）**：
- `gap-cross-project-resource-gate-no-declarative-quota-or-shared-slot`（done）处理的是**瞬时竞态**——两个项目"几乎同时"触发起跑检查；它选择"不加锁，只订正文档期望值"，依据是"没有实际发生过的竞态证据"（硬规则12）。
- 本任务是**稳态结构问题**，不涉及任何时序竞争——不需要"同时起跑"，只要 N 个项目都长期挂着各自的 anchor（本来就是常驻进程，不是瞬时事件），它们的 ceiling 之和就天然超过主机容量。**本任务有发生率证据**（上面的实测本身就是证据，不是等待一个概率性事件），不受硬规则12"无发生率不立案"的限制。
- **不是正在发生的 OOM**（当前各 scope 的 `memory.current` 都远低于各自 ceiling——`quay-anchor-claudecodeui` 实测仅用 4.6GB，`quay-anchor-cantus` 仅用 4.0GB）。但"受控 cgroup OOM 保护"这个机制的核心承诺——"某个项目用超了，只会在它自己的 cgroup 里被杀，不影响别人"——在多项目同时把真实用量推高时是**假**的：host 层面能分配的物理内存是有限的 247GB，不是 544GB；多个 anchor 同时接近各自 ceiling 时，先触发的会是宿主级不可控 OOM killer（可能误杀任意项目的任意进程），不是某一个 cgroup 内受控的 `memory.max` oom_kill。

**跨项目协同现状**：已与 ClaudeCodeUI（`ClaudeCodeUI 持续语音流输入架构设计` 会话）同步本发现，对方的持续语音流处理场景因为内存占用容易随时间增长，是最可能先把某个 anchor 推向其 ceiling 附近的负载形态之一。尚未收到对方实测的长时间运行内存曲线数据。

## AC

- [ ] 核实"anchor-boundary"遗留 scope 的来源（是否是某次测试/fixture 未清理），如实记录处置结果（清理或说明为何保留）；本条与主线逻辑无关，不得阻塞其它 AC。
- [ ] 不引入跨进程锁/预留/互斥机制（DIR-132 与 `gap-cross-project-resource-gate-no-declarative-quota-or-shared-slot` 已明确的方向，本任务不得重新引入该方向）。方案必须是**只读感知**：anchor/suite 在计算自己的 `0.25` 分数前，先只读探测"宿主上当前还有多少个同类（`quay-anchor-*`/`quay-serve-*`）的 scope 存活"（枚举 `/sys/fs/cgroup/.../app.slice/*.scope`，按前缀计数，不需要任何跨项目协议/配置文件），据此把自己的固定 `0.25` 改成 `min(0.25, 1/(N+1))` 或等价的、随活跃同类数收紧的公式（N = 探测到的其它同类 scope 数，不含自己；公式细节与取舍依据需要在任务体里写清楚，不能凭空选一个数）。
- [ ] 保留 DIR-132 的"缺跨项目配置时完全独立运行"硬性要求：探测函数在读不到 `/sys/fs/cgroup`（非 Linux / systemd-run 不可用 / 单机单项目场景）时必须 fail-open 回退到原有的固定 `0.25`，不得拒绝运行、不得要求任何外部配置存在。
- [ ] 同机前后对照（本机 128 核 247GB 大宿主）：改动前后分别读当前真实存活的同类 scope 数量，计算新公式在该 N 下算出的分数值与对应的 MemoryMax 具体数字，贴入任务体（不写预测）。若改动后在"只有自己一个 anchor 存活"场景下算出的值与改动前的固定 0.25 相同（即 N=0 时退化为原行为），这是**必须满足**的回归要求（现有 128 核大宿主的单项目行为不能变）。
- [ ] 既有测试（`driver-anchor-memory-envelope.test.mjs`、`full-suite-runner-cgroup.test.mjs` 等覆盖该公式的用例）全部保持通过，测试数量不减少；新增至少一条真实构造"多个同类 scope 同时存活"场景（同 `[[nested-systemd-run-scope-does-not-nest-use-cgroup-delegation]]` 记录的真实 cgroup 构造手法，不是纯 mock）的测试，验证新公式确实按存活数收紧。
- [ ] scoped 门：`bash scripts/test.sh --for-task gap-independent-anchor-memory-envelope-oversubscribes-shared-host --allow-thin` exit 0。
- [ ] 落地并经过真实 worktree/driver 执行后，用 `cat /sys/fs/cgroup/.../*.scope/memory.max` 之类的真实读数核实至少一次"多项目同时存活"场景下的求和确实比改动前更贴近主机总量（不要求精确等于，但方向必须是收紧），贴入任务体。

## DoD

必须有改动前后的真实读数对照（不是预测）；必须保留单项目场景下与现有 128 核大宿主生产行为的逐字节兼容（AC3 的回归要求）；不得引入任何跨进程锁或配置依赖；fail-open 行为必须保留且有测试覆盖。

## Touches

- plugin/scripts/driver-runtime.ts
- plugin/scripts/full-suite-runner.ts
- plugin/scripts/effective-capacity-probe.ts
- plugin/test/driver-anchor-memory-envelope.test.mjs
- plugin/test/full-suite-runner-cgroup.test.mjs
- tasks/gap-independent-anchor-memory-envelope-oversubscribes-shared-host.md
