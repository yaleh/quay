// Committed negative-control fixture for task-file-bypass-check (AC4): a task-path fs read in a
// NON-allowlisted file. The checker must go RED when --root points at this fixture tree (the file is
// NOT in the ALLOWLIST). It is under plugin/test/ so the REAL-tree scan never sees it (test/ is
// excluded from the surface) — it only exists to prove the gate can fail.
import fs from "node:fs";
export function readTask() { return fs.readFileSync(`tasks/scratch-bypass.md`, "utf8"); }
