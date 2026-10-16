// touches-relax-config.ts — the CONFIG FACE of GOAL-037's adaptive dispatch relaxation: read and
// validate `loop.touches_relax:` out of a workspace's `.quay/config.yml`.
//
// WHY THIS EXISTS (task gap-touches-relax-config-block-unread-unvalidated, GOAL-037 AC-364): the
// relaxation predicate (AC-365), its worker-driver wiring (AC-366) and the automatic re-tightening
// (AC-367) all have to READ this block first. Without a reader/validator the only way to carry the
// thresholds would be literals in code — which GOAL-037 forbids outright ("阈值全部来自配置，代码里
// 不写字面量，默认关闭"). This module is that layer and NOTHING else: it does not relax anything, it
// does not touch `driver-filters.ts` / `worker-driver.ts`, and it is not wired into any driver.
//
// THREE STATES, NOT TWO (硬规则 3b — "读不懂输入" must never wear the same face as "合格"):
//   state "absent"  — the workspace declared no `loop.touches_relax:` at all. DEFAULT OFF.
//   state "off"     — the section IS declared and resolves to mode `off` (explicitly, or via a
//                     declared section with no `mode` key). Also off — but a DIFFERENT state, so a
//                     reader can tell "nobody asked for this" from "somebody turned it off".
//   state "shadow" / "live" — the section is declared AND enabled (in the two non-off modes).
//   state "invalid" — the config could not be read (malformed YAML, `loop:` not a mapping) or the
//                     section is present but fails validation. ⛔ This state exists SPECIFICALLY so
//                     a bad declaration cannot be read as "off by default"; it carries `error`
//                     (unreadable input) and/or `issues` (named per-field refusals).
//
// NO BUILT-IN THRESHOLDS (硬规则 4 推论二 / 硬规则 12): when `mode` is `shadow` or `live`, BOTH
// `after_minutes` and `max_relaxed_inflight` must be given EXPLICITLY. There is no default for
// either — a literal that happens to be safe on this host is not "unlimited", it is a host-dependent
// constant that silently becomes a real limit elsewhere. The right values are supposed to come from
// AC-362's filter_trace data, not from this file. A missing one is a NAMED refusal, never a backfill.
//
// ORDER OF SECTIONS IS THE ORDER OF THE PAPERS, NOTHING ELSE: `readTouchesRelaxConfig` (I/O) →
// `parseTouchesRelaxSection` (pure) → `loadTouchesRelaxConfig` (the three-state join) → CLI.
//
// THE SHAPE IS NOT NEW: this mirrors the existing `loop.<section>` convention — the reader/parser
// pair of `arch-discovery-routine.ts` (`readArchDiscoveryConfig` / `parseArchDiscoverySection`) and
// the default-DISABLED posture of `carrier-retention.ts`'s `readRetentionConfig`. Core's
// `packages/quay/src/config-validate.ts` deliberately does NOT cover `loop.<plugin-section>` blocks,
// so the plugin layer owns them; ⛔ this file therefore does NOT touch config-validate.ts.
//
// CLI (READ-ONLY — no path below writes `.quay/config.yml`, or anything else):
//   node --experimental-strip-types touches-relax-config.ts --validate [--root <dir>] [--json]
//   exit 0 = the block is qualified (absent, or declared-and-valid)
//   exit 1 = not qualified (named issues and/or a fail-closed read error)
//   exit 2 = usage error

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
// 入口判定用 gate-script-base 的【bundler-safe】isDirectEntry（名字形，⛔ 非 URL 形）——理由见文件尾。
import { isDirectEntry } from "./gate-script-base.ts";

/** The `loop:` key this module reads. Spelled ONCE — nothing else in the tree hardcodes the section. */
export const TOUCHES_RELAX_SECTION = "touches_relax";

/** The mode vocabulary — THE single source. ⛔ Do not re-spell this array at a call site. */
export const TOUCHES_RELAX_MODES = ["off", "shadow", "live"] as const;

export type TouchesRelaxMode = (typeof TOUCHES_RELAX_MODES)[number];

/** The default when `mode` is not declared: the feature is OFF. This is a MODE default, not a
 *  threshold default — the two required numbers below have none (see the header). */
export const DEFAULT_TOUCHES_RELAX_MODE: TouchesRelaxMode = "off";

/** The `loop.<section>` path prefix every issue/refusal names, so a message is locatable in the file. */
const SECTION_FIELD = `loop.${TOUCHES_RELAX_SECTION}`;

/** One named refusal: WHERE (a dotted path into `config.yml`) and WHAT was wrong. */
export interface TouchesRelaxIssue {
  field: string;
  message: string;
}

/** The parsed, validated section. `after_minutes` / `max_relaxed_inflight` are OPTIONAL PROPERTIES:
 *  they are PRESENT only when the file actually spelled them (⛔ never back-filled with a literal),
 *  and they are absent for `mode: off` where they are not required. */
export interface TouchesRelaxConfig {
  mode: TouchesRelaxMode;
  after_minutes?: number;
  max_relaxed_inflight?: number;
  shared_files: string[];
  never_relax: string[];
  /** GOAL-037（AC-367）：自动收紧子块。**PRESENT only when the file spelled `auto_tighten:`** ——
   *  与 `after_minutes` 同一条纪律：⛔ 不回填任何内置阈值。 */
  auto_tighten?: TouchesRelaxAutoTighten;
}

// ── GOAL-037（AC-367）：自动收紧子块（`loop.touches_relax.auto_tighten`）────────────────────────────
//
// 为什么扩在【本模块】而不是另写一个读取器（硬规则 1/5b）：AC-364 已经把 `loop.touches_relax:`
// 的读取+校验做成了这一份；自动收紧的三个阈值是**同一个块**的子键，另起一份解析器就是同一个
// 配置面的第二个真相源。本模块仍然只做「读 + 校验」，⛔ 不做判定、⛔ 不写控制态——那是
// `touches-relax-tighten.ts` 的事。
//
// ⛔ 无内置回退：三个键都是**可选属性**，缺哪个就 `undefined`（⛔ 不是 30 / 1 / 0.3 之类字面量）。
// 这不是「懒得填默认」，是硬规则 12 与 GOAL-037 的正面要求——现在没有放宽样本，凭空设一个阈值
// 就是凭空设前置；取值由人在 AC-362 的数据与影子期读数出来后填进配置。

/** The three `auto_tighten:` key names — THE single source (⛔ ⛔ 不在别处重拼这些字面量)。 */
export const AUTO_TIGHTEN_KEYS = ["min_samples", "max_extra_worker_minutes", "max_fan_in_failure_rate"] as const;

export type AutoTightenKey = (typeof AUTO_TIGHTEN_KEYS)[number];

/** 自动收紧子块。三个键**各自可选**且**互不代替**（一个齐了不代表另一个也齐了）。 */
export interface TouchesRelaxAutoTighten {
  /** 放宽组可测任务数的下界；`< min_samples` ⇒ 本次**不评估**（⛔ 不是「未超阈值」）。整数 `>= 1`。 */
  min_samples?: number;
  /** 放宽组相对对照组的**额外 worker 分钟**上界；超过 ⇒ 收紧。有限数 `>= 0`。 */
  max_extra_worker_minutes?: number;
  /** 按 `mechanical_fan_in.step` 逐键的 fan-in 失败率上界；某一步超过 ⇒ 收紧。
   *  键 = step 词表取值（`merge-develop` / `suite` / `ff` …，⛔ 不是 `final_state` 词表）。 */
  max_fan_in_failure_rate?: Record<string, number>;
}

/** `auto_tighten:` 子块在 issue 消息里的点分路径前缀（唯一定义点）。 */
const AUTO_TIGHTEN_FIELD = `${SECTION_FIELD}.auto_tighten`;

/** The raw read: `present` = the section exists; `section` = its RAW value (unparsed); `error` = a
 *  fail-closed reason for an unreadable file. `present:false` covers BOTH "no config file at all"
 *  and "no `loop.touches_relax:` key" — the default-off posture, exactly as `readArchDiscoveryConfig`. */
export interface TouchesRelaxConfigRead {
  present: boolean;
  section: unknown | null;
  error: string | null;
}

/** The three-state (+ invalid) join a consumer actually reads. */
export type TouchesRelaxState = "absent" | "off" | "shadow" | "live" | "invalid";

export interface TouchesRelaxLoad {
  /** ⛔ `"absent"` (nobody declared the block) and `"off"` (declared, resolves to off) are DISTINCT. */
  state: TouchesRelaxState;
  /** The effective mode. Reads `"off"` for BOTH `absent` and `off` (the default semantics), and for
   *  `invalid` — which is why `state` must be consulted, not `mode`. */
  mode: TouchesRelaxMode;
  /** The validated config, or `null` when the declaration is invalid. */
  config: TouchesRelaxConfig | null;
  issues: TouchesRelaxIssue[];
  error: string | null;
}

const describe = (v: unknown): string => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

/** The default-off config returned for `state:"absent"`: an off mode and two empty lists. ⛔ It
 *  carries NO `after_minutes` / `max_relaxed_inflight` — those are not defaults, they are required. */
function absentConfig(): TouchesRelaxConfig {
  return { mode: DEFAULT_TOUCHES_RELAX_MODE, shared_files: [], never_relax: [] };
}

/** Read `.quay/config.yml` `loop.touches_relax:`. No config file / no `loop:` / no section ⇒
 *  `present:false` (off by default). Malformed YAML, or a `loop:` that is not a mapping ⇒ `error` set
 *  (fail-closed — never folded into "off"). Does NO validation of the section's contents; that is
 *  `parseTouchesRelaxSection`'s job, so the two can be tested apart. */
export function readTouchesRelaxConfig(workspaceRoot: string): TouchesRelaxConfigRead {
  const configPath = path.join(workspaceRoot, ".quay", "config.yml");
  if (!fs.existsSync(configPath)) return { present: false, section: null, error: null };
  let parsed: unknown;
  try {
    parsed = YAML.parse(fs.readFileSync(configPath, "utf8"));
  } catch (e) {
    return { present: true, section: null, error: `FAIL-CLOSED: .quay/config.yml is malformed YAML — ${(e as Error).message}` };
  }
  const loop = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>).loop : undefined;
  if (loop === undefined || loop === null) return { present: false, section: null, error: null };
  if (typeof loop !== "object" || Array.isArray(loop)) {
    return { present: true, section: null, error: "FAIL-CLOSED: .quay/config.yml 'loop:' must be a mapping" };
  }
  const raw = (loop as Record<string, unknown>)[TOUCHES_RELAX_SECTION];
  if (raw === undefined || raw === null) return { present: false, section: null, error: null };
  return { present: true, section: raw, error: null };
}

/** Read one list field: an array of NON-EMPTY strings (a path or a glob). Absent ⇒ `[]` (a legal
 *  default — an empty relaxation candidate set / an empty never-relax set). Present but not a string
 *  array ⇒ named per-element issues. */
function readStringList(raw: unknown, field: string, issues: TouchesRelaxIssue[]): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    issues.push({ field, message: `${field} must be an array of non-empty strings (got ${describe(raw)})` });
    return [];
  }
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const el = raw[i];
    if (typeof el !== "string" || el.trim() === "") {
      issues.push({ field: `${field}[${i}]`, message: `${field}[${i}] must be a non-empty string (got ${JSON.stringify(el)})` });
      continue;
    }
    out.push(el);
  }
  return out;
}

/** Pure parse + validate of the `auto_tighten:` sub-block (GOAL-037 / AC-367).
 *
 *  Three OPTIONAL keys, each independently shape-checked, **none back-filled**:
 *   - absent / `null` sub-block ⇒ `undefined` (the whole sub-block is unconfigured — the caller must
 *     read that as 「阈值未配置 ⇒ 不评估」, ⛔ never as 「用内置默认值评估」);
 *   - `min_samples` ⇒ integer `>= 1`;
 *   - `max_extra_worker_minutes` ⇒ finite number `>= 0`;
 *   - `max_fan_in_failure_rate` ⇒ a mapping of step name → finite number in `[0, 1]`.
 *  Every refusal names the exact dotted path (`loop.touches_relax.auto_tighten.<key>`, and for the
 *  rate map the step key too) so a bad declaration is locatable in the file rather than merely
 *  "rejected". Unknown keys inside the sub-block are NOT rejected (same posture as the parent). */
function parseAutoTightenSection(raw: unknown, issues: TouchesRelaxIssue[]): TouchesRelaxAutoTighten | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    issues.push({ field: AUTO_TIGHTEN_FIELD, message: `${AUTO_TIGHTEN_FIELD} must be a mapping (got ${describe(raw)})` });
    return undefined;
  }
  const rec = raw as Record<string, unknown>;
  const out: TouchesRelaxAutoTighten = {};
  const [MIN_KEY, EXTRA_KEY, RATE_KEY] = AUTO_TIGHTEN_KEYS;

  const min = rec[MIN_KEY];
  if (min !== undefined && min !== null) {
    if (typeof min !== "number" || !Number.isInteger(min) || min < 1) {
      issues.push({ field: `${AUTO_TIGHTEN_FIELD}.${MIN_KEY}`, message: `${AUTO_TIGHTEN_FIELD}.${MIN_KEY} must be an integer >= 1 (got ${JSON.stringify(min)})` });
    } else {
      out.min_samples = min;
    }
  }

  const extra = rec[EXTRA_KEY];
  if (extra !== undefined && extra !== null) {
    if (typeof extra !== "number" || !Number.isFinite(extra) || extra < 0) {
      issues.push({ field: `${AUTO_TIGHTEN_FIELD}.${EXTRA_KEY}`, message: `${AUTO_TIGHTEN_FIELD}.${EXTRA_KEY} must be a finite number >= 0 (got ${JSON.stringify(extra)})` });
    } else {
      out.max_extra_worker_minutes = extra;
    }
  }

  const rate = rec[RATE_KEY];
  if (rate !== undefined && rate !== null) {
    if (typeof rate !== "object" || Array.isArray(rate)) {
      issues.push({ field: `${AUTO_TIGHTEN_FIELD}.${RATE_KEY}`, message: `${AUTO_TIGHTEN_FIELD}.${RATE_KEY} must be a mapping of step name -> rate in 0..1 (got ${describe(rate)})` });
    } else {
      const rates: Record<string, number> = {};
      for (const [step, v] of Object.entries(rate as Record<string, unknown>)) {
        if (step.trim() === "") {
          issues.push({ field: `${AUTO_TIGHTEN_FIELD}.${RATE_KEY}`, message: `${AUTO_TIGHTEN_FIELD}.${RATE_KEY} has an empty step name` });
          continue;
        }
        if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) {
          issues.push({ field: `${AUTO_TIGHTEN_FIELD}.${RATE_KEY}.${step}`, message: `${AUTO_TIGHTEN_FIELD}.${RATE_KEY}.${step} must be a finite number in 0..1 (got ${JSON.stringify(v)})` });
          continue;
        }
        rates[step] = v;
      }
      out.max_fan_in_failure_rate = rates;
    }
  }

  return out;
}

/** Pure parse + validate of ONE `loop.touches_relax` value. Collects EVERY issue (not fail-fast) so a
 *  single run names all the problems. Returns the NORMALISED config on success.
 *
 *  Semantics (GOAL-037 AC-364):
 *   - `mode` absent ⇒ legal, defaults to `off`. Present ⇒ must be one of `TOUCHES_RELAX_MODES`.
 *   - `mode` ∈ {shadow, live} ⇒ `after_minutes` AND `max_relaxed_inflight` are REQUIRED. ⛔ No
 *     built-in default is substituted for either: a missing one is a refusal that NAMES the field.
 *   - `after_minutes` present ⇒ finite number `> 0` (0, negatives, NaN and non-numbers all refused).
 *   - `max_relaxed_inflight` present ⇒ integer `>= 0`.
 *   - `mode: off` (or absent) ⇒ the two numbers are NOT required — but a value that IS given is still
 *     shape-checked (a bad number is a bad number whatever the mode).
 *   - `shared_files` / `never_relax` ⇒ arrays of non-empty strings; absent ⇒ `[]`.
 *   - Unknown keys are NOT rejected (this task's judgement面 stops at the fields above). */
export function parseTouchesRelaxSection(raw: unknown): { ok: true; config: TouchesRelaxConfig } | { ok: false; issues: TouchesRelaxIssue[] } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, issues: [{ field: SECTION_FIELD, message: `${SECTION_FIELD} must be a mapping (got ${describe(raw)})` }] };
  }
  const rec = raw as Record<string, unknown>;
  const issues: TouchesRelaxIssue[] = [];

  // ── mode ───────────────────────────────────────────────────────────────────────────────────────
  let mode: TouchesRelaxMode = DEFAULT_TOUCHES_RELAX_MODE;
  let modeUsable = true;
  if (rec.mode !== undefined && rec.mode !== null) {
    if (typeof rec.mode !== "string" || !(TOUCHES_RELAX_MODES as readonly string[]).includes(rec.mode)) {
      issues.push({
        field: `${SECTION_FIELD}.mode`,
        message: `${SECTION_FIELD}.mode must be one of ${TOUCHES_RELAX_MODES.join(" | ")} (got ${JSON.stringify(rec.mode)})`,
      });
      modeUsable = false;
    } else {
      mode = rec.mode as TouchesRelaxMode;
    }
  }
  // An unreadable `mode` means we cannot even say whether the two thresholds are required, so we do
  // NOT pile a second "required" refusal on top of it — that would be a guess about an input we
  // already refused (硬规则 3b).
  const modeEnabled = modeUsable && mode !== "off";

  // ── after_minutes ──────────────────────────────────────────────────────────────────────────────
  let afterMinutes: number | undefined;
  if (rec.after_minutes !== undefined && rec.after_minutes !== null) {
    const v = rec.after_minutes;
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
      issues.push({
        field: `${SECTION_FIELD}.after_minutes`,
        message: `${SECTION_FIELD}.after_minutes must be a finite number > 0 (got ${JSON.stringify(v)})`,
      });
    } else {
      afterMinutes = v;
    }
  } else if (modeEnabled) {
    issues.push({
      field: `${SECTION_FIELD}.after_minutes`,
      message: `${SECTION_FIELD}.after_minutes is REQUIRED when mode is '${mode}' — no built-in default is applied (GOAL-037: the threshold comes from config, never from a literal in code)`,
    });
  }

  // ── max_relaxed_inflight ───────────────────────────────────────────────────────────────────────
  let maxRelaxedInflight: number | undefined;
  if (rec.max_relaxed_inflight !== undefined && rec.max_relaxed_inflight !== null) {
    const v = rec.max_relaxed_inflight;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
      issues.push({
        field: `${SECTION_FIELD}.max_relaxed_inflight`,
        message: `${SECTION_FIELD}.max_relaxed_inflight must be an integer >= 0 (got ${JSON.stringify(v)})`,
      });
    } else {
      maxRelaxedInflight = v;
    }
  } else if (modeEnabled) {
    issues.push({
      field: `${SECTION_FIELD}.max_relaxed_inflight`,
      message: `${SECTION_FIELD}.max_relaxed_inflight is REQUIRED when mode is '${mode}' — no built-in default is applied (GOAL-037: the threshold comes from config, never from a literal in code)`,
    });
  }

  // ── lists ──────────────────────────────────────────────────────────────────────────────────────
  const sharedFiles = readStringList(rec.shared_files, `${SECTION_FIELD}.shared_files`, issues);
  const neverRelax = readStringList(rec.never_relax, `${SECTION_FIELD}.never_relax`, issues);

  // ── auto_tighten（GOAL-037 / AC-367）────────────────────────────────────────────────────────────
  const autoTighten = parseAutoTightenSection(rec.auto_tighten, issues);

  if (issues.length > 0) return { ok: false, issues };

  const config: TouchesRelaxConfig = { mode, shared_files: sharedFiles, never_relax: neverRelax };
  if (afterMinutes !== undefined) config.after_minutes = afterMinutes;
  if (maxRelaxedInflight !== undefined) config.max_relaxed_inflight = maxRelaxedInflight;
  // ⛔ 只在文件真的写了 `auto_tighten:` 时才挂上这个键（与上面两个数字同形）——「没写」与
  // 「写了但一个阈值都没给」由子块自身的 presence 与它的三个可选属性分别表达。
  if (autoTighten !== undefined) config.auto_tighten = autoTighten;
  return { ok: true, config };
}

/** The join a consumer reads: read the file, parse the section, and report ONE four-way-discriminable
 *  state. `state:"absent"` and `state:"off"` both read `mode:"off"` (the default semantics) — the
 *  distinction lives in `state`, which is exactly why `state` exists (硬规则 3b). Neither produces
 *  `issues`: absence is legal, and an explicit `off` is a complete declaration. */
export function loadTouchesRelaxConfig(workspaceRoot: string): TouchesRelaxLoad {
  const read = readTouchesRelaxConfig(workspaceRoot);
  if (read.error !== null) {
    return { state: "invalid", mode: DEFAULT_TOUCHES_RELAX_MODE, config: null, issues: [], error: read.error };
  }
  if (!read.present) {
    return { state: "absent", mode: DEFAULT_TOUCHES_RELAX_MODE, config: absentConfig(), issues: [], error: null };
  }
  const parsed = parseTouchesRelaxSection(read.section);
  if (!parsed.ok) {
    return { state: "invalid", mode: DEFAULT_TOUCHES_RELAX_MODE, config: null, issues: parsed.issues, error: null };
  }
  return { state: parsed.config.mode, mode: parsed.config.mode, config: parsed.config, issues: [], error: null };
}

// ── CLI (read-only) ──────────────────────────────────────────────────────────────────────────────────
const USAGE = [
  "usage: touches-relax-config.ts --validate [--root <dir>] [--json]",
  "  reads <root>/.quay/config.yml loop.touches_relax: and validates it (never writes the file)",
  "  exit 0 = qualified (absent, or declared-and-valid); 1 = not qualified; 2 = usage error",
];

function main(argv: string[]): number {
  let root: string | null = null;
  let json = false;
  let validate = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--validate") validate = true;
    else if (a === "--json") json = true;
    else if (a === "--root") {
      const v = argv[++i];
      if (v === undefined || v === "") {
        process.stderr.write(`touches-relax-config: --root requires a directory\n`);
        return 2;
      }
      root = v;
    } else if (a === "--help" || a === "-h") {
      process.stdout.write(`${USAGE.join("\n")}\n`);
      return 0;
    } else {
      process.stderr.write(`touches-relax-config: unknown argument '${a}'\n${USAGE.join("\n")}\n`);
      return 2;
    }
  }
  if (!validate) {
    process.stderr.write(`touches-relax-config: --validate is required (this CLI has exactly one verb)\n${USAGE.join("\n")}\n`);
    return 2;
  }

  const rootDir = root ?? process.cwd();
  const load = loadTouchesRelaxConfig(rootDir);
  const qualified = load.error === null && load.issues.length === 0;

  if (json) {
    process.stdout.write(`${JSON.stringify({ root: rootDir, qualified, ...load }, null, 2)}\n`);
    return qualified ? 0 : 1;
  }
  const lines: string[] = [];
  lines.push(`touches-relax: ${path.join(rootDir, ".quay", "config.yml")}`);
  lines.push(`state: ${load.state}`);
  lines.push(`mode: ${load.mode}`);
  lines.push(`config: ${load.config === null ? "null" : JSON.stringify(load.config)}`);
  for (const issue of load.issues) lines.push(`issue: ${issue.field} — ${issue.message}`);
  if (load.error !== null) lines.push(`error: ${load.error}`);
  lines.push(`verdict: ${qualified ? "QUALIFIED" : "NOT-QUALIFIED"}`);
  process.stdout.write(`${lines.join("\n")}\n`);
  return qualified ? 0 : 1;
}

// 直接执行才跑 CLI（被 import 时是纯库）——用 gate-script-base 的【名字形】isDirectEntry。
//
// ⛔ 这里【不是】URL 形（`realpathSync(argv[1]) === realpathSync(import.meta.url)`）。本模块自 AC-365
// 起被 `driver-filters.ts` 静态 import，而 driver-filters 是**每一个 driver bundle** 的传递依赖 ⇒
// esbuild 会把本模块连同它的入口块一起内联进 `dist/{goal,quality-gate,meta,outer,promotion,worker}-driver.js`。
// 内联后所有模块共用 bundle 的 `import.meta.url`，而 `process.argv[1]` 正是 bundle 自身 ⇒ URL 形守卫
// 在 bundle 里【恒真】，bundle 一启动就跑本模块的 main 而不是自己的（实测 2026-10-17：
// `node dist/goal-driver.js --help` 打印 `touches-relax-config: unknown argument '--help'` 的 usage 后
// exit 0，driver 的常驻环从未启动）。名字形要求被执行文件的 basename 与本模块名相同——直接执行时命中，
// 内联进 bundle 时 basename 是宿主入口名（≠ 本模块名）⇒ 惰性不触发。与 gate-script-base.ts 里
// `isDirectEntry` 的 BUNDLER-FRIENDLY 段、以及 identity-replication-check.ts / target-identity-literal-check.ts
// 的用法同形（`build-plugin-dist` 的 "inlined entry-guard hijack" 闸判定的就是这个）。
if (isDirectEntry(import.meta, undefined, "touches-relax-config")) {
  process.exit(main(process.argv.slice(2)));
}
