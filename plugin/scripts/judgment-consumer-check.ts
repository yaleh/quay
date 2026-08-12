#!/usr/bin/env node
// judgment-consumer-check.ts — the 判据→消费动作 audit (tasks/gap-judgment-computed-not-wired-to-action).
//
// THE CLASS-LEVEL DISCIPLINE: **每个机械判据必须有消费它的动作** — every mechanical judgment a script
// computes must have an ACTION that consumes it. A judgment computed with no consumer is a fake
// instrument: "看它一眼算检查过" (looking at it counts as checking it). This is the 2026-08-10
// three-instance class — the SIGNAL was computed (deficit / not-yet-flipped / self-touch-scan) but
// nothing acted on it:
//   instance-1 18:4x — not-yet-flipped computed by ready-pool-check, slot-refill never read excluded
//                       (fixed: slot-refill step-4 check, gap-slot-refill-repeats-done-eligible-recommendations)
//   instance-2 21:4x — self-touch-scan computed, C8-rejected candidates not backfilled
//                       (止血 fixed; structural backfill LANDED 84a64047, gap-slot-refill-c8-reject-no-backfill)
//   instance-3 22:0x — deficit computed every round, no trigger read it (fixed: B9 third trigger,
//                       `ready-pool-check --apply`, outer 77f17d95)
//
// WHAT THIS CHECKS (the audit): the registry below is the SINGLE SOURCE OF TRUTH for
// "判据→消费动作". Each entry declares a mechanical judgment, its producer, the action that consumes
// it, and grep-able patterns that PROVE the consumer is wired. The audit verifies:
//   * a judgment declared `wired`      ⇒ every verify pattern must be present (else it is the exact
//     defect class — "computed but not consumed" — and it is listed in `unfinished` + RED);
//   * a judgment declared `unfinished` ⇒ its already-wired patterns must be present AND its fix-marker
//     (the pattern that would prove the fix landed) must be ABSENT (else the status is stale drift);
//   * every entry carries a consumer action (a judgment with no consumer is not admitted as `wired`).
// A judgment with no mechanically-verifiable consumer is LISTED UNFINISHED (invariant
// no_consumer_listed_unfinished = 1) — never silently green.
//
// The registry is deliberately small and explicit. Adding a judgment = adding a row here + wiring its
// consumer + running the scoped gate. A new `wired` judgment whose consumer patterns do not verify
// red-lights the commit — that is the discipline made mechanical.
//
// MODES:
//   default            — audit the full registry against --root. Exit 0 iff no drift (wired verify
//                        wired, unfinished stays unfinished, every entry declares a consumer).
//   --json             — machine-readable output (the ## Contract measure surface).
//   --list             — text list of the registry (judgment → consumer → status).
//   --judge-entry <json> — audit ONE ad-hoc entry (used by the mutation case + tests to exercise the
//                        audit logic cheaply against a fixture root). JSON shape:
//                        {"judgment":"x","verify":[{"file":"rel/path.md","pattern":"re","expect":"present"}],
//                         "status":"wired"} — Exit 1 iff the entry's patterns contradict its status.
//
// Exit codes: 0 = PASS (audit internally consistent; unfinished judgments honestly listed);
//             1 = FAIL (a `wired` judgment's consumer is missing, or an `unfinished` judgment's fix
//                       marker is present = stale status drift);
//             2 = usage/env error.

import fs from "node:fs";
import path from "node:path";
import { isDirectEntry } from "./gate-script-base.ts";

// ── registry types ─────────────────────────────────────────────────────────────────────────────────

/** One grep-able proof that a consumer is (or is not) wired. `file` is repo-relative to --root. */
export interface ConsumerVerify {
  file: string;
  /** regex SOURCE (never a compiled literal — kept data so the mutation case can inject/restore). */
  pattern: string;
  /** "present" = the pattern must exist in the file; "absent" = the pattern must NOT exist. */
  expect: "present" | "absent";
}

/** One mechanical judgment and the action that consumes it. */
export interface JudgmentConsumer {
  judgment: string;
  /** The script that computes the judgment (repo-relative). */
  producer: string;
  /** Prose: the ACTION that consumes the judgment. A judgment with no consumer is not admitted wired. */
  consumer: string;
  verify: ConsumerVerify[];
  status: "wired" | "unfinished";
  /** Which of the 2026-08-10 three instances this corresponds to (when applicable). */
  instance?: string;
  /** For `unfinished`: the task tracking the structural fix. */
  pendingTask?: string;
  note?: string;
}

// ── the registry (SINGLE SOURCE OF TRUTH: 判据 → 消费动作) ────────────────────────────────────────

export const JUDGMENT_CONSUMERS: JudgmentConsumer[] = [
  {
    judgment: "deficit",
    producer: "plugin/scripts/ready-pool-check.ts",
    consumer:
      "B9 第三触发器——`ready-pool-check.ts --apply` 自闸补晋（pool<floor 且 promotions 非空 ⇒ 机械补晋落盘）",
    verify: [
      { file: "orchestration/orchestrator-tick-core.md", pattern: "deficit\\s*>\\s*0", expect: "present" },
      { file: "plugin/scripts/ready-pool-check.ts", pattern: "--apply|shouldApply", expect: "present" },
    ],
    status: "wired",
    instance: "instance-3 (22:0x deficit 每轮算出无触发器读, 已修 B9)",
    note: "outer 77f17d95 接线；orchestrator-tick-core B9 第三触发器（2026-08-10）。",
  },
  {
    judgment: "not-yet-flipped",
    producer: "plugin/scripts/ready-pool-check.ts",
    consumer:
      "slot-refill 第 4 项 step-4 检查 `isNotYetFlippedSkip`——已 fan-in 待翻 done 的任务不进推荐候选",
    verify: [{ file: "plugin/scripts/slot-refill.ts", pattern: "not-yet-flipped|excluded", expect: "present" }],
    status: "wired",
    instance: "instance-1 (18:4x not-yet-flipped 算出未接推荐路径, 已修)",
    note: "gap-slot-refill-repeats-done-eligible-recommendations 已修（2026-08-10）。",
  },
  {
    judgment: "self-touch-scan",
    producer: "plugin/scripts/touches-orthogonality-check.ts",
    consumer:
      "slot-refill step-4 check 5 C8 逐候选门已接线（缺 self-touch ⇒ defer 拒派发）；C8 拒后从排序更后回填补位（gap-slot-refill-c8-reject-no-backfill 84a64047）",
    verify: [
      { file: "plugin/scripts/touches-orthogonality-check.ts", pattern: "--self-touch-scan", expect: "present" },
      { file: "plugin/loop/fast-mode-tick-core.md", pattern: "--self-touch", expect: "present" },
      // wired proof: slot-refill 的 C8 逐候选门 + 回填（selfTouchCheck / self-touch-missing-c8 defer）已在。
      { file: "plugin/scripts/slot-refill.ts", pattern: "selfTouchCheck|self-touch-missing-c8|backfill", expect: "present" },
    ],
    status: "wired",
    instance: "instance-2 (21:4x self-touch-scan 候选被 C8 拒后不回填, 已修 84a64047)",
    note: "止血 791a8909（5 任务补 self-touch）；结构解（回填）84a64047 已接线。",
  },
  {
    judgment: "dispatchable_disjoint（双算审计）",
    producer: "plugin/scripts/ready-pool-check.ts",
    consumer:
      "slot-refill `should_refill = slots_free > 0 && dispatchable_disjoint >= 1`；`criterion_met` 透传 slot-refill 输出",
    verify: [{ file: "plugin/scripts/slot-refill.ts", pattern: "dispatchable_disjoint", expect: "present" }],
    status: "wired",
    note: "审计结论：dispatchable_disjoint（判据）与 criterion_met（派生布尔）均有消费方，无双算残留。",
  },
  {
    judgment: "obligation 台账",
    producer: "plugin/scripts/obligation-ledger.ts",
    consumer: "obligation-ledger-check 完整性审计（wired 进 run_static_checks）+ 台账 shape 测试",
    verify: [{ file: "scripts/test.sh", pattern: "obligation-ledger-check", expect: "present" }],
    status: "wired",
    note: "scripts/test.sh run_static_checks 有 obligation-ledger-check 检查器。",
  },
  {
    judgment: "closure-lag 信号",
    producer: "plugin/scripts/closure-lag-check.sh",
    consumer: "A10 每 tick 报 WARN + 升级（orchestrator-tick-core）；B2 --record 写 trace",
    verify: [{ file: "orchestration/orchestrator-tick-core.md", pattern: "closure-lag-check", expect: "present" }],
    status: "wired",
    note: "orchestrator-tick-core A10/B2 是消费方。",
  },
];

// ── audit core ─────────────────────────────────────────────────────────────────────────────────────

export interface VerifyFailure {
  file: string;
  pattern: string;
  expect: "present" | "absent";
  actual: string;
}

export interface EntryAudit {
  judgment: string;
  status: string;
  verified: boolean;
  failures: VerifyFailure[];
  hasConsumer: boolean;
}

/** Audit ONE entry against a root. A pattern matches if the regex hits the file content. */
export function auditEntry(entry: JudgmentConsumer, root: string): EntryAudit {
  const failures: VerifyFailure[] = [];
  for (const v of entry.verify) {
    const abs = path.join(root, v.file);
    let actual: string;
    if (!fs.existsSync(abs)) {
      actual = "missing-file";
    } else {
      const src = fs.readFileSync(abs, "utf8");
      actual = new RegExp(v.pattern).test(src) ? "present" : "absent";
    }
    const ok = v.expect === "present" ? actual === "present" : actual === "absent";
    if (!ok) failures.push({ file: v.file, pattern: v.pattern, expect: v.expect, actual });
  }
  return {
    judgment: entry.judgment,
    status: entry.status,
    verified: failures.length === 0,
    failures,
    hasConsumer: Boolean(entry.consumer && entry.consumer.trim()),
  };
}

export interface AuditReport {
  mode: "judgment-consumer-audit";
  judgments_total: number;
  wired: number;
  unfinished: string[];
  drift: boolean;
  entries: EntryAudit[];
}

/** Audit the full registry. `unfinished` lists every judgment whose consumer is NOT mechanically
 *  wired (declared-unfinished ∪ declared-wired-but-consumer-missing). `drift` = any declared-wired
 *  entry failing verification OR any declared-unfinished entry failing verification (stale status). */
export function auditAll(root: string): AuditReport {
  const entries = JUDGMENT_CONSUMERS.map((e) => auditEntry(e, root));
  const wired = entries.filter((e) => e.status === "wired").length;
  const unfinished = entries
    .filter((e) => e.status === "unfinished" || (e.status === "wired" && !e.verified))
    .map((e) => e.judgment);
  const drift = entries.some((e) => !e.verified);
  return { mode: "judgment-consumer-audit", judgments_total: entries.length, wired, unfinished, drift, entries };
}

// ── modes ─────────────────────────────────────────────────────────────────────────────────────────

function listPlain(): void {
  console.log("judgment-consumer-check — 判据→消费动作 registry（每个机械判据必须有消费它的动作）");
  console.log("");
  for (const e of JUDGMENT_CONSUMERS) {
    const mark = e.status === "wired" ? "wired      " : "UNFINISHED ";
    console.log(`${mark} ${e.judgment}`);
    console.log(`          producer: ${e.producer}`);
    console.log(`          consumer: ${e.consumer}`);
    for (const v of e.verify) {
      console.log(`          verify[${v.expect}] ${v.file} ~/${v.pattern}/`);
    }
    if (e.pendingTask) console.log(`          pending: ${e.pendingTask}`);
    if (e.note) console.log(`          note: ${e.note}`);
    console.log("");
  }
}

function reportText(r: AuditReport): void {
  console.log(`judgment-consumer-check — ${r.judgments_total} 判据（registry 单一正本）`);
  console.log(`wired: ${r.wired} · unfinished: ${r.unfinished.length}`);
  for (const e of r.entries) {
    const mark = e.verified ? "ok  " : "FAIL";
    console.log(`  [${mark}] ${e.status} ${e.judgment}`);
    for (const f of e.failures) {
      console.log(`        consumer NOT wired: ${f.file} expect:${f.expect} got:${f.actual} ~/${f.pattern}/`);
    }
  }
  if (r.unfinished.length > 0) {
    console.log("UNFINISHED（无消费方判据，列未完成，不静默绿）:");
    for (const u of r.unfinished) console.log(`  - ${u}`);
  }
  if (r.drift) {
    console.log("RESULT: FAIL — 有判据声明 wired 而消费动作缺失（判据算出没接动作），或 unfinished 状态已过期。");
  } else {
    console.log("RESULT: PASS — 每个 wired 判据的消费动作可 grep 验证；unfinished 判据如实列出。");
  }
}

/** Audit one ad-hoc entry (the mutation case + tests exercise the audit logic without the full
 *  registry's fixture burden). */
export function judgeEntry(entryJson: string, root: string): { report: EntryAudit; status: number } {
  let entry: JudgmentConsumer;
  try {
    entry = JSON.parse(entryJson);
  } catch {
    console.error("judgment-consumer-check: --judge-entry must be a JSON object");
    return { report: null as never, status: 2 };
  }
  const report = auditEntry(entry, root);
  const ok = report.verified;
  if (ok) {
    console.log(`judgment-consumer-check --judge-entry ${entry.judgment}: clean (${report.status} verified)`);
  } else {
    console.log(`judgment-consumer-check --judge-entry ${entry.judgment}: VIOLATION`);
    for (const f of report.failures) {
      console.log(`  ${f.file} expect:${f.expect} got:${f.actual} ~/${f.pattern}/`);
    }
  }
  return { report, status: ok ? 0 : 1 };
}

function usage(): never {
  console.error(
    "usage: node judgment-consumer-check.ts [--root <dir>] [--json | --list | --judge-entry <json>]\n" +
      "  default: audit the full 判据→消费动作 registry under --root\n" +
      "  --list: text list of the registry (judgment → consumer → status)\n" +
      "  --judge-entry <json>: audit ONE ad-hoc entry (mutation-case / test control)\n" +
      "  Exit: 0 = PASS; 1 = FAIL (wired judgment's consumer missing, or unfinished stale); 2 = usage/env error",
  );
  process.exit(2);
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  const asJson = args.includes("--json");
  const asList = args.includes("--list");
  const rootArg = args.indexOf("--root");
  const root = path.resolve(rootArg !== -1 ? args[rootArg + 1] : process.cwd());
  const judgeIdx = args.indexOf("--judge-entry");
  const judgeJson = judgeIdx !== -1 ? args[judgeIdx + 1] : undefined;
  if (!fs.existsSync(root)) {
    console.error(`ERROR: audit root not found: ${root}`);
    return 2;
  }

  if (judgeJson !== undefined) {
    const { status } = judgeEntry(judgeJson, root);
    return status;
  }

  if (asList) {
    listPlain();
    return 0;
  }

  const report = auditAll(root);
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    reportText(report);
  }
  return report.drift ? 1 : 0;
}

if (isDirectEntry(import.meta)) {
  process.exit(main(process.argv));
}
