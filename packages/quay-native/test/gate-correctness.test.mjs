// @test-group product
// QN-005 (iteration 2): gate-correctness deepening tests.
// Covers Plan Phase 3's four cases:
//   (a) heading-only-no-content task correctly fails author->ready with the
//       new reason
//   (b) substantive content in all four sections but no AC checkboxes
//       correctly fails with the new checkbox reason
//   (c) a task meeting both new bars passes author->ready
//   (d) an already-done task (QN-006-fixture-equivalent) still gates
//       correctly post-change — no regression on the ready->done path
//
// Run: node test/gate-correctness.test.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStore } from "../src/store.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tasksDir = path.join(__dirname, ".tmp-gate-correctness-test");

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

function main() {
  reset();
  const store = createStore(tasksDir);

  // (a) heading-only-no-content: each section has a heading but trivial
  // content (< MIN_SECTION_CHARS non-whitespace chars).
  store.write("GC-A", {
    title: "heading-only",
    status: "todo",
    body: "## Proposal\nx\n## Plan\nx\n## AC\nx\n## DoD\nx\n",
  });
  {
    const r = store.check("GC-A");
    assert(r.gate === "author->ready", "GC-A: gate is author->ready");
    assert(r.ok === false, "GC-A: heading-only-no-content fails the gate");
    assert(
      /missing artifacts/.test(r.reason),
      `GC-A: reason names missing artifacts (got: ${r.reason})`
    );
  }

  // (b) substantive content in all four sections, but AC has no checkbox
  // lines (prose only).
  const substantive = (label) =>
    `${label} — this is real, substantive prose describing the ${label.toLowerCase()} in enough detail to exceed the minimum content threshold for this section, well past forty characters.`;
  store.write("GC-B", {
    title: "no-ac-checkboxes",
    status: "todo",
    body:
      `## Proposal\n${substantive("Proposal")}\n` +
      `## Plan\n${substantive("Plan")}\n` +
      `## AC\nThe acceptance criteria are described here in prose only, without any machine-checkable checkbox lines at all.\n` +
      `## DoD\n${substantive("DoD")}\n`,
  });
  {
    const r = store.check("GC-B");
    assert(r.gate === "author->ready", "GC-B: gate is author->ready");
    assert(r.ok === false, "GC-B: prose-only AC (no checkboxes) fails the gate");
    assert(
      r.reason === "AC section has no checkboxes",
      `GC-B: reason is the new specific checkbox-missing reason (got: ${r.reason})`
    );
  }

  // (c) meets both bars: substantive content in all four sections AND at
  // least one AC checkbox present. (Checked-state is no longer required at
  // author->ready — gap-both-gates-read-one-signal-so-done-costs-nothing /
  // ADR-001 restored; unchecked AC boxes are covered as a PASSING case in
  // gate-checked-state.test.mjs CS-B/CS-C.)
  store.write("GC-C", {
    title: "meets-both-bars",
    status: "todo",
    body:
      `## Proposal\n${substantive("Proposal")}\n` +
      `## Plan\n${substantive("Plan")}\n` +
      `## AC\n- [x] a real, checkable acceptance criterion\n- [x] another one\n` +
      `## DoD\n${substantive("DoD")}\n`,
  });
  {
    const r = store.check("GC-C");
    assert(r.gate === "author->ready", "GC-C: gate is author->ready");
    assert(r.ok === true, `GC-C: passes when both new bars are met (reason: ${r.reason})`);
  }

  // (d) no regression on the ready->done path for an already-done task
  // (QN-006-fixture-equivalent): status "done" must still report the
  // terminal, unconditional-pass result.
  store.write("GC-D", {
    title: "already-done",
    status: "done",
    body:
      `## Proposal\n${substantive("Proposal")}\n` +
      `## Plan\n${substantive("Plan")}\n` +
      `## AC\n- [x] done criterion\n` +
      `## DoD\n- [x] done item\n`,
  });
  {
    const r = store.check("GC-D");
    assert(r.gate === "none", "GC-D: done task reports gate 'none'");
    assert(r.ok === true, "GC-D: done task still gates ok:true (terminal)");
    assert(r.reason === "terminal", "GC-D: done task reason is 'terminal'");
  }

  // QN-068 (iteration 64): the needs-human soft-stop branch has never been
  // directly unit-tested — provenance.md's iterations 7-9 narrate real,
  // live `needs-human` transitions, but nothing regression-tests the exact
  // response shape going forward. Confirmed beforehand: `grep -rn "soft
  // stop" packages/*/test/*.mjs` returned zero hits.
  store.write("GC-F", {
    title: "needs-human-soft-stop",
    status: "needs-human",
    body: "anything, irrelevant — this branch does not inspect body content",
  });
  {
    const r = store.check("GC-F");
    assert(r.gate === "none", "GC-F: needs-human task reports gate 'none'");
    assert(r.ok === false, "GC-F: needs-human task gates ok:false (soft stop, not terminal-pass)");
    assert(
      r.reason === "soft stop; human action required",
      `GC-F: reason is the exact soft-stop text (got: ${r.reason})`
    );
  }

  // QN-068 (iteration 64): the final "unrecognized status" fallthrough has
  // never been directly unit-tested either. Confirmed beforehand: `grep -rn
  // "gate.*unknown\|gate: \"unknown\"" packages/*/test/*.mjs` returned zero
  // hits. This is a genuine defensive branch (check()/checkGate() accept
  // any string in `status` with no upstream validation inside these
  // specific functions), not dead code.
  // store.write() rejects any status outside VALID_STATUSES (a real,
  // separate write-time validation layer) -- so this genuinely-defensive
  // check()/checkGate() fallthrough (no upstream validation inside check()
  // itself) is exercised the same way a hand-edited/corrupted task file on
  // disk would trigger it: write a valid task, then patch the on-disk
  // frontmatter's status field directly, bypassing store.write()'s guard.
  store.write("GC-G", {
    title: "unrecognized-status-value",
    status: "todo",
    body: "anything, irrelevant — this branch does not inspect body content",
  });
  {
    const p = path.join(tasksDir, "GC-G.md");
    const raw = fs.readFileSync(p, "utf8");
    fs.writeFileSync(p, raw.replace("status: todo", "status: bogus-status-value"));
  }
  {
    const r = store.check("GC-G");
    assert(r.gate === "unknown", "GC-G: unrecognized-status task reports gate 'unknown'");
    assert(r.ok === false, "GC-G: unrecognized-status task gates ok:false");
    assert(
      r.reason === "unrecognized status bogus-status-value",
      `GC-G: reason names the exact unrecognized status value (got: ${r.reason})`
    );
  }

  // Bonus regression check (not a Plan Phase 3 item, but directly relevant
  // to this task's own scope): the \Z-is-not-a-JS-anchor bug fix — a
  // ready task whose AC prose contains a bare "z"/"Z" must no longer have
  // its AC section truncated early.
  store.write("GC-E", {
    title: "z-in-prose-regression",
    status: "ready",
    body:
      `## Proposal\n${substantive("Proposal")}\n` +
      `## Plan\n${substantive("Plan")}\n` +
      `## AC\nWhen the count is zero this used to truncate.\n- [ ] one\n- [ ] two\n- [ ] three\n- [ ] four\n` +
      `## DoD\n${substantive("DoD")}\n`,
  });
  {
    const r = store.check("GC-E");
    assert(r.gate === "execute->done", "GC-E: gate is execute->done");
    assert(
      r.acTotal === 4,
      `GC-E: AC section is not truncated at the word "zero" (acTotal should be 4, got ${r.acTotal})`
    );
  }

  // AC3 (gap-both-gates-read-one-signal-so-done-costs-nothing): a task whose
  // AC is written completely but has ZERO boxes checked must PASS author->ready
  // (checked-state belongs to ready->done, not todo->ready). This is the exact
  // live specimen the task names: meta-cc's DIR-102 was established with 4 AC
  // boxes all unchecked, and that is precisely what should be eligible to start.
  store.write("GC-H", {
    title: "ac-complete-zero-checked",
    status: "todo",
    body:
      `## Proposal\n${substantive("Proposal")}\n` +
      `## Plan\n${substantive("Plan")}\n` +
      `## AC\n- [ ] first acceptance criterion, written but not yet worked\n- [ ] second acceptance criterion, written but not yet worked\n` +
      `## DoD\n${substantive("DoD")}\n`,
  });
  {
    const r = store.check("GC-H");
    assert(r.gate === "author->ready", "GC-H: gate is author->ready");
    assert(
      r.ok === true,
      `GC-H (AC3): AC written but 0 checked passes author->ready (got ok=${r.ok}, reason="${r.reason}")`
    );
  }

  // AC7b (the MAIN criterion): execute->done must read the DoD checked-state,
  // not the AC checked-state. AC all checked + DoD all unchecked => RED.
  // (DIR-102's exact shape: established 00:24, all 4 AC checked 00:29, zero
  // real work, DoD three boxes all unchecked — previously certified closeable.)
  store.write("GC-I", {
    title: "ac-checked-dod-unchecked",
    status: "ready",
    body:
      `## Proposal\n${substantive("Proposal")}\n` +
      `## Plan\n${substantive("Plan")}\n` +
      `## AC\n- [x] first result assertion, checked anyway\n- [x] second result assertion, checked anyway\n- [x] third result assertion, checked anyway\n- [x] fourth result assertion, checked anyway\n` +
      `## DoD\n- [ ] one real task went through dispatch-close with its telemetry records attached\n- [ ] make commit passes\n- [ ] changes landed on main\n`,
  });
  {
    const r = store.check("GC-I");
    assert(r.gate === "execute->done", "GC-I: gate is execute->done");
    assert(
      r.ok === false,
      `GC-I (AC7b): AC all checked but DoD all unchecked => execute->done RED (got ok=${r.ok}, reason="${r.reason}")`
    );
    assert(
      r.reason === "0/3 DoD checkboxes checked",
      `GC-I: reason names the DoD checked-state count (got: ${r.reason})`
    );
  }

  // AC5 (ready->done must not be loosened): AC not all checked must STILL make
  // execute->done red, even with DoD fully checked — "ready too strict" must
  // not be traded for "done too loose".
  store.write("GC-J", {
    title: "ac-partial-dod-checked",
    status: "ready",
    body:
      `## Proposal\n${substantive("Proposal")}\n` +
      `## Plan\n${substantive("Plan")}\n` +
      `## AC\n- [x] first acceptance criterion, checked\n- [ ] second acceptance criterion, NOT checked\n` +
      `## DoD\n- [x] definition-of-done item, genuinely done\n`,
  });
  {
    const r = store.check("GC-J");
    assert(r.gate === "execute->done", "GC-J: gate is execute->done");
    assert(
      r.ok === false,
      `GC-J (AC5): AC not all checked => execute->done RED even with DoD checked (got ok=${r.ok}, reason="${r.reason}")`
    );
    assert(
      r.reason === "1/2 AC checkboxes checked",
      `GC-J: reason names the AC checked-state count (got: ${r.reason})`
    );
  }

  reset();

  if (failures > 0) {
    console.error(`\n${failures} failure(s).`);
    process.exitCode = 1;
  } else {
    console.log("\nAll gate-correctness tests passed.");
  }
}

main();
