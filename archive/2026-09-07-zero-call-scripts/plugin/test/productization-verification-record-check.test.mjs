// @test-group engine
// productization-verification-record-check.test.mjs — AC89 判据 fixture for the productization
// verification record mechanism (plugin/scripts/productization-verification-record.ts writer +
// productization-verification-record-check.ts checker). Proves the checker can go RED on a malformed
// record (判据1, 硬规则 3b), RED on a missing per-AC coverage record (判据2 — AC2/AC3/AC4), GREEN when
// all required records are well-formed (including AC88 for BOTH hosts B and C), and NOT-EVALUATED
// (never conflated with green) when there is nothing to judge. Also exercises the writer's append +
// fail-closed + per-AC required fields + shared-checkout resolution.
//
//   RED   validateRecord — an unparseable line / missing base field / AC88 without host or steps
//   RED   checkCoverage  — AC85/AC86 record missing, or AC88 recorded for only one host
//   GREEN checkRecordFile — all records well-formed; checkCoverage — all per-AC records present
//   NOT-EVALUATED checkRecordFile/checkCoverage — empty record set (nothing recorded yet)
//   writer — appends one JSON line; per-AC required fields; fail-closed on a missing field
//   roundtrip — records written by the writer are judged GREEN by the checker
//
// Run:
//   scripts/test.sh plugin/test/productization-verification-record-check.test.mjs
//   node --test plugin/test/productization-verification-record-check.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  validateRecord,
  checkRecordFile,
  checkCoverage,
  REQUIRED_FIELDS,
} from "../scripts/productization-verification-record-check.ts";
import {
  buildRecord,
  KNOWN_ACS,
} from "../scripts/productization-verification-record.ts";
import { resolveSharedCheckout } from "../scripts/per-task-suite-record.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WRITER = path.join(REPO_ROOT, "plugin", "scripts", "productization-verification-record.ts");
const CHECKER = path.join(REPO_ROOT, "plugin", "scripts", "productization-verification-record-check.ts");

// Track created temp dirs so the isolation check's mkdtemp-no-cleanup ratchet stays flat — every
// mkdtempSync has a matching rmSync (try/finally in each test + the after() sweep below).
const _tmpDirs = [];
function tmpFile(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  _tmpDirs.push(dir);
  return path.join(dir, "records.jsonl");
}
function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  _tmpDirs.push(dir);
  return dir;
}
after(() => {
  for (const d of _tmpDirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch (_) {
      /* best-effort cleanup */
    }
  }
});

// ── well-formed record fixtures (判据1 shape + per-AC required fields) ────────────────────────────────
const AC85_BASE = {
  ac: "AC85",
  ok: true,
  artifact: "quay-0.4.0.tgz",
  evidence: "/path/to/tar-verify.txt",
  detail: "version=0.4.0 plugin_entries=321",
  version: "0.4.0",
};
const AC86_BASE = {
  ac: "AC86",
  ok: true,
  artifact: "quay-0.4.0.tgz (npm-pack)",
  evidence: "https://github.com/yaleh/quay/actions/runs/31925993366",
  detail: "node=v20.20.2 version=0.4.0",
  runId: "31925993366",
};
const AC88_BASE = {
  ac: "AC88",
  ok: false,
  artifact: "quay-0.4.0.tgz",
  evidence: "/path/to/verify-deliver-evidence.json",
  detail: "steps install=1 init=1 coldstart=0",
  host: "B",
  stepInstall: true,
  stepInit: true,
  stepColdstart: false,
};

function withTs(o) {
  return { ts: "2026-08-16T10:00:00.000Z", ...o };
}

// ── 判据1: record shape (硬规则 3b — 读不懂 ≠ 合格) ──────────────────────────────────────────────────

test("判据1 — a well-formed AC85/AC86/AC88 record is GREEN", () => {
  assert.equal(validateRecord(withTs(AC85_BASE)).ok, true);
  assert.equal(validateRecord(withTs(AC86_BASE)).ok, true);
  assert.equal(validateRecord(withTs(AC88_BASE)).ok, true);
  assert.equal(validateRecord(withTs({ ...AC88_BASE, host: "C", ok: true, stepColdstart: true })).ok, true);
});

test("判据1 — a record missing a REQUIRED base field ⇒ RED (a partial record is not a recording)", () => {
  const { artifact, ...partial } = withTs(AC85_BASE);
  const v = validateRecord(partial);
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  assert.ok(v.missingFields.includes("artifact"));
});

test("判据1 — an unparseable line (null) ⇒ RED", () => {
  const v = validateRecord(null);
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  assert.match(v.reason, /unparseable/);
});

test("判据1 — a non-boolean ok ⇒ RED (ok must be a real boolean, not a string)", () => {
  const v = validateRecord(withTs({ ...AC85_BASE, ok: "true" }));
  assert.equal(v.ok, false);
  assert.ok(v.missingFields.includes("ok∈boolean"));
});

test("判据1 — an unrecognized ac ⇒ RED (ac∈{AC85|AC86|AC88})", () => {
  const v = validateRecord(withTs({ ...AC85_BASE, ac: "AC99" }));
  assert.equal(v.ok, false);
  assert.ok(v.missingFields.includes("ac∈{AC85|AC86|AC88}"));
});

test("判据1 — an invalid ts ⇒ RED (ts must be ISO-parseable)", () => {
  const v = validateRecord({ ...withTs(AC85_BASE), ts: "not-a-time" });
  assert.equal(v.ok, false);
  assert.ok(v.missingFields.includes("ts∈ISO"));
});

test("判据1 — an AC85 record without version ⇒ RED (per-AC required field)", () => {
  const { version, ...noVer } = AC85_BASE;
  const v = validateRecord(withTs(noVer));
  assert.equal(v.ok, false);
  assert.ok(v.missingFields.includes("version"));
});

test("判据1 — an AC86 record without runId ⇒ RED (per-AC required field)", () => {
  const { runId, ...noRun } = AC86_BASE;
  const v = validateRecord(withTs(noRun));
  assert.equal(v.ok, false);
  assert.ok(v.missingFields.includes("runId"));
});

test("判据1 — an AC88 record without host or steps ⇒ RED (per-AC required fields)", () => {
  const { host, ...noHost } = AC88_BASE;
  const v1 = validateRecord(withTs(noHost));
  assert.equal(v1.ok, false);
  assert.ok(v1.missingFields.includes("host"));
  const { stepInstall, ...noStep } = AC88_BASE;
  const v2 = validateRecord(withTs(noStep));
  assert.equal(v2.ok, false);
  assert.ok(v2.missingFields.includes("stepInstall"));
});

test("判据1 — an AC88 record with a non-boolean step ⇒ RED (steps must be real booleans)", () => {
  const v = validateRecord(withTs({ ...AC88_BASE, stepInstall: "yes" }));
  assert.equal(v.ok, false);
  assert.ok(v.missingFields.includes("stepInstall∈boolean"));
});

test("判据1 — an empty record file ⇒ NOT-EVALUATED (nothing recorded yet)", () => {
  const v = checkRecordFile([]);
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, false);
  assert.match(v.reason, /NOT-EVALUATED/);
});

test("判据1 — an absent file (null) is NOT-EVALUATED, not a crash", () => {
  const v = checkRecordFile(null);
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, false);
});

test("判据1 — a file with any malformed record ⇒ RED", () => {
  const v = checkRecordFile([withTs(AC85_BASE), null]);
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  assert.match(v.reason, /malformed-record-file/);
});

test("判据1 — a file of well-formed records ⇒ GREEN", () => {
  const v = checkRecordFile([withTs(AC85_BASE), withTs(AC86_BASE), withTs(AC88_BASE)]);
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, true);
});

// ── 判据2: per-AC coverage (AC2/AC3/AC4) ─────────────────────────────────────────────────────────────

test("判据2 — no records at all ⇒ NOT-EVALUATED (nothing to judge, never conflated with green)", () => {
  const v = checkCoverage([]);
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, false);
  assert.match(v.reason, /NOT-EVALUATED/);
});

test("判据2 — only AC85 recorded ⇒ RED (AC86 + AC88 hosts B/C missing)", () => {
  const v = checkCoverage([withTs(AC85_BASE)]);
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  const miss = v.missing.join(" ");
  assert.match(miss, /AC86/);
  assert.match(miss, /AC88 host=B/);
  assert.match(miss, /AC88 host=C/);
});

test("判据2 — AC85 + AC86 recorded but AC88 only for host B ⇒ RED (host C missing — AC4 B/C 两机)", () => {
  const records = [withTs(AC85_BASE), withTs(AC86_BASE), withTs(AC88_BASE)];
  const v = checkCoverage(records);
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  assert.match(v.missing.join(" "), /AC88 host=C/);
});

test("判据2 — AC88 host=C record with ok:true is NOT a shape violation (a passed verification is still a recorded outcome)", () => {
  const records = [
    withTs(AC85_BASE),
    withTs(AC86_BASE),
    withTs(AC88_BASE),
    withTs({ ...AC88_BASE, host: "C", ok: true, stepColdstart: true }),
  ];
  const v = checkCoverage(records);
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, true);
  assert.equal(v.missing.length, 0);
});

test("判据2 — a MALFORMED AC85 record does not satisfy AC85 coverage (shape-valid records only)", () => {
  const { version, ...badAc85 } = AC85_BASE;
  const v = checkCoverage([withTs(badAc85), withTs(AC86_BASE), withTs(AC88_BASE), withTs({ ...AC88_BASE, host: "C" })]);
  assert.equal(v.ok, false);
  assert.match(v.missing.join(" "), /AC85/);
});

test("判据2 — all per-AC records present and well-formed (AC85 + AC86 + AC88 for BOTH B and C) ⇒ GREEN", () => {
  const records = [
    withTs(AC85_BASE),
    withTs(AC86_BASE),
    withTs(AC88_BASE),
    withTs({ ...AC88_BASE, host: "C", ok: true, stepColdstart: true }),
  ];
  const v = checkCoverage(records);
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, true);
  assert.equal(v.missing.length, 0);
});

// ── writer: append + per-AC required fields + fail-closed ───────────────────────────────────────────

test("writer — appends ONE valid JSON line; second append adds a second line", () => {
  const file = tmpFile("pvr-append-");
  const args = [
    "--ac", "AC85", "--ok", "true",
    "--artifact", "quay-0.4.0.tgz",
    "--evidence", "/path/to/tar-verify.txt",
    "--detail", "version=0.4.0 plugin_entries=321",
    "--version", "0.4.0",
    "--record-file", file,
  ];
  const r1 = spawnSync("node", ["--experimental-strip-types", WRITER, ...args], { encoding: "utf8" });
  assert.equal(r1.status, 0, r1.stderr);
  const lines1 = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
  assert.equal(lines1.length, 1, "one line appended");
  const rec = JSON.parse(lines1[0]);
  assert.equal(rec.ac, "AC85");
  assert.equal(rec.ok, true);
  assert.equal(rec.version, "0.4.0");
  assert.ok(Number.isFinite(Date.parse(rec.ts)), "ts is an ISO timestamp");
  assert.deepEqual(KNOWN_ACS.includes(rec.ac), true);

  const r2 = spawnSync("node", ["--experimental-strip-types", WRITER, ...args], { encoding: "utf8" });
  assert.equal(r2.status, 0, r2.stderr);
  const lines2 = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
  assert.equal(lines2.length, 2, "append-only — second run adds a second line");
});

test("writer — fail-closed on a missing required field (exit 2, nothing written)", () => {
  const file = tmpFile("pvr-fail-");
  const r = spawnSync("node", ["--experimental-strip-types", WRITER,
    "--ac", "AC85", "--ok", "true",
    "--evidence", "x", "--detail", "y",
    "--record-file", file,
  ], { encoding: "utf8" });
  assert.equal(r.status, 2, `must fail-closed on missing --artifact: ${r.stdout} ${r.stderr}`);
  assert.equal(fs.existsSync(file), false, "nothing written on a fail-closed field error");
});

test("writer — AC85 requires --version (fail-closed, nothing written)", () => {
  const file = tmpFile("pvr-nover-");
  const r = spawnSync("node", ["--experimental-strip-types", WRITER,
    "--ac", "AC85", "--ok", "true",
    "--artifact", "quay-0.4.0.tgz", "--evidence", "x", "--detail", "y",
    "--record-file", file,
  ], { encoding: "utf8" });
  assert.equal(r.status, 2, `AC85 without --version must fail-closed: ${r.stdout} ${r.stderr}`);
  assert.equal(fs.existsSync(file), false);
});

test("writer — AC86 requires --run-id (fail-closed, nothing written)", () => {
  const file = tmpFile("pvr-norun-");
  const r = spawnSync("node", ["--experimental-strip-types", WRITER,
    "--ac", "AC86", "--ok", "true",
    "--artifact", "quay-0.4.0.tgz", "--evidence", "x", "--detail", "y",
    "--record-file", file,
  ], { encoding: "utf8" });
  assert.equal(r.status, 2, `AC86 without --run-id must fail-closed: ${r.stdout} ${r.stderr}`);
  assert.equal(fs.existsSync(file), false);
});

test("writer — AC88 requires --host + all three steps (fail-closed when any missing)", () => {
  const base = [
    "--ac", "AC88", "--ok", "false",
    "--artifact", "quay-0.4.0.tgz", "--evidence", "x", "--detail", "y",
  ];
  const file1 = tmpFile("pvr-nohost-");
  const r1 = spawnSync("node", ["--experimental-strip-types", WRITER, ...base, "--step-install", "true", "--step-init", "true", "--step-coldstart", "false", "--record-file", file1], { encoding: "utf8" });
  assert.equal(r1.status, 2, `AC88 without --host must fail-closed: ${r1.stdout} ${r1.stderr}`);
  assert.equal(fs.existsSync(file1), false);

  const file2 = tmpFile("pvr-nostep-");
  const r2 = spawnSync("node", ["--experimental-strip-types", WRITER, ...base, "--host", "B", "--step-install", "true", "--record-file", file2], { encoding: "utf8" });
  assert.equal(r2.status, 2, `AC88 missing step-init/step-coldstart must fail-closed: ${r2.stdout} ${r2.stderr}`);
  assert.equal(fs.existsSync(file2), false);
});

test("writer — AC88 record writes host + step booleans", () => {
  const file = tmpFile("pvr-ac88-");
  const r = spawnSync("node", ["--experimental-strip-types", WRITER,
    "--ac", "AC88", "--ok", "false",
    "--artifact", "quay-0.4.0.tgz",
    "--evidence", "/path/to/verify-deliver-evidence.json",
    "--detail", "steps install=1 init=1 coldstart=0",
    "--host", "B",
    "--step-install", "true", "--step-init", "true", "--step-coldstart", "false",
    "--record-file", file,
  ], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const rec = JSON.parse(fs.readFileSync(file, "utf8").trim());
  assert.equal(rec.host, "B");
  assert.equal(rec.stepInstall, true);
  assert.equal(rec.stepInit, true);
  assert.equal(rec.stepColdstart, false);
  assert.equal(validateRecord(rec).ok, true, "a writer-written AC88 record is judged GREEN by the checker's 判据1");
});

test("writer+checker — records written by the writer (AC85+AC86+AC88 B/C) are judged GREEN by the checker", () => {
  const file = tmpFile("pvr-roundtrip-");
  const writes = [
    ["--ac", "AC85", "--ok", "true", "--artifact", "quay-0.4.0.tgz", "--evidence", "e1", "--detail", "d1", "--version", "0.4.0"],
    ["--ac", "AC86", "--ok", "true", "--artifact", "quay-0.4.0.tgz", "--evidence", "e2", "--detail", "d2", "--run-id", "31925993366"],
    ["--ac", "AC88", "--ok", "false", "--artifact", "quay-0.4.0.tgz", "--evidence", "e3", "--detail", "d3", "--host", "B", "--step-install", "true", "--step-init", "true", "--step-coldstart", "false"],
    ["--ac", "AC88", "--ok", "true", "--artifact", "quay-0.4.0.tgz", "--evidence", "e4", "--detail", "d4", "--host", "C", "--step-install", "true", "--step-init", "true", "--step-coldstart", "true"],
  ];
  for (const w of writes) {
    const r = spawnSync("node", ["--experimental-strip-types", WRITER, ...w, "--record-file", file], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  }
  const cr = spawnSync("node", ["--experimental-strip-types", CHECKER, "--record-file", file, "--json"], { encoding: "utf8" });
  assert.equal(cr.status, 0, `checker must pass on a well-formed record set: ${cr.stdout} ${cr.stderr}`);
  const out = JSON.parse(cr.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.evaluated, true);
  assert.equal(out.checks.find((c) => c.check === "record-shape").ok, true);
  assert.equal(out.checks.find((c) => c.check === "per-ac-coverage").ok, true);
});

test("checker CLI — an unparseable record line makes the checker exit 1 (RED, 硬规则 3b)", () => {
  const file = tmpFile("pvr-red-");
  fs.writeFileSync(file, "this is not json\n");
  const r = spawnSync("node", ["--experimental-strip-types", CHECKER, "--record-file", file, "--json"], { encoding: "utf8" });
  assert.equal(r.status, 1, `unparseable record ⇒ RED: ${r.stdout}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.checks.find((c) => c.check === "record-shape").ok, false);
});

test("checker CLI — an absent record file is NOT-EVALUATED (exit 0, evaluated:false — never conflated with green)", () => {
  const file = tmpFile("pvr-ne-");
  const r = spawnSync("node", ["--experimental-strip-types", CHECKER, "--record-file", file, "--json"], { encoding: "utf8" });
  assert.equal(r.status, 0, `absent record ⇒ NOT-EVALUATED: ${r.stdout}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.evaluated, false);
  assert.match(out.reason, /NOT-EVALUATED/);
});

test("checker CLI — a record set missing a required acceptance's record is RED (判据2 coverage)", () => {
  const file = tmpFile("pvr-covred-");
  // Only AC85 + AC86 (no AC88 at all).
  fs.appendFileSync(file, JSON.stringify(withTs(AC85_BASE)) + "\n");
  fs.appendFileSync(file, JSON.stringify(withTs(AC86_BASE)) + "\n");
  const r = spawnSync("node", ["--experimental-strip-types", CHECKER, "--record-file", file, "--json"], { encoding: "utf8" });
  assert.equal(r.status, 1, `missing AC88 coverage ⇒ RED: ${r.stdout}`);
  const out = JSON.parse(r.stdout);
  const cov = out.checks.find((c) => c.check === "per-ac-coverage");
  assert.equal(cov.ok, false);
  assert.match(cov.reason, /missing-coverage-record/);
});

// ── buildRecord (pure) — per-AC required fields + fail-closed ────────────────────────────────────────

test("buildRecord — a well-formed AC85/AC86/AC88 input builds the record with per-AC fields", () => {
  const b85 = buildRecord({ ac: "AC85", ok: "true", artifact: "a", evidence: "e", detail: "d", version: "0.4.0" });
  assert.equal(b85.error, undefined, b85.error);
  assert.equal(b85.record.version, "0.4.0");
  const b86 = buildRecord({ ac: "AC86", ok: "true", artifact: "a", evidence: "e", detail: "d", runId: "r1" });
  assert.equal(b86.error, undefined, b86.error);
  assert.equal(b86.record.runId, "r1");
  const b88 = buildRecord({ ac: "AC88", ok: "false", artifact: "a", evidence: "e", detail: "d", host: "C", stepInstall: "true", stepInit: "false", stepColdstart: "false" });
  assert.equal(b88.error, undefined, b88.error);
  assert.equal(b88.record.host, "C");
  assert.equal(b88.record.stepInstall, true);
});

test("buildRecord — fail-closed: unknown ac / non-boolean ok / missing artifact", () => {
  assert.match(buildRecord({ ac: "AC90", ok: "true", artifact: "a", evidence: "e", detail: "d" }).error ?? "", /--ac/);
  assert.match(buildRecord({ ac: "AC85", ok: "maybe", artifact: "a", evidence: "e", detail: "d", version: "1" }).error ?? "", /--ok/);
  assert.match(buildRecord({ ac: "AC85", ok: "true", artifact: "", evidence: "e", detail: "d", version: "1" }).error ?? "", /--artifact/);
});

test("buildRecord — fail-closed: per-AC required fields", () => {
  assert.match(buildRecord({ ac: "AC85", ok: "true", artifact: "a", evidence: "e", detail: "d" }).error ?? "", /--version/);
  assert.match(buildRecord({ ac: "AC86", ok: "true", artifact: "a", evidence: "e", detail: "d" }).error ?? "", /--run-id/);
  assert.match(buildRecord({ ac: "AC88", ok: "false", artifact: "a", evidence: "e", detail: "d" }).error ?? "", /--host/);
  assert.match(buildRecord({ ac: "AC88", ok: "false", artifact: "a", evidence: "e", detail: "d", host: "B", stepInstall: "true" }).error ?? "", /--step-init/);
});

// ── shared-checkout resolution (the record lands third-party-readable) ──────────────────────────────

test("resolveSharedCheckout — the writer's default record path lands under the SHARED checkout's .quay/", () => {
  const shared = resolveSharedCheckout(REPO_ROOT);
  assert.ok(shared, "resolved a shared checkout");
  assert.ok(fs.existsSync(path.join(shared, ".git")), "the shared checkout has a .git dir");
  assert.equal(path.join(shared, ".quay", "productization-verification.jsonl").startsWith(shared), true);
});
