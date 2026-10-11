#!/usr/bin/env node
// BOUNDED PROPOSAL-REPAIR — the missing middle layer between the active investigation loop and the
// ArchGuard Refactor Slice / Expected Delta primitive.
//
// Production reading (2026-10-11, `.quay/ownership-shadow-proposals.jsonl`): of the package-cycle
// proposals that reached `slice-delta`, every one of them was REFUSED — NO_EDGE_EXPLAINED_BY_MOVES,
// coverage-insufficient, MOVE_TO_NOT_AN_INTERNAL_DIR. The limited-proposal entry bar (the admission
// gate that would let a proposal become a goal) therefore could never be satisfied. This module does
// ONE thing: given such a rejection, run a STRICTLY BOUNDED feedback-and-revise retry loop, and if it
// cannot compute a delta that passes the primitive's negative control, abstain honestly.
//
// ⛔ STRUCTURAL RED LINES (asserted by plugin/test/ownership-active-proposal-repair.test.mjs):
//   * touches none of the safety gates — evaluateEntryBar / deterministicGate / quotaGate / the
//     run-streak count / the 3-consecutive-round admission / the human-approval mechanism;
//   * imports NOTHING that files a task, a goal, or a decision (no fileProposals/driveItems/fileDecisions/proposeDraftGoal);
//   * writes no source file, creates no directory that does not already exist;
//   * uses NO holdout (A/B) result as feedback or as a candidate-generation source;
//   * hardcodes NO answer — the legal directories and symbols are read from the SAME ArchGuard graph
//     data the original investigation round already held, never from a freshly invented list;
//   * holds NO filesystem capability of its own: every file it reads is read through the injected,
//     COMMIT-SCOPED blob reader (`git show <commit>:<path>` by default) — never the working tree, and
//     never by guessing a name.
//
// SYMBOL EXISTENCE IS A DIRECT QUANTITY (硬规则 4b, 2026-10-11). "The graph's directory edges import it"
// was a PROXY for "the symbol exists", and it reads `false` for every real export that no OTHER directory
// imports yet — including the 6 genuine exports (`GateVerdict`, `GateDefinition`, `GateVerdictKind`,
// `AcceptanceResult`, `AcceptanceVerdict`, `NotEvaluatedCause`) of the live candidate, which the old
// criterion branded as FABRICATED. A guard that accuses real code cannot repair anything: every round
// voided, the evidence mislabelled. The criterion is now the union of the two quantities that can each be
// read directly: the graph edges' `importedNames` ∪ the DECLARED EXPORTS of the move's own source file at
// the LOCKED commit (a `git show`, so an uncommitted working-tree edit is invisible).
//
// FAIL-CLOSED (硬规则 3b): a rejection that cannot be parsed, or that is not one of the known cut-level
// classes, is `honest_abstain` — never silently shaped like "repairable". A judge revision naming a
// symbol absent from BOTH sources is NOT "covered but missing"; it is an invalid revision. And a file the
// reader could not read proves NO export — "unreadable" is never reported in the shape of "proved".
//
// WHICH SHAPE OF "NOT PROVED" (硬规则 3b, 2026-10-11). The second source above has TWO failure modes that
// the first version of this criterion collapsed into one: the move's file WAS read and does not declare the
// name (a positive defect in the revision — fabricated or misspelled), versus the move's file could NOT be
// read at all (no `file`, an un-normalisable path, or no readable blob at the locked commit — the name is
// NOT EVALUATED). Reporting the second as the first hands the judge the wrong repair direction: it is told
// the SYMBOL is unknown when the real defect is the move's `file` path, so it rewrites the symbol instead of
// the path and the bounded rounds are spent moving away from a fix. The criterion is therefore a three-state
// one (`declaredSourcesForMoves`), the round's record carries the unreadable-source fact in its own
// bucket/matched, and the judge is shown it as its own fact (`unreadable_move_sources`).
// ⛔ Both states VOID the round and compute no delta — this splits the vocabulary, it does not relax the
// guard. A name no source accounts for is still rejected; only the REASON recorded for it changes.
// ⛔ And the distinction is only claimable when the locked commit is readable AT ALL: on a tree where the
// commit does not resolve, the second source is unavailable for the whole session and the reading falls
// back to its graph-only form (the pre-fix criterion, strictly narrower) rather than branding every move a
// broken file path — "I could not check" must not be manufactured out of "there is nothing to check with".

import crypto from "node:crypto";
import { DEFAULT_BUDGET, normalizeRepoPath } from "./ownership-active-contract.mjs";
import { computeSliceDelta } from "./ownership-active-slice-adapter.mjs";
import { defaultDeps } from "./ownership-active-executor.mjs";
import { appendRepairAttemptRecord } from "./architecture-evidence-store.mjs";

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const isStr = (x, n = 1) => typeof x === "string" && x.trim().length >= n;
const isArr = (x) => Array.isArray(x);

export const REPAIR_VERSION = "ownership-active-proposal-repair/1";

/** The four terminal classes a `slice_delta` rejection can fall into (enumerated, never boolean). */
export const REJECTION_CLASSES = Object.freeze(["evidence_gap", "invalid_move", "tool_limitation", "honest_abstain"]);

/** The two classes a bounded repair session may legitimately attempt. */
export const REPAIRABLE_CLASSES = Object.freeze(["invalid_move", "evidence_gap"]);

/**
 * The four hard bounds. ALL are hardcoded and a caller may only LOWER them (硬规则 4 推论二:
 * "在本机等价于无限制"的字面值不是无限制 — so the wall-clock ceiling is a real 3×600s, tied to the
 * primitive's own per-call timeout, not a host-shaped literal that silently becomes a real limit elsewhere).
 */
export const REPAIR_LIMITS = Object.freeze({
  maxRounds: 3,                                                     // revise rounds, judge call for judge call
  maxJudgeCalls: 3,                                                 // exactly maxRounds — never more for repeated failure
  maxWallClockMs: 1_800_000,                                        // 3 x the primitive's 600_000ms per-call ceiling
  maxEvidenceBytesPerRound: DEFAULT_BUDGET.max_total_evidence_bytes, // reuse the loop's budget magnitude, do not widen
});

// ── rejection taxonomy (declared as DATA so the vocabulary is enumerable and testable) ──────────
/** Reasons the SLICE BUILDER emits for a malformed/incomplete CUT — structure feedback exists to fix it. */
export const INVALID_MOVE_PREFIXES = Object.freeze([
  "NO_EDGE_EXPLAINED_BY_MOVES",
  "MOVE_TO_NOT_AN_INTERNAL_DIR",
  "MOVE_FROM_NOT_AN_INTERNAL_DIR",
  "SUBJECT_NOT_AN_INTERNAL_DIR",
]);
/** ArchGuard's own coverage refusal names the uncovered symbols — the same class (the cut is incomplete). */
export const COVERAGE_INSUFFICIENT_MARKER = "切法覆盖不足";
/** Reasons the PRIMITIVE could not run at all — a capability boundary, not a fixable cut. */
export const TOOL_LIMITATION_PREFIXES = Object.freeze([
  "ARCHGUARD_CLI_NOT_INSTALLED", "ARCHGUARD_CLI_NOT_FOUND", "ARCHGUARD_VERSION_TOO_OLD",
  "SLICE_DELTA_SUBCOMMAND_MISSING", "SLICE_DELTA_UNAVAILABLE",
  "SCOPE_ROOT_INVALID", "SCOPE_ROOT_NOT_A_TREE_AT_REF", "PACKAGE_GRAPH_BUILD_FAILED",
  "NO_MODULE_GRAPH_IN_ARCHJSON", "NO_REPORT",
]);
/** Free-text markers of a capability gap reported by the ArchGuard surface itself. */
export const TOOL_LIMITATION_MARKERS = Object.freeze(["capability_gap", "NOT_EVALUATED_BY_TOOL"]);
/** "Missing a fact that could have been looked up" — declared but NOT observed in production (2026-10-11). */
export const EVIDENCE_GAP_PREFIXES = Object.freeze(["EVIDENCE_GAP", "INSUFFICIENT_EVIDENCE", "NEEDS_EVIDENCE"]);

/** Which classes have a real production sample. `evidence_gap` has none — recorded, not fabricated. */
export const PRODUCTION_OBSERVED_CLASSES = Object.freeze(["invalid_move", "tool_limitation"]);

/**
 * Classify ONE `slice_delta` reading. PURE, enumerative. Returns `{class, is_rejection, matched, ...}`.
 * `class === null` iff the reading is not a rejection at all (`evaluated` / `guard-violated`).
 * @param {object} sliceDelta the recorded `slice_delta` (or any `{status, reason, gap}` shape)
 */
export function classifyRejection(sliceDelta) {
  if (!isObj(sliceDelta) || typeof sliceDelta.status !== "string") {
    return { class: "honest_abstain", is_rejection: true, matched: "UNREADABLE_REJECTION", status: sliceDelta?.status ?? null, reason_text: null };
  }
  const status = sliceDelta.status;
  const reason = typeof sliceDelta.reason === "string" ? sliceDelta.reason : "";
  const base = { status, reason_text: reason || null, gap: sliceDelta.gap ?? null };
  if (status === "evaluated" || status === "guard-violated") return { class: null, is_rejection: false, matched: "NOT_A_REJECTION", ...base };

  // The primitive itself could not run, or declared a capability gap: a capability boundary, not a bad cut.
  if (status === "unavailable" || sliceDelta.gap) return { class: "tool_limitation", is_rejection: true, matched: "STATUS_UNAVAILABLE_OR_GAP", ...base };
  const starts = (list) => list.find((p) => reason.startsWith(p));
  const egp = starts(EVIDENCE_GAP_PREFIXES);
  if (egp) return { class: "evidence_gap", is_rejection: true, matched: `EVIDENCE_GAP:${egp}`, ...base };
  const imp = starts(INVALID_MOVE_PREFIXES);
  if (imp) return { class: "invalid_move", is_rejection: true, matched: `INVALID_MOVE:${imp}`, ...base };
  if (reason.includes(COVERAGE_INSUFFICIENT_MARKER)) return { class: "invalid_move", is_rejection: true, matched: "INVALID_MOVE:COVERAGE_INSUFFICIENT", ...base };
  const tlp = starts(TOOL_LIMITATION_PREFIXES);
  if (tlp) return { class: "tool_limitation", is_rejection: true, matched: `TOOL_LIMITATION:${tlp}`, ...base };
  const tlm = TOOL_LIMITATION_MARKERS.find((m) => reason.toLowerCase().includes(m.toLowerCase()));
  if (tlm) return { class: "tool_limitation", is_rejection: true, matched: `TOOL_LIMITATION_MARKER:${tlm}`, ...base };
  // Fail-closed default: a rejection we cannot parse is NOT "repairable".
  return { class: "honest_abstain", is_rejection: true, matched: "UNCLASSIFIED_REJECTION", ...base };
}

/** Convenience: is this reading a rejection the bounded repair may attempt? */
export const isRepairableRejection = (sliceDelta) => REPAIRABLE_CLASSES.includes(classifyRejection(sliceDelta).class);

// ── graph-derived structure facts (the SAME ArchGuard graph data, never a fresh find/grep) ──────
/** The internal directory nodes of an ArchGuard module graph, sorted. One node per directory id. */
export const internalNodeIds = (graph) =>
  [...new Set((graph?.nodes || []).filter((n) => n && n.type === "internal" && typeof n.id === "string").map((n) => n.id))].sort();

/** Every symbol the graph knows: the union of the edges' imported names. */
export function graphSymbols(graph) {
  const s = new Set();
  for (const e of graph?.edges || []) for (const n of e.importedNames || []) if (typeof n === "string") s.add(n);
  return s;
}

// ── the SECOND, direct source of symbol existence: the move's own file AT THE LOCKED COMMIT ────────
/**
 * Names a TypeScript module declares as exported, parsed from its SOURCE TEXT. Covers the declaration
 * forms (`export [declare] [abstract] [async] function|class|interface|type|enum|const|let|var NAME`)
 * and the export-list forms (`export { a, b as c }`, `export type { … }`, with or without a `from`).
 *
 * ⛔ Declared boundaries, each of which makes the reading NARROWER (the fail-closed direction, 硬规则 3b):
 * it does NOT follow `export * from "…"` (the name is declared in ANOTHER file, which this criterion does
 * not read) and does not resolve `export default` (not importable by name anyway). A name behind either
 * boundary stays "unproven" — it is never assumed exported.
 */
export function declaredExportNames(source) {
  const out = new Set();
  if (typeof source !== "string" || !source) return out;
  // A name mentioned in a comment is not an export (硬规则 2: judge the code, not the prose).
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
  const decl = /\bexport\s+(?:declare\s+)?(?:abstract\s+)?(?:(?:async\s+)?function\s+|(?:const|let|var)\s+(?:enum\s+)?|class\s+|interface\s+|type\s+|enum\s+)([A-Za-z_$][\w$]*)/g;
  for (const m of code.matchAll(decl)) out.add(m[1]);
  const list = /\bexport\s+(?:type\s+)?\{([^}]*)\}/g;
  for (const m of code.matchAll(list)) {
    for (const part of m[1].split(",")) {
      const t = part.trim();
      if (!t) continue;
      const alias = t.match(/\bas\s+([A-Za-z_$][\w$]*)\s*$/);
      const name = alias ? alias[1] : t.match(/^([A-Za-z_$][\w$]*)/)?.[1];
      if (name) out.add(name);
    }
  }
  return out;
}

/**
 * The repo-relative path a move's `file` names, or `null` when it is not a well-formed in-repo path.
 * `file` is declared RELATIVE TO `scope_root`, and the same `normalizeRepoPath` the loop's own executor
 * uses refuses absolute paths, `..` segments and denied paths — a path that does not normalise proves no
 * export (it is never reinterpreted, never guessed at).
 */
export function moveSourcePath(scopeRoot, file) {
  if (typeof file !== "string" || typeof scopeRoot !== "string" || !file.trim()) return null;
  // `file` is RELATIVE to scope_root by contract: an absolute one is refused rather than silently re-rooted.
  if (file.startsWith("/") || file.includes("\0")) return null;
  const n = normalizeRepoPath(scopeRoot ? `${scopeRoot}/${file}` : file);
  return n.ok ? n.path : null;
}

/**
 * Read ONE blob AT A COMMIT — `git show <commit>:<path>`, never the working tree. This is the direct
 * quantity the guard was missing (硬规则 4b). The default goes through the same injectable git surface
 * the rest of the analysis layer uses; an injected reader lets the suite drive the criterion with no git.
 * An unreadable blob returns `null` — fail-closed: "could not read the file" must never be reported in
 * the same shape as "the file proves the symbol" (硬规则 3b).
 *
 * The object TYPE is checked first (`git cat-file -t`, the same two-step the executor's own `read_file`
 * uses): `git show <commit>:<dir>` SUCCEEDS and prints a TREE LISTING, so without this a directory would
 * be read as source text and would "prove" that it declares no exports — "not a file" wearing the shape
 * of "a file with nothing in it".
 */
export function defaultReadFileAtCommit(root, spec) {
  const deps = defaultDeps(root);
  const t = deps.gitMaybe(["cat-file", "-t", spec]);
  if (t.code !== 0 || t.out.trim() !== "blob") return null;
  const r = deps.gitMaybe(["show", spec]);
  return r.code === 0 && typeof r.out === "string" ? r.out : null;
}

/**
 * Does the LOCKED COMMIT resolve in this tree AT ALL (`git rev-parse --verify <commit>^{commit}`)?
 *
 * This is the difference between the two ways the second source can come up empty, and without it they
 * collapse: "the commit is readable and this move's file is not in it" is a fixable MOVE defect (the judge
 * should rewrite `file`), while "the commit itself does not resolve here" means the second source is
 * unavailable for the WHOLE session — nothing about any single move's path can be concluded from it. A
 * caller that cannot tell them apart brands every move a broken file path on a root that merely has no git.
 */
export function defaultCommitResolvable(root, commit) {
  if (!isStr(commit, 6)) return false;
  const r = defaultDeps(root).gitMaybe(["rev-parse", "--verify", "--quiet", `${commit}^{commit}`]);
  return r.code === 0 && typeof r.out === "string" && r.out.trim().length > 0;
}

/**
 * The THREE readings a move's declared source can get. Enumerated, never inferred: a vocabulary with no
 * "could not evaluate" value cannot tell "checked, and it is not there" from "never checked" (硬规则 3b),
 * and a vocabulary that cannot say WHY cannot be acted on.
 */
export const SOURCE_STATES = Object.freeze([
  "exports",            // the blob WAS read at the locked commit; `exports` is what it declares
  "source_unreadable",  // the blob could NOT be read AT that commit — the move's `file` is the defect
  "source_unavailable", // the second source cannot be consulted AT ALL for this session (see the reasons)
]);

/** Why a move's declared source is not readable at the LOCKED commit. */
export const SOURCE_UNREADABLE_REASONS = Object.freeze([
  "NO_FILE_DECLARED",      // the move names no `file` at all, so there is no source to read
  "PATH_NOT_NORMALIZABLE", // `file` is not a well-formed in-scope path (absolute, `..`, empty, NUL)
  "BLOB_NOT_AT_COMMIT",    // a well-formed path, but the LOCKED COMMIT holds no readable blob there
]);

/**
 * Why the second source is unavailable for the WHOLE session — a different finding from "this move's file
 * is not in the commit", and conflating them would brand every move a broken path on a tree that merely
 * has no git (`COMMIT_NOT_RESOLVABLE`, see `defaultCommitResolvable`).
 */
export const SOURCE_UNAVAILABLE_REASONS = Object.freeze([
  "SECOND_SOURCE_NOT_CONFIGURED", // no reader / no scope_root / no commit was supplied at all
  "COMMIT_NOT_RESOLVABLE",        // the locked commit does not resolve in this tree
]);

/**
 * THREE-STATE readability of every move's declared source — one entry PER MOVE, in order, always.
 *
 * Each entry is `{ file, state, exports: Set<string>, reason: string|null }` with `state` one of
 * `SOURCE_STATES`, and `reason` drawn from the enum that belongs to that state (`null` for `exports`).
 *
 * ⛔ An unreadable or unavailable source is NEVER reported as an empty export set: "read it, it exports
 * nothing", "the commit has no such file", and "there is nothing to read FROM" are three different
 * findings, and the empty set is the shape of the first. Callers that only want the union of proven
 * exports use `declaredExportsForMoves` (the lossy projection) or `symbolExistence`.
 *
 * @param {object} [opts] `{ scopeRoot, commit, readFileAtCommit, commitResolvable }`. `commitResolvable`
 *   (default `true`) lets the caller state the session-level fact the reader cannot see from inside: that
 *   the locked commit does not resolve in this tree at all. `false` ⇒ every entry is `source_unavailable`.
 */
export function declaredSourcesForMoves(moves, { scopeRoot, commit, readFileAtCommit, commitResolvable = true } = {}) {
  const list = moves || [];
  const fileOf = (m) => (isStr(m?.file) ? m.file : null);
  const unusable = typeof readFileAtCommit !== "function" || typeof scopeRoot !== "string" || !isStr(commit, 6);
  if (unusable || commitResolvable === false) {
    const reason = unusable ? "SECOND_SOURCE_NOT_CONFIGURED" : "COMMIT_NOT_RESOLVABLE";
    return list.map((m) => ({ file: fileOf(m), state: "source_unavailable", exports: new Set(), reason }));
  }
  return list.map((m) => {
    const file = fileOf(m);
    if (file === null) return { file, state: "source_unreadable", exports: new Set(), reason: "NO_FILE_DECLARED" };
    const rel = moveSourcePath(scopeRoot, file);
    if (rel === null) return { file, state: "source_unreadable", exports: new Set(), reason: "PATH_NOT_NORMALIZABLE" };
    const source = readFileAtCommit(`${commit}:${rel}`);
    if (typeof source !== "string") return { file, state: "source_unreadable", exports: new Set(), reason: "BLOB_NOT_AT_COMMIT" };
    return { file, state: "exports", exports: declaredExportNames(source), reason: null };
  });
}

/**
 * The lossy Set projection of `declaredSourcesForMoves`, kept for callers that only need the UNION of the
 * exports the moves' files prove (the graph ∪ exports notion of "known"). An entry whose source could not
 * be read contributes NOTHING here — indistinguishable from "read, and it declares no such export" — so any
 * caller that must tell those two apart uses `declaredSourcesForMoves` / `symbolExistence` instead.
 */
export function declaredExportsForMoves(moves, opts = {}) {
  const out = new Map();
  for (const s of declaredSourcesForMoves(moves, opts)) {
    if (s.state !== "exports" || typeof s.file !== "string" || out.has(s.file)) continue;
    out.set(s.file, s.exports);
  }
  return out;
}

/**
 * Partition the revision's symbols that NO graph edge accounts for, by whether the second source could
 * actually be consulted for each of them:
 *
 *   `unknown`           — its move's `file` WAS read at the locked commit and does not declare the name.
 *                         A positive defect in the revision (fabricated or misspelled): the guard's teeth.
 *   `source_unreadable` — its move's source could not be read (no file / bad path / no blob at the commit).
 *                         The name is NOT EVALUATED — never "proved absent" — and the real defect is the
 *                         move's `file`, which the caller records and reports as such.
 *
 * A `source_unavailable` move (and a caller that supplied no usable `sources` at all) degrades to the
 * graph-only reading: its unproven names fall into `unknown`, i.e. exactly the pre-fix criterion, which is
 * strictly narrower than the union. That is the only honest reading when nothing can be read — and it is
 * the fail-closed direction (an unproven name is still rejected), so it can never widen what is accepted.
 */
function partitionSymbols(graph, moves, sources) {
  const known = graphSymbols(graph);
  const list = moves || [];
  // Entries are one-per-move in order; a caller-supplied array of a different shape is not trusted to line
  // up, and falls back to `null` — graph-only, the fail-closed direction — rather than pairing a symbol
  // with some other move's source reading.
  const aligned = Array.isArray(sources) && sources.length === list.length ? sources : null;
  const unknown = new Set();
  const unreadable = [];
  list.forEach((m, i) => {
    const src = aligned ? aligned[i] : null;
    const provable = !!(src && src.state === "exports");
    const unevaluable = [];
    for (const s of m?.symbols || []) {
      if (typeof s !== "string" || known.has(s)) continue;          // a graph edge imports it: accounted for
      if (provable) { if (!src.exports.has(s)) unknown.add(s); continue; }
      if (src && src.state === "source_unreadable") { unevaluable.push(s); continue; }
      unknown.add(s);                                              // source_unavailable ⇒ graph-only reading
    }
    if (!unevaluable.length) return;
    const seen = unreadable.find((u) => u.file === src.file && u.reason === src.reason);
    if (seen) seen.symbols.push(...unevaluable);
    else unreadable.push({ file: src.file, reason: src.reason, symbols: [...unevaluable] });
  });
  return {
    unknown: [...unknown].sort(),
    source_unreadable: unreadable.map((u) => ({ ...u, symbols: [...new Set(u.symbols)].sort() })),
  };
}

/**
 * The two-state partition over the graph and each move's own file AT THE LOCKED COMMIT.
 * @param {object} [opts] `{ scopeRoot, commit, readFileAtCommit }` — the second, direct source. Omitted or
 *                        unavailable ⇒ graph-only, i.e. exactly the pre-fix reading (no silent widening).
 */
export function symbolExistence(graph, moves, opts = {}) {
  return partitionSymbols(graph, moves, declaredSourcesForMoves(moves, opts));
}

/**
 * Names a revision carries that NO direct source accounts for — the UNION of the two partitions above. A
 * symbol EXISTS when some graph edge imports it **or** the move's own file declares it at the LOCKED commit.
 * An unknown symbol is NOT "in the graph but uncovered": the revision is invalid and must not be able to
 * produce a computed delta.
 *
 * ⚠️ This is the flat "not proved" view; it deliberately does not say WHY. Use `symbolExistence` whenever
 * "could not evaluate" must be told apart from "evaluated and absent" (硬规则 3b).
 */
export function unknownSymbols(graph, moves, opts = {}) {
  const ex = symbolExistence(graph, moves, opts);
  return [...new Set([...ex.unknown, ...ex.source_unreadable.flatMap((e) => e.symbols)])].sort();
}

/**
 * Edges into a moved-from dir whose imported-name set is only PARTIALLY covered by the moved symbols
 * (some names move, some do not). Mirrors the primitive's own coverage rule over the SAME graph: a fully
 * uncovered edge is a different edge the cut does not touch; a partially covered one means the cut is
 * incomplete — the "missing consumer" trap. Derived here so a formally-computing delta cannot be read as
 * success when a real consumer is left dangling.
 */
export function coverageGaps(graph, moves) {
  const movedFrom = new Map();
  for (const m of moves || []) {
    if (!m || typeof m.from !== "string") continue;
    const set = movedFrom.get(m.from) || new Set();
    for (const s of m.symbols || []) set.add(s);
    movedFrom.set(m.from, set);
  }
  const gaps = [];
  for (const [from, syms] of movedFrom) {
    for (const e of graph?.edges || []) {
      if (e?.to !== from || e?.from === from) continue;
      const names = e.importedNames || [];
      if (!names.length) continue;
      const uncovered = names.filter((n) => !syms.has(n));
      if (uncovered.length && uncovered.length < names.length) gaps.push({ edge: `${e.from} -> ${e.to}`, uncovered, covered: names.filter((n) => syms.has(n)) });
    }
  }
  return gaps;
}

/**
 * The directory feedback the repair may feed the judge. Per the ArchGuard liaison's correction, the legal
 * directory list MUST come from the SAME graph data the original investigation round already held — it is
 * NOT recomputed with an independent find/grep (whose notion of "a directory that exists" can disagree
 * with ArchGuard's notion of "an internal node"). Returns the recorded list verbatim, or `null` when the
 * record carries none (in which case the repair must abstain, never go look it up itself).
 */
export function recordedLegalDirs(candidateRecord) {
  const v = candidateRecord?.slice_delta?.detail?.valid_dirs;
  if (!isArr(v) || v.length === 0 || !v.every((x) => typeof x === "string")) return null;
  return [...v];
}

// ── lock + budget guards ────────────────────────────────────────────────────────────────────────
export class RepairLockError extends Error {
  constructor(code, message) { super(message); this.name = "RepairLockError"; this.code = code; }
}

/** The identity a repair session is locked to: the commit it investigated and the root of its cut's scope. */
export function repairLockIdentity(candidateRecord) {
  const commit = candidateRecord?.commit ?? candidateRecord?.slice_delta?.provenance?.ref_commit ?? null;
  const scope = candidateRecord?.slice_delta?.provenance?.scope_root ?? candidateRecord?.proposed_slice?.scope_root ?? null;
  return { commit: typeof commit === "string" ? commit : null, scope_root: typeof scope === "string" ? scope : null };
}

/**
 * Resolve the lock, refusing (throwing) if a caller tries to change either value, and refusing if the
 * record cannot supply them. A repair session never silently runs against a different commit or scope.
 */
export function resolveRepairLock(candidateRecord, overrides = {}) {
  const id = repairLockIdentity(candidateRecord);
  if (!isStr(id.commit, 6)) throw new RepairLockError("LOCK_COMMIT_MISSING", "the record carries no ref_commit to lock");
  if (typeof id.scope_root !== "string") throw new RepairLockError("LOCK_SCOPE_MISSING", "the record carries no scope_root to lock");
  if (overrides.lockedCommit !== undefined && overrides.lockedCommit !== id.commit) throw new RepairLockError("LOCK_COMMIT_TAMPERED", `lockedCommit ${JSON.stringify(overrides.lockedCommit)} disagrees with the record's ${JSON.stringify(id.commit)}`);
  if (overrides.lockedScope !== undefined && overrides.lockedScope !== id.scope_root) throw new RepairLockError("LOCK_SCOPE_TAMPERED", `lockedScope ${JSON.stringify(overrides.lockedScope)} disagrees with the record's ${JSON.stringify(id.scope_root)}`);
  return { commit: id.commit, scope_root: id.scope_root };
}

/** Enforce the four hard bounds. A caller may LOWER them; raising any one is refused (throws). */
export function assertRepairBudget({ maxRounds = REPAIR_LIMITS.maxRounds, maxWallClockMs = REPAIR_LIMITS.maxWallClockMs, maxJudgeCalls = REPAIR_LIMITS.maxJudgeCalls } = {}) {
  const bad = [];
  if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > REPAIR_LIMITS.maxRounds) bad.push(`maxRounds=${maxRounds}`);
  if (!Number.isFinite(maxWallClockMs) || maxWallClockMs < 1 || maxWallClockMs > REPAIR_LIMITS.maxWallClockMs) bad.push(`maxWallClockMs=${maxWallClockMs}`);
  if (!Number.isInteger(maxJudgeCalls) || maxJudgeCalls < 1 || maxJudgeCalls > REPAIR_LIMITS.maxJudgeCalls) bad.push(`maxJudgeCalls=${maxJudgeCalls}`);
  if (bad.length) throw new RangeError(`REPAIR_BUDGET_OVER_LIMIT:${bad.join(",")} — hard caps are rounds<=${REPAIR_LIMITS.maxRounds}, wall<=${REPAIR_LIMITS.maxWallClockMs}ms, judgeCalls<=${REPAIR_LIMITS.maxJudgeCalls}; a caller may only lower them`);
  return { maxRounds, maxWallClockMs, maxJudgeCalls };
}

// ── the judge-facing feedback + prompt (facts only — no historical answer, no holdout) ──────────
/**
 * Build the STRUCTURED facts fed to the tool-less repair judge. Pure; contains no "correct answer".
 * `declaredSymbols` are the LOCKED-COMMIT exports of the files the current moves name — without them the
 * prompt would tell the judge that real exports "the graph does not know" are not fixes, which is the very
 * mislabelling this module was fixed to stop (a fact the judge is shown must be as direct as the guard).
 * `unreadableSources` is the complementary fact: the moves whose `file` could NOT be read at the locked
 * commit. Those names are not "unknown" — they were never evaluated — and the judge is told to repair the
 * PATH, not the symbol.
 */
export function buildRepairFeedback({ graph, legalDirs, sliceDelta, moves, hypothesis, concernKey, attemptNo = 1, scopeRoot = "", subject = "", declaredSymbols = [], unreadableSources = [] }) {
  return {
    attempt_no: attemptNo,
    concern_key: concernKey ?? null,
    original_hypothesis: hypothesis ?? null,
    rejection: { status: sliceDelta?.status ?? null, reason: sliceDelta?.reason ?? null },
    locked: { scope_root: scopeRoot, subject },
    // Legal directories come from the ORIGINAL round's ArchGuard graph data — never a fresh find/grep.
    legal_dirs: Array.isArray(legalDirs) ? legalDirs : internalNodeIds(graph),
    uncovered_symbols: isArr(moves) ? coverageGaps(graph, moves) : [],
    known_symbols: [...new Set([...graphSymbols(graph), ...(isArr(declaredSymbols) ? declaredSymbols : [])])].sort(),
    // Moves whose declared `file` does not exist (or is not a readable blob) at the LOCKED commit. A name
    // carried by one of these moves is NOT EVALUATED: the guard never read a file that would prove or
    // disprove it, so it must not be reported to the judge as unknown (硬规则 3b).
    unreadable_move_sources: (isArr(unreadableSources) ? unreadableSources : []).map((s) => ({ file: s?.file ?? null, reason: s?.reason ?? null })),
  };
}

/** Render the feedback as a bounded prompt block. Capped at the per-round evidence budget (never widened). */
export function renderRepairPrompt({ feedback, maxBytes = REPAIR_LIMITS.maxEvidenceBytesPerRound }) {
  const body = `You are REPAIRING a refactor cut that ArchGuard's slice-delta primitive REFUSED. You have NO tools.
Only the cut's \`moves\` may change. \`scope_root\` and \`subject\` are LOCKED (below) — returning a different value is refused.
Every \`from\`/\`to\` MUST be one of \`legal_dirs\`. Every symbol MUST appear in \`known_symbols\` (a symbol the graph does not know is not a fix).
EXCEPTION: a symbol is exempt from that requirement when its move's \`file\` appears in \`unreadable_move_sources\` — such a
\`file\` does not exist (or is not a readable blob) at the LOCKED commit, so NO export can be proved from it. Its symbols are
NOT EVALUATED, not unknown. Fix that move's \`file\` to a path that exists at the locked commit; do NOT rewrite its symbols.
Repair the cut so it explains the refused edge(s); do not invent directories, do not name symbols the graph does not contain.

Return exactly ONE JSON object, no prose:
{
  "action": "revise" | "abstain",
  "moves": [ { "file": "<path rel. scope_root>", "from": "<dir rel. scope_root>", "to": "<dir rel. scope_root>", "symbols": ["<names that move>"] } ],
  "why": "<one sentence>"
}

## LOCKED
${JSON.stringify({ scope_root: feedback.locked.scope_root, subject: feedback.locked.subject })}

## STRUCTURAL FACTS (from the same ArchGuard graph the cut was judged against)
${JSON.stringify(feedback, null, 1)}`;
  // Cap by BYTES, not code units — the block contains multi-byte punctuation, so a char-count slice can overshoot.
  let text = body;
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    text = body.slice(0, maxBytes);
    while (Buffer.byteLength(text, "utf8") > maxBytes) text = text.slice(0, -1);
  }
  return { prompt: text, bytes: Buffer.byteLength(text, "utf8"), truncated: text.length < body.length };
}

/** Fail-closed parse of a repair revision. Unreadable => null (never a half-formed revision). */
export function parseRepairRevision(stdout) {
  if (typeof stdout !== "string" || !stdout.trim()) return null;
  const cands = [];
  const fenced = [...stdout.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  cands.push(...fenced);
  const first = stdout.indexOf("{"), last = stdout.lastIndexOf("}");
  if (first >= 0 && last > first) cands.push(stdout.slice(first, last + 1));
  cands.push(stdout);
  for (const c of cands) {
    try {
      const o = JSON.parse(c.trim());
      if (!isObj(o) || typeof o.action !== "string") continue;
      if (o.action === "abstain") return { action: "abstain", why: String(o.why ?? "").slice(0, 400), moves: null };
      if (o.action !== "revise") continue;
      if (!isArr(o.moves) || o.moves.length === 0) continue;
      const moves = o.moves.filter((m) => isObj(m) && typeof m.file === "string" && typeof m.from === "string" && typeof m.to === "string" && isArr(m.symbols) && m.symbols.every((s) => typeof s === "string"));
      if (!moves.length) continue;
      return { action: "revise", moves, why: String(o.why ?? "").slice(0, 400), scope_root: typeof o.scope_root === "string" ? o.scope_root : undefined };
    } catch { /* next candidate */ }
  }
  return null;
}

/** The primitive's own success shape — computed, guards clean, control falsified, and the cycle actually shrank. */
export function isPositiveDelta(delta) {
  if (!isObj(delta) || delta.status !== "evaluated") return false;
  if ((delta.guards?.violations?.length ?? 0) !== 0) return false;
  if (delta.negative_control?.falsified !== true) return false;
  const before = delta.delta?.before?.scc_size, after = delta.delta?.after?.scc_size;
  return Number.isFinite(before) && Number.isFinite(after) && after < before;
}

/**
 * Bounded proposal-repair. Attempts at most `maxRounds` judge revisions against the SAME locked
 * commit+scope, re-running the primitive each time; if none produces a positive delta (and no missing
 * consumer / fabricated symbol was accepted), it abstains honestly.
 *
 * @param {object} o
 * @param {object} o.candidateRecord the carrier record whose `slice_delta` was refused (needs `commit`,
 *                                   `proposed_slice` with the refused `moves`, and `slice_delta`)
 * @param {string} o.root            tree the primitive is re-run against
 * @param {function} o.invokeJudge   async (prompt) => {stdout,status,error} — the SAME tool-less seam the loop uses
 * @param {object} [o.deps]          { graph, getGraph, computeDelta, sliceDeps, lockedCommit, lockedScope, evidenceStore, storeRoot, now }
 */
export async function attemptRepair({ candidateRecord, root, invokeJudge, maxRounds, maxWallClockMs, maxJudgeCalls, deps = {}, now, onRound = () => {} }) {
  const clock = now || deps.now || Date.now;
  const budget = assertRepairBudget({ maxRounds, maxWallClockMs, maxJudgeCalls });      // throws if raised above the caps
  const lock = resolveRepairLock(candidateRecord, { lockedCommit: deps.lockedCommit, lockedScope: deps.lockedScope });
  const first = classifyRejection(candidateRecord?.slice_delta);
  const proposed = candidateRecord?.proposed_slice || {};
  const hypothesis = candidateRecord?.hypothesis ?? candidateRecord?.envelope?.concern ?? null;
  const concernKey = candidateRecord?.concern_key ?? null;
  const t0 = clock();
  const attempts = [];

  const record = (a) => {
    const rec = {
      contract_version: REPAIR_VERSION, attempt_no: a.attempt_no, bucket: a.bucket,
      locked_commit: lock.commit, locked_scope: lock.scope_root, original_hypothesis: hypothesis ?? null,
      concern_key: concernKey, class: a.class ?? null, matched: a.matched ?? null, judge_called: !!a.judge_called,
      computed: a.computed ?? null, coverage_gaps: a.coverage_gaps ?? [], unknown_symbols: a.unknown_symbols ?? [],
      judge_why: a.judge_why ?? null, elapsed_ms: clock() - t0,
      source_unreadable: a.source_unreadable ?? [],
    };
    attempts.push(rec);
    if (deps.evidenceStore) appendRepairAttemptRecord(deps.storeRoot ?? root, storeRecord(rec));
    onRound(rec);
    return rec;
  };
  let lastClass = first.class;
  const result = (outcome, reason, extra = {}) => ({
    contract_version: REPAIR_VERSION, outcome, reason, class: extra.class !== undefined ? extra.class : lastClass,
    original_class: first.class, original_matched: first.matched, locked: lock,
    rounds: attempts.filter((a) => a.judge_called).length, judge_calls: attempts.filter((a) => a.judge_called).length,
    wall_clock_ms: clock() - t0, attempts, repaired_delta: extra.repaired_delta ?? null,
  });

  if (!first.is_rejection) return result("not-a-rejection", `not a rejection: status=${first.status}`);
  // tool_limitation / honest_abstain terminate immediately with ZERO judge calls (硬规则 3b: an unparsable
  // rejection is not "repairable", and a capability boundary cannot be fixed by revising the cut).
  if (!REPAIRABLE_CLASSES.includes(first.class)) {
    record({ attempt_no: 0, bucket: first.class, matched: first.matched, judge_called: false });
    return result("abstained", `terminal-by-classification:${first.class}`);
  }
  // The directory feedback must come from the ORIGINAL round's graph data. If the record carries none, the
  // module does NOT go compute its own (the liaison's correction) — it abstains as evidence-insufficient.
  const legalDirs = recordedLegalDirs(candidateRecord);
  if (!legalDirs) {
    record({ attempt_no: 0, bucket: "honest_abstain", matched: "NO_RECORDED_LEGAL_DIRS", judge_called: false });
    return result("abstained", "no recorded legal-dir list in the original evidence; refusing to recompute one independently");
  }
  const graph = deps.graph ?? (deps.getGraph ? deps.getGraph(lock.scope_root) : null);
  if (!graph) {
    record({ attempt_no: 0, bucket: "honest_abstain", matched: "NO_GRAPH_DATA", judge_called: false });
    return result("abstained", "no ArchGuard graph data available to check symbol coverage against");
  }
  const computeDelta = deps.computeDelta || (({ proposal }) => computeSliceDelta({ root, commit: lock.commit, proposal, deps: deps.sliceDeps || {}, now: () => new Date(clock()).toISOString() }));
  // The direct source of symbol existence: the round's own files read AT THE LOCKED COMMIT (硬规则 4b).
  // `deps.readFileAtCommit(root, spec)` is injectable; the default is a commit-scoped `git show`.
  const readFileAtCommit = typeof deps.readFileAtCommit === "function"
    ? (spec) => deps.readFileAtCommit(root, spec)
    : (spec) => defaultReadFileAtCommit(root, spec);
  // The second source can only be consulted when the LOCKED COMMIT resolves in this tree AT ALL. Otherwise
  // the session has nothing to read from and the guard keeps its graph-only reading — the pre-fix
  // criterion, strictly narrower — instead of concluding from a bare root that every move's file is missing.
  const commitResolvable = typeof deps.commitResolvable === "function"
    ? !!deps.commitResolvable(root, lock.commit)
    : defaultCommitResolvable(root, lock.commit);
  const symbolOpts = { scopeRoot: lock.scope_root, commit: lock.commit, readFileAtCommit, commitResolvable };

  let current = candidateRecord.slice_delta, moves = proposed.moves || [];
  let round = 0;
  while (round < budget.maxRounds && attempts.filter((a) => a.judge_called).length < budget.maxJudgeCalls) {
    if (clock() - t0 > budget.maxWallClockMs) {
      record({ attempt_no: round, bucket: "honest_abstain", matched: "WALL_CLOCK_EXHAUSTED", judge_called: false, class: "honest_abstain" });
      return result("abstained", "wall-clock ceiling reached");
    }
    round++;
    // The judge is shown the same two-source notion of "known" the guard enforces — a real export nobody
    // imports across a directory edge is a legitimate move, and the prompt must not say otherwise. The
    // complementary fact travels with it: which moves' `file` could not be read at the locked commit, so
    // the judge is not told their symbols are unknown when nothing about those files could be evaluated.
    const sources = declaredSourcesForMoves(moves, symbolOpts);
    const declaredNow = sources.filter((s) => s.state === "exports").flatMap((s) => [...s.exports]);
    const unreadableNow = sources.filter((s) => s.state === "source_unreadable").map((s) => ({ file: s.file, reason: s.reason }));
    const feedback = buildRepairFeedback({ graph, legalDirs, sliceDelta: current, moves, hypothesis, concernKey, attemptNo: round, scopeRoot: lock.scope_root, subject: proposed.subject ?? lock.scope_root, declaredSymbols: declaredNow, unreadableSources: unreadableNow });
    const rendered = renderRepairPrompt({ feedback });
    const r = await invokeJudge(rendered.prompt);
    if (!r || r.error || (typeof r.status === "number" && r.status !== 0)) {
      record({ attempt_no: round, bucket: "honest_abstain", matched: "JUDGE_UNAVAILABLE", judge_called: true, class: "honest_abstain" });
      return result("abstained", `judge unavailable: ${r?.error?.message || `exit ${r?.status}`}`);
    }
    const rev = parseRepairRevision(r.stdout);
    if (!rev) { record({ attempt_no: round, bucket: "honest_abstain", matched: "REVISION_UNPARSABLE", judge_called: true, class: "honest_abstain" }); return result("abstained", "repair revision was unreadable"); }
    if (rev.action === "abstain") { record({ attempt_no: round, bucket: "honest_abstain", matched: "JUDGE_ABSTAINED", judge_called: true, judge_why: rev.why, class: "honest_abstain" }); return result("abstained", `judge abstained: ${rev.why}`); }
    // LOCK: a revision that tries to move the scope is a tampering of the locked value — refused, not retried.
    if (rev.scope_root !== undefined && rev.scope_root !== lock.scope_root) throw new RepairLockError("LOCK_SCOPE_TAMPERED", `the repair revision tried to change the locked scope_root to ${JSON.stringify(rev.scope_root)}`);
    moves = rev.moves;
    // A symbol NEITHER source can account for (no graph edge imports it AND the locked commit does not
    // export it from the move's own file) is NOT "in the graph but uncovered": the revision is invalid, the
    // round is consumed, and NO delta is computed for it (a formally-passing stub result must never be reached).
    //
    // The two ways a name can be unaccounted-for get their OWN records (硬规则 3b). A name the move's file
    // WAS read for and does not declare is positively unknown; a name whose move's file could NOT be read
    // is NOT EVALUATED, and the recorded defect is the move's `file` — not the symbol. Both void the round
    // and compute no delta; only the reason changes, so the guard is exactly as strict as before.
    //
    // `unknown` is checked FIRST when both are present: it is the CONCLUSIVE finding (the file was read and
    // disproves the name), and a genuine fabrication must not be masked behind an unrelated path typo. The
    // unreadable sources still travel in the same round's record and prompt.
    // ⛔ The sources are read for the REVISED moves (above they were read for the moves the JUDGE was shown,
    // which are the previous round's): reusing the pre-revision entries for a revision of a different shape
    // would silently fall back to graph-only and mislabel an unreadable file as a fabricated symbol.
    const existence = partitionSymbols(graph, moves, declaredSourcesForMoves(moves, symbolOpts));
    if (existence.unknown.length) { record({ attempt_no: round, bucket: "unknown_symbol", matched: "UNKNOWN_SYMBOL", judge_called: true, unknown_symbols: existence.unknown, source_unreadable: existence.source_unreadable, computed: false }); continue; }
    if (existence.source_unreadable.length) { record({ attempt_no: round, bucket: "source_unreadable", matched: "MOVE_SOURCE_NOT_AT_COMMIT", judge_called: true, source_unreadable: existence.source_unreadable, computed: false }); continue; }
    const gaps = coverageGaps(graph, moves);
    // The revised cut is expressed as a proposal the adapter understands: only `moves` may differ, scope+subject stay locked.
    const proposal = { concern: candidateRecord.envelope?.concern ?? proposed.concern ?? "", slice: { scope_root: lock.scope_root, subject: proposed.subject ?? lock.scope_root, moves, ...(isArr(proposed.consumers) ? { consumers: proposed.consumers } : {}) } };
    const next = await computeDelta({ root, commit: lock.commit, proposal });
    const cls = classifyRejection(next);
    if (isPositiveDelta(next) && gaps.length === 0) {
      record({ attempt_no: round, bucket: "repaired", matched: "POSITIVE_DELTA", judge_called: true, judge_why: rev.why, computed: next.status, coverage_gaps: gaps });
      return result("repaired", "a delta that passes the primitive's negative control was computed", { class: null, repaired_delta: next });
    }
    // A positive delta with a missing consumer is NOT success — the round stays unsolved.
    const bucket = gaps.length ? "invalid_move" : (cls.class ?? "honest_abstain");
    record({ attempt_no: round, bucket, matched: gaps.length ? "MISSING_CONSUMER" : cls.matched, judge_called: true, computed: next.status ?? null, coverage_gaps: gaps, class: bucket });
    current = next; lastClass = cls.class ?? "honest_abstain";
    if (!REPAIRABLE_CLASSES.includes(bucket)) break;   // the re-classified rejection is not repairable
  }
  return result("abstained", `bounded budget exhausted without a positive delta (rounds=${round})`);
}

/** Build the store record for one attempt (the shape `appendRepairAttemptRecord` validates). */
function storeRecord(rec) {
  const body = JSON.stringify({ attempt_no: rec.attempt_no, bucket: rec.bucket, matched: rec.matched, computed: rec.computed, coverage_gaps: rec.coverage_gaps, unknown_symbols: rec.unknown_symbols, source_unreadable: rec.source_unreadable });
  return {
    tool: "ownership-active-proposal-repair", ref: rec.locked_commit, ts: new Date().toISOString(), sha256: sha(body),
    attempt_no: rec.attempt_no, bucket: rec.bucket, locked_commit: rec.locked_commit, locked_scope: rec.locked_scope,
    original_hypothesis: rec.original_hypothesis ?? "none established", elapsed_ms: rec.elapsed_ms,
    matched: rec.matched, judge_called: rec.judge_called, class: rec.class,
  };
}
