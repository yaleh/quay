// @test-group engine
// Tests for the DISCOVERY PORTFOLIO value ledger (task
// gap-discovery-portfolio-value-evidence-ledger, AC1 a–g) and for the CAPABILITY COVERAGE MAP built on
// top of it (task gap-discovery-coverage-map-from-findings, AC1 a–d).
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
//
// The COVERAGE MAP's own anti-inflation property is that a case whose answer was known before any tool
// ran can never make a domain look autonomously covered: case (a) asserts a teaching-level finding (of
// AUTONOMOUS origin, with a landed fix — the hardest shape) grades `assisted`, and the AC3 mutation
// control removes the evidence-level clause and watches (a) go red.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import {
  PORTFOLIO_REL, PORTFOLIO_KIND, PORTFOLIO_RATING_KIND, PORTFOLIO_DOMAIN_KIND,
  ORIGINS, EVIDENCE_LEVELS, OUTCOMES, DOMAINS, DOMAIN_LABELS, UNCLASSIFIED, GRADES, ORIGIN_OPERATIONS,
  RATING_VALUES, RATING_ACTORS, REQUIRED_INPUT_FIELDS, REQUIRED_RECORD_FIELDS, DONE_SUBJECT_RE,
  REAL_BACKFILL_ROWS_2026_10_12,
  componentOf, normalizeComponents, sameComponentSet, normalizeClaim,
  validateFindingInput, validateFindingRecord, deriveFixLandedCommit, deriveRecurred, deriveCost,
  gatewayRatesFromResponse, readGatewayKey, resolveOriginRef, taskExistsOnBranch, taskTouchesOnBranch,
  findDuplicate, ingestFinding, rateFinding, readPortfolio, valueMetrics, portfolioFile, backfill,
  assignFindingDomain, coverageMap, autonomousEvidenceFor, methodClaimsDomain, methodTrust,
  NON_CONTRIBUTING_METHOD_STATUSES,
} from "../../docs/analysis/discovery-portfolio.mjs";
import { METHOD_STATUSES } from "../../docs/analysis/discovery-method-registry.mjs";
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
 *  `origin_ref` are supplied per call so each variant resolves in the carrier it means to. `domain` is
 *  `null` by default: an unclassified finding is a legitimate value, and the coverage-map cases below
 *  opt in to a domain explicitly (a guessed domain is exactly what the map refuses). */
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
  domain: null,
  domain_reason: null,
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

/** The coverage-map row for one domain slug — the map returns an ORDERED array (the order the user
 *  named the domains in), so every assertion below goes through this lookup. */
const domainRow = (map, slug) => map.domains.find((r) => r.domain === slug);

/** One fixture METHOD record. The registry validates nothing on READ (`readMethodRegistry` flags rather
 *  than refuses), so a fixture may be minimal — but it is written to the carrier as the registry's own
 *  kind so the coverage map reads it through the real path. */
const methodFixture = (over = {}) => ({
  kind: "method",
  id: `method-${over.method_id ?? "m-fixture"}-v${over.version ?? 1}`,
  method_id: "m-fixture",
  version: 1,
  ts: "2020-01-01T00:00:00Z",
  provenance_evidence: ["outcome-fixture0000000000"],
  // ⛔ The domain is claimed by NAMING it: the registry's applicability fields are free prose, so a
  // literal-name match is the only rule that cannot invent a claim the method never made.
  applicability: { domain_signals: ["state transitions: a carrier written by two writers"], preconditions: ["a shared carrier exists"] },
  operation: { steps: ["read the carrier"], tools: ["readRecords"] },
  expected_invariant: "one writer stays authoritative at every instant",
  falsification: "two writers both land a line for the same generation",
  cost_budget: { max_candidates: 1, max_model_calls: 0, max_wall_ms: 1000 },
  status: "draft",
  retirement_reason: null,
  supersedes: null,
  generalization_evidence: null,
  ...over,
});

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

  // The DOMAIN column (Plan 2) — transcribed from the operator baseline's `dimension`, never re-derived.
  // Every row carries one, each in the vocabulary, each with the reason it was classed that way.
  for (const row of REAL_BACKFILL_ROWS_2026_10_12) {
    assert.ok(DOMAINS.includes(row.domain), `${row.finding_id}: ${String(row.domain)}`);
    assert.ok(typeof row.domain_reason === "string" && row.domain_reason.trim().length >= 8, row.finding_id);
  }
  assert.deepEqual(REAL_BACKFILL_ROWS_2026_10_12.filter((r) => r.domain === "shared-semantics").map((r) => r.finding_id),
    ["F02", "F03", "F04", "F06", "F08", "F10", "F12"]);
  assert.deepEqual(REAL_BACKFILL_ROWS_2026_10_12.filter((r) => r.domain === "writer-checker-contract").map((r) => r.finding_id), ["F01", "F05"]);
  assert.deepEqual(REAL_BACKFILL_ROWS_2026_10_12.filter((r) => r.domain === "config-to-behavior").map((r) => r.finding_id), ["F07", "F11"]);
  assert.deepEqual(REAL_BACKFILL_ROWS_2026_10_12.filter((r) => r.domain === "state-transitions").map((r) => r.finding_id), ["F09"]);
  assert.deepEqual(REAL_BACKFILL_ROWS_2026_10_12.filter((r) => r.domain === "reuse-refutation").map((r) => r.finding_id), ["N01"]);
  // method-trustworthiness has NO row: it is the domain the baseline says only operator audits touch, and
  // none of those audits is a portfolio finding. The map must show that as `none`, not invent a row.
  assert.equal(REAL_BACKFILL_ROWS_2026_10_12.filter((r) => r.domain === "method-trustworthiness").length, 0);
  assert.equal(new Set(REAL_BACKFILL_ROWS_2026_10_12.map((r) => r.domain)).size, 5);

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

// ── the CAPABILITY COVERAGE MAP (task gap-discovery-coverage-map-from-findings, AC1 a–d) ─────────
//
// Coverage is NOT value: a correct refutation is capability without value, and a domain covered only by
// teaching is capability without discovery. Each case below fixes one of those boundaries.

test("(a) coverage: a TEACHING-level finding yields `assisted`, never `autonomous`", () => {
  const { root } = mkTmp();
  writeCarriers(root);
  // ⛔ The hardest shape for the clause, and the one the AC3 mutation control flips: an AUTONOMOUS origin
  // (routine), supported, with a fix that LANDED — everything the `autonomous` grade wants except the
  // evidence level. Only `teaching` stands between it and an autonomous grade, so this assertion is the
  // one that goes red when the evidence-level clause is removed.
  const r = ingestFinding(root, input({
    finding_id: "C-TEACHING", evidence_level: "teaching", fix_task: "t-fix-a",
    domain: "shared-semantics", domain_reason: "two byte-identical copies of one semantic",
  }), { rates: RATES });
  assert.equal(r.ok, true, JSON.stringify(r.reasons));

  const map = coverageMap(root);
  const row = domainRow(map, "shared-semantics");
  assert.equal(row.grade, "assisted", "the answer was known before any tool ran — that is transcription, not discovery");
  assert.deepEqual(row.findings.autonomous_ids, []);
  assert.deepEqual(row.findings.not_autonomous, [{ finding_id: "C-TEACHING", reason: "EVIDENCE_LEVEL_NOT_AUTONOMOUS:teaching" }]);
  assert.deepEqual(map.gap, DOMAINS, "nothing in this fixture is autonomously covered");
  assert.equal(row.findings.by_evidence_level.teaching, 1);

  // …and the neighbouring level is refused for the same reason: learned on one case, applied to a second,
  // is not a blind find either. A pure arm, so the refusal is shown to be a rule and not a `teaching`-only
  // patch. `fix_landed_commit` is the DERIVED field (never an ingest input), and all three arms below carry
  // it, so the ONLY value that differs between them is the evidence level.
  const landed = { ...input({}), fix_landed_commit: "a".repeat(40) };
  assert.equal(autonomousEvidenceFor({ ...landed, evidence_level: "transfer" }).autonomous, false);
  assert.equal(autonomousEvidenceFor({ ...landed, evidence_level: "transfer" }).reason, "EVIDENCE_LEVEL_NOT_AUTONOMOUS:transfer");
  assert.equal(autonomousEvidenceFor({ ...landed, evidence_level: "independent" }).autonomous, true);
  assert.equal(autonomousEvidenceFor({ ...landed, evidence_level: "independent" }).via, "landed-fix");
});

test("(b) coverage: a retired or contaminated method adds nothing; a live one does", () => {
  const { root } = mkTmp();
  writeCarriers(root);
  // `state-transitions` has NO finding here, so a method is the only evidence that could grade it — which
  // makes the difference between a contributing and a non-contributing method the ONLY variable.
  const sig = { domain_signals: ["state transitions: a carrier written by two writers"], preconditions: ["a shared carrier exists"] };
  writeCarrier(root, ".quay/discovery-method-registry.jsonl", [
    methodFixture({ method_id: "m-draft", applicability: sig }),
    methodFixture({ method_id: "m-retired", applicability: sig, status: "retired", retirement_reason: "superseded by m-draft" }),
    methodFixture({
      method_id: "m-active-contaminated", applicability: sig, status: "active",
      generalization_evidence: { verdict_ref: "contaminated_verdict-fixture" },
    }),
  ]);
  // The method that was PROMOTED on a judgment made on an already-used hold-out — the registry's own
  // deny-list, which the map consults rather than re-deriving.
  writeCarrier(root, ".quay/discovery-contaminated-verdicts.jsonl", [
    {
      kind: "contaminated_verdict", id: "contaminated_verdict-fixture", verdict_id: "contaminated_verdict-fixture",
      reason: "VERDICT_CONTAMINATED: judged on a hold-out the case-identity index shows was used before",
      collisions: [], authored_by: { actor: "operator-session", ref: "fixture" }, ts: "2020-01-01T00:00:00Z",
    },
  ]);

  const map = coverageMap(root);
  const row = domainRow(map, "state-transitions");
  assert.equal(row.findings.total, 0, "no finding claims this domain, so the grade can only come from a method");
  assert.deepEqual(row.methods.claiming.map((m) => [m.method_id, m.status, m.contaminated, m.contributes]), [
    ["m-active-contaminated", "active", true, false],
    ["m-draft", "draft", false, true],
    ["m-retired", "retired", false, false],
  ]);
  assert.equal(row.methods.contributing_count, 1);
  assert.equal(row.grade, "assisted", "the draft method is the only contributor — the retired and the contaminated one add nothing");
  assert.equal(row.grade_reason.includes("1-CONTRIBUTING-METHOD(S)-ONLY"), true);
  assert.equal(map.methods.contaminated_verdicts_evaluated, 1);
  assert.equal(map.methods.evaluated, true);
  // A method CANNOT reach `autonomous` on its own: reusable capability is not demonstrated coverage.
  assert.equal(row.grade, "assisted");
  // The literal-name claim rule: a domain is claimed by naming it, and an unrelated signal claims nothing.
  assert.equal(methodClaimsDomain({ applicability: { domain_signals: ["a shared mutable artifact"], preconditions: ["x"] } }, "state-transitions"), null);
  assert.equal(methodClaimsDomain({ applicability: sig }, "state-transitions"), "state transitions");
  assert.equal(methodTrust({ status: "retired" }, { contaminatedVerdictIds: [] }).why, "RETIRED");
  // The contribution rule is an inspectable list, not an inline comparison: `retired` is the only
  // NON-contributing status, so a status the registry declares but has not promoted (`draft`, and `trial`
  // since gap-discovery-evidence-level-teaching-vs-independent landed it) is a method still in play and
  // lifts a domain to `assisted` rather than silently dropping out. An UNRECOGNISED status is refused,
  // not counted — that is the half that must fail closed (硬规则 3b).
  assert.deepEqual(NON_CONTRIBUTING_METHOD_STATUSES, ["retired"]);
  assert.deepEqual(["draft", "trial", "active"].map((s) => methodTrust({ status: s }, { contaminatedVerdictIds: [] }).contributes), [true, true, true]);
  assert.equal(methodTrust({ status: "retired" }, { contaminatedVerdictIds: [] }).contributes, false);
  assert.deepEqual(methodTrust({ status: "not-a-status" }), {
    method_id: null, version: null, status: null, verdict_ref: null,
    contaminated: false, contributes: false, why: "STATUS_NOT_IN_VOCAB",
  });
  // A status the registry gains later must not silently flip to "contributes": the module's own
  // vocabulary is the list this reads, so the two can never drift apart without a refusal.
  assert.ok(METHOD_STATUSES.includes("retired") && METHOD_STATUSES.includes("active"));

  // With only the retired and contaminated methods present, the same domain grades `none` — the 1-versus-2
  // arm proves the two refusals above are checks and not a blanket refusal of every method.
  const { root: root2 } = mkTmp();
  writeCarriers(root2);
  writeCarrier(root2, ".quay/discovery-method-registry.jsonl", [methodFixture({ method_id: "m-retired", applicability: sig, status: "retired", retirement_reason: "no longer applied" })]);
  assert.equal(domainRow(coverageMap(root2), "state-transitions").grade, "none");
});

test("(c) coverage: an unclassified finding is reported `unclassified`, never guessed into a domain", () => {
  const { root } = mkTmp();
  writeCarriers(root);
  ingestFinding(root, input({ finding_id: "C-NODOMAIN", fix_task: "t-fix-a" }), { rates: RATES });
  // A DIFFERENT claim over the same components: same component set + same claim would make this a
  // duplicate of the row above, and a duplicate grades nothing.
  ingestFinding(root, input({
    finding_id: "C-CLASSED", fix_task: "t-fix-a", claim: "a second, unrelated claim about the same components",
    domain: "shared-semantics", domain_reason: "one semantic declared twice",
  }), { rates: RATES });

  const map = coverageMap(root);
  assert.equal(map.unclassified.grade, UNCLASSIFIED);
  assert.deepEqual(map.unclassified.ids, ["C-NODOMAIN"]);
  assert.deepEqual(map.unclassified.by_origin, { "autonomous-routine": 1 });
  assert.deepEqual(map.unclassified.carried_domain, [], "no domain was carried at all — this is 'never classified'");
  assert.equal(domainRow(map, "shared-semantics").grade, "autonomous", "the unclassified row does not lift or lower any domain");
  assert.equal(domainRow(map, "shared-semantics").findings.total, 1);
  assert.equal(map.gap.includes(UNCLASSIFIED), false, "unclassified is a ledger-quality signal, not a capability gap");
  assert.equal(map.context.classified, 1);

  // ⛔ The MIRROR cause is a different value: a carrier line carrying a domain OUTSIDE the vocabulary is
  // "the reader cannot read this classification", which must not be absorbed into "never classified"
  // (硬规则 3b). Only a hand-edited carrier can produce one, since ingest refuses the value.
  writeCarrier(root, PORTFOLIO_REL, [{
    kind: PORTFOLIO_KIND, id: "portfolio_finding-handmade", finding_id: "C-BOGUS", origin: "operator",
    evidence_level: "teaching", outcome: "supported", domain: "no-such-domain", domain_reason: "hand-edited",
    duplicate_of: null, components: [], fix_landed_commit: null,
  }]);
  const map2 = coverageMap(root);
  assert.deepEqual(map2.unclassified.ids, ["C-NODOMAIN", "C-BOGUS"]);
  assert.deepEqual(map2.unclassified.carried_domain, [{ finding_id: "C-BOGUS", domain: "no-such-domain" }]);
  assert.equal(map2.unclassified.total, 2);

  // Ingest refuses a domain outside the vocabulary, and a stated domain without its reason — so no
  // seventh bucket and no bare label can enter the carrier through the front door.
  const bad = ingestFinding(root, input({ finding_id: "C-BADDOMAIN", domain: "not-a-domain", domain_reason: "x" }), { rates: RATES });
  assert.equal(bad.ok, false);
  assert.ok(bad.reasons.includes("DOMAIN_NOT_IN_VOCAB:not-a-domain"), JSON.stringify(bad.reasons));
  const noReason = ingestFinding(root, input({ finding_id: "C-NOREASON", domain: "shared-semantics" }), { rates: RATES });
  assert.equal(noReason.ok, false);
  assert.ok(noReason.reasons.some((x) => x.startsWith("DOMAIN_REASON_REQUIRED:")), JSON.stringify(noReason.reasons));
  assert.equal(readPortfolio(root).records.some((r) => r.finding_id === "C-NOREASON"), false, "a refused domain writes nothing");
});

test("(d) coverage: one autonomous production-open supported finding with a landed fix yields `autonomous`", () => {
  const { root } = mkTmp();
  writeCarriers(root);
  const r = ingestFinding(root, input({
    finding_id: "C-AUTO", evidence_level: "production-open", fix_task: "t-fix-a",
    domain: "shared-semantics", domain_reason: "byte-identical copies of one helper in two checkers",
  }), { rates: RATES });
  assert.equal(r.ok, true, JSON.stringify(r.reasons));

  const map = coverageMap(root);
  const row = domainRow(map, "shared-semantics");
  assert.equal(row.grade, "autonomous");
  assert.deepEqual(row.findings.autonomous_ids, ["C-AUTO"]);
  assert.deepEqual(row.findings.not_autonomous, []);
  assert.equal(row.grade_reason, "C-AUTO(landed-fix)");
  assert.equal(map.gap.includes("shared-semantics"), false);
  // The operation that produced it is named, not implied: a routine probe, with the runId#findingId it
  // came from — the Plan's "operations that produced them".
  assert.deepEqual(row.operations, [{
    finding_id: "C-AUTO", operation: "routine-probe", origin: "autonomous-routine",
    origin_ref: "run-fixture-1", origin_carrier: ".quay/routine-findings.jsonl",
  }]);
  assert.equal(ORIGIN_OPERATIONS["autonomous-experiment"], "verifier-call");
  assert.equal(ORIGIN_OPERATIONS["mechanical-instrument"], "instrument");

  // The REFUTATION arm: autonomous capability without a landed fix. It grades its domain `autonomous`
  // while `valueMetrics` keeps it at zero value — the two axes are reported apart on purpose.
  const n = ingestFinding(root, input({
    finding_id: "C-REFUTED", origin: "autonomous-experiment", origin_ref: "E-FIX cluster 1",
    evidence_level: "independent", outcome: "refuted", claim: "claimed independent parser refuted: it imports the shared module",
    domain: "reuse-refutation", domain_reason: "the finding IS the refutation of a claimed reimplementation",
  }), { rates: RATES });
  assert.equal(n.ok, true, JSON.stringify(n.reasons));
  const map2 = coverageMap(root);
  const ref = domainRow(map2, "reuse-refutation");
  assert.equal(ref.grade, "autonomous");
  assert.equal(ref.grade_reason, "C-REFUTED(refutation)");
  assert.deepEqual(valueMetrics(readPortfolio(root).records).zero_or_negative.refuted, ["C-REFUTED"], "capability, not value");

  // A DUPLICATE grades nothing — it is the same finding recorded twice, so it demonstrates nothing the
  // original did not. `config-to-behavior` holds only the duplicate, so it is `none`, and the row says why.
  const dup = ingestFinding(root, input({
    finding_id: "C-DUP", evidence_level: "production-open", fix_task: "t-fix-a", claim: "alpha finding claim",
    domain: "config-to-behavior", domain_reason: "a repeat of an earlier claim about the same components",
  }), { rates: RATES });
  assert.equal(dup.ok, true, JSON.stringify(dup.reasons));
  assert.equal(readPortfolio(root).records.find((x) => x.finding_id === "C-DUP").duplicate_of, "C-AUTO");
  const cfg = domainRow(coverageMap(root), "config-to-behavior");
  assert.equal(cfg.grade, "none", "a duplicate is not new coverage");
  assert.deepEqual(cfg.findings.duplicates, ["C-DUP"]);
  assert.match(cfg.grade_reason, /1-DUPLICATE\(S\)-ADD-NOTHING/);

  // ⛔ …while a `noise` RATING does NOT move a grade. "Worthless" is a human's VALUE judgment about a
  // finding that is real, and value is `valueMetrics`' axis — the two are asserted apart here so neither
  // can be read as the other: the coverage stays `autonomous`, the value drops.
  const before = valueMetrics(readPortfolio(root).records).net_new_value.total;
  assert.equal(rateFinding(root, { finding_id: "C-AUTO", value: "noise", by: "session-2026-10-12-operator", actor: "operator-session" }).ok, true);
  assert.equal(domainRow(coverageMap(root), "shared-semantics").grade, "autonomous", "a value judgment is not a capability judgment");
  assert.equal(valueMetrics(readPortfolio(root).records).net_new_value.total, before - 1, "the same rating DOES subtract value");
});

test("coverage: `evaluated:false` when the method half cannot be read, and every domain still names its own causes", () => {
  const { root } = mkTmp();
  writeCarriers(root);
  ingestFinding(root, input({ finding_id: "C-AUTO", fix_task: "t-fix-a", domain: "shared-semantics", domain_reason: "one semantic declared twice in two places" }), { rates: RATES });

  // An unreadable registry is its OWN value (硬规则 3b): it must not read as "no method claims this
  // domain", which is what an empty `claiming` list would say.
  fs.appendFileSync(path.join(root, ".quay/discovery-method-registry.jsonl"), "{not json\n", "utf8");
  const map = coverageMap(root);
  assert.equal(map.ok, true, "the FINDING half was read, and that half is real");
  assert.equal(map.evaluated, false);
  assert.equal(map.methods.evaluated, false);
  assert.match(map.methods.reason, /METHOD_REGISTRY_UNREADABLE/);
  const row = domainRow(map, "state-transitions");
  assert.equal(row.grade, "none");
  assert.match(row.grade_reason, /NO_NEW_FINDING_CLASSED_TO_THIS_DOMAIN\+METHOD_HALF_NOT_EVALUATED/);
  // …and the half that WAS readable is untouched: `shared-semantics` still grades autonomous.
  assert.equal(domainRow(map, "shared-semantics").grade, "autonomous");

  // An unresolvable shared checkout refuses the whole map rather than reporting every domain `none`.
  const notARepo = fs.mkdtempSync(path.join(os.tmpdir(), "discovery-portfolio-norepo-"));
  tmpDirs.push(notARepo);
  const refused = coverageMap(notARepo);
  assert.equal(refused.ok, false);
  assert.equal(refused.evaluated, false);
  assert.deepEqual(refused.domains, []);
  assert.match(refused.reason, /SHARED_CHECKOUT_UNRESOLVED/);
});

test("a domain assignment is an append-only overlay: it fills a finding that states none, and refuses one that states its own", () => {
  const { root } = mkTmp();
  writeCarriers(root);
  ingestFinding(root, input({ finding_id: "C-NONE" }), { rates: RATES });
  ingestFinding(root, input({ finding_id: "C-STATED", domain: "shared-semantics", domain_reason: "stated at ingest" }), { rates: RATES });
  assert.equal(readPortfolio(root).records.find((r) => r.finding_id === "C-NONE").domain, null);
  assert.equal(readPortfolio(root).records.find((r) => r.finding_id === "C-NONE").domain_source, null);

  const a = assignFindingDomain(root, { finding_id: "C-NONE", domain: "state-transitions", reason: "clause 2 state/admission: an admission gate let a record through", by: "fixture" });
  assert.equal(a.ok, true, JSON.stringify(a.reasons));
  assert.equal(a.record.kind, PORTFOLIO_DOMAIN_KIND);
  const rec = readPortfolio(root).records.find((r) => r.finding_id === "C-NONE");
  assert.equal(rec.domain, "state-transitions");
  assert.equal(rec.domain_source, "assignment", "added later is a DIFFERENT value from stated at ingest");
  assert.equal(rec.domain_reason, "clause 2 state/admission: an admission gate let a record through");
  assert.equal(domainRow(coverageMap(root), "state-transitions").grade, "assisted");

  // Idempotent: the id keys on the FINDING alone, so a re-run appends nothing instead of stacking a
  // second classification of the same finding.
  const again = assignFindingDomain(root, { finding_id: "C-NONE", domain: "state-transitions", reason: "the same call, again", by: "fixture" });
  assert.equal(again.duplicate, true);
  assert.equal(readPortfolio(root).assignments.length, 1);

  // A finding that STATES its own domain is REFUSED: an assignment line the read path would shadow is a
  // permanent, invisible inconsistency in an append-only carrier.
  const shadowed = assignFindingDomain(root, { finding_id: "C-STATED", domain: "state-transitions", reason: "x", by: "fixture" });
  assert.equal(shadowed.ok, false);
  assert.ok(shadowed.reasons.some((x) => x.startsWith("DOMAIN_ALREADY_STATED:")), JSON.stringify(shadowed.reasons));
  assert.equal(readPortfolio(root).records.find((r) => r.finding_id === "C-STATED").domain, "shared-semantics");

  // Every refusal is enumerated, and an unknown target is its own cause (never a silent no-op).
  assert.deepEqual(assignFindingDomain(root, { finding_id: "C-MISSING", domain: "shared-semantics", reason: "x", by: "f" }).reasons, ["DOMAIN_TARGET_NOT_FOUND:C-MISSING"]);
  assert.equal(assignFindingDomain(root, { finding_id: "C-NONE", domain: "nope", reason: "x", by: "f" }).ok, false);
  assert.equal(assignFindingDomain(root, { finding_id: "C-NONE", domain: "shared-semantics", reason: "", by: "f" }).ok, false);
  assert.equal(assignFindingDomain(root, { finding_id: "C-NONE", domain: "shared-semantics", reason: "x" }).ok, false);
  assert.equal(readPortfolio(root).assignments.length, 1, "no refused assignment wrote a line");
  assert.deepEqual(GRADES, ["autonomous", "assisted", "none"]);
  assert.deepEqual(DOMAINS, ["shared-semantics", "config-to-behavior", "writer-checker-contract", "state-transitions", "reuse-refutation", "method-trustworthiness"]);
  assert.equal(DOMAIN_LABELS["config-to-behavior"], "config→behavior");
});
