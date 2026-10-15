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

- [x] AC1: 单测：total=247 GiB、N=17、声明 `32G`（source=env）⇒ `memoryMax = 34359738368`、`bound: "declared"`。实测：`suiteHostGuard(...).rule = "project-blind"`、`hostGuardBytes = 66295676928`（= `defaultScopeMemoryMax(247 GiB, 0.25)`，⛔ 不是 26 GiB 分摊值）；`suiteMemoryMax({..., hostGuard}) ⇒ memoryMax 34359738368 / bound "declared" / reason null`。负控制（改前等价路径 = 把分摊值当护栏）：同一声明 ⇒ `memoryMax 27917287424 / bound "host-guard"`（正是被吞掉的样子）。测试 `AC1 — a DECLARED 32G ceiling is not swallowed...` + `AC1 (production wiring) — resolveSuiteMemoryMax routes a DECLARED ceiling through the project-blind guard` ✔。
- [x] AC2: 单测：同条件未声明（source=default）⇒ 护栏仍为多 scope 分摊值（26 GiB），`memoryMax` 为缺省 16G 不变。实测：`rule = "shared-host-split"`、`hostGuardBytes = 27917287424`（= `sharedHostCeilingBytes(247 GiB, 17)` = 26 GiB 整）、`memoryMax = 17179869184`、`bound "declared"`（16G < 26 GiB ⇒ 缺省值生效且一字未改）。生产接线负控制（env 未设 ⇒ source default）：`resolveSuiteMemoryMax(dir).hostGuardBytes === sharedHostCeilingBytes(readEffectiveTotalMemBytes(), listSharedHostScopes().count)` ✔。
- [x] AC3: 单测：声明值大于 0.25×有效总量（如 `80G`）⇒ `bound: "host-guard"`，`memoryMax` = 项目盲值，`reason` 非空。实测：`memoryMax = 66295676928`（= 项目盲值，⛔ 非 26 GiB 分摊值）、`bound "host-guard"`、`reason` 匹配 `/exceeds the host-relative guardrail/` 且带 `/guard rule: project-blind/`（压它的规则被具名）✔。
- [x] AC4: `node --test plugin/test/full-suite-runner-*.test.mjs` 退出码 0（粘贴汇总行）。实测（16 个文件全跑；冻结 tip `ea38e0f0a`，即与 develop `e14887ccb` 合并后的树）：`ℹ tests 238 / ℹ suites 0 / ℹ pass 238 / ℹ fail 0 / ℹ cancelled 0 / ℹ skipped 0 / ℹ todo 0 / ℹ duration_ms 56677.691247`，`AC4_EXIT=0`（此前两轮读数 236 → 237，随兄弟任务并入新用例而增）；同一冻结树上的 scoped 门 `bash scripts/test.sh --for-task <task> --allow-thin` ⇒ `ℹ tests 61 / pass 61 / fail 0`，退出码 0 ✔。

## Definition of Done

AC1–AC4 带真实读数勾选。落地后（运维步骤，不在 worker 内）：把主检出 `.quay/config.yml` 的 `suite: memory_max` 从 `26G` 改为 `32G`，下一轮真实全量套件的 `suite-memory-evidence-*.json` 读到 `memoryMax: 34359738368`、`bound: declared`。

## Touches

- plugin/scripts/full-suite-runner.ts
- plugin/test/full-suite-runner-declared-memory-guard.test.mjs
- plugin/test/full-suite-runner-cgroup.test.mjs
- tasks/gap-suite-declared-memory-max-swallowed-by-shared-host-split.md

## Blocker

**2026-10-15T07:52:08.638Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: oom-killed (1) — recovery baseline-equivalence not evaluable at concurrency 64 — needs a code fix
- run_id：wk-prod-anchor
- session_id：28b0ba9d-f7f5-4ab6-b3be-b1f2a711348b
