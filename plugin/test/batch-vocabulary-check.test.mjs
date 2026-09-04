// @test-group engine
// batch-vocabulary-check.test.mjs — tasks/gap-split-batch-vocabulary-dispatch-rolling-vs-verification-round
// (AC4/AC5/AC6): the tick-doc batch-vocabulary checker.
//
// "batch" means two different things (rolling dispatch vs the verification/closure cadence); a future
// reader could misread it as dispatch-gating and drift the behavior back. This test makes the split
// mechanically checkable:
//   - AC4: every `batch` occurrence in the inner-readable tick docs is classified (whitelist-exempt
//     mechanism true-name / task-id / historical-name, or the AC5 denial), and the Contract measure
//     grep (同批|批派发|batch-N) is ZERO in both docs.
//   - AC4 negative control: a string carrying "可同批" / "批派发" MUST be flagged (+1); the same
//     probe restored clean must NOT be flagged (proves the whitelist is not a universal excuse).
//   - AC5: the normative statement exists in both docs ("dispatch is rolling", the verification
//     cadence is verification-round-N, and verification-round-N is "不是分派门控").
//   - AC6: this file uses node:test and declares // @test-group engine.
//
// No global counts are hardcoded: every assertion is relative to the repo's two tick docs plus
// in-file fixtures.
//
// Run:
//   scripts/test.sh plugin/test/batch-vocabulary-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

/** The two tick templates whose inner-readable prose this task cleans (installed copies are mirrors). */
const TICK_DOCS = [
  path.join(REPO_ROOT, "plugin/loop/fast-mode-loop-tick.md"),
  path.join(REPO_ROOT, "plugin/loop/orchestrator-loop-tick.md"),
];

/** The Contract measure: prose that reads as "dispatch is gated / batched". */
const FORBIDDEN_RE = /同批|批派发|batch-N/;

/** Count forbidden-pattern line numbers in a doc string; returns { count, lines }. */
function forbiddenHits(src) {
  const lines = src.split("\n");
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    FORBIDDEN_RE.lastIndex = 0;
    if (FORBIDDEN_RE.test(lines[i])) hits.push(i + 1);
  }
  return { count: hits.length, lines: hits };
}

/** AC5 normative-statement markers that must exist in both docs. */
const NORMATIVE_MARKERS = [
  /verification-round-N/,
  /不是分派门控/,
  /滚动/,
];

for (const docPath of TICK_DOCS) {
  const rel = path.relative(REPO_ROOT, docPath);
  const src = fs.readFileSync(docPath, "utf8");

  test(`AC4/Contract — ${rel} has ZERO 同批|批派发|batch-N (dispatch-gating prose)`, () => {
    const { count, lines } = forbiddenHits(src);
    assert.equal(
      count,
      0,
      `expected 0 dispatch-gating batch phrases in ${rel}, got ${count} at line(s) ${lines.join(", ")}`,
    );
  });

  test(`AC5 — ${rel} carries the normative vocabulary split (verification-round-N, 不是分派门控, 滚动)`, () => {
    for (const m of NORMATIVE_MARKERS) {
      assert.ok(m.test(src), `${rel} must contain /${m.source}/ (AC5 normative statement)`);
    }
  });
}

test("AC4 negative control — a prose '可同批/批派发' phrase MUST be flagged (+1)", () => {
  const bad = "# 输出 { batch, deferred }。两者都在 batch ⇒ disjoint，可同批；\n重叠 → 不同批，等下一 tick。\n批派发需要门控。\n";
  const { count, lines } = forbiddenHits(bad);
  assert.ok(count >= 3, `expected >=3 forbidden hits, got ${count} at line(s) ${lines.join(", ")}`);
});

test("AC4 negative control — the SAME phrase restored to the new vocabulary MUST be clean (back to 0)", () => {
  const clean = "# 输出 { batch, deferred }（机件输出字段名）。两者都在 batch ⇒ disjoint，可并发/无触摸重叠，非门控分批；\n重叠 → 不可并发，等下一 tick。\n分派是滚动的，不叫批号。\n";
  const { count, lines } = forbiddenHits(clean);
  assert.equal(count, 0, `expected 0 forbidden hits on the restored vocabulary, got ${count} at line(s) ${lines.join(", ")}`);
});

test("AC4 — the mechanism true-name / task-id whitelist occurrences survive (concurrent-batch-scheduler.ts, {batch,deferred}, gap-closure-sync-...)", () => {
  const src = fs.readFileSync(TICK_DOCS[0], "utf8"); // fast-mode-loop-tick.md
  assert.ok(/concurrent-batch-scheduler\.ts/.test(src), "mechanism true-name path must remain referenced");
  assert.ok(/\{ batch, deferred \}/.test(src), "mechanism output field names must remain referenced");
  assert.ok(/gap-closure-sync-is-the-true-batch-boundary/.test(src), "task-id whitelist reference must remain");
});

test("AC1 — the dispatch section no longer reads as 'dispatch is gated' (可同批/不同批 gone)", () => {
  const src = fs.readFileSync(TICK_DOCS[0], "utf8");
  assert.ok(!/(可同批|不同批)/.test(src), "dispatch section must not contain 可同批/不同批");
  // The replacement wording is present.
  assert.ok(/可并发\/无触摸重叠，非门控分批/.test(src), "AC1 replacement wording must be present");
  assert.ok(/重叠 → 不可并发，等下一 tick/.test(src), "overlap must read 'not concurrent', not 'different batch'");
});
