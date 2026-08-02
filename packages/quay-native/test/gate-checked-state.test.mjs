// @test-group product
// QN-019 (iteration 8): tighten the author->ready gate to require AC
// checked-state, not merely checkbox presence — closing the asymmetry with
// execute->done (which already requires full-checked state) that iteration
// 7's QN-017 surfaced live (a task reached `ready` with 0/2 AC checkboxes
// actually checked).
//
// Run: node test/gate-checked-state.test.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStore } from "../src/store.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tasksDir = path.join(__dirname, ".tmp-gate-checked-state-test");

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

function reset() {
  fs.rmSync(tasksDir, { recursive: true, force: true });
  fs.mkdirSync(tasksDir, { recursive: true });
}

const substantive = (label) =>
  `${label} — this is real, substantive prose describing the ${label.toLowerCase()} in enough detail to exceed the minimum content threshold for this section, well past forty characters.`;

function main() {
  reset();
  const store = createStore(tasksDir);

  // (a) zero checkboxes at all in the AC section: unchanged behavior,
  // "AC section has no checkboxes" reason.
  store.write("CS-A", {
    title: "no-checkboxes",
    status: "todo",
    body:
      `## Proposal\n${substantive("Proposal")}\n` +
      `## Plan\n${substantive("Plan")}\n` +
      `## AC\nprose only, no checkbox lines at all, well past forty non-whitespace characters of real descriptive acceptance-criteria text.\n` +
      `## DoD\n${substantive("DoD")}\n`,
  });
  {
    const r = store.check("CS-A");
    assert(r.gate === "author->ready", "CS-A: gate is author->ready");
    assert(r.ok === false, "CS-A: zero-checkbox AC fails the gate");
    assert(
      r.reason === "AC section has no checkboxes",
      `CS-A: reason is the no-checkboxes reason (got: ${r.reason})`
    );
  }

  // (b) THE EXACT CASE QN-017 EXPOSED: checkboxes present, but NONE checked.
  // Previously this passed the author->ready gate (presence-only check).
  // Must now fail, with a distinct "N/M AC checkboxes checked" reason.
  store.write("CS-B", {
    title: "present-but-unchecked",
    status: "todo",
    body:
      `## Proposal\n${substantive("Proposal")}\n` +
      `## Plan\n${substantive("Plan")}\n` +
      `## AC\n- [ ] first criterion, described with enough real prose to pass the minimum-content bar\n- [ ] second criterion, also described with enough real prose\n` +
      `## DoD\n${substantive("DoD")}\n`,
  });
  {
    const r = store.check("CS-B");
    assert(r.gate === "author->ready", "CS-B: gate is author->ready");
    assert(
      r.ok === false,
      "CS-B: checkboxes present but 0 checked now fails the gate (was the QN-017 gap)"
    );
    assert(
      r.reason === "0/2 AC checkboxes checked",
      `CS-B: reason names the checked-state count (got: ${r.reason})`
    );
  }

  // (c) partially checked: 1 of 2 checked — still must fail.
  store.write("CS-C", {
    title: "partially-checked",
    status: "todo",
    body:
      `## Proposal\n${substantive("Proposal")}\n` +
      `## Plan\n${substantive("Plan")}\n` +
      `## AC\n- [x] first criterion, described with enough real prose to pass the minimum-content bar\n- [ ] second criterion, also described with enough real prose\n` +
      `## DoD\n${substantive("DoD")}\n`,
  });
  {
    const r = store.check("CS-C");
    assert(r.gate === "author->ready", "CS-C: gate is author->ready");
    assert(r.ok === false, "CS-C: partially-checked AC fails the gate");
    assert(
      r.reason === "1/2 AC checkboxes checked",
      `CS-C: reason names the partial count (got: ${r.reason})`
    );
  }

  // (d) fully checked: must pass, exactly like execute->done already requires.
  store.write("CS-D", {
    title: "fully-checked",
    status: "todo",
    body:
      `## Proposal\n${substantive("Proposal")}\n` +
      `## Plan\n${substantive("Plan")}\n` +
      `## AC\n- [x] first criterion, described with enough real prose to pass the minimum-content bar\n- [x] second criterion, also described with enough real prose\n` +
      `## DoD\n${substantive("DoD")}\n`,
  });
  {
    const r = store.check("CS-D");
    assert(r.gate === "author->ready", "CS-D: gate is author->ready");
    assert(r.ok === true, `CS-D: fully-checked AC passes the gate (reason: ${r.reason})`);
  }

  // (e) regression: execute->done (ready branch) and done branch are
  // unaffected by this change — both already required full-checked state.
  store.write("CS-E", {
    title: "ready-branch-regression",
    status: "ready",
    body:
      `## Proposal\n${substantive("Proposal")}\n` +
      `## Plan\n${substantive("Plan")}\n` +
      `## AC\n- [ ] one\n- [ ] two\n` +
      `## DoD\n${substantive("DoD")}\n`,
  });
  {
    const r = store.check("CS-E");
    assert(r.gate === "execute->done", "CS-E: gate is execute->done (unaffected by this fix)");
    assert(r.ok === false, "CS-E: unchecked AC still fails execute->done as before");
    assert(
      r.reason === "0/2 AC checkboxes checked",
      `CS-E: execute->done reason format unchanged (got: ${r.reason})`
    );
  }

  reset();

  if (failures > 0) {
    console.error(`\n${failures} failure(s).`);
    process.exitCode = 1;
  } else {
    console.log("\nAll gate-checked-state tests passed.");
  }
}

main();

