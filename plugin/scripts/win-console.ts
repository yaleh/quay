// plugin/scripts/win-console.ts — the ONE definition of the Windows no-console preload.
//
// Background (the bug this exists for): a detached quay process on Windows has no console, so
// every console-subsystem child it launches (`bash`, `node`, `git`, …) makes Windows allocate a
// visible console window. `windowsHide: true` only fixes the call it is attached to; the sync
// `execFileSync`/`execSync` calls issued BY the anchor itself cannot be fixed at the call site
// (they are not spawned through ChildProcess). The reliable boundary is a process-start preload —
// see plugin/scripts/win-no-console.cjs's header for the measured A/B evidence.
//
// This module owns the two things every spawn boundary must agree on:
//   1. WHERE the preload lives (source layout `plugin/scripts/` vs bundled layout
//      `plugin/scripts/dist/`), and
//   2. HOW it is appended to NODE_OPTIONS (quoting matters — see appendPreload).
//
// The rewrite is a no-op off Windows, so callers apply it unconditionally.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const WIN_NO_CONSOLE_HOOK_BASENAME = "win-no-console.cjs";

/**
 * Locate the preload relative to the calling module. Source: `<dir>/win-no-console.cjs`.
 * Bundled: `<dir>/../win-no-console.cjs` (the bundle lives in `scripts/dist/`).
 * Returns null off Windows or when neither location exists (the caller then behaves exactly as
 * before — an absent hook must never turn a spawn into a failure).
 */
export function resolveWinConsoleHook(
  moduleUrl: string = import.meta.url,
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (platform !== "win32") return null;
  let dir: string;
  try {
    dir = path.dirname(fileURLToPath(moduleUrl));
  } catch {
    return null;
  }
  const candidates = [
    path.join(dir, "..", WIN_NO_CONSOLE_HOOK_BASENAME),
    path.join(dir, WIN_NO_CONSOLE_HOOK_BASENAME),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Append `--require <hook>` to one NODE_OPTIONS string.
 *
 * Windows quoting is load-bearing: Node's NODE_OPTIONS parser consumes BACKSLASHES as escapes,
 * so a native `C:\Users\…` path loses its separators and the preload fails to load (measured
 * 2026-10-27). Forward slashes inside double quotes work for both spaced and unspaced paths.
 * Idempotent: a second call with the same hook adds nothing.
 */
export function appendWinConsolePreload(
  nodeOptions: string | undefined,
  hookPath: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (platform !== "win32" || !hookPath) return nodeOptions;
  const posix = hookPath.replace(/\\/g, "/");
  const current = (nodeOptions ?? "").trim();
  if (current.includes(posix)) return nodeOptions;
  const flag = `--require "${posix}"`;
  return current ? `${current} ${flag}` : flag;
}

/** Return a copy of `env` carrying the preload; the same object when there is nothing to add. */
export function withWinConsolePreload(
  env: NodeJS.ProcessEnv,
  opts: { moduleUrl?: string; platform?: NodeJS.Platform; hookPath?: string | null } = {},
): NodeJS.ProcessEnv {
  const platform = opts.platform ?? process.platform;
  if (platform !== "win32") return env;
  const hook = opts.hookPath === undefined
    ? resolveWinConsoleHook(opts.moduleUrl ?? import.meta.url, platform)
    : opts.hookPath;
  if (!hook) return env;
  const next = appendWinConsolePreload(env.NODE_OPTIONS, hook, platform);
  if (next === env.NODE_OPTIONS) return env;
  return { ...env, NODE_OPTIONS: next };
}
