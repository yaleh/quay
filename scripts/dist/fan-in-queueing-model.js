#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-3UCaVR/scripts/fan-in-queueing-model.ts
import fs3 from "node:fs";
import path3 from "node:path";
import { spawnSync } from "node:child_process";

// .tmp-dist-publish-worktrees/publish-3UCaVR/scripts/fan-in-ff-protocol-check.ts
import fs2 from "node:fs";
import path2 from "node:path";
import { execFileSync } from "node:child_process";

// .tmp-dist-publish-worktrees/publish-3UCaVR/scripts/gate-script-base.ts
import fs from "node:fs";
import path from "node:path";
function flagValue(argv, name) {
  const idx = argv.indexOf(name);
  return idx === -1 ? void 0 : argv[idx + 1];
}
function readJsonlLines(file) {
  if (!fs.existsSync(file)) return null;
  const out = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      out.push({ __unparseable: true });
    }
  }
  return out;
}
function isDirectEntry(importMeta, argv1, expectedBase) {
  void importMeta;
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  return path.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
}

// .tmp-dist-publish-worktrees/publish-3UCaVR/scripts/fan-in-ff-protocol-check.ts
var FAN_IN_MERGE_SUBJECT_RE = /\bmerge: fan-in |Merge (remote-tracking )?branch 'task\/[^']*'( into develop)?$/i;
var ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
var HEX40_RE = /^[0-9a-f]{40}$/;
function checkNonFfFanIn(mergeSubjects) {
  const violations = (mergeSubjects ?? []).filter((s) => FAN_IN_MERGE_SUBJECT_RE.test(String(s ?? "")));
  if (violations.length > 0) {
    return { ok: false, violations, evaluated: true, reason: "non-ff-fan-in-merge-on-develop" };
  }
  return { ok: true, violations: [], evaluated: true, reason: "no-non-ff-fan-in-merge" };
}
function lockHoldKey(e) {
  const taskId = e?.taskId ?? "?";
  const runId = e?.runId ?? "?";
  const pid = e?.pid ?? "?";
  return `${taskId}|${runId}|${pid}`;
}
function buildLockHoldIntervals(events) {
  const intervals = [];
  const open = /* @__PURE__ */ new Map();
  let malformed = false;
  for (const e of events) {
    if (!e || e.event !== "acquire" && e.event !== "release") {
      malformed = true;
      continue;
    }
    if (typeof e.epoch !== "number" || Number.isNaN(e.epoch)) {
      malformed = true;
      continue;
    }
    const key = lockHoldKey(e);
    if (e.event === "acquire") {
      if (open.has(key)) {
        malformed = true;
        continue;
      }
      open.set(key, e.epoch);
    } else {
      const start = open.get(key);
      if (start == null) {
        malformed = true;
        continue;
      }
      intervals.push({ start, end: e.epoch, key, taskId: e.taskId });
      open.delete(key);
    }
  }
  if (open.size > 0) malformed = true;
  return { intervals, malformed };
}
function checkSuiteInLock(holdIntervals, suiteRun) {
  if (suiteRun == null) {
    return { ok: true, overlaps: [], evaluated: false, reason: "no-suite-run-interval" };
  }
  const suiteTaskId = suiteRun.taskId;
  const overlaps = holdIntervals.filter((h) => {
    const temporalOverlap = h.start <= suiteRun.end && h.end >= suiteRun.start;
    if (!temporalOverlap) return false;
    if (suiteTaskId != null) return h.taskId === suiteTaskId;
    return true;
  });
  if (overlaps.length > 0) {
    return { ok: false, overlaps, evaluated: true, reason: "suite-call-inside-merge-lock" };
  }
  return { ok: true, overlaps: [], evaluated: true, reason: "no-suite-lock-overlap" };
}
function checkSuiteCoveredByFanInLock(fanInHoldIntervals, suiteRun) {
  const holds = (fanInHoldIntervals ?? []).filter(Boolean);
  if (suiteRun == null) {
    return { ok: true, evaluated: false, reason: "no-suite-run-interval" };
  }
  if (holds.length === 0) {
    return { ok: true, evaluated: false, reason: "no-fan-in-lock-holds" };
  }
  if (suiteRun.taskId == null) {
    return { ok: true, evaluated: false, reason: "suite-run-lacks-task-id (NOT-EVALUATED)" };
  }
  const sameTaskHolds = holds.filter((h) => h.taskId === suiteRun.taskId);
  if (sameTaskHolds.length === 0) {
    return { ok: true, evaluated: false, reason: "no-matching-task-fan-in-lock-hold (NOT-EVALUATED)" };
  }
  const covers = sameTaskHolds.some((h) => h.start <= suiteRun.start && h.end >= suiteRun.end);
  if (!covers) {
    return { ok: false, evaluated: true, reason: "suite-run-outside-fan-in-lock" };
  }
  return { ok: true, evaluated: true, reason: "suite-covered-by-fan-in-lock" };
}
function checkLockHoldDuration(intervals, maxSeconds) {
  const list = (intervals ?? []).filter(Boolean);
  if (list.length === 0) {
    return { ok: true, violations: [], evaluated: false, reason: "no-lock-hold-intervals" };
  }
  const violations = list.filter((h) => h.end - h.start > maxSeconds);
  if (violations.length > 0) {
    return { ok: false, violations, evaluated: true, reason: "lock-hold-covers-non-ff-action" };
  }
  return { ok: true, violations: [], evaluated: true, reason: "all-lock-holds-ms-scale" };
}
function checkRetryRecordShape(records) {
  const bad = [];
  (records ?? []).forEach((r, i) => {
    if (!r || typeof r !== "object") {
      bad.push(`[${i}] not-an-object`);
      return;
    }
    if (typeof r.taskId !== "string" || !r.taskId) bad.push(`[${i}] missing/invalid taskId`);
    if (!Number.isInteger(r.attempt) || r.attempt < 1) bad.push(`[${i}] attempt must be an int \u2265 1 (got ${r.attempt})`);
    if (typeof r.developHead !== "string" || !HEX40_RE.test(r.developHead)) bad.push(`[${i}] developHead must be 40-hex (got ${r.developHead})`);
    if (typeof r.ts !== "string" || !ISO_TS_RE.test(r.ts)) bad.push(`[${i}] ts must be ISO \u2026Z (got ${r.ts})`);
  });
  if (bad.length > 0) {
    return { ok: false, bad, evaluated: true, reason: "malformed-retry-record" };
  }
  return { ok: true, bad: [], evaluated: true, reason: "retry-record-shape-ok" };
}
function gitLogMergeSubjects(root, baseline, develop) {
  try {
    const out = execFileSync(
      "git",
      ["-C", root, "log", `${baseline}..${develop}`, "--merges", "--format=%s"],
      { encoding: "utf8", timeout: 1e4, stdio: ["ignore", "pipe", "ignore"] }
    );
    return out.trim().split("\n").filter(Boolean);
  } catch {
    return null;
  }
}
function suiteRunInterval(root, suiteStateFile) {
  if (!fs2.existsSync(suiteStateFile)) return null;
  let d;
  try {
    d = JSON.parse(fs2.readFileSync(suiteStateFile, "utf8"));
  } catch {
    return null;
  }
  if (d == null || typeof d !== "object") return null;
  const started = d.startedAt ?? d.started;
  let start = null;
  if (typeof started === "number") start = started;
  else if (typeof started === "string") {
    const t = Date.parse(started.replace("Z", "+00:00"));
    if (!Number.isNaN(t)) start = t / 1e3;
  }
  if (start == null) return null;
  let end = null;
  if (typeof d.finishedAt === "number") end = d.finishedAt;
  else if (typeof d.finishedAt === "string") {
    const t = Date.parse(d.finishedAt.replace("Z", "+00:00"));
    if (!Number.isNaN(t)) end = t / 1e3;
  }
  if (end == null) end = Math.floor(Date.now() / 1e3);
  if (end < start) end = start;
  const taskId = typeof d.taskId === "string" && d.taskId ? d.taskId : null;
  return { start, end, taskId };
}
var usage = `fan-in-ff-protocol-check.ts \u2014 AC62 protocol checker (\u5224\u636E2 \u80FD\u53D6\u5047 / \u5224\u636E3 \u5931\u8D25\u8DEF\u5F84)
  non-ff fan-in merge on develop \u21D2 red; suite call inside the locked section \u21D2 red;
  malformed ff-retry record \u21D2 red (tasks/gap-ac62-fan-in-ff-merge-lock-protocol)

Usage:
  node --experimental-strip-types fan-in-ff-protocol-check.ts [--root <dir>] [--develop <ref>]
      [--baseline <ref>] [--lock-events <file>] [--suite-state <file>] [--retry-record <file>]
      [--json] [--help]

  --root <dir>          repo root (default: cwd). Default artifact paths resolve under its .quay/.
  --develop <ref>       the merge-target ref to scan for non-ff fan-ins (default: develop)
  --baseline <ref>      \u5224\u636E2a: only fan-in merges NEWER than this commit are violations. WITHOUT a
                        baseline the checker is NOT-EVALUATED (cannot tell new from history).
  --lock-events <file>  \u5224\u636E2b: the fan-in-ff-merge.sh lock-event log (default <root>/.quay/fan-in-
                        merge-lock-events.jsonl)
  --fan-in-lock-events <file>  \u5224\u636E4: the fan-in lock-event log (default
                        <root>/.quay/fan-in-lock-events.jsonl)
  --suite-state <file>  \u5224\u636E2b: the suite-state file (default <root>/.quay/full-suite-state.json)
  --retry-record <file> \u5224\u636E3: the ff retry-record log (default <root>/.quay/fan-in-retries.jsonl)
  --max-hold-seconds <n> \u5224\u636E1 (AC62 \u552F\u4E00\u52A8\u4F5C=ff): a lock-hold interval LONGER than this many seconds
                        \u21D2 RED (ff-only is milliseconds; >60s means the lock covered something else).
                        Default 60. Pass --max-hold-seconds 0 to judge any non-zero hold as red.
  --json                machine-readable output { evaluated, ok, checks:[...], reason }
  --help                this help

Exit codes:
  0  PASS or NOT-EVALUATED (read \`evaluated\` \u2014 false = could not judge, never conflated with green)
  1  RED \u2014 a protocol violation (non-ff fan-in / suite-in-lock / non-ff lock-hold / malformed retry record)
  2  usage / environment error`;
function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(usage + "\n");
    return 0;
  }
  const root = path2.resolve(flagValue(args, "--root") ?? process.cwd());
  const develop = flagValue(args, "--develop") ?? "develop";
  const baseline = flagValue(args, "--baseline");
  const lockEventsFile = path2.resolve(flagValue(args, "--lock-events") ?? path2.join(root, ".quay", "fan-in-merge-lock-events.jsonl"));
  const fanInLockEventsFile = path2.resolve(flagValue(args, "--fan-in-lock-events") ?? path2.join(root, ".quay", "fan-in-lock-events.jsonl"));
  const suiteStateFile = path2.resolve(flagValue(args, "--suite-state") ?? path2.join(root, ".quay", "full-suite-state.json"));
  const retryRecordFile = path2.resolve(flagValue(args, "--retry-record") ?? path2.join(root, ".quay", "fan-in-retries.jsonl"));
  const rawMaxHold = flagValue(args, "--max-hold-seconds");
  const maxHoldSeconds = rawMaxHold != null ? Number(rawMaxHold) : 60;
  if (rawMaxHold != null && (!Number.isFinite(maxHoldSeconds) || maxHoldSeconds < 0)) {
    process.stderr.write(`fan-in-ff-protocol-check: --max-hold-seconds must be a non-negative number (got '${rawMaxHold}')
`);
    return 2;
  }
  const asJson = args.includes("--json");
  const checks = [];
  let anyEvaluated = false;
  let anyRed = false;
  if (baseline != null) {
    const subjects = gitLogMergeSubjects(root, baseline, develop);
    if (subjects == null) {
      checks.push({ check: "non-ff-fan-in", evaluated: false, ok: true, reason: "baseline-or-develop-unresolvable" });
    } else {
      const v = checkNonFfFanIn(subjects);
      anyEvaluated = true;
      if (!v.ok) anyRed = true;
      checks.push({ check: "non-ff-fan-in", evaluated: v.evaluated, ok: v.ok, violations: v.violations, reason: v.reason });
    }
  } else {
    checks.push({ check: "non-ff-fan-in", evaluated: false, ok: true, reason: "no-baseline (NOT-EVALUATED)" });
  }
  const events = readJsonlLines(lockEventsFile);
  if (events == null) {
    checks.push({ check: "suite-in-lock", evaluated: false, ok: true, reason: "no-lock-events-file" });
  } else {
    const unparseable = events.some((e) => e && e.__unparseable);
    if (unparseable) {
      checks.push({ check: "suite-in-lock", evaluated: false, ok: true, reason: "malformed-lock-events (NOT-EVALUATED)" });
    } else {
      const { intervals, malformed } = buildLockHoldIntervals(events);
      if (malformed) {
        checks.push({ check: "suite-in-lock", evaluated: false, ok: true, reason: "unpaired-lock-events (NOT-EVALUATED)" });
        checks.push({ check: "lock-hold-only-ff", evaluated: false, ok: true, reason: "unpaired-lock-events (NOT-EVALUATED)" });
      } else {
        const suiteRun = suiteRunInterval(root, suiteStateFile);
        const v = checkSuiteInLock(intervals, suiteRun);
        if (v.evaluated) anyEvaluated = true;
        if (!v.ok) anyRed = true;
        checks.push({ check: "suite-in-lock", evaluated: v.evaluated, ok: v.ok, overlaps: v.overlaps, reason: v.reason });
        const v1 = checkLockHoldDuration(intervals, maxHoldSeconds);
        if (v1.evaluated) anyEvaluated = true;
        if (!v1.ok) anyRed = true;
        checks.push({ check: "lock-hold-only-ff", evaluated: v1.evaluated, ok: v1.ok, violations: v1.violations, reason: v1.reason });
      }
    }
  }
  const fanInEvents = readJsonlLines(fanInLockEventsFile);
  if (fanInEvents == null) {
    checks.push({ check: "fan-in-lock-covers-suite", evaluated: false, ok: true, reason: "no-fan-in-lock-events-file" });
  } else {
    const unparseableFanIn = fanInEvents.some((e) => e && e.__unparseable);
    if (unparseableFanIn) {
      checks.push({ check: "fan-in-lock-covers-suite", evaluated: false, ok: true, reason: "malformed-fan-in-lock-events (NOT-EVALUATED)" });
    } else {
      const { intervals: fanInIntervals, malformed: fanInMalformed } = buildLockHoldIntervals(fanInEvents);
      if (fanInMalformed) {
        checks.push({ check: "fan-in-lock-covers-suite", evaluated: false, ok: true, reason: "unpaired-fan-in-lock-events (NOT-EVALUATED)" });
      } else {
        const suiteRun = suiteRunInterval(root, suiteStateFile);
        const v4 = checkSuiteCoveredByFanInLock(fanInIntervals, suiteRun);
        if (v4.evaluated) anyEvaluated = true;
        if (!v4.ok) anyRed = true;
        checks.push({ check: "fan-in-lock-covers-suite", evaluated: v4.evaluated, ok: v4.ok, reason: v4.reason });
      }
    }
  }
  const records = readJsonlLines(retryRecordFile);
  if (records == null) {
    checks.push({ check: "retry-record-shape", evaluated: true, ok: true, reason: "no-retry-record-file (nothing to validate)" });
  } else {
    const unparseable = records.some((r) => r && r.__unparseable);
    if (unparseable) {
      checks.push({ check: "retry-record-shape", evaluated: true, ok: false, reason: "unparseable-retry-record-line" });
      anyRed = true;
    } else {
      const v = checkRetryRecordShape(records);
      anyEvaluated = true;
      if (!v.ok) anyRed = true;
      checks.push({ check: "retry-record-shape", evaluated: v.evaluated, ok: v.ok, bad: v.bad, reason: v.reason });
    }
  }
  const result = {
    evaluated: anyEvaluated,
    ok: !anyRed,
    reason: anyRed ? "protocol-violation" : anyEvaluated ? "pass" : "not-evaluated",
    checks
  };
  if (asJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    console.log(`fan-in-ff-protocol-check: evaluated=${result.evaluated} ok=${result.ok} (${result.reason})`);
    for (const c of checks) {
      const tag = c.evaluated ? c.ok ? "OK" : "RED" : "NOT-EVALUATED";
      console.log(`  ${tag} ${c.check} \u2014 ${c.reason}${c.violations?.length ? ` (${c.violations.length} fan-in merge commit(s))` : ""}${c.bad?.length ? ` (${c.bad.length} malformed)` : ""}`);
    }
  }
  return anyRed ? 1 : 0;
}
if (isDirectEntry(import.meta, void 0, "fan-in-ff-protocol-check")) {
  const code = main(process.argv);
  process.exitCode = code;
}

// .tmp-dist-publish-worktrees/publish-3UCaVR/scripts/fan-in-queueing-model.ts
var NOT_EVALUATED = "NOT-EVALUATED";
function percentile(sorted, p) {
  if (sorted.length === 0) return NOT_EVALUATED;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[i];
}
function dist(xs) {
  if (xs.length === 0) {
    return { n: 0, min: NOT_EVALUATED, median: NOT_EVALUATED, p90: NOT_EVALUATED, max: NOT_EVALUATED, mean: NOT_EVALUATED };
  }
  const s = [...xs].sort((a, b) => a - b);
  return {
    n: s.length,
    min: s[0],
    median: percentile(s, 0.5),
    p90: percentile(s, 0.9),
    max: s[s.length - 1],
    mean: s.reduce((a, b) => a + b, 0) / s.length
  };
}
function isoToMs(ts) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/.exec(ts);
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? Math.round(Number(`0.${m[7]}`) * 1e3) : 0);
  return Number.isFinite(ms) ? ms : null;
}
function readLockEvents(file) {
  let text;
  try {
    text = fs3.readFileSync(file, "utf8");
  } catch {
    return { events: [], malformed: 0, missing: true };
  }
  const events = [];
  let malformed = 0;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let o;
    try {
      o = JSON.parse(t);
    } catch {
      malformed++;
      continue;
    }
    if (!o || typeof o !== "object" || Array.isArray(o)) {
      malformed++;
      continue;
    }
    events.push(o);
  }
  return { events, malformed, missing: false };
}
function pairLockHolds(events) {
  const open = /* @__PURE__ */ new Map();
  const holds = [];
  let unpairedReleases = 0;
  for (const e of events) {
    const epoch = e.epoch;
    if (typeof epoch !== "number" || !Number.isFinite(epoch)) continue;
    const key = lockHoldKey(e);
    if (e.event === "acquire") {
      open.set(key, epoch);
    } else if (e.event === "release") {
      const a = open.get(key);
      if (a === void 0) {
        unpairedReleases++;
        continue;
      }
      open.delete(key);
      holds.push({
        taskId: typeof e.taskId === "string" ? e.taskId : null,
        runId: typeof e.runId === "string" ? e.runId : null,
        acquire: a,
        release: epoch,
        holdSecs: Math.max(0, epoch - a)
      });
    }
  }
  holds.sort((x, y) => x.acquire - y.acquire);
  return { holds, unpairedAcquires: open.size, unpairedReleases, malformedLines: 0 };
}
function listFanInAttemptFiles(root) {
  const dir = path3.join(root, ".quay");
  let names;
  try {
    names = fs3.readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((n) => n.startsWith("fan-in-") && n.endsWith(".log") && !n.startsWith("fan-in-suite-")).map((n) => path3.join(dir, n)).sort();
}
function splitFanInLogName(base) {
  const m = /^fan-in-(.*?)-(wk-[A-Za-z0-9-]+)\.log$/.exec(base);
  if (!m) return { task: base.replace(/^fan-in-/, "").replace(/\.log$/, ""), runId: "" };
  return { task: m[1], runId: m[2] };
}
function parseFanInAttempts(text, file) {
  const base = path3.basename(file);
  const { task, runId } = splitFanInLogName(base);
  const entries = [];
  let malformed = 0;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let o;
    try {
      o = JSON.parse(t);
    } catch {
      malformed++;
      continue;
    }
    if (!o || typeof o !== "object" || Array.isArray(o)) continue;
    const rec = o;
    if (typeof rec.step !== "string" || typeof rec.ts !== "string") continue;
    const tsMs = isoToMs(rec.ts);
    if (tsMs === null) continue;
    entries.push({ step: rec.step, tsMs, wallMs: typeof rec.wall_ms === "number" ? rec.wall_ms : null });
  }
  if (malformed > 0) {
  }
  const attempts = [];
  let cur = null;
  const push = (releaseTsMs) => {
    if (!cur) return;
    const suiteEntries = cur.steps.filter((s) => s.step === "suite-end");
    const suiteSecs = suiteEntries.length ? suiteEntries.reduce((a, s) => a + (s.wallMs ?? 0), 0) / 1e3 : NOT_EVALUATED;
    const otherSecs = cur.steps.filter((s) => s.step !== "suite-end").reduce((a, s) => a + (s.wallMs ?? 0), 0) / 1e3;
    const totalSecs = releaseTsMs === null ? NOT_EVALUATED : (releaseTsMs - cur.acquireTsMs) / 1e3 + cur.waitSecs;
    const residual = typeof totalSecs === "number" && totalSecs > 0 ? Math.abs(totalSecs - (cur.waitSecs + (typeof suiteSecs === "number" ? suiteSecs : 0) + otherSecs)) / totalSecs : NOT_EVALUATED;
    attempts.push({
      file,
      task,
      runId,
      waitSecs: cur.waitSecs,
      acquireTsMs: cur.acquireTsMs,
      releaseTsMs,
      steps: cur.steps,
      suiteSecs,
      otherSecs,
      totalSecs,
      residual
    });
    cur = null;
  };
  for (const e of entries) {
    if (e.step === "acquire-fan-in-lock") {
      push(null);
      cur = { waitSecs: (e.wallMs ?? 0) / 1e3, acquireTsMs: e.tsMs, steps: [] };
    } else if (e.step === "release-fan-in-lock" && cur) {
      push(e.tsMs);
    } else if (cur) {
      cur.steps.push(e);
    }
  }
  push(null);
  return attempts;
}
function readAllAttempts(root) {
  const files = listFanInAttemptFiles(root);
  const attempts = [];
  let malformedFiles = 0;
  for (const f of files) {
    let text;
    try {
      text = fs3.readFileSync(f, "utf8");
    } catch {
      malformedFiles++;
      continue;
    }
    const got = parseFanInAttempts(text, f);
    if (got.length === 0) malformedFiles++;
    attempts.push(...got);
  }
  return { attempts, files: files.length, malformedFiles };
}
function busySecsInWindow(holds, loSec, hiSec) {
  let busy = 0;
  for (const h of holds) {
    const lo = Math.max(h.acquire, loSec);
    const hi = Math.min(h.release, hiSec);
    if (hi > lo) busy += hi - lo;
  }
  return busy;
}
function hourlyRho(holds, loSec, hiSec) {
  const out = [];
  const first = Math.floor(loSec / 3600) * 3600;
  for (let h = first; h <= hiSec; h += 3600) {
    const hi = Math.min(h + 3600, hiSec);
    const lo = Math.max(h, loSec);
    if (hi <= lo) continue;
    out.push({
      hour: h,
      rho: busySecsInWindow(holds, h, h + 3600) / 3600,
      arrivals: holds.filter((x) => x.acquire >= lo && x.acquire < hi).length
    });
  }
  return out;
}
function computeModel(holds, waits, inSystemSecs) {
  const ne = (v) => Number.isFinite(v) ? v : NOT_EVALUATED;
  if (holds.length === 0) {
    return {
      window: { fromSec: NOT_EVALUATED, toSec: NOT_EVALUATED, wallSecs: NOT_EVALUATED, days: NOT_EVALUATED },
      holdSecs: dist([]),
      waitSecs: dist(waits),
      rho: NOT_EVALUATED,
      lambdaPerSec: NOT_EVALUATED,
      lambdaPerDay: NOT_EVALUATED,
      L_byLittle: NOT_EVALUATED,
      L_timeAverage: NOT_EVALUATED,
      capacityPerDay: NOT_EVALUATED,
      headroomFactor: NOT_EVALUATED,
      perHourRho: { n: 0, median: NOT_EVALUATED, p90: NOT_EVALUATED, max: NOT_EVALUATED, fracGe090: NOT_EVALUATED },
      tailNote: "\u9501\u4E8B\u4EF6\u8F7D\u4F53\u4E3A\u7A7A \u21D2 \u6392\u961F\u6A21\u578B NOT-EVALUATED\uFF08\u26D4 \u4E0D\u662F\u300C\u03C1=0\u300D\uFF09"
    };
  }
  const fromSec = holds[0].acquire;
  const toSec = holds.reduce((m, h) => Math.max(m, h.release), holds[0].release);
  const wallSecs = Math.max(0, toSec - fromSec);
  const busy = holds.reduce((a, h) => a + h.holdSecs, 0);
  const rho = wallSecs > 0 ? busy / wallSecs : NOT_EVALUATED;
  const lambdaPerSec = wallSecs > 0 ? holds.length / wallSecs : NOT_EVALUATED;
  const lambdaPerDay = typeof lambdaPerSec === "number" ? lambdaPerSec * 86400 : NOT_EVALUATED;
  const meanHold = busy / holds.length;
  const capacityPerDay = meanHold > 0 ? 86400 / meanHold : NOT_EVALUATED;
  const meanWait = waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : null;
  const W = meanWait === null ? null : meanHold + meanWait;
  const L_byLittle = typeof lambdaPerSec === "number" && W !== null ? lambdaPerSec * W : NOT_EVALUATED;
  const L_timeAverage = wallSecs > 0 ? inSystemSecs.reduce((a, b) => a + b, 0) / wallSecs : NOT_EVALUATED;
  const hrs = hourlyRho(holds, fromSec, toSec);
  const hrRhos = hrs.map((h) => h.rho).sort((a, b) => a - b);
  const headroomFactor = typeof lambdaPerDay === "number" && lambdaPerDay > 0 && typeof capacityPerDay === "number" ? capacityPerDay / lambdaPerDay : NOT_EVALUATED;
  return {
    window: { fromSec, toSec, wallSecs, days: ne(wallSecs / 86400) },
    holdSecs: dist(holds.map((h) => h.holdSecs)),
    waitSecs: dist(waits),
    rho: ne(rho),
    lambdaPerSec: ne(lambdaPerSec),
    lambdaPerDay,
    L_byLittle,
    L_timeAverage,
    capacityPerDay,
    headroomFactor,
    perHourRho: {
      n: hrs.length,
      median: percentile(hrRhos, 0.5),
      p90: percentile(hrRhos, 0.9),
      max: hrRhos.length ? hrRhos[hrRhos.length - 1] : NOT_EVALUATED,
      fracGe090: hrs.length ? hrs.filter((h) => h.rho >= 0.9).length / hrs.length : NOT_EVALUATED
    },
    tailNote: "\u7B49\u5F85\u65F6\u95F4\u662F\u91CD\u5C3E\uFF1A\u4E2D\u4F4D\u4E0E\u5747\u503C\u5DEE\u4E09\u4E2A\u6570\u91CF\u7EA7\uFF08\u591A\u6570\u5230\u8FBE\u649E\u4E0A\u7A7A\u95F2\u9501\uFF0C\u5C11\u6570\u649E\u5728\u5FD9\u671F\u5C3E\u90E8\uFF09\u3002\u26D4 \u53EA\u770B\u4E2D\u4F4D\u6570\u4F1A\u5F97\u51FA\u300C\u6CA1\u6709\u6392\u961F\u300D\uFF0C\u53EA\u770B\u5747\u503C\u4F1A\u5F97\u51FA\u300C\u5168\u662F\u6392\u961F\u300D\u2014\u2014\u4E24\u8005\u90FD\u662F\u540C\u4E00\u4EFD\u6570\u636E\u7684\u7247\u9762\u8BFB\u6CD5\u3002"
  };
}
function waitVsRho(waitsAtMs, hrs) {
  const bands = [
    [0, 0.25],
    [0.25, 0.5],
    [0.5, 0.75],
    [0.75, 0.9],
    [0.9, 1.01]
  ];
  const byHour = /* @__PURE__ */ new Map();
  for (const h of hrs) byHour.set(h.hour, h.rho);
  return bands.map(([lo, hi]) => {
    const ws = waitsAtMs.filter((w) => {
      const r = byHour.get(Math.floor(w.tsMs / 36e5) * 3600);
      return typeof r === "number" && r >= lo && r < hi;
    }).map((w) => w.waitSecs).sort((a, b) => a - b);
    return {
      rhoLo: lo,
      rhoHi: hi,
      n: ws.length,
      medianWaitSecs: percentile(ws, 0.5),
      p90WaitSecs: percentile(ws, 0.9),
      meanWaitSecs: ws.length ? ws.reduce((a, b) => a + b, 0) / ws.length : NOT_EVALUATED
    };
  });
}
function concurrencVsThroughput(outcomes, landingsByDay, landingsReadError = null) {
  const byDay = /* @__PURE__ */ new Map();
  let maxSeenInFlight = 0;
  for (const o of outcomes) {
    if (!o.day) continue;
    const cur = byDay.get(o.day) ?? { max: 0, wallMs: 0 };
    if (typeof o.inFlight === "number") {
      cur.max = Math.max(cur.max, o.inFlight);
      maxSeenInFlight = Math.max(maxSeenInFlight, o.inFlight);
    }
    cur.wallMs += o.wallMs ?? 0;
    byDay.set(o.day, cur);
  }
  const groups = /* @__PURE__ */ new Map();
  for (const [day, v] of byDay) {
    const landings = landingsByDay.get(day);
    if (landings === void 0) continue;
    const workerHours = v.wallMs / 36e5;
    const slots = Math.max(1, v.max) * 24;
    const row = { landings, workerHours, slotUtil: workerHours / slots };
    const g = groups.get(v.max) ?? [];
    g.push(row);
    groups.set(v.max, g);
  }
  const levels = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([maxInFlight, rows]) => {
    const ls = rows.map((r) => r.landings).sort((a, b) => a - b);
    const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NOT_EVALUATED;
    return {
      maxInFlight,
      days: rows.length,
      meanLandings: mean(ls),
      medianLandings: percentile(ls, 0.5),
      meanWorkerHours: mean(rows.map((r) => r.workerHours)),
      meanSlotUtil: mean(rows.map((r) => r.slotUtil))
    };
  });
  return {
    levels,
    landingsReadError,
    observedCap: maxSeenInFlight > 0 ? maxSeenInFlight : NOT_EVALUATED,
    confound: "\u26D4 \u6863\u4F4D\u4E0D\u662F\u968F\u673A\u5206\u914D\u7684\uFF1A\u5E76\u53D1 cap \u7531\u8D44\u6E90\u95F8\uFF08avg300\uFF09\u81EA\u9002\u5E94\u9009\u51FA\uFF08GO=5 / WAIT=2 / EXTREME=1\uFF09\uFF0C\u4E14\u4F4E\u6863\u65E5\u5F80\u5F80\u540C\u65F6\u662F\u300C\u6C60\u91CC\u6CA1\u8D27\u300D\u7684\u65E5 \u21D2 \u4F4E\u6863\u4F4D\u7684\u4F4E\u843D\u5730\u6570\u662F**\u56E0\u679C\u53CC\u5411**\u7684\uFF0C\u4E0D\u80FD\u8BFB\u6210\u300C\u5E76\u53D1\u4F4E \u21D2 \u541E\u5410\u4F4E\u300D\u3002\u672C\u8868\u53EA\u80FD\u62A5\u51FA\u5B9E\u6D4B\u5173\u7CFB\uFF0C\u4E0D\u80FD\u8BC1\u56E0\u679C\u3002"
  };
}
function readWorkerOutcomes(root) {
  const file = path3.join(root, ".quay", "worker-outcome.jsonl");
  let text;
  try {
    text = fs3.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let o;
    try {
      o = JSON.parse(t);
    } catch {
      continue;
    }
    if (!o || typeof o !== "object" || Array.isArray(o)) continue;
    const r = o;
    const ts = typeof r.ts === "string" ? r.ts : "";
    out.push({
      day: ts.slice(0, 10),
      inFlight: typeof r.in_flight_count === "number" ? r.in_flight_count : null,
      wallMs: typeof r.wall_clock_ms === "number" ? r.wall_clock_ms : null
    });
  }
  return out;
}
function readLandingsByDay(root, ref = "develop") {
  const r = spawnSync("git", ["log", ref, "--format=%aI|%s"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024
  });
  const out = /* @__PURE__ */ new Map();
  if (r.status !== 0 || r.error) {
    return { landings: /* @__PURE__ */ new Map(), error: r.error ? `spawnSync: ${r.error.message}` : `git log ${ref} exit ${r.status}` };
  }
  for (const line of (r.stdout ?? "").split("\n")) {
    const idx = line.indexOf("|");
    if (idx < 0) continue;
    const iso = line.slice(0, idx);
    const subj = line.slice(idx + 1);
    const m = /^tasks: 翻 (\S+) done（/.exec(subj) ?? /^tasks: 翻 (\S+)（/.exec(subj);
    if (!m) continue;
    const day = iso.slice(0, 10);
    const set = out.get(day) ?? /* @__PURE__ */ new Set();
    set.add(m[1]);
    out.set(day, set);
  }
  return { landings: new Map([...out.entries()].map(([d, s]) => [d, s.size])), error: null };
}
function buildReport(root) {
  const lockFile = path3.join(root, ".quay", "fan-in-lock-events.jsonl");
  const le = readLockEvents(lockFile);
  const pairing = pairLockHolds(le.events);
  const { attempts, files, malformedFiles } = readAllAttempts(root);
  const waits = attempts.map((a) => a.waitSecs);
  const inSystem = attempts.filter((a) => a.releaseTsMs !== null).map((a) => (a.releaseTsMs - (a.acquireTsMs - a.waitSecs * 1e3)) / 1e3);
  const model = computeModel(pairing.holds, waits, inSystem);
  const withSuite = attempts.filter((a) => typeof a.suiteSecs === "number");
  const totals = attempts.map((a) => a.totalSecs).filter((x) => typeof x === "number" && x > 0);
  const resid = attempts.map((a) => a.residual).filter((x) => typeof x === "number");
  const sumTotal = totals.reduce((a, b) => a + b, 0);
  const sumWait = attempts.reduce((a, b) => a + b.waitSecs, 0);
  const sumSuite = withSuite.reduce((a, b) => a + b.suiteSecs, 0);
  const sumOther = attempts.reduce((a, b) => a + b.otherSecs, 0);
  const covered = sumWait + sumSuite + sumOther;
  const hrs = hourlyRho(pairing.holds, model.window.fromSec === NOT_EVALUATED ? 0 : model.window.fromSec, model.window.toSec === NOT_EVALUATED ? 0 : model.window.toSec);
  const wvr = waitVsRho(
    attempts.map((a) => ({ tsMs: a.acquireTsMs, waitSecs: a.waitSecs })),
    hrs
  );
  const outcomes = readWorkerOutcomes(root);
  const landingsRead = readLandingsByDay(root);
  const cvt = concurrencVsThroughput(outcomes, landingsRead.landings, landingsRead.error);
  const hiBand = wvr[wvr.length - 1];
  const loBand = wvr[0];
  const medWait = model.waitSecs.median;
  const reverseIndicator = model.rho;
  const reverseIndicatorHolds = typeof reverseIndicator === "number" && typeof medWait === "number" && typeof loBand?.medianWaitSecs === "number" ? reverseIndicator < 0.5 && loBand.medianWaitSecs < 1 : NOT_EVALUATED;
  return {
    model,
    decomposition: {
      n: attempts.length,
      medianTotalSecs: percentile([...totals].sort((a, b) => a - b), 0.5),
      medianWaitSecs: percentile([...waits].sort((a, b) => a - b), 0.5),
      medianSuiteSecs: percentile(withSuite.map((a) => a.suiteSecs).sort((a, b) => a - b), 0.5),
      medianOtherSecs: percentile(attempts.map((a) => a.otherSecs).sort((a, b) => a - b), 0.5),
      residual: dist(resid),
      residualOver15Pct: resid.filter((r) => r >= 0.15).length,
      residualP90Ok: resid.length ? percentile([...resid].sort((a, b) => a - b), 0.9) < 0.15 : NOT_EVALUATED,
      aggregateShareWaitPct: covered > 0 ? sumWait / covered * 100 : NOT_EVALUATED,
      aggregateShareSuitePct: covered > 0 ? sumSuite / covered * 100 : NOT_EVALUATED,
      aggregateShareOtherPct: covered > 0 ? sumOther / covered * 100 : NOT_EVALUATED,
      attemptsWithoutSuite: attempts.length - withSuite.length
    },
    waitVsRho: wvr,
    concurrency: cvt,
    falsifier: {
      claim: "\u7ED3\u8BBA\u300C\u74F6\u9888\u5728\u6392\u961F\u800C\u975E\u8BA1\u7B97\u300D\u7684\u53CD\u5411\u8BFB\u6CD5\u662F\uFF1A\u82E5\u541E\u5410\u53D7\u8BA1\u7B97\u9650\u5236\uFF0C\u5219\u9501\u5229\u7528\u7387\u5E94\u8FDC\u4F4E\u4E8E 1\uFF0C\u4E14\u7B49\u5F85\u65F6\u95F4\u5E94\u63A5\u8FD1 0\u3002",
      reverseIndicator: "\u03C1\uFF08\u7A97\u53E3\u9501\u5229\u7528\u7387\uFF09\u4E0E\u4F4E \u03C1 \u6863\uFF08\u03C1<0.25\uFF09\u7684\u7B49\u5F85\u4E2D\u4F4D\u6570",
      reverseIndicatorMeasured: reverseIndicator,
      reverseIndicatorHolds,
      note: `\u4F4E \u03C1 \u6863\uFF08\u03C1<0.25\uFF09\u7B49\u5F85\u4E2D\u4F4D = ${String(loBand?.medianWaitSecs)} s\uFF08n=${loBand?.n ?? 0}\uFF09\uFF1B\u9AD8 \u03C1 \u6863\uFF08\u03C1\u22650.9\uFF09\u7B49\u5F85\u4E2D\u4F4D = ${String(hiBand?.medianWaitSecs)} s\uFF08n=${hiBand?.n ?? 0}\uFF09\u3002\u26D4 \u53CD\u5411\u6307\u6807**\u90E8\u5206\u6210\u7ACB**\uFF1A\u805A\u5408\u5C42 \u03C1=${fmt(reverseIndicator)} \u8FDC\u4F4E\u4E8E 1 \u21D2 \u805A\u5408\u541E\u5410**\u4E0D**\u53D7\u9501\u9650\u5236\uFF1B\u4F46\u5B9E\u6D4B knee \u5728 \u03C1\u22480.75\uFF1A\u03C1<0.75 \u4E09\u6863\u7684\u7B49\u5F85**\u4E2D\u4F4D**\u90FD \u22480.1 s\uFF08= \u8FDB\u7A0B\u542F\u52A8\u5F00\u9500\uFF0C\u5373\u300C\u6CA1\u6392\u961F\u300D\uFF09\uFF0C\u8DE8\u8FC7 \u03C1=0.75 \u540E\u4E2D\u4F4D\u8DF3\u5230 ${String(wvr[3]?.medianWaitSecs)} s\u3001\u03C1\u22650.9 \u518D\u5230 ${String(hiBand?.medianWaitSecs)} s\u3002\u21D2 **\u5C3E\u90E8\u5EF6\u8FDF**\u7531\u6392\u961F\u652F\u914D\uFF0C\u800C\u805A\u5408\u541E\u5410\u4E0D\u7531\u5B83\u652F\u914D\u3002\u4E24\u4E2A\u8BFB\u6CD5\u90FD\u6210\u7ACB\u3001\u4E92\u4E0D\u77DB\u76FE\uFF08\u5747\u503C\u4E0E\u4E2D\u4F4D\u5728\u540C\u4E00\u4EFD\u91CD\u5C3E\u6570\u636E\u4E0A\u7684\u4E24\u79CD\u6295\u5F71\uFF09\uFF0C\u6307\u5411\u7684\u7ED3\u8BBA\u4E0D\u540C\u2014\u2014\u8FD9\u6B63\u662F\u5FC5\u987B\u540C\u65F6\u62A5\u51FA\u7684\u539F\u56E0\u3002`
    },
    carriers: {
      "fan-in-lock-events": `${lockFile}\uFF1Aholds=${pairing.holds.length} unpairedAcquires=${pairing.unpairedAcquires} unpairedReleases=${pairing.unpairedReleases} malformed=${le.malformed}${le.missing ? `\uFF08\u7F3A\u5931 \u21D2 NOT-EVALUATED\uFF09` : ""}`,
      "fan-in-per-run-logs": `${path3.join(root, ".quay", "fan-in-*.log")}\uFF1Afiles=${files} attempts=${attempts.length} unreadable=${malformedFiles}`,
      "worker-outcome": `${path3.join(root, ".quay", "worker-outcome.jsonl")}\uFF1Arows=${outcomes.length}`,
      "git-log-develop-landings": landingsRead.error ? `ref=develop \u8BFB\u53D6\u5931\u8D25 \u21D2 NOT-EVALUATED\uFF08${landingsRead.error}\uFF09` : `ref=develop days=${landingsRead.landings.size}`
    }
  };
}
function fmt(v) {
  if (v === NOT_EVALUATED) return NOT_EVALUATED;
  if (typeof v === "number") {
    if (Number.isInteger(v)) return String(v);
    return Math.abs(v) < 1 ? String(Number(v.toFixed(4))) : v.toFixed(1);
  }
  return String(v);
}
function renderHuman(r) {
  const L = [];
  L.push("fan-in \u6392\u961F\u8BBA\u6A21\u578B \u2014 \u52A0\u5E76\u53D1\u5230\u5E95\u63D0\u541E\u5410\u8FD8\u662F\u53EA\u52A0\u957F\u961F\u5217");
  L.push("");
  L.push("\u8F7D\u4F53\uFF1A");
  for (const [k, v] of Object.entries(r.carriers)) L.push(`  ${k}: ${v}`);
  L.push("");
  L.push(`\u7A97\u53E3 ${fmt(r.model.window.days)} \u5929\uFF08wall ${fmt(r.model.window.wallSecs)} s\uFF09`);
  L.push("");
  L.push("\u516D\u4E2A\u5FC5\u9700\u91CF\uFF1A");
  L.push(`  \u7B49\u5F85\u65F6\u95F4\u5206\u5E03(s)  n=${r.model.waitSecs.n} median=${fmt(r.model.waitSecs.median)} p90=${fmt(r.model.waitSecs.p90)} max=${fmt(r.model.waitSecs.max)} mean=${fmt(r.model.waitSecs.mean)}`);
  L.push(`  \u9501\u6301\u6709\u5206\u5E03(s)    n=${r.model.holdSecs.n} median=${fmt(r.model.holdSecs.median)} p90=${fmt(r.model.holdSecs.p90)} max=${fmt(r.model.holdSecs.max)} mean=${fmt(r.model.holdSecs.mean)}`);
  L.push(`  \u9501\u5229\u7528\u7387 \u03C1       ${fmt(r.model.rho)}`);
  L.push(`  \u5230\u8FBE\u7387 \u03BB         ${fmt(r.model.lambdaPerDay)} /\u5929`);
  L.push(`  \u5E73\u5747\u5728\u7CFB\u7EDF\u6570 L   ${fmt(r.model.L_byLittle)}\uFF08Little \u03BB\xB7W\uFF09 / \u65F6\u95F4\u5E73\u5747 ${fmt(r.model.L_timeAverage)}`);
  L.push(`  \u5355\u670D\u52A1\u5668\u5BB9\u91CF     1/E[S] = ${fmt(r.model.capacityPerDay)} /\u5929 \u21D2 \u03C1=1 \u7684\u5230\u8FBE\u7387\u500D\u6570\u4F59\u91CF ${fmt(r.model.headroomFactor)}\xD7`);
  L.push("");
  L.push(`\u6BCF\u5C0F\u65F6 \u03C1\uFF1An=${r.model.perHourRho.n} median=${fmt(r.model.perHourRho.median)} p90=${fmt(r.model.perHourRho.p90)} max=${fmt(r.model.perHourRho.max)} \u03C1\u22650.9 \u5360 ${fmt(r.model.perHourRho.fracGe090)}`);
  L.push("");
  L.push("\u4E09\u6BB5\u62C6\u5206\uFF08\u6BCF\u6B21 fan-in \u5C1D\u8BD5\uFF09\uFF1A");
  L.push(`  n=${r.decomposition.n}  \u4E2D\u4F4D total=${fmt(r.decomposition.medianTotalSecs)}s wait=${fmt(r.decomposition.medianWaitSecs)}s suite=${fmt(r.decomposition.medianSuiteSecs)}s other=${fmt(r.decomposition.medianOtherSecs)}s`);
  L.push(`  \u6B8B\u5DEE median=${fmt(r.decomposition.residual.median)} p90=${fmt(r.decomposition.residual.p90)} \u8D85 15% \u7684\u5C1D\u8BD5 ${r.decomposition.residualOver15Pct}/${r.decomposition.n}`);
  L.push(`  \u805A\u5408\u5360\u6BD4 wait=${fmt(r.decomposition.aggregateShareWaitPct)}% suite=${fmt(r.decomposition.aggregateShareSuitePct)}% other=${fmt(r.decomposition.aggregateShareOtherPct)}%`);
  L.push("");
  L.push("\u5B9E\u6D4B wait-vs-\u03C1\uFF08\u552F\u4E00\u53EF\u53D6\u5047\u7684\u7ED3\u8BBA\u8F7D\u4F53\uFF09\uFF1A");
  for (const b of r.waitVsRho) {
    L.push(`  \u03C1\u2208[${b.rhoLo},${b.rhoHi}) n=${String(b.n).padStart(4)} median=${fmt(b.medianWaitSecs)}s p90=${fmt(b.p90WaitSecs)}s mean=${fmt(b.meanWaitSecs)}s`);
  }
  L.push("");
  L.push(`\u5E76\u53D1\u5EA6 vs \u541E\u5410\uFF08\u89C2\u6D4B cap=${fmt(r.concurrency.observedCap)}\uFF09\uFF1A`);
  if (r.concurrency.landingsReadError) L.push(`  \u26D4 \u843D\u5730\u6570\u8BFB\u53D6\u5931\u8D25 \u21D2 \u672C\u8868 NOT-EVALUATED\uFF1A${r.concurrency.landingsReadError}`);
  for (const l of r.concurrency.levels) {
    L.push(`  maxIF=${l.maxInFlight} \u5929\u6570=${l.days} \u5747\u843D\u5730=${fmt(l.meanLandings)} worker\u69FD\u5229\u7528=${fmt(l.meanSlotUtil)}`);
  }
  L.push("");
  L.push("\u53EF\u53D6\u5047\uFF08AC4\uFF09\uFF1A");
  L.push(`  ${r.falsifier.claim}`);
  L.push(`  ${r.falsifier.note}`);
  L.push("");
  L.push("\u26D4 L_byLittle \u4E0E L_timeAverage \u4E00\u81F4\u662F Little's law \u7684\u6052\u7B49\u5F0F\uFF0C\u4E0D\u662F\u6A21\u578B\u9A8C\u8BC1\uFF08\u786C\u89C4\u5219 4\uFF09\u3002");
  return L.join("\n");
}
function main2(argv) {
  let root = process.cwd();
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") root = argv[++i];
    else if (argv[i] === "--json") json = true;
    else if (argv[i] === "--since") i++;
  }
  const report = buildReport(root);
  if (json) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  else process.stdout.write(renderHuman(report) + "\n");
  const noCarrier = report.model.window.fromSec === NOT_EVALUATED && report.decomposition.n === 0;
  return noCarrier ? 1 : 0;
}
var isDirect = process.argv[1] && /fan-in-queueing-model\.(ts|js)$/.test(process.argv[1]);
if (isDirect) {
  process.exit(main2(process.argv.slice(2)));
}
export {
  NOT_EVALUATED,
  buildReport,
  busySecsInWindow,
  computeModel,
  concurrencVsThroughput,
  dist,
  hourlyRho,
  isoToMs,
  listFanInAttemptFiles,
  pairLockHolds,
  parseFanInAttempts,
  percentile,
  readAllAttempts,
  readLandingsByDay,
  readLockEvents,
  readWorkerOutcomes,
  renderHuman,
  splitFanInLogName,
  waitVsRho
};
