// quay-init-closure-ratchet.ts — the shrink-only ratchet over the REAL quay-init laydown footprint,
// now with a MECHANICAL re-anchor (gap-quay-init-closure-ratchet-manual-reanchor-recurs).
// (gap-quay-init-closure-assertion-first — SPEC AC168 判据先行; the closure shrink body is a later wave.)
//
// THE DEFECT THIS CLOSES: `quay-init --loop` copies the mechanism layer (117–131 scripts, tick docs,
// workflows, agents, probes, runtime) BYTE-FOR-BYTE into every target project's own git history — a
// footprint measured ONCE (§2.9 of docs/proposals/archguard-generation-era-primitives.md: 142 files /
// 7.1 MB) and then never observed again. This ratchet makes the direction mechanical NOW: baseline =
// the measured footprint, shrink-only (只许降不许升) — a change that makes quay-init lay down ONE MORE
// file (or byte) goes RED immediately.
//
// THE MEASUREMENT IS THE PRODUCTION CARRIER (SPEC AC4's counter-example criterion, hard rule 4 推论三):
// the checker runs a REAL `quay-init --all --loop --manager` laydown into a fresh temp target and counts
// the result. It does NOT read `derive_loop_scripts`' static derivation for the byte judgment, and does
// NOT read a fixture — a pass must survive the injection seam being turned off. `.quay/` is EXCLUDED
// from the count (generated, non-deterministic namespace). (The `--baseline-files/--baseline-bytes`
// overrides exist ONLY for the unit test + mutation case to exercise the ±1 judgment on a small
// controlled fixture; production reads the committed baseline file.)
//
// WHY A BASELINE FILE + A FRESHNESS GATE (this task): the baseline used to be a hardcoded literal.
// Every legitimate growth of a laid-down mechanism file (meta-driver.ts, probes/meta-driver.md, …)
// tripped the byte axis, and the "fix" was a hand-edit of two numbers — done 7 times before this task.
// A threshold whose reasonableness depends on an exogenous variable (how many bytes other tasks added)
// is the hard rule 4 推论二 literal-value trap. The fix has two halves, both here:
//   ① the baseline is now a COMMITTED, mechanically-refreshable file (docs/analysis/…baseline.json):
//      `--reanchor` re-measures the real laydown + records the source-tree fingerprint, so a re-anchor
//      is one command, never a hand number edit;
//   ② a CHEAP freshness gate (`--check-stale`, wired at @static-tier change) hashes the laydown
//      SOURCE tree and reds when a source file changed but the baseline was NOT re-anchored — at the
//      CHANGER's own scoped gate, not at an unrelated task's full-suite fan-in.
// The full-tier byte ratchet (`--gate`) still measures the REAL laydown and still reds on true bloat
// (negative control: it is NOT relaxed into a constant-true).
//
// THE FINGERPRINT SOURCE SET is the precise set quay-init copies (excluding the generated `.quay/`
// namespace): the DERIVED script set (derive_loop_scripts — the SAME single source the laydown uses,
// resolved plugin/scripts/<name> or the orchestration/*-tick-core.md 正本 a loop pointer names) PLUS the
// wholesale category dirs (workflows/agents/probes/loop) PLUS plugin/.claude/launch.settings.json. It is
// NOT "all of plugin/scripts/" — ~200 harness/checker scripts under plugin/scripts/ are NOT laid down and
// must not force a re-anchor. NOTE the documented boundary: quay-init.sh itself is NEVER_LAYDOWN and is
// excluded (its content is never copied; a copy-LOGIC change that grows the footprint is still caught by
// the full-tier byte ratchet at fan-in).
//
// NOT-EVALUATED (exit 3, hard rule 3b): when the real laydown cannot run, OR the committed baseline is
// missing, OR the derived laydown set cannot be computed, the checker reports NOT-EVALUATED
// (evaluated:false) — a checker that could not read its input must never look like "合格" (exit 0).
// run_checker treats exit 3 as a third state, distinct from PASS (0) and FAIL (1).
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
import { isDirectEntry, helpExit, emitPass, emitFail, emitNotEvaluated } from "./gate-script-base.ts";
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

// The wholesale category dirs quay-init lays down (every regular file under them is copied), plus the
// single-file launch template. The DERIVED script set (plugin/scripts/*) is NOT wholesale — it is the
// derive_loop_scripts output (see collectSourceEntries), because ~200 harness/checker scripts under
// plugin/scripts/ are NOT laid down and must not be fingerprinted.
const WHOLESALE_DIRS: readonly string[] = [
  "plugin/workflows",
  "plugin/agents",
  "plugin/probes",
  "plugin/loop",
];
const EXTRA_FILES: readonly string[] = ["plugin/.claude/launch.settings.json"];

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
  const quayInit = path.join(root, "plugin", "scripts", "quay-init.sh");
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
 * Derive the laydown SCRIPT+loop set (one basename per line) via quay-init.sh's derive_loop_scripts —
 * the SAME single source the --loop laydown uses (never a hand-rolled grep). Returns null when the
 * derivation cannot run (NOT-EVALUATED — a checker that cannot read its input is never "in sync").
 */
export function deriveLaydownNames(root: string): string[] | null {
  const pluginRoot = path.join(root, "plugin");
  const script = [
    `export CLAUDE_PLUGIN_ROOT='${pluginRoot}'`,
    `set --`,
    `. '${path.join(pluginRoot, "scripts", "quay-init.sh")}'`,
    `PLUGIN_ROOT='${pluginRoot}'`,
    `derive_loop_scripts`,
  ].join("\n");
  try {
    const out = execFileSync("bash", ["-c", script], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
    });
    const names = out.split("\n").map((s) => s.trim()).filter(Boolean);
    return names.length > 0 ? names : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a derived basename to its laydown SOURCE file, mirroring the laydown's own resolution:
 * plugin/scripts/<name> when it exists; else the loop pointer's orchestration/*-tick-core.md 正本
 * (resolve_tick_core_src) when plugin/loop/<name> is a pointer; else the loop file itself (verbatim
 * laydown). Returns null when the name resolves to nothing on disk.
 */
export function resolveDerivedSource(root: string, name: string): string | null {
  const inScripts = path.join(root, "plugin", "scripts", name);
  if (fs.existsSync(inScripts)) return inScripts;
  const inLoop = path.join(root, "plugin", "loop", name);
  if (fs.existsSync(inLoop)) {
    const shipped = fs.readFileSync(inLoop, "utf8");
    const m = shipped.match(/^> 正本: ([a-zA-Z0-9._/-]+)/);
    if (m) {
      const cand = path.join(root, m[1]);
      if (fs.existsSync(cand)) return cand;
    }
    return inLoop;
  }
  return null;
}

/** Recursively list regular files under `dir` (absolute paths, symlinks not followed). */
export function walkFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    let items: fs.Dirent[];
    try {
      items = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of items) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/**
 * Collect the precise laydown SOURCE set (repo-relative path + content sha256, sorted by rel).
 * Returns null when the derived set cannot be computed (NOT-EVALUATED).
 */
export function collectSourceEntries(root: string): SourceEntry[] | null {
  const names = deriveLaydownNames(root);
  if (names === null) return null;
  const entries: SourceEntry[] = [];
  const seen = new Set<string>();
  const add = (abs: string): void => {
    let st: fs.Stats;
    try {
      st = fs.statSync(abs);
    } catch {
      return;
    }
    if (!st.isFile()) return;
    const rel = path.relative(root, abs).split(path.sep).join("/");
    if (seen.has(rel)) return;
    seen.add(rel);
    entries.push({ rel, sha: sha256Hex(fs.readFileSync(abs)) });
  };
  for (const name of names) {
    const src = resolveDerivedSource(root, name);
    if (src) add(src);
  }
  for (const dir of WHOLESALE_DIRS) {
    for (const f of walkFiles(path.join(root, dir))) add(f);
  }
  for (const f of EXTRA_FILES) add(path.join(root, f));
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

function getArgValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx === -1 ? undefined : args[idx + 1];
}

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
  const root = path.resolve(getArgValue(args, "--root") ?? repoRoot());
  const asJson = args.includes("--json");
  const gate = args.includes("--gate");
  const reanchor = args.includes("--reanchor");
  const checkStale = args.includes("--check-stale");

  const baselineFilesArg = getArgValue(args, "--baseline-files");
  const baselineBytesArg = getArgValue(args, "--baseline-bytes");
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
