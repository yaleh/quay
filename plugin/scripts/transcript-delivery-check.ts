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
// What counts as a delivered message:
//   - the JSONL record is a USER message (`type === "user"` AND `message.role === "user"`);
//   - its `message.content` is either a string, or an array whose `text` blocks are extracted
//     (a user message whose content array holds ONLY tool_result/tool_use blocks is injected
//     context, NOT typed input, and must never count — fault 5's "real user message");
//   - one of those extracted texts CONTAINS the trimmed sent text (the CRYSTALLIZED doc's
//     "匹配（或包含）").
//
// CLI (the ## Contract `measure` path):
//   node --experimental-strip-types plugin/scripts/transcript-delivery-check.ts \
//       --check <transcript.jsonl> [--start <byte-offset>] --text <sent-text>
//   stdout: `delivered: true|false` (+ `matched_line: …` when delivered)
//   exit: 0 = delivered · 1 = not delivered · 2 = usage / IO error (fail-loud)
//   `--start <bytes>` restricts the scan to content appended after that byte offset, so a
//   delivery poll confirms a NEW user message (the send that just happened), never an old
//   identical one (CRYSTALLIZED fault 4's "新增" requirement).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface DeliveryVerdict {
  delivered: boolean;
  /** The matched JSONL line, trimmed, when delivered (diagnostics only — never used in the
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

/** PURE delivery verdict: true iff the fragment contains a real USER message whose content
 * contains the (trimmed) sent text. No tmux, no file access, no side effects. */
export function checkTranscriptDelivered(transcriptFragment: string, sentText: string): DeliveryVerdict {
  const needle = (sentText ?? "").trim();
  if (!needle) return { delivered: false }; // empty send text can never be "delivered"
  for (const { text, line } of extractUserTextCandidates(transcriptFragment)) {
    if (text.includes(needle)) {
      const trimmedLine = line.length > MAX_MATCHED_LINE ? line.slice(0, MAX_MATCHED_LINE) + "…" : line;
      return { delivered: true, matchedLine: trimmedLine };
    }
  }
  return { delivered: false };
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
  console.error("exit: 0 = delivered / fresh · 1 = not delivered / not fresh · 2 = usage/IO error");
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
  if (verdict.delivered) {
    console.log(`delivered: true`);
    if (verdict.matchedLine) console.log(`matched_line: ${verdict.matchedLine}`);
    return 0;
  }
  console.log(`delivered: false`);
  return 1;
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
  check("green-string-content", checkTranscriptDelivered(green, "send-keys-marker-123").delivered === true);
  check("green-matched-line", (checkTranscriptDelivered(green, "send-keys-marker-123").matchedLine ?? "").includes("send-keys-marker-123"));

  const greenArray = `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"echo hello"}]}}\n`;
  check("green-array-text-block", checkTranscriptDelivered(greenArray, "echo hello").delivered === true);

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
