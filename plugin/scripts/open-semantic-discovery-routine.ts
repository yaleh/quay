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
// ⛔ A REFUTATION VERDICT IS ATTRIBUTABLE, AND «undetermined» NAMES ITS CAUSE (task
// gap-open-discovery-refutation-chain-undetermined-is-unattributable-and-budget-truncated). Two defects
// this closes, both measured on the production carrier: every refutation the routine had ever recorded was
// `undetermined`, a word that could not tell a turn-cap kill from a genuine absence of counter-evidence
// from a call that never answered; and the per-cluster `refutation_*` fields were read off the ENGINE ROW
// (the parser's tool-call count, in a unit `--max-turns` is not expressed in, and — when a truncated call
// was rescued — the tool-less rescue's row rather than the refuter's). Now:
//   · EVERY refuter call this cluster consumed is on the cluster record (`refutation_call.calls`), each
//     with its OWN `num_turns` (CLI unit), `subtype`, exit, `not_evaluated` and `tool_use` counts;
//   · the verdict is read from the call that ANSWERED (a fresh-context retry SUPERSEDES the call it
//     repeats), so two clusters never share one call's numbers;
//   · `refutation_undetermined_cause` ∈ {`budget-truncated`, `no-counter-evidence`, `call-failed`,
//     `unparseable`} — one value per FACT, with «budget-truncated» the only one a retry can cure;
//   · a TRUNCATED refuter gets ONE fresh-context retry at `refutation_retry_max_turns` (a MEASURED
//     default — see `DEFAULT_REFUTATION_RETRY_MAX_TURNS`), reserved on the same 24h ledger so it is
//     counted and capped like any other call. It REPLACES the tool-less answer reserve for this step: a
//     refuter's value is its independent reading, and an answer distilled from its own cut-off narration
//     would be the same attempt continued;
//   · the first verifier's CITED LINES ride along as STARTING POINTS (`refutationPromptFor`) — a shortcut
//     to the files, explicitly NOT a case to agree with, and the template is byte-identical when it cited
//     nothing. The refuter must name a counterexample OR the positions it checked, so a «survived» verdict
//     carries something a reader can audit.
// ⛔ WHAT DID NOT CHANGE: what counts as CONFIRMED (a determinate «survived», and nothing else — an
// `undetermined` is never a confirmation, now also structurally: a verdict read off a call that did not
// answer can never spell one), the report-only surface, and the kill switch.
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
import { launchArgv, readAnchorStart, STOPPED_MID_ROUND, StoppedMidRoundError, isStoppedMidRound, type AnchorStartReading, type Fact, type RoutineSpec } from "./driver-runtime.ts";
import { ROUTINE_LAST_RUN_REL, readLastRunMap } from "./probe-routine.ts";
import { isDirectEntry } from "./gate-script-base.ts";
// The task-status transition READ SURFACE (the same reader `quay task log` publishes). ⛔ NEVER a direct
// parse of the transition carrier FILE: its paging/cursor/epoch/coverage contract lives in the Core
// module, and a second reader would be a second contract (case (e) pins the absence of that parse).
// Measured 2026-10-13 before adopting the
// static import (plugin-core-import-inlines-whole-module-into-shipped-bundle): the ONE bundle that
// inlines this routine (quality-gate-driver.js) grows by ~17 KB, because the kernel closure the surface
// stands on is already inlined there through ready-pool-check.ts — not the 24x blow-up that memory warns of.
import {
  readTaskLog,
  MAX_TASK_LOG_LIMIT,
  type TaskLogCursor,
  type TaskLogDocument,
} from "../../packages/quay/src/cli/task-log.ts";
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

/** How long the round yields the clock between WRITING the pre-registration and the first arm call.
 *  ⛔ WHY IT EXISTS: "older than every call" is judged in whole milliseconds off the file's own mtime
 *  (the reused engine rule), and a write and a call inside the SAME millisecond are unprovable — a
 *  refusal there would be a FALSE refusal of a perfectly good declaration, and a pairing cadence that
 *  sometimes refuses its own pre-registration is worse than useless. The settle can only ever make the
 *  declaration OLDER than the calls, never younger, so it cannot manufacture a false pass. */
export const PREREG_SETTLE_MS = 25;

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

/** How many task-status transitions the round OFFERS the model as optional context when the section does
 *  not declare `task_log_context_limit`. A bound on the PROMPT, never a policy: the events gate nothing
 *  and schedule nothing (see the task-status-context section below). Stated rather than measured-with-
 *  nothing, and matched to the 60m cadence: an hour of this repo's board rarely moves more than a few
 *  dozen tasks, so 50 is "everything since the last round" for the overwhelmingly common case. */
export const DEFAULT_TASK_LOG_CONTEXT_LIMIT = 50;

// ── the model steps' tool and turn envelopes (see the header) ────────────────────────────────────────
/** The INVESTIGATOR's tools. It reads code and context ITSELF, rooted at the pinned tree, instead of
 *  reasoning only over a mechanically pre-digested inventory — that is the whole difference between this
 *  routine and `runInvestigator`'s blind default. */
export const INVESTIGATOR_TOOLS = "Read,Grep,Glob";
/** The investigator's internal turn budget when it HAS tools. It is a stated module constant rather than a
 *  config key because the config's declared keys are the operator's budget surface; this bounds what
 *  happens INSIDE one already-counted call. `investigator_max_turns` in the config overrides it.
 *
 *  ⛔ RE-DERIVED FROM THE FRESH CORPUS (task gap-osd-resident-round-never-autonomously-confirms-fix-
 *  attribution-and-call-failed-retry, Plan item 1) — the value was 12 on the 10-sample corpus of
 *  2026-10-13T00:25Z, which is BELOW every completed investigator call since. Persisted distribution of
 *  ANSWERED (`not_evaluated:null`) tool-reading calls over every `kind:"scan-round"` line in
 *  `.quay/open-semantic-discovery-findings.jsonl` at 2026-10-13T15:30Z (`num_turns`, the CLI's own unit):
 *      investigator         n=10  [16, 17, 20, 23, 23, 23, 23, 24, 26, 29]   p100 = 29
 *      shadow-investigator  n=13  [11, 13, 13, 16, 17, 18, 19, 19, 22, 23, 24, 24, 25]   p100 = 25
 *      verifier             n=8   [13, 13, 14, 14, 14, 16, 17, 21]          ← n<10 ⇒ KEPT (see below)
 *      refuter              n=4   [9, 24, 35, 44]                            ← n<10 ⇒ KEPT
 *  This ONE constant bounds BOTH investigator-family arms, so its value is the p100 of the pooled
 *  investigator-family population (n=23) — which is the investigator's own 29.
 *  ⛔ WHY A CAP THE CALLS ALREADY EXCEED IS STILL WORTH FIXING: the cap is not currently the binding
 *  constraint (calls complete at 16-29 turns under a nominal 12), but the cap is STATED TO THE MODEL —
 *  `turnReserveDirective` tells it «the cap is HARD … stop calling tools by turn 10» — so a 12 against a
 *  measured p100 of 29 makes the prompt lie about the budget it is actually running under. */
export const DEFAULT_INVESTIGATOR_MAX_TURNS = 29;
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

// ── THE REFUTER'S RETRY BUDGET, SET FROM A MEASURED DISTRIBUTION ──────────────────────────────────────
// THE DEFECT THIS CLOSES (task gap-open-discovery-refutation-chain-undetermined-is-unattributable-and-
// budget-truncated, Plan item 2). The refuter carried the SMALLEST turn budget in the chain (6) although
// refuting needs at least as much reading as verifying — and production measured the consequence: of the
// three refuter calls ever made, `num_turns` = [7, 9, unmeasured], and NOT ONE reached a determinate
// verdict. A truncated refuter therefore produced `undetermined`, which is indistinguishable on the record
// from «read the code and found no counter-evidence» — the exact conflation this task exists to end.
//
// ⛔ THE NUMBER IS MEASURED, NOT GUESSED. The persisted distribution of ANSWERED (`not_evaluated:null`)
// calls that READ the tree with tools, i.e. the only population whose turn count shows what a completed
// tool-reading call costs (`num_turns` per step, CLI unit, over every `kind:"scan-round"` line in the
// production carrier at 2026-10-13):
//     investigator         n=5   [26, 20, 16, 23, 23]
//     shadow-investigator  n=6   [13, 18, 13, 23, 22, 17]
//     verifier             n=3   [17, 14, 14]
//     refuter              n=1   [9]        ← fewer than 10 ⇒ AC3's own escape clause
// Pooled tool-reading population n = 11, whose p100 (the stated percentile) is 26. That is the retry's
// budget: ONE fresh-context retry that fits EVERY measured completed tool-reading call on this pin.
// ⛔ It is a RETRY budget, not the step's: the first refuter call keeps `refutation_max_turns` (6), because
// the refuter's OWN answered sample count (1) is below the ten AC3 requires before a per-step budget may
// be moved off its current value. Lowering or raising the FIRST budget on one sample would be the guess
// AC3 forbids; spending ONE extra counted call instead is a measurement-backed choice.
//
// ⛔ RE-DERIVED ON THE FRESH CORPUS (task gap-osd-resident-round-never-autonomously-confirms-fix-
// attribution-and-call-failed-retry, Plan item 1). The n=11 population above was 26, and the value was
// read straight off it. The SAME population, re-measured at 2026-10-13T15:30Z, is n=35 and its p100 is 44
// — i.e. the retry budget of 26 no longer «fits EVERY measured completed tool-reading call on this pin»:
//     investigator [16,17,20,23,23,23,23,24,26,29]  shadow-investigator [11,13,13,16,17,18,19,19,22,23,24,24,25]
//     verifier [13,13,14,14,14,16,17,21]             refuter [9, 24, 35, 44]
// The refuter's OWN three retry-budget calls (cap 26 — the retry is visible on the record as
// `budget_retry:true`) needed 24, 35 and 44 turns, so TWO OF THE THREE exceeded the retry budget itself.
// 44 is the pooled p100 (the same stated percentile as before), pooled n=35.
export const DEFAULT_REFUTATION_RETRY_MAX_TURNS = 44;

// ── the ANSWER RESERVE (task gap-open-semantic-discovery-investigator-exits-before-hypotheses-zero-semantic-output) ──
// THE DEFECT THIS CLOSES. In production the first two resident rounds each recorded `exit 1`, `turns: 13`
// under `--max-turns 12`, `0 hypotheses`, `confirmed.count 0` — and the call record kept NEITHER the
// stream's `result.subtype` NOR any stderr, so "the model was killed mid-exploration before it could
// answer" and "the model explored and found nothing" were THE SAME RECORD (硬规则 3b). Two independent
// things are needed and neither replaces the other: (i) the failure must be LEGIBLE (§failure legibility
// below), and (ii) the answer must be BUDGETED FOR, because a hard turn cap with no reservation kills the
// run at exactly the moment it was about to report.
//
// ⛔ SEMANTIC FIRST. The reserve is a SECOND MODEL CALL, not a mechanical substitute for exploration: it
// hands the run its own exploration notes back and asks it to report. Nothing here decides what a
// hypothesis may say.
/** How many of the investigator's turns are RESERVED for printing the answer. Two is stated rather than
 *  measured-with-nothing: the protocol needs one turn to write the block, and one turn of slack absorbs a
 *  model that closes an exploration it had already finished thinking about. It is a PROMPT-side
 *  reservation — the `--max-turns` cap itself is NOT raised by it. */
export const ANSWER_RESERVE_PROMPT_TURNS = 2;
/** The answer reserve's own call is TOOL-LESS: one turn, no further reading. `stepArgv` already forces
 *  one turn for a tool-less step, so there is no second budget to keep in sync. */
export const ANSWER_RESERVE_TOOLS = "";
/** How much of the model's OWN prose is carried back into the reserve call. A BOUND, not a policy: the
 *  tail is where a narration that was about to conclude sits, and an unbounded carry would make one
 *  rescue call as expensive as the exploration it is rescuing. */
export const ASSISTANT_TAIL_MAX = 4000;
/** How much of a failed call's stderr is kept. The tail is where a launcher's cause usually is ("Reached
 *  maximum number of turns", an auth refusal, a gateway 500); the head is progress output. ⛔ 4 KB: the
 *  pre-2026-10-13 value (400) was sized for a turn-cap notice, but a gateway refusal arrives as a JSON
 *  error body and 400 chars cut it mid-object — the very reading this task exists to keep. */
export const STDERR_TAIL_MAX = 4096;
/** How much of a failed/no-result call's STDOUT is kept, as a head and a tail, in a bounded side file
 *  under `.quay/` (Plan item 1). ⛔ Not on the carrier line: a stream is kilobytes and the carrier is a
 *  per-round ledger, so the head/tail go to their own file and the call record carries the PATH plus the
 *  sizes, so a reader can tell "the capture is short because the stream was short" from "…because it was
 *  truncated" (硬规则 3b). */
export const STDOUT_HEAD_MAX = 2048;
export const STDOUT_TAIL_MAX = 2048;
/** Where those captures live. Runtime state under `.quay/` (gitignored), one bounded text file per
 *  failed or result-less call — the same family as the carrier and the ledger. */
export const CALL_CAPTURE_DIR_REL = path.posix.join(".quay", "open-semantic-discovery-call-captures");
/** How long the round yields the clock before RETRYING a call whose bytes say it never got an answer
 *  (Plan item 3). It is a delay, not a policy: the retry is what matters, and the backoff only keeps a
 *  gateway that is refusing everything from being hit twice in the same millisecond. A test passes its
 *  own `sleepFn`/`retryBackoffMs` so no suite ever waits on it. */
export const RETRY_BACKOFF_MS = 2000;
/** The `call_failure` classes a call is retried for, ONCE. ⛔ `truncated-json` is deliberately ABSENT:
 *  a stream cut mid-write usually means the ceiling was reached, and re-spending a reservation will cut
 *  it in the same place. `killed-by-timeout` is absent for the same reason (Plan item 3). */
export const RETRYABLE_CALL_FAILURES: readonly string[] = ["no-stdout", "stream-without-result", "api-error-event"];

// ── THE ANCHOR-HANDOFF CORRELATION (task gap-osd-stream-without-result-recurs-past-the-one-counted-…)
//
// WHY THIS EXISTS. Real production (2026-10-13) recorded the SAME retryable class recurring ON its own one
// counted retry: of the 5 `stream-without-result` calls the class retried, 3 came back the identical class
// and NONE produced a usable answer. The hypothesis was that these calls land in the tail of an ANCHOR
// HANDOFF — a window where the outgoing anchor's orphaned children and the incoming anchor's loops overlap.
// That claim needed a counterfactual before it could be called a cause (hard rule 4 corollary 4), and the
// counterfactual needs a signal that is recorded PER CALL rather than reconstructed by hand from
// `anchor.log` after the fact (Plan item 1).
//
// ⛔ WHAT THIS IS NOT. It changes NO retry policy. The decision, taken on the measured counterfactual (the
// counts are on the task's `## Evidence`), is that the one counted retry stays ONE: the 5 retries the class
// actually triggered produced 0 usable answers, so a second retry would spend a reservation on a class with
// a measured 0/5 immediate-success rate. Escalating on a correlation this thin would be inventing a fix
// (hard rule 12). What is added is the DIAGNOSIS — so the next recurrence is self-diagnosing instead of
// requiring a fresh manual capture-file read.
//
// ⛔ THE WINDOW IS A POLICY, NOT A MEASUREMENT, AND THE RECORD SAYS SO. `age_ms` is carried raw on every
// call record; `adjacent` is derived from it, and a reader who disagrees with the window can re-derive the
// flag from the same record (硬规则 4: a threshold is not a reading).
//   · WHERE 15 MINUTES COMES FROM (the measured separation, not a round number): every transport-loss call
//     observed sat 157…653 s (2.6–10.9 min) after its anchor's start, and every round in steady state sat
//     ≥ 17 274 s (4.8 h) after one. 15 min covers the first with 38 % margin and excludes the second with
//     19× margin.
//   · ⚠️ IT SEPARATES **ROUNDS**, NOT CALLS. Inside an adjacent round the losses (157–653 s) and the clean
//     calls (23 s, 200 s, 240 s) OVERLAP in time, so «this call was near a handoff» is NOT what the flag
//     measures — «this call belongs to a round that began near one» is. That is why `age_ms` rides every
//     record: a future reader can stratify calls by their own age instead of trusting the round's.
export const HANDOFF_ADJACENCY_WINDOW_MS = 15 * 60 * 1000;

/** Where this host's own 1-minute load average is read from. A file path, not a constant to be believed:
 *  the reading is `null` with a reason when it cannot be read (硬规则 3b), and the round says which. */
export const HOST_LOADAVG_PATH = "/proc/loadavg";

/** What an anchor's own published start implies for one instant (a round start, or one call's start).
 *  ⛔ THREE-WAY, and the third value is the point: `evaluated:false` says «the anchor's start could not be
 *  read at all», which is NOT «no handoff nearby» (硬规则 3b — the silent-read-as-steady-state failure). */
export type HandoffBlock =
  | { evaluated: true; anchor_pid: number | null; anchor_started_at: string; age_ms: number; adjacent: boolean }
  | { evaluated: false; reason: string };

/** Derive the block for ONE instant from the round's single `readAnchorStart` reading. Pure, and it takes
 *  `atMs` rather than reading the clock so a call's block describes the instant the CALL began (a round
 *  can run for minutes, and a call at minute 12 is not described by the round's own start).
 *
 *  ⛔ `age_ms` is SIGNED and a NEGATIVE age is NOT `adjacent`: an `anchor.json` whose `startedAt` is in the
 *  future is a clock-skew / hand-written-surface reading, and folding it to 0 would make it indistinguishable
 *  from «the anchor started this very second» — the exact shape of the claim being tested. */
export function handoffBlock(reading: AnchorStartReading, atMs: number, windowMs: number = HANDOFF_ADJACENCY_WINDOW_MS): HandoffBlock {
  if (!reading.evaluated) return { evaluated: false, reason: reading.reason };
  const ageMs = atMs - reading.started_at_ms;
  return {
    evaluated: true,
    anchor_pid: reading.pid,
    anchor_started_at: new Date(reading.started_at_ms).toISOString(),
    age_ms: ageMs,
    adjacent: ageMs >= 0 && ageMs <= windowMs,
  };
}

/** The host's own load reading, recorded alongside each call so a future recurrence can be compared
 *  against «the host was busy» as well as «an anchor handoff was in flight» — the alternative explanation
 *  the proposal states has NOT been ruled out, and this is the instrument that rules it in or out.
 *  ⛔ `load_per_cpu` is derived from `os.cpus().length` (a HOST reading), never a literal core count
 *  (硬规则 4 corollary 2: a literal that happens to mean «unlimited» here is a host-dependent constant).
 *  ⛔ Unreadable ⇒ `ok:false` + the errno, never a 0 load: «could not read» and «idle host» are different
 *  facts and a 0 here would be read as evidence FOR the handoff hypothesis. */
export type HostLoadBlock =
  | { ok: true; load1: number; cpus: number; load_per_cpu: number }
  | { ok: false; reason: string };

export function readHostLoad(opts: { loadavgPath?: string; cpuCount?: number } = {}): HostLoadBlock {
  const file = typeof opts.loadavgPath === "string" ? opts.loadavgPath : HOST_LOADAVG_PATH;
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    return { ok: false, reason: `loadavg-unreadable:${(e as NodeJS.ErrnoException)?.code ?? String((e as Error)?.message ?? e)}` };
  }
  // ⛔ String operations only (case (l): this file carries no pattern machinery — not even a literal).
  const first = raw.trim().split(" ").filter((s) => s !== "")[0] ?? "";
  const load1 = first === "" ? Number.NaN : Number(first);
  if (!Number.isFinite(load1)) return { ok: false, reason: `loadavg-unparseable:${first.slice(0, 32)}` };
  const cpus = typeof opts.cpuCount === "number" && Number.isFinite(opts.cpuCount) && opts.cpuCount > 0
    ? opts.cpuCount
    : os.cpus().length;
  if (!(cpus > 0)) return { ok: false, reason: "cpu-count-unknown" };
  return { ok: true, load1, cpus, load_per_cpu: Math.round((load1 / cpus) * 1e4) / 1e4 };
}

/** The TURN RESERVE directive, prepended to BOTH arms' investigator prompts — and it must be prepended to
 *  BOTH, because the paired instrument's whole claim is that the two arms differ by the GUIDANCE BLOCK and
 *  nothing else. It states the cap, the reservation and the consequence, in the model's own terms. */
export function turnReserveDirective(maxTurns: number): string {
  const reserve = Math.max(1, Math.min(ANSWER_RESERVE_PROMPT_TURNS, Math.max(1, maxTurns - 1)));
  const stopBy = Math.max(1, maxTurns - reserve);
  return [
    "TURN BUDGET — READ THIS BEFORE YOU START.",
    `This call is capped at ${maxTurns} assistant turns and the cap is HARD: when it is reached the run is`,
    "killed immediately and NOTHING you have written is used, because no final answer is ever emitted.",
    `Reserve the last ${reserve} turn(s) for the answer. Concretely: STOP calling tools by turn ${stopBy}, and`,
    "spend your remaining turn(s) printing the hypothesis JSON block as your final message.",
    "An incomplete exploration WITH a printed block is worth strictly more than a complete exploration",
    "without one: a run cut off at the cap reports ZERO hypotheses and is discarded.",
  ].join("\n");
}

/** The instruction the reserve call carries. It is deliberately explicit that NO TOOLS are available, so a
 *  model that would keep exploring is told there is nothing left to explore with. */
export const ANSWER_RESERVE_INSTRUCTION = [
  "YOUR TURN BUDGET IS EXHAUSTED. You were cut off at the hard cap before printing your hypothesis block,",
  "which is why the run produced ZERO hypotheses. THIS call has NO TOOLS — you cannot read anything more.",
  "Report NOW, from the exploration notes appended below. Print ONLY the hypothesis JSON array your",
  "instructions require, with nothing else around it. If the notes do not settle a required field, state",
  "your best reading of it there rather than dropping the hypothesis; if they support no hypothesis at all,",
  "print [].",
].join("\n");

/** The reserve call's prompt: the run's OWN prompt (so the required JSON schema, the focus directive and
 *  the inventory are all still in front of the model), then the stop-exploring instruction, then the tail
 *  of the run's own narration — last, where recency is strongest. */
export function buildAnswerReservePrompt(basePrompt: string, explored: string): string {
  return `${basePrompt}\n\n${ANSWER_RESERVE_INSTRUCTION}\n\n--- YOUR EXPLORATION NOTES (tail) ---\n${explored}\n--- END OF NOTES ---\n`;
}

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
  /** The budget of the ONE fresh-context retry a truncated refuter gets. An OPTIONAL extra key (like
   *  `investigator_max_turns`), NOT one of the declared ten: a section written before the retry existed
   *  must keep parsing. Absent ⇒ `DEFAULT_REFUTATION_RETRY_MAX_TURNS` (the measured p100, see above). */
  refutationRetryMaxTurns: number;
  maxWallMs: number;
  maxModelCallsPer24h: number;
  maxUsdPer24h: number;
  /** How many ELIGIBLE rounds apart a PAIRED (same-budget baseline vs guided) gain round is run — the
   *  cadence of the instrument that measures whether method guidance helps at all. It is an OPTIONAL
   *  extra key (like `investigator_max_turns`), NOT one of the ten declared keys: a section written
   *  before the paired instrument existed must keep parsing to the stated cadence rather than failing. */
  gainEveryRounds: number;
  /** How many task-status transitions the round offers the model as OPTIONAL context. An OPTIONAL extra
   *  key like `investigator_max_turns` / `gain_every_rounds`: a section written before the task-status
   *  context existed must keep parsing rather than failing. */
  taskLogContextLimit: number;
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
  refutationRetryMaxTurns: DEFAULT_REFUTATION_RETRY_MAX_TURNS,
  maxWallMs: 1_200_000,
  maxModelCallsPer24h: 120,
  maxUsdPer24h: 30,
  gainEveryRounds: DEFAULT_GAIN_EVERY_ROUNDS,
  taskLogContextLimit: DEFAULT_TASK_LOG_CONTEXT_LIMIT,
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
  // ── `refutation_retry_max_turns`: THE FOURTH OPTIONAL EXTRA BOUND (the refuter's fresh-context retry).
  // ⛔ WHY ITS DEFAULT IS `max(<measured p100>, refutation_max_turns + 1)` RATHER THAN THE BARE CONSTANT:
  // the Plan's retry is «ONE retry with a LARGER budget», so a default that was not larger than the first
  // call's would silently make the retry a repeat of the same truncation. An operator who raises
  // `refutation_max_turns` past the measured p100 must not thereby turn the retry into a no-op — the
  // default follows the declared first budget, and a DECLARED retry budget must be strictly larger
  // (checked below) so «larger» is an invariant of this config rather than of its default.
  const retryTurns = rec.refutation_retry_max_turns === undefined || rec.refutation_retry_max_turns === null
    ? { value: Math.max(DEFAULT_REFUTATION_RETRY_MAX_TURNS, parsed.refutation_max_turns + 1), error: null }
    : intKey("refutation_retry_max_turns", 1);
  if (retryTurns.error) return { config: null, error: retryTurns.error };
  if ((retryTurns.value as number) <= parsed.refutation_max_turns) {
    return {
      config: null,
      error: cfgBad(
        `'refutation_retry_max_turns' must be > 'refutation_max_turns' (${retryTurns.value} <= ${parsed.refutation_max_turns}) — the retry is defined as ONE fresh-context call with a LARGER budget, and a retry that was not larger would repeat the truncation it exists to get past`,
      ),
    };
  }
  // `task_log_context_limit` is the THIRD optional extra bound (same rationale). Absent ⇒ the stated
  // default; present ⇒ a well-formed integer in [1, the read surface's own page maximum]. The UPPER bound
  // is refused HERE rather than left to the read: `readTaskLog` treats a limit above its maximum as a
  // usage error, so a section declaring 1000 would make every round read `ok:false` — a config typo would
  // then be indistinguishable from a broken read (硬规则 3b). The floor is 1, not 0: a `0` would offer
  // nothing while looking like a declared context, and "the context was switched off" already has a
  // spelling (omit the key ⇒ the default, or declare the whole section disabled).
  const taskLogLimit = rec.task_log_context_limit === undefined || rec.task_log_context_limit === null
    ? { value: DEFAULT_TASK_LOG_CONTEXT_LIMIT, error: null }
    : intKey("task_log_context_limit", 1);
  if (taskLogLimit.error) return { config: null, error: taskLogLimit.error };
  if ((taskLogLimit.value as number) > MAX_TASK_LOG_LIMIT) {
    return {
      config: null,
      error: cfgBad(
        `'task_log_context_limit' must be <= ${MAX_TASK_LOG_LIMIT} (the read surface's page maximum) — got ${taskLogLimit.value}`,
      ),
    };
  }
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
      refutationRetryMaxTurns: retryTurns.value as number,
      maxWallMs: parsed.max_wall_ms,
      maxModelCallsPer24h: parsed.max_model_calls_per_24h,
      maxUsdPer24h: usd,
      gainEveryRounds: gainEvery.value as number,
      taskLogContextLimit: taskLogLimit.value as number,
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
 *  mirror `runAsync` (finite ⇒ SIGKILL; every failure is returned, never thrown).
 *
 *  `signal`（gap-quality-restart-waits-out-whole-round-so-osd-in-flight-exceeds-stop-window，Plan 步 2）：
 *  常驻循环请求停机时 `abort()` 它 ⇒ **在飞的模型子进程被立刻 SIGKILL**，而不是等它自己跑完
 *  （实测 OSD 单轮 92s–1172s，等它跑完必然超出 60000ms 停机窗）。⛔ 这也把「停机延迟」从
 *  「一次模型调用的长度」压到「取消信号的传播延迟」，是 `stopped-mid-round` 能在有界时间内被记下的
 *  前提。缺省 `undefined` ⇒ 与从前逐字相同。 */
export function spawnModelCall(
  argv: string[],
  opts: { cwd: string; timeoutMs: number; stdinData?: string },
  signal?: AbortSignal,
): Promise<{ status: number | null; signal: string | null; stdout: string; stderr: string; error: Error | null }> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(argv[0], argv.slice(1), {
        cwd: opts.cwd,
        stdio: [opts.stdinData === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      });
    } catch (e) {
      resolve({ status: null, signal: null, stdout: "", stderr: "", error: e as Error });
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const abortSignal = signal ?? null;
    let onAbort: (() => void) | null = null;
    const finish = (status: number | null, signal: string | null, error: Error | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (abortSignal && onAbort) abortSignal.removeEventListener("abort", onAbort);
      resolve({ status, signal, stdout, stderr, error });
    };
    if (abortSignal) {
      if (abortSignal.aborted) {
        // ⛔ 已停机就**不 spawn**（子进程建了也立刻收掉）：把一次没人要的模型调用发出去，与
        //    「停机后不再取预留」是同一条纪律（AC3）。
        try { child.kill("SIGKILL"); } catch { /* already gone */ }
      } else {
        onAbort = () => {
          // ⛔ 立刻 SIGKILL（不是 SIGTERM + 等宽限）：停机要的是**有界**延迟，宽限属于调用方的
          //    `stopGraceMs`，不在这里再叠一层无界的等待。
          try { child.kill("SIGKILL"); } catch { /* already gone */ }
          finish(null, "SIGKILL", new Error(`${STOPPED_MID_ROUND}: the model call was killed by the resident loop's stop signal (${argv[0]})`));
        };
        abortSignal.addEventListener("abort", onAbort, { once: true });
      }
    }
    if (Number.isFinite(opts.timeoutMs)) {
      timer = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* already gone */ }
        finish(null, "SIGKILL", new Error(`spawn timeout after ${opts.timeoutMs}ms (SIGKILL): ${argv[0]}`));
      }, opts.timeoutMs);
    }
    if (opts.stdinData !== undefined && child.stdin) {
      child.stdin.on("error", () => { /* the child's own exit decides the outcome */ });
      child.stdin.end(opts.stdinData);
    }
    child.stdout?.on("data", (d) => { stdout += d; });
    child.stderr?.on("data", (d) => { stderr += d; });
    child.on("error", (e) => finish(null, null, e));
    // The SIGNAL is kept alongside the code: a call killed by a signal has `code:null`, and without the
    // signal the record could not say WHICH signal ended it (硬规则 3b — "killed" and "exited 0" must not
    // be the same reading).
    child.on("close", (code, signal) => finish(code, signal ?? null, null));
  });
}

// ── failure legibility: what a finished call says about HOW it ended (Plan item 1) ────────────────────
/** A bounded TAIL of a text stream, with the truncation itself RECORDED rather than implied. Truncating
 *  silently would make a short tail and a complete one read identically (硬规则 3b), so a reader gets
 *  `truncated` alongside the tail and never has to infer whether the cause was cut off. */
export function boundedTail(s: unknown, max: number): { tail: string; truncated: boolean; chars: number } {
  const text = typeof s === "string" ? s : "";
  return text.length <= max
    ? { tail: text, truncated: false, chars: text.length }
    : { tail: text.slice(text.length - max), truncated: true, chars: text.length };
}

/** The HEAD half of `boundedTail`, with the same recorded truncation. A stream's head is where the
 *  launcher's startup framing lives (the init event, the connectors notice); the tail is where a cause
 *  that arrived late lives. ⛔ Both are kept because a reader cannot know in advance which end holds the
 *  answer, and the pair is what makes "the stream started and then stopped" legible. */
export function boundedHead(s: unknown, max: number): { head: string; truncated: boolean; chars: number } {
  const text = typeof s === "string" ? s : "";
  return text.length <= max
    ? { head: text, truncated: false, chars: text.length }
    : { head: text.slice(0, max), truncated: true, chars: text.length };
}

/** The ENUMERATED class of a call that did not produce a usable answer, from the captured bytes alone
 *  (Plan item 2). Returns `null` when a `result` event WAS emitted — such a call is described by its own
 *  subtype, not by this table. ⛔ `unclassified` is a REAL value and is never folded into success: it
 *  names "the bytes do not match any known shape", which is a reading, not an absence of one.
 *
 *  Precedence is stated rather than incidental, because MORE THAN ONE can be true of the same bytes:
 *    1. `killed-by-timeout` — the timeout reaper ended it; whatever bytes exist are a fragment;
 *    2. `no-stdout`         — nothing came back at all (0 bytes);
 *    3. `truncated-json`    — the LAST line was cut mid-write;
 *    4. `api-error-event`   — the stream carried an API-transport error;
 *    5. `stream-without-result` — JSON events parsed, but no `result` was ever emitted;
 *    6. `unclassified`      — bytes that match none of the above (e.g. non-JSON output, no result).
 *  ⛔ String comparisons only — this file carries no regular expression (case (l)). */
export function callFailureClass(d: {
  timed_out?: unknown;
  stdout_bytes?: unknown;
  json_lines?: unknown;
  truncated_json?: unknown;
  api_error_event?: unknown;
  has_result?: unknown;
}): string | null {
  if (d.timed_out === true) return "killed-by-timeout";
  if (!(typeof d.stdout_bytes === "number" && d.stdout_bytes > 0)) return "no-stdout";
  if (d.truncated_json === true) return "truncated-json";
  if (d.api_error_event === true) return "api-error-event";
  if (d.has_result === true) return null;
  return typeof d.json_lines === "number" && d.json_lines > 0 ? "stream-without-result" : "unclassified";
}

/** Write the bounded head/tail capture of a failed or result-less call under `.quay/` and return the
 *  BOUNDED DESCRIPTION that goes on the call record. ⛔ The record carries the path AND both sizes AND
 *  both truncation flags, so "the capture is short because the stream was short" and "…because the bound
 *  cut it" are different readings (硬规则 3b). The file is overwritten per call id, never appended to. */
export function writeCallCapture(
  root: string,
  file: string,
  parts: { stdout: unknown; stderr: unknown },
): { path: string; bytes: number; stdout_bytes: number; stdout_head_chars: number; stdout_head_truncated: boolean; stdout_tail_chars: number; stdout_tail_truncated: boolean; stderr_chars: number; stderr_tail_truncated: boolean } {
  const stdout = typeof parts.stdout === "string" ? parts.stdout : "";
  const stderr = typeof parts.stderr === "string" ? parts.stderr : "";
  const head = boundedHead(stdout, STDOUT_HEAD_MAX);
  const tail = boundedTail(stdout, STDOUT_TAIL_MAX);
  const errTail = boundedTail(stderr, STDERR_TAIL_MAX);
  const body = [
    `# stdout head (first ${STDOUT_HEAD_MAX} chars${head.truncated ? ", TRUNCATED" : ""})`,
    head.head,
    `# stdout tail (last ${STDOUT_TAIL_MAX} chars${tail.truncated ? ", TRUNCATED" : ""})`,
    tail.tail,
    `# stderr tail (last ${STDERR_TAIL_MAX} chars${errTail.truncated ? ", TRUNCATED" : ""})`,
    errTail.tail,
    "",
  ].join("\n");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, "utf8");
  return {
    path: asRel(root, file),
    bytes: Buffer.byteLength(body, "utf8"),
    stdout_bytes: Buffer.byteLength(stdout, "utf8"),
    stdout_head_chars: head.chars,
    stdout_head_truncated: head.truncated,
    stdout_tail_chars: tail.chars,
    stdout_tail_truncated: tail.truncated,
    stderr_chars: errTail.chars,
    stderr_tail_truncated: errTail.truncated,
  };
}

/** The `not-evaluated:<…>` token a FINISHED call must be reported as, or `null` when the call really ran.
 *  ⛔ 硬规则 3b, and this helper exists because the production record violated it: `exit 1` with `turns: 13`
 *  under a 12-turn cap and nothing else, so a call CUT OFF before it could answer was shaped exactly like
 *  a call that explored and found nothing ("0 hypotheses"). The stream's own `result.subtype` is the
 *  structural cause (`error_max_turns` / `error_during_execution`); a stream that did not parse has no
 *  subtype at all, and THAT is `uninstrumented` — never a silent success.
 *
 *  ⛔ `exit: 0` IS NO LONGER SUFFICIENT (task gap-open-discovery-model-calls-exit-without-result-…):
 *  production recorded calls that spent minutes of wall, emitted NO `result` event and reported 0 tokens,
 *  and this function returned `null` for them — the SAME bytes as an ordinary success, which is precisely
 *  the 硬规则 3b violation the task exists to close. A call exited 0 AND its stream carried a `result`
 *  event (`has_result:true`) AND that result was not an error (`is_error !== true`) is the one shape that
 *  reads as "the call ran"; exit 0 WITHOUT a result is `not-evaluated:no-result-event`. An exit that is
 *  not 0 keeps its existing reading (subtype, else `uninstrumented-exit-<n>`), so a call that DID fail
 *  loudly is not laundered into the new token.
 *  ⛔ `tied to `callFailureClass``: the two never contradict — where the class is non-null, this token is
 *  non-null too. (The converse does not hold and must not: a turn-cap kill carries a `result` event, so
 *  it has NO `call_failure` class, yet it most certainly did not answer.) */
export function callNotEvaluatedToken(rec: Record<string, unknown> | null | undefined): string | null {
  if (rec === null || rec === undefined || typeof rec !== "object") return "not-evaluated:no-call-record";
  // A timeout is its OWN ending, and it is checked before `spawn_error` so a killed call is not reported
  // as a generic spawn failure: `killed-by-timeout` is the class the retry policy keys on (Plan item 3).
  if (rec.timed_out === true) return "not-evaluated:killed-by-timeout";
  if (typeof rec.spawn_error === "string" && rec.spawn_error !== "") return "not-evaluated:spawn-error";
  const exit = rec.exit;
  if (exit === null || exit === undefined) return "not-evaluated:no-exit-status";
  const subtype = typeof rec.subtype === "string" && rec.subtype !== "" ? rec.subtype : null;
  // ⛔ ① AN API-TRANSPORT ERROR IS ITS OWN READING, whatever the exit code or subtype says. MEASURED
  // (task AC5, 2026-10-13): the gateway answers an unknown model with `exit 1`, `subtype:"success"`,
  // `is_error:true`, `has_result:true`, 0 tokens — so the subtype is NOT a usable name there, and reading
  // it verbatim produced the self-contradictory token `not-evaluated:success`. The structural predicate is
  // the stream reader's own `api_error_event` (which excludes the turn-cap kill, a budget fact, not an API
  // one), not `is_error` alone — `is_error` is true for `error_max_turns` too.
  if (rec.api_error_event === true) return "not-evaluated:api-error-event";
  const hasResult = rec.has_result === true;
  if (exit === 0) {
    // ⛔ THE FIX: exit 0 alone is not "it ran". The stream's OWN `result` event is the direct reading, and
    // `has_result !== true` covers both "no result event" and "the field was never captured" — 缺值 = 未查
    // (硬规则 6), so an uncaptured field must not be read as a success either.
    if (!hasResult) return subtype === null ? "not-evaluated:no-result-event" : `not-evaluated:${subtype}`;
    // A `result` event that says the run ERRORED is not a success just because the process exited 0.
    if (rec.is_error === true) return subtype === null ? "not-evaluated:uninstrumented-result-error" : `not-evaluated:${subtype}`;
    return null;
  }
  // ⛔ `success` is not a CAUSE: a non-zero exit whose subtype says `success` (the ① shape above, with the
  // capture missing) must fall through to the exit reading rather than mint `not-evaluated:success`.
  if (subtype !== null && subtype !== "success") return `not-evaluated:${subtype}`;
  return `not-evaluated:uninstrumented-exit-${String(exit)}`;
}

/** The FIRST `not-evaluated:<…>` token across a round's call records, or `null` when every call ran. The
 *  FIRST is the CAUSE: a round whose investigator was cut off and whose later steps then had nothing to
 *  read is ONE failure, and naming the last step would name a symptom of it. */
export function firstNotEvaluatedToken(calls: readonly Record<string, unknown>[]): string | null {
  for (const c of calls) {
    const t = callNotEvaluatedToken(c);
    if (t !== null) return t;
  }
  return null;
}

/** The reading of ONE step's answer-reserve calls, taken off the call records themselves. A step "was
 *  attempted" once per `*-report` call it left on the record, and "was rescued" when that call itself
 *  answered. PURE — the round's summary is a VIEW of its own ledger rather than a parallel counter that
 *  could disagree with it (硬规则 5b).
 *  ⛔ A RETRY record (`retry_of` set) is not a second attempt: it is the same attempt made again, so it is
 *  excluded here — otherwise a rescued step would report `attempted:2` for one reserve the round granted. */
export function summarizeReserve(calls: readonly Record<string, unknown>[]): {
  turns_reserved: number;
  attempted: number;
  rescued: number;
  not_evaluated: string[];
  steps: string[];
} {
  const reportCalls = calls.filter((c) => String(c.step).endsWith("-report") && c.retry_of === undefined);
  return {
    turns_reserved: ANSWER_RESERVE_PROMPT_TURNS,
    attempted: reportCalls.length,
    rescued: reportCalls.filter((c) => callNotEvaluatedToken(c) === null).length,
    not_evaluated: reportCalls.filter((c) => typeof c.not_evaluated === "string").map((c) => String(c.not_evaluated)),
    steps: reportCalls.map((c) => String(c.step)),
  };
}

// ── THE CLUSTER ↔ CALL JOIN, AND THE «WHY WAS IT UNDETERMINED» READING ────────────────────────────────
// THE DEFECT THIS CLOSES (task gap-open-discovery-refutation-chain-undetermined-is-unattributable-and-
// budget-truncated, Plan item 1). Production read `undetermined` on EVERY refutation it ever recorded, and
// the record could not tell three different situations apart:
//     (i)  the refuter was KILLED at its turn cap before it could answer (a BUDGET fact);
//     (ii) it read the code and genuinely found no counter-evidence (a SEMANTIC fact);
//     (iii) the call never answered at all — a broken/gateway call (an INFRASTRUCTURE fact).
// Worse, the two fields that were supposed to carry this were not the refuter's own: `refutation_turns`
// was read off the engine ROW, which is (a) in the engine's own `stream.turns.length` unit (tool calls),
// NOT the CLI's `num_turns` the cap is expressed in, and (b) — when a truncated call was rescued — the
// RESCUE's row rather than the refuter's. Measured 2026-10-12: cluster 20:40#3 recorded
// `refutation_turns:0` while its refuter call had run 7 turns (the 0 was the tool-less rescue's), and
// cluster 21:47#3 recorded `refutation_turns:9` for a call that emitted no result at all.
//
// ⛔ THE PREDICATE IS THE CALL RECORD'S OWN, never a second derivation: `callNotEvaluatedToken` already
// answers «did this call run?» from the captured bytes (硬规则 5b), so the cause is a MAPPING of that
// token plus the engine's own coarse `verdict_cause` — not a third reading of the stream.
export const REFUTATION_UNDETERMINED_CAUSES = ["budget-truncated", "no-counter-evidence", "call-failed", "unparseable"] as const;
export type RefutationUndeterminedCause = (typeof REFUTATION_UNDETERMINED_CAUSES)[number];

/** WHY a refutation ended `undetermined`, or `null` when it is DETERMINATE. The four values are the Plan's
 *  own vocabulary, and each is a different FACT about the round:
 *    • `budget-truncated`   — the call was killed at the turn cap (`error_max_turns`). A BUDGET fact: the
 *      refuter never finished reading, so «no counterexample» was never established. This is the ONE cause
 *      the retry exists for;
 *    • `call-failed`        — the call did not answer at all (a non-zero exit with no result, a spawn
 *      error, a timeout, an API/gateway refusal). An INFRASTRUCTURE fact, and a retry with more turns
 *      would only reproduce it — which is why the retry keys on `budget-truncated` ALONE;
 *    • `unparseable`        — the call ANSWERED, but its text was not a readable verdict (no JSON object,
 *      or a `verdict` outside the declared vocabulary). The model spoke; what it said could not be read;
 *    • `no-counter-evidence`— the call ANSWERED with `verdict:"undetermined"`: it read the code and the
 *      code did not settle the claim. This is the ONLY one of the four that is a statement about the
 *      repository rather than about the round, and it is still NOT a confirmation (the governing rule is
 *      unchanged: undetermined is never confirmed).
 *  ⛔ `token` is checked FIRST: a call that never answered has no verdict to read, whatever a parser made
 *  of the bytes it left behind — reading the verdict first is exactly how a killed call was laundered into
 *  «found nothing» (硬规则 3b). */
export function refutationUndeterminedCause(input: {
  token: string | null;
  verdict: string | null;
  verdictCause: string | null;
}): RefutationUndeterminedCause | null {
  if (input.token !== null) return input.token === "not-evaluated:error_max_turns" ? "budget-truncated" : "call-failed";
  // A determinate verdict, from a call that ran: the ONE shape that may reach `confirmed`.
  if (input.verdict === "supported" || input.verdict === "refuted") return null;
  if (input.verdictCause === "unparseable" || input.verdictCause === "verdict-not-in-vocab") return "unparseable";
  if (input.verdict === "undetermined") return "no-counter-evidence";
  // Everything else — a row with no verdict and no cause the vocabulary names — is an answer that could
  // not be read. Fail-closed toward «we do not know», never toward «nothing found».
  return "unparseable";
}

// ── THE PER-CLUSTER ATTRIBUTION JOIN + THE RESIDENT-ROUND DoD ─────────────────────────────────────────
// THE DEFECT THIS CLOSES (task gap-osd-resident-round-never-autonomously-confirms-fix-attribution-and-
// call-failed-retry, Plan items 3-4). A round's `confirmed:0` was a ROUND-level fact with no per-cluster
// explanation: the refutation fields say why the REFUTER did not settle a cluster, but for a cluster the
// VERIFIER never supported the refuter's `not-run` is a *consequence*, not a cause — and nothing on the
// record named the verifier's own failure as the thing that BLOCKED the cluster. So "the mechanism worked
// and correctly found nothing confirmable this round" and "the mechanism failed to judge" were isomorphic
// on the carrier (硬规则 3b) — which is exactly the reading a coordinator auditing `confirmed:0` needs.
//
// ⛔ ONE PLACE, TWO READERS (硬规则 5b). `clusterAttribution` is the ONLY producer of the per-cluster
// reading; the round's `attribution` block and the `--report` surface are pure VIEWS of the blocks it
// wrote, so a cluster-level verdict and a round-level rate can never disagree about the same cluster.
// ⛔ THE GOVERNING CONSTRAINT IS UNCHANGED: `undetermined` is never confirmed. Nothing here can raise
// `confirmed` — it only NAMES why a cluster that was not confirmed was not.
export const CLUSTER_BLOCKING_STEPS = ["none", "verifier", "refuter"] as const;
export type ClusterBlockingStep = (typeof CLUSTER_BLOCKING_STEPS)[number];

export interface ClusterAttribution {
  /** The cluster reached a judgement the mechanism can defend: confirmed, refuted, or undetermined because
   *  the refuter READ the code and the code did not settle the claim. A budget kill, an infrastructure
   *  failure or an unreadable answer is NOT determinate — «we could not judge» is not «we judged». */
  determinate: boolean;
  /** WHICH STEP BLOCKED the cluster — `none` when nothing did. A cluster whose VERIFIER did not support it
   *  is blocked at the verifier; its refuter's `not-run` is a CONSEQUENCE, never the cause. */
  blocking_step: ClusterBlockingStep;
  /** THAT STEP'S OWN CAUSE, in the vocabulary the step already speaks: a refuter cause
   *  (`budget-truncated` / `call-failed` / `unparseable` / `no-counter-evidence`), or the verifier row's
   *  own `verdict_cause` (`exit-1` / `turn-budget` / …). `null` exactly when `blocking_step` is `none`. */
  blocking_cause: string | null;
}

/** THE JOIN. Pure: every input is a value the cluster record already carries, so this is a READ of the
 *  round rather than a third derivation of it. See `ClusterAttribution` for the vocabulary. */
export function clusterAttribution(input: {
  verifierVerdict: string | null;
  verifierCause: string | null;
  /** `not-run` when the verifier did not support the cluster — the refuter was never called. */
  refutationVerdict: string | null;
  refutationUndeterminedCause: string | null;
}): ClusterAttribution {
  const determinate = { determinate: true, blocking_step: "none" as const, blocking_cause: null };
  if (input.verifierVerdict === "supported") {
    // The refuter is the only step that can still block a supported cluster.
    if (input.refutationVerdict === "supported" || input.refutationVerdict === "refuted") return determinate;
    if (input.refutationVerdict !== null && input.refutationUndeterminedCause === "no-counter-evidence") {
      // The refuter ANSWERED — it read the code and the code did not settle the claim. That is a statement
      // about the REPOSITORY, not about the round, so the cluster IS judged, and judged «not confirmable».
      return determinate;
    }
    return {
      determinate: false,
      blocking_step: "refuter",
      // `null` here means the cluster carried no cause at all (an older record, or a path that never
      // reached the join) — which is its OWN reading, never silently defaulted to a named cause.
      blocking_cause: input.refutationUndeterminedCause ?? "unattributed",
    };
  }
  if (input.verifierVerdict === "refuted") {
    // A verifier that REFUTED the hypothesis has judged it — a determinate NEGATIVE finding. It is not a
    // confirmation (the governing constraint is unchanged), and it is not a failure either.
    return determinate;
  }
  return {
    determinate: false,
    blocking_step: "verifier",
    blocking_cause: input.verifierCause ?? (input.verifierVerdict === null ? "unattributed" : input.verifierVerdict),
  };
}

/** THE SAME JOIN, READ OFF A CLUSTER LINE'S OWN FIELDS. `clusterAttribution` needs four values and a
 *  cluster record already carries all four — so a line written BEFORE this block existed is still
 *  joinable, and the whole corpus can be read with one definition rather than a second one written for
 *  old records (硬规则 5b).
 *  ⛔ THE PROVENANCE IS NOT THE SAME AND MUST NOT BE SHARED: a block the round WROTE and a block derived
 *  afterwards from the same line are two different readings, and `derivedFromClusterRecord` says which
 *  one a caller has. A derivation cannot be a measurement of itself (硬规则 4 推论三) — that is why the
 *  ROUND still writes its own block, and this helper is for reading records that have none. */
export function clusterAttributionFromRecord(cluster: Record<string, unknown> | null | undefined): {
  attribution: ClusterAttribution;
  derivedFromClusterRecord: boolean;
} {
  const c = cluster ?? {};
  return {
    attribution: clusterAttribution({
      verifierVerdict: typeof c.verifier_verdict === "string" ? c.verifier_verdict : null,
      verifierCause: typeof c.verifier_cause === "string" ? c.verifier_cause : null,
      refutationVerdict: typeof c.refutation_verdict === "string" ? c.refutation_verdict : null,
      refutationUndeterminedCause: typeof c.refutation_undetermined_cause === "string" ? c.refutation_undetermined_cause : null,
    }),
    derivedFromClusterRecord: true,
  };
}

/** The causes a HEALTHY resident round may still carry. A cluster blocked by one of these was judged (or
 *  judged «not confirmable») rather than lost to the mechanism's own budget — which is the ONLY thing the
 *  resident-round DoD is about. ⛔ `budget-truncated` and a bare `unattributed` are deliberately ABSENT:
 *  both mean the step never got to speak, which is precisely the state this task exists to make visible
 *  and then remove. */
export const HEALTHY_BLOCKING_CAUSES: readonly string[] = ["no-counter-evidence", "unparseable", "call-failed"];

/** THE ROUND-LEVEL VIEW OF THE JOIN, computed from the cluster records' OWN `attribution` blocks — never
 *  re-derived from the raw verdicts, so the two levels cannot disagree (硬规则 5b).
 *  ⛔ `determinate_rate` is `null` when the round verified NOTHING: «no cluster was judged» and «every
 *  cluster was judged» must not share a shape (硬规则 3b). */
export interface RoundAttribution {
  verified: number;
  confirmed: number;
  determinate: number;
  determinate_rate: number | null;
  blocked: { verifier: number; refuter: number };
  /** `"<blocking_step>:<blocking_cause>"` ⇒ how many clusters were blocked that way. */
  causes: Record<string, number>;
  /** The resident-round DoD: every VERIFIED cluster was judged or honestly named. `null` when the round
   *  verified nothing (nothing was asked of it). */
  healthy: boolean | null;
  basis: string;
}

export function roundAttribution(clusters: readonly Record<string, unknown>[]): RoundAttribution {
  const blocks = clusters.map((c) => (c.attribution ?? null) as ClusterAttribution | null);
  const verified = clusters.length;
  const confirmed = clusters.filter((c) => c.confirmed === true).length;
  const determinate = blocks.filter((b) => b !== null && b.determinate === true).length;
  const blocked = {
    verifier: blocks.filter((b) => b !== null && b.blocking_step === "verifier").length,
    refuter: blocks.filter((b) => b !== null && b.blocking_step === "refuter").length,
  };
  const causes: Record<string, number> = {};
  for (const b of blocks) {
    if (b === null || b.blocking_step === "none") continue;
    const key = `${b.blocking_step}:${String(b.blocking_cause)}`;
    causes[key] = (causes[key] ?? 0) + 1;
  }
  const unhealthy = blocks.filter(
    (b) => b !== null && b.blocking_step !== "none" && !HEALTHY_BLOCKING_CAUSES.includes(String(b.blocking_cause)),
  ).length;
  const unattributed = blocks.filter((b) => b === null).length;
  return {
    verified,
    confirmed,
    determinate,
    determinate_rate: verified === 0 ? null : determinate / verified,
    blocked,
    causes,
    healthy: verified === 0 ? null : unhealthy === 0 && unattributed === 0,
    basis:
      verified === 0
        ? "no cluster was verified — the round was asked to judge nothing, so it is neither healthy nor unhealthy"
        : `${determinate}/${verified} verified clusters judged; ${unhealthy} lost to a non-naming cause, ${unattributed} carrying no attribution block at all`,
  };
}

/** THE ROLLING READING — the DoD as a RATE over the last `window` RESIDENT rounds, not a per-round
 *  boolean. Plan item 4's stated DoD: «of N verified clusters, every one reaches a determinate outcome
 *  (confirmed, refuted, or a named, non-budget cause)». A single round that verified nothing neither
 *  raises nor lowers it. ⛔ RESIDENT ONLY: a `manual` round is not production, and counting one here is
 *  how a coordinator-triggered round would silently stand in for autonomy. */
export function residentRoundHealth(
  records: readonly Record<string, unknown>[],
  opts: { window?: number; invokedBy?: string } = {},
): {
  window: number;
  rounds: number;
  /** How many of the window's rounds actually CARRY an attribution block. A round written before this
   *  reading existed has none, and is excluded from every count below — see `healthy`. */
  attributed_rounds: number;
  verified: number;
  determinate: number;
  determinate_rate: number | null;
  unhealthy_rounds: number;
  causes: Record<string, number>;
  healthy: boolean | null;
  basis: string;
} {
  const window = opts.window ?? RESIDENT_HEALTH_WINDOW_ROUNDS;
  const invokedBy = opts.invokedBy ?? INVOKED_BY_RESIDENT;
  const resident = records.filter((r) => r.kind === "scan-round" && r.invoked_by === invokedBy);
  const slice = resident.slice(Math.max(0, resident.length - window));
  let attributed = 0;
  let verified = 0;
  let determinate = 0;
  let unhealthyRounds = 0;
  const causes: Record<string, number> = {};
  for (const r of slice) {
    const a = (r.attribution ?? null) as RoundAttribution | null;
    // ⛔ A round with NO attribution block is NOT a healthy round: it is an UNEVALUATED one. Counting it
    // as healthy is exactly the 硬规则 3b shape — «nothing was read» must never share an output with
    // «everything was read and was fine».
    if (a === null || typeof a !== "object") continue;
    attributed++;
    verified += Number(a.verified ?? 0);
    determinate += Number(a.determinate ?? 0);
    if (a.healthy === false) unhealthyRounds++;
    for (const [k, v] of Object.entries((a.causes ?? {}) as Record<string, number>)) causes[k] = (causes[k] ?? 0) + Number(v);
  }
  const unevaluated = slice.length - attributed;
  return {
    window,
    rounds: slice.length,
    attributed_rounds: attributed,
    verified,
    determinate,
    determinate_rate: verified === 0 ? null : determinate / verified,
    unhealthy_rounds: unhealthyRounds,
    causes,
    // `null` unless at least one round of the window carried the reading: a window that attributed
    // NOTHING has no verdict, it does not have a good one.
    healthy: attributed === 0 ? null : unhealthyRounds === 0,
    basis:
      slice.length === 0
        ? `no ${invokedBy} round on the carrier — nothing to rate (NOT «all healthy»)`
        : attributed === 0
          ? `none of the last ${slice.length} ${invokedBy} round(s) carry an attribution block — nothing was rated (NOT «all healthy»)`
          : `${unhealthyRounds}/${attributed} attributed ${invokedBy} round(s) of the last ${window} lost a verified cluster to a non-naming cause; ${determinate}/${verified} verified clusters judged` +
            (unevaluated === 0 ? "" : `; ${unevaluated} round(s) predate the attribution block and are excluded`),
  };
}

/** How many resident rounds the rolling DoD reads. Five is a STATED window, not a measured one: it is the
 *  smallest count that survives one unlucky round without hiding a run of them, and it is reported
 *  alongside every reading so a consumer never has to guess which window produced the rate. */
export const RESIDENT_HEALTH_WINDOW_ROUNDS = 5;

// ── THE «call-failed» FURTHER CLASSIFICATION, AND THE RETRY DECISION IT SUPPORTS ──────────────────────
// Plan item 2 asks for a decision about whether the `call-failed` class should be retried, with a
// PRODUCTION-MEASURED basis, and — when it should not — for the class to be classified FURTHER instead.
//
// ⛔ THE DECISION: DO NOT EXTEND THE RETRY. It is NOT a guess; it is the measured retry-then-succeeds rate
// of the class on the production carrier at 2026-10-13T15:30Z. `reservingStep` already retries the
// TRANSPORT classes ONCE (the 2026-10-13 round alone produced three: verifier `…-3`→`…-4`, refuter
// `…-5`→`…-6`, refuter `…-7`→`…-8`), and NOT ONE of the three retries answered — `…-4` and `…-8` came
// back in the SAME class as the call they repeated, `…-6` came back `error_max_turns`. Across the whole
// corpus the ONLY retry that ever answered was a retry of an `error_max_turns` call (`…-9`→`…-10`, which
// returned `success` at 24 turns) — i.e. the budget retry already works where the data says it should,
// and the call-failed retry has a measured success rate of 0. Extending it further would spend counted
// reservations reproducing a failure the corpus has already shown it does not cure.
//
// ⛔ THE FURTHER CLASSIFICATION: the class is NOT step-neutral, and the split below is the reading that
// says so. What follows is a ROW PER STEP ENVELOPE, computed from the corpus — NOT a causal claim. The
// grouping is deliberately (step, tools, max_turns) together because those three covary on this pin
// (the two `Read,Grep`-only steps also carry the two SMALLEST caps), so a bare «empty Glob correlates
// with failure» reading would be exactly the kind of explanation 硬规则 4 推论四 forbids: it names a
// candidate cause without a control that would have gone the other way. The rate is REPORTED with its
// confound, and the confound is named, so the next task can design the control rather than inherit a
// conclusion this one did not earn.
export interface CallFailureSplitRow {
  step: string;
  tools: string;
  max_turns: number | null;
  /** FIRST attempts only: a transport retry is the same attempt made again, and counting it here would
   *  double every lost call's weight (the retry has its OWN row in `CallFailureSplit.retries`). */
  calls: number;
  answered: number;
  failed: number;
  failed_rate: number | null;
  /** `not-evaluated:<…>` token ⇒ how many FIRST attempts ended that way. */
  causes: Record<string, number>;
}

export interface RetryReading {
  attempts: number;
  answered: number;
  answered_rate: number | null;
  /** The retry class, read off the retried call's own `retry_cause` / `budget_retry_cause`. */
  by_cause: Record<string, { attempts: number; answered: number }>;
}

/** THE CLASSIFICATION, AS A PURE READING OF THE CARRIER. `records` is every line of the findings carrier;
 *  the scan-round lines' `calls` are what it reads. Idempotent, spawns nothing, and is the same function
 *  the `--report` surface prints — so the pasted evidence and the shipped report cannot diverge. */
export function callFailureSplit(records: readonly Record<string, unknown>[]): {
  rows: CallFailureSplitRow[];
  retries: RetryReading;
} {
  const byKey = new Map<string, CallFailureSplitRow>();
  const retryByCause = new Map<string, { attempts: number; answered: number }>();
  let retryAttempts = 0;
  let retryAnswered = 0;
  for (const r of records) {
    if (r.kind !== "scan-round") continue;
    const calls = Array.isArray(r.calls) ? (r.calls as Record<string, unknown>[]) : [];
    for (const c of calls) {
      const token = callNotEvaluatedToken(c);
      const answered = token === null;
      // ── A RETRY IS A SEPARATE POPULATION (Plan item 2's own measurement) ────────────────────────────
      const isRetry = c.retry_of !== undefined || c.budget_retry === true;
      if (isRetry) {
        retryAttempts++;
        if (answered) retryAnswered++;
        const cause = typeof c.retry_cause === "string" ? c.retry_cause
          : typeof c.budget_retry_cause === "string" ? c.budget_retry_cause
            : "unclassified";
        const row = retryByCause.get(cause) ?? { attempts: 0, answered: 0 };
        row.attempts++;
        if (answered) row.answered++;
        retryByCause.set(cause, row);
        continue;
      }
      const step = typeof c.step === "string" ? c.step : "(no-step)";
      const tools = typeof c.tools === "string" ? c.tools : "(no-tools)";
      const maxTurns = typeof c.max_turns === "number" && Number.isFinite(c.max_turns) ? c.max_turns : null;
      const key = `${step}\u0000${tools}\u0000${String(maxTurns)}`;
      const row = byKey.get(key) ?? { step, tools, max_turns: maxTurns, calls: 0, answered: 0, failed: 0, failed_rate: null, causes: {} };
      row.calls++;
      if (answered) row.answered++;
      else {
        row.failed++;
        row.causes[String(token)] = (row.causes[String(token)] ?? 0) + 1;
      }
      byKey.set(key, row);
    }
  }
  const rows = [...byKey.values()].map((row) => ({ ...row, failed_rate: row.calls === 0 ? null : row.failed / row.calls }));
  rows.sort((a, b) => b.failed_rate! - a.failed_rate! || a.step.localeCompare(b.step) || a.tools.localeCompare(b.tools));
  return {
    rows,
    retries: {
      attempts: retryAttempts,
      answered: retryAnswered,
      answered_rate: retryAttempts === 0 ? null : retryAnswered / retryAttempts,
      by_cause: Object.fromEntries([...retryByCause.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    },
  };
}

/** ONE refuter call, as the cluster record carries it. Every field is read from the CALL RECORD that
 *  produced the answer — never from the engine row, whose units and whose identity (the rescue vs the
 *  call) are precisely what the old join got wrong. */
export interface RefutationCallSummary {
  /** Which call this was, in the retry chain: `first` / `retry` / a tool-less `rescue`. */
  role: string;
  step: string | null;
  reservation_id: string | null;
  /** The CLI's OWN turn unit (`result.num_turns`) — the unit `--max-turns` is expressed in. `null` when
   *  the stream never reported one: absent is absent, never 0 (硬规则 3b). */
  num_turns: number | null;
  /** The realized tool-call count (`stream.turns.length`) — a DIFFERENT unit from `num_turns`, kept
   *  beside it so the two can never be confused again. */
  tool_turns: number | null;
  /** The stream's structural subtype (`error_max_turns` / `success` / …), `null` when it did not parse. */
  subtype: string | null;
  exit: number | null;
  not_evaluated: string | null;
  cost_usd: number | null;
  /** `{Read:2, Grep:1}` — the DIRECT evidence that this call read the tree. */
  tool_use: { total: number; by_tool: Record<string, number>; paths: unknown[]; paths_truncated: boolean } | null;
}
export interface RefutationReading {
  /** `supported` = SURVIVED (determinate), `refuted` (determinate), `undetermined`, `not-run`. */
  verdict: string;
  counterexample: unknown;
  /** The positions the refuter says it checked — present only when its answer named any. */
  checked: unknown[] | null;
  /** `null` ⇒ the verdict is DETERMINATE (the only case that may reach `confirmed`). */
  undetermined_cause: RefutationUndeterminedCause | null;
  /** The calls this cluster's refutation consumed, in call order. */
  calls: RefutationCallSummary[];
  /** The call whose answer the verdict was read from — the LAST one that ran. `null` when none did. */
  answered_by: string | null;
  /** The CLI's own `num_turns` of the ANSWERING call. */
  turns: number | null;
  subtype: string | null;
  cost_usd: number | null;
  /** The answering call's tool-use reading — what makes «survived» attributable. */
  tool_use: RefutationCallSummary["tool_use"];
  /** How many evidence lines the refuter's own answer cited. */
  evidence_cited: number;
  reservation_ids: string[];
  retried: boolean;
}

/** THE JOIN ITSELF. `calls` is the list of refuter calls THIS cluster consumed, captured at the call site
 *  (so a second cluster's calls can never appear in a first cluster's reading — the Plan's «two clusters
 *  whose refuter calls differ ⇒ each cluster's fields equal its OWN call's»). `result` is the engine row
 *  the ANSWERING stream produced, or `null` when no refuter ran.
 *  ⛔ The answering call is the LAST one in the list: a fresh-context retry SUPERSEDES the truncated call
 *  it repeats, so the verdict is read from the retry's stream (which is also the stream the engine's
 *  `runModel` returned — the two agree by construction rather than by a second lookup). */
export function refutationReading(input: {
  calls: readonly Record<string, unknown>[];
  result: Record<string, unknown> | null;
}): RefutationReading {
  const summarize = (c: Record<string, unknown>, role: string): RefutationCallSummary => ({
    role,
    step: typeof c.step === "string" ? c.step : null,
    reservation_id: typeof c.reservation_id === "string" ? c.reservation_id : null,
    num_turns: typeof c.num_turns === "number" && Number.isFinite(c.num_turns) ? c.num_turns : null,
    tool_turns: typeof c.turns === "number" && Number.isFinite(c.turns) ? c.turns : null,
    subtype: typeof c.subtype === "string" && c.subtype !== "" ? c.subtype : null,
    exit: typeof c.exit === "number" ? c.exit : null,
    not_evaluated: typeof c.not_evaluated === "string" ? c.not_evaluated : null,
    cost_usd: typeof c.cost_charged_usd === "number" ? c.cost_charged_usd : null,
    tool_use: (c.tool_use ?? null) as RefutationCallSummary["tool_use"],
  });
  // The role of a call in the chain: the FIRST is the refuter's own attempt; anything after it is either
  // the budget retry (marked with its own cause) or a tool-less answer reserve.
  const roleOf = (c: Record<string, unknown>): string => (c.budget_retry === true ? "retry" : "rescue");
  const calls = input.calls.map((c, i) => summarize(c, i === 0 ? "first" : roleOf(c)));
  const answering = input.calls.length > 0 ? input.calls[input.calls.length - 1] : null;
  const answered = answering === null ? null : calls[calls.length - 1];
  const token = answering === null ? null : callNotEvaluatedToken(answering);
  const verdict = input.result === null ? "not-run" : (typeof input.result.verdict === "string" ? input.result.verdict : "undetermined");
  const cause = input.result === null
    ? null
    : refutationUndeterminedCause({
      token,
      verdict: typeof input.result.verdict === "string" ? input.result.verdict : null,
      verdictCause: typeof input.result.verdict_cause === "string" ? input.result.verdict_cause : null,
    });
  return {
    verdict,
    counterexample: input.result === null ? null : (input.result.counterexample ?? null),
    checked: input.result !== null && Array.isArray(input.result.checked) ? (input.result.checked as unknown[]) : null,
    undetermined_cause: cause,
    calls,
    answered_by: answered === null ? null : answered.role,
    // ⛔ THE FIX: the CLI unit, from the CALL, not the engine row's tool-call count.
    turns: answered === null ? null : answered.num_turns,
    subtype: answered === null ? null : answered.subtype,
    cost_usd: answered === null ? null : answered.cost_usd,
    tool_use: answered === null ? null : answered.tool_use,
    evidence_cited: input.result !== null && Array.isArray(input.result.evidence) ? (input.result.evidence as unknown[]).length : 0,
    reservation_ids: calls.map((c) => c.reservation_id).filter((x): x is string => x !== null),
    retried: calls.some((c) => c.role === "retry"),
  };
}

// ── the engine modules: resolved from DISK at runtime, never statically imported (see the header) ────
export const HYPOTHESIS_MODULE_FILE = "arch-hypothesis-generation.mjs";
export const PORTFOLIO_MODULE_FILE = "discovery-portfolio.mjs";
export const LEDGER_MODULE_FILE = "discovery-experience-ledger.mjs";
/** The Discovery Method registry — the reader a round consults to decide whether a METHOD may guide it
 *  (task gap-open-discovery-method-guidance-active-shadow). Loaded from disk like its siblings. */
export const REGISTRY_MODULE_FILE = "discovery-method-registry.mjs";
export const ANALYSIS_DIR_REL = path.posix.join("docs", "analysis");

/** ⛔ THE PACKAGING SINGLE SOURCE. Every engine module file this routine resolves out of `docs/analysis/`
 *  at runtime, named ONCE here so `packages/quay/scripts/build-plugin-dist.mjs` derives what the shipped
 *  artifact must carry from THIS list — never from a hand-maintained list on the build side (the same
 *  discipline as `driver-runtime.ts`'s DRIVER_KINDS table and Core's SIBLING_SCRIPTS manifest: the table
 *  the code itself reads is the table the build reads). A file named here and absent from the artifact is
 *  the exact defect this constant exists to close — `loadOpenDiscoveryModules` already refuses with a
 *  NAMED reason rather than a silent zero (硬规则 3b). */
export const OPEN_DISCOVERY_ENGINE_MODULES = [
  HYPOTHESIS_MODULE_FILE,
  PORTFOLIO_MODULE_FILE,
  LEDGER_MODULE_FILE,
  REGISTRY_MODULE_FILE,
] as const;

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
  parseVerifierStream: (stdout: string) => { ok?: boolean; num_turns?: unknown; model?: unknown; usage?: unknown; cost_usd?: unknown; hasResult?: unknown };
  /** The STRUCTURAL reading of the launcher's stdout — event counts by `type`, whether a `result` was
   *  emitted, whether the last line was cut mid-write. Consumed here rather than re-derived, so the ONE
   *  stream reader is the engine's (硬规则 5b); it is the direct reading that turns an `exit:0` with no
   *  result into a named failure instead of a silent success. */
  streamDiagnostics: (stdout: string) => {
    bytes?: unknown; lines?: unknown; json_lines?: unknown; non_json_lines?: unknown; unparsed_json_lines?: unknown;
    truncated_json?: unknown; has_result?: unknown; events_by_type?: unknown; api_error_event?: unknown;
  };
  callText: (stdout: string) => string;
  /** The TOOL-USE reading of one instrumented call (counts by tool + the first N argument heads), read
   *  off the per-turn records `parseVerifierStream` already produced. Consumed rather than re-derived
   *  (硬规则 5b) so the ONE reader of the parsed turn shape is the engine's; it is what makes a refutation
   *  verdict ATTRIBUTABLE («this call read the tree» vs «it answered from its prompt»). */
  toolUseSummary: (turns: unknown, opts?: { maxPaths?: number }) => {
    total?: unknown; by_tool?: unknown; paths?: unknown; paths_truncated?: unknown;
  };
  defaultVerifierPrompt: (here?: string) => string;
  defaultInvestigatorPrompt: (here?: string) => string;
  TOOL: string;
  /** ⛔ THE PRODUCTION VALIDATOR + STORE WRITER, consumed rather than re-implemented (硬规则 5b).
   *  `emit` validates every record with the engine's own `validateRecord`, optionally appends it to the
   *  production evidence store, and RETURNS the tally — accepted/refused counts, per-reason refusal
   *  counts, and the per-record store refusals — so a caller can REPORT a refusal instead of losing it.
   *  This routine passes `writeStore:true` (it is the ONE resident producer of that store); the `out`
   *  artifact is not used, so `--write-store`'s manual CLI semantics are untouched. */
  emit: (records: readonly { kind: string; rec: Record<string, unknown> }[], opts: { out?: string | null; writeStore?: boolean; root?: string | null }) => {
    accepted: number; refused: number; reasons: Record<string, number>; stored: number;
    storeRefused: { kind: string; reasons: string[] }[];
  };
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
  /** ⛔ THE SHARED-CHECKOUT RESOLVER THE LEDGER OWNS — reused, never re-derived (硬规则 5b). The
   *  evidence store is read by `ingestNewOutcomes` through THIS resolution, so a projection written to
   *  the caller's worktree would be invisible to the ingester: both sides must name the same checkout. */
  resolveCarrierRoot: (root: string) => { ok: boolean; root?: string; reason?: string };
  /** The WRITE side of the routine → evidence-store projection (see `clusterStoreRecords`). The store's
   *  own record shapes and the verdict derivation live in the ledger module, beside the reader that
   *  projects them back into Experiences. */
  clusterStoreRecords: (clusterRecords: readonly Record<string, unknown>[], opts?: { experiment?: string; runId?: string | null }) => Array<{ kind: string; rec: Record<string, unknown> }>;
  CLUSTER_OUTCOME_EXPERIMENT: string;
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

/** THE ENGINE'S STREAM READER, EXPORTED FOR THE SIBLING ROUTINE THAT DRIVES A `claude -p` CALL WITHOUT
 *  the open-discovery module set (quality-gate-driver's architecture-review judge —
 *  gap-architecture-review-judge-call-shares-no-diagnostics-or-retry-with-osd).
 *
 *  WHY THIS IS A LOADER AND NOT A RE-EXPORT: `streamDiagnostics` lives in `docs/analysis/
 *  arch-hypothesis-generation.mjs`, which no shipped `plugin/scripts/*.ts` may statically import (the
 *  same case-(i) invariant that makes `loadOpenDiscoveryModules` go through a runtime `import()`).
 *  ⛔ ONE READER AND ONE RESOLUTION RULE (硬规则 5b): this resolves through the SAME `resolveEngineModule`
 *  and caches in the SAME `_engineModuleCache` OSD itself uses, so the driver's `call_failure` classes are
 *  read by the very function OSD reads them with — a second stream reader in the driver would be exactly
 *  the drift this task exists to prevent. It THROWS on an unresolvable module (naming the candidates it
 *  tried) rather than returning a silent no-op reader: "I could not read the stream" must never be shaped
 *  like "the stream was clean" (硬规则 3b). */
export async function loadStreamDiagnostics(root: string): Promise<HypothesisModule["streamDiagnostics"]> {
  const r = resolveEngineModule(root, HYPOTHESIS_MODULE_FILE);
  if (r.path === null) throw new Error(`ARCH_HYPOTHESIS_UNRESOLVED — ${HYPOTHESIS_MODULE_FILE} not found at ${r.tried.join(" or ")}`);
  let mod = _engineModuleCache.get(r.path);
  if (mod === undefined) {
    mod = await import(/* @vite-ignore */ pathToFileURL(r.path).href);
    _engineModuleCache.set(r.path, mod);
  }
  const fn = (mod as HypothesisModule).streamDiagnostics;
  if (typeof fn !== "function") throw new Error(`ARCH_HYPOTHESIS_UNRESOLVED — ${r.path} exports no streamDiagnostics`);
  return fn;
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

/** The REFUTATION prompt. Its input is the cluster's claim and components plus — since this task — the
 *  positions the first verifier says it read, handed over as STARTING POINTS to attack. It never sees the
 *  first verifier's REASONING, which is the whole point of a fresh-context independent refutation. */
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
  '"counterexample":"what would have to be true for the claim to hold","checked":["file:line — a position',
  'you examined and found nothing at"],"summary":"one sentence"}',
  'Use "refuted" when you FOUND a concrete counterexample in the code; "supported" ONLY when you tried and',
  'could not; "undetermined" when the code does not settle it.',
].join("\n");

/** How many of the first verifier's cited lines are handed to the refuter as STARTING POINTS. A BOUND, not
 *  a policy: the block exists to save the refuter the search for the relevant files, and an unbounded
 *  carry would turn the refuter's prompt into a copy of the verifier's case. */
export const REFUTER_STARTING_POINTS_MAX = 8;

/** THE STARTING-POINTS BLOCK (Plan item 3: «context aid, not a verdict shortcut»). The refuter is told
 *  where the first verifier looked so that it does not have to re-find the files — and is told, in the
 *  same breath, that those lines are NOT a case to agree with. The wording is load-bearing in two ways:
 *    • agreeing without its OWN reading is explicitly NOT an outcome it may return, so the aid cannot
 *      become the verdict;
 *    • it must either name a counterexample OR state the positions it checked, so «supported» carries
 *      something a reader can audit rather than a bare assent.
 *  ⛔ WHY THE AID IS SAFE FOR INDEPENDENCE: a cited line is a POSITION IN THE TREE, not the verifier's
 *  reasoning about it. The refuter still has to open the file and read it, and it is the refuter's OWN
 *  `tool_use` counts — not this list — that the record uses to show it did. */
export function refuterStartingPoints(evidence: unknown): string {
  const lines = (Array.isArray(evidence) ? evidence : [])
    .map((e) => {
      if (typeof e === "string") return e.trim();
      if (e !== null && typeof e === "object") {
        const r = e as Record<string, unknown>;
        const file = typeof r.file === "string" ? r.file : "";
        const line = typeof r.line === "number" || typeof r.line === "string" ? String(r.line) : "";
        const quote = typeof r.quote === "string" ? r.quote : "";
        const at = file === "" ? "" : line === "" || line === "0" ? file : `${file}:${line}`;
        return [at, quote].filter((s) => s !== "").join(" — ");
      }
      return "";
    })
    .filter((s) => s !== "")
    .slice(0, REFUTER_STARTING_POINTS_MAX);
  if (lines.length === 0) return "";
  return [
    "",
    "STARTING POINTS — the first verifier says it read these positions. They are a SHORTCUT TO THE FILES,",
    "NOT a case to agree with, and NOT evidence for the claim. Re-read them yourself and form your own",
    "view; they may be incomplete, or simply the wrong place to look.",
    ...lines.map((l) => `  · ${l}`),
    "",
    "⛔ Agreeing with the claim WITHOUT your own reading is NOT a refutation outcome and must not be",
    "returned. If you find no counterexample, say so AND name the positions you checked (the `checked`",
    "field), so a reader can see where you looked.",
  ].join("\n");
}

/** The refuter's prompt template for ONE cluster: the frozen template, plus the starting-points block when
 *  the first verifier cited anything. ⛔ The template is IDENTICAL when there is nothing to hand over, so a
 *  round whose verifier cited nothing produces byte-for-byte the prompt this routine produced before. */
export function refutationPromptFor(evidence: unknown): string {
  const block = refuterStartingPoints(evidence);
  return block === "" ? REFUTATION_PROMPT_TEMPLATE : `${REFUTATION_PROMPT_TEMPLATE}\n${block}`;
}

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
 *  disagree by construction. ⛔ `refutation_retry_max_turns` is deliberately NOT a member: the envelope is
 *  what the two arms are COMPARED on, and the retry is a call INSIDE an arm that both arms take through
 *  the same code path off the same config read — so it cannot make one arm differ from the other, and
 *  listing it would suggest an arm-level knob where there is none (the same reason `answer_reserve`
 *  is not a member). */
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
  // `shadow-*` covers the shadow pass AND its answer-reserve call: both belong to the third arm, and a
  // prefix match (rather than two literal names) is what keeps a future shadow step from being charged to
  // the guided arm by omission.
  return calls.filter((c) => !String(c.step).startsWith("shadow-") && !String(c.step).startsWith(baselinePrefix));
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
  // The ANSWER RESERVE's own calls (Plan item 2): ONE tool-less call granted to a step that was cut off
  // at the turn cap. ⛔ Its OWN step name — the reservation ledger must say WHY the call was spent, or a
  // rescue would read as a second exploration and the round's call count would stop being explicable.
  // ⛔ THE REFUTER HAS NO `*-report` MEMBER (this task): a truncated refuter gets a FRESH-CONTEXT RETRY with
  // a larger budget instead of a tool-less answer distilled from its own cut-off narration, so no call site
  // can emit `refuter-report` any more — and a value nothing can emit must not stay in the vocabulary,
  // where it would read as a state that can still occur (硬规则 3b).
  | "investigator-report" | "verifier-report" | "value-assessment-report" | "novelty-check-report"
  | "shadow-investigator-report"
  // The PAIRED round's UNGUIDED arm runs the same steps under their own kinds, so "which arm spent this
  // call" is readable straight off the reservation ledger instead of inferred from call order.
  | "baseline-investigator" | "baseline-verifier" | "baseline-refuter" | "baseline-value-assessment" | "baseline-novelty-check"
  | "baseline-investigator-report" | "baseline-verifier-report"
  | "baseline-value-assessment-report" | "baseline-novelty-check-report";

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
  /** The spawn seam. Defaults to `spawnModelCall` (which roots the child at the pin). `signal` is
   *  OPTIONAL on the returned shape so a stub that predates the signal capture stays assignable. */
  spawnFn?: ((argv: string[], opts: { cwd: string; timeoutMs: number; stdinData?: string }) => Promise<{ status: number | null; signal?: string | null; stdout: string; stderr: string; error: Error | null }>) | null;
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
  /** Test seam: the backoff the RETRY path waits (Plan item 3). A suite passes a no-op so no test ever
   *  waits on wall clock; production uses the real `setTimeout`. */
  sleepFn?: ((ms: number) => Promise<void>) | null;
  /** How long that backoff is. Defaults to `RETRY_BACKOFF_MS`; a test sets `0` for determinism. */
  retryBackoffMs?: number;
  /** 常驻循环的**协作式取消信号**（`RoutineRunContext.signal`）。见 `driver-runtime.ts` 的契约注释。
   *
   *  本轮的**可中断边界**是**每一次模型调用之前**（`reservingStep` 的第一行）：读到 `aborted` ⇒
   *  ⛔ **不再取预留**（AC3：停机之后一笔预留都不取），抛 `StoppedMidRoundError`。在飞的调用由
   *  `spawnModelCall` 的 signal 支 SIGKILL 掉，返回后同样上抛。异常一路穿过引擎回调（那里的
   *  `await runModel(...)` 不吞异常）到本轮自己的 catch，落成一条 `not-evaluated: stopped-mid-round`
   *  并**持久化这一轮已经做过的事**（与 `budget-24h` 中途拒绝同一条码路）。
   *
   *  ⛔ 缺省 `undefined` ⇒ 与从前逐字相同（手动单发 / `--once` / 非循环调用方不传它）。 */
  signal?: AbortSignal;
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

// ── THE TASK-STATUS CONTEXT (optional; it never gates and never schedules) ────────────────────────────
// WHY (tasks/gap-open-discovery-consumes-task-status-events-optional-context): reliable "what changed since
// my last round" context helps the model choose where to look — tasks that just landed, tasks reset after a
// failed landing, tasks escalated to needs-human. That context is read as real transition EVENTS through
// the SUPPORTED read surface (`readTaskLog` — the same reader `quay task log` publishes), never by parsing
// the carrier file (a second reader would be a second contract) and never from commit subjects (a message
// is a claim, not a positional reading — the read surface's own guarantee 4).
//
// ⛔ THE CONTEXT IS OPTIONAL. Events NEVER gate and NEVER schedule a round: no events ⇒ the round still
// runs; many events ⇒ still ONE bounded round. Mechanics only fetch and persist a cursor; what to do with
// the context is the MODEL's call. To make that a structural property rather than a promise, the whole
// read lives in `readTaskLogContext` below, which touches no Fact, no `isDue`, no `halted` and no spawn —
// `case (e)` pins the shape, and the injected-gate negative control in the test file is its live control.

/** One page entry of the read surface's published document — named ONCE so the dedup key and the
 *  offered-event projection are typed against the surface's own shape rather than a local re-description. */
type TaskLogTransition = TaskLogDocument["transitions"][number];

/**
 * The dedup key of ONE delivered transition. The read surface's contract is AT-LEAST-ONCE: a resumed
 * cursor is read INCLUSIVE of the event it names, so every resume re-delivers exactly that boundary event.
 * The surface's own identity (`eventId`) is therefore the key wherever the record carries one; a v0 record
 * has none and one is NEVER fabricated (硬规则 6) — its carrier position, which is precisely the order the
 * cursor pages by, is its key instead.
 */
export function taskLogDedupKey(t: Pick<TaskLogTransition, "eventId" | "order">): string {
  return t.eventId !== null ? `eventId:${t.eventId}` : `order:${t.order}`;
}

/** One transition as the round OFFERS it: only what the model needs to decide whether to look, plus the
 *  dedup key the next round carries forward. The carrier is NOT copied wholesale into the prompt. */
export interface TaskLogOfferedEvent {
  key: string;
  event_id: string | null;
  order: number;
  task_id: string;
  from: string | null;
  to: string | null;
  at: string | null;
  commit: string | null;
  inferred: boolean;
  source: string;
}

/** What the round FETCHED — the whole mechanical half of the feature. `read.ok:false` is a REPORTED
 *  outcome (with its reason), never a round-level failure and never a silent empty list. */
export interface TaskLogContextBlock {
  read: { ok: boolean; reason: string | null };
  limit: number;
  cursor_before: TaskLogCursor | null;
  /** true when the previous round's stored `cursor_after` was PRESENT but unreadable — reported rather
   *  than quietly indistinguishable from "there was no cursor" (硬规则 3b). */
  cursor_before_unreadable: boolean;
  cursor_after: TaskLogCursor | null;
  rebase: boolean;
  rebase_reason: string | null;
  complete: boolean;
  incomplete_reasons: string[];
  offered: TaskLogOfferedEvent[];
  offered_count: number;
  deduped_by_event_id: number;
  truncated: boolean;
}

/** Validate a stored cursor. ⛔ A malformed one returns `null` — the CALLER reports that separately rather
 *  than reading it as absent (see `cursor_before_unreadable`). */
export function asTaskLogCursor(v: unknown): TaskLogCursor | null {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (o.v !== 1) return null;
  if (typeof o.carrierEpoch !== "string" || o.carrierEpoch.length === 0) return null;
  if (typeof o.seq !== "number" || !Number.isInteger(o.seq) || o.seq < 0) return null;
  return { v: 1, carrierEpoch: o.carrierEpoch, seq: o.seq };
}

/** The cursor (and the offered keys) the PREVIOUS round left ON THE CARRIER — the carrier IS the store, no
 *  second cursor file is invented, exactly like `priorFocuses`. The LATEST scan-round carrying a `task_log`
 *  block wins: a round that predates this feature contributes nothing, and neither does the mid-round
 *  budget-refusal line. `at-least-once` falls out of the storage discipline — the block is written on the
 *  SAME append as the round it describes, so a round that crashed before appending leaves no cursor and the
 *  next round re-reads from where the last SUCCESSFUL round stopped. */
export function priorTaskLogContext(records: readonly Record<string, unknown>[]): {
  cursor: TaskLogCursor | null;
  cursorUnreadable: boolean;
  offeredKeys: string[];
} {
  for (let i = records.length - 1; i >= 0; i--) {
    const rec = records[i];
    if (rec.kind !== "scan-round") continue;
    const raw = rec.task_log;
    if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) continue;
    const block = raw as Record<string, unknown>;
    const cursorRaw = block.cursor_after;
    const cursor = asTaskLogCursor(cursorRaw);
    const offeredRaw = Array.isArray(block.offered) ? (block.offered as unknown[]) : [];
    const offeredKeys = offeredRaw
      .map((o) => (o !== null && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>).key : null))
      .filter((k): k is string => typeof k === "string" && k.length > 0);
    return { cursor, cursorUnreadable: cursor === null && cursorRaw !== null && cursorRaw !== undefined, offeredKeys };
  }
  return { cursor: null, cursorUnreadable: false, offeredKeys: [] };
}

/**
 * FETCH the optional context. Reads ONE page of the transition carrier through the supported surface and
 * compacts it into the offered list.
 *
 * ⛔ PURE MECHANICS, AND THAT IS THE POINT: this function returns a description of what was read. It never
 * throws, never spawns, never consults the clock for a decision and — most importantly — never influences
 * whether the round runs. A read that fails comes back as `read.ok:false` with its reason, so "the feed
 * could not be read" is its own state rather than an empty list (硬规则 3b).
 */
export function readTaskLogContext(
  root: string,
  limit: number,
  records: readonly Record<string, unknown>[],
  opts: { nowMs?: number } = {},
): TaskLogContextBlock {
  const prior = priorTaskLogContext(records);
  const base: TaskLogContextBlock = {
    read: { ok: false, reason: null },
    limit,
    cursor_before: prior.cursor,
    cursor_before_unreadable: prior.cursorUnreadable,
    cursor_after: null,
    rebase: false,
    rebase_reason: null,
    complete: false,
    incomplete_reasons: [],
    offered: [],
    offered_count: 0,
    deduped_by_event_id: 0,
    truncated: false,
  };
  if (limit < 1 || limit > MAX_TASK_LOG_LIMIT) {
    return { ...base, read: { ok: false, reason: `the configured page limit ${limit} is outside 1..${MAX_TASK_LOG_LIMIT}` } };
  }
  let reading: ReturnType<typeof readTaskLog>;
  try {
    reading = readTaskLog(root, {
      since: prior.cursor === null ? null : JSON.stringify(prior.cursor),
      limit,
      ...(opts.nowMs !== undefined ? { nowMs: opts.nowMs } : {}),
    });
  } catch (e) {
    return { ...base, read: { ok: false, reason: `the read surface threw: ${(e as Error)?.message ?? String(e)}` } };
  }
  if (reading.ok === false) return { ...base, read: { ok: false, reason: reading.reason } };
  const doc = reading.document;

  // The at-least-once compensation: the boundary event the cursor named comes back, and any eventId the
  // PREVIOUS round already offered is dropped. Net effect over a healthy sequence: exactly-once delivery.
  const seen = new Set(prior.offeredKeys);
  const offered: TaskLogOfferedEvent[] = [];
  let deduped = 0;
  for (const t of doc.transitions) {
    const key = taskLogDedupKey(t);
    if (seen.has(key)) {
      deduped++;
      continue;
    }
    seen.add(key);
    offered.push({
      key,
      event_id: t.eventId,
      order: t.order,
      task_id: t.taskId,
      from: t.from,
      to: t.to,
      at: t.at,
      commit: t.commit,
      inferred: t.inferred,
      source: t.source,
    });
  }
  const incomplete = doc.complete ? [] : [...doc.coverage.reasons];
  return {
    ...base,
    read: { ok: true, reason: null },
    cursor_after: doc.nextCursor,
    rebase: doc.rebase,
    rebase_reason: doc.rebaseReason,
    complete: doc.complete,
    incomplete_reasons: incomplete,
    offered,
    offered_count: offered.length,
    deduped_by_event_id: deduped,
    // The surface names its own truncation in `coverage.reasons`; the flag is a convenience VIEW of that
    // documented sentence, and the sentence itself is carried VERBATIM in `incomplete_reasons`.
    truncated: incomplete.some((r) => r.includes("truncated by --limit")),
  };
}

/**
 * The directive PREPENDED to the investigator prompt. ⛔ Its whole job is to hand the model the context
 * WITHOUT making it a rule: it states, in the model's own terms, that the list is optional, that it decides
 * nothing, and that the choice of focus stays the model's. When the feed could not be read, or when it is
 * incomplete (`rebase:true` / `complete:false`), the fact is passed on AS-IS — verbatim, with the surface's
 * own reason text — so the model can weigh a partial list instead of being handed a summary that looks
 * complete.
 */
export function taskLogContextDirective(block: TaskLogContextBlock): string {
  const lines: string[] = [
    "TASK-STATUS CHANGES — context you MAY consider. This is OPTIONAL: it never decides your focus, it",
    "never gates or triggers this round, and you are free to ignore it entirely. With or without it you",
    "explore exactly as you otherwise would.",
    "",
  ];
  if (block.read.ok === false) {
    lines.push(
      `(the transition feed could not be read: ${block.read.reason ?? "(no reason given)"})`,
      "Nothing is offered here, and this does not affect the round.",
      "",
    );
  } else if (block.offered_count === 0) {
    lines.push("No task-status transition is new since your last round.", "");
  } else {
    lines.push(`${block.offered_count} task-status transition(s) since your last round:`);
    for (const e of block.offered) {
      const arrow = `${e.from === null ? "?" : e.from}→${e.to === null ? "?" : e.to}`;
      const when = e.at === null ? "at unknown" : `at ${e.at}`;
      const commit = e.commit === null ? "" : ` commit ${e.commit}`;
      const inferred = e.inferred ? " (inferred from git, not observed by a live writer)" : "";
      lines.push(`  - ${e.task_id === "" ? "<unknown task>" : e.task_id} ${arrow} ${when}${commit}${inferred}`);
    }
    lines.push(
      "",
      "These are pointers, not instructions: you may read the affected files yourself with your own tools,",
      "and you may just as well pursue a focus none of them mentions.",
      "",
    );
  }
  if (block.cursor_before_unreadable) {
    lines.push(
      "this list may be incomplete: the cursor the previous round stored could not be read, so this page",
      "restarts from the beginning of the current carrier epoch.",
      "",
    );
  }
  if (block.rebase) {
    lines.push(`this list may be incomplete: ${block.rebase_reason ?? "(the read surface reported a rebase with no reason)"}`, "");
  }
  if (!block.complete && block.incomplete_reasons.length > 0) {
    // ⛔ The reasons are indented ONE level deeper than the offered events, so the two kinds of bullet are
    // distinguishable by position rather than by reading them (the offered lines are the only `  - `).
    lines.push("this list may be incomplete:");
    for (const r of block.incomplete_reasons) lines.push(`    - ${r}`);
    lines.push("");
  }
  lines.push("---", "");
  return lines.join("\n");
}

/** ONE fix cap on how many matches the citation reading collects — a bound on the ROUND RECORD, not a
 *  judgment. Twelve distinct task ids is already far more than a one-sentence focus can name. */
export const FOCUS_CITATION_MAX = 12;

/**
 * Whether the model's OWN stated focus NAMED any of the offered events. ⛔ This is a READING OF THE
 * MODEL'S STATEMENT, never an attribution of use: a substring match says the focus mentioned a task id,
 * and says nothing about whether the event caused the focus. `cited` is `null` (NOT `false`) when the
 * question is vacuous — nothing was offered, or the model stated no focus — so "no citation" and "nothing
 * to cite" cannot be read for one another (硬规则 3b).
 */
export function citeOfferedEvents(
  statedFocus: unknown,
  offered: readonly TaskLogOfferedEvent[],
): { evaluated: boolean; cited: boolean | null; matched: string[]; basis: string } {
  const basis =
    "a substring reading of the model's OWN stated focus text (it reports whether the focus NAMED an offered task id, never that the event caused the focus)";
  if (offered.length === 0) return { evaluated: false, cited: null, matched: [], basis };
  if (typeof statedFocus !== "string" || statedFocus.trim() === "") {
    return { evaluated: false, cited: null, matched: [], basis };
  }
  const matched: string[] = [];
  for (const e of offered) {
    if (e.task_id === "" || e.task_id === undefined) continue;
    if (!statedFocus.includes(e.task_id)) continue;
    if (matched.includes(e.task_id)) continue;
    if (matched.length >= FOCUS_CITATION_MAX) break;
    matched.push(e.task_id);
  }
  return { evaluated: true, cited: matched.length > 0, matched, basis };
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
  // ── THE ROUND ID (Plan item 4) ────────────────────────────────────────────────────────────────────
  // Stamped on EVERY reservation this round takes AND on the scan-round line it appends. ⛔ It is what
  // makes "the ledger reservation count equals the round's `model_calls`" a CHECKABLE reading rather than
  // an arithmetic coincidence: the ledger lines are attributable to a round by a value the round itself
  // published, so a reader can count them (`kind:"reserve"` with this `round`) and compare.
  const roundId = `osd-${process.pid}-${started}-${Math.random().toString(36).slice(2, 8)}`;
  const sleepFor = opts.sleepFn ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const retryBackoffMs = opts.retryBackoffMs ?? RETRY_BACKOFF_MS;
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
  //
  // ⛔ THE PIN STEP IS WRAPPED (task gap-discovery-toolchain-depends-on-unshipped-docs-analysis-and-ts-
  //    sources-never-works-off-quay-repo, AC4): `developTip` shells `git -C <root> rev-parse develop` and
  //    `materializeStrippedPin` shells git too — neither catches. A root that is not a git repo, has no
  //    `develop` ref, or is genuinely EMPTY of the project's own code therefore used to THROW out of this
  //    function, past every `failed` Fact, and the CLI's promise rejected: the operator got a stack trace
  //    instead of a reading. That is the worst shape under 硬规则 3b — «the round could not be evaluated»
  //    arriving as a crash is indistinguishable, to any reader downstream, from a harness defect. A round
  //    that cannot pin now returns its OWN `failed` Fact carrying an explicit `not-evaluated:` token, so
  //    "nothing could be evaluated" keeps a value of its own and is never shaped like "evaluated, found 0".
  let rev: string;
  try {
    rev = (opts.revFn ?? developTip)(root);
  } catch (e) {
    return fact("not-evaluated", { ...base, enabled: true, interval: intervalInfo, due: dueInfo },
      `pin basis unavailable — \`git -C ${root} rev-parse develop\` failed: ${(e as Error).message} (nothing spawned, nothing appended, last-run not advanced; not-evaluated:no-develop-ref)`);
  }
  const pinTmp = opts.pinTmpRoot ?? process.env[PIN_TMP_ENV] ?? os.tmpdir();
  let pinDir: string;
  try {
    pinDir = fs.mkdtempSync(path.join(pinTmp, `osd-pin-${rev.slice(0, 8)}-`));
  } catch (e) {
    return fact("not-evaluated", { ...base, enabled: true, interval: intervalInfo, due: dueInfo },
      `pin directory unavailable under ${pinTmp}: ${(e as Error).message} (nothing spawned, nothing appended; not-evaluated:no-pin-dir)`);
  }
  const pinFn = opts.pinFn ?? ((o: { root: string; rev: string; dir: string }): PinResult =>
    materializeStrippedPin({ ...o, forbiddenDirs: hyp.PIN_FORBIDDEN_DIRS, stripCheck: (d) => hyp.verifyCwdRefusal(d, d) }));
  let pin: PinResult;
  try {
    pin = pinFn({ root, rev, dir: pinDir });
  } catch (e) {
    return fact("not-evaluated", { ...base, enabled: true, interval: intervalInfo, due: dueInfo },
      `pin materialisation threw — ${(e as Error).message} (nothing spawned, nothing appended, last-run not advanced; not-evaluated:pin-threw)`);
  }
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

  // ── THE ANCHOR-HANDOFF READING, TAKEN ONCE PER ROUND (task gap-osd-stream-without-result-recurs-…) ───
  // ONE read of the anchor's own published start, taken here — after every gate that can return early and
  // before the first reservation, so a round that never spawns never pays for it, and a round that DOES
  // spawn describes its calls against a single reading rather than re-reading per call. It is a READ: it
  // gates nothing, changes no retry policy and (硬规则 4b) is the anchor's own direct量, not a heartbeat
  // this routine maintains about the anchor. `readAnchorStart` carries the three-state reason vocabulary;
  // `handoffBlock` turns it into the per-instant description recorded on the round and on every call.
  const anchorStartRead: AnchorStartReading = readAnchorStart(root);

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
    // ── ONE ATTEMPT: reserve → build argv → spawn → record. ⛔ Factored OUT of `reservingStep` so the
    //    RETRY below is literally the same call made again, with a FRESH reservation and its own record —
    //    not a second code path that could drift from the first (硬规则 5b). ────────────────────────────
    async function attemptCall(retryOf: string | null): Promise<{
      res: { status: number | null; signal?: string | null; stdout: string; stderr: string; error: Error | null };
      stream: ReturnType<HypothesisModule["parseVerifierStream"]>;
      argv: string[];
      rec: Record<string, unknown>;
    }> {
      // ⛔ THE STOP BOUNDARY (gap-quality-restart-waits-out-whole-round-so-osd-in-flight-exceeds-stop-window,
      // Plan item 2): 停机**之后**一笔预留都不取。这一条必须在 `budget.reserve` **之前** —— 检查放在
      // 之后就等于先花了钱再问该不该花（AC3 要的正是「停机之后零预留」这个可核的读数）。
      if (opts.signal?.aborted) throw new StoppedMidRoundError(kind, true, `no reservation is taken after the stop (step ${kind} was reached after the stop signal)`);
      // ⛔ The round id travels on the reservation (Plan item 4), so every ledger line this round writes is
      // attributable to it by a value the round ITSELF published on its scan-round line.
      const r = await budget.reserve({ step: kind, tools: payload.tools, max_turns: payload.maxTurns, round: roundId });
      if (!r.ok) throw new BudgetRefusedError(r.used, r.cap, kind);
      grantedIds.push(r.id);
      const { argv, maxTurns, tools } = stepArgv(buildArgv, payload.prompt, root, { tools: payload.tools, maxTurns: payload.maxTurns, model: payload.model });
      let res: { status: number | null; signal?: string | null; stdout: string; stderr: string; error: Error | null };
      const callStarted = now();
      try {
        // The signal rides into the spawn so an IN-FLIGHT child is killed on abort instead of being waited
        // out — without it the round's stop latency would be one whole model call (minutes, measured).
        res = await spawn(argv, { cwd: pinned, timeoutMs: Math.max(1_000, config.maxWallMs), stdinData: payload.prompt }, opts.signal);
      } catch (e) {
        budget.outcome(r.id, classifyModelFailure(e), null, `CALL_THREW:${(e as Error)?.name ?? "Error"}`);
        throw e;
      }
      // ── THE WALL CLOCK OF ONE CALL (Plan item 1) ───────────────────────────────────────────────────
      // Production recorded minutes of wall for calls that left no result, and the record could not say
      // HOW LONG. It is the reading that separates "an instant launch failure" from "the process ran".
      const wallMs = Math.max(0, now() - callStarted);
      const stdout = String(res?.stdout ?? "");
      const { turns } = readRealizedTurns(res?.stdout, (s: string) => hyp.parseVerifierStream(s));
      // The launcher's stderr, bounded and kept. Production kept NONE of it, so a round-1-style zero-token
      // exit could not be diagnosed at all (Plan item 3) — the cause existed only inside the child process.
      const stderrTail = boundedTail(res?.stderr, STDERR_TAIL_MAX);
      budget.outcome(r.id, res.error ? classifyModelFailure(res.error) : "completed", turns, res.error ? "SPAWN_ERROR" : null);
      // The realized price: the gateway rate applied to the stream's own usage when BOTH are readable, else
      // NULL — and NULL counts as the per-call ceiling in `usdBudgetUsage`, never as free.
      const stream = hyp.parseVerifierStream(stdout);
      // ── THE STRUCTURAL READING OF THE STREAM (Plan items 1-2) ───────────────────────────────────────
      // The ENGINE's own reader, consumed rather than re-derived (硬规则 5b): event counts by `type`,
      // whether a `result` event was emitted, and whether the last line was cut mid-write.
      const diag = hyp.streamDiagnostics(stdout);
      const hasResult = diag.has_result === true;
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
      // ⛔ A call killed by the timeout reaper is `killed-by-timeout`, and the only in-band signal for it
      // is the spawn wrapper's own timeout message — there is no exit code (the child was SIGKILLed).
      const spawnErrMsg = res?.error ? String(res.error.message ?? res.error).slice(0, 200) : null;
      const timedOut = res?.error ? classifyModelFailure(res.error) === "timeout" : false;
      const rec: Record<string, unknown> = {
        step: kind, tools, max_turns: maxTurns, argv_tools_index: argv.indexOf("--tools"), cwd: asRel(root, pinned),
        // ⛔ The reservation id and the round id tie this record to its OWN ledger lines, which is what
        // makes the cost reconciliation (AC4) a reading rather than an arithmetic hope.
        reservation_id: r.id, round_id: roundId,
        exit: res?.status ?? null, signal: res?.signal ?? null, timed_out: timedOut,
        spawn_error: spawnErrMsg, wall_ms: wallMs,
        turns, actual_model: servedModel ?? "not-evaluated:model-unverified",
        tokens: { input: Number(usage?.input_tokens ?? 0), output: Number(usage?.output_tokens ?? 0) },
        cost_usd: realized, cost_source: costSource, cost_charged_usd: charged,
        // ── HOW THE CALL ENDED (Plan item 1) ─────────────────────────────────────────────────────────────
        // The stream's OWN structural `result` fields, carried onto the record. ⛔ Before this, an `exit 1`
        // was all the round kept, so a call killed at the turn cap and a call that explored and found
        // nothing produced the SAME record — the defect this task exists to close (硬规则 3b). `subtype` is
        // `null` when the stream did not parse: "not read" keeps its own value, it is never defaulted to a
        // success, and `stream_ok`/`stdout_lines`/`events_by_type` let a reader tell "no stream" from
        // "stream said nothing" from "stream ran but never emitted a result".
        stream_ok: stream.ok === true,
        subtype: stream.ok ? (stream.subtype ?? null) : null,
        num_turns: stream.ok && Number.isFinite(stream.num_turns) ? (stream.num_turns as number) : null,
        is_error: stream.ok && typeof stream.is_error === "boolean" ? (stream.is_error as boolean) : null,
        // ── WHAT THE CALL ACTUALLY OPENED (Plan item 1) ─────────────────────────────────────────────────
        // Counts by tool + the first argument heads, read off the per-turn records the engine's parser
        // already extracted (硬规则 5b). `null` when the stream did not parse — «made no tool calls» and
        // «no turns were captured» are different facts and must not share a shape (硬规则 3b). It is what
        // makes a verdict ATTRIBUTABLE: `Read/Grep counts > 0` is the direct reading of «this refutation
        // came from looking at the code».
        tool_use: stream.ok ? hyp.toolUseSummary(stream.turns) : null,
        stdout_bytes: diag.bytes,
        stdout_lines: diag.lines ?? null,
        stdout_events_by_type: diag.events_by_type ?? {},
        stdout_unparsed_json_lines: diag.unparsed_json_lines ?? null,
        has_result: hasResult,
        // The stream reader's OWN transport-error predicate — the token and the class must key on the SAME
        // structural reading, or the two readings of one call could disagree.
        api_error_event: diag.api_error_event === true,
        stderr_chars: stderrTail.chars,
        stderr_tail: stderrTail.tail,
        stderr_tail_truncated: stderrTail.truncated,
        // ── WHERE THIS CALL SAT RELATIVE TO THE ANCHOR'S OWN START (task gap-osd-stream-without-result-…) ─
        // The counterfactual instrument (Plan item 1). ⛔ It is a READING and gates NOTHING: no retry, no
        // cap, no verdict below consults it. `handoff` is derived from the round's ONE `readAnchorStart`
        // against THIS call's own start instant (`callStarted`) rather than the round's, because a round
        // runs for minutes and a call at minute 12 is not described by the round's own start — and it is
        // the per-CALL reading the correlation is about. `host_load` rides alongside it so a future
        // recurrence can be compared against «the host was busy» as well as «a handoff was in flight».
        handoff: handoffBlock(anchorStartRead, callStarted),
        host_load: readHostLoad(),
        not_evaluated: null as string | null,
        call_failure: null as string | null,
      };
      if (retryOf !== null) rec.retry_of = retryOf;
      // The CLASS is derived from the captured bytes, and the token is derived from the class + the exit
      // reading — so the two can never disagree about the same call (Plan item 2).
      rec.call_failure = callFailureClass({
        timed_out: timedOut, stdout_bytes: rec.stdout_bytes,
        json_lines: diag.json_lines, truncated_json: diag.truncated_json,
        api_error_event: diag.api_error_event, has_result: hasResult,
      });
      rec.not_evaluated = callNotEvaluatedToken(rec);
      // ── THE BOUNDED HEAD/TAIL CAPTURE (Plan item 1) ─────────────────────────────────────────────────
      // ONLY for a call that did not answer: on a clean call the parsed answer is on the record and a
      // second copy of the stream would be a transcript, not a diagnosis.
      if (rec.not_evaluated !== null) {
        const narration = boundedTail(hyp.callText(stdout), ASSISTANT_TAIL_MAX);
        rec.assistant_text_tail = narration.tail;
        rec.assistant_text_tail_truncated = narration.truncated;
        try {
          rec.stdout_capture = writeCallCapture(root, path.join(root, CALL_CAPTURE_DIR_REL, `${roundId}-${kind}-${r.id}.txt`), { stdout, stderr: res?.stderr });
        } catch (e) {
          // ⛔ A capture that could not be written is REPORTED on the record, never silently absent — the
          // whole point of the field is that "no bytes to show" and "no capture file" differ (硬规则 3b).
          rec.stdout_capture = { path: null, error: String((e as Error)?.message ?? e).slice(0, 200) };
        }
      }
      callRecords.push(rec);
      // ⛔ The stop boundary's SECOND half: 停机到达时这次调用**已在飞** ⇒ 它被 `spawnModelCall` 的
      // signal 支 SIGKILL 掉。它的**预留已经花掉且已记 outcome**（上面 `budget.outcome`）——一笔花掉的
      // 预留就是花掉了，不因停机回滚（Plan item 2 末句）；这里只负责把这一轮**立刻**收尾。
      // 记录先 push（这一轮已做过的事有据可查），再上抛。
      if (opts.signal?.aborted) {
        throw new StoppedMidRoundError(kind, false, `the ${kind} call was interrupted mid-flight by the stop signal (reservation ${r.id} stays SPENT, its outcome is on the ledger)`);
      }
      return { res, stream, argv, rec };
    }

    const first = await attemptCall(null);
    // ── THE ONE COUNTED RETRY (Plan item 3) ─────────────────────────────────────────────────────────
    // A call whose captured bytes put it in a RETRYABLE class is tried ONCE more after a backoff, through
    // a FRESH reservation on the SAME 24h ledger — so the retry is COUNTED and CAPPED like any other call.
    // ⛔ The FIRST call's record stays on the round: the retry is not a way to launder a lost call into a
    // clean one. A refusal at the retry's own reservation THROWS the round's ordinary BudgetRefusedError,
    // which is exactly "no retry when the ledger refuses".
    const failure = typeof first.rec.call_failure === "string" ? first.rec.call_failure : null;
    if (failure === null || !RETRYABLE_CALL_FAILURES.includes(failure)) return first;
    if (retryBackoffMs > 0) await sleepFor(retryBackoffMs);
    const second = await attemptCall(String(first.rec.reservation_id ?? ""));
    second.rec.retry_of_kind = kind;
    second.rec.retry_cause = failure;
    return second;
  }

  // ── THE ANSWER RESERVE (Plan item 2) ────────────────────────────────────────────────────────────────
  // ONE tool-less call for ANY step whose call was CUT OFF at the turn cap. It goes through
  // `reservingStep` like every other call, so it is reserved on the SAME trailing-24h ledger and a refusal
  // at the ceiling throws the round's ordinary `BudgetRefusedError` rather than spending a call nobody
  // granted.
  //
  // ⛔ WHY IT IS NOT INVESTIGATOR-ONLY (硬规则 5b — fixing one instance is not fixing the class): the AC2
  // production round of 2026-10-12 measured the SAME defect one step downstream. Of its six calls, three
  // were `error_max_turns` — two verifiers (`verifier_cause:"turn-budget"` on 2 of 3 clusters) and the
  // refuter — so `confirmed.count` was 0 on a round that had just produced 12 real, evidenced hypotheses.
  // A turn cap that kills a verifier before it reports is the identical failure: "not evaluated" reading
  // as "nothing found". Every single-answer step gets the same one-shot second chance.
  //
  // ⛔ It fires for `error_max_turns` ONLY. An auth, gateway or spawn failure has no exploration notes to
  // report from, so a second call would only reproduce the failure and burn a reservation doing it.
  //
  // The engine parses whatever stream `runModel` RETURNS, so the rescue's stream is what must be handed
  // back: that is what makes the rescue an ANSWER rather than a side note. The cut-off call itself stays
  // on the round's call list under its own `not-evaluated:error_max_turns` token, so the round still says
  // a call was lost and does not launder it into a clean one.
  async function reportIfCutOff(
    prompt: string,
    res: { status: number | null; stdout: string; stderr: string; error: Error | null },
    rec: Record<string, unknown>,
    reportStep: ModelStepKind,
  ): Promise<{ res: { status: number | null; stdout: string; stderr: string; error: Error | null }; rec: Record<string, unknown>; rescued: boolean }> {
    if (callNotEvaluatedToken(rec) !== "not-evaluated:error_max_turns") return { res, rec, rescued: false };
    const explored = typeof rec.assistant_text_tail === "string" ? (rec.assistant_text_tail as string) : "";
    const rescue = await reservingStep(reportStep, {
      prompt: buildAnswerReservePrompt(prompt, explored),
      tools: ANSWER_RESERVE_TOOLS,
      maxTurns: BLIND_INVESTIGATOR_MAX_TURNS,
      model: requestedModel,
    });
    return { res: rescue.res, rec: rescue.rec, rescued: callNotEvaluatedToken(rescue.rec) === null };
  }

  // ⑥ (b) SEMANTIC EXPLORATION ON REAL SOURCE. The investigator runs with Read/Grep/Glob rooted at the
  //    pinned tree and an explicit `--max-turns`, so it reads code and context itself. The inventory is
  //    passed as an optional map — appended to the prompt, never used to select or reject anything.
  const focuses = priorFocuses(carrierRounds);
  // ⑥ (b) i THE OPTIONAL TASK-STATUS CONTEXT. ONE unconditional fetch of the transition feed through the
  //        supported read surface, compacted for the prompt. ⛔ It is a single call, outside every gate and
  //        consulted by none of them: the round's due/halt/budget decisions were ALL made above, and nothing
  //        below reads `taskLogContext` except the prompt composition and the round record. That is what
  //        makes «no code path skips or schedules a round on the events» structural (case (e)) rather than
  //        a promise — see `readTaskLogContext`, which owns the whole mechanic and returns no Fact.
  const taskLogContext = readTaskLogContext(root, config.taskLogContextLimit, carrierRounds);
  const taskLogContextText = taskLogContextDirective(taskLogContext);
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
    // ⛔ The TURN RESERVE directive (Plan item 2) goes into BOTH arms, and into the same position in both:
    // the cap it describes is part of the shared envelope, so putting it in only one arm would make the
    // paired instrument's two prompts differ by something other than the guidance block.
    // ⛔ The TASK-STATUS CONTEXT goes in the SAME position in BOTH arms for the SAME reason — it is part of
    // the shared envelope the two arms are compared on, so it must not become a second difference.
    const reserveDirective = turnReserveDirective(config.investigatorMaxTurns);
    const armPrompts: Record<PairedArm | "guided", string> = {
      [PAIRED_ARM_GUIDED]: `${focusDirective(focuses)}\n${reserveDirective}\n${taskLogContextText}${selection.production_text}${basePrompt}\n\n${inventoryText}`,
      [PAIRED_ARM_BASELINE]: `${focusDirective(focuses)}\n${reserveDirective}\n${taskLogContextText}${basePrompt}\n\n${inventoryText}`,
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
      /** This arm's step name for one of its five model steps (或 that step's answer-reserve call). */
      const STEP_NAMES = ["investigator", "verifier", "refuter", "value-assessment", "novelty-check"] as const;
      type StepName = (typeof STEP_NAMES)[number];
      const stepKind = (kind: StepName | `${StepName}-report`): ModelStepKind =>
        (unguided ? `baseline-${kind}` : kind) as ModelStepKind;
      const armStamp: Record<string, unknown> = spec.markPaired ? { paired: true, paired_arm: spec.arm } : {};
      const prompt = armPrompts[unguided ? PAIRED_ARM_BASELINE : PAIRED_ARM_GUIDED];
      const armTexts: string[] = [];
      const armOutDir = unguided
        ? path.join(pinned, ".open-semantic-discovery-runs", PAIRED_ARM_BASELINE)
        : path.join(pinned, ".open-semantic-discovery-runs");
      // Every call this ARM made, in call order.
      const armCallRecords: Record<string, unknown>[] = [];
      /** Put a call on the arm's list, ONCE. ⛔ `reportIfCutOff` hands the SAME record back when it did not
       *  fire, so pushing unconditionally would list one call twice — and the arm's `calls` reading (and
       *  anything derived from it) would claim two calls where one was made. A COUNT that lies is the same
       *  family of defect as a boolean that lies (硬规则 3b). */
      const noteArmCall = (r: Record<string, unknown>): void => {
        if (!armCallRecords.includes(r)) armCallRecords.push(r);
      };
      const inv = await hyp.runInvestigator({
        prompt,
        // `neutralDir` is unused on the pinned path (the cwd gate switches to `verifyCwdRefusal`); it is
        // passed equal to the pin so BOTH gates agree on which tree this is.
        neutralDir: pinned,
        cwd: pinned,
        pinDir: pinned,
        runs: config.investigatorRuns,
        // A separate runs directory per arm: the unguided pass must not overwrite the guided pass's runs.
        outDir: armOutDir,
        writeFile: (f: string, t: string) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t, "utf8"); },
        budget: { maxRuns: config.investigatorRuns, maxMs: config.maxWallMs },
        model: requestedModel ?? "not-evaluated:model-unverified",
        tools: INVESTIGATOR_TOOLS,
        maxTurns: config.investigatorMaxTurns,
        runModel: async (p: string, i: number) => {
          if (spec.markPaired && firstPairedCallMs === null) firstPairedCallMs = now();
          const { res, rec } = await reservingStep(stepKind("investigator"), { prompt: p, tools: INVESTIGATOR_TOOLS, maxTurns: config.investigatorMaxTurns, model: requestedModel });
          noteArmCall(rec);
          // A run cut off at the cap is rescued BEFORE the engine parses it, so the engine's `hyps` (and
          // therefore the run file it writes, and `inv.parsed`) are the RESCUE's answer rather than zero.
          const out = await reportIfCutOff(p, res, rec, stepKind("investigator-report"));
          noteArmCall(out.rec);
          armTexts.push(hyp.callText(String(out.res?.stdout ?? "")));
          return out.res;
        },
      });
      if (inv.ok !== true) {
        const reasons = Array.isArray(inv.reasons) ? (inv.reasons as string[]) : [];
        return { ok: false, reason: `${armPrefix}investigator refused — ${reasons[0] ?? "no reason reported"} (nothing appended, last-run not advanced)` };
      }
      const records = Array.isArray(inv.records) ? (inv.records as Record<string, unknown>[]) : [];
      const statedFocus = armTexts.map((t) => focusFromText(t)).find((f) => typeof f === "string" && f !== "") ?? null;
      const investigator = {
        ran: true, runs: config.investigatorRuns,
        // Read from the engine's OWN records, which already reflect any rescue (the rescue's stream is what
        // `runModel` returned, so the engine parsed it). A run rescued into hypotheses therefore counts as
        // a run WITH hypotheses — the summary cannot contradict the clusters it produced.
        runs_with_hypotheses: Number(inv.parsed ?? 0),
        tools: INVESTIGATOR_TOOLS, max_turns: config.investigatorMaxTurns, cwd: asRel(root, pinned),
        stated_focus: statedFocus, prior_focuses: focuses,
        guided_by: spec.methodPicks.map((m) => methodLabel(m)),
        // ── HOW EACH CALL ENDED (Plan item 1) ─────────────────────────────────────────────────────────
        // The per-call reading a reviewer needs to tell "explored, found nothing" from "was killed before
        // it could answer". `subtype` is the stream's own structural result, `stderr_tail` the launcher's
        // own cause, and `not_evaluated` the ONE token that combines them.
        calls: armCallRecords.map((c) => ({
          step: c.step, exit: c.exit, spawn_error: c.spawn_error,
          stream_ok: c.stream_ok, subtype: c.subtype, num_turns: c.num_turns, is_error: c.is_error,
          turns: c.turns, tokens: c.tokens, cost_charged_usd: c.cost_charged_usd,
          stderr_chars: c.stderr_chars, stderr_tail: c.stderr_tail, stderr_tail_truncated: c.stderr_tail_truncated,
          not_evaluated: c.not_evaluated,
        })),
        not_evaluated: firstNotEvaluatedToken(armCallRecords),
        // ── THE ANSWER RESERVE, as the ARM saw it ─────────────────────────────────────────────────────
        // Read back off the arm's OWN call records rather than from a counter kept in a side variable: a
        // rescue IS a reservation with its own step name, so the ledger and this reading are the same fact
        // rather than two that can drift (硬规则 5b).
        answer_reserve: summarizeReserve(armCallRecords.filter((c) => String(c.step).includes("investigator"))),
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
          const { res, rec } = await reservingStep(stepKind("verifier"), { prompt: p, tools: VERIFIER_TOOLS, maxTurns: config.verifierMaxTurns, model: requestedModel });
          noteArmCall(rec);
          // A verifier cut off at its OWN cap is the same failure as an investigator cut off at its own:
          // its `undetermined`/`turn-budget` verdict refutes and supports nothing, and the round would read
          // as "verified 3, confirmed 0" for a reason that never appears on the record.
          const out = await reportIfCutOff(p, res, rec, stepKind("verifier-report"));
          noteArmCall(out.rec);
          return out.res;
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
      // ⛔ THE PER-CLUSTER CALL LIST (硬规则 5b, Plan item 1): EVERY refuter call THIS cluster consumed,
      // captured AT THE CALL SITE. The cluster record's refutation fields are read from this list — never
      // from the engine row, and never from a round-level list two clusters share. That is what makes «two
      // clusters whose refuter calls differ ⇒ each cluster's fields equal its OWN call's» a property of the
      // join rather than a hope about call ordering.
      // ⛔ It is filled by SLICING the round's own `callRecords` rather than by pushing at the call site: a
      // TRANSPORT retry inside `reservingStep` leaves TWO records (the lost attempt and the retry) and
      // returns only the second, so a push would report one call where two were spent — a count that lies
      // (硬规则 3b). The slice is exact because the refuter is the ONLY step this block runs.
      let refuterCallList: Record<string, unknown>[] = [];
      if (row.verdict === "supported") {
        const refuterCallMark = callRecords.length;
        const one = await hyp.runVerifier({
          // Plan item 3: the first verifier's cited lines ride along as STARTING POINTS (a shortcut to the
          // files, never a case to agree with). The template is byte-identical when it cited nothing.
          clusters: [cluster], pinDir: pinned, cwd: pinned, promptTemplate: refutationPromptFor(row.evidence),
          maxClusters: 1, concurrency: 1, maxMs: config.maxWallMs, strategy: "default", onlyCluster: 1, // concurrency-default-fallback: ONE cluster, ONE call
          evidence: null, model: requestedModel,
          runModel: async (p: string) => {
            const { res, rec } = await reservingStep(stepKind("refuter"), { prompt: p, tools: REFUTER_TOOLS, maxTurns: config.refutationMaxTurns, model: requestedModel });
            noteArmCall(rec);
            // ── THE TRUNCATED REFUTER GETS ONE FRESH-CONTEXT RETRY WITH A LARGER BUDGET (Plan item 2) ───
            // ⛔ WHY THE TOOL-LESS ANSWER RESERVE IS *REPLACED* HERE RATHER THAN FOLLOWED. `reportIfCutOff`
            // hands the model its OWN exploration narration back and asks it to report — which is exactly
            // the wrong second chance for a refuter: the refuter's value IS its fresh, independent reading,
            // and an answer distilled from its own truncated attempt is the same attempt continued. The
            // retry is therefore a FRESH call, with the ORIGINAL prompt, on a LARGER budget, reserved on the
            // SAME trailing-24h ledger as everything else (so it is counted and capped like any other call;
            // a refusal at its reservation throws the round's ordinary BudgetRefusedError).
            // ⛔ `budget-truncated` ONLY: a call that failed for another reason has no reasoning that more
            // turns would recover, and retrying it would burn a counted call reproducing the failure.
            let last = { res, rec };
            if (callNotEvaluatedToken(rec) === "not-evaluated:error_max_turns") {
              const retry = await reservingStep(stepKind("refuter"), { prompt: p, tools: REFUTER_TOOLS, maxTurns: config.refutationRetryMaxTurns, model: requestedModel });
              // ⛔ A MARKER OF ITS OWN (`budget_retry`), never `retry_cause`: `retry_cause`/`retry_of` are
              // the TRANSPORT-retry contract `reservingStep` already owns and its tests pin, and writing
              // this cause into them would either overwrite a transport cause or be overwritten by one.
              retry.rec.budget_retry = true;
              retry.rec.budget_retry_cause = "budget-truncated";
              noteArmCall(retry.rec);
              last = retry;
            }
            return last.res;
          },
        });
        if (one.ok !== true) {
          const reasons = Array.isArray(one.reasons) ? (one.reasons as string[]) : [];
          return { ok: false, reason: `${armPrefix}refuter refused — ${reasons[0] ?? "no reason reported"} (nothing appended, last-run not advanced)` };
        }
        refutation = (Array.isArray(one.results) ? one.results[0] : null) as Record<string, unknown> | null;
        // The slice: every refuter-step record from the mark to NOW, in call order — the lost attempt of a
        // transport retry included.
        refuterCallList = callRecords.slice(refuterCallMark).filter((c) => String(c.step).endsWith("refuter"));
      }
      // ── THE JOIN + THE CAUSE, IN ONE PLACE (Plan item 1) ────────────────────────────────────────────
      // Everything below is read from the cluster's OWN calls: the CLI's `num_turns` (not the row's
      // tool-call count), the stream's subtype, the tool-use counts, and the ONE token that says WHY an
      // `undetermined` was undetermined. `not-run` keeps its own spelling for a cluster whose verifier did
      // not support it — an unrun refutation is not a verdict.
      const refutationRead = refutationReading({ calls: refuterCallList, result: refutation });
      if (row.verdict !== "supported") {
        entry.refutation_verdict = "not-run";
      } else {
        entry.refutation_verdict = refutationRead.verdict;
        entry.refutation_counterexample = refutationRead.counterexample;
        entry.refutation_turns = refutationRead.turns;
        entry.refutation_cost_usd = refutationRead.cost_usd;
        entry.refutation_subtype = refutationRead.subtype;
        // ⛔ THE FOUR-WAY CAUSE. `undetermined` alone taught nothing; this says whether the round was cut
        // off by its own budget, never called back, could not be read, or read the code and found nothing.
        entry.refutation_undetermined_cause = refutationRead.undetermined_cause;
        entry.refutation_checked = refutationRead.checked;
        entry.refutation_evidence_cited = refutationRead.evidence_cited;
        entry.refutation_call = refutationRead;
      }
      // `confirmed` REQUIRES surviving the refuter — AND the survival being DETERMINATE. An unrun,
      // undetermined or refuted refutation is NOT a confirmation (fail-closed: "we could not refute it" is
      // not "it is true"), and neither is a `supported` read off a call that never answered or whose answer
      // could not be parsed (Plan 4: what counts as confirmed is UNCHANGED — this only refuses to let a
      // non-reading spell one).
      const confirmed = row.verdict === "supported" && refutationRead.verdict === "supported" && refutationRead.undetermined_cause === null;
      entry.confirmed = confirmed;
      // ── WHICH STEP BLOCKED THIS CLUSTER, AND THAT STEP'S OWN CAUSE (Plan item 3) ────────────────────
      // Read from the fields written ABOVE (never re-derived from the raw verdicts), so the per-cluster
      // block and the refutation fields it summarises cannot disagree (硬规则 5b). A cluster the verifier
      // did not support is blocked AT THE VERIFIER: its `refutation_verdict:"not-run"` is a consequence.
      entry.attribution = clusterAttribution({
        verifierVerdict: typeof row.verdict === "string" ? row.verdict : null,
        verifierCause: typeof row.verdict_cause === "string" ? row.verdict_cause : null,
        refutationVerdict: typeof entry.refutation_verdict === "string" ? entry.refutation_verdict : null,
        refutationUndeterminedCause: typeof entry.refutation_undetermined_cause === "string" ? entry.refutation_undetermined_cause : null,
      });
      // ⑨ (d2) SEMANTIC VALUE ASSESSMENT — bounded, for confirmed clusters only, recorded as the MODEL's
      //    assessment and never as a human rating.
      if (confirmed) {
        const one = await hyp.runVerifier({
          clusters: [cluster], pinDir: pinned, cwd: pinned, promptTemplate: VALUE_PROMPT_TEMPLATE,
          maxClusters: 1, concurrency: 1, maxMs: config.maxWallMs, strategy: "default", onlyCluster: 1, // concurrency-default-fallback: ONE cluster, ONE call
          evidence: null, model: requestedModel,
          runModel: async (p: string) => {
            const { res, rec } = await reservingStep(stepKind("value-assessment"), { prompt: p, tools: VALUE_TOOLS, maxTurns: config.refutationMaxTurns, model: requestedModel });
            noteArmCall(rec);
            const out = await reportIfCutOff(p, res, rec, stepKind("value-assessment-report"));
            noteArmCall(out.rec);
            return out.res;
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
      const { res: noveltyRes, rec: callRec } = await reservingStep(stepKind("novelty-check"), {
        prompt, tools: NOVELTY_TOOLS, maxTurns: config.refutationMaxTurns, model: requestedModel,
      });
      noteArmCall(callRec);
      const noveltyOut = await reportIfCutOff(prompt, noveltyRes, callRec, stepKind("novelty-check-report"));
      noteArmCall(noveltyOut.rec);
      const res = noveltyOut.res;
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
        retrieved: retrieval.candidates.length, broad: retrieval.broad.length,
        // BOTH calls when the check was rescued: the novelty check's cost is what the round actually spent
        // on it, and charging only the cut-off call would under-report the ledger's own reading.
        calls: noveltyOut.rec === callRec ? 1 : 2,
        cost_usd: typeof callRec.cost_charged_usd === "number" || typeof noveltyOut.rec.cost_charged_usd === "number"
          ? round6(Number(callRec.cost_charged_usd ?? 0) + (noveltyOut.rec === callRec ? 0 : Number(noveltyOut.rec.cost_charged_usd ?? 0)))
          : null,
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
      // …and the clock is yielded ONCE, so the declaration is provably older than the first call it
      // scores (see PREREG_SETTLE_MS — it can only make it older, never younger).
      await new Promise((resolve) => setTimeout(resolve, PREREG_SETTLE_MS));
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
      const shadowOutDir = path.join(pinned, ".open-semantic-discovery-runs", "shadow");
      const shadowPrompt = `${focusDirective(focuses)}\n${reserveDirective}\n${taskLogContextText}${selection.shadow_text}${basePrompt}\n\n${inventory.ok === true ? String(inventory.text ?? "") : ""}`;
      let shadowCalls = 0;
      const shadowCallRecords: Record<string, unknown>[] = [];
      const shadowInv = await hyp.runInvestigator({
        prompt: shadowPrompt,
        neutralDir: pinned,
        cwd: pinned,
        pinDir: pinned,
        runs: config.investigatorRuns,
        // A separate runs directory: the shadow pass must not overwrite the production pass's run files.
        outDir: shadowOutDir,
        writeFile: (f: string, t: string) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t, "utf8"); },
        budget: { maxRuns: config.investigatorRuns, maxMs: config.maxWallMs },
        model: requestedModel ?? "not-evaluated:model-unverified",
        tools: INVESTIGATOR_TOOLS,
        maxTurns: config.investigatorMaxTurns,
        runModel: async (p: string, i: number) => {
          const { res, rec } = await reservingStep("shadow-investigator", { prompt: p, tools: INVESTIGATOR_TOOLS, maxTurns: config.investigatorMaxTurns, model: requestedModel });
          shadowCalls++;
          // Same one-entry-per-call discipline as the production arms: `reportIfCutOff` returns the SAME
          // record when it did not fire.
          if (!shadowCallRecords.includes(rec)) shadowCallRecords.push(rec);
          // The shadow pass gets the SAME one-shot reserve: it is an isolated measurement, but a shadow run
          // cut off at the cap measures nothing, and its calls already count against the same ledger.
          const out = await reportIfCutOff(p, res, rec, "shadow-investigator-report");
          if (!shadowCallRecords.includes(out.rec)) shadowCallRecords.push(out.rec);
          if (out.rec !== rec) shadowCalls++;
          return out.res;
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
          // The shadow arm's failure is its OWN reading, never the production round's: an extra arm that
          // was cut off must not make a production round that DID explore read as not-evaluated.
          not_evaluated: firstNotEvaluatedToken(shadowCallRecords),
          answer_reserve: summarizeReserve(shadowCallRecords),
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
      // ── THE ROUND-LEVEL ANCHOR-HANDOFF READING (task gap-osd-stream-without-result-recurs-…) ────────
      // The SAME reading every call record carries, evaluated at the round's own start instant. It is on
      // the round line as well so a reader can stratify rounds without unfolding every call — and so a
      // round whose calls never got as far as being recorded still says whether it ran in the tail of a
      // handoff. ⛔ `adjacent` is derived from `age_ms` here too: the window lives in ONE constant.
      handoff: handoffBlock(anchorStartRead, started),
      inventory: { ok: inventory.ok, entries: inventory.entries, unavailable: inventory.unavailable, scope: INVENTORY_SCOPE_REL },
      focus: { chosen: investigatorBlock.stated_focus ?? null, prior_focuses: focuses },
      // ── THE OPTIONAL TASK-STATUS CONTEXT (Plan items 1-3) ────────────────────────────────────────
      // What was FETCHED (cursor before/after, the events offered, and why the list may be incomplete),
      // and whether the model's OWN stated focus named any of them. ⛔ The cursor lives HERE, on the line
      // that is appended with the round: a round that crashed before this append left no cursor, so the
      // next round re-reads the same window (at-least-once, deduped by `eventId`).
      task_log: {
        ...taskLogContext,
        focus_citation: citeOfferedEvents(investigatorBlock.stated_focus, taskLogContext.offered),
      },
      investigator: investigatorBlock,
      clusters: { total: clusters.length, verified: verifiedRows.length, beyond_cap: Math.max(0, clusters.length - verifiedRows.length) },
      confirmed: { count: confirmedClusters.length, claims: confirmedClusters.map((c) => c.claim) },
      // ── THE ROUND-LEVEL VIEW OF THE PER-CLUSTER JOIN (Plan items 3-4) ──────────────────────────────
      // So a round reading `confirmed:0` is EXPLAINABLE without a second pass over its cluster lines:
      // `blocked`/`causes` say which step lost which cluster and why, and `healthy` is the stated
      // resident-round DoD (every verified cluster was judged, or lost to a NAMED, non-budget cause).
      // ⛔ `determinate_rate`/`healthy` are `null` when the round verified nothing — «judged nothing» is
      // not «judged everything correctly» (硬规则 3b).
      attribution: roundAttribution(clusterRecords),
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
      // ⛔ The round's OWN id, the one every reservation of this round carries in the ledger: it is what
      // makes AC4's "ledger reservation count == model_calls" a reading a verifier can reproduce.
      round_id: roundId,
      model_calls: budget.grantedCount,
      // ── THE ANSWER RESERVE, round-wide (Plan item 2) ──────────────────────────────────────────────
      // Every step's rescue calls, read off the round's own call records: how many were granted, how many
      // answered, and which are still not evaluated. A `rescued: N` with `attempted: N` says the turn cap
      // cost the round calls that had to be paid for twice; `attempted: 0` says no step was cut off.
      answer_reserve: summarizeReserve(callRecords),
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

    // ⑩c THE EVIDENCE-STORE PROJECTION — this routine IS the ONE resident producer that store has.
    //     ⛔ WHY A RESIDENT ROUND MUST WRITE IT AT ALL: `discovery_method`'s ingest step reads
    //     `.quay/architecture-evidence-store.jsonl`, and NO resident routine ever wrote it, so its
    //     `ingested 0` was permanent — honest, and therefore permanently useless. This round's own
    //     clusters ARE real outcome material; projecting them into the store's own shapes (a
    //     `hypothesis` carrying the cluster's claim, an `outcome` carrying its derived verdict) is what
    //     makes that zero (or non-zero) carry information (硬规则 4).
    //     ⛔ THE PROJECTION IS THE LEDGER MODULE'S, NOT THIS FILE'S, and the VALIDATION is the engine's
    //     production validator: a refused record is REPORTED in the tally below, never dropped and never
    //     patched into something acceptable. Nothing here is synthesized — every field is read off the
    //     cluster record the round just wrote.
    //     ⛔ AFTER the carrier append, like the Experience writes above: an outcome's `experiment_ref`
    //     names a cluster record that must really be resolvable on disk.
    //     ⛔ And it is written under the SHARED checkout the batch ingester itself resolves, so what this
    //     round projects and what the next round reads are the same file by construction.
    let evidenceStoreWrite: Record<string, unknown>;
    {
      const storeRecords = modules.ledger.clusterStoreRecords(clusterRecords, { experiment: modules.ledger.CLUSTER_OUTCOME_EXPERIMENT, runId: roundId });
      const shape = {
        attempted: storeRecords.length,
        hypotheses: storeRecords.filter((r) => r.kind === "hypothesis").length,
        outcomes: storeRecords.filter((r) => r.kind === "outcome").length,
      };
      // A round with nothing verdict-bearing emits NOTHING and says so — it does not append an empty
      // tally line to the carrier, and it does not touch the store.
      if (storeRecords.length === 0) {
        evidenceStoreWrite = { ...shape, accepted: 0, refused: 0, refused_reasons: {}, stored: 0, store_refused: [], error: null };
      } else {
        const rr = modules.ledger.resolveCarrierRoot(root);
        if (rr.ok !== true || typeof rr.root !== "string") {
          evidenceStoreWrite = { ...shape, accepted: 0, refused: 0, refused_reasons: {}, stored: 0, store_refused: [], error: `SHARED_CHECKOUT_UNRESOLVED:${String(rr.reason ?? "no reason reported")}` };
        } else {
          try {
            const tally = modules.hyp.emit(storeRecords, { writeStore: true, root: rr.root });
            evidenceStoreWrite = {
              ...shape,
              accepted: Number(tally.accepted ?? 0),
              refused: Number(tally.refused ?? 0),
              refused_reasons: tally.reasons ?? {},
              stored: Number(tally.stored ?? 0),
              store_refused: Array.isArray(tally.storeRefused) ? tally.storeRefused : [],
              error: null,
            };
          } catch (e) {
            // A store write that THREW is reported as its own failure and never as `stored: 0` — an
            // un-written projection and an empty one must not share a shape (硬规则 3b).
            evidenceStoreWrite = { ...shape, accepted: 0, refused: 0, refused_reasons: {}, stored: 0, store_refused: [], error: (e as Error)?.message ?? String(e) };
          }
        }
      }
      appendCarrierRecords(carrier, [{
        kind: "evidence-store-write",
        routine: OPEN_SEMANTIC_DISCOVERY_NAME,
        invoked_by: invokedBy,
        ts: new Date(now()).toISOString(),
        round_ts: roundTs,
        ...evidenceStoreWrite,
      }]);
      round.evidence_store = evidenceStoreWrite;
    }
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
    // ── "NOT EVALUATED" IS NOT "FOUND NOTHING" (Plan item 1, 硬规则 3b) ───────────────────────────────
    // The defect this task closes: production recorded `exit 1`, `turns 13` under `--max-turns 12`, zero
    // hypotheses — and the Fact said the round ran. A round whose calls did NOT answer is reported by the
    // token that says WHY, so the two states can never be read for one another again.
    // The shadow arm's own reading is computed FIRST, so this sentence can name it too: a round whose
    // production calls did not answer but whose draft-method arm ran is a different statement from one
    // where nothing ran at all.
    const shadowNote = selection.shadow.length === 0
      ? ""
      : `; shadow arm ${shadowBlock.ran === true ? `ran ${Number(shadowBlock.calls ?? 0)} call(s) under ${selection.shadow.map((m) => methodLabel(m)).join(",")} (${shadowClusters.length} hypothesis cluster(s), NEVER ingested)` : `did not run (${String(shadowBlock.reason ?? "")})`}`;
    const failedCalls = callRecords.filter((c) => typeof c.not_evaluated === "string");
    const firstFailed = failedCalls.length === 0 ? null : String(failedCalls[0].not_evaluated);
    const failedTokens = [...new Set(failedCalls.map((c) => String(c.not_evaluated)))];
    if (firstFailed !== null && clusters.length === 0 && confirmedClusters.length === 0) {
      return fact(
        "not-evaluated",
        round,
        `${firstFailed}: the investigator produced NO parsed hypothesis cluster — ${budget.grantedCount} model call(s), ${failedCalls.length} of them NOT EVALUATED (${failedTokens.join(",")}), costing $${round6(costUsd)}, wall ${wallMs}ms. The scan-round line IS persisted, so the round's own record says what happened; ⛔ do NOT read this as "explored and found nothing" — the model never got to answer${resident ? " (the production last-run WAS advanced)" : " (MANUAL: the production last-run was NOT advanced)"}${shadowNote}${revertedNote}${legacyNote}`,
      );
    }
    // An ingestion that FAILED is not folded into a success sentence: the round's semantic work is real
    // and already persisted, but the Fact must say the ledgers did not all get written.
    const ingestionNote = ingestionError !== null
      ? `; ⛔ INGESTION FAILED — ${ingestionError} (the scan-round and cluster records ARE persisted; the Experience/Portfolio writes are not)`
      : `; ingested ${ingestionWrites.length} cluster(s): ${ingestionWrites.filter((w) => w.experience.written).length} Experience(s), ${ingestionWrites.filter((w) => w.portfolio.written).length} Portfolio row(s)`;
    const methodNote = selection.mode === "guided"
      ? `; methods GUIDED by ${selection.production.map((m) => methodLabel(m)).join(",")}`
      : `; methods BASELINE (${selection.baseline_reason})`;
    // A round that produced work AND had calls that did not answer says BOTH: the counts above are counts
    // over the calls that replied, and a reader who is not told that would take them for the whole round.
    const failedNote = failedCalls.length === 0
      ? ""
      : `; ⛔ ${failedCalls.length} of ${callRecords.length} call(s) were NOT EVALUATED (${failedTokens.join(",")}) — the counts above are over the calls that answered, not over the exploration that was asked for`;
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
      `round ran (invoked_by:${invokedBy}, interval ${intervalMinutes}m): investigator read the pin with ${INVESTIGATOR_TOOLS} (focus: ${investigatorBlock.stated_focus ?? "<not stated>"}), ${clusters.length} cluster(s) from ${investigatorBlock.runs_with_hypotheses} run(s), ${verifiedRows.length} verified, ${confirmedClusters.length} CONFIRMED after independent refutation, ${budget.grantedCount} model call(s) costing $${round6(costUsd)}, wall ${wallMs}ms; appended 1 scan-round + ${clusterRecords.length} cluster record(s) to ${asRel(root, carrier)}${resident ? " and advanced the production last-run" : " — MANUAL: the production last-run was NOT advanced"}${ingestionNote}${methodNote}${shadowNote}${pairedNote}${failedNote}${revertedNote}${legacyNote}`,
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
        // The context this round fetched, so a refusal line is as readable as a completed one about what
        // the model was (or was not) offered. ⛔ No `focus_citation` here: this round was cut off before the
        // model answered, and a citation reading over a half-round would be a reading of nothing.
        task_log: taskLogContext,
        methods: selectionBlock,
        budget_24h: countBudgetBlock, budget_usd_24h: usdBudgetBlock, wall_ms: now() - started, round_id: roundId, model_calls: budget.grantedCount, calls: callRecords,
        tokens: { input: tokensIn, output: tokensOut }, cost_usd: round6(costUsd),
      };
      appendCarrierRecords(carrier, [round]);
      return fact("not-evaluated", round, `budget-24h: the ${midRound.kind} step was refused by the 24h ceiling (${midRound.used} reservation(s) >= cap ${midRound.cap}) — ${budget.grantedCount} call(s) were already made and stay RESERVED; the round persisted what it did (1 scan-round line) but did NOT advance the production last-run${revertedNote}${legacyNote}`);
    }
    if (e instanceof BudgetLockError) {
      return fact("failed", { ...base, enabled: true, interval: intervalInfo, due: dueInfo }, `budget lock unavailable — ${e.message} (nothing appended, last-run not advanced)`);
    }
    if (isStoppedMidRound(e)) {
      // ── 半轮被停机打断（gap-quality-restart-waits-out-whole-round-so-osd-in-flight-exceeds-stop-window）──
      // ⛔ 与 `budget-24h` 中途拒绝**同一条码路**：这一轮已经花掉的预留留在台账上（一笔花掉的预留就是
      // 花掉了），把**已经做过的事**持久化成一行 scan-round，但 ⛔ **绝不**记 `verified`——半轮不是一轮
      // （硬规则 3b：`verified` 与 `stopped-mid-round` 必须不同形），也 ⛔ 不推进生产 last-run（停机不是
      // 「这一轮跑过了」，下一轮该照常 due）。
      const round: Record<string, unknown> = {
        kind: "scan-round", routine: OPEN_SEMANTIC_DISCOVERY_NAME, invoked_by: invokedBy, ts: new Date(now()).toISOString(),
        // ⛔ `partial:true` 让「未推进 last-run」这句话**结构上**为真而不是名义上为真（硬规则 4）：
        //    due 基准 `latestResidentRoundTs` 跳过 `partial:true` 的行（见其注释），所以这一轮的行落在
        //    载体上、可审计，却**不会**把生产时钟往前推——停机不是「这一轮跑过了」。
        partial: true, partial_reason: `${STOPPED_MID_ROUND}:${e.step}`,
        stopped_mid_round: {
          step: e.step,
          // `true` = 停机**先到**、这一步是在停机之后才被走到（因此**没有**取预留）；
          // `false` = 停机到达时这一步**正在飞**（它的预留已花掉、outcome 已记）。
          after_stop: e.afterStop,
          // 这一轮**已做出**的读数（`calls` 就是它的直接量）——读者据此判断「停下来时做到哪了」。
          calls_made: callRecords.length,
          reservations_granted: budget.grantedCount,
        },
        interval: intervalInfo, due: dueInfo, pin: { rev, dir: asRel(root, pinned) }, inventory: { ok: inventory.ok, entries: inventory.entries, unavailable: inventory.unavailable },
        investigator: investigatorBlock,
        reservations: { cap: config.maxModelCallsPer24h, used_at_start: callsUsage.total, granted: budget.grantedCount, refused: budget.refusedCount, ledger: asRel(root, ledgerPath) },
        task_log: taskLogContext,
        methods: selectionBlock,
        budget_24h: countBudgetBlock, budget_usd_24h: usdBudgetBlock, wall_ms: now() - started, round_id: roundId, model_calls: budget.grantedCount, calls: callRecords,
        tokens: { input: tokensIn, output: tokensOut }, cost_usd: round6(costUsd),
      };
      let persisted = true;
      try {
        appendCarrierRecords(carrier, [round]);
      } catch (err) {
        // ⛔ 落痕失败**不静默**：这一支的读数是「试图持久化，失败了」，与「持久化了」不同形（硬规则 3b）。
        persisted = false;
        process.stderr.write(`open-semantic-discovery: stopped-mid-round carrier append failed — ${(err as Error)?.message ?? String(err)}\n`);
      }
      const reservationLedger = asRel(root, ledgerPath);
      return fact(
        "not-evaluated",
        round,
        `${STOPPED_MID_ROUND}: the resident loop's stop signal arrived during the ${e.step} step (${e.afterStop ? "after the stop, before its reservation — no call was made for it" : "while that call was in flight; the call was killed and its reservation stays SPENT"}) — ` +
        `${callRecords.length} call(s) already made stay RESERVED on ${reservationLedger} (⛔ a spent reservation is not refunded), ${persisted ? "the round persisted what it did (1 scan-round line)" : "⛔ the round's scan-round line could NOT be persisted"}, and the production last-run was NOT advanced (a stopped half-round is not a round that ran)${revertedNote}${legacyNote}`,
      );
    }
    return fact("failed", { ...base, enabled: true, interval: intervalInfo, due: dueInfo }, `round threw — ${(e as Error)?.message ?? String(e)} (nothing appended, last-run not advanced)`);
  }
}

// ── RoutineSpec factories ────────────────────────────────────────────────────────────────────────────
export interface OpenSemanticDiscoveryRoutineOptions
  extends Omit<OpenSemanticDiscoveryRunOptions, "config" | "configPresent" | "configError" | "halted" | "invokedBy" | "force" | "signal"> {}

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
        // 常驻循环的协作式取消信号（`RoutineRunContext.signal`）。⛔ 只有循环会传它：手动单发 / `--once`
        // 不带 signal ⇒ 与从前逐字相同（一次偶发的停机不该打断运维手敲的 `--force` 轮）。
        signal: ctx?.signal,
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
  refutationRetryMaxTurns: number | null;
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
    refutationRetryMaxTurns: cfg ? cfg.refutationRetryMaxTurns : null,
  };
}

// ── THE REPORT SURFACE (Plan items 3-4) ───────────────────────────────────────────────────────────────
// ⛔ READ-ONLY AND SPAWN-FREE. It exists because a per-round boolean is not an instrument: Plan item 4
// asks for the resident-round DoD to be «a reportable rate», and Plan item 3 asks for a round's
// `confirmed:0` to be explainable PER CLUSTER. Both are readings of the carrier this routine already
// writes, so the report is a VIEW of the same lines a human audits — never a parallel accounting that
// could disagree with them (硬规则 5b).
export interface DiscoveryAttributionReport {
  /** The last `window` scan-rounds, newest last, each with its own clusters' joined attribution. */
  rounds: Array<{
    ts: string | null;
    invoked_by: string | null;
    confirmed: number;
    attribution: RoundAttribution | null;
    /** The PRODUCTION chain's clusters for this round, in record-id order. */
    clusters: Array<{
      cluster: unknown;
      claim: unknown;
      blocking_step: string;
      blocking_cause: string | null;
      determinate: boolean | null;
      /** `stored` = the block the ROUND wrote. `derived` = the same join computed afterwards from the
       *  cluster line's own verdict fields, for records written before the block existed. ⛔ The two are
       *  never merged into one reading — a derivation is not a measurement of itself. */
      provenance: "stored" | "derived";
    }>;
    /** Cluster lines of the same round belonging to an INSTRUMENT arm (`#shadow#` / `#baseline#`).
     *  ⛔ Counted, never merged and never silently dropped: those arms verify nothing by construction, so
     *  listing them beside production clusters as «unattributed» would read as the mechanism failing to
     *  attribute rather than as an arm that was never asked to judge (硬规则 3b). */
    instrument_arm_clusters_skipped: number;
  }>;
  health: ReturnType<typeof residentRoundHealth>;
  call_failures: ReturnType<typeof callFailureSplit>;
}

export function buildDiscoveryReport(
  records: readonly Record<string, unknown>[],
  opts: { window?: number; invokedBy?: string } = {},
): DiscoveryAttributionReport {
  const window = opts.window ?? RESIDENT_HEALTH_WINDOW_ROUNDS;
  const allRounds = records.filter((r) => r.kind === "scan-round");
  const slice = allRounds.slice(Math.max(0, allRounds.length - window));
  const rounds = slice.map((r) => {
    const ts = typeof r.ts === "string" ? r.ts : null;
    const prefix = ts === null ? null : `${OPEN_DISCOVERY_REF_PREFIX}${ts}#`;
    const sameRound = prefix === null ? [] : records.filter((c) => c.kind === "cluster" && typeof c.record_id === "string" && String(c.record_id).startsWith(prefix));
    // The PRODUCTION chain is the segment that is a bare integer. `#shadow#3` / `#baseline#3` are the
    // instrument arms: they are separated here rather than filtered silently.
    // ⛔ A CHARACTER WALK, NOT A PATTERN. Case (l) of this file's contract asserts mechanically that the
    // module carries no pattern machinery at all, and that control reads by POSITION: a pattern that
    // selects nothing here would still trip it. (Naming the forbidden forms in this comment would trip it
    // too — see the maintainer warning in the file header.)
    const isProduction = (c: Record<string, unknown>): boolean => {
      const seg = String(c.record_id).slice(prefix!.length);
      return seg.length > 0 && [...seg].every((ch) => ch >= "0" && ch <= "9");
    };
    const mine = sameRound.filter(isProduction);
    const instrumentArm = sameRound.length - mine.length;
    return {
      ts,
      invoked_by: typeof r.invoked_by === "string" ? r.invoked_by : null,
      confirmed: Number((r.confirmed as { count?: unknown } | undefined)?.count ?? 0),
      attribution: (r.attribution ?? null) as RoundAttribution | null,
      instrument_arm_clusters_skipped: instrumentArm,
      clusters: mine.map((c) => {
        // A stored block is used VERBATIM when the round wrote one. Only when it did not is the same join
        // computed from the line's own verdict fields — and the difference is carried on the entry, so a
        // reader can always tell which of the two readings they are looking at.
        const stored = (c.attribution ?? null) as ClusterAttribution | null;
        const a = stored ?? clusterAttributionFromRecord(c).attribution;
        return {
          cluster: c.cluster ?? null,
          claim: c.claim ?? null,
          blocking_step: a.blocking_step,
          blocking_cause: a.blocking_cause,
          determinate: a.determinate,
          provenance: stored === null ? "derived" as const : "stored" as const,
        };
      }),
    };
  });
  return {
    rounds,
    health: residentRoundHealth(records, { window, invokedBy: opts.invokedBy }),
    call_failures: callFailureSplit(records),
  };
}

/** The TEXT rendering of `buildDiscoveryReport` — same values, no second computation, so a pasted
 *  transcript and `--json` cannot disagree. */
export function renderDiscoveryReport(report: DiscoveryAttributionReport): string {
  const out: string[] = [];
  out.push(`per-round per-cluster attribution (last ${report.rounds.length} rounds):`);
  for (const r of report.rounds) {
    const a = r.attribution;
    out.push(
      `  ${r.ts ?? "(no-ts)"}  ${r.invoked_by ?? "(no-caller)"}  confirmed=${r.confirmed}` +
      `  judged=${a === null ? "unattributed" : `${a.determinate}/${a.verified}`}` +
      `  healthy=${a === null ? "unattributed" : String(a.healthy)}`,
    );
    if (a !== null && Object.keys(a.causes).length > 0) out.push(`    causes: ${JSON.stringify(a.causes)}`);
    if (r.instrument_arm_clusters_skipped > 0) out.push(`    (${r.instrument_arm_clusters_skipped} instrument-arm cluster line(s) of this round are not part of the production chain and are not listed)`);
    for (const c of r.clusters) {
      out.push(`    cluster ${String(c.cluster)}: blocked_by=${c.blocking_step}${c.blocking_cause === null ? "" : `:${c.blocking_cause}`} determinate=${String(c.determinate)} [${c.provenance}] — ${String(c.claim ?? "").slice(0, 160)}`);
    }
  }
  out.push("");
  out.push(`resident-round DoD (rolling, window=${report.health.window}, attributed=${report.health.attributed_rounds}/${report.health.rounds}): healthy=${String(report.health.healthy)} rate=${report.health.determinate_rate === null ? "null" : report.health.determinate_rate.toFixed(3)}`);
  out.push(`  ${report.health.basis}`);
  out.push("");
  out.push("call-failure split by step envelope (FIRST attempts only) + the retry population:");
  for (const row of report.call_failures.rows) {
    out.push(`  ${row.step} tools=${JSON.stringify(row.tools)} max_turns=${String(row.max_turns)} calls=${row.calls} failed=${row.failed} rate=${row.failed_rate === null ? "null" : row.failed_rate.toFixed(3)} ${JSON.stringify(row.causes)}`);
  }
  const rt = report.call_failures.retries;
  out.push(`  RETRIES: attempts=${rt.attempts} answered=${rt.answered} answered_rate=${rt.answered_rate === null ? "null" : rt.answered_rate.toFixed(3)} ${JSON.stringify(rt.by_cause)}`);
  return out.join("\n");
}

// ── CLI (a one-shot MANUAL round) ────────────────────────────────────────────────────────────────────
const USAGE = [
  "open-semantic-discovery-routine — open-ended semantic architecture discovery as a Layer-1b routine (report-only).",
  "  --once --root <dir> [--json]      run ONE MANUAL round against <dir> (invoked_by:\"manual\")",
  "  --force                           manual: run even inside the interval (still never advances",
  "                                    .quay/routine-last-run.json — production's clock is not yours)",
  "  --pin-tmp <dir>                   temp root for the stripped pins",
  "  --report --root <dir> [--json] [--window N]",
  "                                    READ-ONLY, ZERO SPAWNS: print the per-cluster attribution join of",
  "                                    the last N rounds, the rolling resident-round DoD rate, and the",
  "                                    call-failure split by step envelope. This is the instrument Plan",
  "                                    items 3-4 rest on; it writes nothing and spawns nothing.",
  "⛔ This CLI is ALWAYS a manual round: it reads the production interval but never advances it. The",
  "   resident round (the one that advances it) is assembled by the quality-gate driver's routine table.",
].join("\n");

async function main(argv: string[]): Promise<number> {
  const root = (() => { const i = argv.indexOf("--root"); return path.resolve(i >= 0 && argv[i + 1] ? argv[i + 1] : process.cwd()); })();
  const json = argv.includes("--json");
  const pinTmpRoot = (() => { const i = argv.indexOf("--pin-tmp"); return i >= 0 && argv[i + 1] ? path.resolve(argv[i + 1]) : undefined; })();
  // ── THE REPORT MODE: read the carrier and print the readings. ZERO spawns, ZERO writes. ─────────────
  // ⛔ An UNREADABLE carrier is a `failed` (exit 1), never an empty report: «the carrier could not be
  // read» and «the carrier holds no rounds» are different facts (硬规则 3b, and the same rule the round
  // itself applies at ③).
  if (argv.includes("--report")) {
    const wIdx = argv.indexOf("--window");
    const window = wIdx >= 0 && argv[wIdx + 1] ? Number(argv[wIdx + 1]) : RESIDENT_HEALTH_WINDOW_ROUNDS;
    if (!Number.isInteger(window) || window < 1) {
      process.stderr.write(`--window must be an integer >= 1 (got ${JSON.stringify(argv[wIdx + 1] ?? null)})\n`);
      return 1;
    }
    let records: Record<string, unknown>[];
    try {
      records = readCarrierRounds(path.join(root, CARRIER_REL)).records;
    } catch (e) {
      process.stderr.write(`unreadable carrier — ${(e as Error).message}\n`);
      return 1;
    }
    const report = buildDiscoveryReport(records, { window });
    process.stdout.write(json ? `${JSON.stringify({ root, carrier: CARRIER_REL, report }, null, 1)}\n` : renderDiscoveryReport(report) + "\n");
    return 0;
  }
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
