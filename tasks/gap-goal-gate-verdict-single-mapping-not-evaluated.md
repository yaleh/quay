---
id: gap-goal-gate-verdict-single-mapping-not-evaluated
title: goal gate 两个入口把 exit 3 / 超时 / 127 记成 fail：三个写入点共用一个 verdict 映射
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**机制（成簇缺陷，硬规则 5b）**：goal 判据约定 `exit 3 = NOT-EVALUATED`，但这个映射**只在 sweep 路径**实现了（`packages/quay/src/goal-store.ts:2007`：`res.ok ? "pass" : res.code === 3 ? "not-evaluated" : "fail"`）。另外两个写 GateEvent 的入口仍是二元的：
- `packages/quay/src/goal-store.ts:3108`（`quay goal gate`）：`verdict = result.ok ? "pass" : "fail"`；
- `packages/quay-native/src/mcp-server.ts:500`（MCP 的 goal gate）：同上。

这两处还**写死了 `timeoutMs: 60000`**，但 `runAcceptance` 的超时判词说「raise gates.yml timeoutMs / --timeout」（`packages/quay/src/gate/acceptance-runner.ts:199`）——这个建议在 goal 路径上**不起作用**。超时、spawn 失败、`exit 126/127`（判据命令本身跑不起来）也一律记 `fail`。

**生产读数（claudecodeui `.quay/gate-events.jsonl`，2026-09-20→09-23，共 20288 条）**：`fail` 8185 条，其中 goal-cli `exit 1` 8087 条（目标尚未达成、每小时约 500 次轮询——这是预期的红，不是摩擦）、**`exit 3` 1 条、超时 61 条、`exit 127` 约 370 条**（AC-012/AC-018 判据引用的脚本已不存在：`Cannot find module …`）。后两类是「没评估成 / 判据坏了」，却与「判据判了假」同形。下游立的 `gap-cold-baseline-path-exceeds-gate-cap` 正是被这个映射逼出来的：它只能把判据改到默认路径不出 exit 3，因为 gate 路径看不到 exit 3 的语义。

**修法（方向）**：
1. 抽出唯一的 `verdictFromAcceptance(result)`（放在 `gate/acceptance-runner.ts` 旁）：`0 → pass`；`3 → not-evaluated`；超时 / spawn 失败 / 126 / 127 → `not-evaluated`（附子原因 `timeout` / `spawn` / `not-runnable`）；其余 → `fail`。三个写入点（sweep、`goal gate`、MCP goal gate）共用它。
2. goal gate 的超时从记录的 frontmatter（如 `timeoutMs`）或 `QUAY_ACCEPTANCE_TIMEOUT_MS` 读取；判词按实际生效的来源说明可调的旋钮。
3. 静态守卫：`packages/quay/src` 与 `packages/quay-native/src` 中 GateEvent 写入点不得再出现二元的 `ok ? "pass" : "fail"`（按代码位置判定，带正控）。
4. 读侧（Web UI goal 卡片、`goal check`）把 `not-evaluated` 与 `fail` 分开计数。

## AC

- [x] `node --test packages/quay/test/goal-gate-verdict-mapping.test.mjs` 退出 0（新文件），用例：判据 `exit 3` / `sleep` 超过超时 / 不存在的命令（127）⇒ 经 `quay goal gate` 与 MCP goal gate 两条入口写出的 GateEvent `verdict` 均为 `not-evaluated`；`exit 1` ⇒ `fail`；`exit 0` ⇒ `pass`。
- [x] 取假：把任一入口改回二元映射后，上述用例红（附实跑输出）。
- [x] `grep -rnE 'ok \? "pass" : "fail"' packages/quay/src packages/quay-native/src --include=*.ts` 在 GateEvent 写入点上的非注释命中为 0（命中清单与前 3 条贴进提交；非 GateEvent 的日志行若保留，逐条说明）。
- [x] 带 `timeoutMs: 120000` 的 goal 记录，其判据运行 70s 时 `quay goal gate` 判 `pass` 而不是超时。
- [x] `bash scripts/test.sh --for-task gap-goal-gate-verdict-single-mapping-not-evaluated` 退出 0，且执行了 ≥1 个测试文件。

## DoD

真实落地判据：在 claudecodeui（driver/插件升级到含修复的版本后）对 AC-012 跑一次 `quay goal gate`，其 `.quay/gate-events.jsonl` 新增记录的 `verdict` 为 `not-evaluated` 且原因含 `not-runnable`（该判据引用的脚本不存在），而不是 `fail`。完成记录附该条 GateEvent 原文。

## Touches

- packages/quay/src/gate/acceptance-runner.ts
- packages/quay/src/gate/types.ts
- packages/quay/src/gate/registry.ts
- packages/quay/src/gate/factories/goal.ts
- packages/quay/src/gate/engine.ts
- packages/quay/src/gate/lifecycle.ts
- packages/quay/src/goal-store.ts
- packages/quay-native/src/mcp-server.ts
- packages/quay/test/goal-gate-verdict-mapping.test.mjs (new)
- tasks/gap-goal-gate-verdict-single-mapping-not-evaluated.md
