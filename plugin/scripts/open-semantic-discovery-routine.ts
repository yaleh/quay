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
// KILL SWITCH + OFF BY DEFAULT: declared in `.quay/config.yml` `loop.open_semantic_discovery:`. A
// workspace with no such section gets `not-evaluated:disabled` and ZERO spawns. `enabled:false` is the
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
}
export interface OpenDiscoveryModules {
  hyp: HypothesisModule;
  portfolio: PortfolioModule;
  ledger: LedgerModule;
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
  if (unresolved.length > 0 || hyp === null || portfolio === null || ledger === null) {
    throw new Error(`OPEN_DISCOVERY_MODULES_UNRESOLVED — ${unresolved.join("; ") || "one or more engine modules did not load"}`);
  }
  return { hyp: hyp as HypothesisModule, portfolio: portfolio as PortfolioModule, ledger: ledger as LedgerModule };
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
 *  that is too thin is REFUSED by the ledger rather than padded (硬规则 3b). */
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
      const input: Record<string, unknown> = {
        finding_id: recordId,
        origin: "autonomous-routine",
        origin_ref: recordId,
        evidence_level: "production-open",
        method_ref: null,
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

// ── the round ────────────────────────────────────────────────────────────────────────────────────────
export type ModelStepKind = "investigator" | "verifier" | "refuter" | "value-assessment" | "novelty-check";

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
  const investigatorTexts: string[] = [];
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
    // byte-identical — this routine PREPENDS a focus directive to it rather than editing it.
    const basePrompt = fs.readFileSync(hyp.defaultInvestigatorPrompt(), "utf8");
    const prompt = `${focusDirective(focuses)}\n${basePrompt}\n\n${inventory.ok === true ? String(inventory.text ?? "") : ""}`;
    const inv = await hyp.runInvestigator({
      prompt,
      // `neutralDir` is unused on the pinned path (the cwd gate switches to `verifyCwdRefusal`); it is
      // passed equal to the pin so BOTH gates agree on which tree this is.
      neutralDir: pinned,
      cwd: pinned,
      pinDir: pinned,
      runs: config.investigatorRuns,
      outDir: path.join(pinned, ".open-semantic-discovery-runs"),
      writeFile: (f: string, t: string) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t, "utf8"); },
      budget: { maxRuns: config.investigatorRuns, maxMs: config.maxWallMs },
      model: requestedModel ?? "not-evaluated:model-unverified",
      tools: INVESTIGATOR_TOOLS,
      maxTurns: config.investigatorMaxTurns,
      runModel: async (p: string) => {
        const { res } = await reservingStep("investigator", { prompt: p, tools: INVESTIGATOR_TOOLS, maxTurns: config.investigatorMaxTurns, model: requestedModel });
        investigatorTexts.push(hyp.callText(String(res?.stdout ?? "")));
        return res;
      },
    });
    if (inv.ok !== true) {
      const reasons = Array.isArray(inv.reasons) ? (inv.reasons as string[]) : [];
      return fact("failed", { ...base, enabled: true, interval: intervalInfo, due: dueInfo }, `investigator refused — ${reasons[0] ?? "no reason reported"} (nothing appended, last-run not advanced)`);
    }
    const records = Array.isArray(inv.records) ? (inv.records as Record<string, unknown>[]) : [];
    const statedFocus = investigatorTexts.map((t) => focusFromText(t)).find((f) => typeof f === "string" && f !== "") ?? null;
    investigatorBlock = {
      ran: true, runs: config.investigatorRuns, runs_with_hypotheses: Number(inv.parsed ?? 0),
      tools: INVESTIGATOR_TOOLS, max_turns: config.investigatorMaxTurns, cwd: asRel(root, pinned),
      stated_focus: statedFocus, prior_focuses: focuses,
    };
    // (b, cont.) `clusterHypotheses` merges near-duplicates ACROSS the runs by component-set overlap. It
    // is dedup ASSISTANCE ONLY — nothing here discards a cluster by shape, and the cap below is a COUNT.
    clusters = hyp.clusterHypotheses(records, {});
    if (breached()) {
      return fact("failed", { ...base, enabled: true, interval: intervalInfo, due: dueInfo, pin: { rev, dir: asRel(root, pinned) }, inventory, investigator: investigatorBlock }, `budget breach — wall ${now() - started}ms >= max_wall_ms ${config.maxWallMs} after the investigator (nothing appended, last-run not advanced)`);
    }

    // ⑦ (c) VERIFY at most K clusters, with Read,Grep on the pin and an explicit turn budget.
    let verification: Record<string, unknown> = { verified: 0, results: [] };
    if (clusters.length > 0) {
      const v = await hyp.runVerifier({
        clusters, pinDir: pinned, cwd: pinned, promptTemplate: verifierPromptText,
        maxClusters: config.maxClustersVerified, concurrency: 1, maxMs: config.maxWallMs, // concurrency-default-fallback: ONE verifier call at a time — the engine can fan out, but concurrent calls reserve from several places at once and the per-step cost ledger stops being readable in call order
        strategy: "default", onlyCluster: null, evidence: null, model: requestedModel,
        runModel: async (p: string) => {
          const { res } = await reservingStep("verifier", { prompt: p, tools: VERIFIER_TOOLS, maxTurns: config.verifierMaxTurns, model: requestedModel });
          return res;
        },
      });
      if (v.ok !== true) {
        const reasons = Array.isArray(v.reasons) ? (v.reasons as string[]) : [];
        return fact("failed", { ...base, enabled: true, interval: intervalInfo, due: dueInfo }, `verifier refused — ${reasons[0] ?? "no reason reported"} (nothing appended, last-run not advanced)`);
      }
      verification = v;
    }
    const verifiedRows = Array.isArray(verification.results) ? (verification.results as Record<string, unknown>[]) : [];

    // ⑧ (d) INDEPENDENT REFUTATION. Each `supported` cluster gets a SEPARATE fresh-context call whose ONLY
    //    input is the claim and the components — it never sees the first verifier's reasoning. A cluster is
    //    reported `confirmed` ONLY if it survives.
    const clusterRecords: Record<string, unknown>[] = [];
    // ONE instant for the round: it is the scan-round's `ts` AND the first half of every cluster's
    // `record_id`, so a cluster is addressable by `<round>#<index>` without a second identity scheme.
    const roundTs = new Date(now()).toISOString();
    for (const row of verifiedRows) {
      const idx = Number(row.cluster ?? 0);
      const cluster = clusters[idx - 1] ?? null;
      const rep = (cluster?.rep ?? {}) as Record<string, unknown>;
      const entry: Record<string, unknown> = {
        kind: "cluster",
        routine: OPEN_SEMANTIC_DISCOVERY_NAME,
        invoked_by: invokedBy,
        ts: new Date(now()).toISOString(),
        // The record's OWN id — the ref the Portfolio resolves its `origin_ref` by, and the back-pointer an
        // Experience's `source_ref` carries. Minted here, once, so both readers agree by construction.
        record_id: openDiscoveryRecordId(roundTs, idx),
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
      };
      let refutation: Record<string, unknown> | null = null;
      if (row.verdict === "supported") {
        const one = await hyp.runVerifier({
          clusters: [cluster], pinDir: pinned, cwd: pinned, promptTemplate: REFUTATION_PROMPT_TEMPLATE,
          maxClusters: 1, concurrency: 1, maxMs: config.maxWallMs, strategy: "default", onlyCluster: 1, // concurrency-default-fallback: ONE cluster, ONE call
          evidence: null, model: requestedModel,
          runModel: async (p: string) => {
            const { res } = await reservingStep("refuter", { prompt: p, tools: REFUTER_TOOLS, maxTurns: config.refutationMaxTurns, model: requestedModel });
            return res;
          },
        });
        if (one.ok !== true) {
          const reasons = Array.isArray(one.reasons) ? (one.reasons as string[]) : [];
          return fact("failed", { ...base, enabled: true, interval: intervalInfo, due: dueInfo }, `refuter refused — ${reasons[0] ?? "no reason reported"} (nothing appended, last-run not advanced)`);
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
            const { res } = await reservingStep("value-assessment", { prompt: p, tools: VALUE_TOOLS, maxTurns: config.refutationMaxTurns, model: requestedModel });
            return res;
          },
        });
        if (one.ok !== true) {
          const reasons = Array.isArray(one.reasons) ? (one.reasons as string[]) : [];
          return fact("failed", { ...base, enabled: true, interval: intervalInfo, due: dueInfo }, `value assessment refused — ${reasons[0] ?? "no reason reported"} (nothing appended, last-run not advanced)`);
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
        return fact("failed", { ...base, enabled: true, interval: intervalInfo, due: dueInfo, investigator: investigatorBlock }, `budget breach — wall ${now() - started}ms >= max_wall_ms ${config.maxWallMs} during verification (nothing appended, last-run not advanced)`);
      }
    }

    // ⑨b THE NOVELTY CHECK — the ONE semantic call that decides whether a CONFIRMED cluster is new. It runs
    //     HERE, before the carrier append, for two reasons: (i) a budget refusal must be handled by the
    //     round's own refusal path rather than after the round is already on disk, and (ii) the verdicts
    //     belong ON the scan-round line, where a reviewer reads what the round found and what it decided.
    //     ⛔ The WRITES happen after the append (step ⑩b) — a Portfolio `origin_ref` must resolve against a
    //     carrier record that is really there.
    const priorClusterRecords = carrierRounds.filter((r) => r.kind === "cluster" && r.invoked_by === INVOKED_BY_RESIDENT);
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
      const { res, rec: callRec } = await reservingStep("novelty-check", {
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
        return fact("failed", { ...base, enabled: true, interval: intervalInfo, due: dueInfo, investigator: investigatorBlock }, `budget breach — wall ${now() - started}ms >= max_wall_ms ${config.maxWallMs} during the novelty check (nothing appended, last-run not advanced)`);
      }
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
      budget_24h: countBudgetBlock,
      budget_usd_24h: usdBudgetBlock,
      wall_ms: wallMs,
      model_calls: budget.grantedCount,
      calls: callRecords,
      tokens: { input: tokensIn, output: tokensOut },
      cost_usd: round6(costUsd),
    };
    appendCarrierRecords(carrier, [round, ...clusterRecords]);

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
    return fact(
      "verified",
      round,
      `round ran (invoked_by:${invokedBy}, interval ${intervalMinutes}m): investigator read the pin with ${INVESTIGATOR_TOOLS} (focus: ${investigatorBlock.stated_focus ?? "<not stated>"}), ${clusters.length} cluster(s) from ${investigatorBlock.runs_with_hypotheses} run(s), ${verifiedRows.length} verified, ${confirmedClusters.length} CONFIRMED after independent refutation, ${budget.grantedCount} model call(s) costing $${round6(costUsd)}, wall ${wallMs}ms; appended 1 scan-round + ${clusterRecords.length} cluster record(s) to ${asRel(root, carrier)}${resident ? " and advanced the production last-run" : " — MANUAL: the production last-run was NOT advanced"}${ingestionNote}${revertedNote}${legacyNote}`,
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
