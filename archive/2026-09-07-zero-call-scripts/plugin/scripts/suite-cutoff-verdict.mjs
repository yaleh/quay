// @test-group engine
// suite-cutoff-verdict.mjs — mechanically-checkable verdict for the full-suite "cutoff"
// (gap-suite-cutoff-what-tears-test-process-at-session-topology, 2026-08-07).
//
// The suite has TWO distinct failure classes, distinguished by DURATION (manager's refined
// attribution 2026-08-07 06:3x, recorded in the task body):
//   1. GENUINE DANGLING-PROMISE / event-loop-exhaustion class — a file runs for MINUTES
//      (> SUITE_LOG_LONG_MS, default 60000) then self-fails with
//      'Promise resolution is still pending but the event loop has already resolved'.
//      Cause: an oversized test file whose heavy blocking work (spawnSync chains spawning
//      real sub-processes) exhausts the node:test worker's event loop, so the runner's
//      internal completion promise never resolves. FIX = split the file (each < ~19 tests),
//      NOT a test-logic change — verified 2026-08-07 by splitting quay-init-loop.test.mjs
//      (54 tests / 1286 lines → 4 files of 7-15 tests each; 48/48 pass, 0 Promise-pending).
//   2. CASCADE-VICTIM class — files downstream of a cutoff point that NEVER RAN: they fail
//      INSTANTLY / in alphabetical order after the process was torn down. Their failure is
//      noise, not a defect.
//
// This tool makes the verdict mechanically checkable two ways:
//   A. STATIC heavy-file scan (no suite run needed): flags test files whose (lines, test
//      count, blocking-spawn weight) score puts them at risk of the exhaustion class, so a
//      re-grown heavy file is caught before it re-tears the suite.
//   B. RUNTIME duration discriminator (over a full-suite log): parses the log for
//      Promise-pending failures and splits them by duration — long (> LONG_MS) = class 1
//      genuine, instant = class 2 cascade victims. Also reports SIGKILL/cancelled/OOM
//      evidence and the alphabetical-truncation signature.
//
// Usage:
//   node --experimental-strip-types plugin/scripts/suite-cutoff-verdict.mjs            # static scan only (cwd = repo root)
//   node --experimental-strip-types plugin/scripts/suite-cutoff-verdict.mjs --root <dir>
//   node --experimental-strip-types plugin/scripts/suite-cutoff-verdict.mjs --suite-log <full-suite.log> [--root <dir>]
//   node --experimental-strip-types plugin/scripts/suite-cutoff-verdict.mjs --json      # machine-readable verdict
//
// Exit codes: 0 = verdict clean (no at-risk heavy file, no genuine dangling-Promise in log);
//             1 = at-risk heavy file(s) OR genuine dangling-Promise class detected.

import fs from "node:fs";
import path from "node:path";

// ── thresholds (calibrated 2026-08-07 against the verified defect) ────────────────────────────────
// quay-init-loop.test.mjs (FAILED at 167s): 1286 lines, 54 tests, 37 blocking quay-init spawns.
// Split files (PASSED): 7-15 tests, 41-83s each, never re-tears.
// The score is a heuristic for "total blocking work in one file's worker"; a file above
// HEAVY_SCORE is at risk of the exhaustion class and should be split (or its blocking load cut).
export const HEAVY_SCORE_THRESHOLD = 130;
// Runtime duration (ms) that separates class 1 (genuine dangling Promise) from class 2
// (cascade victims). Long = minutes-scale genuine; instant = never-ran victim.
export const SUITE_LOG_LONG_MS = 60000;
// The exact node:test runtime message that marks the class (global flag so .match() counts ALL
// occurrences — a non-global regex returns only the first).
export const PROMISE_PENDING_RE = /Promise resolution is still pending but the event loop has already resolved/g;
// Process-teardown marker: bash's job-status diagnostic when test.sh's node --test CHILD is SIGKILL'd —
// `scripts/test.sh: line 576: 720326 Killed node --test` (07:08→07:21 evidence). This is the ONLY
// reliable teardown marker in a suite log. A BROAD regex (`SIGKILL|Killed|exit 137`) is NOT reliable:
// those tokens appear in PASSING test names (full-suite-runner AC5 signal-kill tests) and in THIS
// tool's own embedded output when suite-cutoff-verdict.test.mjs runs inside the suite — observed
// 2026-08-08: a GREEN 2792-test log reported "5 SIGKILL/Killed markers, torn down mid-run" (all 5
// matches were test names/self-output). Precise shape only:
//   `: line <N>: <pid> Killed` (bash job-status) or the combined `Killed node --test` line.
export const KILLED_RE = /: line \d+: \d+ Killed|Killed\s+node --test/g;

// ── static heavy-file scan ─────────────────────────────────────────────────────────────────────────
const TEST_GLOB_ROOTS = ["packages", "plugin", "experiments"];

export function collectTestFiles(root) {
  const out = [];
  const seen = new Set();
  for (const r of TEST_GLOB_ROOTS) {
    const dir = path.join(root, r);
    if (!fs.existsSync(dir)) continue;
    (function walk(d) {
      let entries;
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".test.mjs")) {
          // mirror-parity duplicates (experiments/<x>/test mirroring plugin/test) share one score;
          // report the first occurrence, note mirrors separately. Paths are stored RELATIVE to
          // root so consumers can `path.join(root, rel)` without double-joining an absolute path.
          const rel = path.relative(root, p);
          const key = e.name;
          if (!seen.has(key)) { seen.add(key); out.push({ path: rel, mirror: [] }); }
          else { const hit = out.find((o) => path.basename(o.path) === key); if (hit) hit.mirror.push(rel); }
        }
      }
    })(dir);
  }
  return out;
}

export function scoreTestFile(absPath) {
  const src = fs.readFileSync(absPath, "utf8");
  const lines = src.split("\n").length;
  const tests = (src.match(/^\s*(?:test|it)\(/gm) || []).length;
  const blockSpawn = (src.match(/spawnSync|execSync|execFileSync/g) || []).length;
  // Literal floating promise-returning call NOT awaited / NOT Sync / NOT assigned to a variable:
  //   (^|[^A-Za-z0-9_.]) mkdtemp( spawn( exec( fs.promises.* readFile( writeFile( ...
  //   AND the statement does not begin with `const x =` / `let x =` / `return ` / `await `.
  // This is a WEAKER signal than the heavy score (assigned children are handled via events) but
  // a floating top-level async call is the manager's original "add await" hypothesis — keep it
  // visible, not load-bearing.
  const floatingRe = /(^|[^A-Za-z0-9_.])(?:mkdtemp|spawn|exec|execFile|readFile|writeFile|readdir|access|rm|cp|mkdir|stat)\(/gm;
  const floating = [];
  let m;
  while ((m = floatingRe.exec(src)) !== null) {
    const lineStart = src.lastIndexOf("\n", m.index) + 1;
    const stmtPrefix = src.slice(lineStart, m.index + m[0].length);
    if (/await\s*(?:fs\.promises\.)?[\w.]*$/.test(stmtPrefix)) continue; // already awaited
    if (/^(?:const|let|var)\s+\w+\s*=\s*/.test(stmtPrefix)) continue;      // assigned & handled
    if (/^\s*return\s+/.test(stmtPrefix)) continue;                        // returned to caller
    floating.push(stmtPrefix.trim().slice(0, 60));
  }
  const score = lines / 150 + tests * 2 + blockSpawn * 3 + floating.length * 5;
  return { lines, tests, blockSpawn, floating, score };
}

export function scanHeavyFiles(root) {
  const files = collectTestFiles(root);
  const rows = files
    .map((f) => {
      let m;
      try { m = scoreTestFile(path.join(root, f.path)); } catch { return null; }
      return { path: f.path, mirrors: f.mirror, ...m };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
  return {
    total: rows.length,
    atRisk: rows.filter((r) => r.score >= HEAVY_SCORE_THRESHOLD),
    heaviest: rows.slice(0, 10),
  };
}

// ── runtime duration discriminator over a full-suite log ───────────────────────────────────────────
export function analyzeSuiteLog(logPath) {
  if (!fs.existsSync(logPath)) {
    return { sigkill: 0, cancelled: 0, promisePending: 0, longGenuine: [], missing: true, path: logPath };
  }
  const text = fs.readFileSync(logPath, "utf8");
  const sigkill = (text.match(KILLED_RE) || []).length;
  const cancelled = (text.match(/cancelled [1-9]/g) || []).length;
  const promisePending = (text.match(PROMISE_PENDING_RE) || []).length;

  // Long-duration Promise-pending failures = class 1 genuine. node:test prints the file-level
  // failure as `✖ <path> (123456.789012ms)` on the line ABOVE the Promise-pending message.
  const longGenuine = [];
  const lines = text.split("\n");
  // fresh per-line regex (PROMISE_PENDING_RE is a shared GLOBAL singleton — .test() advances
  // lastIndex, so reuse across iterations would skip matches).
  const ppLineRe = new RegExp(PROMISE_PENDING_RE.source);
  const dmRe = /✖\s+(\S+\.test\.mjs)\s+\((\d+(?:\.\d+)?)ms\)/;
  for (let i = 0; i < lines.length; i++) {
    if (!ppLineRe.test(lines[i])) continue;
    // look back up to 5 lines for the `✖ <path> (<duration>ms)` marker, NEAREST first.
    for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
      const dm = dmRe.exec(lines[j]);
      if (dm) {
        const dur = Number(dm[2]);
        if (dur > SUITE_LOG_LONG_MS) longGenuine.push({ file: dm[1], durationMs: Math.round(dur) });
        break;
      }
    }
  }
  // Alphabetical-truncation signature: the LAST file that actually ran vs the full glob is a
  // victim marker — if the log ends with a Killed/abrupt end and the last file named is not the
  // alphabetically-last test file, files after it never ran (class 2 cascade).
  return { sigkill, cancelled, promisePending, longGenuine };
}

// ── verdict ────────────────────────────────────────────────────────────────────────────────────────
export function computeVerdict({ log, root, json }) {
  const heavy = scanHeavyFiles(root);
  let logResult = null;
  if (log) logResult = analyzeSuiteLog(log);

  const issues = [];
  if (heavy.atRisk.length > 0) {
    issues.push(`heavy-file at-risk: ${heavy.atRisk.length} file(s) score >= ${HEAVY_SCORE_THRESHOLD} (split or reduce blocking load)`);
  }
  if (logResult) {
    if (logResult.missing) {
      issues.push(`suite log ${log} not found — duration discriminator skipped (static heavy-file scan still applies)`);
    } else {
      if (logResult.sigkill > 0) issues.push(`suite log shows ${logResult.sigkill} SIGKILL/Killed marker(s) — process torn down mid-run; red verdict landing points UNRELIABLE until the teardown source is fixed`);
      if (logResult.longGenuine.length > 0) issues.push(`genuine dangling-Promise class: ${logResult.longGenuine.length} file(s) took > ${SUITE_LOG_LONG_MS}ms before Promise-pending (e.g. ${logResult.longGenuine.map((g) => `${g.file}@${g.durationMs}ms`).slice(0, 5).join(", ")})`);
      if (logResult.promisePending > 0 && logResult.longGenuine.length === 0) issues.push(`Promise-pending present but ALL instant (< ${SUITE_LOG_LONG_MS}ms) — cascade victims of a cutoff, not genuine defects`);
      if (logResult.cancelled > 0) issues.push(`suite log shows ${logResult.cancelled} cancelled test(s)`);
    }
  }

  const verdict = {
    verdict: issues.length === 0 ? "clean" : "blocked",
    issues,
    durationDiscriminatorMs: SUITE_LOG_LONG_MS,
    heavyScan: {
      totalFiles: heavy.total,
      threshold: HEAVY_SCORE_THRESHOLD,
      atRisk: heavy.atRisk.map((r) => ({
        path: r.path, lines: r.lines, tests: r.tests,
        blockingSpawn: r.blockSpawn, floatingAsync: r.floating, score: Math.round(r.score),
      })),
    },
    suiteLog: logResult
      ? {
          path: log, sigkill: logResult.sigkill, cancelled: logResult.cancelled,
          promisePending: logResult.promisePending,
          longGenuine: logResult.longGenuine,
          missing: logResult.missing ?? false,
        }
      : null,
  };
  if (json) {
    console.log(JSON.stringify(verdict, null, 2));
  } else {
    console.log(`suite-cutoff verdict: ${verdict.verdict.toUpperCase()}`);
    for (const i of verdict.issues) console.log(`  - ${i}`);
    if (verdict.heavyScan.atRisk.length > 0) {
      console.log(`  at-risk heavy files (score >= ${verdict.heavyScan.threshold}):`);
      for (const r of verdict.heavyScan.atRisk) {
        console.log(`    ${String(r.score).padStart(4)} ${r.path} (${r.lines}L ${r.tests}t ${r.blockingSpawn}s ${r.floatingAsync.length}f)`);
      }
    }
    if (verdict.suiteLog) {
      console.log(`  suite log ${verdict.suiteLog.path}: sigkill=${verdict.suiteLog.sigkill} cancelled=${verdict.suiteLog.cancelled} promisePending=${verdict.suiteLog.promisePending} longGenuine=${verdict.suiteLog.longGenuine.length}`);
    }
  }
  return verdict;
}

function main() {
  const argv = process.argv.slice(2);
  let root = process.cwd();
  let log = null;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") root = argv[++i];
    else if (argv[i] === "--suite-log") log = argv[++i];
    else if (argv[i] === "--json") json = true;
    else if (argv[i] === "--threshold") { /* override not wired; threshold is calibrated */ }
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log("usage: suite-cutoff-verdict.mjs [--root <dir>] [--suite-log <log>] [--json]");
      process.exit(0);
    }
  }
  const v = computeVerdict({ log, root, json });
  process.exit(v.verdict === "clean" ? 0 : 1);
}

if (process.argv[1]) {
  // process.argv[1] may be relative (e.g. `plugin/scripts/suite-cutoff-verdict.mjs` when spawned
  // by a test) — resolve against cwd before comparing to the absolute import.meta.url.
  const entry = path.resolve(process.argv[1]);
  if (import.meta.url === new URL(`file://${entry}`).href) {
    main();
  }
}
