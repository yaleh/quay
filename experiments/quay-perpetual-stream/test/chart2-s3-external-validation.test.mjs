// @test-group engine
// Unit tests for chart2-s3-external-validation.ts — the load-bearing cov-calculator for chart-2
// surface S3 (External-validation reach) per DIR-064-A. Closes the ADR-001 clause 2 requirement:
// a load-bearing script must have a sibling test at ≥80% coverage. The registry is the objective,
// capped denominator (DIR-062 anti-gaming guard); these tests pin the pure functions with RED+GREEN
// cases (fixture ids don't count; home is excluded; empty target fails closed) and drive the CLI as
// a real subprocess.
// Run:
//   node --test experiments/quay-perpetual-stream/test/chart2-s3-external-validation.test.mjs
//   node --test --experimental-test-coverage experiments/quay-perpetual-stream/test/chart2-s3-external-validation.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { parseRegistryWorkspaces, workspaceHasAbiTransition, computeS3Cov, selftest, } = await import("../scripts/chart2-s3-external-validation.ts");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, "..", "scripts", "chart2-s3-external-validation.ts");

// ── parseRegistryWorkspaces ─────────────────────────────────────────────────────────────────────
test("parseRegistryWorkspaces: multi-line block → all paths in order", () => {
  const yaml = [
    "authorized_root: /home/yale/work",
    "workspaces:",
    "  - path: /home/yale/work/quay              # the home repo",
    "  - path: /home/yale/work/archguard",
    "    session: archguard-5",
    "  - path: /home/yale/work/manda",
  ].join("\n");
  assert.deepEqual(parseRegistryWorkspaces(yaml), [
    "/home/yale/work/quay",
    "/home/yale/work/archguard",
    "/home/yale/work/manda",
  ]);
});

test("parseRegistryWorkspaces: ignores session/comment/other lines", () => {
  const yaml = "# comment\nscope: validation\n  - path: /a\n    session: s\n  - path: /b\n";
  assert.deepEqual(parseRegistryWorkspaces(yaml), ["/a", "/b"]);
});

test("parseRegistryWorkspaces: no path entries → empty array", () => {
  assert.deepEqual(parseRegistryWorkspaces("authorized_root: /x\nscope: validation\n"), []);
});

// ── workspaceHasAbiTransition ────────────────────────────────────────────────────────────────────
test("workspaceHasAbiTransition: pass on a real (non-fixture) item → true", () => {
  assert.equal(
    workspaceHasAbiTransition('{"item_id":"DIR-001","gate":"acceptance","verdict":"pass"}'),
    true
  );
});

test("workspaceHasAbiTransition: real item among later lines → true", () => {
  const l = '{"item_id":"X","verdict":"fail"}\n{"item_id":"TASK-24","verdict":"pass"}';
  assert.equal(workspaceHasAbiTransition(l), true);
});

test("workspaceHasAbiTransition: only fixture ids (QC-/QENG-) pass → false", () => {
  const l = '{"item_id":"QC-1","verdict":"pass"}\n{"item_id":"QENG-7","verdict":"pass"}';
  assert.equal(workspaceHasAbiTransition(l), false);
});

test("workspaceHasAbiTransition: only fail verdicts → false", () => {
  const l = '{"item_id":"DIR-001","verdict":"fail"}\n{"item_id":"DIR-002","verdict":"fail"}';
  assert.equal(workspaceHasAbiTransition(l), false);
});

test("workspaceHasAbiTransition: empty text → false", () => {
  assert.equal(workspaceHasAbiTransition(""), false);
  assert.equal(workspaceHasAbiTransition("\n  \n"), false);
});

test("workspaceHasAbiTransition: malformed JSON lines are skipped", () => {
  assert.equal(workspaceHasAbiTransition("not json\n{oops"), false);
  assert.equal(
    workspaceHasAbiTransition('garbage\n{"item_id":"REAL-1","verdict":"pass"}'),
    true
  );
});

test("workspaceHasAbiTransition: non-object / missing fields are skipped", () => {
  assert.equal(workspaceHasAbiTransition('null\n42\n"str"'), false);
  assert.equal(workspaceHasAbiTransition('{"verdict":"pass"}'), false); // no item_id
  assert.equal(workspaceHasAbiTransition('{"item_id":123,"verdict":"pass"}'), false); // non-string id
});

// ── computeS3Cov ─────────────────────────────────────────────────────────────────────────────────
test("computeS3Cov: 2 of 3 non-home workspaces have transitions → cov 0.666…, home excluded", () => {
  const ledgers = {
    "/w/home": '{"item_id":"DIR-001","verdict":"pass"}',
    "/w/a": '{"item_id":"TASK-1","verdict":"pass"}',
    "/w/b": '{"item_id":"QC-1","verdict":"pass"}', // fixture only
    "/w/c": '{"item_id":"TASK-2","verdict":"pass"}',
  };
  const res = computeS3Cov({
    registryPaths: ["/w/home", "/w/a", "/w/b", "/w/c"],
    homeRepoPath: "/w/home",
    readLedger: (p) => (p in ledgers ? ledgers[p] : null),
  });
  assert.equal(res.target, 3);
  assert.equal(res.reached, 2);
  assert.ok(Math.abs(res.cov - 2 / 3) < 1e-12);
  assert.deepEqual(res.reachedPaths, ["/w/a", "/w/c"]);
});

test("computeS3Cov: home repo is excluded from the target denominator", () => {
  // Home has a real transition but must NOT be counted (S3 = external reach).
  const res = computeS3Cov({
    registryPaths: ["/w/home", "/w/a"],
    homeRepoPath: "/w/home",
    readLedger: (p) => (p === "/w/a" ? '{"item_id":"T","verdict":"pass"}' : '{"item_id":"H","verdict":"pass"}'),
  });
  assert.equal(res.target, 1);
  assert.equal(res.reached, 1);
  assert.equal(res.cov, 1);
  assert.deepEqual(res.reachedPaths, ["/w/a"]);
});

test("computeS3Cov: missing ledger (readLedger→null) does not count", () => {
  const res = computeS3Cov({
    registryPaths: ["/w/home", "/w/a", "/w/b"],
    homeRepoPath: "/w/home",
    readLedger: (p) => (p === "/w/a" ? '{"item_id":"T","verdict":"pass"}' : null),
  });
  assert.equal(res.target, 2);
  assert.equal(res.reached, 1);
  assert.equal(res.cov, 0.5);
});

test("computeS3Cov: home path is compared after resolve (trailing slash tolerated)", () => {
  const res = computeS3Cov({
    registryPaths: ["/w/home/", "/w/a"],
    homeRepoPath: "/w/home",
    readLedger: () => '{"item_id":"T","verdict":"pass"}',
  });
  assert.equal(res.target, 1); // /w/home/ resolves to /w/home and is excluded
  assert.deepEqual(res.reachedPaths, ["/w/a"]);
});

test("computeS3Cov: empty target set (only home) → throws (fail-closed)", () => {
  assert.throws(
    () =>
      computeS3Cov({
        registryPaths: ["/w/home"],
        homeRepoPath: "/w/home",
        readLedger: () => null,
      }),
    /empty target set/
  );
});

// ── selftest() ─────────────────────────────────────────────────────────────────────────────────────
test("selftest(): embedded RED+GREEN fixture suite returns true", () => {
  assert.equal(selftest(), true);
});

// ── CLI (isDirect block) — real subprocess ─────────────────────────────────────────────────────────
function spawnCli(args) {
  try {
    const stdout = execFileSync("node", [SCRIPT, ...args], { encoding: "utf8" });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? String(err) };
  }
}

test("CLI: --selftest → exit 0", () => {
  const r = spawnCli(["--selftest"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /SELFTEST: all fixture cases PASS/);
});

test("CLI: default run against the real registry → prints a cov line, exit 0", () => {
  const r = spawnCli([]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /S3 External-validation cov = /);
  assert.match(r.stdout, /registered workspaces have a real ABI transition/);
});

