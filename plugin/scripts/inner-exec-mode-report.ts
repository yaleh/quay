#!/usr/bin/env node
// @instrument "How many times did the main thread directly Edit a product file this round, versus how many Agent dispatches did it make (inner exec-mode report)?"
// plugin/scripts/inner-exec-mode-report.ts — inner 执行模式的两数机械采集器
// (tasks/gap-inner-serial-main-thread-not-dispatch, AC2/AC3)。
//
// 回答的能力：把「inner 是主线程串行做实现、还是派 subagent 并行做实现」从散文变成两个可核的数 ——
// 主线程 Edit 产品文件数 : Agent 派发数。判据（机械可核，Contract band）：
//   常规轮次 agent_dispatches ≥ 1（或非红窗时 main_thread_edits 不大幅 > agent_dispatches）。
//   主线程 Edit 产品文件数远大于 Agent 派发数、且当轮非红窗 ⇒ 违反「常规 ready 任务实现必须派 subagent」。
// 红窗快修（suite-red 分诊的即时修复）与任务立案/编排在主线程做是白名单内，不判违（AC3）——
// 白名单是 tick 文档的散文规则，本 helper 只报数、不裁决；上层按「当轮是否红窗」读判据。
//
// 计数定义（deterministic）:
//   main_thread_edits   = transcript 中 tool_use name==="Edit" 且 input.file_path 指向
//                         产品文件（plugin/scripts/、plugin/test/、packages/ 之下）的次数。
//                         tasks/ 与 docs/（含 orchestration/、plugin/loop/ 的 .md）不算产品文件。
//   edits_no_file_path  = tool_use name==="Edit" 但 input 无 file_path 的次数（罕见；单列诊断）。
//                         选择：计数并单列，不跳过 —— 跳过会静默少报（负控制）；也不计入
//                         main_thread_edits（无法分类就不是「产品文件 Edit」）。
//   agent_dispatches    = transcript 中 tool_use name==="Agent" 的次数。
//
// 读取：会话 transcript JSONL（~/.claude/projects/<slug>/<session>.jsonl）。行是 JSON 对象，
//   type 字段区分记录（"assistant" 等），assistant 的 message.content 数组含
//   {"type":"tool_use","name":...,"input":{...}} 块。解析容忍：畸形行跳过（不中断计数）。
//
// 用法:
//   node --no-warnings --experimental-strip-types plugin/scripts/inner-exec-mode-report.ts --json
//   node --no-warnings --experimental-strip-types plugin/scripts/inner-exec-mode-report.ts --session <path> [--since <ISO>] [--json]
//   node --no-warnings --experimental-strip-types plugin/scripts/inner-exec-mode-report.ts --repo-root <dir> --session <path> --json
//
// 参数:
//   --session <path>   显式指定 transcript 文件（不存在 ⇒ 报错退出 2）。
//   --since <ISO>      只数 timestamp >= 该时刻之后的工具调用（一轮 tick 报「本轮」）。
//   --repo-root <dir>  覆盖仓库根（产品文件分类的基准；默认向上找 .quay/config.yml / git root）。
//   --json             输出 JSON 对象（Contract invoke 的读取形态）。
//   缺省 --session     自动检测：~/.claude/projects/ 下最新 .jsonl，优先父目录名匹配仓库 slug
//                      或记录 cwd 匹配仓库根的会话。测试接缝：INNER_EXEC_MODE_PROJECTS_DIR
//                      覆盖 projects 目录（同其它脚本的 env 接缝约定）。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isDirectEntry } from "./gate-script-base.ts";

// ── Repo-root 检测（与 select-tests-for-touches.ts 同形态：.quay/config.yml 优先，git 兜底）──

export function findRepoRoot(startDir = path.dirname(fileURLToPath(import.meta.url))) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, ".quay", "config.yml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return process.cwd();
  }
}

/** 仓库 slug = ~/.claude/projects 下目录名的形态：/home/yale/work/quay → -home-yale-work-quay。 */
export function repoSlug(repoRoot) {
  return "-" + String(repoRoot).replace(/\\/g, "/").split("/").filter(Boolean).join("-");
}

/** projects 目录（可被 INNER_EXEC_MODE_PROJECTS_DIR 覆盖 —— 测试接缝）。 */
export function defaultProjectsDir(env = process.env) {
  return env.INNER_EXEC_MODE_PROJECTS_DIR || path.join(os.homedir(), ".claude", "projects");
}

/** 规范化相对路径（去 ./、//、尾 /，解析 ..）。 */
export function normalizeRel(p) {
  const parts = String(p).replace(/\\/g, "/").split("/");
  const out = [];
  for (const seg of parts) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") { out.pop(); continue; }
    out.push(seg);
  }
  return out.join("/");
}

/**
 * 一个 Edit 的 file_path 是否指向产品文件（plugin/scripts/、plugin/test/、packages/ 之下）。
 * tasks/ 与 docs/（含 orchestration/、plugin/loop/ 的 .md）不算产品文件。
 * 绝对路径在 repoRoot 之外 ⇒ 不算产品文件（主线程编辑 worktree 产物是罕见形态，保守不算）。
 */
export function isProductFile(filePath, repoRoot) {
  if (!filePath) return false;
  const raw = String(filePath);
  const abs = path.resolve(repoRoot, raw);
  let rel = normalizeRel(raw);
  if (path.isAbsolute(raw)) {
    const relTo = path.relative(repoRoot, abs);
    // repoRoot 内才收编为仓库相对路径；外部（../ 起）→ 非产品文件。
    if (relTo && !relTo.startsWith("..") && !path.isAbsolute(relTo)) rel = normalizeRel(relTo);
    else return false;
  }
  return (
    rel.startsWith("plugin/scripts/") ||
    rel.startsWith("plugin/test/") ||
    rel.startsWith("packages/")
  );
}

/**
 * 分类一个 Edit tool_use input。
 * @returns {'product'|'not-product'|'no-file-path'}
 */
export function classifyEditInput(input, repoRoot) {
  const fp = input && typeof input === "object" ? input.file_path : undefined;
  if (fp === undefined || fp === null || String(fp).trim() === "") return "no-file-path";
  return isProductFile(fp, repoRoot) ? "product" : "not-product";
}

/** 容忍解析一行 transcript JSON；畸形行返回 null。 */
export function parseLine(line) {
  if (!line || !line.trim()) return null;
  try {
    const obj = JSON.parse(line);
    return obj && typeof obj === "object" ? obj : null;
  } catch {
    return null;
  }
}

/**
 * 核心计数：扫一遍 transcript 记录数组，数主线程 Edit 产品文件数 / Agent 派发数。
 * @param {Array<object|null>} records
 * @param {{repoRoot: string, since?: string}} opts
 * @returns {{main_thread_edits:number, agent_dispatches:number, total_edits:number,
 *            edits_no_file_path:number, since:string|null}}
 */
export function analyzeRecords(records, { repoRoot, since } = {}) {
  const root = repoRoot || findRepoRoot();
  const sinceMs = since ? Date.parse(since) : NaN;
  let mainThreadEdits = 0;
  let agentDispatches = 0;
  let totalEdits = 0;
  let editsNoFilePath = 0;

  for (const rec of records) {
    if (!rec || typeof rec !== "object") continue;
    const ts = typeof rec.timestamp === "string" ? Date.parse(rec.timestamp) : NaN;
    if (sinceMs && !Number.isNaN(sinceMs) && (!Number.isFinite(ts) || ts < sinceMs)) continue;
    const content = rec.message && typeof rec.message === "object" ? rec.message.content : undefined;
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
    since: since || null,
  };
}

/** 读一个 transcript 文件，容忍跳过畸形行。 */
export function loadTranscript(sessionPath) {
  const raw = fs.readFileSync(sessionPath, "utf8");
  return raw.split("\n").map(parseLine);
}

// ── 自动检测会话（缺省 --session 时的兜底）──────────────────────────────────────────────────────────

/**
 * 在 projectsDir 下找候选 .jsonl 并评分：
 *   +2  父目录（或祖父目录）名 === repoSlug(repoRoot)   —— 仓库专属会话目录
 *   +1  记录 cwd 以 repoRoot 开头（cwd 探测，只看每个候选的前 CWD_PROBE_LINES 行）
 * 同分取 mtime 最新。
 */
export function detectSession(repoRoot, projectsDir = defaultProjectsDir()) {
  const slug = repoSlug(repoRoot);
  const candidates = [];
  const walk = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < 2) walk(abs, depth + 1);
      } else if (e.isFile() && e.name.endsWith(".jsonl")) {
        let st;
        try { st = fs.statSync(abs); } catch { continue; }
        candidates.push({ abs, mtime: st.mtimeMs });
      }
    }
  };
  walk(projectsDir, 0);
  if (candidates.length === 0) return null;

  const CWD_PROBE_LINES = 200;
  const scored = candidates.map((c) => {
    let score = 0;
    const parent = path.basename(path.dirname(c.abs));
    const grand = path.basename(path.dirname(path.dirname(c.abs)));
    if (parent === slug || grand === slug) score += 2;
    if (score < 2) {
      // cwd 探测：读前 CWD_PROBE_LINES 行，任一行 cwd 匹配仓库根即加分。
      try {
        const fh = fs.openSync(c.abs, "r");
        const buf = Buffer.alloc(512 * 1024);
        const read = fs.readSync(fh, buf, 0, buf.length, 0);
        fs.closeSync(fh);
        const head = buf.subarray(0, read).toString("utf8");
        const lines = head.split("\n").slice(0, CWD_PROBE_LINES);
        for (const line of lines) {
          const obj = parseLine(line);
          if (obj && typeof obj.cwd === "string") {
            const c = obj.cwd;
            if (c === repoRoot || c.startsWith(repoRoot + "/")) { score += 1; break; }
          }
        }
      } catch { /* 读失败不算分 */ }
    }
    return { abs: c.abs, mtime: c.mtime, score };
  });

  const maxScore = Math.max(...scored.map((s) => s.score));
  const top = scored
    .filter((s) => s.score === maxScore)
    .sort((a, b) => b.mtime - a.mtime);
  return top.length > 0 ? top[0].abs : null;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────

const USAGE = `inner-exec-mode-report.ts — 主线程 Edit 产品文件数 : Agent 派发数（AC2/AC3）

Usage:
  node --no-warnings --experimental-strip-types plugin/scripts/inner-exec-mode-report.ts [--session <path>] [--since <ISO>] [--repo-root <dir>] [--json]

Options:
  --session <path>   transcript JSONL 文件（缺省自动检测最新匹配会话）
  --since <ISO>      只数该时刻之后的工具调用
  --repo-root <dir>  仓库根（产品文件分类基准；缺省自动检测）
  --json             输出 JSON`;

export function main(argv = process.argv) {
  const args = argv.slice(2);
  const get = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const has = (name) => args.includes(name);
  const session = get("--session");
  const since = get("--since");
  const repoRootArg = get("--repo-root");
  const json = has("--json");

  if (has("--help") || has("-h")) { console.log(USAGE); return 0; }

  const repoRoot = repoRootArg ? path.resolve(repoRootArg) : findRepoRoot();
  let sessionPath = session;
  if (sessionPath) {
    sessionPath = path.resolve(sessionPath);
    if (!fs.existsSync(sessionPath)) {
      console.error(`inner-exec-mode-report: --session 文件不存在: ${sessionPath}`);
      return 2;
    }
  } else {
    sessionPath = detectSession(repoRoot);
    if (!sessionPath) {
      const out = { main_thread_edits: 0, agent_dispatches: 0, total_edits: 0, edits_no_file_path: 0, session: null, repo_root: repoRoot, since: since || null, error: "no session transcript detected" };
      if (json) console.log(JSON.stringify(out, null, 2));
      else { console.log(`session: (none detected under ${defaultProjectsDir()})`); console.log("main_thread_edits: 0"); console.log("agent_dispatches: 0"); }
      return 0;
    }
  }

  const records = loadTranscript(sessionPath);
  const res = analyzeRecords(records, { repoRoot, since });
  const out = { ...res, session: sessionPath, repo_root: repoRoot };

  if (json) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`session: ${sessionPath}`);
    console.log(`main_thread_edits: ${out.main_thread_edits}`);
    console.log(`agent_dispatches: ${out.agent_dispatches}`);
    console.log(`total_edits: ${out.total_edits}`);
    console.log(`edits_no_file_path: ${out.edits_no_file_path}`);
    if (since) console.log(`since: ${since}`);
  }
  return 0;
}

// 直接运行入口（import 时不执行）。
if (isDirectEntry(import.meta)) {
  process.exitCode = main();
}
