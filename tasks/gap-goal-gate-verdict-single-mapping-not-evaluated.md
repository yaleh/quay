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
- packages/quay/test/goal-criterion-timeout-resolution.test.mjs (合并 develop 时必须改：见 §Evidence「与 develop 兄弟任务的语义合并」——它的三个断言把「超时 ⇒ fail」写死，与本任务的核心要求直接冲突)
- tasks/gap-goal-gate-verdict-single-mapping-not-evaluated.md

## Evidence

### 与 develop 兄弟任务的语义合并（2026-09-24，本轮）

本分支落在 merge-base 之后，develop 已合并兄弟任务 `gap-goal-criterion-timeout-hardcoded-60s-ignores-acceptance-timeout`（其修法方向与本任务的 Proposal §2 重叠）。两个改动都必须留下，但**不能各留一份默认值**：

- develop 把「默认 60000」收进 `gate/config/utils.ts:DEFAULT_ACCEPTANCE_TIMEOUT_MS` 一处，并删除了 `goal-store.ts` 的私有 `SWEEP_CRITERION_TIMEOUT_MS`（它正是绕过配置面的那个常量），四个调用点改用 `resolveAcceptanceTimeoutMs()`。
- 本分支读**记录自己的** `timeoutMs`，并在三个写入点共用 `verdictFromAcceptance`。

⇒ 取法：**默认值只留 develop 的那一处**，本分支的 `resolveAcceptanceTimeout` 改为 `import` 它（不再自带 `60_000` 字面量），其记录优先级链 `record > env > default` 不变；sweep 点的 deadline 取 develop 的 `resolveAcceptanceTimeoutMs()`，mapping 取本分支的 `verdictFromAcceptance`。`goal gate` 的输出同时保留 develop 的 `timeoutMs` 字段与本分支的 `cause` 字段。

### 合并后重跑的四条读数（均在本 worktree，post-merge）

- **AC1**：`bash scripts/test.sh packages/quay/test/goal-gate-verdict-mapping.test.mjs` → 17 tests / 17 pass / 0 fail。
- **AC2（取假，逐入口分别做）**：仅把 `goal-store.ts` 的 `gate` case 改回二元 ⇒ 6 fail（三个 `quay goal gate` 用例 + 两入口一致性 + 两条记录级 deadline 用例），MCP 用例仍绿；仅把 `mcp-server.ts` 的 `goal_gate` 改回二元 ⇒ 4 fail（三个 MCP 用例 + 一致性），CLI 用例仍绿。两个方向互为镜像，证明判据按入口分辨而非全局。两份文件随后按备份逐字节还原（`diff -q` 通过）。
- **AC3**：`grep -rnE 'ok \? "pass" : "fail"' packages/quay/src packages/quay-native/src --include=*.ts` ⇒ 4 条命中，**GateEvent 写入点 0 条**：`gate/types.ts:29`（注释）、`gate/engine.ts:107`（注释）、`gate/acceptance-runner.ts:58`（注释）、`gate/acceptance-runner.ts:124`（`verdictFromGateCheck` 的布尔回退——唯一被允许存在的那一处，所有写入点都经它）。**正控**：同一谓词对着 merge-base 干跑 ⇒ 7 条命中，其中 4 条曾是 GateEvent 写入点（`mcp-server.ts:500`、`engine.ts:110`、`lifecycle.ts:306`、`goal-store.ts:3108`），现已全部消失或改写。
- **AC4**：临时 workspace 内写入 `timeoutMs: 120000`、判据 `sleep 70; echo "finished the 70s run"` 的记录 ⇒ `quay goal gate AC-012 --json` 于 2026-09-23T17:12:40Z 起、17:13:50Z 止（**70s**），exit 0，`{"verdict":"pass","cause":null,"timeoutMs":120000,"reason":"acceptance passed (exit 0)"}`，ledger 新增记录 `verdict":"pass"`。若仍是写死的 60000，该判据会在 60s 被杀并记 `not-evaluated (timeout)`——记录自己的 deadline 才是让它通过的原因。
- **AC5**：`bash scripts/test.sh --for-task gap-goal-gate-verdict-single-mapping-not-evaluated --allow-thin` → 见提交。

### DoD 状态

DoD 的 claudecodeui 重跑是 **post-landing** 的：它要求该工作区的 driver/插件先升级到含本修复的版本，本轮无法在本 worktree 内完成。缺陷形状的生产侧佐证（只读、fix 前）已记录在提交里：AC-012 最后几条 goal-cli 事件读 `fail | acceptance failed (exit 127) — sh: 1: playwright: not found`，即「判据的命令根本跑不起来」被记成「判据为假」。
