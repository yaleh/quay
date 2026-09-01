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

// CLI passthrough — running this file directly still produces the exec-mode report.
if (isDirectEntry(import.meta)) {
  process.exitCode = main();
}
