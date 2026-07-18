#!/usr/bin/env node
// it0-backlog-projection-check.mjs — companion module for it0-backlog-projection-check.sh.
// Backlog-projection anti-drift check, M24-task-backlog-projection-impl Stage 4.2
// (DIR-015 item 2 / m13 design doc §13), mirroring M05-dir-projection's own
// it0-dir-projection-check.{sh,mjs} precedent but for `label: milestone-candidate` tasks
// projected into the GENERATED `backlog.md` view instead of DIR-NNN.md files.
//
// Detects two divergence modes:
//   (a) STALE-VIEW — the regenerated `backlog.md` view's content (task count / a task's rendered
//       status) does not match the LIVE task store's current state. This is the "you edited the
//       task store but forgot to re-run the regeneration script" failure — the generated file is
//       now stale prose again, exactly the failure mode §13 exists to prevent.
//   (b) GROUPING-DISAGREEMENT — two (or more) tasks that share the same `milestone:M-NN` grouping
//       label disagree about their own `status` (one `done`, the other still `todo`/`ready`) with
//       no explicit bundling note explaining the split. A shared milestone label is supposed to
//       mean "executed/decided together" (§12) — if the store's own tasks disagree about whether
//       that milestone's work is done, the grouping itself has drifted from reality and a human
//       needs to resolve which is correct, not have the view silently paper over it.
//
// A regenerated view with a task count/status set matching the live store, and no grouping-label
// status disagreement, is not an error — that is the expected, healthy projection state.
//
// Usage:
//   node it0-backlog-projection-check.mjs <tasks-json-file> <regenerated-backlog-md-file>
//
// Exit codes: 0 = PASS; 1 = FAIL (divergence found, listed); 2 = usage/data error.

import fs from "node:fs";

const [, , tasksJsonPath, backlogMdPath] = process.argv;

if (!tasksJsonPath || !backlogMdPath) {
  console.error("Usage: node it0-backlog-projection-check.mjs <tasks-json-file> <regenerated-backlog-md-file>");
  process.exit(2);
}

let tasks;
try {
  tasks = JSON.parse(fs.readFileSync(tasksJsonPath, "utf8"));
} catch (e) {
  console.error("ERROR: could not parse tasks JSON: " + e.message);
  process.exit(2);
}
if (!Array.isArray(tasks)) tasks = [tasks];

let backlogMd;
try {
  backlogMd = fs.readFileSync(backlogMdPath, "utf8");
} catch (e) {
  console.error("ERROR: could not read backlog markdown file: " + e.message);
  process.exit(2);
}

const failures = [];

// --- (a) STALE-VIEW: every live task's id must appear in the regenerated view, and its rendered
// row must reflect its CURRENT status (not a stale one baked in at an earlier regeneration pass).
for (const t of tasks) {
  const idPattern = new RegExp(`\\|\\s*${t.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\|`);
  const rowMatch = idPattern.exec(backlogMd);
  if (!rowMatch) {
    failures.push({
      mode: "STALE-VIEW",
      id: t.id,
      detail: `task '${t.id}' exists live in the task store but has no row in the regenerated backlog view — view is stale, re-run the regeneration script`,
    });
    continue;
  }
  // Grab the full table row line containing this id to check its rendered status field.
  const lineStart = backlogMd.lastIndexOf("\n", rowMatch.index) + 1;
  const lineEnd = backlogMd.indexOf("\n", rowMatch.index);
  const line = backlogMd.slice(lineStart, lineEnd === -1 ? backlogMd.length : lineEnd);
  // The status field is rendered as `status (milestone:X)` or bare `status` — check the live
  // status string appears somewhere in that row (loose but sufficient: catches "done" rendered
  // where live is now "todo" after a re-open, or vice versa).
  if (!line.includes(`| ${t.status}`) && !line.includes(`| ${t.status} `)) {
    failures.push({
      mode: "STALE-VIEW",
      id: t.id,
      detail: `task '${t.id}' live status is '${t.status}' but its row in the regenerated view does not show that status — view was regenerated before this status change, re-run the regeneration script`,
    });
  }
}

// --- (b) GROUPING-DISAGREEMENT: tasks sharing a milestone:M-NN label must agree on status
// (all done, or all not-done) — a split with no bundling note is a drifted grouping.
const byMilestoneLabel = new Map();
for (const t of tasks) {
  const milestoneLabel = (t.labels || []).find((l) => l.startsWith("milestone:"));
  if (!milestoneLabel) continue;
  if (!byMilestoneLabel.has(milestoneLabel)) byMilestoneLabel.set(milestoneLabel, []);
  byMilestoneLabel.get(milestoneLabel).push(t);
}
for (const [label, group] of byMilestoneLabel.entries()) {
  if (group.length < 2) continue;
  const statuses = new Set(group.map((t) => t.status));
  if (statuses.size > 1) {
    failures.push({
      mode: "GROUPING-DISAGREEMENT",
      id: label,
      detail: `tasks grouped under '${label}' disagree on status: ${group.map((t) => `${t.id}=${t.status}`).join(", ")} — a shared milestone grouping should agree on execution state, or carry an explicit bundling/split note explaining the divergence`,
    });
  }
}

if (failures.length === 0) {
  console.log(
    `PASS: ${tasks.length} milestone-candidate task(s) checked against regenerated view '${backlogMdPath}' — no divergence (no stale rows, no grouping-label status disagreement).`
  );
  process.exit(0);
} else {
  console.log(`FAIL: ${failures.length} divergence(s) found:`);
  for (const f of failures) {
    console.log(`  [${f.mode}] ${f.detail}`);
  }
  process.exit(1);
}
