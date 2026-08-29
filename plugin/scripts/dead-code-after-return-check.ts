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

/** Shell script extensions scanned. */
const SHELL_EXT = new Set([".sh", ".bash"]);

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

/** Strip shell line comments (outside single/double quotes) — a comment mentioning the pattern
 *  must never satisfy the detector (comment-vs-code, same principle as adr016-screen-use-check). */
export function stripShellComments(src: string): string {
  const out: string[] = [];
  for (const rawLine of src.split("\n")) {
    let inS = false;
    let inD = false;
    let outLine = "";
    for (let i = 0; i < rawLine.length; i++) {
      const c = rawLine[i];
      if (inS) {
        outLine += c;
        if (c === "'") inS = false;
        continue;
      }
      if (inD) {
        outLine += c;
        if (c === "\\") {
          outLine += rawLine[i + 1] ?? "";
          i++;
          continue;
        }
        if (c === '"') inD = false;
        continue;
      }
      if (c === "'") {
        inS = true;
        outLine += c;
        continue;
      }
      if (c === '"') {
        inD = true;
        outLine += c;
        continue;
      }
      if (c === "#" && (i === 0 || /\s/.test(rawLine[i - 1]))) break; // line comment
      outLine += c;
    }
    out.push(outLine);
  }
  return out.join("\n");
}

/** Collect the repo-relative .sh/.bash files under `root`, skipping SKIP_DIRS. */
export function collectShellScripts(root: string): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (SKIP_DIRS.has(e)) continue;
      const full = path.join(dir, e);
      let st: fs.Stats;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full);
      } else if (SHELL_EXT.has(path.extname(e))) {
        out.push(path.relative(root, full).split(path.sep).join("/"));
      }
    }
  }
  walk(root);
  return out.sort();
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

/** Scan a tree for dead-code-after-return instances. Pure + fs: the caller picks the root. */
export function scanTree(root: string): { violations: Violation[]; files: string[] } {
  const files = collectShellScripts(root);
  const violations: Violation[] = [];
  for (const rel of files) {
    const source = fs.readFileSync(path.join(root, rel), "utf8");
    violations.push(...detectFileViolations(rel, source));
  }
  return { violations, files };
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

  const { violations, files } = scanTree(root);
  const ok = violations.length === 0;

  if (asJson) {
    console.log(JSON.stringify({ ok, violations: violations.length, active: violations, files_scanned: files.length }, null, 2));
  } else {
    console.log(`dead-code-after-return-check — ${files.length} shell script(s) scanned`);
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
  return ok ? 0 : 1;
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) && path.basename(process.argv[1]).replace(/.(?:js|ts|mjs)$/, "") === "dead-code-after-return-check";
if (isDirect) {
  process.exit(main(process.argv));
}
