// quay-init-closure-assertion.ts — the closed-set MEMBERSHIP assertion (SPEC §6 / AC168;
// gap-quay-init-closure-shrink-body AC2). A NEW criterion, distinct from the quay-init-closure-ratchet
// (which only counts files/bytes — it does NOT judge membership).
//
// WHAT IT CHECKS: run ONE REAL `quay-init --all --loop --manager` laydown (not a fixture — hard rule 4
// 推论三: the production carrier) into a fresh temp target, enumerate every laid-down relative path, and
// assert:
//   (a) every path ∈ the SIX-item closed set (∪ descendants of `tasks/`), and
//   (b) the laydown contains ZERO `.claude/skills` / `.claude/workflows` / `.claude/agents` /
//       `plugin/scripts` copies (the retired extension-file copy surface).
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

// The SIX-item closed set (SPEC §6 QUAY-INIT-CLOSED-SET). Files are exact-match members; the `tasks/`
// directory admits its descendants.
export const CLOSED_SET_FILES: ReadonlySet<string> = new Set([
  ".quay/config.yml",
  ".quay/profiles.yml",
  ".gitignore",
  ".claude/launch.settings.json",
  ".claude/settings.json",
]);
export const CLOSED_SET_DIRS: readonly string[] = ["tasks"];

// The retired extension-file copy surface — ANY of these in the laydown is a violation (裁定 6: 不复制
// 任何 Claude Code 扩展或脚本).
export const FORBIDDEN_PREFIXES: readonly string[] = [
  ".claude/skills/",
  ".claude/workflows/",
  ".claude/agents/",
  "plugin/scripts/",
];

/** A path (repo-relative, forward slashes) is a closed-set member iff it is one of the five files OR a
 *  descendant of `tasks/`. */
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
  /** paths laid down but outside the closed set (∪ tasks/ descendants). */
  outsideClosedSet: string[];
  /** paths under a forbidden prefix (.claude/skills|workflows|agents, plugin/scripts). */
  forbiddenCopies: string[];
}

export function assertClosure(relPaths: string[]): ClosureAssertionVerdict {
  const outsideClosedSet: string[] = [];
  const forbiddenCopies: string[] = [];
  for (const rel of relPaths) {
    if (!isInClosedSet(rel)) outsideClosedSet.push(rel);
    for (const p of FORBIDDEN_PREFIXES) {
      if (rel === p.slice(0, -1) || rel.startsWith(p)) {
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
  const quayInit = path.join(root, "plugin", "scripts", "quay-init.sh");
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

const usage = `quay-init-closure-assertion.ts — closed-set membership assertion over a REAL quay-init laydown (SPEC §6 / AC168)

Usage:
  node --experimental-strip-types quay-init-closure-assertion.ts --gate [--root <dir>] [--json]
      gate mode — exit 1 iff a laid-down path is outside the closed set (∪ tasks/ descendants) or a
      forbidden extension-file copy is present; exit 3 (NOT-EVALUATED) iff the laydown could not run.`;

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
  if (verdict.ok) {
    return emitPass(
      `quay-init laydown is within the closed set: ${rels.length} file(s), all ∈ closed set ∪ tasks/ descendants, zero extension-file copies`,
      { evaluated: true, files: rels.length, ...verdict },
      { json: asJson },
    );
  }
  for (const rel of verdict.outsideClosedSet) {
    process.stdout.write(`  outside-closed-set: ${rel}\n`);
  }
  for (const rel of verdict.forbiddenCopies) {
    process.stdout.write(`  forbidden-copy: ${rel}\n`);
  }
  return emitFail(
    `quay-init laydown VIOLATES the closed set: ${verdict.outsideClosedSet.length} path(s) outside the closed set, ${verdict.forbiddenCopies.length} forbidden extension-file copy(s)`,
    { evaluated: true, files: rels.length, ...verdict },
    { json: asJson },
  );
}

if (isDirectEntry(import.meta, undefined, "quay-init-closure-assertion")) {
  process.exitCode = main(process.argv);
}
