#!/usr/bin/env node
// it0-backlog-regen.ts — regenerate backlog.md as a projection over label:milestone-candidate
// task-store tasks, per docs/proposals/exp5-task-backlog-primitive-projection.md §13.
//
// Usage:
//   node it0-backlog-regen.ts <experiment-dir> [--sort=value|updated] [--write]
//
// Without --write, prints the generated markdown to stdout (dry run). With --write,
// overwrites <experiment-dir>/backlog.md in place.
//
// Default ordering is value-view (DONE first by realized Δv desc, then open candidates by
// rough Δv̂ desc, STALE last) — never plain recency (design doc §13: "recency actively
// misorders SELECT candidates"). --sort=updated gives the alternate recency view (native
// store's updatedAt field).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStore } from "../../../packages/quay-native/src/store.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface Task {
  id: string;
  title: string;
  status: string;
  labels?: string[];
  body?: string;
  updatedAt?: number;
}

function usage(): never {
  console.error("usage: node it0-backlog-regen.ts <experiment-dir> [--sort=value|updated] [--write]");
  process.exit(2);
}

const args = process.argv.slice(2);
if (args.length === 0) usage();
const experimentDirArg = args.find((a) => !a.startsWith("--"));
if (!experimentDirArg) usage();
const experimentDir = path.resolve(process.cwd(), experimentDirArg);
const sortArg = (args.find((a) => a.startsWith("--sort=")) || "--sort=value").split("=")[1];
const doWrite = args.includes("--write");

// Repo root: walk up from experimentDir looking for tasks/ + .quay
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

function firstBodyLine(body: string, marker: string): string {
  const m = body.match(new RegExp(`## ${marker}\\n([^\\n]*)`));
  return m ? m[1].trim() : "";
}

function extractDeltaV(body: string): string {
  // Look for "Value type / cadence" section text mentioning Δv̂ or method infra
  const section = body.match(/## Value type \/ cadence\n([^\n]*)/);
  return section ? section[1].trim() : "";
}

function isStale(t: Task): boolean {
  return (t.labels || []).includes("stale");
}
function isDone(t: Task): boolean {
  return t.status === "done";
}

function statusLabel(t: Task): string {
  if (isStale(t)) return "STALE";
  if (isDone(t)) return "DONE";
  const milestoneLabel = (t.labels || []).find((l) => l.startsWith("milestone:"));
  if (milestoneLabel) return "SELECTED";
  return "open";
}

function roughValueScore(t: Task): number {
  // Sort key: DONE first (by updatedAt desc as proxy for realized-value-recency-within-done),
  // then open (by updatedAt desc as proxy — real Δv̂ parsing would need a stricter body schema),
  // then STALE last.
  if (isStale(t)) return -1;
  if (isDone(t)) return 2;
  return 1;
}

let sorted: Task[];
if (sortArg === "updated") {
  sorted = [...candidates].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
} else {
  sorted = [...candidates].sort((a, b) => {
    const sv = roughValueScore(b) - roughValueScore(a);
    if (sv !== 0) return sv;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
}

const lines: string[] = [];
lines.push(`# Milestone / Opportunity Backlog — quay-perpetual-stream (Experiment 5)`);
lines.push("");
lines.push(
  `_Generated view over \`label:milestone-candidate\` tasks (design doc §13). Regenerate with ` +
  `\`node scripts/it0-backlog-regen.ts experiments/quay-perpetual-stream --write\`. Do not hand-edit._`
);
lines.push("");
lines.push(`Sort: ${sortArg === "updated" ? "recency (updatedAt desc) — alternate view" : "value-view (DONE/open/STALE, default)"}`);
lines.push("");
lines.push("| id | title | status | value type / cadence | labels |");
lines.push("|---|---|---|---|---|");
for (const t of sorted) {
  const vt = extractDeltaV(t.body || "") || "-";
  lines.push(
    `| ${t.id} | ${t.title} | ${statusLabel(t)} | ${vt} | ${(t.labels || []).join(", ")} |`
  );
}
lines.push("");
lines.push(`_${candidates.length} milestone-candidate task(s) as of ${new Date().toISOString()}._`);
lines.push("");

const output = lines.join("\n");

if (doWrite) {
  const outPath = path.join(experimentDir, "backlog.md");
  fs.writeFileSync(outPath, output);
  console.error(`wrote ${outPath}`);
} else {
  process.stdout.write(output);
}
