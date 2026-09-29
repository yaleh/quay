// @test-group engine
// ratchet-baseline.test.mjs — tasks/gap-routine-semantic-dedup-scan-baseline-reader-septuplication:
// the ONE shrink-only ratchet reader/writer that the `semantic-dedup-scan` routine's
// `baseline-reader-septuplication` finding (kind identity-replication, verdict real-duplication)
// asked to be extracted out of SEVEN byte-identical reader bodies + THREE near-identical writer
// bodies.
//
// This file is the module's DIRECT unit test. The refactored call sites keep their own tests
// (task-ac-carryover-check / task-contract-check / bare-dir-touches-check /
// touches-one-entry-one-path-check / threshold-scope-check), which is what proves the extraction
// changed no observable behaviour; this file proves the mechanism itself, including the arms a
// call-site test would only reach through a whole-store fixture.
//
// Bidirectionality (硬规则 2): every refusal arm asserts BOTH that the write was refused AND that
// nothing was written to disk — the refusal reason alone is satisfiable by a function that returns
// early after writing.
//
// Run:
//   scripts/test.sh plugin/test/ratchet-baseline.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BASELINE_COUNT_RE,
  parseRatchetBaselineText,
  readRatchetBaseline,
  writeRatchetBaseline,
} from "../scripts/ratchet-baseline.ts";

// Every mkdtemp result goes into this carrier, which the single after() hook below drains —
// the tmp-leak-pairing-check / test-isolation-check R6 pairing requirement.
const tmpDirs = [];
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

function mkTmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ratchet-baseline-"));
  tmpDirs.push(dir);
  return dir;
}

/** The three per-consumer knobs, so every call site in this file differs only where a real
 *  consumer does. */
function opts(extra = {}) {
  return {
    headerLines: ["# demo-baseline.md — shrink-only", "#", "# Format: one entry per line."],
    entriesLabel: "violations",
    newEntryLabel: "violation(s)",
    overCeilingAdvice: "fix violations, do not add them",
    ...extra,
  };
}

const REL = "docs/analysis/demo-baseline.md";

// ── the pure text half ──────────────────────────────────────────────────────────────────────────

test("parseRatchetBaselineText: comments/blanks dropped, entries trimmed, ceiling read", () => {
  const { baseline, baselineCount } = parseRatchetBaselineText(
    "# demo — a header\n#\n# baseline-count: 3\n\n  tasks/a.md: V1  \ntasks/b.md: V2\n",
  );
  assert.equal(baselineCount, 3);
  assert.deepEqual([...baseline], ["tasks/a.md: V1", "tasks/b.md: V2"]);
});

test("parseRatchetBaselineText: absent ceiling token ⇒ null (no ceiling enforced), NOT 0", () => {
  // 硬规则 3b: "no ceiling recorded" must not be spelled the same way as "ceiling is zero".
  const { baseline, baselineCount } = parseRatchetBaselineText("# demo\n\ntasks/a.md: V1\n");
  assert.equal(baselineCount, null);
  assert.deepEqual([...baseline], ["tasks/a.md: V1"]);
});

test("parseRatchetBaselineText: a '#' INSIDE an entry is not a comment (only a line-initial one is)", () => {
  const { baseline } = parseRatchetBaselineText("# hash-in-entry\ntasks/a.md: V#1\n");
  assert.deepEqual([...baseline], ["tasks/a.md: V#1"]);
});

test("BASELINE_COUNT_RE is unanchored at the end — the regex the seven extracted readers used", () => {
  // Pinning the exact token shape the extraction had to preserve: a trailing annotation after the
  // number still yields the number (an end-anchored regex would silently read null here).
  assert.equal("# baseline-count: 12  (re-anchored 2026-09-29)".match(BASELINE_COUNT_RE)[1], "12");
});

// ── the reader ──────────────────────────────────────────────────────────────────────────────────

test("readRatchetBaseline: absent file ⇒ empty set + null count (the shrink-only floor)", () => {
  const root = mkTmp();
  const { baseline, baselineCount } = readRatchetBaseline(root, REL);
  assert.equal(baseline.size, 0);
  assert.equal(baselineCount, null);
});

test("readRatchetBaseline: present file round-trips what parseRatchetBaselineText reads", () => {
  const root = mkTmp();
  fs.mkdirSync(path.join(root, "docs/analysis"), { recursive: true });
  fs.writeFileSync(path.join(root, REL), "# baseline-count: 1\n\ntasks/a.md: V1\n");
  const { baseline, baselineCount } = readRatchetBaseline(root, REL);
  assert.equal(baselineCount, 1);
  assert.deepEqual([...baseline], ["tasks/a.md: V1"]);
});

// ── the writer ──────────────────────────────────────────────────────────────────────────────────

test("writeRatchetBaseline: writes headerLines + ceiling + entries, and creates the dir", () => {
  const root = mkTmp();
  const r = writeRatchetBaseline(root, REL, ["tasks/a.md: V1", "tasks/b.md: V2"], opts());
  assert.equal(r.ok, true, r.reason);
  const text = fs.readFileSync(path.join(root, REL), "utf8");
  assert.match(text, /^# demo-baseline\.md — shrink-only\n#\n# Format: one entry per line\.\n# baseline-count: 2\n\ntasks\/a\.md: V1\ntasks\/b\.md: V2\n$/);
  assert.match(r.reason, /ratchet list written \(2 entry\/entries; ceiling 2\)/);
});

test("writeRatchetBaseline: an over-ceiling write is REFUSED and writes NOTHING", () => {
  const root = mkTmp();
  writeRatchetBaseline(root, REL, [], opts());
  const before = fs.readFileSync(path.join(root, REL), "utf8");
  const r = writeRatchetBaseline(root, REL, ["tasks/new.md: V9"], opts());
  assert.equal(r.ok, false);
  assert.match(r.reason, /current violations \(1\) exceed the ratchet ceiling \(0\)/);
  assert.equal(fs.readFileSync(path.join(root, REL), "utf8"), before, "a refused write must not touch the file");
});

test("writeRatchetBaseline: a NEW entry under the ceiling is still REFUSED (the real shrink-only arm)", () => {
  // The ceiling alone is not the ratchet: the same COUNT with a different MEMBER must still be
  // refused, which is the arm a count-only guard would let through.
  const root = mkTmp();
  writeRatchetBaseline(root, REL, ["tasks/a.md: V1"], opts());
  const r = writeRatchetBaseline(root, REL, ["tasks/b.md: V2"], opts());
  assert.equal(r.ok, false);
  assert.match(r.reason, /refusing to write: 1 NEW violation\(s\) not in the baseline/);
  assert.match(fs.readFileSync(path.join(root, REL), "utf8"), /tasks\/a\.md: V1/, "the old list survives a refused write");
});

test("writeRatchetBaseline: re-writing the SAME list is allowed; shrinking is allowed", () => {
  const root = mkTmp();
  writeRatchetBaseline(root, REL, ["tasks/a.md: V1", "tasks/b.md: V2"], opts());
  const same = writeRatchetBaseline(root, REL, ["tasks/a.md: V1", "tasks/b.md: V2"], opts());
  assert.equal(same.ok, true, same.reason);
  const shrunk = writeRatchetBaseline(root, REL, ["tasks/a.md: V1"], opts());
  assert.equal(shrunk.ok, true, shrunk.reason);
  assert.match(fs.readFileSync(path.join(root, REL), "utf8"), /# baseline-count: 2\n\ntasks\/a\.md: V1\n$/);
});

test("writeRatchetBaseline --reset: re-anchors the ceiling to the current set, once", () => {
  const root = mkTmp();
  writeRatchetBaseline(root, REL, ["tasks/a.md: V1"], opts());
  assert.equal(writeRatchetBaseline(root, REL, ["tasks/a.md: V1", "tasks/b.md: V2"], opts()).ok, false);
  const reset = writeRatchetBaseline(root, REL, ["tasks/a.md: V1", "tasks/b.md: V2"], opts({ reset: true }));
  assert.equal(reset.ok, true, reset.reason);
  assert.match(reset.reason, /RESET to 2 entry\/entries \(ceiling re-anchored to 2\)/);
  assert.match(fs.readFileSync(path.join(root, REL), "utf8"), /# baseline-count: 2\n\ntasks\/a\.md: V1\ntasks\/b\.md: V2\n$/);
  // The guard is back on immediately afterwards.
  assert.equal(writeRatchetBaseline(root, REL, ["tasks/c.md: V3"], opts()).ok, false);
});

// ── the per-consumer knobs really are per-consumer (the divergence this extraction PRESERVED) ────

test("the refusal nouns come from the caller — two consumers of ONE mechanism word it differently", () => {
  const root = mkTmp();
  const acOpts = {
    entriesLabel: "unowned ACs",
    newEntryLabel: "unowned AC(s)",
    overCeilingAdvice: "give the ACs a carrying successor, do not add them",
  };
  const ac = writeRatchetBaseline(root, REL, ["tasks/x.md: AC1"], opts(acOpts));
  assert.equal(ac.ok, true, ac.reason);

  // Over-ceiling arm: BOTH the entry noun and the advice come from the caller.
  const over = writeRatchetBaseline(root, REL, ["tasks/x.md: AC1", "tasks/y.md: AC2"], opts(acOpts));
  assert.equal(over.ok, false);
  assert.match(over.reason, /current unowned ACs \(2\) exceed the ratchet ceiling \(1\)/);
  assert.match(over.reason, /give the ACs a carrying successor, do not add them/);

  // New-entry arm: a DIFFERENT noun than the violation consumers use.
  const refused = writeRatchetBaseline(root, REL, ["tasks/y.md: AC2"], opts(acOpts));
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /NEW unowned AC\(s\)/);
  assert.doesNotMatch(refused.reason, /violation/, "the AC consumer must not inherit the violation wording");
});
