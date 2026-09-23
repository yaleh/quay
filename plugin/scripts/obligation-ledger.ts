#!/usr/bin/env node
/**
 * obligation-ledger.ts — 义务台账机械化（gap-obligation-ledger-mechanization）
 *
 * Mechanizes the obligation ledger: DERIVE the obligation set from the generator registry + a round's
 * readings (NOT author-written), compute ages, sort undischarged by age DESC (negative feedback —
 * skip ⇒ next round it is more prominent), hang the escalation ladder on the OLDEST UNDISCHARGED
 * obligation's AGE (not on content), and gate round-close (undischarged / undeferred ⇒ cannot close).
 *
 * The three-piece should-be (manager 2026-08-09, human-ruled) this mechanizes:
 *   1. 义务一等对象 {id, condition, live, reading, first_true_at, ticks_true, discharged_at,
 *      discharged_by, defer_reason, unblock_condition}
 *   2. 负反馈 = 年龄进下一轮输入 + 优先级随年龄单调上升（处置顺序按年龄不按成本）
 *   3. 升级阶梯挂在最老未处置义务的年龄上（不挂内容；nyf>5 那种是实例阈值，写一条只治一条）
 *
 * Two hard properties:
 *   - 义务集是【推导】的不是【作者写】的 —— 同一条件两轮同一 id（deriveObligationId(key) 确定）；
 *     生成器没给读数的义务记为 live:null / 未查，FAIL-CLOSED 拦闭轮（漏写即漏记）。
 *   - 未处置或未显式 defer（带理由+解阻塞条件）⇒ 本轮不能闭轮（round_cannot_close_with_undischarged）。
 *
 * Form split per ADR-033（值从哪来定形式）:
 *   - 年龄/排序/阶梯/闭轮判定 —— 普通确定性 JS（本文件）。
 *   - 「这条义务算不算已处置」—— 带 schema 的语义判定，走 obligation-discharge-agent.ts 的
 *     DISCHARGE_VERDICT_SCHEMA / validateDischargeVerdict（同 no-action-check agent₁/₂/₃ 一族）。
 *   - 台账存储 —— 追加式 jsonl（<root>/.quay/obligation-ledger.jsonl），形状同 manager 手跑版
 *     (orchestration/manager-obligation-ledger.jsonl)。
 *
 * Ledger line kinds:
 *   {"_kind":"schema", ...}                                    — 头注
 *   {"_kind":"round","round":N,"obligations":[...],"oldest":{...},"ladder":{...},"canClose":bool,"at":...}
 *   {"_kind":"discharge","id":...,"discharged_by":...,"discharge_reason":...,"at":...}
 *   {"_kind":"defer","id":...,"defer_reason":...,"unblock_condition":...,"at":...}
 * Discharge/defer events OVERRIDE the latest round record when computing effective state
 * (`--oldest` / `--round-close-check`); the next `--report` bakes them into the round's obligations.
 *
 * Commands:
 *   --report --round <N> --readings <file|-> [--generators <file>] [--age-threshold <K>]
 *            [--ledger <file>] [--lenient]
 *       Derive the obligation set → compute ages from ledger history → sort undischarged by age desc
 *       → ladder verdict → canClose gate. Appends the round record. Prints the JSON report.
 *       Exit 0 if the round can close; exit 1 if not (fail-closed).
 *   --oldest [--ledger <file>]
 *       Print "<id> <age>" of the OLDEST UNDISCHARGED obligation (effective state), or "none 0".
 *   --round-close-check [--ledger <file>]
 *       Exit 0 if every live-or-unchecked obligation is discharged or explicitly deferred; else 1.
 *   --discharge <id> --by <who> [--reason <r>] [--ledger <file>]
 *       Append a discharge event (validated against DISCHARGE_VERDICT_SCHEMA; fail-closed).
 *   --defer <id> --reason <r> --unblock <c> [--ledger <file>]
 *       Append a defer event (validated against DISCHARGE_VERDICT_SCHEMA; fail-closed).
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validateDischargeVerdict, deriveObligationId, DISCHARGE_VERDICT_SCHEMA } from "./obligation-discharge-agent.ts";
// readJsonLines — semantic-dedup-scan finding `readjsonlines-seven-defs-three-behaviors`: this module
// carried its own private copy; the ledger reader now lives in gate-script-base.ts, once.
import { readJsonLines } from "./gate-script-base.ts";

// ── generator registry — the SINGLE SOURCE the obligation set is DERIVED from (三层共用) ─────────────
// The `condition` describes WHEN the obligation is live (needs handling). `semantic:true` means the
// `live` value must come from a schema'd agent() (ADR-033), not a heuristic.
export interface ObligationGenerator {
  key: string;
  condition: string;
  source: string;
  semantic: boolean;
}

export const DEFAULT_GENERATORS: ObligationGenerator[] = [
  { key: "SLOT", condition: "有可派发的空槽（in_flight < cap 且 recommended 非空）", source: "slot-refill/cap-from-gate", semantic: true },
  { key: "POOL", condition: "池位不足（pool < floor）", source: "ready-pool-check --json", semantic: false },
  { key: "NYF", condition: "积压未翻（nyf > 5 且工作已落地）", source: "ready-pool-check --json excluded[not-yet-flipped]", semantic: true },
  { key: "MERGE", condition: "integration 领先 develop 且 suite 绿且新鲜（应批量合）", source: "git rev-list + full-suite-state", semantic: true },
  { key: "RED", condition: "suite 为红（真红 vs 幻影红）", source: "full-suite-state", semantic: true },
];

// ── obligation record (AC2 一等对象) ─────────────────────────────────────────────────────────────────
export interface Obligation {
  id: string;                 // derived, deterministic: deriveObligationId(key)
  key: string;                // generator key (the derivation source)
  condition: string;          // registry prose
  source: string;             // registry source
  semantic: boolean;          // whether `live` needs a schema'd agent (ADR-033)
  live: boolean | null;       // null = reading MISSING this round (未查 ⇒ fail-closed)
  reading: string;            // evidence; "MISSING-READING" when the reading was absent
  first_true_at: number | null; // first round the obligation was live (age lower bound)
  ticks_true: number;         // age = consecutive live rounds (negative-feedback fuel)
  discharged_at: number | null; // round in which it was handled
  discharged_by: string | null;
  defer_reason: string | null;
  unblock_condition: string | null;
}

export interface RoundRecord {
  _kind: "round";
  round: number;
  obligations: Obligation[];
  oldest: { id: string; age: number } | null;
  ladder: { escalate: boolean; oldest_age: number | null; threshold: number };
  canClose: boolean;
  at: string;
}

type LedgerEvent = { _kind: "discharge" | "defer"; id: string; at: string; round?: number } & Record<string, unknown>;

// ── ledger IO (append-only; absent ledger = []) ──────────────────────────────────────────────────────
export function defaultLedgerPath(root: string): string {
  return path.join(root, ".quay", "obligation-ledger.jsonl");
}

function appendLine(file: string, obj: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(obj) + "\n", "utf8");
}

interface LedgerState {
  roundRecords: RoundRecord[];
  events: LedgerEvent[];
}

function readLedger(file: string): LedgerState {
  const rows = readJsonLines(file);
  const roundRecords: RoundRecord[] = [];
  const events: LedgerEvent[] = [];
  for (const r of rows) {
    if (r._kind === "round") roundRecords.push(r as unknown as RoundRecord);
    else if (r._kind === "discharge" || r._kind === "defer") events.push(r as unknown as LedgerEvent);
  }
  roundRecords.sort((a, b) => a.round - b.round);
  return { roundRecords, events };
}

// ── derivation + age computation ─────────────────────────────────────────────────────────────────────

export interface Reading {
  key: string;
  live: boolean;
  reading?: string;
}

/** Derive the obligation set for round N from the registry + readings + prior ledger history. */
export function deriveObligations(
  generators: ObligationGenerator[],
  readings: Reading[],
  history: RoundRecord[],
  round: number,
): { obligations: Obligation[]; missingReadings: string[] } {
  const byKey = new Map(readings.map((r) => [r.key, r]));
  const prior = history.length > 0 ? history[history.length - 1].obligations : [];
  const priorById = new Map(prior.map((o) => [o.id, o]));

  const obligations: Obligation[] = [];
  const missingReadings: string[] = [];

  for (const gen of generators) {
    const id = deriveObligationId(gen.key);
    const rd = byKey.get(gen.key);
    const prev = priorById.get(id);

    let live: boolean | null;
    let readingText: string;
    if (!rd) {
      live = null; // 未查 — fail-closed, blocks close
      readingText = "MISSING-READING";
      missingReadings.push(gen.key);
    } else {
      live = rd.live;
      readingText = rd.reading ?? "";
    }

    // Age continuity: consecutive live rounds. A not-live round resets; a missing reading preserves.
    let first_true_at: number | null = null;
    let ticks_true = 0;
    if (live === true) {
      if (prev && prev.live === true) {
        first_true_at = prev.first_true_at ?? round;
        ticks_true = (prev.ticks_true ?? 0) + 1;
      } else {
        first_true_at = round;
        ticks_true = 1;
      }
    } else if (live === null && prev) {
      // unknown this round — preserve prior age (unknown ≠ absent; 缺值 = 未查)
      first_true_at = prev.first_true_at;
      ticks_true = prev.ticks_true ?? 0;
    }
    // live === false ⇒ reset (not an active obligation this round)

    obligations.push({
      id,
      key: gen.key,
      condition: gen.condition,
      source: gen.source,
      semantic: gen.semantic,
      live,
      reading: readingText,
      first_true_at,
      ticks_true,
      discharged_at: prev?.discharged_at ?? null,
      discharged_by: prev?.discharged_by ?? null,
      defer_reason: prev?.defer_reason ?? null,
      unblock_condition: prev?.unblock_condition ?? null,
    });
  }
  return { obligations, missingReadings };
}

// ── sort / ladder / round-close ─────────────────────────────────────────────────────────────────────

/** Undischarged = discharged_at == null AND not explicitly deferred. Oldest first (age desc, then first_true asc). */
export function undischargedByAgeDesc(obligations: Obligation[]): Obligation[] {
  return obligations
    .filter((o) => o.discharged_at === null && o.defer_reason === null)
    .sort((a, b) => {
      const byAge = (b.ticks_true ?? 0) - (a.ticks_true ?? 0);
      if (byAge !== 0) return byAge;
      const aT = a.first_true_at ?? Number.MAX_SAFE_INTEGER;
      const bT = b.first_true_at ?? Number.MAX_SAFE_INTEGER;
      return aT - bT;
    });
}

export interface LadderVerdict {
  escalate: boolean;
  oldest_age: number | null;
  threshold: number;
  oldest: { id: string; age: number } | null;
}

/** Escalation ladder hangs on the OLDEST UNDISCHARGED obligation's AGE — never on content. */
export function ladderVerdict(obligations: Obligation[], threshold: number): LadderVerdict {
  const oldest = undischargedByAgeDesc(obligations)[0] ?? null;
  const oldestAge = oldest ? oldest.ticks_true : null;
  return {
    escalate: oldestAge !== null && oldestAge >= threshold,
    oldest_age: oldestAge,
    threshold,
    oldest: oldest ? { id: oldest.id, age: oldest.ticks_true } : null,
  };
}

/**
 * Round-close gate (AC5, round_cannot_close_with_undischarged = 1). A round can close iff EVERY
 * live-or-unchecked obligation (live===true or live===null) is discharged or explicitly deferred.
 * A missing reading (live===null) BLOCKS close — 缺值 = 未查, never silently absent.
 */
export function canCloseRound(obligations: Obligation[]): { canClose: boolean; blocking: Obligation[] } {
  const blocking = obligations.filter(
    (o) => (o.live === true || o.live === null) && o.discharged_at === null && !(o.defer_reason && o.unblock_condition),
  );
  return { canClose: blocking.length === 0, blocking };
}

// ── effective state (merge discharge/defer events into the latest round record) ─────────────────────

export function effectiveState(state: LedgerState): { round: number; obligations: Obligation[] } {
  const latest = state.roundRecords.length > 0 ? state.roundRecords[state.roundRecords.length - 1] : null;
  if (!latest) return { round: 0, obligations: [] };
  const obligations = latest.obligations.map((o) => ({ ...o }));
  const byId = new Map(obligations.map((o) => [o.id, o]));
  for (const ev of state.events) {
    const ob = byId.get(ev.id);
    if (!ob) continue;
    if (ev._kind === "discharge") {
      ob.discharged_at = latest.round;
      ob.discharged_by = (ev.discharged_by as string) ?? null;
      ob.defer_reason = null;
      ob.unblock_condition = null;
    } else {
      ob.defer_reason = (ev.defer_reason as string) ?? null;
      ob.unblock_condition = (ev.unblock_condition as string) ?? null;
    }
  }
  return { round: latest.round, obligations };
}

// ── report builder ───────────────────────────────────────────────────────────────────────────────────

function buildReport(
  round: number,
  obligations: Obligation[],
  threshold: number,
  missingReadings: string[],
  at: string,
): RoundRecord {
  const oldest = undischargedByAgeDesc(obligations)[0] ?? null;
  const ladder = ladderVerdict(obligations, threshold);
  const { canClose, blocking } = canCloseRound(obligations);
  const record: RoundRecord = {
    _kind: "round",
    round,
    obligations,
    oldest: oldest ? { id: oldest.id, age: oldest.ticks_true } : null,
    ladder,
    canClose,
    at,
  };
  void blocking;
  void missingReadings;
  return record;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = "true";
      }
    }
  }
  return out;
}

function loadGenerators(file: string | undefined): ObligationGenerator[] {
  if (!file) return DEFAULT_GENERATORS;
  const rows = readJsonLines(file);
  return rows.map((r) => r as unknown as ObligationGenerator);
}

function readReadings(spec: string | undefined): Reading[] {
  if (!spec || spec === "true") return [];
  let text: string;
  if (spec === "-") {
    text = fs.readFileSync(0, "utf8");
  } else {
    text = fs.readFileSync(spec, "utf8");
  }
  const rows: Reading[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const parsed = JSON.parse(line);
    if (Array.isArray(parsed)) {
      rows.push(...parsed.map((r) => ({ key: r.key, live: r.live, reading: r.reading ?? "" })));
    } else {
      rows.push({ key: parsed.key, live: parsed.live, reading: parsed.reading ?? "" });
    }
  }
  return rows;
}

function fail(msg: string): never {
  process.stderr.write(`obligation-ledger: ${msg}\n`);
  process.exit(2);
}

const USAGE = `obligation-ledger.ts — 义务台账机械化
usage:
  --report --round <N> --readings <file|-> [--generators <file>] [--age-threshold <K>] [--ledger <file>] [--lenient]
  --oldest [--ledger <file>]
  --round-close-check [--ledger <file>]
  --discharge <id> --by <who> [--reason <r>] [--ledger <file>]
  --defer <id> --reason <r> --unblock <c> [--ledger <file>]
  --schema  (print DISCHARGE_VERDICT_SCHEMA)`;

function main(argv: string[]): void {
  const args = parseArgs(argv);
  const root = args.root ?? process.cwd();
  const ledger = args.ledger ?? defaultLedgerPath(root);

  if (args.schema !== undefined) {
    process.stdout.write(JSON.stringify(DISCHARGE_VERDICT_SCHEMA, null, 2) + "\n");
    return;
  }

  if (args.discharge !== undefined || args.defer !== undefined) {
    const isDefer = args.defer !== undefined;
    const id = isDefer ? args.defer : args.discharge;
    const verdict = isDefer
      ? { id, discharged: false, defer_reason: args.reason ?? "", unblock_condition: args.unblock ?? "" }
      : { id, discharged: true, discharged_by: args.by ?? "", discharge_reason: args.reason ?? "" };
    const validation = validateDischargeVerdict(verdict);
    if (!validation.ok) {
      fail(`verdict rejected: ${validation.errors.join("; ")}`);
    }
    const at = new Date().toISOString();
    appendLine(ledger, isDefer
      ? { _kind: "defer", id, defer_reason: args.reason, unblock_condition: args.unblock, at }
      : { _kind: "discharge", id, discharged_by: args.by, discharge_reason: args.reason, at });
    process.stdout.write(JSON.stringify({ _kind: isDefer ? "defer" : "discharge", id, at, verdict: validation.verdict }) + "\n");
    return;
  }

  const state = readLedger(ledger);

  if (args.oldest !== undefined) {
    const { obligations } = effectiveState(state);
    const oldest = undischargedByAgeDesc(obligations)[0];
    if (!oldest) {
      process.stdout.write("none 0\n");
      return;
    }
    process.stdout.write(`${oldest.id} ${oldest.ticks_true}\n`);
    return;
  }

  if (args["round-close-check"] !== undefined) {
    const { obligations } = effectiveState(state);
    const { canClose, blocking } = canCloseRound(obligations);
    if (!canClose) {
      const names = blocking.map((o) => `${o.id}(live=${o.live})`).join(", ");
      process.stdout.write(`CANNOT-CLOSE: ${blocking.length} undischarged undeferred live obligation(s): ${names}\n`);
      process.exit(1);
    }
    process.stdout.write("CAN-CLOSE\n");
    return;
  }

  if (args.report !== undefined) {
    const round = Number(args.round);
    if (!Number.isInteger(round) || round < 1) fail("--report requires --round <N> (positive integer)");
    const threshold = args["age-threshold"] !== undefined ? Number(args["age-threshold"]) : 3;
    const generators = loadGenerators(args.generators);
    const readings = readReadings(args.readings);
    const history = state.roundRecords;
    const { obligations, missingReadings } = deriveObligations(generators, readings, history, round);
    const record = buildReport(round, obligations, threshold, missingReadings, new Date().toISOString());
    appendLine(ledger, record as unknown as Record<string, unknown>);
    // fail-closed: a round with live-or-unchecked undischarged obligations cannot close
    process.stdout.write(JSON.stringify(record, null, 2) + "\n");
    if (!record.canClose) process.exit(1);
    return;
  }

  process.stderr.write(USAGE + "\n");
  process.exit(2);
}

// Run the CLI only when executed directly — importing this module (tests) must not trigger main().
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main(process.argv.slice(2));
}
