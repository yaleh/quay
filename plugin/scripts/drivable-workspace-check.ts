#!/usr/bin/env node
// drivable-workspace-check.ts — DIR-062 child A [halt-free]: fail-closed gate over
// `drivable-workspaces.yml`, the human-authorized registry of workspaces the quay
// autonomous loop may use as validation/experimentation targets.
//
// Given one or more workspace paths, PASS (exit 0) iff EVERY path is covered by the
// registry — either under its `authorized_root`, or an explicit `workspaces[]` entry
// (covers a path outside authorized_root, or documents one already under it for the
// tmux session-map / auditability, per the registry file's own header comment).
// FAIL closed (exit 1) on ANY of: missing registry, unparseable registry, no
// `authorized_root` AND no matching `workspaces[]` entry, or a path not covered —
// never a silent pass. This mirrors the it0-*-check.{sh,ts} convention (module IS the
// definition; a thin `.sh` wraps it) and is wrapped by `makeIt0Gate` via
// `.quay/gates.yml`'s/`.quay/config.yml`'s `it0[]` entry for `quay gate --gate
// drivable-workspace`.
//
// Usage:
//   node drivable-workspace-check.ts <path> [<path> ...] --registry <file>
//   node drivable-workspace-check.ts --selftest
//
// --registry is REQUIRED (DIR-120-B, 2026-07-28): a prior DEFAULT_REGISTRY_PATH module-level
// constant guessed a directory-relative path correct from only one of this module's two live
// on-disk locations (plugin/scripts/ vs the experiments-tree symlink) — removed rather than
// relocated, since relocating just re-encodes the same one-fixed-path assumption at the
// currently-correct answer instead of the currently-wrong one.
//
// Exit codes:
//   0 = every path covered (or selftest passed)
//   1 = at least one path NOT covered (or selftest failed)
//   2 = usage/environment error (missing args, registry file not found/unparseable)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { helpExit } from "./gate-script-base.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// selftest()-internal only: the real checked-in registry, resolved relative to THIS file's own
// on-disk location (never re-exported — DIR-120-B removed the module-level DEFAULT_REGISTRY_PATH
// because it was a directory-relative guess correct from only one of this module's two live
// locations; callers now MUST pass --registry explicitly, fail-closed on omission).
const SELFTEST_REGISTRY_PATH = path.join(__dirname, "..", "..", "experiments", "quay-perpetual-stream", "drivable-workspaces.yml");

export interface Registry {
  authorizedRoot: string | null;
  workspacePaths: string[];
}

export class DrivableCheckEnvError extends Error {
  exitCode: number;
  constructor(message: string, exitCode: number) {
    super(message);
    this.exitCode = exitCode;
  }
}

// ── loadRegistry — parse drivable-workspaces.yml's `authorized_root` + `workspaces[].path`. ───────
// Fail-closed: a missing/unparseable file, or a file with no `authorized_root` AND no
// `workspaces` array, is treated as an EMPTY registry (covers nothing) rather than thrown away —
// the caller (isCovered / the CLI) then correctly reports every real path as uncovered, never a
// silent skip. Genuinely missing/unreadable files DO throw (usage/environment error, exit 2) —
// distinct from "a real, readable, but empty-of-coverage registry."
export function parseRegistry(yamlText: string): Registry {
  let doc: unknown;
  try {
    doc = parseYaml(yamlText);
  } catch {
    return { authorizedRoot: null, workspacePaths: [] };
  }
  if (doc === null || typeof doc !== "object") {
    return { authorizedRoot: null, workspacePaths: [] };
  }
  const obj = doc as Record<string, unknown>;
  const authorizedRoot = typeof obj.authorized_root === "string" && obj.authorized_root.trim() !== ""
    ? obj.authorized_root.trim()
    : null;
  const workspacePaths: string[] = [];
  if (Array.isArray(obj.workspaces)) {
    for (const entry of obj.workspaces) {
      if (entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).path === "string") {
        const p = (entry as Record<string, unknown>).path as string;
        if (p.trim() !== "") workspacePaths.push(p.trim());
      }
    }
  }
  return { authorizedRoot, workspacePaths };
}

export function loadRegistry(registryPath: string): Registry {
  if (!fs.existsSync(registryPath)) {
    throw new DrivableCheckEnvError(`ERROR: registry file not found: ${registryPath}`, 2);
  }
  const text = fs.readFileSync(registryPath, "utf8");
  return parseRegistry(text);
}

// ── isCovered — a target path is covered iff it (a) is exactly, or is a descendant of,
// `authorized_root`, OR (b) exactly matches (or is a descendant of) an explicit
// `workspaces[].path` entry. Both compared via `path.resolve` so relative/trailing-slash
// variants of the same real path match. `null`/empty target never matches anything (fail-closed).
function isUnder(target: string, base: string): boolean {
  const resolvedTarget = path.resolve(target);
  const resolvedBase = path.resolve(base);
  return resolvedTarget === resolvedBase || resolvedTarget.startsWith(resolvedBase + path.sep);
}

export function isCovered(targetPath: string, registry: Registry): boolean {
  if (typeof targetPath !== "string" || targetPath.trim() === "") return false;
  if (registry.authorizedRoot && isUnder(targetPath, registry.authorizedRoot)) return true;
  return registry.workspacePaths.some((w) => isUnder(targetPath, w));
}

// ── checkPaths — the pure decision function: PASS iff EVERY given path is covered. ─────────────
export interface CheckResult {
  ok: boolean;
  covered: string[];
  uncovered: string[];
}

export function checkPaths(targetPaths: string[], registry: Registry): CheckResult {
  const covered: string[] = [];
  const uncovered: string[] = [];
  for (const p of targetPaths) {
    (isCovered(p, registry) ? covered : uncovered).push(p);
  }
  return { ok: uncovered.length === 0 && targetPaths.length > 0, covered, uncovered };
}

// ── selftest — embedded RED+GREEN fixture suite (mirrors chart2-s1-distribution-reliability.ts's
// own selftest() convention). ───────────────────────────────────────────────────────────────────
export function selftest(): boolean {
  let allPassed = true;
  function check(name: string, condition: boolean, detail: string): void {
    if (condition) {
      console.log(`SELFTEST PASS: ${name} — ${detail}`);
    } else {
      console.error(`SELFTEST FAIL: ${name} — ${detail}`);
      allPassed = false;
    }
  }

  const registry: Registry = {
    authorizedRoot: "/home/yale/work",
    workspacePaths: ["/opt/outside-root/explicit-workspace"],
  };

  // GREEN 1: a path under authorized_root is covered.
  check("under-authorized-root", isCovered("/home/yale/work/archguard", registry) === true, "covered by authorized_root");

  // GREEN 2: an explicit workspaces[] entry outside authorized_root is covered.
  check("explicit-outside-root", isCovered("/opt/outside-root/explicit-workspace", registry) === true, "covered by explicit workspaces[] entry");

  // GREEN 3: a descendant of an explicit entry is covered too (not just exact match).
  check("descendant-of-explicit", isCovered("/opt/outside-root/explicit-workspace/sub/dir", registry) === true, "descendant of explicit entry covered");

  // RED 1: a path outside both authorized_root and workspaces[] is NOT covered.
  check("uncovered-path", isCovered("/tmp/x", registry) === false, "not covered, correctly fails closed");

  // RED 2: an empty/null path is never covered.
  check("empty-path", isCovered("", registry) === false, "empty target never matches");

  // RED 3: a "look-alike" prefix (authorized_root string is a PREFIX of the target but not a
  // real path ancestor, e.g. /home/yale/work vs /home/yale/work2) must NOT be treated as covered.
  check("prefix-lookalike-not-covered", isCovered("/home/yale/work2/evil", registry) === false, "string-prefix false-positive correctly rejected");

  // Empty registry (missing authorized_root, no workspaces) covers nothing.
  const emptyRegistry = parseRegistry("scope: validation\n");
  check("empty-registry-covers-nothing", isCovered("/home/yale/work/quay", emptyRegistry) === false, "no authorized_root/workspaces -> fail closed");

  // checkPaths: all-covered -> ok:true; any-uncovered -> ok:false; empty input -> ok:false (fail-closed, never a vacuous pass).
  const allCoveredResult = checkPaths(["/home/yale/work/quay", "/home/yale/work/archguard"], registry);
  check("checkPaths-all-covered", allCoveredResult.ok === true && allCoveredResult.uncovered.length === 0, `ok=${allCoveredResult.ok}`);
  const mixedResult = checkPaths(["/home/yale/work/quay", "/tmp/x"], registry);
  check("checkPaths-mixed-fails", mixedResult.ok === false && mixedResult.uncovered.length === 1, `ok=${mixedResult.ok}, uncovered=${JSON.stringify(mixedResult.uncovered)}`);
  const emptyInputResult = checkPaths([], registry);
  check("checkPaths-empty-input-fails-closed", emptyInputResult.ok === false, "no targets given -> not a vacuous pass");

  // parseRegistry round-trip against the REAL checked-in file — run UNCONDITIONALLY (no
  // existsSync guard around the three real-registry-* checks themselves) so a missing/moved
  // registry surfaces as a visible check FAILURE, never a silent skip folded invisibly into the
  // aggregate "all fixture cases PASS" line (DIR-120-B: the prior fs.existsSync(...) guard could
  // mask strictly-less real coverage while still reporting overall success).
  const realRegistryFileExists = fs.existsSync(SELFTEST_REGISTRY_PATH);
  check("real-registry-file-exists", realRegistryFileExists, `path=${SELFTEST_REGISTRY_PATH}`);
  const real = realRegistryFileExists
    ? parseRegistry(fs.readFileSync(SELFTEST_REGISTRY_PATH, "utf8"))
    : { authorizedRoot: null, workspacePaths: [] };
  check("real-registry-has-authorized-root", real.authorizedRoot === "/home/yale/work", `authorizedRoot=${real.authorizedRoot}`);
  check("real-registry-covers-archguard", isCovered("/home/yale/work/archguard", real) === true, "real archguard entry covered");
  check("real-registry-rejects-tmp", isCovered("/tmp/x", real) === false, "real registry correctly rejects /tmp/x");

  if (allPassed) {
    console.log("SELFTEST: all fixture cases PASS.");
    return true;
  }
  console.error("SELFTEST: one or more fixture cases FAILED.");
  return false;
}

// ── Thin CLI ─────────────────────────────────────────────────────────────────────────────────────
function usage(): never {
  console.error("usage: node drivable-workspace-check.ts <path> [<path> ...] --registry <file>");
  console.error("       node drivable-workspace-check.ts --selftest");
  console.error("ERROR: --registry is required (DIR-120-B removed the guessed default path).");
  process.exit(2);
}

async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    helpExit("usage: node drivable-workspace-check.ts <path> [<path> ...] --registry <file>\n       node drivable-workspace-check.ts --selftest");
  }
  if (args.includes("--selftest")) {
    return selftest() ? 0 : 1;
  }

  let registryPath: string | undefined;
  const targets: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--registry") {
      registryPath = args[i + 1];
      i++;
    } else {
      targets.push(args[i]);
    }
  }
  if (targets.length === 0 || !registryPath) usage();

  let registry: Registry;
  try {
    registry = loadRegistry(registryPath);
  } catch (e) {
    if (e instanceof DrivableCheckEnvError) {
      console.error(e.message);
      return e.exitCode;
    }
    throw e;
  }

  const result = checkPaths(targets, registry);
  if (result.ok) {
    console.log(`PASS: all ${targets.length} workspace path(s) covered by ${registryPath}: ${targets.join(", ")}`);
    return 0;
  }
  console.error(`FAIL: ${result.uncovered.length}/${targets.length} workspace path(s) NOT covered by ${registryPath}: ${result.uncovered.join(", ")}`);
  return 1;
}

// gap-config-wiring-check-symlink-noop (DIR-120-B, same fix as config-wiring-check.ts): raw string
// equality between `process.argv[1]` (NEVER resolved through a symlink — stays exactly as typed on
// the command line) and `fileURLToPath(import.meta.url)` (ALWAYS resolved through symlinks to the
// real file's absolute path by Node's ESM loader) can never be true when this script is invoked
// via a real symlink pointing at it from elsewhere on disk (a workspace-portable concern, not tied
// to any one caller's layout) — `main()` would silently never run, falling through to a clean exit
// 0 indistinguishable from "ran and found zero issues" / "PASS." Resolving BOTH sides through
// `fs.realpathSync` (after `path.resolve` to handle a relative argv[1]) makes the two invocation
// paths compare equal.
function isDirectInvocation(): boolean {
  if (!process.argv[1]) return false;
  try {
    const invokedReal = fs.realpathSync(path.resolve(process.argv[1]));
    const moduleReal = fileURLToPath(import.meta.url);
    return invokedReal === moduleReal;
  } catch {
    return false;
  }
}

const isDirect = isDirectInvocation();
if (isDirect) {
  main(process.argv).then((code) => process.exit(code));
}
