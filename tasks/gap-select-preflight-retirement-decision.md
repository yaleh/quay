---
id: gap-select-preflight-retirement-decision
title: "select-preflight 退役决策：唯一非测试消费者 = ADR-022 退役经典循环入口——退役是产品决策，单独裁定"
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：suite-fix 红基线诊断的副产品（manager 2026-08-16 消费者枚举完成）。

**消费者枚举（manager ✅ 逐条复算，按位置判定）**：`select-preflight.ts` 的**非测试消费者只剩一个**——
`.claude/workflows/select-preflight.js:28`（唯一真正 exec 它的地方），而该 workflow 自述是
「Encapsulate **OUTER-LOOP** SELECT preflight… per `/loop` wake-up」——**即 ADR-022 已退役的经典循环入口**。
其余 40+ 处 `grep select-preflight` 命中**全是注释里的任务名引用**或 `config-wiring-check.ts:139` 对
workflow 文件路径的接线检查——按位置判定，没有一个是调用。两层执行核
（`orchestration/{manager,orchestrator,fast-mode}-tick-core.md`、`plugin/loop/*.md`）零处调用；
`capability-catalog.sh` 零命中。

**⇒ 退役前提成立。但⛔ 退役是产品决策**，不应由修 flake 顺手做——本任务单独承载该决策。

## Plan

1. 复核消费者枚举（一条命令级：grep 按位置判定，排除注释/任务名引用）。
2. 决策点：退役 `select-preflight.ts` / 其 workflow / 相关测试？还是保留（留作未来用）？
3. 若退役：移除实现 + 测试 + workflow + wiring，记录退役理由与消费者枚举。

## Acceptance Criteria

- [x] AC1: 消费者枚举复核完成（非测试消费者 = ADR-022 退役经典循环入口，无现行调用）。
- [x] AC2: 退役决策记录（退役 or 保留，理由 + 裁定）。
- [x] AC3: 若退役，实现/测试/workflow/wiring 全部移除且无残留引用（按位置判定）。

## Definition of Done

- [x] select-preflight 的存废有明确裁定（退役记录理由 + 枚举，或保留理由），不留「待查」悬置。

## Evidence

**裁定：退役（物理移除）**，2026-08-16。理由：唯一非测试消费者 = `.claude/workflows/select-preflight.js`，而该 workflow 只在 ADR-022 已退役的 `experiments/quay-perpetual-stream/OUTER-LOOP.md:31` 被 `invoke`。现行两层 fast-mode 零引用：`capability-catalog.sh` 零命中；`orchestration/{manager,orchestrator,fast-mode}-tick-core.md` 与 `plugin/loop/*.md` 零命中；`plugin/skills/loop-driver/SKILL.md`（现行 loop 驱动）零命中。与同族 `gap-retire-the-prepare-execute-pipeline-cluster`（prepare/execute 管线物理删除，ADR-022）一致。

**消费者枚举复核（AC1，按位置判定）**：
- 唯一非测试消费者：`.claude/workflows/select-preflight.js:28` 是唯一真正 exec `experiments/quay-perpetual-stream/scripts/select-preflight.ts` 的地方（`node --experimental-strip-types ... select-preflight.ts --json`）。
- 其余非测试 grep 命中全部为注释/任务名/历史引用：`slot-refill.ts:191`、`supervisor-preempt.sh:97`、`restart-readiness-check.sh:33`、`config-wiring-selfcheck.sh:3` 只 mirror `checkHalt()` 语义；`task-schema.ts:462-463`、`candidate-contracts.ts:157` 为注释；`ready-pool-check.ts:1888`、`fast-mode-telemetry.test.mjs:641` 为任务名/历史 fixture。无任何 import/exec/spawn。
- 测试消费者：`select-preflight.test.mjs`、`select-preflight-cli.test.mjs`（直接 import/spawn）、`candidate-synthesis.test.mjs`（仅 `getCandidates`）。按任务 Touches「非测试消费者」判据，测试不计入退役前提；但退役时随实现一并移除。

**退役执行（AC3）**：
- 删除 4 文件：`experiments/quay-perpetual-stream/scripts/select-preflight.ts`（1057 行）、`.claude/workflows/select-preflight.js`、`experiments/quay-perpetual-stream/test/select-preflight.test.mjs`、`experiments/quay-perpetual-stream/test/select-preflight-cli.test.mjs`。
- 更新 wiring（5 文件）：`plugin/scripts/config-wiring-check.ts:139`（从 `collectBespokeDriverFiles` 移除 workflow 路径）；`plugin/scripts/workflow-metadata-conformance.mjs` 与 `experiments/quay-perpetual-stream/scripts/workflow-metadata-conformance.mjs`（字节一致镜像，同步移除默认 filePaths 项；diff 确认仍 IDENTICAL）；`plugin/test/workflow-metadata-conformance.test.mjs`（移除 REAL_SELECT，AC4/AC5 循环 `[REAL_DRAIN, REAL_ROUTINES]`，C6 断言 5→4 文件）；`experiments/quay-perpetual-stream/test/candidate-synthesis.test.mjs`（移除 `getCandidates` import 与 2 条 legacy 基线测试）。
- 残留引用核验：`grep -rn "scripts/select-preflight.ts|workflows/select-preflight.js"`（非测试、非注释）= 0 命中；全部剩余命中为注释/历史文档（charter、dashboard、milestone evidence），按位置判定非消费。
- 注意 Touches 修正：实现文件实际在 `experiments/quay-perpetual-stream/scripts/select-preflight.ts`，Touches 所列 `packages/quay/src/select-preflight.ts` 不存在。

**测试（scoped，worktree 内）**：`workflow-metadata-conformance.test.mjs` 23/23、`candidate-synthesis.test.mjs` 22/22、`config-wiring-check.test.mjs` 2/2、`loadbearing-test-gate.test.mjs` 23/23、`portfolio-choice` 19/19、`candidate-contracts` 9/9、`preparation-feedback` 5/5、`wiring-coverage-check` 31/31、`fast-mode-telemetry` 77/77、`workflows-dual-copy-drift-check` 5/5 全绿；`workflow-metadata-conformance.mjs` 默认调用 4 文件 0 FAIL exit 0；`config-wiring-check.ts --driver bespoke` 与主检出输出逐字节一致（7 条预存 FAIL，非本次引入）；`config-wiring-selfcheck.sh` 与主检出一致 exit 0。`runtime-usage-inventory.test.mjs` 的 AC4（real-transcripts）在主检出与 worktree 同样 20 pass/1 fail（预存环境性，与本次改动无关）。

**观察（超出本任务 Touches，不处理）**：`deliverable-governor.ts` 与 `human-steered-classify.ts`、`explore-exploit-cadence.ts` 等失去唯一消费者（workflow），其自身存废是后续独立决策。

**fan-in 修正（delivery-inventory-drift-gate false-positive，2026-08-16）**：scoped 门 `delivery-inventory-drift-gate` 对 `.claude/workflows/select-preflight.js` 的退役删除报 FAIL——该 gate 假设每个被删 workflow 都有 `plugin/workflows/` mirror，但 select-preflight.js 是 mirror 约定建立前的 legacy workflow（`git cat-file -e <fork>:plugin/workflows/select-preflight.js` 不存在、`git log --all -- plugin/workflows/select-preflight.js` 空——从未有 mirror），退役删除不留 stale mirror，无需 mirror co-touch。修正 gate：D 删除仅在 mirror 于 base 存在时才 structural（需 co-touch）；A 新增恒 structural（new_workflow_requires_mirror 保持 fail-closed）。gate 测试 18/18（新增 1 条 GREEN：legacy 未镜像 workflow 删除通过；既有 RED 用例保持 fail-closed 不回归）。

## Touches

- experiments/quay-perpetual-stream/scripts/select-preflight.ts（退役删除——真实路径，非 packages/quay/src/）
- .claude/workflows/select-preflight.js（退役删除）
- experiments/quay-perpetual-stream/test/select-preflight-cli.test.mjs（退役删除）
- experiments/quay-perpetual-stream/test/select-preflight.test.mjs（退役删除）
- experiments/quay-perpetual-stream/test/candidate-synthesis.test.mjs（移除 getCandidates legacy 测试）
- experiments/quay-perpetual-stream/scripts/workflow-metadata-conformance.mjs（C6 文件集 5→4）
- plugin/scripts/workflow-metadata-conformance.mjs（双副本，与 experiments/ 逐字一致）
- plugin/scripts/config-wiring-check.ts（移除 select-preflight 引用）
- plugin/scripts/delivery-inventory-drift-gate.sh（false-positive 修正：legacy 未镜像 workflow 删除不再误报）
- plugin/test/delivery-inventory-drift-gate.test.mjs（新增 GREEN 用例：legacy 未镜像删除通过）
- plugin/test/workflow-metadata-conformance.test.mjs（C6 断言更新）
- plugin/invariant-ownership.md（halt-sentinel owner re-point：select-preflight.ts → halt-check.sh + slot-refill.ts:197 checkHaltSentinel——退役后残留引用，AC3 补齐）
- experiments/quay-perpetual-stream/invariant-ownership.md（同上，双副本与 plugin/ 逐字一致）
- tasks/gap-select-preflight-retirement-decision.md（自身）
