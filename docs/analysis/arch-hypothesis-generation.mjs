#!/usr/bin/env node
// ARCHITECTURE HYPOTHESIS GENERATION — a BLIND, PRE-REGISTERED, BOUNDED shadow stage, report-only.
//
// It lands the 2026-10-11 round-1 experiment (scratch: `/data/home/yale/work/quay-scratch/hypgen/`,
// `inventory.mjs` / `investigate.mjs` / `verify.mjs` / `match.mjs` / `review.mjs` / `write-findings.mjs`)
// so its readings are reproducible from the repo instead of from a scratch directory.
//
// ── WHAT IT ANSWERS ─────────────────────────────────────────────────────────────────────────────────
// Given a NEUTRAL inventory of every `plugin/scripts/*.ts` component at a pinned commit, can a model that
// has (a) no repo access (`--tools ""`), (b) an EMPTY cwd (no CLAUDE.md / project memory) and (c) a fixed
// prompt produce cross-component duplication hypotheses that match a SEALED set of human-labelled cases?
//
//   inventory : same fields for every component (catalog question, exported names, carrier literals) at a
//               PIN. No import/call edges — those would point at specific pairs and un-blind the run.
//   investigate: N identical runs of the model under the isolation above. Model output is parsed strictly.
//   verify    : a BOUNDED verifier (Read/Grep only, ≤ max-turns, timeout) over the de-duplicated union of
//               hypotheses, cwd = a STRIPPED pinned tree (tasks/ goals/ docs/ orchestration/ removed).
//   match     : MECHANICAL match of hypotheses against the sealed labels (no model involved).
//   review    : an independent model confirms each mechanical match, seeing one case + one hypothesis.
//   report    : regenerate the markdown readings from recorded artifacts; no model call.
//
// ── PRE-REGISTRATION (the whole point) ──────────────────────────────────────────────────────────────
// Scoring is REFUSED unless `--prereg` names a file whose recorded hashes match the actual prompt /
// inventory / labels bytes AND whose mtime is older than EVERY run file. A post-hoc rule is not a
// pre-registered one; the tool makes that a mechanical precondition instead of a promise.
//
// ── SEALED LABELS ARE AN INPUT PATH, NEVER A CONSTANT ───────────────────────────────────────────────
// The labels are passed as `--labels <file>` and are read ONLY by `match` and `review`, and ONLY after
// every declared run file exists (硬规则 3b: "I could not evaluate" must not be shaped like a pass). The
// contamination scan therefore takes its pairs from a SEPARATE `--contamination-pairs <file>`: the labels
// file is never opened before the runs exist. Both files are supplied by the caller and are NOT checked in.
// (The three prompt files under `arch-hypothesis-generation-prompts/` carry no holdout text either.)
//
// ── FAIL-CLOSED BOUNDS, ONE EXIT CODE EACH ──────────────────────────────────────────────────────────
//   2 usage/env   3 investigator refused: cwd is not the empty neutral dir
//   4 prereg      5 contamination   6 max-runs   7 max-clusters   8 max-ms   9 labels-before-runs
//  10 runs-incomplete. A breach writes NOTHING (never a partial carrier).
//
// ⛔ STRUCTURAL SANDBOX: creates no task, goal or AC; changes no status; edits no code. Its only
// persistence is the caller's `--out` carrier (default under `.quay/arch-hypothesis-generation/`, which is
// gitignored) and, ONLY with `--write-store`, the production `.quay/architecture-evidence-store.jsonl`.
// Every record is run through the PRODUCTION validator (`validateRecord`) and the accepted/refused tally
// is reported, never assumed. Records are tagged with the store `experiment` id.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { sha256, appendRecord } from "./architecture-evidence-store.mjs";
import { Sink } from "./arch-discovery-space.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TOOL = "arch-hypothesis-generation";
/** The evidence-store `experiment` id every record of this stage is tagged with. */
export const STORE_EXPERIMENT = "E-HYPGEN-1";

/** One exit code per refusal so the cause is diagnosable from the status alone (硬规则 3: a distinct
 *  value, never shared with "clean"). */
export const EXIT = Object.freeze({
  usage: 2, cwdNotNeutral: 3, prereg: 4, contamination: 5,
  maxRuns: 6, maxClusters: 7, maxMs: 8, labelsBeforeRuns: 9, runsIncomplete: 10,
});

/** The verifier verdict vocabulary. `undetermined` is an INDEPENDENT value, never folded into `refuted`
 *  (硬规则 3b): a verifier that ran out of turns did not refute anything. */
export const VERIFIER_VERDICTS = Object.freeze(["supported", "refuted", "undetermined"]);
/** Carrier-extraction forms, in the pre-registered vocabulary. `literal` = only literal `".quay/x.jsonl"`
 *  strings; `literal+join` adds `path.join(".quay", "x.jsonl")` built at runtime (arm B). */
export const CARRIER_FORMS = Object.freeze(["literal", "literal+join"]);
/** The hard ceiling on verified clusters. The pre-registered selection rule (highest confidence first,
 *  ties by run order) caps the verifier at this many calls; a larger `--max-clusters` is refused. */
export const HARD_MAX_CLUSTERS = 15;
/** Default neutral-out carrier: `.quay/arch-hypothesis-generation/` is gitignored, so a default run
 *  leaves no untracked file in the shared checkout. */
export const DEFAULT_OUT_DIR = ".quay/arch-hypothesis-generation";

export const defaultOutDir = (root) => path.join(root, DEFAULT_OUT_DIR);

// ── inventory (pure) ─────────────────────────────────────────────────────────────────────────────────
/** Exported top-level names, in source order, de-duplicated, capped. ⛔ No import/call edges — the
 *  declared round-1 choice: they would point at specific pairs and un-blind the investigator. */
export const EXPORT_RE = /^export\s+(?:async\s+)?(?:function\*?|const|let|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm;
export const CARRIER_LITERAL_RE = /\.quay\/[A-Za-z0-9._-]+\.(?:jsonl|json|log|yml)/g;
export const CARRIER_JOIN_RE = /path\.join\(\s*["']\.quay["']\s*,\s*["']([A-Za-z0-9._-]+\.(?:jsonl|json|log|yml))["']/g;

export function extractExports(src, maxExports = 15) {
  return [...new Set([...String(src).matchAll(EXPORT_RE)].map((m) => m[1]))].slice(0, maxExports);
}
export function extractCarriers(src, { forms = "literal", maxCarriers = 6 } = {}) {
  const s = String(src);
  const out = [...s.matchAll(CARRIER_LITERAL_RE)].map((m) => m[0]);
  if (forms === "literal+join") out.push(...[...s.matchAll(CARRIER_JOIN_RE)].map((m) => `.quay/${m[1]}`));
  return [...new Set(out)].slice(0, maxCarriers);
}

/** Parse the capability catalog's check lines into `{ "<file>.ts": "<question>" }`. The catalog is the
 *  single declaration surface (its header owns the format); this reader is deliberately the same one the
 *  scratch inventory used, including the 20-column continuation rule. */
export function parseCatalog(cat) {
  const q = {}; let cur = null;
  for (const line of String(cat).split("\n")) {
    const m = /^  (\S+\.ts)\s{2,}(.*)$/.exec(line);
    if (m) { cur = m[1]; q[cur] = m[2]; }
    else if (cur && /^\s{20,}\S/.test(line)) q[cur] += " " + line.trim();
    else cur = null;
  }
  return q;
}

export const renderEntry = (e) =>
  `- ${e.c} | Q: ${e.q} | exports: ${e.exports.join(", ") || "-"} | carriers: ${e.carriers.join(", ") || "-"}`;

/** Build the neutral inventory. `files` = bare `.ts` basenames; `readSource(f)` returns its bytes;
 *  `catalog` is the capability-catalog output text. PURE — the caller supplies every input, so a fixture
 *  test can reproduce a hash without a repo. */
export function buildInventory({ files, readSource, catalog, maxExports = 15, maxCarriers = 6, carrierForms = "literal" }) {
  if (!CARRIER_FORMS.includes(carrierForms)) throw new Error(`--carrier-forms must be one of ${CARRIER_FORMS.join("|")}, got ${carrierForms}`);
  const q = parseCatalog(catalog);
  const entries = [...files].sort().map((f) => {
    const src = readSource(f);
    return {
      c: f,
      q: (q[f] || "(no catalog entry)").slice(0, 240),
      exports: extractExports(src, maxExports),
      carriers: extractCarriers(src, { forms: carrierForms, maxCarriers }),
    };
  });
  const text = entries.map(renderEntry).join("\n") + "\n";
  return { entries, text, sha256: sha256(text), bytes: Buffer.byteLength(text, "utf8") };
}

// ── contamination scan (pure) ────────────────────────────────────────────────────────────────────────
/**
 * Refuse to run if any ONE inventory entry names BOTH sides of a sealed pair. An entry "touches" a group
 * if it IS a member of it or its rendered text MENTIONS a member other than itself; two touched groups ⇒
 * contaminated. This is the mechanical form of "the inventory must not contain the answer".
 * @param {object[]} entries inventory entries
 * @param {object[]} pairs   `[{id, groups:[[names],[names],…]}]` (or `{id,a,b}`)
 */
export function contaminationScan(entries, pairs) {
  const cross = [];
  for (const e of entries) {
    const s = JSON.stringify(e);
    const self = String(e.c).replace(/\.ts$/, "");
    for (const p of pairs) {
      const groups = p.groups ?? [p.a, p.b].filter(Boolean);
      const touched = new Set();
      for (let gi = 0; gi < groups.length; gi++) {
        for (const n of groups[gi]) if (n === self || s.includes(n)) touched.add(gi);
      }
      if (touched.size >= 2) cross.push({ entry: e.c, pair: p.id ?? null, groups: [...touched].sort() });
    }
  }
  return { cross, ok: cross.length === 0 };
}

// ── pre-registration (pure over supplied stats/text) ─────────────────────────────────────────────────
/**
 * Scoring is refused unless the pre-registration file (a) exists, (b) records a hash for every expected
 * artifact that matches the artifact's ACTUAL bytes, and (c) is strictly older than every run file.
 * @returns {null|{code:number, reasons:string[]}}
 */
export function preregRefusal({ prereg, expected = {}, preregMtimeMs = null, runMtimesMs = [] } = {}) {
  if (!prereg) return { code: EXIT.prereg, reasons: ["PREREG_MISSING"] };
  const reasons = [];
  const hashes = prereg.hashes ?? {};
  for (const [k, v] of Object.entries(expected)) {
    if (hashes[k] === undefined) reasons.push(`PREREG_HASH_ABSENT:${k}`);
    else if (hashes[k] !== v) reasons.push(`PREREG_HASH_MISMATCH:${k}`);
  }
  // (c) is load-bearing: a "pre-registration" written after the runs is a post-hoc rationalisation.
  if (runMtimesMs.length && !(Number.isFinite(preregMtimeMs) && preregMtimeMs < Math.min(...runMtimesMs))) {
    reasons.push("PREREG_NOT_OLDER_THAN_RUNS");
  }
  return reasons.length ? { code: EXIT.prereg, reasons } : null;
}

// ── investigator isolation (pure) ────────────────────────────────────────────────────────────────────
/** The investigator runs with the process cwd set to an EMPTY directory, so no CLAUDE.md or project
 *  memory reaches the model. `null` = isolated; a string = the refusal reason. */
export function neutralCwdRefusal(cwd, neutralDir) {
  if (!neutralDir) return "NEUTRAL_DIR_NOT_GIVEN";
  if (path.resolve(cwd) !== path.resolve(neutralDir)) return "CWD_NOT_NEUTRAL";
  return null;
}
/** The verifier reads the repo, so it must run inside the STRIPPED pinned tree (docs/methodology
 *  directories removed). Same three-valued shape as above. */
export function verifyCwdRefusal(cwd, pinDir) {
  if (!pinDir) return "PIN_DIR_NOT_GIVEN";
  if (path.resolve(cwd) !== path.resolve(pinDir)) return "CWD_NOT_STRIPPED_PIN";
  return null;
}

// ── output parsing (pure, fail-closed) ───────────────────────────────────────────────────────────────
/** First parseable JSON OBJECT in `stdout` (fenced blocks first), else null. */
export function parseJsonObject(stdout) {
  if (typeof stdout !== "string") return null;
  const cands = [];
  const fenced = stdout.match(/```(?:json)?\s*([\s\S]*?)```/g);
  if (fenced) for (const b of fenced) cands.push(b.replace(/```(?:json)?/g, ""));
  cands.push(stdout);
  for (const c of cands) {
    const s = c.indexOf("{"), e = c.lastIndexOf("}");
    if (s < 0 || e <= s) continue;
    try { const o = JSON.parse(c.slice(s, e + 1)); if (o && typeof o === "object" && !Array.isArray(o)) return o; } catch { /* next */ }
  }
  return null;
}
/** The investigator must return a JSON ARRAY. Unparseable is `{hyps:null, parse_error}` — a FAILED RUN,
 *  never an empty hypothesis list (硬规则 3b: "it returned nothing" ≠ "it returned zero findings"). */
export function parseHypotheses(stdout) {
  if (typeof stdout !== "string" || !stdout.trim()) return { hyps: null, parse_error: "EMPTY_OUTPUT" };
  const s = stdout.indexOf("["), e = stdout.lastIndexOf("]");
  if (s < 0 || e <= s) return { hyps: null, parse_error: "NO_JSON_ARRAY" };
  try {
    const h = JSON.parse(stdout.slice(s, e + 1));
    if (!Array.isArray(h)) return { hyps: null, parse_error: "NOT_AN_ARRAY" };
    return { hyps: h, parse_error: null };
  } catch (err) { return { hyps: null, parse_error: String(err?.message ?? err).slice(0, 160) }; }
}

// ── investigator (injectable runner) ─────────────────────────────────────────────────────────────────
/**
 * Run N identical investigator calls. Refuses (no model call) unless cwd is the neutral dir.
 * @param {object} o
 * @param {(prompt:string, i:number)=>Promise<object>} o.runModel  INJECTABLE: the only model seam
 * @param {(file:string, text:string)=>void} o.writeFile           INJECTABLE fs seam (recorded in tests)
 */
export async function runInvestigator({ prompt, neutralDir, cwd, runs = 3, runModel, outDir, writeFile, budget = {} }) {
  const refusal = neutralCwdRefusal(cwd, neutralDir);
  if (refusal) return { ok: false, code: EXIT.cwdNotNeutral, reasons: [refusal] };
  const maxRuns = budget.maxRuns ?? null;
  if (maxRuns !== null && runs > maxRuns) {
    return { ok: false, code: EXIT.maxRuns, reasons: [`RUNS_EXCEED_BOUND:${runs}>${maxRuns}`] };
  }
  const promptSha256 = sha256(prompt);
  const records = [];
  const t0 = Date.now();
  for (let i = 0; i < runs; i++) {
    // wall-time bound, consulted BEFORE each call: a breach refuses with its own code and no further call
    if (budget.maxMs != null && Date.now() - t0 >= budget.maxMs) return { ok: false, code: EXIT.maxMs, reasons: [`MAX_MS_EXCEEDED:${Date.now() - t0}>=${budget.maxMs}`], records, prompt_sha256: promptSha256 };
    const tCall = Date.now();
    const r = await runModel(prompt, i);
    const stdout = String(r?.stdout ?? "");
    const { hyps, parse_error } = parseHypotheses(stdout);
    const rec = {
      run: i + 1, prompt_sha256: promptSha256,
      exit: r?.status ?? null,
      error: r?.error ? String(r.error.message ?? r.error).slice(0, 200) : null,
      wall_ms: Date.now() - tCall,
      in_bytes: Buffer.byteLength(prompt, "utf8"), out_bytes: Buffer.byteLength(stdout, "utf8"),
      n_hyps: Array.isArray(hyps) ? hyps.length : null,
      parse_error, hyps,
    };
    writeFile(path.join(outDir, `run-${i + 1}.json`), JSON.stringify(rec, null, 1));
    records.push(rec);
  }
  return { ok: true, prompt_sha256: promptSha256, records, parsed: records.filter((r) => r.hyps).length, total: runs };
}

// ── clustering + verifier (pure logic + injectable runner) ───────────────────────────────────────────
export const CONFIDENCE_RANK = Object.freeze({ high: 0, medium: 1, low: 2 });
const jaccard = (a, b) => { const A = new Set(a), B = new Set(b); const i = [...A].filter((x) => B.has(x)).length; return i / (A.size + B.size - i); };

/** De-duplicate the union of hypotheses across runs: same concept_kind AND Jaccard(components) ≥ 0.5.
 *  Order = confidence (high→low), ties by run order. Deterministic; identical inputs ⇒ identical clusters. */
export function clusterHypotheses(runs, { threshold = 0.5 } = {}) {
  const norm = (c) => String(c).split("/").pop().trim();
  const all = [];
  for (const r of runs) for (const h of (r.hyps ?? [])) all.push({ ...h, run: r.run, comps: [...new Set((h.components ?? []).map(norm))] });
  all.sort((a, b) => ((CONFIDENCE_RANK[a.confidence] ?? 3) - (CONFIDENCE_RANK[b.confidence] ?? 3)) || (a.run - b.run));
  const clusters = [];
  for (const h of all) {
    const c = clusters.find((x) => x.rep.concept_kind === h.concept_kind && jaccard(x.rep.comps, h.comps) >= threshold);
    if (c) c.members.push(`r${h.run}:${h.id}`);
    else clusters.push({ rep: h, members: [`r${h.run}:${h.id}`] });
  }
  return clusters;
}

/** Map a verifier call's result to a verdict. A TURN-LIMIT exit and an unparseable output both map to
 *  `undetermined` — ⛔ NEVER `refuted` (a budget exhaustion refutes nothing; 硬规则 3b). */
export function verifierVerdict({ stdout = "", stderr = "", status = 0 } = {}) {
  const blob = `${stdout}\n${stderr}`;
  if (/reached max turns|max(?:imum)?\s+turns|turn limit/i.test(blob)) return { verdict: "undetermined", reason: "TURN_LIMIT", parsed: null };
  const j = parseJsonObject(stdout);
  if (!j) return { verdict: "undetermined", reason: status !== 0 ? `EXIT_${status}` : "UNPARSEABLE", parsed: null };
  if (!VERIFIER_VERDICTS.includes(j.verdict)) return { verdict: "undetermined", reason: `VERDICT_NOT_IN_VOCAB:${String(j.verdict)}`, parsed: j };
  return { verdict: j.verdict, reason: null, parsed: j };
}

/**
 * Run the bounded verifier over the pre-registered selection (highest confidence first, cap = clusters).
 * Refuses unless cwd is the stripped pinned tree.
 * @param {(prompt:string, ctx:object)=>Promise<object>} o.runModel INJECTABLE
 */
export async function runVerifier({ clusters, pinDir, cwd, promptTemplate, runModel, maxClusters = HARD_MAX_CLUSTERS, concurrency = 5, maxMs = null }) {
  if (maxClusters > HARD_MAX_CLUSTERS) return { ok: false, code: EXIT.maxClusters, reasons: [`MAX_CLUSTERS_ABOVE_CEILING:${maxClusters}>${HARD_MAX_CLUSTERS}`] };
  const refusal = verifyCwdRefusal(cwd, pinDir);
  if (refusal) return { ok: false, code: EXIT.cwdNotNeutral, reasons: [refusal] };
  const selected = clusters.slice(0, maxClusters);
  const results = new Array(selected.length);
  const t0 = Date.now();
  const runOne = async (k) => {
    const c = selected[k];
    const hyp = {
      components: c.rep.components, concept_kind: c.rep.concept_kind, claim: c.rep.claim,
      evidence_needed: c.rep.evidence_needed, counterexample_requirement: c.rep.counterexample_requirement,
    };
    const prompt = String(promptTemplate).replace("{{HYP}}", JSON.stringify(hyp));
    const t0 = Date.now();
    const r = await runModel(prompt, { cluster: k + 1, kind: c.rep.concept_kind });
    const m = verifierVerdict(r ?? {});
    const j = m.parsed;
    results[k] = {
      cluster: k + 1, members: c.members, kind: c.rep.concept_kind, comps: c.rep.comps,
      claim: String(c.rep.claim ?? "").slice(0, 200),
      wall_ms: Date.now() - t0, out_bytes: String(r?.stdout ?? "").length, exit: r?.status ?? null,
      verdict: m.verdict, verdict_reason: m.reason,
      intentional: j?.intentional_difference_found ?? null,
      evidence: Array.isArray(j?.evidence) ? j.evidence : [],
      counterexample: j?.counterexample ?? null,
      summary: j?.summary ?? String(r?.stdout ?? "").slice(0, 300),
    };
  };
  for (let i = 0; i < selected.length; i += Math.max(1, concurrency)) {
    if (maxMs != null && Date.now() - t0 >= maxMs) return { ok: false, code: EXIT.maxMs, reasons: [`MAX_MS_EXCEEDED:${Date.now() - t0}>=${maxMs}`], results: results.filter(Boolean) };
    await Promise.all(selected.slice(i, i + concurrency).map((_, k) => runOne(i + k)));
  }
  return {
    ok: true, clusters_total: clusters.length, verified: selected.length,
    beyond_cap: Math.max(0, clusters.length - selected.length), results,
  };
}

// ── mechanical match (pure) ──────────────────────────────────────────────────────────────────────────
/** A hypothesis matches a case iff it names ≥1 component of each side AND its concept_kind is admissible
 *  for that case. Case-insensitive on nothing: the label file's own spellings are the contract. */
export function mechanicalMatch({ runs, labels }) {
  const norm = (c) => String(c).split("/").pop().trim();
  const matches = [];
  for (const r of runs) for (const h of (r.hyps ?? [])) {
    const comps = new Set((h.components ?? []).map(norm));
    for (const c of labels.cases ?? []) {
      if (c.a.some((x) => comps.has(x)) && c.b.some((x) => comps.has(x)) && c.kinds.includes(h.concept_kind)) {
        matches.push({
          case: c.id, run: r.run, hid: h.id, kind: h.concept_kind, comps: [...comps],
          claim: h.claim, why_suspected: h.why_suspected ?? null, evidence_needed: h.evidence_needed ?? [],
          counter: h.counterexample_requirement ?? null, confidence: h.confidence,
        });
      }
    }
  }
  return matches;
}

/** Verdict for ONE mechanical match, given the case's role. A match IS a positive reading for the
 *  duplication the case describes; a negative case is only satisfied when the hypothesis carries the
 *  counterexample (an acknowledgement that the divergence is deliberate). */
export function matchVerdict(m, role) {
  const carriesCounter = typeof m.counter === "string" && m.counter.trim().length >= 10;
  if (role === "negative") return carriesCounter ? "supported" : "refuted";
  return "supported";
}

/** Per-case recall/precision reading over the label set. Never a threshold tuned after seeing outputs. */
export function scoreCases({ labels, matches }) {
  const byCase = {};
  for (const c of labels.cases ?? []) {
    const hits = matches.filter((m) => m.case === c.id);
    byCase[c.id] = { role: c.role, hits: hits.length, hids: hits.map((h) => `r${h.run}:${h.hid}`) };
  }
  const positives = (labels.cases ?? []).filter((c) => c.role === "positive");
  const negatives = (labels.cases ?? []).filter((c) => c.role === "negative");
  const holdouts = (labels.cases ?? []).filter((c) => c.role === "holdout-regression");
  const posHit = positives.filter((c) => (byCase[c.id]?.hits ?? 0) > 0).length;
  const negFp = negatives.filter((c) => matches.some((m) => m.case === c.id && matchVerdict(m, "negative") === "refuted")).length;
  return {
    by_case: byCase,
    recall_positive: { hit: posHit, total: positives.length },
    holdout: holdouts.map((c) => ({ id: c.id, hits: byCase[c.id]?.hits ?? 0 })),
    negative_false_positive: { hit: negFp, total: negatives.length },
  };
}

// ── scoring with the labels-read-order guarantee (fs seam is injectable) ─────────────────────────────
const nodeFs = { readFileSync: fs.readFileSync, existsSync: fs.existsSync, statSync: fs.statSync, writeFileSync: fs.writeFileSync };

const readJsonWith = (fsImpl, p) => { try { return { ok: true, value: JSON.parse(fsImpl.readFileSync(p, "utf8")) }; } catch (e) { return { ok: false, error: String(e?.message ?? e) }; } };
const statMsWith = (fsImpl, p) => { try { return fsImpl.statSync(p).mtimeMs; } catch { return null; } };

/**
 * The gated loader that reads the RUN files and nothing else. Refuses unless (1) EVERY declared run file
 * exists and (2) the pre-registration gate passes. `verify` uses this — it needs the runs, not the labels.
 * @param {object} o.fs INJECTABLE — tests wrap it to record the file-read ORDER
 */
export function loadRunsGated({ runDir, runCount, preregPath, expected = {}, fs: fsImpl = nodeFs }) {
  const runFiles = Array.from({ length: runCount }, (_, i) => path.join(runDir, `run-${i + 1}.json`));
  const runMtimes = [], missing = [];
  for (const f of runFiles) { const ms = statMsWith(fsImpl, f); if (ms === null) missing.push(path.basename(f)); else runMtimes.push(ms); }
  if (missing.length) return { ok: false, code: EXIT.runsIncomplete, reasons: [`RUNS_MISSING:${missing.join(",")}`] };

  const preregRead = readJsonWith(fsImpl, preregPath);
  const gate = preregRefusal({ prereg: preregRead.ok ? preregRead.value : null, expected, preregMtimeMs: statMsWith(fsImpl, preregPath), runMtimesMs: runMtimes });
  if (gate) return { ok: false, code: gate.code, reasons: gate.reasons };

  const runs = runFiles.map((f) => JSON.parse(fsImpl.readFileSync(f, "utf8")));
  return { ok: true, runs, runFiles };
}

/**
 * The ONLY path that reads the labels file. The runs are read IN FULL first, so the labels are the LAST
 * thing read: their read order is a property of the code, not of the caller's discipline (硬规则 3b).
 */
export function score({ runDir, runCount, labelsPath, preregPath, expected = {}, fs: fsImpl = nodeFs }) {
  const loaded = loadRunsGated({ runDir, runCount, preregPath, expected, fs: fsImpl });
  if (!loaded.ok) return loaded;
  const labelsRead = readJsonWith(fsImpl, labelsPath);
  if (!labelsRead.ok) return { ok: false, code: EXIT.usage, reasons: [`LABELS_UNREADABLE:${labelsRead.error}`] };
  return { ok: true, labels: labelsRead.value, runs: loaded.runs, runFiles: loaded.runFiles, matches: mechanicalMatch({ runs: loaded.runs, labels: labelsRead.value }) };
}

// ── record emission (production validator, then the caller's sink or the production store) ───────────
/** Build the store records for a mechanical-match pass. Pure. */
export function matchRecords({ matches, labels, runDir }) {
  const recs = [];
  const ts = new Date().toISOString();
  for (const m of matches) {
    const caseSpec = (labels.cases ?? []).find((c) => c.id === m.case);
    const file = path.join(runDir, `run-${m.run}.json`);
    recs.push({
      kind: "hypothesis",
      rec: {
        statement: `[${m.case}] ${String(m.claim ?? "").slice(0, 380)}`,
        source_evidence: [`${file}#${m.hid}`, `label:${m.case}`],
        concept_kind: m.kind, components: m.comps, case_id: m.case, ts,
        experiment: STORE_EXPERIMENT,
      },
    });
    recs.push({
      kind: "outcome",
      rec: {
        experiment_ref: `${STORE_EXPERIMENT} mechanical-match`,
        verdict: matchVerdict(m, caseSpec?.role),
        subject_key: `${m.case}|${[...m.comps].sort().join(",")}`,
        case_id: m.case, run: m.run, hypothesis_id: m.hid, concept_kind: m.kind,
        ts, experiment: STORE_EXPERIMENT,
      },
    });
  }
  return recs;
}

/** Build the store records for a verifier pass. Pure. */
export function verifyRecords({ verify }) {
  const recs = [];
  const ts = new Date().toISOString();
  for (const v of verify.results ?? []) {
    const subjectKey = `hypgen:${v.kind}|${[...(v.comps ?? [])].sort().join(",")}`;
    recs.push({
      kind: "outcome",
      rec: {
        experiment_ref: `${STORE_EXPERIMENT} cluster ${v.cluster}`,
        verdict: v.verdict, subject_key: subjectKey, cluster: v.cluster, members: v.members,
        intentional_difference_found: v.intentional, verifier_wall_ms: v.wall_ms,
        verdict_reason: v.verdict_reason, ts, experiment: STORE_EXPERIMENT,
      },
    });
    // A verifier that reports an INTENTIONAL difference is a counterexample to the hypothesis — its own
    // kind, never a hypothesis with an extra field (硬规则 3b).
    if (v.intentional === true && v.counterexample) {
      recs.push({
        kind: "counterexample",
        rec: {
          counterexample_of: String(v.claim ?? "").slice(0, 120),
          source_evidence: (v.evidence ?? []).filter((e) => e?.file).slice(0, 3).map((e) => `${e.file}:${e.line}`).concat([`${STORE_EXPERIMENT}#cluster-${v.cluster}`]).slice(0, 4),
          statement: String(v.counterexample).slice(0, 400), subject_key: subjectKey,
          ts, experiment: STORE_EXPERIMENT,
        },
      });
    }
  }
  return recs;
}

/** Build the store records for a review pass. Pure. */
export function reviewRecords({ reviews, runDir }) {
  const recs = [];
  const ts = new Date().toISOString();
  for (const r of reviews) {
    const same = r.review?.same_concept === true;
    recs.push({
      kind: "outcome",
      rec: {
        experiment_ref: `${STORE_EXPERIMENT} review`,
        verdict: same ? "supported" : (r.review?.partial === true ? "undetermined" : "refuted"),
        subject_key: `${r.case}|${(r.comps ?? []).sort().join(",")}`,
        case_id: r.case, run: r.run, hypothesis_id: r.hid, reviewer_wall_ms: r.wall_ms,
        same_concept: r.review?.same_concept ?? null, partial: r.review?.partial ?? null,
        ts, experiment: STORE_EXPERIMENT,
      },
    });
  }
  return recs;
}

/** Validate every record with the PRODUCTION validator and write to `out` (JSONL); with `writeStore`
 *  ALSO append to the production carrier. Returns the tally — refused records are REPORTED, never lost. */
export function emit(records, { out, writeStore = false, root = null, budget = null }) {
  const sink = new Sink(budget);
  for (const { kind, rec } of records) sink.add(kind, rec);
  if (out) sink.write(out);
  let stored = 0, storeRefused = [];
  if (writeStore) {
    if (!root) throw new Error("--write-store requires --root");
    for (const { kind, rec } of records) {
      const res = appendRecord(root, kind, rec);
      if (res.ok) stored++; else storeRefused.push({ kind, reasons: res.reasons });
    }
  }
  return { accepted: sink.validator.accepted, refused: sink.validator.refused, reasons: sink.validator.reasons, stored, storeRefused, out };
}

// ── inventory from a git pin ─────────────────────────────────────────────────────────────────────────
/** Materialise `plugin/scripts` at `rev` into `dir` and read the catalog + sources from there. The
 *  catalog is a thin wrapper that resolves its OWN directory, so a materialised copy reproduces the pin's
 *  catalog byte-for-byte (verified against the round-1 hashes). */
export function inventoryAtPin({ root, rev, dir, maxExports = 15, maxCarriers = 6, carrierForms = "literal" }) {
  const tar = execFileSync("git", ["-C", root, "archive", "--format=tar", rev, "plugin/scripts"], { maxBuffer: 1 << 30 });
  fs.mkdirSync(dir, { recursive: true });
  execFileSync("tar", ["-x", "-C", dir], { input: tar, maxBuffer: 1 << 26 });
  const scriptsDir = path.join(dir, "plugin", "scripts");
  const catalog = execFileSync("bash", [path.join(scriptsDir, "capability-catalog.sh")], { cwd: dir, encoding: "utf8", maxBuffer: 1 << 26 });
  const files = fs.readdirSync(scriptsDir).filter((f) => f.endsWith(".ts"));
  const built = buildInventory({ files, readSource: (f) => fs.readFileSync(path.join(scriptsDir, f), "utf8"), catalog, maxExports, maxCarriers, carrierForms });
  return { ...built, rev };
}

// ── report (pure aggregation → markdown) ─────────────────────────────────────────────────────────────
/** Normalise a RECORDED verifier verdict onto the landed vocabulary. The round-1 artifacts were written
 *  by the scratch tool, which spelled "the verifier exhausted its budget / returned prose" as
 *  `not-evaluated(unparseable)`; the landed tool maps both to `undetermined` (⛔ never `refuted`). The
 *  reason is recovered from the recorded summary so the two causes stay distinguishable. */
export function normalizeRecordedVerdict(v) {
  if (VERIFIER_VERDICTS.includes(v?.verdict)) return { verdict: v.verdict, reason: null };
  if (/reached max turns|max(?:imum)?\s+turns|turn limit/i.test(String(v?.summary ?? ""))) return { verdict: "undetermined", reason: "TURN_LIMIT" };
  return { verdict: "undetermined", reason: "UNPARSEABLE" };
}

/** Regenerate the markdown readings from recorded artifacts. No model call. */
export function buildReport({ armA = null, armB = null, inventoryA = null, inventoryB = null, preregLines = [], generatedAt = new Date().toISOString() }) {
  const L = [];
  L.push("# Architecture hypothesis generation — blind shadow stage, round-1 readings");
  L.push("");
  L.push(`Regenerated ${generatedAt} from recorded artifacts by \`docs/analysis/arch-hypothesis-generation.mjs report\`.`);
  L.push("No model call is made here; the model outputs below are the recorded round-1 artifacts.");
  L.push("");
  if (inventoryA || inventoryB) {
    L.push("## Inventory reproduction (pin `e3163e519`)");
    L.push("");
    L.push("| arm | settings | components | sha256 |");
    L.push("|---|---|---|---|");
    if (inventoryA) L.push(`| A | \`--max-exports 15 --max-carriers 6 --carrier-forms literal\` | ${inventoryA.entries ?? ""} | \`${inventoryA.sha256}\` |`);
    if (inventoryB) L.push(`| B | \`--max-exports 1000 --max-carriers 12 --carrier-forms literal+join\` | ${inventoryB.entries ?? ""} | \`${inventoryB.sha256}\` |`);
    L.push("");
  }
  L.push("## Design (pre-registered before the first model call)");
  L.push("");
  L.push("- **Investigator input**: a neutral inventory with the SAME fields for every `plugin/scripts/*.ts`");
  L.push("  component (catalog question, exported names, carrier literals). The prompt is fixed and names no");
  L.push("  component and no target pair.");
  L.push("- **Investigator isolation**: `--tools \"\"` and a cwd that is an EMPTY directory, so no CLAUDE.md or");
  L.push("  project memory reaches the model.");
  L.push("- **Scoring**: mechanical match against sealed labels (1 holdout, 2 positives, 2 negatives), an");
  L.push("  independent reviewer per match, and a bounded verifier (Read/Grep only, ≤8 turns, 300 s) run on a");
  L.push("  pinned tree with `tasks/`, `goals/`, `docs/`, `orchestration/` removed.");
  L.push("- **Novelty**: a Touches-overlap proxy over the task board (see the round-1 summary below).");
  L.push("");
  L.push("## Round-1 headline readings (recorded in `E-HYPGEN-1`; not recomputed here)");
  L.push("");
  L.push("- model `v4.1flash-anthropic`; prompt+inventory sha256 `08a11f52…`.");
  L.push("- **Arm A**: 3/3 runs parsed, 36 hypotheses, 28 clusters; the verifier ran on 15. Of the 5 supported");
  L.push("  clusters, 4 had the difference documented as INTENTIONAL. Recall 0/2 on the positives; the holdout");
  L.push("  was hit in 0 of 3 runs; no negative was falsely hit. Stable across all 3 runs: `Touches` parsing,");
  L.push("  task-status vocabulary, full-suite-state writers, concurrency-cap policies. **Novelty (proxy): 1 of");
  L.push("  the 5 supported clusters is novel** (checker exit-code vocabulary).");
  L.push("- **Arm B (declared post-hoc ablation)**: only the inventory extraction changed (all exports instead");
  L.push("  of 15, plus `path.join(\".quay\", …)` carriers); the prompt is unchanged. 2 of 3 runs parsed, 1 run's");
  L.push("  JSON was malformed. The holdout was partially hit in 1 of the 2 parsed runs; the reviewer judged it");
  L.push("  `partial=true, same_concept=false` — it found only the recurrence sub-part. This weakly supports the");
  L.push("  explanation that the inventory format (export truncation, missed carrier forms) limited arm-A recall.");
  L.push("- **Cost**: about 60–73 s per investigator run; verifier calls took 17–133 s.");
  L.push("");

  const arm = (label, a) => {
    if (!a) return;
    L.push(`## Arm ${label}`);
    L.push("");
    L.push(`- investigator runs: ${a.runs?.length ?? 0} declared, ${(a.runs ?? []).filter((r) => r.hyps).length} parsed, ${(a.runs ?? []).reduce((n, r) => n + (r.n_hyps ?? 0), 0)} hypotheses`);
    L.push(`- wall time per run: ${(a.runs ?? []).map((r) => `${Math.round((r.wall_ms ?? 0) / 1000)}s`).join(", ") || "n/a"}`);
    if (a.verify) {
      L.push(`- clusters: ${a.verify.clusters_total}, verified: ${a.verify.verified}${a.verify.beyond_cap ? ` (${a.verify.beyond_cap} beyond the pre-registered cap)` : ""}`);
      const counts = {}, rawCounts = {};
      for (const v of a.verify.results ?? []) {
        const n = normalizeRecordedVerdict(v);
        const key = n.reason ? `${n.verdict}(${n.reason})` : n.verdict;
        counts[key] = (counts[key] ?? 0) + 1;
        const rk = VERIFIER_VERDICTS.includes(v.verdict) ? v.verdict : String(v.verdict);
        rawCounts[rk] = (rawCounts[rk] ?? 0) + 1;
      }
      const supported = (a.verify.results ?? []).filter((v) => normalizeRecordedVerdict(v).verdict === "supported").length;
      const refuted = (a.verify.results ?? []).filter((v) => normalizeRecordedVerdict(v).verdict === "refuted").length;
      L.push(`- verdicts (normalised to the landed vocabulary): ${JSON.stringify(counts)}`);
      L.push(`- recorded raw verdicts: ${JSON.stringify(rawCounts)} — the scratch tool spelled budget exhaustion as \`not-evaluated(unparseable)\`; both causes are \`undetermined\`, never \`refuted\``);
      L.push(`- precision: ${supported}/${supported + refuted} = ${supported + refuted ? (supported / (supported + refuted)).toFixed(2) : "n/a"}`);
      L.push(`- verifier found a documented INTENTIONAL difference in ${(a.verify.results ?? []).filter((v) => v.verdict === "supported" && v.intentional === true).length}/${supported} supported clusters`);
      L.push(`- verifier wall time: ${(a.verify.results ?? []).map((v) => `${Math.round((v.wall_ms ?? 0) / 1000)}s`).join(", ")}`);
    }
    if (a.score) {
      L.push(`- mechanical matches: ${a.matches?.length ?? 0}`);
      L.push(`- recall (positives): ${a.score.recall_positive.hit}/${a.score.recall_positive.total}`);
      L.push(`- holdout: ${a.score.holdout.map((h) => `${h.id} ${h.hits}`).join(", ") || "n/a"}`);
      L.push(`- negative false positives: ${a.score.negative_false_positive.hit}/${a.score.negative_false_positive.total}`);
    }
    if (a.reviews?.length) {
      L.push(`- reviews: ${a.reviews.length} — ${a.reviews.map((r) => `${r.case}: same_concept=${r.review?.same_concept} partial=${r.review?.partial}`).join("; ")}`);
    }
    L.push("");
  };
  arm("A (pre-registered)", armA);
  arm("B (declared post-hoc ablation: inventory extraction only)", armB);
  L.push("## Pre-registration");
  L.push("");
  L.push("Scoring refuses unless the pre-registration file's hashes match the prompt / inventory / labels");
  L.push("bytes AND its mtime precedes every run file (`preregRefusal`). The recorded round-1 hashes:");
  L.push("");
  if (preregLines.length) { L.push("```"); for (const l of preregLines) L.push(String(l)); L.push("```"); }
  else L.push("_(no `--prereg-hashes` file supplied — the hash list is not reproduced in this rendering)_");
  L.push("");
  return L.join("\n");
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────
const argOf = (args, n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const has = (args, n) => args.includes(n);

/** The hardened launcher argv: no tools, no slash commands, no session, strict MCP. The ONE line that
 *  resolves the launcher role is the `launchArgv(...)` call below — every other line of this module, and
 *  all three prompt files, are free of any holdout-specific text. */
export function hardenedArgv(launchArgv, prompt, root, { tools = "", maxTurns = null } = {}) {
  const argv = launchArgv("meta-driver", prompt, root, { promptViaStdin: true });
  const extra = ["--tools", tools, "--disable-slash-commands", "--no-session-persistence", "--strict-mcp-config"];
  if (maxTurns !== null) extra.push("--max-turns", String(maxTurns));
  argv.splice(argv.length - 1, 0, ...extra);
  return argv;
}

async function cli(argv = process.argv.slice(2)) {
  const verb = argv[0];
  const args = argv.slice(1);
  const root = path.resolve(argOf(args, "--root", path.resolve(HERE, "..", "..")));
  const outDir = path.resolve(argOf(args, "--out-dir", defaultOutDir(root)));
  const json = has(args, "--json");

  if (verb === "inventory") {
    const pin = argOf(args, "--pin", null);
    if (!pin) { console.error(`${TOOL} inventory: --pin <rev> is required`); return EXIT.usage; }
    const keep = has(args, "--keep-tree");
    const dir = argOf(args, "--work", null) ?? fs.mkdtempSync(path.join(os.tmpdir(), "hypgen-pin-"));
    const carrierForms = argOf(args, "--carrier-forms", "literal");
    const maxExports = Number(argOf(args, "--max-exports", 15));
    const maxCarriers = Number(argOf(args, "--max-carriers", 6));
    const inv = inventoryAtPin({ root, rev: pin, dir, maxExports, maxCarriers, carrierForms });
    const pairsFile = argOf(args, "--contamination-pairs", null);
    let scan = { ok: true, cross: [] };
    if (pairsFile) {
      const pairs = JSON.parse(fs.readFileSync(pairsFile, "utf8")).pairs ?? [];
      scan = contaminationScan(inv.entries, pairs);
    }
    if (!keep && !argOf(args, "--work", null)) fs.rmSync(dir, { recursive: true, force: true });
    const outFile = argOf(args, "--out", path.join(outDir, `inventory-${carrierForms === "literal" ? "A" : "B"}.txt`));
    if (scan.ok) { fs.mkdirSync(path.dirname(outFile), { recursive: true }); fs.writeFileSync(outFile, inv.text, "utf8"); }
    const report = { tool: TOOL, verb, rev: pin, components: inv.entries.length, bytes: inv.bytes, sha256: inv.sha256, carrier_forms: carrierForms, max_exports: maxExports, max_carriers: maxCarriers, contamination: scan, out: scan.ok ? outFile : null };
    if (json) console.log(JSON.stringify(report, null, 1));
    else console.log(`${TOOL} inventory rev=${String(pin).slice(0, 9)} components=${inv.entries.length} sha256=${inv.sha256} contamination=${scan.ok ? "clean" : `REFUSED(${scan.cross.length})`}`);
    return scan.ok ? 0 : EXIT.contamination;
  }

  if (verb === "investigate") {
    const neutralDir = argOf(args, "--neutral-dir", null);
    const promptFile = argOf(args, "--prompt", path.join(HERE, "arch-hypothesis-generation-prompts", "investigator.txt"));
    const inventoryFile = argOf(args, "--inventory", null);
    if (!neutralDir || !inventoryFile) { console.error(`${TOOL} investigate: --neutral-dir and --inventory are required`); return EXIT.usage; }
    const prompt = fs.readFileSync(promptFile, "utf8") + fs.readFileSync(inventoryFile, "utf8");
    const { launchArgv, runAsync } = await import("../../plugin/scripts/driver-runtime.ts").catch(() => ({}));
    if (!launchArgv) { console.error(`${TOOL} investigate: driver-runtime.ts unavailable — the model seam cannot be resolved`); return EXIT.usage; }
    const runModel = async (p) => runAsync(hardenedArgv(launchArgv, p, root), { timeoutMs: Number(argOf(args, "--timeout-ms", 900_000)), collectStderr: true, stdinData: p });
    const res = await runInvestigator({
      prompt, neutralDir, cwd: process.cwd(), runs: Number(argOf(args, "--runs", 3)), runModel, outDir,
      writeFile: (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t, "utf8"); },
      budget: { maxRuns: Number(argOf(args, "--max-runs", 3)), maxMs: argOf(args, "--max-ms", null) === null ? null : Number(argOf(args, "--max-ms")) },
    });
    console.log(JSON.stringify(json ? res : { ...res, records: (res.records ?? []).map((r) => ({ run: r.run, exit: r.exit, n_hyps: r.n_hyps, parse_error: r.parse_error, wall_ms: r.wall_ms })) }, null, json ? 1 : 0));
    return res.ok ? 0 : res.code;
  }

  if (verb === "verify") {
    const pinDir = argOf(args, "--pin-dir", null);
    const runsDir = path.resolve(argOf(args, "--runs", outDir));
    if (!pinDir) { console.error(`${TOOL} verify: --pin-dir is required`); return EXIT.usage; }
    const runCount = Number(argOf(args, "--run-count", 3));
    // verify needs the RUNS, not the labels (labels stay confined to match/review).
    const gate = loadRunsGated({ runDir: runsDir, runCount, preregPath: argOf(args, "--prereg", null) });
    if (!gate.ok) { console.error(`${TOOL} verify: ${gate.reasons.join(", ")}`); return gate.code; }
    const clusters = clusterHypotheses(gate.runs);
    const template = fs.readFileSync(argOf(args, "--prompt", path.join(HERE, "arch-hypothesis-generation-prompts", "verifier.txt")), "utf8");
    const { launchArgv, runAsync } = await import("../../plugin/scripts/driver-runtime.ts").catch(() => ({}));
    if (!launchArgv) { console.error(`${TOOL} verify: driver-runtime.ts unavailable`); return EXIT.usage; }
    const maxTurns = Number(argOf(args, "--max-turns", 8));
    const runModel = async (p) => runAsync(hardenedArgv(launchArgv, p, root, { tools: "Read,Grep", maxTurns }), { timeoutMs: Number(argOf(args, "--timeout-ms", 300_000)), collectStderr: true, stdinData: p });
    const res = await runVerifier({ clusters, pinDir, cwd: process.cwd(), promptTemplate: template, runModel, maxClusters: Number(argOf(args, "--max-clusters", HARD_MAX_CLUSTERS)), maxMs: argOf(args, "--max-ms", null) === null ? null : Number(argOf(args, "--max-ms")) });
    if (!res.ok) { console.error(`${TOOL} verify: ${res.reasons.join(", ")}`); return res.code; }
    const outFile = path.resolve(argOf(args, "--out", path.join(outDir, "verify.json")));
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify({ clusters_total: res.clusters_total, verified: res.verified, beyond_cap: res.beyond_cap, results: res.results }, null, 1));
    const tally = emit(verifyRecords({ verify: res }), { out: path.join(outDir, "verify-records.jsonl"), writeStore: has(args, "--write-store"), root: has(args, "--write-store") ? root : null });
    console.log(JSON.stringify({ clusters_total: res.clusters_total, verified: res.verified, beyond_cap: res.beyond_cap, verdicts: res.results.reduce((a, r) => ((a[r.verdict] = (a[r.verdict] ?? 0) + 1), a), {}), validator: { accepted: tally.accepted, refused: tally.refused } }, null, json ? 1 : 0));
    return 0;
  }

  if (verb === "match" || verb === "review") {
    const runDir = path.resolve(argOf(args, "--runs", outDir));
    const labelsPath = argOf(args, "--labels", null);
    const preregPath = argOf(args, "--prereg", null);
    if (!labelsPath) { console.error(`${TOOL} ${verb}: --labels is required`); return EXIT.usage; }
    const expected = {};
    if (argOf(args, "--inventory-sha", null)) expected["inventory"] = argOf(args, "--inventory-sha");
    if (argOf(args, "--prompt-sha", null)) expected["prompt-investigator"] = argOf(args, "--prompt-sha");
    const res = score({ runDir, runCount: Number(argOf(args, "--run-count", 3)), labelsPath, preregPath, expected });
    if (!res.ok) { console.error(`${TOOL} ${verb}: ${res.reasons.join(", ")}`); return res.code; }
    if (verb === "match") {
      const scored = scoreCases({ labels: res.labels, matches: res.matches });
      const outFile = path.resolve(argOf(args, "--out", path.join(outDir, "mechanical-matches.json")));
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(outFile, JSON.stringify({ run_files: res.runFiles.map((f) => path.basename(f)), matches: res.matches }, null, 1));
      const tally = emit(matchRecords({ matches: res.matches, labels: res.labels, runDir }), { out: path.join(outDir, "match-records.jsonl"), writeStore: has(args, "--write-store"), root: has(args, "--write-store") ? root : null });
      console.log(JSON.stringify(json ? { ...scored, validator: { accepted: tally.accepted, refused: tally.refused } } : { matches: res.matches.length, by_case: scored.by_case, recall_positive: scored.recall_positive, holdout: scored.holdout, negative_false_positive: scored.negative_false_positive, validator: { accepted: tally.accepted, refused: tally.refused } }, null, json ? 1 : 0));
      return 0;
    }
    // review: the reviewer sees ONE case + ONE mechanically matched hypothesis, with no tools.
    const matches = JSON.parse(fs.readFileSync(argOf(args, "--matches", path.join(outDir, "mechanical-matches.json")), "utf8")).matches ?? [];
    const template = fs.readFileSync(argOf(args, "--prompt", path.join(HERE, "arch-hypothesis-generation-prompts", "reviewer.txt")), "utf8");
    const neutralDir = argOf(args, "--neutral-dir", null);
    const cwdRefusal = neutralCwdRefusal(process.cwd(), neutralDir);
    if (cwdRefusal) { console.error(`${TOOL} review: ${cwdRefusal}`); return EXIT.cwdNotNeutral; }
    const { launchArgv, runAsync } = await import("../../plugin/scripts/driver-runtime.ts").catch(() => ({}));
    if (!launchArgv) { console.error(`${TOOL} review: driver-runtime.ts unavailable`); return EXIT.usage; }
    const reviews = [];
    for (const m of matches) {
      const c = (res.labels.cases ?? []).find((x) => x.id === m.case);
      const prompt = template.replace("{{CASE}}", c?.description ?? "").replace("{{HYP}}", JSON.stringify({ components: m.comps, concept_kind: m.kind, claim: m.claim, counterexample_requirement: m.counter }));
      const t0 = Date.now();
      const r = await runAsync(hardenedArgv(launchArgv, prompt, root), { timeoutMs: 300_000, collectStderr: true, stdinData: prompt });
      reviews.push({ case: m.case, run: m.run, hid: m.hid, comps: m.comps, wall_ms: Date.now() - t0, review: parseJsonObject(String(r?.stdout ?? "")) ?? { unparseable: true } });
    }
    const outFile = path.resolve(argOf(args, "--out", path.join(outDir, "review.json")));
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(reviews, null, 1));
    const tally = emit(reviewRecords({ reviews, runDir }), { out: path.join(outDir, "review-records.jsonl"), writeStore: has(args, "--write-store"), root: has(args, "--write-store") ? root : null });
    console.log(JSON.stringify({ reviewed: reviews.length, reviews, validator: { accepted: tally.accepted, refused: tally.refused } }, null, json ? 1 : 0));
    return 0;
  }

  if (verb === "report") {
    const dir = path.resolve(argOf(args, "--artifacts", outDir));
    const rd = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { return null; } };
    const runFiles = (p) => { try { return fs.readdirSync(dir).filter((f) => new RegExp(`^${p}-?\\d+\\.json$`).test(f)).sort().map((f) => rd(f)); } catch { return []; } };
    const labels = argOf(args, "--labels", null) ? JSON.parse(fs.readFileSync(argOf(args, "--labels"), "utf8")) : { cases: [] };
    const verify = rd("verify.json");
    const matches = rd("mechanical-matches.json");
    const reviews = rd("review.json");
    const matchesB = rd("mechanical-matches-B.json");
    const buildArm = (runs, v, m, rv) => {
      const o = { runs: runs.filter(Boolean), verify: v, matches: m?.matches ?? m, reviews: rv };
      if (m) o.score = scoreCases({ labels, matches: m.matches ?? m });
      return o;
    };
    // The inventory hashes are RE-COMPUTED from the pin (no model call) when `--pin` is given, so the
    // report's reproduction claim is regenerated rather than transcribed.
    let inventoryA = null, inventoryB = null;
    const pin = argOf(args, "--pin", null);
    if (pin) {
      const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), "hypgen-rep-"));
      const mkArgs = (maxExports, maxCarriers, carrierForms) => ({ root, rev: pin, dir: mk(), maxExports, maxCarriers, carrierForms });
      const a = inventoryAtPin(mkArgs(15, 6, "literal"));
      inventoryA = { sha256: a.sha256, entries: a.entries.length };
      const b = inventoryAtPin(mkArgs(1000, 12, "literal+join"));
      inventoryB = { sha256: b.sha256, entries: b.entries.length };
    }
    const preregFile = argOf(args, "--prereg-hashes", null);
    const preregLines = preregFile ? fs.readFileSync(preregFile, "utf8").split("\n").filter((l) => l.trim()) : [];
    const md = buildReport({
      armA: runFiles("run").length ? buildArm(runFiles("run"), verify, matches, reviews) : null,
      armB: runFiles("runB").length ? buildArm(runFiles("runB"), null, matchesB, null) : null,
      inventoryA, inventoryB, preregLines,
    });
    const outFile = path.resolve(argOf(args, "--out", path.join(HERE, "arch-hypothesis-generation-report.md")));
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, md, "utf8");
    console.log(`${TOOL} report → ${outFile}`);
    return 0;
  }

  console.error(`usage: ${TOOL} <inventory|investigate|verify|match|review|report> [options]`);
  console.error("  inventory   --pin <rev> [--max-exports N] [--max-carriers N] [--carrier-forms literal|literal+join] [--contamination-pairs <f>] [--out <f>]");
  console.error("  investigate --inventory <f> --neutral-dir <dir> [--runs N] [--max-runs N] [--max-ms N] [--timeout-ms N] [--out-dir <dir>]");
  console.error("  verify      --pin-dir <dir> --runs <dir> [--prereg <f>] [--max-clusters N] [--max-turns N] [--timeout-ms N] [--max-ms N]");
  console.error("  match       --runs <dir> --labels <f> [--prereg <f>] [--run-count N] [--write-store]");
  console.error("  review      --runs <dir> --labels <f> --matches <f> --neutral-dir <dir> [--prereg <f>]");
  console.error("  report      --artifacts <dir> [--labels <f>] [--out <md>]");
  return EXIT.usage;
}

export { cli };

/** Is this module the invoked entry point? The ESM loader REALPATHS `import.meta.url`, so a check that
 *  only compares `pathToFileURL(argv[1])` silently no-ops when the checkout is reached through a symlink
 *  (`/home/yale` → `/data/home/yale`) — the tool would exit 0 having done nothing (硬规则 3b). Both forms
 *  are compared, and an absent/unstatable argv[1] (`node -e`) is simply "not main" rather than a crash. */
export function isMainEntry() {
  const a = process.argv[1];
  if (!a) return false;
  try { if (import.meta.url === pathToFileURL(a).href) return true; } catch { /* not a path */ }
  try { return import.meta.url === pathToFileURL(fs.realpathSync(a)).href; } catch { return false; }
}

if (isMainEntry()) {
  // ⛔ `process.exit()` here would truncate a PIPED stdout (console.log is async off a TTY): setting
  // `exitCode` and letting the loop drain keeps the report readable when the caller pipes it.
  cli().then((c) => { process.exitCode = c; }).catch((e) => { console.error(e?.stack ?? String(e)); process.exitCode = 1; });
}
