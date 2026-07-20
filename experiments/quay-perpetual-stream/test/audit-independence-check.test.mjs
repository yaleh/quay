// Unit tests for audit-independence-check.mjs — the single-source DIR-032 audit-independence rule.
// Written RED-first (ADR-001 / DIR-019 discipline): the fix for any failing case belongs in the
// MODULE, never in the fixtures.
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
  main,
} from "../scripts/audit-independence-check.mjs";

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
test("evaluateIndependence: artifact id DISTINCT from orchestrator id → PASS", () => {
  const r = evaluateIndependence("audit-id-abc", "orchestrator-id-xyz");
  assert.equal(r.verdict, "PASS");
  assert.match(r.reason, /genuinely independent/);
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
test("checkArtifact: genuinely independent artifact (distinct id) → PASS", () => {
  const r = checkArtifact(read("genuinely-independent.md"), "orchestrator-session-abc123");
  assert.equal(r.verdict, "PASS");
  assert.equal(r.artifactId, "explore-subagent-9f3e7a21-distinct");
});
test("checkArtifact: genuinely independent artifact but NO orchestrator id supplied → FAIL", () => {
  const r = checkArtifact(read("genuinely-independent.md"), undefined);
  assert.equal(r.verdict, "FAIL");
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
  const code = await main(["node", "audit-independence-check.mjs"]);
  assert.equal(code, 2);
});

test("main: unreadable file → exit 2", async () => {
  const code = await main(["node", "audit-independence-check.mjs", "/nonexistent/path/does-not-exist.md"]);
  assert.equal(code, 2);
});

test("main: real absent-id fixture, --orchestrator-id flag → exit 1 (FAIL)", async () => {
  const file = path.join(FIX, "absent-id-m43-style.md");
  const code = await main(["node", "audit-independence-check.mjs", "--orchestrator-id", "orch-x", file]);
  assert.equal(code, 1);
});

test("main: real independent fixture, orchestrator id via env var → exit 0 (PASS)", async () => {
  const file = path.join(FIX, "genuinely-independent.md");
  const prev = process.env.QUAY_ORCHESTRATOR_SESSION_ID;
  process.env.QUAY_ORCHESTRATOR_SESSION_ID = "orchestrator-session-abc123";
  try {
    const code = await main(["node", "audit-independence-check.mjs", file]);
    assert.equal(code, 0);
  } finally {
    if (prev === undefined) delete process.env.QUAY_ORCHESTRATOR_SESSION_ID;
    else process.env.QUAY_ORCHESTRATOR_SESSION_ID = prev;
  }
});
