---
id: gap-delete-dead-execute-suite-fix-workflow
title: 删除零生产调用的死工作流 execute-suite-fix.js（27111 commit 历史确认零触发；需同步处理
  sync.sh/dual-copy/packaging 的交付引用）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: finding
---
## Finding

`plugin/workflows/execute-suite-fix.js` 自身文件头注释已写明「⛔ SUPERSEDED/已退役工作流...本文件零生产调用者」。一次先前的审计定量确认了这点：搜索完整 git 历史（`git log --all --grep=execute-suite-fix`，27111+ commits）以及全部 `.quay/*.jsonl`/`orchestration/*.jsonl`/`.workflow-events/*.jsonl` 日志——每一个命中都只是关于*退役*该机制的记账性提及，或是对不相关任务 id（`gap-execute-suite-fix-green-previous-round-branch`）的子串匹配，从未出现真实的调用/运行轨迹。生产路径已确认是 `plugin/scripts/worker-fan-in.ts` 的机械 fan-in（`.quay/worker-outcome.jsonl` 中 2146 条结果记录，974 landed/1172 red）加上 `plugin/workflows/fan-in-execute.js` 作为文档化的语义兜底——`execute-suite-fix.js` 是第三个、已确认死亡的机制，但仍可被按名字派发（`export const meta` 仍让它可作为 `quay:execute-suite-fix` 被调用），且它的两个专属测试文件仍存在且仍通过，造成「它还活着」的错误印象。

**与既有任务的关系（dedup 核实，关键澄清）**：`task_list(search="execute-suite-fix")` 命中 done 任务 `gap-wiring-A-fan-in-execute-suite-poller-impl-complete`（2026-08-20批）。该任务**明确核实过**同一「零生产调用者」事实，但**裁定不删除**该文件，只把头注释升级为「标 SUPERSEDED」——理由是删除会破坏非-Touches 的依赖方：`plugin/sync.sh`（dual-copy 铺出 `.claude/workflows/execute-suite-fix.js`）、`workflows-dual-copy-drift-check`（断言两副本字节一致）、`quay-init.sh`（交付铺装）、`plugin-packaging.test.mjs`（断言其 shipped）。**这不是同一个 finding 的重复**（那个任务的机制是「接线修复语义到正确路径」，本任务的机制是「物理删除死文件」），但它是直接相关的前情：**本任务若要真正删除该文件，必须同时处理上述四个非-Touches 依赖点，否则会让 `sync.sh`/`dual-copy-drift-check`/`quay-init.sh`/`plugin-packaging.test.mjs` 复红**——这也是为什么本任务的 Touches 必须比最初建议的两个测试文件更宽。

Proposed action：删除 `plugin/workflows/execute-suite-fix.js`、`.claude/workflows/execute-suite-fix.js`（dual-copy 镜像）及其两个专属测试文件；同步移除/更新 `plugin/sync.sh` 里对该文件的 dual-copy 条目、`workflows-dual-copy-drift-check` 对它的成对校验、`quay-init.sh` 的交付铺装引用、以及 `plugin-packaging.test.mjs` 断言其 shipped 的那一条（如果移除后仍需要交付别的东西，确认该条目改为不再要求 execute-suite-fix.js 存在）。⛔ 不要动 `tasks/*.md` 里仅以散文提及 execute-suite-fix 的文件（30 个文件仅作历史/讨论引用，非代码依赖）——保持不动。⛔ 不要动已归档的历史第二份副本 `archive/2026-09-07-second-copy-retirement/` 或任何残留的 `.claude/worktrees/*`/`.quay/deliver-worktree-*` 副本（这些是任务 worktree 快照残留，不是正本）。删除前，对活的主检出树（排除 `archive/`、`.claude/worktrees/`、`.quay/deliver-worktree-*`、`tasks/*.md`）再做一次 grep，确认没有其它非测试、非归档调用者引用它。

### 落地时对前情「四个阻塞依赖点」的核实更正（位置判定，非关键词）

删除前逐点核过，**其中三点在本任务落地时已经不存在**（任务撰写与落地之间存在机制退役），实际阻塞点与任务体不同：

| 任务体点名的依赖方 | 落地时实测 | 处置 |
|---|---|---|
| `plugin/sync.sh` dual-copy 条目 | **真**（`cp .claude/workflows/execute-suite-fix.js`，:233） | 已删（连同 `5 synced`→`4 synced`） |
| `workflows-dual-copy-drift-check` | **已退役**：`plugin/scripts/workflows-dual-copy-drift-check.ts` 与 `plugin/test/workflows-dual-copy-drift-check.test.mjs` **在活树中不存在**，二者都在 `archive/2026-09-07-second-copy-retirement/`（gap-ac166 第二副本退役）；活替身是 `plugin/scripts/mirror-pair-drift-check.ts` | 无需改（无此校验）；实测替身 `mirror-pair-drift-check --root <wt>` = PASS |
| `quay-init.sh` 交付铺装引用 | **假**：`grep -c execute-suite-fix plugin/scripts/quay-init.sh` = 0（它按 `plugin/scripts/<x>` 前缀从 `plugin/workflows/*.js` **派生**落装集，从不点名该文件） | 无需改；派生集变化由 quay-init 系列测试覆盖（实测绿） |
| `plugin-packaging.test.mjs` | **真**（但路径在 `plugin/test/`，**不是**任务体写的 `packages/quay/test/`——该路径不存在） | 已改（两处 workflow 清单 + 注释） |

**任务体未点名、但落地时会让套件复红的真实依赖点（删除前 grep 逐个发现的）**，已全部处置：
`plugin/scripts/red-on-omission-audit.ts`（`scope_worktree_gate` 的 `okConsumer` **真实读取**该文件内容，删除 ⇒ invariant 断 ⇒ 检查器红）、`plugin/scripts/checker-mutation-cases/red-on-omission-audit.sh`（同名 mutation case 的 fixture）、`.quay/suite-bucket-reattribution.jsonl`（**tracked** 的再归属棘轮载体，两条 entry 变 zombie ⇒ `suite-bucket-reattr-ratchet-check` exit 1）、`plugin/test/concurrency-literal-check.test.mjs`（断该文件在 `scanSurface()` 里）、`packages/quay/test/build-plugin-dist.test.mjs`（dist 载体枚举 + `scanned===6`）、`plugin/test/shipped-agent-text-unbound-vars.test.mjs`、`plugin/test/fan-in-execute-plugin-root-arg.test.mjs`、`plugin/test/suite-bucket-attribution.test.mjs`（GROUP_B 恰 20 条）、`docs/analysis/test-file-baseline.txt`（`test-file-snapshot-check`：删除 = 红）、`docs/analysis/suite-perfile-duration-baseline.json`。

## Acceptance Criteria

- [x] `grep -rn "execute-suite-fix" --include="*.js" --include="*.ts" --include="*.sh" plugin/ .claude/ packages/ 2>/dev/null | grep -v archive | grep -v '.claude/worktrees' | grep -v '.quay/deliver-worktree'` 命中数为 0（排除 tasks/*.md 散文提及，排除 archive/worktree 残留）
  - **实测 = 0**（删除前 = 20 条 / 9 个文件）。20 条按【位置】逐条判定后处置：3 条在被删文件自身；5 条在 `plugin/workflows/fan-in-execute.js` 的**注释**、2 条在 `plugin/scripts/full-suite-runner.ts` 注释、1 条在 `plugin/scripts/runner-static-gate.ts` 注释、2 条在 `plugin/scripts/concurrency-literal-check.ts` 注释、1 条在 `plugin/scripts/pane-state-classify.ts` 的 pane **fixture 字符串**、2 条在 `plugin/scripts/red-on-omission-audit.ts`、2 条在 `plugin/sync.sh`、2 条在 mutation case —— 全部删除或改写（保留信息、去掉已删文件的名字，避免活树里留下悬空引用）。⛔ 未用「换成同形异码点」等绕过手法。
- [x] `plugin/workflows/execute-suite-fix.js`、`.claude/workflows/execute-suite-fix.js`、`plugin/test/execute-suite-fix-relaunch-snapshot.test.mjs`、`plugin/test/execute-suite-fix-scope-gate.test.mjs` 四个文件已删除
  - 实测四条路径全部 `-e` 为假。**说明**：第 2 条 `.claude/workflows/execute-suite-fix.js` 在落地树里**本就不存在**（第二副本已于 2026-09-07 归档到 `archive/2026-09-07-second-copy-retirement/.claude/workflows/execute-suite-fix.js`，未删除、按任务体要求保持不动）——该子句对本仓库是空真，不是「删了两次」。
- [x] `plugin/sync.sh` 不再把 execute-suite-fix.js 列入 dual-copy 铺装；`workflows-dual-copy-drift-check` 测试不再校验该文件对（且该检查本身仍对其余 dual-copy 工作流绿）
  - `plugin/sync.sh`：`cp .../execute-suite-fix.js` 行已删，注释同步更新，`workflows: 5 synced` → `4 synced`；保留的 4 条 cp（drain-directives / run-routines / fan-in-execute / pool-quality-judge）未动。
  - **`workflows-dual-copy-drift-check` 本身已退役**（活树无此文件/测试，见上表；`gap-ac166-second-copy-retirement`）⇒ 「不再校验该文件对」自动成立，但其括号内「该检查本身仍对其余 dual-copy 工作流绿」**无法在该检查上取读数**（硬规则 3b：不把「读不到」写成「绿」）。活替身实测：`node --experimental-strip-types plugin/scripts/mirror-pair-drift-check.ts --root <wt>` ⇒ `PASS — every mirror pair matches or is allow-listed`（exit 0）。
- [x] `plugin-packaging.test.mjs` / `quay-init.sh` 对交付内容的断言已更新为不要求 execute-suite-fix.js 存在，且相关测试绿
  - `plugin/test/plugin-packaging.test.mjs`：`wanted` 与 `singleSourceWorkflows` 两个清单各去掉一条，测试名「the five workflow files」→「the surviving workflow files」，注释改。
  - `quay-init.sh`：**从不点名该文件**（`grep -c` = 0）⇒ 无断言可改；派生落装集的变化由 quay-init 系列测试覆盖，实测 `quay-init-loop` / `laydown-set-check` / `quay-init-laydown-closure` / `l1-delivery-surface-check` / `verify-delivery-surface` 共 64 tests 全绿。
- [x] `scripts/test.sh --for-task gap-delete-dead-execute-suite-fix-workflow` scoped 门绿
  - 读数见下 `## Evidence`（在 worktree、merge develop 之后跑）。

## Definition of Done

全部 AC 勾选；真实落地（文件已物理删除，非仅标注 SUPERSEDED——这与 `gap-wiring-A-fan-in-execute-suite-poller-impl-complete` 的裁定不同，本任务需要先确认其阻塞依赖已清，再执行物理删除）；`scripts/test.sh --for-task` scoped 门绿；无遗留孤儿引用。

## Touches

- plugin/workflows/execute-suite-fix.js (delete)
- plugin/test/execute-suite-fix-relaunch-snapshot.test.mjs (delete)
- plugin/test/execute-suite-fix-scope-gate.test.mjs (delete)
- plugin/sync.sh
- plugin/scripts/red-on-omission-audit.ts
- plugin/scripts/checker-mutation-cases/red-on-omission-audit.sh
- plugin/scripts/concurrency-literal-check.ts
- plugin/scripts/full-suite-runner.ts
- plugin/scripts/pane-state-classify.ts
- plugin/scripts/runner-static-gate.ts
- plugin/workflows/fan-in-execute.js
- plugin/test/concurrency-literal-check.test.mjs
- plugin/test/fan-in-execute-plugin-root-arg.test.mjs
- plugin/test/plugin-packaging.test.mjs
- plugin/test/shipped-agent-text-unbound-vars.test.mjs
- plugin/test/suite-bucket-attribution.test.mjs
- packages/quay/test/build-plugin-dist.test.mjs
- docs/analysis/test-file-baseline.txt
- docs/analysis/suite-perfile-duration-baseline.json
- .quay/suite-bucket-reattribution.jsonl
- tasks/gap-delete-dead-execute-suite-fix-workflow.md

## Evidence

（worker `gap-delete-dead-execute-suite-fix-workflow`；worktree `/data/home/yale/work/quay-worktrees/gap-delete-dead-execute-suite-fix-workflow`，branch `task/gap-delete-dead-execute-suite-fix-workflow`，实现提交 `6ed796396`）

### AC1 — 原始命令，删除后取读数

```
$ grep -rn "execute-suite-fix" --include="*.js" --include="*.ts" --include="*.sh" plugin/ .claude/ packages/ 2>/dev/null \
  | grep -v archive | grep -v '.claude/worktrees' | grep -v '.quay/deliver-worktree' | wc -l
0
```

删除前的同一条命令 = **20**（9 个文件）：`plugin/workflows/execute-suite-fix.js`×2、`plugin/workflows/fan-in-execute.js`×6、`plugin/scripts/red-on-omission-audit.ts`×2、`plugin/scripts/concurrency-literal-check.ts`×2、`plugin/scripts/full-suite-runner.ts`×2、`plugin/sync.sh`×2、`plugin/scripts/checker-mutation-cases/red-on-omission-audit.sh`×2、`plugin/scripts/runner-static-gate.ts`×1、`plugin/scripts/pane-state-classify.ts`×1。
逐条按位置判定（硬规则 2：注释/字符串提及也是本命令的命中，故一并处理，不留悬空名字）：唯一**功能性的**读取点是 `red-on-omission-audit.ts:127`（`readUnder` 真读文件内容），其余是注释/夹具字符串。

### AC2 — 四条路径存在性

`for f in …; do [ -e "$f" ] …` ⇒ 四条全部 `absent`（其中 `.claude/workflows/execute-suite-fix.js` 落地前就不存在，见 AC 说明）。

### 全量/相关测试（删除后在 worktree 实跑，均 0 fail）

| 命令 | 读数 |
|---|---|
| `scripts/test.sh plugin/test/suite-bucket-attribution.test.mjs plugin/test/pane-state-classify.test.mjs plugin/test/red-on-omission-audit.test.mjs` | tests 57 / pass 57 / fail 0 |
| `scripts/test.sh plugin/test/concurrency-literal-check.test.mjs plugin/test/plugin-packaging.test.mjs packages/quay/test/build-plugin-dist.test.mjs …` | tests 117 / pass 117 / fail 0 |
| `scripts/test.sh packages/quay/test/build-plugin-dist.test.mjs` | tests 44 / fail 0；其中 `AC3 — …the guard reads every shipped carrier and reports inert` ✔（`scanned` 6→**5**）、`AC5 — all five shipped workflows…` ✔ |
| `scripts/test.sh plugin/test/shipped-agent-text-unbound-vars.test.mjs plugin/test/fan-in-execute-plugin-root-arg.test.mjs plugin/test/fan-in-execute-paths-s08/s09/s10` | tests 42 / pass 42 / fail 0 |
| `scripts/test.sh plugin/test/gate-scripts-retirement.test.mjs plugin/test/delivery-inventory-drift-gate.test.mjs plugin/test/user-scope-reinstall.test.mjs plugin/test/fan-in-workflow-retirement-check.test.mjs` | tests 37 / pass 37 / fail 0 |
| `node --test plugin/test/checker-mutation-check.test.mjs` | tests 11 / fail 0；**`AC3: mutations_that_stayed_green is 0`** ✔（改过的 mutation case 仍能被注入缺陷顶红） |
| `scripts/test.sh plugin/test/quay-init-loop.test.mjs plugin/test/laydown-set-check.test.mjs plugin/test/quay-init-laydown-closure.test.mjs plugin/test/l1-delivery-surface-check.test.mjs plugin/test/verify-delivery-surface.test.mjs plugin/test/ac260-ac261-delivery-face-ref-source.test.mjs` | tests 64 / pass 64 / fail 0 |

### 静态检查（直接取读数）

```
$ node --experimental-strip-types plugin/scripts/suite-bucket-reattr-ratchet-check.ts --gate --root <wt>
PASS — 0 pure-S un-attributed (layer 1); 0 zombie entr(y|ies) (layer 3); 56 S-signal-multi un-attributed (layer 2, report-only)
```
（删除前同一条 = `FAIL — 2 zombie reattribution entr(y|ies)`，点名两个被删测试文件；两条 entry 已随本次删除一并从 tracked 载体 `.quay/suite-bucket-reattribution.jsonl` 移除。）

```
$ node --experimental-strip-types plugin/scripts/sh-census-check.ts --gate --root <wt>
PASS — embeddedInterpreterLines=7695 ≤ 7695, duplicateCopies=0 ≤ 0
```

```
$ node --experimental-strip-types plugin/scripts/mirror-pair-drift-check.ts --root <wt>
PASS — every mirror pair matches or is allow-listed with an unchanged signature.
```

### 保留不动的散文/历史提及（按位置判定为非调用者，且不在 AC1 的命令面内）

`tasks/*.md`（含本任务与 `gap-wiring-A-…`）、`CHANGELOG.md`、`docs/proposals/archguard-generation-era-primitives.md`、`orchestration/**`（SPEC/escalations/tick-core/manager-phase-goal——其中 `orchestrator-tick-core.md` 的两处是**退役记录**本身：「随 outer 不再跑 suite 整体退役，AC84」）、`archive/**`、`.quay/ac260-branch-content-spotchecks.txt`（无消费者的取证快照）、`plugin/test/fixtures/pane-states/busy-outer-panel-1.txt`（**逐字 capture，作为证据不改**——`pane-state-classify.ts` 里的同形夹具已归一化并在注释中指向它）。

### 已知遗留（明说，不静默）

- `plugin/test/fan-in-execute-paths-s08.test.mjs` 与 `plugin/test/delivery-inventory-drift-gate.test.mjs` 的**注释/测试名**仍以散文提到已删文件（`.mjs` 不在 AC1 的 `--include` 面内，且该测试断言的是 fan-in-execute 的行为、不是该文件名）。保留为历史叙述。
- 本任务**不**触碰 `orchestration/*.md` 的散文提及：它们是被 AC1 排除、且属于方法论层的退役记录（硬规则 11b 之外的写面）。
