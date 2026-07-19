// Helper process spawned by test/relation-sync.test.mjs — performs ONE
// real `write({ parent })` call (from a genuinely separate OS process,
// same discipline as concurrent-writer.mjs / cas-writer-helper.mjs) so the
// concurrent-reparent test exercises the actual multi-file lock path
// (withLocks()) across real process boundaries, not an in-process
// simulation.
import { createStore } from "../src/store.js";

const [, , tasksDir, childId, newParentId] = process.argv;
const store = createStore(tasksDir);

store.write(childId, { parent: newParentId });
process.stdout.write(JSON.stringify({ outcome: "success", childId, newParentId }) + "\n");
process.exit(0);
