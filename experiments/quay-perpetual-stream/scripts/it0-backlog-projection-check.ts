#!/usr/bin/env node
// it0-backlog-projection-check.ts — anti-drift check for backlog.md as a generated projection
// over label:milestone-candidate tasks (design doc §4, mirror image of M05's
// it0-dir-projection-check: task canonical, backlog.md is the regenerated view).
//
// Usage:
//   node it0-backlog-projection-check.ts <experiment-dir>
//
// Detects two divergence modes:
//   (a) STALE-VIEW — backlog.md contains an id/row with no corresponding milestone-candidate
//       task in the store (near-impossible once regeneration itself is correct, but real value
//       is catching a stale un-regenerated backlog.md after a task-field change).
//   (b) GROUPING-DISAGREEMENT — backlog.md's row for an id disagrees with that task's own
//       milestone:M-NN label / status field (regenerated-but-drifted, or hand-edited backlog.md).
//
// Since backlog.md is now generated (§13), the primary mechanism is a content-hash comparison:
// regenerate the view in-memory and diff against the on-disk file. If they differ, the file is
// stale (either hand-edited, or a task field changed since last regeneration) and needs
// `it0-backlog-regen.ts --write` to be re-run. This subsumes both (a) and (b) as special cases
// of "the on-disk view no longer matches what the task store would generate" — plus we also do a
// row-level id-set diff so the failure message names the specific divergence mode for a human.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createStore } from "../../../packages/quay-native/src/store.ts";

interface Task {
  id: string;
  title: string;
  status: string;
  labels?: string[];
  body?: string;
  updatedAt?: number;
}

function usage(): never {
  console.error("usage: node it0-backlog-projection-check.ts <experiment-dir>");
  process.exit(2);
}

const args = process.argv.slice(2);
const experimentDirArg = args.find((a) => !a.startsWith("--"));
if (!experimentDirArg) usage();
const experimentDir = path.resolve(process.cwd(), experimentDirArg);

function findRepoRoot(startDir: string): string {
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
const store = createStore(path.join(repoRoot, "tasks"));

const candidates: Task[] = store.list({ label: "milestone-candidate" });

const backlogPath = path.join(experimentDir, "backlog.md");
if (!fs.existsSync(backlogPath)) {
  console.error(`ERROR: ${backlogPath} does not exist`);
  process.exit(2);
}
const onDisk = fs.readFileSync(backlogPath, "utf8");

// --- (a) STALE-VIEW: ids present in backlog.md's table FIRST COLUMN (the actual row id, not
// prose/label text elsewhere in the row) but absent from the current milestone-candidate task
// set. Only scans lines of the form "| <id> | ..." to avoid false positives from label text like
// "milestone:M24-..." appearing later in the same row.
const taskIds = new Set(candidates.map((t) => t.id));
const idsInDoc = new Set<string>();
const rowIdPattern = /^\|\s*(exp5-[A-Za-z0-9-]+|M-[A-Za-z0-9-]+|M\d{2}[A-Za-z0-9-]*)\s*\|/;
for (const rawLine of onDisk.split("\n")) {
  const m2 = rowIdPattern.exec(rawLine);
  if (m2) idsInDoc.add(m2[1]);
}

function idMatchesTask(docId: string, taskId: string): boolean {
  if (docId === taskId) return true;
  // allow bare-id doc token to match an exp5-prefixed task id
  if (taskId === `exp5-${docId}`) return true;
  return false;
}

const staleViewIds: string[] = [];
for (const docId of idsInDoc) {
  const hasMatch = [...taskIds].some((tid) => idMatchesTask(docId, tid));
  if (!hasMatch) staleViewIds.push(docId);
}

// --- (b) GROUPING-DISAGREEMENT: for ids that DO match a task, check whether the doc's nearby
// status word (DONE/STALE/open/SELECTED) disagrees with the task's own status/labels.
function taskStatusLabel(t: Task): string {
  const labels = t.labels || [];
  if (labels.includes("stale")) return "STALE";
  if (t.status === "done") return "DONE";
  if (labels.some((l) => l.startsWith("milestone:"))) return "SELECTED";
  return "open";
}

interface GroupingDisagreement {
  id: string;
  expectedStatus: string;
  row: string;
}

const groupingDisagreements: GroupingDisagreement[] = [];
const lines = onDisk.split("\n");
for (const t of candidates) {
  const rowLine = lines.find(
    (l) => l.includes(t.id) || l.includes(t.id.replace(/^exp5-/, ""))
  );
  if (!rowLine) continue; // no row for this task at all is a regen-needed case, caught below by hash diff
  const expected = taskStatusLabel(t);
  if (!rowLine.includes(expected)) {
    groupingDisagreements.push({ id: t.id, expectedStatus: expected, row: rowLine.trim() });
  }
}

// --- content-hash / regeneration-needed check: regenerate in-memory (value-view, default sort)
// and compare against on-disk. This is the general "stale, un-regenerated backlog.md" catch-all
// per §4 ("diff the last-regenerated backlog.md's content hash/timestamp against the current
// task-store state and flag regeneration needed").
function regenerate(): string {
  function roughValueScore(t: Task): number {
    if ((t.labels || []).includes("stale")) return -1;
    if (t.status === "done") return 2;
    return 1;
  }
  const sorted = [...candidates].sort((a, b) => {
    const sv = roughValueScore(b) - roughValueScore(a);
    if (sv !== 0) return sv;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
  const rowLines = sorted.map((t) => {
    const vtMatch = (t.body || "").match(/## Value type \/ cadence\n([^\n]*)/);
    const vt = vtMatch ? vtMatch[1].trim() : "-";
    return `| ${t.id} | ${t.title} | ${taskStatusLabel(t)} | ${vt} | ${(t.labels || []).join(", ")} |`;
  });
  return rowLines.join("\n");
}

function bodyHash(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
}

const regenRows = regenerate();
const onDiskRowLines = lines.filter((l) => l.startsWith("| exp5-") || l.startsWith("| M-") || /^\| M\d{2}/.test(l));
const onDiskRows = onDiskRowLines.join("\n");
const regenerationNeeded = bodyHash(regenRows) !== bodyHash(onDiskRows);

const failures: string[] = [];
if (staleViewIds.length > 0) {
  failures.push(`STALE-VIEW: ${staleViewIds.length} id(s) in backlog.md have no matching milestone-candidate task: ${staleViewIds.join(", ")}`);
}
if (groupingDisagreements.length > 0) {
  for (const d of groupingDisagreements) {
    failures.push(`GROUPING-DISAGREEMENT: task ${d.id} expected status "${d.expectedStatus}" not found in its backlog.md row: "${d.row}"`);
  }
}
if (regenerationNeeded && staleViewIds.length === 0 && groupingDisagreements.length === 0) {
  failures.push(`REGENERATION-NEEDED: backlog.md row content does not match a fresh regeneration from the task store (hash mismatch) — run it0-backlog-regen.ts --write`);
}

if (failures.length > 0) {
  console.log(`FAIL: ${failures.length} backlog-projection divergence(s) found:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
} else {
  console.log(`PASS: ${candidates.length} milestone-candidate task(s) checked against backlog.md — no divergence (no stale-view ids, no grouping disagreement, regeneration current).`);
  process.exit(0);
}
