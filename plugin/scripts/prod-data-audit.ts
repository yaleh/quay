// prod-data-audit.ts — @instrument "生产数据入账审计：按载体聚合三态判定"
//   tasks/gap-prod-data-accounting-audit（人 2026-08-14 14:5xZ 令 outer 安排审计；推翻 manager 14:5x 的
//   「不回查只前向生效」建议，以人为准）。
//
// Answer: 被 done 任务 AC 引用的【生产载体】各自处于三态的哪一态——
//   ① HAS_DATA      载体中实现落地提交时刻之后的记录数 ≥1
//   ② ZERO_DATA     载体存在但落地后记录数 = 0（今天 gap-phase-boundary-differential-accounting 那一态）
//   ③ NOT_EVALUATED 载体不存在 / 定位不到 / 无法确定落地时刻 —— 独立取值，绝不与「通过」同形（硬规则 3b）
//
// 审计自身两条自检：
//   - 读【生产载体】（解析 .quay/ .workflow-events/ milestones/fast-mode-telemetry/ 真实文件 + git 落地时刻），
//     ⛔ 不读任务体自述的「已落地/已验证」（任务体自述正是今天被证伪的形态）。
//   - 关掉 fixture/注入 seam 仍能跑出结论（本脚本无任何 fixture 依赖——对真实生产树跑，出真实读数）。
//
// 载体类型前置分类（判据5，三态判定之前）：
//   累积载体（append-only，.jsonl）⇒ 「落地后记录数 ≥1」是对的判据    例：verification-round.jsonl
//   状态文件（有/无即语义，.json） ⇒ 「不存在」可能正是正常态          例：inner-blocked.json（CLI 唯一写入，--clear 归档）
//   已退役载体                      ⇒ 「不存在」是预期（直接出局）     例：heavy-op-token-events（2026-08-06 人裁定退休）
//   每个载体先查两件事：a) 全仓非测试写入者（grep 可执行文件）零 ⇒ 疑似真命中；
//                        b) 出现在 retired-clause-check.ts / loop-shipping-exclusion-data.mjs ⇒ 已退役直接出局。
//
// 谓词自检（判据6）：每报一个 NOT-FOUND，同时打印一个已知存在载体的命中（区分「文件真不在」与「find 写错」）。
//
// 只计数，不修复（判据1）。第一遍成本可测，跑完再谈修不修。
//
// Usage:
//   node --no-warnings --experimental-strip-types plugin/scripts/prod-data-audit.ts [--root <dir>] [--json]
//   --root <dir>  repo root to start from（默认：本脚本所在仓库；若是 git worktree，自动追到主检出读生产数据）
//   --json        打印机器可读 JSON 摘要（三态计数+清单）

import fs from "node:fs";
import { repoRoot } from "./repo-root.ts";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// ── 常量 ────────────────────────────────────────────────────────────────────────────────────────────────
export const THREE_STATES = { HAS_DATA: "HAS_DATA", ZERO_DATA: "ZERO_DATA", NOT_EVALUATED: "NOT_EVALUATED" } as const;
export type ThreeState = (typeof THREE_STATES)[keyof typeof THREE_STATES];

export const DISPOSITIONS = { OK: "OK", SUSPECT: "SUSPECT", NORMAL_ABSENT: "NORMAL_ABSENT", RETIRED: "RETIRED" } as const;
export type Disposition = (typeof DISPOSITIONS)[keyof typeof DISPOSITIONS];

export const CARRIER_KINDS = { ACCUMULATOR: "accumulator", STATE: "state", RETIRED: "retired" } as const;
export type CarrierKind = (typeof CARRIER_KINDS)[keyof typeof CARRIER_KINDS];

// 任务体命名的具体载体（即使边界化引用计数为 0 也总是入报告——宽松正则的假阳性要显式呈现，不能静默消失）。
export const EXPLICIT_CARRIERS = [
  "verification-round.jsonl",
  "events.jsonl",
  "checker-cost.jsonl",
  "full-suite-state.json",
  "inner-blocked.json",
  "heavy-op-token-events.jsonl",
  "gate-events.jsonl",
  "inner-agent-budget.json",
];

// 生产载体目录（审计枚举载体时查找的根目录）。
export const CARRIER_DIRS = [".quay", ".workflow-events", "milestones/fast-mode-telemetry"];

// 非载体的文件形态（发现时排除）。
const NON_CARRIER_FILE_RE = /\.(log|txt|md|bak|snapshot|diff|lock|png|jpg)$/i;
const NON_CARRIER_DIR_RE = /(manager-inbox|outer-inbox|residue|prepare-epochs|node-compile-cache|\.git)/;

// 记录时间戳的候选键（JSONL 记录 / JSON 状态对象）。
const TS_KEYS = ["at", "ts", "timestamp", "time", "startedAt", "endedAt", "finishedAt", "when", "date", "createdAt", "updatedAt"];

const RETIRED_CHECK_FILES = [
  "plugin/scripts/retired-clause-check.ts",
  "plugin/scripts/loop-shipping-exclusion-data.mjs",
];


// 生产数据在【主检出】里（gitignored 运行态），不在 worktree。若给定根是 linked worktree（.git 是文件），
// 沿 `git rev-parse --git-common-dir` 追到主检出——审计必须读生产载体（判据3）。
export function resolveProductionRoot(startDir) {
  const root = repoRoot(startDir);
  if (!root) return startDir;
  const gitDot = path.join(root, ".git");
  if (fs.existsSync(gitDot) && fs.statSync(gitDot).isFile()) {
    try {
      const commonDir = execFileSync("git", ["-C", root, "rev-parse", "--git-common-dir"], {
        encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (commonDir) {
        const mainRoot = path.resolve(commonDir, "..");
        if (fs.existsSync(mainRoot)) return mainRoot;
      }
    } catch { /* git unavailable — fall back to the given root */ }
  }
  return root;
}

// ── 纯工具 ─────────────────────────────────────────────────────────────────────────────────────────────
export function basenameOf(name) {
  return String(name ?? "").split(/[\\/]/).pop() ?? "";
}

export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 边界化文件名引用：`events.jsonl` 不得命中 `gate-events.jsonl` 的子串（按位置判定，硬规则②）。
export function hasCarrierRef(text, basename) {
  if (!text) return false;
  const re = new RegExp(`(?<![A-Za-z0-9_.-])${escapeRegExp(basename)}(?![A-Za-z0-9_.-])`);
  return re.test(text);
}

// 提取 ## Acceptance Criteria 段（容忍标题后缀，如 `(runnable — …)`）。找不到 → ""。
export function extractAcSection(body) {
  const m = String(body ?? "").match(/^##\s*Acceptance Criteria[^\n]*$/m);
  if (!m) return "";
  const start = m.index + m[0].length;
  const rest = String(body).slice(start);
  const next = rest.match(/^##\s/m);
  return next ? rest.slice(0, next.index) : rest;
}

export function parseRecordEpoch(obj) {
  if (typeof obj !== "object" || obj === null) return null;
  for (const k of TS_KEYS) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      if (v >= 1e12) return v; // ms since epoch
      if (v >= 1e9) return v * 1000; // s since epoch
      return null; // ambiguous small number — not a reliable epoch
    }
    if (typeof v === "string") {
      const t = Date.parse(v);
      if (!Number.isNaN(t)) return t;
    }
  }
  return null;
}

export function recordEpochsFromFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const epochs = [];
  let parseable = 0;
  for (const line of lines) {
    let obj = null;
    try { obj = JSON.parse(line); } catch { obj = null; }
    const e = obj === null ? null : parseRecordEpoch(obj);
    epochs.push(e);
    if (e !== null) parseable++;
  }
  return { count: lines.length, parseable, epochs };
}

// 已退役载体：在 retired-clause-check.ts / loop-shipping-exclusion-data.mjs 中按 stem 前缀匹配。
// 只匹配【退役声明行】（含 退休/retired/RETIRED/was removed/退役），且前缀必须 ≥2 个 dash 段——
// 否则任何与这两个文件内容共享的通用词（verification/full/suite/gate/events/checker…）都会误判退役
// （实证：宽松匹配把 verification-round.jsonl 等 8 个活载体全误判 RETIRED）。
export function isRetiredCarrier(name, retiredTexts) {
  const stem = basenameOf(name).replace(/\.(jsonl|json)$/i, "");
  const relevantLines = [];
  for (const t of retiredTexts) {
    for (const line of t.split(/\r?\n/)) {
      if (/退休|retired|RETIRED|was removed|退役|retirement/.test(line)) relevantLines.push(line);
    }
  }
  if (relevantLines.length === 0) return false;
  const parts = stem.split("-");
  for (let i = parts.length; i >= 2; i--) {
    const candidate = parts.slice(0, i).join("-");
    if (candidate.length < 5) continue; // 太短的前缀不判退役
    const re = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(candidate)}(?![A-Za-z0-9])`);
    if (relevantLines.some((l) => re.test(l))) return true;
  }
  return false;
}

// 载体类型前置分类（判据5）：.jsonl ⇒ 累积；.json ⇒ 状态文件；退役检查优先。
export function readCarrierKind(name, retiredTexts) {
  if (isRetiredCarrier(name, retiredTexts)) return CARRIER_KINDS.RETIRED;
  return /\.jsonl$/i.test(basenameOf(name)) ? CARRIER_KINDS.ACCUMULATOR : CARRIER_KINDS.STATE;
}

// 全仓（可执行代码）写入者计数：非测试（plugin/scripts, plugin/loop, orchestration, packages）vs 测试（plugin/test）。
// 先 grep -rl 粗筛候选文件，再用边界化 hasCarrierRef 过滤——避免 `events.jsonl` 把 `gate-events.jsonl`
// 的文件计成写入者（硬规则② 按位置判定）。
export function countWriters(root, basename, { codeDirs = null, testDirs = null } = {}) {
  const nonTestDirs = codeDirs ?? ["plugin/scripts", "plugin/loop", "orchestration", "packages"];
  const tDirs = testDirs ?? ["plugin/test"];
  const count = (dirs) => {
    let n = 0;
    for (const d of dirs) {
      const abs = path.join(root, d);
      if (!fs.existsSync(abs)) continue;
      let candidates = [];
      try {
        const out = execFileSync("grep", ["-rl", "--include=*.ts", "--include=*.js", "--include=*.mjs", "--include=*.sh", "--", basename, abs], {
          encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        if (out) candidates = out.split("\n");
      } catch { /* grep exit 1 = no match — 0 */ }
      for (const cand of candidates) {
        if (!cand) continue;
        try {
          if (hasCarrierRef(fs.readFileSync(cand, "utf8"), basename)) n++;
        } catch { /* unreadable — skip */ }
      }
    }
    return n;
  };
  return { nonTest: count(nonTestDirs), test: count(tDirs) };
}

// 载体被引用在【仓库外】（如 $QUAY_GLOBAL_DIR/session-observation/events.jsonl）——审计定位不到是「不在仓内」而非「零写入」。
export function hasGlobalDirReference(root, base) {
  const dirs = ["plugin/scripts", "plugin/loop", "orchestration", "packages"];
  for (const d of dirs) {
    const abs = path.join(root, d);
    if (!fs.existsSync(abs)) continue;
    try {
      const out = execFileSync("grep", ["-rl", "-E", `QUAY_GLOBAL_DIR[^"']*${escapeRegExp(base)}`, "--include=*.ts", "--include=*.js", "--include=*.mjs", "--include=*.sh", "--", abs], {
        encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (out) return true;
    } catch { /* no hit */ }
  }
  return false;
}

// 定位载体文件：先在已知载体目录找，再在仓库内做有界 find（排除 node_modules/.git/fixtures/test）。
export function locateCarrier(prodRoot, name) {
  const base = basenameOf(name);
  for (const d of CARRIER_DIRS) {
    const p = path.join(prodRoot, d, base);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  // 仓库根直挂的（如 .quay 之外的全局形态）——有界 find，排除噪音目录。
  try {
    const out = execFileSync("find", [
      prodRoot, "-maxdepth", "6", "-type", "f", "-name", base,
      "-not", "-path", "*/node_modules/*", "-not", "-path", "*/.git/*",
      "-not", "-path", "*/fixtures/*", "-not", "-path", "*/test/*", "-not", "-path", "*/__tests__/*",
    ], { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (out) {
      const first = out.split("\n")[0].trim();
      if (first) return first;
    }
  } catch { /* no hit */ }
  return null;
}

// 一个任务（done）的落地时刻（ms epoch）：最近一条提及任务 id 的提交 与 最近一条改任务文件的提交，取较新者。
// git `%ct` 是秒；统一 ×1000 转 ms 再与记录时间戳（parseRecordEpoch 返回 ms）比较。
export function taskLandingEpoch(gitRoot, taskId) {
  const candidates = [];
  try {
    const grepOut = execFileSync("git", ["-C", gitRoot, "log", "--all", "--format=%ct", `--grep=${taskId}`, "-1"], {
      encoding: "utf8", timeout: 20_000, stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (grepOut) candidates.push(Number(grepOut) * 1000);
  } catch { /* no match / git error */ }
  try {
    const fileOut = execFileSync("git", ["-C", gitRoot, "log", "--format=%ct", "-1", "--", `tasks/${taskId}.md`], {
      encoding: "utf8", timeout: 20_000, stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (fileOut) candidates.push(Number(fileOut) * 1000);
  } catch { /* no history */ }
  return candidates.length ? Math.max(...candidates) : null;
}

// 载体的落地时刻窗口 = 引用它的 done 任务里【最早】与【最晚】落地时刻。
//   earliest：窗口起点——「载体在 claiming 窗口内有没有被写」的宽松判据（低假阳）。
//   latest：窗口终点——「最近一条 claim 落地后载体还有没有写」的严格判据（今天 incident 形态：
//   gap-phase-boundary-differential-accounting 落地 08-13 17:28 后 verification-round.jsonl 零记录）。
//   全部无法定 → { earliest: null, latest: null }。
export function carrierLandingEpoch(gitRoot, taskIds) {
  let earliest = null;
  let latest = null;
  for (const id of taskIds) {
    const e = taskLandingEpoch(gitRoot, id);
    if (e === null) continue;
    if (earliest === null || e < earliest) earliest = e;
    if (latest === null || e > latest) latest = e;
  }
  return { earliest, latest };
}

// ── 载体发现 ────────────────────────────────────────────────────────────────────────────────────────────
export function discoverProductionCarriers(prodRoot) {
  const found = new Set();
  const addFromDir = (rel) => {
    const abs = path.join(prodRoot, rel);
    if (!fs.existsSync(abs)) return;
    let entries;
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      if (NON_CARRIER_FILE_RE.test(ent.name)) continue;
      if (/\.(json|jsonl)$/i.test(ent.name)) found.add(ent.name);
    }
  };
  for (const d of CARRIER_DIRS) addFromDir(d);
  return [...found].sort();
}

export function readRetiredCheckTexts(prodRoot) {
  const texts = [];
  for (const rel of RETIRED_CHECK_FILES) {
    const p = path.join(prodRoot, rel);
    if (fs.existsSync(p)) {
      try { texts.push(fs.readFileSync(p, "utf8")); } catch { /* unreadable */ }
    }
  }
  return texts;
}

export function readDoneTasks(root) {
  const tasksDir = path.join(root, "tasks");
  const out = [];
  if (!fs.existsSync(tasksDir)) return out;
  for (const f of fs.readdirSync(tasksDir)) {
    if (!/\.md$/.test(f)) continue;
    const full = path.join(tasksDir, f);
    let text;
    try { text = fs.readFileSync(full, "utf8"); } catch { continue; }
    const status = text.match(/^status:\s*(\S+)/m);
    if (status && status[1] === TASK_STATUS.DONE) {
      const id = f.replace(/\.md$/, "");
      out.push({ id, file: full, text });
    }
  }
  return out;
}

// ── 单载体三态判定 ─────────────────────────────────────────────────────────────────────────────────────
export function classifyCarrier({
  name, doneTasks, prodRoot, gitRoot, retiredTexts, predicateHit,
  refsById = null, landingById = null, writersById = null,
}) {
  const base = basenameOf(name);
  const kind = readCarrierKind(base, retiredTexts);

  // 引用计数（边界化，AC 段 + 全任务体）。批量路径（buildAudit 传 refsById）用预计算索引，
  // 否则逐任务逐载体跑 hasCarrierRef（独立调用 / fixture 路径保持原语义）。
  let acRefs = 0;
  let bodyRefs = 0;
  let citingTasks = [];
  const ref = refsById ? refsById.get(base) : undefined;
  if (ref) {
    acRefs = ref.acRefs;
    bodyRefs = ref.bodyRefs;
    citingTasks = ref.citing;
  } else {
    const citing = new Set();
    for (const task of doneTasks) {
      const inAc = hasCarrierRef(extractAcSection(task.text), base);
      const inBody = hasCarrierRef(task.text, base);
      if (inAc) acRefs++;
      if (inBody) bodyRefs++;
      if (inAc) citing.add(task.id);
    }
    citingTasks = [...citing].sort();
  }

  // 已退役 → 直接出局。
  if (kind === CARRIER_KINDS.RETIRED) {
    return {
      name: base, kind, refs: acRefs, bodyRefs, citingTasks,
      found: false, path: null,
      threeState: THREE_STATES.NOT_EVALUATED, reason: "retired-carrier: 已退役（retired-clause-check.ts / loop-shipping-exclusion-data.mjs），不存在是预期，直接出局",
      disposition: DISPOSITIONS.RETIRED, recordCount: null, recordsAfterLanding: null,
      landingEpoch: null, latestLandingEpoch: null, landingVerified: false, staleVsLatestClaim: false,
      writers: { nonTest: 0, test: 0 },
      predicateHit,
    };
  }

  const located = locateCarrier(prodRoot, base);
  const writers = writersById
    ? (writersById.get(base) ?? { nonTest: 0, test: 0 })
    : countWriters(prodRoot, base);
  let landingEpoch = null;
  let latestLandingEpoch = null;
  if (citingTasks.length) {
    if (landingById) {
      for (const id of citingTasks) {
        const e = landingById.get(id);
        if (e === null || e === undefined) continue;
        if (landingEpoch === null || e < landingEpoch) landingEpoch = e;
        if (latestLandingEpoch === null || e > latestLandingEpoch) latestLandingEpoch = e;
      }
    } else {
      ({ earliest: landingEpoch, latest: latestLandingEpoch } = carrierLandingEpoch(gitRoot, citingTasks));
    }
  }
  const landingVerified = landingEpoch !== null;

  // 载体不存在。
  if (located === null) {
    const zeroWriters = writers.nonTest + writers.test === 0;
    let disposition;
    let reason;
    if (kind === CARRIER_KINDS.STATE && !zeroWriters) {
      disposition = DISPOSITIONS.NORMAL_ABSENT;
      reason = `not-found-but-state-file: 状态文件不存在可能是正常态（${writers.nonTest} 个非测试写入者存在）——需按位置核实写入者是否真的从未被调起`;
    } else if (zeroWriters) {
      disposition = DISPOSITIONS.SUSPECT;
      reason = `not-found-and-zero-writers: 全仓可执行代码（含测试）零写入者，却被 ${citingTasks.length} 条 done 任务 AC 引用——疑似真命中（今天 gap-phase-boundary-differential-accounting 形态）`;
    } else if (hasGlobalDirReference(prodRoot, base)) {
      disposition = DISPOSITIONS.SUSPECT;
      reason = `not-found-outside-repo: 载体在仓内不存在，但被引用指向仓库外（$QUAY_GLOBAL_DIR 下）——审计定位不到（需人工决定是否追全局目录）；${writers.nonTest} 个非测试引用`;
    } else {
      disposition = DISPOSITIONS.SUSPECT;
      reason = `not-found-but-writers-exist: 载体不存在但有 ${writers.nonTest} 个非测试写入者——写入者从未被调起或载体已退役但未被退役清单收录（需人工核实）`;
    }
    return {
      name: base, kind, refs: acRefs, bodyRefs, citingTasks,
      found: false, path: null,
      threeState: THREE_STATES.NOT_EVALUATED, reason,
      disposition, recordCount: null, recordsAfterLanding: null,
      landingEpoch, latestLandingEpoch, landingVerified, staleVsLatestClaim: false, writers, predicateHit,
    };
  }

  // 载体存在。
  const raw = fs.readFileSync(located, "utf8").trim();
  const isJsonl = /\.jsonl$/i.test(base);
  // 内容形态修正：`.jsonl` 扩展名但实为【单个 JSON 对象】（如 loop-driver.jsonl = 一个 cron 配置对象，
  // 无时间戳字段）——不是时间型累积载体，走状态文件语义，否则会误判「落地后 0 条」的假零数据。
  const singleJsonDoc = !isJsonl
    || raw.split(/\r?\n/).filter((l) => l.trim()).length === 1 && (() => {
      try {
        const o = JSON.parse(raw);
        return o !== null && typeof o === "object" && !Array.isArray(o);
      } catch { return false; }
    })();

  if (isJsonl && !singleJsonDoc) {
    const { count, parseable, epochs } = recordEpochsFromFile(located);
    const afterEarliest = landingVerified ? epochs.filter((e) => e !== null && e >= landingEpoch).length : null;
    const afterLatest = latestLandingEpoch !== null ? epochs.filter((e) => e !== null && e >= latestLandingEpoch).length : null;
    const staleVsLatestClaim = latestLandingEpoch !== null && afterLatest === 0;
    let threeState;
    let reason;
    if (count === 0) {
      threeState = THREE_STATES.ZERO_DATA;
      reason = "file-exists-but-empty: 载体存在但 0 条记录——测试绿+生产零数据形态";
    } else if (parseable === 0) {
      // 有时间戳读不出 → 「落地后记录数 ≥1」判据无法应用 → ③ 未评估（硬规则 3b：无法评估独立取值）。
      threeState = THREE_STATES.NOT_EVALUATED;
      reason = `temporal-log-unreadable: ${count} 行但无一行可解析出时间戳——「落地后记录数」判据无法应用，需人工按位置核实`;
    } else if (landingVerified && afterEarliest === 0) {
      threeState = THREE_STATES.ZERO_DATA;
      reason = `file-exists-but-records-predate-landing: ${count} 条记录全部早于落地时刻 ${new Date(landingEpoch).toISOString()}——落地后 0 条`;
    } else {
      threeState = THREE_STATES.HAS_DATA;
      reason = `has-data: ${count} 条记录${landingVerified ? `，落地后 ${afterEarliest} 条` : "（落地时刻不可定，按文件有数据计）"}${staleVsLatestClaim ? `；⚠️ 最近一条 claim（${new Date(latestLandingEpoch).toISOString()}）落地后 0 条——今天 incident 形态（见 staleVsLatestClaim）` : ""}`;
    }
    return {
      name: base, kind, refs: acRefs, bodyRefs, citingTasks,
      found: true, path: located,
      threeState, reason,
      disposition: threeState === THREE_STATES.HAS_DATA ? DISPOSITIONS.OK : DISPOSITIONS.SUSPECT,
      recordCount: count, recordsAfterLanding: afterEarliest,
      landingEpoch, latestLandingEpoch, landingVerified, staleVsLatestClaim, writers, predicateHit,
    };
  }

  // 状态文件（含单 JSON 对象形态的 `.jsonl`）。
  let obj = null;
  try { obj = JSON.parse(raw); } catch { obj = null; }
  const meaningful = obj !== null && typeof obj === "object" && Object.keys(obj).length > 0;
  const latestTs = obj !== null && typeof obj === "object" ? parseRecordEpoch(obj) : null;
  const staleVsLatestClaim = latestLandingEpoch !== null && latestTs !== null && latestTs < latestLandingEpoch;
  let threeState;
  let reason;
  if (!meaningful) {
    threeState = THREE_STATES.ZERO_DATA;
    reason = "state-file-empty: 状态文件存在但无可读内容——载体存在但落地后无数据";
  } else if (landingVerified && latestTs !== null && latestTs < landingEpoch) {
    threeState = THREE_STATES.ZERO_DATA;
    reason = `state-file-stale: 状态内容早于落地时刻 ${new Date(landingEpoch).toISOString()}（最近时间戳 ${new Date(latestTs).toISOString()}）`;
  } else {
    threeState = THREE_STATES.HAS_DATA;
    reason = `state-file-has-content: ${Object.keys(obj ?? {}).length} 个字段${latestTs ? `，最近时间戳 ${new Date(latestTs).toISOString()}` : ""}${staleVsLatestClaim ? `；⚠️ 最近一条 claim（${new Date(latestLandingEpoch).toISOString()}）落地后无更新——见 staleVsLatestClaim` : ""}`;
  }
  return {
    name: base, kind, refs: acRefs, bodyRefs, citingTasks,
    found: true, path: located,
    threeState, reason,
    disposition: threeState === THREE_STATES.HAS_DATA ? DISPOSITIONS.OK : DISPOSITIONS.SUSPECT,
    recordCount: raw.split(/\r?\n/).filter((l) => l.trim()).length, recordsAfterLanding: null,
    landingEpoch, latestLandingEpoch, landingVerified, staleVsLatestClaim, writers, predicateHit,
  };
}

// ── 批量预计算（替代 O(n²) 子进程）──────────────────────────────────────────────────────────────────────────
// buildAudit 原实现对每个载体跑 5×grep + 对每个引用任务跑 2×git log + 对每个载体×任务重提取 AC 段——载体数
// (815) × 任务数 (1478) 的 O(n²) 子进程/JS 成本，实测 buildAudit 一度 148s（载体 27、任务 1478）。
// 以下三个索引把同等工作压到 2×git log + 5×grep + 一次组合正则扫描，语义与单载体路径逐点一致。

// 编译所有载体 basename 的组合边界正则——与 hasCarrierRef 完全同语义（(?<![A-Za-z0-9_.-])…(?![A-Za-z0-9_.-])），
// 长优先（更具体的 basename 先匹配，如 gate-events.jsonl 先于 events.jsonl）。无载体 → null。
export function compileCarrierRegex(basenames) {
  const uniq = [...new Set(basenames)].filter((b) => b.length > 0).sort((a, b) => b.length - a.length);
  if (uniq.length === 0) return null;
  return new RegExp(
    `(?<![A-Za-z0-9_.-])(${uniq.map(escapeRegExp).join("|")})(?![A-Za-z0-9_.-])`,
    "g",
  );
}

// 引用计数索引：base → { acRefs, bodyRefs, citing }。对每个任务全文 + AC 段各跑一次组合正则（而非逐载体逐任务
// hasCarrierRef），引用语义与 classifyCarrier 原循环一致（acRefs = AC 段命中数；bodyRefs = 全任务体命中数；
// citing = AC 段命中的任务 id 排序）。
export function buildReferenceIndex(doneTasks, basenames) {
  const combined = compileCarrierRegex(basenames);
  const byName = new Map([...new Set(basenames)].filter((b) => b.length > 0).map((b) => [b, { acRefs: 0, bodyRefs: 0, citing: [] }]));
  if (!combined) return byName;
  for (const task of doneTasks) {
    const acText = extractAcSection(task.text);
    const acNames = new Set();
    for (const m of acText.matchAll(combined)) acNames.add(m[0]);
    const bodyNames = new Set();
    for (const m of task.text.matchAll(combined)) bodyNames.add(m[0]);
    for (const name of new Set([...acNames, ...bodyNames])) {
      const rec = byName.get(name);
      if (!rec) continue;
      if (bodyNames.has(name)) rec.bodyRefs++;
      if (acNames.has(name)) { rec.acRefs++; rec.citing.push(task.id); }
    }
  }
  for (const rec of byName.values()) rec.citing.sort();
  return byName;
}

// 落地时刻索引：taskId → epoch(ms)（无则 null）。一次 `git log --all`（全文消息提及，%B 含 subject+body，
// 与 taskLandingEpoch 的 `--grep` 同语义——任务 id 会出现在提交正文的交叉引用里，只看 %s 会漏）+ 一次
// `git log --name-only -- tasks/`（文件触碰）替代 taskLandingEpoch 的逐任务 2×git 子进程。epoch =
// max(消息提及最新, 触碰 tasks/<id>.md 最新)，与 taskLandingEpoch 的 Math.max 语义一致。
export function buildLandingEpochIndex(gitRoot, taskIds) {
  const idx = new Map(taskIds.map((id) => [id, null]));
  if (taskIds.length === 0) return idx;
  // 全文消息提及：%ct%x00%B%x00（NUL 分隔，提交消息不含 NUL ⇒ 按 \0 切成 (ct, message) 对）。
  try {
    const raw = execFileSync("git", ["-C", gitRoot, "log", "--all", "--format=%ct%x00%B%x00"], {
      encoding: "utf8", timeout: 60_000, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"],
    });
    const parts = raw.split("\0");
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const ctMs = Number(parts[i]) * 1000;
      if (!Number.isFinite(ctMs)) continue;
      const message = parts[i + 1];
      for (const id of taskIds) {
        if (message.includes(id)) {
          if (idx.get(id) === null || ctMs > idx.get(id)) idx.set(id, ctMs);
        }
      }
    }
  } catch { /* no history — all null */ }
  // 文件触碰：逐提交时间戳 + --name-only 的文件清单（最新在前）。裸数字行 = 新提交时间戳，tasks/*.md = 该提交触碰的任务文件。
  // 用【默认简化】的 `git log --name-only -- tasks/`（不加 -m/--diff-merges）——它与旧实现的逐任务
  // `git log -- tasks/<id>.md` 走同一套历史简化（merge 只在「非 treesame 于第一父」时才保留）。代价：
  // 默认合并 diff 为空 ⇒ 只经 merge 触碰、且 merge 消息正文不含该任务 id 的文件会少记一个（更早）的落地时刻；
  // 方向是【更早】⇒ 「落地后记录数」偏多 ⇒ 审计偏保守（更少假「落地后零数据」flag），是安全侧。
  try {
    const named = execFileSync("git", ["-C", gitRoot, "log", "--format=%ct", "--name-only", "--", "tasks/"], {
      encoding: "utf8", timeout: 60_000, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"],
    });
    let curCt = null;
    for (const line of named.split("\n")) {
      const t = line.trim();
      if (t === "") continue;
      if (/^\d+$/.test(t)) { curCt = Number(t) * 1000; continue; }
      if (curCt !== null && t.startsWith("tasks/") && t.endsWith(".md")) {
        const id = t.slice("tasks/".length, -".md".length);
        if (idx.has(id) && (idx.get(id) === null || curCt > idx.get(id))) idx.set(id, curCt);
      }
    }
  } catch { /* no history — keep message-mention only */ }
  return idx;
}

// 写入者索引：base → { nonTest, test }。每个代码目录只跑一次 `grep -rl -F -f -`（全部 basename 字面量作模式，
// 经 stdin 传入），再对候选文件跑一次组合边界正则把命中归因到各 basename——替代 countWriters 的逐载体 5×grep。
// `-F` 字面量粗筛是 hasCarrierRef 的严格超集（字面量子串 ⊇ 边界字面量），故不会漏掉任何 hasCarrierRef 会命中的文件。
export function buildWriterIndex(root, basenames) {
  const uniq = [...new Set(basenames)].filter((b) => b.length > 0);
  const idx = new Map(uniq.map((b) => [b, { nonTest: 0, test: 0 }]));
  if (uniq.length === 0) return idx;
  const combined = compileCarrierRegex(uniq);
  const nonTestDirs = ["plugin/scripts", "plugin/loop", "orchestration", "packages"];
  const testDirs = ["plugin/test"];
  const scan = (dirs, key) => {
    for (const d of dirs) {
      const abs = path.join(root, d);
      if (!fs.existsSync(abs)) continue;
      let cand = [];
      try {
        const out = execFileSync("grep", ["-rl", "-F", "-f", "-", "--include=*.ts", "--include=*.js", "--include=*.mjs", "--include=*.sh", "--", abs], {
          encoding: "utf8", timeout: 60_000, maxBuffer: 64 * 1024 * 1024, stdio: ["pipe", "pipe", "ignore"],
          input: uniq.join("\n") + "\n",
        }).trim();
        if (out) cand = out.split("\n");
      } catch { /* grep exit 1 = no match — 0 */ }
      for (const f of cand) {
        if (!f) continue;
        let text;
        try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
        if (!combined) continue;
        // 按【文件】计数（与 countWriters 一致：一个文件无论引用几次只计 1），不是按出现次数——
        // 同一文件多次引用同一 basename 时 matchAll 会给出多次命中，须先去重。
        const seen = new Set();
        for (const m of text.matchAll(combined)) seen.add(m[0]);
        for (const b of seen) {
          const rec = idx.get(b);
          if (rec) rec[key]++;
        }
      }
    }
  };
  scan(nonTestDirs, "nonTest");
  scan(testDirs, "test");
  return idx;
}

// ── 聚合审计 ────────────────────────────────────────────────────────────────────────────────────────────
export function buildAudit(startDir, { root = null } = {}) {
  const resolvedRoot = root ?? repoRoot(startDir);
  const prodRoot = resolveProductionRoot(startDir);
  const gitRoot = prodRoot; // git 操作都在主检出跑（生产数据 + 任务文件同源）
  const doneTasks = readDoneTasks(gitRoot);
  const retiredTexts = readRetiredCheckTexts(gitRoot);

  const discovered = discoverProductionCarriers(gitRoot);
  const carriers = new Set([...EXPLICIT_CARRIERS, ...discovered]);

  // 批量预计算三个索引（替代逐载体 5×grep + 逐引用任务 2×git log + 逐载体×逐任务 AC 段重提取）：
  //   refsById    引用计数（base → {acRefs, bodyRefs, citing}）
  //   landingById 落地时刻（taskId → epoch，只覆盖被引用任务）
  //   writersById 写入者计数（base → {nonTest, test}）
  const basenames = [...carriers].map(basenameOf);
  const refsById = buildReferenceIndex(doneTasks, basenames);
  const citedTaskIds = new Set();
  for (const rec of refsById.values()) for (const id of rec.citing) citedTaskIds.add(id);
  const landingById = buildLandingEpochIndex(gitRoot, [...citedTaskIds]);
  const writersById = buildWriterIndex(gitRoot, basenames);

  // 谓词自检（判据6）：挑一个已知存在的载体作「谓词命中」——证明 find 谓词本身工作。
  let predicateHit = null;
  for (const c of carriers) {
    const p = locateCarrier(gitRoot, c);
    if (p) { predicateHit = { name: c, path: p }; break; }
  }

  const reports = [];
  for (const name of carriers) {
    const rep = classifyCarrier({
      name, doneTasks, prodRoot, gitRoot, retiredTexts,
      predicateHit: predicateHit ? `${predicateHit.name}@${predicateHit.path}` : null,
      refsById, landingById, writersById,
    });
    // 只保留「被 done 任务 AC 引用」的载体进主清单；显式命名的载体即使 0 引用也保留（假阳性显式呈现）。
    if (rep.refs === 0 && !EXPLICIT_CARRIERS.includes(name)) continue;
    reports.push(rep);
  }
  reports.sort((a, b) => b.refs - a.refs || a.name.localeCompare(b.name));

  const counts = { HAS_DATA: 0, ZERO_DATA: 0, NOT_EVALUATED: 0 };
  for (const r of reports) counts[r.threeState]++;
  const suspects = reports.filter((r) => r.disposition === DISPOSITIONS.SUSPECT);
  const retired = reports.filter((r) => r.disposition === DISPOSITIONS.RETIRED);
  const normalAbsent = reports.filter((r) => r.disposition === DISPOSITIONS.NORMAL_ABSENT);
  const notFound = reports.filter((r) => !r.found);
  // 今天 incident 形态：载体有数据（三态①），但【最近一条 claim 落地后】零记录/零更新——严格判据单独呈现，不吞进①。
  const staleVsLatestClaim = reports.filter((r) => r.staleVsLatestClaim);

  return {
    generatedAt: new Date().toISOString(),
    repoRoot: resolvedRoot,
    prodRoot,
    doneTaskCount: doneTasks.length,
    discoveredCarrierCount: discovered.length,
    predicateHit: predicateHit ? `${predicateHit.name}@${predicateHit.path}` : null,
    counts,
    carriers: reports,
    suspects,
    retired,
    normalAbsent,
    staleVsLatestClaim,
    // 判据6：每个 NOT-FOUND 都带谓词命中（已写进每个 report 的 predicateHit 字段）；这里再显式列一份。
    notFound,
    threeStateNonBooleanized: true, // ①/②/③ 是三个独立字符串值，③ 独立取值 ≠ 通过
    notEvaluatedIsIndependent: reports.every((r) => r.threeState !== THREE_STATES.HAS_DATA || r.threeState !== THREE_STATES.NOT_EVALUATED),
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────────
function printReport(audit) {
  const out = [];
  out.push(`production-data accounting audit — ${audit.generatedAt}`);
  out.push(`production root: ${audit.prodRoot}`);
  out.push(`done tasks: ${audit.doneTaskCount} · discovered production carriers: ${audit.discoveredCarrierCount}`);
  out.push(`PREDICATE SELF-CHECK (判据6): known-present carrier hit = ${audit.predicateHit}`);
  out.push("");
  out.push("CARRIER-BY-CARRIER (三态判定，按 done 任务 AC 引用数排序):");
  for (const r of audit.carriers) {
    const mark =
      r.threeState === THREE_STATES.HAS_DATA ? "[① HAS_DATA]      " :
      r.threeState === THREE_STATES.ZERO_DATA ? "[② ZERO_DATA]     " :
      "[③ NOT_EVALUATED]";
    out.push(`  ${mark} ${r.name.padEnd(28)} kind=${String(r.kind).padEnd(11)} acRefs=${String(r.refs).padStart(3)} bodyRefs=${String(r.bodyRefs).padStart(3)} disp=${r.disposition}`);
    out.push(`        ${r.reason}`);
    if (!r.found && r.predicateHit) out.push(`        predicate-hit: ${r.predicateHit} (find 谓词有效 ⇒ NOT-FOUND 是真缺失)`);
    if (r.found) out.push(`        path: ${r.path}`);
  }
  out.push("");
  out.push(`COUNTS: ① has-data=${audit.counts.HAS_DATA} · ② zero-data=${audit.counts.ZERO_DATA} · ③ not-evaluated=${audit.counts.NOT_EVALUATED}`);
  out.push(`三态非布尔化（判据2）：③ NOT_EVALUATED 独立取值，绝不与①同形 — ${audit.threeStateNonBooleanized ? "confirmed" : "VIOLATION"}`);
  out.push("");
  if (audit.retired.length) {
    out.push(`RETIRED-OUT（判据5 b，已退役直接出局）: ${audit.retired.map((r) => r.name).join(", ")}`);
  }
  if (audit.normalAbsent.length) {
    out.push(`STATE-FILE NORMAL-ABSENT（判据5，无=正常态，非嫌疑）: ${audit.normalAbsent.map((r) => r.name).join(", ")}`);
  }
  if (audit.suspects.length) {
    out.push(`SUSPECTS（判据5 a：零写入者/落地后零数据——需人工按位置核实）:`);
    for (const r of audit.suspects) out.push(`  - ${r.name} (${r.reason})`);
  } else {
    out.push("SUSPECTS: none");
  }
  if (audit.staleVsLatestClaim.length) {
    out.push(`STALE-vs-latest-claim（今天 incident 形态：①有数据但最近一条 claim 落地后零记录——严格判据）:`);
    for (const r of audit.staleVsLatestClaim) out.push(`  - ${r.name} (latest claim ${new Date(r.latestLandingEpoch).toISOString()})`);
  }
  return out.join("\n");
}

export async function main(argv = process.argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`Usage: node --no-warnings --experimental-strip-types ${path.basename(fileURLToPath(import.meta.url))} [--root <dir>] [--json]\n`);
    return 0;
  }
  const rootIdx = args.indexOf("--root");
  const root = rootIdx >= 0 && args[rootIdx + 1] ? path.resolve(args[rootIdx + 1]) : null;
  const asJson = args.includes("--json");
  const startDir = root ?? repoRoot();
  const audit = buildAudit(startDir, { root });
  if (asJson) {
    process.stdout.write(JSON.stringify(audit, null, 2) + "\n");
  } else {
    process.stdout.write(printReport(audit) + "\n");
  }
  return 0;
}

// 直接入口（isDirectEntry 同形——被 import 时不跑 CLI）。
import { isDirectEntry } from "./gate-script-base.ts";
import { TASK_STATUS } from "./task-status.ts";
if (isDirectEntry(import.meta, undefined, "prod-data-audit")) {
  main(process.argv).then((code) => process.exit(code));
}
