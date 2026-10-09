#!/usr/bin/env node
// Deterministic, zero-LLM backtest: how early could a minimal liveness rule have caught
// meta-driver's semantic-half outage, and at what false-alarm cost? See
// tasks/gap-meta-driver-self-health-backtest.md for the task this implements.
//
// Reads .quay/meta-driver-round.jsonl (streamed — the file is ~200MB, never loaded whole),
// extracts every {ts, state, reason} tuple for facts named "meta-review", and sweeps a fixed
// grid of count-based and time-window-based liveness rules against the real history.

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";

const COUNT_NS = [1, 3, 5, 10, 20];
const WINDOW_MS = {
  "15m": 15 * 60 * 1000,
  "30m": 30 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "3h": 3 * 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
};

function parseArgs(argv) {
  const out = { mode: "run" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--in") out.in = argv[++i];
    else if (a === "--out") out.out = argv[++i];
  }
  return out;
}

// The carrier's semantic-attempt fact was renamed mid-history: "meta-driver" (the original
// name, used 2026-09-06..2026-09-29, states verified/failed/not-evaluated) and "meta-review"
// (introduced 2026-09-14, overlapping the old name through 2026-09-29 under the SAME anchor
// run_id — a live source self-refresh renamed the fact, not a process handoff). Both names
// carry an identical {name,value,state,reason} shape (verified empirically: 0 of 2319 such
// facts lack a `state` key) and are the same logical routine attempt — treating only one name
// as the signal (an earlier draft of this script did exactly that) silently drops the real
// 2026-09-12..09-14 "probe spawn error: spawn E2BIG" outage from the history entirely.
const ATTEMPT_FACT_NAMES = new Set(["meta-driver", "meta-review"]);

async function extractAttempts(inPath) {
  const attempts = [];
  const rl = createInterface({ input: createReadStream(inPath, { encoding: "utf8" }) });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue; // malformed/truncated line — skip, do not crash the stream
    }
    const facts = Array.isArray(rec.facts) ? rec.facts : [];
    for (const f of facts) {
      if (f && ATTEMPT_FACT_NAMES.has(f.name)) {
        attempts.push({ ts: rec.ts, name: f.name, state: f.state === undefined ? null : f.state, reason: f.reason || null });
      }
    }
  }
  attempts.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0)); // chronological, not by `round` (resets per respawn)
  return attempts;
}

// First attempt index that starts the continuous non-verified streak running to EOF.
function findOutageStart(attempts) {
  for (let i = attempts.length - 1; i >= 0; i--) {
    if (attempts[i].state === "verified") {
      return i + 1 < attempts.length ? i + 1 : null; // the attempt right after the last verified
    }
  }
  return attempts.length > 0 ? 0 : null; // never verified at all
}

function countBasedRule(attempts, N) {
  // Fires at the first index i where the preceding N consecutive attempts are all non-verified.
  const fireEvents = [];
  let run = 0;
  for (let i = 0; i < attempts.length; i++) {
    if (attempts[i].state !== "verified") run++;
    else run = 0;
    if (run === N) fireEvents.push(i); // fires exactly once per streak onset (run going from N-1 to N)
  }
  return fireEvents;
}

function windowBasedRule(attempts, windowMs) {
  // Fires at the first attempt whose ts is more than windowMs after the last verified attempt
  // seen so far (or after the first attempt, if none has ever been verified yet).
  const fireEvents = [];
  let lastVerifiedTs = null;
  let armed = true; // becomes false while flagged, re-arms once a verified attempt clears it
  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i];
    if (a.state === "verified") {
      lastVerifiedTs = a.ts;
      armed = true;
      continue;
    }
    const baseline = lastVerifiedTs || attempts[0]?.ts;
    if (!baseline) continue;
    const elapsed = new Date(a.ts).getTime() - new Date(baseline).getTime();
    if (elapsed > windowMs && armed) {
      fireEvents.push(i);
      armed = false; // don't re-fire every subsequent attempt in the same sustained outage
    }
  }
  return fireEvents;
}

// Classify each fire event as the one real sustained outage vs. a transient false alarm:
// a fire is a false alarm if a LATER verified attempt occurs before the next fire (i.e. the
// system recovered on its own shortly after), excluding the final fire that leads into the
// real, still-ongoing outage at EOF.
function classifyFires(attempts, fireIdxs, outageStartIdx) {
  let falseAlarms = 0;
  const falseAlarmTimestamps = [];
  let detection = null;
  for (const idx of fireIdxs) {
    if (outageStartIdx !== null && idx >= outageStartIdx) {
      if (detection === null) detection = attempts[idx].ts; // first fire at/after real outage start
      continue;
    }
    // fire before the real outage: false alarm iff a later verified attempt exists after it
    const recovered = attempts.slice(idx + 1).some((a) => a.state === "verified");
    if (recovered) {
      falseAlarms++;
      falseAlarmTimestamps.push(attempts[idx].ts);
    }
  }
  return { detectionTs: detection, falseAlarms, falseAlarmTimestamps };
}

async function run(opts) {
  const attempts = await extractAttempts(opts.in);
  const totalAttempts = attempts.length;
  const totalFailed = attempts.filter((a) => a.state === "failed").length;
  const totalVerified = attempts.filter((a) => a.state === "verified").length;

  const outageStartIdx = findOutageStart(attempts);
  const outageStartTs = outageStartIdx !== null ? attempts[outageStartIdx].ts : null;
  const lastVerified = [...attempts].reverse().find((a) => a.state === "verified");
  const lastVerifiedTs = lastVerified ? lastVerified.ts : null;

  // attempt gap before the outage: time between last verified and the first attempt of the
  // real outage streak, MINUS double-counting if they are adjacent (gap=0 means no skipped
  // attempts, the very next attempt already failed).
  let attemptGapMs = null;
  if (lastVerifiedTs && outageStartTs) {
    attemptGapMs = new Date(outageStartTs).getTime() - new Date(lastVerifiedTs).getTime();
  }

  const rules = [];
  for (const N of COUNT_NS) {
    const fires = countBasedRule(attempts, N);
    const { detectionTs, falseAlarms, falseAlarmTimestamps } = classifyFires(attempts, fires, outageStartIdx);
    rules.push({
      rule_family: "count",
      param: N,
      fired_at: detectionTs,
      detection_delay_ms: detectionTs && outageStartTs ? new Date(detectionTs).getTime() - new Date(outageStartTs).getTime() : null,
      false_alarm_count: falseAlarms,
      false_alarm_timestamps: falseAlarmTimestamps,
    });
  }
  for (const [label, ms] of Object.entries(WINDOW_MS)) {
    const fires = windowBasedRule(attempts, ms);
    const { detectionTs, falseAlarms, falseAlarmTimestamps } = classifyFires(attempts, fires, outageStartIdx);
    rules.push({
      rule_family: "window",
      param: label,
      fired_at: detectionTs,
      detection_delay_ms: detectionTs && outageStartTs ? new Date(detectionTs).getTime() - new Date(outageStartTs).getTime() : null,
      false_alarm_count: falseAlarms,
      false_alarm_timestamps: falseAlarmTimestamps,
    });
  }

  const result = {
    outage_start_ts: outageStartTs,
    last_verified_ts: lastVerifiedTs,
    total_attempts: totalAttempts,
    total_failed: totalFailed,
    total_verified: totalVerified,
    attempt_gap_before_outage_ms: attemptGapMs,
    rules,
  };
  writeFileSync(opts.out, JSON.stringify(result, null, 2) + "\n", "utf8");
  return result;
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.in || !opts.out) {
  console.error("usage: meta-driver-self-health-backtest.mjs --in <round.jsonl> --out <results.json>");
  process.exit(2);
}
run(opts).then((r) => {
  console.error(`attempts=${r.total_attempts} failed=${r.total_failed} verified=${r.total_verified} outage_start=${r.outage_start_ts}`);
  process.exit(0);
}).catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
