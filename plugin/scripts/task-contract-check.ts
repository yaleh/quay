// task-contract-check.ts — the consumer-side checker for the `## Contract` block + `## Dispatch
// review` section (tasks/gap-dispatch-gate-has-no-checklist-and-no-trace, AC2/AC3/AC6). The dispatch
// gate's five verbal questions become a machine-readable Contract written at task-creation time; this
// module is the CONSUMER that reads CONTENT, not just existence.
//
// The five consumer judgments (from the task's "二、消费者" table):
//   1. ac-threshold-no-measure-ref — an AC item carrying a threshold/band marker must reference a
//      declared `measure`/`band` NAME (or one of that measure's declared field tokens). "对照噪声
//      带宽判定" without saying WHICH field is exactly what this catches.
//   2. measure-no-command / measure-no-field — each `measure` must carry BOTH a backtick command and
//      a field name (the thing it reads off that command's output).
//   3. invoke-not-command / invoke-evidence-missing — each `invoke` must be a backtick command; on a
//      DONE task, the command's EXECUTABLE ENTRY PATH must appear in the body OUTSIDE the Contract
//      block (not the verbatim string — placeholders like <ISO> make verbatim matching impossible).
//   4. defect-no-control — a task labelled `defect` must declare a `control` (the negative control
//      that would expose a masking fix — "sync before check" class).
//   5. contract-empty-value — a key present with a blank value (n/a: <reason> is fine).
// Plus: dispatch-review-missing / dispatch-review-malformed (A10 format check, report-only).
//
// REPORT-ONLY by default: this module NEVER writes tasks/** and exits 0 even when violations exist —
// the dispatch gate must not block (AC7). The ONE exception is the RATCHET on its own data file
// (docs/analysis/contract-violations.md, AC6): that list can only get SHORTER, so a NEW violation not
// already listed exits 1. `--json` emits the machine shape; `--write-ratchet` updates the data file
// to the current (shrunken) violation set, refusing to grow it.
//
// Matching is by code/field position, not bare text: the measure/invoke field tokens come from the
// DECLARED entries, and the AC-threshold marker scans only the AC section. A mention in a comment or
// in another section does not satisfy a reference.
//
// Run:
//   node --experimental-strip-types plugin/scripts/task-contract-check.ts [--root <dir>] [--json]
//       [--write-ratchet] [--allow-growth] [--reset-baseline] [<task-file.md> ...]
//   scripts/test.sh plugin/test/task-contract-check.test.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  parseTask,
  extractSectionFenceAware,
  parseContract,
  checkContractSyntax,
  checkDispatchReview,
  CONTRACT_KEYS,
} from "./task-schema.ts";

// ── Workspace-root discovery ─────────────────────────────────────────────────────────────────────────
export function findWorkspaceRoot(startDir = path.dirname(fileURLToPath(import.meta.url))) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

// ── Consumer checks (read content, match by declared position) ───────────────────────────────────────

/** Tokens an AC reference must hit: declared measure/band names + field tokens from their values. */
function measureRefTokens(entries) {
  const tokens = new Set();
  for (const e of entries) {
    if ((e.key === "measure" || e.key === "band") && e.name) tokens.add(e.name);
    if (e.na || e.value == null) continue;
    const outside = e.value.replace(/`[^`]*`/g, " ");
    for (const m of outside.matchAll(/[A-Za-z_][A-Za-z0-9_.-]{1,}/g)) tokens.add(m[0]);
    for (const m of outside.matchAll(/[A-Za-z]{1,}\d{1,}/g)) tokens.add(m[0]);
    // Pure numbers too — a band declared as "20–63s（20000..63000 ms）" should be matched by an AC
    // that says "20–63s" (the digits, not the letters). The unit token (`s`, `ms`) is extracted by
    // the first alternative.
    for (const m of outside.matchAll(/\d+/g)) tokens.add(m[0]);
    // Field-descriptor tokens. `值` is deliberately NOT here — it is too generic (matches almost any
    // AC sentence) and would manufacture lucky non-violations (REFUTE round-1 MINOR 4).
    for (const m of outside.matchAll(/(字段|列|计数|阈值|带宽|噪声带|噪声|区间|范围|序号)/g)) tokens.add(m[0]);
  }
  return [...tokens];
}

const AC_THRESHOLD_KEYWORD_RE = /噪声|带宽|阈值|噪声带|\bband\b|\bnoise\b/i;
const AC_THRESHOLD_NUMBER_UNIT_RE = /\d+(?:\.\d+)?\s*(?:ms\b|s\b|sec\b|min\b|分钟|秒|%|MB|GB|核|倍)/i;

/** AC items that reference a threshold/band/number-with-unit are the ones check 1 cares about. */
export function hasThresholdMarker(acSection) {
  if (!acSection) return false;
  return AC_THRESHOLD_KEYWORD_RE.test(acSection) || AC_THRESHOLD_NUMBER_UNIT_RE.test(acSection);
}

// Check 1: AC has a threshold/band marker but references none of the declared measure/band names.
function checkAcThresholdRef(acSection, entries) {
  if (!hasThresholdMarker(acSection)) return [];
  const tokens = measureRefTokens(entries);
  if (tokens.length === 0) {
    return [{ code: "ac-threshold-no-measure-ref", what: "AC mentions a threshold/band but ## Contract declares no measure/band to attribute it to" }];
  }
  if (tokens.some((t) => t && acSection.includes(t))) return [];
  return [{ code: "ac-threshold-no-measure-ref", what: `AC mentions a threshold/band but references none of the declared measure/band names/fields (${tokens.join(", ")}); name the measure/band this threshold comes from` }];
}

// Check 2: each measure must carry BOTH a backtick command and a field name.
function checkMeasureCommandField(entries) {
  const findings = [];
  for (const e of entries) {
    if (e.key !== "measure" || e.na || e.value == null) continue;
    const label = e.name ? `"${e.name}"` : `"${e.raw}"`;
    if (!/`/.test(e.value)) {
      findings.push({ code: "measure-no-command", what: `measure ${label} has no backtick command — which command produces this field?` });
      continue;
    }
    const outside = e.value.replace(/`[^`]*`/g, " ");
    const hasField = /[A-Za-z_][A-Za-z0-9_.-]{1,}/.test(outside)
      || /[A-Za-z]{1,}\d{1,}/.test(outside)
      || /(字段|列|计数|值|阈值|带宽|区间|范围|序号)/.test(outside);
    if (!hasField) {
      findings.push({ code: "measure-no-field", what: `measure ${label} names a command but no field — which field of the output is the measured quantity?` });
    }
  }
  return findings;
}

// Check 3: invoke must be a backtick command; on a done task the command's EXECUTABLE ENTRY PATH
// must appear OUTSIDE the Contract block (the evidence must show the script actually run — spelling
// drift catcher). Commands with placeholders (`<ISO>`, `<file>`, ...) are judged by entry path too:
// a verbatim match is impossible by construction once the placeholder is substituted.
// (gap-contract-ratchet-has-no-runner-and-grew-tenfold-unnoticed: 6 of 7 prior findings were false —
// the evidence existed, just not as the same literal string.)
/** Extract the executable entry path from a backtick command: the first slash-bearing token, skipping
 * leading interpreter tokens (`node`, `bash`, ...) and flag tokens (`--flag`). A command with no
 * path token at all (e.g. `git status`) falls back to the full command string, preserving verbatim
 * matching for those. */
export function invokeEntryPath(cmd) {
  const tokens = cmd.trim().split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    if (tok.startsWith("-")) continue;
    if (tok.includes("/")) return tok;
  }
  return cmd;
}

function checkInvoke(entries, body, contractSectionText, status) {
  const findings = [];
  const bodyOutside = contractSectionText ? body.replace(contractSectionText, "") : body;
  for (const e of entries) {
    if (e.key !== "invoke" || e.na) continue;
    if (!/`/.test(e.value)) {
      findings.push({ code: "invoke-not-command", what: `invoke must be a backtick command: "${e.raw}"` });
      continue;
    }
    const cmd = (e.value.match(/`([^`]*)`/) || [])[1] || "";
    if (status !== "done" || !cmd) continue;
    const entryPath = invokeEntryPath(cmd);
    if (!bodyOutside.includes(entryPath)) {
      findings.push({ code: "invoke-evidence-missing", what: `invoke command's entry path \`${entryPath}\` does not appear in the task body (outside ## Contract) — a done task must show the executable entry path it ran` });
    }
  }
  return findings;
}

// Check 4: a defect-labelled task must declare a control.
function checkDefectControl(task, entries) {
  if (!(task.labels || []).includes("defect")) return [];
  if (entries.some((e) => e.key === "control")) return [];
  return [{ code: "defect-no-control", what: "task is labelled `defect` but ## Contract has no `control` key — declare the negative control that would expose a masking fix (e.g. dirty the artifact → the check must still fail)" }];
}

// ── Per-task scan ────────────────────────────────────────────────────────────────────────────────────
// Returns { taskId, violations: [{code, what}], info: [{code, what}] }.
// `violations` feed the ratchet list; `info` is non-ratchet context (absent sections on tasks that
// have not opted into the mechanism — the pre-ratchet baseline).
export function scanTaskText(text, taskFileRel = "") {
  const task = parseTask(text);
  const body = task.body;
  // parseTask does not surface `status`; read it from the raw frontmatter for the done-task
  // invoke-evidence check.
  const statusMatch = task.frontmatterRaw.match(/^status:\s*(.+)$/m);
  const status = statusMatch ? statusMatch[1].trim().replace(/^["']|["']$/g, "") : "";
  const contract = parseContract(body);
  const violations = [];
  const info = [];

  if (contract.present) {
    const contractSec = extractSectionFenceAware(body, "Contract");
    for (const f of checkContractSyntax(task).findings) violations.push(f);
    const ac = extractSectionFenceAware(body, "Acceptance Criteria") || "";
    violations.push(...checkAcThresholdRef(ac, contract.entries));
    violations.push(...checkMeasureCommandField(contract.entries));
    violations.push(...checkInvoke(contract.entries, body, contractSec, status));
    violations.push(...checkDefectControl(task, contract.entries));
  } else {
    info.push({ code: "contract-absent", what: "no '## Contract' section (pre-ratchet baseline — not yet opted into the mechanism)" });
  }

  // Dispatch review format check — report-only. Missing section on a task WITH a Contract is a ratchet
  // violation (it opted in but left no trace); missing on a no-Contract task is info.
  const dr = checkDispatchReview(task);
  for (const f of dr.findings) {
    if (f.code === "dispatch-review-missing" && !contract.present) info.push(f);
    else violations.push(f);
  }

  const idMatch = task.frontmatterRaw.match(/^id:\s*(.+)$/m);
  const taskId = idMatch ? idMatch[1].trim().replace(/^["']|["']$/g, "") : path.basename(taskFileRel || "task", ".md");
  const dedup = (arr) => {
    const seen = new Set();
    return arr.filter((f) => {
      const k = `${f.code}|${f.what}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  return { taskId, violations: dedup(violations), info: dedup(info) };
}

// ── Data-file ratchet (AC6: the violation list can only get SHORTER) ────────────────────────────────
export const DATA_FILE_REL = "docs/analysis/contract-violations.md";

export function readRatchet(root) {
  const p = path.join(root, DATA_FILE_REL);
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

export function writeRatchet(root, currentEntries, { reset = false } = {}) {
  const p = path.join(root, DATA_FILE_REL);
  const { baseline, baselineCount } = readRatchet(root);
  // reset=true is the DELIBERATE one-shot re-baseline (gap-contract-ratchet-has-no-runner-and-grew-
  // tenfold-unnoticed): after a criterion fix drops false positives, the ceiling is re-anchored to the
  // current violation set. It bypasses the shrink-only guard ONCE, so the caller must record the
  // before/after run output. Any subsequent write is shrink-only again (ceiling never grows).
  const ceiling = reset ? currentEntries.length : (baselineCount ?? currentEntries.length);
  if (!reset && currentEntries.length > ceiling) {
    return { ok: false, reason: `current violations (${currentEntries.length}) exceed the ratchet ceiling (${ceiling}) — the list can only get SHORTER; fix violations, do not add them` };
  }
  if (!reset && baseline.size > 0) {
    const newOnes = currentEntries.filter((e) => !baseline.has(e));
    if (newOnes.length > 0) {
      return { ok: false, reason: `refusing to write: ${newOnes.length} NEW violation(s) not in the baseline — the list can only get SHORTER: ${newOnes.slice(0, 5).join(", ")}${newOnes.length > 5 ? "…" : ""}` };
    }
  }
  const lines = [
    "# contract-violations.md — shrink-only ratchet list for the ## Contract consumer checks",
    "# (tasks/gap-dispatch-gate-has-no-checklist-and-no-trace, AC6). A violation here means the task's",
    "# ## Contract block (or ## Dispatch review section) fails one of the five consumer judgments.",
    "#",
    "# RATCHET: the list can ONLY get SHORTER. task-contract-check.ts exits 1 if a NEW violation",
    "# appears that is not already listed, or if the list would exceed the baseline-count ceiling.",
    "# Remove an entry only after the underlying violation is fixed (then run --write-ratchet to",
    "# persist the shrunken list). `--write-ratchet --reset-baseline` is the deliberate one-shot",
    "# re-baseline after a criterion fix; it re-anchors the ceiling to the current violation set.",
    "#",
    "# Format: one `<task-file>: <violation-code>` per line (repo-root-relative, sorted).",
    "# baseline-count: " + ceiling,
    "",
    ...currentEntries,
    "",
  ];
  fs.writeFileSync(p, lines.join("\n"));
  return { ok: true, reason: reset
    ? `ratchet baseline RESET to ${currentEntries.length} entry/entries (ceiling re-anchored to ${ceiling})`
    : `ratchet list written (${currentEntries.length} entry/entries; ceiling ${ceiling})` };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────
export function runCli(argv) {
  const args = argv.slice();
  let root = null;
  let json = false;
  let writeRatchetFlag = false;
  let allowGrowth = false;
  let resetBaseline = false;
  let strictSubset = false;
  const files = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--root") { root = args[++i]; }
    else if (a === "--json") { json = true; }
    else if (a === "--write-ratchet") { writeRatchetFlag = true; }
    else if (a === "--allow-growth") { allowGrowth = true; }
    else if (a === "--reset-baseline") { resetBaseline = true; }
    else if (a === "--strict-subset") { strictSubset = true; }
    else if (a.startsWith("-")) { console.error(`task-contract-check: unknown flag: ${a}`); process.exit(2); }
    else { files.push(a); }
  }
  if (resetBaseline && !writeRatchetFlag) {
    console.error("task-contract-check: --reset-baseline requires --write-ratchet (it is the write that re-anchors the ceiling)");
    process.exit(2);
  }
  const wsRoot = root ? path.resolve(root) : findWorkspaceRoot();
  const tasksDir = path.join(wsRoot, "tasks");
  const scanFiles = files.length > 0 ? files.map((f) => path.resolve(wsRoot, f)) : [];
  if (scanFiles.length === 0 && !fs.existsSync(tasksDir)) {
    console.error(`task-contract-check: no <task-file> args and no tasks/ dir at ${wsRoot}`);
    process.exit(2);
  }
  const list = scanFiles.length > 0
    ? scanFiles
    : fs.readdirSync(tasksDir).filter((f) => f.endsWith(".md")).map((f) => path.join(tasksDir, f)).sort();

  const allViolations = [];
  const allInfo = [];
  const perTask = [];
  for (const file of list) {
    const rel = path.relative(wsRoot, file);
    const text = fs.readFileSync(file, "utf8");
    const res = scanTaskText(text, rel);
    for (const v of res.violations) allViolations.push(`${rel}: ${v.code}`);
    allInfo.push(...res.info.map((i) => ({ file: rel, ...i })));
    if (res.violations.length > 0 || res.info.length > 0) {
      perTask.push({ file: rel, taskId: res.taskId, violations: res.violations, info: res.info });
    }
  }

  const currentEntries = [...new Set(allViolations)].sort();
  // SUBSET MODE (explicit <task-file> args): the ratchet comparison is only meaningful over the full
  // store — a per-file run would misreport every baseline entry not in the subset as "resolved"
  // (REFUTE round-1 MINOR 2). In subset mode we skip the ratchet entirely (report-only, exit 0).
  const subset = scanFiles.length > 0;
  const { baseline, baselineCount } = readRatchet(wsRoot);
  // The FIRST --write-ratchet run establishes the baseline (there is nothing to grow against yet);
  // only once a baseline exists is "a new violation" a ratchet breach.
  const firstBaseline = baselineCount === null;
  const newOnes = currentEntries.filter((e) => !baseline.has(e));
  const resolved = !subset && baseline.size > 0 ? [...baseline].filter((e) => !currentEntries.includes(e)).sort() : [];
  // --reset-baseline is a deliberate re-baseline: it must NOT be reported as growth.
  const growth = !subset && !firstBaseline && newOnes.length > 0 && !allowGrowth && !resetBaseline;

  let writeOutcome = null;
  if (writeRatchetFlag && !growth && !subset) {
    writeOutcome = writeRatchet(wsRoot, currentEntries, { reset: resetBaseline });
    if (!writeOutcome.ok) return finish({ json, perTask, allInfo, currentEntries, newOnes, resolved, baselineCount, growth: true, writeOutcome, wsRoot, subset });
  }

  return finish({ json, perTask, allInfo, currentEntries, newOnes, resolved, baselineCount, growth, writeOutcome, wsRoot, subset, strictSubset });
}

function finish({ json, perTask, allInfo, currentEntries, newOnes, resolved, baselineCount, growth, writeOutcome, wsRoot, subset, strictSubset = false }) {
  if (json) {
    const report = {
      workspaceRoot: wsRoot,
      subset,
      tasksScanned: perTask.length,
      violations: perTask.flatMap((t) => t.violations.map((v) => ({ file: t.file, code: v.code, what: v.what }))),
      info: allInfo.map((i) => ({ file: i.file, code: i.code, what: i.what })),
      ratchet: {
        baselineCount,
        currentCount: currentEntries.length,
        newViolations: newOnes,
        resolved: resolved,
        growth,
      },
      writeOutcome,
    };
    console.log(JSON.stringify(report, null, 2));
  } else {
    const violationTasks = perTask.filter((t) => t.violations.length > 0);
    if (violationTasks.length === 0) console.log("task-contract-check: no violations.");
    for (const t of violationTasks) {
      for (const v of t.violations) console.log(`VIOLATION: ${t.file} — ${v.code}: ${v.what}`);
    }
    console.log("");
    console.log(`violations: ${currentEntries.length} unique across ${violationTasks.length} task(s); info findings (non-ratchet, pre-opt-in baseline): ${allInfo.length} — see --json for details`);
    if (subset) {
      console.log("subset scan (<task-file> args) — ratchet comparison skipped (it is only meaningful over the full store)");
      if (strictSubset) {
        console.log("strict-subset mode (scoped static-check tier) — a violation on a scanned task FAILS this run (exit 1); unrelated tasks are not scanned");
      }
    } else if (baselineCount !== null) {
      console.log(`ratchet ceiling: ${baselineCount}; new since baseline: ${newOnes.length}${newOnes.length ? ` (${newOnes.join(", ")})` : ""}; resolved: ${resolved.length}${resolved.length ? ` (${resolved.join(", ")})` : ""}`);
    }
    if (writeOutcome) console.log(`write: ${writeOutcome.reason}`);
  }
  // strict-subset (the scoped tier's contract-consumer): a violation on ANY scanned (touched) task
  // is a failure — the touched task's Contract is change-relevant, so scoped MUST catch it (AC4-i).
  // The ratchet comparison stays skipped (unrelated tasks are not scanned, so nothing to compare).
  const strictFail = strictSubset && subset && perTask.some((t) => t.violations.length > 0);
  process.exit(growth || strictFail ? 1 : 0);
}

// Entry point when run directly (not imported).
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runCli(process.argv.slice(2));
}
