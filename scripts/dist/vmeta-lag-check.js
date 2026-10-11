import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
import path from "node:path";
function helpExit(usage) {
  process.stdout.write(usage.endsWith("\n") ? usage : usage + "\n");
  process.exit(0);
}
function isDirectEntry(importMeta, argv1, expectedBase) {
  void importMeta;
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  return path.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/vmeta-lag-check.ts
var K_DEFAULT = 2;
function parseMilestoneNumber(text) {
  if (text == null) return null;
  const m = String(text).match(/m\s*(\d+)/i) || String(text).match(/\b(\d+)\b/);
  return m ? parseInt(m[1], 10) : null;
}
function parseRows(fullText) {
  const rows = [];
  for (const line of fullText.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("|") || !t.endsWith("|")) continue;
    if (/^\|[\s:|-]+\|$/.test(t)) continue;
    const cells = t.slice(1, -1).split("|").map((c) => c.trim());
    if (/^insight$/i.test(cells[0])) continue;
    if (cells.length < 2) continue;
    rows.push({ cells, raw: t });
  }
  return rows;
}
function rowStatus(statusCell) {
  if (statusCell == null) return null;
  const s = String(statusCell).trim();
  const m = s.match(/^\*{0,2}\[(consolidated|confirmed|proposed)\]\*{0,2}/i);
  if (!m) return null;
  return m[1].toLowerCase();
}
function confirmingMilestone(cell) {
  if (cell == null) return null;
  const s = String(cell);
  const explicit = s.match(/confirmed@\s*m?\s*(\d+)/i) || s.match(/crossed(?:\s+at)?\s+m?\s*(\d+)/i) || s.match(/confirmed\s+m?\s*(\d+)/i) || s.match(/\bm(\d+)\b/i);
  return explicit ? parseInt(explicit[1], 10) : null;
}
function hasDatedCarryForward(cell) {
  if (cell == null) return false;
  const s = String(cell);
  const hasMarker = /carry[\s-]?forward|carried forward|deferred until|defer to/i.test(s);
  const hasIsoDate = /\b\d{4}-\d{2}-\d{2}\b/.test(s);
  return hasMarker && hasIsoDate;
}
function evaluateRow(row, milestoneCounter, K = K_DEFAULT) {
  const status = row.status;
  if (status === "consolidated") {
    return { lag: null, alarm: false, reason: "consolidated \u2014 lag gate does not apply" };
  }
  if (status === "proposed") {
    return { lag: null, alarm: false, reason: "proposed \u2014 not past \u03C6 threshold, no lag gate" };
  }
  if (status !== "confirmed") {
    return { lag: null, alarm: true, reason: `unrecognized/absent lifecycle status (status=${status ?? "none"}) on a data row \u2014 fail-closed ALARM (never silent-skip)` };
  }
  if (row.confirming == null) {
    return { lag: null, alarm: true, reason: "confirmed row but confirming milestone number is unparseable \u2014 fail-closed ALARM" };
  }
  const lag = milestoneCounter - row.confirming;
  if (lag <= K) {
    return { lag, alarm: false, reason: `lag=${lag} <= K=${K} \u2014 within threshold` };
  }
  if (hasDatedCarryForward(row.statusCell)) {
    return { lag, alarm: false, reason: `lag=${lag} > K=${K} but a DATED carry-forward reason is recorded` };
  }
  return { lag, alarm: true, reason: `lag=${lag} > K=${K}, confirmed-not-consolidated, NO dated carry-forward \u2014 ALARM` };
}
function readMilestoneCounter(fullText) {
  const m = fullText.match(/milestone_counter\s*[:=]\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}
function checkLedger(fullText, opts = {}) {
  const K = typeof opts.K === "number" ? opts.K : K_DEFAULT;
  const rows = parseRows(fullText).map((r) => ({
    insight: r.cells[0],
    statusCell: r.cells[r.cells.length - 1],
    confirmCell: r.cells.length >= 3 ? r.cells[r.cells.length - 2] : "",
    status: rowStatus(r.cells[r.cells.length - 1]),
    raw: r.raw
  }));
  const milestoneCounter = typeof opts.milestoneCounter === "number" ? opts.milestoneCounter : readMilestoneCounter(fullText);
  if (rows.length === 0 && milestoneCounter == null) {
    return { verdict: "N/A", milestoneCounter: null, K, evaluations: [], alarms: [], reason: "no ledger rows and no milestone_counter \u2014 N/A (nothing to gate)" };
  }
  if (rows.length > 0 && milestoneCounter == null) {
    return { verdict: "FAIL", milestoneCounter: null, K, evaluations: [], alarms: [], reason: "ledger has rows but no milestone_counter derivable (pass --counter <N> or add a `milestone_counter: <N>` marker) \u2014 fail-closed" };
  }
  const evaluations = rows.map((r) => {
    const confirming = confirmingMilestone(`${r.confirmCell} ${r.statusCell}`);
    const res = evaluateRow({ status: r.status, confirming, statusCell: r.statusCell }, milestoneCounter, K);
    return { insight: r.insight, status: r.status, confirming, ...res };
  });
  const alarms = evaluations.filter((e) => e.alarm);
  return {
    verdict: alarms.length === 0 ? "PASS" : "FAIL",
    milestoneCounter,
    K,
    evaluations,
    alarms,
    reason: alarms.length === 0 ? "no confirmed-unconsolidated row past K without a dated carry-forward" : `${alarms.length} row(s) past K=${K} without consolidation or a dated carry-forward`
  };
}
async function main(argv) {
  const fs = await import("node:fs");
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit("usage: node vmeta-lag-check.ts [--counter <N>] [--threshold <K>] <v-meta-ledger.md>");
  let counterOverride;
  let thresholdOverride;
  const files = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--counter") {
      counterOverride = parseInt(args[++i], 10);
      continue;
    }
    if (args[i] === "--threshold") {
      thresholdOverride = parseInt(args[++i], 10);
      continue;
    }
    files.push(args[i]);
  }
  if (files.length !== 1) {
    console.error("usage: node vmeta-lag-check.ts [--counter <N>] [--threshold <K>] <v-meta-ledger.md>");
    return 2;
  }
  let text;
  try {
    text = fs.readFileSync(files[0], "utf8");
  } catch (e) {
    console.error(`ERROR: cannot read file: ${files[0]} (${e.message})`);
    return 2;
  }
  const opts = {};
  if (typeof counterOverride === "number" && !Number.isNaN(counterOverride)) opts.milestoneCounter = counterOverride;
  if (typeof thresholdOverride === "number" && !Number.isNaN(thresholdOverride)) opts.K = thresholdOverride;
  const rep = checkLedger(text, opts);
  console.log(`V_meta consolidation-lag check \u2014 ${files[0]}`);
  console.log(`milestone_counter=${rep.milestoneCounter ?? "?"} K=${rep.K}`);
  for (const e of rep.evaluations) {
    const tag = e.alarm ? "ALARM" : "ok";
    console.log(`  [${tag}] ${e.status ?? "?"} | lag=${e.lag ?? "-"} | ${e.reason} | ${e.insight}`);
  }
  console.log("");
  console.log(`${rep.verdict}: ${rep.reason}`);
  if (rep.verdict === "FAIL") return 1;
  return 0;
}
var isDirect = isDirectEntry(import.meta, process.argv[1], "vmeta-lag-check");
if (isDirect) {
  main(process.argv).then((code) => process.exit(code));
}
export {
  checkLedger,
  confirmingMilestone,
  evaluateRow,
  hasDatedCarryForward,
  parseMilestoneNumber,
  parseRows,
  readMilestoneCounter,
  rowStatus
};
