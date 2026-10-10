#!/usr/bin/env node
// tmux-test-isolation-check.ts — mechanical enforcement for the tmux-isolation invariant
// (tasks/gap-tmux-isolated-guard-has-zero-consumers-fifth-machine-wipe, STAGE 2 / AC3-AC4).
//
// The invariant (the task's ## Contract):
//   任何起真实 tmux 进程的测试，必须走 tmux-isolated.sh 或同时具备 env -u TMUX 与显式 -S；
//   注释里的禁令不构成机制。
// (Any test that starts a real tmux process must either go through the isolation mechanism OR have
// BOTH isolation conditions — env -u TMUX AND an explicit -S; a prohibition written in a comment is
// not a mechanism.)
//
// This is a STATIC (code-position) scan of the tmux-using TEST files. It flags a file that spawns
// real tmux when it references NO isolation mechanism AND lacks one of the two mandatory conditions.
// The task's own lesson (8 of 9 tmux-using test files bypassed the .sh guard, 4 of those 8 were
// missing a condition, and the machine's tmux server died a fifth time) is exactly why this is a
// MECHANICAL check wired into run_static_checks — prose bans provably don't hold (AC3). The
// negative control (AC4) lives in the checker's mutation case
// (plugin/scripts/checker-mutation-cases/tmux-test-isolation-check.sh) + the unit test
// (plugin/test/tmux-test-isolation-check.test.mjs).
//
// Isolation mechanism reference (a file that uses ANY of these is presumed isolated — the mechanism
// enforces BOTH conditions structurally):
//   - plugin/scripts/tmux-session.ts        (the .ts library, AC6 — the primary consumer seam)
//   - plugin/scripts/tmux-isolated.sh        (the .sh L0 guard)
//   - plugin/test/helpers/hermetic-tmux.mjs  (the shared hermetic fixture helper)
//
// The two mandatory conditions, recognized by their CODE-POSITION idioms (a comment mention does
// not count as a mechanism, but a file that ACTUALLY has both conditions inline is not a crash
// risk):
//   - env strip:  `env -u TMUX` · `TMUX: undefined` · `delete env.TMUX`
//   - explicit -S: a quoted `-S` argv (`["-S", sock]` — the only form that overrides $TMUX)
//
// Real-tmux spawn markers (a `tmux -V` version PROBE is NOT a crash risk and is exempted):
//   - `spawnSync("tmux"` / `spawnSync('tmux'`   (direct spawn)
//   - `tmux(["new-session"` / `tmux(['new-session'`  (a helper call that CREATES a session — the
//     new-session-on-the-default-socket shape is the crash path; capture/send-keys on an existing
//     session are not)
//
// Exit codes:
//   0 = PASS — every tmux-using test file is isolated
//   1 = FAIL — a tmux-using test file references no mechanism and lacks a mandatory condition
//   2 = usage/environment error
//
// Usage:
//   node tmux-test-isolation-check.ts [--root <dir>] [--json]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "./gate-script-base.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Real-tmux spawn markers. `-V` version probes are handled separately (exempted). */
const DIRECT_SPAWN_RE = /spawnSync\(\s*["']tmux["']/;
/** A helper call that CREATES a session — the default-socket new-session shape is the crash path. */
const NEW_SESSION_CALL_RE = /tmux\(\s*["']new-session["']/;
/** A `tmux -V` version probe — harmless (no server is started) and exempted. */
const VERSION_PROBE_RE = /spawnSync\(\s*["']tmux["']\s*,\s*\[["']-V["']\]/;

/** Isolation mechanism references. A file using any of these is presumed structurally isolated. */
const MECHANISM_RE = /tmux-session|tmux-isolated|hermetic-tmux/;
/** The env-strip condition, by code idiom. */
const ENV_STRIP_RE = /env -u TMUX|TMUX:\s*undefined|delete env\.TMUX/;
/** The explicit `-S` argv condition (quoted). Only -S overrides $TMUX. */
const EXPLICIT_S_RE = /["']-S["']/;

/** Test files scanned. Mirrors the task ## Contract measures' `plugin/test/*.mjs` glob. */
function scanTargets(root) {
  const dir = path.join(root, "plugin", "test");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".mjs") && !f.includes("/"))
    .sort()
    .map((f) => path.join(dir, f));
}

export function scanFileText(text) {
  const hasDirect = DIRECT_SPAWN_RE.test(text);
  // Exempt the -V probe: strip it, then re-check whether a real direct spawn remains.
  const stripped = hasDirect ? text.replace(VERSION_PROBE_RE, "") : text;
  const hasRealSpawn = DIRECT_SPAWN_RE.test(stripped) || NEW_SESSION_CALL_RE.test(text);
  if (!hasRealSpawn) return { isolated: true, reasons: [] };
  const hasMechanism = MECHANISM_RE.test(text);
  if (hasMechanism) return { isolated: true, reasons: ["mechanism-reference"] };
  const hasEnvStrip = ENV_STRIP_RE.test(text);
  const hasExplicitS = EXPLICIT_S_RE.test(text);
  const reasons = [];
  if (!hasEnvStrip) reasons.push("missing env -u TMUX (neither `env -u TMUX`, `TMUX: undefined`, nor `delete env.TMUX`)");
  if (!hasExplicitS) reasons.push("missing explicit -S (no quoted `-S` argv)");
  return { isolated: hasEnvStrip && hasExplicitS, reasons };
}

// `argv` is the FULL process.argv (parseArgs slices `argv.slice(2)` itself) — the same convention the
// two already-folded members of this family use (task-ac-carryover-check.ts / task-contract-check.ts).
export function runCli(argv) {
  // Flag parsing is the SHARED spec-driven parser (gate-script-base.parseArgs), not a private
  // hand-rolled loop. THIS file and threshold-scope-check.ts were the two that still carried a
  // private `--root/--json/--help` loop after task-ac-carryover-check.ts / task-contract-check.ts
  // folded onto the shared parser (.quay/routine-findings.jsonl finding `runcli-twostill-handrolled`,
  // routine `semantic-dedup-scan`, runId `semantic-dedup-scan-1791631645924`, verdict
  // divergent-implementation); both now call the one parser. `strict:true` keeps the loop's
  // unknown-`--flag` guard (exit 2); `minArgs:0` because every mode here is flag-only. parseArgs owns
  // the `--help`/`-h` contract (usage to stdout, exit 0) too.
  const { args: positionals, flags } = parseArgs(argv, {
    minArgs: 0,
    strict: true,
    usage: "[--root <dir>] [--json]",
    flags: { root: { type: "string" }, json: { type: "boolean" } },
  });
  // The private loop let a stray positional fall through silently and then scanned the DEFAULT root,
  // reporting PASS for an input it never read (硬规则 3b). threshold-scope-check.ts already rejected
  // positionals (exit 2); unifying the family means stopping at the same place, not inheriting the
  // weaker arm. No caller passes a positional (`scripts/test.sh` and the mutation case both use
  // `--root <dir>` only).
  if (positionals.length > 0) {
    console.error(`tmux-test-isolation-check: unexpected positional: ${positionals[0]}`);
    process.exit(2);
  }
  const root = typeof flags.root === "string" && flags.root !== "" ? path.resolve(flags.root) : process.cwd();
  const json = flags.json === true;
  const files = scanTargets(root);
  const violations = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const rel = path.relative(root, file);
    const res = scanFileText(text);
    if (!res.isolated) {
      violations.push({ rel, file, reasons: res.reasons });
    }
  }
  if (json) {
    console.log(JSON.stringify({ scanned: files.length, violations }, null, 2));
  } else {
    if (violations.length === 0) {
      console.log(`tmux-test-isolation-check: PASS — ${files.length} test file(s) scanned, all isolated.`);
    } else {
      for (const v of violations) {
        console.log(`VIOLATION: ${v.rel} — spawns real tmux with no mechanism reference and ${v.reasons.join("; ")}`);
      }
    }
  }
  process.exit(violations.length === 0 ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runCli(process.argv);
}
