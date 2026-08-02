// @test-group product
// QN-024 (iteration 10): unit tests for computeStatusWrite's pure
// label-replacement/open-close decision logic, injected with a synthetic
// current-label-name list -- no live `gh api` call in this file (mirrors
// QN-014's pageIssues injection pattern; this repo's real issue count is
// too small/precious to safely target with destructive live writes in an
// automated, repeatable test file).
//
// Run: node test/write.test.mjs
import { computeStatusWrite } from "../src/github-client.ts";

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

function main() {
  // --- Case 1: status="done" always closes, never touches labels ---
  {
    const plan = computeStatusWrite({ currentLabelNames: ["status:ready", "lane:execution"], status: "done" });
    assert(plan.close === true, "done: closes the issue");
    assert(plan.addLabels.length === 0 && plan.removeLabels.length === 0, "done: no label changes (state=closed forces status=done on read regardless of label, DESIGN.md §3)");
  }

  // --- Case 2: no existing status:* label -> add the new one, remove nothing ---
  {
    const plan = computeStatusWrite({ currentLabelNames: ["lane:authoring"], status: "ready" });
    assert(plan.close === false, "ready: issue must end up open");
    assert(plan.addLabels.length === 1 && plan.addLabels[0] === "status:ready", "no prior status label: adds status:ready");
    assert(plan.removeLabels.length === 0, "no prior status label: nothing to remove");
  }

  // --- Case 3: existing single status:* label, different value -> replace ---
  {
    const plan = computeStatusWrite({ currentLabelNames: ["status:todo", "lane:execution"], status: "ready" });
    assert(plan.addLabels.length === 1 && plan.addLabels[0] === "status:ready", "replaces todo with ready");
    assert(plan.removeLabels.length === 1 && plan.removeLabels[0] === "status:todo", "removes the stale status:todo label");
  }

  // --- Case 4: existing label already matches desired -> no-op (idempotent) ---
  {
    const plan = computeStatusWrite({ currentLabelNames: ["status:ready"], status: "ready" });
    assert(plan.addLabels.length === 0, "already-correct single label: nothing to add");
    assert(plan.removeLabels.length === 0, "already-correct single label: nothing to remove");
  }

  // --- Case 5: multiple stale status:* labels present -> all removed, one added ---
  {
    const plan = computeStatusWrite({ currentLabelNames: ["status:todo", "status:needs-human", "other"], status: "ready" });
    assert(plan.addLabels.length === 1 && plan.addLabels[0] === "status:ready", "multi-stale: adds the single desired label");
    assert(
      plan.removeLabels.length === 2 &&
        plan.removeLabels.includes("status:todo") &&
        plan.removeLabels.includes("status:needs-human"),
      "multi-stale: removes both stale labels (avoids DESIGN.md §3.1 precedence ambiguity being reintroduced on write)"
    );
    const otherPreserved = !plan.removeLabels.includes("other");
    assert(otherPreserved, "non-status label ('other') is left untouched");
  }

  if (failures > 0) {
    console.error(`\n${failures} QN-024 write test failure(s).`);
    process.exitCode = 1;
  } else {
    console.log("\nAll QN-024 write tests passed.");
  }
}

main();
