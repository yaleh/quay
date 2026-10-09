---
id: gap-effective-capacity-cgroup-cpu-memory-probe
title: 新增 cgroup v2 感知的"有效资源探测"(cpu.max bandwidth quota + memory.max)——现有
  nproc/os.totalmem() 读数不区分容器/cgroup 配额
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Finding

**本任务是人 2026-10-09 架构裁定（DIR-132）"低算力环境测试稳定性优先于跨项目统一锁"的第一个落点**：无副作用环境能力探测,后续的 worker 收缩/内存预算/任务背压/分级验证都要消费这里的探测结果。

**现有读数不够用,已读代码确认**：
- `plugin/scripts/resource-gate.sh`/`plugin/scripts/process-budget.sh` 用 `nproc`/`nproc --all`——这是 affinity/host-wide 核数,`gap-systemd-run-cpuquota-scope-distorts-nproc` 的既有注释已经写明这是**刻意**为"host-wide loadavg 该跟多大核数比"这个不同问题选的读数,不读 `/sys/fs/cgroup/cpu.max` 的 CFS bandwidth quota（容器/cgroup 实际被限制到多少"有效核"）。
- `plugin/scripts/driver-runtime.ts`/`driver-anchor.ts` 的"宿主推导内存包络"公式（`gap-driver-anchor-runs-without-host-derived-memory-envelope`，done）用 `os.totalmem()`——这是 host `/proc/meminfo` 的总内存，**不读** cgroup `memory.max`。如果 quay（或 ClaudeCodeUI）被装在一个内存受限的容器/cgroup 里，这个公式会算出远大于真实可用量的内存包络，削弱该机制本来要提供的 OOM 保护。
- `plugin/scripts/runner-concurrency.ts` 的并发推导用 `os.availableParallelism()`——按 Node.js 文档这个 API **可能**已经考虑容器 CPU quota（不只是 cpuset affinity），但本仓库目前没有任何测试或实测记录验证过这一点，不能当已确认结论使用，必须先测再下结论。

**跨项目协同（2026-10-09，已对齐，各自独立实现）**：ClaudeCodeUI 项目的会话独立发现了同一个缺口，提出了他们自己的实现方向（暂定脚本名 `effective-capacity.sh`，读 `/sys/fs/cgroup/cpu.max`（quota/period）算有效核数、`/sys/fs/cgroup/memory.max` 算有效内存上限，非 cgroup v2 环境 fail-open 退回 nproc/free-m），并提议对齐输出字段形状（`key=value` 多行 + `--json`，env override 测试缝风格同 `resource-gate.sh` 的既有约定如 `RESOURCE_GATE_TEST_*`）。双方已确认"各自独立实现、不互相阻塞、不强依赖"——本任务**不能**假设 ClaudeCodeUI 的脚本存在或已完成，必须在 quay 自己仓库内独立可用。

## AC

- [ ] 先验证 `os.availableParallelism()` 在本仓库是否已经对 cgroup CPU quota 敏感（不是假设）：构造一个真实的 cgroup v2 测试 scope，用 `systemd-run --user --scope -p CPUQuota=50%`（或等价）把当前 shell 限制到一个已知的有效核数，在该 scope 内跑 `node -e "console.log(os.availableParallelism())"`，核对输出是否反映了 quota 而非 host 总核数。把实测结果（反映了 / 没反映）如实写入任务体，不要预设答案。
- [ ] 新增一个无副作用（只读、不改变任何现有行为）的探测能力：读 `/sys/fs/cgroup/cpu.max`（格式 `<quota> <period>`，`max` 表示无限制）算出有效核数（`quota<=0 or quota=="max"` ⇒ 回退到现有 host 读数；否则 `effective_cpus = quota/period`，向下取整但至少 1）；读 `/sys/fs/cgroup/memory.max`（`max` 表示无限制 ⇒ 回退到 `os.totalmem()`；否则取该值）。cgroup v2 不可用（文件不存在/不是数字）时 **fail-open** 回退到现有读数（`os.availableParallelism()`/`nproc`、`os.totalmem()`/`free -m`），不得 fail-closed 拒绝运行。
- [ ] 输出形状与 ClaudeCodeUI 侧对齐（协调记录见本任务 Finding）：`key=value` 多行输出 + `--json` 标志，字段至少包含来源可区分的态（例如 `cpu_source=cgroup-quota|host-affinity`、`mem_source=cgroup-max|host-total`），不与"读不出"同形（硬规则3b——探测失败必须是独立的、可区分的第三态,不能悄悄退化成看起来正常的默认值）。测试缝沿用 `RESOURCE_GATE_TEST_*` 命名风格的 env override,方便两个项目的测试都能注入确定性读数。
- [ ] 单测：真实构造至少一个 cgroup v2 cpu.max/memory.max 受限的子进程场景（同 `driver-anchor-memory-envelope.test.mjs` AC4 的真 cgroup 负控制手法，不是纯 mock），验证探测函数读出的有效值与实际施加的限制一致；cgroup v2 不可用的宿主上这部分测试判定为 `not-evaluated`/`skip`,不算 pass,也不算 fail。
- [ ] 本任务只新增探测能力,**不**修改任何现有调用点的行为（`resource-gate.sh`/`process-budget.sh`/`driver-anchor.ts` 的现有读数在本任务落地后应该逐字节不变——消费这个新探测结果是后续任务（`gap-full-suite-runner-memory-max-host-derived-envelope`，另案）的事）。
- [ ] scoped 门：`bash scripts/test.sh --for-task gap-effective-capacity-cgroup-cpu-memory-probe --allow-thin` exit 0。

## DoD

必须有真实 cgroup v2 环境下的实测读数（不是纯理论推导），探测能力必须 fail-open（cgroup 不可用时不拒绝运行），必须不改变任何现有消费者的当前行为（本任务只新增能力，接入是下一个任务的事）。不得假设 ClaudeCodeUI 的 `effective-capacity.sh` 存在或与之耦合——quay 自己必须能独立工作。

## Touches

- plugin/scripts/resource-gate.sh
- plugin/scripts/effective-capacity-probe.ts（新文件，具体文件名实施时可调整，但须在 Touches 里如实更新）
- plugin/test/effective-capacity-probe.test.mjs（新文件）
- tasks/gap-effective-capacity-cgroup-cpu-memory-probe.md