// @test-group engine
// release-model-check.test.mjs — tests for the GENERAL release-branch-model meter
// (tasks/gap-release-branch-model-hardcoded-not-configurable).
//
// THE DEFECT THIS CARRIER CLOSES: quay's release model (which branch releases advance, which branch
// they are cut from, which names are release-shaped, what a version tag looks like) lived only as
// literals in quay's own private scripts, so a second quay-driven project could not DECLARE its own
// model and have the invariant checked. This file holds the meter's load-bearing properties:
//
//   (a) FOUR mutually-exclusive readings — pass (0), fail (1), not-evaluated (3), and
//       not-configured (4). The task's AC is exactly that 「没配」/「合格」/「不合格」/「无法评估」
//       do not share a value; the negative control is that a repo with NO `release:` section reads
//       `not-configured`, ⛔ never `pass`.
//   (b) THE MODEL IS DECLARED, NOT HARDCODED — a fixture using `line: main`, `globs: ["rel/*"]` and
//       `tag_prefix: ""` passes with `main`/`1.0.0`, which the historical `master`/`v` literals could
//       never produce.
//   (c) THE FAILURE ARM CAN TAKE FALSE (hard rule 4) — the same fixture gains a commit past its tag
//       and flips to `fail`. A criterion that can only pass is an echo, not a measurement.
//   (d) UNREADABLE ≠ DEFAULT (hard rule 3b) — a present-but-malformed `release:` section is
//       `not-evaluated`, ⛔ never the defaults.
//   (e) THE TWO-LAYER COPY CANNOT DRIFT — the shipped `parseReleaseConfig` (plugin/scripts) and the
//       product `parseReleaseConfig` (packages/quay/src) are run over one table of inputs and must
//       agree. This is the guard for the twin reader the two-layer design requires.
//   (f) `--print-model` is the seam the shell / .mjs carriers read, so they cannot disagree with the
//       meter about the declared model.
//
// All fixtures are self-contained temp git repos + temp config files; nothing in the real checkout is
// mutated (R3 test-isolation).
//
// Run:
//   scripts/test.sh plugin/test/release-model-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const SCRIPT = join(repoRoot, "plugin", "scripts", "release-model-check.ts");

const IDENTITY_ENV = {
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function git(cwd, ...args) {
  const res = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", env: { ...process.env, ...IDENTITY_ENV } });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function run(args, opts = {}) {
  const res = spawnSync(process.execPath, ["--no-warnings", "--experimental-strip-types", SCRIPT, ...args], {
    encoding: "utf8",
    ...opts,
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

/** A temp git repo with one commit on `branch`, plus an optional `.quay/config.yml`. */
function makeRepo({ branch = "main", config = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), "release-model-check-"));
  assert.equal(git(root, "init", "-q", "-b", branch).status, 0, "git init must succeed");
  writeFileSync(join(root, "README.md"), "fixture\n");
  assert.equal(git(root, "add", "README.md").status, 0);
  assert.equal(git(root, "commit", "-q", "-m", "fixture: initial commit").status, 0);
  if (config !== null) {
    mkdirSync(join(root, ".quay"), { recursive: true });
    writeFileSync(join(root, ".quay", "config.yml"), config);
  }
  return root;
}

function commitTo(root, file, msg) {
  writeFileSync(join(root, file), msg + "\n");
  assert.equal(git(root, "add", file).status, 0);
  assert.equal(git(root, "commit", "-q", "-m", msg).status, 0);
}

const CUSTOM = [
  "release:",
  '  line: "main"',
  '  baseline: "trunk"',
  '  globs: ["rel/*"]',
  '  tag_prefix: ""',
  '  advance: "manual"',
  "",
].join("\n");

function parseJson(out) {
  return JSON.parse(out.trim());
}

// ── (a) the four states do not share a value ────────────────────────────────────────────────────

test("NOT-CONFIGURED (exit 4) is its own reading — a repo with no release: section is ⛔ not a pass", () => {
  const root = makeRepo();
  try {
    const r = run(["--root", root, "--json"]);
    assert.equal(r.status, 4, `expected the not-configured exit code, got ${r.status}: ${r.stdout}${r.stderr}`);
    const o = parseJson(r.stdout);
    assert.equal(o.status, "not-configured");
    assert.equal(o.evaluated, false, "not-configured is NOT an evaluation — the project declared nothing");
    assert.notEqual(o.status, "pass");
    assert.notEqual(o.status, "not-evaluated");
  } finally {
    cleanup(root);
  }
});

test("PASS (exit 0) — the declared line stands on a tag of the declared shape", () => {
  const root = makeRepo({ config: CUSTOM });
  try {
    assert.equal(git(root, "tag", "1.0.0").status, 0);
    const r = run(["--root", root, "--json"]);
    assert.equal(r.status, 0, `expected pass: ${r.stdout}${r.stderr}`);
    const o = parseJson(r.stdout);
    assert.equal(o.status, "pass");
    assert.equal(o.evaluated, true);
    assert.deepEqual(o.config.globs, ["rel/*"]);
    assert.equal(o.config.line, "main");
    assert.equal(o.config.tag_prefix, "");
    assert.ok(o.invariants.every((i) => i.state === "pass" || i.state === "skipped"), JSON.stringify(o.invariants));
  } finally {
    cleanup(root);
  }
});

test("FAIL (exit 1) — a commit landed ON the line past the tag (the criterion can take false)", () => {
  const root = makeRepo({ config: CUSTOM });
  try {
    assert.equal(git(root, "tag", "1.0.0").status, 0);
    commitTo(root, "direct.txt", "direct commit on the release line");
    const r = run(["--root", root, "--json"]);
    assert.equal(r.status, 1, `expected fail: ${r.stdout}${r.stderr}`);
    const o = parseJson(r.stdout);
    assert.equal(o.status, "fail");
    assert.equal(o.evaluated, true);
    const parked = o.invariants.find((i) => i.id === "line-parked-on-tag");
    assert.equal(parked.state, "fail");
    assert.match(parked.detail, /NO tag/);
  } finally {
    cleanup(root);
  }
});

test("NOT-EVALUATED (exit 3) — a present-but-malformed release: section is ⛔ never the defaults", () => {
  const root = makeRepo({ config: "release:\n  line: \"\"\n  baseline: \"develop\"\n" });
  try {
    const r = run(["--root", root, "--json"]);
    assert.equal(r.status, 3, `expected not-evaluated: ${r.stdout}${r.stderr}`);
    const o = parseJson(r.stdout);
    assert.equal(o.status, "not-evaluated");
    assert.equal(o.evaluated, false);
    assert.match(o.reason, /release\.line/);
  } finally {
    cleanup(root);
  }
});

test("all four readings are pairwise distinct (status AND exit code)", () => {
  const seen = new Set();
  const roots = [];
  try {
    const notConfigured = makeRepo();
    roots.push(notConfigured);
    seen.add(`${run(["--root", notConfigured, "--json"]).status}:not-configured`);

    const passing = makeRepo({ config: CUSTOM });
    roots.push(passing);
    git(passing, "tag", "1.0.0");
    seen.add(`${run(["--root", passing, "--json"]).status}:pass`);

    const failing = makeRepo({ config: CUSTOM });
    roots.push(failing);
    git(failing, "tag", "1.0.0");
    commitTo(failing, "x.txt", "past the tag");
    seen.add(`${run(["--root", failing, "--json"]).status}:fail`);

    const unreadable = makeRepo({ config: "release:\n  line: \"\"\n" });
    roots.push(unreadable);
    seen.add(`${run(["--root", unreadable, "--json"]).status}:not-evaluated`);

    assert.equal(seen.size, 4, `the four states must be distinguishable, got ${[...seen].join(" | ")}`);
    assert.deepEqual([...seen].sort(), [
      "0:pass",
      "1:fail",
      "3:not-evaluated",
      "4:not-configured",
    ]);
  } finally {
    for (const r of roots) cleanup(r);
  }
});

// ── (d) unreadable ≠ default, and the config-reader seam ────────────────────────────────────────

test("--print-model reports source=config|default, and an unreadable section exits 3 (⛔ no silent default)", () => {
  const configured = makeRepo({ config: CUSTOM });
  const plain = makeRepo();
  const broken = makeRepo({ config: "release:\n  line: \"\"\n" });
  try {
    const c = run(["--print-model", "--root", configured]);
    assert.equal(c.status, 0, c.stderr);
    assert.match(c.stdout, /#source=config/);
    assert.match(c.stdout, /^line=main$/m);
    assert.match(c.stdout, /^baseline=trunk$/m);
    assert.match(c.stdout, /^glob=rel\/\*$/m);

    const d = run(["--print-model", "--root", plain]);
    assert.equal(d.status, 0, d.stderr);
    assert.match(d.stdout, /#source=default/);
    assert.match(d.stdout, /^line=master$/m, "the historical model is the fallback for carriers, but source says default");

    const b = run(["--print-model", "--root", broken]);
    assert.equal(b.status, 3, "a present-but-unreadable section must not fall back to defaults");
    assert.match(b.stderr, /release-model-unreadable/);
  } finally {
    cleanup(configured);
    cleanup(plain);
    cleanup(broken);
  }
});

// ── (c) the advance=ci arm really consumes the workflow judge ───────────────────────────────────

test("advance=ci is judged by the release workflow; a missing workflow is NOT-EVALUATED, not a pass", () => {
  const cfg = [
    "release:",
    '  line: "main"',
    '  baseline: "trunk"',
    '  globs: ["rel/*"]',
    '  tag_prefix: ""',
    '  advance: "ci"',
    "",
  ].join("\n");
  const root = makeRepo({ config: cfg });
  try {
    git(root, "tag", "1.0.0");
    const missing = run(["--root", root, "--json"]);
    assert.equal(missing.status, 3, `an absent workflow cannot license a pass: ${missing.stdout}${missing.stderr}`);
    const mo = parseJson(missing.stdout);
    assert.equal(mo.invariants.find((i) => i.id === "advance-ci-needs").state, "not-evaluated");

    mkdirSync(join(root, ".github", "workflows"), { recursive: true });
    writeFileSync(
      join(root, ".github", "workflows", "release.yml"),
      [
        "jobs:",
        "  verify:",
        "    runs-on: ubuntu-latest",
        "  create-github-release:",
        "    needs: [verify]",
        "    runs-on: ubuntu-latest",
        "  advance-master:",
        "    needs: [verify, create-github-release]",
        "    runs-on: ubuntu-latest",
        "",
      ].join("\n"),
    );
    const covered = run(["--root", root, "--json"]);
    assert.equal(covered.status, 0, `a covered workflow must pass: ${covered.stdout}${covered.stderr}`);
    assert.equal(parseJson(covered.stdout).invariants.find((i) => i.id === "advance-ci-needs").state, "pass");

    writeFileSync(
      join(root, ".github", "workflows", "release.yml"),
      ["jobs:", "  verify:", "    runs-on: ubuntu-latest", "  advance-master:", "    runs-on: ubuntu-latest", ""].join("\n"),
    );
    const uncovered = run(["--root", root, "--json"]);
    assert.equal(uncovered.status, 1, `an uncovered advancing job must be RED: ${uncovered.stdout}${uncovered.stderr}`);
    assert.equal(parseJson(uncovered.stdout).invariants.find((i) => i.id === "advance-ci-needs").state, "fail");
  } finally {
    cleanup(root);
  }
});

// ── (e) the two-layer copy cannot drift ─────────────────────────────────────────────────────────

test("PARITY: the shipped judge and the product judge accept/reject the SAME release: values", async () => {
  const shipped = await import("../scripts/release-model-check.ts");
  const product = await import(join(repoRoot, "packages", "quay", "src", "config.ts"));
  const cases = [
    undefined,
    null,
    [],
    "nope",
    {},
    { line: "main" },
    { line: "main", baseline: "trunk" },
    { line: "main", baseline: "trunk", globs: ["rel/*"] },
    { line: "main", baseline: "trunk", globs: [] },
    { line: "main", baseline: "trunk", globs: ["rel/*"], tag_prefix: "" },
    { line: "main", baseline: "trunk", globs: ["rel/*"], tag_prefix: "", advance: "manual" },
    { line: "main", baseline: "trunk", globs: ["rel/*"], tag_prefix: "", advance: "bogus" },
    { line: "main", baseline: "trunk", globs: ["rel/*"], tag_prefix: "", advance: "ci", extra: 1 },
    { line: 3, baseline: "trunk" },
    { line: "main", baseline: "trunk", globs: ["rel/*", 7] },
  ];
  for (const input of cases) {
    const a = shipped.parseReleaseConfig(input);
    const b = product.parseReleaseConfig(input);
    assert.equal(a.ok, b.ok, `disagree on ok for ${JSON.stringify(input)}: shipped=${JSON.stringify(a)} product=${JSON.stringify(b)}`);
    if (a.ok && b.ok) {
      assert.deepEqual(a.config, b.config, `disagree on the model for ${JSON.stringify(input)}`);
    } else {
      assert.equal(a.reason, b.reason, `disagree on the reason for ${JSON.stringify(input)}`);
    }
  }
});

// ── glob helpers shared by the carriers ────────────────────────────────────────────────────────

test("makeBranchMatcher / releaseBranchPrefix follow the DECLARED globs (no fixed prefix)", async () => {
  const { makeBranchMatcher, releaseBranchPrefix, globToRegExp } = await import("../scripts/release-model-check.ts");
  const m = makeBranchMatcher(["rel/*", "hotfix-*"]);
  assert.equal(m("rel/1.0"), true);
  assert.equal(m("hotfix-abc"), true);
  assert.equal(m("release/1.0"), false, "the historical namespace is NOT special when the model says otherwise");
  assert.equal(m("rel/"), true);
  assert.equal(releaseBranchPrefix(["rel/*"]), "rel/");
  assert.equal(releaseBranchPrefix(["hotfix-*"]), "hotfix-");
  assert.equal(releaseBranchPrefix(["main"]), "main/");
  assert.equal(globToRegExp("a?c").test("abc"), true);
  assert.equal(globToRegExp("a?c").test("ac"), false);
});

// ── CLI contract ───────────────────────────────────────────────────────────────────────────────

test("CLI: NO ARGUMENTS is a usage error (exit 2), never an implicit judgement of cwd", () => {
  const r = run([]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Usage:/);
});
