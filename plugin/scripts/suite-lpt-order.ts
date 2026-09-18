// suite-lpt-order.ts — LPT (Longest Processing Time first) ordering for the M-bucket file list
// (gap-m-bucket-long-tail-lpt-scheduling).
//
// The M bucket (the concurrency-N bucket subset, 223 files at 16 lanes) is handed to `node --test`
// in glob / filesystem-discovery order. A handful of 150–290s long tests that land at the END of
// that list wait for the short tests to drain the lanes and serialize into a long tail (measured
// round 474/476/478: the last 5% of files = 27%+ of wall clock; the 12 slowest files' serial sum =
// 55% of the whole). LPT reorders the list so the longest-KNOWN files start FIRST and overlap the
// long run of short files — the classic makespan-minimizing schedule.
//
// The duration source is the EXISTING per-file wall-clock carrier — `.quay/verification-round.jsonl`
// `perFile[].durationMs` — NOT a new measurer. A PER-FILE rolling average of each file's own last
// `--rounds` appearances smooths single-round noise (NOT the last `--rounds` records — those may all
// come from a different bucket and omit this file, leaving its real duration invisible); a file
// absent from history sorts with duration 0 (unknown ⇒ LAST, but still runs). The reorder is
// scheduling-only: every input file is emitted EXACTLY once, only the ORDER changes, so a bug here
// can never drop a test ⇒ pass/fail-neutral ⇒ NOT a hub file (suite-bucket-hub-list.ts).
//
// FAIL-OPEN: no perFile history, an unreadable carrier, or any parse failure ⇒ the input list is
// emitted UNCHANGED (current behavior). The caller (scripts/test.sh) additionally refuses a
// short/empty result and keeps the original order.
//
// ⚠️ FAIL-OPEN IS INVISIBLE FROM THE OUTPUT ALONE — the identity list is a VALID list, and it has
// exactly the right line count, so a caller that infers "reordered" from "output looks well-formed"
// reports a reorder that never happened (硬规则 3b: a check with no "not evaluated" value cannot
// tell "checked and fine" from "never checked"). Measured on CI run 35297103524 (2026-09-18): the
// suite printed `lpt-order: file list reordered (56 files; first=closure-lag-check.test.mjs)` and
// `(32 files; first=observation.test.mjs)` — and those two names are EXACTLY the first files of
// their groups in raw glob order, i.e. nothing was reordered. A fresh checkout (CI) has no
// `.quay/verification-round.jsonl` at all (gitignored), so EVERY CI run took this path. The `LptReport`
// returned by the entry point carries the provenance, and the CLI prints it to stderr, so
// "no carrier" is distinguishable from "carrier present and the order really changed".
//
// COMMITTED LAST-RESORT CARRIER (`--baseline <path>`): the same measured CI run dispatched the main
// bucket in RAW glob order, putting a 19 165 ms file at queue position ~565 so it started at t=17.2 s
// and pinned main_phase_ms at 36.3 s against a 19.5 s floor (the other 16 s of slack had no cause in
// the floor at all). The live rolling carrier always WINS when present; --baseline is consulted ONLY
// when it yields nothing, so a checkout that has no per-file history still gets a duration-AWARE
// order instead of the identity order. It is order-only and fail-open (unreadable/malformed ⇒ empty),
// and a stale baseline can only cost scheduling quality, never correctness.
//
// Usage (stdin → stdout, one path per line; paths in, paths out in the same form):
//   node --experimental-strip-types suite-lpt-order.ts --root <main-checkout> --rounds 3 < files.txt
//   node --experimental-strip-types suite-lpt-order.ts --root <r> --baseline docs/analysis/suite-perfile-duration-baseline.json < files.txt
import fs from "node:fs";
import path from "node:path";
import { isDirectEntry } from "./gate-script-base.ts";

/** Strip the worktree-root prefix (same 口径 as measure-trend-check.normalizePerFileKey) and then a
 *  plain repo-root prefix, so BOTH a main-checkout absolute path and a worktree absolute path
 *  normalize to the same repo-relative key (`plugin/test/foo.test.mjs`). A path already repo-relative
 *  is returned unchanged. */
export function repoRelKey(file: string, root: string): string {
  let rel = file.replace(/^.*\/quay-worktrees\/[^/]+\//, "");
  const rp = root.replace(/\/+$/, "");
  if (rel === rp) rel = "";
  else if (rel.startsWith(rp + "/")) rel = rel.slice(rp.length + 1);
  return rel.replace(/^\.\//, "");
}

function parseArgs(argv: string[]): { root: string; rounds: number; baseline: string } {
  let root = process.cwd();
  let rounds = 3;
  let baseline = "";
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root" && i + 1 < argv.length) root = argv[++i];
    else if (a.startsWith("--root=")) root = a.slice("--root=".length);
    else if (a === "--baseline" && i + 1 < argv.length) baseline = argv[++i];
    else if (a.startsWith("--baseline=")) baseline = a.slice("--baseline=".length);
    else if (a === "--rounds" && i + 1 < argv.length) {
      const n = Number(argv[++i]);
      if (Number.isInteger(n) && n >= 1) rounds = n;
    } else if (a.startsWith("--rounds=")) {
      const n = Number(a.slice("--rounds=".length));
      if (Number.isInteger(n) && n >= 1) rounds = n;
    }
  }
  return { root: path.resolve(root), rounds, baseline };
}

/** Read a PER-FILE rolling average from the carrier: for each repo-rel key, average that file's own
 *  LAST `rounds` durations (the carrier is append-ordered, so the last `rounds` entries in the
 *  per-key list are its most recent appearances). Immune to a lookback window whose most recent
 *  `rounds` records all come from a DIFFERENT bucket and so omit this file entirely — the file's
 *  real duration is still found in its own history. Returns an empty map on any failure
 *  (fail-open — the caller then keeps the original order). */
export function loadDurationAverages(carrier: string, root: string, rounds: number): Map<string, number> {
  const avg = new Map<string, number>();
  let text: string;
  try {
    text = fs.readFileSync(carrier, "utf8");
  } catch {
    return avg; // no carrier / unreadable ⇒ no reordering signal
  }
  const byFile = new Map<string, number[]>(); // repo-rel key → that file's durations, append order
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let rec: any;
    try {
      rec = JSON.parse(line);
    } catch {
      continue; // tolerate a malformed appended line
    }
    if (!rec || !Array.isArray(rec.perFile) || rec.perFile.length === 0) continue;
    for (const p of rec.perFile) {
      const dur = Number(p?.durationMs);
      const file = p?.file;
      if (typeof file !== "string" || !file) continue;
      if (!Number.isFinite(dur) || dur <= 0) continue;
      const key = repoRelKey(file, root);
      const durs = byFile.get(key);
      if (durs) durs.push(dur);
      else byFile.set(key, [dur]);
    }
  }
  // Per-key rolling average over that file's LAST `rounds` appearances (NOT the last `rounds`
  // records — those may all come from another bucket and omit this file).
  for (const [key, durs] of byFile) {
    const recent = durs.slice(-rounds);
    const sum = recent.reduce((a, b) => a + b, 0);
    avg.set(key, sum / recent.length);
  }
  return avg;
}

/** Read the COMMITTED last-resort duration table (`docs/analysis/suite-perfile-duration-baseline.json`:
 *  `{ durations: { <repo-rel-key>: <rolling-average ms> } }`). Consulted ONLY when the live rolling
 *  carrier yields NOTHING — a fresh checkout (CI) has no `.quay/verification-round.jsonl` (gitignored),
 *  so without this the LPT silently degrades to identity order on every CI run. Order-only: the keys
 *  are the SAME repo-relative keys `repoRelKey` produces, an entry for a file that no longer exists is
 *  simply never looked up, and any read/parse failure returns an EMPTY map (fail-open). */
export function loadBaselineDurations(baselinePath: string): Map<string, number> {
  const map = new Map<string, number>();
  let text: string;
  try {
    text = fs.readFileSync(baselinePath, "utf8");
  } catch {
    return map; // absent/unreadable ⇒ no reordering signal (fail-open)
  }
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    return map; // malformed ⇒ no signal (fail-open), never an exception
  }
  const d = parsed?.durations;
  if (!d || typeof d !== "object") return map;
  for (const [key, value] of Object.entries(d)) {
    const n = Number(value);
    if (key && Number.isFinite(n) && n > 0) map.set(key, n);
  }
  return map;
}

/** Which carrier supplied the duration table — so "no history ⇒ identity output" is distinguishable
 *  from "history present and the order really changed" (硬规则 3b). */
export type LptProvenance = "rolling-carrier" | "committed-baseline" | "none" | "disabled";

export interface LptReport {
  provenance: LptProvenance;
  /** entries in the duration table used (0 ⇒ the order below is the input order) */
  entries: number;
  /** number of input files handed to the classifier */
  files: number;
  /** true only when the MAIN bucket's emitted order differs from its input order */
  mainReordered: boolean;
}

/** Resolve the duration table: the LIVE rolling carrier wins; `--baseline` is the last resort. */
export function resolveDurationTable(opts: {
  root: string;
  rounds: number;
  baseline?: string;
}): { table: Map<string, number>; provenance: LptProvenance } {
  const live = loadDurationAverages(path.join(opts.root, ".quay", "verification-round.jsonl"), opts.root, opts.rounds);
  if (live.size > 0) return { table: live, provenance: "rolling-carrier" };
  if (opts.baseline) {
    const base = loadBaselineDurations(opts.baseline);
    if (base.size > 0) return { table: base, provenance: "committed-baseline" };
  }
  return { table: live, provenance: "none" };
}

/** Pure LPT reorder: descending average duration, ties and unknowns keep their ORIGINAL relative
 *  order (explicit index tiebreaker — never relies on engine sort stability). Returns a NEW array;
 *  the input strings are returned unchanged (paths in, paths out in the same form). */
export function orderByLpt(input: string[], avg: Map<string, number>, root: string): string[] {
  const indexed = input.map((file, i) => ({ file, i, dur: avg.get(repoRelKey(file, root)) ?? 0 }));
  indexed.sort((a, b) => (b.dur - a.dur) || (a.i - b.i));
  return indexed.map((e) => e.file);
}

async function main(argv: string[]): Promise<number> {
  const { root, rounds, baseline } = parseArgs(argv);
  // Read input paths from stdin (one per line, the exact `--buckets` selected file list).
  const inputRaw = await new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c) => chunks.push(Buffer.from(c)));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
  const input = inputRaw.split("\n").map((s) => s.trim()).filter((s) => s.length > 0);
  if (input.length === 0) return 0;

  const { table, provenance } = resolveDurationTable({ root, rounds, baseline: baseline || undefined });
  const out = orderByLpt(input, table, root);
  // The authoritative status line: the reorder claim lives HERE, where the comparison is real, and
  // NOT in the caller's "output looks well-formed" inference (which the identity list also satisfies).
  process.stderr.write(
    `suite-lpt-order: provenance=${provenance} entries=${table.size} files=${input.length} reordered=${out.some((f, i) => f !== input[i])}\n`,
  );
  for (const file of out) process.stdout.write(file + "\n");
  return 0;
}

if (isDirectEntry(import.meta, undefined, "suite-lpt-order")) {
  main(process.argv).then((code) => process.exit(code));
}
