// @test-group product
// task-transition.test.mjs — the KERNEL task-status transition primitives
// (packages/quay/src/kernel/task-transition.ts, GOAL-030 ①).
//
// Four things this file pins, in order of what can regress silently:
//   1. VOCABULARY — the kernel's own status set equals `abi.ts`'s `TASK_STATUSES`. The kernel cannot
//      import `abi.ts` (kernel leaf), so the two declarations are structurally separate copies; this
//      equality is what keeps them from drifting apart silently (hard rule 5b).
//   2. DECISION OVER THE FULL 5×5 — `decideTransition` returns `allow` for exactly the `current`
//      edges, and `refuse` for every other KNOWN pair (no edge, or a `legacy` edge). Enumerated, not
//      sampled: a verdict that is right for two pairs and wrong for the other twenty-three is the
//      failure this catches.
//   3. NOT-EVALUATED IS ITS OWN ANSWER — an unknown status word returns `not-evaluated`, NEVER
//      `refuse`. That is hard rule 3b: an unreadable input must not look like a judged-and-refused
//      one. A predicate that returns one boolean for both cannot pass this test.
//   4. EVENT WRITE — `appendTaskStatusEvent` appends one complete JSON record whose `writerModule`
//      is THIS kernel module's realpath (the direct reading GOAL-030 AC-337 uses to prove which code
//      ran), and a failed write returns `{ok:false, reason}` without throwing.
//
// Run: scripts/test.sh packages/quay/test/task-transition.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TASK_STATUSES as ABI_STATUSES } from "../src/abi.ts";
import {
  TASK_STATUSES,
  LIFECYCLE_EDGES,
  decideTransition,
  patchStatusField,
  appendTaskStatusEvent,
} from "../src/kernel/task-transition.ts";

/** The kernel module's own realpath — what `appendTaskStatusEvent` reports as `writerModule`. */
const KERNEL_FILE = fs.realpathSync(fileURLToPath(new URL("../src/kernel/task-transition.ts", import.meta.url)));

// ── 1. vocabulary ────────────────────────────────────────────────────────────────────────────────

test("vocabulary: the kernel status set equals abi.TASK_STATUSES (the two declarations cannot drift)", () => {
  assert.deepEqual(
    [...TASK_STATUSES].sort(),
    [...ABI_STATUSES].sort(),
    "kernel TASK_STATUSES and abi.TASK_STATUSES must be the same five words",
  );
});

// ── 2. the decision over the full 5×5 cross-product ──────────────────────────────────────────────

test("decideTransition: the full 5×5 returns allow IFF the pair is a declared `current` edge", () => {
  const current = new Set(LIFECYCLE_EDGES.filter((e) => e.status === "current").map((e) => `${e.from}→${e.to}`));

  let allowed = 0;
  for (const from of TASK_STATUSES) {
    for (const to of TASK_STATUSES) {
      const d = decideTransition(from, to);
      const key = `${from}→${to}`;
      if (current.has(key)) {
        assert.equal(d.verdict, "allow", `${key} is a current edge but decideTransition said "${d.verdict}"`);
        assert.equal(d.edge.from, from);
        assert.equal(d.edge.to, to);
        assert.equal(d.edge.status, "current");
        allowed++;
      } else {
        assert.equal(d.verdict, "refuse", `${key} is not a current edge but decideTransition said "${d.verdict}"`);
        assert.ok(typeof d.reason === "string" && d.reason.length > 0, `${key}: refuse must carry a reason`);
      }
    }
  }

  // Non-vacuity: the corpus genuinely contains current edges (a decision that never allows anything
  // would pass the loop above while proving nothing — the zero-count control).
  assert.ok(allowed > 0, "LIFECYCLE_EDGES declares no `current` edge — the predicate would be vacuous");
  assert.equal(allowed, current.size, "every current edge must have been allowed exactly once");
});

test("decideTransition: a declared `legacy` edge is REFUSED by default, allowed only on explicit opt-in", () => {
  const legacy = LIFECYCLE_EDGES.filter((e) => e.status === "legacy");
  assert.ok(legacy.length > 0, "LIFECYCLE_EDGES declares no `legacy` edge — this test would be vacuous");
  for (const e of legacy) {
    assert.equal(decideTransition(e.from, e.to).verdict, "refuse", `${e.from}→${e.to} (legacy) must refuse by default`);
    assert.equal(
      decideTransition(e.from, e.to, { allowLegacy: true }).verdict,
      "allow",
      `${e.from}→${e.to} (legacy) must be allowed when allowLegacy is set`,
    );
  }
});

// ── 3. not-evaluated is a distinct answer (hard rule 3b) ─────────────────────────────────────────

test("decideTransition: an unknown status is `not-evaluated`, NEVER conflated with `refuse`", () => {
  const cases = [
    ["bogus", "ready"],
    ["todo", "bogus"],
    ["bogus", "bogus"],
    ["", "done"],
    ["TODO", "ready"], // case matters: the vocabulary is lower-case
  ];
  for (const [from, to] of cases) {
    const d = decideTransition(from, to);
    assert.equal(d.verdict, "not-evaluated", `${JSON.stringify(from)}→${JSON.stringify(to)} must be not-evaluated`);
    assert.notEqual(d.verdict, "refuse", "not-evaluated must not be reported as refuse (hard rule 3b)");
    assert.ok(typeof d.reason === "string" && d.reason.length > 0, "not-evaluated must carry a reason");
  }
});

// ── 4. the structured status-transition event ────────────────────────────────────────────────────

test("appendTaskStatusEvent: one complete record per call; writerModule is THIS kernel module's realpath", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "task-status-events-"));
  const base = { taskId: "T-1", from: "todo", to: "ready", kind: "promote", actor: "test" };
  try {
    const first = appendTaskStatusEvent(root, { ...base, reason: "unit test" });
    assert.equal(first.ok, true, `write failed: ${first.ok === false ? first.reason : ""}`);

    const file = path.join(root, ".quay", "task-status-events.jsonl");
    let lines = fs.readFileSync(file, "utf8").trim().split("\n");
    assert.equal(lines.length, 1, "exactly one record after one call");

    const rec = JSON.parse(lines[0]);
    for (const k of ["ts", "taskId", "from", "to", "kind", "actor", "reason", "writerModule", "entry", "pid"]) {
      assert.ok(k in rec, `record is missing field "${k}": ${JSON.stringify(rec)}`);
    }
    assert.equal(rec.taskId, "T-1");
    assert.equal(rec.from, "todo");
    assert.equal(rec.to, "ready");
    assert.equal(rec.kind, "promote");
    assert.equal(rec.actor, "test");
    assert.equal(rec.reason, "unit test");
    assert.equal(typeof rec.pid, "number");
    assert.ok(!Number.isNaN(Date.parse(rec.ts)), `ts is not a parseable timestamp: ${rec.ts}`);
    assert.equal(fs.realpathSync(rec.writerModule), KERNEL_FILE, "writerModule must be the kernel module's realpath");

    // A SECOND call APPENDS (never overwrites) — the carrier is a log.
    const second = appendTaskStatusEvent(root, base); // no reason ⇒ the key must be ABSENT (缺值 = 未查)
    assert.equal(second.ok, true);
    lines = fs.readFileSync(file, "utf8").trim().split("\n");
    assert.equal(lines.length, 2, "append must grow the log, not replace it");
    assert.ok(!("reason" in JSON.parse(lines[1])), "an omitted reason must be ABSENT, not empty-string");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("appendTaskStatusEvent: an unwritable target returns {ok:false, reason} — it never throws", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "task-status-events-fail-"));
  try {
    // A regular FILE where a directory is required ⇒ mkdir/append must fail (deterministic: ENOTDIR,
    // independent of the user's uid, unlike a chmod-based approach).
    const notADir = path.join(tmp, "not-a-dir");
    fs.writeFileSync(notADir, "x");

    let result;
    assert.doesNotThrow(() => {
      result = appendTaskStatusEvent(notADir, { taskId: "T", from: "todo", to: "ready", kind: "promote", actor: "t" });
    });
    assert.equal(result.ok, false, "a failed write must return ok:false");
    assert.ok(typeof result.reason === "string" && result.reason.length > 0, "ok:false must carry a reason (never silent)");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── the moved patchStatusField (pinned here too; task-ops.test.mjs covers it via the re-export) ───

test("patchStatusField: replaces the status value byte-for-byte and honours the fromStatus guard", () => {
  const fm = "id: a\ntitle: b\nstatus: todo\nlabels:\n  - gap\n";
  const applied = patchStatusField(fm, "ready");
  assert.equal(applied.ok, true);
  assert.equal(applied.replaced, true);
  assert.equal(applied.fm, "id: a\ntitle: b\nstatus: ready\nlabels:\n  - gap\n");

  const noop = patchStatusField(fm, "ready", "done"); // current is todo, not done ⇒ no-op
  assert.equal(noop.ok, true);
  assert.equal(noop.replaced, false);
  assert.equal(noop.fm, fm);

  const failClosed = patchStatusField("id: a\ntitle: b\n", "ready");
  assert.equal(failClosed.ok, false);
  assert.equal(failClosed.reason, "no-status-line");
});
