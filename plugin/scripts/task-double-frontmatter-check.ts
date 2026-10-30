#!/usr/bin/env node
// task-double-frontmatter-check.ts — detect a task file carrying TWO back-to-back frontmatter
// blocks (the gap-task-write-duplicates-frontmatter corruption signature).
//
// A well-formed task file is `---\n<yaml>\n---\n<body>`. The defect this check catches is the
// write path re-inserting a frontmatter block that the body already carried, producing
// `---\n<new fm>\n---\n---\n<old fm>\n---\n…` — two `^id:`/`^status:` lines and two
// contradictory statuses for a grep-based board. The signature is precise and code-fence-safe:
// after stripping the FIRST (authoritative) leading frontmatter block, the remainder must NOT
// begin with another `---` line. A `---` line deeper inside the body (a horizontal rule, or a
// quoted goal file inside an Evidence code fence) is NOT a second frontmatter, because the
// parser only ever reads the leading block.
//
// Usage:
//   node --experimental-strip-types task-double-frontmatter-check.ts [<task-file.md|dir> ...]
//     no args ⇒ scan <repo-root>/tasks/*.md
//     each arg may be a task file, or a directory (scanned for *.md at its top level)
//
// Per-file output (only offenders are named — a clean file is silently skipped):
//   DOUBLE-FRONTMATTER: <file>
// Summary footer:  <N> scanned, <M> double-frontmatter
//
// Exit codes:
//   0 = no double-frontmatter files
//   1 = at least one file has a double frontmatter
//   2 = usage/environment error (unreadable arg, no files found)

import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./repo-root.ts";

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

/** True iff the raw file text is `---…---\n---…` (a second frontmatter block starts immediately). */
function isDoubleFrontmatter(raw: string): boolean {
  const m = FRONTMATTER_RE.exec(raw);
  if (!m) return false;
  return /^---(\n|$)/.test(m[2] ?? "");
}

function collectMdFiles(arg: string): string[] {
  const stat = fs.statSync(arg);
  if (stat.isDirectory()) {
    return fs
      .readdirSync(arg)
      .filter((f) => f.endsWith(".md"))
      .map((f) => path.join(arg, f))
      .sort();
  }
  return [arg];
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log("usage: node task-double-frontmatter-check.ts [<task-file.md|dir> ...]");
  process.exit(0);
}

const targets = args.length > 0 ? args : [path.join(repoRoot(), "tasks")];
let files: string[] = [];
for (const t of targets) {
  let collected: string[];
  try {
    collected = collectMdFiles(t);
  } catch (e) {
    console.error(`ERROR: cannot read arg: ${t} (${(e as Error).message})`);
    process.exit(2);
  }
  files.push(...collected);
}
files = [...new Set(files)].sort();
if (files.length === 0) {
  console.error("ERROR: no .md files found in the given arguments");
  process.exit(2);
}

let scanned = 0;
let offenders = 0;
for (const file of files) {
  scanned++;
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    console.error(`ERROR: cannot read file: ${file} (${(e as Error).message})`);
    process.exit(2);
  }
  if (isDoubleFrontmatter(raw)) {
    console.log(`DOUBLE-FRONTMATTER: ${file}`);
    offenders++;
  }
}

console.log("");
console.log(`${scanned} scanned, ${offenders} double-frontmatter`);
process.exit(offenders > 0 ? 1 : 0);
