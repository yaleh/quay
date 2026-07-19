// vmeta-lag-check.mjs — the ONE canonical implementation of the V_meta consolidation-lag ARITHMETIC
// (exp5-M-CRYST-D3 increment R5, Axis-2′). This module IS the rule: pure, side-effect-free check
// functions consumed by the standalone CLI (vmeta-lag-check.mjs's own main below, invoked via
// vmeta-lag-check.sh) and wrappable, unchanged, by a future `quay gate --gate vmeta-lag` (M39
// registry precedent — a named gate WRAPS this, never reimplements the logic). If this header
// comment and the code ever disagree, THE CODE WINS.
//
// ── The rule (DIR-005 §"Requested action" 2/3 + OUTER-LOOP.md ABSORB "V_meta consolidation-lag
//    gate") ──────────────────────────────────────────────────────────────────────────────────────
//   For each ROW of `v-meta-ledger.md`:
//     milestones-since-confirmed = milestone_counter (current, pre-increment) − confirming-milestone
//   ALARM when milestones-since-confirmed > K (K=2, the health-track threshold) for any row that is
//   `confirmed` (past the φ 2-cross-domain-confirmation threshold) but NOT yet `consolidated`, AND
//   whose status cell carries NO explicit DATED carry-forward reason (a carry-forward marker plus an
//   ISO YYYY-MM-DD date — "no silent deferral"). A `consolidated` row never alarms; a `proposed` row
//   never alarms (it has not crossed the confirmation threshold). FAIL-CLOSED (never silent PASS) on:
//   a `confirmed` row whose confirming-milestone number is unparseable; an AMBIGUOUS status cell that
//   names >1 distinct lifecycle word (e.g. an overdue row phrased "not consolidated yet, still
//   confirmed" — must NOT be read as consolidated); and a data row whose status cell carries NO
//   lifecycle keyword at all (unrecognized/absent → cannot classify → ALARM). If the ledger has NO
//   parseable rows AND no milestone_counter, the verdict is an EXPLICIT "N/A" — never a silent pass.
//
//   This module ONLY computes the arithmetic + the disposition decision. It does NOT author the
//   ABSORB narrative and does NOT itself edit the ledger — those remain human/loop actions the
//   OUTER-LOOP ABSORB step still describes (consolidate-or-dated-carry-forward). it0-dod-check.mjs
//   Clause 2's independent ABSORB-text TOKEN scan is complementary and unchanged (it checks the
//   DISPOSITION was narrated; this checks the ARITHMETIC is actually clear).

const K_DEFAULT = 2;

// ── parseMilestoneNumber — pull an integer milestone number from an "m<N>"/"M<N>"/bare-<N> token. ─
export function parseMilestoneNumber(text) {
  if (text == null) return null;
  const m = String(text).match(/m\s*(\d+)/i) || String(text).match(/\b(\d+)\b/);
  return m ? parseInt(m[1], 10) : null;
}

// ── parseRows — extract data rows from the ledger's GFM pipe table (`| a | b | c | status |`). ────
// Skips the header row and the `|---|---|` separator. Each returned row: { cells: string[], raw }.
export function parseRows(fullText) {
  const rows = [];
  for (const line of fullText.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("|") || !t.endsWith("|")) continue;
    if (/^\|[\s:|-]+\|$/.test(t)) continue; // separator row
    const cells = t.slice(1, -1).split("|").map((c) => c.trim());
    // header row: first cell literally "insight" (case-insensitive) — skip.
    if (/^insight$/i.test(cells[0])) continue;
    if (cells.length < 2) continue;
    rows.push({ cells, raw: t });
  }
  return rows;
}

// ── rowStatus — read the CURRENT lifecycle word from a status cell (FAIL-CLOSED, leading-token). ───
// R5 review must-fix #1: robustly parsing arbitrary prose negation is a losing game (ADR-004 — soft
// prose is erodible). So instead of scanning for negators anywhere, read ONLY the LEADING canonical
// token: the cell MUST start with exactly one lifecycle word (optionally **bold**); everything after
// it is history/notes and is IGNORED (so "**consolidated** (m7…) … not a carry-forward … twice-
// confirmed" cleanly reads consolidated, ignoring the trailing "not"/"confirmed"). FAIL-CLOSED (→ null
// → alarm at evaluateRow) when the cell does NOT lead with a clean token — i.e. it leads with a
// non-lifecycle word ("not yet fully consolidated…", "not-yet-consolidated", "folding into…"), OR the
// leading token is immediately followed by a status-contradicting qualifier ("consolidated pending",
// "consolidated? no", "consolidated: FALSE"). This errs toward ALARM, never a silent PASS.
// NOTE (ADR-004 follow-up): the real hard fix is a STRUCTURED status field in the ledger, not prose;
// this leading-token parser is the fail-closed interim. Tracked for the next ledger-format increment.
const QUALIFIER_AFTER = /^(pending|not|no|false|incomplete|partial|wip|todo|awaiting|yet|maybe|unclear|tbd|unconfirmed|unconsolidated)\b/i;
const NOTE_DELIM = /^\s*[—–(,;·]/; // a note/history follows → the leading token stands (em/en-dash, paren, comma, semicolon, mid-dot)
export function rowStatus(statusCell) {
  if (statusCell == null) return null;
  const s = String(statusCell).replace(/\*+/g, "").trim(); // strip bold decoration
  const m = s.match(/^(consolidated|confirmed|proposed)\b([\s\S]*)$/i);
  if (!m) return null;                       // does not LEAD with a lifecycle word → fail-closed
  const status = m[1].toLowerCase();
  const rest = m[2];
  if (rest === "") return status;            // token alone
  if (NOTE_DELIM.test(rest)) return status;  // token — <note>  (trailing prose ignored)
  const ws = rest.match(/^\s+(\S+)/);         // token <word> …  (no delimiter between)
  if (ws) return QUALIFIER_AFTER.test(ws[1]) ? null : status; // "consolidated pending" → fail-closed
  return null;                               // token immediately followed by ?/:/@… → fail-closed
}

// ── confirmingMilestone — the milestone number at which the row crossed the φ threshold. ──────────
// Prefers the explicit `confirmed@m<N>` marker; falls back to "crossed at m<N>" / "confirmed m<N>";
// last resort, the first `m<N>` token in the cell.
export function confirmingMilestone(cell) {
  if (cell == null) return null;
  const s = String(cell);
  const explicit = s.match(/confirmed@\s*m?\s*(\d+)/i)
    || s.match(/crossed(?:\s+at)?\s+m?\s*(\d+)/i)
    || s.match(/confirmed\s+m?\s*(\d+)/i)
    || s.match(/\bm(\d+)\b/i);
  return explicit ? parseInt(explicit[1], 10) : null;
}

// ── hasDatedCarryForward — a carry-forward marker AND an ISO date in the same cell. ───────────────
export function hasDatedCarryForward(cell) {
  if (cell == null) return false;
  const s = String(cell);
  const hasMarker = /carry[\s-]?forward|carried forward|deferred until|defer to/i.test(s);
  const hasIsoDate = /\b\d{4}-\d{2}-\d{2}\b/.test(s);
  return hasMarker && hasIsoDate;
}

// ── evaluateRow — the arithmetic + decision for one already-parsed row. ───────────────────────────
// row: { status, confirming, statusCell }. Returns { lag, alarm, reason }.
export function evaluateRow(row, milestoneCounter, K = K_DEFAULT) {
  const status = row.status;
  if (status === "consolidated") {
    return { lag: null, alarm: false, reason: "consolidated — lag gate does not apply" };
  }
  if (status === "proposed") {
    return { lag: null, alarm: false, reason: "proposed — not past φ threshold, no lag gate" };
  }
  // FAIL-CLOSED (R5 review must-fix #2): a data row with NO non-negated lifecycle word (keyword-less,
  // or "not yet consolidated" only) cannot be classified — it must ALARM, never silently pass as
  // status=null. Only "consolidated"/"proposed" (above) and "confirmed" (below) pass cleanly.
  if (status !== "confirmed") {
    return { lag: null, alarm: true, reason: `unrecognized/absent lifecycle status (status=${status ?? "none"}) on a data row — fail-closed ALARM (never silent-skip)` };
  }
  // confirmed & not consolidated → arithmetic applies.
  if (row.confirming == null) {
    return { lag: null, alarm: true, reason: "confirmed row but confirming milestone number is unparseable — fail-closed ALARM" };
  }
  const lag = milestoneCounter - row.confirming;
  if (lag <= K) {
    return { lag, alarm: false, reason: `lag=${lag} <= K=${K} — within threshold` };
  }
  if (hasDatedCarryForward(row.statusCell)) {
    return { lag, alarm: false, reason: `lag=${lag} > K=${K} but a DATED carry-forward reason is recorded` };
  }
  return { lag, alarm: true, reason: `lag=${lag} > K=${K}, confirmed-not-consolidated, NO dated carry-forward — ALARM` };
}

// ── readMilestoneCounter — from the ledger's own `milestone_counter: <N>` marker (comment or text). ─
export function readMilestoneCounter(fullText) {
  const m = fullText.match(/milestone_counter\s*[:=]\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

// ── checkLedger — the SINGLE entry point (CLI + any future quay gate both call this). ─────────────
// opts.milestoneCounter overrides the in-file marker (the loop passes the live counter). opts.K
// overrides the threshold (default 2).
export function checkLedger(fullText, opts = {}) {
  const K = typeof opts.K === "number" ? opts.K : K_DEFAULT;
  const rows = parseRows(fullText).map((r) => ({
    insight: r.cells[0],
    statusCell: r.cells[r.cells.length - 1],
    confirmCell: r.cells.length >= 3 ? r.cells[r.cells.length - 2] : "",
    status: rowStatus(r.cells[r.cells.length - 1]),
    raw: r.raw,
  }));
  const milestoneCounter = typeof opts.milestoneCounter === "number"
    ? opts.milestoneCounter
    : readMilestoneCounter(fullText);

  if (rows.length === 0 && milestoneCounter == null) {
    return { verdict: "N/A", milestoneCounter: null, K, evaluations: [], alarms: [], reason: "no ledger rows and no milestone_counter — N/A (nothing to gate)" };
  }
  if (rows.length > 0 && milestoneCounter == null) {
    return { verdict: "FAIL", milestoneCounter: null, K, evaluations: [], alarms: [], reason: "ledger has rows but no milestone_counter derivable (pass --counter <N> or add a `milestone_counter: <N>` marker) — fail-closed" };
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
    reason: alarms.length === 0 ? "no confirmed-unconsolidated row past K without a dated carry-forward" : `${alarms.length} row(s) past K=${K} without consolidation or a dated carry-forward`,
  };
}

// ── CLI main (only when run directly). Prints a per-row report + summary; exits 0/1/2. ────────────
async function main(argv) {
  const fs = await import("node:fs");
  const args = argv.slice(2);
  let counterOverride;
  const files = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--counter") { counterOverride = parseInt(args[++i], 10); continue; }
    files.push(args[i]);
  }
  if (files.length !== 1) {
    console.error("usage: node vmeta-lag-check.mjs [--counter <N>] <v-meta-ledger.md>");
    return 2;
  }
  let text;
  try { text = fs.readFileSync(files[0], "utf8"); }
  catch (e) { console.error(`ERROR: cannot read file: ${files[0]} (${e.message})`); return 2; }

  const opts = {};
  if (typeof counterOverride === "number" && !Number.isNaN(counterOverride)) opts.milestoneCounter = counterOverride;
  const rep = checkLedger(text, opts);

  console.log(`V_meta consolidation-lag check — ${files[0]}`);
  console.log(`milestone_counter=${rep.milestoneCounter ?? "?"} K=${rep.K}`);
  for (const e of rep.evaluations) {
    const tag = e.alarm ? "ALARM" : "ok";
    console.log(`  [${tag}] ${e.status ?? "?"} | lag=${e.lag ?? "-"} | ${e.reason} | ${e.insight}`);
  }
  console.log("");
  console.log(`${rep.verdict}: ${rep.reason}`);
  if (rep.verdict === "FAIL") return 1;
  return 0; // PASS and N/A are both exit-0-neutral (N/A is EXPLICIT, printed above, never silent)
}

// Run the CLI only when this file is the entry point (not when imported by tests / a quay gate).
import { fileURLToPath } from "node:url";
const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) {
  main(process.argv).then((code) => process.exit(code));
}
