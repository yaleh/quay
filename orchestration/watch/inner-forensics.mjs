#!/usr/bin/env node
// 内层会话取证：把外层的两类一次性分析做成可重复查询。
//
//   timecost [--since <ISO>]        时间成本分解（空转 / 全量套件 / 范围化测试 / 其它 / 生成）
//   verify <正则> [--since <ISO>]   内层到底跑没跑某条命令 —— 秒级、零 CPU 干扰
//
// 为什么不用 meta-cc（2026-08-02 实测，更正）：**不是因为脚本调不了 MCP** —— 实测可以，
// initialize → notifications/initialized → tools/call，行分隔 JSON-RPC，几十行代码。
// 真正的原因是 `jq_filter` 被忽略（判据：`.[] | .timestamp` 仍返回完整记录），无法定向查询；
// 全量 10,868 条 × ~2KB，拉 ~20MB 回来在客户端过滤比直接读 transcript 更差。
// **2026-08-02 晚更新**：meta-cc 已升级，jq_filter / tsv / session_id 全部修复，且
// `include_subagents` 默认 true（正是本文件后来才补上的盲区）。交叉验证：同一问题两边给出
// 7 条、时刻逐条一致。**此后 ad-hoc 核实优先用 meta-cc**；本文件保留是因为 Monitor 脚本要在
// shell 里跑，走 MCP 需要每个脚本抄一遍 spawn + JSON-RPC 握手的样板。
// 用 meta-cc 查内层时**必须传 session_id** —— 默认 scope 是 project，会混进外层自己的会话。
//
// 两条硬约束，来自 2026-08-02 外层自己犯的两个错：
//   1. 会话选择必须打印出来并给出指纹 —— 那天第一次分析选错了会话文件，
//      而错的会话同样能跑出一份看起来很干脆的结论。
//   2. 工具耗时必须由 tool_use / tool_result 按 id 配对得出 —— 那天第一版把
//      「某类条目之后的间隔」当成该类条目的耗时，归因方向是反的。

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PROJ = path.join(os.homedir(), ".claude", "projects", "-home-yale-work-quay");
const SELF = process.env.OUTER_SESSION || "b8dc91a6-64e8-4d70-a715-9ec8e16a4f11";

function pickInner() {
  const files = fs.readdirSync(PROJ).filter((f) => f.endsWith(".jsonl") && !f.includes(SELF))
    .map((f) => path.join(PROJ, f))
    .map((p) => ({ p, m: fs.statSync(p).mtimeMs, s: fs.statSync(p).size }))
    .sort((a, b) => b.m - a.m);
  if (!files.length) throw new Error("找不到内层会话文件");
  return files[0].p;
}

// 内层把任务派给 subagent 执行，而 subagent 的工具调用**不在主 transcript 里**——它们在
// <会话 UUID>/subagents/agent-*.jsonl。2026-08-02 实测：cost-model 派发后主 transcript 里
// 全量套件 0 命中，而 subagent transcript 正在活跃写入。不合并这些文件，本工具在最需要它的
// 场景（核实被委派的工作）完全失效。
function transcriptSet(file) {
  const set = [file];
  const dir = file.replace(/\.jsonl$/, "") + "/subagents";
  try {
    for (const f of fs.readdirSync(dir)) if (f.endsWith(".jsonl")) set.push(path.join(dir, f));
  } catch { /* 无 subagent 目录 */ }
  return set;
}

function load(file, sinceMs) {
  return transcriptSet(file).flatMap((f) => loadOne(f, sinceMs)).sort((a, b) => a.t - b.t);
}

function loadOne(file, sinceMs) {
  const out = [];
  let text; try { text = fs.readFileSync(file, "utf8"); } catch { return out; }
  for (const line of text.split("\n")) {
    if (!line.startsWith("{")) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (!o.timestamp) continue;
    const t = Date.parse(o.timestamp);
    if (sinceMs && t < sinceMs) continue;
    const c = Array.isArray(o.message?.content) ? o.message.content : [];
    out.push({
      t, type: o.type,
      uses: c.filter((x) => x?.type === "tool_use").map((x) => ({ id: x.id, name: x.name, input: x.input })),
      results: c.filter((x) => x?.type === "tool_result").map((x) => x.tool_use_id),
      text: c.filter((x) => x?.type === "text").map((x) => x.text).join(""),
    });
  }
  return out;
}

// 命令分类：全量套件 vs 范围化。
//
// 位置匹配，不匹配散文。2026-08-02 自检时初版把三条误判为全量套件：一条 `sed -i` 编辑了一个
// 提到 scripts/test.sh 的文件（耗时 1s），一条 `echo "…(scoped, faster)…"` 里带了字样。
// 这与同日 RISKY 检测器「匹配提交消息里的 revert 一词」是同一个病：**匹配了提到它的文本，
// 而不是执行了它的命令**。所以要求 test.sh 出现在命令位置——行首，或 `&&`/`;`/`|`/`(`/`time` 之后。
function stripQuoted(cmd) {
  return cmd.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');   // echo/sed 里的字样不算
}
function classify(name, input) {
  if (name !== "Bash") return name;
  const raw = input?.command || "";
  const cmd = stripQuoted(raw);
  const AT_CMD_POS = /(^|[\n;&|(]|\btime\s+|\bbash\s+)\s*(\.\/)?(scripts\/test\.sh|node\s+--test)\b/;
  if (AT_CMD_POS.test(cmd)) {
    return /--for-task|--group|\.test\.mjs|--list-/.test(cmd) ? "范围化测试" : "全量套件";
  }
  return "其它 Bash";
}

// /clear 会新建会话文件，auto-pick 只拿到最新那个。若请求窗口早于它的首条记录，
// 更早的历史就被**静默截断**了 —— 2026-08-02 实测：clear 后自动选中 0.4MB 的新会话，
// 而同一天 11MB 的旧会话不再可见，输出看起来完整。必须报出来。
function earlierSessions(file, sinceMs, firstMs) {
  if (!sinceMs || sinceMs >= firstMs) return [];
  const out = [];
  for (const f of fs.readdirSync(PROJ)) {
    if (!f.endsWith(".jsonl") || f.includes(SELF) || path.join(PROJ, f) === file) continue;
    const p2 = path.join(PROJ, f);
    let st; try { st = fs.statSync(p2); } catch { continue; }
    if (st.mtimeMs >= sinceMs) out.push({ f, mb: (st.size / 1e6).toFixed(1) });
  }
  return out;
}

function banner(file, rows, sinceMs) {
  const fp = fs.statSync(file);
  const set = transcriptSet(file);
  console.log(`会话文件 ${path.basename(file)}  ${(fp.size / 1e6).toFixed(1)}MB  ${rows.length} 条`
    + (set.length > 1 ? `  (含 ${set.length - 1} 个 subagent transcript)` : "  (无 subagent transcript)"));
  console.log(`窗口 ${sinceMs ? new Date(sinceMs).toISOString() : "(全部)"} → ${new Date(rows.at(-1).t).toISOString()}`);
  console.log(`指纹：首条 ${new Date(rows[0].t).toISOString()}  —— 若这不是你想分析的会话，用 --session 指定`);
  const earlier = earlierSessions(file, sinceMs, rows[0].t);
  if (earlier.length) {
    console.log(`\n  ⚠ 请求窗口早于本会话首条记录，${earlier.length} 个更早的会话未被包含（很可能是 /clear 造成的断裂）：`);
    for (const e of earlier) console.log(`      ${e.f.slice(0, 8)}  ${e.mb}MB   —— 用 --session ${e.f.replace(/\.jsonl$/, "")} 单独分析`);
    console.log(`     本次输出只覆盖 ${new Date(rows[0].t).toISOString()} 之后，不是完整窗口。`);
  }
  console.log("");
}

function timecost(file, sinceMs) {
  const rows = load(file, sinceMs);
  if (rows.length < 5) return console.log("窗口内数据不足");
  banner(file, rows, sinceMs);
  const span = rows.at(-1).t - rows[0].t;
  const pending = new Map(), tool = {}, cnt = {};
  for (const r of rows) {
    for (const id of r.results) {
      const p = pending.get(id);
      if (p) { pending.delete(id); const dt = r.t - p.t; if (dt < 3.6e6) { tool[p.k] = (tool[p.k] || 0) + dt; cnt[p.k] = (cnt[p.k] || 0) + 1; } }
    }
    for (const u of r.uses) pending.set(u.id, { k: classify(u.name, u.input), t: r.t });
  }
  // 空转 = 内层最后一次活动 → 下一条真人/外层指令
  let idle = 0; const idles = [];
  rows.forEach((r, i) => {
    if (r.type !== "user" || r.results.length) return;
    for (let j = i - 1; j >= 0; j--) if (rows[j].type === "assistant") {
      const d = r.t - rows[j].t; if (d > 60e3 && d < 7.2e6) { idle += d; idles.push(d); } break;
    }
  });
  const pct = (v) => `${(100 * v / span).toFixed(1)}%`;
  const hrs = (v) => `${(v / 3.6e6).toFixed(2)} 小时`;
  console.log(`跨度 ${hrs(span)}\n`);
  const med = idles.length ? idles.slice().sort((a, b) => a - b)[idles.length >> 1] / 6e4 : 0;
  console.log(`  空转等裁定      ${hrs(idle).padStart(11)}  ${pct(idle).padStart(6)}   ${idles.length} 次，中位 ${med.toFixed(0)} 分，最长 ${(Math.max(0, ...idles) / 6e4).toFixed(0)} 分`);
  let acc = idle;
  for (const [k, v] of Object.entries(tool).sort((a, b) => b[1] - a[1])) {
    if (v < 20e3) continue; acc += v;
    console.log(`  ${k.padEnd(14)}  ${hrs(v).padStart(11)}  ${pct(v).padStart(6)}   ${cnt[k]} 次`);
  }
  console.log(`  其余（生成等）  ${hrs(span - acc).padStart(11)}  ${pct(span - acc).padStart(6)}`);
}

// KIND 复用 classify()，与 timecost 同源 —— 2026-08-02 自检时 verify 用手写正则得到 0 命中，
// 而同一份数据 timecost 报 8 次全量套件。两处各自判断「什么算全量套件」必然分歧，改为单一来源。
const KINDS = new Set(["全量套件", "范围化测试", "其它 Bash"]);

function verify(file, sinceMs, pattern) {
  const rows = load(file, sinceMs);
  const byKind = KINDS.has(pattern);
  const re = byKind ? null : new RegExp(pattern, "i");
  if (!rows.length) return console.log("窗口内无数据");
  banner(file, rows, sinceMs);
  const pending = new Map(), hits = [];
  for (const r of rows) {
    for (const id of r.results) {
      const p = pending.get(id);
      if (p) { pending.delete(id); hits.push({ ...p, dur: r.t - p.t }); }
    }
    for (const u of r.uses) {
      const s = u.name === "Bash" ? (u.input?.command || "") : JSON.stringify(u.input || {});
      const hit = byKind ? classify(u.name, u.input) === pattern : re.test(s);
      if (hit) pending.set(u.id, { t: r.t, name: u.name, cmd: s.replace(/\s+/g, " ").slice(0, 100) });
    }
  }
  console.log(`${byKind ? `类别「${pattern}」` : `匹配 /${pattern}/`} 的调用：${hits.length} 次\n`);
  for (const h of hits) {
    console.log(`  ${new Date(h.t).toISOString().slice(11, 19)}  ${(h.dur / 1000).toFixed(0).padStart(4)}s  ${h.cmd}`);
  }
  if (!hits.length) {
    console.log("  —— 零命中。");
    console.log("  ⚠ 零命中与「查询写错了」不可区分，不要直接当作「内层没做过」。");
    if (!byKind) console.log("     先用类别形式复核：verify 全量套件 / 范围化测试 / 其它 Bash（与 timecost 同源，不会分歧）。");
    console.log("     确认查询正确后，零命中才是「该声称未被 transcript 证实」。");
  }
  const total = hits.reduce((a, h) => a + h.dur, 0);
  if (hits.length) console.log(`\n  合计 ${(total / 6e4).toFixed(1)} 分钟，均 ${(total / hits.length / 1000).toFixed(0)}s`);
}

const argv = process.argv.slice(2);
const cmd = argv[0];
const sinceArg = argv.includes("--since") ? argv[argv.indexOf("--since") + 1] : null;
const sessArg = argv.includes("--session") ? argv[argv.indexOf("--session") + 1] : null;
const sinceMs = sinceArg ? Date.parse(sinceArg) : null;
const file = sessArg ? (sessArg.includes("/") ? sessArg : path.join(PROJ, sessArg + ".jsonl")) : pickInner();

if (cmd === "timecost") timecost(file, sinceMs);
else if (cmd === "verify") verify(file, sinceMs, argv[1] || ".");
else {
  console.log("用法:\n  inner-forensics.mjs timecost [--since <ISO>] [--session <id|path>]");
  console.log("  inner-forensics.mjs verify <正则> [--since <ISO>] [--session <id|path>]");
  process.exit(2);
}
