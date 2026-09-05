#!/usr/bin/env node
// accounting-emit.ts — the UNIFIED FOUR-TUPLE emitter (SPEC §2.5 执行账本)
// (orchestration/SPEC-three-layer-unified-architecture-2026-08-09.md §2.5,
//  task gap-spec-p2-quad-tuple-unified-emitter).
//
// THE PROBLEM IT SOLVES (SPEC 2.5): the ledger four-tuple — ① each claimed mechanism's last real
// execution time (vs its claimed period), ② this layer's occupancy (real in-flight / effective_cap),
// ③ which line this round's writes landed on, ④ this round's ledger line — was hand-assembled by
// each of the three layers (outer / inner / manager) with INCONSISTENT formats and no shared
// implementation. The SPEC's core deliverable (§2.5 "本规格的核心,今天最缺的一项") is a UNIFIED
// emitter: same format every layer every round, mechanically checkable, with 缺值 = 未执行 (a
// missing value means a mechanism did not run) reported mechanically rather than by self-report.
//
// THIS SCRIPT IS THAT UNIFIED EMITTER. All three layers' tick docs call
//   node plugin/scripts/accounting-emit.ts --layer <outer|inner|manager>
// and paste the same canonical JSON into their tick logs. The schema (field set) is IDENTICAL
// across the three layers by construction — the Contract band `unified_emitter_format`.
//
// THE FOUR TUPLE ELEMENTS (always present as JSON keys, null when unreadable):
//   ① mechanisms  — [{name, claimed_period_hours, last_run_epoch, last_run_age_hours, overdue,
//                    status, judgement, source}] — each mechanism the layer claims to use, with its
//                    last real execution time vs its claimed period.
//   ② occupancy   — {in_flight, effective_cap, ratio, source} — real in-flight / effective_cap.
//   ③ write_target— which line this layer writes to (SPEC 2.7; auto: integration).
//   ④ ledger_line — the canonical one-line projection of this round's tuple.
//
// MISSING DETECTION (invariant quad_tuple_no_missing = 1): the `missing` array lists EVERY tuple
// element that is null / empty / unreadable; `complete` is false and the exit code is 1 when
// `missing` is non-empty. A mechanism with no exec time and no judgement is a missing field
// (缺值 = 未执行) — NEVER silently dropped. A mechanism that the layer declares judged
// (`--mechanism name:never:已停用|已替代|是缺陷`) is ACCOUNTED FOR even if it never ran (AC4:
// 已触发判定 — 已停用/已替代/是缺陷 三选一).
//
// EXEC-TIME READABILITY (invariant layer_exec_time_readable = 1): the emitter reports
// `mechanisms.exec_time_unreadable` in `missing` when NO mechanism of the layer has a readable
// last_run_epoch — the AC4 "每层「最近真实执行时刻」A 项可读" mechanical check.
//
// DATA SOURCES (single-source, never a second copy of detection arithmetic):
//   ① mechanisms — auto-read from on-disk traces where the workspace has them (the outer's
//     `.quay/closure-pass-last-run.json` / `.quay/verification-round.jsonl` /
//     `.quay/full-suite-state.json`), plus `--mechanism name:epoch[:judgement]` injection for the
//     per-layer meta-cc-gathered times (SPEC 2.5 最小改动 — the layer queries
//     `meta-cc query_session_content role=tool tool_name=<X>` for `last(timestamp)` and injects it).
//   ② occupancy — `--in-flight` / `--cap` overrides, else auto from cap-from-gate.sh +
//     fast-mode-telemetry.ts --slots when the workspace has a loop config (guarded; never a hang).
//   ③ write_target — `--write-target` override, else the SPEC 2.7 default `integration`.
//   ④ ledger_line — auto-derived; `--ledger-line` overrides.
//
// Usage:
//   node --experimental-strip-types plugin/scripts/accounting-emit.ts \
//     --layer <outer|inner|manager> [--root <dir>] [--json]
//     [--in-flight <N>] [--cap <N>] [--write-target <branch>]
//     [--mechanism <name>[:<epoch|never>[:<judgement>]]]...   (repeatable; judgement ∈ 已停用|已替代|是缺陷)
//     [--no-registry] [--ledger-line <text>] [--help]
//
// Exit codes:
//   0  complete (missing empty — the four-tuple is fully readable)
//   1  incomplete (missing non-empty — a tuple field is null/unreadable/never-run-unjudged; the
//      `missing` array names each one; this is a REPORT, not a gate — same shape as closure-lag-check)
//   2  usage / environment error
//
// Test: plugin/test/accounting-emit.test.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { layerMechanisms, LAYER_MECHANISMS } from "./accounting-emit-layer-map.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_DIR = __dirname;

const SCHEMA_VERSION = "quad-tuple/v1";
const JUDGEMENTS = ["已停用", "已替代", "是缺陷"];
const LAYERS = ["outer", "inner", "manager"];

// ── per-layer mechanism registry (the layer's CLAIMED mechanisms; auto-traces where real) ──────────────
// The layer → mechanisms mapping lives in accounting-emit-layer-map.ts (AC39): each layer emits its
// OWN mechanisms — cap-from-gate/slot-refill 归 inner, closure-lag-check 归 outer, and manager emits
// its own (manager-tick-log / Workflow / session-liveness). This builder resolves the map + per-name
// defs (period + trace). `trace` is present ONLY for mechanisms with a real, defined on-disk trace
// in a live workspace; everything else is injected by the layer via `--mechanism` (its meta-cc-
// gathered times). periodHours is the mechanism's claimed period (SPEC 2.5: compare last real exec
// vs claimed period).
type MechanismSpec = {
  name: string;
  periodHours: number;
  trace?: { file?: string; dir?: string; keys: string[]; mtime?: boolean };
};

// Resolved once at module load; `layerMechanisms` fails closed (throws) on a stale map entry, so a
// mechanism-name typo in the map is a hard error, never a silently-dropped mechanism.
const MECHANISMS: Record<string, MechanismSpec[]> = Object.fromEntries(
  Object.keys(LAYER_MECHANISMS).map((layer) => [layer, layerMechanisms(layer)])
);

// ── timestamp helpers ─────────────────────────────────────────────────────────────────────────────────
function toEpochSeconds(v: unknown): number | null {
  if (typeof v === "number") {
    return Number.isFinite(v) ? (v > 1e12 ? Math.floor(v / 1000) : v) : null;
  }
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    if (Number.isFinite(n)) return n > 1e12 ? Math.floor(n / 1000) : n;
    const ms = Date.parse(trimmed);
    if (Number.isFinite(ms)) return Math.floor(ms / 1000);
  }
  return null;
}

// Extract a timestamp from a JSON/JSONL/mtime source by trying the candidate keys in order.
function readTimestamp(root: string, trace: NonNullable<MechanismSpec["trace"]>): { epoch: number | null; found: boolean } {
  // mtime mode: the file's mtime IS the last real execution time (manager-tick-log).
  if (trace.mtime) {
    const p = path.join(root, trace.file ?? "");
    try {
      const st = fs.statSync(p);
      return { epoch: Math.floor(st.mtimeMs / 1000), found: true };
    } catch {
      return { epoch: null, found: false };
    }
  }
  // dir mode: read the newest non-hidden file inside (fast-mode-telemetry aggregate dir).
  if (trace.dir) {
    let abs = path.join(root, trace.dir);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return { epoch: null, found: false };
    const names = fs.readdirSync(abs).filter((f) => !f.startsWith(".")).sort();
    if (names.length === 0) return { epoch: null, found: false };
    abs = path.join(abs, names[names.length - 1]);
    return readTimestampFromFile(abs, trace.keys);
  }
  const p = path.join(root, trace.file ?? "");
  if (!fs.existsSync(p)) return { epoch: null, found: false };
  return readTimestampFromFile(p, trace.keys);
}

function readTimestampFromFile(file: string, keys: string[]): { epoch: number | null; found: boolean } {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { epoch: null, found: false };
  }
  // JSONL: use the last non-empty line.
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const lastLine = lines.length > 0 ? lines[lines.length - 1] : "";
  let parsed: unknown = null;
  if (lastLine !== "") {
    try {
      parsed = JSON.parse(lastLine);
    } catch {
      parsed = null;
    }
  }
  if (parsed === null) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (typeof parsed !== "object" || parsed === null) return { epoch: null, found: false };
  const rec = parsed as Record<string, unknown>;
  for (const k of keys) {
    if (k in rec) {
      const e = toEpochSeconds(rec[k]);
      if (e !== null) return { epoch: e, found: true };
    }
  }
  return { epoch: null, found: true }; // file exists but no candidate key → found (trace present, unreadable)
}

// ── occupancy auto-collection (guarded; never a hang) ─────────────────────────────────────────────────
// Unified across the three layers (AC39/AC3): cap from cap-from-gate.sh, in_flight from
// fast-mode-telemetry.ts --slots (realConcurrency = open-bracket executors + non-task subagents).
// Each half that is not already supplied by flag is auto-collected — a half-complete occupancy (cap
// known, in_flight missing) is the exact observed defect (manager 034125: `effective_cap` auto-read
// but `in_flight` null), so the two halves are NEVER left with one missing when the loop config
// exists to source it.
function autoOccupancy(root: string, capOverride: number | null, inFlightOverride: number | null): { inFlight: number | null; cap: number | null } {
  // effective_cap — only when the workspace has a loop config (cap-from-gate reads .quay/config.yml).
  let cap: number | null = capOverride;
  if (cap === null && fs.existsSync(path.join(root, ".quay", "config.yml"))) {
    const capRes = spawnSync("bash", [path.join(SCRIPT_DIR, "cap-from-gate.sh"), "--root", root], {
      encoding: "utf8",
      timeout: 30000,
    });
    if (capRes.status === 0 && capRes.stdout) {
      const m = capRes.stdout.match(/^effective_cap=([0-9]+)$/m);
      if (m) cap = Number(m[1]);
    }
  }
  // occupancy.in_flight — three-layer UNIFIED (AC39): ALWAYS read the shared telemetry slot meter
  // (fast-mode-telemetry --slots), regardless of whether the workspace has a loop config. Gating on
  // `.quay/config.yml` made in_flight null → `missing=[occupancy.in_flight]` for ALL three layers
  // (manager 034125), because a fresh worktree / bare tasks dir has no config. The slot meter is a
  // PURE READ (never writes a file), returns 0 when nothing is in flight, and fail-closes to null
  // only on a genuinely unreadable meter — 缺值 = 未执行 preserved (the meter's own failure is still
  // reported as missing).
  let inFlight: number | null = inFlightOverride;
  if (inFlight === null) {
    const slotsArgs = ["--no-warnings", "--experimental-strip-types", path.join(SCRIPT_DIR, "fast-mode-telemetry.ts"), "--slots", "--root", root, "--json"];
    if (cap !== null) {
      const idx = slotsArgs.indexOf("--slots");
      slotsArgs.splice(idx + 1, 0, "--cap", String(cap));
    }
    const slotsRes = spawnSync("node", slotsArgs, {
      encoding: "utf8",
      // The full --slots aggregation is heavy in a large workspace (~30s: per-task git history +
      // closed-but-live scan). QUAY_TELEMETRY_FAST_SLOTS=1 selects fast-mode-telemetry.ts's fast
      // slot view (~0.6s) which skips those annotations — they are irrelevant to realConcurrency.
      // Bounded long (90s) so even the un-optimized full path completes without a spurious SIGTERM.
      timeout: 90000,
      env: { ...process.env, QUAY_TELEMETRY_FAST_SLOTS: "1" },
    });
    if (slotsRes.status === 0 && slotsRes.stdout) {
      try {
        const slots = JSON.parse(slotsRes.stdout);
        // `inFlight` is the explicit occupancy alias the --slots CLI exposes (AC39); realConcurrency
        // is the legacy field. Either is the real concurrency signal (open brackets whose executor is
        // still present + non-task subagent processes). A number (incl. 0) is present, not missing.
        const v = typeof slots.inFlight === "number" ? slots.inFlight : slots.realConcurrency;
        if (typeof v === "number") inFlight = v;
      } catch {
        inFlight = null;
      }
    }
  }
  return { inFlight, cap };
}

// ── ledger line (④) ───────────────────────────────────────────────────────────────────────────────────
function buildLedgerLine(layer: string, atIso: string, occ: { in: number | null; cap: number | null }, writeTarget: string, mechs: { name: string; lastRun: number | null; judged: boolean }[], missingCount: number): string {
  const occStr = occ.in !== null && occ.cap !== null ? `occ=${occ.in}/${occ.cap}` : "occ=?/?";
  const mechStr = `mech=${mechs.filter((m) => m.lastRun !== null || m.judged).length}/${mechs.length}`;
  let line = `quad-tuple ${layer} ${atIso} ${occStr} wt=${writeTarget} ${mechStr}`;
  if (missingCount > 0) line += ` missing=${missingCount}`;
  return line;
}

// ── usage ─────────────────────────────────────────────────────────────────────────────────────────────
function usage(): string {
  const lines = [
    "accounting-emit.ts — the UNIFIED FOUR-TUPLE emitter (SPEC §2.5 执行账本)",
    "",
    "Usage:",
    "  node --experimental-strip-types plugin/scripts/accounting-emit.ts \\",
    "    --layer <outer|inner|manager> [--root <dir>] [--json]",
    "    [--in-flight <N>] [--cap <N>] [--write-target <branch>]",
    "    [--mechanism <name>[:<epoch|never>[:<judgement>]]]...   (repeatable; judgement ∈ 已停用|已替代|是缺陷)",
    "    [--no-registry] [--ledger-line <text>] [--help]",
    "",
    "The four tuple elements: ① mechanisms (claimed mechanisms' last real exec time vs period)",
    "② occupancy (in-flight / effective_cap) ③ write_target ④ ledger_line.",
    "",
    "MISSING (invariant quad_tuple_no_missing): any tuple element that is null / empty / unreadable —",
    "and any mechanism that is never-run WITHOUT a judgement (已停用/已替代/是缺陷) — is listed in",
    "`missing`, `complete` is false, and the exit code is 1. 缺值 = 未执行.",
    "",
    "Exit codes: 0 complete · 1 incomplete (missing non-empty; a report, not a gate) · 2 usage error",
    "",
    "Test: plugin/test/accounting-emit.test.mjs",
  ];
  return lines.join("\n");
}

// ── arg parsing ──────────────────────────────────────────────────────────────────────────────────────
function parseArgs(argv: string[]): {
  layer: string | null;
  root: string;
  json: boolean;
  inFlight: number | null;
  cap: number | null;
  writeTarget: string | null;
  ledgerLine: string | null;
  mechanisms: { name: string; epoch: number | null; judgement: string | null }[];
  noRegistry: boolean;
} {
  const out = {
    layer: null as string | null,
    root: path.resolve(SCRIPT_DIR, "..", ".."),
    json: false,
    inFlight: null as number | null,
    cap: null as number | null,
    writeTarget: null as string | null,
    ledgerLine: null as string | null,
    mechanisms: [] as { name: string; epoch: number | null; judgement: string | null }[],
    noRegistry: false,
  };
  let i = 0;
  const next = (flag: string): string => {
    i += 1;
    if (i >= argv.length) {
      console.error(`accounting-emit: ${flag} requires a value`);
      process.exit(2);
    }
    return argv[i];
  };
  while (i < argv.length) {
    const a = argv[i];
    switch (a) {
      case "--layer": {
        const v = next(a);
        if (!LAYERS.includes(v)) {
          console.error(`accounting-emit: unknown layer '${v}' (expected ${LAYERS.join("|")})`);
          process.exit(2);
        }
        out.layer = v;
        break;
      }
      case "--root": out.root = path.resolve(next(a)); break;
      case "--json": out.json = true; break;
      case "--in-flight": {
        const v = next(a);
        if (!/^[0-9]+$/.test(v)) {
          console.error(`accounting-emit: --in-flight must be a non-negative integer: ${v}`);
          process.exit(2);
        }
        out.inFlight = Number(v);
        break;
      }
      case "--cap": {
        const v = next(a);
        if (!/^[0-9]+$/.test(v)) {
          console.error(`accounting-emit: --cap must be a non-negative integer: ${v}`);
          process.exit(2);
        }
        out.cap = Number(v);
        break;
      }
      case "--write-target": out.writeTarget = next(a); break;
      case "--ledger-line": out.ledgerLine = next(a); break;
      case "--no-registry": out.noRegistry = true; break;
      case "--mechanism": {
        const v = next(a);
        const parts = v.split(":");
        const name = parts[0];
        if (!name) {
          console.error(`accounting-emit: --mechanism requires a name (name[:epoch|never[:judgement]])`);
          process.exit(2);
        }
        let epoch: number | null = null;
        let judgement: string | null = null;
        if (parts.length >= 2 && parts[1] !== "") {
          if (parts[1] === "never") {
            epoch = null;
          } else {
            const e = toEpochSeconds(parts[1]);
            if (e === null) {
              console.error(`accounting-emit: --mechanism ${name} epoch must be epoch-seconds, an ISO timestamp, or 'never': ${parts[1]}`);
              process.exit(2);
            }
            epoch = e;
          }
        }
        if (parts.length >= 3 && parts[2] !== "") {
          if (!JUDGEMENTS.includes(parts[2])) {
            console.error(`accounting-emit: --mechanism ${name} judgement must be one of ${JUDGEMENTS.join("/")}: ${parts[2]}`);
            process.exit(2);
          }
          judgement = parts[2];
        }
        out.mechanisms.push({ name, epoch, judgement });
        break;
      }
      case "--help":
      case "-h":
        console.log(usage());
        process.exit(0);
      default:
        console.error(`accounting-emit: unknown argument: ${a}`);
        console.error(usage());
        process.exit(2);
    }
    i += 1;
  }
  if (!out.layer) {
    console.error("accounting-emit: --layer <outer|inner|manager> is required");
    process.exit(2);
  }
  return out;
}

// ── assemble one mechanism entry ─────────────────────────────────────────────────────────────────────
function assembleMechanism(
  spec: { name: string; periodHours: number; trace?: NonNullable<MechanismSpec["trace"]> },
  root: string,
  injected: { name: string; epoch: number | null; judgement: string | null }[]
): {
  name: string;
  claimed_period_hours: number;
  last_run_epoch: number | null;
  last_run_age_hours: number | null;
  overdue: boolean;
  status: string;
  judgement: string | null;
  source: string;
} {
  const inj = injected.find((m) => m.name === spec.name);
  const now = Math.floor(Date.now() / 1000);
  let lastRun: number | null = null;
  let source = "none";
  if (inj) {
    lastRun = inj.epoch;
    source = inj.epoch !== null ? "flag" : "flag-never";
  } else if (spec.trace) {
    const t = readTimestamp(root, spec.trace);
    lastRun = t.epoch;
    source = t.found ? "trace" : "trace-absent";
  }
  const judgement = inj?.judgement ?? null;
  let age: number | null = null;
  let overdue = false;
  if (lastRun !== null) {
    age = Math.max(0, (now - lastRun) / 3600);
    overdue = age > spec.periodHours;
  }
  let status: string;
  if (judgement) {
    status = "judged";
  } else if (lastRun === null) {
    status = "never-run";
  } else if (overdue) {
    status = "overdue";
  } else {
    status = "fresh";
  }
  return {
    name: spec.name,
    claimed_period_hours: spec.periodHours,
    last_run_epoch: lastRun,
    last_run_age_hours: age !== null ? Math.round(age * 100) / 100 : null,
    overdue,
    status,
    judgement,
    source,
  };
}

// ── main ──────────────────────────────────────────────────────────────────────────────────────────────
function main() {
  const args = parseArgs(process.argv.slice(2));
  const layer = args.layer!;
  const root = args.root;

  if (!fs.existsSync(root)) {
    console.error(`accounting-emit: not a directory: ${root}`);
    process.exit(2);
  }

  // ── ① mechanisms ──────────────────────────────────────────────────────────────────────────────────
  const registry = args.noRegistry ? [] : (MECHANISMS[layer] ?? []);
  const specs: { name: string; periodHours: number; trace?: NonNullable<MechanismSpec["trace"]> }[] = [...registry];
  // Inject mechanisms not in the registry (append); in-registry names are overridden (dedup).
  for (const inj of args.mechanisms) {
    if (!specs.some((s) => s.name === inj.name)) {
      specs.push({ name: inj.name, periodHours: 1 });
    }
  }
  const mechs = specs.map((s) => assembleMechanism(s, root, args.mechanisms));

  // ── ② occupancy ──────────────────────────────────────────────────────────────────────────────────
  // Unified across the three layers (AC39/AC3): auto-collect EACH missing half from the workspace's
  // loop config, not only when both halves are absent. A half-complete tuple (cap known, in_flight
  // missing) was the observed defect (manager 034125); it must never be emitted as-is when the loop
  // config exists to source the missing half.
  let inFlight: number | null = args.inFlight;
  let cap: number | null = args.cap;
  let occSource = "flag";
  if (!args.noRegistry) {
    const auto = autoOccupancy(root, cap, inFlight);
    if (inFlight === null && auto.inFlight !== null) {
      inFlight = auto.inFlight;
      occSource = occSource === "flag" ? "flag+auto" : "auto";
    }
    if (cap === null && auto.cap !== null) {
      cap = auto.cap;
      occSource = occSource === "flag" ? "flag+auto" : "auto";
    }
  }
  // purely auto-collected (neither half came from a flag) ⇒ "auto", not "flag+auto"
  if (occSource === "flag+auto" && args.inFlight === null && args.cap === null) {
    occSource = "auto";
  }
  if (occSource === "flag" && inFlight === null && cap === null) {
    occSource = "none";
  }
  let ratio: number | null = null;
  if (inFlight !== null && cap !== null && cap > 0) ratio = Math.round((inFlight / cap) * 100) / 100;

  // ── ③ write_target ────────────────────────────────────────────────────────────────────────────────
  const writeTarget = args.writeTarget ?? "integration";
  const wtSource = args.writeTarget !== null ? "flag" : "auto";

  // ── missing detection (invariant quad_tuple_no_missing) ───────────────────────────────────────────
  const missing: string[] = [];
  const warnings: string[] = [];

  // mechanisms missing: never-run AND unjudged (缺值 = 未执行); overdue AND unjudged (AC4 must judge).
  for (const m of mechs) {
    if (m.last_run_epoch === null && !m.judgement) {
      missing.push(`mechanism:${m.name}.last_run_epoch`);
    }
    if (m.overdue && !m.judgement) {
      missing.push(`mechanism:${m.name}.judgement`);
    }
  }
  // AC4 exec-time readability: at least one mechanism per layer with a readable last real exec time.
  if (!mechs.some((m) => m.last_run_epoch !== null)) {
    missing.push("mechanisms.exec_time_unreadable");
  }
  // overdue (even judged) is a WARNING for visibility, not a missing field.
  for (const m of mechs) {
    if (m.overdue) warnings.push(`mechanism:${m.name}.overdue`);
  }

  // occupancy missing: either half null.
  if (inFlight === null) missing.push("occupancy.in_flight");
  if (cap === null) missing.push("occupancy.effective_cap");

  // write_target missing: empty.
  if (!writeTarget) missing.push("write_target");

  // ledger_line missing: computed below; empty ⇒ missing.
  const atIso = new Date().toISOString();
  const atEpoch = Math.floor(Date.now() / 1000);
  const ledgerLine = args.ledgerLine ?? buildLedgerLine(layer, atIso, { in: inFlight, cap }, writeTarget, mechs.map((m) => ({ name: m.name, lastRun: m.last_run_epoch, judged: m.judgement !== null })), missing.length);
  if (!ledgerLine) missing.push("ledger_line");

  const complete = missing.length === 0;

  const out = {
    layer,
    schema_version: SCHEMA_VERSION,
    at_iso: atIso,
    at_epoch: atEpoch,
    mechanisms: mechs,
    occupancy: { in_flight: inFlight, effective_cap: cap, ratio, source: occSource },
    write_target: writeTarget,
    write_target_source: wtSource,
    ledger_line: ledgerLine,
    ledger_line_source: args.ledgerLine !== null ? "flag" : "auto",
    missing,
    warnings,
    complete,
  };

  if (args.json) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`layer=${layer}`);
    console.log(`schema_version=${SCHEMA_VERSION}`);
    console.log(`complete=${complete}`);
    console.log(`ledger_line=${ledgerLine}`);
    for (const m of mechs) {
      const e = m.last_run_epoch !== null ? String(m.last_run_epoch) : "null";
      console.log(`mechanism.${m.name}=${e} status=${m.status} judgement=${m.judgement ?? ""} overdue=${m.overdue}`);
    }
    console.log(`occupancy.in_flight=${inFlight ?? "null"} effective_cap=${cap ?? "null"} ratio=${ratio ?? "null"}`);
    console.log(`write_target=${writeTarget}`);
    if (missing.length > 0) console.log(`missing=${missing.join(",")}`);
    if (warnings.length > 0) console.log(`warnings=${warnings.join(",")}`);
  }

  process.exitCode = complete ? 0 : 1;
}

main();
