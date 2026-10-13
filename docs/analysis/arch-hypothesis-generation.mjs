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
//   • The mechanical layer (`sharedImplementation`) runs BEFORE any verifier model call and produces
//     EVIDENCE, ⛔ never a verdict (gap-hypgen-mechanical-shared-implementation-layer-false-refutes).
//     It fired as a refutation until 2026-10-12: "the intra-set import edges converge on one component
//     and ≥2 members import from it" was recorded `refuted` / `shared-implementation` and spent NO model
//     call. Measured in `E-DT-1` (Hf c4/c14/c15, Hp c3/c6/c15), EVERY one of those 6 refutations had ≥2
//     named components that do not import the definer — the rule never looked at them — and one of them
//     (Hf c15) is a CONFIRMED REAL DEFECT. A stricter variant is not safe either: `E-HYPGEN-AB-1` arm A
//     c15 (the inert `routine_quota.window_ms`) has every component importing the definer and is still
//     real, because importing a constant is not consuming it. An import edge is evidence about REUSE.
//     The finding is now attached to the cluster's evidence pack — the converging import lines AND the
//     named components that do NOT import the definer (and those the inventory does not cover) — and
//     every cluster, including a perfect star, goes to the model verifier.
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
// `--arm <id>` scopes the gate to ONE ARM of a pre-registered A/B experiment: the expected keys become
// `prompt-investigator-<id>` / `inventory-<id>`, so a single prereg written before every run covers both
// arms (gap-hypgen-prereg-gate-is-single-arm-so-ab-arm-b-cannot-be-scored). An arm key the prereg does not
// carry refuses as `PREREG_HASH_ABSENT:…-<id>` — never a silent fallback to the unscoped keys. Omitted,
// the keys are today's and every byte of the single-arm behaviour is preserved.
//
// ── SEALED LABELS ARE AN INPUT PATH, NEVER A CONSTANT ───────────────────────────────────────────────
// The labels are passed as `--labels <file>` and are read ONLY by `match` and `review`, and ONLY after
// every declared run file exists (硬规则 3b: "I could not evaluate" must not be shaped like a pass). The
// contamination scan therefore takes its pairs from a SEPARATE `--contamination-pairs <file>`: the labels
// file is never opened before the runs exist. Both files are supplied by the caller and are NOT checked in.
// (The three prompt files under `arch-hypothesis-generation-prompts/` carry no holdout text either.)
//
// ── OBSERVABILITY OF THE VERIFIER'S TURN BUDGET, SCOPE ENFORCEMENT, AND THE EVIDENCE PACK ───────────
// The acceptance verify file (`E-HYPGEN-ACCEPT-1`) showed 7 of 15 clusters `undetermined` at the 8-turn
// limit, each output a 28-byte `Error: Reached max turns (8)`, and NO trace of which turns consumed the
// budget (the run is `--no-session-persistence` and recorded only the final stdout). Three additions:
//   • INSTRUMENTATION. Every verify call runs with `--output-format stream-json`; `parseVerifierStream`
//     turns the stream into a per-turn record (tool, argument head, result bytes). In that mode the CLI
//     prints no "Reached max turns" text at all, so exhaustion is read STRUCTURALLY from the result
//     event's `subtype` (硬规则 2). A call whose stream did not parse is `not-evaluated:uninstrumented` —
//     its own value, never "zero turns" (硬规则 3b).
//   • SCOPE ENFORCEMENT. The pinned tree must carry none of `PIN_FORBIDDEN_DIRS`: the dependency task's
//     strippedness list PLUS `.quay/`, `archive/`, `milestones/`, `measurements/`. The defect: the
//     "stripped" pin still carried tracked `.quay/` evidence files that the verifier's Greps walked.
//   • THE EVIDENCE PACK (opt-in, `--strategy evidence-pack`). Before the model call, `buildEvidencePack`
//     deterministically assembles the mechanical shared-import finding, the definition lines of the
//     symbols the claim cites, the import lines among the named components, and bounded grep hits, and
//     passes them through a NEW prompt file (`verifier-evidence-pack.txt`). The frozen `verifier.txt`
//     stays the default and its bytes are pinned. `turns_used` is recorded per cluster.
// ⛔ No regression case is named in this file or in any prompt: the acceptance cluster is identified by
// POSITION (`--only-cluster`), and the strategy is validated against `VERIFIER_STRATEGIES`.

// ── THE FINGERPRINT SOURCE: CLUSTERS THAT COME FROM A MECHANISM, NOT FROM A MODEL ───────────────────
// The `investigate` arm asks a model to NAME duplicated logic, so every one of its runs is bound to a
// prompt and the whole pre-registration hangs off `prompt_sha256`. That makes a cluster which comes from a
// MECHANICAL fingerprint impossible to score: no prompt produced it, so no recorded prompt digest can ever
// equal the one the gate re-derives (gap-hypgen-has-no-fingerprint-source-for-code-duplication-recall).
// The `fingerprint` verb closes that by producing the SAME hypothesis-shaped record from a mechanism:
//   • arm `exact` runs ArchGuard's OWN duplicate grouping — the package's exported `detectDuplicates`, the
//     same function the `archguard_detect_duplicates` MCP tool calls. ⛔ The hashing is NEVER re-implemented
//     here; this module adapts the group SHAPE and carries ArchGuard's `hash` through verbatim.
//   • arm `callshape` is a SECOND, coarser instrument: the ordered callee names + control-flow node kinds of
//     each function body, with local identifiers normalized to a positional marker and literals to their
//     kind. It is computed with the `typescript` the ArchGuard PACKAGE ships (resolved FROM
//     `--archguard-root`): the repo's own compiler has no JS AST API, so resolving the wrong one is a
//     `not-evaluated`, never a silent zero-group run (硬规则 3b).
// The output is a RUN FILE like any other, distinguished by the artifact itself: it declares
// `fingerprint_source` and records a `source_digest` (sha256 over the verb inputs + the raw grouping
// output) IN PLACE OF `prompt_sha256`. `verify` / `match` / `review` therefore need no new verb and no new
// verifier: they read the run's KIND off the run file (硬规则 2 — never off a CLI flag) and bind it to
// `hashes["fingerprint-<arm>"]` in the prereg. ⛔ A missing key is its OWN refusal — the fingerprint gate
// never falls back to the prompt keys, and the prompt gate never falls back to the fingerprint key.
// ⛔ NOT-EVALUATED IS ITS OWN EXIT CODE (11): an unresolvable ArchGuard root, or a compiler the package
// does not ship, writes NO run file at all. "The instrument could not run" must never be shaped like
// "the instrument ran and found nothing" (硬规则 3b) — that is the whole defect this arm could reintroduce.

// ── FAIL-CLOSED BOUNDS, ONE EXIT CODE EACH ──────────────────────────────────────────────────────────
//   2 usage/env   3 investigator refused: cwd is not the empty neutral dir
//   4 prereg (every pre-registration refusal: an absent/mismatched hash, a run whose recorded prompt
//     digest does not match the supplied artifacts, a prereg not older than the runs — the REASON string
//     is what distinguishes them)   5 contamination   6 max-runs   7 max-clusters   8 max-ms
//   9 labels-before-runs  10 runs-incomplete  11 fingerprint not-evaluated (the instrument could not be
//     loaded — its OWN code, never a zero-group run). A breach writes NOTHING (never a partial carrier).
//
// ⛔ STRUCTURAL SANDBOX: creates no task, goal or AC; changes no status; edits no code. Its only
// persistence is the caller's `--out` carrier (default under `.quay/arch-hypothesis-generation/`, which is
// gitignored) and, ONLY with `--write-store`, the production `.quay/architecture-evidence-store.jsonl`.
// Every record is run through the PRODUCTION validator (`validateRecord`) and the accepted/refused tally
// is reported, never assumed. Records are tagged with the store `experiment` id.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
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
  fingerprintNotEvaluated: 11,
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

/** The verifier prompt the `verify` step runs on. The FROZEN file is the DEFAULT: the acceptance verify
 *  file's verdicts were produced on these bytes, so replacing it silently would make a reproduction a
 *  different experiment. The evidence-pack strategy ships in its OWN file (opt-in) — a second, named
 *  artifact, never an edit to this one (gap-hypgen-verifier-budget-exhaustion-…). */
export const FROZEN_VERIFIER_PROMPT = "verifier.txt";
/** The sha256 of the frozen verifier prompt, taken from the file at the acceptance pin (`e3163e519`). It
 *  is a PIN, not a second copy of the text: the test re-derives it from the file's bytes. */
export const FROZEN_VERIFIER_PROMPT_SHA256 = "dba2e67157aac12ccb769fe10bfa75fb91cfe8955cf9eca66b71301f01981f2d";
export const defaultVerifierPrompt = (here = HERE) => path.join(here, PROMPTS_DIR, FROZEN_VERIFIER_PROMPT);
/** The opt-in evidence-pack verifier prompt (`--strategy evidence-pack`). Its bytes carry a `{{PACK}}`
 *  placeholder the frozen file does not; it is never the default. */
export const EVIDENCE_PACK_VERIFIER_PROMPT = "verifier-evidence-pack.txt";
export const evidencePackVerifierPrompt = (here = HERE) => path.join(here, PROMPTS_DIR, EVIDENCE_PACK_VERIFIER_PROMPT);
/** The two verifier strategies. `default` is the frozen prompt with no pack; `evidence-pack` is opt-in and
 *  passes a deterministically assembled pack (definition lines, import lines, bounded grep hits). */
export const VERIFIER_STRATEGIES = Object.freeze(["default", "evidence-pack"]);

/** The inventoried scope. Component names are normalised ONTO it, so a record written from bare basenames
 *  (round 2) and one written from repo-relative paths (round 1) share ONE `subject_key` and can be joined. */
export const INVENTORY_SCOPE = "plugin/scripts";

/** Directories that MUST be absent from the verifier's pinned tree: their presence means the verifier is
 *  reading the methodology layer, not the code — the exact un-blinding the stripped tree exists to stop.
 *  ⛔ This list is OWNED by the dependency task (gap-hypgen-inventory-…); the scope list below is a
 *  SECOND, additive concept — see there. */
export const STRIPPED_DIRS = Object.freeze(["tasks", "goals", "docs", "orchestration"]);

/** SCOPE ENFORCEMENT (gap-hypgen-verifier-budget-exhaustion-…): top-level directories the verifier must
 *  not search, which the strippedness check above does not cover. The acceptance defect: the "stripped"
 *  pin still carried tracked `.quay/` evidence files, and verifier Greps walked `scripts/test.sh` comments
 *  and `.quay/**` JSON — oversized result payloads that consumed the turn budget.
 *  ⛔ A SEPARATE list, not an extension of `STRIPPED_DIRS`: that list is the dependency task's contract
 *  (its test pins the exact four names), and "complements … do not duplicate it" means ADD a concept, not
 *  rewrite the one already landed. Both lists are enumerated by the SAME single mechanism below. */
export const SCOPE_FORBIDDEN_DIRS = Object.freeze([".quay", "archive", "milestones", "measurements"]);
/** Every directory the verifier refuses to run against, in ONE enumeration. The check below loops over
 *  THIS, so there is exactly one place that decides "present ⇒ refuse" (硬规则 3: every present dir named). */
export const PIN_FORBIDDEN_DIRS = Object.freeze([...STRIPPED_DIRS, ...SCOPE_FORBIDDEN_DIRS]);

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
/** The `--arm` vocabulary: a non-empty run of ASCII letters/digits. It is a KEY SUFFIX (`inventory-B`),
 *  never a path fragment, so no separator or dot is admitted. */
export const ARM_ID_RE = /^[A-Za-z0-9]+$/;

/** The pre-registration KEY for an artifact under an arm. Without `--arm` (`arm == null`) the key is the
 *  round-1 single-arm one and every byte of today's behaviour is preserved; with `--arm X` it gains the
 *  `-X` suffix. (gap-hypgen-prereg-gate-is-single-arm-so-ab-arm-b-cannot-be-scored: ONE pre-registration
 *  must cover BOTH arms of a pre-registered A/B experiment; a post-hoc second prereg would violate the
 *  mtime rule that makes a prereg a prereg, so arm B could not be scored at all.) */
export const armScopedKey = (key, arm = null) => (arm == null ? key : `${key}-${arm}`);

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

/**
 * The run⇄prereg MODEL binding (Plan 5). A pre-registered A/B experiment compares one model against
 * another, so a run has to be bound to the model its arm pre-registered. The prereg MAY declare a
 * `models` map keyed by the arm-scoped model key (`armScopedKey("model", arm)` — `"model"` unscoped,
 * `"model-B"` under `--arm B`); when it does, every run's `requested_model` must equal that entry.
 *   • No `models` key at all ⇒ the prereg expresses no opinion ⇒ no refusal (byte-identical back-compat).
 *   • A declared map that does NOT cover this arm ⇒ `PREREG_MODEL_ABSENT` — its OWN refusal, never a
 *     silent pass (硬规则 3b; the same shape as an undeclared arm-scoped HASH key).
 *   • A run that recorded no requested model cannot satisfy a declared map ⇒ `RUN_MODEL_ABSENT`.
 * ⛔ The value compared is the run's REQUESTED model, not its actual: the pre-registration names what was
 * asked for; a gateway that serves something else is a `model_mismatch` on the run, reported elsewhere.
 * @returns {null|{code:number, reasons:string[]}}
 */
export function modelPreregRefusal({ prereg, runs, arm = null } = {}) {
  const models = prereg?.models;
  if (models == null) return null;                       // not declared ⇒ no opinion
  const reasons = [];
  if (typeof models !== "object" || Array.isArray(models)) return { code: EXIT.prereg, reasons: ["PREREG_MODELS_NOT_AN_OBJECT"] };
  const key = armScopedKey("model", arm);
  const expected = models[key];
  if (expected === undefined) return { code: EXIT.prereg, reasons: [`PREREG_MODEL_ABSENT:${key}`] };
  for (const r of runs ?? []) {
    const id = r?.run ?? "?";
    const req = r?.requested_model ?? r?.model ?? null;
    if (req == null) { reasons.push(`RUN_MODEL_ABSENT:${id}`); continue; }
    if (req !== expected) reasons.push(`PREREG_MODEL_MISMATCH:${id}:${req}!=${expected}`);
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
  const present = PIN_FORBIDDEN_DIRS.filter((d) => { try { return existsSync(path.join(pinDir, d)); } catch { return false; } });
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
 * Run N identical investigator calls.
 *
 * TWO CWD POLICIES, and the caller must say which one it wants (task
 * gap-open-semantic-discovery-routine-track). The BLIND policy (the default, `pinDir:null`) is unchanged
 * and is what the controlled experiments use: the run happens in an EMPTY neutral directory, so the model
 * has no repository to read and reasons over the prompt alone.
 * ⛔ The PINNED policy (`pinDir` given) is a DIFFERENT experiment, not a relaxation: the model is rooted at
 * a STRIPPED pinned tree and reads real source with tools. It is gated by the SAME three-valued discipline
 * `runVerifier` uses — `verifyCwdRefusal` checks BOTH that cwd === the pin AND that the pin really is
 * stripped (naming which forbidden directories are still present), because "the caller named a directory"
 * proves nothing about the tree. Two policies, two checks: one gate for both would let a blind experiment
 * silently become a source-reading one.
 * @param {object} o
 * @param {(prompt:string, i:number)=>Promise<object>} o.runModel  INJECTABLE: the only model seam
 * @param {(file:string, text:string)=>void} o.writeFile           INJECTABLE fs seam (recorded in tests)
 * @param {string|null} o.pinDir   the stripped pinned tree; `null` ⇒ the blind neutral-dir policy
 * @param {string} o.tools         the tool envelope the CALLER will launch with (recorded on each run, so
 *                                 "what could this run read?" travels with the record instead of living
 *                                 only in the caller's argv)
 * @param {number|null} o.maxTurns the caller's `--max-turns` (same reason)
 */
export async function runInvestigator({ prompt, neutralDir, cwd, runs = 3, runModel, outDir, writeFile, budget = {}, model = null, promptFile = null, promptFileSha256 = null, inventorySha256 = null, pinDir = null, tools = "", maxTurns = null }) {
  const refusal = pinDir === null ? neutralCwdRefusal(cwd, neutralDir) : verifyCwdRefusal(cwd, pinDir);
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
    // Plan 4: the hypotheses come from the RESULT TEXT the stream carries, so the SAME text parsed as plain
    // stdout and parsed from the stream yield identical hypotheses (the run may now use stream-json).
    const { hyps, parse_error } = parseHypotheses(callText(stdout));
    const rec = {
      run: i + 1, prompt_sha256: promptSha256,
      // Which prompt file produced this run, and the hashes binding it: the prompt file's own hash and the
      // inventory's, so the run stays joinable to its pre-registration even without the composite digest.
      model, prompt_file: promptFile, prompt_file_sha256: promptFileSha256, inventory_sha256: inventorySha256,
      // Which cwd policy governed this run and what it could read: `null` pin = the blind neutral policy.
      // Recorded here (not only in the caller) so a run file says by itself whether the model had source.
      pin_dir: pinDir, tools, max_turns: maxTurns,
      // The model identity (requested vs ACTUAL) and the call's cost, read structurally from the stream.
      ...modelCallFields({ requested: model, stdout }),
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

// ── per-turn instrumentation (pure) ──────────────────────────────────────────────────────────────────
/** The marker for a call whose turns were NOT captured. An ABSENT record is not "zero turns": it is
 *  "not evaluated" and must be shaped like one (硬规则 3b) — the acceptance run's defeat was that the turn
 *  budget was consumed with no surviving record of HOW. */
export const UNINSTRUMENTED = "not-evaluated:uninstrumented";
/** The marker for a model call whose ACTUAL identity the stream did not report. The recorded `model` is the
 *  one the launcher was ASKED for (`modelFromArgv`), which is a proxy; without the init event's `model`
 *  there is no direct reading and the actual identity is "not measured" — its OWN value, never a copy of
 *  the requested one (硬规则 3b/4b: "could not measure" must not be shaped like "measured"). */
export const MODEL_UNVERIFIED = "not-evaluated:model-unverified";
/** ⛔ RETIRED (2026-10-12): `MODEL_NOT_APPLICABLE = "not-applicable:no-model-call"` marked the rows the
 *  mechanical layer decided without a model call. No such row exists any more — the layer emits EVIDENCE,
 *  never a verdict, so EVERY verify row is a model row (gap-hypgen-mechanical-shared-implementation-layer-
 *  false-refutes). The marker is deleted rather than left unproducible: a value nothing can emit reads as
 *  a state that can still occur (硬规则 3b in the other direction). */
/** How much of a tool call's arguments a per-turn record keeps. The HEAD is what names the target
 *  (`file_path` / `pattern`+`path`); the full input is bulky and is not what the reading needs. */
export const ARGS_HEAD_MAX = 160;

/** Serialise one tool_result payload to the byte length the model actually received. `content` is a
 *  string or an array of `{type:"text",text}` blocks; anything else is JSON-stringified, never dropped. */
const toolResultBytes = (content) => {
  if (typeof content === "string") return Buffer.byteLength(content, "utf8");
  if (Array.isArray(content)) return Buffer.byteLength(content.map((b) => (typeof b === "string" ? b : String(b?.text ?? ""))).join(""), "utf8");
  if (content == null) return 0;
  return Buffer.byteLength(JSON.stringify(content), "utf8");
};
const argsHead = (input) => {
  let s;
  try { s = typeof input === "string" ? input : JSON.stringify(input ?? {}); } catch { s = String(input ?? ""); }
  return String(s ?? "").slice(0, ARGS_HEAD_MAX);
};

/**
 * Parse a `--output-format stream-json` stdout into the PER-TURN record the task exists to produce: one
 * entry per tool call — `{ tool, args_head, result_bytes }` — plus the final verdict text, the ACTUAL
 * model identity, and the call's token usage / cost.
 *
 * The MODEL identity and the USAGE are read STRUCTURALLY, never by keyword:
 *   • the `system`/`init` event's `model` field is the model the gateway ACTUALLY served (硬规则 4b: the
 *     requested `--model` is a proxy recorded as if it were the direct reading; this is the direct one);
 *   • the final `result` event's `usage` (input/output/cache token counts) and `total_cost_usd`.
 * ⛔ Missing init model / missing usage is reported as ABSENT (`model:null`, `usage:null`) — never defaulted
 * to the requested model or to zeros (硬规则 3b: "not measured" must not be shaped like a measurement).
 * ⛔ Non-stream stdout (the pre-instrumentation path, and the unit fixtures) yields `ok:false` and an
 * EMPTY turn list; the caller must report that as `not-evaluated:uninstrumented`, never as "zero turns".
 * @returns {{ok:boolean, turns:object[], finalText:string, subtype:string|null, num_turns:number|null,
 *            is_error:boolean|null, model:string|null, usage:object|null, cost_usd:number|null,
 *            hasResult:boolean}}
 */
export function parseVerifierStream(stdout) {
  const out = { ok: false, turns: [], finalText: "", subtype: null, num_turns: null, is_error: null, model: null, usage: null, cost_usd: null, hasResult: false };
  if (typeof stdout !== "string" || !stdout.trim()) return out;
  let parsedLines = 0;
  const pending = new Map();               // tool_use id → the record awaiting its result's bytes
  const textParts = [];
  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    if (!line || line[0] !== "{") continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (!ev || typeof ev !== "object") continue;
    parsedLines++;
    // The ACTUAL served model: the init event's `model`. FIRST one wins; a stream with no init model keeps
    // `model:null` (its own value — never a fallback to the requested one).
    if (out.model == null && ev.type === "system" && ev.subtype === "init" && typeof ev.model === "string" && ev.model.trim()) {
      out.model = ev.model;
    }
    const content = ev.message?.content;
    if (Array.isArray(content)) {
      for (const b of content) {
        if (b?.type === "tool_use") {
          const rec = { tool: String(b.name ?? "?"), args_head: argsHead(b.input), result_bytes: null };
          out.turns.push(rec);
          if (b.id) pending.set(b.id, rec);
        } else if (b?.type === "tool_result") {
          const rec = b.tool_use_id ? pending.get(b.tool_use_id) : null;
          const bytes = toolResultBytes(b.content);
          if (rec) rec.result_bytes = bytes;
          else out.turns.push({ tool: "(result-without-a-recorded-call)", args_head: "", result_bytes: bytes });
        } else if (b?.type === "text" && typeof b.text === "string") {
          textParts.push(b.text);
        }
      }
    }
    if (ev.type === "result") {
      out.hasResult = true;
      out.subtype = ev.subtype == null ? null : String(ev.subtype);
      out.num_turns = Number.isFinite(ev.num_turns) ? ev.num_turns : null;
      out.is_error = typeof ev.is_error === "boolean" ? ev.is_error : null;
      if (typeof ev.result === "string" && ev.result.trim()) out.finalText = ev.result;
      // The token accounting, read from the SAME structural event the turns are: a call whose cost is not
      // observable keeps `usage:null` (its own value, never a fabricated zero-usage object).
      if (out.usage == null && ev.usage && typeof ev.usage === "object") out.usage = ev.usage;
      if (out.cost_usd == null && Number.isFinite(ev.total_cost_usd)) out.cost_usd = ev.total_cost_usd;
    }
  }
  out.ok = parsedLines > 0;
  if (!out.finalText) out.finalText = textParts.join("\n");
  return out;
}

/** How many argument heads a per-call TOOL-USE reading keeps. A BOUND, not a policy: the heads are there
 *  to show WHICH files/patterns a call opened, and an unbounded carry would make the reading as bulky as
 *  the stream it summarises. */
export const TOOL_USE_PATHS_MAX = 8;

/**
 * The TOOL-USE reading of ONE instrumented call, read off the SAME per-turn records `parseVerifierStream`
 * already produced (硬规则 5b: one reader, never a second that could drift from it):
 *   • `by_tool`  — how many calls were made to each tool (`{Read:3, Grep:1}`);
 *   • `paths`    — the first `maxPaths` argument heads, i.e. the files/patterns actually opened.
 *
 * WHY IT EXISTS (task gap-open-discovery-refutation-chain-undetermined-is-unattributable-and-budget-
 * truncated, Plan item 1): a verdict is only ATTRIBUTABLE if the record shows the call READ the tree
 * rather than answered from its prompt. `Read/Grep counts > 0` is the direct reading of "this refutation
 * was produced by looking at the code", and it is what makes «survived» worth anything.
 * ⛔ A call whose stream did not parse yields `null` at the CALL SITE (`stream.ok === false`), never a
 * zero-count object: "made no tool calls" and "no turns were captured" are different facts (硬规则 3b).
 * @param {object[]|null|undefined} turns the `parseVerifierStream(...).turns` list
 * @returns {{total:number, by_tool:Object<string,number>, paths:object[], paths_truncated:boolean}}
 */
export function toolUseSummary(turns, { maxPaths = TOOL_USE_PATHS_MAX } = {}) {
  const list = Array.isArray(turns) ? turns : [];
  const byTool = {};
  const paths = [];
  for (const t of list) {
    const name = typeof t?.tool === "string" && t.tool !== "" ? t.tool : "(unnamed)";
    byTool[name] = (byTool[name] ?? 0) + 1;
    const head = typeof t?.args_head === "string" ? t.args_head : "";
    if (paths.length < maxPaths && head !== "") paths.push({ tool: name, args_head: head });
  }
  return { total: list.length, by_tool: byTool, paths, paths_truncated: list.length > paths.length };
}

/**
 * The STRUCTURAL reading of a launcher's stdout — the layer BELOW `parseVerifierStream`'s semantics.
 *
 * WHY IT EXISTS (task gap-open-discovery-model-calls-exit-without-result-are-unattributed-zero-token):
 * production recorded model calls that spent MINUTES of wall and left nothing parseable as `exit:0` with
 * `not_evaluated:null` — byte-for-byte the shape of an ordinary success. The cause could not be named
 * because the record kept no reading of the STREAM ITSELF. This function produces that reading:
 *   • `bytes` / `lines`      — how much came back at all (0 bytes is its own state, not "nothing to say");
 *   • `json_lines`           — how many lines parsed as a JSON object (the stream's own event count);
 *   • `events_by_type`       — the same lines tallied by their own `type` field;
 *   • `has_result`           — whether a `result` event was EVER emitted. ⛔ A `stream-json` run that
 *                              never emits `result` did not finish; that is the direct reading of "ran but
 *                              produced no result", and it is what `exit:0` was silently standing in for;
 *   • `truncated_json`       — the LAST non-empty line begins with `{` and does not parse: the stream was
 *                              cut MID-WRITE, which is a different fact from "the model said nothing";
 *   • `api_error_event`      — the stream carried an API-transport error: an `error`-typed event, a
 *                              `system`/`error` event, or a `result` event with `is_error:true` whose
 *                              subtype is not the turn-cap kill (`error_max_turns` — that one is a budget
 *                              fact, not an API fact, and is named by its own token elsewhere).
 *
 * ⛔ It reads NON-JSON output as "not an event" rather than as a parse failure: the pre-`stream-json` path
 * (and the unit fixtures) hand this function plain text, and calling that a truncated stream would make
 * two very different producers look the same. Nothing here is semantic — no field is interpreted beyond
 * `type`/`subtype`/`is_error`, which are the launcher's OWN envelope fields.
 * @returns {{bytes:number, lines:number, json_lines:number, non_json_lines:number, unparsed_json_lines:number,
 *            truncated_json:boolean, has_result:boolean, events_by_type:Object, api_error_event:boolean}}
 */
export function streamDiagnostics(stdout) {
  const out = {
    bytes: 0, lines: 0, json_lines: 0, non_json_lines: 0, unparsed_json_lines: 0,
    truncated_json: false, has_result: false, events_by_type: {}, api_error_event: false,
  };
  const text = typeof stdout === "string" ? stdout : "";
  out.bytes = Buffer.byteLength(text, "utf8");
  if (!text) return out;
  const raw = text.split("\n");
  // A trailing newline yields a final "" — that is the terminator of the previous line, not a line.
  const lines = raw.length > 0 && raw[raw.length - 1] === "" ? raw.slice(0, -1) : raw;
  out.lines = lines.length;
  let lastNonEmpty = -1;
  for (let i = 0; i < lines.length; i++) if (lines[i].trim() !== "") lastNonEmpty = i;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line[0] !== "{") { out.non_json_lines++; continue; }
    let ev = null;
    try { ev = JSON.parse(line); } catch { ev = null; }
    if (ev === null || typeof ev !== "object" || Array.isArray(ev)) {
      out.unparsed_json_lines++;
      // Only the FINAL line can have been cut mid-write; an unparseable line in the middle is a producer
      // that wrote something this reader does not understand, which is NOT the same fact.
      if (i === lastNonEmpty) out.truncated_json = true;
      continue;
    }
    out.json_lines++;
    const t = typeof ev.type === "string" && ev.type ? ev.type : "(no-type)";
    out.events_by_type[t] = (out.events_by_type[t] ?? 0) + 1;
    if (ev.type === "result") {
      out.has_result = true;
      if (ev.is_error === true && ev.subtype !== "error_max_turns") out.api_error_event = true;
    }
    if (ev.type === "error") out.api_error_event = true;
    if (ev.type === "system" && ev.subtype === "error") out.api_error_event = true;
  }
  return out;
}

/**
 * The model-identity + cost fields EVERY model-call record carries (`investigate` run files, `verify`
 * rows, `review` rows): the model that was REQUESTED, the model the stream reports was ACTUALLY served,
 * whether they disagree, and the call's token usage / cost. The mechanism is the same for all three verbs
 * so a review row and a run row spell the reading identically.
 *   • `actual_model` is `MODEL_UNVERIFIED` when the stream carries no init model — the recorded requested
 *     model is a PROXY, and copying it into `actual_model` is exactly the defect this closes (硬规则 4b).
 *   • `model_mismatch` is TRUE only when an actual model WAS read and it differs from the request: a
 *     mismatch is recorded, never silently passed.
 *   • `usage` / `cost_usd` are `null` when the result event carried none — never a zero object.
 * @returns {{requested_model:string|null, actual_model:string, model_mismatch:boolean, usage:object|null, cost_usd:number|null}}
 */
export function modelCallFields({ requested = null, stdout = "" } = {}) {
  const stream = parseVerifierStream(stdout);
  const actual = stream.ok && stream.model ? stream.model : null;
  return {
    requested_model: requested ?? null,
    actual_model: actual ?? MODEL_UNVERIFIED,
    model_mismatch: actual != null && requested != null && actual !== requested,
    usage: stream.ok ? (stream.usage ?? null) : null,
    cost_usd: stream.ok ? (stream.cost_usd ?? null) : null,
  };
}

/** the final assistant text of a call: the stream's `result` text when the stream parsed, else raw stdout.
 *  Plan 4: the investigator's hypotheses are parsed from the SAME text whether it arrives as a stream or as
 *  plain stdout, so turning on `--output-format stream-json` cannot change what was parsed. */
export const callText = (stdout) => {
  const s = String(stdout ?? "");
  const stream = parseVerifierStream(s);
  return stream.ok && stream.finalText ? stream.finalText : s;
};

/** Map a verifier call's result to a verdict. A TURN-LIMIT exit and an unparseable output both map to
 *  `undetermined` — ⛔ NEVER `refuted` (a budget exhaustion refutes nothing; 硬规则 3b).
 *  `cause` is the COARSE, stable class of the outcome (`turn-budget` / `uninstrumented-exit-N` /
 *  `unparseable` / `verdict-not-in-vocab`); `reason` stays the fine-grained diagnostic. 硬规则 2: the
 *  exhaustion signal is read from the stream's STRUCTURAL `subtype` when a stream is present (in
 *  `stream-json` mode the CLI prints no "Reached max turns" text at all), and only falls back to the
 *  text shape for the pre-instrumentation path. */
export function verifierVerdict({ stdout = "", stderr = "", status = 0, stream = null } = {}) {
  if (stream?.subtype === "error_max_turns") return { verdict: "undetermined", reason: "TURN_LIMIT", cause: "turn-budget", parsed: null };
  const blob = `${stdout}\n${stderr}`;
  if (/reached max turns|max(?:imum)?\s+turns|turn limit/i.test(blob)) return { verdict: "undetermined", reason: "TURN_LIMIT", cause: "turn-budget", parsed: null };
  const source = stream?.ok && stream.finalText ? stream.finalText : stdout;
  const j = parseJsonObject(source);
  if (!j) return { verdict: "undetermined", reason: status !== 0 ? `EXIT_${status}` : "UNPARSEABLE", cause: status !== 0 ? `exit-${status}` : "unparseable", parsed: null };
  if (!VERIFIER_VERDICTS.includes(j.verdict)) return { verdict: "undetermined", reason: `VERDICT_NOT_IN_VOCAB:${String(j.verdict)}`, cause: "verdict-not-in-vocab", parsed: j };
  return { verdict: j.verdict, reason: null, cause: null, parsed: j };
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
 * THE MECHANICAL SHARED-IMPORT FINDING — EVIDENCE about reuse, ⛔ NEVER a verdict on the claim
 * (gap-hypgen-mechanical-shared-implementation-layer-false-refutes). It was a refutation until 2026-10-12:
 * "all in-set edges converge on one module with ≥2 importers" was read as `refuted`/`shared-implementation`
 * and the cluster spent no model call. Measured in `E-DT-1` (Hf c4/c14/c15, Hp c3/c6/c15) EVERY refutation
 * had ≥2 named components that do NOT import the definer — the rule never looked at them. The confirmed
 * false refutation is Hf c15: the checker exit-code cluster, whose 2-vs-3 NOT-EVALUATED divergence is a
 * real defect (`checker-io.ts:54` vs `gate-script-base.ts:578`) that the control task
 * `gap-ac69-malformed-record-exits-3-and-passes-the-static-gate` confirmed; it was refuted because
 * `dead-code-after-return-check.ts` and `outer-anchor-check.ts` import `driverResultToExit` from
 * `checker-io.ts` — while `checker-mechanical-spine-check.ts`, the component holding the conflicting
 * contract, imports nothing from it and was never consulted. An import edge is evidence about REUSE; it
 * cannot settle a claim about BEHAVIOUR (importing a constant is not consuming the configured value —
 * `E-HYPGEN-AB-1` arm A c15, the inert `routine_quota.window_ms`).
 *
 * Predicate (exactly): among the hypothesis's components, the intra-set import edges all converge on ONE
 * component (the DEFINER), and at least TWO members import from it. The definer imports no other member
 * (a second target would break the convergence), so the set is a star. `symbol` = the names EVERY
 * importer takes from the definer — null when they take different names, and the edge still reports it.
 * The finding carries the OTHER named components too, which is what the verdict used to ignore:
 *   • `non_importers` — named components the inventory covers that take NO edge to the definer.
 *   • `unknown_components` — named components the inventory does NOT cover. Their edges were never
 *     observed, so "does not import the definer" is NOT a reading this function may make of them
 *     (硬规则 6: an absent value is "not looked at", never "false").
 * ⛔ With no provenance, or fewer than two KNOWN components, this returns `null`: "could not evaluate"
 * must not be shaped like a finding (硬规则 3b).
 * @returns {null|{definer:string, symbol:string[]|null, importers:string[], non_importers:string[],
 *                 unknown_components:string[], evidence:object[]}}
 */
export function sharedImplementation({ components = [], provenance = null } = {}) {
  if (!provenance) return null;
  const byBase = provenanceIndex(provenance);
  const named = [...new Set((components ?? []).map((c) => path.posix.basename(String(c).trim())))];
  const set = named.filter((c) => byBase.has(c));
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
  const importersRel = importers.map((c) => repoRelComponent(c)).sort();
  const nonImportersRel = set
    .filter((c) => c !== definer && !importers.includes(c))
    .map((c) => repoRelComponent(c))
    .sort();
  const unknownRel = named.filter((c) => !byBase.has(c)).map((c) => repoRelComponent(c)).sort();
  return {
    definer: repoRelComponent(definer), symbol: shared.length ? shared : null,
    importers: importersRel, non_importers: nonImportersRel, unknown_components: unknownRel, evidence,
  };
}

/** The shared-import finding RENDERED as evidence-pack lines. `[]` when there is no finding (no
 *  provenance, or no star) — an EMPTY list, so a caller that concatenates it changes nothing. */
export function mechanicalEvidenceLines({ components = [], provenance = null } = {}) {
  const f = sharedImplementation({ components, provenance });
  if (!f) return [];
  const namedCount = 1 + f.importers.length + f.non_importers.length + f.unknown_components.length;
  const out = [
    `- MECH ${f.importers.length}/${namedCount} named components import ${f.definer}`
      + (f.symbol ? ` | shared names: {${f.symbol.join(", ")}}` : " | (different names taken from it)")
      + (f.non_importers.length || f.unknown_components.length ? " — NOT a verdict: see the NOT-importing lines" : ""),
  ];
  for (const e of f.evidence) out.push(`- MECH   import ${e.file}:${e.line ?? "?"} -> ${e.imports} | {${(e.names ?? []).join(", ")}}`);
  for (const n of f.non_importers) out.push(`- MECH   NOT-importing ${n} | named by the hypothesis, imports nothing from the definer`);
  for (const u of f.unknown_components) out.push(`- MECH   NOT-INVENTORIED ${u} | named by the hypothesis, absent from the inventory (its edges were never observed)`);
  return out;
}

// ── the mechanical EVIDENCE PACK (opt-in strategy; pure, no model call) ──────────────────────────────
/** Total rendered evidence lines a pack may carry. The cap is what makes "bounded grep hits" bounded:
 *  the acceptance defect was searches returning oversized payloads, so a pack that could grow without
 *  limit would reproduce it. */
export const DEFAULT_EVIDENCE_MAX_LINES = 40;
/** How many symbols a claim may contribute, and how many definition lines each symbol may contribute. */
export const DEFAULT_EVIDENCE_MAX_SYMBOLS = 8;
const symbolEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The code-looking identifiers a claim CITES, in first-mention order, de-duplicated, capped. A token
 *  qualifies when it is not a plain English word: it carries `_`, is camelCase, is ALL-CAPS, or was
 *  written in backticks/quotes. Deterministic — no stemming, no dictionary. */
export function citedSymbols(claim, { max = DEFAULT_EVIDENCE_MAX_SYMBOLS } = {}) {
  const quoted = new Set();
  for (const m of String(claim ?? "").matchAll(/[`"'“”]([A-Za-z_$][\w$]*)[`"'“”]/g)) quoted.add(m[1]);
  const out = [];
  for (const m of String(claim ?? "").matchAll(/[A-Za-z_$][\w$]*/g)) {
    const t = m[0];
    if (out.length >= max) break;
    if (out.includes(t)) continue;
    const codeShaped = t.includes("_") || /[a-z][A-Z]/.test(t) || /^[A-Z]{2,}$/.test(t) || (t.length >= 4 && /[A-Za-z]/.test(t) && /\d/.test(t));
    if (!codeShaped && !quoted.has(t)) continue;
    out.push(t);
  }
  return out;
}

/** TRUE when `text` DEFINES `sym` at the top level — a declaration keyword, or a property/assignment.
 *  Structural (a declaration), never a bare mention (硬规则 2). */
export function isDefinitionLine(text, sym) {
  const s = symbolEsc(sym);
  return new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?(?:default\\s+)?(?:async\\s+)?(?:function\\*?|class|const|let|var|type|interface|enum)\\s+${s}(?![\\w$])`).test(String(text))
    || new RegExp(`^\\s*(?:readonly\\s+|public\\s+|private\\s+|static\\s+)*${s}\\s*[:=]`).test(String(text));
}

/** Resolve a component name onto a key of `sources` (exact, else by basename). `null` when absent — a
 *  component with no source is NOT silently treated as empty (硬规则 6). */
function sourceOf(sources, comp) {
  if (sources && Object.prototype.hasOwnProperty.call(sources, comp)) return sources[comp];
  const base = path.posix.basename(String(comp));
  for (const k of Object.keys(sources ?? {})) if (path.posix.basename(k) === base) return sources[k];
  return null;
}

/** The DEFINITION LINE of each cited symbol in EACH named component that declares it (the first
 *  declaration per component, at most `maxComponentsPerSymbol` components per symbol). Plural on purpose:
 *  the question is whether the SAME symbol is declared separately in several components, which one line
 *  from one component cannot answer. Returns `[{component, symbol, line, text}]`. */
export function definitionLinesFor({ symbols = [], components = [], sources = {}, maxComponentsPerSymbol = 4 } = {}) {
  const out = [];
  const uniq = [...new Set(components.map((c) => path.posix.basename(String(c))))].sort();
  for (const sym of symbols) {
    let taken = 0;
    for (const comp of uniq) {
      if (taken >= maxComponentsPerSymbol) break;
      const src = sourceOf(sources, comp);
      if (src == null) continue;
      const lines = String(src).split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (!isDefinitionLine(lines[i], sym)) continue;
        out.push({ component: repoRelComponent(comp), symbol: sym, line: i + 1, text: lines[i].trim().slice(0, 200) });
        taken++;
        break;
      }
    }
  }
  return out;
}

/** The IMPORT LINES **among the named components only** — an edge from a named component to another named
 *  component. Prefers the provenance sidecar (the same edges the mechanical layer reads); falls back to
 *  parsing the supplied sources with the repo's own import parser. Returns `[{from, to, line, names, text}]`. */
export function importLinesFor({ components = [], provenance = null, sources = {} } = {}) {
  const bases = [...new Set(components.map((c) => path.posix.basename(String(c))))].sort();
  const inSet = new Set(bases);
  const out = [];
  const byBase = provenance ? provenanceIndex(provenance) : null;
  for (const comp of bases) {
    let edges = [];
    if (byBase) {
      edges = (byBase.get(comp)?.imports ?? []).map((im) => ({ module: path.posix.basename(String(im.module ?? "")), line: im.line ?? null, names: im.names ?? [] }));
    } else {
      const src = sourceOf(sources, comp);
      if (src == null) continue;
      const lines = String(src).split("\n");
      edges = extractImports(src).map((im) => ({
        module: path.posix.basename(String(im.spec ?? "").replace(/\.[a-z]+$/, "") + ".ts"),
        line: im.line ?? null,
        names: importedNames(src, im.line, im.spec),
        _line: lines[(im.line ?? 1) - 1],
      }));
    }
    for (const e of edges) {
      const to = path.posix.basename(String(e.module));
      if (!to || to === comp || !inSet.has(to)) continue;
      const src = sourceOf(sources, comp);
      const rawText = e._line ?? (src != null && e.line ? String(src).split("\n")[e.line - 1] : "");
      out.push({ from: repoRelComponent(comp), to: repoRelComponent(to), line: e.line, names: e.names ?? [], text: String(rawText ?? "").trim().slice(0, 200) });
    }
  }
  return out.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0) || (a.line ?? 0) - (b.line ?? 0));
}

/**
 * Assemble the deterministic evidence pack for one cluster: the MECHANICAL shared-import finding, the
 * definition lines of the cited symbols, the import lines among the named components, and the caller's
 * bounded grep hits. Section lines are allocated ROUND-ROBIN, so a cap can never starve a whole evidence
 * class (and `capped` says so).
 *
 * The MECH section is computed HERE from `provenance` rather than passed in, so a caller cannot forget it:
 * the finding is evidence the MODEL weighs, and every pack assembled with a provenance sidecar carries it
 * (`mechanicalEvidenceLines` returns `[]` without one — the pack is then byte-identical to the pre-2026-10-12
 * rendering, which is what the `--provenance`-free path is pinned to).
 * PURE — every input is supplied; no fs, no model.
 * @returns {{components:string[], symbols:string[], lines:string[], text:string, capped:boolean,
 *            counts:object, sections:{mechanical:string[],definitions:object[],imports:object[],hits:object[]}}}
 */
export function buildEvidencePack({ components = [], claim = "", sources = {}, provenance = null, hits = [], maxLines = DEFAULT_EVIDENCE_MAX_LINES, maxSymbols = DEFAULT_EVIDENCE_MAX_SYMBOLS, maxComponentsPerSymbol = 4 } = {}) {
  const symbols = citedSymbols(claim, { max: maxSymbols });
  const mechanical = mechanicalEvidenceLines({ components, provenance });
  const definitions = definitionLinesFor({ symbols, components, sources, maxComponentsPerSymbol });
  const imports = importLinesFor({ components, provenance, sources });
  const normHits = (Array.isArray(hits) ? hits : []).map((h) => ({
    file: String(h?.file ?? ""), line: Number.isFinite(h?.line) ? h.line : null, text: String(h?.text ?? "").trim().slice(0, 200),
  })).filter((h) => h.file);
  const render = {
    definitions: (d) => `- DEF ${d.component}:${d.line}  ${d.symbol} | ${d.text || "(empty line)"}`,
    imports: (i) => `- IMP ${i.from}:${i.line ?? "?"} -> ${i.to} | ${i.text || (i.names.length ? `{${i.names.join(", ")}}` : "(side-effect import)")}`,
    hits: (h) => `- HIT ${h.file}:${h.line ?? "?"} | ${h.text}`,
  };
  const queues = [
    mechanical,
    definitions.map((x) => render.definitions(x)),
    imports.map((x) => render.imports(x)),
    normHits.map((x) => render.hits(x)),
  ];
  const total = queues.reduce((n, q) => n + q.length, 0);
  const budget = Math.max(0, Math.floor(maxLines));
  const picked = [];
  for (let i = 0; picked.length < budget; i++) {
    let progressed = false;
    for (const q of queues) { if (i < q.length && picked.length < budget) { picked.push(q[i]); progressed = true; } }
    if (!progressed) break;
  }
  const header = [
    "## Mechanical evidence pack (assembled deterministically BEFORE the model call)",
    `components: ${components.map((c) => repoRelComponent(c)).join(", ") || "-"}`,
    `cited symbols: ${symbols.join(", ") || "-"}`,
    // ⛔ The mechanical count is APPENDED only when the finding exists, so a pack built without a
    // provenance sidecar renders byte-for-byte as it did before the finding existed.
    `sections: definitions=${definitions.length} imports=${imports.length} hits=${normHits.length}`
      + `${mechanical.length ? ` mechanical=${mechanical.length}` : ""}`
      + `${total > picked.length ? ` (rendered ${picked.length}/${total}, capped at ${budget})` : ""}`,
  ];
  return {
    components: components.map((c) => repoRelComponent(c)), symbols,
    lines: picked, text: [...header, ...picked].join("\n"), capped: total > picked.length,
    counts: { definitions: definitions.length, imports: imports.length, hits: normHits.length, rendered: picked.length, total, ...(mechanical.length ? { mechanical: mechanical.length } : {}) },
    sections: { mechanical, definitions, imports, hits: normHits },
  };
}

/**
 * Run the bounded verifier over the pre-registered selection (highest confidence first, cap = clusters).
 * Refuses unless cwd is the forbidden-directory-free pinned tree.
 *
 * ⛔ NO CLUSTER IS DECIDED WITHOUT A MODEL CALL (gap-hypgen-mechanical-shared-implementation-layer-
 * false-refutes). The mechanical layer is applied to every cluster BEFORE the model loop, but it only
 * ATTACHES its shared-import finding to the row as `mechanical_evidence` — an import edge is evidence
 * about reuse, never a verdict on the claim. A row carrying a finding is otherwise a model row like any
 * other, and its verdict / verdict_reason are the model's.
 *
 * EVERY model call is INSTRUMENTED: the caller runs the launcher with `--output-format stream-json`, and
 * each row carries the per-turn tool calls (`turns`) plus `turns_used`. A call whose stream did not parse
 * is `not-evaluated:uninstrumented` — never "zero turns" (硬规则 3b).
 *
 * `strategy: "evidence-pack"` is OPT-IN: each cluster's deterministic pack — the mechanical finding
 * first — is assembled first and passed in the prompt.
 *
 * EVERY model call also carries the MODEL IDENTITY + COST fields (`modelCallFields`): the requested model,
 * the ACTUAL one the stream reports was served, a mismatch flag, and the call's usage / cost.
 * @param {(prompt:string, ctx:object)=>Promise<object>} o.runModel INJECTABLE
 * @param {?string} o.model the model REQUESTED for these calls (the `--model` override, or the launcher's
 *   resolved default), recorded on each row as `requested_model`. `null` ⇒ no claim was made.
 * @param {object[]|null} o.provenance structural inventory entries (see `sharedImplementation`)
 * @param {number|null} o.onlyCluster 1-based position in the FULL cluster list (diagnostic: one call)
 * @param {{sources?:object, provenance?:object|null, hits?:object[], maxLines?:number}} o.evidence
 */
export async function runVerifier({
  clusters, pinDir, cwd, promptTemplate, runModel,
  maxClusters = HARD_MAX_CLUSTERS, concurrency = 5, maxMs = null, provenance = null,
  onlyCluster = null, strategy = "default", evidence = null, model = null,
}) {
  if (!VERIFIER_STRATEGIES.includes(strategy)) return { ok: false, code: EXIT.usage, reasons: [`STRATEGY_NOT_IN_VOCAB:${strategy}`] };
  if (maxClusters > HARD_MAX_CLUSTERS) return { ok: false, code: EXIT.maxClusters, reasons: [`MAX_CLUSTERS_ABOVE_CEILING:${maxClusters}>${HARD_MAX_CLUSTERS}`] };
  const refusal = verifyCwdRefusal(cwd, pinDir);
  if (refusal) return { ok: false, code: EXIT.cwdNotNeutral, reasons: [refusal] };
  // SELECTION. `onlyCluster` picks ONE cluster by its position in the FULL list, so a diagnostic run pays
  // for one model call AND the row keeps the cluster's own number — the reading is addressed by POSITION,
  // never by a case label. An out-of-range value is its own refusal, never a silently empty selection.
  let idxs;
  if (onlyCluster != null) {
    if (!Number.isInteger(onlyCluster) || onlyCluster < 1 || onlyCluster > clusters.length) {
      return { ok: false, code: EXIT.usage, reasons: [`ONLY_CLUSTER_OUT_OF_RANGE:${onlyCluster}`] };
    }
    idxs = [onlyCluster - 1];
  } else {
    idxs = Array.from({ length: Math.min(maxClusters, clusters.length) }, (_, i) => i);
  }
  const results = new Array(idxs.length);
  const t0 = Date.now();
  // The mechanical finding is computed for EVERY selected cluster up front (pure, no model call) so the
  // row can carry it. It is EVIDENCE: no cluster is short-circuited by it, every one still reaches
  // `runModel` (that is the property this loop is responsible for, not the caller's discipline).
  const mech = idxs.map((i) => sharedImplementation({ components: clusters[i].rep.components, provenance }));
  const packs = strategy === "evidence-pack"
    ? idxs.map((i) => buildEvidencePack({
      components: clusters[i].rep.components, claim: clusters[i].rep.claim,
      sources: evidence?.sources ?? {}, provenance: evidence?.provenance ?? provenance,
      hits: evidence?.hits ?? [], maxLines: evidence?.maxLines ?? DEFAULT_EVIDENCE_MAX_LINES,
    }))
    : idxs.map(() => null);
  const runOne = async (k) => {
    const i = idxs[k];
    const c = clusters[i];
    const hyp = {
      components: c.rep.components, concept_kind: c.rep.concept_kind, claim: c.rep.claim,
      evidence_needed: c.rep.evidence_needed, counterexample_requirement: c.rep.counterexample_requirement,
    };
    let prompt = String(promptTemplate).replace("{{HYP}}", JSON.stringify(hyp));
    if (packs[k]) prompt = prompt.replace("{{PACK}}", packs[k].text);
    const tCall = Date.now();
    const r = await runModel(prompt, { cluster: i + 1, kind: c.rep.concept_kind, pack: packs[k]?.text ?? null });
    const stdout = String(r?.stdout ?? "");
    const stream = parseVerifierStream(stdout);
    const m = verifierVerdict({ stdout, stderr: String(r?.stderr ?? ""), status: r?.status ?? 0, stream: stream.ok ? stream : null });
    const j = m.parsed;
    results[k] = {
      cluster: i + 1, members: c.members, kind: c.rep.concept_kind, comps: c.rep.comps,
      claim: String(c.rep.claim ?? "").slice(0, 200),
      wall_ms: Date.now() - tCall, out_bytes: stdout.length, exit: r?.status ?? null, strategy,
      verdict: m.verdict, verdict_reason: m.reason, verdict_cause: m.cause ?? null, mechanical: false,
      instrumented: stream.ok, instrumentation: stream.ok ? "stream-json" : UNINSTRUMENTED,
      turns: stream.ok ? stream.turns : null, turns_used: stream.ok ? stream.turns.length : null,
      cli_num_turns: stream.num_turns,
      // The model identity + cost this task exists to make observable: the REQUESTED model is the caller's
      // claim; the ACTUAL one and the usage are read from the same stream the turns are.
      ...modelCallFields({ requested: model, stdout }),
      intentional: j?.intentional_difference_found ?? null,
      evidence: Array.isArray(j?.evidence) ? j.evidence : [],
      counterexample: j?.counterexample ?? null,
      // ⛔ THE POSITIONS A CALL CHECKED (`checked`), present only when the answer carried them — the same
      // conditional-key discipline as `mechanical_evidence` below, so a row whose answer omits the field
      // stays byte-identical key-for-key. WHY: a «survived» verdict is only attributable if the call says
      // WHICH positions it examined and found nothing at (task gap-open-discovery-refutation-chain-
      // undetermined-is-unattributable-and-budget-truncated, Plan item 3). Absent is absent — never an
      // empty array standing in for "it named none" (硬规则 3b).
      ...(Array.isArray(j?.checked) ? { checked: j.checked } : {}),
      // The mechanical finding, ATTACHED as evidence. The key is present only when there IS one, so a
      // `--provenance`-free row stays byte-identical to the pre-2026-10-12 rendering (where the field did
      // not exist) and a provenance-free run's artifact is unchanged.
      ...(mech[k] ? { mechanical_evidence: mech[k] } : {}),
      pack: packs[k] ? { counts: packs[k].counts, capped: packs[k].capped, lines: packs[k].lines } : null,
      summary: j?.summary ?? String(stream.ok ? stream.finalText : stdout).slice(0, 300),
    };
  };
  // ⛔ NO budget-aware reordering: it existed only to run the mechanically DECIDED clusters first, and
  // nothing is decided here any more. Every cluster needs its model call, so ordering by the finding would
  // be a claim about relative call cost that has never been measured (硬规则 4 推论四). The selection order
  // is the execution order.
  const order = idxs.map((_, k) => k);
  const step = Math.max(1, concurrency);
  for (let i = 0; i < order.length; i += step) {
    if (maxMs != null && Date.now() - t0 >= maxMs) return { ok: false, code: EXIT.maxMs, reasons: [`MAX_MS_EXCEEDED:${Date.now() - t0}>=${maxMs}`], results: results.filter(Boolean) };
    await Promise.all(order.slice(i, i + step).map((k) => runOne(k)));
  }
  return {
    ok: true, clusters_total: clusters.length, verified: idxs.length,
    beyond_cap: onlyCluster != null ? 0 : Math.max(0, clusters.length - idxs.length),
    // How many rows carry a mechanical shared-import finding. ⛔ NOT a refutation count: nothing here is
    // refuted by the layer (that is the whole point of `mechanicalEvidenceLines`).
    mechanical_evidence: mech.filter(Boolean).length,
    strategy, run_order: order.map((k) => idxs[k] + 1),
    results,
  };
}

/**
 * The run-level mechanical count as the ARTIFACT spells it. A `--provenance` run names it
 * `mechanical_evidence` (what it counts). A provenance-free run keeps the pre-2026-10-12 name and value
 * (`mechanical_refuted: 0`) — that path's `verify.json` is byte-identical to the artifact written before
 * the finding existed, which is what "behaviour without `--provenance` is unchanged" is pinned to. ⛔ The
 * zero is a READING, not a literal: without a provenance sidecar no finding can exist.
 * @returns {object} a one-key object, spread into the verify.json / stdout summary
 */
export function mechanicalSummaryField({ provenance = null, mechanical_evidence = 0 } = {}) {
  return provenance ? { mechanical_evidence } : { mechanical_refuted: mechanical_evidence };
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

// ── the fingerprint source: a mechanical cluster, under the SAME pre-registration ────────────────────
/** The two fingerprint ARMS, in the pre-registered vocabulary. `exact` = ArchGuard's own AST-normalized
 *  body grouping; `callshape` = this module's coarser callee-name + control-flow signature. They are two
 *  INSTRUMENTS, so each gets its own prereg key — a run of one arm can never be judged by the other's. */
export const FINGERPRINT_ARMS = Object.freeze(["exact", "callshape"]);
/** The prereg key a fingerprint arm's digest is recorded under. ⛔ Deliberately NOT an arm-SCOPED
 *  `prompt-investigator-<arm>` key: those name the model arm, and a fingerprint run has no prompt. */
export const fingerprintKey = (arm) => `fingerprint-${arm}`;
/** Default thresholds. They are ONE convention shared by both arms (and by the MCP tool's own defaults
 *  for `minStatements`), so a count read off one arm is comparable with a count read off the other. */
export const DEFAULT_MIN_STATEMENTS = 2;
export const DEFAULT_MIN_TOKENS = 20;
/** The ArchGuard module that OWNS the duplicate grouping. Its `detectDuplicates` is what the `exact` arm
 *  runs — the hashing is never re-implemented here (硬规则 1: use the instrument). */
export const ARCHGUARD_DUP_MODULE = path.join("dist", "analysis", "duplicates", "group.js");
/** Where the ArchGuard package is looked for when the caller names no root: the plugin npm-cache the MCP
 *  server itself is loaded from. A host that carries the plugin elsewhere sets `ARCHGUARD_ROOT`. */
export const defaultArchguardRoot = (home = os.homedir()) =>
  path.join(home, ".claude", "plugins", "npm-cache", "node_modules", "@yalehwang", "archguard");
/** The concept kind every fingerprint cluster carries. The mechanism reads STRUCTURE, never purpose, so a
 *  fingerprint collision is an `identity` claim and nothing stronger. */
export const FINGERPRINT_CONCEPT_KIND = "identity";

/** The value `fingerprint` returns when the instrument could not run. ⛔ A distinct SHAPE from a result
 *  with zero groups: the caller must print it and exit 11, and write no carrier at all (硬规则 3b). */
export const notEvaluated = (reason) => ({ ok: false, not_evaluated: true, code: EXIT.fingerprintNotEvaluated, reason: String(reason) });

/**
 * Resolve the ArchGuard package root. ⛔ An EXPLICIT `--archguard-root` is AUTHORITATIVE: when the caller
 * names one, an invalid one is `""` (⇒ not-evaluated) and NEVER a silent fall back to the default — a
 * fallback would let a typo measure a different build than the one the caller believed it was reading,
 * and the two builds' counts are not comparable (硬规则 4b: the instrument must be the one named).
 * Only when NO root was named do the env var and the plugin npm-cache default apply, in that order.
 * A candidate counts as a root only when it really carries the duplicates module.
 */
export function resolveArchguardRoot(explicit = null, { env = process.env, existsSync = fs.existsSync, realpathSync = fs.realpathSync, home = os.homedir() } = {}) {
  const candidates = explicit
    ? [explicit]
    : [env?.ARCHGUARD_ROOT, defaultArchguardRoot(home)];
  for (const c of candidates) {
    if (!c) continue;
    try {
      const abs = realpathSync(c);
      if (existsSync(path.join(abs, ARCHGUARD_DUP_MODULE))) return abs;
    } catch { /* try next */ }
  }
  return "";
}

/** Load ArchGuard's OWN duplicate instrument from a resolved root. The version is read for the report and
 *  for the digest; a package whose version cannot be read reports `null` rather than inventing one. */
export async function loadArchguardInstrument(archguardRoot, { importModule = (u) => import(u) } = {}) {
  try {
    const mod = await importModule(pathToFileURL(path.join(archguardRoot, ARCHGUARD_DUP_MODULE)).href);
    if (typeof mod?.detectDuplicates !== "function") return { ok: false, reason: "ARCHGUARD_API_MISSING:detectDuplicates" };
    if (typeof mod?.collectSourceFiles !== "function") return { ok: false, reason: "ARCHGUARD_API_MISSING:collectSourceFiles" };
    let version = null;
    try { version = JSON.parse(fs.readFileSync(path.join(archguardRoot, "package.json"), "utf8"))?.version ?? null; } catch { /* version stays null, never invented */ }
    return { ok: true, detectDuplicates: mod.detectDuplicates, collectSourceFiles: mod.collectSourceFiles, version };
  } catch (err) {
    return { ok: false, reason: `ARCHGUARD_IMPORT_FAILED:${err?.code ? `${err.code}:` : ""}${String(err?.message ?? err).split("\n")[0].slice(0, 200)}` };
  }
}

/**
 * Resolve the `typescript` the ArchGuard PACKAGE ships, FROM the package root (`createRequire` rooted at
 * its `package.json`, so Node walks the package's own resolution chain). ⛔ This is the whole point of the
 * `callshape` arm's dependency: the repo's own `typescript` has no JS AST API, so resolving the repo's
 * copy would silently produce a different instrument. Unresolvable ⇒ not-evaluated, never zero groups.
 */
export async function resolveArchguardTypescript(archguardRoot, { createRequire: makeRequire = createRequire, importModule = (p) => import(p) } = {}) {
  let resolved;
  try { resolved = makeRequire(path.join(archguardRoot, "package.json")).resolve("typescript"); }
  catch (err) { return { ok: false, reason: `TS_RESOLVE_FAILED:${err?.code ? `${err.code}:` : ""}${String(err?.message ?? err).split("\n")[0].slice(0, 160)}` }; }
  try {
    const mod = await importModule(resolved);
    const ts = mod?.default ?? mod;
    if (typeof ts?.createSourceFile !== "function") return { ok: false, reason: `TS_NO_AST_API:${resolved}` };
    return { ok: true, ts, path: resolved, version: ts.version ?? null };
  } catch (err) {
    return { ok: false, reason: `TS_IMPORT_FAILED:${err?.code ? `${err.code}:` : ""}${String(err?.message ?? err).split("\n")[0].slice(0, 160)}` };
  }
}

/** The function-likes a call-structure fingerprint is taken over — the same set ArchGuard's own
 *  fingerprint walks, so a component the `exact` arm sees is never invisible to `callshape`. */
const isFunctionLikeNode = (ts, node) =>
  ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node) ||
  ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) ||
  ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node);

/** The names bound INSIDE `fn` (parameters, variable declarations, nested function names). A reference to
 *  one of these is normalized to a positional marker, so two bodies that differ only in what they CALL
 *  their locals carry the same signature — the same normalization ArchGuard's own fingerprint applies. */
function callshapeLocals(ts, fn) {
  const names = new Set();
  const addBinding = (name) => {
    if (!name) return;
    if (ts.isIdentifier(name)) { names.add(name.text); return; }
    for (const el of name.elements ?? []) if (ts.isBindingElement(el)) addBinding(el.name);
  };
  const visit = (node) => {
    if (ts.isParameter(node) || ts.isVariableDeclaration(node)) addBinding(node.name);
    else if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name && node !== fn) names.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(fn);
  return names;
}

/** Control-flow and declaration node kinds, by their `ts.SyntaxKind` NAME (so the map is built from the
 *  resolved `ts` and cannot drift from the compiler actually in use). Everything else contributes no
 *  token — this arm reads STRUCTURE, not the full AST the `exact` arm already hashes. */
const CALLSHAPE_CONTROL = Object.freeze([
  ["IfStatement", "if"], ["ForStatement", "for"], ["ForInStatement", "for-in"], ["ForOfStatement", "for-of"],
  ["WhileStatement", "while"], ["DoStatement", "do"], ["SwitchStatement", "switch"], ["CaseClause", "case"],
  ["DefaultClause", "default"], ["TryStatement", "try"], ["CatchClause", "catch"], ["ReturnStatement", "return"],
  ["ThrowStatement", "throw"], ["BreakStatement", "break"], ["ContinueStatement", "continue"],
  ["AwaitExpression", "await"], ["YieldExpression", "yield"], ["ConditionalExpression", "cond"],
  ["SpreadElement", "spread"], ["DeleteExpression", "delete"], ["TypeOfExpression", "typeof"],
]);
/** Literal kinds — every literal of a kind collapses to ONE token, which is what makes two bodies that
 *  differ only in their literals carry the same signature. */
const CALLSHAPE_LITERALS = Object.freeze([
  "StringLiteral", "NumericLiteral", "BigIntLiteral", "RegularExpressionLiteral",
  "NoSubstitutionTemplateLiteral", "TrueKeyword", "FalseKeyword", "NullKeyword",
  "TemplateHead", "TemplateMiddle", "TemplateTail",
]);
const CALLSHAPE_STATEMENTS = Object.freeze([
  "VariableStatement", "ExpressionStatement", "IfStatement", "DoStatement", "WhileStatement", "ForStatement",
  "ForInStatement", "ForOfStatement", "ContinueStatement", "BreakStatement", "ReturnStatement",
  "WithStatement", "SwitchStatement", "LabeledStatement", "ThrowStatement", "TryStatement",
  "DebuggerStatement", "FunctionDeclaration", "ClassDeclaration",
]);

/** The ordered fingerprint tokens of ONE function body: each CALL by the name it calls (a local callee ⇒
 *  `call:local`), each control-flow node by its kind, each local reference ⇒ `local`, each non-local ⇒
 *  `id:<name>`, each literal ⇒ `lit`. PURE (the compiler is passed in), deterministic, and independent of
 *  formatting: it never reads a token's text position, only the tree. */
export function callshapeTokens(ts, fn) {
  const locals = callshapeLocals(ts, fn);
  const control = new Map(CALLSHAPE_CONTROL.map(([k, label]) => [ts.SyntaxKind[k], label]).filter(([k]) => k !== undefined));
  const literals = new Set(CALLSHAPE_LITERALS.map((k) => ts.SyntaxKind[k]).filter((k) => k !== undefined));
  const statements = new Set(CALLSHAPE_STATEMENTS.map((k) => ts.SyntaxKind[k]).filter((k) => k !== undefined));
  const tokens = [];
  let statementCount = 0;
  const callee = (expr) => {
    if (!expr) return "?";
    if (ts.isIdentifier(expr)) return locals.has(expr.text) ? "local" : expr.text;
    if (ts.isPropertyAccessExpression(expr) || ts.isPropertyAccessChain?.(expr)) return expr.name?.text ?? "?";
    if (ts.isElementAccessExpression(expr) || ts.isElementAccessChain?.(expr)) return "[]";
    if (ts.isParenthesizedExpression(expr)) return callee(expr.expression);
    if (ts.isCallExpression(expr)) return "call";
    return "?";
  };
  const emit = (node) => {
    if (!node) return;
    if (ts.isTypeNode?.(node)) return;                                   // type annotations say nothing about behaviour
    if (statements.has(node.kind)) statementCount++;
    if (ts.isCallExpression(node)) {
      tokens.push(`call:${callee(node.expression)}`);
      for (const a of node.arguments ?? []) emit(a);
      return;
    }
    if (ts.isNewExpression(node)) {
      tokens.push(`new:${callee(node.expression)}`);
      for (const a of node.arguments ?? []) emit(a);
      return;
    }
    if (ts.isTaggedTemplateExpression(node)) {
      tokens.push(`tag:${callee(node.tag)}`);
      return;
    }
    if (ts.isVariableDeclarationList(node)) {
      // The declaration KIND is a token, but its initializers are the body's real content — so this branch
      // tags and then falls through to the child walk below (it never returns early).
      tokens.push(node.flags & ts.NodeFlags.Const ? "decl:const" : node.flags & ts.NodeFlags.Let ? "decl:let" : "decl:var");
    } else if (literals.has(node.kind)) { tokens.push("lit"); return; }
    else if (ts.isIdentifier(node)) { tokens.push(locals.has(node.text) ? "local" : `id:${node.text}`); return; }
    else { const label = control.get(node.kind); if (label) tokens.push(label); }
    ts.forEachChild(node, emit);
  };
  if (fn.body) emit(fn.body);
  return { tokens, statementCount };
}

/** One uniform GROUP record, whichever arm produced it. `hash` is the arm's OWN digest carried through
 *  verbatim (ArchGuard's token hash for `exact`); the rest is a deterministic shape the records and the
 *  `source_digest` are built from. */
const normalizeGroup = (g) => ({
  hash: g.hash,
  tokenCount: g.tokenCount ?? null,
  statementCount: g.statementCount ?? null,
  lineCount: g.lineCount ?? null,
  members: [...g.members].map((m) => ({ file: m.file, startLine: m.startLine, endLine: m.endLine, name: m.name }))
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) || a.startLine - b.startLine),
});

/** The `exact` arm: ArchGuard's own grouping, adapted — never re-derived. `topN` is deliberately left
 *  undefined so the reading is the arm's FULL group count, comparable with the MCP tool's `totalGroups`. */
async function exactGroups({ root, sources, minStatements, minTokens, instrument }) {
  const analysis = await instrument.detectDuplicates(root, sources, { minStatements, minTokens, includeTests: false });
  return {
    groups: (analysis.groups ?? []).map(normalizeGroup).sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0)),
    scannedFiles: analysis.manifest?.scannedFiles ?? null,
    scannedFunctions: analysis.manifest?.scannedFunctions ?? null,
  };
}

/** The `callshape` arm: fingerprint every function in scope with the PACKAGE's compiler, then group equal
 *  signatures across ≥2 DISTINCT FILES (a signature repeated inside one file is not a cross-component
 *  finding, and the inventory this stage reasons over is component-level).
 *  ⛔ The two thresholds are applied to THIS arm's own counts. Its token stream is deliberately sparser
 *  than the `exact` arm's (a token per call and per control-flow node, not per AST node + closing marker),
 *  so one `--min-tokens` value is not the same cut on both arms — both counts are reported either way. */
function callshapeGroups({ root, sources, ts, collectSourceFiles, minStatements, minTokens }) {
  const files = collectSourceFiles(root, sources, false);
  const byHash = new Map();
  let scannedFunctions = 0;
  for (const abs of files) {
    const rel = path.relative(root, abs).split(path.sep).join("/");
    let text;
    try { text = fs.readFileSync(abs, "utf8"); } catch { continue; }
    let sf;
    try { sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true); } catch { continue; }
    const visit = (node) => {
      if (isFunctionLikeNode(ts, node) && node.body) {
        scannedFunctions++;
        const { tokens, statementCount } = callshapeTokens(ts, node);
        if (statementCount >= minStatements && tokens.length >= minTokens) {
          const hash = sha256(tokens.join(" "));
          const startLine = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          const endLine = sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
          const name = node.name?.getText?.(sf) ?? (ts.isConstructorDeclaration(node) ? "constructor" : "<anonymous>");
          const bucket = byHash.get(hash);
          const entry = { file: rel, startLine, endLine, name, tokenCount: tokens.length, statementCount };
          if (bucket) bucket.push(entry); else byHash.set(hash, [entry]);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  const groups = [];
  for (const [hash, entries] of byHash) {
    if (new Set(entries.map((m) => m.file)).size < 2) continue;
    const sorted = [...entries].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) || a.startLine - b.startLine);
    const lineCount = Math.max(...sorted.map((m) => m.endLine - m.startLine + 1));
    // The token count is shared by construction (the hash IS over the tokens); the statement count is not
    // hashed, so the group reports the LARGEST one rather than pretending they are all equal.
    groups.push({
      hash,
      tokenCount: sorted[0].tokenCount,
      statementCount: Math.max(...sorted.map((m) => m.statementCount)),
      lineCount,
      members: sorted.map((m) => ({ file: m.file, startLine: m.startLine, endLine: m.endLine, name: m.name })),
    });
  }
  groups.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0));
  return { groups, scannedFiles: files.length, scannedFunctions };
}

/**
 * Run ONE fingerprint arm over a pinned tree. ⛔ EVERY failure to load an instrument returns
 * `not-evaluated` — its own shape, with no `groups` key at all, so a caller cannot read "the instrument
 * was missing" as "the instrument found zero groups" (硬规则 3b).
 * @param {object} o
 * @param {"exact"|"callshape"} o.arm
 * @param {string} o.archguardRoot a root ALREADY resolved by `resolveArchguardRoot` ("" ⇒ not-evaluated)
 * @param {string[]} o.sources directories relative to `pinDir`, the same enumeration the MCP tool takes
 * @param {(u:string)=>Promise<any>} [o.importModule] INJECTABLE loader seam (tests)
 */
export async function fingerprintGroups({ pinDir, arm, archguardRoot, minStatements = DEFAULT_MIN_STATEMENTS, minTokens = DEFAULT_MIN_TOKENS, sources = [INVENTORY_SCOPE], importModule } = {}) {
  if (!FINGERPRINT_ARMS.includes(arm)) return notEvaluated(`FINGERPRINT_ARM_NOT_IN_VOCAB:${arm}`);
  if (!pinDir) return notEvaluated("PIN_DIR_REQUIRED");
  if (!archguardRoot) return notEvaluated("ARCHGUARD_ROOT_UNRESOLVED");
  const instrument = await loadArchguardInstrument(archguardRoot, importModule ? { importModule } : {});
  if (!instrument.ok) return notEvaluated(instrument.reason);
  const srcs = [...sources];
  // The `callshape` arm's dependency is resolved BEFORE the walk and reported on its own: a compiler the
  // package does not ship is a not-evaluated with the resolve/import cause, never "no collisions found".
  let out;
  if (arm === "callshape") {
    const tsr = await resolveArchguardTypescript(archguardRoot, importModule ? { importModule } : {});
    if (!tsr.ok) return notEvaluated(tsr.reason);
    try {
      out = { ...callshapeGroups({ root: pinDir, sources: srcs, ts: tsr.ts, collectSourceFiles: instrument.collectSourceFiles, minStatements, minTokens }), ts_version: tsr.version };
    } catch (err) {
      return notEvaluated(`FINGERPRINT_RUN_FAILED:${String(err?.message ?? err).split("\n")[0].slice(0, 200)}`);
    }
  } else {
    try { out = await exactGroups({ root: pinDir, sources: srcs, minStatements, minTokens, instrument }); }
    catch (err) { return notEvaluated(`FINGERPRINT_RUN_FAILED:${String(err?.message ?? err).split("\n")[0].slice(0, 200)}`); }
  }
  return { ok: true, arm, groups: out.groups, scanned_files: out.scannedFiles, scanned_functions: out.scannedFunctions, archguard_version: instrument.version, ts_version: out.ts_version ?? null };
}

/** The verb's INPUTS as a canonical, order-fixed object. They are hashed into `source_digest`, so a re-run
 *  at different thresholds, a different source list, a different pin, or a different ArchGuard build is a
 *  DIFFERENT pre-registered arm — never a silent substitution. */
export const fingerprintInputs = ({ pinDir, archguardRoot, arm, minStatements, minTokens, sources, archguardVersion = null }) => ({
  pin_dir: pinDir, archguard_root: archguardRoot, archguard_version: archguardVersion, arm,
  min_statements: minStatements, min_tokens: minTokens, sources: [...sources].sort(),
});

/** The digest a fingerprint RUN records, in place of `prompt_sha256`: sha256 over the canonical inputs
 *  and the raw grouping output. Deterministic (the grouping is deterministic), so a reproduction of the
 *  same pin + thresholds + build re-derives it byte for byte — which is what the prereg key binds. */
export const fingerprintDigest = ({ inputs, groups }) => sha256(`${JSON.stringify(inputs)}${JSON.stringify(groups)}`);

/** The TEMPLATED, neutral claim for one fingerprint group. It names the members and their line ranges and
 *  says only what the mechanism measured: a shared fingerprint is shared STRUCTURE, and a fingerprint
 *  cannot tell a true duplicate from two independent implementations that happen to normalize alike. */
export function fingerprintClaim({ arm, members }) {
  const label = arm === "exact" ? "AST-normalized body fingerprint" : "call-structure fingerprint";
  const named = members.map((m) => `${m.file}:${m.startLine}-${m.endLine} (${m.name})`).join(", ");
  return `${members.length} functions carry one ${label}: ${named}. A shared fingerprint is shared structure; it is not by itself evidence of a shared contract.`;
}

/** The hypothesis-shaped records one fingerprint group set produces — the SAME shape the investigator
 *  emits, so clustering, the verifier and the matcher all consume it with no new code path. */
export function fingerprintRecords({ groups, arm }) {
  return groups.map((g, i) => ({
    id: `FP${i + 1}`,
    components: [...new Set(g.members.map((m) => m.file))].sort(),
    concept_kind: FINGERPRINT_CONCEPT_KIND,
    claim: fingerprintClaim({ arm, members: g.members }),
    why_suspected: `mechanical ${arm} fingerprint collision (${g.hash}); ${g.members.length} bodies over ${new Set(g.members.map((m) => m.file)).size} files`,
    evidence_needed: g.members.map((m) => `${m.file}:${m.startLine}-${m.endLine}`),
    counterexample_requirement: "name one member whose contract, ownership or failure policy differs from the others'",
    confidence: "medium",
  }));
}

/** The run FILE a fingerprint pass writes. It carries `fingerprint_source` (the marker `runKind` reads)
 *  and `source_digest` in place of `prompt_sha256` — ⛔ a run file never carries both. */
export function fingerprintRunRecord({ arm, digest, inputs, groups, hyps, scanned = {} }) {
  return {
    run: 1,
    fingerprint_source: arm,
    source_digest: digest,
    inputs,
    scanned_files: scanned.files ?? null,
    scanned_functions: scanned.functions ?? null,
    groups: groups.length,
    n_hyps: hyps.length,
    hyps,
    groups_raw: groups,
  };
}

/** The KIND of a run file, read from the artifact (硬规则 2 — never from a CLI flag). A run that declares
 *  `fingerprint_source` is a fingerprint run; one that records `prompt_sha256` is an investigator run. A
 *  run that carries BOTH is `ambiguous` — its OWN value, refused rather than resolved by precedence
 *  (硬规则 3b: a tie must not be silently broken in favour of a passing gate). */
export function runKind(run) {
  const fp = run?.fingerprint_source != null;
  const prompt = run?.prompt_sha256 != null;
  if (fp && prompt) return "ambiguous";
  return fp ? "fingerprint" : "prompt";
}

/** Which fingerprint arm the run set at `runDir` came from, read from `run-1.json` itself. `null` = not a
 *  fingerprint run (or no run yet — the loader's own `RUNS_MISSING` covers that case). */
export function fingerprintArmAt({ runDir, fs: fsImpl = nodeFs } = {}) {
  const read = readJsonWith(fsImpl, path.join(runDir, "run-1.json"));
  if (!read.ok) return null;
  return read.value?.fingerprint_source != null ? String(read.value.fingerprint_source) : null;
}

/**
 * The run⇄prereg binding for a FINGERPRINT run. The prereg must carry `hashes["fingerprint-<arm>"]` equal
 * to the digest every run RECORDED, and `--arm` must name that arm.
 * ⛔ Three independent refusals, never a fallback: no `--arm` (`FINGERPRINT_ARM_REQUIRED`), an arm the
 * prereg does not declare (`PREREG_HASH_ABSENT`), a run whose own arm or digest disagrees.
 * ⛔ This is the ONE place a fingerprint run is judged; the prompt gate is never consulted for it.
 * @returns {null|{code:number, reasons:string[]}}
 */
export function fingerprintPreregRefusal({ prereg, runs, arm = null } = {}) {
  if (arm == null) return { code: EXIT.prereg, reasons: ["FINGERPRINT_ARM_REQUIRED"] };
  if (!FINGERPRINT_ARMS.includes(arm)) return { code: EXIT.prereg, reasons: [`FINGERPRINT_ARM_NOT_IN_VOCAB:${arm}`] };
  const key = fingerprintKey(arm);
  const declared = prereg?.hashes?.[key];
  if (declared === undefined) return { code: EXIT.prereg, reasons: [`PREREG_HASH_ABSENT:${key}`] };
  const reasons = [];
  for (const r of runs ?? []) {
    const id = r?.run ?? "?";
    if (r?.fingerprint_source !== arm) { reasons.push(`RUN_FINGERPRINT_ARM_MISMATCH:${id}:${r?.fingerprint_source}!=${arm}`); continue; }
    if (r?.source_digest == null) { reasons.push(`RUN_SOURCE_DIGEST_ABSENT:${id}`); continue; }
    if (r.source_digest !== declared) reasons.push(`PREREG_HASH_MISMATCH:${key}:${id}`);
  }
  return reasons.length ? { code: EXIT.prereg, reasons } : null;
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
 *
 * The runs are read BEFORE the hash gate because their KIND decides WHICH gate binds them, and the kind is
 * a property of the artifact (`runKind`), never of a CLI flag — so a caller cannot make a fingerprint run
 * be judged by the prompt gate (or the reverse) by passing or omitting a switch.
 *   • kind `fingerprint` ⇒ `hashes["fingerprint-<arm>"]` ⇄ the run's `source_digest`, via
 *     `fingerprintPreregRefusal`; the prompt/inventory bytes are not required and the model binding does
 *     not apply (a mechanical run makes no model call).
 *   • kind `prompt` ⇒ every byte of today's behaviour: `prompt-investigator` / `inventory` hashes, the
 *     run⇄prompt digest, then the model map.
 * ⛔ Neither gate falls back to the other's keys; a run set of MIXED kinds, or a run carrying both markers,
 * is its own refusal rather than being resolved by precedence.
 * @param {object} o.fs INJECTABLE — tests wrap it to record the file-read ORDER
 * @param {?string} o.arm `--arm` id; for a prompt run `expected` already carries the arm-scoped keys and
 *   the run⇄prereg binding reads the arm-scoped prompt key (never the unscoped one). For a fingerprint run
 *   the arm NAMES the instrument (`exact` / `callshape`) and keys the prereg hash.
 */
export function loadRunsGated({ runDir, runCount, preregPath, expected = {}, promptBytes = null, inventoryBytes = null, arm = null, fs: fsImpl = nodeFs }) {
  const runFiles = Array.from({ length: runCount }, (_, i) => path.join(runDir, `run-${i + 1}.json`));
  const runMtimes = [], missing = [];
  for (const f of runFiles) { const ms = statMsWith(fsImpl, f); if (ms === null) missing.push(path.basename(f)); else runMtimes.push(ms); }
  if (missing.length) return { ok: false, code: EXIT.runsIncomplete, reasons: [`RUNS_MISSING:${missing.join(",")}`] };

  const preregRead = readJsonWith(fsImpl, preregPath);
  const prereg = preregRead.ok ? preregRead.value : null;
  const preregMtimeMs = statMsWith(fsImpl, preregPath);

  const runs = [];
  for (const f of runFiles) {
    const read = readJsonWith(fsImpl, f);
    if (!read.ok) return { ok: false, code: EXIT.usage, reasons: [`RUN_UNREADABLE:${path.basename(f)}`] };
    runs.push(read.value);
  }
  const kinds = [...new Set(runs.map(runKind))].sort();
  if (kinds.length > 1) return { ok: false, code: EXIT.prereg, reasons: [`MIXED_RUN_KINDS:${kinds.join(",")}`] };
  const kind = kinds[0];
  if (kind === "ambiguous") return { ok: false, code: EXIT.prereg, reasons: ["RUN_KIND_AMBIGUOUS:carries-both-fingerprint_source-and-prompt_sha256"] };

  // The hash gate's EXPECTED map is kind-specific. A fingerprint run's digest is read off the run itself
  // (the prereg must have declared the same value BEFORE the run existed — the mtime rule below is what
  // makes that a pre-registration rather than a transcription); an unnamed `--arm` leaves the map empty so
  // the refusal comes from `fingerprintPreregRefusal` with its OWN reason.
  const gateExpected = kind === "fingerprint"
    ? (arm == null ? {} : { [fingerprintKey(arm)]: runs[0]?.source_digest })
    : expected;
  const gate = preregRefusal({ prereg, expected: gateExpected, preregMtimeMs, runMtimesMs: runMtimes });
  if (gate) return { ok: false, code: gate.code, reasons: gate.reasons };

  if (kind === "fingerprint") {
    const fg = fingerprintPreregRefusal({ prereg, runs, arm });
    if (fg) return { ok: false, code: fg.code, reasons: fg.reasons };
    return { ok: true, kind, runs, runFiles, prereg };
  }

  // The declared hashes are checked against the prereg above; the RUNS are bound to the artifacts here.
  const runGate = runPromptRefusal({ runs, promptBytes, inventoryBytes, expectedPromptSha: expected[armScopedKey("prompt-investigator", arm)] ?? null });
  if (runGate) return { ok: false, code: runGate.code, reasons: runGate.reasons };
  // The MODEL binding (Plan 5): when the prereg declares a `models` map, each run's REQUESTED model must
  // match the arm's pre-registered one. A run that recorded no model is its own refusal under a declared map.
  const modelGate = modelPreregRefusal({ prereg, runs, arm });
  if (modelGate) return { ok: false, code: modelGate.code, reasons: modelGate.reasons };
  return { ok: true, kind, runs, runFiles, prereg };
}

/**
 * The ONLY path that reads the labels file. The runs are read IN FULL first, so the labels are the LAST
 * thing read: their read order is a property of the code, not of the caller's discipline (硬规则 3b).
 * The labels' hash is then taken over the bytes JUST read and compared with the prereg's — a labels file
 * edited after the pre-registration therefore refuses (gap-hypgen-prereg-gate-…: the labels were
 * previously never hashed at all, so a post-hoc edit scored as pre-registered).
 */
export function score({ runDir, runCount, labelsPath, preregPath, expected = {}, promptBytes = null, inventoryBytes = null, arm = null, fs: fsImpl = nodeFs }) {
  const loaded = loadRunsGated({ runDir, runCount, preregPath, expected, promptBytes, inventoryBytes, arm, fs: fsImpl });
  if (!loaded.ok) return loaded;
  const labelsRead = readTextWith(fsImpl, labelsPath);
  if (!labelsRead.ok) return { ok: false, code: EXIT.usage, reasons: [`LABELS_UNREADABLE:${labelsRead.error}`] };
  const declared = (loaded.prereg?.hashes ?? {}).labels;
  if (declared === undefined) return { ok: false, code: EXIT.prereg, reasons: ["PREREG_HASH_ABSENT:labels"] };
  const actual = sha256(labelsRead.text);
  if (declared !== actual) return { ok: false, code: EXIT.prereg, reasons: [`PREREG_HASH_MISMATCH:labels`] };
  let labels; try { labels = JSON.parse(labelsRead.text); } catch (e) { return { ok: false, code: EXIT.usage, reasons: [`LABELS_UNREADABLE:${String(e?.message ?? e)}`] }; }
  return { ok: true, kind: loaded.kind, labels, runs: loaded.runs, runFiles: loaded.runFiles, prereg: loaded.prereg, matches: mechanicalMatch({ runs: loaded.runs, labels }) };
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
        // The observability the budget-exhaustion defect lacked: how the call was instrumented and how many
        // tool-call turns it spent. A row that predates the instrumentation omits them (⛔ no invented 0).
        ...(v.instrumentation !== undefined ? { verifier_instrumentation: v.instrumentation } : {}),
        ...(Number.isFinite(v.turns_used) ? { verifier_turns_used: v.turns_used } : {}),
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

/** Override ONLY this call's `--model`: replace the VALUE the launcher resolved, in place, so every other
 *  token is untouched and a call WITHOUT an override is byte-identical to before. This is a PER-CALL
 *  override, never global launcher config — editing the launcher to run a model comparison would also
 *  change production drivers. When the launcher resolved no `--model`, the pair is inserted before the
 *  trailing prompt flag (⛔ never appended after it, which would be read as the prompt). */
export function applyModel(argv, model) {
  const i = argv.indexOf("--model");
  if (i >= 0) argv[i + 1] = String(model);
  else argv.splice(argv.length - 1, 0, "--model", String(model));
  return argv;
}

/** The hardened launcher argv: no tools, no slash commands, no session, strict MCP. The ONE line that
 *  resolves the launcher role is the `launchArgv(...)` call below — every other line of this module, and
 *  all three prompt files, are free of any holdout-specific text.
 *  `model` is the OPTIONAL per-call override (a model comparison without touching global config); `null`
 *  leaves the launcher's resolved model exactly as it was. */
export function hardenedArgv(launchArgv, prompt, root, { tools = "", maxTurns = null, outputFormat = null, model = null } = {}) {
  const argv = launchArgv("meta-driver", prompt, root, { promptViaStdin: true });
  const extra = ["--tools", tools, "--disable-slash-commands", "--no-session-persistence", "--strict-mcp-config"];
  if (maxTurns !== null) extra.push("--max-turns", String(maxTurns));
  // `stream-json` is what makes the per-turn record POSSIBLE: `--verbose` is required with it in print
  // mode. Without it the CLI emits only the final text, and a budget exhaustion leaves NO trace of the
  // turns that consumed it (the acceptance defect this task closes).
  if (outputFormat !== null) extra.push("--output-format", String(outputFormat), "--verbose");
  argv.splice(argv.length - 1, 0, ...extra);
  if (model != null) applyModel(argv, model);
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
 *  `--*-sha` flag, which is a claim about the bytes rather than a reading of them. With `--arm X` the keys
 *  are ARM-SCOPED (`prompt-investigator-X` / `inventory-X`); ⛔ the unscoped keys are NEVER emitted as a
 *  fallback, so a prereg that records them for arm A cannot silently score arm B — an absent arm key is
 *  its OWN refusal (`PREREG_HASH_ABSENT:prompt-investigator-X`), never a match. */
export function expectedFromArtifacts({ promptBytes, inventoryBytes, arm = null }) {
  return {
    [armScopedKey("prompt-investigator", arm)]: sha256(promptBytes),
    [armScopedKey("inventory", arm)]: sha256(inventoryBytes),
  };
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

/** Parse `--arm <id>`. Absent ⇒ `{ok:true, arm:null}` (today's single-arm behaviour, byte-identical). A
 *  value that is not `[A-Za-z0-9]+` is a USAGE refusal rather than a silently-unsuffixed key: a typo that
 *  fell back to the unscoped keys would score the wrong arm as pre-registered (硬规则 3b). */
function armFromArgs(args) {
  const v = argOf(args, "--arm", null);
  if (v === null) return { ok: true, arm: null };
  if (!ARM_ID_RE.test(v)) return { ok: false, reason: `--arm must match ${ARM_ID_RE.source}, got ${JSON.stringify(v)}` };
  return { ok: true, arm: v };
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
    // The model this call is ASKED for: the `--model` override when given, else the launcher's resolved
    // default. `hardenedArgv(..., { model })` is what actually places it in the argv.
    const modelOverride = argOf(args, "--model", null);
    const model = modelFromArgv(hardenedArgv(launchArgv, "", root, { model: modelOverride }));
    if (!model) { console.error(`${TOOL} investigate: launchArgv("meta-driver") resolved no --model — refusing to record runs whose model is unknown`); return EXIT.usage; }
    // stream-json so the run records the ACTUAL served model and the token cost, not just the request.
    const runModel = async (p) => runAsync(hardenedArgv(launchArgv, p, root, { model: modelOverride, outputFormat: "stream-json" }), { timeoutMs: Number(argOf(args, "--timeout-ms", 900_000)), collectStderr: true, stdinData: p });
    const res = await runInvestigator({
      prompt, neutralDir, cwd: process.cwd(), runs: Number(argOf(args, "--runs", 3)), runModel, outDir, model,
      promptFile: path.relative(root, inputs.promptPath), promptFileSha256: sha256(promptBytes), inventorySha256: sha256(inventoryBytes),
      writeFile: (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t, "utf8"); },
      budget: { maxRuns: Number(argOf(args, "--max-runs", 3)), maxMs: argOf(args, "--max-ms", null) === null ? null : Number(argOf(args, "--max-ms")) },
    });
    console.log(JSON.stringify(json ? res : {
      ...res,
      // The per-run summary names the model identity + cost this task makes observable, so the reading is
      // legible from the default output without `--json` (the AC's real-call evidence).
      records: (res.records ?? []).map((r) => ({
        run: r.run, exit: r.exit, n_hyps: r.n_hyps, parse_error: r.parse_error, wall_ms: r.wall_ms,
        requested_model: r.requested_model, actual_model: r.actual_model, model_mismatch: r.model_mismatch, usage: r.usage, cost_usd: r.cost_usd,
      })),
    }, null, json ? 1 : 0));
    return res.ok ? 0 : res.code;
  }

  if (verb === "fingerprint") {
    const pinArg = argOf(args, "--pin-dir", null);
    if (!pinArg) { console.error(`${TOOL} fingerprint: --pin-dir <stripped pinned tree> is required`); return EXIT.usage; }
    const pinDir = path.resolve(pinArg);
    if (!fs.existsSync(pinDir)) { console.error(`${TOOL} fingerprint: PIN_DIR_MISSING:${pinDir}`); return EXIT.usage; }
    // ONE arm per invocation: each is a different instrument and gets its own prereg key, so an
    // invocation that silently ran both would produce two run sets under one name (硬规则 3).
    const arm = argOf(args, "--arm", null);
    if (arm === null) { console.error(`${TOOL} fingerprint: --arm <${FINGERPRINT_ARMS.join("|")}> is required`); return EXIT.usage; }
    if (!FINGERPRINT_ARMS.includes(arm)) { console.error(`${TOOL} fingerprint: --arm must be one of ${FINGERPRINT_ARMS.join("|")}, got ${arm}`); return EXIT.usage; }
    const minStatements = Number(argOf(args, "--min-statements", DEFAULT_MIN_STATEMENTS));
    const minTokens = Number(argOf(args, "--min-tokens", DEFAULT_MIN_TOKENS));
    const sources = [];
    for (let i = 0; i < args.length; i++) if (args[i] === "--source") sources.push(args[i + 1]);
    const srcs = sources.length ? sources : [INVENTORY_SCOPE];
    // ⛔ An explicit `--archguard-root` is authoritative: an unresolvable one is not-evaluated, NEVER a
    // silent fall back to the plugin default (the two builds' counts are not comparable).
    const archguardRoot = resolveArchguardRoot(argOf(args, "--archguard-root", null));
    const res = await fingerprintGroups({ pinDir, arm, archguardRoot, minStatements, minTokens, sources: srcs });
    if (!res.ok) {
      // ⛔ NOT-EVALUATED writes NOTHING and exits on its OWN code: a zero-group carrier would be
      // indistinguishable from "the instrument ran and found nothing" (硬规则 3b).
      console.error(`${TOOL} fingerprint: NOT_EVALUATED:${res.reason}`);
      return res.code;
    }
    const inputs = fingerprintInputs({ pinDir, archguardRoot, arm, minStatements, minTokens, sources: srcs, archguardVersion: res.archguard_version });
    const digest = fingerprintDigest({ inputs, groups: res.groups });
    const hyps = fingerprintRecords({ groups: res.groups, arm });
    const report = {
      tool: TOOL, verb, arm, pin_dir: pinDir, archguard_root: archguardRoot,
      archguard_version: res.archguard_version, ts_version: res.ts_version,
      min_statements: minStatements, min_tokens: minTokens, sources: srcs,
      scanned_files: res.scanned_files, scanned_functions: res.scanned_functions,
      groups: res.groups.length, hypotheses: hyps.length, source_digest: digest, inputs,
    };
    // `--prereg-out` writes (or updates) the pre-registration an ARM's digest goes into, and writes NO
    // run: the run has to POSTDATE the prereg for the mtime rule to mean anything. Without it the caller
    // reads `source_digest` off the report and re-runs, since the grouping is deterministic.
    const preregOut = argOf(args, "--prereg-out", null);
    if (preregOut) {
      const p = path.resolve(preregOut);
      let doc = { hashes: {} };
      try { doc = JSON.parse(fs.readFileSync(p, "utf8")); } catch { /* a new prereg is created, never a silent overwrite of an unreadable one */ }
      if (doc == null || typeof doc !== "object" || Array.isArray(doc)) doc = {};
      doc.hashes = { ...(doc.hashes ?? {}), [fingerprintKey(arm)]: digest };
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify(doc, null, 1), "utf8");
      report.prereg_out = p;
      report.run_written = null;
    } else {
      const runsDir = path.resolve(argOf(args, "--runs", path.join(outDir, `fingerprint-${arm}`)));
      const runFile = path.join(runsDir, "run-1.json");
      fs.mkdirSync(runsDir, { recursive: true });
      fs.writeFileSync(runFile, JSON.stringify(fingerprintRunRecord({ arm, digest, inputs, groups: res.groups, hyps, scanned: { files: res.scanned_files, functions: res.scanned_functions } }), null, 1), "utf8");
      report.run_written = runFile;
    }
    if (json) console.log(JSON.stringify(report, null, 1));
    else console.log(`${TOOL} fingerprint arm=${arm} groups=${res.groups.length} hypotheses=${hyps.length} files=${res.scanned_files} functions=${res.scanned_functions} source_digest=${digest}${report.run_written ? ` run=${report.run_written}` : ""}${report.prereg_out ? ` prereg=${report.prereg_out}` : ""}`);
    return 0;
  }

  if (verb === "verify") {
    const pinDir = argOf(args, "--pin-dir", null);
    const runsDir = path.resolve(argOf(args, "--runs", outDir));
    if (!pinDir) { console.error(`${TOOL} verify: --pin-dir is required`); return EXIT.usage; }
    // The run KIND decides whether a prompt + inventory are needed at all; read it off the artifact.
    const fpArm = fingerprintArmAt({ runDir: runsDir });
    const runCount = Number(argOf(args, "--run-count", fpArm ? 1 : 3));
    const inputs = fpArm ? { ok: true, promptBytes: null, inventoryBytes: null } : readRunInputs(args);
    if (!inputs.ok) { console.error(`${TOOL} verify: ${inputs.reason}`); return EXIT.usage; }
    const armSpec = armFromArgs(args);
    if (!armSpec.ok) { console.error(`${TOOL} verify: ${armSpec.reason}`); return EXIT.usage; }
    if (!fpArm) {
      const extra = cliExtraShaRefusals(args, inputs);
      if (extra.length) { console.error(`${TOOL} verify: ${extra.join(", ")}`); return EXIT.prereg; }
    }
    // verify needs the RUNS, not the labels (labels stay confined to match/review) — but it must still bind
    // the runs to their pre-registration: prompt + inventory for an investigator run, `fingerprint-<arm>`
    // for a fingerprint one (the loader picks the gate from the run's own kind).
    const gate = loadRunsGated({
      runDir: runsDir, runCount, preregPath: argOf(args, "--prereg", null),
      expected: fpArm ? {} : expectedFromArtifacts({ ...inputs, arm: armSpec.arm }),
      promptBytes: inputs.promptBytes, inventoryBytes: inputs.inventoryBytes,
      arm: armSpec.arm,
    });
    if (!gate.ok) { console.error(`${TOOL} verify: ${gate.reasons.join(", ")}`); return gate.code; }
    const experiment = resolveExperimentId({ flag: argOf(args, "--experiment", null), prereg: gate.prereg }) ?? STORE_EXPERIMENT;
    const clusters = clusterHypotheses(gate.runs);
    // The SELECTION, before any prompt is read: `--only-cluster <n>` is a diagnostic selector (one model
    // call for one cluster, by its position in the FULL list). An out-of-range value is caught HERE, so no
    // prompt file is opened for a run that cannot happen.
    const onlyCluster = argOf(args, "--only-cluster", null) === null ? null : Number(argOf(args, "--only-cluster"));
    if (onlyCluster !== null && (!Number.isInteger(onlyCluster) || onlyCluster < 1 || onlyCluster > clusters.length)) {
      console.error(`${TOOL} verify: ONLY_CLUSTER_OUT_OF_RANGE:${argOf(args, "--only-cluster")} (1..${clusters.length})`);
      return EXIT.usage;
    }
    const strategy = argOf(args, "--strategy", "default");
    if (!VERIFIER_STRATEGIES.includes(strategy)) { console.error(`${TOOL} verify: --strategy must be one of ${VERIFIER_STRATEGIES.join("|")}, got ${strategy}`); return EXIT.usage; }
    // The frozen verifier prompt is the DEFAULT; the evidence-pack prompt is a SEPARATE file and is never
    // reached unless that strategy was named (an accidental default would silently change the experiment).
    const defaultPromptFile = strategy === "evidence-pack" ? evidencePackVerifierPrompt() : defaultVerifierPrompt();
    const template = fs.readFileSync(argOf(args, "--prompt", defaultPromptFile), "utf8");
    const runtime = await importDriverRuntime();
    if (!runtime.ok) { console.error(`${TOOL} verify: ${runtime.reason}`); return EXIT.usage; }
    const { launchArgv, runAsync } = runtime.mod;
    const maxTurns = Number(argOf(args, "--max-turns", 8));
    // The provenance sidecar (from `inventory --inventory-form provenance --out-entries`) turns on the
    // MECHANICAL shared-import finding. Absent ⇒ no edge data, so no finding to attach and the verifier's
    // rows and packs are byte-identical to the pre-2026-10-12 rendering (硬规则 3b: no data ⇒ no reading).
    const provenanceFile = argOf(args, "--provenance", null);
    const provenance = provenanceFile ? JSON.parse(fs.readFileSync(provenanceFile, "utf8")) : null;
    // The pack's SOURCES are read from the PIN, by position: only the named components' files, never a
    // repo-wide walk. `--evidence-source-root <dir>` defaults to the pin dir.
    const evidenceRoot = argOf(args, "--evidence-source-root", pinDir);
    const evidenceMaxLines = Number(argOf(args, "--evidence-max-lines", DEFAULT_EVIDENCE_MAX_LINES));
    const packHitsFile = argOf(args, "--evidence-hits", null);
    const packHits = packHitsFile ? JSON.parse(fs.readFileSync(packHitsFile, "utf8")) : [];
    const readEvidenceSources = (components) => {
      const sources = {};
      for (const c of components) {
        const rel = repoRelComponent(c);
        for (const p of [path.join(evidenceRoot, rel), path.join(evidenceRoot, "plugin", "scripts", path.basename(rel))]) {
          try { if (fs.existsSync(p)) { sources[path.posix.basename(rel)] = fs.readFileSync(p, "utf8"); break; } } catch { /* try next */ }
        }
      }
      return sources;
    };
    // ⛔ EVERY verify model call is instrumented: `--output-format stream-json` is what leaves the per-turn
    // record AND the actual model identity + token cost. Without it a budget exhaustion is again a 28-byte
    // string and the served model / cost are unobservable.
    const modelOverride = argOf(args, "--model", null);
    const requestedModel = modelFromArgv(hardenedArgv(launchArgv, "", root, { model: modelOverride }));
    const runModel = async (p) => runAsync(hardenedArgv(launchArgv, p, root, { tools: "Read,Grep", maxTurns, outputFormat: "stream-json", model: modelOverride }), { timeoutMs: Number(argOf(args, "--timeout-ms", 300_000)), collectStderr: true, stdinData: p });
    const selectedForSources = onlyCluster != null ? [clusters[onlyCluster - 1]] : clusters.slice(0, Number(argOf(args, "--max-clusters", HARD_MAX_CLUSTERS)));
    const evidence = strategy === "evidence-pack"
      ? { sources: readEvidenceSources(selectedForSources.flatMap((c) => c.rep.components ?? [])), provenance, hits: packHits, maxLines: evidenceMaxLines }
      : null;
    const res = await runVerifier({
      clusters, pinDir, cwd: process.cwd(), promptTemplate: template, runModel, provenance,
      onlyCluster, strategy, evidence, model: requestedModel,
      maxClusters: Number(argOf(args, "--max-clusters", HARD_MAX_CLUSTERS)),
      maxMs: argOf(args, "--max-ms", null) === null ? null : Number(argOf(args, "--max-ms")),
    });
    if (!res.ok) { console.error(`${TOOL} verify: ${res.reasons.join(", ")}`); return res.code; }
    const outFile = path.resolve(argOf(args, "--out", path.join(outDir, "verify.json")));
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    const mechField = mechanicalSummaryField({ provenance, mechanical_evidence: res.mechanical_evidence });
    fs.writeFileSync(outFile, JSON.stringify({ clusters_total: res.clusters_total, verified: res.verified, beyond_cap: res.beyond_cap, ...mechField, strategy: res.strategy, run_order: res.run_order, results: res.results }, null, 1));
    const tally = emit(verifyRecords({ verify: res, experiment }), { out: path.join(outDir, "verify-records.jsonl"), writeStore: has(args, "--write-store"), root: has(args, "--write-store") ? root : null });
    console.log(JSON.stringify({ clusters_total: res.clusters_total, verified: res.verified, beyond_cap: res.beyond_cap, ...mechField, strategy: res.strategy, run_order: res.run_order, verdicts: res.results.reduce((a, r) => ((a[r.verdict] = (a[r.verdict] ?? 0) + 1), a), {}), turns_used: res.results.map((r) => r.turns_used), validator: { accepted: tally.accepted, refused: tally.refused } }, null, json ? 1 : 0));
    return 0;
  }

  if (verb === "match" || verb === "review") {
    const runDir = path.resolve(argOf(args, "--runs", outDir));
    const labelsPath = argOf(args, "--labels", null);
    const preregPath = argOf(args, "--prereg", null);
    if (!labelsPath) { console.error(`${TOOL} ${verb}: --labels is required`); return EXIT.usage; }
    // A fingerprint run has no prompt and no inventory; its KIND (read off the run file) says so, so the
    // artifacts are required only for an investigator run — never as a precondition the mechanism lacks.
    const fpArm = fingerprintArmAt({ runDir });
    const inputs = fpArm ? { ok: true, promptBytes: null, inventoryBytes: null } : readRunInputs(args);
    if (!inputs.ok) { console.error(`${TOOL} ${verb}: ${inputs.reason}`); return EXIT.usage; }
    const armSpec = armFromArgs(args);
    if (!armSpec.ok) { console.error(`${TOOL} ${verb}: ${armSpec.reason}`); return EXIT.usage; }
    if (!fpArm) {
      const extra = cliExtraShaRefusals(args, inputs);
      if (extra.length) { console.error(`${TOOL} ${verb}: ${extra.join(", ")}`); return EXIT.prereg; }
    }
    const res = score({
      runDir, runCount: Number(argOf(args, "--run-count", fpArm ? 1 : 3)), labelsPath, preregPath,
      expected: fpArm ? {} : expectedFromArtifacts({ ...inputs, arm: armSpec.arm }),
      promptBytes: inputs.promptBytes, inventoryBytes: inputs.inventoryBytes,
      arm: armSpec.arm,
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
    // Each reviewer call is asked for the SAME model the rest of the pass uses (the `--model` override when
    // given, else the launcher's default) and runs with stream-json, so the row records the ACTUAL model
    // and the cost. The review verdict is parsed from the STREAM's result text (Plan 4), never raw stdout.
    const modelOverride = argOf(args, "--model", null);
    const requestedModel = modelFromArgv(hardenedArgv(launchArgv, "", root, { model: modelOverride }));
    const reviews = [];
    for (const m of matches) {
      const c = (res.labels.cases ?? []).find((x) => x.id === m.case);
      const prompt = template.replace("{{CASE}}", c?.description ?? "").replace("{{HYP}}", JSON.stringify({ components: m.comps, concept_kind: m.kind, claim: m.claim, counterexample_requirement: m.counter }));
      const t0 = Date.now();
      const r = await runAsync(hardenedArgv(launchArgv, prompt, root, { model: modelOverride, outputFormat: "stream-json" }), { timeoutMs: 300_000, collectStderr: true, stdinData: prompt });
      const stdout = String(r?.stdout ?? "");
      reviews.push({
        case: m.case, run: m.run, hid: m.hid, comps: m.comps, wall_ms: Date.now() - t0,
        ...modelCallFields({ requested: requestedModel, stdout }),
        review: parseJsonObject(callText(stdout)) ?? { unparseable: true },
      });
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

  console.error(`usage: ${TOOL} <inventory|fingerprint|investigate|verify|match|review|report> [options]`);
  console.error(`  The investigator prompt defaults to the FROZEN round-1 file (${FROZEN_INVESTIGATOR_PROMPT});`);
  console.error("  `investigator.txt` is the reworded VARIANT and is never the default. Every run records the prompt");
  console.error("  file it used plus that file's hash, and the pre-registration gate re-derives each run's recorded");
  console.error("  prompt digest from the prompt + inventory bytes supplied here (--prompt-sha / --inventory-sha are");
  console.error("  optional extra assertions, never the gate).");
  console.error("  inventory   --pin <rev> [--inventory-form neutral|provenance] [--max-exports N] [--max-carriers N] [--carrier-forms literal|literal+join] [--contamination-pairs <f>] [--out <f>] [--out-entries <f>]");
  console.error("              --inventory-form provenance adds `imports` / `imported_by` to every entry (opt-in; the");
  console.error("              neutral form is the DEFAULT and its bytes are frozen). A provenance run needs its OWN");
  console.error("              prompt file, hashed in its OWN pre-registration under the arm key (`--arm <id>`); the");
  console.error("              frozen investigator prompt is never touched. ONE prereg covers every arm: with `--arm X`");
  console.error("              the gate compares the supplied bytes against `prompt-investigator-X` / `inventory-X`.");
  console.error("  investigate --inventory <f> --neutral-dir <dir> [--investigator-prompt <f>] [--model <id>] [--runs N] [--max-runs N] [--max-ms N] [--timeout-ms N] [--out-dir <dir>]");
  console.error("  fingerprint --pin-dir <dir> --arm <exact|callshape> [--archguard-root <dir>] [--min-statements N] [--min-tokens N] [--source <dir>]... [--runs <dir>] [--prereg-out <f>]");
  console.error("              writes a RUN file whose clusters come from a MECHANISM: `exact` runs ArchGuard's own");
  console.error("              detectDuplicates (never re-implemented), `callshape` fingerprints each body by its callee");
  console.error("              names + control-flow kinds with the `typescript` the ArchGuard package ships. The run");
  console.error("              records `fingerprint_source` + `source_digest` IN PLACE OF `prompt_sha256`, and");
  console.error(`              \`verify\`/\`match\`/\`review\` bind it to hashes["fingerprint-<arm>"] (--run-count defaults to 1).`);
  console.error("              ⛔ an unresolvable root/compiler exits 11 and writes NOTHING — never a zero-group run.");
  console.error("              --prereg-out writes that key into a prereg and writes no run (the run must postdate it).");
  console.error("  verify      --pin-dir <dir> --runs <dir> --inventory <f> [--provenance <f>] [--prereg <f>] [--investigator-prompt <f>] [--arm <id>] [--experiment <id>] [--model <id>] [--max-clusters N] [--max-turns N] [--max-ms N]");
  console.error("              --provenance <f> attaches the MECHANICAL shared-import finding: a cluster whose members'");
  console.error("              edges converge on one component carries it as `mechanical_evidence` AND in its pack, with the");
  console.error("              named components that do NOT import the definer. ⛔ it is EVIDENCE, never a verdict: every");
  console.error("              cluster still gets a model call (an import edge cannot settle a claim about behaviour).");
  console.error("              [--strategy default|evidence-pack] [--only-cluster N] [--evidence-source-root <dir>] [--evidence-max-lines N] [--evidence-hits <f>] [--prompt <f>]");
  console.error("              every model call runs with --output-format stream-json, so each row carries the per-turn");
  console.error("              tool calls (`turns`) and `turns_used`; a call with no parseable stream is");
  console.error("              `not-evaluated:uninstrumented`. --only-cluster N runs ONE cluster by its 1-based position.");
  console.error("              --strategy evidence-pack is opt-in: it uses the SEPARATE prompt file");
  console.error("              verifier-evidence-pack.txt, whose pack leads with the mechanical shared-import finding.");
  console.error("              ⛔ the pinned tree must carry NONE of: " + PIN_FORBIDDEN_DIRS.join(", ") + " (scope enforcement).");
  console.error("  match       --runs <dir> --labels <f> --inventory <f> [--prereg <f>] [--investigator-prompt <f>] [--arm <id>] [--experiment <id>] [--run-count N] [--write-store]");
  console.error("  review      --runs <dir> --labels <f> --matches <f> --neutral-dir <dir> --inventory <f> [--prereg <f>] [--arm <id>] [--experiment <id>] [--model <id>]");
  console.error("  --arm <id> ([A-Za-z0-9]+) scopes the pre-registration gate to one arm of an A/B experiment: the");
  console.error("  gate reads `prompt-investigator-<id>` / `inventory-<id>`, and a prereg lacking them refuses with");
  console.error("  PREREG_HASH_ABSENT (⛔ never a fallback to the unscoped keys). Omitted ⇒ single-arm, unchanged.");
  console.error("  report      --artifacts <dir> [--labels <f>] [--out <md>]");
  console.error("  --experiment <id> overrides the id read from the prereg (fields: experiment | experiment_id | acceptance_run).");
  console.error("  --model <id> (investigate|verify|review) overrides ONLY that call's model in the hardened argv — a");
  console.error("  per-call override for a model comparison, never global launcher config; omitted ⇒ byte-identical. Every");
  console.error("  model call records requested_model, actual_model (the stream init event's model; absent ⇒");
  console.error("  `not-evaluated:model-unverified`), model_mismatch, usage and cost_usd. A prereg `models` map (if");
  console.error("  present) must name each run's requested model under the arm-scoped key `model` / `model-<id>`, or");
  console.error("  scoring refuses (PREREG_MODEL_ABSENT / PREREG_MODEL_MISMATCH).");
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
