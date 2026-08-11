// serial-fanin-absorb.mjs — the deterministic serial fan-in ABSORB plan (DIR-044 increment 3; see
// charters/DIR-044-concurrent-scheduler-D3.md Step 2 increment 3). After a touches-disjoint batch of
// N builds runs in parallel background subagents (each deferring ALL shared-state writes), the fan-in
// merges them one-at-a-time and applies the shared-state mutations they deferred: advance
// milestone_counter by exactly N, append N dashboard entries. Because background builds finish in
// NONDETERMINISTIC order, the plan is made reproducible by a stable sort on milestone id — the same
// batch always fans in identically.
//
// This module computes the PLAN (pure, testable). The driver executes the git merges + file writes
// from it. Native-only, no manda.
//
// Pure functions are exported and unit-tested; `main()` is a thin CLI over them.

import fs from "node:fs";
import { isDirectEntry } from "./gate-script-base.ts";

// ── computeFanIn ─────────────────────────────────────────────────────────────────────────────────
// startCounter: the milestone_counter BEFORE this fan-in. builds: [{ id, dashboardEntry }].
// Returns { counterBefore, counterAfter, order:[id...], entries:[{ id, milestone, dashboardEntry }] }.
export function computeFanIn(startCounter, builds) {
  if (!Number.isInteger(startCounter) || startCounter < 0) {
    throw new Error(`computeFanIn: startCounter must be a non-negative integer (got ${startCounter})`);
  }
  if (!Array.isArray(builds) || builds.length === 0) {
    throw new Error("computeFanIn: empty builds — nothing to absorb");
  }
  const ids = new Set();
  for (const b of builds) {
    if (!b || typeof b.id !== "string" || !b.id) throw new Error("computeFanIn: every build needs a string id");
    if (ids.has(b.id)) throw new Error(`computeFanIn: duplicate build id "${b.id}" — a batch cannot contain the same milestone twice`);
    ids.add(b.id);
    if (typeof b.dashboardEntry !== "string" || !b.dashboardEntry) {
      throw new Error(`computeFanIn: build "${b.id}" is missing a dashboardEntry — every absorbed milestone records one`);
    }
  }
  // Deterministic merge order: stable sort by id (independent of completion order).
  const order = [...builds].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const entries = order.map((b, i) => ({ id: b.id, milestone: startCounter + 1 + i, dashboardEntry: b.dashboardEntry }));
  return { counterBefore: startCounter, counterAfter: startCounter + builds.length, order: order.map((b) => b.id), entries };
}

// ── verifyMonotonic ──────────────────────────────────────────────────────────────────────────────
// A plan is valid iff counterAfter == counterBefore + N and milestone numbers are contiguous,
// strictly increasing, starting at counterBefore+1.
export function verifyMonotonic(plan) {
  if (!plan || !Array.isArray(plan.entries)) return false;
  const n = plan.entries.length;
  if (plan.counterAfter !== plan.counterBefore + n) return false;
  for (let i = 0; i < n; i++) {
    if (plan.entries[i].milestone !== plan.counterBefore + 1 + i) return false;
  }
  return true;
}

// ── renderDashboardAppend ────────────────────────────────────────────────────────────────────────
// Deterministic markdown block the driver appends to dashboard.md at fan-in.
export function renderDashboardAppend(plan) {
  const lines = ["", `<!-- serial fan-in ABSORB: counter ${plan.counterBefore} → ${plan.counterAfter} (${plan.entries.length} concurrent builds) -->`];
  for (const e of plan.entries) {
    lines.push(`## M${e.milestone} ABSORB (fan-in) — ${e.id}`, e.dashboardEntry, "");
  }
  return lines.join("\n");
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
function usage() {
  process.stderr.write("Usage: serial-fanin-absorb.mjs --counter <N> <builds-manifest.json>\n");
}

export async function main(argv) {
  const args = argv.slice(2);
  let counter = null;
  const files = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--counter") { counter = Number(args[++i]); continue; }
    files.push(args[i]);
  }
  if (counter === null || Number.isNaN(counter) || files.length !== 1) { usage(); return 2; }
  if (!fs.existsSync(files[0])) { process.stderr.write(`ERROR: manifest not found: ${files[0]}\n`); return 2; }
  let builds;
  try {
    builds = JSON.parse(fs.readFileSync(files[0], "utf8"));
  } catch (e) {
    process.stderr.write(`ERROR: manifest is not valid JSON: ${e.message}\n`);
    return 2;
  }
  let plan;
  try {
    plan = computeFanIn(counter, builds);
  } catch (e) {
    process.stderr.write(`ERROR: ${e.message}\n`);
    return 2;
  }
  if (!verifyMonotonic(plan)) { process.stderr.write("ERROR: computed plan failed monotonicity check\n"); return 2; }
  process.stdout.write(`FAN-IN: counter ${plan.counterBefore} → ${plan.counterAfter}; order: ${plan.order.join(" → ")}\n`);
  process.stdout.write(renderDashboardAppend(plan) + "\n");
  return 0;
}

if (isDirectEntry(import.meta, undefined, "serial-fanin-absorb")) {
  main(process.argv).then((code) => process.exit(code));
}
