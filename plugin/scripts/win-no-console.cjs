"use strict";
// plugin/scripts/win-no-console.cjs — Windows-only child-process preload.
//
// WHY THIS FILE EXISTS
// A detached process on Windows (DETACHED_PROCESS, which `spawn(..., { detached: true })`
// produces) has NO console. Any console-subsystem program it launches afterwards — bash, node,
// git, powershell — makes Windows allocate a NEW console, and that console is a visible window.
// The quay anchor is spawned detached and its kind loops run in-process, so every synchronous
// `execFileSync("git", …)` executed by a loop pops a window on the user's desktop, roughly once
// per round. `windowsHide: true` at the individual spawn sites fixes only that one call: the
// child gets CREATE_NO_WINDOW, but the sync `execFileSync`/`execSync` APIs in the PARENT process
// are not affected (two measured A/B arms, 2026-10-27: spawn-site-only still produced 12 new
// ConsoleWindowClass windows in 25 s).
//
// The only reliable boundary is a process-start preload: NODE_OPTIONS="--require <this file>"
// runs before the main ES module graph is instantiated, so every later `import { execFileSync }
// from "node:child_process"` binding captures the patched function. Patching from inside the
// graph does NOT work — ESM builtin named imports are bound at instantiation, and
// `--import data:` was measured to run too late (2026-10-27).
//
// SCOPE: Windows only. On every other platform install() is a no-op, so the same injection can
// be applied unconditionally by the callers.
//
// Exported shape is intentionally small so the option-merge is unit-testable without spawning:
//   withHide(name, args) — pure: the option rewrite applied to one child_process call
//   install()            — idempotent: wraps the seven public APIs + ChildProcess.prototype.spawn

const cp = require("node:child_process");

// These four also accept a bare string as `options` (the encoding shorthand). Rewriting it to an
// object is what lets the call keep its encoding AND gain windowsHide.
const STRING_OPTION_FNS = new Set(["exec", "execFile", "execSync", "execFileSync"]);

function isPlainOptions(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v) && typeof v !== "function";
}

/**
 * Return a copy of one child_process call's argument list with `windowsHide: true` merged in.
 * `name` decides whether a trailing string may be an options-encoding shorthand.
 */
function withHide(name, args) {
  const out = Array.prototype.slice.call(args);
  const last = out.length - 1;
  const hasCallback = last >= 0 && typeof out[last] === "function";
  const optIdx = hasCallback ? last - 1 : last;
  const candidate = optIdx >= 0 ? out[optIdx] : undefined;

  if (isPlainOptions(candidate)) {
    out[optIdx] = Object.assign({}, candidate, { windowsHide: true });
    return out;
  }
  // An explicitly empty options slot (spawn(cmd, args, undefined) / exec(cmd, null, cb)) is
  // still an options slot: appending a fourth argument would be ignored by the call.
  if (optIdx >= 1 && (candidate === undefined || candidate === null)) {
    out[optIdx] = { windowsHide: true };
    return out;
  }
  // Exec-family only, and optIdx >= 1 so the first argument (command/file) is never mistaken
  // for the options slot.
  if (optIdx >= 1 && STRING_OPTION_FNS.has(name) && typeof candidate === "string") {
    out[optIdx] = { encoding: candidate, windowsHide: true };
    return out;
  }
  // No options slot at all (spawn("cmd"), spawn("cmd", args), fork("mod")).
  if (hasCallback) out.splice(last, 0, { windowsHide: true });
  else out.push({ windowsHide: true });
  return out;
}

function install() {
  if (process.platform !== "win32") return false;
  if (cp.__quayWinNoConsoleInstalled) return false;
  Object.defineProperty(cp, "__quayWinNoConsoleInstalled", { value: true, enumerable: false });

  for (const name of ["spawn", "spawnSync", "exec", "execFile", "execFileSync", "execSync", "fork"]) {
    const orig = cp[name];
    if (typeof orig !== "function") continue;
    cp[name] = function patched(...args) {
      return orig.apply(this, withHide(name, args));
    };
  }

  // Backstop for callers that construct ChildProcess directly (cross-spawn and friends):
  // every asynchronous spawn funnels through this prototype method. Sync APIs do NOT, which is
  // why the seven wrappers above are still required.
  const CP = cp.ChildProcess;
  if (CP && typeof CP.prototype.spawn === "function") {
    const origSpawn = CP.prototype.spawn;
    CP.prototype.spawn = function patchedSpawn(options) {
      return origSpawn.call(this, Object.assign({}, options, { windowsHide: true }));
    };
  }
  return true;
}

install();

module.exports = { withHide, install };
