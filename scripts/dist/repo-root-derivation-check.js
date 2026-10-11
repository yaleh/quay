#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/repo-root-derivation-check.ts
import fs4 from "node:fs";
import path5 from "node:path";

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

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/concurrency-literal-check.ts
import fs3 from "node:fs";
import path4 from "node:path";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/checker-lib.ts
var REGEX_PRECURSOR_KEYWORDS = /* @__PURE__ */ new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await"
]);
function isRegexStart(prevCode, src, i) {
  if (prevCode === "") return true;
  if (/\s/.test(prevCode)) return true;
  if ((prevCode === "+" || prevCode === "-") && src[i - 2] === prevCode) return false;
  if (/[A-Za-z0-9_$]/.test(prevCode)) {
    const m = src.slice(0, i).match(/([A-Za-z_$][A-Za-z0-9_$]*)\s*$/);
    return m ? REGEX_PRECURSOR_KEYWORDS.has(m[1]) : false;
  }
  if (prevCode === ")" || prevCode === "]" || prevCode === '"' || prevCode === "'" || prevCode === "`") return false;
  return true;
}
function buildNonCodeMask(src) {
  const mask = new Uint8Array(src.length);
  let i = 0;
  const n = src.length;
  let prevCode = "";
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      mask[i] = 1;
      mask[i + 1] = 1;
      i += 2;
      while (i < n && src[i] !== "\n") {
        mask[i] = 1;
        i++;
      }
      continue;
    }
    if (c === "/" && d === "*") {
      mask[i] = 1;
      mask[i + 1] = 1;
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        mask[i] = 1;
        i++;
      }
      if (i < n) {
        mask[i] = 1;
        mask[i + 1] = 1;
        i += 2;
      }
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      mask[i] = 1;
      i++;
      while (i < n) {
        mask[i] = 1;
        if (src[i] === "\\") {
          if (i + 1 < n) {
            mask[i + 1] = 1;
            i += 2;
          } else {
            i++;
          }
          continue;
        }
        if (src[i] === q) {
          i++;
          break;
        }
        i++;
      }
      prevCode = q;
      continue;
    }
    if (c === "/" && isRegexStart(prevCode, src, i)) {
      mask[i] = 1;
      i++;
      let inClass = false;
      while (i < n) {
        mask[i] = 1;
        const cc = src[i];
        if (cc === "\\") {
          if (i + 1 < n) {
            mask[i + 1] = 1;
            i += 2;
          } else {
            i++;
          }
          continue;
        }
        if (cc === "[") inClass = true;
        else if (cc === "]") inClass = false;
        else if (cc === "/" && !inClass) {
          i++;
          break;
        } else if (cc === "\n") {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    prevCode = c;
    i++;
  }
  return mask;
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
import path2 from "node:path";
function helpExit(usage2) {
  process.stdout.write(usage2.endsWith("\n") ? usage2 : usage2 + "\n");
  process.exit(0);
}
function flagValue(argv, name) {
  const idx = argv.indexOf(name);
  return idx === -1 ? void 0 : argv[idx + 1];
}
function resolveRoot(rootArg) {
  return path2.resolve(rootArg ?? process.cwd());
}
var VERDICT_EXIT_CODE = {
  pass: 0,
  fail: 1,
  "not-evaluated": 3
};
function verdictExitCode(status) {
  return VERDICT_EXIT_CODE[status];
}
function emitVerdict(verdict, opts = {}) {
  const { json = false, stream = "stdout" } = opts;
  const out = stream === "stderr" ? process.stderr : process.stdout;
  if (json) {
    const detail = verdict.detail;
    const base = detail !== null && typeof detail === "object" && !Array.isArray(detail) ? { ...detail } : detail === void 0 ? {} : { detail };
    base.status = verdict.status;
    base.ok = verdict.status === "pass";
    base.message = verdict.message;
    out.write(JSON.stringify(base) + "\n");
  } else {
    const prefix = verdict.status === "pass" ? "PASS" : verdict.status === "fail" ? "FAIL" : "NOT-EVALUATED";
    out.write(`${prefix}: ${verdict.message}
`);
  }
  return verdictExitCode(verdict.status);
}
function emitPass(message, detail, opts) {
  return emitVerdict({ status: "pass", message, detail }, opts);
}
function emitFail(message, detail, opts) {
  return emitVerdict({ status: "fail", message, detail }, opts);
}
function emitNotEvaluated(message, detail, opts) {
  return emitVerdict({ status: "not-evaluated", message, detail }, opts);
}
function isDirectEntry(importMeta, argv1, expectedBase) {
  void importMeta;
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  return path2.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/fs-walk.ts
import fs2 from "node:fs";
import path3 from "node:path";
function visibleDirPrefixes(paths) {
  const dirs = /* @__PURE__ */ new Set();
  for (const p of paths) {
    let i = p.lastIndexOf("/");
    while (i > 0) {
      const d = p.slice(0, i);
      if (dirs.has(d)) break;
      dirs.add(d);
      i = d.lastIndexOf("/");
    }
  }
  return dirs;
}
function walkFiles(root, opts = {}) {
  const prune = opts.prune;
  const include = opts.include;
  const entryKind = opts.entryKind ?? "dirent";
  const maxDepth = opts.maxDepth ?? Number.POSITIVE_INFINITY;
  const absolute = opts.absolute ?? false;
  const wantSort = opts.sort ?? true;
  const visible = opts.visible ?? null;
  const visibleDirs = visible ? visibleDirPrefixes(visible.paths) : null;
  const out = [];
  if (!fs2.existsSync(root)) return out;
  const isVisible = (abs, isDir) => {
    if (!visible || !visibleDirs) return true;
    const rel = path3.relative(visible.root, abs).split(path3.sep).join("/");
    return isDir ? visibleDirs.has(rel) : visible.paths.has(rel);
  };
  const record = (abs) => {
    out.push(absolute ? abs : path3.relative(root, abs).split(path3.sep).join("/"));
  };
  const walk = (dir, depth) => {
    let entries;
    try {
      entries = fs2.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      let isDir;
      if (entryKind === "dirent") {
        isDir = e.isDirectory();
      } else {
        try {
          isDir = fs2.statSync(path3.join(dir, e.name)).isDirectory();
        } catch {
          continue;
        }
      }
      if (prune && prune(e.name, isDir)) continue;
      const abs = path3.join(dir, e.name);
      if (!isVisible(abs, isDir)) continue;
      if (isDir) {
        if (depth < maxDepth) walk(abs, depth + 1);
        continue;
      }
      const ext = path3.extname(e.name);
      if (!include || include(e.name, ext, entryKind === "dirent" ? e : null)) record(abs);
    }
  };
  walk(root, 1);
  return wantSort ? out.sort() : out;
}
function scanRoots(root, scanRoots2, skipDirNames) {
  const out = scanRoots2.flatMap(
    ({ dir, rel, ext, recursive }) => walkFiles(path3.join(root, dir), {
      entryKind: "stat",
      maxDepth: recursive === false ? 1 : Number.POSITIVE_INFINITY,
      prune: (name, isDir) => isDir && skipDirNames.has(name),
      include: (name) => ext.test(name)
    }).map((p) => path3.join(rel, p))
  );
  return out.sort();
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/concurrency-literal-check.ts
var CONCURRENCY_KEYWORD_RE = /(?:^|_)(cap|slot|lane|concurr|subagent|parallel|quota|oversub|dispatch)(?:s|es|ing|ency|ies)?(?:$|_)/i;
var CONST_DEF_RE = /(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(\d+(?:\.\d+)?)/g;
var CLI_FLAG_RE = /--(cap|lane-count|slots?|concurrency|serial-concurrency|test-concurrency|suite-concurrency|max-concurrent|max-task-subagents|max-concurrent-suites)(?:[= ])(\d+(?:\.\d+)?)/g;
var CPU_QUOTA_RE = /(?:CPUQuota\s*=|cpuQuota\s*[:=]\s*["']?)(\d+(?:\.\d+)?)\s*%?["']?/g;
var OBJECT_KEY_RE = /(cap|slots?|laneCount|lane|concurrency)\s*:\s*(\d+(?:\.\d+)?)/g;
var SYSTEMD_RUN_LIMIT_KEY_RE = /(?:MemoryMax|TasksMax)\s*=/;
var SYSTEMD_CPU_QUOTA_IN_STRING_RE = /CPUQuota\s*=\s*(\d+(?:\.\d+)?)\s*%/g;
function stringLiteralSpans(src, isShell) {
  const spans = [];
  let i = 0;
  const n = src.length;
  let prevCode = "";
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      i += 2;
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && d === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      if (i < n) i += 2;
      continue;
    }
    if (isShell && c === "#") {
      const prev = i === 0 ? "\n" : src[i - 1];
      if (/\s/.test(prev)) {
        while (i < n && src[i] !== "\n") i++;
        continue;
      }
    }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      const start = i;
      i++;
      while (i < n) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === q) {
          i++;
          break;
        }
        i++;
      }
      spans.push({ start, end: i, body: src.slice(start + 1, i - 1) });
      prevCode = q;
      continue;
    }
    if (c === "/" && isRegexStart(prevCode, src, i)) {
      i++;
      let inClass = false;
      while (i < n) {
        const cc = src[i];
        if (cc === "\\") {
          i += 2;
          continue;
        }
        if (cc === "[") inClass = true;
        else if (cc === "]") inClass = false;
        else if (cc === "/" && !inClass) {
          i++;
          break;
        } else if (cc === "\n") {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    prevCode = c;
    i++;
  }
  return spans;
}
function scanSystemdRunLimitCpuQuota(src, isShell) {
  const out = [];
  for (const sp of stringLiteralSpans(src, isShell)) {
    if (!SYSTEMD_RUN_LIMIT_KEY_RE.test(sp.body)) continue;
    SYSTEMD_CPU_QUOTA_IN_STRING_RE.lastIndex = 0;
    let m;
    while ((m = SYSTEMD_CPU_QUOTA_IN_STRING_RE.exec(sp.body)) !== null) {
      out.push({ index: sp.start + 1 + m.index, raw: m[0] });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}
var DEFINITION_POINT_NAMES = [
  "QUAY_MAX_TASK_SUBAGENTS",
  "QUAY_MAX_CONCURRENT_SUITES",
  "QUAY_MAX_OVERSUBSCRIPTION"
];
function definitionPointReadRe() {
  const alt = DEFINITION_POINT_NAMES.join("|");
  return new RegExp(`(?:process\\.env|os\\.environ|Deno\\.env|env\\.)\\.?\\s*(?:${alt})`);
}
var FALLBACK_MARKER = "concurrency-default-fallback";
function buildMask(src, isShell) {
  const mask = buildNonCodeMask(src);
  if (!isShell) return mask;
  const spaced = src.split("");
  for (let i = 0; i < spaced.length; i++) {
    if (spaced[i] !== "#") continue;
    const prev = i === 0 ? "\n" : spaced[i - 1];
    if (!/\s/.test(prev)) continue;
    for (let j = i; j < spaced.length && spaced[j] !== "\n"; j++) spaced[j] = " ";
  }
  const masked = buildNonCodeMask(spaced.join(""));
  for (let i = 0; i < masked.length; i++) mask[i] = masked[i];
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== "#") continue;
    const prev = i === 0 ? "\n" : src[i - 1];
    if (!/\s/.test(prev)) continue;
    let j = i;
    while (j < src.length && src[j] !== "\n") {
      mask[j] = 1;
      j++;
    }
    if (j < src.length) mask[j] = 1;
  }
  return mask;
}
function isMasked(mask, i, j) {
  for (let k = i; k < j && k < mask.length; k++) if (mask[k] === 0) return false;
  return true;
}
var SCAN_ROOTS = [
  { dir: "plugin/scripts", rel: "plugin/scripts", ext: /\.(ts|sh)$/ },
  { dir: "scripts", rel: "scripts", ext: /\.(ts|sh)$/ },
  { dir: "plugin/workflows", rel: "plugin/workflows", ext: /\.js$/ }
];
var SURFACE_SKIP_DIRS = /* @__PURE__ */ new Set(["node_modules", ".git", "test", "checker-mutation-cases"]);
function scanSurface(root) {
  return scanRoots(root, SCAN_ROOTS, SURFACE_SKIP_DIRS);
}
function carriesFallbackMarker(lineTexts) {
  return lineTexts.some((l) => l.includes(FALLBACK_MARKER));
}
function declarationBlockLines(srcLines, hitLineIdx) {
  const block = [];
  block.push(srcLines[hitLineIdx]);
  for (let i = hitLineIdx - 1; i >= 0; i--) {
    const t = srcLines[i].trim();
    if (t === "") continue;
    if (/^(\/\/|\*|#)/.test(t)) {
      block.push(srcLines[i]);
      continue;
    }
    break;
  }
  return block;
}
function isDefinitionPoint(block) {
  return block.some((l) => definitionPointReadRe().test(l));
}
function scanText(rel, src) {
  const mask = buildMask(src, rel.endsWith(".sh"));
  const lines = src.split("\n");
  const hits = [];
  const classify = (lineIdx) => {
    const block = declarationBlockLines(lines, lineIdx);
    if (isDefinitionPoint(block)) return "definition-point";
    if (carriesFallbackMarker(block)) return "declared-exception";
    return "violation";
  };
  const patterns = [
    { id: "P1", re: CONST_DEF_RE, domainCheck: (m) => CONCURRENCY_KEYWORD_RE.test(m[1]) },
    { id: "P2", re: CLI_FLAG_RE },
    { id: "P3", re: CPU_QUOTA_RE },
    { id: "P4", re: OBJECT_KEY_RE }
  ];
  for (const p of patterns) {
    const re = new RegExp(p.re.source, p.re.flags);
    let m;
    while ((m = re.exec(src)) !== null) {
      if (isMasked(mask, m.index, m.index + m[0].length)) {
        if (m[0].length === 0) re.lastIndex++;
        continue;
      }
      if (p.domainCheck && !p.domainCheck(m)) {
        if (m[0].length === 0) re.lastIndex++;
        continue;
      }
      const lineIdx = src.slice(0, m.index).split("\n").length - 1;
      hits.push({ file: rel, line: lineIdx + 1, text: (lines[lineIdx] ?? "").trim().slice(0, 120), kind: classify(lineIdx), pattern: p.id });
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  for (const m of scanSystemdRunLimitCpuQuota(src, rel.endsWith(".sh"))) {
    const lineIdx = src.slice(0, m.index).split("\n").length - 1;
    hits.push({ file: rel, line: lineIdx + 1, text: (lines[lineIdx] ?? "").trim().slice(0, 120), kind: classify(lineIdx), pattern: "P5" });
  }
  return hits.sort((a, b) => a.line - b.line);
}
function scanFiles(files, root) {
  const all = [];
  for (const rel of files) {
    const abs = path4.join(root, rel);
    if (!fs3.existsSync(abs)) continue;
    all.push(...scanText(rel, fs3.readFileSync(abs, "utf8")));
  }
  return all.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}
var usage = `concurrency-literal-check.ts \u2014 \u5E76\u53D1\u6570\u503C\u5B57\u9762\u91CF\u53EA\u5141\u8BB8\u5728\u552F\u4E00\u5B9A\u4E49\u70B9
(gap-concurrency-literal-only-at-definition-points)

Usage:
  node --experimental-strip-types concurrency-literal-check.ts --scan [--root <dir>] [--json]
      measure mode \u2014 print every hit with its classification (definition-point / declared-exception /
      violation). Exit 0 always (measure).
  node --experimental-strip-types concurrency-literal-check.ts --gate [--root <dir>] [--json]
      gate mode \u2014 scan the executable surface (plugin/scripts + scripts + plugin/workflows); exit 1
      iff any concurrency numeric literal is NOT at a QUAY_MAX_* definition
      point AND NOT marked 'concurrency-default-fallback' (an undeclared literal = violation).

Exit codes: 0 PASS/measure \xB7 1 gate FAIL (>=1 violation) \xB7 2 usage/env error.`;
function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit(usage);
  const asJson = args.includes("--json");
  const root = resolveRoot(flagValue(args, "--root"));
  const surface = scanSurface(root);
  const hits = scanFiles(surface, root);
  if (args.includes("--scan")) {
    if (asJson) {
      console.log(JSON.stringify({
        mode: "scan",
        surface,
        hits: hits.map((h) => ({ file: h.file, line: h.line, pattern: h.pattern, kind: h.kind, text: h.text })),
        violations: hits.filter((h) => h.kind === "violation").length
      }, null, 2));
    } else {
      console.log(`concurrency-literal-check --scan \u2014 ${surface.length} file(s) scanned`);
      for (const h of hits) {
        const tag = h.kind === "violation" ? "\u8FDD\u89C4" : h.kind === "definition-point" ? "\u5B9A\u4E49\u70B9" : "\u5DF2\u58F0\u660E\u4F8B\u5916";
        console.log(`  [${tag}] ${h.file}:${h.line} (${h.pattern}) ${h.text}`);
      }
      const violations = hits.filter((h) => h.kind === "violation");
      console.log(`hits: ${hits.length}  violations: ${violations.length}`);
    }
    return 0;
  }
  if (args.includes("--gate")) {
    const violations = hits.filter((h) => h.kind === "violation");
    if (asJson) {
      console.log(JSON.stringify({
        mode: "gate",
        ok: violations.length === 0,
        surface,
        hits: hits.map((h) => ({ file: h.file, line: h.line, pattern: h.pattern, kind: h.kind, text: h.text })),
        violations: violations.map((h) => ({ file: h.file, line: h.line, pattern: h.pattern, text: h.text }))
      }, null, 2));
    } else {
      console.log(`concurrency-literal-check --gate \u2014 ${surface.length} file(s) scanned, ${hits.length} concurrency literal(s)`);
      for (const h of hits) {
        const tag = h.kind === "violation" ? "\u8FDD\u89C4" : h.kind === "definition-point" ? "\u5B9A\u4E49\u70B9" : "\u5DF2\u58F0\u660E\u4F8B\u5916";
        console.log(`  [${tag}] ${h.file}:${h.line} (${h.pattern}) ${h.text}`);
      }
      if (violations.length === 0) {
        console.log("PASS \u2014 every concurrency literal is at a QUAY_MAX_* definition point or a declared fallback (0 violations)");
      } else {
        console.log(`FAIL \u2014 ${violations.length} undeclared concurrency literal(s) (not at a QUAY_MAX_* definition point, no 'concurrency-default-fallback' marker):`);
        for (const v of violations) console.log(`  - ${v.file}:${v.line} (${v.pattern}) ${v.text}`);
      }
    }
    return violations.length === 0 ? 0 : 1;
  }
  console.error(usage);
  return 2;
}
if (isDirectEntry(import.meta, void 0, "concurrency-literal-check")) {
  process.exit(main(process.argv));
}

// packages/quay/src/kernel/regex-escape.ts
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/repo-root-derivation-check.ts
var RESOLVE_CALL = ["path", "resolve"].join(".") + "(";
var UP_ONE = String.fromCharCode(46, 46);
var QUOTED_UP_ONE = `"${UP_ONE}"`;
var SKIP_DIR_NAMES = /* @__PURE__ */ new Set(["dist", "checker-mutation-cases", "node_modules"]);
var SCAN_EXTENSIONS = /* @__PURE__ */ new Set([".ts", ".sh", ".mjs"]);
var IDENT_RE = /^[A-Za-z_$][\w$]*$/;
function maskedText(src, isShell) {
  return maskToText(src, buildMask(src, isShell));
}
function maskToText(src, mask) {
  const out = new Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = mask[i] === 1 && src[i] !== "\n" ? " " : src[i];
  return out.join("");
}
function scriptDirBindings(codeText) {
  const scriptDir = /* @__PURE__ */ new Set(["__dirname"]);
  const selfPath = /* @__PURE__ */ new Set(["__filename"]);
  const lines = codeText.split("\n");
  const DECL_RE = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(.+?);\s*$/;
  let changed = true;
  while (changed) {
    changed = false;
    for (const line of lines) {
      const m = DECL_RE.exec(line);
      if (!m) continue;
      const name = m[1];
      const rhs = m[2].trim();
      const dirnameCall = /^(?:path\.)?dirname\s*\(\s*(.+?)\s*\)$/.exec(rhs);
      if (dirnameCall) {
        const arg = dirnameCall[1].trim();
        const argIsSelfPath = IDENT_RE.test(arg) && selfPath.has(arg) || arg === "__filename" || arg.includes("import.meta.url");
        const argIsScriptDir = IDENT_RE.test(arg) && scriptDir.has(arg);
        if ((argIsSelfPath || argIsScriptDir) && !scriptDir.has(name)) {
          scriptDir.add(name);
          changed = true;
        }
        continue;
      }
      if (rhs.includes("import.meta.url")) {
        if (!selfPath.has(name)) {
          selfPath.add(name);
          changed = true;
        }
        continue;
      }
      if (IDENT_RE.test(rhs)) {
        if (selfPath.has(rhs) && !selfPath.has(name)) {
          selfPath.add(name);
          changed = true;
          continue;
        }
        if (scriptDir.has(rhs) && !scriptDir.has(name)) {
          scriptDir.add(name);
          changed = true;
          continue;
        }
      }
    }
  }
  return scriptDir;
}
function derivationRe(names) {
  const valid = names.filter((n) => IDENT_RE.test(n));
  if (valid.length === 0) return null;
  valid.sort((a, b) => b.length - a.length);
  return new RegExp(
    `${escapeRegExp(RESOLVE_CALL)}\\s*(${valid.join("|")})\\s*,\\s*${escapeRegExp(QUOTED_UP_ONE)}\\s*,\\s*${escapeRegExp(QUOTED_UP_ONE)}\\s*[,)]`,
    "g"
  );
}
function scanSource(relFile, src, isShell) {
  if (!src.includes(RESOLVE_CALL)) return [];
  if (src.split(QUOTED_UP_ONE).length - 1 < 2) return [];
  const mask = buildMask(src, isShell);
  const names = [...scriptDirBindings(maskToText(src, mask))];
  const re = derivationRe(names);
  if (re === null) return [];
  const lines = src.split("\n");
  const hits = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    const idx = m.index;
    if (mask[idx] !== 0) continue;
    let line = 1;
    let lineStart = 0;
    for (let i = 0; i < idx; i++) {
      if (src[i] === "\n") {
        line++;
        lineStart = i + 1;
      }
    }
    hits.push({ file: relFile, line, col: idx - lineStart + 1, text: (lines[line - 1] ?? "").trim() });
  }
  return hits;
}
function collectTargets(root, scans) {
  const out = [];
  const addFile = (abs) => {
    if (SCAN_EXTENSIONS.has(path5.extname(abs)) && fs4.existsSync(abs) && fs4.statSync(abs).isFile()) out.push(abs);
  };
  if (scans.length > 0) {
    for (const s of scans) {
      const abs = path5.resolve(root, s);
      if (!fs4.existsSync(abs)) continue;
      if (fs4.statSync(abs).isDirectory()) {
        for (const f of walkFiles(abs, { absolute: true, prune: (name) => SKIP_DIR_NAMES.has(name) })) addFile(f);
      } else {
        addFile(abs);
      }
    }
  } else {
    const dir = path5.join(root, "plugin", "scripts");
    if (fs4.existsSync(dir)) {
      for (const f of walkFiles(dir, { absolute: true, prune: (name) => SKIP_DIR_NAMES.has(name) })) addFile(f);
    }
  }
  return [...new Set(out)].sort();
}
function runCheck(root, scans) {
  const targets = collectTargets(root, scans);
  if (targets.length === 0) return { root, evaluated: false, scanned: [], hits: [] };
  const hits = [];
  const scanned = [];
  for (const abs of targets) {
    let src;
    try {
      src = fs4.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const rel = path5.relative(root, abs).split(path5.sep).join("/");
    scanned.push(rel);
    hits.push(...scanSource(rel, src, abs.endsWith(".sh")));
  }
  if (scanned.length === 0) return { root, evaluated: false, scanned: [], hits: [] };
  return { root, evaluated: true, scanned, hits };
}
var USAGE = "usage: node --experimental-strip-types repo-root-derivation-check.ts [--root <dir>] [--json] [--scan <file-or-dir>]\u2026\n  \u68D8\u8F6E\uFF1Aplugin/scripts \u91CC\u4E0D\u5F97\u518D\u7528\u300C\u811A\u672C\u76EE\u5F55\u5E38\u91CF\u5411\u4E0A\u4E24\u7EA7\u300D\u624B\u6413\u4ED3\u6839\uFF08\u7528 repo-root.ts \u7684 repoRoot()\uFF09\u3002\n  \u9ED8\u8BA4\u626B\u63CF\u9762 = <root>/plugin/scripts\uFF08\u8DF3\u8FC7 dist/ \u4E0E checker-mutation-cases/\uFF09\u3002\n  exit 0 = PASS\uFF0C1 = RED\uFF08\u22651 \u5904\u547D\u4E2D\uFF09\uFF0C2 = usage/env error\uFF0C3 = NOT-EVALUATED\uFF08\u626B\u63CF\u9762\u8BFB\u4E0D\u5230/\u4E3A\u7A7A\uFF09\u3002";
function collectScans(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === "--scan" && argv[i + 1]) out.push(argv[i + 1]);
  return out;
}
function main2(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit(USAGE);
  let root = repoRoot();
  const ri = args.indexOf("--root");
  if (ri !== -1 && args[ri + 1]) root = path5.resolve(args[ri + 1]);
  const asJson = args.includes("--json");
  const scans = collectScans(args);
  const res = runCheck(root, scans);
  if (!res.evaluated) {
    return emitNotEvaluated(
      `\u626B\u63CF\u9762\u4E3A\u7A7A\u6216\u8BFB\u4E0D\u5230\uFF08root: ${res.root}${scans.length > 0 ? `, --scan ${scans.join(" ")}` : ", plugin/scripts"}\uFF09\u2014\u2014\u300C\u6CA1\u8BC4\u4F30\u300D\u4E0D\u662F\u300C\u5E72\u51C0\u300D\u3002`,
      { root: res.root, scans, scanned: 0, hits: 0 },
      { json: asJson }
    );
  }
  if (res.hits.length > 0) {
    const detail = {
      root: res.root,
      scanned: res.scanned.length,
      hits: res.hits.length,
      violations: res.hits.map((h) => `${h.file}:${h.line}:${h.col}  ${h.text}`)
    };
    return emitFail(
      `${res.hits.length} \u5904\u300C\u811A\u672C\u76EE\u5F55\u5E38\u91CF\u5411\u4E0A\u4E24\u7EA7\u300D\u624B\u6413\u4ED3\u6839\uFF08\u626B\u4E86 ${res.scanned.length} \u4E2A\u6587\u4EF6\uFF09\uFF1A` + res.hits.map((h) => `${h.file}:${h.line}`).join(", ") + ' \u2014 \u6539\u7528 `import { repoRoot } from "./repo-root.ts"` + `repoRoot()`\uFF08--root \u8986\u76D6\u901A\u9053\u4E0D\u52A8\uFF09\u3002',
      detail,
      { json: asJson }
    );
  }
  return emitPass(`\u65E0\u624B\u6413\u300C\u5411\u4E0A\u4E24\u7EA7\u300D\u4ED3\u6839\uFF08\u626B\u4E86 ${res.scanned.length} \u4E2A\u6587\u4EF6\uFF0C\u5747\u7528 repoRoot() \u6216\u53E6\u6709\u663E\u5F0F\u6839\u901A\u9053\uFF09\u3002`, {
    root: res.root,
    scanned: res.scanned.length,
    hits: 0
  }, { json: asJson });
}
if (isDirectEntry(import.meta, void 0, "repo-root-derivation-check")) {
  process.exit(main2(process.argv));
}
export {
  SCAN_EXTENSIONS,
  SKIP_DIR_NAMES,
  USAGE,
  collectScans,
  collectTargets,
  derivationRe,
  main2 as main,
  maskToText,
  maskedText,
  runCheck,
  scanSource,
  scriptDirBindings
};
