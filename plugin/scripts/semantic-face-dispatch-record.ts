// @instrument "Does each semantic-face duty (task authoring / requirements analysis / escalation / learning / AC65 quick-fix / B16-C conflict intent / B18 stop-loss / cross-layer correction) the manager performs carry a queryable dispatch record — and does the writer fail closed on a missing/invalid duty kind or a thin reason?"
// semantic-face-dispatch-record.ts — AC145 语义面 subagent 派发记录 WRITER + 查询面
// (tasks/gap-ac145-semantic-face-subagent-manager-driven, AC2).
//
// 这些职责结构上不能是 driver —— driver 读不出「听起来自洽但错了」的因果故事，所以由 manager
// 派【后台 subagent】执行（AC1，非主线程直接做）。本条是 AC2 的写入点 + 查询面：每类语义职责的
// 一次派发必须留一条可查记录，同 A16b `dispatch-record.ts` 的形态——gitignored 的 jsonl 运行时
// 遥测、写入方 fail-closed、记录可读回（「每类职责有可查派发记录」）。
//
// 与 A16b `dispatch-record.ts` 的分工（不是重造，是另一个对象）：
//   A16b 记录的是【任务派发】——倾向文件指纹 + 一句「为什么选它」（SPEC §4.3 产物，回答「读了
//     没读」）；本文件记录的是【语义职责的 subagent 派发】——职责类别（dutyKind）+ 一句「这轮
//     语义 subagent 产出/判断什么」。语义职责不经 dispatch-preference 的「先派谁」选择，故不带
//     倾向文件指纹；它带的是【职责类别】这个 A16b 没有的维度（AC2「每类职责」要求按类别可查）。
//
// 八类语义职责（closed enum，唯一真相源；文档引用的正本 = SEMANTIC_DUTY_KINDS）：
//   task-authoring            任务撰写/立案
//   requirements-analysis     需求分析
//   escalation-judgment       升级判断（B11）
//   learning                  学习（B10，证据推翻原判断时改目标/方法）
//   ac65-quickfix             AC65 快修判断
//   b16c-conflict-intent      B16-C 类冲突意图
//   b18-stop-loss             B18 止损
//   cross-layer-correction    跨层纠错（单列，本会话三实证：outer 自诊断错 / manager 过度声称 /
//                             manager 过早归因——全部由另一层读散文发现）
//
// FAIL-CLOSED REASON（AC53「结构性闸」形状，同 A16b writer）：写入方在【职责类别】非法（不在
// 八类 closed enum 内）或【理由】缺失/过薄（< MIN_REASON_CHARS）时 exit 1 且不写——一条无类别或
// 无理由的语义派发记录结构上被挡在写点，畸形记录不会进入文件。taskId 可缺（多数语义职责不产
// 生任务；任务撰写/立案会产生一个 task id，故作为可选上下文）。
//
// 查询面（AC2「可查」）：`--list` 读回记录，支持 `--kind <kind>` 按职责类别过滤、`--since <ISO>`
// 按时刻过滤、`--json` 机读输出。「发生一次语义产出而无对应派发记录 ⇒ 假」这一取假判据可机械核：
// 对某类职责跑 `--list --kind <kind>` 得 0 条而该职责当轮确有产出，即无记录。
//
// Run:
//   node --experimental-strip-types plugin/scripts/semantic-face-dispatch-record.ts --add --kind <kind> --reason "<why>" [--task-id <id>] [--root <dir>]
//   node --experimental-strip-types plugin/scripts/semantic-face-dispatch-record.ts --list [--kind <kind>] [--since <ISO>] [--json] [--root <dir>]
// Exit: 0 = appended / listed; 1 = fail-closed (invalid kind / missing-or-thin reason); 2 = usage.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectEntry } from "./gate-script-base.ts";

/** The semantic-face dispatch-record file's repo-relative path (gitignored runtime log, sibling of
 *  orchestration/dispatch-record.jsonl — same family: runtime telemetry, not code). */
export const SEMANTIC_FACE_RECORD_FILE_REL = "orchestration/semantic-face-dispatch-record.jsonl";

/** The eight semantic duties (closed enum — the single source of truth for「每类职责」). Any record
 *  whose dutyKind is not in this list is rejected at the write point. */
export const SEMANTIC_DUTY_KINDS = [
  "task-authoring",
  "requirements-analysis",
  "escalation-judgment",
  "learning",
  "ac65-quickfix",
  "b16c-conflict-intent",
  "b18-stop-loss",
  "cross-layer-correction",
] as const;

export type SemanticDutyKind = (typeof SEMANTIC_DUTY_KINDS)[number];

/** Human label per duty kind (display only — the enum slugs are the machine identifiers). */
export const SEMANTIC_DUTY_LABELS: Readonly<Record<SemanticDutyKind, string>> = {
  "task-authoring": "任务撰写/立案",
  "requirements-analysis": "需求分析",
  "escalation-judgment": "升级判断（B11）",
  "learning": "学习（B10）",
  "ac65-quickfix": "AC65 快修判断",
  "b16c-conflict-intent": "B16-C 类冲突意图",
  "b18-stop-loss": "B18 止损",
  "cross-layer-correction": "跨层纠错",
};

/** A reason below this many non-whitespace chars is treated as ABSENT (empty/placeholder — the
 *  empty-vs-absent conflation would let a "随便" placeholder slip through). Mirrors dispatch-record.ts's
 *  MIN_REASON_CHARS; kept local so this mechanism does not silently couple to A16b's. */
export const MIN_REASON_CHARS = 8;

/** True when `kind` is one of the eight semantic duties (the write-point gate). */
export function isSemanticDutyKind(kind: unknown): kind is SemanticDutyKind {
  return typeof kind === "string" && (SEMANTIC_DUTY_KINDS as readonly string[]).includes(kind);
}

/** A reason is present only when it has ≥ MIN_REASON_CHARS non-whitespace chars (same empty-vs-absent
 *  guard as A16b dispatch-record.ts). */
export function reasonIsSubstantive(reason: unknown): boolean {
  return typeof reason === "string" && reason.replace(/\s+/g, "").length >= MIN_REASON_CHARS;
}

/** Shape of one semantic-face dispatch-record line. All fields informational except the judged pair
 *  (dutyKind / reason). taskId is optional context — most semantic duties produce no task; task
 *  authoring/立案 produces one. */
export interface SemanticFaceDispatchRecord {
  ts: string;
  dutyKind: SemanticDutyKind;
  taskId: string | null;
  reason: string;
}

/** Build one semantic-face dispatch-record object (pure — no I/O). `ts` defaults to the current ISO
 *  time; `taskId` defaults to null. */
export function makeSemanticFaceRecord({
  dutyKind,
  reason,
  taskId = null,
  ts = new Date().toISOString(),
}: {
  dutyKind: SemanticDutyKind;
  reason: string;
  taskId?: string | null;
  ts?: string;
}): SemanticFaceDispatchRecord {
  return { ts, dutyKind, taskId, reason };
}

/** Resolve the record-file path: <root>/orchestration/semantic-face-dispatch-record.jsonl. */
export function resolveSemanticFaceRecordPath(root: string): string {
  return path.join(root, SEMANTIC_FACE_RECORD_FILE_REL);
}

/** Append ONE record to <root>/orchestration/semantic-face-dispatch-record.jsonl (creating the dir/file
 *  as needed). JSONL append is atomic-ish per line (appendFileSync). */
export function appendSemanticFaceRecord(root: string, record: SemanticFaceDispatchRecord): string {
  const file = resolveSemanticFaceRecordPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(record) + "\n", "utf8");
  return file;
}

/** Read back records (the query surface — AC2「可查」). Tolerant: unparseable lines are skipped, not
 *  fatal (a malformed line must not make the whole list unreadable). */
export function listSemanticFaceRecords(
  root: string,
  { kind, since }: { kind?: string; since?: string } = {},
): SemanticFaceDispatchRecord[] {
  const file = resolveSemanticFaceRecordPath(root);
  if (!fs.existsSync(file)) return [];
  const sinceMs = since ? Date.parse(since) : NaN;
  const out: SemanticFaceDispatchRecord[] = [];
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: SemanticFaceDispatchRecord;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    if (kind !== undefined && parsed.dutyKind !== kind) continue;
    if (sinceMs && !Number.isNaN(sinceMs)) {
      const ts = typeof parsed.ts === "string" ? Date.parse(parsed.ts) : NaN;
      if (!Number.isFinite(ts) || ts < sinceMs) continue;
    }
    out.push(parsed);
  }
  return out;
}

export function main(argv: string[]): number {
  let root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  let kind: string | undefined;
  let reason: string | undefined;
  let taskId: string | undefined;
  let since: string | undefined;
  let add = false;
  let list = false;
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") {
      root = path.resolve(argv[++i] ?? ".");
    } else if (a === "--add") {
      add = true;
    } else if (a === "--list") {
      list = true;
    } else if (a === "--kind") {
      kind = argv[++i];
    } else if (a === "--reason") {
      reason = argv[++i];
    } else if (a === "--task-id") {
      taskId = argv[++i];
    } else if (a === "--since") {
      since = argv[++i];
    } else if (a === "--json") {
      json = true;
    } else if (a === "--help" || a === "-h") {
      console.log(
        "semantic-face-dispatch-record — AC145 语义面 subagent 派发记录（职责类别 + 一句理由）\n" +
          "  写入：  --add --kind <八类职责之一> --reason \"<一句产出/判断什么>\" [--task-id <id>] [--root <dir>]\n" +
          "  查询：  --list [--kind <kind>] [--since <ISO>] [--json] [--root <dir>]\n" +
          "八类职责：" + SEMANTIC_DUTY_KINDS.join(" | ") + "\n" +
          "exit 0 = appended / listed; exit 1 = fail-closed (invalid kind / missing-or-thin reason); exit 2 = usage",
      );
      return 0;
    } else {
      console.error(`semantic-face-dispatch-record: unknown argument: ${a}`);
      return 2;
    }
  }

  // ── query surface ─────────────────────────────────────────────────────────────────────────────
  if (list) {
    if (!kind && !json) {
      // human list — enumerate kinds so a zero-count is visible, not collapsed (hard rule 3).
      const all = listSemanticFaceRecords(root, { kind: undefined, since });
      if (all.length === 0) {
        console.log(`semantic-face-dispatch-record: 0 records at ${resolveSemanticFaceRecordPath(root)}`);
        return 0;
      }
      for (const r of all) {
        const label = SEMANTIC_DUTY_LABELS[r.dutyKind] ?? r.dutyKind;
        const task = r.taskId ? ` taskId=${r.taskId}` : "";
        console.log(`${r.ts} ${r.dutyKind}(${label})${task} — ${r.reason}`);
      }
      return 0;
    }
    const records = listSemanticFaceRecords(root, { kind, since });
    if (json) {
      console.log(JSON.stringify(records, null, 2));
    } else {
      if (records.length === 0) {
        console.log(`semantic-face-dispatch-record: 0 records${kind ? ` (kind=${kind})` : ""} at ${resolveSemanticFaceRecordPath(root)}`);
      } else {
        for (const r of records) {
          const label = SEMANTIC_DUTY_LABELS[r.dutyKind] ?? r.dutyKind;
          const task = r.taskId ? ` taskId=${r.taskId}` : "";
          console.log(`${r.ts} ${r.dutyKind}(${label})${task} — ${r.reason}`);
        }
      }
    }
    return 0;
  }

  // ── write point ───────────────────────────────────────────────────────────────────────────────
  if (!add) {
    console.error("semantic-face-dispatch-record: missing --add (this is the dispatch-record WRITER) or --list (the query surface)");
    return 2;
  }
  if (!isSemanticDutyKind(kind)) {
    // FAIL-CLOSED (AC53 structural-gate shape): a dispatch whose dutyKind is not one of the eight
    // semantic duties is structurally blocked at the write point — an unclassifiable semantic
    // dispatch is exactly the「每类职责可查」shape this product exists to prevent.
    console.error(
      `RED: semantic-face-dispatch-record fail-closed — --kind is missing or not one of the eight semantic duties. ` +
        `Valid kinds: ${SEMANTIC_DUTY_KINDS.join(", ")}.`,
    );
    return 1;
  }
  if (!reasonIsSubstantive(reason)) {
    // FAIL-CLOSED (AC53 structural-gate shape): a dispatch without a substantive reason is never
    // recorded — recording a reason-less semantic dispatch would manufacture the very「有产出而
    // 无记录」evidence the record exists to prevent.
    console.error(
      `RED: semantic-face-dispatch-record fail-closed — --reason is missing or below ${MIN_REASON_CHARS} non-whitespace chars. ` +
        "A semantic dispatch record must carry a one-sentence 产出/判断什么.",
    );
    return 1;
  }

  const record = makeSemanticFaceRecord({
    dutyKind: kind as SemanticDutyKind,
    reason: reason!.trim(),
    taskId: taskId && taskId.trim() ? taskId.trim() : null,
  });
  const file = appendSemanticFaceRecord(root, record);
  console.log(
    `PASS: semantic-face dispatch record appended (dutyKind=${record.dutyKind}, taskId=${record.taskId ?? "null"}, file=${file})`,
  );
  return 0;
}

// Direct entry guard (gate-script-base convention): run main() only when this module is the entry point.
if (isDirectEntry(import.meta, undefined, "semantic-face-dispatch-record")) {
  process.exitCode = main(process.argv.slice(2));
}
