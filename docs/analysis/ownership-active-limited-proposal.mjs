#!/usr/bin/env node
// ownership-active LIMITED PROPOSAL MODE — phase C of the end-to-end architecture self-bootstrap.
//
// The shadow loop (`ownership-active-loop.mjs`) is a STRUCTURAL SANDBOX: it only ever appends a carrier
// record and never creates a Goal/task (`ownership-active-loop.test.mjs` pins that red line). This module is
// the OTHER half the experiment needs and never had: ONE small call site, INDEPENDENT of the loop, that can
// turn exactly ONE *already-qualified* carrier record into exactly ONE `draft` Goal.
//
//   carrier records for one candidate  (`.quay/ownership-shadow-proposals.jsonl`)
//     -> evaluateEntryBar(records)     (PURE) four entry conditions, each with its own reason
//     -> proposeDraftGoal(rec, ids)    ONLY when eligible: one draft AC (the exit condition) + one draft GOAL
//     -> STOP. Nothing is activated, no goal branch is opened, no code is refactored.
//
// ⛔ STRUCTURAL RED LINE (the NEXT instance of the loop's own "an automatic mechanism never executes a
//    high-risk operation" rule — asserted by plugin/test/ownership-active-limited-proposal.test.mjs):
//    this module never writes a `active` status and never imports a lifecycle/promote surface. A draft Goal
//    is the ONLY legal terminal state before a human rules on it (the repo's existing draft-goal convention:
//    `origin` must cite the human's ruling). The decision "from draft to active" is the human's, always.
//
// ⛔ 硬规则 3b (I could not evaluate must NOT look like "I evaluated and it passed"): `evaluateEntryBar`
//    returns a STATUS ENUM plus a condition-specific reason; a record whose concern_kind cannot be read is
//    NOT silently treated as "not package-cycle" — it is reported as its own undetermined state.
//
// The four entry conditions are taken VERBATIM from `ownership-active-replay.md` §6 (suggested entry
// conditions a–d), not re-invented here:
//   (1) concern_kind === "package-cycle"   — the only kind with a computable, falsifiable delta;
//   (2) the delta was COMPUTED by the ArchGuard `slice-delta` primitive (not model-asserted), its negative
//       control is falsified, and `provenanceConsistency === "match"`;
//   (3) the decision memory says "not a known exemption / not a known-not-yet-filed item";
//   (4) ≥ N consecutive PRODUCTION live runs on the same candidate carry a consistent computed delta.

import fs from "node:fs";
import path from "node:path";

// ── the entry bar (all four conditions are DATA so a refusal reason is enumerable and testable) ──────
export const ENTRY_BAR_STREAK = 3;                       // N=3 (§6(c): "require ≥ N consecutive shadow runs")
export const CONCERN_KIND_IN_SCOPE = "package-cycle";    // §6(a): only the kind with a computable delta
export const CONDITIONS = Object.freeze({
  KIND: "C1_concern_kind",
  DELTA: "C2_computed_delta_falsifiable_control_provenance",
  MEMORY: "C3_decision_memory",
  STREAK: "C4_run_streak",
});

/** The one line every auto-produced candidate must carry — the human approval it is waiting for. */
export const APPROVAL_REQUIRED_LINE =
  "本 Goal 为自动投研机制产出的候选，须人工审批后才能从 draft 转 active，本机制不执行该转换。";

const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const isStr = (x, n = 1) => typeof x === "string" && x.trim().length >= n;

// ── reading a carrier record (STATUS ENUM, never a boolean — 硬规则 3) ───────────────────────────────
/**
 * The concern kind of a run record.
 * A shadow-carrier record does not carry `concern_kind` as a field, so this derives it STRUCTURALLY:
 *   - `slice_delta` non-null  ⇒ package-cycle — by construction of the loop, a slice is computed ONLY for
 *     `concern_kind === "package-cycle"` (`ownership-active-loop.mjs`, the `computeSliceDelta` guard);
 *   - otherwise the loop's envelope already names the kind as a machine-written token
 *     `concern_kind=<kind>` (it is emitted by `toEnvelope`, not typed by the model).
 * @returns {string|null} the kind, or null when it cannot be read (its own state — never "not package-cycle")
 */
export function deriveConcernKind(rec) {
  if (!isObj(rec)) return null;
  if (isStr(rec.concern_kind, 1)) return rec.concern_kind;
  if (isObj(rec.slice_delta)) return CONCERN_KIND_IN_SCOPE;
  const delta = rec.envelope?.expected_mechanical_delta;
  const m = typeof delta === "string" ? delta.match(/concern_kind=([a-z0-9-]+)/) : null;
  return m ? m[1] : null;
}

/** The decision-memory verdict carried on the record (an enum; absent ⇒ `not-known`, the loop's default). */
export function decisionMemoryStatus(rec) {
  const dm = rec?.decision_memory;
  if (!isObj(dm)) return "not-known";
  return isStr(dm.status, 1) ? dm.status : "not-known";
}

/**
 * What the record says about its computed delta. Every sub-reading is enumerated so the reason can name
 * the exact one that failed (硬规则 3b: "not computed" and "computed but the control did not falsify"
 * are different facts, and neither may collapse into a generic "no delta").
 */
export function deltaEvidence(rec) {
  const sd = isObj(rec?.slice_delta) ? rec.slice_delta : (isObj(rec?.computed_delta) ? rec.computed_delta : null);
  if (!sd) return { present: false, computed: false, control_falsified: false, provenance_match: false, provenance_status: null, detail: "no slice_delta on the record" };
  const computed = sd.status === "evaluated" && isObj(sd.delta);
  const control_falsified = sd.negative_control?.falsified === true;
  const provenance_status =
    sd.provenance?.provenance_consistency?.status ?? sd.provenance_consistency?.status ?? null;
  return {
    present: true,
    computed,
    control_falsified,
    provenance_match: provenance_status === "match",
    provenance_status,
    delta: computed ? sd.delta : null,
    detail: computed ? null : `slice-delta status=${String(sd.status)}${sd.reason ? ` (${sd.reason})` : ""}`,
  };
}

/** A production (non-replay) live run. The BLIND/benchmark replays must never enter the streak. */
export function isProductionRun(rec) {
  if (!isObj(rec)) return false;
  const label = typeof rec.label === "string" ? rec.label : "";
  const runId = typeof rec.run_id === "string" ? rec.run_id : "";
  if (label.startsWith("replay") || runId.startsWith("replay")) return false;
  if (label.startsWith("holdout") || runId.startsWith("holdout")) return false;
  return true;
}

/** A stable identity for a delta, so "the same delta across N runs" is a comparison of computed content.
 *  ⚠️ The recursion is load-bearing: `JSON.stringify(v, keysArray)` is a REPLACER ARRAY — it keeps only the
 *  named keys AT EVERY LEVEL, so nested differences (`after.scc_size`, `removed_edges[i].names`) would be
 *  silently erased and two genuinely different deltas would collide. Canonicalise depth-first instead. */
export function canonicalize(x) {
  if (Array.isArray(x)) return x.map(canonicalize);
  if (isObj(x)) return Object.fromEntries(Object.keys(x).sort().map((k) => [k, canonicalize(x[k])]));
  return x;
}
export function deltaFingerprint(delta) {
  if (!isObj(delta)) return null;
  return JSON.stringify(canonicalize(delta));
}

// ── the entry bar ────────────────────────────────────────────────────────────────────────────────
/**
 * Judge whether ONE candidate's carrier records clear the four-entry bar.
 * PURE: the records are passed in (a read-only slice of the carrier for a SINGLE candidate — grouping is
 * the caller's job; `groupByCandidate` below is the helper that produces that slice from the whole carrier).
 *
 * ⚠️ INPUT ORDER IS AUTHORITATIVE. The carrier is append-ordered (`appendFileSync`), so the slice's order is
 *    its chronology. This is deliberately NOT re-derived from `ts` fields: some records in this carrier carry
 *    no timestamp at all, and sorting on a missing key silently hoists them to the head (a proxy量 read
 *    through an unverified layer — 硬规则 4b). The last element IS the latest run.
 *
 * @param {Array<object>} carrierRecords  the run records for one candidate, oldest first
 * @returns {{eligible:boolean, reason:string, matchedConditions:string[], conditions:object, streak:{length:number, required:number, delta_fingerprint:string|null}}}
 */
export function evaluateEntryBar(carrierRecords) {
  const records = Array.isArray(carrierRecords) ? carrierRecords.filter(isObj) : [];
  const mismatch = (reason, conditions = {}) => ({ eligible: false, reason, matchedConditions: [], conditions, streak: { length: 0, required: ENTRY_BAR_STREAK, delta_fingerprint: null } });
  if (records.length === 0) return mismatch("CONDITION_1_NOT_MET:no carrier records supplied for this candidate — nothing to evaluate");

  const ordered = [...records];   // append order == chronology (see the doc comment above)
  const head = ordered[ordered.length - 1];
  const matched = [];

  // (1) concern_kind
  const kind = deriveConcernKind(head);
  if (kind === null) return mismatch(`CONDITION_1_UNDETERMINED:the concern_kind of the latest record could not be read (no concern_kind field, no slice_delta, no machine-written concern_kind=<kind> token)`);
  if (kind !== CONCERN_KIND_IN_SCOPE) return mismatch(`CONDITION_1_NOT_MET:concern_kind=${kind} — only ${CONCERN_KIND_IN_SCOPE} has a computable, falsifiable delta (§6(a)); other kinds stay in shadow`);
  matched.push(CONDITIONS.KIND);

  // (2) the delta: computed by ArchGuard, falsifiable control, provenance match
  const d = deltaEvidence(head);
  if (!d.present) return withMatched(mismatch(`CONDITION_2_NOT_MET:${d.detail} — the delta is not computed by the ArchGuard slice-delta primitive`), matched);
  if (!d.computed) return withMatched(mismatch(`CONDITION_2_NOT_MET:the delta is not computed (${d.detail}) — a declared/estimated delta may not leave the carrier (§6(a))`), matched);
  if (!d.control_falsified) return withMatched(mismatch(`CONDITION_2_NOT_MET:the negative control is not falsified (falsified=${JSON.stringify(head.slice_delta?.negative_control?.falsified ?? null)}) — an unfalsifiable delta proves nothing`), matched);
  if (!d.provenance_match) return withMatched(mismatch(`CONDITION_2_NOT_MET:provenanceConsistency=${String(d.provenance_status)} — the analysed graph is not shown to come from the commit the proposal cites`), matched);
  matched.push(CONDITIONS.DELTA);

  // (3) decision memory: a recorded exemption or a known-but-unfiled item must NOT be repackaged as a Goal
  const memory = decisionMemoryStatus(head);
  if (memory === "exempted") return withMatched(mismatch(`CONDITION_3_NOT_MET:decision_memory=exempted (${head.decision_memory?.matched_entry?.id ?? "unknown entry"}) — a human already ruled this item is not to be changed`), matched);
  if (memory === "known-not-yet-filed") return withMatched(mismatch(`CONDITION_3_NOT_MET:decision_memory=known-not-yet-filed (${head.decision_memory?.matched_entry?.id ?? "unknown entry"}) — a known defect must be filed through its own path, not re-wrapped by this mechanism`), matched);
  if (memory !== "not-known") return withMatched(mismatch(`CONDITION_3_UNDETERMINED:decision_memory status ${JSON.stringify(memory)} is not a recognised verdict`), matched);
  matched.push(CONDITIONS.MEMORY);

  // (4) run-streak: the MOST RECENT N production runs must all clear (1)–(3) with the SAME delta
  const fingerprint = deltaFingerprint(head.slice_delta.delta);
  let streak = 0;
  for (let i = ordered.length - 1; i >= 0; i--) {
    const r = ordered[i];
    // A replay / holdout record is NOT a production run — it neither counts toward the streak nor breaks
    // it (§6(c) counts production live runs). The first PRODUCTION run that fails to qualify ends it.
    if (!isProductionRun(r)) continue;
    if (deriveConcernKind(r) !== CONCERN_KIND_IN_SCOPE) break;
    const rd = deltaEvidence(r);
    if (!rd.computed || !rd.control_falsified || !rd.provenance_match) break;
    if (deltaFingerprint(r.slice_delta?.delta) !== fingerprint) break;
    streak++;
  }
  const streakReading = { length: streak, required: ENTRY_BAR_STREAK, delta_fingerprint: fingerprint };
  if (streak < ENTRY_BAR_STREAK) {
    return { eligible: false, reason: `CONDITION_4_NOT_MET:run_streak=${streak}/${ENTRY_BAR_STREAK} — ${streak} consecutive production run(s) carry the same computed, falsifiable delta; a one-off fluctuation must not trigger a proposal (§6(c))`, matchedConditions: matched, conditions: { kind, delta: d, memory }, streak: streakReading };
  }
  matched.push(CONDITIONS.STREAK);
  return { eligible: true, reason: `ELIGIBLE:concern_kind=${CONCERN_KIND_IN_SCOPE}; computed falsifiable delta; provenanceConsistency=match; decision_memory=not-known; run_streak=${streak}/${ENTRY_BAR_STREAK}`, matchedConditions: matched, conditions: { kind, delta: d, memory }, streak: streakReading };
}

const withMatched = (verdict, matched) => ({ ...verdict, matchedConditions: matched });

/** Group a whole carrier into per-candidate slices. Candidate identity = its structural file set when the
 *  record carries one, else the loop's normalised `concern_key`. ⛔ Not the model's prose. */
export function groupByCandidate(records) {
  const groups = new Map();
  for (const r of Array.isArray(records) ? records : []) {
    if (!isObj(r)) continue;
    const files = Array.isArray(r.subject_files) && r.subject_files.length ? [...r.subject_files].sort().join(",") : null;
    const key = files ?? (isStr(r.concern_key, 1) ? r.concern_key : null);
    if (key === null) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return groups;
}

// ── numbering (dynamic; no literal id is ever hard-coded — 硬规则 8: ids are never reused) ───────────
/** The next open GOAL id = max existing + 1. Reads whatever list it is given, so a caller that just read
 *  `goal_list` cannot race a session that created a goal in between — it re-reads before it writes. */
export function nextGoalId(existingGoalIds) {
  return nextId("GOAL", existingGoalIds);
}
export function nextAcId(existingAcIds) {
  return nextId("AC", existingAcIds);
}
function nextId(prefix, ids) {
  let max = 0;
  for (const id of Array.isArray(ids) ? ids : []) {
    const m = String(isObj(id) ? id.id : id ?? "").match(new RegExp(`^${prefix}-(\\d{3,})$`));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

// ── the constrained write: exactly one draft Goal (and its exit-condition AC) ─────────────────────
/**
 * Build the two records a draft Goal needs. PURE — no I/O. The GOAL body carries, as the task requires:
 * the evidence-chain reference, the ArchGuard-COMPUTED predicted delta, the reversibility assessment, and
 * the human-approval line. The AC is the goal's exit condition and is written FIRST: the goal write surface
 * refuses a GOAL born in {draft, active} with zero ACs, and that refusal is the store's own invariant
 * (AC-217), not this module's.
 */
export function buildDraftGoal(eligibleRecord, { goalId, acId }) {
  const kind = deriveConcernKind(eligibleRecord) ?? "unknown";
  const delta = eligibleRecord.slice_delta?.delta ?? null;
  const evidenceIds = [
    ...(Array.isArray(eligibleRecord.envelope?.evidence_refs) ? eligibleRecord.envelope.evidence_refs : []),
    ...(Array.isArray(eligibleRecord.evidence) ? eligibleRecord.evidence.map((e) => e.id).filter(Boolean) : []),
  ];
  const uniqueEvidence = [...new Set(evidenceIds)];
  const files = Array.isArray(eligibleRecord.subject_files) ? eligibleRecord.subject_files : [];
  const renderedDelta = isStr(eligibleRecord.envelope?.expected_mechanical_delta, 1)
    ? eligibleRecord.envelope.expected_mechanical_delta
    : JSON.stringify(delta, null, 1);
  const title = `[auto-proposal] ${kind} 收敛候选：${(files.length ? files.join(", ") : eligibleRecord.concern_key || "unlabelled candidate").slice(0, 90)}`;

  const origin = [
    `自动投研机制产出的候选（ownership-active limited-proposal mode, 端到端架构自举实验 阶段 C）。`,
    `证据载体 .quay/ownership-shadow-proposals.jsonl；run_id=${eligibleRecord.run_id ?? "n/a"}；commit=${eligibleRecord.commit ?? "n/a"}。`,
    `准入判据 evaluateEntryBar 四条全过：concern_kind=package-cycle；delta 由 ArchGuard slice-delta 原语计算且负对照已证伪、provenanceConsistency=match；决策记忆=not-known；连续 ${ENTRY_BAR_STREAK} 次生产 live run 一致。`,
    `人在审批前不得把本 Goal 转 active——这是本机制唯一的合法终态。`,
  ].join("\n");

  const body = [
    "## 背景",
    `本候选由「ownership-active limited-proposal mode」从生产 live shadow run 的 carrier 记录中筛出，是端到端架构自举实验阶段 C 的第一个（也是唯一的）自动产出物。它只声明一个 ${kind} 的收敛 slice，不承诺任何实现方式。`,
    "",
    "## 证据链",
    `- carrier：.quay/ownership-shadow-proposals.jsonl`,
    `- run_id：${eligibleRecord.run_id ?? "n/a"}`,
    `- 被测 commit：${eligibleRecord.commit ?? "n/a"}`,
    `- 涉及文件：${files.length ? files.join(", ") : "(见 run 记录)"}`,
    `- 引用的证据读数 id：[${uniqueEvidence.join(", ")}]`,
    `- 决策记忆：not-known（无命中条目）`,
    "",
    "## 预测 delta（由 ArchGuard slice-delta 原语计算，非模型自述）",
    renderedDelta,
    `- 负对照：falsified=true；provenanceConsistency=match`,
    "",
    "## 范围与非目标",
    `- 在范围内：${kind} 候选本身声明的 slice（见上 delta）。`,
    "- 非目标：任何未在 slice 中命名的改动；任何产物化/长期保证；任何把本 Goal 自行转 active 的动作。",
    "",
    "## 可逆性评估",
    `本候选的全部改动都落在一个 package-cycle 的 slice 上，且以独立的 goal 分支（goal/<本 Goal id>）承载：若人裁定否决，整条分支可直接丢弃，develop 无残留——与本仓库既有的「整分支丢弃」先例同形。因此本候选的代价是可逆的，不需要在审批前做任何预防性回退。`,
    "",
    "## 退出条件",
    `${acId} —— 本 Goal 离开 draft（active=认可；superseded=否决）即视为已裁定。`,
    "",
    `> ${APPROVAL_REQUIRED_LINE}`,
  ].join("\n");

  const acCriterion = `goal_file=$(ls goals/${goalId}-*.md 2>/dev/null | head -1); [ -n "$goal_file" ] && grep -Eq "^status: *(active|superseded)" "$goal_file" || { echo "${goalId} 仍为 draft——须人工裁定后才可离开待裁定面" >&2; exit 1; }`;

  return {
    goal: { kind: "goal", id: goalId, fields: { title, status: "draft", origin, body, intent: "absent" } },
    ac: {
      kind: "criterion", id: acId,
      fields: {
        title: `${title} — 退出条件`,
        status: "draft",
        goal: goalId,
        criterion: acCriterion,
        expect: `该候选已被人工裁定：${goalId} 离开 draft（active=认可；superseded=否决）。draft 期间判据为假并写出成因。`,
        origin,
        intent: "absent",
      },
    },
  };
}

/**
 * Create exactly ONE draft Goal (plus its exit-condition AC, written first — see buildDraftGoal).
 * ⛔ PRECONDITION: the caller has already confirmed `evaluateEntryBar(candidateRecords).eligible === true`.
 *    This function does NOT re-judge (a single record cannot show a run-streak), and it does NOT activate
 *    anything — the draft status is hard-coded here and nowhere in this module is a non-draft status written.
 * ⛔ FAIL-CLOSED (硬规则 3b): with no `deps.write` seam there is NOTHING to report as created — the call
 *    returns `{ok:false}` and never a fabricated Goal. With a failing write it reports the failure.
 *
 * @param {object} eligibleRecord  the qualifying carrier record (the LAST run of the streak)
 * @param {Array} existingGoalIds  open GOAL ids (from goal_list) — the number is computed, never hard-coded
 * @param {object} deps  { write(record)->{ok,id,error?}, existingAcIds?:Array }
 * @returns {{ok:boolean, id:string|null, goal:object|null, ac:object|null, reason:string}}
 */
export function proposeDraftGoal(eligibleRecord, existingGoalIds, deps = {}) {
  const goalId = nextGoalId(existingGoalIds);
  const acId = nextAcId(deps.existingAcIds ?? []);
  const { goal, ac } = buildDraftGoal(eligibleRecord, { goalId, acId });
  if (typeof deps.write !== "function") {
    return { ok: false, id: null, goal: null, ac: null, reason: "NO_WRITE_SEAM:refusing to report a draft Goal that was not persisted (硬规则 3b)" };
  }
  const acRes = deps.write(ac);
  if (!acRes || acRes.ok !== true) {
    return { ok: false, id: null, goal: null, ac: null, reason: `AC_WRITE_FAILED:${acRes?.error ?? acRes?.reason ?? "unknown"} — the goal is refused by the store without its exit-condition AC (AC-217); nothing was created` };
  }
  const goalRes = deps.write(goal);
  if (!goalRes || goalRes.ok !== true) {
    return { ok: false, id: null, goal: null, ac: null, reason: `GOAL_WRITE_FAILED:${goalRes?.error ?? goalRes?.reason ?? "unknown"}` };
  }
  return { ok: true, id: goalId, goal, ac, reason: `draft ${goalId} created (status=draft; awaiting human approval)` };
}

/**
 * The real write seam over a goal store (`packages/quay/src/goal-store.ts::createGoalStore(goalDir)`),
 * passed IN so this module never statically imports the Core tree. `write` is the ONLY side-effecting
 * thing this module does, and it can only ever write `draft` records built by buildDraftGoal.
 */
export function createGoalStoreWrite(store) {
  if (!store || typeof store.write !== "function") throw new Error("createGoalStoreWrite: a goal store with a write() method is required");
  return (record) => {
    try {
      const vm = store.write(record.id, { ...record.fields });
      return { ok: true, id: vm.id };
    } catch (e) {
      return { ok: false, id: record.id, error: String(e?.message ?? e) };
    }
  };
}

// ── CLI: a real (non-fixture) reading + an optional constrained write ────────────────────────────────
async function cli() {
  const { fileURLToPath } = await import("node:url");
  const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const args = process.argv.slice(2);
  const val = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const root = val("--root", REPO_ROOT);
  const carrier = val("--carrier", path.join(root, ".quay", "ownership-shadow-proposals.jsonl"));
  const records = fs.existsSync(carrier)
    ? fs.readFileSync(carrier, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
    : [];
  const out = [];
  const write = args.includes("--write");
  let store = null, writeSeam = null;
  if (write) {
    const { createGoalStore } = await import(path.join(REPO_ROOT, "packages", "quay", "src", "goal-store.ts"));
    store = createGoalStore(path.join(root, "goals"), {});
    writeSeam = createGoalStoreWrite(store);
  }
  for (const [key, group] of groupByCandidate(records)) {
    const verdict = evaluateEntryBar(group);
    const row = { candidate: key, n_records: group.length, eligible: verdict.eligible, reason: verdict.reason, matchedConditions: verdict.matchedConditions, streak: verdict.streak };
    if (verdict.eligible && write) {
      const existing = store.list().map((g) => g.id);
      row.proposed = proposeDraftGoal(group[group.length - 1], existing, { write: writeSeam, existingAcIds: existing });
    }
    out.push(row);
  }
  process.stdout.write(JSON.stringify({ carrier, records: records.length, candidates: out.length, results: out }, null, 2) + "\n");
}

if (import.meta.url === `file://${process.argv[1]}`) cli();
