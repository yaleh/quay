// @test-group product
// plugin-root resolution (tasks/gap-plugin-root-resolution-non-skill-entrypoints, SPEC §6b).
//
// The two negative controls are REQUIRED by AC4 and must actually run red when the resolver
// regresses:
//   ① worktree — the resolved plugin root must NEVER be a linked worktree's copy (AC139-4).
//      If `resolvePluginRoot` is changed to return the worktree path, the `mainCheckoutRoot`
//      unit test and the in-worktree branch of the worktree test below go red.
//   ② no-local-plugin — resolution must NOT be `path.join(process.cwd(), "plugin")`. If the
//      resolver is changed back to workspace-root join, the no-local-plugin test below goes red
//      (its temp cwd has no plugin/, so the returned dir would not contain the kernel).

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

import { resolvePluginRoot, resolvePluginScript, mainCheckoutRoot } from "../src/plugin-root.ts";

const KERNEL = path.join("scripts", "driver-runtime.ts");

test("resolvePluginRoot() returns the plugin root containing scripts/driver-runtime.ts", () => {
  const root = resolvePluginRoot();
  assert.ok(root, "must resolve a plugin root");
  assert.ok(
    fs.existsSync(path.join(root, KERNEL)),
    `resolved root ${root} must contain ${KERNEL}`
  );
});

test("resolvePluginScript() returns an existing absolute kernel path", () => {
  const kernel = resolvePluginScript(KERNEL);
  assert.ok(kernel, "must resolve the kernel script");
  assert.ok(path.isAbsolute(kernel), "must be absolute");
  assert.ok(fs.existsSync(kernel), `kernel must exist: ${kernel}`);
});

test("no-local-plugin negative control: resolves WITHOUT a local plugin/ copy (⛔ workspace-root join is red)", () => {
  // A workspace with a config but NO plugin/ dir — the AC168 post-contraction consumer shape.
  const noPluginDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-plugroot-noplugin-"));
  fs.mkdirSync(path.join(noPluginDir, ".quay"));
  fs.writeFileSync(
    path.join(noPluginDir, ".quay", "config.yml"),
    "providers:\n  native:\n    enabled: true\n"
  );
  const prevCwd = process.cwd();
  process.chdir(noPluginDir);
  try {
    const root = resolvePluginRoot();
    assert.ok(root, "must resolve a plugin root even with no plugin/ in the cwd");
    assert.ok(
      fs.existsSync(path.join(root, KERNEL)),
      `resolved root ${root} must contain ${KERNEL}`
    );
    assert.notEqual(
      path.resolve(root),
      path.resolve(noPluginDir, "plugin"),
      "must NOT resolve to <cwd>/plugin (the workspace-root join that AC168 makes dead)"
    );
  } finally {
    process.chdir(prevCwd);
    fs.rmSync(noPluginDir, { recursive: true, force: true });
  }
});

test("worktree negative control: resolution never points at a worktree copy (AC139-4)", () => {
  const root = resolvePluginRoot();
  assert.ok(root, "must resolve a plugin root");
  assert.ok(
    !/(^|\/)quay-worktrees(\/|$)/.test(root),
    `resolved plugin root must not be a quay-worktrees path: ${root}`
  );
  // When this suite runs OUT OF a linked worktree (the fan-in scoped suite), the resolver must
  // have relocated to the MAIN checkout, never the worktree it was loaded from.
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const main = mainCheckoutRoot(moduleDir);
  if (main) {
    assert.ok(
      root === main || root.startsWith(main + path.sep),
      `loaded from a linked worktree → must resolve under main checkout ${main}, got ${root}`
    );
  }
});

test("mainCheckoutRoot() detects inside a linked worktree, null for the main checkout", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "quay-plugroot-wt-"));
  const main = path.join(base, "main");
  const wt = path.join(base, "wt");
  const sh = (cmd) =>
    execFileSync(cmd[0], cmd.slice(1), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  try {
    fs.mkdirSync(main);
    sh(["git", "init", "-q", "-b", "main", main]);
    sh(["git", "-C", main, "config", "user.email", "t@example.com"]);
    sh(["git", "-C", main, "config", "user.name", "t"]);
    fs.writeFileSync(path.join(main, "f.txt"), "x\n");
    sh(["git", "-C", main, "add", "f.txt"]);
    sh(["git", "-C", main, "commit", "-q", "-m", "init"]);
    sh(["git", "-C", main, "worktree", "add", "-q", "-b", "plugroot-wt", wt]);
    // A deep subdir of the worktree — where a loaded module actually lives.
    const sub = path.join(wt, "packages", "quay", "src");
    fs.mkdirSync(sub, { recursive: true });

    assert.equal(mainCheckoutRoot(wt), path.resolve(main), "worktree root → main checkout");
    assert.equal(
      mainCheckoutRoot(sub),
      path.resolve(main),
      "a subdir of the worktree → main checkout"
    );
    assert.equal(mainCheckoutRoot(main), null, "main checkout is not a worktree");
    assert.equal(mainCheckoutRoot(path.join(main, "sub")), null, "main checkout subdir → null");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
