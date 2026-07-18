// it0-dir-projection-check.mjs — companion module for it0-dir-projection-check.sh.
// Reads $FILE_STATUS_TMP (tab-separated id/status/path lines, one per DIR-NNN.md file found) and
// $TASKS_JSON_TMP (a JSON array of label:directive tasks) and reports the two divergence modes
// the anti-drift check exists to catch. See the .sh wrapper's header comment for full context.

import fs from "node:fs";

const fileStatusPath = process.env.FILE_STATUS_TMP;
const tasksJsonPath = process.env.TASKS_JSON_TMP;

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

const fileMap = new Map(); // id -> { status, path }
const fileLines = fs.readFileSync(fileStatusPath, "utf8").split("\n").filter(Boolean);
for (const line of fileLines) {
  const [id, status, path] = line.split("\t");
  fileMap.set(id, { status, path });
}

function extractBodyMirror(body) {
  if (!body) return undefined;
  const m = /Status mirror:\s*(\S+)/.exec(body);
  return m ? m[1] : undefined;
}

const failures = [];
const directiveTasks = tasks.filter((t) => /^DIR-\d+$/.test(t.id));

for (const t of directiveTasks) {
  const id = t.id;
  const fileEntry = fileMap.get(id);
  if (!fileEntry) {
    failures.push({
      mode: "TASK-WITH-NO-FILE",
      id,
      detail: `task '${id}' has label 'directive' but no ${id}.md file exists under pending/archive/retracted`,
    });
    continue;
  }
  const mirror = (t.extra && t.extra.dirStatus) || extractBodyMirror(t.body);
  if (mirror === undefined) {
    failures.push({
      mode: "STATUS-DISAGREEMENT",
      id,
      detail: `task '${id}' has no status-mirror field (extra.dirStatus or 'Status mirror:' body line) to compare against file status '${fileEntry.status}'`,
    });
    continue;
  }
  if (mirror !== fileEntry.status) {
    failures.push({
      mode: "STATUS-DISAGREEMENT",
      id,
      detail: `file '${fileEntry.path}' status='${fileEntry.status}' but task '${id}' status-mirror='${mirror}'`,
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
