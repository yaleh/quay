#!/usr/bin/env node
// ARCHITECTURE-DISCOVERY — SPACE instrument (cross-object consistency) + the experiment-A3 time-semantics controls.
//
// Shadow, read-only, manual CLI (no driver wiring — same family as `ownership-active-*.mjs`). It lands the
// bounded experiment that ran on 2026-10-11 from `/data/home/yale/work/quay-scratch/arch-discovery-shadow/`
// (`expA.mjs` + `expA3.mjs`) so the readings are reproducible from the repo instead of from a scratch dir.
//
// ── WHAT IT ANSWERS ────────────────────────────────────────────────────────────────────────────────
// expA: given the EXISTING `enum-surface-parity-check.ts` candidate set at a PRE commit, can three
// POSITION-BASED pieces of evidence tell a STALE COPY (the surface literal predates the authority gaining
// the missing value) apart from an INTENTIONAL SUBSET (a written rationale / an exhaustiveness pin)?
//   E1 lag     : the literal's line was last changed BEFORE the authority first contained the missing value.
//   E2 named   : the contiguous comment block directly above the literal names a missing value.
//   E3 test    : a test file pins the literal's declared symbol.
// expA3: are two time readings of the same fact consistent, or does a naive reading manufacture a gap?
//   A3a: done-flip commit time (git log) vs the gate `complete` event time (gate-events.jsonl).
//   A3b: the worker-round `in_flight_task_starts` instant vs the worker-outcome `started_at` of the attempt.
//
// ── THE RULE IS PRE-REGISTERED (written before the first run; never tuned to the labels) ───────────
//   drift-hypothesis ⇐ E1=stale ∧ ¬E2 ∧ ¬E3
//   legit-difference ⇐ (E2 ∨ E3) ∧ E1≠stale
//   undetermined     ⇐ anything else, INCLUDING any evidence not-evaluated
// Labels are read ONLY in the scoring step, after every verdict exists (see DEFAULT_LABELS / --labels).
//
// ── TWO MODES ───────────────────────────────────────────────────────────────────────────────────────
// EXPERIMENT (`--pre <rev> --post <rev>`, optional `--labels`): the pre-registered 2026-10-11 reading —
//   a candidate SET at PRE scored against human labels. Every reading of it is unchanged.
// SCAN (`--scan [--rev <rev>] [--registry <json>]`): the same readings over ONE rev (default HEAD),
//   with NO labels and NO pre/post pair — the form a periodic scan can actually run. Candidates come
//   from the checker as shipped in this instrument's own checkout. A3 is skipped (it is an experiment-A3
//   artifact, reported as `not-applicable`), and every finding carries a run-stable `finding_fp`.
//   `--registry` lets a fixture/foreign tree declare its own authorities+surfaces (the checker's own
//   registry file format), which is what makes a scan of a NON-repo tree possible.
// BOUNDS (both modes, all opt-in): `--max-ms` / `--max-records` / `--max-candidates`. A breach exits
//   with its OWN non-zero code and writes NOTHING (fail-closed — never a partial output carrier).
//   jsonl carriers are STREAMED, so a 144 MB `.quay/gate-events.jsonl` is never resident as one string.
//
// ⛔ STRUCTURAL SANDBOX: creates no task, goal, or AC; changes no status; writes NO production carrier.
// Its only persistence is the caller-given `--out` jsonl (default under `.quay/arch-discovery-shadow/`,
// never `.quay/architecture-evidence-store.jsonl`). The checker's own `note`/KNOWN_DRIFT `reason` text is
// NEVER read — it carries the human adjudication, i.e. the answer.
//
// Every record is run through the PRODUCTION evidence-store validator (`validateRecord`); the accepted /
// refused tally is REPORTED, never assumed. Records use the store's discovery verdicts
// (`supported` / `refuted` / `undetermined`), its `counterexample` kind, and its runtime-`carrier`
// provenance form.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { sha256, subjectKey, validateRecord } from "./architecture-evidence-store.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TOOL = "arch-discovery-space";

// ── the enum-surface checker, resolved at RUNTIME (task gap-discovery-toolchain-depends-on-unshipped-
//    docs-analysis-and-ts-sources-never-works-off-quay-repo) ─────────────────────────────────────────
// ⛔ The scan used to `import(path.join(HERE, "..", "..", "plugin/scripts/enum-surface-parity-check.ts"))`
// — a RAW `.ts` under `plugin/scripts/`, which exists only in quay's own SOURCE checkout. The shipped
// plugin artifact deletes the raw `.ts` and ships `plugin/scripts/dist/<name>.js` instead
// (packages/quay/scripts/package.sh), so the SCAN mode of this instrument could not run anywhere else.
// The same two-layout pair `arch-hypothesis-generation.mjs` uses: source checkout first, shipped bundle
// second; a miss is a NAMED refusal, never an empty candidate set (硬规则 3b — "the checker could not be
// loaded" and "the checker found nothing" must not share a shape; the empty-registry guard just below
// already refuses the second).
export const CHECKER_SRC_REL = "plugin/scripts/enum-surface-parity-check.ts";
/** ⛔ One `scripts/dist/<name>.js` LITERAL, for the same reason as arch-hypothesis-generation.mjs's
 *  IMPORT_PARSER_DIST_REL: `build-plugin-dist.mjs` reverse-looks-up this shape to decide what to bundle. */
export const CHECKER_DIST_REL = "scripts/dist/enum-surface-parity-check.js";
export const CHECKER_CANDIDATES = Object.freeze([
  path.join(HERE, "..", "..", CHECKER_SRC_REL),
  path.join(HERE, "..", "..", CHECKER_DIST_REL),
]);
async function loadChecker() {
  const tried = [];
  for (const candidate of CHECKER_CANDIDATES) {
    tried.push(candidate);
    if (!fs.existsSync(candidate)) continue;
    const mod = await import(/* @vite-ignore */ pathToFileURL(candidate).href);
    if (typeof mod.runCheck === "function" && mod.DEFAULT_REGISTRY) return mod;
    throw new Error(`CHECKER_UNUSABLE — ${candidate} loaded but exports no runCheck/DEFAULT_REGISTRY`);
  }
  throw new Error(`CHECKER_UNRESOLVED — not found at ${tried.join(" or ")}`);
}

/** The checker AS OF a pinned tree — the `--pre`/`--post` experiment mode's own read (the candidate SET
 *  and the registry must be the PRE ones, so this one is deliberately NOT resolved from the plugin).
 *  A tree that does not carry it is a NAMED refusal, never an opaque ERR_MODULE_NOT_FOUND (硬规则 3b). */
async function loadTreeChecker(treeDir) {
  for (const rel of [CHECKER_SRC_REL, CHECKER_DIST_REL]) {
    const candidate = path.join(treeDir, rel);
    if (fs.existsSync(candidate)) return import(/* @vite-ignore */ pathToFileURL(candidate).href);
  }
  throw new Error(`CHECKER_UNRESOLVED_IN_TREE — neither ${path.join(treeDir, CHECKER_SRC_REL)} nor ${path.join(treeDir, CHECKER_DIST_REL)} exists`);
}

/** The task this instrument's record FORMAT depends on (it supplied the discovery verdicts,
 *  the `counterexample` kind, and the runtime-carrier provenance form used below). Every emitted
 *  record names it, and the run emits one evidence record whose `carrier` is a line of its task file —
 *  so "carrier provenance" is grounded on the dependency task, not on prose. */
export const PROVENANCE_TASK_DEFAULT = "gap-evidence-store-cannot-record-discovery-verdicts-and-counterexamples";

/** The six isolated eval labels — the only candidates with a human ruling. UNLABELLED candidates are
 *  reported but never scored. Kept in-tree so the reading is reproducible without the scratch dir;
 *  `--labels <file>` overrides it. Read ONLY after all verdicts exist. */
export const DEFAULT_LABELS = Object.freeze({
  "native-goal-write-desc": "drift",
  "serve-goal-status-order": "drift",
  "serve-goal-status-tabs": "drift",
  "discovered:packages/quay/src/serve/serve-dashboard.ts:1009": "legit",
  "discovered:plugin/scripts/routine-file-gate.ts:375": "legit",
  "discovered:plugin/scripts/routine-file-gate.ts:378": "legit",
});

// ── pure decision logic (unit-tested by plugin/test/arch-discovery-space.test.mjs) ──────────────────
export const RULE_DRIFT = "drift-hypothesis";
export const RULE_LEGIT = "legit-difference";
export const RULE_UNDETERMINED = "undetermined";

/** Pre-registered rule. `e1` is a state string; `e2`/`e3` are `{state, ...}` readings. */
export function classifySpace({ e1, e2, e3 }) {
  const anyNE = e1 === "not-evaluated" || e2.state === "not-evaluated";
  const E2 = e2.state === "evaluated" && Array.isArray(e2.named) && e2.named.length > 0;
  const E3 = e3.state === "evaluated" && Array.isArray(e3.hits) && e3.hits.length > 0;
  if (!anyNE && e1 === "stale" && !E2 && !E3) return RULE_DRIFT;
  if (!anyNE && (E2 || E3) && e1 !== "stale") return RULE_LEGIT;
  return RULE_UNDETERMINED;
}

/** The store speaks domain-neutral verdicts; the domain word stays in the hypothesis statement.
 *  `supported` = the DRIFT hypothesis is supported; `refuted` = it is refuted (the surface is a legit subset). */
export const RULE_TO_STORE_VERDICT = Object.freeze({
  [RULE_DRIFT]: "supported",
  [RULE_LEGIT]: "refuted",
  [RULE_UNDETERMINED]: "undetermined",
});

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Static `import/export … from "<spec>"`, bare `import "<spec>"`, and `await import("<spec>")` specifiers. */
export function importSpecifiers(src) {
  const out = [];
  const staticRe = /\b(?:import|export)\b[^;'"]*?\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']/g;
  const dynRe = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const m of String(src).matchAll(staticRe)) out.push(m[1] ?? m[2]);
  for (const m of String(src).matchAll(dynRe)) out.push(m[1]);
  return out.filter(Boolean);
}

/** Resolve a relative import specifier against the importing file. Bare/package specifiers → null (not a repo file). */
export function resolveSpecifier(spec, fromFile) {
  if (typeof spec !== "string" || !spec.startsWith(".")) return null;
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec)).replace(/^\.\//, "");
}

const stem = (p) => String(p).replace(/\.[^./]+$/, "");
/** Extension-swap equivalence (`./x.js` ≡ `./x.ts`): compare the resolved spec to the literal's own module. */
export function sameModuleResolved(resolved, moduleFile) {
  if (!resolved) return false;
  return resolved === moduleFile || stem(resolved) === stem(moduleFile);
}

/** E3. `mode="name"` is the WEAK reading (bare symbol name anywhere — the known weakness: two candidates
 *  bound a generic local, `partial` with 70 hits and `named` with 197). `mode="import"` is the FIX: a test
 *  counts only if it actually IMPORTS the literal's own module (specifier resolved). */
export function e3Hits({ testFiles, moduleFile, symbol, mode = "import" }) {
  if (!symbol) return { state: "not-evaluated", reason: "no declared symbol", hits: [] };
  const nameRe = new RegExp(`\\b${escapeRe(symbol)}\\b`);
  const hits = testFiles
    .filter(({ path: p, content }) => {
      if (!nameRe.test(content)) return false;
      if (mode === "name") return true;
      return importSpecifiers(content).some((s) => sameModuleResolved(resolveSpecifier(s, p), moduleFile));
    })
    .map((f) => f.path);
  return { state: "evaluated", hits };
}

// ── bounds: fail-closed. A breached budget exits with its OWN code and writes NOTHING ───────────────
/** One exit code per bound so a breach is diagnosable from the status alone (硬规则 3: a distinct value,
 *  never shared with "clean"). `--max-candidates` and `--max-groups` share code 6 because they are the
 *  same KIND of bound (a cap on the input the run consumes) on the two instruments — the two can never
 *  both be in play. 2 = usage/env is the gate-script-base convention and is NOT reused here. */
export const BOUND_EXIT_CODES = Object.freeze({ "max-ms": 4, "max-records": 5, "max-candidates": 6, "max-groups": 6 });

export class BoundExceeded extends Error {
  constructor(bound, detail) {
    super(`${bound} exceeded — ${detail}`);
    this.name = "BoundExceeded";
    this.bound = bound;
    this.detail = detail;
    this.exitCode = BOUND_EXIT_CODES[bound];
  }
}

/** The budget object threaded through a run. Every bound is opt-in (`null` = no cap — 硬规则 4 推论二:
 *  "no limit" is expressed by NOT installing a limit, never by a large literal). */
export function makeBudget({ maxMs = null, maxRecords = null, maxCandidates = null, maxGroups = null, t0 = Date.now() } = {}) {
  const breach = (bound, detail) => { throw new BoundExceeded(bound, detail); };
  return {
    maxMs, maxRecords, maxCandidates, maxGroups,
    /** Consulted at every emission boundary AND inside the stream reader, so a 144 MB carrier cannot
     *  outlive `--max-ms` merely because nothing was emitted yet. Breach is `elapsed >= maxMs`, so
     *  `--max-ms 0` means "abort at the first consultation" (deterministic, not a race on the clock). */
    checkTime(now = Date.now()) { if (maxMs !== null && now - t0 >= maxMs) breach("max-ms", `elapsed ${now - t0}ms >= ${maxMs}ms`); },
    countRecords(n) { if (maxRecords !== null && n > maxRecords) breach("max-records", `${n} records > ${maxRecords}`); },
    countCandidates(n) { if (maxCandidates !== null && n > maxCandidates) breach("max-candidates", `${n} candidates > ${maxCandidates}`); },
    countGroups(n) { if (maxGroups !== null && n > maxGroups) breach("max-groups", `${n} groups > ${maxGroups}`); },
  };
}

// ── streaming jsonl reader: O(chunk) memory instead of O(file) ──────────────────────────────────────
/** Call `onLine(line, lineNo)` for every `\n`-terminated line of `file`, reading it in `chunk`-sized
 *  pieces. A 144 MB `.quay/gate-events.jsonl` no longer has to be resident as one string. Multibyte
 *  sequences split across a chunk boundary are held by a `StringDecoder` (the carriers carry CJK text,
 *  so a naive `buf.toString()` per chunk would silently corrupt every straddling character).
 *  Missing file → `{lines:0, missing:true}` (this reader is used on OPTIONAL carriers). */
export function streamLines(file, onLine, { chunk = 1 << 20, budget = null, tickEvery = 20000 } = {}) {
  let fd; try { fd = fs.openSync(file, "r"); } catch { return { lines: 0, missing: true }; }
  const dec = new StringDecoder("utf8");
  const buf = Buffer.allocUnsafe(chunk);
  let rest = ""; let lineNo = 0;
  try {
    for (;;) {
      const read = fs.readSync(fd, buf, 0, chunk, null);
      if (read === 0) break;
      const parts = (rest + dec.write(buf.subarray(0, read))).split("\n");
      rest = parts.pop();
      for (const line of parts) {
        lineNo++; onLine(line, lineNo);
        if (budget && lineNo % tickEvery === 0) budget.checkTime();
      }
    }
    const tail = rest + dec.end();
    if (tail.length) { lineNo++; onLine(tail, lineNo); }
  } finally { fs.closeSync(fd); }
  return { lines: lineNo, missing: false };
}

/** Stream a jsonl carrier, keeping only the rows `pred` accepts. Same row shape the tools used before
 *  (`{line, raw, r}`) so every call site stays a drop-in; unparseable lines are DROPPED and COUNTED. */
export function streamJsonl(file, pred = () => true, { chunk = 1 << 20, budget = null } = {}) {
  const rows = []; let malformed = 0;
  const res = streamLines(file, (line, lineNo) => {
    if (!line.trim()) return;
    let r; try { r = JSON.parse(line); } catch { malformed++; return; }
    if (pred(r)) rows.push({ line: lineNo, raw: line, r });
  }, { chunk, budget });
  return { rows, malformed, missing: res.missing };
}

// ── finding identity: stable across runs, blind to every wall-clock field ───────────────────────────
/** `finding_fp = sha256(subject_key + verdict + sorted evidence sha256s)`. ⛔ No `ts` participates —
 *  neither the record's own emission time nor anything derived from it — so two runs over identical
 *  inputs produce identical fingerprint sets even though every record carries a fresh `ts`. */
export function findingFp(subjectKey, verdict, evidenceSha256s = []) {
  const hashes = [...new Set(evidenceSha256s.filter((h) => typeof h === "string" && h))].sort();
  return sha256([String(subjectKey ?? ""), String(verdict ?? ""), ...hashes].join("\n"));
}

/** Stamp `finding_fp` on every `outcome` / `counterexample` row. The evidence set of a finding is the
 *  set of evidence rows that carry the SAME `subject_key` — the instrument already tags every reading
 *  with the subject it belongs to, so no citation-graph resolution is needed (and in particular none
 *  that would go through `ref`, which for a commit-pinned reading is a sha shared by many subjects).
 *  PURE apart from mutating the rows it is handed. */
export function assignFindingFps(rows) {
  const hashesBySubject = new Map();
  for (const r of rows) {
    if (r.kind !== "evidence" || typeof r.sha256 !== "string") continue;
    const k = String(r.subject_key ?? "");
    if (!hashesBySubject.has(k)) hashesBySubject.set(k, []);
    hashesBySubject.get(k).push(r.sha256);
  }
  for (const r of rows) {
    if (r.kind !== "outcome" && r.kind !== "counterexample") continue;
    const subject = String(r.subject_key ?? "");
    const verdict = r.kind === "outcome" ? (r.rule_verdict ?? r.verdict ?? "") : "counterexample";
    r.finding_fp = findingFp(subject, verdict, hashesBySubject.get(subject) ?? []);
  }
  return rows;
}

// ── the sink: validate with the PRODUCTION store, then write to the caller path ─────────────────────
export class Sink {
  constructor(budget = null) { this.rows = []; this.budget = budget; this.validator = { accepted: 0, refused: 0, reasons: {} }; }
  add(kind, rec) {
    if (this.budget) this.budget.countRecords(this.rows.length + 1);
    const v = validateRecord(kind, rec);
    if (v.ok) this.validator.accepted++;
    else { this.validator.refused++; for (const r of v.reasons) this.validator.reasons[r] = (this.validator.reasons[r] || 0) + 1; }
    const row = { kind, validator_ok: v.ok, validator_reasons: v.ok ? [] : v.reasons, ...rec };
    this.rows.push(row);
    return row;
  }
  write(file) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, this.rows.map((r) => JSON.stringify(r)).join("\n") + "\n"); return file; }
}

/** A commit-pinned reading of ONE source line: `path`+`range` location, `ref` = commit, sha256 of the line. */
export const sourceEvidence = (tool, file, lineNo, text, commit, extra = {}) => ({
  tool, ref: commit, ts: new Date().toISOString(), sha256: sha256(String(text)),
  confidence: { level: "high", basis: "verbatim source line at the named commit" },
  path: file, range: [lineNo, lineNo], ...extra,
});

/** A reading taken from ONE runtime carrier LINE: `carrier:{path,line,line_sha256}`; no commit applies, so
 *  `ref` is the carrier path (the store's third location form, added by the dependency task). */
export const carrierEvidence = (tool, carrierPath, lineNo, lineText, extra = {}) => ({
  tool, ref: carrierPath, ts: new Date().toISOString(), sha256: sha256(String(lineText)),
  confidence: { level: "high", basis: "verbatim carrier line (path + 1-based line + line sha256)" },
  carrier: { path: carrierPath, line: lineNo, line_sha256: sha256(String(lineText)) }, ...extra,
});

// ── git + tree materialisation ─────────────────────────────────────────────────────────────────────
export function makeGit(root) {
  const state = { calls: 0 };
  const git = (args, opts = {}) => { state.calls++; return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 1 << 28, ...opts }); };
  return { git, state };
}

/** Paths the checker + E3 need. (The whole tree is 120 MB; this subset is what `runCheck`/`discoverUnregistered`
 *  and the test-file scan actually read.) */
export const TREE_PATHS = ["CLAUDE.md", "packages", "plugin/scripts", "plugin/skills", "plugin/test"];

/** Materialise the tracked files at `rev` into `dir` (read-only analysis; nothing is written back to the repo).
 *  `extraPaths` adds whatever ELSE the caller's registry reads (a scan of a foreign tree whose files live
 *  outside TREE_PATHS); paths that do not exist at `rev` are dropped by the `ls-tree` filter. */
export function materialize(git, rev, dir, extraPaths = []) {
  const wanted = [...new Set([...TREE_PATHS, ...extraPaths])];
  const existing = git(["ls-tree", "--name-only", rev, "--", ...wanted]).split("\n").filter(Boolean);
  const tar = execFileSync("git", ["-C", git.root ?? ".", "archive", "--format=tar", rev, ...existing], { maxBuffer: 1 << 30 });
  fs.mkdirSync(dir, { recursive: true });
  execFileSync("tar", ["-x", "-C", dir], { input: tar, maxBuffer: 1 << 26 });
  return { dir, rev, paths: existing.length };
}

const isComment = (l) => /^\s*(\/\/|\/\*|\*|\*\/|#)/.test(l);
export function commentAbove(src, line) {
  const lines = String(src).split("\n"); const out = [];
  for (let i = line - 2; i >= 0 && isComment(lines[i]); i--) out.unshift(lines[i]);
  return out.join("\n");
}
export function declSymbol(src, line) {
  const lines = String(src).split("\n");
  for (let i = line - 1; i >= Math.max(0, line - 6); i--) { const m = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(lines[i]); if (m) return m[1]; }
  return null;
}
export function locateLine(spec, line, src) {
  if (line) return line;
  const lines = String(src).split("\n");
  if (spec?.symbol) { const re = new RegExp(`\\b${escapeRe(spec.symbol)}\\b\\s*(:[^=]*)?=`); const i = lines.findIndex((l) => re.test(l)); if (i >= 0) return i + 1; }
  if (spec?.anchor) { const m = new RegExp(spec.anchor).exec(src); if (m) return String(src).slice(0, m.index).split("\n").length; }
  return null;
}

/** Test files the E3 scan reads, at a rev (the same two globs the pre-registered experiment used). */
export function testFileList(git, rev) {
  return git(["ls-tree", "-r", "--name-only", rev])
    .split("\n")
    .filter((p) => /^(packages\/[^/]+\/test\/.+|plugin\/test\/.+)$/.test(p) && /\.(mjs|js|cjs|ts)$/.test(p));
}

// ── the run ─────────────────────────────────────────────────────────────────────────────────────────
export function parseArgs(argv) {
  const has = (n) => argv.includes(n);
  const val = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
  const num = (n) => { const v = val(n, null); return v === null ? null : Number(v); };
  return {
    root: path.resolve(val("--root", process.cwd())),
    pre: val("--pre", null),
    post: val("--post", "develop"),
    labels: val("--labels", null),
    out: val("--out", null),
    provenanceTask: val("--provenance-task", PROVENANCE_TASK_DEFAULT),
    e3Mode: val("--e3-mode", "import"),
    keep: has("--keep-trees"),
    json: has("--json"),
    // ── scan mode (a periodic reading of ONE rev: no labels, no pre/post pair) ──
    scan: has("--scan"),
    rev: val("--rev", "HEAD"),
    registry: val("--registry", null),
    // ── bounds (all opt-in; null = no cap) ──
    maxMs: num("--max-ms"),
    maxRecords: num("--max-records"),
    maxCandidates: num("--max-candidates"),
  };
}

/** Build the candidate rows from ONE checker result. The checker's own `note`/KNOWN_DRIFT `reason`
 *  text is NEVER read here — it carries the human adjudication, i.e. the answer. */
export function buildCandidates(REG, preRes, authVals) {
  const authSpec = Object.fromEntries(REG.authorities.map((a) => [a.id, a]));
  const surfSpec = Object.fromEntries(REG.surfaces.map((s) => [s.id, s]));
  const cands = [];
  for (const k of preRes.knownDrift) { const s = surfSpec[k.surface]; if (!s) continue; cands.push({ id: k.surface, registered: true, authority: s.authority, file: s.file, spec: s, missing: k.missing, extra: k.extra }); }
  for (const d of preRes.discovered) {
    const missing = (authVals[d.authority] || []).filter((v) => !(d.values || []).includes(v));
    cands.push({ id: `discovered:${d.file}:${d.line}`, registered: false, authority: d.authority, file: d.file, line: d.line, values: d.values, missing, extra: [] });
  }
  return { cands, authSpec };
}

/** The per-candidate body — the SAME reading in experiment mode and in scan mode. Returns the row the
 *  caller reports. `preSha`/`preDir` are the rev and tree the candidate set was taken from; `postRes` is
 *  the checker result at the OTHER rev (identical to `preRes` in scan mode, where pre = post = rev). */
export function analyzeCandidate({ c, git, chk, preRes, postRes, preSha, preDir, authSpec, authFirstCache, testFiles, sink, provenanceTask, e3Mode }) {
  const authorityFirstContains = (authId, v) => {
    const key = `${authId}|${v}`; if (key in authFirstCache) return authFirstCache[key];
    const a = authSpec[authId];
    const commits = git(["log", "--reverse", "--format=%H %ct", preSha, "--", a.file]).split("\n").filter(Boolean);
    let res = { state: "not-evaluated", reason: "authority never contained value in history" };
    for (const row of commits) {
      const [h, ct] = row.split(" ");
      let src; try { src = git(["show", `${h}:${a.file}`]); } catch { continue; }
      let ex; try { ex = chk.extract(src, a.extract, a); } catch { continue; }
      const vals = ex && ex.ok && Array.isArray(ex.groups) ? ex.groups.flatMap((g) => g.values) : null;
      if (vals && vals.includes(v)) { res = { state: "found", commit: h, time: Number(ct) }; break; }
    }
    return (authFirstCache[key] = res);
  };
  {
    const abs = path.join(preDir, c.file);
    let src = ""; try { src = fs.readFileSync(abs, "utf8"); } catch { /* unreadable → located by nothing, reported not-evaluated */ }
    const line = locateLine(c.spec, c.line, src);
    const skey = subjectKey(`enum-surface:${c.authority}`, [`${c.file}#${line ?? "?"}`]);
    const lineText = line && src ? (src.split("\n")[line - 1] ?? "") : "";
    const base = sink.add("evidence", sourceEvidence("enum-surface-parity-check", c.file, line ?? 0, lineText, preSha, { subject_key: skey, provenance_task: provenanceTask, reading: { authority: c.authority, missing: c.missing, extra: c.extra } }));

    // E1
    let e1 = { state: "not-evaluated" };
    if (line && c.missing.length) {
      const blame = git(["blame", "-L", `${line},${line}`, "--porcelain", preSha, "--", c.file]);
      const litTime = Number(/committer-time (\d+)/.exec(blame)[1]);
      const auth = c.missing.map((v) => ({ v, ...authorityFirstContains(c.authority, v) }));
      if (auth.every((a) => a.state === "found")) e1 = { state: auth.every((a) => litTime < a.time) ? "stale" : "authored-after", litTime: new Date(litTime * 1000).toISOString(), authority: auth.map((a) => ({ v: a.v, commit: a.commit, time: new Date(a.time * 1000).toISOString() })) };
      else e1 = { state: "not-evaluated", auth };
    }
    const e1r = sink.add("evidence", { tool: "git-blame+git-log", ref: preSha, ts: new Date().toISOString(), sha256: sha256(JSON.stringify(e1)), confidence: { level: e1.state === "not-evaluated" ? "low" : "high", basis: "commit timestamps, position only" }, path: c.file, range: [line ?? 0, line ?? 0], subject_key: skey, provenance_task: provenanceTask, reading: { E1: e1 } });

    // E2
    const block = line && src ? commentAbove(src, line) : null;
    const e2 = block === null ? { state: "not-evaluated" } : { state: "evaluated", named: c.missing.filter((v) => new RegExp(`(^|[^\\w-])${escapeRe(v)}([^\\w-]|$)`).test(block)), block_lines: block ? block.split("\n").length : 0 };
    const e2r = sink.add("evidence", { tool: "comment-block-above-literal", ref: preSha, ts: new Date().toISOString(), sha256: sha256(block ?? ""), confidence: { level: "medium", basis: "position: contiguous comment block directly above the literal" }, path: c.file, range: [line ?? 0, line ?? 0], subject_key: skey, provenance_task: provenanceTask, reading: { E2: e2 } });

    // E3 — both readings: the weak "name" one and the import-resolution fix.
    const sym = line && src ? (c.spec?.symbol || declSymbol(src, line)) : null;
    const e3name = e3Hits({ testFiles, moduleFile: c.file, symbol: sym, mode: "name" });
    const e3fixed = e3Hits({ testFiles, moduleFile: c.file, symbol: sym, mode: "import" });
    const e3 = e3Mode === "name" ? e3name : e3fixed;
    const e3r = sink.add("evidence", { tool: "test-files-importing-literal-module", ref: preSha, ts: new Date().toISOString(), sha256: sha256(JSON.stringify(e3fixed)), confidence: { level: "medium", basis: "test file IMPORTS the literal's own module (specifier resolved) and names the symbol" }, path: c.file, range: [line ?? 0, line ?? 0], subject_key: skey, provenance_task: provenanceTask, reading: { E3: { ...e3fixed, symbol: sym, hits_by_bare_name: e3name.state === "evaluated" ? e3name.hits.length : e3name.state } } });

    const rule = classifySpace({ e1: e1.state, e2, e3 });
    const refs = [base, e1r, e2r, e3r].map((r) => r.ref);
    const driftStmt = `${c.id}: surface is a stale copy that lags authority ${c.authority} (missing ${c.missing.join(",")})`;
    const legitStmt = `${c.id}: surface is an intentional subset of ${c.authority}`;
    const hD = sink.add("hypothesis", { statement: driftStmt, source_evidence: refs, ts: new Date().toISOString(), subject_key: skey, provenance_task: provenanceTask });
    const hL = sink.add("hypothesis", { statement: legitStmt, source_evidence: refs, ts: new Date().toISOString(), subject_key: skey, provenance_task: provenanceTask });
    // counterexamples refute a NAMED hypothesis — carried as the store's own `counterexample` kind.
    const ceOf = [];
    if (e2.state === "evaluated" && e2.named.length) ceOf.push({ of: hD.statement, ev: e2r.ref, why: `comment block above the literal names ${e2.named.join(",")}` });
    if (e3.state === "evaluated" && e3.hits.length) ceOf.push({ of: hD.statement, ev: e3r.ref, why: `test(s) import the literal's module and pin the symbol: ${e3.hits.slice(0, 3).join(",")}` });
    if (e1.state === "stale") ceOf.push({ of: hL.statement, ev: e1r.ref, why: "the literal was last changed before the authority gained the missing value(s)" });
    for (const ce of ceOf) sink.add("counterexample", { counterexample_of: ce.of, source_evidence: [ce.ev], ts: new Date().toISOString(), subject_key: skey, provenance_task: provenanceTask, why: ce.why });
    const exp = sink.add("experiment", { hypothesis_ref: hD.statement, method: "pre-registered rule E1∧¬E2∧¬E3 ⇒ drift; (E2∨E3)∧¬stale ⇒ legit", budget: { git_calls_cap: 4000 }, ts: new Date().toISOString(), subject_key: skey, provenance_task: provenanceTask });
    sink.add("outcome", { experiment_ref: exp.hypothesis_ref, verdict: RULE_TO_STORE_VERDICT[rule], rule_verdict: rule, ts: new Date().toISOString(), subject_key: skey, provenance_task: provenanceTask });

    // post state at the POST rev
    let postState = "not-applicable";
    if (c.registered) {
      const ps = postRes.surfaces.find((s) => s.surface === c.id);
      postState = !ps ? "surface-unregistered" : ps.occurrences.some((o) => c.missing.some((v) => o.missing.includes(v))) ? "persisting" : "resolved";
    } else {
      const pd = postRes.discovered.find((d) => d.file === c.file && JSON.stringify(d.values) === JSON.stringify(c.values));
      postState = pd ? "persisting" : "changed-or-gone";
    }
    return { id: c.id, file: c.file, line, authority: c.authority, missing: c.missing, E1: e1.state, E2: e2.state === "evaluated" ? e2.named : e2.state, E3: e3.state === "evaluated" ? e3.hits.length : e3.state, E3_by_bare_name: e3name.state === "evaluated" ? e3name.hits.length : e3name.state, symbol: sym, verdict: rule, post: postState, subject_key: skey };
  }
}

/** Score the candidate rows against the label set. Labels are read ONLY here, after every verdict exists. */
export function scoreResults(results, { labels, e3Mode }) {
  const score = { e3_mode: e3Mode, tp: [], fp: [], fn: [], tn: [], undetermined_on_labelled: [], unlabelled: [] };
  for (const r of results) {
    const lab = labels[r.id];
    if (!lab) { score.unlabelled.push(`${r.id}=${r.verdict}`); continue; }
    if (r.verdict === RULE_UNDETERMINED) { score.undetermined_on_labelled.push(`${r.id} (label ${lab})`); continue; }
    const predDrift = r.verdict === RULE_DRIFT;
    if (lab === "drift") (predDrift ? score.tp : score.fn).push(r.id);
    else (predDrift ? score.fp : score.tn).push(r.id);
  }
  return score;
}

/** The dependency task's CARRIER, grounded on a real line of its task file. Absent file ⇒ no record
 *  (this is an OPTIONAL provenance anchor, not a reading that failed). */
export function addProvenanceCarrier({ root, sink, provenanceTask }) {
  const provFile = `tasks/${provenanceTask}.md`;
  let provLine = null, provText = "";
  try {
    provText = fs.readFileSync(path.join(root, provFile), "utf8").split("\n");
    const i = provText.findIndex((l) => /^## /.test(l));
    provLine = (i >= 0 ? i : 0) + 1;
  } catch { provLine = null; }
  if (!provLine) return null;
  return sink.add("evidence", carrierEvidence("dependency-task-carrier", provFile, provLine, provText[provLine - 1], { provenance_task: provenanceTask, reading: { why: "the task that supplied this instrument's record kinds/verdicts/provenance form" } }));
}

/** Materialise every test file the E3 scan reads, at `rev`, out of the materialised tree `dir`. */
function readTestFiles(git, rev, dir) {
  return testFileList(git, rev)
    .map((p) => { try { return { path: p, content: fs.readFileSync(path.join(dir, p), "utf8") }; } catch { return { path: p, content: "" }; } })
    .filter((f) => f.content !== "");
}

// ── the runs ─────────────────────────────────────────────────────────────────────────────────────────
/** EXPERIMENT mode (`--pre`/`--post` + labels): the pre-registered 2026-10-11 experiment, unchanged. */
export async function runSpace(opts) {
  const { root, pre, post } = opts;
  if (!pre) throw new Error("--pre <rev> is required");
  if (!["import", "name"].includes(opts.e3Mode)) throw new Error(`--e3-mode must be import|name, got ${opts.e3Mode}`);
  const budget = opts.budget ?? null;
  if (budget) budget.checkTime();
  const { git, state } = makeGit(root);
  const preSha = git(["rev-parse", pre]).trim();
  const postSha = git(["rev-parse", post]).trim();
  const t0 = Date.now();

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arch-discovery-space-"));
  const preDir = path.join(tmp, "pre"), postDir = path.join(tmp, "post");
  materialize(Object.assign(git, { root }), preSha, preDir);
  materialize(Object.assign(git, { root }), postSha, postDir);
  // The checker is imported from the PRE tree: the candidate SET and the registry are the PRE ones.
  const preChk = await loadTreeChecker(preDir);
  const postChk = await loadTreeChecker(postDir);
  const preRes = preChk.runCheck({ root: preDir, registry: preChk.DEFAULT_REGISTRY });
  const postRes = postChk.runCheck({ root: postDir, registry: postChk.DEFAULT_REGISTRY });
  const authVals = Object.fromEntries(preRes.authorities.map((a) => [a.id, a.values]));

  // ── candidates (answer-free fields only — the checker's note/reason text is never read) ──
  const { cands, authSpec } = buildCandidates(preChk.DEFAULT_REGISTRY, preRes, authVals);
  if (budget) budget.countCandidates(cands.length);

  const testFiles = readTestFiles(git, preSha, preDir);
  const sink = new Sink(budget);
  const authFirstCache = {};
  const results = [];
  for (const c of cands) {
    if (budget) budget.checkTime();
    results.push(analyzeCandidate({ c, git, chk: preChk, preRes, postRes, preSha, preDir, authSpec, authFirstCache, testFiles, sink, provenanceTask: opts.provenanceTask, e3Mode: opts.e3Mode }));
  }

  const labels = opts.labels ? JSON.parse(fs.readFileSync(opts.labels, "utf8")) : DEFAULT_LABELS;
  const score = scoreResults(results, { labels, e3Mode: opts.e3Mode });
  addProvenanceCarrier({ root, sink, provenanceTask: opts.provenanceTask });

  // ── A3: time-semantics controls ──
  const a3 = runA3({ root, git, rev: postSha, sink, provenanceTask: opts.provenanceTask, budget });

  const cost = { wall_ms: Date.now() - t0, git_calls: state.calls, candidates: cands.length };
  assignFindingFps(sink.rows);
  if (!opts.keep) fs.rmSync(tmp, { recursive: true, force: true });
  return { tool: TOOL, mode: "experiment", pre: preSha, post: postSha, cost, results, score, a3, validator: sink.validator, sink };
}

/** SCAN mode (`--scan`): score ONE rev (default HEAD) with NO labels. This is the periodic reading —
 *  there is no pre/post pair to compare and no human ruling to score against, so every candidate lands
 *  in `score.unlabelled`. The candidate SET comes from the checker as shipped in THIS instrument's own
 *  checkout (scan asks "what does the current checker say about this tree"), while the analysed tree is
 *  materialised at `--rev` — the two coincide on the default real-data run (`--root` = this repo, HEAD).
 *  A3 is NOT run here: it is a one-off time-semantics control from experiment A3, not a per-scan finding. */
export async function runSpaceScan(opts) {
  const { root } = opts;
  if (!["import", "name"].includes(opts.e3Mode)) throw new Error(`--e3-mode must be import|name, got ${opts.e3Mode}`);
  const budget = opts.budget ?? null;
  if (budget) budget.checkTime();
  const { git, state } = makeGit(root);
  const rev = git(["rev-parse", opts.rev || "HEAD"]).trim();
  const t0 = Date.now();

  const chk = await loadChecker();
  const registry = opts.registry ? JSON.parse(fs.readFileSync(opts.registry, "utf8")) : chk.DEFAULT_REGISTRY;
  // ⛔ An empty registry is NOT a pass — it means nothing was evaluated (硬规则 3b).
  if (!Array.isArray(registry.authorities) || registry.authorities.length === 0) throw new Error("registry has no authorities — nothing would be evaluated");

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arch-discovery-scan-"));
  const dir = path.join(tmp, "tree");
  const registryPaths = [...registry.authorities, ...(registry.surfaces || [])].map((x) => x && x.file).filter(Boolean);
  materialize(Object.assign(git, { root }), rev, dir, registryPaths);
  const res = chk.runCheck({ root: dir, registry });
  const authVals = Object.fromEntries(res.authorities.map((a) => [a.id, a.values]));
  const { cands, authSpec } = buildCandidates(registry, res, authVals);
  if (budget) budget.countCandidates(cands.length);

  const testFiles = readTestFiles(git, rev, dir);
  const sink = new Sink(budget);
  const authFirstCache = {};
  const results = [];
  for (const c of cands) {
    if (budget) budget.checkTime();
    // pre === post === rev, so the same checker result answers both "found now" and "still there".
    results.push(analyzeCandidate({ c, git, chk, preRes: res, postRes: res, preSha: rev, preDir: dir, authSpec, authFirstCache, testFiles, sink, provenanceTask: opts.provenanceTask, e3Mode: opts.e3Mode }));
  }

  const score = scoreResults(results, { labels: {}, e3Mode: opts.e3Mode });   // no labels in scan mode
  addProvenanceCarrier({ root, sink, provenanceTask: opts.provenanceTask });

  const cost = { wall_ms: Date.now() - t0, git_calls: state.calls, candidates: cands.length };
  assignFindingFps(sink.rows);
  if (!opts.keep) fs.rmSync(tmp, { recursive: true, force: true });
  return {
    tool: TOOL, mode: "scan", rev, cost, results, score,
    a3: { skipped: true, reason: "A3 is a one-off time-semantics control from experiment A3; a periodic scan scores the candidate set only" },
    validator: sink.validator, sink,
  };
}

/** Experiment A3 — two time readings of the same fact. Naive = commit offset dropped; aware = offset honoured. */
export function runA3({ root, git, rev, sink, provenanceTask, budget = null }) {
  const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
  // `.quay/gate-events.jsonl` is 144 MB: streaming keeps the run at O(chunk) memory and lets
  // `--max-ms` interrupt the read (a whole-file readSync cannot be interrupted at all).
  const readJsonl = (file, pred = () => true) => streamJsonl(file, pred, { budget });
  // A3a
  const flips = git(["log", rev, "--format=%H\t%cI\t%s", "--grep=^tasks: 翻 .* done"]).split("\n").filter(Boolean).map((l) => {
    const [h, ci, s] = l.split("\t"); const m = /^tasks: 翻 (\S+) done/.exec(s); return m ? { h, ci, task: m[1] } : null;
  }).filter(Boolean);
  const completes = {};
  const ge = readJsonl(path.join(root, ".quay/gate-events.jsonl"), (r) => r.gate === "complete");
  for (const { r, line } of ge.rows) (completes[r.item_id] ||= []).push({ ms: Date.parse(r.timestamp), line });
  const naive = [], aware = []; const strata = {}; let paired = 0, unpaired = 0;
  for (const f of flips) {
    const cs = completes[f.task]; if (!cs) { unpaired++; continue; }
    const awareMs = Date.parse(f.ci);
    const naiveMs = Date.parse(f.ci.slice(0, 19) + "Z");
    const near = cs.reduce((b, c) => (Math.abs(c.ms - awareMs) < Math.abs(b.ms - awareMs) ? c : b));
    const off = /([+-]\d{2}:\d{2})$/.exec(f.ci)?.[1] ?? "Z"; (strata[off] ||= { naive: [], aware: [] });
    strata[off].naive.push(Math.abs(near.ms - naiveMs) / 3.6e6); strata[off].aware.push(Math.abs(near.ms - awareMs) / 3.6e6);
    paired++; aware.push(Math.abs(near.ms - awareMs) / 3.6e6); naive.push(Math.abs(near.ms - naiveMs) / 3.6e6);
  }
  const a3a = { flips: flips.length, paired, unpaired, malformed_gate_lines: ge.malformed, naive_median_h: q(naive, 0.5), aware_median_h: q(aware, 0.5), aware_p90_h: q(aware, 0.9), aware_over_0_5h: aware.filter((x) => x > 0.5).length };
  a3a.post_hoc_strata = Object.fromEntries(Object.entries(strata).map(([k, v]) => [k, { n: v.aware.length, naive_median_h: q(v.naive, 0.5), aware_median_h: q(v.aware, 0.5), aware_over_0_5h: v.aware.filter((x) => x > 0.5).length }]));
  a3a.verdict = paired === 0 ? "not-evaluated" : Math.abs(a3a.naive_median_h - 8) <= 0.5 && a3a.aware_median_h < 0.5 ? "representation-difference" : "unexplained";
  const skA = subjectKey("time-semantics:done-time", ["develop:done-flip-commit", ".quay/gate-events.jsonl#complete"]);
  const evA = sink.add("evidence", { tool: "git-log+gate-events", ref: rev, ts: new Date().toISOString(), sha256: sha256(JSON.stringify(a3a)), confidence: { level: "high", basis: `${paired} paired task done-times` }, scope: "develop done-flips × gate-events complete", flags: ["tz-aware", "tz-naive"], subject_key: skA, provenance_task: provenanceTask, reading: a3a });
  const hA = sink.add("hypothesis", { statement: "dashboard done time drifts ~8h from the gate completion time", source_evidence: [evA.ref], ts: new Date().toISOString(), subject_key: skA, provenance_task: provenanceTask });
  if (a3a.verdict === "representation-difference") {
    sink.add("counterexample", { counterexample_of: hA.statement, source_evidence: [evA.ref], ts: new Date().toISOString(), subject_key: skA, provenance_task: provenanceTask, why: "the ~8h gap exists only when the commit offset is dropped; TZ-aware times agree" });
  }
  sink.add("outcome", { experiment_ref: hA.statement, verdict: a3a.verdict === "representation-difference" ? "refuted" : a3a.verdict === "not-evaluated" ? "not-evaluated" : "undetermined", rule_verdict: `A3a:${a3a.verdict}`, ts: new Date().toISOString(), subject_key: skA, provenance_task: provenanceTask });

  // A3b
  const firstSeen = {};
  const wr = readJsonl(path.join(root, ".quay/worker-round.jsonl"), (r) => r.in_flight_task_starts && Object.keys(r.in_flight_task_starts).length);
  for (const { r, line } of wr.rows) for (const [task, v] of Object.entries(r.in_flight_task_starts)) {
    const ms = typeof v === "number" ? v : Date.parse(v);
    if (!Number.isFinite(ms)) continue;
    (firstSeen[task] ||= new Map()); if (!firstSeen[task].has(ms)) firstSeen[task].set(ms, line);
  }
  const wo = readJsonl(path.join(root, ".quay/worker-outcome.jsonl"), (r) => r.started_at && r.ended_at);
  const deltas = []; const samples = [];
  for (const { r, line } of wo.rows) {
    const s = Date.parse(r.started_at), e = Date.parse(r.ended_at);
    const seen = firstSeen[r.task]; if (!seen) continue;
    const inAttempt = [...seen.keys()].filter((ms) => ms >= s - 3600e3 && ms <= e);
    if (!inAttempt.length) continue;
    const best = inAttempt.reduce((b, ms) => (Math.abs(ms - s) < Math.abs(b - s) ? ms : b));
    deltas.push(Math.abs(best - s) / 1000);
    if (samples.length < 3) samples.push({ task: r.task, outcome_line: line, round_line: seen.get(best), started_at: r.started_at, round_start: new Date(best).toISOString(), delta_s: Math.round((best - s) / 1000) });
  }
  const a3b = { round_rows_with_starts: wr.rows.length, outcome_rows: wo.rows.length, paired: deltas.length, p50_s: q(deltas, 0.5), p90_s: q(deltas, 0.9), max_s: q(deltas, 1), over_60s: deltas.filter((d) => d > 60).length, samples, live_proc_source: "not-evaluated: no /proc sampling in a non-resident run" };
  a3b.verdict = deltas.length === 0 ? "not-evaluated" : a3b.p90_s < 60 ? "consistent" : "divergent-sources";
  const skB = subjectKey("time-semantics:inflight-start", [".quay/worker-round.jsonl#in_flight_task_starts", ".quay/worker-outcome.jsonl#started_at"]);
  const evB = sink.add("evidence", { tool: "worker-round×worker-outcome", ref: rev, ts: new Date().toISOString(), sha256: sha256(JSON.stringify(a3b)), confidence: { level: "medium", basis: "historical pairing; /proc source not sampled" }, scope: "in-flight start sources", flags: ["round-carrier", "outcome"], subject_key: skB, provenance_task: provenanceTask, reading: a3b });
  const hB = sink.add("hypothesis", { statement: "in-flight bar start (round carrier) and historical bar start (outcome) disagree for the same attempt", source_evidence: [evB.ref], ts: new Date().toISOString(), subject_key: skB, provenance_task: provenanceTask });
  if (a3b.verdict === "consistent") sink.add("counterexample", { counterexample_of: hB.statement, source_evidence: [evB.ref], ts: new Date().toISOString(), subject_key: skB, provenance_task: provenanceTask, why: `p90 |Δ| = ${a3b.p90_s}s < 60s across ${a3b.paired} pairs` });
  sink.add("outcome", { experiment_ref: hB.statement, verdict: a3b.verdict === "consistent" ? "refuted" : a3b.verdict === "not-evaluated" ? "not-evaluated" : "undetermined", rule_verdict: `A3b:${a3b.verdict}`, ts: new Date().toISOString(), subject_key: skB, provenance_task: provenanceTask });
  return { a3a, a3b };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────
/** Default output carrier when `--out` is absent: under `.quay/`, and covered by the
 *  `.quay/arch-discovery-shadow/` ignore rule in `.gitignore` (a default run must not leave
 *  untracked files in the shared checkout). */
export const DEFAULT_OUT = ".quay/arch-discovery-shadow/space-records.jsonl";
export const defaultOut = (root) => path.join(root, DEFAULT_OUT);

export async function cli(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const budget = makeBudget({ maxMs: opts.maxMs, maxRecords: opts.maxRecords, maxCandidates: opts.maxCandidates });
  const outFile = opts.out ?? defaultOut(opts.root);
  let out;
  try {
    out = opts.scan ? await runSpaceScan({ ...opts, budget }) : await runSpace({ ...opts, budget });
  } catch (e) {
    if (e instanceof BoundExceeded) { console.error(`${TOOL}: ${e.message} — nothing written to ${outFile}`); return e.exitCode; }
    throw e;
  }
  out.sink.write(outFile);
  const { sink, ...rest } = out;
  const report = { ...rest, out: outFile };
  if (opts.json) { console.log(JSON.stringify(report, null, 1)); return 0; }
  const head = out.mode === "scan"
    ? `arch-discovery-space: SCAN rev=${out.rev.slice(0, 9)}`
    : `arch-discovery-space: pre=${out.pre.slice(0, 9)} post=${out.post.slice(0, 9)}`;
  console.log(`${head} candidates=${out.cost.candidates} git_calls=${out.cost.git_calls} wall_ms=${out.cost.wall_ms} e3_mode=${out.score.e3_mode}`);
  console.log("verdict           post            E1             E2                    E3=fix/name  candidate");
  for (const r of out.results) console.log(`${r.verdict.padEnd(17)} ${String(r.post).padEnd(15)} ${String(r.E1).padEnd(14)} ${JSON.stringify(r.E2).padEnd(21)} ${`${r.E3}/${r.E3_by_bare_name}`.padEnd(12)} ${r.id}`);
  const s = out.score;
  console.log(`\n[e3_mode=${s.e3_mode}] TP=${s.tp.length} FP=${s.fp.length} FN=${s.fn.length} TN=${s.tn.length} abstains-on-labelled=${s.undetermined_on_labelled.length} unlabelled=${s.unlabelled.length}`);
  const fps = new Set(sink.rows.filter((r) => r.finding_fp).map((r) => r.finding_fp));
  console.log(`finding_fp: ${fps.size} distinct over ${sink.rows.filter((r) => r.finding_fp).length} outcome/counterexample rows`);
  if (out.a3.skipped) console.log(`A3 not-applicable: ${out.a3.reason}`);
  else {
    console.log(`A3a ${out.a3.a3a.verdict}: flips=${out.a3.a3a.flips} paired=${out.a3.a3a.paired} naive_median_h=${out.a3.a3a.naive_median_h} aware_median_h=${out.a3.a3a.aware_median_h}`);
    console.log(`A3b ${out.a3.a3b.verdict}: paired=${out.a3.a3b.paired} p90_s=${out.a3.a3b.p90_s}`);
  }
  console.log(`records → ${outFile}  validator: accepted=${sink.validator.accepted} refused=${sink.validator.refused} ${JSON.stringify(sink.validator.reasons)}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli().then((c) => process.exit(c)).catch((e) => { console.error(e && e.stack || String(e)); process.exit(1); });
}
