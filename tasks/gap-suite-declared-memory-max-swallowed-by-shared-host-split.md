---
id: gap-suite-declared-memory-max-swallowed-by-shared-host-split
title: 运维声明的套件 memory_max 被多 scope 分摊护栏静默压到 26G：声明值应只受 0.25×有效总量约束（人裁定可放大到 32G）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Proposal

**人 2026-10-15 裁定**：可接受把套件 `MemoryMax` 放大到 32G（不做主机级治理）。

**真实读数（2026-10-15，quay-fleet Manager 会话只读核实）**
- 本机 `os.totalmem()` = 247.0 GiB；`listSharedHostScopes().count` = **17**（cantus / claudecodeui×2 / quay×2 / quay-fleet / litellm-fjd / muc-quay-v9 / terrain-pack anchors + 5 个 serve，**含** 测试泄漏的 `driver-cli-ac1-stop`、`e2e-restart-ac5`×2、`dbg-serve-ws`）。
- `sharedHostCeilingBytes(247 GiB, 17)` = min(0.25×total, max(total/18, 下限)) = **26.00 GiB**（下限主导）；quay 最近一轮 `suite-memory-evidence-*.json` 读到 `hostGuardBytes: 27917287424`、`memoryMax: 17179869184`、`bound: declared`。
- ⇒ 运维在 `.quay/config.yml` `suite: memory_max: 32G`（或 `QUAY_SUITE_MEMORY_MAX=32G`）会被 `suiteMemoryMax()` 静默压到 26G（`bound: host-guard`）：多 scope 分摊规则吞掉了人的显式声明。当前已按护栏值声明 `memory_max: 26G`（主检出 `.quay/config.yml`，按声明值生效）作为过渡。

**方案**
- `full-suite-runner.ts` 调 `suiteMemoryMax()` 处（约 1282–1290、1343–1350 行）：当 `declared.source !== "default"`（运维显式声明，config 或 env）时，护栏用**项目盲值** `defaultScopeMemoryMax(total, SCOPE_ENVELOPE_HOST_FRACTION)`（0.25×有效总量，本机 ≈ 61.7 GiB）作为上界；只有缺省值才继续走 `sharedHostCeilingBytes` 的多 scope 分摊。
- 不改 `sharedHostCeilingBytes` 本身、不改 0.25 比例、不改缺省 `16G`；超过 0.25×有效总量的声明仍被 `host-guard` 压住并带具名原因。

**实现落点（与上文一致，落在一个纯函数里而不是复制两次三元表达式——硬规则 5b）**
- 新增 `suiteHostGuard({effectiveTotalMemBytes, declared, siblingScopeCount})`（正本注释在 `plugin/scripts/full-suite-runner.ts`）：按 `declared.source` 选规则，返回 `{hostGuardBytes, rule, reason, siblingScopeCount}`，`rule` 是独立取值 `"project-blind" | "shared-host-split"`（硬规则 3b：声明被尊重 与 声明被压住 不得同形）。
- 两个生产调用点 `defaultSuiteMemoryMax()` / `resolveSuiteMemoryMax()` 改为经它选护栏；`suiteMemoryMax()` 新增可选 `hostGuard?: SuiteHostGuard`，把**规则名**带进既有证据字段 `memoryMaxPolicy.reason`（`guard rule: project-blind|shared-host-split`）——⛔ 不新增 *.jsonl、不动 `full-suite-runner-types.ts`。传裸 `hostGuardBytes` 的既有调用者（全部既有测试）输出逐字节不变。
- 连带清掉一处**被本次改动写旧的**散文（硬规则 5b 的同载体另一半）：`plugin/test/full-suite-runner-cgroup.test.mjs` 的头注释原写「`sharedHostCeilingBytes` 是 declared ceiling 的上界」，改动后对**声明**来的值不再成立，已改写为「缺省值走分摊 / 声明值走项目盲」并把规则的正本指回 `suiteHostGuard`（该文件因此进入 Touches）。

## Plan

1. 在 `suiteMemoryMax` 的调用处按 `declared.source` 选护栏；把选择结果与原因记入现有证据字段（不新增 *.jsonl）。
2. 新增单测覆盖三种情形（见 AC）。
3. 跑 `plugin/test/full-suite-runner-*.test.mjs` 回归。

## Acceptance Criteria

- [x] AC1: 单测：total=247 GiB、N=17、声明 `32G`（source=env）⇒ `memoryMax = 34359738368`、`bound: "declared"`。实测：`suiteHostGuard(...).rule = "project-blind"`、`hostGuardBytes = 66295676928`（= `defaultScopeMemoryMax(247 GiB, 0.25)`，⛔ 不是 26 GiB 分摊值）；`suiteMemoryMax({..., hostGuard}) ⇒ memoryMax 34359738368 / bound "declared" / reason null`。负控制（改前等价路径 = 把分摊值当护栏）：同一声明 ⇒ `memoryMax 27917287424 / bound "host-guard"`（正是被吞掉的样子）。测试 `AC1 — a DECLARED 32G ceiling is not swallowed...` + `AC1 (production wiring) — resolveSuiteMemoryMax routes a DECLARED ceiling through the project-blind guard` ✔。**本轮复核（tip `452fdf53e` + develop 再合并）**：`node --test plugin/test/full-suite-runner-declared-memory-guard.test.mjs` ⇒ `ℹ tests 5 / pass 5 / fail 0`，退出码 0 ✔。
- [x] AC2: 单测：同条件未声明（source=default）⇒ 护栏仍为多 scope 分摊值（26 GiB），`memoryMax` 为缺省 16G 不变。实测：`rule = "shared-host-split"`、`hostGuardBytes = 27917287424`（= `sharedHostCeilingBytes(247 GiB, 17)` = 26 GiB 整）、`memoryMax = 17179869184`、`bound "declared"`（16G < 26 GiB ⇒ 缺省值生效且一字未改）。生产接线负控制（env 未设 ⇒ source default）：`resolveSuiteMemoryMax(dir).hostGuardBytes === sharedHostCeilingBytes(readEffectiveTotalMemBytes(), listSharedHostScopes().count)` ✔。**本轮复核**：同上 5/5 用例中的 `AC2 — the DEFAULT is UNCHANGED...` 与 `AC2 (production wiring, negative control) — an UNDECLARED ceiling still goes through the multi-scope split` 均 ✔。
- [x] AC3: 单测：声明值大于 0.25×有效总量（如 `80G`）⇒ `bound: "host-guard"`，`memoryMax` = 项目盲值，`reason` 非空。实测：`memoryMax = 66295676928`（= 项目盲值，⛔ 非 26 GiB 分摊值）、`bound "host-guard"`、`reason` 匹配 `/exceeds the host-relative guardrail/` 且带 `/guard rule: project-blind/`（压它的规则被具名）✔。**本轮复核**：`AC3 — a declaration ABOVE the project-blind fraction is still clamped, with a NAMED reason` ✔。
- [x] AC4: `node --test plugin/test/full-suite-runner-*.test.mjs` 退出码 0（粘贴汇总行）。**本轮复核读数**（16 个文件全跑；树 = `452fdf53e`，即 develop 两次并入后的当前树）：`ℹ tests 238 / ℹ suites 0 / ℹ pass 238 / ℹ fail 0 / ℹ cancelled 0 / ℹ skipped 0 / ℹ todo 0 / ℹ duration_ms 65866.861137`，`AC4_EXIT=0`（读数 236 → 237 → 238 的变化随兄弟任务并入新用例）；同一棵树上的 scoped 门 `bash scripts/test.sh --for-task <task> --allow-thin` ⇒ `ℹ tests 61 / pass 61 / fail 0`，`SCOPED_EXIT=0` ✔。

## Definition of Done

AC1–AC4 带真实读数勾选。落地后（运维步骤，不在 worker 内）：把主检出 `.quay/config.yml` 的 `suite: memory_max` 从 `26G` 改为 `32G`，下一轮真实全量套件的 `suite-memory-evidence-*.json` 读到 `memoryMax: 34359738368`、`bound: declared`。

**续做轮（2026-10-15）——本分支侧已经取到该 DoD 读数，以及一处必须记录的工作区改动**

- 上一轮 `exited-not-landed` 的成因不是本任务代码：原轮在 127 车道、26 GiB 上限下被 OOM 杀（`oomKill=1`），恢复轮到 64 车道**跑满且不再 OOM**（`oomKill=0`），只剩 `plugin/test/driver-restart-busy-e2e.test.mjs` 的 `AC2b` 一条红；该文件与本分支**逐字节相同**（两侧 blob 均 `f874504f4014319c8b173e822bf4ba4026a1da8e`，即 develop-wide），且与本次 delta 无关。直接在该 worktree 上隔离重跑它 ⇒ `ℹ tests 7 / pass 7 / fail 0`（`AC2b` 498ms 通过，套件内它是 677ms 失败）——**宿主负载下的时序 flake**，不是本任务的缺陷，也不改它的代码。
- ⚠️ **工作区改动（gitignored，不进任何分支，⛔ 不是主检出的值）**：本 worktree 的 `.quay/config.yml` 里 `suite: memory_max` 本轮临时声明为 **`32G`**（主检出仍是 `26G`，DoD 的运维步骤不变）。理由：26 GiB 在 127 车道下必被 OOM 杀，而 **OOM 轮在 `worker-fan-in.ts` 里结构上跳过「本轮内点名文件重跑」这条自愈通道**（`incompleteMarker !== null` ⇒ 直接进恢复梯子），于是一条与 delta 无关的负载 flake 就足以卡死落地；声明成 32G 后首轮不再 OOM，该 flake 会落到「单文件隔离重跑」通道上自愈。32G 本身是人 2026-10-15 已裁定的可接受值；本 worktree 的分支**已经带上**「护栏按声明来源选规则」的改动，所以这里的声明不再被分摊值吞掉（主检出还没带上，故它仍须先声明 26G）。
- **DoD 读数的实测（生产函数 + 生产载体，⛔ 非 fixture）**：在本 worktree 上直接调 `readSuiteParams(<worktree>)` → `suiteParamsToEnv` → `resolveSuiteMemoryMax(<worktree>/.quay)`：
  `{"memoryMax":"34359738368","bound":"declared","reason":null,"declared":"32G","declaredSource":"env","hostGuardBytes":66295431168,"actualConcurrency":64}`，
  同一读数下 `readEffectiveTotalMemBytes()=265181724672`（247.0 GiB）、`listSharedHostScopes().count=20`、`sharedHostCeilingBytes(...)=27917287424`（26.00 GiB）。
  ⇒ 声明值 **32 GiB > 分摊值 26.00 GiB** 而 `memoryMax` 仍是 32 GiB（改动前这里必然是 `bound: "host-guard"` / 26 GiB）——**「声明被分摊吞掉」在真实载体上已不复现**。
- ⛔ 仍待运维（不在 worker 内，DoD 原文不变）：主检出 `.quay/config.yml` 的 `26G` → `32G`。本 worktree 的 `32G` 是**临时**取值，worktree 落地即消失。

## Touches

- plugin/scripts/full-suite-runner.ts
- plugin/test/full-suite-runner-declared-memory-guard.test.mjs
- plugin/test/full-suite-runner-cgroup.test.mjs
- tasks/gap-suite-declared-memory-max-swallowed-by-shared-host-split.md

## Blocker

**2026-10-15T08:18:00.601Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=ff: fan-in-ff-merge: suite 证书 — suite_head..tip 恰为本任务的单个 flip-done 提交（身份判定：仅 M tasks/gap-suite-declared-memory-max-swallowed-by-shared-host-split.md）⇒ 判惰性，⛔ 未调分类器
fan-in-ff-merge: FF FAILED — To .; not a fast-forward. Retry record written (attempt 1). Return to 无锁段 step 1 (merge develop again — 必须 merge 不得 rebase, AC75), re-judge the delta (step 2) and re-run.
fan-in-ff-merge: measure ff_only_locked=false
- run_id：wk-prod-anchor
- session_id：9c2a550a-df53-45cc-94d8-7388dae2dfbe
