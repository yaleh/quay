#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/perfile-failure-rate.ts
import fs2 from "node:fs";
import path3 from "node:path";

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
function isDirectEntry(importMeta, argv1, expectedBase) {
  void importMeta;
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  return path2.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
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
  if (!fs2.existsSync(p)) {
    return { found: false, path: p, recs: [] };
  }
  const recs = [];
  let text;
  try {
    text = fs2.readFileSync(p, "utf8");
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
export {
  MIN_RUNS,
  baselineOf,
  carrierPath,
  classifyFailure,
  computeBaselines,
  groupByFile,
  main,
  readCarrierPerFile,
  resolveCarrierRoot
};
