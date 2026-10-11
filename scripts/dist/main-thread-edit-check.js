#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/main-thread-edit-check.ts
import fs2 from "node:fs";

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

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/main-thread-edit-check.ts
import os from "node:os";
import path3 from "node:path";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
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

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/main-thread-edit-check.ts
function repoSlug(repoRoot2) {
  return "-" + String(repoRoot2).replace(/\\/g, "/").split("/").filter(Boolean).join("-");
}
function defaultProjectsDir(env = process.env) {
  return env.INNER_EXEC_MODE_PROJECTS_DIR || path3.join(os.homedir(), ".claude", "projects");
}
function isProductFile(filePath, repoRoot2) {
  if (!filePath) return false;
  const raw = String(filePath);
  const abs = path3.resolve(repoRoot2, raw);
  let rel = normalizeRel(raw);
  if (path3.isAbsolute(raw)) {
    const relTo = path3.relative(repoRoot2, abs);
    if (relTo && !relTo.startsWith("..") && !path3.isAbsolute(relTo)) rel = normalizeRel(relTo);
    else return false;
  }
  return rel.startsWith("plugin/scripts/") || rel.startsWith("plugin/test/") || rel.startsWith("packages/");
}
function classifyEditInput(input, repoRoot2) {
  const fp = input && typeof input === "object" ? input.file_path : void 0;
  if (fp === void 0 || fp === null || String(fp).trim() === "") return "no-file-path";
  return isProductFile(fp, repoRoot2) ? "product" : "not-product";
}
function parseLine(line) {
  if (!line || !line.trim()) return null;
  try {
    const obj = JSON.parse(line);
    return obj && typeof obj === "object" ? obj : null;
  } catch {
    return null;
  }
}
function analyzeRecords(records, { repoRoot: repoRootOpt, since } = {}) {
  const root = repoRootOpt || repoRoot();
  const sinceMs = since ? Date.parse(since) : NaN;
  let mainThreadEdits = 0;
  let agentDispatches = 0;
  let totalEdits = 0;
  let editsNoFilePath = 0;
  for (const rec of records) {
    if (!rec || typeof rec !== "object") continue;
    const ts = typeof rec.timestamp === "string" ? Date.parse(rec.timestamp) : NaN;
    if (sinceMs && !Number.isNaN(sinceMs) && (!Number.isFinite(ts) || ts < sinceMs)) continue;
    const content = rec.message && typeof rec.message === "object" ? rec.message.content : void 0;
    if (!Array.isArray(content)) continue;
    for (const blk of content) {
      if (!blk || typeof blk !== "object") continue;
      if (blk.type !== "tool_use") continue;
      const name = blk.name;
      if (name === "Edit") {
        totalEdits++;
        const cls = classifyEditInput(blk.input, root);
        if (cls === "product") mainThreadEdits++;
        else if (cls === "no-file-path") editsNoFilePath++;
      } else if (name === "Agent") {
        agentDispatches++;
      }
    }
  }
  return {
    main_thread_edits: mainThreadEdits,
    agent_dispatches: agentDispatches,
    total_edits: totalEdits,
    edits_no_file_path: editsNoFilePath,
    since: since || null
  };
}
function loadTranscript(sessionPath) {
  const raw = fs2.readFileSync(sessionPath, "utf8");
  return raw.split("\n").map(parseLine);
}
function detectSession(repoRoot2, projectsDir = defaultProjectsDir(), { selfSessionId = process.env.CLAUDE_CODE_SESSION_ID } = {}) {
  const slug = repoSlug(repoRoot2);
  const candidates = [];
  const walk = (dir, depth) => {
    let entries;
    try {
      entries = fs2.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const abs = path3.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < 2) walk(abs, depth + 1);
      } else if (e.isFile() && e.name.endsWith(".jsonl")) {
        let st;
        try {
          st = fs2.statSync(abs);
        } catch {
          continue;
        }
        candidates.push({ abs, mtime: st.mtimeMs });
      }
    }
  };
  walk(projectsDir, 0);
  if (candidates.length === 0) return null;
  const nonSelf = selfSessionId ? candidates.filter((c) => path3.basename(c.abs) !== `${selfSessionId}.jsonl`) : candidates;
  if (nonSelf.length === 0) return null;
  const CWD_PROBE_LINES = 200;
  const scored = nonSelf.map((c) => {
    let score = 0;
    const parent = path3.basename(path3.dirname(c.abs));
    const grand = path3.basename(path3.dirname(path3.dirname(c.abs)));
    if (parent === slug || grand === slug) score += 2;
    if (score < 2) {
      try {
        const fh = fs2.openSync(c.abs, "r");
        const buf = Buffer.alloc(512 * 1024);
        const read = fs2.readSync(fh, buf, 0, buf.length, 0);
        fs2.closeSync(fh);
        const head = buf.subarray(0, read).toString("utf8");
        const lines = head.split("\n").slice(0, CWD_PROBE_LINES);
        for (const line of lines) {
          const obj = parseLine(line);
          if (obj && typeof obj.cwd === "string") {
            const c2 = obj.cwd;
            if (c2 === repoRoot2 || c2.startsWith(repoRoot2 + "/")) {
              score += 1;
              break;
            }
          }
        }
      } catch {
      }
    }
    return { abs: c.abs, mtime: c.mtime, score };
  });
  const maxScore = Math.max(...scored.map((s) => s.score));
  const top = scored.filter((s) => s.score === maxScore).sort((a, b) => b.mtime - a.mtime);
  return top.length > 0 ? top[0].abs : null;
}
function heuristicWarning(sessionPath) {
  return `\u672A\u6307\u5B9A --session\uFF1B\u9000\u5230\u542F\u53D1\u5F0F\u547D\u4E2D ${sessionPath}\uFF08\u591A\u4F1A\u8BDD\u62D3\u6251\u4E0B\u53EF\u80FD\u547D\u4E2D\u9519\u8BEF\u5BF9\u8C61\uFF09\u3002\u663E\u5F0F\u4F20 --session <path> \u6307\u5B9A\u8EAB\u4EFD\u3002`;
}
function resolveSessionPath(repoRoot2, projectsDir = defaultProjectsDir(), opts = {}) {
  const detected = detectSession(repoRoot2, projectsDir, { selfSessionId: opts.selfSessionId });
  if (detected) return { path: detected, source: "heuristic", warning: heuristicWarning(detected) };
  return { path: null, source: "none", warning: null };
}
var USAGE = `main-thread-edit-check.ts \u2014 \u4E3B\u7EBF\u7A0B Edit \u4EA7\u54C1\u6587\u4EF6\u6570 : Agent \u6D3E\u53D1\u6570\uFF08AC2/AC3\uFF09

Usage:
  node --no-warnings --experimental-strip-types plugin/scripts/main-thread-edit-check.ts [--session <path>] [--since <ISO>] [--root <dir>] [--json]

Options:
  --session <path>   transcript JSONL \u6587\u4EF6\uFF08\u7F3A\u7701\u542F\u53D1\u5F0F\u515C\u5E95\u4E14\u62A5 WARN\u2014\u2014pane pid \u663E\u5F0F\u8EAB\u4EFD\u53CD\u67E5\u5DF2\u9000\u5F79\uFF09
  --since <ISO>      \u53EA\u6570\u8BE5\u65F6\u523B\u4E4B\u540E\u7684\u5DE5\u5177\u8C03\u7528
  --root <dir>       \u4ED3\u5E93\u6839\uFF08\u4EA7\u54C1\u6587\u4EF6\u5206\u7C7B\u57FA\u51C6\uFF1B\u522B\u540D --repo-root\uFF1B\u7F3A\u7701\u81EA\u52A8\u68C0\u6D4B\uFF09
  --json             \u8F93\u51FA JSON`;
function main(argv = process.argv) {
  const args = argv.slice(2);
  const get = (name) => flagValue(args, name);
  const has = (name) => args.includes(name);
  const session = get("--session");
  const since = get("--since");
  const repoRootArg = get("--root") || get("--repo-root");
  const json = has("--json");
  if (has("--help") || has("-h")) {
    console.log(USAGE);
    return 0;
  }
  const root = repoRootArg ? path3.resolve(repoRootArg) : repoRoot();
  let sessionPath = session;
  let sessionSource = "arg";
  let sessionWarning = null;
  if (sessionPath) {
    sessionPath = path3.resolve(sessionPath);
    if (!fs2.existsSync(sessionPath)) {
      console.error(`main-thread-edit-check: --session \u6587\u4EF6\u4E0D\u5B58\u5728: ${sessionPath}`);
      return 2;
    }
  } else {
    const resolved = resolveSessionPath(root, defaultProjectsDir());
    sessionPath = resolved.path;
    sessionSource = resolved.source;
    sessionWarning = resolved.warning;
    if (!sessionPath) {
      const out2 = { main_thread_edits: 0, agent_dispatches: 0, total_edits: 0, edits_no_file_path: 0, session: null, session_source: "none", session_warning: null, repo_root: root, since: since || null, error: "no session transcript detected" };
      if (json) console.log(JSON.stringify(out2, null, 2));
      else {
        console.log(`session: (none detected under ${defaultProjectsDir()})`);
        console.log("main_thread_edits: 0");
        console.log("agent_dispatches: 0");
      }
      return 0;
    }
  }
  const records = loadTranscript(sessionPath);
  const res = analyzeRecords(records, { repoRoot: root, since });
  const out = { ...res, session: sessionPath, session_source: sessionSource, session_warning: sessionWarning, repo_root: root };
  if (json) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    if (sessionWarning) console.error(`WARNING: ${sessionWarning}`);
    console.log(`session: ${sessionPath}`);
    console.log(`session-source: ${sessionSource}`);
    console.log(`main_thread_edits: ${out.main_thread_edits}`);
    console.log(`agent_dispatches: ${out.agent_dispatches}`);
    console.log(`total_edits: ${out.total_edits}`);
    console.log(`edits_no_file_path: ${out.edits_no_file_path}`);
    if (since) console.log(`since: ${since}`);
  }
  return 0;
}
if (isDirectEntry(import.meta, void 0, "main-thread-edit-check")) {
  process.exitCode = main();
}
export {
  analyzeRecords,
  classifyEditInput,
  defaultProjectsDir,
  detectSession,
  heuristicWarning,
  isProductFile,
  loadTranscript,
  main,
  parseLine,
  repoSlug,
  resolveSessionPath
};
