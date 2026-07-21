// live-b-provider-env.test.mjs — direct offline unit test for the PURE Core
// function resolveProviderEnv() in packages/quay/src/provider-env.js (M76,
// LIVE-batch B / DIR-044-LIVE).
//
// resolveProviderEnv(cfg, provider) is the single shared env-resolution leg
// that bin/quay.js, src/mcp-server.js, and src/serve.js all call (QN-045).
// Its contract (per the module's own header comment):
//   - iterate provider.env's entries;
//   - a STRING value that starts with "./" or "../" is a relative path and is
//     resolved to an ABSOLUTE path against cfg.workspaceRoot;
//   - anything else (non-path strings like "owner/repo", or non-strings) is
//     passed through VERBATIM;
//   - a missing/undefined provider.env yields an empty object.
//
// The only existing tests that touch this function (provider-env-symmetry,
// gap002-create-ergonomics) exercise it INDIRECTLY through the whole
// server/CLI stack and never import it — so its per-branch behavior has no
// direct unit coverage. This file adds that, fully offline (no network, no
// GitHub, no spawned process): it is a pure string/path computation.
//
// Run: node --test packages/quay/test/live-b-provider-env.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { resolveProviderEnv } from "../src/provider-env.ts";

const cfg = { workspaceRoot: "/ws/root" };

test("resolveProviderEnv resolves a './'-prefixed relative path to an absolute path against workspaceRoot", () => {
  const env = resolveProviderEnv(cfg, { env: { QUAY_NATIVE_TASKS_DIR: "./tasks" } });
  assert.equal(env.QUAY_NATIVE_TASKS_DIR, path.resolve("/ws/root", "./tasks"));
  // The resolved value must be absolute (the whole point of the resolution leg).
  assert.equal(path.isAbsolute(env.QUAY_NATIVE_TASKS_DIR), true);
  // And it must equal the expected concrete absolute path, not merely "absolute".
  assert.equal(env.QUAY_NATIVE_TASKS_DIR, "/ws/root/tasks");
});

test("resolveProviderEnv resolves a '../'-prefixed relative path upward from workspaceRoot", () => {
  const env = resolveProviderEnv(cfg, { env: { DIR: "../sibling/tasks" } });
  assert.equal(env.DIR, "/ws/sibling/tasks");
  assert.equal(path.isAbsolute(env.DIR), true);
});

test("resolveProviderEnv passes NON-path string values through verbatim (e.g. an owner/repo)", () => {
  const env = resolveProviderEnv(cfg, {
    env: { GITHUB_REPO: "yaleh/quay", QUAY_GITHUB_TOKEN: "ghp_secret" },
  });
  // "yaleh/quay" contains a slash but does NOT start with ./ or ../, so it is
  // an opaque config value, not a relative path — it must be untouched.
  assert.equal(env.GITHUB_REPO, "yaleh/quay");
  assert.equal(env.QUAY_GITHUB_TOKEN, "ghp_secret");
});

test("resolveProviderEnv only treats a leading ./ or ../ as a path — an interior ./ is verbatim", () => {
  const env = resolveProviderEnv(cfg, { env: { WEIRD: "a/./b", DOT: "." } });
  // Neither starts with "./" or "../", so both pass through unchanged.
  assert.equal(env.WEIRD, "a/./b");
  assert.equal(env.DOT, ".");
});

test("resolveProviderEnv passes NON-string values through verbatim (no path logic applied)", () => {
  const provider = { env: { PORT: 8080, FLAG: true, NOTHING: null } };
  const env = resolveProviderEnv(cfg, provider);
  assert.equal(env.PORT, 8080);
  assert.equal(env.FLAG, true);
  assert.equal(env.NOTHING, null);
});

test("resolveProviderEnv returns an empty object (not undefined) when provider.env is missing", () => {
  assert.deepEqual(resolveProviderEnv(cfg, {}), {});
  assert.deepEqual(resolveProviderEnv(cfg, { env: undefined }), {});
});

test("resolveProviderEnv resolves multiple keys independently in one pass (mixed path + verbatim)", () => {
  const env = resolveProviderEnv(cfg, {
    env: { A: "./a", B: "keep-me", C: "../c" },
  });
  assert.deepEqual(env, {
    A: "/ws/root/a",
    B: "keep-me",
    C: "/ws/c",
  });
});
