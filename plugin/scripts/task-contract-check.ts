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
//       [--write-ratchet] [--allow-growth] [--reset-baseline] [--no-block] [--strict-subset]
//       [<task-file.md> ...]
//   scripts/test.sh plugin/test/task-contract-check.test.mjs
//
// --no-block (gap-task-file-static-syntax-should-not-block-product-verification, option ①): the
// verification-round path (run_static_checks + the scoped tier). Task-file Contract/AC syntax
// violations are REPORTED and recorded in a GROW-ONLY ledger (.quay/task-file-violation-ledger.jsonl)
// but NEVER set red — a task-file syntax issue is a different risk class from "is the product code
// usable", so it must not stop the product-verification round. The DEFAULT mode (no --no-block) keeps
// the shrink-only ratchet blocking behavior for direct invocation / maintenance / mutation tests.

import fs from "node:fs";
import { repoRoot } from "./repo-root.ts";
import path from "node:path";
import {
  parseTask,
  extractSectionFenceAware,
  parseContract,
  checkContractSyntax,
  checkDispatchReview,
  CONTRACT_KEYS,
} from "./task-schema.ts";
// The ONE Touches parser (single-source) — the bare-dir + uncertain-annotation flag it exposes is the
// mechanical rule from tasks/gap-touches-bare-dir-uncertain-declaration-drags-the-pool (AC1).
import { extractTouchesSection, flagBareDirUncertainTouches } from "./touches-parser.ts";
import { TASK_STATUS } from "./task-status.ts";
// The wiring/reachability-declaration → real-input-probe check (gap-wiring-claim-ac-requires-real-input-
// probe). Reuses wiring-coverage-check.ts's backtick-identifier extraction + the (calibrated)
// `N 条`+verb declaration heuristic — NOT a second, independently-buggy parser.
import { checkWiringClaimAcProbe } from "./wiring-coverage-check.ts";
import { helpExit, isDirectEntry } from "./gate-script-base.ts";


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
    if (status !== TASK_STATUS.DONE || !cmd) continue;
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

// Check 5 (AC5, gap-ac8-import-over-spawn-ticked-while-its-own-evidence-says-not-in-effect): a TICKED
// AC item whose evidence text self-admits the mechanism it asserts is NOT in effect. The defect this
// catches is the task's namesake: gap-eighty-one-instruments AC8 was ticked [x] while its OWN cited
// evidence ended "41:4 说明政策存在、未生效" — the evidence literally states the policy is NOT in
// effect, and the box was ticked anyway. This is the "invoke-evidence-missing" family: evidence
// inconsistent with the checked box, but the contradiction is in the EVIDENCE TEXT, not the invoke path.
//
// Wording scoping (calibrated 2026-08-06 against the FULL task store, AC5's negative-control method):
// the raw keyword set (未生效/未达成/尚未/仍然) is too ambiguous — bare `仍然` is overwhelmingly POSITIVE
// ("仍然过闸"/"仍然装得对" are achievements, not admissions), and `尚未`/`未落地` routinely describe a
// SUBORDINATE cause ("文件尚未创建" / "依赖未落地") rather than the AC's own status. All three produced
// false positives on real done tasks. What distinguishes the genuine namesake case is a MECHANISM/
// CONCLUSION noun near an unambiguous self-admission: "41:4 说明政策存在、未生效" (说明 + 政策 + 未生效).
// The pattern below requires that window — a MECHANISM/CONCLUSION noun (政策/机制/方案/集成/入口/import/
// spawn/比例/说明/表明/证明/意味着 — deliberately NOT generic nouns like 检查/工具/测试/证据 which appear
// in DESCRIPTIONS of the very checks that list these keywords) within 40 chars before
// `未生效|未达成|仍未生效|仍未达成`. It flags EXACTLY ONE task on the 2026-08-06 store: the namesake
// gap-eighty-one-instruments AC8 itself (the smoking gun), and nothing else — including the AC5 item of
// THIS task, which describes the check and lists the keywords (验证 0 误报).
export const AC_SELF_ADMISSION_RE =
  /(政策|机制|方案|集成|入口|import|spawn|比例|说明|表明|证明|意味着)[^。；;\n]{0,40}?(未生效|未达成|仍未生效|仍未达成)/;

export function checkTickedAcSelfAdmission(acSection) {
  if (!acSection) return [];
  const findings = [];
  const lines = acSection.split(/\r?\n/);
  let current = null; // { text, lineNo } — the current ticked AC's accumulated evidence text
  const flush = () => {
    if (current && AC_SELF_ADMISSION_RE.test(current.text)) {
      const snippet = current.text.trim().replace(/\s+/g, " ").slice(0, 140);
      findings.push({
        code: "ac-ticked-self-admission",
        what: `ticked AC (line ${current.lineNo}) self-admits the mechanism is NOT in effect — evidence matches ${AC_SELF_ADMISSION_RE}: "${snippet}"; a [x] box asserts completion, self-admission wording contradicts it`,
      });
    }
    current = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const item = line.match(/^\s*-\s*\[(x|X| )\]\s*(.*)$/);
    if (item) {
      flush();
      if (item[1] === "x" || item[1] === "X") current = { text: item[2], lineNo: i + 1 };
      continue;
    }
    // continuation line of the current ticked AC (absorb until the next item / heading).
    if (current && line.trim() !== "" && !/^#{1,6}\s/.test(line)) {
      current.text += " " + line.trim();
    }
  }
  flush();
  return findings;
}

// ── Check 6: the DoD full-suite-demand line (gap-suite-green-gate-duplicated-in-task-dod-and-batch-merge, AC2) ──
// The full-suite-green criterion is correctly a BATCH-MERGE BOUNDARY gate (fast-mode-loop-tick.md
// step 3 / 红窗规则: red blocks $MERGE_TARGET→$FORK_BASELINE); the TASK-level duplicate in `## Definition
// of Done` ("完整套件连跑 2 次全绿") couples every task to a slow global signal it cannot control.
// NEW tasks must not carry this demand. The 86 (measured 2026-08-07) legacy occurrences are
// grandfathered in docs/analysis/dod-suite-line-baseline.md — a SHRINK-ONLY list, so a task NOT on
// that list whose DoD carries the demand is a NEW occurrence ⇒ reported (and, over the full store,
// a ratchet growth ⇒ exit 1).
//
// The demand is matched by the phrase family (完整套件 … 连跑|绿 within 40 chars) — NOT bare
// 「完整套件」: a DoD that says 「本任务自身不再要求完整套件」 or 「完整套件待资源闸 GO 后在 fan-in 补跑」
// is the NEW correct framing (the gate lives at the batch-merge boundary) and must NOT be flagged.
const DOD_SUITE_LINE_DEMAND_RE = /完整套件[\s\S]{0,40}?(?:连跑|绿)/;
export const DOD_SUITE_LINE_BASELINE_REL = "docs/analysis/dod-suite-line-baseline.md";

/** Read the shrink-only grandfather list of task files whose DoD legitimately still carries the
 * full-suite demand. Absent file ⇒ empty set (nothing grandfathered — every demand is reported). */
export function readDodSuiteLineBaseline(root) {
  const p = path.join(root, DOD_SUITE_LINE_BASELINE_REL);
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

/** A task's `## Definition of Done` section carries the full-suite demand AND the file is not
 * grandfathered ⇒ a new occurrence (AC2 negative control: a constructed task with the line is flagged). */
export function checkDodSuiteLine(body, taskFileRel, grandfathered) {
  const dod = extractSectionFenceAware(body, "Definition of Done");
  if (dod === null) return [];
  if (!DOD_SUITE_LINE_DEMAND_RE.test(dod)) return [];
  if (grandfathered.has(taskFileRel)) return [];
  return [{
    code: "dod-suite-line",
    what: "DoD 含「完整套件连跑 2 次全绿」——全量套件绿是批量合边界的闸门（fast-mode-loop-tick.md 红窗规则），任务 DoD 不含它；见 tasks/gap-suite-green-gate-duplicated-in-task-dod-and-batch-merge.md (AC2)",
  }];
}

// ── Check 7: bare-directory + uncertain-annotation Touches (gap-touches-bare-dir-uncertain-declaration-drags-the-pool, AC1) ──
// A Touches entry must NOT declare a BARE DIRECTORY with an UNCERTAIN annotation ('若成脚本' /
// '或等价' / '可能'). A bare dir expands to everything under it — a speculative broad declaration
// that drags the whole ready pool into conservative serialization (measured: branch-model's
// `plugin/scripts/（…，若成脚本）` expanded to 100+ files and sank 5/6 pool candidates). Rule: declare a
// CONCRETE path, or PRE-CLAIM an explicit candidate path (e.g. `plugin/scripts/branch-helper.sh`).
// Like checkDodSuiteLine, the legacy occurrences are grandfathered in a SHRINK-ONLY baseline — a task
// file NOT on the list whose Touches carries the pattern is a NEW occurrence ⇒ violation.
export const BARE_DIR_TOUCHES_BASELINE_REL = "docs/analysis/bare-dir-touches-baseline.md";

/** Read the shrink-only grandfather list of task files that legitimately still carry the bare-dir +
 *  uncertain-annotation Touches pattern (pre-rule debt). Absent file ⇒ empty set (nothing grandfathered). */
export function readBareDirTouchesBaseline(root) {
  const p = path.join(root, BARE_DIR_TOUCHES_BASELINE_REL);
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

/** A task's `## Touches` carries the bare-dir + uncertain-annotation pattern AND the file is not
 *  grandfathered ⇒ a NEW occurrence. `root` is the repo root (fs-confirms bare directories). */
export function checkBareDirUncertainTouches(body, taskFileRel, root, grandfathered) {
  if (grandfathered.has(taskFileRel)) return [];
  const { hasSection, section } = extractTouchesSection(body);
  if (!hasSection) return [];
  const flagged = flagBareDirUncertainTouches(section, root);
  if (flagged.length === 0) return [];
  const entries = flagged.map((f) => `\`${f.raw}\``).join(" · ");
  return [{
    code: "bare-dir-uncertain-touch",
    what:
      `## Touches 含裸目录 + 不确定标注（tasks/gap-touches-bare-dir-uncertain-declaration-drags-the-pool 规则：` +
      `Touches 禁裸目录 + '若成脚本'/'或等价'/'可能' 类不确定声明——声明具体路径或先占明确候选路径，如 ` +
      `plugin/scripts/branch-helper.sh）：${entries}`,
  }];
}

// ── Check 8: a wiring/reachability-declaring AC must name a real input probe (gap-wiring-claim-ac-requires-real-input-probe) ──
// A task's `## Acceptance Criteria` bullet that declares a quantified reachability/real-data relationship
// (backtick identifier + `N 条` + 读到/读取/样本/现成) must ALSO name a real input probe (真实生产载体记录数 /
// 真实 argv / /proc/<pid>/* / 真实 curl / 真机回放 — the direct量 from the task's human-specified criterion).
// A string-literal direct call, a self-built fixture, or an mkdtemp workspace is NOT a probe. The legacy
// occurrences (the two canonical instances: gap-readdepends-on-indented-extra-depends-on AC1,
// gap-ac146-human-interface-explicit-owner AC2) are grandfathered in a SHRINK-ONLY baseline — a task file
// NOT on that list whose AC carries the pattern is a NEW occurrence ⇒ violation.
export const WIRING_CLAIM_AC_PROBE_BASELINE_REL = "docs/analysis/wiring-claim-ac-probe-baseline.md";

/** Read the shrink-only grandfather list of task files whose AC legitimately still carries the wiring/
 *  reachability declaration without a real input probe (pre-rule debt). Absent file ⇒ empty set. */
export function readWiringClaimAcProbeBaseline(root) {
  const p = path.join(root, WIRING_CLAIM_AC_PROBE_BASELINE_REL);
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

/** A task's `## Acceptance Criteria` carries a wiring/reachability declaration WITHOUT a real input
 *  probe, AND the file is not grandfathered ⇒ a NEW occurrence (AC1 negative control: a constructed
 *  declaration-without-probe is flagged; a real-probe bullet and a pure-function task are not). */
export function checkWiringClaimAcProbeGated(body, taskFileRel, grandfathered) {
  if (grandfathered.has(taskFileRel)) return [];
  const ac = extractSectionFenceAware(body, "Acceptance Criteria");
  if (ac === null) return [];
  return checkWiringClaimAcProbe(ac).map((f) => ({
    code: f.code,
    what: `${f.message} — see tasks/gap-wiring-claim-ac-requires-real-input-probe.md`,
  }));
}

// ── Per-task scan ────────────────────────────────────────────────────────────────────────────────────
// Returns { taskId, violations: [{code, what}], info: [{code, what}] }.
// `violations` feed the ratchet list; `info` is non-ratchet context (absent sections on tasks that
// have not opted into the mechanism — the pre-ratchet baseline).
// `dodSuiteLineBaseline` (a Set of repo-root-relative task file paths) is the grandfather list for
// the DoD full-suite-demand check (gap-suite-green-gate-..., AC2): files ON the list keep their
// legacy DoD line; a file NOT on it with the demand is a NEW occurrence ⇒ violation.
export function scanTaskText(text, taskFileRel = "", { dodSuiteLineBaseline = new Set(), bareDirTouchesBaseline = new Set(), wiringClaimAcProbeBaseline = new Set(), root = null } = {}) {
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
    violations.push(...checkTickedAcSelfAdmission(ac));
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

  // Check 6: DoD full-suite-demand line (gap-suite-green-gate-..., AC2) — a NEW occurrence (a file not
  // on the shrink-only grandfather list whose DoD carries the demand) is a violation.
  violations.push(...checkDodSuiteLine(body, taskFileRel, dodSuiteLineBaseline));

  // Check 7: bare-directory + uncertain-annotation Touches (gap-touches-bare-dir-uncertain-declaration-
  // drags-the-pool, AC1) — a NEW occurrence (a file not on the shrink-only grandfather list whose
  // Touches carries the bare-dir + uncertain pattern) is a violation. Runs regardless of whether the
  // task has a ## Contract (it is a ## Touches rule, not a Contract rule).
  violations.push(...checkBareDirUncertainTouches(body, taskFileRel, root, bareDirTouchesBaseline));

  // Check 8: wiring/reachability-declaring AC without a real input probe (gap-wiring-claim-ac-requires-
  // real-input-probe) — a NEW occurrence (a file not on the shrink-only grandfather list whose AC
  // carries the pattern) is a violation. Runs regardless of ## Contract (it is an ## Acceptance Criteria
  // rule, not a Contract rule — same as checks 6/7).
  violations.push(...checkWiringClaimAcProbeGated(body, taskFileRel, wiringClaimAcProbeBaseline));

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

// ── Grow-only ledger (--no-block: task-file violations are RECORDED, never blocking) ────────────────
// gap-task-file-static-syntax-should-not-block-product-verification option ① — a task-file
// Contract/AC syntax violation is a different risk class from "is the product code usable", so in
// --no-block mode (the verification-round path) it must NOT stop the round. The accounting that keeps
// it visible is a GROW-ONLY ledger at .quay/task-file-violation-ledger.jsonl (gitignored runtime
// state, same family as verification-round.jsonl): an entry is written once per (checker, violation)
// pair and NEVER removed — the ledger can only grow, so silent deterioration (task files accumulating
// syntax violations) stays visible without ever blocking. The checker's DEFAULT mode (no --no-block)
// keeps the shrink-only ratchet blocking behavior (maintenance / mutation tests).
export const NO_BLOCK_LEDGER_REL = ".quay/task-file-violation-ledger.jsonl";

export function recordNoBlockLedger(root, checker, violations, { at = new Date().toISOString() } = {}) {
  const p = path.join(root, NO_BLOCK_LEDGER_REL);
  const seen = new Set();
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      try {
        const d = JSON.parse(t);
        if (d && typeof d.key === "string") seen.add(d.key);
      } catch { /* malformed line — skip (append-only ledger, never rewrites) */ }
    }
  }
  const rows = [];
  for (const v of violations) {
    const key = `${checker}|${v}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(JSON.stringify({ key, checker, violation: v, at }));
  }
  if (rows.length === 0) return { recorded: 0, ledgerPath: p, rows };
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, rows.join("\n") + "\n");
  return { recorded: rows.length, ledgerPath: p, rows };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────
export function runCli(argv) {
  const args = argv.slice();
  if (args.includes("--help") || args.includes("-h")) helpExit("usage: node task-contract-check.ts [--root <dir>] [--json] [--write-ratchet] [--allow-growth] [--reset-baseline] [--strict-subset] [--no-block] [<task-file> ...]");
  let root = null;
  let json = false;
  let writeRatchetFlag = false;
  let allowGrowth = false;
  let resetBaseline = false;
  let strictSubset = false;
  let noBlock = false;
  const files = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--root") { root = args[++i]; }
    else if (a === "--json") { json = true; }
    else if (a === "--write-ratchet") { writeRatchetFlag = true; }
    else if (a === "--allow-growth") { allowGrowth = true; }
    else if (a === "--reset-baseline") { resetBaseline = true; }
    else if (a === "--strict-subset") { strictSubset = true; }
    else if (a === "--no-block") { noBlock = true; }
    else if (a.startsWith("-")) { console.error(`task-contract-check: unknown flag: ${a}`); process.exit(2); }
    else { files.push(a); }
  }
  if (resetBaseline && !writeRatchetFlag) {
    console.error("task-contract-check: --reset-baseline requires --write-ratchet (it is the write that re-anchors the ceiling)");
    process.exit(2);
  }
  const wsRoot = root ? path.resolve(root) : repoRoot();
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
  // Check 6 (dod-suite-line): the shrink-only grandfather list. Files on it keep their legacy DoD
  // full-suite demand; a file NOT on it with the demand is a NEW occurrence. Ceiling breach (the list
  // itself grew past its baseline-count header) is a ratchet violation independent of task violations.
  const dodBaseline = readDodSuiteLineBaseline(wsRoot);
  // Check 7 (bare-dir-uncertain-touch): the shrink-only grandfather list for the bare-directory +
  // uncertain-annotation Touches pattern (gap-touches-bare-dir-uncertain-declaration-drags-the-pool).
  const bareDirBaseline = readBareDirTouchesBaseline(wsRoot);
  // Check 8 (wiring-claim-ac-no-probe): the shrink-only grandfather list for the wiring/reachability
  // declaration without a real input probe (gap-wiring-claim-ac-requires-real-input-probe).
  const wiringClaimAcProbeBaseline = readWiringClaimAcProbeBaseline(wsRoot);
  for (const file of list) {
    const rel = path.relative(wsRoot, file);
    const text = fs.readFileSync(file, "utf8");
    const res = scanTaskText(text, rel, {
      dodSuiteLineBaseline: dodBaseline.baseline,
      bareDirTouchesBaseline: bareDirBaseline.baseline,
      wiringClaimAcProbeBaseline: wiringClaimAcProbeBaseline.baseline,
      root: wsRoot,
    });
    for (const v of res.violations) allViolations.push(`${rel}: ${v.code}`);
    allInfo.push(...res.info.map((i) => ({ file: rel, ...i })));
    if (res.violations.length > 0 || res.info.length > 0) {
      perTask.push({ file: rel, taskId: res.taskId, violations: res.violations, info: res.info });
    }
  }
  const dodCeilingBreach =
    dodBaseline.baselineCount !== null && dodBaseline.baseline.size > dodBaseline.baselineCount;
  if (dodCeilingBreach) {
    // --no-block wording avoids the full-suite-runner's "CEILING BREACH" static-check failure marker —
    // a task-file checker in no-block mode reports but must never flip the verification round red.
    console.error(noBlock
      ? `task-contract-check: dod-suite-line baseline-count STALE (recorded, non-blocking) — docs/analysis/dod-suite-line-baseline.md has ${dodBaseline.baseline.size} entries but baseline-count: ${dodBaseline.baselineCount}; the grandfather list can only get SHORTER (gap-suite-green-gate-..., AC2)`
      : `task-contract-check: dod-suite-line baseline CEILING BREACH — docs/analysis/dod-suite-line-baseline.md has ${dodBaseline.baseline.size} entries but baseline-count: ${dodBaseline.baselineCount}; the grandfather list can only get SHORTER (gap-suite-green-gate-..., AC2)`);
  }
  const bareDirCeilingBreach =
    bareDirBaseline.baselineCount !== null && bareDirBaseline.baseline.size > bareDirBaseline.baselineCount;
  if (bareDirCeilingBreach) {
    console.error(noBlock
      ? `task-contract-check: bare-dir-touches baseline-count STALE (recorded, non-blocking) — docs/analysis/bare-dir-touches-baseline.md has ${bareDirBaseline.baseline.size} entries but baseline-count: ${bareDirBaseline.baselineCount}; the grandfather list can only get SHORTER (gap-touches-bare-dir-uncertain-declaration-drags-the-pool, AC1)`
      : `task-contract-check: bare-dir-touches baseline CEILING BREACH — docs/analysis/bare-dir-touches-baseline.md has ${bareDirBaseline.baseline.size} entries but baseline-count: ${bareDirBaseline.baselineCount}; the grandfather list can only get SHORTER (gap-touches-bare-dir-uncertain-declaration-drags-the-pool, AC1)`);
  }
  const wiringClaimAcProbeCeilingBreach =
    wiringClaimAcProbeBaseline.baselineCount !== null &&
    wiringClaimAcProbeBaseline.baseline.size > wiringClaimAcProbeBaseline.baselineCount;
  if (wiringClaimAcProbeCeilingBreach) {
    console.error(noBlock
      ? `task-contract-check: wiring-claim-ac-probe baseline-count STALE (recorded, non-blocking) — docs/analysis/wiring-claim-ac-probe-baseline.md has ${wiringClaimAcProbeBaseline.baseline.size} entries but baseline-count: ${wiringClaimAcProbeBaseline.baselineCount}; the grandfather list can only get SHORTER (gap-wiring-claim-ac-requires-real-input-probe)`
      : `task-contract-check: wiring-claim-ac-probe baseline CEILING BREACH — docs/analysis/wiring-claim-ac-probe-baseline.md has ${wiringClaimAcProbeBaseline.baseline.size} entries but baseline-count: ${wiringClaimAcProbeBaseline.baselineCount}; the grandfather list can only get SHORTER (gap-wiring-claim-ac-requires-real-input-probe)`);
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
  // --no-block (option ①): task-file violations are RECORDED (grow-only ledger) but never block, so
  // ratchet growth never contributes to the exit code in the verification-round path.
  const growth = !noBlock && !subset && !firstBaseline && newOnes.length > 0 && !allowGrowth && !resetBaseline;

  let writeOutcome = null;
  // --no-block never mutates the shrink-only baseline (the grow-only ledger is the accounting);
  // --write-ratchet stays a maintenance-time action only.
  if (writeRatchetFlag && !growth && !subset && !noBlock) {
    writeOutcome = writeRatchet(wsRoot, currentEntries, { reset: resetBaseline });
    if (!writeOutcome.ok) return finish({ json, perTask, allInfo, currentEntries, newOnes, resolved, baselineCount, growth: true, writeOutcome, wsRoot, subset, strictSubset, dodCeilingBreach, bareDirCeilingBreach, wiringClaimAcProbeCeilingBreach, noBlock });
  }

  return finish({ json, perTask, allInfo, currentEntries, newOnes, resolved, baselineCount, growth, writeOutcome, wsRoot, subset, strictSubset, dodCeilingBreach, bareDirCeilingBreach, wiringClaimAcProbeCeilingBreach, noBlock });
}

function finish({ json, perTask, allInfo, currentEntries, newOnes, resolved, baselineCount, growth, writeOutcome, wsRoot, subset, strictSubset = false, dodCeilingBreach = false, bareDirCeilingBreach = false, wiringClaimAcProbeCeilingBreach = false, noBlock = false }) {
  // --no-block (gap-task-file-static-syntax-should-not-block-product-verification, option ①): a NEW
  // task-file violation is RECORDED in the grow-only ledger (the "ratchet 只增不减 记账") but never
  // blocks the verification round — task-file Contract/AC syntax is a different risk class from "is
  // the product code usable". The ledger write is best-effort (a ledger I/O failure must never turn a
  // deliberately non-blocking check red).
  let ledger = null;
  if (noBlock && newOnes.length > 0) {
    try { ledger = recordNoBlockLedger(wsRoot, "task-contract-check", newOnes); }
    catch (e) { console.error(`task-contract-check: ledger write failed (non-blocking, ignored): ${e?.message ?? e}`); }
  }
  if (json) {
    const report = {
      workspaceRoot: wsRoot,
      subset,
      noBlock,
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
      ledger,
      dodSuiteLineCeilingBreach: dodCeilingBreach,
      bareDirTouchesCeilingBreach: bareDirCeilingBreach,
      wiringClaimAcProbeCeilingBreach,
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
    if (noBlock && newOnes.length > 0) {
      console.log(`recorded (non-blocking, grow-only ledger): ${newOnes.length} new task-file violation(s) — task-file syntax does NOT block the verification round (gap-task-file-static-syntax-should-not-block-product-verification)`);
    }
    if (subset) {
      console.log("subset scan (<task-file> args) — ratchet comparison skipped (it is only meaningful over the full store)");
      if (strictSubset) {
        console.log(noBlock
          ? "strict-subset mode (scoped static-check tier) — task-file violations REPORTED + ledgered, NOT blocking; unrelated tasks are not scanned"
          : "strict-subset mode (scoped static-check tier) — a violation on a scanned task FAILS this run (exit 1); unrelated tasks are not scanned");
      }
    } else if (baselineCount !== null) {
      console.log(noBlock
        ? `ratchet ceiling: ${baselineCount}; recorded (non-blocking): ${newOnes.length}${newOnes.length ? ` (${newOnes.join(", ")})` : ""}; resolved: ${resolved.length}${resolved.length ? ` (${resolved.join(", ")})` : ""}`
        : `ratchet ceiling: ${baselineCount}; new since baseline: ${newOnes.length}${newOnes.length ? ` (${newOnes.join(", ")})` : ""}; resolved: ${resolved.length}${resolved.length ? ` (${resolved.join(", ")})` : ""}`);
    }
    if (writeOutcome) console.log(`write: ${writeOutcome.reason}`);
  }
  // strict-subset (the scoped tier's contract-consumer): a violation on ANY scanned (touched) task
  // is a failure — the touched task's Contract is change-relevant, so scoped MUST catch it (AC4-i).
  // The ratchet comparison stays skipped (unrelated tasks are not scanned, so nothing to compare).
  // --no-block: strictFail is suppressed (the scoped run is ALSO a verification — task-file syntax
  // must not stop it), the violation is still reported + ledgered above.
  const strictFail = !noBlock && strictSubset && subset && perTask.some((t) => t.violations.length > 0);
  if (dodCeilingBreach && !json) console.log(noBlock ? "task-contract-check: DOD-SUITE-LINE BASELINE-COUNT STALE (recorded, non-blocking) — grandfather list can only get SHORTER" : "task-contract-check: DOD-SUITE-LINE BASELINE CEILING BREACH — grandfather list can only get SHORTER");
  if (bareDirCeilingBreach && !json) console.log(noBlock ? "task-contract-check: BARE-DIR-TOUCHES BASELINE-COUNT STALE (recorded, non-blocking) — grandfather list can only get SHORTER" : "task-contract-check: BARE-DIR-TOUCHES BASELINE CEILING BREACH — grandfather list can only get SHORTER");
  if (wiringClaimAcProbeCeilingBreach && !json) console.log(noBlock ? "task-contract-check: WIRING-CLAIM-AC-PROBE BASELINE-COUNT STALE (recorded, non-blocking) — grandfather list can only get SHORTER" : "task-contract-check: WIRING-CLAIM-AC-PROBE BASELINE CEILING BREACH — grandfather list can only get SHORTER");
  const block = !noBlock && (growth || strictFail || dodCeilingBreach || bareDirCeilingBreach || wiringClaimAcProbeCeilingBreach);
  process.exit(block ? 1 : 0);
}

// Entry point when run directly (not imported).
// Bundler-safe guard — see gate-script-base.isDirectEntry
// (gap-drivers-yml-interval-not-honored-for-routine-kinds): a hand-rolled file-identity comparison is
// true for EVERY inlined module of a dist bundle, so it hijacks any bundle that inlines this module.
if (isDirectEntry(import.meta, undefined, "task-contract-check")) {
  runCli(process.argv.slice(2));
}
