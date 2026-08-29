// dual-source-check.ts — AC149-3 双真相源判定 (gap-ac149-session-retirement-no-dual-source-no-throughput-collapse).
//
// Criterion (manager-phase-goal.md ### AC149, verbatim):
//   AC149-3（无双真相源）: 停机后不存在任何「两个执行者做同一件事」的路径。取假：任一职责同时有
//   driver 路径与人工/会话路径且都在用 ⇒ 假。
//
// Mechanism:
//   "都在用" is a runtime property; the static contract that guarantees it cannot happen is: every
//   driverized responsibility has exactly ONE live executor (the driver file exists) AND its former
//   session/manual path is documented as retired (the AC135/AC141/AC143 退役 annotation is present in
//   the session's execution core). A responsibility whose session path is NOT marked retired is the
//   "两个执行者做同一件事" shape — the session path is still documented as usable ⇒ RED (fail-closed).
//   Matching is positional: each marker is tied to a specific responsibility + a specific session doc.
//
// Run:
//   node --no-warnings --experimental-strip-types plugin/scripts/dual-source-check.ts --root <repo>

import fs from "node:fs";
import path from "node:path";

interface Responsibility {
  name: string;             // the responsibility that must have a single executor
  executor: string;         // repo-relative driver file that must EXIST (the single live path)
  sessionDoc: string;       // repo-relative execution-core doc that held the former session path
  retiredMarkers: string[]; // MUST be present in sessionDoc (the session path is retired/handed to the driver)
}

// ── single-executor registry (each entry = one responsibility that must NOT have a dual source) ──
export const REGISTRY: Responsibility[] = [
  {
    name: "todo→ready 晋升",
    executor: "plugin/scripts/promotion-driver.ts",
    sessionDoc: "orchestration/orchestrator-tick-core.md",
    retiredMarkers: ["晋升由 promotion-driver 承接"],
  },
  {
    name: "ready→实现 派发 (outer 面)",
    executor: "plugin/scripts/worker-driver.ts",
    sessionDoc: "orchestration/orchestrator-tick-core.md",
    retiredMarkers: ["派发面已随 AC141 退役"],
  },
  {
    name: "ready→实现 派发 (inner 面)",
    executor: "plugin/scripts/worker-driver.ts",
    sessionDoc: "orchestration/fast-mode-tick-core.md",
    retiredMarkers: ["执行面已随 AC141 退役"],
  },
  {
    name: "观测/账本/收尾面",
    executor: "plugin/scripts/outer-driver.ts",
    sessionDoc: "orchestration/orchestrator-tick-core.md",
    retiredMarkers: ["已驱动化 `plugin/scripts/outer-driver.ts`（AC143）"],
  },
];

// ── normalization: strip backticks, collapse whitespace ──
export function norm(s: string): string {
  return s.replace(/`/g, "").replace(/\s+/g, " ").trim();
}

export function hasMarker(content: string, marker: string): boolean {
  return norm(content).includes(norm(marker));
}

function readFile(root: string, rel: string): string {
  const p = path.join(root, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

export function runCheck(root: string): { ok: boolean; issues: string[] } {
  const issues: string[] = [];

  for (const entry of REGISTRY) {
    if (!fs.existsSync(path.join(root, entry.executor))) {
      issues.push(`[${entry.name}] EXECUTOR-MISSING: driver ${entry.executor} not found — no single live executor`);
    }
    const text = readFile(root, entry.sessionDoc);
    for (const m of entry.retiredMarkers) {
      if (!hasMarker(text, m)) {
        issues.push(`[${entry.name}] DUAL-SOURCE: marker "${m}" ABSENT from ${entry.sessionDoc} (the session/manual path is not retired — two executors for one responsibility)`);
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

function main() {
  const args = process.argv.slice(2);
  let root = process.cwd();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root" && args[i + 1]) root = args[i + 1];
  }
  const { ok, issues } = runCheck(root);
  if (ok) {
    console.log(`dual-source-check: OK — ${REGISTRY.length} responsibility(s) each have a single live executor (driver exists, session path retired)`);
    process.exit(0);
  }
  console.error(`dual-source-check: RED (${issues.length} issue(s))`);
  for (const i of issues) console.error(`  - ${i}`);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
