// @test-group engine
// primitives-drift-check.test.mjs — the three states of the quay-fleet primitive drift gate
// (tasks/gap-ac253-session-primitives-shared-layer-adoption AC2 取假控制).
//
// The checker's whole value is that "I could not look at the other side" must be a DIFFERENT
// reading from "the other side agrees with me" (硬规则 3b). So the tests here are not "it prints
// PASS on the real repo" — they are the three distinguishable outcomes, each forced:
//   • byte-identical both sides          → exit 0
//   • one byte changed on the local side → exit 1
//   • one byte changed on the FLEET side → exit 1 (the local copy is what this repo ships; a fleet
//                                          edit is exactly the fork the pin exists to catch)
//   • fleet repo absent                  → exit 3
//   • fleet repo present, pinned SHA bad → exit 3 (the dangerous direction: a naive
//                                          `existsSync(repo)` check would fall through and report
//                                          "no drift" for a pin it never read)
//   • manifest absent/corrupt            → exit 3
//
// Run: node --test plugin/test/primitives-drift-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECKER = path.join(REPO_ROOT, "plugin", "scripts", "primitives-drift-check.ts");

const FILES = ["pty-frame.mjs", "delivery-audit.mjs", "session-liveness.mjs", "session-schema.mjs"];
const FLEET_SRC = "packages/agent-core/src";

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/**
 * Build a fixture: a fake fleet git repo holding the four primitives at a real commit, a local copy
 * of the same bytes, and a manifest pinning that commit. Returns the paths plus helpers to mutate
 * either side.
 */
function makeFixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "primitives-drift-"));
  const root = path.join(base, "root");
  const prims = path.join(root, "packages", "quay", "src", "primitives");
  const fleet = path.join(base, "fake-fleet");
  const fleetSrc = path.join(fleet, FLEET_SRC);
  const manifest = path.join(root, "plugin", "scripts", "primitives-drift-manifest.json");
  fs.mkdirSync(prims, { recursive: true });
  fs.mkdirSync(fleetSrc, { recursive: true });
  fs.mkdirSync(path.dirname(manifest), { recursive: true });

  for (const f of FILES) {
    const body = `// fixture primitive: ${f}\nexport const name = ${JSON.stringify(f)};\n`;
    fs.writeFileSync(path.join(prims, f), body);
    fs.writeFileSync(path.join(fleetSrc, f), body);
  }
  const git = (...args) =>
    execFileSync("git", ["-C", fleet, "-c", "user.email=f@e.invalid", "-c", "user.name=f", ...args], {
      encoding: "utf8",
    });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "fixture pin");
  const fleetSha = git("rev-parse", "HEAD").trim();

  const writeManifest = (sha = fleetSha, repo = fleet) => {
    const files = {};
    for (const f of FILES) files[f] = sha256(fs.readFileSync(path.join(prims, f)));
    fs.writeFileSync(
      manifest,
      JSON.stringify({ fleetRepo: repo, fleetSha: sha, fleetSourceDir: FLEET_SRC, localDir: "packages/quay/src/primitives", files }, null, 2),
    );
  };
  writeManifest();

  return {
    base, root, prims, fleet, fleetSrc, manifest, fleetSha, writeManifest,
    localPath: (f) => path.join(prims, f),
    fleetPath: (f) => path.join(fleetSrc, f),
    rm: () => fs.rmSync(base, { recursive: true, force: true }),
  };
}

/** Run the checker CLI; returns { status, stdout, stderr }. */
function runChecker(root, extraArgs = []) {
  try {
    const stdout = execFileSync(
      "node",
      ["--no-warnings", "--experimental-strip-types", CHECKER, "--root", root, "--json", ...extraArgs],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { status: 0, stdout };
  } catch (err) {
    return { status: err.status ?? -1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

test("AC2 — byte-identical on both sides ⇒ exit 0 (evaluated, consistent)", () => {
  const fx = makeFixture();
  try {
    const r = runChecker(fx.root);
    assert.equal(r.status, 0, `byte-identical fixture must be green (stdout: ${r.stdout})`);
    assert.match(r.stdout, /"ok": true/, "the JSON verdict reports ok:true");
  } finally { fx.rm(); }
});

test("AC2 取假控制 — ONE appended byte on the LOCAL side ⇒ exit 1 (判据能取假)", () => {
  const fx = makeFixture();
  try {
    fs.appendFileSync(fx.localPath("session-schema.mjs"), "// drift\n");
    const r = runChecker(fx.root);
    assert.equal(r.status, 1, "a local one-byte edit must redden the drift check");
    assert.match(r.stdout, /session-schema\.mjs/, "the drifted file is named");
    assert.match(r.stdout, /"ok": false/, "the JSON verdict reports ok:false");
  } finally { fx.rm(); }
});

test("AC2 — the pin is a COMMIT, not a ref: the fleet tip moving does NOT redden (and is not a blind pass)", () => {
  const fx = makeFixture();
  try {
    // The fleet working tree / branch tip keeps moving (that is why the copy pins a SHA instead of
    // tracking the tree). A new commit on the fleet branch must leave the pinned blob — and this
    // checker's verdict — untouched. THIS is the property that makes the pin usable at all.
    fs.appendFileSync(fx.fleetPath("pty-frame.mjs"), "// fleet moved on\n");
    execFileSync("git", ["-C", fx.fleet, "-c", "user.email=f@e.invalid", "-c", "user.name=f", "add", "-A"], { encoding: "utf8" });
    execFileSync("git", ["-C", fx.fleet, "-c", "user.email=f@e.invalid", "-c", "user.name=f", "commit", "-q", "-m", "fleet moves"], { encoding: "utf8" });
    const newSha = execFileSync("git", ["-C", fx.fleet, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    assert.equal(runChecker(fx.root).status, 0, "an unchanged pin stays green when the fleet branch advances");

    // …and the moment the manifest is RE-PINNED to the moved blob, the stale local copy is exactly
    // the fork the pin exists to catch ⇒ RED.
    fx.writeManifest(newSha, fx.fleet);
    assert.equal(runChecker(fx.root).status, 1, "re-pinning to a moved fleet blob while the local copy is stale ⇒ RED");
  } finally { fx.rm(); }
});

test("AC2 — fleet repo absent ⇒ exit 3 NOT-EVALUATED, ⛔ never 0", () => {
  const fx = makeFixture();
  try {
    const r = runChecker(fx.root, ["--fleet", path.join(fx.base, "no-such-fleet")]);
    assert.equal(r.status, 3, "an absent fleet repo must be NOT-EVALUATED (3), never a PASS (0)");
    assert.match(r.stdout + r.stderr, /NOT-EVALUATED|evaluated/, "the reading names the not-evaluated state");
  } finally { fx.rm(); }
});

test("AC2 — fleet repo PRESENT but the pinned SHA unresolvable ⇒ exit 3 (the dangerous direction)", () => {
  const fx = makeFixture();
  try {
    // The repo is right there, so an `existsSync(repo)`-only implementation would fall through,
    // read no blob, and compare nothing against nothing — printing green for a pin it never read.
    fx.writeManifest("0000000000000000000000000000000000000000", fx.fleet);
    const r = runChecker(fx.root);
    assert.equal(r.status, 3, "an unresolvable pinned SHA must be NOT-EVALUATED (3), never 0");
  } finally { fx.rm(); }
});

test("AC2 — manifest missing ⇒ exit 3 NOT-EVALUATED (an unreadable pin is not 'no drift')", () => {
  const fx = makeFixture();
  try {
    fs.rmSync(fx.manifest);
    const r = runChecker(fx.root);
    assert.equal(r.status, 3, "a missing manifest means the pin is unreadable ⇒ NOT-EVALUATED");
  } finally { fx.rm(); }
});

test("backward compat — bare `--root <repo>` on the real checkout is evaluated (0 or 3 on fleet reachability, never 1)", () => {
  // The real repo: this asserts the default-path wiring (no --fleet override) resolves the manifest
  // and the checkout. On a machine without /home/yale/work/quay-fleet this is NOT-EVALUATED (3);
  // on this one it is 0. What must NEVER happen is a RED for the freshly-pinned copies.
  const r = runChecker(REPO_ROOT);
  assert.ok([0, 3].includes(r.status), `the real checkout must be 0 (consistent) or 3 (fleet unreachable), got ${r.status}`);
});
