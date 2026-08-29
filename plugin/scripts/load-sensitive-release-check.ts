#!/usr/bin/env node
// load-sensitive-release-check.ts — the red-window-release ADMISSION gate for the KNOWN-LOAD-SENSITIVE
// marker (gap-load-sensitive-requires-predeclared-marker, manager ruling 2026-08-08).
//
// A red window may be released via an isolation-pass ONLY for files that carry the predeclared
// KNOWN-LOAD-SENSITIVE marker (file-header comment, grep-detectable per
// plugin/loop/fast-mode-loop-tick.md "已知负载敏感族"). An UNMARKED file's isolation-pass is ONLY
// grounds to APPLY for the marker (with evidence) — never grounds to release the red window directly.
//
// This helper is the MECHANICAL admission check the inner consults at the red-window-release decision
// point. Given the set of test files whose isolation-pass is proposed as the release basis, it reports
// which carry the marker and which do not:
//   exit 0  — ALL proposed files are marked ⇒ release permitted (Path A: predeclared marker present).
//   exit 1  — at least one proposed file is unmarked ⇒ release NOT permitted (Path B: apply-for-marker).
//   exit 2  — usage/env error (no files, or an unreadable file).
//
// Usage:
//   node --no-warnings --experimental-strip-types plugin/scripts/load-sensitive-release-check.ts <file...>
//   cat files.txt | node --no-warnings --experimental-strip-types plugin/scripts/load-sensitive-release-check.ts
//
// Marker detection is grep-equivalent — `includes(MARKER)` matches the documented `grep -l
// "KNOWN-LOAD-SENSITIVE"` batch-run protocol, so this check can never diverge from the doc's grep.

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { helpExit } from "./gate-script-base.ts";

import { verified, notEvaluated, failed, driverResultToExit } from "./checker-io.ts";
import type { DriverResult } from "./checker-io.ts";

export const MARKER = "KNOWN-LOAD-SENSITIVE";

/** grep-equivalent marker test: true = marked, false = unmarked, null = unreadable/missing. */
export function hasMarker(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8").includes(MARKER);
  } catch {
    return null;
  }
}

export function checkMarked(files) {
  const marked = [];
  const unmarked = [];
  const unreadable = [];
  for (const f of files) {
    const ok = hasMarker(f);
    if (ok === null) unreadable.push(f);
    else if (ok) marked.push(f);
    else unmarked.push(f);
  }
  return { marked, unmarked, unreadable };
}

export interface MarkedReport {
  marked: string[];
  unmarked: string[];
  unreadable: string[];
}

/**
 * B4 (gap-b4-checker-reuse-driver-result)：判定收敛到 DriverResult<T> 词表。
 *   全部标记 ⇒ verified（release permitted）；任一未标记 ⇒ failed（release NOT permitted）；
 *   有不可读文件 ⇒ not-evaluated（读不到输入，硬规则 3b——⛔ 不伪造成 release 或 fail）。
 * 判断依据是【文件内容】而非调用方自述——hasMarker 读文件、includes(MARKER) 与文档 grep 协议等价。
 */
export function judgeMarkedReport(report: MarkedReport): DriverResult<MarkedReport> {
  if (report.unreadable.length > 0) {
    return notEvaluated(`${report.unreadable.length} unreadable file(s): ${report.unreadable.join(", ")}`);
  }
  if (report.unmarked.length > 0) {
    return failed(`${report.unmarked.length} unmarked file(s) — release NOT permitted (apply-for-marker path)`);
  }
  return verified(report, "全部 proposed files 携带 KNOWN-LOAD-SENSITIVE 标记");
}

export function printReport(report) {
  const lines = [];
  for (const f of report.marked) lines.push(`MARKED   ${f}`);
  for (const f of report.unmarked) {
    lines.push(`UNMARKED ${f}  (release NOT permitted — apply-for-marker path)`);
  }
  for (const f of report.unreadable) lines.push(`UNREADABLE ${f}`);
  return lines.join("\n");
}

function usage() {
  console.error(
    "Usage: load-sensitive-release-check.ts <file...>   |   stdin (one path per line)\n" +
      "exit 0 = all marked (release permitted); 1 = some unmarked (release NOT permitted); 2 = usage/env error"
  );
}

function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) helpExit("usage: load-sensitive-release-check.ts <file...> | stdin (one path per line)");
  let files = argv.filter((a) => !a.startsWith("-"));
  if (files.length === 0 && !process.stdin.isTTY) {
    const input = fs.readFileSync(0, "utf8");
    files = input.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }
  if (files.length === 0) {
    usage();
    process.exit(2);
  }
  const report = checkMarked(files);
  const out = printReport(report);
  if (out) console.log(out);
  const result = judgeMarkedReport(report);
  if (result.state === "not-evaluated") {
    console.error(`ERROR: ${result.reason}`);
  }
  process.exit(driverResultToExit(result));
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) {
  main(process.argv.slice(2));
}
