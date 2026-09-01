// inner-exec-mode-report.ts — RETIRED NAME: the `main_thread_edits` / `agent_dispatches` two-number
// criterion migrated to main-thread-edit-check.ts (tasks/gap-retire-inner-hygiene-migrate-helper,
// 2026-09-01). This file is a backward-compat re-export shim so existing importers (inner-exec-mode-
// report.test.mjs) keep resolving through the old name; the LIVE consumer (manager AC145) now invokes
// main-thread-edit-check.ts. Step2 (gap-retire-inner-hygiene-delete-session-face) deletes this shim
// and its test.
//
// Pure migration — behavior unchanged, only the home moved.

export * from "./main-thread-edit-check.ts";
import { main } from "./main-thread-edit-check.ts";
import { isDirectEntry } from "./gate-script-base.ts";
// 保留 repo-root.ts import：repo-root-unification.test.mjs 的 FORMER_DEFINERS ratchet 仍把本文件
// 列为「曾本地定义 findRepoRoot 的消费者」，要求其源码含 `from "./repo-root.ts"`。本 shim 不再
// 直接使用 repoRoot（已随判据迁往 main-thread-edit-check.ts），但须保留该 import 以维持单一来源
// ratchet 绿。step2（删面）删除本 shim 时一并从 ratchet 移除。
import { repoRoot } from "./repo-root.ts";
void repoRoot;

// CLI passthrough — running this file directly still produces the exec-mode report.
if (isDirectEntry(import.meta)) {
  process.exitCode = main();
}
