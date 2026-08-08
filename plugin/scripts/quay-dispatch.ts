#!/usr/bin/env node
// @instrument "Which dispatch/concurrency instrument does the consolidated dispatch entry point dispatch to (grouped entry, byte-for-byte CLI preservation)?"
// plugin/scripts/quay-dispatch.ts — ③ 派发与并发 grouped instrument entry point
// (SPEC-instruments-behind-one-entry.md AC8/AC12; tasks/gap-ac8-import-over-spawn-ticked-while-its-
// own-evidence-says-not-in-effect AC2). Consolidates the dispatch/concurrency entry points behind one
// importable module. Every member's CLI contract is preserved BYTE-FOR-BYTE.
//
//   node --experimental-strip-types plugin/scripts/quay-dispatch.ts <instrument> [args...]
//   node --experimental-strip-types plugin/scripts/quay-dispatch.ts list
//   import { list, has, run, GROUP } from "../scripts/quay-dispatch.ts";

import { createEntryPoint, type InstrumentSpec } from "./quay-entry-base.ts";
import { isDirectEntry } from "./gate-script-base.ts";

export const GROUP = "quay-dispatch";
export const MEMBERS: InstrumentSpec[] = [
  { name: "cap-from-gate", file: "cap-from-gate.ts", kind: "ts", description: "自适应并发上限（some avg10 带宽 + 滞后；avg300 churn 主导弃用，见 gap-cap-from-gate-avg300-driven-by-claude-session-churn-structural-cap-2；cap-from-gate.sh 是其薄 bash 包装）" },
  { name: "slot-refill", file: "slot-refill.ts", kind: "ts", description: "槽位补晋 REFILL GO/NO-GO（slot-refill.sh 是其薄 bash 包装）" },
  { name: "ready-pool-check", file: "ready-pool-check.ts", kind: "ts", description: "就绪池/可派发 disjoint 检查" },
  { name: "concurrent-batch-scheduler", file: "concurrent-batch-scheduler.ts", kind: "ts", description: "并发批调度（assembleBatch/touches 展开）" },
  { name: "touches-orthogonality-check", file: "touches-orthogonality-check.ts", kind: "ts", description: "触碰正交性检查（--resolve 模式）" },
  { name: "resource-gate", file: "resource-gate.sh", kind: "bash", description: "资源闸（cpu some avg300 报告 / --for full-suite 门槛）" },
];

const entry = createEntryPoint(GROUP, MEMBERS);
export const list = entry.list;
export const has = entry.has;
export const run = entry.run;
export const runCli = entry.runCli;

if (isDirectEntry(import.meta)) {
  process.exitCode = runCli(process.argv, import.meta.url);
}
