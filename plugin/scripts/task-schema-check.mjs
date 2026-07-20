#!/usr/bin/env node
// task-schema-check.mjs — standalone CLI for the canonical task schema (canonical-task-schema
// unit B2). Imports checkTask from task-schema.mjs (the ONE schema definition); this file adds NO
// assertion logic of its own — it only reads files and prints/exits.
//
// Usage:
//   node task-schema-check.mjs <task-file.md> [<task-file.md> ...]   (glob-expanded list, e.g. tasks/*.md)
//
// Per-file output (EXACTLY one line-block per file — never a silent skip):
//   PASS: <file> — schema v1 conformant (kind=<kind>)
//   N/A legacy (no schema marker): <file>                     (grandfathered — OK, exit-0-neutral)
//   FAIL: <file> — <code>: <message>                          (one line per failing assertion)
//
// Summary footer:  <N> total, <P> pass, <L> N/A-legacy, <F> fail
//
// Exit codes:
//   0 = no FAILs (N/A-legacy files are OK — grandfathered)
//   1 = at least one marked task FAILed >=1 assertion
//   2 = usage/environment error (no args, unreadable file)

import fs from "node:fs";
import { checkTask } from "./task-schema.mjs";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: node task-schema-check.mjs <task-file.md> [<task-file.md> ...]");
  process.exit(2);
}

let pass = 0, legacy = 0, fail = 0;

for (const file of files) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    console.error(`ERROR: cannot read file: ${file} (${e.message})`);
    process.exit(2);
  }
  const report = checkTask(text);
  if (report.verdict === "N/A-legacy") {
    console.log(`N/A legacy (no schema marker): ${file}`);
    legacy++;
  } else if (report.verdict === "PASS") {
    console.log(`PASS: ${file} — schema v1 conformant (kind=${report.kind})`);
    pass++;
  } else {
    for (const f of report.failures) {
      console.log(`FAIL: ${file} — ${f.code}: ${f.message}`);
    }
    fail++;
  }
}

console.log("");
console.log(`${files.length} total, ${pass} pass, ${legacy} N/A-legacy, ${fail} fail`);

process.exit(fail > 0 ? 1 : 0);
