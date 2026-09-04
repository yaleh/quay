// ac36-sortkey-criterion-check.ts — mechanical checker for AC36 判据② (tasks/
// gap-ac36-recommended-exposes-sort-key). THE PRODUCT: slot-refill --json's `recommended` string
// array does NOT expose the sort axes (blocking_suite / delivery_critical / id), so the "打了 label
// 的任务位次严格前移 + 负控制：不打 label 的同族位次不变" criterion could ONLY be verified by a human
// eyeballing two runs. THIS checker makes 判据② mechanical: given two slot-refill --json outputs
// (before/after applying a `delivery-critical` label), it asserts from the `ranking` arrays alone:
//   (a) DC task strictly moved forward (rank strictly decreased, or moved from outside the
//       recommended window into it),
//   (b) negative control — same-family non-DC tasks keep their RELATIVE order (the sort's id
//       tie-break is untouched by the DC axis; a regression that re-ranks non-DC work breaks it),
//   (c) blocking_suite still sits ABOVE delivery_critical (the first axis is never demoted).
//
// POSITIONAL, never keyword-based: the checker reads only the structured `ranking` fields
// (deliveryCritical / suiteBlocking / rank) — it never greps prose, so a doc that merely QUOTES
// the criterion cannot be mistaken for evidence (the exact false-positive class the repo's
// 按位置不按关键词 rule is about).
//
// MODES:
//   --before <file>  slot-refill --json output captured BEFORE the label was applied
//   --after  <file>  slot-refill --json output captured AFTER  the label was applied
//   --dc-id <id>     (optional) the labeled task id; when omitted the checker auto-detects the
//                    task(s) that became deliveryCritical between the two runs
//   --family-prefix <prefix> (optional) restrict the negative control to same-family ids
//                    (default: every non-DC id present in both rankings)
//   --json           machine-readable output ({ok, reason, checks})
//
// Exit codes: 0 = PASS (判据② mechanically verified); 1 = FAIL (a criterion violated); 2 = usage.
//
// Run:
//   node --no-warnings --experimental-strip-types plugin/scripts/ac36-sortkey-criterion-check.ts \
//     --before /tmp/before.json --after /tmp/after.json --dc-id gap-xxx --family-prefix gap-

import fs from "node:fs";
import { isDirectEntry, emitPass, emitFail } from "./gate-script-base.ts";

/** True iff a ranking entry carries all four sort-key fields the mechanical check needs. */
export function isRankingEntry(e) {
  return !!e
    && typeof e.id === "string"
    && typeof e.deliveryCritical === "boolean"
    && typeof e.suiteBlocking === "boolean"
    && typeof e.rank === "number";
}

/** Validate that a slot-refill result exposes a well-formed `ranking` array. Returns a violation
 *  string, or null when the array is present and well-formed. */
export function rankingExposureViolation(result, label) {
  const ranking = result && result.ranking;
  if (!Array.isArray(ranking)) {
    return `"${label}" --json output has no \`ranking\` array — AC36 判据② requires each recommended id's sort axes ({id, deliveryCritical, suiteBlocking, rank}) to be machine-readable`;
  }
  if (ranking.length > 0 && !ranking.every(isRankingEntry)) {
    return `"${label}" ranking entries are malformed — each must carry {id, deliveryCritical, suiteBlocking, rank}`;
  }
  return null;
}

/**
 * The AC36 判据② mechanical judgment — PURE. Compares a `before` and an `after` slot-refill result.
 *
 * @param {object} o
 * @param {object} o.before  parsed slot-refill result captured BEFORE the label was applied
 * @param {object} o.after   parsed slot-refill result captured AFTER  the label was applied
 * @param {string} [o.dcId]        the labeled task id (auto-detected when omitted)
 * @param {string} [o.familyPrefix] restrict the negative control to ids starting with this prefix
 * @returns {{ok: boolean, reason: string[], checks: object}}
 */
export function checkCriterion2({ before, after, dcId, familyPrefix }) {
  const checks = { exposure: null, dcMovement: null, negativeControl: null, suiteBlockingAboveDC: null };
  const violations = [];

  // 1. SORT-KEY EXPOSURE — both runs must carry the `ranking` array.
  const bViolation = rankingExposureViolation(before, "before");
  const aViolation = rankingExposureViolation(after, "after");
  if (bViolation || aViolation) {
    if (bViolation) violations.push(bViolation);
    if (aViolation) violations.push(aViolation);
    return { ok: false, reason: violations, checks };
  }
  const bRanking = before.ranking;
  const aRanking = after.ranking;
  checks.exposure = { before: bRanking.length, after: aRanking.length };
  if (aRanking.length === 0) {
    return { ok: false, reason: ["the after run's ranking is empty — no recommendation to assert movement on"], checks };
  }

  const bById = new Map(bRanking.map((e) => [e.id, e]));
  const aById = new Map(aRanking.map((e) => [e.id, e]));
  const bRankOf = (id) => (bById.has(id) ? bById.get(id).rank : null);
  const aRankOf = (id) => (aById.has(id) ? aById.get(id).rank : null);

  // 2. DC TASK IDENTIFICATION — explicit --dc-id wins; else auto-detect the task(s) that became
  //    deliveryCritical between the two runs (present and DC in after, NOT DC in before).
  let dcIds = [];
  if (dcId) {
    dcIds = [dcId];
  } else {
    dcIds = aRanking.filter((e) => e.deliveryCritical && !(bById.get(e.id) && bById.get(e.id).deliveryCritical)).map((e) => e.id);
  }
  if (dcIds.length === 0) {
    return {
      ok: false,
      reason: ["no delivery-critical task found: none of the after-run ranking entries is deliveryCritical that was not already in the before run — pass --dc-id <id> when the label target is outside the recommended window"],
      checks,
    };
  }

  // 3. (a) DC STRICT FORWARD MOVEMENT — after rank strictly less than before rank (or the task
  //    moved from OUTSIDE the recommended window into it, which is a strict improvement).
  for (const id of dcIds) {
    const beforeEntry = bById.get(id);
    const afterEntry = aById.get(id);
    if (!afterEntry || !afterEntry.deliveryCritical) {
      violations.push(`DC task ${id}: not deliveryCritical in the after ranking — the label did not land, cannot assert movement`);
      continue;
    }
    const beforeRank = bRankOf(id);
    const afterRank = aRankOf(id);
    if (beforeRank === null && afterRank !== null) {
      checks.dcMovement = { id, before: null, after: afterRank, movedForward: true };
      continue; // moved from outside the window into it — strict forward movement.
    }
    if (beforeRank !== null && afterRank !== null) {
      if (afterRank < beforeRank) {
        checks.dcMovement = { id, before: beforeRank, after: afterRank, movedForward: true };
      } else {
        violations.push(`DC task ${id} did NOT strictly move forward: rank ${beforeRank} → ${afterRank} (expected after < before)`);
      }
    } else {
      violations.push(`DC task ${id}: in the ${beforeRank !== null ? "before" : "neither"} ranking but not the after ranking — cannot assert forward movement`);
    }
  }

  // 4. (b) NEGATIVE CONTROL — same-family non-DC tasks present in BOTH runs keep their RELATIVE
  //    order (the sort's id tie-break is the only axis governing them; a label leak or sort
  //    regression re-orders them). Absolute ranks shift when a DC task is inserted above them —
  //    that is the intended forward movement, not a negative-control violation.
  const family = familyPrefix ? (id) => id.startsWith(familyPrefix) : () => true;
  const beforeNonDc = bRanking.filter((e) => !e.deliveryCritical && family(e.id)).map((e) => e.id);
  const afterNonDc = aRanking.filter((e) => !e.deliveryCritical && family(e.id)).map((e) => e.id);
  // Order each side's non-DC family by rank; keep only ids present in BOTH (a task dropped off the
  // capped window's tail is a cap effect, not a re-rank).
  const afterSet = new Set(afterNonDc);
  const seqBefore = beforeNonDc.filter((id) => afterSet.has(id)).sort((x, y) => bRankOf(x) - bRankOf(y));
  const seqAfter = afterNonDc.filter((id) => bById.has(id) && !bById.get(id).deliveryCritical).sort((x, y) => aRankOf(x) - aRankOf(y));
  checks.negativeControl = { family: familyPrefix || "*", beforeCount: beforeNonDc.length, afterCount: afterNonDc.length };
  if (seqBefore.length > 1 || seqAfter.length > 1) {
    const relOrderViolation = seqBefore.length !== seqAfter.length || seqBefore.some((id, i) => seqAfter[i] !== id);
    if (relOrderViolation) {
      violations.push(`negative control: same-family non-DC relative order changed — before [${seqBefore.join(", ")}] vs after [${seqAfter.join(", ")}] (expected identical)`);
    }
  }

  // 5. (c) blocking_suite stays ABOVE delivery_critical — in the after ranking every suite-blocker
  //    must rank before every DC task (the first axis is never demoted).
  const sbRanks = aRanking.filter((e) => e.suiteBlocking).map((e) => e.rank);
  const dcRanks = aRanking.filter((e) => e.deliveryCritical).map((e) => e.rank);
  checks.suiteBlockingAboveDC = { suiteBlocking: sbRanks.length, deliveryCritical: dcRanks.length };
  if (sbRanks.length > 0 && dcRanks.length > 0) {
    const maxSb = Math.max(...sbRanks);
    const minDc = Math.min(...dcRanks);
    if (!(maxSb < minDc)) {
      violations.push(`blocking_suite does NOT sit above delivery_critical in the after ranking: max suiteBlocking rank ${maxSb} >= min DC rank ${minDc}`);
    }
  }

  return { ok: violations.length === 0, reason: violations, checks };
}

function main(argv) {
  const args = argv.slice(2);
  let beforePath = null;
  let afterPath = null;
  let dcId = null;
  let familyPrefix = null;
  let jsonOut = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--before") beforePath = args[++i];
    else if (args[i] === "--after") afterPath = args[++i];
    else if (args[i] === "--dc-id") dcId = args[++i];
    else if (args[i] === "--family-prefix") familyPrefix = args[++i];
    else if (args[i] === "--json") jsonOut = true;
    else if (args[i] === "--help" || args[i] === "-h") {
      process.stdout.write("usage: ac36-sortkey-criterion-check.ts --before <json> --after <json> [--dc-id <id>] [--family-prefix <prefix>] [--json]\n");
      return 0;
    } else {
      process.stderr.write(`ac36-sortkey-criterion-check: unknown argument "${args[i]}"\n`);
      return 2;
    }
  }
  if (!beforePath || !afterPath) {
    process.stderr.write("ac36-sortkey-criterion-check: --before <file> and --after <file> are required\n");
    return 2;
  }
  let before;
  let after;
  try {
    before = JSON.parse(fs.readFileSync(beforePath, "utf8"));
    after = JSON.parse(fs.readFileSync(afterPath, "utf8"));
  } catch (e) {
    process.stderr.write(`ac36-sortkey-criterion-check: could not read/parse an input JSON: ${e.message}\n`);
    return 2;
  }
  const result = checkCriterion2({ before, after, dcId, familyPrefix });
  if (result.ok) {
    const m = result.checks.dcMovement;
    const moved = m ? `DC ${m.id} ${m.before === null ? "outside→" : `${m.before}→`}${m.after}` : "DC moved forward";
    return emitPass(`AC36 判据② mechanically verified: ${moved}; negative control (${result.checks.negativeControl.afterCount} same-family non-DC) unchanged; blocking_suite above DC`, result, { json: jsonOut });
  }
  if (!jsonOut) {
    for (const r of result.reason) process.stdout.write(`  - ${r}\n`);
  }
  return emitFail(`AC36 判据② violated — ${result.reason.length} reason(s)`, result, { json: jsonOut });
}

if (isDirectEntry(import.meta)) {
  process.exitCode = main(process.argv);
}
