import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-3UCaVR/scripts/suite-bucket-select.ts
import fs4 from "node:fs";

// .tmp-dist-publish-worktrees/publish-3UCaVR/scripts/repo-root.ts
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

// .tmp-dist-publish-worktrees/publish-3UCaVR/scripts/suite-bucket-select.ts
import path5 from "node:path";

// .tmp-dist-publish-worktrees/publish-3UCaVR/scripts/gate-script-base.ts
import path2 from "node:path";
function flagValue(argv, name) {
  const idx = argv.indexOf(name);
  return idx === -1 ? void 0 : argv[idx + 1];
}
function normalizeRel(p) {
  const parts = String(p).replace(/\\/g, "/").split("/");
  const out = [];
  for (const seg of parts) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.join("/");
}
function isDirectEntry(importMeta, argv1, expectedBase) {
  void importMeta;
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  return path2.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
}

// .tmp-dist-publish-worktrees/publish-3UCaVR/scripts/suite-bucket-attribution.ts
import fs2 from "node:fs";
import path3 from "node:path";

// packages/quay/src/kernel/canonical-buckets.ts
var BUCKET_ORDER = ["P", "S", "M"];
function canonicalBuckets(buckets) {
  if (buckets.size === 0) return "UNRESOLVED";
  return BUCKET_ORDER.filter((b) => buckets.has(b)).join("+");
}

// .tmp-dist-publish-worktrees/publish-3UCaVR/scripts/suite-bucket-attribution.ts
var M_PREFIX = /plugin\/scripts(?=\/|["'`\s]|$)/;
var P_PREFIX = /packages\/[^/]+\/(?:src|bin|dist)\//;
var S_PREFIX = /scripts\/test\.sh/;
var P_TEST_DIR = /^packages\/[^/]+\/test\//;
function classifyPath(s) {
  if (M_PREFIX.test(s)) return "M";
  if (P_PREFIX.test(s)) return "P";
  if (S_PREFIX.test(s)) return "S";
  return null;
}
function resolveRelative(fileRel, spec) {
  const dir = path3.posix.dirname(normalizeRel(fileRel));
  const joined = dir === "." ? spec : `${dir}/${spec}`;
  return normalizeRel(joined);
}
function extractRelativeSpecifiers(text) {
  const out = [];
  for (const m of text.matchAll(/["'`](\.\.?\/[^"'`\n]*?)["'`]/g)) {
    const spec = m[1];
    if (spec.includes("${")) continue;
    out.push(spec);
  }
  return out;
}
var JOIN_CALL = /(?<![.\w])(?:path\.)?(?:join|resolve)\s*\(/g;
function skipStringLiteral(text, i) {
  const quote = text[i];
  let j = i + 1;
  while (j < text.length) {
    if (text[j] === "\\") {
      j += 2;
      continue;
    }
    if (text[j] === quote) return j + 1;
    j++;
  }
  return j;
}
function parseArgList(text, openIdx) {
  let depth = 0;
  const args = [];
  let start = openIdx + 1;
  let i = openIdx;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipStringLiteral(text, i);
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      i++;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (ch === ")" && depth === 0) {
        const arg = text.slice(start, i).trim();
        if (arg) args.push(arg);
        return args;
      }
      i++;
      continue;
    }
    if (ch === "," && depth === 1) {
      const arg = text.slice(start, i).trim();
      if (arg) args.push(arg);
      start = i + 1;
      i++;
      continue;
    }
    i++;
  }
  return null;
}
function staticLiteralValue(arg) {
  const q = /^(["'])((?:[^\\"']|\\.)*)\1$/.exec(arg);
  if (q) return q[2];
  const t = /^`([\s\S]*)`$/.exec(arg);
  if (t && !t[1].includes("${")) return t[1];
  return null;
}
function extractJoinedPathSegments(text) {
  const out = [];
  for (const m of text.matchAll(JOIN_CALL)) {
    const openIdx = m.index + m[0].length - 1;
    const args = parseArgList(text, openIdx);
    if (!args) continue;
    let run = [];
    const flush = () => {
      if (run.length >= 2) out.push(run.join("/"));
      run = [];
    };
    for (const arg of args) {
      const lit = staticLiteralValue(arg);
      if (lit === null) flush();
      else run.push(lit);
    }
    flush();
  }
  return out;
}
function extractPathJoinSpecifiers(text) {
  const out = [];
  for (const m of text.matchAll(/path\.join\(([^)]*)\)/g)) {
    const frags = [...m[1].matchAll(/["'`]([^"'`${}]+)["'`]/g)].map((x) => x[1]);
    if (frags.length >= 2) out.push(frags.join("/"));
  }
  return out;
}
function toRepoRel(fileRef, root) {
  const abs = path3.isAbsolute(fileRef) ? fileRef : path3.join(root, fileRef);
  const rel = path3.relative(root, abs);
  return normalizeRel(rel);
}
function bucketSetOf(fileRef, root = repoRoot()) {
  const fileRel = toRepoRel(fileRef, root);
  const text = fs2.readFileSync(path3.join(root, fileRel), "utf8");
  const buckets = /* @__PURE__ */ new Set();
  if (P_TEST_DIR.test(fileRel)) buckets.add("P");
  for (const spec of extractRelativeSpecifiers(text)) {
    const b = classifyPath(resolveRelative(fileRel, spec));
    if (b) buckets.add(b);
  }
  for (const spec of extractPathJoinSpecifiers(text)) {
    const candidate = spec.startsWith("./") || spec.startsWith("../") ? resolveRelative(fileRel, spec) : spec;
    const b = classifyPath(candidate);
    if (b) buckets.add(b);
  }
  const subjectText = text.replace(
    /^[ \t]*\/\/[ \t]*Run:[^\n]*(?:\n[ \t]*\/\/[ \t]+(?:scripts\/|node |bash |npx |npm )[^\n]*)*/gm,
    ""
  );
  for (const m of subjectText.matchAll(/plugin\/scripts(?=\/|["'`\s]|$)|packages\/[^/]+\/(?:src|bin|dist)\/|scripts\/test\.sh/g)) {
    const b = classifyPath(m[0]);
    if (b) buckets.add(b);
  }
  for (const joined of extractJoinedPathSegments(text)) {
    if (joined.startsWith(".")) continue;
    const b = classifyPath(joined);
    if (b) buckets.add(b);
  }
  return buckets;
}
var usage = `suite-bucket-attribution.ts \u2014 bucket-level test attribution (gap-ac120)

Usage:
  node --experimental-strip-types suite-bucket-attribution.ts <test-file> [--root <dir>] [--json]

Output: P | S | M | P+S | P+M | S+M | P+S+M | UNRESOLVED`;
function main(argv) {
  const args = argv.slice(2);
  const fileRef = args[0];
  const rootArg = flagValue(args, "--root");
  const asJson = args.includes("--json");
  if (!fileRef) {
    process.stderr.write(`${usage}
`);
    return 2;
  }
  const root = path3.resolve(rootArg ?? repoRoot());
  const abs = path3.isAbsolute(fileRef) ? fileRef : path3.join(root, fileRef);
  if (!fs2.existsSync(abs)) {
    process.stderr.write(`suite-bucket-attribution: file not found: ${abs}
`);
    return 2;
  }
  const buckets = bucketSetOf(fileRef, root);
  const canonical = canonicalBuckets(buckets);
  if (asJson) {
    process.stdout.write(JSON.stringify({ file: toRepoRel(fileRef, root), buckets: [...buckets], canonical }, null, 2) + "\n");
  } else {
    process.stdout.write(`${canonical}
`);
  }
  return 0;
}
if (isDirectEntry(import.meta, void 0, "suite-bucket-attribution")) {
  process.exitCode = main(process.argv);
}

// .tmp-dist-publish-worktrees/publish-3UCaVR/scripts/suite-bucket-hub-list.ts
import fs3 from "node:fs";
import path4 from "node:path";

// packages/quay/src/kernel/touches-annotation.ts
function stripTrailingFullWidthAnnotation(s) {
  const t = s.trimEnd();
  const i = t.length - 1;
  if (t[i] !== "\uFF09") return s;
  let depth = 0;
  let open = -1;
  for (let j = i; j >= 0; j--) {
    const c = t[j];
    if (c === "\uFF09") depth++;
    else if (c === "\uFF08" && --depth === 0) {
      open = j;
      break;
    }
  }
  if (open === -1) return s;
  let k = open;
  while (k > 0 && /\s/.test(t[k - 1])) k--;
  return t.slice(0, k);
}
var TOUCH_PATH_TOKEN_RE = /^[^\s`'"()（）]+/;
var TOUCH_CONCRETE_PATH_RE = /\/|\.[A-Za-z0-9]{1,10}$/;
var TOUCH_ANNOTATION_HEAD_RE = /^[`'"（(]/;
function stripTouchAnnotation(entry) {
  const raw = String(entry);
  const t = raw.trim();
  const m = TOUCH_PATH_TOKEN_RE.exec(t);
  if (m && TOUCH_CONCRETE_PATH_RE.test(m[0])) {
    const tail = t.slice(m[0].length).replace(/^\s+/, "");
    if (tail && TOUCH_ANNOTATION_HEAD_RE.test(tail)) return m[0];
  }
  let s = raw.trimEnd();
  for (; ; ) {
    const before = s;
    s = stripTrailingFullWidthAnnotation(s);
    s = s.replace(/\s*\([^)]*\)\s*$/, "").trimEnd();
    if (s === before) break;
  }
  return s.trim();
}

// .tmp-dist-publish-worktrees/publish-3UCaVR/scripts/touches-parser.ts
function parseTouchEntries(touchesSection) {
  if (!touchesSection) return [];
  return touchesSection.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[-*]\s+/.test(l)).map((l) => l.replace(/^[-*]\s+/, "").trim()).map((l) => l.replace(/^[`"'']+|[`"'']+$/g, "").trim()).map(stripTouchAnnotation).map((l) => l.replace(/^[`"'']+|[`"'']+$/g, "").trim()).map((l) => l.replace(/^\.\//, "").trim()).filter(Boolean);
}
function extractTouchesSection(fullText) {
  const lines = String(fullText).split(/\r?\n/);
  const candidates = [];
  for (let i = 0; i < lines.length; i++) {
    const heading = lines[i].trimEnd().match(/^(#{1,6})\s+(.*)$/);
    if (!heading) continue;
    const text = heading[2].trim();
    if (/^touches\b/i.test(text)) candidates.push({ line: i, level: heading[1].length, text });
  }
  if (candidates.length === 0) {
    return { hasSection: false, section: "", heading: null, startLine: null, level: null };
  }
  const exact = candidates.filter((c) => c.text.toLowerCase() === "touches");
  const chosen = exact.length ? exact[0] : candidates.slice().sort((a, b) => a.level - b.level || a.line - b.line)[0];
  const out = [];
  for (let i = chosen.line + 1; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    if (/^#{1,6}\s+/.test(line)) break;
    out.push(line);
  }
  return {
    hasSection: true,
    section: out.join("\n"),
    heading: chosen.text,
    startLine: chosen.line + 1,
    level: chosen.level
  };
}
if (isDirectEntry(import.meta, void 0, "touches-parser")) {
  process.stdout.write("Usage: touches-parser.ts is a shared module, not a CLI \u2014 import { parseTouchEntries, extractTouchesSection, stripTouchAnnotation } from it.\n");
}

// packages/quay/src/kernel/regex-escape.ts
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// .tmp-dist-publish-worktrees/publish-3UCaVR/scripts/suite-bucket-hub-list.ts
var HUB_FILES = [
  "scripts/test.sh",
  "plugin/scripts/full-suite-runner.ts",
  "plugin/scripts/runner-grouping*",
  "plugin/scripts/select-tests-for-touches.ts",
  // gap-ac128-hub-split-harness-concerns — the harness-critical families extracted out of the two
  // monoliths. Each is STILL a hub: their change must force the full suite unconditionally (red parsing
  // / concurrency / static-gate / tree-state / state-write are all harness-critical, never bucket-safe).
  "plugin/scripts/runner-red-parse.ts",
  "plugin/scripts/runner-concurrency.ts",
  "plugin/scripts/runner-static-gate.ts",
  "plugin/scripts/runner-tree-state.ts",
  "plugin/scripts/runner-state-write.ts"
];
function hubEntryToRegExp(entry) {
  const escaped = String(entry).split("*").map((seg) => escapeRegExp(seg)).join(".*");
  return new RegExp(`^${escaped}$`);
}
var HUB_PATTERNS = HUB_FILES.map(hubEntryToRegExp);
function normalizeTouched(p) {
  return String(p).replace(/\\/g, "/").replace(/^\.\//, "").trim();
}
function isHubFile(relPath) {
  const p = normalizeTouched(relPath);
  if (!p) return false;
  return HUB_PATTERNS.some((re) => re.test(p));
}
function hubDecision(touchedPaths) {
  const hubMatches = (touchedPaths ?? []).filter(isHubFile);
  return { fullSuite: hubMatches.length > 0, hubMatches };
}
var usage2 = `suite-bucket-hub-list.ts \u2014 explicit hub-file list + full-suite fallback (gap-ac122)

Usage:
  node --experimental-strip-types suite-bucket-hub-list.ts --task <task-id> [--root <dir>] [--json]
  node --experimental-strip-types suite-bucket-hub-list.ts <path>... [--json]

Output: full (unconditional full suite) | bucket (proceed to fan-out \u2014 a later concern)`;
function taskTouchEntries(taskId, root) {
  const file = path4.join(root, "tasks", `${taskId}.md`);
  if (!fs3.existsSync(file)) return [];
  const text = fs3.readFileSync(file, "utf8");
  return parseTouchEntries(extractTouchesSection(text).section);
}
function main2(argv) {
  const args = argv.slice(2);
  const asJson = args.includes("--json");
  const rootArg = flagValue(args, "--root");
  const root = path4.resolve(rootArg ?? repoRoot());
  const positional = args.filter((a) => !a.startsWith("--") && !["--root", "--task", "--json"].includes(a));
  let touched = [];
  let label = "paths";
  const taskId = flagValue(args, "--task");
  if (taskId) {
    touched = taskTouchEntries(taskId, root);
    label = `task ${taskId}`;
    if (touched.length === 0) {
      process.stderr.write(`suite-bucket-hub-list: no ## Touches for task ${taskId} (or file absent)
`);
      return 2;
    }
  } else if (positional.length === 0) {
    process.stderr.write(`${usage2}
`);
    return 2;
  } else {
    touched = positional.map(normalizeTouched).filter(Boolean);
  }
  const d = hubDecision(touched);
  if (asJson) {
    process.stdout.write(JSON.stringify({ input: label, fullSuite: d.fullSuite, hubMatches: d.hubMatches }, null, 2) + "\n");
  } else {
    process.stdout.write(`${d.fullSuite ? "full" : "bucket"}
`);
  }
  return 0;
}
if (isDirectEntry(import.meta, void 0, "suite-bucket-hub-list")) {
  process.exitCode = main2(process.argv);
}

// .tmp-dist-publish-worktrees/publish-3UCaVR/scripts/suite-bucket-select.ts
var REATTRIBUTION_PATH = ".quay/suite-bucket-reattribution.jsonl";
var EFFECTIVE_PATH = ".quay/suite-bucket-effective.jsonl";
var SUITE_GLOBS = [
  "packages/*/test/*.test.mjs",
  "plugin/test/*.test.mjs",
  "experiments/quay-perpetual-stream/test/*.test.mjs"
];
var EXP_SCRIPTS_PREFIX = "experiments/quay-perpetual-stream/scripts/";
var PLUGIN_SCRIPTS_PREFIX = "plugin/scripts/";
function normalizeTouched2(p) {
  return String(p).replace(/\\/g, "/").replace(/^\.\//, "").trim();
}
var TEST_FILE_SUFFIXES = [".test.mjs", ".test.ts"];
function isTestFile(p) {
  return TEST_FILE_SUFFIXES.some((s) => p.endsWith(s));
}
function listSuiteFiles(root) {
  const seen = /* @__PURE__ */ new Map();
  const expand = (glob) => {
    const segs = glob.split("/");
    let cur = [root];
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      const next = [];
      for (const dir of cur) {
        if (seg.includes("*")) {
          let entries;
          try {
            entries = fs4.readdirSync(dir, { withFileTypes: true });
          } catch {
            continue;
          }
          const re = new RegExp(`^${seg.replace(/\*/g, ".*")}$`);
          for (const e of entries) {
            if (re.test(e.name)) next.push(path5.join(dir, e.name));
          }
        } else {
          next.push(path5.join(dir, seg));
        }
      }
      cur = next;
    }
    return cur.filter((p) => {
      try {
        return fs4.statSync(p).isFile();
      } catch {
        return false;
      }
    });
  };
  for (const glob of SUITE_GLOBS) {
    for (const abs of expand(glob)) {
      let rp;
      try {
        rp = fs4.realpathSync(abs);
      } catch {
        rp = abs;
      }
      if (!seen.has(rp)) seen.set(rp, path5.relative(root, rp));
    }
  }
  return [...seen.values()].sort();
}
function loadReattribution(root) {
  const map = /* @__PURE__ */ new Map();
  const file = path5.join(root, REATTRIBUTION_PATH);
  let text;
  try {
    text = fs4.readFileSync(file, "utf8");
  } catch {
    return map;
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const d = JSON.parse(line);
      if (typeof d.file === "string" && typeof d.judgment === "string") map.set(d.file, d.judgment);
    } catch {
    }
  }
  return map;
}
function mirrorFold(rel) {
  return rel.startsWith(EXP_SCRIPTS_PREFIX) ? PLUGIN_SCRIPTS_PREFIX + rel.slice(EXP_SCRIPTS_PREFIX.length) : rel;
}
function effectiveBucketAttribution(fileRel, reattr, root) {
  const j = reattr.get(fileRel);
  if (j === "S" || j === "M" || j === "P") return { buckets: /* @__PURE__ */ new Set([j]), source: "reattr" };
  const raw = bucketSetOf(fileRel, root);
  if (raw.size > 0) return { buckets: raw, source: "static" };
  const text = fs4.readFileSync(path5.join(root, fileRel), "utf8");
  const out = /* @__PURE__ */ new Set();
  for (const spec of extractRelativeSpecifiers(text)) {
    const b = classifyPath(mirrorFold(resolveRelative(fileRel, spec)));
    if (b) out.add(b);
  }
  for (const m of text.matchAll(/experiments\/quay-perpetual-stream\/scripts\//g)) out.add("M");
  return { buckets: out, source: out.size > 0 ? "mirror-fold" : "unresolved" };
}
function effectiveBucketSet(fileRel, reattr, root) {
  return effectiveBucketAttribution(fileRel, reattr, root).buckets;
}
function triggeredBuckets(touchedPaths) {
  const out = /* @__PURE__ */ new Set();
  for (const raw of touchedPaths ?? []) {
    let p = normalizeTouched2(raw);
    if (!p) continue;
    if (p.startsWith(EXP_SCRIPTS_PREFIX)) p = PLUGIN_SCRIPTS_PREFIX + p.slice(EXP_SCRIPTS_PREFIX.length);
    const b = classifyPath(p);
    if (b) out.add(b);
  }
  return out;
}
function computeEffectiveAttribution(files, reattr, root) {
  const map = /* @__PURE__ */ new Map();
  for (const f of files) map.set(f, effectiveBucketAttribution(f, reattr, root));
  return map;
}
function writeBucketAttribution(root, attribution) {
  const lines = [];
  for (const [file, { buckets, source }] of attribution) {
    const ordered = BUCKET_ORDER.filter((b) => buckets.has(b));
    lines.push(JSON.stringify({ file, buckets: ordered, source }));
  }
  try {
    fs4.writeFileSync(path5.join(root, EFFECTIVE_PATH), lines.join("\n") + "\n", "utf8");
  } catch {
  }
}
function selectBucketsForTouches(touchedPaths, root = repoRoot()) {
  const files = listSuiteFiles(root);
  const reattr = loadReattribution(root);
  const hub = hubDecision(touchedPaths ?? []);
  const triggered = triggeredBuckets(touchedPaths ?? []);
  const attribution = computeEffectiveAttribution(files, reattr, root);
  writeBucketAttribution(root, attribution);
  if (hub.fullSuite || triggered.size === 0) {
    return {
      fullSuite: true,
      buckets: "full",
      selectedFiles: files,
      fileCount: files.length,
      hubMatches: hub.hubMatches,
      triggered: [...triggered].sort()
    };
  }
  const selected = /* @__PURE__ */ new Set();
  for (const f of files) {
    const eff = attribution.get(f)?.buckets ?? /* @__PURE__ */ new Set();
    if (eff.size === 0) {
      selected.add(f);
      continue;
    }
    for (const b of eff) {
      if (triggered.has(b)) {
        selected.add(f);
        break;
      }
    }
  }
  const suiteFiles = new Set(files);
  for (const raw of touchedPaths ?? []) {
    const p = normalizeTouched2(raw);
    if (isTestFile(p) && suiteFiles.has(p)) selected.add(p);
  }
  return {
    fullSuite: false,
    buckets: canonicalBuckets(triggered),
    selectedFiles: [...selected].sort(),
    fileCount: selected.size,
    hubMatches: hub.hubMatches,
    triggered: [...triggered].sort()
  };
}
function selectBucketsForTask(taskId, root = repoRoot()) {
  return selectBucketsForTouches(taskTouchEntries(taskId, root), root);
}
var usage3 = `suite-bucket-select.ts \u2014 bucket-level test selection (gap-ac124)

Usage:
  node --experimental-strip-types suite-bucket-select.ts --task <task-id> [--root <dir>] [--json|--paths-only|--summary]
  node --experimental-strip-types suite-bucket-select.ts <path>... [--root <dir>] [--json|--paths-only|--summary]
  node --experimental-strip-types suite-bucket-select.ts --write-effective [--root <dir>]

Output modes:
  (default)      human-readable summary
  --json         { fullSuite, buckets, selectedFiles, fileCount, hubMatches, triggered }
  --paths-only   the selected test files, one per line (the FULL list when fullSuite)
  --summary      one machine line: full=0|1 buckets=<csv> files=<n>
  --write-effective  write .quay/suite-bucket-effective.jsonl (the single-truth-source artifact the
                     page reads) and exit \u2014 the standalone bootstrap for the dispatch-side write`;
function main3(argv) {
  const args = argv.slice(2);
  const rootArg = flagValue(args, "--root");
  const root = path5.resolve(rootArg ?? repoRoot());
  const taskId = flagValue(args, "--task");
  const asJson = args.includes("--json");
  const pathsOnly = args.includes("--paths-only");
  const summary = args.includes("--summary");
  const writeEffective = args.includes("--write-effective");
  const positional = args.filter((a) => !a.startsWith("--") && !["--root", "--task"].includes(a));
  if (writeEffective) {
    const files = listSuiteFiles(root);
    const reattr = loadReattribution(root);
    const attribution = computeEffectiveAttribution(files, reattr, root);
    writeBucketAttribution(root, attribution);
    process.stdout.write(`wrote ${attribution.size} effective bucket attributions to ${path5.join(root, EFFECTIVE_PATH)}
`);
    return 0;
  }
  let sel;
  if (taskId) {
    sel = selectBucketsForTask(taskId, root);
  } else if (positional.length === 0) {
    process.stderr.write(`${usage3}
`);
    return 2;
  } else {
    sel = selectBucketsForTouches(positional.map(normalizeTouched2).filter(Boolean), root);
  }
  if (asJson) {
    process.stdout.write(JSON.stringify(sel, null, 2) + "\n");
  } else if (pathsOnly) {
    for (const f of sel.selectedFiles) process.stdout.write(`${f}
`);
  } else if (summary) {
    process.stdout.write(`full=${sel.fullSuite ? 1 : 0} buckets=${sel.buckets} files=${sel.fileCount}
`);
  } else {
    process.stdout.write(
      `buckets=${sel.buckets} full=${sel.fullSuite ? "yes" : "no"} files=${sel.fileCount}` + (sel.hubMatches.length > 0 ? ` hub=${sel.hubMatches.join(",")}` : "") + (sel.triggered.length > 0 ? ` triggered=${sel.triggered.join("+")}` : "") + "\n"
    );
  }
  return 0;
}
if (isDirectEntry(import.meta, void 0, "suite-bucket-select")) {
  process.exitCode = main3(process.argv);
}
export {
  computeEffectiveAttribution,
  effectiveBucketAttribution,
  effectiveBucketSet,
  listSuiteFiles,
  loadReattribution,
  main3 as main,
  mirrorFold,
  selectBucketsForTask,
  selectBucketsForTouches,
  triggeredBuckets,
  writeBucketAttribution
};
