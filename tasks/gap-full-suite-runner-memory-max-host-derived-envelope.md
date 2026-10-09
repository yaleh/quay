---
id: gap-full-suite-runner-memory-max-host-derived-envelope
title: full-suite-runner.ts 的 systemd-run MemoryMax 仍是写死 "16G"（128核大宿主上调的）——套用
  driver-anchor 已验证的宿主推导包络,不改变大宿主现有行为
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Finding

**本任务是人 2026-10-09 架构裁定（DIR-132）"低算力环境测试稳定性优先"的第二个落点**，依赖 `gap-effective-capacity-cgroup-cpu-memory-probe`（另案，提供 cgroup-aware 的有效内存读数）的探测结果。

**现状（读代码确认）**：`plugin/scripts/full-suite-runner.ts:993` 当前：

```
export const DEFAULT_SYSTEMD_RUN_LIMITS: SystemdRunLimits = {
  memoryMax: "16G",
  cpuQuota: "",
  tasksMax: "",
};
```

该文件 `:992` 的注释写明演变历史：4G（2026-08-12 OOM 实证不足）→6G（人裁定，4核旧机）→**16G**（人 2026-09-24 裁定，迁到 128 核宿主后 main lane 并发 64/128、suite 无上限时实测峰值 8–10.5G、6G 下每轮顶格数千次 memory.max 事件导致时序断言飘红）。cpuQuota/tasksMax 已经按人 2026-08-11/08-12 的裁定清空为不限制（CLAUDE.md 推论二的教训——写死字面量在换机器后变成真限制，已经被 CPU/Tasks 两维吸收）。**但 MemoryMax 这一维仍是个写死字面量**，它是**为一台特定的大宿主调的经验值**，不是通用默认：在一台只有 2-8GB 总内存的宿主上，`MemoryMax=16G` 会超过宿主自身总内存，cgroup 层面的这道防线形同不存在——真正触发的会是内核直接 OOM kill（不可控、不记账），而不是受控的 cgroup `memory.max` oom_kill（`gap-driver-anchor-runs-without-host-derived-memory-envelope` 已经证明过受控 oom_kill 这条路径真实有效，但只给了 driver-anchor，没有给 suite 本身）。

**已有可复用的证明过的公式**：`gap-driver-anchor-runs-without-host-derived-memory-envelope`（done）的 `floor(totalmem×0.25)` 页对齐公式 + 真 cgroup 负控制（注入 64M 限制验证内核真的 oom_kill）已经证明这个模式可行。本任务要做的是把同一模式套到 `full-suite-runner.ts` 的 `DEFAULT_SYSTEMD_RUN_LIMITS.memoryMax` 上——但消费的"host memory"读数必须用 `gap-effective-capacity-cgroup-cpu-memory-probe` 产出的 cgroup-aware 读数（不能继续用不区分容器配额的 `os.totalmem()`，否则只是把同一个盲点复制一遍）。

**约束（人已强调,不能违反）**：不能直接改全局默认值或打断生产测试。当前 128 核宿主上的生产基线（峰值 8–10.5G，经验证 16G 是安全上限）**不能变**——新公式必须在该宿主上算出来后被钳在同一个 16G 上限（即 `min(host-derived, "16G")`，或等价的"经验上限不降低"写法），这样大宿主行为逐字节不变，只有真正内存受限的小宿主才会得到一个比 16G 小、真正反映其实际可用量的值。

## AC

- [ ] 消费 `gap-effective-capacity-cgroup-cpu-memory-probe` 产出的有效内存读数（如果该任务尚未落地，本任务可以先用一个临时的、同样 fail-open 的内联读数实现，但必须在 Touches/Finding 里明确记录"后续应切换为共享探测函数，不重复发明"，不得假装没有这个依赖关系）。
- [ ] 新公式：`memoryMax = min(floor(effective_total_mem × 0.25)（页对齐，同 driver-anchor 公式）, 当前经验上限 16G)`——在 128 核大宿主上（effective_total_mem 远大于 64G）新公式必须算出恰好 16G（或等价表达，使 `buildSystemdRunArgv` 产出的 argv 与改动前逐字节相同），在一个实测的小内存环境（真实 cgroup memory.max 设置成一个远小于默认 16G 的值，例如 2G/4G）下，公式必须算出比 16G 小、按比例推导出的值。两种场景的实测读数都要贴入任务体,不写预测。
- [ ] 既有测试（`full-suite-runner.test.mjs` 等覆盖 `DEFAULT_SYSTEMD_RUN_LIMITS`/`buildSystemdRunArgv` 的用例）全部保持通过,测试数量不减少;新增至少一条覆盖"大宿主上数值不变"与至少一条覆盖"小内存场景数值按比例收缩"的测试(真 cgroup 构造,不是纯 mock,同 driver-anchor 测试的手法)。
- [ ] 同机前后对照：在当前这台 128 核宿主上，改动前后分别跑 `node -e` 直接调用 `buildSystemdRunArgv` 打印出的 argv（或等价的单元级读数），确认改动后在这台机器上输出与改动前逐字节相同——这是"不打断生产测试"这条约束的直接证据，不是推断。
- [ ] 落地并经过真实 worktree/driver 执行后，从 `.quay/verification-round.jsonl` 取 ≥3 个新轮次确认全量套件在本机（128核）上的 pass/fail/durationMs 与改动前处于同一量级（不要求完全相同，但不应出现本改动引入的新红）。
- [ ] scoped 门：`bash scripts/test.sh --for-task gap-full-suite-runner-memory-max-host-derived-envelope --allow-thin` exit 0。

## DoD

必须证明大宿主（本机 128 核）上的生产行为逐字节不变（argv 相同），且必须有一个真实的小内存 cgroup 场景的实测读数证明新公式在那种环境下会给出一个更小、更安全的值（不是纯理论推导）。不得在没有验证"大宿主不变"这一条之前就落地——这是人明确强调的红线（不能直接改全局默认值或打断生产测试）。

## Touches

- plugin/scripts/full-suite-runner.ts
- plugin/test/full-suite-runner.test.mjs
- tasks/gap-full-suite-runner-memory-max-host-derived-envelope.md
