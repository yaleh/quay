#!/usr/bin/env node
// @instrument "Which session/topology instrument does the consolidated session entry point dispatch to (grouped entry, byte-for-byte CLI preservation)?"
// plugin/scripts/quay-session.ts — ① 会话与拓扑 grouped instrument entry point
// (SPEC-instruments-behind-one-entry.md AC8/AC12; tasks/gap-ac8-import-over-spawn-ticked-while-its-
// own-evidence-says-not-in-effect AC2). Consolidates the 9 remembered-path session/topology entry
// points behind one importable module. Every member's CLI contract is preserved BYTE-FOR-BYTE: the
// entry point re-invokes the member's canonical file under its own interpreter.
//
//   node --experimental-strip-types plugin/scripts/quay-session.ts <instrument> [args...]
//   node --experimental-strip-types plugin/scripts/quay-session.ts list
//   import { list, has, run, GROUP } from "../scripts/quay-session.ts";   // in-process reuse
//
// `outer-liveness` (renamed+generalized to session-liveness per SPEC-outer-liveness-productization
// AC10-13, 2026-08-03) routes to session-liveness.sh.

import { createEntryPoint, type InstrumentSpec } from "./quay-entry-base.ts";
import { isDirectEntry } from "./gate-script-base.ts";

export const GROUP = "quay-session";
export const MEMBERS: InstrumentSpec[] = [
  { name: "session-liveness", file: "session-liveness.sh", kind: "bash", description: "会话/仓库存活监视（进程、pane 忙闲、心跳逾期，泛化自 outer-liveness）" },
  { name: "session-liveness-mount", file: "session-liveness-mount.sh", kind: "bash", description: "装载会话存活监视器" },
  { name: "monitor-mount-check", file: "monitor-mount-check.sh", kind: "bash", description: "检查监视器是否已挂载" },
  { name: "topology-check", file: "topology-check.sh", kind: "bash", description: "会话拓扑查询" },
  { name: "quay-topology", file: "quay-topology.sh", kind: "bash", description: "quay 拓扑/会话映射" },
  { name: "session-bootstrap", file: "session-bootstrap.sh", kind: "bash", description: "会话引导（tmux 会话建立）" },
  { name: "quay-launch", file: "quay-launch.sh", kind: "bash", description: "启动 quay 会话" },
  { name: "outer-liveness", file: "session-liveness.sh", kind: "bash", description: "外层存活（已泛化更名为 session-liveness，别名保留）" },
  { name: "manager-tick-readings", file: "manager-tick-readings.ts", kind: "ts", description: "管理者 tick 机械读数（三项目状态/资源/外层存活/tick日志/监视器版本，单命令产出）" },
];

const entry = createEntryPoint(GROUP, MEMBERS);
export const list = entry.list;
export const has = entry.has;
export const run = entry.run;
export const runCli = entry.runCli;

if (isDirectEntry(import.meta)) {
  process.exitCode = runCli(process.argv, import.meta.url);
}
