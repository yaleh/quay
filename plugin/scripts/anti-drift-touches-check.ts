// anti-drift-touches-check.mjs — the NON-WAIVABLE after-the-fact HARD guardrail (DIR-044 increment 4;
// charters/DIR-044-concurrent-scheduler-D3.md Step 5). The pre-flight orthogonality check (increment
// 1) trusts the DECLARED `touches`. This check trusts NOTHING: after a concurrent batch has RUN, it
// takes each build's ACTUAL touched files (the driver supplies them from `git diff --numstat
// <base>..<build-branch>`) and HARD-FAILS if either:
//   (a) a build wrote OUTSIDE its declared touches (declaration was too narrow / dishonest), or
//   (b) two builds ACTUALLY touched the same file (the batch was mis-declared as disjoint).
// This is the guardrail that keeps a mis-declared `touches` from silently corrupting shared state —
// it MUST be able to bite (a RED fixture proves it). Native-only, no manda.
//
// Pure functions are exported and unit-tested; `main()` is a thin CLI over them.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { isDirectEntry } from "./gate-script-base.ts";
import { matchGlob, isOverbroadDeclaration, normalizePath, parseTouches } from "./touches-orthogonality-check.ts";

// normalizePath (canonical: strips ./, collapses //, resolves ./.. segments, drops trailing /, case
// preserved for the case-significant Linux repo) is single-source in touches-orthogonality-check.mjs
// and re-exported here for this module's tests. Closes the audit's H1 dot-segment class.
export { normalizePath };

// ── fileWithinDeclared ───────────────────────────────────────────────────────────────────────────
// True iff `file` matches at least one declared glob. An empty declaration → nothing is within
// (fail-closed: an undeclared write is drift). Paths and globs are normalized first (H1).
export function fileWithinDeclared(file, declaredGlobs) {
  const f = normalizePath(file);
  for (const g of declaredGlobs) if (matchGlob(normalizePath(g), f)) return true;
  return false;
}

// ── checkAntiDrift ───────────────────────────────────────────────────────────────────────────────
// builds: [{ id, declaredGlobs:[glob...], actualFiles:[path...] }].
// opts: { allowEmpty } — when true, a ZERO-build manifest is waived (explicit --allow-empty escape
// hatch, default deny). The pure function throws on empty-unless-allowEmpty exactly like it throws
// on a malformed manifest, so the CLI maps both to HARD FAIL (never a silent OK).
// Returns { ok, violations:[{type, ...}] }. ok=false on ANY violation (HARD FAIL). Two violation
// kinds: "out-of-declared" (a build wrote a file matching none of its declared globs) and
// "cross-build-overlap" (two builds actually touched the same file).
export function checkAntiDrift(builds, opts) {
  // (a-1) FAIL-CLOSED on a malformed manifest — a NON-WAIVABLE guardrail must not silently pass on bad
  // input (DIR-049 wiring-audit finding: `b.actualFiles || []` treated a wrong-field-name manifest as
  // empty → ANTI-DRIFT OK). Match serial-fanin-absorb's strictness: every build needs a string id and
  // array declaredGlobs/actualFiles, else throw (the CLI maps the throw to HARD FAIL, not OK).
  if (!Array.isArray(builds)) throw new Error("checkAntiDrift: manifest must be a JSON array of builds");
  // (a-0) EMPTY-SET guard (gap-checks-that-verify-an-empty-set-must-fail-closed): a manifest of ZERO
  // builds means no batch actually ran, so this NON-WAIVABLE guardrail would "verify" nothing and
  // report ANTI-DRIFT OK — indistinguishable from "never looked". serial-fanin-absorb already throws
  // on an empty builds array (computeFanIn: "empty builds — nothing to absorb"); this guard makes the
  // after-the-fact guardrail equally strict, with an explicit --allow-empty escape hatch (default deny).
  if (builds.length === 0 && !(opts && opts.allowEmpty)) {
    throw new Error(
      "checkAntiDrift: empty builds manifest (0 builds) — no batch actually ran, so this NON-WAIVABLE guardrail verified nothing (fail-closed: 'no problems' must not be indistinguishable from 'never looked'; pass --allow-empty to waive)"
    );
  }
  for (const b of builds) {
    if (!b || typeof b.id !== "string" || !b.id) throw new Error("checkAntiDrift: every build needs a string id");
    if (!Array.isArray(b.declaredGlobs)) throw new Error(`checkAntiDrift: build "${b.id}" is missing an array declaredGlobs (fail-closed — a NON-WAIVABLE guardrail does not pass on a malformed manifest)`);
    if (!Array.isArray(b.actualFiles)) throw new Error(`checkAntiDrift: build "${b.id}" is missing an array actualFiles (fail-closed)`);
  }
  const violations = [];
  // (a0) overbroad declaration: a build may not validate its writes against a meaningless scope
  // (`**`, `packages/**`, …). Without this, an overbroad-but-legal glob absorbs any stray write and
  // the out-of-declared arm is toothless (audit finding H3 — needs no dishonest driver). Single-source
  // predicate shared with the pre-flight (ADR-004).
  for (const b of builds) {
    const bad = (b.declaredGlobs || []).find((g) => isOverbroadDeclaration(g));
    if (bad) violations.push({ type: "overbroad-declaration", build: b.id, glob: bad });
  }
  // (a) out-of-declared: every actual write must match a declared glob.
  for (const b of builds) {
    for (const f of b.actualFiles || []) {
      if (!fileWithinDeclared(f, b.declaredGlobs || [])) {
        violations.push({ type: "out-of-declared", build: b.id, file: normalizePath(f) });
      }
    }
  }
  // (b) cross-build-overlap: no file may be touched by two builds (paths normalized — H1).
  for (let i = 0; i < builds.length; i++) {
    for (let j = i + 1; j < builds.length; j++) {
      const setB = new Set((builds[j].actualFiles || []).map(normalizePath));
      for (const f of builds[i].actualFiles || []) {
        if (setB.has(normalizePath(f))) violations.push({ type: "cross-build-overlap", a: builds[i].id, b: builds[j].id, file: normalizePath(f) });
      }
    }
  }
  return { ok: violations.length === 0, violations };
}

// ── Driver input surface (gap-anti-drift-touches-zero-coverage-fast-mode) ──────────────────────────
// The fast-mode fan-in path runs this module as a GATE with the ACTUAL diff (the files the fan-in
// would land) vs the task's DECLARED `## Touches`:
//   node --experimental-strip-types anti-drift-touches-check.ts --task <id> --worktree <dir>
//        [--merge-target <ref>]
// The classic-loop driver (anti-drift-touches-check.sh) supplied a pre-computed manifest from
// `git diff --numstat`; THIS driver computes the actual diff itself (`git diff --name-only
// <merge-target>...HEAD` — the task's own commits, i.e. exactly what fan-in-ff-merge would land)
// and reads the declared globs from the task body (the ONE touches-parser). The judgment — one
// build whose every actual file must fall within a declared glob — is the SAME checkAntiDrift as
// the manifest-file mode (a single build cannot cross-build-overlap; out-of-declared and
// overbroad-declaration are HARD FAIL). The judgment logic is UNCHANGED; only the input surface is new.

function getArgValue(args, name) {
  const idx = args.indexOf(name);
  return idx === -1 ? undefined : args[idx + 1];
}

/** Compute the files the fan-in would land: `git diff --name-only <merge-target>...HEAD` in the
 *  worktree. After the fan-in workflow's step-1 merge of the merge-target into the task worktree,
 *  this is exactly the set of files the ff-merge would move onto the merge target. Fail-closed: a
 *  git error THROWS — the caller maps it to a usage/env error (exit 2), never a silent OK. */
export function computeActualFiles(worktree, mergeTarget) {
  const out = execFileSync("git", ["-C", worktree, "diff", "--name-only", `${mergeTarget}...HEAD`], {
    encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "ignore"],
  });
  return out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/** Build the single-build manifest a task fan-in must satisfy: the declared `## Touches` globs vs
 *  the ACTUAL files the fan-in would land. `parseTouches` (the ONE parser) resolves a missing Touches
 *  section to [] — fail-closed: any actual file then violates (an undeclared write is drift). */
export function buildTaskManifest(taskBody, actualFiles) {
  const { globs } = parseTouches(String(taskBody ?? ""));
  return [{ id: "task", declaredGlobs: globs, actualFiles }];
}

/** Driver verdict over one task build: checkAntiDrift (judgment UNCHANGED) with the task's declared
 *  Touches vs its actual diff. Returns the checkAntiDrift result plus the manifest for transparency. */
export function checkTaskAntiDrift(taskBody, actualFiles, opts) {
  const builds = buildTaskManifest(taskBody, actualFiles);
  return { ...checkAntiDrift(builds, opts), builds, actualFiles, declaredGlobs: builds[0].declaredGlobs };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
function usage() {
  process.stderr.write(
    "Usage:\n" +
      "  anti-drift-touches-check.mjs [--allow-empty] <ran-batch-manifest.json>\n" +
      "  anti-drift-touches-check.mjs --task <id> --worktree <dir> [--merge-target <ref>] [--allow-empty]\n" +
      "    (driver mode — fast-mode fan-in gate: actual diff vs declared ## Touches)\n",
  );
}

/** Driver-mode body: run the anti-drift check over ONE task build. Exit 0 = clean (every actual
 *  file within the declared Touches, declaration not overbroad); 1 = HARD FAIL (out-of-declared
 *  write or overbroad declaration); 2 = usage/env error (task file missing / git diff unavailable —
 *  fail-closed, never a silent OK). */
function runTaskDriver({ taskId, worktree, mergeTarget, allowEmpty }) {
  const taskPath = path.join(worktree, "tasks", `${taskId}.md`);
  if (!fs.existsSync(taskPath)) {
    process.stderr.write(`anti-drift-touches-check: task file not found: ${taskPath}\n`);
    return 2;
  }
  let actualFiles;
  try {
    actualFiles = computeActualFiles(worktree, mergeTarget);
  } catch (e) {
    process.stderr.write(
      `anti-drift-touches-check: could not compute git diff (${mergeTarget}...HEAD) in ${worktree}: ${e.message}\n`,
    );
    return 2;
  }
  let r;
  try {
    r = checkTaskAntiDrift(fs.readFileSync(taskPath, "utf8"), actualFiles, { allowEmpty });
  } catch (e) {
    // malformed task/input → fail-closed HARD FAIL (never silently pass a NON-WAIVABLE guardrail)
    process.stdout.write(`ANTI-DRIFT HARD FAIL: malformed input — ${e.message}\n`);
    return 1;
  }
  if (r.ok) {
    process.stdout.write(
      `ANTI-DRIFT OK: task ${taskId} — ${actualFiles.length} actual file(s), all within declared Touches (${r.declaredGlobs.length} glob(s))\n`,
    );
    return 0;
  }
  process.stdout.write(`ANTI-DRIFT HARD FAIL: task ${taskId} — ${r.violations.length} violation(s)\n`);
  for (const v of r.violations) {
    if (v.type === "overbroad-declaration") {
      process.stdout.write(`  overbroad-declaration: task declares "${v.glob}" (too broad to validate stray writes against)\n`);
    } else {
      process.stdout.write(`  out-of-declared: task wrote ${v.file} (matches no declared Touches glob)\n`);
    }
  }
  return 1;
}

export async function main(argv) {
  const args = argv.slice(2).filter((a) => a !== undefined);
  const allowEmpty = args.includes("--allow-empty");
  // Driver mode (gap-anti-drift-touches-zero-coverage-fast-mode): --task <id> --worktree <dir>
  // [--merge-target <ref>] — the fast-mode fan-in gate. Reads the task body's declared Touches and
  // computes the actual diff itself; the judgment is the SAME checkAntiDrift as the manifest mode.
  if (args.includes("--task")) {
    const taskId = getArgValue(args, "--task");
    if (!taskId) { usage(); return 2; }
    const worktree = path.resolve(getArgValue(args, "--worktree") ?? process.cwd());
    const mergeTarget = getArgValue(args, "--merge-target") ?? "develop";
    return runTaskDriver({ taskId, worktree, mergeTarget, allowEmpty });
  }
  // ── manifest-file mode (the classic-loop driver): [--allow-empty] <ran-batch-manifest.json>
  const files = args.filter((a) => a !== "--allow-empty");
  if (files.length !== 1) { usage(); return 2; }
  if (!fs.existsSync(files[0])) { process.stderr.write(`ERROR: manifest not found: ${files[0]}\n`); return 2; }
  let builds;
  try {
    builds = JSON.parse(fs.readFileSync(files[0], "utf8"));
  } catch (e) {
    process.stderr.write(`ERROR: manifest is not valid JSON: ${e.message}\n`);
    return 2;
  }
  if (!Array.isArray(builds)) { process.stderr.write("ERROR: manifest must be a JSON array of builds\n"); return 2; }
  let r;
  try {
    r = checkAntiDrift(builds, { allowEmpty });
  } catch (e) {
    // malformed manifest → fail-closed HARD FAIL (never silently pass a NON-WAIVABLE guardrail)
    process.stdout.write(`ANTI-DRIFT HARD FAIL: malformed manifest — ${e.message}\n`);
    return 1;
  }
  if (r.ok) {
    process.stdout.write(`ANTI-DRIFT OK: ${builds.length} builds, no out-of-declared writes, no cross-build overlap\n`);
    return 0;
  }
  process.stdout.write(`ANTI-DRIFT HARD FAIL: ${r.violations.length} violation(s)\n`);
  for (const v of r.violations) {
    if (v.type === "overbroad-declaration") process.stdout.write(`  overbroad-declaration: build ${v.build} declares "${v.glob}" (too broad to validate stray writes against)\n`);
    else if (v.type === "out-of-declared") process.stdout.write(`  out-of-declared: build ${v.build} wrote ${v.file} (matches no declared glob)\n`);
    else process.stdout.write(`  cross-build-overlap: builds ${v.a} & ${v.b} both touched ${v.file}\n`);
  }
  return 1;
}

if (isDirectEntry(import.meta, undefined, "anti-drift-touches-check")) {
  main(process.argv).then((code) => process.exit(code));
}
