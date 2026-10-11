import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/self-report-vocab-check.ts
import fs from "node:fs";
import path2 from "node:path";
import { execFileSync } from "node:child_process";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
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

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/self-report-vocab-check.ts
var BATCH_SELF_REPORT_PATTERNS = [
  {
    id: "batch-of",
    label: "\u300CBatch of N\u300D\u6279\u91CF\u5F0F\u81EA\u8FF0\uFF08\u5E94\u62A5 verification-round-N / \u6EDA\u52A8\u6D3E\u53D1\u8BED\u4E49\uFF09",
    re: /\bBatch\s+of\s+\d+\b/i
  },
  {
    id: "batch-count",
    label: "\u300Cbatch N/M\u300D\u6309\u6279\u8BA1\u6570\u81EA\u8FF0",
    re: /\bbatch\s*\d+\s*\/\s*\d+\b/i
  },
  {
    id: "batch-id",
    label: "\u300Cbatch-N\u300D\u6279\u6B21\u7F16\u53F7\u81EA\u8FF0",
    re: /\bbatch[-_ ]?(\d+)(?![-_a-zA-Z])/i
  },
  {
    id: "by-batch",
    label: "\u300C\u6309\u6279\u300D\u6309\u6279\u7EC4\u7EC7\u81EA\u8FF0",
    re: /按批/
  }
];
function flagBatchVocab(text) {
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
          match: m[0]
        });
      }
    }
  }
  return hits;
}
function nextConvergenceState(prev, count, convergenceRounds) {
  const prevRounds = prev && Number.isFinite(prev.roundsClean) ? prev.roundsClean : 0;
  const roundsClean = count === 0 ? prevRounds + 1 : 0;
  return {
    roundsClean,
    converged: roundsClean >= convergenceRounds,
    lastCount: count,
    lastAuditAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function loadCommitRecords(root, count) {
  let out;
  try {
    out = execFileSync(
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
    usage: "[--root <dir>] [--count <n>] [--convergence-rounds <n>] [--state <file>] [--no-state] [--json] [--text <s>] [--stdin] [--help]",
    help: "return",
    flags: {
      root: { type: "string" },
      count: { type: "string" },
      "convergence-rounds": { type: "string" },
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
    convergenceRounds: flagNum(flags["convergence-rounds"], 3),
    json: flags.json === true,
    state: typeof flags.state === "string" ? flags.state : null,
    noState: flags["no-state"] === true,
    text: typeof flags.text === "string" ? flags.text : null,
    stdin: flags.stdin === true,
    help: help === true
  };
}
function main(argv) {
  const args = parseArgs2(argv);
  if (args.help) helpExit("usage: node self-report-vocab-check.ts [--root <dir>] [--count <n>] [--convergence-rounds <n>] [--state <file>] [--no-state] [--json] [--text <s>] [--stdin]");
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
  const selfReports = textSource === "git-log" ? records.filter((r) => isInnerSelfReport(r.subject)) : records;
  const flagged = [];
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
  }
  const count = flagged.length;
  const statePath = args.noState ? null : args.state || path2.join(args.root, ".quay", "self-report-vocab-state.json");
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
    fs.mkdirSync(path2.dirname(statePath), { recursive: true });
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
    stateFile: statePath
  };
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}
`);
  } else if (count === 0) {
    process.stdout.write(
      `OK \u2014 no batch-style inner self-report (count=0, roundsClean=${conv.roundsClean}/${args.convergenceRounds}, converged=${conv.converged})
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
  process.exit(main(process.argv.slice(2)));
}
export {
  BATCH_SELF_REPORT_PATTERNS,
  flagBatchVocab,
  isInnerSelfReport,
  loadCommitRecords,
  main,
  nextConvergenceState
};
