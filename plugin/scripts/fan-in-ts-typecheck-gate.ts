#!/usr/bin/env node
// fan-in-ts-typecheck-gate.ts — gap-ts-touching-fan-in-needs-typecheck-gate.
//
// THE DEFECT (from the task title): fan-in admission only looks at scoped green — but a task
// that ADDS/MOVES .ts files changes the TYPE GRAPH, and scoped tests do not catch type errors.
// Round 52 red (2026-08-12): cli-import-migration's 17 verb handlers moved into 20 new .ts files
// passed scoped 79/0 green, then `npx tsc --noEmit` failed with 73 errors all in src/cli/ (the ctx
// type migration was lost). Scoped-green + full-suite-red cost 550s of red round + a blocked
// batch-merge. This is a scoped-coverage vs fan-in-admission mismatch — a large file migration
// (new/moved .ts) is exactly the scenario where scoped is LEAST trustworthy.
//
// THIS module is the mechanical fan-in admission pre-check. It:
//   1. Reads the task's `## Touches` (the ONE touches-parser — ADR-004 single-source).
//   2. Computes the task's NEW/MOVED .ts files from the git diff vs the merge target
//      (`--diff-filter=ACR` = added/copied/renamed — "新增/移动"; NOT merely modified).
//   3. If any Touches entry COVERS a new/moved .ts file ⇒ the task changes the type graph in its
//      declared write surface ⇒ run the ts-typecheck gate in the worktree BEFORE fan-in.
//   4. Verdict: exit 0 = admitted (no new/moved .ts in Touches, OR the typecheck is green);
//      exit 1 = BLOCKED (new/moved .ts in Touches AND the typecheck is red) — fan-in must NOT
//      proceed on scoped-green alone; exit 2 = usage/env error (also fail-closed, never admitted).
//
// The typecheck command is workspace data (ADR-013 — never hardcoded in packages/quay/src/**):
// read the typecheck testPass gate's `command` from the workspace's `.quay/config.yml`. The config
// TEXT comes from the workspace under test while the LOADER MODULE is probed from THIS script's own
// install location — a third-party project has no quay source tree, so anchoring the module base on
// it (the pre-fix `repoRoot(configRoot)`) made every third-party declaration unreadable
// (gap-fan-in-ts-typecheck-gate-cannot-read-third-party-config). When no gate is declared the
// fallback is `npx tsc --noEmit` (valid for any TS project), NOT quay's own `packages/*/` loop —
// see the "Gate command resolution" block below for why, and for the real third-party reading.
// The command runs with cwd = the WORKTREE, so it typechecks the TASK'S tree, not the main checkout.
//
// Pure functions are exported and unit-tested; `main()` is a thin CLI (mirrors
// serial-fanin-absorb.ts's shape).

import fs from "node:fs";
import { repoRoot } from "./repo-root.ts";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
// getArgValue now lives in gate-script-base.ts as `flagValue` (it was one of the ~73 byte-identical
// copies of the indexOf+next-arg idiom in plugin/scripts; .quay/routine-findings.jsonl finding
// `arg-parsing-helper-family`, routine `semantic-dedup-scan`).
import { isDirectEntry, flagValue } from "./gate-script-base.ts";
import { parseTouchEntriesWithTags, extractTouchesSection } from "./touches-parser.ts";


// ── Pure: parse `## Touches` from a task body → bare repo-relative path list ─────────────────────────
export function parseTouches(taskBody) {
  const { section } = extractTouchesSection(String(taskBody ?? ""));
  return parseTouchEntriesWithTags(section).map((e) => e.path).filter(Boolean);
}

// ── Pure: filter a `git diff --name-only` output down to NEW/MOVED `.ts` files ───────────────────────
// The caller feeds the output of `git diff --name-only --diff-filter=ACR -M <merge-target>...HEAD`.
// `.ts` covers `.ts` and `.d.ts` (both live in the type graph the `tsc --noEmit` gate checks).
export function listNewMovedTsFiles(nameOnlyOutput) {
  const out = [];
  for (const line of String(nameOnlyOutput ?? "").split(/\r?\n/)) {
    const rel = line.trim();
    if (!rel) continue;
    if (rel.endsWith(".ts")) out.push(rel);
  }
  return out;
}

// ── Pure: does a single Touches entry COVER a file? ──────────────────────────────────────────────────
// A touch `p` covers file `f` when they are equal (an exact file touch) or `f` sits under a
// directory touch (`f.startsWith(p + "/")`). A trailing `/*`/`/**` glob is normalized to its
// directory prefix; repo paths never contain parentheses (the annotation strip already ran).
export function touchCoversFile(touch, file) {
  const p = String(touch ?? "").trim().replace(/^\.\//, "").replace(/\/\*\*?$/, "");
  const f = String(file ?? "").trim().replace(/^\.\//, "");
  if (!p || !f) return false;
  if (f === p) return true;
  return f.startsWith(p.endsWith("/") ? p : p + "/");
}

// ── Pure: must this task run the ts-typecheck gate before fan-in? ────────────────────────────────────
// True iff any Touches entry covers any new/moved .ts file — i.e. the task's declared write surface
// intersects a type-graph change. Absent Touches or absent new/moved .ts files ⇒ false (no gate).
export function requiresTypecheck(touches, newMovedTsFiles) {
  if (!Array.isArray(touches) || touches.length === 0) return false;
  if (!Array.isArray(newMovedTsFiles) || newMovedTsFiles.length === 0) return false;
  return newMovedTsFiles.some((f) => touches.some((t) => touchCoversFile(t, f)));
}

// ── Gate command resolution (config-aware; resolved ACROSS the project boundary) ────────────────────
//
// TWO defects fixed here (gap-fan-in-ts-typecheck-gate-cannot-read-third-party-config):
//
//  (1) THE LOADER MODULE BASE WAS THE PROJECT UNDER TEST. `moduleRoot` defaulted to
//      `repoRoot(configRoot)` — but a third-party project has no quay source tree, so the import
//      threw, `catch {}` swallowed it, and the project's OWN `gates.testPass` declaration was never
//      read. Measured 2026-09-14 on ad-arm1/archguard: `packages/quay/src/gate/config/loader.ts` is
//      absent in every ancestor of that project, and its `.quay/config.yml` DOES declare a
//      typecheck gate — so ADR-013 ("the command is workspace data") was structurally unreachable
//      there. Two install layouts actually exist and both are now probed from THIS SCRIPT's own
//      location (never from the target project):
//        dev repo / task worktree : <root>/packages/quay/src/gate/config/loader.ts
//        npm-installed package    : <pkg>/src/gate/config/loader.ts
//      (ad-arm1's `/home/yale/.local/opt/quay/0.7.0/lib/node_modules/quay/` ships `src/` at the
//      package root and has NO `packages/` — the `src/` shape is not hypothetical.)
//
//  (2) THE FALLBACK ASSUMED QUAY'S OWN MONOREPO LAYOUT. It was
//      `for d in packages/*/; do npx tsc --noEmit -p "$d" || exit 1; done`. On a project without
//      `packages/` bash leaves the glob unexpanded and `tsc -p 'packages/*/'` dies with
//      `error TS5058: The specified path does not exist: 'packages/*/'` — a red that is
//      INDISTINGUISHABLE from "this project has a type error" (硬规则 3b: 读不懂 ⇒ 与合格/不合格同形).
//      The fallback is now `npx tsc --noEmit`, valid for ANY TypeScript project.
//      ⛔ Why a runnable fallback rather than reporting `not-evaluated`: a project that declares no
//      typecheck gate AT ALL still has a type graph, and `tsc --noEmit` answers the same question the
//      gate asks (a broken tsconfig still yields a non-zero exit ⇒ BLOCKED, fail-closed). Choosing
//      `not-evaluated` here would ADMIT the fan-in on an unknown type graph — a strictly worse
//      failure mode for an admission gate. The chosen command is also literally what the real
//      third-party consumer declares (archguard: `command: npx tsc --noEmit`), so a project with a
//      tsconfig sees no behavioural change whether or not its declaration is readable.
//      ⛔ NOT the fix: adding an empty `packages/` dir to the target project — that papers over the
//      defect and leaves a phantom directory in a foreign repo.
//      ⛔ Removing the old `CANONICAL_TYPECHECK_CMD` constant is deliberate: now that quay's own
//      `.quay/config.yml` IS read, a hardcoded copy of quay's command would be a SECOND source of
//      truth for the same fact — the very duplication that let this defect hide.

/** This module's own directory — the anchor for the loader probe. NEVER the target project:
 *  a resolver anchored on the project under test cannot find quay's own source there. */
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

/** The Core config loader's rel shape under each candidate base (see (1) above). Probed with
 *  `fs.existsSync`, so a missing shape is a miss — never an exception that a `catch` could hide. */
const LOADER_REL_SHAPES = [
  "packages/quay/src/gate/config/loader.ts",
  "src/gate/config/loader.ts",
];

/** Candidate loader paths in priority order: the caller's explicit base first (the test seam, and
 *  the worktree's own source when it has one), then THIS script's install location — `../..` for a
 *  `<pkg|root>/plugin/scripts/…` script, and `..` for the marketplace layout where the plugin root
 *  directly contains `scripts/` (the two shapes plugin-root.ts constraint ③ documents). */
export function configLoaderCandidates(moduleRoot = null) {
  const bases = [];
  if (moduleRoot) bases.push(path.resolve(moduleRoot));
  bases.push(path.resolve(SCRIPT_DIR, "..", ".."));
  bases.push(path.resolve(SCRIPT_DIR, ".."));
  const out = [];
  for (const base of bases) for (const rel of LOADER_REL_SHAPES) out.push(path.join(base, rel));
  return out;
}

/** The first candidate that EXISTS on disk, or null when no install layout is reachable. */
export function resolveConfigLoaderPath(moduleRoot = null) {
  for (const p of configLoaderCandidates(moduleRoot)) if (fs.existsSync(p)) return p;
  return null;
}

/** The fallback typecheck command — valid for any TypeScript project (see (2) above). */
export const FALLBACK_TYPECHECK_CMD = "npx tsc --noEmit";

/** Names under which a workspace may declare its typecheck gate, in priority order. `ts-typecheck`
 *  is quay's own name (this repo's `.quay/config.yml`). `typecheck` is what the real third-party
 *  consumer declares — ad-arm1/archguard's `gates.testPass` carries `- name: typecheck` /
 *  `command: npx tsc --noEmit` (measured 2026-09-14). Matching only `ts-typecheck` would leave that
 *  project's declaration unread — the same defect this task fixes, one level down. */
const TYPECHECK_GATE_NAMES = ["ts-typecheck", "typecheck"];

/** Resolve the typecheck command AND report WHERE it came from. `source: "config"` means the
 *  workspace's own declaration was read (the ADR-013 path); `source: "fallback"` means it was not,
 *  and `reason` says why (`loader-not-found` = no quay source tree reachable from this script;
 *  `no-declaration` = a loader was reachable but the workspace declares no typecheck gate;
 *  `loader-import-failed` = the module exists but could not be loaded). Callers that must
 *  distinguish "declared" from "guessed" read `source` — a fallback that is indistinguishable from a
 *  real reading is exactly the 硬规则 3b failure this task is about.
 *
 *  `configRoot` is the WORKTREE (whose `.quay/config.yml` is the workspace data). `moduleRoot` is an
 *  optional explicit module base; when omitted the probe walks this script's own install location. */
export async function resolveTypecheckCommandDetailed(configRoot, moduleRoot = null) {
  const loaderPath = resolveConfigLoaderPath(moduleRoot);
  if (!loaderPath) {
    return { command: FALLBACK_TYPECHECK_CMD, source: "fallback", reason: "loader-not-found", loaderPath: null };
  }
  let cfg;
  try {
    const { readGatesConfig } = await import(pathToFileURL(loaderPath).href);
    cfg = readGatesConfig(configRoot);
  } catch (err) {
    return { command: FALLBACK_TYPECHECK_CMD, source: "fallback", reason: "loader-import-failed", loaderPath, error: String(err) };
  }
  for (const name of TYPECHECK_GATE_NAMES) {
    const entry = (cfg.testPass || []).find((e) => e && e.name === name);
    if (entry && typeof entry.command === "string" && entry.command.trim()) {
      return { command: entry.command, source: "config", declaredAs: name, loaderPath };
    }
  }
  return { command: FALLBACK_TYPECHECK_CMD, source: "fallback", reason: "no-declaration", loaderPath };
}

/** The command alone — the stable public helper (kept as a string-returning wrapper so existing
 *  callers are unchanged). See `resolveTypecheckCommandDetailed` for provenance. */
export async function resolveTypecheckCommand(configRoot, moduleRoot = null) {
  return (await resolveTypecheckCommandDetailed(configRoot, moduleRoot)).command;
}

// ── Run the ts-typecheck gate in the worktree ────────────────────────────────────────────────────────
// Executes the gate command with cwd = the worktree (typechecks the task's tree). fail-closed:
// any non-zero exit OR execution error ⇒ ok:false. `fakeGate` (`"pass" | "fail"`) is a TEST-ONLY
// backdoor that short-circuits the verdict without executing the command — the negative-control
// tests prove the decision + gate-run wiring without needing a real `npx tsc` in a temp repo.
export async function runTypecheckGate(worktree, root, { fakeGate = null, command = null } = {}) {
  if (fakeGate === "pass") return { ok: true, fake: true, command: command ?? null, source: "fake", status: 0, stdout: "", stderr: "(fake pass)" };
  if (fakeGate === "fail") return { ok: false, fake: true, command: command ?? null, source: "fake", status: 1, stdout: "", stderr: "(fake fail)" };
  let cmd = command, source = command ? "explicit" : null, declaredAs = null, loaderPath = null, reason = null;
  if (cmd == null) {
    const resolved = await resolveTypecheckCommandDetailed(worktree, root);
    cmd = resolved.command;
    source = resolved.source;
    declaredAs = resolved.declaredAs ?? null;
    loaderPath = resolved.loaderPath ?? null;
    reason = resolved.reason ?? null;
  }
  const provenance = { source, declaredAs, loaderPath, reason };
  try {
    const r = spawnSync("bash", ["-c", cmd], {
      cwd: worktree, encoding: "utf8", timeout: 300_000, stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: r.status === 0, command: cmd, ...provenance, status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  } catch (err) {
    return { ok: false, command: cmd, ...provenance, status: null, stdout: "", stderr: String(err) };
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────
const usage = `fan-in-ts-typecheck-gate.ts — fan-in admission pre-check: run the ts-typecheck gate when a task's Touches include NEW/MOVED .ts files (gap-ts-touching-fan-in-needs-typecheck-gate)

Usage:
  node --experimental-strip-types fan-in-ts-typecheck-gate.ts --task <id> [--worktree <dir>] [--merge-target <ref>] [--json] [--check-only] [--fake-gate <pass|fail>] [--help]

  --task <id>        task id whose ## Touches to evaluate (REQUIRED — reads <worktree>/tasks/<id>.md)
  --worktree <dir>   the task's worktree (default: cwd). The typecheck command runs with cwd here —
                     it typechecks the TASK'S tree. Read the task + run git diff here too.
  --merge-target <ref>  the ref the task was rebased onto before fan-in (the loop's \$MERGE_TARGET).
                     The task's own diff is \$MERGE_TARGET...HEAD (default: develop — a heuristic).
  --json             machine-readable output { required, typecheck, verdict, reason, ... }
  --check-only       report the DECISION (required: true/false) WITHOUT running the gate — the
                     fan-in step can pre-filter which tasks need the gate before paying its ~20s.
  --fake-gate <pass|fail>  TEST-ONLY backdoor: short-circuit the typecheck verdict without executing
                     the command (negative-control tests prove the gate-run wiring without real tsc).
  --help             this help

Exit codes:
  0  ADMITTED — no new/moved .ts in Touches, OR the ts-typecheck gate is green
  1  BLOCKED  — new/moved .ts in Touches AND the ts-typecheck gate is red (do NOT fan in)
  2  usage/env error (task file missing, git diff unavailable — fail-closed, never admitted)`;

export async function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(usage + "\n");
    return 0;
  }
  const taskId = flagValue(args, "--task");
  if (!taskId) {
    process.stderr.write(`fan-in-ts-typecheck-gate: --task is required\n${usage}\n`);
    return 2;
  }
  const worktree = path.resolve(flagValue(args, "--worktree") ?? process.cwd());
  const mergeTarget = flagValue(args, "--merge-target") ?? "develop";
  const asJson = args.includes("--json");
  const checkOnly = args.includes("--check-only");
  const fakeGate = flagValue(args, "--fake-gate");
  if (fakeGate != null && fakeGate !== "pass" && fakeGate !== "fail") {
    process.stderr.write(`fan-in-ts-typecheck-gate: --fake-gate must be "pass" or "fail" (got "${fakeGate}")\n`);
    return 2;
  }

  const root = repoRoot(worktree);
  const taskPath = path.join(worktree, "tasks", `${taskId}.md`);
  if (!fs.existsSync(taskPath)) {
    process.stderr.write(`fan-in-ts-typecheck-gate: task file not found: ${taskPath}\n`);
    return 2;
  }

  // 1. Parse the task's declared write surface.
  const touches = parseTouches(fs.readFileSync(taskPath, "utf8"));

  // 2. Compute the task's NEW/MOVED .ts files from the git diff vs the merge target. The UNION of
  //    the committed diff (`<mergeTarget>...HEAD` — the task's own commits after the A6 rebase) and
  //    the uncommitted working-tree diff (`HEAD` — a task that has not yet committed its new .ts)
  //    is the full change the fan-in is about to merge.
  let newMovedTsFiles;
  try {
    const committed = execFileSync("git", ["-C", worktree, "diff", "--name-only", "--diff-filter=ACR", "-M", `${mergeTarget}...HEAD`], {
      encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "ignore"],
    });
    let workingTree = "";
    try {
      workingTree = execFileSync("git", ["-C", worktree, "diff", "--name-only", "--diff-filter=ACR", "-M", "HEAD"], {
        encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "ignore"],
      });
    } catch { /* no HEAD / not a repo — uncommitted surface is empty */ }
    // Untracked (never-committed) files do not appear in `git diff HEAD` — list them explicitly so
    // a new .ts the task has not yet committed still triggers the gate (the whole point: a type-
    // graph change scoped-green has not vouched for).
    let untracked = "";
    try {
      untracked = execFileSync("git", ["-C", worktree, "ls-files", "--others", "--exclude-standard"], {
        encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "ignore"],
      });
    } catch { /* not a git repo — untracked surface is empty */ }
    newMovedTsFiles = listNewMovedTsFiles(`${committed}\n${workingTree}\n${untracked}`);
  } catch {
    process.stderr.write(
      `fan-in-ts-typecheck-gate: could not compute the task's git diff (${mergeTarget}...HEAD) in ${worktree} — ` +
      `ref absent or git error. Fail-closed: BLOCKED (an unknown type-graph change must not fan in on scoped-green alone).\n`,
    );
    if (asJson) {
      process.stdout.write(JSON.stringify({
        task: taskId, worktree, mergeTarget, touches, newMovedTsFiles: null, required: null,
        reason: "git-diff-unavailable", verdict: "blocked", exit: 1,
      }, null, 2) + "\n");
    }
    return 1;
  }

  const required = requiresTypecheck(touches, newMovedTsFiles);

  // --check-only: report the DECISION without running the gate (a fan-in step can pre-filter which
  // tasks need the ~20s gate before paying it). Informational — always exit 0; the caller reads
  // `required` from stdout.
  if (checkOnly) {
    if (asJson) {
      process.stdout.write(JSON.stringify({
        task: taskId, worktree, mergeTarget, touches, newMovedTsFiles,
        required,
        typecheck: { ran: false },
        reason: required ? "new-moved-ts-in-touches" : "no-new-moved-ts-in-touches",
        verdict: required ? "gate-pending" : "admitted", exit: 0,
      }, null, 2) + "\n");
    } else {
      console.log(`fan-in-ts-typecheck-gate: task ${taskId} — ${required ? "REQUIRES" : "does NOT require"} the ts-typecheck gate before fan-in (check-only)`);
    }
    return 0;
  }

  if (!required) {
    if (asJson) {
      process.stdout.write(JSON.stringify({
        task: taskId, worktree, mergeTarget, touches, newMovedTsFiles,
        required: false, typecheck: { ran: false }, reason: "no-new-moved-ts-in-touches",
        verdict: "admitted", exit: 0,
      }, null, 2) + "\n");
    } else {
      console.log(`fan-in-ts-typecheck-gate: task ${taskId} — Touches ${touches.length ? "do not cover any" : "are empty"}; new/moved .ts in diff: ${newMovedTsFiles.length}`);
      console.log(`fan-in-ts-typecheck-gate: no new/moved .ts in the declared write surface — no typecheck gate needed`);
      console.log("fan-in-ts-typecheck-gate: ADMITTED (exit 0)");
    }
    return 0;
  }

  // 3. The task changes the type graph in its Touches → run the ts-typecheck gate (before fan-in).
  const typecheck = await runTypecheckGate(worktree, root, { fakeGate });
  const admitted = typecheck.ok;

  if (asJson) {
    process.stdout.write(JSON.stringify({
      task: taskId, worktree, mergeTarget, touches, newMovedTsFiles,
      required: true,
      typecheck: {
        ran: true, ok: typecheck.ok, fake: typecheck.fake ?? false,
        status: typecheck.status, command: typecheck.command,
        commandSource: typecheck.source ?? null,
        declaredAs: typecheck.declaredAs ?? null,
        loaderPath: typecheck.loaderPath ?? null,
        reason: typecheck.reason ?? null,
        stdout: (typecheck.stdout ?? "").slice(0, 2000), stderr: (typecheck.stderr ?? "").slice(0, 2000),
      },
      reason: admitted ? "typecheck-green" : "typecheck-red",
      verdict: admitted ? "admitted" : "blocked", exit: admitted ? 0 : 1,
    }, null, 2) + "\n");
  } else {
    console.log(`fan-in-ts-typecheck-gate: task ${taskId} — Touches cover new/moved .ts files (${newMovedTsFiles.length}); type graph changed`);
    console.log(`fan-in-ts-typecheck-gate: running ts-typecheck gate in worktree ${worktree}${fakeGate ? ` (fake ${fakeGate})` : ""}...`);
    // Provenance: WHICH command ran and WHERE it came from — a fallback that reads like a declared
    // command is the 硬规则 3b failure mode (an unreadable config must not look like a read one).
    if (!fakeGate) {
      const src = typecheck.source === "config"
        ? `the workspace's own declaration${typecheck.declaredAs ? ` (name: ${typecheck.declaredAs})` : ""}`
        : `FALLBACK${typecheck.reason ? ` (${typecheck.reason})` : ""}`;
      console.log(`fan-in-ts-typecheck-gate: command [${src}]: ${typecheck.command}`);
    }
    if (admitted) {
      console.log("fan-in-ts-typecheck-gate: typecheck GREEN — ADMITTED (exit 0)");
    } else {
      console.log("fan-in-ts-typecheck-gate: typecheck RED — BLOCKED (exit 1); do NOT fan in on scoped-green alone");
      const tail = (typecheck.stderr || typecheck.stdout || "").trim().split("\n").slice(-15).join("\n");
      if (tail) console.log("fan-in-ts-typecheck-gate: last lines:\n" + tail);
    }
  }
  return admitted ? 0 : 1;
}

if (isDirectEntry(import.meta, undefined, "fan-in-ts-typecheck-gate")) {
  main(process.argv).then((code) => process.exit(code));
}
