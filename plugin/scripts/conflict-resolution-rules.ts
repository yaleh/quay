// conflict-resolution-rules.ts — the EXECUTABLE carrier for the machine-decidable half of the
// fan-in merge-conflict resolution protocol (tasks/gap-arbitrary-semantics-unenforced-carriers AC2).
//
// THE DEFECT THIS REPLACES. The conflict-resolution protocol's rules (3) dual-copy / (4) tick-doc /
// (5) modify-delete lived ONLY as prompt prose in worker-driver.ts `continueConflictResolutionNote`,
// guarded by tests that did `assert.match(prompt, /judge WHICH side deleted/)` — i.e. they asserted a
// STRING IS PRESENT, never that the behavior happens (硬规则 9: 可见性 ≠ 执行). A worker that ignores
// the prose still passes the suite. This module lifts the machine-decidable rules into a decision
// function + a real git executor, so the rule can be EXECUTED and its behavior can be asserted.
//
// WHICH RULES ARE MACHINE-DECIDABLE (and which are not):
//   (3) dual-copy  — `.claude/workflows/*` ↔ `plugin/workflows/*` must be byte-identical. The
//                    resolution ("take develop's version, then re-sync BOTH copies byte-identical")
//                    is fully mechanical: `git checkout develop -- <rel>` + copy the resolved bytes to
//                    the peer path.
//   (4) take-develop docs — the docs that take develop's version wholesale. Fully mechanical:
//                    `git checkout develop -- <rel>`. The set is a REGISTRY (`TAKE_DEVELOP_DOC_RULES`),
//                    not a predicate per doc: `orchestration/*-tick-core.md` (tick docs) and the
//                    outline doc. This registry is the SINGLE SOURCE for both the mechanical decision
//                    (`conflictAction`) and the worker prompt prose (`takeDevelopDocPromptRules`) —
//                    gap-conflict-outline-half-only-in-prompt-prose: before that, the outline rule
//                    lived ONLY in worker-driver.ts's prompt string, so a UU on the outline fell to
//                    `manual` while the prompt told the worker to take develop.
//   (5) modify/delete — the "which side deleted" judgment is DERIVABLE from the `git status --porcelain`
//                    conflict code (`DU` = deleted by us / `UD` = deleted by them) and the resolution is
//                    the same either way: accept the deletion with `git rm`. Fully mechanical.
//   ⛔ NOT here: code files / task files (2b) / ff-not-fast-forward — those remain agent-executed and
//      are NOT in this task's scope (the prompt still carries them).
//
// WHY A SEPARATE HERMETIC MODULE: worker-driver.ts imports dozens of modules, so a mutation test of a
// rule table INSIDE it cannot re-import the mutated copy. This module imports only node builtins, so a
// test can copy it to a temp dir, mutate a rule, and re-run it — the negative arm that proves the guard
// no longer just asserts a string (AC2's "删掉/改错对应规则后检查必红").
//
// Usage (library): worker-driver-resident-s07.test.mjs imports `conflictAction` / `dualCopyPeer` /
// `isDualCopyFile` / `isTickDoc` / `takeDevelopDocRule` / `isTakeDevelopDoc` /
// `takeDevelopDocPromptRules` / `resolveConflictMechanically` directly for the contract check
// (the test asserts the module's BEHAVIOR — real git operations — not a prompt string).
// This module is the EXECUTABLE carrier for rules (3)/(4)/(5): the rules are decided here by
// POSITION and EXECUTED by real git commands, then asserted by the behavior test. worker-driver.ts
// imports `takeDevelopDocPromptRules` so the take-develop PROSE it puts in the worker prompt is
// rendered from this same registry (gap-conflict-outline-half-only-in-prompt-prose: one rule, two
// carriers, one source). The agent-executed half (code/task-file/ff) stays prose in worker-driver,
// which must not grow past the gap-worker-prompt-note-family-slimming 25% baseline.
// Usage (CLI, for the worker / tests):
//   node --experimental-strip-types plugin/scripts/conflict-resolution-rules.ts --judge <rel> <status> [--json]
//   node --experimental-strip-types plugin/scripts/conflict-resolution-rules.ts --resolve <root> <rel> <status> [--json]
// Exit: 0 = resolved (or a definite action for --judge); 1 = not machine-resolvable (manual); 2 = usage.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { isDirectEntrySafe } from "./gate-script-base.ts";

/** The two dual-copy directories (rule 3). A file in one has a byte-identical peer in the other. */
export const DUAL_COPY_DIRS = [
  { dir: ".claude/workflows", peer: "plugin/workflows" },
  { dir: "plugin/workflows", peer: ".claude/workflows" },
] as const;

/** The peer path of a dual-copy file (`a/b/x` → `c/d/x`), or null when `rel` is not dual-copy. */
export function dualCopyPeer(rel: string): string | null {
  const norm = rel.split(path.sep).join("/");
  for (const { dir, peer } of DUAL_COPY_DIRS) {
    const prefix = `${dir}/`;
    if (!norm.startsWith(prefix)) continue;
    const base = norm.slice(prefix.length);
    if (base === "" || base.includes("/") || base.includes("..") || base.includes("\\")) continue;
    return `${peer}/${base}`;
  }
  return null;
}

/** True iff `rel` is a dual-copy file (`.claude/workflows/*` ↔ `plugin/workflows/*`, no subdirs). */
export function isDualCopyFile(rel: string): boolean {
  return dualCopyPeer(rel) !== null;
}

/** A take-develop doc is selected either by an EXACT repo-relative path or by a path-family RegExp. */
export type TakeDevelopDocSelector = string | RegExp;

export interface TakeDevelopDocRule {
  /** stable id — reported in the `conflictAction` reason so the matched rule is nameable. */
  id: string;
  /** POSITION selector: the exact path, or the family pattern. Never a content keyword. */
  selector: TakeDevelopDocSelector;
  /** the doc class, as the worker prompt names it. */
  note: string;
  /** the ⛔ clause the worker prompt carries for this doc class. */
  forbid: string;
}

/**
 * THE REGISTRY — every doc whose merge conflict is resolved by taking develop's version, and the ONLY
 * place those paths live. Both carriers render from it:
 *   • `conflictAction` → `take-develop` (mechanical, decided by POSITION), and
 *   • `takeDevelopDocPromptRules` → the worker prompt's conflict-resolution note.
 * Adding a doc here changes the decision AND the prose in one edit; there is no second list to drift.
 */
export const TAKE_DEVELOP_DOC_RULES: ReadonlyArray<TakeDevelopDocRule> = [
  {
    id: "tick-doc",
    selector: /^orchestration\/[^/]*-tick-core\.md$/,
    note: "tick doc (orchestration/*-tick-core.md)",
    forbid: "⛔ do NOT hand-merge.",
  },
  {
    id: "outline-doc",
    selector: "docs/proposals/quay-product-outline.md",
    note: "outline doc",
    forbid: "⛔ do NOT hand-merge the counts.",
  },
];

function selectorMatches(selector: TakeDevelopDocSelector, norm: string): boolean {
  return typeof selector === "string" ? norm === selector : selector.test(norm);
}

/** The registry rule matching `rel`, or null. Decided by POSITION (exact path / path pattern). */
export function takeDevelopDocRule(rel: string): TakeDevelopDocRule | null {
  const norm = rel.split(path.sep).join("/");
  for (const rule of TAKE_DEVELOP_DOC_RULES) {
    if (selectorMatches(rule.selector, norm)) return rule;
  }
  return null;
}

/** True iff `rel` is ANY take-develop doc in the registry. */
export function isTakeDevelopDoc(rel: string): boolean {
  return takeDevelopDocRule(rel) !== null;
}

/**
 * The prompt line for one rule, rendered FROM the registry entry (single source). `git checkout
 * develop -- <file>` is emitted only for exact-path rules — a path-family rule cannot name one file,
 * so it keeps the `<file>` placeholder the worker substitutes after reading `git status`.
 */
export function renderTakeDevelopDocRule(rule: TakeDevelopDocRule): string {
  const target = typeof rule.selector === "string" ? rule.selector : "<file>";
  return `${rule.note}: take the develop version (\`git checkout develop -- ${target}\`); ${rule.forbid}`;
}

/** Every take-develop doc rule rendered for the worker prompt — the whole prompt half of the registry. */
export function takeDevelopDocPromptRules(): string[] {
  return TAKE_DEVELOP_DOC_RULES.map(renderTakeDevelopDocRule);
}

/** The tick-doc rule id — `isTickDoc` is the NAMED SUBSET of the registry (kept for its readers). */
const TICK_DOC_RULE_ID = "tick-doc";

/** True iff `rel` is a tick doc under `orchestration/` (`*-tick-core.md`). */
export function isTickDoc(rel: string): boolean {
  return takeDevelopDocRule(rel)?.id === TICK_DOC_RULE_ID;
}

/** The two modify/delete conflict codes from `git status --porcelain` (both mean "accept the deletion"). */
export const DELETE_SIDE_CODES: ReadonlySet<string> = new Set(["DU", "UD"]);

export type ConflictActionKind = "dual-copy-sync" | "take-develop" | "delete-side" | "manual";

export interface ConflictAction {
  kind: ConflictActionKind;
  reason: string;
  /** dual-copy-sync only: the peer path that must end byte-identical after resolution. */
  peer: string | null;
}

/**
 * The machine-decidable resolution action for ONE conflicted file, decided by POSITION (path pattern
 * + `git status --porcelain` conflict code) — never by keyword. This is the executable half of the
 * protocol's rules (3)/(4)/(5); `manual` means the file is outside the machine-decidable set.
 */
export function conflictAction(rel: string, status: string): ConflictAction {
  if (DELETE_SIDE_CODES.has(status)) {
    return {
      kind: "delete-side",
      reason: `modify/delete conflict (${status}) — accept the deletion with \`git rm\``,
      peer: null,
    };
  }
  if (isDualCopyFile(rel)) {
    return {
      kind: "dual-copy-sync",
      reason: "dual-copy conflict — take develop's version, then re-sync BOTH copies byte-identical",
      peer: dualCopyPeer(rel),
    };
  }
  const takeDevelop = takeDevelopDocRule(rel);
  if (takeDevelop) {
    return {
      kind: "take-develop",
      reason: `${takeDevelop.note} conflict — take the develop version (rule: ${takeDevelop.id})`,
      peer: null,
    };
  }
  return { kind: "manual", reason: "not a machine-decidable rule — resolve semantically", peer: null };
}

export interface MechanicalResolution {
  rel: string;
  action: ConflictActionKind;
  resolved: boolean;
  reason: string;
}

function git(root: string, args: string[]): { code: number; stdout: string; stderr: string } {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return { code: r.status ?? 127, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/**
 * Perform the mechanical resolution for one conflicted file. Runs the REAL git commands the protocol
 * names, so the behavior — not the prompt string — is what a test asserts:
 *   take-develop    → `git checkout develop -- <rel>`
 *   delete-side     → `git rm <rel>`
 *   dual-copy-sync  → `git checkout develop -- <rel>`, then copy the resolved bytes to the peer and
 *                     `git add` both, so the two copies are byte-identical.
 *   manual          → resolved:false (the caller leaves it to the agent).
 */
export function resolveConflictMechanically(root: string, rel: string, status: string): MechanicalResolution {
  const action = conflictAction(rel, status);
  const norm = rel.split(path.sep).join("/");
  switch (action.kind) {
    case "take-develop": {
      const r = git(root, ["checkout", "develop", "--", norm]);
      if (r.code !== 0) return { rel: norm, action: action.kind, resolved: false, reason: `git checkout develop -- ${norm} failed: ${r.stderr.trim()}` };
      return { rel: norm, action: action.kind, resolved: true, reason: `restored ${norm} from develop` };
    }
    case "delete-side": {
      const r = git(root, ["rm", norm]);
      if (r.code !== 0) return { rel: norm, action: action.kind, resolved: false, reason: `git rm ${norm} failed: ${r.stderr.trim()}` };
      return { rel: norm, action: action.kind, resolved: true, reason: `accepted the deletion of ${norm} (${status})` };
    }
    case "dual-copy-sync": {
      const checkout = git(root, ["checkout", "develop", "--", norm]);
      if (checkout.code !== 0) return { rel: norm, action: action.kind, resolved: false, reason: `git checkout develop -- ${norm} failed: ${checkout.stderr.trim()}` };
      const peer = action.peer;
      if (peer == null) return { rel: norm, action: action.kind, resolved: false, reason: "dual-copy peer could not be derived" };
      const abs = path.join(root, norm);
      const peerAbs = path.join(root, peer);
      try {
        const content = fs.readFileSync(abs, "utf8");
        fs.mkdirSync(path.dirname(peerAbs), { recursive: true });
        fs.writeFileSync(peerAbs, content, "utf8");
      } catch (e) {
        return { rel: norm, action: action.kind, resolved: false, reason: `byte-identical re-sync failed: ${(e as Error).message}` };
      }
      const add = git(root, ["add", norm, peer]);
      if (add.code !== 0) return { rel: norm, action: action.kind, resolved: false, reason: `git add ${norm} ${peer} failed: ${add.stderr.trim()}` };
      return { rel: norm, action: action.kind, resolved: true, reason: `re-synced ${norm} ↔ ${peer} byte-identical from develop` };
    }
    case "manual":
      return { rel: norm, action: action.kind, resolved: false, reason: "manual resolution required (not machine-decidable)" };
  }
}

function usage(): string {
  return "usage: conflict-resolution-rules.ts --judge <rel> <status> [--json]\n" +
    "       conflict-resolution-rules.ts --resolve <root> <rel> <status> [--json]\n" +
    "       conflict-resolution-rules.ts --render-prompt-rules\n" +
    "Exit: 0 = definite machine action / resolved; 1 = manual (not machine-resolvable) / resolution failed; 2 = usage";
}

function main(argv: string[]): number {
  const args = argv;
  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(usage() + "\n");
    return 2;
  }
  const asJson = args.includes("--json");
  const rest = args.filter((a) => a !== "--json");
  const judgeIdx = rest.indexOf("--judge");
  const resolveIdx = rest.indexOf("--resolve");
  const renderIdx = rest.indexOf("--render-prompt-rules");
  if ([judgeIdx, resolveIdx, renderIdx].filter((i) => i !== -1).length > 1) { process.stderr.write(usage() + "\n"); return 2; }
  if (renderIdx !== -1) {
    // The prompt half of THIS registry, rendered from the loaded module — the negative arm runs this
    // against a mutated copy to prove the prompt and the mechanical decision share one source.
    for (const line of takeDevelopDocPromptRules()) process.stdout.write(line + "\n");
    return 0;
  }
  if (judgeIdx !== -1) {
    const rel = rest[judgeIdx + 1];
    const status = rest[judgeIdx + 2];
    if (!rel || !status) { process.stderr.write(usage() + "\n"); return 2; }
    const action = conflictAction(rel, status);
    if (asJson) process.stdout.write(JSON.stringify(action, null, 2) + "\n");
    else process.stdout.write(`conflict-action: ${rel} [${status}] ⇒ ${action.kind} — ${action.reason}${action.peer ? ` (peer: ${action.peer})` : ""}\n`);
    return action.kind === "manual" ? 1 : 0;
  }
  if (resolveIdx !== -1) {
    const root = rest[resolveIdx + 1];
    const rel = rest[resolveIdx + 2];
    const status = rest[resolveIdx + 3];
    if (!root || !rel || !status) { process.stderr.write(usage() + "\n"); return 2; }
    const res = resolveConflictMechanically(root, rel, status);
    if (asJson) process.stdout.write(JSON.stringify(res, null, 2) + "\n");
    else process.stdout.write(`conflict-resolve: ${rel} [${status}] ⇒ ${res.resolved ? "resolved" : "not-resolved"} (${res.action}) — ${res.reason}\n`);
    return res.resolved ? 0 : 1;
  }
  process.stderr.write(usage() + "\n");
  return 2;
}

if (isDirectEntrySafe("conflict-resolution-rules")) process.exit(main(process.argv.slice(2)));
