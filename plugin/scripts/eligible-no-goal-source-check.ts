#!/usr/bin/env node
// eligible-no-goal-source-check.ts — the ANTI-REGRESSION INVARIANT for the promotion admission gate
// (tasks/gap-promotion-admission-reads-goal-layer-field, 人 2026-09-11 裁定).
//
// ── The invariant this checker makes non-regressible ────────────────────────────────────────────────
//   准入集合只由 task 自身的自足属性决定；goal 信息最多改变集合内的顺序，永不改变成员资格。
//   The promotion admission set (`eligible`) is decided ONLY by the task's own self-sufficient
//   properties; goal-layer information may at most change the ORDER inside the set, never MEMBERSHIP.
//
// ── Why monotonicity, not a style preference (the DoD's stated reason, verbatim in intent) ─────────
//   排序不减少可执行集合（最坏是次序不优），准入可把集合减到空（产生僵尸）。
//   A sort key cannot shrink the executable set (worst case: a suboptimal order); an admission term
//   CAN shrink it to empty — that is how a zombie task is produced. The concrete instance this
//   invariant was extracted from: `ready-pool-check.ts` carried `goalAcMissing = deliveryCritical &&
//   !task.goal_ac` as a conjunct of BOTH `eligible` conjunctions (bulk + targeted), so a
//   delivery-critical todo without `goal_ac` could NEVER be mechanically promoted — while the
//   correct execution surface for the same rule already lived in the goal layer
//   (`long-term-guarantee-goal-backed-check.ts`, re-evaluated every round, with an ACTIVATION_LINE
//   that grandfathers the pre-cutoff stock). Having it in the admission gate was a wrong LANDING
//   POINT: the gate re-evaluates EVERY todo each round, so simulating "only for newly filed tasks"
//   required a hand-added cutoff that was never added — the half-patched simulation is what produced
//   the zombie. ⇒ goal info belongs in the sort key (缺值 ⇒ default order), never in membership.
//
// ── What it judges, and how (位置判定, 硬规则②) ────────────────────────────────────────────────────
//   The LIVE SURFACE of `plugin/scripts/ready-pool-check.ts` (comments, block comments and
//   string/template-literal text blanked out) is scanned for every `eligible` MEMBERSHIP expression
//   — the object field `eligible: <expr>` (bulk candidate builder) and the assignment
//   `const eligible = <expr>` (targeted promotion path). Each such expression must contain NO
//   goal-source token. A token merely MENTIONED in a comment (e.g. documenting this very removal) or
//   inside a message string is NOT a hit — that is the position-based distinction, and it is why the
//   scan runs on the stripped surface rather than on raw text.
//
//   Goal-source token = any identifier containing `goal` (case-insensitive). Deliberately BROADER
//   than the exact `goalAcMissing` identifier: a future re-introduction may well arrive under another
//   name (`goalPriority`, `hasGoalBacking`, `task.goal_ac`), and the safe direction for an INVARIANT
//   gate is over-detection — a false positive is adjudicated by renaming or by recording the ruling,
//   never by weakening the gate to the identifier that happened to be used last time.
//
// ── Three distinguishable verdicts (硬规则③b: 读不懂不得与合格同形) ─────────────────────────────────
//   exit 0  PASS          — source read, ≥1 membership expression found, none carries a goal token.
//   exit 1  FAIL          — a membership expression carries a goal-source token (detail lists the
//                           line + expression + token).
//   exit 3  NOT-EVALUATED — the source is unreadable, OR the live surface contains ZERO `eligible`
//                           membership expressions (my extractor found nothing ⇒ I cannot tell
//                           "clean" from "I read the input wrong"). This is the whole point of the
//                           third state: a structure that can no longer find what it judges must not
//                           print PASS. `--json` carries `"status": "not-evaluated"`.
//
// ── The negative-control seam (this checker must be able to take the value FALSE) ───────────────────
//   `--inject-goal-source-fixture` derives a REAL mutated source from the real file — it splices
//   ` && !goalAcMissing` into the FIRST membership expression found — and judges THAT text. It must
//   exit 1. The mutation is derived from the production source, not hand-written, so the control
//   proves the extractor + token scanner fire on the exact shape that regressed. If no membership
//   expression can be found to mutate, the seam reports NOT-EVALUATED (exit 3) — never a pass.
//
// ── Not wired into scripts/test.sh ─────────────────────────────────────────────────────────────────
//   The bidirectional control (real repo green ∧ injected fixture red) runs from
//   plugin/test/ready-pool-check-s09.test.mjs, the basename-pair test file of the object it judges
//   (split from ready-pool-check.test.mjs by gap-suite-split-15-over-30s-test-files, 2026-09-17).
//
// Run:
//   node --no-warnings --experimental-strip-types plugin/scripts/eligible-no-goal-source-check.ts
//   node --no-warnings --experimental-strip-types plugin/scripts/eligible-no-goal-source-check.ts --json
//   node --no-warnings --experimental-strip-types plugin/scripts/eligible-no-goal-source-check.ts --inject-goal-source-fixture
//   node --no-warnings --experimental-strip-types plugin/scripts/eligible-no-goal-source-check.ts --source <path-to-ready-pool-check.ts>

import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./repo-root.ts";
import { emitPass, emitFail, emitNotEvaluated, isDirectEntry } from "./gate-script-base.ts";

/** The default judged object: the promotion admission gate itself. */
export const DEFAULT_SOURCE_REL = "plugin/scripts/ready-pool-check.ts";

/** The term the negative-control seam splices into the first membership expression. */
export const INJECTED_TERM = " && !goalAcMissing";

// ── liveSurface ─────────────────────────────────────────────────────────────────────────────────────
/**
 * Blank out everything that is NOT live code — `//` line comments, `/* … *`/ block comments, and the
 * literal text of `"…"` / `'…'` / template literals — while PRESERVING byte length and newline
 * positions, so any index computed on the returned string maps 1:1 onto the original source.
 *
 * Position-based judgment (硬规则②): a goal-source token that appears only in a comment or inside a
 * message string must not count. `${…}` interiors of template literals are KEPT (they are live code
 * — blanking them would let `eligible: x && !`${goalAc}`` slip through as a silent pass).
 */
export function liveSurface(src: string): string {
  const n = src.length;
  let out = "";
  let i = 0;
  const blankTo = (end: number) => {
    while (i < end) {
      out += src[i] === "\n" ? "\n" : " ";
      i++;
    }
  };
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === "/" && c2 === "/") {
      let j = i;
      while (j < n && src[j] !== "\n") j++;
      blankTo(j);
      continue;
    }
    if (c === "/" && c2 === "*") {
      let j = i + 2;
      while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++;
      blankTo(Math.min(n, j + 2));
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += " ";
      i++;
      while (i < n) {
        if (src[i] === "\\") {
          out += " ";
          i++;
          if (i < n) {
            out += src[i] === "\n" ? "\n" : " ";
            i++;
          }
          continue;
        }
        if (src[i] === quote) {
          out += " ";
          i++;
          break;
        }
        // `${…}` in a template literal is LIVE code — recurse so its tokens stay visible.
        if (quote === "`" && src[i] === "$" && src[i + 1] === "{") {
          let depth = 1;
          let j = i + 2;
          while (j < n && depth > 0) {
            if (src[j] === "{") depth++;
            else if (src[j] === "}") depth--;
            j++;
          }
          out += liveSurface(src.slice(i, j));
          i = j;
          continue;
        }
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// ── membership-expression extraction ────────────────────────────────────────────────────────────────
export interface MembershipSite {
  /** 1-based line number of the `eligible` keyword in the ORIGINAL source. */
  line: number;
  /** The membership expression text (livemasked, whitespace-normalized). */
  expression: string;
  /** Byte offset JUST PAST the expression — the splice point for the negative-control fixture. */
  endOffset: number;
  /** Goal-source tokens found inside the expression (empty ⇒ the site is clean). */
  goalTokens: string[];
}

/** Read a JS expression starting at `start`: consume until a depth-0 `,` / `;` / statement-ending
 *  newline. A newline only continues the statement when the text so far is syntactically incomplete
 *  (trailing operator / `:` / `(` / empty) — the multi-line conjunction case. */
function readExpression(src: string, start: number): { text: string; endOffset: number } {
  let i = start;
  let depth = 0;
  let text = "";
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) break;
      depth--;
    }
    if (depth === 0 && (c === "," || c === ";")) break;
    if (c === "\n") {
      const trimmed = text.replace(/\s+$/, "");
      const last = trimmed.slice(-1);
      const incomplete = trimmed === "" || /[&|+\-*/?:(=<>!,]/.test(last);
      if (!incomplete) break;
      text += " ";
      i++;
      continue;
    }
    text += c;
    i++;
  }
  return { text: text.replace(/\s+/g, " ").trim(), endOffset: i };
}

/** Identifiers containing `goal` (any case) — deliberately broader than the exact identifier that
 *  regressed; see the header's over-detection rationale. */
export function goalSourceTokens(expression: string): string[] {
  const hits: string[] = [];
  const re = /[A-Za-z_$][\w$]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expression)) !== null) {
    if (/goal/i.test(m[0])) hits.push(m[0]);
  }
  return hits;
}

/**
 * Every `eligible` MEMBERSHIP site in the live surface: the object field `eligible: <expr>` (bulk
 * candidate builder) and the assignment `eligible = <expr>` / `const eligible = <expr>` (targeted
 * promotion path). A bare read (`.eligible`, `{ eligible }` shorthand, `if (!eligible)`) is NOT a
 * membership site — it adds no term to the set.
 *
 * `--inject-goal-source-fixture` also uses this over the stripped surface to locate the splice point.
 */
export function findMembershipSites(src: string): MembershipSite[] {
  const live = liveSurface(src);
  const sites: MembershipSite[] = [];
  const re = /(^|[^\w$.])(eligible)\s*(?::|=(?!=)|\|\|=|&&=)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(live)) !== null) {
    const opEnd = m.index + m[0].length;
    const { text, endOffset } = readExpression(live, opEnd);
    if (!text) continue;
    sites.push({
      line: live.slice(0, m.index).split("\n").length,
      expression: text,
      endOffset,
      goalTokens: goalSourceTokens(text),
    });
    re.lastIndex = endOffset;
  }
  return sites;
}

// ── the judgment ────────────────────────────────────────────────────────────────────────────────────
export interface JudgeResult {
  status: "pass" | "fail" | "not-evaluated";
  message: string;
  detail: Record<string, unknown>;
}

/** Pure judgment over a source TEXT — the unit-testable core (imports do not trigger the CLI). */
export function judgeSource(src: string): JudgeResult {
  const sites = findMembershipSites(src);
  if (sites.length === 0) {
    return {
      status: "not-evaluated",
      message:
        "no `eligible` membership expression found in the live surface — the invariant cannot be evaluated " +
        "(读不懂输入 ≠ 合格, 硬规则③b; the object may have been renamed or restructured)",
      detail: { membership_sites: 0, violating_sites: [] },
    };
  }
  const violating = sites.filter((s) => s.goalTokens.length > 0);
  const detail = {
    membership_sites: sites.length,
    membership_lines: sites.map((s) => s.line),
    violating_sites: violating.map((s) => ({ line: s.line, expression: s.expression, goal_tokens: s.goalTokens })),
  };
  if (violating.length > 0) {
    return {
      status: "fail",
      message:
        `${violating.length}/${sites.length} promotion membership expression(s) read a GOAL-layer source — ` +
        "准入集合必须只由 task 自身的自足属性决定；goal 信息最多改变集合内的顺序，永不改变成员资格 " +
        "(僵尸任务成因, 人 2026-09-11 裁定)",
      detail,
    };
  }
  return {
    status: "pass",
    message: `${sites.length} promotion membership expression(s) scanned — no goal-layer source in membership`,
    detail,
  };
}

// ── negative-control fixture ────────────────────────────────────────────────────────────────────────
/**
 * Derive a mutated copy of `src` with a goal-source term spliced into the REAL membership
 * conjunction — a mutation of the production file, so the control exercises the same shape that
 * regressed.
 *
 * The target is the LONGEST membership expression, not the first: the file also carries
 * constant-false early returns (`eligible: false,`), and splicing into one of those would only prove
 * the scanner fires on a two-character literal. The computed conjunction (bulk candidate builder /
 * targeted promotion path) is an order of magnitude longer, so "longest" selects it in the current
 * shape and in any future one where the conjunction stays the real membership computation.
 * Returns null when there is no site to mutate (caller ⇒ NOT-EVALUATED, never a pass).
 */
export function injectGoalSourceFixture(src: string): string | null {
  const sites = findMembershipSites(src);
  if (sites.length === 0) return null;
  let target = sites[0];
  for (const s of sites) if (s.expression.length > target.expression.length) target = s;
  return src.slice(0, target.endOffset) + INJECTED_TERM + src.slice(target.endOffset);
}

// ── main ────────────────────────────────────────────────────────────────────────────────────────────
const USAGE =
  "usage: eligible-no-goal-source-check.ts [--source <path>] [--inject-goal-source-fixture] [--json]\n" +
  "  judges the promotion admission gate's `eligible` membership expressions carry NO goal-layer source\n" +
  "  exit 0 = pass · 1 = fail · 3 = NOT-EVALUATED (source unreadable, or no membership expression found)\n";

async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(USAGE);
    return 0;
  }
  const json = args.includes("--json");
  const inject = args.includes("--inject-goal-source-fixture");
  let sourceArg = "";
  const sIdx = args.findIndex((a) => a === "--source" || a.startsWith("--source="));
  if (sIdx >= 0) {
    const a = args[sIdx];
    sourceArg = a.includes("=") ? a.slice(a.indexOf("=") + 1) : args[sIdx + 1] || "";
  }
  const sourcePath = sourceArg
    ? path.resolve(sourceArg)
    : path.join(repoRoot(), DEFAULT_SOURCE_REL);

  let src: string;
  try {
    src = fs.readFileSync(sourcePath, "utf8");
  } catch (e) {
    const code = emitNotEvaluated(
      `cannot read the judged source ${sourcePath} (${(e as NodeJS.ErrnoException)?.code ?? "unknown"}) — NOT-EVALUATED, not a pass`,
      { source: sourcePath, reason: "source-unreadable" },
      { json },
    );
    return code;
  }

  if (inject) {
    // The injected fixture is JUDGED, and its verdict is emitted verbatim — so the injection run
    // exits NON-ZERO (FAIL, exit 1), exactly like a real regression would. `fixture`/`injected_term`
    // in the detail mark the cause so a reader can tell a fired control from a real violation
    // (成因可区分). If no site can be mutated the control could not be constructed ⇒ NOT-EVALUATED.
    const mutated = injectGoalSourceFixture(src);
    if (mutated === null) {
      return emitNotEvaluated(
        `--inject-goal-source-fixture: no membership expression to mutate in ${sourcePath} — the negative control could not be constructed (NOT-EVALUATED, never a pass)`,
        { source: sourcePath, reason: "no-membership-site-to-mutate" },
        { json },
      );
    }
    const r = judgeSource(mutated);
    const detail = { source: sourcePath, fixture: "goal-source-injected", injected_term: INJECTED_TERM, ...r.detail };
    if (r.status === "fail") return emitFail(r.message, detail, { json });
    // The injected term was NOT detected ⇒ the judge cannot take the value false (硬规则④: a quantity
    // that cannot be false is not a measurement). Report NOT-EVALUATED for the control itself, never
    // a green — that failure mode is indistinguishable from "the invariant is being enforced".
    return emitNotEvaluated(
      `negative control did NOT fire — the injected goal-source term was not detected (verdict ${r.status}); the checker cannot take the value false`,
      { source: sourcePath, fixture: "goal-source-injected", injected_term: INJECTED_TERM, injected_verdict: r.status },
      { json },
    );
  }

  const r = judgeSource(src);
  const detail = { source: sourcePath, ...r.detail };
  if (r.status === "pass") return emitPass(r.message, detail, { json });
  if (r.status === "fail") return emitFail(r.message, detail, { json });
  return emitNotEvaluated(r.message, detail, { json });
}

if (isDirectEntry(import.meta, undefined, "eligible-no-goal-source-check")) {
  main(process.argv).then((code) => process.exit(code));
}
