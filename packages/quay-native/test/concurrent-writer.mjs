// Helper process spawned by test/lock.test.mjs — writes a patch to one task
// id, `runs` times, with a small yield between iterations to encourage
// interleaving with a concurrently-running sibling process (QN-006 AC#2).
import { createStore } from "../src/store.ts";

// Early-exit guard: when discovered directly by node --test (process.argv has
// only node + script path; no subprocess args), exit 0 silently so the test
// runner treats this as 0 tests / 0 failures instead of a crash (M159).
if (process.argv.length < 6) {
  process.stderr.write(
    "concurrent-writer: spawned by lock.test.mjs; not meant to be run directly\n"
  );
  process.exit(0);
}

const [, , tasksDir, id, label, runsArg] = process.argv;
const runs = Number(runsArg ?? 5);
const store = createStore(tasksDir);

for (let i = 0; i < runs; i++) {
  store.write(id, { labels: [label, String(i)] });
  await new Promise((r) => setTimeout(r, 5));
}
process.exit(0);
