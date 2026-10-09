---
id: gap-full-suite-runner-memory-max-host-derived-envelope
title: full-suite-runner.ts 的 systemd-run MemoryMax 仍是写死 "16G"（128核大宿主上调的）——套用
  driver-anchor 已验证的宿主推导包络,不改变大宿主现有行为
status: done
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

- [x] 消费 `gap-effective-capacity-cgroup-cpu-memory-probe` 产出的有效内存读数（如果该任务尚未落地，本任务可以先用一个临时的、同样 fail-open 的内联读数实现，但必须在 Touches/Finding 里明确记录"后续应切换为共享探测函数，不重复发明"，不得假装没有这个依赖关系）。
- [x] 新公式：`memoryMax = min(floor(effective_total_mem × 0.25)（页对齐，同 driver-anchor 公式）, 当前经验上限 16G)`——在 128 核大宿主上（effective_total_mem 远大于 64G）新公式必须算出恰好 16G（或等价表达，使 `buildSystemdRunArgv` 产出的 argv 与改动前逐字节相同），在一个实测的小内存环境（真实 cgroup memory.max 设置成一个远小于默认 16G 的值，例如 2G/4G）下，公式必须算出比 16G 小、按比例推导出的值。两种场景的实测读数都要贴入任务体,不写预测。
- [x] 既有测试（`full-suite-runner.test.mjs` 等覆盖 `DEFAULT_SYSTEMD_RUN_LIMITS`/`buildSystemdRunArgv` 的用例）全部保持通过,测试数量不减少;新增至少一条覆盖"大宿主上数值不变"与至少一条覆盖"小内存场景数值按比例收缩"的测试(真 cgroup 构造,不是纯 mock,同 driver-anchor 测试的手法)。
- [x] 同机前后对照：在当前这台 128 核宿主上，改动前后分别跑 `node -e` 直接调用 `buildSystemdRunArgv` 打印出的 argv（或等价的单元级读数），确认改动后在这台机器上输出与改动前逐字节相同——这是"不打断生产测试"这条约束的直接证据，不是推断。
- [ ] 落地并经过真实 worktree/driver 执行后，从 `.quay/verification-round.jsonl` 取 ≥3 个新轮次确认全量套件在本机（128核）上的 pass/fail/durationMs 与改动前处于同一量级（不要求完全相同，但不应出现本改动引入的新红）。（待外部）
- [x] scoped 门：`bash scripts/test.sh --for-task gap-full-suite-runner-memory-max-host-derived-envelope --allow-thin` exit 0。

## DoD

必须证明大宿主（本机 128 核）上的生产行为逐字节不变（argv 相同），且必须有一个真实的小内存 cgroup 场景的实测读数证明新公式在那种环境下会给出一个更小、更安全的值（不是纯理论推导）。不得在没有验证"大宿主不变"这一条之前就落地——这是人明确强调的红线（不能直接改全局默认值或打断生产测试）。

## Touches

- plugin/scripts/full-suite-runner.ts
- plugin/test/full-suite-runner-cgroup.test.mjs
- tasks/gap-full-suite-runner-memory-max-host-derived-envelope.md

## Evidence

**改动（`plugin/scripts/full-suite-runner.ts`）**：新增 `SUITE_MEMORY_MAX_CEILING = "16G"`（人裁定的经验上限，保留 STRING 形态以保 argv 逐字节）、`QUAY_OWN_SCOPE_PREFIXES`、`selfCgroupV2Path()`、`readCgroupMemoryMaxBytes()`、`readEffectiveTotalMemBytes()`、纯函数 `suiteMemoryMax(effectiveTotalMemBytes)`；`DEFAULT_SYSTEMD_RUN_LIMITS.memoryMax` 改为 `suiteMemoryMax(readEffectiveTotalMemBytes())`。复用 `packages/quay/src/systemd-scope.ts` 的 `defaultScopeMemoryMax`（driver-anchor 的同一份页对齐公式，⛔ 不重复发明；该 edge 经 `import-graph-check --gate` 验证 valueSccs 仍为 0）。

### AC1 — 消费 cgroup-aware 有效内存读数（临时内联，依赖已记录）
`readEffectiveTotalMemBytes()` 读 `/proc/self/cgroup` 的 `0::<path>`，自 cgroup2 挂载根逐层取 `memory.max` 的最小值，**跳过 quay 自己的包络 scope**（`quay-anchor-*` / `quay-serve-*` / `systemd-run` 无 `--unit` 时的瞬时 `run-*` —— 套件自己的 scope 正是其中一种），再与 `os.totalmem()` 取 min；cgroup v2 不可读 / 无外部限制 ⇒ fail-open 回退 `os.totalmem()`（⛔ 不拒绝运行）。
⚠️ **依赖未落地 + 后续应切换为共享探测函数、不重复发明**：`gap-effective-capacity-cgroup-cpu-memory-probe`（**todo**，未落地）产出的 `plugin/scripts/effective-capacity-probe.ts` 落地后，本文件的 `readEffectiveTotalMemBytes()`【必须】替换为对它的调用——这是**临时内联实现**，源码注释（`full-suite-runner.ts` 该函数上方）与本节都点名了这一点。
本机读数：`readEffectiveTotalMemBytes() = 265182715904 == os.totalmem()`（`quay-anchor-*` 祖先的 66295676928 被正确跳过）。

### AC2 — 新公式 + 两种场景实测读数（⛔ 非预测）
纯函数：`suiteMemoryMax(256G)="16G"`、`suiteMemoryMax(4G)="1073741824"`、`suiteMemoryMax(2G)="536870912"`（页对齐、随宿主比例变化）。
- **大宿主（本 128 核机）**：`DEFAULT_SYSTEMD_RUN_LIMITS.memoryMax = "16G"`；`buildSystemdRunArgv("bash scripts/test.sh")` = `["systemd-run","--user","--scope","--quiet","-p","MemoryMax=16G","bash","-c","bash scripts/test.sh"]`。
- **真实小内存 cgroup（systemd-run --scope，非 mock）**：
  ```
  $ systemd-run --user --scope --quiet --unit=quay-suite-memtest-<ts>.scope -p MemoryMax=4G -p MemorySwapMax=0 node … -e "<import runner; print>"
  effective=4294967296
  memoryMax=1073741824          # = floor(4G × 0.25)，远小于 16G
  ```
- **真 cgroup 负控制（红线机制）**：把我们**自己的** envelope 名 `quay-anchor-*` 压到 1G，读数必须**跳过**它、仍给 16G：
  ```
  $ systemd-run --user --scope --quiet --unit=quay-anchor-fsr-probe-<ts>.scope -p MemoryMax=1G -p MemorySwapMax=0 node … -e "<import runner; print>"
  effective=265182715904        # == os.totalmem()，1G 上限未被消费
  memoryMax=16G
  ```

### AC3 — 测试（数量不减少 + 新增真 cgroup 用例）
`node --test plugin/test/full-suite-runner-cgroup.test.mjs` ⇒ **37 pass / 0 fail**（改动前 32 条既有用例全部保持通过；新增 5 条）。新增：①"大宿主上数值不变 + argv 逐字节"（含 `os.totalmem()≥64G` 分支下的 argv 字面量相等断言）；②"小内存按比例收缩"（4G/2G/8G + 页对齐 + 2× 比例）；③`readEffectiveTotalMemBytes` fail-open；④**REAL cgroup** 4G scope → `1073741824`；⑤**REAL cgroup 负控制** `quay-anchor-*` scope → 跳过（effective==totalmem）。④⑤均用 `systemd-run --user --scope` 真 cgroup 构造，systemd-run 不可用时输出独立取值 skip（⛔ 不算 pass）。

### AC4 — 同机前后 argv 逐字节对照（本 128 核机，直接证据）
```
BEFORE (develop, 改动前): ["systemd-run","--user","--scope","--quiet","-p","MemoryMax=16G","bash","-c","bash scripts/test.sh"]
AFTER  (worktree, 改动后): ["systemd-run","--user","--scope","--quiet","-p","MemoryMax=16G","bash","-c","bash scripts/test.sh"]
⇒ 逐字节相同（"DEFAULT.memoryMax" 前后均 = "16G"）
```

### AC5 — 待外部（post-landing 的累积事实）
本 AC 要求"落地并经过真实 worktree/driver 执行后"的新轮次读数——**其时间窗起点是 landing commit，而 landing 由 fan-in 的 ff-merge 在 worker 退出之后创建**（worker 不跑全量套件，且本改动此刻尚未落 develop）。故实现完成这一刻它在生产载体上**结构上必然为空**，⛔ 不能由 worker 预写一条落地前的记录（那是载体污染，硬规则 4 推论三）。
**承接者**：生产者 = 落 develop 后每一轮全量套件都会由 `full-suite-runner` 追加 `.quay/verification-round.jsonl`（**自动**，随常驻 driver 循环）；读取/勾选 = 之后任一 manager tick（或人）读这 ≥3 个新轮次的 `pass/fail/durationMs` 与改动前同量级后勾选（**最后一步非自动**，由 manager/人触发——如实声明）。

### AC6 — scoped 门
`bash scripts/test.sh --for-task gap-full-suite-runner-memory-max-host-derived-envelope --allow-thin` ⇒ **exit 0**（37/37，日志 `.quay/scoped-gate-round1.log`）。
**Touches 更正（filer 笔误）**：原 `## Touches` 写的是 `plugin/test/full-suite-runner.test.mjs`——**该文件不存在**（`select-tests-for-touches.ts` 报 `no such indexed test file`，且 `plugin/scripts/full-suite-runner.ts` 的 basename-pair 也解析不到它）⇒ 改动前 scoped 门选中 **0 个测试文件**。覆盖 `DEFAULT_SYSTEMD_RUN_LIMITS`/`buildSystemdRunArgv` 的真实用例文件是 `plugin/test/full-suite-runner-cgroup.test.mjs`（本次新增测试也落在该文件），已把该 Touches 条更正为真实路径 ⇒ scoped 门现选中 1 个测试文件（1/3 resolved，thin ⇒ `--allow-thin`）。
