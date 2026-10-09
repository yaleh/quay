---
id: gap-full-suite-runner-dedupe-memory-envelope-to-probe
title: full-suite-runner.ts 的 readEffectiveTotalMemBytes() 是内联重复实现，未真正调用
  effective-capacity-probe.ts——两个已 done 任务都没有完成这条自己留的 TODO
status: todo
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

- [ ] 把 `plugin/scripts/full-suite-runner.ts` 的 `readEffectiveTotalMemBytes()` 改为实际调用 `plugin/scripts/effective-capacity-probe.ts` 导出的 `computeEffectiveCapacity`（配合它的 raw-reading 收集函数），取其 `effective_mem_mb` 字段（换算回 bytes）作为返回值，删除/替换掉 `full-suite-runner.ts` 里重复的 cgroup 层级遍历代码（`selfCgroupV2Path`/`readCgroupMemoryMaxBytes` 等，若替换后不再被其它地方使用）。**保留** "排除 quay 自己的 `quay-anchor-`/`quay-serve-`/`run-` 前缀 scope" 这条语义——probe 模块当前不做这个排除（它读的是"本进程自己的 cgroup"，不遍历祖先链），需要先确认这条排除语义在改造后是否仍然必要、以何种方式保留（不能静默丢弃，必须在任务体里写清楚怎么处理的）。
- [ ] 同机前后对照（本机 128 核大宿主）：改动前后分别调用 `readEffectiveTotalMemBytes()`（或等价的单元级读数），确认 `buildSystemdRunArgv` 产出的 argv 逐字节不变（仍是 `MemoryMax=16G`）——这是"不打断生产测试"红线的直接证据。
- [ ] **2/4/8 vCPU 容器模拟验收（真实 cgroup，不是纯 mock）**：用 `systemd-run --user --scope -p CPUQuota=200% -p MemoryMax=4G`（模拟 2 vCPU/4GB）、`-p CPUQuota=400% -p MemoryMax=8G`（模拟 4 vCPU/8GB）、`-p CPUQuota=800% -p MemoryMax=16G`（模拟 8 vCPU/16GB）三档真实 scope，在每一档内分别跑改动前的内联实现与改动后调用 probe 的实现，对照两者的 `effective_total_mem`/`effective_mem_mb` 读数是否一致（证明替换没有改变语义，只是去重）；三档读数（内核实际 `memory.max` / 改动前输出 / 改动后输出）全部贴入任务体，不写预测值。
- [ ] 既有测试（`full-suite-runner.test.mjs`、`effective-capacity-probe.test.mjs`）全部保持通过，测试数量不减少；新增覆盖"排除 quay 自己 scope 前缀"这条语义在改造后仍然成立的测试（真实构造一层嵌套 `quay-anchor-*` scope 内再跑一层限制更紧的外层 scope，断言排除逻辑仍生效）。
- [ ] 本任务不引入、不依赖任何跨项目锁/配额机制（`gap-cross-project-resource-gate-no-declarative-quota-or-shared-slot` 已明确选择"不做锁"，本任务与之无关，不得因为"方便"而重新引入该方向）。
- [ ] scoped 门：`bash scripts/test.sh --for-task gap-full-suite-runner-dedupe-memory-envelope-to-probe --allow-thin` exit 0。
- [ ] 落地并经过真实 worktree/driver 执行后，从 `.quay/verification-round.jsonl` 取 ≥3 个新轮次确认本机（128核）全量套件 pass/fail/durationMs 与改动前处于同一量级，不引入新红。

## DoD

必须证明大宿主（128核）上生产行为 argv 逐字节不变；必须有三档真实 cgroup 容器模拟的实测对照数据（不是预测）；必须保留"排除 quay 自己 scope"这条语义且有测试覆盖；不得引入任何跨项目锁依赖。完成后 `grep -n "effective-capacity-probe" plugin/scripts/full-suite-runner.ts` 必须命中真实的 import/调用，不能只剩注释。

## Touches

- plugin/scripts/full-suite-runner.ts
- plugin/scripts/effective-capacity-probe.ts
- plugin/test/full-suite-runner.test.mjs
- tasks/gap-full-suite-runner-dedupe-memory-envelope-to-probe.md