#!/usr/bin/env node
// no-manager-tick-doc-check.ts — mechanical checker for C3 (gap-manager-productization-five-constraints
// AC4): the OUTER tick docs must contain NO create/drive/check manager STEPS.
//
// Spec: SPEC-manager-productization-2026-08-05 §3 — "orchestrator-loop-tick.md 里不得出现任何
// 创建/驱动/检查 manager 的步骤" is a MECHANICAL check, not a discipline. Build ownership = quay
// outer/inner; run ownership = human/Claude-Code-loop, NEVER outer.
//
// WHAT IT DETECTS (by POSITION, never by keyword):
//   An ACTIONABLE manager step is a line in an outer tick doc that INSTRUCTS the outer to create,
//   drive, or check the manager — a command invocation (`quay manager start/adopt/arm`,
//   `manager start`, `CronCreate … manager`) or a tight verb-object Chinese conjunction
//   (创建/启动/拉起/驱动/检查/重启 + manager). These are steps the outer must never take.
//
//   It is NOT keyword-based: the outer tick docs LEGITIMATELY mention "manager" as boundary context
//   ("manager 跨项目不属于项目拓扑", "已存在的 inner 可能是 manager 建的", "接手 manager 预建的会话").
//   A naive `grep manager` self-hits 100% on those — the naive keyword class that already failed in
//   this repo (the drive-contract-check comment: "a word that describes a defect necessarily appears
//   in the defect's own docs"). So the checker flags only the tight actionable signatures below and
//   explicitly allows boundary/negation phrases.
//
// MODES:
//   default — scan the two normative OUTER tick docs under --root:
//             plugin/loop/orchestrator-loop-tick.md (the shipped template)
//             orchestration/orchestrator-loop-tick.md (the quay-local outer landing)
//             Exit 0 iff no actionable manager step is found. (The INNER tick doc and the MANAGER's
//             own tick doc are NOT scanned — inner is driven by outer, not the reverse, and the
//             manager's own doc necessarily discusses the manager.)
//   --judge <path> — judge ONE arbitrary doc (absolute, or relative to --root). Exit 1 iff it
//             contains an actionable manager step. (The AC4 control + tests.)
//   --json   — machine-readable output; the ## Contract measure reads the `violations` field.
//
// Exit codes: 0 = PASS; 1 = FAIL (an actionable create/drive/check manager step found);
//             2 = usage/env error.

import fs from "node:fs";
import path from "node:path";
import { isDirectEntry } from "./gate-script-base.ts";

/**
 * An ACTIONABLE manager step — the outer CREATES/DRIVES/CHECKS the manager. Structural signatures:
 *   - explicit command invocations: `quay manager start|adopt|arm`, `manager start|adopt`,
 *     `CronCreate … manager`, `/loop … manager`
 *   - tight Chinese verb-object conjunctions where manager is the DIRECT object of a creation/
 *     drive/check/restart verb: 创建/启动/拉起/驱动/检查/重启 + manager (optional whitespace between).
 *     The object must be IMMEDIATE ("创建 manager"), so boundary phrases like "创建单窗口拓扑（…manager…）"
 *     (创建's object is 单窗口拓扑, not manager) do not match.
 */
export const ACTIONABLE_STEP_RE =
  /(?:quay\s+manager\s+(?:start|adopt|arm)|(?:^|\s)manager\s+(?:start|adopt)|CronCreate[^\n]{0,40}manager|\/loop[^\n]{0,20}manager|创建\s*manager|启动\s*manager|拉起\s*manager|驱动\s*manager|检查\s*manager|重启\s*manager)/;

/**
 * Boundary/negation phrases that are LEGITIMATE context in an outer tick doc — they describe WHY the
 * outer does NOT create/drive/check the manager. A line matching BOTH ACTIONABLE_STEP_RE and one of
 * these is exempted (the negation explicitly forbids the action). This covers the known good lines
 * such as "manager 跨项目，不建" (不建 = does NOT build).
 */
export const BOUNDARY_EXEMPT_RE =
  /不建|不属于|不属于项目拓扑|跨项目|预建|可能.{0,4}建的|不是.{0,4}(:?项目拓扑|拓扑)|不应|不得|无权|不归/;

/**
 * Judge one doc's text. Returns an array of { line, text } for actionable manager steps that are
 * NOT boundary-exempt.
 */
export function checkDocText(text) {
  const violations = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!ACTIONABLE_STEP_RE.test(line)) continue;
    if (BOUNDARY_EXEMPT_RE.test(line)) continue;
    violations.push({ line: i + 1, text: line.trim().slice(0, 160) });
  }
  return violations;
}

const DEFAULT_DOCS = [
  "plugin/loop/orchestrator-loop-tick.md",
  "orchestration/orchestrator-loop-tick.md",
];

export function run({ root, json = false, judge }) {
  const docs = judge ? [judge] : DEFAULT_DOCS;
  const allViolations = [];
  const scanned = [];
  for (const rel of docs) {
    const p = path.isAbsolute(rel) ? rel : path.resolve(root, rel);
    if (!fs.existsSync(p)) {
      if (judge) {
        // --judge on a missing path is a usage error.
        process.stderr.write(`no-manager-tick-doc-check: file not found: ${p}\n`);
        process.exitCode = 2;
        return;
      }
      continue;
    }
    scanned.push(rel);
    const text = fs.readFileSync(p, "utf8");
    const v = checkDocText(text);
    for (const item of v) allViolations.push({ doc: rel, ...item });
  }

  if (json) {
    process.stdout.write(`${JSON.stringify({ scanned, violations: allViolations, ok: allViolations.length === 0 }, null, 2)}\n`);
  } else {
    for (const v of allViolations) {
      process.stdout.write(`${v.doc}:${v.line}: actionable manager step: ${v.text}\n`);
    }
    if (allViolations.length === 0) {
      process.stdout.write(`no-manager-tick-doc-check: PASS (${scanned.length} outer tick doc(s) scanned, no create/drive/check manager step)\n`);
    } else {
      process.stdout.write(`no-manager-tick-doc-check: FAIL (${allViolations.length} actionable manager step(s) in outer tick docs)\n`);
    }
  }
  process.exitCode = allViolations.length > 0 ? 1 : 0;
}

if (isDirectEntry(import.meta, undefined, "no-manager-tick-doc-check")) {
  const args = process.argv.slice(2);
  let root = ".";
  let json = false;
  let judge = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--root") { root = args[++i]; }
    else if (a === "--json") { json = true; }
    else if (a === "--judge") { judge = args[++i]; }
    else if (a === "--help" || a === "-h") {
      process.stdout.write("no-manager-tick-doc-check.ts [--root <dir>] [--json] [--judge <path>]\n");
      process.exit(0);
    }
  }
  run({ root, json, judge });
}
