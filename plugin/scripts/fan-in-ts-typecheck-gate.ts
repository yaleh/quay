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
// read the `ts-typecheck` testPass gate's `command` from the workspace's `.quay/config.yml` when
// present, else fall back to the canonical per-package loop (a fresh worktree lacks the gitignored
// config until scripts/worktree-include.sh copies it — the resolveTasksDir fail-open pattern).
// The command runs with cwd = the WORKTREE, so it typechecks the TASK'S tree, not the main checkout.
//
// Pure functions are exported and unit-tested; `main()` is a thin CLI (mirrors
// serial-fanin-absorb.ts's shape).

import fs from "node:fs";
import { repoRoot } from "./repo-root.ts";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDirectEntry } from "./gate-script-base.ts";
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

// ── Gate command resolution (config-aware, fail-open to canonical — resolveTasksDir pattern) ────────
export const CANONICAL_TYPECHECK_CMD = 'for d in packages/*/; do npx tsc --noEmit -p "$d" || exit 1; done';

/** Read the `ts-typecheck` testPass gate's `command` from `<configRoot>/.quay/config.yml`, else
 *  canonical. `configRoot` is the WORKTREE (its own config when provisioned; a fresh worktree
 *  falls back). `moduleRoot` is where the `packages/` tree lives (defaults to the repo root of
 *  configRoot) — the loader module import resolves from moduleRoot while the config TEXT is read
 *  from configRoot, so a bare worktree without the packages tree still resolves correctly. */
export async function resolveTypecheckCommand(configRoot, moduleRoot = repoRoot(configRoot)) {
  try {
    const { readGatesConfig } = await import(
      pathToFileURL(path.join(moduleRoot, "packages/quay/src/gate/config/loader.ts")).href
    );
    const cfg = readGatesConfig(configRoot);
    const entry = (cfg.testPass || []).find((e) => e && e.name === "ts-typecheck");
    if (entry && typeof entry.command === "string" && entry.command.trim()) return entry.command;
  } catch {
    // no packages/ tree or module error — fall back to canonical
  }
  return CANONICAL_TYPECHECK_CMD;
}

// ── Run the ts-typecheck gate in the worktree ────────────────────────────────────────────────────────
// Executes the gate command with cwd = the worktree (typechecks the task's tree). fail-closed:
// any non-zero exit OR execution error ⇒ ok:false. `fakeGate` (`"pass" | "fail"`) is a TEST-ONLY
// backdoor that short-circuits the verdict without executing the command — the negative-control
// tests prove the decision + gate-run wiring without needing a real `npx tsc` in a temp repo.
export async function runTypecheckGate(worktree, root, { fakeGate = null, command = null } = {}) {
  if (fakeGate === "pass") return { ok: true, fake: true, command: command ?? null, status: 0, stdout: "", stderr: "(fake pass)" };
  if (fakeGate === "fail") return { ok: false, fake: true, command: command ?? null, status: 1, stdout: "", stderr: "(fake fail)" };
  const cmd = command ?? (await resolveTypecheckCommand(worktree, root));
  try {
    const r = spawnSync("bash", ["-c", cmd], {
      cwd: worktree, encoding: "utf8", timeout: 300_000, stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: r.status === 0, command: cmd, status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  } catch (err) {
    return { ok: false, command: cmd, status: null, stdout: "", stderr: String(err) };
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────
function getArgValue(args, name) {
  const idx = args.indexOf(name);
  return idx === -1 ? undefined : args[idx + 1];
}

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
  const taskId = getArgValue(args, "--task");
  if (!taskId) {
    process.stderr.write(`fan-in-ts-typecheck-gate: --task is required\n${usage}\n`);
    return 2;
  }
  const worktree = path.resolve(getArgValue(args, "--worktree") ?? process.cwd());
  const mergeTarget = getArgValue(args, "--merge-target") ?? "develop";
  const asJson = args.includes("--json");
  const checkOnly = args.includes("--check-only");
  const fakeGate = getArgValue(args, "--fake-gate");
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
        stdout: (typecheck.stdout ?? "").slice(0, 2000), stderr: (typecheck.stderr ?? "").slice(0, 2000),
      },
      reason: admitted ? "typecheck-green" : "typecheck-red",
      verdict: admitted ? "admitted" : "blocked", exit: admitted ? 0 : 1,
    }, null, 2) + "\n");
  } else {
    console.log(`fan-in-ts-typecheck-gate: task ${taskId} — Touches cover new/moved .ts files (${newMovedTsFiles.length}); type graph changed`);
    console.log(`fan-in-ts-typecheck-gate: running ts-typecheck gate in worktree ${worktree}${fakeGate ? ` (fake ${fakeGate})` : ""}...`);
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
