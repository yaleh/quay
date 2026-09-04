// @test-group engine
// mirror-pair-drift-check.test.mjs — tasks/gap-mirror-pair-drift-policy-plugin-scripts-experiments
// (plugin/scripts/mirror-pair-drift-check.ts). AC4 的「检查器真的会报红」负控制 + AC3 的
// allow-list 签名报警 + NOT-EVALUATED/corrupt fail-closed + 现状回放绿。
//
// Coverage map (task ACs):
//   AC2 — auto-discovery + byte-compare lands: a byte-identical fixture is GREEN; a one-sided
//         edit of ONE mirror copy is RED (any extension — the fixture uses .ts AND .sh).
//   AC3 — the allow-list is READ and re-checked: a drifted pair whose name + sha256 signature
//         match the allow-list is an ALLOWED drift (exit 0); if EITHER side's sha256 changed since
//         allow-listing, the drift EXPANDED ⇒ RED (exit 1 — the exemption is not a blind pass).
//   AC4 — 硬规则 3b: a missing experiments mirror dir ⇒ NOT-EVALUATED (exit 3, distinct from
//         "0 drift"); a corrupt allow-list ⇒ exit 2 (fail-closed, never reads as "empty allow-list").
//   Symlink semantics — an experiments-side SYMLINK (single-source reference) is NOT a pair: it
//         cannot drift, so the checker excludes it rather than comparing a file against itself.
//
// Every fixture is a temp root built from minimal files; nothing is hardcoded to a global count.
//
// Run:
//   scripts/test.sh plugin/test/mirror-pair-drift-check.test.mjs
//   node --test plugin/test/mirror-pair-drift-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHECKER = path.join(__dirname, "..", "scripts", "mirror-pair-drift-check.ts");
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const LEFT = "plugin/scripts";
const RIGHT = "experiments/quay-perpetual-stream/scripts";
const ALLOWLIST = "plugin/scripts/mirror-pair-drift-allowlist.json";

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/** Build a hermetic fixture root. files = [{ name, left, right }] where a missing side means
 *  "do not create". Returns { root, leftDir, rightDir, allowlistPath }. */
function buildFixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mpdc-"));
  const leftDir = path.join(root, LEFT);
  const rightDir = path.join(root, RIGHT);
  fs.mkdirSync(leftDir, { recursive: true });
  fs.mkdirSync(rightDir, { recursive: true });
  for (const f of files) {
    if (f.left !== null) fs.writeFileSync(path.join(leftDir, f.name), f.left);
    if (f.right !== null) fs.writeFileSync(path.join(rightDir, f.name), f.right);
  }
  return { root, leftDir, rightDir, allowlistPath: path.join(root, ALLOWLIST) };
}

function writeAllowlist(root, pairs) {
  fs.writeFileSync(path.join(root, ALLOWLIST), JSON.stringify({ pairs }, null, 2));
}

function runChecker(args) {
  return spawnSync(
    "node",
    ["--no-warnings", "--experimental-strip-types", CHECKER, ...args],
    { encoding: "utf8" },
  );
}

test("AC2: byte-identical mirror pairs are GREEN (exit 0), any extension", () => {
  const { root } = buildFixture([
    { name: "a.ts", left: "// a baseline\n", right: "// a baseline\n" },
    { name: "b.sh", left: "#!/usr/bin/env bash\necho b\n", right: "#!/usr/bin/env bash\necho b\n" },
  ]);
  try {
    const res = runChecker(["--root", root]);
    assert.equal(res.status, 0, `byte-identical baseline should be green: ${res.stdout} ${res.stderr}`);
    assert.match(res.stdout, /2 pairs, 2 consistent \/ 0 drifted/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2/AC4 判据能取假: a one-sided edit of ONE mirror copy goes RED (exit 1)", () => {
  const { root, leftDir } = buildFixture([
    { name: "a.ts", left: "// a baseline\n", right: "// a baseline\n" },
    { name: "b.ts", left: "// b\n", right: "// b\n" },
  ]);
  try {
    fs.writeFileSync(path.join(leftDir, "a.ts"), "// a baseline\n// one-sided edit\n");
    const res = runChecker(["--root", root]);
    assert.equal(res.status, 1, `a drifted pair must be red: ${res.stdout} ${res.stderr}`);
    assert.match(res.stdout, /1 consistent \/ 1 drifted/);
    assert.match(res.stdout, /DRIFT: plugin\/scripts\/a\.ts/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC3: an allow-listed pair with a MATCHING signature is an ALLOWED drift (exit 0)", () => {
  const left = "// drift-left\n";
  const right = "// drift-right\n";
  const { root } = buildFixture([
    { name: "a.ts", left, right },
    { name: "b.ts", left: "// b\n", right: "// b\n" },
  ]);
  try {
    writeAllowlist(root, {
      "a.ts": { reason: "structural test drift", pluginSha256: sha256(left), experimentsSha256: sha256(right) },
    });
    const res = runChecker(["--root", root]);
    assert.equal(res.status, 0, `an allow-listed drift must be green: ${res.stdout} ${res.stderr}`);
    assert.match(res.stdout, /1 consistent \/ 1 drifted \(1 allowed\)/);
    assert.match(res.stdout, /allowed drift: plugin\/scripts\/a\.ts/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC3 漂移扩大报警: an allow-listed pair whose signature CHANGED goes RED (exit 1)", () => {
  const left = "// drift-left\n";
  const right = "// drift-right\n";
  const { root, leftDir } = buildFixture([
    { name: "a.ts", left, right },
  ]);
  try {
    // Record the ORIGINAL signature, then edit the left side FURTHER — the drift grew.
    writeAllowlist(root, {
      "a.ts": { reason: "structural test drift", pluginSha256: sha256(left), experimentsSha256: sha256(right) },
    });
    fs.writeFileSync(path.join(leftDir, "a.ts"), left + "// expanded drift\n");
    const res = runChecker(["--root", root]);
    assert.equal(res.status, 1, `an expanded allow-listed drift must be red: ${res.stdout} ${res.stderr}`);
    assert.match(res.stdout, /DRIFT EXPANDED: plugin\/scripts\/a\.ts/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("硬规则 3b: a missing experiments mirror dir is NOT-EVALUATED (exit 3), never '0 drift'", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mpdc-"));
  fs.mkdirSync(path.join(root, LEFT), { recursive: true });
  fs.writeFileSync(path.join(root, LEFT, "a.ts"), "// a\n");
  // NO experiments/quay-perpetual-stream/scripts/ dir — the check has no right half.
  try {
    const res = runChecker(["--root", root]);
    assert.equal(res.status, 3, `absent mirror dir must be NOT-EVALUATED (exit 3): ${res.stdout} ${res.stderr}`);
    assert.match(res.stdout, /NOT-EVALUATED/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("硬规则 3b: a CORRUPT allow-list fails closed (exit 2), never reads as 'empty allow-list'", () => {
  const { root } = buildFixture([
    { name: "a.ts", left: "// a\n", right: "// a\n" },
  ]);
  try {
    fs.writeFileSync(path.join(root, ALLOWLIST), "{ not valid json");
    const res = runChecker(["--root", root]);
    assert.equal(res.status, 2, `corrupt allow-list must fail closed (exit 2): ${res.stdout} ${res.stderr}`);
    assert.match(res.stderr, /ERROR/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("symlink semantics: an experiments-side SYMLINK is a single-source reference, not a pair (exit 0)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mpdc-"));
  const leftDir = path.join(root, LEFT);
  const rightDir = path.join(root, RIGHT);
  fs.mkdirSync(leftDir, { recursive: true });
  fs.mkdirSync(rightDir, { recursive: true });
  fs.writeFileSync(path.join(leftDir, "a.ts"), "// a\n");
  // experiments/a.ts is a SYMLINK to the plugin file — same inode, cannot drift.
  fs.symlinkSync(path.join(leftDir, "a.ts"), path.join(rightDir, "a.ts"));
  try {
    const res = runChecker(["--root", root]);
    assert.equal(res.status, 0, `a symlink pair must not be flagged as drift: ${res.stdout} ${res.stderr}`);
    assert.match(res.stdout, /0 pairs/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("现状回放绿: the live repo's mirror copies are consistent-or-allowed ⇒ GREEN (exit 0)", () => {
  const res = runChecker(["--root", REPO_ROOT]);
  assert.equal(res.status, 0,
    `the reconciled live repo must be green — 12 copies re-synced + 2 structural allow-listed: ${res.stdout} ${res.stderr}`);
  assert.match(res.stdout, /PASS — every mirror pair matches or is allow-listed/);
});
