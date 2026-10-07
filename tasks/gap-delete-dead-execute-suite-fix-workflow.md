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

## Acceptance Criteria

- [ ] `grep -rn "execute-suite-fix" --include="*.js" --include="*.ts" --include="*.sh" plugin/ .claude/ packages/ 2>/dev/null | grep -v archive | grep -v '.claude/worktrees' | grep -v '.quay/deliver-worktree'` 命中数为 0（排除 tasks/*.md 散文提及，排除 archive/worktree 残留）
- [ ] `plugin/workflows/execute-suite-fix.js`、`.claude/workflows/execute-suite-fix.js`、`plugin/test/execute-suite-fix-relaunch-snapshot.test.mjs`、`plugin/test/execute-suite-fix-scope-gate.test.mjs` 四个文件已删除
- [ ] `plugin/sync.sh` 不再把 execute-suite-fix.js 列入 dual-copy 铺装；`workflows-dual-copy-drift-check` 测试不再校验该文件对（且该检查本身仍对其余 dual-copy 工作流绿）
- [ ] `plugin-packaging.test.mjs` / `quay-init.sh` 对交付内容的断言已更新为不要求 execute-suite-fix.js 存在，且相关测试绿
- [ ] `scripts/test.sh --for-task gap-delete-dead-execute-suite-fix-workflow` scoped 门绿

## Definition of Done

全部 AC 勾选；真实落地（文件已物理删除，非仅标注 SUPERSEDED——这与 `gap-wiring-A-fan-in-execute-suite-poller-impl-complete` 的裁定不同，本任务需要先确认其阻塞依赖已清，再执行物理删除）；`scripts/test.sh --for-task` scoped 门绿；无遗留孤儿引用。

## Touches

- plugin/workflows/execute-suite-fix.js
- .claude/workflows/execute-suite-fix.js
- plugin/test/execute-suite-fix-relaunch-snapshot.test.mjs
- plugin/test/execute-suite-fix-scope-gate.test.mjs
- plugin/sync.sh
- plugin/test/workflows-dual-copy-drift-check.test.mjs
- packages/quay/test/plugin-packaging.test.mjs
- tasks/gap-delete-dead-execute-suite-fix-workflow.md
