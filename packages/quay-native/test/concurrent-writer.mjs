// Helper process spawned by test/lock.test.mjs — writes a patch to one task
// id, `runs` times, with a small yield between iterations to encourage
// interleaving with a concurrently-running sibling process (QN-006 AC#2).
import { createStore } from "../src/store.js";

const [, , tasksDir, id, label, runsArg] = process.argv;
const runs = Number(runsArg ?? 5);
const store = createStore(tasksDir);

for (let i = 0; i < runs; i++) {
  store.write(id, { labels: [label, String(i)] });
  await new Promise((r) => setTimeout(r, 5));
}
process.exit(0);
