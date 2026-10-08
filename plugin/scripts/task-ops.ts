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
//                 reformat the rest of the frontmatter; ⛔ DEFINED IN THE KERNEL
//                 `packages/quay/src/kernel/task-transition.ts` since GOAL-030 and re-exported below —
//                 one definition, shared with the product judge) + ensureLabel (generic "add one label,
//                 keep the rest" safe-add primitive) + ensureDeliveryCriticalLabel (label add, moved
//                 from ready-pool-check.ts; the delivery-critical specialization of ensureLabel; now also
//                 stamps `extra.deliveryCriticalSource` on label-add, preserving an existing source —
//                 gap-delivery-critical-source-distinction-outer-retired).
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
// The single regex-literal escaper (kernel leaf reached via the plugin shim). Own copy was one of the
// twelve byte-identical bodies extracted by
// gap-routine-semantic-dedup-scan-escapere-escaperegex-escaperegexp-fndefre-stemre.
import { escapeRegExp } from "./regex-escape.ts";

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

// `patchStatusField` LIVES IN THE KERNEL now, as the SINGLE definition
// (`packages/quay/src/kernel/task-transition.ts`, GOAL-030). WHY: the promotion path is where this
// driver layer meets the product judge that declares the lifecycle edges, and the kernel is the only
// placement both reach without a `packages/**` → `plugin/**` reverse edge — the same argument as the
// `regex-escape.ts` re-export above. It is re-exported here so the four existing callers
// (driver-filters.ts / worker-fan-in.ts / ready-pool-check.ts) keep importing `./task-ops.ts` with
// zero changes. The plugin bundler (build-plugin-dist's `coreSrcAliasPlugin`) re-points the
// `packages/quay/src/**` specifier and INLINES the implementation, exactly as it does for
// `regex-escape.ts` — so this path can never diverge from the product bundle.
export { patchStatusField } from "../../packages/quay/src/kernel/task-transition.ts";

// `escapeRegExp` (imported above) escapes a literal string for use inside a RegExp, so the
// label→has-label line match treats the label as a literal (never a regex pattern).

/** Ensure the frontmatter carries `label` — the generic "append one label, touch nothing else"
 *  primitive (gap-task-write-labels-replace-not-append-no-safe-add-action). Reads the existing labels
 *  (block list OR flow list OR absent), then ADDS `label` only when missing. This is a SAFE ADD, never
 *  a whole-set replace, so a caller cannot wipe sibling labels by omission — the frontmatter-text
 *  counterpart to the Core MCP verb `task_add_label` (packages/quay/src/mcp-handlers.ts), which provides
 *  the same append-dedupe semantics over the Provider ABI task view-model.
 *  @param {string} fm    the frontmatter text between the `---` fences
 *  @param {string} label the label to append (e.g. "delivery-critical")
 *  @returns {{ fm: string, added: boolean, present: boolean }}  `present` is true when the label is
 *      present after the operation (already there, or newly added). */
export function ensureLabel(fm: string, label: string): { fm: string; added: boolean; present: boolean } {
  // flow list: `labels: [a, b]`
  const flow = /^(labels:\s*\[)([^\]]*)(\]\s*)$/m.exec(fm);
  if (flow) {
    const list = flow[2];
    const items = list.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    if (items.includes(label)) return { fm, added: false, present: true };
    const sep = list.trim() ? ", " : "";
    return {
      fm: fm.replace(/^(labels:\s*\[)([^\]]*)(\]\s*)$/m, `$1${list}${sep}${label}$3`),
      added: true,
      present: true,
    };
  }
  // block list: `labels:\n  - a\n  - b`
  if (/^labels:\s*$/m.test(fm)) {
    const lines = fm.split(/\r?\n/);
    const idx = lines.findIndex((l) => /^labels:\s*$/.test(l));
    const hasLabel = lines.slice(idx + 1).some((l) => new RegExp(`^\\s+-\\s+["']?${escapeRegExp(label)}["']?\\s*$`).test(l));
    if (hasLabel) return { fm, added: false, present: true };
    // Insert a new `  - <label>` item at the end of the labels block (before the next top-level key,
    // or at the frontmatter end when labels is the last field).
    let insertAt = lines.length;
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^\S/.test(lines[i])) { insertAt = i; break; }
    }
    lines.splice(insertAt, 0, `  - ${label}`);
    return { fm: lines.join("\n"), added: true, present: true };
  }
  // No labels field at all — append a block list at the end of the frontmatter (before the closing
  // fence, which the caller owns).
  return { fm: `${fm.replace(/\n*$/, "")}\nlabels:\n  - ${label}\n`, added: true, present: true };
}

/** Stamp `extra.<key>: <value>` into a raw frontmatter (byte-preserving text edit, never a YAML
 *  round-trip). Handles the three `extra:` shapes — block map (`extra:\n  k: v`), flow map
 *  (`extra: {k: v}`), and absent (append a block map at the end). PRESERVES an existing value: if the
 *  key is already present, the frontmatter is returned unchanged (a manager's `adhoc` stamp is never
 *  overwritten by a later promote-time `evidence` pass). */
function setExtraScalar(fm: string, key: string, value: string): string {
  const blockRe = /^extra:\s*$/m;
  const flowRe = /^extra:\s*\{([^}]*)\}\s*$/m;
  if (blockRe.test(fm)) {
    const lines = fm.split(/\r?\n/);
    const idx = lines.findIndex((l) => /^extra:\s*$/.test(l));
    let insertAt = lines.length;
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^\S/.test(lines[i])) { insertAt = i; break; }
    }
    const keyRe = new RegExp(`^\\s+${key}\\s*:`);
    if (lines.slice(idx + 1, insertAt).some((l) => keyRe.test(l))) return fm; // existing key: preserve
    lines.splice(insertAt, 0, `  ${key}: ${value}`);
    return lines.join("\n");
  }
  const flow = flowRe.exec(fm);
  if (flow) {
    const inner = flow[1].trim();
    if (new RegExp(`(?:^|,)\\s*${key}\\s*:`).test(inner)) return fm; // existing key: preserve
    const newInner = inner ? `${inner}, ${key}: ${value}` : `${key}: ${value}`;
    return fm.replace(flowRe, `extra: {${newInner}}`);
  }
  // No `extra:` field at all — append a block map at the end of the frontmatter (before the closing
  // fence, which the caller owns).
  return `${fm.replace(/\n*$/, "")}\nextra:\n  ${key}: ${value}\n`;
}

/** Ensure the frontmatter carries the `delivery-critical` label (moved from ready-pool-check.ts; single
 *  source now lives here) AND — when the label is being ADDED — stamps its SOURCE into
 *  `extra.deliveryCriticalSource` (gap-delivery-critical-source-distinction-outer-retired). The label
 *  now has two legal sources that were previously conflated into a single prose claim ("由 outer 按证据打，
 *  从不移除"): `evidence` (the promote gate's determination — this helper's only production caller) and
 *  `adhoc` (the manager under DIR-130's standing authorization, written via task_write, NOT through this
 *  helper). This is the delivery-critical specialization of `ensureLabel`
 *  (gap-task-write-labels-replace-not-append-no-safe-add-action): the label append delegates to the
 *  generic safe-add primitive, and only the delivery-critical-specific SOURCE stamp lives here. Mirrors
 *  task-schema.ts's parseTask label reading (block list OR flow list OR absent), then
 *  ADDS the label when missing. This is the "标签与 ready 同现" write: the promote gate determines
 *  delivery-critical at promote time, and this helper makes the label physically present in the
 *  frontmatter AT ready-entry — so the dispatch-time sort key (slot-refill's deliveryCritical axis, which
 *  reads the same labels via parseTask/parseCandidate) can act on it in the NEXT selection.
 *  @param {string} fm  the frontmatter text between the `---` fences
 *  @param {object} [opts]
 *  @param {"evidence"|"adhoc"} [opts.deliveryCriticalSource="evidence"]  the source to stamp when the
 *      label is ADDED. An already-present label is PRESERVED (never restamped) — a manager's `adhoc`
 *      stamp survives a later promote pass, and a legacy label's absent source stays absent.
 *  @returns {{ fm: string, added: boolean, deliveryCritical: boolean }}  `deliveryCritical` is true
 *      when the label is present after the operation (already there, or newly added). */
export function ensureDeliveryCriticalLabel(fm: string, opts: { deliveryCriticalSource?: string } = {}): { fm: string; added: boolean; deliveryCritical: boolean } {
  const source = opts.deliveryCriticalSource ?? "evidence";
  const r = ensureLabel(fm, "delivery-critical");
  return {
    fm: r.added ? setExtraScalar(r.fm, "deliveryCriticalSource", source) : r.fm,
    added: r.added,
    deliveryCritical: r.present,
  };
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
