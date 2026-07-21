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
import { fileURLToPath } from "node:url";
import { matchGlob, isOverbroadDeclaration } from "./touches-orthogonality-check.mjs";

// Normalize a repo-relative path for comparison: strip a leading `./` and any trailing `/`, collapse
// duplicate slashes. Closes the audit's H1 (a `./shared.js` vs `shared.js` cross-build overlap that
// exact-string `==` missed). Case is NOT folded — paths are case-significant on the Linux repo, and
// `git diff` emits exact case; folding would create false negatives here.
export function normalizePath(p) {
  return String(p).replace(/^\.\//, "").replace(/\/{2,}/g, "/").replace(/\/+$/, "");
}

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
// Returns { ok, violations:[{type, ...}] }. ok=false on ANY violation (HARD FAIL). Two violation
// kinds: "out-of-declared" (a build wrote a file matching none of its declared globs) and
// "cross-build-overlap" (two builds actually touched the same file).
export function checkAntiDrift(builds) {
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
  process.stderr.write("Usage: anti-drift-touches-check.mjs <ran-batch-manifest.json>\n");
}

export async function main(argv) {
  const args = argv.slice(2).filter((a) => a !== undefined);
  const files = args;
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
  const r = checkAntiDrift(builds);
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

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) {
  main(process.argv).then((code) => process.exit(code));
}
