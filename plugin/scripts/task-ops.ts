// plugin/scripts/task-ops.ts — the ONE library owning "parse task frontmatter, mutate a field, commit it"
// for the loop/driver layer (tasks/gap-task-ops-consolidate-driver-frontmatter-writers).
//
// WHY THIS EXISTS：the 2026-09-06 audit found FIVE independent frontmatter parser/writer implementations
// across driver-filters.ts / worker-driver.ts / ready-pool-check.ts — each with its own hand-rolled regex
// parse AND its own `git add`+`git commit` discipline, all drifting independently of task-schema.ts's
// canonical parseFrontmatterCompletely() and of each other. gap-mark-needs-human-commit-after-write had
// to hand-patch ONE of those five call sites for a missing commit-after-write — a defect class that
// recurs once per duplicated implementation. This file removes the duplication so a defect fixed here
// is fixed everywhere.
//
// Surface (the enumerated set, no more no less):
//   (a) parse   — splitTaskFile / statusFromFrontmatter, REUSING task-schema.ts's parseFrontmatterCompletely
//                 (YAML) + frontmatterStatus. There is NO new frontmatter-parsing regex here — the fence
//                 split is structural (locates the block), field VALUES are read by the YAML parser only.
//   (b) patch   — patchStatusField (byte-preserving status-line edit, never a YAML round-trip that would
//                 reformat the rest of the frontmatter) + ensureDeliveryCriticalLabel (label add, moved
//                 verbatim from ready-pool-check.ts).
//   (c) commit  — isInsideGitWorkTree / commitTaskFile / hasPriorCommit (moved verbatim from
//                 driver-filters.ts): scoped `git add <rel> && git commit --no-verify -m <msg> -- <rel>`,
//                 hard rule 11 atomicity (no wait between add and commit, ⛔ never a bare commit).
//
// The three real call sites (driver-filters.ts / worker-driver.ts / ready-pool-check.ts) import this
// surface instead of re-implementing it. This does NOT change WHERE these drivers run (still Node
// processes) or WHAT branch model they use — it only removes the duplication.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseFrontmatterCompletely, frontmatterStatus } from "./task-schema.ts";

// ── parse (delegates to task-schema.ts — no new frontmatter parser) ──────────────────────────────

/** Split a task file's full text into its frontmatter block and body, preserving the exact open/close
 *  `---` fence delimiters so a patched frontmatter can be recombined byte-for-byte. null when there is
 *  no `---` frontmatter fence (write-ownership cannot be guaranteed). */
export function splitTaskFile(fullText: string): { open: string; frontmatterRaw: string; close: string; body: string } | null {
  const m = /^(---\r?\n)([\s\S]*?)(\r?\n---)/.exec(fullText);
  if (!m) return null;
  return { open: m[1], frontmatterRaw: m[2], close: m[3], body: fullText.slice(m[0].length) };
}

/** Read a task frontmatter's `status:` scalar via the SINGLE frontmatter parser (parseFrontmatterCompletely
 *  → frontmatterStatus). null when absent / unreadable / non-string (缺值 = 未查, 硬规则 6 — "no status"
 *  stays distinguishable from any concrete status word). */
export function statusFromFrontmatter(frontmatterRaw: string): string | null {
  return frontmatterStatus(parseFrontmatterCompletely(frontmatterRaw));
}

// ── patch-one-field (byte-preserving text edits — never a YAML round-trip) ────────────────────────

/** Replace the `status:` scalar value in a frontmatter, preserving every other byte. `fromStatus`, when
 *  set, makes the patch apply ONLY when the current status line equals that value (whitespace-tolerant) —
 *  otherwise the frontmatter is returned UNCHANGED with `replaced:false` (a no-op, NOT an error: callers
 *  that already judged "is it <fromStatus>" via the develop ref use this to avoid clobbering a
 *  concurrently-flipped disk, see setTaskStatus). No `status:` line ⇒ fail-closed (ok:false). */
export function patchStatusField(
  frontmatterRaw: string,
  toStatus: string,
  fromStatus?: string,
): { ok: true; fm: string; from: string; replaced: boolean; to: string } | { ok: false; reason: string } {
  const statusLineRe = /^status:[ \t]*[^\r\n]*$/m;
  const line = frontmatterRaw.match(statusLineRe);
  if (!line) return { ok: false, reason: "no-status-line" };
  const from = line[0].replace(/^status:[ \t]*/, "").trim();
  if (fromStatus !== undefined && from !== fromStatus) {
    return { ok: true, fm: frontmatterRaw, from, replaced: false, to: toStatus };
  }
  return { ok: true, fm: frontmatterRaw.replace(statusLineRe, `status: ${toStatus}`), from, replaced: true, to: toStatus };
}

/** Ensure the frontmatter carries the `delivery-critical` label (moved VERBATIM from ready-pool-check.ts;
 *  single source now lives here). Mirrors task-schema.ts's parseTask label reading (block list OR flow list
 *  OR absent), then ADDS the label when missing. This is the "标签与 ready 同现" write: the promote gate
 *  determines delivery-critical at promote time, and this helper makes the label physically present in the
 *  frontmatter AT ready-entry — so the dispatch-time sort key (slot-refill's deliveryCritical axis, which
 *  reads the same labels via parseTask/parseCandidate) can act on it in the NEXT selection.
 *  @param {string} fm  the frontmatter text between the `---` fences
 *  @returns {{ fm: string, added: boolean, deliveryCritical: boolean }}  `deliveryCritical` is true
 *      when the label is present after the operation (already there, or newly added). */
export function ensureDeliveryCriticalLabel(fm: string): { fm: string; added: boolean; deliveryCritical: boolean } {
  // flow list: `labels: [a, b]`
  const flow = /^(labels:\s*\[)([^\]]*)(\]\s*)$/m.exec(fm);
  if (flow) {
    const list = flow[2];
    const items = list.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    if (items.includes("delivery-critical")) return { fm, added: false, deliveryCritical: true };
    const sep = list.trim() ? ", " : "";
    return {
      fm: fm.replace(/^(labels:\s*\[)([^\]]*)(\]\s*)$/m, `$1${list}${sep}delivery-critical$3`),
      added: true,
      deliveryCritical: true,
    };
  }
  // block list: `labels:\n  - a\n  - b`
  if (/^labels:\s*$/m.test(fm)) {
    const lines = fm.split(/\r?\n/);
    const idx = lines.findIndex((l) => /^labels:\s*$/.test(l));
    const hasDc = lines.slice(idx + 1).some((l) => /^\s+-\s+["']?delivery-critical["']?\s*$/.test(l));
    if (hasDc) return { fm, added: false, deliveryCritical: true };
    // Insert a new `  - delivery-critical` item at the end of the labels block (before the next
    // top-level key, or at the frontmatter end when labels is the last field).
    let insertAt = lines.length;
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^\S/.test(lines[i])) { insertAt = i; break; }
    }
    lines.splice(insertAt, 0, "  - delivery-critical");
    return { fm: lines.join("\n"), added: true, deliveryCritical: true };
  }
  // No labels field at all — append a block list at the end of the frontmatter (before the closing
  // fence, which the caller owns).
  return { fm: `${fm.replace(/\n*$/, "")}\nlabels:\n  - delivery-critical\n`, added: true, deliveryCritical: true };
}

// ── commit (scoped, branch-aware: commits to the CURRENT branch, never pushes to develop) ─────────

/** True when `root` is inside a git work tree (production root = the main checkout / a task worktree).
 *  False when git itself errors (unit-test temp dirs, or a repo-less root) — the commit is then a no-op,
 *  not a throw. */
export function isInsideGitWorkTree(root: string): boolean {
  try {
    const out = execFileSync("git", ["-C", root, "rev-parse", "--is-inside-work-tree"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.toString().trim() === "true";
  } catch {
    return false;
  }
}

/** COMMIT-AFTER-WRITE (gap-mark-needs-human-commit-after-write): commit a single task file to git
 *  immediately after a mechanical status flip. pathspec-limited to `rel` (⛔ never a bare `git commit`,
 *  which would sweep whatever another layer staged into the SHARED index — memory
 *  git-commit-no-pathspec-commits-shared-index). `--no-verify` skips the pre-commit hook: a mechanical
 *  status flip is content-neutral. Repo-less unit-test temp dirs are a no-op (return false, not a throw).
 *  Returns true when the commit landed; false on repo-less / git error (surfaced as `committed: false`,
 *  observable not silent). */
export function commitTaskFile(root: string, rel: string, message: string): boolean {
  if (!isInsideGitWorkTree(root)) return false;
  try {
    execFileSync("git", ["-C", root, "add", "--", rel]);
    execFileSync("git", ["-C", root, "commit", "--no-verify", "-m", message, "--", rel]);
    return true;
  } catch {
    return false;
  }
}

/** FIRST-REGISTRATION JUDGMENT (gap-promotion-commit-message-misleading-on-first-track): true when
 *  `rel` already has a commit in git history (`git log -1 --format=%H -- <rel>` non-empty). A file on
 *  disk but never committed — the case where a promotion/needs-human flip is actually the file's BIRTH
 *  commit, not a status transition — returns false, so callers can label it "首次登记" instead of
 *  claiming a flip that never happened. Repo-less root ⇒ false (same no-op shape as commitTaskFile;
 *  there is no history to consult). */
export function hasPriorCommit(root: string, rel: string): boolean {
  if (!isInsideGitWorkTree(root)) return false;
  try {
    const out = execFileSync("git", ["-C", root, "log", "-1", "--format=%H", "--", rel], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}
