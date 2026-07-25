// Helper process spawned by test/relation-sync.test.mjs — performs ONE
// real `write({ parent })` call (from a genuinely separate OS process,
// same discipline as concurrent-writer.mjs / cas-writer-helper.mjs) so the
// concurrent-reparent test exercises the actual multi-file lock path
// (withLocks()) across real process boundaries, not an in-process
// simulation.
import { createStore } from "../src/store.ts";

// Early-exit guard: when discovered directly by node --test (process.argv has
// only node + script path; no subprocess args), exit 0 silently so the test
// runner treats this as 0 tests / 0 failures instead of a crash (M159).
if (process.argv.length < 5) {
  process.stderr.write(
    "reparent-writer: spawned by relation-sync.test.mjs; not meant to be run directly\n"
  );
  process.exit(0);
}

const [, , tasksDir, childId, newParentId] = process.argv;
const store = createStore(tasksDir);

store.write(childId, { parent: newParentId });
process.stdout.write(JSON.stringify({ outcome: "success", childId, newParentId }) + "\n");
process.exit(0);
