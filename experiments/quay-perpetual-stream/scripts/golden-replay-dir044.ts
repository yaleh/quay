// golden-replay-dir044.ts — the terminal golden-replay proof for the concurrent scheduler (DIR-044
// increment 5; charters/DIR-044-concurrent-scheduler-D3.md Step 3). It replays a REAL, recorded,
// touches-disjoint milestone PAIR — DIR-039 (M62, merge 7ca6043) ∥ DIR-042-A (M59, merge 3e7556b) —
// through the WHOLE pipeline (orthogonality → batch → fan-in → anti-drift) and asserts the end-state
// equals the frozen SERIAL oracle: the two run concurrently, fan in with milestone_counter advancing
// by exactly 2, both dashboard entries present, and the after-the-fact anti-drift check finds NO
// overlap (because their real recorded diffs were disjoint). The touches are the RECORDED build
// file-sets (frozen fixtures), replayed via an identity expander — this replays history, not the
// current tree.
//
// Exit 0 = the concurrent path reproduces the serial oracle (behavior-preserving). Exit 1 = a
// divergence (NOT behavior-preserving → the milestone must be sent back).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseTouches, checkTouchesPair } from "./touches-orthogonality-check.ts";
import { parseCandidate, assembleBatch } from "./concurrent-batch-scheduler.ts";
import { computeFanIn, verifyMonotonic } from "./serial-fanin-absorb.ts";
import { checkAntiDrift } from "./anti-drift-touches-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOLD = path.join(__dirname, "..", "fixtures", "golden");

interface Oracle {
  startCounter: number;
  counterDelta: number;
  buildCount: number;
  disjoint: boolean;
  antiDriftClean: boolean;
}

// The frozen SERIAL oracle (recorded fact, pinned at charter time):
//   DIR-042-A ran at M59 (counter 58→59), DIR-039 ran at M62 (counter 61→62), each a clean gate-PASS
//   ABSORB with NO REFUTATION FOUND. IF batched concurrently from a common start, the fan-in must
//   advance the counter by exactly 2 and record both entries with zero conflict.
const ORACLE: Oracle = { startCounter: 58, counterDelta: 2, buildCount: 2, disjoint: true, antiDriftClean: true };

// Recorded touches are exact file paths — an identity expander faithfully replays the recorded
// build file-sets (do NOT re-expand against the current tree, which may have moved files).
function identityExpand(globs: string[]): Set<string> {
  const out = new Set<string>();
  for (const g of globs) if (!/[*?]/.test(g)) out.add(g); // exact paths only (recorded diffs)
  return out;
}

interface ReplayResult {
  ok: boolean;
  msg: string;
  checks: [string, boolean][];
  plan?: ReturnType<typeof computeFanIn>;
}

function fail(msg: string, checks: [string, boolean][]): ReplayResult { return { ok: false, msg, checks }; }

export function runGoldenReplay(): ReplayResult {
  const checks: [string, boolean][] = [];
  const dir039Text = fs.readFileSync(path.join(GOLD, "dir039.charter.md"), "utf8");
  const dir042Text = fs.readFileSync(path.join(GOLD, "dir042a.charter.md"), "utf8");
  const t039 = parseTouches(dir039Text);
  const t042 = parseTouches(dir042Text);

  // (1) orthogonality: the recorded build file-sets are DISJOINT.
  const ortho = checkTouchesPair(t039, t042, identityExpand);
  checks.push(["orthogonality DISJOINT", ortho.disjoint]);
  if (ortho.disjoint !== ORACLE.disjoint) return fail(`orthogonality: expected disjoint=${ORACLE.disjoint}, got ${ortho.disjoint} (${ortho.reason})`, checks);

  // (2) scheduler: both go in ONE concurrent batch.
  const cands = [parseCandidate("M-dir039-migration", dir039Text), parseCandidate("M-dir042a-dod-gate-set", dir042Text)];
  const batch = assembleBatch(cands, { expand: identityExpand });
  const twoWide = batch.batch.length === ORACLE.buildCount && batch.deferred.length === 0;
  checks.push([`scheduler ${ORACLE.buildCount}-wide batch`, twoWide]);
  if (!twoWide) return fail(`scheduler: expected ${ORACLE.buildCount}-wide batch, got ${batch.batch.length} (deferred: ${batch.deferred.map((d: any) => d.id).join(",")})`, checks);

  // (3) fan-in: counter advances by exactly 2, both entries, contiguous.
  const builds = [
    { id: "M-dir039-migration", dashboardEntry: "DIR-039 migration/import capability (golden replay)" },
    { id: "M-dir042a-dod-gate-set", dashboardEntry: "DIR-042-A generic DoD gate set (golden replay)" },
  ];
  const plan = computeFanIn(ORACLE.startCounter, builds);
  const counterOk = plan.counterAfter - plan.counterBefore === ORACLE.counterDelta && verifyMonotonic(plan) && plan.entries.length === ORACLE.buildCount;
  checks.push([`fan-in counter +${ORACLE.counterDelta}, both entries, monotonic`, counterOk]);
  if (!counterOk) return fail(`fan-in: expected +${ORACLE.counterDelta} monotonic with ${ORACLE.buildCount} entries, got +${plan.counterAfter - plan.counterBefore}`, checks);

  // (4) anti-drift: the real recorded diffs stayed within declaration and did not overlap.
  const ranManifest = JSON.parse(fs.readFileSync(path.join(GOLD, "ran-batch.actual.json"), "utf8"));
  const drift = checkAntiDrift(ranManifest);
  checks.push(["anti-drift clean (no overlap, no stray write)", drift.ok === ORACLE.antiDriftClean]);
  if (drift.ok !== ORACLE.antiDriftClean) return fail(`anti-drift: expected ok=${ORACLE.antiDriftClean}, got ${drift.ok} (${JSON.stringify(drift.violations)})`, checks);

  return { ok: true, msg: "concurrent path reproduces the serial oracle (counter +2, both entries, disjoint, no drift)", checks, plan };
}

export async function main(): Promise<number> {
  const r = runGoldenReplay();
  process.stdout.write("GOLDEN REPLAY — DIR-039 ∥ DIR-042-A (recorded pair) through the concurrent pipeline:\n");
  for (const [name, pass] of r.checks) process.stdout.write(`  ${pass ? "PASS" : "FAIL"}: ${name}\n`);
  process.stdout.write((r.ok ? "OK: " : "DIVERGENCE: ") + r.msg + "\n");
  return r.ok ? 0 : 1;
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) {
  main().then((code) => process.exit(code));
}
