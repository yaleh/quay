// drain-dispose-corruption-check.ts — gap-drain-dispose-body-corruption (2026-07-31): the
// mechanical post-write check for the DRAIN Dispose phase's exact corruption shape.
//
// Real transcript evidence (`wf_bb989746-4a0`, 2026-07-26 — see the task's own Finding section)
// showed a dispatched Dispose-phase `agent()` sometimes reconstructs a task body by copying the
// JSON-escaped text it saw inside a `task_get` tool result (where real newlines are legitimately
// escaped as the two literal characters `\` `n` for wire transport) instead of decoding it back to
// real newlines before re-emitting it as `task_write`'s `body` argument. 3 of 5 independent
// dispatches in that run corrupted this way (bodies collapsed from 100-122 real lines down to
// 16-17); 2 stayed clean. Confirmed at the tool-call-input level (not just the on-disk artifact):
// the corrupted runs' own `task_write` `body` parameter already contained 0 real newlines and
// 100+ literal `\n` two-character sequences — i.e. the corruption happened in the agent's own
// context, not the storage layer (`task_get`/`task_write` round-trip strings correctly; only what
// the agent CHOSE to pass as `body` was already-corrupted text).
//
// This is NOT an LLM-judgment check (drain-directives.js's OLD Verify phase already asked an
// `agent()` to `task_get` and eyeball the result — its own `{"failed":[]}` summary silently
// passed all 3 corrupted directives). This module is a small, pure, deterministic function plus a
// CLI that reads the task's ACTUAL on-disk file directly (bypassing any LLM-mediated JSON
// round-trip entirely) and fails closed on:
//   1. implausible line-count shrinkage — DRAIN Dispose is APPEND-ONLY (see quay.js's own
//      `--append-notes`: `current.body + "\n\n" + noteText`), so the line count can only grow;
//      any shrinkage below the pre-write count is itself proof of corruption.
//   2. literal `\n`/`\t` two-character escape sequences outnumbering real newlines — the exact,
//      empirically-confirmed corruption signature (corrupted: 0 real newlines / 100+ literal
//      escapes; clean: 100+ real newlines / 0 literal escapes). A normal doc that legitimately
//      mentions `\n` a few times inside backticks (this file's own header comment does) still has
//      far MORE real newlines than escape-sequence mentions, so this ratio check has no realistic
//      false-positive on ordinary prose.
//
// Scope: reads the file directly, so it assumes the native provider's one-task-per-file on-disk
// layout (`tasks/<id>.md`) — the same assumption the Finding's own evidence used
// (`wc -l tasks/DIR-113.md`). DRAIN itself is currently native-provider-only in this workspace
// (`.quay/config.yml`'s `loop.board: native`), so this is not a new scope narrowing.
//
// CLI:
//   node drain-dispose-corruption-check.ts --file <path> --min-lines <N>
// Exit codes: 0 = PASS, 1 = FAIL (corruption detected — prints JSON {ok:false, reasons:[...]}),
// 2 = usage/environment error (file not found, bad args).

import fs from "node:fs";
import { fileURLToPath } from "node:url";

// ── countRealNewlines ─────────────────────────────────────────────────────────────────────────────
// Real newline characters in the text — the same quantity `wc -l` reports (a trailing-newline-less
// last line is not counted as an extra line, matching `wc -l` semantics).
export function countRealNewlines(text) {
  if (typeof text !== "string") return 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") n++;
  return n;
}

// ── countLiteralEscapes ───────────────────────────────────────────────────────────────────────────
// Literal two-character `\n` or `\t` sequences (backslash followed by the letter n or t) — i.e.
// escape sequences that survived as TEXT instead of being decoded to real whitespace.
export function countLiteralEscapes(text) {
  if (typeof text !== "string") return 0;
  const m = text.match(/\\[nt]/g);
  return m ? m.length : 0;
}

// ── checkBodyIntegrity ────────────────────────────────────────────────────────────────────────────
// Pure check: given the pre-write line count and the post-write file text, return a fail-closed
// verdict. `reasons` is always populated with a specific, actionable string per failing check —
// never a bare boolean (mirrors milestone-preparation-check.ts's own convention).
export function checkBodyIntegrity({ oldLineCount, newText }) {
  const reasons = [];
  const newLineCount = countRealNewlines(newText);
  const literalEscapeCount = countLiteralEscapes(newText);

  if (typeof oldLineCount === "number" && oldLineCount >= 0 && newLineCount < oldLineCount) {
    reasons.push(
      `line-count-shrinkage: DRAIN Dispose is append-only but real line count dropped from ` +
      `${oldLineCount} to ${newLineCount} — the write likely replaced the body with corrupted text ` +
      `instead of appending to it.`
    );
  }
  if (literalEscapeCount > newLineCount) {
    reasons.push(
      `literal-escape-sequences: found ${literalEscapeCount} literal "\\n"/"\\t" two-character ` +
      `sequence(s) vs only ${newLineCount} real newline(s) — this is the confirmed corruption ` +
      `signature (a JSON-escaped body copied through verbatim instead of decoded).`
    );
  }

  return { ok: reasons.length === 0, reasons, newLineCount, literalEscapeCount };
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────────
function usage() {
  process.stderr.write("Usage: drain-dispose-corruption-check.ts --file <task.md> --min-lines <N>\n");
}

export async function main(argv) {
  const args = argv.slice(2);
  let filePath = null;
  let minLines = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--file") { filePath = args[++i]; continue; }
    if (args[i] === "--min-lines") { minLines = Number(args[++i]); continue; }
    if (args[i] === "--help" || args[i] === "-h") { usage(); return 2; }
  }
  if (!filePath || minLines === null || Number.isNaN(minLines)) { usage(); return 2; }
  if (!fs.existsSync(filePath)) {
    process.stderr.write(`ERROR: not found: ${filePath}\n`);
    return 2;
  }

  let newText;
  try {
    newText = fs.readFileSync(filePath, "utf8");
  } catch (e) {
    process.stderr.write(`ERROR: cannot read ${filePath}: ${e.message}\n`);
    return 2;
  }

  const result = checkBodyIntegrity({ oldLineCount: minLines, newText });
  process.stdout.write(JSON.stringify(result) + "\n");
  return result.ok ? 0 : 1;
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) { main(process.argv).then((c) => process.exit(c)); }
