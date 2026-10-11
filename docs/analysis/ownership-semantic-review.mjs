#!/usr/bin/env node
// ownership SEMANTIC REVIEW of a proposed_slice — an INDEPENDENT domain-ownership review layer.
//
// WHY THIS EXISTS (task gap-ownership-semantic-review-of-proposed-slice). The admission gate
// (`ownership-active-limited-proposal.mjs`) judges four STRUCTURAL conditions: the concern kind, a
// computed/falsifiable/provenance-matched delta, the decision memory, and a 3-run streak. None of them
// judges DOMAIN OWNERSHIP. On 2026-10-11 three independent blind runs converged on
// `gate/config/loader.ts -> gate` — a cut that is structurally clean (4→3, negative control falsified,
// provenance match) and ownership-wrong (the loader's workspace-root discovery / gate-config reading is
// config loading, not generic primitives). Today the human is the only defence.
//
// This module adds ONE review layer, and it is ADVISORY ONLY. It changes NO admission judgement, no
// streak, and creates/activates nothing — `ownership-active-limited-proposal.mjs --review` prints it
// beside the (byte-identical) entry verdict and, only under the pre-existing `--write`, attaches it to a
// draft Goal a human still has to rule on.
//
// THREE PHYSICAL PARTITIONS (borrowed from archguard `arch-layer-review`'s discipline, but that skill is
// post-change / human-driven / reads the proposal doc and a layers.yml draft; this is pre-change /
// automatic / zero-document / does not read layers.yml — they are not duplicates):
//
//   1. EVIDENCE ASSEMBLY  `assembleOwnershipEvidence`  — deterministic, COMMIT-LOCKED (`git show`/`git grep`
//      at a pinned commit; the working tree is never read). Every reading is an `{id, kind, locator, sha256}`
//      record. All text handed to the judge passes through `redactDecisionReferences`. Paths pass the shared
//      deny-list. Total bytes are capped and every truncation is recorded. The bundle carries NO
//      scc/cycle/delta field AT ALL — ring shrinkage is ArchGuard's judgement, ownership is this layer's, and
//      neither may stand in for the other.
//   2. MECHANICAL FACTS   `ownershipFacts`             — deterministic, NO LLM. Import-direction facts only:
//      the target directory's observed boundary (ArchGuard graph ∪ Quay's own source parse, with the
//      disagreement NAMED, never unioned silently), boundary violations, dependencies that transfer owner,
//      I/O pulled into a pure directory, source hollowing, caller locality. These are FACTS, not verdicts.
//      The partition is deliberate: "the edges point this way" is OWNERSHIP evidence and goes to the judge;
//      "the ring shrank" is a STRUCTURAL conclusion and does not. The prohibition is on substituting ring
//      shrinkage for an ownership judgement, not on letting the judge see dependency direction.
//   3. BLIND JUDGE        `reviewOwnership`             — an injected, tool-less launcher; its input is the
//      bundle and the facts, nothing else. Every citation is checked back against the bundle
//      (`UNGROUNDED_CITATION` ⇒ that move is `not-evaluated`), an unparseable reply is `not-evaluated`
//      (which is NOT `abstain`), and a move carrying a mechanical boundary violation may only say `review`
//      if it actually ANSWERS the violation in `counter_evidence_refs`.
//
// ⛔ WHAT THIS MODULE MUST NEVER DO (pinned by plugin/test/ownership-semantic-review.test.mjs):
//    never write a goal/task, never activate anything, never touch the admission judgement, never read a
//    GOAL body for review input, never read or write docs/layers.yml.

import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  DEFAULT_BUDGET, DENY_PATH_PATTERNS, REDACTED_COMMENT, commentBlockRanges, redactDecisionReferences,
  redactedCommentBlockRanges,
} from "./ownership-active-contract.mjs";
import { extractImports, resolveSpecifier } from "../../plugin/scripts/import-graph-check.ts";

export const REVIEW_VERSION = "ownership-semantic-review/1";

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const isStr = (x, n = 1) => typeof x === "string" && x.trim().length >= n;

// ── vocabularies (every one has a "could not read it" member — 硬规则 3b) ────────────────────────────
export const RECOMMENDATIONS = Object.freeze(["review", "reject", "abstain"]);
/** NOT a member of RECOMMENDATIONS on purpose: "the judge never produced a usable verdict for this move"
 *  must not be spelled the same way as "the judge read the evidence and abstained" (硬规则 3b/6). */
export const NOT_EVALUATED = "not-evaluated";
export const CONFIDENCE_LEVELS = Object.freeze(["low", "medium", "high"]);
/** Target-boundary provenance agreement. `not-evaluated` is the no-graph state — it is never `agree`. */
export const BOUNDARY_AGREEMENT = Object.freeze(["agree", "graph_missing_edges", "parse_missing_edges", "both_differ", "not-evaluated"]);

/**
 * The holdout vocabulary the leak audit greps for (AC6). These are the terms by which a bundle would hand
 * the investigator the answer it is meant to REDISCOVER from source: the goal id that ruled on the cut, the
 * ruling's own language, and the shape of the rejected wide move.
 */
export const HOLDOUT_VOCABULARY = Object.freeze(["GOAL-034", "ownership-wrong", "宽移动", "Holdout B", "not config-loading"]);

/**
 * Key-name tokens that must NEVER appear anywhere in a bundle. A bundle is not allowed to carry a ring
 * reading under any name: the structural result (does the SCC shrink?) is ArchGuard's, and putting it in
 * front of the ownership judge invites exactly the substitution this layer exists to prevent (AC1).
 * Matched on lowercased key names, so `sccLeft`, `slice_delta` and `cycles` are all caught.
 */
export const STRUCTURAL_KEY_TOKENS = Object.freeze(["scc", "cycle", "delta"]);

/** Modules whose import means "this file does I/O". Pulling one into a directory that has none is a fact. */
export const IO_MODULES = Object.freeze([
  "node:fs", "node:fs/promises", "fs", "fs/promises",
  "node:child_process", "child_process",
  "node:net", "net", "node:http", "http", "node:https", "https",
  "node:os", "node:worker_threads", "yaml",
]);

/** Per-evidence-kind byte caps. Bounded so one chatty file cannot crowd the rest out of the total budget. */
export const KIND_CAPS = Object.freeze({
  symbol_declaration: 2_000,
  source_imports: 2_500,
  callers: 3_500,
  source_dir_remaining: 2_500,
  target_charter: 2_500,
  dir_imports: 3_000,
  dir_inventory: 1_500,
  moving_files: 1_500,
});

// ── tiny path helpers (POSIX, repo-relative, never absolute) ────────────────────────────────────────
const NORM = (p) => String(p ?? "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
const dirOf = (p) => { const n = NORM(p); const i = n.lastIndexOf("/"); return i < 0 ? "" : n.slice(0, i); };
const joinRel = (...parts) => parts.filter((x) => x !== "" && x !== undefined && x !== null).join("/").replace(/\/+/g, "/");
/** A directory id (ArchGuard node id: relative to the scope root, `""` = the scope root itself) -> repo path. */
export const dirRepoPath = (scopeRoot, dir) => joinRel(NORM(scopeRoot), NORM(dir));
/** A repo path -> its directory id relative to `scopeRoot`, or null when it lies outside the scope. */
export function scopeDirId(scopeRoot, repoPath) {
  const scope = NORM(scopeRoot);
  const p = NORM(repoPath);
  if (scope && p !== scope && !p.startsWith(`${scope}/`)) return null;
  const rel = scope ? p.slice(scope.length).replace(/^\//, "") : p;
  return dirOf(rel);
}

/** The shared deny-list, applied to a repo-relative path. Returns `{ok, path|reason}` — never a boolean. */
export function admitPath(repoPath) {
  if (!isStr(repoPath, 1)) return { ok: false, reason: "PATH_EMPTY" };
  if (DENY_PATH_PATTERNS.some((re) => re.test(repoPath))) return { ok: false, reason: "PATH_DENIED" };
  return { ok: true, path: repoPath };
}

// ── 1. EVIDENCE ASSEMBLY ────────────────────────────────────────────────────────────────────────────

const defaultGit = (root) => (args) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 60_000 });

/** Clip to a UTF-8 byte budget, reporting the drop (never silently — 硬规则 3b). */
export function clipToBytes(text, max) {
  const total = Buffer.byteLength(text, "utf8");
  if (total <= max) return { text, truncated: false, dropped_bytes: 0, total_bytes: total };
  let s = text;
  while (Buffer.byteLength(s, "utf8") > max) s = s.slice(0, -Math.max(1, Math.ceil((Buffer.byteLength(s, "utf8") - max) / 3)));
  return { text: s, truncated: true, dropped_bytes: total - Buffer.byteLength(s, "utf8"), total_bytes: total };
}

/** A declaration line for `symbol`, anchored at the line START (a mention inside a call is not a declaration). */
const declRe = (sym) => new RegExp(`^(export\\s+)?(declare\\s+)?(default\\s+)?(async\\s+)?(abstract\\s+)?(function|const|let|var|class|interface|type|enum)\\s+${sym}\\b`);
/** A re-export / barrel form: `export { … symbol … }` or `export { a as symbol }`. */
const reExportRe = (sym) => new RegExp(`^export\\s+(type\\s+)?\\{[^}]*\\b${sym}\\b[^}]*\\}`);

/**
 * The declaration block of `symbol` in raw `lines`: from the anchored declaration line to the first line
 * that closes it (`}` at column 0) or `maxLines`, whichever comes first. Returns null when the file does
 * not declare the symbol at a line START — an import or a call is not a declaration.
 */
export function declarationBlock(lines, symbol, maxLines = 14) {
  for (let i = 0; i < lines.length; i++) {
    if (!declRe(symbol).test(lines[i]) && !reExportRe(symbol).test(lines[i])) continue;
    const end = Math.min(lines.length - 1, i + maxLines - 1);
    let last = i;
    for (let j = i; j <= end; j++) { last = j; if (j > i && /^\}/.test(lines[j])) break; }
    return { start: i + 1, end: last + 1, text: lines.slice(i, last + 1).join("\n") };
  }
  return null;
}

/** Every top-level `export`ed name in raw source — the input to "what would be left after the move". */
export function exportedNames(src) {
  const names = new Set();
  const lines = src.split("\n");
  for (const line of lines) {
    const m = /^export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:abstract\s+)?(?:function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/.exec(line);
    if (m) names.add(m[1]);
    const b = /^export\s+(?:type\s+)?\{([^}]*)\}/.exec(line);
    if (b) for (const part of b[1].split(",")) {
      const t = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop().trim();
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(t)) names.add(t);
    }
    const s = /^export\s+(?:\*|\*\s+as\s+[A-Za-z_$][A-Za-z0-9_$]*)\s+from\s+/.exec(line);
    if (s) names.add("*");
  }
  return [...names].sort();
}

/** Exported names that are TYPES only — a directory left holding these has been hollowed of behaviour. */
export function typeOnlyExportedNames(src) {
  const out = new Set();
  for (const line of src.split("\n")) {
    const m = /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:interface|type)\s+([A-Za-z_$][A-Za-z0-9_$]*)/.exec(line);
    if (m) out.add(m[1]);
    const b = /^export\s+type\s*\{([^}]*)\}/.exec(line);
    if (b) for (const part of b[1].split(",")) {
      const t = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop().trim();
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(t)) out.add(t);
    }
  }
  return [...out];
}

/**
 * The name list of an import/export statement whose text is `stmt`. `*` marks a namespace/star form —
 * deliberately NOT expandable, so a move that does not name what it takes keeps its edge (fail-closed).
 */
export function statementNames(stmt) {
  const s = stmt.replace(/\s+/g, " ").trim();
  const brace = /\{([^}]*)\}/.exec(s);
  if (brace) {
    return brace[1].split(",").map((x) => x.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop().trim()).filter(Boolean);
  }
  if (/^\s*export\s+\*/.test(s) || /\*\s+as\s+[A-Za-z_$]/.test(s)) return ["*"];
  const def = /^\s*import\s+(?:type\s+)?([A-Za-z_$][A-Za-z0-9_$]*)/.exec(s);
  return def ? [def[1]] : [];
}

/** The statement text containing `spec`, assembled from the lines around its `line` (1-based). */
function statementAt(src, line, spec) {
  const lines = src.split("\n");
  let i = Math.max(0, line - 1);
  while (i > 0 && !/^\s*(import|export)\b/.test(lines[i])) i--;       // walk back to the keyword
  let j = i;
  while (j < lines.length && !lines[j].includes(`"${spec}"`) && !lines[j].includes(`'${spec}'`) && j - i < 12) j++;
  return lines.slice(i, j + 1).join(" ");
}

/** Classify a module specifier against the moved file's own directory and the target directory. */
export function classifySpec(spec, fromDir, toDir) {
  if (IO_MODULES.includes(spec)) return "io";
  if (!spec.startsWith(".")) return "third_party";
  const resolved = joinRel(fromDir, spec);
  const norm = resolved.split("/").reduce((acc, seg) => {
    if (seg === "" || seg === ".") return acc;
    if (seg === "..") return acc.slice(0, -1);
    return [...acc, seg];
  }, []);
  const dir = norm.slice(0, -1).join("/");
  if (dir === fromDir) return "same_dir";
  if (dir === toDir) return "target_dir";
  return "cross_dir";
}

/**
 * Assemble the commit-locked evidence bundle for ONE proposed slice.
 *
 * ⛔ Every reading is taken at `commit` (`git show <commit>:<path>`, `git grep <commit> -- …`). The working
 *    tree is never consulted: a bundle that read the working tree would silently describe a different tree
 *    than the one the slice was computed against (硬规则 4b — the proxy must not be substituted for the thing).
 *
 * @param {object} o
 * @param {string} o.root        repo root (git -C target)
 * @param {string} o.commit      the pinned commit (full sha; the caller resolves it)
 * @param {string} o.scopeRoot   repo-relative analysed subtree, e.g. "packages/quay/src"
 * @param {object} o.slice       { subject, moves: [{file, from, to, symbols[]}], … } — file/from/to are
 *                               relative to `scopeRoot`; `from`/`to` are ArchGuard directory ids ("" = root)
 * @param {object} [o.budget]    defaults to DEFAULT_BUDGET (reused, not re-invented)
 * @param {object} [o.deps]      { git, redact } — both injectable so the suite needs no git and can run the
 *                               AC6 positive control with an identity redactor
 */
export function assembleOwnershipEvidence({ root, commit, scopeRoot, slice, budget = DEFAULT_BUDGET, deps = {} }) {
  const git = deps.git || defaultGit(root);
  const redact = deps.redact || redactDecisionReferences;
  const maybe = (args) => { try { return { out: git(args), code: 0, err: "" }; } catch (e) { return { out: String(e.stdout ?? ""), code: typeof e.status === "number" ? e.status : 2, err: String(e.stderr || e.message || "").slice(0, 200) }; } };
  const show = (relPath) => {
    const r = maybe(["show", `${commit}:${relPath}`]);
    return r.code === 0 ? r.out : null;
  };

  const evidence = [];
  const denied = [];
  let counter = 0;

  /** Push one reading. Text is redacted and clipped HERE, so no un-redacted text can reach the bundle. */
  const add = (kind, locator, rawText, extra = {}) => {
    const cap = KIND_CAPS[kind] ?? budget.max_result_bytes;
    const r = redact(String(rawText ?? ""));
    const clipped = clipToBytes(r.text, cap);
    const id = `ev-${++counter}`;
    const rec = {
      id, kind, locator, text: clipped.text, bytes: Buffer.byteLength(clipped.text, "utf8"),
      sha256: sha256(clipped.text), redacted_blocks: r.redacted_blocks, truncated: clipped.truncated,
      ...extra,
    };
    evidence.push(rec);
    return rec;
  };
  /** A path that must never be read. Recorded as a DENIAL, never dropped silently (硬规则 3b). */
  const guard = (repoPath) => {
    const a = admitPath(repoPath);
    if (!a.ok) { denied.push({ path: repoPath, reason: a.reason }); return null; }
    return a.path;
  };

  const moves = (Array.isArray(slice?.moves) ? slice.moves : []).map((m, index) => ({
    index, file: NORM(m.file), from: NORM(m.from), to: NORM(m.to),
    symbols: Array.isArray(m.symbols) ? [...m.symbols] : [],
  }));

  // the analysed subtree's file set at THIS commit — the resolver's node universe
  const treeOut = maybe(["ls-tree", "-r", "--name-only", commit, "--", NORM(scopeRoot) || "."]);
  const treeFiles = (treeOut.code === 0 ? treeOut.out : "").split("\n").map(NORM).filter(Boolean);
  const nodes = new Set(treeFiles);

  const srcCache = new Map();
  const srcAt = (repoPath) => { if (!srcCache.has(repoPath)) srcCache.set(repoPath, show(repoPath)); return srcCache.get(repoPath); };
  /** The decision-reference comment-block ranges of a file at this commit, or `null` when unreadable. */
  const rangesCache = new Map();
  const redactedRangesFor = (repoPath) => {
    if (!rangesCache.has(repoPath)) {
      const t = srcAt(repoPath);
      rangesCache.set(repoPath, t === null ? null : redactedCommentBlockRanges(t.split("\n")));
    }
    return rangesCache.get(repoPath);
  };

  // ── per move ────────────────────────────────────────────────────────────────────────────────────
  for (const mv of moves) {
    const repoFile = joinRel(NORM(scopeRoot), mv.file);
    const fromDir = mv.from;
    const toDir = mv.to;
    const src = guard(repoFile) ? srcAt(repoFile) : null;
    const lines = src === null ? null : src.split("\n");

    // (a) the declaration of each moved symbol — the thing whose owner is in question
    for (const sym of mv.symbols) {
      const block = lines && declarationBlock(lines, sym);
      add("symbol_declaration", `${repoFile}:${block ? `${block.start}-${block.end}` : "not-found"}`,
        block ? block.text : `(no declaration of ${sym} at a line start in ${repoFile} @ ${commit.slice(0, 9)})`,
        { move_index: mv.index, symbol: sym, path: repoFile, range: block ? [block.start, block.end] : null, found: !!block });
    }

    // (b) the moved file's own imports, classified — the raw material of "which edges would change owner"
    const imports = [];
    if (src !== null) {
      for (const im of extractImports(src)) {
        const stmt = statementAt(src, im.line, im.spec);
        // Resolution happens HERE, against the commit's own file list, so the bundle is self-contained and
        // no downstream layer has to re-derive a node universe it cannot see (硬规则 4c: the reading has to
        // survive every layer between where it is produced and where it is consumed).
        const resolved = im.spec.startsWith(".") ? resolveSpecifier(repoFile, im.spec, nodes) : null;
        imports.push({
          line: im.line, spec: im.spec, kind: im.kind, names: statementNames(stmt),
          category: classifySpec(im.spec, fromDir, toDir),
          resolved_path: resolved, resolved_dir: resolved === null ? null : scopeDirId(NORM(scopeRoot), resolved),
        });
      }
    }
    add("source_imports", `${repoFile} (${imports.length} statement(s))`,
      imports.map((x) => `L${x.line} [${x.category}/${x.kind}] ${x.spec} :: {${x.names.join(", ")}}`).join("\n") || "(no imports)",
      { move_index: mv.index, path: repoFile, imports });

    // (c) callers, by directory — is the moved symbol used nearby or across the subtree?
    // `git grep <rev> -- <path>` prints `<rev>:<path>:<line>:<content>` (verified on this git), so the rev
    // prefix is stripped FIRST — parsing it as the path yields a NaN line number and a row that is silently
    // attributed to nowhere.
    const grep = maybe(["grep", "-wn", ...mv.symbols.flatMap((s) => ["-e", s]), commit, "--", NORM(scopeRoot) || "."]);
    const revPrefix = `${commit}:`;
    const rows = (grep.code === 0 ? grep.out : "").split("\n").filter(Boolean)
      .map((raw) => {
        const r = raw.startsWith(revPrefix) ? raw.slice(revPrefix.length) : raw;
        const i = r.indexOf(":"), j = r.indexOf(":", i + 1);
        if (i < 0 || j < 0) return null;
        const line = Number(r.slice(i + 1, j));
        if (!Number.isInteger(line)) return null;
        // A grep row carries the LINE'S TEXT, so a row landing inside a decision-reference comment block would
        // hand the answer over verbatim (types.ts's header names the goal its own grep hit). Blank it whole,
        // keeping the `path:line:` prefix so the row still names the real file — the executor's own rule.
        // ⛔ FAIL-CLOSED: a file whose comment blocks cannot be read cannot be PROVEN clean, so its content is
        // blanked too rather than passed through (硬规则 3b).
        const ranges = redactedRangesFor(r.slice(0, i));
        const blanked = ranges === null || ranges.some(([a, b]) => line - 1 >= a && line - 1 <= b);
        return { path: r.slice(0, i), line, text: blanked ? REDACTED_COMMENT : r.slice(j + 1) };
      })
      .filter(Boolean);
    const byDir = {};
    for (const r of rows) {
      const d = scopeDirId(NORM(scopeRoot), r.path);
      if (d === null) continue;
      const bucket = d === fromDir ? "same_dir" : (d === toDir ? "target_dir" : "cross_dir");
      (byDir[d] ??= { dir: d, bucket, count: 0, paths: new Set() }).count++;
      byDir[d].paths.add(r.path);
    }
    add("callers", `git grep -wn ${mv.symbols.join(" ")} ${commit.slice(0, 9)} -- ${NORM(scopeRoot)}`,
      rows.slice(0, budget.max_grep_hits).map((r) => `${r.path}:${r.line}: ${r.text.trim().slice(0, 160)}`).join("\n") || "(no caller rows)",
      {
        move_index: mv.index, command: `git grep -wn ${mv.symbols.join(" ")} <commit> -- ${NORM(scopeRoot)}`,
        total_rows: rows.length, truncated_rows: Math.max(0, rows.length - budget.max_grep_hits),
        by_dir: Object.values(byDir).map((b) => ({ dir: b.dir, bucket: b.bucket, count: b.count, files: [...b.paths].sort() })).sort((a, b) => a.dir.localeCompare(b.dir)),
      });

  }

  // ── per SOURCE directory: what it keeps after the cut. Hollowing is a DIRECTORY fact — one file emptied
  //    is not a hollowed directory, and one file surviving is enough to keep the directory alive.
  for (const dir of [...new Set(moves.map((m) => m.from))].sort()) {
    const dirRepo = dirRepoPath(scopeRoot, dir);
    const files = treeFiles.filter((p) => dirOf(p) === dirRepo && /\.(ts|mts|cts|tsx)$/.test(p)).sort();
    const rows = [];
    for (const f of files) {
      if (!guard(f)) continue;
      const s = srcAt(f);
      if (s === null) continue;
      const exported = exportedNames(s);
      const moving = moves.filter((m) => joinRel(NORM(scopeRoot), m.file) === f).flatMap((m) => m.symbols);
      const typeOnly = typeOnlyExportedNames(s);
      rows.push({ path: f, exported, moving, type_only: typeOnly, remaining: exported.filter((n) => !moving.includes(n)) });
    }
    add("source_dir_remaining", `${dirRepo} (${rows.length} source file(s))`,
      rows.map((r) => `${r.path}\nexported: [${r.exported.join(", ")}]  moving: [${r.moving.join(", ")}]  remaining: [${r.remaining.join(", ")}]`).join("\n") || "(no source files)",
      { dir: dirRepo, dir_id: dir, files: rows.map((r) => r.path), rows });
  }

  // ── per target directory: its charter (header comments, BY POSITION) and its own file imports ────
  const targetDirs = [...new Set(moves.map((m) => m.to))].sort();
  const movingFiles = new Set(moves.map((m) => joinRel(NORM(scopeRoot), m.file)));
  add("moving_files", `${movingFiles.size} file(s)`, [...movingFiles].sort().join("\n"), { paths: [...movingFiles].sort() });

  // dir_imports / dir_inventory are emitted for EVERY directory the slice touches (sources as well as
  // targets): a directory with no evidence entry and a directory that was read and found empty must not be
  // the same value (硬规则 3b), and the source directory's own boundary is part of the cut's picture.
  for (const dir of [...new Set([...targetDirs, ...moves.map((m) => m.from)])].sort()) {
    const dirRepo = dirRepoPath(scopeRoot, dir);
    const files = treeFiles.filter((p) => dirOf(p) === dirRepo && /\.(ts|mts|cts|tsx)$/.test(p)).sort();
    const parts = [], allImports = [];
    for (const f of files) {
      if (!guard(f)) continue;
      const s = srcAt(f);
      if (s === null) continue;
      const ls = s.split("\n");
      if (targetDirs.includes(dir)) {
        // CHARTER — extracted by comment-block START/END positions, never by keyword. A comment that names a
        // file is a comment, not a dependency edge; the review's dependency facts come only from statements.
        // HEADER only: a block counts while everything before it is blank or part of a block already taken.
        // (A file's LATER comment blocks are prose about its internals; carrying them would spend the byte
        // budget on implementation notes the charter question does not ask about.)
        // A BARE `//` is a paragraph separator inside the header (the contract's block extractor ends a block
        // there on purpose), so it counts as a header gap — without that, a file whose header has a topic
        // break would contribute only its first paragraph and the rest of the header would be silently lost.
        const isHeaderGap = (l) => l.trim() === "" || /^\/\/\s*$/.test(l.trim());
        const head = [];
        let cursor = 0;
        for (const [a, b] of commentBlockRanges(ls)) {
          if (!ls.slice(cursor, a).every(isHeaderGap)) break;
          head.push(`${f}:${a + 1}-${b + 1}`);
          parts.push(`${f}:${a + 1}-${b + 1}\n${ls.slice(a, b + 1).join("\n")}`);
          cursor = b + 1;
        }
      }
      for (const im of extractImports(s)) {
        const stmt = statementAt(s, im.line, im.spec);
        const resolved = im.spec.startsWith(".") ? resolveSpecifier(f, im.spec, nodes) : null;
        allImports.push({
          path: f, line: im.line, spec: im.spec, kind: im.kind, names: statementNames(stmt),
          category: classifySpec(im.spec, dir, dir),
          resolved_path: resolved, resolved_dir: resolved === null ? null : scopeDirId(NORM(scopeRoot), resolved),
        });
      }
    }
    if (targetDirs.includes(dir)) {
      add("target_charter", `${dirRepo} (${parts.length} header comment block(s))`,
        parts.join("\n---\n") || "(no header comment blocks)",
        { dir: dirRepo, dir_id: dir, comment_blocks: parts.map((p) => p.split("\n")[0]), dependency_evidence: false });
    }
    add("dir_imports", `${dirRepo} (${allImports.length} import/export-from statement(s) in ${files.length} file(s))`,
      allImports.map((x) => `${x.path}:${x.line} [${x.kind}] ${x.spec} :: {${x.names.join(", ")}}`).join("\n") || "(no imports)",
      { dir: dirRepo, dir_id: dir, files, imports: allImports });
    add("dir_inventory", `${dirRepo} (${files.length} source file(s))`, files.join("\n") || "(no source files)", { dir: dirRepo, dir_id: dir, files });
  }

  // ── the total budget: truncation is a RECORDED event, never a silent clip ─────────────────────────
  const truncations = [];
  let used = 0;
  for (const ev of evidence) {
    const room = Math.max(0, budget.max_total_evidence_bytes - used);
    if (ev.bytes > room) {
      const c = clipToBytes(ev.text, room);
      truncations.push({ evidence_id: ev.id, kind: ev.kind, kept_bytes: Buffer.byteLength(c.text, "utf8"), dropped_bytes: ev.bytes - Buffer.byteLength(c.text, "utf8"), total_bytes: ev.total_bytes });
      ev.text = c.text;
      ev.bytes = Buffer.byteLength(c.text, "utf8");
      ev.sha256 = sha256(ev.text);
      ev.truncated = true;
    }
    used += ev.bytes;
  }

  const bundle = {
    review_version: REVIEW_VERSION,
    commit, scope_root: NORM(scopeRoot), subject: slice?.subject ?? null,
    moves, evidence, denied, truncations,
    budget: { max_total_evidence_bytes: budget.max_total_evidence_bytes, used_bytes: used },
    bytes: used,
  };
  // the bundle may not carry a ring reading under ANY name — asserted on the ASSEMBLED object, so this is
  // a real gate over what was produced rather than a promise about what the code intends to produce.
  assertBundleClean(bundle);
  return bundle;
}

/**
 * Throw when a bundle carries a structural (scc/cycle/delta) field under any name. Exported so the AC1
 * negative control can call the SAME gate the assembler calls — a check the test re-implements is a check
 * that can drift from the one in production.
 */
export function assertBundleClean(bundle) {
  const leaks = findStructuralKeyLeaks(bundle);
  if (leaks.length) throw new Error(`BUNDLE_CARRIES_STRUCTURAL_FIELD: the ownership review may not be handed a ring reading under any name; found ${JSON.stringify(leaks)}`);
  return true;
}

/**
 * Every key path in `obj` whose (lowercased) name contains a STRUCTURAL_KEY_TOKENS token. Exported so the
 * AC1 negative control can inject `sccLeft` and watch the SAME predicate turn red — the predicate the
 * assembler asserts with is the predicate the test calls, not a copy of it.
 */
export function findStructuralKeyLeaks(obj, path = "$", out = []) {
  if (Array.isArray(obj)) { obj.forEach((v, i) => findStructuralKeyLeaks(v, `${path}[${i}]`, out)); return out; }
  if (!isObj(obj)) return out;
  for (const [k, v] of Object.entries(obj)) {
    const norm = k.toLowerCase();
    if (STRUCTURAL_KEY_TOKENS.some((t) => norm.includes(t))) out.push({ path: `${path}.${k}`, key: k });
    findStructuralKeyLeaks(v, `${path}.${k}`, out);
  }
  return out;
}

/**
 * The AC6 leak audit over the text actually put in front of the judge. Scans every string in the bundle
 * (not a summary of it) so an answer smuggled into any field is caught. Returns `{ok, hits[]}`.
 */
export function auditHoldoutLeakage(bundle) {
  const hits = [];
  const walk = (v, where) => {
    if (typeof v === "string") {
      for (const term of HOLDOUT_VOCABULARY) {
        // ASCII terms are case-insensitive (the answer is not less leaked in lower case); the CJK term is literal.
        const found = /^[\x20-\x7e]+$/.test(term) ? v.toLowerCase().includes(term.toLowerCase()) : v.includes(term);
        if (found) hits.push({ term, where });
      }
      return;
    }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${where}[${i}]`)); return; }
    if (isObj(v)) for (const [k, x] of Object.entries(v)) walk(x, `${where}.${k}`);
  };
  walk(bundle, "$");
  return { ok: hits.length === 0, hits };
}

// ── 2. MECHANICAL OWNERSHIP FACTS (deterministic, no LLM) ───────────────────────────────────────────

/**
 * Import edges observed by parsing the bundle's own target-dir evidence, keyed by directory id.
 * The specifier was resolved by the ASSEMBLER (which held the commit's file list); this layer only groups
 * the already-resolved readings, so it cannot silently invent or drop an edge by resolving differently.
 */
function parseSideEdges(bundle) {
  const out = {};
  for (const ev of bundle.evidence.filter((e) => e.kind === "dir_imports")) {
    const edges = new Map();
    for (const im of ev.imports) {
      const target = im.resolved_dir ?? null;
      if (target === null || target === ev.dir_id) continue;         // unresolved / same-dir is not an edge
      if (!edges.has(target)) edges.set(target, { to: target, specs: new Set(), files: new Set(), names: new Set() });
      const e = edges.get(target);
      e.specs.add(im.spec); e.files.add(im.path); for (const n of im.names) e.names.add(n);
    }
    out[ev.dir_id] = [...edges.values()]
      .map((e) => ({ to: e.to, specs: [...e.specs].sort(), files: [...e.files].sort(), names: [...e.names].sort() }))
      .sort((a, b) => a.to.localeCompare(b.to));
  }
  return out;
}

/** The graph's internal out-edges of one directory id, from an ArchGuard moduleGraph. */
function graphSideEdges(graph, dirId) {
  if (!isObj(graph) || !Array.isArray(graph.edges) || !Array.isArray(graph.nodes)) return null;
  const internal = new Set(graph.nodes.filter((n) => n.type === "internal").map((n) => n.id));
  if (!internal.has(dirId)) return null;
  const edges = graph.edges.filter((e) => e.from === dirId && internal.has(e.to) && e.to !== dirId);
  return edges.map((e) => ({ to: e.to, names: [...(e.importedNames ?? [])].sort() })).sort((a, b) => a.to.localeCompare(b.to));
}

const edgeKey = (e) => `${e.to}`;
const setsEqual = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

/**
 * Compare the two boundary sources and NAME the difference — never union them and call the result complete.
 * 硬规则 3b: "the graph could not be read" is its own state, and it can never be reported as `agree`.
 */
export function compareBoundaries(graphOut, parseOut) {
  if (graphOut === null && parseOut === null) return { agreement: "not-evaluated", reason: "neither source could be read" };
  if (graphOut === null) return { agreement: "not-evaluated", reason: "no ArchGuard module graph was supplied (graph byte absent) — only the parse side was read", only: "parse" };
  if (parseOut === null) return { agreement: "not-evaluated", reason: "the target directory's source could not be parsed", only: "graph" };
  const g = new Set(graphOut.map(edgeKey)), p = new Set(parseOut.map(edgeKey));
  const graph_missing = [...p].filter((x) => !g.has(x));
  const parse_missing = [...g].filter((x) => !p.has(x));
  if (!graph_missing.length && !parse_missing.length) return { agreement: "agree", graph_missing_edges: [], parse_missing_edges: [] };
  if (graph_missing.length && parse_missing.length) return { agreement: "both_differ", graph_missing_edges: graph_missing, parse_missing_edges: parse_missing };
  if (graph_missing.length) return { agreement: "graph_missing_edges", graph_missing_edges: graph_missing, parse_missing_edges: [] };
  return { agreement: "parse_missing_edges", graph_missing_edges: [], parse_missing_edges: parse_missing };
}

/**
 * The deterministic ownership FACTS of a bundle. No LLM, no prose, no verdict — the judge's raw material and
 * the admission gate's non-input (this layer changes nothing).
 *
 * @param {object} bundle  from `assembleOwnershipEvidence`
 * @param {object|null} graph  an ArchGuard `moduleGraph` ({nodes, edges, cycles}) whose analysed tree must be
 *                             the bundle's commit — supplied, never assumed; `null` is an honest reading
 */
export function ownershipFacts(bundle, graph = null) {
  const parseEdges = parseSideEdges(bundle);
  const graphProvenance = isObj(graph)
    ? { supplied: true, nodes: graph.nodes?.length ?? null, edges: graph.edges?.length ?? null }
    : { supplied: false };

  // The observed boundary of ONE directory node. Two sources, compared and NAMED — never unioned into a
  // silently-complete edge set. `observed_out` is the graph's when a graph was supplied, else the parse's,
  // and `boundary_source` records which one the violation reading below actually rests on.
  const boundaryOf = (dir) => {
    const g = graphSideEdges(graph, dir);
    // A directory with NO dir_imports evidence was never read; that is not "read and found empty" (硬规则 3b).
    const p = Object.prototype.hasOwnProperty.call(parseEdges, dir) ? parseEdges[dir] : null;
    const cmp = compareBoundaries(g, p);
    const inventory = bundle.evidence.find((e) => e.kind === "dir_inventory" && e.dir_id === dir);
    return {
      dir, dir_repo: dirRepoPath(bundle.scope_root, dir),
      graph_out: g, parse_out: p,
      observed_out: g !== null ? g : p,
      boundary_source: g !== null ? "archguard_module_graph" : "source_parse",
      ...cmp,
      evidence_ids: bundle.evidence.filter((e) => (e.kind === "dir_imports" || e.kind === "dir_inventory") && e.dir_id === dir).map((e) => e.id),
      target_files: inventory?.files ?? [],
    };
  };
  // every directory this slice touches — the targets it moves INTO and the sources it moves OUT of
  const boundaries = {};
  for (const dir of [...new Set([...bundle.moves.map((m) => m.to), ...bundle.moves.map((m) => m.from)])].sort()) boundaries[dir] = boundaryOf(dir);

  const ioInDir = (dir) => {
    const p = parseEdges[dir] ?? [];
    const ev = bundle.evidence.find((e) => e.kind === "dir_imports" && e.dir_id === dir);
    const specs = new Set((ev?.imports ?? []).map((x) => x.spec));
    return { has_io: [...specs].some((s) => IO_MODULES.includes(s)), io_specs: [...specs].filter((s) => IO_MODULES.includes(s)).sort(), self_declared_edges: p };
  };

  // A dependency is CARRIED BY THE CUT when every name it takes is itself moving out of the file that
  // declares it — coverage is per SOURCE FILE across ALL moves, not per move: `utils.ts` importing
  // `GateConfig` from `./types.ts` is carried when the move that empties `types.ts` names `GateConfig`,
  // even though that symbol is not in `utils.ts`'s own move list. (Same rule ArchGuard's slice-delta
  // applies to an edge's `importedNames`; getting it wrong turns a clean cut into a false violation.)
  const movedNamesByFile = new Map();
  for (const m of bundle.moves) {
    const f = joinRel(bundle.scope_root, m.file);
    if (!movedNamesByFile.has(f)) movedNamesByFile.set(f, new Set());
    for (const s of m.symbols) movedNamesByFile.get(f).add(s);
  }
  const remainingByDir = new Map();
  for (const ev of bundle.evidence.filter((e) => e.kind === "source_dir_remaining")) remainingByDir.set(ev.dir_id, ev);

  const moves = bundle.moves.map((mv) => {
    const b = boundaries[mv.to];
    const boundary = b?.observed_out ?? null;
    const boundaryTargets = new Set((boundary ?? []).map((e) => e.to));
    const srcImports = bundle.evidence.find((e) => e.kind === "source_imports" && e.move_index === mv.index);
    const declared = bundle.evidence.find((e) => e.kind === "symbol_declaration" && e.move_index === mv.index);
    const callers = bundle.evidence.find((e) => e.kind === "callers" && e.move_index === mv.index);
    const movingSet = new Set(bundle.moves.map((m) => joinRel(bundle.scope_root, m.file)));

    // dependencies of the moved file whose imported NAMES are not all moving with it — those edges change owner
    const transferred = [];
    for (const im of srcImports?.imports ?? []) {
      if (!im.spec.startsWith(".")) continue;
      const resolvedDir = im.resolved_dir ?? null;
      const carried = movedNamesByFile.get(im.resolved_path ?? "");
      const covered = im.names.length > 0 && im.names.every((n) => carried?.has(n) ?? mv.symbols.includes(n));
      if (covered) continue;                                        // the cut carries its own dependency
      const stays = im.resolved_path !== null && movingSet.has(im.resolved_path);
      if (resolvedDir !== null && resolvedDir === mv.to) continue;  // lands inside the target dir
      transferred.push({
        spec: im.spec, line: im.line, imported_names: im.names, kind: im.kind,
        resolved_path: im.resolved_path ?? null, resolved_dir: resolvedDir,
        covered_by_move: false, stays_with_source_file: stays,
        already_in_dest_boundary: resolvedDir !== null && boundaryTargets.has(resolvedDir),
      });
    }

    const destIo = ioInDir(mv.to);
    const pulledIo = (srcImports?.imports ?? []).filter((im) => IO_MODULES.includes(im.spec))
      .map((im) => ({ spec: im.spec, line: im.line, names: im.names }));
    const io_pull = { pulled: pulledIo, dest_has_io: destIo.has_io, is_pull: pulledIo.length > 0 && !destIo.has_io };

    const srcRemaining = remainingByDir.get(mv.from);
    const keptRows = srcRemaining?.rows ?? [];
    const hollowFiles = keptRows.filter((r) => r.remaining.length === 0 || r.remaining.every((n) => r.type_only.includes(n)));
    const sourceHollowing = {
      dir: srcRemaining?.dir ?? null,
      files: keptRows.map((r) => r.path),
      remaining_exports: keptRows.flatMap((r) => r.remaining),
      hollow_files: hollowFiles.map((r) => r.path),
      // a hollow SOURCE DIRECTORY: every file in it is emptied or left holding only types/barrels
      is_hollow: keptRows.length > 0 && hollowFiles.length === keptRows.length,
      evidence_ids: srcRemaining ? [srcRemaining.id] : [],
    };

    const callerByDir = callers?.by_dir ?? [];
    const callerLocality = {
      by_dir: callerByDir,
      total_rows: callers?.total_rows ?? 0,
      same_dir: callerByDir.filter((x) => x.bucket === "same_dir").reduce((a, x) => a + x.count, 0),
      cross_dir: callerByDir.filter((x) => x.bucket === "cross_dir").reduce((a, x) => a + x.count, 0),
      target_dir: callerByDir.filter((x) => x.bucket === "target_dir").reduce((a, x) => a + x.count, 0),
      directories: callerByDir.map((x) => x.dir).sort(),
    };

    // A BOUNDARY VIOLATION is the observation: the target directory is observed not to reach outside itself,
    // and this move would make it reach out. It is stated as a fact, with the evidence ids that show it.
    const outOfDir = transferred.filter((t) => !t.stays_with_source_file && t.resolved_dir !== null);
    // `null` = the boundary could not be observed at all. It is NOT `false`: "no violation found" and
    // "could not look" must never share a value (硬规则 3b).
    const violation = boundary === null ? null : (boundary.length === 0 && outOfDir.length > 0);
    const violationEvidenceIds = [...new Set([
      ...(boundaries[mv.to]?.evidence_ids ?? []),
      ...(srcImports ? [srcImports.id] : []),
    ])].sort();

    return {
      move_index: mv.index, file: mv.file, from: mv.from, to: mv.to, symbols: mv.symbols,
      declared: (declared?.found ?? false),
      dest_boundary: {
        dir: mv.to, boundary_source: b?.boundary_source ?? null, agreement: b?.agreement ?? "not-evaluated",
        graph_out: b?.graph_out ?? null, parse_out: b?.parse_out ?? [],
        graph_missing_edges: b?.graph_missing_edges ?? [], parse_missing_edges: b?.parse_missing_edges ?? [],
        observed_out_size: boundary === null ? null : boundary.length,
        evidence_ids: boundaries[mv.to]?.evidence_ids ?? [],
      },
      dest_boundary_violation: violation,
      violation_evidence_ids: violation ? violationEvidenceIds : [],
      transferred_dependencies: transferred,
      transfer_evidence_ids: srcImports ? [srcImports.id] : [],
      io_pull,
      io_evidence_ids: srcImports ? [srcImports.id] : [],
      source_hollowing: sourceHollowing,
      caller_locality: callerLocality,
      // every mechanical ADVERSE reading, with the ids that demonstrate it: the judge must answer these
      counter_evidence_ids: [...new Set([
        ...(violation ? violationEvidenceIds : []),
        ...(io_pull.is_pull && srcImports ? [srcImports.id] : []),
        ...(transferred.length && srcImports ? [srcImports.id] : []),
      ])].sort(),
    };
  });

  return {
    review_version: REVIEW_VERSION,
    commit: bundle.commit, scope_root: bundle.scope_root,
    graph_provenance: graphProvenance,
    // the full reading per directory node, so AC2b can name a SOURCE directory's boundary, not only a target's
    boundaries,
    boundary_agreement: Object.fromEntries(Object.entries(boundaries).map(([d, b]) => [d, { agreement: b.agreement, boundary_source: b.boundary_source, graph_missing_edges: b.graph_missing_edges, parse_missing_edges: b.parse_missing_edges }])),
    moves,
  };
}

// ── 3. THE BLIND JUDGE ──────────────────────────────────────────────────────────────────────────────

/** The judge contract, stated once so the prompt and the validator cannot drift apart. */
export const JUDGE_OUTPUT_SHAPE = Object.freeze({
  moves: [{ move_index: 0, responsibility_hypothesis: "…", evidence_refs: ["ev-1"], counter_evidence_refs: [], confidence: "low|medium|high", recommendation: "review|reject|abstain" }],
  overall: { responsibility_hypothesis: "…", evidence_refs: [], counter_evidence_refs: [], confidence: "low|medium|high" },
});

/**
 * Build the judge prompt. The judge gets the bundle and the facts and NOTHING else — no repo, no tools,
 * no goal text, no label. Exported so the caller can record its sha256 BEFORE the run (AC5).
 */
export function buildReviewPrompt({ bundle, facts }) {
  return [
    "You are an INDEPENDENT ARCHITECTURE OWNERSHIP REVIEWER. You have NO tools and NO repository access.",
    "Everything you may rely on is in the two JSON documents below. Do not speculate about code you cannot see.",
    "",
    "QUESTION. A slice has been proposed that MOVES the listed symbols out of their current file/directory into",
    "a target directory. The cut is structurally clean. Your job is the different question: does each moved",
    "symbol BELONG in the target directory, by domain responsibility?",
    "",
    "RULES.",
    "1. Cite evidence ONLY by the ids that appear in the bundle below. A citation that is not an id in the",
    "   bundle makes your whole answer for that move unusable.",
    "2. The FACTS are mechanical observations (import direction, boundary, caller locality) — they are not",
    "   conclusions. `dest_boundary_violation`, `transferred_dependencies` and `io_pull` are the mechanical",
    "   ADVERSE readings. If a move carries one of them, you may still say `review` — but ONLY if you answer it",
    "   by citing that evidence in `counter_evidence_refs` and saying why it does not defeat the move.",
    "3. `reject` = the move puts a responsibility where it does not belong. `abstain` = the evidence does not",
    "   settle it. `review` = the evidence supports the target ownership.",
    "4. Output ONE JSON object and nothing else. No prose outside it, no code fence required.",
    "",
    "OUTPUT SHAPE:", JSON.stringify(JUDGE_OUTPUT_SHAPE, null, 1),
    "",
    "EVIDENCE BUNDLE (commit-locked; every text field already redacted of historical decision references):",
    JSON.stringify(bundle),
    "",
    "MECHANICAL OWNERSHIP FACTS:",
    JSON.stringify(facts),
  ].join("\n");
}

/** The first parseable JSON object in `stdout` (fence-tolerant), or null. Never throws, never guesses. */
export function parseReview(stdout) {
  const s = typeof stdout === "string" ? stdout : "";
  if (!s.trim()) return null;
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(s);
  const candidates = [fence?.[1], s];
  const first = s.indexOf("{"), last = s.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(s.slice(first, last + 1));
  for (const c of candidates) {
    if (!c) continue;
    try { const v = JSON.parse(c); if (isObj(v)) return v; } catch { /* try the next shape */ }
  }
  return null;
}

/**
 * The deterministic overall synthesis. Exported so each branch is directly testable, and so the rule is one
 * function rather than a sentence the judge could paraphrase (ADR-004: hard checks over prose).
 */
export function synthesizeOverallRecommendation(moveVerdicts) {
  const recs = moveVerdicts.map((m) => m.recommendation);
  if (recs.includes("reject")) return "reject";
  if (recs.some((r) => r === "abstain" || r === NOT_EVALUATED)) return "abstain";
  if (recs.length && recs.every((r) => r === "review")) return "review";
  return "abstain";
}

/** The lowest confidence among the moves that produced a usable verdict, or null when none did. */
function weakestConfidence(moveVerdicts) {
  const order = { low: 0, medium: 1, high: 2 };
  const usable = moveVerdicts.filter((m) => CONFIDENCE_LEVELS.includes(m.confidence));
  if (!usable.length) return null;
  return usable.reduce((acc, m) => (order[m.confidence] < order[acc] ? m.confidence : acc), "high");
}

/**
 * Run the blind ownership review over ONE assembled bundle.
 *
 * @param {object} o
 * @param {object} o.bundle       from `assembleOwnershipEvidence`
 * @param {object} o.facts        from `ownershipFacts`
 * @param {function} o.invokeJudge async (prompt) => {status, stdout}  — the SAME tool-less seam the
 *                                investigation loop uses (`--tools ""`), injected so the suite needs no model
 * @returns {Promise<object>} `{state, …}` where state is `evaluated` | `not-evaluated`. `not-evaluated` is the
 *          module-level "the review did not happen"; a move-level `not-evaluated` is how one move failed to
 *          produce a usable verdict while the review itself ran. Neither is ever spelled `abstain`.
 */
export async function reviewOwnership({ bundle, facts, invokeJudge }) {
  const base = { review_version: REVIEW_VERSION, commit: bundle?.commit ?? null, prompt_sha256: null, judge_calls: 0, moves: [], overall: null };
  if (typeof invokeJudge !== "function") {
    return { ...base, state: NOT_EVALUATED, cause: "NO_JUDGE_SEAM", reason: "no launcher was injected — refusing to report a review that never ran (硬规则 3b)" };
  }
  const prompt = buildReviewPrompt({ bundle, facts });
  const prompt_sha256 = sha256(prompt);
  let r;
  try { r = await invokeJudge(prompt); } catch (e) { r = { error: e }; }
  const calls = 1;
  if (!r || r.error || (typeof r.status === "number" && r.status !== 0)) {
    return { ...base, prompt_sha256, judge_calls: calls, state: NOT_EVALUATED, cause: "JUDGE_UNAVAILABLE", reason: String(r?.error?.message ?? `exit ${r?.status}`).slice(0, 300) };
  }
  const parsed = parseReview(r.stdout);
  if (!parsed) {
    return { ...base, prompt_sha256, judge_calls: calls, state: NOT_EVALUATED, cause: "JUDGE_OUTPUT_UNREADABLE", reason: "the reply contained no parseable JSON object — this is NOT an abstain (硬规则 3b)" };
  }

  const known = new Set(bundle.evidence.map((e) => e.id));
  const byIndex = new Map();
  for (const m of Array.isArray(parsed.moves) ? parsed.moves : []) {
    if (isObj(m) && Number.isInteger(m.move_index)) byIndex.set(m.move_index, m);
  }

  const moveVerdicts = bundle.moves.map((mv) => {
    const fact = facts.moves.find((f) => f.move_index === mv.index) ?? null;
    const raw = byIndex.get(mv.index);
    const verdict = {
      move_index: mv.index, file: mv.file, from: mv.from, to: mv.to, symbols: mv.symbols,
      recommendation: NOT_EVALUATED, confidence: null, responsibility_hypothesis: null,
      evidence_refs: [], counter_evidence_refs: [], cause: null, ungrounded_refs: [], downgraded_from: null,
    };
    if (!raw) { verdict.cause = "MOVE_NOT_JUDGED"; return verdict; }
    const refs = [...(Array.isArray(raw.evidence_refs) ? raw.evidence_refs : []), ...(Array.isArray(raw.counter_evidence_refs) ? raw.counter_evidence_refs : [])];
    const bad = refs.filter((x) => !known.has(x));
    if (bad.length) { verdict.cause = "UNGROUNDED_CITATION"; verdict.ungrounded_refs = [...new Set(bad)]; return verdict; }
    if (!RECOMMENDATIONS.includes(raw.recommendation)) { verdict.cause = `RECOMMENDATION_NOT_IN_VOCAB:${String(raw.recommendation)}`; return verdict; }
    if (!CONFIDENCE_LEVELS.includes(raw.confidence)) { verdict.cause = `CONFIDENCE_NOT_IN_VOCAB:${String(raw.confidence)}`; return verdict; }
    if (!isStr(raw.responsibility_hypothesis, 1)) { verdict.cause = "HYPOTHESIS_MISSING"; return verdict; }

    verdict.recommendation = raw.recommendation;
    verdict.confidence = raw.confidence;
    verdict.responsibility_hypothesis = raw.responsibility_hypothesis;
    verdict.evidence_refs = [...(raw.evidence_refs ?? [])];
    verdict.counter_evidence_refs = [...(raw.counter_evidence_refs ?? [])];

    // the adverse-fact rule: a `review` over a mechanical boundary violation must ANSWER it, not ignore it
    if (raw.recommendation === "review" && fact?.dest_boundary_violation === true) {
      const answered = verdict.counter_evidence_refs.filter((x) => fact.violation_evidence_ids.includes(x));
      if (!answered.length) {
        verdict.downgraded_from = "review";
        verdict.recommendation = "abstain";
        verdict.cause = "BOUNDARY_VIOLATION_NOT_ADDRESSED";
      }
    }
    return verdict;
  });

  const overallRecommendation = synthesizeOverallRecommendation(moveVerdicts);
  return {
    ...base, prompt_sha256, judge_calls: calls, state: "evaluated",
    moves: moveVerdicts,
    overall: {
      recommendation: overallRecommendation,
      confidence: weakestConfidence(moveVerdicts),
      responsibility_hypothesis: isStr(parsed.overall?.responsibility_hypothesis, 1) ? parsed.overall.responsibility_hypothesis : null,
      evidence_refs: Array.isArray(parsed.overall?.evidence_refs) ? parsed.overall.evidence_refs.filter((x) => known.has(x)) : [],
      counter_evidence_refs: Array.isArray(parsed.overall?.counter_evidence_refs) ? parsed.overall.counter_evidence_refs.filter((x) => known.has(x)) : [],
      not_evaluated_moves: moveVerdicts.filter((m) => m.recommendation === NOT_EVALUATED).map((m) => m.move_index),
    },
  };
}

// ── the redaction proof surface (AC1) ───────────────────────────────────────────────────────────────
/** True when `text` still carries a decision reference — the property `redactDecisionReferences` removes. */
export function hasUnredactedDecisionReference(text) {
  return String(text ?? "").includes(REDACTED_COMMENT) === false && /GOAL-\d+|AC-\d+|DIR-\d+|ADR-\d+|SPEC-[\w-]+|gap-[a-z0-9-]{6,}/.test(String(text ?? ""));
}
