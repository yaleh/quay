// @test-group product
// Stage — the goal store's COMPOSITION SHAPE (tasks/gap-routine-architecture-analysis-god-function-
// creatgoalstore, routine `architecture-analysis`, runId `architecture-analysis-1793251760204`).
//
// The finding: `createGoalStore` was a single 1,647-line closure factory (lines 1155-2802 of a
// 3,427-line module) nesting 20 declarations, several of them whole sub-systems (the I3/I4 staleness
// judgment, the I5 achieved-but-failing sweep, the frozen-population rotation, the ledger scan).
//
// THE DISPOSITION THIS FILE MAKES CHECKABLE. The factory was split by MOVING those sub-surfaces into
// modules it composes. "We split it" is a claim about a carrier, so it is measured on the carrier —
// ⛔ not asserted in prose and ⛔ not satisfied by a fixture (hard rule 4 推论三: an AC that only a
// fixture can satisfy proves "can produce", not "did produce"). Every reading below is taken from
// the REAL `packages/quay/src/core/*.ts` files on disk, and the measuring instrument itself is
// exercised in BOTH directions first (a span measure that can only ever return "small" carries no
// information — hard rule 4: a quantity structurally incapable of being false is not a measurement).
//
// WHY THE NUMBERS ARE PINNED AT ALL (hard rule 4: no numeric threshold before the cost is measured):
// they are not targets, they are RATCHETS taken from the measured before/after —
//   · `createGoalStore` span            : 1,517 lines (develop) → 872 lines (this change)
//   · every extracted module            : largest is 309 lines (goal-store-rotation.ts)
// A ratchet bound is set ABOVE the measured value, so ordinary edits inside a module never trip it
// and a regression that re-inlines a sub-surface does. ⛔ Raising it is a code change someone must
// make deliberately, in the same commit as the growth.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const CORE = new URL("../src/core/", import.meta.url);

/** Read a real production module (⛔ never a fixture — the reading must survive the carrier). */
function readCore(name) {
  return fs.readFileSync(new URL(name, CORE), "utf8");
}

/**
 * The measured span of a TOP-LEVEL function: from its signature line to the first column-0 `}` after
 * it. Deliberately a LINE-reading, not a brace counter — the source is dense with braces inside
 * comments and strings (CJK prose quotes `{ … }`), and a naive counter reports a 3-line "function"
 * for a 1,500-line one, i.e. it fails in the direction that looks like success (hard rule 3b).
 *
 * Returns null when the signature is absent — the caller must treat that as "cannot evaluate",
 * ⛔ never as "0 lines, fine".
 */
function functionSpan(source, signature) {
  const lines = source.split("\n");
  const start = lines.findIndex((l) => l.startsWith(signature));
  if (start === -1) return null;
  const end = lines.findIndex((l, i) => i > start && l === "}");
  if (end === -1) return null;
  return { start: start + 1, end: end + 1, span: end - start + 1 };
}

/** The factory signature — a LINE START match, so a comment mentioning it never counts (rule 2). */
const FACTORY = "export function createGoalStore(";

// ── the instrument is falsifiable in BOTH directions ─────────────────────────────────────────────
test("instrument self-check — functionSpan can report LARGE and SMALL (⛔ a constant reading measures nothing)", () => {
  const big = ["export function createGoalStore(", ...Array(500).fill("  // filler"), "}", ""].join("\n");
  const small = ["export function createGoalStore(", "  return 1;", "}", ""].join("\n");

  const bigSpan = functionSpan(big, FACTORY);
  assert.equal(bigSpan?.span, 502, "a 500-body-line factory MUST read as large — a span measure that cannot is not a measure");

  const smallSpan = functionSpan(small, FACTORY);
  assert.equal(smallSpan?.span, 3, "the same function with a 1-line body MUST read as small — otherwise the number above is a constant");

  assert.equal(functionSpan("no such function here\n", FACTORY), null, "an absent signature is `unknown`, ⛔ not 0 (rule 3b)");
});

// ── the instrument resolves the RIGHT function in the REAL carrier ──────────────────────────────
test("instrument self-check — on the production file it measures a known 3-line function as 3", () => {
  const src = readCore("goal-store.ts");
  // `stripEvidenceTimestamp` is a deliberate 3-line exported helper that STAYS in the store. If the
  // measure were keyed on something coarser (the file, the first brace run) it could not return 3.
  const span = functionSpan(src, "export function stripEvidenceTimestamp(");
  assert.deepEqual(span, { start: span.start, end: span.end, span: 3 }, "the span measure must resolve an individual top-level function in the real file");
});

// ── RATCHET 1: the factory is no longer a 1,500-line god-function ───────────────────────────────
test("RATCHET 1 — createGoalStore's span is ≤ 900 lines in the real core/goal-store.ts", () => {
  const span = functionSpan(readCore("goal-store.ts"), FACTORY);
  assert.ok(span, "createGoalStore must exist as a top-level function — an unreadable signature is NOT a pass (rule 3b)");
  assert.ok(
    span.span <= 900,
    `createGoalStore is ${span.span} lines (lines ${span.start}-${span.end}); the ratchet is 900 ` +
      `(measured after extraction: 872; before: 1,517). Re-inlining an extracted sub-surface trips this.`,
  );
  // And the ratchet must be BELOW the pre-extraction reading by a real margin — otherwise the bound
  // would have "passed" before the work too, and the check would be vacuous (rule 4 推论三).
  assert.ok(span.span < 1517 - 400, `the extraction must have removed ≥400 lines from the factory, measured ${1517 - span.span}`);
});

// ── RATCHET 2: every extracted module stays a module (<400 lines) ───────────────────────────────
test("RATCHET 2 — every extracted sub-surface module is < 400 lines", () => {
  const modules = [
    "goal-store-types.ts",
    "goal-store-ledger.ts",
    "goal-store-criterion-address.ts",
    "goal-store-reads.ts",
    "goal-store-checks.ts",
    "goal-store-rotation.ts",
    "goal-store-sweep.ts",
  ];
  const readings = modules.map((m) => {
    const n = readCore(m).split("\n").length;
    return { m, n };
  });
  // ENUMERATE, ⛔ don't boolean (rule 3): "which module is over budget" is the actionable info.
  const over = readings.filter((r) => r.n >= 400);
  assert.deepEqual(over, [], `modules over the 400-line target: ${JSON.stringify(over)}`);
  assert.ok(readings.every((r) => r.n > 20), `a module that is an empty shell is not an extraction: ${JSON.stringify(readings)}`);
});

// ── the modules are WIRED, not merely present (the "extracted" claim could be met by dead files) ─
test("the store IMPORTS every composed module — files on disk are not a composition", () => {
  const src = readCore("goal-store.ts");
  for (const m of [
    "./goal-store-types.ts",
    "./goal-store-ledger.ts",
    "./goal-store-criterion-address.ts",
    "./goal-store-reads.ts",
    "./goal-store-checks.ts",
    "./goal-store-rotation.ts",
    "./goal-store-sweep.ts",
  ]) {
    // POSITION, not keyword (rule 2): the specifier must appear in an import/re-export FROM clause.
    assert.match(
      src,
      new RegExp(`from "${m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`),
      `core/goal-store.ts must import/re-export from ${m} — otherwise the module is dead code and "extracted" is false`,
    );
  }
});

// ── the PUBLIC SURFACE is unchanged: the factory still returns the same 15 verbs ────────────────
test("createGoalStore's returned surface is exactly the 15 verbs it always returned", async () => {
  const { createGoalStore } = await import("../src/core/goal-store.ts");
  const dir = fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "goalstore-shape-"));
  try {
    const store = createGoalStore(path.join(dir, "goals"));
    assert.deepEqual(
      Object.keys(store).sort(),
      [
        "activeGoals",
        "checkAchievedFailing",
        "checkReverifyScope",
        "checkStalePass",
        "checkStaleness",
        "checkWithinCap",
        "frozenAchievedAcs",
        "get",
        "isGoalAchieved",
        "list",
        "listActiveCriteria",
        "listWithMalformed",
        "sweepFrozen",
        "write",
        "writeBatch",
      ],
      "the extraction moved the IMPLEMENTATION, never the ABI — a changed return set breaks every consumer",
    );
    for (const [k, v] of Object.entries(store)) {
      assert.equal(typeof v, "function", `${k} must remain a function`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
