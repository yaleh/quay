#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-CAeSy4/scripts/task-double-frontmatter-check.ts
import fs2 from "node:fs";
import path2 from "node:path";

// .tmp-dist-publish-worktrees/publish-CAeSy4/scripts/repo-root.ts
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
var MAX_DEPTH = 16;
function repoRoot(startDir = path.dirname(fileURLToPath(import.meta.url))) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < MAX_DEPTH; i++) {
    const hasPkg = fs.existsSync(path.join(dir, "package.json"));
    if (hasPkg && fs.existsSync(path.join(dir, "plugin")) && fs.existsSync(path.join(dir, "scripts", "test.sh"))) {
      return dir;
    }
    if (hasPkg && fs.existsSync(path.join(dir, ".quay", "config.yml"))) {
      return dir;
    }
    if (fs.existsSync(path.join(dir, ".git"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      timeout: 5e3,
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return process.cwd();
  }
}

// .tmp-dist-publish-worktrees/publish-CAeSy4/scripts/task-double-frontmatter-check.ts
var FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
function isDoubleFrontmatter(raw) {
  const m = FRONTMATTER_RE.exec(raw);
  if (!m) return false;
  return /^---(\n|$)/.test(m[2] ?? "");
}
function collectMdFiles(arg) {
  const stat = fs2.statSync(arg);
  if (stat.isDirectory()) {
    return fs2.readdirSync(arg).filter((f) => f.endsWith(".md")).map((f) => path2.join(arg, f)).sort();
  }
  return [arg];
}
var args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log("usage: node task-double-frontmatter-check.ts [<task-file.md|dir> ...]");
  process.exit(0);
}
var targets = args.length > 0 ? args : [path2.join(repoRoot(), "tasks")];
var files = [];
for (const t of targets) {
  let collected;
  try {
    collected = collectMdFiles(t);
  } catch (e) {
    console.error(`ERROR: cannot read arg: ${t} (${e.message})`);
    process.exit(2);
  }
  files.push(...collected);
}
files = [...new Set(files)].sort();
if (files.length === 0) {
  console.error("ERROR: no .md files found in the given arguments");
  process.exit(2);
}
var scanned = 0;
var offenders = 0;
for (const file of files) {
  scanned++;
  let raw;
  try {
    raw = fs2.readFileSync(file, "utf8");
  } catch (e) {
    console.error(`ERROR: cannot read file: ${file} (${e.message})`);
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
