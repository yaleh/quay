#!/usr/bin/env node
// @instrument "Which delivery/preempt instrument does the consolidated deliver entry point dispatch to (grouped entry, byte-for-byte CLI preservation)?"
// plugin/scripts/quay-deliver.ts — ② 送达与抢占 grouped instrument entry point
// (SPEC-instruments-behind-one-entry.md AC8/AC12; tasks/gap-ac8-import-over-spawn-ticked-while-its-
// own-evidence-says-not-in-effect AC2). Consolidates the send/deliver/preempt entry points behind one
// importable module. Every member's CLI contract is preserved BYTE-FOR-BYTE.
//
//   node --experimental-strip-types plugin/scripts/quay-deliver.ts <instrument> [args...]
//   node --experimental-strip-types plugin/scripts/quay-deliver.ts list
//   import { list, has, run, GROUP } from "../scripts/quay-deliver.ts";

import { createEntryPoint, type InstrumentSpec } from "./quay-entry-base.ts";
import { isDirectEntry } from "./gate-script-base.ts";

export const GROUP = "quay-deliver";
export const MEMBERS: InstrumentSpec[] = [
  { name: "send-keys-reliable", file: "send-keys-reliable.sh", kind: "bash", description: "可靠 send-keys（C-u→文本→Enter 三段；ADR-016 驱动）" },
  { name: "supervisor-preempt", file: "supervisor-preempt.sh", kind: "bash", description: "派发/抢占/停止信号（preempt / preempt-all / preempt-task）" },
  { name: "supervisor-bus-identity", file: "supervisor-bus-identity.sh", kind: "bash", description: "tmux 总线身份/消息汇总" },
  { name: "supervisor-deliver", file: "supervisor-deliver.sh", kind: "bash", description: "跨项目送达（--root 选对 transcript）" },
  { name: "inner-blocked-signal", file: "inner-blocked-signal.ts", kind: "ts", description: "内层阻塞信号检测（--detect-stop / 心跳）" },
  { name: "inner-forensics", file: "inner-forensics.mjs", kind: "mjs", description: "内层现场取证（会话转储/时间线）" },
];

const entry = createEntryPoint(GROUP, MEMBERS);
export const list = entry.list;
export const has = entry.has;
export const run = entry.run;
export const runCli = entry.runCli;

if (isDirectEntry(import.meta)) {
  process.exitCode = runCli(process.argv, import.meta.url);
}
