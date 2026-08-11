#!/usr/bin/env node
// transcript-delivery-check.ts — PURE delivery-verdict function for the reliable-send procedure
// (tasks/gap-reliable-send-crystallize-the-five-failure-modes-into-a-script).
//
// Fault mode 5 (orchestration/CRYSTALLIZED-reliable-send-2026-08-04): three "looks delivered"
// signals are all proven unreliable — (a) the old whole-pane hash exit-0, (b) the input box
// showing empty, (c) a SESSION-RESUMED monitor event. The ONLY trusted signal is the target
// session's OWN transcript jsonl containing a REAL user message whose content matches the sent
// text. This module is exactly that check, as a PURE function:
//
//   checkTranscriptDelivered(transcriptFragment, sentText) -> { delivered, matchedLine }
//
// Pure: no side effects, never spawns tmux/pty, never builds a fake TUI, never reads anything
// but the string it is given (AC4 — "不读文件以外的源"). The FILE reading lives in the CLI
// wrapper below, which hands the module a string. ADR-016 Amendment boundary (c): this is a
// semantic content check, NOT md5(capture-pane) / whole-screen equality — the hash family F
// ruled dead stays dead (AC7: the script/test files contain zero md5sum|sha1sum|cksum).
//
// What counts as a delivered message — THREE-STATE verdict (人 06:1x direction,
// gap-send-keys-reliable-false-fail-on-long-text-paste):
//   DELIVERED — the sent text appears in a MATERIALIZED form:
//     - a real USER message (`type === "user"` AND `message.role === "user"`), string or text
//       blocks (a user message whose content array holds ONLY tool_result/tool_use blocks is
//       injected context, NOT typed input — fault 5's "real user message"); OR
//     - an `type === "attachment"` record whose `attachment.prompt`/`content` carries the text
//       and `isSidechain !== true` — the form a long-text/paste delivery ACTUALLY lands as
//       (manager's 05:39/05:54 samples: ZERO type=user pure-string records, only
//       queue-operation + attachment).
//   FAILED — the sent text appears ONLY in a `type === "queue-operation"` `operation === "remove"`
//     record (enqueued then removed without ever being materialized) — the measured discard
//     signature (busy session: enqueue then ~3s remove, never materialized).
//   UNKNOWN — no evidence either way (nothing matches, or only an enqueue still pending).
//     The third state is NOT a bare FAIL — callers must check first, never resend blindly.
//
// CLI (the ## Contract `measure` path):
//   node --experimental-strip-types plugin/scripts/transcript-delivery-check.ts \
//       --check <transcript.jsonl> [--start <byte-offset>] --text <sent-text>
//   stdout: `state: delivered|failed|unknown` + `delivered: true|false` (+ `matched_line: …`)
//   exit: 0 = delivered · 1 = failed (clear discard evidence) · 2 = usage / IO error (fail-loud)
//         3 = unknown (no evidence — check first, NEVER a bare FAIL)
//   `--start <bytes>` restricts the scan to content appended after that byte offset, so a
//   delivery poll confirms a NEW delivery (the send that just happened), never an old
//   identical one (CRYSTALLIZED fault 4's "新增" requirement).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type DeliveryState = "delivered" | "failed" | "unknown";

export interface DeliveryVerdict {
  /** Three-state delivery verdict (人 06:1x direction — see
   * tasks/gap-send-keys-reliable-false-fail-on-long-text-paste): "delivered" = content-matching
   * evidence in a materialized form; "failed" = CLEAR discard evidence (enqueued then removed
   * without ever being materialized); "unknown" = no evidence either way — DON'T know, check
   * first. The third state MUST NOT be read as a bare FAIL (every past downstream error came from
   * reading "unknown" as "delivered-failed"). */
  state: DeliveryState;
  /** Backward-compatible: true iff state === "delivered". */
  delivered: boolean;
  /** true iff state === "failed" (clear discard evidence — resend is safe/appropriate). */
  failed: boolean;
  /** true iff state === "unknown" (no evidence either way — check first, do NOT resend blindly). */
  unknown: boolean;
  /** The matched JSONL line, trimmed, when delivered/failed (diagnostics only — never used in the
   * verdict). */
  matchedLine?: string;
}

const MAX_MATCHED_LINE = 300;

/** Extract the user-typed text candidates from a transcript fragment. Every record that is a
 * real USER message contributes its string content, plus the `.text` of any `text`-type block in
 * an array content. Malformed / non-user / tool-result-only records contribute nothing. */
export function extractUserTextCandidates(transcriptFragment: string): Array<{ text: string; line: string }> {
  const out: Array<{ text: string; line: string }> = [];
  for (const rawLine of transcriptFragment.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // malformed JSONL line — skip, never crash the poll
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const rec = parsed as { type?: unknown; message?: { role?: unknown; content?: unknown } };
    if (rec.type !== "user") continue;
    if (rec.message?.role !== "user") continue;
    const content = rec.message.content;
    const texts: string[] = [];
    if (typeof content === "string") {
      texts.push(content);
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block && typeof block === "object") {
          const b = block as { type?: unknown; text?: unknown };
          if (b.type === "text" && typeof b.text === "string") texts.push(b.text);
        }
      }
    }
    for (const t of texts) out.push({ text: t, line });
  }
  return out;
}

/** Extract plain-text candidates from a Claude Code message.content value: a bare string, or the
 * `.text` of `text`-type blocks in an array. tool_result/tool_use blocks never contribute (they
 * are injected context, not typed input / not the sent text). */
function textFromContent(content: unknown): string[] {
  const texts: string[] = [];
  if (typeof content === "string") {
    texts.push(content);
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (block && typeof block === "object") {
        const b = block as { type?: unknown; text?: unknown };
        if (b.type === "text" && typeof b.text === "string") texts.push(b.text);
      }
    }
  }
  return texts;
}

export type DeliveryEvidenceSource =
  | "user"
  | "attachment"
  | "queue-operation-enqueue"
  | "queue-operation-remove";

export interface DeliveryEvidence {
  source: DeliveryEvidenceSource;
  text: string;
  line: string;
}

function trimmedLine(line: string): string {
  return line.length > MAX_MATCHED_LINE ? line.slice(0, MAX_MATCHED_LINE) + "…" : line;
}

/** Extract delivery-relevant text evidence from a transcript fragment, tagging each piece with
 * the record form that carried it. A long-text / paste delivery does NOT land as a `type=user`
 * pure-string record — the manager's real 05:39/05:54 samples landed as ZERO type=user records,
 * only `type=queue-operation` (enqueue/remove) plus a `type=attachment` (queued_command,
 * isSidechain=false) record, all carrying the full content. The materialized forms (user message,
 * attachment) are DELIVERED evidence; a queue-operation remove WITHOUT materialization is the
 * measured DISCARD signature (busy session: enqueue then ~3s remove, never materialized). */
export function extractDeliveryEvidence(transcriptFragment: string): DeliveryEvidence[] {
  const out: DeliveryEvidence[] = [];
  for (const rawLine of transcriptFragment.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // malformed JSONL line — skip, never crash the poll
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const rec = parsed as Record<string, unknown>;

    // 1. A REAL user message (typed input): string content or text-block content.
    if (rec.type === "user") {
      const msg = rec.message as { role?: unknown; content?: unknown } | undefined;
      if (msg?.role === "user") {
        for (const t of textFromContent(msg.content)) {
          if (t) out.push({ source: "user", text: t, line });
        }
      }
      continue;
    }

    // 2. An attachment record — the long-text/paste materialization form. isSidechain=true
    //    records are a sidechain (subagent) context, NOT the main session receiving the sent
    //    text, and must never count (the manager's "非 sidechain" criterion).
    if (rec.type === "attachment") {
      if (rec.isSidechain === true) continue;
      const att = rec.attachment as { prompt?: unknown; content?: unknown } | undefined;
      if (att && typeof att === "object") {
        const texts: string[] = [];
        if (typeof att.prompt === "string") texts.push(att.prompt);
        else if (att.prompt !== undefined) texts.push(...textFromContent(att.prompt));
        texts.push(...textFromContent(att.content));
        for (const t of texts) {
          if (t) out.push({ source: "attachment", text: t, line });
        }
      }
      continue;
    }

    // 3. A queue-operation record: a long-text paste is enqueued, then either materialized as an
    //    attachment (delivered) or removed without materialization (discarded). Both carry the
    //    full content.
    if (rec.type === "queue-operation") {
      const op = rec.operation;
      if (op !== "enqueue" && op !== "remove") continue;
      if (typeof rec.content === "string" && rec.content.length > 0) {
        out.push({
          source: op === "enqueue" ? "queue-operation-enqueue" : "queue-operation-remove",
          text: rec.content,
          line,
        });
      }
      continue;
    }
  }
  return out;
}

/** PURE three-state delivery verdict over a transcript fragment. No tmux, no file access, no
 * side effects. Priority:
 *   1. DELIVERED — the sent text appears in a MATERIALIZED form (a real user message, or a
 *      queued_command attachment). Once materialized it is delivered even if a matching
 *      queue-operation remove also exists (negative control: DELIVERED is never misreported as
 *      discard).
 *   2. FAILED — the sent text appears ONLY in a queue-operation remove (enqueued then removed
 *      without ever being materialized): the measured discard signature.
 *   3. UNKNOWN — no evidence either way (nothing matching, or only an enqueue still pending). */
export function checkTranscriptDelivered(transcriptFragment: string, sentText: string): DeliveryVerdict {
  const needle = (sentText ?? "").trim();
  const unconfirmed = (): DeliveryVerdict => ({ state: "unknown", delivered: false, failed: false, unknown: true });
  if (!needle) return unconfirmed(); // empty send text can never be "delivered"
  const evidence = extractDeliveryEvidence(transcriptFragment);

  for (const e of evidence) {
    if ((e.source === "user" || e.source === "attachment") && e.text.includes(needle)) {
      return { state: "delivered", delivered: true, failed: false, unknown: false, matchedLine: trimmedLine(e.line) };
    }
  }
  for (const e of evidence) {
    if (e.source === "queue-operation-remove" && e.text.includes(needle)) {
      return { state: "failed", delivered: false, failed: true, unknown: false, matchedLine: trimmedLine(e.line) };
    }
  }
  return unconfirmed();
}

/** A session is FRESH when its transcript contains NO real user message yet — a brand-new
 * Claude Code session's transcript either does not exist, or holds only system/assistant
 * records before the first typed prompt. On a fresh session the welcome screen renders a real
 * ghost suggestion AFTER the prompt (`❯ Try "fix lint errors"`) — VISIBLE text that the C-u
 * clear loop can never remove, so send-keys-reliable must SKIP the clear loop and send directly
 * (gap-send-keys-reliable-welcome-screen-ghost-drive-fails AC1). PURE: no side effects. */
export function hasUserMessages(transcriptFragment: string): boolean {
  return extractUserTextCandidates(transcriptFragment).length > 0;
}

/** Tail of `fullText` restricted to lines whose byte offset in the file is >= `startBytes`
 * (line-boundary safe for JSONL appends: each line's UTF-8 byte length is accumulated, so a
 * multibyte sent text cannot misalign the cut). Used so a poll only sees content appended after
 * the send — CRYSTALLIZED fault 4's "NEW user message". */
export function tailFromByteOffset(fullText: string, startBytes: number): string {
  if (startBytes <= 0) return fullText;
  const out: string[] = [];
  let pos = 0;
  for (const line of fullText.split("\n")) {
    if (pos >= startBytes) out.push(line);
    pos += Buffer.byteLength(line, "utf8") + 1; // +1 for the '\n' separator
  }
  return out.join("\n");
}

// ── CLI wrapper (the only place files are read) ───────────────────────────────────────────────────

function usageError(message: string): number {
  console.error(`transcript-delivery-check: ${message}`);
  console.error("usage: transcript-delivery-check.ts --check <transcript.jsonl> [--start <bytes>] --text <sent-text>");
  console.error("       transcript-delivery-check.ts --is-fresh <transcript.jsonl>");
  console.error("exit: 0 = delivered / fresh · 1 = failed (clear discard evidence) · 2 = usage/IO error · 3 = unknown (no evidence — check first)");
  return 2;
}

function readJsonlTail(jsonlPath: string, startBytes: number): { ok: true; fragment: string } | { ok: false; error: string } {
  let full: string;
  try {
    full = fs.readFileSync(jsonlPath, "utf8");
  } catch (e) {
    return { ok: false, error: `cannot read transcript ${jsonlPath}: ${(e as Error).message}` };
  }
  return { ok: true, fragment: tailFromByteOffset(full, startBytes) };
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  let jsonlPath: string | undefined;
  let sentText: string | undefined;
  let startBytes = 0;
  let mode: "check" | "is-fresh" | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--check") {
      mode = "check";
      jsonlPath = args[i + 1];
      i++;
    } else if (args[i] === "--is-fresh") {
      mode = "is-fresh";
      jsonlPath = args[i + 1];
      i++;
    } else if (args[i] === "--start") {
      startBytes = Number.parseInt(args[i + 1], 10);
      if (Number.isNaN(startBytes) || startBytes < 0) return usageError(`bad --start byte offset: ${args[i + 1]}`);
      i++;
    } else if (args[i] === "--text") {
      sentText = args[i + 1];
      i++;
    }
  }
  if (!jsonlPath) return usageError("missing --check/--is-fresh <transcript.jsonl>");
  if (mode === "is-fresh") {
    // Fresh-session verdict for send-keys-reliable's welcome-screen skip (AC1): a transcript that
    // does not exist, or exists with ZERO real user messages, is a brand-new session → fresh.
    // ENOENT is the NORMAL fresh case (a new claude writes its jsonl only on first input), NOT an
    // IO error — the caller must be able to skip the clear loop before any input has ever been
    // committed. Any other read failure is a real environment error → exit 2 (fail loud).
    let full: string;
    try {
      full = fs.readFileSync(jsonlPath, "utf8");
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        console.log("fresh: true");
        return 0;
      }
      console.error(`transcript-delivery-check: cannot read transcript ${jsonlPath}: ${err.message}`);
      return 2;
    }
    const fresh = !hasUserMessages(full);
    console.log(`fresh: ${fresh}`);
    return fresh ? 0 : 1;
  }
  if (sentText === undefined) return usageError("missing --text <sent-text>");

  const read = readJsonlTail(jsonlPath, startBytes);
  if (!read.ok) {
    console.error(`transcript-delivery-check: ${read.error}`);
    return 2;
  }

  const verdict = checkTranscriptDelivered(read.fragment, sentText);
  console.log(`state: ${verdict.state}`);
  console.log(`delivered: ${verdict.delivered}`);
  if (verdict.matchedLine) console.log(`matched_line: ${verdict.matchedLine}`);
  if (verdict.state === "delivered") return 0;
  if (verdict.state === "failed") return 1;
  return 3; // unknown — distinct third state, NEVER a bare FAIL (callers must not read it as "delivered-failed")
}

// ── in-file selfcheck (ADR-018: prove BOTH the RED and GREEN paths without the test runner) ───────

export function selfcheck(): boolean {
  let pass = 0;
  let fail = 0;
  const check = (name: string, cond: boolean, detail = "") => {
    if (cond) pass++;
    else {
      fail++;
      console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
    }
  };

  const green = `{"type":"user","message":{"role":"user","content":"send-keys-marker-123 hello"}}\n{"type":"assistant","message":{"role":"assistant","content":"ok"}}\n`;
  check("green-string-content", checkTranscriptDelivered(green, "send-keys-marker-123").state === "delivered");
  check("green-matched-line", (checkTranscriptDelivered(green, "send-keys-marker-123").matchedLine ?? "").includes("send-keys-marker-123"));

  const greenArray = `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"echo hello"}]}}\n`;
  check("green-array-text-block", checkTranscriptDelivered(greenArray, "echo hello").state === "delivered");

  // long-text/paste delivery: ZERO type=user records — queue-operation + attachment (manager 05:39 shape)
  const greenQueueAttach = [
    `{"type":"queue-operation","operation":"enqueue","timestamp":"2026-08-08T05:39:23.157Z","sessionId":"s","content":"[管理者→外层] 两条我自己的错 long-paste-marker-901"}`,
    `{"type":"queue-operation","operation":"remove","timestamp":"2026-08-08T05:39:42.590Z","sessionId":"s","content":"[管理者→外层] 两条我自己的错 long-paste-marker-901"}`,
    `{"type":"attachment","isSidechain":false,"attachment":{"type":"queued_command","prompt":"[管理者→外层] 两条我自己的错 long-paste-marker-901","commandMode":"task-notification","timestamp":"2026-08-08T05:39:42.726Z"},"type":"attachment"}`,
  ].join("\n");
  check("green-queue-operation+attachment", checkTranscriptDelivered(greenQueueAttach, "long-paste-marker-901").state === "delivered");

  // discard signature: queue-operation remove WITHOUT materialization → FAILED
  const redDiscard = `{"type":"queue-operation","operation":"enqueue","timestamp":"2026-08-08T05:50:01.000Z","sessionId":"s","content":"discard-marker-777"}\n{"type":"queue-operation","operation":"remove","timestamp":"2026-08-08T05:50:04.000Z","sessionId":"s","content":"discard-marker-777"}\n`;
  const redDiscardV = checkTranscriptDelivered(redDiscard, "discard-marker-777");
  check("red-discard-remove-without-materialization-is-failed", redDiscardV.state === "failed" && redDiscardV.failed === true);

  // enqueue-only (still pending) → UNKNOWN, not FAILED, not delivered
  const pendingEnqueue = `{"type":"queue-operation","operation":"enqueue","timestamp":"2026-08-08T05:50:01.000Z","sessionId":"s","content":"pending-marker-555"}\n`;
  const pendingV = checkTranscriptDelivered(pendingEnqueue, "pending-marker-555");
  check("enqueue-only-is-unknown-not-failed", pendingV.state === "unknown" && pendingV.failed === false);

  const redEmpty = "";
  check("red-empty", checkTranscriptDelivered(redEmpty, "anything").delivered === false);

  const redMismatch = `{"type":"user","message":{"role":"user","content":"hello world"}}\n`;
  check("red-mismatch", checkTranscriptDelivered(redMismatch, "unique-marker-XYZ").delivered === false);

  const redAssistantOnly = `{"type":"assistant","message":{"role":"assistant","content":"unique-marker-XYZ"}}\n`;
  check("red-assistant-only", checkTranscriptDelivered(redAssistantOnly, "unique-marker-XYZ").delivered === false);

  const redToolResultOnly = `{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"unique-marker-XYZ"}]}}\n`;
  check("red-tool-result-only", checkTranscriptDelivered(redToolResultOnly, "unique-marker-XYZ").delivered === false);

  check("red-empty-sent-text", checkTranscriptDelivered("anything", "   ").delivered === false);

  const malformed = `not json\n{"type":"user","message":{"role":"user","content":"real marker here"}}\n`;
  check("malformed-skipped", checkTranscriptDelivered(malformed, "real marker here").delivered === true);

  check("tail-byte-offset-keeps-appended", tailFromByteOffset("{\"a\":1}\n{\"b\":2}\n", "{\"a\":1}\n".length).includes('"b":2'));

  // fresh-session detection (welcome-screen ghost text skip — AC1)
  check("fresh-empty-transcript", hasUserMessages("") === false);
  check("fresh-assistant-only", hasUserMessages(redAssistantOnly) === false);
  check("fresh-tool-result-only-is-not-typed-input", hasUserMessages(redToolResultOnly) === false);
  check("fresh-real-user-message", hasUserMessages(green) === true);

  console.log(`\ntranscript-delivery-check --selfcheck: ${pass} passed, ${fail} failed`);
  return fail === 0;
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) && path.basename(process.argv[1]).replace(/.(?:js|ts|mjs)$/, "") === "transcript-delivery-check";
if (isDirect) {
  if (process.argv.includes("--selfcheck")) process.exit(selfcheck() ? 0 : 1);
  process.exit(main(process.argv));
}
