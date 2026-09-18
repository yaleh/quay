// quay-init-closure-ratchet.ts — the shrink-only ratchet over the REAL quay-init laydown footprint.
// (gap-quay-init-closure-assertion-first — SPEC AC168 判据先行; gap-quay-init-closure-shrink-body —
//  the closure shrink body that actually cut the copy machinery, and re-anchors this baseline.)
//
// THE DEFECT THIS CLOSES: `quay-init --loop` used to copy the mechanism layer (117–131 scripts, tick
// docs, workflows, agents, probes, runtime) BYTE-FOR-BYTE into every target project's own git history.
// SPEC §6 (gap-quay-init-closure-shrink-body, AC168) shrunk the write surface to the SIX-item closed
// set (.quay/config.yml / .quay/profiles.yml / tasks/ / .gitignore / .claude/launch.settings.json /
// .claude/settings.json). This ratchet keeps the direction mechanical: baseline = the measured
// footprint, shrink-only (只许降不许升) — a change that makes quay-init lay down ONE MORE file (or
// byte) goes RED immediately.
//
// THE MEASUREMENT IS THE PRODUCTION CARRIER (SPEC AC4's counter-example criterion, hard rule 4 推论三):
// the checker runs a REAL `quay-init --all --loop --manager` laydown into a fresh temp target and counts
// the result. It does NOT read a fixture — a pass must survive the injection seam being turned off.
// `.quay/` is EXCLUDED from the count (config.yml embeds machine-specific absolute paths — the
// non-reproducible namespace). (The `--baseline-files/--baseline-bytes` overrides exist ONLY for the
// unit test + mutation case to exercise the ±1 judgment on a small controlled fixture; production reads
// the committed baseline file.)
//
// WHY A BASELINE FILE + A FRESHNESS GATE: the baseline is a COMMITTED, mechanically-refreshable file
// (`--reanchor` re-measures the real laydown + records the source-tree fingerprint); `--check-stale`
// hashes the laydown SOURCE tree and reds when a source file changed but the baseline was NOT
// re-anchored. The full-tier byte ratchet (`--gate`) still measures the REAL laydown.
//
// TWO CONSUMERS, ONE JUDGMENT (gap-closure-ratchet-stale-wire-into-precommit-guard): the suite's
// @static-tier change layer runs `--check-stale` (scripts/test.sh / runner-static-gate.ts) and the
// CTIME OF WRITING runs the very same judgment in-process (`precommit-guard.ts` ④, importing
// `LAYDOWN_SOURCES` / `readBaseline` / `collectSourceEntries` / `fingerprintOf` / `runLaydown` /
// `checkClosureRatchet` from here). The second consumer exists because the first one is LATE: the
// 2026-09-16 v0.8.0 release cut changed plugin.json (a laydown source) twice, committed + pushed
// cleanly, and only the remote CI's full-suite run reported `STATIC_CHECK_FAILED:
// quay-init-closure-ratchet-stale` (~1-2 min ×2 wasted runs). ⛔ This module stays the single home of
// the judgment; the guard is a caller, never a second implementation (硬规则 1 / 5b).
//
// THE FINGERPRINT SOURCE SET is the precise set that DETERMINES the closed-set laydown output:
//   plugin/scripts/quay-init.sh          the generator (config.yml / .gitignore / settings.json content)
//   plugin/.quay/profiles.yml            template laid verbatim
//   plugin/.claude/launch.settings.json  template laid verbatim
//   plugin/.claude-plugin/plugin.json    read for plugin name + version
// (The retired derived-script set + wholesale category dirs are gone — the copy machinery was archived
//  by gap-quay-init-closure-shrink-body AC1.)
//
// NOT-EVALUATED (exit 3, hard rule 3b): when the real laydown cannot run, OR the committed baseline is
// missing, OR the laydown source set cannot be computed, the checker reports NOT-EVALUATED
// (evaluated:false) — a checker that could not read its input must never look like "合格" (exit 0).
//
// MODES:
//   --gate [--root <dir>] [--json] [--baseline-files N] [--baseline-bytes B]
//       gate mode (wired into run_static_checks, @static-tier full). Exit 1 iff the real laydown
//       exceeds the baseline (files OR bytes). Exit 3 iff the laydown could not run (NOT-EVALUATED).
//   --reanchor [--root <dir>] [--json]
//       mechanical re-anchor: run the real laydown, record {files, bytes, fingerprint, sources} into
//       the committed baseline file. Exit 0 on success; exit 3 if the laydown/set cannot run.
//   --check-stale [--root <dir>] [--json]
//       freshness gate (wired into run_static_checks, @static-tier change). CHEAP (hashes the source
//       tree, no real laydown). Exit 1 iff the source fingerprint differs from the committed baseline
//       (a laydown source changed without a re-anchor); exit 3 iff the baseline/set cannot be read.
// Exit codes: 0 PASS · 1 gate FAIL (footprint grew / baseline stale) · 2 usage/env error · 3 NOT-EVALUATED.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
// getArgValue now lives in gate-script-base.ts as `flagValue` (it was one of the ~73 byte-identical
// copies of the indexOf+next-arg idiom in plugin/scripts; .quay/routine-findings.jsonl finding
// `arg-parsing-helper-family`, routine `semantic-dedup-scan`).
import { isDirectEntry, helpExit, emitPass, emitFail, emitNotEvaluated, flagValue } from "./gate-script-base.ts";
import { repoRoot } from "./repo-root.ts";

// `.quay/` is EXCLUDED from the measurement (the generated, non-deterministic namespace): config.yml
// embeds random target absolute paths (mcp_entry / repo_root / worktree_root), quay-init-state.json
// embeds a `laidAt` timestamp + per-file sha256 (incl. the runtime dist), and `.quay/runtime/` is the
// generated gitignored dist bundle whose byte size is build-environment-dependent. Including any of
// them would make the byte baseline non-reproducible across the main checkout and a fresh worktree.
// Everything ELSE quay-init lays down is a BYTE-IDENTICAL copy (verify-installed-executables proves it),
// so its byte count is stable — that stable copy set is the pollution footprint this ratchet locks.
const EXCLUDED_TOP_DIRS: ReadonlySet<string> = new Set([".quay"]);

// The committed, mechanically-refreshable baseline (the re-anchor target). Home is docs/analysis/
// alongside test-file-baseline.txt — a COMMITTED baseline artifact, not a plugin/scripts/ executable.
const BASELINE_FILE_REL = "docs/analysis/quay-init-closure-ratchet.baseline.json";

// The precise source set that DETERMINES the closed-set laydown output (repo-root-relative paths).
// quay-init.sh is the generator (its content decides config.yml/.gitignore/.claude/settings.json);
// the two templates are laid verbatim; plugin.json is read for the plugin name+version. A change to
// ANY of these must invalidate the baseline (re-anchor).
// EXPORTED (gap-closure-ratchet-stale-wire-into-precommit-guard): `precommit-guard.ts` imports this
// very constant to decide whether a commit touches the laydown source set — the freshness judgment is
// now ALSO run at the commit moment (④ there), not only at the suite's @static-tier change layer.
// ⛔ It must stay a single exported constant: a second hand-copied list in the guard would drift and
// one side would silently stop checking (硬规则 5b).
export const LAYDOWN_SOURCES: readonly string[] = [
  "plugin/scripts/quay-init.sh",
  "plugin/.quay/profiles.yml",
  "plugin/.claude/launch.settings.json",
  "plugin/.claude-plugin/plugin.json",
];

export interface ClosureCount {
  files: number;
  bytes: number;
}

export interface ClosureVerdict {
  /** true iff the laydown is within the baseline on BOTH axes (shrink-only holds). */
  ok: boolean;
  overFiles: boolean;
  overBytes: boolean;
}

export interface LaydownResult extends ClosureCount {
  /** false ⇒ the real laydown could not run (NOT-EVALUATED — never conflated with "0 files"). */
  evaluated: boolean;
  error?: string;
}

export interface SourceEntry {
  /** repo-root-relative path (forward slashes). */
  rel: string;
  /** sha256 hex of the file content. */
  sha: string;
}

export interface Baseline extends ClosureCount {
  /** sha256 over the sorted `rel \t sha` lines of `sources`. */
  fingerprint: string;
  /** per-file hashes at anchor time — enables a precise stale diff (added/changed/removed). */
  sources: SourceEntry[];
}

/**
 * The shrink-only judgment: ok iff the actual laydown is ≤ the baseline on BOTH file count and byte
 * count. A lower baseline ⇒ the same actual count goes RED (proves the checker counts production
 * artifacts); a higher baseline ⇒ GREEN (proves the direction is shrink-only, growth of the allowance
 * is allowed). Both directions are pinned by the unit test + mutation case.
 */
export function checkClosureRatchet(actual: ClosureCount, baseline: ClosureCount): ClosureVerdict {
  const overFiles = actual.files > baseline.files;
  const overBytes = actual.bytes > baseline.bytes;
  return { ok: !overFiles && !overBytes, overFiles, overBytes };
}

/**
 * Count regular files and their total byte size under `dir` (recursive, symlinks not followed).
 * `exclude` is a set of directory basenames to skip at ANY depth (used to drop `.quay/`).
 */
export function countTree(dir: string, exclude: ReadonlySet<string> = new Set()): ClosureCount {
  let files = 0;
  let bytes = 0;
  const walk = (d: string): void => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.isDirectory() && exclude.has(entry.name)) continue;
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile()) {
        files += 1;
        bytes += fs.statSync(p).size;
      }
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return { files, bytes };
}

/**
 * Run ONE real `quay-init --all --loop --manager` laydown into a fresh temp target and count the
 * product. Returns evaluated:false (NOT-EVALUATED) when quay-init.sh is absent or the laydown exits
 * non-zero. The temp target + worktree-root live OUTSIDE the repo (a sibling of `<root>`), NOT inside
 * `<root>/.quay/` (a target INSIDE the repo makes quay-init's auto-commit resolve UP and commit the
 * whole laydown into the repo — the exact pollution this ratchet exists to prevent). Removed in finally.
 */
export function runLaydown(root: string, opts: { timeoutMs?: number } = {}): LaydownResult {
  const quayInit = path.join(root, "plugin", "scripts", "quay-init.sh");  // kernel-sibling-dev-tree-only: dev-tree-only — repo-local plugin/scripts use, not third-party sibling resolution.
  if (!fs.existsSync(quayInit)) {
    return { evaluated: false, files: 0, bytes: 0, error: `quay-init.sh not found at ${quayInit}` };
  }
  const tmpBase = fs.mkdtempSync(path.join(path.dirname(root), "quay-init-ratchet-"));
  const target = path.join(tmpBase, "target");
  const worktreeRoot = path.join(tmpBase, "worktrees");
  fs.mkdirSync(target);
  fs.mkdirSync(worktreeRoot);
  try {
    execFileSync(
      "bash",
      [
        quayInit,
        "--all", "--loop", "--manager",
        "--root", target,
        "--repo-root", target,
        "--test-command", "node --test",
        "--tmux-session", "quay-init-closure-ratchet-probe",
        "--worktree-root", worktreeRoot,
        "--plugin-root", path.join(root, "plugin"),
      ],
      { timeout: opts.timeoutMs ?? 180_000, stdio: ["ignore", "ignore", "pipe"] },
    );
    return { evaluated: true, ...countTree(target, EXCLUDED_TOP_DIRS) };
  } catch (err) {
    const stderr = (err as { stderr?: unknown })?.stderr;
    const tail = stderr != null ? String(stderr).trim().split("\n").slice(-5).join(" ") : String(err);
    return { evaluated: false, files: 0, bytes: 0, error: tail.slice(0, 500) };
  } finally {
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
}

// ── fingerprint machinery (the mechanical re-anchor + freshness gate) ────────────────────────────────

function sha256Hex(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export function baselineFile(root: string): string {
  return path.join(root, ...BASELINE_FILE_REL.split("/"));
}

/**
 * Collect the precise laydown SOURCE set (repo-relative path + content sha256, sorted by rel) — the
 * files that DETERMINE the closed-set laydown output (the generator + the two verbatim templates +
 * the plugin manifest read for name/version). Returns null when any source is unreadable
 * (NOT-EVALUATED — a checker that cannot read its input is never "in sync").
 */
export function collectSourceEntries(root: string): SourceEntry[] | null {
  const entries: SourceEntry[] = [];
  for (const rel of LAYDOWN_SOURCES) {
    const abs = path.join(root, ...rel.split("/"));
    let st: fs.Stats;
    try {
      st = fs.statSync(abs);
    } catch {
      return null; // a missing laydown source ⇒ the fingerprint cannot be computed
    }
    if (!st.isFile()) return null;
    entries.push({ rel, sha: sha256Hex(fs.readFileSync(abs)) });
  }
  entries.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return entries;
}

/** sha256 over the sorted `rel \t sha` lines of the entries — the canonical fingerprint. Sorts a
 *  copy of its input so the fingerprint is order-independent regardless of how a caller built the list. */
export function fingerprintOf(entries: SourceEntry[]): string {
  const sorted = [...entries].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return sha256Hex(sorted.map((e) => `${e.rel}\t${e.sha}`).join("\n"));
}

export function readBaseline(root: string): Baseline | null {
  try {
    const raw = JSON.parse(fs.readFileSync(baselineFile(root), "utf8")) as Baseline;
    if (
      typeof raw.files !== "number" ||
      typeof raw.bytes !== "number" ||
      typeof raw.fingerprint !== "string" ||
      !Array.isArray(raw.sources)
    ) {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

export function writeBaseline(root: string, baseline: Baseline): void {
  const p = baselineFile(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(baseline, null, 2) + "\n");
}

const usage = `quay-init-closure-ratchet.ts — shrink-only ratchet over the REAL quay-init laydown footprint (SPEC AC168 判据先行)

Usage:
  node --experimental-strip-types quay-init-closure-ratchet.ts --gate [--root <dir>] [--json]
      gate mode — exit 1 iff the real laydown exceeds the committed baseline (files or bytes);
                  exit 3 (NOT-EVALUATED) iff the laydown could not run or the baseline is missing.
  node --experimental-strip-types quay-init-closure-ratchet.ts --reanchor [--root <dir>] [--json]
      re-anchor mode — re-measure the real laydown and write the committed baseline file.
  node --experimental-strip-types quay-init-closure-ratchet.ts --check-stale [--root <dir>] [--json]
      freshness mode — exit 1 iff the laydown SOURCE fingerprint differs from the committed baseline
      (a laydown source changed without a re-anchor); exit 3 iff the baseline/set cannot be read.`;

function doReanchor(root: string, asJson: boolean): number {
  const result = runLaydown(root);
  if (!result.evaluated) {
    return emitNotEvaluated(
      `quay-init-closure-ratchet: NOT-EVALUATED — ${result.error ?? "the real laydown could not run"} (cannot re-anchor without a measurement)`,
      { evaluated: false },
      { json: asJson },
    );
  }
  const entries = collectSourceEntries(root);
  if (entries === null) {
    return emitNotEvaluated(
      "quay-init-closure-ratchet: NOT-EVALUATED — the derived laydown set could not be computed (cannot record a source fingerprint)",
      { evaluated: false },
      { json: asJson },
    );
  }
  const baseline: Baseline = {
    files: result.files,
    bytes: result.bytes,
    fingerprint: fingerprintOf(entries),
    sources: entries,
  };
  writeBaseline(root, baseline);
  return emitPass(
    `quay-init-closure-ratchet: re-anchored baseline → ${result.files} files / ${result.bytes} bytes (fingerprint ${baseline.fingerprint.slice(0, 16)}…, ${entries.length} source files)`,
    {
      evaluated: true,
      files: result.files,
      bytes: result.bytes,
      fingerprint: baseline.fingerprint,
      sources: entries.length,
      baselineFile: BASELINE_FILE_REL,
    },
    { json: asJson },
  );
}

function doCheckStale(root: string, asJson: boolean): number {
  const baseline = readBaseline(root);
  if (baseline === null) {
    return emitNotEvaluated(
      `quay-init-closure-ratchet: NOT-EVALUATED — baseline file missing (${BASELINE_FILE_REL}); run --reanchor to create it`,
      { evaluated: false },
      { json: asJson },
    );
  }
  const entries = collectSourceEntries(root);
  if (entries === null) {
    return emitNotEvaluated(
      "quay-init-closure-ratchet: NOT-EVALUATED — the derived laydown set could not be computed (cannot judge freshness)",
      { evaluated: false },
      { json: asJson },
    );
  }
  const currentFp = fingerprintOf(entries);
  if (currentFp === baseline.fingerprint) {
    return emitPass(
      `quay-init-closure-ratchet: laydown source fingerprint fresh (${currentFp.slice(0, 16)}…, ${entries.length} sources) — baseline in sync`,
      { evaluated: true, fingerprint: currentFp, sources: entries.length },
      { json: asJson },
    );
  }
  const oldByRel = new Map((baseline.sources ?? []).map((e) => [e.rel, e.sha]));
  const curByRel = new Map(entries.map((e) => [e.rel, e.sha]));
  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  for (const e of entries) {
    if (!oldByRel.has(e.rel)) added.push(e.rel);
    else if (oldByRel.get(e.rel) !== e.sha) changed.push(e.rel);
  }
  for (const rel of oldByRel.keys()) if (!curByRel.has(rel)) removed.push(rel);
  if (!asJson) {
    for (const rel of [...added, ...changed, ...removed].sort()) {
      const kind = removed.includes(rel) ? "removed" : added.includes(rel) ? "added" : "changed";
      process.stdout.write(`  ${kind}: ${rel}\n`);
    }
  }
  return emitFail(
    `quay-init-closure-ratchet: laydown source changed since the baseline was recorded — re-anchor required (run --reanchor). changed=${changed.length} added=${added.length} removed=${removed.length}`,
    {
      evaluated: true,
      fingerprint: currentFp,
      baselineFingerprint: baseline.fingerprint,
      changed,
      added,
      removed,
    },
    { json: asJson },
  );
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit(usage);
  const root = path.resolve(flagValue(args, "--root") ?? repoRoot());
  const asJson = args.includes("--json");
  const gate = args.includes("--gate");
  const reanchor = args.includes("--reanchor");
  const checkStale = args.includes("--check-stale");

  const baselineFilesArg = flagValue(args, "--baseline-files");
  const baselineBytesArg = flagValue(args, "--baseline-bytes");
  const hasOverrides = baselineFilesArg !== undefined || baselineBytesArg !== undefined;

  if (!gate && !reanchor && !checkStale) {
    process.stderr.write(`${usage}\n`);
    return 2;
  }

  if (reanchor) return doReanchor(root, asJson);
  if (checkStale) return doCheckStale(root, asJson);

  // --gate: resolve the baseline from the committed file (production) or the test overrides.
  let baseline: ClosureCount;
  if (hasOverrides) {
    baseline = {
      files: Number(baselineFilesArg ?? 132),
      bytes: Number(baselineBytesArg ?? 0),
    };
  } else {
    const committed = readBaseline(root);
    if (committed === null) {
      return emitNotEvaluated(
        `quay-init-closure-ratchet: NOT-EVALUATED — baseline file missing (${BASELINE_FILE_REL}); run --reanchor to create it (a checker that cannot read its baseline is never conflated with "≤ baseline")`,
        { evaluated: false },
        { json: asJson },
      );
    }
    baseline = { files: committed.files, bytes: committed.bytes };
  }

  const result = runLaydown(root);
  if (!result.evaluated) {
    return emitNotEvaluated(
      `quay-init-closure-ratchet: NOT-EVALUATED — ${result.error ?? "the real laydown could not run"} (a checker that cannot read its input is never conflated with "≤ baseline")`,
      { evaluated: false },
      { json: asJson },
    );
  }

  const verdict = checkClosureRatchet(result, baseline);
  if (verdict.ok) {
    return emitPass(
      `quay-init laydown footprint ${result.files} files / ${result.bytes} bytes ≤ baseline ${baseline.files} files / ${baseline.bytes} bytes (shrink-only holds)`,
      { evaluated: true, files: result.files, bytes: result.bytes, baseline, ...verdict },
      { json: asJson },
    );
  }
  return emitFail(
    `quay-init laydown footprint GREW past the shrink-only baseline: ${result.files} files (baseline ${baseline.files}) / ${result.bytes} bytes (baseline ${baseline.bytes})`,
    { evaluated: true, files: result.files, bytes: result.bytes, baseline, ...verdict },
    { json: asJson },
  );
}

if (isDirectEntry(import.meta, undefined, "quay-init-closure-ratchet")) {
  process.exitCode = main(process.argv);
}
