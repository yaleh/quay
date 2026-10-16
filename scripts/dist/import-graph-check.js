#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-knW9s7/scripts/import-graph-check.ts
import fs2 from "node:fs";
import path4 from "node:path";
import { execFileSync as execFileSync2 } from "node:child_process";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// .tmp-dist-publish-worktrees/publish-knW9s7/scripts/source-text-lib.ts
function lineOf(src, idx) {
  let line = 1;
  for (let i = 0; i < idx && i < src.length; i++) if (src[i] === "\n") line++;
  return line;
}

// .tmp-dist-publish-worktrees/publish-knW9s7/scripts/checker-lib.ts
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

// .tmp-dist-publish-worktrees/publish-knW9s7/scripts/gate-script-base.ts
import path from "node:path";
function helpExit(usage) {
  process.stdout.write(usage.endsWith("\n") ? usage : usage + "\n");
  process.exit(0);
}
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

// .tmp-dist-publish-worktrees/publish-knW9s7/scripts/ratchet-baseline.ts
import path2 from "node:path";
function baselinePath(root, rel) {
  return path2.join(root, ...rel.split("/"));
}

// .tmp-dist-publish-worktrees/publish-knW9s7/scripts/repo-root.ts
import fs from "node:fs";
import path3 from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
var MAX_DEPTH = 16;
function repoRoot(startDir = path3.dirname(fileURLToPath(import.meta.url))) {
  let dir = path3.resolve(startDir);
  for (let i = 0; i < MAX_DEPTH; i++) {
    const hasPkg = fs.existsSync(path3.join(dir, "package.json"));
    if (hasPkg && fs.existsSync(path3.join(dir, "plugin")) && fs.existsSync(path3.join(dir, "scripts", "test.sh"))) {
      return dir;
    }
    if (hasPkg && fs.existsSync(path3.join(dir, ".quay", "config.yml"))) {
      return dir;
    }
    if (fs.existsSync(path3.join(dir, ".git"))) {
      return dir;
    }
    const parent = path3.dirname(dir);
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

// .tmp-dist-publish-worktrees/publish-knW9s7/scripts/import-graph-check.ts
var BASELINE_FILE_REL = "plugin/import-graph-baseline.json";
var PACKAGES_PREFIX = "packages/";
var REVERSE_TARGET_PREFIXES = ["plugin/", "experiments/"];
var KERNEL_DIR_REL = "packages/quay/src/kernel";
var KERNEL_PREFIX = `${KERNEL_DIR_REL}/`;
var EXCLUDED_SEGMENTS = ["node_modules", "dist", "archive", "test", "__tests__", "fixtures"];
var EXCLUDED_PREFIXES = [".claude/worktrees/"];
function isExcludedPath(rel) {
  if (EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) return true;
  if (rel.split("/").some((seg) => EXCLUDED_SEGMENTS.includes(seg))) return true;
  const base = rel.slice(rel.lastIndexOf("/") + 1);
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(base)) return true;
  if (/\.d\.ts$/.test(base)) return true;
  return false;
}
function gitLsFiles(root) {
  const out = execFileSync2("git", ["-C", root, "ls-files", "-z", "--", "*.ts", "*.mts", "*.cts", "*.mjs", "*.js"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"]
    // stderr captured (a non-git root must not print git's fatal to the console)
  });
  return out.split("\0").filter((s) => s.length > 0);
}
var STATIC_FROM_RE = /(^|[\n;])([ \t]*)(import|export)\b([^;\n]*?)(from)[ \t]*["']([^"']+)["']/g;
var BRACE_FROM_RE = /(^|[\n;])([ \t]*)(import|export)[ \t]+((?:type[ \t]+)?\{[^}]*\})([ \t]*)(from)[ \t]*["']([^"']+)["']/g;
var BARE_IMPORT_RE = /(^|[\n;])([ \t]*)import[ \t]*["']([^"']+)["']/g;
var DYNAMIC_IMPORT_RE = /\bimport[ \t]*\([ \t]*["']([^"']+)["']/g;
function extractImports(src) {
  const mask = buildNonCodeMask(src);
  const found = /* @__PURE__ */ new Map();
  const add = (kwIdx, fromIdx, spec, kind) => {
    if (kwIdx < 0 || kwIdx >= src.length || mask[kwIdx] !== 0) return;
    if (fromIdx >= 0 && (fromIdx >= src.length || mask[fromIdx] !== 0)) return;
    const line = lineOf(src, kwIdx);
    found.set(`${line}	${spec}`, { spec, line, kind });
  };
  let m;
  STATIC_FROM_RE.lastIndex = 0;
  while ((m = STATIC_FROM_RE.exec(src)) !== null) {
    const kwIdx = m.index + m[1].length + m[2].length;
    const fromIdx = kwIdx + m[3].length + m[4].length;
    const kind = /^type[\s{]/.test(m[4].trimStart()) ? "type" : "value";
    add(kwIdx, fromIdx, m[6], kind);
  }
  BRACE_FROM_RE.lastIndex = 0;
  while ((m = BRACE_FROM_RE.exec(src)) !== null) {
    const kwIdx = m.index + m[1].length + m[2].length;
    const fromIdx = kwIdx + m[3].length + m[4].length + m[5].length;
    add(kwIdx, fromIdx, m[7], m[4].trimStart().startsWith("type") ? "type" : "value");
  }
  BARE_IMPORT_RE.lastIndex = 0;
  while ((m = BARE_IMPORT_RE.exec(src)) !== null) {
    add(m.index + m[1].length + m[2].length, -1, m[3], "value");
  }
  DYNAMIC_IMPORT_RE.lastIndex = 0;
  while ((m = DYNAMIC_IMPORT_RE.exec(src)) !== null) {
    add(m.index, -1, m[1], "value");
  }
  return [...found.values()];
}
function resolveSpecifier(fromRel, spec, nodes) {
  if (!spec.startsWith(".")) return null;
  const base = path4.posix.normalize(path4.posix.join(path4.posix.dirname(fromRel), spec));
  const candidates = [];
  if (/\.(ts|mts|cts|tsx)$/.test(base)) {
    candidates.push(base);
  } else if (/\.js$/.test(base) || /\.mjs$/.test(base)) {
    candidates.push(base.replace(/\.m?js$/, ".ts"), base);
  } else if (/\.json$/.test(base)) {
    return null;
  } else {
    candidates.push(`${base}.ts`, `${base}.mts`, `${base}.cts`, `${base}/index.ts`);
  }
  for (const c of candidates) if (nodes.has(c)) return c;
  return null;
}
function tarjanSccs(nodes, adj) {
  const index = /* @__PURE__ */ new Map();
  const low = /* @__PURE__ */ new Map();
  const onStack = /* @__PURE__ */ new Set();
  const stack = [];
  const sccs = [];
  let counter = 0;
  for (const start of nodes) {
    if (index.has(start)) continue;
    index.set(start, counter);
    low.set(start, counter);
    counter++;
    stack.push(start);
    onStack.add(start);
    const work = [{ v: start, i: 0 }];
    while (work.length > 0) {
      const frame = work[work.length - 1];
      const nbrs = adj.get(frame.v) ?? [];
      if (frame.i < nbrs.length) {
        const w = nbrs[frame.i++];
        if (!index.has(w)) {
          index.set(w, counter);
          low.set(w, counter);
          counter++;
          stack.push(w);
          onStack.add(w);
          work.push({ v: w, i: 0 });
        } else if (onStack.has(w)) {
          low.set(frame.v, Math.min(low.get(frame.v), index.get(w)));
        }
      } else {
        work.pop();
        if (work.length > 0) {
          const parent = work[work.length - 1].v;
          low.set(parent, Math.min(low.get(parent), low.get(frame.v)));
        }
        if (low.get(frame.v) === index.get(frame.v)) {
          const comp = [];
          for (; ; ) {
            const w = stack.pop();
            onStack.delete(w);
            comp.push(w);
            if (w === frame.v) break;
          }
          comp.sort();
          sccs.push(comp);
        }
      }
    }
  }
  return sccs;
}
function adjacency(edges, nodes) {
  const nodeSet = new Set(nodes);
  const adj = /* @__PURE__ */ new Map();
  for (const n of nodes) adj.set(n, []);
  for (const e of edges) {
    if (!nodeSet.has(e.from) || !nodeSet.has(e.to)) continue;
    adj.get(e.from).push(e.to);
  }
  return adj;
}
function readImportGraph(root) {
  const empty = {
    evaluated: false,
    files: 0,
    edges: 0,
    valueEdges: 0,
    typeEdges: 0,
    valueSccs: [],
    typeSccs: [],
    reverseEdges: [],
    kernelChecked: false,
    kernelViolations: [],
    notAnalyzed: { mjs: 0, js: 0 },
    dangling: []
  };
  let tracked;
  try {
    tracked = gitLsFiles(root);
  } catch (err) {
    return { ...empty, reason: `git ls-files failed in ${root}: ${err.message.split("\n")[0]}` };
  }
  const notAnalyzed = {
    mjs: tracked.filter((p) => p.endsWith(".mjs") && !isExcludedPath(p)).length,
    js: tracked.filter((p) => p.endsWith(".js") && !isExcludedPath(p)).length
  };
  const candidates = tracked.filter((p) => /\.(ts|mts|cts)$/.test(p) && !isExcludedPath(p));
  const dangling = [];
  const repOf = /* @__PURE__ */ new Map();
  const nodes = /* @__PURE__ */ new Set();
  for (const rel of candidates) {
    const abs = path4.join(root, rel);
    let real;
    try {
      real = fs2.realpathSync(abs);
    } catch {
      dangling.push(rel);
      continue;
    }
    let canon = path4.relative(root, real).split(path4.sep).join("/");
    if (canon.startsWith("../")) canon = rel;
    if (!repOf.has(canon)) repOf.set(canon, rel);
    nodes.add(canon);
  }
  if (nodes.size === 0) {
    return { ...empty, evaluated: false, notAnalyzed, dangling, reason: `no analyzable TypeScript files under ${root}` };
  }
  const allEdges = [];
  const parseFailures = [];
  for (const [canon, rel] of repOf) {
    let src;
    try {
      src = fs2.readFileSync(path4.join(root, rel), "utf8");
    } catch (err) {
      parseFailures.push(`${rel}: ${err.message.split("\n")[0]}`);
      continue;
    }
    for (const imp of extractImports(src)) {
      const to = resolveSpecifier(canon, imp.spec, nodes);
      if (to === null) continue;
      allEdges.push({ from: canon, to, line: imp.line, kind: imp.kind });
    }
  }
  if (parseFailures.length > 0) {
    return {
      ...empty,
      evaluated: false,
      notAnalyzed,
      dangling,
      reason: `could not read ${parseFailures.length} tracked source file(s): ${parseFailures.slice(0, 3).join("; ")}`
    };
  }
  const nodeList = [...nodes].sort();
  const valueEdges = allEdges.filter((e) => e.kind === "value");
  const typeEdges = allEdges.filter((e) => e.kind === "type");
  const valueSccs = tarjanSccs(nodeList, adjacency(valueEdges, nodeList)).filter((c) => c.length >= 2).map((files) => ({ files }));
  const combinedSccs = tarjanSccs(nodeList, adjacency(allEdges, nodeList)).filter((c) => c.length >= 2);
  const valueSccKeys = new Set(valueSccs.map((s) => s.files.join("\n")));
  const typeSccs = combinedSccs.filter((c) => !valueSccKeys.has(c.join("\n"))).map((files) => ({ files }));
  const reverseEdges = [];
  for (const e of allEdges) {
    if (!e.from.startsWith(PACKAGES_PREFIX)) continue;
    if (!REVERSE_TARGET_PREFIXES.some((p) => e.to.startsWith(p))) continue;
    reverseEdges.push({ from: e.from, to: e.to, line: e.line });
  }
  reverseEdges.sort((a, b) => a.from === b.from ? a.to.localeCompare(b.to) || a.line - b.line : a.from.localeCompare(b.from));
  const kernelExists = fs2.existsSync(path4.join(root, KERNEL_DIR_REL)) && fs2.statSync(path4.join(root, KERNEL_DIR_REL)).isDirectory();
  const kernelViolations = [];
  if (kernelExists) {
    for (const e of allEdges) {
      if (!e.from.startsWith(KERNEL_PREFIX)) continue;
      if (e.to.startsWith(KERNEL_PREFIX)) continue;
      kernelViolations.push({ from: e.from, to: e.to, line: e.line });
    }
    kernelViolations.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.line - b.line);
  }
  return {
    evaluated: true,
    files: nodeList.length,
    edges: allEdges.length,
    valueEdges: valueEdges.length,
    typeEdges: typeEdges.length,
    valueSccs,
    typeSccs,
    reverseEdges,
    kernelChecked: kernelExists,
    kernelViolations,
    notAnalyzed,
    dangling
  };
}
function countsOf(r) {
  return { valueSccs: r.valueSccs.length, typeSccs: r.typeSccs.length, reverseEdges: r.reverseEdges.length };
}
function checkBaselineShrinkOnly(worktree, head) {
  if (head === null) return { raised: [], bootstrap: true };
  if (worktree === null) return { raised: [], bootstrap: false };
  const raised = Object.keys(worktree).filter((k) => worktree[k] > head[k]);
  return { raised, bootstrap: false };
}
function judge(reading, baseline, worktreeBaseline, headBaseline) {
  const counts = countsOf(reading);
  const over = Object.keys(counts).filter((k) => counts[k] > baseline[k]);
  const shrink = checkBaselineShrinkOnly(worktreeBaseline, headBaseline);
  const kernelBlocked = reading.kernelChecked && reading.kernelViolations.length > 0;
  return {
    ok: over.length === 0 && shrink.raised.length === 0 && !kernelBlocked,
    over,
    baselineRaised: shrink.raised,
    headBaseline,
    bootstrap: shrink.bootstrap,
    kernelBlocked
  };
}
function baselineFile(root) {
  return baselinePath(root, BASELINE_FILE_REL);
}
function readBaselineFile(abs) {
  try {
    const raw = JSON.parse(fs2.readFileSync(abs, "utf8"));
    if (typeof raw.valueSccs !== "number" || typeof raw.typeSccs !== "number" || typeof raw.reverseEdges !== "number") {
      return null;
    }
    return { valueSccs: raw.valueSccs, typeSccs: raw.typeSccs, reverseEdges: raw.reverseEdges };
  } catch {
    return null;
  }
}
function readHeadBaseline(root, relPath) {
  try {
    const out = execFileSync2("git", ["-C", root, "show", `HEAD:${relPath}`], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    const raw = JSON.parse(out);
    if (typeof raw.valueSccs !== "number" || typeof raw.typeSccs !== "number" || typeof raw.reverseEdges !== "number") return null;
    return { valueSccs: raw.valueSccs, typeSccs: raw.typeSccs, reverseEdges: raw.reverseEdges };
  } catch {
    return null;
  }
}
var BASELINE_RAISE_CASE = {
  name: "baseline-raised-above-head",
  head: { valueSccs: 1, typeSccs: 2, reverseEdges: 5 },
  equal: { valueSccs: 1, typeSccs: 2, reverseEdges: 5 },
  lowered: { valueSccs: 0, typeSccs: 2, reverseEdges: 5 },
  raised: { valueSccs: 2, typeSccs: 2, reverseEdges: 5 }
};
function runBaselineRaiseCase() {
  const c = BASELINE_RAISE_CASE;
  const eq = checkBaselineShrinkOnly(c.equal, c.head);
  const lo = checkBaselineShrinkOnly(c.lowered, c.head);
  const hi = checkBaselineShrinkOnly(c.raised, c.head);
  const boot = checkBaselineShrinkOnly(c.raised, null);
  const predicateOk = eq.raised.length === 0 && eq.bootstrap === false && lo.raised.length === 0 && hi.raised.length === 1 && hi.raised[0] === "valueSccs" && boot.bootstrap === true;
  const dir = fs2.mkdtempSync(path4.join(process.env.TMPDIR ?? "/tmp", "import-graph-raise-"));
  let codes = [];
  let e2eOk = false;
  let e2eDetail = "";
  try {
    fs2.mkdirSync(path4.join(dir, "src"), { recursive: true });
    fs2.writeFileSync(path4.join(dir, "src", "only.ts"), "export const only = 1;\n");
    const bAbs = baselineFile(dir);
    fs2.mkdirSync(path4.dirname(bAbs), { recursive: true });
    fs2.writeFileSync(bAbs, JSON.stringify(c.head, null, 2) + "\n");
    const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
    execFileSync2("git", ["-c", "init.defaultBranch=main", "-c", "core.hooksPath=/dev/null", "init", "-q"], { cwd: dir, env, stdio: "pipe" });
    execFileSync2("git", ["-c", "core.hooksPath=/dev/null", "add", "-A"], { cwd: dir, env, stdio: "pipe" });
    execFileSync2(
      "git",
      ["-c", "core.hooksPath=/dev/null", "-c", "user.email=igc@example.invalid", "-c", "user.name=igc", "commit", "-q", "-m", "fixture: committed baseline"],
      { cwd: dir, env, stdio: "pipe" }
    );
    const write = (b) => fs2.writeFileSync(bAbs, JSON.stringify(b, null, 2) + "\n");
    const codeFor = (b) => {
      write(b);
      return decide(dir).code;
    };
    codes = [codeFor(c.equal), codeFor(c.lowered), codeFor(c.raised)];
    const [eqCode, loCode, hiCode] = codes;
    const bootCode = decide(dir, path4.join(dir, "no-such-baseline.json")).code;
    e2eOk = eqCode === 0 && loCode === 0 && hiCode === 1 && bootCode === 2;
    e2eDetail = `decide() on a committed fixture: equal\u21D2${eqCode} lowered\u21D2${loCode} raised(+1)\u21D2${hiCode} missing-baseline\u21D2${bootCode} (want 0/0/1/2)`;
  } catch (err) {
    e2eDetail = `INFRASTRUCTURE: ${err.message.split("\n")[0]}`;
  } finally {
    try {
      fs2.rmSync(dir, { recursive: true, force: true });
    } catch {
    }
  }
  return {
    ok: predicateOk && e2eOk,
    detail: `predicate: equal\u21D2raised=[${eq.raised}] lowered\u21D2raised=[${lo.raised}] raised(+1 valueSccs)\u21D2raised=[${hi.raised}] head=absent\u21D2bootstrap=${boot.bootstrap} | ${e2eDetail}`
  };
}
var F = (body) => `${body}
`;
var SELFTEST_CASES = [
  {
    name: "value-cycle-two-files (A\u2194B both VALUE imports \u21D2 valueSccs 1 \u21D2 over baseline 0 \u21D2 FAIL)",
    git: true,
    files: {
      "src/a.ts": F(`import { b } from "./b.ts";
export const a = 1;`),
      "src/b.ts": F(`import { a } from "./a.ts";
export const b = 2;`)
    },
    baseline: { valueSccs: 0, typeSccs: 0, reverseEdges: 0 },
    expect: { evaluated: true, valueSccs: 1, typeSccs: 0, reverseEdges: 0, exit: 1 },
    valueSccContains: ["src/a.ts", "src/b.ts"]
  },
  {
    name: "type-only-closure (A value-imports B, B `import type` back \u21D2 PASS at valueSccs 0 \u21D2 typeSccs +1)",
    git: true,
    files: {
      "src/a.ts": F(`import { b } from "./b.ts";
export const a = b;`),
      "src/b.ts": F(`import type { A } from "./a.ts";
export const b: A | null = null;`)
    },
    baseline: { valueSccs: 0, typeSccs: 1, reverseEdges: 0 },
    expect: { evaluated: true, valueSccs: 0, typeSccs: 1, reverseEdges: 0, exit: 0 }
  },
  {
    name: "reverse-edge (packages/x.ts \u2192 plugin/y.ts \u21D2 reverseEdges 1 \u21D2 FAIL at baseline 0)",
    git: true,
    files: {
      "packages/quay/src/x.ts": F(`import { y } from "../../../plugin/scripts/y.ts";
export const x = y;`),
      "plugin/scripts/y.ts": F(`export const y = 1;`)
    },
    baseline: { valueSccs: 0, typeSccs: 0, reverseEdges: 0 },
    expect: { evaluated: true, valueSccs: 0, typeSccs: 0, reverseEdges: 1, exit: 1 },
    reverseEdgeFrom: ["packages/quay/src/x.ts"],
    reverseEdgeTo: ["plugin/scripts/y.ts"]
  },
  {
    name: 'comment-and-string-mentions-not-counted (only `// import \u2026` and "import \u2026" text \u21D2 0 edges)',
    git: true,
    files: {
      "src/a.ts": F(
        `// import { b } from "./b.ts";
export const doc = 'import { b } from "./b.ts";';
export const a = 1;`
      ),
      "src/b.ts": F(`import { a } from "./a.ts";
export const b = a;`)
    },
    // If the comment/string WERE counted, a and b would form a value cycle ⇒ valueSccs 1 (> baseline 0)
    // and the gate would go RED. The case asserts GREEN and valueSccs === 0.
    baseline: { valueSccs: 0, typeSccs: 0, reverseEdges: 0 },
    expect: { evaluated: true, valueSccs: 0, typeSccs: 0, reverseEdges: 0, exit: 0 }
  },
  {
    name: "kernel-boundary-violation (kernel file imports outside kernel \u21D2 FAIL, kernelChecked true)",
    git: true,
    files: {
      "packages/quay/src/kernel/k.ts": F(`import { outside } from "../outside.ts";
export const k = outside;`),
      "packages/quay/src/outside.ts": F(`export const outside = 1;`)
    },
    baseline: { valueSccs: 0, typeSccs: 0, reverseEdges: 0 },
    expect: { evaluated: true, valueSccs: 0, typeSccs: 0, reverseEdges: 0, kernelChecked: true, kernelViolations: 1, exit: 1 }
  },
  {
    name: "kernel-absent (no kernel dir \u21D2 kernelChecked false, NOT conflated with 'checked and clean')",
    git: true,
    files: {
      "packages/quay/src/kernel-free.ts": F(`export const x = 1;`)
    },
    baseline: { valueSccs: 0, typeSccs: 0, reverseEdges: 0 },
    expect: { evaluated: true, valueSccs: 0, typeSccs: 0, reverseEdges: 0, kernelChecked: false, kernelViolations: 0, exit: 0 }
  },
  {
    name: "non-git-directory (cannot enumerate \u21D2 evaluated false + exit 2, NEVER exit 0)",
    git: false,
    files: { "src/a.ts": F(`import { b } from "./b.ts";`) },
    baseline: { valueSccs: 0, typeSccs: 0, reverseEdges: 0 },
    expect: { evaluated: false, valueSccs: 0, typeSccs: 0, reverseEdges: 0, exit: 2 }
  },
  {
    // A SECOND unreadable-input path, distinct from the one above: here git works and the enumeration
    // succeeds, but there is nothing to analyze. `git ls-files` failing and `git ls-files` returning
    // zero analyzable files are different code paths (throw vs `nodes.size === 0`), and both must land
    // on the SAME three-valued answer — a checker that answers "0 cycles" for "no input at all" is
    // exactly the archguard failure this whole task exists to close.
    name: "empty-repo (git works, zero analyzable TS \u21D2 evaluated false + exit 2, NEVER '0 cycles')",
    git: true,
    files: { "README.md": F("# nothing to analyze here") },
    baseline: { valueSccs: 0, typeSccs: 0, reverseEdges: 0 },
    expect: { evaluated: false, valueSccs: 0, typeSccs: 0, reverseEdges: 0, exit: 2 }
  }
];
function buildFixture(dir, c) {
  fs2.mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(c.files)) {
    const abs = path4.join(dir, rel);
    fs2.mkdirSync(path4.dirname(abs), { recursive: true });
    fs2.writeFileSync(abs, content);
  }
  if (!c.git) return;
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
  execFileSync2("git", ["-c", "init.defaultBranch=main", "-c", "core.hooksPath=/dev/null", "init", "-q"], { cwd: dir, env, stdio: "pipe" });
  execFileSync2("git", ["-c", "core.hooksPath=/dev/null", "add", "-A"], { cwd: dir, env, stdio: "pipe" });
}
function runSelftestCase(c) {
  const expected = `evaluated=${c.expect.evaluated} valueSccs=${c.expect.valueSccs} typeSccs=${c.expect.typeSccs} reverseEdges=${c.expect.reverseEdges}` + (c.expect.kernelChecked === void 0 ? "" : ` kernelChecked=${c.expect.kernelChecked}`) + (c.expect.kernelViolations === void 0 ? "" : ` kernelViolations=${c.expect.kernelViolations}`) + ` exit=${c.expect.exit}`;
  const dir = fs2.mkdtempSync(path4.join(process.env.TMPDIR ?? "/tmp", "import-graph-selftest-"));
  try {
    buildFixture(dir, c);
    const reading = readImportGraph(dir);
    const counts = countsOf(reading);
    const exit = reading.evaluated ? judge(reading, c.baseline, c.baseline, null).ok ? 0 : 1 : 2;
    const problems = [];
    if (reading.evaluated !== c.expect.evaluated) problems.push(`evaluated=${reading.evaluated} want ${c.expect.evaluated}`);
    if (counts.valueSccs !== c.expect.valueSccs) problems.push(`valueSccs=${counts.valueSccs} want ${c.expect.valueSccs}`);
    if (counts.typeSccs !== c.expect.typeSccs) problems.push(`typeSccs=${counts.typeSccs} want ${c.expect.typeSccs}`);
    if (counts.reverseEdges !== c.expect.reverseEdges) problems.push(`reverseEdges=${counts.reverseEdges} want ${c.expect.reverseEdges}`);
    if (c.expect.kernelChecked !== void 0 && reading.kernelChecked !== c.expect.kernelChecked) {
      problems.push(`kernelChecked=${reading.kernelChecked} want ${c.expect.kernelChecked}`);
    }
    if (c.expect.kernelViolations !== void 0 && reading.kernelViolations.length !== c.expect.kernelViolations) {
      problems.push(`kernelViolations=${reading.kernelViolations.length} want ${c.expect.kernelViolations}`);
    }
    if (exit !== c.expect.exit) problems.push(`exit=${exit} want ${c.expect.exit}`);
    if (c.valueSccContains) {
      const hit = reading.valueSccs.some((s) => c.valueSccContains.every((f) => s.files.includes(f)));
      if (!hit) problems.push(`no valueScc contains [${c.valueSccContains.join(", ")}]`);
    }
    if (c.reverseEdgeFrom && !reading.reverseEdges.some((e) => c.reverseEdgeFrom.includes(e.from))) {
      problems.push(`no reverseEdge.from in [${c.reverseEdgeFrom.join(", ")}]`);
    }
    if (c.reverseEdgeTo && !reading.reverseEdges.some((e) => c.reverseEdgeTo.includes(e.to))) {
      problems.push(`no reverseEdge.to in [${c.reverseEdgeTo.join(", ")}]`);
    }
    return {
      name: c.name,
      ok: problems.length === 0,
      expected,
      detail: problems.length === 0 ? `got evaluated=${reading.evaluated} valueSccs=${counts.valueSccs} typeSccs=${counts.typeSccs} reverseEdges=${counts.reverseEdges} kernelChecked=${reading.kernelChecked} kernelViolations=${reading.kernelViolations.length} exit=${exit}` : problems.join("; ")
    };
  } catch (err) {
    return { name: c.name, ok: false, expected, detail: `INFRASTRUCTURE: ${err.message.split("\n")[0]}` };
  } finally {
    try {
      fs2.rmSync(dir, { recursive: true, force: true });
    } catch {
    }
  }
}
function runSelftest() {
  const results = SELFTEST_CASES.map(runSelftestCase);
  const raise = runBaselineRaiseCase();
  results.push({
    name: "baseline-raised-above-head (AC5: raising ANY baseline axis past git HEAD \u21D2 exit 1)",
    ok: raise.ok,
    expected: "predicate: equal\u21D2raised=[] \xB7 lowered\u21D2raised=[] \xB7 raised(+1 valueSccs)\u21D2raised=[valueSccs] \xB7 head absent\u21D2bootstrap=true | decide() on a committed fixture: equal\u21D20 \xB7 lowered\u21D20 \xB7 raised\u21D21 \xB7 missing baseline\u21D22",
    detail: raise.detail
  });
  return { ok: results.every((r) => r.ok), results };
}
var USAGE = `import-graph-check.ts \u2014 statement-position module dependency graph (value SCCs / type-only
SCCs / packages\u2192plugin|experiments reverse edges / the conditional kernel boundary), shrink-only ratchet.

Usage:
  node --experimental-strip-types import-graph-check.ts [<root>] [--json] [--selftest] [--baseline <file>]

  <root>            repository root to analyze (default: this script's repo root).
  --json            machine-readable reading.
  --selftest        run the injected self-test cases (fixtures + the baseline-raise case) and exit.
  --baseline <f>    baseline file (default plugin/import-graph-baseline.json under <root>).

Exit: 0 = every quantity \u2264 baseline, baseline not raised past HEAD, kernel boundary holds
      1 = a quantity exceeded the baseline / the baseline was raised / a kernel violation
      2 = usage or environment error, INCLUDING "the graph could not be read" (evaluated:false)`;
function reportReading(reading, v, baseline, asJson) {
  if (asJson) {
    console.log(
      JSON.stringify(
        {
          evaluated: reading.evaluated,
          reason: reading.reason ?? null,
          files: reading.files,
          edges: reading.edges,
          valueEdges: reading.valueEdges,
          typeEdges: reading.typeEdges,
          valueSccs: reading.valueSccs,
          typeSccs: reading.typeSccs,
          reverseEdges: reading.reverseEdges,
          kernelChecked: reading.kernelChecked,
          kernelViolations: reading.kernelViolations,
          notAnalyzed: reading.notAnalyzed,
          dangling: reading.dangling,
          baseline,
          verdict: v
        },
        null,
        2
      )
    );
    return;
  }
  const counts = countsOf(reading);
  console.log(
    `import-graph-check: files=${reading.files} edges=${reading.edges} (value ${reading.valueEdges} / type ${reading.typeEdges})`
  );
  console.log(`  valueSccs=${counts.valueSccs} typeSccs=${counts.typeSccs} reverseEdges=${counts.reverseEdges}`);
  for (const s of reading.valueSccs) console.log(`  value SCC: ${s.files.join(", ")}`);
  for (const s of reading.typeSccs) console.log(`  type-only SCC: ${s.files.join(", ")}`);
  for (const e of reading.reverseEdges) console.log(`  reverse edge: ${e.from}:${e.line} \u2192 ${e.to}`);
  console.log(
    `  kernelChecked=${reading.kernelChecked}` + (reading.kernelChecked ? ` (violations=${reading.kernelViolations.length})` : " (packages/quay/src/kernel/ absent \u2014 not conflated with 'checked and clean')")
  );
  console.log(`  notAnalyzed (tracked non-test, outside this checker's TS scope): mjs=${reading.notAnalyzed.mjs} js=${reading.notAnalyzed.js}`);
  if (reading.dangling.length > 0) console.log(`  dangling (tracked, no readable target \u2014 not a node): ${reading.dangling.join(", ")}`);
  if (baseline) console.log(`  baseline: ${JSON.stringify(baseline)}`);
  if (v) {
    console.log(`  headBaseline: ${v.bootstrap ? "absent-bootstrap" : JSON.stringify(v.headBaseline)}`);
    if (v.over.length > 0) console.log(`  OVER baseline on: ${v.over.join(", ")}`);
    if (v.baselineRaised.length > 0) console.log(`  BASELINE RAISED past HEAD on: ${v.baselineRaised.join(", ")}`);
    if (v.kernelBlocked) console.log(`  KERNEL BOUNDARY VIOLATED by ${reading.kernelViolations.length} edge(s)`);
  }
}
function decide(root, baselineAbs = baselineFile(root)) {
  const reading = readImportGraph(root);
  if (!reading.evaluated) return { reading, baseline: null, verdict: null, code: 2, relForHead: "" };
  const baseline = readBaselineFile(baselineAbs);
  if (baseline === null) return { reading, baseline: null, verdict: null, code: 2, relForHead: "" };
  const relForHead = path4.relative(root, baselineAbs).split(path4.sep).join("/");
  const inRepo = !relForHead.startsWith("../") && !path4.isAbsolute(relForHead);
  let headBaseline = null;
  if (inRepo) {
    try {
      execFileSync2("git", ["-C", root, "rev-parse", "--verify", "HEAD"], { stdio: "pipe" });
      headBaseline = readHeadBaseline(root, relForHead);
    } catch {
      headBaseline = null;
    }
  }
  const verdict = judge(reading, baseline, baseline, headBaseline);
  return { reading, baseline, verdict, code: verdict.ok ? 0 : 1, relForHead };
}
function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit(USAGE);
  const asJson = args.includes("--json");
  if (args.includes("--selftest")) {
    const { ok, results } = runSelftest();
    if (asJson) {
      console.log(JSON.stringify({ selftest: results, ok }, null, 2));
    } else {
      console.log(`import-graph-check --selftest \u2014 ${results.length} injected case(s), each an expectation vs a real reading`);
      for (const r of results) {
        console.log(`  [${r.ok ? "ok" : "FAIL"}] ${r.name}`);
        console.log(`      expected: ${r.expected}`);
        console.log(`      ${r.ok ? "reading : " : "PROBLEM : "}${r.detail}`);
      }
    }
    if (!asJson) console.log(ok ? `PASS \u2014 all ${results.length} case(s) behaved` : "FAIL \u2014 see the cases above");
    return ok ? 0 : 1;
  }
  const positional = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1] === "--baseline"));
  const here = path4.dirname(fileURLToPath2(import.meta.url));
  const root = path4.resolve(flagValue(args, "--root") ?? positional ?? repoRoot(here));
  const baselineAbs = path4.resolve(flagValue(args, "--baseline") ?? baselineFile(root));
  const { reading, baseline, verdict, code, relForHead } = decide(root, baselineAbs);
  if (!reading.evaluated) {
    reportReading(reading, null, null, asJson);
    process.stderr.write(`import-graph-check: NOT-EVALUATED \u2014 ${reading.reason ?? "the import graph could not be read"}
`);
    return 2;
  }
  if (baseline === null || verdict === null) {
    reportReading(reading, null, null, asJson);
    process.stderr.write(
      `import-graph-check: NOT-EVALUATED \u2014 baseline file missing or malformed (${baselineAbs}); a checker that cannot read its baseline is never conflated with "\u2264 baseline"
`
    );
    return 2;
  }
  reportReading(reading, verdict, baseline, asJson);
  const counts = countsOf(reading);
  if (verdict.over.length > 0) {
    process.stderr.write(
      `import-graph-check: FAIL \u2014 ${verdict.over.map((k) => `${k} ${counts[k]} > baseline ${baseline[k]}`).join("; ")}
`
    );
    return 1;
  }
  if (verdict.baselineRaised.length > 0) {
    process.stderr.write(
      `import-graph-check: FAIL \u2014 the working-tree baseline was RAISED past git HEAD on ${verdict.baselineRaised.join(", ")} (a baseline may only shrink)
`
    );
    return 1;
  }
  if (verdict.kernelBlocked) {
    process.stderr.write(
      `import-graph-check: FAIL \u2014 ${reading.kernelViolations.length} import edge(s) leave ${KERNEL_DIR_REL}/ (first: ${reading.kernelViolations[0].from}:${reading.kernelViolations[0].line} \u2192 ${reading.kernelViolations[0].to})
`
    );
    return 1;
  }
  if (!asJson) {
    const boot = verdict.bootstrap ? ` (headBaseline: absent-bootstrap \u2014 HEAD carries no ${relForHead}; this reading is the new baseline)` : ` (headBaseline ${JSON.stringify(verdict.headBaseline)})`;
    process.stdout.write(
      `PASS \u2014 valueSccs=${counts.valueSccs} \u2264 ${baseline.valueSccs}, typeSccs=${counts.typeSccs} \u2264 ${baseline.typeSccs}, reverseEdges=${counts.reverseEdges} \u2264 ${baseline.reverseEdges}${boot}
`
    );
  }
  return code;
}
if (isDirectEntry(import.meta, void 0, "import-graph-check")) {
  process.exit(main(process.argv));
}
export {
  BASELINE_FILE_REL,
  BASELINE_RAISE_CASE,
  KERNEL_DIR_REL,
  SELFTEST_CASES,
  baselineFile,
  checkBaselineShrinkOnly,
  countsOf,
  decide,
  extractImports,
  gitLsFiles,
  isExcludedPath,
  judge,
  main,
  readBaselineFile,
  readHeadBaseline,
  readImportGraph,
  resolveSpecifier,
  runBaselineRaiseCase,
  runSelftest,
  runSelftestCase,
  tarjanSccs
};
