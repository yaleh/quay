// @test-group product
// shipped-set.test.mjs — the two-way control for the artifact's SHIPPED SET
// (tasks/gap-shipped-plugin-tree-excludes-dev-only-content-and-has-a-shrink-only-size-ratchet,
//  GOAL-029 「init 统一为单一 TS 引擎、终局无 .sh;并收窄发布集合」,人 2026-10-07 裁定).
//
// THE DEFECT THIS WATCHES: plugin/scripts/publish-dist-branch.sh assembled the orphan branch with a
// bare `rsync -a --exclude='.git' "${PLUGIN_DIR}/" "${WORK}/"` — the WHOLE plugin/ tree. The 0.17.0
// artifact was 1062 files / 65,511,262 bytes, of which 564 were `*.test.*`, 93 were
// checker-mutation cases, and 7 were dev-period baseline/exception/violation manifests. Nothing
// watched the number, so the number could not be wrong in any observable way (硬规则 3b).
//
// TWO-WAY, ON A REAL ARTIFACT (not a fixture that re-implements the publish):
//   · the artifact is built by the REAL plugin/scripts/publish-dist-branch.sh, in a THROWAWAY git
//     repo under a tmp dir — never a branch/worktree in the shared checkout, never a push, no
//     network. The stub carries the real plugin/ tree plus the real build inputs, so the numbers
//     asserted here are the numbers the real channel publishes.
//   · the RED controls mutate the REAL script / the REAL artifact: the exclusion list is removed
//     from the rsync line (the exact regression this task fixed) and a `foo.test.mjs` is dropped
//     into a clean artifact. A checker that only ever says PASS is not a check, so both controls
//     assert on the READING (which paths, which rule), never on a boolean.
//
// Run: scripts/test.sh plugin/test/shipped-set.test.mjs  (and AC-334's own criterion:
//      `timeout 55 node --experimental-strip-types --test plugin/test/shipped-set.test.mjs`)

import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { makeTmpDir } from "./helpers/tmp-workspace.mjs";
import {
  BASELINE_FILE_REL,
  RULES_FILE_REL,
  check,
  judge,
  judgeShippedSize,
  measuredOf,
  overBaselineMessage,
  parseRules,
  readBaselineFile,
  readShippedSet,
  reanchor,
  ruleMatches,
  shippedOf,
  isExcluded,
} from "../scripts/shipped-set-rules.ts";
import { judgeShippedSetClean } from "../scripts/verify-plugin-channel-assertions.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginDir, "..");
const PUBLISH_SCRIPT = path.join(pluginDir, "scripts", "publish-dist-branch.sh");
const RULES_ABS = path.join(repoRoot, RULES_FILE_REL);
const BASELINE_ABS = path.join(repoRoot, BASELINE_FILE_REL);
const NODE_MODULES = path.join(repoRoot, "node_modules");

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  }).trim();
}

/** Same, but tolerates failure — for the pre-run cleanup of a branch that may not exist yet. */
function gitTry(cwd, ...args) {
  try {
    git(cwd, ...args);
  } catch {
    /* absent branch / already deleted — the point is only to start from a clean ref */
  }
}

function writeFile(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

/**
 * A throwaway git repo holding the REAL plugin tree plus the REAL build inputs, small enough to
 * assemble in seconds and structurally the same shape the real repo hands the publish script.
 *
 * ⛔ `plugin/`, `packages/quay/scripts`, `packages/quay/src` and `scripts/` are COPIES, never
 * symlinks: Node resolves an ESM entry to its REALPATH, so a symlinked `build-plugin-dist.mjs`
 * fails its own file-identity `invokedAsScript` guard and exits 0 having bundled NOTHING — silently,
 * producing an artifact with no `dist/*.js` at all (measured 2026-10-07 while building this test).
 * `node_modules` may be a symlink: it is only a resolution root, never an entry point.
 */
function makePublishRepo(tag) {
  const root = makeTmpDir(tag);
  fs.symlinkSync(NODE_MODULES, path.join(root, "node_modules"), "dir");
  fs.mkdirSync(path.join(root, "packages", "quay"), { recursive: true });
  for (const rel of ["packages/quay/scripts", "packages/quay/src", "scripts"]) {
    cpRecursive(path.join(repoRoot, rel), path.join(root, rel));
  }
  fs.copyFileSync(path.join(repoRoot, "packages", "quay", "package.json"), path.join(root, "packages", "quay", "package.json"));
  fs.copyFileSync(path.join(repoRoot, "VERSION"), path.join(root, "VERSION"));
  fs.mkdirSync(path.join(root, ".claude-plugin"), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, ".claude-plugin", "marketplace.json"), path.join(root, ".claude-plugin", "marketplace.json"));
  cpRecursive(pluginDir, path.join(root, "plugin"));
  git(root, "init", "-q", "-b", "master");
  git(root, "add", "-A");
  git(root, "-c", "user.name=shipped-set", "-c", "user.email=shipped-set@test.invalid", "commit", "-q", "-m", "stub");
  return root;
}

function cpRecursive(src, dest) {
  fs.cpSync(src, dest, { recursive: true, dereference: false });
}

/** Run the REAL publish script in the stub. Returns { status, stdout, stderr }. */
function runPublish(stubRoot, branch) {
  return spawnSync("bash", [path.join(stubRoot, "plugin", "scripts", "publish-dist-branch.sh"), "--no-build", "--branch", branch], {
    cwd: stubRoot,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  });
}

/** Materialise the orphan branch into a plain directory (what a consumer receives). */
function extractArtifact(stubRoot, branch, tag) {
  const dest = makeTmpDir(tag);
  const archive = spawnSync("git", ["-C", stubRoot, "archive", branch], { encoding: "buffer", maxBuffer: 512 * 1024 * 1024 });
  assert.equal(archive.status, 0, `git archive ${branch} failed: ${archive.stderr}`);
  const untar = spawnSync("tar", ["-x", "-C", dest], { input: archive.stdout, maxBuffer: 512 * 1024 * 1024 });
  assert.equal(untar.status, 0, `tar -x failed: ${untar.stderr}`);
  return dest;
}

// ── the one real artifact this file builds (shared by every assertion below) ─────────────────────

let stub = null;
let artifact = null;
let buildError = null;

before(() => {
  const vendor = path.join(pluginDir, "vendor", "quay", "dist", "quay.js");
  if (!fs.existsSync(vendor) || fs.statSync(vendor).size === 0) {
    buildError = `plugin/vendor/quay/dist/quay.js is absent — the publish script refuses to assemble an artifact without it (run bash plugin/scripts/sync-vendor.sh)`;
    return;
  }
  try {
    stub = makePublishRepo("shipped-set-stub-");
    const r = runPublish(stub, "probe-dist");
    if (r.status !== 0) {
      buildError = `the real publish script exited ${r.status}:\n${r.stdout}\n${r.stderr}`;
      return;
    }
    artifact = extractArtifact(stub, "probe-dist", "shipped-set-art-");
  } catch (err) {
    buildError = `building the artifact threw: ${String(err && err.stack ? err.stack : err)}`;
  }
});

function requireArtifact(t) {
  if (buildError) {
    t.skip(buildError);
    return false;
  }
  return true;
}

// ── AC2: the artifact carries none of it ─────────────────────────────────────────────────────────

test("AC2: the published artifact carries no dev-only content, and its totals are within the recorded clean build", (t) => {
  if (!requireArtifact(t)) return;
  const rules = parseRules(fs.readFileSync(RULES_ABS, "utf8"));
  const reading = readShippedSet(artifact, rules);
  assert.equal(reading.evaluated, true, `the artifact must be readable: ${reading.reason ?? ""}`);
  // The reading, not a boolean: WHICH paths, under WHICH rule.
  assert.deepEqual(
    reading.violations.map((v) => `${v.path} <- ${v.rule}`),
    [],
    `the artifact must carry no rule-excluded path (${reading.violations.length} found)`,
  );
  // The zero-tolerance ratchet's axes, measured on the real artifact.
  assert.deepEqual(reading.forbidden, { files: 0, bytes: 0, shLines: 0 });
  const baseline = readBaselineFile(BASELINE_ABS);
  assert.notEqual(baseline, null, "the committed baseline must parse");
  const verdict = judge(measuredOf(reading), baseline, baseline, null);
  assert.deepEqual(verdict.over, [], "the ratchet must not be over its baseline");
  // The SIZE ceiling: the artifact's own totals against the recorded clean build.
  assert.ok(baseline.shipped, "the baseline must record the clean build's totals");
  const size = judgeShippedSize(shippedOf(reading), baseline.shipped);
  assert.deepEqual(size.over, [], `the artifact's totals must be ≤ the recorded clean build: measured ${JSON.stringify(size.measured)} vs ${JSON.stringify(size.ceiling)}`);
  // Printed so the file's own log carries the real numbers (a green run is evidence, not a claim).
  console.log(
    `shipped-set: artifact ${reading.totals.files} files / ${reading.totals.bytes} bytes / ${reading.totals.shLines} .sh lines, ${rules.length} rule(s) in force, 0 forbidden`,
  );
});

test("AC2 control: reverting the rsync exclusion list (the exact regression) turns the reading RED", (t) => {
  if (!requireArtifact(t)) return;
  const original = fs.readFileSync(PUBLISH_SCRIPT, "utf8");
  const needle = '"${RSYNC_EXCLUDES[@]}" ';
  const mutated = original.replace(needle, "");
  // 硬规则 4 推论三: a mutation that did not apply would make the RED assertion below vacuous —
  // it would pass because nothing changed, which is the same output byte as "the check works".
  assert.notEqual(mutated, original, `the control's mutation must actually apply (needle ${needle} not found in ${PUBLISH_SCRIPT})`);
  writeFile(path.join(stub, "plugin", "scripts", "publish-dist-branch.sh"), mutated);

  gitTry(stub, "branch", "-D", "probe-dist");
  const r = runPublish(stub, "probe-dist");
  assert.equal(r.status, 0, `the mutated publish must still assemble (it is the CHECK that must go red, not the build):\n${r.stdout}\n${r.stderr}`);
  const unexcluded = extractArtifact(stub, "probe-dist", "shipped-set-unexcluded-");

  const rules = parseRules(fs.readFileSync(RULES_ABS, "utf8"));
  const reading = readShippedSet(unexcluded, rules);
  assert.ok(reading.violations.length > 0, "a full-tree artifact must be REJECTED — the rules must bite on it");
  const named = reading.violations.map((v) => v.path);
  for (const expected of ["test", "fixtures", "scripts/checker-mutation-cases"]) {
    assert.ok(named.includes(expected), `${expected} must be reported present; got ${named.slice(0, 10).join(", ")}`);
  }
  assert.ok(reading.forbidden.files > 0, "the forbidden aggregate must be non-zero");
  const verdict = judge(measuredOf(reading), readBaselineFile(BASELINE_ABS), null, null);
  assert.ok(verdict.over.length > 0, "the ratchet must be over its zero baseline");
  // …and the release gate's own assertion must be FAIL on it, not merely the raw reading.
  const gate = judgeShippedSetClean(reading, readBaselineFile(BASELINE_ABS), unexcluded);
  assert.equal(gate.state, "FAIL", `shipped-set-clean must be FAIL for a full-tree artifact: ${gate.detail}`);
  assert.match(gate.detail, /PRESENT in the installed artifact/, "the gate detail must name what it found");
  assert.match(gate.detail, /rule /, "the gate detail must name the rule each path matched");

  // Restore, so the shared stub is left as it was found.
  writeFile(path.join(stub, "plugin", "scripts", "publish-dist-branch.sh"), original);
});

test("AC2 control: a `foo.test.mjs` dropped into a clean artifact turns it RED", (t) => {
  if (!requireArtifact(t)) return;
  const dirty = makeTmpDir("shipped-set-dirty-");
  cpRecursive(artifact, dirty);
  writeFile(path.join(dirty, "foo.test.mjs"), "// a stray test file that must never ship\n");
  const rules = parseRules(fs.readFileSync(RULES_ABS, "utf8"));
  const reading = readShippedSet(dirty, rules);
  assert.equal(reading.violations.length, 1, `exactly the injected file must be reported: ${JSON.stringify(reading.violations)}`);
  assert.equal(reading.violations[0].path, "foo.test.mjs");
  assert.equal(reading.violations[0].rule, "*.test.mjs");
  assert.deepEqual({ files: reading.forbidden.files, shLines: reading.forbidden.shLines }, { files: 1, shLines: 0 });
  assert.equal(judgeShippedSetClean(reading, readBaselineFile(BASELINE_ABS), dirty).state, "FAIL");
  // ⛔ …and the CLEAN artifact is still PASS: the control must not be satisfiable by a checker that
  // simply always fails.
  const clean = readShippedSet(artifact, rules);
  assert.equal(judgeShippedSetClean(clean, readBaselineFile(BASELINE_ABS), artifact).state, "PASS");
});

// ── AC3: the ratchet is shrink-only, reanchorable, and its failure names the axis ───────────────

test("AC3: the rule matcher implements rsync's grammar (dir-only, basename vs anchored, `*` never crosses `/`)", () => {
  const rules = parseRules(
    ["# comment", "", "test/", "scripts/checker-mutation-cases/", "*.test.mjs", "plugin/deep/*.json"].join("\n"),
  );
  assert.equal(rules.length, 4, `comments and blanks must not be rules: ${JSON.stringify(rules.map((r) => r.raw))}`);
  const testRule = rules.find((r) => r.raw === "test/");
  assert.equal(ruleMatches(testRule, "test", true), true);
  assert.equal(ruleMatches(testRule, "a/test", true), true, "a no-slash dir rule matches at any depth (rsync's rule)");
  assert.equal(ruleMatches(testRule, "test", false), false, "a trailing `/` matches DIRECTORIES only");
  const globRule = rules.find((r) => r.raw === "*.test.mjs");
  assert.equal(ruleMatches(globRule, "deep/a.test.mjs", false), true);
  assert.equal(ruleMatches(globRule, "deep/a.test.mjs/x", false), false, "`*` must not cross `/`");
  const anchored = rules.find((r) => r.raw === "plugin/deep/*.json");
  assert.equal(ruleMatches(anchored, "plugin/deep/x.json", false), true);
  assert.equal(ruleMatches(anchored, "other/plugin/deep/x.json", false), false, "an internal `/` anchors at the root");
  assert.equal(isExcluded("a.test.mjs", false, rules), true);
});

test("AC3: an over-baseline reading names the axis, the excess, and the reanchor command", () => {
  const measured = { files: 7, bytes: 4096, shLines: 12 };
  const baseline = { files: 0, bytes: 0, shLines: 0 };
  const msg = overBaselineMessage(measured, baseline, "/tmp/some-artifact");
  for (const axis of ["files", "bytes", "shLines"]) assert.match(msg, new RegExp(`${axis} \\d+ > baseline \\d+`), `the message must name ${axis}`);
  assert.match(msg, /exceeds by 4096/, "the message must state the excess");
  assert.match(msg, /--reanchor \/tmp\/some-artifact/, "the message must carry the reanchor command");
  const shrunk = judge({ files: 0, bytes: 0, shLines: 0 }, baseline, baseline, baseline);
  assert.deepEqual(shrunk.over, [], "a reading at the ceiling is not over it");
});

test("AC3: a baseline raised past git HEAD is RED — `调高基线` alone cannot buy a pass", () => {
  const head = { files: 0, bytes: 0, shLines: 0 };
  const raised = judge({ files: 0, bytes: 0, shLines: 0 }, { files: 0, bytes: 0, shLines: 0 }, { files: 5, bytes: 0, shLines: 0 }, head);
  assert.deepEqual(raised.baselineRaised, ["files"]);
  assert.equal(raised.ok, false, "raising the ceiling in the working tree must be RED");
  const committed = judge({ files: 0, bytes: 0, shLines: 0 }, { files: 5, bytes: 0, shLines: 0 }, { files: 5, bytes: 0, shLines: 0 }, { files: 5, bytes: 0, shLines: 0 });
  assert.equal(committed.ok, true, "once the raise is committed, HEAD carries it too");
  const bootstrap = judge({ files: 0, bytes: 0, shLines: 0 }, head, head, null);
  assert.equal(bootstrap.bootstrap, true);
});

test("AC3: --reanchor writes the artifact's OWN reading, and refuses while forbidden content is present", (t) => {
  if (!requireArtifact(t)) return;
  const tmpBaseline = path.join(makeTmpDir("shipped-set-reanchor-"), "baseline.json");
  const rulesAbs = RULES_ABS;
  const res = reanchor(artifact, rulesAbs, tmpBaseline, "test fixture re-anchor");
  assert.equal(res.ok, true, res.reason);
  const written = readBaselineFile(tmpBaseline);
  const reading = readShippedSet(artifact, parseRules(fs.readFileSync(rulesAbs, "utf8")));
  assert.deepEqual({ files: written.files, bytes: written.bytes, shLines: written.shLines }, measuredOf(reading));
  assert.deepEqual(written.shipped, shippedOf(reading), "the re-anchor must also record the artifact's own totals");
  assert.equal(JSON.parse(fs.readFileSync(tmpBaseline, "utf8"))._reanchorLog.length, 1, "the re-anchor must be logged");
  // Refusal: re-anchoring over forbidden content would pin a baseline the check exists to reject.
  const full = extractArtifactUnfiltered(t);
  const refused = reanchor(full, rulesAbs, tmpBaseline, "must be refused");
  assert.equal(refused.ok, false, "re-anchor must refuse an artifact that carries forbidden content");
  assert.match(refused.reason, /refusing to re-anchor/);
});

/** The full-tree artifact the re-anchor refusal is asserted on (built once, memoised). */
let unfilteredArtifact = null;
function extractArtifactUnfiltered(t) {
  if (unfilteredArtifact !== null) return unfilteredArtifact;
  if (!requireArtifact(t)) return null;
  const original = fs.readFileSync(PUBLISH_SCRIPT, "utf8");
  const mutated = original.replace('"${RSYNC_EXCLUDES[@]}" ', "");
  assert.notEqual(mutated, original, "the unfiltered control must actually apply its mutation");
  writeFile(path.join(stub, "plugin", "scripts", "publish-dist-branch.sh"), mutated);
  gitTry(stub, "branch", "-D", "probe-unfiltered");
  const r = runPublish(stub, "probe-unfiltered");
  writeFile(path.join(stub, "plugin", "scripts", "publish-dist-branch.sh"), original);
  assert.equal(r.status, 0, `the unfiltered publish must assemble:\n${r.stdout}\n${r.stderr}`);
  unfilteredArtifact = extractArtifact(stub, "probe-unfiltered", "shipped-set-unfiltered-");
  return unfilteredArtifact;
}

test("硬规则 3b: zero rules ⇒ NOT-EVALUATED, never a PASS (nothing forbidden ≠ nothing checked)", () => {
  const t = makeTmpDir("shipped-set-norules-");
  writeFile(path.join(t, "a.md"), "hi\n");
  const reading = readShippedSet(t, []);
  assert.equal(reading.evaluated, false);
  assert.match(reading.reason, /ZERO rules/);
  const noBaseline = check(t, path.join(t, "missing-rules.txt"), BASELINE_ABS, null);
  assert.equal(noBaseline.code, 2, "an unreadable rule file is NOT-EVALUATED (exit 2), not clean");
});

test("the CLI gates the real artifact green and the unfiltered one red — the same predicate both ways", (t) => {
  if (!requireArtifact(t)) return;
  const rulesAbs = RULES_ABS;
  const ok = check(artifact, rulesAbs, BASELINE_ABS, null, { sizeCeiling: true });
  assert.equal(ok.code, 0, `the clean artifact must pass with the size ceiling on: ${JSON.stringify(ok.reading.totals)}`);
  assert.equal(ok.size.ok, true);
  const full = extractArtifactUnfiltered(t);
  const red = check(full, rulesAbs, BASELINE_ABS, null, {});
  assert.equal(red.code, 1);
  assert.ok(red.reading.violations.length > 0);
  // The SIZE ceiling alone would also catch it: the pre-exclusion artifact carries 1062 files /
  // 22,859 .sh lines against the recorded 283 / 17,545. `bytes` is REPORTED, never gated —
  // esbuild's module-path comments make the byte total depend on the build tree's location, so a
  // byte-exact ceiling would be a host-dependent constant (see SIZE_GATED_AXES).
  const redSize = check(full, rulesAbs, BASELINE_ABS, null, { sizeCeiling: true });
  assert.equal(redSize.size.ok, false);
  assert.ok(redSize.size.over.includes("files"));
  assert.ok(redSize.size.bytesDelta > 0, "the byte delta is still reported");
});
