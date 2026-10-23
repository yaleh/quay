#!/usr/bin/env node
// unencapsulated-state-judge.ts — STAGE 2 of the two-stage admission pipeline for the
// `unencapsulated-state` concern kind (task gap-unencapsulated-state-clue-judge-e2e, GOAL-911 AC-924).
//
// THE QUESTION IT MAKES ASKABLE:
//   "Given a candidate clue, is the concern ACTUALLY present — on recorded evidence?"
//
// ── RECORDED-VERDICT REPLAY, NOT A LIVE MODEL ────────────────────────────────────────────────────────
//   `replayVerdict(candidate, corpus)` looks the candidate's subject up in a corpus of RECORDED verdicts
//   (`plugin/fixtures/unencapsulated-state/recorded-verdicts.json`) and replays it. It never calls a
//   model, never spawns one, and never invents a verdict: the judge is the same function in a test and in
//   production, and the only thing that changes between runs is the corpus.
//
//   Why this shape: a judge that consults a model is not reproducible and cannot be its own acceptance
//   surface. Recording the verdict once, with its provenance, keeps the SEMANTIC step real (it is a
//   judgment about a specific cluster of code) while making the PLUMBING (routing, refusal, vocabulary)
//   exactly testable. Re-judging a subject is a corpus edit — a reviewed artifact — never a silent model
//   run.
//
// ── THREE VERDICTS, AND "I HAVE NO RECORD" IS NOT ONE OF THEM (hard rules 3b/6) ───────────────────────
//   `confirmed` / `refuted` / `needs-more-evidence` come from `JUDGE_VERDICTS` in
//   `docs/analysis/semantic-admission-contract.mjs` (imported at runtime, ⛔ never re-declared here).
//   A subject the corpus does not mention resolves to `needs-more-evidence` — NEVER to `confirmed`
//   (缺值 = 未查). A corpus that cannot be READ at all is a different failure again: it throws, because
//   "no corpus" and "a corpus that acquitted nothing" must not share an output shape.
//
// ── A CONFIRMATION MUST CARRY ITS COUNTERFACTUAL (hard rule 4 推论四) ─────────────────────────────────
//   `judgeRecord()` rejects `verdict:"confirmed"` without a non-empty `counterfactual` — the control that
//   WOULD have made the verdict different. A statement that can explain every outcome is not a tested
//   conclusion; the rejection is by name (`SemanticAdmissionContractError`), so a caller can tell a
//   contract violation from an unrelated crash.
//
// USAGE
//   node --experimental-strip-types plugin/scripts/unencapsulated-state-judge.ts \
//        --corpus plugin/fixtures/unencapsulated-state/recorded-verdicts.json \
//        --subjects true-state-cluster.ts,memoized-probe.ts --json
//
//   --corpus <path>    the recorded-verdict corpus (default: the fixture shipped beside this task).
//   --subjects <list>  comma-separated subjects (or bare basenames) to replay. Required by the CLI.
//   --json             machine-readable output `{corpus, judgments}`.
//
// Exit: 0 = every requested subject got a verdict (including `needs-more-evidence`);
//       2 = usage / environment error;
//       3 = the corpus or a recorded entry violates the contract (an instrument failure — named).

import fs from "node:fs";
import path from "node:path";
import { isDirectEntry } from "./gate-script-base.ts";
import { resolveEngineModuleIn, importEngineModuleAt, SCRIPT_REPO_ROOT } from "./routine-engine-module-loader.ts";

export const EXIT_OK = 0;
export const EXIT_USAGE = 2;
export const EXIT_INSTRUMENT = 3;

export const JUDGE_KIND = "unencapsulated-state";
export const DEFAULT_CORPUS_REL = "plugin/fixtures/unencapsulated-state/recorded-verdicts.json";

const CONTRACT_DIR_REL = "docs/analysis";
const CONTRACT_FILE = "semantic-admission-contract.mjs";

const contractCache = new Map<string, unknown>();

export async function loadContract(root: string): Promise<any> {
  const r = resolveEngineModuleIn(root, CONTRACT_FILE, CONTRACT_DIR_REL);
  if (r.path === null) {
    throw new Error(
      `CAUSE=semantic-admission-contract-unresolved — the judge vocabulary lives in ${CONTRACT_FILE} and could not be found; tried ${r.tried.join(" , ")}`,
    );
  }
  return importEngineModuleAt(r.path, contractCache);
}

/**
 * The corpus lookup key of a subject: its basename without extension.
 *
 * Both stages name the same thing two ways — the clue layer uses a ROOT-RELATIVE path
 * (`plugin/fixtures/unencapsulated-state/memoized-probe.ts`), a recorded verdict names the file it judged
 * (`memoized-probe.ts`, or a bare `memoized-probe`). Matching on this key lets a corpus entry stay stable
 * when the tree is relocated (a task worktree, a vendored copy) without matching two different clusters
 * by accident — the corpus is a small hand-curated artifact, and a duplicate basename in it would be
 * caught by `loadCorpus` (which refuses duplicates) rather than silently resolving to one of them.
 */
export function verdictKey(subject: string): string {
  const base = String(subject ?? "").split(/[\\/]/).pop() ?? "";
  return base.replace(/\.[A-Za-z0-9]+$/, "");
}

/** Read + validate a corpus file. Throws (named) on anything unreadable — never returns `[]` for a file
 *  it could not parse, which would make "no recorded verdicts" look like "every candidate is unknown". */
export function loadCorpus(file: string): any[] {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e: any) {
    throw new Error(`CAUSE=corpus-unreadable — ${file} could not be read (${e?.code ?? e?.message ?? e})`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e: any) {
    throw new Error(`CAUSE=corpus-unparsable — ${file} is not JSON (${e?.message ?? e})`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`CAUSE=corpus-malformed — ${file} must be a JSON ARRAY of recorded verdicts (got ${parsed === null ? "null" : typeof parsed})`);
  }
  const seen = new Map<string, number>();
  parsed.forEach((entry: any, i: number) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`CAUSE=corpus-malformed — ${file}[${i}] is not an object`);
    }
    if (typeof entry.subject !== "string" || entry.subject.trim() === "") {
      throw new Error(`CAUSE=corpus-malformed — ${file}[${i}] carries no non-empty subject`);
    }
    if (typeof entry.rationale !== "string" || entry.rationale.trim() === "") {
      throw new Error(`CAUSE=corpus-malformed — ${file}[${i}] (${entry.subject}) carries no rationale; a verdict without a reason is not replayable`);
    }
    if (typeof entry.provenance !== "string" || entry.provenance.trim() === "") {
      throw new Error(`CAUSE=corpus-malformed — ${file}[${i}] (${entry.subject}) carries no provenance; a recorded verdict must say where the recording came from`);
    }
    const key = verdictKey(entry.subject);
    if (seen.has(key)) {
      throw new Error(`CAUSE=corpus-ambiguous — ${file} records two verdicts for the same key ${JSON.stringify(key)} (indices ${seen.get(key)} and ${i}); a lookup would silently pick one`);
    }
    seen.set(key, i);
  });
  return parsed as any[];
}

/**
 * Replay one candidate's recorded verdict.
 *
 * @param candidate a clue record (`{subject}`) or any object naming a subject.
 * @param corpus    the array returned by `loadCorpus`.
 * @param contract  the loaded contract module (its `judgeRecord` builds — and validates — the record).
 * @returns one judge record plus the `key` it was looked up by and whether the corpus had it.
 *
 * ⛔ A missing subject is `needs-more-evidence`, never `confirmed` (硬规则 6). The `found` flag is
 * reported separately so a caller can tell "the corpus looked and could not decide" from "the corpus
 * never mentioned this subject" — both are `needs-more-evidence`, but they are not the same reading.
 */
export function replayVerdict(candidate: any, corpus: any[], contract: any): any {
  const subject = typeof candidate === "string" ? candidate : candidate?.subject;
  if (typeof subject !== "string" || subject.trim() === "") {
    throw new Error("CAUSE=unjudgeable-candidate — the candidate names no subject, so no recorded verdict can be looked up");
  }
  const key = verdictKey(subject);
  const hit = (Array.isArray(corpus) ? corpus : []).find((e) => verdictKey(e?.subject) === key) ?? null;
  if (hit === null) {
    const record = contract.judgeRecord({
      candidate_ref: subject,
      verdict: contract.JUDGE_VERDICT.NEEDS_MORE_EVIDENCE,
      rationale: `no recorded verdict names ${JSON.stringify(key)} — the corpus was read and did not decide this subject (缺值 = 未查; never upgraded to a confirmation)`,
    });
    return { ...record, key, subject, found: false, provenance: null };
  }
  const record = contract.judgeRecord({
    candidate_ref: subject,
    verdict: hit.verdict,
    rationale: hit.rationale,
    counterfactual: hit.counterfactual ?? null,
  });
  return { ...record, key, subject, found: true, provenance: hit.provenance ?? null };
}

/** Replay a list of candidates, preserving order. */
export function judgeCandidates(candidates: any[], corpus: any[], contract: any): any[] {
  return (Array.isArray(candidates) ? candidates : []).map((c) => replayVerdict(c, corpus, contract));
}

/**
 * Build the Planner's `semanticAdmission(record, entry)` seam out of a recorded-verdict corpus.
 *
 * This is the ONLY bridge between the two stages: the Planner hands over one carrier record, the adapter
 * reads WHICH clue subject that record carries (`clue_subject`, falling back to `subject`), replays the
 * recorded verdict, and returns `{admit, verdict, counterfactual}` — the exact shape
 * `evaluateSemanticAdmission` consumes. `admit` is true for `confirmed` ONLY.
 *
 * ⛔ NO MECHANICAL FIELD IS READ HERE. The adapter deliberately ignores `slice_delta`,
 * `expected_mechanical_delta` and every other mechanical reading on the record: a semantic-judged kind is
 * confirmed by the judge, and its mechanical signals are candidates only. (The Planner takes this branch
 * before any delta is read, so the delta is not merely ignored here — it is never computed.)
 */
export function semanticAdmissionFromJudge(corpus: any[], contract: any): (record: any, entry: any) => { admit: boolean; verdict: string; counterfactual?: string } {
  return (record: any) => {
    const subject = record?.clue_subject ?? record?.subject ?? null;
    if (typeof subject !== "string" || subject.trim() === "") {
      // Unreadable input gets the judge's own non-verdict, not a confirmation and not a throw: a record
      // that cannot name its subject is 未查, and the Planner will report it as a semantic refusal.
      return { admit: false, verdict: contract.JUDGE_VERDICT.NEEDS_MORE_EVIDENCE };
    }
    const judgment = replayVerdict({ subject }, corpus, contract);
    const out: { admit: boolean; verdict: string; counterfactual?: string } = {
      admit: judgment.verdict === contract.JUDGE_VERDICT.CONFIRMED,
      verdict: judgment.verdict,
    };
    if (judgment.counterfactual) out.counterfactual = judgment.counterfactual;
    return out;
  };
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────────
const USAGE =
  "unencapsulated-state-judge.ts --subjects <a,b,...> [--corpus <path>] [--json]\n" +
  "  stage 2 of the two-stage admission pipeline: replays RECORDED verdicts (never a live model).";

export async function main(argv: string[]): Promise<number> {
  let corpusPath = path.join(SCRIPT_REPO_ROOT, DEFAULT_CORPUS_REL);
  let subjects: string[] = [];
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      process.stdout.write(USAGE + "\n");
      return EXIT_OK;
    }
    if (a === "--json") {
      json = true;
      continue;
    }
    if (a === "--corpus") {
      corpusPath = argv[i + 1] ?? "";
      i += 1;
      if (!corpusPath) {
        process.stderr.write("CAUSE=missing-argument — --corpus needs a path\n" + USAGE + "\n");
        return EXIT_USAGE;
      }
      continue;
    }
    if (a === "--subjects") {
      const v = argv[i + 1] ?? "";
      i += 1;
      if (!v) {
        process.stderr.write("CAUSE=missing-argument — --subjects needs a comma-separated list\n" + USAGE + "\n");
        return EXIT_USAGE;
      }
      subjects = v.split(",").map((s) => s.trim()).filter(Boolean);
      continue;
    }
    process.stderr.write(`CAUSE=unknown-argument — ${a}\n` + USAGE + "\n");
    return EXIT_USAGE;
  }
  if (subjects.length === 0) {
    process.stderr.write("CAUSE=no-subjects — the judge replays recorded verdicts for NAMED subjects\n" + USAGE + "\n");
    return EXIT_USAGE;
  }

  let contract: any;
  let corpus: any[];
  try {
    contract = await loadContract(SCRIPT_REPO_ROOT);
    corpus = loadCorpus(corpusPath);
  } catch (e: any) {
    process.stderr.write(`${e?.message ?? e}\n`);
    return EXIT_INSTRUMENT;
  }

  let judgments: any[];
  try {
    judgments = judgeCandidates(subjects, corpus, contract);
  } catch (e: any) {
    // A recorded entry that violates the contract (e.g. `confirmed` with no counterfactual) is an
    // INSTRUMENT failure: the corpus itself is not replayable. Named, and its own exit code.
    process.stderr.write(`CAUSE=corpus-contract-violation — ${e?.name ?? "Error"}: ${e?.message ?? e}\n`);
    return EXIT_INSTRUMENT;
  }

  if (json) {
    process.stdout.write(JSON.stringify({ corpus: corpusPath, judgments }, null, 2) + "\n");
  } else {
    for (const j of judgments) {
      process.stdout.write(`${j.verdict.padEnd(20)} ${j.key}${j.found ? "" : "  (no recorded verdict → needs-more-evidence)"}\n`);
      process.stdout.write(`  ${j.rationale}\n`);
      if (j.counterfactual) process.stdout.write(`  counterfactual: ${j.counterfactual}\n`);
    }
  }
  return EXIT_OK;
}

// 直接入口守卫：canonical isDirectEntry（按 basename 判，bundler-friendly —— 见 gate-script-base.ts）。
if (isDirectEntry(import.meta, process.argv[1], "unencapsulated-state-judge")) {
  process.exit(await main(process.argv.slice(2)));
}
