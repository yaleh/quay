import { createRequire } from "node:module"; const require = createRequire(import.meta.url);
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// packages/quay/src/runtime-artifacts.ts
var runtime_artifacts_exports = {};
__export(runtime_artifacts_exports, {
  classifyRuntimeArtifactDirty: () => classifyRuntimeArtifactDirty,
  isRuntimeArtifactPath: () => isRuntimeArtifactPath,
  loadRuntimeArtifactPatterns: () => loadRuntimeArtifactPatterns,
  runtimeArtifactAreaPattern: () => runtimeArtifactAreaPattern,
  runtimeArtifactManifestPath: () => runtimeArtifactManifestPath,
  runtimeArtifactPatternRe: () => runtimeArtifactPatternRe
});
import fs4 from "node:fs";
import path5 from "node:path";
function runtimeArtifactManifestPath(scriptsDir) {
  if (!scriptsDir) return null;
  const candidates = [path5.join(scriptsDir, RUNTIME_ARTIFACT_MANIFEST_BASENAME)];
  if (path5.basename(scriptsDir) === "dist") {
    candidates.push(path5.join(path5.dirname(scriptsDir), RUNTIME_ARTIFACT_MANIFEST_BASENAME));
  }
  for (const c of candidates) if (fs4.existsSync(c)) return c;
  return null;
}
function loadRuntimeArtifactPatterns(scriptsDir) {
  const p = runtimeArtifactManifestPath(scriptsDir);
  if (!p) return null;
  try {
    return fs4.readFileSync(p, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("#"));
  } catch {
    return null;
  }
}
function runtimeArtifactPatternRe(pattern) {
  let p = pattern.trim();
  if (p.endsWith("/")) p = p.replace(/\/+$/, "");
  let out = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*") {
      if (p[i + 1] === "*") {
        i++;
        if (p[i + 1] === "/") {
          i++;
          out += "(?:.*/)?";
        } else {
          out += ".*";
        }
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(c)) {
      out += "\\" + c;
    } else {
      out += c;
    }
  }
  return new RegExp(`^${out}(?:/.*)?$`);
}
function isRuntimeArtifactPath(relPath, patterns) {
  const p = relPath.replace(/\/+$/, "");
  return patterns.some((pat) => runtimeArtifactPatternRe(pat).test(p));
}
function runtimeArtifactAreaPattern(relPath, patterns) {
  const p = relPath.replace(/\/+$/, "");
  if (p === "") return null;
  for (const pat of patterns) {
    const staticPrefix = pat.split("*")[0].replace(/\/+$/, "");
    if (staticPrefix === "") continue;
    if (staticPrefix === p || staticPrefix.startsWith(p + "/")) return pat;
  }
  return null;
}
function classifyRuntimeArtifactDirty(dirtyPaths, patterns) {
  if (!patterns || patterns.length === 0) return [];
  const hits = [];
  for (const raw of dirtyPaths) {
    const p = raw.replace(/\/+$/, "");
    if (p === "") continue;
    const pattern = patterns.find((pat) => runtimeArtifactPatternRe(pat).test(p)) ?? null;
    const area = pattern ? null : runtimeArtifactAreaPattern(p, patterns);
    if (pattern || area) hits.push({ path: p, pattern, area });
  }
  return hits;
}
var RUNTIME_ARTIFACT_MANIFEST_BASENAME;
var init_runtime_artifacts = __esm({
  "packages/quay/src/runtime-artifacts.ts"() {
    RUNTIME_ARTIFACT_MANIFEST_BASENAME = "quay-runtime-artifacts.txt";
  }
});

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/touches-orthogonality-check.ts
import fs5 from "node:fs";

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

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/touches-orthogonality-check.ts
import path6 from "node:path";
import { fileURLToPath as fileURLToPath3 } from "node:url";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
import path2 from "node:path";
function helpExit(usage2) {
  process.stdout.write(usage2.endsWith("\n") ? usage2 : usage2 + "\n");
  process.exit(0);
}
function isDirectEntry(importMeta, argv1, expectedBase) {
  void importMeta;
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  return path2.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/core-src-import.ts
import fs2 from "node:fs";
import path3 from "node:path";
import { fileURLToPath as fileURLToPath2, pathToFileURL } from "node:url";
var HERE = path3.dirname(fileURLToPath2(import.meta.url));
var MAX_DEPTH2 = 8;
function resolveCoreSrcFile(rel, startDir = HERE) {
  let dir = path3.resolve(startDir);
  for (let i = 0; i < MAX_DEPTH2; i++) {
    const repoTree = path3.join(dir, "packages", "quay", "src", rel);
    if (fs2.existsSync(repoTree)) return repoTree;
    const staged = path3.join(dir, "src", rel);
    if (fs2.existsSync(staged)) return staged;
    const parent = path3.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
async function acquireCoreSrc(primary, rel) {
  try {
    return await primary();
  } catch (err) {
    if (err?.code !== "ERR_MODULE_NOT_FOUND") throw err;
    const fallback = resolveCoreSrcFile(rel);
    if (!fallback) throw err;
    try {
      return await import(pathToFileURL(fallback).href);
    } catch {
      throw err;
    }
  }
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/fs-walk.ts
import fs3 from "node:fs";
import path4 from "node:path";
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
  if (!fs3.existsSync(root)) return out;
  const isVisible = (abs, isDir) => {
    if (!visible || !visibleDirs) return true;
    const rel = path4.relative(visible.root, abs).split(path4.sep).join("/");
    return isDir ? visibleDirs.has(rel) : visible.paths.has(rel);
  };
  const record = (abs) => {
    out.push(absolute ? abs : path4.relative(root, abs).split(path4.sep).join("/"));
  };
  const walk = (dir, depth) => {
    let entries;
    try {
      entries = fs3.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      let isDir;
      if (entryKind === "dirent") {
        isDir = e.isDirectory();
      } else {
        try {
          isDir = fs3.statSync(path4.join(dir, e.name)).isDirectory();
        } catch {
          continue;
        }
      }
      if (prune && prune(e.name, isDir)) continue;
      const abs = path4.join(dir, e.name);
      if (!isVisible(abs, isDir)) continue;
      if (isDir) {
        if (depth < maxDepth) walk(abs, depth + 1);
        continue;
      }
      const ext = path4.extname(e.name);
      if (!include || include(e.name, ext, entryKind === "dirent" ? e : null)) record(abs);
    }
  };
  walk(root, 1);
  return wantSort ? out.sort() : out;
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/touches-parser.ts
function stripTouchAnnotation(entry) {
  let s = String(entry);
  const t = s.trimEnd();
  const i = t.length - 1;
  if (t[i] === "\uFF09") {
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
    if (open !== -1) {
      let k = open;
      while (k > 0 && /\s/.test(t[k - 1])) k--;
      s = t.slice(0, k);
    }
  }
  return s.replace(/\s*\([^)]*\)\s*$/, "").trim();
}
function parseTouchEntries(touchesSection) {
  if (!touchesSection) return [];
  return touchesSection.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[-*]\s+/.test(l)).map((l) => l.replace(/^[-*]\s+/, "").trim()).map((l) => l.replace(/^[`"'']+|[`"'']+$/g, "").trim()).map(stripTouchAnnotation).map((l) => l.replace(/^[`"'']+|[`"'']+$/g, "").trim()).map((l) => l.replace(/^\.\//, "").trim()).filter(Boolean);
}
function tagFromAnnotation(text) {
  const a = String(text ?? "").trim().toLowerCase();
  if (a === "new") return "new";
  if (a === "delete" || a === "deleted") return "delete";
  return null;
}
function parseTouchEntriesWithTags(touchesSection) {
  if (!touchesSection) return [];
  const out = [];
  for (const raw of String(touchesSection).split(/\r?\n/)) {
    const line = raw.trim();
    const m = line.match(/^[-*]\s+(.+)$/);
    if (!m) continue;
    let entry = m[1].trim();
    entry = entry.replace(/^[`"'']+|[`"'']+$/g, "").trim();
    let tag = tagFromAnnotation(entry.match(/\s*\(([^)]*)\)\s*$/)?.[1]);
    if (!tag) {
      const beforeFullWidth = entry.match(/\s*\(([^)]*)\)\s*[（]/);
      tag = tagFromAnnotation(beforeFullWidth?.[1]);
    }
    const stripped = stripTouchAnnotation(entry);
    const cleaned = stripped.replace(/^[`"'']+|[`"'']+$/g, "").trim();
    const path7 = cleaned.replace(/^\.\//, "").trim();
    if (!path7) continue;
    out.push({ path: path7, tag });
  }
  return out;
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

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/touches-orthogonality-check.ts
var { isRuntimeArtifactPath: isRuntimeArtifactPath2, loadRuntimeArtifactPatterns: loadRuntimeArtifactPatterns2 } = await acquireCoreSrc(
  () => Promise.resolve().then(() => (init_runtime_artifacts(), runtime_artifacts_exports)),
  "runtime-artifacts.ts"
);
var OVERBROAD = /* @__PURE__ */ new Set(["**", "*", "**/*", "./**", "**/**"]);
function normalizePath(p) {
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
function isOverbroadDeclaration(glob) {
  const g = normalizePath(glob);
  if (g === "" || OVERBROAD.has(g)) return true;
  let concrete = 0;
  for (const seg of g.split("/")) {
    if (/[*?]/.test(seg)) return concrete < 2;
    concrete++;
  }
  return false;
}
function parseTouches(text) {
  const { hasSection, section } = extractTouchesSection(text);
  const globs = parseTouchEntries(section).map((g) => {
    if (g && g.endsWith("/") && !/[*?]/.test(g)) g += "**";
    return g;
  });
  return { hasSection, globs };
}
var MATCH_RE_CACHE = /* @__PURE__ */ new Map();
function matchGlob(glob, filePath) {
  let re = MATCH_RE_CACHE.get(glob);
  if (re === void 0) {
    re = globToRegExp(glob);
    MATCH_RE_CACHE.set(glob, re);
  }
  return re.test(filePath);
}
function globToRegExp(glob) {
  let re = "";
  const g = String(glob);
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*") {
      if (g[i + 1] === "*") {
        i++;
        if (g[i + 1] === "/") i++;
        re += ".*";
      } else {
        re += "[^/]*";
      }
    } else if ("\\^$.|?+()[]{}".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}
var SKIP_DIRS = /* @__PURE__ */ new Set([".git", "node_modules", ".quay"]);
function walkFiles2(root) {
  const rels = walkFiles(root, {
    sort: false,
    prune: (name, isDir) => isDir && SKIP_DIRS.has(name),
    include: (_name, _ext, entry) => entry.isFile() || entry.isSymbolicLink()
  });
  return rels.filter((rel) => {
    try {
      return fs5.statSync(path6.join(root, rel)).isFile();
    } catch {
      return false;
    }
  });
}
function expandGlobs(globs, root, files = null) {
  const all = files ?? walkFiles2(root);
  const set = /* @__PURE__ */ new Set();
  for (const g of globs) {
    for (const f of all) if (matchGlob(g, f)) set.add(f);
  }
  return set;
}
function filesDisjoint(setA, setB) {
  const overlaps = [];
  for (const f of setA) if (setB.has(f)) overlaps.push(f);
  overlaps.sort();
  return { disjoint: overlaps.length === 0, overlaps };
}
function checkTouchesPair(parsedA, parsedB, expand) {
  for (const [p, who] of [[parsedA, "A"], [parsedB, "B"]]) {
    if (!p.hasSection || p.globs.length === 0) {
      return { disjoint: false, overlaps: [], reason: `conservative: side ${who} declares no/empty ## Touches \u2192 serialize` };
    }
    const bad = p.globs.find((g) => isOverbroadDeclaration(g));
    if (bad) {
      return { disjoint: false, overlaps: [], reason: `conservative: side ${who} has overbroad glob "${bad}" \u2192 serialize` };
    }
  }
  const setA = expand(parsedA.globs);
  const setB = expand(parsedB.globs);
  if (setA.size === 0 || setB.size === 0) {
    const who = setA.size === 0 ? "A" : "B";
    return { disjoint: false, overlaps: [], reason: `conservative: side ${who} globs matched nothing (empty expansion \u2014 likely a typo) \u2192 serialize` };
  }
  const { disjoint, overlaps } = filesDisjoint(setA, setB);
  return { disjoint, overlaps, reason: disjoint ? "disjoint file-sets" : "overlapping file-sets" };
}
function checkOuterInflight(parsed, outerInflightFiles, expand) {
  if (!outerInflightFiles || outerInflightFiles.length === 0) {
    return { blocked: [], ok: true };
  }
  const taskSet = expand(parsed.globs);
  const blocked = [];
  for (const f of outerInflightFiles) {
    const hasWildcard = /[*?]/.test(f);
    if (hasWildcard || f.endsWith("/")) {
      const glob = f.endsWith("/") && !hasWildcard ? `${f}**` : f;
      for (const m of expand([glob])) if (taskSet.has(m)) blocked.push(m);
    } else {
      const p = normalizePath(f);
      if (taskSet.has(p)) blocked.push(p);
    }
  }
  blocked.sort();
  return { blocked, ok: blocked.length === 0 };
}
function checkDispatchEligibility(parsedA, parsedB, outerInflightFiles, expand) {
  const pair = checkTouchesPair(parsedA, parsedB, expand);
  if (!pair.disjoint) return pair;
  for (const [parsed, who] of [[parsedA, "A"], [parsedB, "B"]]) {
    const oc = checkOuterInflight(parsed, outerInflightFiles, expand);
    if (!oc.ok) {
      return { disjoint: false, overlaps: oc.blocked, reason: `outer-inflight occupancy: side ${who} touches ${oc.blocked.join(", ")} \u2192 serialize (outer owns it in flight)` };
    }
  }
  return pair;
}
function checkBenignRuntimeDirty(taskBody, dirtyPaths, rtPatterns = []) {
  if (!dirtyPaths || dirtyPaths.length === 0) {
    return { benign: false, reason: "no dirty paths to classify", violations: [] };
  }
  const { hasSection, globs } = parseTouches(taskBody);
  if (!hasSection || globs.length === 0) {
    return { benign: false, reason: "conservative: task declares no/empty ## Touches \u2192 cannot prove the dirty path is outside its write surface", violations: [] };
  }
  const overbroad = globs.find((g) => isOverbroadDeclaration(g));
  if (overbroad) {
    return { benign: false, reason: `conservative: overbroad glob "${overbroad}" \u2192 cannot prove disjoint`, violations: [] };
  }
  const patterns = Array.isArray(rtPatterns) ? rtPatterns : [];
  const violations = [];
  for (const raw of dirtyPaths) {
    const p = normalizePath(raw);
    const underDotQuay = p === ".quay" || p.startsWith(".quay/");
    const isQuayRuntimeArtifact = !underDotQuay && patterns.length > 0 && isRuntimeArtifactPath2(p, patterns);
    if (!underDotQuay && !isQuayRuntimeArtifact) {
      violations.push({ path: raw, why: patterns.length === 0 ? "not under .quay/" : "not under .quay/ and matches no pattern of the runtime-artifact manifest" });
      continue;
    }
    const hit = globs.find((g) => matchGlob(g, p));
    if (hit) violations.push({ path: raw, why: `matches task ## Touches glob "${hit}"` });
  }
  if (violations.length > 0) {
    return { benign: false, reason: "dirty paths are not all untracked quay runtime files (`.quay/` or a runtime-artifact-manifest pattern) outside the task's ## Touches", violations };
  }
  return { benign: true, reason: "all dirty paths are untracked quay runtime files (`.quay/` or a runtime-artifact-manifest pattern) outside the task's ## Touches", violations: [] };
}
function touchExists(p, root) {
  const hasWildcard = /[*?]/.test(p);
  const glob = p.endsWith("/") && !hasWildcard ? `${p}**` : p;
  if (hasWildcard || glob !== p) {
    return expandGlobs([glob], root).size > 0;
  }
  return fs5.existsSync(path6.join(root, glob));
}
function checkTouchesResolve(entries, root) {
  const results = [];
  let mustExist = 0;
  let missing = 0;
  for (const e of entries) {
    if (e.tag === "new" || e.tag === "delete") {
      results.push({ path: e.path, tag: e.tag, exists: null });
      continue;
    }
    mustExist++;
    const ok = touchExists(e.path, root);
    results.push({ path: e.path, tag: e.tag, exists: ok });
    if (!ok) missing++;
  }
  const majorityMissing = mustExist > 0 && missing > mustExist / 2;
  return { results, mustExist, missing, majorityMissing };
}
function checkTaskTouchesResolve(taskBody, root) {
  const { hasSection, section } = extractTouchesSection(taskBody);
  const entries = hasSection ? parseTouchEntriesWithTags(section) : [];
  return { hasSection, ...checkTouchesResolve(entries, root) };
}
function checkTouchesNarrow(taskBody) {
  const { hasSection, section } = extractTouchesSection(taskBody);
  const entries = hasSection ? parseTouchEntriesWithTags(section) : [];
  const wideGlobs = [];
  for (const e of entries) {
    if (e.tag === "new") continue;
    const norm = normalizePath(e.path);
    if (isOverbroadDeclaration(norm) || /\/\*\*$/.test(norm) || /\/$/.test(e.path)) {
      wideGlobs.push(e.path);
    }
  }
  return { narrow: wideGlobs.length === 0, wideGlobs };
}
function frontmatterRole(taskBody) {
  const m = String(taskBody || "").match(/^role:\s*["']?([^\s"']+)/m);
  return m ? m[1] : null;
}
function selfTouchEntry(taskBody, taskId) {
  const { hasSection, section } = extractTouchesSection(taskBody);
  if (!hasSection) return null;
  const expected = `tasks/${taskId}.md`;
  return parseTouchEntriesWithTags(section).find((e) => e.path === expected) ?? null;
}
function selfTouchCheck(taskBody, taskId) {
  const expected = `tasks/${taskId}.md`;
  const entry = selfTouchEntry(taskBody, taskId);
  const ok = entry !== null && entry.tag !== "new";
  const compound = frontmatterRole(taskBody) === "compound";
  return { ok, expected, entry, compound };
}
var NON_DISPATCHABLE_LABELS = ["fixture", "ac"];
function isFixtureTask(raw) {
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return false;
  const flow = fm[1].match(/^labels:\s*\[([^\]]*)\]\s*$/m);
  if (flow) return flow[1].split(",").some((v) => NON_DISPATCHABLE_LABELS.includes(v.trim().replace(/^["']|["']$/g, "")));
  const lines = fm[1].split(/\r?\n/);
  const idx = lines.findIndex((l) => /^labels:\s*$/.test(l));
  if (idx < 0) return false;
  for (let i = idx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^\s+-\s+(.+?)\s*$/);
    if (m) {
      if (NON_DISPATCHABLE_LABELS.includes(m[1].replace(/^["']|["']$/g, ""))) return true;
    } else if (/^\S/.test(lines[i])) break;
  }
  return false;
}
function scanReadyTasksSelfTouch(tasksDir) {
  const out = [];
  if (!fs5.existsSync(tasksDir)) return out;
  for (const f of fs5.readdirSync(tasksDir).filter((f2) => f2.endsWith(".md"))) {
    const id = f.replace(/\.md$/, "");
    const raw = fs5.readFileSync(path6.join(tasksDir, f), "utf8");
    if (!/^status:\s*["']?ready["']?\s*$/m.test(raw)) continue;
    if (isFixtureTask(raw)) continue;
    const { ok, expected, entry, compound } = selfTouchCheck(raw, id);
    out.push({ id, ok, expected, entry, compound });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}
function usage() {
  process.stderr.write("Usage: touches-orthogonality-check.mjs [--root <dir>] <charterA.md> <charterB.md>\n");
  process.stderr.write("       touches-orthogonality-check.mjs --check-pair [--root <dir>] <charterA.md> <charterB.md> [--outer-inflight <path> ...]\n");
  process.stderr.write("       touches-orthogonality-check.mjs --resolve [--root <dir>] <task.md>\n");
  process.stderr.write("       touches-orthogonality-check.mjs --self-touch [--root <dir>] <task.md>\n");
  process.stderr.write("       touches-orthogonality-check.mjs --self-touch-scan [--root <dir>]\n");
  process.stderr.write("       touches-orthogonality-check.mjs --runtime-dirty --task <id> [--root <dir>] <path>\u2026\n");
}
function mainResolve(args) {
  let root = null;
  const files = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--resolve") continue;
    if (args[i] === "--root") {
      root = args[++i];
      continue;
    }
    files.push(args[i]);
  }
  if (files.length !== 1) {
    usage();
    return 2;
  }
  const file = files[0];
  if (!fs5.existsSync(file)) {
    process.stderr.write(`ERROR: task not found: ${file}
`);
    return 2;
  }
  const rootDir = root ? path6.resolve(root) : repoRoot(path6.resolve(path6.dirname(file)));
  const r = checkTaskTouchesResolve(fs5.readFileSync(file, "utf8"), rootDir);
  if (!r.hasSection) {
    process.stdout.write(`RESOLVE ${file}: no ## Touches section \u2014 no existence claims to verify
`);
    return 0;
  }
  for (const res of r.results) {
    if (res.exists === null) process.stdout.write(`  skip (${res.tag}): ${res.path}
`);
    else if (res.exists) process.stdout.write(`  ok:          ${res.path}
`);
    else process.stdout.write(`  MISSING:     ${res.path}
`);
  }
  process.stdout.write(
    `RESOLVE ${file}: ${r.missing}/${r.mustExist} non-tagged touches missing \u2014 ` + (r.majorityMissing ? "MAJORITY-MISSING (NOT dispatchable)" : "resolves (dispatchable)") + "\n"
  );
  return r.majorityMissing ? 1 : 0;
}
function mainSelfTouch(args) {
  let root = null;
  const files = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--self-touch") continue;
    if (args[i] === "--root") {
      root = args[++i];
      continue;
    }
    files.push(args[i]);
  }
  if (files.length !== 1) {
    usage();
    return 2;
  }
  const file = files[0];
  if (!fs5.existsSync(file)) {
    process.stderr.write(`ERROR: task not found: ${file}
`);
    return 2;
  }
  const body = fs5.readFileSync(file, "utf8");
  const id = path6.basename(file, ".md");
  const { ok, expected, compound } = selfTouchCheck(body, id);
  if (ok) {
    process.stdout.write(`SELF-TOUCH ${file}: ok (Touches includes ${expected} without (new))
`);
    return 0;
  }
  if (compound) {
    process.stdout.write(`SELF-TOUCH ${file}: COMPOUND (aggregate \u2014 Touches delegate to children; no self-file needed)
`);
    return 0;
  }
  process.stdout.write(`SELF-TOUCH ${file}: MISSING ${expected} (without (new)) in ## Touches \u2014 not dispatchable
`);
  return 1;
}
function mainSelfTouchScan(args) {
  let root = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--self-touch-scan") continue;
    if (args[i] === "--root") {
      root = args[++i];
      continue;
    }
  }
  const rootDir = root ? path6.resolve(root) : repoRoot(process.cwd());
  const rows = scanReadyTasksSelfTouch(path6.join(rootDir, "tasks"));
  const missing = rows.filter((r) => !r.ok && !r.compound);
  for (const r of rows) {
    if (r.ok) process.stdout.write(`  ok:      ${r.id} (touches ${r.expected})
`);
    else if (r.compound) process.stdout.write(`  COMPOUND:${r.id} (aggregate \u2014 Touches delegate to children; no self-file needed)
`);
    else process.stdout.write(`  MISSING: ${r.id} (expected ${r.expected} in ## Touches without (new))
`);
  }
  process.stdout.write(
    `SELF-TOUCH-SCAN: ${rows.length} ready task(s), ${missing.length} missing self-file entry \u2014 ` + (missing.length === 0 ? "all dispatchable" : "NOT all dispatchable (add tasks/<id>.md to each ## Touches)") + "\n"
  );
  return missing.length === 0 ? 0 : 1;
}
function mainCheckPair(args) {
  let root = null;
  const files = [];
  const outerInflight = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--check-pair") continue;
    if (args[i] === "--root") {
      root = args[++i];
      continue;
    }
    if (args[i] === "--outer-inflight") {
      const v = args[++i];
      if (v) outerInflight.push(v);
      continue;
    }
    files.push(args[i]);
  }
  if (files.length !== 2) {
    usage();
    return 2;
  }
  for (const f of files) {
    if (!fs5.existsSync(f)) {
      process.stderr.write(`ERROR: charter not found: ${f}
`);
      return 2;
    }
  }
  const expandRoot = root ? path6.resolve(root) : repoRoot(path6.resolve(path6.dirname(files[0])));
  const A = parseTouches(fs5.readFileSync(files[0], "utf8"));
  const B = parseTouches(fs5.readFileSync(files[1], "utf8"));
  const expand = (globs) => expandGlobs(globs, expandRoot);
  const r = checkDispatchEligibility(A, B, outerInflight, expand);
  if (r.disjoint) {
    process.stdout.write(`DISJOINT: ${files[0]} \u2225 ${files[1]} \u2014 safe to batch (${r.reason})
`);
    return 0;
  }
  const tail = r.overlaps.length ? ` [overlap: ${r.overlaps.join(", ")}]` : "";
  process.stdout.write(`OVERLAP: ${files[0]} \u2717 ${files[1]} \u2014 must serialize (${r.reason})${tail}
`);
  return 1;
}
function mainRuntimeDirty(args) {
  let taskId = null;
  let root = null;
  const paths = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--runtime-dirty") continue;
    if (args[i] === "--task") {
      taskId = args[++i];
      continue;
    }
    if (args[i] === "--root") {
      root = args[++i];
      continue;
    }
    paths.push(args[i]);
  }
  if (!taskId) {
    process.stderr.write(`touches-orthogonality-check: --runtime-dirty requires --task <id>
`);
    return 2;
  }
  const rootDir = root ? path6.resolve(root) : repoRoot(process.cwd());
  const taskFile = path6.join(rootDir, "tasks", `${taskId}.md`);
  if (!fs5.existsSync(taskFile)) {
    process.stderr.write(`touches-orthogonality-check: task file not found: ${taskFile}
`);
    return 2;
  }
  const selfDir = path6.dirname(fileURLToPath3(import.meta.url));
  const rtPatterns = loadRuntimeArtifactPatterns2(selfDir) ?? [];
  const r = checkBenignRuntimeDirty(fs5.readFileSync(taskFile, "utf8"), paths, rtPatterns);
  if (r.benign) {
    process.stdout.write(`BENIGN (${r.reason})
`);
    return 0;
  }
  const tail = r.violations.length ? ` [${r.violations.map((v) => `${v.path}: ${v.why}`).join(", ")}]` : "";
  process.stdout.write(`NOT-BENIGN ${r.reason}${tail}
`);
  return 1;
}
async function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit("usage: touches-orthogonality-check.ts [--root <dir>] <charterA.md> <charterB.md> | --check-pair | --resolve | --self-touch | --self-touch-scan | --runtime-dirty --task <id>");
  if (args.includes("--runtime-dirty")) return mainRuntimeDirty(args);
  if (args.includes("--self-touch-scan")) return mainSelfTouchScan(args);
  if (args.includes("--self-touch")) return mainSelfTouch(args);
  if (args.includes("--check-pair")) return mainCheckPair(args);
  if (args.includes("--resolve")) return mainResolve(args);
  let root = null;
  const files = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") {
      root = args[++i];
      continue;
    }
    files.push(args[i]);
  }
  if (files.length !== 2) {
    usage();
    return 2;
  }
  for (const f of files) {
    if (!fs5.existsSync(f)) {
      process.stderr.write(`ERROR: charter not found: ${f}
`);
      return 2;
    }
  }
  const expandRoot = root ? path6.resolve(root) : repoRoot(path6.resolve(path6.dirname(files[0])));
  const A = parseTouches(fs5.readFileSync(files[0], "utf8"));
  const B = parseTouches(fs5.readFileSync(files[1], "utf8"));
  const expand = (globs) => expandGlobs(globs, expandRoot);
  const r = checkTouchesPair(A, B, expand);
  if (r.disjoint) {
    process.stdout.write(`DISJOINT: ${files[0]} \u2225 ${files[1]} \u2014 safe to batch (${r.reason})
`);
    return 0;
  }
  const tail = r.overlaps.length ? ` [overlap: ${r.overlaps.join(", ")}]` : "";
  process.stdout.write(`OVERLAP: ${files[0]} \u2717 ${files[1]} \u2014 must serialize (${r.reason})${tail}
`);
  return 1;
}
if (isDirectEntry(import.meta, void 0, "touches-orthogonality-check")) {
  main(process.argv).then((code) => process.exit(code));
}
export {
  OVERBROAD,
  checkBenignRuntimeDirty,
  checkDispatchEligibility,
  checkOuterInflight,
  checkTaskTouchesResolve,
  checkTouchesNarrow,
  checkTouchesPair,
  checkTouchesResolve,
  expandGlobs,
  filesDisjoint,
  isFixtureTask,
  isOverbroadDeclaration,
  main,
  matchGlob,
  normalizePath,
  parseTouches,
  scanReadyTasksSelfTouch,
  selfTouchCheck,
  selfTouchEntry,
  touchExists,
  walkFiles2 as walkFiles
};
