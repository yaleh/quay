// it0-dir-projection-check.mjs — companion module for it0-dir-projection-check.sh.
// Reads $FILE_STATUS_TMP (tab-separated id/status/path lines, one per DIR-NNN.md file found) and
// $TASKS_JSON_TMP (a JSON array of label:directive tasks) and reports the two divergence modes
// the anti-drift check exists to catch. See the .sh wrapper's header comment for full context.
//
// Updated by M24-task-backlog-projection-impl (DIR-015 item 2 / m13 design doc §14 items 1 & 3,
// §10's DIR sub-tension resolution):
//   - Stage 1.1: join file<->task using the experiment-prefixed id scheme (`exp5-DIR-NNN`) in
//     addition to the legacy bare `DIR-NNN` id — whichever id the task store actually holds for a
//     given file is matched, so a fresh `exp5-DIR-NNN` re-projection is recognized instead of
//     silently ignored (and instead of colliding with an unrelated other-experiment task at the
//     same bare id, DIR-010's Gap A).
//   - Stage 1.2: `milestone:M-NN` labels and `## Execution record` body sections (§10's execution-
//     provenance write-back, applied by a DIFFERENT actor at ABSORB time, per a different
//     milestone) are explicitly ignored when computing divergence — this check continues to look
//     ONLY at the status-mirror field, exactly its existing narrow contract.
//   - Stage 1.3: `resolved` is accepted as a synonym of `applied` on both the file-status side and
//     the task status-mirror side (DIR-010 item 3).

import fs from "node:fs";

const fileStatusPath = process.env.FILE_STATUS_TMP;
const tasksJsonPath = process.env.TASKS_JSON_TMP;
const expPrefix = process.env.EXP_PREFIX || "";

if (!fileStatusPath || !tasksJsonPath) {
  console.error("ERROR: FILE_STATUS_TMP / TASKS_JSON_TMP env vars not set (internal wrapper bug)");
  process.exit(2);
}

let tasks;
try {
  const raw = fs.readFileSync(tasksJsonPath, "utf8");
  tasks = JSON.parse(raw);
} catch (e) {
  console.error("ERROR: could not parse tasks JSON: " + e.message);
  process.exit(2);
}
if (!Array.isArray(tasks)) tasks = [tasks];

const fileMap = new Map(); // bareId -> { status, path }
const fileLines = fs.readFileSync(fileStatusPath, "utf8").split("\n").filter(Boolean);
for (const line of fileLines) {
  const [id, status, path] = line.split("\t");
  fileMap.set(id, { status, path });
}

// Stage 1.3: status-vocabulary synonym normalization (DIR-010 item 3 / design doc §14 item 3).
function normalizeStatus(s) {
  if (s === undefined || s === null) return s;
  return s === "resolved" ? "applied" : s;
}

function extractBodyMirror(body) {
  if (!body) return undefined;
  const m = /Status mirror:\s*(\S+)/.exec(body);
  return m ? m[1] : undefined;
}

// Stage 1.2: strip milestone:M-NN-labeled provenance and the '## Execution record' body section
// before this check ever looks at a task's body/labels for anything OTHER than the status mirror
// — those fields are owned/written by a different actor (the executing milestone's ABSORB step,
// §10) at a different time, and this check's contract stays narrowly "id + status agreement".
function stripExecutionProvenance(body) {
  if (!body) return body;
  // Remove a '## Execution record' section through to the next '## ' heading or end of string.
  return body.replace(/##\s*Execution record[\s\S]*?(?=\n##\s|$)/i, "");
}

const failures = [];
// Match either the legacy bare id (DIR-NNN) or the experiment-prefixed id (exp5-DIR-NNN).
const idPattern = expPrefix
  ? new RegExp(`^(?:${expPrefix}-)?DIR-\\d+$`)
  : /^DIR-\d+$/;
const otherExperimentLabelPattern = /^experiment-(\d+)$/;

function bareIdOf(taskId) {
  if (expPrefix && taskId.startsWith(expPrefix + "-")) {
    return taskId.slice(expPrefix.length + 1);
  }
  return taskId;
}

// Cross-experiment collision guard (DIR-010 Gap A / design doc §14 item 1): a bare-id task
// belonging to ANOTHER experiment (identified by an `experiment-N` label whose N does not match
// this script's own EXP_PREFIX, e.g. exp4's bare `DIR-004` carrying `experiment-4`) must NOT be
// matched against THIS experiment's own DIR file of the same bare id — that is precisely the
// collision DIR-010 found. Only experiment-prefixed ids, or bare ids with no other-experiment
// label, are eligible to match this experiment's files.
function belongsToOtherExperiment(t) {
  if (!expPrefix) return false;
  const ownNum = expPrefix.replace(/^exp/, "");
  for (const label of t.labels || []) {
    const m = otherExperimentLabelPattern.exec(label);
    if (m && m[1] !== ownNum) return true;
  }
  return false;
}

const directiveTasks = tasks.filter((t) => idPattern.test(t.id) && !belongsToOtherExperiment(t));

// Preserve the ORIGINAL check's task-driven direction (iterate over label:directive tasks, look
// up their file by bare id) — the charter's Stage 1.1 scope is the id-scheme join fix for
// DIR-004/DIR-005, not a new file-driven inverse-check that would additionally surface the
// pre-existing, pre-M05, out-of-scope DIR-001/DIR-002 (files that predate the projection
// mechanism and have never had ANY task, under any id, bare or prefixed — a real but separate
// gap, not introduced or masked by this fix, and not part of this charter's in-scope work).
for (const t of directiveTasks) {
  const bareId = bareIdOf(t.id);
  const fileEntry = fileMap.get(bareId);
  if (!fileEntry) {
    failures.push({
      mode: "TASK-WITH-NO-FILE",
      id: t.id,
      detail: `task '${t.id}' has label 'directive' but no ${bareId}.md file exists under pending/archive/retracted`,
    });
    continue;
  }
  const body = stripExecutionProvenance(t.body);
  const rawMirror = (t.extra && t.extra.dirStatus) || extractBodyMirror(body);
  const mirror = normalizeStatus(rawMirror);
  const fileStatus = normalizeStatus(fileEntry.status);
  if (mirror === undefined) {
    failures.push({
      mode: "STATUS-DISAGREEMENT",
      id: t.id,
      detail: `task '${t.id}' has no status-mirror field (extra.dirStatus or 'Status mirror:' body line) to compare against file status '${fileEntry.status}'`,
    });
    continue;
  }
  if (mirror !== fileStatus) {
    failures.push({
      mode: "STATUS-DISAGREEMENT",
      id: t.id,
      detail: `file '${fileEntry.path}' status='${fileEntry.status}' but task '${t.id}' status-mirror='${rawMirror}' (normalized '${mirror}' vs '${fileStatus}')`,
    });
  }
}

if (failures.length === 0) {
  console.log(
    `PASS: ${fileMap.size} DIR file(s) checked against ${directiveTasks.length} label:directive task(s) (prefix='${expPrefix || "none"}') — no divergence (no orphan tasks/files, no status disagreement).`
  );
  process.exit(0);
} else {
  console.log(`FAIL: ${failures.length} divergence(s) found:`);
  for (const f of failures) {
    console.log(`  [${f.mode}] ${f.detail}`);
  }
  process.exit(1);
}
