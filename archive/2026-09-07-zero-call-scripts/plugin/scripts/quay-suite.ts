#!/usr/bin/env node
// @instrument "Which suite/gate instrument does the consolidated suite entry point dispatch to (grouped entry, byte-for-byte CLI preservation)?"
// plugin/scripts/quay-suite.ts — ⑤ 套件与门禁 grouped instrument entry point
// (SPEC-instruments-behind-one-entry.md AC8/AC12; tasks/gap-ac8-import-over-spawn-ticked-while-its-
// own-evidence-says-not-in-effect AC2). Consolidates the suite/gate entry points behind one importable
// module. Every member's CLI contract is preserved BYTE-FOR-BYTE.
//
//   node --experimental-strip-types plugin/scripts/quay-suite.ts <instrument> [args...]
//   node --experimental-strip-types plugin/scripts/quay-suite.ts list
//   import { list, has, run, GROUP } from "../scripts/quay-suite.ts";

import { createEntryPoint, type InstrumentSpec } from "./quay-entry-base.ts";
import { isDirectEntry } from "./gate-script-base.ts";

export const GROUP = "quay-suite";
export const MEMBERS: InstrumentSpec[] = [
  { name: "fast-mode-telemetry", file: "fast-mode-telemetry.ts", kind: "ts", description: "快速模式遥测（--task-start/--slots/--report）" },
  { name: "full-suite-runner", file: "full-suite-runner.ts", kind: "ts", description: "全套件运行器（--fail-fast-check/--wait-check）" },
  { name: "suite-state-trigger", file: "suite-state-trigger.ts", kind: "ts", description: "套件状态触发" },
  { name: "laydown-set-check", file: "laydown-set-check.sh", kind: "bash", description: "铺层集合检查" },
  { name: "loop-driver-check", file: "loop-driver-check.sh", kind: "bash", description: "循环驱动检查（循环机件挂没挂上）" },
];

const entry = createEntryPoint(GROUP, MEMBERS);
export const list = entry.list;
export const has = entry.has;
export const run = entry.run;
export const runCli = entry.runCli;

if (isDirectEntry(import.meta)) {
  process.exitCode = runCli(process.argv, import.meta.url);
}
