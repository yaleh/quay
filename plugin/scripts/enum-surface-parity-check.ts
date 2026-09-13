#!/usr/bin/env node
// enum-surface-parity-check.ts — ADR-036 (枚举事实的单一真源与表层派生) 的机械强制器。
// Task: gap-enum-surfaces-hand-copied-across-cli-web-docs.
//
// PROBLEM IT FIXES. 同一件枚举事实（driver kinds、goal/meta/adr/task statuses…）在本仓库同时出现在多个
// 表层：实现常量、CLI 帮助文本、Web 控制面、MCP 工具描述、项目文档。这些副本此前【全部靠手抄维持一致】，
// 没有任何机械强制。实测（2026-09-13）driver kind 一个事实有 7 处副本、4 种取值；GOAL_STATUSES 与
// VALID_GOAL_STATUSES 取值已经不同（ABI 少一个 needs-human）。**漂移的失败形态是静默的**：帮助少列四个
// kind 既不报错也不影响功能，只是让能力在产品表层消失 —— 与「该能力不存在」完全同形（硬规则 3b 形态）。
//
// WHAT THIS CHECKER DOES. 它持有一张**显式登记表**（AUTHORITIES + SURFACES，见下），把每个权威枚举与
// 它在各表层的副本位置/取值逐条列出，并做**两向差集**（extra = 表层有而权威无；missing = 权威有而表层无）：
//
//   - policy "exact"  —— 表层取值必须与权威【逐一相等】。任何差集非空 ⇒ RED。
//   - policy "subset" —— 允许只暴露子集，但**必须在代码处写显式豁免注释并说明理由**（规范 5）：
//                        `enum-surface-exempt: <surface-id> — <理由 ≥12 字>`。
//                        无豁免注释的收窄是「沉默地少列几个」⇒ RED。
//                        extra（表层出现了权威里没有的值）**永远 RED** —— 那从来不是合法子集。
//
// ⛔ 豁免识别【不依赖注释与被检测构造的相对位置】（AC4 / archguard TASK-88 的实证坑：豁免注释写在被检测
// 构造【内部】时，那里的提取正则整个匹配失败、该项彻底隐形于检查 —— 三个工具因此漏检）。本实现把
// **面（surface）的发现**与**豁免的发现**彻底解耦：面来自本文件里的显式登记表（不依赖任何提取是否成功），
// 豁免是对【整个文件原文】按 surface-id 扫描（不是「构造之前的相邻注释」）。⇒ 注释放在构造之前/之中/之后
// 都同样被识别；而提取失败只会让该面变成 NOT-EVALUATED（第三态），**绝不伪装成「一致」**（硬规则 3b）。
//
// 三态输出（gap-not-evaluated-harness-third-state）：0 = PASS（无未豁免违规）／1 = RED（有违规）／
// 3 = NOT-EVALUATED（无违规，但至少一个权威或面读不出：文件缺失、解析失败、匹配 0 次）／2 = 用法·环境错。
// **NOT-EVALUATED 是独立取值，⛔ 不与「一致」共用输出**（AC3）。
//
// 已知漂移台账（KNOWN_DRIFT）。本任务的范围边界（task body）明确：文档面（CLAUDE.md / SKILL.md）与
// `driver.ts ↔ help.ts` 那一处的存量归位**不在本任务内**，本任务只负责让检查器【报出】它们。因此这些面
// 的既有差集登记在 KNOWN_DRIFT 里 —— 检查器**每轮原样报出**它们的完整两向差集，且：
//   - 差集【变大】（权威新增值 ⇒ 表层 missing 增长；或表层新增非法值 ⇒ extra 增长）⇒ RED（AC1 的取假面）；
//   - 差集【变小】（别的任务把它修好了）⇒ 容忍 + 报「已收窄/已清零，请清理台账」。
//     ⛔ 容忍收窄是刻意的：不把「别人修好了」变成 develop 上的红，从而不阻塞无关任务。
// 台账是 **shrink-only 的**：只有新增/增长才红（同 checker-mechanical-spine-exemptions.json 的形状）。
//
// 覆盖面（⛔ 说清「没查什么」）：面来自**显式登记表**，不是全仓正则发现；生成的产物（`plugin/vendor/**`
// 的打包副本、`*/dist/**`）与测试夹具【不登记】—— 前者由 sync-vendor / plugin-packaging 的 src→vendor
// 一致性检查守，后者不是交付面。`--discover` 段落另把「未登记的候选子集字面量」列出来（**仅供参考，
// 不参与退出码**），让「检查器看不见的副本」至少不是沉默的。
//
// Usage:
//   node --experimental-strip-types enum-surface-parity-check.ts [--root <dir>] [--json]
//     [--registry <path.json>]     # 显式覆盖登记表（测试/夹具用；缺省=本文件内建的表）
//
// Exit codes: 0 = PASS, 1 = RED (未豁免违规 / 台账增长), 2 = usage/env error, 3 = NOT-EVALUATED.

import fs from "node:fs";
import path from "node:path";
import { parseArgs, emitVerdict, isDirectEntry, type Verdict } from "./gate-script-base.ts";
import { buildNonCodeMask } from "./checker-lib.ts";

// ── registry types ────────────────────────────────────────────────────────────────────────────────
/** How a token set is read out of a file. */
export type ExtractKind = "ts-array" | "ts-object-keys" | "ts-string-union" | "text";

export interface AuthoritySpec {
  /** Stable id — the value surfaces reference. */
  id: string;
  /** Root-relative path of the file holding the single authoritative definition. */
  file: string;
  /** `export const <symbol> = [...]` / `= {...}` — required for the two ts-* kinds. */
  symbol?: string;
  /** Regex source: for `ts-string-union` it marks the union's start; for `ts-array` it is an
   *  alternative locator for a nameless literal. */
  anchor?: string;
  extract: ExtractKind;
}

export interface SurfaceSpec {
  /** Stable id — what an `enum-surface-exempt:` marker names. */
  id: string;
  /** The authority this surface copies. */
  authority: string;
  /** Root-relative path of the surface file. */
  file: string;
  extract: ExtractKind;
  symbol?: string;
  anchor?: string;
  /** text kind: which regex occurrences are judged (0-based). Omitted = every occurrence, and a
   *  changed occurrence count is itself reported (a new/removed copy must not be silent). */
  indices?: number[];
  policy: "exact" | "subset";
}

/** A recorded, currently-known drift for one surface (or one occurrence of it). */
export interface KnownDriftEntry {
  surface: string;
  /** text-kind occurrence index; omitted = the whole (non-text) surface. */
  index?: number;
  /** Values present on the surface but absent from the authority (measured at recording time). */
  extra: string[];
  /** Values present on the authority but absent from the surface (measured at recording time). */
  missing: string[];
  /** Why this is recorded rather than fixed here (the owning task, or the reason it is out of scope). */
  reason: string;
}

export interface Registry {
  authorities: AuthoritySpec[];
  surfaces: SurfaceSpec[];
  knownDrift: KnownDriftEntry[];
}

// ── the built-in registry (this repo) ─────────────────────────────────────────────────────────────
// Every row is a **delivery surface** the ADR names: a place where a human or an agent reads the
// enum and would be misled by a stale copy. Code comments are NOT registered (they are not delivered
// to any reader); help-text/description strings and doc prose ARE.
const AUTHORITIES: AuthoritySpec[] = [
  // ⛔ 真源判定（DoD「先定真源」）：driver kind 的权威**不是** cli/driver.ts 的 KINDS（那是消费者侧的
  // 白名单副本），而是 kernel 的那张数据表 —— respawn 循环、pid/控制态、carrier、per-kind 动词全部由
  // `DRIVER_KINDS` 驱动，新增一个 kind 的第一处永远是它（driver-runtime.ts 的头注释逐字如此规定）。
  { id: "driver-kind", file: "plugin/scripts/driver-runtime.ts", symbol: "DRIVER_KINDS", extract: "ts-object-keys" },
  { id: "driver-verb", file: "packages/quay/src/cli/driver.ts", symbol: "VERBS", extract: "ts-array" },
  { id: "goal-status", file: "packages/quay/src/abi.ts", symbol: "GOAL_STATUSES", extract: "ts-array" },
  { id: "meta-status", file: "packages/quay/src/abi.ts", symbol: "META_STATUSES", extract: "ts-array" },
  { id: "task-status", file: "packages/quay/src/abi.ts", symbol: "TASK_STATUSES", extract: "ts-array" },
  { id: "adr-status", file: "packages/quay/src/adr-store.ts", symbol: "VALID_ADR_STATUSES", extract: "ts-array" },
  { id: "doc-status", file: "packages/quay/src/document-store.ts", symbol: "VALID_DOCUMENT_STATUSES", extract: "ts-array" },
];

const SURFACES: SurfaceSpec[] = [
  // ── driver kind（6 值）──────────────────────────────────────────────────────────────────────────
  { id: "cli-driver-kinds", authority: "driver-kind", file: "packages/quay/src/cli/driver.ts", extract: "ts-array", symbol: "KINDS", policy: "exact" },
  { id: "driver-config-union", authority: "driver-kind", file: "plugin/scripts/driver-config.ts", extract: "ts-string-union", anchor: "kind:\\s*", policy: "exact" },
  { id: "web-driver-kinds", authority: "driver-kind", file: "packages/quay/src/serve-sessions.ts", extract: "ts-array", symbol: "WEB_DRIVER_KINDS", policy: "subset" },
  { id: "start-drivers-kinds", authority: "driver-kind", file: "plugin/scripts/start-drivers.ts", extract: "ts-array", symbol: "DRIVER_KINDS", policy: "exact" },
  { id: "cli-driver-help-kind", authority: "driver-kind", file: "packages/quay/src/cli/driver.ts", extract: "text", anchor: "--kind <([a-z-]+\\|[a-z|-]+)>", policy: "exact" },
  { id: "cli-help-kind", authority: "driver-kind", file: "packages/quay/src/cli/help.ts", extract: "text", anchor: "--kind <([a-z-]+\\|[a-z|-]+)>", policy: "exact" },
  { id: "driver-runtime-help-kind", authority: "driver-kind", file: "plugin/scripts/driver-runtime.ts", extract: "text", anchor: "--kind <([a-z-]+\\|[a-z|-]+)>", policy: "exact" },
  { id: "claude-md-driver-kind", authority: "driver-kind", file: "CLAUDE.md", extract: "text", anchor: "--kind <([a-z-]+\\|[a-z|-]+)>", policy: "exact" },
  { id: "drivers-skill-kind", authority: "driver-kind", file: "plugin/skills/drivers/SKILL.md", extract: "text", anchor: "--kind ([a-z-]+\\|[a-z|-]+)", policy: "exact" },
  // ── driver verb（6 值）──────────────────────────────────────────────────────────────────────────
  { id: "web-driver-verbs", authority: "driver-verb", file: "packages/quay/src/serve-sessions.ts", extract: "ts-array", symbol: "WEB_DRIVER_VERBS", policy: "subset" },
  { id: "cli-help-driver-usage-verbs", authority: "driver-verb", file: "packages/quay/src/cli/help.ts", extract: "text", anchor: "quay driver <([a-z|]+)>", policy: "exact" },
  { id: "cli-driver-usage-verbs", authority: "driver-verb", file: "packages/quay/src/cli/driver.ts", extract: "text", anchor: "quay driver <([a-z|]+)>", policy: "exact" },
  // ── goal status ────────────────────────────────────────────────────────────────────────────────
  { id: "goal-store-valid-statuses", authority: "goal-status", file: "packages/quay/src/goal-store.ts", extract: "ts-array", symbol: "VALID_GOAL_STATUSES", policy: "exact" },
  { id: "native-goal-write-desc", authority: "goal-status", file: "packages/quay-native/src/mcp-server.ts", extract: "text", anchor: "one goal record[^\\n]*?status ∈ ([a-z|-]+)", policy: "exact" },
  { id: "serve-goal-status-order", authority: "goal-status", file: "packages/quay/src/serve-goal.ts", extract: "ts-array", symbol: "GOAL_STATUS_ORDER", policy: "exact" },
  { id: "serve-goal-status-tabs", authority: "goal-status", file: "packages/quay/src/serve-goal.ts", extract: "ts-array", anchor: "\\[\"draft\",\\s*\"active\"", policy: "exact" },
  // ── meta status ────────────────────────────────────────────────────────────────────────────────
  { id: "meta-store-valid-statuses", authority: "meta-status", file: "packages/quay/src/meta-store.ts", extract: "ts-array", symbol: "VALID_META_STATUSES", policy: "exact" },
  { id: "core-meta-write-desc", authority: "meta-status", file: "packages/quay/src/mcp-handlers.ts", extract: "text", anchor: "META record[^\\n]*?status ∈ ([a-z|-]+)", policy: "exact" },
  { id: "native-meta-write-desc", authority: "meta-status", file: "packages/quay-native/src/mcp-server.ts", extract: "text", anchor: "META record[^\\n]*?status ∈ ([a-z|-]+)", policy: "exact" },
  // ── adr status ─────────────────────────────────────────────────────────────────────────────────
  { id: "core-adr-write-desc", authority: "adr-status", file: "packages/quay/src/mcp-handlers.ts", extract: "text", anchor: "one ADR[^\\n]*?status ∈ ([a-z|-]+)", policy: "exact" },
  { id: "native-adr-write-desc", authority: "adr-status", file: "packages/quay-native/src/mcp-server.ts", extract: "text", anchor: "one ADR[^\\n]*?status ∈ ([a-z|-]+)", policy: "exact" },
  // ── task status ────────────────────────────────────────────────────────────────────────────────
  { id: "plugin-task-statuses", authority: "task-status", file: "plugin/scripts/task-status.ts", extract: "ts-array", symbol: "TASK_STATUSES", policy: "exact" },
  { id: "cli-help-task-status-filter", authority: "task-status", file: "packages/quay/src/cli/help.ts", extract: "text", anchor: "--status <status>[^\\n]*\\(([^)]*)\\)", policy: "exact" },
  { id: "core-task-list-desc", authority: "task-status", file: "packages/quay/src/mcp-handlers.ts", extract: "text", anchor: "Filter by task status[^\\n]*?\\(([^)]*)\\)", policy: "exact" },
  { id: "core-task-write-desc", authority: "task-status", file: "packages/quay/src/mcp-handlers.ts", extract: "text", anchor: "New status \\(([^)]*)\\)", policy: "exact" },
  // ── doc status：**已枚举、未发现任何表层的副本**（下文 --discover 段同样为空）⇒ 无面登记。 ──
];

// 已知漂移台账 —— 每一条都带「为什么不在本任务里修」。⛔ 只有【增长】会红（shrink-only）。
const KNOWN_DRIFT: KnownDriftEntry[] = [
  {
    surface: "start-drivers-kinds",
    extra: [],
    missing: ["quality", "meta"],
    reason: "plugin/scripts/start-drivers.ts 只拉起 4 个 kind；归位（是否补齐 6 个）待另行立案——本任务的范围是机制，不是该脚本的语义决策。",
  },
  {
    surface: "cli-driver-help-kind",
    index: 0,
    extra: [],
    missing: ["outer", "quality", "meta", "goal"],
    reason: "cli/driver.ts 头注释里的 `--kind <…>` 只列 2 个 kind；同文件的用法行（#1/#2）见下一条。归位由 gap-driver-cli-help-hides-four-of-six-kinds 承接。",
  },
  {
    surface: "cli-driver-help-kind",
    extra: [],
    missing: ["meta", "goal"],
    reason: "cli/driver.ts 的用法行 + `--kind` 旗标说明只列 4 个 kind（缺 meta/goal）；归位由 gap-driver-cli-help-hides-four-of-six-kinds 承接。",
  },
  {
    surface: "cli-help-kind",
    extra: [],
    missing: ["outer", "quality", "meta", "goal"],
    reason: "归位由 gap-driver-cli-help-hides-four-of-six-kinds 承接。",
  },
  {
    surface: "claude-md-driver-kind",
    extra: [],
    missing: ["outer", "quality", "meta", "goal"],
    reason: "文档面（CLAUDE.md）存量归位不在本任务内（task body 范围边界）；本任务只负责报出。",
  },
  {
    surface: "drivers-skill-kind",
    extra: [],
    missing: ["outer", "quality", "meta", "goal"],
    reason: "文档面（plugin/skills/drivers/SKILL.md）存量归位不在本任务内；本任务只负责报出。",
  },
  {
    surface: "cli-help-driver-usage-verbs",
    index: 0,
    extra: [],
    missing: ["resume"],
    reason: "顶层 `quay --help` 的 driver 用法行漏列 resume（同一行的 kind 也漏列，见 cli-help-kind）；归位由 gap-driver-cli-help-hides-four-of-six-kinds 承接。",
  },
  {
    surface: "cli-driver-usage-verbs",
    index: 0,
    extra: [],
    missing: ["resume"],
    reason: "cli/driver.ts 头注释里的用法行漏列 resume；归位由 gap-driver-cli-help-hides-four-of-six-kinds 承接。",
  },
  {
    surface: "native-goal-write-desc",
    extra: [],
    missing: ["needs-human"],
    reason: "quay-native 的 goal_write 描述未同步 ABI 修正后的取值；属同一类漂移的另一实例，归位待另行立案（本任务只负责报出）。",
  },
  {
    surface: "serve-goal-status-order",
    extra: [],
    missing: ["needs-human"],
    reason: "serve-goal.ts 的显示排序表没有 needs-human（排序表是有意排序的子集，但缺一个态会让该态沉底）；归位待另行立案。",
  },
  {
    surface: "serve-goal-status-tabs",
    extra: [],
    missing: ["needs-human"],
    reason: "goals tab 的状态筛选项没有 needs-human（缺入口）；归位待另行立案。",
  },
];

export const DEFAULT_REGISTRY: Registry = {
  authorities: AUTHORITIES,
  surfaces: SURFACES,
  knownDrift: KNOWN_DRIFT,
};

// ── extraction ────────────────────────────────────────────────────────────────────────────────────
// ⛔ 非判别式联合：本仓库的 tsconfig 是 strict:false（strictNullChecks 关），字面量判别式在该设置下
// 不参与收窄 —— 用 {ok, groups, reason} 的平坦形状，两种结果都带全部字段（调用方无需收窄即可读）。
export interface ExtractResult {
  ok: boolean;
  /** One entry per occurrence/symbol — a symbol-kind surface has exactly one; text surfaces one per match. */
  groups: { index: number; values: string[] }[];
  /** Set when ok is false — why the surface could not be read. */
  reason: string | null;
}

/** Token normalisation: strip surrounding quotes/brackets/commas, keep lowercase lifecycle words. */
export function tokenize(raw: string): string[] {
  return raw
    .split(/[|,/\s]+/)
    .map((t) => t.trim().replace(/^[`'"<([{]+/, "").replace(/[`'">)\]},.;]+$/, ""))
    .filter((t) => /^[a-z][a-z0-9-]*$/.test(t));
}

/** Extract every quoted string literal within [start,end) of `src`. */
function stringLiteralsIn(src: string, start: number, end: number): string[] {
  const out: string[] = [];
  const re = /"([^"\\]*)"|'([^'\\]*)'/g;
  re.lastIndex = start;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m.index >= end) break;
    out.push((m[1] ?? m[2] ?? "").trim());
  }
  return out.filter((s) => s !== "");
}

/** Locate the `[`/`{` that opens the initialiser of `symbol`, then balance to its closer. */
function initialiserSpan(src: string, openIdx: number, open: string, close: string): number {
  const mask = buildNonCodeMask(src);
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (mask[i] === 1) continue; // string / comment / regex literal — never structural
    if (src[i] === open) depth++;
    else if (src[i] === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** First CODE-position index of `ch` at or after `from`. */
function firstCodeChar(src: string, from: number, ch: string): number {
  const mask = buildNonCodeMask(src);
  for (let i = from; i < src.length; i++) {
    if (mask[i] === 1) continue;
    if (src[i] === ch) return i;
  }
  return -1;
}

function extractTsArray(src: string, spec: { symbol?: string; anchor?: string }): ExtractResult {
  let openIdx = -1;
  if (spec.symbol) {
    const decl = new RegExp(`(?:export\\s+)?const\\s+${spec.symbol}\\b`);
    const m = decl.exec(src);
    if (!m) return { ok: false, groups: [], reason: `declaration of \`${spec.symbol}\` not found` };
    const eq = firstCodeChar(src, m.index + m[0].length, "=");
    if (eq < 0) return { ok: false, groups: [], reason: `\`${spec.symbol}\` has no initialiser` };
    openIdx = firstCodeChar(src, eq, "[");
    if (openIdx < 0) return { ok: false, groups: [], reason: `\`${spec.symbol}\` initialiser is not an array literal` };
  } else if (spec.anchor) {
    const m = new RegExp(spec.anchor).exec(src);
    if (!m) return { ok: false, groups: [], reason: `anchor /${spec.anchor}/ matched 0 times` };
    openIdx = m.index + m[0].indexOf("[");
    if (openIdx < 0 || src[openIdx] !== "[") return { ok: false, groups: [], reason: `anchor /${spec.anchor}/ did not land on a [ literal` };
  } else {
    return { ok: false, groups: [], reason: "ts-array needs a symbol or an anchor" };
  }
  const end = initialiserSpan(src, openIdx, "[", "]");
  if (end < 0) return { ok: false, groups: [], reason: "unbalanced array literal" };
  return { ok: true, groups: [{ index: 0, values: stringLiteralsIn(src, openIdx, end) }], reason: null };
}

function extractTsObjectKeys(src: string, symbol: string): ExtractResult {
  const decl = new RegExp(`(?:export\\s+)?const\\s+${symbol}\\b`);
  const m = decl.exec(src);
  if (!m) return { ok: false, groups: [], reason: `declaration of \`${symbol}\` not found` };
  const eq = firstCodeChar(src, m.index + m[0].length, "=");
  if (eq < 0) return { ok: false, groups: [], reason: `\`${symbol}\` has no initialiser` };
  const openIdx = firstCodeChar(src, eq, "{");
  if (openIdx < 0) return { ok: false, groups: [], reason: `\`${symbol}\` initialiser is not an object literal` };
  const end = initialiserSpan(src, openIdx, "{", "}");
  if (end < 0) return { ok: false, groups: [], reason: "unbalanced object literal" };
  const mask = buildNonCodeMask(src);
  const body = src.slice(openIdx + 1, end);
  const bodyMask = mask.slice(openIdx + 1, end);
  const keys: string[] = [];
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    if (bodyMask[i] === 1) continue;
    const c = body[i];
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") depth--;
    else if (depth === 0) {
      const km = /^([A-Za-z_$][\w$]*)\s*:/.exec(body.slice(i));
      if (km) {
        keys.push(km[1]);
        i += km[0].length - 1;
      }
    }
  }
  return { ok: true, groups: [{ index: 0, values: keys }], reason: null };
}

function extractTsStringUnion(src: string, anchor: string): ExtractResult {
  const m = new RegExp(anchor).exec(src);
  if (!m) return { ok: false, groups: [], reason: `anchor /${anchor}/ matched 0 times` };
  const from = m.index + m[0].length;
  // The union expression runs until a delimiter that cannot belong to it.
  let to = from;
  while (to < src.length && !/[;)\n]/.test(src[to])) to++;
  const values = stringLiteralsIn(src, from, to);
  if (values.length === 0) return { ok: false, groups: [], reason: `anchor /${anchor}/ matched but no string literals followed` };
  return { ok: true, groups: [{ index: 0, values }], reason: null };
}

function extractText(src: string, spec: { anchor: string; indices?: number[] }): ExtractResult {
  const re = new RegExp(spec.anchor, "g");
  const groups: { index: number; values: string[] }[] = [];
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(src)) !== null) {
    if (spec.indices === undefined || spec.indices.includes(i)) {
      groups.push({ index: i, values: [...new Set(tokenize(m[1] ?? ""))] });
    }
    i++;
    if (m.index === re.lastIndex) re.lastIndex++; // zero-width guard
  }
  if (groups.length === 0) {
    return { ok: false, groups: [], reason: `anchor /${spec.anchor}/ matched 0 times` };
  }
  return { ok: true, groups, reason: null };
}

export function extract(src: string, kind: ExtractKind, spec: { symbol?: string; anchor?: string; indices?: number[] }): ExtractResult {
  switch (kind) {
    case "ts-array":
      return extractTsArray(src, spec);
    case "ts-object-keys":
      return spec.symbol ? extractTsObjectKeys(src, spec.symbol) : { ok: false, groups: [], reason: "ts-object-keys needs a symbol" };
    case "ts-string-union":
      return spec.anchor ? extractTsStringUnion(src, spec.anchor) : { ok: false, groups: [], reason: "ts-string-union needs an anchor" };
    case "text":
      return spec.anchor ? extractText(src, { anchor: spec.anchor, indices: spec.indices }) : { ok: false, groups: [], reason: "text needs an anchor" };
    default:
      return { ok: false, groups: [], reason: `unknown extract kind ${String(kind)}` };
  }
}

// ── exemption markers (规范 5, position-independent — AC4) ─────────────────────────────────────────
export interface ExemptionMarker {
  surface: string;
  reason: string;
  /** 1-based line number, for the report only — ⛔ never used for matching. */
  line: number;
}

/**
 * Scan the WHOLE file text for exemption markers. ⛔ Deliberately NOT "the comment directly above the
 * construct": a marker moved INSIDE the flagged construct must still be found (archguard TASK-88's
 * trap was an exemption comment whose position broke the extraction regex, making the entry
 * disappear from the checked set entirely). Matching is by explicit surface id, so position is
 * irrelevant by construction.
 */
export function scanExemptions(src: string): ExemptionMarker[] {
  const out: ExemptionMarker[] = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /enum-surface-exempt:\s*([A-Za-z0-9._:-]+)\s*[—:-]?\s*(.*)$/.exec(lines[i]);
    if (m) out.push({ surface: m[1].trim(), reason: m[2].trim(), line: i + 1 });
  }
  return out;
}

/** A marker counts only when it names the surface AND carries a real reason (规范 5: 带理由). */
export const MIN_EXEMPT_REASON_CHARS = 12;
export function findExemption(markers: ExemptionMarker[], surfaceId: string): ExemptionMarker | null {
  return markers.find((m) => m.surface === surfaceId && m.reason.length >= MIN_EXEMPT_REASON_CHARS) ?? null;
}

// ── the judgment ──────────────────────────────────────────────────────────────────────────────────
export interface Diff {
  extra: string[];
  missing: string[];
}

export interface SurfaceReport {
  surface: string;
  authority: string;
  file: string;
  /** One row per judged occurrence. */
  occurrences: {
    index: number;
    /** "in-sync" | "violation" | "known-drift" | "not-evaluated" | "exempt" */
    state: string;
    values: string[];
    extra: string[];
    missing: string[];
    note?: string;
  }[];
  /** "in-sync" | "violation" | "known-drift" | "not-evaluated" | "exempt" */
  state: string;
}

export interface CheckResult {
  ok: boolean;
  status: "pass" | "fail" | "not-evaluated";
  authorities: { id: string; file: string; values: string[] | null; error: string | null }[];
  surfaces: SurfaceReport[];
  violations: { surface: string; index: number; kind: string; detail: string }[];
  notEvaluated: { surface: string; reason: string }[];
  knownDrift: { surface: string; index: number; extra: string[]; missing: string[]; note: string }[];
  discovered: { file: string; line: number; values: string[]; authority: string }[];
}

export function diff(values: string[], authority: string[]): Diff {
  const v = new Set(values);
  const a = new Set(authority);
  return {
    extra: [...v].filter((x) => !a.has(x)).sort(),
    missing: [...a].filter((x) => !v.has(x)).sort(),
  };
}

/** Flat (non-discriminated) read result — see the ExtractResult note on strict:false narrowing. */
export interface ReadResult {
  ok: boolean;
  text: string;
  reason: string | null;
}
function readText(root: string, rel: string): ReadResult {
  try {
    return { ok: true, text: fs.readFileSync(path.join(root, rel), "utf8"), reason: null };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return { ok: false, text: "", reason: code === "ENOENT" ? `${rel}: file not found` : `${rel}: ${code ?? "unreadable"}` };
  }
}

/**
 * ADR-036 规范 2 的判定：一个面若**派生**自权威（`import` 那个符号，且该符号出现在代码位置），
 * 它就是「按构造一致」—— 比逐一相等的字面量副本更强（新增一个值只要改权威一处）。
 * Returns the `<file>:<symbol>` it derives from, or null when it does not derive.
 * ⛔ 只在提取不到字面量时才走这条路：字面量副本按两向差集判，派生按构造判。
 */
export function authorityDerivation(
  read: ReadResult,
  authorityFile: string,
  authoritySymbol: string | undefined,
): string | null {
  if (!read.ok || !authoritySymbol) return null;
  const base = path.basename(authorityFile).replace(/\.(ts|js)$/, "");
  const importRe = new RegExp(`^\\s*import[^;\\n]*\\b${authoritySymbol}\\b[^;\\n]*from\\s*["'][^"']*\\b${base}(?:\\.(?:ts|js|mjs))?["']`, "m");
  if (!importRe.test(read.text)) return null;
  // The symbol must also be referenced at a CODE position (a mere comment mention does not derive).
  const mask = buildNonCodeMask(read.text);
  const symRe = new RegExp(`\\b${authoritySymbol}\\b`, "g");
  let m: RegExpExecArray | null;
  while ((m = symRe.exec(read.text)) !== null) {
    if (mask[m.index] === 0) return `${authorityFile}:${authoritySymbol}`;
  }
  return null;
}

export function runCheck(opts: { root: string; registry: Registry }): CheckResult {
  const { root, registry } = opts;
  const authorities: CheckResult["authorities"] = [];
  const authorityValues = new Map<string, string[] | null>();

  for (const a of registry.authorities) {
    const read = readText(root, a.file);
    if (!read.ok) {
      authorities.push({ id: a.id, file: a.file, values: null, error: read.reason });
      authorityValues.set(a.id, null);
      continue;
    }
    const ex = extract(read.text, a.extract, { symbol: a.symbol, anchor: a.anchor });
    if (!ex.ok) {
      authorities.push({ id: a.id, file: a.file, values: null, error: ex.reason });
      authorityValues.set(a.id, null);
      continue;
    }
    const values = ex.groups[0]?.values ?? [];
    if (values.length === 0) {
      authorities.push({ id: a.id, file: a.file, values: null, error: "extracted 0 values" });
      authorityValues.set(a.id, null);
      continue;
    }
    authorities.push({ id: a.id, file: a.file, values, error: null });
    authorityValues.set(a.id, values);
  }

  const surfaces: SurfaceReport[] = [];
  const violations: CheckResult["violations"] = [];
  const notEvaluated: CheckResult["notEvaluated"] = [];
  const knownDrift: CheckResult["knownDrift"] = [];

  for (const s of registry.surfaces) {
    const authority = authorityValues.get(s.authority) ?? null;
    if (authority === null) {
      notEvaluated.push({ surface: s.id, reason: `authority '${s.authority}' could not be evaluated` });
      surfaces.push({ surface: s.id, authority: s.authority, file: s.file, state: "not-evaluated", occurrences: [] });
      continue;
    }
    const read = readText(root, s.file);
    if (!read.ok) {
      notEvaluated.push({ surface: s.id, reason: read.reason });
      surfaces.push({ surface: s.id, authority: s.authority, file: s.file, state: "not-evaluated", occurrences: [] });
      continue;
    }
    const ex = extract(read.text, s.extract, { symbol: s.symbol, anchor: s.anchor, indices: s.indices });
    if (!ex.ok) {
      notEvaluated.push({ surface: s.id, reason: ex.reason });
      surfaces.push({ surface: s.id, authority: s.authority, file: s.file, state: "not-evaluated", occurrences: [] });
      continue;
    }
    // 规范 2：no literal to diff ⇒ the surface may DERIVE from the authority instead (the stronger form).
    const literalsFound = ex.groups.some((g) => g.values.length > 0);
    if (!literalsFound) {
      const spec = registry.authorities.find((a) => a.id === s.authority);
      const derived = spec ? authorityDerivation(read, spec.file, spec.symbol) : null;
      if (derived) {
        surfaces.push({
          surface: s.id,
          authority: s.authority,
          file: s.file,
          state: "derived",
          occurrences: [{ index: 0, state: "derived", values: [], extra: [], missing: [], note: `派生自 ${derived}（规范 2：不手抄）` }],
        });
        continue;
      }
      notEvaluated.push({ surface: s.id, reason: `no literals and no import-derivation from authority '${s.authority}'` });
      surfaces.push({ surface: s.id, authority: s.authority, file: s.file, state: "not-evaluated", occurrences: [] });
      continue;
    }
    // Occurrence-set change is itself a finding: a new/removed copy must not be silent.
    const declared = new Set(ex.groups.map((g) => g.index));
    if (s.indices !== undefined) {
      const missingIdx = s.indices.filter((i) => !declared.has(i));
      if (missingIdx.length > 0) {
        notEvaluated.push({ surface: s.id, reason: `declared occurrence(s) ${missingIdx.join(",")} no longer matched` });
      }
    }

    const exemptions = s.policy === "subset" ? scanExemptions(read.text) : [];
    const marker = findExemption(exemptions, s.id);

    const rows: SurfaceReport["occurrences"] = [];
    for (const g of ex.groups) {
      const d = diff(g.values, authority);
      // Occurrence-specific entry wins; an index-less entry is the fallback for a surface whose
      // occurrences all carry the same drift (help.ts / CLAUDE.md / SKILL.md).
      const entry =
        registry.knownDrift.find((k) => k.surface === s.id && k.index === g.index) ??
        registry.knownDrift.find((k) => k.surface === s.id && k.index === undefined);
      let state: string;
      let note: string | undefined;
      if (d.extra.length === 0 && d.missing.length === 0) {
        state = "in-sync";
      } else if (entry) {
        const grewExtra = d.extra.some((x) => !entry.extra.includes(x));
        const grewMissing = d.missing.some((x) => !entry.missing.includes(x));
        if (grewExtra || grewMissing) {
          state = "violation";
          note = `KNOWN_DRIFT 台账登记为 extra=[${entry.extra.join(",")}] missing=[${entry.missing.join(",")}]；实测差集【增长】`;
          violations.push({
            surface: s.id,
            index: g.index,
            kind: grewExtra ? "known-drift-extra-grown" : "known-drift-missing-grown",
            detail: `extra=[${d.extra.join(",")}] missing=[${d.missing.join(",")}] vs recorded extra=[${entry.extra.join(",")}] missing=[${entry.missing.join(",")}]`,
          });
        } else {
          state = "known-drift";
          const shrank = d.extra.length < entry.extra.length || d.missing.length < entry.missing.length;
          if (shrank) note = "差集已【收窄】（别的任务修好了一部分）⇒ 台账条目可清理";
          knownDrift.push({ surface: s.id, index: g.index, extra: d.extra, missing: d.missing, note: note ?? entry.reason });
        }
      } else if (s.policy === "subset" && d.extra.length === 0) {
        if (marker) {
          state = "exempt";
          note = `豁免（第 ${marker.line} 行）：${marker.reason}`;
        } else {
          state = "violation";
          note = "收窄但无豁免注释（规范 5：不接受沉默地少列几个）";
          violations.push({ surface: s.id, index: g.index, kind: "silent-narrowing", detail: `missing=[${d.missing.join(",")}] without an enum-surface-exempt marker` });
        }
      } else {
        state = "violation";
        violations.push({
          surface: s.id,
          index: g.index,
          kind: d.extra.length > 0 ? "extra" : "missing",
          detail: `extra=[${d.extra.join(",")}] missing=[${d.missing.join(",")}]`,
        });
      }
      rows.push({ index: g.index, state, values: g.values, extra: d.extra, missing: d.missing, note });
    }

    // A subset surface whose marker exists but was never needed is NOT a violation (harmless), and a
    // subset surface that is now exactly equal needs no marker either.
    const state = rows.some((r) => r.state === "violation")
      ? "violation"
      : rows.length === 0
        ? "not-evaluated"
        : rows.some((r) => r.state === "exempt")
          ? "exempt"
          : rows.some((r) => r.state === "known-drift")
            ? "known-drift"
            : rows.some((r) => r.state === "derived")
              ? "derived"
              : "in-sync";
    surfaces.push({ surface: s.id, authority: s.authority, file: s.file, state, occurrences: rows });
  }

  const discovered = discoverUnregistered({ root, registry });

  const status: CheckResult["status"] =
    violations.length > 0 ? "fail" : notEvaluated.length > 0 ? "not-evaluated" : "pass";
  return {
    ok: status === "pass",
    status,
    authorities,
    surfaces,
    violations,
    notEvaluated,
    knownDrift,
    discovered,
  };
}

// ── discovery: unregistered subset literals (informational, ⛔ never part of pass/fail) ────────────
const DISCOVERY_ROOTS = ["packages/quay/src", "packages/quay-native/src", "plugin/scripts"];
const DISCOVERY_SKIP = /(^|\/)(test|tests|dist|vendor|node_modules|archive|checker-mutation-cases)(\/|$)|\.test\./;

/** Collect `["a", "b", ...]` literals whose token set is a non-empty subset of some authority's set. */
export function discoverUnregistered(opts: { root: string; registry: Registry }): CheckResult["discovered"] {
  const { root, registry } = opts;
  const authoritySets = new Map<string, Set<string>>();
  for (const a of registry.authorities) {
    const read = readText(root, a.file);
    if (!read.ok) continue;
    const ex = extract(read.text, a.extract, { symbol: a.symbol, anchor: a.anchor });
    if (ex.ok && ex.groups[0] && ex.groups[0].values.length > 0) authoritySets.set(a.id, new Set(ex.groups[0].values));
  }
  // (file → already-registered value sets) so a registered surface's own literal is not re-reported.
  const registeredValues = new Map<string, string[][]>();
  for (const s of registry.surfaces) {
    const read = readText(root, s.file);
    if (!read.ok) continue;
    const ex = extract(read.text, s.extract, { symbol: s.symbol, anchor: s.anchor, indices: s.indices });
    if (!ex.ok) continue;
    const list = registeredValues.get(s.file) ?? [];
    for (const g of ex.groups) list.push(g.values);
    registeredValues.set(s.file, list);
  }
  const authorityFiles = new Set(registry.authorities.map((a) => a.file));
  const out: CheckResult["discovered"] = [];
  const seen = new Set<string>();
  for (const rel of DISCOVERY_ROOTS) {
    const abs = path.join(root, rel);
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(abs, { recursive: true, encoding: "utf8" }) as string[];
    } catch {
      continue;
    }
    for (const sub of entries) {
      const relPath = path.posix.join(rel, String(sub));
      if (!relPath.endsWith(".ts") || DISCOVERY_SKIP.test(relPath)) continue;
      if (authorityFiles.has(relPath)) continue;
      if (path.basename(relPath) === "enum-surface-parity-check.ts") continue; // its own knobs are not copies
      const read = readText(root, relPath);
      if (!read.ok) continue;
      const re = /\[([^\]\n]*"[^\]\n]*)\]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(read.text)) !== null) {
        const values = stringLiteralsIn(m[0], 0, m[0].length).filter((v) => /^[a-z][a-z0-9-]*$/.test(v));
        if (values.length < 2) continue;
        const set = new Set(values);
        const already = (registeredValues.get(relPath) ?? []).some(
          (vals) => vals.length === values.length && vals.every((v) => set.has(v)),
        );
        if (already) continue;
        for (const [aid, aset] of authoritySets) {
          if (![...set].every((v) => aset.has(v))) continue;
          const sorted = [...set].sort();
          const key = `${relPath}::${sorted.join(",")}`;
          if (seen.has(key)) break;
          seen.add(key);
          out.push({ file: relPath, line: read.text.slice(0, m.index).split("\n").length, values: sorted, authority: aid });
          break;
        }
      }
    }
  }
  return out;
}

// ── rendering ─────────────────────────────────────────────────────────────────────────────────────
function renderHuman(res: CheckResult, authorityIds: Map<string, string>): string {
  const out: string[] = [];
  out.push("== enum surface parity (ADR-036) — 权威枚举 ↔ 表层副本，两向差集 ==");
  for (const a of res.authorities) {
    if (a.values === null) {
      out.push(`  [${a.id}] ${a.file} — NOT-EVALUATED (${a.error})`);
    } else {
      out.push(`  [${a.id}] ${a.file} — ${a.values.length} 值: ${a.values.join(", ")}`);
    }
  }
  out.push("");
  out.push("-- 表层（sub = 权威 id）--");
  for (const s of res.surfaces) {
    const sub = authorityIds.get(s.authority) ?? s.authority;
    if (s.occurrences.length === 0) {
      out.push(`  [${s.state}] ${s.surface} (${sub}) ${s.file}`);
      continue;
    }
    for (const o of s.occurrences) {
      const idx = s.occurrences.length > 1 ? `#${o.index} ` : "";
      const d =
        o.extra.length === 0 && o.missing.length === 0
          ? "差集为空"
          : `extra=[${o.extra.join(",")}] missing=[${o.missing.join(",")}]`;
      out.push(`  [${o.state}] ${s.surface} ${idx}(${sub}) ${s.file} — ${o.values.length} 值 {${o.values.join(", ")}} · ${d}${o.note ? ` · ${o.note}` : ""}`);
    }
  }
  if (res.notEvaluated.length > 0) {
    out.push("");
    out.push(`-- NOT-EVALUATED（读不出，⛔ 既非「一致」也非「不一致」）${res.notEvaluated.length} 条 --`);
    for (const n of res.notEvaluated) out.push(`  ${n.surface}: ${n.reason}`);
  }
  if (res.knownDrift.length > 0) {
    out.push("");
    out.push(`-- 已知漂移（台账登记；报出而不阻断，只有【增长】才红）${res.knownDrift.length} 条 --`);
    for (const k of res.knownDrift) out.push(`  ${k.surface}${k.index !== undefined ? `#${k.index}` : ""}: extra=[${k.extra.join(",")}] missing=[${k.missing.join(",")}] — ${k.note}`);
  }
  if (res.discovered.length > 0) {
    out.push("");
    out.push(`-- 未登记的候选子集字面量（仅供参考，⛔ 不参与退出码）${res.discovered.length} 条 --`);
    for (const d of res.discovered) out.push(`  ${d.file}:${d.line} ⊂ ${d.authority} — {${d.values.join(", ")}}`);
  }
  return out.join("\n");
}

// ── entry ─────────────────────────────────────────────────────────────────────────────────────────
export function checkAndEmit(argv: string[], registryOverride?: Registry): number {
  const parsed = parseArgs(argv, {
    minArgs: 0,
    usage: "enum-surface-parity-check.ts [--root <dir>] [--json] [--registry <path.json>]",
    flags: { root: { type: "string" }, json: { type: "boolean" }, registry: { type: "string" } },
  });
  const root = typeof parsed.flags.root === "string" && parsed.flags.root !== "" ? path.resolve(parsed.flags.root) : process.cwd();
  const json = parsed.flags.json === true;

  let registry = registryOverride ?? DEFAULT_REGISTRY;
  if (typeof parsed.flags.registry === "string" && parsed.flags.registry !== "") {
    const registryPath = path.resolve(parsed.flags.registry);
    try {
      registry = JSON.parse(fs.readFileSync(registryPath, "utf8")) as Registry;
    } catch (e) {
      process.stderr.write(`enum-surface-parity-check: cannot read --registry ${registryPath}: ${(e as Error).message}\n`);
      return 2;
    }
  }
  if (!Array.isArray(registry.authorities) || registry.authorities.length === 0) {
    // ⛔ An empty registry is NOT a pass — it means nothing was evaluated (硬规则 3b).
    if (json) return emitVerdict({ status: "not-evaluated", message: "registry is empty — nothing evaluated", detail: { status: "not-evaluated" } }, { json: true });
    process.stdout.write("NOT-EVALUATED: registry is empty — nothing evaluated (⛔ 不得读作 PASS)\n");
    return 3;
  }

  const res = runCheck({ root, registry });
  const authorityIds = new Map(registry.authorities.map((a) => [a.id, a.id]));

  if (json) {
    const verdict: Verdict = {
      status: res.status,
      message:
        res.status === "pass"
          ? `all ${res.surfaces.length} registered surfaces consistent (${res.knownDrift.length} known drift, ${res.notEvaluated.length} not evaluated)`
          : res.status === "fail"
            ? `${res.violations.length} violation(s) across ${res.surfaces.length} registered surfaces`
            : `no violations, but ${res.notEvaluated.length} surface(s) could not be evaluated`,
      detail: res as unknown as Record<string, unknown>,
    };
    return emitVerdict(verdict, { json: true });
  }

  process.stdout.write(renderHuman(res, authorityIds) + "\n");
  const message =
    res.status === "pass"
      ? `all ${res.surfaces.length} registered surfaces consistent (${res.knownDrift.length} known drift, ${res.notEvaluated.length} not evaluated)`
      : res.status === "fail"
        ? `${res.violations.length} violation(s): ${[...new Set(res.violations.map((v) => v.surface))].join(", ")}`
        : `no violations, but ${res.notEvaluated.length} surface(s) could not be evaluated`;
  return emitVerdict({ status: res.status, message }, {});
}

if (isDirectEntry(import.meta)) {
  const code = checkAndEmit(process.argv);
  process.exit(code);
}
