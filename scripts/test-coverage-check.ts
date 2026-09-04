#!/usr/bin/env node --experimental-strip-types
/**
 * test-coverage-check — DIR-110 / ADR-019 decision #4: makes "every `*.test.mjs` file under any
 * package's `test/` directory (or `plugin/test/`) is reachable by the canonical test runner" a
 * mechanically-checked invariant, generalizing the exact DIR-108 failure class (`plugin/test/
 * plugin-packaging.test.mjs` sitting on `master`, invisible to `ci.yml`'s test step because its
 * glob never matched `plugin/test/`) so it cannot recur under a different, not-yet-invented path.
 *
 * SINGLE-SOURCE (ADR-004): the canonical glob patterns are PARSED from `scripts/test.sh`'s own
 * glob declaration line, never re-typed here — if that script's glob ever changes, this check's
 * notion of "canonical" changes with it automatically, with no second copy to fall out of sync.
 * Both spellings the script has used are accepted (gap-test-coverage-check-parses-stale-files-
 * variable): the current `local glob=(...)` (layer-grouping rename) and the legacy `files=(...)`
 * line. An empty/absent glob is a PARSE FAILURE (fail-loud) — a silently-empty canonical set would
 * make the check mis-report every discovered test file as an orphan (the exact DIR-110 failure
 * class this check exists to catch), so a broken single-source link must never be quiet.
 *
 * Scope (matches ADR-019's Decision #4 text verbatim: "any package's `test/` directory (or
 * `plugin/test/`)"): a `**\/test/*.test.mjs`-shaped file is compared against the canonical set
 * ONLY when it sits under a product/plugin-tier root. `experiments/quay-perpetual-stream/test/`
 * is DELIBERATELY excluded — that directory is the methodology-layer experiment's OWN test
 * suite, with its OWN established, real invocation convention (individual `testPass` gate
 * entries in `.quay/config.yml`, e.g. `it0-dod-check.test.mjs`), not a silent oversight of
 * `scripts/test.sh`'s glob. Folding it in would make this check permanently RED against 38+ real,
 * intentionally-out-of-scope files — the opposite of a useful signal. (Compare DIR-111, which
 * names non-`node:test` categories explicitly rather than silently omitting them; this exclusion
 * is that same discipline applied here, not a quiet carve-out.)
 *
 * Usage:
 *   node --experimental-strip-types scripts/test-coverage-check.ts [--json]
 *   node --experimental-strip-types scripts/test-coverage-check.ts --selftest
 *
 * Exit: 0 = every discovered product/plugin-tier test file is reachable by scripts/test.sh's
 *       canonical glob; 1 = >=1 orphan found (path(s) printed); 2 = usage/environment error.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// Directories never walked when discovering "real" test files — vendored/generated/tooling dirs,
// plus `experiments/quay-perpetual-stream` (see header comment: a deliberate scope decision, not
// an oversight) and any directory literally named `fixtures` (selfcheck/gate fixtures — including
// THIS script's own, and the pre-existing `experiments/.../fixtures/loadbearing/test/
 // fixture-imported.test.mjs` — are deliberately non-canonical by construction, never meant to be
// "reachable by the canonical runner").
const EXCLUDE_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".claude",
  ".archguard",
  "experiments",
  "fixtures",
]);

function readFileSafe(p: string): string {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

/**
 * Parse the space-separated glob patterns out of `scripts/test.sh`'s canonical glob declaration.
 *
 * Single-source (ADR-004): the glob is read from test.sh's OWN line, never re-typed here. Matches
 * BOTH spellings the script has used (AC1 of gap-test-coverage-check-parses-stale-files-variable):
 *   - current: `local glob=(packages/*\/test/*.test.mjs plugin/test/*.test.mjs experiments/...)`
 *     inside `build_deduped_files()` (layer-grouping rename);
 *   - legacy:  `files=(...)` from before the rename.
 * An empty or absent glob is a PARSE FAILURE — the check's single-source premise is broken, so this
 * THROWS (fail-loud, AC2) rather than silently returning `[]` (which would make every discovered
 * test file an "orphan": the check going red for the wrong reason, or worse, green against a
 * genuinely-empty canonical set). The guard is the POST-FILTER non-emptiness check — it catches not
 * only a missing line and `glob=()` but also whitespace-only content (`glob=( )`, `glob=(\n)`),
 * which `.split(/\s+/).filter(Boolean)` would otherwise reduce to `[]` (REFUTE round-1 MAJOR). The
 * runtime `local files=() f` array in `run_selected()` can therefore never masquerade as the glob.
 */
function parseCanonicalGlobs(repoRoot: string): string[] {
  const src = readFileSafe(path.join(repoRoot, "scripts", "test.sh"));
  // Prefer the CURRENT `glob=` spelling; fall back to legacy `files=` only when NO `glob=` line
  // exists at all — a stray legacy line must never shadow the live one (leftmost-match ordering,
  // REFUTE round-1 MINOR).
  const m =
    src.match(/(?:^|\n)[ \t]*(?:local[ \t]+)?glob=\(([^)]*)\)/) ??
    src.match(/(?:^|\n)[ \t]*(?:local[ \t]+)?files=\(([^)]*)\)/);
  const patterns = m
    ? m[1]
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  if (patterns.length === 0) {
    throw new Error(
      "cannot parse a non-empty canonical glob from scripts/test.sh " +
        "(expected a `local glob=(...)` line, or a legacy `files=(...)` line). " +
        "An unparseable/empty glob is a single-source break (ADR-004) — failing loudly instead of " +
        "silently reporting zero canonical files."
    );
  }
  return patterns;
}

function globSegmentToRegex(seg: string): RegExp {
  const escaped = seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`);
}

/** Expand a single glob pattern (each `/`-separated segment MAY contain `*`) against `root`,
 * returning absolute file paths. Only supports whole-segment wildcards, which is exactly the
 * shape `scripts/test.sh` uses (`packages/*\/test/*.test.mjs`, `plugin/test/*.test.mjs`). */
function expandGlob(pattern: string, root: string): string[] {
  const segments = pattern.split("/");
  let current = [root];
  for (const seg of segments) {
    if (!seg.includes("*")) {
      current = current.map((dir) => path.join(dir, seg)).filter((p) => fs.existsSync(p));
      continue;
    }
    const re = globSegmentToRegex(seg);
    const next: string[] = [];
    for (const dir of current) {
      let entries: string[] = [];
      try {
        entries = fs.readdirSync(dir);
      } catch {
        entries = [];
      }
      for (const e of entries) {
        if (re.test(e)) next.push(path.join(dir, e));
      }
    }
    current = next;
  }
  return current.filter((p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  });
}

/** The real set of files `scripts/test.sh`'s default (no-args) invocation actually runs. */
function canonicalTestFiles(repoRoot: string): Set<string> {
  const patterns = parseCanonicalGlobs(repoRoot);
  const out = new Set<string>();
  for (const pattern of patterns) {
    for (const abs of expandGlob(pattern, repoRoot)) {
      out.add(path.relative(repoRoot, abs));
    }
  }
  return out;
}

/** Walk the repo (excluding EXCLUDE_DIR_NAMES) collecting every `.test.mjs` file that sits
 * directly inside a directory named `test` — the exact shape both existing canonical roots
 * (`packages/*\/test/`, `plugin/test/`) share, generalized to "any future test/ directory" per
 * ADR-019 Decision #4's own wording, without hardcoding package names. */
function discoverProductTierTestFiles(repoRoot: string): Set<string> {
  // Index-driven discovery (primary): "real" test files are the ones git TRACKS. Walking the
  // filesystem instead picks up gitignored artifact checkouts (`**/worktrees/` — thousands of
  // stale test files on this repo) and reports them as orphans, going red for the wrong reason.
  // The index is identical in a linked worktree and the main checkout, which also kills the
  // "isolation-green / main-checkout-red" class for this check (the fs walk saw different files
  // on disk depending on which checkout it ran from).
  const res = spawnSync("git", ["ls-files", "-z", "--", "*.test.mjs"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (res.status === 0) {
    const out = new Set<string>();
    for (const rel of res.stdout.split("\0")) {
      if (!rel.endsWith(".test.mjs")) continue;
      const parts = rel.split("/");
      // Only files directly inside a directory named `test` — the shape the walk collected.
      if (parts.length < 2 || parts[parts.length - 2] !== "test") continue;
      // Replicate the walk's EXCLUDE_DIR_NAMES skip (applies at any level).
      if (parts.slice(0, -1).some((seg) => EXCLUDE_DIR_NAMES.has(seg))) continue;
      out.add(rel);
    }
    return out;
  }
  // Fallback (selftest / unit-test scratch fixtures, which are not git checkouts): a non-git
  // directory has no gitignore artifacts by construction, so the fs walk cannot pick up stale
  // `**/worktrees/` checkouts here. Any OTHER git failure is a real error — fail loud.
  if (!(res.stderr ?? "").toLowerCase().includes("not a git repository")) {
    throw new Error(
      `git ls-files failed (exit ${res.status}): ${res.stderr ?? ""}${res.stdout ?? ""}`
    );
  }
  return discoverProductTierTestFilesByWalk(repoRoot);
}

/** fs-walk fallback used only for non-git contexts (see discoverProductTierTestFiles). */
function discoverProductTierTestFilesByWalk(repoRoot: string): Set<string> {
  const out = new Set<string>();
  function walk(dir: string): void {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (EXCLUDE_DIR_NAMES.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.name === "test") {
        let files: string[] = [];
        try {
          files = fs.readdirSync(full);
        } catch {
          files = [];
        }
        for (const f of files) {
          if (f.endsWith(".test.mjs")) {
            out.add(path.relative(repoRoot, path.join(full, f)));
          }
        }
      }
      walk(full);
    }
  }
  walk(repoRoot);
  return out;
}

export interface OrphanReport {
  canonicalCount: number;
  discoveredCount: number;
  orphans: string[];
}

/** Orphans = discovered product/plugin-tier test files NOT reachable by scripts/test.sh's own
 * canonical glob — the exact DIR-108 failure shape, generalized. */
function findOrphans(repoRoot: string): OrphanReport {
  const canonical = canonicalTestFiles(repoRoot);
  const discovered = discoverProductTierTestFiles(repoRoot);
  const orphans = [...discovered].filter((f) => !canonical.has(f)).sort();
  return { canonicalCount: canonical.size, discoveredCount: discovered.size, orphans };
}

export { parseCanonicalGlobs, expandGlob, canonicalTestFiles, discoverProductTierTestFiles, findOrphans, EXCLUDE_DIR_NAMES };

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--selftest")) return runSelftest();
  const asJson = args.includes("--json");

  let report: OrphanReport;
  try {
    report = findOrphans(REPO_ROOT);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`test-coverage-check: ${msg}`);
    return 2; // usage/environment error (single-source link broken) — matches header contract
  }
  if (asJson) {
    console.log(JSON.stringify({ ok: report.orphans.length === 0, ...report }, null, 2));
  } else {
    console.log(
      `test-coverage-check — canonical=${report.canonicalCount} discovered=${report.discoveredCount}`
    );
    if (report.orphans.length === 0) {
      console.log("PASS: 0 orphan(s) — every discovered product/plugin-tier test file is reachable by scripts/test.sh");
    } else {
      console.log(`FAIL: ${report.orphans.length} orphan(s) found — reachable by discovery, NOT by scripts/test.sh's canonical glob:`);
      for (const o of report.orphans) console.log(`    - ${o}`);
    }
  }
  return report.orphans.length === 0 ? 0 : 1;
}

// ── selftest (ADR-018 selfcheck-fixture pattern: demonstrate BOTH the RED and GREEN state) ────────
function runSelftest(): number {
  let pass = 0;
  let fail = 0;
  function check(name: string, cond: boolean, detail = "") {
    if (cond) {
      pass++;
    } else {
      fail++;
      console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
    }
  }

  // ── parseCanonicalGlobs against the REAL repo (AC1: current `local glob=(...)` spelling) ──
  let globs: string[];
  try {
    globs = parseCanonicalGlobs(REPO_ROOT);
  } catch (e) {
    globs = [];
    check("parseCanonicalGlobs parses the real test.sh glob", false, String(e));
  }
  check(
    "AC1: parseCanonicalGlobs finds all three canonical patterns (packages, plugin, experiments)",
    globs.length === 3 &&
      globs.includes("packages/*/test/*.test.mjs") &&
      globs.includes("plugin/test/*.test.mjs") &&
      globs.includes("experiments/quay-perpetual-stream/test/*.test.mjs"),
    JSON.stringify(globs)
  );

  // ── AC1: legacy `files=(...)` spelling still parses (pre-rename test.sh) ──
  const legacyScratch = fs.mkdtempSync(path.join(os.tmpdir(), "test-coverage-check-legacy-"));
  try {
    fs.mkdirSync(path.join(legacyScratch, "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(legacyScratch, "scripts", "test.sh"),
      'files=(packages/*/test/*.test.mjs plugin/test/*.test.mjs)\nexec node --test "${files[@]}"\n'
    );
    const legacyGlobs = parseCanonicalGlobs(legacyScratch);
    check(
      "AC1: legacy `files=(...)` spelling parses",
      legacyGlobs.includes("packages/*/test/*.test.mjs") && legacyGlobs.includes("plugin/test/*.test.mjs"),
      JSON.stringify(legacyGlobs)
    );
  } catch (e) {
    check("AC1: legacy `files=(...)` spelling parses", false, String(e));
  } finally {
    fs.rmSync(legacyScratch, { recursive: true, force: true });
  }

  // ── AC2: an empty/absent glob is a PARSE FAILURE (fail-loud), never a silent [] ──
  const brokenScratch = fs.mkdtempSync(path.join(os.tmpdir(), "test-coverage-check-broken-"));
  try {
    fs.mkdirSync(path.join(brokenScratch, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(brokenScratch, "scripts", "test.sh"), "exec node --test\n");
    let threw = false;
    try {
      parseCanonicalGlobs(brokenScratch);
    } catch {
      threw = true;
    }
    check("AC2: no glob line → parseCanonicalGlobs THROWS (fail-loud, not silent [])", threw);

    // The runtime `local files=() f` array (empty capture) must NOT be mistaken for the glob —
    // before the fix it was the FIRST `files=(...)` match, silently yielding [].
    fs.writeFileSync(
      path.join(brokenScratch, "scripts", "test.sh"),
      'local files=() f\nexec node --test "${files[@]}"\n'
    );
    threw = false;
    try {
      parseCanonicalGlobs(brokenScratch);
    } catch {
      threw = true;
    }
    check("AC2: runtime `local files=() f` (empty) is NOT parsed as the glob → fail-loud", threw);
  } finally {
    fs.rmSync(brokenScratch, { recursive: true, force: true });
  }

  // ── AC5: canonical set == scripts/test.sh's OWN default selection (--list-files), both
  // realpath-deduped (matching build_deduped_files). no-args --list-files reports the FULL
  // reachable surface = the product,engine body + the serial phase + the lowconc phase (the
  // default run executes all four groups — gap-test-file-snapshot-worktree-drops-realinstall), so
  // this stays a direct equality. If the two ever diverge, the check is failing its ADR-004
  // single-source purpose. Wrapped so a throw from canonicalTestFiles (broken test.sh) surfaces as
  // a FAIL, not an uncaught stack trace (REFUTE round-1 MINOR). ──
  {
    let ac5 = false;
    let detail = "";
    try {
      const canonReal = new Set(
        [...canonicalTestFiles(REPO_ROOT)].map((f) => {
          try {
            return fs.realpathSync(path.join(REPO_ROOT, f));
          } catch {
            return path.join(REPO_ROOT, f);
          }
        })
      );
      // no-args --list-files reports all four groups (product,engine + serial + lowconc,
      // gap-test-file-snapshot-worktree-drops-realinstall) — the same set as the explicit
      // product,engine,serial,lowconc enumeration below, kept explicit so the single-source
      // comparison never depends on the no-args default's group composition.
      const listOut = spawnSync("bash", ["scripts/test.sh", "--group", "product,engine,serial,lowconc", "--list-files"], { cwd: REPO_ROOT, encoding: "utf8" });
      const listSet = new Set(listOut.status === 0 ? listOut.stdout.trim().split("\n").filter(Boolean) : []);
      ac5 =
        listOut.status === 0 && canonReal.size === listSet.size && [...canonReal].every((f) => listSet.has(f));
      detail = `canonical=${canonReal.size} list-files=${listSet.size}`;
    } catch (e) {
      detail = String(e);
    }
    check(
      "AC5: canonical set == scripts/test.sh --list-files (realpath-deduped)",
      ac5,
      detail
    );
  }

  // ── real repo tree: zero known orphans right now (DIR-110 AC4) ──
  const realReport = findOrphans(REPO_ROOT);
  check(
    "real repo tree has zero orphans right now",
    realReport.orphans.length === 0,
    JSON.stringify(realReport.orphans)
  );
  check("real repo canonical set is non-empty", realReport.canonicalCount > 0, String(realReport.canonicalCount));

  // ── scratch fixture: plant a GENUINE orphan (a new top-level "package-like" test/ directory
  // that scripts/test.sh's glob does NOT cover), prove RED, remove it, prove GREEN ──
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "test-coverage-check-selftest-"));
  try {
    fs.mkdirSync(path.join(scratch, "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(scratch, "scripts", "test.sh"),
      'local glob=(packages/*/test/*.test.mjs plugin/test/*.test.mjs)\nexec node --test "${glob[@]}"\n'
    );
    fs.mkdirSync(path.join(scratch, "packages", "pkg-a", "test"), { recursive: true });
    fs.writeFileSync(path.join(scratch, "packages", "pkg-a", "test", "a.test.mjs"), "// fixture\n");
    fs.mkdirSync(path.join(scratch, "plugin", "test"), { recursive: true });
    fs.writeFileSync(path.join(scratch, "plugin", "test", "b.test.mjs"), "// fixture\n");

    // GREEN: no orphan planted yet.
    const green1 = findOrphans(scratch);
    check("fixture GREEN before planting orphan", green1.orphans.length === 0, JSON.stringify(green1.orphans));

    // Plant a genuine orphan: a brand-new top-level "future test/ directory" (a package added
    // without updating scripts/test.sh's glob — exactly the DIR-108 failure class, generalized).
    const orphanDir = path.join(scratch, "newpkg", "test");
    fs.mkdirSync(orphanDir, { recursive: true });
    fs.writeFileSync(path.join(orphanDir, "orphan.test.mjs"), "// fixture: deliberately orphaned\n");

    // RED: the orphan is discovered but not covered by the canonical glob.
    const red = findOrphans(scratch);
    check(
      "fixture RED after planting orphan — named in output",
      red.orphans.length === 1 && red.orphans[0] === path.join("newpkg", "test", "orphan.test.mjs"),
      JSON.stringify(red.orphans)
    );

    // Remove the orphan.
    fs.rmSync(path.join(scratch, "newpkg"), { recursive: true, force: true });

    // GREEN again: removing it restores the passing state.
    const green2 = findOrphans(scratch);
    check("fixture GREEN after removing orphan", green2.orphans.length === 0, JSON.stringify(green2.orphans));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }

  console.log(`\ntest-coverage-check --selftest: ${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) {
  process.exit(main(process.argv));
}
