// quay-init-closure-assertion.ts — the closed-set MEMBERSHIP assertion (SPEC §6 / AC168;
// gap-quay-init-closure-shrink-body AC2). A NEW criterion, distinct from the quay-init-closure-ratchet
// (which only counts files/bytes — it does NOT judge membership).
//
// WHAT IT CHECKS: run ONE REAL `quay-init --all --loop --manager` laydown (not a fixture — hard rule 4
// 推论三: the production carrier) into a fresh temp target, enumerate every laid-down relative path, and
// assert:
//   (a) every path ∈ the SEVEN-item closed set (∪ descendants of `tasks/` and `goals/`), and
//   (b) the laydown contains ZERO forbidden-copy surface: `.claude/skills` / `.claude/workflows` /
//       `.claude/agents` / `.claude/commands` / `.claude/hooks` / `plugin/scripts` copies, and no
//       `.mcp.json` (the retired extension-file copy surface — quay-init writes ENABLE only, never the
//       Claude Code extension implementations it points at).
// `.quay/` is NOT excluded here (unlike the ratchet) — `.quay/config.yml` + `.quay/profiles.yml` are
// closed-set MEMBERS, so they must be asserted AS members, not skipped.
//
// NOT-EVALUATED (exit 3, hard rule 3b): when the real laydown cannot run, the checker reports
// NOT-EVALUATED (evaluated:false) — a checker that could not read its input must never look like "合格".
//
// MODE: --gate [--root <dir>] [--json]
// Exit codes: 0 PASS · 1 gate FAIL (a laid-down path is outside the closed set / a forbidden copy) ·
//             2 usage/env error · 3 NOT-EVALUATED.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { isDirectEntry, helpExit, emitPass, emitFail, emitNotEvaluated } from "./gate-script-base.ts";
import { repoRoot } from "./repo-root.ts";

// The generator's repo-root-relative path — THE mechanism-layer naming point for this entity
// (gap-quay-init-sh-no-single-naming-point). Both spawn sites below used to spell
// `path.join(root, "plugin", "scripts", "quay-init.sh")` independently, i.e. this file carried two
// more naming points of the same name the ratchet carried two of (硬规则 5b: the fix is the shared
// source, not a second correct-looking copy — a copy that agrees TODAY drifts later, and one side
// would silently keep spawning the old name).
//
// ⛔ WHY IT LIVES HERE (in the assertion) AND NOT IN `quay-init-closure-ratchet.ts` (where the
// naming-point fix started): THIS module is one of the files `develop-deliver-tgz.sh` ships to the
// remote host (`transport_flat_files`), and that enumeration is checked MECHANICALLY — a shipped file
// must be self-sufficient flat, so its every `./` import must itself be in the shipped set
// (`--selfcheck-transport-closure`, and the 2026-09-11 production defect it exists to catch: a
// dependency gained here but not added there dies MODULE_NOT_FOUND on the remote, where nothing local
// sees it). The SIBLING is NOT shipped (dev-tree only: `precommit-guard.ts` / `runner-static-gate.ts`
// are its callers), so a shipped→non-shipped import is a closure violation, while the reverse
// direction is invisible to the check and true in fact. The constant's home is therefore the
// TRANSPORTABLE side of the pair — the direction that keeps the closure intact — and the sibling
// imports it for `LAYDOWN_SOURCES[0]` + its own spawn site.
export const QUAY_INIT_REL = "plugin/scripts/quay-init.sh";

// The SEVEN-item closed set (SPEC §6 QUAY-INIT-CLOSED-SET). Files are exact-match members; the `tasks/`
// and `goals/` directories admit their descendants.
export const CLOSED_SET_FILES: ReadonlySet<string> = new Set([
  ".quay/config.yml",
  ".quay/profiles.yml",
  ".gitignore",
  ".claude/launch.settings.json",
  ".claude/settings.json",
]);
export const CLOSED_SET_DIRS: readonly string[] = ["tasks", "goals"];

// The forbidden copy surface — ANY of these in the laydown is a violation (裁定 6: 不复制任何 Claude
// Code 扩展或脚本). Directory entries carry a trailing "/" (prefix match: the dir itself + descendants);
// `.mcp.json` is a FILE (exact match, no trailing slash) — a prefix slice would truncate it to `.mcp.jso`.
export const FORBIDDEN_PREFIXES: readonly string[] = [
  ".claude/skills/",
  ".claude/workflows/",
  ".claude/agents/",
  ".claude/commands/",
  ".claude/hooks/",
  "plugin/scripts/",
  ".mcp.json",
];

/** A path (repo-relative, forward slashes) is a closed-set member iff it is one of the five files OR a
 *  descendant of `tasks/` or `goals/`. */
export function isInClosedSet(rel: string): boolean {
  if (CLOSED_SET_FILES.has(rel)) return true;
  const norm = rel.split(path.sep).join("/");
  for (const dir of CLOSED_SET_DIRS) {
    if (norm === dir || norm.startsWith(dir + "/")) return true;
  }
  return false;
}

export interface ClosureAssertionVerdict {
  ok: boolean;
  /** paths laid down but outside the closed set (∪ tasks/ and goals/ descendants). */
  outsideClosedSet: string[];
  /** paths under a forbidden prefix (.claude/skills|workflows|agents|commands|hooks, plugin/scripts, or the `.mcp.json` file). */
  forbiddenCopies: string[];
}

export function assertClosure(relPaths: string[]): ClosureAssertionVerdict {
  const outsideClosedSet: string[] = [];
  const forbiddenCopies: string[] = [];
  for (const rel of relPaths) {
    if (!isInClosedSet(rel)) outsideClosedSet.push(rel);
    for (const p of FORBIDDEN_PREFIXES) {
      // Directory prefixes (trailing "/") admit the dir itself (`p.slice(0,-1)`) and its descendants
      // (`startsWith(p)`); a file prefix (no trailing slash, e.g. `.mcp.json`) is exact-match only —
      // otherwise `.mcp.json` slices to `.mcp.jso` and the file/目录 two-state match breaks (AC-204).
      const hit = p.endsWith("/") ? rel === p.slice(0, -1) || rel.startsWith(p) : rel === p;
      if (hit) {
        forbiddenCopies.push(rel);
        break;
      }
    }
  }
  return { ok: outsideClosedSet.length === 0 && forbiddenCopies.length === 0, outsideClosedSet, forbiddenCopies };
}

/**
 * Run ONE real `quay-init --all --loop --manager` laydown into a fresh temp target (a sibling of
 * `<root>`, never inside it) and return the list of laid-down file paths relative to the target root.
 * Returns null (NOT-EVALUATED) when quay-init.sh is absent or the laydown exits non-zero.
 */
export function runLaydownPaths(root: string): string[] | null {
  const quayInit = path.join(root, QUAY_INIT_REL);  // kernel-sibling-dev-tree-only: dev-tree-only — repo-local plugin/scripts use, not third-party sibling resolution.
  if (!fs.existsSync(quayInit)) return null;
  const tmpBase = fs.mkdtempSync(path.join(path.dirname(root), "quay-init-assertion-"));
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
        "--tmux-session", "quay-init-closure-assertion-probe",
        "--worktree-root", worktreeRoot,
        "--plugin-root", path.join(root, "plugin"),
      ],
      { timeout: 180_000, stdio: ["ignore", "ignore", "pipe"] },
    );
    const rels: string[] = [];
    const walk = (d: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.isFile()) rels.push(path.relative(target, p).split(path.sep).join("/"));
      }
    };
    walk(target);
    rels.sort();
    return rels;
  } catch {
    return null;
  } finally {
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
}

/** The SEVEN-item closed set (SPEC §6 QUAY-INIT-CLOSED-SET), `tasks/` and `goals/` directory members
 *  included — the exact paths whose per-item state a failing quay-init must mechanically
 *  report (AC3). */
export const CLOSED_SET_ALL: readonly string[] = [
  ".quay/config.yml",
  ".quay/profiles.yml",
  "tasks",
  "goals",
  ".gitignore",
  ".claude/launch.settings.json",
  ".claude/settings.json",
];

/** The four states a failing quay-init's closed-set report can carry (gap-quay-init-failure-report-
 *  existence-proxy-overreports-on-upgrade). `pre-existing` is the state that existence alone cannot
 *  express: the item was already there before the run and the run left it byte-unchanged — the
 *  distinction an UPGRADE target needs, and the one whose absence made a no-op failure look like a
 *  partial takeover. `unreadable` keeps "could not look" out of `unwritten` (hard rule 3b). */
export type ClosedSetItemState = "written" | "pre-existing" | "unwritten" | "unreadable";

export const CLOSED_SET_ITEM_STATES: readonly ClosedSetItemState[] = [
  "written",
  "pre-existing",
  "unwritten",
  "unreadable",
];

export interface FailureStateReport {
  /** exit code of the failed run (must be non-zero — a success is NOT-EVALUATED, never a pass). */
  exitCode: number;
  /** items reported as `written:` — this run created them or changed their content. */
  written: string[];
  /** items reported as `pre-existing:` — already there before this run, left byte-unchanged. */
  preExisting: string[];
  /** items reported as `unwritten:` — not there now. */
  unwritten: string[];
  /** items reported as `unreadable:` — present but their content could not be read. */
  unreadable: string[];
  /** raw stdout+stderr of the failed run (diagnostics). */
  output: string;
}

/** every closed-set item the report accounted for, across ALL recognized states. A parser that knows
 *  only a subset of the vocabulary silently drops the rest, so consumers must union the whole set. */
export function reportedItems(report: FailureStateReport): string[] {
  return [...report.written, ...report.preExisting, ...report.unwritten, ...report.unreadable];
}

/**
 * Run ONE real FAILING quay-init (a bare target with no detectable test command, so the run
 * fail-closes BEFORE any write) and parse the AC3 closed-set state report (one `written:` /
 * `pre-existing:` / `unwritten:` / `unreadable:`
 * lines a non-zero exit must emit). Returns null when quay-init.sh is absent (the same NOT-EVALUATED
 * condition as runLaydownPaths) or when the run unexpectedly exits 0 (a checker that expected a
 * failure but saw none must not look like "覆盖了失败路径").
 */
export function runFailureStateReport(root: string): FailureStateReport | null {
  const quayInit = path.join(root, QUAY_INIT_REL);  // kernel-sibling-dev-tree-only: dev-tree-only — repo-local plugin/scripts use, not third-party sibling resolution.
  if (!fs.existsSync(quayInit)) return null;
  const tmpBase = fs.mkdtempSync(path.join(path.dirname(root), "quay-init-fail-"));
  const target = path.join(tmpBase, "target");
  fs.mkdirSync(target);
  try {
    let stdout = "";
    let stderr = "";
    let exitCode = 0;
    try {
      execFileSync(
        "bash",
        [quayInit, "--root", target, "--repo-root", target, "--plugin-root", path.join(root, "plugin")],
        { timeout: 180_000, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
      );
    } catch (e: unknown) {
      const err = e as { stdout?: unknown; stderr?: unknown; status?: unknown };
      stdout = typeof err.stdout === "string" ? err.stdout : "";
      stderr = typeof err.stderr === "string" ? err.stderr : "";
      exitCode = typeof err.status === "number" ? err.status : 1;
    }
    if (exitCode === 0) return null; // expected a failure; a success is NOT-EVALUATED (unreadable input)
    const output = stdout + "\n" + stderr;
    const written: string[] = [];
    const preExisting: string[] = [];
    const unwritten: string[] = [];
    const unreadable: string[] = [];
    // Every state the reporter emits must be listed in the alternation, longest-first (a state the
    // parser cannot name would drop its item out of every bucket — hard rule 3b: a parser that cannot
    // read a value must not silently look like it accounted for it).
    for (const line of output.split("\n")) {
      const m = line.match(/^\s*(pre-existing|unwritten|unreadable|written):\s*(.+?)\s*$/);
      if (!m) continue;
      const item = m[2].trim();
      if (m[1] === "written") written.push(item);
      else if (m[1] === "pre-existing") preExisting.push(item);
      else if (m[1] === "unwritten") unwritten.push(item);
      else unreadable.push(item);
    }
    return { exitCode, written, preExisting, unwritten, unreadable, output };
  } finally {
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
}

const usage = `quay-init-closure-assertion.ts — closed-set membership assertion over a REAL quay-init laydown (SPEC §6 / AC168)

Usage:
  node --experimental-strip-types quay-init-closure-assertion.ts --gate [--root <dir>] [--json]
      gate mode — exit 1 iff a laid-down path is outside the closed set (∪ tasks/ and goals/ descendants), a
      forbidden extension-file copy is present, or the failure path does not report every closed-set
      item; exit 3 (NOT-EVALUATED) iff the laydown could not run.`;

function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit(usage);
  const root = path.resolve(args.includes("--root") ? args[args.indexOf("--root") + 1] : repoRoot());
  const asJson = args.includes("--json");
  if (!args.includes("--gate")) {
    process.stderr.write(`${usage}\n`);
    return 2;
  }

  const rels = runLaydownPaths(root);
  if (rels === null) {
    return emitNotEvaluated(
      "quay-init-closure-assertion: NOT-EVALUATED — the real quay-init laydown could not run (a checker that cannot read its input is never conflated with 'closed set satisfied')",
      { evaluated: false },
      { json: asJson },
    );
  }
  const verdict = assertClosure(rels);

  // AC5 failure path (gap-quay-init-hard-requires-tmux-session-and-leaves-partial-write): the checker
  // must cover the FAILURE path too, not just the happy-path membership. A failing quay-init must
  // mechanically report the seven-item state (AC3) — assert every closed-set item appears in the
  // report, in ANY of the four states (written / pre-existing / unwritten / unreadable), so a report
  // that silently omits an item is a FAIL.
  const failReport = runFailureStateReport(root);
  const failMissing: string[] = [];
  if (failReport === null) {
    failMissing.push("(failure path NOT-EVALUATED: a failing quay-init did not run to a non-zero exit)");
  } else {
    const seen = reportedItems(failReport);
    for (const item of CLOSED_SET_ALL) {
      if (!seen.includes(item)) failMissing.push(item);
    }
  }

  if (verdict.ok && failReport !== null && failMissing.length === 0) {
    return emitPass(
      `quay-init laydown is within the closed set (${rels.length} file(s), zero extension-file copies) and the failure path reports all ${CLOSED_SET_ALL.length} closed-set items`,
      { evaluated: true, files: rels.length, ...verdict, failureExit: failReport.exitCode },
      { json: asJson },
    );
  }
  for (const rel of verdict.outsideClosedSet) {
    process.stdout.write(`  outside-closed-set: ${rel}\n`);
  }
  for (const rel of verdict.forbiddenCopies) {
    process.stdout.write(`  forbidden-copy: ${rel}\n`);
  }
  for (const item of failMissing) {
    process.stdout.write(`  failure-report-missing: ${item}\n`);
  }
  return emitFail(
    `quay-init laydown VIOLATES the closed set (${verdict.outsideClosedSet.length} outside, ${verdict.forbiddenCopies.length} forbidden) or the failure path is uncovered (${failMissing.length} missing report item(s))`,
    { evaluated: true, files: rels.length, ...verdict, failureReportMissing: failMissing },
    { json: asJson },
  );
}

if (isDirectEntry(import.meta, undefined, "quay-init-closure-assertion")) {
  process.exitCode = main(process.argv);
}
