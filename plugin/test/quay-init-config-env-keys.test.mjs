// @test-group serial
// @load-sensitive real-install
// @load-sensitive-entry 2026-09-14 carrier-env pins (quay-init --loop install); install family
// gap-quay-init-omits-adr-goal-meta-dir-env-third-party-leak — AC3 / AC4 regression pins.
//
// WHAT THIS PINS. A quay-init'd project must carry an EXPLICIT pin for every provider CARRIER dir
// (tasks + its siblings adr/ goals/ meta/), not just tasks:
//
//   AC3 — a FRESH install's `.quay/config.yml` has all four QUAY_NATIVE_*_DIR keys under
//         providers.native.env. Only QUAY_NATIVE_TASKS_DIR used to be written; the other three
//         resolved through the provider package's own location, so a third-party project's
//         goal/adr/meta stores silently bound to whichever quay workspace sat above that package
//         (measured 2026-09-13: `goal list` in a real project returned quay's AC-143…AC-157).
//         (The root-cause half of that defect is fixed independently in
//         packages/quay-native/src/carrier-dirs.ts — see that module's own test. This file pins the
//         config-surface half: the isolation must be VISIBLE in the file the user owns.)
//
//   AC4 — an EXISTING config that lacks the three sibling pins is backfilled IDEMPOTENTLY:
//         a user's own values survive, the other keys keep their order and formatting, and a config
//         already carrying all four is left byte-for-byte untouched (no write at all ⇒ no diff).
//
// WHY IT SPAWNS THE REAL SCRIPT (not a fixture of the function): AC3/AC4 are claims about what
// `quay-init.sh` produces on disk. A unit test of `ensure_provider_carrier_env` alone would pass
// while the function sat uncalled — the exact "implemented but never wired" failure this repo has
// hit before (hard rule 4 推论三: a criterion satisfiable only by an injected seam proves
// "can produce", not "produced"). So the assertions read the file the install actually wrote.
//
// RED CONTROL: the backfill assertions run against a config shaped like a pre-pin install (one env
// key). Reverting `ensure_provider_carrier_env`'s call site in write_config makes AC4's tests fail
// with the missing keys listed — verified 2026-09-14 by deleting the call and re-running.
//
// Run: scripts/test.sh plugin/test/quay-init-config-env-keys.test.mjs
//      node --test plugin/test/quay-init-config-env-keys.test.mjs

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");

const CARRIER_KEYS = [
  "QUAY_NATIVE_TASKS_DIR",
  "QUAY_NATIVE_ADR_DIR",
  "QUAY_NATIVE_GOAL_DIR",
  "QUAY_NATIVE_META_DIR",
];

const _tmp = [];
function makeTmp(prefix = "qinit-carrier-") {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  _tmp.push(d);
  return d;
}
function diskWorktreeRoot() {
  const d = fs.mkdtempSync(path.join("/var/tmp", "qinit-carrier-wt-"));
  _tmp.push(d);
  return d;
}
after(() => {
  for (const d of _tmp) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

// ONE worktree root per workspace, reused across that workspace's runs. A fresh root per run would
// change `loop.worktree_root` and make `ensure_loop_config` legitimately rewrite the file — which
// would make the idempotency assertions below measure the test's own churn instead of the product.
const _wtRoots = new Map();
function stableWorktreeRoot(ws) {
  if (!_wtRoots.has(ws)) _wtRoots.set(ws, diskWorktreeRoot());
  return _wtRoots.get(ws);
}

/** Run the REAL quay-init.sh --loop against `ws`, returning {status, stdout, stderr}. */
function runInit(ws, extraArgs = []) {
  const res = spawnSync(
    "bash",
    [path.join(pluginDir, "scripts", "quay-init.sh"), "--loop", "--root", ws,
     "--test-command", "node --test", "--worktree-root", stableWorktreeRoot(ws), ...extraArgs],
    { cwd: ws, encoding: "utf8", env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginDir } },
  );
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function readConfig(ws) {
  return fs.readFileSync(path.join(ws, ".quay", "config.yml"), "utf8");
}

/** The providers.native.env map, parsed from the written YAML. */
function nativeEnv(ws) {
  const cfg = YAML.parse(readConfig(ws));
  const env = cfg?.providers?.native?.env;
  assert.ok(
    env && typeof env === "object",
    `precondition: providers.native.env must be a map; config was:\n${readConfig(ws)}`,
  );
  return env;
}

const PLUGIN_NATIVE = path.join(pluginDir, "vendor", "quay-native");
const PLUGIN_NATIVE_BUNDLE = path.join(PLUGIN_NATIVE, "dist", "quay-native.js");

/**
 * A pre-pin config — what an install made before the carrier pins existed left behind.
 *
 * `currentBinding` selects which UPGRADE the fixture exercises:
 *   true  — the provider binding is already current, so `migrate_stale_mcp_entry` is a NO-OP and the
 *           only writer is `ensure_provider_carrier_env`. That is the isolating shape: any formatting
 *           change in the file is attributable to the function under test.
 *   false — the legacy dangling binding (`./node_modules/quay-native`), so the runtime migration ALSO
 *           fires. That migration rewrites the document through yaml.safe_dump (it drops comments and
 *           reformats `mcp_entry`), so this shape asserts only what the pins must guarantee, never
 *           formatting.
 */
function writeLegacyConfig(ws, { extraKey = true, tasksValue, currentBinding = true } = {}) {
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(ws, "tasks"), { recursive: true });
  const tasks = tasksValue ?? "./tasks";
  const extra = extraKey ? '      MY_CUSTOM_KEY: "keep-me"\n' : "";
  const pathLine = currentBinding ? `    path: "${PLUGIN_NATIVE}"\n` : '    path: "./node_modules/quay-native"\n';
  const entryLine = currentBinding
    ? `    mcp_entry: ["node", "${PLUGIN_NATIVE_BUNDLE}", "mcp"]\n`
    : '    mcp_entry: ["node", "./bin/quay-native.js", "mcp"]\n';
  const content =
    "# a user comment that must survive the upgrade\n" +
    "providers:\n" +
    "  native:\n" +
    "    enabled: true\n" +
    pathLine +
    '    tasks_dir: "./tasks"\n' +
    entryLine +
    "    env:\n" +
    `      QUAY_NATIVE_TASKS_DIR: "${tasks}"\n` +
    extra +
    "  github:\n" +
    "    enabled: false\n" +
    "loop:\n" +
    `  repo_root: ${ws}\n` +
    "  test_command: node --test\n" +
    "  tmux_session: null\n" +
    "  worktree_root: " + stableWorktreeRoot(ws) + "\n" +
    "  fork_baseline: develop\n";
  fs.writeFileSync(path.join(ws, ".quay", "config.yml"), content, "utf8");
  return content;
}

// ── AC3 — a fresh install pins all four carrier dirs ───────────────────────────────────────────

describe("AC3 — fresh install pins every carrier dir", () => {
  test("providers.native.env carries all four QUAY_NATIVE_*_DIR keys", () => {
    const ws = makeTmp();
    const { status, stdout, stderr } = runInit(ws);
    assert.equal(status, 0, `quay-init must succeed; stderr:\n${stderr}`);

    const env = nativeEnv(ws);
    // ENUMERATE, not boolean (hard rule 3): report the whole key set on failure.
    const keys = Object.keys(env);
    for (const k of CARRIER_KEYS) {
      assert.ok(
        Object.hasOwn(env, k),
        `fresh install must pin ${k}; providers.native.env has: ${JSON.stringify(keys)}`,
      );
    }
    // The three sibling pins must point OUTSIDE the quay repo — that is the whole defect.
    for (const k of CARRIER_KEYS.slice(1)) {
      assert.ok(
        !String(env[k]).includes("/plugin/vendor/") && !path.resolve(ws, String(env[k])).startsWith(pluginDir),
        `${k} must resolve inside the project, not the plugin tree; got ${env[k]}`,
      );
    }
    assert.match(stdout + stderr, /wrote: \.quay\/config\.yml/);
  });

  test("the pinned sibling dirs are the project's own (each resolves under the workspace)", () => {
    const ws = makeTmp();
    assert.equal(runInit(ws).status, 0);
    const env = nativeEnv(ws);
    const expect = {
      QUAY_NATIVE_TASKS_DIR: path.join(ws, "tasks"),
      QUAY_NATIVE_ADR_DIR: path.join(ws, "adr"),
      QUAY_NATIVE_GOAL_DIR: path.join(ws, "goals"),
      QUAY_NATIVE_META_DIR: path.join(ws, "meta"),
    };
    const actual = Object.fromEntries(
      CARRIER_KEYS.map((k) => [k, path.resolve(ws, String(env[k]))]),
    );
    assert.deepEqual(actual, expect, `carrier pins must name the project's own dirs; got ${JSON.stringify(actual)}`);
  });
});

// ── AC4 — an existing pre-pin config is backfilled, idempotently and minimally ─────────────────

describe("AC4 — existing configs are backfilled idempotently", () => {
  test("backfills the three missing pins without touching a user's own keys", () => {
    const ws = makeTmp();
    const before = writeLegacyConfig(ws);
    const { status, stderr } = runInit(ws);
    assert.equal(status, 0, `quay-init must succeed; stderr:\n${stderr}`);

    const env = nativeEnv(ws);
    for (const k of CARRIER_KEYS) {
      assert.ok(Object.hasOwn(env, k), `backfill must add ${k}; env keys: ${JSON.stringify(Object.keys(env))}`);
    }
    assert.equal(env.MY_CUSTOM_KEY, "keep-me", "a user's own env key must survive the upgrade");
    assert.equal(
      env.QUAY_NATIVE_TASKS_DIR,
      "./tasks",
      "the pre-existing tasks pin must NOT be rewritten (user value wins)",
    );
    // The comment, the neighbouring provider and the key ORDER all survive: a line-level insert,
    // not a yaml round-trip (a round-trip would strip the comment and reformat mcp_entry).
    const after = readConfig(ws);
    assert.match(after, /# a user comment that must survive the upgrade/, "comments must survive");
    assert.match(after, /^  github:$/m, "the sibling provider entry must survive");
    assert.ok(
      after.indexOf("MY_CUSTOM_KEY") < after.indexOf("QUAY_NATIVE_ADR_DIR"),
      "the added pins go AFTER the keys already present (existing order preserved)",
    );
    assert.notEqual(after, before, "the upgrade did change the file");
  });

  test("backfills even when the runtime migration ALSO fires (legacy dangling binding)", () => {
    // The realistic pre-pin upgrade: provider.path still points at ./node_modules/quay-native, so
    // migrate_stale_mcp_entry rewrites the document as well. Formatting is NOT asserted here — that
    // migration's yaml round-trip is entitled to reformat, and pinning it would be asserting someone
    // else's contract. What must hold: the pins land and the file stays valid.
    const ws = makeTmp();
    writeLegacyConfig(ws, { currentBinding: false });
    const { status, stderr } = runInit(ws);
    assert.equal(status, 0, `quay-init must succeed; stderr:\n${stderr}`);

    const env = nativeEnv(ws);
    for (const k of CARRIER_KEYS) {
      assert.ok(Object.hasOwn(env, k), `backfill must add ${k}; env keys: ${JSON.stringify(Object.keys(env))}`);
    }
    assert.equal(env.MY_CUSTOM_KEY, "keep-me", "a user's own env key must survive a double migration");
    assert.equal(
      YAML.parse(readConfig(ws)).providers.native.env.QUAY_NATIVE_ADR_DIR,
      "./adr",
      "the tasks pin in this fixture is relative, so the mirrored sibling value is relative too",
    );
  });

  test("mirrors the form of the existing tasks pin (relative stays relative)", () => {
    const ws = makeTmp();
    writeLegacyConfig(ws, { tasksValue: "./tasks" });
    assert.equal(runInit(ws).status, 0);
    const env = nativeEnv(ws);
    assert.equal(env.QUAY_NATIVE_ADR_DIR, "./adr");
    assert.equal(env.QUAY_NATIVE_GOAL_DIR, "./goals");
    assert.equal(env.QUAY_NATIVE_META_DIR, "./meta");
  });

  test("mirrors the form of the existing tasks pin (absolute stays absolute)", () => {
    const ws = makeTmp();
    const absTasks = path.join(ws, "tasks");
    writeLegacyConfig(ws, { tasksValue: absTasks });
    assert.equal(runInit(ws).status, 0);
    const env = nativeEnv(ws);
    assert.equal(env.QUAY_NATIVE_ADR_DIR, path.join(ws, "adr"));
    assert.equal(env.QUAY_NATIVE_GOAL_DIR, path.join(ws, "goals"));
    assert.equal(env.QUAY_NATIVE_META_DIR, path.join(ws, "meta"));
  });

  test("is a NO-OP on a config that already carries all four (byte-for-byte, no diff)", () => {
    const ws = makeTmp();
    assert.equal(runInit(ws).status, 0, "first install");
    const afterFirst = readConfig(ws);

    const second = runInit(ws);
    assert.equal(second.status, 0, "second install");
    assert.match(
      second.stdout,
      /unchanged: \.quay\/config\.yml providers\.native\.env: \(four carrier dirs already pinned/,
      `the no-op must be REPORTED as a no-op; stdout was:\n${second.stdout}`,
    );
    assert.equal(
      readConfig(ws),
      afterFirst,
      "re-running quay-init over a fully-pinned config must not change a single byte",
    );

    // And the same holds for a backfilled legacy config (the upgrade is idempotent, not just the
    // fresh path): run 2 over the backfilled file must also be byte-identical.
    const ws2 = makeTmp();
    writeLegacyConfig(ws2);
    assert.equal(runInit(ws2).status, 0);
    const backfilled = readConfig(ws2);
    assert.equal(runInit(ws2).status, 0);
    assert.equal(readConfig(ws2), backfilled, "a backfilled config must be stable on re-run");
  });
});

// ── the backfill must not be a blind string append ─────────────────────────────────────────────

describe("backfill writes valid YAML, not text soup", () => {
  test("the resulting config re-parses and keeps providers.native.env a map", () => {
    const ws = makeTmp();
    writeLegacyConfig(ws);
    assert.equal(runInit(ws).status, 0);
    const parsed = YAML.parse(readConfig(ws));
    assert.equal(typeof parsed.providers.native.env, "object");
    assert.equal(parsed.providers.native.tasks_dir, "./tasks");
    assert.equal(parsed.providers.github.enabled, false, "the sibling provider survives parsing");
  });
});
