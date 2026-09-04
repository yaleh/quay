#!/usr/bin/env node
// mechanism-vitality-check.ts — gap-crystallization-five-directions ①②③④ 的零调用 triage 机件。
// 熔融-结晶张力的「结晶点熔融」(A 类): 182 已声明机件近 3 天零调用 89 个=49%, 而零调用此前是默认正常。
// 人 2026-08-10 硬修正 (必须照做): 「对这条的处理必须加时间/频率门限, 且处理时应回顾更大时间尺度的记录。
// 我们已经出现了很多『最近没有用』而被丢掉的有价值机制。」
//
// 本检查器把 ①②③④ 四方向落成可实跑的判定:
//   ① 失效前提入口闸 — 每条声明必须有 `失效前提:` 字段 (可测前提或显式「无可测前提，靠周期复核」);
//      缺字段 = 入口闸拒绝 (照 capability-catalog 已有 AC1c 做法)。本检查器独立再断言一遍。
//   ②a cadence 分档 — 零调用 > 3× 该机件自己声明的周期 (catalog CADENCE 字段: 每轮/每红窗/每里程碑/
//      冷启动/按需), 才进「待表态」; 不是统一天数 (3 天门限下 89/182=49% 是噪声)。
//   ②b 全历史表态 — 待表态条目的证据回看 git log --all (全历史提交数/首末提交), 不只看近 N 天;
//      meta-cc 全会话在输出里提示审视者手动回看 (本检查器无法代跑 MCP)。
//   ②c 禁止「最近没用」为唯一退休理由 — 退休必须给「理由失效」或「已被取代」实证; 本检查器永不退休,
//      只产出「待观察」; isLegalRetirementReason 拒绝「最近没用」形态的理由。
//   ②d 默认处置「待观察」不是「退休」。
//   ③ last-reaffirmed — 超 N 天 (默认 30) 未被任何调用/检查/复核触及 ⇒ 进「待重新确认」, 只看一眼盖章。
//   ④ 用 checker-lib 的 matchAtCommandPosition 判定「被引用」(按位置不按关键词), 并在 catalog MATCHING
//      表声明匹配方式 = position。
//
// 零调用 (call) 的操作性定义: 一个机件的「被调用」证据 = (a) 其 basename 出现在调用面 (plugin/loop/*.md、
// plugin/skills/*/SKILL.md、scripts/test.sh、orchestration/*tick*.md) 的命令/代码位置, 或 (b) 其脚本文件
// 在 git 里 3× 周期内有过提交触及。两者皆无 ⇒ 零调用。这是确定性、秒级的替代品; 真实执行计数
// (runtime-usage-inventory.ts, 读会话 transcript) 是更精确的读数, 但慢且环境相关 — 本检查器用 git+引用面,
// 并始终输出全历史证据供审视者复核。
//
// Usage:
//   node --experimental-strip-types plugin/scripts/mechanism-vitality-check.ts --check [--json]
//   node --experimental-strip-types plugin/scripts/mechanism-vitality-check.ts --selftest
//
// Exit: 0 = 失效前提入口闸 PASS (每条声明都有失效前提字段); 待表态/待重新确认是观察清单, 不是失败。
//       1 = 失效前提入口闸 FAIL (有声明缺失效前提字段) — 此时目录本就该 exit 非零 (capability-catalog AC1c)。
//       2 = usage/environment error.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { matchAtCommandPosition } from "./checker-lib.ts";
import { helpExit } from "./gate-script-base.ts";

// ── Types ───────────────────────────────────────────────────────────────────────────────────────────

export type Cadence = "每轮" | "每红窗" | "每里程碑" | "冷启动" | "按需";

export interface MechanismDecl {
  file: string;
  question: string;
  ships: boolean;
  cadence: string | null;
  invalidation: string | null;
  lastReaffirmed: string | null; // YYYY-MM-DD
  matching: string | null;
  /** 证据 (CLI 注入; 纯函数测试可注入 fixture): 脚本文件的 last git commit 时刻 (epoch ms)。 */
  lastTouchTs: number | null;
  /** 证据: git log --all 对脚本文件的全历史提交数 (②b 全历史表态)。 */
  callCountAll: number;
  /** 证据: basename 是否出现在调用面的命令/代码位置 (按位置不按关键词)。 */
  referencedNow: boolean;
}

// ── cadence → 3× 窗口 (②a: 按机件自己声明的周期, 非统一天数) ──────────────────────────────────────────
// 每轮≈1 天 → 3× = 3 天; 每红窗≈1 天 → 3× = 3 天; 每里程碑≈14 天 → 3× = 42 天;
// 冷启动≈10 天 → 3× = 30 天; 按需无固定周期 → 3× = 90 天 (只有真正休眠 3 个月才触发)。
export function cadence3xMs(cadence: string): number {
  switch (cadence) {
    case "每轮": return 3 * 24 * 3600 * 1000;
    case "每红窗": return 3 * 24 * 3600 * 1000;
    case "每里程碑": return 42 * 24 * 3600 * 1000;
    case "冷启动": return 30 * 24 * 3600 * 1000;
    case "按需": return 90 * 24 * 3600 * 1000;
    default: return 90 * 24 * 3600 * 1000;
  }
}

// ── ① 失效前提入口闸 ────────────────────────────────────────────────────────────────────────────────
// 每条声明必须有 失效前提 字段 (可测前提, 或显式「无可测前提，靠周期复核」)。缺字段 = 入口闸拒绝。
export function invalidationGateViolations(decls: readonly MechanismDecl[]): string[] {
  const violations: string[] = [];
  for (const d of decls) {
    if (!d.invalidation || !d.invalidation.trim()) {
      violations.push(`${d.file}: 缺失效前提 (invalidation-precondition) 字段 — 入口闸拒绝`);
    }
  }
  return violations;
}

// ── ②a cadence 分档 (枚举式: 每个档位列出成员, 不是布尔) ──────────────────────────────────────────────
export function cadenceBands(decls: readonly MechanismDecl[]): Record<string, string[]> {
  const bands: Record<string, string[]> = {};
  for (const d of decls) {
    if (!d.ships) continue;
    const c = d.cadence && d.cadence.trim() ? d.cadence : "未声明";
    (bands[c] ??= []).push(d.file);
  }
  return bands;
}

// ── 零调用判定: 引用面无 + git 无 3× 周期内触及 ───────────────────────────────────────────────────────
export function isZeroCallPast(d: MechanismDecl, nowTs: number): boolean {
  if (!d.ships || !d.cadence) return false;
  if (d.referencedNow) return false;
  if (d.lastTouchTs === null) return false; // 新建未提交文件不是「休眠」, 不能算零调用
  return nowTs - d.lastTouchTs > cadence3xMs(d.cadence);
}

/** 待表态清单: shipped 且 零调用 > 3× 声明周期。默认处置 待观察 (②d), 不是退休。 */
export function pendingDeclarationList(decls: readonly MechanismDecl[], nowTs: number): MechanismDecl[] {
  return decls.filter((d) => isZeroCallPast(d, nowTs));
}

// ── ③ last-reaffirmed 超期 → 待重新确认 ──────────────────────────────────────────────────────────────
export function lastReaffirmedStaleList(decls: readonly MechanismDecl[], nowTs: number, days = 30): MechanismDecl[] {
  const windowMs = days * 24 * 3600 * 1000;
  return decls.filter((d) => {
    if (!d.ships) return false;
    if (!d.lastReaffirmed) return false; // 无章可过期 — 不是「超期待重新确认」
    const lr = Date.parse(`${d.lastReaffirmed}T00:00:00Z`);
    if (Number.isNaN(lr)) return false;
    const last = Math.max(lr, d.lastTouchTs ?? 0);
    return nowTs - last > windowMs;
  });
}

// ── ②c 退休合法性: 退休必须给「理由失效」或「已被取代」实证, 拒绝「最近没用」 ─────────────────────────
export function isLegalRetirementReason(reason: string): boolean {
  return /理由失效|取代|superseded|invalidated|replaced/.test(reason);
}

/** 默认处置 (②d): 零调用/超期只导致「待观察」/「待重新确认」, 永不因「最近没用」退休。 */
export function dispositionFor(d: MechanismDecl): string {
  if (!d.ships) return "not-shipped";
  return "待观察";
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SELF_DIR, "../..");

/** 每个 plugin/scripts 文件的 git 全历史证据 (②b 全历史表态)。 */
interface FileGitIndex {
  /** 该文件在 git log --all 里最新一次提交 (epoch ms); null = 无提交 (新建/未提交)。 */
  lastTouchMs: number | null;
  /** git log --all 对该文件的全历史提交数。 */
  count: number;
  /** 该文件在 git log --all 里最早一次提交 (epoch s); null = 无提交。 */
  firstTs: number | null;
}

/**
 * 一次 `git log --all --name-only -- plugin/scripts/` 批量构建全部脚本文件的 git 证据 —
 * 而不是每文件 3 次子进程 (184 文件 × 3 ≈ 550 次子进程, ~55s)。输出格式:
 *   <epoch-秒>          ← %ct 头
 *   plugin/scripts/a.ts ← --name-only 文件行
 *   plugin/scripts/b.ts
 *                      ← 提交块之间空行
 *   <epoch-秒>
 *   ...
 * 默认 newest-first 顺序: 文件第一次出现 = 最新提交, 最后一次出现 = 最早提交。
 */
function gitIndexPluginScripts(root: string): Map<string, FileGitIndex> {
  const map = new Map<string, FileGitIndex>();
  try {
    const out = execFileSync(
      "git",
      ["-C", root, "log", "--all", "--format=%ct", "--name-only", "--", "plugin/scripts/"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    let curTs: number | null = null;
    for (const line of out.split(/\r?\n/)) {
      const t = line.trim();
      if (t === "") continue; // 提交块之间的空行 — 忽略, 不重置 (git 格式: ts → 空行 → 文件)
      if (/^\d+$/.test(t)) {
        curTs = parseInt(t, 10); // %ct 头 (纯数字行; 文件行都以 plugin/scripts/ 开头, 不会撞)
        continue;
      }
      if (curTs === null || !t.startsWith("plugin/scripts/")) continue;
      const e = map.get(t);
      if (e) {
        e.count++;
        e.firstTs = curTs; // newest-first: 后看到的更早
      } else {
        map.set(t, { lastTouchMs: curTs * 1000, count: 1, firstTs: curTs });
      }
    }
  } catch {
    /* 无 git 基线 → 空 index */
  }
  return map;
}

function fmtDay(secs: number | null): string | null {
  return secs === null ? null : new Date(secs * 1000).toISOString().slice(0, 10);
}

/** 调用面: 这些文件里出现 basename 的命令/代码位置 = 被引用。 */
const CALL_SURFACE_GLOBS = [
  "plugin/loop/*.md",
  "plugin/skills/*/SKILL.md",
  "scripts/test.sh",
  "orchestration/*tick*.md",
];

function callSurfaceFiles(root: string): string[] {
  const out: string[] = [];
  for (const glob of CALL_SURFACE_GLOBS) {
    const dir = path.dirname(path.join(root, glob));
    const pat = path.basename(glob);
    if (!fs.existsSync(dir)) continue;
    for (const e of fs.readdirSync(dir)) {
      if (e.includes("*")) continue;
      if (e.endsWith(".md") || e === "test.sh") {
        if (pat === "*.md" && !e.endsWith(".md")) continue;
        if (pat === "*.sh" && !e.endsWith(".sh")) continue;
        if (pat.endsWith("*tick*.md") && !(e.includes("tick") && e.endsWith(".md"))) continue;
        out.push(path.join(dir, e));
      }
    }
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isReferencedInSurface(root: string, basename: string, surfaceCache: Map<string, string>): boolean {
  // 位置判定: 匹配的是「完整 basename 词元」(结构签名), 不是关于它的模糊词。调用面里的路径几乎总在
  // shell 引号里 (run_checker "${repo_root}/plugin/scripts/x.ts"), 字符串掩码会把真实的接线 mask 掉 —
  // 所以这里 maskNonCode:false。按位置不按关键词的「位置」= 词元边界, 不是注释/字符串豁免。
  const re = new RegExp(`\\b${escapeRegExp(basename)}\\b`);
  for (const content of surfaceCache.values()) {
    if (matchAtCommandPosition(content, re, { maskNonCode: false }).length > 0) return true;
  }
  return false;
}

export function loadCatalogDecls(root: string): MechanismDecl[] {
  const catOut = execFileSync("bash", [path.join(root, "plugin", "scripts", "capability-catalog.sh"), "--json"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const rows = JSON.parse(catOut);
  return rows.map((r: any) => ({
    file: r.file,
    question: r.question ?? "",
    ships: r.ships === true,
    cadence: r.cadence ?? null,
    invalidation: r.invalidation ?? null,
    lastReaffirmed: r.last_reaffirmed ?? null,
    matching: r.matching ?? null,
    lastTouchTs: null,
    callCountAll: 0,
    referencedNow: false,
  }));
}

export function withEvidence(decls: MechanismDecl[], root: string, nowTs: number): MechanismDecl[] {
  const surfaceCache = new Map<string, string>();
  for (const f of callSurfaceFiles(root)) {
    try {
      surfaceCache.set(f, fs.readFileSync(f, "utf8"));
    } catch {
      /* skip unreadable */
    }
  }
  const gitIndex = gitIndexPluginScripts(root);
  return decls.map((d) => {
    const rel = `plugin/scripts/${d.file}`;
    const gi = gitIndex.get(rel);
    return {
      ...d,
      lastTouchTs: gi ? gi.lastTouchMs : null,
      callCountAll: gi ? gi.count : 0,
      referencedNow: isReferencedInSurface(root, d.file, surfaceCache),
    };
  });
}

function formatDate(ts: number | null): string {
  return ts === null ? "—(新建/未提交)" : new Date(ts).toISOString().slice(0, 10);
}

/** 由批量 git index 派生: 该文件最早提交日 (全历史表态 ②b)。 */
function firstCommitDay(gitIndex: Map<string, FileGitIndex>, rel: string): string | null {
  return fmtDay(gitIndex.get(rel)?.firstTs ?? null);
}

/** 由批量 git index 派生: 该文件最新提交日。 */
function lastCommitDay(gitIndex: Map<string, FileGitIndex>, rel: string): string | null {
  const gi = gitIndex.get(rel);
  return gi ? fmtDay(gi.lastTouchMs !== null ? gi.lastTouchMs / 1000 : null) : null;
}

function runCheck(root: string, asJson: boolean): number {
  const nowTs = Date.now();
  const decls = withEvidence(loadCatalogDecls(root), root, nowTs);
  const shipped = decls.filter((d) => d.ships);

  const gateViolations = invalidationGateViolations(shipped);
  const bands = cadenceBands(shipped);
  const pending = pendingDeclarationList(shipped, nowTs);
  const stale = lastReaffirmedStaleList(shipped, nowTs);
  const gitIndex = gitIndexPluginScripts(root);

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          now: new Date(nowTs).toISOString(),
          shipped: shipped.length,
          cadence_bands: bands,
          invalidation_gate: {
            ok: gateViolations.length === 0,
            violations: gateViolations,
          },
          pending_declaration: pending.map((d) => ({
            file: d.file,
            cadence: d.cadence,
            window_3x_days: Math.round(cadence3xMs(d.cadence ?? "") / 86400000),
            last_touch: formatDate(d.lastTouchTs),
            last_touch_iso: d.lastTouchTs === null ? null : new Date(d.lastTouchTs).toISOString(),
            git_log_all_commits: d.callCountAll,
            first_commit: firstCommitDay(gitIndex, `plugin/scripts/${d.file}`),
            disposition: dispositionFor(d),
          })),
          pending_reaffirm: stale.map((d) => d.file),
          retirement_rule: {
            ok: true,
            note: "默认处置=待观察; 退休必须给理由失效/已被取代实证, 永不因最近没用",
          },
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`mechanism-vitality-check — 熔融-结晶张力 ①②③④ (${new Date(nowTs).toISOString()})`);
    console.log(`失效前提入口闸 (①): ${gateViolations.length === 0 ? "PASS" : `FAIL — ${gateViolations.length} 条声明缺失效前提`}`);
    for (const v of gateViolations) console.log(`    ${v}`);
    console.log(`cadence 分档 (②a, 按机件声明周期, 非统一天数):`);
    for (const [c, files] of Object.entries(bands)) {
      console.log(`    ${c}×3窗=${Math.round(cadence3xMs(c) / 86400000)}天  → ${files.length} 个`);
    }
    console.log(`零调用全历史表态 (②b, ${pending.length} 个待表态, 默认处置 待观察 ②d):`);
    if (pending.length === 0) {
      console.log("    (无 — 没有 shipped 机件零调用超过 3× 声明周期)");
    }
    for (const d of pending) {
      console.log(
        `    - ${d.file} [${d.cadence}, 3×窗=${Math.round(cadence3xMs(d.cadence ?? "") / 86400000)}天] ` +
          `last-touch=${formatDate(d.lastTouchTs)} 全历史提交=${d.callCountAll} ` +
          `首提交=${firstCommitDay(gitIndex, `plugin/scripts/${d.file}`)} ` +
          `末提交=${lastCommitDay(gitIndex, `plugin/scripts/${d.file}`)} → ${dispositionFor(d)}`,
      );
      if (d.callCountAll > 0) {
        console.log(`        全历史提示 (②b): 本条目历史有 ${d.callCountAll} 次提交触及 — 按人硬修正, 表态须回看全历史 (git log --all + meta-cc 全会话), 不得只看近 N 天`);
      }
    }
    console.log(`待重新确认 (③, last-reaffirmed 超 30 天未触及, ${stale.length} 个):`);
    if (stale.length === 0) console.log("    (无 — 全部 last-reaffirmed 均为 2026-08-10 初始章)");
    for (const d of stale) console.log(`    - ${d.file} [last-reaffirmed=${d.lastReaffirmed}, last-touch=${formatDate(d.lastTouchTs)}]`);
    console.log(`退休规则 (②c/②d): PASS — 默认处置=待观察; 退休必须给「理由失效」或「已被取代」实证, 永不因「最近没用」`);
  }
  return gateViolations.length === 0 ? 0 : 1;
}

function usage(): never {
  console.error(
    "usage: node mechanism-vitality-check.ts --check [--json]\n" +
      "       node mechanism-vitality-check.ts --selftest\n" +
      "Exit: 0 = 失效前提入口闸 PASS (观察清单是信息, 不是失败); 1 = 入口闸 FAIL; 2 = usage/env error.",
  );
  process.exit(2);
}

function runSelftest(): boolean {
  let pass = 0;
  let fail = 0;
  const check = (name: string, cond: boolean, detail = "") => {
    if (cond) pass++;
    else {
      fail++;
      console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
    }
  };

  const now = Date.parse("2026-08-10T00:00:00Z");
  const day = 24 * 3600 * 1000;
  const mk = (o: Partial<MechanismDecl>): MechanismDecl => ({
    file: o.file ?? "x.ts",
    question: "",
    ships: true,
    cadence: "每轮",
    invalidation: "无可测前提，靠周期复核",
    lastReaffirmed: "2026-08-10",
    matching: "position",
    lastTouchTs: null,
    callCountAll: 0,
    referencedNow: false,
    ...o,
  });

  // ① 入口闸: 缺失效前提 = 违规; 显式「无可测前提」= 合规。
  check("① invalidation gate: missing field is a violation", invalidationGateViolations([mk({ invalidation: null })]).length === 1);
  check("① invalidation gate: explicit marker is compliant", invalidationGateViolations([mk({ invalidation: "无可测前提，靠周期复核" })]).length === 0);
  check("① invalidation gate: testable precondition is compliant", invalidationGateViolations([mk({ invalidation: "失效前提：X；若 Y 则不适用" })]).length === 0);

  // ②a 零调用门限: 按声明周期, 非统一天数。
  const old = now - 10 * day; // 10 天前最后触及
  const recent = now - 1 * day; // 1 天前
  check("②a zero-call: 每轮 (3×=3天) 10 天未触及 → 待表态", isZeroCallPast(mk({ cadence: "每轮", lastTouchTs: old }), now) === true);
  check("②a zero-call: 每轮 1 天未触及 → 不待表态", isZeroCallPast(mk({ cadence: "每轮", lastTouchTs: recent }), now) === false);
  check("②a non-uniform: 每里程碑 (3×=42天) 10 天未触及 → 不待表态", isZeroCallPast(mk({ cadence: "每里程碑", lastTouchTs: old }), now) === false);
  check("②a non-uniform: 按需 (3×=90天) 10 天未触及 → 不待表态", isZeroCallPast(mk({ cadence: "按需", lastTouchTs: old }), now) === false);
  check("②a referenced → never zero-call", isZeroCallPast(mk({ cadence: "每轮", lastTouchTs: old, referencedNow: true }), now) === false);
  check("②a new uncommitted file (lastTouch null) → not zero-call", isZeroCallPast(mk({ cadence: "每轮", lastTouchTs: null }), now) === false);

  // ②d 默认处置待观察, 永不退休。
  check("②d default disposition is 待观察, never 退休", dispositionFor(mk({})) === "待观察");
  check("②c retirement reason rejects 最近没用", isLegalRetirementReason("最近没用") === false);
  check("②c retirement reason accepts 理由失效", isLegalRetirementReason("失效前提已不成立(理由失效)") === true);
  check("②c retirement reason accepts 已被取代", isLegalRetirementReason("已被 send-keys-reliable 取代") === true);

  // ③ last-reaffirmed 超期。
  const staleLr = now - 45 * day;
  check("③ last-reaffirmed stale: 45 天未触及 → 待重新确认", lastReaffirmedStaleList([mk({ lastReaffirmed: "2026-06-26", lastTouchTs: staleLr })], now).length === 1);
  check("③ last-reaffirmed fresh: 今日章 → 不待重新确认", lastReaffirmedStaleList([mk({ lastReaffirmed: "2026-08-10", lastTouchTs: recent })], now).length === 0);
  check("③ last-reaffirmed touched: 有 git 触及在窗口内 → 不待重新确认", lastReaffirmedStaleList([mk({ lastReaffirmed: "2026-06-26", lastTouchTs: recent })], now).length === 0);

  // ②a cadence 分档枚举。
  const bands = cadenceBands([mk({ file: "a.sh", cadence: "每轮" }), mk({ file: "b.ts", cadence: "按需" }), mk({ file: "c.sh", cadence: "每轮" })]);
  check("②a cadence bands enumerate members per band", bands["每轮"]?.length === 2 && bands["按需"]?.length === 1, JSON.stringify(bands));

  console.log(`\nmechanism-vitality-check --selftest: ${pass} passed, ${fail} failed`);
  return fail === 0;
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit("usage: node mechanism-vitality-check.ts --check [--json] | --selftest");
  if (args.includes("--selftest")) return runSelftest() ? 0 : 1;
  if (args.includes("--check")) return runCheck(REPO_ROOT, args.includes("--json"));
  usage();
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) {
  process.exit(main(process.argv));
}
