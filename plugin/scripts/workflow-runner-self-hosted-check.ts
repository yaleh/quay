#!/usr/bin/env node
// workflow-runner-self-hosted-check.ts — every GitHub Actions job must run on a self-hosted runner,
// so a metered hosted-runner billing / spending-limit refusal cannot stop CI or a release
// (tasks/gap-metered-hosted-runner-jobs-to-self-hosted, goal AC-319).
//
// WHY THIS EXISTS (the direct reading, 2026-09-24): develop CI run 35966264609's
// `version-consistency` / `dist-verify-node-floor` jobs came back with an EMPTY `runner_name` and
// `steps=0`, and the check-run annotation read, verbatim, *"The job was not started because recent
// account payments have failed or your spending limit needs to be increased"*. That gate stopped
// 7 of this repo's 8 workflow jobs (ci.yml x3, release.yml x3, publish-plugin-dist.yml x1) — only
// `ci.yml:test` was already on `[self-hosted, tokyo-alpha]` (migrated 2026-09-16). The v0.12.0
// release run was therefore not executable, and master standing at v0.11.0 was the CORRECT output
// of that state, not a defect. A job that never STARTS is the worst failure shape available: it is
// not a red test, it is a silent absence, and nothing in the repo could see it.
//
// ⚠️ 与 goals/AC-319 同谓词 —— 改一处须改另一处（硬规则 5b）.
// The goal layer's criterion (goals/AC-319-*.md — a `python3 + pyyaml` heredoc) is an INDEPENDENT
// measurement at the goal layer and deliberately does NOT import this file, so this predicate
// exists TWICE ON PURPOSE. Two implementations of one judgment drift; the drift is caught
// mechanically by plugin/test/workflow-runner-self-hosted-check.test.mjs, which runs BOTH the
// checker and the stored criterion over the SAME fixture set and asserts the three-valued
// conclusion is identical for each. If you change the predicate here, change AC-319's criterion in
// the same commit (and vice versa).
//
// THE PREDICATE (mirrors the criterion exactly, BY POSITION — never by keyword, hard rule 2):
//   for every `.github/workflows/*.yml` (+ `*.yaml`), for every entry of its `jobs:` mapping:
//     • no `runs-on` key at all  ⇒ NOT self-hosted — a reusable-workflow call's runner is decided
//                                   in ANOTHER file, so it is not statically self-hosted
//     • any label contains `${{`   ⇒ NOT self-hosted — the runner is chosen at run time
//     • the label list contains `self-hosted` ⇒ self-hosted
//     • anything else              ⇒ NOT self-hosted (named in the output)
//   A malformed job (a string / a list) carries no `runs-on` key ⇒ NOT self-hosted.
//
// THREE-STATE (hard rule 3b — "could not read the input" must never share a value with "holds"):
//   exit 0 PASS          — every job evaluated AND every one of them self-hosted
//   exit 1 RED           — >=1 job is not on a self-hosted runner (CAUSE=metered-runner-job)
//   exit 2 usage/env error
//   exit 3 NOT-EVALUATED — CAUSE ∈ {no-workflow-files, workflow-unparseable,
//                          workflow-has-no-jobs-map, yaml-impl-unavailable}. An EMPTY POPULATION is
//                          NOT a pass: with no workflow file there is no job to judge, which is a
//                          different state from "every job was judged and all of them hold".
//
// Usage:
//   node --experimental-strip-types workflow-runner-self-hosted-check.ts [--root <dir>] [--json]
//   node --experimental-strip-types workflow-runner-self-hosted-check.ts --help

import fs from "node:fs";
import path from "node:path";
import { flagValue, helpExit, isDirectEntry, emitPass, emitFail, emitNotEvaluated } from "./gate-script-base.ts";

/** The workflow directory, repo-root-relative (the ONE literal; never re-spelled downstream). */
export const WORKFLOW_DIR_REL = ".github/workflows";

/** The extensions the population is read from — exactly what the AC-319 criterion globs. */
const WORKFLOW_EXTENSIONS = [".yml", ".yaml"] as const;

/** The label that makes a `runs-on` value statically self-hosted. */
export const SELF_HOSTED_LABEL = "self-hosted";

const USAGE = `usage: workflow-runner-self-hosted-check.ts [--root <dir>] [--json]

Judges every job of every .github/workflows/*.{yml,yaml} under <root> (default: cwd) for running on
a self-hosted runner.

Exit codes: 0 = every job self-hosted · 1 = >=1 job on a metered runner (CAUSE=metered-runner-job)
            2 = usage error · 3 = NOT-EVALUATED (no workflow files / unparseable / no jobs map /
            yaml implementation unavailable) — never conflated with 0.`;

export type YamlParseFn = (text: string) => unknown;

export interface BadJob {
  /** `"<workflow basename>:<job name>"` — the identity the output must name. */
  where: string;
  /** Why this job is not statically self-hosted. */
  reason: string;
}

export interface WorkflowJudgment {
  status: "pass" | "fail" | "not-evaluated";
  /** Non-null iff status !== "pass" — the machine-readable cause token. */
  cause: string | null;
  message: string;
  /** Repo-relative paths of the workflow files actually read. */
  files: string[];
  /** `"<file>:<job>"` of every job judged self-hosted. */
  ok: string[];
  /** Every job judged NOT self-hosted, with the reason. */
  bad: BadJob[];
}

/** The workflow files under `<root>/.github/workflows`, sorted — `[]` when there are none.
 *  A MISSING directory and an EMPTY one are deliberately the same reading here, exactly as
 *  `glob.glob(".github/workflows/*.yml")` in the AC-319 criterion treats them: both mean "there is
 *  no job to judge", which the caller renders as NOT-EVALUATED (never as a pass). */
export function readWorkflowFiles(root: string): string[] {
  const dir = path.join(root, WORKFLOW_DIR_REL);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => (e.isFile() || e.isSymbolicLink()) && WORKFLOW_EXTENSIONS.some((x) => e.name.endsWith(x)))
    .map((e) => path.join(WORKFLOW_DIR_REL, e.name))
    .sort();
}

/** The label list a `runs-on` value denotes — the criterion's own three-arm normalization:
 *  a string is a one-label list; a mapping is read from its `labels` key; a list is used as-is;
 *  anything else (incl. `null` from a mapping without `labels`) becomes a one-element list of that
 *  value. Every element is stringified, so a YAML scalar like `true` is compared as `"true"` on
 *  both sides of the two implementations. */
export function runnerLabels(runsOn: unknown): string[] {
  let labels: unknown;
  if (typeof runsOn === "string") labels = [runsOn];
  else if (runsOn !== null && typeof runsOn === "object" && !Array.isArray(runsOn)) {
    labels = (runsOn as Record<string, unknown>).labels;
  } else labels = runsOn;
  const list = Array.isArray(labels) ? labels : [labels];
  return list.map((x) => String(x));
}

/** Judge ONE job. Pure — the whole predicate lives here, so the test can drive it directly. */
export function judgeJob(where: string, job: unknown): { ok: boolean; reason?: string } {
  if (job === null || typeof job !== "object" || Array.isArray(job) || !("runs-on" in (job as object))) {
    return {
      ok: false,
      reason: "no-runs-on (reusable workflow or malformed — its runner is not decided in this file)",
    };
  }
  const labels = runnerLabels((job as Record<string, unknown>)["runs-on"]);
  if (labels.some((x) => x.includes("${{"))) {
    return {
      ok: false,
      reason: `runs-on is an expression ${JSON.stringify(labels)} — the runner is decided at run time, so it is not statically self-hosted`,
    };
  }
  if (labels.includes(SELF_HOSTED_LABEL)) return { ok: true };
  return { ok: false, reason: `runs-on=${JSON.stringify(labels)}` };
}

/** Judge every workflow file under `<root>`. `parseYaml` is injected so the YAML implementation's
 *  absence is an evaluable state (the caller passes a throwing sentinel) rather than a crash. */
export function judgeWorkflowRoot(root: string, parseYaml: YamlParseFn): WorkflowJudgment {
  const files = readWorkflowFiles(root);
  const base = { files, ok: [] as string[], bad: [] as BadJob[] };
  if (files.length === 0) {
    return {
      ...base,
      status: "not-evaluated",
      cause: "no-workflow-files",
      message: `${WORKFLOW_DIR_REL}/ holds no ${WORKFLOW_EXTENSIONS.join(" / ")} file under ${root}, so there is no job to judge (an empty population is not a pass)`,
    };
  }
  for (const rel of files) {
    const abs = path.join(root, rel);
    let text: string;
    try {
      text = fs.readFileSync(abs, "utf8");
    } catch (e) {
      return {
        ...base,
        status: "not-evaluated",
        cause: "workflow-unparseable",
        message: `${rel} could not be read (${(e as Error).message}) — its runners were not looked at`,
      };
    }
    let doc: unknown;
    try {
      doc = parseYaml(text) ?? {};
    } catch (e) {
      return {
        ...base,
        status: "not-evaluated",
        cause: "workflow-unparseable",
        message: `${rel} does not parse as YAML (${(e as Error).message})`,
      };
    }
    const jobs =
      doc !== null && typeof doc === "object" && !Array.isArray(doc)
        ? (doc as Record<string, unknown>).jobs
        : undefined;
    if (jobs === null || typeof jobs !== "object" || Array.isArray(jobs) || Object.keys(jobs).length === 0) {
      return {
        ...base,
        status: "not-evaluated",
        cause: "workflow-has-no-jobs-map",
        message: `${rel} parsed but carries no jobs mapping, so its runners were not read`,
      };
    }
    for (const [name, job] of Object.entries(jobs as Record<string, unknown>)) {
      const where = `${path.basename(rel)}:${name}`;
      const verdict = judgeJob(where, job);
      if (verdict.ok) base.ok.push(where);
      else base.bad.push({ where, reason: verdict.reason as string });
    }
  }
  const total = base.ok.length + base.bad.length;
  if (base.bad.length > 0) {
    const listing = base.bad.map((b) => `${b.where} [${b.reason}]`).join("; ");
    return {
      ...base,
      status: "fail",
      cause: "metered-runner-job",
      message:
        `${base.bad.length} of ${total} workflow jobs are not on a self-hosted runner, so a ` +
        `billing/spending-limit refusal still stops them (measured 2026-09-24: 'The job was not ` +
        `started because recent account payments have failed'): ${listing}`,
    };
  }
  return {
    ...base,
    status: "pass",
    cause: null,
    message: `ok: ${total} workflow jobs across ${files.length} files, all runs-on ${SELF_HOSTED_LABEL}: ${base.ok.join(", ")}`,
  };
}

/** Load the YAML implementation. Its ABSENCE is an evaluable state (→ exit 3), not a crash — the
 *  mirror of the criterion's own `pyyaml-unimportable` arm, so a checkout without the dependency
 *  reports "I could not look" instead of dying with a stack trace (hard rule 3b). */
export async function loadYamlParser(): Promise<YamlParseFn | null> {
  try {
    const mod = (await import("yaml")) as unknown as {
      parse?: (t: string) => unknown;
      default?: { parse?: (t: string) => unknown };
    };
    const parse = mod?.parse ?? mod?.default?.parse;
    return typeof parse === "function" ? (t: string) => parse(t) : null;
  } catch {
    return null;
  }
}

export interface RunOptions {
  root: string;
  json: boolean;
  parseYaml: YamlParseFn | null;
}

/** The CLI's whole behavior, minus argv/env plumbing — returns the exit code. */
export function run(opts: RunOptions): number {
  if (opts.parseYaml === null) {
    const j: WorkflowJudgment = {
      status: "not-evaluated",
      cause: "yaml-impl-unavailable",
      message:
        "the 'yaml' package could not be imported, so .github/workflows/*.yml was not parsed — " +
        "'every job is self-hosted' was not looked at, which is different from 'it holds'",
      files: [],
      ok: [],
      bad: [],
    };
    return emitJudgment(j, opts.json);
  }
  return emitJudgment(judgeWorkflowRoot(opts.root, opts.parseYaml), opts.json);
}

/** Emit a judgment: one machine-readable line (json) or the human line plus, for a non-pass, the
 *  `CAUSE=` line on stderr — the same channel the AC-319 criterion writes its CAUSE to. */
export function emitJudgment(j: WorkflowJudgment, json: boolean): number {
  const detail = { cause: j.cause, files: j.files, ok: j.ok, bad: j.bad };
  if (j.status === "pass") return emitPass(j.message, detail, { json });
  process.stderr.write(`CAUSE=${j.cause} — ${j.message}\n`);
  return j.status === "fail"
    ? emitFail(j.message, detail, { json })
    : emitNotEvaluated(j.message, detail, { json });
}

async function main(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) helpExit(USAGE);
  const root = path.resolve(flagValue(argv, "--root") ?? process.cwd());
  return run({ root, json: argv.includes("--json"), parseYaml: await loadYamlParser() });
}

if (isDirectEntry(import.meta, process.argv[1], "workflow-runner-self-hosted-check")) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`workflow-runner-self-hosted-check: unexpected error — ${err?.stack ?? err}\n`);
      process.exit(2);
    },
  );
}
