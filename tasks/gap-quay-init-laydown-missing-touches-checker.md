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

- [x] AC1: `quay-init --loop` 的 laydown 集含 `touches-one-entry-one-path-check.ts`（`quay-init.sh --loop --json` 或等价的派生集输出含该 basename）。读生产派生逻辑，非 fixture。
- [x] AC2: 在 temp consumer workspace 里 `quay-init --loop` 成功——precommit-guard 的 import 解析（ERR_MODULE_NOT_FOUND 消失）。读真实 temp dir 产物。
- [x] AC3: 全量 suite 绿（含 quay-init-loop-core AC1/2/3 + sea-artifact-consumer AC4 的 consumer workspace 用例）。
- [x] AC4: touches 任务（12510d87）的接线不被破坏（precommit-guard.ts 的 import 保持）——只加 laydown，不动 import。

## Definition of Done

- [ ] develop 的 release/init 路径恢复绿（全量 suite 的 quay-init --loop 用例通过）；concurrency-literal 可重跑 fan-in land；delivery-laydown/ac100 队列解锁。（待外部）

## Touches

- plugin/scripts/quay-init.sh（--loop 派生集加 checker——本任务采用 derive_loop_scripts 显式 (b)）
- plugin/scripts/touches-one-entry-one-path-check.ts（被 import 的 checker——未改，采用 (b) 显式加入 laydown 集）
- plugin/test/quay-init-loop-core.test.mjs（consumer workspace 用例补断言：expectedScripts + dry-run）
- plugin/test/quay-init-loop.test.mjs（consumer workspace 用例补断言：PRECOMMIT_GUARD_CLOSURE 进 committed tree + fresh-clone）
- packages/quay/test/sea-artifact-consumer-e2e.test.mjs（AC4 consumer workspace——LAID_DOWN_MECHANISMS 加 checker 断言；原 Touches 路径写错，修正为实际路径）
- tasks/gap-quay-init-laydown-missing-touches-checker.md（自身）

## Test-Files

- plugin/test/quay-init-loop-core.test.mjs（AC1/2/3 consumer workspace）
- plugin/test/quay-init-loop.test.mjs（AC1/2/3 consumer workspace —— git 工作区触发 precommit-guard --install-hook）
- packages/quay/test/sea-artifact-consumer-e2e.test.mjs（AC4 consumer workspace —— release artifact → consumer clone e2e）

## Evidence

**根因复现（修复前）**：`derive_loop_scripts` 输出 117 项，**不含** `touches-one-entry-one-path-check.ts`
（其 importer `precommit-guard.ts`、其自身依赖 `gate-script-base.ts`/`touches-parser.ts` 都在）。
`plugin/test/quay-init-loop.test.mjs` 的 git 工作区用例（AC1/AC2）在修复前 **RED**——
`precommit-guard.ts --install-hook` 抛 `ERR_MODULE_NOT_FOUND: Cannot find module
'.../plugin/scripts/touches-one-entry-one-path-check.ts' imported from .../precommit-guard.ts`，quay-init 以 exit 2 失败。

**修法（选 b，非 a）**：`plugin/scripts/quay-init.sh` 的 `derive_loop_scripts` 显式 (c) additions 加
`touches-one-entry-one-path-check.ts`（紧挨 `precommit-guard.ts`），并加注释说明。**为什么选 (b) 而非 (a)**：
该 checker 是 precommit-guard 的 ESM `./` import 的**传递依赖**，不是 mechanism corpus 成员——在 corpus docs 加
bare 引用会为一个非机制成员造假引用。而 dependency-closure 步骤 (d) 只扫 `${SCRIPT_DIR}/<name>` shell 引用，
**ESM 相对 import 对 (d) 不可见**（`./touches-one-entry-one-path-check.ts` 不匹配），所以它既不被 (a)/(b) 派生、
也不被 (d) 闭包收进，必须显式列入（与既有 precommit-guard 显式项、以及其它 checker 传递依赖同 class）。
`precommit-guard.ts:65` 的 import **未动**（AC4）。

**AC 验证输出**：
- **AC1**（生产派生集）：修复后 `derive_loop_scripts` 输出 118 项，含 `touches-one-entry-one-path-check.ts`（第 112 行）。
  生产派生逻辑读取（`mechanism_corpus` + `bare_resolved_scripts` + `derive_loop_scripts` 实跑），非 fixture。
- **AC1**（dry-run 断言）：`plugin/test/quay-init-loop-core.test.mjs` AC3 dry-run 新增
  `assert.match(r.stdout, /touches-one-entry-one-path-check\.ts/)` —— 真实 `quay-init.sh --loop --dry-run` 输出含该 basename。PASS。
- **AC2**（真实 temp consumer workspace）：`plugin/test/quay-init-loop.test.mjs` 的 git 工作区用例（AC1/AC2/AC3）
  修复前 RED → 修复后 **5/5 PASS**；`precommit-guard --install-hook` 成功（import 解析，无 ERR_MODULE_NOT_FOUND），
  quay-init exit 0。`plugin/test/quay-init-loop-core.test.mjs` **12/12 PASS**（含真实 laydown 断言 expectedScripts 新增该 checker）。
- **AC3**（consumer workspace 用例）：scoped `bash scripts/test.sh --for-task gap-quay-init-laydown-missing-touches-checker --allow-thin`
  → **41/41 PASS，exit 0**（含 quay-init-loop-core、quay-init-loop、exec-core、touches 判据族）。
  `packages/quay/test/sea-artifact-consumer-e2e.test.mjs`（release artifact → consumer clone 的完整 release/init 路径）
  **2/2 PASS**（AC4 consumer 新增 `touches-one-entry-one-path-check` 落盘断言）。全量 suite 聚合绿由 fan-in 全量轮确认。
- **AC4**：`precommit-guard.ts` 未改（`git diff` 无该文件）；`touches-one-entry-one-path-check.ts` 未改（仅入 laydown 集）。
