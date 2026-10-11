#!/usr/bin/env node
// ARCHITECTURE HYPOTHESIS GENERATION — a BLIND, PRE-REGISTERED, BOUNDED shadow stage, report-only.
//
// It lands the 2026-10-11 round-1 experiment (scratch: `/data/home/yale/work/quay-scratch/hypgen/`,
// `inventory.mjs` / `investigate.mjs` / `verify.mjs` / `match.mjs` / `review.mjs` / `write-findings.mjs`)
// so its readings are reproducible from the repo instead of from a scratch directory.
//
// ── THE INVENTORY FORMS, AND THE MECHANICAL PRE-VERIFICATION LAYER ──────────────────────────────────
// The round-1 (2026-10-11) acceptance replay measured 6 of 7 refuted clusters as REUSE MISREAD AS
// DUPLICATION: the components named by the hypothesis import ONE shared implementation, which one import
// lookup would settle — a verifier model call (16–70 s) was spent refuting each one. The cause was the
// INVENTORY: it carried exported names but no import edges, so similar export names looked like separate
// implementations. (gap-hypgen-inventory-lacks-import-provenance-so-reuse-reads-as-duplication.)
//   • `--inventory-form neutral` (DEFAULT) is the round-1 form, byte-for-byte frozen — its sha256 at the
//     round-1 pin is a fixed quantity and must not move.
//   • `--inventory-form provenance` is OPT-IN. Every entry gains the same two STRUCTURAL fields:
//     `imports` (repo-relative module + the names taken from it) and `imported_by` (the fan-in modules).
//     Re-exports (`export … from`, `export * from`) are imports like any other. A provenance run is a
//     DIFFERENT experiment: it needs its own new prompt file, hashed in its own pre-registration (the
//     frozen investigator prompt — `19be8974…` — is never touched).
//   • The mechanical layer (`mechanicalRefutation`) runs BEFORE any verifier model call. When the
//     hypothesis's intra-set import edges converge on one component and ≥2 members import from it, the
//     cluster is recorded `refuted` / `shared-implementation` with the import lines as evidence and
//     spends NO model call. Every other cluster goes to the model verifier unchanged.
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
// The gate is REFUSED FROM THE PREREG, not from the command line (gap-hypgen-prereg-gate-trusts-caller-
// and-run-identity-collides): every run's RECORDED `prompt_sha256` is re-derived from the prompt +
// inventory bytes the caller actually supplied, and the labels file is hashed from the bytes just read.
// `--prompt-sha` / `--inventory-sha` survive only as OPTIONAL extra assertions.
// The investigator prompt the runs are bound to is the FROZEN round-1 file, and it is the DEFAULT:
// a reproduction that silently runs on a different prompt is the defect this binds shut.
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
//   4 prereg (every pre-registration refusal: an absent/mismatched hash, a run whose recorded prompt
//     digest does not match the supplied artifacts, a prereg not older than the runs — the REASON string
//     is what distinguishes them)   5 contamination   6 max-runs   7 max-clusters   8 max-ms
//   9 labels-before-runs  10 runs-incomplete. A breach writes NOTHING (never a partial carrier).
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
// Reuse the repo's OWN import parser (硬规则 1 — the parser behind `import-graph-check.ts`): it locates
// the specifier + LINE with the code-position discipline (a mention inside a comment or a string is not
// an edge). This module adds only the imported NAMES, which that parser does not return and which the
// provenance form exists to expose; `resolveSpecifier` maps a relative specifier onto an in-scope node.
import { extractImports, resolveSpecifier } from "../../plugin/scripts/import-graph-check.ts";
// The ONE digest helper, re-exported so a caller (and the tests) hash bytes exactly the way the
// pre-registration gate does — never a second, subtly different convention.
export { sha256 };

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

/** The investigator prompt the runs are bound to. The FROZEN round-1 file is the DEFAULT: a reproduction
 *  that silently runs on a different prompt is exactly the defect this default closes. The reworded text
 *  survives as `investigator.txt` — a named VARIANT, never the default. */
export const PROMPTS_DIR = "arch-hypothesis-generation-prompts";
export const FROZEN_INVESTIGATOR_PROMPT = "investigator-round1-frozen.txt";
export const defaultInvestigatorPrompt = (here = HERE) => path.join(here, PROMPTS_DIR, FROZEN_INVESTIGATOR_PROMPT);

/** The inventoried scope. Component names are normalised ONTO it, so a record written from bare basenames
 *  (round 2) and one written from repo-relative paths (round 1) share ONE `subject_key` and can be joined. */
export const INVENTORY_SCOPE = "plugin/scripts";

/** Directories that MUST be absent from the verifier's pinned tree: their presence means the verifier is
 *  reading the methodology layer, not the code — the exact un-blinding the stripped tree exists to stop. */
export const STRIPPED_DIRS = Object.freeze(["tasks", "goals", "docs", "orchestration"]);

/** Prereg fields that may name the experiment, first present wins. The tool never invents one. */
export const EXPERIMENT_KEYS = Object.freeze(["experiment", "experiment_id", "acceptance_run"]);

// ── inventory (pure) ─────────────────────────────────────────────────────────────────────────────────
/** Exported top-level names, in source order, de-duplicated, capped. ⛔ No import/call edges — the
 *  declared round-1 choice: they would point at specific pairs and un-blind the investigator. */
export const EXPORT_RE = /^export\s+(?:async\s+)?(?:function\*?|const|let|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm;
/** The inventory FORMS. `neutral` is the round-1 form and the DEFAULT (its rendered bytes are a frozen
 *  quantity — the round-1 pin's sha256 must not move); `provenance` is opt-in and adds, for EVERY
 *  component, the two structural fields `imports` / `imported_by`. */
export const INVENTORY_FORMS = Object.freeze(["neutral", "provenance"]);
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

// ── provenance form: the import graph, resolved to repo-relative in-scope modules (pure) ─────────────
/** The SOURCE names a clause imports/exports. `{ a, b as c }` ⇒ `a`, `b` (the name in the DEFINING
 *  module, never the local alias); `*` (a namespace import, or `export *`) ⇒ `["*"]`; a default binding
 *  ⇒ `["default"]`. A re-export clause (`export { x } from "…"`, `export * from "…"`) is read by exactly
 *  the same rule, so a re-export contributes an import edge like any other. */
export function importClauseNames(clause) {
  let c = String(clause ?? "").trim().replace(/^type\s+/, "").trim();
  if (c.startsWith("*")) return ["*"];
  const out = [];
  const bi = c.indexOf("{");
  const head = (bi >= 0 ? c.slice(0, bi) : c).replace(/,\s*$/, "").trim();
  if (head && /^[A-Za-z_$][\w$]*$/.test(head)) out.push("default");
  if (bi >= 0) {
    for (const part of c.slice(bi + 1, c.lastIndexOf("}")).split(",")) {
      const p = part.trim().replace(/^type\s+/, "");
      if (!p) continue;
      const src = p.split(/\s+as\s+/)[0].trim().replace(/^["']|["']$/g, "");
      if (src && /^[A-Za-z_$][\w$]*$/.test(src)) out.push(src);
    }
  }
  return [...new Set(out)];
}

/** The imported SOURCE names of the statement `extractImports` located at `line` with specifier `spec`.
 *  That parser already proved the keyword and `from` sit at CODE positions, so this only has to slice
 *  the clause out — re-reading the statement's lines, since a `import {\n … \n} from "x"` spans several. */
export function importedNames(src, line, spec) {
  const lines = String(src).split("\n");
  let buf = "";
  for (let i = Math.max(0, line - 1); i < Math.min(lines.length, line + 30); i++) {
    buf += (i > line - 1 ? "\n" : "") + lines[i];
    if (buf.includes(`"${spec}"`) || buf.includes(`'${spec}'`)) break;
  }
  const m = /(?:^|[\n;])[ \t]*(?:import|export)\b([\s\S]*?)\bfrom\b/.exec(buf);
  return m ? importClauseNames(m[1]) : [];
}

/** Resolve every inventoried component's ES import edges onto REPO-RELATIVE in-scope modules.
 *  `importsOf(f)` = `[{module, names, line}, …]` sorted deterministically; `importedBy(f)` = the fan-in.
 *  A specifier that does not resolve to an in-scope node (a bare package, a `.json` data import, a file
 *  outside the inventory) is NOT an edge and is dropped — the inventory is closed over its own scope. */
export function buildProvenance({ files, readSource, scope = INVENTORY_SCOPE }) {
  const names = [...files].sort();
  const nodes = new Set(names.map((f) => repoRelComponent(f, scope)));
  const importsOf = new Map();
  for (const f of names) {
    const src = readSource(f);
    const seen = new Map();
    for (const im of extractImports(src)) {
      const module = resolveSpecifier(repoRelComponent(f, scope), im.spec, nodes);
      if (!module) continue;
      const key = `${module}\t${im.line}`;
      const taken = importedNames(src, im.line, im.spec).sort();
      if (seen.has(key)) seen.get(key).names = [...new Set([...seen.get(key).names, ...taken])].sort();
      else seen.set(key, { module, names: taken, line: im.line });
    }
    importsOf.set(f, [...seen.values()].sort((a, b) => (a.module < b.module ? -1 : a.module > b.module ? 1 : 0) || a.line - b.line));
  }
  const importedBy = new Map(names.map((f) => [f, []]));
  for (const f of names) for (const im of importsOf.get(f)) {
    const target = names.find((n) => repoRelComponent(n, scope) === im.module);
    if (target) importedBy.get(target).push(repoRelComponent(f, scope));
  }
  for (const [f, list] of importedBy) importedBy.set(f, [...new Set(list)].sort());
  return { importsOf, importedBy };
}

/** The provenance rendering: the neutral line plus the two structural fields. Named implicitly (-) when
 *  a component imports nothing in scope / nothing imports it. */
export const renderProvenanceEntry = (e) =>
  `${renderEntry(e)} | imports: ${(e.imports ?? []).map((i) => `${i.module}(${i.names.join("|") || "-"})`).join(", ") || "-"} | imported_by: ${(e.imported_by ?? []).join(", ") || "-"}`;

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
export function buildInventory({ files, readSource, catalog, maxExports = 15, maxCarriers = 6, carrierForms = "literal", form = "neutral", scope = INVENTORY_SCOPE }) {
  if (!CARRIER_FORMS.includes(carrierForms)) throw new Error(`--carrier-forms must be one of ${CARRIER_FORMS.join("|")}, got ${carrierForms}`);
  if (!INVENTORY_FORMS.includes(form)) throw new Error(`--inventory-form must be one of ${INVENTORY_FORMS.join("|")}, got ${form}`);
  const q = parseCatalog(catalog);
  const names = [...files].sort();
  // Read each source ONCE: the neutral form reads it for exports/carriers, the provenance form also for
  // its edges, and both must judge the SAME bytes.
  const sources = new Map(names.map((f) => [f, readSource(f)]));
  const prov = form === "provenance" ? buildProvenance({ files: names, readSource: (f) => sources.get(f), scope }) : null;
  const entries = names.map((f) => {
    const src = sources.get(f);
    const e = {
      c: f,
      q: (q[f] || "(no catalog entry)").slice(0, 240),
      exports: extractExports(src, maxExports),
      carriers: extractCarriers(src, { forms: carrierForms, maxCarriers }),
    };
    if (prov) {
      e.imports = prov.importsOf.get(f) ?? [];
      e.imported_by = prov.importedBy.get(f) ?? [];
      // The source hash is NOT rendered (the form declares exactly `imports` + `imported_by`); it travels
      // in the structured artifact and is what the mechanical layer cites as each import line's sha256.
      e.sha256 = sha256(src);
    }
    return e;
  });
  const text = entries.map(form === "provenance" ? renderProvenanceEntry : renderEntry).join("\n") + "\n";
  return { entries, text, sha256: sha256(text), bytes: Buffer.byteLength(text, "utf8"), form };
}

// ── contamination scan (pure) ────────────────────────────────────────────────────────────────────────
/** Entry fields that are STRUCTURAL — a content hash, and (with the `provenance` form) the import /
 *  fan-in EDGES — and are therefore NOT part of the contamination scan. An edge is a neutral repository
 *  fact that every component carries many of, not a label; scanning it would flag the whole inventory
 *  (and it is exactly the signal the mechanical layer reads, never a leak of a sealed pair). */
export const CONTAMINATION_EXCLUDED_FIELDS = Object.freeze(["imports", "imported_by", "sha256"]);

/** The text a contamination cross-mention can hide in: the entry with its STRUCTURAL fields removed.
 *  Byte-for-byte the round-1 behaviour for the `neutral` form (whose entries carry none of them). */
export function contaminationText(e) {
  const o = {};
  for (const k of Object.keys(e ?? {})) if (!CONTAMINATION_EXCLUDED_FIELDS.includes(k)) o[k] = e[k];
  return JSON.stringify(o);
}

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
    const s = contaminationText(e);
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

/** The digest a run MUST record: sha256 of the EXACT text handed to the model (the investigator prompt
 *  file followed by the inventory). The investigator composes and hashes the same pair, so this is a
 *  recomputation of the recorded value, not a second convention. */
export const runPromptDigest = (promptBytes, inventoryBytes) => sha256(`${promptBytes}${inventoryBytes}`);

/**
 * The run⇄prereg binding. `preregRefusal` above can only check hashes the CALLER hands it, so a run made
 * with a different prompt still scored as pre-registered. This closes that: the digest each run RECORDED
 * is re-derived from the prompt + inventory bytes actually supplied and compared.
 * ⛔ 硬规则 3b: "no bytes to compare against" is its OWN refusal (`RUN_PROMPT_UNVERIFIABLE`), never a pass.
 * @returns {null|{code:number, reasons:string[]}}
 */
export function runPromptRefusal({ runs, promptBytes = null, inventoryBytes = null, expectedPromptSha = null } = {}) {
  if (promptBytes == null || inventoryBytes == null) return { code: EXIT.prereg, reasons: ["RUN_PROMPT_UNVERIFIABLE:prompt-or-inventory-bytes-not-supplied"] };
  const digest = runPromptDigest(promptBytes, inventoryBytes);
  const reasons = [];
  for (const r of runs ?? []) {
    const id = r?.run ?? "?";
    if (r?.prompt_sha256 == null) { reasons.push(`RUN_PROMPT_HASH_ABSENT:${id}`); continue; }
    if (r.prompt_sha256 !== digest) reasons.push(`PREREG_HASH_MISMATCH:run-prompt:${id}`);
    // A run that also names the prompt FILE's hash must name the pre-registered one. Absent is fine — the
    // composite digest above already binds it — but a PRESENT-and-different value is a mismatch.
    if (r.prompt_file_sha256 != null && expectedPromptSha != null && r.prompt_file_sha256 !== expectedPromptSha) {
      reasons.push(`PREREG_HASH_MISMATCH:run-prompt-file:${id}`);
    }
  }
  return reasons.length ? { code: EXIT.prereg, reasons } : null;
}

/** The experiment id every record of a pass is tagged with: the caller's flag, else the PREREG's own
 *  field, else `null` (the caller decides what a null means — the tool never invents an id, because an
 *  invented one is indistinguishable from a real round's). */
export function resolveExperimentId({ flag = null, prereg = null } = {}) {
  if (flag) return String(flag);
  for (const k of EXPERIMENT_KEYS) if (prereg && prereg[k]) return String(prereg[k]);
  return null;
}

/** Normalise a component name to a REPO-RELATIVE path. A bare basename is a member of the inventoried
 *  scope; anything already carrying a path is left alone (minus a leading `./`). This is what lets a
 *  round-1 `subject_key` (`plugin/scripts/x.ts`) and a round-2 one (`x.ts`) name the SAME subject. */
export function repoRelComponent(c, scope = INVENTORY_SCOPE) {
  const s = String(c).trim().replace(/^\.\//, "");
  return s.includes("/") ? s : `${scope}/${s}`;
}

// ── investigator isolation (pure) ────────────────────────────────────────────────────────────────────
/** The investigator runs with the process cwd set to an EMPTY directory, so no CLAUDE.md or project
 *  memory reaches the model. `null` = isolated; a string = the refusal reason. */
export function neutralCwdRefusal(cwd, neutralDir) {
  if (!neutralDir) return "NEUTRAL_DIR_NOT_GIVEN";
  if (path.resolve(cwd) !== path.resolve(neutralDir)) return "CWD_NOT_NEUTRAL";
  return null;
}
/**
 * The verifier reads the repo, so it must run inside the STRIPPED pinned tree (docs/methodology
 * directories removed). Same three-valued shape as above.
 * ⛔ Checking `cwd === --pin-dir` alone proves nothing about the tree: the caller can name an
 * UNSTRIPPED directory and the guard passes. The directories are therefore enumerated by POSITION
 * (硬规则 2) and their presence is its own refusal, naming which ones (硬规则 3).
 * `existsSync` is injectable so a fixture can exercise the check without building a tree.
 */
export function verifyCwdRefusal(cwd, pinDir, { existsSync = fs.existsSync } = {}) {
  if (!pinDir) return "PIN_DIR_NOT_GIVEN";
  if (path.resolve(cwd) !== path.resolve(pinDir)) return "CWD_NOT_STRIPPED_PIN";
  const present = STRIPPED_DIRS.filter((d) => { try { return existsSync(path.join(pinDir, d)); } catch { return false; } });
  if (present.length) return `PIN_NOT_STRIPPED:${present.join(",")}`;
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
export async function runInvestigator({ prompt, neutralDir, cwd, runs = 3, runModel, outDir, writeFile, budget = {}, model = null, promptFile = null, promptFileSha256 = null, inventorySha256 = null }) {
  const refusal = neutralCwdRefusal(cwd, neutralDir);
  if (refusal) return { ok: false, code: EXIT.cwdNotNeutral, reasons: [refusal] };
  const maxRuns = budget.maxRuns ?? null;
  if (maxRuns !== null && runs > maxRuns) {
    return { ok: false, code: EXIT.maxRuns, reasons: [`RUNS_EXCEED_BOUND:${runs}>${maxRuns}`] };
  }
  // The model is RECORDED, so an unresolved one is a refusal and not a silent `null` — a run file whose
  // model is unknown cannot be compared with any other run's (硬规则 3b: "did not resolve" ≠ "ran").
  if (!model) return { ok: false, code: EXIT.usage, reasons: ["MODEL_UNRESOLVED"] };
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
      // Which prompt file produced this run, and the hashes binding it: the prompt file's own hash and the
      // inventory's, so the run stays joinable to its pre-registration even without the composite digest.
      model, prompt_file: promptFile, prompt_file_sha256: promptFileSha256, inventory_sha256: inventorySha256,
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

// ── the mechanical pre-verification layer (pure, no model call) ──────────────────────────────────────
/** Index a provenance artifact — an array of entries, or `{entries:[…]}` — by component BASENAME, so a
 *  hypothesis's bare `touches-parser.ts` and the entry's repo-relative module land on one key. */
export function provenanceIndex(provenance) {
  const entries = Array.isArray(provenance) ? provenance : (provenance?.entries ?? []);
  const byBase = new Map();
  for (const e of entries) if (e?.c) byBase.set(path.posix.basename(String(e.c)), e);
  return byBase;
}

/**
 * THE MECHANICAL PRE-VERIFICATION — the verifier's own definition of `refuted` is "the components share a
 * single implementation (one imports the other's function/constant)", and that is DECIDABLE from the
 * import graph. So a model call is spent only when it is not.
 * Predicate (exactly): among the hypothesis's components, the intra-set import edges all converge on ONE
 * component (the DEFINER), and at least TWO members import from it. The definer imports no other member
 * (a second target would break the convergence), so the set is a star. `symbol` = the names EVERY
 * importer takes from the definer — empty when they take different names, and the edge still settles it.
 * ⛔ With no provenance, or fewer than two KNOWN components, this returns `null`: "could not evaluate"
 * must not be shaped like a refutation (硬规则 3b).
 * @returns {null|{definer:string, symbol:string[]|null, importers:string[], evidence:object[]}}
 */
export function sharedImplementation({ components = [], provenance = null } = {}) {
  if (!provenance) return null;
  const byBase = provenanceIndex(provenance);
  const set = [...new Set((components ?? []).map((c) => path.posix.basename(String(c).trim())))].filter((c) => byBase.has(c));
  if (set.length < 2) return null;
  const edges = [];
  for (const c of set) {
    for (const im of byBase.get(c).imports ?? []) {
      const to = path.posix.basename(String(im.module ?? ""));
      if (!to || to === c || !set.includes(to)) continue;
      edges.push({ from: c, to, line: im.line ?? null, names: im.names ?? [] });
    }
  }
  const targets = [...new Set(edges.map((e) => e.to))];
  const importers = [...new Set(edges.map((e) => e.from))];
  if (targets.length !== 1 || importers.length < 2) return null;
  const definer = targets[0];
  const nameSets = importers.map((c) => new Set(edges.filter((e) => e.from === c).flatMap((e) => e.names)));
  const shared = [...(nameSets[0] ?? [])].filter((n) => nameSets.every((s) => s.has(n))).sort();
  const evidence = edges
    .slice()
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0) || (a.line ?? 0) - (b.line ?? 0))
    .map((e) => ({ file: repoRelComponent(e.from), line: e.line, sha256: byBase.get(e.from)?.sha256 ?? null, imports: repoRelComponent(e.to), names: e.names }));
  return { definer: repoRelComponent(definer), symbol: shared.length ? shared : null, importers: importers.map((c) => repoRelComponent(c)).sort(), evidence };
}

/** A pre-verification hit, in the verifier's OWN vocabulary: `refuted` with the reason
 *  `shared-implementation` (⛔ never `undetermined` — import edges are positive evidence, not a budget
 *  exhaustion). `null` ⇒ no mechanical refutation, the cluster goes on to the model verifier unchanged. */
export function mechanicalRefutation({ components = [], provenance = null } = {}) {
  const hit = sharedImplementation({ components, provenance });
  return hit ? { verdict: "refuted", verdict_reason: "shared-implementation", ...hit } : null;
}

/**
 * Run the bounded verifier over the pre-registered selection (highest confidence first, cap = clusters).
 * Refuses unless cwd is the stripped pinned tree. The MECHANICAL layer is applied to every cluster
 * BEFORE the model loop, so a mechanically refuted cluster spends no model call.
 * @param {(prompt:string, ctx:object)=>Promise<object>} o.runModel INJECTABLE
 * @param {object[]|null} o.provenance structural inventory entries (see `sharedImplementation`)
 */
export async function runVerifier({ clusters, pinDir, cwd, promptTemplate, runModel, maxClusters = HARD_MAX_CLUSTERS, concurrency = 5, maxMs = null, provenance = null }) {
  if (maxClusters > HARD_MAX_CLUSTERS) return { ok: false, code: EXIT.maxClusters, reasons: [`MAX_CLUSTERS_ABOVE_CEILING:${maxClusters}>${HARD_MAX_CLUSTERS}`] };
  const refusal = verifyCwdRefusal(cwd, pinDir);
  if (refusal) return { ok: false, code: EXIT.cwdNotNeutral, reasons: [refusal] };
  const selected = clusters.slice(0, maxClusters);
  const results = new Array(selected.length);
  const t0 = Date.now();
  // The mechanical layer is computed for EVERY selected cluster up front (pure, no model call), so a
  // mechanically refuted cluster can never reach `runModel` — the "spends no model call" claim is a
  // property of this loop, not of the caller's discipline.
  const mech = selected.map((c) => mechanicalRefutation({ components: c.rep.components, provenance }));
  const runOne = async (k) => {
    const c = selected[k];
    const hyp = {
      components: c.rep.components, concept_kind: c.rep.concept_kind, claim: c.rep.claim,
      evidence_needed: c.rep.evidence_needed, counterexample_requirement: c.rep.counterexample_requirement,
    };
    if (mech[k]) {
      const m = mech[k];
      results[k] = {
        cluster: k + 1, members: c.members, kind: c.rep.concept_kind, comps: c.rep.comps,
        claim: String(c.rep.claim ?? "").slice(0, 200),
        wall_ms: 0, out_bytes: 0, exit: null,
        verdict: m.verdict, verdict_reason: m.verdict_reason, mechanical: true,
        definer: m.definer, shared_symbol: m.symbol,
        intentional: null, evidence: m.evidence, counterexample: null,
        summary: `shared implementation: ${m.importers.length} components import from ${m.definer}`,
      };
      return;
    }
    const prompt = String(promptTemplate).replace("{{HYP}}", JSON.stringify(hyp));
    const t0 = Date.now();
    const r = await runModel(prompt, { cluster: k + 1, kind: c.rep.concept_kind });
    const m = verifierVerdict(r ?? {});
    const j = m.parsed;
    results[k] = {
      cluster: k + 1, members: c.members, kind: c.rep.concept_kind, comps: c.rep.comps,
      claim: String(c.rep.claim ?? "").slice(0, 200),
      wall_ms: Date.now() - t0, out_bytes: String(r?.stdout ?? "").length, exit: r?.status ?? null,
      verdict: m.verdict, verdict_reason: m.reason, mechanical: false,
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
    beyond_cap: Math.max(0, clusters.length - selected.length),
    mechanical_refuted: mech.filter(Boolean).length,
    results,
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
/** Raw text — the labels hash must be taken over the SAME bytes that are parsed, never a second read. */
const readTextWith = (fsImpl, p) => { try { return { ok: true, text: fsImpl.readFileSync(p, "utf8") }; } catch (e) { return { ok: false, error: String(e?.message ?? e) }; } };
const statMsWith = (fsImpl, p) => { try { return fsImpl.statSync(p).mtimeMs; } catch { return null; } };

/**
 * The gated loader that reads the RUN files and nothing else. Refuses unless (1) EVERY declared run file
 * exists and (2) the pre-registration gate passes. `verify` uses this — it needs the runs, not the labels.
 * @param {object} o.fs INJECTABLE — tests wrap it to record the file-read ORDER
 */
export function loadRunsGated({ runDir, runCount, preregPath, expected = {}, promptBytes = null, inventoryBytes = null, fs: fsImpl = nodeFs }) {
  const runFiles = Array.from({ length: runCount }, (_, i) => path.join(runDir, `run-${i + 1}.json`));
  const runMtimes = [], missing = [];
  for (const f of runFiles) { const ms = statMsWith(fsImpl, f); if (ms === null) missing.push(path.basename(f)); else runMtimes.push(ms); }
  if (missing.length) return { ok: false, code: EXIT.runsIncomplete, reasons: [`RUNS_MISSING:${missing.join(",")}`] };

  const preregRead = readJsonWith(fsImpl, preregPath);
  const prereg = preregRead.ok ? preregRead.value : null;
  const gate = preregRefusal({ prereg, expected, preregMtimeMs: statMsWith(fsImpl, preregPath), runMtimesMs: runMtimes });
  if (gate) return { ok: false, code: gate.code, reasons: gate.reasons };

  const runs = runFiles.map((f) => JSON.parse(fsImpl.readFileSync(f, "utf8")));
  // The declared hashes are checked against the prereg above; the RUNS are bound to the artifacts here.
  const runGate = runPromptRefusal({ runs, promptBytes, inventoryBytes, expectedPromptSha: expected["prompt-investigator"] ?? null });
  if (runGate) return { ok: false, code: runGate.code, reasons: runGate.reasons };
  return { ok: true, runs, runFiles, prereg };
}

/**
 * The ONLY path that reads the labels file. The runs are read IN FULL first, so the labels are the LAST
 * thing read: their read order is a property of the code, not of the caller's discipline (硬规则 3b).
 * The labels' hash is then taken over the bytes JUST read and compared with the prereg's — a labels file
 * edited after the pre-registration therefore refuses (gap-hypgen-prereg-gate-…: the labels were
 * previously never hashed at all, so a post-hoc edit scored as pre-registered).
 */
export function score({ runDir, runCount, labelsPath, preregPath, expected = {}, promptBytes = null, inventoryBytes = null, fs: fsImpl = nodeFs }) {
  const loaded = loadRunsGated({ runDir, runCount, preregPath, expected, promptBytes, inventoryBytes, fs: fsImpl });
  if (!loaded.ok) return loaded;
  const labelsRead = readTextWith(fsImpl, labelsPath);
  if (!labelsRead.ok) return { ok: false, code: EXIT.usage, reasons: [`LABELS_UNREADABLE:${labelsRead.error}`] };
  const declared = (loaded.prereg?.hashes ?? {}).labels;
  if (declared === undefined) return { ok: false, code: EXIT.prereg, reasons: ["PREREG_HASH_ABSENT:labels"] };
  const actual = sha256(labelsRead.text);
  if (declared !== actual) return { ok: false, code: EXIT.prereg, reasons: [`PREREG_HASH_MISMATCH:labels`] };
  let labels; try { labels = JSON.parse(labelsRead.text); } catch (e) { return { ok: false, code: EXIT.usage, reasons: [`LABELS_UNREADABLE:${String(e?.message ?? e)}`] }; }
  return { ok: true, labels, runs: loaded.runs, runFiles: loaded.runFiles, prereg: loaded.prereg, matches: mechanicalMatch({ runs: loaded.runs, labels }) };
}

// ── record emission (production validator, then the caller's sink or the production store) ───────────
/** The `subject_key` for a set of components, in REPO-RELATIVE form so two rounds over the same concept
 *  produce the same key (gap-hypgen-prereg-gate-…: round 1 wrote `plugin/scripts/x.ts`, round 2 wrote
 *  `x.ts`, and the same concept could not be joined). */
export const repoRelSubjectKey = (kind, comps) => `hypgen:${kind}|${comps.map((c) => repoRelComponent(c)).sort().join(",")}`;

/** Build the store records for a mechanical-match pass. Pure. `experiment` comes from the PREREG (see
 *  `resolveExperimentId`) — a hard-coded one makes an acceptance run indistinguishable from round 1. */
export function matchRecords({ matches, labels, runDir, experiment = STORE_EXPERIMENT }) {
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
        concept_kind: m.kind, components: [...m.comps].map((c) => repoRelComponent(c)), case_id: m.case, ts,
        experiment,
      },
    });
    recs.push({
      kind: "outcome",
      rec: {
        experiment_ref: `${experiment} mechanical-match`,
        verdict: matchVerdict(m, caseSpec?.role),
        subject_key: `${m.case}|${[...m.comps].map((c) => repoRelComponent(c)).sort().join(",")}`,
        case_id: m.case, run: m.run, hypothesis_id: m.hid, concept_kind: m.kind,
        ts, experiment,
      },
    });
  }
  return recs;
}

/** Build the store records for a verifier pass. Pure. */
export function verifyRecords({ verify, experiment = STORE_EXPERIMENT }) {
  const recs = [];
  const ts = new Date().toISOString();
  for (const v of verify.results ?? []) {
    const key = repoRelSubjectKey(v.kind, v.comps ?? []);
    recs.push({
      kind: "outcome",
      rec: {
        experiment_ref: `${experiment} cluster ${v.cluster}`,
        verdict: v.verdict, subject_key: key, cluster: v.cluster, members: v.members,
        intentional_difference_found: v.intentional, verifier_wall_ms: v.wall_ms,
        verdict_reason: v.verdict_reason, ts, experiment,
      },
    });
    // A verifier that reports an INTENTIONAL difference is a counterexample to the hypothesis — its own
    // kind, never a hypothesis with an extra field (硬规则 3b).
    if (v.intentional === true && v.counterexample) {
      recs.push({
        kind: "counterexample",
        rec: {
          counterexample_of: String(v.claim ?? "").slice(0, 120),
          source_evidence: (v.evidence ?? []).filter((e) => e?.file).slice(0, 3).map((e) => `${e.file}:${e.line}`).concat([`${experiment}#cluster-${v.cluster}`]).slice(0, 4),
          statement: String(v.counterexample).slice(0, 400), subject_key: key,
          ts, experiment,
        },
      });
    }
  }
  return recs;
}

/** Build the store records for a review pass. Pure. */
export function reviewRecords({ reviews, runDir, experiment = STORE_EXPERIMENT }) {
  const recs = [];
  const ts = new Date().toISOString();
  for (const r of reviews) {
    const same = r.review?.same_concept === true;
    recs.push({
      kind: "outcome",
      rec: {
        experiment_ref: `${experiment} review`,
        verdict: same ? "supported" : (r.review?.partial === true ? "undetermined" : "refuted"),
        subject_key: `${r.case}|${(r.comps ?? []).map((c) => repoRelComponent(c)).sort().join(",")}`,
        case_id: r.case, run: r.run, hypothesis_id: r.hid, reviewer_wall_ms: r.wall_ms,
        same_concept: r.review?.same_concept ?? null, partial: r.review?.partial ?? null,
        ts, experiment,
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
export function inventoryAtPin({ root, rev, dir, maxExports = 15, maxCarriers = 6, carrierForms = "literal", form = "neutral" }) {
  const tar = execFileSync("git", ["-C", root, "archive", "--format=tar", rev, "plugin/scripts"], { maxBuffer: 1 << 30 });
  fs.mkdirSync(dir, { recursive: true });
  execFileSync("tar", ["-x", "-C", dir], { input: tar, maxBuffer: 1 << 26 });
  const scriptsDir = path.join(dir, "plugin", "scripts");
  const catalog = execFileSync("bash", [path.join(scriptsDir, "capability-catalog.sh")], { cwd: dir, encoding: "utf8", maxBuffer: 1 << 26 });
  const files = fs.readdirSync(scriptsDir).filter((f) => f.endsWith(".ts"));
  const built = buildInventory({ files, readSource: (f) => fs.readFileSync(path.join(scriptsDir, f), "utf8"), catalog, maxExports, maxCarriers, carrierForms, form });
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

/**
 * Resolve the launcher module, surfacing the REAL cause. `catch(() => ({}))` collapsed every failure — a
 * missing `node_modules`, a missing export, a syntax error — into "driver-runtime.ts unavailable", which
 * is the shape 硬规则 3b forbids: a cause-free refusal reads like a policy decision rather than an
 * environment fault. (The acceptance run's real cause was `ERR_MODULE_NOT_FOUND: yaml`, in a worktree with
 * no `node_modules`.) `load` is injectable so the failure path is testable without a broken checkout.
 */
export async function importDriverRuntime(load = () => import("../../plugin/scripts/driver-runtime.ts")) {
  let mod;
  try { mod = await load(); }
  catch (err) {
    const code = err?.code ? String(err.code) : "NO_CODE";
    const msg = String(err?.message ?? err).split("\n")[0].slice(0, 300);
    return { ok: false, reason: `DRIVER_RUNTIME_IMPORT_FAILED:${code}:${msg}` };
  }
  if (!mod?.launchArgv) return { ok: false, reason: "DRIVER_RUNTIME_MISSING_EXPORT:launchArgv" };
  if (!mod?.runAsync) return { ok: false, reason: "DRIVER_RUNTIME_MISSING_EXPORT:runAsync" };
  return { ok: true, mod };
}

/** The model the launcher resolved (the `--model <m>` pair in the hardened argv), or `null`. Recording it
 *  is not cosmetic: two runs whose model is unknown cannot be compared, and a recorded `null` is a lie. */
export function modelFromArgv(argv) {
  const a = argv ?? [];
  const i = a.indexOf("--model");
  return i >= 0 && a[i + 1] ? String(a[i + 1]) : null;
}

/** The hashes the PREREG must record, computed from the artifact BYTES the caller supplied — never from a
 *  `--*-sha` flag, which is a claim about the bytes rather than a reading of them. */
export function expectedFromArtifacts({ promptBytes, inventoryBytes }) {
  return { "prompt-investigator": sha256(promptBytes), inventory: sha256(inventoryBytes) };
}

/** `--prompt-sha` / `--inventory-sha` survive as OPTIONAL EXTRA assertions (they are no longer the gate):
 *  a caller that passes one is stating what it believes, and a belief that contradicts the bytes is a
 *  refusal with its own reason. Omitted ⇒ no opinion, and the prereg gate still governs. */
function cliExtraShaRefusals(args, { promptBytes, inventoryBytes }) {
  const reasons = [];
  const ps = argOf(args, "--prompt-sha", null);
  const is = argOf(args, "--inventory-sha", null);
  if (ps && ps !== sha256(promptBytes)) reasons.push("CLI_PROMPT_SHA_MISMATCH");
  if (is && is !== sha256(inventoryBytes)) reasons.push("CLI_INVENTORY_SHA_MISMATCH");
  return reasons;
}

/** The prompt + inventory bytes a run's recorded digest is re-derived from. The prompt defaults to the
 *  FROZEN round-1 file: a reproduction that silently runs on a different prompt is the defect itself. */
function readRunInputs(args) {
  const promptPath = path.resolve(argOf(args, "--investigator-prompt", defaultInvestigatorPrompt()));
  const inventoryPath = argOf(args, "--inventory", null);
  if (!inventoryPath) return { ok: false, reason: "INVENTORY_REQUIRED" };
  try { return { ok: true, promptPath, promptBytes: fs.readFileSync(promptPath, "utf8"), inventoryBytes: fs.readFileSync(inventoryPath, "utf8") }; }
  catch (err) { return { ok: false, reason: `RUN_INPUT_UNREADABLE:${String(err?.message ?? err).split("\n")[0].slice(0, 200)}` }; }
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
    const form = argOf(args, "--inventory-form", "neutral");
    const maxExports = Number(argOf(args, "--max-exports", 15));
    const maxCarriers = Number(argOf(args, "--max-carriers", 6));
    if (!INVENTORY_FORMS.includes(form)) { console.error(`${TOOL} inventory: --inventory-form must be one of ${INVENTORY_FORMS.join("|")}, got ${form}`); return EXIT.usage; }
    const inv = inventoryAtPin({ root, rev: pin, dir, maxExports, maxCarriers, carrierForms, form });
    const pairsFile = argOf(args, "--contamination-pairs", null);
    let scan = { ok: true, cross: [] };
    if (pairsFile) {
      const pairs = JSON.parse(fs.readFileSync(pairsFile, "utf8")).pairs ?? [];
      scan = contaminationScan(inv.entries, pairs);
    }
    if (!keep && !argOf(args, "--work", null)) fs.rmSync(dir, { recursive: true, force: true });
    const tag = form === "provenance" ? "provenance" : (carrierForms === "literal" ? "A" : "B");
    const outFile = argOf(args, "--out", path.join(outDir, `inventory-${tag}.txt`));
    if (scan.ok) { fs.mkdirSync(path.dirname(outFile), { recursive: true }); fs.writeFileSync(outFile, inv.text, "utf8"); }
    // The STRUCTURED sidecar. The rendered text carries exactly the two declared fields; the sidecar adds
    // each component's source sha256, which is what the mechanical layer cites as an import line's hash.
    const entriesFile = argOf(args, "--out-entries", null);
    if (scan.ok && entriesFile) {
      fs.mkdirSync(path.dirname(path.resolve(entriesFile)), { recursive: true });
      fs.writeFileSync(path.resolve(entriesFile), JSON.stringify({ form, rev: pin, sha256: inv.sha256, components: inv.entries.length, entries: inv.entries }, null, 1), "utf8");
    }
    const report = { tool: TOOL, verb, rev: pin, form, components: inv.entries.length, bytes: inv.bytes, sha256: inv.sha256, carrier_forms: carrierForms, max_exports: maxExports, max_carriers: maxCarriers, contamination: scan, out: scan.ok ? outFile : null, entries_out: scan.ok && entriesFile ? path.resolve(entriesFile) : null };
    if (json) console.log(JSON.stringify(report, null, 1));
    else console.log(`${TOOL} inventory rev=${String(pin).slice(0, 9)} form=${form} components=${inv.entries.length} sha256=${inv.sha256} contamination=${scan.ok ? "clean" : `REFUSED(${scan.cross.length})`}`);
    return scan.ok ? 0 : EXIT.contamination;
  }

  if (verb === "investigate") {
    const neutralDir = argOf(args, "--neutral-dir", null);
    const inputs = readRunInputs(args);
    if (!neutralDir) { console.error(`${TOOL} investigate: --neutral-dir is required`); return EXIT.usage; }
    if (!inputs.ok) { console.error(`${TOOL} investigate: ${inputs.reason}`); return EXIT.usage; }
    const promptBytes = inputs.promptBytes, inventoryBytes = inputs.inventoryBytes;
    const prompt = promptBytes + inventoryBytes;
    const runtime = await importDriverRuntime();
    if (!runtime.ok) { console.error(`${TOOL} investigate: ${runtime.reason}`); return EXIT.usage; }
    const { launchArgv, runAsync } = runtime.mod;
    const model = modelFromArgv(hardenedArgv(launchArgv, "", root));
    if (!model) { console.error(`${TOOL} investigate: launchArgv("meta-driver") resolved no --model — refusing to record runs whose model is unknown`); return EXIT.usage; }
    const runModel = async (p) => runAsync(hardenedArgv(launchArgv, p, root), { timeoutMs: Number(argOf(args, "--timeout-ms", 900_000)), collectStderr: true, stdinData: p });
    const res = await runInvestigator({
      prompt, neutralDir, cwd: process.cwd(), runs: Number(argOf(args, "--runs", 3)), runModel, outDir, model,
      promptFile: path.relative(root, inputs.promptPath), promptFileSha256: sha256(promptBytes), inventorySha256: sha256(inventoryBytes),
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
    const inputs = readRunInputs(args);
    if (!inputs.ok) { console.error(`${TOOL} verify: ${inputs.reason}`); return EXIT.usage; }
    const extra = cliExtraShaRefusals(args, inputs);
    if (extra.length) { console.error(`${TOOL} verify: ${extra.join(", ")}`); return EXIT.prereg; }
    // verify needs the RUNS, not the labels (labels stay confined to match/review) — but it must still bind
    // the runs to the pre-registered prompt + inventory, so those two artifacts are required here.
    const gate = loadRunsGated({
      runDir: runsDir, runCount, preregPath: argOf(args, "--prereg", null),
      expected: expectedFromArtifacts(inputs), promptBytes: inputs.promptBytes, inventoryBytes: inputs.inventoryBytes,
    });
    if (!gate.ok) { console.error(`${TOOL} verify: ${gate.reasons.join(", ")}`); return gate.code; }
    const experiment = resolveExperimentId({ flag: argOf(args, "--experiment", null), prereg: gate.prereg }) ?? STORE_EXPERIMENT;
    const clusters = clusterHypotheses(gate.runs);
    const template = fs.readFileSync(argOf(args, "--prompt", path.join(HERE, "arch-hypothesis-generation-prompts", "verifier.txt")), "utf8");
    const runtime = await importDriverRuntime();
    if (!runtime.ok) { console.error(`${TOOL} verify: ${runtime.reason}`); return EXIT.usage; }
    const { launchArgv, runAsync } = runtime.mod;
    const maxTurns = Number(argOf(args, "--max-turns", 8));
    // The provenance sidecar (from `inventory --inventory-form provenance --out-entries`) turns on the
    // MECHANICAL pre-verification layer. Absent ⇒ the verifier behaves exactly as before (no edge data =
    // no mechanical refutation, 硬规则 3b).
    const provenanceFile = argOf(args, "--provenance", null);
    const provenance = provenanceFile ? JSON.parse(fs.readFileSync(provenanceFile, "utf8")) : null;
    const runModel = async (p) => runAsync(hardenedArgv(launchArgv, p, root, { tools: "Read,Grep", maxTurns }), { timeoutMs: Number(argOf(args, "--timeout-ms", 300_000)), collectStderr: true, stdinData: p });
    const res = await runVerifier({ clusters, pinDir, cwd: process.cwd(), promptTemplate: template, runModel, provenance, maxClusters: Number(argOf(args, "--max-clusters", HARD_MAX_CLUSTERS)), maxMs: argOf(args, "--max-ms", null) === null ? null : Number(argOf(args, "--max-ms")) });
    if (!res.ok) { console.error(`${TOOL} verify: ${res.reasons.join(", ")}`); return res.code; }
    const outFile = path.resolve(argOf(args, "--out", path.join(outDir, "verify.json")));
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify({ clusters_total: res.clusters_total, verified: res.verified, beyond_cap: res.beyond_cap, mechanical_refuted: res.mechanical_refuted, results: res.results }, null, 1));
    const tally = emit(verifyRecords({ verify: res, experiment }), { out: path.join(outDir, "verify-records.jsonl"), writeStore: has(args, "--write-store"), root: has(args, "--write-store") ? root : null });
    console.log(JSON.stringify({ clusters_total: res.clusters_total, verified: res.verified, beyond_cap: res.beyond_cap, mechanical_refuted: res.mechanical_refuted, verdicts: res.results.reduce((a, r) => ((a[r.verdict] = (a[r.verdict] ?? 0) + 1), a), {}), validator: { accepted: tally.accepted, refused: tally.refused } }, null, json ? 1 : 0));
    return 0;
  }

  if (verb === "match" || verb === "review") {
    const runDir = path.resolve(argOf(args, "--runs", outDir));
    const labelsPath = argOf(args, "--labels", null);
    const preregPath = argOf(args, "--prereg", null);
    if (!labelsPath) { console.error(`${TOOL} ${verb}: --labels is required`); return EXIT.usage; }
    const inputs = readRunInputs(args);
    if (!inputs.ok) { console.error(`${TOOL} ${verb}: ${inputs.reason}`); return EXIT.usage; }
    const extra = cliExtraShaRefusals(args, inputs);
    if (extra.length) { console.error(`${TOOL} ${verb}: ${extra.join(", ")}`); return EXIT.prereg; }
    const res = score({
      runDir, runCount: Number(argOf(args, "--run-count", 3)), labelsPath, preregPath,
      expected: expectedFromArtifacts(inputs), promptBytes: inputs.promptBytes, inventoryBytes: inputs.inventoryBytes,
    });
    if (!res.ok) { console.error(`${TOOL} ${verb}: ${res.reasons.join(", ")}`); return res.code; }
    // The experiment id is read from the PREREG (`--experiment` overrides): a constant here is what made an
    // acceptance run's records indistinguishable from round 1's.
    const experiment = resolveExperimentId({ flag: argOf(args, "--experiment", null), prereg: res.prereg }) ?? STORE_EXPERIMENT;
    if (verb === "match") {
      const scored = scoreCases({ labels: res.labels, matches: res.matches });
      const outFile = path.resolve(argOf(args, "--out", path.join(outDir, "mechanical-matches.json")));
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(outFile, JSON.stringify({ run_files: res.runFiles.map((f) => path.basename(f)), matches: res.matches }, null, 1));
      const tally = emit(matchRecords({ matches: res.matches, labels: res.labels, runDir, experiment }), { out: path.join(outDir, "match-records.jsonl"), writeStore: has(args, "--write-store"), root: has(args, "--write-store") ? root : null });
      console.log(JSON.stringify(json ? { ...scored, validator: { accepted: tally.accepted, refused: tally.refused } } : { matches: res.matches.length, by_case: scored.by_case, recall_positive: scored.recall_positive, holdout: scored.holdout, negative_false_positive: scored.negative_false_positive, validator: { accepted: tally.accepted, refused: tally.refused } }, null, json ? 1 : 0));
      return 0;
    }
    // review: the reviewer sees ONE case + ONE mechanically matched hypothesis, with no tools.
    const matches = JSON.parse(fs.readFileSync(argOf(args, "--matches", path.join(outDir, "mechanical-matches.json")), "utf8")).matches ?? [];
    const template = fs.readFileSync(argOf(args, "--prompt", path.join(HERE, "arch-hypothesis-generation-prompts", "reviewer.txt")), "utf8");
    const neutralDir = argOf(args, "--neutral-dir", null);
    const cwdRefusal = neutralCwdRefusal(process.cwd(), neutralDir);
    if (cwdRefusal) { console.error(`${TOOL} review: ${cwdRefusal}`); return EXIT.cwdNotNeutral; }
    const runtime = await importDriverRuntime();
    if (!runtime.ok) { console.error(`${TOOL} review: ${runtime.reason}`); return EXIT.usage; }
    const { launchArgv, runAsync } = runtime.mod;
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
    const tally = emit(reviewRecords({ reviews, runDir, experiment }), { out: path.join(outDir, "review-records.jsonl"), writeStore: has(args, "--write-store"), root: has(args, "--write-store") ? root : null });
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
  console.error(`  The investigator prompt defaults to the FROZEN round-1 file (${FROZEN_INVESTIGATOR_PROMPT});`);
  console.error("  `investigator.txt` is the reworded VARIANT and is never the default. Every run records the prompt");
  console.error("  file it used plus that file's hash, and the pre-registration gate re-derives each run's recorded");
  console.error("  prompt digest from the prompt + inventory bytes supplied here (--prompt-sha / --inventory-sha are");
  console.error("  optional extra assertions, never the gate).");
  console.error("  inventory   --pin <rev> [--inventory-form neutral|provenance] [--max-exports N] [--max-carriers N] [--carrier-forms literal|literal+join] [--contamination-pairs <f>] [--out <f>] [--out-entries <f>]");
  console.error("              --inventory-form provenance adds `imports` / `imported_by` to every entry (opt-in; the");
  console.error("              neutral form is the DEFAULT and its bytes are frozen). A provenance run needs its OWN");
  console.error("              prompt file + pre-registration; the frozen investigator prompt is never touched.");
  console.error("  investigate --inventory <f> --neutral-dir <dir> [--investigator-prompt <f>] [--runs N] [--max-runs N] [--max-ms N] [--timeout-ms N] [--out-dir <dir>]");
  console.error("  verify      --pin-dir <dir> --runs <dir> --inventory <f> [--provenance <f>] [--prereg <f>] [--investigator-prompt <f>] [--experiment <id>] [--max-clusters N] [--max-turns N] [--max-ms N]");
  console.error("              --provenance <f> turns on the MECHANICAL pre-verification layer: a cluster whose members'");
  console.error("              edges converge on one component is recorded refuted/shared-implementation with NO model call.");
  console.error("  match       --runs <dir> --labels <f> --inventory <f> [--prereg <f>] [--investigator-prompt <f>] [--experiment <id>] [--run-count N] [--write-store]");
  console.error("  review      --runs <dir> --labels <f> --matches <f> --neutral-dir <dir> --inventory <f> [--prereg <f>] [--experiment <id>]");
  console.error("  report      --artifacts <dir> [--labels <f>] [--out <md>]");
  console.error("  --experiment <id> overrides the id read from the prereg (fields: experiment | experiment_id | acceptance_run).");
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
