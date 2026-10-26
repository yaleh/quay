// probe-fallback-path-check.ts — "the fallback a probe DECLARES is a path that actually resolves".
//
// WHY THIS EXISTS (measured, 2026-10-26): both routine-filed probes declared `fallback: git-lens`
// and named three scripts in `plugin/scripts/` — `git-lens-l-d-code-doc-ratio.ts`,
// `git-lens-l-g-structural-drift.ts`, `git-lens-l-s-behavior-variance.ts` — that were archived to
// `archive/2026-09-07-zero-call-scripts/` and are ABSENT on disk. A run on a host without the
// archguard MCP follows the declared fallback into `ERR_MODULE_NOT_FOUND`, the spawn produces no
// findings, and the routine records an EMPTY findings array — which its carrier cannot distinguish
// from a genuine "ran and found nothing" measurement (硬规则 3b: "could not read the input" must not
// share the shape of "judged and found none"). The paths were edited 2026-09-13 / 2026-10-20 —
// AFTER the archive — so nothing mechanical was watching the link between prose and disk.
//
// THE INVARIANT (one script, checked pre-spawn by `probe-routine.ts`):
//   every file path named in a probe's FALLBACK section
//     (a) RESOLVES on disk — as the source file, or as its shipped artifact sibling
//         (`scripts/dist/<name>.js`, the same resolution `resolveKernelSibling` performs; a
//         `.ts`-only check would suppress the probe track on every dist install), and
//     (b) survives a FIXTURE RUN — `node [--experimental-strip-types] <path> --help` for JS/TS,
//         `bash -n <path>` for shell — whose exit is 0 or 1 and whose stderr carries NO
//         module-resolution error (`ERR_MODULE_NOT_FOUND` / `Cannot find module` / ...).
//
// ⛔ (b) is not implied by (a): a file can exist and still fail module resolution because a sibling
// it imports was moved. Node resolves the whole static import graph before `main()` runs, so
// `--help` is a cheap resolution proof that costs no instrument run (archguard's analyze is
// ~27s/task — ⛔ never invoked here). `archguard-runner.ts` gained a `--help` arm (exit 0) for
// exactly this: it used to answer 2, which the fixture contract would have read as a failure.
//
// WHAT IS *NOT* CHECKED (deliberately — 硬规则 12: no new prerequisite without an incidence count):
//   a probe whose fallback is a TOOL name rather than a file path (e.g. `fallback: playwright`,
//   `fallback: live-readers`) has nothing on disk to check and is not required to name one. Only
//   paths that ARE named are held to the invariant.
//
// Usage:
//   node --experimental-strip-types plugin/scripts/probe-fallback-path-check.ts [--root <repo>]
//        [--plugin-root <plugin>] [--probe <name>] [--no-fixture] [--json]
//   defaults: --root = cwd, --plugin-root = <root>/plugin
//
// Exit: 0 = every named fallback path exists and passes the fixture run;
//       1 = at least one violation (absent / module-resolution error / unexpected exit);
//       2 = usage error;
//       3 = NOT-EVALUATED (the probes directory could not be read, or --probe names no spec) —
//           ⛔ a distinct value, never folded into 0 ("checked and clean").
//
// Consumers: `probe-routine.ts` (pre-spawn, step ③c) and a human/CI invocation.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { isDirectEntry } from "./gate-script-base.ts";
import { parseFrontmatter } from "./read-probe-spec.ts";

/** A FALLBACK declaration marker inside a probe body (case-insensitive). A BLOCKQUOTE line carrying
 *  the word (`> … the `fallback:` declared above …`) is PROSE about the fallback, not the section
 *  that names it — measured while writing this check: without the blockquote exclusion the first hit
 *  in `architecture-analysis.md` was such a line, the section ended immediately, and the real
 *  fallback bullets were never checked (a check that silently degrades to zero paths is worse than
 *  no check — 硬规则 3b). */
const FALLBACK_MARKER = /\bFALLBACK\b/i;
const BLOCKQUOTE_RE = /^\s*>/;
/** The word standing at the START of a bullet — a bullet at ANY indent continues the fallback block
 *  (the deep-scan probe nests its reader bullets under a `- FALLBACK` item). */
const BULLET_RE = /^\s*[-*+]\s/;
/** A probe-internal, repo-relative executable path. The trailing `(?![A-Za-z0-9_])` is load-bearing:
 *  without it `plugin/freshness-producers.json` matches as `…producers.js` (measured while writing
 *  this check). */
const FALLBACK_PATH_RE =
  /(?:^|[^A-Za-z0-9_./-])(plugin\/[A-Za-z0-9_./-]*[A-Za-z0-9_-]\.(?:ts|mts|cts|mjs|cjs|js|jsx|tsx|sh))(?![A-Za-z0-9_])/g;

/** stderr fragments that mean "a module the fixture tried to load did not resolve" — the exact
 *  failure mode the archived `git-lens-*.ts` paths produced. */
const MODULE_RESOLUTION_RE =
  /ERR_MODULE_NOT_FOUND|Cannot find module|ERR_UNSUPPORTED_DIR_IMPORT|ERR_UNKNOWN_FILE_EXTENSION/;

export interface FallbackSection {
  /** 1-based line of the FALLBACK marker. */
  startLine: number;
  /** 1-based line of the last line in the section. */
  endLine: number;
  text: string;
}

/** Where a fallback path was named. */
export interface FallbackPathRef {
  probe: string;
  /** 1-based line within the probe FILE (frontmatter included). */
  line: number;
  relPath: string;
}

export interface FixtureRun {
  command: string[];
  exit: number | null;
  signal: string | null;
  moduleResolutionError: boolean;
  stderrTail: string;
  error: string | null;
}

export interface FallbackPathReading extends FallbackPathRef {
  /** The file the check actually ran (candidate resolution below). */
  resolvedPath: string | null;
  /** Every location tried — carried into the failure reason so "absent" names WHERE it looked. */
  candidates: string[];
  exists: boolean;
  fixture: FixtureRun | null;
  ok: boolean;
  reason: string;
}

export interface ProbeFallbackCheckReport {
  /** false ⇒ the check could not be performed (unreadable probes dir / named probe not found).
   *  ⛔ Never reported as `ok: true` (硬规则 3b). */
  evaluated: boolean;
  ok: boolean;
  reason: string;
  pluginRoot: string;
  probesScanned: string[];
  readings: FallbackPathReading[];
  violations: FallbackPathReading[];
}

export interface ProbeFallbackCheckOptions {
  /** Only this probe (the production pre-spawn path passes the routine's own probe). */
  probe?: string;
  /** Fixture-run seam (tests of the EXISTENCE half pass false, so they need no `node` spawn). */
  runFixture?: boolean;
  /** Per-fixture timeout. The fixture is `--help`, so it never needs instrument time. */
  timeoutMs?: number;
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function isBlank(line: string): boolean {
  return line.trim() === "";
}

/**
 * The FALLBACK section of a probe body: from the line carrying the FALLBACK marker through the
 * fallback block that follows it.
 *
 * The block CONTINUES across blank lines, indented continuation lines, and bullets at any indent;
 * it STOPS at the first non-blank line that is (a) not a bullet and (b) indented no deeper than the
 * marker. That one rule covers both shapes in the corpus:
 *   · `architecture-analysis.md` — one marker paragraph, a blank line, then three top-level bullets;
 *     the following prose paragraph stops the section.
 *   · `semantic-dedup-scan.md` — a `- FALLBACK` bullet, its wrapped continuation, nested bullets,
 *     then the next top-level bullet; the prose after the list stops the section.
 *
 * Limitations (documented, not hidden): fenced code blocks are not treated specially, and a marker
 * inside a blockquote stops at its own line. Neither shape exists in the corpus; if one appears,
 * the check gets STRICTER (fewer paths), never silently looser.
 */
export function extractFallbackSection(body: string): FallbackSection | null {
  const lines = String(body).split(/\r?\n/);
  const start = lines.findIndex((l) => !BLOCKQUOTE_RE.test(l) && FALLBACK_MARKER.test(l));
  if (start < 0) return null;
  const markerIndent = indentOf(lines[start]);
  let last = start;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (isBlank(line)) {
      last = i; // tentatively included; trailing blanks are trimmed below
      continue;
    }
    if (BULLET_RE.test(line) || indentOf(line) > markerIndent) {
      last = i;
      continue;
    }
    break;
  }
  while (last > start && isBlank(lines[last])) last--;
  return { startLine: start + 1, endLine: last + 1, text: lines.slice(start, last + 1).join("\n") };
}

/** Every file path named in the probe's FALLBACK section (empty when the probe declares none). */
export function extractFallbackPaths(probe: string, body: string): FallbackPathRef[] {
  const section = extractFallbackSection(body);
  if (!section) return [];
  const refs: FallbackPathRef[] = [];
  for (const m of section.text.matchAll(FALLBACK_PATH_RE)) {
    const relPath = m[1];
    if (!relPath) continue;
    const index = m.index ?? 0;
    const offset = section.text.slice(0, index).split("\n").length - 1;
    refs.push({ probe, line: section.startLine + offset, relPath });
  }
  return refs;
}

/** Where a repo-relative `plugin/...` path could live. Two LAYOUTS are tried first — the source
 *  repo (`<repo>/plugin/scripts/x.ts`) and an installed plugin root whose parent is NOT a repo
 *  (`<pluginRoot>/scripts/x.ts`) — and then, for a `.ts` reference, its SHIPPED ARTIFACT form
 *  (`<dir>/scripts/dist/x.js`).
 *
 *  Why the artifact form is load-bearing: the publish step strips raw `.ts` from the plugin
 *  artifact, so a `.ts`-only check would report every fallback path absent on a real install and the
 *  pre-spawn gate would suppress the probe track there FOREVER — an availability regression bought
 *  to fix a legibility bug. `<dir>/dist/x.js` is exactly the resolution `driver-runtime.ts`'s
 *  `resolveKernelSibling` performs (the kernel's single sibling-resolution entry), so "resolves here"
 *  means the same thing the kernel means by it. ⛔ The archived `git-lens-*.ts` defect is still
 *  caught: those resolved in NEITHER form (they were never bundle entries at all). */
export function resolveFallbackPath(repoRoot: string, pluginRoot: string, relPath: string): { exists: boolean; resolvedPath: string | null; candidates: string[] } {
  const roots = [path.resolve(repoRoot, relPath)];
  if (relPath.startsWith("plugin/")) roots.push(path.resolve(pluginRoot, relPath.slice("plugin/".length)));
  // The shipped-artifact sibling: `…/scripts/x.ts` → `…/scripts/dist/x.js` (same directory + `dist`).
  const artifactRoots = /\.(?:ts|mts|cts)$/.test(relPath)
    ? roots.map((p) => path.join(path.dirname(p), "dist", `${path.basename(p).replace(/\.(?:ts|mts|cts)$/, "")}.js`))
    : [];
  const candidates = [...roots, ...artifactRoots];
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return { exists: true, resolvedPath: c, candidates };
    } catch {
      // candidate absent — try the next one
    }
  }
  return { exists: false, resolvedPath: null, candidates };
}

/**
 * FIXTURE RUN: prove the declared path RESOLVES (its whole static import graph) without running the
 * instrument. `--help` is answered before any work in every reader named by the corpus.
 */
export function runFallbackFixture(absPath: string, cwd: string, timeoutMs = 20_000): FixtureRun {
  const ext = path.extname(absPath).toLowerCase();
  const isTs = ext === ".ts" || ext === ".mts" || ext === ".cts";
  const command = ext === ".sh"
    ? ["bash", "-n", absPath]
    : [process.execPath, "--no-warnings", ...(isTs ? ["--experimental-strip-types"] : []), absPath, "--help"];
  const r = spawnSync(command[0], command.slice(1), { cwd, encoding: "utf8", timeout: timeoutMs });
  const stderr = String(r.stderr ?? "");
  const err = r.error ? (r.error as NodeJS.ErrnoException) : null;
  return {
    command,
    exit: typeof r.status === "number" ? r.status : null,
    signal: r.signal ?? null,
    moduleResolutionError: MODULE_RESOLUTION_RE.test(stderr),
    stderrTail: stderr.trim().split(/\r?\n/).filter(Boolean).slice(-6).join("\n"),
    error: err ? `${err.code ?? ""} ${err.message}`.trim() : null,
  };
}

/**
 * The check itself. Reads `<pluginRoot>/probes/*.md`, extracts every FALLBACK-section path from each
 * (or only `opts.probe`), and holds each one to existence + the fixture run.
 */
export function checkProbeFallbacks(pluginRoot: string, opts: ProbeFallbackCheckOptions = {}): ProbeFallbackCheckReport {
  const root = path.resolve(pluginRoot);
  const repoRoot = path.dirname(root);
  const probesDir = path.join(root, "probes");
  const notEvaluated = (reason: string): ProbeFallbackCheckReport => ({
    evaluated: false,
    ok: false,
    reason,
    pluginRoot: root,
    probesScanned: [],
    readings: [],
    violations: [],
  });

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(probesDir, { withFileTypes: true });
  } catch (e) {
    return notEvaluated(`probes directory unreadable: ${probesDir} (${(e as Error).message})`);
  }
  let names = entries.filter((d) => d.isFile() && d.name.endsWith(".md")).map((d) => d.name.slice(0, -3)).sort();
  if (opts.probe !== undefined) names = names.filter((n) => n === opts.probe);
  if (names.length === 0) {
    return notEvaluated(
      opts.probe !== undefined
        ? `probe spec not found in ${probesDir}: ${opts.probe}`
        : `no probe specs (*.md) in ${probesDir}`,
    );
  }

  const readings: FallbackPathReading[] = [];
  for (const name of names) {
    const file = path.join(probesDir, `${name}.md`);
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (e) {
      return notEvaluated(`probe spec unreadable: ${file} (${(e as Error).message})`);
    }
    const { body } = parseFrontmatter(text);
    for (const ref of extractFallbackPaths(name, body)) {
      const resolved = resolveFallbackPath(repoRoot, root, ref.relPath);
      let fixture: FixtureRun | null = null;
      let ok = resolved.exists;
      let reason = resolved.exists
        ? "exists; fixture run not requested"
        : `absent — no candidate exists (${resolved.candidates.join(", ")})`;
      if (resolved.exists && opts.runFixture !== false) {
        fixture = runFallbackFixture(resolved.resolvedPath as string, repoRoot, opts.timeoutMs);
        if (fixture.error) {
          ok = false;
          reason = `fixture run could not spawn (${fixture.error})`;
        } else if (fixture.moduleResolutionError) {
          ok = false;
          reason = `fixture run exited ${fixture.exit} with a MODULE-RESOLUTION error (${fixture.command.join(" ")}): ${fixture.stderrTail}`;
        } else if (fixture.exit !== 0 && fixture.exit !== 1) {
          ok = false;
          reason = `fixture run exited ${fixture.exit ?? `signal=${fixture.signal}`} (expected 0 or 1): ${fixture.stderrTail}`;
        } else {
          ok = true;
          reason = `exists; fixture run exited ${fixture.exit} with no module-resolution error`;
        }
      }
      readings.push({ ...ref, resolvedPath: resolved.resolvedPath, candidates: resolved.candidates, exists: resolved.exists, fixture, ok, reason });
    }
  }

  const violations = readings.filter((r) => !r.ok);
  const ok = violations.length === 0;
  return {
    evaluated: true,
    ok,
    reason: ok
      ? `${readings.length} fallback path(s) across ${names.length} probe(s) exist${opts.runFixture === false ? "" : " and pass the fixture run"}`
      : `${violations.length} of ${readings.length} fallback path(s) are not runnable: ${violations.map((v) => `${v.relPath} (${v.reason})`).join("; ")}`,
    pluginRoot: root,
    probesScanned: names,
    readings,
    violations,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────

const USAGE = [
  "probe-fallback-path-check — every path named in a probe's FALLBACK section exists on disk and",
  "survives a fixture run (node --experimental-strip-types <path> --help, or bash -n for .sh).",
  "",
  "usage: node --experimental-strip-types plugin/scripts/probe-fallback-path-check.ts \\",
  "         [--root <repo>] [--plugin-root <plugin>] [--probe <name>] [--no-fixture] [--json]",
  "",
  "  --root <dir>         repo root (default: cwd)",
  "  --plugin-root <dir>  plugin root holding probes/ (default: <root>/plugin)",
  "  --probe <name>       check only this probe spec",
  "  --no-fixture         existence only (skip the fixture run)",
  "  --json               print the full report as JSON",
  "  --help               print this text",
  "",
  "Exit: 0 = all fallback paths runnable | 1 = violation | 2 = usage | 3 = NOT-EVALUATED",
  "",
].join("\n");

function main(argv: string[]): number {
  let root = process.cwd();
  let pluginRootArg = "";
  let probe: string | undefined;
  let runFixture = true;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      process.stdout.write(USAGE);
      return 0;
    } else if (a === "--root") root = argv[++i] ?? root;
    else if (a.startsWith("--root=")) root = a.slice("--root=".length);
    else if (a === "--plugin-root") pluginRootArg = argv[++i] ?? pluginRootArg;
    else if (a.startsWith("--plugin-root=")) pluginRootArg = a.slice("--plugin-root=".length);
    else if (a === "--probe") probe = argv[++i];
    else if (a.startsWith("--probe=")) probe = a.slice("--probe=".length);
    else if (a === "--no-fixture") runFixture = false;
    else if (a === "--json") json = true;
    else {
      process.stderr.write(`probe-fallback-path-check: unknown argument: ${a}\n${USAGE}`);
      return 2;
    }
  }
  const pluginRoot = pluginRootArg ? path.resolve(pluginRootArg) : path.join(path.resolve(root), "plugin");
  const report = checkProbeFallbacks(pluginRoot, { probe, runFixture });
  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    const state = !report.evaluated ? "NOT-EVALUATED" : report.ok ? "PASS" : "FAIL";
    process.stdout.write(`probe-fallback-path-check: ${state} — ${report.reason}\n`);
    for (const r of report.readings) {
      process.stdout.write(`  ${r.ok ? "ok  " : "FAIL"} ${r.probe}:${r.line} ${r.relPath} — ${r.reason}\n`);
    }
  }
  if (!report.evaluated) return 3;
  return report.ok ? 0 : 1;
}

const invokedDirectly = (() => {
  try {
    return isDirectEntry(import.meta, undefined, "probe-fallback-path-check");
  } catch {
    return false;
  }
})();
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
