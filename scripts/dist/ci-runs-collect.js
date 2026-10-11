#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/ci-runs-collect.ts
import fs3 from "node:fs";
import path3 from "node:path";
import { execFileSync as execFileSync2 } from "node:child_process";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/repo-root.ts
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
var MAX_DEPTH = 16;
function repoRoot(startDir = path.dirname(fileURLToPath(import.meta.url))) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < MAX_DEPTH; i++) {
    const hasPkg = fs.existsSync(path.join(dir, "package.json"));
    if (hasPkg && fs.existsSync(path.join(dir, "plugin")) && fs.existsSync(path.join(dir, "scripts", "test.sh"))) {
      return dir;
    }
    if (hasPkg && fs.existsSync(path.join(dir, ".quay", "config.yml"))) {
      return dir;
    }
    if (fs.existsSync(path.join(dir, ".git"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      timeout: 5e3,
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return process.cwd();
  }
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
function flagValue(argv, name) {
  const idx = argv.indexOf(name);
  return idx === -1 ? void 0 : argv[idx + 1];
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/ci-red-attribute.ts
import fs2 from "node:fs";
import path2 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
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
function defaultKnownFlakesPath(moduleDir = path2.dirname(fileURLToPath2(import.meta.url))) {
  return path2.join(moduleDir, "known-flakes.json");
}
function loadKnownFlakes(filePath = defaultKnownFlakesPath()) {
  let raw;
  try {
    raw = fs2.readFileSync(filePath, "utf8");
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
    return { ok: true, value: JSON.parse(fs2.readFileSync(p, "utf8")) };
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
    lines = fs2.readFileSync(carrier, "utf8").split("\n");
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
if (process.argv[1] && path2.basename(process.argv[1]).replace(/\.(?:js|ts|mjs)$/, "") === "ci-red-attribute") {
  process.exit(main(process.argv.slice(2)));
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/ci-runs-collect.ts
var CARRIER_REL = path3.join(".quay", "ci-runs.jsonl");
var GROUP_FILES_RE = /__GROUP__[^\n]*?\bfiles=(\d+)/g;
function deriveTestFilesFromLog(logText) {
  let max = null;
  for (const m of logText.matchAll(GROUP_FILES_RE)) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0 && (max === null || n > max)) max = n;
  }
  return max;
}
var PREREQ_NAMES = ["pyyaml", "tmux", "procps"];
var PREREQ_MARKER_RE = /__PREREQ__[ \t]+([A-Za-z0-9_-]+)=([A-Za-z0-9_.-]+)/g;
var PREREQ_ALREADY_PRESENT = "already-present";
var PREREQ_INSTALLED_APT = "installed-apt";
var PREREQ_INSTALLED_PIP = "installed-pip";
var PREREQ_ABSENT = "absent";
var PREREQ_VOCAB = [
  PREREQ_ALREADY_PRESENT,
  PREREQ_INSTALLED_APT,
  PREREQ_INSTALLED_PIP,
  PREREQ_ABSENT
];
function derivePrereqProvision(logText) {
  const out = {};
  for (const name of PREREQ_NAMES) out[name] = PREREQ_ABSENT;
  for (const m of logText.matchAll(PREREQ_MARKER_RE)) {
    const name = m[1];
    const value = m[2];
    if (!PREREQ_NAMES.includes(name)) continue;
    if (!PREREQ_VOCAB.includes(value)) continue;
    out[name] = value;
  }
  return out;
}
function hasPrereqProvision(reading) {
  const p = reading.prereqProvision;
  return p !== null && typeof p === "object" && !Array.isArray(p);
}
var SCHEDULER_MS_RE = /__OVERHEAD__[ \t]+scheduler_ms=(\d+)/g;
function deriveSchedulerMs(logText) {
  let last = null;
  for (const m of logText.matchAll(SCHEDULER_MS_RE)) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) last = n;
  }
  return last;
}
function hasSchedulerMs(reading) {
  return typeof reading.schedulerMs === "number" && Number.isFinite(reading.schedulerMs);
}
var NOT_STARTED_CAUSE_MAX_CHARS = 400;
function deriveNotStartedCause(body) {
  const asList = (v) => Array.isArray(v) ? v : [];
  let list;
  if (Array.isArray(body)) {
    list = asList(body);
  } else {
    const obj = body !== null && typeof body === "object" && !Array.isArray(body) ? body : null;
    list = obj === null ? [] : asList(obj.annotations);
  }
  for (const a of list) {
    const rec = a !== null && typeof a === "object" && !Array.isArray(a) ? a : null;
    if (rec === null) continue;
    if (String(rec.annotation_level ?? "") !== "failure") continue;
    const msg = typeof rec.message === "string" ? rec.message : "";
    if (msg.trim() === "") continue;
    return msg.length > NOT_STARTED_CAUSE_MAX_CHARS ? msg.slice(0, NOT_STARTED_CAUSE_MAX_CHARS) : msg;
  }
  return null;
}
var RELEASE_WORKFLOW_NAMES = ["Release", "release.yml"];
var SEA_VERIFY_JOB_BASES = ["sea-verify-node-free", "sea-verify-node-free-cross-platform"];
var SEA_VERIFY_SUCCESS = "success";
var SEA_VERIFY_FAILURE = "failure";
var SEA_VERIFY_INCOMPLETE = "incomplete";
var SEA_VERIFY_ABSENT = "absent";
function jobMatchesBase(job, base) {
  const n = String(job.name ?? "");
  return n === base || n.startsWith(`${base} (`);
}
function deriveSeaVerify(jobs) {
  const presentBases = SEA_VERIFY_JOB_BASES.filter((b) => jobs.some((j) => jobMatchesBase(j, b)));
  if (presentBases.length === 0) return SEA_VERIFY_ABSENT;
  const matched = jobs.filter((j) => SEA_VERIFY_JOB_BASES.some((b) => jobMatchesBase(j, b)));
  if (matched.some((j) => String(j.conclusion ?? "") !== "success")) return SEA_VERIFY_FAILURE;
  if (presentBases.length < SEA_VERIFY_JOB_BASES.length) return SEA_VERIFY_INCOMPLETE;
  return SEA_VERIFY_SUCCESS;
}
function parseJobTimeouts(yaml) {
  const out = {};
  const lines = yaml.split("\n");
  let current = null;
  let inJobs = false;
  for (const line of lines) {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;
    if (/^\S/.test(line)) break;
    const jobKey = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (jobKey) {
      current = jobKey[1];
      continue;
    }
    const tm = /^\s+timeout-minutes:\s*(\d+)\s*$/.exec(line);
    if (tm && current !== null) out[current] = Number(tm[1]);
  }
  return out;
}
function secsBetween(a, b) {
  if (!a || !b) return void 0;
  const t0 = Date.parse(a);
  const t1 = Date.parse(b);
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 < t0) return void 0;
  return Math.round((t1 - t0) / 1e3);
}
function toJobReadings(jobs, timeouts = {}, prereqByJob, schedulerByJob) {
  return jobs.map((j) => {
    const name = String(j.name ?? "");
    const reading = {
      name,
      conclusion: j.conclusion === null || j.conclusion === void 0 ? void 0 : String(j.conclusion)
    };
    if (typeof j.runner_name === "string") reading.runnerName = j.runner_name;
    const dur = secsBetween(j.started_at, j.completed_at);
    if (dur !== void 0) reading.durationSec = dur;
    const to = timeouts[name];
    if (typeof to === "number" && to > 0) reading.timeoutMinutes = to;
    const prov = prereqByJob?.get(j);
    if (prov !== void 0) reading.prereqProvision = prov;
    const sched = schedulerByJob?.get(j);
    if (sched !== void 0) reading.schedulerMs = sched;
    if (Array.isArray(j.steps)) {
      reading.steps = j.steps.map((s) => ({
        name: String(s.name ?? ""),
        conclusion: s.conclusion === null || s.conclusion === void 0 ? void 0 : String(s.conclusion),
        ...typeof s.number === "number" ? { number: s.number } : {}
      }));
    }
    return reading;
  });
}
function buildRecord(run, opts = {}) {
  const rec = {
    // run 自己的时刻（⛔ 不是采集时刻）
    ts: String(run.created_at ?? run.run_started_at ?? ""),
    branch: run.head_branch === void 0 ? void 0 : String(run.head_branch),
    workflow: run.name === void 0 ? void 0 : String(run.name),
    conclusion: run.conclusion === null || run.conclusion === void 0 ? void 0 : String(run.conclusion),
    runId: run.id,
    url: run.html_url
  };
  const dur = secsBetween(run.run_started_at ?? run.created_at, run.updated_at);
  if (dur !== void 0) rec.durationSec = dur;
  const jobs = opts.jobs ?? [];
  if (jobs.length > 0) {
    rec.jobs = toJobReadings(jobs, opts.timeouts ?? {}, opts.prereqByJob, opts.schedulerByJob);
  }
  if (RELEASE_WORKFLOW_NAMES.includes(String(run.name ?? ""))) {
    rec.seaVerify = deriveSeaVerify(rec.jobs ?? jobs);
  }
  if (String(run.conclusion ?? "") === "timed_out" || jobs.some((j) => String(j.conclusion ?? "") === "timed_out")) {
    rec.timedOut = true;
  }
  if (typeof opts.testFiles === "number" && opts.testFiles > 0) rec.testFiles = opts.testFiles;
  if (Array.isArray(opts.failedTests) && opts.failedTests.length > 0) rec.failedTests = opts.failedTests;
  if (opts.notStartedCause !== void 0) rec.notStartedCause = opts.notStartedCause;
  for (const k of Object.keys(rec)) if (rec[k] === void 0) delete rec[k];
  return rec;
}
function withAttribution(record, knownFlakes) {
  if (String(record.conclusion ?? "") !== "failure") return record;
  const res = attributeRun(record, { knownFlakes });
  if (res.attribution === null) return record;
  return { ...record, attribution: res.attribution, signals: res.signals };
}
function resolveGhBin(env = process.env, isExec = (p) => {
  try {
    fs3.accessSync(p, fs3.constants.X_OK);
    return fs3.statSync(p).isFile();
  } catch {
    return false;
  }
}) {
  const candidates = [];
  const labelled = [];
  const push = (p, source) => {
    if (!p || p.trim() === "" || candidates.includes(p)) return;
    candidates.push(p);
    labelled.push({ bin: p, source });
  };
  push(env.QUAY_GH_BIN, "env:QUAY_GH_BIN");
  push(env.GH_BIN, "env:GH_BIN");
  for (const dir of String(env.PATH ?? "").split(path3.delimiter)) {
    if (dir.trim() !== "") push(path3.join(dir, "gh"), `path:${dir}`);
  }
  const home = env.HOME && env.HOME.trim() !== "" ? env.HOME : null;
  if (home) push(path3.join(home, ".local", "bin", "gh"), "fallback:~/.local/bin/gh");
  for (const p of ["/usr/local/bin/gh", "/opt/homebrew/bin/gh", "/usr/bin/gh", "/bin/gh"]) {
    push(p, `fallback:${p}`);
  }
  for (const c of labelled) {
    if (isExec(c.bin)) return { bin: c.bin, source: c.source, candidates };
  }
  return { bin: null, source: "none", candidates };
}
var GhUnavailableError = class extends Error {
  // ⛔ 不写 TS parameter property（`constructor(readonly x)`）：Node 的 strip-only 类型剥离不支持它
  // （实测 2026-09-15：`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX: TypeScript parameter property is not
  // supported in strip-only mode`——而本仓跑的就是 strip-only）。
  resolution;
  constructor(resolution) {
    super(
      `gh \u4E0D\u53EF\u8FBE\uFF08PATH / QUAY_GH_BIN / GH_BIN \u90FD\u89E3\u6790\u4E0D\u51FA\u53EF\u6267\u884C\u7684 gh\uFF09\u2014\u2014 \u5C1D\u8BD5\u8FC7\u7684\u5019\u9009: ${resolution.candidates.join(", ") || "(\u7A7A)"}`
    );
    this.name = "GhUnavailableError";
    this.resolution = resolution;
  }
};
var defaultGhRunner = (args) => {
  const res = resolveGhBin();
  if (res.bin === null) throw new GhUnavailableError(res);
  return execFileSync2(res.bin, args, { encoding: "utf8", timeout: 12e4, maxBuffer: 64 * 1024 * 1024 });
};
function ghJson(run, args) {
  return JSON.parse(run(args));
}
var DEFAULT_MAX_LOG_RUNS = 25;
var DEFAULT_LOG_JOB_RE = /test|suite/i;
function deriveRunNotStartedCause(run, repo, jobs, offlineSeam, warnings) {
  const misses = jobs.filter(
    (j) => String(j.conclusion ?? "") === "failure" && jobNeverStarted({ runnerName: j.runner_name, steps: j.steps })
  );
  if (misses.length === 0) return void 0;
  if (offlineSeam) return null;
  for (const j of misses) {
    if (typeof j.id !== "number" && typeof j.id !== "string") continue;
    try {
      const body = ghJson(run, [
        "api",
        `/repos/${repo}/check-runs/${j.id}/annotations`
      ]);
      const cause = deriveNotStartedCause(body);
      if (cause !== null) return cause;
    } catch (e) {
      warnings.push(`not-started-annotation-unreadable:${j.id}:${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return null;
}
function collect(opts) {
  const run = opts.run ?? defaultGhRunner;
  const warnings = [];
  const limit = opts.limit ?? 20;
  let runs = [];
  if (opts.runs) {
    runs = opts.runs;
  } else {
    const q = new URLSearchParams({ per_page: String(Math.min(limit, 100)) });
    if (opts.branch) q.set("branch", opts.branch);
    const path4 = opts.workflow ? `/repos/${opts.repo}/actions/workflows/${encodeURIComponent(opts.workflow)}/runs` : `/repos/${opts.repo}/actions/runs`;
    const body = ghJson(run, ["api", `${path4}?${q.toString()}`]);
    runs = Array.isArray(body.workflow_runs) ? body.workflow_runs : [];
  }
  runs = runs.slice(0, limit);
  if (runs.some((r) => typeof r.status === "string" && r.status !== "completed")) {
    const skipped = runs.filter((r) => typeof r.status === "string" && r.status !== "completed");
    for (const r of skipped) warnings.push(`run-not-completed:${String(r.id ?? "")}:${String(r.status)}`);
    runs = runs.filter((r) => !(typeof r.status === "string" && r.status !== "completed"));
  }
  const timeoutsCache = /* @__PURE__ */ new Map();
  const records = [];
  const logMode = opts.fetchLogs ? "all" : opts.logFetch ?? "decisive";
  const maxLogRuns = opts.maxLogRuns ?? DEFAULT_MAX_LOG_RUNS;
  const logJobRe = opts.logJobRe ?? DEFAULT_LOG_JOB_RE;
  const offlineSeam = opts.runs !== void 0 && opts.run === void 0;
  let logRunsUsed = 0;
  const wantsLogs = (r) => {
    if (logMode === "none") return false;
    if (logMode === "all") return true;
    const c = String(r.conclusion ?? "");
    return c === "success" || c === "failure";
  };
  for (const r of runs) {
    const runId = String(r.id ?? "");
    let jobs = [];
    if (opts.jobsByRun) {
      jobs = opts.jobsByRun[runId] ?? [];
    } else if (runId !== "") {
      try {
        const jb = ghJson(run, ["api", `/repos/${opts.repo}/actions/runs/${runId}/jobs`]);
        jobs = Array.isArray(jb.jobs) ? jb.jobs : [];
      } catch (e) {
        warnings.push(`jobs-unreadable:${runId}:${e instanceof Error ? e.message : String(e)}`);
      }
    }
    let timeouts = {};
    if (opts.runs) {
      timeouts = {};
    } else {
      const sha = String(r.head_sha ?? "");
      const wfPath = opts.workflow ? `.github/workflows/${opts.workflow}` : String(r.path ?? "");
      const cacheKey = `${sha}|${wfPath}`;
      if (sha !== "" && wfPath !== "" && wfPath.startsWith(".github/workflows/")) {
        if (!timeoutsCache.has(cacheKey)) {
          try {
            const body = ghJson(run, [
              "api",
              `/repos/${opts.repo}/contents/${wfPath}?ref=${sha}`
            ]);
            const text = body.encoding === "base64" && typeof body.content === "string" ? Buffer.from(body.content, "base64").toString("utf8") : "";
            timeoutsCache.set(cacheKey, text === "" ? {} : parseJobTimeouts(text));
          } catch (e) {
            warnings.push(`workflow-unreadable:${wfPath}@${sha}:${e instanceof Error ? e.message : String(e)}`);
            timeoutsCache.set(cacheKey, {});
          }
        }
        timeouts = timeoutsCache.get(cacheKey) ?? {};
      }
    }
    let testFiles = opts.testFilesByRun?.[runId] ?? opts.knownTestFiles?.[runId] ?? null;
    const alreadyKnown = testFiles !== null;
    const knownUnderivable = opts.skipLogRuns?.has(runId) === true;
    const prereqKnown = opts.knownPrereqRuns?.has(runId) === true;
    const schedulerKnown = opts.knownSchedulerRuns?.has(runId) === true;
    const needsTestFiles = !alreadyKnown && !knownUnderivable;
    const needsPrereq = !prereqKnown;
    const needsSchedulerMs = !schedulerKnown;
    const prereqByJob = /* @__PURE__ */ new Map();
    const schedulerByJob = /* @__PURE__ */ new Map();
    if ((needsTestFiles || needsPrereq || needsSchedulerMs) && wantsLogs(r) && !offlineSeam && runId !== "") {
      if (logRunsUsed >= maxLogRuns) {
        warnings.push(`log-budget-exhausted:${runId}:maxLogRuns=${maxLogRuns}`);
      } else {
        logRunsUsed += 1;
        const preferred = jobs.filter((j) => logJobRe.test(String(j.name ?? "")));
        const targets = preferred.length > 0 ? preferred : jobs;
        if (preferred.length === 0 && jobs.length > 0) warnings.push(`log-job-filter-no-match:${runId}`);
        for (const j of targets) {
          if (typeof j.id !== "number" && typeof j.id !== "string") continue;
          try {
            const log = run(["api", "--allow-escape-sequences", `/repos/${opts.repo}/actions/jobs/${j.id}/logs`]);
            const n = deriveTestFilesFromLog(log);
            if (n !== null && (testFiles === null || n > testFiles)) testFiles = n;
            prereqByJob.set(j, derivePrereqProvision(log));
            const sched = deriveSchedulerMs(log);
            if (sched !== null) schedulerByJob.set(j, sched);
          } catch (e) {
            warnings.push(`job-log-unreadable:${j.id}:${e instanceof Error ? e.message : String(e)}`);
          }
        }
        if (testFiles === null) warnings.push(`testFiles-underivable:${runId}`);
      }
    }
    const notStartedCause = deriveRunNotStartedCause(run, opts.repo, jobs, offlineSeam, warnings);
    records.push(buildRecord(r, { jobs, timeouts, testFiles, prereqByJob, schedulerByJob, notStartedCause }));
  }
  return { records, warnings, logRunsFetched: logRunsUsed };
}
function existingKeys(carrierPath) {
  const keys = /* @__PURE__ */ new Set();
  let text;
  try {
    text = fs3.readFileSync(carrierPath, "utf8");
  } catch {
    return keys;
  }
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t === "") continue;
    try {
      const r = JSON.parse(t);
      keys.add(`${String(r.workflow ?? "")}|${String(r.runId ?? "")}`);
    } catch {
    }
  }
  return keys;
}
function knownTestFilesFromCarrier(carrierPath) {
  const out = {};
  let text;
  try {
    text = fs3.readFileSync(carrierPath, "utf8");
  } catch {
    return out;
  }
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t === "") continue;
    try {
      const r = JSON.parse(t);
      const id = r.runId === void 0 || r.runId === null ? "" : String(r.runId);
      if (id !== "" && typeof r.testFiles === "number" && Number.isInteger(r.testFiles)) out[id] = r.testFiles;
    } catch {
    }
  }
  return out;
}
function knownPrereqRunsFromCarrier(carrierPath) {
  const out = /* @__PURE__ */ new Set();
  let text;
  try {
    text = fs3.readFileSync(carrierPath, "utf8");
  } catch {
    return out;
  }
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t === "") continue;
    try {
      const r = JSON.parse(t);
      const id = r.runId === void 0 || r.runId === null ? "" : String(r.runId);
      if (id === "") continue;
      const jobs = Array.isArray(r.jobs) ? r.jobs : [];
      if (jobs.some((j) => hasPrereqProvision(j))) out.add(id);
    } catch {
    }
  }
  return out;
}
function knownSchedulerRunsFromCarrier(carrierPath) {
  const out = /* @__PURE__ */ new Set();
  let text;
  try {
    text = fs3.readFileSync(carrierPath, "utf8");
  } catch {
    return out;
  }
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t === "") continue;
    try {
      const r = JSON.parse(t);
      const id = r.runId === void 0 || r.runId === null ? "" : String(r.runId);
      if (id === "") continue;
      const jobs = Array.isArray(r.jobs) ? r.jobs : [];
      if (jobs.some((j) => hasSchedulerMs(j))) out.add(id);
    } catch {
    }
  }
  return out;
}
function prereqPatch(existingJobs, incomingJobs) {
  if (!Array.isArray(existingJobs) || !Array.isArray(incomingJobs)) return null;
  const byName = /* @__PURE__ */ new Map();
  for (const j of incomingJobs) {
    const rec = j !== null && typeof j === "object" && !Array.isArray(j) ? j : null;
    if (rec && hasPrereqProvision(rec)) byName.set(String(rec.name ?? ""), rec);
  }
  let changed = false;
  const out = existingJobs.map((j) => {
    const rec = j !== null && typeof j === "object" && !Array.isArray(j) ? j : null;
    if (!rec || hasPrereqProvision(rec)) return j;
    const src = byName.get(String(rec.name ?? ""));
    if (!src) return j;
    changed = true;
    return { ...rec, prereqProvision: src.prereqProvision };
  });
  return changed ? out : null;
}
function schedulerPatch(existingJobs, incomingJobs) {
  if (!Array.isArray(existingJobs) || !Array.isArray(incomingJobs)) return null;
  const byName = /* @__PURE__ */ new Map();
  for (const j of incomingJobs) {
    const rec = j !== null && typeof j === "object" && !Array.isArray(j) ? j : null;
    if (rec && hasSchedulerMs(rec)) byName.set(String(rec.name ?? ""), rec);
  }
  let changed = false;
  const out = existingJobs.map((j) => {
    const rec = j !== null && typeof j === "object" && !Array.isArray(j) ? j : null;
    if (!rec || hasSchedulerMs(rec)) return j;
    const src = byName.get(String(rec.name ?? ""));
    if (!src) return j;
    changed = true;
    return { ...rec, schedulerMs: src.schedulerMs };
  });
  return changed ? out : null;
}
function enrichable(existing, incoming) {
  const patch = {};
  if (!(typeof existing.testFiles === "number" && Number.isInteger(existing.testFiles))) {
    if (typeof incoming.testFiles === "number" && Number.isInteger(incoming.testFiles)) {
      patch.testFiles = incoming.testFiles;
    }
  }
  const prereqJobs = prereqPatch(existing.jobs, incoming.jobs);
  const prereqPatched = prereqJobs !== null;
  const baseJobs = prereqJobs ?? existing.jobs;
  const schedJobs = schedulerPatch(baseJobs, incoming.jobs);
  const schedulerPatched = schedJobs !== null;
  const jobs = schedJobs ?? prereqJobs;
  if (jobs !== null) patch.jobs = jobs;
  if (Object.keys(patch).length === 0) return null;
  return { patch, prereqPatched, schedulerPatched };
}
function writeCarrier(carrierPath, records, knownFlakes) {
  const seen = existingKeys(carrierPath);
  const out = [];
  let skipped = 0;
  let attributed = 0;
  const byKey = /* @__PURE__ */ new Map();
  for (const rec of records) byKey.set(`${String(rec.workflow ?? "")}|${String(rec.runId ?? "")}`, rec);
  for (const rec of records) {
    const key = `${String(rec.workflow ?? "")}|${String(rec.runId ?? "")}`;
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    const final = withAttribution(rec, knownFlakes);
    if (typeof final.attribution === "string") attributed += 1;
    out.push(JSON.stringify(final));
  }
  if (out.length > 0) {
    fs3.mkdirSync(path3.dirname(carrierPath), { recursive: true });
    fs3.appendFileSync(carrierPath, out.join("\n") + "\n");
  }
  let enriched = 0;
  let enrichedPrereq = 0;
  let enrichedScheduler = 0;
  let existingText = null;
  try {
    existingText = fs3.readFileSync(carrierPath, "utf8");
  } catch {
    existingText = null;
  }
  if (existingText !== null) {
    const lines = existingText.split("\n");
    let changed = false;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t === "") continue;
      let rec;
      try {
        rec = JSON.parse(t);
      } catch {
        continue;
      }
      const key = `${String(rec.workflow ?? "")}|${String(rec.runId ?? "")}`;
      const incoming = byKey.get(key);
      if (!incoming) continue;
      const enr = enrichable(rec, incoming);
      if (enr === null) continue;
      if ("testFiles" in enr.patch) enriched += 1;
      if (enr.prereqPatched) enrichedPrereq += 1;
      if (enr.schedulerPatched) enrichedScheduler += 1;
      lines[i] = JSON.stringify({ ...rec, ...enr.patch });
      changed = true;
    }
    if (changed) {
      const tmp = `${carrierPath}.tmp-${process.pid}`;
      fs3.writeFileSync(tmp, lines.join("\n"));
      fs3.renameSync(tmp, carrierPath);
    }
  }
  return { appended: out.length, skipped, attributed, enriched, enrichedPrereq, enrichedScheduler };
}
var COLLECT_STATE_REL = path3.join(".quay", "ci-runs-collect-state.json");
var DEFAULT_COLLECT_THROTTLE_MS = 6e5;
function readState(statePath) {
  try {
    const parsed = JSON.parse(fs3.readFileSync(statePath, "utf8"));
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}
function writeState(statePath, state) {
  try {
    fs3.mkdirSync(path3.dirname(statePath), { recursive: true });
    const tmp = `${statePath}.tmp-${process.pid}`;
    fs3.writeFileSync(tmp, JSON.stringify(state) + "\n");
    fs3.renameSync(tmp, statePath);
  } catch {
  }
}
function collectForRound(root, opts = {}) {
  const carrier = opts.carrier ?? path3.join(root, CARRIER_REL);
  const statePath = opts.statePath ?? path3.join(root, COLLECT_STATE_REL);
  const base = {
    status: "error",
    ran: false,
    reason: "",
    carrier,
    appended: 0,
    skipped: 0,
    attributed: 0,
    enriched: 0,
    enrichedPrereq: 0,
    enrichedScheduler: 0,
    logsFetched: 0,
    testFilesDerived: 0,
    prereqProvisionDerived: 0,
    schedulerMsDerived: 0,
    warnings: []
  };
  const now = opts.now ?? Date.now();
  const state = readState(statePath);
  const throttleMs = opts.throttleMs ?? DEFAULT_COLLECT_THROTTLE_MS;
  if (throttleMs > 0) {
    const last = state.lastRunAt;
    if (typeof last === "number" && now - last < throttleMs) {
      return {
        ...base,
        status: "throttled",
        reason: `\u8DDD\u4E0A\u6B21\u91C7\u96C6 ${Math.round((now - last) / 1e3)}s < \u8282\u6D41 ${Math.round(throttleMs / 1e3)}s`
      };
    }
  }
  const repo = opts.repo !== void 0 ? opts.repo : repoFromRemote(root);
  if (repo === null || repo === void 0 || repo === "") {
    return { ...base, status: "error", reason: `\u4ECE ${root} \u7684 origin remote \u63A8\u4E0D\u51FA owner/name` };
  }
  const ghRes = resolveGhBin(opts.env ?? process.env, opts.ghIsExec);
  if (ghRes.bin === null && opts.run === void 0) {
    return {
      ...base,
      status: "gh-unavailable",
      reason: `\u89E3\u6790\u4E0D\u51FA gh \u53EF\u6267\u884C\u6587\u4EF6\uFF08\u6765\u6E90 ${ghRes.source}\uFF09\u2014\u2014 \u26D4 \u8FD9\u4E0D\u662F\u300C\u6CA1\u6709 run\u300D`,
      warnings: [`gh-candidates:${ghRes.candidates.join(",") || "(\u7A7A)"}`]
    };
  }
  const warnings = [];
  let result;
  try {
    result = collect({
      repo,
      ...opts.workflow ? { workflow: opts.workflow } : {},
      limit: opts.limit ?? 20,
      ...opts.branch ? { branch: opts.branch } : {},
      logFetch: "decisive",
      maxLogRuns: opts.maxLogRuns ?? DEFAULT_MAX_LOG_RUNS,
      knownTestFiles: knownTestFilesFromCarrier(carrier),
      knownPrereqRuns: knownPrereqRunsFromCarrier(carrier),
      knownSchedulerRuns: knownSchedulerRunsFromCarrier(carrier),
      skipLogRuns: new Set(Object.keys(state.underivable ?? {})),
      ...opts.run ? { run: opts.run } : {}
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const kind = e instanceof GhUnavailableError ? "gh-unavailable" : "error";
    return { ...base, status: kind, reason: `\u91C7\u96C6\u5931\u8D25: ${msg}`, warnings };
  }
  warnings.push(...result.warnings);
  let res = {
    appended: 0,
    skipped: 0,
    attributed: 0,
    enriched: 0,
    enrichedPrereq: 0,
    enrichedScheduler: 0
  };
  try {
    const knownFlakes = loadKnownFlakes(defaultKnownFlakesPath());
    if (knownFlakes === null) warnings.push("known-flakes-unreadable:\u672C\u6B21\u5224\u4E0D\u51FA known-flake");
    res = writeCarrier(carrier, result.records, knownFlakes);
  } catch (e) {
    return {
      ...base,
      status: "error",
      reason: `\u5199\u8F7D\u4F53\u5931\u8D25: ${e instanceof Error ? e.message : String(e)}`,
      warnings
    };
  }
  const underivable = { ...state.underivable ?? {} };
  for (const w of result.warnings) {
    const m = /^testFiles-underivable:(.+)$/.exec(w);
    if (m && !(m[1] in underivable)) underivable[m[1]] = new Date(now).toISOString();
  }
  writeState(statePath, { lastRunAt: now, underivable });
  return {
    status: "ok",
    ran: true,
    reason: `\u91C7\u96C6 ${result.records.length} \u6761\uFF0C\u8FFD\u52A0 ${res.appended} \u6761\uFF0C\u8865\u5168 testFiles ${res.enriched} \u6761 / prereqProvision ${res.enrichedPrereq} \u6761 / schedulerMs ${res.enrichedScheduler} \u6761`,
    carrier,
    appended: res.appended,
    skipped: res.skipped,
    attributed: res.attributed,
    enriched: res.enriched,
    enrichedPrereq: res.enrichedPrereq,
    enrichedScheduler: res.enrichedScheduler,
    logsFetched: result.logRunsFetched,
    testFilesDerived: result.records.filter((r) => typeof r.testFiles === "number").length,
    prereqProvisionDerived: result.records.filter((r) => (r.jobs ?? []).some((j) => hasPrereqProvision(j))).length,
    schedulerMsDerived: result.records.filter((r) => (r.jobs ?? []).some((j) => hasSchedulerMs(j))).length,
    warnings
  };
}
function repoFromRemote(cwd) {
  try {
    const url = execFileSync2("git", ["-C", cwd, "remote", "get-url", "origin"], {
      encoding: "utf8",
      timeout: 1e4,
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    const m = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}
function usage2() {
  return [
    "ci-runs-collect.ts \u2014 \u628A GitHub Actions run \u7ED3\u8BBA\u5199\u8FDB .quay/ci-runs.jsonl\uFF08failure \u5E26 attribution\uFF09",
    "",
    "\u7528\u6CD5:",
    "  --root <dir>          \u4ED3\u5E93/\u5DE5\u4F5C\u533A\u6839\uFF08\u9ED8\u8BA4 repoRoot()\uFF09",
    "  --carrier <path>      \u8F7D\u4F53\u8DEF\u5F84\uFF08\u9ED8\u8BA4 <root>/.quay/ci-runs.jsonl\uFF09",
    "  --repo <owner/name>   GitHub \u4ED3\u5E93\uFF08\u9ED8\u8BA4\u4ECE origin remote \u63A8\uFF09",
    "  --workflow <file>     workflow \u6587\u4EF6\u540D\uFF08\u5982 ci.yml\uFF09",
    "  --branch <name>       \u53EA\u53D6\u8BE5\u5206\u652F",
    "  --limit <n>           \u53D6\u591A\u5C11\u6761 run\uFF08\u9ED8\u8BA4 20\uFF09",
    "  --fetch-logs          \u7B49\u4EF7\u4E8E --log-fetch=all\uFF08\u5BF9\u6BCF\u6761 run \u90FD\u62C9\u65E5\u5FD7\uFF1B\u6162\uFF09",
    "  --log-fetch <mode>    none | decisive\uFF08\u9ED8\u8BA4\uFF09| all \u2014\u2014 decisive \u53EA\u5BF9 conclusion \u2208 success|failure",
    "                        \u7684 run \u62C9\u65E5\u5FD7\uFF08\u5224\u636E\u80FD\u8BB0\u5206\u7684\u90A3\u4E9B\uFF1Bcancelled \u7EA6\u5360 develop run \u7684 43%\uFF09",
    "  --max-log-runs <n>    \u5355\u6B21\u8C03\u7528\u4E3A\u4E00\u4E2A run \u62C9\u65E5\u5FD7\u7684\u4E0A\u754C\uFF08\u9ED8\u8BA4 25\uFF1B\u8D85\u51FA\u7559 log-budget-exhausted \u8B66\u544A\uFF09",
    "  --gh <path>           gh \u53EF\u6267\u884C\u6587\u4EF6\u8DEF\u5F84\uFF08\u7B49\u4EF7\u4E8E env QUAY_GH_BIN\uFF1B\u7F3A\u7701 PATH + \u5E38\u89C1\u5B89\u88C5\u4F4D\uFF09",
    "  --from-file <path>    \u79BB\u7EBF\u7F1D\uFF1A\u8BFB\u4E00\u4EFD gh \u5F62\u72B6\u7684 run \u6570\u7EC4\uFF0C\u4E0D\u8C03 gh\uFF08\u540C\u4E00\u6761\u5199\u8DEF\u5F84\uFF09",
    "  --print               \u6253\u5370\u672C\u6B21\u5199\u51FA\u7684\u8BB0\u5F55",
    "  --dry-run             \u53EA\u7B97\u4E0D\u5199",
    "  --help"
  ].join("\n");
}
function main2(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage2());
    return 0;
  }
  const flag = (n) => flagValue(argv, n) ?? null;
  const root = flag("--root") ?? repoRoot();
  const carrier = flag("--carrier") ?? path3.join(root, CARRIER_REL);
  const workflow = flag("--workflow");
  const branch = flag("--branch") ?? void 0;
  const limit = Number(flag("--limit") ?? "20");
  const fromFile = flag("--from-file");
  const dryRun = argv.includes("--dry-run");
  let repo = flag("--repo");
  if (repo === null) {
    repo = repoFromRemote(root);
    if (repo === null) {
      console.error("\u65E0\u6CD5\u4ECE origin remote \u63A8\u51FA owner/name \u2014\u2014 \u663E\u5F0F\u4F20 --repo");
      return 1;
    }
  }
  let runs;
  if (fromFile !== null) {
    try {
      const parsed = JSON.parse(fs3.readFileSync(fromFile, "utf8"));
      if (!Array.isArray(parsed)) {
        console.error(`\u8BFB\u4E0D\u61C2 ${fromFile}: \u9876\u5C42\u4E0D\u662F\u6570\u7EC4`);
        return 1;
      }
      runs = parsed;
    } catch (e) {
      console.error(`\u8BFB\u4E0D\u61C2 ${fromFile}: ${e instanceof Error ? e.message : String(e)}`);
      return 1;
    }
  }
  const knownFlakes = loadKnownFlakes(defaultKnownFlakesPath());
  if (knownFlakes === null) {
    console.error(`\u26A0 \u5DF2\u77E5 flake \u767B\u8BB0\u8868\u8BFB\u4E0D\u5230\u6216\u683C\u5F0F\u975E\u6CD5\uFF1A${defaultKnownFlakesPath()} \u21D2 \u672C\u6B21\u5224\u4E0D\u51FA known-flake`);
  }
  const logFetchArg = flag("--log-fetch") ?? (argv.includes("--fetch-logs") ? "all" : "decisive");
  if (!["none", "decisive", "all"].includes(logFetchArg)) {
    console.error(`--log-fetch \u53D6\u503C\u975E\u6CD5: ${logFetchArg}\uFF08\u53D6 none | decisive | all\uFF09`);
    return 2;
  }
  const maxLogRuns = Number(flag("--max-log-runs") ?? String(DEFAULT_MAX_LOG_RUNS));
  const ghPath = flag("--gh");
  if (ghPath !== null) process.env.QUAY_GH_BIN = ghPath;
  let result;
  try {
    result = collect({
      repo,
      ...workflow ? { workflow } : {},
      limit,
      ...branch ? { branch } : {},
      logFetch: logFetchArg,
      maxLogRuns,
      // 增量回填：载体现有 testFiles / prereqProvision / schedulerMs 喂进来 ⇒ 已派生过的 run 不重复
      // 下载日志。⛔ 三个闸门都要接上：漏掉哪个，那个字段对「已派生过前两个量的 run」就结构性不可派生。
      knownTestFiles: knownTestFilesFromCarrier(carrier),
      knownPrereqRuns: knownPrereqRunsFromCarrier(carrier),
      knownSchedulerRuns: knownSchedulerRunsFromCarrier(carrier),
      ...runs ? { runs } : {}
    });
  } catch (e) {
    console.error(`\u91C7\u96C6\u5931\u8D25: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  for (const w of result.warnings) console.error(`\u26A0 ${w}`);
  if (dryRun) {
    for (const r of result.records) console.log(JSON.stringify(withAttribution(r, knownFlakes)));
  } else {
    const res = writeCarrier(carrier, result.records, knownFlakes);
    console.log(
      `carrier=${carrier} appended=${res.appended} skipped=${res.skipped} attributed=${res.attributed} enriched=${res.enriched} enrichedPrereq=${res.enrichedPrereq} enrichedScheduler=${res.enrichedScheduler} logRunsFetched=${result.logRunsFetched} testFilesDerived=${result.records.filter((r) => typeof r.testFiles === "number").length} prereqProvisionDerived=${result.records.filter((r) => (r.jobs ?? []).some((j) => hasPrereqProvision(j))).length} schedulerMsDerived=${result.records.filter((r) => (r.jobs ?? []).some((j) => hasSchedulerMs(j))).length}`
    );
    if (argv.includes("--print")) {
      for (const r of result.records) console.log(JSON.stringify(withAttribution(r, knownFlakes)));
    }
  }
  return 0;
}
if (process.argv[1] && path3.basename(process.argv[1]).replace(/\.(?:js|ts|mjs)$/, "") === "ci-runs-collect") {
  process.exit(main2(process.argv.slice(2)));
}
export {
  CARRIER_REL,
  COLLECT_STATE_REL,
  DEFAULT_COLLECT_THROTTLE_MS,
  DEFAULT_LOG_JOB_RE,
  DEFAULT_MAX_LOG_RUNS,
  GROUP_FILES_RE,
  GhUnavailableError,
  NOT_STARTED_CAUSE_MAX_CHARS,
  PREREQ_ABSENT,
  PREREQ_ALREADY_PRESENT,
  PREREQ_INSTALLED_APT,
  PREREQ_INSTALLED_PIP,
  PREREQ_MARKER_RE,
  PREREQ_NAMES,
  PREREQ_VOCAB,
  RELEASE_WORKFLOW_NAMES,
  SCHEDULER_MS_RE,
  SEA_VERIFY_ABSENT,
  SEA_VERIFY_FAILURE,
  SEA_VERIFY_INCOMPLETE,
  SEA_VERIFY_JOB_BASES,
  SEA_VERIFY_SUCCESS,
  buildRecord,
  collect,
  collectForRound,
  defaultGhRunner,
  deriveNotStartedCause,
  derivePrereqProvision,
  deriveSchedulerMs,
  deriveSeaVerify,
  deriveTestFilesFromLog,
  existingKeys,
  hasPrereqProvision,
  hasSchedulerMs,
  knownPrereqRunsFromCarrier,
  knownSchedulerRunsFromCarrier,
  knownTestFilesFromCarrier,
  main2 as main,
  parseJobTimeouts,
  repoFromRemote,
  resolveGhBin,
  toJobReadings,
  withAttribution,
  writeCarrier
};
