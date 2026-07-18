// it0-dir-projection-check.mjs — companion module for it0-dir-projection-check.sh.
// Reads $FILE_STATUS_TMP (tab-separated id/status/path lines, one per DIR-NNN.md file found) and
// $TASKS_JSON_TMP (a JSON array of label:directive tasks) and reports the two divergence modes
// the anti-drift check exists to catch. See the .sh wrapper's header comment for full context.
//
// M24-task-backlog-projection-impl updates (design doc §14 item 1, §10 DIR sub-tension, §14
// item 3):
//   - id join: each file id (bare `DIR-NNN`) is checked against an experiment-prefixed task id
//     (`${EXP_PREFIX}-DIR-NNN`, e.g. `exp5-DIR-004`) FIRST, falling back to the bare `DIR-NNN`
//     task id if no prefixed task exists — collision-proof for new/regenerated projections while
//     leaving existing bare-id projections working unchanged.
//   - ignore-sections: `milestone:M-NN` labels and `## Execution record` body sections are
//     stripped/ignored before computing divergence — the check continues to look ONLY at the
//     status-mirror field.
//   - `resolved` is treated as a synonym of `applied` on both the file-status side and the
//     task status-mirror side.

import fs from "node:fs";

const fileStatusPath = process.env.FILE_STATUS_TMP;
const tasksJsonPath = process.env.TASKS_JSON_TMP;
const expPrefix = process.env.EXP_PREFIX || "";

if (!fileStatusPath || !tasksJsonPath) {
  console.error("ERROR: FILE_STATUS_TMP / TASKS_JSON_TMP env vars not set (internal wrapper bug)");
  process.exit(2);
}

// §14 item 3: `resolved` and `applied` are the same terminal state — normalize both sides of the
// comparison through this function rather than requiring file/task authors to pick one spelling.
function normalizeStatusSynonym(status) {
  if (status === "resolved") return "applied";
  return status;
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

const fileMap = new Map(); // id -> { status, path }
const fileLines = fs.readFileSync(fileStatusPath, "utf8").split("\n").filter(Boolean);
for (const line of fileLines) {
  const [id, status, path] = line.split("\t");
  fileMap.set(id, { status, path });
}

function extractBodyMirror(body) {
  if (!body) return undefined;
  // §10 DIR sub-tension: strip any `## Execution record` body section before scanning for the
  // `Status mirror:` line, so an execution-provenance section appended by an executing
  // milestone's ABSORB step can never accidentally shadow/confuse the mirror-line match.
  const stripped = body.replace(/^## Execution record[\s\S]*?(?=^## |\z)/m, "");
  const m = /Status mirror:\s*(\S+)/.exec(stripped);
  return m ? m[1] : undefined;
}

// §14 item 1: prefer the experiment-prefixed id form when looking up a file's projected task
// (e.g. `exp5-DIR-004`), falling back to the bare `DIR-NNN` form. Returns { fileId, fileEntry } or
// undefined if the file has neither form present in fileMap (used only by the reverse/task-side
// loop below, which needs the file id derivable FROM the task id — see idToFileKey).
function idToFileKey(taskId) {
  if (expPrefix && taskId.startsWith(expPrefix + "-")) {
    return taskId.slice(expPrefix.length + 1); // exp5-DIR-004 -> DIR-004
  }
  return taskId; // bare DIR-NNN task id -> same-named file key
}

const failures = [];
// A directive task's id is either the bare `DIR-NNN` form or the experiment-prefixed
// `${EXP_PREFIX}-DIR-NNN` form (§14 item 1) — accept both when selecting which tasks to check.
const dirIdPattern = expPrefix
  ? new RegExp(`^(?:${expPrefix}-)?DIR-\\d+$`)
  : /^DIR-\d+$/;
let directiveTasks = tasks.filter((t) => dirIdPattern.test(t.id));

// Once a bare `DIR-NNN` id has a same-numbered experiment-prefixed task (e.g. both `DIR-004` and
// `exp5-DIR-004` are present — the exact collision §14 item 1 exists to resolve), the bare-id task
// belongs to a DIFFERENT experiment's pre-existing namespace, not this one: skip it from THIS
// experiment's check rather than joining it against this experiment's file (which would produce a
// false PASS/FAIL by accidental status coincidence, not a real projection relationship).
if (expPrefix) {
  const prefixedBareIds = new Set(
    directiveTasks
      .filter((t) => t.id.startsWith(expPrefix + "-"))
      .map((t) => idToFileKey(t.id))
  );
  directiveTasks = directiveTasks.filter(
    (t) => t.id.startsWith(expPrefix + "-") || !prefixedBareIds.has(t.id)
  );
}

for (const t of directiveTasks) {
  const id = t.id;
  const fileKey = idToFileKey(id);
  const fileEntry = fileMap.get(fileKey);
  if (!fileEntry) {
    failures.push({
      mode: "TASK-WITH-NO-FILE",
      id,
      detail: `task '${id}' has label 'directive' but no ${fileKey}.md file exists under pending/archive/retracted`,
    });
    continue;
  }
  const rawMirror = (t.extra && t.extra.dirStatus) || extractBodyMirror(t.body);
  if (rawMirror === undefined) {
    failures.push({
      mode: "STATUS-DISAGREEMENT",
      id,
      detail: `task '${id}' has no status-mirror field (extra.dirStatus or 'Status mirror:' body line) to compare against file status '${fileEntry.status}'`,
    });
    continue;
  }
  const mirror = normalizeStatusSynonym(rawMirror);
  const fileStatus = normalizeStatusSynonym(fileEntry.status);
  if (mirror !== fileStatus) {
    failures.push({
      mode: "STATUS-DISAGREEMENT",
      id,
      detail: `file '${fileEntry.path}' status='${fileEntry.status}' but task '${id}' status-mirror='${rawMirror}'`,
    });
  }
}

if (failures.length === 0) {
  console.log(
    `PASS: ${directiveTasks.length} label:directive task(s) checked against ${fileMap.size} DIR file(s) — no divergence (no orphan tasks, no status disagreement).`
  );
  process.exit(0);
} else {
  console.log(`FAIL: ${failures.length} divergence(s) found:`);
  for (const f of failures) {
    console.log(`  [${f.mode}] ${f.detail}`);
  }
  process.exit(1);
}
