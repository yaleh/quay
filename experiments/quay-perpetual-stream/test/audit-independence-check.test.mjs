// @test-group engine
// Unit tests for audit-independence-check.mjs — the single-source DIR-032 audit-independence rule
// (DIR-034 anti-forgery corroboration extension). Written RED-first (ADR-001 / DIR-019 discipline):
// the fix for any failing case belongs in the MODULE, never in the fixtures.
// Run:
//   node --test experiments/quay-perpetual-stream/test/audit-independence-check.test.mjs
//   node --test --experimental-test-coverage experiments/quay-perpetual-stream/test/audit-independence-check.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractSessionId,
  evaluateIndependence,
  checkArtifact,
  parseDispatchRecord,
  isCorroborated,
  main,
} from "../scripts/audit-independence-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, "..", "fixtures", "audit-independence");
const read = (f) => fs.readFileSync(path.join(FIX, f), "utf8");

// ── extractSessionId ────────────────────────────────────────────────────────────────────────────
test("extractSessionId: reads a bold 'Audit session id:' line, strips markdown emphasis", () => {
  assert.equal(
    extractSessionId("**Audit session id:** explore-subagent-9f3e-distinct\n"),
    "explore-subagent-9f3e-distinct"
  );
});
test("extractSessionId: reads a plain (non-bold) 'Audit session id:' line, case-insensitive", () => {
  assert.equal(extractSessionId("audit session ID: foo-bar-123\n"), "foo-bar-123");
});
test("extractSessionId: absent line → null (never coerced to empty string)", () => {
  assert.equal(extractSessionId("## ABSORB m43\nsome text with no id line at all\n"), null);
});
test("extractSessionId: line present but value empty/whitespace-only → null", () => {
  assert.equal(extractSessionId("**Audit session id:**    \n"), null);
});
test("extractSessionId: non-string input → null (fail-closed on bad input)", () => {
  assert.equal(extractSessionId(null), null);
  assert.equal(extractSessionId(undefined), null);
  assert.equal(extractSessionId(42), null);
});
test("extractSessionId: only the FIRST matching line is used (multiple id lines — takes first)", () => {
  assert.equal(
    extractSessionId("**Audit session id:** first-id\nsome text\n**Audit session id:** second-id\n"),
    "first-id"
  );
});

// ── evaluateIndependence ────────────────────────────────────────────────────────────────────────
test("evaluateIndependence: artifact id absent → FAIL", () => {
  const r = evaluateIndependence(null, "orch-1");
  assert.equal(r.verdict, "FAIL");
  assert.match(r.reason, /NO recorded session\/agent id/);
});
test("evaluateIndependence: artifact id empty string → FAIL", () => {
  const r = evaluateIndependence("", "orch-1");
  assert.equal(r.verdict, "FAIL");
});
test("evaluateIndependence: orchestrator id absent → FAIL (fail-closed, even with a real artifact id)", () => {
  const r = evaluateIndependence("some-real-id", null);
  assert.equal(r.verdict, "FAIL");
  assert.match(r.reason, /no orchestrator session\/agent id supplied/);
});
test("evaluateIndependence: orchestrator id undefined → FAIL", () => {
  const r = evaluateIndependence("some-real-id", undefined);
  assert.equal(r.verdict, "FAIL");
});
test("evaluateIndependence: artifact id EQUALS orchestrator id → FAIL (self-audit)", () => {
  const r = evaluateIndependence("same-id", "same-id");
  assert.equal(r.verdict, "FAIL");
  assert.match(r.reason, /EQUALS the orchestrator's own id/);
});
test("evaluateIndependence: artifact id DISTINCT from orchestrator id, allowUncorroborated=true → PASS (pre-DIR-034 escape hatch)", () => {
  const r = evaluateIndependence("audit-id-abc", "orchestrator-id-xyz", { allowUncorroborated: true });
  assert.equal(r.verdict, "PASS");
  assert.match(r.reason, /genuinely independent/);
  assert.match(r.reason, /UNCORROBORATED/);
});
// ── DIR-034 anti-forgery corroboration ─────────────────────────────────────────────────────────
test("evaluateIndependence: DISTINCT id but NO dispatch-record supplied at all (default) → FAIL (fail-closed, not a silent pass)", () => {
  const r = evaluateIndependence("audit-id-abc", "orchestrator-id-xyz");
  assert.equal(r.verdict, "FAIL");
  assert.match(r.reason, /NO dispatch-record was supplied/);
});
test("evaluateIndependence: DISTINCT id NOT present in supplied dispatch-record → FAIL (fabricated string)", () => {
  const r = evaluateIndependence("fabricated-id", "orch-1", { dispatchRecordIds: new Set(["real-dispatch-id-1", "real-dispatch-id-2"]) });
  assert.equal(r.verdict, "FAIL");
  assert.match(r.reason, /NOT found in the/);
  assert.match(r.reason, /FABRICATED/);
});
test("evaluateIndependence: DISTINCT id present in supplied dispatch-record → PASS (corroborated)", () => {
  const r = evaluateIndependence("real-dispatch-id-1", "orch-1", { dispatchRecordIds: new Set(["real-dispatch-id-1"]) });
  assert.equal(r.verdict, "PASS");
  assert.match(r.reason, /corroborated by the independent dispatch-record/);
});
test("evaluateIndependence: dispatchRecordIds accepts a plain Array too", () => {
  const r = evaluateIndependence("id-x", "orch-1", { dispatchRecordIds: ["id-x", "id-y"] });
  assert.equal(r.verdict, "PASS");
});

// ── parseDispatchRecord ─────────────────────────────────────────────────────────────────────────
test("parseDispatchRecord: one id per non-blank, non-comment line", () => {
  const set = parseDispatchRecord("# comment\nid-1\n\nid-2\n  \n# another comment\nid-3\n");
  assert.deepEqual([...set].sort(), ["id-1", "id-2", "id-3"]);
});
test("parseDispatchRecord: empty text → empty Set (a real empty record, not 'no record')", () => {
  const set = parseDispatchRecord("");
  assert.equal(set.size, 0);
});
test("parseDispatchRecord: non-string input → empty Set (fail-closed)", () => {
  assert.equal(parseDispatchRecord(null).size, 0);
  assert.equal(parseDispatchRecord(undefined).size, 0);
});

// ── isCorroborated ──────────────────────────────────────────────────────────────────────────────
test("isCorroborated: id present in Set → true", () => {
  assert.equal(isCorroborated("id-1", new Set(["id-1", "id-2"])), true);
});
test("isCorroborated: id absent from Set → false", () => {
  assert.equal(isCorroborated("id-3", new Set(["id-1", "id-2"])), false);
});
test("isCorroborated: id present in plain Array → true", () => {
  assert.equal(isCorroborated("id-1", ["id-1"]), true);
});
test("isCorroborated: dispatchRecordIds null/undefined → false (no record supplied)", () => {
  assert.equal(isCorroborated("id-1", null), false);
  assert.equal(isCorroborated("id-1", undefined), false);
});
test("isCorroborated: artifactId null/empty → false", () => {
  assert.equal(isCorroborated(null, new Set(["id-1"])), false);
  assert.equal(isCorroborated("", new Set(["id-1"])), false);
});

// ── checkArtifact (integration of extract + evaluate) ──────────────────────────────────────────
test("checkArtifact: real M43-style self-audit artifact (absent id) → FAIL", () => {
  const r = checkArtifact(read("absent-id-m43-style.md"), "orchestrator-session-abc123");
  assert.equal(r.verdict, "FAIL");
  assert.equal(r.artifactId, null);
});
test("checkArtifact: self-audit artifact with a MATCHING recorded id → FAIL", () => {
  const r = checkArtifact(read("self-audit-matching-id.md"), "orchestrator-session-abc123");
  assert.equal(r.verdict, "FAIL");
  assert.equal(r.artifactId, "orchestrator-session-abc123");
});
test("checkArtifact: genuinely independent artifact (distinct id), NO dispatch-record supplied → FAIL (DIR-034 default, closes the forgeable hole)", () => {
  const r = checkArtifact(read("genuinely-independent.md"), "orchestrator-session-abc123");
  assert.equal(r.verdict, "FAIL");
  assert.equal(r.artifactId, "explore-subagent-9f3e7a21-distinct");
});
test("checkArtifact: genuinely independent artifact, allowUncorroborated escape hatch → PASS (pre-DIR-034 behavior)", () => {
  const r = checkArtifact(read("genuinely-independent.md"), "orchestrator-session-abc123", { allowUncorroborated: true });
  assert.equal(r.verdict, "PASS");
});
test("checkArtifact: genuinely independent artifact but NO orchestrator id supplied → FAIL", () => {
  const r = checkArtifact(read("genuinely-independent.md"), undefined);
  assert.equal(r.verdict, "FAIL");
});
test("checkArtifact: fabricated-distinct-id fixture with a dispatch-record that does NOT contain it → FAIL", () => {
  const record = parseDispatchRecord(read("dispatch-record.txt"));
  const r = checkArtifact(read("fabricated-distinct-id-no-corroboration.md"), "orchestrator-session-abc123", { dispatchRecordIds: record });
  assert.equal(r.verdict, "FAIL");
  assert.match(r.reason, /FABRICATED/);
});
test("checkArtifact: corroborated-independent fixture WITH its paired dispatch-record → PASS", () => {
  const record = parseDispatchRecord(read("dispatch-record.txt"));
  const r = checkArtifact(read("corroborated-independent.md"), "orchestrator-session-abc123", { dispatchRecordIds: record });
  assert.equal(r.verdict, "PASS");
  assert.equal(r.artifactId, "explore-subagent-corrob-4e2b1a");
});

// ── main (CLI entry point) — exercised in-process (not a subprocess spawn) so coverage
//    instrumentation actually attributes these lines to this module, mirroring the shell-level
//    audit-independence-selfcheck.sh's own subprocess exercise of the SAME branches externally.
function captureConsole(fn) {
  const origLog = console.log, origErr = console.error;
  const lines = [], errLines = [];
  console.log = (...a) => lines.push(a.join(" "));
  console.error = (...a) => errLines.push(a.join(" "));
  try { return { result: fn(), lines, errLines }; }
  finally { console.log = origLog; console.error = origErr; }
}

test("main: usage error when file count != 1 → exit 2", async () => {
  const { result } = captureConsole(() => null);
  const code = await main(["node", "audit-independence-check.ts"]);
  assert.equal(code, 2);
});

test("main: unreadable file → exit 2", async () => {
  const code = await main(["node", "audit-independence-check.ts", "/nonexistent/path/does-not-exist.md"]);
  assert.equal(code, 2);
});

test("main: real absent-id fixture, --orchestrator-id flag → exit 1 (FAIL)", async () => {
  const file = path.join(FIX, "absent-id-m43-style.md");
  const code = await main(["node", "audit-independence-check.ts", "--orchestrator-id", "orch-x", file]);
  assert.equal(code, 1);
});

test("main: real independent fixture, orchestrator id via env var, NO dispatch-record → exit 1 (FAIL, DIR-034 default)", async () => {
  const file = path.join(FIX, "genuinely-independent.md");
  const prev = process.env.QUAY_ORCHESTRATOR_SESSION_ID;
  process.env.QUAY_ORCHESTRATOR_SESSION_ID = "orchestrator-session-abc123";
  try {
    const code = await main(["node", "audit-independence-check.ts", file]);
    assert.equal(code, 1);
  } finally {
    if (prev === undefined) delete process.env.QUAY_ORCHESTRATOR_SESSION_ID;
    else process.env.QUAY_ORCHESTRATOR_SESSION_ID = prev;
  }
});

test("main: real independent fixture, --allow-uncorroborated escape hatch → exit 0 (PASS, pre-DIR-034 behavior)", async () => {
  const file = path.join(FIX, "genuinely-independent.md");
  const code = await main(["node", "audit-independence-check.ts", "--orchestrator-id", "orchestrator-session-abc123", "--allow-uncorroborated", file]);
  assert.equal(code, 0);
});

test("main: corroborated-independent fixture + --dispatch-record pointing at the matching record → exit 0 (PASS)", async () => {
  const file = path.join(FIX, "corroborated-independent.md");
  const record = path.join(FIX, "dispatch-record.txt");
  const code = await main(["node", "audit-independence-check.ts", "--orchestrator-id", "orchestrator-session-abc123", "--dispatch-record", record, file]);
  assert.equal(code, 0);
});

test("main: fabricated-distinct-id fixture + --dispatch-record NOT containing it → exit 1 (FAIL)", async () => {
  const file = path.join(FIX, "fabricated-distinct-id-no-corroboration.md");
  const record = path.join(FIX, "dispatch-record.txt");
  const code = await main(["node", "audit-independence-check.ts", "--orchestrator-id", "orchestrator-session-abc123", "--dispatch-record", record, file]);
  assert.equal(code, 1);
});

test("main: --dispatch-record pointing at an unreadable file → exit 2 (usage/environment error)", async () => {
  const file = path.join(FIX, "genuinely-independent.md");
  const code = await main(["node", "audit-independence-check.ts", "--orchestrator-id", "orch-x", "--dispatch-record", "/nonexistent/dispatch-record.txt", file]);
  assert.equal(code, 2);
});
