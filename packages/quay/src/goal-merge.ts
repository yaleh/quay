// goal-merge.ts — the HUMAN merge-request half of the goal→develop final fan-in
// (SPEC-goal-branch-2026-10-03 §4.7, rulings ⑭⑱⑲⑳⑫).
//
// THE SHAPE OF THE MECHANISM (why this file exists at all):
//   A branch-mode goal's work lands on `goal/<GOAL-NNN>`; it reaches `develop` only through a
//   HUMAN-triggered request. The human never runs a 20-minute verify loop in their terminal, so the
//   verb `quay goal merge <GOAL-NNN> --reason <…>` does NOT merge: it RECORDS A REQUEST as an
//   append-only GateEvent (`gate: "goal-merge-request"`). The EXECUTION (the `--no-ff` merge, the
//   full verification, the ff of develop, the branch deletion) belongs to the worker-driver, which
//   owns task landing (DIR-131) — see `plugin/scripts/worker-fan-in.ts` `runGoalMergeFanIn`.
//
// The request/result events are the SINGLE carrier both sides read; ⛔ there is no stored `landed`
// or `pending` field (hard rule 4b): pending is DERIVED — a request exists ∧ `goal/<id>` exists ∧ it
// is not yet an ancestor of develop. The worker-driver re-derives it every round.
//
// WHY THE EVENT CARRIES A tip SHA: it records WHICH TREE the human tried (§4.10 preview), so the
// request's provenance is auditable. By ruling ⑳ the tip is NOT an execution condition — a fix that
// advances the tip is auto-retried; the human approved the goal's business objective, not one tree.

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { appendGateEvent, queryGateEvents } from "./gate/gate-event-store.ts";
import { parseFrontmatter } from "./frontmatter-store-base.ts";
import { goalBranchName, goalBranchRefExists } from "./branch-model.ts";

/** The ledger gate names this mechanism writes. ⛔ Both are read back by the SAME module so a typo
 *  cannot half-match (硬规则 5b: one definition, not a string literal repeated per call site). */
export const GOAL_MERGE_REQUEST_GATE = "goal-merge-request";
export const GOAL_MERGE_RESULT_GATE = "goal-merge-result";

/** A request as read back from the ledger. `tipSha` = the `goal/<id>` tip the human previewed at
 *  request time (`""` when the branch could not be read — a distinguishable value, ⛔ not null). */
export interface GoalMergeRequest {
  eventId: string;
  goalId: string;
  actor: string;
  reason: string;
  tipSha: string;
  /** The `--override` reason, when the human knowingly waved through unmet pre-merge ACs. */
  override: string | null;
  /** The pre-merge ACs that were NOT achieved at request time (empty when none). Recorded so a
   *  retry after a fix can re-apply the override to EXACTLY these (ruling ⑳: an override is informed
   *  consent about specific gaps, ⛔ not a blank cheque). */
  unmetAcs: string[];
  timestamp: string;
}

/** A refusal from `recordGoalMergeRequest`. Enumerated (hard rule 3): every refusal names its own
 *  cause so the human sees WHY, ⛔ never a bare `ok:false`. */
export interface GoalMergeRefusal {
  code: "no-such-goal" | "goal-not-active" | "not-branch-mode" | "branch-missing" | "already-merged" | "pre-merge-ac-unmet" | "usage";
  message: string;
}

export interface GoalMergeRequestOutcome {
  ok: boolean;
  goalId: string;
  /** On success: the recorded request. */
  request?: GoalMergeRequest;
  /** On success: the pre-merge ACs not achieved at request time (what an override waved through). */
  unmetAcs?: string[];
  /** Display-only sufficiency verdict (never a blocker — §4.7: it still gates `achieved`). */
  sufficiency?: { verdict: "covered" | "insufficient" | "not-evaluated"; reason: string };
  /** On refusal. */
  refusal?: GoalMergeRefusal;
}

// ── git helpers ──────────────────────────────────────────────────────────────────────────────────

function git(root: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  return { status: r.status ?? 1, stdout: (r.stdout ?? "").trim(), stderr: (r.stderr ?? "").trim() };
}

function isAncestor(root: string, ancestor: string, descendant: string): boolean {
  // `merge-base --is-ancestor` exits 0 iff ancestor is an ancestor of descendant. Any git error
  // (missing ref) exits non-zero — read as "not an ancestor", which for `already-merged` is the
  // fail-OPEN direction, so the caller checks the branch EXISTS first (branch-missing) and develop
  // exists before this is reached.
  return git(root, ["merge-base", "--is-ancestor", ancestor, descendant]).status === 0;
}

// ── goal-record reading (store dialect: <root>/goals/*.md — ⛔ no workspace/config needed) ───────

interface GoalAc {
  id: string;
  phase: "pre-merge" | "post-merge";
}

function goalsDir(root: string): string {
  return path.join(root, "goals");
}

/** Read one GOAL record's frontmatter. Returns null when no `<goalId>-*.md` exists (⛔ not "a record
 *  with no status" — the two are different, hard rule 6). */
export function readGoalRecord(root: string, goalId: string): Record<string, unknown> | null {
  const dir = goalsDir(root);
  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const file = files.find((f) => f.startsWith(`${goalId}-`) && f.endsWith(".md"));
  if (!file) return null;
  try {
    return parseFrontmatter(fs.readFileSync(path.join(dir, file), "utf8")).frontmatter as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** The AC records filed under `goalId`, each reduced to id + evaluation phase. `phase` is DECLARED
 *  on the AC (⛔ never inferred from criterion text, 硬规则 2); absent ⇒ `pre-merge` (§4.7's
 *  asymmetric default: a mis-classified post-merge AC that reads not-evaluated is VISIBLE and blocks,
 *  whereas a mis-classified pre-merge AC that gets skipped is silent). */
export function readGoalAcs(root: string, goalId: string): GoalAc[] {
  const dir = goalsDir(root);
  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: GoalAc[] = [];
  for (const f of files) {
    if (!(f.startsWith("AC-") && f.endsWith(".md"))) continue;
    let fm: Record<string, unknown>;
    try {
      fm = parseFrontmatter(fs.readFileSync(path.join(dir, f), "utf8")).frontmatter as Record<string, unknown>;
    } catch {
      continue;
    }
    if (fm.goal !== goalId) continue;
    const id = typeof fm.id === "string" ? fm.id : f.split("-").slice(0, 2).join("-");
    const phase = fm.phase === "post-merge" ? "post-merge" : "pre-merge";
    out.push({ id, phase });
  }
  return out;
}

/** The LAST recorded `gate:"goal"` verdict for an AC id, or `null` when the ledger has no event for
 *  it (never evaluated). `"pass"` is what "achieved" means at the ledger level. */
export function lastGoalVerdict(root: string, acId: string): string | null {
  const logPath = path.join(root, ".quay", "gate-events.jsonl");
  let events;
  try {
    events = queryGateEvents(logPath, { gate: "goal" });
  } catch {
    return null;
  }
  let verdict: string | null = null;
  for (const ev of events) {
    const id = String(ev.pipeline_id ?? ev.item_id ?? "");
    if (id === acId) verdict = String(ev.verdict ?? "");
  }
  return verdict;
}

/** The pre-merge ACs of `goalId` whose last ledger verdict is not `pass` — the set an `--override`
 *  would wave through. Enumerated, ⛔ never a boolean (a blocked merge must say WHICH gaps). */
export function unmetPreMergeAcs(root: string, goalId: string): string[] {
  return readGoalAcs(root, goalId)
    .filter((ac) => ac.phase === "pre-merge")
    .filter((ac) => lastGoalVerdict(root, ac.id) !== "pass")
    .map((ac) => ac.id);
}

/** Display-only sufficiency reading, best-effort from the goal round carrier. ⛔ Never a blocker here
 *  (§4.7). A carrier that cannot be read yields `not-evaluated` — a DISTINGUISHABLE value, ⛔ not
 *  `covered` (硬规则 3b). */
export function readGoalSufficiency(root: string, goalId: string): { verdict: "covered" | "insufficient" | "not-evaluated"; reason: string } {
  const rel = path.join(root, ".quay", "goal-round.jsonl");
  let text: string;
  try {
    text = fs.readFileSync(rel, "utf8");
  } catch {
    return { verdict: "not-evaluated", reason: "no goal-round carrier readable" };
  }
  let found: { verdict: string; reason: string } | null = null;
  for (const line of text.split("\n")) {
    if (!line.includes("\"sufficiency\"")) continue;
    let rec: { value?: { sufficiency?: { goal?: string; verdict?: string; cause?: string } }; reason?: string };
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    const s = rec.value?.sufficiency;
    if (s && s.goal === goalId && typeof s.verdict === "string") {
      found = { verdict: s.verdict, reason: typeof rec.reason === "string" ? rec.reason : "" };
    }
  }
  if (!found) return { verdict: "not-evaluated", reason: "no sufficiency verdict recorded for this goal" };
  if (found.verdict === "covered" || found.verdict === "insufficient") return { verdict: found.verdict, reason: found.reason };
  return { verdict: "not-evaluated", reason: found.reason };
}

// ── request recording (the `quay goal merge` verb's logic) ────────────────────────────────────────

/**
 * Record a human merge request, or refuse. ⛔ This NEVER merges (see file header): it only appends a
 * `goal-merge-request` GateEvent. Every refusal path returns WITHOUT writing (the AC asserts this).
 *
 * Refusals (§4.7, ruling ⑱), evaluated in this order:
 *   1. no such goal record                     → no-such-goal
 *   2. goal status ≠ active                    → goal-not-active
 *   3. goal is not branch-mode (`branch:true`) → not-branch-mode
 *   4. `goal/<id>` does not exist              → branch-missing
 *   5. `goal/<id>` already an ancestor of develop → already-merged
 *   6. a pre-merge AC is not achieved ∧ no --override → pre-merge-ac-unmet
 */
export function recordGoalMergeRequest(opts: {
  root: string;
  goalId: string;
  reason: string;
  override?: string | null;
  actor?: string;
  now?: () => Date;
}): GoalMergeRequestOutcome {
  const { root, goalId } = opts;
  const reason = String(opts.reason ?? "").trim();
  const override = opts.override === undefined || opts.override === null ? null : String(opts.override).trim();
  const actor = opts.actor && String(opts.actor).trim() ? String(opts.actor).trim() : "human";

  if (!/^GOAL-\d{3,}$/.test(goalId)) {
    return { ok: false, goalId, refusal: { code: "usage", message: `not a GOAL id: ${JSON.stringify(goalId)}` } };
  }
  if (reason === "") {
    return { ok: false, goalId, refusal: { code: "usage", message: "--reason is required (why the goal is mature enough to merge now)" } };
  }

  const rec = readGoalRecord(root, goalId);
  if (rec === null) {
    return { ok: false, goalId, refusal: { code: "no-such-goal", message: `no goal record goals/${goalId}-*.md` } };
  }
  if (rec.status !== "active") {
    return { ok: false, goalId, refusal: { code: "goal-not-active", message: `${goalId} status is ${JSON.stringify(rec.status ?? "unknown")} — only an active goal can be merged` } };
  }
  if (rec.branch !== true) {
    return { ok: false, goalId, refusal: { code: "not-branch-mode", message: `${goalId} is not branch-mode (branch: true) — it has no goal branch to merge` } };
  }
  const branch = goalBranchName(goalId);
  if (!goalBranchRefExists(root, goalId)) {
    return { ok: false, goalId, refusal: { code: "branch-missing", message: `branch ${branch} does not exist` } };
  }
  if (isAncestor(root, branch, "develop")) {
    return { ok: false, goalId, refusal: { code: "already-merged", message: `${branch} is already an ancestor of develop` } };
  }

  const unmet = unmetPreMergeAcs(root, goalId);
  if (unmet.length > 0 && override === null) {
    return {
      ok: false, goalId,
      refusal: {
        code: "pre-merge-ac-unmet",
        message: `pre-merge AC(s) not achieved: ${unmet.join(", ")} — pass --override "<why this is acceptable>" to merge anyway`,
      },
    };
  }

  const tipSha = git(root, ["rev-parse", branch]).stdout;
  const eventId = randomUUID();
  const timestamp = (opts.now?.() ?? new Date()).toISOString();
  const request: GoalMergeRequest = { eventId, goalId, actor, reason, tipSha, override, unmetAcs: unmet, timestamp };
  appendGateEvent(path.join(root, ".quay", "gate-events.jsonl"), {
    id: eventId,
    item_id: goalId,
    pipeline_id: goalId,
    gate: GOAL_MERGE_REQUEST_GATE,
    actor,
    verdict: "request",
    timestamp,
    payload: { reason, tipSha, override, unmetAcs: unmet, eventId },
  });
  return { ok: true, goalId, request, unmetAcs: unmet, sufficiency: readGoalSufficiency(root, goalId) };
}

// ── derived pending reading (shared by the worker-driver round) ───────────────────────────────────

/** Every request event in the ledger, newest last (append order). ⛔ An unreadable ledger yields `[]`
 *  — but that is "not checked", and the caller treats an empty ledger as "no requests". */
export function readGoalMergeRequests(root: string): GoalMergeRequest[] {
  const logPath = path.join(root, ".quay", "gate-events.jsonl");
  let events;
  try {
    events = queryGateEvents(logPath, { gate: GOAL_MERGE_REQUEST_GATE });
  } catch {
    return [];
  }
  return events.map((ev) => {
    const p = (ev.payload ?? {}) as Record<string, unknown>;
    return {
      eventId: typeof p.eventId === "string" ? p.eventId : String(ev.id ?? ""),
      goalId: String(ev.pipeline_id ?? ev.item_id ?? ""),
      actor: String(ev.actor ?? ""),
      reason: typeof p.reason === "string" ? p.reason : "",
      tipSha: typeof p.tipSha === "string" ? p.tipSha : "",
      override: typeof p.override === "string" ? p.override : null,
      unmetAcs: Array.isArray(p.unmetAcs) ? p.unmetAcs.map((x) => String(x)) : [],
      timestamp: String(ev.timestamp ?? ""),
    };
  });
}

/** One recorded execution result. `tipSha` = the `goal/<id>` tip the attempt ran against; `outcome`
 *  `"landed"` or `"red"`. Written by the worker-driver (fan-in side), read by gap-filing. */
export interface GoalMergeResult {
  goalId: string;
  outcome: "landed" | "red";
  step: string | null;
  reason: string | null;
  tipSha: string;
  requestEventId: string;
  landedSha: string | null;
  timestamp: string;
}

export function readGoalMergeResults(root: string): GoalMergeResult[] {
  const logPath = path.join(root, ".quay", "gate-events.jsonl");
  let events;
  try {
    events = queryGateEvents(logPath, { gate: GOAL_MERGE_RESULT_GATE });
  } catch {
    return [];
  }
  return events.map((ev) => {
    const p = (ev.payload ?? {}) as Record<string, unknown>;
    return {
      goalId: String(ev.pipeline_id ?? ev.item_id ?? ""),
      outcome: p.outcome === "landed" ? "landed" : "red",
      step: typeof p.step === "string" ? p.step : null,
      reason: typeof p.reason === "string" ? p.reason : null,
      tipSha: typeof p.tipSha === "string" ? p.tipSha : "",
      requestEventId: typeof p.requestEventId === "string" ? p.requestEventId : "",
      landedSha: typeof p.landedSha === "string" ? p.landedSha : null,
      timestamp: String(ev.timestamp ?? ""),
    };
  });
}

export interface PendingGoalMerge {
  goalId: string;
  request: GoalMergeRequest;
  /** The CURRENT `goal/<id>` tip (may differ from the request's — ruling ⑳ auto-retry). */
  tipSha: string;
}

/**
 * The DERIVED set of merge requests still to execute (⛔ no stored state — SPEC §4.7 硬规则 4b):
 *   a request exists ∧ `goal/<id>` exists ∧ it is not yet an ancestor of develop
 *   ∧ the tip has ADVANCED past (or was never attempted at) the last recorded execution.
 *
 * The last clause is ruling ⑳'s auto-retry rule: a red attempt is retried only when a fix moved the
 * tip. Re-running the same tree would only re-roll the suite flake. The LATEST request per goal wins.
 */
export function pendingGoalMerges(root: string): PendingGoalMerge[] {
  const requests = readGoalMergeRequests(root);
  if (requests.length === 0) return [];
  const latest = new Map<string, GoalMergeRequest>();
  for (const r of requests) latest.set(r.goalId, r); // append order ⇒ last wins
  const results = readGoalMergeResults(root);
  const lastResult = new Map<string, GoalMergeResult>();
  for (const r of results) lastResult.set(r.goalId, r);

  const out: PendingGoalMerge[] = [];
  for (const [goalId, request] of latest) {
    if (!goalBranchRefExists(root, goalId)) continue; // branch gone ⇒ request satisfied/discarded
    const branch = goalBranchName(goalId);
    if (isAncestor(root, branch, "develop")) continue; // already landed
    const tipSha = git(root, ["rev-parse", branch]).stdout;
    if (!tipSha) continue;
    const prev = lastResult.get(goalId);
    if (prev && prev.tipSha === tipSha) continue; // tip unchanged since last attempt ⇒ no retry
    out.push({ goalId, request, tipSha });
  }
  return out;
}
