---
id: gap-quay-init-laydown-missing-touches-checker
title: "quay-init --loop laydown 缺 touches-one-entry-one-path-check.ts——precommit-guard.ts:65 import 它 ⇒ consumer workspace ERR_MODULE_NOT_FOUND，develop release/init 路径恒红（touches 未验证 landing 的后果）"
status: ready
labels:
  - gap
  - mechanism
  - blocking
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：concurrency-literal fan-in 全量 suite RED（4 fails，单一根因），2026-08-16 22:38Z。touches 任务（gap-touches-one-entry-detector-not-enforcer，commit 12510d87）改 `plugin/scripts/precommit-guard.ts` 加 `import { checkTaskOneEntryOnePath, readOneEntryBaseline } from "./touches-one-entry-one-path-check.ts"`（:65），但 `quay-init --loop` 的 mechanism laydown 集不含该 checker ⇒ consumer workspaces（temp dirs from sea-artifact-consumer AC4 + quay-init-loop-core AC1/2/3）laydown 后缺该文件 ⇒ precommit-guard 运行时 `ERR_MODULE_NOT_FOUND` ⇒ quay-init --loop 失败。

**为什么这是 delta-scope 形态的未验证 landing**：touches fan-in 的 codeDelta=empty（develop 未推进）⇒ 全量 suite 被跳过 ⇒ precommit-guard.ts 的新 import 未在 consumer-workspace 场景验证过。concurrency-literal 的 fan-in（含全量 suite）是第一个在完整 release/init 路径上跑它的 ⇒ 抓出红。

**修复（fan-in 子代理给的方向 + 我读 quay-init.sh 的定位）**：
`quay-init.sh` 的 `--loop` laydown 集**从 mechanism_corpus 派生**（bare-resolve：corpus docs 里每个 BARE `<name>.<ext>` token 进 laydown 集）。修复 = 让 `touches-one-entry-one-path-check.ts` 进入该派生集，二选一：
- **(a)** 在 mechanism_corpus 相关 docs（描述 quay-init 机制运转的 docs）里加 bare 引用 `touches-one-entry-one-path-check.ts`，使 bare-resolve 自动收入 laydown；或
- **(b)** 在 `derive_loop_scripts` 里显式加入该文件（若它不是机制 corpus 成员）。

**⛔ 不改 precommit-guard 的 import 来规避**（import 是 touches 任务的正确接线；缺的是 laydown）。

**验证判据**：修复后 `quay-init --loop` 在 temp consumer workspace 里成功（ERR_MODULE_NOT_FOUND 消失）；全量 suite 绿。

## Acceptance Criteria

- [ ] AC1: `quay-init --loop` 的 laydown 集含 `touches-one-entry-one-path-check.ts`（`quay-init.sh --loop --json` 或等价的派生集输出含该 basename）。读生产派生逻辑，非 fixture。
- [ ] AC2: 在 temp consumer workspace 里 `quay-init --loop` 成功——precommit-guard 的 import 解析（ERR_MODULE_NOT_FOUND 消失）。读真实 temp dir 产物。
- [ ] AC3: 全量 suite 绿（含 quay-init-loop-core AC1/2/3 + sea-artifact-consumer AC4 的 consumer workspace 用例）。
- [ ] AC4: touches 任务（12510d87）的接线不被破坏（precommit-guard.ts 的 import 保持）——只加 laydown，不动 import。

## Definition of Done

- [ ] develop 的 release/init 路径恢复绿（全量 suite 的 quay-init --loop 用例通过）；concurrency-literal 可重跑 fan-in land；delivery-laydown/ac100 队列解锁。（待外部）

## Touches

- plugin/scripts/quay-init.sh（--loop 派生集加 checker——mechanism_corpus bare-resolve 或 derive_loop_scripts 显式）
- plugin/scripts/touches-one-entry-one-path-check.ts（被 import 的 checker——若需改 bare 引用形式则动）
- plugin/test/quay-init-loop-core.test.mjs（consumer workspace 用例补断言）
- plugin/test/quay-init-loop.test.mjs（consumer workspace 用例补断言）
- plugin/test/sea-artifact-consumer-e2e.test.mjs（若相关）
- tasks/gap-quay-init-laydown-missing-touches-checker.md（自身）

## Test-Files

- plugin/test/quay-init-loop-core.test.mjs（AC1/2/3 consumer workspace）
- plugin/test/sea-artifact-consumer-e2e.test.mjs（AC4 consumer workspace）
