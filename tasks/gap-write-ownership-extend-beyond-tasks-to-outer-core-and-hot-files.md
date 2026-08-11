---
id: gap-write-ownership-extend-beyond-tasks-to-outer-core-and-hot-files
title: 写所有权分离只覆盖了 tasks/（35→7 已验证），没覆盖 orchestration/orchestrator-* 与
  plugin/loop/* 与热点实现文件——inner 在改 outer 的执行核/loop 文档/outer 正在改的实现 ⇒ 6 条 fan-in 撞
  add/add 卡死；修法=①核心/loop 文档 outer 独占写（inner 给建议、outer 落盘）②迁移窗口内新路径只允许一方新建
  ③热点实现文件在有人改时把 outer 在飞改动纳入 touches-orthogonality-check 占用表
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**写所有权分离（`0ce3f2a8`，2026-08-11 晚）只覆盖了 `tasks/` 的漂移（35→7，效果已验证），没覆盖 `orchestration/orchestrator-*` 与 `plugin/loop/*` 与热点实现文件。** 结果 inner 的任务分支在改 outer 的执行核（`orchestrator-tick-core.md`）、loop 文档（`plugin/loop/orchestrator-loop-tick.md`，且这是从 `orchestration/` 迁移中的新路径 ⇒ 双方各自新建 ⇒ add/add）、以及 outer 正在改的热点实现（`full-suite-runner.ts`，systemd 限额就在里面）——6 条内层完成分支全部卡在 fan-in 冲突上，inner 0 在飞、成为唯一活阻塞。

### 实证（manager 2026-08-11 06:5x 取证 + outer 复核）

- `task/gap-slot-free-not-an-event...`（ahead=4）改的文件含 **`orchestration/orchestrator-tick-core.md`（outer 执行核）**、**`plugin/loop/orchestrator-loop-tick.md`（迁移中新路径 ⇒ 双方各自新建 ⇒ add/add）**、`plugin/loop/fast-mode-loop-tick.md`、`docs/proposals/quay-product-outline.md`、`.gitignore`。
- `task/gap-verification-round-missing...`（ahead=1）改 **`plugin/scripts/full-suite-runner.ts`** —— outer 同期正在改同一文件（systemd 限额实现）。
- `task/gap-reconcile-step...`（ahead=4）改 **`orchestration/orchestrator-tick-core.md`**（outer 执行核）。
- 早先 `0ce3f2a8` 写所有权分离把 `tasks/` 漂移从 35 降到 7（已验证），但没覆盖上述类别。

### 选定机制方向（实现归 inner，判定归 outer）

1. **① `orchestration/orchestrator-*.md` 与 `plugin/loop/orchestrator-loop-tick.md` 归 outer 独占写**——inner 的任务若需要改它们，产出改动建议而不是直接改，由 outer 落盘。与三层既有边界同构（manager 自己的 §0 也是「不碰实现，只给建议」）。
2. **② 迁移中的文件（旧路径→新路径）在迁移窗口内只允许一方新建**——add/add 的根因是双方各自创建同一新路径；迁移期间应由一方一次性完成 move 并提交，另一方只 rebase。
3. **③ 热点实现文件（当下是 `full-suite-runner.ts`）在有人在飞改动时，派发前用既有 `touches-orthogonality-check.ts` 把它算作占用**——该检查目前只看 inner 任务之间的 Touches 正交性，看不见 outer 主线正在改什么；应把 outer 自己的在飞改动纳入那张表。

**验证锚**：修后 (a) inner 新派发任务不再把 `orchestration/orchestrator-*.md` / `plugin/loop/orchestrator-loop-tick.md` 列入 Touches（改为在 Proposal 给建议）；(b) 迁移窗口内新路径单方新建、无 add/add；(c) 热点文件在 outer 在飞改动时对 inner 算作占用（touches-orthogonality 拒绝同文件并发）；(d) `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 6 条 resolve-pending 冲突清单 + 类别（outer 执行核 / 迁移新路径 add/add / 热点实现）+ 0ce3f2a8 只覆盖 tasks/（本任务 Proposal 已含）
- [x] AC2: **核心/loop 文档 outer 独占**——inner 任务不再直接改 `orchestration/orchestrator-*` 与 `plugin/loop/orchestrator-loop-tick.md`（改为给建议，outer 落盘）
- [x] AC3: **迁移单方新建**——迁移窗口内新路径只允许一方新建（move 一次提交，另一方只 rebase）
- [x] AC4: **热点占用表**——touches-orthogonality-check 纳入 outer 在飞改动（同文件并发 ⇒ 拒绝派发）
- [x] AC5: **既有不回归**——`--for-task` scoped 门绿；新任务不再因写所有权重叠 needs-human

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：新派发任务不再撞 outer 核心/热点文件（连续 2 轮无 add/add）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/touches-orthogonality-check.ts（AC4：outer 在飞改动纳入占用表）
- plugin/test/touches-orthogonality-check.test.mjs（新增 outer-占用用例）
- plugin/loop/fast-mode-loop-tick.md 或 inner 派发核（AC2：核心/loop 文档不列 Touches，改给建议）
- orchestration/orchestrator-tick-core.md（AC2 注明：执行核 outer 独占写）
- tasks/gap-task-file-develop-integration-drift-fan-in-conflicts.md（交叉标注——0ce3f2a8 的延续，覆盖范围扩展）
- tasks/gap-write-ownership-extend-beyond-tasks-to-outer-core-and-hot-files.md（自身：勾 AC + 贴证据）

### Finding：任务文件 add/add 的确定性规则（manager 2026-08-11 08:4x，落点 Finding 不进 Contract）

**同任务文件 add/add 第 4 次复发（verification-round-phase-ms / slot-free / inner-heartbeat / split-session-liveness=杠杆2），根因可核**：`tasks/gap-split-session-liveness-signals-unblocks-lowconc.md` 在两边**各自被新建**——integration `22972e42`（03:47 你 file 三条杠杆任务时创建）vs 任务分支 `a46b88b8`（08:20 inner 勾 AC+贴证据时创建）。**两个不同提交各自 ADD 同一路径 ⇒ fan-in 必 add/add**。底层：**inner 分支 fork 自早于 03:47 的基线**，从分支视角该文件不存在、于是它新建。

**不是机制坏了，是两步舞蹈**：inner C16「冲突一律 abort+needs-human」对代码冲突对、对「同一任务文件、一边只是多了 AC 勾选和证据」杀伤过度；outer per-hunk 解得掉但每次一个来回、今晚 4 次（含杠杆2 算术确定的 −120s 卡住）。

**选定修法（manager 倾向 ①、outer 裁定采纳 ①）**：
- **① 确定性规则**：冲突路径**仅**为 `tasks/<本任务 id>.md` 时，inner 取**分支版本**（同一文件 + 本任务 AC 勾选与证据，内容是超集）；**其余任何路径仍按 C16 abort**。4 次来回 → 0 次，不放松代码冲突纪律。
- ②（更根本、后续可做）：inner **写任务体前先 rebase 到当前 integration**（A6 里 rebase 在 fan-in 时才做、那时两边已各自新建）。

### Finding：产品代码 multi-writer 冲突——任务文档规则覆盖不到、占用表（AC4）的落点（manager 2026-08-11 10:3x，落点 Finding 不进 Contract）

**resolve-pending 序列创新高且性质变了（6→8→9→11→11→12→13）——不是任务文档 add/add 类，是产品代码冲突**（manager C6b 先看实际冲突内容再判断）：`task/gap-suite-blocking-self-lock-blocks-fix-family` 改了 **`plugin/scripts/ready-pool-check.ts`**（实现代码）+ 对应测试 + 2 任务文件；inner 心跳原话「self-lock done but ready-pool-check multi-writer overlap (C16 needs-human)」。

**根因可核（outer 复核）**：`ready-pool-check.ts` 同时被**两个在飞 inner 任务**改——`gap-suite-blocking-self-lock`（af21a05d/51f19eea/637eaec9，豁免判据 isSuiteFixTask/computeSuiteBlocking）与 `gap-suite-blocking-experiment-rounds`（d5ce7a9d，skip experiment rounds）——同一产品代码文件的双写者。

**⇒ 本任务（write-ownership-extend）的 AC4 占用表正是此处落点**：touches-orthogonality-check 目前只看 inner 任务之间、且不把**产品代码热点文件**算占用（本任务 AC4 原文覆盖「outer 在飞改动」——**产品代码双写者同理应被派发前拦截**）。两个方向（manager 报）：
1. inner 派发前的 touches-orthogonality 正交性检查**理论该拦住两个同时改同一文件的任务同时在飞**——若没拦住，值得查为什么（多写者现成样本：ready-pool-check.ts 双任务）；
2. 即使拦住同时在飞，fan-in 顺序仍可能因一方 rebase 晚而冲突——**产品代码热点文件在有人变更未合并时，派发前也应算作占用**（outer 主线在飞改动同理，与 08:2x 建议一致）。

**处置**：self-lock 已按 C16 needs-human（外循环恢复其未提交状态 d2caf57a）；判定归 outer。

## Contract

measure   inner_touches_outer_core = `grep -lE "orchestration/orchestrator-|plugin/loop/orchestrator-loop-tick" tasks/*.md | wc -l` 的 stdout 数字（新派发任务含核心/loop 路径的 Touches 数）
band      inner_touches_outer_core = 0（新任务不再把 outer 核心/loop 列进 Touches）
invariant outer_inflight_in_occupancy = 1（touches-orthogonality 把 outer 在飞改动算占用——源码含 outer-inflight 项）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/touches-orthogonality-check.ts --check-pair <任务A> <任务B> --outer-inflight <文件>`（贴 outer 占用拒绝用例）
control   核心/loop 文档 outer 独占；迁移单方新建；热点占用表；既有不回归
resume    核心独占写 / 迁移单方 / 占用表 / 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-11
changed: manager 06:5x——写所有权分离只覆盖 tasks/（35→7），没覆盖 outer 执行核/loop 文档/热点实现；6 条 inner 分支卡 add/add（slot-free 改 outer 执行核 + 迁移新路径、verification-round 改 outer 正在改的 full-suite-runner、reconcile-step 改 outer 执行核）。处方：①核心/loop outer 独占写 ②迁移单方新建 ③outer 在飞改动纳入 touches-orthogonality 占用表。实现归 inner，判定归 outer

## Evidence

**实现（inner 2026-08-11）**——三招 + 测试分步提交，scoped 门绿：

- **AC1 复现固化**：6 条卡 add/add 的 inner 分支清单 + 类别（outer 执行核 / 迁移新路径 add/add / 热点实现 / 共享 loop 文档）：
  - `task/gap-slot-free-not-an-event...`（ahead=4）——改 `orchestration/orchestrator-tick-core.md`（**outer 执行核**）、`plugin/loop/orchestrator-loop-tick.md`（**迁移中新路径 ⇒ 双方各自新建 ⇒ add/add**）、`plugin/loop/fast-mode-loop-tick.md`（共享 loop 文档）、`docs/proposals/quay-product-outline.md`、`.gitignore`。
  - `task/gap-verification-round-missing...`（ahead=1）——改 `plugin/scripts/full-suite-runner.ts`（**热点实现**，outer 同期在改 systemd 限额）。
  - `task/gap-reconcile-step...`（ahead=4）——改 `orchestration/orchestrator-tick-core.md`（**outer 执行核**）。
  - `task/gap-judgment-computed-not-wired-to-action`（在飞，ahead=3）——改 `orchestration/orchestrator-tick-core.md`（**outer 执行核**）+ `plugin/scripts/capability-catalog.sh` + `scripts/test.sh`。
  - `task/gap-split-session-liveness-signals-unblocks-lowconc`（在飞，ahead=3）——改 `plugin/loop/fast-mode-loop-tick.md` + `docs/analysis/fast-mode-loop-tick.md`（共享 loop 文档）。
  - `task/gap-suite-floor-two-longest-files-bound`（在飞，ahead=4）——改 `plugin/loop/fast-mode-loop-tick.md` + `plugin/test-isolation-violations.txt`（共享 loop 文档）。
  - `0ce3f2a8` 写所有权分离把 `tasks/` 漂移从 35 降到 7（已验证），但**没覆盖**上述 outer 执行核 / loop 文档 / 热点实现类别。
- **AC2 核心/loop 文档 outer 独占**：`orchestration/orchestrator-tick-core.md` 新增 **C17** 硬约束——`orchestration/orchestrator-*.md` 与 `plugin/loop/orchestrator-loop-tick.md` 归 outer 独占写，inner 任务不得列进 Touches、不得直接改（改给建议由 outer 落盘）；`plugin/loop/fast-mode-loop-tick.md`「建任务时」节新增撰写纪律（inner 建任务不得把这两类路径列进 Touches，需要改就在 Proposal 给改动建议）。
- **AC3 迁移单方新建**：C17 ② + fast-mode-loop-tick.md 撰写纪律——迁移窗口内新路径只允许一方新建（move 一次提交，另一方只 rebase）；同路径两个提交各自 ADD ⇒ fan-in 必 add/add。
- **AC4 热点占用表**：`plugin/scripts/touches-orthogonality-check.ts` 新增 `checkOuterInflight` / `checkDispatchEligibility` + CLI `--check-pair <A> <B> [--outer-inflight <path> ...]`（outer 在飞改动算占用，同文件并发 ⇒ 拒绝派发）；fast-mode-loop-tick.md 步骤 4 新增 **3b「outer 在飞占用」**派发接线。
- **AC5 既有不回归**：`--for-task` scoped 门绿（EXIT=0，45/45 测试全绿，tick-core-static-check PASS / delivery-inventory PASS / red-on-omission PASS）。

**Contract invoke（`--check-pair --outer-inflight`，outer 占用拒绝用例）**：
```bash
node --no-warnings --experimental-strip-types plugin/scripts/touches-orthogonality-check.ts --check-pair \
  experiments/quay-perpetual-stream/fixtures/touches/disjoint-a.md \
  experiments/quay-perpetual-stream/fixtures/touches/disjoint-b.md \
  --outer-inflight experiments/quay-perpetual-stream/scripts/vmeta-lag-check.ts
# OVERLAP ... (outer-inflight occupancy: side A touches .../vmeta-lag-check.ts → serialize (outer owns it in flight)) [overlap: ...]  + exit 1
```

**scoped 测试（`bash scripts/test.sh --for-task gap-write-ownership-extend-beyond-tasks-to-outer-core-and-hot-files --allow-thin`，EXIT=0）**：
```text
ℹ tests 45
ℹ pass 45
ℹ fail 0
ℹ cancelled 0
tick-core-static-check: PASS — execution cores are statically covered.
PASS: delivery-inventory drift gate
red-on-omission-audit: band satisfied (uncov=0, all invariants true)
```

**提交（4 步分步提交）**：
- `f39f064c` AC4 占用表源码（checkOuterInflight / checkDispatchEligibility / CLI --check-pair）
- `482310ea` AC4 测试（10 条 outer-占用用例 + 测试归位 plugin/test，experiments 路径 symlink）
- `989ce334` AC2/AC3 核心/loop outer 独占写 + 迁移单方新建（orchestrator-tick-core.md C17）
- `a24122a7` AC2/AC4 派发接线 + 撰写纪律（fast-mode-loop-tick.md 步骤 3b + 建任务纪律）
