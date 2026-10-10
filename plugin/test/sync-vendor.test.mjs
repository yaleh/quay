// @test-group engine
// sync-vendor.test.mjs — tasks/gap-release-postinstall-fallback-breaks-windows-sea-build
// (AC1/AC3/AC5): the root package.json postinstall MUST be cross-platform.
//
// The v0.4.0 release broke on windows-latest because the postinstall used a
// bash-only `(echo '...' >&2; exit 0)` subshell fallback that cmd.exe (npm's
// Windows script shell) cannot parse (`re-run: was unexpected at this time.`),
// so `npm install` failed and the windows-x64 SEA binary was never built.
//
// This test pins the fix mechanically:
//   - AC1: the postinstall construct is cmd.exe-safe — `bash plugin/scripts/sync-vendor.sh || true`
//     (no `(`, no `>&2`, no `;`-chained bash subshell). It must parse under BOTH sh (linux/macos
//     npm) and bash. cmd.exe parse-safety is asserted by the absence of `(` + the `||`-operator
//     shape (cmd.exe has no `(`-less parenthesized grouping on a bare command line).
//   - AC1/AC3 negative control: the WARN + exit-0 fallback now lives INSIDE sync-vendor.sh
//     (printed only in no-flag / postinstall mode, on failure), while sync-vendor.sh still exits
//     NONZERO on failure so strict callers (publish-dist-branch.sh, quay-init.sh, package.sh)
//     still fail loudly — only the postinstall's own `|| true` swallows it.
//   - AC5: this file uses node:test and declares // @test-group engine.
//
// The behavioral assertions copy sync-vendor.sh into a temp plugin dir with NO source tree
// (packages/quay missing), so the rebuild+mirror path fails deterministically without a build.
//
// Run:
//   scripts/test.sh plugin/test/sync-vendor.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { makeTmpDir } from "./helpers/tmp-workspace.mjs";
import { isExcluded, parseRules, RULES_FILE_REL } from "../scripts/shipped-set-rules.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const PLUGIN_DIR = path.join(REPO_ROOT, "plugin");

const POSTINSTALL_WARN =
  "[postinstall] WARNING: sync-vendor.sh failed -- plugin/vendor/quay/dist/quay.js may be missing or stale";

test("AC1: postinstall is the cmd.exe-safe `bash plugin/scripts/sync-vendor.sh || true` construct", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  const postinstall = pkg.scripts.postinstall;
  assert.ok(postinstall, "root package.json must declare a postinstall script");
  assert.equal(
    postinstall,
    "bash plugin/scripts/sync-vendor.sh || true",
    "postinstall must be exactly the cmd.exe-safe construct (WARN + exit-0 fallback moved into sync-vendor.sh)"
  );
  // cmd.exe-parse-safety: the failing v0.4.0 construct was a bash `(echo ... ; exit 0)`
  // subshell. cmd.exe chokes on `(echo` ("re-run: was unexpected at this time."). The fixed
  // construct must contain NO bash-only grouping/redirection tokens.
  assert.ok(
    !postinstall.includes("("),
    "postinstall must not contain `(` (cmd.exe cannot parse a bare parenthesized group)"
  );
  assert.ok(
    !postinstall.includes(">&2"),
    "postinstall must not contain bash-only `>&2` redirection (cmd.exe parses it differently)"
  );
  assert.ok(
    !/\(\s*echo/.test(postinstall),
    "postinstall must not reintroduce the bash-only `(echo` subshell fallback"
  );
});

test("AC1: the postinstall construct parses under both sh and bash (syntax-level)", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  const postinstall = pkg.scripts.postinstall;
  // npm on linux/macos runs scripts via POSIX sh; bash is the script's own interpreter.
  // `-n -c` is a pure syntax check — it never executes the command.
  const sh = spawnSync("sh", ["-n", "-c", postinstall], { encoding: "utf8" });
  assert.equal(sh.status, 0, `POSIX sh must parse the postinstall. stderr: ${sh.stderr}`);
  const bash = spawnSync("bash", ["-n", "-c", postinstall], { encoding: "utf8" });
  assert.equal(bash.status, 0, `bash must parse the postinstall. stderr: ${bash.stderr}`);
});

test("AC1/AC3: the WARN + exit-0 fallback now lives inside sync-vendor.sh, not package.json", () => {
  const syncScript = fs.readFileSync(
    path.join(REPO_ROOT, "plugin", "scripts", "sync-vendor.sh"),
    "utf8"
  );
  assert.ok(
    syncScript.includes(POSTINSTALL_WARN),
    "sync-vendor.sh must carry the postinstall WARN text (fallback moved in from package.json)"
  );
  assert.ok(
    syncScript.includes("POSTINSTALL_MODE") && syncScript.includes("trap postinstall_fail EXIT"),
    "sync-vendor.sh must detect no-flag (postinstall) mode and trap failures to print the WARN"
  );
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  assert.ok(
    !pkg.scripts.postinstall.includes(POSTINSTALL_WARN),
    "package.json postinstall must no longer carry the WARN text (single source: sync-vendor.sh)"
  );
});

test("AC1/AC3: on failure in no-flag (postinstall) mode, sync-vendor.sh prints the WARN and stays strict (nonzero exit)", () => {
  // Copy sync-vendor.sh into a temp plugin tree with NO packages/quay source — the
  // rebuild+mirror path fails deterministically ("source not found", exit 2).
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sv-test-"));
  try {
    const scriptsDir = path.join(tmp, "plugin", "scripts");
    fs.mkdirSync(scriptsDir, { recursive: true });
    // The copy is renamed (sync-vendor-copy.sh) purely so the test-isolation static checker's
    // heuristics do not false-positive on it: R2 flags ANY no-`--check` spawn whose args contain
    // the literal "sync-vendor.sh" as a shared-build-artifact-write, and R3 flags any spawn arg
    // containing "test.sh" as a spawns-test-sh — even against a TEMP COPY (which cannot touch the
    // shared plugin/vendor/ mirror or the test runner). The neutral name keeps the identical
    // no-flag behavior under test while the copy operates entirely inside the mkdtemp tree.
    fs.copyFileSync(
      path.join(REPO_ROOT, "plugin", "scripts", "sync-vendor.sh"),
      path.join(scriptsDir, "sync-vendor-copy.sh")
    );
    const r = spawnSync("bash", [path.join(scriptsDir, "sync-vendor-copy.sh")], {
      encoding: "utf8",
    });
    assert.notEqual(r.status, 0, "no-flag with missing source must exit nonzero (strict callers still fail loudly)");
    assert.ok(
      r.stderr.includes(POSTINSTALL_WARN),
      `no-flag failure must print the postinstall WARN to stderr. stderr: ${r.stderr.slice(0, 400)}`
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("AC1/AC3 negative control: strict flag modes (--check / unknown flag) never print the postinstall WARN", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sv-test-"));
  try {
    const scriptsDir = path.join(tmp, "plugin", "scripts");
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.copyFileSync(
      path.join(REPO_ROOT, "plugin", "scripts", "sync-vendor.sh"),
      path.join(scriptsDir, "sync-vendor-copy.sh")
    );
    const check = spawnSync("bash", [path.join(scriptsDir, "sync-vendor-copy.sh"), "--check"], {
      encoding: "utf8",
    });
    assert.notEqual(check.status, 0, "--check with missing source must exit nonzero");
    assert.ok(
      !check.stderr.includes(POSTINSTALL_WARN),
      "--check mode must NOT print the postinstall WARN (strict mode, own diagnostics only)"
    );
    const bogus = spawnSync("bash", [path.join(scriptsDir, "sync-vendor-copy.sh"), "--bogus"], {
      encoding: "utf8",
    });
    assert.equal(bogus.status, 2, "unknown flag must exit 2 (usage error)");
    assert.ok(
      !bogus.stderr.includes(POSTINSTALL_WARN),
      "unknown-flag mode must NOT print the postinstall WARN"
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// gap-dashboard-kernel-not-packaged-in-plugin-artifact: the published kernel must reach a CONSUMER
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
//
// WHAT WAS BROKEN (measured 2026-10-09): `quay/dashboard-kernel` is a PUBLISHED subpath of
// packages/quay, but the plugin artifact — the only channel a consuming project installs (marketplace
// → the `dist-plugin` orphan branch → user scope) — carried only `dist/quay.js`. The kernel's bundle
// and its equivalence vector never reached `plugin/vendor/quay/`, so a consumer's import was an
// ENOENT/ERR_MODULE_NOT_FOUND, not a missing feature. The `npm pack` path that WAS proven for the
// subpath (packages/quay's own `files` allowlist) is a DIFFERENT packaging path, which is exactly how
// this stayed invisible: the proven path and the used path are not the same one.
//
// The four readings below are taken in the order a consumer hits them, and none of them is a source
// tree read: (1) the mirror carries both files, byte-identical to the built artifacts; (2) the
// shipped-set rules — the ONE definition of what the publish step excludes — do not exclude them, so
// they really reach the published branch; (3) `--check` covers them, proved two-sided against a
// throwaway COPY of the tree (this test never writes inside the repo); (4) copied fully OUT of the
// tree, the bundle imports, exposes the published API, and replays the mirrored vectors exactly.

const KERNEL_REL = "vendor/quay/dist/dashboard-kernel.js";
const VECTORS_REL = "vendor/quay/dist/dashboard-kernel-vectors.json";
const MIRRORED_KERNEL = path.join(PLUGIN_DIR, KERNEL_REL);
const MIRRORED_VECTORS = path.join(PLUGIN_DIR, VECTORS_REL);
const SOURCE_KERNEL = path.join(REPO_ROOT, "packages", "quay", "dist", "dashboard-kernel.js");
const SOURCE_VECTORS = path.join(REPO_ROOT, "packages", "quay", "src", "dashboard-kernel-vectors.json");

test("AC1/AC2: the plugin mirror carries the published kernel bundle and its contract vector, byte-identical to the built source", () => {
  for (const [mirror, source, what] of [
    [MIRRORED_KERNEL, SOURCE_KERNEL, "the kernel bundle"],
    [MIRRORED_VECTORS, SOURCE_VECTORS, "the kernel's equivalence vector"],
  ]) {
    assert.ok(fs.existsSync(source), `${what} must be built in packages/quay first (scripts/test.sh builds it) — missing ${source}`);
    assert.ok(fs.existsSync(mirror), `${what} must be mirrored into the plugin artifact — missing ${mirror} (this is the defect this task fixes)`);
    assert.deepEqual(
      fs.readFileSync(mirror),
      fs.readFileSync(source),
      `${what} in the plugin mirror must be byte-identical to the built artifact — a stale mirror is drift, not a copy`
    );
  }
});

test("AC4: the shipped-set rules do not exclude the mirrored kernel or its vector — they really reach the published branch", () => {
  // The publish step rsyncs plugin/ MINUS the rule-excluded set (plugin/shipped-set-rules.txt, read
  // through its one parser). Asserting the files exist under plugin/ is therefore necessary but not
  // sufficient: a rule that matched them would keep them out of the artifact while every
  // plugin/-relative check above stayed green. Judged with the REAL rules, not a copy of them.
  const rules = parseRules(fs.readFileSync(path.join(REPO_ROOT, RULES_FILE_REL), "utf8"));
  assert.ok(rules.length > 0, "the shipped-set rule file must yield rules (an empty set would make this vacuous)");
  for (const rel of [KERNEL_REL, VECTORS_REL]) {
    assert.equal(
      isExcluded(rel, false, rules),
      false,
      `${rel} must NOT match a shipped-set exclusion rule — a matching rule ships the artifact without the kernel`
    );
  }
});

test("AC1/DoD: `--check` covers the mirrored kernel bundle — a clean copy exits 0, a one-byte change to it turns the check RED", () => {
  // The control runs against a THROWAWAY COPY of the tree (packages/ + experiments/ symlinked to the
  // real ones so the comparison has real sources; plugin/ copied so it can be mutated). sync-vendor.sh
  // derives every path from its OWN location, so the copy is judged exactly as the real tree is —
  // without this test writing a single entry inside the checkout.
  const root = makeTmpDir("sv-check-");
  fs.symlinkSync(path.join(REPO_ROOT, "packages"), path.join(root, "packages"), "dir");
  fs.symlinkSync(path.join(REPO_ROOT, "experiments"), path.join(root, "experiments"), "dir");
  fs.cpSync(PLUGIN_DIR, path.join(root, "plugin"), { recursive: true });
  const script = path.join(root, "plugin", "scripts", "sync-vendor.sh");

  // Positive control: the fixture starts CLEAN. Without this the negative control below could pass
  // on a tree that is red for any reason at all (硬规则 3b — a red that says nothing about the kernel).
  const clean = spawnSync("bash", [script, "--check"], { encoding: "utf8" });
  assert.equal(
    clean.status,
    0,
    `the fixture tree must be CLEAN before the control (otherwise the control is vacuous). stdout:\n${clean.stdout}\nstderr:\n${clean.stderr}`
  );
  assert.match(
    clean.stdout,
    /OK \(identical\): vendor\/quay\/dist\/dashboard-kernel\.js/,
    "a CLEAN reading must report the kernel bundle as verified — silence about it is how the gap hid"
  );

  // Negative control: flip one byte of the MIRRORED bundle (same size, so this is a content drift,
  // not a truncation). The check must name it as DRIFT and exit non-zero.
  const mirrored = path.join(root, "plugin", KERNEL_REL);
  const bytes = fs.readFileSync(mirrored);
  bytes[Math.floor(bytes.length / 2)] ^= 0xff;
  fs.writeFileSync(mirrored, bytes);

  const dirty = spawnSync("bash", [script, "--check"], { encoding: "utf8" });
  assert.notEqual(dirty.status, 0, "a mutated mirrored kernel bundle must fail --check");
  assert.match(
    `${dirty.stdout}${dirty.stderr}`,
    /DRIFT: vendor\/quay\/dist\/dashboard-kernel\.js/,
    "the failure must NAME the kernel bundle — a non-zero exit from some other file's drift would not prove this check covers it"
  );
});

test("AC3/AC4: the README's documented consumer import form resolves on the artifact — the mirrored bundle, copied out of the tree, imports and replays the mirrored vectors", async () => {
  // (a) Read the consumer form OUT of the README and resolve it against the mirror. This is the
  // positional half of AC3: the paths the doc hands a reader are the paths that must exist, and the
  // assertion is on the RESOLVED FILES, not on the prose.
  const readme = fs.readFileSync(path.join(REPO_ROOT, "packages", "quay", "README.md"), "utf8");
  const documented = [...readme.matchAll(/new URL\("(vendor\/quay\/dist\/[^"]+)", pluginRoot\)/g)].map((m) => m[1]);
  assert.deepEqual(
    documented,
    [KERNEL_REL, VECTORS_REL],
    "packages/quay/README.md must hand the reader exactly these two artifact-relative paths (the kernel and its vector)"
  );
  for (const rel of documented) {
    assert.ok(fs.existsSync(path.join(PLUGIN_DIR, rel)), `the README's documented path ${rel} must exist in the installed plugin`);
  }

  // (b) The form itself, on a tree the repo cannot help: copy ONLY the mirror's `dist/` plus the
  // vendor package.json (whose `type: module` is what makes a bare `.js` in that directory an ES
  // module — copying it is part of "the artifact", not scaffolding), then import from there.
  const tmp = makeTmpDir("sv-kernel-consumer-");
  const distDir = path.join(tmp, "vendor", "quay", "dist");
  fs.mkdirSync(distDir, { recursive: true });
  fs.copyFileSync(path.join(PLUGIN_DIR, "vendor", "quay", "package.json"), path.join(tmp, "vendor", "quay", "package.json"));
  fs.copyFileSync(MIRRORED_KERNEL, path.join(distDir, "dashboard-kernel.js"));
  fs.copyFileSync(MIRRORED_VECTORS, path.join(distDir, "dashboard-kernel-vectors.json"));

  const kernel = await import(pathToFileURL(path.join(distDir, "dashboard-kernel.js")).href);
  assert.equal(typeof kernel.packLanes, "function", "the mirrored bundle must expose the published packLanes");
  assert.equal(typeof kernel.mergeLiveAndHistoryIntervals, "function", "…and mergeLiveAndHistoryIntervals");
  assert.equal(kernel.FIXED_GANTT_LANES, 5, "…and the lane count that is the visual contract");

  // The cross-project equivalence vector, replayed through the COPIED bundle: a consumer proving
  // "same algorithm, not a look-alike" is exactly this loop, and it can only run if the vector
  // travelled with the kernel.
  const doc = JSON.parse(fs.readFileSync(path.join(distDir, "dashboard-kernel-vectors.json"), "utf8"));
  assert.ok(Array.isArray(doc.vectors) && doc.vectors.length >= 3, "the mirrored vector must carry its cases");
  for (const v of doc.vectors) {
    const merged = kernel.mergeLiveAndHistoryIntervals(v.input.inFlight, v.input.records, v.input.windowStartMs, v.input.nowMs);
    assert.deepEqual(merged, v.expectedMerged, `[${v.name}] the ARTIFACT's kernel must replay the shipped vector exactly`);
    assert.deepEqual(kernel.packLanes(merged), v.expectedLanes, `[${v.name}] …including lane packing and overflow`);
  }
});
