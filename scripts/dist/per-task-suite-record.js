#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/per-task-suite-record.ts
import fs from "node:fs";
import path2 from "node:path";
import { spawnSync } from "node:child_process";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
import path from "node:path";
function flagValue(argv, name) {
  const idx = argv.indexOf(name);
  return idx === -1 ? void 0 : argv[idx + 1];
}
function isDirectEntry(importMeta, argv1, expectedBase) {
  void importMeta;
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  return path.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/per-task-suite-record.ts
var REQUIRED_FIELDS = [
  "taskId",
  "runId",
  "state",
  "laneCount",
  "durationMs",
  "startedAt",
  "finishedAt"
];
var VALID_STATES = /* @__PURE__ */ new Set(["green", "red", "running", "aborted"]);
function resolveSharedCheckout(root) {
  const r = spawnSync("git", ["-C", root, "rev-parse", "--git-common-dir"], {
    encoding: "utf8"
  });
  if (r.status !== 0) return null;
  let common = String(r.stdout ?? "").trim();
  if (!common) return null;
  if (!path2.isAbsolute(common)) common = path2.join(root, common);
  const parent = path2.dirname(common);
  return parent;
}
function toIsoTimestamp(v) {
  if (v == null || v === "") return null;
  const d = typeof v === "number" ? new Date(v * (v < 1e12 ? 1e3 : 1)) : new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
function buildRecord(o) {
  const sf = o.stateFile || {};
  const state = o.state ?? sf.state;
  if (state == null || !VALID_STATES.has(String(state))) {
    return { error: `state must be one of ${[...VALID_STATES].join("|")} (got ${JSON.stringify(state)})` };
  }
  const taskId = o.taskId ?? sf.taskId;
  if (!taskId || !String(taskId).trim()) return { error: "--task-id is required" };
  const runId = o.runId ?? sf.runId;
  if (!runId || !String(runId).trim()) return { error: "--run-id is required" };
  const laneCount = o.laneCount ?? sf.laneCount;
  if (laneCount == null || !Number.isFinite(Number(laneCount)) || Number(laneCount) < 0) {
    return { error: `laneCount must be a non-negative number (got ${JSON.stringify(laneCount)})` };
  }
  const durationMs = o.durationMs ?? sf.durationMs;
  if (durationMs == null || !Number.isFinite(Number(durationMs)) || Number(durationMs) < 0) {
    return { error: `durationMs must be a non-negative number (got ${JSON.stringify(durationMs)})` };
  }
  const startedAt = toIsoTimestamp(o.startedAt ?? sf.startedAt);
  if (startedAt == null) return { error: `startedAt must be an ISO/epoch timestamp (got ${JSON.stringify(o.startedAt ?? sf.startedAt)})` };
  const finishedAt = toIsoTimestamp(o.finishedAt ?? sf.finishedAt);
  if (finishedAt == null) return { error: `finishedAt must be an ISO/epoch timestamp (got ${JSON.stringify(o.finishedAt ?? sf.finishedAt)})` };
  let docChecked;
  if (o.docChecked != null) {
    const dc = String(o.docChecked).trim().toLowerCase();
    if (dc === "true") docChecked = true;
    else if (dc === "false") docChecked = false;
    else return { error: `--doc-checked must be true|false (got ${JSON.stringify(o.docChecked)})` };
  }
  let docCheckExit;
  if (o.docCheckExit != null) {
    if (docChecked == null) return { error: "--doc-check-exit requires --doc-checked (an exit code without a 'did it run' flag is ambiguous)" };
    const x = Number(o.docCheckExit);
    if (!Number.isInteger(x) || x < 0 || x > 255) return { error: `--doc-check-exit must be an integer 0..255 (got ${JSON.stringify(o.docCheckExit)})` };
    docCheckExit = x;
  }
  let fullSuiteRan;
  if (o.fullSuiteRan != null) {
    const fr = String(o.fullSuiteRan).trim().toLowerCase();
    if (fr === "true") fullSuiteRan = true;
    else if (fr === "false") fullSuiteRan = false;
    else return { error: `--full-suite-ran must be true|false (got ${JSON.stringify(o.fullSuiteRan)})` };
  }
  let skipReason;
  if (o.skipReason != null) {
    if (fullSuiteRan !== false) return { error: "--skip-reason requires --full-suite-ran false (a skip reason without a 'full suite was skipped' flag is ambiguous)" };
    const sr = String(o.skipReason).trim();
    if (!sr) return { error: "--skip-reason must be a non-empty string (got empty)" };
    skipReason = sr;
  }
  let cpuTimeS;
  let cpuSource;
  if (o.cpuSource != null) {
    cpuSource = String(o.cpuSource).trim();
    if (!cpuSource) return { error: "--cpu-source must be a non-empty string (got empty)" };
  }
  if (o.cpuTimeS != null) {
    const raw = String(o.cpuTimeS).trim();
    if (raw === "null" || raw === "") {
      cpuTimeS = null;
      if (cpuSource == null) cpuSource = "not-wired";
    } else {
      const v = Number(raw);
      if (!Number.isFinite(v) || v < 0) return { error: `--cpu-time-s must be a non-negative number, 0, or null (got ${JSON.stringify(o.cpuTimeS)})` };
      if (v === 0) {
        cpuTimeS = null;
        if (cpuSource == null) cpuSource = "not-wired";
      } else {
        cpuTimeS = v;
        if (cpuSource == null) cpuSource = "gnu-time";
      }
    }
  }
  let cpuUserS;
  let cpuSysS;
  const splitArgs = [
    ["cpu-user-s", o.cpuUserS, (v) => {
      cpuUserS = v;
    }],
    ["cpu-sys-s", o.cpuSysS, (v) => {
      cpuSysS = v;
    }]
  ];
  const hasRealSplit = splitArgs.some(([, raw]) => {
    if (raw == null) return false;
    const s = String(raw).trim();
    if (s === "" || s === "null") return false;
    const v = Number(s);
    return !(Number.isFinite(v) && v === 0);
  });
  if (hasRealSplit) {
    if (cpuTimeS == null) {
      return { error: "--cpu-user-s/--cpu-sys-s require a real --cpu-time-s (the gnu-time sum); a split without its sum is ambiguous" };
    }
    for (const [name, raw, setter] of splitArgs) {
      if (raw == null) continue;
      const s = String(raw).trim();
      if (s === "" || s === "null") continue;
      const v = Number(s);
      if (!Number.isFinite(v) || v < 0) {
        return { error: `--${name} must be a non-negative number, 0, or null (got ${JSON.stringify(raw)})` };
      }
      if (v === 0) continue;
      setter(v);
    }
  }
  if (fullSuiteRan === false && cpuTimeS != null) {
    return { error: "--cpu-time-s must be null (or omitted) when --full-suite-ran false \u2014 a skipped suite consumed no CPU (AC6, never 0)" };
  }
  if (fullSuiteRan === true && (cpuTimeS == null || cpuTimeS <= 0)) {
    return { error: "--full-suite-ran true requires a real --cpu-time-s (GNU-time User+System); a full suite that ran must have consumed CPU \u2014 capture not wired, fail-closed (never a silent null)" };
  }
  let load;
  if (o.load != null) {
    const v = Number(o.load);
    if (!Number.isFinite(v) || v < 0) return { error: `--load must be a non-negative number (got ${JSON.stringify(o.load)})` };
    load = v;
  }
  let phases;
  if (o.phases != null) {
    let parsed;
    try {
      parsed = JSON.parse(String(o.phases));
    } catch {
      return { error: `--phases must be a valid JSON array of phase records (got ${JSON.stringify(o.phases)})` };
    }
    if (!Array.isArray(parsed)) return { error: "--phases must be a JSON array" };
    const seen = /* @__PURE__ */ new Set();
    for (const p of parsed) {
      if (p == null || typeof p !== "object") return { error: "--phases entries must be objects" };
      const ph = p.phase;
      if (typeof ph !== "string" || !ph.trim() || seen.has(ph)) {
        return { error: `--phases entries need a unique non-empty phase name (got ${JSON.stringify(ph)})` };
      }
      seen.add(ph);
      if (p.wall_ms == null || !Number.isFinite(Number(p.wall_ms)) || Number(p.wall_ms) < 0) {
        return { error: `--phases entry ${ph} needs a non-negative wall_ms` };
      }
      for (const k of ["cpu_usec", "psi_cpu_total", "psi_io_total", "lanes"]) {
        if (p[k] != null && (!Number.isFinite(Number(p[k])) || Number(p[k]) < 0)) {
          return { error: `--phases entry ${ph}.${k} must be a non-negative number or null (got ${JSON.stringify(p[k])})` };
        }
      }
    }
    phases = parsed;
  }
  let failedFiles = [];
  if (o.failedFiles) {
    failedFiles = String(o.failedFiles).split(",").map((s) => s.trim()).filter(Boolean);
  } else if (Array.isArray(sf.failures)) {
    failedFiles = sf.failures.map((f) => f?.file).filter((f) => typeof f === "string" && f);
  }
  const record = {
    ts: (/* @__PURE__ */ new Date()).toISOString(),
    taskId: String(taskId).trim(),
    runId: String(runId).trim(),
    state: String(state),
    laneCount: Number(laneCount),
    durationMs: Number(durationMs),
    failedFiles,
    startedAt,
    finishedAt
  };
  if (docChecked != null) record.docChecked = docChecked;
  if (docCheckExit != null) record.docCheckExit = docCheckExit;
  if (fullSuiteRan != null) record.fullSuiteRan = fullSuiteRan;
  if (skipReason != null) record.skipReason = skipReason;
  if (o.cpuTimeS != null || cpuSource != null) {
    record.cpu_time_s = cpuTimeS;
    record.cpu_source = cpuSource ?? "not-wired";
    if (cpuUserS != null) record.cpu_user_s = cpuUserS;
    if (cpuSysS != null) record.cpu_sys_s = cpuSysS;
  }
  if (load != null) record.load = load;
  if (phases != null) record.phases = phases;
  return { record };
}
var usage = `per-task-suite-record.ts \u2014 AC72 \u5224\u636E2 writer: append ONE third-party-readable record for a
  per-task FULL-suite run to the SHARED checkout's .quay/per-task-suite-records.jsonl
  (taskId / runId / state / laneCount / durationMs / failed-files / \u8D77\u6B62\u65F6\u523B).

Usage:
  node --experimental-strip-types plugin/scripts/per-task-suite-record.ts
      --task-id <taskId> --run-id <runId> --state <state> --lane-count <n>
      --duration-ms <ms> --started-at <iso> --finished-at <iso>
      [--failed-files <csv>] [--doc-checked true|false] [--doc-check-exit <0..255>]
      [--full-suite-ran true|false] [--skip-reason <text>] [--cpu-time-s <n>] [--load <n>]
      [--phases <json>]
      [--state-file <full-suite-state.json>] [--root <dir>]
      [--record-file <file>] [--json] [--help]

  --task-id         the task whose per-task suite ran (required)
  --run-id          the suite runId (required)
  --state           green|red|running|aborted (required)
  --lane-count      suite lane count (required, non-negative)
  --duration-ms     suite wall-clock duration in ms (required, non-negative)
  --started-at      suite start, ISO-8601 or epoch-seconds (required)
  --finished-at     suite end, ISO-8601 or epoch-seconds (required)
  --failed-files    comma-separated failing file paths (optional; auto-extracted from
                    --state-file failures[].file when absent)
  --doc-checked     AC63 \u5224\u636E1 doc-check trace: true|false \u2014 did the fan-in's --static-checks-doc
                    run before its ff (optional; omitted when absent)
  --doc-check-exit  the doc check's exit code 0..255 (optional; REQUIRES --doc-checked)
  --full-suite-ran  gap-fan-in-suite-data-not-accounted \u5224\u636E2: true|false \u2014 did the fan-in run the
                    FULL suite vs. skipped it (a skip is a RECORDED DECISION, not a duration-
                    inference). Optional; omitted when absent (pre-wiring record)
  --skip-reason     WHY the full suite was skipped (e.g. doc-only-delta); REQUIRES
                    --full-suite-ran false (a reason without a "skipped" flag is ambiguous)
  --cpu-time-s      the suite's CPU time in seconds (GNU-time User+System on a full run) \u2014 a real
                    number, or the literal null when the source was considered and is UNAVAILABLE
                    (GNU time absent / full suite skipped). 0 is normalized to null (AC6 \u2014 0
                    conflates "instrument not wired" with "truly ~0 consumption"). Optional
  --cpu-source      WHERE the cpu_time_s value came from: 'gnu-time' for a real measurement, or
                    'not-wired' for an unavailable source (defaults: gnu-time for a real number,
                    not-wired for null/0/skip). Optional; rides the record when cpu_time_s is present
  --cpu-user-s      the suite's gnu-time USER cpu seconds \u2014 the "%U" column of the same "%U %S" line
                    whose sum is cpu_time_s. Real number or null (0 \u2192 omitted, AC6). Requires a real
                    --cpu-time-s (a split without its sum is ambiguous \u2014 fail-closed). Optional
  --cpu-sys-s       the suite's gnu-time SYSTEM cpu seconds \u2014 the "%S" column (same contract).
                    user+sys \u2248 cpu_time_s by construction (same source line). Optional
  --load            the /proc/loadavg 1min load at suite end (non-negative). Optional
  --phases          the per-phase DIFFERENTIAL breakdown as a JSON array of
                    {phase, wall_ms, cpu_usec?, psi_cpu_total?, psi_io_total?, lanes?}
                    (AC83 PhaseDiffRecord shape). Optional; shape-checked when present
  --state-file      a full-suite-state.json to draw defaults from (explicit flags win)
  --root            repo root (default: cwd) \u2014 resolves the shared checkout via git common-dir
  --record-file     override the shared-checkout record path (hermetic tests)
  --json            machine-readable output {ok, record, file}
  --help            this help

Exit codes:
  0  one record appended
  2  usage / environment error (missing/invalid field, unresolvable shared checkout) \u2014 nothing written`;
function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(usage + "\n");
    return 0;
  }
  const root = path2.resolve(flagValue(args, "--root") ?? process.cwd());
  const recordFileOverride = flagValue(args, "--record-file");
  const stateFile = flagValue(args, "--state-file");
  const asJson = args.includes("--json");
  const fail = (msg) => {
    if (asJson) console.log(JSON.stringify({ ok: false, error: msg }));
    else console.error(`per-task-suite-record: ${msg}`);
    return 2;
  };
  let stateFileValues = {};
  if (stateFile) {
    const p = path2.resolve(stateFile);
    if (!fs.existsSync(p)) return fail(`state file not found: ${p}`);
    try {
      stateFileValues = JSON.parse(fs.readFileSync(p, "utf8"));
    } catch (e) {
      return fail(`state file not valid JSON: ${p} (${e.message})`);
    }
  }
  const built = buildRecord({
    taskId: flagValue(args, "--task-id"),
    runId: flagValue(args, "--run-id"),
    state: flagValue(args, "--state"),
    laneCount: flagValue(args, "--lane-count"),
    durationMs: flagValue(args, "--duration-ms"),
    failedFiles: flagValue(args, "--failed-files"),
    startedAt: flagValue(args, "--started-at"),
    finishedAt: flagValue(args, "--finished-at"),
    docChecked: flagValue(args, "--doc-checked"),
    docCheckExit: flagValue(args, "--doc-check-exit"),
    fullSuiteRan: flagValue(args, "--full-suite-ran"),
    skipReason: flagValue(args, "--skip-reason"),
    cpuTimeS: flagValue(args, "--cpu-time-s"),
    cpuSource: flagValue(args, "--cpu-source"),
    cpuUserS: flagValue(args, "--cpu-user-s"),
    cpuSysS: flagValue(args, "--cpu-sys-s"),
    load: flagValue(args, "--load"),
    phases: flagValue(args, "--phases"),
    stateFile: stateFileValues
  });
  if (built.error) return fail(built.error);
  const record = built.record;
  let recordFile;
  if (recordFileOverride) {
    recordFile = path2.resolve(recordFileOverride);
  } else {
    const shared = resolveSharedCheckout(root);
    if (!shared) return fail(`cannot resolve the shared checkout from ${root} (git common-dir failed)`);
    recordFile = path2.join(shared, ".quay", "per-task-suite-records.jsonl");
  }
  fs.mkdirSync(path2.dirname(recordFile), { recursive: true });
  fs.appendFileSync(recordFile, JSON.stringify(record) + "\n", { encoding: "utf8", flag: "a" });
  if (asJson) {
    console.log(JSON.stringify({ ok: true, record, file: recordFile }));
  } else {
    console.log(`per-task-suite-record: appended ${record.taskId} run ${record.runId} (${record.state}) \u2192 ${recordFile}`);
  }
  return 0;
}
if (isDirectEntry(import.meta, void 0, "per-task-suite-record")) {
  process.exitCode = main(process.argv);
}
export {
  REQUIRED_FIELDS,
  buildRecord,
  main,
  resolveSharedCheckout,
  toIsoTimestamp
};
