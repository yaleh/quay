#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-CAeSy4/scripts/unencapsulated-state-clue.ts
import fs2 from "node:fs";
import path3 from "node:path";

// .tmp-dist-publish-worktrees/publish-CAeSy4/scripts/gate-script-base.ts
import path from "node:path";
function isDirectEntry(importMeta, argv1, expectedBase) {
  void importMeta;
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  return path.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
}

// packages/quay/src/kernel/regex-escape.ts
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// .tmp-dist-publish-worktrees/publish-CAeSy4/scripts/routine-engine-module-loader.ts
import fs from "node:fs";
import path2 from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
var SCRIPT_REPO_ROOT = path2.resolve(path2.dirname(fileURLToPath(import.meta.url)), "..", "..");
function resolveEngineModuleIn(root, file, dirRel) {
  const tried = [
    path2.join(SCRIPT_REPO_ROOT, dirRel, file),
    path2.join(root, dirRel, file)
  ];
  for (const candidate of tried) {
    if (fs.existsSync(candidate)) return { path: candidate, tried };
  }
  return { path: null, tried };
}
async function importEngineModuleAt(absPath, cache) {
  const cached = cache.get(absPath);
  if (cached !== void 0) return cached;
  const mod = await import(
    /* @vite-ignore */
    pathToFileURL(absPath).href
  );
  cache.set(absPath, mod);
  return mod;
}

// .tmp-dist-publish-worktrees/publish-CAeSy4/scripts/unencapsulated-state-clue.ts
var EXIT_OK = 0;
var EXIT_USAGE = 2;
var EXIT_INSTRUMENT = 3;
var CLUE_KIND = "unencapsulated-state";
var DEFAULT_SCAN_DIRS = ["packages/quay/src", "plugin/scripts"];
var SKIP_DIR_NAMES = /* @__PURE__ */ new Set(["node_modules", ".git", "dist", "dist-sea", "worktrees"]);
var DEFAULT_SKIP_PREFIXES = ["plugin/test/", "plugin/fixtures/"];
var SOURCE_EXTENSIONS = /* @__PURE__ */ new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"]);
var CONTRACT_DIR_REL = "docs/analysis";
var CONTRACT_FILE = "semantic-admission-contract.mjs";
var contractCache = /* @__PURE__ */ new Map();
async function loadContract(root) {
  const r = resolveEngineModuleIn(root, CONTRACT_FILE, CONTRACT_DIR_REL);
  if (r.path === null) {
    throw new Error(
      `CAUSE=semantic-admission-contract-unresolved \u2014 the clue vocabulary lives in ${CONTRACT_FILE} and could not be found; tried ${r.tried.join(" , ")}`
    );
  }
  return importEngineModuleAt(r.path, contractCache);
}
function stripCommentsAndLiterals(src) {
  const blank = (s) => s.replace(/[^\n]/g, " ");
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = i + 1 < n ? src[i + 1] : "";
    if (c === "/" && next === "/") {
      while (i < n && src[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && next === "*") {
      const start = i;
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i += 1;
      i = Math.min(n, i + 2);
      out += blank(src.slice(start, i));
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      const start = i;
      i += 1;
      while (i < n) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === quote) {
          i += 1;
          break;
        }
        if (quote !== "`" && src[i] === "\n") {
          break;
        }
        i += 1;
      }
      const literal = src.slice(start, Math.min(i, n));
      const head = literal[0] ?? "";
      const tail = literal.length > 1 ? literal[literal.length - 1] : "";
      const inner = literal.slice(1, Math.max(1, literal.length - 1));
      out += head + blank(inner) + (literal.length > 1 ? tail : "");
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}
var COLLECTION_NEW_RE = /\bnew\s+(?:Map|Set|WeakMap|WeakSet)\s*(?:<[^<>()]*>)?\s*\(/g;
var MODULE_LET_RE = /^(?:export\s+)?(let|var)\s+([A-Za-z_$][\w$]*)/;
var MUTATION_CALL_RE = /\.(?:set|add|delete|clear)\s*\(/g;
function analyzeSource(raw) {
  const src = stripCommentsAndLiterals(raw);
  const lines = src.split("\n");
  let statefulDeclarations = 0;
  let mutationSites = 0;
  const declarations = [];
  const mutations = [];
  const moduleLetBindings = /* @__PURE__ */ new Set();
  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx];
    const m = MODULE_LET_RE.exec(line);
    if (m) {
      moduleLetBindings.add(m[2]);
      statefulDeclarations += 1;
      declarations.push(`L${idx + 1}: module-level ${m[1]} ${m[2]}`);
    }
    for (const hit of line.matchAll(COLLECTION_NEW_RE)) {
      statefulDeclarations += 1;
      declarations.push(`L${idx + 1}: ${hit[0].trim()} collection`);
    }
    for (const hit of line.matchAll(MUTATION_CALL_RE)) {
      mutationSites += 1;
      mutations.push(`L${idx + 1}: ${hit[0].trim()}`);
    }
  }
  for (const name of moduleLetBindings) {
    const assignRe = new RegExp(
      `(?:^|[^\\w$.#])${escapeRegExp(name)}\\s*(?:\\+\\+|--|\\+=|-=|\\*=|/=|=(?![=>]))`,
      "g"
    );
    for (let idx = 0; idx < lines.length; idx += 1) {
      const line = lines[idx];
      if (MODULE_LET_RE.test(line)) continue;
      const hits = line.match(assignRe);
      if (!hits) continue;
      mutationSites += hits.length;
      mutations.push(`L${idx + 1}: reassignment of ${name}`);
    }
  }
  return { statefulDeclarations, mutationSites, declarations, mutations };
}
function stateOfReading(reading) {
  return reading.statefulDeclarations + reading.mutationSites >= 2 ? "candidate" : "clear";
}
var toPosix = (p) => p.split(path3.sep).join("/");
function collectSourceFiles(rootAbs, targetRel, { defaultMode }) {
  const targetAbs = path3.resolve(rootAbs, targetRel);
  const st = fs2.statSync(targetAbs);
  if (st.isFile()) {
    const rel = toPosix(path3.relative(rootAbs, targetAbs));
    return SOURCE_EXTENSIONS.has(path3.extname(rel)) ? [rel] : [];
  }
  const out = [];
  const walk = (absDir) => {
    for (const entry of fs2.readdirSync(absDir, { withFileTypes: true })) {
      const abs = path3.join(absDir, entry.name);
      const rel = toPosix(path3.relative(rootAbs, abs));
      if (entry.isDirectory()) {
        if (SKIP_DIR_NAMES.has(entry.name)) continue;
        if (defaultMode && DEFAULT_SKIP_PREFIXES.some((p) => `${rel}/`.startsWith(p))) continue;
        walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!SOURCE_EXTENSIONS.has(path3.extname(entry.name))) continue;
      out.push(rel);
    }
  };
  walk(targetAbs);
  return out.sort();
}
async function clueForFile(rootAbs, subject, contract) {
  const abs = path3.resolve(rootAbs, subject);
  let raw;
  try {
    raw = fs2.readFileSync(abs, "utf8");
  } catch (e) {
    return contract.clueRecord({
      kind: CLUE_KIND,
      subject,
      state: contract.CLUE_STATE.NOT_EVALUATED,
      evidence_ref: `${subject}: unreadable (${e?.code ?? e?.message ?? "unknown error"})`
    });
  }
  if (raw.includes("\0")) {
    return contract.clueRecord({
      kind: CLUE_KIND,
      subject,
      state: contract.CLUE_STATE.NOT_EVALUATED,
      evidence_ref: `${subject}: contains NUL bytes (binary, not source text)`
    });
  }
  const reading = analyzeSource(raw);
  return contract.clueRecord({
    kind: CLUE_KIND,
    subject,
    state: stateOfReading(reading),
    proxy_reading: `statefulDeclarations=${reading.statefulDeclarations} mutationSites=${reading.mutationSites}`,
    evidence_ref: subject
  });
}
async function scanRoot({
  root,
  scanDirs = [...DEFAULT_SCAN_DIRS],
  defaultMode = true
}) {
  const rootAbs = path3.resolve(root);
  if (!fs2.existsSync(rootAbs) || !fs2.statSync(rootAbs).isDirectory()) {
    throw new Error(`CAUSE=root-not-a-directory \u2014 ${rootAbs} does not exist or is not a directory`);
  }
  const contract = await loadContract(rootAbs);
  const subjects = [];
  for (const dir of scanDirs) {
    for (const rel of collectSourceFiles(rootAbs, dir, { defaultMode })) {
      if (!subjects.includes(rel)) subjects.push(rel);
    }
  }
  subjects.sort();
  const records = [];
  for (const subject of subjects) records.push(await clueForFile(rootAbs, subject, contract));
  const summary = {};
  for (const state of contract.CLUE_STATES) summary[state] = 0;
  let invalid = 0;
  for (const r of records) {
    if (Object.prototype.hasOwnProperty.call(summary, r.state)) summary[r.state] += 1;
    else invalid += 1;
  }
  summary.confirmed = 0;
  return { root: rootAbs, scan: scanDirs, records, summary, invalid };
}
var USAGE = "unencapsulated-state-clue.ts --root <dir> [--scan <rel> ...] [--json]\n  stage 1 of the two-stage admission pipeline: emits clue records (candidate / clear / not-evaluated),\n  never a verdict. Default scan set: packages/quay/src + plugin/scripts.";
async function main(argv) {
  let root = SCRIPT_REPO_ROOT;
  const scanDirs = [];
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      process.stdout.write(USAGE + "\n");
      return EXIT_OK;
    }
    if (a === "--json") {
      json = true;
      continue;
    }
    if (a === "--root") {
      root = argv[i + 1];
      i += 1;
      if (!root) {
        process.stderr.write("CAUSE=missing-argument \u2014 --root needs a directory\n" + USAGE + "\n");
        return EXIT_USAGE;
      }
      continue;
    }
    if (a === "--scan") {
      const v = argv[i + 1];
      i += 1;
      if (!v) {
        process.stderr.write("CAUSE=missing-argument \u2014 --scan needs a path\n" + USAGE + "\n");
        return EXIT_USAGE;
      }
      scanDirs.push(v);
      continue;
    }
    process.stderr.write(`CAUSE=unknown-argument \u2014 ${a}
` + USAGE + "\n");
    return EXIT_USAGE;
  }
  const explicit = scanDirs.length > 0;
  let result;
  try {
    result = await scanRoot({ root, scanDirs: explicit ? scanDirs : [...DEFAULT_SCAN_DIRS], defaultMode: !explicit });
  } catch (e) {
    process.stderr.write(`${e?.message ?? e}
`);
    return EXIT_USAGE;
  }
  if (json) {
    process.stdout.write(JSON.stringify({ root: result.root, scan: result.scan, records: result.records, summary: result.summary }, null, 2) + "\n");
  } else {
    process.stdout.write(`clue scan: ${result.records.length} file(s) under ${result.scan.join(" + ")}
`);
    for (const state of Object.keys(result.summary)) process.stdout.write(`  ${state}: ${result.summary[state]}
`);
    if (result.invalid > 0) process.stdout.write(`  INVALID (outside CLUE_STATES): ${result.invalid}
`);
    for (const r of result.records.filter((x) => x.state === "candidate").slice(0, 20)) {
      process.stdout.write(`  candidate  ${r.subject}  ${r.proxy_reading ?? ""}
`);
    }
  }
  if (result.invalid > 0) {
    process.stderr.write(
      `CAUSE=instrument-failure \u2014 ${result.invalid} record(s) carry a state outside CLUE_STATES; a clue value the vocabulary does not contain means the reader is broken, so this reading is refused rather than partly reported
`
    );
    return EXIT_INSTRUMENT;
  }
  return EXIT_OK;
}
if (isDirectEntry(import.meta, process.argv[1], "unencapsulated-state-clue")) {
  process.exit(await main(process.argv.slice(2)));
}
export {
  CLUE_KIND,
  DEFAULT_SCAN_DIRS,
  EXIT_INSTRUMENT,
  EXIT_OK,
  EXIT_USAGE,
  analyzeSource,
  clueForFile,
  collectSourceFiles,
  loadContract,
  main,
  scanRoot,
  stateOfReading,
  stripCommentsAndLiterals
};
