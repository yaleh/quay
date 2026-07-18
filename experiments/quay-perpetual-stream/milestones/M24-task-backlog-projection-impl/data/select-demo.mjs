// One-time demonstration script (M24 iteration-0) — run with CWD = repo root so
// process.cwd() + "/tasks" resolves to the live task store.
import { createStore } from "../../../packages/quay-native/src/store.js";

const store = createStore(process.cwd() + "/tasks");

// SELECT: choose exp5-M-TASK-BACKLOG-PROJECTION-IMPL for M24 (the real, live SELECT this
// milestone itself represents) — apply milestone:M-NN label + status todo -> ready.
const chosen = store.get("exp5-M-TASK-BACKLOG-PROJECTION-IMPL");
const chosenLabels = Array.from(new Set([...(chosen.labels || []), "milestone:M24-task-backlog-projection-impl"]));
const afterChosen = store.write("exp5-M-TASK-BACKLOG-PROJECTION-IMPL", {
  labels: chosenLabels,
  status: "ready",
});
console.log("=== SELECTED task ===");
console.log(JSON.stringify(afterChosen, null, 2));

// Not-selected notes on the other candidates considered this same pass.
const notSelected = [
  "exp5-M-ADVERSARIAL-EVAL",
  "exp5-M-CLI-UX",
  "exp5-M-COMPETITIVE-BENCH",
  "exp5-M-DIRTASK",
  "exp5-M-DOCS",
  "exp5-M-OUTCOME-EVAL",
];
for (const id of notSelected) {
  store.appendNote(id, `Not selected @M24: DIR-015/DIR-016's standing hard floor already committed this SELECT pass to M-TASK-BACKLOG-PROJECTION-IMPL (self-hosting fix, blocks all future SELECT read-path work) — a governance/infra candidate whose own enabling half was itself unselectable until this milestone lands.`);
}
console.log("=== one representative NOT-SELECTED task (exp5-M-OUTCOME-EVAL) ===");
console.log(JSON.stringify(store.get("exp5-M-OUTCOME-EVAL"), null, 2));
