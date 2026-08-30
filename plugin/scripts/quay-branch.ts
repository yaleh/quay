#!/usr/bin/env node
// @instrument "Which branch/claim instrument does the consolidated branch/claim entry point dispatch to (grouped entry, byte-for-byte CLI preservation)?"
// plugin/scripts/quay-branch.ts — ④ 分支与认领 grouped instrument entry point
// (SPEC-instruments-behind-one-entry.md AC8/AC12; tasks/gap-ac8-import-over-spawn-ticked-while-its-
// own-evidence-says-not-in-effect AC2). Consolidates the branch/claim entry points behind one
// importable module. Every member's CLI contract is preserved BYTE-FOR-BYTE.
//
//   node --experimental-strip-types plugin/scripts/quay-branch.ts <instrument> [args...]
//   node --experimental-strip-types plugin/scripts/quay-branch.ts list
//   import { list, has, run, GROUP } from "../scripts/quay-branch.ts";

import { createEntryPoint, type InstrumentSpec } from "./quay-entry-base.ts";
import { isDirectEntry } from "./gate-script-base.ts";

export const GROUP = "quay-branch";
export const MEMBERS: InstrumentSpec[] = [
  { name: "claim-task", file: "claim-task.sh", kind: "bash",
    description: "认领任务（推空 task/<id> 标记分支；--check-touches）",
    // claim-task has TWO files: the .sh is the claim/reclaim/status primitive, the .ts is the AC2
    // touch-checker (--task/--in-flight). Route by args — the .ts form takes --task, the .sh form
    // takes <task-id> + --remote.
    resolve: (args) => (args.includes("--task") || args.includes("--in-flight"))
      ? { file: "claim-task.ts", kind: "ts" }
      : { file: "claim-task.sh", kind: "bash" } },
  { name: "release-task", file: "release-task.sh", kind: "bash", description: "释放任务（合并 + 删分支）" },
  { name: "fork-baseline", file: "fork-baseline.ts", kind: "ts", description: "fork 基线（--develop/--integration）" },
  { name: "integration-batch-merge", file: "integration-batch-merge.sh", kind: "bash", description: "集成批合并（--develop/--integration）" },
  { name: "sync-lag-check", file: "sync-lag-check.sh", kind: "bash", description: "同步滞后检查" },
];

const entry = createEntryPoint(GROUP, MEMBERS);
export const list = entry.list;
export const has = entry.has;
export const run = entry.run;
export const runCli = entry.runCli;

if (isDirectEntry(import.meta)) {
  process.exitCode = runCli(process.argv, import.meta.url);
}
