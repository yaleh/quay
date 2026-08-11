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
import { isDirectEntry } from "./gate-script-base.ts";
import { matchGlob, isOverbroadDeclaration, normalizePath } from "./touches-orthogonality-check.ts";

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

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
function usage() {
  process.stderr.write("Usage: anti-drift-touches-check.mjs [--allow-empty] <ran-batch-manifest.json>\n");
}

export async function main(argv) {
  const args = argv.slice(2).filter((a) => a !== undefined);
  const allowEmpty = args.includes("--allow-empty");
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
