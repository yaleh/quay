#!/usr/bin/env node
// commit-message-verified-check.ts — the mechanical AC11 gate for
// gap-commit-message-claims-verified-without-verification.
//
// The defect: merge commit 8e2e49b9's message claimed "all syntax verified" while
// carrying real merge corruption (plugin/scripts/trend-check.ts duplicated 2×, 8 task
// frontmatters unparseable). A "verified"-class ASSERTION in a COMMIT MESSAGE with no
// reproducible verification command/reference. Commit messages are an AC11 carrier more
// dangerous than task bodies / tick rows: they enter HISTORY, and a reader who sees
// "all syntax verified" does not re-verify (the discovery delay was 7h41m / 154 commits,
// and the corruption was only caught by an unrelated full-suite run).
//
// THIS checker makes that shape mechanically impossible to reintroduce in the live
// window: it scans recent commit messages (default `--depth 100` — at the fast-mode
// loop's ~40-50 commits/day that is ≈2 days, far beyond the 7h41m discovery delay of
// the original defect) and, for every commit whose message makes a "verified"-class
// ASSERTION, requires the SAME message to carry a reproducible verification
// command/reference (script path / test invocation / result counts / verifiedCommit= /
// backtick command / test-file reference). A bare assertion ("all syntax verified",
// "— all verified") with no such reference is FLAGGED (exit 1).
//
// Judgment is POSITIONAL (hard rule 2 — 按位置判定，不按关键词):
//   - CLAIM matches assertion SHAPES ("all syntax verified", "syntax verified",
//     "all verified", "验证通过", "已验证"), NOT any occurrence of the word — a
//     task-id like `gap-send-keys-verified-leaks-tmux-servers` or a descriptive
//     "re-verify" is not an assertion, and `verifiedCommit=…` is itself a reference
//     (evidence), not a bare claim.
//   - A claim that is CITED (preceded by "claims"/"声称"/"自称", e.g. a task-filing
//     commit quoting this very finding) is not an assertion — quoted citations are
//     reported, not flagged.
//
// Negative control: remove the verification command from a supported message
// ("… all syntax verified (scripts/test.sh green)" → "… all syntax verified") and the
// checker MUST go red; restore it and it is green again. This is asserted by
// plugin/test/commit-message-verified-check.test.mjs and the mutation case
// (plugin/scripts/checker-mutation-cases/commit-message-verified-check.sh).
//
// <!-- enforcement: plugin/scripts/commit-message-verified-check.ts -->
//
// Usage:
//   node commit-message-verified-check.ts [--root <dir>] [--depth <n>] [--json] [--selftest]
//
// Exit codes:
//   0 = PASS — no commit in the window makes an unsupported verified-claim
//   1 = FAIL — at least one commit makes a verified-claim without a verification reference
//   2 = usage/environment error

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { helpExit, createSelftest } from "./gate-script-base.ts";

/**
 * A "verified"-class ASSERTION: an assertion of a PASS state with a subject. Positional —
 * matches the assertion shape, not the bare word. The alternation covers:
 *   "all syntax verified" / "all verified" / "all tests verified" / "syntax verified"
 *   "tests verified" / "code verified" / "checks verified" (English), and the Chinese
 *   pass-claims "已验证" / "验证通过" / "核验通过" / "全部验证".
 * Deliberately NOT matched: bare "verified" (which lands in "re-verified" /
 * "verifiedCommit=…" / "gap-…-verified-…" task-ids), "verify", "verification", "重验证"
 * (descriptive re-runs), "未验证" (negation).
 */
export const CLAIM_RE =
  /\b(?:all(?:\s+[a-z]+)?|syntax|tests?|code|checks?|files?)\s+verified\b|\bverification\s+passed\b|(?<![一-鿿])已验证(?![一-鿿])|(?<![一-鿿])验证通过(?![一-鿿])|(?<![一-鿿])核验通过(?![一-鿿])|(?<![一-鿿])全部验证(?:通过)?(?![一-鿿])/i

/**
 * A reproducible verification command/reference in the SAME message — the evidence that
 * makes a "verified" claim traceable (AC1/DoD: 验证命令/负控制可机械追溯). Covers:
 *   verifiedCommit=<hash>, scoped N/M, tests N/M, "N fail 0", "N/M 绿|green",
 *   "full-suite", "test.sh", "node --check", "npm test", "npm run",
 *   test.sh flags (--for-task/--scoped/--static-checks/--test-), "git diff --check",
 *   backtick commands, *.test.mjs/js/ts file references, PASS / green / 判绿 /
 *   selftest / "pass N/M".
 */
export const EVIDENCE_RE =
  /verifiedCommit\s*[:=]?\s*[0-9a-f]{7,}|\bscoped\s+\d+\s*\/\s*\d+|\btests?\s+\d+\s*\/\s*\d+|\b\d+\s+fail\s+0|\b\d+\s*\/\s*\d+\s*(?:绿|green)|\bfull-suite\b|\btest\.sh\b|\bnode\s+--check\b|\bnpm\s+test\b|\bnpm\s+run\b|--for-task|--scoped|--static-checks|--test-|git\s+diff\s+--check|`[^`]+`|\.test\.(?:mjs|ts|js)\b|\bPASS\b|\bgreen\b|判绿|\bselftest\b|\bpass\s+\d+\s*\/\s*\d+/i;

/**
 * A CITED claim — the text immediately before a matched claim ends with a citation verb
 * (claims / claimed / says / quotes / states / 声称 / 自称) followed by a separator, i.e.
 * the claim is being REPORTED, not asserted (e.g. a task-filing commit quoting the
 * finding: `… commit message claims "all syntax verified" …`). Positional: judged on the
 * 80 chars immediately before the match, not on a keyword anywhere in the message.
 */
export const CITATION_RE =
  /(?:claims?|claimed|says?|quotes?|states?|声称|自称)\b[^A-Za-z0-9_]*["'"“”「『]?\s*$/i;

export interface Violation {
  hash: string;
  subject: string;
  claim: string;
}

/**
 * Detect a verified-claim in one commit-message subject line. Returns
 * { claim, cited } — claim = the matched assertion phrase (or null if none);
 * cited = true when the matched phrase is being CITED rather than asserted.
 */
export function detectClaim(msg: string): { claim: string | null; cited: boolean } {
  const m = msg.match(CLAIM_RE);
  if (!m || m.index === undefined) return { claim: null, cited: false };
  const before = msg.slice(0, m.index);
  const cited = CITATION_RE.test(before.slice(-80));
  return { claim: m[0], cited };
}

/** Does the message carry a reproducible verification command/reference? */
export function messageHasEvidence(msg: string): boolean {
  return EVIDENCE_RE.test(msg);
}

/**
 * The per-message verdict: returns a Violation if the message makes a verified-claim
 * (not cited) WITHOUT evidence; else null. Pure — no fs/git.
 */
export function analyzeMessage(hash: string, subject: string): Violation | null {
  const { claim, cited } = detectClaim(subject);
  if (!claim || cited) return null;
  if (messageHasEvidence(subject)) return null;
  return { hash, subject, claim };
}

/** Default window depth — ≈2 days at the fast-mode loop's ~40-50 commits/day. */
export const DEFAULT_DEPTH = 100;

/**
 * Scan commit messages reachable from `git -C <root> log` (the repo's HEAD), limited to
 * `depth` commits, for unsupported verified-claims. Throws on a git/environment failure
 * unless the repo has no commits yet (treated as an empty scan). Pure + git subprocess.
 */
export function scanRepo(root: string, depth: number): Violation[] {
  let logOut: string;
  try {
    logOut = execFileSync("git", ["-C", root, "log", "--format=%H%x09%s", "-n", String(depth)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const stderr = String((err as { stderr?: Buffer | string }).stderr ?? err);
    if (/does not have any commits/i.test(stderr)) return []; // empty repo — nothing to scan
    throw new Error(`commit-message-verified-check: git log failed in ${root}: ${stderr}`);
  }
  const violations: Violation[] = [];
  for (const line of logOut.split("\n")) {
    if (!line.trim()) continue;
    const tab = line.indexOf("\t");
    if (tab === -1) continue;
    const hash = line.slice(0, tab);
    const subject = line.slice(tab + 1);
    const v = analyzeMessage(hash, subject);
    if (v) violations.push(v);
  }
  return violations;
}

/** Pure RED/GREEN selftest (ADR-018 selfcheck-fixture pattern). */
export function selftest(): boolean {
  const st = createSelftest({ flavor: "counters", label: "commit-message-verified-check" });
  const check = st.check;

  // RED — the exact defect shape (8e2e49b9): a bare "all syntax verified" claim.
  let v = analyzeMessage("8e2e49b9", "merge: 45 conflicts resolved (…; all syntax verified)");
  check("red-defect-shape", v !== null && v.claim === "all syntax verified", JSON.stringify(v));

  // RED — "— all verified" / "syntax verified" bare forms.
  check("red-all-verified", analyzeMessage("a", "fix: ad-arm1 — all verified") !== null);
  check("red-syntax-verified", analyzeMessage("a", "fix: merge — syntax verified") !== null);
  check("red-chinese-verified", analyzeMessage("a", "修复：合并冲突 — 验证通过") !== null);

  // GREEN — the same claim WITH a verification command/reference is supported.
  check("green-command", analyzeMessage("a", "fix: x — all syntax verified (scripts/test.sh green)") === null);
  check("green-scoped-count", analyzeMessage("a", "outer: closure — all verified, scoped 64/64") === null);
  check("green-verifiedCommit", analyzeMessage("a", "B1 closure — verifiedCommit=214a29c1, all verified") === null);
  check("green-tests-count", analyzeMessage("a", "fix: all tests verified — tests 3084/0") === null);

  // GREEN — no claim: task-id, descriptive re-verify, negation, reference-only.
  check("green-taskid", analyzeMessage("a", "merge: fan-in task/gap-send-keys-verified-leaks-tmux-servers") === null);
  check("green-reverify", analyzeMessage("a", "inner: re-verify on develop 2be095ae") === null);
  check("green-unverified", analyzeMessage("a", "fix: 24 commits unverified — skip batch merge") === null);
  check("green-verifiedCommit-only", analyzeMessage("a", "outer: flip done (verifiedCommit de7aa6e3)") === null);

  // GREEN — a CITED claim (task-filing commit quoting the finding) is not an assertion.
  check("green-citation", analyzeMessage("a", 'tasks: file AC11 carrier — 8e2e49b9 claims "all syntax verified"') === null);
  return st.report();
}

function usage(): never {
  console.error(
    "usage: node commit-message-verified-check.ts [--root <dir>] [--depth <n>] [--json] [--selftest]\n" +
      "Exit: 0 = no unsupported verified-claim in the window; 1 = at least one; 2 = usage/env error.",
  );
  process.exit(2);
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit("usage: node commit-message-verified-check.ts [--root <dir>] [--depth <n>] [--json] [--selftest]");
  if (args.includes("--selftest")) {
    process.exit(selftest() ? 0 : 1);
  }
  const asJson = args.includes("--json");
  const rootArg = args.indexOf("--root");
  if (rootArg !== -1 && (rootArg + 1 >= args.length || args[rootArg + 1].startsWith("--"))) usage();
  const root = path.resolve(rootArg !== -1 ? args[rootArg + 1] : process.cwd());
  const depthArg = args.indexOf("--depth");
  if (depthArg !== -1 && (depthArg + 1 >= args.length || args[depthArg + 1].startsWith("--"))) usage();
  const depth = depthArg !== -1 ? Number.parseInt(args[depthArg + 1], 10) : DEFAULT_DEPTH;

  if (!Number.isFinite(depth) || depth < 1) {
    console.error(`ERROR: --depth must be a positive integer, got '${args[depthArg + 1]}'`);
    process.exit(2);
  }

  let violations: Violation[];
  try {
    violations = scanRepo(root, depth);
  } catch (err) {
    console.error(`ERROR: ${(err as Error).message}`);
    process.exit(2);
  }
  const ok = violations.length === 0;

  if (asJson) {
    console.log(JSON.stringify({ ok, violations: violations.length, depth, active: violations }, null, 2));
  } else {
    console.log(`commit-message-verified-check — ${depth} recent commit message(s) from ${root}`);
    if (violations.length === 0) {
      console.log("violations: 0");
    } else {
      console.log(`violations: ${violations.length}`);
      for (const v of violations) {
        console.log(`  ${v.hash.slice(0, 12)}  claim='${v.claim}'  subject='${v.subject}'`);
      }
    }
    if (ok) {
      console.log("PASS: no commit in the window makes a verified-claim without a verification command/reference");
    } else {
      console.log("FAIL: a verified-claim without a reproducible verification command/reference detected (the 8e2e49b9 shape) — a commit message claiming 'verified' must carry its verification command/reference (AC11, negative control: no command ⇒ flag)");
    }
  }
  return ok ? 0 : 1;
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirect) {
  process.exit(main(process.argv));
}
