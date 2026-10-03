// @test-group product
// lifecycle-edge-table.test.mjs — the DECLARED lifecycle edge table
// (gap-transitions-table-lacks-needs-human-and-superseded-edges).
//
// Three things this file pins, in order of what can regress silently:
//   1. BEHAVIOUR GOLDEN — legalForward / legalBack / assertTransition over all 5×5 status pairs
//      return EXACTLY what they returned before `LIFECYCLE_EDGES` existed. The golden below was
//      generated from the pre-change module; the new table must never be wired into these
//      functions in this task's scope (a follow-up task owns that).
//   2. COVERAGE PARTITION — every pair in TASK_STATUSES×TASK_STATUSES is either a declared edge
//      or an explicitly declared illegal pair, and never both. A third "silently undeclared"
//      state is exactly hard rule 3b's failure mode (an unreadable/undeclared pair looking like a
//      checked one); adding a status or an edge without declaring it must red this file.
//   3. CURRENT EDGES — the four edges the production reading saw at/after 2026-09-20 are present
//      and marked `current`.
//
// The behavioural golden and the coverage partition are deliberately separate tests: a change to
// the coverage table must not be able to hide behind a green golden (and vice versa).

import { test } from "node:test";
import assert from "node:assert/strict";

import { TASK_STATUSES } from "../src/abi.ts";
import {
  legalForward,
  legalBack,
  assertTransition,
  lifecycleEdge,
  isDeclaredIllegalPair,
  lifecyclePairUniverse,
  LIFECYCLE_EDGES,
  LIFECYCLE_ILLEGAL_PAIRS,
} from "../src/gate/lifecycle.ts";

/** The pre-change behaviour, captured from the module BEFORE LIFECYCLE_EDGES was added.
 *  Regenerating this constant is the ONLY thing that may absorb a behaviour change to
 *  legalForward/legalBack/assertTransition — an intentional edit that shows up in review. */
const GOLDEN = {
  todo: {
    legalForward: "ready",
    legalBack: null,
    assertForward: "ok",
    assertBack: "illegal transition: todo cannot back",
  },
  ready: {
    legalForward: "done",
    legalBack: "todo",
    assertForward: "ok",
    assertBack: "ok",
  },
  done: {
    legalForward: null,
    legalBack: "ready",
    assertForward: "illegal transition: done cannot forward",
    assertBack: "ok",
  },
  "needs-human": {
    legalForward: null,
    legalBack: "todo",
    assertForward: "illegal transition: needs-human cannot forward",
    assertBack: "ok",
  },
  superseded: {
    legalForward: null,
    legalBack: null,
    assertForward: "illegal transition: superseded cannot forward",
    assertBack: "illegal transition: superseded cannot back",
  },
};

/** Observe the three behaviour functions for one status, in the golden's exact shape. */
function observe(status) {
  const attempt = (dir) => {
    try {
      assertTransition(status, dir);
      return "ok";
    } catch (err) {
      return err.message;
    }
  };
  return {
    legalForward: legalForward(status),
    legalBack: legalBack(status),
    assertForward: attempt("forward"),
    assertBack: attempt("back"),
  };
}

test("behaviour golden: legalForward/legalBack/assertTransition are unchanged for all 5×5 status pairs", () => {
  const actual = {};
  for (const status of TASK_STATUSES) actual[status] = observe(status);
  // Deep-equal over the whole 5×5 cross-product (each status carries both directions, so the
  // 25 pairs are covered: 5 statuses × {forward, back} × {legalForward, legalBack, assert}).
  for (const status of TASK_STATUSES) {
    assert.deepEqual(actual[status], GOLDEN[status], `behaviour for "${status}" changed`);
  }
  assert.deepEqual(Object.keys(actual).sort(), [...TASK_STATUSES].sort());
});

test("coverage partition: every TASK_STATUSES×TASK_STATUSES pair is declared-edge XOR declared-illegal", () => {
  const universe = lifecyclePairUniverse();
  assert.equal(universe.length, TASK_STATUSES.length * TASK_STATUSES.length, "universe is the full cross-product");
  assert.equal(new Set(universe).size, universe.length, "no duplicate pairs in the universe");

  const declared = LIFECYCLE_EDGES.map((e) => `${e.from}→${e.to}`);
  const illegal = LIFECYCLE_ILLEGAL_PAIRS.map((p) => `${p.from}→${p.to}`);

  assert.equal(new Set(declared).size, declared.length, "no duplicate declared edges");
  assert.equal(new Set(illegal).size, illegal.length, "no duplicate declared-illegal pairs");

  const universeSet = new Set(universe);
  for (const key of [...declared, ...illegal]) {
    assert.ok(universeSet.has(key), `${key} is outside TASK_STATUSES×TASK_STATUSES (unknown status word?)`);
  }

  const declaredSet = new Set(declared);
  const illegalSet = new Set(illegal);
  for (const key of universe) {
    const isDeclared = declaredSet.has(key);
    const isIllegal = illegalSet.has(key);
    assert.ok(
      isDeclared !== isIllegal,
      `${key}: must be EXACTLY ONE of declared-edge / declared-illegal (declared=${isDeclared}, illegal=${isIllegal})`
    );
  }

  // The partition is total: declared + illegal === universe.
  assert.equal(declaredSet.size + illegalSet.size, universeSet.size, "declared ∪ illegal must cover the universe exactly once");
});

test("current edges: the edges production still produced at/after 2026-09-20 are declared current", () => {
  const requiredCurrent = [
    ["ready", "needs-human"],
    ["needs-human", "ready"],
    ["ready", "superseded"],
    ["needs-human", "done"],
  ];
  for (const [from, to] of requiredCurrent) {
    const edge = lifecycleEdge(from, to);
    assert.ok(edge, `${from}→${to} must be declared in LIFECYCLE_EDGES`);
    assert.equal(edge.status, "current", `${from}→${to} must be status="current"`);
  }
});

test("table coherence: TRANSITIONS wired edges are declared, and declared edges are well-formed", () => {
  const KINDS = new Set(["promote", "retreat", "escalate", "resolve", "supersede"]);
  const ACTORS = new Set([
    "driver-promotion",
    "fan-in",
    "retreat",
    "needs-human-writer",
    "out-of-band-complete",
    "task_write",
    "unaudited",
  ]);
  for (const edge of LIFECYCLE_EDGES) {
    assert.ok(KINDS.has(edge.kind), `${edge.from}→${edge.to}: unknown kind "${edge.kind}"`);
    assert.ok(edge.status === "current" || edge.status === "legacy", `${edge.from}→${edge.to}: bad status`);
    assert.ok(Array.isArray(edge.actors) && edge.actors.length > 0, `${edge.from}→${edge.to}: actors must be non-empty`);
    for (const a of edge.actors) assert.ok(ACTORS.has(a), `${edge.from}→${edge.to}: unknown actor "${a}"`);
  }

  // Every edge the promote/retreat verbs can actually walk must be declared in the table —
  // otherwise the table would be an incomplete declaration of the live lifecycle.
  for (const status of TASK_STATUSES) {
    const forward = legalForward(status);
    if (forward !== null) {
      const edge = lifecycleEdge(status, forward);
      assert.ok(edge, `TRANSITIONS forward ${status}→${forward} is not declared in LIFECYCLE_EDGES`);
      assert.equal(edge.kind, "promote", `${status}→${forward}: a wired forward edge must be kind="promote"`);
    }
    const back = legalBack(status);
    if (back !== null) {
      const edge = lifecycleEdge(status, back);
      assert.ok(edge, `TRANSITIONS back ${status}→${back} is not declared in LIFECYCLE_EDGES`);
      assert.equal(edge.kind, "retreat", `${status}→${back}: a wired back edge must be kind="retreat"`);
    }
  }

  // "declared illegal" and "undeclared" are different answers — the helper must not conflate them.
  assert.equal(isDeclaredIllegalPair("superseded", "todo"), true);
  assert.equal(isDeclaredIllegalPair("done", "ready"), false, "done→ready is a declared edge, not illegal");
  assert.equal(isDeclaredIllegalPair("bogus", "todo"), false, "an unknown status is undeclared, never 'illegal'");
});
