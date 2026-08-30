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
// The re-anchor mechanism's effectiveness is measured by SEMANTIC CONVERGENCE (AC2), not by
// "re-anchor happened": N consecutive audit rounds with zero batch-style inner self-reports
// => converged. `converged: true` is the invariant reanchor_effectiveness_is_convergence.
//
// A DETECTOR, not a gate: reads the inner's recent self-report surface (git commit messages whose
// subject is an inner fan-in note `inner: ...` or an inner merge commit `merge task/...`) and
// reports batch-style vocabulary. Writes a tiny convergence state file
// (default .quay/self-report-vocab-state.json, gitignored runtime state) so the consecutive-clean
// round counter persists across ticks. Never writes tasks/**.
//
// Run:
//   node --experimental-strip-types plugin/scripts/self-report-vocab-check.ts [--root <repo>] [--json]
//       [--count <N>] [--convergence-rounds <N>] [--state <path>] [--no-state]
//       [--text <string>]   # audit arbitrary text (tests / control fixture)
//       [--stdin]           # audit text from stdin

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { helpExit, isDirectEntry } from "./gate-script-base.ts";

// ── Flag patterns (batch-style SELF-REPORT vocabulary) ──────────────────────────────────────────────
//
// These flag the INNER REPORTING activity organized by batch. They are deliberately narrow so the
// whitelist falls out naturally (task ids, mechanism true-names, historical names never match):
//   * "gap-split-batch-vocabulary-..." / "concurrent-batch-scheduler.ts" / "{ batch, deferred }"
//       have no digit after "batch"         → batch-count / batch-id don't match, batch-of no.
//   * "batch2-queue-state.md" / "batch4a"    → the trailing [-_a-zA-Z] lookahead excludes them.
export const BATCH_SELF_REPORT_PATTERNS = [
  {
    id: "batch-of",
    label: "「Batch of N」批量式自述（应报 verification-round-N / 滚动派发语义）",
    re: /\bBatch\s+of\s+\d+\b/i,
  },
  {
    id: "batch-count",
    label: "「batch N/M」按批计数自述",
    re: /\bbatch\s*\d+\s*\/\s*\d+\b/i,
  },
  {
    id: "batch-id",
    label: "「batch-N」批次编号自述",
    re: /\bbatch[-_ ]?(\d+)(?![-_a-zA-Z])/i,
  },
  {
    id: "by-batch",
    label: "「按批」按批组织自述",
    re: /按批/,
  },
];

/**
 * Flag batch-style self-report vocabulary in a text blob.
 * Returns an array of hits: [{ line, text, pattern, match }]. Empty array = clean.
 * Pure function (no I/O) — unit-testable directly.
 */
export function flagBatchVocab(text) {
  const hits = [];
  const lines = String(text).split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const p of BATCH_SELF_REPORT_PATTERNS) {
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

/**
 * Convergence state transition (AC2). count === 0 (a clean round) increments roundsClean;
 * a flagged round resets it to 0. converged = roundsClean >= convergenceRounds.
 * Pure function — unit-testable directly.
 */
export function nextConvergenceState(prev, count, convergenceRounds) {
  const prevRounds = prev && Number.isFinite(prev.roundsClean) ? prev.roundsClean : 0;
  const roundsClean = count === 0 ? prevRounds + 1 : 0;
  return {
    roundsClean,
    converged: roundsClean >= convergenceRounds,
    lastCount: count,
    lastAuditAt: new Date().toISOString(),
  };
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

function parseArgs(argv) {
  const args = {
    root: process.cwd(),
    count: 40,
    convergenceRounds: 3,
    json: false,
    state: null,
    noState: false,
    text: null,
    stdin: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--root": args.root = argv[++i]; break;
      case "--count": args.count = Number(argv[++i]); break;
      case "--convergence-rounds": args.convergenceRounds = Number(argv[++i]); break;
      case "--state": args.state = argv[++i]; break;
      case "--no-state": args.noState = true; break;
      case "--json": args.json = true; break;
      case "--text": args.text = argv[++i]; break;
      case "--stdin": args.stdin = true; break;
      default: break;
    }
  }
  return args;
}

export function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) helpExit("usage: node self-report-vocab-check.ts [--root <dir>] [--count <n>] [--convergence-rounds <n>] [--state <file>] [--no-state] [--json] [--text <s>] [--stdin]");
  const args = parseArgs(argv);

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
  }
  const count = flagged.length;

  const statePath = args.noState
    ? null
    : args.state || path.join(args.root, ".quay", "self-report-vocab-state.json");
  let prev = null;
  if (statePath && fs.existsSync(statePath)) {
    try {
      prev = JSON.parse(fs.readFileSync(statePath, "utf8"));
    } catch {
      prev = null;
    }
  }
  const conv = nextConvergenceState(prev, count, args.convergenceRounds);
  if (statePath) {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(conv, null, 2) + "\n");
  }

  const result = {
    count,
    flagged,
    roundsClean: conv.roundsClean,
    convergenceRounds: args.convergenceRounds,
    converged: conv.converged,
    windowCount: selfReports.length,
    textSource,
    stateFile: statePath,
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (count === 0) {
    process.stdout.write(
      `OK — no batch-style inner self-report (count=0, roundsClean=${conv.roundsClean}/${args.convergenceRounds}, converged=${conv.converged})\n`,
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
