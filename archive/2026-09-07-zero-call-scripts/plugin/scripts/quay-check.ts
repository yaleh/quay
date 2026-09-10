#!/usr/bin/env node
// @instrument "Which task/document validation instrument does the consolidated check entry point dispatch to (grouped entry, byte-for-byte CLI preservation)?"
// plugin/scripts/quay-check.ts — ⑥ 任务与文档校验 grouped instrument entry point
// (SPEC-instruments-behind-one-entry.md AC8/AC12; tasks/gap-ac8-import-over-spawn-ticked-while-its-
// own-evidence-says-not-in-effect AC2). Consolidates the task/document validation entry points behind
// one importable module. Every member's CLI contract is preserved BYTE-FOR-BYTE.
//
//   node --experimental-strip-types plugin/scripts/quay-check.ts <instrument> [args...]
//   node --experimental-strip-types plugin/scripts/quay-check.ts list
//   import { list, has, run, GROUP } from "../scripts/quay-check.ts";
//
// read-probe-spec is a LIBRARY (readProbeSpec, no CLI) — it is NOT a spawnable member; it is
// re-exported below so a consumer can `import { readProbeSpec } from "../scripts/quay-check.ts"`.

import { createEntryPoint, type InstrumentSpec } from "./quay-entry-base.ts";
import { isDirectEntry } from "./gate-script-base.ts";

export { readProbeSpec } from "./read-probe-spec.ts";

export const GROUP = "quay-check";
export const MEMBERS: InstrumentSpec[] = [
  { name: "task-contract-check", file: "task-contract-check.ts", kind: "ts", description: "任务 Contract 消费者检查（ratchet）" },
  { name: "task-schema-check", file: "task-schema-check.ts", kind: "ts", description: "任务 schema v1 校验" },
  { name: "task-status-drift-check", file: "task-status-drift-check.ts", kind: "ts", description: "任务状态漂移检查" },
  { name: "self-report-vocab-check", file: "self-report-vocab-check.ts", kind: "ts", description: "自报词汇检查" },
  { name: "self-report-vocab-audit", file: "self-report-vocab-audit.ts", kind: "ts", description: "自报词汇审计" },
  { name: "strategic-doc-staleness-check", file: "strategic-doc-staleness-check.ts", kind: "ts", description: "战略文档陈旧检查" },
];

const entry = createEntryPoint(GROUP, MEMBERS);
export const list = entry.list;
export const has = entry.has;
export const run = entry.run;
export const runCli = entry.runCli;

if (isDirectEntry(import.meta)) {
  process.exitCode = runCli(process.argv, import.meta.url);
}
