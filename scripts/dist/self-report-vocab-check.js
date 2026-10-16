import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-knW9s7/scripts/self-report-vocab-check.ts
import fs3 from "node:fs";
import path4 from "node:path";
import { execFileSync as execFileSync3 } from "node:child_process";

// .tmp-dist-publish-worktrees/publish-knW9s7/scripts/gate-script-base.ts
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
function isDirectEntry(importMeta, argv1, expectedBase) {
  void importMeta;
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  return path.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
}

// .tmp-dist-publish-worktrees/publish-knW9s7/scripts/self-report-vocab-audit.ts
import fs2 from "node:fs";

// .tmp-dist-publish-worktrees/publish-knW9s7/scripts/repo-root.ts
import fs from "node:fs";
import path2 from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
var MAX_DEPTH = 16;
function repoRoot(startDir = path2.dirname(fileURLToPath(import.meta.url))) {
  let dir = path2.resolve(startDir);
  for (let i = 0; i < MAX_DEPTH; i++) {
    const hasPkg = fs.existsSync(path2.join(dir, "package.json"));
    if (hasPkg && fs.existsSync(path2.join(dir, "plugin")) && fs.existsSync(path2.join(dir, "scripts", "test.sh"))) {
      return dir;
    }
    if (hasPkg && fs.existsSync(path2.join(dir, ".quay", "config.yml"))) {
      return dir;
    }
    if (fs.existsSync(path2.join(dir, ".git"))) {
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

// .tmp-dist-publish-worktrees/publish-knW9s7/scripts/self-report-vocab-audit.ts
import path3 from "node:path";
import { execFileSync as execFileSync2 } from "node:child_process";
var BATCH_FLAG_PATTERNS = [
  { id: "batch-of", re: /\bBatch\s+of\b/i, desc: "\u300CBatch of N fully merged\u300D\u5F0F\u95E8\u63A7\u6C47\u62A5\uFF08\u6570\u5B57\u53EF\u6709\u53EF\u65E0\uFF0C\u300CBatch of\u300D\u77ED\u8BED\u672C\u8EAB\u5373\u95E8\u63A7\u8BCD\u6C47\uFF09" },
  { id: "batch-num", re: /\bbatch\s*[-_/]?\s*(\d+)(?![-_a-zA-Z])/i, desc: "batch-N \u7F16\u53F7\uFF08batch-2/3/4 \u7B49\u5386\u53F2\u6279\u540D\uFF09\uFF1B\u6570\u5B57\u540E\u7D27\u8DDF\u5B57\u6BCD = \u5386\u53F2\u4EA7\u7269\u540D\uFF0C\u4E0D\u6807\u8BB0" },
  { id: "an-pi", re: /按批/, desc: "\u6309\u6279\u7EC4\u7EC7\uFF08\u6536\u5C3E/\u6C47\u62A5\u6309\u6279\uFF09" }
];
var CONVERGED_MARKERS = [
  { id: "verification-round", re: /verification-round/i },
  { id: "rolling-dispatch", re: /滚动派发|rolling[\s-]?dispatch/i }
];
var STOPPED_MARKERS = [
  { id: "idle", re: /\bidle\b/i },
  { id: "paused", re: /\bpaused?\b/i },
  { id: "awaiting", re: /\bawait\w*/i },
  { id: "halted", re: /\bhalt\w*/i },
  { id: "stopped", re: /\bstopped?\b/i },
  { id: "parked", re: /\bparked?\b/i },
  { id: "suspended", re: /\bsuspended?\b/i }
];
var DEFAULT_WINDOW = 3;
function auditSelfReports(reports, window = DEFAULT_WINDOW) {
  const win = Number.isFinite(window) && window >= 1 ? Math.floor(window) : DEFAULT_WINDOW;
  const flagged = [];
  const clean = new Array(reports.length).fill(true);
  const stopped = new Array(reports.length).fill(false);
  let total_matches = 0;
  let stoppedReports = 0;
  const compliantMarkers = /* @__PURE__ */ new Set();
  reports.forEach((text, i) => {
    const line = String(text);
    const hits = [];
    for (const p of BATCH_FLAG_PATTERNS) {
      if (p.re.test(line)) {
        hits.push(p.id);
        total_matches++;
      }
    }
    if (hits.length > 0) {
      clean[i] = false;
      flagged.push({ index: i, text: line, flags: hits });
    }
    for (const m of CONVERGED_MARKERS) {
      if (m.re.test(line)) compliantMarkers.add(m.id);
    }
    for (const m of STOPPED_MARKERS) {
      if (m.re.test(line)) {
        stopped[i] = true;
        stoppedReports++;
        break;
      }
    }
  });
  const start = Math.max(0, reports.length - win);
  let recentClean = 0;
  let stoppedInWindow = false;
  for (let i = start; i < reports.length; i++) {
    if (clean[i]) recentClean++;
    if (stopped[i]) stoppedInWindow = true;
  }
  const inWindow = reports.length - start;
  const converged = (stoppedInWindow || reports.length >= win) && recentClean === inWindow;
  return {
    inner_self_report_vocab: flagged.length,
    total_matches,
    reports_total: reports.length,
    window: win,
    converged,
    recent_clean: recentClean,
    flagged,
    compliant_markers: [...compliantMarkers].sort(),
    stopped_in_window: stoppedInWindow,
    stopped_reports: stoppedReports
  };
}
function main(argv) {
  const args = argv.slice(2);
  let window = DEFAULT_WINDOW;
  let json = false;
  let countOnly = false;
  let gitLog = 0;
  let root = null;
  const excludes = [];
  const files = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--window") window = Number(args[++i]);
    else if (a === "--json") json = true;
    else if (a === "--count-only") countOnly = true;
    else if (a === "--git-log") gitLog = Number(args[++i]);
    else if (a === "--root") root = args[++i];
    else if (a === "--exclude-prefix") excludes.push(String(args[++i] ?? ""));
    else files.push(a);
  }
  const reports = [];
  if (gitLog > 0) {
    const rootDir = root ? path3.resolve(root) : repoRoot(process.cwd());
    const subjects = execFileSync2("git", ["log", "--format=%s", `-${gitLog}`], {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).split("\n").map((s) => s.trim()).filter(Boolean);
    const filtered = subjects.filter((s) => !excludes.some((p) => p && s.startsWith(p)));
    reports.push(...filtered.reverse());
  }
  for (const f of files) {
    const text = fs2.readFileSync(f, "utf8");
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (t) reports.push(t);
    }
  }
  const result = auditSelfReports(reports, window);
  if (countOnly) {
    process.stdout.write(`${result.inner_self_report_vocab}
`);
  } else if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}
`);
  } else {
    const state = result.converged ? "CONVERGED" : "NOT-CONVERGED";
    const newest = Math.min(result.window, result.reports_total);
    process.stdout.write(
      `inner_self_report_vocab=${result.inner_self_report_vocab} \xB7 ${state} (window ${result.window}, recent_clean ${result.recent_clean}/${newest} of newest, stopped_in_window ${result.stopped_in_window ? "yes" : "no"}) \xB7 reports_total ${result.reports_total} \xB7 stopped_reports ${result.stopped_reports}
`
    );
    if (result.flagged.length > 0) {
      process.stdout.write(`  flagged (${result.flagged.length}):
`);
      for (const f of result.flagged) {
        process.stdout.write(`    [${f.index}] ${f.text}  \u2190 ${f.flags.join(",")}
`);
      }
    }
    if (result.compliant_markers.length > 0) {
      process.stdout.write(`  compliant markers: ${result.compliant_markers.join(", ")}
`);
    }
  }
  return 0;
}
if (isDirectEntry(import.meta, void 0, "self-report-vocab-audit")) {
  process.exitCode = main(process.argv);
}

// .tmp-dist-publish-worktrees/publish-knW9s7/scripts/self-report-vocab-check.ts
function flagBatchVocab(text) {
  const hits = [];
  const lines = String(text).split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const p of BATCH_FLAG_PATTERNS) {
      p.re.lastIndex = 0;
      const m = p.re.exec(line);
      if (m) {
        hits.push({
          line: i + 1,
          text: line.trim().slice(0, 160),
          pattern: p.id,
          match: m[0]
        });
      }
    }
  }
  return hits;
}
function loadCommitRecords(root, count) {
  let out;
  try {
    out = execFileSync3(
      "git",
      ["log", "--format=%x1e%H%x09%s%n%b", "-n", String(count)],
      { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
    );
  } catch (e) {
    throw new Error(`git log failed in ${root}: ${e.message}`);
  }
  const records = [];
  for (const raw of out.split("")) {
    const rec = raw.trimEnd();
    if (!rec) continue;
    const newline = rec.indexOf("\n");
    const head = newline === -1 ? rec : rec.slice(0, newline);
    const body = newline === -1 ? "" : rec.slice(newline + 1);
    const tab = head.indexOf("	");
    const hash = tab === -1 ? head : head.slice(0, tab);
    const subject = tab === -1 ? "" : head.slice(tab + 1);
    records.push({ hash, subject, body, text: `${subject}
${body}` });
  }
  return records;
}
function isInnerSelfReport(subject) {
  return /^(inner:|merge )/.test(subject);
}
function parseArgs2(argv) {
  const { flags, help } = parseArgs(["node", "self-report-vocab-check.ts", ...argv], {
    minArgs: 0,
    usage: "[--root <dir>] [--count <n>] [--convergence-rounds <n>|--window <n>] [--state <file>] [--no-state] [--json] [--text <s>] [--stdin] [--help]",
    help: "return",
    flags: {
      root: { type: "string" },
      count: { type: "string" },
      "convergence-rounds": { type: "string" },
      window: { type: "string" },
      state: { type: "string" },
      "no-state": { type: "boolean" },
      json: { type: "boolean" },
      text: { type: "string" },
      stdin: { type: "boolean" }
    }
  });
  const flagStr = (v, dflt) => typeof v === "string" && v !== "" ? v : dflt;
  const flagNum = (v, dflt) => {
    const n = typeof v === "string" && v !== "" ? Number(v) : Number.NaN;
    return Number.isFinite(n) ? n : dflt;
  };
  return {
    root: flagStr(flags.root, process.cwd()),
    count: flagNum(flags.count, 40),
    convergenceRounds: flagNum(
      flagStr(flags.window, ""),
      flagNum(flags["convergence-rounds"], DEFAULT_WINDOW)
    ),
    json: flags.json === true,
    state: typeof flags.state === "string" ? flags.state : null,
    noState: flags["no-state"] === true,
    text: typeof flags.text === "string" ? flags.text : null,
    stdin: flags.stdin === true,
    help: help === true
  };
}
function main2(argv) {
  const args = parseArgs2(argv);
  if (args.help) helpExit("usage: node self-report-vocab-check.ts [--root <dir>] [--count <n>] [--convergence-rounds <n>|--window <n>] [--state <file>] [--no-state] [--json] [--text <s>] [--stdin]");
  let textSource;
  let records;
  if (args.text !== null) {
    textSource = "text";
    records = [{ hash: "fixture", subject: args.text, body: "", text: args.text }];
  } else if (args.stdin) {
    textSource = "stdin";
    const input = fs3.readFileSync(0, "utf8");
    records = [{ hash: "stdin", subject: input, body: "", text: input }];
  } else {
    textSource = "git-log";
    records = loadCommitRecords(args.root, args.count);
  }
  const selfReports = textSource === "git-log" ? records.filter((r) => isInnerSelfReport(r.subject)) : records;
  const flagged = [];
  const reports = [];
  for (const r of selfReports) {
    for (const h of flagBatchVocab(r.text)) {
      flagged.push({
        hash: r.hash,
        subject: r.subject.slice(0, 140),
        line: h.line,
        match: h.match,
        pattern: h.pattern,
        text: h.text
      });
    }
    for (const raw of String(r.text).split("\n")) {
      const t = raw.trim();
      if (t) reports.push(t);
    }
  }
  const count = flagged.length;
  const audit = auditSelfReports(reports, args.convergenceRounds);
  const statePath = args.noState ? null : args.state || path4.join(args.root, ".quay", "self-report-vocab-state.json");
  if (statePath) {
    const reading = {
      roundsClean: audit.recent_clean,
      converged: audit.converged,
      count,
      window: audit.window,
      reportsTotal: audit.reports_total,
      stoppedInWindow: audit.stopped_in_window,
      lastAuditAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    fs3.mkdirSync(path4.dirname(statePath), { recursive: true });
    fs3.writeFileSync(statePath, JSON.stringify(reading, null, 2) + "\n");
  }
  const result = {
    count,
    flagged,
    roundsClean: audit.recent_clean,
    convergenceRounds: audit.window,
    converged: audit.converged,
    windowCount: selfReports.length,
    reportsTotal: audit.reports_total,
    stoppedInWindow: audit.stopped_in_window,
    textSource,
    stateFile: statePath
  };
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}
`);
  } else if (count === 0) {
    process.stdout.write(
      `OK \u2014 no batch-style inner self-report (count=0, roundsClean=${audit.recent_clean}/${audit.window}, converged=${audit.converged}, stoppedInWindow=${audit.stopped_in_window})
`
    );
  } else {
    process.stdout.write(`FLAG \u2014 ${count} batch-style inner self-report(s):
`);
    for (const f of flagged) {
      process.stdout.write(
        `  [${f.hash.slice(0, 8)}] ${f.subject} (line ${f.line}, ${f.pattern}: ${f.match})
`
      );
    }
  }
  return 0;
}
if (isDirectEntry(import.meta, void 0, "self-report-vocab-check")) {
  process.exit(main2(process.argv.slice(2)));
}
export {
  flagBatchVocab,
  isInnerSelfReport,
  loadCommitRecords,
  main2 as main
};
