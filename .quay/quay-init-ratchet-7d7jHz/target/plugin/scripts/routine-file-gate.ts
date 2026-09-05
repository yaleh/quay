// routine-file-gate.mjs — DIR-051: the MECHANICAL quality/dedup/rate gate for routine findings (the
// DIR-051 adversarial audit refuted the gate as prose-only — this makes it runnable). A routine FILES
// findings as tasks; before one lands, it must pass this gate: QUALITY (a real, actionable finding —
// carries a `## Finding` with reproduction evidence, not a vague concern), DEDUP (not already on the
// board — by a stable finding key), RATE (≤ K new routine-filed tasks per window). This does NOT make
// the FILE-only-vs-execute boundary mechanical (that is the driving agent's contract, backstopped by
// a post-fire "a routine produced no commits, only task files" check in the skill) — but it removes
// the "queue-spam is prose-capped only" hole the audit found.
//
// Pure functions are exported and unit-tested; `main()` is a thin CLI over them.

import fs from "node:fs";
import path from "node:path";
import { isDirectEntry } from "./gate-script-base.ts";

export const DEFAULT_RATE = 3; // ≤ K routine-filed tasks per window (tunable)

// ── findingKey ───────────────────────────────────────────────────────────────────────────────────
// A stable dedup key from a task's `## Finding` section (normalized: lowercased, whitespace-collapsed,
// first 200 chars). Two findings with the same normalized finding text are duplicates.
export function findingKey(taskText) {
  const m = String(taskText).match(/##\s+Finding\s*\n([\s\S]*?)(?:\n##\s|\n*$)/i);
  const body = (m ? m[1] : "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200);
  return body;
}

// ── quality ──────────────────────────────────────────────────────────────────────────────────────
// A finding is actionable iff it has a non-trivial `## Finding` AND cites reproduction evidence (a
// command, a path, a diff/commit ref, a test name) — not a vague concern.
const EVIDENCE = /(`[^`]+`|\b\w[\w./-]*\.(mjs|js|ts|md|json|sh)\b|\b[0-9a-f]{7,40}\b|exit\s+\d|npx |node |git )/i;
export function isActionable(taskText) {
  const key = findingKey(taskText);
  if (key.length < 20) return false;                 // a real finding is more than a phrase
  const m = String(taskText).match(/##\s+Finding\s*\n([\s\S]*?)(?:\n##\s|\n*$)/i);
  return !!m && EVIDENCE.test(m[1]);                 // must cite concrete evidence
}

// ── gateFinding ──────────────────────────────────────────────────────────────────────────────────
// candidate: the new task text. opts: { existingKeys:Set|[], recentCount:number, K:number }.
// Returns { accept, reason }.
export function gateFinding(candidate: string, { existingKeys = [] as string[], recentCount = 0, K = DEFAULT_RATE }: { existingKeys?: Set<string> | string[]; recentCount?: number; K?: number } = {}) {
  if (!isActionable(candidate)) return { accept: false, reason: "quality: no actionable `## Finding` with reproduction evidence" };
  const keys = existingKeys instanceof Set ? existingKeys : new Set(existingKeys);
  const key = findingKey(candidate);
  if (keys.has(key)) return { accept: false, reason: "dedup: an equivalent finding is already on the board" };
  if (recentCount >= K) return { accept: false, reason: `rate: ${recentCount} routine-filed tasks this window ≥ cap ${K}` };
  return { accept: true, reason: "accepted: actionable, novel, within rate" };
}

// ── boardKeys ────────────────────────────────────────────────────────────────────────────────────
// Gather existing finding keys from a board dir (task .md files) for the dedup check.
// excludePath: when provided, skip the file whose resolved/real path matches this path — so a
// candidate physically IN the board dir is not counted as its own duplicate.
export function boardKeys(boardDir: string, excludePath: string | null = null): Set<string> {
  const keys = new Set<string>();
  let files;
  try { files = fs.readdirSync(boardDir).filter((f) => f.endsWith(".md")); } catch { return keys; }
  let skip = null;
  if (excludePath) { try { skip = fs.realpathSync(path.resolve(excludePath)); } catch { skip = path.resolve(excludePath); } }
  for (const f of files) {
    try {
      const abs = path.join(boardDir, f);
      let absReal; try { absReal = fs.realpathSync(abs); } catch { absReal = path.resolve(abs); }
      if (skip && absReal === skip) continue;
      const k = findingKey(fs.readFileSync(abs, "utf8"));
      if (k) keys.add(k);
    } catch { /* skip */ }
  }
  return keys;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
// Usage: routine-file-gate.mjs [--board <dir>] [--recent N] [--k K] <candidate-task.md>
// Exit 0 = accept (file it); 1 = REJECT (quality/dedup/rate); 2 = usage/parse error.
function usage() { process.stderr.write("Usage: routine-file-gate.mjs [--board <dir>] [--recent N] [--k K] <candidate-task.md>\n"); }

export async function main(argv) {
  const args = argv.slice(2);
  let board = null, recent = 0, K = DEFAULT_RATE;
  const files = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--board") { board = args[++i]; continue; }
    if (args[i] === "--recent") { recent = Number(args[++i]); continue; }
    if (args[i] === "--k") { K = Number(args[++i]); continue; }
    files.push(args[i]);
  }
  if (files.length !== 1 || !Number.isFinite(recent) || !Number.isFinite(K) || K < 1) { usage(); return 2; }
  if (!fs.existsSync(files[0])) { process.stderr.write(`ERROR: not found: ${files[0]}\n`); return 2; }
  const candidate = fs.readFileSync(files[0], "utf8");
  const existingKeys: Set<string> = board ? boardKeys(board, files[0]) : new Set<string>();
  const r = gateFinding(candidate, { existingKeys, recentCount: recent, K });
  process.stdout.write(`${r.accept ? "ACCEPT" : "REJECT"}: ${r.reason}\n`);
  return r.accept ? 0 : 1;
}

if (isDirectEntry(import.meta, undefined, "routine-file-gate")) { main(process.argv).then((c) => process.exit(c)); }
