import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/self-report-vocab-audit.ts
import fs2 from "node:fs";

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

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/self-report-vocab-audit.ts
import path3 from "node:path";
import { execFileSync as execFileSync2 } from "node:child_process";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
import path2 from "node:path";
function isDirectEntry(importMeta, argv1, expectedBase) {
  void importMeta;
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  return path2.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/self-report-vocab-audit.ts
var BATCH_FLAG_PATTERNS = [
  { id: "batch-of", re: /\bBatch\s+of\b/i, desc: "\u300CBatch of N fully merged\u300D\u5F0F\u95E8\u63A7\u6C47\u62A5" },
  { id: "batch-num", re: /\bbatch\s*[-_/]?\s*\d/i, desc: "batch-N \u7F16\u53F7\uFF08batch-2/3/4 \u7B49\u5386\u53F2\u6279\u540D\uFF09" },
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
export {
  BATCH_FLAG_PATTERNS,
  CONVERGED_MARKERS,
  DEFAULT_WINDOW,
  STOPPED_MARKERS,
  auditSelfReports,
  main
};
