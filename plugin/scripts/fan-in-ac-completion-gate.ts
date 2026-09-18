#!/usr/bin/env node
// fan-in-ac-completion-gate.ts — gap-fan-in-flip-no-ac-completion-check.
//
// THE DEFECT (from the task title): .claude/workflows/fan-in-execute.js's flip (step 5) only checked
// the LINE SHAPE (`status: ready`) — NOT whether the task's ACs are complete — so any task that went
// through the workflow fan-in was flipped to `done` even with zero checked AC boxes (52
// done-with-zero-checked-ACs, gap-ac72-cert-mechanism-retire as the sample). The workflow bypassed the
// AC47 done-flip gate that the pool's own done-flip paths use (isLandedCodeComplete / isBodyLanded /
// notYetFlipped).
//
// THIS module is the mechanical fan-in flip AC-completion gate. It runs INSIDE the flip's bash block,
// BEFORE the `sed -i 's/^status: ready$/status: done/'`:
//   1. Reads the task's body (tasks/<id>.md).
//   2. Runs the SAME AC47 predicate the pool's done-flip paths use — countCompletionCheckboxes
//      (ready-pool-check.ts) — via isLandedCodeComplete (slot-refill.ts), the LANDED-IMPLEMENTATION
//      completion gate. 同源不新造: no second counting function, the exact AC47 consumer; a count
//      written here in grep/sed would be exactly the drift this task exists to remove.
//   3. Verdict (three distinguishable states — 硬规则 3b: a judge whose output vocabulary has no
//      "未评估" state cannot tell "查过且合格" from "没查成"):
//        - AC/DoD section ABSENT / UNRECOGNIZED (sectionFound:false) ⇒ NOT-EVALUATED — fail-closed
//          (无法评估 ≠ 合格). exit 2. Distinguishable from "checked and failing".
//        - isLandedCodeComplete(body) true — all checked, OR a present-but-empty section (total=0,
//          the landing-is-its-closeout shape), OR every remaining unchecked item is （待外部）/
//          outer-verification (the established awaiting-verification done-flip shape) ⇒ PASS, flip
//          allowed. exit 0.
//        - else ⇒ FAIL ("AC 未全勾"), flip refused. exit 1.
//
// Exit codes: 0 = flip allowed · 1 = AC 未全勾 (flip refused) · 2 = NOT-EVALUATED / usage error
// (fail-closed, never allows the flip).

import fs from "node:fs";
import path from "node:path";
// getArgValue now lives in gate-script-base.ts as `flagValue` (it was one of the byte-identical
// copies of the indexOf+next-arg idiom in plugin/scripts; .quay/routine-findings.jsonl finding
// `arg-parsing-helper-family`, routine `semantic-dedup-scan`).
import { isDirectEntry, flagValue } from "./gate-script-base.ts";
import { countCompletionCheckboxes } from "./ready-pool-check.ts";
import { isLandedCodeComplete } from "./slot-refill.ts";

/** Pure verdict: should the fan-in flip be allowed for this task body?
 *  Mirrors isLandedCodeComplete exactly (the AC47 done-flip gate), but returns a DISTINGUISHABLE
 *  status so the flip can tell "checked and failed" from "could not evaluate" (硬规则 3b). */
export function flipAcGateVerdict(body) {
  const { sectionFound, total, checked, unchecked, uncheckedItems } = countCompletionCheckboxes(body);
  if (!sectionFound) {
    return {
      ok: false,
      status: "not-evaluated",
      total,
      checked,
      unchecked,
      message:
        "AC/DoD 段缺失或无法识别（sectionFound:false）——无法评估 ≠ 合格，未翻 done",
    };
  }
  if (!isLandedCodeComplete(body)) {
    return {
      ok: false,
      status: "fail",
      total,
      checked,
      unchecked,
      message: `AC 未全勾（checked ${checked}/${total}，剩余未勾 ${unchecked} 含非待外部项）——未翻 done`,
    };
  }
  if (checked === total) {
    return { ok: true, status: "pass", total, checked, unchecked, message: `AC 全勾（${checked}/${total}）——可翻 done` };
  }
  if (total === 0) {
    return { ok: true, status: "pass-no-boxes", total, checked, unchecked, message: "完成复选框为零（段存在，total=0）——落地即收尾，可翻 done" };
  }
  return {
    ok: true,
    status: "pass-external",
    total,
    checked,
    unchecked,
    message: `剩余未勾 ${unchecked} 项均为（待外部）/外层验证——可翻 done`,
  };
}

const usage = `fan-in-ac-completion-gate.ts — fan-in flip AC-completion gate (gap-fan-in-flip-no-ac-completion-check)

Usage:
  node --experimental-strip-types fan-in-ac-completion-gate.ts --task <id> [--worktree <dir>] [--json] [--help]

  --task <id>    task id whose AC completion to evaluate (REQUIRED — reads <cwd>/tasks/<id>.md)
  --worktree <dir>  the task's worktree (default: cwd). The task file is read from here.
  --json         machine-readable output { ok, status, total, checked, unchecked, message, task }
  --help         this help

Exit codes:
  0  PASS — flip allowed (AC all checked / present-but-empty section / all remaining items 待外部)
  1  FAIL  — AC 未全勾 (flip refused: an unchecked item is this task's own implementation)
  2  NOT-EVALUATED / usage error (AC/DoD section absent or unreadable, or bad args — fail-closed)`;

export function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(usage + "\n");
    return 0;
  }
  const taskId = flagValue(args, "--task");
  if (!taskId) {
    process.stderr.write(`fan-in-ac-completion-gate: --task is required\n${usage}\n`);
    return 2;
  }
  const worktree = path.resolve(flagValue(args, "--worktree") ?? process.cwd());
  const asJson = args.includes("--json");
  const taskPath = path.join(worktree, "tasks", `${taskId}.md`);
  if (!fs.existsSync(taskPath)) {
    process.stderr.write(`fan-in-ac-completion-gate: task file not found: ${taskPath}\n`);
    return 2;
  }
  const body = fs.readFileSync(taskPath, "utf8");
  const v = flipAcGateVerdict(body);
  if (asJson) {
    process.stdout.write(JSON.stringify({ task: taskId, ...v }, null, 2) + "\n");
  } else if (v.ok) {
    console.log(`fan-in-ac-completion-gate: ${v.message}`);
    console.log("fan-in-ac-completion-gate: PASS (exit 0) — flip allowed");
  } else if (v.status === "not-evaluated") {
    console.log(`fan-in-ac-completion-gate: ${v.message}`);
    console.log("fan-in-ac-completion-gate: NOT-EVALUATED (exit 2) — flip refused (fail-closed)");
  } else {
    console.log(`fan-in-ac-completion-gate: ${v.message}`);
    console.log("fan-in-ac-completion-gate: FAIL (exit 1) — flip refused");
  }
  return v.ok ? 0 : (v.status === "not-evaluated" ? 2 : 1);
}

if (isDirectEntry(import.meta, undefined, "fan-in-ac-completion-gate")) {
  process.exitCode = main(process.argv);
}
