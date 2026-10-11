#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/psi-failure-correlation-check.ts
import fs8 from "node:fs";
import path7 from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

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

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/canonical-test-files.ts
import fs3 from "node:fs";
import path3 from "node:path";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
import fs2 from "node:fs";
import path2 from "node:path";
function helpExit(usage) {
  process.stdout.write(usage.endsWith("\n") ? usage : usage + "\n");
  process.exit(0);
}
function parseArgs(argv, spec) {
  const result = { args: [], flags: {} };
  const raw = argv.slice(2);
  const flagDefs = spec.flags || {};
  const unknownMode = spec.unknown ?? (spec.strict ? "reject" : "accept");
  const scriptName = path2.basename(argv[1] || "script");
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
function flagValue(argv, name) {
  const idx = argv.indexOf(name);
  return idx === -1 ? void 0 : argv[idx + 1];
}
function readFileSafe(p) {
  try {
    return fs2.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}
function readJsonLines(file) {
  let text;
  try {
    text = fs2.readFileSync(file, "utf8");
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
  return path2.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/canonical-test-files.ts
function parseCanonicalGlobs(repoRoot2) {
  const src = readFileSafe(path3.join(repoRoot2, "scripts", "test.sh"));
  const m = src.match(/glob=\(([^)]*)\)/);
  if (!m) return [];
  return m[1].split(/\s+/).map((s) => s.trim()).filter(Boolean);
}
function globSegmentToRegex(seg) {
  const escaped = seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`);
}
function expandGlob(pattern, root) {
  const segments = pattern.split("/");
  let current = [root];
  for (const seg of segments) {
    if (!seg.includes("*")) {
      current = current.map((dir) => path3.join(dir, seg)).filter((p) => fs3.existsSync(p));
      continue;
    }
    const re = globSegmentToRegex(seg);
    const next = [];
    for (const dir of current) {
      let entries = [];
      try {
        entries = fs3.readdirSync(dir);
      } catch {
        entries = [];
      }
      for (const e of entries) {
        if (re.test(e)) next.push(path3.join(dir, e));
      }
    }
    current = next;
  }
  return current.filter((p) => {
    try {
      return fs3.statSync(p).isFile();
    } catch {
      return false;
    }
  });
}
function canonicalTestFiles(repoRoot2) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const pattern of parseCanonicalGlobs(repoRoot2)) {
    for (const abs of expandGlob(pattern, repoRoot2)) {
      let rp = abs;
      try {
        rp = fs3.realpathSync(abs);
      } catch {
        rp = abs;
      }
      if (seen.has(rp)) continue;
      seen.add(rp);
      out.push(path3.relative(repoRoot2, rp).split(path3.sep).join("/"));
    }
  }
  return out.sort();
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/runner-grouping.ts
import fs4 from "node:fs";
var RECOGNIZED_GROUPS = ["product", "engine", "serial", "lowconc"];
var RECOGNIZED = new Set(RECOGNIZED_GROUPS);
function isRecognizedGroup(g) {
  return RECOGNIZED.has(g);
}
function groupOf(content) {
  const m = content.match(/@test-group[ \t\v\f\r]+[a-z]+/);
  if (!m) return "engine";
  const g = m[0].split(/[ \t]+/)[1];
  return g ?? "engine";
}
function failClosed(file, g) {
  const msg = `scripts/test.sh: FAIL-CLOSED: '${file}' declares unknown @test-group '${g}' \u2014 a group was dropped or mis-typed (recognized: product|engine|serial|lowconc); refusing to silently degrade it to engine`;
  process.stderr.write(msg + "\n");
  process.exit(3);
}
function classifyFile(file) {
  let buf;
  try {
    buf = fs4.readFileSync(file);
  } catch {
    buf = Buffer.alloc(0);
  }
  if (buf.subarray(0, 32768).includes(0)) return "engine";
  const g = groupOf(buf.toString("utf8"));
  if (!isRecognizedGroup(g)) failClosed(file, g);
  return g;
}
function effectiveGroups() {
  return "product,engine";
}
function inGroup(group, csv) {
  return `,${csv},`.includes(`,${group},`);
}
function selectFiles(entries, csv) {
  const out = [];
  for (const [file, g] of entries) if (inGroup(g, csv)) out.push(file);
  return out;
}
function listGroups(entries) {
  const counts = /* @__PURE__ */ new Map();
  for (const g of RECOGNIZED_GROUPS) counts.set(g, 0);
  for (const [, g] of entries) counts.set(g, (counts.get(g) ?? 0) + 1);
  return counts;
}
function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(Buffer.from(c)));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}
function parseEntries(raw) {
  const entries = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const idx = line.indexOf("	");
    if (idx <= 0) continue;
    const file = line.slice(0, idx);
    const g = line.slice(idx + 1);
    if (!file || !g) continue;
    entries.push([file, g]);
  }
  return entries;
}
async function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stderr.write(
      "runner-grouping.ts \u2014 the --group classification/selection mechanism (TS, gap-suite-classification-lpt-scheduler-ts-ization)\nusage:\n  <path\\tgroup lines on stdin> | node runner-grouping.ts --list-groups\n  <path\\tgroup lines on stdin> | node runner-grouping.ts --select <group[,group...]>\n  <raw paths on stdin>         | node runner-grouping.ts --classify\n  node runner-grouping.ts --effective-groups\n"
    );
    return 0;
  }
  if (args[0] === "--effective-groups") {
    process.stdout.write(effectiveGroups() + "\n");
    return 0;
  }
  const raw = await readStdin();
  if (args[0] === "--list-groups") {
    const entries = parseEntries(raw);
    const counts = listGroups(entries);
    let total = 0;
    for (const g of RECOGNIZED_GROUPS) {
      const n = counts.get(g) ?? 0;
      total += n;
      process.stdout.write(`${g}:    ${n}
`);
    }
    process.stdout.write(`total:      ${total} (deduped by realpath)
`);
    return 0;
  }
  if (args[0] === "--select" && args.length >= 2) {
    const csv = args[1];
    const entries = parseEntries(raw);
    for (const file of selectFiles(entries, csv)) process.stdout.write(file + "\n");
    return 0;
  }
  if (args[0] === "--classify") {
    const paths = raw.split("\n").map((s) => s.trim()).filter((s) => s.length > 0);
    for (const p of paths) process.stdout.write(`${p}	${classifyFile(p)}
`);
    return 0;
  }
  process.stderr.write("runner-grouping.ts: unknown/missing subcommand (see --help)\n");
  return 2;
}
if (isDirectEntry(import.meta, void 0, "runner-grouping")) {
  main(process.argv).then((code) => {
    process.exitCode = code;
  });
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/psi-window-join.ts
import fs6 from "node:fs";
import path5 from "node:path";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/perfile-failure-rate.ts
import fs5 from "node:fs";
import path4 from "node:path";
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
  return path4.join(root, ".quay", "verification-round.jsonl");
}
function readCarrierPerFile(root) {
  const p = carrierPath(root);
  if (!fs5.existsSync(p)) {
    return { found: false, path: p, recs: [] };
  }
  const recs = [];
  let text;
  try {
    text = fs5.readFileSync(p, "utf8");
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
function main2(argv) {
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
  process.exitCode = main2(process.argv);
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/psi-window-join.ts
function loadRunSamples(root, runId) {
  const file = path5.join(root, ".quay", `suite-load-${runId}.jsonl`);
  if (!fs6.existsSync(file)) return null;
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
  const vrf = path5.join(root, ".quay", "verification-round.jsonl");
  if (!fs6.existsSync(vrf)) {
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
function main3() {
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
var isDirect = process.argv[1] && path5.basename(process.argv[1]).replace(/\.(?:js|ts|mjs)$/, "") === "psi-window-join";
if (isDirect) {
  main3();
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/suite-load-sampler.ts
import fs7 from "node:fs";
import path6 from "node:path";
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function readLoadavg() {
  try {
    const v = Number(fs7.readFileSync("/proc/loadavg", "utf8").trim().split(/\s+/)[0]);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}
function readCpuStall() {
  try {
    const line = fs7.readFileSync("/proc/pressure/cpu", "utf8").split("\n")[0] ?? "";
    const m = line.match(/avg10=([0-9]+(?:\.[0-9]+)?)/);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}
function readMemAvailMb() {
  try {
    const text = fs7.readFileSync("/proc/meminfo", "utf8");
    const m = text.match(/^MemAvailable:\s+(\d+)\s+kB/m);
    return m ? Number((Number(m[1]) / 1024).toFixed(1)) : null;
  } catch {
    return null;
  }
}
function isSuiteRunning(stateFile, runId) {
  let parsed = null;
  try {
    parsed = JSON.parse(fs7.readFileSync(stateFile, "utf8"));
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object") return false;
  if (parsed.finishedAt != null) return false;
  if (typeof parsed.runId === "string" && parsed.runId && parsed.runId !== runId) return false;
  return true;
}
async function main4() {
  const arg = (name) => flagValue(process.argv, `--${name}`);
  const stateFile = arg("state-file");
  const outFile = arg("out-file");
  const runId = arg("run-id");
  const rawInterval = Number(arg("interval") ?? "5");
  const intervalMs = Number.isFinite(rawInterval) && rawInterval >= 0.1 ? rawInterval * 1e3 : 5e3;
  if (!stateFile || !outFile || !runId) {
    process.stderr.write("suite-load-sampler: --state-file / --out-file / --run-id are required\n");
    process.exit(2);
  }
  try {
    fs7.mkdirSync(path6.dirname(outFile), { recursive: true });
  } catch {
  }
  try {
    fs7.writeFileSync(`${outFile}.pid`, `${process.pid}
`, "utf8");
  } catch {
  }
  const stop = () => {
    process.exit(0);
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  const hostPid = process.ppid;
  while (isSuiteRunning(stateFile, runId) && process.ppid === hostPid) {
    const rec = {
      t: Date.now(),
      loadavg: readLoadavg(),
      cpu_stall: readCpuStall(),
      mem_avail: readMemAvailMb()
    };
    try {
      fs7.appendFileSync(outFile, JSON.stringify(rec) + "\n", "utf8");
    } catch {
    }
    await sleep(intervalMs);
  }
  process.exit(0);
}
var isDirect2 = process.argv[1] && path6.basename(process.argv[1]).replace(/\.(?:js|ts|mjs)$/, "") === "suite-load-sampler";
if (isDirect2) {
  await main4();
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/psi-failure-correlation-check.ts
var DEFAULT_MIN_N_PASSIVE = 10;
var SIGNIFICANT_RUN_DELAY_RATIO = 3;
var MIN_RUN_DELAY_NS = 1e6;
var CORE_CANDIDATES = [
  "plugin/test/help-contract-incompatible-behaviors.test.mjs",
  // serial, 15x
  "plugin/test/writestate-atomicity-split-s02.test.mjs",
  // engine, 14x — torn-read negative control
  "plugin/test/worker-driver-fan-in-s02.test.mjs",
  // lowconc, 11x — 订正④ confirmed positive
  "plugin/test/worker-driver-resident-s01.test.mjs",
  // lowconc, 7x — file-level flake, all shards below
  "plugin/test/worker-driver-resident-s02.test.mjs",
  "plugin/test/worker-driver-resident-s03.test.mjs",
  "plugin/test/worker-driver-resident-s04.test.mjs",
  "plugin/test/worker-driver-resident-s05.test.mjs",
  "plugin/test/suite-bucket-reattr-ratchet-check.test.mjs",
  // engine, 5x
  "experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs",
  // 订正④ confirmed positive
  "plugin/test/full-suite-runner-phases.test.mjs"
  // 订正④ confirmed positive
];
var DEFAULT_TEST_TIMEOUT_MS = 18e4;
var CANDIDATE_CONFIG = {
  // 订正⑥: real failures cluster at 128~188s; 240s covers the upper bound. Of the three candidates the
  // only credible real reproduction — run_delay mechanism confirmation must target it first.
  "plugin/test/worker-driver-fan-in-s02.test.mjs": { timeoutMs: 24e4, histFailMs: [128e3, 188e3] },
  // 订正⑥: real failures at 386~407s; observing one needs ~450s which exceeds the <=10min total budget
  // combined with the other candidates — skip it (report 未验证), never run it under a shorter timeout.
  "plugin/test/full-suite-runner-phases.test.mjs": { timeoutMs: 45e4, histFailMs: [386e3, 407e3], unverifiableInBudget: true },
  // 订正⑥: 0 historical failures; the source carries its own hang-detection ("blocked in a futex under
  // load") — its "failure" is likely design-intent, excluded from go/no-go evidence either way.
  "experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs": { timeoutMs: DEFAULT_TEST_TIMEOUT_MS, designIntent: true }
};
var DEFAULT_INJECT_WINDOW_MS = 5e3;
var MAX_INJECT_WINDOW_MS = 1e4;
var ISOLATION_CONFLICT_RE = /EADDRINUSE|address already in use|EEXIST|file already exists|ENOTEMPTY|listen E|connect ECONNREFUSED|ECONNREFUSED|port .*in use|already in use|address already/i;
var SCHEDULING_RE = /timeout|timed ?out|deadline|exceeded|wall.?clock|elapsed|TOOK TOO LONG|timed out/i;
var BINS = [
  { lo: 1, hi: 2 },
  { lo: 3, hi: 5 },
  { lo: 6, hi: 10 },
  { lo: 11, hi: 20 },
  { lo: 21, hi: 40 },
  { lo: 41, hi: Number.POSITIVE_INFINITY }
];
function parseArgs4(argv) {
  const { flags, help } = parseArgs(argv, {
    minArgs: 0,
    usage: "[--source active|passive|both] [--root <repo-root>] [--trials N] [--load-levels 0,N] [--inject-window-ms N] [--include-all-groups] [--json] [--help]",
    help: "return",
    flags: {
      source: { type: "string" },
      root: { type: "string" },
      trials: { type: "string" },
      "load-levels": { type: "string" },
      "test-timeout-ms": { type: "string" },
      "min-n-passive": { type: "string" },
      "include-all-groups": { type: "boolean" },
      "inject-window-ms": { type: "string" },
      json: { type: "boolean" }
    }
  });
  const supplied = (v) => typeof v === "string" && v !== "" ? v : void 0;
  const numFlag = (v, dflt, ok, xform = (n) => n) => {
    const n = v === void 0 ? Number.NaN : Number(v);
    return Number.isFinite(n) && ok(n) ? xform(n) : dflt;
  };
  const source = supplied(flags.source);
  const loadLevelsRaw = supplied(flags["load-levels"]);
  const loadLevels = loadLevelsRaw === void 0 ? [] : loadLevelsRaw.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n >= 0);
  if (loadLevels.length === 0) loadLevels.push(0, 2 * os.availableParallelism());
  return {
    source: source === "active" || source === "passive" ? source : "both",
    root: supplied(flags.root) ?? "",
    trials: numFlag(supplied(flags.trials), 1, (n) => n >= 1, Math.floor),
    loadLevels,
    testTimeoutMs: numFlag(supplied(flags["test-timeout-ms"]), 18e4, (n) => n > 0, Math.floor),
    minNPassive: numFlag(supplied(flags["min-n-passive"]), DEFAULT_MIN_N_PASSIVE, (n) => n >= 1, Math.floor),
    includeAllGroups: flags["include-all-groups"] === true,
    injectWindowMs: numFlag(
      supplied(flags["inject-window-ms"]),
      DEFAULT_INJECT_WINDOW_MS,
      (n) => n >= 0,
      (n) => Math.min(Math.floor(n), MAX_INJECT_WINDOW_MS)
    ),
    json: flags.json === true,
    help: help === true
  };
}
function readRunDelayNs(pid) {
  try {
    const text = fs8.readFileSync(`/proc/${pid}/schedstat`, "utf8").trim();
    const parts = text.split(/\s+/);
    const v = Number(parts[1]);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}
function listDescendantPids(rootPid) {
  const seen = /* @__PURE__ */ new Set();
  const stack = [rootPid];
  const out = [];
  while (stack.length > 0) {
    const pid = stack.pop();
    if (seen.has(pid)) continue;
    seen.add(pid);
    out.push(pid);
    try {
      const children = fs8.readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8").trim();
      for (const c of children.split(/\s+/)) {
        const cp = Number(c);
        if (Number.isFinite(cp) && cp > 0) stack.push(cp);
      }
    } catch {
    }
  }
  return out;
}
function readTreeRunDelayNs(rootPid) {
  let sum = 0;
  for (const pid of listDescendantPids(rootPid)) {
    const v = readRunDelayNs(pid);
    if (v !== null) sum += v;
  }
  return sum;
}
var sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));
function mean(vals) {
  if (vals.length === 0) return Number.NaN;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}
function max(vals) {
  return vals.length === 0 ? Number.NaN : Math.max(...vals);
}
function pct(sorted, p) {
  if (sorted.length === 0) return Number.NaN;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
function median(sorted) {
  return pct(sorted, 0.5);
}
function fmt2(n) {
  return Number.isFinite(n) ? n.toFixed(2) : "  n/a";
}
function fmtRunDelay(ns) {
  if (!Number.isFinite(ns)) return "  n/a";
  if (ns < 1e6) return `${(ns / 1e3).toFixed(1)}\xB5s`;
  return `${(ns / 1e6).toFixed(1)}ms`;
}
function loadSamples(root) {
  const map = /* @__PURE__ */ new Map();
  const dir = path7.join(root, ".quay");
  let names;
  try {
    names = fs8.readdirSync(dir);
  } catch {
    return map;
  }
  for (const name of names) {
    if (!name.startsWith("suite-load-") || !name.endsWith(".jsonl")) continue;
    const runId = name.slice("suite-load-".length, -".jsonl".length);
    const samples = [];
    for (const obj of readJsonLines(path7.join(dir, name))) {
      const t = obj.t;
      const cs = obj.cpu_stall;
      if (typeof t === "number" && Number.isFinite(t) && typeof cs === "number" && Number.isFinite(cs)) {
        samples.push({ t, cpu_stall: cs });
      }
    }
    samples.sort((a, b) => a.t - b.t);
    if (samples.length > 0) map.set(runId, samples);
  }
  return map;
}
function midpointConcurrency(windows, s, e) {
  const mid = (s + e) / 2;
  let n = 0;
  for (const [ws, we] of windows) if (ws <= mid && mid <= we) n++;
  return n;
}
function binOf(c) {
  for (const b of BINS) if (c >= b.lo && c <= b.hi) return b;
  return BINS[BINS.length - 1];
}
function passiveAnalyze(root, minN) {
  const vrf = path7.join(root, ".quay", "verification-round.jsonl");
  if (!fs8.existsSync(vrf)) {
    return { carrierFound: false, path: vrf };
  }
  const samplesByRunId = loadSamples(root);
  const roundsWithPerFile = [];
  let matchedRounds = 0;
  let filesWithWindow = 0;
  let failTotal = 0;
  let passWithPsi = 0;
  let failWithPsi = 0;
  let noPsiInWindow = 0;
  const bins = BINS.map((b) => ({ lo: b.lo, hi: b.hi, passN: 0, passVals: [], failN: 0, failVals: [] }));
  for (const raw of readJsonLines(vrf)) {
    const pfRaw = raw.perFile;
    if (!Array.isArray(pfRaw) || pfRaw.length === 0) continue;
    roundsWithPerFile.push(1);
    const runId = typeof raw.runId === "string" ? raw.runId : "";
    const samples = runId ? samplesByRunId.get(runId) : void 0;
    if (!samples) continue;
    matchedRounds++;
    const recs = [];
    const windows = [];
    for (const r of pfRaw) {
      const s = r.startedAtMs;
      const e = r.endedAtMs;
      if (typeof s !== "number" || !Number.isFinite(s) || typeof e !== "number" || !Number.isFinite(e)) continue;
      recs.push({ file: String(r.file ?? ""), startedAtMs: s, endedAtMs: e, passed: r.passed !== false });
      windows.push([s, e]);
    }
    for (const rec of recs) {
      filesWithWindow++;
      if (!rec.passed) failTotal++;
      const stall = windowMeanStall(samples, rec.startedAtMs, rec.endedAtMs);
      if (stall === null) {
        noPsiInWindow++;
        continue;
      }
      if (rec.passed) passWithPsi++;
      else failWithPsi++;
      const conc = midpointConcurrency(windows, rec.startedAtMs, rec.endedAtMs);
      const b = binOf(conc);
      const stats = bins.find((x) => x.lo === b.lo && x.hi === b.hi);
      if (rec.passed) {
        stats.passN++;
        stats.passVals.push(stall);
      } else {
        stats.failN++;
        stats.failVals.push(stall);
      }
    }
  }
  let judgeable = 0;
  let positiveSignal = 0;
  for (const b of bins) {
    if (b.failN >= minN) {
      judgeable++;
      if (mean(b.failVals) > mean(b.passVals)) positiveSignal++;
    }
  }
  const verdict = positiveSignal > 0 ? "signal" : judgeable > 0 ? "no-signal" : "insufficient";
  return {
    carrierFound: true,
    roundsWithPerFile: roundsWithPerFile.length,
    matchedRounds,
    filesWithWindow,
    failTotal,
    passWithPsi,
    failWithPsi,
    noPsiInWindow,
    minN,
    bins,
    verdict
  };
}
function readIsolationViolations(root) {
  const set = /* @__PURE__ */ new Set();
  const file = path7.join(root, "plugin", "test-isolation-violations.txt");
  let text;
  try {
    text = fs8.readFileSync(file, "utf8");
  } catch {
    return set;
  }
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const idx = s.indexOf(":");
    if (idx === -1) continue;
    const rel = s.slice(0, idx).trim();
    if (rel) set.add(rel);
  }
  return set;
}
function enumerateCandidates(root, includeAllGroups) {
  const iso = readIsolationViolations(root);
  const core = [];
  const serial = [];
  const lowconc = [];
  const excluded = [];
  for (const rel of CORE_CANDIDATES) {
    if (iso.has(rel)) {
      excluded.push(rel);
      continue;
    }
    core.push(rel);
  }
  if (includeAllGroups) {
    const all = canonicalTestFiles(root);
    for (const rel of all) {
      const abs = path7.join(root, rel);
      const g = classifyFile(abs);
      if (g !== "serial" && g !== "lowconc") continue;
      if (iso.has(rel)) {
        if (!excluded.includes(rel)) excluded.push(rel);
        continue;
      }
      if (core.includes(rel)) continue;
      (g === "serial" ? serial : lowconc).push(rel);
    }
  }
  return { core, serial, lowconc, excluded };
}
function spawnBusyWait(count, durationMs) {
  const procs = [];
  for (let i = 0; i < count; i++) {
    const proc = spawn(
      process.execPath,
      ["-e", `const e=Date.now()+${durationMs}; while(Date.now()<e);`],
      { stdio: "ignore" }
    );
    procs.push({ proc });
  }
  return procs;
}
function adjudicate(passed, timedOut, output) {
  if (passed) return "pass";
  if (timedOut) return "scheduling-like";
  if (ISOLATION_CONFLICT_RE.test(output)) return "isolation-conflict";
  if (SCHEDULING_RE.test(output)) return "scheduling-like";
  return "other";
}
function classifyHit(t) {
  const cfg = CANDIDATE_CONFIG[t.file];
  if (cfg?.designIntent) return "design-intent";
  if (cfg?.histFailMs && t.timeoutMs < cfg.histFailMs[1]) return "truncated";
  return "real-reproduction";
}
function extractErrorSignature(output) {
  const lines = output.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const err = lines.find((l) => /error|fail|assert|timeout|exception/i.test(l));
  if (!err) return null;
  return err.slice(0, 160);
}
async function runActiveTrial(fileAbs, rel, loadProcs, cwd, timeoutMs, injectWindowMs) {
  const busy = spawnBusyWait(loadProcs, injectWindowMs);
  await sleep2(1500);
  const stalls = [];
  let childPid = null;
  let runDelayMaxNs = 0;
  const s0 = readCpuStall();
  if (s0 !== null) stalls.push(s0);
  const res = await new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const start = Date.now();
    let child;
    try {
      child = spawn(process.execPath, ["--test", fileAbs], { cwd, env: process.env });
    } catch (err) {
      resolve({ code: 1, stdout: "", stderr: String(err), wallMs: 0, timedOut: false });
      return;
    }
    childPid = child.pid ?? null;
    child.stdout?.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
      }
    }, timeoutMs);
    const sampler = setInterval(() => {
      const s = readCpuStall();
      if (s !== null) stalls.push(s);
      if (childPid !== null) {
        const rd = readTreeRunDelayNs(childPid);
        if (rd > runDelayMaxNs) runDelayMaxNs = rd;
      }
    }, 1e3);
    child.on("close", (code) => {
      clearTimeout(timer);
      clearInterval(sampler);
      resolve({ code, stdout, stderr, wallMs: Date.now() - start, timedOut });
    });
  });
  const s1 = readCpuStall();
  if (s1 !== null) stalls.push(s1);
  if (childPid !== null) {
    const rd = readTreeRunDelayNs(childPid);
    if (rd > runDelayMaxNs) runDelayMaxNs = rd;
  }
  for (const b of busy) {
    try {
      b.proc.kill("SIGKILL");
    } catch {
    }
  }
  const output = `${res.stdout}
${res.stderr}`;
  const passed = res.code === 0 && !res.timedOut;
  return {
    file: rel,
    loadProcs,
    passed,
    code: res.code,
    wallMs: res.wallMs,
    timeoutMs,
    cpuStallMean: mean(stalls),
    cpuStallMax: max(stalls),
    cpuStallN: stalls.length,
    runDelayNs: runDelayMaxNs,
    timedOut: res.timedOut,
    errorSignature: passed ? null : extractErrorSignature(output),
    adjudication: adjudicate(passed, res.timedOut, output)
  };
}
async function activeRun(root, args) {
  const candidates = enumerateCandidates(root, args.includeAllGroups);
  const rels = [...candidates.core, ...candidates.serial, ...candidates.lowconc];
  const trials = [];
  const unverified = [];
  for (const rel of rels) {
    const cfg = CANDIDATE_CONFIG[rel];
    if (cfg?.unverifiableInBudget) {
      unverified.push(rel);
      continue;
    }
    const timeoutMs = cfg?.timeoutMs ?? args.testTimeoutMs;
    const abs = path7.join(root, rel);
    for (const loadProcs of args.loadLevels) {
      for (let t = 0; t < args.trials; t++) {
        const trial = await runActiveTrial(abs, rel, loadProcs, root, timeoutMs, args.injectWindowMs);
        trials.push(trial);
      }
    }
  }
  const validFailures = trials.filter((t) => t.adjudication === "scheduling-like");
  const isolationFailures = trials.filter((t) => t.adjudication === "isolation-conflict");
  return { candidates, trials, validFailures, isolationFailures, unverified, loadLevels: args.loadLevels };
}
function activeMechanism(validFailures, trials, loadLevels) {
  const empty = { loadInduced: [], hitClasses: /* @__PURE__ */ new Map(), evidence: [], baselineRunDelay: /* @__PURE__ */ new Map(), confirmed: [], verdict: "insufficient" };
  if (trials.length === 0) return empty;
  const highLoadLevels = loadLevels.filter((n) => n > 0);
  if (highLoadLevels.length === 0) return empty;
  const lowLoadFailFiles = new Set(validFailures.filter((f) => f.loadProcs === 0).map((f) => f.file));
  const loadInduced = validFailures.filter((f) => f.loadProcs > 0 && !lowLoadFailFiles.has(f.file));
  const hitClasses = /* @__PURE__ */ new Map();
  const evidence = [];
  for (const f of loadInduced) {
    const cls = classifyHit(f);
    hitClasses.set(f.file, cls);
    if (cls === "real-reproduction") evidence.push(f);
  }
  const baselineRunDelay = /* @__PURE__ */ new Map();
  for (const t of trials) {
    if (t.loadProcs !== 0) continue;
    const prev = baselineRunDelay.get(t.file) ?? 0;
    baselineRunDelay.set(t.file, Math.max(prev, t.runDelayNs));
  }
  const confirmed = evidence.filter((f) => {
    const base = baselineRunDelay.get(f.file) ?? 0;
    return f.runDelayNs >= MIN_RUN_DELAY_NS && f.runDelayNs >= SIGNIFICANT_RUN_DELAY_RATIO * Math.max(base, 1);
  });
  const verdict = evidence.length === 0 ? "no-signal" : confirmed.length > 0 ? "signal" : "no-signal";
  return { loadInduced, hitClasses, evidence, baselineRunDelay, confirmed, verdict };
}
function binLabel(b) {
  return Number.isFinite(b.hi) ? `${b.lo}-${b.hi}` : `${b.lo}+`;
}
function printActive(res) {
  const { candidates, trials, validFailures, isolationFailures, unverified, loadLevels } = res;
  console.log("\u2500\u2500 (a) \u4E3B\u52A8\u5236\u9020 (primary) \u2500\u2500");
  console.log(`\u5019\u9009: core=${candidates.core.length} serial=${candidates.serial.length} lowconc=${candidates.lowconc.length}`);
  console.log(`\u9694\u79BB\u8FDD\u89C4\u6392\u9664: ${candidates.excluded.length} \u4E2A \u2192 ${candidates.excluded.join(", ") || "(\u65E0)"}`);
  if (unverified.length > 0) console.log(`\u672A\u9A8C\u8BC1(\u9884\u7B97\u5916\u8DF3\u8FC7, \u8BA2\u6B63\u2465): ${unverified.join(", ")}`);
  console.log(`load levels (busy-wait procs): [${loadLevels.join(", ")}]  | trials \u603B\u6570=${trials.length}`);
  const byLoad = /* @__PURE__ */ new Map();
  for (const t of trials) {
    const arr = byLoad.get(t.loadProcs) ?? [];
    arr.push(t);
    byLoad.set(t.loadProcs, arr);
  }
  for (const lv of loadLevels) {
    const arr = byLoad.get(lv) ?? [];
    const pass = arr.filter((t) => t.passed).length;
    const fail = arr.length - pass;
    const stalls = arr.map((t) => t.cpuStallMean).filter((n) => Number.isFinite(n));
    console.log(`  load=${String(lv).padStart(3)}  trials=${String(arr.length).padStart(3)}  pass=${pass}  fail=${fail}  cpu_stall\u5747\u503C=${fmt2(mean(stalls))}  max=${fmt2(max(stalls))}`);
  }
  console.log(`\u6709\u6548\u5931\u8D25\u6837\u672C\uFF08\u975E\u9694\u79BB\u51B2\u7A81\uFF09: ${validFailures.length} | \u9694\u79BB\u51B2\u7A81\u5931\u8D25(\u5DF2\u6392\u9664): ${isolationFailures.length}`);
  for (const t of [...validFailures, ...isolationFailures]) {
    console.log(`  [${t.adjudication}] ${t.file}  load=${t.loadProcs}  cpu_stall\u5747\u503C=${fmt2(t.cpuStallMean)}  run_delay=${fmtRunDelay(t.runDelayNs)}  sig=${t.errorSignature ?? "(\u65E0)"}`);
  }
  const mech = activeMechanism(validFailures, trials, loadLevels);
  const CLS_LABEL = { "real-reproduction": "\u771F\u5B9E\u590D\u73B0", "truncated": "\u88AB\u622A\u65AD", "design-intent": "\u7591\u4F3C\u8BBE\u8BA1\u610F\u56FE" };
  console.log(`load-induced \u547D\u4E2D\u6837\u672C: ${mech.loadInduced.length} | \u771F\u5B9E\u590D\u73B0(\u8BC1\u636E): ${mech.evidence.length} | run_delay \u673A\u5236\u786E\u8BA4: ${mech.confirmed.length}/${mech.evidence.length}`);
  for (const t of mech.loadInduced) {
    const cls = mech.hitClasses.get(t.file) ?? "real-reproduction";
    const base = mech.baselineRunDelay.get(t.file) ?? 0;
    const ratio = base > 0 ? t.runDelayNs / base : Number.POSITIVE_INFINITY;
    const ok = t.runDelayNs >= MIN_RUN_DELAY_NS && t.runDelayNs >= SIGNIFICANT_RUN_DELAY_RATIO * Math.max(base, 1);
    const tag = cls === "real-reproduction" ? ok ? "\u673A\u5236\u786E\u8BA4" : "\u673A\u5236\u672A\u786E\u8BA4" : "\u4E0D\u8BA1\u5165\u8BC1\u636E";
    console.log(`  [${CLS_LABEL[cls]}] ${t.file}  load=32 run_delay=${fmtRunDelay(t.runDelayNs)} vs load=0 \u57FA\u7EBF=${fmtRunDelay(base)}  \u6BD4\u503C=${Number.isFinite(ratio) ? ratio.toFixed(1) + "\xD7" : "\u221E"}  ${tag}`);
  }
}
function printPassive(res) {
  if (!res.carrierFound) {
    console.log("\u2500\u2500 (b) \u88AB\u52A8\u5386\u53F2 (supplementary) \u2500\u2500");
    console.log(`\u8F7D\u4F53\u672A\u627E\u5230: ${res.path} \u2014 \u5728\u5E72\u51C0 worktree \u91CC\u4E0D\u4F20 --root \u5C31\u4F1A\u8FD9\u6837\uFF08fail-closed\uFF0C\u4E0D\u662F\u7A7A\u6570\u636E\u5408\u683C\uFF09`);
    return;
  }
  console.log("\u2500\u2500 (b) \u88AB\u52A8\u5386\u53F2 (supplementary) \u2500\u2500");
  console.log(`rounds(\u542B perFile)=${res.roundsWithPerFile} matched=${res.matchedRounds} | perFile \u6709\u65F6\u95F4\u7A97=${res.filesWithWindow} passed:false=${res.failTotal}`);
  console.log(`\u7A97\u5185\u6709 PSI: pass=${res.passWithPsi} fail=${res.failWithPsi} | \u65E0\u91C7\u6837\u6392\u9664=${res.noPsiInWindow} | MIN_N=${res.minN}`);
  console.log("  \u5E76\u53D1\u533A\u95F4  \u901A\u8FC7N  \u901A\u8FC7\u5747\u503C  \u5931\u8D25N  \u5931\u8D25\u5747\u503C  \u5DEE\u503C(\u5931\u8D25-\u901A\u8FC7)  \u5224\u5B9A");
  for (const b of res.bins) {
    const pv = [...b.passVals].sort((x, y) => x - y);
    const fv = [...b.failVals].sort((x, y) => x - y);
    const pMean = mean(pv);
    const fMean = mean(fv);
    const delta = Number.isFinite(pMean) && Number.isFinite(fMean) ? fMean - pMean : Number.NaN;
    const judge = b.failN < res.minN ? "\u6837\u672C\u4E0D\u8DB3" : delta > 0 ? "\u4FE1\u53F7" : "\u65E0\u4FE1\u53F7";
    console.log(
      `  ${binLabel(b).padStart(8)}  ${String(b.passN).padStart(6)} ${fmt2(pMean).padStart(8)} ${String(b.failN).padStart(6)} ${fmt2(fMean).padStart(8)} ${fmt2(delta).padStart(14)}  ${judge}`
    );
  }
}
function printJson(args, active, passive, verdict) {
  const out = { verdict };
  if (active) {
    const mech = activeMechanism(active.validFailures, active.trials, active.loadLevels);
    out.active = {
      candidates: {
        core: active.candidates.core.length,
        serial: active.candidates.serial.length,
        lowconc: active.candidates.lowconc.length,
        excluded: active.candidates.excluded
      },
      loadLevels: active.loadLevels,
      injectWindowMs: args.injectWindowMs,
      trials: active.trials.map((t) => ({
        file: t.file,
        loadProcs: t.loadProcs,
        passed: t.passed,
        code: t.code,
        wallMs: t.wallMs,
        timeoutMs: t.timeoutMs,
        cpuStallMean: t.cpuStallMean,
        cpuStallMax: t.cpuStallMax,
        runDelayNs: t.runDelayNs,
        adjudication: t.adjudication,
        errorSignature: t.errorSignature
      })),
      validFailureCount: active.validFailures.length,
      isolationFailureCount: active.isolationFailures.length,
      unverified: active.unverified,
      mechanism: {
        loadInducedCount: mech.loadInduced.length,
        evidenceCount: mech.evidence.length,
        confirmedCount: mech.confirmed.length,
        significantRunDelayRatio: SIGNIFICANT_RUN_DELAY_RATIO,
        minRunDelayNs: MIN_RUN_DELAY_NS,
        hits: mech.loadInduced.map((t) => ({
          file: t.file,
          hitClass: mech.hitClasses.get(t.file) ?? "real-reproduction",
          runDelayNs: t.runDelayNs,
          baselineRunDelayNs: mech.baselineRunDelay.get(t.file) ?? 0,
          confirmed: mech.confirmed.includes(t)
        }))
      }
    };
  }
  if (passive && passive.carrierFound) {
    out.passive = {
      roundsWithPerFile: passive.roundsWithPerFile,
      matchedRounds: passive.matchedRounds,
      filesWithWindow: passive.filesWithWindow,
      failTotal: passive.failTotal,
      passWithPsi: passive.passWithPsi,
      failWithPsi: passive.failWithPsi,
      noPsiInWindow: passive.noPsiInWindow,
      minN: passive.minN,
      bins: passive.bins.map((b) => {
        const pv = [...b.passVals].sort((x, y) => x - y);
        const fv = [...b.failVals].sort((x, y) => x - y);
        return {
          bin: binLabel(b),
          passN: b.passN,
          passMean: mean(pv),
          passMedian: median(pv),
          failN: b.failN,
          failMean: mean(fv),
          failMedian: median(fv),
          delta: Number.isFinite(mean(pv)) && Number.isFinite(mean(fv)) ? mean(fv) - mean(pv) : null,
          verdict: b.failN < passive.minN ? "insufficient" : mean(fv) > mean(pv) ? "signal" : "no-signal"
        };
      })
    };
  } else if (passive && !passive.carrierFound) {
    out.passive = { carrierFound: false, path: passive.path };
  }
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}
async function main5() {
  const args = parseArgs4(process.argv);
  if (args.help) {
    process.stdout.write(
      "psi-failure-correlation-check.ts \u2014 Phase 0 \u56DE\u6EAF\u5206\u6790\uFF08PSI \u5BF9\u5931\u8D25\u7684\u589E\u91CF\u9884\u6D4B\u529B\uFF09\nusage: node --experimental-strip-types plugin/scripts/psi-failure-correlation-check.ts [--source active|passive|both] [--root <repo-root>] [--trials N] [--load-levels 0,N] [--inject-window-ms N] [--include-all-groups] [--json]\n"
    );
    return;
  }
  let active = null;
  let passive = null;
  if (args.source === "active" || args.source === "both") {
    active = await activeRun(repoRoot(), args);
    if (!args.json) printActive(active);
  }
  if (args.source === "passive" || args.source === "both") {
    const root = resolveCarrierRoot(args.root);
    passive = passiveAnalyze(root, args.minNPassive);
    if (!args.json) printPassive(passive);
    if (passive && !passive.carrierFound) {
      process.exitCode = 2;
    }
  }
  let verdict = "insufficient";
  if (active) {
    verdict = activeMechanism(active.validFailures, active.trials, active.loadLevels).verdict;
  } else if (passive && passive.carrierFound) {
    verdict = passive.verdict;
  }
  if (args.json) {
    printJson(args, active, passive, verdict);
  } else {
    console.log("");
    console.log(`GO/NO-GO \u7ED3\u8BBA(\u4E3B=\u4E3B\u52A8, \u8F85=\u88AB\u52A8): ${verdict === "signal" ? "\u6709\u589E\u91CF\u4FE1\u53F7\uFF0C\u8FDB\u5165 Phase 1" : verdict === "no-signal" ? "\u65E0\u589E\u91CF\u4FE1\u53F7\uFF0CPhase 1 \u4E0D\u505A" : "\u6837\u672C\u4E0D\u8DB3\uFF0CPhase 1 \u4E0D\u505A"}`);
  }
}
var isDirect3 = process.argv[1] && path7.basename(process.argv[1]).replace(/\.(?:js|ts|mjs)$/, "") === "psi-failure-correlation-check";
if (isDirect3) {
  await main5();
}
