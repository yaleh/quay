// @test-group serial
// @load-sensitive nested-spawn
// @load-sensitive-entry 2026-08-08 A-class nested full-suite spawn (spawns scripts/test.sh --for-task, a nested runner with its own worker pool — gap-suite-tiering-kind-heavy-not-a-mechanism 补缺省 kind)
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — A-class nested scripts/test.sh spawn (routed to serial by gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests)
// select-tests-for-touches.test.mjs — gap-test-selection-not-scoped-to-touches: RED/GREEN tests
// for the mechanical per-task test selector (select-tests-for-touches.ts, byte-identical mirror).
// Covers AC1–AC11 and the DoD's "tests cover AC2–AC9", plus the cross-cut marker AC2–AC6 of
// gap-scoped-selection-blind-to-packaging-state-diff (packaging-state / check-adr / lint).
// GROUP NOTE (gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests): routed to the
// `serial` group (A-class — spawns `scripts/test.sh --for-task`, a nested runner with its own
// worker pool) so it runs in the concurrency-1 serial phase, never competing with the concurrency-8
// main body.
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
//
// gap-ac11-spawns-the-runner-inside-the-runner: this spawn runs INSIDE an outer test.sh that
// already built the dist bundle at its start. Without the skip, the inner run pays the FULL runner
// cost again (2 esbuilds + vendor mirror + 2 static scans), making its 60s budget a hostage of the
// outer suite's CPU load — isolation-green, suite-red (run 1 pass / run 2 fail, 2026-08-02). We
// set QUAY_TEST_SKIP_DIST_BUILD so test.sh skips the redundant rebuild. Safe for every caller:
// AC10/AC11-smoke pin --test-name-pattern to pure-selector or 0-match tests, and the 2 REGRESSION
// spawns exit in the --for-task branch before build_dist_once — none consume the dist bundle, so a
// fresh bundle is never required (skipping cannot test stale code; these runs never read dist).
function spawnTestSh(args) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  env.QUAY_TEST_SKIP_DIST_BUILD = "1";
  // 0-match / pure-selector nested runs also skip the whole-store static checks — the outer suite
  // already ran them, and re-running test-framework-policy-check here races a sibling test's
  // transient untracked fixture (runner-grouping AC7's zz-*-undeclared.test.mjs) → spurious
  // "NEW file without @test-group" → exit 1 (surfaced 2026-08-03, stranded+parser combined suite).
  env.QUAY_TEST_SKIP_STATIC_CHECKS = "1";
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

// ── AC2–AC6: cross-cut marker (gap-scoped-selection-blind-to-packaging-state-diff) ────────────────────
//
// A `packages/*/src` / new-MCP-tool change can break the packaged artifact (npm-pack-e2e /
// build-dist / plugin-packaging), ADR conformance (check-adr), or lint while every src unit test
// stays green — basename pairing never selects those cross-cut tests. The cross-cut registry
// (CROSSCUT_CHECKS in select-tests-for-touches.ts) forces them into the scoped selection when a
// touch triggers the surface, and pure plugin/doc tasks fire nothing (AC6, no bloat).

const CROSSCUT_FILES = {
  "packages/quay/test/npm-pack-e2e.test.mjs": TEST_FILE_CONTENT,
  "packages/quay/test/build-dist.test.mjs": TEST_FILE_CONTENT,
  "plugin/test/plugin-packaging.test.mjs": TEST_FILE_CONTENT,
  "packages/quay/test/adr-gate.test.mjs": TEST_FILE_CONTENT,
  "packages/quay/test/cli-adr.test.mjs": TEST_FILE_CONTENT,
  "packages/quay/test/mcp-adr.test.mjs": TEST_FILE_CONTENT,
  "packages/quay/test/adr-store.test.mjs": TEST_FILE_CONTENT,
};

test("AC2 — a src-touching task selects cross-cut tests it never basename-pairs to", () => {
  const root = makeWorkspace({
    ...CROSSCUT_FILES,
    "packages/quay/test/foo.test.mjs": TEST_FILE_CONTENT,
  });
  try {
    writeTask(root, "t2c", "## Touches\n- packages/quay/src/foo.ts\n");
    const j = runCli(root, "--task", "t2c", "--json");
    assert.equal(j.status, 0, j.stderr);
    const out = JSON.parse(j.stdout);
    // basename pairing still selects foo.test.mjs; the cross-cut marker adds packaging-state and
    // check-adr regardless of basename.
    assert.ok(out.selected.includes("packages/quay/test/foo.test.mjs"), "basename pair still selected");
    assert.ok(out.selected.includes("packages/quay/test/npm-pack-e2e.test.mjs"), `packaging-state cross-cut in: ${out.selected}`);
    assert.ok(out.selected.includes("packages/quay/test/build-dist.test.mjs"), "packaging-state cross-cut");
    assert.ok(out.selected.includes("plugin/test/plugin-packaging.test.mjs"), "packaging-state cross-cut");
    assert.ok(out.selected.includes("packages/quay/test/adr-gate.test.mjs"), "check-adr cross-cut");
    assert.ok(out.selected.includes("packages/quay/test/mcp-adr.test.mjs"), "check-adr cross-cut");
    // The default output carries the cross-cut marker names (Contract `invoke` grep surface).
    const r = runCli(root, "--task", "t2c");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /crosscut: .*packaging-state/);
    assert.match(r.stdout, /crosscut: .*check-adr/);
  } finally {
    cleanup(root);
  }
});

test("AC3 — src-touching task selects ≥1 packaging-state test", () => {
  const root = makeWorkspace({
    ...CROSSCUT_FILES,
    "packages/quay/test/engine.test.mjs": TEST_FILE_CONTENT,
  });
  try {
    writeTask(root, "t3c", "## Touches\n- packages/quay/src/gate/engine.ts\n");
    const j = runCli(root, "--task", "t3c", "--json");
    assert.equal(j.status, 0, j.stderr);
    const out = JSON.parse(j.stdout);
    const packaging = [
      "packages/quay/test/npm-pack-e2e.test.mjs",
      "packages/quay/test/build-dist.test.mjs",
      "plugin/test/plugin-packaging.test.mjs",
    ];
    assert.ok(packaging.some((p) => out.selected.includes(p)), `≥1 packaging-state test in scoped: ${out.selected}`);
  } finally {
    cleanup(root);
  }
});

test("AC4 — src / new-MCP-tool task selects check-adr (ADR cross-cut)", () => {
  const root = makeWorkspace({
    ...CROSSCUT_FILES,
    "packages/quay/test/mcp-server.test.mjs": TEST_FILE_CONTENT,
  });
  try {
    writeTask(root, "t4c", "## Touches\n- packages/quay/src/mcp-server.ts\n");
    const r = runCli(root, "--task", "t4c");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /crosscut: .*check-adr/, "default output names the check-adr cross-cut");
    const j = runCli(root, "--task", "t4c", "--json");
    const out = JSON.parse(j.stdout);
    assert.ok(out.selected.includes("packages/quay/test/mcp-adr.test.mjs"));
    assert.ok(out.selected.includes("packages/quay/test/cli-adr.test.mjs"));
  } finally {
    cleanup(root);
  }
});

test("AC5 — code-touching task's selection names the lint cross-cut (in-task leg via SKILL.md)", () => {
  const root = makeWorkspace({
    "plugin/test/foo.test.mjs": TEST_FILE_CONTENT,
  });
  try {
    writeTask(root, "t5c", "## Touches\n- plugin/scripts/foo.ts\n");
    const r = runCli(root, "--task", "t5c");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /crosscut: .*lint/, "default output names the lint cross-cut");
    // In-task leg of AC5: the author SKILL.md task template defaults new-code ACs to a lint-clean
    // item (the archguard 14-error shape is caught because the author must run lint to tick it).
    const skill = fs.readFileSync(path.join(REPO_ROOT, "plugin", "skills", "author", "SKILL.md"), "utf8");
    assert.match(skill, /lint-clean/);
  } finally {
    cleanup(root);
  }
});

test("AC6 — a pure plugin/doc task selects NO cross-cut tests (no bloat)", () => {
  const root = makeWorkspace({
    ...CROSSCUT_FILES,
  });
  try {
    writeTask(root, "t6c", "## Touches\n- plugin/skills/author/SKILL.md\n- CLAUDE.md\n");
    const r = runCli(root, "--task", "t6c", "--paths-only", "--allow-thin");
    assert.equal(r.status, 0, `--allow-thin pure doc must exit 0, got ${r.status} stderr: ${r.stderr}`);
    for (const p of Object.keys(CROSSCUT_FILES)) {
      assert.ok(!r.stdout.includes(p), `pure plugin/doc task must not select cross-cut ${p}: ${r.stdout}`);
    }
    const d = runCli(root, "--task", "t6c", "--allow-thin");
    assert.doesNotMatch(d.stdout, /crosscut:/, "pure plugin/doc task emits no cross-cut marker");
  } finally {
    cleanup(root);
  }
});

// gap-github-client-iscompound-sabotaged-uncommitted (AC4): a quay-github src change has no
// same-basename test (`github-client.ts` -> no `*/test/github-client.test.mjs`), so the
// `quay-github-src` cross-cut must pull quay-github's own gate-correctness tests into the scoped
// selection. Without it, an isCompound-style checkGate regression in the GitHub Provider would stay
// scoped-green and surface only at the full-suite red window (the 2026-08-09 round-190 sabotage).
test("AC7 — a quay-github src change selects quay-github's own gate tests (quay-github-src cross-cut)", () => {
  const root = makeWorkspace({
    ...CROSSCUT_FILES,
    // A same-basename file exists in the REAL repo only via the cross-cut (there is no
    // `github-client.test.mjs`); the fixture adds one so this test's touch is not thin-coverage,
    // keeping the assertion focused on the cross-cut ADDING the gate-correctness surface.
    "packages/quay-github/test/github-client.test.mjs": TEST_FILE_CONTENT,
    "packages/quay-github/test/compound-gate.test.mjs": TEST_FILE_CONTENT,
    "packages/quay-github/test/create-mcp.test.mjs": TEST_FILE_CONTENT,
    "packages/quay-github/test/gate.test.mjs": TEST_FILE_CONTENT,
    "packages/quay-github/test/gate-gameability.test.mjs": TEST_FILE_CONTENT,
    "packages/quay-github/test/task-check-passthrough.test.mjs": TEST_FILE_CONTENT,
  });
  try {
    writeTask(root, "tqg", "## Touches\n- packages/quay-github/src/github-client.ts\n");
    const j = runCli(root, "--task", "tqg", "--json");
    assert.equal(j.status, 0, j.stderr);
    const out = JSON.parse(j.stdout);
    // basename pairing resolves github-client.test.mjs; the quay-github-src cross-cut must ALSO add
    // the gate-correctness surface (compound-gate / create-mcp / task-check-passthrough / …) that
    // basename pairing alone can never see.
    assert.ok(out.selected.includes("packages/quay-github/test/compound-gate.test.mjs"), `quay-github-src cross-cut in: ${out.selected}`);
    assert.ok(out.selected.includes("packages/quay-github/test/create-mcp.test.mjs"), "quay-github-src cross-cut (create-mcp)");
    assert.ok(out.selected.includes("packages/quay-github/test/task-check-passthrough.test.mjs"), "quay-github-src cross-cut (task-check-passthrough)");
    const r = runCli(root, "--task", "tqg");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /crosscut: .*quay-github-src/, "default output names the quay-github-src cross-cut");
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

test("AC10 — scripts/test.sh --for-task <id> runs exactly the selected set (real task, no recursion)", () => {
  // Relationship, not snapshot (tick rule "测试不得硬编码全局计数"): the number of tests the
  // subprocess runs must equal the number of files the selector actually selected — computed at
  // runtime, never pinned to a literal. A snapshot like /ℹ tests 1\b/ breaks the moment anyone
  // adds a test file to the task's Touches set (observed 2026-08-02: B5-1's cli-entry.test.mjs /
  // an M243 worktree residue made the selected set legitimately grow to 2).
  const taskId = "gap-test-selection-not-scoped-to-touches";
  // Compute the selected file count at runtime (paths-only; one file per line).
  const sel = runCli(REPO_ROOT, "--task", taskId, "--paths-only").stdout
    .trim().split("\n").filter(Boolean);
  assert.ok(sel.length >= 1, `selector must select ≥1 file for ${taskId}, got ${sel.length}: ${sel.join(",")}`);
  // Run test.sh --for-task pinned to a single non-recursive AC so each selected file contributes
  // exactly one subprocess test (avoids infinite recursion through this file). The pattern names
  // the ORIGINAL AC2 test exactly — the cross-cut AC2 test added by
  // gap-scoped-selection-blind-to-packaging-state-diff also begins with "AC2", so a bare "AC2"
  // pin would now match two tests in this file and break the one-test-per-selected-file
  // relationship below.
  const res = spawnTestSh(["--for-task", taskId, "--test-name-pattern", "direct.*Touches entry resolves to that file"]);
  assert.equal(res.status, 0, `test.sh --for-task must exit 0, got ${res.status}\nstdout: ${res.stdout}\nstderr: ${res.stderr}`);
  const combined = `${res.stdout}\n${res.stderr}`;
  // The pinned AC must have run in the subprocess (plumbing proof).
  assert.match(combined, /AC2 — a direct \*\.test\.mjs Touches entry resolves to that file/, "the pinned AC should run in the subprocess");
  // Relationship: subprocess ran one test per selected file (each file's AC2 = 1 test). Parse the
  // reporter's total and compare against the RUNTIME selected count — not a hardcoded literal.
  const m = combined.match(/ℹ tests (\d+)\b/);
  assert.ok(m, `reporter summary missing: ${combined}`);
  assert.equal(Number(m[1]), sel.length, `subprocess must run exactly ${sel.length} test(s) (one per selected file), ran ${m[1]}: ${combined}`);
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

// ── AC11: scripts/test.sh no-args behavior (grouped layer, gap-test-suite-has-no-layer-grouping) ──

test("AC11 — scripts/test.sh no-args branch is the grouped default (structural)", () => {
  const src = fs.readFileSync(TEST_SH, "utf8");
  // The glob now spans ALL three test dirs (AC2); no-args routes through the grouped default
  // (product,engine, AC4); the exec line derives the default concurrency (gap-no-resource-awareness-
  // heavy-ops-run-blind AC5) and (gap-test-sh-flags-only-...) PREPENDS extra flags-only args before
  // the file list so a user --test-concurrency=N wins (node last-flag-wins).
  assert.match(src, /local glob=\(packages\/\*\/test\/\*\.test\.mjs plugin\/test\/\*\.test\.mjs experiments\/quay-perpetual-stream\/test\/\*\.test\.mjs\)/);
  assert.match(src, /run_selected "\$\(effective_groups\)"/);
  assert.match(src, /effective_groups\(\) \{\n  echo "product,engine"/);
  assert.match(src, /exec node --test --test-concurrency="\$\(default_test_concurrency\)" "\$@" "\$\{files\[@\]\}"/);
  // The explicit-file branch still runs through the same exec line.
  assert.match(src, /exec node --test --test-concurrency="\$\(default_test_concurrency\)" "\$@"/);
});

test("AC11 — scripts/test.sh explicit-file form still runs (smoke, pinned name pattern)", () => {
  // Pinning --test-name-pattern to nothing means node --test loads the file but runs 0 tests,
  // proving the explicit-file passthrough path works without executing this file's own AC10
  // (which would recurse). Fast and hermetic.
  const res = spawnTestSh(["--test-name-pattern", "ZZZ_NO_MATCH_ZZZ", path.join("plugin", "test", "fast-mode-telemetry.test.mjs")]);
  assert.equal(res.status, 0, `explicit-file form must exit 0, got ${res.status}\nstdout: ${res.stdout}\nstderr: ${res.stderr}`);
});
