#!/usr/bin/env node
// Standalone, on-demand liveness check for meta-driver's semantic half, derived from the
// backtest in tasks/gap-meta-driver-self-health-backtest.md: N>=3 consecutive non-"verified"
// attempts has zero false alarms across the full production history and detects a real outage
// within under an hour. NOT wired into `quay driver status` or any resident driver loop — see
// tasks/gap-meta-driver-minimal-production-liveness-check.md for why that's deliberately
// deferred.

import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";

const N_THRESHOLD = 3;
// Same lesson as the backtest script: the carrier's attempt fact was renamed mid-history
// ("meta-driver" -> "meta-review"); both names are the same logical routine attempt.
const ATTEMPT_FACT_NAMES = new Set(["meta-driver", "meta-review"]);

export function checkLiveness(attempts, { n = N_THRESHOLD } = {}) {
  if (!Array.isArray(attempts) || attempts.length === 0) {
    return { ok: false, state: "not-evaluated", reason: "no attempts in carrier", lastVerifiedTs: null, consecutiveNonVerified: 0 };
  }
  const sorted = [...attempts].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  let consecutive = 0;
  let lastVerifiedTs = null;
  for (const a of sorted) {
    if (a.state === "verified") {
      lastVerifiedTs = a.ts;
      consecutive = 0;
    } else {
      consecutive++;
    }
  }
  if (consecutive >= n) {
    return {
      ok: false,
      state: "degraded",
      reason: `${consecutive} consecutive non-verified attempts (threshold N=${n}); last verified at ${lastVerifiedTs || "never"}`,
      lastVerifiedTs,
      consecutiveNonVerified: consecutive,
    };
  }
  return {
    ok: true,
    state: "healthy",
    reason: `${consecutive} consecutive non-verified attempts, below threshold N=${n}`,
    lastVerifiedTs,
    consecutiveNonVerified: consecutive,
  };
}

async function extractAttempts(carrierPath) {
  if (!existsSync(carrierPath)) return null; // not-evaluated: carrier absent
  const attempts = [];
  let sawAnyLine = false;
  try {
    const rl = createInterface({ input: createReadStream(carrierPath, { encoding: "utf8" }) });
    for await (const line of rl) {
      if (!line.trim()) continue;
      sawAnyLine = true;
      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      for (const f of Array.isArray(rec.facts) ? rec.facts : []) {
        if (f && ATTEMPT_FACT_NAMES.has(f.name)) {
          attempts.push({ ts: rec.ts, state: f.state === undefined ? null : f.state });
        }
      }
    }
  } catch {
    return null; // unreadable: not-evaluated
  }
  if (!sawAnyLine) return []; // empty file: zero attempts, handled as not-evaluated by checkLiveness
  return attempts;
}

function runSelfTest() {
  const cases = [
    {
      name: "healthy: 3 verified in a row",
      attempts: [
        { ts: "2026-01-01T00:00:00Z", state: "verified" },
        { ts: "2026-01-01T00:01:00Z", state: "verified" },
        { ts: "2026-01-01T00:02:00Z", state: "verified" },
      ],
      expectState: "healthy",
    },
    {
      name: "degraded: 3 consecutive non-verified",
      attempts: [
        { ts: "2026-01-01T00:00:00Z", state: "verified" },
        { ts: "2026-01-01T00:01:00Z", state: "failed" },
        { ts: "2026-01-01T00:02:00Z", state: "failed" },
        { ts: "2026-01-01T00:03:00Z", state: "failed" },
      ],
      expectState: "degraded",
    },
    {
      name: "negative control: 2 consecutive non-verified must NOT flag",
      attempts: [
        { ts: "2026-01-01T00:00:00Z", state: "verified" },
        { ts: "2026-01-01T00:01:00Z", state: "failed" },
        { ts: "2026-01-01T00:02:00Z", state: "failed" },
      ],
      expectState: "healthy",
    },
    {
      name: "not-evaluated: empty attempts array",
      attempts: [],
      expectState: "not-evaluated",
    },
  ];
  let allPass = true;
  for (const c of cases) {
    const r = checkLiveness(c.attempts, { n: N_THRESHOLD });
    const pass = r.state === c.expectState;
    allPass = allPass && pass;
    console.log(`${pass ? "PASS" : "FAIL"}: ${c.name} (got state=${r.state}, want=${c.expectState})`);
  }
  // not-evaluated via missing carrier path, exercised through the real CLI path too
  return allPass;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) {
    const ok = runSelfTest();
    process.exit(ok ? 0 : 1);
  }
  const rootIdx = argv.indexOf("--root");
  const root = rootIdx >= 0 ? argv[rootIdx + 1] : ".";
  const carrierPath = path.join(root, ".quay", "meta-driver-round.jsonl");
  const attempts = await extractAttempts(carrierPath);
  if (attempts === null || attempts.length === 0) {
    console.error(`NOT-EVALUATED: carrier absent or unreadable at ${carrierPath}`);
    process.exit(3);
  }
  const result = checkLiveness(attempts, { n: N_THRESHOLD });
  console.error(JSON.stringify(result));
  if (result.state === "not-evaluated") process.exit(3);
  process.exit(result.ok ? 0 : 1);
}

main();
