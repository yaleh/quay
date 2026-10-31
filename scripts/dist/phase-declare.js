#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-CAeSy4/scripts/phase-declare.ts
import fs from "node:fs";
import path2 from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// .tmp-dist-publish-worktrees/publish-CAeSy4/scripts/gate-script-base.ts
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

// .tmp-dist-publish-worktrees/publish-CAeSy4/scripts/phase-declare.ts
var STATE_FILE_REL = ".quay/two-phase-state.json";
var PHASES = ["expansion", "convergence"];
var MIN_REASON_CHARS = 8;
var DEFAULT_WINDOW = 50;
var EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
var FLAG_THRESHOLD = 3;
var MIN_DOC_LINES = 20;
var DOC_RE = /\.(md|txt)$/i;
function parseNumstat(text) {
  const rows = [];
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (!m) continue;
    const [, addedRaw, deletedRaw, p] = m;
    rows.push({
      added: addedRaw === "-" ? 0 : parseInt(addedRaw, 10),
      deleted: deletedRaw === "-" ? 0 : parseInt(deletedRaw, 10),
      path: p
    });
  }
  return rows;
}
function classify(filePath) {
  return DOC_RE.test(filePath) ? "doc" : "code";
}
function computeRatio(rows, opts = {}) {
  const flagThreshold = opts.flagThreshold ?? FLAG_THRESHOLD;
  const minDocLines = opts.minDocLines ?? MIN_DOC_LINES;
  let docLines = 0;
  let codeLines = 0;
  for (const r of rows) {
    const total = r.added + r.deleted;
    if (classify(r.path) === "doc") docLines += total;
    else codeLines += total;
  }
  if (docLines === 0 && codeLines === 0) {
    return { docLines, codeLines, ratio: null, verdict: "N/A", flagged: false };
  }
  const ratio = codeLines === 0 ? Infinity : docLines / codeLines;
  const flagged = docLines > minDocLines && ratio > flagThreshold;
  return { docLines, codeLines, ratio, verdict: flagged ? "FLAGGED (prose-heavy)" : "PASS", flagged };
}
function git(args, root) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}
function takeLdReading(root, window = DEFAULT_WINDOW) {
  const head = git(["rev-parse", "HEAD"], root).trim();
  const commitCount = parseInt(git(["rev-list", "--count", "HEAD"], root).trim(), 10);
  const base = commitCount > window ? `HEAD~${window}` : EMPTY_TREE;
  const range = `${base}..HEAD`;
  const rows = parseNumstat(git(["diff", "--numstat", range], root));
  const r = computeRatio(rows);
  return {
    rule: "L_D code:doc line-delta ratio (archived git-lens-l-d-code-doc-ratio rule: doc=/.(md|txt)$/i, ratio=docLines/codeLines, flagged = ratio > 3.0 AND docLines > 20)",
    range,
    head,
    commitCount,
    docLines: r.docLines,
    codeLines: r.codeLines,
    // JSON has no Infinity literal; a code-less range records null + the verdict says why.
    ratio: r.ratio === Infinity ? null : r.ratio,
    verdict: r.ratio === Infinity ? "FLAGGED (prose-heavy: codeLines=0)" : r.verdict,
    flagged: r.flagged || r.ratio === Infinity
  };
}
function carrierPath(root) {
  return path2.join(root, STATE_FILE_REL);
}
function readCarrier(root) {
  const p = carrierPath(root);
  if (!fs.existsSync(p)) return { exists: false, history: [] };
  const raw = fs.readFileSync(p, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${STATE_FILE_REL} exists but is not valid JSON (${e.message}) \u2014 refusing to overwrite; fix or remove it first`);
  }
  const history = parsed.history;
  if (!Array.isArray(history)) {
    throw new Error(`${STATE_FILE_REL} has no \`history\` array \u2014 refusing to overwrite an unrecognized shape`);
  }
  return { exists: true, history };
}
function buildState(prev, d) {
  const history = [...prev, d];
  return { phase: d.phase, declaredAt: d.declaredAt, reason: d.reason, reading: d.reading, history };
}
var GOAL_ID_RE = /^(GOAL-\d+)/;
var DAY_MS = 864e5;
function stalenessNotEvaluated(reason) {
  return {
    evaluated: false,
    reason,
    phase: null,
    declaredAt: null,
    declarations: null,
    commitsSince: null,
    newGoalsSince: null,
    daysSince: null
  };
}
function readPhaseStaleness(root, opts = {}) {
  const repo = path2.resolve(root);
  const p = carrierPath(repo);
  let raw;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch (e) {
    const code = e.code;
    return code === "ENOENT" ? stalenessNotEvaluated(
      `carrier-missing: ${STATE_FILE_REL} does not exist under ${repo} \u2014 there is no declaration to measure the distance from`
    ) : stalenessNotEvaluated(`carrier-unreadable: ${STATE_FILE_REL} could not be read (${e.message})`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return stalenessNotEvaluated(
      `carrier-unparseable: ${STATE_FILE_REL} is not valid JSON (${e.message}) \u2014 the declaration exists but could not be read`
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return stalenessNotEvaluated(`carrier-shape-unrecognized: ${STATE_FILE_REL} is not a JSON object`);
  }
  const state = parsed;
  if (typeof state.phase !== "string" || !PHASES.includes(state.phase)) {
    return stalenessNotEvaluated(
      `carrier-shape-unrecognized: ${STATE_FILE_REL} has no legal phase value (${JSON.stringify(state.phase ?? null)})`
    );
  }
  if (typeof state.declaredAt !== "string" || !Number.isFinite(Date.parse(state.declaredAt))) {
    return stalenessNotEvaluated(
      `carrier-shape-unrecognized: ${STATE_FILE_REL} has no parseable declaredAt (${JSON.stringify(state.declaredAt ?? null)})`
    );
  }
  if (!Array.isArray(state.history)) {
    return stalenessNotEvaluated(`carrier-shape-unrecognized: ${STATE_FILE_REL} has no history array`);
  }
  const declaredAt = state.declaredAt;
  let commitsSince;
  try {
    const out = git(["rev-list", "--count", `--since=${declaredAt}`, "HEAD"], repo).trim();
    const n = Number(out);
    if (!Number.isInteger(n) || n < 0) throw new Error(`unexpected output ${JSON.stringify(out)}`);
    commitsSince = n;
  } catch (e) {
    return stalenessNotEvaluated(
      `git-unavailable: git rev-list --count --since=${declaredAt} HEAD failed in ${repo} (${e.message})`
    );
  }
  let newGoalsSince;
  try {
    const out = git(["log", `--since=${declaredAt}`, "--diff-filter=A", "--name-only", "--format=", "--", "goals/"], repo);
    const ids = /* @__PURE__ */ new Set();
    for (const line of out.split("\n")) {
      const rel = line.trim();
      if (!rel) continue;
      const m = path2.posix.basename(rel).match(GOAL_ID_RE);
      if (m) ids.add(m[1]);
    }
    newGoalsSince = [...ids].sort();
  } catch (e) {
    return stalenessNotEvaluated(
      `git-unavailable: git log --diff-filter=A --name-only -- goals/ failed in ${repo} (${e.message})`
    );
  }
  const nowMs = (opts.now ?? /* @__PURE__ */ new Date()).getTime();
  const daysSince = Number.isFinite(nowMs) ? Math.round((nowMs - Date.parse(declaredAt)) / DAY_MS * 100) / 100 : null;
  return {
    evaluated: true,
    reason: null,
    phase: state.phase,
    declaredAt,
    declarations: state.history.length,
    commitsSince,
    newGoalsSince,
    daysSince
  };
}
function takeLdFileReading(numstatFile) {
  const text = fs.readFileSync(numstatFile, "utf8");
  const r = computeRatio(parseNumstat(text));
  return {
    rule: "L_D code:doc line-delta ratio (archived git-lens-l-d-code-doc-ratio rule: doc=/.(md|txt)$/i, ratio=docLines/codeLines, flagged = ratio > 3.0 AND docLines > 20)",
    numstatFile,
    docLines: r.docLines,
    codeLines: r.codeLines,
    ratio: r.ratio === Infinity ? null : r.ratio,
    verdict: r.ratio === Infinity ? "FLAGGED (prose-heavy: codeLines=0)" : r.verdict,
    flagged: r.flagged || r.ratio === Infinity
  };
}
function parseArgs2(argv) {
  const parsed = parseArgs(["node", "phase-declare", ...argv], {
    minArgs: 0,
    usage: '--to <expansion|convergence> --reason "<one sentence>" [--root <repo>] [--window <n>] [--json]\n       --staleness [--root <repo>] [--json]\n       --ld-reading --numstat-file <f> [--json]',
    help: "return",
    errors: "return",
    unknown: "reject",
    flags: {
      to: { type: "string" },
      reason: { type: "string" },
      root: { type: "string" },
      window: { type: "string" },
      staleness: { type: "boolean" },
      "ld-reading": { type: "boolean" },
      "numstat-file": { type: "string" },
      json: { type: "boolean" }
    }
  });
  const str = (v) => typeof v === "string" ? v : void 0;
  const out = {
    to: str(parsed.flags.to),
    reason: str(parsed.flags.reason),
    root: str(parsed.flags.root),
    staleness: parsed.flags.staleness === true,
    ldReading: parsed.flags["ld-reading"] === true,
    json: parsed.flags.json === true
  };
  const numstatFile = str(parsed.flags["numstat-file"]);
  if (numstatFile !== void 0 && numstatFile !== "") out.numstatFile = numstatFile;
  if (parsed.help) return { ...out, error: "help" };
  if (parsed.error) return { ...out, error: parsed.error };
  if (parsed.args.length > 0) return { ...out, error: `unknown argument: ${parsed.args[0]}` };
  if (parsed.flags.window !== void 0) {
    const raw = parsed.flags.window;
    const v = raw === "" ? void 0 : String(raw);
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) return { ...out, error: `--window expects a positive integer, got ${JSON.stringify(v)}` };
    out.window = n;
  }
  return out;
}
var USAGE = `phase-declare.ts \u2014 declare the ADR-008 two-phase breathing state (record only, no auto switch).

Usage:
  node --experimental-strip-types plugin/scripts/phase-declare.ts \\
       --to <expansion|convergence> --reason "<one sentence>" [--root <repo>] [--window <n>] [--json]
  node --experimental-strip-types plugin/scripts/phase-declare.ts \\
       --staleness [--root <repo>] [--json]      (READ-ONLY: no file is written)
  node --experimental-strip-types plugin/scripts/phase-declare.ts \\
       --ld-reading --numstat-file <f> [--json] (READ-ONLY: the L_D reading over a numstat file)

Exit: 0 written | 1 refused (no/thin --reason, or unreadable carrier) | 2 usage | 3 no reading
      (with --staleness / --ld-reading: 0 = read and evaluated (--ld-reading: NOT flagged),
       1 = --ld-reading: FLAGGED, 3 = NOT-EVALUATED \u2014 a distinct value, see its reason)`;
function main() {
  const opts = parseArgs2(process.argv.slice(2));
  if (opts.error === "help") {
    console.log(USAGE);
    process.exit(0);
  }
  if (opts.error) {
    console.error(`phase-declare: ${opts.error}

${USAGE}`);
    process.exit(2);
  }
  const repoRoot = opts.root ? path2.resolve(opts.root) : path2.resolve(path2.dirname(fileURLToPath(import.meta.url)), "..", "..");
  if (opts.ldReading) {
    if (opts.to !== void 0 || opts.reason !== void 0 || opts.staleness) {
      console.error(`phase-declare: --ld-reading is a read-only reading and cannot be combined with --to/--reason/--staleness

${USAGE}`);
      process.exit(2);
    }
    if (!opts.numstatFile) {
      console.error(`phase-declare: --ld-reading requires --numstat-file <f>

${USAGE}`);
      process.exit(2);
    }
    let ld;
    try {
      ld = takeLdFileReading(opts.numstatFile);
    } catch (e) {
      console.error(`phase-declare: NO-READING \u2014 cannot read --numstat-file ${opts.numstatFile}: ${e.message}`);
      process.exit(3);
    }
    if (opts.json) {
      console.log(JSON.stringify(ld, null, 2));
    } else {
      console.log(
        `phase-declare: L_D docLines=${ld.docLines} codeLines=${ld.codeLines} ratio=${ld.ratio === null ? "n/a" : ld.ratio.toFixed(3)} verdict=${ld.verdict} (${ld.numstatFile})`
      );
    }
    process.exitCode = ld.flagged ? 1 : 0;
    return;
  }
  if (opts.numstatFile !== void 0) {
    console.error(`phase-declare: --numstat-file is only meaningful with --ld-reading

${USAGE}`);
    process.exit(2);
  }
  if (opts.staleness) {
    if (opts.to !== void 0 || opts.reason !== void 0) {
      console.error(`phase-declare: --staleness is a read-only reading and cannot be combined with --to/--reason

${USAGE}`);
      process.exit(2);
    }
    const staleness = readPhaseStaleness(repoRoot);
    if (opts.json) {
      console.log(JSON.stringify(staleness, null, 2));
    } else if (!staleness.evaluated) {
      console.log(`phase-declare: NOT-EVALUATED \u2014 ${staleness.reason}`);
    } else {
      console.log(
        `phase-declare: phase=${staleness.phase} declaredAt=${staleness.declaredAt} (${staleness.daysSince} days ago, ${staleness.declarations} declaration(s) recorded)`
      );
      console.log(
        `  since then: commits=${staleness.commitsSince} newGoals=${staleness.newGoalsSince?.length ?? 0}` + (staleness.newGoalsSince && staleness.newGoalsSince.length > 0 ? ` [${staleness.newGoalsSince.join(", ")}]` : "")
      );
    }
    process.exit(staleness.evaluated ? 0 : 3);
  }
  if (!opts.to || !PHASES.includes(opts.to)) {
    console.error(`phase-declare: --to must be one of ${PHASES.join("|")} (got ${JSON.stringify(opts.to ?? null)})

${USAGE}`);
    process.exit(2);
  }
  const reason = (opts.reason ?? "").trim();
  const reasonChars = reason.replace(/\s+/g, "").length;
  if (reasonChars < MIN_REASON_CHARS) {
    console.error(
      `phase-declare: REFUSED \u2014 --reason is missing or below ${MIN_REASON_CHARS} non-whitespace chars (got ${reasonChars}). A phase switch without a recorded trigger is not auditable; nothing was written.`
    );
    process.exit(1);
  }
  const root = repoRoot;
  let prev;
  try {
    prev = readCarrier(root).history;
  } catch (e) {
    console.error(`phase-declare: REFUSED \u2014 ${e.message}`);
    process.exit(1);
  }
  let reading;
  try {
    reading = takeLdReading(root, opts.window ?? DEFAULT_WINDOW);
  } catch (e) {
    console.error(`phase-declare: NO-READING \u2014 git could not produce the L_D snapshot: ${e.message}`);
    process.exit(3);
  }
  const declaration = {
    phase: opts.to,
    declaredAt: (/* @__PURE__ */ new Date()).toISOString(),
    reason,
    reading
  };
  const state = buildState(prev, declaration);
  const p = carrierPath(root);
  fs.mkdirSync(path2.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state, null, 2) + "\n", "utf8");
  if (opts.json) {
    console.log(JSON.stringify(declaration, null, 2));
  } else {
    console.log(`phase-declare: phase=${declaration.phase} at ${declaration.declaredAt}`);
    console.log(`  reason : ${declaration.reason}`);
    console.log(
      `  L_D    : docLines=${reading.docLines} codeLines=${reading.codeLines} ratio=${reading.ratio === null ? "n/a" : reading.ratio.toFixed(3)} verdict=${reading.verdict} (${reading.range})`
    );
    console.log(`  carrier: ${path2.relative(root, p)} (${state.history.length} declaration(s) recorded)`);
  }
  process.exit(0);
}
if (isDirectEntry(import.meta, void 0, "phase-declare")) {
  main();
}
export {
  DEFAULT_WINDOW,
  EMPTY_TREE,
  FLAG_THRESHOLD,
  MIN_DOC_LINES,
  MIN_REASON_CHARS,
  PHASES,
  STATE_FILE_REL,
  buildState,
  carrierPath,
  classify,
  computeRatio,
  parseArgs2 as parseArgs,
  parseNumstat,
  readCarrier,
  readPhaseStaleness,
  takeLdFileReading,
  takeLdReading
};
