#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/capability-catalog.ts
import fs2 from "node:fs";
import path2 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

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

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/capability-catalog.ts
var SCRIPT_DIR = path2.dirname(fileURLToPath2(import.meta.url));
var DECLARATIONS_BASENAME = "capability-catalog-declarations.json";
var TABLE_NAMES = [
  "QUESTION",
  "GUARD_OBJECT",
  "CADENCE",
  "INVALIDATION",
  "LAST_REAFFIRMED",
  "MATCHING",
  "CONSUMER",
  "SUPERSEDED",
  "NOT_SHIPPED",
  "PUBLIC_ENTRYPOINTS"
];
function declarationsCandidates() {
  return [
    path2.join(SCRIPT_DIR, DECLARATIONS_BASENAME),
    path2.join(SCRIPT_DIR, "..", DECLARATIONS_BASENAME)
  ];
}
function die(cause, detail) {
  console.error(`CAUSE=${cause} \u2014 ${detail}`);
  process.exit(3);
}
function loadTables() {
  const candidates = declarationsCandidates();
  const file = candidates.find((p) => fs2.existsSync(p));
  if (!file) {
    die(
      "declarations-missing",
      `no ${DECLARATIONS_BASENAME} found (looked in: ${candidates.join(", ")}). The capability catalog's declaration data is absent \u2014 refusing to render an empty catalog as if every check were declared.`
    );
  }
  const scriptsDir = path2.dirname(path2.resolve(file));
  let raw;
  try {
    raw = fs2.readFileSync(file, "utf8");
  } catch (e) {
    die("declarations-unreadable", `${file} could not be read: ${e.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    die("declarations-unparsable", `${file} is not valid JSON: ${e.message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    die("declarations-unparsable", `${file} must parse to a JSON object of tables, got ${Array.isArray(parsed) ? "an array" : typeof parsed}.`);
  }
  const obj = parsed;
  const tables = {};
  const missing = [];
  for (const name of TABLE_NAMES) {
    const v = obj[name];
    if (v === void 0) {
      missing.push(name);
      continue;
    }
    if (v === null || typeof v !== "object" || Array.isArray(v)) {
      die("declarations-table-malformed", `${file}: table ${name} must be a JSON object of key \u2192 string.`);
    }
    const t = {};
    for (const [k, val] of Object.entries(v)) {
      if (typeof val !== "string") {
        die("declarations-table-malformed", `${file}: ${name}[${k}] must be a string, got ${typeof val}.`);
      }
      t[k] = val;
    }
    tables[name] = t;
  }
  if (missing.length > 0) {
    die(
      "declarations-table-missing",
      `${file} is missing the ${missing.join(", ")} table(s). An absent table is NOT an empty table \u2014 rendering it as empty would silently report every check as unclassified-or-undeclared.`
    );
  }
  return { tables, file, scriptsDir };
}
function findCommandSubstitutions(tables) {
  const hits = [];
  for (const table of TABLE_NAMES) {
    for (const [k, v] of Object.entries(tables[table])) {
      if (v.includes("`") || v.includes("$(")) hits.push(`${table}[${k}]: ${v.slice(0, 120)}`);
    }
  }
  return hits;
}
var ARCHIVE_SEGMENT_RE = new RegExp("(^|/)archive/");
var SKIPPED_SEGMENTS = /* @__PURE__ */ new Set(["checker-mutation-cases"]);
var CHECK_EXT_RE = /\.(sh|ts|mjs)$/;
function isExcludedDirRelPath(rel) {
  return ARCHIVE_SEGMENT_RE.test(`${rel}/`) || SKIPPED_SEGMENTS.has(path2.basename(rel));
}
function deriveScripts(dir) {
  const out = [];
  const walk = (d, rel) => {
    let entries;
    try {
      entries = fs2.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path2.join(d, e.name);
      const relChild = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (isExcludedDirRelPath(relChild)) continue;
        walk(abs, relChild);
        continue;
      }
      if (!e.isFile()) continue;
      if (!CHECK_EXT_RE.test(e.name)) continue;
      out.push(e.name);
    }
  };
  walk(dir, "");
  return [...out].sort();
}
function listDirs(parent) {
  try {
    return fs2.readdirSync(parent, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}
function fileExists(p) {
  try {
    return fs2.statSync(p).isFile();
  } catch {
    return false;
  }
}
function runSupersededCheck(tables, scriptsDir) {
  const root = repoRoot(scriptsDir);
  const superseded = tables.SUPERSEDED;
  let viol = "";
  for (const b of Object.keys(superseded)) {
    const stem = b.replace(/\.[^.]*$/, "");
    if (fileExists(path2.join(root, "plugin", "scripts", b))) {
      viol += `  plugin/scripts/${b} \u2014 superseded implementation still exists
`;
    }
    for (const pkg of listDirs(path2.join(root, "packages"))) {
      const v = path2.join(root, "packages", pkg, "plugin", "scripts", b);
      if (fileExists(v)) viol += `  packages/${pkg}/plugin/scripts/${b} \u2014 superseded vendored copy still exists
`;
    }
    if (fileExists(path2.join(root, "plugin", "test", b))) {
      viol += `  plugin/test/${b} \u2014 superseded test still exists
`;
    }
    if (fileExists(path2.join(root, "plugin", "test", `${stem}.test.mjs`))) {
      viol += `  plugin/test/${stem}.test.mjs \u2014 superseded test still exists
`;
    }
    const teaching = [];
    for (const d of listDirs(path2.join(root, "plugin", "skills"))) teaching.push(path2.join(root, "plugin", "skills", d, "SKILL.md"));
    teaching.push(path2.join(root, "plugin", "README.md"), path2.join(root, "README.md"));
    for (const pkg of listDirs(path2.join(root, "packages"))) teaching.push(path2.join(root, "packages", pkg, "README.md"));
    for (const tf of teaching) {
      if (!fileExists(tf)) continue;
      if (fs2.readFileSync(tf, "utf8").includes(stem)) {
        viol += `  ${path2.relative(root, tf)} teaches the superseded capability ${b} (stem ${stem})
`;
      }
    }
  }
  if (viol) {
    console.error("FAIL (superseded-capability check): a superseded implementation must NOT exist in the executable layer nor be taught:");
    process.stderr.write(viol);
    return 1;
  }
  console.log(`superseded-capability check: PASS \u2014 every superseded capability is removed from the executable layer and not taught (${Object.keys(superseded).length} superseded)`);
  return 0;
}
var DOC_SH_RE = /plugin\/scripts\/([a-zA-Z0-9._-]+\.sh)/g;
function docReferencedSh(pluginRoot) {
  const loopDir = path2.join(pluginRoot, "loop");
  const skillsDir = path2.join(pluginRoot, "skills");
  if (!fs2.existsSync(loopDir) || !fs2.existsSync(skillsDir)) return [];
  const files = [];
  try {
    for (const f of fs2.readdirSync(loopDir)) if (f.endsWith(".md")) files.push(path2.join(loopDir, f));
  } catch {
  }
  for (const d of listDirs(skillsDir)) files.push(path2.join(skillsDir, d, "SKILL.md"));
  const found = /* @__PURE__ */ new Set();
  for (const f of files) {
    let text;
    try {
      text = fs2.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    for (const m of text.matchAll(DOC_SH_RE)) found.add(m[1]);
  }
  return [...found].sort();
}
function readHeaderComment() {
  let text;
  try {
    text = fs2.readFileSync(fileURLToPath2(import.meta.url), "utf8");
  } catch {
    return "";
  }
  return text.split("\n").slice(0, 120).filter((l) => l.startsWith("#") && !l.startsWith("#!")).map((l) => l.replace(/^# ?/, "")).filter((l) => !l.startsWith("!")).join("\n");
}
function main(argv) {
  const a0 = argv[0] ?? "";
  if (a0 === "--help" || a0 === "-h") {
    console.log("\u7528\u6CD5: bash capability-catalog.sh [\u53C2\u6570\u2026] \u2014 \u8BE6\u89C1\u4E0B\u65B9\u811A\u672C\u5934\u90E8\u7528\u6CD5\u6CE8\u91CA\uFF08--help|-h \u4EC5\u6253\u5370\u7528\u6CD5\uFF0C\u65E0\u526F\u4F5C\u7528\uFF0C\u9000\u51FA 0\uFF09");
    const header = readHeaderComment();
    if (header) console.log(header);
    return 0;
  }
  let mode = "table";
  let entrySurfaceSubmode = "";
  switch (a0) {
    case "--json":
      mode = "json";
      break;
    case "--table":
      mode = "table";
      break;
    case "--summary":
      mode = "summary";
      break;
    case "--entry-surface":
      mode = "entry-surface";
      switch (argv[1] ?? "") {
        case "--json":
          entrySurfaceSubmode = "json";
          break;
        case "--summary":
          entrySurfaceSubmode = "summary";
          break;
        case "":
          break;
        default:
          console.error(`ERROR: unknown --entry-surface sub-argument: ${argv[1]} (expected --json | --summary)`);
          return 2;
      }
      break;
    case "--superseded-check":
      mode = "superseded-check";
      break;
    case "":
      break;
    default:
      console.error(`ERROR: unknown argument: ${a0} (expected --json | --table | --summary | --entry-surface | --superseded-check)`);
      return 2;
  }
  const { tables, scriptsDir } = loadTables();
  const csHits = findCommandSubstitutions(tables);
  if (csHits.length > 0) {
    console.error(`FAIL (AC5 no-command-substitution): a declaration value in ${DECLARATIONS_BASENAME} contains a command-substitution pattern (backtick or $( ) \u2014 it would be evaluated as code wherever the value crosses back into a shell.`);
    console.error("  Write the command as plain text.");
    for (const h of csHits) console.error(`  ${h}`);
    return 1;
  }
  if (mode === "superseded-check") return runSupersededCheck(tables, scriptsDir);
  const scripts = deriveScripts(scriptsDir);
  const QUESTION = tables.QUESTION, CADENCE = tables.CADENCE, INVALIDATION = tables.INVALIDATION;
  const LAST_REAFFIRMED = tables.LAST_REAFFIRMED, MATCHING = tables.MATCHING;
  const CONSUMER = tables.CONSUMER, NOT_SHIPPED = tables.NOT_SHIPPED, PUBLIC_ENTRYPOINTS = tables.PUBLIC_ENTRYPOINTS;
  const TOTAL = scripts.length;
  let DECLARED = 0, UNCLASSIFIED = 0, SHIPPED = 0;
  let MISSING_CADENCE = 0, MISSING_INVALIDATION = 0, MISSING_LAST_REAFFIRMED = 0, MISSING_MATCHING = 0;
  let SH_SHIPPED = 0, PUBLIC_SH = 0, INTERNAL_SH = 0;
  const rows = [];
  for (const b of scripts) {
    const q = QUESTION[b] ?? "";
    if (q) DECLARED++;
    else UNCLASSIFIED++;
    const ships = !NOT_SHIPPED[b];
    if (ships) SHIPPED++;
    let surface = null;
    if (b.endsWith(".sh")) surface = PUBLIC_ENTRYPOINTS[b] ? "public" : "internal";
    const cadence = CADENCE[b] ?? "";
    const invalidation = INVALIDATION[b] ?? "";
    const lastReaffirmed = LAST_REAFFIRMED[b] ?? "";
    const matching = MATCHING[b] ?? "";
    const consumer = CONSUMER[b] ?? "";
    if (q) {
      if (!cadence) MISSING_CADENCE++;
      if (!invalidation) MISSING_INVALIDATION++;
      if (!lastReaffirmed) MISSING_LAST_REAFFIRMED++;
      if (!matching) MISSING_MATCHING++;
    }
    if (surface === "public") PUBLIC_SH++;
    if (surface === "internal") INTERNAL_SH++;
    if (b.endsWith(".sh")) SH_SHIPPED++;
    rows.push({ file: b, question: q, ships, surface, cadence, invalidation, lastReaffirmed, matching, consumer });
  }
  const pluginRoot = path2.resolve(scriptsDir, "..");
  const docRefs = docReferencedSh(pluginRoot);
  const violations = docRefs.filter((b) => !PUBLIC_ENTRYPOINTS[b]);
  const DOC_REFERENCED_SH_COUNT = docRefs.length;
  const VIOLATION_COUNT = violations.length;
  if (mode === "json") {
    const entries = rows.map((r) => ({
      file: r.file,
      question: r.question ? r.question : null,
      ships: r.ships,
      surface: r.surface,
      cadence: r.cadence ? r.cadence : null,
      invalidation: r.invalidation ? r.invalidation : null,
      last_reaffirmed: r.lastReaffirmed ? r.lastReaffirmed : null,
      matching: r.matching ? r.matching : null,
      consumer: r.consumer ? r.consumer : null
    }));
    process.stdout.write(JSON.stringify(entries, null, 2) + "\n");
  } else if (mode === "entry-surface") {
    if (entrySurfaceSubmode === "json") {
      process.stdout.write(JSON.stringify({
        sh_shipped: SH_SHIPPED,
        public_sh: PUBLIC_SH,
        internal_sh: INTERNAL_SH,
        doc_referenced_sh: DOC_REFERENCED_SH_COUNT,
        violations,
        ok: VIOLATION_COUNT === 0
      }, null, 2) + "\n");
    } else {
      console.log(`delivery form (.sh): ${SH_SHIPPED} shipped | ${PUBLIC_SH} declared consumer-facing | ${INTERNAL_SH} internal`);
      console.log(`consumer-facing docs reference ${DOC_REFERENCED_SH_COUNT} distinct .sh`);
      if (VIOLATION_COUNT > 0) {
        console.error(`FAIL (AC3): ${VIOLATION_COUNT} internal .sh script(s) are referenced by consumer-facing docs \u2014 the demotion is verbal, not real:`);
        for (const v of violations) console.error(`  ${v}`);
        console.error("  Declare each in PUBLIC_ENTRYPOINTS (capability-catalog-declarations.json) OR remove the doc reference.");
      } else {
        console.log("AC3 gate: every consumer-doc-referenced .sh is a declared public entry point \u2192 PASS");
      }
    }
  } else if (mode === "summary") {
    console.log(`capability-catalog: ${TOTAL} scripts | ${DECLARED} declared | ${UNCLASSIFIED} unclassified | ${SHIPPED} ship`);
  } else if (mode === "table") {
    console.log(`capability catalog \u2014 what each shipped check answers (${scriptsDir})`);
    console.log("---------------------------------------------------------------------------");
    for (const r of rows) {
      if (!r.ships) console.log(`  ${r.file.padEnd(40, " ")} ${r.question}   [NOT SHIPPED \u2014 exp5 legacy]`);
      else console.log(`  ${r.file.padEnd(40, " ")} ${r.question}`);
    }
    console.log("---------------------------------------------------------------------------");
    console.log(`summary: ${TOTAL} scripts | ${DECLARED} declared | ${UNCLASSIFIED} unclassified | ${SHIPPED} ship`);
    if (UNCLASSIFIED > 0) {
      console.error(`FAIL (AC1c): ${UNCLASSIFIED} script(s) entered the artifact without a declared question.`);
      console.error("  Add an entry to the QUESTION table in capability-catalog-declarations.json, or the check is rejected.");
    }
  }
  if (UNCLASSIFIED > 0) return 1;
  if (MISSING_CADENCE > 0 || MISSING_INVALIDATION > 0 || MISSING_LAST_REAFFIRMED > 0 || MISSING_MATCHING > 0) {
    console.error("FAIL (entry-gate, gap-crystallization-five-directions): a declared check is missing a required crystallization field.");
    if (MISSING_CADENCE > 0) console.error(`  ${MISSING_CADENCE} check(s) lack cadence: (\u6BCF\u8F6E|\u6BCF\u7EA2\u7A97|\u6BCF\u91CC\u7A0B\u7891|\u51B7\u542F\u52A8|\u6309\u9700) \u2014 add a CADENCE row.`);
    if (MISSING_INVALIDATION > 0) console.error(`  ${MISSING_INVALIDATION} check(s) lack \u5931\u6548\u524D\u63D0 (invalidation) \u2014 add an INVALIDATION row (testable precondition, or '\u65E0\u53EF\u6D4B\u524D\u63D0\uFF0C\u9760\u5468\u671F\u590D\u6838').`);
    if (MISSING_LAST_REAFFIRMED > 0) console.error(`  ${MISSING_LAST_REAFFIRMED} check(s) lack last-reaffirmed \u2014 add a LAST_REAFFIRMED row (YYYY-MM-DD).`);
    if (MISSING_MATCHING > 0) console.error(`  ${MISSING_MATCHING} check(s) lack matching method \u2014 add a MATCHING row (position|keyword|enumerative|n/a).`);
    return 1;
  }
  if (mode === "entry-surface" && VIOLATION_COUNT > 0) return 1;
  return 0;
}
var isDirectInvocation = process.argv[1] !== void 0 && path2.resolve(process.argv[1]) === fileURLToPath2(import.meta.url) && path2.basename(process.argv[1]).replace(/\.(js|ts|mjs)$/, "") === "capability-catalog";
if (isDirectInvocation) process.exitCode = main(process.argv.slice(2));
export {
  deriveScripts,
  isExcludedDirRelPath
};
