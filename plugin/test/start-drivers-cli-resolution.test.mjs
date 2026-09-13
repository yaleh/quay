// @test-group engine
// start-drivers-cli-resolution.test.mjs —
// tasks/gap-start-drivers-cli-resolve-blind-to-vendor-layout-and-swallows-enoent.
//
// Tests for the TWO independent defects that together made `start-drivers.ts` fail silently on a
// third-party project:
//
//   1. `resolveCliInvocation` only knew ① explicit `--cli` ② `<root>/packages/quay/bin/quay.ts`
//      (quay's OWN dev checkout) ③ `quay` on PATH. `quay-init`'s upgrade-channel migration installs
//      the CLI bundle at `<plugin-root>/vendor/quay/dist/quay.js` and never puts `quay` on PATH, so
//      a third-party root fell straight through to a lookup that could only fail. AC2/AC4 cover the
//      new vendor branch and its precedence.
//   2. `runCli`'s result was judged with `status !== 0` alone. A process that NEVER STARTED has
//      `status === null` + `error.code === "ENOENT"`, so the test was true but carried no reason:
//      the caller relayed an empty stderr and the script exited 1 with ZERO diagnostic bytes —
//      indistinguishable from "read-unable" (硬规则 3b). AC3 covers the classification, AC1 the
//      end-to-end negative control.
//
// Run: scripts/test.sh plugin/test/start-drivers-cli-resolution.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  resolveCliInvocation,
  resolvePluginRoot,
  formatInvocation,
  classifyCliFailure,
  formatCliFailure,
  runCli,
} from "../scripts/start-drivers.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "plugin", "scripts", "start-drivers.ts");

/** Node's own startup noise — filtered before judging "did this script say anything?". */
const NODE_NOISE = /MODULE_TYPELESS_PACKAGE_JSON|ExperimentalWarning|--trace-warnings|^\(node:\d+\)/;

function stripNodeNoise(s) {
  return String(s ?? "").split("\n").filter((l) => !NODE_NOISE.test(l)).join("\n").trim();
}

/** A workspace root (`.quay/config.yml`) with NO `packages/quay/bin/quay.ts` — the third-party shape. */
function makeThirdPartyRoot(parent) {
  const root = path.join(parent, "ws");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(root, ".quay", "config.yml"), "providers: {}\n", "utf8");
  return root;
}

/** A fake plugin root carrying ONLY the bundled vendor CLI (the upgrade-channel layout). */
function makeFakePluginRoot(parent, { withVendor = true } = {}) {
  const pluginRoot = path.join(parent, withVendor ? "plugin" : "plugin-empty");
  const vendor = path.join(pluginRoot, "vendor", "quay", "dist", "quay.js");
  if (withVendor) {
    fs.mkdirSync(path.dirname(vendor), { recursive: true });
    fs.writeFileSync(vendor, "// fake bundled quay CLI — never executed by these tests\n", "utf8");
  } else {
    fs.mkdirSync(pluginRoot, { recursive: true });
  }
  return { pluginRoot, vendor };
}

function tmpdir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), tag));
}

// ── AC2 — the vendor branch ──────────────────────────────────────────────────────────────────

test("AC2 — a root with no source tree resolves to the plugin's BUNDLED vendor CLI, not a PATH lookup", () => {
  const tmp = tmpdir("sdr-res-vendor-");
  try {
    const root = makeThirdPartyRoot(tmp);
    const { pluginRoot, vendor } = makeFakePluginRoot(tmp);

    const inv = resolveCliInvocation(root, undefined, { pluginRoot });

    assert.deepEqual(inv, { argv0: process.execPath, args: [vendor] },
      "must invoke the bundled bundle through node, not fall through to a bare `quay`");
    assert.notEqual(inv.argv0, "quay", "the third-party failure was exactly this PATH fallback");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("AC2 — the derived plugin root (no env, no argument) is <plugin-root>, i.e. the parent of `scripts/`", () => {
  // Pure path arithmetic against the real script location — no bundle needs to exist on disk.
  const derived = resolvePluginRoot({}, "file:///opt/some-plugin/scripts/start-drivers.ts");
  assert.equal(derived, path.resolve("/opt/some-plugin"));

  // CLAUDE_PLUGIN_ROOT is authoritative when the harness provides it.
  assert.equal(resolvePluginRoot({ CLAUDE_PLUGIN_ROOT: "/opt/harness-plugin" }, "file:///opt/other/scripts/start-drivers.ts"),
    path.resolve("/opt/harness-plugin"));

  // A blank env value is "absent", not "the empty path".
  assert.equal(resolvePluginRoot({ CLAUDE_PLUGIN_ROOT: "   " }, "file:///opt/other/scripts/start-drivers.ts"),
    path.resolve("/opt/other"));

  // Not the <plugin-root>/scripts/ layout ⇒ no derivable plugin root (fail-closed, no guesses).
  assert.equal(resolvePluginRoot({}, "file:///opt/some-plugin/bin/start-drivers.ts"), null);
});

// ── AC4 — the precedence, one assertion per branch ───────────────────────────────────────────

test("AC4a — explicit --cli beats source tree, vendor bundle and PATH", () => {
  const tmp = tmpdir("sdr-res-a-");
  try {
    const root = makeThirdPartyRoot(tmp);
    fs.mkdirSync(path.join(root, "packages", "quay", "bin"), { recursive: true });
    fs.writeFileSync(path.join(root, "packages", "quay", "bin", "quay.ts"), "", "utf8");
    const { pluginRoot } = makeFakePluginRoot(tmp);

    const inv = resolveCliInvocation(root, "/tmp/explicit-quay.js", { pluginRoot });
    assert.deepEqual(inv, { argv0: process.execPath, args: [path.resolve("/tmp/explicit-quay.js")] });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("AC4b — the dev source tree beats the vendor bundle", () => {
  const tmp = tmpdir("sdr-res-b-");
  try {
    const root = makeThirdPartyRoot(tmp);
    fs.mkdirSync(path.join(root, "packages", "quay", "bin"), { recursive: true });
    fs.writeFileSync(path.join(root, "packages", "quay", "bin", "quay.ts"), "", "utf8");
    const { pluginRoot } = makeFakePluginRoot(tmp);

    const inv = resolveCliInvocation(root, undefined, { pluginRoot });
    assert.deepEqual(inv.args, ["--experimental-strip-types", path.join(root, "packages", "quay", "bin", "quay.ts")]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("AC4c — the vendor bundle beats PATH (the branch this task added)", () => {
  const tmp = tmpdir("sdr-res-c-");
  try {
    const root = makeThirdPartyRoot(tmp);
    const { pluginRoot, vendor } = makeFakePluginRoot(tmp);

    const inv = resolveCliInvocation(root, undefined, { pluginRoot });
    assert.deepEqual(inv.args, [vendor]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("AC4d — PATH is the last resort, only when there is also no vendor bundle", () => {
  const tmp = tmpdir("sdr-res-d-");
  try {
    const root = makeThirdPartyRoot(tmp);
    const { pluginRoot } = makeFakePluginRoot(tmp, { withVendor: false });

    const inv = resolveCliInvocation(root, undefined, { pluginRoot });
    assert.deepEqual(inv, { argv0: "quay", args: [] });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── AC3 — a never-started process is a distinguishable failure ───────────────────────────────

test("AC3 — runCli on a nonexistent argv0 is judged a failure carrying error.code === 'ENOENT'", () => {
  const missing = "definitely-no-such-binary-quay-resolve-test";
  const inv = { argv0: missing, args: [] };

  const res = runCli(inv, ["driver", "status"]);

  // The reason `status !== 0` alone was not enough: a never-started process has NO status at all.
  assert.equal(res.status, null, "a process that never started has status === null, not a non-zero code");
  assert.ok(res.error, "spawnSync surfaces the reason on `error`");

  const fail = classifyCliFailure(res);
  assert.ok(fail, "a never-started process must classify as a failure (not as success)");
  assert.equal(fail.kind, "spawn");
  assert.equal(fail.code, "ENOENT");

  // …and the caller gets a non-empty, actionable diagnostic (never zero bytes).
  const diag = formatCliFailure(inv, res);
  assert.ok(diag && diag.trim().length > 0, "the caller's stderr must not be empty");
  assert.match(diag, /ENOENT/);
  assert.match(diag, new RegExp(missing), "the attempted argv0 is named");
});

test("AC3 — classifyCliFailure separates success / ran-and-failed / never-started", () => {
  assert.equal(classifyCliFailure({ status: 0, signal: null, error: null }), null);

  const ranAndFailed = classifyCliFailure({ status: 3, signal: null, error: null });
  assert.equal(ranAndFailed.kind, "exit");
  assert.equal(ranAndFailed.code, "3");

  const neverStarted = classifyCliFailure({ status: null, signal: null, error: Object.assign(new Error("nope"), { code: "ENOENT" }) });
  assert.equal(neverStarted.kind, "spawn");
  assert.equal(neverStarted.code, "ENOENT");

  const killed = classifyCliFailure({ status: null, signal: "SIGKILL", error: null });
  assert.equal(killed.kind, "signal");
  assert.equal(killed.code, "SIGKILL");

  assert.match(formatInvocation({ argv0: "/usr/bin/node", args: ["a.js", "--x"] }), /^\/usr\/bin\/node a\.js --x$/);
});

// ── AC1 — the end-to-end negative control ────────────────────────────────────────────────────

test("AC1 — no source tree + no vendor bundle + no `quay` on PATH ⇒ non-empty diagnostic naming the attempted argv0 and ENOENT", () => {
  const tmp = tmpdir("sdr-res-ac1-");
  try {
    const root = makeThirdPartyRoot(tmp);
    const { pluginRoot } = makeFakePluginRoot(tmp, { withVendor: false });

    const r = spawnSync(
      process.execPath,
      ["--experimental-strip-types", SCRIPT, "--root", root, "--host", "127.0.0.1", "--port", "1", "--serve-timeout", "1000"],
      {
        encoding: "utf8",
        timeout: 30000,
        // Empty PATH ⇒ no `quay` to find; a vendor-less CLAUDE_PLUGIN_ROOT ⇒ no bundled bundle either.
        env: { ...process.env, PATH: "", CLAUDE_PLUGIN_ROOT: pluginRoot },
      },
    );

    assert.notEqual(r.status, 0, "an unresolvable CLI must fail the script");

    const diag = stripNodeNoise(`${r.stdout}\n${r.stderr}`);
    assert.ok(diag.length > 0,
      "改后必须非零字节 — the whole defect was 'exit 1 with zero diagnostic bytes' (硬规则 3b: read-unable must not look like this)");
    assert.match(diag, /ENOENT/, "the errno is stated, not swallowed");
    assert.match(diag, /quay/, "the attempted argv0 is stated");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("AC1 — the resolved CLI is self-reported on stderr, so the third-party site can see WHICH quay ran", () => {
  const tmp = tmpdir("sdr-res-report-");
  try {
    const root = makeThirdPartyRoot(tmp);
    const { pluginRoot } = makeFakePluginRoot(tmp, { withVendor: false });

    const r = spawnSync(
      process.execPath,
      ["--experimental-strip-types", SCRIPT, "--root", root, "--host", "127.0.0.1", "--port", "1", "--serve-timeout", "1000"],
      { encoding: "utf8", timeout: 30000, env: { ...process.env, PATH: "", CLAUDE_PLUGIN_ROOT: pluginRoot } },
    );

    const stderr = stripNodeNoise(r.stderr);
    assert.match(stderr, /start-drivers: quay CLI = /, "the selected invocation is reported before any spawn attempt");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
