// @test-group engine
// provider-binding-resolvability-check.test.mjs —
// tasks/gap-pre-fix-upgraded-project-unresolvable-binding-undetected (AC2/AC3).
//
// Pins the ONE judgment that makes the stale-binding defect visible: a provider whose `mcp_entry`
// names its runtime by a BARE word (`quay-native`) is RED **no matter what $PATH holds**, while a
// binding that names a path the project controls is PASS. Both directions are asserted here AND
// through the real CLI exit code, because "the two values are distinguishable" is the whole claim
// (AC1 option ①: ⛔ 不与「解析成功」同形).
//
// AC3 (the test must FAIL when the fix is reverted): the RED direction is carried by
//   - the pure `classifyProvider` row assertion below, and
//   - `plugin/scripts/checker-mutation-cases/provider-binding-resolvability-check.sh`, which
//     structurally re-breaks the checker and asserts it goes RED-then-GREEN.
// Reverting the bare-name branch (treating a separator-less token as accept-worthy) reddens the
// `bare-path-binding is RED` assertions in this file. Verified by actually reverting it — see the
// task record's AC3 section for the pasted before/after output.
//
// Run:
//   scripts/test.sh plugin/test/provider-binding-resolvability-check.test.mjs
//   node --test plugin/test/provider-binding-resolvability-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECKER = path.join(REPO_ROOT, "plugin", "scripts", "provider-binding-resolvability-check.ts");

import {
  classifyProvider,
  runtimeToken,
  RED_STATES,
  NOT_EVALUATED_STATES,
} from "../scripts/provider-binding-resolvability-check.ts";

function makeTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `pbr-${prefix}-`));
}
function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

/** Write a project whose .quay/config.yml is the given provider block (already YAML-indented). */
function makeProject(dir, providerYaml) {
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".quay", "config.yml"),
    `providers:\n${providerYaml}`,
    "utf8",
  );
  return dir;
}

/** Run the real CLI and return { status, stdout, stderr }. */
function runChecker(root, extra = []) {
  const r = spawnSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", CHECKER, "--root", root, ...extra],
    { encoding: "utf8" },
  );
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

// ── runtimeToken: which token NAMES the runtime (by shape, not by keyword) ────────────────────────

test("runtimeToken finds the runtime at index 0 in the legacy bare-PATH form", () => {
  const v = runtimeToken(["quay-native", "mcp"]);
  assert.equal(v.token, "quay-native");
  assert.equal(v.index, 0, "the executable is index 0 here — me[1] is the `mcp` VERB");
});

test("runtimeToken finds the runtime at index 1 in the canonical node form", () => {
  const v = runtimeToken(["node", "./bin/quay-native.ts", "mcp"]);
  assert.equal(v.token, "./bin/quay-native.ts");
  assert.equal(v.index, 1);
});

test("runtimeToken returns null for an entry that names no quay runtime", () => {
  assert.equal(runtimeToken(["node", "./server.js", "mcp"]).token, null);
  assert.equal(runtimeToken([]).token, null);
  assert.equal(runtimeToken(null).token, null);
});

// ── the judgment, both directions (the "can take false" core) ────────────────────────────────────

test("bare-path binding is RED and is classified by FORM, never by $PATH resolution", () => {
  const row = classifyProvider("native", { enabled: true, path: ".", mcp_entry: ["quay-native", "mcp"] }, "/nonexistent");
  assert.equal(row.state, "bare-path-name");
  assert.equal(row.resolved, null, "a bare name resolves to no path the project controls");
  assert.equal(RED_STATES.has(row.state), true);
});

test("absolute binding to an existing file is PASS (the migrated shape)", () => {
  const dir = makeTmp("abs");
  try {
    const rt = path.join(dir, "vendor", "quay-native", "dist", "quay-native.js");
    fs.mkdirSync(path.dirname(rt), { recursive: true });
    fs.writeFileSync(rt, "// runtime\n", "utf8");
    const row = classifyProvider(
      "native",
      { enabled: true, path: ".", mcp_entry: ["node", rt, "mcp"] },
      dir,
    );
    assert.equal(row.state, "path-resolved");
    assert.equal(row.exists, true);
    assert.equal(RED_STATES.has(row.state), false);
  } finally {
    cleanup(dir);
  }
});

test("relative binding resolves against the PROVIDER DIR, not the workspace root", () => {
  // This is the host repo's own shape (`path: ./packages/quay-native`, `mcp_entry: ./bin/…`).
  // Judging it against the workspace root instead would mis-detect the live repo as dangling —
  // the exact false-alarm the production carrier (AC2, the repo's own config) would catch.
  const dir = makeTmp("rel");
  try {
    const rt = path.join(dir, "packages", "quay-native", "bin", "quay-native.ts");
    fs.mkdirSync(path.dirname(rt), { recursive: true });
    fs.writeFileSync(rt, "// runtime\n", "utf8");
    const inProviderDir = classifyProvider(
      "native",
      { enabled: true, path: "./packages/quay-native", mcp_entry: ["node", "./bin/quay-native.ts", "mcp"] },
      dir,
    );
    assert.equal(inProviderDir.baseDir, path.join(dir, "packages", "quay-native"));
    assert.equal(inProviderDir.state, "path-resolved");

    // Negative control for the same rule: the SAME token with the file absent is RED, so the
    // PASS above is not a constant.
    fs.rmSync(rt);
    assert.equal(
      classifyProvider(
        "native",
        { enabled: true, path: "./packages/quay-native", mcp_entry: ["node", "./bin/quay-native.ts", "mcp"] },
        dir,
      ).state,
      "dangling-relative",
    );
  } finally {
    cleanup(dir);
  }
});

test("dangling absolute binding is RED", () => {
  const row = classifyProvider(
    "native",
    { enabled: true, path: ".", mcp_entry: ["node", "/nonexistent/quay-native.js", "mcp"] },
    "/tmp",
  );
  assert.equal(row.state, "dangling-absolute");
  assert.equal(RED_STATES.has(row.state), true);
});

test("a missing value never shares an output with 合格 (硬规则 3b/6)", () => {
  const noEntry = classifyProvider("native", { enabled: true, path: "." }, "/tmp");
  assert.equal(noEntry.state, "no-mcp-entry");
  const unrecognized = classifyProvider(
    "native",
    { enabled: true, path: ".", mcp_entry: ["node", "./server.js", "mcp"] },
    "/tmp",
  );
  assert.equal(unrecognized.state, "unrecognized-shape");
  assert.equal(NOT_EVALUATED_STATES.has(noEntry.state), true);
  assert.equal(NOT_EVALUATED_STATES.has(unrecognized.state), true);
  // Neither not-evaluated state may be readable as a pass.
  assert.equal(RED_STATES.has(noEntry.state), false);
  assert.notEqual(noEntry.state, "path-resolved");
  assert.notEqual(unrecognized.state, "path-resolved");
});

// ── the REAL CLI: the two values must be distinguishable at the exit-code surface ─────────────────

test("CLI exits 1 on the legacy bare-PATH site form and 0 on the migrated form", () => {
  const legacy = makeTmp("cli-legacy");
  const migrated = makeTmp("cli-migrated");
  try {
    makeProject(legacy, "  native:\n    enabled: true\n    path: .\n    mcp_entry:\n    - quay-native\n    - mcp\n");
    const rt = path.join(migrated, "vendor", "quay-native", "dist", "quay-native.js");
    fs.mkdirSync(path.dirname(rt), { recursive: true });
    fs.writeFileSync(rt, "// runtime\n", "utf8");
    makeProject(
      migrated,
      `  native:\n    enabled: true\n    path: .\n    mcp_entry:\n    - node\n    - ${rt}\n    - mcp\n`,
    );

    const bad = runChecker(legacy);
    const good = runChecker(migrated);
    assert.equal(bad.status, 1, `legacy must be RED, got ${bad.status}: ${bad.stdout}${bad.stderr}`);
    assert.match(bad.stdout, /bare-path-name/);
    assert.equal(good.status, 0, `migrated must be GREEN, got ${good.status}: ${good.stdout}${good.stderr}`);
    assert.match(good.stdout, /path-resolved/);
    assert.notEqual(bad.status, good.status, "the two readings must be distinguishable");
  } finally {
    cleanup(legacy);
    cleanup(migrated);
  }
});

test("CLI exits 3 (NOT-EVALUATED) on a root with no config — never 0", () => {
  const dir = makeTmp("cli-noconfig");
  try {
    const r = runChecker(dir);
    assert.equal(r.status, 3, `expected NOT-EVALUATED, got ${r.status}`);
    assert.match(r.stderr, /NOT-EVALUATED/);
  } finally {
    cleanup(dir);
  }
});

test("CLI exits 3 when no provider has a judgeable binding — never 0", () => {
  const dir = makeTmp("cli-unrecognized");
  try {
    makeProject(dir, "  native:\n    enabled: true\n    path: .\n    mcp_entry:\n    - node\n    - ./server.js\n    - mcp\n");
    const r = runChecker(dir);
    assert.equal(r.status, 3, `expected NOT-EVALUATED, got ${r.status}: ${r.stdout}`);
  } finally {
    cleanup(dir);
  }
});

test("CLI accepts --json and emits a machine-readable report", () => {
  const dir = makeTmp("cli-json");
  try {
    makeProject(dir, "  native:\n    enabled: true\n    path: .\n    mcp_entry:\n    - quay-native\n    - mcp\n");
    const r = runChecker(dir, ["--json"]);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.status, "fail");
    assert.equal(parsed.ok, false);
    assert.equal(parsed.states["bare-path-name"], 1);
    assert.equal(parsed.providers[0].runtimeToken, "quay-native");
  } finally {
    cleanup(dir);
  }
});

// ── production carrier: this repository's OWN config must be 合格 ──────────────────────────────────

test("this repository's own .quay/config.yml is PASS (real input, not a fixture)", () => {
  const r = runChecker(REPO_ROOT);
  assert.equal(r.status, 0, `the repo's own binding must be path-resolved, got ${r.status}: ${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /path-resolved/);
});

// ── AC6 of gap-config-validate-requires-mcp-entry-contradicts-native-default-resolver ─────────────
// The canonical NEW-INSTALL form (`quay-init` writes a native provider with NO path/mcp_entry — Core
// resolves it from the plugin root) must NOT be read as a PASS by this checker: it has no binding in
// the config to judge, so its honest answer is NOT-EVALUATED (exit 3), never "合格".
//
// This is the 空转-vs-honest characterization: the checker does not silently go green on the omitted
// form. Pinning it means a future "make the checker resolve native defaults" change must be a
// deliberate edit here, not an accident (硬规则 3b).
test("native provider that OMITS path/mcp_entry is NOT-EVALUATED (exit 3), never PASS", () => {
  const dir = makeTmp("native-omitted");
  try {
    makeProject(dir, "  native:\n    enabled: true\n");
    const r = runChecker(dir, ["--json"]);
    assert.equal(r.status, 3, `omitted native binding must be NOT-EVALUATED, got ${r.status}: ${r.stdout}${r.stderr}`);
    // A NOT-EVALUATED verdict is emitted on STDERR deliberately (never on the pass/fail report
    // stream) — so the machine-readable half lives there.
    const parsed = JSON.parse(r.stdout || r.stderr);
    assert.equal(parsed.status, "not-evaluated");
    assert.equal(parsed.providers[0].state, "no-mcp-entry");
    assert.equal(parsed.judged, 0, "nothing was judged");
    assert.equal(parsed.failed, 0, "and nothing was failed — NOT-EVALUATED is its own outcome");
  } finally {
    cleanup(dir);
  }
});
