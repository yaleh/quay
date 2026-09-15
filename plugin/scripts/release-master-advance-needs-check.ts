#!/usr/bin/env node
// release-master-advance-needs-check.ts — assert that release.yml's `advance-master` job declares
// EVERY other job in the file in its `needs:`, so a partially-green release can never advance master.
// (tasks/gap-first-green-release-and-master-ff, GOAL-020 AC-274; SPEC §6.1 invariant 3)
//
// THE DEFECT THIS EXISTS FOR (structural, not hypothetical): SPEC §6 / §1 ⑤ 问 3 redefined `master`
// as "the tag of the most recent FULLY GREEN release run" and ruled that the only thing that may move
// it is a new `advance-master` job inside release.yml. That job's whole safety story rests on one
// line — its `needs:` list. `needs:` is what makes "any job failed or was skipped ⇒ master does not
// move" TRUE: GitHub Actions skips a job whose dependency did not succeed, so fail-closed is the
// default and needs no code. But the list is written BY HAND, and §6.1 invariant 3 names the exact
// way it rots: add a 7th job to this workflow, forget to add it to `needs:`, and master advances on a
// half-green release — the very failure mode the SPEC was written to end, reproduced by a one-line
// omission that no reviewer is obliged to notice. §6.1 therefore requires this assertion to land in
// the SAME batch as the job ("与 A 同批落地，不得延后"), the same remedy as GOAL-012's "replace
// thrice-missed human enumeration with mechanical enumeration".
//
// WHY A STRUCTURAL CHECK RATHER THAN A RUN: the defect is a property of the checked-in workflow text,
// observable in milliseconds and without a release. Discovering it by running release.yml would need
// a live tag, a dispatch and a fully green run — and would only fire when the missing entry happens
// to matter. This asks the question directly.
//
// THE PREDICATE (parsed, not pattern-matched — the `yaml` package, so comments/quoting/reflow can
// never satisfy or defeat it, which is hard rule 2 taken as far as it goes):
//     needs(advance-master)  ⊇  (all job keys in release.yml) − {advance-master}
// The job key set is DERIVED from the file on every run; nothing is hardcoded — a hardcoded list of
// the six names would be a copy that drifts from the thing it copies, i.e. this checker's own defect.
//
// THREE-STATE OUTPUT (hard rule 3b — "could not read the input" must never render as "clean"):
//   0 = PASS — the subset difference is empty; the job set actually examined is printed alongside, so
//       a pass always carries what it covered.
//   1 = FAIL — at least one job key is missing from `needs:`; each is named.
//   3 = NOT-EVALUATED — the workflow file is absent, holds no readable top-level `jobs:` mapping, has
//       zero job keys, carries no `advance-master` job, or its `needs:` is neither absent (∅ ⇒ FAIL,
//       see below) nor a list of scalars. ⛔ NOT conflated with exit 0: "there was nothing to judge"
//       is a reading, but it is NOT a pass.
//   2 = usage/environment error.
//
// ⛔ ABSENT `needs:` IS A FAIL, NOT A NOT-EVALUATED (the one asymmetry worth stating): a job that
// declares no dependencies runs as soon as its own turn comes, i.e. it would move master on ANY
// release run at all. That is not "unreadable input", it is the worst possible reading of a readable
// one, so it must be RED. Only a `needs:` key whose VALUE cannot be read as a job-name list is
// NOT-EVALUATED.
//
// ⛔ WHAT THIS DOES **NOT** COVER — declared, not silently skipped:
//   (a) Entries in `needs:` that name no existing job (`unknownNeeds`) are PRINTED as a count on
//       every run but are NOT a violation. GitHub rejects a workflow whose `needs:` names a missing
//       job, so that shape cannot advance master on a partial green — it cannot run at all. It is
//       reported so the blind spot has a number rather than reading as "clean".
//   (b) Only release.yml is judged. `advance-master` exists in exactly one workflow; if a second
//       workflow ever gains the right to push master, this checker's object must widen with it.
//   (c) The invariant is about JOB KEYS, not about what those jobs do. A job that is listed but is
//       itself unable to fail (or is `if: false`) is outside this predicate.
//
// Run:
//   node --experimental-strip-types plugin/scripts/release-master-advance-needs-check.ts [--root <dir>] [--json]
//   ⛔ With NO arguments at all it is a USAGE ERROR (exit 2, `Usage:` on stderr) — it does NOT judge
//   `process.cwd()`. Judge a directory only by naming it (`--root .`): an exit-0 path that had judged
//   nothing would be isomorphic to the PASS reading (硬规则 3b), and this is the population contract for
//   verdict checkers (see the `argv.length === 0` branch in main()).

import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { emitPass, emitFail, emitNotEvaluated, isDirectEntry } from "./gate-script-base.ts";

/** The workflow that carries the master-advancing job. */
export const WORKFLOW_REL = ".github/workflows/release.yml";

/** The job whose `needs:` must cover every other job in that workflow. */
export const TARGET_JOB = "advance-master";

/** Why an input could not be judged. Each is a DISTINCT value, not a shared "not evaluated" bucket,
 *  so the three unreadable shapes the task names stay distinguishable from one another. */
export type NotEvaluatedReason =
  | "workflow-absent"
  | "jobs-block-unreadable"
  | "no-jobs-parsed"
  | "target-job-absent"
  | "target-needs-unreadable";

export type Outcome =
  | { state: "pass"; jobs: string[]; others: string[]; needs: string[]; unknownNeeds: string[] }
  | { state: "fail"; jobs: string[]; others: string[]; needs: string[]; missing: string[]; unknownNeeds: string[] }
  | { state: "not-evaluated"; reason: NotEvaluatedReason; detail: string };

/** Read one `needs:` value into a list of job-name strings.
 *  Returns null when the value is present but not readable as a job-name list ⇒ NOT-EVALUATED.
 *  `undefined`/`null` (key absent, or present with an empty value) ⇒ [] — a readable ∅, which the
 *  caller turns into a FAIL rather than a NOT-EVALUATED. */
export function needsToNames(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (typeof value === "string") return value.trim() === "" ? [] : [value.trim()];
  if (Array.isArray(value)) {
    const out: string[] = [];
    for (const item of value) {
      // Scalars only. A nested list/mapping here means the file says something this checker does not
      // understand, and guessing at it is the failure mode hard rule 3b names.
      if (typeof item === "string") out.push(item.trim());
      else if (typeof item === "number" || typeof item === "boolean") out.push(String(item));
      else return null;
    }
    return out;
  }
  return null;
}

/** Judge the workflow TEXT. Pure: the companion test and the mutation case drive this directly. */
export function judgeWorkflowText(text: string): Outcome {
  let doc: unknown;
  try {
    doc = parseYaml(String(text));
  } catch (err) {
    return { state: "not-evaluated", reason: "jobs-block-unreadable", detail: `YAML did not parse: ${String((err as Error)?.message ?? err)}` };
  }

  const jobs = (doc as { jobs?: unknown } | null | undefined)?.jobs;
  if (jobs === null || typeof jobs !== "object" || Array.isArray(jobs)) {
    return {
      state: "not-evaluated",
      reason: "jobs-block-unreadable",
      detail: "no top-level `jobs:` mapping was found (this workflow's jobs are the objects the `advance-master` invariant is quantified over)",
    };
  }

  const jobKeys = Object.keys(jobs as Record<string, unknown>);
  if (jobKeys.length === 0) {
    return { state: "not-evaluated", reason: "no-jobs-parsed", detail: "a `jobs:` mapping was found but it declares ZERO jobs" };
  }

  if (!jobKeys.includes(TARGET_JOB)) {
    return {
      state: "not-evaluated",
      reason: "target-job-absent",
      detail: `the \`${TARGET_JOB}\` job is not among this workflow's ${jobKeys.length} job(s) [${jobKeys.join(", ")}] — there is no \`needs:\` to judge, and master cannot be advanced by this workflow at all`,
    };
  }

  const target = (jobs as Record<string, { needs?: unknown }>)[TARGET_JOB];
  const rawNeeds = target && typeof target === "object" ? target.needs : undefined;
  const needs = needsToNames(rawNeeds);
  if (needs === null) {
    return {
      state: "not-evaluated",
      reason: "target-needs-unreadable",
      detail: `\`${TARGET_JOB}.needs\` is present but is not a job-name list (got ${JSON.stringify(rawNeeds)})`,
    };
  }

  const others = jobKeys.filter((k) => k !== TARGET_JOB);
  const unknownNeeds = needs.filter((n) => !jobKeys.includes(n));
  const missing = others.filter((o) => !needs.includes(o));

  if (missing.length === 0) return { state: "pass", jobs: jobKeys, others, needs, unknownNeeds };
  return { state: "fail", jobs: jobKeys, others, needs, missing, unknownNeeds };
}

function usage(): string {
  return [
    "Usage: release-master-advance-needs-check.ts [--root <dir>] [--json]",
    "",
    `Asserts \`${WORKFLOW_REL}\`'s \`${TARGET_JOB}\` job lists EVERY other job of that workflow in its`,
    "`needs:`, so any non-successful dependency skips it and master cannot advance on a half-green",
    "release (SPEC §6.1 invariant 3).",
    "",
    "exit 0 = needs covers every other job / 1 = a job is missing from needs /",
    "3 = NOT-EVALUATED (workflow absent, jobs: unreadable, zero jobs, no advance-master job, or a",
    "needs: value that is not a job-name list) / 2 = usage error.",
  ].join("\n");
}

function main(argv: string[]): number {
  // ⛔ NO ARGUMENTS IS A USAGE ERROR (exit 2), NOT A SILENT JUDGEMENT OF THE CWD. Two reasons:
  //   (1) 硬规则 3b — this checker's exit 0 means "PASS: needs: covers every other job". A path that
  //       exits 0 without having judged anything would be isomorphic to that reading. Defaulting the
  //       root to `process.cwd()` and emitting a real verdict there is legitimate only when the caller
  //       NAMED that root (`--root .`), because then the object being judged is the caller's choice
  //       rather than an accident of where the shell happened to be.
  //   (2) the population contract: every verdict-producing checker mirrored into
  //       experiments/quay-perpetual-stream/scripts/ (touches-orthogonality-check, anti-drift-touches-check,
  //       routine-file-gate, serial-fanin-absorb, derive-touches-heuristic) prints `Usage:` to stderr and
  //       exits 2 with no args; only the report tool (fast-mode-telemetry) exits 0 with a Usage block on
  //       stdout. This is caught, not remembered: experiments/quay-perpetual-stream/test/
  //       symlink-mirror-invocation.test.mjs rejects an exit-0 no-args path whose stdout carries no
  //       `Usage:` — which is exactly how this branch came to exist.
  if (argv.length === 0) {
    process.stderr.write(usage() + "\n");
    return 2;
  }
  let root = process.cwd();
  const json = argv.includes("--json");
  const rootIdx = argv.indexOf("--root");
  if (rootIdx !== -1) {
    const v = argv[rootIdx + 1];
    if (!v) return emitFail("--root requires a directory argument", undefined, { json });
    root = path.resolve(v);
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage());
    return 0;
  }

  const wfPath = path.join(root, WORKFLOW_REL);
  if (!fs.existsSync(wfPath)) {
    return emitNotEvaluated(
      `[workflow-absent] — no workflow at ${wfPath}; this checker's object is that file's own job set, so nothing was judged here (⛔ not "needs: is complete")`,
      { reason: "workflow-absent" },
      { json },
    );
  }

  const outcome = judgeWorkflowText(fs.readFileSync(wfPath, "utf8"));

  if (outcome.state === "not-evaluated") {
    return emitNotEvaluated(
      `[${outcome.reason}] — ${outcome.detail} (⛔ not "needs: is complete")`,
      { reason: outcome.reason, detail: outcome.detail },
      { json },
    );
  }

  const coverage =
    `jobs in ${WORKFLOW_REL}: ${outcome.jobs.length} [${outcome.jobs.join(", ")}]; ` +
    `${TARGET_JOB}.needs declares ${outcome.needs.length} [${outcome.needs.join(", ")}]; ` +
    `other jobs that must be covered: ${outcome.others.length}; ` +
    `needs entries naming no job here (NOT judged, see header (a)): ${outcome.unknownNeeds.length}`;

  if (outcome.state === "pass") {
    return emitPass(
      `${TARGET_JOB}.needs covers every other job in ${WORKFLOW_REL} — a non-successful dependency skips the job, so master cannot advance on a partially green release — ${coverage}`,
      { ...outcome },
      { json },
    );
  }

  return emitFail(
    `${TARGET_JOB}.needs does NOT cover every other job in ${WORKFLOW_REL} — ${outcome.missing.length} job(s) missing: ${outcome.missing.join(", ")}. ` +
      `If any of those fails or is skipped while this job still runs, master is advanced onto a release that was never fully green (SPEC §6.1 invariant 3). ` +
      `Add the missing name(s) to the \`needs:\` list. (${coverage})`,
    { ...outcome },
    { json },
  );
}

if (isDirectEntry(import.meta, process.argv[1], "release-master-advance-needs-check")) {
  process.exit(main(process.argv.slice(2)));
}
