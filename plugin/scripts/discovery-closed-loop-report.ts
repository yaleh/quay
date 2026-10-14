#!/usr/bin/env node
// discovery-closed-loop-report.ts — 架构发现自主闭环的**读侧总账**：一条 finding 从载体记录走到「修完
// 之后还复发吗」的**逐环读数**，以及每个常驻轮**按类枚举**的结局。
// (tasks/gap-discovery-closed-loop-acceptance-report-finding-to-merge-to-effect-on-real-hosts)
//
// ── THE QUESTION THIS MAKES ASKABLE ───────────────────────────────────────────────────────────────
// For each architecture-discovery finding, ON REAL HOSTS: did it actually close the loop?
//
//     carrier record → verifier/refuter verdicts → Task filed via ABI → merged on develop
//                    → post-merge EFFECT re-test (did the concept recur?)
//
// and, per resident round, WHICH of the enumerated outcomes happened. Both halves used to be
// unanswerable without an ad-hoc grep, and the ad-hoc greps disagreed with each other — that
// disagreement is the reason this task exists (see the Proposal's baseline paragraph).
//
// ── WHAT MUST NOT COUNT AS SUCCESS (explicit; the Proposal names these) ───────────────────────────
// `ingested N`, `not-triggered`, `verified` round state, `scan ran`, a Portfolio row without a merged
// fix, and a merged fix without a post-merge effect reading are ALL **intermediate states**. This
// report therefore never emits a single "success" boolean: it emits the CHAIN, one link at a time.
// `closed` is true only when every link is a value AND the effect reading came back negative.
//
// ── EVERY LINK IS A VALUE OR AN EXPLICIT `not-evaluated:<reason>` (硬规则 3b) ─────────────────────
// `null` is never used for "could not read". A link that could not be read carries the string
// `not-evaluated:<reason>` naming WHY, so "I looked and found nothing" and "I could not look" are
// different words on every line — the failure mode this repo's 硬规则 3b exists to stop (a judge that
// cannot read its input must not return a value shaped like the passing one).
//
// ── ROUND CLASSES ARE ENUMERATED, NEVER BOOLEAN (the Proposal's Plan item 1) ──────────────────────
// `ran-with-clusters | ran-empty | not-due | budget-blocked(calls) | budget-blocked(usd) |
//  call-failure(<class>) | stopped-mid-round | disabled | engine-failure` — plus `unclassified(<reason>)`,
// which exists so that a shape this classifier does not know is REPORTED rather than silently dropped
// into one of the named buckets. Every class is counted SEPARATELY; there is no `blocked: true`.
//
// ── REUSE, NEVER RE-DERIVE (硬规则 5b) ────────────────────────────────────────────────────────────
// The concept key comes from the ledger module's own `conceptKeyOfCluster` (the SAME value the round
// writes and the batch ingester dedups on); the landing commit from the portfolio module's own
// `deriveFixLandedCommit`; the recurrence reading from its `deriveRecurred`; the origin vocabulary from
// its `ORIGINS` / `AUTONOMOUS_ORIGINS`; the "half-round was interrupted" token from the driver's own
// `STOPPED_MID_ROUND`. A second copy of any of those would be a second definition to keep in step.
// The engine modules are resolved through the OSD routine's own `resolveEngineModule` and imported at
// RUNTIME (never a static `docs/analysis/...` import — that path is not shipped with the artifact).
//
// ── READ-ONLY, DETERMINISTIC, NEVER A GATE ────────────────────────────────────────────────────────
// This script opens every carrier `O_RDONLY` and WRITES NOTHING — no carrier, no cache, no ledger. It
// spends no model call and changes no budget. Same inputs ⇒ byte-identical output: no wall-clock "now"
// enters the report (every cutoff is taken from a value IN the carriers — a merge commit's own time).
//
// ── EXIT CODES ────────────────────────────────────────────────────────────────────────────────────
//   0  a report was produced (⛔ NOT "the loop is closed" — that is a field, not an exit code)
//   2  a usage error, or an input that could not be READ at all (no host root, unreadable carrier set)
// The report is deliberately NOT wired into `runner-static-gate.ts`; a ratchet over it would be a
// different task with its own baseline.
//
// Usage:
//   node --experimental-strip-types plugin/scripts/discovery-closed-loop-report.ts \
//     --host=quay=/data/home/yale/work/quay --json
//   … --host=<name>=<root> (repeatable; default: one host, basename of --root (default: this repo))
//   … --routine=<name>     (repeatable; default: open-semantic-discovery) — the resident routine whose
//                            per-round Facts are classified
//   … --since=<iso>        (default: none) — the OBSERVATION WINDOW, applied to ROUNDS only.
//                            Findings are reported whole (their carriers are not windowed), so a
//                            finding whose chain started before the window is still visible.
//   … --json               machine output; otherwise a text rendering of the same object.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { isDirectEntry, parseArgs as baseParseArgs } from "./gate-script-base.ts";
import { SCRIPT_REPO_ROOT, resolveEngineModule } from "./open-semantic-discovery-routine.ts";
import { STOPPED_MID_ROUND } from "./driver-runtime.ts";

// ── the carriers this report reads (relative to a host's SHARED checkout) ─────────────────────────

/** The Portfolio: the finding ledger — one line per finding, plus append-only correction/rating/domain
 *  lines. This is the finding CARRIER of record; every chain starts here. */
const PORTFOLIO_REL = ".quay/discovery-portfolio.jsonl";
/** The OSD carrier: `scan-round` + one `cluster` record per finding, carrying the verifier/refuter
 *  verdicts and (since gap-discovery-findings-lack-stable-identity…) the concept identity. */
const OSD_FINDINGS_REL = ".quay/open-semantic-discovery-findings.jsonl";
/** arch-discovery's mechanical carrier: `finding` records keyed by `finding_fp`. */
const ARCH_FINDINGS_REL = ".quay/arch-discovery-findings.jsonl";
/** The routine-findings carrier (semantic-dedup-scan / freshness-refresh findings). */
const ROUTINE_FINDINGS_REL = ".quay/routine-findings.jsonl";
/** The cross-project dogfood carrier — same cluster shape as OSD's (`verifier_verdict` /
 *  `refutation_verdict` / `confirmed`), so it shares OSD's reader. */
const DOGFOOD_FINDINGS_REL = ".quay/cross-project-dogfood-findings.jsonl";
/** The round carrier the resident driver writes: one record per resident round, each holding a Fact
 *  named after the routine it ran. */
const QUALITY_ROUND_REL = ".quay/quality-round.jsonl";

/** The Portfolio line kinds. Declared HERE, character-for-character as `discovery-portfolio.mjs` names
 *  them, because the report reads the RAW lines (it needs line numbers for the citation) rather than
 *  going through `readPortfolio` — which folds the same kinds together and loses the line. */
const PORTFOLIO_KIND = "portfolio_finding";
const PORTFOLIO_CORRECTION_KIND = "portfolio_correction";

/** The finding carrier each `origin_carrier` value names → how its verdict is read. A carrier absent
 *  from this table is NOT assumed verdict-less: the link becomes `not-evaluated:…` naming the carrier. */
const VERDICT_READERS: Record<string, { rel: string; kind: string }> = {
  [OSD_FINDINGS_REL]: { rel: OSD_FINDINGS_REL, kind: "cluster" },
  [DOGFOOD_FINDINGS_REL]: { rel: DOGFOOD_FINDINGS_REL, kind: "dogfood-cluster" },
  [ARCH_FINDINGS_REL]: { rel: ARCH_FINDINGS_REL, kind: "finding" },
  [ROUTINE_FINDINGS_REL]: { rel: ROUTINE_FINDINGS_REL, kind: "finding" },
};

/** The carriers whose verdicts are read with the CLUSTER shape (`verifier_verdict` /
 *  `refutation_verdict` / `confirmed`). Both writers emit that vocabulary; naming them together keeps
 *  the reader from growing a second, drifting copy for the second host. */
const CLUSTER_SHAPED_CARRIERS: readonly string[] = [OSD_FINDINGS_REL, DOGFOOD_FINDINGS_REL];

// ── the enumerated round classes (the Proposal's Plan item 1, verbatim, + one escape hatch) ────────

export const ROUND_CLASSES = Object.freeze([
  "ran-with-clusters",
  "ran-empty",
  "not-due",
  "budget-blocked(calls)",
  "budget-blocked(usd)",
  "call-failure(<class>)",
  "stopped-mid-round",
  "disabled",
  "engine-failure",
] as const);

/** The escape hatch. A Fact whose shape this classifier does not recognise lands HERE, named, rather
 *  than in one of the buckets above — so a new refusal shape shows up as itself in the table instead of
 *  silently inflating `budget-blocked`. ⛔ It is NOT a ninth member of ROUND_CLASSES: the nine are the
 *  vocabulary the task declares, and adding a tenth to that list would be claiming a class that has
 *  never been observed. */
export const UNCLASSIFIED_PREFIX = "unclassified(";

// ── the chain, in order (AC3's link sequence) ─────────────────────────────────────────────────────

export const LINK_ORDER = Object.freeze(["carrier", "verifier", "refuter", "task", "merge", "effect"] as const);
export type LinkName = (typeof LINK_ORDER)[number];

// ── small pure helpers ────────────────────────────────────────────────────────────────────────────

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const isStr = (x: unknown, min = 0): boolean => typeof x === "string" && x.trim().length >= min;

/** THE "could not read it" value. Every link uses this shape and no other. */
export const notEvaluated = (reason: string): string => `not-evaluated:${reason}`;
const isNotEvaluated = (x: unknown): boolean => isStr(x, 1) && String(x).startsWith("not-evaluated:");

/** One `*.jsonl` carrier, read line-by-line. Returns the parseable records WITH their 1-based line
 *  numbers (the citation the chain carries) and the count of lines that did not parse. A carrier that
 *  is ABSENT is its own state (`present:false`) — never an empty record list that reads as "no data". */
export interface CarrierRead {
  rel: string;
  file: string | null;
  present: boolean;
  lines: number;
  records: { rec: Record<string, unknown>; line: number }[];
  malformed_lines: number;
  reason: string | null;
}

export function readCarrier(root: string | null, rel: string): CarrierRead {
  const base: CarrierRead = { rel, file: null, present: false, lines: 0, records: [], malformed_lines: 0, reason: null };
  if (root === null) return { ...base, reason: "no-shared-checkout-could-be-named-for-this-host" };
  const file = path.join(root, rel);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return { ...base, file, present: false, reason: code === "ENOENT" ? null : `carrier-unreadable:${code ?? String(e)}` };
  }
  const records: { rec: Record<string, unknown>; line: number }[] = [];
  let malformed = 0;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim();
    if (raw === "") continue;
    try {
      const rec = JSON.parse(raw) as unknown;
      if (isObj(rec)) records.push({ rec, line: i + 1 });
      else malformed += 1;
    } catch {
      malformed += 1;
    }
  }
  return { ...base, file, present: true, lines: lines.length - 1, records, malformed_lines: malformed, reason: null };
}

/** `git merge-base --is-ancestor <sha> <branch>` — is this commit ON the landing branch?
 *  `null` (its own value) when the question could not be ASKED (git unrunnable / sha unknown), so a
 *  verification failure never reads as "not on develop" (硬规则 3b). */
export function isOnBranch(root: string, sha: string, branch: string): boolean | null {
  const r = spawnSync("git", ["-C", root, "merge-base", "--is-ancestor", sha, branch], { encoding: "utf8" });
  if (r.error || r.status === null) return null;
  if (r.status === 0) return true;
  if (r.status === 1) return false; // a real "no" — the only exit code that means "not an ancestor"
  return null;                      // 128 etc. = the question could not be asked (bad sha / no branch)
}

// ── the SHARED CHECKOUT: a report about REAL carriers must name the same checkout the writers use ──

/** Resolve the host's shared checkout. Read from git (`--git-common-dir`), never guessed from the
 *  caller's cwd: run from a task worktree, `.quay/` in the worktree is NOT where the loops write. */
export function sharedCheckoutOf(root: string): { ok: boolean; root: string | null; reason: string | null } {
  const r = spawnSync("git", ["-C", root, "rev-parse", "--git-common-dir"], { encoding: "utf8" });
  if (r.error) return { ok: false, root: null, reason: `git-unrunnable:${r.error.code ?? r.error.message}` };
  if (r.status !== 0) return { ok: false, root: null, reason: `git-rev-parse-exited-${r.status}` };
  let common = String(r.stdout ?? "").trim();
  if (common === "") return { ok: false, root: null, reason: "empty-git-common-dir" };
  if (!path.isAbsolute(common)) common = path.join(root, common);
  const shared = path.dirname(common);
  if (!fs.existsSync(shared)) return { ok: false, root: null, reason: `${shared}-does-not-exist` };
  return { ok: true, root: shared, reason: null };
}

// ── the engine modules (runtime import, reused loader) ────────────────────────────────────────────

/** The narrow slice of `docs/analysis/discovery-experience-ledger.mjs` this report consumes. */
export interface LedgerModule {
  conceptKeyOfCluster: (rec: unknown) => string | null;
  /** The ledger's OWN component normalization (line suffixes stripped, deduped, sorted). Consumed here
   *  so the report can ask "does this record carry a SUBJECT at all?" with the same normalization the
   *  key is built from — a second normalizer would be a second answer to that question. */
  normalizeConceptComponents: (components: unknown) => string[];
}
/** The narrow slice of `docs/analysis/discovery-portfolio.mjs` this report consumes. */
export interface PortfolioModule {
  readPortfolio: (root: string, opts?: Record<string, unknown>) => {
    ok: boolean;
    records: Record<string, unknown>[];
    ratings: Record<string, unknown>[];
    assignments: Record<string, unknown>[];
    corrections: Record<string, unknown>[];
    orphan_corrections: string[];
    file: string | null;
    malformed_lines: number;
    reason?: string;
  };
  deriveFixLandedCommit: (root: string, fixTask: unknown, opts?: Record<string, unknown>) => {
    ok: boolean;
    commit?: string | null;
    committed_at?: number | null;
    subject?: string | null;
    reason: string;
  };
  deriveRecurred: (root: string, opts?: { components?: unknown; since?: unknown }) => {
    recurred: boolean | null;
    reason: string;
    evidence_outcome_ids: string[];
  };
  ORIGINS: readonly string[];
  AUTONOMOUS_ORIGINS: readonly string[];
}

export interface EngineModules {
  ok: boolean;
  reason: string | null;
  ledger: LedgerModule | null;
  portfolio: PortfolioModule | null;
}

/**
 * Load the two engine modules the report needs, at RUNTIME, through the OSD routine's own resolver.
 * ⛔ A failure is NOT fatal for the report: the carrier counts and the round classes need no engine
 * module, so an unresolvable engine degrades the module-dependent LINKS to
 * `not-evaluated:OPEN_DISCOVERY_MODULES_UNRESOLVED:<detail>` while the rest of the report still prints.
 * That is the honest shape — "the engine could not be read" must not turn into either a crash (no
 * report at all) or a blank link (indistinguishable from a clean one).
 */
export async function loadEngineModules(): Promise<EngineModules> {
  const load = async (file: string): Promise<Record<string, unknown> | null> => {
    const r = resolveEngineModule(SCRIPT_REPO_ROOT, file);
    if (r.path === null) return null;
    try {
      return (await import(/* @vite-ignore */ pathToFileURLHref(r.path))) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  const ledger = await load("discovery-experience-ledger.mjs");
  const portfolio = await load("discovery-portfolio.mjs");
  const missing: string[] = [];
  if (ledger === null || !isFn(ledger.conceptKeyOfCluster) || !isFn(ledger.normalizeConceptComponents)) missing.push("discovery-experience-ledger.mjs");
  if (portfolio === null || !isFn(portfolio.readPortfolio) || !isFn(portfolio.deriveFixLandedCommit)) {
    missing.push("discovery-portfolio.mjs");
  }
  if (missing.length > 0) {
    return { ok: false, reason: `OPEN_DISCOVERY_MODULES_UNRESOLVED:${missing.join("+")}`, ledger: null, portfolio: null };
  }
  return {
    ok: true,
    reason: null,
    ledger: ledger as unknown as LedgerModule,
    portfolio: portfolio as unknown as PortfolioModule,
  };
}

const isFn = (x: unknown): boolean => typeof x === "function";
/** Built without the `url` import so the module's own import list stays as short as it reads. */
const pathToFileURLHref = (p: string): string => new URL(`file://${p}`).href;

// ── ROUND CLASSIFICATION ──────────────────────────────────────────────────────────────────────────

export interface RoundRow {
  /** The resident round's own timestamp, as the round carrier recorded it. */
  ts: string | null;
  round: unknown;
  run_id: unknown;
  cls: string;
  /** The Fact's own reason string, verbatim — the citation for the class. */
  reason: string;
  detail: Record<string, unknown> | null;
}

/**
 * Classify ONE routine Fact out of a resident round record. PURE.
 *
 * The order of the tests IS the precedence rule, and each test is written against the shape the
 * routine that writes it actually emits (both the current prose form and the older `not-evaluated:<x>`
 * form, which coexisted in production carriers — a classifier that knew only one of them would report
 * a whole host's rounds as `unclassified`).
 *
 * @param fact the `{name, value, state, reason}` Fact from a `quality-round` record
 * @param record the containing record (for `stopped_mid_round` / `skipped_routines`)
 * @param routine the routine name this Fact is about
 */
export function classifyRoundFact(
  fact: Record<string, unknown>,
  record: Record<string, unknown>,
  routine: string,
): { cls: string; reason: string; detail: Record<string, unknown> | null } {
  const reason = isStr(fact.reason, 1) ? String(fact.reason) : "";
  const state = isStr(fact.state, 1) ? String(fact.state) : "";
  const value = isObj(fact.value) ? fact.value : {};

  // ① the ROUND-LEVEL interruption readings win over the Fact's own words: a round the caller recorded
  //    as interrupted did not finish, whatever the last Fact it managed to emit says.
  if (record.stopped_mid_round === true || isObj(record.stopped_mid_round)) {
    return { cls: "stopped-mid-round", reason, detail: isObj(record.stopped_mid_round) ? record.stopped_mid_round : null };
  }
  if (Array.isArray(record.skipped_routines) && record.skipped_routines.includes(routine)) {
    return { cls: "stopped-mid-round", reason, detail: { skipped_routines: record.skipped_routines } };
  }
  // …and the routine's OWN half-round token, which the driver and the routine share (driver-runtime's
  // `STOPPED_MID_ROUND`) — reused rather than re-spelled.
  if (reason.includes(STOPPED_MID_ROUND)) return { cls: "stopped-mid-round", reason, detail: null };

  // ② engine failure: the round could not even load the modules it drives.
  if (/engine modules unresolved/i.test(reason)) return { cls: "engine-failure", reason, detail: null };

  // ③ disabled: the kill switch. Recognises BOTH spellings in the carriers
  //    (`disabled: …` from OSD, `not-evaluated:disabled — …` from the other routines) and the
  //    `enabled:false` value, so a host that has switched the track off is not read as "not due".
  if (/^disabled\b/.test(reason) || /^not-evaluated:disabled\b/.test(reason) || value.enabled === false) {
    return { cls: "disabled", reason, detail: null };
  }

  // ④ budget refusals, separated by WHICH ceiling refused — the two are different facts about the host
  //    (a calls ceiling says the rate is the binding constraint; a usd ceiling says the price is).
  if (/^budget-24h\b/.test(reason) || reason.startsWith("not-evaluated:budget-24h")) {
    return { cls: "budget-blocked(calls)", reason, detail: null };
  }
  if (/^budget-usd-24h\b/.test(reason) || reason.startsWith("not-evaluated:budget-usd-24h")) {
    return { cls: "budget-blocked(usd)", reason, detail: null };
  }

  // ⑤ not due: the schedule said no. Both spells again.
  if (/^not due\b/.test(reason) || reason.startsWith("not-evaluated:not-due")) {
    return { cls: "not-due", reason, detail: null };
  }

  // ⑥ the round RAN. `scan-round` is the value the routine emits for a round it actually executed; the
  //    cluster count splits it into the two classes the Proposal names. ⛔ `state` is NOT consulted as
  //    the primary signal here: the value's own `kind` is what the routine writes when it ran, and a
  //    round whose Fact is a scan-round with clusters is not the same reading as one without.
  if (value.kind === "scan-round") {
    const clusters = isObj(value.clusters) ? value.clusters : {};
    const total = typeof clusters.total === "number" ? clusters.total : null;
    if (total === null) {
      return { cls: `${UNCLASSIFIED_PREFIX}scan-round-without-cluster-count)`, reason, detail: null };
    }
    return { cls: total > 0 ? "ran-with-clusters" : "ran-empty", reason, detail: { clusters_total: total } };
  }

  // ⑦ a named call failure: `not-evaluated:<class>: …`. The class is the token between the colons —
  //    taken from the reason, so a NEW failure class appears in the table as itself.
  const m = /^not-evaluated:([A-Za-z0-9._-]+)\b/.exec(reason);
  if (m) return { cls: `call-failure(${m[1]})`, reason, detail: null };

  // ⑧ nothing above matched. Report the shape itself rather than filing it under a name that would be a
  //    claim about it (硬规则 3b).
  const head = reason === "" ? state || "<no-reason>" : reason.slice(0, 48);
  return { cls: `${UNCLASSIFIED_PREFIX}${head})`, reason, detail: null };
}

/**
 * Walk the round carrier and classify every Fact about `routine`, inside the observation window.
 *
 * ⛔ One resident ROUND may emit more than one Fact for the same routine across the driver's life (a
 * restart re-evaluates); this report does NOT deduplicate them. Each Fact is a separate OBSERVATION by
 * the driver, and collapsing two observations into one would be inventing a round identity the carrier
 * does not carry (the `round` counter resets on restart, so it cannot serve as one).
 */
export function classifyRounds(
  carrier: CarrierRead,
  routine: string,
  since: string | null,
): { rows: RoundRow[]; classes: Record<string, number>; records_examined: number; not_evaluated: string | null } {
  const rows: RoundRow[] = [];
  const classes: Record<string, number> = {};
  let examined = 0;
  if (!carrier.present) {
    return { rows, classes, records_examined: 0, not_evaluated: notEvaluated(`round-carrier-absent:${carrier.rel}`) };
  }
  if (carrier.malformed_lines > 0) {
    // A partially-parseable round carrier means the class table is over a TRUNCATED population. Say so
    // rather than printing counts that silently omit the unreadable rounds.
    return {
      rows,
      classes,
      records_examined: 0,
      not_evaluated: notEvaluated(`round-carrier-partial:${carrier.malformed_lines}-unparseable-line(s)`),
    };
  }
  for (const { rec } of carrier.records) {
    const ts = isStr(rec.ts, 1) ? String(rec.ts) : null;
    if (since !== null) {
      if (ts === null) continue;
      if (Date.parse(ts) < Date.parse(since)) continue;
    }
    const facts = Array.isArray(rec.facts) ? rec.facts : [];
    const matching = facts.filter((f) => isObj(f) && f.name === routine);
    if (matching.length === 0) continue;
    examined += 1;
    for (const f of matching) {
      const c = classifyRoundFact(f, rec, routine);
      classes[c.cls] = (classes[c.cls] ?? 0) + 1;
      rows.push({ ts, round: rec.round ?? null, run_id: rec.run_id ?? null, cls: c.cls, reason: c.reason, detail: c.detail });
    }
  }
  return { rows, classes, records_examined: examined, not_evaluated: null };
}

// ── THE CHAIN ─────────────────────────────────────────────────────────────────────────────────────

export interface HostFinding {
  finding_id: string;
  carrier: { rel: string; line: number; kind: string; id: string | null };
  concept_key: string | null;
  concept_key_reason: string | null;
  /** WHERE the key came from — a row's own field, a derivation from the origin record, or a derivation
   *  from the row itself. The three are different readings of "this is the same concept", so they are
   *  not collapsed into one (硬规则 3b). */
  concept_key_from: string | null;
  origin: string | null;
  origin_class: "autonomous" | "known-non-autonomous" | "unknown";
  origin_ref: string | null;
  origin_carrier: string | null;
  verifier: unknown;
  refuter: unknown;
  /** WHERE each verdict was read from — the "real ids at every link" half of AC3. `null` when the link
   *  could not be resolved to a record at all. */
  verifier_source: { rel: string; line: number } | null;
  refuter_source: { rel: string; line: number } | null;
  confirmed: boolean | null;
  outcome: unknown;
  task_id: unknown;
  task_status: unknown;
  merge_commit: unknown;
  effect: unknown;
  chain: { complete: boolean; closed: boolean; furthest_link: string; missing: string[] };
}

/** Which origin vocabulary member a raw value is, with `unknown` as its OWN value (AC4). An absent or
 *  out-of-vocabulary origin is `unknown` — never folded into the autonomous share's numerator, and
 *  never folded into a "non-autonomous" bucket either (it is not known to be either). */
export function originClassOf(raw: unknown, origins: readonly string[], autonomous: readonly string[]): HostFinding["origin_class"] {
  if (!isStr(raw, 1)) return "unknown";
  const v = String(raw);
  if (!origins.includes(v)) return "unknown";
  return autonomous.includes(v) ? "autonomous" : "known-non-autonomous";
}

/** Resolve the CARRIER RECORD a Portfolio row points at — the row's `origin_carrier` + `origin_ref`.
 *  ⛔ ONE resolution rule, shared by the verdicts AND the concept key (硬规则 5b): the record a verdict
 *  is read from and the record a subject is derived from must be the same record, or a row could be
 *  judged by one cluster and keyed by another. */
function resolveOriginRecord(
  host: { carriers: Map<string, CarrierRead> },
  row: Record<string, unknown>,
):
  | { ok: true; rec: Record<string, unknown>; line: number; rel: string; kind: string }
  | { ok: false; reason: string; rel: string | null; kind: string | null } {
  const originCarrier = isStr(row.origin_carrier, 1) ? String(row.origin_carrier) : null;
  const ref = isStr(row.origin_ref, 1) ? String(row.origin_ref) : isStr(row.finding_id, 1) ? String(row.finding_id) : null;
  if (originCarrier === null) return { ok: false, reason: "no-origin_carrier-on-the-finding-row", rel: null, kind: null };
  const reader = VERDICT_READERS[originCarrier];
  if (reader === undefined) {
    return { ok: false, reason: `no-verdict-reader-for-origin_carrier:${originCarrier}`, rel: null, kind: null };
  }
  const carrier = host.carriers.get(reader.rel);
  if (carrier === undefined || !carrier.present) {
    return { ok: false, reason: `origin-carrier-absent:${reader.rel}`, rel: reader.rel, kind: reader.kind };
  }
  const hit = findOriginRecord(carrier, reader.rel, reader.kind, originCarrier, ref);
  if (hit === null) return { ok: false, reason: `no-${reader.kind}-record-for:${String(ref)}`, rel: reader.rel, kind: reader.kind };
  return { ok: true, rec: hit.rec, line: hit.line, rel: reader.rel, kind: reader.kind };
}

/** Read the verifier/refuter verdicts out of the carrier the finding's `origin_carrier` names. */
function verdictsFor(
  host: { carriers: Map<string, CarrierRead> },
  row: Record<string, unknown>,
): { verifier: unknown; refuter: unknown; confirmed: boolean | null; source: { rel: string; line: number } | null } {
  const resolved = resolveOriginRecord(host, row);
  if (!resolved.ok) {
    return { verifier: notEvaluated(resolved.reason), refuter: notEvaluated(resolved.reason), confirmed: null, source: null };
  }
  const rec = resolved.rec;
  const source = { rel: resolved.rel, line: resolved.line };
  if (CLUSTER_SHAPED_CARRIERS.includes(resolved.rel)) {
    return {
      verifier: isStr(rec.verifier_verdict, 1) ? String(rec.verifier_verdict) : notEvaluated("no-verifier_verdict-on-the-cluster-record"),
      refuter: isStr(rec.refutation_verdict, 1) ? String(rec.refutation_verdict) : notEvaluated("no-refutation_verdict-on-the-cluster-record"),
      confirmed: typeof rec.confirmed === "boolean" ? rec.confirmed : null,
      source,
    };
  }
  if (resolved.rel === ARCH_FINDINGS_REL) {
    return {
      verifier: isStr(rec.verdict, 1) ? String(rec.verdict) : notEvaluated("no-verdict-on-the-arch-finding-record"),
      refuter: notEvaluated("arch-discovery-has-no-refuter-stage"),
      confirmed: null,
      source,
    };
  }
  // routine-findings: the scan's own mechanical verdict; there is no independent refutation stage here.
  return {
    verifier: isStr(rec.verdict, 1) ? String(rec.verdict) : notEvaluated("no-verdict-on-the-routine-finding-record"),
    refuter: notEvaluated("routine-scan-has-no-refuter-stage"),
    confirmed: null,
    source,
  };
}

/** Find the origin record a Portfolio row points at, per carrier convention. */
function findOriginRecord(
  carrier: CarrierRead,
  rel: string,
  kind: string,
  originCarrier: string,
  ref: string | null,
): { rec: Record<string, unknown>; line: number } | null {
  if (ref === null) return null;
  if (CLUSTER_SHAPED_CARRIERS.includes(rel)) {
    return carrier.records.find(({ rec }) => rec.kind === kind && rec.record_id === ref) ?? null;
  }
  if (rel === ARCH_FINDINGS_REL) {
    return carrier.records.find(({ rec }) => rec.kind === kind && rec.finding_fp === ref) ?? null;
  }
  // routine-findings: the origin_ref convention is `<runId>#<findingId>`.
  const at = ref.lastIndexOf("#");
  if (at <= 0) return null;
  const runId = ref.slice(0, at);
  const findingId = ref.slice(at + 1);
  void originCarrier;
  return carrier.records.find(({ rec }) => rec.kind === kind && rec.runId === runId && rec.findingId === findingId) ?? null;
}

/**
 * THE POST-MERGE EFFECT READING (Plan item 3). It is taken AFTER the merge commit's own time — never
 * before it, and never from the fix task's own AC.
 *
 * Two independent readings, both from real carriers:
 *   (a) the OSD carrier: does the SAME concept key occur again, strictly after the landing?
 *   (b) the evidence store, through the portfolio module's own `deriveRecurred` (the SAME derivation
 *       the Portfolio row's `recurred` field is built from, reused rather than re-implemented).
 *
 * A reading that could not be taken is `not-evaluated:<reason>` — and if NO reading could be taken the
 * whole link is `not-evaluated`, because "we could not look" must not read as "it did not recur"
 * (硬规则 3b; this is precisely the value AC5's negative control turns on).
 */
function effectReading(
  host: { root: string | null; carriers: Map<string, CarrierRead>; modules: EngineModules; conceptKeyOf: (rec: unknown) => string | null },
  row: Record<string, unknown>,
  merge: { sha: string; committed_at_iso: string } | null,
  conceptKey: string | null,
): unknown {
  if (merge === null) return notEvaluated("no-merge-commit-to-read-the-effect-after");
  const since = merge.committed_at_iso;

  // (a) later occurrences of the same concept, by concept key.
  const osd = host.carriers.get(OSD_FINDINGS_REL);
  let conceptReading: Record<string, unknown> | null = null;
  if (!host.modules.ok) {
    conceptReading = { source: "open-semantic-discovery-carrier", evaluated: false, reason: notEvaluated(String(host.modules.reason)) };
  } else if (osd === undefined || !osd.present) {
    conceptReading = { source: "open-semantic-discovery-carrier", evaluated: false, reason: notEvaluated(`carrier-absent:${OSD_FINDINGS_REL}`) };
  } else {
    // ⛔ THE FINDING'S OWN RESOLVED KEY, not a second derivation: the row's `concept_key` field when it
    //    carries one (the stable identity the ingest writes), else the shared derivation. Re-deriving it
    //    here would let the key the row is identified by and the key its recurrence is judged by differ.
    const key = conceptKey;
    if (key === null) {
      conceptReading = { source: "open-semantic-discovery-carrier", evaluated: false, reason: notEvaluated("the-finding-has-no-concept-key-to-recur") };
    } else {
      const sinceMs = Date.parse(since);
      const later = osd.records
        .filter(({ rec }) => rec.kind === "cluster" && isStr(rec.ts, 1) && Date.parse(String(rec.ts)) > sinceMs)
        .filter(({ rec }) => host.conceptKeyOf(rec) === key)
        .map(({ rec, line }) => ({ record_id: rec.record_id ?? null, ts: rec.ts ?? null, line }));
      conceptReading = {
        source: "open-semantic-discovery-carrier",
        evaluated: true,
        concept_key: key,
        since,
        recurred: later.length > 0,
        later_occurrences: later,
        reason: later.length > 0 ? "SAME_CONCEPT_KEY_AFTER_THE_MERGE" : "NO_LATER_OCCURRENCE_OF_THIS_CONCEPT_KEY",
      };
    }
  }

  // (b) the evidence store, via the portfolio module's own recurrence derivation.
  let storeReading: Record<string, unknown>;
  if (!host.modules.ok || host.modules.portfolio === null) {
    storeReading = { source: "architecture-evidence-store", evaluated: false, reason: notEvaluated(String(host.modules.reason)) };
  } else if (host.root === null) {
    storeReading = { source: "architecture-evidence-store", evaluated: false, reason: notEvaluated("no-shared-checkout-could-be-named") };
  } else {
    const d = host.modules.portfolio.deriveRecurred(host.root, { components: row.components, since });
    storeReading = {
      source: "architecture-evidence-store",
      evaluated: d.recurred !== null,
      recurred: d.recurred,
      evidence_outcome_ids: d.evidence_outcome_ids,
      reason: d.recurred === null ? notEvaluated(`deriveRecurred:${d.reason}`) : d.reason,
    };
  }

  const readings = [conceptReading, storeReading];
  const recurredHits = readings.filter((r) => r !== null && r.evaluated === true && r.recurred === true);
  const evaluated = readings.filter((r) => r !== null && r.evaluated === true);
  if (recurredHits.length > 0) {
    return { kind: "recurred-after-fix", since, readings, reason: "AT_LEAST_ONE_READING_FOUND_THE_CONCEPT_AGAIN_AFTER_THE_MERGE" };
  }
  if (evaluated.length === readings.length) {
    return { kind: "no-recurrence-after-fix", since, readings, reason: "EVERY_READING_WAS_TAKEN_AND_NONE_FOUND_A_RECURRENCE" };
  }
  return { kind: null, reason: notEvaluated(`effect-not-evaluated:${readings.filter((r) => r !== null && r.evaluated !== true).map((r) => String(r!.reason)).join("+")}`), since, readings };
}

/** The task file's own frontmatter status, read from the shared checkout. */
function taskStatusOf(root: string | null, taskId: string): unknown {
  if (root === null) return notEvaluated("no-shared-checkout-could-be-named");
  const file = path.join(root, "tasks", `${taskId}.md`);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return notEvaluated(code === "ENOENT" ? `no-task-file:tasks/${taskId}.md` : `task-file-unreadable:${code ?? String(e)}`);
  }
  const m = /^status:\s*(.+)$/m.exec(text);
  return m ? m[1]!.trim() : notEvaluated("task-file-carries-no-status-line");
}

/** Build one finding's chain. */
function buildFinding(
  host: {
    root: string | null;
    branch: string;
    carriers: Map<string, CarrierRead>;
    modules: EngineModules;
    conceptKeyOf: (rec: unknown) => string | null;
  },
  row: Record<string, unknown>,
  line: number,
): HostFinding {
  const findingId = isStr(row.finding_id, 1) ? String(row.finding_id) : `(line-${line})`;
  const origin = isStr(row.origin, 1) ? String(row.origin) : null;
  const origins = host.modules.portfolio?.ORIGINS ?? [];
  const autonomous = host.modules.portfolio?.AUTONOMOUS_ORIGINS ?? [];

  // ── the concept key: the row's own field, else DERIVED from the record the row points at, else from
  //    the row itself. Three steps, in that order, and the order matters:
  //      · a row that carries `concept_key` states its own identity — nothing to derive;
  //      · a HISTORICAL row predates the field, and the subject it must be keyed by (`concept_kind` +
  //        `components`) lives on the CARRIER RECORD it names. Deriving from the row alone would fall
  //        back to the default concern-kind and produce a key that can never match the carrier's own —
  //        i.e. a recurrence reading that is structurally blind. So the origin record is tried FIRST;
  //      · only when no origin record resolves is the row keyed by itself.
  //    ⛔ All three go through the SAME shared `conceptKeyOfCluster` — this is a choice of INPUT, never
  //    a second derivation.
  let conceptKey: string | null = isStr(row.concept_key, 1) ? String(row.concept_key) : null;
  let conceptKeyReason: string | null = null;
  let conceptKeyFrom = conceptKey === null ? null : "the-row's-own-concept_key-field";
  if (conceptKey === null) {
    if (!host.modules.ok) {
      conceptKeyReason = String(host.modules.reason);
    } else {
      // ⛔ A record must carry a SUBJECT before it can be keyed. `conceptKeyOfCluster` falls back to the
      //    default concern-kind and happily returns `<kind>|` for a record with no `components` at all —
      //    a non-null key over an EMPTY subject, which would then match every other subject-less finding
      //    as "the same concept". MEASURED (this task's own run): the routine-findings carrier keys its
      //    findings by `files`, not `components`, so deriving from those origin records produced
      //    `open-semantic-discovery|` for F01–F03. The emptiness is checked with the ledger's OWN
      //    normalization, so "has a subject" is the same question the key is built from.
      const subjectOf = (rec: Record<string, unknown>): string | null => {
        if (host.modules.ledger === null) return null;
        const comps = host.modules.ledger.normalizeConceptComponents(rec.components);
        return comps.length === 0 ? null : host.conceptKeyOf(rec);
      };
      const origin = resolveOriginRecord(host, row);
      if (origin.ok) {
        conceptKey = subjectOf(origin.rec);
        if (conceptKey !== null) conceptKeyFrom = `derived-from-origin-record:${origin.rel}:${origin.line}`;
      }
      if (conceptKey === null) {
        conceptKey = subjectOf(row);
        if (conceptKey !== null) conceptKeyFrom = "derived-from-the-portfolio-row-itself (no origin record resolved)";
      }
      if (conceptKey === null) conceptKeyReason = "neither-the-row-nor-its-origin-record-carries-a-non-empty-subject-to-derive-a-key-from";
    }
  }
  const v = verdictsFor(host, row);

  // task id
  const taskId: unknown = isStr(row.fix_task, 1) ? String(row.fix_task) : notEvaluated("no-fix-task-on-the-row");

  // merge commit: the row's own landing reading, re-derived when it carries a task but no commit.
  let merge: unknown;
  let mergeFor: { sha: string; committed_at_iso: string } | null = null;
  if (isStr(row.fix_landed_commit, 1) && typeof row.fix_landed_commit === "string") {
    const sha = String(row.fix_landed_commit);
    const committedAt = commitTimeIso(host.root, sha);
    const onBranch = host.root === null ? null : isOnBranch(host.root, sha, host.branch);
    merge = {
      sha,
      committed_at: committedAt,
      on_branch: onBranch,
      branch: host.branch,
      reason: isStr(row.fix_landed_reason, 1) ? String(row.fix_landed_reason) : null,
    };
    if (committedAt !== null && onBranch !== false) mergeFor = { sha, committed_at_iso: committedAt };
  } else if (host.modules.ok && host.modules.portfolio !== null && host.root !== null && isStr(row.fix_task, 1)) {
    const d = host.modules.portfolio.deriveFixLandedCommit(host.root, row.fix_task, { branch: host.branch });
    if (d.ok && isStr(d.commit, 1)) {
      const sha = String(d.commit);
      const committedAt = d.committed_at === null || d.committed_at === undefined ? null : new Date(Number(d.committed_at) * 1000).toISOString();
      merge = { sha, committed_at: committedAt, on_branch: isOnBranch(host.root, sha, host.branch), branch: host.branch, reason: d.reason };
      if (committedAt !== null) mergeFor = { sha, committed_at_iso: committedAt };
    } else {
      merge = notEvaluated(`deriveFixLandedCommit:${d.reason}`);
    }
  } else {
    merge = notEvaluated(isStr(row.fix_landed_reason, 1) ? String(row.fix_landed_reason) : `no-fix_landed_commit-and-${host.modules.ok ? "no-fix_task" : String(host.modules.reason)}`);
  }

  const effect = effectReading(host, row, mergeFor, conceptKey);

  const links: Record<LinkName, unknown> = {
    carrier: { rel: PORTFOLIO_REL, line, kind: isStr(row.kind, 1) ? String(row.kind) : null, id: isStr(row.id, 1) ? String(row.id) : null },
    verifier: v.verifier,
    refuter: v.refuter,
    task: taskId,
    merge,
    effect,
  };
  let furthest = 0;
  const missing: string[] = [];
  for (let i = 0; i < LINK_ORDER.length; i++) {
    const name = LINK_ORDER[i]!;
    const val = links[name];
    const ok = name === "carrier" ? true : !isNotEvaluated(val);
    if (ok && missing.length === 0) furthest = i;
    if (!ok) missing.push(name);
  }
  const effectKind = isObj(effect) ? effect.kind : null;
  return {
    finding_id: findingId,
    carrier: links.carrier as HostFinding["carrier"],
    concept_key: conceptKey,
    concept_key_reason: conceptKeyReason,
    concept_key_from: conceptKeyFrom,
    origin,
    origin_class: originClassOf(origin, origins, autonomous),
    origin_ref: isStr(row.origin_ref, 1) ? String(row.origin_ref) : null,
    origin_carrier: isStr(row.origin_carrier, 1) ? String(row.origin_carrier) : null,
    verifier: v.verifier,
    refuter: v.refuter,
    verifier_source: v.source,
    refuter_source: v.source,
    confirmed: v.confirmed,
    outcome: isStr(row.outcome, 1) ? String(row.outcome) : notEvaluated("no-outcome-recorded-on-the-row"),
    task_id: taskId,
    task_status: isStr(row.fix_task, 1) ? taskStatusOf(host.root, String(row.fix_task)) : notEvaluated("no-fix-task-on-the-row"),
    merge_commit: merge,
    effect,
    chain: {
      complete: missing.length === 0,
      closed: missing.length === 0 && effectKind === "no-recurrence-after-fix",
      furthest_link: LINK_ORDER[furthest]!,
      missing,
    },
  };
}

/** The commit's own committer time, as ISO — ⛔ the AUTHORITATIVE "after the merge" cutoff, never the
 *  wall clock at report time (a report run twice must give the same readings). */
function commitTimeIso(root: string | null, sha: string): string | null {
  if (root === null) return null;
  const r = spawnSync("git", ["-C", root, "show", "-s", "--format=%ct", sha], { encoding: "utf8" });
  if (r.error || r.status !== 0) return null;
  const t = Number(String(r.stdout ?? "").trim());
  return Number.isFinite(t) ? new Date(t * 1000).toISOString() : null;
}

// ── PER-HOST REPORT ───────────────────────────────────────────────────────────────────────────────

export interface HostReport {
  name: string;
  root: string;
  shared_checkout: string | null;
  shared_checkout_reason: string | null;
  engine: { ok: boolean; reason: string | null };
  carriers: { rel: string; file: string | null; present: boolean; lines: number; malformed_lines: number; reason: string | null; kinds: Record<string, number> }[];
  portfolio: Record<string, unknown>;
  origins: Record<string, unknown>;
  findings: HostFinding[];
  rounds: { routine: string; classes: Record<string, number>; class_table: { cls: string; count: number }[]; rows: RoundRow[]; records_examined: number; not_evaluated: string | null };
}

export async function reportHost(name: string, rootArg: string, routine: string, since: string | null): Promise<HostReport> {
  const shared = sharedCheckoutOf(rootArg);
  const root = shared.ok ? shared.root : null;
  const modules = await loadEngineModules();
  const carriers = new Map<string, CarrierRead>();
  for (const rel of [PORTFOLIO_REL, OSD_FINDINGS_REL, ARCH_FINDINGS_REL, ROUTINE_FINDINGS_REL, DOGFOOD_FINDINGS_REL, QUALITY_ROUND_REL]) {
    carriers.set(rel, readCarrier(root, rel));
  }
  const conceptKeyOf = (rec: unknown): string | null =>
    modules.ok && modules.ledger !== null ? modules.ledger.conceptKeyOfCluster(rec) : null;

  // ── the finding carrier: raw LINES, and the finding-only population ─────────────────────────────
  //
  // ⛔ TWO POPULATIONS, BOTH REPORTED, because the baseline's "39 findings" is the LINE count and the
  //    finding count is smaller. The Portfolio is not a list of findings: it is an append-only file
  //    whose lines are findings PLUS the two overlay kinds (domain assignments, corrections). A reader
  //    that filters nothing therefore reads 39 "findings", 18 of which carry no origin and no outcome —
  //    which is EXACTLY the shape the baseline reports. Both readings are printed, and the second is
  //    decomposed by kind, so the difference is a named count rather than a discrepancy.
  const portfolioCarrier = carriers.get(PORTFOLIO_REL)!;
  const findingLines = portfolioCarrier.records.filter(({ rec }) => rec.kind === PORTFOLIO_KIND);
  const correctionLines = portfolioCarrier.records.filter(({ rec }) => rec.kind === PORTFOLIO_CORRECTION_KIND);
  const summaryOf = (recs: { rec: Record<string, unknown> }[]) => ({
    count: recs.length,
    origin: countBy(recs.map(({ rec }) => (isStr(rec.origin, 1) ? String(rec.origin) : "(absent)"))),
    outcome: countBy(recs.map(({ rec }) => (isStr(rec.outcome, 1) ? String(rec.outcome) : "(absent)"))),
    with_fix_task: recs.filter(({ rec }) => isStr(rec.fix_task, 1)).length,
    with_fix_landed_commit: recs.filter(({ rec }) => isStr(rec.fix_landed_commit, 1)).length,
    with_recurred_field: recs.filter(({ rec }) => "recurred" in rec).length,
    with_duplicate_of: recs.filter(({ rec }) => isStr(rec.duplicate_of, 1)).length,
  });
  const linesByKind = countBy(portfolioCarrier.records.map(({ rec }) => (isStr(rec.kind, 1) ? String(rec.kind) : "(absent)")));
  const carrierCounts = {
    /** Every parseable line, whatever its kind — the population the baseline's counts are over. */
    all_lines: summaryOf(portfolioCarrier.records),
    /** Only `kind:"portfolio_finding"` lines — the real population of findings. */
    findings_only: summaryOf(findingLines),
    /** ⛔ The baseline's headline number decomposes as this. Named per kind so "39 findings" can be
     *  traced to the lines it came from rather than argued about. */
    lines_by_kind: linesByKind,
    finding_lines: findingLines.length,
    corrections: correctionLines.length,
    overlay_lines: portfolioCarrier.records.length - findingLines.length,
  };

  // The CHAIN is built over the FOLDED rows: an append-only correction is how a later check overturns a
  // field, and the chain must see the corrected value (the raw population above keeps the unfolded
  // counts, which is what the baseline measured).
  let rows: Record<string, unknown>[] = findingLines.map(({ rec }) => rec);
  let foldedNote: string | null = null;
  if (!portfolioCarrier.present) {
    rows = [];
    foldedNote = notEvaluated(`portfolio-carrier-absent:${PORTFOLIO_REL}`);
  } else if (!modules.ok || modules.portfolio === null) {
    foldedNote = notEvaluated(`corrections-not-folded:${String(modules.reason)}`);
  } else if (root === null) {
    foldedNote = notEvaluated("no-shared-checkout-could-be-named");
  } else {
    const folded = modules.portfolio.readPortfolio(root, { branch: DEFAULT_BRANCH });
    if (folded.file === null) {
      rows = [];
      foldedNote = notEvaluated(`readPortfolio:${folded.reason ?? "no-file"}`);
    } else {
      rows = folded.records;
    }
  }

  const hostCtx = { root, branch: DEFAULT_BRANCH, carriers, modules, conceptKeyOf };
  const findings = rows.map((rec, i) => buildFinding(hostCtx, rec, carrierLineOf(portfolioCarrier, rec, i)));

  // ── origins (AC4) ─────────────────────────────────────────────────────────────────────────────
  const originCounts: Record<string, number> = {};
  const origins = modules.portfolio?.ORIGINS ?? [];
  const autonomous = modules.portfolio?.AUTONOMOUS_ORIGINS ?? [];
  for (const o of origins) originCounts[o] = 0;
  originCounts.unknown = 0;
  for (const f of findings) {
    if (f.origin_class === "unknown") originCounts.unknown = (originCounts.unknown ?? 0) + 1;
    else originCounts[f.origin!] = (originCounts[f.origin!] ?? 0) + 1;
  }
  const knownTotal = findings.length - (originCounts.unknown ?? 0);
  const autonomousTotal = findings.filter((f) => f.origin_class === "autonomous").length;
  // …and the SAME enumeration over the baseline's line population, so the two readings of "how many
  // findings have no origin" sit side by side instead of one silently replacing the other.
  const lineOriginCounts: Record<string, number> = {};
  for (const o of origins) lineOriginCounts[o] = 0;
  lineOriginCounts.unknown = 0;
  for (const { rec } of portfolioCarrier.records) {
    const v = isStr(rec.origin, 1) ? String(rec.origin) : null;
    const cls = originClassOf(v, origins, autonomous);
    if (cls === "unknown") lineOriginCounts.unknown = (lineOriginCounts.unknown ?? 0) + 1;
    else lineOriginCounts[v!] = (lineOriginCounts[v!] ?? 0) + 1;
  }
  const originsBlock = {
    counts: originCounts,
    unknown: originCounts.unknown ?? 0,
    known_total: knownTotal,
    autonomous: autonomousTotal,
    autonomous_share: knownTotal > 0 ? Number((autonomousTotal / knownTotal).toFixed(6)) : null,
    autonomous_share_note:
      "autonomous / findings-with-a-KNOWN-origin. The unknown count is deliberately NOT in the denominator: an unrecorded origin is not evidence of autonomy (the Proposal's explicit rule).",
    over_carrier_lines: {
      counts: lineOriginCounts,
      unknown: lineOriginCounts.unknown ?? 0,
      known_total: portfolioCarrier.records.length - (lineOriginCounts.unknown ?? 0),
      autonomous: Object.entries(lineOriginCounts)
        .filter(([k]) => autonomous.includes(k))
        .reduce((a, [, n]) => a + n, 0),
      note: "the same enumeration over ALL parseable Portfolio lines (the baseline's population). Its unknown count is the baseline's `origin: None 18`; its autonomous numerator/denominator are unchanged, because every one of those extra lines is `unknown`.",
    },
    vocabulary: origins,
    autonomous_vocabulary: autonomous,
    source: "the portfolio module's own ORIGINS / AUTONOMOUS_ORIGINS — reused, not re-spelled",
  };

  // ── rounds ────────────────────────────────────────────────────────────────────────────────────
  const roundCarrier = carriers.get(QUALITY_ROUND_REL)!;
  const rc = classifyRounds(roundCarrier, routine, since);
  const classTable = [
    ...ROUND_CLASSES.map((c) => ({ cls: c, count: rc.classes[c] ?? 0 })),
    ...Object.keys(rc.classes)
      .filter((k) => !(ROUND_CLASSES as readonly string[]).includes(k))
      .sort()
      .map((k) => ({ cls: k, count: rc.classes[k]! })),
  ];

  return {
    name,
    root: rootArg,
    shared_checkout: root,
    shared_checkout_reason: shared.reason,
    engine: { ok: modules.ok, reason: modules.reason },
    carriers: [...carriers.values()].map((c) => ({
      rel: c.rel,
      file: c.file,
      present: c.present,
      lines: c.lines,
      malformed_lines: c.malformed_lines,
      reason: c.reason,
      // The record-kind histogram: how many `cluster` / `scan-round` / `finding` / … lines each carrier
      // holds. This is what lets a claim like "212 clusters carry no evidence" be re-read off the report
      // instead of re-grepped.
      kinds: countBy(c.records.map(({ rec }) => (isStr(rec.kind, 1) ? String(rec.kind) : "(absent)"))),
    })),
    portfolio: { ...carrierCounts, read_reason: foldedNote, chain_population: findings.length, chain_population_note: "the chain is built over the CORRECTION-FOLDED rows; `findings` above is the raw line population the baseline measured" },
    origins: originsBlock,
    findings,
    rounds: { routine, classes: rc.classes, class_table: classTable, rows: rc.rows, records_examined: rc.records_examined, not_evaluated: rc.not_evaluated },
  };
}

const DEFAULT_BRANCH = "develop";

function countBy(xs: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) out[x] = (out[x] ?? 0) + 1;
  return out;
}

/** The line of a folded row inside the raw carrier — matched by the record's own id (a correction never
 *  rewrites the line, so the id is stable). Falls back to the row's position.
 *
 *  ⛔ NOT named `lineOf`: that name belongs to `source-text-lib.ts`'s shared position family
 *  (`lineOf(src, idx)` — the line an OFFSET falls on), which this is not — same name, different
 *  argument, different question. `plugin/test/source-text-lib.test.mjs` pins the family to one home
 *  and a private `lineOf` here reads (correctly) as a reappearing copy. */
function carrierLineOf(carrier: CarrierRead, rec: Record<string, unknown>, fallbackIndex: number): number {
  const id = isStr(rec.id, 1) ? String(rec.id) : null;
  if (id !== null) {
    const hit = carrier.records.find(({ rec: r }) => r.id === id);
    if (hit !== undefined) return hit.line;
  }
  return fallbackIndex + 1;
}

// ── rendering ─────────────────────────────────────────────────────────────────────────────────────

export function renderText(report: Record<string, unknown>): string {
  const hosts = (report.hosts as HostReport[]) ?? [];
  const out: string[] = [];
  out.push(`discovery-closed-loop-report  window.since=${String((report.window as Record<string, unknown>)?.since ?? "(none)")}`);
  for (const h of hosts) {
    out.push("");
    out.push(`══ host ${h.name}  root=${h.root}`);
    out.push(`   shared checkout: ${h.shared_checkout ?? `NOT-EVALUATED (${h.shared_checkout_reason})`}`);
    out.push(`   engine modules:  ${h.engine.ok ? "loaded" : `NOT-EVALUATED (${h.engine.reason})`}`);
    out.push(`   carriers:`);
    for (const c of h.carriers) {
      out.push(`     ${c.present ? "present" : "ABSENT "} ${c.rel}  lines=${c.lines} malformed=${c.malformed_lines} kinds=${JSON.stringify(c.kinds)}${c.reason ? `  (${c.reason})` : ""}`);
    }
    const p = h.portfolio as Record<string, unknown>;
    const all = p.all_lines as Record<string, unknown>;
    const only = p.findings_only as Record<string, unknown>;
    out.push(`   portfolio — carrier lines by kind: ${JSON.stringify(p.lines_by_kind)}`);
    out.push(`     ALL LINES (the baseline's population): n=${all.count} fixes=${all.with_fix_task} landed=${all.with_fix_landed_commit} recurred_field=${all.with_recurred_field} duplicate_of=${all.with_duplicate_of}`);
    out.push(`       origin  ${JSON.stringify(all.origin)}`);
    out.push(`       outcome ${JSON.stringify(all.outcome)}`);
    out.push(`     FINDINGS ONLY (kind="${PORTFOLIO_KIND}"): n=${only.count} fixes=${only.with_fix_task} landed=${only.with_fix_landed_commit} recurred_field=${only.with_recurred_field} duplicate_of=${only.with_duplicate_of}`);
    out.push(`       origin  ${JSON.stringify(only.origin)}`);
    out.push(`       outcome ${JSON.stringify(only.outcome)}`);
    if (p.read_reason) out.push(`     folded chain population: ${p.chain_population}  (${String(p.read_reason)})`);
    else out.push(`     folded chain population: ${p.chain_population}`);
    const o = h.origins as Record<string, unknown>;
    const ol = o.over_carrier_lines as Record<string, unknown>;
    out.push(`   origins (over findings): ${JSON.stringify(o.counts)}  unknown=${o.unknown} known=${o.known_total} autonomous=${o.autonomous} share=${o.autonomous_share === null ? "NOT-EVALUATED" : o.autonomous_share}`);
    out.push(`   origins (over all carrier lines): ${JSON.stringify(ol.counts)}  unknown=${ol.unknown} known=${ol.known_total} autonomous=${ol.autonomous}`);
    out.push(`   chain (${h.findings.length} finding(s)):`);
    for (const f of h.findings) {
      const eff = isObj(f.effect) ? f.effect : null;
      out.push(
        `     · ${f.finding_id}  origin=${f.origin ?? "(absent)"}[${f.origin_class}]` +
          `  key=${f.concept_key ?? `NOT-EVALUATED(${f.concept_key_reason})`}`,
      );
      out.push(
        `       verifier=${fmt(f.verifier)}${f.verifier_source ? ` @${f.verifier_source.rel}:${f.verifier_source.line}` : ""}` +
          ` refuter=${fmt(f.refuter)}${f.refuter_source ? ` @${f.refuter_source.rel}:${f.refuter_source.line}` : ""}` +
          ` confirmed=${f.confirmed === null ? "?" : f.confirmed}  outcome=${fmt(f.outcome)} task=${fmt(f.task_id)}${isNotEvaluated(f.task_status) ? "" : ` [${String(f.task_status)}]`}`,
      );
      const m = isObj(f.merge_commit) ? f.merge_commit : null;
      out.push(
        `       merge=${m ? `${String(m.sha).slice(0, 12)} on-${String(m.branch)}=${String(m.on_branch)} @${String(m.committed_at)}` : fmt(f.merge_commit)}`,
      );
      out.push(`       effect=${eff ? `${String(eff.kind)} since=${String(eff.since)}` : fmt(f.effect)}`);
      out.push(`       chain: complete=${f.chain.complete} closed=${f.chain.closed} furthest=${f.chain.furthest_link}${f.chain.missing.length ? ` missing=[${f.chain.missing.join(",")}]` : ""}`);
    }
    const r = h.rounds;
    out.push(`   rounds(routine=${r.routine}, records examined=${r.records_examined})${r.not_evaluated ? `  ${r.not_evaluated}` : ""}:`);
    for (const { cls, count } of r.class_table) out.push(`     ${String(count).padStart(5)}  ${cls}`);
    out.push(`     ${String(r.class_table.reduce((a, b) => a + b.count, 0)).padStart(5)}  TOTAL`);
  }
  return out.join("\n");
}

const fmt = (x: unknown): string => (isNotEvaluated(x) ? String(x) : isObj(x) || Array.isArray(x) ? JSON.stringify(x) : String(x));

// ── main ──────────────────────────────────────────────────────────────────────────────────────────

const USAGE =
  "--host=<name>=<root> [--host=… ] [--routine=<name>] [--since=<iso>] [--json]   (no positional args)";

export function parseHostSpec(spec: string): { name: string; root: string } | { error: string } {
  const at = spec.indexOf("=");
  if (at <= 0) return { error: `--host expects <name>=<root>, got ${JSON.stringify(spec)}` };
  const name = spec.slice(0, at).trim();
  const root = spec.slice(at + 1).trim();
  if (name === "" || root === "") return { error: `--host expects a non-empty <name> and <root>, got ${JSON.stringify(spec)}` };
  return { name, root };
}

export async function main(argv: string[] = process.argv): Promise<number> {
  const args = baseParseArgs(argv, {
    minArgs: 0,
    usage: USAGE,
    strict: true,
    flags: { host: { type: "string[]", greedy: true }, routine: { type: "string[]", greedy: true }, since: { type: "string" }, json: { type: "boolean" } },
  });
  if (args.error) {
    process.stderr.write(`${args.error}\n`);
    return 2;
  }
  if (args.help) {
    process.stdout.write(`usage: discovery-closed-loop-report.ts ${USAGE}\n`);
    return 0;
  }
  const hostSpecs = args.lists?.host ?? [];
  const hostList: { name: string; root: string }[] = [];
  if (hostSpecs.length === 0) {
    hostList.push({ name: path.basename(process.cwd()), root: process.cwd() });
  } else {
    for (const s of hostSpecs) {
      const p = parseHostSpec(s);
      if ("error" in p) {
        process.stderr.write(`${p.error}\n`);
        return 2;
      }
      hostList.push(p);
    }
  }
  for (const h of hostList) {
    if (!fs.existsSync(h.root)) {
      process.stderr.write(`--host ${h.name}: root does not exist: ${h.root}\n`);
      return 2;
    }
  }
  const since = isStr(args.flags.since, 1) ? String(args.flags.since) : null;
  if (since !== null && !Number.isFinite(Date.parse(since))) {
    process.stderr.write(`--since is not a parseable ISO timestamp: ${since}\n`);
    return 2;
  }
  const routines = args.lists?.routine ?? ["open-semantic-discovery"];

  const hosts: HostReport[] = [];
  for (const h of hostList) hosts.push(await reportHost(h.name, h.root, routines[0]!, since));
  const report = {
    kind: "discovery-closed-loop-report",
    window: { since, applies_to: "rounds only — the finding carriers are reported whole" },
    routines,
    hosts,
    notes: [
      "READ-ONLY: this report opens carriers O_RDONLY and writes nothing. No model call, no budget change.",
      "DETERMINISTIC: no wall-clock 'now' enters the output; every cutoff comes from a value in a carrier.",
      "Every link is a value or `not-evaluated:<reason>`. `closed` requires EVERY link to be a value AND the post-merge effect reading to be negative.",
    ],
  };
  process.stdout.write(args.flags.json === true ? `${JSON.stringify(report, null, 2)}\n` : `${renderText(report as unknown as Record<string, unknown>)}\n`);
  return 0;
}

if (isDirectEntry(import.meta, process.argv[1], "discovery-closed-loop-report")) {
  // ⛔ `process.exitCode = …`, NEVER `process.exit(…)`. MEASURED on this report's own `--json` output:
  // `process.exit()` does not wait for a pending write to a PIPE, so a consumer reading
  // `… --json | jq` got a TRUNCATED document (91,646 bytes written to a file, 73,392 bytes through the
  // pipe) that failed to parse — while the same run redirected to a file looked fine. Setting the exit
  // code lets Node flush stdout and exit on its own.
  process.exitCode = await main();
}
