// cli/suite.ts — the `quay suite` verb: the READ-ONLY, bounded, JSON-only exit for a workspace's
// suite state and its most recent rounds (task gap-suite-read-verb-current-and-recent-rounds).
//
// WHY THIS EXISTS: an external read-only consumer (claudecodeui's Tests page) displayed quay's suite
// history by reading quay's INTERNAL carriers directly — `.quay/full-suite-state.json` (4.6 KB) and
// `.quay/verification-round.jsonl` (102 MB on their store, 250 MB on this one) — with a bespoke
// stream-from-EOF parser. There was NO suite read surface: `quay driver log` / `quay driver live`
// cover workers and in-flight fan-in, not the suite. The fix is an exit over the readers that already
// exist, NOT a second parser:
//   • current state  ⇒ observation/liveness.ts `readFullSuiteStateCarrier` + `projectCurrentSuiteRun`
//                       (the SAME projection the web dashboard's tests card uses);
//   • recent rounds  ⇒ observation.ts `readRecentSuiteRounds`, whose line parser is
//                       `parseVerificationRound` (the /tests page's parser) and whose I/O is the
//                       SHARED growing-window reverse scan in observation/records.ts (the same
//                       helper `.quay/worker-round.jsonl`'s tail read uses).
//
// ⛔ NO SERVE PROCESS, NO SPAWN: this file reads two files under the resolved workspace root. It never
// starts/stops anything and imports nothing from the serve render path.
//
// ⛔ 3b（读不懂 ≠ 合格）: the carrier states are ENUMERATED, per carrier, and `evaluated:false` marks
// the readings that could not be taken (an existing carrier that will not parse / read). ⛔ A missing
// carrier is a REAL reading ("nothing has been written"), not a failure — those are different values
// (`absent` vs `unreadable`) in the published document, and only `unreadable` exits 1.
//
// ⛔ UNIT TRAP (AC1b): `.quay/full-suite-state.json` mixes units — `startedAt` is an ISO 8601 string
// while `finishedAt` is an epoch SECONDS integer (measured on the live store: startedAt
// "2026-10-25T22:14:20.100Z", finishedAt 1792967664). Every timestamp this verb publishes is
// normalized to ISO 8601 UTC by `suiteTimestampToIso`, so a consumer never has to know which field
// came from which clock.

import { SUITE_ROUNDS_DEFAULT_LIMIT, readRecentSuiteRounds, type SuiteRound, type SuiteRoundsReading } from "../observation.ts";
import {
  projectCurrentSuiteRun,
  readFullSuiteStateCarrier,
  type CurrentSuiteRun,
  type FullSuiteStateCarrierState,
} from "../observation/liveness.ts";
import { resolveRoot } from "../driver-control.ts";
import { parseVerbless } from "./flags.ts";
import type { CliCtx } from "./context.ts";

/** The version this verb first ships in — the consumer's capability probe (AC6). */
export const SUITE_VERB_FIRST_SHIPPED = "0.24.0-dev";

/** One carrier's published state — the same four-value vocabulary as AC1, per carrier. */
export interface SuiteCarrierState {
  state: FullSuiteStateCarrierState | "empty-writer-zero-records";
  reason: string | null;
}

/** The published document. FIXED shape (AC1/AC6): a consumer probes 「有没有 current/rounds 键」. */
export interface SuiteDocument {
  /** The rich current-suite projection, or null when the state carrier is absent/unreadable. */
  current: CurrentSuiteRun | null;
  /** The most recent rounds, NEWEST-FIRST, bounded by --limit / --since. */
  rounds: SuiteRound[];
  carrier: {
    /** The WORSE of the two carriers' states (precedence unreadable > absent >
     *  empty-writer-zero-records > ok), so a single field answers 「这批读数可信吗」. */
    state: FullSuiteStateCarrierState | "empty-writer-zero-records";
    reason: string | null;
    /** `.quay/full-suite-state.json` — the writer of the CURRENT state. */
    suiteState: SuiteCarrierState;
    /** `.quay/verification-round.jsonl` — the rounds ledger. `bytesRead`/`exhausted` are the
     *  bounded-read evidence: how much of the ledger this call actually pread, and whether it had
     *  to reach byte 0. */
    rounds: SuiteCarrierState & { bytesRead: number; exhausted: boolean };
  };
  /** false ⇔ at least one EXISTING carrier could not be read (its state is "unreadable"); the
   *  missing-carrier states are evaluated readings (there is genuinely nothing there). */
  evaluated: boolean;
}

/** The four states, worst-last. Used only to pick the combined `carrier.state` — the PER-CARRIER
 *  states are always published separately and are never collapsed by this ordering. */
const CARRIER_SEVERITY: Record<string, number> = {
  ok: 0,
  "empty-writer-zero-records": 1,
  absent: 2,
  unreadable: 3,
};

function worseOf(a: string, b: string): FullSuiteStateCarrierState | "empty-writer-zero-records" {
  return (CARRIER_SEVERITY[a] ?? 0) >= (CARRIER_SEVERITY[b] ?? 0)
    ? (a as FullSuiteStateCarrierState | "empty-writer-zero-records")
    : (b as FullSuiteStateCarrierState | "empty-writer-zero-records");
}

/** Validate `--limit`: a positive integer. Missing ⇒ the default. */
export function parseSuiteLimit(raw: unknown): { limit: number; error: string | null } {
  if (raw === undefined || raw === true) return { limit: SUITE_ROUNDS_DEFAULT_LIMIT, error: null };
  const n = typeof raw === "string" ? Number(raw) : NaN;
  if (typeof raw !== "string" || !Number.isInteger(n) || n <= 0) {
    return {
      limit: SUITE_ROUNDS_DEFAULT_LIMIT,
      error: `quay suite: --limit requires a positive integer (got ${JSON.stringify(raw)})`,
    };
  }
  return { limit: n, error: null };
}

/** Validate `--since`: an ISO 8601 instant. Missing ⇒ no bound. ⛔ An unparseable value is a usage
 *  error, never a silently-unbounded read (that would answer a different question). */
export function parseSuiteSince(raw: unknown): { sinceMs: number | null; error: string | null } {
  if (raw === undefined) return { sinceMs: null, error: null };
  if (typeof raw === "string") {
    const ms = Date.parse(raw);
    if (Number.isFinite(ms)) return { sinceMs: ms, error: null };
  }
  return {
    sinceMs: null,
    error: `quay suite: --since requires an ISO 8601 instant (e.g. 2026-10-01T00:00:00Z; got ${JSON.stringify(raw)})`,
  };
}

function buildDocument(
  suite: ReturnType<typeof readFullSuiteStateCarrier>,
  rounds: SuiteRoundsReading,
): SuiteDocument {
  const suiteState: SuiteCarrierState = { state: suite.state, reason: suite.reason };
  const roundsState = { state: rounds.state, reason: rounds.reason, bytesRead: rounds.bytesRead, exhausted: rounds.exhausted };
  const combined = worseOf(suiteState.state, roundsState.state);
  const combinedReason = combined === suiteState.state ? suiteState.reason : roundsState.reason;
  return {
    current: suite.raw == null ? null : projectCurrentSuiteRun(suite.raw),
    rounds: rounds.rounds,
    carrier: { state: combined, reason: combinedReason, suiteState, rounds: roundsState },
    evaluated: suite.state !== "unreadable" && rounds.state !== "unreadable",
  };
}

/**
 * The `quay suite` body — a pure function of (flags, resolved root), the `runLanes` pattern.
 * Always JSON (`--json` is accepted and is a no-op), read-only, no serve process.
 *
 * Exit codes: 0 = an evaluated reading (INCLUDING absent carriers and an empty --since window);
 * 1 = no workspace found, an invalid flag, or an existing carrier that could not be read
 * (⛔ that is NOT the same reading as "nothing written yet" — 硬规则 3b).
 */
export function runSuite(
  flags: Record<string, any>,
  root: string | null,
): { stdout: string; reason: string | null; exitCode: number; document: SuiteDocument | null } {
  if (!root) {
    return {
      stdout: "",
      reason: `quay suite: no .quay/config.yml found (searched from ${flags.root ?? process.cwd()} upward). Run from a quay workspace root, or pass --root <workspace-root>.`,
      exitCode: 1,
      document: null,
    };
  }
  const limit = parseSuiteLimit(flags.limit);
  if (limit.error) return { stdout: "", reason: limit.error, exitCode: 1, document: null };
  const since = parseSuiteSince(flags.since);
  if (since.error) return { stdout: "", reason: since.error, exitCode: 1, document: null };

  const suite = readFullSuiteStateCarrier(root);
  const rounds = readRecentSuiteRounds(root, { limit: limit.limit, sinceMs: since.sinceMs });
  const document = buildDocument(suite, rounds);
  return {
    stdout: JSON.stringify(document, null, 2) + "\n",
    reason: document.evaluated ? null : `quay suite: ${document.carrier.reason ?? "a carrier could not be read"}`,
    exitCode: document.evaluated ? 0 : 1,
    document,
  };
}

/**
 * Handler entry. ⚠️ Parses flags from `[sub, ...rest]` via `parseVerbless`, NOT from `ctx.flags`:
 * `suite` is a VERB-LESS top-level command (no subcommand token), so the dispatch destructure puts
 * the FIRST flag token in `sub` and `ctx.flags` would silently lose it (`quay suite --limit 3` would
 * read the default). `parseVerbless` exists for exactly this class and is the pre-existing pattern
 * for verb-less commands (see cli/flags.ts). `--json` is always accepted (output is always JSON).
 */
export async function handleSuite({ sub, rest }: CliCtx) {
  const { flags } = parseVerbless(sub, rest);
  const r = runSuite(flags, resolveRoot(flags.root));
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.reason) process.stderr.write(r.reason + "\n");
  process.exitCode = r.exitCode;
}
