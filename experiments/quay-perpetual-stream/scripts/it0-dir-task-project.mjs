#!/usr/bin/env node
// it0-dir-task-project.mjs — regenerate a directive task's `body` as the FULL projection of its
// DIR-NNN.md source file, per DIR-025 / M41 (the `/quay-directive` skill step 6b full-body
// contract: Source link + complete Finding + complete Requested action + complete Acceptance
// Criteria + complete Definition of Done + any plan reference + Status mirror line, in that
// order). This mirrors DIR-014 item 6's "task = single canonical viewable record" principle
// applied to DIRECTIVE tasks instead of milestone tasks.
//
// It stays a GENERATED projection (DIR-002/M-DIR-PROJECTION): re-running this script against an
// unchanged DIR file must reproduce the exact same body byte-for-byte — it never hand-edits, and
// the DIR file remains the sole canonical source.
//
// Usage:
//   node it0-dir-task-project.mjs <dir-id> --experiment-dir=<path> [--dir-file=path] [--write]
//
//   <dir-id>      e.g. DIR-021 (bare id; the task store id is assumed to match exactly, per the
//                 anti-drift check's join key)
//   --experiment-dir=  e.g. experiments/quay-perpetual-stream — REQUIRED unless --dir-file is
//                 given explicitly. Multiple experiments in this repo reuse the same bare
//                 DIR-NNN numbering (each experiment's directives/ is its own namespace), so the
//                 search MUST be scoped to one experiment dir rather than globbing every
//                 experiments/*/directives/ tree (which can match the wrong experiment's DIR-NNN).
//   --dir-file=   optional explicit path to the DIR-NNN.md source file; if given, takes
//                 precedence over --experiment-dir and no search is performed.
//   --write       actually write the task via the native provider store (QUAY_NATIVE_TASKS_DIR
//                 env var, or ./tasks relative to CWD). Without --write, prints the generated
//                 body to stdout only (dry run) — does not touch the task store.
//
// Exit codes: 0 = success; 1 = DIR file or task not found / parse error; 2 = usage error.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function usage() {
  console.error("usage: node it0-dir-task-project.mjs <dir-id> --experiment-dir=<path> [--dir-file=path] [--write]");
  process.exit(2);
}

const args = process.argv.slice(2);
if (args.length === 0) usage();
const dirId = args.find((a) => !a.startsWith("--"));
if (!dirId || !/^DIR-\d+$/.test(dirId)) {
  console.error(`invalid <dir-id>: ${dirId} (expected e.g. DIR-021)`);
  usage();
}
const explicitFile = (args.find((a) => a.startsWith("--dir-file=")) || "").split("=")[1];
const experimentDirArg = (args.find((a) => a.startsWith("--experiment-dir=")) || "").split("=")[1];
const doWrite = args.includes("--write");

if (!explicitFile && !experimentDirArg) {
  console.error("must supply either --experiment-dir=<path> or --dir-file=<path>");
  usage();
}

function findRepoRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, "tasks")) || fs.existsSync(path.join(dir, ".quay"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

const repoRoot = findRepoRoot(process.cwd());

function locateDirFile(id) {
  if (explicitFile) {
    const p = path.resolve(process.cwd(), explicitFile);
    if (!fs.existsSync(p)) {
      console.error(`--dir-file path does not exist: ${p}`);
      process.exit(1);
    }
    return p;
  }
  // Search ONLY within the given --experiment-dir's own directives/{pending,archive,retracted}/
  // (scoped, not a global experiments/*/ glob — see usage note above on why: bare DIR-NNN
  // numbering is reused across different experiments' own directives/ namespaces).
  const experimentDir = path.resolve(repoRoot, experimentDirArg);
  if (!fs.existsSync(experimentDir)) {
    console.error(`--experiment-dir does not exist: ${experimentDir}`);
    process.exit(1);
  }
  for (const sub of ["pending", "archive", "retracted"]) {
    const dir = path.join(experimentDir, "directives", sub);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(`${id}-`) || f === `${id}.md`) {
        return path.join(dir, f);
      }
    }
  }
  console.error(`no DIR file found for ${id} under ${experimentDir}/directives/{pending,archive,retracted}/`);
  process.exit(1);
}

const dirFilePath = locateDirFile(dirId);
const dirFileAbs = path.resolve(dirFilePath);
const raw = fs.readFileSync(dirFileAbs, "utf8");

// Parse frontmatter status: line (first `- status: <value>` under the leading `# DIR-NNN` block,
// or after the yaml-ish `---` fences if present — this repo's DIR files use a lightweight
// "# DIR-NNN\n\n- status: pending\n..." header, not full YAML frontmatter).
const statusMatch = raw.match(/^\s*-\s*status:\s*(\S+)/m);
if (!statusMatch) {
  console.error(`could not find a "- status: <value>" line in ${dirFileAbs}`);
  process.exit(1);
}
const dirStatus = statusMatch[1].trim();

// Extract a named `## Section` block verbatim, up to (not including) the next `## ` heading at
// the same level, or EOF.
function extractSection(markdown, sectionName) {
  const re = new RegExp(`^##\\s+${sectionName}[^\\n]*\\n([\\s\\S]*?)(?=^##\\s|\\Z)`, "m");
  const m = markdown.match(re);
  if (!m) return null;
  return m[1].replace(/\n+$/g, "").trim();
}

const finding = extractSection(raw, "Finding");
const requestedAction = extractSection(raw, "Requested action");
// Acceptance Criteria heading may include a "(runnable)" suffix — match loosely.
const acceptanceCriteria = extractSection(raw, "Acceptance Criteria(?:\\s*\\(runnable\\))?");
const definitionOfDone = extractSection(raw, "Definition of Done(?:[^\\n]*)?");
const plan = extractSection(raw, "Plan");

if (!finding) {
  console.error(`WARNING: no "## Finding" section found in ${dirFileAbs}`);
}
if (!requestedAction) {
  console.error(`WARNING: no "## Requested action" section found in ${dirFileAbs}`);
}
if (!acceptanceCriteria) {
  console.error(`WARNING: no "## Acceptance Criteria" section found in ${dirFileAbs}`);
}
if (!definitionOfDone) {
  console.error(`WARNING: no "## Definition of Done" section found in ${dirFileAbs}`);
}

// Derive the Source: link path, relative to repo root (matching the skill's existing convention).
const sourceRelPath = path.relative(repoRoot, dirFileAbs);

const parts = [];
parts.push(`Source: \`${sourceRelPath}\``);
parts.push("");
if (finding) {
  parts.push(`## Finding`);
  parts.push("");
  parts.push(finding);
  parts.push("");
}
if (requestedAction) {
  parts.push(`## Requested action`);
  parts.push("");
  parts.push(requestedAction);
  parts.push("");
}
if (acceptanceCriteria) {
  parts.push(`## Acceptance Criteria`);
  parts.push("");
  parts.push(acceptanceCriteria);
  parts.push("");
}
if (definitionOfDone) {
  parts.push(`## Definition of Done`);
  parts.push("");
  parts.push(definitionOfDone);
  parts.push("");
}
if (plan) {
  parts.push(`## Plan`);
  parts.push("");
  parts.push(plan);
  parts.push("");
}
parts.push(`Status mirror: ${dirStatus}`);

const body = parts.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";

if (!doWrite) {
  process.stdout.write(body);
  process.exit(0);
}

// --write: patch the task store via the native provider's own store module (same module the
// native CLI/MCP server use — DIR-002/QN-024 symmetry; avoids shelling out to a second process).
const tasksDir = process.env.QUAY_NATIVE_TASKS_DIR
  ? path.resolve(process.env.QUAY_NATIVE_TASKS_DIR)
  : path.join(repoRoot, "tasks");

const storeModulePath = path.join(repoRoot, "packages", "quay-native", "src", "store.js");
if (!fs.existsSync(storeModulePath)) {
  console.error(`native provider store module not found: ${storeModulePath}`);
  process.exit(1);
}
const { createStore } = await import(storeModulePath);
const store = createStore(tasksDir);

const existing = store.get(dirId);
if (!existing) {
  console.error(`no existing task ${dirId} in store at ${tasksDir} — this script only re-projects an ALREADY-projected directive task (run the /quay-directive skill's step 6 first to create it).`);
  process.exit(1);
}

const patch = {
  body,
  extra: { ...(existing.extra || {}), dirFile: sourceRelPath, dirStatus },
};
const updated = store.write(dirId, patch);
console.error(`re-projected ${dirId} body (${body.length} bytes) from ${sourceRelPath} into ${tasksDir}`);
process.stdout.write(JSON.stringify(updated, null, 2) + "\n");
