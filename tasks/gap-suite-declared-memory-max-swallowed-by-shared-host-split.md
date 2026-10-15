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

## Plan

1. 在 `suiteMemoryMax` 的调用处按 `declared.source` 选护栏；把选择结果与原因记入现有证据字段（不新增 *.jsonl）。
2. 新增单测覆盖三种情形（见 AC）。
3. 跑 `plugin/test/full-suite-runner-*.test.mjs` 回归。

## Acceptance Criteria

- [ ] AC1: 单测：total=247 GiB、N=17、声明 `32G`（source=env）⇒ `memoryMax = 34359738368`、`bound: "declared"`。
- [ ] AC2: 单测：同条件未声明（source=default）⇒ 护栏仍为多 scope 分摊值（26 GiB），`memoryMax` 为缺省 16G 不变。
- [ ] AC3: 单测：声明值大于 0.25×有效总量（如 `80G`）⇒ `bound: "host-guard"`，`memoryMax` = 项目盲值，`reason` 非空。
- [ ] AC4: `node --test plugin/test/full-suite-runner-*.test.mjs` 退出码 0（粘贴汇总行）。

## Definition of Done

AC1–AC4 带真实读数勾选。落地后（运维步骤，不在 worker 内）：把主检出 `.quay/config.yml` 的 `suite: memory_max` 从 `26G` 改为 `32G`，下一轮真实全量套件的 `suite-memory-evidence-*.json` 读到 `memoryMax: 34359738368`、`bound: declared`。

## Touches

- plugin/scripts/full-suite-runner.ts
- plugin/test/full-suite-runner-declared-memory-guard.test.mjs
- tasks/gap-suite-declared-memory-max-swallowed-by-shared-host-split.md
