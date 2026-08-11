// plugin/scripts/ac36-sortkey-criterion-check.ts — the AC36 criterion ② MECHANICAL CHECKER
// (tasks/gap-ac36-recommended-exposes-sort-key AC3; criterion source
// orchestration/manager-phase-goal.md AC36 判据② = the delivery-critical priority axis).
//
// PROBLEM IT FIXES: AC36 criterion ② — "打了 delivery-critical label 的任务在 --json 的 recommended 里
// 位次严格前移；负控制：不打 label 的同族任务位次不变；blocking_suite 仍在 delivery-critical 之上" — was NOT
// mechanically checkable: slot-refill --json's `recommended` was a plain STRING array that exposed no
// sort field, so criterion ② could only be verified by a human running the CLI twice and eyeballing
// the before/after positions (the C17 / AC41-3 "自述" shape this task closes).
//
// WHAT IT DOES: reads the `ranking` array slot-refill now emits alongside `recommended` — each entry
// is { id, rank, axis, deliveryCritical, suiteBlocking } — and mechanically asserts from ONE run that
// the ranking IS the sort key (blocking_suite desc, delivery_critical desc, id asc) — the exact
// candidates.sort in slot-refill.ts. The monotonic key check implies all THREE criterion-② legs, and
// a violation is CLASSIFIED to the leg it breaks (the named problem prefix IS the leg):
//   (a) delivery-critical strictly forward — within the same blocking_suite status, every DC entry
//       ranks before every non-DC entry (the DC axis moves a labeled task ahead of every same-suite-
//       status unlabeled sibling that id-sorted before it). A NON-DC suite-blocker legitimately ranks
//       above a DC task — that is the blocking_suite axis, leg (c), not a (a) violation;
//   (b) negative control: same-family non-DC unchanged — within the same (blocking_suite, DC) axes
//       the only remaining order is the id tie-break, so same-family unlabeled tasks keep their
//       id-relative positions (their order is never scrambled by a sibling being labeled);
//   (c) blocking_suite above — every suiteBlocking entry ranks before every non-suiteBlocking entry.
// It ALSO accepts an optional `before` baseline ranking (the same fixture/run with the DC labels
// absent) and asserts each delivery-critical task's after-rank < its before-rank — the literal
// "打 label 前 → 后位置严格减小" reading, still mechanical (no human eyeballing).
//
// FAIL-CLOSED: a malformed ranking (non-array, missing a required key, ranks not a 0..n-1
// permutation of the array indices, ids not unique) reports ok:false with a named problem — a checker
// that cannot read the evidence must never silently pass.
//
// The core `checkCriterion2` is a PURE function (exported + unit-tested in slot-refill.test.mjs);
// main() is a thin CLI. It is a DETECTOR, not a gate: it never writes tasks/**, never mutates state.
//
// Run:
//   node --experimental-strip-types plugin/scripts/ac36-sortkey-criterion-check.ts --root <repo>
//       [--cap <n>] [--in-flight <id1,id2>] [--before <baseline.json>] [--json-input <file>] [--json]
//   --root <repo>        run slot-refill's analyzeSlotRefill against the real store and check its ranking.
//   --before <file>      a JSON baseline to compare against: either a slot-refill --json object with a
//                        `ranking` field, or a bare ranking ARRAY. If given, each delivery-critical
//                        task present in both rankings must have after.rank < before.rank.
//   --json-input <file>  instead of running against --root, read the AFTER ranking from a JSON file
//                        (slot-refill --json object or bare ranking array) — fixture/testing seam.
//   --json               emit the result object (already JSON) — accepted for Contract parity.
//
// Exit: 0 when ok:true, 1 when ok:false (a criterion violation or a malformed ranking).

import fs from "node:fs";
import path from "node:path";
import { isDirectEntry } from "./gate-script-base.ts";
import { analyzeSlotRefill, FIXED_DISPATCH_CAP } from "./slot-refill.ts";
import { findRepoRoot } from "./touches-orthogonality-check.ts";
import { POOL_FLOOR_MULT_DEFAULT } from "./ready-pool-check.ts";

// ── the pure criterion-② checker ───────────────────────────────────────────────────────────────────

/** Sort key of a ranking entry, in ascending priority order (0 = highest priority rank):
 *  blocking_suite (0) > delivery_critical (1) > id order (2..). Mirrors slot-refill.ts
 *  candidates.sort: (blocking_suite, delivery_critical, id). */
function keyOf(e) {
  return [e.suiteBlocking ? 0 : 1, e.deliveryCritical ? 0 : 1, String(e.id)];
}

/** Validate the ranking SHAPE (fail-closed: a checker that cannot read the evidence never passes). */
function validateRanking(ranking) {
  const problems = [];
  if (!Array.isArray(ranking)) return { ok: false, problems: ["ranking is not an array"] };
  const seen = new Set();
  for (let i = 0; i < ranking.length; i++) {
    const e = ranking[i];
    if (!e || typeof e !== "object") {
      problems.push(`ranking[${i}] is not an object`);
      continue;
    }
    for (const k of ["id", "rank", "axis", "deliveryCritical", "suiteBlocking"]) {
      if (!(k in e)) problems.push(`ranking[${i}] missing required key "${k}"`);
    }
    if (typeof e.id !== "string" || e.id.length === 0) problems.push(`ranking[${i}] id must be a non-empty string`);
    if (typeof e.rank !== "number" || e.rank !== i) problems.push(`ranking[${i}] rank ${JSON.stringify(e.rank)} must equal its array index ${i}`);
    if (seen.has(e.id)) problems.push(`duplicate id in ranking: ${e.id}`);
    seen.add(e.id);
    if (typeof e.deliveryCritical !== "boolean") problems.push(`ranking[${i}] deliveryCritical must be a boolean`);
    if (typeof e.suiteBlocking !== "boolean") problems.push(`ranking[${i}] suiteBlocking must be a boolean`);
    if (!["blocking_suite", "delivery_critical", "id"].includes(e.axis)) {
      problems.push(`ranking[${i}] axis "${e.axis}" not one of blocking_suite|delivery_critical|id`);
    }
    // axis consistency: the dominant axis must match the flags (a suite-blocking entry is reported
    // as blocking_suite; a non-suite delivery-critical entry as delivery_critical; else id).
    const expectedAxis = e.suiteBlocking ? "blocking_suite" : e.deliveryCritical ? "delivery_critical" : "id";
    if (e.axis !== expectedAxis) {
      problems.push(`ranking[${i}] axis "${e.axis}" inconsistent with flags suiteBlocking=${e.suiteBlocking} deliveryCritical=${e.deliveryCritical} (expected "${expectedAxis}")`);
    }
  }
  return { ok: problems.length === 0, problems };
}

/**
 * Mechanically assert AC36 criterion ② from a slot-refill `ranking` array (each entry
 * { id, rank, axis, deliveryCritical, suiteBlocking }). Returns { ok, problems, ... }.
 *
 * CORE: the ranking must be sorted by the EXACT slot-refill sort key — (blocking_suite desc,
 * delivery_critical desc, id asc). A violation is CLASSIFIED to the criterion leg it breaks:
 *   (a) DELIVERY-CRITICAL STRICTLY FORWARD — within the same blocking_suite status, every DC entry
 *       ranks before every non-DC entry (the DC axis moves a labeled task ahead of every same-suite-
 *       status unlabeled sibling that id-sorted before it). A NON-DC suite-blocker legitimately ranks
 *       above a DC task — that is leg (c), not a (a) violation.
 *   (b) NEGATIVE CONTROL: SAME-FAMILY NON-DC UNCHANGED — within the same (blocking_suite, DC) axes
 *       the only order left is the id tie-break, so same-family unlabeled tasks keep their
 *       id-relative positions (never scrambled by a sibling being labeled).
 *   (c) BLOCKING_SUITE ABOVE — every suiteBlocking entry ranks before every non-suiteBlocking entry.
 *   (optional, when `before` is given) STRICT MOVE — for each delivery-critical task present in both
 *       rankings, after.rank < before.rank ("打 label 前 → 后位置严格减小").
 *
 * Empty ranking ⇒ ok:true (no entries, nothing to violate) — the caller decides whether an empty
 * recommended is itself a problem.
 */
export function checkCriterion2(after, { before } = {}) {
  const problems = [];
  const shape = validateRanking(after);
  if (!shape.ok) return { ok: false, problems: shape.problems, entryCount: 0, dcCount: 0, suiteCount: 0 };

  const suiteRanks = after.map((e, i) => (e.suiteBlocking ? i : -1)).filter((i) => i >= 0);
  const dcRanks = after.map((e, i) => (e.deliveryCritical ? i : -1)).filter((i) => i >= 0);

  // THE CORE ASSERTION — the ranking is sorted by the EXACT slot-refill sort key
  // (blocking_suite desc, delivery_critical desc, id asc). For every ADJACENT pair the key must be
  // non-decreasing (0 = highest priority). This ONE monotonic check implies all three criterion-②
  // legs, because the sort key IS the mechanism:
  //   (c) blocking_suite above      — key[0] 0 (suite) before 1 (non-suite);
  //   (a) DC strictly forward       — within the same key[0], key[1] 0 (DC) before 1 (non-DC), so a
  //                                   labeled task ranks before every same-suite-status non-DC task;
  //   (b) negative control          — within the same (key[0], key[1]) group only id order is left,
  //                                   so same-family unlabeled tasks keep their id-relative positions.
  // When an adjacent pair violates the key, the problem is CLASSIFIED to the criterion leg it breaks:
  // key[0] inversion ⇒ blocking_suite above; else key[1] inversion ⇒ delivery-critical strictly
  // forward; else (id not ascending within the same axes) ⇒ negative control. The three named
  // problem prefixes ARE the three criterion legs, so a failing run names exactly which leg broke.
  for (let i = 1; i < after.length; i++) {
    const prev = after[i - 1];
    const cur = after[i];
    const a = keyOf(prev);
    const b = keyOf(cur);
    const aBeforeB =
      a[0] < b[0] ||
      (a[0] === b[0] && a[1] < b[1]) ||
      (a[0] === b[0] && a[1] === b[1] && String(prev.id) < String(cur.id));
    if (!aBeforeB) {
      if (a[0] > b[0]) {
        problems.push(
          `blocking_suite above: suite-blocking task "${prev.id}" ranks before non-suite "${cur.id}" ` +
            `(key ${a.join(",")} → ${b.join(",")}) — a non-suite task is not below every suite task`,
        );
      } else if (a[1] > b[1]) {
        problems.push(
          `delivery-critical strictly forward: delivery-critical task "${cur.id}" ranks AFTER non-DC "${prev.id}" ` +
            `(key ${a.join(",")} → ${b.join(",")}) — the DC axis did not move it ahead of the same-suite-status non-DC sibling`,
        );
      } else {
        problems.push(
          `negative control: same-family unlabeled order changed — "${prev.id}" before "${cur.id}" ` +
            `(key ${a.join(",")} → ${b.join(",")}) — not the pure id tie-break within the same axes`,
        );
      }
    }
  }

  // Optional before/after strict move ("打 label 前 → 后位置严格减小").
  if (before) {
    const beforeShape = validateRanking(before);
    if (!beforeShape.ok) {
      problems.push(`baseline (before) ranking invalid: ${beforeShape.problems.join("; ")}`);
    } else {
      const beforeRank = new Map(before.map((e) => [e.id, e.rank]));
      for (const e of after) {
        if (e.deliveryCritical && beforeRank.has(e.id)) {
          const bRank = beforeRank.get(e.id);
          if (e.rank >= bRank) {
            problems.push(
              `strict move: delivery-critical task "${e.id}" rank ${e.rank} is NOT strictly less than ` +
                `its before-label rank ${bRank}`,
            );
          }
        }
      }
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    entryCount: after.length,
    dcCount: dcRanks.length,
    suiteCount: suiteRanks.length,
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────

function readRankingFromFile(file) {
  const raw = fs.readFileSync(file, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.ranking) ? parsed.ranking : null;
}

function main(argv) {
  let root = null;
  let cap = FIXED_DISPATCH_CAP;
  let floorMult = POOL_FLOOR_MULT_DEFAULT;
  let inFlightIds = [];
  let beforeFile = null;
  let jsonInputFile = null;
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") root = args[++i];
    else if (args[i] === "--cap") cap = Number(args[++i]);
    else if (args[i] === "--floor-mult") floorMult = Number(args[++i]);
    else if (args[i] === "--in-flight") inFlightIds = String(args[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (args[i] === "--before") beforeFile = args[++i];
    else if (args[i] === "--json-input") jsonInputFile = args[++i];
    else if (args[i] === "--json") { /* output is always JSON — accepted for Contract parity */ }
  }

  const rootDir = root ? path.resolve(root) : findRepoRoot(process.cwd());
  let afterRanking = null;
  let fromStore = null;
  if (jsonInputFile) {
    afterRanking = readRankingFromFile(jsonInputFile);
    if (!afterRanking) {
      process.stdout.write(`${JSON.stringify({ ok: false, problems: [`--json-input ${jsonInputFile} has no ranking array`] }, null, 2)}\n`);
      return 1;
    }
  } else {
    const readTasks = (ids) => {
      const out = [];
      for (const id of ids) {
        const file = path.join(rootDir, "tasks", `${id}.md`);
        if (!fs.existsSync(file)) continue;
        out.push({ id, body: fs.readFileSync(file, "utf8") });
      }
      return out;
    };
    const inFlight = readTasks(inFlightIds);
    fromStore = analyzeSlotRefill({
      tasksDir: path.join(rootDir, "tasks"),
      root: rootDir,
      cap,
      floorMult,
      inFlight,
    });
    afterRanking = fromStore.ranking || [];
  }

  let before = null;
  if (beforeFile) before = readRankingFromFile(beforeFile);

  const result = checkCriterion2(afterRanking, before ? { before } : {});
  const out = {
    ...result,
    root: rootDir,
    criterion: "ac36-② delivery-critical 位次严格前移 / 同族非 DC 位次不变 / blocking_suite 之上",
    ranking: afterRanking,
    has_before_baseline: Boolean(before),
  };
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  return result.ok ? 0 : 1;
}

if (isDirectEntry(import.meta)) {
  process.exitCode = main(process.argv);
}
