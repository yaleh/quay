// spec-declaration-point-check.ts — SPEC 声明点机械检查（tasks/gap-spec-declaration-point-mechanical-check）。
//
// PROBLEM IT FIXES: every on-disk orchestration/SPEC-*.md must be declared at EVERY known SPEC
// declaration point. The declaration points today are exactly two —
//   plugin/skills/manager/SKILL.md   (the "Methodology sources" SPEC index, AC6 in
//                                     manager-layer-shipping.test.mjs requires every on-disk SPEC)
//   plugin/skills/init/SKILL.md      (the `<!-- reference-doc: orchestration/SPEC-… -->` block that
//                                     quay-init.sh's verify-referenced-landed reads)
// — but that "two" was HAND-COUNTED (`grep -rln "orchestration/SPEC-"` then a human filtered ~100
// results down to 2), never mechanically guaranteed. When a SPEC is added and one of the two points
// is missed (manager bdf8b13d 漏索引 → AC6 红; outer 01d4f4e8 补索引漏 init reference-doc →
// referenced-not-landed 红), the whole store goes red and burns worker wall-clock.
//
// AC2 (grep-derived, NOT hardcoded): the declaration-point SET is derived by SEARCHING the shipped
// skill surface (plugin/skills/**) for files that reference `orchestration/SPEC-`. This checker
// contains NO hardcoded list of declaration-point paths — a THIRD declaration point (another shipped
// skill doc that starts enumerating SPECs) is picked up automatically, and a SPEC missing from it
// goes RED. Hardcoding the two paths would drift exactly the way this task guards against.
//
// AC1 (falsifiable): a new orchestration/SPEC-*.md that is missing from ANY declaration point ⇒ RED
// (exit 1). Pinned by plugin/test/spec-declaration-point-check.test.mjs (temp-repo negative controls)
// and the mutation case (inject a missing declaration → must go RED, restore → GREEN).
//
// NOT-EVALUATED (hard rule 3b): zero on-disk SPECs, or zero declaration points found (the grep
// matched nothing — indistinguishable from "no files to check"), or the checked dirs are absent ⇒
// exit 2, NEVER conflated with GREEN. A check that found no declaration points must not report PASS
// (硬规则 4: a structurally-cannot-be-false verdict is not a measurement).
//
// Run:
//   node --experimental-strip-types plugin/scripts/spec-declaration-point-check.ts [--root <dir>] [--json]
// stdout: a human line + (with --json) a machine-readable result object
// exit: 0 = every SPEC declared in every declaration point · 1 = some (SPEC, point) missing ·
//       2 = NOT-EVALUATED (no SPECs / no declaration points / missing dirs)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** The default checked surface = the quay repo root (this script lives at <repo>/plugin/scripts/). */
const DEFAULT_ROOT = path.resolve(__dirname, "..", "..");

/** The shipped-skill surface where SPEC declaration points live (manager index + init reference-doc). */
export const SKILLS_DIR_REL = "plugin/skills";
/** The SPEC inventory directory, relative to the root. */
export const SPEC_DIR_REL = "orchestration";

/** A SPEC file is any orchestration/SPEC-*.md. */
export const SPEC_FILE_RE = /^SPEC-.*\.md$/;
/** The grep marker: a file references the SPEC inventory via its full path. */
export const SPEC_REF_MARKER = "orchestration/SPEC-";

export interface DeclarationPointResult {
  /** Repo-relative path of the declaration point (e.g. plugin/skills/manager/SKILL.md). */
  path: string;
  /** On-disk SPEC basenames that do NOT appear in this declaration point. */
  missingSpecs: string[];
}

export interface SpecDeclarationResult {
  /** true iff evaluated && no missing declaration. */
  ok: boolean;
  /** false when the check could not be evaluated (hard rule 3b — never conflated with green). */
  evaluated: boolean;
  /** Why not-evaluated, when evaluated is false. */
  notEvaluatedReason?: string;
  /** On-disk SPEC basenames (sorted). */
  specs: string[];
  /** The grep-derived declaration points, each with its missing SPECs. */
  declarationPoints: DeclarationPointResult[];
}

/** Recursively list regular files under `dir` (repo-relative paths, `/`-separated, sorted). */
export function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(current, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) out.push(full);
    }
  }
  return out.sort();
}

/** Enumerate on-disk SPEC basenames (sorted) from `<root>/orchestration/`. */
export function listSpecBasenames(root: string): string[] {
  const specDir = path.join(root, SPEC_DIR_REL);
  if (!fs.existsSync(specDir)) return [];
  return fs
    .readdirSync(specDir)
    .filter((f) => SPEC_FILE_RE.test(f))
    .sort();
}

/**
 * Derive the declaration-point set by SEARCHING the shipped skill surface for files that reference
 * `orchestration/SPEC-` (grep-derived, AC2 — no hardcoded path list). Returns repo-relative paths.
 */
export function findDeclarationPoints(root: string): string[] {
  const skillsDir = path.join(root, SKILLS_DIR_REL);
  if (!fs.existsSync(skillsDir)) return [];
  const files = listFilesRecursive(skillsDir);
  return files.filter((f) => {
    try {
      return fs.readFileSync(f, "utf8").includes(SPEC_REF_MARKER);
    } catch {
      return false;
    }
  });
}

/**
 * Judge the SPEC declaration surface at `root`. Pure filesystem read, no writes.
 * A SPEC is "declared" at a declaration point iff its exact basename appears in the point's content
 * (the same `content.includes(basename)` semantics manager-layer-shipping.test.mjs AC6 uses).
 */
export function checkSpecDeclarations(root: string): SpecDeclarationResult {
  const specs = listSpecBasenames(root);
  const points = findDeclarationPoints(root);

  if (specs.length === 0) {
    return {
      ok: false,
      evaluated: false,
      notEvaluatedReason: `no orchestration/SPEC-*.md found under ${path.join(root, SPEC_DIR_REL)}`,
      specs,
      declarationPoints: points.map((p) => ({ path: p, missingSpecs: [] })),
    };
  }
  if (points.length === 0) {
    return {
      ok: false,
      evaluated: false,
      notEvaluatedReason:
        `grep found no declaration point (a file under ${SKILLS_DIR_REL} referencing "${SPEC_REF_MARKER}") — ` +
        "the check has nothing to verify, which must not read as PASS",
      specs,
      declarationPoints: [],
    };
  }

  const declarationPoints: DeclarationPointResult[] = points.map((p) => {
    const content = fs.readFileSync(p, "utf8");
    const missingSpecs = specs.filter((s) => !content.includes(s));
    return { path: p, missingSpecs };
  });

  const missingCount = declarationPoints.reduce((n, d) => n + d.missingSpecs.length, 0);
  return { ok: missingCount === 0, evaluated: true, specs, declarationPoints };
}

function parseArg(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx !== -1 && argv[idx + 1] ? argv[idx + 1] : undefined;
}

export function main(argv: string[]): number {
  const root = path.resolve(parseArg(argv, "--root") ?? DEFAULT_ROOT);
  const json = argv.includes("--json");

  const res = checkSpecDeclarations(root);

  if (!res.evaluated) {
    const detail = JSON.stringify(res);
    if (json) {
      process.stdout.write(`${detail}\n`);
    } else {
      process.stderr.write(`NOT-EVALUATED: ${res.notEvaluatedReason}\n`);
    }
    return 2;
  }

  const pointCount = res.declarationPoints.length;
  const missingCount = res.declarationPoints.reduce((n, d) => n + d.missingSpecs.length, 0);

  if (json) {
    process.stdout.write(`${JSON.stringify(res)}\n`);
  } else if (res.ok) {
    process.stdout.write(
      `PASS: all ${res.specs.length} orchestration/SPEC-*.md declared at each of ${pointCount} declaration points\n`,
    );
  } else {
    process.stderr.write(
      `RED: ${missingCount} missing SPEC declaration(s) across ${pointCount} declaration points\n`,
    );
    for (const d of res.declarationPoints) {
      if (d.missingSpecs.length === 0) continue;
      process.stderr.write(`  ${d.path} missing:\n`);
      for (const s of d.missingSpecs) process.stderr.write(`    - ${s}\n`);
    }
  }

  if (!res.ok) return 1;
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
