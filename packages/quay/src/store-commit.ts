// quay Core: store-commit — the SINGLE commit-after-write primitive for all five store kinds
// (SPEC-store-commit-unification-2026-09-08 §3; GOAL-008 AC-195..199). tasks (quay-native's
// store.ts), goals (goal-store.ts), meta (meta-store.ts), adr (adr-store.ts), and docs-managed
// (document-store.ts) ALL funnel their "write the file, then make it visible in git" step through
// `commitStoreWrite` here. There is no per-kind git plumbing left — the store files declare their
// kind's default (relPath prefix, message prefix, `propagate`) and this primitive does the git work.
//
// WHY ONE PRIMITIVE (the SPEC's four non-negotiables):
//   1. root comes from `git rev-parse --show-toplevel`, ⛔ never `path.dirname(<kind>Dir)` — the
//      latter assumes the kind's dir sits directly under the repo root (hard rule 4 corollary 2:
//      a literal that happens to match the current layout is not robust; rev-parse is correct in
//      a worktree, a nested workspace, or a re-arranged layout).
//   2. pathspec-limited `git add` + `git commit --no-verify` BACK-TO-BACK (hard rule 11: the index
//      is SHARED across layers — never a bare `git commit`, which would sweep whatever another
//      layer staged). `--no-verify`: a mechanical ABI write is content-neutral.
//   3. FOUR-STATE return (committed | unchanged | not-in-git | failed), ⛔ never a boolean — a
//      boolean makes "not in git", "content unchanged so skipped", and "commit really failed" all
//      read as the same `false` (hard rule 3b: a verdict whose word-list has no "not evaluated"
//      state cannot tell "checked and clean" from "never checked").
//   4. `unchanged` restores the file to HEAD, ⛔ never leaves the shared checkout dirty — a dirty
//      `goals/*.md` blocks develop→doc ff-only (the exact bug gap-meta-commitgoalfile fixed).
//
// `propagate` is declared by each kind's store (SPEC §4 declaration table), not guessed here: a
// write's propagation strategy is decided by WHO READS the field (SPEC §2.2), and the store knows
// its readers. The default is "none" (commit to the current branch only) — callers that need
// develop visibility pass "develop" explicitly.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export type CommitOutcome = "committed" | "unchanged" | "not-in-git" | "failed";

/**
 * Structured parts of a store-commit subject — the SINGLE message constructor
 * (gap-store-commit-action-and-actor AC4): the five store files pass STRUCTURED fields and this
 * ONE renderer turns them into `kind: id action [by actor]`. ⛔ A store file must never
 * hand-assemble the message string itself — that is exactly the "fixed prose, no action, no
 * writer" defect this type removes.
 */
export interface StoreCommitMessageParts {
  /** store kind prefix, e.g. "goals" | "docs-managed" | "adr" | "meta" | "tasks". */
  kind: string;
  /** record id, e.g. "GOAL-001" | "AC-180" | "DOC-1" | "ADR-12" | "META-1" | "gap-…". */
  id: string;
  /** the action: "create" | `field:<name>` | `status <from>→<to>` | a kind-specific verb
   *  ("task_write" | "task_delete"). The store decides WHAT happened; this renderer decides the
   *  subject SHAPE. */
  action: string;
  /** the writer: "cli:<session|pid>" | "driver:<run-id>". Omitted ⇒ no `by` suffix. */
  actor?: string;
}

/** Render a store-commit subject from structured parts. Pure — the single place the
 *  `kind: id action [by actor]` grammar lives. */
export function storeCommitMessage(parts: StoreCommitMessageParts): string {
  const actor = parts.actor !== undefined && parts.actor.trim() !== "" ? ` by ${parts.actor.trim()}` : "";
  return `${parts.kind}: ${parts.id} ${parts.action}${actor}`;
}

/**
 * Resolve the commit writer (gap-store-commit-action-and-actor AC2). Explicit `actor` wins; else
 * the env seam `QUAY_STORE_COMMIT_ACTOR` (a driver that knows its run-id sets
 * `driver:<run-id>` when spawning the store); else `cli:<pid>` (a direct CLI write). ⛔ never
 * empty — every store-commit subject must carry `by cli:` or `by driver:` so a goals/ history is
 * auditable (the 4007-identical-commits defect).
 */
export function resolveCommitActor(actor?: string): string {
  if (actor !== undefined && actor.trim() !== "") return actor.trim();
  const env = process.env.QUAY_STORE_COMMIT_ACTOR;
  if (env !== undefined && env.trim() !== "") return env.trim();
  return `cli:${process.pid}`;
}

export interface CommitStoreWriteOptions {
  /** repo-relative path of the written file, e.g. "tasks/x.md" | "goals/AC-1.md" | "meta/META-1.md"
   *  | "adr/ADR-1.md" | "docs-managed/D-1.md". */
  relPath: string;
  /** structured commit-subject parts — see `storeCommitMessage`. */
  kind: string;
  id: string;
  action: string;
  actor?: string;
  /** git root to commit in. Default: `git rev-parse --show-toplevel` from the process cwd — the
   *  robust root (⛔ not path.dirname). Callers that know their dir pass `resolveGitRoot(dir)` so
   *  the root is correct even when the process cwd is a different checkout (SPEC §6). */
  root?: string | null;
  /** "none" = commit to the current branch only (default); "develop" = ff-push the current branch
   *  to develop after committing. Declared per kind by the store (SPEC §4). */
  propagate?: "none" | "develop";
  /** "is this write non-substantive?" — default byte-identical. The goal store's legacy
   *  `stripEvidenceTimestamp` comparator is NOT wired in here (retired per SPEC §4 note). */
  skipIf?: (head: string, work: string) => boolean;
}

export interface CommitStoreBatchOptions {
  /** repo-relative paths of the written files, staged and committed in ONE commit. */
  relPaths: string[];
  /** structured commit-subject parts — see `storeCommitMessage`. */
  kind: string;
  id: string;
  action: string;
  actor?: string;
  root?: string | null;
  propagate?: "none" | "develop";
}

export interface CommitStoreWriteResult {
  outcome: CommitOutcome;
  /** whether the write reached develop (only meaningful when outcome === "committed"). */
  propagated: boolean;
}

/** Run git with `-C root`, return stdout (trimmed by default) or null on error. Content reads pass
 *  `trim = false` so file bytes are returned verbatim (a file's leading/trailing whitespace is
 *  content, not noise). */
function gitOut(root: string, args: string[], trim = true): string | null {
  try {
    const out = execFileSync("git", ["-C", root, ...args], {
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();
    return trim ? out.trim() : out;
  } catch {
    return null;
  }
}

/** Run git with `-C root`, return whether it exited 0 (stdout/stderr discarded). */
function gitOk(root: string, args: string[]): boolean {
  try {
    execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** The git root containing `dir`, via `git rev-parse --show-toplevel` (⛔ NOT path.dirname — hard
 *  rule 4 corollary 2). Null when `dir` is not inside a git work tree. */
export function resolveGitRoot(dir: string): string | null {
  try {
    const out = execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], {
      stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
    return out || null;
  } catch {
    return null;
  }
}

const byteIdentical = (head: string, work: string) => head === work;

export function commitStoreWrite(opts: CommitStoreWriteOptions): CommitStoreWriteResult {
  const { relPath, kind, id, action, actor, propagate = "none", skipIf } = opts;
  const root = opts.root === undefined ? resolveGitRoot(process.cwd()) : opts.root;
  if (!root) return { outcome: "not-in-git", propagated: false };
  if (gitOut(root, ["rev-parse", "--is-inside-work-tree"]) !== "true") {
    return { outcome: "not-in-git", propagated: false };
  }

  const abs = path.join(root, relPath);
  const head = gitOut(root, ["show", `HEAD:${relPath}`], false);
  const workExists = fs.existsSync(abs);

  // Unchanged check: HEAD's content vs the just-written working-tree content. Only when the file
  // exists on disk AND in HEAD (a new file is never "unchanged" — there is nothing to restore).
  if (head !== null && workExists) {
    const work = fs.readFileSync(abs, "utf8");
    const unchanged = skipIf ? skipIf(head, work) : byteIdentical(head, work);
    if (unchanged) {
      // Restore BOTH index and worktree to HEAD (⛔ never leave the shared checkout dirty — a dirty
      // file blocks develop→doc ff-only, gap-meta-commitgoalfile). Pathspec-limited to this file.
      gitOk(root, ["checkout", "HEAD", "--", relPath]);
      return { outcome: "unchanged", propagated: false };
    }
  }

  // add + commit back-to-back (hard rule 11), pathspec-limited (never -A), --no-verify.
  const message = storeCommitMessage({ kind, id, action, actor: resolveCommitActor(actor) });
  if (!gitOk(root, ["add", "--", relPath])) return { outcome: "failed", propagated: false };
  if (!gitOk(root, ["commit", "--no-verify", "-m", message, "--", relPath])) {
    return { outcome: "failed", propagated: false };
  }

  let propagated = false;
  if (propagate === "develop") {
    const branch = gitOut(root, ["branch", "--show-current"]);
    if (branch) propagated = gitOk(root, ["push", ".", `${branch}:develop`]);
  }
  return { outcome: "committed", propagated };
}

/**
 * COMMIT-AFTER-BATCH (gap-store-commit-action-and-actor AC3): stage MANY written files and commit
 * them in ONE commit — the `--batch` primitive. One logical action that writes N records must not
 * produce N commits (the 16-commits-per-logical-action defect). `relPaths` are staged together
 * (hard rule 11: pathspec-limited, never -A) and committed back-to-back with one subject.
 */
export function commitStoreBatch(opts: CommitStoreBatchOptions): CommitOutcome {
  const { relPaths, kind, id, action, actor, propagate = "none" } = opts;
  const root = opts.root === undefined ? resolveGitRoot(process.cwd()) : opts.root;
  if (!root) return "not-in-git";
  if (gitOut(root, ["rev-parse", "--is-inside-work-tree"]) !== "true") return "not-in-git";
  if (relPaths.length === 0) return "unchanged";

  if (!gitOk(root, ["add", "--", ...relPaths])) return "failed";
  // Nothing staged (every file byte-identical to HEAD) ⇒ no commit — an honest "unchanged", not a
  // "committed" echo (硬规则 3b).
  const staged = gitOut(root, ["diff", "--cached", "--name-only"]);
  if (staged === null || staged === "") return "unchanged";

  const message = storeCommitMessage({ kind, id, action, actor: resolveCommitActor(actor) });
  if (!gitOk(root, ["commit", "--no-verify", "-m", message, "--", ...relPaths])) return "failed";

  if (propagate === "develop") {
    const branch = gitOut(root, ["branch", "--show-current"]);
    if (branch) gitOk(root, ["push", ".", `${branch}:develop`]);
  }
  return "committed";
}
