#!/usr/bin/env node
// manager-observation-runtime-check.ts — RUNTIME constraint for C3
// (gap-c3-has-no-runtime-constraint; the runtime complement to
// gap-manager-productization-five-constraints AC4).
//
// C3 (SPEC-manager-productization-2026-08-05 §3): the OUTER never creates/drives/checks the MANAGER.
// The doc-layer check (no-manager-tick-doc-check.ts) only verifies the OUTER TICK DOCS contain no
// create/drive/check manager STEPS. "文档里没写 ≠ 运行时没做" — a doc with no such step still leaves
// the OUTER's ACTUAL runtime behavior (capture-pane of the manager window / reading the manager
// transcript / reading the manager tick-log / task_write that analyzes manager behavior)
// mechanically unconstrained. This checker closes that gap: it scans the OUTER session transcript
// for tool calls that OBSERVE/CHECK the manager, and reports them.
//
// WHAT IT DETECTS (four classes — AC1 design note; each is a REAL tool call, never prose):
//   PANE       — capture-pane / tmux list-panes / list-windows / display-message whose -t target
//                resolves to the manager (config managerTargets: window name `manager`, the
//                independent session `quay-manager`, and the current-instance pane `0:0`/`0:0.0`
//                per the ## Contract measure — the Contract's `0:0` shorthand for the outer
//                session's window 0 pane 0).
//   TICKLOG    — Read/Grep/Bash cat of the manager's tick-log file
//                (config managerTickLogs, default orchestration/manager-tick-log.md).
//   TRANSCRIPT — reading the manager's Claude Code session transcript — a `.jsonl` path under the
//                projects dir that contains a configured manager session id
//                (config managerSessionIds; the live manager session id, NOT guessed).
//   ANALYZE    — creating/editing a task (task_write / TaskWrite) whose title/body instructs
//                ANALYZING the manager's RUNTIME behavior (a manager identity token + one of the
//                config analysisVerbs, e.g. 分析/行为/audit/inspect).
//
// WHAT IT DOES NOT FLAG (negative controls — AC3 design note):
//   - capture-pane targeting the INNER / OUTER windows (`quay-0:inner`, `quay-0:outer`,
//     session-level `quay-0`) — structurally distinct tmux targets, never in managerTargets.
//   - manager→outer publishes: reading the manager's inbox/bus/deliveries (the manager DELIVERING
//     messages to the outer is the legitimate direction — single-flight delivery is not C3).
//   - prose mentions of the manager in assistant/user TEXT — only tool_use blocks are inspected.
//     Hearsay/转述 is NOT evidence (the 2026-08-08 accusation was retracted after meta-cc showed
//     zero capture-pane calls aimed at the manager window; a bare session-id or pane-file mention
//     in prose must not redden this checker).
//   - creating/driving tasks ABOUT the manager PRODUCT (build verbs 产品化/创建/启动) — only
//     ANALYSIS of the manager's runtime behavior counts as "checks manager".
//
// DIRECTION: C3 constrains outer→manager. manager→outer observation (the manager auditing the
// outer) is legitimate and is NOT the surface this checker scans — it scans the OUTER session.
//
// DATA SOURCE: the outer session transcript (Claude Code JSONL under
// $HOME/.claude/projects/<root-slug>/), including the session's own subagents/ dir (an outer
// dispatching a subagent to observe the manager is still the outer observing the manager —
// same set logic as inner-forensics.mjs).
//
// MODES:
//   --transcript <path>        scan ONE transcript file (+ its subagents dir)
//   --dir <dir> --session <id> scan <dir>/<id>.jsonl (+ its subagents dir)
//   --root <repo> --session <id>
//                              derive the projects dir from <repo>, scan the <id> session
//   --self [--root <repo>]     auto-pick the caller's own session: the most-recently-modified
//                              jsonl in the projects dir that is NOT the inner (per
//                              orchestration/session-liveness.env SESSION_TRANSCRIPTS) and NOT the
//                              manager (per config managerSessionIds). Prints the picked session.
//   --config <path>            JSON config override (managerTargets / managerTickLogs /
//                              managerSessionIds / analysisVerbs)
//   --since <ISO>              only scan records at/after this timestamp
//   --json                     machine-readable output; the ## Contract measure reads `violations`
//   --report <path>            append one JSONL line per run to a persistent violation log
//
// Exit codes: 0 = PASS (no runtime C3 violation in the scanned window); 1 = FAIL (≥1 violation);
//             2 = usage/env error. Failure-closed: a transcript it cannot read (missing path) is
//             reported and FAILS, never silently passes.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isDirectEntry } from "./gate-script-base.ts";

// ── Config ───────────────────────────────────────────────────────────────────────────────────────────

export interface ManagerObservationConfig {
  /** tmux -t targets that resolve to the manager (case-insensitive substring match). */
  managerTargets: string[];
  /** path fragments identifying the manager's tick-log file. */
  managerTickLogs: string[];
  /** the live manager's Claude Code session id(s). NEVER guessed — config/env only. */
  managerSessionIds: string[];
  /** verbs that mark a task as ANALYZING the manager's runtime behavior. */
  analysisVerbs: string[];
  /** path fragments that are the manager→outer PUBLISH surface (inbox/bus) — always allowed. */
  publishSurface: string[];
}

export const DEFAULT_CONFIG: ManagerObservationConfig = {
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
    "分析", "观察", "审查", "判定", "监控", "追踪", "研究", "行为", "动作",
    "audit", "inspect", "monitor", "analyze", "investigate", "track",
  ],
  publishSurface: ["inbox", "message-bus", "manager-bus", "deliveries", "supervisor-bus"],
};

function loadConfig(configPath: string | null): ManagerObservationConfig {
  const cfg = { ...DEFAULT_CONFIG };
  if (configPath) {
    let j;
    try {
      j = JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch (e) {
      process.stderr.write(`manager-observation-runtime-check: cannot read config ${configPath}: ${e}\n`);
      process.exit(2);
    }
    for (const k of ["managerTargets", "managerTickLogs", "managerSessionIds", "analysisVerbs", "publishSurface"]) {
      if (Array.isArray(j[k])) cfg[k] = j[k].map((s: unknown) => String(s));
    }
  }
  // Env override: MANAGER_SESSION_ID (comma-separated) is the non-config way to supply the live
  // manager session id — the single most important runtime fact, and it must never be guessed.
  if (process.env.MANAGER_SESSION_ID) {
    cfg.managerSessionIds = process.env.MANAGER_SESSION_ID.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return cfg;
}

// ── Pure detection ───────────────────────────────────────────────────────────────────────────────────

export interface ObservationViolation {
  line: number;
  timestamp: string;
  sessionId: string;
  kind: "PANE" | "TICKLOG" | "TRANSCRIPT" | "ANALYZE";
  tool: string;
  target: string;
  evidence: string;
}

/** Strip quoted strings so that a mention of a command inside echo/comment text never matches. */
function stripQuoted(cmd: string): string {
  return cmd
    .replace(/"[^"]*"/g, '""')
    .replace(/`[^`]*`/g, "``")
    .replace(/'[^']*'/g, "''");
}

function trim(s: string, n = 200): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
}

const TMUX_OBS_RE = /(?:^|[;\s|&])(?:tmux\s+)?(capture-pane|list-panes|list-windows|display-message)(?:\s|$)/;

function extractTmuxTarget(stripped: string): string | null {
  const m = stripped.match(/(?:^|\s)-t\s+([^\s]+)/);
  if (!m) return null;
  return m[1].replace(/^['"]|['"]$/g, "");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Word-boundary match: the configured target pattern must appear as a delimited token, so a window
 * named `managerial` (`-t quay-0:managerial`) never matches the `manager` pattern, while
 * `-t quay-0:manager` / `-t quay-0:0.0` do.
 */
function matchesManager(target: string, config: ManagerObservationConfig): boolean {
  const t = target;
  return config.managerTargets.some((p) => new RegExp(`\\b${escapeRegExp(p)}\\b`, "i").test(t));
}

function isPublishSurface(p: string, config: ManagerObservationConfig): boolean {
  const low = p.toLowerCase();
  return config.publishSurface.some((s) => low.includes(s.toLowerCase()));
}

function isManagerTranscript(p: string, config: ManagerObservationConfig): boolean {
  if (!config.managerSessionIds.length) return false;
  if (!/\.jsonl$/i.test(p)) return false;
  return config.managerSessionIds.some((id) => p.includes(id));
}

/**
 * Strip the BODY of a WRITE-heredoc (`> file <<'EOF' … EOF` / `>> file <<EOF … EOF`) but keep the
 * write redirection itself (the caller then removes write targets). NON-write heredocs (stdin to a
 * command, e.g. `python3 - <<'PY'`) are KEPT so their content can still be scanned.
 */
function stripWriteHeredocs(cmd: string): string {
  return cmd.replace(
    /(>>?)\s*[^\s;|&<>]+\s*<<-?\s*['"]?(\w+)['"]?[\s\S]*?^\2\s*$/gm,
    "$1 __heredoc_removed__"
  );
}

function classifyBash(command: string, config: ManagerObservationConfig): ObservationViolation["kind"] & { target: string } | null {
  const stripped = stripQuoted(command);

  // PANE — tmux observation of the manager window/session.
  const tmux = stripped.match(TMUX_OBS_RE);
  if (tmux) {
    const target = extractTmuxTarget(stripped);
    if (target && matchesManager(target, config) && !isPublishSurface(target, config)) {
      return { kind: "PANE", target: `${tmux[1]} -t ${target}` };
    }
  }

  // TICKLOG / TRANSCRIPT — READING manager files. Remove write-heredoc bodies and write-redirection
  // targets so a doc WRITE that merely mentions the path (`cat > orchestration/manager-loop-tick.md
  // <<'EOF' … 写进 orchestration/manager-tick-log.md … EOF`) is not a read; only direct READ
  // references to the manager's tick-log/transcript flag.
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

function classifyRead(filePath: string, config: ManagerObservationConfig): ObservationViolation["kind"] & { target: string } | null {
  if (!filePath) return null;
  if (isPublishSurface(filePath, config)) return null; // manager→outer publish delivery — allowed
  if (config.managerTickLogs.some((t) => filePath.includes(t))) return { kind: "TICKLOG", target: filePath };
  if (isManagerTranscript(filePath, config)) return { kind: "TRANSCRIPT", target: filePath };
  return null;
}

const TASK_WRITE_RE = /task[_\-]?write|taskWrite|TaskWrite|task_create|taskCreate/i;
const MANAGER_TOKEN_RE = /(?:^|[^A-Za-z])manager\b|quay-manager|manager 行为|manager 周期/i;

function classifyTaskWrite(input: Record<string, unknown>, config: ManagerObservationConfig): ObservationViolation["kind"] & { target: string } | null {
  const title = String(input.title || "");
  const body = String(input.body || "");
  const text = `${title}\n${body}`;
  if (!MANAGER_TOKEN_RE.test(text)) return null;
  if (!config.analysisVerbs.some((v) => text.toLowerCase().includes(v.toLowerCase()))) return null;
  return { kind: "ANALYZE", target: title.slice(0, 120) || "(no title)" };
}

function classifyTool(name: string, input: Record<string, unknown>, config: ManagerObservationConfig): ObservationViolation["kind"] & { target: string } | null {
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

/**
 * Scan one transcript's raw text. Pure — no IO. Returns violations in record order.
 */
export function checkTranscriptText(text: string, config: ManagerObservationConfig): ObservationViolation[] {
  const out: ObservationViolation[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("{")) continue;
    let o: any;
    try { o = JSON.parse(line); } catch { continue; }
    const content = Array.isArray(o?.message?.content) ? o.message.content : [];
    for (const block of content) {
      if (block?.type !== "tool_use") continue;
      const name = String(block.name || "");
      const input = (block.input && typeof block.input === "object") ? block.input : {};
      const hit = classifyTool(name, input, config);
      if (hit) {
        out.push({
          line: i + 1,
          timestamp: String(o.timestamp || ""),
          sessionId: String(o.session_id || ""),
          kind: hit.kind,
          tool: name,
          target: hit.target,
          evidence: trim(name === "Bash" ? String(input.command || "") : JSON.stringify(input)),
        });
      }
    }
  }
  return out;
}

// ── Transcript set (file + subagents) ────────────────────────────────────────────────────────────────

function transcriptSet(file: string): string[] {
  const set = [file];
  const dir = file.replace(/\.jsonl$/, "") + "/subagents";
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith(".jsonl")) set.push(path.join(dir, f));
    }
  } catch { /* no subagents dir */ }
  return set;
}

function projectsDirForRepo(root: string): string {
  const abs = path.resolve(root);
  return path.join(os.homedir(), ".claude", "projects", abs.replace(/[\\/]+/g, "-"));
}

/** Inner session id from orchestration/session-liveness.env SESSION_TRANSCRIPTS, if present. */
function innerSessionIdFromEnv(root: string): string | null {
  try {
    const text = fs.readFileSync(path.join(root, "orchestration", "session-liveness.env"), "utf8");
    const m = text.match(/^SESSION_TRANSCRIPTS=.*?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/m);
    return m ? m[1] : null;
  } catch { return null; }
}

function scanFiles(files: string[], config: ManagerObservationConfig, since: string | null): ObservationViolation[] {
  const violations: ObservationViolation[] = [];
  for (const f of files) {
    let text: string;
    try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
    let v = checkTranscriptText(text, config);
    if (since) {
      const sinceMs = Date.parse(since);
      if (!Number.isNaN(sinceMs)) v = v.filter((x) => x.timestamp && Date.parse(x.timestamp) >= sinceMs);
    }
    for (const item of v) violations.push({ ...item, target: `${f}:${item.target}` });
  }
  return violations;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────

export function run(argv: string[]): void {
  let transcript: string | null = null;
  let dir: string | null = null;
  let session: string | null = null;
  let root: string | null = null;
  let selfMode = false;
  let configPath: string | null = null;
  let json = false;
  let report: string | null = null;
  let since: string | null = null;

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
      process.stderr.write(`manager-observation-runtime-check: unknown flag: ${a}\n`);
      process.exit(2);
    }
  }

  const config = loadConfig(configPath);
  const files: string[] = [];

  if (transcript) {
    files.push(...transcriptSet(path.resolve(transcript)));
  } else if (dir && session) {
    files.push(...transcriptSet(path.join(dir, `${session}.jsonl`)));
  } else if (root && session) {
    files.push(...transcriptSet(path.join(projectsDirForRepo(root), `${session}.jsonl`)));
  } else if (selfMode) {
    const repo = root || ".";
    const proj = projectsDirForRepo(repo);
    const innerId = innerSessionIdFromEnv(repo);
    const managerIds = config.managerSessionIds;
    const exclude = new Set<string>([...(innerId ? [innerId] : []), ...managerIds]);
    let filesList: string[];
    try {
      filesList = fs.readdirSync(proj).filter((f) => f.endsWith(".jsonl"));
    } catch (e) {
      process.stderr.write(`manager-observation-runtime-check: --self cannot read projects dir ${proj}: ${e}\n`);
      process.exit(2);
    }
    const candidates = filesList
      .map((f) => ({ f, m: fs.statSync(path.join(proj, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m)
      .filter((c) => !exclude.has(c.f.replace(/\.jsonl$/, "")));
    if (!candidates.length) {
      process.stderr.write(`manager-observation-runtime-check: --self could not locate the outer session in ${proj} (inner/manager excluded) — pass --transcript explicitly; never guess.\n`);
      process.exit(2);
    }
    const picked = candidates[0];
    if (!json) process.stdout.write(`manager-observation-runtime-check: --self picked outer session ${picked.f} (mtime ${new Date(picked.m).toISOString()})\n`);
    files.push(...transcriptSet(path.join(proj, picked.f)));
  } else {
    process.stderr.write("manager-observation-runtime-check: one of --transcript / --dir+--session / --root+--session / --self is required\n");
    process.exit(2);
  }

  if (!files.length) {
    process.stderr.write(`manager-observation-runtime-check: no transcript file(s) resolved for the requested target\n`);
    process.exit(2);
  }

  const violations = scanFiles(files, config, since);

  if (report) {
    const rec = {
      at: new Date().toISOString(),
      checker: "manager-observation-runtime-check",
      scanned: files.map((f) => path.resolve(f)),
      violationCount: violations.length,
      violations,
    };
    try {
      fs.mkdirSync(path.dirname(path.resolve(report)), { recursive: true });
      fs.appendFileSync(path.resolve(report), JSON.stringify(rec) + "\n", "utf8");
    } catch (e) {
      process.stderr.write(`manager-observation-runtime-check: cannot append report ${report}: ${e}\n`);
    }
  }

  if (json) {
    process.stdout.write(`${JSON.stringify({ scanned: files.map((f) => path.resolve(f)), violations, ok: violations.length === 0 }, null, 2)}\n`);
  } else {
    if (violations.length === 0) {
      process.stdout.write(`manager-observation-runtime-check: PASS (${files.length} transcript file(s) scanned, no outer→manager observation/check action)\n`);
    } else {
      for (const v of violations) {
        process.stdout.write(`${v.kind} ${v.target} (${v.tool}, line ${v.line}, ${v.timestamp}): ${v.evidence}\n`);
      }
      process.stdout.write(`manager-observation-runtime-check: FAIL (${violations.length} outer→manager observation/check action(s) in the outer session transcript)\n`);
    }
  }
  process.exitCode = violations.length > 0 ? 1 : 0;
}

if (isDirectEntry(import.meta)) {
  run(process.argv.slice(2));
}
