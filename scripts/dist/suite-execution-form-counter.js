#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/suite-execution-form-counter.ts
import fs2 from "node:fs";
import os from "node:os";
import path3 from "node:path";

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

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/repo-root.ts
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

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/suite-execution-form-counter.ts
var DEFAULT_VERIFICATION_ROUND_REL = path3.join(".quay", "verification-round.jsonl");
var DEFAULT_EPSILON_MS = 90 * 1e3;
var DEFAULT_RECENT_N = 5;
var FORM_MAIN_SESSION = "main-session";
var FORM_SUBAGENT = "subagent";
var FORM_WORKFLOW = "workflow";
var FORM_UNCLASSIFIED = "unclassified";
function isSuiteRound(rec) {
  return rec !== null && typeof rec === "object" && (typeof rec.runner === "string" || typeof rec.startedAt === "string");
}
function parseIsoMs(value) {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}
function classifyTranscriptFile(filePath, projectDir) {
  const rel = path3.relative(projectDir, filePath);
  if (rel.startsWith("..") || path3.isAbsolute(rel)) return null;
  const parts = rel.split(path3.sep);
  const leaf = parts[parts.length - 1] ?? "";
  if (!leaf.endsWith(".jsonl")) return null;
  if (parts.length === 1) return FORM_MAIN_SESSION;
  if (parts.length >= 4 && parts[1] === "subagents" && parts[2] === "workflows" && leaf.startsWith("agent-")) {
    return FORM_WORKFLOW;
  }
  if (parts.length === 3 && parts[1] === "subagents" && leaf.startsWith("agent-")) {
    return FORM_SUBAGENT;
  }
  return null;
}
function isLaunchCommand(cmd) {
  if (typeof cmd !== "string" || !cmd.includes("full-suite-runner.ts")) return false;
  const re = /\bnode\b/g;
  let m;
  while ((m = re.exec(cmd)) !== null) {
    const tail = cmd.slice(m.index);
    const segMatch = tail.match(/^((?:(?!\n|;|\||&).)*?)full-suite-runner\.ts/);
    if (!segMatch) continue;
    const seg = segMatch[1];
    if (/-(?:e|c)\b|--(?:eval|check)\b/.test(seg)) continue;
    const lastCmd = cmd.slice(0, m.index).split(/\n|&&|\|\||;|\|/).map((s) => s.trim()).filter(Boolean).pop() ?? "";
    if (/\b(?:echo|grep|sed|cat|head|tail|jq|pgrep|rg|diff|awk|python3)\b/.test(lastCmd)) return false;
    return true;
  }
  return false;
}
function extractLaunchesFromFile(filePath, projectDir) {
  const form = classifyTranscriptFile(filePath, projectDir);
  if (form === null) return [];
  let text;
  try {
    text = fs2.readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l || !l.includes('"tool_use"')) continue;
    let rec;
    try {
      rec = JSON.parse(l);
    } catch {
      continue;
    }
    if (rec === null || typeof rec !== "object" || rec.type !== "assistant") continue;
    const content = rec.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      if (block.type !== "tool_use" || block.name !== "Bash") continue;
      const cmd = block.input?.command;
      if (!isLaunchCommand(cmd)) continue;
      out.push({ tsMs: parseIsoMs(rec.timestamp), form, filePath });
    }
  }
  return out;
}
function collectLaunches(projectDir) {
  const launches = [];
  const stack = [projectDir];
  const seen = /* @__PURE__ */ new Set();
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs2.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path3.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!e.name.endsWith(".jsonl") || e.name.endsWith(".meta.json")) continue;
      if (seen.has(full)) continue;
      seen.add(full);
      launches.push(...extractLaunchesFromFile(full, projectDir));
    }
  }
  return launches;
}
function findLaunchForm(launches, startedAtMs, epsilonMs) {
  let best = null;
  for (const l of launches) {
    if (l.tsMs === null) continue;
    const d = Math.abs(l.tsMs - startedAtMs);
    if (d <= epsilonMs && (best === null || d < best.gapMs)) {
      best = { form: l.form, gapMs: d, matchedTsMs: l.tsMs };
    }
  }
  return best;
}
function classifyRounds(records, launches, epsilonMs) {
  const out = [];
  for (const rec of records) {
    const startedAtMs = parseIsoMs(rec?.startedAt);
    if (startedAtMs === null) continue;
    const m = findLaunchForm(launches, startedAtMs, epsilonMs);
    out.push({
      round: typeof rec.round === "number" ? rec.round : null,
      startedAt: rec.startedAt ?? null,
      startedAtMs,
      form: m ? m.form : FORM_UNCLASSIFIED,
      gapMs: m ? m.gapMs : null,
      matchedTsMs: m ? m.matchedTsMs : null
    });
  }
  return out;
}
function countConsecutiveOuterRounds(records) {
  let consecutive = 0;
  const runnerCounts = {};
  for (const rec of records) {
    if (!isSuiteRound(rec)) continue;
    const r = typeof rec.runner === "string" ? rec.runner : "missing";
    runnerCounts[r] = (runnerCounts[r] ?? 0) + 1;
  }
  for (let i = records.length - 1; i >= 0; i--) {
    const rec = records[i];
    if (!isSuiteRound(rec)) continue;
    const r = typeof rec.runner === "string" ? rec.runner : null;
    if (r === "outer") consecutive++;
    else break;
  }
  return { consecutive, runnerCounts };
}
function judgeInvariant(roundForms, n) {
  const window = roundForms.slice(-n);
  const classified = window.filter((f) => f.form !== FORM_UNCLASSIFIED);
  const unclassifiedInWindow = window.length - classified.length;
  const distinct = new Set(classified.map((f) => f.form)).size;
  if (classified.length >= 2) {
    const holds = distinct >= 2;
    return {
      band: holds ? "healthy" : "rollback",
      signal: !holds,
      action: holds ? null : "\u6267\u884C\u5F62\u6001\u56DE\u843D\u2014\u2014\u8FD1 N \u8F6E\u5DF2\u5206\u7C7B\u8F6E\u6B21\u5168\u90E8\u540C\u4E00\u5F62\u6001",
      distinct_forms: distinct,
      classified_in_recent_n: classified.length,
      unclassified_in_recent_n: unclassifiedInWindow,
      message: holds ? `\u8FD1 ${n} \u8F6E\u5DF2\u5206\u7C7B\u6267\u884C\u5F62\u6001 ${distinct} \u7C7B\uFF08\u22652\uFF09\u2014\u2014invariant \u6210\u7ACB` : `\u8FD1 ${n} \u8F6E\u5DF2\u5206\u7C7B\u6267\u884C\u5F62\u6001\u4EC5 ${distinct} \u7C7B\uFF08\u5168\u90E8 ${classified[0].form}\uFF0C\u5171 ${classified.length} \u8F6E\uFF09\u2014\u2014invariant \u4E0D\u6210\u7ACB\uFF0C\u6267\u884C\u5F62\u6001\u56DE\u843D`
    };
  }
  return {
    band: "insufficient-evidence",
    signal: false,
    action: null,
    distinct_forms: distinct,
    classified_in_recent_n: classified.length,
    unclassified_in_recent_n: unclassifiedInWindow,
    message: `\u8FD1 ${n} \u8F6E\u5DF2\u5206\u7C7B\u8F6E\u6B21 ${classified.length}\uFF08<2\uFF0C\u591A\u4E3A unclassified/\u89E6\u53D1\u81EA\u52A8\u6CBB\u7406 ${unclassifiedInWindow} \u8F6E\uFF09\u2014\u2014\u8BC1\u636E\u4E0D\u8DB3\uFF0C\u4E0D\u8BA1 signal\uFF1B\u8FD9\u672C\u8EAB\u4E0D\u662F\u56DE\u843D\uFF08\u4E3B\u4F1A\u8BDD\u76F4\u8DD1\u624D\u8D8A\u754C\uFF09`
  };
}
function deriveProjectDir(root) {
  const abs = path3.resolve(root);
  const encoded = "-" + abs.replace(/^\/+/, "").replace(/\//g, "-");
  return path3.join(os.homedir(), ".claude", "projects", encoded);
}
function usage() {
  console.error(`suite-execution-form-counter.ts \u2014 \u5957\u4EF6\u6267\u884C\u5F62\u6001\u7684\u673A\u68B0\u8BA1\u6570\u5668\uFF08\u5916\u5C42\u6BCF tick \u8DD1\uFF09

\u6267\u884C\u5F62\u6001\u53D6\u8BC1\uFF08tasks/gap-a19-evidence-field-does-not-match-measured-object\uFF0Cmanager 2026-08-13 \u91CD\u5199\uFF09\uFF1A
\u4E3A\u6BCF\u8F6E verification-round\uFF08\u6709 startedAt\uFF09\u627E [startedAt \xB1 \u03B5] \u7A97\u5185\u6700\u8FD1\u7684 launch Bash tool_use
\uFF08node \u6267\u884C full-suite-runner.ts\uFF0C\u975E grep/sed/node -e\uFF09\uFF0C\u5176 transcript \u6587\u4EF6\u7C7B\u522B\u5373\u6267\u884C\u5F62\u6001\uFF1A
  \u4E3B\u4F1A\u8BDD <project>/<session>.jsonl \xB7 subagent <project>/<session>/subagents/agent-*.jsonl \xB7
  workflow <project>/<session>/subagents/workflows/<run>/agent-*.jsonl
\u65E0\u5339\u914D \u21D2 unclassified\uFF08\u7F3A\u503C=\u672A\u67E5\uFF0C\u89E6\u53D1\u81EA\u52A8\u6CBB\u7406\u662F\u5065\u5EB7\u6001\uFF0C\u4E0D\u662F\u56DE\u843D\uFF09\u3002

invariant\uFF08\u53EF\u53D6\u5047\uFF0C\u66FF\u6362\u6052\u771F runner_field_tracked=1\uFF09\uFF1A\u300C\u8FD1 N \u8F6E\u5DF2\u5206\u7C7B\u5F62\u6001\u51FA\u73B0 \u22652 \u7C7B\u300D\u3002
  \u5DF2\u5206\u7C7B \u22652 \u4E14\u5168\u540C\u7C7B \u21D2 band=rollback signal=1\uFF08exit 1\uFF09\uFF1B\u5426\u5219 healthy / insufficient-evidence\uFF08exit 0\uFF09\u3002

Usage:
  --root <dir>                 workspace root (default: auto-derived from this script's location)
  --project-dir <dir>          transcript project root override (default: ~/.claude/projects/<encoded-root>)
  --verification-round <path>  override the verification-round.jsonl path (test seam)
  --epsilon-ms <n>             launch match window (default 300000 = 5min)
  --recent-n <n>               invariant window N (default 5)
  --json                       JSON output (measure-only, never mutates)
  --help|-h                    this usage (exit 0)

Exit: 0 healthy / insufficient-evidence \xB7 1 rollback signal (invariant false) \xB7 2 usage/env error`);
}
function main(argv) {
  const args = argv.slice(2);
  const flagVal = (name, def) => flagValue(args, name) ?? def;
  if (args.includes("--help") || args.includes("-h")) {
    usage();
    return 0;
  }
  const jsonOut = args.includes("--json");
  const autoRoot = repoRoot();
  const root = flagVal("--root", autoRoot);
  const epsilonArg = flagVal("--epsilon-ms", String(DEFAULT_EPSILON_MS));
  const epsilonMs = Number(epsilonArg);
  if (!Number.isInteger(epsilonMs) || epsilonMs <= 0) {
    console.error(`suite-execution-form-counter: \u65E0\u6548 --epsilon-ms '${epsilonArg}'\uFF08\u5FC5\u987B\u4E3A\u6B63\u6574\u6570 ms\uFF0C\u9ED8\u8BA4 ${DEFAULT_EPSILON_MS}\uFF09`);
    return 2;
  }
  const nArg = flagVal("--recent-n", String(DEFAULT_RECENT_N));
  const n = Number(nArg);
  if (!Number.isInteger(n) || n <= 0) {
    console.error(`suite-execution-form-counter: \u65E0\u6548 --recent-n '${nArg}'\uFF08\u5FC5\u987B\u4E3A\u6B63\u6574\u6570\uFF0C\u9ED8\u8BA4 ${DEFAULT_RECENT_N}\uFF09`);
    return 2;
  }
  const verificationRound = flagVal("--verification-round", "") || path3.join(root, DEFAULT_VERIFICATION_ROUND_REL);
  const projectDir = flagVal("--project-dir", "") || deriveProjectDir(root);
  let records = [];
  if (fs2.existsSync(verificationRound)) {
    const text = fs2.readFileSync(verificationRound, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const l = line.trim();
      if (!l) continue;
      try {
        records.push(JSON.parse(l));
      } catch {
        continue;
      }
    }
  }
  const projectExists = fs2.existsSync(projectDir);
  const launches = projectExists ? collectLaunches(projectDir) : [];
  const roundForms = classifyRounds(records, launches, epsilonMs);
  const verdict = judgeInvariant(roundForms, n);
  const { consecutive, runnerCounts } = countConsecutiveOuterRounds(records);
  const suiteRounds = Object.values(runnerCounts).reduce((a, b) => a + b, 0);
  const out = {
    signal: verdict.signal,
    band: verdict.band,
    action: verdict.action,
    message: verdict.message,
    invariant_holds: verdict.signal ? false : verdict.band === "healthy",
    distinct_forms_in_recent_n: verdict.distinct_forms,
    classified_in_recent_n: verdict.classified_in_recent_n,
    unclassified_in_recent_n: verdict.unclassified_in_recent_n,
    recent_n: n,
    epsilon_ms: epsilonMs,
    // 逐轮执行形态（近 N 轮完整列出，更早轮仅计数）
    execution_forms: roundForms.slice(-n).map((f) => ({
      round: f.round,
      startedAt: f.startedAt,
      form: f.form,
      ...f.gapMs !== null ? { gap_ms: Math.round(f.gapMs) } : {},
      ...f.matchedTsMs !== null ? { matched_ts: f.matchedTsMs } : {}
    })),
    forms_by_round: (() => {
      const c = { main_session: 0, subagent: 0, workflow: 0, unclassified: 0 };
      for (const f of roundForms) {
        if (f.form === FORM_MAIN_SESSION) c.main_session++;
        else if (f.form === FORM_SUBAGENT) c.subagent++;
        else if (f.form === FORM_WORKFLOW) c.workflow++;
        else c.unclassified++;
      }
      return c;
    })(),
    // ⚠️ 非执行面取证（A19 重写降级）：consecutive_outer_rounds/runner_counts 恒反映 runner 硬编码 outer，
    // 不代表执行形态，绝不驱动 signal。仅保留展示/历史对照。
    consecutive_outer_rounds: consecutive,
    runner_counts: runnerCounts,
    project_dir: projectDir,
    project_dir_exists: projectExists,
    verification_round: verificationRound,
    total_records: records.length,
    suite_rounds: suiteRounds,
    rounds_classified: roundForms.length,
    _non_execution_surface: "runner \u5B57\u6BB5\u5DF2\u964D\u7EA7\u4E3A\u5C42\u8EAB\u4EFD/\u5C55\u793A\u6807\u6CE8\u2014\u2014\u6267\u884C\u5F62\u6001\u53D6\u8BC1\u9762\u662F launch tool_use \u7684 transcript \u6587\u4EF6\u7C7B\u522B"
  };
  if (jsonOut) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(
      `suite-execution-form-counter: ${out.message} [band=${out.band} forms=${JSON.stringify(out.forms_by_round)}]`
    );
  }
  return out.signal ? 1 : 0;
}
if (isDirectEntry(import.meta, void 0, "suite-execution-form-counter")) {
  const code = main(process.argv);
  process.exit(code);
}
export {
  DEFAULT_EPSILON_MS,
  DEFAULT_RECENT_N,
  DEFAULT_VERIFICATION_ROUND_REL,
  FORM_MAIN_SESSION,
  FORM_SUBAGENT,
  FORM_UNCLASSIFIED,
  FORM_WORKFLOW,
  classifyRounds,
  classifyTranscriptFile,
  collectLaunches,
  countConsecutiveOuterRounds,
  deriveProjectDir,
  extractLaunchesFromFile,
  findLaunchForm,
  isLaunchCommand,
  isSuiteRound,
  judgeInvariant,
  main,
  parseIsoMs
};
