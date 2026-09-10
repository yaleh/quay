// quay Core: criterion fidelity judge — the SECOND activation-gate question
// (GOAL-013 / tasks/gap-criterion-fidelity-gate-activation-blind-to-vacuous-criteria).
//
// A criterion record carries:
//   `criterion` — a RUNNABLE shell command (reuses the task acceptance-runner shape).
//   `expect`    — the outcome the criterion PROVES (its claimed object).
//
// The P6 activation gate already asks the FIRST question: "can this criterion RUN to a verdict?"
// (evaluability). This module asks the SECOND: "can this criterion be FALSE on the object its
// `expect` claims to measure?" — i.e. does it MEASURE the claimed object, or is it VACUOUSLY true
// (hard rule 4: a quantity structurally incapable of being false is not a measurement).
//
// 2026-09-10 production case: AC-225's criterion (`kernel-sibling-resolution-check --root . --json`,
// exit 0) got flipped achieved at 07:00:55Z while its checker could not flag cross-package source
// anchors — the `0` it produced was a too-narrow-definition `0`. I2 mis-fired, I4 did not apply,
// I5 was blind (the criterion still passed). The gap closed 73 minutes later (aca7a0511), found by
// production, not by mechanism. This module is the "achieved-but-vacuous" gap's mechanism answer:
// keep vacuous criteria OUT at activation time.
//
// 三态 (hard rule 3b — never conflate "not judged" with "judged faithful"):
//   faithful      — the criterion CAN be false on the claimed object (a real measurement).
//   vacuous       — the criterion is structurally incapable of being false on the claimed object.
//   not-evaluated — the judge could not reach a verdict (spawn fail / timeout / unparseable output).
//
// ⛔ Pure judgment + pure parsing — NO LLM spawn here. The semantic call is injected via the
// `invokeJudge` seam (a function parameter), so this module is unit-testable and does NOT add
// process responsibilities to Core. The parser reuses goal-driver.ts's
// parseSemanticSufficiencyVerdict fail-closed手法 verbatim: only explicit parseable values are
// recognized; everything else (non-zero exit / empty output / unreadable / timeout / JSON parse
// failure) ⇒ not-evaluated, NEVER silently faithful.

/** The three-state fidelity verdict. */
export type FidelityVerdict = "faithful" | "vacuous" | "not-evaluated";

/** The judge's raw output — the same { stdout, exitCode } shape the driver's runAsync produces. */
export interface FidelityJudgeResult {
  stdout: string | null;
  exitCode: number | null;
}

/** The injected seam: given the prompt, produce the judge's raw stdout + exit code.
 *  Synchronous on purpose (the activation gate is a one-shot CLI write, not a hot-loop round —
 *  matching runAcceptance's spawnSync shape). */
export type FidelityInvokeJudge = (prompt: string) => FidelityJudgeResult;

/** Parse the judge's stdout → three-state verdict. ⛔ fail-closed (mirrors goal-driver.ts
 *  parseSemanticSufficiencyVerdict verbatim): only explicit, parseable `faithful`/`vacuous` are
 *  recognized — a bare token, or `{"verdict":"…"}` JSON scanned from the LAST line upward. Everything
 *  else (non-zero exit, empty output, unreadable prose, JSON parse failure, an unknown verdict
 *  value) ⇒ not-evaluated. NEVER falls back to faithful. */
export function parseFidelityVerdict(stdout: string | null, exitCode: number | null): FidelityVerdict {
  if (exitCode !== 0) return "not-evaluated";
  const text = (stdout ?? "").trim();
  if (text === "faithful" || text === "vacuous") return text;
  const candidates = [text, ...text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).reverse()];
  for (const cand of candidates) {
    try {
      const obj = JSON.parse(cand);
      if (obj && typeof obj === "object" && (obj.verdict === "faithful" || obj.verdict === "vacuous")) {
        return obj.verdict as FidelityVerdict;
      }
    } catch {
      /* non-JSON line, keep scanning upward */
    }
  }
  return "not-evaluated";
}

/** Build the fidelity prompt. `mechanism` is OPTIONAL extra context — the source of the criterion's
 *  referenced mechanism (e.g. the checker the criterion runs). When absent (the production path),
 *  the judge is told it may read the referenced files itself (claude -p runs in the repo root).
 *  When present (the deterministic test path), it is embedded so a seam judge can decide without a
 *  live repo — the same reason sufficiency's `sufficiencyCmd` seam exists. */
export function buildFidelityPrompt(
  criterion: string,
  expect: string,
  opts: { root?: string; mechanism?: string } = {},
): string {
  const lines = [
    "You are a criterion-fidelity judge in the quay repo. Decide whether this goal criterion CAN be false on the object its `expect` claims to measure — a real measurement, or vacuously true?",
  ];
  if (opts.root) lines.push(`Repo root: ${opts.root}.`);
  lines.push("## criterion (runnable command):", criterion, "## expect (claimed object):", expect);
  if (opts.mechanism !== undefined) {
    lines.push("## criterion's referenced mechanism (source):", opts.mechanism);
  } else {
    lines.push("You may read the files the criterion references in the repo to inspect its mechanism.");
  }
  lines.push(
    'Reply with EXACTLY one line of JSON and nothing else: {"verdict":"faithful"} if the criterion can be false on the claimed object, otherwise {"verdict":"vacuous"}.',
  );
  return lines.join("\n");
}

/** The fidelity judgment. Pure: the semantic call goes through the injected `invokeJudge` seam.
 *  Returns { verdict, reason }. A thrown seam ⇒ not-evaluated (never faithful). */
export function criterionFidelityVerdict(
  criterion: string,
  expect: string,
  invokeJudge: FidelityInvokeJudge,
  opts: { root?: string; mechanism?: string } = {},
): { verdict: FidelityVerdict; reason: string } {
  const prompt = buildFidelityPrompt(criterion, expect, opts);
  let res: FidelityJudgeResult;
  try {
    res = invokeJudge(prompt);
  } catch (err) {
    return {
      verdict: "not-evaluated",
      reason: `fidelity judge threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const verdict = parseFidelityVerdict(res.stdout, res.exitCode);
  const reason = verdict === "not-evaluated"
    ? `fidelity judge unreadable (exit ${res.exitCode})`
    : `fidelity judge: ${verdict}`;
  return { verdict, reason };
}
