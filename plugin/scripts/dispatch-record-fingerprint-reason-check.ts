// dispatch-record-fingerprint-reason-check.ts — AC55 判据1/判据3 检查器
// (tasks/gap-ac55-dispatch-record-fingerprint-reason).
//
// AC55 判据1: EVERY dispatch record must carry ① the dispatch-preference file's CONTENT FINGERPRINT
// (git blob hash — answering "用的是哪一版") AND ② a one-sentence "为什么选它" (answering "按倾向选还
// 是随便选"). SPEC §4.3 产物 is the 承重部分 (C17): without it, "读了没读" is indistinguishable in
// records ⇒ relies on willpower ⇒ WILL fail (§4.2 empirical: manager's `A0b⑤(b)` was skipped 4
// consecutive rounds because nothing consumed the artifact afterward).
//
// AC55 判据3 (falsifiable, negative control): take a REAL dispatch record and replay it — missing
// fingerprint OR missing reason MUST go RED. A checker that has never gone red on a real record
// missing fingerprint/reason doesn't count. The negative control is produced by the implementer
// (AC49 判据1 D2 attribution): plugin/test/dispatch-record-fingerprint-reason-check.test.mjs +
// plugin/scripts/checker-mutation-cases/dispatch-record-fingerprint-reason-check.sh.
//
// SPEC §7 (verbatim): inner does NOT explain every "不选" — only WHAT was chosen. This checker
// therefore judges ONLY the record of what was dispatched; there is no per-non-choice reason to
// demand.
//
// Per-record judgment:
//   taskId               present (non-empty)                    — else RED (taskId-missing)
//   preferenceFingerprint present AND 40-hex (a real content hash) — else RED
//                                                                (fingerprint-missing | fingerprint-invalid)
//   reason               present AND ≥ MIN_REASON_CHARS           — else RED (reason-missing | reason-too-thin)
// A record that fails ANY judged field is RED; ANY red record ⇒ exit 1 (the whole round flags).
// An ABSENT record file / zero records ⇒ PASS (nothing dispatched ⇒ nothing to verify). A record
// whose fingerprint is null (the writer failed to compute one) is RED — a dispatch recorded
// without a valid tendency reference is exactly the "哪一版不可核" shape the product exists to catch.
//
// A CHECKER, not a writer: it never writes the record file. The write point is
// plugin/scripts/dispatch-record.ts (fail-closed on a missing/thin reason).
//
// Run:
//   node --experimental-strip-types plugin/scripts/dispatch-record-fingerprint-reason-check.ts [--root <dir>] [--json]
//   node --experimental-strip-types plugin/scripts/dispatch-record-fingerprint-reason-check.ts --file <path> [--json]
//     (--file: check an explicit sample — used by the negative-control fixtures)
// exit 0 = every record carries fingerprint + reason (or no records); exit 1 = any missing/invalid.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  RECORD_FILE_REL,
  MIN_REASON_CHARS,
  FINGERPRINT_RE,
  reasonIsSubstantive,
  type DispatchRecord,
} from "./dispatch-record.ts";

// 数据基线（2026-08-16，manager 裁定「writer 漏出 2 条，按 pre-existing 放行，不立案」）：字段 08-14
// df9ce806 已落地 + writer fail-closed，但 08-15 仍有 2 条记录被写出缺 fingerprint——成因未查（发生率 2，
// 不在本阶段面）。gap-ac84 已 backfill（preferenceFile 存在，指纹 e4881984... 可复算）；DIR-103-B 无
// preferenceFile 引用（outer dispatch 路径未记录倾向文件），无法可靠 backfill ⇒ 记数据基线豁免。
// 前向不追溯（AC66 判据1 同族）：只豁免历史已知记录，不削弱未来任何记录的 fingerprint 要求。
const LEGACY_NO_FINGERPRINT_TASK_IDS: ReadonlySet<string> = new Set(["DIR-103-B"]);

export interface RecordVerdict {
  line: number;
  taskId: string | undefined;
  ok: boolean;
  why: "ok" | "unparseable" | "taskId-missing" | "fingerprint-missing" | "fingerprint-invalid" | "reason-missing" | "reason-too-thin";
}

export interface DispatchRecordCheckResult {
  ok: boolean;
  fileExists: boolean;
  filePath: string;
  records: RecordVerdict[];
  problems: string[];
}

/** Judge ONE parsed record against the AC55 trio. Pure — no I/O. A record is ok only when
 *  taskId is present AND fingerprint is present+40-hex AND reason is substantive. */
export function validateRecord(record: DispatchRecord): { ok: boolean; why: RecordVerdict["why"] } {
  if (!record || typeof record !== "object") return { ok: false, why: "unparseable" };
  if (typeof record.taskId !== "string" || record.taskId.trim() === "") return { ok: false, why: "taskId-missing" };
  // 数据基线豁免（LEGACY_NO_FINGERPRINT_TASK_IDS）：历史已知缺 fingerprint 记录前向不追溯。
  const legacyExempt = LEGACY_NO_FINGERPRINT_TASK_IDS.has(record.taskId);
  if (!legacyExempt) {
    if (record.preferenceFingerprint === null || record.preferenceFingerprint === undefined) return { ok: false, why: "fingerprint-missing" };
    if (typeof record.preferenceFingerprint !== "string" || !FINGERPRINT_RE.test(record.preferenceFingerprint.trim())) {
      return { ok: false, why: "fingerprint-invalid" };
    }
  }
  if (!reasonIsSubstantive(record.reason)) return { ok: false, why: "reason-too-thin" };
  return { ok: true, why: "ok" };
}

/** Judge every line of a record-file text. Pure — no I/O. Any unparseable line or any record
 *  failing the AC55 trio ⇒ ok:false with the problems enumerated. */
export function checkRecordText(text: string, filePath: string): DispatchRecordCheckResult {
  const records: RecordVerdict[] = [];
  const problems: string[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let parsed: DispatchRecord;
    try {
      parsed = JSON.parse(line);
    } catch {
      records.push({ line: i + 1, taskId: undefined, ok: false, why: "unparseable" });
      problems.push(`line ${i + 1}: unparseable JSON`);
      continue;
    }
    const v = validateRecord(parsed);
    records.push({ line: i + 1, taskId: parsed?.taskId, ok: v.ok, why: v.why });
    if (!v.ok) {
      const label = parsed?.taskId ?? `line ${i + 1}`;
      problems.push(`line ${i + 1} (${label}): ${v.why}`);
    }
  }
  return { ok: problems.length === 0, fileExists: true, filePath, records, problems };
}

/** Resolve the record-file path: --file wins; otherwise <root>/orchestration/dispatch-record.jsonl. */
export function resolveRecordPath(root: string, fileOverride?: string): string {
  if (fileOverride) return path.resolve(root, fileOverride);
  return path.join(root, RECORD_FILE_REL);
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────

export function main(argv: string[]): number {
  let root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  let fileOverride: string | undefined;
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") {
      root = path.resolve(argv[++i] ?? ".");
    } else if (a === "--file") {
      fileOverride = argv[++i];
    } else if (a === "--json") {
      json = true;
    } else if (a === "--help" || a === "-h") {
      console.log(
        "dispatch-record-fingerprint-reason-check — AC55 派发记录 指纹+理由 检查\n" +
          "  --root <dir>    repo root (default: script dir ../..)\n" +
          "  --file <path>   explicit sample path (negative-control fixtures; overrides root)\n" +
          "  --json          machine-readable output\n" +
          "exit 0 = every record carries fingerprint + reason (or no records); exit 1 = any missing/invalid (RED)",
      );
      return 0;
    } else {
      console.error(`dispatch-record-fingerprint-reason-check: unknown argument: ${a}`);
      return 2;
    }
  }

  const filePath = resolveRecordPath(root, fileOverride);
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    // Absent record file = no dispatches recorded = nothing to verify (PASS).
    const result: DispatchRecordCheckResult = {
      ok: true,
      fileExists: false,
      filePath,
      records: [],
      problems: [],
    };
    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`PASS: no dispatch-record file at ${filePath} — no dispatches recorded, nothing to verify`);
    }
    return 0;
  }

  const result = checkRecordText(text, filePath);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(`PASS: ${result.records.length} dispatch record(s) — every one carries fingerprint + reason (${filePath})`);
  } else {
    console.error(`RED: ${result.problems.length} dispatch record problem(s) (${filePath})`);
    for (const p of result.problems) console.error(`  - ${p}`);
  }
  return result.ok ? 0 : 1;
}

// Direct entry guard (gate-script-base convention): run main() only when this module is the entry point.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
