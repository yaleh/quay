// @test-group engine
// criterion-carrier-inline-check.test.mjs — RED/GREEN for the anti-recurrence gate
// (plugin/scripts/criterion-carrier-inline-check.ts, gap-criterion-live-web-address-derivation-17-copies-to-one AC7).
//
// AC7 IS the "takes false" requirement: the checker must go RED when a criterion names the carrier
// and GREEN when it does not — otherwise it is a permanently-green rule with nothing to observe
// (硬规则 3b / 来源完备性). Both directions are driven through REAL goal files on disk, and the
// judgment is also run against THIS repository's real `goals/` (a fixture-only arm would prove the
// checker CAN produce a verdict, ⛔ not that the shipped corpus is clean — 硬规则 4 推论三).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { criterionInlinesCarrier, scanGoalDir } from "../scripts/criterion-carrier-inline-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECKER = path.join(REPO_ROOT, "plugin", "scripts", "criterion-carrier-inline-check.ts");

/** Temp goals dir + cleanup in one scope (the shape `tmp-leak-pairing-check` accepts). */
function withGoalsDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crit-carrier-inline-"));
  try {
    fs.mkdirSync(path.join(dir, "goals"), { recursive: true });
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** A goal record whose criterion is `criterion`. Written through the same `---` frontmatter shape
 *  the store writes, so the checker's reader is exercised for real. */
function writeGoal(root, { id, criterion }) {
  const body =
    `---\nid: ${id}\ntitle: t\nstatus: active\nkind: criterion\ncriterion: >-\n  ${criterion}\n---\n`;
  fs.writeFileSync(path.join(root, "goals", `${id}-fixture.md`), body);
}

function runChecker(root, extra = []) {
  const r = spawnSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", CHECKER, "--root", root, ...extra],
    { encoding: "utf8" },
  );
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

// ── the predicate (pure) ─────────────────────────────────────────────────────────────────────────
test("predicate: a criterion naming the carrier is a hit; one that does not is not", () => {
  assert.equal(criterionInlinesCarrier("o=$(node -e 'require(fs).readFileSync(R+\"/.quay/server.json\")')"), true);
  assert.equal(criterionInlinesCarrier("o=$(node --no-warnings --experimental-strip-types \"$root/plugin/scripts/live-web-address.ts\" \"$root\" \"$1\")"), false);
  assert.equal(criterionInlinesCarrier(undefined), false, "an absent criterion is not a hit");
  assert.equal(criterionInlinesCarrier(""), false);
});

// ── RED: injection ⇒ the gate goes red (AC7 first half) ───────────────────────────────────────────
test("RED: a goal criterion that names the carrier is reported and the CLI exits 1", () => {
  withGoalsDir((root) => {
    writeGoal(root, { id: "AC-900", criterion: "addr from .quay/server.json by hand" });
    const v = scanGoalDir(path.join(root, "goals"));
    assert.equal(v.length, 1, JSON.stringify(v));
    assert.equal(v[0].id, "AC-900");
    const r = runChecker(root);
    assert.equal(r.code, 1, `expected red, got ${r.code}: ${r.stderr}`);
    assert.match(r.stderr, /AC-900/);
    assert.match(r.stderr, /live-web-address\.ts/);
  });
});

// ── GREEN: removal ⇒ the gate goes green (AC7 second half — the mutation control) ────────────────
test("GREEN: the same goal with the carrier mention REMOVED is clean and the CLI exits 0", () => {
  withGoalsDir((root) => {
    writeGoal(root, { id: "AC-900", criterion: "addr from live-web-address.ts" });
    assert.deepEqual(scanGoalDir(path.join(root, "goals")), []);
    const r = runChecker(root);
    assert.equal(r.code, 0, `expected green, got ${r.code}: ${r.stderr}`);
  });
  // the control that proves the RED arm above was not vacuous: same fixture, only the string changed.
  withGoalsDir((root) => {
    writeGoal(root, { id: "AC-900", criterion: "addr from .quay/server.json by hand" });
    assert.equal(scanGoalDir(path.join(root, "goals")).length, 1);
  });
});

test("an entry in origin/expect prose is NOT a hit (the predicate is positional)", () => {
  withGoalsDir((root) => {
    const body =
      `---\nid: AC-901\ntitle: t\nstatus: active\nkind: criterion\ncriterion: >-\n  addr from live-web-address.ts\norigin: the old step read .quay/server.json\n---\n`;
    fs.writeFileSync(path.join(root, "goals", "AC-901-fixture.md"), body);
    assert.deepEqual(scanGoalDir(path.join(root, "goals")), [], "prose about the carrier is not a criterion step");
    assert.equal(runChecker(root).code, 0);
  });
});

// ── the "cannot evaluate" state must NOT look like a pass (硬规则 3b) ─────────────────────────────
test("a missing goals dir is exit 2 NOT-EVALUATED, never an empty pass", () => {
  withGoalsDir((root) => {
    fs.rmSync(path.join(root, "goals"), { recursive: true, force: true });
    const r = runChecker(root);
    assert.equal(r.code, 2, `expected NOT-EVALUATED (2), got ${r.code}`);
    assert.match(r.stderr, /CAUSE=goals-dir-absent/);
  });
});

test("a goal file with unreadable frontmatter is REPORTED, not skipped", () => {
  withGoalsDir((root) => {
    fs.writeFileSync(path.join(root, "goals", "AC-902-broken.md"), "no frontmatter here\n");
    const v = scanGoalDir(path.join(root, "goals"));
    assert.equal(v.length, 1);
    assert.match(v[0].id, /cannot evaluate/);
  });
});

// ── the SHIPPED corpus (production carrier, ⛔ not a fixture) ─────────────────────────────────────
test("the repository's own goals/ has ZERO criteria naming the carrier", () => {
  const goalDir = path.join(REPO_ROOT, "goals");
  assert.ok(fs.existsSync(goalDir), `no ${goalDir}`);
  const v = scanGoalDir(goalDir);
  assert.deepEqual(v, [], `shipped criteria must not inline the carrier: ${JSON.stringify(v)}`);
  const r = runChecker(REPO_ROOT);
  assert.equal(r.code, 0, r.stderr);
});
