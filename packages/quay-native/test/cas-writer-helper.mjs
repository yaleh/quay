// Helper process spawned by test/cas-write.test.mjs's genuine concurrent-race
// case (QN-015 AC "genuine concurrent-race proof"). Each invocation performs
// exactly one write() call and reports its outcome (success or ConflictError)
// on stdout as a single JSON line, so the parent test can assert on real
// process exit codes / stdout, not on in-process simulation.
import { createStore } from "../src/store.js";

const [, , tasksDir, id, mode] = process.argv;
const store = createStore(tasksDir);

try {
  if (mode === "cas-writer") {
    // Simulates the vulnerable half of a Skill's gate-check pattern
    // (QN-015's Proposal): "I observed status=ready a moment ago; now apply
    // that decision." Run, as a genuinely separate OS process, AFTER the
    // interloper process has already completed its own real write() to
    // disk -- so this call's premise (expectedStatus: "ready") is, in real
    // wall-clock time, already stale by the time it executes.
    const t = store.write(id, { status: "done", expectedStatus: "ready" });
    console.log(JSON.stringify({ mode, outcome: "success", status: t.status }));
  } else if (mode === "interloper") {
    // Simulates a second, independent actor (e.g. a human or another
    // process) changing the task's status before the CAS writer's decision
    // lands -- a real separate process performing a real fs write, not an
    // in-memory stand-in.
    const t = store.write(id, { status: "needs-human" });
    console.log(JSON.stringify({ mode, outcome: "success", status: t.status }));
  } else {
    throw new Error(`unknown mode: ${mode}`);
  }
  process.exit(0);
} catch (err) {
  console.log(
    JSON.stringify({
      mode,
      outcome: err && err.name === "ConflictError" ? "conflict" : "error",
      message: err && err.message,
    })
  );
  process.exit(err && err.name === "ConflictError" ? 2 : 1);
}
