#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/ci-red-attribute.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
function flagValue(argv, name) {
  const idx = argv.indexOf(name);
  return idx === -1 ? void 0 : argv[idx + 1];
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/ci-red-attribute.ts
var ATTRIBUTION_VOCAB = ["real-defect", "infrastructure", "known-flake"];
var DEFAULT_NO_SIGNAL = "default:no-signal-matched";
var DEFECT_TESTS_RAN = "defect:tests-ran-and-failed";
var TEST_STEP_RE = /(run tests?\b|run the (test )?suite|test suite\b|vitest|node --test|npm (run )?test\b|jest\b|playwright|cypress|\be2e\b)/i;
var SETUP_STEP_RE = /(set up job|checkout|setup-node|setup node|install|npm ci|npm install|yarn|pnpm|restore cache|cache)/i;
var JOB_NOT_STARTED_PREFIX = "infra:job-not-started:";
function jobNeverStarted(job) {
  return job.runnerName === "" && Array.isArray(job.steps) && job.steps.length === 0;
}
function asRecord(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? v : null;
}
function jobReadings(record) {
  const jobs = record.jobs;
  if (!Array.isArray(jobs)) return [];
  return jobs.map((j) => asRecord(j)).filter((j) => j !== null);
}
function stepReadings(job) {
  if (!Array.isArray(job.steps)) return [];
  return job.steps.map((s) => asRecord(s)).filter((s) => s !== null);
}
function testSteps(job) {
  return stepReadings(job).filter((s) => TEST_STEP_RE.test(String(s.name ?? "")));
}
function testStepStarted(job) {
  return testSteps(job).some((s) => ["success", "failure", "cancelled"].includes(String(s.conclusion ?? "")));
}
function testStepFailed(job) {
  return testSteps(job).some((s) => String(s.conclusion ?? "") === "failure");
}
function jobFailureIsSubstantive(job) {
  if (String(job.conclusion ?? "") !== "failure") return false;
  const failing = stepReadings(job).filter((s) => String(s.conclusion ?? "") === "failure");
  if (failing.length === 0) return false;
  const testRan = testStepStarted(job) || testStepFailed(job);
  const nonSetupFailed = failing.some((s) => !SETUP_STEP_RE.test(String(s.name ?? "")));
  return testRan || nonSetupFailed;
}
function attributeRun(record, opts = {}) {
  const rec = asRecord(record);
  if (rec === null) return { attribution: null, signals: ["refused:record-not-an-object"] };
  const conclusion = String(rec.conclusion ?? "");
  if (conclusion !== "failure") {
    return { attribution: null, signals: [`refused:conclusion-is-not-failure:${conclusion || "<absent>"}`] };
  }
  const infra = [];
  if (rec.timedOut === true) infra.push("infra:run-timed-out");
  const jobs = jobReadings(rec);
  const runLevelTimeout = typeof opts.jobTimeoutMinutes === "number" && opts.jobTimeoutMinutes > 0 ? opts.jobTimeoutMinutes : null;
  for (const job of jobs) {
    const name = String(job.name ?? "<unnamed-job>");
    const dur = job.durationSec;
    const to = typeof job.timeoutMinutes === "number" && job.timeoutMinutes > 0 ? job.timeoutMinutes : runLevelTimeout;
    if (jobNeverStarted(job)) {
      infra.push(`${JOB_NOT_STARTED_PREFIX}${name}`);
    } else if (typeof dur === "number" && dur > 0 && to !== null && dur >= to * 60) {
      infra.push(`infra:job-timeout-reached:${name}`);
    }
    if (String(job.conclusion ?? "") === "cancelled") {
      infra.push(`infra:job-cancelled:${name}`);
    }
  }
  const hasStepReadings = jobs.some((j) => stepReadings(j).length > 0);
  const failedStepNames = jobs.flatMap(
    (j) => stepReadings(j).filter((s) => String(s.conclusion ?? "") === "failure").map((s) => String(s.name ?? ""))
  );
  const testStepRan = jobs.some((j) => testStepStarted(j));
  const testStepRed = jobs.some((j) => testStepFailed(j));
  const testsReported = typeof rec.testFiles === "number" && rec.testFiles > 0;
  const setupStepFailed = failedStepNames.find((n) => SETUP_STEP_RE.test(n));
  if (hasStepReadings && setupStepFailed !== void 0 && !testStepRan && !testsReported) {
    infra.push(`infra:failed-before-tests-started:setup-step:${setupStepFailed}`);
  }
  const substantiveJob = jobs.find((j) => jobFailureIsSubstantive(j));
  const suppressed = [];
  if (infra.length > 0) {
    if (substantiveJob === void 0) return { attribution: "infrastructure", signals: infra };
    suppressed.push(`defect:substantive-failure:${String(substantiveJob.name ?? "<unnamed-job>")}`);
    for (const s of infra) suppressed.push(`suppressed-by-substantive-failure:${s}`);
  }
  const flakeSignals = [];
  const failedTests = Array.isArray(rec.failedTests) ? rec.failedTests.map((t) => String(t)) : [];
  const registry = opts.knownFlakes ?? null;
  if (registry !== null && Array.isArray(registry.flakes) && failedTests.length > 0) {
    for (const flake of registry.flakes) {
      const id = String(asRecord(flake)?.test ?? "");
      if (id !== "" && failedTests.includes(id)) flakeSignals.push(`flake:${id}`);
    }
  }
  if (flakeSignals.length > 0) return { attribution: "known-flake", signals: flakeSignals };
  const tail = suppressed.length > 0 ? suppressed : [];
  if (testsReported || testStepRan || testStepRed) {
    return { attribution: "real-defect", signals: [DEFECT_TESTS_RAN, ...tail] };
  }
  return { attribution: "real-defect", signals: [DEFAULT_NO_SIGNAL, ...tail] };
}
function hasValidAttribution(record) {
  return ATTRIBUTION_VOCAB.includes(String(record.attribution ?? ""));
}
function defaultKnownFlakesPath(moduleDir = path.dirname(fileURLToPath(import.meta.url))) {
  return path.join(moduleDir, "known-flakes.json");
}
function loadKnownFlakes(filePath = defaultKnownFlakesPath()) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const obj = asRecord(parsed);
  if (obj === null || !Array.isArray(obj.flakes)) return null;
  const flakes = [];
  for (const f of obj.flakes) {
    const r = asRecord(f);
    if (r === null) return null;
    if (typeof r.test !== "string" || typeof r.firstRegistered !== "string" || typeof r.evidence !== "string") {
      return null;
    }
    flakes.push({ test: r.test, firstRegistered: r.firstRegistered, evidence: r.evidence });
  }
  return { flakes };
}
function usage() {
  return [
    "ci-red-attribute.ts \u2014 \u628A\u4E00\u6761\u5931\u8D25 run \u8BB0\u5F55\u5F52\u56E0\u4E3A real-defect | infrastructure | known-flake",
    "",
    "\u7528\u6CD5:",
    "  --record-file <path>   \u8BFB\u4E00\u6761 JSON \u8BB0\u5F55\u5E76\u5F52\u56E0\uFF08\u6253\u5370 {attribution, signals}\uFF09",
    "  --carrier <path>       \u53EA\u8BFB\u590D\u6838\u6574\u4E2A\u8F7D\u4F53\uFF1A\u9010\u6761\u62A5 failure \u8BB0\u5F55\u7684 attribution \u662F\u5426\u5408\u6CD5",
    "  --flakes <path>        \u5DF2\u77E5 flake \u767B\u8BB0\u8868\uFF08\u9ED8\u8BA4 plugin/scripts/known-flakes.json\uFF09",
    "  --json                 \u673A\u5668\u53EF\u8BFB\u8F93\u51FA",
    "  --list-flakes          \u6253\u5370\u767B\u8BB0\u8868\u5185\u5BB9",
    "  --help",
    "",
    "\u9000\u51FA\u7801: 0 = \u5F52\u56E0/\u590D\u6838\u5B8C\u6210\u4E14\u53EF\u8BFB; 1 = \u8F93\u5165\u8BFB\u4E0D\u61C2; 2 = \u7528\u6CD5\u9519\u8BEF; 3 = \u590D\u6838\u53D1\u73B0\u7F3A\u5F52\u56E0"
  ].join("\n");
}
function readJsonFile(p) {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(p, "utf8")) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage());
    return 0;
  }
  const flag = (name) => flagValue(argv, name) || null;
  const flakesPath = flag("--flakes") ?? defaultKnownFlakesPath();
  const knownFlakes = loadKnownFlakes(flakesPath);
  if (argv.includes("--list-flakes")) {
    if (knownFlakes === null) {
      console.error(`\u26A0 \u767B\u8BB0\u8868\u8BFB\u4E0D\u5230\u6216\u683C\u5F0F\u975E\u6CD5: ${flakesPath}`);
      return 1;
    }
    for (const f of knownFlakes.flakes) console.log(`${f.test}	${f.firstRegistered}	${f.evidence}`);
    console.error(`(${knownFlakes.flakes.length} \u6761)`);
    return 0;
  }
  const recordFile = flag("--record-file");
  const carrier = flag("--carrier");
  if (recordFile === null && carrier === null) {
    console.error(usage());
    return 2;
  }
  if (recordFile !== null) {
    const r = readJsonFile(recordFile);
    if (!r.ok) {
      console.error(`\u8BFB\u4E0D\u61C2\u8F93\u5165 ${recordFile}: ${r.error}`);
      return 1;
    }
    const rec = asRecord(r.value);
    if (rec === null) {
      console.error(`\u8BFB\u4E0D\u61C2\u8F93\u5165 ${recordFile}: \u9876\u5C42\u4E0D\u662F\u4E00\u4E2A JSON \u5BF9\u8C61`);
      return 1;
    }
    const res = attributeRun(rec, { knownFlakes });
    if (argv.includes("--json")) console.log(JSON.stringify(res));
    else console.log(`${res.attribution}	${res.signals.join(",")}`);
    return 0;
  }
  let lines;
  try {
    lines = fs.readFileSync(carrier, "utf8").split("\n");
  } catch (e) {
    console.error(`\u8BFB\u4E0D\u61C2\u8F93\u5165 ${carrier}: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  let total = 0;
  let failures = 0;
  let unreadableFlags = 0;
  const missing = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      unreadableFlags += 1;
      continue;
    }
    const rec = asRecord(parsed);
    if (rec === null) {
      unreadableFlags += 1;
      continue;
    }
    total += 1;
    if (String(rec.conclusion ?? "") !== "failure") continue;
    failures += 1;
    if (!ATTRIBUTION_VOCAB.includes(String(rec.attribution ?? ""))) {
      missing.push({ runId: rec.runId, attribution: rec.attribution ?? null });
    }
  }
  console.log(
    `records=${total} failures=${failures} unattributed=${missing.length} unreadable=${unreadableFlags}`
  );
  if (missing.length > 0) {
    for (const m of missing.slice(0, 5)) console.error(`  \u7F3A\u5F52\u56E0: runId=${m.runId} attribution=${m.attribution}`);
    return 3;
  }
  return 0;
}
if (process.argv[1] && path.basename(process.argv[1]).replace(/\.(?:js|ts|mjs)$/, "") === "ci-red-attribute") {
  process.exit(main(process.argv.slice(2)));
}
export {
  ATTRIBUTION_VOCAB,
  DEFAULT_NO_SIGNAL,
  DEFECT_TESTS_RAN,
  JOB_NOT_STARTED_PREFIX,
  SETUP_STEP_RE,
  TEST_STEP_RE,
  attributeRun,
  defaultKnownFlakesPath,
  hasValidAttribution,
  jobNeverStarted,
  loadKnownFlakes,
  main
};
