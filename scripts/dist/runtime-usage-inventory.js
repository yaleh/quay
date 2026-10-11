import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/runtime-usage-inventory.ts
import fs2 from "node:fs";
import os from "node:os";
import path2 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/source-text-lib.ts
function stripComments(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    if (src[i] === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (src[i] === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
    } else {
      out += src[i];
      i++;
    }
  }
  return out;
}

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

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/runtime-usage-inventory.ts
var DEFAULT_SINCE = "2026-08-02T11:00:00Z";
var DEFAULT_LONG_HOURS = 72;
var SCRIPT_ROOTS = ["plugin/scripts", "experiments", ".claude/workflows", "scripts"];
var SKIP_DIR_NAMES = /* @__PURE__ */ new Set([".git", "node_modules", "worktrees", ".quay", "dist", "vendor"]);
var TEST_GLOB_PATTERNS = [
  "packages/*/test/*.test.mjs",
  "plugin/test/*.test.mjs",
  "experiments/quay-perpetual-stream/test/*.test.mjs"
];
function isScriptFile(basename) {
  return /\.(ts|mts|cts|js|mjs|cjs|sh|bash|zsh|py|rb|pl)$/.test(basename);
}
var DORMANT_BY_DECISION = [
  // chart2 family (exp6 §0)
  "experiments/quay-perpetual-stream/scripts/chart2-s1-distribution-reliability.ts",
  "experiments/quay-perpetual-stream/scripts/chart2-s2-delivery-completeness.ts",
  "experiments/quay-perpetual-stream/scripts/chart2-s3-external-validation.ts",
  // git-lens family (exp6 §0)
  "experiments/quay-perpetual-stream/scripts/git-lens-l-d-code-doc-ratio.ts",
  "experiments/quay-perpetual-stream/scripts/git-lens-l-g-structural-drift.ts",
  "experiments/quay-perpetual-stream/scripts/git-lens-l-s-behavior-variance.ts",
  "experiments/quay-perpetual-stream/scripts/git-lens-selfcheck.sh",
  // governance-product-ratio family (task body + exp6 §0 governance group)
  "experiments/quay-perpetual-stream/scripts/governance-product-ratio-check.ts",
  "experiments/quay-perpetual-stream/scripts/governance-product-ratio-selfcheck.sh",
  // VT family (exp6 §0)
  "experiments/quay-perpetual-stream/scripts/outward-vt-check.ts",
  "experiments/quay-perpetual-stream/scripts/outward-vt-selfcheck.sh",
  // portfolio family (exp6 §0) — BOTH copies are real byte-identical files (not symlinks), both sealed
  "experiments/quay-perpetual-stream/scripts/portfolio-choice.ts",
  "plugin/scripts/portfolio-choice.ts"
];
var EXECUTORS = /* @__PURE__ */ new Set([
  "node",
  "nodejs",
  "bun",
  "deno",
  "python",
  "python3",
  "pypy",
  "ruby",
  "perl",
  "php",
  "bash",
  "sh",
  "dash",
  "zsh",
  "ksh",
  "fish",
  "ash",
  "tsx",
  "ts-node",
  "source"
]);
var WRAPPERS = /* @__PURE__ */ new Set([
  "env",
  "timeout",
  "sudo",
  "command",
  "exec",
  "nice",
  "nohup",
  "setsid",
  "stdbuf"
]);
var INLINE_CODE_FLAGS = {
  node: /* @__PURE__ */ new Set(["-e", "--eval", "-p", "--print", "--input-type"]),
  nodejs: /* @__PURE__ */ new Set(["-e", "--eval", "-p", "--print", "--input-type"]),
  bun: /* @__PURE__ */ new Set(["-e", "--eval"]),
  deno: /* @__PURE__ */ new Set(["eval", "-"]),
  python: /* @__PURE__ */ new Set(["-c"]),
  python3: /* @__PURE__ */ new Set(["-c"]),
  bash: /* @__PURE__ */ new Set(["-c", "--command"]),
  sh: /* @__PURE__ */ new Set(["-c"]),
  dash: /* @__PURE__ */ new Set(["-c"]),
  zsh: /* @__PURE__ */ new Set(["-c"])
};
function hasInlineCodeFlag(program, args) {
  const flags = INLINE_CODE_FLAGS[program];
  if (!flags) return false;
  return args.some((a) => flags.has(a));
}
function isUnderArchive(rel) {
  return ("/" + rel + "/").includes("/archive/");
}
function dirContainsSkip(root, fullDir) {
  const rel = path2.relative(root, fullDir).split(path2.sep).join("/");
  if (isUnderArchive(rel)) return true;
  return rel.split("/").some((seg) => SKIP_DIR_NAMES.has(seg));
}
function isFileOrSymlink(full) {
  try {
    const st = fs2.lstatSync(full);
    return st.isFile() || st.isSymbolicLink();
  } catch {
    return false;
  }
}
function findDirsNamed(base, name) {
  const out = [];
  const walk = (dir) => {
    let entries = [];
    try {
      entries = fs2.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path2.join(dir, e.name);
      const rel = path2.relative(base, full).split(path2.sep).join("/");
      if (e.name === name && e.isDirectory()) out.push(full);
      else if (e.isDirectory() && !SKIP_DIR_NAMES.has(e.name) && !isUnderArchive(rel)) walk(full);
    }
  };
  walk(base);
  return out;
}
function categoryOf(relPath) {
  if (relPath.startsWith("plugin/scripts/")) return "plugin-scripts";
  if (relPath.startsWith("experiments/")) return "experiments-scripts";
  if (relPath.startsWith(".claude/workflows/")) return "workflows";
  if (relPath.startsWith("scripts/")) return "scripts";
  return "scripts";
}
function enumerateScripts(root) {
  const byReal = /* @__PURE__ */ new Map();
  let rawEntries = 0;
  const add = (full) => {
    rawEntries++;
    const rel = path2.relative(root, full).split(path2.sep).join("/");
    let realRel;
    try {
      realRel = path2.relative(root, fs2.realpathSync(full)).split(path2.sep).join("/");
    } catch {
      realRel = rel;
    }
    let entry = byReal.get(realRel);
    if (entry) {
      entry.aliases.push(rel);
      return;
    }
    const isSymlink = (() => {
      try {
        return fs2.lstatSync(full).isSymbolicLink();
      } catch {
        return false;
      }
    })();
    entry = {
      relPath: realRel,
      realPath: realRel,
      basename: path2.basename(realRel),
      category: categoryOf(realRel),
      isSymlink,
      aliases: rel === realRel ? [] : [rel],
      isTestFile: /\.test\.[^/]+$/.test(realRel),
      main: { executed: 0, importedBy: [], importedCount: 0, ciInvoked: 0, inTestGlob: false, note: "" },
      long: { executed: 0, importedBy: [], importedCount: 0, ciInvoked: 0, inTestGlob: false, note: "" },
      class: "unaccounted"
    };
    byReal.set(realRel, entry);
  };
  for (const rootDir of SCRIPT_ROOTS) {
    if (rootDir === "experiments") {
      const dirs = findDirsNamed(path2.join(root, "experiments"), "scripts");
      for (const d of dirs) {
        if (dirContainsSkip(root, d)) continue;
        let names = [];
        try {
          names = fs2.readdirSync(d);
        } catch {
          continue;
        }
        for (const n of names) {
          const full = path2.join(d, n);
          if (isFileOrSymlink(full)) add(full);
        }
      }
    } else {
      const dir = path2.join(root, rootDir);
      if (!fs2.existsSync(dir)) continue;
      let names = [];
      try {
        names = fs2.readdirSync(dir);
      } catch {
        continue;
      }
      for (const n of names) {
        const full = path2.join(dir, n);
        if (isFileOrSymlink(full)) add(full);
      }
    }
  }
  const scripts = [...byReal.values()].sort((a, b) => a.relPath.localeCompare(b.relPath));
  return { scripts, rawEntries };
}
function stripQuotedContent(s) {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      i++;
      while (i < s.length) {
        if (s[i] === "\\") {
          i += 2;
          continue;
        }
        if (s[i] === ch) {
          i++;
          break;
        }
        i++;
      }
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}
function splitCommandSegments(cleaned) {
  const segments = [];
  const tokens = cleaned.split(/(?:;|&&|\|\||\||\(|\)|\n)/);
  for (const tok of tokens) {
    const argv = tok.trim().split(/\s+/).filter(Boolean);
    if (argv.length) segments.push(argv);
  }
  return segments;
}
function unwrapWrapper(argv) {
  let i = 0;
  while (i < argv.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[i])) i++;
  let prog = argv[i] ?? "";
  let rest = argv.slice(i + 1);
  if (!WRAPPERS.has(prog)) return { program: prog, args: rest };
  let j = 0;
  while (j < rest.length) {
    const t = rest[j];
    if (t.startsWith("-")) {
      j++;
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) {
      j++;
      continue;
    }
    if (/^\d+(\.\d+)?$/.test(t)) {
      j++;
      continue;
    }
    break;
  }
  return { program: rest[j] ?? "", args: rest.slice(j + 1) };
}
function tokenMatchesScript(token, script) {
  if (!token) return false;
  let norm = token;
  if (norm.startsWith("./")) norm = norm.slice(2);
  const candidates = [script.relPath, script.realPath, ...script.aliases].filter(Boolean);
  for (const c of candidates) {
    if (norm === c) return true;
    if (norm.length > c.length && norm.endsWith(c) && norm[norm.length - c.length - 1] === "/") return true;
  }
  return false;
}
function countExecutedInCommand(command, script, paths) {
  if (!paths.some((p) => command.includes(p))) return 0;
  const cleaned = stripQuotedContent(command);
  const segments = splitCommandSegments(cleaned);
  let n = 0;
  for (const argv of segments) {
    const { program, args } = unwrapWrapper(argv);
    if (program && tokenMatchesScript(program, script)) {
      n++;
      continue;
    }
    if (EXECUTORS.has(program) || /(^|\/)(node|nodejs|bash|sh|deno|bun|python3?|tsx)$/.test(program)) {
      if (hasInlineCodeFlag(program, args)) continue;
      for (const a of args) {
        if (tokenMatchesScript(a, script)) n++;
      }
    }
  }
  return n;
}
function countWorkflowExecutions(script, invocations) {
  if (script.category !== "workflows") return 0;
  const stem = script.basename.replace(/\.js$/, "");
  let n = 0;
  for (const inv of invocations) {
    const sp = inv.scriptPath || "";
    const base = path2.basename(sp).replace(/\.js$/, "");
    if (sp.endsWith(script.relPath) || base === stem || base.startsWith(stem + "-wf_")) {
      n++;
      continue;
    }
    const nm = (inv.name || "").replace(/^quay:/, "").replace(/\.js$/, "");
    if (nm === stem) n++;
  }
  return n;
}
var SUBAGENT_WORKFLOW_LAYER = "subagents/workflows";
function collectDirectJsonlFiles(dir, out) {
  let entries;
  try {
    entries = fs2.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if ((e.isFile() || e.isSymbolicLink()) && e.name.endsWith(".jsonl")) {
      out.push(path2.join(dir, e.name));
    }
  }
}
function collectJsonlFiles(dir, out) {
  let entries;
  try {
    entries = fs2.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      collectJsonlFiles(path2.join(dir, e.name), out);
    } else if ((e.isFile() || e.isSymbolicLink()) && e.name.endsWith(".jsonl")) {
      out.push(path2.join(dir, e.name));
    }
  }
}
function readTranscripts(sessionsDir, since, until, includeSessions = /* @__PURE__ */ new Set(), excludeTopLevelSessions = /* @__PURE__ */ new Set()) {
  const commands = [];
  const workflowInvocations = [];
  const files = [];
  if (!fs2.existsSync(sessionsDir)) return { commands, workflowInvocations, files, commandCount: 0 };
  const topLevel = fs2.readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
  const jsonlFiles = [];
  for (const f of topLevel) {
    const id = f.replace(/\.jsonl$/, "");
    if (excludeTopLevelSessions.has(id)) continue;
    if (includeSessions.size > 0 && !includeSessions.has(id)) continue;
    jsonlFiles.push(path2.join(sessionsDir, f));
  }
  for (const d of fs2.readdirSync(sessionsDir)) {
    if (includeSessions.size > 0 && !includeSessions.has(d)) continue;
    const sub = path2.join(sessionsDir, d, "subagents");
    let subStat;
    try {
      subStat = fs2.statSync(sub);
    } catch {
      continue;
    }
    if (!subStat.isDirectory()) continue;
    collectDirectJsonlFiles(sub, jsonlFiles);
    collectJsonlFiles(path2.join(sessionsDir, d, SUBAGENT_WORKFLOW_LAYER), jsonlFiles);
  }
  const sinceMs = Date.parse(since);
  for (const f of jsonlFiles) {
    let inFile = false;
    try {
      if (fs2.statSync(f).mtimeMs < sinceMs) continue;
      const content = fs2.readFileSync(f, "utf8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let rec;
        try {
          rec = JSON.parse(trimmed);
        } catch {
          continue;
        }
        const ts = rec?.timestamp;
        if (!ts || ts < since || ts >= until) continue;
        if (rec?.type !== "assistant") continue;
        const contentBlocks = rec?.message?.content;
        if (!Array.isArray(contentBlocks)) continue;
        for (const blk of contentBlocks) {
          if (blk?.type !== "tool_use") continue;
          if (blk.name === "Bash" && typeof blk?.input?.command === "string") {
            commands.push(blk.input.command);
            inFile = true;
          } else if (blk.name === "Workflow" && blk?.input) {
            const inp = blk.input;
            workflowInvocations.push({
              scriptPath: typeof inp.scriptPath === "string" ? inp.scriptPath : void 0,
              name: typeof inp.name === "string" ? inp.name : void 0
            });
            inFile = true;
          }
        }
      }
    } catch {
      continue;
    }
    if (inFile) files.push(f);
  }
  return { commands, workflowInvocations, files, commandCount: commands.length };
}
var IMPORT_SPEC_RE = /(?:import\s*\(\s*|require\s*\(\s*|from\s*|import\s*)(['"])([^'"]+)\1/g;
function extractModuleSpecifiers(src) {
  const out = [];
  const cleaned = stripComments(src);
  let m;
  IMPORT_SPEC_RE.lastIndex = 0;
  while ((m = IMPORT_SPEC_RE.exec(cleaned)) !== null) {
    out.push(m[2]);
  }
  return out;
}
function walkSourceFiles(root) {
  const out = [];
  const walk = (dir) => {
    let entries = [];
    try {
      entries = fs2.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path2.join(dir, e.name);
      if (e.isDirectory()) {
        const rel = path2.relative(root, full).split(path2.sep).join("/");
        if (!SKIP_DIR_NAMES.has(e.name) && !isUnderArchive(rel)) walk(full);
      } else if (e.isFile() && /\.(ts|mts|cts|js|mjs|cjs)$/.test(e.name)) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out;
}
function parseImports(root, scripts) {
  const result = /* @__PURE__ */ new Map();
  const realSet = new Set(scripts.map((s) => s.realPath));
  const files = walkSourceFiles(root);
  for (const f of files) {
    const relF = path2.relative(root, f).split(path2.sep).join("/");
    if (relF.startsWith("milestones/") && relF.includes("/worktrees/")) continue;
    let content = "";
    try {
      content = fs2.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    const specs = extractModuleSpecifiers(content);
    const dir = path2.dirname(f);
    for (const spec of specs) {
      if (!spec.startsWith(".") && !spec.startsWith("/")) continue;
      const base = spec.startsWith("/") ? path2.join(root, spec.slice(1)) : path2.resolve(dir, spec);
      const candidates = [base, base + ".ts", base + ".tsx", base + ".mts", base + ".js", base + ".mjs", base + ".cjs", base + "/index.ts", base + "/index.js"];
      for (const c of candidates) {
        let real;
        try {
          real = path2.relative(root, fs2.realpathSync(c)).split(path2.sep).join("/");
        } catch {
          continue;
        }
        if (realSet.has(real)) {
          const list = result.get(real) ?? [];
          list.push(relF);
          result.set(real, list);
          break;
        }
      }
    }
  }
  return result;
}
function computeWrapperIndirect(root, scripts, liveRealPaths) {
  const result = /* @__PURE__ */ new Set();
  const byDir = /* @__PURE__ */ new Map();
  for (const s of scripts) {
    const dir = path2.posix.dirname(s.realPath);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(s);
  }
  const liveSh = scripts.filter((s) => liveRealPaths.has(s.realPath) && /\.(sh|bash)$/.test(s.basename));
  for (const sh of liveSh) {
    let content = "";
    try {
      content = fs2.readFileSync(path2.join(root, sh.realPath), "utf8");
    } catch {
      continue;
    }
    const shDir = path2.posix.dirname(sh.realPath);
    for (const line of content.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const firstWord = t.split(/\s+/)[0] ?? "";
      if (firstWord === "echo" || firstWord === "printf" || firstWord === "cat" || firstWord === ">&2") continue;
      const gd = t.match(/gate_delegate_ts\s+["']?([^"'\s]+)/);
      for (const script of byDir.get(shDir) ?? []) {
        if (script.realPath === sh.realPath) continue;
        const base = script.basename;
        if (gd && gd[1] === base) {
          result.add(script.realPath);
          continue;
        }
        if (!t.includes(base)) continue;
        const tMinus = t.split(base).join(" ");
        if (/(\bnode\b|\bbash\b|\bexec\b|\bsource\b|dirname|\$\(|\brun_check\b)/.test(tMinus)) {
          result.add(script.realPath);
        }
      }
      if (t.includes("/scripts/") || t.includes("/workflows/")) {
        for (const script of scripts) {
          if (script.realPath === sh.realPath || result.has(script.realPath)) continue;
          if (!t.includes(script.realPath)) continue;
          const tMinus = t.split(script.basename).join(" ");
          if (/(\bnode\b|\bbash\b|\bexec\b|\bsource\b|dirname|\$\(|\brun_check\b)/.test(tMinus)) {
            result.add(script.realPath);
          }
        }
      }
    }
  }
  return result;
}
function readCiInvocation(root, scripts) {
  const result = /* @__PURE__ */ new Map();
  const ciDir = path2.join(root, ".github", "workflows");
  if (!fs2.existsSync(ciDir)) return result;
  let files = [];
  try {
    files = fs2.readdirSync(ciDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  } catch {
    return result;
  }
  let content = "";
  for (const f of files) {
    try {
      content += fs2.readFileSync(path2.join(ciDir, f), "utf8") + "\n";
    } catch {
      continue;
    }
  }
  content = content.split("\n").map((l) => l.trimStart().startsWith("#") ? "" : l).join("\n");
  for (const s of scripts) {
    let n = 0;
    const paths = [s.relPath, ...s.aliases];
    for (const p of paths) {
      let idx = 0;
      while ((idx = content.indexOf(p, idx)) !== -1) {
        n++;
        idx += p.length;
      }
    }
    result.set(s.realPath, n);
  }
  return result;
}
function globMatch(pattern, relPath) {
  const esc = pattern.split("").map((c) => c === "*" ? "@" : c.replace(/[.+^${}()|[\]\\]/g, "\\$&")).join("").replace(/@/g, "[^/]*");
  return new RegExp("^" + esc + "$").test(relPath);
}
function inTestGlob(relPath) {
  return TEST_GLOB_PATTERNS.some((p) => globMatch(p, relPath));
}
function classifyScript(executed, importedCount, ciInvoked, relPath, isTestFile, inGlob) {
  if (executed > 0) return "live";
  if (importedCount > 0) return "library";
  if (ciInvoked > 0) return "ci-only";
  if (DORMANT_BY_DECISION.includes(relPath)) return "dormant-by-decision";
  if (isTestFile && !inGlob) return "never-runs-test";
  return "unaccounted";
}
function buildInventory(root, sessionsDir, since, until, longHours, opts = {}) {
  const { scripts, rawEntries } = enumerateScripts(root);
  const excludeSessions = opts.excludeSessions ?? /* @__PURE__ */ new Set();
  const innerSessions = opts.innerSessions ?? /* @__PURE__ */ new Set();
  const mainTx = readTranscripts(sessionsDir, since, until, innerSessions, excludeSessions);
  const longSince = new Date(new Date(until).getTime() - longHours * 3600 * 1e3).toISOString();
  const longTx = readTranscripts(sessionsDir, longSince, until, /* @__PURE__ */ new Set(), excludeSessions);
  const imports = parseImports(root, scripts);
  const ci = readCiInvocation(root, scripts);
  for (const s of scripts) {
    const paths = [s.relPath, s.realPath, ...s.aliases].filter(Boolean);
    s.main.executedTranscript = countExecutedFor(s, mainTx, paths);
    s.long.executedTranscript = countExecutedFor(s, longTx, paths);
    s.main.executed = s.main.executedTranscript;
    s.long.executed = s.long.executedTranscript;
  }
  const mainLiveSet = new Set(scripts.filter((s) => s.main.executedTranscript > 0).map((s) => s.realPath));
  const longLiveSet = new Set(scripts.filter((s) => s.long.executedTranscript > 0).map((s) => s.realPath));
  const wrapperMain = computeWrapperIndirect(root, scripts, mainLiveSet);
  const wrapperLong = computeWrapperIndirect(root, scripts, longLiveSet);
  for (const s of scripts) {
    const mainExec = s.main.executedTranscript + (wrapperMain.has(s.realPath) ? 1 : 0);
    const longExec = s.long.executedTranscript + (wrapperLong.has(s.realPath) ? 1 : 0);
    s.main.executed = mainExec;
    s.main.indirectExec = wrapperMain.has(s.realPath);
    s.long.executed = longExec;
    s.long.indirectExec = wrapperLong.has(s.realPath);
    const imp = imports.get(s.realPath) ?? [];
    const ciN = ci.get(s.realPath) ?? 0;
    const inGlob = inTestGlob(s.relPath);
    s.main.importedBy = imp;
    s.main.importedCount = imp.length;
    s.main.ciInvoked = ciN;
    s.main.inTestGlob = inGlob;
    s.long.importedBy = imp;
    s.long.importedCount = imp.length;
    s.long.ciInvoked = ciN;
    s.long.inTestGlob = inGlob;
    s.class = classifyScript(mainExec, imp.length, ciN, s.relPath, s.isTestFile, inGlob);
    if (s.isSymlink) s.main.note = `symlink alias \u2192 ${s.realPath}`;
    if (!isScriptFile(s.basename)) s.main.note = (s.main.note ? s.main.note + " \xB7 " : "") + "non-script file (config/fixture)";
    if (s.main.indirectExec) s.main.note = (s.main.note ? s.main.note + " \xB7 " : "") + "executed via live .sh wrapper";
  }
  const byClass = { live: 0, library: 0, "ci-only": 0, "dormant-by-decision": 0, "never-runs-test": 0, unaccounted: 0 };
  const unaccounted = [];
  const neverRunsTest = [];
  const dormantByDecision = [];
  const ciOnly = [];
  const diffMainToLong = [];
  const unaccountedToLive = [];
  for (const s of scripts) {
    byClass[s.class]++;
    if (s.class === "unaccounted") unaccounted.push(s.relPath);
    if (s.class === "never-runs-test") neverRunsTest.push(s.relPath);
    if (s.class === "dormant-by-decision") dormantByDecision.push(s.relPath);
    if (s.class === "ci-only") ciOnly.push(s.relPath);
    if (s.main.executed === 0 && s.long.executed > 0) {
      diffMainToLong.push({ script: s.relPath, mainClass: s.class, mainExecuted: s.main.executed, longExecuted: s.long.executed });
    }
    if (s.class === "unaccounted" && s.long.executed > 0) {
      unaccountedToLive.push({ script: s.relPath, longExecuted: s.long.executed });
    }
  }
  const mainHours = (new Date(until).getTime() - new Date(since).getTime()) / 36e5;
  return {
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    root,
    sessionsDir,
    innerSessions: [...innerSessions],
    windows: {
      main: { since, until, hours: Math.round(mainHours * 10) / 10 },
      long: { since: longSince, until, hours: longHours }
    },
    transcripts: {
      main: { commandCount: mainTx.commandCount, files: mainTx.files.map((f) => path2.basename(f)) },
      long: { commandCount: longTx.commandCount, files: longTx.files.map((f) => path2.basename(f)) }
    },
    scriptsTotal: scripts.length,
    rawEntries,
    scripts,
    summary: {
      byClass,
      unaccounted,
      neverRunsTest,
      dormantByDecision,
      ciOnly,
      diffMainToLong,
      unaccountedToLive
    }
  };
}
function countExecutedFor(s, tx, paths) {
  let n = 0;
  for (const c of tx.commands) n += countExecutedInCommand(c, s, paths);
  n += countWorkflowExecutions(s, tx.workflowInvocations);
  return n;
}
function renderMarkdown(inv) {
  const lines = [];
  lines.push("# Runtime-Usage Inventory \u2014 what the two-layer mode actually runs");
  lines.push("");
  lines.push(`Generated at: \`${inv.generatedAt}\` \xB7 repo root \`${inv.root}\``);
  lines.push("");
  lines.push(`## Scope`);
  lines.push("");
  lines.push(`- **Enumerated:** ${inv.scriptsTotal} distinct scripts by realpath (${inv.rawEntries} raw filesystem entries incl. symlinks) across \`plugin/scripts\` \xB7 \`experiments/**/scripts\` \xB7 \`.claude/workflows\` \xB7 \`scripts\`.`);
  lines.push(`- **Main window:** \`${inv.windows.main.since}\` \u2192 \`${inv.windows.main.until}\` (${inv.windows.main.hours.toFixed(1)}h), ${inv.transcripts.main.commandCount} Bash/Workflow commands read from \`${inv.sessionsDir}\`${inv.innerSessions.length ? `, scoped to inner-layer sessions \`${inv.innerSessions.join("`, `")}\`` : " (all sessions)"}.`);
  lines.push(`- **Long contrast window:** \`${inv.windows.long.since}\` \u2192 \`${inv.windows.long.until}\` (${inv.windows.long.hours}h), ${inv.transcripts.long.commandCount} commands. A script unaccounted in the main window but executed in the long window is **low-frequency, not dead** \u2014 listed in the diff set.`);
  lines.push(`- **Class semantics:** \`live\` executed>0 \xB7 \`library\` imported>0 \xB7 \`ci-only\` in \`.github/workflows\` \xB7 \`dormant-by-decision\` in the exp6 \xA70 seal list \xB7 \`never-runs-test\` a \`*.test.*\` outside \`scripts/test.sh\`'s canonical glob \xB7 \`unaccounted\` none of the above.`);
  lines.push("");
  lines.push(`> **unaccounted \u2260 deletable.** \`unaccounted\` means "no evidence explains why this script is here" \u2014 it is the *candidate pool* for a later decision, not a deletion list. Calling it "safe to delete" would delete exp5's deliberately sealed metering machinery (chart2/git-lens/portfolio/VT).`);
  lines.push("");
  lines.push(`## Summary`);
  lines.push("");
  lines.push(`| class | count |`);
  lines.push(`|---|---|`);
  for (const c of ["live", "library", "ci-only", "dormant-by-decision", "never-runs-test", "unaccounted"]) {
    lines.push(`| ${c} | ${inv.summary.byClass[c]} |`);
  }
  lines.push(`| **total** | ${inv.scriptsTotal} |`);
  lines.push("");
  lines.push(`**unaccounted (${inv.summary.unaccounted.length}):**`);
  lines.push("");
  for (const s of inv.summary.unaccounted) lines.push(`- \`${s}\``);
  lines.push("");
  lines.push(`**never-runs-test (${inv.summary.neverRunsTest.length})** \u2014 written but never in the canonical suite:`);
  lines.push("");
  for (const s of inv.summary.neverRunsTest) lines.push(`- \`${s}\``);
  lines.push("");
  lines.push(`**dormant-by-decision (${inv.summary.dormantByDecision.length})** \u2014 classified dormant in the main window (exp6 \xA70 seal list, explicit, source-cited):`);
  lines.push("");
  for (const s of inv.summary.dormantByDecision) lines.push(`- \`${s}\``);
  lines.push("");
  lines.push(`**Sealed by exp6 \xA70 (full ${DORMANT_BY_DECISION.length}-entry list, shown with their ACTUAL class):**`);
  lines.push("");
  const sealedByRel = new Map(inv.scripts.map((s) => [s.realPath, s]));
  for (const p of DORMANT_BY_DECISION) {
    const s = sealedByRel.get(p);
    const classLabel = s ? `\`${s.class}\`` : "not-enumerated";
    const eclipse = s && s.class !== "dormant-by-decision" ? ` \u2014 sealed, but \`${s.class}\` takes priority (imported by its own governance test)` : "";
    lines.push(`- \`${p}\` \u2192 **${classLabel}**${eclipse}`);
  }
  lines.push("");
  lines.push(`**ci-only (${inv.summary.ciOnly.length}):**`);
  lines.push("");
  for (const s of inv.summary.ciOnly) lines.push(`- \`${s}\``);
  lines.push("");
  lines.push(`## Main \u2192 long window diff (${inv.summary.diffMainToLong.length}) \u2014 low-frequency, not dead`);
  lines.push("");
  lines.push(`Scripts with \`executed == 0\` in the main window but \`executed > 0\` in the ${inv.windows.long.hours}h window. These are cadence-driven (milestone / CI-triggered), not dead.`);
  lines.push("");
  lines.push(`| script | main class | main executed | long executed |`);
  lines.push(`|---|---|---|---|`);
  for (const d of inv.summary.diffMainToLong) {
    lines.push(`| \`${d.script}\` | ${d.mainClass} | ${d.mainExecuted} | ${d.longExecuted} |`);
  }
  lines.push("");
  if (inv.summary.unaccountedToLive.length) {
    lines.push(`Of those, **unaccounted \u2192 live** (${inv.summary.unaccountedToLive.length}): ` + inv.summary.unaccountedToLive.map((d) => `\`${d.script}\` (\xD7${d.longExecuted})`).join(", "));
    lines.push("");
  }
  lines.push(`## Full table (${inv.scripts.length})`);
  lines.push("");
  lines.push(`| script | cat | exec | imp | ci | test-glob | class | long-exec | note |`);
  lines.push(`|---|---|---|---|---|---|---|---|---|`);
  for (const s of inv.scripts) {
    const catshort = s.category.replace("-scripts", "").replace("plugin", "plug").replace("experiments", "exp");
    lines.push(`| \`${s.relPath}\` | ${catshort} | ${s.main.executed} | ${s.main.importedCount} | ${s.main.ciInvoked} | ${s.main.inTestGlob ? "y" : "\u2014"} | **${s.class}** | ${s.long.executed} | ${s.main.note} |`);
  }
  lines.push("");
  lines.push(`## Methodology & known limitations`);
  lines.push("");
  lines.push(`- **executed** is command-position matching: single/double/backtick-quoted content is stripped, then only interpreter/executor argument positions count. \`ls x.ts\` / \`grep 'x.ts'\` / \`cat x.sh\` never count. Known conservative miss: a script referenced inside \`bash -c '...'\` / \`node -e '...'\` inline code is not counted (the code is quote-stripped).`);
  lines.push(`- **imported_by** parses \`import\`/\`require\` statements (comment-stripped) and resolves the specifier; it is not a substring scan. Known false positive: a string literal containing \`import ... from "..."\`.`);
  lines.push(`- **in_test_glob** only matters for \`*.test.*\` files; the three glob patterns are the canonical \`scripts/test.sh\` glob (ADR-019/DIR-109).`);
  lines.push(`- The transcripts read are whatever sessions exist under \`--sessions-dir\` within the window. For the main window these are the fast-mode inner-layer sessions; for the long window the same scan naturally includes the pre-fast-mode classic-loop sessions \u2014 which is exactly why cadence-driven scripts surface in the diff.`);
  lines.push(`- The task body cited 211 scripts at 2026-08-03 02:5xZ (a rough first measurement; a raw filesystem count that excluded the 7 \`*.test.*\` files). This inventory's current HEAD count is ${inv.scriptsTotal} distinct-by-realpath / ${inv.rawEntries} raw \u2014 the delta is \`plugin/scripts\` +1 (\`task-contract-check.ts\`, added 03:04Z) plus the 7 \`*.test.*\` files this inventory deliberately includes (AC6 requires listing them).`);
  lines.push(`- Some \`unaccounted\` entries are non-script files (config/fixture) that sit in a scripts dir \u2014 they are flagged in the \`note\` column (e.g. \`tsconfig.json\`, \`deliverable-governor-fixture.json\`, the 4 \`fixtures/loadbearing/scripts/fixture-*.mjs\`). They are included for full filesystem coverage but are not runnable scripts.`);
  lines.push(`- \`never-runs-test\` is eclipsed by \`live\` when a \`*.test.*\` outside the canonical glob was nonetheless executed in the window (e.g. \`it0-enforcement-with-design-check.test.mjs\`, run once manually). Such a file is genuinely "not in the suite" but has execution evidence \u2014 the class follows the priority, so it shows \`live\`, not \`never-runs-test\`.`);
  lines.push(`- The \`executed\` count is command-position matching (quotes stripped) plus a conservative wrapper-indirect signal (a transcript-live \`.sh\` that delegates to a same-dir \`.ts\`/references it via \`node\`/\`bash\`/ \`gate_delegate_ts\` marks that target as executed too). Known conservative misses: a script referenced inside \`bash -c '...'\` inline code, or invoked by bare basename after \`cd\`.`);
  lines.push("");
  lines.push(`## Entry point (gap-eighty-one-instruments-behind-remembered-paths-and-no-entry-point)`);
  lines.push("");
  lines.push(`The \`plugin/scripts\` instruments are discoverable through ONE entry point instead of remembered paths:`);
  lines.push("");
  lines.push(`- **MCP:** the Core \`instrument\` tool (\`packages/quay/src/mcp-server.ts\`) \u2014 \`action: "list"\` returns the derived instrument directory (each admitted instrument declaring what question it answers); \`action: "run"\` + \`name\` + \`args\` invokes one. The directory is DERIVED from the filesystem by this tool's \`--instruments-json\` mode:`);
  lines.push(`  \`node --experimental-strip-types plugin/scripts/runtime-usage-inventory.ts --instruments-json\``);
  lines.push(`- **Admission filter (AC4):** an instrument is admitted only when it declares its question \u2014 explicitly via \`@instrument "<question>"\` in its header comment, or derived from the header's own \`<basename> \u2014 <description>\` line. Instruments that cannot say are kept OUT, listed under \`notAdmitted\`.`);
  lines.push(`- **The count is derived, never hardcoded** \u2014 the "81" in the task body is a snapshot; the manifest's \`total\` reflects the current filesystem.`);
  lines.push("");
  return lines.join("\n");
}
function extractHeaderComment(src) {
  const text = src.replace(/^﻿/, "").trimStart();
  if (text.startsWith("/*")) {
    const end = text.indexOf("*/");
    if (end !== -1) return text.slice(2, end);
  }
  const out = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimStart();
    if (line.startsWith("//")) out.push(line.slice(2).trim());
    else if (line.startsWith("#!")) out.push(line.slice(2).trim());
    else if (line.startsWith("#")) out.push(line.slice(1).trim());
    else if (out.length && line === "") out.push("");
    else if (out.length) break;
    else break;
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}
var INSTRUMENT_TAG_RE = /@instrument\s+(.+?)\s*$/;
function extractInstrumentDeclaration(src, basename) {
  const header = extractHeaderComment(src);
  if (!header) return null;
  for (const line of header.split("\n")) {
    const m = line.match(INSTRUMENT_TAG_RE);
    if (m) return m[1].trim().replace(/^["'“”]+|["'“”]+$/g, "").trim();
  }
  const dashLine = header.split("\n").find((l) => l.includes("\u2014") || l.includes("\u2013"));
  if (dashLine) {
    const dashAt = dashLine.indexOf("\u2014") !== -1 ? dashLine.indexOf("\u2014") : dashLine.indexOf("\u2013");
    const desc = dashLine.slice(dashAt + 1).trim();
    if (desc) return desc;
  }
  return null;
}
function instrumentKind(basename) {
  return /\.(sh|bash|zsh)$/.test(basename) ? "bash" : "node";
}
function buildInstrumentsManifest(root) {
  const { scripts } = enumerateScripts(root);
  const pluginScripts = scripts.filter((s) => s.category === "plugin-scripts" && isScriptFile(s.basename)).sort((a, b) => a.relPath.localeCompare(b.relPath));
  const instruments = [];
  const notAdmitted = [];
  for (const s of pluginScripts) {
    let src = "";
    try {
      src = fs2.readFileSync(path2.join(root, s.realPath), "utf8");
    } catch {
      src = "";
    }
    const description = extractInstrumentDeclaration(src, s.basename);
    if (description) {
      instruments.push({
        name: s.basename.replace(/\.[^.]+$/, ""),
        path: s.realPath,
        description,
        kind: instrumentKind(s.basename)
      });
    } else {
      notAdmitted.push(s.realPath);
    }
  }
  instruments.sort((a, b) => a.name.localeCompare(b.name));
  return {
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    root,
    total: pluginScripts.length,
    admitted: instruments.length,
    notAdmitted,
    instruments
  };
}
function parseArgv(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const eq = key.indexOf("=");
      if (eq !== -1) {
        out[key.slice(0, eq)] = key.slice(eq + 1);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        out[key] = argv[++i];
      } else {
        out[key] = "true";
      }
    }
  }
  return out;
}
function defaultSessionsDir(root) {
  const base = path2.join(os.homedir(), ".claude", "projects");
  const mangled = "-" + root.replace(/\//g, "-");
  return path2.join(base, mangled);
}
function main(argv) {
  const args = parseArgv(argv);
  const here = path2.dirname(fileURLToPath2(import.meta.url));
  const root = path2.resolve(args.root ?? repoRoot());
  if (args["instruments-json"] === "true") {
    process.stdout.write(JSON.stringify(buildInstrumentsManifest(root), null, 2) + "\n");
    return 0;
  }
  const since = args.since ?? DEFAULT_SINCE;
  const until = args.until ?? (/* @__PURE__ */ new Date()).toISOString();
  const longHours = Number(args["long-hours"] ?? DEFAULT_LONG_HOURS);
  const sessionsDir = args["sessions-dir"] ? path2.resolve(args["sessions-dir"]) : defaultSessionsDir(root);
  const noWrite = args["no-write"] === "true";
  const asJson = args["json"] === "true";
  const excludeSessions = new Set((args["exclude-session"] ?? "").split(",").filter(Boolean));
  if (process.env.CLAUDE_CODE_SESSION_ID && !process.env.CLAUDE_CODE_CHILD_SESSION) {
    excludeSessions.add(process.env.CLAUDE_CODE_SESSION_ID);
  }
  const innerSessions = new Set((args["inner-sessions"] ?? "").split(",").filter(Boolean));
  const inv = buildInventory(root, sessionsDir, since, until, longHours, { excludeSessions, innerSessions });
  if (asJson) {
    process.stdout.write(JSON.stringify(inv, null, 2) + "\n");
  } else {
    const outDir = path2.join(root, "docs", "analysis");
    if (!noWrite) {
      fs2.mkdirSync(outDir, { recursive: true });
      fs2.writeFileSync(path2.join(outDir, "runtime-usage-inventory.json"), JSON.stringify(inv, null, 2) + "\n");
      fs2.writeFileSync(path2.join(outDir, "runtime-usage-inventory.md"), renderMarkdown(inv));
    }
    const s = inv.summary;
    console.log(`runtime-usage-inventory: ${inv.scriptsTotal} scripts (${inv.rawEntries} raw) | live ${s.byClass.live} \xB7 library ${s.byClass.library} \xB7 ci-only ${s.byClass["ci-only"]} \xB7 dormant ${s.byClass["dormant-by-decision"]} \xB7 never-runs-test ${s.byClass["never-runs-test"]} \xB7 unaccounted ${s.byClass.unaccounted}`);
    if (!noWrite) console.log(`wrote docs/analysis/runtime-usage-inventory.{json,md}`);
  }
  return 0;
}
if (process.argv[1] && path2.basename(process.argv[1]) === "runtime-usage-inventory.ts") {
  process.exit(main(process.argv.slice(2)));
}
export {
  DEFAULT_LONG_HOURS,
  DEFAULT_SINCE,
  DORMANT_BY_DECISION,
  SCRIPT_ROOTS,
  TEST_GLOB_PATTERNS,
  buildInstrumentsManifest,
  buildInventory,
  classifyScript,
  countExecutedInCommand,
  enumerateScripts,
  extractHeaderComment,
  extractInstrumentDeclaration,
  extractModuleSpecifiers,
  globMatch,
  inTestGlob,
  instrumentKind,
  isScriptFile,
  main,
  parseImports,
  readCiInvocation,
  readTranscripts,
  renderMarkdown,
  splitCommandSegments,
  stripQuotedContent,
  tokenMatchesScript
};
