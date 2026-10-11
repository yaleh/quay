#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/manager-observation-runtime-check.ts
import fs from "node:fs";
import os from "node:os";
import path2 from "node:path";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
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

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/manager-observation-runtime-check.ts
var DEFAULT_CONFIG = {
  // Structural, layout-independent manager identities:
  //   `manager`     = the manager window name (manager-start.sh `-n manager`);
  //   `quay-manager` = the manager's independent tmux session (manager-start.sh default).
  // The ## Contract's current-instance pane forms (`0:0` / `0:0.0`, the outer session's window 0
  // pane 0) are deliberately NOT defaults: window numbering is layout-dependent — a real scan of the
  // outer transcript found `capture-pane -t quay-0:0.0` aimed at the INNER on 2026-08-02 (the inner
  // was window 0 in that layout), which would have been a false positive under AC3. Operators who
  // want the current-instance pane covered add it to `managerTargets` via --config / env; never
  // assume window 0 is the manager.
  managerTargets: ["manager", "quay-manager"],
  managerTickLogs: ["orchestration/manager-tick-log.md"],
  managerSessionIds: [],
  analysisVerbs: [
    "\u5206\u6790",
    "\u89C2\u5BDF",
    "\u5BA1\u67E5",
    "\u5224\u5B9A",
    "\u76D1\u63A7",
    "\u8FFD\u8E2A",
    "\u7814\u7A76",
    "\u884C\u4E3A",
    "\u52A8\u4F5C",
    "audit",
    "inspect",
    "monitor",
    "analyze",
    "investigate",
    "track"
  ],
  publishSurface: ["inbox", "message-bus", "manager-bus", "deliveries", "supervisor-bus"]
};
function loadConfig(configPath) {
  const cfg = { ...DEFAULT_CONFIG };
  if (configPath) {
    let j;
    try {
      j = JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch (e) {
      process.stderr.write(`manager-observation-runtime-check: cannot read config ${configPath}: ${e}
`);
      process.exit(2);
    }
    for (const k of ["managerTargets", "managerTickLogs", "managerSessionIds", "analysisVerbs", "publishSurface"]) {
      if (Array.isArray(j[k])) cfg[k] = j[k].map((s) => String(s));
    }
  }
  if (process.env.MANAGER_SESSION_ID) {
    cfg.managerSessionIds = process.env.MANAGER_SESSION_ID.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return cfg;
}
function stripQuoted(cmd) {
  return cmd.replace(/"[^"]*"/g, '""').replace(/`[^`]*`/g, "``").replace(/'[^']*'/g, "''");
}
function trim(s, n = 200) {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "\u2026" : t;
}
var TMUX_OBS_RE = /(?:^|[;\s|&])(?:tmux\s+)?(capture-pane|list-panes|list-windows|display-message)(?:\s|$)/;
function extractTmuxTarget(stripped) {
  const m = stripped.match(/(?:^|\s)-t\s+([^\s]+)/);
  if (!m) return null;
  return m[1].replace(/^['"]|['"]$/g, "");
}
function matchesManager(target, config) {
  const t = target;
  return config.managerTargets.some((p) => new RegExp(`\\b${escapeRegExp(p)}\\b`, "i").test(t));
}
function isPublishSurface(p, config) {
  const low = p.toLowerCase();
  return config.publishSurface.some((s) => low.includes(s.toLowerCase()));
}
function isManagerTranscript(p, config) {
  if (!config.managerSessionIds.length) return false;
  if (!/\.jsonl$/i.test(p)) return false;
  return config.managerSessionIds.some((id) => p.includes(id));
}
function stripWriteHeredocs(cmd) {
  return cmd.replace(
    /(>>?)\s*[^\s;|&<>]+\s*<<-?\s*['"]?(\w+)['"]?[\s\S]*?^\2\s*$/gm,
    "$1 __heredoc_removed__"
  );
}
function classifyBash(command, config) {
  const stripped = stripQuoted(command);
  const tmux = stripped.match(TMUX_OBS_RE);
  if (tmux) {
    const target = extractTmuxTarget(stripped);
    if (target && matchesManager(target, config) && !isPublishSurface(target, config)) {
      return { kind: "PANE", target: `${tmux[1]} -t ${target}` };
    }
  }
  const noWriteHeredoc = stripWriteHeredocs(stripped);
  const noWriteRedir = noWriteHeredoc.replace(/>>?\s*[^\s;|&<>]+/g, " ");
  const tokens = noWriteRedir.match(/(?:^|\s)([\w./~:@$-]+)/g) || [];
  for (const raw of tokens) {
    const p = raw.trim();
    if (!p) continue;
    if (config.managerTickLogs.some((t) => p.includes(t)) && !isPublishSurface(p, config)) {
      return { kind: "TICKLOG", target: p };
    }
    if (isManagerTranscript(p, config)) {
      return { kind: "TRANSCRIPT", target: p };
    }
  }
  return null;
}
function classifyRead(filePath, config) {
  if (!filePath) return null;
  if (isPublishSurface(filePath, config)) return null;
  if (config.managerTickLogs.some((t) => filePath.includes(t))) return { kind: "TICKLOG", target: filePath };
  if (isManagerTranscript(filePath, config)) return { kind: "TRANSCRIPT", target: filePath };
  return null;
}
var TASK_WRITE_RE = /task[_\-]?write|taskWrite|TaskWrite|task_create|taskCreate/i;
var MANAGER_TOKEN_RE = /(?:^|[^A-Za-z])manager\b|quay-manager|manager 行为|manager 周期/i;
function classifyTaskWrite(input, config) {
  const title = String(input.title || "");
  const body = String(input.body || "");
  const text = `${title}
${body}`;
  if (!MANAGER_TOKEN_RE.test(text)) return null;
  if (!config.analysisVerbs.some((v) => text.toLowerCase().includes(v.toLowerCase()))) return null;
  return { kind: "ANALYZE", target: title.slice(0, 120) || "(no title)" };
}
function classifyTool(name, input, config) {
  if (name === "Bash") return classifyBash(String(input.command || ""), config);
  if (name === "Read") return classifyRead(String(input.file_path || ""), config);
  if (name === "Grep") {
    const target = [input.path, input.pattern].filter(Boolean).map(String).join(" ");
    if (isPublishSurface(target, config)) return null;
    if (config.managerTickLogs.some((t) => target.includes(t))) return { kind: "TICKLOG", target };
    if (isManagerTranscript(target, config)) return { kind: "TRANSCRIPT", target };
    return null;
  }
  if (TASK_WRITE_RE.test(name)) return classifyTaskWrite(input, config);
  return null;
}
function checkTranscriptText(text, config) {
  const out = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("{")) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const content = Array.isArray(o?.message?.content) ? o.message.content : [];
    for (const block of content) {
      if (block?.type !== "tool_use") continue;
      const name = String(block.name || "");
      const input = block.input && typeof block.input === "object" ? block.input : {};
      const hit = classifyTool(name, input, config);
      if (hit) {
        out.push({
          line: i + 1,
          timestamp: String(o.timestamp || ""),
          sessionId: String(o.session_id || ""),
          kind: hit.kind,
          tool: name,
          target: hit.target,
          evidence: trim(name === "Bash" ? String(input.command || "") : JSON.stringify(input))
        });
      }
    }
  }
  return out;
}
function transcriptSet(file) {
  const set = [file];
  const dir = file.replace(/\.jsonl$/, "") + "/subagents";
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith(".jsonl")) set.push(path2.join(dir, f));
    }
  } catch {
  }
  return set;
}
function projectsDirForRepo(root) {
  const abs = path2.resolve(root);
  return path2.join(os.homedir(), ".claude", "projects", abs.replace(/[\\/]+/g, "-"));
}
function innerSessionIdFromEnv(root) {
  try {
    const text = fs.readFileSync(path2.join(root, "orchestration", "session-liveness.env"), "utf8");
    const m = text.match(/^SESSION_TRANSCRIPTS=.*?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}
function scanFiles(files, config, since) {
  const violations = [];
  for (const f of files) {
    let text;
    try {
      text = fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    let v = checkTranscriptText(text, config);
    if (since) {
      const sinceMs = Date.parse(since);
      if (!Number.isNaN(sinceMs)) v = v.filter((x) => x.timestamp && Date.parse(x.timestamp) >= sinceMs);
    }
    for (const item of v) violations.push({ ...item, target: `${f}:${item.target}` });
  }
  return violations;
}
function run(argv) {
  let transcript = null;
  let dir = null;
  let session = null;
  let root = null;
  let selfMode = false;
  let configPath = null;
  let json = false;
  let report = null;
  let since = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--transcript") transcript = argv[++i];
    else if (a === "--dir") dir = argv[++i];
    else if (a === "--session") session = argv[++i];
    else if (a === "--root") root = argv[++i];
    else if (a === "--self") selfMode = true;
    else if (a === "--config") configPath = argv[++i];
    else if (a === "--since") since = argv[++i];
    else if (a === "--report") report = argv[++i];
    else if (a === "--json") json = true;
    else if (a === "--help" || a === "-h") {
      process.stdout.write(
        "manager-observation-runtime-check.ts [--transcript <jsonl> | --dir <dir> --session <id> | --root <repo> --session <id> | --self [--root <repo>]] [--config <json>] [--since <ISO>] [--json] [--report <path>]\n"
      );
      process.exit(0);
    } else {
      process.stderr.write(`manager-observation-runtime-check: unknown flag: ${a}
`);
      process.exit(2);
    }
  }
  const config = loadConfig(configPath);
  const files = [];
  if (transcript) {
    files.push(...transcriptSet(path2.resolve(transcript)));
  } else if (dir && session) {
    files.push(...transcriptSet(path2.join(dir, `${session}.jsonl`)));
  } else if (root && session) {
    files.push(...transcriptSet(path2.join(projectsDirForRepo(root), `${session}.jsonl`)));
  } else if (selfMode) {
    const repo = root || ".";
    const proj = projectsDirForRepo(repo);
    const innerId = innerSessionIdFromEnv(repo);
    const managerIds = config.managerSessionIds;
    const exclude = /* @__PURE__ */ new Set([...innerId ? [innerId] : [], ...managerIds]);
    let filesList;
    try {
      filesList = fs.readdirSync(proj).filter((f) => f.endsWith(".jsonl"));
    } catch (e) {
      process.stderr.write(`manager-observation-runtime-check: --self cannot read projects dir ${proj}: ${e}
`);
      process.exit(2);
    }
    const candidates = filesList.map((f) => ({ f, m: fs.statSync(path2.join(proj, f)).mtimeMs })).sort((a, b) => b.m - a.m).filter((c) => !exclude.has(c.f.replace(/\.jsonl$/, "")));
    if (!candidates.length) {
      process.stderr.write(`manager-observation-runtime-check: --self could not locate the outer session in ${proj} (inner/manager excluded) \u2014 pass --transcript explicitly; never guess.
`);
      process.exit(2);
    }
    const picked = candidates[0];
    if (!json) process.stdout.write(`manager-observation-runtime-check: --self picked outer session ${picked.f} (mtime ${new Date(picked.m).toISOString()})
`);
    files.push(...transcriptSet(path2.join(proj, picked.f)));
  } else {
    process.stderr.write("manager-observation-runtime-check: one of --transcript / --dir+--session / --root+--session / --self is required\n");
    process.exit(2);
  }
  if (!files.length) {
    process.stderr.write(`manager-observation-runtime-check: no transcript file(s) resolved for the requested target
`);
    process.exit(2);
  }
  const violations = scanFiles(files, config, since);
  if (report) {
    const rec = {
      at: (/* @__PURE__ */ new Date()).toISOString(),
      checker: "manager-observation-runtime-check",
      scanned: files.map((f) => path2.resolve(f)),
      violationCount: violations.length,
      violations
    };
    try {
      fs.mkdirSync(path2.dirname(path2.resolve(report)), { recursive: true });
      fs.appendFileSync(path2.resolve(report), JSON.stringify(rec) + "\n", "utf8");
    } catch (e) {
      process.stderr.write(`manager-observation-runtime-check: cannot append report ${report}: ${e}
`);
    }
  }
  if (json) {
    process.stdout.write(`${JSON.stringify({ scanned: files.map((f) => path2.resolve(f)), violations, ok: violations.length === 0 }, null, 2)}
`);
  } else {
    if (violations.length === 0) {
      process.stdout.write(`manager-observation-runtime-check: PASS (${files.length} transcript file(s) scanned, no outer\u2192manager observation/check action)
`);
    } else {
      for (const v of violations) {
        process.stdout.write(`${v.kind} ${v.target} (${v.tool}, line ${v.line}, ${v.timestamp}): ${v.evidence}
`);
      }
      process.stdout.write(`manager-observation-runtime-check: FAIL (${violations.length} outer\u2192manager observation/check action(s) in the outer session transcript)
`);
    }
  }
  process.exitCode = violations.length > 0 ? 1 : 0;
}
if (isDirectEntry(import.meta, void 0, "manager-observation-runtime-check")) {
  run(process.argv.slice(2));
}
export {
  DEFAULT_CONFIG,
  checkTranscriptText,
  run
};
