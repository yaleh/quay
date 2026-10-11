// @test-group engine
// Fixture tests for the architecture-discovery TIME instrument's grouping and association rules
// (docs/analysis/arch-discovery-time.mjs). Pure functions only — no git, no journalctl, no repo.
//
// Fixture families (Plan step 4):
//   1. signature split vs file-only merge (identity/grouping).
//   2. a green-suite control that REFUTES an association (B4).
//   3. the B1 prediction refuted when one post-change red is injected.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  groupKey, groupsOf, recurrentWindows, recurrentGroups, b1Verdict, b2Verdict, b4Verdict, b5Verdict,
  enrichment, W48, GROUP_KEY_BY,
  scanWindow, runTimeScan, cli, B1_SCAN_VERDICT, B1_NOT_APPLICABLE_REASON, defaultOut,
} from "../../docs/analysis/arch-discovery-time.mjs";
import { carrierEvidence, BOUND_EXIT_CODES } from "../../docs/analysis/arch-discovery-space.mjs";
import { validateRecord } from "../../docs/analysis/architecture-evidence-store.mjs";

const T0 = Date.parse("2026-01-01T00:00:00Z");
const ev = (file, sigKey, ts, task) => ({ file, sigKey, ts, task, sigs: sigKey === "nosig" ? [] : [sigKey], line: 1 });

// ── family 1: identity — signature split vs file-only merge ─────────────────────────────────────────
test("grouping key: file+signature keeps two signatures on ONE file apart; file-only merges them", () => {
  const events = [ev("plugin/test/a.test.mjs", "sig1", T0, "t1"), ev("plugin/test/a.test.mjs", "sig2", T0 + 3600e3, "t2")];
  assert.equal(groupsOf(events, { keyBy: "file+signature" }).length, 2);
  assert.equal(groupsOf(events, { keyBy: "file-only" }).length, 1);
  assert.notEqual(groupKey(events[0], "file+signature"), groupKey(events[1], "file+signature"));
  assert.equal(groupKey(events[0], "file-only"), groupKey(events[1], "file-only"));
});

test("B2: a real split reports `split`; the file-only mutation reports `merged(refuted)`", () => {
  const events = [ev("plugin/test/task-granularity-advice.test.mjs", "nosig", T0, "t1"), ev("plugin/test/task-granularity-advice.test.mjs", "311a83b0ca46", T0 + 3 * 86400e3, "t2")];
  assert.equal(b2Verdict(groupsOf(events, { keyBy: "file+signature" })), "split");
  assert.equal(b2Verdict(groupsOf(events, { keyBy: "file-only" })), "merged(refuted)");
  assert.equal(GROUP_KEY_BY, "file+signature", "the shipped default key is file+signature");
});

test("recurrence: distinct tasks inside one 48h window; a signature-less event never merges with a signed one", () => {
  const three = [ev("f", "s", T0, "a"), ev("f", "s", T0 + 3600e3, "b"), ev("f", "s", T0 + 2 * 3600e3, "c")];
  assert.equal(recurrentWindows(three), 3);
  assert.equal(recurrentWindows([ev("f", "s", T0, "a"), ev("f", "s", T0 + 2 * W48, "b")]), 1);   // outside the window
  assert.equal(recurrentGroups(groupsOf([ev("f", "nosig", T0, "a"), ev("f", "sig", T0 + 1000, "b")])).length, 0);
});

// ── family 3: B1 — the prediction is refuted by a single injected post-change red ───────────────────
test("B1: recurrent-before + a located change predicts 0 reds after it", () => {
  assert.equal(b1Verdict({ recurrentPre: true, change: { commit: "6cc0ee3919" }, observedAfter: 0 }), "prediction-held");
});

test("B1: ONE post-change red refutes the prediction", () => {
  assert.equal(b1Verdict({ recurrentPre: true, change: { commit: "6cc0ee3919" }, observedAfter: 1 }), "refuted");
});

test("B1: no located change (or no pre-cut recurrence) is not-evaluated — never a silent 'held'", () => {
  assert.equal(b1Verdict({ recurrentPre: true, change: null, observedAfter: null }), "not-evaluated");
  assert.equal(b1Verdict({ recurrentPre: false, change: { commit: "x" }, observedAfter: 0 }), "not-evaluated");
});

// ── family 2: the green control refutes the OOM↔red association ─────────────────────────────────────
const WIN = 30 * 60e3;
const loom = (shiftH) => T0 + shiftH * 3600e3 + 10 * 60e3;   // a target that lands in the +shiftH window only

test("enrichment: a trigger-window target counts; the ±6h/±12h shifts are the control", () => {
  const enr = enrichment({ targets: [{ ts: T0 + 60e3 }, { ts: loom(6) }], triggers: [{ ts: T0 }], winMs: WIN, lo: 0 });
  assert.equal(enr.real, 1);
  assert.deepEqual(enr.shifted_controls, [0, 0, 1, 0]);
  assert.equal(enr.control_mean, 0.25);
  assert.equal(enr.enrichment, 4);
});

test("B4: reds enriched 4× AND greens enriched the same ⇒ the red-specific association is REFUTED", () => {
  const redEnr = enrichment({ targets: [{ ts: T0 + 60e3 }, { ts: loom(6) }], triggers: [{ ts: T0 }], winMs: WIN, lo: 0 });
  const greenEnr = enrichment({ targets: [{ ts: T0 + 60e3 }, { ts: loom(6) }], triggers: [{ ts: T0 }], winMs: WIN, lo: 0 });
  const v = b4Verdict({ enrichment: redEnr, greenControl: greenEnr });
  assert.equal(v.enrichment_verdict, "OOM-associated");                       // the naive reading alone would say this
  assert.equal(v.red_over_green, 1);
  assert.equal(v.verdict, "not-red-specific (suite-running confound)");       // the control refutes it
});

test("B5: orphan finalisations enriched ≥2× after a worker-loop start ⇒ restart-induced burst", () => {
  const enr = enrichment({ targets: [{ ts: T0 + 60e3 }, { ts: loom(6) }], triggers: [{ ts: T0 }], winMs: 15 * 60e3, lo: 0 });
  assert.equal(b5Verdict(enr), "restart-induced-burst");
  assert.equal(b5Verdict(enrichment({ targets: [{ ts: T0 + 60e3 }], triggers: [{ ts: T0 }], winMs: 15 * 60e3, lo: 0 })), "restart-induced-burst");
});

// ── records validate against the PRODUCTION store ───────────────────────────────────────────────────
test("the time instrument's carrier-form evidence validates against the store", () => {
  const lineText = `{"ts":"2026-10-03T11:42:12.901Z","task":"gap-x","mechanical_fan_in":{"step":"suite","outcome":"red"}}`;
  const rec = carrierEvidence("worker-outcome suite-red grouping", ".quay/worker-outcome.jsonl", 2677, lineText, { scope: "plugin/test/a.test.mjs", flags: ["47c794ad30a1"] });
  assert.deepEqual(validateRecord("evidence", rec), { ok: true, reasons: [] });
});

// ── the scan window: `--since` is REQUIRED, `--until` is the freezing knob ──────────────────────────
test("scanWindow refuses a missing/unparsable --since and an inverted window (never a silent default)", () => {
  assert.throws(() => scanWindow({ since: null }), /--scan requires --since/);
  assert.throws(() => scanWindow({ since: "not-a-date" }), /not a parsable date/);
  assert.throws(() => scanWindow({ since: "2026-01-02T00:00:00Z", until: "2026-01-01T00:00:00Z" }), /precedes/);
  const w = scanWindow({ since: "2026-01-01T00:00:00Z", until: "2026-01-02T00:00:00Z" });
  assert.equal(w.contains(Date.parse("2026-01-01T12:00:00Z")), true);
  assert.equal(w.contains(Date.parse("2026-01-03T00:00:00Z")), false);
  assert.equal(w.contains(Date.parse("2025-12-31T23:59:59Z")), false);
  // an OPEN until means "no upper bound installed", not a large literal (硬规则 4 推论二).
  const open = scanWindow({ since: "2026-01-01T00:00:00Z" });
  assert.equal(open.until, null);
  assert.equal(open.contains(Date.now()), true);
});

// ── scan mode on a FIXTURE workspace: (a) determinism, (b) bounds, (c) --since required, (d) B1 ─────
const WINDOW = { since: "2026-01-01T00:00:00Z", until: "2026-01-02T00:00:00Z" };
const WINDOW_ARGS = ["--since", WINDOW.since, "--until", WINDOW.until];
const redRow = ({ ts, task, file, sig }) => JSON.stringify({
  ts, task, started_at: ts, ended_at: ts,
  mechanical_fan_in: { step: "suite", outcome: "red", failedTestFiles: { evaluated: true, files: [file] }, suiteSignatures: [sig] },
});
const landedRow = ({ ts, task }) => JSON.stringify({ ts, task, started_at: ts, ended_at: ts, mechanical_fan_in: { step: "suite", outcome: "landed" } });

/** A window-contained workspace: two (file, signature) groups inside `[since, until]`, one outside it. */
function makeTimeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-time-fixture-"));
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  const rows = [
    redRow({ ts: "2026-01-01T10:00:00Z", task: "t1", file: "plugin/test/a.test.mjs", sig: "sigA" }),
    redRow({ ts: "2026-01-01T11:00:00Z", task: "t2", file: "plugin/test/a.test.mjs", sig: "sigA" }),
    redRow({ ts: "2026-01-01T12:00:00Z", task: "t3", file: "plugin/test/b.test.mjs", sig: "sigB" }),
    redRow({ ts: "2026-03-01T12:00:00Z", task: "t9", file: "plugin/test/outside.test.mjs", sig: "sigZ" }),   // OUT of window
    landedRow({ ts: "2026-01-01T09:00:00Z", task: "t0" }),
  ];
  fs.writeFileSync(path.join(dir, ".quay/worker-outcome.jsonl"), rows.join("\n") + "\n");
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const scanOpts = (dir) => ({ root: dir, ...WINDOW, file: "plugin/test/a.test.mjs", b2File: "plugin/test/a.test.mjs" });
const fpsOf = (out) => out.sink.rows.filter((r) => r.finding_fp).map((r) => r.finding_fp).sort();

test("(a) two --scan runs on the same fixture give identical finding_fp sets", () => {
  const fx = makeTimeFixture();
  try {
    const a = runTimeScan(scanOpts(fx.dir));
    const b = runTimeScan(scanOpts(fx.dir));
    assert.equal(a.grouping.groups, 2, "only the two in-window (file, signature) groups are scored");
    assert.ok(fpsOf(a).length > 0, "the fixture must yield at least one fingerprinted finding");
    assert.deepEqual(fpsOf(a), fpsOf(b));
    assert.equal(a.validator.refused, 0, `every emitted record must validate: ${JSON.stringify(a.validator.reasons)}`);
    assert.equal(a.capture.orphan_finalisations, 0);
  } finally { fx.cleanup(); }
});

test("(b) each bound exits with its own code and leaves the out file byte-identical", () => {
  const fx = makeTimeFixture();
  const out = path.join(fx.dir, "out.jsonl");
  const SENTINEL = "PRE-EXISTING OUTPUT\n";
  try {
    for (const [bound, value, code] of [["--max-ms", "0", 4], ["--max-records", "1", 5], ["--max-groups", "1", 6]]) {
      fs.writeFileSync(out, SENTINEL);
      const got = cli(["--scan", ...WINDOW_ARGS, "--root", fx.dir, "--out", out, bound, value]);
      assert.equal(got, code, `${bound} ${value} must exit ${code}`);
      assert.equal(fs.readFileSync(out, "utf8"), SENTINEL, `${bound} ${value} must write NOTHING`);
    }
    assert.equal(BOUND_EXIT_CODES["max-groups"], 6);
  } finally { fx.cleanup(); }
});

test("(c) time --scan without --since is refused (exit 2) and writes nothing", () => {
  const fx = makeTimeFixture();
  const out = path.join(fx.dir, "out.jsonl");
  const SENTINEL = "PRE-EXISTING OUTPUT\n";
  try {
    fs.writeFileSync(out, SENTINEL);
    assert.equal(cli(["--scan", "--root", fx.dir, "--out", out]), 2);
    assert.equal(fs.readFileSync(out, "utf8"), SENTINEL);
    assert.equal(fs.existsSync(path.join(fx.dir, ".quay/arch-discovery-shadow")), false, "no default out dir was created");
  } finally { fx.cleanup(); }
});

test("(d) B1 reports not-applicable in scan mode — with its reason, never as a silent pass", () => {
  const fx = makeTimeFixture();
  try {
    const out = runTimeScan(scanOpts(fx.dir));
    assert.equal(out.B1.verdict, B1_SCAN_VERDICT);
    assert.equal(out.B1.verdict, "not-applicable");
    assert.equal(out.B1.reason, B1_NOT_APPLICABLE_REASON);
    assert.match(out.B1.reason, /no cut/);
    // the record it emits must say not-evaluated in the store's own vocabulary — NOT "supported".
    const outcome = out.sink.rows.find((r) => r.kind === "outcome" && String(r.rule_verdict).startsWith("B1:"));
    assert.equal(outcome.rule_verdict, "B1:not-applicable");
    assert.equal(outcome.verdict, "not-evaluated");
  } finally { fx.cleanup(); }
});

test("the default --out path is the one the repo's .gitignore covers", () => {
  assert.equal(defaultOut("/x"), "/x/.quay/arch-discovery-shadow/time-records.jsonl");
});
