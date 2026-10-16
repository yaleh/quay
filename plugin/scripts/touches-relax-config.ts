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
}

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

  if (issues.length > 0) return { ok: false, issues };

  const config: TouchesRelaxConfig = { mode, shared_files: sharedFiles, never_relax: neverRelax };
  if (afterMinutes !== undefined) config.after_minutes = afterMinutes;
  if (maxRelaxedInflight !== undefined) config.max_relaxed_inflight = maxRelaxedInflight;
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

// 直接执行才跑 CLI（被 import 时是纯库——与 duration-report.ts / gate-script-base 的 isDirectEntry 同形）。
const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fs.realpathSync(entry) === fs.realpathSync(new URL(import.meta.url).pathname);
  } catch {
    return false;
  }
})();
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
