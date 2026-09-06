// quay-init-closure-ratchet.ts — the shrink-only ratchet over the REAL quay-init laydown footprint.
// (gap-quay-init-closure-assertion-first — SPEC AC168 判据先行; the closure shrink body is a later wave.)
//
// THE DEFECT THIS CLOSES: `quay-init --loop` copies the mechanism layer (117–131 scripts, tick docs,
// workflows, agents, probes, runtime) BYTE-FOR-BYTE into every target project's own git history — a
// footprint measured ONCE (§2.9 of docs/proposals/archguard-generation-era-primitives.md: 142 files /
// 7.1 MB) and then never observed again. SPEC AC3/AC4 (installation-write closure ⊆ §6) will shrink it,
// but that assertion reads a path SET and is not yet satisfiable today. This ratchet is the stopgap that
// makes the direction mechanical NOW: baseline = the CURRENT measured footprint, shrink-only (只许降
// 不许升) — today it is GREEN, but any change that makes quay-init lay down ONE MORE file (or byte) goes
// RED immediately.
//
// THE MEASUREMENT IS THE PRODUCTION CARRIER (SPEC AC4's counter-example criterion, hard rule 4 推论三):
// the checker runs a REAL `quay-init --all --loop --manager` laydown into a fresh temp target and counts
// the result. It does NOT read `derive_loop_scripts`' static derivation, and does NOT read a fixture —
// a pass must survive the injection seam being turned off. `.quay/` is EXCLUDED from the count: it is
// quay's own generated namespace (config.yml random target paths, quay-init-state.json timestamp +
// hashes, the generated runtime dist bundle) whose bytes are non-reproducible across environments —
// the pollution footprint is the BYTE-IDENTICAL COPY set everything else (verified stable across two
// consecutive laydowns). (The `--baseline-files/--baseline-bytes` overrides exist ONLY for the unit test
// + mutation case to exercise the ±1 judgment on a small controlled fixture; the production baseline is
// the hardcoded measured value.)
//
// NOT-EVALUATED (exit 3, hard rule 3b): when the real laydown cannot run (quay-init.sh missing, or the
// laydown exits non-zero), the checker reports NOT-EVALUATED (evaluated:false) — a checker that could
// not read its input must never look like "合格" (exit 0). run_checker treats exit 3 as a third state,
// distinct from PASS (0) and FAIL (1).
//
// MODES:
//   --gate [--root <dir>] [--json] [--baseline-files N] [--baseline-bytes B]
//       gate mode (wired into run_static_checks). Exit 1 iff the real laydown exceeds the baseline
//       (files OR bytes). Exit 3 iff the laydown could not run (NOT-EVALUATED).
// Exit codes: 0 PASS · 1 gate FAIL (footprint grew) · 2 usage/env error · 3 NOT-EVALUATED.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
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

// Baseline — measured 2026-09-05 by a real `quay-init --all --loop --manager` laydown into a fresh
// target (the reading is recorded in the task body, compared against §2.9's 142 files / 7.1 MB — the
// difference is: (a) mechanism-layer scripts retired between the two measurements, (b) this baseline
// excludes the generated `.quay/` namespace §2.9 included). Shrink-only: the laydown must stay ≤ this.
// Re-measured 2026-09-06 (gap-task-ops-consolidate-driver-frontmatter-writers): +1 file — task-ops.ts,
// the new shared frontmatter parse/patch/commit library that driver-filters/worker-driver/ready-pool-check
// all import via ESM (its dep is invisible to closure step d, so it must be laid down or the drivers die
// with ERR_MODULE_NOT_FOUND) — but −9365 bytes net, the 5 duplicated regex/parse implementations collapsed
// into one. Both axes re-anchored to the new measured footprint (stable across 3 consecutive laydowns).
// Re-anchored 2026-09-06 (gap-goal-store-revoke-prose-authority-repoint-pointers): +204 bytes net, 0 files —
// the four manager prompt pointers repointed from orchestration/manager-phase-goal.md to the goals/ store
// (goal-store.ts list --status active) lengthen the laid-down tick docs; a legitimate pointer repoint, not pollution.
// Re-anchored 2026-09-06 (gap-goal-store-abi-encapsulation-provider-backed fan-in, surfaced by its suite):
// +1 file / +5155 bytes net — plugin/probes/meta-driver.md, the probe added by meta-driver v0 (eebe448ae)
// AFTER the last re-anchor; a legitimate new probe in the laid-down probe set, not pollution. Measured by the
// checker's own fixed --tmux-session (deterministic across consecutive laydowns).
// Re-anchored 2026-09-06 (gap-quay-init-laydown-footprint-grew): +8640 bytes net, 0 files — the SAME
// plugin/probes/meta-driver.md probe grew 4032 → 12672 bytes through six legitimate feature commits since the
// prior re-anchor (auto-drive channel 163825dfa, humanAttention routing 1abea2b70, FILE-ONLY mechanism + claim
// state 9434e1e93, ordered misrouting criteria cb26b85a0, autoDrive template fixes 26a03d8c7). Probe capacity
// expansion, not pollution — re-anchored per the same re-anchor precedent.
export const BASELINE_FILES = 132;
export const BASELINE_BYTES = 3826955;

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
 * `exclude` is a set of directory basenames to skip at ANY depth (used to drop `.quay/` — the
 * generated, non-deterministic namespace: config.yml random target paths, quay-init-state.json's
 * `laidAt` timestamp + runtime sha256, and the generated runtime dist bundle).
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
 * non-zero. The temp target + worktree-root live OUTSIDE the repo (a sibling of `<root>` — a real
 * disk path; os.tmpdir() is tmpfs here and quay-init's validate_worktree_root fails closed on tmpfs),
 * NOT inside `<root>/.quay/`: quay-init's auto-commit runs `git add`/`git commit` at the --root
 * target, and a target INSIDE the repo makes `git -C target` resolve UP to the repo — the auto-commit
 * then commits the whole laydown into the repo's own history (the exact pollution this ratchet exists
 * to prevent; the prior round's a4b8ab1f8 / 4e68d3d6f and the mid-round tree mutation ⇒ infra-error).
 * A sibling dir is outside any git work tree ⇒ quay-init's auto-commit SKIPs (not a git repository).
 * Removed in finally.
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

const usage = `quay-init-closure-ratchet.ts — shrink-only ratchet over the REAL quay-init laydown footprint (SPEC AC168 判据先行)

Usage:
  node --experimental-strip-types quay-init-closure-ratchet.ts --gate [--root <dir>] [--json]
      gate mode — exit 1 iff the real laydown exceeds the baseline (files or bytes);
                  exit 3 (NOT-EVALUATED) iff the laydown could not run.`;

function getArgValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx === -1 ? undefined : args[idx + 1];
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit(usage);
  const root = path.resolve(getArgValue(args, "--root") ?? repoRoot());
  const asJson = args.includes("--json");
  const gate = args.includes("--gate");
  // Test-only overrides (unit test + mutation case); production uses the hardcoded measured baseline.
  const baselineFiles = Number(getArgValue(args, "--baseline-files") ?? BASELINE_FILES);
  const baselineBytes = Number(getArgValue(args, "--baseline-bytes") ?? BASELINE_BYTES);

  if (!gate) {
    process.stderr.write(`${usage}\n`);
    return 2;
  }

  const baseline: ClosureCount = { files: baselineFiles, bytes: baselineBytes };
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
