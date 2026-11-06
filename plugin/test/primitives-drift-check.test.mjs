// @test-group engine
// primitives-drift-check.test.mjs — the states of the primitives drift gate after the direction was
// reversed (tasks/gap-ac253-session-primitives-shared-layer-adoption AC2 取假控制; external-repo
// decoupling in tasks/gap-primitives-decouple-from-quay-fleet).
//
// The checker now compares each `packages/quay/src/primitives/*.mjs` against the sha256 recorded in
// `plugin/scripts/primitives-drift-manifest.json` — a LOCAL baseline, entirely inside this repo.
// The tests are therefore not "it prints PASS on the real repo" but the distinguishable outcomes,
// each forced:
//   • bytes == baseline                       → exit 0
//   • one appended byte on the local side     → exit 1 (the in-place edit the check exists for)
//   • restored to the baseline bytes          → exit 0 again
//   • a declared file deleted                 → exit 1 (a missing file is drift, not a skip)
//   • baseline sha256 wrong, file untouched   → exit 1 (editing the manifest alone must NOT pass)
//   • manifest missing / unparsable / empty   → exit 3 (NOT-EVALUATED, ⛔ never 0)
//   • a baseline value that is not a sha256   → exit 3 (the dangerous direction: a value the checker
//                                              cannot interpret must not read as "consistent")
//   • `--fleet` (the retired flag)            → exit 2 (never silently ignored)
//   • the REAL checkout                       → exit 0 ALWAYS, and with no `git` on PATH — the
//                                              reading no longer depends on any external repo
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

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/**
 * Build a fixture: a temp root carrying the four primitives and a LOCAL baseline manifest recording
 * their sha256 values. No git repo, no external path — that absence is the point of the decoupled
 * checker, and none of these tests may need one.
 */
function makeFixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "primitives-drift-"));
  const root = path.join(base, "root");
  const prims = path.join(root, "packages", "quay", "src", "primitives");
  const manifest = path.join(root, "plugin", "scripts", "primitives-drift-manifest.json");
  fs.mkdirSync(prims, { recursive: true });
  fs.mkdirSync(path.dirname(manifest), { recursive: true });

  for (const f of FILES) {
    const body = `// fixture primitive: ${f}\nexport const name = ${JSON.stringify(f)};\n`;
    fs.writeFileSync(path.join(prims, f), body);
  }

  /** Rewrite the manifest; `overrides` replaces individual baseline values. */
  const writeManifest = (overrides = {}) => {
    const files = {};
    for (const f of FILES) files[f] = sha256(fs.readFileSync(path.join(prims, f)));
    Object.assign(files, overrides);
    fs.writeFileSync(
      manifest,
      JSON.stringify({ localDir: "packages/quay/src/primitives", files }, null, 2),
    );
  };
  writeManifest();

  return {
    base, root, prims, manifest, writeManifest,
    localPath: (f) => path.join(prims, f),
    rm: () => fs.rmSync(base, { recursive: true, force: true }),
  };
}

/** Run the checker CLI; returns { status, stdout, stderr }. */
function runChecker(root, { extraArgs = [], env = undefined } = {}) {
  try {
    const stdout = execFileSync(
      process.execPath,
      ["--no-warnings", "--experimental-strip-types", CHECKER, "--root", root, "--json", ...extraArgs],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: env ?? process.env },
    );
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    return { status: err.status ?? -1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

test("byte-identical with the local baseline ⇒ exit 0 (evaluated, consistent)", () => {
  const fx = makeFixture();
  try {
    const r = runChecker(fx.root);
    assert.equal(r.status, 0, `a byte-identical fixture must be green (stdout: ${r.stdout} ${r.stderr})`);
    assert.match(r.stdout, /"ok": true/, "the JSON verdict reports ok:true");
  } finally { fx.rm(); }
});

test("取假控制 — ONE appended byte on a local primitive ⇒ exit 1 (判据能取假)", () => {
  const fx = makeFixture();
  try {
    fs.appendFileSync(fx.localPath("session-schema.mjs"), "// drift\n");
    const r = runChecker(fx.root);
    assert.equal(r.status, 1, "a local one-byte edit must redden the drift check");
    assert.match(r.stdout, /session-schema\.mjs/, "the drifted file is named");
    assert.match(r.stdout, /"ok": false/, "the JSON verdict reports ok:false");
  } finally { fx.rm(); }
});

test("restore the baseline bytes ⇒ exit 0 again (the red was the edit, not a permanently-red check)", () => {
  const fx = makeFixture();
  try {
    const before = fs.readFileSync(fx.localPath("delivery-audit.mjs"));
    fs.appendFileSync(fx.localPath("delivery-audit.mjs"), "// drift\n");
    assert.equal(runChecker(fx.root).status, 1, "fixture sanity: the edit really reddened it");
    fs.writeFileSync(fx.localPath("delivery-audit.mjs"), before);
    assert.equal(runChecker(fx.root).status, 0, "restoring the recorded bytes must return GREEN");
  } finally { fx.rm(); }
});

test("负控 — a declared primitive is MISSING ⇒ exit 1 (never a silent skip)", () => {
  const fx = makeFixture();
  try {
    fs.rmSync(fx.localPath("pty-frame.mjs"));
    const r = runChecker(fx.root);
    assert.equal(r.status, 1, "a missing declared file is drift, not 'nothing to compare'");
    assert.match(r.stdout, /pty-frame\.mjs/, "the missing file is named");
  } finally { fx.rm(); }
});

test("负控 — only the BASELINE is changed (file untouched) ⇒ exit 1", () => {
  // The "silence the check" move: leave the primitive alone and rewrite its recorded hash. It must
  // read exactly like an in-place edit, because that is what the pair no longer agreeing means.
  const fx = makeFixture();
  try {
    fx.writeManifest({ "session-liveness.mjs": "a".repeat(64) });
    const r = runChecker(fx.root);
    assert.equal(r.status, 1, "a tampered baseline must redden, not pass");
    assert.match(r.stdout, /session-liveness\.mjs/, "the disagreeing file is named");
  } finally { fx.rm(); }
});

test("manifest missing ⇒ exit 3 NOT-EVALUATED (an unreadable baseline is not 'no drift')", () => {
  const fx = makeFixture();
  try {
    fs.rmSync(fx.manifest);
    const r = runChecker(fx.root);
    assert.equal(r.status, 3, "a missing baseline means there is nothing to compare against ⇒ NOT-EVALUATED");
    assert.match(r.stdout + r.stderr, /NOT-EVALUATED/, "the reading names the not-evaluated state");
  } finally { fx.rm(); }
});

test("manifest unparsable ⇒ exit 3 NOT-EVALUATED", () => {
  const fx = makeFixture();
  try {
    fs.writeFileSync(fx.manifest, "{ not json");
    assert.equal(runChecker(fx.root).status, 3, "unparsable JSON is an unreadable baseline ⇒ 3, never 1 or 0");
  } finally { fx.rm(); }
});

test("manifest records no files ⇒ exit 3 NOT-EVALUATED (an empty baseline compares nothing)", () => {
  const fx = makeFixture();
  try {
    fs.writeFileSync(fx.manifest, JSON.stringify({ localDir: "packages/quay/src/primitives", files: {} }));
    assert.equal(runChecker(fx.root).status, 3, "an empty baseline must not read as 'everything matches'");
  } finally { fx.rm(); }
});

test("baseline value that is not a sha256 ⇒ exit 3 (the dangerous direction)", () => {
  // The manifest is present and parseable, so a naive implementation would compare `sha256(file)`
  // against `"deadbeef"`, conclude "drift", and report exit 1 — a fabricated RED for a baseline it
  // never understood. "I cannot interpret the baseline" is its own state.
  const fx = makeFixture();
  try {
    fx.writeManifest({ "pty-frame.mjs": "deadbeef" });
    assert.equal(runChecker(fx.root).status, 3, "an uninterpretable baseline is NOT-EVALUATED (3), not a fabricated RED");
  } finally { fx.rm(); }
});

test("the retired `--fleet` flag is a usage error (exit 2), never silently ignored", () => {
  const fx = makeFixture();
  try {
    const r = runChecker(fx.root, { extraArgs: ["--fleet", "/tmp/does-not-exist"] });
    assert.equal(r.status, 2, "a stale two-sided caller must be told the external side is gone");
    assert.match(r.stderr, /--fleet/, "and the message names the flag");
  } finally { fx.rm(); }
});

test("the REAL checkout is evaluated (exit 0) — no external repo is consulted any more", () => {
  // This is the decoupling reading: the old checker returned 0-or-3 on this machine depending on
  // whether a repo OUTSIDE this checkout happened to exist. That is exactly what a machine-portable
  // invariant cannot do. Today it is 0 unconditionally.
  const r = runChecker(REPO_ROOT);
  assert.equal(r.status, 0, `the real checkout must be evaluable with no external input, got ${r.status}: ${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /"ok": true/, "and it reports the four files as matching their baseline");
});

test("the REAL checkout is still evaluated with NO `git` on PATH — the check spawns nothing external", () => {
  // The strongest available proof that the checker reads only this repo: run it with a PATH that
  // contains no binaries at all. If any implementation detail (a `git show`, a shelled-out
  // `sha256sum`, …) survived the decoupling, it would fail here even though the files are fine.
  const emptyPath = fs.mkdtempSync(path.join(os.tmpdir(), "primitives-drift-nopath-"));
  try {
    const r = runChecker(REPO_ROOT, { env: { ...process.env, PATH: emptyPath } });
    assert.equal(r.status, 0, `no external binary is needed, got ${r.status}: ${r.stdout}${r.stderr}`);
  } finally { fs.rmSync(emptyPath, { recursive: true, force: true }); }
});
