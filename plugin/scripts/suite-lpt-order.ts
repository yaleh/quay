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
// Usage (stdin → stdout, one path per line; paths in, paths out in the same form):
//   node --experimental-strip-types suite-lpt-order.ts --root <main-checkout> --rounds 3 < files.txt
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

function parseArgs(argv: string[]): { root: string; rounds: number } {
  let root = process.cwd();
  let rounds = 3;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root" && i + 1 < argv.length) root = argv[++i];
    else if (a.startsWith("--root=")) root = a.slice("--root=".length);
    else if (a === "--rounds" && i + 1 < argv.length) {
      const n = Number(argv[++i]);
      if (Number.isInteger(n) && n >= 1) rounds = n;
    } else if (a.startsWith("--rounds=")) {
      const n = Number(a.slice("--rounds=".length));
      if (Number.isInteger(n) && n >= 1) rounds = n;
    }
  }
  return { root: path.resolve(root), rounds };
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

/** Pure LPT reorder: descending average duration, ties and unknowns keep their ORIGINAL relative
 *  order (explicit index tiebreaker — never relies on engine sort stability). Returns a NEW array;
 *  the input strings are returned unchanged (paths in, paths out in the same form). */
export function orderByLpt(input: string[], avg: Map<string, number>, root: string): string[] {
  const indexed = input.map((file, i) => ({ file, i, dur: avg.get(repoRelKey(file, root)) ?? 0 }));
  indexed.sort((a, b) => (b.dur - a.dur) || (a.i - b.i));
  return indexed.map((e) => e.file);
}

async function main(argv: string[]): Promise<number> {
  const { root, rounds } = parseArgs(argv);
  // Read input paths from stdin (one per line, the exact `--buckets` selected file list).
  const inputRaw = await new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c) => chunks.push(Buffer.from(c)));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
  const input = inputRaw.split("\n").map((s) => s.trim()).filter((s) => s.length > 0);
  if (input.length === 0) return 0;

  const avg = loadDurationAverages(path.join(root, ".quay", "verification-round.jsonl"), root, rounds);
  for (const file of orderByLpt(input, avg, root)) process.stdout.write(file + "\n");
  return 0;
}

if (isDirectEntry(import.meta, undefined, "suite-lpt-order")) {
  main(process.argv).then((code) => process.exit(code));
}
