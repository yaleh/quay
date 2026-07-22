// it0-task-bulk-write.ts — bulk task_write helper, built for M24-task-backlog-projection-impl's
// backfill + forward-looking-candidate writes, kept as a reusable migration utility. Performs
// local task_write-equivalent calls against the CALLING worktree's own tasks dir (the MCP
// mcp__quay__task_write tool is bound to the shared repo root, not reachable from inside a git
// worktree subprocess since each worktree has an independent tasks/ copy — see iteration-0
// report's Environment finding). Reads a JSON array of {id, title, status, labels, extra, body}
// patch objects from argv[2] (a file path) and calls store.write() for each, printing the
// resulting task JSON. Run with CWD = the target worktree/repo root.
import fs from "node:fs";
import { createStore } from "../../../packages/quay-native/src/store.ts";

interface TaskPatch {
  id: string;
  title?: string;
  status?: string;
  labels?: string[];
  extra?: Record<string, unknown>;
  body?: string;
}

const specPath: string | undefined = process.argv[2];
if (!specPath) {
  console.error("usage: node it0-task-bulk-write.ts <spec.json>");
  process.exit(2);
}
const specs: TaskPatch[] = JSON.parse(fs.readFileSync(specPath, "utf8"));
const store = createStore(process.cwd() + "/tasks");
for (const spec of specs) {
  const { id, ...patch } = spec;
  const t = store.write(id, patch);
  console.log(JSON.stringify(t, null, 2));
}
