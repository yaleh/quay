// ac69-slot-queue-gap-check.ts — AC69 槽满排队「先量再改」测量记录检查器
// (tasks/gap-ac69-suite-slot-full-should-queue-not-wait, AC1 + DoD).
//
// 回答的问题（@instrument）：「AC69 的槽释放→下次派发差值测量记录是否已落地且结论明确？」
//
// AC1 判据（先量再改，verbatim）：槽释放→下次派发的差已测（现成量，零新机制），结论支撑改法或维持。
// DoD（verbatim）：槽释放→下次派发差值已实测（/proc/locks 或 suite 终态写入时刻，零新机制），
//   结论支撑改法或维持。
//
// 本检查器验证的是【测量记录本身】（docs/analysis/ac69-slot-release-vs-dispatch-gap.json）：
// 记录存在、结构完整（task/measuredAt/dataSource/method/stats.medianSeconds/conclusion/
// conclusionReason 全在）、conclusion ∈ {maintain, change}。记录缺席或字段缺失 ⇒ 「未评估」，
// 与「查过且合格」用不同退出码区分（硬规则 3b：读不懂输入不得返回与合格同形的值）。
//
// 它【不重新计算】活数据：verification-round.jsonl 在 .quay/（gitignored），任务 worktree 的
// .quay/ 是副本；对已提交记录做结构校验在任何检出都成立。重新测量是文档化的手工分析
// （见记录 dataSource/method），不在此检查器内重复——避免硬规则 4 的「派生/过滤量」失真。
//
// 退出码（fail-closed 语义只落在「记录缺席/损坏」上，不替人重新判测量结论）：
//   0 = 记录存在且结构完整（查过且合格）
//   2 = 记录缺席（无法评估——与合格区分，硬规则 3b）
//   3 = 记录存在但损坏/缺字段（无法评估——与合格区分，硬规则 3b）
//
// Run:
//   node --no-warnings --experimental-strip-types plugin/scripts/ac69-slot-queue-gap-check.ts
//       [--root <repo>] [--record <path>] [--json]
//   --record <path>  覆盖记录路径（fixture 接缝，测试用）
//   --json           机器可读输出 {ok, reason, code, fields}
//   （scoped/full 经 run_static_checks 的 run_checker 包装调用）

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { helpExit } from "./gate-script-base.ts";

/** The committed measurement record (relative to repo root). */
export const RECORD_REL = "docs/analysis/ac69-slot-release-vs-dispatch-gap.json";

/** Required top-level fields — a record missing any of these is NOT a valid AC69 measurement. */
export const REQUIRED_FIELDS = [
  "task",
  "measuredAt",
  "dataSource",
  "method",
  "stats",
  "conclusion",
  "conclusionReason",
] as const;

/** conclusion must be one of these — the record must state whether to change or maintain. */
export const VALID_CONCLUSIONS = ["maintain", "change"] as const;

/** Sentinel exit codes — distinct from 0 (合格) per 硬规则 3b. */
export const EXIT_NOT_FOUND = 2;
export const EXIT_MALFORMED = 3;

export interface RecordSummary {
  ok: boolean;
  code: number;
  reason: string;
  fields: Record<string, unknown>;
}

/** True iff the record's stats block has a finite numeric medianSeconds. */
export function hasFiniteMedian(stats: unknown): boolean {
  if (typeof stats !== "object" || stats === null) return false;
  const m = (stats as Record<string, unknown>).medianSeconds;
  return typeof m === "number" && Number.isFinite(m);
}

/** Validate a parsed record; returns the validation verdict. Pure (no IO). */
export function validateRecord(rec: unknown): { ok: boolean; reason: string; missing: string[] } {
  if (typeof rec !== "object" || rec === null) {
    return { ok: false, reason: "record is not a JSON object", missing: [] };
  }
  const r = rec as Record<string, unknown>;
  const missing = REQUIRED_FIELDS.filter((f) => r[f] === undefined || r[f] === null);
  if (missing.length > 0) {
    return { ok: false, reason: `missing required field(s): ${missing.join(", ")}`, missing };
  }
  if (!hasFiniteMedian(r.stats)) {
    return { ok: false, reason: "stats.medianSeconds is missing or not a finite number", missing: ["stats.medianSeconds"] };
  }
  const concl = r.conclusion;
  if (typeof concl !== "string" || !(VALID_CONCLUSIONS as readonly string[]).includes(concl)) {
    return { ok: false, reason: `conclusion must be one of ${VALID_CONCLUSIONS.join("|")}, got ${JSON.stringify(concl)}`, missing: ["conclusion"] };
  }
  if (typeof r.conclusionReason !== "string" || r.conclusionReason.trim().length < 10) {
    return { ok: false, reason: "conclusionReason must be a non-trivial string", missing: ["conclusionReason"] };
  }
  return { ok: true, reason: "measurement record present and structurally complete", missing: [] };
}

/** Read + validate the record file. Pure-ish: does the filesystem read. */
export function checkRecord(recordPath: string): RecordSummary {
  let raw: string;
  try {
    raw = fs.readFileSync(recordPath, "utf8");
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      return { ok: false, code: EXIT_NOT_FOUND, reason: `measurement record NOT FOUND: ${recordPath}`, fields: {} };
    }
    return { ok: false, code: EXIT_MALFORMED, reason: `record unreadable: ${e.message}`, fields: {} };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, code: EXIT_MALFORMED, reason: `record is not valid JSON: ${recordPath}`, fields: {} };
  }
  const verdict = validateRecord(parsed);
  if (!verdict.ok) {
    return { ok: false, code: EXIT_MALFORMED, reason: verdict.reason, fields: {} };
  }
  const r = parsed as Record<string, unknown>;
  const fields = {
    task: r.task,
    measuredAt: r.measuredAt,
    conclusion: r.conclusion,
    medianSeconds: (r.stats as Record<string, unknown>).medianSeconds,
  };
  return { ok: true, code: 0, reason: verdict.reason, fields };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { root: string; record: string; json: boolean } {
  let root = process.cwd();
  let record = "";
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") root = argv[++i] ?? root;
    else if (a === "--record") record = argv[++i] ?? record;
    else if (a === "--json") json = true;
  }
  if (!record) {
    const base = path.resolve(root);
    record = path.join(base, RECORD_REL);
  }
  return { root, record, json };
}

// Import.meta guard: only run the CLI when executed directly (not when imported by the test).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit("usage: node ac69-slot-queue-gap-check.ts [--root <dir>] [--record <file>] [--json]");
  const { root, record, json } = parseArgs(args);
  const result = checkRecord(record);
  if (json) {
    process.stdout.write(JSON.stringify({ ok: result.ok, reason: result.reason, code: result.code, fields: result.fields, root }) + "\n");
  } else {
    const tag = result.ok ? "PASS" : result.code === EXIT_NOT_FOUND ? "NOT-EVALUATED (record absent)" : "NOT-EVALUATED (malformed)";
    process.stdout.write(`ac69-slot-queue-gap-check: ${tag} — ${result.reason}\n`);
    if (result.ok) {
      const f = result.fields as Record<string, unknown>;
      process.stdout.write(`  task=${f.task} measuredAt=${f.measuredAt} conclusion=${f.conclusion} medianSeconds=${f.medianSeconds}\n`);
    }
  }
  process.exit(result.code);
}
