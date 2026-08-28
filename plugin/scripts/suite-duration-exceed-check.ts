#!/usr/bin/env node
// suite-duration-exceed-check.ts — gap-preverified-suite-bypasses-verification-round-ledger AC4:
// an INDEPENDENT, explicit signal when a full-suite verification round exceeds AC101's 600s target.
//
// WHY IT EXISTS: AC101's target (main-scope full suite ≤ 600s) previously had two de-facto sentinels —
// (a) the 10min foreground-Bash round cap (objectively flagged an over-long suite) and (b) the
// verification-round.jsonl duration trend ledger. The pre-verified-suite path (ec434eb8) moved the
// suite OUTSIDE the fan-in subagent's round (precisely bypassing the 10min cap) and the ledger went
// silent (round227 at 04:13:31Z, durationMs=936519 = 936.5s — 55% over target — was the last row with
// NO alert). Restoring the ledger (AC1, pre-verified-round-record.ts) ≠ someone actively checking it,
// so this checker is the independent signal: it reads the ledger and goes RED when the latest
// main-scope round exceeds the limit. It does NOT depend on the fan-in being stuck — the suite being
// slow is judged from the ledger alone.
//
// Judgment (能取假): ok=false + SUITE-DURATION-EXCEEDED when EITHER
//   - the LATEST verification-round record (highest round, ANY scope — the pre-verified worktree rows
//     ARE the landing path, so round227-style slowness must fire), OR
//   - the LATEST MAIN-scope record (scope absent or scope != "worktree" — AC101's own definition)
//   has durationMs > limitMs (default 600000 = 600s).
// No records at all ⇒ NOT-EVALUATED (evaluated:false, exit 0 — 无法评估 ≠ 合格, hard rule 3b). A
// record under the limit ⇒ ok=true. The output names WHICH axis exceeded (latest / latestMainScope),
// with round / durationMs / scope / state / commit of each.
//
// Wired into run_static_checks (scripts/test.sh) REPORT-ONLY via --no-block (gap-suite-duration-
// exceed-check-not-wired): it is a trend observation, not a code-class invariant — a stale ledger or
// an over-long round must not red the whole suite, so the wired path prints the observation but never
// exits non-zero. The DEFAULT mode (no --no-block) stays fail-closed (exit 1 on exceed) so a diagnosis
// run — or the AC2 negative control against the real ledger — still gets the RED it is owed.
//
// Run:
//   node --experimental-strip-types plugin/scripts/suite-duration-exceed-check.ts
//       [--limit-ms <n>] [--since-epoch <epoch-ms>] [--root <dir>] [--json] [--no-block]
// Exit codes:
//   0  ok (no round over the limit, or NOT-EVALUATED, or --no-block on an exceed)
//   1  SUITE-DURATION-EXCEEDED (a qualifying round's durationMs > limitMs, without --no-block)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { helpExit, isDirectEntry } from "./gate-script-base.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

export const DEFAULT_LIMIT_MS = 600_000; // AC101's 600s target (人设定，非自推导)

export interface RoundRow {
  round: number;
  startedAt: string | null;
  startedAtEpoch: number | null;
  durationMs: number | null;
  scope: string | null;
  state: string | null;
  commit: string | null;
}

/** Parse one verification-round.jsonl line. Malformed → null (never throw). */
export function parseRoundRow(line: string): RoundRow | null {
  try {
    const o = JSON.parse(line);
    if (!o || typeof o !== "object" || Array.isArray(o)) return null;
    if (o.round == null || typeof o.round !== "number") return null;
    const startedAt = typeof o.startedAt === "string" ? o.startedAt : null;
    const startedAtEpoch = startedAt ? Date.parse(startedAt) : null;
    return {
      round: o.round,
      startedAt,
      startedAtEpoch: Number.isFinite(startedAtEpoch as number) ? (startedAtEpoch as number) : null,
      durationMs: typeof o.durationMs === "number" ? o.durationMs : null,
      scope: typeof o.scope === "string" ? o.scope : null,
      state: typeof o.state === "string" ? o.state : null,
      commit: typeof o.commit === "string" ? o.commit : null,
    };
  } catch {
    return null;
  }
}

/** Read + parse verification-round.jsonl under a root. Missing/unreadable file → []. */
export function readRoundRows(root: string): RoundRow[] {
  const p = path.join(root, ".quay", "verification-round.jsonl");
  try {
    if (!fs.existsSync(p)) return [];
    const text = fs.readFileSync(p, "utf8");
    const rows: RoundRow[] = [];
    for (const l of text.split(/\r?\n/)) {
      if (!l.trim()) continue;
      const r = parseRoundRow(l);
      if (r) rows.push(r);
    }
    return rows;
  } catch {
    return [];
  }
}

/** The latest round row (highest `round`), or null when none. Rows are appended in order but the
 *  max is computed defensively (never trust append order for a "latest" judgment). */
export function latestRound(rows: RoundRow[]): RoundRow | null {
  let best: RoundRow | null = null;
  for (const r of rows) if (!best || r.round > best.round) best = r;
  return best;
}

/** The latest MAIN-scope row (scope absent or scope != "worktree" — AC101's own definition),
 *  or null when none. */
export function latestMainScopeRound(rows: RoundRow[]): RoundRow | null {
  let best: RoundRow | null = null;
  for (const r of rows) {
    if (r.scope === "worktree") continue;
    if (!best || r.round > best.round) best = r;
  }
  return best;
}

/** The AC4 verdict. ok=false ⇒ SUITE-DURATION-EXCEEDED. evaluated=false ⇒ NOT-EVALUATED (no rows). */
export interface DurationExceedVerdict {
  ok: boolean;
  evaluated: boolean;
  reason: string;
  limitMs: number;
  latest: RoundRow | null;
  latestMainScope: RoundRow | null;
  latestExceeded: boolean;
  mainScopeExceeded: boolean;
  sinceEpoch: number | null;
}

export function checkSuiteDuration(
  rows: RoundRow[],
  opts: { limitMs?: number; sinceEpoch?: number } = {},
): DurationExceedVerdict {
  const limitMs = opts.limitMs ?? DEFAULT_LIMIT_MS;
  const sinceEpoch = opts.sinceEpoch ?? null;
  // Normalize each row so startedAtEpoch is present even when a caller passed raw fixture rows
  // (startedAtEpoch is populated by parseRoundRow; a row read from disk always has it, but the
  // pure function must not drop every row just because a hand-built fixture omitted it).
  const withEpoch = rows.map((r) => {
    if (r.startedAtEpoch != null) return r;
    const epoch = r.startedAt ? Date.parse(r.startedAt) : NaN;
    return { ...r, startedAtEpoch: Number.isFinite(epoch) ? epoch : null };
  });
  let filtered = withEpoch;
  if (sinceEpoch !== null) {
    filtered = withEpoch.filter((r) => r.startedAtEpoch !== null && r.startedAtEpoch >= sinceEpoch);
  }
  if (filtered.length === 0) {
    return {
      ok: true,
      evaluated: false,
      reason: `NOT-EVALUATED — no verification-round rows${sinceEpoch !== null ? " in the since-window" : ""} to judge`,
      limitMs,
      latest: null,
      latestMainScope: null,
      latestExceeded: false,
      mainScopeExceeded: false,
      sinceEpoch,
    };
  }
  const latest = latestRound(filtered);
  const latestMain = latestMainScopeRound(filtered);
  const latestExceeded = latest !== null && latest.durationMs !== null && latest.durationMs > limitMs;
  const mainScopeExceeded = latestMain !== null && latestMain.durationMs !== null && latestMain.durationMs > limitMs;
  const exceeded = latestExceeded || mainScopeExceeded;
  const axes = [];
  if (latestExceeded) axes.push(`latest=round${latest!.round}:${latest!.durationMs}ms`);
  if (mainScopeExceeded) axes.push(`latestMainScope=round${latestMain!.round}:${latestMain!.durationMs}ms`);
  return {
    ok: !exceeded,
    evaluated: true,
    reason: exceeded
      ? `SUITE-DURATION-EXCEEDED — ${axes.join("; ")} exceed ${limitMs}ms (AC101 600s target)`
      : `SUITE-DURATION-OK — latest round ${latest!.round} durationMs=${latest!.durationMs ?? "?"}ms ≤ ${limitMs}ms`,
    limitMs,
    latest,
    latestMainScope: latestMain,
    latestExceeded,
    mainScopeExceeded,
    sinceEpoch,
  };
}

function getArgValue(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx !== -1 ? argv[idx + 1] : undefined;
}

export function main(argv: string[]): number {
  if (argv.includes("--help") || argv.includes("-h")) helpExit("usage: node suite-duration-exceed-check.ts [--root <dir>] [--limit-ms <n>] [--since-epoch <t>] [--json] [--no-block]");
  const root = path.resolve(getArgValue(argv, "--root") ?? REPO_ROOT);
  const limitMs = Number(getArgValue(argv, "--limit-ms") ?? String(DEFAULT_LIMIT_MS));
  const sinceRaw = getArgValue(argv, "--since-epoch");
  const sinceEpoch = sinceRaw !== undefined ? Number(sinceRaw) : null;
  const asJson = argv.includes("--json");
  // --no-block (gap-suite-duration-exceed-check-not-wired): the REPORT-ONLY wired path. The verdict
  // is printed verbatim (SUITE-DURATION-EXCEEDED stays visible in the suite log) but the exit is 0 so
  // a trend observation never reds the whole suite. Usage errors (exit 2) still fire.
  const noBlock = argv.includes("--no-block");
  if (!Number.isFinite(limitMs) || limitMs < 0) {
    const msg = `--limit-ms must be a non-negative number (got ${JSON.stringify(limitMs)})`;
    if (asJson) console.log(JSON.stringify({ ok: false, error: msg }));
    else console.error(`suite-duration-exceed-check: ${msg}`);
    return 2;
  }
  if (sinceEpoch !== null && !Number.isFinite(sinceEpoch)) {
    const msg = `--since-epoch must be a number (got ${JSON.stringify(sinceRaw)})`;
    if (asJson) console.log(JSON.stringify({ ok: false, error: msg }));
    else console.error(`suite-duration-exceed-check: ${msg}`);
    return 2;
  }
  const verdict = checkSuiteDuration(readRoundRows(root), { limitMs, sinceEpoch: sinceEpoch ?? undefined });
  if (asJson) {
    console.log(JSON.stringify(verdict, null, 2));
  } else {
    if (!verdict.evaluated) {
      console.log(`suite-duration-exceed-check: ${verdict.reason}`);
      return 0;
    }
    const fmt = (r: RoundRow | null) =>
      r
        ? `round${r.round} durationMs=${r.durationMs ?? "?"}ms scope=${r.scope ?? "?"} state=${r.state ?? "?"} commit=${r.commit ? r.commit.slice(0, 8) : "?"}`
        : "none";
    console.log(`suite-duration-exceed-check: latest=${fmt(verdict.latest)}`);
    console.log(`suite-duration-exceed-check: latestMainScope=${fmt(verdict.latestMainScope)}`);
    console.log(`suite-duration-exceed-check: ${verdict.reason}`);
  }
  return noBlock || verdict.ok ? 0 : 1;
}

if (isDirectEntry(import.meta, undefined, "suite-duration-exceed-check")) {
  process.exitCode = main(process.argv.slice(2));
}
