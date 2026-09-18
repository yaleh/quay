#!/usr/bin/env node
// dark-axis-record-check.ts — ADR-007's PER-MILESTONE predicate, as an independently callable
// check (tasks/gap-adr007-per-milestone-dark-axis-enforcement-gate, AC1).
//
//   node --experimental-strip-types plugin/scripts/dark-axis-record-check.ts <task-id>
//
// ADR-007 forbids judging a milestone on L_T alone, and its own enforcement comment has recorded
// since 2026-07-20 that the per-milestone half — "check the milestone DoD records an L_D/L_G
// reading … or an explicit 'axis still dark' note; fail-closed if all three are silently absent" —
// was STILL FUTURE WORK. This script is that predicate's command-line face. Its judgment is NOT
// re-implemented here: {@link classifyDarkAxisRecord} lives in
// `packages/quay/src/gate/dark-axis-record.ts` (Core), and the built-in `dark-axis` gate registry
// entry (packages/quay/src/gate/registry.ts, enforced on the ready→done path by
// packages/quay/src/gate/lifecycle.ts) calls the SAME function. One rule, three faces — no second
// copy to drift (docs/proposals/exp5-crystallization-strategy.md: single source + executable
// invariants).
//
// The three states (AC1):
//   RECORDED     the body carries a parseable L_D/L_G reading — the concrete numbers ARE printed
//   DISCLAIMED   the body carries the explicit `该轴仍暗,理由:<...>` declaration
//   MISSING      neither — exit 1 (fail-closed; this is the state the ready→done gate refuses)
//   NOT-EVALUATED the body could not be read at all — exit 2, its OWN value, never folded into
//                 MISSING or RECORDED (硬规则 3b: an unreadable input must not be shaped like a
//                 verdict about the input's content)
//
// Run:
//   node --experimental-strip-types plugin/scripts/dark-axis-record-check.ts <task-id> [--root <dir>] [--json]
//   --root <dir>  workspace root holding `tasks/<task-id>.md` (default: cwd) — the convention
//                 fan-in-ac-completion-gate.ts already uses, so the two read the same file the
//                 same way.
//   --json        { task, state, readings, disclaimer, reason, numbers } on stdout
//
// Exit: 0 = RECORDED | DISCLAIMED; 1 = MISSING; 2 = NOT-EVALUATED / usage error / task file absent.

import fs from "node:fs";
import path from "node:path";
import {
  classifyDarkAxisRecord,
  type DarkAxisVerdict,
} from "../../packages/quay/src/gate/dark-axis-record.ts";
// getFlagValue now lives in gate-script-base.ts as `flagValue` (it was one of the byte-identical
// copies of the indexOf+next-arg idiom in plugin/scripts; .quay/routine-findings.jsonl finding
// `arg-parsing-helper-family`, routine `semantic-dedup-scan`).
import { isDirectEntry, flagValue } from "./gate-script-base.ts";

// Re-exported for the in-repo consumers that treat this module as the predicate's plugin-side entry
// (plugin/scripts/ready-pool-check.ts reads a pool task's dark-axis state through this name, and the
// unit test exercises the gate verdict here). The implementation is Core's — this file adds only the
// CLI face.
export {
  classifyDarkAxisRecord,
  darkAxisGateCheck,
  type DarkAxisState,
  type DarkAxisVerdict,
} from "../../packages/quay/src/gate/dark-axis-record.ts";

/** The task BODY, with the YAML frontmatter removed. Boundary detection is by a LINE-START `---`
 *  fence (never `split("---")[1]`, which silently truncates when the body itself contains `---`,
 *  e.g. a markdown horizontal rule — CLAUDE.md-recalled trap `frontmatter-naive-dash-split`). */
export function taskBodyOf(fileText: string): string {
  const lines = fileText.split("\n");
  if (lines.length === 0 || lines[0].trim() !== "---") return fileText;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") return lines.slice(i + 1).join("\n");
  }
  return fileText; // no closing fence → not frontmatter; scan the whole file rather than drop it
}

export const USAGE = `dark-axis-record-check.ts — ADR-007 per-milestone dark-axis record check

Usage:
  node --experimental-strip-types plugin/scripts/dark-axis-record-check.ts <task-id> [--root <dir>] [--json] [--help]

  <task-id>     task whose body to classify (REQUIRED; reads <root>/tasks/<task-id>.md)
  --root <dir>  workspace root (default: cwd)
  --json        machine-readable output
  --help        this help

States:
  RECORDED      body carries a parseable L_D/L_G reading (its concrete numbers are printed)
  DISCLAIMED    body carries the explicit declaration 该轴仍暗,理由:<...>
  MISSING       neither present
  NOT-EVALUATED body unreadable (own value, never folded into MISSING/RECORDED)

Exit codes:
  0  RECORDED | DISCLAIMED
  1  MISSING          (fail-closed — the state the ready->done dark-axis gate refuses)
  2  NOT-EVALUATED / usage error / task file not found`;

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  // Positional scan that consumes the VALUE of value-taking flags (`--root <dir>`) so a root path
  // can never be mistaken for the task id.
  const VALUE_FLAGS = new Set(["--root"]);
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (VALUE_FLAGS.has(args[i])) {
      i++;
      continue;
    }
    if (args[i].startsWith("-")) continue;
    positional.push(args[i]);
  }
  const taskId = positional[0];
  if (!taskId) {
    process.stderr.write(`dark-axis-record-check: <task-id> is required\n${USAGE}\n`);
    return 2;
  }

  const root = path.resolve(flagValue(args, "--root") ?? process.cwd());
  const asJson = args.includes("--json");
  const taskPath = path.join(root, "tasks", `${taskId}.md`);

  let verdict: DarkAxisVerdict;
  if (!fs.existsSync(taskPath)) {
    // The task's BODY is the object of this check; without it there is nothing to classify. This is
    // NOT "no record" — it is "could not look" (硬规则 3b).
    verdict = {
      state: "NOT-EVALUATED",
      readings: [],
      disclaimer: null,
      reason: `NOT-EVALUATED — no task file at ${taskPath}; the body could not be read, so no statement about its contents is available.`,
    };
  } else {
    verdict = classifyDarkAxisRecord(taskBodyOf(fs.readFileSync(taskPath, "utf8")));
  }

  const numbers = verdict.readings.flatMap((r) => r.numbers);
  if (asJson) {
    process.stdout.write(
      `${JSON.stringify(
        { task: taskId, state: verdict.state, readings: verdict.readings, disclaimer: verdict.disclaimer, numbers, reason: verdict.reason },
        null,
        2
      )}\n`
    );
  } else {
    process.stdout.write(`dark-axis-record-check: ${taskId}\n`);
    process.stdout.write(`  state:    ${verdict.state}\n`);
    for (const r of verdict.readings) {
      process.stdout.write(`  reading:  ${r.axis} (line ${r.line}) = [${r.numbers.join(", ")}]  ${r.text}\n`);
    }
    if (verdict.disclaimer) {
      process.stdout.write(`  declared: line ${verdict.disclaimer.line}: ${verdict.disclaimer.text} (理由: ${verdict.disclaimer.reason})\n`);
    }
    process.stdout.write(`  numbers:  ${numbers.length > 0 ? numbers.join(", ") : "(none)"}\n`);
    process.stdout.write(`  reason:   ${verdict.reason}\n`);
  }

  if (verdict.state === "RECORDED" || verdict.state === "DISCLAIMED") return 0;
  return verdict.state === "MISSING" ? 1 : 2;
}

if (isDirectEntry(import.meta, undefined, "dark-axis-record-check")) {
  process.exit(main(process.argv));
}
