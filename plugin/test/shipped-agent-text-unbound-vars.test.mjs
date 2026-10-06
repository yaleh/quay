// @test-group engine
// shipped-agent-text-unbound-vars.test.mjs — 发布版发给 agent 的文本里，「bash 命令引用了没人赋值的大写
// shell 变量」这一类缺陷的机械检查（task gap-shipped-agent-text-references-shell-variables-that-nothing-
// assigns-and-no-check-scans-for-them；CLAUDE_PLUGIN_ROOT 只是这一类里的第一个实例）。
//
// 【为什么需要它】变量在运行期展开为空串时，命令不会报「变量没定义」——它退化成一条**另一条**命令
// （`"$CLAUDE_PLUGIN_ROOT/scripts/x.ts"` ⇒ `/scripts/x.ts`），失败形态与「文件不存在」同形（硬规则 3b），
// 因此这类缺陷此前没有任何检查会发现，只能靠人逐字重读（人 2026-10-06 裁定：做成机械检查）。
//
// 【两个扫描面，规则不同——这个不对称是刻意的，理由写在各自小节】
//   A. workflow 发出的 prompt（四个 workflow，真实 vm 调用）：prompt 是**代码每轮现生成的**，
//      所以其中出现的变量必须由**该 prompt 自己**赋值、或由**宿主环境**注入；没有第三条出路。
//      ⇒ 这正是 CLAUDE_PLUGIN_ROOT 缺陷所在的扫描面（sibling 任务
//      gap-workflow-js-carriers-emit-literal-plugin-root-env-ref-that-is-unset-in-plain-sessions 已修）。
//      ⛔ 白名单里**没有也不得有** CLAUDE_PLUGIN_ROOT（AC3）：它在普通会话 subagent 的 Bash 里实测 UNSET
//      （见 HOST_ENV 注释里的原始读数），把它放进白名单就等于把这个缺陷类整体豁免掉。
//   B. 随插件发布的 skill / loop 文本（人写的模板）：变量可以来自 workspace 的 `.quay/config.yml`
//      `loop:` 段（`quay-init --loop` 写入），所以这类文档里的 `$WORKTREE_ROOT` / `$TEST_COMMAND` 等
//      是**参数占位符**而不是缺陷。判据是机械的：该变量名必须在**同一批文本的散文里**出现过
//      （即文本自己说了它从哪来）。`$HOME` 这种宿主变量则走 HOST_ENV。
//
// 【本检查证明什么 / 不证明什么】它证明的是**文本层面的来源完备性**：命令块里的每个变量，
// 要么在本块内被赋值、要么被实测的宿主环境注入、要么在文本别处被说明。它**不**证明运行期真的绑定了
// （那需要执行）；对 workflow prompt 这一面它更强——那一面没有「散文说明」这条出路。
//
// 【零命中不是「没验到」】零命中时本文件会打印**谓词对已知真样本的干跑结果**（硬规则 2 的另一半），
// 并打印两个取假控制的实跑结论；无法解析的文件输出 `NOT-EVALUATED` 与原因，⛔ 不与「零命中」同形（硬规则 3b）。
//
// Run:
//   node --experimental-strip-types --test plugin/test/shipped-agent-text-unbound-vars.test.mjs
//   bash scripts/test.sh --for-task gap-shipped-agent-text-references-shell-variables-that-nothing-assigns-and-no-check-scans-for-them --allow-thin

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const PLUGIN = path.join(REPO_ROOT, "plugin");

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// 共享：变量提取 / 赋值判定
// ══════════════════════════════════════════════════════════════════════════════════════════════════

/** 只看【大写、长度≥3】的 `$NAME` / `${NAME}`（AC 明示的范围）。`$1 $$ $? $@ $# $* $- $! $_` 这类
 *  shell 特殊参数结构性匹配不上（它们不以 `[A-Z]` 开头），此处仍显式列出以免读者以为漏了。 */
const SHELL_SPECIALS = new Set(["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "?", "$", "@", "#", "*", "-", "!", "_"]);

const VAR_RE = /\$\{([A-Z][A-Z0-9_]{2,})\}|\$([A-Z][A-Z0-9_]{2,})/g;

/** 文本里全部大写变量引用，带字符下标（下标用于「本块内**此前**是否已赋值」的位置判定）。 */
function refsWithPos(text) {
  const out = [];
  VAR_RE.lastIndex = 0;
  let m;
  while ((m = VAR_RE.exec(text)) !== null) {
    const name = m[1] ?? m[2];
    out.push({ name, raw: m[0], index: m.index });
  }
  return out;
}

function lineOf(text, index) {
  let n = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === "\n") n++;
  return n;
}

/** 该变量在 text 里**第一次**被赋值的下标，没有则 -1。AC 点名的四种形态：
 *  `NAME=`（可带 export/local/declare/readonly 前缀）、`for NAME in`、`read NAME`。 */
function assignmentIndex(text, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pats = [
    new RegExp(`(?:^|[;&|({\\s])(?:export\\s+|local\\s+|declare\\s+(?:-\\w+\\s+)*|readonly\\s+)?${esc}=`, "m"),
    new RegExp(`\\bfor\\s+${esc}\\s+in\\b`),
    new RegExp(`\\bread\\s+(?:-\\w+\\s+)*${esc}\\b`),
  ];
  let best = -1;
  for (const p of pats) {
    const m = p.exec(text);
    if (m && (best === -1 || m.index < best)) best = m.index;
  }
  return best;
}

// ── HOST_ENV —— 宿主注入白名单（AC3）─────────────────────────────────────────────────────────────
// ⛔ 每一项都必须带**实测来源**，不得凭记忆添加。下面是 2026-10-06 在本机【普通会话 subagent 的 Bash】
// 里 `printenv <NAME>` 的原始读数（完整读数见本任务的完成记录；此处按 1:1 摘录）：
//   HOME=/data/home/yale          PATH=/data/home/yale/work/claudecodeui/node_modules/.bin:…（完整 1400+ 字符，见完成记录）
//   PWD=/data/home/yale/work/quay SHELL=/bin/bash   USER=yale   LANG=en_US.UTF-8
// ⚠️ 同一次实测里 HOSTNAME / TMPDIR / TERM 是 **UNSET** —— 所以它们**不**在这里（凭记忆加进去就是造假，
//    硬规则 4）。
// 🔴 CLAUDE_PLUGIN_ROOT / CLAUDE_PROJECT_DIR / QUAY_PLUGIN_ROOT 同一次实测 **UNSET** ⇒ ⛔ 绝不入表（AC3）。
const HOST_ENV = new Map(Object.entries({
  HOME: "HOME=/data/home/yale",
  PATH: "PATH=/data/home/yale/work/claudecodeui/node_modules/.bin:…(abridged; full reading in completion record)",
  PWD: "PWD=/data/home/yale/work/quay",
  SHELL: "SHELL=/bin/bash",
  USER: "USER=yale",
  LANG: "LANG=en_US.UTF-8",
}));

/** 一个变量引用是否被「本块内此前已赋值」赦免（位置敏感：赋值必须在这一处引用**之前**）。 */
function assignedBefore(text, ref) {
  const i = assignmentIndex(text, ref.name);
  return i !== -1 && i < ref.index;
}

/**
 * 扫一段「命令块」文本。
 * @param {string} text      块文本（workflow prompt = 整个 prompt；skill/loop = 单个 ```bash 围栏）
 * @param {Set<string>} documented  散文里说明过的变量名（仅 skill/loop 面使用；workflow 面传空集）
 * @param {Map<string,string>} hostEnv
 * @returns {{unbound:Array, assigned:Array, hostEnv:Array, documented:Array}}
 */
function scanBlock(text, documented, hostEnv) {
  const res = { unbound: [], assigned: [], hostEnv: [], documented: [] };
  for (const ref of refsWithPos(text)) {
    if (SHELL_SPECIALS.has(ref.name)) continue;
    const at = { ...ref, line: lineOf(text, ref.index) };
    if (assignedBefore(text, ref)) { res.assigned.push(at); continue; }
    if (hostEnv.has(ref.name)) { res.hostEnv.push({ ...at, evidence: hostEnv.get(ref.name) }); continue; }
    if (documented && documented.has(ref.name)) { res.documented.push(at); continue; }
    res.unbound.push(at);
  }
  return res;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// 共享：markdown 围栏解析
// ══════════════════════════════════════════════════════════════════════════════════════════════════

const BASH_INFOS = new Set(["bash", "sh", "shell", "zsh"]);

/**
 * 把 markdown 拆成 bash 围栏块 / 其余文本（其余 = 散文 + 非 bash 围栏）。
 * ⛔ 围栏未闭合 ⇒ `ok:false` + reason：**读不懂输入时不得返回「零命中」那一形状**（硬规则 3b）。
 */
function parseFences(text) {
  const lines = text.split("\n");
  const bashBlocks = [];
  const other = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*```([A-Za-z0-9_+-]*)\s*$/.exec(lines[i]);
    if (m) {
      if (cur === null) cur = { info: m[1], startLine: i + 1, lines: [] };
      else {
        if (BASH_INFOS.has(cur.info)) bashBlocks.push({ info: cur.info, startLine: cur.startLine, content: cur.lines.join("\n") });
        else other.push(cur.lines.join("\n"));
        cur = null;
      }
      continue;
    }
    if (cur) cur.lines.push(lines[i]);
    else other.push(lines[i]);
  }
  if (cur !== null) {
    // 独立取值（硬规则 3b）：解析失败**不是**「块列表为空」。调用方必须先看 `evaluated`。
    return { ok: false, evaluated: false, reason: `unterminated \`\`\`${cur.info} fence opened at line ${cur.startLine}`, bashBlocks: [], other: [] };
  }
  return { ok: true, evaluated: true, bashBlocks, other };
}

function walkMarkdown(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkMarkdown(p));
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// 扫描面 B 的语料：随插件发布的 skill / loop 文本
// ══════════════════════════════════════════════════════════════════════════════════════════════════

const SHIPPED_FILES = [
  ...walkMarkdown(path.join(PLUGIN, "skills")),
  ...walkMarkdown(path.join(PLUGIN, "loop")),
].sort();

let shippedCache = null;

/** 扫全部 skill/loop 文本。`hostEnv` 可注入（白名单取假控制用它）。 */
function scanShipped(hostEnv) {
  const notEvaluated = [];
  const parsed = new Map();
  for (const f of SHIPPED_FILES) {
    let text;
    try {
      text = fs.readFileSync(f, "utf8");
    } catch (err) {
      notEvaluated.push({ file: f, reason: `unreadable: ${err.code ?? err.message}` });
      continue;
    }
    const p = parseFences(text);
    if (!p.ok) { notEvaluated.push({ file: f, reason: p.reason }); continue; }
    parsed.set(f, p);
  }

  // 「散文说明」集合：出现在【非 bash】文本里的 `$NAME`。这是面 B 的第三条赦免（见文件头）。
  const documented = new Set();
  for (const p of parsed.values()) {
    for (const chunk of p.other) for (const r of refsWithPos(chunk)) documented.add(r.name);
  }

  const findings = [];
  const bound = { assigned: 0, hostEnv: 0, documented: 0 };
  const documentedByName = new Map(); // name -> count（面 B 的第三条赦免到底赦免了谁，逐名可核）
  const hostEnvByName = new Map();
  const assignedByName = new Map();
  const prosePlaceholders = new Map(); // 信息读数（AC4：不判红）
  for (const [f, p] of parsed) {
    for (const b of p.bashBlocks) {
      const r = scanBlock(b.content, documented, hostEnv);
      bound.assigned += r.assigned.length;
      bound.hostEnv += r.hostEnv.length;
      bound.documented += r.documented.length;
      for (const x of r.assigned) assignedByName.set(x.name, (assignedByName.get(x.name) ?? 0) + 1);
      for (const x of r.documented) documentedByName.set(x.name, (documentedByName.get(x.name) ?? 0) + 1);
      for (const x of r.hostEnv) hostEnvByName.set(x.name, (hostEnvByName.get(x.name) ?? 0) + 1);
      for (const u of r.unbound) {
        findings.push({
          file: path.relative(REPO_ROOT, f),
          line: b.startLine + u.line - 1,
          name: u.name,
          snippet: b.content.split("\n")[u.line - 1]?.trim().slice(0, 120) ?? "",
        });
      }
    }
    const prose = p.other.join("\n");
    for (const r of refsWithPos(prose)) prosePlaceholders.set(r.name, (prosePlaceholders.get(r.name) ?? 0) + 1);
  }
  return { findings, bound, notEvaluated, documented, documentedByName, hostEnvByName, assignedByName, prosePlaceholders, files: parsed.size };
}

function shipped() {
  if (!shippedCache) shippedCache = scanShipped(HOST_ENV);
  return shippedCache;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// 扫描面 A：workflow 真实发出的 prompt
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// 真实调用 harness（判据「改 workflow 的唯一有效验证=实调」的同一手法，参照 plugin/test/helpers/
// fan-in-execute-paths-harness.mjs 与 execute-suite-fix-scope-gate.test.mjs，⛔ 不修改那些文件）：
// 把 workflow 文件 vm 执行一遍，让它自己的代码跑出**真实**的 prompt，agent() 只负责捕获。

const WORKFLOWS = ["fan-in-execute.js", "execute-suite-fix.js", "pool-quality-judge.js", "manager-tick-core.js"];

const DEFAULT_AGENT_RESULTS = {
  "fan-in-execute.js": [
    { outcome: "suite-started", suitePid: 4242, codeDelta: "mock-code", worktreeHead: "mockhead", note: "mock-prep" },
    { outcome: "green", ffOk: true, developHead: "dhead", worktreeHead: "whead", agentIdUsed: "mockagent", codeDelta: "mock-code", note: "bracketClose=OK", bracketClosed: true },
  ],
  "execute-suite-fix.js": [
    { launched: true, worktreeHead: "head1", failuresFixed: [], note: "" },
    { state: "red", reason: "failed", tests: 3000, durationMs: 1000, pid: null, worktreeHead: "head1" },
    { failureCount: 2, rootCauses: [], relaunched: true, worktreeHead: "head2", note: "" },
    { state: "green", reason: "passed", tests: 3000, durationMs: 1000, pid: null, worktreeHead: "head2" },
    { worktreeHeadNow: "head2", verifiedCommit: "head2" },
    { batchMergeOk: true, developHead: "d", integrationHead: "i", note: "" },
  ],
  "pool-quality-judge.js": [
    { triggers: { fired: true, reasons: ["pool>25"], poolCount: 30, oldestUnreviewedAgeMs: 0, roundsSinceLastJudge: 0 }, pool: ["gap-probe-a", "gap-probe-b"], tasks: [{ id: "gap-probe-a", acChecked: 1, acTotal: 2, acCompleteness: "partial", sections: [] }], poolCount: 30, currentRound: 5 },
    { verdict: "ready", acCompleteness: "all-checked", premiseSound: true, evidence: "e", recommendation: "r" },
    { verdict: "needs-work", acCompleteness: "partial", premiseSound: true, evidence: "e", recommendation: "r" },
    { recorded: true, lastRound: 5, path: "p" },
    { recorded: true, round: 5, path: "p", state: "s" },
  ],
  "manager-tick-core.js": [null, null],
};

/** vm 执行一个 workflow，捕获它发出的全部 agent prompt。args 形状按各 workflow 的契约给
 *  （fan-in-execute / pool-quality-judge / manager-tick-core 收 JSON 字符串；execute-suite-fix 收对象）。 */
async function captureWorkflowPrompts(name, tmpRoot) {
  const file = path.join(PLUGIN, "workflows", name);
  const src = fs.readFileSync(file, "utf8");
  const body = src.replace(/^export\s+const\s+meta/m, "const meta");
  const wrapped = "(async () => {\n" + body + "\n})()";
  const captured = { prompts: [], phases: [], logs: [] };
  const defaults = DEFAULT_AGENT_RESULTS[name] ?? [];
  const root = tmpRoot;
  const pluginRoot = path.join(PLUGIN);
  const ARGS = {
    "fan-in-execute.js": JSON.stringify({ task: "gap-probe", worktree: path.join(root, "wt"), root, runId: "probe-1", mergeTarget: "develop", pluginRoot }),
    "execute-suite-fix.js": { worktree: path.join(root, "wt"), stateDir: path.join(root, ".quay"), root, task: "gap-probe", pluginRoot },
    "pool-quality-judge.js": JSON.stringify({ root, pluginRoot, force: true }),
    "manager-tick-core.js": JSON.stringify({ workspaceRoot: root, pluginRoot, managerSessionId: "probe-session" }),
  }[name];
  const sandbox = {
    console,
    setTimeout: (fn) => setTimeout(fn, 0), // 脚本控制流的 60s 轮询在测试里降到 0（沿用既有 harness 手法）
    clearTimeout,
    args: ARGS,
    phase: (...a) => captured.phases.push(...a),
    log: (...a) => captured.logs.push(...a),
    parallel: async (thunks) => Promise.all(thunks.map((t) => t())),
    pipeline: async (items, fn) => Promise.all(items.map((x, i) => fn(x, i))),
    agent: async (prompt) => {
      const i = captured.prompts.length;
      captured.prompts.push(prompt);
      return i < defaults.length ? defaults[i] : (defaults[defaults.length - 1] ?? {});
    },
  };
  const ctx = vm.createContext(sandbox);
  const promise = new vm.Script(wrapped, { filename: file }).runInContext(ctx);
  if (!promise || typeof promise.then !== "function") {
    throw new Error(`vm execution of ${name} did not return a promise (got ${typeof promise})`);
  }
  const result = await promise;
  return { ...captured, result };
}

let workflowCache = null;

/** 四个 workflow 的真实 prompt 语料 + 未赋值变量结论（面 A：无「散文说明」出路）。 */
async function scanWorkflows() {
  if (workflowCache) return workflowCache;
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shipped-agent-text-"));
  const notEvaluated = [];
  const findings = [];
  let promptCount = 0;
  let refTotal = 0;
  const bound = { assigned: 0, hostEnv: 0 };
  try {
    for (const name of WORKFLOWS) {
      let cap;
      try {
        cap = await captureWorkflowPrompts(name, tmpRoot);
      } catch (err) {
        notEvaluated.push({ workflow: name, reason: `vm execution failed: ${err.message}` });
        continue;
      }
      if (cap.prompts.length === 0) {
        // 零 prompt ≠ 零命中：workflow 拒绝运行（bad-args / 缺 pluginRoot …）时必须说「没评估成」。
        notEvaluated.push({ workflow: name, reason: `workflow emitted 0 prompts (result=${JSON.stringify(cap.result).slice(0, 160)})` });
        continue;
      }
      promptCount += cap.prompts.length;
      for (let i = 0; i < cap.prompts.length; i++) {
        const r = scanBlock(cap.prompts[i], null, HOST_ENV); // ⛔ documented=null：面 A 没有散文出路
        refTotal += refsWithPos(cap.prompts[i]).length;
        bound.assigned += r.assigned.length;
        bound.hostEnv += r.hostEnv.length;
        for (const u of r.unbound) {
          findings.push({ workflow: name, prompt: i, name: u.name, line: u.line, snippet: cap.prompts[i].split("\n")[u.line - 1]?.trim().slice(0, 120) ?? "" });
        }
      }
    }
  } finally {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  workflowCache = { findings, bound, notEvaluated, promptCount, refTotal };
  return workflowCache;
}

// ── 打印助手：AC 要求「打印总数与前 3 条」；零命中时另外打印干跑证明 ───────────────────────────────
function report(title, findings, note) {
  console.log(`[${title}] unbound=${findings.length}${note ? ` ${note}` : ""}`);
  findings.slice(0, 3).forEach((f, i) => console.log(`  #${i + 1} ${JSON.stringify(f)}`));
}

/** 硬规则 2 的零命中半边：把谓词对着一个【已知为真】的样本干跑一次。 */
function predicateDryRun() {
  const sample = 'echo "$FOO" && echo "${BAR_BAZ}" && rc=$? && echo "$1 $@ $#"';
  const boundMap = new Map();
  const r = scanBlock(sample, new Set(["BAR_BAZ"]), boundMap);
  const names = r.unbound.map((u) => u.name).sort();
  return { sample, unbound: names, specialsIgnored: SHELL_SPECIALS.size };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// 测试
// ══════════════════════════════════════════════════════════════════════════════════════════════════

test("dry-run: 谓词对已知真样本命中（零命中的配套动作，硬规则 2）", () => {
  const d = predicateDryRun();
  console.log(`[dry-run] sample=${JSON.stringify(d.sample)} ⇒ unbound=[${d.unbound.join(", ")}]`);
  assert.deepEqual(d.unbound, ["FOO"], "已知真样本 $FOO 未赋值必须命中；${BAR_BAZ} 在 documented 里 ⇒ 不命中");
  // 位置判定：`rc=$?` 之后引用 `$rc` 才算已赋值 —— 这里 `$?` 是特殊参数，不计入。
  const pos = scanBlock("OUT=/tmp/x\necho $OUT\n", new Set(), new Map());
  assert.equal(pos.unbound.length, 0, "本块内此前赋值的 OUT 必须被赦免（位置敏感）");
  const posLate = scanBlock("echo $LATE\nLATE=1\n", new Set(), new Map());
  assert.equal(posLate.unbound.map((u) => u.name).join(","), "LATE", "赋值在引用【之后】不算赦免");
});

test("面 A（workflow prompt）：四个真实 workflow 发出的 prompt 里没有未赋值的大写变量", async () => {
  const s = await scanWorkflows();
  console.log(`[A/workflow] prompts=${s.promptCount} refs=${s.refTotal} bound(assigned=${s.bound.assigned}, hostEnv=${s.bound.hostEnv}) notEvaluated=${s.notEvaluated.length}`);
  report("A/workflow", s.findings);
  const dry = predicateDryRun();
  console.log(`[A/workflow] 干跑（零命中时必须打印）：sample=${JSON.stringify(dry.sample)} ⇒ 命中 [${dry.unbound.join(", ")}]`);
  assert.deepEqual(s.notEvaluated, [], `有 workflow 没评估成（不得当作零命中）：${JSON.stringify(s.notEvaluated)}`);
  assert.equal(s.findings.length, 0, `workflow prompt 里有未赋值的大写变量：\n${JSON.stringify(s.findings, null, 2)}`);
});

test("取假①：往真实 prompt 里注入 $UNBOUND_PROBE_VAR ⇒ 检查指名它（红）", async () => {
  const s = await scanWorkflows();
  // 用【真实捕获到的】prompt 派生，不是凭空造的 fixture：注入一行故意未赋值的变量，检查必须变红并指名。
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shipped-agent-text-inj-"));
  let injected;
  try {
    const cap = await captureWorkflowPrompts("fan-in-execute.js", tmpRoot);
    injected = cap.prompts[0] + "\necho $UNBOUND_PROBE_VAR\n";
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
  const r = scanBlock(injected, null, HOST_ENV);
  const names = r.unbound.map((u) => u.name);
  console.log(`[取假①] 注入后 unbound=[${names.join(", ")}]（基线应是 ${s.findings.length}）`);
  assert.ok(names.includes("UNBOUND_PROBE_VAR"), "注入的未赋值变量必须被指名");
  // 去掉注入 ⇒ 恢复绿。
  const clean = injected.replace("\necho $UNBOUND_PROBE_VAR\n", "");
  assert.equal(scanBlock(clean, null, HOST_ENV).unbound.length, 0, "去掉注入后必须恢复绿");
});

test("取假②：从 HOST_ENV 白名单删掉 HOME ⇒ 依赖它的真实文本变红", () => {
  const withoutHome = new Map([...HOST_ENV].filter(([k]) => k !== "HOME"));
  const s = scanShipped(withoutHome);
  const home = s.findings.filter((f) => f.name === "HOME");
  console.log(`[取假②] 删掉 HOME 后 unbound=${s.findings.length}，其中 HOME=${home.length} 条：${JSON.stringify(home[0] ?? null)}`);
  assert.ok(home.length > 0, "白名单条目必须是承重的：删掉 HOME 后真实文本（orchestrator-loop-tick.md 的 $HOME）必须变红");
  assert.ok(s.findings.every((f) => f.name === "HOME"), "删掉 HOME 只应新增 HOME 相关命中，不应牵动其它变量");
});

test("面 B（skill/loop 文本）：只扫 ```bash 围栏；未赋值变量为 0；散文占位符只作信息读数", () => {
  const s = shipped();
  console.log(`[B/skill+loop] files=${s.files} notEvaluated=${s.notEvaluated.length} bound(assigned=${s.bound.assigned}, hostEnv=${s.bound.hostEnv}, documented=${s.bound.documented})`);
  console.log(`[B/skill+loop] bash 围栏里被赦免的：assigned=${[...s.assignedByName].map(([n, c]) => `${n}×${c}`).join(" ") || "(none)"} hostEnv=${[...s.hostEnvByName].map(([n, c]) => `${n}×${c}`).join(" ") || "(none)"}`);
  console.log(`[B/skill+loop] bash 围栏里靠「散文说明」赦免的（逐名，供 AC3/AC6 核对）：${[...s.documentedByName].map(([n, c]) => `${n}×${c}`).sort().join(" ") || "(none)"}`);
  console.log(`[B/skill+loop] 散文占位符（信息读数，不判红）：${[...s.prosePlaceholders.entries()].map(([n, c]) => `${n}×${c}`).sort().join(" ") || "(none)"}`);
  report("B/skill+loop", s.findings);
  assert.deepEqual(s.notEvaluated, [], `有文件无法解析（NOT-EVALUATED，不得与零命中同形）：${JSON.stringify(s.notEvaluated)}`);
  assert.equal(s.findings.length, 0, `skill/loop 的 bash 围栏里有未赋值变量：\n${JSON.stringify(s.findings, null, 2)}`);
});

test("NOT-EVALUATED：围栏未闭合 ⇒ 报无法评估 + 原因，而不是零命中（硬规则 3b）", () => {
  const broken = "# t\n\n```bash\necho $SOMETHING\n"; // 没有闭合围栏
  const p = parseFences(broken);
  console.log(`[NOT-EVALUATED] ok=${p.ok} evaluated=${p.evaluated} reason=${p.reason}`);
  assert.equal(p.ok, false, "未闭合围栏必须 ok:false");
  assert.equal(p.evaluated, false, "无法解析必须带独立取值 evaluated:false —— 不与「解析成功且零命中」同形（硬规则 3b）");
  assert.match(p.reason, /unterminated/, "原因必须说明是未闭合围栏");
  // 反面：一个合法但无 bash 块的文件是 evaluated:true + 零命中 —— 两者必须可区分。
  const legit = parseFences("# t\n\nno fences here\n");
  assert.equal(legit.evaluated, true, "合法文件必须 evaluated:true");
  assert.equal(legit.bashBlocks.length, 0, "合法文件可以零 bash 块");
  assert.notEqual(`${p.evaluated}`, `${legit.evaluated}`, "「读不懂」与「零命中」不得共用同一取值");
});

test("AC6 证据表：八个嫌疑变量在 skill/loop 文本里的落点与来源（机械读数）", () => {
  const SUSPECTS = ["FORK_BASELINE", "MERGE_TARGET", "REPO_ROOT", "WORKTREE_ROOT", "TMUX_SESSION", "TEST_COMMAND", "QUAY_GLOBAL_DIR", "QUAY_CLAIM_REMOTE"];
  const inBash = new Map(); // name -> Set("file:line")
  const inProse = new Map(); // name -> Set(file)
  const add = (map, name, v) => {
    if (!map.has(name)) map.set(name, new Set());
    map.get(name).add(v);
  };
  for (const f of SHIPPED_FILES) {
    const p = parseFences(fs.readFileSync(f, "utf8"));
    if (!p.ok) continue;
    const rel = path.relative(REPO_ROOT, f);
    for (const b of p.bashBlocks) {
      for (const r of refsWithPos(b.content)) {
        if (SUSPECTS.includes(r.name)) add(inBash, r.name, `${rel}:${b.startLine + lineOf(b.content, r.index) - 1}`);
      }
    }
    for (const r of refsWithPos(p.other.join("\n"))) {
      if (SUSPECTS.includes(r.name)) add(inProse, r.name, rel);
    }
  }
  for (const n of SUSPECTS) {
    const bash = [...(inBash.get(n) ?? [])];
    const prose = [...(inProse.get(n) ?? [])];
    console.log(`[AC6] ${n}: bash-fence=${bash.length ? bash.join(",") : "(none)"} | prose=${prose.length ? prose.length + " file(s): " + prose.join(",") : "(none)"}`);
  }
  // 结论本身（占位符 / 在 bash 中被使用）写在任务完成记录里；此处只保证读数可复现。
  assert.equal(SUSPECTS.length, 8, "八个嫌疑变量一个不能少");
});
