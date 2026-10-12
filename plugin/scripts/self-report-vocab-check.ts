// self-report-vocab-check.ts — tasks/gap-reanchor-must-converge-inner-self-reported-vocabulary.
//
// The inner layer's SELF-REPORTED VOCABULARY drifts from the shipped semantics: after batch-free
// drives, the inner kept reporting "Batch of 3 fully merged" — its context history internalized
// batch-2/3/4 as its organizing form (reports/closes in batches). Doc-side wording
// (gap-split-batch-vocabulary-dispatch-rolling-vs-verification-round, done) can't fix internalized
// vocabulary; THIS task adds an OBSERVABLE semantics-convergence criterion to the re-anchor cycle
// (outer orchestrator-loop-tick.md step 1c): after re-anchor rounds, the inner's self-reported
// wording (commit / fan-in notes) must use the factory semantics (rolling dispatch /
// verification-round), and batch-style reports are FLAGGED.
//
// ── THIS FILE IS AN I/O ADAPTER, NOT A SECOND IMPLEMENTATION (2026-10-12) ─────────────────────────
// It carried its OWN pattern table (`BATCH_SELF_REPORT_PATTERNS`), its OWN convergence counter
// (`nextConvergenceState` + the persisted `roundsClean`) and ZERO stopped-state handling, while
// `self-report-vocab-audit.ts` carried the same task's table + convergence judgment + the
// stopped-state fix — the same task implemented twice, and the two copies disagreed
// (gap-self-report-vocab-audit-check-pattern-tables-diverge; hard rule 5b: the stopped-state fix
// landed in one copy only). The divergence was measured on `batch4a` (audit flagged, check's
// trailing-letter lookahead did not), `Batch of` without a digit (audit flagged, check required
// \d+) and a stopped window (audit waived the window-full requirement, check had no such arm).
//
// The single source is now `self-report-vocab-audit.ts`: the batch pattern table
// (`BATCH_FLAG_PATTERNS`), the stopped-state rule (`STOPPED_MARKERS` + the window waiver) and the
// convergence judgment (`auditSelfReports`) are all IMPORTED from it. This file owns only the
// differences that are genuinely its own — which git records it feeds in and how it prints them.
// `plugin/test/self-report-vocab-check.test.mjs` pins the parity between the two entry points.
//
// The re-anchor mechanism's effectiveness is measured by SEMANTIC CONVERGENCE (AC2), not by
// "re-anchor happened": the newest `window` inner self-reports all clean => converged.
// `converged: true` is the invariant reanchor_effectiveness_is_convergence.
//
// A DETECTOR, not a gate: reads the inner's recent self-report surface (git commit messages whose
// subject is an inner fan-in note `inner: ...` or an inner merge commit `merge task/...`) and
// reports batch-style vocabulary. Persists the LAST READING to a small state file
// (default .quay/self-report-vocab-state.json, gitignored runtime state) so a tick can be diffed
// against the previous one; the judgment itself is stateless (derived from the report window).
// Never writes tasks/**.
//
// Run:
//   node --experimental-strip-types plugin/scripts/self-report-vocab-check.ts [--root <repo>] [--json]
//       [--count <N>] [--convergence-rounds <N>|--window <N>] [--state <path>] [--no-state]
//       [--text <string>]   # audit arbitrary text (tests / control fixture)
//       [--stdin]           # audit text from stdin

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { helpExit, isDirectEntry, parseArgs as baseParseArgs } from "./gate-script-base.ts";
import {
  BATCH_FLAG_PATTERNS,
  DEFAULT_WINDOW,
  auditSelfReports,
} from "./self-report-vocab-audit.ts";

// ── Flag patterns ───────────────────────────────────────────────────────────────────────────────
// There is deliberately NO pattern table in this file. The batch-style self-report vocabulary is
// `BATCH_FLAG_PATTERNS` in `self-report-vocab-audit.ts` — imported above, so an edit to the
// vocabulary cannot land in one entry point and miss the other (the exact defect this file's
// header records). The whitelist (task ids / mechanism true-names / historical batch names such as
// `concurrent-batch-scheduler.ts`, `gap-split-batch-vocabulary-...`, `batch4a`) falls out of that
// one table; its reconciliation table names each divergent input and the intended verdict.

/**
 * Flag batch-style self-report vocabulary in a text blob, using the SHARED table.
 * Returns an array of hits: [{ line, text, pattern, match }]. Empty array = clean.
 * Pure function (no I/O) — unit-testable directly.
 */
export function flagBatchVocab(text) {
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
          match: m[0],
        });
      }
    }
  }
  return hits;
}

/** Load the most recent `count` commit records from the repo at `root`. */
export function loadCommitRecords(root, count) {
  let out;
  try {
    out = execFileSync(
      "git",
      ["log", "--format=%x1e%H%x09%s%n%b", "-n", String(count)],
      { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
  } catch (e) {
    throw new Error(`git log failed in ${root}: ${e.message}`);
  }
  const records = [];
  for (const raw of out.split("\x1e")) {
    const rec = raw.trimEnd();
    if (!rec) continue;
    const newline = rec.indexOf("\n");
    const head = newline === -1 ? rec : rec.slice(0, newline);
    const body = newline === -1 ? "" : rec.slice(newline + 1);
    const tab = head.indexOf("\t");
    const hash = tab === -1 ? head : head.slice(0, tab);
    const subject = tab === -1 ? "" : head.slice(tab + 1);
    records.push({ hash, subject, body, text: `${subject}\n${body}` });
  }
  return records;
}

/** Inner self-report surface: fan-in note commits (`inner: ...`) and merge commits (`merge task/...`). */
export function isInnerSelfReport(subject) {
  return /^(inner:|merge )/.test(subject);
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
// The flag loop is the SHARED spec-driven parser (gate-script-base.ts) — this wrapper maps the raw
// flag strings onto this command's typed shape. It replaces the private `switch`-based variant named
// by semantic-dedup-scan finding `parse-args-handrolled-variants`
// (runId `semantic-dedup-scan-1791536153223`): that variant could not fold while the shared parser
// `process.exit()`ed on `--help`, which `main` handles itself (it prints this command's own usage).
//
// `main` takes the SLICED argv tail (`process.argv.slice(2)`, its existing contract); the shared
// parser reads full `process.argv`, so the two leading slots it skips are re-attached here.
//
// A value flag the shared parser could not resolve (a trailing `--flag` with no value) comes back as
// `""`; `flagStr`/`flagNum` fold that to the command's default. `--text`/`--state` are read as
// SUPPLIED whenever the key is present, so an explicit `--text ""` stays a (empty) text fixture
// rather than silently falling through to the git-log source.
//
// `--convergence-rounds` and `--window` are ALIASES for the same knob (the shared
// `auditSelfReports` window); `--window` is accepted so a caller can use the single-source module's
// own flag name at either entry point.
function parseArgs(argv) {
  const { flags, help } = baseParseArgs(["node", "self-report-vocab-check.ts", ...argv], {
    minArgs: 0,
    usage:
      "[--root <dir>] [--count <n>] [--convergence-rounds <n>|--window <n>] [--state <file>] " +
      "[--no-state] [--json] [--text <s>] [--stdin] [--help]",
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
      stdin: { type: "boolean" },
    },
  });
  const flagStr = (v, dflt) => (typeof v === "string" && v !== "" ? v : dflt);
  const flagNum = (v, dflt) => {
    const n = typeof v === "string" && v !== "" ? Number(v) : Number.NaN;
    return Number.isFinite(n) ? n : dflt;
  };
  return {
    root: flagStr(flags.root, process.cwd()),
    count: flagNum(flags.count, 40),
    convergenceRounds: flagNum(
      flagStr(flags.window, ""),
      flagNum(flags["convergence-rounds"], DEFAULT_WINDOW),
    ),
    json: flags.json === true,
    state: typeof flags.state === "string" ? flags.state : null,
    noState: flags["no-state"] === true,
    text: typeof flags.text === "string" ? flags.text : null,
    stdin: flags.stdin === true,
    help: help === true,
  };
}

export function main(argv) {
  const args = parseArgs(argv);
  if (args.help) helpExit("usage: node self-report-vocab-check.ts [--root <dir>] [--count <n>] [--convergence-rounds <n>|--window <n>] [--state <file>] [--no-state] [--json] [--text <s>] [--stdin]");

  let textSource;
  let records;
  if (args.text !== null) {
    textSource = "text";
    records = [{ hash: "fixture", subject: args.text, body: "", text: args.text }];
  } else if (args.stdin) {
    textSource = "stdin";
    const input = fs.readFileSync(0, "utf8");
    records = [{ hash: "stdin", subject: input, body: "", text: input }];
  } else {
    textSource = "git-log";
    records = loadCommitRecords(args.root, args.count);
  }

  // git-log mode audits only the inner self-report surface; text/stdin mode audits the whole input.
  const selfReports =
    textSource === "git-log" ? records.filter((r) => isInnerSelfReport(r.subject)) : records;

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
        text: h.text,
      });
    }
    // The convergence window is the SHARED report window: one report per non-empty line, exactly
    // as `self-report-vocab-audit.ts` reads a file — so the same input text yields the same verdict
    // at either entry point (parity, pinned by self-report-vocab-check.test.mjs).
    for (const raw of String(r.text).split("\n")) {
      const t = raw.trim();
      if (t) reports.push(t);
    }
  }
  const count = flagged.length;

  // The convergence judgment — INCLUDING the stopped-state exemption and the window-full
  // requirement — is the single-source `auditSelfReports`. This file computes none of it.
  const audit = auditSelfReports(reports, args.convergenceRounds);

  const statePath = args.noState
    ? null
    : args.state || path.join(args.root, ".quay", "self-report-vocab-state.json");
  if (statePath) {
    // The state file records the LAST READING (a diffable tick-over-tick carrier). It is not a
    // counter: `roundsClean` is the shared window judgment's `recent_clean`, recomputed from the
    // report window every run, never incremented locally.
    const reading = {
      roundsClean: audit.recent_clean,
      converged: audit.converged,
      count,
      window: audit.window,
      reportsTotal: audit.reports_total,
      stoppedInWindow: audit.stopped_in_window,
      lastAuditAt: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(reading, null, 2) + "\n");
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
    stateFile: statePath,
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (count === 0) {
    process.stdout.write(
      `OK — no batch-style inner self-report (count=0, roundsClean=${audit.recent_clean}/${audit.window}, converged=${audit.converged}, stoppedInWindow=${audit.stopped_in_window})\n`,
    );
  } else {
    process.stdout.write(`FLAG — ${count} batch-style inner self-report(s):\n`);
    for (const f of flagged) {
      process.stdout.write(
        `  [${f.hash.slice(0, 8)}] ${f.subject} (line ${f.line}, ${f.pattern}: ${f.match})\n`,
      );
    }
  }
  return 0; // DETECTOR — report only, never a gate
}

if (isDirectEntry(import.meta, undefined, "self-report-vocab-check")) {
  process.exit(main(process.argv.slice(2)));
}
