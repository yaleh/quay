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
//
// 2026-08-03 gap-inner-forensics-verify-reports-nonruns-and-zero-durations 的三个修复：
//   1. 分类按代码位置：剥离单引号/双引号/反引号内的内容后再匹配 test.sh —— 照抄
//      plugin/scripts/test-framework-policy-check.ts 的 import 检测做法（字符串不参与匹配）。
//   2. 耗时取真实值：后台命令（run_in_background）的即时 tool_result 只回「running in
//      background」，真实完成时刻在 <task-notification> 里 —— 用它配对；取不到时报「未知」
//      而不是 0（0s 与「没测到」不可区分）。
//   3. 会话归属：`--session` 未指定时只把与目标 pane 同源的会话计入「更早会话」；
//      归属不同的会话（如外层人开的 fork）列出但不计入，并说明「可能属于其它会话」。

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

// 可注入：测试把 PROJ 指到临时目录（INNER_FORENSICS_PROJ 或 _setProj）。
// 默认会话目录自定位（gap-loop-mechanism-lives-outside-the-package-and-cannot-ship）：本文件已迁入
// plugin/scripts/（旧路径 orchestration/watch/ 已删，调用方全部改用本路径）。Claude Code 的会话
// 目录名是把项目根的 / 换成 -（如 /home/yale/work/<project> 这类根 → -home-yale-work-<project>
// 这类目录名）。从本文件位置推导根，不再硬编码任何绝对仓库路径 —— 经得起「quay 开发树改名」
// 负控制，也随 quay-init --loop 铺到目标项目后直接可用。
const _IF_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let PROJ = process.env.INNER_FORENSICS_PROJ || path.join(os.homedir(), ".claude", "projects", _IF_ROOT.replace(/[\\/]+/g, "-"));
export function _setProj(p) { PROJ = p; }

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

// 从一条记录里解析 <task-notification> 的完成信号（后台命令的真实完成时刻）。
// queue-operation 记录的 content 是字符串；user 类型把同样的通知放在 message.content 字符串里。
function parseNotifs(text) {
  const out = [];
  if (typeof text !== "string" || !text.includes("<task-notification>")) return out;
  const ids = [...text.matchAll(/<tool-use-id>(.*?)<\/tool-use-id>/g)].map((m) => m[1]);
  const statuses = [...text.matchAll(/<status>(.*?)<\/status>/g)].map((m) => m[1]);
  for (let i = 0; i < ids.length; i++) out.push({ id: ids[i], status: statuses[i] });
  return out;
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
    const notifText = (typeof o.content === "string" ? o.content : "")
      + (typeof o.message?.content === "string" ? o.message.content : "");
    out.push({
      t, type: o.type, sid: o.session_id || null,
      uses: c.filter((x) => x?.type === "tool_use").map((x) => ({ id: x.id, name: x.name, input: x.input })),
      results: c.filter((x) => x?.type === "tool_result").map((x) => ({ id: x.tool_use_id, content: x.content, is_error: x.is_error })),
      bgDone: parseNotifs(notifText),
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
// 2026-08-03：把反引号也加进剥离集（修复前只剥单/双引号，命令替换里的字样仍能骗过分类器）。
function stripQuoted(cmd) {
  return cmd.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""').replace(/`[^`]*`/g, "``");   // echo/sed/命令替换 里的字样不算
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

// ── 会话归属（AC4）：pane 源 = 会话记录里的 session_id ──────────────────────────────────────
// /clear 会新建会话文件，但新文件的记录仍带原 pane 的 session_id；外层人开的 fork 会话则带
// 外层 session（=SELF）的 id。所以「同源」= 候选文件自己的 id 是 pane 源，或候选记录里的
// session_id 是 pane 源。
function readFirstSid(file, maxLines = 100) {
  let text = "";
  try {
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(1 << 20); // 1MB 前缀足够（session_id 出现在开头几条消息里）
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    text = buf.toString("utf8", 0, n);
  } catch { return null; }
  let count = 0;
  for (const line of text.split("\n")) {
    if (!line.startsWith("{")) continue;
    try { const o = JSON.parse(line); if (o.session_id) return o.session_id; } catch {}
    if (++count >= maxLines) break;
  }
  return null;
}
function paneSource(file) {
  const sid = readFirstSid(file);
  return sid || path.basename(file).replace(/\.jsonl$/, "");
}
function samePaneAs(candidate, source) {
  const own = path.basename(candidate).replace(/\.jsonl$/, "");
  if (own === source) return true; // 该文件本身就是 pane 的根
  return readFirstSid(candidate) === source;
}

// /clear 会新建会话文件，auto-pick 只拿到最新那个。若请求窗口早于它的首条记录，
// 更早的历史就被**静默截断**了 —— 2026-08-02 实测：clear 后自动选中 0.4MB 的新会话，
// 而同一天 11MB 的旧会话不再可见，输出看起来完整。必须报出来。
// 2026-08-03：只把与目标 pane 同源的计入「更早会话」；归属不同的单独列出，不计入。
function earlierSessions(file, sinceMs, firstMs) {
  if (!sinceMs || sinceMs >= firstMs) return { samePane: [], other: [] };
  const source = paneSource(file);
  const out = { samePane: [], other: [] };
  for (const f of fs.readdirSync(PROJ)) {
    if (!f.endsWith(".jsonl") || f.includes(SELF) || path.join(PROJ, f) === file) continue;
    const p2 = path.join(PROJ, f);
    let st; try { st = fs.statSync(p2); } catch { continue; }
    if (st.mtimeMs >= sinceMs) {
      const entry = { f, mb: (st.size / 1e6).toFixed(1) };
      (samePaneAs(p2, source) ? out.samePane : out.other).push(entry);
    }
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
  if (earlier.samePane.length) {
    console.log(`\n  ⚠ 请求窗口早于本会话首条记录，${earlier.samePane.length} 个更早的会话未被包含（很可能是 /clear 造成的断裂）：`);
    for (const e of earlier.samePane) console.log(`      ${e.f.slice(0, 8)}  ${e.mb}MB   —— 用 --session ${e.f.replace(/\.jsonl$/, "")} 单独分析`);
    console.log(`     本次输出只覆盖 ${new Date(rows[0].t).toISOString()} 之后，不是完整窗口。`);
  }
  if (earlier.other.length) {
    console.log(`\n  ⚠ ${earlier.other.length} 个会话归属不同（可能属于其它会话/外层 pane），未计入：`);
    for (const e of earlier.other) console.log(`      ${e.f.slice(0, 8)}  ${e.mb}MB   —— 用 --session ${e.f.replace(/\.jsonl$/, "")} 单独分析`);
  }
  console.log("");
}

function timecost(file, sinceMs) {
  const rows = load(file, sinceMs);
  if (rows.length < 5) return console.log("窗口内数据不足");
  banner(file, rows, sinceMs);
  const span = rows.at(-1).t - rows[0].t;
  const pending = new Map(), bgPending = new Map(), tool = {}, cnt = {};
  const add = (p, dt) => { if (dt < 3.6e6) { tool[p.k] = (tool[p.k] || 0) + dt; cnt[p.k] = (cnt[p.k] || 0) + 1; } };
  for (const r of rows) {
    for (const res of r.results) {
      const p = pending.get(res.id);
      if (!p) continue;
      if (typeof res.content === "string" && res.content.includes("running in background")) {
        pending.delete(res.id); bgPending.set(res.id, p); // 移到后台待完成
      } else {
        pending.delete(res.id); add(p, r.t - p.t);
      }
    }
    for (const n of r.bgDone) {
      const p = bgPending.get(n.id);
      if (p) { bgPending.delete(n.id); add(p, r.t - p.t); }
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

// 命令把 suite 放到 shell 级后台（nohup … & 或 `… test.sh > log 2>&1 &`）时，tool_use 会立即返回，
// 真实耗时不在 transcript 里 —— 与 run_in_background 一样归为「后台待完成」，取不到完成信号就报未知。
function looksShellBg(cmd) {
  const c = stripQuoted(cmd);
  if (/\bnohup\b/.test(c)) return true; // nohup 必然脱离 shell 存活
  const m = c.match(/(scripts\/test\.sh|node\s+--test)\b[^;\n]*/);
  if (!m) return false;
  const seg = m[0];
  if (/\bwait\b/.test(seg)) return false; // `… & wait` 阻塞到完成，tool_result 就是真实耗时
  // 去掉重定向（> file、2>&1）与 && 后，是否还剩独立的 ` &`（后台操作符）
  const cleaned = seg.replace(/\d*>\s*&?\d*/g, "").replace(/>\s*\S+/g, "").split("&&").join("");
  return /(^|[\s;|(])&(?![&])/.test(cleaned);
}

// tool_use/tool_result 按 id 配对。后台命令（run_in_background 或 shell 级 &）的即时 tool_result 只是
// 「running in background」/「launched」通知，**不是**真实完成时刻 —— 以 <task-notification> 的
// 完成时刻为准；窗口内取不到完成信号 → dur: null（显示「未知」，与「0s」不可区分的问题就此消除）。
export function pairCalls(rows, pattern) {
  const byKind = KINDS.has(pattern);
  const re = byKind ? null : new RegExp(pattern, "i");
  const pending = new Map(), bgPending = new Map(), hits = [];
  for (const r of rows) {
    for (const res of r.results) {
      const p = pending.get(res.id);
      if (!p) continue;
      if (typeof res.content === "string" && res.content.includes("running in background")) {
        pending.delete(res.id); bgPending.set(res.id, p);
      } else {
        pending.delete(res.id); hits.push({ ...p, dur: r.t - p.t });
      }
    }
    for (const n of r.bgDone) {
      const p = bgPending.get(n.id);
      if (p) { bgPending.delete(n.id); hits.push({ ...p, dur: r.t - p.t, bgStatus: n.status }); }
    }
    for (const u of r.uses) {
      const s = u.name === "Bash" ? (u.input?.command || "") : JSON.stringify(u.input || {});
      const hit = byKind ? classify(u.name, u.input) === pattern : re.test(s);
      if (hit) {
        const bg = !!u.input?.run_in_background || looksShellBg(u.input?.command || "");
        const entry = { t: r.t, name: u.name, cmd: s.replace(/\s+/g, " ").slice(0, 100), bg };
        (bg ? bgPending : pending).set(u.id, entry);
      }
    }
  }
  for (const [, p] of bgPending) hits.push({ ...p, dur: null, bgStatus: "unknown" });
  return { hits: hits.sort((a, b) => a.t - b.t), byKind };
}

export function fmtDur(h) {
  if (typeof h.dur !== "number") return "未知";
  return `${(h.dur / 1000).toFixed(0).padStart(4)}s`;
}

// 测试与 CLI 共用：分类、加载、会话归属（plugin/test/inner-forensics.test.mjs 直接 import）。
export { stripQuoted, classify, load, loadOne, parseNotifs, earlierSessions, paneSource, samePaneAs, pickInner, KINDS };

function verify(file, sinceMs, pattern) {
  const rows = load(file, sinceMs);
  const byKind = KINDS.has(pattern);
  const re = byKind ? null : new RegExp(pattern, "i");
  if (!rows.length) {
    // 无数据时**仍要**报出选了哪个会话与什么窗口 —— 2026-08-02 实测：一次 `--since` 写成了未来
    // 时刻（查 17:30Z 而当时 UTC 是 17:24），得到「窗口内无数据」，与「选错会话」完全不可区分，
    // 花了几分钟手工诊断才发现是自己写错了时间。
    console.log(`会话文件 ${path.basename(file)}  0 条`);
    console.log(`窗口 ${sinceMs ? new Date(sinceMs).toISOString() : "(全部)"} → (无记录)`);
    if (sinceMs && sinceMs > Date.now()) console.log(`  ⚠ --since 是**未来时刻**（当前 ${new Date().toISOString()}）—— 零结果由此而来`);
    else console.log(`  ⚠ 零结果与「选错会话/窗口」不可区分；用 --session 指定后重试`);
    return;
  }
  banner(file, rows, sinceMs);
  const { hits } = pairCalls(rows, pattern);
  console.log(`${byKind ? `类别「${pattern}」` : `匹配 /${pattern}/`} 的调用：${hits.length} 次\n`);
  for (const h of hits) {
    const st = h.bgStatus && h.bgStatus !== "unknown" ? ` [${h.bgStatus}]` : "";
    console.log(`  ${new Date(h.t).toISOString().slice(11, 19)}  ${fmtDur(h).padStart(7)}  ${h.cmd}${st}`);
  }
  if (!hits.length) {
    console.log("  —— 零命中。");
    console.log("  ⚠ 零命中与「查询写错了」不可区分，不要直接当作「内层没做过」。");
    if (!byKind) console.log("     先用类别形式复核：verify 全量套件 / 范围化测试 / 其它 Bash（与 timecost 同源，不会分歧）。");
    console.log("     确认查询正确后，零命中才是「该声称未被 transcript 证实」。");
  }
  const withDur = hits.filter((h) => typeof h.dur === "number");
  const total = withDur.reduce((a, h) => a + h.dur, 0);
  if (hits.length) {
    let line = `\n  合计 ${(total / 6e4).toFixed(1)} 分钟`;
    if (withDur.length) line += `，均 ${(total / withDur.length / 1000).toFixed(0)}s`;
    const unknown = hits.length - withDur.length;
    if (unknown) line += `，${unknown} 次耗时未知`;
    console.log(line);
  }
}

// CLI（直接执行时才跑；被 import 时不跑，供 plugin/test/inner-forensics.test.mjs 复用）
// 用 realpath 比较两侧（gap-loop-mechanism-lives-outside-the-package-and-cannot-ship）：Node 下
// import.meta.url 解析到真实文件，而 process.argv[1] 保持命令行传入的路径（若经符号链接调用则
// 是链接路径）。不用 realpath 会在「node <symlink> verify …」下误判 isDirect=false，静默不跑 CLI。
const isDirect = process.argv[1] &&
  fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(path.resolve(process.argv[1]));
if (isDirect) {
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
}
