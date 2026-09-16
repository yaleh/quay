#!/usr/bin/env node
// dead-code-after-return-check.ts — the AC6 anti-recurrence gate for
// gap-concurrency-derivation-reverted-but-doc-ac-and-tests-all-still-report-derived.
//
// The defect that task fixed was EXACTLY this shape in scripts/test.sh:
//   default_test_concurrency() {
//     echo "8"
//     return 0
//     default_concurrency_formula      # ← unreachable: AFTER the top-level return
//   }
// A `return` at the top level of a shell function body makes everything after it dead
// code — the function returns before reaching it — but NOTHING complained: the doc said
// "derived", the AC was checked, the tests asserted the unreachable function in
// isolation, and a spelling-only test's message claimed "derived". Three reporting layers
// green while the real effective value was a constant.
//
// THIS checker makes that form mechanically impossible to reintroduce: it scans shell
// scripts (.sh/.bash) for a bare `return` statement at the top level of a function body
// (or any indent) that is followed by ANOTHER executable statement at the same-or-deeper
// indent (not a control-block closer like `fi`/`done`/`esac`/`}`/`else`/`elif`/`then`).
// The scan is by CODE POSITION, not keyword: comment text can never self-match, and a
// `return` inside an `if`/`case`/`for` block followed by its closer is NOT dead code.
//
// Strict-zero band: after the 2026-08-06 restore, the repo has ZERO instances (measured
// 2026-08-06: full-tree scan of 121 shell scripts → 0). A NEW dead-code-after-return
// instance exits 1 and red-lights the commit at the same site the drift was born.
//
// <!-- enforcement: plugin/scripts/dead-code-after-return-check.ts -->
//
// Usage:
//   node dead-code-after-return-check.ts [--root <dir>] [--json] [--selftest]
//
// Exit codes:
//   0 = PASS — no dead-code-after-return instances
//   1 = FAIL — at least one instance (the banned form)
//   2 = usage/environment error

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { helpExit } from "./gate-script-base.ts";

import { verified, failed, driverResultToExit } from "./checker-io.ts";
import type { DriverResult } from "./checker-io.ts";
// collectShellScripts now lives in fs-walk.ts (it was a whole-function byte-identical copy of
// adr016-screen-use-check.ts's, apart from the JSDoc — .quay/routine-findings.jsonl finding
// `shell-scan-surface-family`). Walk + extension set moved with it; the SKIP_DIRS set stays here
// and is passed at the call site (it prunes `vendor`, adr016's prunes `dist-sea` — not mergeable).
import { collectShellScripts } from "./fs-walk.ts";
// stripShellComments now lives in source-text-lib.ts (it was byte-identical to
// adr016-screen-use-check.ts's copy apart from brace layout — .quay/routine-findings.jsonl finding
// `firstargregion-stripshellcomments`). Re-exported so this module's public surface is unchanged
// (plugin/test/dead-code-after-return-check.test.mjs imports it from here).
import { stripShellComments } from "./source-text-lib.ts";
export { stripShellComments };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Subdirectories never scanned. checker-mutation-cases deliberately embeds the anti-pattern in
 *  heredocs (the mutation case proves the checker catches it) — scanning them would self-match.
 *  milestones/ holds classic-loop worktree archives, not live code. */
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "checker-mutation-cases",
  "milestones",
  "worktrees",
  "vendor",
]);

/** Control-block closers / branch markers — a `return` followed by one of these is the LAST
 *  statement of its block (not dead code). A bare `{` is a block opener, also not "code after". */
const CLOSERS = new Set(["fi", "done", "esac", "}", "else", "elif", "then", ";;", "in", "{"]);

export interface Violation {
  rel: string;
  line: number;
  fn: string;
  returnStmt: string;
  after: string;
}

const BARE_RETURN_RE = /^return(\s+\S+)?\s*$/;
const FN_DEF_RE = /^(\s*)(?:function\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*\)\s*\{\s*$/;

/** Detect dead-code-after-return violations in ONE shell script's source (comment-stripped line
 *  stream). Returns [{rel, line, fn, returnStmt, after}]. */
export function detectFileViolations(rel: string, source: string): Violation[] {
  const lines = stripShellComments(source).split("\n");
  const out: Violation[] = [];
  let i = 0;
  const n = lines.length;
  while (i < n) {
    const line = lines[i];
    const m = line.match(FN_DEF_RE);
    if (!m) {
      i++;
      continue;
    }
    const fn = m[2];
    // Extract the function body by brace counting (braces inside quotes/heredocs are a residual
    // risk, documented — the mutation-case fixtures and every current live instance use top-level
    // balanced braces, which this counts correctly).
    let depth = 1;
    let j = i + 1;
    const body: string[] = [];
    while (j < n && depth > 0) {
      body.push(lines[j]);
      depth += (lines[j].match(/\{/g) || []).length - (lines[j].match(/\}/g) || []).length;
      j++;
    }
    for (let k = 0; k < body.length; k++) {
      const bl = body[k];
      const stripped = bl.trim();
      if (!stripped || !BARE_RETURN_RE.test(stripped)) continue;
      const retIndent = bl.length - bl.trimStart().length;
      // Look ahead for the next non-blank statement.
      for (let k2 = k + 1; k2 < body.length; k2++) {
        const s2 = body[k2].trim();
        if (!s2) continue;
        const s2Indent = body[k2].length - body[k2].trimStart().length;
        if (CLOSERS.has(s2) || s2.startsWith("}")) break; // return was last of its block — not dead
        if (s2Indent >= retIndent) {
          out.push({
            rel,
            line: i + 1 + k + 1,
            fn,
            returnStmt: stripped,
            after: s2,
          });
        }
        break;
      }
    }
    i = j;
  }
  return out;
}

/** A file the walk listed that could not be read at read time. */
export interface Unreadable {
  rel: string;
  reason: string;
}

/**
 * Scan a tree for dead-code-after-return instances. Pure + fs: the caller picks the root.
 *
 * ── WALK→READ IS TWO STEPS, AND THE TREE CAN MOVE BETWEEN THEM ──────────────────────────────────
 * The walk (`collectShellScripts`) already TOLERATES an unreadable directory (`walkFiles` swallows
 * the readdir error and moves on). The read step did not tolerate anything — which made the whole
 * checker crash with an uncaught ENOENT whenever a listed file disappeared before it was read.
 *
 * ⛔ WHY THIS IS NOT HYPOTHETICAL (measured 2026-09-16, this defect is what the run's AC6 red was):
 * the repo tree is NOT a stable object while the suite runs — the npm-pack / delivery-smoke path
 * stages a MIRROR of the whole plugin tree into the SOURCE tree and removes it again
 * (`packages/quay/test/delivery-standalone-smoke.sh`: `STAGED_PLUGIN="$ROOT/packages/quay/plugin"`,
 * `rm -rf` → `cp -R plugin/.` → `npm pack` → `rm -rf`; same staging in `packages/quay/scripts/
 * package.sh`). `packages/quay/plugin` is not in SKIP_DIRS, and the walk follows it, so a scan that
 * spans the teardown sees every staged `.sh` listed and then gone. Observed directly: a probe
 * walking the same surface found 186 ENOENT reads under `packages/quay/plugin/` while the suite ran,
 * and 0 anywhere else. A crash there is EXIT 1 — the checker's own "at least one instance" code —
 * so a race is indistinguishable from a real violation (硬规则 3b: 读不懂 ⇒ 伪装成「发现违规」;
 * CI run 35121096175's `dead-code-after-return-check.test.mjs:90` `1 !== 0` is exactly this, with
 * the in-process scan microseconds earlier clean).
 *
 * The fix follows the convention this repo already established for the same race
 * (`plugin/test/loop-shipping.test.mjs`: "ENOENT during scan = race, not a crash"): a file that
 * VANISHED is skipped — it is not in the tree any more, so it is not part of a strict-zero band —
 * and a non-ENOENT read error still surfaces (a genuinely unreadable file must never be silently
 * treated as clean). Skipped files are RETURNED in `unreadable`, never swallowed: "0 violations"
 * has to stay distinguishable from "0 violations over an input I could only partly read".
 */
export function scanTree(root: string): { violations: Violation[]; files: string[]; unreadable: Unreadable[] } {
  // The skip-set is this checker's OWN: it prunes `vendor`, where adr016-screen-use-check.ts prunes
  // `dist-sea` instead. ⛔ The two stay apart (fs-walk.ts#collectShellScripts) — merging them would
  // change which files each scans, and a checker reading the wrong surface passes silently (硬规则 3b).
  const files = collectShellScripts(root, SKIP_DIRS);
  const violations: Violation[] = [];
  const unreadable: Unreadable[] = [];
  for (const rel of files) {
    let source: string;
    try {
      source = fs.readFileSync(path.join(root, rel), "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw err;
      unreadable.push({ rel, reason: code });
      continue;
    }
    violations.push(...detectFileViolations(rel, source));
  }
  return { violations, files, unreadable };
}

export interface ScanReport {
  violations: Violation[];
  files: string[];
  unreadable: Unreadable[];
}

/**
 * B4 (gap-b4-checker-reuse-driver-result)：判定收敛到 DriverResult<T> 词表。
 *   violations 非空 ⇒ failed（存在 dead-code-after-return 实例）；空 ⇒ verified（strict-zero band）。
 * 判定依据是【文件内容】（detectFileViolations 按代码位置），⛔ 非调用方自述。
 */
export function judgeScan(scan: ScanReport): DriverResult<ScanReport> {
  if (scan.violations.length > 0) {
    return failed(`${scan.violations.length} dead-code-after-return instance(s)`);
  }
  // The walk→read race (see scanTree) is NOT a violation and NOT a silent pass: a file that
  // vanished between the walk and the read is reported in the verdict's own words, so a reader can
  // always tell "scanned everything" from "scanned everything that was still there".
  const racy = scan.unreadable.length > 0 ? `；${scan.unreadable.length} 个文件在 walk→read 之间消失（ENOENT，已跳过）` : "";
  return verified(scan, `全树无 dead-code-after-return 实例（strict-zero band）${racy}`);
}

/** Pure RED/GREEN selftest (ADR-018 selfcheck-fixture pattern). */
export function selftest(): boolean {
  let pass = 0;
  let fail = 0;
  const check = (name: string, cond: boolean, detail = "") => {
    if (cond) pass++;
    else {
      fail++;
      console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
    }
  };

  // RED: the exact defect shape (the 2026-08-03 pin) is detected.
  const defect = detectFileViolations(
    "test.sh",
    'default_test_concurrency() {\n  echo "8"\n  return 0\n  default_concurrency_formula\n}\n',
  );
  check("red-defect-shape", defect.length === 1 && defect[0].fn === "default_test_concurrency", JSON.stringify(defect));

  // RED: constant-return then dead code (the Contract control's "return 3" shape).
  const ctrl = detectFileViolations("x.sh", 'f() {\n  echo "3"\n  return 0\n  default_concurrency_formula\n}\n');
  check("red-control-constant-then-dead", ctrl.length === 1, JSON.stringify(ctrl));

  // GREEN: a clean function with a top-level return as the LAST statement.
  check("green-last-return", detectFileViolations("ok.sh", 'f() {\n  echo "a"\n  return 0\n}\n').length === 0);

  // GREEN: a return inside an if block (code after `fi` runs on the else path) is NOT dead.
  check(
    "green-return-in-if",
    detectFileViolations("ok.sh", 'f() {\n  if x; then\n    return 0\n  fi\n  echo "after"\n}\n').length === 0,
  );

  // GREEN: a return inside a case branch followed by its terminator is NOT dead.
  check(
    "green-return-in-case",
    detectFileViolations("ok.sh", 'f() {\n  case "$x" in\n    a)\n      return 0\n      ;;\n  esac\n}\n').length === 0,
  );

  // GREEN: a comment mentioning the pattern is NOT a violation.
  check(
    "green-comment-mention",
    detectFileViolations("c.sh", '# NEVER write: return 0\ndefault_concurrency_formula\n').length === 0,
  );

  console.log(`\ndead-code-after-return-check --selftest: ${pass} passed, ${fail} failed`);
  return fail === 0;
}

function usage(): never {
  console.error(
    "usage: node dead-code-after-return-check.ts [--root <dir>] [--json] [--selftest]\n" +
      "Exit: 0 = no dead-code-after-return instances; 1 = at least one instance; 2 = usage error.",
  );
  process.exit(2);
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit("usage: node dead-code-after-return-check.ts [--root <dir>] [--json] [--selftest]");
  if (args.includes("--selftest")) {
    process.exit(selftest() ? 0 : 1);
  }
  const asJson = args.includes("--json");
  const rootArg = args.indexOf("--root");
  const root = path.resolve(rootArg !== -1 ? args[rootArg + 1] : process.cwd());

  if (!fs.existsSync(root)) {
    console.error(`ERROR: scan root not found: ${root}`);
    process.exit(2);
  }

  const scan = scanTree(root);
  const { violations, files, unreadable } = scan;
  const result = judgeScan(scan);
  const ok = result.state === "verified";

  if (asJson) {
    console.log(JSON.stringify({ ok, violations: violations.length, active: violations, files_scanned: files.length, unreadable }, null, 2));
  } else {
    console.log(`dead-code-after-return-check — ${files.length} shell script(s) scanned`);
    // Printed on BOTH verdicts (never only on red): a vanished file is not a violation, but it is
    // also not "the whole tree was read" — the two must not be conflated (硬规则 3b).
    console.log(`unreadable: ${unreadable.length}${unreadable.length ? ` (${unreadable.map((u) => `${u.rel}:${u.reason}`).join(", ")})` : ""}`);
    if (violations.length === 0) {
      console.log("violations: 0");
    } else {
      console.log(`violations: ${violations.length}`);
      for (const v of violations) {
        console.log(`  ${v.rel}:${v.line}  fn=${v.fn}  return='${v.returnStmt}'  AFTER='${v.after}'`);
      }
    }
    if (ok) {
      console.log("PASS: no dead code after a top-level return (the gap-concurrency-derivation-reverted shape is absent)");
    } else {
      console.log("FAIL: dead code after a top-level return detected — a function body must not have statements after its return (the 2026-08-03 pin shape)");
    }
  }
  return driverResultToExit(result);
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) && path.basename(process.argv[1]).replace(/.(?:js|ts|mjs)$/, "") === "dead-code-after-return-check";
if (isDirect) {
  process.exit(main(process.argv));
}
