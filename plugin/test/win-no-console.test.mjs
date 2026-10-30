// @test-group engine
// win-no-console.test.mjs — the Windows no-console preload (plugin/scripts/win-no-console.cjs)
// and its ONE injection definition (plugin/scripts/win-console.ts).
//
// Background: a detached quay process has no console on Windows, so each console-subsystem child
// it launches allocates a VISIBLE console window. `windowsHide` at a spawn site cannot cover the
// parent's own sync execFileSync/execSync calls; the preload can. These tests pin the option
// rewrite and the NODE_OPTIONS string, not the OS behaviour (that arm needs a real Windows host
// and a window-count observer — see the PR body's measured evidence).
//
// Run: node --experimental-strip-types --test plugin/test/win-no-console.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import hook from "../scripts/win-no-console.cjs";
import {
  WIN_NO_CONSOLE_HOOK_BASENAME,
  appendWinConsolePreload,
  resolveWinConsoleHook,
  withWinConsolePreload,
} from "../scripts/win-console.ts";

const { withHide } = hook;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.resolve(__dirname, "..", "scripts");

// ── withHide: merge windowsHide, never disturb the call shape ────────────────────────────────

test("withHide merges windowsHide into an options object", () => {
  const args = withHide("spawn", ["git", ["status"], { cwd: "/x", stdio: "ignore" }]);
  assert.deepEqual(args[2], { cwd: "/x", stdio: "ignore", windowsHide: true });
});

test("withHide inserts an options slot when the call has none", () => {
  assert.deepEqual(withHide("spawn", ["git", ["status"]]), ["git", ["status"], { windowsHide: true }]);
  assert.deepEqual(withHide("spawn", ["git"]), ["git", { windowsHide: true }]);
});

test("withHide inserts BEFORE a trailing callback", () => {
  assert.deepEqual(withHide("exec", ["cmd", () => {}])[1], { windowsHide: true });
});

test("withHide converts the exec-family string-encoding shorthand to an object", () => {
  assert.deepEqual(withHide("execSync", ["git status", "utf8"])[1], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.deepEqual(withHide("execFileSync", ["git", ["status"], "utf8"])[2], {
    encoding: "utf8",
    windowsHide: true,
  });
});

test("withHide fills an explicitly empty options slot instead of appending a 4th argument", () => {
  assert.deepEqual(withHide("spawn", ["git", ["status"], undefined]), ["git", ["status"], { windowsHide: true }]);
  assert.deepEqual(withHide("exec", ["cmd", null, () => {}])[1], { windowsHide: true });
});

// ── NODE_OPTIONS: quoting + idempotence ──────────────────────────────────────────────────────

test("appendWinConsolePreload uses FORWARD SLASHES inside double quotes", () => {
  // Node's NODE_OPTIONS parser eats backslashes as escapes; a native path loses its separators.
  const got = appendWinConsolePreload(undefined, "C:\\Users\\a b\\hook.cjs", "win32");
  assert.equal(got, '--require "C:/Users/a b/hook.cjs"');
});

test("appendWinConsolePreload preserves existing options and is idempotent", () => {
  const first = appendWinConsolePreload("--max-old-space-size=4096", "C:\\hook.cjs", "win32");
  assert.equal(first, '--max-old-space-size=4096 --require "C:/hook.cjs"');
  assert.equal(appendWinConsolePreload(first, "C:/hook.cjs", "win32"), first);
});

test("appendWinConsolePreload is a no-op off Windows", () => {
  assert.equal(appendWinConsolePreload("--x", "C:\\hook.cjs", "linux"), "--x");
});

// ── resolution + env copy ────────────────────────────────────────────────────────────────────

test("resolveWinConsoleHook is null off Windows", () => {
  assert.equal(resolveWinConsoleHook(import.meta.url, "linux"), null);
});

test("resolveWinConsoleHook finds the shipped preload next to plugin/scripts", () => {
  // Probe from a module INSIDE scripts/ (the real callers live there), not from this test file.
  const callerUrl = pathToFileURL(path.join(SCRIPTS, "driver-runtime.ts")).href;
  const found = resolveWinConsoleHook(callerUrl, "win32");
  assert.ok(found, "the preload must resolve on win32");
  assert.equal(path.basename(found), WIN_NO_CONSOLE_HOOK_BASENAME);
  assert.equal(path.dirname(found), SCRIPTS);
});

test("withWinConsolePreload returns a copy carrying the preload and leaves the input untouched", () => {
  const input = { PATH: "/bin", NODE_OPTIONS: "--max-old-space-size=4096" };
  const out = withWinConsolePreload(input, { platform: "win32", hookPath: "C:\\hook.cjs" });
  assert.notEqual(out, input);
  assert.equal(out.PATH, "/bin");
  assert.equal(out.NODE_OPTIONS, '--max-old-space-size=4096 --require "C:/hook.cjs"');
  assert.equal(input.NODE_OPTIONS, "--max-old-space-size=4096");
});

test("withWinConsolePreload returns the SAME env when there is nothing to add", () => {
  const input = { PATH: "/bin" };
  assert.equal(withWinConsolePreload(input, { platform: "linux" }), input);
  // Already present ⇒ no second copy.
  const withHook = withWinConsolePreload(input, { platform: "win32", hookPath: "C:\\hook.cjs" });
  assert.equal(withWinConsolePreload(withHook, { platform: "win32", hookPath: "C:/hook.cjs" }), withHook);
});
