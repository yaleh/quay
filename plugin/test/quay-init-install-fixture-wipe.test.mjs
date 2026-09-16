// @test-group engine
// quay-init-install-fixture-wipe.test.mjs — tasks/gap-shared-install-fixture-wipe-cannot-remove-readonly-tree
//
// The shared install fixture (plugin/test/helpers/quay-init-install-fixture.mjs) is built
// READ-ONLY on purpose (_makeReadOnly strips every write bit) so one consumer's pollution cannot
// corrupt it for the rest of the install family. Its wipe path therefore has to be able to clear a
// READ-ONLY tree as well as an absent one — and the pre-fix code could not:
//
//   _buildSharedFixture: `if (fs.existsSync(ws)) fs.rmSync(ws, { recursive: true, force: true })`
//
// `force: true` suppresses ENOENT only, never EACCES; recursive rm must UNLINK each entry, and
// unlinking needs WRITE permission on the entry's PARENT — exactly the bit _makeReadOnly removed.
// So a fixture left in the read-only shape (a crashed/partial build: read-only tree, no ready
// marker) threw EACCES BEFORE anything was rebuilt, on every attempt, with zero entries deleted ⇒
// the directory was PERMANENTLY unbuildable until someone chmod'd it out-of-band, and it reddened
// the whole install family for every task whose plugin-surface hash mapped to it (measured
// 2026-09-16: 3/3 attempts EACCES inside the consumer test, marker never written).
//
// Coverage map (task ACs):
//   AC2 — the wipe either clears the tree or leaves it EXACTLY as found. Two injected mid-wipe
//         failures (the seam on _wipeFixture): a failure before any content is touched must
//         preserve the fixture byte-for-byte, and a failure while deleting the moved-aside tree
//         must still leave the fixture path clear so the next round rebuilds. The forbidden end
//         state ("ready marker gone, read-only tree still there") is asserted against directly.
//   AC3 — the helper file is TEXT again: no NUL bytes, and the three hash separators are the
//         two-character `\0` escape. The predicate is shown FALSIFIABLE first (dry-run against a
//         known-NUL sample) — a text-ness check that cannot fail is not a check.
//
// AC1 (pre-fix EACCES vs post-fix rebuild, in the real consumer test at the real /var/tmp
// fixture path) and AC4 (green from both start states) are driven end-to-end against
// packages/quay/test/install-config-driven-e2e.test.mjs — evidence in the task body; they need a
// real quay-init install and belong to the serial install family, not to this hermetic unit file.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { _wipeFixture, _restoreWriteBits } from "./helpers/quay-init-install-fixture.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HELPER = path.join(__dirname, "helpers", "quay-init-install-fixture.mjs");

const _tmpDirs = [];
function mkTmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "quay-fixture-wipe-"));
  _tmpDirs.push(d);
  return d;
}
process.on("exit", () => {
  for (const d of _tmpDirs) {
    try { _restoreWriteBits(d); fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

// _makeBrokenFixture(root) — the exact shape the incident describes and that the production
// carrier was found in: an EXISTING fixture directory whose subdirectories have been stripped of
// their write bits by _makeReadOnly, with NO ready marker and NO captured install result (so
// ready() is false and the build path is the one that runs). Written from scratch rather than by
// calling _makeReadOnly so the test owns the shape it asserts on.
function _makeBrokenFixture(root) {
  fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(root, ".claude", "settings.json"), '{"x":1}\n');
  fs.writeFileSync(path.join(root, ".quay", "config.yml"), "provider: native\n");
  for (const f of [".claude/settings.json", ".quay/config.yml"]) fs.chmodSync(path.join(root, f), 0o444);
  for (const d of [".claude", ".quay"]) fs.chmodSync(path.join(root, d), 0o555);
  return root;
}

// A whole-tree fingerprint (relative path → mode + bytes) so "left exactly as found" is asserted
// on CONTENT and MODES, not merely on "the path still exists".
function _snapshot(root) {
  const out = [];
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      const st = fs.lstatSync(p);
      if (e.isDirectory()) { out.push([r, `dir:${(st.mode & 0o7777).toString(8)}`]); walk(p, r); }
      else out.push([r, `file:${(st.mode & 0o7777).toString(8)}:${fs.readFileSync(p).toString("hex")}`]);
    }
  };
  if (fs.existsSync(root)) walk(root, "");
  return JSON.stringify(out);
}

// ── AC2 — the wipe clears a read-only tree, and never leaves it worse ──────────────────────────

test("AC2 — _wipeFixture clears a read-only fixture (no marker): the self-heal the pre-fix path lacked", () => {
  const parent = mkTmp();
  const ws = _makeBrokenFixture(path.join(parent, "fixture"));
  // Negative control: the PRE-FIX algorithm on this exact shape. If this ever starts succeeding,
  // the fixture's read-only invariant changed and the rest of this file's premise is void.
  assert.throws(() => fs.rmSync(ws, { recursive: true, force: true }),
    (e) => e.code === "EACCES", "pre-fix rmSync must throw EACCES on a read-only tree");
  assert.ok(fs.existsSync(ws), "pre-fix rmSync deleted nothing (the defect is a hard stall, not a partial wipe)");

  // Post-fix: same input, same call site semantics — the wipe clears it.
  _wipeFixture(ws);
  assert.equal(fs.existsSync(ws), false, "the fixed wipe must clear a read-only tree");
});

test("AC2 — a wipe failing BEFORE any content is touched leaves the fixture byte-for-byte as found", () => {
  const parent = mkTmp();
  const ws = _makeBrokenFixture(path.join(parent, "fixture"));
  // A ready marker on top, so "keep the good state" is a state worth preserving (not just the
  // already-broken one): the forbidden end state is precisely "marker gone + read-only tree left".
  fs.writeFileSync(path.join(ws, ".fixture-ready"), "/some/plugin\n");
  const before = _snapshot(ws);

  const boom = new Error("injected rename failure");
  assert.throws(() => _wipeFixture(ws, { renameSync: () => { throw boom; } }), /injected rename failure/);

  assert.equal(_snapshot(ws), before, "fixture content+modes must be untouched by a pre-critical-section failure");
  assert.ok(fs.existsSync(path.join(ws, ".fixture-ready")),
    "FORBIDDEN STATE: ready marker gone while the tree (still read-only) remains");
});

test("AC2 — a wipe failing while deleting the moved-aside tree still leaves the fixture path clear (next round rebuilds)", () => {
  const parent = mkTmp();
  const ws = _makeBrokenFixture(path.join(parent, "fixture"));

  const aside = _wipeFixture(ws, { rmSync: () => { throw new Error("injected rm failure"); } });

  assert.equal(fs.existsSync(ws), false, "the fixture path must be clear even when the aside tree cannot be deleted");
  assert.ok(aside && fs.existsSync(aside), "the moved-aside tree is orphaned, never left at the fixture path");
  // The next round takes the same path as an absent fixture and builds cleanly.
  fs.mkdirSync(ws, { recursive: true });
  assert.ok(fs.statSync(ws).isDirectory(), "a rebuild can proceed on the fixture path");
  _restoreWriteBits(aside);
  fs.rmSync(aside, { recursive: true, force: true });
});

test("AC2 — _wipeFixture on an absent path is a no-op (absent and present-but-read-only share one path)", () => {
  const absent = path.join(mkTmp(), "never-created");
  assert.equal(_wipeFixture(absent), null);
  assert.equal(fs.existsSync(absent), false);
});

// ── AC3 — the helper file is text again ───────────────────────────────────────────────────────

// The AC3 predicate. Kept as a named function so the falsifiability control below can run the
// SAME code over a known-positive sample (hard rule 2's zero-count half: a predicate that returns
// "no NULs" must first be shown able to return "NULs found").
function _nulOffsets(buf) {
  const out = [];
  for (let i = 0; i < buf.length; i++) if (buf[i] === 0) out.push(i);
  return out;
}

test("AC3 — instrument self-check: the NUL predicate detects NUL in a sample known to contain one", () => {
  const sample = Buffer.from('h.update("\0");\n', "latin1"); // literal NUL, the pre-fix spelling
  // 'h.update("' is 10 bytes, so the NUL sits at offset 10 — a FIXED offset, so the predicate
  // cannot pass by returning an empty list for the wrong reason.
  assert.deepEqual(_nulOffsets(sample), [10], "predicate must report the NUL offset of a known-positive sample");
  assert.equal(Buffer.from('h.update("\\0");\n', "latin1").length, 16, "escaped spelling is 16 bytes (no NUL byte)");
  assert.deepEqual(_nulOffsets(Buffer.from('h.update("\\0");\n', "latin1")), [],
    "the ESCAPED spelling must contain no NUL byte (the two forms differ in source, not in runtime value)");
});

test("AC3 — the helper file contains no NUL byte and uses the escaped separator", () => {
  const buf = fs.readFileSync(HELPER);
  assert.deepEqual(_nulOffsets(buf), [], "helper must be text: zero NUL bytes");
  const text = buf.toString("utf8");
  assert.equal((text.match(/h\.update\("\\0"\)/g) || []).length, 3, "the three hash separators use the \\0 escape");
  assert.ok(text.includes('h.update("\\0")'), "escaped separator present");
  // Value-preserving: the escape is still the NUL character at runtime, so the variant fixture
  // hash (and therefore every existing content-addressed variant fixture path) is unchanged.
  assert.equal("\0", String.fromCharCode(0));
});

test("AC3 — external readers agree the file is text (file(1) + grep, both of which used to silently return nothing)", (t) => {
  const has = (bin) => spawnSync("sh", ["-c", `command -v ${bin}`], { encoding: "utf8" }).status === 0;
  if (!has("file") || !has("grep")) return t.skip("file/grep unavailable on this host");

  const f = spawnSync("file", ["--mime-encoding", HELPER], { encoding: "utf8" });
  assert.equal(f.status, 0);
  assert.ok(f.stdout.trim() !== "binary", `file(1) must not classify the helper as binary; got ${f.stdout.trim()}`);

  // grep WITHOUT -a used to exit 1 with ZERO output on this file ("no match") while 11 lines
  // really matched — "cannot read it" rendering as "it is not there". Both readings must now
  // agree, and the self-check requirement is that a KNOWN-TRUE string is used.
  const needle = "sharedFixture";
  const withA = spawnSync("grep", ["-ac", needle, HELPER], { encoding: "utf8" });
  const withoutA = spawnSync("grep", ["-c", needle, HELPER], { encoding: "utf8" });
  assert.ok(Number(withA.stdout.trim()) > 0, "known-true sample: -a count must be > 0 (else the predicate is broken, not the file)");
  assert.equal(withoutA.status, 0, "plain grep must exit 0 on a text file");
  assert.equal(withoutA.stdout.trim(), withA.stdout.trim(), "plain and -a counts must agree now that the file is text");
});
