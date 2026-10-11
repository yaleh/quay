#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/psi-window-join.ts
import fs4 from "node:fs";
import path4 from "node:path";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
import fs from "node:fs";
import path from "node:path";
function helpExit(usage) {
  process.stdout.write(usage.endsWith("\n") ? usage : usage + "\n");
  process.exit(0);
}
function parseArgs(argv, spec) {
  const result = { args: [], flags: {} };
  const raw = argv.slice(2);
  const flagDefs = spec.flags || {};
  const unknownMode = spec.unknown ?? (spec.strict ? "reject" : "accept");
  const scriptName = path.basename(argv[1] || "script");
  if (raw.includes("--help") || raw.includes("-h")) {
    if (spec.help === "return") {
      result.help = true;
      return result;
    }
    helpExit(`usage: ${scriptName} ${spec.usage}`);
  }
  const usageError = (message) => {
    if (spec.errors === "return") {
      result.error = message;
      return result;
    }
    console.error(message);
    process.exit(2);
  };
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a.startsWith("--")) {
      const eqIdx = a.indexOf("=");
      const name = eqIdx >= 0 ? a.slice(2, eqIdx) : a.slice(2);
      const def = flagDefs[name];
      if (!def && unknownMode === "reject") return usageError(`unknown argument: --${name}`);
      if (!def && unknownMode === "skip") continue;
      if (def?.type === "boolean") {
        result.flags[name] = true;
      } else if (def?.type === "string[]") {
        if (!result.lists) result.lists = {};
        const list = result.lists[name] ??= [];
        if (eqIdx >= 0) list.push(a.slice(eqIdx + 1));
        else if (def.greedy) {
          while (i + 1 < raw.length && !raw[i + 1].startsWith("--")) list.push(raw[++i]);
        } else if (i + 1 < raw.length) list.push(raw[++i]);
      } else if (eqIdx >= 0) {
        result.flags[name] = a.slice(eqIdx + 1);
      } else if (i + 1 < raw.length) {
        result.flags[name] = raw[++i];
      } else {
        result.flags[name] = "";
      }
    } else {
      result.args.push(a);
    }
  }
  const minArgs = spec.minArgs ?? 1;
  if (result.args.length < minArgs) {
    return usageError(`Usage: ${scriptName} ${spec.usage}`);
  }
  return result;
}
function readJsonLines(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line);
      if (typeof v === "object" && v !== null && !Array.isArray(v)) rows.push(v);
    } catch {
    }
  }
  return rows;
}
function isDirectEntry(importMeta, argv1, expectedBase) {
  void importMeta;
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  return path.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/perfile-failure-rate.ts
import fs3 from "node:fs";
import path3 from "node:path";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/repo-root.ts
import fs2 from "node:fs";
import path2 from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
var MAX_DEPTH = 16;
function repoRoot(startDir = path2.dirname(fileURLToPath(import.meta.url))) {
  let dir = path2.resolve(startDir);
  for (let i = 0; i < MAX_DEPTH; i++) {
    const hasPkg = fs2.existsSync(path2.join(dir, "package.json"));
    if (hasPkg && fs2.existsSync(path2.join(dir, "plugin")) && fs2.existsSync(path2.join(dir, "scripts", "test.sh"))) {
      return dir;
    }
    if (hasPkg && fs2.existsSync(path2.join(dir, ".quay", "config.yml"))) {
      return dir;
    }
    if (fs2.existsSync(path2.join(dir, ".git"))) {
      return dir;
    }
    const parent = path2.dirname(dir);
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

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/perfile-failure-rate.ts
var MIN_RUNS = 50;
function groupByFile(recs) {
  const map = /* @__PURE__ */ new Map();
  for (const r of recs) {
    const f = String(r.file ?? "");
    if (!f) continue;
    let arr = map.get(f);
    if (!arr) {
      arr = [];
      map.set(f, arr);
    }
    arr.push(r);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => (a.startedAtMs ?? 0) - (b.startedAtMs ?? 0));
  }
  return map;
}
function baselineOf(history) {
  const runs = history.length;
  const fails = history.filter((r) => r.passed === false).length;
  return { runs, fails, rate: runs > 0 ? fails / runs : 0 };
}
function classifyFailure(history, opts) {
  const minRuns = opts?.minRuns ?? MIN_RUNS;
  const { runs, fails } = baselineOf(history);
  if (runs < minRuns) return "insufficient";
  if (fails === 0) return "new-event";
  const half = Math.ceil(runs / 2);
  const earlyFails = history.slice(0, half).filter((r) => r.passed === false).length;
  const recentFails = fails - earlyFails;
  if (earlyFails === 0 && recentFails > 0) return "step-change";
  return "within-baseline";
}
function resolveCarrierRoot(argRoot) {
  if (argRoot) return argRoot;
  if (process.env.QUAY_MAIN_CHECKOUT) return process.env.QUAY_MAIN_CHECKOUT;
  return repoRoot();
}
function carrierPath(root) {
  return path3.join(root, ".quay", "verification-round.jsonl");
}
function readCarrierPerFile(root) {
  const p = carrierPath(root);
  if (!fs3.existsSync(p)) {
    return { found: false, path: p, recs: [] };
  }
  const recs = [];
  let text;
  try {
    text = fs3.readFileSync(p, "utf8");
  } catch {
    return { found: false, path: p, recs: [] };
  }
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    let obj;
    try {
      obj = JSON.parse(s);
    } catch {
      continue;
    }
    if (typeof obj !== "object" || obj === null) continue;
    const pfRaw = obj.perFile;
    if (!Array.isArray(pfRaw)) continue;
    for (const r of pfRaw) {
      if (typeof r !== "object" || r === null) continue;
      const file = r.file;
      if (typeof file !== "string" || !file) continue;
      recs.push({ file, passed: r.passed !== false, startedAtMs: typeof r.startedAtMs === "number" ? r.startedAtMs : void 0 });
    }
  }
  return { found: true, path: p, recs };
}
function computeBaselines(recs) {
  const out = /* @__PURE__ */ new Map();
  for (const [file, history] of groupByFile(recs)) {
    out.set(file, baselineOf(history));
  }
  return out;
}
function fmtRate(rate) {
  return `${(rate * 100).toFixed(4)}%`;
}
function fmtBaselineLine(file, b) {
  return `${file}: ${b.fails}/${b.runs} = ${fmtRate(b.rate)}`;
}
function summarize(recs, minRuns) {
  const baselines = computeBaselines(recs);
  const totalRecords = recs.length;
  const totalFails = recs.filter((r) => r.passed === false).length;
  const distinctFiles = baselines.size;
  let everFailed = 0;
  const top = [];
  for (const [file, b] of baselines) {
    if (b.fails > 0) everFailed++;
    if (b.runs >= minRuns && b.fails > 0) {
      top.push({ file, runs: b.runs, fails: b.fails, rate: b.rate });
    }
  }
  top.sort((a, b) => b.rate - a.rate || b.fails - a.fails || a.file.localeCompare(b.file));
  return {
    totalRecords,
    totalFails,
    overallRate: totalRecords > 0 ? totalFails / totalRecords : 0,
    distinctFiles,
    everFailed,
    neverFailed: distinctFiles - everFailed,
    top
  };
}
function parseArgs2(argv) {
  const { flags, help } = parseArgs(argv, {
    minArgs: 0,
    usage: "[--root <repo-root>] [--file <rel-file>] [--min-runs <N>] [--json] [--help]",
    help: "return",
    flags: {
      root: { type: "string" },
      file: { type: "string" },
      "min-runs": { type: "string" },
      json: { type: "boolean" }
    }
  });
  const minRuns = typeof flags["min-runs"] === "string" ? Number(flags["min-runs"]) : Number.NaN;
  return {
    root: typeof flags.root === "string" ? flags.root : "",
    file: typeof flags.file === "string" ? flags.file : "",
    minRuns: Number.isFinite(minRuns) && minRuns >= 1 ? Math.floor(minRuns) : MIN_RUNS,
    json: flags.json === true,
    help: help === true
  };
}
function printSummaryText(args, res, s) {
  console.log(`perfile-failure-rate.ts \u2014 per-file failure-rate baseline (carrier: ${res.path})`);
  console.log(`total perFile records: ${s.totalRecords} | fails: ${s.totalFails} | overall rate: ${fmtRate(s.overallRate)}`);
  console.log(`distinct files: ${s.distinctFiles} | ever-failed: ${s.everFailed} | never-failed: ${s.neverFailed}`);
  console.log(`top jitter sources (runs>=${args.minRuns}, rate desc):`);
  for (const t of s.top) {
    console.log(`  ${fmtBaselineLine(t.file, { runs: t.runs, fails: t.fails, rate: t.rate })}`);
  }
}
function printSummaryJson(res, s) {
  process.stdout.write(JSON.stringify({
    carrier: res.path,
    totalRecords: s.totalRecords,
    totalFails: s.totalFails,
    overallRate: s.overallRate,
    distinctFiles: s.distinctFiles,
    everFailed: s.everFailed,
    neverFailed: s.neverFailed,
    top: s.top
  }, null, 2) + "\n");
}
function printOneText(file, b, cls) {
  console.log(`file: ${file}`);
  console.log(`baseline: runs=${b.runs} fails=${b.fails} rate=${fmtRate(b.rate)}`);
  console.log(`classification: ${cls}`);
}
function printOneJson(file, b, cls) {
  process.stdout.write(JSON.stringify({ file, runs: b.runs, fails: b.fails, rate: b.rate, classification: cls }, null, 2) + "\n");
}
function main(argv) {
  const args = parseArgs2(argv);
  const usage = `perfile-failure-rate.ts \u2014 per-file failure-rate baseline + step-change classification
Usage:
  node --experimental-strip-types plugin/scripts/perfile-failure-rate.ts [--root <repo-root>] [--file <rel-file>] [--min-runs <N>] [--json]
  --root       carrier root (default: QUAY_MAIN_CHECKOUT \u2192 repoRoot); FAIL-CLOSED when the carrier is absent.
  --file       classify ONE repo-relative file (print {runs, fails, rate, classification}).
  --min-runs   judgeable floor (default ${MIN_RUNS}); a file with fewer runs is "insufficient".
  --json       machine-readable output.
Exit: 0 = computed; 2 = carrier not found (fail-closed) / usage.`;
  if (args.help) helpExit(usage);
  const root = resolveCarrierRoot(args.root);
  const res = readCarrierPerFile(root);
  if (!res.found) {
    process.stderr.write(`perfile-failure-rate: \u8F7D\u4F53\u672A\u627E\u5230: ${res.path} \u2014 \u5728\u5E72\u51C0 worktree \u91CC\u4E0D\u4F20 --root \u5C31\u4F1A\u8FD9\u6837\uFF08fail-closed\uFF0C\u4E0D\u662F\u7A7A\u57FA\u7EBF\u5F53\u300C\u5168\u90E8\u6CA1\u5931\u8D25\u8FC7\u300D\uFF09
`);
    return 2;
  }
  if (args.file) {
    const byFile = groupByFile(res.recs);
    const history = byFile.get(args.file) ?? [];
    const b = baselineOf(history);
    const cls = classifyFailure(history, { minRuns: args.minRuns });
    if (args.json) printOneJson(args.file, b, cls);
    else printOneText(args.file, b, cls);
    return 0;
  }
  const s = summarize(res.recs, args.minRuns);
  if (args.json) printSummaryJson(res, s);
  else printSummaryText(args, res, s);
  return 0;
}
if (isDirectEntry(import.meta, void 0, "perfile-failure-rate")) {
  process.exitCode = main(process.argv);
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/psi-window-join.ts
function loadRunSamples(root, runId) {
  const file = path4.join(root, ".quay", `suite-load-${runId}.jsonl`);
  if (!fs4.existsSync(file)) return null;
  const samples = [];
  for (const obj of readJsonLines(file)) {
    const t = obj.t;
    const cs = obj.cpu_stall;
    if (typeof t === "number" && Number.isFinite(t) && typeof cs === "number" && Number.isFinite(cs)) {
      samples.push({ t, cpu_stall: cs });
    }
  }
  samples.sort((a, b) => a.t - b.t);
  return samples;
}
function samplesInWindow(samples, startMs, endMs) {
  const out = [];
  for (const s of samples) {
    if (s.t > endMs) break;
    if (s.t >= startMs) out.push(s);
  }
  return out;
}
function windowMeanStall(samples, startMs, endMs) {
  const inWindow = samplesInWindow(samples, startMs, endMs);
  if (inWindow.length === 0) return null;
  let sum = 0;
  for (const s of inWindow) sum += s.cpu_stall;
  return sum / inWindow.length;
}
function joinFilePsiWindow(root, runId, file) {
  const vrf = path4.join(root, ".quay", "verification-round.jsonl");
  if (!fs4.existsSync(vrf)) {
    return { found: false, reason: `carrier not found: ${vrf}` };
  }
  let window = null;
  for (const raw of readJsonLines(vrf)) {
    if (typeof raw.runId !== "string" || raw.runId !== runId) continue;
    const pf = raw.perFile;
    if (!Array.isArray(pf)) continue;
    for (const r of pf) {
      if (String(r.file ?? "") !== file) continue;
      const s = r.startedAtMs;
      const e = r.endedAtMs;
      if (typeof s === "number" && Number.isFinite(s) && typeof e === "number" && Number.isFinite(e)) {
        window = { startedAtMs: s, endedAtMs: e };
        break;
      }
    }
    if (window) break;
  }
  if (!window) {
    return { found: false, reason: `perFile record not found for file="${file}" in runId="${runId}"` };
  }
  const samples = loadRunSamples(root, runId);
  if (samples === null) {
    return { found: false, reason: `suite-load carrier not found for runId="${runId}"` };
  }
  const inWindow = samplesInWindow(samples, window.startedAtMs, window.endedAtMs);
  const stallVals = inWindow.map((s) => s.cpu_stall);
  return {
    found: true,
    samples: inWindow,
    mean: stallVals.length === 0 ? Number.NaN : stallVals.reduce((a, b) => a + b, 0) / stallVals.length,
    max: stallVals.length === 0 ? Number.NaN : Math.max(...stallVals),
    sampleCount: inWindow.length
  };
}
function parseArgs3(argv) {
  const { flags, help } = parseArgs(argv, {
    minArgs: 0,
    usage: "--run-id <runId> --file <repo-relpath> [--root <repo-root>] [--json] [--help]",
    help: "return",
    flags: {
      "run-id": { type: "string" },
      file: { type: "string" },
      root: { type: "string" },
      json: { type: "boolean" }
    }
  });
  return {
    runId: typeof flags["run-id"] === "string" ? flags["run-id"] : "",
    file: typeof flags.file === "string" ? flags.file : "",
    root: typeof flags.root === "string" ? flags.root : "",
    json: flags.json === true,
    help: help === true
  };
}
function fmt(n) {
  return Number.isFinite(n) ? n.toFixed(2) : "n/a";
}
function printText(args, r) {
  if (r.found) {
    console.log(`found:true  runId=${args.runId}  file=${args.file}`);
    console.log(`sampleCount=${r.sampleCount}  mean=${fmt(r.mean)}  max=${fmt(r.max)}`);
    for (const s of r.samples) console.log(`  t=${s.t}  cpu_stall=${s.cpu_stall.toFixed(2)}`);
  } else {
    console.log(`found:false  reason=${r.reason}`);
  }
}
function main2() {
  const args = parseArgs3(process.argv);
  if (args.help) {
    process.stdout.write(
      "psi-window-join.ts \u2014 \u5355\u6D4B PSI \u65F6\u95F4\u7A97\u8054\u63A5\uFF08\u56DE\u7B54\u300C\u8FD9\u4E2A\u6D4B\u8BD5\u8FD9\u6B21\u8DD1\u7684\u65F6\u5019\u673A\u5668\u591A\u5FD9\u300D\uFF09\nusage: node --experimental-strip-types plugin/scripts/psi-window-join.ts --run-id <runId> --file <repo-relpath> [--root <repo-root>] [--json]\n"
    );
    return;
  }
  if (!args.runId || !args.file) {
    process.stderr.write("error: --run-id and --file are required\n");
    process.exitCode = 2;
    return;
  }
  const root = resolveCarrierRoot(args.root);
  const result = joinFilePsiWindow(root, args.runId, args.file);
  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    printText(args, result);
  }
  if (!result.found) process.exitCode = 2;
}
var isDirect = process.argv[1] && path4.basename(process.argv[1]).replace(/\.(?:js|ts|mjs)$/, "") === "psi-window-join";
if (isDirect) {
  main2();
}
export {
  joinFilePsiWindow,
  samplesInWindow,
  windowMeanStall
};
