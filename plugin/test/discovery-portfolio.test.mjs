// @test-group engine
// Tests for the DISCOVERY PORTFOLIO value ledger (task
// gap-discovery-portfolio-value-evidence-ledger, AC1 a–g).
//
// The contract under test is that VALUE IS NOT ASSERTABLE. Three fields decide whether a finding counts
// as net-new engineering value — the fix's landing, the recurrence, the cost — and none of them may be
// taken from the caller's word: the landing is read from git, the recurrence from the evidence store,
// the cost from recorded usage × the gateway's published rates. A caller-supplied value that disagrees
// is REFUSED, and "could not measure" is its own value (`null`), never `0`/`false` (硬规则 3b/4).
//
// The anti-inflation property is the point of the whole module, so it is tested in both directions:
// adding refuted records cannot move `net_new_value` (AC g), and the assertion in (g) is on the ABSOLUTE
// value — which is what makes the mutation control ("count supported findings instead of landed fixes")
// go red there rather than staying quietly green.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import {
  PORTFOLIO_REL, PORTFOLIO_KIND, PORTFOLIO_RATING_KIND, ORIGINS, EVIDENCE_LEVELS, OUTCOMES,
  RATING_VALUES, RATING_ACTORS, REQUIRED_INPUT_FIELDS, REQUIRED_RECORD_FIELDS, DONE_SUBJECT_RE,
  REAL_BACKFILL_ROWS_2026_10_12,
  componentOf, normalizeComponents, sameComponentSet, normalizeClaim,
  validateFindingInput, validateFindingRecord, deriveFixLandedCommit, deriveRecurred, deriveCost,
  gatewayRatesFromResponse, readGatewayKey, resolveOriginRef, taskExistsOnBranch, taskTouchesOnBranch,
  findDuplicate, ingestFinding, rateFinding, readPortfolio, valueMetrics, portfolioFile, backfill,
} from "../../docs/analysis/discovery-portfolio.mjs";
import { carrierFile, resolveCarrierRoot } from "../../docs/analysis/discovery-experience-ledger.mjs";

const tmpDirs = [];
after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid",
};
const git = (root, ...args) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8", env: GIT_ENV }).trim();

/** A REAL git repo on a `develop` branch: the carriers resolve through `git rev-parse --git-common-dir`
 *  to the SHARED checkout, so a bare directory is not a usable fixture root (an unresolvable shared
 *  checkout is REFUSED by design, not silently redirected to the caller's root). */
function mkRepo({ tasks = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "discovery-portfolio-"));
  tmpDirs.push(root);
  execFileSync("git", ["init", "-q", root], { stdio: "ignore", env: GIT_ENV });
  const shas = {};
  for (const [id, touches] of Object.entries(tasks)) {
    const body = `---\nid: ${id}\nstatus: done\n---\n## Touches\n${touches.map((t) => `- ${t}`).join("\n")}\n`;
    fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
    fs.writeFileSync(path.join(root, "tasks", `${id}.md`), body, "utf8");
    git(root, "add", `tasks/${id}.md`);
    git(root, "commit", "-q", "-m", `tasks: 翻 ${id} done（driver 机械 fan-in）`);
    shas[id] = git(root, "rev-parse", "HEAD");
  }
  // A done-looking commit that is NOT a landing: the marker is the subject WORD, so a task_write or a
  // todo→ready must not be read as a landing (the negative control for `DONE_SUBJECT_RE`).
  if (Object.keys(tasks).length) {
    fs.appendFileSync(path.join(root, "tasks", `${Object.keys(tasks)[0]}.md`), "\n<!-- touched -->\n", "utf8");
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "tasks: task_write by cli:1");
  }
  git(root, "branch", "-M", "develop");
  return { root, shas };
}

/** Append records to a fixture carrier under the repo's own `.quay/` (the shared checkout IS the repo
 *  here — the resolver names it, this never hardcodes a path). */
function writeCarrier(root, rel, records) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  return file;
}

/** The fixture's carriers: one routine run, one Experiment, and one LATER outcome on the same component
 *  set as F-A (so the recurrence derivation has something real to find). */
function writeCarriers(root) {
  writeCarrier(root, ".quay/routine-findings.jsonl", [
    { kind: "scan-round", runId: "run-fixture-1", ts: "2020-01-01T00:00:00Z" },
    { kind: "finding", runId: "run-fixture-1", findingId: "twin-a", files: ["src/a.ts:12", "src/a2.ts:40"], ts: "2020-01-01T00:00:00Z" },
  ]);
  writeCarrier(root, ".quay/discovery-experience-ledger.jsonl", [
    {
      kind: "experience", case_id: "EXP-fixture0000000000", ts: "2020-01-01T00:00:00Z",
      role: "found-unresolved", reported_by: "system",
      authored_by: { actor: "ingester", detail: "fixture" },
      source_ref: "outcome-fixture0000000000", components: ["src/w.ts"],
      evidence: [{ ref: "outcome-fixture0000000000", sha256: "a".repeat(64) }],
      summary: "E-FIX cluster 1: fixture summary long enough to be a summary",
    },
  ]);
  writeCarrier(root, ".quay/architecture-evidence-store.jsonl", [
    { kind: "outcome", id: "outcome-later0000000000", experiment_ref: "fixture", verdict: "supported",
      ts: "2099-01-01T00:00:00Z", subject_files: ["src/a.ts"] },
  ]);
}

const RATES = Object.freeze({ model_group: "v4.1flash-anthropic", input_cost_per_token: 3e-7, output_cost_per_token: 1.2e-6 });

/** One complete, valid finding INPUT — the baseline every variant below is derived from. `origin` and
 *  `origin_ref` are supplied per call so each variant resolves in the carrier it means to. */
const input = (over = {}) => ({
  finding_id: "F-A",
  origin: "autonomous-routine",
  origin_ref: "run-fixture-1",
  evidence_level: "production-open",
  method_ref: null,
  claim: "alpha finding claim",
  outcome: "supported",
  fix_task: null,
  human_rating: null,
  ...over,
});

/** The fixture's five findings, ingested in order: A/B land fixes and are valuable; C is supported with
 *  no fix (not value); D is refuted (not value); E duplicates A (not value). */
function seed(root, { rates = RATES } = {}) {
  const rows = [
    input({ finding_id: "F-A", fix_task: "t-fix-a" }),
    input({ finding_id: "F-B", origin: "mechanical-instrument", origin_ref: "enum-surface-parity-check.ts", evidence_level: "independent", claim: "beta finding claim", fix_task: "t-fix-b", components: ["src/b.ts"] }),
    input({ finding_id: "F-C", origin: "operator", origin_ref: "t-fix-a", evidence_level: "teaching", claim: "gamma finding claim (supported, no fix filed)" }),
    input({ finding_id: "F-D", origin: "autonomous-experiment", origin_ref: "E-FIX cluster 1", evidence_level: "independent", claim: "delta finding claim (refuted)", outcome: "refuted" }),
    input({ finding_id: "F-E", claim: "alpha finding claim", fix_task: "t-fix-a" }),
  ];
  const out = [];
  for (const r of rows) out.push(ingestFinding(root, r, { rates }));
  return out;
}

const mkTmp = () => mkRepo({ tasks: { "t-fix-a": ["src/a.ts"], "t-fix-b": ["src/b.ts"], "t-fix-c": ["src/c.ts"] } });

test("(a) fix_landed_commit is READ FROM GIT, never taken from the caller", () => {
  const { root, shas } = mkTmp();
  writeCarriers(root);
  const r = ingestFinding(root, input({ fix_task: "t-fix-a" }), { rates: RATES });
  assert.equal(r.ok, true, JSON.stringify(r.reasons));

  const [rec] = readPortfolio(root).records;
  assert.equal(rec.fix_landed_commit, shas["t-fix-a"], "the landing is the done commit's own sha");
  assert.match(rec.fix_landed_reason, /DONE_SUBJECT_ON_develop/);
  // The extra `task_write` commit came AFTER the done flip and does not contain the marker word, so the
  // LAST done-subject commit is still the flip itself — not "whatever touched the file last".
  assert.equal(git(root, "rev-parse", "develop"), git(root, "rev-parse", "HEAD"));
  assert.notEqual(rec.fix_landed_commit, git(root, "rev-parse", "HEAD"));

  // A task with no done commit is `null` + a reason — NOT an error, and NOT a landing.
  const noFix = ingestFinding(root, input({ finding_id: "F-NOFIX", origin_ref: "run-fixture-1", components: ["src/none.ts"], claim: "a finding with no fix task at all" }), { rates: RATES });
  assert.equal(noFix.ok, true, JSON.stringify(noFix.reasons));
  const nf = readPortfolio(root).records.find((x) => x.finding_id === "F-NOFIX");
  assert.equal(nf.fix_landed_commit, null);
  assert.equal(nf.fix_landed_reason, "NO_FIX_TASK");
});

test("(b) a caller-supplied landing that DISAGREES with git is refused; an agreeing one is accepted", () => {
  const { root, shas } = mkTmp();
  writeCarriers(root);
  const bad = ingestFinding(root, input({ fix_task: "t-fix-a", fix_landed_commit: "deadbeef".repeat(5) }), { rates: RATES });
  assert.equal(bad.ok, false);
  assert.equal(bad.appended, false);
  assert.ok(bad.reasons.some((x) => x.startsWith("DERIVED_DISAGREES:fix_landed_commit:")), JSON.stringify(bad.reasons));
  assert.equal(readPortfolio(root).records.length, 0, "nothing is written on refusal");

  // The AGREEMENT arm proves the refusal above is a check and not a blanket ban (硬规则 3: a predicate
  // that refuses everything is indistinguishable from one that works).
  const good = ingestFinding(root, input({ fix_task: "t-fix-a", fix_landed_commit: shas["t-fix-a"] }), { rates: RATES });
  assert.equal(good.ok, true, JSON.stringify(good.reasons));

  // Ditto for `recurred`: the fixture has a LATER outcome on F-A's component set, so `false` disagrees.
  const badRec = ingestFinding(root, { ...input({ finding_id: "F-R", components: ["src/a.ts"], claim: "another claim about src/a.ts" }), recurred: false }, { rates: RATES });
  assert.equal(badRec.ok, false);
  assert.ok(badRec.reasons.some((x) => x === "DERIVED_DISAGREES:recurred:caller=false-derived=true"), JSON.stringify(badRec.reasons));
});

test("(c) a duplicate (same component set AND claim) gets duplicate_of and leaves net_new_value", () => {
  const { root } = mkTmp();
  writeCarriers(root);
  seed(root);
  const recs = readPortfolio(root).records;
  const a = recs.find((r) => r.finding_id === "F-A");
  const e = recs.find((r) => r.finding_id === "F-E");
  assert.equal(e.duplicate_of, "F-A");
  assert.equal(a.duplicate_of, null, "the FIRST occurrence is the original, not the duplicate");

  const m = valueMetrics(recs);
  assert.deepEqual(m.zero_or_negative.duplicates, ["F-E"]);
  assert.deepEqual(m.net_new_value.finding_ids, ["F-A", "F-B"]);
  assert.equal(m.net_new_value.total, 2);
  // The duplicate rule is over the SET, so a different input ORDER is the same set — and a same-set,
  // different-claim finding is NOT a duplicate (otherwise distinct findings would silently collapse).
  assert.equal(sameComponentSet(["src/a.ts:1", "src/b.ts"], ["src/b.ts", "src/a.ts:999"]), true);
  assert.equal(componentOf("src/a.ts:999"), "src/a.ts");
  assert.equal(normalizeClaim("  Two   Words "), "two words");
  assert.equal(findDuplicate(recs, { components: ["src/a.ts"], claim: "beta finding claim" }), null);
});

test("(d) a `noise` rating reduces net_new_value, and is not the same value as `unrated`", () => {
  const { root } = mkTmp();
  writeCarriers(root);
  seed(root);
  const before = valueMetrics(readPortfolio(root).records);
  assert.equal(before.net_new_value.total, 2);
  assert.deepEqual(before.ratings, { rated: 0, unrated: 5 });

  const r = rateFinding(root, { finding_id: "F-B", value: "noise", by: "session-2026-10-12-operator", actor: "operator-session" });
  assert.equal(r.ok, true, JSON.stringify(r.reasons));
  const after = valueMetrics(readPortfolio(root).records);
  assert.equal(after.net_new_value.total, 1, "a noise rating removes value");
  assert.deepEqual(after.zero_or_negative.noise_rated, ["F-B"]);
  assert.deepEqual(after.net_new_value.finding_ids, ["F-A"]);
  assert.deepEqual(after.ratings, { rated: 1, unrated: 4 });

  // A rating is an APPEND-ONLY line: the finding's own record on disk is untouched, and the last rating
  // wins on read — so "when was this rated, and by whom" stays answerable.
  assert.equal(readPortfolio(root).ratings.length, 1);
  assert.equal(readPortfolio(root).ratings[0].kind, PORTFOLIO_RATING_KIND);
  rateFinding(root, { finding_id: "F-B", value: "high", by: "session-2026-10-12-operator", actor: "operator-session" });
  assert.equal(valueMetrics(readPortfolio(root).records).net_new_value.total, 2);
});

test("(e) missing usage ⇒ cost:null and an unmeasured count; recorded usage × gateway rates ⇒ USD", () => {
  const { root } = mkTmp();
  writeCarriers(root);
  seed(root);
  const m = valueMetrics(readPortfolio(root).records);
  assert.equal(m.cost.unmeasured, 5, "every unmeasured finding is COUNTED, never dropped");
  assert.equal(m.cost.measured, 0);
  assert.equal(m.cost.usd_gateway_total, null, "no measurement is not $0");
  assert.equal(m.cost.cost_per_valuable_finding, null);
  assert.equal(m.cost.cost_per_valuable_finding_reason, "NO_MEASURED_COST");
  const a = readPortfolio(root).records.find((r) => r.finding_id === "F-A");
  assert.equal(a.cost, null);
  assert.equal(a.cost_reason, "NO_USAGE_RECORDED");

  // The non-vacuous arm: a RECORDED usage with the gateway's rates produces a number, and the cache
  // tokens are billed as input (the formula the method-regression report measured).
  const usage = { model_group: "v4.1flash-anthropic", model_calls: 72, input_tokens: 1000, output_tokens: 2000, cache_read_tokens: 5000 };
  const u = ingestFinding(root, input({ finding_id: "F-COST", components: ["src/cost.ts"], claim: "a finding whose usage was actually recorded", usage }), { rates: RATES });
  assert.equal(u.ok, true, JSON.stringify(u.reasons));
  const cost = readPortfolio(root).records.find((r) => r.finding_id === "F-COST").cost;
  assert.equal(cost.billed_input_tokens, 6000);
  assert.equal(cost.usd_gateway, Math.round((6000 * 3e-7 + 2000 * 1.2e-6) * 1e6) / 1e6);
  const m2 = valueMetrics(readPortfolio(root).records);
  assert.equal(m2.cost.measured, 1);
  assert.equal(m2.cost.unmeasured, 5);
  assert.deepEqual(m2.cost.unmeasured_finding_ids, ["F-A", "F-B", "F-C", "F-D", "F-E"]);

  // Pure arms: an unreadable gateway / a mismatched model group are their OWN refusals, never a $0 cost.
  assert.equal(deriveCost(usage, null).reason, "GATEWAY_RATES_UNAVAILABLE");
  assert.match(deriveCost({ ...usage, model_group: "other-group" }, RATES).reason, /USAGE_MODEL_GROUP_MISMATCH/);
  assert.equal(deriveCost(undefined, RATES).reason, "USAGE_NOT_RECORDED");
  assert.deepEqual(gatewayRatesFromResponse({ data: [{ model_group: "g", input_cost_per_token: 1e-6, output_cost_per_token: 2e-6 }] }, "g").rates,
    { model_group: "g", input_cost_per_token: 1e-6, output_cost_per_token: 2e-6 });
  assert.equal(gatewayRatesFromResponse({ data: [] }, "g").ok, false);
  assert.equal(readGatewayKey("/nonexistent/key/file").ok, false);
});

test("(f) a worker's rateFinding is refused; only an operator session may rate", () => {
  const { root } = mkTmp();
  writeCarriers(root);
  seed(root);

  const worker = rateFinding(root, { finding_id: "F-A", value: "high", by: "task-worker-1", actor: "task-worker" });
  assert.equal(worker.ok, false);
  assert.equal(worker.appended, false);
  assert.ok(worker.reasons.some((x) => x.startsWith("RATING_BY_NON_HUMAN:task-worker")), JSON.stringify(worker.reasons));
  assert.equal(readPortfolio(root).ratings.length, 0, "a refused rating writes nothing");

  // An ABSENT actor is its own refusal — never defaulted to the human value (that default is the defect).
  const anon = rateFinding(root, { finding_id: "F-A", value: "high", by: "someone" });
  assert.equal(anon.ok, false);
  assert.ok(anon.reasons.some((x) => x.startsWith("RATING_ACTOR_MISSING:")), JSON.stringify(anon.reasons));

  // And ingest cannot smuggle one in as a field of the finding.
  const smuggled = ingestFinding(root, { ...input({ finding_id: "F-S" }), human_rating: { value: "high", by: "worker", ts: "2026-10-12T00:00:00Z" } }, { rates: RATES });
  assert.equal(smuggled.ok, false);
  assert.ok(smuggled.reasons.some((x) => x.startsWith("RATING_AT_INGEST_NOT_ALLOWED")), JSON.stringify(smuggled.reasons));

  const human = rateFinding(root, { finding_id: "F-A", value: "high", by: "session-2026-10-12-operator", actor: "operator-session" });
  assert.equal(human.ok, true, JSON.stringify(human.reasons));
  assert.equal(readPortfolio(root).records.find((r) => r.finding_id === "F-A").human_rating.by, "session-2026-10-12-operator");
});

test("(g) adding 10 refuted records leaves net_new_value unchanged (the anti-inflation control)", () => {
  const { root } = mkTmp();
  writeCarriers(root);
  seed(root);
  const before = valueMetrics(readPortfolio(root).records).net_new_value;
  // ⛔ ABSOLUTE, not just "unchanged": under the mutation (count supported findings instead of landed
  // fixes) the same fixture yields 3 here, and this assertion is what turns that mutation RED.
  assert.equal(before.total, 2);
  assert.deepEqual(before.by_origin, { "autonomous-routine": 1, "mechanical-instrument": 1 });

  for (let i = 0; i < 10; i++) {
    const r = ingestFinding(root, input({
      finding_id: `F-REFUTED-${i}`, components: [`src/refuted-${i}.ts`],
      claim: `refuted finding number ${i} about a component set of its own`, outcome: "refuted",
    }), { rates: RATES });
    assert.equal(r.ok, true, JSON.stringify(r.reasons));
  }
  const after = valueMetrics(readPortfolio(root).records);
  assert.equal(after.context.findings, 15, "the CONTEXT count does move — that is exactly why it is not the headline");
  assert.equal(after.net_new_value.total, 2);
  assert.deepEqual(after.net_new_value.by_origin, before.by_origin);
  assert.equal(after.zero_or_negative.refuted.length, 11);
});

test("an origin_ref that resolves in no carrier is refused; a resolvable one names its carrier", () => {
  const { root } = mkTmp();
  writeCarriers(root);
  const bad = ingestFinding(root, input({ finding_id: "F-X", origin_ref: "run-fixture-DOES-NOT-EXIST" }), { rates: RATES });
  assert.equal(bad.ok, false);
  assert.ok(bad.reasons.some((x) => x.startsWith("ORIGIN_REF_UNRESOLVED:")), JSON.stringify(bad.reasons));
  assert.equal(readPortfolio(root).records.length, 0);

  const exp = resolveOriginRef(root, { origin: "autonomous-experiment", origin_ref: "E-FIX cluster 1" });
  assert.equal(exp.ok, true, exp.reason);
  assert.equal(exp.carrier, ".quay/discovery-experience-ledger.jsonl");
  assert.deepEqual(exp.components, ["src/w.ts"]);

  const task = resolveOriginRef(root, { origin: "operator", origin_ref: "t-fix-b" });
  assert.equal(task.ok, true, task.reason);
  assert.equal(task.carrier, "tasks/t-fix-b.md");
  assert.deepEqual(task.components, ["src/b.ts"], "a task's components are its own ## Touches, read from git");

  const inst = resolveOriginRef(root, { origin: "mechanical-instrument", origin_ref: "enum-surface-parity-check.ts" });
  assert.equal(inst.ok, true, inst.reason);
  assert.equal(resolveOriginRef(root, { origin: "mechanical-instrument", origin_ref: "no-such-tool.ts" }).ok, false);
  assert.equal(taskExistsOnBranch(root, "t-fix-a"), true);
  assert.equal(taskExistsOnBranch(root, "t-not-here"), false);
  assert.deepEqual(taskTouchesOnBranch(root, "t-fix-c"), ["src/c.ts"]);
});

test("a re-ingest of the same finding_id is a no-op, not a second record (the carrier is append-only)", () => {
  const { root } = mkTmp();
  writeCarriers(root);
  seed(root);
  const first = ingestFinding(root, input({ finding_id: "F-A", fix_task: "t-fix-a" }), { rates: RATES });
  assert.equal(first.ok, false);
  assert.equal(first.duplicate, true, "the id keys on the FINDING, not on the clock");
  assert.equal(readPortfolio(root).records.length, 5, "nothing was appended");
  // …and `backfill` reports that separately from a real refusal.
  const b = backfill(root, [input({ finding_id: "F-A", fix_task: "t-fix-a" }), input({ finding_id: "F-NEW", components: ["src/new.ts"], claim: "a finding the carrier has never held" })], { rates: RATES });
  assert.deepEqual(b.already_present, ["F-A"]);
  assert.deepEqual(b.ingested, ["F-NEW"]);
  assert.deepEqual(b.refused, []);
  assert.equal(b.ok, true);
});

test("recurred is read from later evidence-store outcomes; an unknown component set ⇒ null, not false", () => {
  const { root } = mkTmp();
  writeCarriers(root);
  const hit = deriveRecurred(root, { components: ["src/a.ts"], since: "2020-01-01T00:00:00Z" });
  assert.equal(hit.recurred, true);
  assert.deepEqual(hit.evidence_outcome_ids, ["outcome-later0000000000"]);
  // A later outcome on an UNRELATED component set is not a recurrence.
  assert.equal(deriveRecurred(root, { components: ["src/zzz.ts"], since: "2020-01-01T00:00:00Z" }).recurred, false);
  // BEFORE the finding, the same outcome is not evidence of a return.
  assert.equal(deriveRecurred(root, { components: ["src/a.ts"], since: "2100-01-01T00:00:00Z" }).recurred, false);
  // Could-not-evaluate is its OWN value (硬规则 3b): no component set, no timestamp, no store.
  assert.deepEqual(deriveRecurred(root, { components: [], since: "2020-01-01T00:00:00Z" }),
    { recurred: null, reason: "NO_COMPONENT_SET", evidence_outcome_ids: [] });
  assert.equal(deriveRecurred(root, { components: ["src/a.ts"], since: null }).recurred, null);
  assert.equal(deriveRecurred(root, { components: ["src/a.ts"], since: "2020-01-01T00:00:00Z" }).recurred === false, false);
  assert.equal(resolveCarrierRoot(root).ok, true);
  assert.equal(carrierFile(root, PORTFOLIO_REL), path.join(root, PORTFOLIO_REL));
  assert.equal(portfolioFile(root), path.join(root, PORTFOLIO_REL));
});

test("the frozen backfill table is well-formed and every row's origin_ref is a resolvable SHAPE", () => {
  assert.equal(REAL_BACKFILL_ROWS_2026_10_12.length, 13);
  assert.equal(new Set(REAL_BACKFILL_ROWS_2026_10_12.map((r) => r.finding_id)).size, 13);
  for (const row of REAL_BACKFILL_ROWS_2026_10_12) {
    assert.deepEqual(validateFindingInput(row), { ok: true, reasons: [] }, row.finding_id);
    assert.ok(ORIGINS.includes(row.origin));
    assert.ok(EVIDENCE_LEVELS.includes(row.evidence_level));
    assert.ok(OUTCOMES.includes(row.outcome));
    // The two fields the reconstruction could not measure stay NULL — the worker never invents them.
    assert.equal(row.human_rating, null, row.finding_id);
    assert.equal(row.usage, undefined, row.finding_id);
  }
  assert.deepEqual(REAL_BACKFILL_ROWS_2026_10_12.filter((r) => r.origin === "autonomous-routine").map((r) => r.finding_id), ["F01", "F02", "F03"]);
  assert.equal(REAL_BACKFILL_ROWS_2026_10_12.filter((r) => r.origin === "autonomous-experiment").length, 4);
  assert.equal(REAL_BACKFILL_ROWS_2026_10_12.filter((r) => r.fix_task === null).length, 2);
  assert.equal(REAL_BACKFILL_ROWS_2026_10_12.find((r) => r.finding_id === "N01").outcome, "refuted");

  // Vocabulary + schema declarations the rest of the module is keyed on.
  assert.deepEqual(RATING_ACTORS, ["operator-session"]);
  assert.deepEqual(RATING_VALUES, ["high", "medium", "low", "noise"]);
  assert.equal(REQUIRED_INPUT_FIELDS.includes("human_rating"), true);
  assert.equal(REQUIRED_RECORD_FIELDS.includes("fix_landed_commit"), true);
  assert.equal(DONE_SUBJECT_RE.test("tasks: 翻 x done（driver 机械 fan-in）"), true);
  assert.equal(DONE_SUBJECT_RE.test("tasks: x todo→ready（promotion-driver 机械晋升）"), false);
  assert.equal(DONE_SUBJECT_RE.test("tasks: x task_write by cli:1"), false);
  assert.equal(DONE_SUBJECT_RE.test("tasks: abandoned") , false);
  assert.deepEqual(normalizeComponents(["b.ts:1", "a.ts", "b.ts:9", "a.ts"]), ["a.ts", "b.ts"]);

  // A malformed candidate is REPORTED, never accepted (a distinct code per cause).
  assert.deepEqual(validateFindingInput(null), { ok: false, reasons: ["RECORD_NOT_OBJECT"] });
  assert.ok(validateFindingInput({ finding_id: "x" }).reasons.includes("SCHEMA_MISSING:origin"));
  assert.ok(validateFindingInput(input({ origin: "nope" })).reasons.includes("ORIGIN_NOT_IN_VOCAB:nope"));
  assert.ok(validateFindingInput(input({ outcome: "nope" })).reasons.includes("OUTCOME_NOT_IN_VOCAB:nope"));
  assert.ok(validateFindingRecord({ ...input({}), ts: "t" }).reasons.length > 0);
  assert.equal(PORTFOLIO_KIND, "portfolio_finding");
  assert.equal(backfill instanceof Function, true);
});
