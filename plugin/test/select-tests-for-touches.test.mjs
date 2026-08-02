// select-tests-for-touches.test.mjs — gap-test-selection-not-scoped-to-touches: RED/GREEN tests
// for the mechanical per-task test selector (select-tests-for-touches.ts, byte-identical mirror).
// Covers AC1–AC11 and the DoD's "tests cover AC2–AC9".
//
// Resolution rules under test (most-specific first):
//   1. Direct — a Touches entry that is itself a `*.test.mjs` path
//   2. Basename pair — `<dir>/foo.ts` → any `*/test/foo.test.mjs`
//   3. Mirror fold — `experiments/quay-perpetual-stream/scripts/X.ts` and `plugin/scripts/X.ts`
//      resolve to the SAME test set (byte-identical mirrors)
//   4. Declared extra — an optional `## Test-Files` section in the task body
//   5. Unresolved — a Touches entry matching no test is REPORTED, never silently dropped
//
// Run:
//   scripts/test.sh plugin/test/select-tests-for-touches.test.mjs
//   node --test plugin/test/select-tests-for-touches.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CLI = path.join(REPO_ROOT, "plugin", "scripts", "select-tests-for-touches.ts");
const CLI_MIRROR = path.join(REPO_ROOT, "experiments", "quay-perpetual-stream", "scripts", "select-tests-for-touches.ts");
const TEST_SH = path.join(REPO_ROOT, "scripts", "test.sh");

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────────────

function makeWorkspace(files) {
  // files: { "<repo-relative path>": "<content>" } — everything else absent.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seltests-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
  return root;
}

function cleanup(root) {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

function writeTask(root, id, body) {
  const f = path.join(root, "tasks", `${id}.md`);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, `---\nid: ${id}\nextra:\n  schema: v1\n---\n\n${body}\n`, "utf8");
}

function runCli(root, ...args) {
  const res = spawnSync("node", ["--no-warnings", "--experimental-strip-types", CLI, "--root", root, ...args], {
    encoding: "utf8",
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

async function importMod() {
  return import(CLI);
}

// Node's test runner sets NODE_TEST_CONTEXT in the environment; a child `node --test` that inherits
// it refuses to run files ("run() is being called recursively… skipping running files") as a
// recursion guard. test.sh's inner node --test must NOT inherit it, or the AC10/AC11 end-to-end
// assertions silently no-op. Deleting (not emptying) the var defeats the guard.
function spawnTestSh(args) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync("bash", [TEST_SH, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 60_000,
    env,
  });
}

const TEST_FILE_CONTENT = "export const placeholder = 1;\n";

// ── AC2: Rule 1 — direct *.test.mjs in Touches ───────────────────────────────────────────────────────

test("AC2 — a direct *.test.mjs Touches entry resolves to that file", () => {
  const root = makeWorkspace({
    "plugin/test/foo.test.mjs": TEST_FILE_CONTENT,
  });
  try {
    writeTask(root, "t2", "## Touches\n- plugin/test/foo.test.mjs\n");
    const r = runCli(root, "--task", "t2");
    assert.equal(r.status, 0, `exit 0, stderr: ${r.stderr}`);
    assert.match(r.stdout, /plugin\/test\/foo\.test\.mjs/);
    const j = runCli(root, "--task", "t2", "--json");
    const out = JSON.parse(j.stdout);
    assert.deepEqual(out.selected, ["plugin/test/foo.test.mjs"]);
    assert.deepEqual(out.unresolved, []);
    assert.equal(out.coverageRatio, 1);
    assert.equal(out.taskId, "t2");
  } finally {
    cleanup(root);
  }
});

// ── AC3: Rule 2 — basename pair ───────────────────────────────────────────────────────────────────────

test("AC3 — scripts/foo.ts resolves to */test/foo.test.mjs via basename pair", () => {
  const root = makeWorkspace({
    "plugin/test/foo.test.mjs": TEST_FILE_CONTENT,
    "packages/quay/test/foo.test.mjs": TEST_FILE_CONTENT,
  });
  try {
    writeTask(root, "t3", "## Touches\n- scripts/foo.ts\n");
    const j = runCli(root, "--task", "t3", "--json");
    assert.equal(j.status, 0, j.stderr);
    const out = JSON.parse(j.stdout);
    assert.deepEqual(out.selected, [
      "packages/quay/test/foo.test.mjs",
      "plugin/test/foo.test.mjs",
    ]);
    assert.equal(out.coverageRatio, 1);
  } finally {
    cleanup(root);
  }
});

test("AC3 — a deep source path packages/quay/src/foo.ts still pairs to */test/foo.test.mjs", () => {
  const root = makeWorkspace({
    "plugin/test/foo.test.mjs": TEST_FILE_CONTENT,
  });
  try {
    writeTask(root, "t3b", "## Touches\n- packages/quay/src/foo.ts\n");
    const j = runCli(root, "--task", "t3b", "--json");
    const out = JSON.parse(j.stdout);
    assert.deepEqual(out.selected, ["plugin/test/foo.test.mjs"]);
    assert.equal(out.coverageRatio, 1);
  } finally {
    cleanup(root);
  }
});

// ── AC4: Rule 3 — mirror fold ─────────────────────────────────────────────────────────────────────────

test("AC4 — the experiments and plugin paths of one module yield an identical set", () => {
  const root = makeWorkspace({
    "plugin/test/foo.test.mjs": TEST_FILE_CONTENT,
  });
  try {
    writeTask(root, "t4exp", "## Touches\n- experiments/quay-perpetual-stream/scripts/foo.ts\n");
    writeTask(root, "t4plug", "## Touches\n- plugin/scripts/foo.ts\n");
    const exp = JSON.parse(runCli(root, "--task", "t4exp", "--json").stdout);
    const plug = JSON.parse(runCli(root, "--task", "t4plug", "--json").stdout);
    assert.deepEqual(exp.selected, plug.selected, "mirror paths must fold to the same test set");
    assert.deepEqual(exp.selected, ["plugin/test/foo.test.mjs"]);
    assert.equal(exp.coverageRatio, plug.coverageRatio);
  } finally {
    cleanup(root);
  }
});

// ── AC5: Rule 4 — declared ## Test-Files section ──────────────────────────────────────────────────────

test("AC5 — an optional ## Test-Files section is honored when present", () => {
  const root = makeWorkspace({
    "plugin/test/foo.test.mjs": TEST_FILE_CONTENT,
    "plugin/test/extra.test.mjs": TEST_FILE_CONTENT,
  });
  try {
    writeTask(root, "t5", "## Touches\n- scripts/foo.ts\n## Test-Files\n- plugin/test/extra.test.mjs\n");
    const j = runCli(root, "--task", "t5", "--json");
    assert.equal(j.status, 0, j.stderr);
    const out = JSON.parse(j.stdout);
    assert.deepEqual(out.selected, ["plugin/test/extra.test.mjs", "plugin/test/foo.test.mjs"]);
    assert.equal(out.coverageRatio, 1);
  } finally {
    cleanup(root);
  }
});

test("AC5 — a declared-but-missing ## Test-Files entry is surfaced, never silently dropped", () => {
  const root = makeWorkspace({
    "plugin/test/foo.test.mjs": TEST_FILE_CONTENT,
  });
  try {
    writeTask(root, "t5b", "## Touches\n- scripts/foo.ts\n## Test-Files\n- plugin/test/ghost.test.mjs\n");
    const j = runCli(root, "--task", "t5b", "--json");
    const out = JSON.parse(j.stdout);
    assert.deepEqual(out.selected, ["plugin/test/foo.test.mjs"]);
    assert.ok(out.unresolved.some((u) => u.entry === "plugin/test/ghost.test.mjs"), `ghost surfaced: ${JSON.stringify(out.unresolved)}`);
  } finally {
    cleanup(root);
  }
});

// ── AC6: Rule 5 — unresolved reported ─────────────────────────────────────────────────────────────────

test("AC6 — a Touches entry resolving to no test appears in the unresolved list", () => {
  const root = makeWorkspace({
    "plugin/test/foo.test.mjs": TEST_FILE_CONTENT,
  });
  try {
    writeTask(root, "t6", "## Touches\n- scripts/foo.ts\n- docs/bar.md\n");
    const j = runCli(root, "--task", "t6", "--json");
    assert.equal(j.status, 0, j.stderr);
    const out = JSON.parse(j.stdout);
    assert.deepEqual(out.selected, ["plugin/test/foo.test.mjs"]);
    assert.equal(out.unresolved.length, 1, JSON.stringify(out.unresolved));
    assert.equal(out.unresolved[0].entry, "docs/bar.md");
    assert.equal(out.coverageRatio, 0.5);
  } finally {
    cleanup(root);
  }
});

// ── AC7: --json shape ─────────────────────────────────────────────────────────────────────────────────

test("AC7 — --json emits {taskId, selected, unresolved, coverageRatio}", () => {
  const root = makeWorkspace({
    "plugin/test/foo.test.mjs": TEST_FILE_CONTENT,
  });
  try {
    writeTask(root, "t7", "## Touches\n- scripts/foo.ts\n- scripts/test.sh\n");
    const j = runCli(root, "--task", "t7", "--json");
    assert.equal(j.status, 0, j.stderr);
    const out = JSON.parse(j.stdout);
    assert.deepEqual(Object.keys(out).sort(), ["coverageRatio", "selected", "taskId", "unresolved"]);
    assert.ok(Array.isArray(out.selected));
    assert.ok(Array.isArray(out.unresolved));
    assert.equal(typeof out.coverageRatio, "number");
    assert.equal(typeof out.taskId, "string");
  } finally {
    cleanup(root);
  }
});

// ── AC8: thin coverage fails loud ─────────────────────────────────────────────────────────────────────

test("AC8 — thin coverage (<50% of Touches resolved) exits non-zero with test-selection-thin", () => {
  const root = makeWorkspace({
    "plugin/test/foo.test.mjs": TEST_FILE_CONTENT,
  });
  try {
    // 1 of 3 resolvable → 0.33 < 0.5
    writeTask(root, "t8", "## Touches\n- scripts/foo.ts\n- docs/a.md\n- docs/b.md\n");
    const j = runCli(root, "--task", "t8", "--json");
    // --json still emits the data shape, but fail-loud is mode-independent: thin → non-zero.
    const out = JSON.parse(j.stdout);
    assert.equal(out.coverageRatio, 1 / 3);
    assert.ok(out.coverageRatio < 0.5);
    assert.notEqual(j.status, 0, "thin must exit non-zero even in --json mode");

    const r = runCli(root, "--task", "t8", "--paths-only");
    assert.notEqual(r.status, 0, `thin must exit non-zero, got ${r.status}`);
    assert.match(r.stderr, /test-selection-thin/, `stderr should name test-selection-thin: ${r.stderr}`);
  } finally {
    cleanup(root);
  }
});

test("AC8 — zero resolved touches is thin (fail-closed)", () => {
  const root = makeWorkspace({});
  try {
    writeTask(root, "t8z", "## Touches\n- docs/a.md\n- docs/b.md\n- scripts/test.sh\n");
    const r = runCli(root, "--task", "t8z", "--paths-only");
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /test-selection-thin/);
  } finally {
    cleanup(root);
  }
});

test("AC8 — exactly 50% is NOT thin (threshold is <0.5, not <=0.5)", () => {
  const root = makeWorkspace({
    "plugin/test/foo.test.mjs": TEST_FILE_CONTENT,
  });
  try {
    writeTask(root, "t8h", "## Touches\n- scripts/foo.ts\n- docs/bar.md\n");
    const r = runCli(root, "--task", "t8h", "--paths-only");
    assert.equal(r.status, 0, `coverage 0.5 must pass, got ${r.status}`);
    assert.match(r.stdout, /plugin\/test\/foo\.test\.mjs/);
  } finally {
    cleanup(root);
  }
});

// ── AC9: --allow-thin downgrades to a warning, exit 0 ─────────────────────────────────────────────────

test("AC9 — --allow-thin downgrades AC8 to a warning and exits 0", () => {
  const root = makeWorkspace({
    "plugin/test/foo.test.mjs": TEST_FILE_CONTENT,
  });
  try {
    writeTask(root, "t9", "## Touches\n- scripts/foo.ts\n- docs/a.md\n- docs/b.md\n");
    const r = runCli(root, "--task", "t9", "--paths-only", "--allow-thin");
    assert.equal(r.status, 0, `--allow-thin must exit 0, got ${r.status} stderr: ${r.stderr}`);
    assert.match(r.stderr, /test-selection-thin/, "still warns on stderr");
    const j = runCli(root, "--task", "t9", "--json", "--allow-thin");
    const out = JSON.parse(j.stdout);
    assert.equal(out.coverageRatio, 1 / 3);
  } finally {
    cleanup(root);
  }
});

// ── AC1: byte-identical mirrors ───────────────────────────────────────────────────────────────────────

test("AC1 — experiments and plugin mirrors are byte-identical", () => {
  assert.ok(fs.existsSync(CLI), "plugin/scripts/select-tests-for-touches.ts must exist");
  assert.ok(fs.existsSync(CLI_MIRROR), "experiments/.../scripts/select-tests-for-touches.ts must exist");
  const plug = fs.readFileSync(CLI, "utf8");
  const exp = fs.readFileSync(CLI_MIRROR, "utf8");
  assert.equal(exp, plug, "mirrors must be byte-identical");
});

// ── AC10: scripts/test.sh --for-task runs exactly the selected set ───────────────────────────────────

test("AC10 — scripts/test.sh --for-task <id> runs the selected set (real task, no recursion)", () => {
  // The task under implementation selects EXACTLY plugin/test/select-tests-for-touches.test.mjs
  // (its own test file: 3 of 5 touches resolve → coverage 0.6, not thin). Running it through
  // test.sh re-enters THIS file in a subprocess, so we pin --test-name-pattern to a single AC that
  // does not itself recurse (avoids infinite recursion while proving the plumbing end-to-end).
  const taskId = "gap-test-selection-not-scoped-to-touches";
  const res = spawnTestSh(["--for-task", taskId, "--test-name-pattern", "AC2"]);
  assert.equal(res.status, 0, `test.sh --for-task must exit 0, got ${res.status}\nstdout: ${res.stdout}\nstderr: ${res.stderr}`);
  const combined = `${res.stdout}\n${res.stderr}`;
  // The subprocess must have run exactly the pinned AC subset of the selected file (the file's own
  // name is not echoed by node's reporter when --test-name-pattern matches, so assert on the run).
  assert.match(combined, /AC2 — a direct \*\.test\.mjs Touches entry resolves to that file/, "the pinned AC should run in the subprocess");
  // `\b` after `1` rejects the prefix-collision cases (tests 12..18 would otherwise match /tests 1/).
  assert.match(combined, /ℹ tests 1\b/, `exactly one test (the pinned AC) should run: ${combined}`);
  assert.doesNotMatch(combined, /AC10 —/, "only the pinned AC subset should run in the subprocess");
});

// ── Adversarial-review regression tests (round 1) ────────────────────────────────────────────────────

test("REGRESSION (round-1 BUG) — test.sh --for-task on a missing task exits 2 and never runs `node --test \"\"`", () => {
  const res = spawnTestSh(["--for-task", "no-such-task-xyz"]);
  assert.equal(res.status, 2, `missing task must exit 2, got ${res.status}`);
  const combined = `${res.stdout}\n${res.stderr}`;
  assert.doesNotMatch(combined, /Could not find ''/, "the empty-file bug must not surface (`mapfile <<< \"\"` → [\"\"])");
  assert.match(res.stderr, /could not resolve the task/, `stderr should explain: ${res.stderr}`);
});

test("REGRESSION (round-1 BUG) — test.sh --for-task <zero-selection task> --allow-thin exits 0, never `node --test \"\"`", () => {
  // DIR-073's Touches resolve to zero tests (0/3) — the exact empty-output path the bug broke.
  const res = spawnTestSh(["--for-task", "DIR-073", "--allow-thin"]);
  const combined = `${res.stdout}\n${res.stderr}`;
  assert.doesNotMatch(combined, /Could not find ''/, "the empty-file bug must not surface");
  assert.equal(res.status, 0, `--allow-thin + zero tests must exit 0, got ${res.status}\n${combined}`);
  assert.match(res.stderr, /selected 0 test files \(thin allowed\)/, `stderr should say nothing-to-run: ${res.stderr}`);
});

test("REGRESSION (round-1 NIT) — testBasenameFor collapses a .test. marker (foo.test.ts → foo.test.mjs)", async () => {
  const cli = await importMod();
  assert.equal(cli.testBasenameFor("scripts/foo.test.ts"), "foo.test.mjs");
  assert.equal(cli.testBasenameFor("scripts/foo.ts"), "foo.test.mjs");
  assert.equal(cli.testBasenameFor("scripts/foo.test.mjs"), "foo.test.mjs");
});

// ── AC11: scripts/test.sh no-args behavior unchanged ─────────────────────────────────────────────────

test("AC11 — scripts/test.sh no-args full-suite branch is byte-for-behavior unchanged (structural)", () => {
  const src = fs.readFileSync(TEST_SH, "utf8");
  // The exact no-args branch must be present verbatim: the glob, the empty guard, and the exec line.
  assert.match(src, /if \[ "\$#" -eq 0 \]; then/);
  assert.match(src, /files=\(packages\/\*\/test\/\*\.test\.mjs plugin\/test\/\*\.test\.mjs\)/);
  assert.match(src, /exec node --test --test-concurrency=8 "\$\{files\[@\]\}"/);
  // The explicit-file branch (else path) still runs through the same exec line.
  assert.match(src, /else\n  exec node --test --test-concurrency=8 "\$@"/);
});

test("AC11 — scripts/test.sh explicit-file form still runs (smoke, pinned name pattern)", () => {
  // Pinning --test-name-pattern to nothing means node --test loads the file but runs 0 tests,
  // proving the explicit-file passthrough path works without executing this file's own AC10
  // (which would recurse). Fast and hermetic.
  const res = spawnTestSh(["--test-name-pattern", "ZZZ_NO_MATCH_ZZZ", path.join("plugin", "test", "fast-mode-telemetry.test.mjs")]);
  assert.equal(res.status, 0, `explicit-file form must exit 0, got ${res.status}\nstdout: ${res.stdout}\nstderr: ${res.stderr}`);
});
