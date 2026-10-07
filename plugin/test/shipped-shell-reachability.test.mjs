// @test-group product
// shipped-shell-reachability.test.mjs — the two-way control for WHICH `.sh` the artifact may carry
// (tasks/gap-shipped-shell-limited-to-runtime-reachable-set-and-delivery-verify-tools-leave-the-artifact,
//  GOAL-029 「init 统一为单一 TS 引擎、终局无 .sh;并收窄发布集合」,人 2026-10-07 裁定).
//
// THE DEFECT THIS WATCHES: the sibling task (gap-shipped-plugin-tree-excludes-…) narrowed the artifact
// by PATTERN (test trees, fixtures, mutation cases, dev manifests). That cannot express "dev-only by
// REACHABILITY" — the 0.17.0 artifact still carried 90 non-test `.sh` / 28,642 lines, of which the
// release/delivery tooling of a CANCELLED channel and the retired classic-pipeline gates were being
// published as product.
//
// TWO-WAY, ON A REAL ARTIFACT (never a fixture that re-implements the publish):
//   · the artifact is assembled by the REAL plugin/scripts/publish-dist-branch.sh, in a THROWAWAY git
//     repo under a tmp dir (no branch/worktree in the shared checkout, no push, no network — the same
//     stub shape plugin/test/shipped-set.test.mjs uses, copied deliberately so each control is
//     legible on its own).
//   · the reachable set is derived by the REAL plugin/scripts/shipped-shell-reachability.ts from the
//     source checkout's roots. The reading is a walk of the artifact itself (硬规则 4b) — never a
//     number the artifact reports about itself.
//   · the RED controls mutate the real artifact / the real root set: an `orphan-tool.sh` nothing
//     references, a catalog-declared instrument dropped from the root set, and the restored
//     `verify-deliver-coldstart.sh`. A checker that only ever says PASS is not a check, so every
//     control asserts on the READING (which paths), never on a boolean.
//
// Run: scripts/test.sh plugin/test/shipped-shell-reachability.test.mjs  (and AC-335's own criterion:
//      `timeout 55 node --experimental-strip-types --test plugin/test/shipped-shell-reachability.test.mjs`)

import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { makeTmpDir } from "./helpers/tmp-workspace.mjs";
import {
  UNSHIPPED_BY_DECISION,
  codeExecRefs,
  deriveReachability,
  judgeShellReachability,
  resolveRef,
  shellExecRefs,
} from "../scripts/shipped-shell-reachability.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginDir, "..");
const PUBLISH_SCRIPT = path.join(pluginDir, "scripts", "publish-dist-branch.sh");
const CATALOG_ABS = path.join(pluginDir, "scripts", "capability-catalog-declarations.json");
const NODE_MODULES = path.join(repoRoot, "node_modules");

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  }).trim();
}

function writeFile(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function cpRecursive(src, dest) {
  fs.cpSync(src, dest, { recursive: true, dereference: false });
}

/**
 * A throwaway git repo holding the REAL plugin tree plus the REAL build inputs — structurally the
 * same shape publish-dist-branch.sh is handed in production.
 *
 * ⛔ `plugin/`, `packages/quay/scripts`, `packages/quay/src` and `scripts/` are COPIES, never
 * symlinks: Node resolves an ESM entry to its REALPATH, so a symlinked `build-plugin-dist.mjs` fails
 * its own file-identity guard and bundles NOTHING — silently, producing an artifact with no
 * `dist/*.js` at all. `node_modules` may be a symlink: it is only a resolution root, never an entry.
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
  git(root, "-c", "user.name=shipped-shell", "-c", "user.email=shipped-shell@test.invalid", "commit", "-q", "-m", "stub");
  return root;
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

/** Every artifact-relative `.sh` in a materialised artifact. */
function artifactShells(root) {
  const out = [];
  const visit = (dir, rel) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel === "" ? d.name : `${rel}/${d.name}`;
      if (d.isDirectory()) visit(path.join(dir, d.name), r);
      else if (r.endsWith(".sh")) out.push(r);
    }
  };
  visit(root, "");
  return out.sort();
}

// ── the one real artifact this file builds (shared by every assertion below) ─────────────────────

let stub = null;
let artifact = null;
let buildError = null;
let envLimited = false;

before(() => {
  const vendor = path.join(pluginDir, "vendor", "quay", "dist", "quay.js");
  if (!fs.existsSync(vendor) || fs.statSync(vendor).size === 0) {
    // A missing bundle is an ENVIRONMENT limitation (the publish script refuses to assemble without
    // it) — the same skip the sibling shipped-set test takes. It is NOT the same as a failed publish.
    envLimited = true;
    buildError = "plugin/vendor/quay/dist/quay.js is absent — the publish script refuses to assemble an artifact without it (run bash plugin/scripts/sync-vendor.sh)";
    return;
  }
  try {
    stub = makePublishRepo("shipped-shell-stub-");
    const r = runPublish(stub, "probe-shell");
    if (r.status !== 0) {
      buildError = `the real publish script FAILED (exit ${r.status}):\n${r.stdout}\n${r.stderr}`;
      return;
    }
    artifact = extractArtifact(stub, "probe-shell", "shipped-shell-art-");
  } catch (err) {
    buildError = `building the artifact threw: ${String(err && err.stack ? err.stack : err)}`;
  }
});

function requireArtifact(t) {
  if (buildError === null) return true;
  // ⛔ A missing vendor bundle is an environment limit (skip). A publish that RAN and failed is a
  // defect in the mechanism under test — skipping it would make this file green exactly when the
  // exclusion stopped working (硬规则 4 推论三: the control must not be satisfiable by an abort).
  if (envLimited) {
    t.skip(buildError);
    return false;
  }
  assert.fail(buildError);
}

// ── AC2: the artifact carries only the .sh a runtime surface reaches ─────────────────────────────

test("AC2: every .sh in the artifact is runtime-reachable, and the cancelled-channel tools are absent", (t) => {
  if (!requireArtifact(t)) return;
  const reading = deriveReachability(repoRoot);
  assert.equal(reading.evaluated, true, `the derivation must be evaluated: ${reading.reason ?? ""}`);
  assert.ok(reading.reachable.length > 0, "the reachable set must not be empty");

  const present = artifactShells(artifact);
  assert.ok(present.length > 0, "the artifact must carry at least one .sh");
  // The reading, not a boolean: WHICH paths are stray.
  const reachable = new Set(reading.reachable);
  const stray = present.filter((p) => !reachable.has(p));
  assert.deepEqual(stray, [], `the artifact carries .sh no root reaches (${stray.length})`);

  // …and the same judgement through the release-gate assertion (one predicate, two callers).
  const verdict = judgeShellReachability(artifact, reading);
  assert.equal(verdict.state, "PASS", verdict.detail);

  // The two tools the task names as OUT, and the class they belong to.
  for (const absent of ["scripts/verify-deliver-coldstart.sh", "scripts/develop-deliver-tgz.sh", "scripts/deliver-verify-usage.sh"]) {
    assert.ok(!present.includes(absent), `${absent} must NOT be in the artifact`);
    assert.ok(reading.unreachable.includes(absent), `${absent} must be reported unreachable`);
    assert.match(reading.unreachableReasons[absent], /cancelled/, "the reason must name the cancelled channel");
  }
  // The "no reference" class: the retired classic-pipeline gates and the dev asset-sync script.
  for (const absent of ["sync.sh", "gate-scripts/it0-dod-check.sh", "gate-scripts/tree-hygiene-check.sh"]) {
    assert.ok(!present.includes(absent), `${absent} must NOT be in the artifact`);
    assert.equal(reading.unreachableReasons[absent], "no executing reference from any root (无引用)");
  }
  // Printed so the file's own log carries the real numbers (a green run is evidence, not a claim).
  console.log(
    `shipped-shell-reachability: artifact ${present.length} .sh (all reachable) · reachable ${reading.reachable.length} · unreachable ${reading.unreachable.length} · ${reading.rootFiles} root file(s) read`,
  );
});

test("AC2 control: an `orphan-tool.sh` nothing references, dropped into the artifact, turns it RED", (t) => {
  if (!requireArtifact(t)) return;
  const reading = deriveReachability(repoRoot);
  const dirty = makeTmpDir("shipped-shell-orphan-");
  cpRecursive(artifact, dirty);
  writeFile(path.join(dirty, "scripts", "orphan-tool.sh"), "#!/usr/bin/env bash\necho nobody-executes-me\n");

  const verdict = judgeShellReachability(dirty, reading);
  assert.equal(verdict.state, "FAIL", `a stray .sh must be rejected: ${verdict.detail}`);
  assert.match(verdict.detail, /scripts\/orphan-tool\.sh/, "the failure must NAME the stray path");
  assert.match(verdict.detail, /1 \.sh file\(s\)/, "the failure must state how many");
  // ⛔ …and the clean artifact is still PASS: the control must not be satisfiable by a checker that
  // simply always fails.
  assert.equal(judgeShellReachability(artifact, reading).state, "PASS");
});

test("AC2 control: dropping a catalog-declared instrument from the ROOT set turns it RED (the catalog root is load-bearing)", (t) => {
  if (!requireArtifact(t)) return;
  const reading = deriveReachability(repoRoot);
  const parsed = JSON.parse(fs.readFileSync(CATALOG_ABS, "utf8"));
  const question = parsed.QUESTION ?? {};
  const present = new Set(artifactShells(artifact));

  // Find a real, artifact-present instrument whose ONLY root is the catalog — a control whose
  // mutation does not actually change the root set would be vacuous, so the removal is verified
  // before it is judged (硬规则 4 推论三).
  let victim = null;
  for (const rel of reading.reachable) {
    const basename = path.basename(rel);
    if (!rel.startsWith("scripts/") || basename in UNSHIPPED_BY_DECISION || !(basename in question)) continue;
    if (!present.has(rel)) continue;
    const mutated = { basenames: new Set(Object.keys(question).filter((b) => b !== basename)), notShipped: new Set(Object.keys(parsed.NOT_SHIPPED ?? {})) };
    const after = deriveReachability(repoRoot, { catalog: mutated });
    if (!after.reachable.includes(rel)) {
      victim = { rel, basename, after };
      break;
    }
  }
  assert.notEqual(victim, null, "no catalog-only instrument found — the catalog root control could not be applied");
  // The artifact still carries it, but the (mutated) root set no longer reaches it ⇒ RED.
  const verdict = judgeShellReachability(artifact, victim.after);
  assert.equal(verdict.state, "FAIL", `dropping ${victim.basename} from the root set must make the artifact's copy stray: ${verdict.detail}`);
  assert.match(verdict.detail, new RegExp(victim.rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "the failure must name the now-unreachable instrument");
});

test("AC2 control: restoring `verify-deliver-coldstart.sh` into the artifact turns it RED", (t) => {
  if (!requireArtifact(t)) return;
  const reading = deriveReachability(repoRoot);
  const restored = makeTmpDir("shipped-shell-restored-");
  cpRecursive(artifact, restored);
  const src = path.join(pluginDir, "scripts", "verify-deliver-coldstart.sh");
  assert.ok(fs.existsSync(src), "the source checkout must still carry the unshipped tool (it stays in the repo for dev use)");
  cpRecursive(src, path.join(restored, "scripts", "verify-deliver-coldstart.sh"));

  const verdict = judgeShellReachability(restored, reading);
  assert.equal(verdict.state, "FAIL", `a restored cancelled-channel tool must be rejected: ${verdict.detail}`);
  assert.match(verdict.detail, /verify-deliver-coldstart\.sh/);
  // The declared reason is what the completion record must carry, so assert it is a real sentence.
  assert.match(UNSHIPPED_BY_DECISION["scripts/verify-deliver-coldstart.sh"], /2026-09-16/);
});

// ── the derivation is by EXECUTION, not by textual mention (硬规则 2) ────────────────────────────

test("shellExecRefs: a command position counts; prose inside a fence does not", () => {
  const refs = shellExecRefs(
    [
      "bash plugin/scripts/slot-refill.sh --root .",
      'bash "${PLUGIN_ROOT}/scripts/quay-init.sh" --root .',
      '"$SCRIPT_DIR/cap-from-gate.sh" --json',
      "# bash plugin/scripts/not-a-call-commented-out.sh",
      "it0-ceiling-line-budget-check.sh verdict, already run by the orchestrator",
      "见 `plugin/scripts/resource-gate.sh` 的用法说明",
    ].join("\n"),
  );
  assert.ok(refs.some((r) => r.endsWith("slot-refill.sh")));
  assert.ok(refs.some((r) => r.endsWith("quay-init.sh")));
  assert.ok(refs.some((r) => r.endsWith("cap-from-gate.sh")));
  assert.ok(!refs.some((r) => r.includes("not-a-call-commented-out")), "a commented-out line is not a call");
  assert.ok(!refs.some((r) => r.includes("it0-ceiling-line-budget-check")), "prose starting with a script name is not a call");
  assert.ok(!refs.some((r) => r.includes("resource-gate.sh")), "a backticked mention mid-sentence is not a call");
});

test("codeExecRefs: a resolver/spawn literal counts; a name inside an example string does not", () => {
  const refs = codeExecRefs(
    [
      'export const RESOURCE_GATE_REL = path.join("scripts", "resource-gate.sh");',
      'export const QUAY_INIT_REL = "plugin/scripts/quay-init.sh";',
      'const launch = resolvePluginScript(path.join("scripts", "quay-launch.sh"));',
      '  "  #     script: \\"./scripts/it0-dod-check.sh\\"",',
      'commandIdentity: "node --experimental-strip-types experiments/x/scripts/it0-ceiling-check.sh --task T",',
      "// a comment naming sync.sh is not a call",
    ].join("\n"),
  );
  assert.ok(refs.some((r) => r.endsWith("resource-gate.sh")));
  assert.ok(refs.some((r) => r.endsWith("quay-init.sh")));
  assert.ok(refs.some((r) => r.endsWith("quay-launch.sh")));
  assert.ok(!refs.some((r) => r.includes("it0-dod-check")), "a script path inside an example template string is not a call");
  assert.ok(!refs.some((r) => r.includes("it0-ceiling-check")), "a commandIdentity fixture string is not a call");
  assert.ok(!refs.some((r) => r.includes("sync.sh")), "a comment is not a call");
});

test("resolveRef: a literal directory that names no candidate is a NO; a variable directory falls back to the basename", () => {
  const candidates = new Set(["scripts/it0-impl-row-check.sh", "gate-scripts/it0-impl-row-check.sh", "scripts/quay-launch.sh"]);
  assert.equal(resolveRef("plugin/scripts/it0-impl-row-check.sh", candidates), "scripts/it0-impl-row-check.sh");
  assert.equal(resolveRef("plugin/gate-scripts/it0-impl-row-check.sh", candidates), "gate-scripts/it0-impl-row-check.sh");
  assert.equal(resolveRef("${PLUGIN_ROOT}/scripts/quay-launch.sh", candidates), "scripts/quay-launch.sh");
  assert.equal(resolveRef("$SCRIPT_DIR/quay-launch.sh", candidates), "scripts/quay-launch.sh");
  // A bare basename prefers scripts/ (the resolver's own root), never the retired gate-scripts copy.
  assert.equal(resolveRef("it0-impl-row-check.sh", candidates), "scripts/it0-impl-row-check.sh");
  // A literal directory is resolved by its own SUFFIX when that suffix names a candidate…
  assert.equal(resolveRef("experiments/quay-perpetual-stream/scripts/it0-impl-row-check.sh", candidates), "scripts/it0-impl-row-check.sh");
  // …but a literal directory whose suffix names NOTHING must not fall back to the basename: the
  // measured false positive this rule exists for (plugin/scripts/workflow-baseline-metrics.ts names
  // an experiments/ path whose basename happens to equal a plugin gate).
  assert.equal(resolveRef("experiments/quay-perpetual-stream/scripts/it0-ceiling-check.sh", candidates), null);
});

test("the derivation is three-valued: an unreadable root surface is NOT-EVALUATED, never an empty pass", () => {
  const absent = deriveReachability(path.join(makeTmpDir("shipped-shell-absent-"), "no-such-repo"));
  assert.equal(absent.evaluated, false);
  assert.match(absent.reason, /missing/);
  const verdict = judgeShellReachability(artifact ?? makeTmpDir("shipped-shell-none-"), absent);
  assert.equal(verdict.state, "NOT-EVALUATED");
});
