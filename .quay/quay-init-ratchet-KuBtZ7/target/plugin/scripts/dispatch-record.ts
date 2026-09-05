// dispatch-record.ts — AC55 产物·承重条款 WRITER (tasks/gap-ac55-dispatch-record-fingerprint-reason).
//
// The dispatch record is inner's COMPLIANCE PRODUCT — the 承重 part of
// SPEC-dispatch-ordering-semantic-2026-08-13 §4.3 (C17). Each dispatch inner performs MUST carry:
//   ① the dispatch-preference file's CONTENT FINGERPRINT (git blob hash — answering "用的是哪一版")
//   ② a ONE-SENTENCE "为什么选它" (answering "按倾向选还是随便选")
// without which "读了没读" is indistinguishable in records and the whole design relies on
// willpower (AC55 判据2 — SPEC §4.2 empirically: manager's `A0b⑤(b)` was skipped 4 consecutive
// rounds because nothing consumed its artifact afterward). AC55 判据1.
//
// This script is the WRITE POINT: inner calls it at the dispatch moment (before --task-start /
// Agent spawn, same tick step as A16). It appends ONE jsonl line to
// <root>/orchestration/dispatch-record.jsonl — a GITIGNORED runtime log (same family as
// orchestration/tick-log.md: runtime telemetry, not code), sitting next to the git-visible
// preference file whose consumption it proves.
//
// FAIL-CLOSED REASON (AC53 "结构性闸" shape): the writer REFUSES (exit 1) to record a dispatch
// whose reason is missing or below MIN_REASON_CHARS — a reason-less dispatch is structurally
// blocked at the write point, so a malformed record never enters the file in the first place.
// The fingerprint is computed from the preference file via `git hash-object` (the AC54-stated
// source). If the fingerprint CANNOT be computed (preference file absent / git unavailable), the
// record is STILL appended with preferenceFingerprint:null — the INDEPENDENT checker
// (dispatch-record-fingerprint-reason-check.ts) REDs on that record, so a dispatch recorded
// without a valid tendency reference is caught, never silently written.
//
// SPEC §7 (verbatim): inner does NOT explain every "不选" — only WHAT was chosen. This writer
// therefore requires ONE reason for the task being dispatched; there is no per-non-choice reason.
//
// Run:
//   node --experimental-strip-types plugin/scripts/dispatch-record.ts --add --task-id <id> --reason "<why>" [--root <dir>]
// Exit: 0 = appended; 1 = reason missing/thin (fail-closed, nothing written); 2 = usage.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isDirectEntry } from "./gate-script-base.ts";
// Single source for the preference file path — reuse, never a parallel copy (hard rule 1).
import { PREFERENCE_FILE_REL } from "./dispatch-preference-check.ts";

/** The dispatch-record file's repo-relative path (gitignored runtime log, sibling of the
 *  preference file). */
export const RECORD_FILE_REL = "orchestration/dispatch-record.jsonl";

/** A reason below this many non-whitespace chars is treated as ABSENT (empty/placeholder — the
 *  empty-vs-absent conflation would let a "随便" placeholder slip through). A one-sentence
 *  "为什么选它" is a real clause; a placeholder like "随便"/"无"/"x" is not. */
export const MIN_REASON_CHARS = 8;

/** 40-hex git blob hash (sha1) — the fingerprint FORMAT the checker accepts. `git hash-object`
 *  output is always this shape. */
export const FINGERPRINT_RE = /^[0-9a-f]{40}$/i;

/** Compute the dispatch-preference file's content fingerprint: `git hash-object` (the AC54-stated
 *  source — a content hash, so it captures the exact on-disk version inner read at dispatch time
 *  whether or not that version is committed). Works outside a git repo (hash-object hashes the
 *  file content alone, no -w). Returns null on ANY failure (file absent / git unavailable) — the
 *  checker REDs on a null fingerprint, so a dispatch without a valid tendency reference is caught. */
export function computePreferenceFingerprint(root: string): string | null {
  const prefPath = path.join(root, PREFERENCE_FILE_REL);
  if (!fs.existsSync(prefPath)) return null;
  try {
    const out = execFileSync("git", ["hash-object", PREFERENCE_FILE_REL], {
      cwd: root, encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"],
    });
    const hash = out.trim();
    return FINGERPRINT_RE.test(hash) ? hash : null;
  } catch {
    return null;
  }
}

/** Shape of one dispatch-record line. All fields informational except the judged trio
 *  (taskId / preferenceFingerprint / reason) — see dispatch-record-fingerprint-reason-check.ts. */
export interface DispatchRecord {
  ts: string;
  taskId: string;
  preferenceFile: string;
  preferenceFingerprint: string | null;
  reason: string;
}

/** Build one dispatch-record object (pure — no I/O). `ts` defaults to the current ISO time. */
export function makeRecord({
  taskId,
  reason,
  fingerprint,
  ts = new Date().toISOString(),
  preferenceFile = PREFERENCE_FILE_REL,
}: {
  taskId: string;
  reason: string;
  fingerprint: string | null;
  ts?: string;
  preferenceFile?: string;
}): DispatchRecord {
  return { ts, taskId, preferenceFile, preferenceFingerprint: fingerprint, reason };
}

/** A reason is present only when it has ≥ MIN_REASON_CHARS non-whitespace chars (the empty-vs-absent
 *  conflation guard — same as dispatch-preference-check's SECTION_MIN_CONTENT_CHARS). */
export function reasonIsSubstantive(reason: unknown): boolean {
  return typeof reason === "string" && reason.replace(/\s+/g, "").length >= MIN_REASON_CHARS;
}

/** Append ONE record to <root>/orchestration/dispatch-record.jsonl (creating the dir/file as
 *  needed). Pure-ish I/O; the JSONL append is atomic-ish per line (appendFileSync). */
export function appendRecord(root: string, record: DispatchRecord): string {
  const file = path.join(root, RECORD_FILE_REL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(record) + "\n", "utf8");
  return file;
}

export function main(argv: string[]): number {
  let root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  let taskId: string | undefined;
  let reason: string | undefined;
  let add = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") {
      root = path.resolve(argv[++i] ?? ".");
    } else if (a === "--add") {
      add = true;
    } else if (a === "--task-id") {
      taskId = argv[++i];
    } else if (a === "--reason") {
      reason = argv[++i];
    } else if (a === "--help" || a === "-h") {
      console.log(
        "dispatch-record — AC55 派发记录写入点（指纹 + 一句理由）\n" +
          "  --add --task-id <id> --reason \"<一句为什么选它>\" [--root <dir>]\n" +
          "exit 0 = appended; exit 1 = reason missing/thin (fail-closed); exit 2 = usage",
      );
      return 0;
    } else {
      console.error(`dispatch-record: unknown argument: ${a}`);
      return 2;
    }
  }

  if (!add) {
    console.error("dispatch-record: missing --add (this is the dispatch-record WRITER)");
    return 2;
  }
  if (!taskId || !taskId.trim()) {
    console.error("dispatch-record: --task-id is required");
    return 2;
  }
  if (!reasonIsSubstantive(reason)) {
    // FAIL-CLOSED (AC53 structural-gate shape): a dispatch without a substantive reason is never
    // recorded. The record is the C17 product — recording a reason-less dispatch would manufacture
    // the very "读了没读 indistinguishable" evidence the product exists to prevent.
    console.error(
      `RED: dispatch-record fail-closed — --reason is missing or below ${MIN_REASON_CHARS} non-whitespace chars. ` +
        "A dispatch record must carry a one-sentence 为什么选它 (SPEC §7: only WHAT was chosen, no per-non-choice reason).",
    );
    return 1;
  }

  const fingerprint = computePreferenceFingerprint(root);
  if (fingerprint === null) {
    console.error(
      `dispatch-record: WARNING — could not fingerprint ${PREFERENCE_FILE_REL} at ${root} ` +
        "(file absent or git unavailable); record appended with preferenceFingerprint:null and the " +
        "dispatch-record-fingerprint-reason-check will go RED on it.",
    );
  }
  const record = makeRecord({ taskId: taskId.trim(), reason: reason!.trim(), fingerprint });
  const file = appendRecord(root, record);
  console.log(
    `PASS: dispatch record appended (taskId=${record.taskId}, fingerprint=${record.preferenceFingerprint ?? "null"}, file=${file})`,
  );
  return 0;
}

// Direct entry guard (gate-script-base convention): run main() only when this module is the entry point.
if (isDirectEntry(import.meta, undefined, "dispatch-record")) {
  process.exitCode = main(process.argv.slice(2));
}
