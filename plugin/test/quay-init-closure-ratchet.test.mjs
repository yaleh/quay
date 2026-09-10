// @test-group engine
// quay-init-closure-ratchet.test.mjs — gap-quay-init-closure-assertion-first (SPEC AC168 判据先行).
//
// Pins the shrink-only ratchet's judgment + the SPEC AC4 counter-example criterion (读生产载体, not a
// fixture), via the PURE judgment function (baseline ±1 both directions) + the runLaydown NOT-EVALUATED
// path (real laydown cannot run ⇒ evaluated:false, never conflated with "≤ baseline").
//
//   基线降 1 必须红  — checkClosureRatchet({files:N, …}, {files:N-1, …}).ok === false  (it really counts
//                      production artifacts: the SAME count vs a lowered allowance is a violation).
//   基线升 1 必须绿  — checkClosureRatchet({files:N, …}, {files:N+1, …}).ok === true   (shrink-only: growing
//                      the allowance is legal, only growth of the laydown itself is blocked).
//   NOT-EVALUATED     — runLaydown(root-without-quay-init.sh).evaluated === false, and the CLI exits 3.
//
// Run:
//   scripts/test.sh plugin/test/quay-init-closure-ratchet.test.mjs
//   node --test plugin/test/quay-init-closure-ratchet.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

import {
  checkClosureRatchet,
  countTree,
  runLaydown,
  collectSourceEntries,
  fingerprintOf,
  writeBaseline,
} from "../scripts/quay-init-closure-ratchet.ts";

function makeTmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), `qicr-${prefix}-`)); }
function cleanup(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } }

// ── the ±1 both-directions judgment (DoD 负控制, AC2 "只许降不许升") ──────────────────────────────

test("ratchet ok when the laydown is exactly at baseline (files and bytes)", () => {
  const actual = { files: 136, bytes: 6886001 };
  const baseline = { files: 136, bytes: 6886001 };
  const v = checkClosureRatchet(actual, baseline);
  assert.equal(v.ok, true, `actual == baseline must be ok, got ${JSON.stringify(v)}`);
  assert.equal(v.overFiles, false);
  assert.equal(v.overBytes, false);
});

test("基线降 1 必须红 — a lowered FILE baseline reddens the SAME count (it really counts production artifacts)", () => {
  const actual = { files: 136, bytes: 6886001 };
  const baseline = { files: 135, bytes: 6886001 }; // baseline -1
  const v = checkClosureRatchet(actual, baseline);
  assert.equal(v.ok, false, "lowering the file baseline by 1 must go RED (136 > 135)");
  assert.equal(v.overFiles, true);
});

test("落地量涨 1 必须红 — one more laid-down FILE goes RED (the shrink-only direction)", () => {
  const actual = { files: 137, bytes: 6886001 };
  const baseline = { files: 136, bytes: 6886001 };
  const v = checkClosureRatchet(actual, baseline);
  assert.equal(v.ok, false, "a grown laydown (137 vs 136) must go RED");
  assert.equal(v.overFiles, true);
});

test("byte growth alone goes RED (bytes are ratcheted too, not just the file count)", () => {
  const actual = { files: 136, bytes: 6887000 };
  const baseline = { files: 136, bytes: 6886001 };
  const v = checkClosureRatchet(actual, baseline);
  assert.equal(v.ok, false, "growing bytes past baseline must go RED");
  assert.equal(v.overBytes, true);
  assert.equal(v.overFiles, false);
});

test("基线升 1 必须绿 — raising the allowance by one is legal (shrink-only: only growth of the laydown is blocked)", () => {
  const actual = { files: 136, bytes: 6886001 };
  const baseline = { files: 137, bytes: 6886001 }; // baseline +1
  const v = checkClosureRatchet(actual, baseline);
  assert.equal(v.ok, true, "raising the baseline by 1 must stay GREEN (136 ≤ 137)");
});

test("shrink is always ok — a laydown BELOW baseline on both axes is green", () => {
  const actual = { files: 100, bytes: 1000 };
  const baseline = { files: 136, bytes: 6886001 };
  const v = checkClosureRatchet(actual, baseline);
  assert.equal(v.ok, true, "a shrunken laydown must be ok (只许降)");
});

// ── NOT-EVALUATED (hard rule 3b): 读不懂输入 ≠ 合格 ───────────────────────────────────────────────

test("hard rule 3b — runLaydown with NO quay-init.sh ⇒ evaluated:false (NOT-EVALUATED, never a green count)", () => {
  const root = makeTmp("no-init");
  try {
    const r = runLaydown(root);
    assert.equal(r.evaluated, false, "a root without plugin/scripts/quay-init.sh must be NOT-EVALUATED");
    assert.equal(r.files, 0);
    assert.equal(r.bytes, 0);
  } finally { cleanup(root); }
});

test("hard rule 3b — the CLI exits 3 (NOT-EVALUATED third state) when the laydown cannot run", () => {
  const root = makeTmp("no-init-cli");
  try {
    const checker = path.join(REPO_ROOT, "plugin", "scripts", "quay-init-closure-ratchet.ts");
    const res = spawnSync("node", ["--no-warnings", "--experimental-strip-types", checker, "--gate", "--root", root], { encoding: "utf8" });
    assert.equal(res.status, 3, `NOT-EVALUATED must exit 3, got ${res.status}: ${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /NOT-EVALUATED/, "the NOT-EVALUATED third state must be distinguishable in the output");
  } finally { cleanup(root); }
});

// ── countTree ──────────────────────────────────────────────────────────────────────────────────────

test("countTree counts regular files and byte sizes recursively", () => {
  const root = makeTmp("count");
  try {
    fs.mkdirSync(path.join(root, "a", "b"), { recursive: true });
    fs.writeFileSync(path.join(root, "a", "b", "f1"), "0123456789"); // 10 bytes
    fs.writeFileSync(path.join(root, "a", "f2"), "01234"); // 5 bytes
    const c = countTree(root);
    assert.equal(c.files, 2);
    assert.equal(c.bytes, 15);
  } finally { cleanup(root); }
});

// ── mechanical re-anchor + freshness gate (gap-quay-init-closure-ratchet-manual-reanchor-recurs) ────

test("fingerprintOf is order-independent and content-sensitive", () => {
  const a = [
    { rel: "plugin/scripts/x.sh", sha: "1" },
    { rel: "plugin/scripts/y.ts", sha: "2" },
  ];
  const b = [
    { rel: "plugin/scripts/y.ts", sha: "2" },
    { rel: "plugin/scripts/x.sh", sha: "1" },
  ];
  assert.equal(fingerprintOf(a), fingerprintOf(b), "the fingerprint must not depend on entry order");
  const c = [
    { rel: "plugin/scripts/x.sh", sha: "1" },
    { rel: "plugin/scripts/y.ts", sha: "3" },
  ];
  assert.notEqual(fingerprintOf(a), fingerprintOf(c), "a changed source hash must change the fingerprint");
});

// makeStaleFixture — a hermetic root carrying the FOUR laydown-source files the post-shrink
// collectSourceEntries fingerprints (plugin/scripts/quay-init.sh + the two verbatim templates +
// plugin.json), so --check-stale runs against a controlled source set, not the real quay-init mechanism.
function makeStaleFixture(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `qicr-${prefix}-`));
  fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "plugin", ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "plugin", ".claude"), { recursive: true });
  fs.mkdirSync(path.join(root, "plugin", ".claude-plugin"), { recursive: true });
  fs.writeFileSync(path.join(root, "plugin", "scripts", "quay-init.sh"), "#!/usr/bin/env bash\n");
  fs.writeFileSync(path.join(root, "plugin", ".quay", "profiles.yml"), "version: 1\n");
  fs.writeFileSync(path.join(root, "plugin", ".claude", "launch.settings.json"), "{}\n");
  fs.writeFileSync(path.join(root, "plugin", ".claude-plugin", "plugin.json"), '{"name":"quay"}\n');
  return root;
}

// AC3 — the freshness gate reds at the CHANGER's own gate when a laydown source changed but the
// baseline was not re-anchored, and greens again after a mechanical re-anchor.
test("AC3 — --check-stale reds on a changed laydown source with no re-anchor, greens after re-anchor", () => {
  const root = makeStaleFixture("stale");
  try {
    const checker = path.join(REPO_ROOT, "plugin", "scripts", "quay-init-closure-ratchet.ts");
    const runStale = () =>
      spawnSync("node", ["--no-warnings", "--experimental-strip-types", checker, "--check-stale", "--root", root], { encoding: "utf8" });

    // re-anchor: record a baseline whose fingerprint matches the current source (the mechanical action).
    let entries = collectSourceEntries(root);
    assert.ok(entries && entries.length > 0, "the fixture must derive a non-empty source set");
    writeBaseline(root, { files: 0, bytes: 0, fingerprint: fingerprintOf(entries), sources: entries });

    let res = runStale();
    assert.equal(res.status, 0, `a fresh fixture must exit 0, got ${res.status}: ${res.stdout}${res.stderr}`);

    // INJECT: change a laydown source file WITHOUT re-anchoring.
    fs.writeFileSync(path.join(root, "plugin", ".claude", "launch.settings.json"), '{"changed":true}\n');
    res = runStale();
    assert.equal(res.status, 1, `a stale source must exit 1, got ${res.status}: ${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /re-anchor required/, "the re-anchor remedy must be named in the stale output");
    assert.match(res.stdout, /launch\.settings\.json/, "the changed source file must be enumerated (hard rule 3)");

    // RESTORE via a mechanical re-anchor → green again.
    entries = collectSourceEntries(root);
    writeBaseline(root, { files: 0, bytes: 0, fingerprint: fingerprintOf(entries), sources: entries });
    res = runStale();
    assert.equal(res.status, 0, `a re-anchored fixture must exit 0, got ${res.status}: ${res.stdout}${res.stderr}`);
  } finally {
    cleanup(root);
  }
});

// AC4 negative control — the byte ratchet is NOT relaxed into constant-true by the baseline-file
// refactor: --gate with a COMMITTED baseline below the real laydown must still red on the file axis.
// (Same fake-laydown shape as checker-mutation-cases/quay-init-closure-ratchet.sh, but exercising the
// committed-baseline read path — no --baseline-files/--baseline-bytes overrides.)
test("AC4 — --gate still reds on real growth past the committed baseline (not relaxed to constant-true)", () => {
  const root = makeTmp("gate-neg");
  try {
    const checker = path.join(REPO_ROOT, "plugin", "scripts", "quay-init-closure-ratchet.ts");
    fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
    // A fake quay-init.sh that lays down 3 files × 10 bytes = 30 bytes into the --root target.
    fs.writeFileSync(
      path.join(root, "plugin", "scripts", "quay-init.sh"),
      `#!/usr/bin/env bash
_root=""
while [ $# -gt 0 ]; do
  case "$1" in
    --root) _root="$2"; shift 2 ;;
    *) shift ;;
  esac
done
mkdir -p "$_root/plugin/scripts"
_i=1
while [ "$_i" -le 3 ]; do
  printf '0123456789' > "$_root/plugin/scripts/f$_i.txt"
  _i=$((_i + 1))
done
exit 0
`,
    );
    // Committed baseline of 2 files / 20 bytes — BELOW the real 3 / 30 ⇒ the ratchet MUST red.
    writeBaseline(root, { files: 2, bytes: 20, fingerprint: "test", sources: [] });
    const res = spawnSync("node", ["--no-warnings", "--experimental-strip-types", checker, "--gate", "--root", root], { encoding: "utf8" });
    assert.equal(res.status, 1, `--gate must red on growth past the committed baseline, got ${res.status}: ${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /GREW past/, "the growth failure message must name the violation");
  } finally {
    cleanup(root);
  }
});
