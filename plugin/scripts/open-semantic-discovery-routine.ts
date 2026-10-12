// open-semantic-discovery-routine.ts — wire OPEN-ENDED SEMANTIC architecture discovery into the
// quality-gate driver's routine track, as a REPORT-ONLY, bounded, killable, budgeted semantic round.
//
// WHY THIS EXISTS. A 2026-10-12 operator audit of this workspace's discovery carriers measured that
// continuous AUTOMATIC architecture discovery had produced ZERO confirmed new code problems in 24h:
//   · `arch-discovery` is purely mechanical — no model, no verification. Its "new" fingerprints were
//     test-red signals.
//   · `semantic-dedup-scan` is model-driven but only every 1440m and only for the duplication class.
//   · `discovery-method` reflects on Experience summaries with `tools:""` — it produces METHODS, not
//     findings, and nothing applies them to code.
// The ONE path that found a real new defect recently was open-ended hypothesis generation + source
// Read/Grep verification (docs/analysis/arch-hypothesis-generation.mjs, the 2026-10-12 capability-gain
// experiment: GAIN1-CTRL-c10, fixed by gap-self-report-vocab-audit-check-pattern-tables-diverge,
// 74b4341b8). That path existed but was only ever run BY HAND. This module schedules it.
//
// GOVERNING PRINCIPLE — SEMANTIC FIRST, MECHANIZE LATER (user ruling, 2026-10-12). The mechanical code
// here is limited to scheduling, state/provenance persistence, dedup ASSISTANCE, safety isolation,
// budget and tool wrapping. It never replaces a semantic judgment, never gates whether the model may
// look, and "no mechanical change" never suppresses a semantic round:
//   · the inventory is an OPTIONAL MAP, never a filter and never a prerequisite (see `runOpenSemanticRound`
//     step ④): an empty, missing or unbuildable inventory still runs the semantic round;
//   · a pin unchanged since the last round still runs it;
//   · `arch-discovery` reporting 0 new fingerprints still runs it — in fact this module never reads that
//     routine's carrier at all;
//   · there is NO classifier, fingerprint gate or problem-class pattern table anywhere below. The only
//     pattern-shaped thing in this file is a PROTOCOL MARKER (`FOCUS_MARKER`, the tag the model uses to
//     state its own exploration focus) — it selects nothing and rejects nothing. `dedup` is ASSISTANCE
//     ONLY: `clusterHypotheses` merges near-duplicate hypotheses across runs by component-set overlap;
//     nothing is discarded by shape.
//
// ⛔ WHAT IS REUSED, AND WHY NOTHING IS RE-DERIVED (硬规则 5b): the model steps are the EXISTING
// arch-hypothesis-generation.mjs functions (`runInvestigator`, `runVerifier`, `clusterHypotheses`,
// `hardenedArgv`, `parseJsonObject`, `verifyCwdRefusal`), loaded from disk at RUNTIME like
// `discovery-method-routine.loadDiscoveryModules` does — never by a static `../../docs/analysis` import,
// because this file is SHIPPED and such a specifier both escapes the built artifact and inlines those
// modules' entry guards into the driver bundles (see the discovery-method re-land note). Interval
// scheduling is routine-scheduler.isDue against the DURABLE `.quay/routine-last-run.json`; halt is the
// driver's own control file; the round's fact is the Fact this routine returns. The budget is the hard,
// atomic, pre-spawn reservation ledger delivered by gap-discovery-method-24h-budget-hard-reservation —
// imported, under THIS routine's own key paths and its own cap (240 is discovery-method's cap and is not
// shared silently).
//
// REPORT-ONLY ON TASKS AND GOALS, STRUCTURALLY: this file imports no filing/authoring function and writes
// no task and no goal. Its persistence is (a) append-only lines on ONE carrier,
// `.quay/open-semantic-discovery-findings.jsonl`, (b) this routine's own reservation ledger, (c) the
// existing quality-round fact, and — since gap-open-discovery-findings-into-portfolio-experience — (d) the
// Discovery Experience ledger and the Discovery Portfolio, BOTH reached only through the engine modules
// loaded at runtime below. The absence of the authoring imports is asserted mechanically by the case-(i)
// static control in plugin/test/open-semantic-discovery-routine.test.mjs. ⚠️ Consequence for maintainers:
// do NOT name the forbidden authoring symbols here, not even in a comment (the control reads POSITION, and
// a comment mention would be a false positive). That includes the portfolio module's human-only rating
// verb, which this routine must never call.
//
// ⛔ WHAT THE POST-ROUND INGESTION STEP IS, AND WHAT IT IS NOT. After a round's confirmed clusters are on
// the carrier, each one goes through a NOVELTY CHECK and then into the two value/learning ledgers:
//   · MECHANICAL, and only retrieval: `retrieveNoveltyCandidates` gathers candidates with the same or
//     overlapping components from the Portfolio, `.quay/routine-findings.jsonl`,
//     `.quay/arch-discovery-findings.jsonl` subject keys and task Touches on develop; it also gathers a
//     WIDER context (Portfolio claims and task titles) that is ALWAYS supplied. It never labels anything.
//   · SEMANTIC, and it is the judgment: ONE bounded model call per confirmed cluster reads the claim, the
//     retrieved candidates and the wider context (and may Read/Grep the source itself) and returns
//     `novel` / `duplicate` / `restatement`. It reserves budget like every other step.
//   · "NO MECHANICAL CANDIDATE" IS NOT A VERDICT. A cluster with zero candidates still gets the call —
//     with the wider context — and is NEVER auto-labelled novel.
//   · The ONE mechanical exception, recorded as such (`disposition:"mechanical-duplicate"`): a cluster
//     whose component set AND claim are byte-identical to a PREVIOUS ROUND's own cluster record. Nothing
//     is written for it at all — neither ledger — so a re-seen cluster cannot inflate either count.
//   · The novelty verdict is NOT a rating and NOT a value judgment: it is a model's finding about
//     NEWNESS. Nothing here files a fix task (that stays the operator's decision; the record may carry a
//     candidate fix outline from the value assessment) and nothing here writes a Goal.
//   · FAILURES ARE LEARNING MATERIAL TOO (Plan 1b): refuted clusters, novelty duplicates and verifier
//     `undetermined` results all become Experiences, with their own roles and their own reasoning.
//
// ⛔ METHODS GUIDE, THEY DO NOT GATE (task gap-open-discovery-method-guidance-active-shadow). A Discovery
// Method (`.quay/discovery-method-registry.jsonl`) may steer an exploration round as OPTIONAL guidance
// text appended to the investigator prompt — it is never compiled into a rule, never a classifier, and
// never a boundary on what the model may inspect. `selectMethodsForRound` decides ONE thing: which arm a
// method may steer. `active` ⇒ the PRODUCTION round (its guidance is prepended to the prompt);
// `draft`/`trial` ⇒ an ISOLATED SHADOW arm only (one extra investigator pass on the same pin, records
// marked `shadow:true`, ingested into NEITHER ledger); `retired`, a QUARANTINE lineage, or a verdict on
// `.quay/discovery-contaminated-verdicts.jsonl` ⇒ NEVER selected, even when it is the only record. A
// method whose guidance text names a registered seed component or case id is excluded with that value
// named. "No eligible method" ⇒ BASELINE (unguided), never "no round": an unreadable registry, a
// partially-readable one, or an unreadable deny-list are each their OWN reported value, and the round
// still runs. Each round's record lists the ids included and excluded with reasons, whether it ran
// baseline or guided, what the shadow arm did, and each guided method's outcome (net-new / duplicate /
// refuted / nothing found) — the Experience written for a guided cluster names `method_id@vN`, and the
// Portfolio row carries it as `method_ref`, so reflection can evolve or retire a method from production
// evidence (Plan 2b).
//
// KILL SWITCH + OFF BY DEFAULT: declared in `.quay/config.yml` `loop.open_semantic_discovery:`. A// workspace with no such section gets `not-evaluated:disabled` and ZERO spawns. `enabled:false` is the
// same. A malformed section — or a missing key, since EVERY key is required — records `failed` and spawns
// nothing: a bad declaration must never be read as "no findings" (硬规则 3b).
//
// ⛔ WHO INVOKED THE ROUND — the manual/resident split, same as discovery-method. The durable due gate
// reads AND advances the PRODUCTION entry in `.quay/routine-last-run.json`, a SCHEDULING input, so a
// round run BY HAND (the `--once` CLI, a test, an acceptance check) must never be what moves production's
// clock. Every round records `invoked_by` on both its carrier line and its Fact; only
// `resident-driver` (the driver's routine table) advances the entry, and it stamps the entry with its own
// identity in the SAME write. The default is `manual` — a caller that forgets to declare itself cannot
// move production's schedule.
//
// ⛔ THE 24h CEILINGS ARE HARD, PRE-SPAWN RESERVATIONS, one per SUBPROCESS (investigator, verifier,
// refuter, value-assessment). TWO ceilings, checked in this order before every spawn:
//   · COUNT — `max_model_calls_per_24h`, from the reservation ledger's trailing-24h reservations;
//   · USD   — `max_usd_per_24h`, from the SAME ledger's realized gateway cost (`loadGatewayRates` +
//             `deriveCost`). An unknown cost counts as the per-call ceiling estimate, NEVER 0 — a call
//             whose price could not be read must not read as free.
// Either refusal is its OWN token on the Fact (`budget-24h` / `budget-usd-24h`) — never shaped like idle.
//
// ⛔ THE TURN BUDGET OF EVERY SUBPROCESS IS EXPLICIT AND STATED, so the worst case is computable rather
// than unknown: `--max-turns` is on every argv this routine builds. The blind investigator (`--tools ""`,
// kept for the controlled experiments of the P2 task — NOT the production default) is ONE turn, because
// with no tools there is nothing to iterate on.
//
// ⛔ NOT a hot-path gate (the `gap-fan-in-remove-archguard-gate` lesson): nothing here is called by
// fan-in / scoped-gate / any per-task path. The only caller is the quality driver's routine table.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import YAML from "yaml";
import { isDue, parseTrigger } from "./routine-scheduler.ts";
import { launchArgv, type Fact, type RoutineSpec } from "./driver-runtime.ts";
import { ROUTINE_LAST_RUN_REL, readLastRunMap } from "./probe-routine.ts";
import { isDirectEntry } from "./gate-script-base.ts";
// The reservation ledger + the carrier/last-run helpers are the machine discovery-method's budget task
// built and tested. Imported, never re-derived — this routine only supplies its OWN key paths and caps.
import {
  appendCarrierRecords,
  appendLedgerRecords,
  BudgetLockError,
  BudgetRefusedError,
  classifyModelFailure,
  INVOKED_BY_DEFAULT,
  INVOKED_BY_MANUAL,
  INVOKED_BY_RESIDENT,
  isBudgetRefused,
  isResidentStamped,
  latestResidentRoundTs,
  openModelBudget,
  readCarrierRounds,
  readLedgerRecords,
  readRealizedTurns,
  writeLastRunStamped,
  type BudgetUsage,
  type InvokedBy,
  type ModelBudget,
} from "./discovery-method-routine.ts";

// ── identity + carriers ─────────────────────────────────────────────────────────────────────────────
/** The routine's name — one key in `.quay/routine-last-run.json`. ⛔ Names do not collide and the map is
 *  a per-name merge write, so this string is the routine's identity everywhere. */
export const OPEN_SEMANTIC_DISCOVERY_NAME = "open-semantic-discovery";

/** The ONE carrier this routine appends to (scan-round + per-cluster records). Gitignored runtime state,
 *  declared in docs/carrier-registry.json — the same family as arch-discovery-findings.jsonl. */
export const CARRIER_REL = path.posix.join(".quay", "open-semantic-discovery-findings.jsonl");
/** THIS routine's own reservation ledger and lock. ⛔ Its OWN paths: the call ceiling is per-routine and
 *  discovery-method's 240 is not shared silently. */
export const BUDGET_LEDGER_REL = path.posix.join(".quay", "open-semantic-discovery-model-budget.jsonl");
export const BUDGET_LOCK_REL = path.posix.join(".quay", "open-semantic-discovery-model-budget.lock");
/** The PAIRED round's pre-registration: one small JSON file, whose only load-bearing property is its
 *  MTIME — a pre-registration that is not older than the calls it scores is not a pre-registration.
 *  ⛔ It is not a `.jsonl` carrier and does not go through `appendCarrierRecords`: it is a single
 *  OVERWRITTEN declaration per paired round, because a second, later copy of the same declaration is
 *  exactly the thing the mtime rule exists to catch. */
export const PREREG_REL = path.posix.join(".quay", "open-semantic-discovery-prereg.json");

/** sha256 of the EXACT bytes handed to a model or declared in a pre-registration. One definition, so
 *  the digest written into the pre-registration and the digest a reader recomputes cannot diverge. */
export const sha256Of = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

/** Env override for the temp root the stripped pins are materialised under (tests point it at their own
 *  scratch dir so a run cannot litter the shared `/tmp`; production leaves it unset). */
export const PIN_TMP_ENV = "QUAY_OPEN_SEMANTIC_DISCOVERY_PIN_TMP";

// ── cadence ─────────────────────────────────────────────────────────────────────────────────────────
/** The interval floor: a round materialises a whole stripped tree (a full `git archive`), runs at least
 *  one real model call and verifies up to K clusters — a cadence shorter than an hour is refused rather
 *  than silently rounded up. ⛔ PER-ROUTINE: arch-discovery's and discovery-method's own floors are
 *  separate constants in their own files and none of them moves another's. */
export const MIN_INTERVAL_MINUTES = 60;
/** The PERMANENT interval, and the revert target of a temporary window — the same rule discovery-method
 *  uses (`interval_until` is REQUIRED below it, so a faster cadence can only ever be a declared,
 *  expiring window). */
export const DEFAULT_INTERVAL_MINUTES = 360;

/** How often (in ELIGIBLE rounds) the PAIRED baseline-vs-guided instrument runs, when the section does
 *  not declare `gain_every_rounds`. Six is a stated default rather than an invented one: a paired round
 *  doubles the round's model calls, so it must be rare enough that production is not dominated by
 *  measurement — and rare enough that the two arms' pins differ by the width of the interval. */
export const DEFAULT_GAIN_EVERY_ROUNDS = 6;

// ── the model steps' tool and turn envelopes (see the header) ────────────────────────────────────────
/** The INVESTIGATOR's tools. It reads code and context ITSELF, rooted at the pinned tree, instead of
 *  reasoning only over a mechanically pre-digested inventory — that is the whole difference between this
 *  routine and `runInvestigator`'s blind default. */
export const INVESTIGATOR_TOOLS = "Read,Grep,Glob";
/** The investigator's internal turn budget when it HAS tools. It is a stated module constant rather than a
 *  config key because the config's declared keys are the operator's budget surface; this bounds what
 *  happens INSIDE one already-counted call. `investigator_max_turns` in the config overrides it. */
export const DEFAULT_INVESTIGATOR_MAX_TURNS = 12;
/** The blind investigator's turn budget: `--tools ""` ⇒ nothing to iterate on ⇒ ONE turn, exactly as the
 *  discovery-method reflection seam documents its own. Kept because the controlled experiments of the P2
 *  task still want the tool-less mode — as an opt-in, never as this routine's production default. */
export const BLIND_INVESTIGATOR_MAX_TURNS = 1;
/** The VERIFIER's tools (the bounded-verifier discipline: it may read the pinned tree, nothing else). */
export const VERIFIER_TOOLS = "Read,Grep";
/** The REFUTER's tools: the same envelope, a DIFFERENT prompt and a FRESH context. */
export const REFUTER_TOOLS = "Read,Grep";
/** The VALUE-assessor's tools: it states engineering impact from evidence it may re-read. */
export const VALUE_TOOLS = "Read,Grep";
/** The NOVELTY checker's tools: the same read-only envelope. It is a JUDGMENT call like the refuter, not
 *  an exploration — it may re-read the source to settle whether a claim is new, and nothing more. */
export const NOVELTY_TOOLS = "Read,Grep";

/** The stated per-call USD ceiling used when a call's realized gateway cost could not be read. Basis: the
 *  2026-10-12 GAIN1 capability-gain run measured ≈$0.05 for an investigator call and ≈$0.5 for a verifier
 *  cluster at gateway rates; the ceiling is the larger of those rounded up, so an unreadable price is
 *  always counted at or ABOVE its plausible cost (the ceiling fails safe toward refusal). */
export const PER_CALL_USD_CEILING = 1.0;

/** The scope the inventory is built over. It is only the map's scope — the investigator's own tools are
 *  rooted at the whole pinned tree, so a declared scope never narrows what the model may look at. */
export const INVENTORY_SCOPE_REL = path.posix.join("plugin", "scripts");

/** The PROTOCOL MARKER the investigator states its exploration focus with. ⛔ This is not a problem-class
 *  pattern: it selects nothing, rejects nothing and carries no vocabulary of defects. It exists so the
 *  focus the MODEL chose can be persisted and handed to the NEXT round as history (mechanical state), so
 *  later rounds can choose to go elsewhere — the choice stays the model's. */
export const FOCUS_MARKER = "FOCUS:";

/** How many previously-explored focuses are handed back to the model. A bound on the prompt, not a policy:
 *  the model is told these were already explored, and nothing stops it from revisiting one. */
export const FOCUS_HISTORY_MAX = 10;

// ── the post-round ingestion: the novelty check's carriers, bounds and vocabulary ─────────────────────

/** The `record_id` an open-discovery CLUSTER record carries, and the ref the Portfolio resolves it by.
 *  ⛔ `<round ts>#<cluster index>` is unique BY CONSTRUCTION: one scan-round per round, a round takes
 *  minutes, and the index is the cluster's position within it. `discovery-portfolio.mjs` repeats this
 *  prefix as its own constant (it must not import this module — the edge would be a cycle); the routine's
 *  test asserts the two agree by resolving a minted record_id through the real `resolveOriginRef`. */
export const OPEN_DISCOVERY_REF_PREFIX = `${OPEN_SEMANTIC_DISCOVERY_NAME}@`;
export const openDiscoveryRecordId = (roundTs: string, cluster: number): string => `${OPEN_DISCOVERY_REF_PREFIX}${roundTs}#${cluster}`;

/** The other routine carriers the novelty RETRIEVAL looks in. Both are read-only here: this routine owns
 *  neither and appends to neither. */
export const ROUTINE_FINDINGS_CARRIER_REL = path.posix.join(".quay", "routine-findings.jsonl");
export const ARCH_DISCOVERY_CARRIER_REL = path.posix.join(".quay", "arch-discovery-findings.jsonl");

/** The novelty verdict vocabulary. ⛔ THREE values, and `restatement` is not a synonym for `duplicate`:
 *  `duplicate` names ONE retrievable record that states the same claim (so the Portfolio row can carry a
 *  `duplicate_of` that RESOLVES), while `restatement` says the finding is already-known knowledge the
 *  repository records as a decision or a convention rather than as a single row. Collapsing them would
 *  force either an invented `duplicate_of` or a silent "counts as new". */
export const NOVELTY_VERDICTS = ["novel", "duplicate", "restatement"] as const;
export type NoveltyVerdict = (typeof NOVELTY_VERDICTS)[number];

/** The dispositions a cluster's ingestion can end in. Named so "what happened to this cluster" is an
 *  enumerable value on the carrier rather than something a reader infers from which files changed. */
export const NOVELTY_DISPOSITIONS = [
  "mechanical-duplicate", // byte-identical component set + claim to a previous round's own cluster
  "novel",                // the model judged it new ⇒ Experience + Portfolio
  "duplicate",            // the model named a resolvable record ⇒ Experience + Portfolio(duplicate_of)
  "restatement",          // already-known knowledge, no single resolvable row ⇒ Experience only
  "unjudged",             // the model returned nothing usable ⇒ Experience only, NEVER counted as new
] as const;
export type NoveltyDisposition = (typeof NOVELTY_DISPOSITIONS)[number];

/** How many WIDER-context entries (Portfolio claims + task titles) are put in the novelty prompt. A bound
 *  on the prompt, and it is RECORDED (`truncated`) so a reader can tell a bounded context from a complete
 *  one — a silently truncated context would read exactly like "there was nothing else to know". */
export const NOVELTY_BROAD_MAX = 80;
/** How many task candidates have their `## Touches` read back. Each read is one `git show`; the bound is
 *  on the RETRIEVAL, which is assistance only — the wider context above is what keeps a bounded retrieval
 *  from becoming an unstated "nothing matched". */
export const NOVELTY_TASK_CANDIDATE_MAX = 20;

/** The one `git grep` pattern the wider context uses, to pull task TITLES. It is a RETRIEVAL selector over
 *  task frontmatter — it classifies no defect, selects no hypothesis and rejects nothing. The routine's
 *  case-(l) control forbids pattern MACHINERY (constructed regexes, match/test/exec) in this module; this
 *  is a literal passed to `git`, stated here so a reader can see what it does. */
export const TASK_TITLE_GREP_PATTERN = "^title:";

/** The prompt for the ONE bounded novelty call. It states what is mechanical (the candidate list may be
 *  incomplete) and what is not (an empty list is not a verdict), because those are the two ways this call
 *  could be read as doing less than it does. */
export const NOVELTY_PROMPT_TEMPLATE = [
  "You are deciding whether a CONFIRMED finding about this repository is NEW to what is already recorded.",
  "You may Read/Grep the source to settle it. Do not assume; judge from the claim, the components and the",
  "records below.",
  "",
  "⛔ The CANDIDATE list was retrieved MECHANICALLY (same or overlapping components) and may be incomplete.",
  "⛔ An EMPTY candidate list does NOT mean the finding is new — the WIDER CONTEXT is always supplied for",
  "   exactly that reason.",
  "",
  "CONFIRMED FINDING:",
  "{{FINDING}}",
  "",
  "RETRIEVED CANDIDATES (same or overlapping components):",
  "{{CANDIDATES}}",
  "",
  "WIDER CONTEXT (already-recorded claims and task titles):",
  "{{BROAD}}",
  "",
  'Return ONE JSON object: {"verdict":"novel|duplicate|restatement","duplicate_of":"<the ref of the ONE',
  'candidate this duplicates, or null>","reasoning":"why, concretely — what you compared","summary":"one',
  'sentence stating the finding fresh enough to stand alone"}',
  'Use "novel" when no listed record states this claim about these components.',
  'Use "duplicate" ONLY when one listed candidate states the SAME claim about the same components; name it',
  'in duplicate_of by its ref.',
  'Use "restatement" when the finding is already-known knowledge with no single listed record to name.',
].join("\n");

// ── the config section: `.quay/config.yml` `loop.open_semantic_discovery:` ───────────────────────────
// EVERY key is required on an ENABLED section, and a malformed key is a config error (`failed`, zero
// spawns). Why ALL of them: each one is a bound this routine would otherwise have to invent a default for,
// and an invented default is indistinguishable from a stated one on the record (硬规则 3b). The kill
// switch is the exception — `enabled:false` returns before any other key is read, so disabling never
// depends on the rest of the declaration being well-formed.
export interface OpenSemanticDiscoveryConfig {
  enabled: boolean;
  trigger: { kind: string; minutes?: number };
  /** Epoch-ms deadline of a TEMPORARY cadence. `null` = the configured interval is PERMANENT. At/after
   *  this instant the round reverts to `DEFAULT_INTERVAL_MINUTES` and says so in its Fact. */
  intervalUntil: number | null;
  investigatorRuns: number;
  maxClustersVerified: number;
  investigatorMaxTurns: number;
  verifierMaxTurns: number;
  refutationMaxTurns: number;
  maxWallMs: number;
  maxModelCallsPer24h: number;
  maxUsdPer24h: number;
  /** How many ELIGIBLE rounds apart a PAIRED (same-budget baseline vs guided) gain round is run — the
   *  cadence of the instrument that measures whether method guidance helps at all. It is an OPTIONAL
   *  extra key (like `investigator_max_turns`), NOT one of the ten declared keys: a section written
   *  before the paired instrument existed must keep parsing to the stated cadence rather than failing. */
  gainEveryRounds: number;
}

/** `present` = the section exists; `config` = the parsed section (null when malformed); `error` = a
 *  fail-closed reason (a present-but-bad section ⇒ the round is `failed`). */
export interface OpenSemanticDiscoveryConfigRead {
  present: boolean;
  config: OpenSemanticDiscoveryConfig | null;
  error: string | null;
}

const cfgBad = (msg: string) => `loop.open_semantic_discovery ${msg}`;

const DISABLED_DEFAULTS: OpenSemanticDiscoveryConfig = {
  enabled: false,
  trigger: { kind: "interval", minutes: DEFAULT_INTERVAL_MINUTES },
  intervalUntil: null,
  investigatorRuns: 1,
  maxClustersVerified: 3,
  investigatorMaxTurns: DEFAULT_INVESTIGATOR_MAX_TURNS,
  verifierMaxTurns: 8,
  refutationMaxTurns: 6,
  maxWallMs: 1_200_000,
  maxModelCallsPer24h: 120,
  maxUsdPer24h: 30,
  gainEveryRounds: DEFAULT_GAIN_EVERY_ROUNDS,
};

/** Pure parse of ONE `loop.open_semantic_discovery` value. `enabled` is required and boolean; a disabled
 *  section is returned immediately (the kill switch must work even with the other keys absent/bad); an
 *  ENABLED section must carry EVERY other key, each in range. */
export function parseOpenSemanticDiscoverySection(raw: unknown): { config: OpenSemanticDiscoveryConfig | null; error: string | null } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { config: null, error: cfgBad(`must be a mapping (got ${Array.isArray(raw) ? "array" : raw === null ? "null" : typeof raw})`) };
  }
  const rec = raw as Record<string, unknown>;
  if (typeof rec.enabled !== "boolean") {
    return { config: null, error: cfgBad(`needs a boolean 'enabled' (got ${rec.enabled === undefined ? "missing" : JSON.stringify(rec.enabled)})`) };
  }
  if (rec.enabled === false) return { config: { ...DISABLED_DEFAULTS }, error: null };

  if (typeof rec.interval !== "string") {
    return { config: null, error: cfgBad(`needs an 'interval' string of the form interval:<N>m (got ${rec.interval === undefined ? "missing" : JSON.stringify(rec.interval)})`) };
  }
  let trigger: { kind: string; minutes?: number };
  try {
    trigger = parseTrigger(rec.interval);
  } catch (e) {
    return { config: null, error: cfgBad(`invalid 'interval' — ${(e as Error).message}`) };
  }
  if (trigger.kind !== "interval" || typeof trigger.minutes !== "number") {
    return { config: null, error: cfgBad(`'interval' must be interval:<N>m (got kind '${trigger.kind}')`) };
  }
  if (trigger.minutes < MIN_INTERVAL_MINUTES) {
    return { config: null, error: cfgBad(`interval ${trigger.minutes}m is below the ${MIN_INTERVAL_MINUTES}m floor — a round materialises a whole stripped tree and spends real model calls, so it is refused rather than silently rounded`) };
  }

  // The TEMPORARY-cadence rule (the same one discovery-method uses, restated because the two routines'
  // floors and defaults are separate constants): a cadence below the PERMANENT default is temporary BY
  // DECLARATION and must name the instant it expires, so "60m became the standing cadence" is not a state
  // this config can be left in by omission.
  let intervalUntil: number | null = null;
  if (rec.interval_until !== undefined && rec.interval_until !== null) {
    if (typeof rec.interval_until !== "string") {
      return { config: null, error: cfgBad(`'interval_until' must be an ISO-8601 string (got ${JSON.stringify(rec.interval_until)})`) };
    }
    const ms = Date.parse(rec.interval_until);
    if (!Number.isFinite(ms)) {
      return { config: null, error: cfgBad(`'interval_until' is not a parseable instant (got ${JSON.stringify(rec.interval_until)} — expected ISO-8601, e.g. 2026-10-20T12:00:00Z)`) };
    }
    intervalUntil = ms;
  }
  const temporary = trigger.minutes < DEFAULT_INTERVAL_MINUTES;
  if (temporary && intervalUntil === null) {
    return { config: null, error: cfgBad(`interval ${trigger.minutes}m is below the ${DEFAULT_INTERVAL_MINUTES}m default and no 'interval_until' is declared — a sub-${DEFAULT_INTERVAL_MINUTES}m cadence is TEMPORARY by declaration and must not be able to become permanent silently`) };
  }

  const intKey = (key: string, min: number): { value: number | null; error: string | null } => {
    const v = rec[key];
    if (v === undefined || v === null) return { value: null, error: cfgBad(`needs '${key}' (every key is required on an enabled section; got missing)`) };
    if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v) || v < min) {
      return { value: null, error: cfgBad(`'${key}' must be an integer >= ${min} (got ${JSON.stringify(v)})`) };
    }
    return { value: v, error: null };
  };
  const fields: Array<[keyof OpenSemanticDiscoveryConfig & string, number]> = [
    ["investigator_runs", 1],
    ["max_clusters_verified", 1],
    ["verifier_max_turns", 1],
    ["refutation_max_turns", 1],
    ["max_wall_ms", 1],
    ["max_model_calls_per_24h", 0],
  ];
  const parsed: Record<string, number> = {};
  for (const [key, min] of fields) {
    const r = intKey(key, min);
    if (r.error) return { config: null, error: r.error };
    parsed[key] = r.value as number;
  }
  // `investigator_max_turns` is an OPTIONAL EXTRA bound, not one of the declared key set: the operator's
  // budget surface is the nine declared keys, and this one bounds what happens INSIDE an already-counted
  // call. Absent ⇒ the stated default; present ⇒ it must still be a well-formed positive integer.
  const invTurns = rec.investigator_max_turns === undefined || rec.investigator_max_turns === null
    ? { value: DEFAULT_INVESTIGATOR_MAX_TURNS, error: null }
    : intKey("investigator_max_turns", 1);
  if (invTurns.error) return { config: null, error: invTurns.error };
  // `gain_every_rounds` is the SECOND optional extra bound (same rationale: the operator's declared
  // budget surface is the ten required keys, and this one is the paired instrument's cadence). Absent ⇒
  // the stated default; present ⇒ a well-formed integer >= 1. ⛔ `0` is REFUSED rather than read as
  // "never": an omitted key and a `0` would then mean the same thing while only one of them is stated,
  // so "the paired instrument was switched off" could not be told from "nobody declared it".
  const gainEvery = rec.gain_every_rounds === undefined || rec.gain_every_rounds === null
    ? { value: DEFAULT_GAIN_EVERY_ROUNDS, error: null }
    : intKey("gain_every_rounds", 1);
  if (gainEvery.error) return { config: null, error: gainEvery.error };
  // ⛔ `0` is a legitimate value for `max_model_calls_per_24h` (a mechanical-only declaration is coherent)
  // — the gate is integrality and non-negativity, not a made-up positive floor. The USD ceiling is the one
  // bound where 0 would be incoherent (a round that may spend nothing is a round that may never run), so it
  // needs a strictly positive value.
  const usd = rec.max_usd_per_24h;
  if (usd === undefined || usd === null) {
    return { config: null, error: cfgBad(`needs 'max_usd_per_24h' (every key is required on an enabled section; got missing)`) };
  }
  if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0) {
    return { config: null, error: cfgBad(`'max_usd_per_24h' must be a number > 0 (got ${JSON.stringify(usd)})`) };
  }

  return {
    config: {
      enabled: true,
      trigger,
      intervalUntil,
      investigatorRuns: parsed.investigator_runs,
      maxClustersVerified: parsed.max_clusters_verified,
      investigatorMaxTurns: invTurns.value as number,
      verifierMaxTurns: parsed.verifier_max_turns,
      refutationMaxTurns: parsed.refutation_max_turns,
      maxWallMs: parsed.max_wall_ms,
      maxModelCallsPer24h: parsed.max_model_calls_per_24h,
      maxUsdPer24h: usd,
      gainEveryRounds: gainEvery.value as number,
    },
    error: null,
  };
}

/** Read `.quay/config.yml` `loop.open_semantic_discovery:`. No config file / no `loop:` / no section ⇒
 *  `present:false` (off by default). Malformed YAML or a bad section ⇒ `error` set (fail-closed). */
export function readOpenSemanticDiscoveryConfig(workspaceRoot: string): OpenSemanticDiscoveryConfigRead {
  const configPath = path.join(workspaceRoot, ".quay", "config.yml");
  if (!fs.existsSync(configPath)) return { present: false, config: null, error: null };
  let parsed: unknown;
  try {
    parsed = YAML.parse(fs.readFileSync(configPath, "utf8"));
  } catch (e) {
    return { present: true, config: null, error: `FAIL-CLOSED: .quay/config.yml is malformed YAML — ${(e as Error).message}` };
  }
  const loop = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>).loop : undefined;
  if (loop === undefined || loop === null) return { present: false, config: null, error: null };
  if (typeof loop !== "object" || Array.isArray(loop)) {
    return { present: true, config: null, error: "FAIL-CLOSED: .quay/config.yml 'loop:' must be a mapping" };
  }
  const raw = (loop as Record<string, unknown>).open_semantic_discovery;
  if (raw === undefined || raw === null) return { present: false, config: null, error: null };
  const { config, error } = parseOpenSemanticDiscoverySection(raw);
  return { present: true, config, error };
}

// ── the USD half of the 24h budget ───────────────────────────────────────────────────────────────────
/** One reservation's realized price, as the ledger records it (a `cost` line written after the call,
 *  joined to its `reserve` line by `id`). */
export interface LedgerCostLine {
  id: string;
  cost_usd: number | null;
  cost_source: string;
}

/** ⛔ THE USD READING IS `unknown ⇒ ceiling`, NEVER `unknown ⇒ 0`. For every reservation GRANTED in the
 *  trailing window: its own `cost` line's `cost_usd` when that is a finite number, else
 *  `perCallCeiling`. That makes a call whose price could not be read, and a call with NO cost line at all
 *  (killed mid-flight), both count at or above their plausible cost — the direction a CEILING must fail.
 *  `priced` / `estimated` are reported separately so a reader can tell "we knew the price" from "we
 *  guessed high" without re-deriving it (硬规则 3). */
export function usdBudgetUsage(opts: {
  ledgerRecords: readonly Record<string, unknown>[];
  nowMs: number;
  windowMs: number;
  perCallCeiling: number;
}): { usd: number; priced: number; estimated: number; reservations: number; reservation_ids: string[] } {
  const costs = new Map<string, number | null>();
  for (const rec of opts.ledgerRecords) {
    if (rec.kind !== "cost") continue;
    const id = typeof rec.id === "string" ? rec.id : null;
    if (id === null) continue;
    const v = rec.cost_usd;
    costs.set(id, typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  }
  let usd = 0;
  let priced = 0;
  let estimated = 0;
  let reservations = 0;
  const ids: string[] = [];
  for (const rec of opts.ledgerRecords) {
    if (rec.kind !== "reserve") continue;
    const ms = typeof rec.ts === "string" ? Date.parse(rec.ts) : NaN;
    if (!Number.isFinite(ms)) {
      throw new Error(`ledger reservation has no parseable 'ts' (got ${JSON.stringify(rec.ts)}) — the USD budget cannot be established from a partially-readable window`);
    }
    if (!(ms > opts.nowMs - opts.windowMs && ms <= opts.nowMs)) continue;
    reservations++;
    if (typeof rec.id === "string") ids.push(rec.id);
    const realized = typeof rec.id === "string" ? costs.get(rec.id) : undefined;
    if (typeof realized === "number") {
      usd += realized;
      priced++;
    } else {
      usd += opts.perCallCeiling;
      estimated++;
    }
  }
  return { usd: Math.round(usd * 1e6) / 1e6, priced, estimated, reservations, reservation_ids: ids };
}

// ── the pin: a stripped tree at the develop tip ──────────────────────────────────────────────────────
/** A materialised pin, or a refusal naming why. `dir` is the stripped tree the model is rooted at. */
export type PinResult = { ok: true; dir: string } | { ok: false; reason: string };

/** Where the model may NOT find anything: the pin is STRIPPED of the methodology directories before any
 *  step is allowed to run in it, so the model reasons about CODE, not about the project's own notes on
 *  itself. The list is the engine's own `PIN_FORBIDDEN_DIRS` — read from the loaded module, never copied,
 *  so a change there is a change here (硬规则 5b). */
export function materializeStrippedPin(opts: {
  root: string;
  rev: string;
  dir: string;
  forbiddenDirs: readonly string[];
  stripCheck: (dir: string) => string | null;
  exec?: typeof execFileSync;
}): PinResult {
  const exec = opts.exec ?? execFileSync;
  try {
    fs.mkdirSync(opts.dir, { recursive: true });
    const tar = exec("git", ["-C", opts.root, "archive", "--format=tar", opts.rev], { maxBuffer: 1 << 30 });
    exec("tar", ["-x", "-C", opts.dir], { input: tar, maxBuffer: 1 << 26 });
  } catch (e) {
    return { ok: false, reason: `PIN_MATERIALIZE_FAILED:${(e as Error).message}` };
  }
  for (const d of opts.forbiddenDirs) {
    try {
      fs.rmSync(path.join(opts.dir, d), { recursive: true, force: true });
    } catch { /* a directory that is not there needs no stripping */ }
  }
  // ⛔ The strip is CHECKED by position, not asserted: `verifyCwdRefusal` enumerates the forbidden
  // directories and their presence is its own refusal, naming which ones. A pin that silently still
  // carried `docs/` would make every downstream reading a reading of the wrong tree.
  const refusal = opts.stripCheck(opts.dir);
  if (refusal) return { ok: false, reason: `PIN_NOT_STRIPPED:${refusal}` };
  return { ok: true, dir: opts.dir };
}

// ── argv + the spawn wrapper (the tool-wrapper mechanical piece the DoD allows) ───────────────────────
/** The argv for ONE model step. Every argv carries `--max-turns`: an unbounded subprocess is not a shape
 *  this routine can produce. A tool-less step is ONE turn — with no tools there is nothing to iterate on,
 *  and saying so here is what makes the 24h worst case a computable number rather than a hope. */
export function stepArgv(
  buildArgv: (prompt: string, root: string, opts: { tools: string; maxTurns: number | null; outputFormat: string | null; model: string | null }) => string[],
  prompt: string,
  root: string,
  opts: { tools: string; maxTurns: number | null; model: string | null },
): { argv: string[]; tools: string; maxTurns: number } {
  const maxTurns = opts.tools === "" ? BLIND_INVESTIGATOR_MAX_TURNS : (opts.maxTurns ?? BLIND_INVESTIGATOR_MAX_TURNS);
  return {
    argv: buildArgv(prompt, root, { tools: opts.tools, maxTurns, outputFormat: "stream-json", model: opts.model }),
    tools: opts.tools,
    maxTurns,
  };
}

/** The spawn primitive this routine drives every model subprocess with. It exists because the model must
 *  be ROOTED AT THE PIN, and the shared `runAsync` primitive has no `cwd` option: without it the child
 *  would inherit the driver's own cwd — the main checkout — and read an UNSTRIPPED tree. Timeout semantics
 *  mirror `runAsync` (finite ⇒ SIGKILL; every failure is returned, never thrown). */
export function spawnModelCall(
  argv: string[],
  opts: { cwd: string; timeoutMs: number; stdinData?: string },
): Promise<{ status: number | null; stdout: string; stderr: string; error: Error | null }> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(argv[0], argv.slice(1), {
        cwd: opts.cwd,
        stdio: [opts.stdinData === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      });
    } catch (e) {
      resolve({ status: null, stdout: "", stderr: "", error: e as Error });
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (status: number | null, error: Error | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ status, stdout, stderr, error });
    };
    if (Number.isFinite(opts.timeoutMs)) {
      timer = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* already gone */ }
        finish(null, new Error(`spawn timeout after ${opts.timeoutMs}ms (SIGKILL): ${argv[0]}`));
      }, opts.timeoutMs);
    }
    if (opts.stdinData !== undefined && child.stdin) {
      child.stdin.on("error", () => { /* the child's own exit decides the outcome */ });
      child.stdin.end(opts.stdinData);
    }
    child.stdout?.on("data", (d) => { stdout += d; });
    child.stderr?.on("data", (d) => { stderr += d; });
    child.on("error", (e) => finish(null, e));
    child.on("close", (code) => finish(code, null));
  });
}

// ── the engine modules: resolved from DISK at runtime, never statically imported (see the header) ────
export const HYPOTHESIS_MODULE_FILE = "arch-hypothesis-generation.mjs";
export const PORTFOLIO_MODULE_FILE = "discovery-portfolio.mjs";
export const LEDGER_MODULE_FILE = "discovery-experience-ledger.mjs";
/** The Discovery Method registry — the reader a round consults to decide whether a METHOD may guide it
 *  (task gap-open-discovery-method-guidance-active-shadow). Loaded from disk like its siblings. */
export const REGISTRY_MODULE_FILE = "discovery-method-registry.mjs";
export const ANALYSIS_DIR_REL = path.posix.join("docs", "analysis");

/** The repo this FILE lives in (…/plugin/scripts/<this> → repo root). Used only to BUILD a candidate
 *  path — nothing is resolved through it until the runtime `import()`. */
export const SCRIPT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The narrow interface this file consumes from arch-hypothesis-generation.mjs. Declared here rather than
 *  reached through a type-position import of an out-of-artifact path (the same reason the loader exists). */
export interface HypothesisModule {
  PIN_FORBIDDEN_DIRS: readonly string[];
  HARD_MAX_CLUSTERS: number;
  DEFAULT_EVIDENCE_MAX_LINES: number;
  hardenedArgv: (launch: unknown, prompt: string, root: string, opts?: Record<string, unknown>) => string[];
  verifyCwdRefusal: (cwd: string, pinDir: string) => string | null;
  clusterHypotheses: (runs: readonly Record<string, unknown>[], opts?: Record<string, unknown>) => Array<Record<string, unknown>>;
  runInvestigator: (opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
  runVerifier: (opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
  buildInventory: (opts: Record<string, unknown>) => Record<string, unknown>;
  parseJsonObject: (stdout: string) => Record<string, unknown> | null;
  /** The engine's OWN pre-registration gate. Consumed, never re-derived: the "older than every run"
   *  mtime rule and the hash vocabulary are declared once, in `arch-hypothesis-generation.mjs`. */
  preregRefusal: (o: {
    prereg: Record<string, unknown> | null; expected: Record<string, string>;
    preregMtimeMs: number | null; runMtimesMs: number[];
  }) => { code: number; reasons: string[] } | null;
  parseVerifierStream: (stdout: string) => { ok?: boolean; num_turns?: unknown; model?: unknown; usage?: unknown; cost_usd?: unknown };
  callText: (stdout: string) => string;
  defaultVerifierPrompt: (here?: string) => string;
  defaultInvestigatorPrompt: (here?: string) => string;
  TOOL: string;
}
/** The narrow interface this file consumes from discovery-portfolio.mjs. The first two members are the
 *  gateway cost path (pre-existing); the rest are the post-round ingestion's RETRIEVAL and WRITE surface.
 *  ⛔ The portfolio module's HUMAN-ONLY rating verb is deliberately ABSENT from this interface: what this
 *  routine may reach is a compile-time fact, not a comment, and the case-(i) static control names the
 *  absent symbol so that mentioning it here — even in prose — would be caught. */
export interface PortfolioModule {
  loadGatewayRates: (opts: Record<string, unknown>) => { ok: boolean; rates?: Record<string, unknown>; reason?: string };
  deriveCost: (usage: unknown, rates: unknown) => { ok: boolean; cost?: Record<string, unknown>; reason?: string };
  PORTFOLIO_REL: string;
  normalizeComponents: (xs: unknown) => string[];
  sameComponentSet: (a: unknown, b: unknown) => boolean;
  normalizeClaim: (s: unknown) => string;
  findDuplicate: (earlier: unknown, q: { components: unknown; claim: unknown }) => Record<string, unknown> | null;
  readPortfolio: (root: string, opts?: Record<string, unknown>) => {
    ok: boolean; records: Record<string, unknown>[]; file: string | null; reason?: string;
  };
  taskTouchesOnBranch: (root: string, taskId: string, opts?: Record<string, unknown>) => string[];
  ingestFinding: (root: string, input: Record<string, unknown>, opts?: Record<string, unknown>) => {
    ok: boolean; id?: string | null; appended?: boolean; reasons?: string[];
  };
  /** The portfolio module's own TRUST judgment for a method record (status vocabulary + the
   *  contaminated-verdict ledger). Reused, never re-derived — a second classifier here would be a second
   *  definition of "may this method be applied" to keep in step (硬规则 5b). */
  methodTrust: (rec: Record<string, unknown>, opts?: { contaminatedVerdictIds?: string[] | null }) => {
    method_id: string | null;
    version: number | null;
    status: string | null;
    verdict_ref: string | null;
    contaminated: boolean;
    contributes: boolean;
    why: string;
  };
}

/** The ledger's own deny-list value (`experienceDenyList`). Declared structurally so this file does not
 *  reach through a type-position import of an out-of-artifact path. */
export interface ExperienceDenyList {
  ok: boolean;
  evaluated: number;
  components: string[];
  case_ids: string[];
  malformed_lines: number;
  file: string | null;
  reason?: string;
}

/** The narrow interface this file consumes from discovery-experience-ledger.mjs. `carrierFile` is the
 *  SHARED-checkout resolver the ledger module owns — reused rather than re-derived (硬规则 5b), so a
 *  worktree round reads the same carrier the ledgers are written to. */
export interface LedgerModule {
  EXPERIENCE_LEDGER_REL: string;
  carrierFile: (root: string, rel: string) => string | null;
  clusterVerdict: (rec: unknown) => "supported" | "refuted" | "undetermined" | null;
  clusterCaseId: (recordId: unknown) => string;
  ingestExperience: (root: string, args: Record<string, unknown>) => {
    ok: boolean; id?: string | null; appended?: boolean; reasons?: string[];
  };
  /** The UNION deny-list over every registered Experience case (components' basenames + case_ids) — the
   *  ledger module's own matcher, consumed here rather than re-implemented (硬规则 5b). The guidance text
   *  a round would hand the model is scanned with it BEFORE the method is selected. */
  experienceDenyList: (root: string, opts?: { scanText?: string }) => ExperienceDenyList;
  scanExperienceLeak: (denyList: unknown, text: string) => { flagged: boolean; matches: { kind: string; value: string | null }[] };
}

/** The narrow interface this file consumes from discovery-method-registry.mjs. The registry owns the
 *  version semantics (latest-per-`method_id`), the quarantine lineage walk and the guidance text; this
 *  routine only applies the selection POLICY (which statuses may guide which arm). */
export interface RegistryModule {
  readMethodRegistry: (root: string, opts?: { history?: boolean }) => {
    ok: boolean; latest: Record<string, unknown>[]; history: Record<string, unknown>[] | null;
    malformed_lines: number; file: string | null; reason?: string;
  };
  activeMethods: (root: string) => {
    ok: boolean; methods: Record<string, unknown>[]; trials: Record<string, unknown>[];
    evaluated: number; malformed_lines: number; file: string | null;
    excluded_contaminated: { method_id: string; version: number | null; verdict_ref: string | null; reason: string }[] | null;
    contaminated_verdicts_evaluated: number | null; reason?: string;
  };
  quarantinedLineageOf: (rec: Record<string, unknown>, existing?: readonly Record<string, unknown>[]) => {
    quarantined: boolean; versions: (number | null)[]; reasons: string[];
  };
  contaminatedVerdictIds: (root: string) => { ok: boolean; ids: string[]; reason?: string; file?: string | null };
  methodGuidanceText: (rec: Record<string, unknown>) => string;
}
export interface OpenDiscoveryModules {
  hyp: HypothesisModule;
  portfolio: PortfolioModule;
  ledger: LedgerModule;
  registry: RegistryModule;
}

const _engineModuleCache = new Map<string, unknown>();

/** Resolve one engine module to an absolute path, returning the candidates it TRIED so a refusal can name
 *  them (an unresolvable engine is a `failed` round, not a silent zero). */
export function resolveEngineModule(root: string, file: string): { path: string | null; tried: string[] } {
  const tried = [
    path.join(SCRIPT_REPO_ROOT, ANALYSIS_DIR_REL, file),
    path.join(root, ANALYSIS_DIR_REL, file),
  ];
  for (const candidate of tried) {
    if (fs.existsSync(candidate)) return { path: candidate, tried };
  }
  return { path: null, tried };
}

/** Load the engine modules, or THROW a refusal naming every module that could not be resolved and the
 *  candidate paths tried. Throwing (rather than returning a `{ok:false}` a caller might forget to check) is
 *  deliberate: the round converts it into its own `failed` reason. */
export async function loadOpenDiscoveryModules(root: string): Promise<OpenDiscoveryModules> {
  const unresolved: string[] = [];
  const load = async (file: string): Promise<unknown> => {
    const r = resolveEngineModule(root, file);
    if (r.path === null) {
      unresolved.push(`${file} — not found at ${r.tried.join(" or ")}`);
      return null;
    }
    const cached = _engineModuleCache.get(r.path);
    if (cached !== undefined) return cached;
    try {
      const mod = (await import(/* @vite-ignore */ pathToFileURL(r.path).href)) as unknown;
      _engineModuleCache.set(r.path, mod);
      return mod;
    } catch (e) {
      unresolved.push(`${file} — import failed: ${(e as Error).message}`);
      return null;
    }
  };
  const hyp = await load(HYPOTHESIS_MODULE_FILE);
  const portfolio = await load(PORTFOLIO_MODULE_FILE);
  const ledger = await load(LEDGER_MODULE_FILE);
  const registry = await load(REGISTRY_MODULE_FILE);
  if (unresolved.length > 0 || hyp === null || portfolio === null || ledger === null || registry === null) {
    throw new Error(`OPEN_DISCOVERY_MODULES_UNRESOLVED — ${unresolved.join("; ") || "one or more engine modules did not load"}`);
  }
  return {
    hyp: hyp as HypothesisModule,
    portfolio: portfolio as PortfolioModule,
    ledger: ledger as LedgerModule,
    registry: registry as RegistryModule,
  };
}

// ── prompts (the routine's OWN composition; the frozen engine prompts stay byte-identical) ───────────
/** The directive PREPENDED to the frozen investigator prompt. It is what turns the blind investigator into
 *  a source-reading one, and what carries the focus history back to the model. */
export function focusDirective(priorFocuses: readonly string[]): string {
  const history = priorFocuses.length === 0
    ? "No exploration focus has been recorded by an earlier round yet."
    : `Earlier rounds chose these focuses (mechanical history, so you can choose to go ELSEWHERE — nothing forbids revisiting one):\n${priorFocuses.map((f) => `  - ${f}`).join("\n")}`;
  return [
    "You are exploring a PINNED, STRIPPED copy of this repository. Use Read/Grep/Glob to read real source",
    "and context yourself; do not reason from a summary. Directories holding the project's own notes about",
    "itself are not present in the tree.",
    "",
    `FIRST, state your exploration focus on its own line, exactly as: \`${FOCUS_MARKER} <one sentence>\`.`,
    "The focus is YOUR choice. Then return the hypothesis JSON array as instructed below.",
    "",
    history,
    "",
    "---",
    "",
  ].join("\n");
}

/** The OPTIONAL-GUIDANCE block a round appends when at least one Discovery Method is selected for that
 *  arm. ⛔ The wording is load-bearing: a method is guidance for the MODEL, never a rule compiled into
 *  the code, and never a boundary on what may be inspected (Plan: "a method is guidance text for the
 *  model, never compiled into a rule"). It returns `""` when nothing was selected, so a baseline round's
 *  prompt is byte-for-byte the prompt this routine produced before methods existed. */
export function methodDirective(picks: readonly MethodIncluded[], texts: readonly string[]): string {
  if (picks.length === 0) return "";
  const blocks = picks.map((m, i) => `--- guidance ${i + 1}: ${methodLabel(m)} ---\n${texts[i] ?? ""}`);
  return [
    "OPTIONAL GUIDANCE — a Discovery Method recorded by an earlier round is quoted below. It is a way of",
    "looking that you MAY use. It is NOT a rule, NOT a checklist, and NOT a boundary on what you may",
    "inspect: you are free to explore anything in this tree and to disregard this guidance entirely.",
    "",
    ...blocks,
    "",
    "---",
    "",
  ].join("\n");
}

/** `method_id@vN` — the ONE spelling of a method reference, used by the prompt header, the carrier
 *  record and the Experience attribution so the three can be compared by eye. */
export function methodLabel(m: { method_id: string; version: number | null }): string {
  return `${m.method_id}@${m.version === null ? "v?" : `v${m.version}`}`;
}

/** The REFUTATION prompt. Its ONLY input is the cluster's claim and components — it never sees the first
 *  verifier's reasoning, which is the whole point of a fresh-context independent refutation. */
export const REFUTATION_PROMPT_TEMPLATE = [
  "You are an INDEPENDENT REFUTER. Another agent claimed the following about this repository.",
  "Your ONLY job is to REFUTE it from the code. Read the source with Read/Grep before answering.",
  "You have not seen the other agent's reasoning and must not assume it.",
  "",
  "CLAIM + COMPONENTS:",
  "{{HYP}}",
  "",
  'Return ONE JSON object: {"verdict":"supported|refuted|undetermined","intentional_difference_found":"',
  'the specific counterexample you found, or null","evidence":["file:line — what it shows"],',
  '"counterexample":"what would have to be true for the claim to hold","summary":"one sentence"}',
  'Use "refuted" when you FOUND a concrete counterexample in the code; "supported" ONLY when you tried and',
  'could not; "undetermined" when the code does not settle it.',
].join("\n");

/** The VALUE-ASSESSMENT prompt. Bounded: it states engineering impact, the evidence, and a candidate fix
 *  outline — and it is recorded as the MODEL's assessment, never as a human rating. The JSON keys are the
 *  ones the shared verifier row already parses, so no second parser is invented (the mapping is documented
 *  at the call site). */
export const VALUE_PROMPT_TEMPLATE = [
  "You are assessing the ENGINEERING VALUE of a CONFIRMED finding about this repository.",
  "Read whatever source you need with Read/Grep. State impact, evidence and a candidate fix outline.",
  "",
  "CONFIRMED FINDING:",
  "{{HYP}}",
  "",
  'Return ONE JSON object: {"intentional_difference_found":"the engineering impact, concretely",',
  '"evidence":["file:line — what it shows"],"counterexample":"a candidate fix outline, or null",',
  '"summary":"one sentence a maintainer can act on"}',
].join("\n");

// ── the post-round ingestion: RETRIEVAL (mechanical) then one JUDGMENT call ───────────────────────────
//
// ⛔ WHAT IS MECHANICAL HERE, AND WHAT IS NOT. Everything in `retrieveNoveltyCandidates` RETRIEVES: it
// gathers records that mention the same or an overlapping component and hands them, plus a wider context,
// to the model. It labels nothing, ranks nothing and rejects nothing — the one verdict in this file comes
// back from the model in `runNoveltyCheck`. The single mechanical LABEL is the byte-identical-repeat
// exception, which is stated as such and is only ever about this routine's own earlier record.

/** One retrieved record the novelty call may compare the cluster against. */
export interface NoveltyCandidate {
  /** The carrier it was read from (repo-relative), so the model — and a reviewer — can tell a Portfolio
   *  row from a task file. */
  carrier: string;
  /** Its own id within that carrier. For a Portfolio row this is the `finding_id`, which is what makes it
   *  usable as a `duplicate_of` target. */
  ref: string;
  claim: string | null;
  components: string[];
  /** HOW it was retrieved — "same-component-set" / "touches-overlap" / … — so an empty candidate list can
   *  be decomposed into what was actually looked for (硬规则 3). */
  basis: string;
  /** `true` when `ref` resolves as a `duplicate_of` target on the write path (a Portfolio finding id, or a
   *  task id that exists on the landing branch). A candidate that does NOT resolve may still be context,
   *  but the model must not be able to make the write path refuse by naming it. */
  duplicate_target: boolean;
}

export interface NoveltyRetrieval {
  /** Candidates sharing at least one component with the cluster. */
  candidates: NoveltyCandidate[];
  /** The wider context, ALWAYS supplied (Portfolio claims and task titles). It is what keeps "no
   *  mechanical candidate" from being read as "no existing knowledge". */
  broad: NoveltyCandidate[];
  /** Per-source retrieval counts — an empty list is decomposed rather than reported bare. */
  totals: Record<string, number>;
  /** Sources that are simply NOT THERE. A carrier this workspace has never written holds zero records —
   *  that is a real zero, and it is listed here so it stays distinguishable from a carrier that HAD rows
   *  and matched none (硬规则 3). */
  absent: string[];
  /** A source that could not be READ (unreadable / partial / no shared checkout) is NAMED here. It is
   *  never quietly counted as zero matches. */
  errors: string[];
  /** `true` when the wider context hit its bound, so a reader can tell a bounded list from a complete one. */
  broad_truncated: boolean;
}

const jsonlLines = (text: string): { records: Record<string, unknown>[]; malformed: number } => {
  const records: Record<string, unknown>[] = [];
  let malformed = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as unknown;
      if (rec && typeof rec === "object" && !Array.isArray(rec)) records.push(rec as Record<string, unknown>);
      else malformed++;
    } catch { malformed++; }
  }
  return { records, malformed };
};

/** Read one JSONL carrier at the SHARED checkout. `absent` and `reason` are DIFFERENT answers: a carrier
 *  that is not there holds zero records (a real zero), while one that cannot be read is a failure to look
 *  and must never be shaped like the first (硬规则 3b). */
const readCarrierAt = (ledger: LedgerModule, root: string, rel: string): { records: Record<string, unknown>[]; absent: boolean; reason: string | null } => {
  const file = ledger.carrierFile(root, rel);
  if (file === null) return { records: [], absent: false, reason: `SHARED_CHECKOUT_UNRESOLVED:${rel}` };
  if (!fs.existsSync(file)) return { records: [], absent: true, reason: null };
  try {
    const parsed = jsonlLines(fs.readFileSync(file, "utf8"));
    if (parsed.malformed > 0) return { records: parsed.records, absent: false, reason: `CARRIER_PARTIAL:${rel}:${parsed.malformed}-unparseable` };
    return { records: parsed.records, absent: false, reason: null };
  } catch (e) {
    return { records: [], absent: false, reason: `CARRIER_UNREADABLE:${rel}:${(e as Error)?.code ?? (e as Error)?.message}` };
  }
};

/** `git grep -l -F -e <p>… <branch> -- <pathspec>` → the matching paths, or `null` when git could not be
 *  run / the ref does not exist. `null` and `[]` are DIFFERENT answers: a branch that cannot be read is a
 *  retrieval error, while a branch with no match is a real zero. */
export function gitGrepPaths(root: string, patterns: readonly string[], ref: string, pathspec: string): string[] | null {
  if (patterns.length === 0) return [];
  const args = ["-C", root, "grep", "-l", "-F"];
  for (const p of patterns) args.push("-e", p);
  args.push(ref, "--", pathspec);
  try {
    const r = execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 26 });
    return String(r).split("\n").map((l) => l.trim()).filter((l) => l !== "");
  } catch (e) {
    // exit 1 is git grep's own "no match" — a real zero. Anything else is a failure to look.
    const status = (e as { status?: number }).status;
    if (status === 1) return [];
    return null;
  }
}

/** The task id a `git grep` output line names, or `null` when it is not a `tasks/<id>.md` line. Pure.
 *  ⛔ It accepts BOTH shapes git grep produces — `-l`'s `<rev>:<path>` and `-n`'s `<rev>:<path>:<line>:<text>`
 *  — by cutting at the `.md` rather than requiring the line to END there. A parser that only accepted the
 *  first shape would silently return zero task candidates for the title arm, which reads exactly like
 *  "no task mentions this" (硬规则 3b). */
export function taskIdFromPath(p: string): string | null {
  const s = String(p ?? "");
  const marker = "tasks/";
  const at = s.indexOf(marker);
  if (at < 0) return null;
  const rest = s.slice(at + marker.length);
  const mdAt = rest.indexOf(".md");
  if (mdAt <= 0) return null;
  const id = rest.slice(0, mdAt);
  return id.includes("/") ? null : id;
}

/** The components an arch-discovery `subject_key` names. Pure. A key is `<class>:<name>|<path>#<line>`
 *  (or `<class>#<hash>`); both forms are read by string position, never by a pattern. */
export function componentsFromSubjectKey(subjectKey: string): string[] {
  const s = String(subjectKey ?? "");
  if (s === "") return [];
  const pipe = s.indexOf("|");
  const head = pipe >= 0 ? s.slice(pipe + 1) : (s.indexOf(":") >= 0 ? s.slice(s.indexOf(":") + 1) : s);
  return head.split("|").map((part) => {
    const hash = part.indexOf("#");
    return (hash >= 0 ? part.slice(0, hash) : part).trim();
  }).filter((x) => x !== "");
}

/**
 * RETRIEVE the records a confirmed cluster may duplicate. PURE apart from the carriers it reads.
 *
 * ⛔ It returns CANDIDATES, never a verdict. A caller must not read an empty `candidates` as "novel" — the
 * `broad` list exists precisely so that reading is unavailable, and the model call happens either way.
 */
export function retrieveNoveltyCandidates(root: string, opts: {
  components: readonly string[];
  claim: string;
  portfolio: PortfolioModule;
  ledger: LedgerModule;
  branch?: string;
  gitGrep?: (patterns: readonly string[], ref: string, pathspec: string) => string[] | null;
}): NoveltyRetrieval {
  const p = opts.portfolio;
  const branch = opts.branch ?? "develop";
  const components = p.normalizeComponents([...opts.components]);
  const wanted = new Set(components);
  const candidates: NoveltyCandidate[] = [];
  const broad: NoveltyCandidate[] = [];
  const totals: Record<string, number> = {};
  const absent: string[] = [];
  const errors: string[] = [];

  const overlaps = (xs: unknown): boolean => p.normalizeComponents(xs).some((c) => wanted.has(c));
  const push = (into: NoveltyCandidate[], c: NoveltyCandidate): void => {
    if (!into.some((x) => x.carrier === c.carrier && x.ref === c.ref)) into.push(c);
  };

  // (1) the Portfolio — the ONLY source whose refs double as `duplicate_of` targets.
  const pf = p.readPortfolio(root);
  totals.portfolio = pf.ok ? pf.records.length : 0;
  if (!pf.ok || pf.file === null) errors.push(`portfolio:${pf.reason ?? "unreadable"}`);
  for (const r of pf.records) {
    const ref = typeof r.finding_id === "string" ? r.finding_id : "";
    if (ref === "") continue;
    const entry: NoveltyCandidate = {
      carrier: p.PORTFOLIO_REL,
      ref,
      claim: typeof r.claim === "string" ? r.claim : null,
      components: p.normalizeComponents(r.components),
      basis: p.sameComponentSet(r.components, components) ? "same-component-set" : "overlapping-components",
      duplicate_target: true,
    };
    if (overlaps(r.components)) push(candidates, entry);
    else push(broad, { ...entry, basis: "portfolio-claim" });
  }

  // (2) `.quay/routine-findings.jsonl` — the routines' own findings carrier.
  const rf = readCarrierAt(opts.ledger, root, ROUTINE_FINDINGS_CARRIER_REL);
  totals.routine_findings = rf.records.length;
  if (rf.absent) absent.push(ROUTINE_FINDINGS_CARRIER_REL);
  if (rf.reason !== null) errors.push(rf.reason);
  for (const r of rf.records) {
    const files = Array.isArray(r.files) ? r.files : (Array.isArray(r.components) ? r.components : []);
    if (!overlaps(files)) continue;
    const runId = typeof r.runId === "string" ? r.runId : "";
    const findingId = typeof r.findingId === "string" ? r.findingId : "";
    const ref = runId === "" ? "" : (findingId === "" ? runId : `${runId}#${findingId}`);
    if (ref === "") continue;
    push(candidates, {
      carrier: ROUTINE_FINDINGS_CARRIER_REL, ref, claim: null,
      components: p.normalizeComponents(files), basis: "overlapping-components", duplicate_target: false,
    });
  }

  // (3) `.quay/arch-discovery-findings.jsonl` — the mechanical scanner's subject keys.
  const ad = readCarrierAt(opts.ledger, root, ARCH_DISCOVERY_CARRIER_REL);
  totals.arch_discovery = ad.records.length;
  if (ad.absent) absent.push(ARCH_DISCOVERY_CARRIER_REL);
  if (ad.reason !== null) errors.push(ad.reason);
  for (const r of ad.records) {
    if (r.kind !== "finding" || typeof r.subject_key !== "string") continue;
    const comps = componentsFromSubjectKey(r.subject_key);
    if (!overlaps(comps)) continue;
    push(candidates, {
      carrier: ARCH_DISCOVERY_CARRIER_REL, ref: r.subject_key, claim: null,
      components: p.normalizeComponents(comps), basis: "subject-key-components", duplicate_target: false,
    });
  }

  // (4) task Touches on the landing branch — "a done or open task naming the same components".
  const grep = opts.gitGrep ?? ((pats: readonly string[], ref: string, pathspec: string) => gitGrepPaths(root, pats, ref, pathspec));
  const taskPaths = components.length === 0 ? [] : grep(components, branch, "tasks/");
  if (taskPaths === null) errors.push(`tasks:git-grep-could-not-be-run-for-${branch}`);
  const taskIds: string[] = [];
  for (const path of taskPaths ?? []) {
    const id = taskIdFromPath(path);
    if (id !== null && !taskIds.includes(id)) taskIds.push(id);
  }
  totals.task_paths_matching_components = taskIds.length;
  const considered = taskIds.slice(0, NOVELTY_TASK_CANDIDATE_MAX);
  let touches_overlap = 0;
  for (const id of considered) {
    const touches = p.taskTouchesOnBranch(root, id, { branch });
    if (!overlaps(touches)) continue;
    touches_overlap++;
    // `duplicate_target: true` is DERIVED, not asserted: a non-empty Touches list means `git show
    // <branch>:tasks/<id>.md` succeeded, which is exactly what makes the id resolvable on the write path.
    // (Re-asking would be a second `git` spawn per candidate to learn what this one already proved.)
    push(candidates, {
      carrier: `tasks/${id}.md`, ref: id, claim: null,
      components: p.normalizeComponents(touches), basis: "touches-overlap", duplicate_target: touches.length > 0,
    });
  }
  totals.touches_overlap = touches_overlap;
  totals.task_candidates_considered = considered.length;

  // (5) the WIDER context: every task title on the landing branch. One `git grep`, bounded on the prompt.
  //     ⛔ The READ back of each candidate's `## Touches` above is bounded (one `git show` each); this arm
  //     spawns nothing per row, so the wider context stays complete up to the prompt bound instead of
  //     becoming a second, silent cap.
  const titlePaths = grep([TASK_TITLE_GREP_PATTERN], branch, "tasks/");
  if (titlePaths === null) errors.push(`task-titles:git-grep-could-not-be-run-for-${branch}`);
  for (const line of titlePaths ?? []) {
    const id = taskIdFromPath(line);
    if (id === null) continue;
    const mdAt = line.indexOf(".md");
    const colon = line.indexOf(TASK_TITLE_GREP_PATTERN, mdAt < 0 ? 0 : mdAt);
    const title = colon >= 0 ? line.slice(colon + TASK_TITLE_GREP_PATTERN.length).trim() : "";
    // Existence is established by the grep itself (it matched a file ON that branch), so no second spawn.
    push(broad, {
      carrier: `tasks/${id}.md`, ref: id, claim: title === "" ? null : title, components: [],
      basis: "task-title", duplicate_target: true,
    });
  }

  const broadTruncated = broad.length > NOVELTY_BROAD_MAX;
  return {
    candidates, broad: broad.slice(0, NOVELTY_BROAD_MAX), totals, absent,
    errors, broad_truncated: broadTruncated,
  };
}

/** One cluster's novelty outcome — every field is what the record itself decided or the model returned. */
export interface NoveltyOutcome {
  cluster: number;
  record_id: string;
  disposition: NoveltyDisposition;
  verdict: NoveltyVerdict | null;
  duplicate_of: string | null;
  reasoning: string | null;
  summary: string | null;
  retrieved: number;
  broad: number;
  retrieval: { totals: Record<string, number>; absent: string[]; errors: string[]; broad_truncated: boolean; mechanical_duplicate_of: string | null };
  calls: number;
  cost_usd: number | null;
}

/** The prompt for the ONE novelty call. PURE. `truncated` is STATED to the model, not hidden. */
export function buildNoveltyPrompt(payload: {
  claim: string; components: string[]; evidence: string[];
  candidates: NoveltyCandidate[]; broad: NoveltyCandidate[]; broadTruncated: boolean;
}): string {
  const finding = JSON.stringify({ claim: payload.claim, components: payload.components, evidence: payload.evidence }, null, 2);
  const candidatesText = payload.candidates.length === 0
    ? "(none retrieved — this does NOT mean the finding is new; judge against the wider context below)"
    : JSON.stringify(payload.candidates, null, 2);
  const broadText = payload.broad.length === 0
    ? "(no already-recorded claims or task titles were retrieved)"
    : `${JSON.stringify(payload.broad, null, 2)}${payload.broadTruncated ? "\n(TRUNCATED at the declared bound — there are more, this list is not complete)" : ""}`;
  return NOVELTY_PROMPT_TEMPLATE
    .split("{{FINDING}}").join(finding)
    .split("{{CANDIDATES}}").join(candidatesText)
    .split("{{BROAD}}").join(broadText);
}

/** Read the model's novelty JSON out of its final text. `null` when there is nothing usable — and `null`
 *  is NOT `novel`: an unreadable answer leaves the cluster `unjudged`, which writes no Portfolio row. */
export function parseNoveltyVerdict(rec: Record<string, unknown> | null): { verdict: NoveltyVerdict; duplicate_of: string | null; reasoning: string | null; summary: string | null } | null {
  if (!rec || typeof rec !== "object") return null;
  const raw = typeof rec.verdict === "string" ? rec.verdict.trim() : "";
  const verdict = (NOVELTY_VERDICTS as readonly string[]).find((v) => v === raw);
  if (verdict === undefined) return null;
  const dup = typeof rec.duplicate_of === "string" && rec.duplicate_of.trim() !== "" ? rec.duplicate_of.trim() : null;
  const reasoning = typeof rec.reasoning === "string" && rec.reasoning.trim() !== "" ? rec.reasoning.trim() : null;
  const summary = typeof rec.summary === "string" && rec.summary.trim() !== "" ? rec.summary.trim() : null;
  return { verdict: verdict as NoveltyVerdict, duplicate_of: dup, reasoning, summary };
}

/** The byte-identical-repeat exception: an EARLIER cluster record on THIS routine's own carrier with the
 *  same component set AND the same claim. Returns that record, or `null`. ⛔ This is the ONE mechanical
 *  LABEL in the file, and it is only ever about this routine's own earlier round — never about another
 *  carrier's content. */
export function findMechanicalRepeat(
  priorClusters: readonly Record<string, unknown>[],
  opts: { components: readonly string[]; claim: string; recordId: string; portfolio: PortfolioModule },
): Record<string, unknown> | null {
  for (let i = priorClusters.length - 1; i >= 0; i--) {
    const r = priorClusters[i];
    if (typeof r.record_id !== "string" || r.record_id === opts.recordId) continue;
    if (typeof r.claim !== "string") continue;
    if (!opts.portfolio.sameComponentSet(r.components, opts.components)) continue;
    if (opts.portfolio.normalizeClaim(r.claim) !== opts.portfolio.normalizeClaim(opts.claim)) continue;
    return r;
  }
  return null;
}

// ── the post-round WRITES: carrier record → Experience → Portfolio ────────────────────────────────────
//
// ⛔ WHERE THE PROVENANCE CHAIN LIVES, AND WHY IT RESOLVES BOTH WAYS. Every row written here is keyed on
// the carrier record's own `record_id`:
//   · the EXPERIENCE's `source_ref` IS that id, and its `evidence[0].sha256` is the digest of the carrier
//     LINE's bytes ⇒ carrier → Experience, re-checkable;
//   · the PORTFOLIO's `origin_ref` IS that id and `origin_carrier` is the carrier ⇒ Portfolio → carrier,
//     through the portfolio module's own `resolveOriginRef`;
//   · Experience → Portfolio and Portfolio → Experience both go through the same id (the Experience's
//     `case_id` is `EXP-<record_id>`), so neither direction needs a second index.
//
// ⛔ NOTHING HERE IS FILED. No fix task is created, no Goal is written and no human rating is emitted — the
// Portfolio row carries `fix_task:null` and the value assessment's candidate fix stays an OUTLINE on the
// carrier record. Filing a fix stays the operator's decision (Plan 4).

/** The role an Experience carries for a cluster, or `null` when the cluster gets no Experience at all
 *  (the one mechanical-repeat case: it was already ingested by the earlier round). PURE. */
export function experienceRoleFor(cluster: Record<string, unknown>, disposition: NoveltyDisposition, clusterVerdict: string | null): string | null {
  if (clusterVerdict === "refuted") return "confirmed-negative";
  if (clusterVerdict === "undetermined") return "undetermined";
  if (clusterVerdict !== "supported") return null;
  if (disposition === "mechanical-duplicate") return null;
  if (disposition === "duplicate" || disposition === "restatement") return "duplicate";
  // `novel` AND `unjudged`: the claim HELD (so `found-unresolved` is true of it) — what the novelty check
  // decided is about NEWNESS, and `unjudged` decided nothing, so it must not be written as anything else.
  return "found-unresolved";
}

/** The summary an Experience carries: the cluster's OWN words, composed. PURE. ⛔ Nothing is invented here
 *  — every piece comes off the carrier record or the model's own returned text, and a composed summary
 *  that is too thin is REFUSED by the ledger rather than padded (硬规则 3b).
 *
 *  ⛔ WHEN A DISCOVERY METHOD GUIDED THE ROUND, THE EXPERIENCE NAMES IT (Plan item 2b — closing the
 *  loop): the last clause carries `guided by method <id>@v<n>`, read off the cluster record's own
 *  `method_guidance`. That is what lets Discovery Method reflection attribute an outcome (net-new /
 *  duplicate / refuted / nothing found) back to the method that steered the exploration, instead of the
 *  method being an unaccountable hint. A baseline round's summary is unchanged, clause for clause. */
export function experienceSummaryFor(cluster: Record<string, unknown>, novelty: NoveltyOutcome | null): string {
  const claim = typeof cluster.claim === "string" ? cluster.claim : "(no claim recorded)";
  const parts: string[] = [claim];
  const va = (cluster.model_value_assessment ?? null) as Record<string, unknown> | null;
  if (va && typeof va.impact === "string" && va.impact !== "") parts.push(`impact: ${va.impact}`);
  if (novelty && novelty.reasoning !== null) parts.push(`novelty (${novelty.disposition}): ${novelty.reasoning}`);
  if (cluster.refutation_verdict === "refuted" && typeof cluster.refutation_counterexample === "string" && cluster.refutation_counterexample !== "") {
    parts.push(`refuted by: ${cluster.refutation_counterexample}`);
  }
  const ev = Array.isArray(cluster.evidence_lines) ? (cluster.evidence_lines as unknown[]).filter((x) => typeof x === "string") : [];
  if (ev.length > 0) parts.push(`evidence: ${(ev as string[]).join("; ")}`);
  const guided = methodLabelsOf(cluster);
  if (guided.length > 0) parts.push(`guided by method ${guided.join(",")}`);
  return parts.join(" — ");
}

export interface IngestionWrite {
  cluster: number;
  record_id: string;
  /** `supported` / `refuted` / `undetermined` — the cluster's own derived verdict. */
  verdict: string | null;
  disposition: NoveltyDisposition | "not-confirmed";
  experience_role: string | null;
  experience: { written: boolean; id: string | null; reasons: string[] };
  portfolio: { written: boolean; finding_id: string | null; duplicate_of: string | null; skipped: string | null; reasons: string[] };
}

/**
 * Write the Experience (and, for a novel/duplicate CONFIRMED cluster, the Portfolio row) for every cluster
 * record of a round that is ALREADY on the carrier.
 *
 * ⛔ `carrierPath` is re-read here rather than handed the in-memory records: the Experience's evidence
 * digest must be of the bytes that are REALLY on disk, and re-reading is what makes that true rather than
 * assumed. A record whose line cannot be found is REFUSED with its own reason — never ingested with a
 * digest of something else.
 */
export function ingestRoundClusters(root: string, opts: {
  carrierPath: string;
  carrierRel: string;
  clusterRecords: readonly Record<string, unknown>[];
  noveltyByCluster: ReadonlyMap<number, NoveltyOutcome>;
  portfolio: PortfolioModule;
  ledger: LedgerModule;
  authoredBy: { actor: string; ref: string };
}): IngestionWrite[] {
  const p = opts.portfolio;
  const byRecordId = new Map<string, { raw: string; line: number }>();
  try {
    const text = fs.readFileSync(opts.carrierPath, "utf8");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      let rec: unknown;
      try { rec = JSON.parse(line); } catch { continue; }
      const id = rec && typeof rec === "object" && !Array.isArray(rec) ? (rec as Record<string, unknown>).record_id : null;
      if (typeof id === "string" && !byRecordId.has(id)) byRecordId.set(id, { raw: line, line: i + 1 });
    }
  } catch { /* an unreadable carrier leaves every lookup empty ⇒ every cluster is refused BY NAME below */ }

  const writes: IngestionWrite[] = [];
  for (const cluster of opts.clusterRecords) {
    const idx = Number(cluster.cluster ?? 0);
    const recordId = typeof cluster.record_id === "string" ? cluster.record_id : "";
    const verdict = opts.ledger.clusterVerdict(cluster);
    const novelty = opts.noveltyByCluster.get(idx) ?? null;
    const disposition: NoveltyDisposition | "not-confirmed" = cluster.confirmed === true ? (novelty?.disposition ?? "unjudged") : "not-confirmed";
    const role = experienceRoleFor(cluster, disposition === "not-confirmed" ? "unjudged" : disposition, verdict);
    const write: IngestionWrite = {
      cluster: idx, record_id: recordId, verdict, disposition, experience_role: role,
      experience: { written: false, id: null, reasons: [] },
      portfolio: { written: false, finding_id: null, duplicate_of: null, skipped: null, reasons: [] },
    };
    if (role !== null) {
      const hit = byRecordId.get(recordId);
      if (hit === undefined) {
        write.experience.reasons = [`CARRIER_LINE_NOT_FOUND:${recordId}-is-not-on-${opts.carrierRel}`];
      } else {
        const res = opts.ledger.ingestExperience(root, {
          source: "discovery-carrier",
          record: { rec: cluster, raw: hit.raw, line: hit.line },
          carrier: opts.carrierRel,
          role,
          caseId: opts.ledger.clusterCaseId(recordId),
          summary: experienceSummaryFor(cluster, novelty),
          components: Array.isArray(cluster.components) ? cluster.components : [],
          authoredBy: opts.authoredBy,
          evidenceLevel: "production-open",
        });
        write.experience = { written: res.ok === true, id: res.id ?? null, reasons: Array.isArray(res.reasons) ? res.reasons : [] };
      }
    }
    // The Portfolio row: ONLY for a CONFIRMED cluster the novelty check judged `novel` or named a
    // resolvable `duplicate`. ⛔ A refuted or undetermined cluster NEVER reaches the Portfolio as
    // `supported` — the two ledgers answer different questions and this is where that is enforced.
    if (verdict === "supported" && (disposition === "novel" || disposition === "duplicate")) {
      const claim = typeof cluster.claim === "string" ? cluster.claim : "";
      // ⛔ The `method_ref` column the Portfolio already carries is what this closes: a finding produced
      // by a GUIDED round names the method that guided it, so the coverage map's "which methods are
      // actually producing findings" is answered by the data rather than by a comment. A baseline round
      // still writes `null` — an unguided finding has no method to name, and `null` is not "unknown".
      const guided = methodLabelsOf(cluster);
      const input: Record<string, unknown> = {
        finding_id: recordId,
        origin: "autonomous-routine",
        origin_ref: recordId,
        evidence_level: "production-open",
        method_ref: guided.length > 0 ? guided.join(",") : null,
        claim,
        components: Array.isArray(cluster.components) ? cluster.components : [],
        outcome: "supported",
        // ⛔ NOT a filed task and NOT a rating: the operator files fixes, and a human rates. Both stay null.
        fix_task: null,
        human_rating: null,
        domain: null,
        domain_reason: null,
      };
      if (disposition === "duplicate" && novelty?.duplicate_of) input.duplicate_of = novelty.duplicate_of;
      const res = p.ingestFinding(root, input);
      write.portfolio = {
        written: res.ok === true, finding_id: res.ok === true ? recordId : null,
        duplicate_of: disposition === "duplicate" ? (novelty?.duplicate_of ?? null) : null,
        skipped: null, reasons: Array.isArray(res.reasons) ? res.reasons : [],
      };
    } else {
      write.portfolio.skipped = verdict === "supported"
        ? (disposition === "mechanical-duplicate" ? "mechanical-duplicate: already on the Portfolio from the earlier round" : `disposition:${disposition}-is-not-a-Portfolio-row`)
        : `verdict:${String(verdict)}-is-never-a-Portfolio-supported-row`;
    }
    writes.push(write);
  }
  return writes;
}

// ── METHOD SELECTION: may a Discovery Method guide this round, and which arm ─────────────────────────
//
// (task gap-open-discovery-method-guidance-active-shadow, Plan items 1–3.)
//
// ⛔ A method NEVER gates whether the model may look and NEVER suppresses a round. Selection decides one
//   thing only: WHICH model prompt an exploration gets, and whether its records are production or an
//   isolated SHADOW arm. "No eligible method" ⇒ the round runs BASELINE (unguided), never "no round".
//
// The trust judgment is NOT re-derived here: `readMethodRegistry` owns "latest version per method_id",
// `methodTrust` (the portfolio module) owns the status vocabulary + the contaminated-verdict ledger, and
// `quarantinedLineageOf` (the registry) owns the QUARANTINE lineage walk. This function applies the
// POLICY — active ⇒ production, draft/trial ⇒ shadow only, retired/quarantined/contaminated ⇒ never.

export const METHOD_ARM_PRODUCTION = "production" as const;
export const METHOD_ARM_SHADOW = "shadow" as const;
export type MethodArm = "production" | "shadow";

export interface MethodIncluded {
  method_id: string;
  version: number | null;
  status: string;
  arm: MethodArm;
  /** The non-whitespace length of the guidance text handed over — the record reports the SIZE of what
   *  was appended rather than the text itself (the carrier is not a prompt archive). */
  guidance_chars: number;
}
export interface MethodExcluded {
  method_id: string;
  version: number | null;
  status: string | null;
  reasons: string[];
}
export interface MethodSelection {
  /** ⛔ `false` is its OWN value: "the registry could not be read" is never shaped like "no method is
   *  recorded" (硬规则 3b). The round still runs — baseline — and says why. */
  ok: boolean;
  mode: "guided" | "baseline";
  baseline_reason: string | null;
  included: MethodIncluded[];
  excluded: MethodExcluded[];
  evaluated: number;
  unavailable_reason: string | null;
  registry: {
    file: string | null;
    malformed_lines: number;
    active_ids: string[];
    active_evaluated: number | null;
    excluded_contaminated: string[] | null;
    contaminated_verdicts_evaluated: number | null;
  };
  production: MethodIncluded[];
  shadow: MethodIncluded[];
  /** The guidance blocks for the two arms (`""` when the arm is unguided). */
  production_text: string;
  shadow_text: string;
}

const asMethodId = (m: Record<string, unknown>): string => String(m.method_id ?? "<unnamed>");
const asVersion = (m: Record<string, unknown>): number | null => (Number.isInteger(m.version) ? (m.version as number) : null);

/** The registry's own reading, recorded alongside the decision so a reviewer can tell "the selection
 *  refused this method" from "the registry's `activeMethods` never returned it". */
function registryReadingBlock(
  read: { file: string | null; malformed_lines: number },
  active: ReturnType<RegistryModule["activeMethods"]>,
): MethodSelection["registry"] {
  return {
    file: read.file,
    malformed_lines: read.malformed_lines,
    active_ids: active.ok ? active.methods.map(asMethodId).sort() : [],
    active_evaluated: active.ok ? active.evaluated : null,
    excluded_contaminated: active.ok && Array.isArray(active.excluded_contaminated)
      ? active.excluded_contaminated.map((x) => String(x.method_id))
      : null,
    contaminated_verdicts_evaluated: active.ok ? active.contaminated_verdicts_evaluated : null,
  };
}

/**
 * Select this round's methods. PURE over the injected engine modules (one `git`/fs read each). Never
 * throws: an unreadable registry, deny-list or contaminated-verdict list is its own reported value and
 * the caller proceeds baseline — a mechanical read must never decide whether the model may look.
 */
export function selectMethodsForRound(root: string, modules: OpenDiscoveryModules): MethodSelection {
  const read = modules.registry.readMethodRegistry(root, { history: true });
  const active = modules.registry.activeMethods(root);
  const registry = registryReadingBlock(read, active);
  const unavailable = (reason: string): MethodSelection => ({
    ok: false, mode: "baseline", baseline_reason: reason, included: [], excluded: [],
    evaluated: read.latest.length, unavailable_reason: reason, registry,
    production: [], shadow: [], production_text: "", shadow_text: "",
  });
  if (read.file === null) {
    return unavailable(String(read.reason ?? "REGISTRY_UNRESOLVABLE:the-registry-file-could-not-be-resolved-so-no-method-can-be-read"));
  }
  // A partially-readable registry could hide a QUARANTINE line, so a readable subset is NOT selected
  // from: the round runs baseline and RECORDS that the registry could not be trusted (硬规则 3b).
  if (!read.ok) {
    return unavailable(`REGISTRY_UNREADABLE:${read.malformed_lines}-unparseable-line(s)-in-${read.file}-so-no-method-is-selected-this-round`);
  }
  const history = Array.isArray(read.history) ? read.history : [];
  const cont = modules.registry.contaminatedVerdictIds(root);
  const contaminatedIds = cont.ok ? cont.ids : null;
  const denied = modules.ledger.experienceDenyList(root);
  const activeIds = new Set(registry.active_ids);

  const included: MethodIncluded[] = [];
  const excluded: MethodExcluded[] = [];
  const texts = new Map<string, string>();

  for (const rec of read.latest) {
    const id = asMethodId(rec);
    const version = asVersion(rec);
    const status = typeof rec.status === "string" ? rec.status : null;
    const reasons: string[] = [];
    const trust = modules.portfolio.methodTrust(rec, { contaminatedVerdictIds: contaminatedIds });
    if (!cont.ok) {
      // The contaminated-verdict ledger is UNREADABLE ⇒ nothing can be cleared, so nothing is selected.
      reasons.push(`CONTAMINATED_LIST_UNAVAILABLE:${String(cont.reason ?? "the-contaminated-verdict-ledger-could-not-be-read")}`);
    } else {
      // ⛔ THE QUARANTINE WALK RUNS FIRST, so a quarantined lineage is REPORTED even when the record is
      // ALSO retired: the two refusals are independent facts and a reviewer must be able to see the
      // quarantine rather than a bare "retired" that hides which of the two rules caught it. It also
      // catches a draft/trial SUCCESSOR of a quarantined version, which no status check would.
      const q = modules.registry.quarantinedLineageOf(rec, history);
      if (q.quarantined) reasons.push(`QUARANTINED_LINEAGE:${id}-carries-a-QUARANTINE-retirement-reason-on-v${q.versions.join(",v")}`);
      if (trust.contaminated) reasons.push(`CONTAMINATED_PROMOTION:${String(trust.verdict_ref)}-is-on-the-contaminated-verdict-ledger`);
      if (trust.status === null) reasons.push(`STATUS_NOT_IN_VOCAB:${String(rec.status)}`);
      else if (trust.why === "RETIRED") reasons.push(`RETIRED:${methodLabel({ method_id: id, version })}-is-retired-so-it-never-guides-a-round`);
    }
    let text = "";
    if (reasons.length === 0) {
      // Plan item 3: the text that WOULD be handed to the model is scanned with the ledger's own
      // deny-list, so a method whose guidance names a registered seed component or case id is excluded
      // (and says which value leaked) rather than steering the round.
      text = modules.registry.methodGuidanceText(rec);
      if (!denied.ok) {
        reasons.push(`DENY_LIST_UNAVAILABLE:${denied.malformed_lines}-unparseable-line(s)-in-the-experience-ledger-so-the-guidance-text-cannot-be-scanned`);
      } else {
        const leak = modules.ledger.scanExperienceLeak(denied, text);
        if (leak.flagged) reasons.push(`GUIDANCE_TEXT_NAMES_SEED:${leak.matches.map((m) => `${m.kind}:${String(m.value)}`).join(",")}`);
      }
    }
    if (reasons.length === 0 && status !== null && status === "active" && !activeIds.has(id)) {
      // Defence in depth: the status says "active" but the registry's own `activeMethods` reader did not
      // return it. The two readers must agree before a method may steer PRODUCTION.
      reasons.push(`ACTIVE_READER_DIVERGENCE:${id}-is-active-but-activeMethods()-did-not-return-it`);
    }
    if (reasons.length === 0 && status !== "active" && status !== "draft" && status !== "trial") {
      reasons.push(`STATUS_NOT_SELECTABLE:${String(status)}`);
    }
    if (reasons.length > 0) {
      excluded.push({ method_id: id, version, status, reasons });
      continue;
    }
    const arm: MethodArm = status === "active" ? METHOD_ARM_PRODUCTION : METHOD_ARM_SHADOW;
    included.push({ method_id: id, version, status: String(status), arm, guidance_chars: text.length });
    texts.set(id, text);
  }

  const production = included.filter((m) => m.arm === METHOD_ARM_PRODUCTION);
  const shadow = included.filter((m) => m.arm === METHOD_ARM_SHADOW);
  const mode: MethodSelection["mode"] = production.length > 0 ? "guided" : "baseline";
  const baseline_reason = mode === "guided"
    ? null
    : read.latest.length === 0
      ? "no-method-recorded:the-registry-holds-0-record(s)-so-the-production-arm-runs-baseline"
      : shadow.length > 0
        ? `no-active-method:0-of-${read.latest.length}-record(s)-is-active(only ${shadow.length} draft/trial ⇒ shadow arm only),${excluded.length} excluded-so-the-production-arm-runs-baseline`
        : `no-eligible-method:0-of-${read.latest.length}-record(s)-selected,${excluded.length} excluded-so-the-production-arm-runs-baseline`;
  return {
    ok: true, mode, baseline_reason, included, excluded, evaluated: read.latest.length,
    unavailable_reason: null, registry, production, shadow,
    production_text: methodDirective(production, production.map((m) => texts.get(m.method_id) ?? "")),
    shadow_text: methodDirective(shadow, shadow.map((m) => texts.get(m.method_id) ?? "")),
  };
}

/** The `method_guidance` block a cluster record carries: which arm produced it and which methods guided
 *  it. `null` for a baseline production cluster — never an empty list, which would read as "guided by
 *  nothing" (硬规则 3b). */
export function methodGuidanceBlock(
  picks: readonly MethodIncluded[],
  arm: MethodArm,
): { arm: MethodArm; methods: { method_id: string; version: number | null }[] } | null {
  if (picks.length === 0) return null;
  return { arm, methods: picks.map((m) => ({ method_id: m.method_id, version: m.version })) };
}

/** The `id@vN` labels of the methods a carrier cluster record names as its guidance. `[]` when the
 *  record carries none — a baseline round, a shadow cluster, or a record written before methods existed.
 *  Reading is deliberately STRUCTURAL (a field read, not a pattern). */
export function methodLabelsOf(cluster: Record<string, unknown>): string[] {
  const block = (cluster as Record<string, unknown>)?.method_guidance;
  if (block === null || block === undefined || typeof block !== "object" || Array.isArray(block)) return [];
  const methods = (block as Record<string, unknown>).methods;
  if (!Array.isArray(methods)) return [];
  const out: string[] = [];
  for (const m of methods) {
    if (m === null || typeof m !== "object" || Array.isArray(m)) continue;
    const id = (m as Record<string, unknown>).method_id;
    if (typeof id !== "string" || id === "") continue;
    const v = (m as Record<string, unknown>).version;
    out.push(methodLabel({ method_id: id, version: Number.isInteger(v) ? (v as number) : null }));
  }
  return out;
}

/** The record id of a SHADOW cluster: the round timestamp, a `shadow` segment and the index. The segment
 *  is what keeps a shadow record from colliding with the production cluster of the same index — and what
 *  makes "did anything from the shadow arm reach the Portfolio?" answerable by reading an id. */
export function openShadowDiscoveryRecordId(roundTs: string, cluster: number): string {
  return `${OPEN_DISCOVERY_REF_PREFIX}${roundTs}#shadow#${cluster}`;
}

/** The record id of a PAIRED round's UNGUIDED (baseline) cluster. The segment keeps it from colliding
 *  with the same index's production cluster — and, more importantly, from being RESOLVED as one: a
 *  measurement arm's record is not a production finding. */
export function openBaselineDiscoveryRecordId(roundTs: string, cluster: number): string {
  return `${OPEN_DISCOVERY_REF_PREFIX}${roundTs}#baseline#${cluster}`;
}

// ── THE PAIRED GAIN ROUND (task gap-open-discovery-periodic-baseline-vs-guided-gain) ─────────────────
//
// UNDER SEMANTIC FIRST, MECHANIZE LATER (user ruling 2026-10-12) this is the INSTRUMENT that later
// decides what may be crystallized into mechanical code — and it must keep running AFTER any
// crystallization, as the baseline/degradation monitor (semantic arm vs crystallized arm).
//
// WHY A PAIRED ROUND AND NOT A NUMBER. Whether method guidance helps has to be measured in production
// rather than asserted, and it must not reuse a contaminated hold-out as "independent" evidence: the
// 2026-10-12 capability-gain experiment showed an apparent +1 that did not survive recheck (a "new"
// finding duplicated an earlier one, and a second was refuted). A single arm's net-new count cannot
// tell guidance from luck, because the pin, the inventory and the model all move between rounds. So
// the same round is run TWICE on the SAME pin, the SAME inventory, the SAME model and the SAME budget
// — only the investigator prompt differs — and the DIFFERENCE is recorded, negative values included.
//
// ⛔ WHAT IS MECHANICAL HERE, AND WHAT IS NOT. Everything below is arithmetic over the two arms'
// records: counting, subtracting, and deciding when the pair is due. NOTHING here judges whether a
// finding is real (the verifier + refuter + novelty check do that, unchanged and per arm), nothing is
// smoothed into one score, and no threshold is introduced — a gain of −2 is recorded as −2.
//
// ⛔ EVIDENCE LEVEL. These rounds are `production-open`: open exploration, no labels, no held-out case.
// They are NEVER counted as `independent` generalization evidence for a method promotion. Promotion
// stays governed by the evidence-level rules of gap-discovery-evidence-level-teaching-vs-independent
// (a correct prediction reaches `active` only on an `independent` verdict; every other level — this one
// included — caps at the report-only `trial`). The record says so on its own bytes
// (`counts_as_independent_evidence:false`) so a reader does not have to re-derive it from the level.

/** The two arms of a paired round. `baseline` is the UNGUIDED exploration; `guided` is the same
 *  exploration with at least one eligible method's guidance prepended to the investigator prompt. */
export const PAIRED_ARM_BASELINE = "baseline" as const;
export const PAIRED_ARM_GUIDED = "guided" as const;
export type PairedArm = typeof PAIRED_ARM_BASELINE | typeof PAIRED_ARM_GUIDED;
export const PAIRED_ARMS: readonly PairedArm[] = [PAIRED_ARM_BASELINE, PAIRED_ARM_GUIDED];

/** The carrier `kind` of a paired round's gain record, and of the rolling summary appended beside it.
 *  ⛔ Named kinds, so "is this line a gain record?" is a field read rather than a guess, and so a
 *  promotion reader that resolves a ref can tell a gain record from a generalization verdict. */
export const GAIN_RECORD_KIND = "open-discovery-gain";
export const GAIN_SUMMARY_KIND = "open-discovery-gain-summary";

/** The evidence level every record of this instrument carries. `production-open` is one of the ledger's
 *  own `EVIDENCE_LEVELS`; it is NOT `independent`, and that is the whole point of carrying it. */
export const PRODUCTION_OPEN_EVIDENCE_LEVEL = "production-open";

/** The ONE spelling of "there was nothing to pair" — its own reason token, never a zero gain. A round
 *  with no eligible method produces NO gain record at all; the summary counts this state separately, so
 *  "we could not measure" can never be read as "guidance gained nothing". */
export const PAIRED_NOT_EVALUATED_NO_ELIGIBLE_METHOD = "not-evaluated:no-eligible-method";

/** The four counts a paired round scores each arm on (Plan item 3), plus the readings a reviewer needs
 *  to tell "nothing was found" from "nothing ran". */
export interface PairedArmCounts {
  arm: PairedArm;
  /** Confirmed findings whose novelty disposition is `novel` — AFTER the novelty check, so a duplicate
   *  or a restatement is excluded here by the SAME rule the Portfolio obeys. */
  confirmed_net_new: number;
  /** Confirmed findings the novelty check called already-known (duplicate / restatement) plus the
   *  byte-identical repeats deduped mechanically. Never counted as net-new. */
  duplicates: number;
  /** Clusters the verifier or the refuter REFUTED — false positives. Never counted as net-new (a
   *  refuted cluster is not `confirmed`). */
  refuted: number;
  /** Clusters that were neither confirmed nor refuted — reported so a reader is not left to infer it. */
  undetermined: number;
  confirmed_total: number;
  /** `true` when the arm produced no confirmed cluster at all — a different statement from `0 net-new`,
   *  which is what an arm that confirmed 3 duplicates reads as. */
  nothing_found: boolean;
  model_calls: number;
  /** The arm's gateway USD, summed over its OWN calls (`cost_charged_usd`, which already counts an
   *  unreadable price at the per-call ceiling rather than 0). */
  usd: number;
}

/** The arm's own budget ENVELOPE. Both arms of a pair must be run under an IDENTICAL envelope — the
 *  comparison is "same budget, different prompt", so an arm that got more turns or more clusters is not
 *  an arm of the same experiment (see `pairedBudgetRefusal`). */
export interface PairedArmBudget {
  investigator_runs: number;
  max_clusters_verified: number;
  investigator_max_turns: number;
  verifier_max_turns: number;
  refutation_max_turns: number;
}

/** The envelope BOTH arms are run under, read once from the round's config so the two arms cannot
 *  disagree by construction. */
export function pairedArmBudget(cfg: OpenSemanticDiscoveryConfig): PairedArmBudget {
  return {
    investigator_runs: cfg.investigatorRuns,
    max_clusters_verified: cfg.maxClustersVerified,
    investigator_max_turns: cfg.investigatorMaxTurns,
    verifier_max_turns: cfg.verifierMaxTurns,
    refutation_max_turns: cfg.refutationMaxTurns,
  };
}

/** ⛔ AC (a): arms with DIFFERENT budgets are REFUSED. A paired round is only a controlled comparison
 *  while the two arms share one envelope; a gate that let them differ would record "guidance helped"
 *  for a round in which guidance also got twice the verifier calls. PURE. */
export function pairedBudgetRefusal(a: PairedArmBudget, b: PairedArmBudget): { code: string; reasons: string[] } | null {
  const reasons: string[] = [];
  for (const key of Object.keys(a) as (keyof PairedArmBudget)[]) {
    if (a[key] !== b[key]) reasons.push(`PAIRED_ARM_BUDGETS_DIFFER:${key}:${String(a[key])}!=${String(b[key])}`);
  }
  return reasons.length ? { code: "PAIRED_ARM_BUDGETS_DIFFER", reasons } : null;
}

/** Score ONE arm on the four counts (Plan item 3). PURE over the arm's own cluster records, the novelty
 *  outcomes decided for them and its own call records.
 *
 *  ⛔ THE ONE RULE ACs (c) and (d) SHARE: `confirmed_net_new` counts a cluster only when it is
 *  CONFIRMED (it survived the independent refuter) AND its novelty disposition is `novel`. A refuted
 *  cluster is never confirmed, so it can never be net-new however the arm's rows are ordered; and
 *  `duplicate` / `restatement` / `mechanical-duplicate` / `unjudged` are each a different value from
 *  `novel`, so none of them can be counted as new. The two counts are therefore not "conventions" that
 *  a caller could get wrong — they are read from the record's own fields. */
export function pairedArmCounts(opts: {
  arm: PairedArm;
  clusters: readonly Record<string, unknown>[];
  novelty: readonly { cluster: number; disposition: string }[];
  calls: readonly { cost_charged_usd?: unknown }[];
}): PairedArmCounts {
  const dispositionOf = new Map<number, string>();
  for (const o of opts.novelty) dispositionOf.set(Number(o.cluster), String(o.disposition));
  const refutedOf = (c: Record<string, unknown>): boolean =>
    c.verifier_verdict === "refuted" || c.refutation_verdict === "refuted";
  const DUPLICATE_DISPOSITIONS = ["duplicate", "restatement", "mechanical-duplicate"];
  let netNew = 0;
  let duplicates = 0;
  let refuted = 0;
  let undetermined = 0;
  let confirmedTotal = 0;
  for (const c of opts.clusters) {
    // ⛔ AC (d), read STRICTLY: a REFUTED cluster is never net-new and never a duplicate, whatever else
    // the record says about it. A row that carried both `confirmed:true` and a refuted verdict is a
    // contradiction, and the direction a contradiction must fail is toward NOT counting it as a
    // finding — the rule is a property of the refutation, not of the `confirmed` flag beside it.
    if (refutedOf(c)) { refuted++; continue; }
    if (c.confirmed !== true) { undetermined++; continue; }
    confirmedTotal++;
    const disposition = dispositionOf.get(Number(c.cluster));
    if (disposition === "novel") netNew++;
    else if (disposition !== undefined && DUPLICATE_DISPOSITIONS.includes(disposition)) duplicates++;
  }
  let usd = 0;
  for (const call of opts.calls) {
    const v = call.cost_charged_usd;
    usd += typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : PER_CALL_USD_CEILING;
  }
  return {
    arm: opts.arm,
    confirmed_net_new: netNew,
    duplicates,
    refuted,
    undetermined,
    confirmed_total: confirmedTotal,
    nothing_found: confirmedTotal === 0,
    model_calls: opts.calls.length,
    usd: round6(usd),
  };
}

/** The arm's counts folded into the `novelty` array `pairedArmCounts` reads, so the two arms are scored
 *  by the same function from the same shape. */
export const armNoveltyRows = (outcomes: readonly NoveltyOutcome[]): { cluster: number; disposition: string }[] =>
  outcomes.map((o) => ({ cluster: Number(o.cluster), disposition: String(o.disposition) }));

/** The call records ONE arm left on the round, selected by the reservation step NAME the arm stamps on
 *  every call (`baseline-*` for the unguided arm, everything except the shadow arm's own pass for the
 *  guided one). ⛔ Read by POSITION on the step field, never by order: the shadow pass belongs to a
 *  THIRD thing (a draft/trial method's isolated arm) and folding its calls into the guided arm's cost
 *  would charge the guided arm for work no eligible method guided. */
export function callsOfArm(calls: readonly Record<string, unknown>[], arm: PairedArm): Record<string, unknown>[] {
  const baselinePrefix = `${PAIRED_ARM_BASELINE}-`;
  if (arm === PAIRED_ARM_BASELINE) return calls.filter((c) => String(c.step).startsWith(baselinePrefix));
  return calls.filter((c) => String(c.step) !== "shadow-investigator" && !String(c.step).startsWith(baselinePrefix));
}

/**
 * GAIN = guided − baseline, per metric, NEGATIVE VALUES INCLUDED (Plan item 3, AC (c)). ⛔ There is no
 * clamping, no `Math.max(0, …)`, and no absolute value anywhere below: an arm that found FEWER net-new
 * findings under guidance is a real, recorded −N. `usd` is signed the same way (guidance costs money).
 */
export function gainOf(baseline: PairedArmCounts, guided: PairedArmCounts): {
  net_new: number; duplicates: number; refuted: number; undetermined: number; usd: number; model_calls: number;
} {
  return {
    net_new: guided.confirmed_net_new - baseline.confirmed_net_new,
    duplicates: guided.duplicates - baseline.duplicates,
    refuted: guided.refuted - baseline.refuted,
    undetermined: guided.undetermined - baseline.undetermined,
    usd: round6(guided.usd - baseline.usd),
    model_calls: guided.model_calls - baseline.model_calls,
  };
}

/** ⛔ AC (b): a pre-registration written AFTER the first call is REFUSED — a "pre-registration" that
 *  postdates the run it scores is a post-hoc rationalisation, not a pre-registration.
 *
 *  The gate REUSES the engine's own `preregRefusal` (硬规则 5b — the mtime rule and the hash vocabulary
 *  are declared once, in `arch-hypothesis-generation.mjs`, and a second copy here would be a second
 *  convention to keep in step). What this adds is the shape a PAIRED round needs: the expected key set
 *  (each arm's prompt digest under an arm-scoped key, plus the inventory and budget the two arms SHARE)
 *  and the arm calls' own start times.
 *
 *  ⛔ 硬规则 3b: "no call time was supplied" is its OWN refusal — with nothing to be older than, a
 *  pre-registration cannot be checked, and passing it would report an unverifiable pair as clean. */
export const pairedPreregKeys = (hashes: {
  baselinePrompt: string; guidedPrompt: string; inventory: string; budget: string;
}): Record<string, string> => ({
  [`${PAIRED_ARM_BASELINE}-prompt`]: hashes.baselinePrompt,
  [`${PAIRED_ARM_GUIDED}-prompt`]: hashes.guidedPrompt,
  inventory: hashes.inventory,
  budget: hashes.budget,
});

export function pairedPreregRefusal(opts: {
  prereg: Record<string, unknown> | null;
  preregMtimeMs: number | null;
  expected: Record<string, string>;
  armCallMtimesMs: readonly number[];
  /** The reused engine gate (`arch-hypothesis-generation.mjs` `preregRefusal`) — injected, never
   *  re-derived, so this module holds no second copy of the hash/mtime vocabulary. */
  preregRefusalFn: (o: {
    prereg: Record<string, unknown> | null; expected: Record<string, string>;
    preregMtimeMs: number | null; runMtimesMs: number[];
  }) => { code: number; reasons: string[] } | null;
}): { code: number | string; reasons: string[] } | null {
  if (opts.armCallMtimesMs.length === 0) {
    return { code: "PAIRED_PREREG_UNVERIFIABLE", reasons: ["PAIRED_PREREG_UNVERIFIABLE:no-arm-call-start-time-was-supplied-so-a-pre-registration-cannot-be-shown-to-precede-any-call"] };
  }
  return opts.preregRefusalFn({
    prereg: opts.prereg,
    expected: opts.expected,
    preregMtimeMs: opts.preregMtimeMs,
    runMtimesMs: [...opts.armCallMtimesMs],
  });
}

/** The gain record ONE paired round appends. It carries BOTH arms' counts, the signed gain, the shared
 *  pin/inventory/prereg and the evidence level — everything a later reviewer needs to re-read the
 *  comparison, and nothing that could be mistaken for a promotion. */
export function buildGainRecord(opts: {
  roundTs: string;
  invokedBy: InvokedBy;
  pinRev: string;
  inventorySha: string | null;
  prereg: { path: string | null; mtime_ms: number | null; keys: string[]; refusal: string | null };
  budget: PairedArmBudget;
  budgetLedgerRel: string;
  baseline: PairedArmCounts;
  guided: PairedArmCounts;
  guidedBy: readonly string[];
  ordinal: number;
  everyRounds: number;
}): Record<string, unknown> {
  return {
    kind: GAIN_RECORD_KIND,
    routine: OPEN_SEMANTIC_DISCOVERY_NAME,
    invoked_by: opts.invokedBy,
    ts: opts.roundTs,
    paired: true,
    every_rounds: opts.everyRounds,
    eligible_round_ordinal: opts.ordinal,
    pin: { rev: opts.pinRev },
    inventory: { sha256: opts.inventorySha },
    prereg: opts.prereg,
    budget: { ...opts.budget, ledger: opts.budgetLedgerRel, shared_by_arms: true },
    guided_by: [...opts.guidedBy],
    arms: { [PAIRED_ARM_BASELINE]: opts.baseline, [PAIRED_ARM_GUIDED]: opts.guided },
    gain: gainOf(opts.baseline, opts.guided),
    evidence_level: PRODUCTION_OPEN_EVIDENCE_LEVEL,
    // ⛔ The reader does not have to know which levels are independent to read this record correctly.
    counts_as_independent_evidence: false,
    promotion: {
      licenses: "nothing",
      why: "a production-open open-exploration round names no held-out case, so it can never be generalization evidence; promotion stays governed by the evidence-level rules (only an independent verdict reaches active)",
    },
  };
}

/** The ROLLING SUMMARY across every paired round so far, plus the rounds that produced none. ⛔ It is
 *  never smoothed into a single positive number: every round's signed gain is listed under its own
 *  metric, `totals` only SUM them, and the rounds that could not be measured at all are counted under
 *  their own token instead of contributing a 0. */
export function gainRollup(records: readonly Record<string, unknown>[]): Record<string, unknown> {
  const gains = records.filter((r) => r.kind === GAIN_RECORD_KIND);
  // The rounds that produced NO gain record are counted under their own token, read off the ROUND's own
  // `paired.not_evaluated` field — never inferred from the absence of a gain line, which would make
  // "not measured" and "measured zero" the same reading (硬规则 3b).
  const notEvaluated: Record<string, number> = {};
  for (const r of records) {
    if (r.kind !== "scan-round") continue;
    const paired = r.paired;
    if (paired === null || typeof paired !== "object" || Array.isArray(paired)) continue;
    const token = (paired as Record<string, unknown>).not_evaluated;
    if (typeof token !== "string" || token === "") continue;
    notEvaluated[token] = (notEvaluated[token] ?? 0) + 1;
  }
  const series = (metric: string): number[] => gains.map((r) => {
    const g = (r.gain ?? {}) as Record<string, unknown>;
    const v = g[metric];
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  });
  const netNew = series("net_new");
  const duplicates = series("duplicates");
  const refuted = series("refuted");
  const usd = series("usd");
  const sum = (xs: readonly number[]) => round6(xs.reduce((a, b) => a + b, 0));
  const negatives = (xs: readonly number[]) => xs.filter((x) => x < 0).length;
  return {
    kind: GAIN_SUMMARY_KIND,
    routine: OPEN_SEMANTIC_DISCOVERY_NAME,
    ts: new Date().toISOString(),
    paired_rounds: gains.length,
    not_evaluated: notEvaluated,
    evidence_level: PRODUCTION_OPEN_EVIDENCE_LEVEL,
    counts_as_independent_evidence: false,
    // Every round's own signed value, in order — the raw series, not a blended score.
    series: { net_new: netNew, duplicates, refuted, usd },
    totals: { net_new: sum(netNew), duplicates: sum(duplicates), refuted: sum(refuted), usd: sum(usd) },
    negative_rounds: { net_new: negatives(netNew), duplicates: negatives(duplicates), refuted: negatives(refuted), usd: negatives(usd) },
    smoothing: "none: every paired round's gain is listed in `series`; no single blended score is produced and no value is clamped",
  };
}

/** How many ELIGIBLE rounds the carrier already records: resident scan-rounds that actually ran GUIDED.
 *  This is the ordinal the pairing cadence counts against, read off the carrier so it survives a driver
 *  restart (a counter kept in memory would restart at 0 and re-run the pair early). PURE. */
export function eligibleRoundsOf(records: readonly Record<string, unknown>[]): number {
  let n = 0;
  for (const r of records) {
    if (r.kind !== "scan-round") continue;
    if (r.invoked_by !== INVOKED_BY_RESIDENT) continue;
    const methods = r.methods as Record<string, unknown> | undefined;
    if (methods && methods.mode === "guided") n++;
  }
  return n;
}

/** Is THIS round a paired one? PURE. ⛔ AC (f): with no eligible method there is no pair to run, and the
 *  answer is its own token (`not-evaluated:no-eligible-method`) rather than "gain 0" — an unmeasured
 *  round and a measured zero must not be the same bytes. */
export function pairedRoundDecision(opts: {
  eligibleRounds: number;
  gainEveryRounds: number;
  eligibleMethods: number;
}): { due: boolean; ordinal: number; reason: string } {
  // The ordinal is reported in EVERY case, including the two that can never be due: where the cadence
  // stands is a separate fact from whether this round is the M-th one.
  const ordinal = opts.eligibleRounds + 1;
  if (opts.eligibleMethods < 1) {
    return { due: false, ordinal, reason: PAIRED_NOT_EVALUATED_NO_ELIGIBLE_METHOD };
  }
  if (!(opts.gainEveryRounds >= 1)) {
    return { due: false, ordinal, reason: "not-due:gain_every_rounds-is-not-a-positive-integer" };
  }
  return ordinal % opts.gainEveryRounds === 0
    ? { due: true, ordinal, reason: `paired-round:the-${ordinal}-th-eligible-round-${(opts.eligibleMethods)}-method(s)-eligible` }
    : { due: false, ordinal, reason: `not-due:eligible-round-${ordinal}-of-every-${opts.gainEveryRounds}` };
}

// ── the round ────────────────────────────────────────────────────────────────────────────────────────
export type ModelStepKind =
  | "investigator" | "verifier" | "refuter" | "value-assessment" | "novelty-check" | "shadow-investigator"
  // The PAIRED round's UNGUIDED arm runs the same four steps under their own kinds, so "which arm spent
  // this call" is readable straight off the reservation ledger instead of inferred from call order.
  | "baseline-investigator" | "baseline-verifier" | "baseline-refuter" | "baseline-value-assessment" | "baseline-novelty-check";

export interface OpenSemanticDiscoveryRunOptions {
  config: OpenSemanticDiscoveryConfig | null;
  configPresent: boolean;
  configError?: string | null;
  halted: boolean;
  invokedBy?: InvokedBy;
  force?: boolean;
  /** The engine seam. Absent ⇒ resolved from disk at runtime (`loadOpenDiscoveryModules`). */
  modules?: OpenDiscoveryModules | null;
  /** The base launcher argv builder. Defaults to driver-runtime's `launchArgv`. */
  launchArgvFn?: ((role: string, prompt: string, root: string, opts?: Record<string, unknown>) => string[]) | null;
  /** The spawn seam. Defaults to `spawnModelCall` (which roots the child at the pin). */
  spawnFn?: ((argv: string[], opts: { cwd: string; timeoutMs: number; stdinData?: string }) => Promise<{ status: number | null; stdout: string; stderr: string; error: Error | null }>) | null;
  /** Test seam: materialise the pin. Defaults to `materializeStrippedPin`. */
  pinFn?: ((opts: { root: string; rev: string; dir: string }) => PinResult) | null;
  /** Test seam: resolve the revision to pin. Defaults to the develop tip. */
  revFn?: ((root: string) => string) | null;
  budgetLedgerPath?: string;
  budgetLockPath?: string;
  carrierPath?: string;
  lastRunPath?: string;
  pinTmpRoot?: string;
  now?: () => number;
}

const asRel = (root: string, p: string) => path.relative(root, p) || p;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** The focus the MODEL stated, read from its own final text by PROTOCOL MARKER (the last occurrence wins:
 *  a model that restates its focus is read at its latest statement). Returns `null` when the model stated
 *  none — its own value, never an invented string. ⛔ String operations only: this file contains no
 *  regular expression, and the case-(l) control asserts exactly that. */
export function focusFromText(text: string): string | null {
  if (typeof text !== "string") return null;
  let found: string | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith(FOCUS_MARKER)) continue;
    const v = line.slice(FOCUS_MARKER.length).trim();
    if (v !== "") found = v;
  }
  return found;
}

/** The previously explored focuses, read off the carrier's own scan-round lines. This is the persisted
 *  mechanical state handed back to the model — the carrier IS the list; no second store is invented. */
export function priorFocuses(records: readonly Record<string, unknown>[], max: number = FOCUS_HISTORY_MAX): string[] {
  const out: string[] = [];
  for (let i = records.length - 1; i >= 0 && out.length < max; i--) {
    const rec = records[i];
    if (rec.kind !== "scan-round") continue;
    const focus = (rec.focus as Record<string, unknown> | undefined)?.chosen;
    if (typeof focus === "string" && focus !== "") out.push(focus);
  }
  return out.reverse();
}

/** The develop tip, resolved from the workspace. A `rev-parse` failure is the round's own `failed`. */
export function developTip(root: string): string {
  return execFileSync("git", ["-C", root, "rev-parse", "develop"], { encoding: "utf8" }).trim();
}

/** The whole round. Never throws (the loop records a `failed` Fact): every refused/failed path returns
 *  BEFORE the append, except the mid-round budget refusal, which PERSISTS what it did and says so. */
export async function runOpenSemanticDiscovery(root: string, opts: OpenSemanticDiscoveryRunOptions): Promise<Fact> {
  const now = opts.now ?? Date.now;
  const carrier = opts.carrierPath ?? path.join(root, CARRIER_REL);
  const ledgerPath = opts.budgetLedgerPath ?? path.join(root, BUDGET_LEDGER_REL);
  const lockPath = opts.budgetLockPath ?? path.join(root, BUDGET_LOCK_REL);
  const lastRunPath = opts.lastRunPath ?? path.join(root, ROUTINE_LAST_RUN_REL);
  const invokedBy: InvokedBy = opts.invokedBy ?? INVOKED_BY_DEFAULT;
  const resident = invokedBy === INVOKED_BY_RESIDENT;
  const force = opts.force === true;
  const base = { routine: OPEN_SEMANTIC_DISCOVERY_NAME, invoked_by: invokedBy, carrier: asRel(root, carrier) };
  const fact = (state: Fact["state"], value: Record<string, unknown>, reason: string): Fact =>
    ({ name: OPEN_SEMANTIC_DISCOVERY_NAME, value, state, reason });
  const started = now();

  // ① config. A present-but-bad section is `failed` (fail-closed); absent/disabled is `not-evaluated`.
  if (opts.configError) return fact("failed", { ...base, enabled: false }, `config invalid — ${opts.configError} (nothing spawned)`);
  if (!opts.configPresent || !opts.config || opts.config.enabled === false) {
    return fact("not-evaluated", { ...base, enabled: false }, "disabled: loop.open_semantic_discovery section absent or enabled:false — nothing spawned");
  }
  const config = opts.config;

  // ② halt gates the SPAWN (model calls / pin materialisation), never the routine track.
  if (opts.halted) return fact("not-evaluated", { ...base, enabled: true }, "halted: open-semantic-discovery spawn suppressed (halt gates the spawn, not the routine track) — nothing spawned");

  // ③ the carrier must be readable BEFORE anything runs: the due basis is read FROM it, and an unreadable
  //    carrier is NEVER shaped like "0 previous rounds" (硬规则 3b).
  let carrierRounds: Record<string, unknown>[];
  try {
    carrierRounds = readCarrierRounds(carrier).records;
  } catch (e) {
    return fact("failed", { ...base, enabled: true }, `unreadable carrier — ${(e as Error).message} (nothing appended)`);
  }

  // ③a the effective interval: an expired `interval_until` reverts to the permanent default, re-derived
  //     EVERY round so a driver holding the old RoutineSpec in memory cannot keep a stale cadence alive.
  const declaredMinutes = typeof config.trigger.minutes === "number" ? config.trigger.minutes : DEFAULT_INTERVAL_MINUTES;
  const intervalReverted = config.intervalUntil !== null && started >= config.intervalUntil;
  const intervalMinutes = intervalReverted ? DEFAULT_INTERVAL_MINUTES : declaredMinutes;
  const intervalUntilIso = config.intervalUntil === null ? null : new Date(config.intervalUntil).toISOString();
  const revertedNote = intervalReverted
    ? ` (the temporary interval_until ${intervalUntilIso} has passed ⇒ the ${DEFAULT_INTERVAL_MINUTES}m default applies)`
    : "";
  const intervalInfo = { minutes: intervalMinutes, declared_minutes: declaredMinutes, reverted: intervalReverted, until: intervalUntilIso };

  // ③b the due basis: when PRODUCTION last really ran. Preferred = the newest `invoked_by:"resident-driver"`
  //     scan-round on the carrier; fallback = a RESIDENT-STAMPED last-run entry. An unstamped legacy entry
  //     grants no window (it cannot say who wrote it) and is recorded as ignored, never edited.
  let residentTs: number | null = null;
  try {
    residentTs = latestResidentRoundTs(carrierRounds);
  } catch (e) {
    return fact("failed", { ...base, enabled: true }, `unreadable due basis — ${(e as Error).message} (nothing appended)`);
  }
  const lastRunMap = readLastRunMap(lastRunPath) as Record<string, unknown>;
  const lastRunValue = Number(lastRunMap[OPEN_SEMANTIC_DISCOVERY_NAME]);
  const lastRunUsable = Number.isFinite(lastRunValue) && lastRunValue > 0;
  let last: number | null;
  let dueSource: "carrier" | "last-run-stamped" | "none";
  let dueBasis: string;
  let legacyIgnored: number | null = null;
  if (residentTs !== null) {
    last = residentTs;
    dueSource = "carrier";
    dueBasis = `carrier: latest invoked_by:${INVOKED_BY_RESIDENT} scan-round at ${new Date(residentTs).toISOString()}`;
  } else if (isResidentStamped(lastRunMap, OPEN_SEMANTIC_DISCOVERY_NAME) && lastRunUsable) {
    last = lastRunValue;
    dueSource = "last-run-stamped";
    dueBasis = `routine-last-run.json: resident-stamped entry ${lastRunValue}`;
  } else {
    last = null;
    dueSource = "none";
    if (lastRunUsable) {
      legacyIgnored = lastRunValue;
      dueBasis = `routine-last-run.json holds ${lastRunValue}, but it carries no invoked_by:${INVOKED_BY_RESIDENT} stamp and the carrier has no resident-driver round, so it is a legacy/unattributed entry and is IGNORED for due-computation`;
    } else {
      dueBasis = `no invoked_by:${INVOKED_BY_RESIDENT} scan-round on the carrier and no usable routine-last-run.json entry`;
    }
  }
  const dueInfo = { source: dueSource, basis: dueBasis, last_resident_run: residentTs === null ? null : new Date(residentTs).toISOString(), legacy_ignored: legacyIgnored };
  const legacyNote = legacyIgnored === null ? "" : ` (the legacy .quay/routine-last-run.json entry ${legacyIgnored} was NOT written by the resident driver and is ignored for due-computation)`;

  const due = isDue({ kind: "interval", minutes: intervalMinutes }, { now: started, lastRun: last === null ? NaN : last });
  const forcedPastDue = !due && force;
  if (!due && !forcedPastDue) {
    const agoMin = last === null ? null : Math.round((started - last) / 60_000);
    return fact(
      "not-evaluated",
      { ...base, enabled: true, interval: intervalInfo, due: dueInfo, minutesSinceLastRun: agoMin },
      `not due: ${agoMin === null ? "never ran (should be due — check the clock)" : `ran ${agoMin}m ago`} within the ${intervalMinutes}m interval — nothing spawned${revertedNote}${legacyNote}${resident ? "" : " (manual round: `--force` runs one anyway; the interval is production's, and last-run stays put either way)"}`,
    );
  }

  // ③c the two 24h ceilings. The pre-round reading is an OPTIMIZATION and a REPORT — it lets a fully
  //     exhausted round refuse without even loading the engine — while the AUTHORITY is the reservation
  //     taken inside `reservingStep` before each spawn, which is what a concurrent second process cannot
  //     get past. Both ceilings are consulted here so a workspace at EITHER ceiling refuses before work.
  const budget: ModelBudget = openModelBudget({ root, cap: config.maxModelCallsPer24h, ledgerPath, lockPath, carrierPath: carrier, now });
  let callsUsage: BudgetUsage;
  let usdUsage: ReturnType<typeof usdBudgetUsage>;
  try {
    callsUsage = await budget.usage();
    usdUsage = usdBudgetUsage({ ledgerRecords: readLedgerRecords(ledgerPath).records, nowMs: now(), windowMs: budget.windowMs, perCallCeiling: PER_CALL_USD_CEILING });
  } catch (e) {
    return fact("failed", { ...base, enabled: true, interval: intervalInfo, due: dueInfo }, `unreadable 24h budget — ${(e as Error).message} (nothing appended)`);
  }
  const countBudgetBlock = { cap: config.maxModelCallsPer24h, used: callsUsage.total, reservations: callsUsage.reservations, legacy_model_calls: callsUsage.legacy_model_calls, window_ms: budget.windowMs };
  const usdBudgetBlock = { cap: config.maxUsdPer24h, used: usdUsage.usd, priced: usdUsage.priced, estimated: usdUsage.estimated, per_call_ceiling: PER_CALL_USD_CEILING, window_ms: budget.windowMs };
  if (callsUsage.total >= config.maxModelCallsPer24h) {
    return fact(
      "not-evaluated",
      { ...base, enabled: true, interval: intervalInfo, due: dueInfo, budget_24h: countBudgetBlock, budget_usd_24h: usdBudgetBlock },
      `budget-24h: ${callsUsage.total} model call(s) in the trailing 24h >= max_model_calls_per_24h ${config.maxModelCallsPer24h} — nothing spawned (the routine is held back by its declared ceiling, not idle)${revertedNote}${legacyNote}`,
    );
  }
  if (usdUsage.usd >= config.maxUsdPer24h) {
    return fact(
      "not-evaluated",
      { ...base, enabled: true, interval: intervalInfo, due: dueInfo, budget_24h: countBudgetBlock, budget_usd_24h: usdBudgetBlock },
      `budget-usd-24h: $${usdUsage.usd} in the trailing 24h >= max_usd_per_24h $${config.maxUsdPer24h} (${usdUsage.priced} priced, ${usdUsage.estimated} at the $${PER_CALL_USD_CEILING} per-call ceiling) — nothing spawned${revertedNote}${legacyNote}`,
    );
  }

  // ④ the engine modules, resolved from DISK (never a static import: see the header). A resolution failure
  //    is this round's `failed`, named — never a silent zero.
  let modules: OpenDiscoveryModules;
  try {
    modules = opts.modules ?? (await loadOpenDiscoveryModules(root));
  } catch (e) {
    return fact("failed", { ...base, enabled: true, interval: intervalInfo, due: dueInfo }, `engine modules unresolved — ${(e as Error).message} (nothing appended, last-run not advanced)`);
  }
  const hyp = modules.hyp;
  const launch = opts.launchArgvFn ?? (launchArgv as unknown as (role: string, prompt: string, root: string, opts?: Record<string, unknown>) => string[]);
  const spawn = opts.spawnFn ?? spawnModelCall;
  const buildArgv = (prompt: string, r: string, o: { tools: string; maxTurns: number | null; outputFormat: string | null; model: string | null }): string[] =>
    hyp.hardenedArgv(launch, prompt, r, o as Record<string, unknown>);
  const breached = () => now() - started >= config.maxWallMs;

  // ④b METHOD SELECTION — which Discovery Methods may guide this round, and in which arm. ⛔ This is a
  //     READ plus a POLICY: it never decides whether the round runs (a selection failure is reported and
  //     the round proceeds BASELINE), and no mechanical change here can suppress a semantic round.
  const selection = selectMethodsForRound(root, modules);
  const selectionBlock = {
    mode: selection.mode,
    baseline_reason: selection.baseline_reason,
    ok: selection.ok,
    unavailable_reason: selection.unavailable_reason,
    evaluated: selection.evaluated,
    included: selection.included,
    excluded: selection.excluded,
    registry: selection.registry,
  };

  // ④c THE PAIRED-GAIN DECISION (Plan item 1, AC (f)): is THIS eligible round the M-th one? The ordinal
  //     is counted off the CARRIER (resident scan-rounds that actually ran guided), never off a counter
  //     in memory — a counter would restart at 0 after a driver restart and re-run the pair early.
  //     ⛔ No eligible method ⇒ no paired round at all, and the decision says so with its own token
  //     (`not-evaluated:no-eligible-method`) rather than a zero gain (Plan item 5).
  const pairedDecision = pairedRoundDecision({
    eligibleRounds: eligibleRoundsOf(carrierRounds),
    gainEveryRounds: config.gainEveryRounds,
    eligibleMethods: selection.production.length,
  });

  // ⑤ (a) pin the current develop tip into a STRIPPED tree, then build the inventory over the declared
  //    scope. BOTH are recorded; NEITHER is a gate. See step ⑥ for why.
  const rev = (opts.revFn ?? developTip)(root);
  const pinTmp = opts.pinTmpRoot ?? process.env[PIN_TMP_ENV] ?? os.tmpdir();
  const pinDir = fs.mkdtempSync(path.join(pinTmp, `osd-pin-${rev.slice(0, 8)}-`));
  const pinFn = opts.pinFn ?? ((o: { root: string; rev: string; dir: string }): PinResult =>
    materializeStrippedPin({ ...o, forbiddenDirs: hyp.PIN_FORBIDDEN_DIRS, stripCheck: (d) => hyp.verifyCwdRefusal(d, d) }));
  const pin = pinFn({ root, rev, dir: pinDir });
  if (!pin.ok) {
    return fact("failed", { ...base, enabled: true, interval: intervalInfo, due: dueInfo }, `pin refused — ${pin.reason} (nothing appended, last-run not advanced)`);
  }
  const pinned = pin.dir;
  // The inventory is an OPTIONAL MAP. Its construction is best-effort ON PURPOSE: an empty, missing or
  // unbuildable inventory is recorded as such and the semantic round runs anyway (硬规则: a mechanical
  // input must never be the thing that decides whether the model may look).
  const inventory: Record<string, unknown> = (() => {
    try {
      const scriptsDir = path.join(pinned, INVENTORY_SCOPE_REL);
      const files = fs.readdirSync(scriptsDir).filter((f) => f.endsWith(".ts"));
      if (files.length === 0) return { ok: true, entries: 0, text: "", unavailable: "NO_FILES_IN_SCOPE" };
      let catalog = "";
      try {
        catalog = execFileSync("bash", [path.join(scriptsDir, "capability-catalog.sh")], { cwd: pinned, encoding: "utf8", maxBuffer: 1 << 26 });
      } catch { /* a catalog that cannot be built leaves the inventory's `q` fields empty; it is not fatal */ }
      const built = hyp.buildInventory({
        files,
        readSource: (f: string) => fs.readFileSync(path.join(scriptsDir, f), "utf8"),
        catalog,
        scope: INVENTORY_SCOPE_REL,
      });
      return { ok: true, entries: Array.isArray(built.entries) ? built.entries.length : 0, text: String(built.text ?? ""), sha256: built.sha256 ?? null, unavailable: null };
    } catch (e) {
      return { ok: false, entries: 0, text: "", unavailable: `INVENTORY_UNAVAILABLE:${(e as Error).message}` };
    }
  })();
  if (breached()) {
    return fact("failed", { ...base, enabled: true, interval: intervalInfo, due: dueInfo }, `budget breach — wall ${now() - started}ms >= max_wall_ms ${config.maxWallMs} after the pin (nothing appended, last-run not advanced)`);
  }

  // ── the reserving step seam ────────────────────────────────────────────────────────────────────────
  // Every subprocess goes: reserve (durable, atomic, BEFORE the spawn) → build argv → spawn → record the
  // outcome and the realized price. A refusal THROWS, so a step cannot spend a call the ledger did not
  // grant; a failure/timeout still records an outcome, so the call stays counted.
  const grantedIds: string[] = [];
  const callRecords: Record<string, unknown>[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  let costUsd = 0;

  async function reservingStep(kind: ModelStepKind, payload: { prompt: string; tools: string; maxTurns: number; model: string | null }): Promise<Record<string, unknown>> {
    const r = await budget.reserve({ step: kind, tools: payload.tools, max_turns: payload.maxTurns });
    if (!r.ok) throw new BudgetRefusedError(r.used, r.cap, kind);
    grantedIds.push(r.id);
    const { argv, maxTurns, tools } = stepArgv(buildArgv, payload.prompt, root, { tools: payload.tools, maxTurns: payload.maxTurns, model: payload.model });
    let res: { status: number | null; stdout: string; stderr: string; error: Error | null };
    try {
      res = await spawn(argv, { cwd: pinned, timeoutMs: Math.max(1_000, config.maxWallMs), stdinData: payload.prompt });
    } catch (e) {
      budget.outcome(r.id, classifyModelFailure(e), null, `CALL_THREW:${(e as Error)?.name ?? "Error"}`);
      throw e;
    }
    const { turns } = readRealizedTurns(res?.stdout, (s: string) => hyp.parseVerifierStream(s));
    budget.outcome(r.id, res.error ? classifyModelFailure(res.error) : "completed", turns, res.error ? "SPAWN_ERROR" : null);
    // The realized price: the gateway rate applied to the stream's own usage when BOTH are readable, else
    // NULL — and NULL counts as the per-call ceiling in `usdBudgetUsage`, never as free.
    const stream = hyp.parseVerifierStream(String(res?.stdout ?? ""));
    const usage = stream.ok && stream.usage && typeof stream.usage === "object" ? (stream.usage as Record<string, unknown>) : null;
    const servedModel = stream.ok && typeof stream.model === "string" && stream.model !== "" ? stream.model : null;
    let realized: number | null = null;
    let costSource = "per-call-ceiling";
    if (usage !== null && servedModel !== null) {
      const rates = modules.portfolio.loadGatewayRates({ modelGroup: servedModel });
      if (rates.ok) {
        const derived = modules.portfolio.deriveCost({
          model_group: servedModel,
          model_calls: 1,
          input_tokens: Number(usage.input_tokens ?? 0),
          output_tokens: Number(usage.output_tokens ?? 0),
          cache_read_tokens: Number(usage.cache_read_input_tokens ?? 0),
          cache_creation_tokens: Number(usage.cache_creation_input_tokens ?? 0),
        }, rates.rates);
        if (derived.ok && derived.cost && typeof derived.cost.usd_gateway === "number") {
          realized = derived.cost.usd_gateway as number;
          costSource = "gateway-rates";
        }
      }
    }
    appendLedgerRecords(ledgerPath, [{ kind: "cost", id: r.id, ts: new Date(now()).toISOString(), pid: process.pid, step: kind, cost_usd: realized, cost_source: costSource, model: servedModel }]);
    const charged = realized === null ? PER_CALL_USD_CEILING : realized;
    costUsd += charged;
    tokensIn += Number(usage?.input_tokens ?? 0);
    tokensOut += Number(usage?.output_tokens ?? 0);
    const rec = {
      step: kind, tools, max_turns: maxTurns, argv_tools_index: argv.indexOf("--tools"), cwd: asRel(root, pinned),
      exit: res?.status ?? null, spawn_error: res?.error ? String(res.error.message ?? res.error).slice(0, 200) : null,
      turns, actual_model: servedModel ?? "not-evaluated:model-unverified",
      tokens: { input: Number(usage?.input_tokens ?? 0), output: Number(usage?.output_tokens ?? 0) },
      cost_usd: realized, cost_source: costSource, cost_charged_usd: charged,
    };
    callRecords.push(rec);
    return { res, stream, argv, rec };
  }

  // ⑥ (b) SEMANTIC EXPLORATION ON REAL SOURCE. The investigator runs with Read/Grep/Glob rooted at the
  //    pinned tree and an explicit `--max-turns`, so it reads code and context itself. The inventory is
  //    passed as an optional map — appended to the prompt, never used to select or reject anything.
  const focuses = priorFocuses(carrierRounds);
  // The model the LAUNCHER was asked for, read off a throwaway argv built the same way a real call's is —
  // `launchArgv` bakes the resolved `--model` in, so this is the requested identity rather than a guess
  // copied from the stream (which is the ACTUAL one and is read per call).
  const requestedModel = (() => {
    try {
      const probe = buildArgv("", root, { tools: "", maxTurns: BLIND_INVESTIGATOR_MAX_TURNS, outputFormat: null, model: null });
      const i = probe.indexOf("--model");
      return i >= 0 && typeof probe[i + 1] === "string" ? probe[i + 1] : null;
    } catch { return null; }
  })();
  let midRound: { kind: ModelStepKind; used: number; cap: number } | null = null;
  let investigatorBlock: Record<string, unknown> = { ran: false };
  let clusters: Array<Record<string, unknown>> = [];
  try {
    let verifierPromptText = "";
    try {
      verifierPromptText = fs.readFileSync(hyp.defaultVerifierPrompt(), "utf8");
    } catch (e) {
      return fact("failed", { ...base, enabled: true, interval: intervalInfo, due: dueInfo }, `verifier prompt unreadable — ${(e as Error).message} (nothing appended, last-run not advanced)`);
    }
    // The FROZEN investigator prompt (the hypothesis-generation instruction). Its own file stays
    // byte-identical — this routine PREPENDS a focus directive to it rather than editing it. When a
    // method was selected, its guidance block is prepended BETWEEN the focus directive and the frozen
    // instruction: guidance first, instruction second, and the instruction never modified.
    const basePrompt = fs.readFileSync(hyp.defaultInvestigatorPrompt(), "utf8");
    // ⛔ The MAP is identical for both arms: the inventory is the pin's own index, and a paired round
    // whose arms read different maps would be comparing two experiments rather than two prompts. Only
    // the guidance block BETWEEN the focus directive and the frozen instruction differs.
    const inventoryText = inventory.ok === true ? String(inventory.text ?? "") : "";
    // ONE instant for the round: it is the scan-round's `ts` AND the first half of every cluster's
    // `record_id`, so a cluster is addressable by `<round>#<index>` without a second identity scheme.
    const roundTs = new Date(now()).toISOString();

    // The two arms' prompts, built ONCE and shared with the pre-registration below, so the bytes that
    // are hashed are the bytes that are handed to the model rather than a recomputation of them.
    const armPrompts: Record<PairedArm | "guided", string> = {
      [PAIRED_ARM_GUIDED]: `${focusDirective(focuses)}\n${selection.production_text}${basePrompt}\n\n${inventoryText}`,
      [PAIRED_ARM_BASELINE]: `${focusDirective(focuses)}\n${basePrompt}\n\n${inventoryText}`,
    };
    // The instant the PAIRED round's FIRST call began. The pre-registration below is judged against it:
    // a pre-registration that is not strictly older than the first call it scores is a post-hoc
    // rationalisation (Plan item 2). `null` until that call happens — and a paired round that never
    // reached a call has nothing for the pre-registration to precede, which is its own refusal.
    let firstPairedCallMs: number | null = null;

    // ── ONE ARM'S WHOLE PIPELINE ─────────────────────────────────────────────────────────────────────
    // The paired instrument runs the SAME exploration twice, so the pipeline is written ONCE and
    // parameterised by the arm: the investigator prompt (the only intended difference), the method
    // attribution stamped on each cluster, the record-id mint, and the reservation step KINDS (so the
    // ledger says which arm spent a call rather than leaving it to be inferred from call order).
    // ⛔ It is a closure over THIS round's pin, budget seam and model — not a second scheduler: it reads
    // no config and decides nothing about whether it should run.
    type ArmRun =
      | {
        ok: true;
        investigator: Record<string, unknown>;
        clusters: Record<string, unknown>[];
        verifiedRows: Record<string, unknown>[];
        clusterRecords: Record<string, unknown>[];
        novelty: NoveltyOutcome[];
        noveltyByCluster: Map<number, NoveltyOutcome>;
      }
      | { ok: false; reason: string };

    const runArm = async (spec: {
      arm: PairedArm | "guided";
      methodPicks: readonly MethodIncluded[];
      methodArm: MethodArm;
      /** The id mint for a cluster index. The BASELINE arm gets its own segment so a baseline record
       *  can never be resolved as a production one — the same discipline the shadow arm follows. */
      recordIdFor: (index: number) => string;
      /** `true` ⇒ this run is one arm of a paired round; the arm is stamped on every cluster record. */
      markPaired: boolean;
    }): Promise<ArmRun> => {
      const unguided = spec.arm === PAIRED_ARM_BASELINE;
      const armPrefix = unguided ? "baseline arm: " : "";
      const stepKind = (kind: "investigator" | "verifier" | "refuter" | "value-assessment" | "novelty-check"): ModelStepKind =>
        (unguided ? `baseline-${kind}` : kind) as ModelStepKind;
      const armStamp: Record<string, unknown> = spec.markPaired ? { paired: true, paired_arm: spec.arm } : {};
      const prompt = armPrompts[unguided ? PAIRED_ARM_BASELINE : PAIRED_ARM_GUIDED];
      const armTexts: string[] = [];
      const inv = await hyp.runInvestigator({
        prompt,
        // `neutralDir` is unused on the pinned path (the cwd gate switches to `verifyCwdRefusal`); it is
        // passed equal to the pin so BOTH gates agree on which tree this is.
        neutralDir: pinned,
        cwd: pinned,
        pinDir: pinned,
        runs: config.investigatorRuns,
        // A separate runs directory per arm: the unguided pass must not overwrite the guided pass's runs.
        outDir: unguided
          ? path.join(pinned, ".open-semantic-discovery-runs", PAIRED_ARM_BASELINE)
          : path.join(pinned, ".open-semantic-discovery-runs"),
        writeFile: (f: string, t: string) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t, "utf8"); },
        budget: { maxRuns: config.investigatorRuns, maxMs: config.maxWallMs },
        model: requestedModel ?? "not-evaluated:model-unverified",
        tools: INVESTIGATOR_TOOLS,
        maxTurns: config.investigatorMaxTurns,
        runModel: async (p: string) => {
          if (spec.markPaired && firstPairedCallMs === null) firstPairedCallMs = now();
          const { res } = await reservingStep(stepKind("investigator"), { prompt: p, tools: INVESTIGATOR_TOOLS, maxTurns: config.investigatorMaxTurns, model: requestedModel });
          armTexts.push(hyp.callText(String(res?.stdout ?? "")));
          return res;
        },
      });
      if (inv.ok !== true) {
        const reasons = Array.isArray(inv.reasons) ? (inv.reasons as string[]) : [];
        return { ok: false, reason: `${armPrefix}investigator refused — ${reasons[0] ?? "no reason reported"} (nothing appended, last-run not advanced)` };
      }
      const records = Array.isArray(inv.records) ? (inv.records as Record<string, unknown>[]) : [];
      const statedFocus = armTexts.map((t) => focusFromText(t)).find((f) => typeof f === "string" && f !== "") ?? null;
      const investigator = {
        ran: true, runs: config.investigatorRuns, runs_with_hypotheses: Number(inv.parsed ?? 0),
        tools: INVESTIGATOR_TOOLS, max_turns: config.investigatorMaxTurns, cwd: asRel(root, pinned),
        stated_focus: statedFocus, prior_focuses: focuses,
        guided_by: spec.methodPicks.map((m) => methodLabel(m)),
      };
      // (b, cont.) `clusterHypotheses` merges near-duplicates ACROSS the runs by component-set overlap. It
      // is dedup ASSISTANCE ONLY — nothing here discards a cluster by shape, and the cap below is a COUNT.
      const armClusters = hyp.clusterHypotheses(records, {});
      if (breached()) {
        return { ok: false, reason: `${armPrefix}budget breach — wall ${now() - started}ms >= max_wall_ms ${config.maxWallMs} after the investigator (nothing appended, last-run not advanced)` };
      }

    // ⑦ (c) VERIFY at most K clusters, with Read,Grep on the pin and an explicit turn budget.
    let verification: Record<string, unknown> = { verified: 0, results: [] };
    if (armClusters.length > 0) {
      const v = await hyp.runVerifier({
        clusters: armClusters, pinDir: pinned, cwd: pinned, promptTemplate: verifierPromptText,
        maxClusters: config.maxClustersVerified, concurrency: 1, maxMs: config.maxWallMs, // concurrency-default-fallback: ONE verifier call at a time — the engine can fan out, but concurrent calls reserve from several places at once and the per-step cost ledger stops being readable in call order
        strategy: "default", onlyCluster: null, evidence: null, model: requestedModel,
        runModel: async (p: string) => {
          const { res } = await reservingStep(stepKind("verifier"), { prompt: p, tools: VERIFIER_TOOLS, maxTurns: config.verifierMaxTurns, model: requestedModel });
          return res;
        },
      });
      if (v.ok !== true) {
        const reasons = Array.isArray(v.reasons) ? (v.reasons as string[]) : [];
        return { ok: false, reason: `${armPrefix}verifier refused — ${reasons[0] ?? "no reason reported"} (nothing appended, last-run not advanced)` };
      }
      verification = v;
    }
    const verifiedRows = Array.isArray(verification.results) ? (verification.results as Record<string, unknown>[]) : [];

    // ⑧ (d) INDEPENDENT REFUTATION. Each `supported` cluster gets a SEPARATE fresh-context call whose ONLY
    //    input is the claim and the components — it never sees the first verifier's reasoning. A cluster is
    //    reported `confirmed` ONLY if it survives.
    const clusterRecords: Record<string, unknown>[] = [];
    for (const row of verifiedRows) {
      const idx = Number(row.cluster ?? 0);
      const cluster = armClusters[idx - 1] ?? null;
      const rep = (cluster?.rep ?? {}) as Record<string, unknown>;
      const entry: Record<string, unknown> = {
        kind: "cluster",
        routine: OPEN_SEMANTIC_DISCOVERY_NAME,
        invoked_by: invokedBy,
        ts: new Date(now()).toISOString(),
        // The record's OWN id — the ref the Portfolio resolves its `origin_ref` by, and the back-pointer an
        // Experience's `source_ref` carries. Minted here, once, so both readers agree by construction.
        record_id: spec.recordIdFor(idx),
        cluster: idx,
        members: row.members ?? cluster?.members ?? [],
        concept_kind: rep.concept_kind ?? null,
        claim: rep.claim ?? row.claim ?? null,
        components: rep.components ?? [],
        verifier_verdict: row.verdict ?? null,
        verifier_cause: row.verdict_cause ?? null,
        evidence_lines: Array.isArray(row.evidence) ? row.evidence : [],
        actual_model: row.actual_model ?? null,
        turns: row.turns_used ?? null,
        cost_usd: row.cost_usd ?? null,
        // WHICH METHOD GUIDED THIS CLUSTER (null for a baseline round). It is the link the post-round
        // ingestion turns into the Experience's own attribution, so "which method produced this outcome"
        // is answerable from the record rather than reconstructed from the round's mode.
        method_guidance: methodGuidanceBlock(spec.methodPicks, spec.methodArm),
        // WHICH ARM of a paired round produced this cluster. Absent on an ordinary round, so an
        // existing scan-round's records are byte-identical to what they were before pairing existed.
        ...armStamp,
      };
      let refutation: Record<string, unknown> | null = null;
      if (row.verdict === "supported") {
        const one = await hyp.runVerifier({
          clusters: [cluster], pinDir: pinned, cwd: pinned, promptTemplate: REFUTATION_PROMPT_TEMPLATE,
          maxClusters: 1, concurrency: 1, maxMs: config.maxWallMs, strategy: "default", onlyCluster: 1, // concurrency-default-fallback: ONE cluster, ONE call
          evidence: null, model: requestedModel,
          runModel: async (p: string) => {
            const { res } = await reservingStep(stepKind("refuter"), { prompt: p, tools: REFUTER_TOOLS, maxTurns: config.refutationMaxTurns, model: requestedModel });
            return res;
          },
        });
        if (one.ok !== true) {
          const reasons = Array.isArray(one.reasons) ? (one.reasons as string[]) : [];
          return { ok: false, reason: `${armPrefix}refuter refused — ${reasons[0] ?? "no reason reported"} (nothing appended, last-run not advanced)` };
        }
        refutation = (Array.isArray(one.results) ? one.results[0] : null) as Record<string, unknown> | null;
        entry.refutation_verdict = refutation?.verdict ?? null;
        entry.refutation_counterexample = refutation?.counterexample ?? null;
        entry.refutation_turns = refutation?.turns_used ?? null;
        entry.refutation_cost_usd = refutation?.cost_usd ?? null;
      } else {
        entry.refutation_verdict = "not-run";
      }
      // `confirmed` REQUIRES surviving the refuter: an unrun, undetermined or refuted refutation is NOT a
      // confirmation (fail-closed — "we could not refute it" is not "it is true").
      const confirmed = row.verdict === "supported" && refutation?.verdict === "supported";
      entry.confirmed = confirmed;
      // ⑨ (d2) SEMANTIC VALUE ASSESSMENT — bounded, for confirmed clusters only, recorded as the MODEL's
      //    assessment and never as a human rating.
      if (confirmed) {
        const one = await hyp.runVerifier({
          clusters: [cluster], pinDir: pinned, cwd: pinned, promptTemplate: VALUE_PROMPT_TEMPLATE,
          maxClusters: 1, concurrency: 1, maxMs: config.maxWallMs, strategy: "default", onlyCluster: 1, // concurrency-default-fallback: ONE cluster, ONE call
          evidence: null, model: requestedModel,
          runModel: async (p: string) => {
            const { res } = await reservingStep(stepKind("value-assessment"), { prompt: p, tools: VALUE_TOOLS, maxTurns: config.refutationMaxTurns, model: requestedModel });
            return res;
          },
        });
        if (one.ok !== true) {
          const reasons = Array.isArray(one.reasons) ? (one.reasons as string[]) : [];
          return { ok: false, reason: `${armPrefix}value assessment refused — ${reasons[0] ?? "no reason reported"} (nothing appended, last-run not advanced)` };
        }
        const va = (Array.isArray(one.results) ? one.results[0] : null) as Record<string, unknown> | null;
        // The mapping is explicit because the shared verifier row is what parses the JSON: the template
        // asks for `intentional_difference_found` = impact, `evidence` = evidence, `counterexample` = fix
        // outline. Recording it under a name that says what it IS keeps it from reading as a human rating.
        entry.model_value_assessment = {
          impact: va?.intentional ?? null,
          evidence: va?.evidence ?? [],
          fix_outline: va?.counterexample ?? null,
          summary: va?.summary ?? null,
          turns: va?.turns_used ?? null,
          cost_usd: va?.cost_usd ?? null,
          assessed_by: "model",
        };
      }
      clusterRecords.push(entry);
      if (breached()) {
        return { ok: false, reason: `${armPrefix}budget breach — wall ${now() - started}ms >= max_wall_ms ${config.maxWallMs} during verification (nothing appended, last-run not advanced)` };
      }
    }

    // ⑨b THE NOVELTY CHECK — the ONE semantic call that decides whether a CONFIRMED cluster is new. It runs
    //     HERE, before the carrier append, for two reasons: (i) a budget refusal must be handled by the
    //     round's own refusal path rather than after the round is already on disk, and (ii) the verdicts
    //     belong ON the scan-round line, where a reviewer reads what the round found and what it decided.
    //     ⛔ The WRITES happen after the append (step ⑩b) — a Portfolio `origin_ref` must resolve against a
    //     carrier record that is really there.
    // A SHADOW cluster is never a prior production cluster: the mechanical dedup below compares against
    // this routine's own earlier PRODUCTION records, and a draft method's unverified hypothesis must not
    // make a production finding look like a repeat of something already seen.
    // A SHADOW cluster is never a prior production cluster, and neither is a PAIRED round's BASELINE
    // arm: both are measurement records, and letting one make a production finding look like a repeat of
    // something already seen would delete a finding on the strength of a measurement.
    const priorClusterRecords = carrierRounds.filter((r) =>
      r.kind === "cluster" && r.invoked_by === INVOKED_BY_RESIDENT && r.shadow !== true && r.paired_arm !== PAIRED_ARM_BASELINE);
    const noveltyOutcomes: NoveltyOutcome[] = [];
    const noveltyByCluster = new Map<number, NoveltyOutcome>();
    for (const c of clusterRecords) {
      if (c.confirmed !== true) continue;
      const idx = Number(c.cluster ?? 0);
      const recordId = String(c.record_id ?? "");
      const comps = Array.isArray(c.components) ? (c.components as string[]) : [];
      const claim = typeof c.claim === "string" ? c.claim : "";
      // The ONE mechanical LABEL, and it is only ever about this routine's OWN earlier record.
      const repeat = findMechanicalRepeat(priorClusterRecords, { components: comps, claim, recordId, portfolio: modules.portfolio });
      if (repeat !== null) {
        const outcome: NoveltyOutcome = {
          cluster: idx, record_id: recordId, disposition: "mechanical-duplicate",
          verdict: null, duplicate_of: String(repeat.record_id), reasoning: "byte-identical component set AND claim to this routine's own earlier cluster record — deduped mechanically, nothing written to either ledger",
          summary: null, retrieved: 0, broad: 0, calls: 0, cost_usd: null,
          retrieval: { totals: {}, absent: [], errors: [], broad_truncated: false, mechanical_duplicate_of: String(repeat.record_id) },
        };
        noveltyOutcomes.push(outcome);
        noveltyByCluster.set(idx, outcome);
        continue;
      }
      const retrieval = retrieveNoveltyCandidates(root, {
        components: comps, claim, portfolio: modules.portfolio, ledger: modules.ledger,
      });
      const prompt = buildNoveltyPrompt({
        claim, components: comps,
        evidence: Array.isArray(c.evidence_lines) ? (c.evidence_lines as string[]) : [],
        candidates: retrieval.candidates, broad: retrieval.broad, broadTruncated: retrieval.broad_truncated,
      });
      const { res, rec: callRec } = await reservingStep(stepKind("novelty-check"), {
        prompt, tools: NOVELTY_TOOLS, maxTurns: config.refutationMaxTurns, model: requestedModel,
      });
      const parsed = parseNoveltyVerdict(hyp.parseJsonObject(hyp.callText(String(res?.stdout ?? ""))));
      // A `duplicate` verdict is only usable when the record it names is a candidate that RESOLVES on the
      // write path. Naming anything else is DOWNGRADED to `restatement` — recorded, never silently
      // rewritten — because the alternative is either an invented `duplicate_of` or a row that counts as
      // new (硬规则 3b).
      let disposition: NoveltyDisposition;
      let duplicateOf: string | null = null;
      if (parsed === null) disposition = "unjudged";
      else if (parsed.verdict === "novel") disposition = "novel";
      else if (parsed.verdict === "duplicate") {
        const target = retrieval.candidates.find((x) => x.ref === parsed.duplicate_of && x.duplicate_target);
        if (target) { disposition = "duplicate"; duplicateOf = target.ref; }
        else disposition = "restatement";
      } else disposition = "restatement";
      const outcome: NoveltyOutcome = {
        cluster: idx, record_id: recordId, disposition,
        verdict: parsed?.verdict ?? null,
        duplicate_of: duplicateOf ?? parsed?.duplicate_of ?? null,
        reasoning: parsed?.reasoning ?? null,
        summary: parsed?.summary ?? null,
        retrieved: retrieval.candidates.length, broad: retrieval.broad.length, calls: 1,
        cost_usd: typeof callRec.cost_charged_usd === "number" ? (callRec.cost_charged_usd as number) : null,
        retrieval: {
          totals: retrieval.totals, absent: retrieval.absent, errors: retrieval.errors,
          broad_truncated: retrieval.broad_truncated, mechanical_duplicate_of: null,
        },
      };
      noveltyOutcomes.push(outcome);
      noveltyByCluster.set(idx, outcome);
      if (breached()) {
        return { ok: false, reason: `${armPrefix}budget breach — wall ${now() - started}ms >= max_wall_ms ${config.maxWallMs} during the novelty check (nothing appended, last-run not advanced)` };
      }
    }
    return { ok: true, investigator, clusters: armClusters, verifiedRows, clusterRecords, novelty: noveltyOutcomes, noveltyByCluster };
    };

    // ── THE PRE-REGISTRATION (Plan item 2), WRITTEN BEFORE THE FIRST CALL ────────────────────────────
    // Each arm's prompt digest, the inventory hash and the budget digest go to disk BEFORE any call, so
    // that the comparison is a DECLARATION rather than a description written after the fact. Only a
    // paired round has one: an ordinary round has no second arm to bind.
    const preregBlock: { path: string | null; mtime_ms: number | null; keys: string[]; expected: Record<string, string>; body: Record<string, unknown> | null; refusal: string | null } = {
      path: null, mtime_ms: null, keys: [], expected: {}, body: null, refusal: null,
    };
    // ⛔ A round that is merely NOT the M-th one is not "not evaluated" — it was never an instrument.
    // Only a round that COULD have measured and could not carries a token, so the rolling summary's
    // not-evaluated counts cannot be inflated by ordinary rounds (Plan item 5).
    let pairedNotEvaluated: string | null = !pairedDecision.due && pairedDecision.reason === PAIRED_NOT_EVALUATED_NO_ELIGIBLE_METHOD
      ? PAIRED_NOT_EVALUATED_NO_ELIGIBLE_METHOD
      : null;
    const pairedEnvelope = pairedArmBudget(config);
    if (pairedDecision.due) {
      // ⛔ AC (a) in production form: the two arms are ENVELOPES read from ONE config, and they are
      // compared before either runs. A future path that handed one arm a different envelope would be
      // refused here rather than recorded as a comparison it never was.
      const budgetRefusal = pairedBudgetRefusal(pairedEnvelope, pairedArmBudget(config));
      if (budgetRefusal) {
        return fact("failed", { ...base, enabled: true, interval: intervalInfo, due: dueInfo }, `paired round refused — ${budgetRefusal.reasons.join("; ")} (nothing appended, last-run not advanced)`);
      }
      const keys = pairedPreregKeys({
        baselinePrompt: sha256Of(armPrompts[PAIRED_ARM_BASELINE]),
        guidedPrompt: sha256Of(armPrompts[PAIRED_ARM_GUIDED]),
        inventory: sha256Of(inventoryText),
        budget: sha256Of(JSON.stringify(pairedEnvelope)),
      });
      const preregPath = path.join(root, PREREG_REL);
      const body: Record<string, unknown> = {
        kind: "open-discovery-prereg",
        routine: OPEN_SEMANTIC_DISCOVERY_NAME,
        ts: new Date(now()).toISOString(),
        eligible_round_ordinal: pairedDecision.ordinal,
        every_rounds: config.gainEveryRounds,
        pin_rev: rev,
        arms: [...PAIRED_ARMS],
        budget: pairedEnvelope,
        hashes: keys,
      };
      try {
        fs.mkdirSync(path.dirname(preregPath), { recursive: true });
        fs.writeFileSync(preregPath, `${JSON.stringify(body, null, 1)}\n`, "utf8");
        preregBlock.path = asRel(root, preregPath);
        preregBlock.mtime_ms = fs.statSync(preregPath).mtimeMs;
      } catch (e) {
        return fact("failed", { ...base, enabled: true, interval: intervalInfo, due: dueInfo }, `pre-registration could not be written — ${(e as Error).message} (nothing appended, last-run not advanced)`);
      }
      preregBlock.keys = Object.keys(keys).sort();
      preregBlock.expected = keys;
      preregBlock.body = body;
    }

    // ⑥ (b) SEMANTIC EXPLORATION ON REAL SOURCE — the GUIDED arm (this round's production arm). It is
    //    the round's own work whether or not a paired round is due; when one IS due, this run is the
    //    pair's `guided` arm and the unguided baseline arm runs beside it on the same pin.
    const guidedRun = await runArm({
      arm: "guided",
      methodPicks: selection.production,
      methodArm: METHOD_ARM_PRODUCTION,
      recordIdFor: (i: number) => openDiscoveryRecordId(roundTs, i),
      markPaired: pairedDecision.due,
    });
    if (!guidedRun.ok) {
      return fact("failed", { ...base, enabled: true, interval: intervalInfo, due: dueInfo }, guidedRun.reason);
    }
    investigatorBlock = guidedRun.investigator;
    clusters = guidedRun.clusters;
    const verifiedRows = guidedRun.verifiedRows;
    const clusterRecords = guidedRun.clusterRecords;
    const noveltyOutcomes = guidedRun.novelty;
    const noveltyByCluster = guidedRun.noveltyByCluster;

    // ── THE UNGUIDED ARM OF A PAIRED ROUND (Plan items 1-3) ──────────────────────────────────────────
    // The SAME pin, the SAME inventory, the SAME model and the SAME budget envelope — only the
    // investigator prompt differs. ⛔ The baseline arm's clusters ride the carrier (marked
    // `paired_arm:"baseline"` with their own record-id segment) and are SCORED, but they reach NEITHER
    // the Experience ledger NOR the Portfolio: the instrument measures, it does not file. That is also
    // what keeps the two arms' novelty checks comparable — both read the PRE-round Portfolio, so
    // neither can be credited with a finding the other has just written.
    let baselineRun: ArmRun | null = null;
    let gainRecord: Record<string, unknown> | null = null;
    let pairedCounts: { baseline: PairedArmCounts; guided: PairedArmCounts } | null = null;
    if (pairedDecision.due) {
      baselineRun = await runArm({
        arm: PAIRED_ARM_BASELINE,
        methodPicks: [],
        methodArm: METHOD_ARM_PRODUCTION,
        recordIdFor: (i: number) => openBaselineDiscoveryRecordId(roundTs, i),
        markPaired: true,
      });
      // The pre-registration is re-read NOW, not trusted from before the arms: a declaration rewritten
      // during the round it scores is exactly what the mtime rule exists to catch.
      let preregNowMs: number | null = null;
      try { preregNowMs = fs.statSync(path.join(root, PREREG_REL)).mtimeMs; } catch { preregNowMs = null; }
      const preregResult = pairedPreregRefusal({
        prereg: preregBlock.body,
        preregMtimeMs: preregNowMs,
        expected: preregBlock.expected,
        armCallMtimesMs: firstPairedCallMs === null ? [] : [firstPairedCallMs],
        preregRefusalFn: hyp.preregRefusal,
      });
      if (preregResult) {
        // Recorded, never shaped as a gain: a pair whose declaration does not precede its own calls has
        // no measured gain to report, and reporting 0 would be the exact confusion Plan item 5 forbids.
        preregBlock.refusal = preregResult.reasons.join("; ");
        pairedNotEvaluated = `not-evaluated:prereg-${preregResult.reasons.join(",")}`;
      } else if (!baselineRun.ok) {
        pairedNotEvaluated = `not-evaluated:baseline-arm-${baselineRun.reason}`;
      } else {
        const baselineCounts = pairedArmCounts({
          arm: PAIRED_ARM_BASELINE,
          clusters: baselineRun.clusterRecords,
          novelty: armNoveltyRows(baselineRun.novelty),
          calls: callsOfArm(callRecords, PAIRED_ARM_BASELINE),
        });
        const guidedCounts = pairedArmCounts({
          arm: PAIRED_ARM_GUIDED,
          clusters: clusterRecords,
          novelty: armNoveltyRows(noveltyOutcomes),
          calls: callsOfArm(callRecords, PAIRED_ARM_GUIDED),
        });
        gainRecord = buildGainRecord({
          roundTs,
          invokedBy,
          pinRev: rev,
          inventorySha: typeof inventory.sha256 === "string" ? inventory.sha256 : null,
          prereg: { path: preregBlock.path, mtime_ms: preregBlock.mtime_ms, keys: preregBlock.keys, refusal: null },
          budget: pairedEnvelope,
          budgetLedgerRel: asRel(root, ledgerPath),
          baseline: baselineCounts,
          guided: guidedCounts,
          guidedBy: selection.production.map((m) => methodLabel(m)),
          ordinal: pairedDecision.ordinal,
          everyRounds: config.gainEveryRounds,
        });
        pairedCounts = { baseline: baselineCounts, guided: guidedCounts };
      }
    }

    // ⑨c THE SHADOW ARM (Plan item 1). A `draft`/`trial` method may NOT steer production, and it is not
    //     silently dropped either: it guides ONE extra, ISOLATED exploration pass on the same pin, whose
    //     records carry `shadow:true` and whose findings reach NEITHER the Portfolio NOR the Experience
    //     ledger. It is an arm, not a gate: its own refusal is recorded and the production round keeps
    //     what it did. ⛔ It reserves through the SAME `budget` object, so its calls count against the
    //     same trailing-24h ledger as every other step (there is no second budget to hide in).
    let shadowBlock: Record<string, unknown> = selection.shadow.length === 0
      ? {
        shadow: true, ran: false, methods: [], calls: 0, clusters: { total: 0, claims: [] },
        reason: selection.ok === false
          ? `not-run: the method registry could not be read (${selection.unavailable_reason})`
          : "not-run: no draft/trial method is eligible",
      }
      : { shadow: true, ran: true, methods: selection.shadow, calls: 0, clusters: { total: 0, claims: [] }, reason: null };
    let shadowClusters: Array<Record<string, unknown>> = [];
    let shadowClusterRecords: Record<string, unknown>[] = [];
    if (selection.shadow.length > 0) {
      const shadowPrompt = `${focusDirective(focuses)}\n${selection.shadow_text}${basePrompt}\n\n${inventory.ok === true ? String(inventory.text ?? "") : ""}`;
      let shadowCalls = 0;
      const shadowInv = await hyp.runInvestigator({
        prompt: shadowPrompt,
        neutralDir: pinned,
        cwd: pinned,
        pinDir: pinned,
        runs: config.investigatorRuns,
        // A separate runs directory: the shadow pass must not overwrite the production pass's run files.
        outDir: path.join(pinned, ".open-semantic-discovery-runs", "shadow"),
        writeFile: (f: string, t: string) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t, "utf8"); },
        budget: { maxRuns: config.investigatorRuns, maxMs: config.maxWallMs },
        model: requestedModel ?? "not-evaluated:model-unverified",
        tools: INVESTIGATOR_TOOLS,
        maxTurns: config.investigatorMaxTurns,
        runModel: async (p: string) => {
          const { res } = await reservingStep("shadow-investigator", { prompt: p, tools: INVESTIGATOR_TOOLS, maxTurns: config.investigatorMaxTurns, model: requestedModel });
          shadowCalls++;
          return res;
        },
      });
      if (shadowInv.ok !== true) {
        // RECORDED, not swallowed, and NOT fatal: an extra arm that could not run must not destroy the
        // production round's semantic work (硬规则 3b is about not faking a pass — this reports a
        // refusal in its own field, which is the opposite of faking one).
        const reasons = Array.isArray(shadowInv.reasons) ? (shadowInv.reasons as string[]) : [];
        shadowBlock = { ...shadowBlock, ran: false, calls: shadowCalls, reason: `refused:${reasons[0] ?? "no reason reported"}` };
      } else {
        const shadowRecords = Array.isArray(shadowInv.records) ? (shadowInv.records as Record<string, unknown>[]) : [];
        shadowClusters = hyp.clusterHypotheses(shadowRecords, {});
        shadowClusterRecords = shadowClusters.map((c, i) => {
          const rep = (c.rep ?? {}) as Record<string, unknown>;
          return {
            kind: "cluster",
            shadow: true,
            routine: OPEN_SEMANTIC_DISCOVERY_NAME,
            invoked_by: invokedBy,
            ts: new Date(now()).toISOString(),
            record_id: openShadowDiscoveryRecordId(roundTs, i + 1),
            cluster: i + 1,
            members: c.members ?? [],
            concept_kind: rep.concept_kind ?? null,
            claim: rep.claim ?? null,
            components: Array.isArray(rep.components) ? rep.components : [],
            // ⛔ NO verdict fields are invented: the shadow arm runs ONE investigator pass and never
            // verifies, so `confirmed` is `false` by construction and the verdicts are `null`/`not-run`.
            // A shadow cluster is a HYPOTHESIS the shadow method elicited — nothing more.
            verifier_verdict: null,
            refutation_verdict: "not-run",
            confirmed: false,
            shadow_arm: true,
            method_guidance: methodGuidanceBlock(selection.shadow, METHOD_ARM_SHADOW),
          };
        });
        shadowBlock = {
          ...shadowBlock, calls: shadowCalls,
          clusters: { total: shadowClusters.length, claims: shadowClusters.map((c) => (c.rep as Record<string, unknown>)?.claim ?? null) },
        };
      }
    }
    if (breached()) {
      return fact("failed", { ...base, enabled: true, interval: intervalInfo, due: dueInfo, investigator: investigatorBlock }, `budget breach — wall ${now() - started}ms >= max_wall_ms ${config.maxWallMs} during the shadow arm (nothing appended, last-run not advanced)`);
    }

    // ⑩ the round's ONE scan-round line + its per-cluster records, appended together.
    const wallMs = now() - started;
    const confirmedClusters = clusterRecords.filter((c) => c.confirmed === true);
    const round: Record<string, unknown> = {
      kind: "scan-round",
      routine: OPEN_SEMANTIC_DISCOVERY_NAME,
      invoked_by: invokedBy,
      ts: roundTs,
      interval: intervalInfo,
      due: dueInfo,
      pin: { rev, dir: asRel(root, pinned) },
      inventory: { ok: inventory.ok, entries: inventory.entries, unavailable: inventory.unavailable, scope: INVENTORY_SCOPE_REL },
      focus: { chosen: investigatorBlock.stated_focus ?? null, prior_focuses: focuses },
      investigator: investigatorBlock,
      clusters: { total: clusters.length, verified: verifiedRows.length, beyond_cap: Math.max(0, clusters.length - verifiedRows.length) },
      confirmed: { count: confirmedClusters.length, claims: confirmedClusters.map((c) => c.claim) },
      // What the semantic novelty check decided, per confirmed cluster — the verdicts, the retrieval they
      // were made against and any source that could not be read. `writes` is filled by step ⑩b below and
      // reported on the Fact (the line itself is already on disk by then; the append-only discipline is
      // what keeps a round from being rewritten after the fact).
      ingestion: { checked: noveltyOutcomes.length, outcomes: noveltyOutcomes },
      // ── METHODS (Plan item 2): which methods were INCLUDED, which were EXCLUDED and why, whether the
      // production arm ran baseline or guided, what the shadow arm did, and each guided method's outcome.
      // ⛔ The guidance TEXT is not copied here: `guidance_chars` records its size, and the text itself
      // lives in the prompt (the carrier is not a prompt archive).
      methods: {
        ...selectionBlock,
        outcome: selection.production.map((m) => ({
          method_id: m.method_id, version: m.version, arm: m.arm,
          clusters: clusterRecords.length,
          confirmed: confirmedClusters.length,
          novel: noveltyOutcomes.filter((o) => o.disposition === "novel").length,
          duplicate: noveltyOutcomes.filter((o) => o.disposition === "duplicate" || o.disposition === "restatement").length,
          refuted: clusterRecords.filter((c) => c.verifier_verdict === "refuted" || c.refutation_verdict === "refuted").length,
          undetermined: clusterRecords.filter((c) => c.verifier_verdict === "undetermined").length,
          nothing_found: confirmedClusters.length === 0,
        })),
        shadow: shadowBlock,
      },
      // ⛔ This block's PRESENCE is what tells the call-budget reader that this line's calls are already
      // counted ONE FOR ONE by the reservation ledger (so the legacy carrier term must skip it).
      reservations: {
        cap: config.maxModelCallsPer24h,
        used_at_start: callsUsage.total,
        granted: budget.grantedCount,
        refused: budget.refusedCount,
        mid_round_refusal: midRound,
        usd_cap: config.maxUsdPer24h,
        usd_used_at_start: usdUsage.usd,
        ledger: asRel(root, ledgerPath),
      },
      // ── THE PAIRED INSTRUMENT (Plan items 1-5) ────────────────────────────────────────────────────
      // Whether a pair ran this round, and — when it did not — WHY, as its own token. ⛔ `not_evaluated`
      // is non-null ONLY when the round COULD have measured and could not; a round that merely was not
      // the M-th one carries `null`, so the rolling summary's counts cannot be inflated by ordinary
      // rounds (Plan item 5: "no eligible method" ≠ "zero gain").
      paired: {
        due: pairedDecision.due,
        ordinal: pairedDecision.ordinal,
        every_rounds: config.gainEveryRounds,
        reason: pairedDecision.reason,
        not_evaluated: pairedNotEvaluated,
        budget: pairedEnvelope,
        prereg: preregBlock.path === null
          ? null
          : { path: preregBlock.path, mtime_ms: preregBlock.mtime_ms, keys: preregBlock.keys, refusal: preregBlock.refusal },
        baseline_arm: baselineRun === null || !baselineRun.ok
          ? null
          : {
            clusters: baselineRun.clusterRecords.length,
            confirmed: baselineRun.clusterRecords.filter((c) => c.confirmed === true).length,
          },
        gain: gainRecord === null ? null : gainRecord.gain,
        gain_record_ts: gainRecord === null ? null : roundTs,
      },
      budget_24h: countBudgetBlock,
      budget_usd_24h: usdBudgetBlock,
      wall_ms: wallMs,
      model_calls: budget.grantedCount,
      calls: callRecords,
      tokens: { input: tokensIn, output: tokensOut },
      cost_usd: round6(costUsd),
    };
    // The shadow arm's cluster records ride the SAME append as the production ones, each marked
    // `shadow:true` — they are on the carrier (so a reviewer can read what the draft method elicited)
    // and structurally OUTSIDE the ingestion below, which is fed `clusterRecords` alone.
    appendCarrierRecords(carrier, [
      round,
      ...clusterRecords,
      ...shadowClusterRecords,
      ...(baselineRun !== null && baselineRun.ok ? baselineRun.clusterRecords : []),
      ...(gainRecord === null ? [] : [gainRecord]),
    ]);
    // The ROLLING SUMMARY is recomputed from the carrier at every paired round and appended as its own
    // line: a VIEW of every gain so far, never a smoothed score over them.
    if (gainRecord !== null) appendCarrierRecords(carrier, [gainRollup([...carrierRounds, gainRecord])]);

    // ⑩b THE WRITES — carrier record → Experience → Portfolio. They run AFTER the append because a
    //     Portfolio row's `origin_ref` must resolve in a carrier record that is really there, and the
    //     Experience's evidence digest must be of the bytes really on disk. Each write's outcome is
    //     appended as its own `kind:"ingestion"` line, so "what happened to this cluster" is on the
    //     carrier rather than inferable only from which OTHER files changed.
    const ingestionWrites: IngestionWrite[] = [];
    let ingestionError: string | null = null;
    try {
      ingestionWrites.push(...ingestRoundClusters(root, {
        carrierPath: carrier, carrierRel: asRel(root, carrier),
        clusterRecords, noveltyByCluster,
        portfolio: modules.portfolio, ledger: modules.ledger,
        // The ingesting process names ITSELF: this routine is the writer, and `ingester` is the ledger's
        // own actor for a derived/system projection. Nothing is defaulted at the ledger end either.
        authoredBy: { actor: "ingester", ref: OPEN_SEMANTIC_DISCOVERY_NAME },
      }));
    } catch (e) {
      ingestionError = (e as Error)?.message ?? String(e);
    }
    if (ingestionWrites.length > 0 || ingestionError !== null) {
      appendCarrierRecords(carrier, [{
        kind: "ingestion",
        routine: OPEN_SEMANTIC_DISCOVERY_NAME,
        invoked_by: invokedBy,
        ts: new Date(now()).toISOString(),
        round_ts: roundTs,
        error: ingestionError,
        writes: ingestionWrites,
      }]);
    }
    round.ingestion = { checked: noveltyOutcomes.length, outcomes: noveltyOutcomes, writes: ingestionWrites, error: ingestionError };
    // Plan 2b — CLOSING THE LOOP: the per-method OUTCOME is filled here, after the writes, so each
    // guided method's record names what its round actually produced (Experiences and Portfolio rows).
    const methodOutcome = Array.isArray((round.methods as Record<string, unknown>)?.outcome)
      ? ((round.methods as Record<string, unknown>).outcome as Record<string, unknown>[])
      : [];
    (round.methods as Record<string, unknown>).outcome = methodOutcome.map((o) => ({
      ...o,
      experiences: ingestionWrites.filter((w) => w.experience.written).length,
      portfolio_rows: ingestionWrites.filter((w) => w.portfolio.written).length,
    }));

    // ⑪ ⛔ THE SPLIT: only a RESIDENT round advances the production window, and only when nothing was cut
    //    short mid-round (a round that ran out of ceiling part-way must not consume the interval).
    if (resident && midRound === null) writeLastRunStamped(lastRunPath, OPEN_SEMANTIC_DISCOVERY_NAME, now(), invokedBy);

    if (midRound !== null) {
      return fact("not-evaluated", round, `budget: the ${midRound.kind} step was refused by the 24h ceiling (${midRound.used} >= cap ${midRound.cap}) — ${budget.grantedCount} call(s) were already made and stay RESERVED; the round persisted what it did but did NOT advance the production last-run${revertedNote}${legacyNote}`);
    }
    // An ingestion that FAILED is not folded into a success sentence: the round's semantic work is real
    // and already persisted, but the Fact must say the ledgers did not all get written.
    const ingestionNote = ingestionError !== null
      ? `; ⛔ INGESTION FAILED — ${ingestionError} (the scan-round and cluster records ARE persisted; the Experience/Portfolio writes are not)`
      : `; ingested ${ingestionWrites.length} cluster(s): ${ingestionWrites.filter((w) => w.experience.written).length} Experience(s), ${ingestionWrites.filter((w) => w.portfolio.written).length} Portfolio row(s)`;
    const methodNote = selection.mode === "guided"
      ? `; methods GUIDED by ${selection.production.map((m) => methodLabel(m)).join(",")}`
      : `; methods BASELINE (${selection.baseline_reason})`;
    const shadowNote = selection.shadow.length === 0
      ? ""
      : `; shadow arm ${shadowBlock.ran === true ? `ran ${Number(shadowBlock.calls ?? 0)} call(s) under ${selection.shadow.map((m) => methodLabel(m)).join(",")} (${shadowClusters.length} hypothesis cluster(s), NEVER ingested)` : `did not run (${String(shadowBlock.reason ?? "")})`}`;
    // ⛔ The paired note NEVER reports a gain in place of "not measured", and never reports 0 where the
    // instrument could not run: the two states are different sentences (Plan item 5).
    const pairedNote = !pairedDecision.due
      ? (pairedNotEvaluated === null
        ? ""
        : `; paired instrument ${pairedNotEvaluated} (eligible-round ${pairedDecision.ordinal} of every ${config.gainEveryRounds})`)
      : gainRecord === null || pairedCounts === null
        ? `; PAIRED round ${pairedDecision.ordinal} was NOT measured — ${String(pairedNotEvaluated)} (no gain record written)`
        : `; PAIRED round ${pairedDecision.ordinal}: baseline ${pairedCounts.baseline.confirmed_net_new} net-new / ${pairedCounts.baseline.duplicates} duplicate / ${pairedCounts.baseline.refuted} refuted / $${pairedCounts.baseline.usd}; guided ${pairedCounts.guided.confirmed_net_new} / ${pairedCounts.guided.duplicates} / ${pairedCounts.guided.refuted} / $${pairedCounts.guided.usd}; gain ${JSON.stringify(gainRecord.gain)}`;
    return fact(
      "verified",
      round,
      `round ran (invoked_by:${invokedBy}, interval ${intervalMinutes}m): investigator read the pin with ${INVESTIGATOR_TOOLS} (focus: ${investigatorBlock.stated_focus ?? "<not stated>"}), ${clusters.length} cluster(s) from ${investigatorBlock.runs_with_hypotheses} run(s), ${verifiedRows.length} verified, ${confirmedClusters.length} CONFIRMED after independent refutation, ${budget.grantedCount} model call(s) costing $${round6(costUsd)}, wall ${wallMs}ms; appended 1 scan-round + ${clusterRecords.length} cluster record(s) to ${asRel(root, carrier)}${resident ? " and advanced the production last-run" : " — MANUAL: the production last-run was NOT advanced"}${ingestionNote}${methodNote}${shadowNote}${pairedNote}${revertedNote}${legacyNote}`,
    );
  } catch (e) {
    if (isBudgetRefused(e)) {
      // A MID-ROUND refusal: calls were already made and the ledger holds them, so the round persists what
      // it did — but it must NOT consume the window, so the last-run is left alone.
      midRound = { kind: e.step as ModelStepKind, used: e.used, cap: e.cap };
      const round: Record<string, unknown> = {
        kind: "scan-round", routine: OPEN_SEMANTIC_DISCOVERY_NAME, invoked_by: invokedBy, ts: new Date(now()).toISOString(),
        interval: intervalInfo, due: dueInfo, pin: { rev, dir: asRel(root, pinned) }, inventory: { ok: inventory.ok, entries: inventory.entries, unavailable: inventory.unavailable },
        investigator: investigatorBlock, reservations: { cap: config.maxModelCallsPer24h, used_at_start: callsUsage.total, granted: budget.grantedCount, refused: budget.refusedCount, mid_round_refusal: midRound, ledger: asRel(root, ledgerPath) },
        methods: selectionBlock,
        budget_24h: countBudgetBlock, budget_usd_24h: usdBudgetBlock, wall_ms: now() - started, model_calls: budget.grantedCount, calls: callRecords,
        tokens: { input: tokensIn, output: tokensOut }, cost_usd: round6(costUsd),
      };
      appendCarrierRecords(carrier, [round]);
      return fact("not-evaluated", round, `budget-24h: the ${midRound.kind} step was refused by the 24h ceiling (${midRound.used} reservation(s) >= cap ${midRound.cap}) — ${budget.grantedCount} call(s) were already made and stay RESERVED; the round persisted what it did (1 scan-round line) but did NOT advance the production last-run${revertedNote}${legacyNote}`);
    }
    if (e instanceof BudgetLockError) {
      return fact("failed", { ...base, enabled: true, interval: intervalInfo, due: dueInfo }, `budget lock unavailable — ${e.message} (nothing appended, last-run not advanced)`);
    }
    return fact("failed", { ...base, enabled: true, interval: intervalInfo, due: dueInfo }, `round threw — ${(e as Error)?.message ?? String(e)} (nothing appended, last-run not advanced)`);
  }
}

// ── RoutineSpec factories ────────────────────────────────────────────────────────────────────────────
export interface OpenSemanticDiscoveryRoutineOptions
  extends Omit<OpenSemanticDiscoveryRunOptions, "config" | "configPresent" | "configError" | "halted" | "invokedBy" | "force"> {}

/** Build the Layer-1b routine from an ALREADY-PARSED config read. ⛔ `invokedBy` and `force` are OMITTED,
 *  not merely defaulted: this factory IS the driver's routine table, so the round it builds is
 *  `resident-driver` by construction and cannot be talked out of it. A caller that wants a manual round
 *  calls `runOpenSemanticDiscovery` directly — the two paths must not be reachable by the same switch. */
export function buildOpenSemanticDiscoveryRoutine(root: string, read: OpenSemanticDiscoveryConfigRead, opts: OpenSemanticDiscoveryRoutineOptions = {}): RoutineSpec {
  const schedule = read.config?.trigger ?? { kind: "interval", minutes: DEFAULT_INTERVAL_MINUTES };
  return {
    name: OPEN_SEMANTIC_DISCOVERY_NAME,
    schedule,
    run: async (ctx) =>
      [await runOpenSemanticDiscovery(root, {
        ...opts,
        config: read.config,
        configPresent: read.present,
        configError: read.error,
        halted: ctx?.halted === true,
        invokedBy: INVOKED_BY_RESIDENT,
      })],
  };
}

/** Production entry: read `.quay/config.yml` and build the routine. NEVER throws (an optional routine
 *  track must not take down the host driver's startup). `routine` is `null` when NO section is declared —
 *  "off by default" means the host driver does not even ADD a routine to its table. A section that IS
 *  declared (even `enabled:false`, even malformed) yields a routine, because the declaration must be
 *  OBSERVABLE (硬规则 3b/9: "declared but not driven" and "not declared" must not look the same). */
export function openSemanticDiscoveryRoutineFromConfig(
  root: string,
  opts: OpenSemanticDiscoveryRoutineOptions = {},
  readIn?: OpenSemanticDiscoveryConfigRead,
): {
  routine: RoutineSpec | null;
  error: string | null;
  present: boolean;
  enabled: boolean;
  intervalMinutes: number | null;
  intervalUntil: number | null;
  maxModelCallsPer24h: number | null;
  maxUsdPer24h: number | null;
  investigatorRuns: number | null;
  maxClustersVerified: number | null;
  verifierMaxTurns: number | null;
  refutationMaxTurns: number | null;
} {
  const read = readIn ?? readOpenSemanticDiscoveryConfig(root);
  const cfg = read.config;
  return {
    routine: read.present ? buildOpenSemanticDiscoveryRoutine(root, read, opts) : null,
    error: read.error,
    present: read.present,
    enabled: cfg?.enabled === true,
    intervalMinutes: cfg && typeof cfg.trigger.minutes === "number" ? cfg.trigger.minutes : null,
    intervalUntil: cfg ? cfg.intervalUntil : null,
    maxModelCallsPer24h: cfg ? cfg.maxModelCallsPer24h : null,
    maxUsdPer24h: cfg ? cfg.maxUsdPer24h : null,
    investigatorRuns: cfg ? cfg.investigatorRuns : null,
    maxClustersVerified: cfg ? cfg.maxClustersVerified : null,
    verifierMaxTurns: cfg ? cfg.verifierMaxTurns : null,
    refutationMaxTurns: cfg ? cfg.refutationMaxTurns : null,
  };
}

// ── CLI (a one-shot MANUAL round) ────────────────────────────────────────────────────────────────────
const USAGE = [
  "open-semantic-discovery-routine — open-ended semantic architecture discovery as a Layer-1b routine (report-only).",
  "  --once --root <dir> [--json]      run ONE MANUAL round against <dir> (invoked_by:\"manual\")",
  "  --force                           manual: run even inside the interval (still never advances",
  "                                    .quay/routine-last-run.json — production's clock is not yours)",
  "  --pin-tmp <dir>                   temp root for the stripped pins",
  "⛔ This CLI is ALWAYS a manual round: it reads the production interval but never advances it. The",
  "   resident round (the one that advances it) is assembled by the quality-gate driver's routine table.",
].join("\n");

async function main(argv: string[]): Promise<number> {
  const root = (() => { const i = argv.indexOf("--root"); return path.resolve(i >= 0 && argv[i + 1] ? argv[i + 1] : process.cwd()); })();
  const json = argv.includes("--json");
  const pinTmpRoot = (() => { const i = argv.indexOf("--pin-tmp"); return i >= 0 && argv[i + 1] ? path.resolve(argv[i + 1]) : undefined; })();
  const read = readOpenSemanticDiscoveryConfig(root);
  const fact = await runOpenSemanticDiscovery(root, {
    config: read.config,
    configPresent: read.present,
    configError: read.error,
    halted: false,
    invokedBy: INVOKED_BY_MANUAL,
    force: argv.includes("--force"),
    pinTmpRoot,
  });
  process.stdout.write(json ? `${JSON.stringify({ root, fact }, null, 1)}\n` : `${fact.state}: ${fact.reason}\n`);
  return fact.state === "failed" ? 1 : 0;
}

if (isDirectEntry(import.meta, process.argv[1], "open-semantic-discovery-routine")) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}

export { USAGE };
