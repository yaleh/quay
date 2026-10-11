#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/identity-replication-check.ts
import fs3 from "node:fs";
import path4 from "node:path";

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

// packages/quay/src/kernel/regex-escape.ts
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/source-text-lib.ts
function lineOf(src, idx) {
  let line = 1;
  for (let i = 0; i < idx && i < src.length; i++) if (src[i] === "\n") line++;
  return line;
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/identity-replication-check.ts
function maybeRegexStart(src, i) {
  let p = i - 1;
  while (p >= 0 && (src[p] === " " || src[p] === "	")) p--;
  const prev = p < 0 ? "\n" : src[p];
  if (!/[A-Za-z0-9_$)\]}"'`]/.test(prev)) return true;
  return /(?:^|[^\w$])(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)\s*$/.test(
    src.slice(0, i)
  );
}
function regexLiteralEnd(src, i) {
  if (!maybeRegexStart(src, i)) return -1;
  let j = i + 1;
  let inClass = false;
  while (j < src.length && src[j] !== "\n") {
    const c = src[j];
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === "[") {
      inClass = true;
      j++;
      continue;
    }
    if (c === "]") {
      inClass = false;
      j++;
      continue;
    }
    if (c === "/" && !inClass) return j + 1;
    j++;
  }
  return -1;
}
function tsCommentMask(src) {
  const mask = new Uint8Array(src.length);
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
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
      continue;
    }
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
    if (c === "/") {
      const end = regexLiteralEnd(src, i);
      if (end !== -1) {
        i = end;
        continue;
      }
    }
    i++;
  }
  return mask;
}
function blankComments(src, mask) {
  if (!mask.some((m) => m === 1)) return src;
  const parts = [];
  let i = 0;
  while (i < src.length) {
    let j = i;
    if (mask[i] === 1) {
      while (j < src.length && mask[j] === 1) j++;
      parts.push(" ".repeat(j - i));
    } else {
      while (j < src.length && mask[j] !== 1) j++;
      parts.push(src.slice(i, j));
    }
    i = j;
  }
  return parts.join("");
}
function shCommentMask(src) {
  const mask = new Uint8Array(src.length);
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "'") {
      i++;
      while (i < n) {
        if (src[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === '"') {
      i++;
      while (i < n) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === "#") {
      while (i < n && src[i] !== "\n") {
        mask[i] = 1;
        i++;
      }
      continue;
    }
    i++;
  }
  return mask;
}
function maskFor(f) {
  return f.endsWith(".sh") ? shCommentMask : tsCommentMask;
}
var SKIP_DIRS = /* @__PURE__ */ new Set(["node_modules", "vendor", "fixture", ".git", ".quay", "dist", "coverage"]);
var CODE_EXTS = /* @__PURE__ */ new Set([".ts", ".sh", ".mjs", ".js"]);
var SKIP_REL_PREFIXES = ["packages/quay/plugin/"];
function walkCodeFiles(root) {
  const roots = ["plugin", "packages", "experiments", "scripts"].map((d) => path4.join(root, d));
  const out = roots.flatMap(
    (r) => walkFiles(r, {
      absolute: true,
      prune: (name) => SKIP_DIRS.has(name),
      include: (name, ext) => CODE_EXTS.has(ext)
    })
  );
  return out.filter((f) => {
    const rel = path4.relative(root, f).split(path4.sep).join("/");
    return !SKIP_REL_PREFIXES.some((p) => rel.startsWith(p));
  }).sort();
}
function codeMatch(src, mask, re) {
  const g = new RegExp(re.source, "g");
  const hits = [];
  let m;
  while ((m = g.exec(src)) !== null) {
    if (mask[m.index] === 0) hits.push({ line: lineOf(src, m.index), match: m[0] });
    if (m[0].length === 0) g.lastIndex++;
  }
  return hits;
}
var PATH_EXPR = `(?:[^\\n"'#]|"[^"\\n]*"|'[^'\\n]*')*?`;
var SOURCE_CMD = `(?:^|[;&|{\\n])\\s*(?:then\\s+|do\\s+|else\\s+)?(?:\\.|source)\\s+`;
var ASSIGN_ANCHOR = `(?:^|[;&|{\\n])\\s*`;
var ACCESSOR_VAR_WINDOW = 2e3;
var CLAUSE = `[\\w$\\s{}*,]*?`;
function accessorRegexSource(stem) {
  const s = escapeRegExp(stem);
  const ext = `(?:\\.(?:ts|mjs|js))?`;
  const spec = `\\s*["'][^"']*?${s}${ext}["']`;
  return `(?:import\\s+${CLAUSE}(?<![\\w$.])from${spec}|export\\s+(?:type\\s+)?(?:\\{${CLAUSE}\\}|\\*(?:\\s+as\\s+[\\w$]+)?)\\s*(?<![\\w$.])from${spec}|import${spec}|import\\s*\\(${spec}|require\\s*\\(${spec}|${SOURCE_CMD}["']?${PATH_EXPR}${s}(?:\\.sh)?["']?|${ASSIGN_ANCHOR}([A-Za-z_][A-Za-z0-9_]*)=(["'])${PATH_EXPR}${s}(?:\\.sh)?\\2[\\s\\S]{0,${ACCESSOR_VAR_WINDOW}}?${SOURCE_CMD}["']?\\$\\{?\\1\\}?["']?)`;
}
function findPathConstants(root, files) {
  const re = /([A-Za-z0-9_]+)\s*=\s*(["'])(\.\.\/\.\.\/\.\.\/plugin\/scripts\/([A-Za-z0-9._-]+))\2/g;
  const out = [];
  for (const f of files) {
    if (!f.endsWith(".ts") && !f.endsWith(".js") && !f.endsWith(".mjs")) continue;
    const src = fs3.readFileSync(f, "utf8");
    const mask = tsCommentMask(src);
    let m;
    while ((m = re.exec(src)) !== null) {
      if (mask[m.index] !== 0) continue;
      const script = m[4];
      out.push({
        file: path4.relative(root, f),
        line: lineOf(src, m.index),
        name: m[1],
        script,
        targetExists: fs3.existsSync(path4.join(root, "plugin", "scripts", script))
      });
    }
  }
  return out;
}
var READ_PRIM = /readFile|<|cat\s+|open\s*\(/;
var COMPARE_PRIM = /grep\s+-q|\.includes\(|\.indexOf\(|\.match\(|basename\(|\.split\(|\.startsWith\(|\.endsWith\(|argv\[0\]/;
var COMPARE_METHOD = /\.(?:includes|indexOf|match|split|startsWith|endsWith)\(/;
var SHELL_CMP = /\bgrep\s+-q|\bcase\b[^\n]*\bin\b|=~|==|!=/;
var CHAIN_GAP = 40;
var SUBJECT_WINDOW = 400;
function readSubject(prefix) {
  const m = /(?:^|[^\w$.])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^=]*$/.exec(prefix) ?? /(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*=\s*[^=]*$/.exec(prefix);
  return m ? m[1] : null;
}
function subjectCompared(src, from, subj, isShell) {
  const win = src.slice(from, from + SUBJECT_WINDOW);
  const e = escapeRegExp(subj);
  if (new RegExp(`(?:^|[^\\w$.])${e}\\s*${COMPARE_METHOD.source}`).test(win)) return true;
  if (new RegExp(`basename\\(\\s*${e}\\b`).test(win)) return true;
  if (isShell) {
    const ref = new RegExp(`\\$\\{?${e}[\\}\\s"']`);
    for (const line of win.split("\n")) if (ref.test(line) && SHELL_CMP.test(line)) return true;
  }
  return false;
}
function boundToRead(src, at, prefix, suffix, isShell) {
  if (new RegExp(`^[^;\\n]{0,${CHAIN_GAP}}${COMPARE_METHOD.source}`).test(suffix)) return true;
  if (isShell && SHELL_CMP.test(suffix)) return true;
  const subj = readSubject(prefix);
  return subj !== null && subjectCompared(src, at, subj, isShell);
}
var REWRITE_CARVE_OUT_KINDS = ["test", "shell", "imports-leaf", "import-free-mjs"];
var KERNEL_LEAF_STEM = "kernel/proc-identity";
function isTestCarrier(relFile) {
  const segs = relFile.split("/");
  const base = segs[segs.length - 1] ?? "";
  if (segs.slice(0, -1).some((s) => s === "test" || s === "tests" || s === "__tests__" || s === "__test__")) {
    return true;
  }
  return /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(base);
}
function importsKernelLeaf(src, relFile) {
  const mask = maskFor(relFile)(src);
  const re = new RegExp(accessorRegexSource(KERNEL_LEAF_STEM));
  re.lastIndex = 0;
  return re.test(blankComments(src, mask));
}
var REPO_INTERNAL_SPECIFIER = /(?:^|[^\w$.])(?:import|export)\b[^;]*?\bfrom\s*["']\.{1,2}\/|(?:^|[^\w$.])import\s*\(\s*["']\.{1,2}\/|(?:^|[^\w$.])require\s*\(\s*["']\.{1,2}\/|(?:^|[^\w$.])import\s+["']\.{1,2}\//;
function isImportFreeMjs(src, relFile) {
  if (!relFile.endsWith(".mjs")) return false;
  const mask = maskFor(relFile)(src);
  return !REPO_INTERNAL_SPECIFIER.test(blankComments(src, mask));
}
function carveOutFor(src, relFile) {
  if (isTestCarrier(relFile)) {
    return { kind: "test", reason: "test carrier \u2014 \u5224\u636E\u4E0E\u88AB\u5224\u5BF9\u8C61\u5FC5\u987B\u72EC\u7ACB\u5B9E\u73B0 (G3), \u4E0D\u5F97\u5171\u4EAB\u88AB\u5224\u53F6\u5B50" };
  }
  if (relFile.endsWith(".sh")) {
    return { kind: "shell", reason: "shell carrier \u2014 .sh \u4E0D\u80FD import TS kernel leaf (\u6587\u6863\u5316 carve-out)" };
  }
  if (importsKernelLeaf(src, relFile)) {
    return {
      kind: "imports-leaf",
      reason: "already imports kernel/proc-identity.ts \u2014 \u6B8B\u4F59 /proc \u8BFB\u53D6\u4E0D\u662F\u88AB\u8FC1\u79FB\u5224\u5B9A\u7684\u72EC\u7ACB\u91CD\u5199"
    };
  }
  if (isImportFreeMjs(src, relFile)) {
    return {
      kind: "import-free-mjs",
      reason: "repo-import-free .mjs runtime helper \u2014 \u523B\u610F\u4E0D import \u4ED3\u5185 TS \u5185\u90E8\u4EF6 (\u72EC\u7ACB\u8FD0\u884C + \u8FDB\u5305\u4F53)"
    };
  }
  return null;
}
function classifyRewriteSite(root, relFile, src, disabled = []) {
  const text = src ?? fs3.readFileSync(path4.join(root, relFile), "utf8");
  const hit = carveOutFor(text, relFile);
  if (hit === null || disabled.includes(hit.kind)) {
    return { mergeable: true, carveOut: null, carveOutReason: null };
  }
  return { mergeable: false, carveOut: hit.kind, carveOutReason: hit.reason };
}
function isMergeableRewriteSite(root, relFile, src, disabled = []) {
  return classifyRewriteSite(root, relFile, src, disabled).mergeable;
}
function findJudgmentRewrites(root, files, opts = {}) {
  const procPath = /\/proc\/[^'"\s\n]*\/cmdline/;
  const constructed = /(?:procRoot|procDir)[^'"\n]{0,60}["']cmdline["']/;
  const out = [];
  for (const f of files) {
    const src = fs3.readFileSync(f, "utf8");
    const mask = maskFor(f)(src);
    const isShell = f.endsWith(".sh");
    if (codeMatch(src, mask, COMPARE_PRIM).length === 0) continue;
    let found = false;
    let hitLine = 0;
    const scan = (re) => {
      const g = new RegExp(re.source, "g");
      let m;
      while ((m = g.exec(src)) !== null) {
        if (mask[m.index] !== 0) continue;
        const lineStart = src.lastIndexOf("\n", m.index) + 1;
        let lineEnd = src.indexOf("\n", m.index);
        if (lineEnd === -1) lineEnd = src.length;
        const prefix = src.slice(lineStart, m.index);
        if (!READ_PRIM.test(prefix)) continue;
        if (!boundToRead(src, m.index, prefix, src.slice(m.index, lineEnd), isShell)) continue;
        hitLine = lineOf(src, m.index);
        found = true;
        return;
      }
    };
    scan(procPath);
    if (!found) scan(constructed);
    if (found) {
      const rel = path4.relative(root, f);
      const cls = classifyRewriteSite(root, rel, src, opts.disabledCarveOuts ?? []);
      out.push({
        file: rel,
        line: hitLine,
        mergeable: cls.mergeable,
        carveOut: cls.carveOut,
        carveOutReason: cls.carveOutReason
      });
    }
  }
  return out;
}
function findMergeableJudgmentRewrites(root, files, opts = {}) {
  return findJudgmentRewrites(root, files, opts).filter((j) => j.mergeable);
}
function mirrorDirNames(dir) {
  try {
    const entries = fs3.readdirSync(dir, { withFileTypes: true });
    return {
      regular: new Set(entries.filter((d) => d.isFile()).map((d) => d.name)),
      all: new Set(entries.map((d) => d.name))
    };
  } catch {
    return { regular: /* @__PURE__ */ new Set(), all: /* @__PURE__ */ new Set() };
  }
}
function findByteIdenticalPairs(root) {
  const scriptsDir = path4.join(root, "plugin", "scripts");
  const exps = [];
  const expRoot = path4.join(root, "experiments");
  if (fs3.existsSync(expRoot)) {
    for (const e of fs3.readdirSync(expRoot, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const s = path4.join(expRoot, e.name, "scripts");
      if (fs3.existsSync(s)) exps.push({ dir: s, ...mirrorDirNames(s) });
    }
  }
  const pairs = [];
  let totalLines = 0;
  let symlinksSkipped = 0;
  let names = [];
  try {
    names = fs3.readdirSync(scriptsDir, { withFileTypes: true }).filter((d) => d.isFile() && /\.(ts|sh|mjs)$/.test(d.name)).map((d) => d.name).sort();
  } catch {
    return { pairs, totalLines, symlinksSkipped };
  }
  for (const name of names) {
    const pluginFile = path4.join(scriptsDir, name);
    const pluginBuf = fs3.readFileSync(pluginFile);
    for (const { dir, regular, all } of exps) {
      if (!regular.has(name)) {
        if (all.has(name)) symlinksSkipped++;
        continue;
      }
      const cand = path4.join(dir, name);
      const candBuf = fs3.readFileSync(cand);
      if (pluginBuf.equals(candBuf)) {
        const lines = pluginBuf.toString("utf8").split("\n").length - 1;
        pairs.push({ plugin: `plugin/scripts/${name}`, experiment: path4.relative(root, cand), lines });
        totalLines += lines;
      }
    }
  }
  return { pairs, totalLines, symlinksSkipped };
}
function isPathInvocationMention(src, idx, entity) {
  const prev = idx > 0 ? src[idx - 1] : "";
  if (prev === "/" || prev === "\\") return true;
  if (prev !== '"' && prev !== "'") return false;
  if (src[idx + entity.length] !== prev) return false;
  let p = idx - 2;
  while (p >= 0 && (src[p] === " " || src[p] === "	" || src[p] === "\n" || src[p] === "\r")) p--;
  const before = p >= 0 ? src[p] : "";
  return before === "(" || before === "," || before === "[";
}
var OCCURRENCE_ROLES = ["name-value", "text", "by-path", "comment"];
function stringSpans(src, mask) {
  const spans = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    if (mask[i] === 1) {
      i++;
      continue;
    }
    const q = src[i];
    if (q !== '"' && q !== "'" && q !== "`") {
      i++;
      continue;
    }
    const start = i;
    i++;
    let closed = false;
    while (i < n) {
      if (mask[i] === 1) {
        i++;
        continue;
      }
      if (src[i] === "\\") {
        i += 2;
        continue;
      }
      if (src[i] === "\n" && q !== "`") break;
      if (src[i] === q) {
        i++;
        closed = true;
        break;
      }
      i++;
    }
    if (closed) spans.push({ start, end: i });
  }
  return spans;
}
var _spanCache = /* @__PURE__ */ new WeakMap();
function stringSpansOf(src, mask) {
  const hit = _spanCache.get(mask);
  if (hit !== void 0 && hit.src === src) return hit.spans;
  const spans = stringSpans(src, mask);
  _spanCache.set(mask, { src, spans });
  return spans;
}
var SCRIPT_NAME_WORD = /^[\w./-]+\.(?:sh|ts|mjs|js)$/;
function stripWordPunct(w) {
  return w.replace(/^[([{]+/, "").replace(/[)\]},;:]+$/, "");
}
function logicalLineWords(blanked, idx) {
  let ls = blanked.lastIndexOf("\n", idx) + 1;
  for (let guard = 0; guard < 200 && ls > 0; guard++) {
    const prevStart = blanked.lastIndexOf("\n", ls - 2) + 1;
    if (!/\\\s*$/.test(blanked.slice(prevStart, ls - 1))) break;
    ls = prevStart;
  }
  let le = blanked.indexOf("\n", idx);
  if (le === -1) le = blanked.length;
  for (let guard = 0; guard < 200 && /\\\s*$/.test(blanked.slice(ls, le)); guard++) {
    const next = blanked.indexOf("\n", le + 1);
    if (next === -1) {
      le = blanked.length;
      break;
    }
    le = next;
  }
  const words = [];
  const re = /\S+/g;
  let m;
  const text = blanked.slice(ls, le);
  while ((m = re.exec(text)) !== null) words.push(m[0]);
  return { words, at: idx - ls };
}
function bareWordRole(blanked, idx, entity) {
  const before = blanked.slice(blanked.lastIndexOf("\n", idx) + 1, idx);
  if (/[A-Za-z_][A-Za-z0-9_]*=["']?$/.test(before)) return "name-value";
  const { words, at } = logicalLineWords(blanked, idx);
  let mine = -1;
  let offset = 0;
  for (let k = 0; k < words.length; k++) {
    const w = words[k];
    if (at >= offset && at < offset + w.length) {
      mine = k;
      break;
    }
    offset += w.length + 1;
  }
  if (mine === -1) return "text";
  if (stripWordPunct(words[mine]) !== entity) return "text";
  for (const nb of [words[mine - 1], words[mine + 1]]) {
    if (nb !== void 0 && SCRIPT_NAME_WORD.test(stripWordPunct(nb))) return "name-value";
  }
  return "text";
}
function occurrenceRole(src, mask, blanked, idx, entity) {
  if (mask[idx] !== 0) return "comment";
  if (isPathInvocationMention(src, idx, entity)) return "by-path";
  const sp = stringSpansOf(src, mask).find((s) => idx > s.start && idx < s.end);
  if (sp !== void 0) {
    return src.slice(sp.start + 1, sp.end - 1).trim() === entity ? "name-value" : "text";
  }
  return bareWordRole(blanked, idx, entity);
}
function matchEntity(src, mask, blanked, accessorRe, entity) {
  accessorRe.lastIndex = 0;
  const accessor = accessorRe.test(blanked);
  const evidenceLines = [];
  let anyMention = false;
  let anyNaming = false;
  let idx = 0;
  while ((idx = src.indexOf(entity, idx)) !== -1) {
    const role = occurrenceRole(src, mask, blanked, idx, entity);
    if (role === "name-value" || role === "text") anyMention = true;
    if (role === "name-value") {
      anyNaming = true;
      if (evidenceLines.length < HARDCODED_SAMPLE_LIMIT) {
        const lineStart = src.lastIndexOf("\n", idx) + 1;
        let lineEnd = src.indexOf("\n", idx);
        if (lineEnd === -1) lineEnd = src.length;
        evidenceLines.push({ line: lineOf(src, idx), text: src.slice(lineStart, lineEnd).trim().slice(0, 120) });
      }
    }
    if (evidenceLines.length >= HARDCODED_SAMPLE_LIMIT) break;
    idx += entity.length;
  }
  return { code: accessor || anyMention, naming: anyNaming, accessor, evidenceLines };
}
var HARDCODED_SAMPLE_LIMIT = 3;
function literalReplication(root, files, entity) {
  const stem = entity.replace(/\.(ts|sh|mjs|js)$/, "");
  const codeFiles = [];
  const hardcodedSamples = [];
  let full = 0;
  let code = 0;
  let accessor = 0;
  let hardcoded = 0;
  const accessorRe = new RegExp(accessorRegexSource(stem));
  for (const f of files) {
    const src = fs3.readFileSync(f, "utf8");
    if (!src.includes(entity)) continue;
    full++;
    const mask = maskFor(f)(src);
    const m = matchEntity(src, mask, blankComments(src, mask), accessorRe, entity);
    if (m.code) code++;
    if (m.accessor) {
      accessor++;
      codeFiles.push(path4.relative(root, f));
    } else if (m.naming) {
      hardcoded++;
      codeFiles.push(path4.relative(root, f));
      for (const e of m.evidenceLines.slice(0, HARDCODED_SAMPLE_LIMIT)) {
        if (hardcodedSamples.length < HARDCODED_SAMPLE_LIMIT) {
          hardcodedSamples.push(`${path4.relative(root, f)}:${e.line}  ${e.text}`);
        }
      }
    }
  }
  return { entity, full, code, accessor, hardcoded, codeFiles, hardcodedSamples };
}
function replicationTable(root, files, entities) {
  const rows = entities.map((e) => ({
    entity: e,
    full: 0,
    code: 0,
    accessor: 0,
    hardcoded: 0,
    codeFiles: [],
    hardcodedSamples: []
  }));
  const stems = rows.map((r) => r.entity.replace(/\.(ts|sh|mjs|js)$/, ""));
  const accessorRes = stems.map((s) => new RegExp(accessorRegexSource(s)));
  for (const f of files) {
    const src = fs3.readFileSync(f, "utf8");
    const rel = path4.relative(root, f);
    const mask = maskFor(f)(src);
    const blanked = blankComments(src, mask);
    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri];
      if (!src.includes(row.entity)) continue;
      row.full++;
      const m = matchEntity(src, mask, blanked, accessorRes[ri], row.entity);
      if (m.code) row.code++;
      if (m.accessor) {
        row.accessor++;
        row.codeFiles.push(rel);
      } else if (m.naming) {
        row.hardcoded++;
        row.codeFiles.push(rel);
        for (const e of m.evidenceLines.slice(0, HARDCODED_SAMPLE_LIMIT)) {
          if (row.hardcodedSamples.length < HARDCODED_SAMPLE_LIMIT) {
            row.hardcodedSamples.push(`${rel}:${e.line}  ${e.text}`);
          }
        }
      }
    }
  }
  return rows;
}
function isFlagged(row, threshold = 5) {
  const hardcoded = row.hardcoded ?? 0;
  const accessor = row.accessor ?? 0;
  return hardcoded >= threshold && hardcoded > accessor;
}
function sharedModuleControl(root, files, entity, threshold = 5) {
  const r = literalReplication(root, files, entity);
  const flagged = isFlagged(r, threshold);
  return {
    entity,
    importAccessor: r.accessor,
    hardcoded: r.hardcoded,
    flagged,
    sampleFiles: r.codeFiles.slice(0, 5)
  };
}
function run(root, limit, opts = {}) {
  const files = walkCodeFiles(root).filter(
    (f) => !f.endsWith("/identity-replication-check.ts") && !f.endsWith("/identity-replication-check.test.mjs")
  );
  const pathConstants = findPathConstants(root, files);
  const detectedRewrites = findJudgmentRewrites(root, files, opts);
  const judgmentRewrites = detectedRewrites.filter((j) => j.mergeable);
  const judgmentRewriteCarveOuts = detectedRewrites.filter((j) => !j.mergeable);
  const byteIdenticalRaw = findByteIdenticalPairs(root);
  const sessionLiveness = literalReplication(root, files, "session-liveness.sh");
  const gateScriptBase = literalReplication(root, files, "gate-script-base.ts");
  const sharedModule = sharedModuleControl(root, files, "gate-script-base.ts");
  let entities = [];
  try {
    entities = fs3.readdirSync(path4.join(root, "plugin", "scripts")).filter((n) => /\.(ts|sh|mjs)$/.test(n)).sort();
  } catch {
    entities = [];
  }
  const table = replicationTable(root, files, entities).filter((r) => r.code > 0).sort((a, b) => b.code - a.code || b.full - a.full).slice(0, limit);
  return {
    root,
    pathConstants,
    judgmentRewrites,
    judgmentRewriteCarveOuts,
    byteIdentical: {
      count: byteIdenticalRaw.pairs.length,
      totalLines: byteIdenticalRaw.totalLines,
      pairs: byteIdenticalRaw.pairs,
      symlinksSkipped: byteIdenticalRaw.symlinksSkipped
    },
    literalReplication: { sessionLiveness, gateScriptBase },
    sharedModuleControl: sharedModule,
    table
  };
}
function usage() {
  console.error(
    `usage: node --experimental-strip-types identity-replication-check.ts [--root <dir>] [--json] [--limit <n>]
                                        [--no-carve-out <kind>[,<kind>\u2026]]
  --root <dir>   repo to scan (default: repo-root.ts resolution)
  --limit <n>    max rows in the human literal-replication table (default 25)
  --json         emit the full report as JSON
  --no-carve-out disable one non-mergeable-site rule (repeatable). kinds: ${REWRITE_CARVE_OUT_KINDS.join(", ")}
                 (disabling a rule moves its sites back into \`judgmentRewrites\` \u2014 the two-state check)
Exit: 0 = report produced (observer, not a pass/fail gate); 2 = usage/environment error.`
  );
  process.exit(0);
}
function collectDisabledCarveOuts(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--no-carve-out") continue;
    const raw = args[i + 1];
    if (raw === void 0 || raw.startsWith("--")) {
      console.error("ERROR: --no-carve-out needs a kind");
      process.exit(2);
    }
    for (const part of raw.split(",")) {
      const kind = part.trim();
      if (!REWRITE_CARVE_OUT_KINDS.includes(kind)) {
        console.error(`ERROR: unknown carve-out kind "${kind}" \u2014 one of: ${REWRITE_CARVE_OUT_KINDS.join(", ")}`);
        process.exit(2);
      }
      out.push(kind);
    }
  }
  return out;
}
function printHuman(report) {
  console.log("identity-replication-check \u2014 P2 \u8EAB\u4EFD\u590D\u5236\u68C0\u6D4B\u5668 (docs/proposals/archguard-generation-era-primitives.md \xA73)");
  console.log("root:", report.root);
  console.log(`
== \u8DEF\u5F84\u5B57\u9762\u91CF\u5E38\u91CF (AC1) \u2014 ${report.pathConstants.length} \u4E2A *_REL \u5E38\u91CF\u786C\u7F16\u7801 plugin \u811A\u672C\u76F8\u5BF9\u8DEF\u5F84 ==`);
  for (const c of report.pathConstants) {
    const mark = c.targetExists ? "" : "  [target MISSING]";
    console.log(`  ${c.file}:${c.line}  ${c.name} = ".../plugin/scripts/${c.script}"${mark}`);
  }
  if (report.pathConstants.length === 0) console.log("  (none)");
  console.log(
    `
== \u5224\u5B9A\u91CD\u5199 (AC2) \u2014 \u8BFB /proc/<pid>/cmdline \u2227 \u6BD4\u8F83\u540D\u5B57 (\u8BC6\u522B\u8FDB\u7A0B) \u2014 **\u53EF\u5408\u5E76\u5230 kernel leaf** ${report.judgmentRewrites.length} \u5904 ==`
  );
  for (const j of report.judgmentRewrites) console.log(`  ${j.file}:${j.line}`);
  if (report.judgmentRewrites.length === 0) {
    console.log("  (none \u2014 \u68C0\u6D4B\u5230\u7684\u7AD9\u70B9\u5168\u90E8\u843D\u5728 carve-out \u91CC; \u89C1\u4E0B\u4E00\u8282, \u5B83\u4EEC\u6CA1\u6709\u88AB\u5220\u6389)");
  }
  console.log(
    `
== \u5224\u5B9A\u91CD\u5199\u7684 carve-out (\u68C0\u6D4B\u5230\u4F46\u7ED3\u6784\u4E0A\u4E0D\u53EF\u5408\u5E76, \u5E26\u7406\u7531) \u2014 ${report.judgmentRewriteCarveOuts.length} \u5904 ==`
  );
  for (const j of report.judgmentRewriteCarveOuts) {
    console.log(`  ${j.file}:${j.line}  [${j.carveOut}] ${j.carveOutReason}`);
  }
  if (report.judgmentRewriteCarveOuts.length === 0) console.log("  (none)");
  console.log(
    `
== \u5B57\u8282\u5B8C\u5168\u76F8\u540C\u6587\u4EF6\u5BF9 (AC3) \u2014 ${report.byteIdentical.count} \u5BF9 / ${report.byteIdentical.totalLines} \u884C (\u8DF3\u8FC7 ${report.byteIdentical.symlinksSkipped} \u4E2A\u8F6F\u94FE\u6761\u76EE: \u5355\u4E00\u6765\u6E90\u5F15\u7528, \u975E pair) ==`
  );
  for (const p of report.byteIdentical.pairs.slice(0, 5)) console.log(`  ${p.plugin}  ==  ${p.experiment}  (${p.lines} \u884C)`);
  if (report.byteIdentical.count > 5) console.log(`  \u2026 \u53CA\u53E6\u5916 ${report.byteIdentical.count - 5} \u5BF9`);
  console.log(`
== \u5B57\u9762\u91CF\u590D\u5236\u5EA6 (AC5) \u2014 \u5168\u6587 vs \u4EE3\u7801\u4F4D\u7F6E\u5206\u5217 (\u5254\u9664\u6CE8\u91CA/\u6587\u6863) ==`);
  const sl = report.literalReplication.sessionLiveness;
  console.log(`  session-liveness.sh: full=${sl.full}  code=${sl.code}  (accessor=${sl.accessor}  hardcoded=${sl.hardcoded})`);
  console.log(`    code \u547D\u4E2D\u6837\u672C: ${sl.codeFiles.slice(0, 5).join(", ") || "(none \u2014 \u5B9E\u4F53\u5DF2\u9000\u4F11, \u6B8B\u7559\u5F15\u7528\u5747\u5728\u6CE8\u91CA/\u6587\u6863/\u9000\u4F11\u65AD\u8A00\u5185)"}`);
  console.log(`
== \u5171\u4EAB\u6A21\u5757\u8D1F\u63A7\u5236 (AC4) \u2014 gate-script-base.ts ==`);
  const sm = report.sharedModuleControl;
  console.log(`  import \u5355\u4E00\u8BBF\u95EE\u5668=${sm.importAccessor}  \u786C\u7F16\u7801=${sm.hardcoded}  flagged=${sm.flagged}`);
  console.log(`
== \u5168\u91CF\u5B57\u9762\u91CF\u590D\u5236\u5EA6\u8868 (code \u4F4D\u7F6E\u8BA1\u6570 > 0, top ${report.table.length}) ==`);
  for (const r of report.table) {
    const flagged = isFlagged(r);
    console.log(
      `  ${r.entity.padEnd(44)} code=${String(r.code).padStart(3)}  full=${String(r.full).padStart(3)}  accessor=${r.accessor}  hardcoded=${r.hardcoded}${flagged ? "  <<FLAGGED" : ""}`
    );
    if (flagged) {
      for (const s of r.hardcodedSamples) console.log(`        sample: ${s}`);
      if (r.hardcodedSamples.length === 0) {
        console.log("        sample: (none \u2014 \u5224\u7EA2\u5374\u53D6\u4E0D\u51FA\u6837\u672C \u21D2 \u5224\u636E\u6545\u969C, \u4E0D\u662F\u300C\u6CA1\u6709\u590D\u5236\u300D)");
      }
    }
  }
}
function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) usage();
  const asJson = args.includes("--json");
  const rootArg = flagValue(args, "--root");
  const limitArg = flagValue(args, "--limit");
  const limit = limitArg ? Number(limitArg) : 25;
  if (limitArg && (!Number.isInteger(limit) || limit < 1)) {
    console.error("ERROR: --limit must be a positive integer");
    process.exit(2);
  }
  const root = rootArg ? path4.resolve(rootArg) : repoRoot();
  if (!fs3.existsSync(path4.join(root, "plugin", "scripts"))) {
    console.error(`ERROR: plugin/scripts not found under ${root} \u2014 is --root correct?`);
    process.exit(2);
  }
  const report = run(root, limit, { disabledCarveOuts: collectDisabledCarveOuts(args) });
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHuman(report);
  }
  return 0;
}
if (isDirectEntry(import.meta, void 0, "identity-replication-check")) {
  process.exitCode = main(process.argv);
}
export {
  HARDCODED_SAMPLE_LIMIT,
  OCCURRENCE_ROLES,
  REWRITE_CARVE_OUT_KINDS,
  accessorRegexSource,
  blankComments,
  classifyRewriteSite,
  findByteIdenticalPairs,
  findJudgmentRewrites,
  findMergeableJudgmentRewrites,
  findPathConstants,
  isFlagged,
  isMergeableRewriteSite,
  isPathInvocationMention,
  literalReplication,
  main,
  matchEntity,
  occurrenceRole,
  replicationTable,
  run,
  shCommentMask,
  sharedModuleControl,
  tsCommentMask,
  walkCodeFiles
};
