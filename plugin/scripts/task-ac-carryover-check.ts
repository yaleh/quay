// task-ac-carryover-check.ts — the AC-carryover gate
// (tasks/gap-nothing-checks-whether-a-done-task-left-its-acs-behind).
//
// SCOPE BOUNDARY (2026-08-03): this checker reads TASK FILES, not `.workflow-events/`.
// AC carryover (which unchecked ACs a successor carries) is this checker's job; telemetry
// closure (a closed task's --task-end) is `fast-mode-telemetry.ts --task-end`'s job.
// Neither covers the other — the ac-carryover task itself closed its body (status done +
// ACs checked) while its own --task-end was still pending, exactly this boundary. Do not
// extend this checker to read telemetry; that is a different surface with its own meter.
//
// THE JUDGMENT IS NOT "all ACs checked → done" — that invites checkbox fraud (the task body records
// a real instance where an AC's prose claims 达成 while its box is unchecked). The judgment is:
//
//     A `status: done` task may leave ACs unchecked ONLY IF a successor task explicitly names which
//     of those ACs it carries — in a machine-readable `## Carries` section — and every unchecked AC
//     must be covered. An unchecked AC with no named carrier is BLOCKED.
//
// NEGATIVE CONTROL IS TWO-WAY (AC3/AC4): a task with half its ACs unchecked and NO successor is
// reported (listing exactly which AC ids are missing); the SAME task WITH a successor whose
// `## Carries` covers them is PASSED. Proving only "can block" is indistinguishable from "blocks
// everything", so both directions are pinned by fixtures.
//
// PARTIAL COVERAGE (AC5): a successor that carries only some of the unchecked ACs still blocks the
// uncarried remainder, reporting the missing ids by number.
//
// MACHINE-READABLE (AC1): the carrying relationship is a `## Carries` section in the successor —
//   ## Carries
//   from: <predecessor-task-id>
//   acs: AC9, AC10, AC11, AC12, AC13, AC14, AC14b
// parsed by THIS module (see docs/analysis/task-ac-carryover-contract.md). A prose mention does NOT
// satisfy the check — that is exactly the "written down but no executor" family this task exists to
// close. Only unchecked boxes that carry an `AC<n>` id are in scope: an id is what a successor can
// name. Done tasks whose unchecked boxes carry no `AC<n>` id are reported as `unnamed` (info, not a
// block) — the mechanism cannot reference them.
//
// EXECUTOR (AC6): wired into scripts/test.sh's run_static_checks (same site as task-contract-check,
// for the same reason — CI's only test step is `bash scripts/test.sh`, so it inherits the gate for
// free). A checker with no executor is the exact defect this task exists to fix.
//
// LEGACY RATCHET (AC7): the store has done tasks that predate the carries convention (72 with
// unchecked boxes measured 2026-08-03; only 3 of those had unchecked boxes carrying `AC<n>` ids).
// They are baselined into a shrink-only list (docs/analysis/task-ac-carryover-baseline.md) so the
// gate does not block the whole store at once — "不要一次性阻断". A NEW unowned AC that is not
// baselined exits 1: a done task just closed with uncarried ACs, the exact defect.
//
// REPORT-ONLY otherwise: exits 0 even when baselined unowned ACs exist (they are reported, not
// gating). This module NEVER writes tasks/**.
//
// Run:
//   node --no-warnings --experimental-strip-types plugin/scripts/task-ac-carryover-check.ts --root . --json
//   node --no-warnings --experimental-strip-types plugin/scripts/task-ac-carryover-check.ts --root . --write-ratchet
//   scripts/test.sh plugin/test/task-ac-carryover-check.test.mjs
//
// --no-block (gap-task-file-static-syntax-should-not-block-product-verification, option ①): the
// verification-round path. A NEW unowned AC is REPORTED and recorded in the grow-only ledger
// (.quay/task-file-violation-ledger.jsonl, shared with task-contract-check) but NEVER sets red —
// task-file syntax must not stop the product-verification round. The DEFAULT mode (no --no-block)
// keeps the shrink-only ratchet blocking behavior (maintenance / mutation tests).

import fs from "node:fs";
import { repoRoot } from "./repo-root.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractSection } from "./task-schema.ts";
import { helpExit, isDirectEntry } from "./gate-script-base.ts";
import { recordNoBlockLedger } from "./task-contract-check.ts";


// ── AC box parsing ─────────────────────────────────────────────────────────────────────────────────
// One `- [x]/[ ] AC<n>: ...` line → { id, checked }. `AC<n>` ids are the only ids a `## Carries`
// section can name; a box without one returns null (out of the mechanism's scope). The id is the
// token right after the box, terminated by `:`, a full-width `：`, or a paren — the heartbeat task's
// unchecked boxes are `- [ ] AC13（损失函数结论一）: …`, `- [ ] AC14b（…）: …`, so `（` must end the id.
export function parseAcBox(line) {
  const m = line.match(/^\s*-\s+\[([ xX])\]\s+(AC\d+[A-Za-z]*)\s*[:：（(]/);
  if (!m) return null;
  return { id: m[2], checked: /[xX]/.test(m[1]) };
}

export function uncheckedAcIds(acSection) {
  if (!acSection) return [];
  const ids = [];
  for (const line of acSection.split(/\r?\n/)) {
    const box = parseAcBox(line);
    if (box && !box.checked) ids.push(box.id);
  }
  return [...new Set(ids)];
}

export function allAcIds(acSection) {
  if (!acSection) return [];
  const ids = [];
  for (const line of acSection.split(/\r?\n/)) {
    const box = parseAcBox(line);
    if (box) ids.push(box.id);
  }
  return [...new Set(ids)];
}

// ── ## Carries parsing (AC1: machine-readable shape) ───────────────────────────────────────────────
// Every `## Carries` section in a task body declares: `from: <predecessor-id>` + `acs: <AC ids>`
// (comma-separated, whitespace-tolerant). One successor carrying from several predecessors uses one
// `## Carries` section per predecessor. Parsed positionally, never by prose mention.
export function parseCarriesBlocks(fullText) {
  if (!fullText) return [];
  const blocks = [];
  const headingRe = /^##\s+Carries\s*$/gm;
  let m;
  while ((m = headingRe.exec(fullText)) !== null) {
    const rest = fullText.slice(m.index + m[0].length);
    const stop = rest.match(/^##\s/m);
    const body = stop ? rest.slice(0, stop.index) : rest;
    const from = body.match(/^from:\s*(\S+)\s*$/m);
    const acsLine = body.match(/^acs:\s*([^\n]+)/m);
    const acs = acsLine
      ? [...acsLine[1].matchAll(/AC\d+[A-Za-z]*/g)].map((x) => x[0])
      : [];
    blocks.push({ from: from ? from[1].trim() : null, acs: [...new Set(acs)] });
  }
  return blocks;
}

// ── Store scan ─────────────────────────────────────────────────────────────────────────────────────
// For every `status: done` task: unchecked ACs with `AC<n>` ids that are not covered by any
// `## Carries` block whose `from:` names this task are BLOCKED (unowned). The carried set is the
// union of `acs:` across all successor declarations pointing at this task.
//
// Also collected for the report (never gating):
//   carries — every `## Carries` block in the store (so a declaration is visible even when it does
//     not affect any done task).
//   stale-carry — a `## Carries` block whose `from:` id does not exist in the store, or whose `acs:`
//     names ids the source task's own AC section does not contain (info; the source may be legacy
//     with unparseable AC lines, so this must not gate).
//   unnamed — a done task with unchecked boxes but NO extractable `AC<n>` id (the mechanism cannot
//     reference them; reported so a human sees the box count).
//
// `filePaths` (absolute, optional) limits the scan to exactly those files — the SUBSET mode. Task
// ids derive from the real filenames so `from:` matching keeps working inside the subset.
export function scanStore({ repoRoot, tasksDir = path.join(repoRoot, "tasks"), filePaths = null }) {
  const texts = new Map();
  let ids;
  if (filePaths) {
    ids = filePaths.map((p) => path.basename(p).replace(/\.md$/, ""));
    for (let i = 0; i < filePaths.length; i++) {
      try { texts.set(ids[i], fs.readFileSync(filePaths[i], "utf8")); } catch { /* missing file → skip */ }
    }
  } else {
    let files;
    try {
      files = fs.readdirSync(tasksDir).filter((f) => f.endsWith(".md"));
    } catch {
      return { blocked: [], carries: [], staleCarries: [], unnamed: [], scanned: 0 };
    }
    ids = files.map((f) => f.replace(/\.md$/, ""));
    for (const f of files) texts.set(f.replace(/\.md$/, ""), fs.readFileSync(path.join(tasksDir, f), "utf8"));
  }

  // id → set of AC ids carried (union across all `## Carries` blocks from any successor).
  const carriedBy = new Map();
  const carries = [];
  const staleCarries = [];
  for (const [id, raw] of texts) {
    for (const block of parseCarriesBlocks(raw)) {
      carries.push({ taskId: id, ...block });
      if (!block.from || !texts.has(block.from)) {
        staleCarries.push({ taskId: id, from: block.from, reason: "from-id-not-in-store" });
        continue;
      }
      if (!carriedBy.has(block.from)) carriedBy.set(block.from, new Set());
      const srcAc = allAcIds(extractSection(texts.get(block.from), "Acceptance Criteria"));
      const srcSet = new Set(srcAc);
      const unknown = block.acs.filter((a) => !srcSet.has(a));
      if (unknown.length > 0) {
        staleCarries.push({ taskId: id, from: block.from, acs: block.acs, unknown, reason: "acs-unknown-in-source" });
      }
      for (const a of block.acs) carriedBy.get(block.from).add(a);
    }
  }

  const blocked = [];
  const unnamed = [];
  for (const [id, raw] of texts) {
    const status = (raw.match(/^status:\s*(\S+)/m) || [])[1];
    if (status !== "done") continue;
    const acSection = extractSection(raw, "Acceptance Criteria");
    const unchecked = uncheckedAcIds(acSection);
    if (unchecked.length === 0) {
      // All ACs checked — nothing to carry. (Unchecked boxes without `AC<n>` ids are handled below.)
      const anyUncheckedBox = (acSection || "").match(/^\s*-\s+\[\s\]/m);
      if (anyUncheckedBox) {
        const boxCount = (acSection.match(/^\s*-\s+\[\s\]/gm) || []).length;
        unnamed.push({ taskId: id, uncheckedBoxes: boxCount });
      }
      continue;
    }
    const carried = carriedBy.has(id) ? [...carriedBy.get(id)] : [];
    const missing = unchecked.filter((a) => !carried.includes(a));
    if (missing.length > 0) {
      blocked.push({ taskId: id, unchecked, carried, missing });
    }
  }
  blocked.sort((a, b) => a.taskId.localeCompare(b.taskId));
  return { blocked, carries, staleCarries, unnamed, scanned: texts.size };
}

// ── Ratchet data file (AC7: shrink-only legacy baseline) ──────────────────────────────────────────
export const BASELINE_FILE_REL = "docs/analysis/task-ac-carryover-baseline.md";

export function readBaseline(root) {
  const p = path.join(root, BASELINE_FILE_REL);
  if (!fs.existsSync(p)) return { baseline: new Set(), baselineCount: null };
  const text = fs.readFileSync(p, "utf8");
  const countMatch = text.match(/^# baseline-count:\s*(\d+)/m);
  const baseline = new Set();
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    baseline.add(t);
  }
  return { baseline, baselineCount: countMatch ? Number(countMatch[1]) : null };
}

export function writeBaseline(root, currentEntries, { reset = false } = {}) {
  const p = path.join(root, BASELINE_FILE_REL);
  const { baseline, baselineCount } = readBaseline(root);
  const ceiling = reset ? currentEntries.length : (baselineCount ?? currentEntries.length);
  if (!reset && currentEntries.length > ceiling) {
    return { ok: false, reason: `current unowned ACs (${currentEntries.length}) exceed the ratchet ceiling (${ceiling}) — the list can only get SHORTER; give the ACs a carrying successor, do not add them` };
  }
  if (!reset && baseline.size > 0) {
    const newOnes = currentEntries.filter((e) => !baseline.has(e));
    if (newOnes.length > 0) {
      return { ok: false, reason: `refusing to write: ${newOnes.length} NEW unowned AC(s) not in the baseline — the list can only get SHORTER: ${newOnes.slice(0, 5).join(", ")}${newOnes.length > 5 ? "…" : ""}` };
    }
  }
  const lines = [
    "# task-ac-carryover-baseline.md — shrink-only ratchet list for task-ac-carryover-check.ts",
    "# (tasks/gap-nothing-checks-whether-a-done-task-left-its-acs-behind, AC7). A line here means a",
    "# `status: done` task still has an unchecked AC with no carrying successor — a LEGACY case",
    "# baselined so the gate does not block the whole store at once.",
    "#",
    "# RATCHET: the list can ONLY get SHORTER. task-ac-carryover-check.ts exits 1 if a NEW unowned",
    "# AC appears that is not already listed. Remove an entry only after the AC gains a carrying",
    "# successor (then run --write-ratchet to persist the shrunken list). `--write-ratchet",
    "# --reset-baseline` is the deliberate one-shot re-baseline after a criterion change.",
    "#",
    "# Format: one `<task-id>: <AC-id>` per line (sorted; one line per unowned AC).",
    "# baseline-count: " + ceiling,
    "",
    ...currentEntries,
    "",
  ];
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, lines.join("\n"));
  return { ok: true, reason: reset
    ? `ratchet baseline RESET to ${currentEntries.length} entry/entries (ceiling re-anchored to ${ceiling})`
    : `ratchet list written (${currentEntries.length} entry/entries; ceiling ${ceiling})` };
}

// ── Report formatting (pure — unit-tested) ────────────────────────────────────────────────────────
export function formatJsonReport(scan, ratchet, wsRoot, subset) {
  const unowned = scan.blocked.reduce((n, b) => n + b.missing.length, 0);
  return JSON.stringify({
    workspaceRoot: wsRoot,
    subset,
    scanned: scan.scanned,
    unowned, // ← the Contract's `unowned_acs` measure field
    blocked: scan.blocked.map((b) => ({
      taskId: b.taskId,
      unchecked: b.unchecked,
      carried: b.carried,
      missing: b.missing,
    })),
    carries: scan.carries,
    staleCarries: scan.staleCarries,
    unnamed: scan.unnamed,
    ratchet,
  }, null, 2) + "\n";
}

export function formatTextReport(scan, { baselineCount, newOnes = [], growth = false, subset = false, noBlock = false }) {
  const unowned = scan.blocked.reduce((n, b) => n + b.missing.length, 0);
  let out = "";
  if (scan.blocked.length === 0) {
    out += `task-ac-carryover: no blocked done tasks among ${scan.scanned} scanned (every done task's unchecked ACs have a named carrier)\n`;
  } else {
    out += `task-ac-carryover: ${scan.blocked.length} BLOCKED done task(s) — ${unowned} unchecked AC(s) with NO carrying successor\n`;
    for (const b of scan.blocked) {
      out += `  unowned: ${b.taskId} — missing ${b.missing.join(", ")} (${b.unchecked.length} unchecked total, carried: ${b.carried.length ? b.carried.join(", ") : "none"})\n`;
    }
    out += "  → give each unchecked AC a successor with a `## Carries` section naming it (docs/analysis/task-ac-carryover-contract.md)\n";
  }
  if (scan.carries.length > 0) {
    out += `carries: ${scan.carries.length} ## Carries declaration(s) parsed\n`;
  }
  if (scan.staleCarries.length > 0) {
    for (const s of scan.staleCarries) {
      out += `  stale-carry: ${s.taskId} → ${s.from ?? "<none>"} (${s.reason}${s.unknown ? ": " + s.unknown.join(", ") : ""})\n`;
    }
  }
  if (scan.unnamed.length > 0) {
    for (const u of scan.unnamed) {
      out += `  unnamed: ${u.taskId} — ${u.uncheckedBoxes} unchecked box(es) without an AC<n> id (out of carryover scope; info only)\n`;
    }
  }
  if (baselineCount !== null) {
    // --no-block wording avoids the full-suite-runner's `/new since baseline:\s*[1-9]\d*/` static-check
    // failure marker — a non-blocking run must never flip the verification round red.
    out += noBlock
      ? `ratchet ceiling: ${baselineCount}; recorded (non-blocking): ${newOnes.length}${newOnes.length ? ` (${newOnes.join(", ")})` : ""}\n`
      : `ratchet ceiling: ${baselineCount}; new since baseline: ${newOnes.length}${newOnes.length ? ` (${newOnes.join(", ")})` : ""}\n`;
  }
  if (subset) out += "subset scan (<task-file> args) — ratchet comparison skipped (it is only meaningful over the full store)\n";
  if (growth) out += "ratchet BREACH: a new unowned AC appeared that is not baselined — a done task closed with uncarried ACs\n";
  if (noBlock && newOnes.length > 0) {
    out += `recorded (non-blocking, grow-only ledger): ${newOnes.length} new unowned AC(s) — task-file syntax does NOT block the verification round (gap-task-file-static-syntax-should-not-block-product-verification)\n`;
  }
  return out;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
export function runCli(argv) {
  const args = argv.slice(2); // skip node + script path (process.argv[0..1])
  if (args.includes("--help") || args.includes("-h")) helpExit("usage: node task-ac-carryover-check.ts [--root <dir>] [--json] [--write-ratchet] [--allow-growth] [--reset-baseline] [--no-block] [<task-file> ...]");
  let root = null;
  let json = false;
  let writeRatchetFlag = false;
  let allowGrowth = false;
  let resetBaseline = false;
  let noBlock = false;
  const files = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--root") root = args[++i];
    else if (a === "--json") json = true;
    else if (a === "--write-ratchet") writeRatchetFlag = true;
    else if (a === "--allow-growth") allowGrowth = true;
    else if (a === "--reset-baseline") resetBaseline = true;
    else if (a === "--no-block") noBlock = true;
    else if (a.startsWith("-")) { console.error(`task-ac-carryover-check: unknown flag: ${a}`); process.exit(2); }
    else files.push(a);
  }
  if (resetBaseline && !writeRatchetFlag) {
    console.error("task-ac-carryover-check: --reset-baseline requires --write-ratchet");
    process.exit(2);
  }
  const wsRoot = root ? path.resolve(root) : repoRoot();
  const tasksDir = path.join(wsRoot, "tasks");
  const subset = files.length > 0;
  const scanFiles = files.map((f) => path.resolve(wsRoot, f));
  if (scanFiles.length === 0 && !fs.existsSync(tasksDir)) {
    console.error(`task-ac-carryover-check: no <task-file> args and no tasks/ dir at ${wsRoot}`);
    process.exit(2);
  }
  const scan = scanStore({ repoRoot: wsRoot, tasksDir, filePaths: subset ? scanFiles : null });

  const currentEntries = [];
  for (const b of scan.blocked) {
    for (const ac of b.missing) currentEntries.push(`${b.taskId}: ${ac}`);
  }
  currentEntries.sort();
  const { baseline, baselineCount } = readBaseline(wsRoot);
  const firstBaseline = baselineCount === null;
  const newOnes = currentEntries.filter((e) => !baseline.has(e));
  const resolved = !subset && baseline.size > 0 ? [...baseline].filter((e) => !currentEntries.includes(e)).sort() : [];
  // --no-block (option ①): a NEW unowned AC is RECORDED (grow-only ledger) but never blocks — task-file
  // syntax must not stop the product-verification round.
  const growth = !noBlock && !subset && !firstBaseline && newOnes.length > 0 && !allowGrowth && !resetBaseline;

  // Grow-only ledger write (best-effort — a ledger I/O failure must never turn a deliberately
  // non-blocking check red).
  let ledger = null;
  if (noBlock && newOnes.length > 0) {
    try { ledger = recordNoBlockLedger(wsRoot, "task-ac-carryover-check", newOnes); }
    catch (e) { console.error(`task-ac-carryover-check: ledger write failed (non-blocking, ignored): ${e?.message ?? e}`); }
  }

  let writeOutcome = null;
  // --no-block never mutates the shrink-only baseline (the grow-only ledger is the accounting).
  if (writeRatchetFlag && !growth && !subset && !noBlock) {
    writeOutcome = writeBaseline(wsRoot, currentEntries, { reset: resetBaseline });
    if (!writeOutcome.ok) {
      const report = {
        workspaceRoot: wsRoot, subset, scanned: scan.scanned, unowned: currentEntries.length,
        blocked: scan.blocked, carries: scan.carries, staleCarries: scan.staleCarries, unnamed: scan.unnamed,
        ratchet: { baselineCount, currentCount: currentEntries.length, newViolations: newOnes, resolved, growth: true, writeOutcome },
      };
      if (json) console.log(JSON.stringify(report, null, 2));
      else process.stdout.write(formatTextReport(scan, { baselineCount, newOnes, growth: true, subset }));
      return 1;
    }
  }

  const ratchet = { baselineCount, currentCount: currentEntries.length, newViolations: newOnes, resolved, growth, writeOutcome, ...(noBlock ? { ledger } : {}) };
  if (json) {
    process.stdout.write(formatJsonReport(scan, ratchet, wsRoot, subset));
  } else {
    process.stdout.write(formatTextReport(scan, { baselineCount, newOnes, growth, subset, noBlock }));
    if (resolved.length > 0) {
      process.stdout.write(`resolved: ${resolved.length}${resolved.length ? ` (${resolved.join(", ")})` : ""}\n`);
    }
  }
  // growth is already forced false under --no-block (the ledger is the accounting, never the gate).
  return growth ? 1 : 0;
}

if (isDirectEntry(import.meta, undefined, "task-ac-carryover-check")) {
  process.exit(runCli(process.argv));
}
