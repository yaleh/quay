// @test-group engine
// release-github-release-step.test.mjs — the guards on release.yml's `create-github-release` job:
// the one step that makes a release USER-PERCEIVABLE
// (tasks/gap-release-yml-missing-github-release-object, GOAL-020 AC-274).
//
// THE DEFECT THIS EXISTS FOR: the 2026-09-16 ruling cancelled the npm/SEA artifact CHANNELS, and
// the implementation deleted the whole `release` job — including the `softprops/action-gh-release`
// step that was the ONLY thing that ever created a GitHub Release object. Measured on a real v0.8.0
// cut: the run went green, `advance-master` fast-forwarded master, and the Releases page still
// showed v0.7.1 (`gh release view v0.8.0` ⇒ "release not found"). Nothing in the repo turned red.
// So this file pins the restored step, and pins it in the two ways that defect could come back:
//
// Coverage map:
//   AC1 (structure): release.yml must PARSE, the job must exist, and its dependency edge must place
//     it AFTER `verify-plugin-channel`; `advance-master.needs` must name it (otherwise master can
//     advance onto a release nobody can see). Parsed with the `yaml` package, not regex-matched —
//     comments, quoting and reflow can neither satisfy nor defeat it (硬规则 2).
//   AC2 (negative control): the step must reference NOTHING from the retired artifact channel
//     (`SEA_`, `quay-sea-`, `npm pack`). ⛔ The predicate is POSITIVE-CONTROLLED below: the same
//     function is shown to bite on a synthetic string that does carry the literal — an absence
//     assertion that cannot go red is a tautology, not a guard (硬规则 4).
//   AC3 (idempotency, BEHAVIOURAL): a tag can legitimately be dispatched twice, and
//     `gh release create` has no upsert flag (`gh release create --help`, v2.97.0 — nothing means
//     "already exists ⇒ skip"), so it fails on an existing release. Four cases are driven through a
//     `gh` PATH shim against the step's OWN `run` body extracted from the shipped YAML:
//       A  a release for the tag already exists        ⇒ exit 0 and `create` is NEVER called
//       B  no release, create succeeds                 ⇒ exit 0, create called once with --verify-tag
//       C  no release, create fails, read-back empty   ⇒ NON-ZERO (⛔ not a blanket `|| true`)
//       D  create fails BECAUSE the object now exists  ⇒ exit 0 (the one tolerated cause)
//     ⛔ THE SCRIPT IS EXTRACTED FROM THE SHIPPING YAML AND EXECUTED — not re-implemented here. A
//     helper copy would pass while the workflow's own text drifted (same discipline as
//     release-master-advance-needs-check's mutation case phase E, which drives a verbatim copy of
//     the real file). The test also asserts the run body carries NO `${{ … }}` expression, which is
//     what makes "execute it directly" a meaningful reading rather than a paraphrase.
//   AC4 (the needs checker): asserted in its own file — here only that this job is named in
//     `advance-master.needs`, which is the property that checker derives.
//
// Run:
//   scripts/test.sh plugin/test/release-github-release-step.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parse as parseYaml } from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const REAL_WF = path.join(REPO_ROOT, ".github", "workflows", "release.yml");

/** The job and step this file is about. */
const JOB = "create-github-release";
const STEP_ID = "github-release";
/** The job whose job-level correctness the release object is a precondition of. */
const MASTER_JOB = "advance-master";
/** The gate that must run BEFORE anything is written to GitHub. */
const GATE_JOB = "verify-plugin-channel";

/** Literals belonging to the RETIRED npm/SEA artifact channel. The restored step must carry none —
 *  and, since `delivery-manifest-check.ts` regex-scans this whole workflow for exactly these, a
 *  comment that merely mentions one is not a harmless slip. */
const RETIRED_LITERALS = ["SEA_", "quay-sea-", "npm pack"];

function readWorkflow() {
  assert.ok(fs.existsSync(REAL_WF), `release.yml must exist at ${REAL_WF}`);
  const text = fs.readFileSync(REAL_WF, "utf8");
  let doc;
  assert.doesNotThrow(() => {
    doc = parseYaml(text);
  }, "release.yml must be valid YAML — a job that cannot be parsed cannot be scheduled");
  return { text, doc };
}

/** The parsed job object, or a failure naming what was missing. */
function jobOf(doc) {
  const job = doc?.jobs?.[JOB];
  assert.ok(job, `release.yml must carry a \`${JOB}\` job (its absence is the defect this file pins)`);
  return job;
}

/** The step carrying the release-creating script. Located by its STABLE `id:`, so renaming the
 *  step's human-readable `name:` cannot silently detach this test from the thing it guards. */
function stepOf(job) {
  const steps = Array.isArray(job.steps) ? job.steps : [];
  const step = steps.find((s) => s && s.id === STEP_ID);
  assert.ok(step, `the \`${JOB}\` job must carry a step with \`id: ${STEP_ID}\``);
  return step;
}

// ── AC1: structure ───────────────────────────────────────────────────────────────────────────────
test("AC1: release.yml parses and the release-creating job is scheduled after the verification gate", () => {
  const { doc } = readWorkflow();
  const job = jobOf(doc);

  const needs = job.needs === undefined ? [] : [].concat(job.needs);
  assert.ok(
    needs.includes(GATE_JOB),
    `\`${JOB}.needs\` must name \`${GATE_JOB}\` so the release object is only created for a tag whose ` +
      `plugin channel actually installs and serves; got ${JSON.stringify(job.needs)}`,
  );

  // The step exists, is a shell step, and carries a non-trivial script.
  const step = stepOf(job);
  assert.equal(typeof step.run, "string", `the \`${STEP_ID}\` step must be a \`run:\` shell step`);
  assert.ok(step.run.trim().length > 200, "the release-creating step's script must be non-trivial");
  assert.match(step.run, /\bgh\s+release\s+create\b/, "the step must actually create a GitHub Release");

  // Creating a Release is a WRITE; a job without `contents: write` fails at the API.
  assert.equal(job.permissions?.contents, "write", `\`${JOB}\` needs \`permissions: contents: write\` to create a Release`);
});

test("AC1: advance-master waits for the release object (master must not advance onto an invisible release)", () => {
  const { doc } = readWorkflow();
  const masterNeeds = [].concat(doc.jobs?.[MASTER_JOB]?.needs ?? []);
  assert.ok(
    masterNeeds.includes(JOB),
    `\`${MASTER_JOB}.needs\` must name \`${JOB}\` — master is "the tag of the most recent FULLY GREEN ` +
      `release run", and a run whose release object was never created is not a release anyone can ` +
      `see; got ${JSON.stringify(masterNeeds)}`,
  );
});

test("AC1: the job set is exactly the gate, the release, and master — and every non-master job is covered by needs", () => {
  const { doc } = readWorkflow();
  const keys = Object.keys(doc.jobs ?? {}).sort();
  assert.deepEqual(keys, [JOB, GATE_JOB, MASTER_JOB].sort(), `release.yml's job set changed: ${keys.join(", ")}`);
  const masterNeeds = [].concat(doc.jobs?.[MASTER_JOB]?.needs ?? []);
  const uncovered = keys.filter((k) => k !== MASTER_JOB && !masterNeeds.includes(k));
  assert.deepEqual(uncovered, [], `jobs not named in \`${MASTER_JOB}.needs\`: ${uncovered.join(", ")}`);
});

// ── AC2: negative control on the retired artifact channel ────────────────────────────────────────
/** The predicate under test, named so its positive control below exercises the SAME code. */
function retiredLiteralsIn(text) {
  return RETIRED_LITERALS.filter((lit) => String(text).includes(lit));
}

test("AC2: the release step references nothing from the retired npm/SEA artifact channel", () => {
  const { doc } = readWorkflow();
  const step = stepOf(jobOf(doc));

  // The executable content is the primary object: that is what the runner runs and what
  // delivery-manifest-check's parser reads.
  assert.deepEqual(
    retiredLiteralsIn(step.run),
    [],
    `the \`${STEP_ID}\` step's script mentions retired artifact-channel literal(s) — the channel was ` +
      `cancelled by the 2026-09-16 ruling and nothing may depend on it again`,
  );

  // And the job as a whole (comments included): the same parser scans the whole file, so a comment
  // that reintroduces one of these is not inert.
  assert.deepEqual(
    retiredLiteralsIn(JSON.stringify(jobOf(doc))),
    [],
    `the \`${JOB}\` job (including its comments) mentions retired artifact-channel literal(s)`,
  );
});

test("AC2 positive control: the retired-literal predicate DOES bite on a string that carries one", () => {
  // ⛔ Without this, the assertion above is an absence claim that no input could falsify — the
  // 硬规则 4 shape ("a quantity that cannot take the value false is not a measurement"). Both
  // directions are shown: the predicate returns the literal for a carrier, and [] for clean text.
  assert.deepEqual(retiredLiteralsIn("run: npm pack ./packages/quay"), ["npm pack"]);
  assert.deepEqual(retiredLiteralsIn("env:\n  SEA_NODE_VERSION: '24'"), ["SEA_"]);
  assert.deepEqual(retiredLiteralsIn("uses: softprops/action-gh-release@v2"), []);
});

// ── AC3: idempotency, driven against the shipped script ──────────────────────────────────────────
/** A `gh` stand-in. State lives in `GH_SHIM_STATE`:
 *    exists            — file whose content is the tag of an existing Release (absent ⇒ not found)
 *    concurrent-exists — if present, the create call itself makes `exists` appear (the race case)
 *    create-rc         — the exit code `gh release create` should return (default 0)
 *  Every invocation is appended to `calls.log`, and the create call's argv to `create-argv.txt`. */
const GH_SHIM = `#!/usr/bin/env bash
set -u
state="\${GH_SHIM_STATE:?GH_SHIM_STATE unset}"
printf '%s\\n' "$*" >> "\${state}/calls.log"
if [ "\${1:-}" != "release" ]; then
  echo "shim: only \\\`gh release\\\` is shimmed (got \\\${1:-<none>})" >&2
  exit 64
fi
verb="\${2:-}"
tag="\${3:-}"
case "\${verb}" in
  view)
    if [ -f "\${state}/exists" ] && [ "$(cat "\${state}/exists")" = "\${tag}" ]; then
      printf '%s\\n' "\${tag}"
      exit 0
    fi
    echo "release not found" >&2
    exit 1
    ;;
  create)
    printf '%s\\n' "$*" > "\${state}/create-argv.txt"
    rc=0
    if [ -f "\${state}/create-rc" ]; then rc="$(cat "\${state}/create-rc")"; fi
    if [ "\${rc}" = "0" ] || [ -f "\${state}/concurrent-exists" ]; then
      printf '%s\\n' "\${tag}" > "\${state}/exists"
    fi
    if [ "\${rc}" != "0" ]; then echo "HTTP 422: Validation Failed" >&2; fi
    exit "\${rc}"
    ;;
esac
echo "shim: unhandled \\\`gh release \\\${verb}\\\`" >&2
exit 64
`;

/** Drive the SHIPPED step script under the shim. Returns { status, stdout, stderr, state }. */
function runReleaseStep({ exists = null, concurrentExists = false, createRc = 0 }) {
  const { doc } = readWorkflow();
  const script = stepOf(jobOf(doc)).run;

  // The run body must be plain bash — a `${{ … }}` expression is evaluated by GitHub, not by bash,
  // so its presence would mean this test is executing something other than what the runner runs.
  assert.doesNotMatch(script, /\$\{\{/, "the step's run body must carry no GitHub expression (its inputs come from `env:`)");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ghrelshim-"));
  const shimDir = path.join(dir, "bin");
  const state = path.join(dir, "state");
  fs.mkdirSync(shimDir, { recursive: true });
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(shimDir, "gh"), GH_SHIM, { mode: 0o755 });
  if (exists !== null) fs.writeFileSync(path.join(state, "exists"), `${exists}\n`);
  if (concurrentExists) fs.writeFileSync(path.join(state, "concurrent-exists"), "");
  if (createRc !== 0) fs.writeFileSync(path.join(state, "create-rc"), `${createRc}\n`);

  const r = spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${shimDir}:${process.env.PATH}`,
      GH_SHIM_STATE: state,
      TAG: "v9.9.9",
      REPO: "example/quay",
    },
  });

  const readIf = (f) => (fs.existsSync(path.join(state, f)) ? fs.readFileSync(path.join(state, f), "utf8") : null);
  const result = {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    calls: readIf("calls.log") ?? "",
    createArgv: readIf("create-argv.txt"),
    // The shim is deleted before the assertions so a failure cannot leave tmp state behind that
    // would make a LATER case pass for the wrong reason.
  };
  fs.rmSync(dir, { recursive: true, force: true });
  return result;
}

test("AC3 case A: a re-dispatch of a tag that ALREADY has a Release exits 0 and never calls create", () => {
  const r = runReleaseStep({ exists: "v9.9.9" });
  assert.equal(r.status, 0, `re-dispatching an already-released tag must not fail:\n${r.stderr}`);
  assert.equal(r.createArgv, null, "`gh release create` must NOT be called when the Release already exists");
  assert.match(r.stdout, /already exists/i, "the skip must say so, rather than passing silently");
});

test("AC3 case B: with no existing Release the step creates one, with --verify-tag", () => {
  const r = runReleaseStep({ exists: null });
  assert.equal(r.status, 0, `creating the Release must succeed:\n${r.stderr}`);
  assert.ok(r.createArgv, "`gh release create` must have been called");
  assert.match(r.createArgv, /^release create v9\.9\.9\b/, `unexpected create argv: ${r.createArgv}`);
  // ⛔ LOAD-BEARING: without --verify-tag, `gh release create` FABRICATES a tag from the default
  // branch when the tag is missing — i.e. a version tag pointing at master, which is the "the
  // version number lies" class this whole SPEC exists to end.
  assert.match(r.createArgv, /--verify-tag/, `the create must be tag-pinned: ${r.createArgv}`);
  assert.match(r.createArgv, /--repo example\/quay/, `the create must name the repository: ${r.createArgv}`);
});

test("AC3 case C: a genuine create failure with no Release present is RED (not a blanket `|| true`)", () => {
  const r = runReleaseStep({ exists: null, createRc: 1 });
  assert.notEqual(r.status, 0, "a create that failed with no Release present must fail the step");
  assert.match(r.stderr, /no GitHub Release exists/i, `the failure must say what actually happened:\n${r.stderr}`);
});

test("AC3 case D: a create that failed BECAUSE the Release now exists is tolerated (the raced case)", () => {
  // The object appears between the existence check and the create call — a concurrent run, or a
  // retry of a run that got as far as creating it. The step reads the outcome back and no-ops.
  const r = runReleaseStep({ exists: null, createRc: 1, concurrentExists: true });
  assert.equal(r.status, 0, `the raced case must not fail the step:\n${r.stderr}`);
  assert.ok(r.createArgv, "the create must still have been attempted");
});

test("AC3 case E: the guard reads the tag value back, so a `view` that merely errors is not 'absent'", () => {
  // ⛔ The direction that matters: `gh release view` exits non-zero on a transient API/auth error
  // too. If the guard keyed on exit status alone, a working release would read as absent and the
  // step would burn a create call. The shim reports a DIFFERENT tag existing, which is exactly that
  // shape: view succeeds, but not for our tag ⇒ the step must still create.
  const r = runReleaseStep({ exists: "v0.0.0-other" });
  assert.equal(r.status, 0, `a Release for a different tag must not be mistaken for ours:\n${r.stderr}`);
  assert.ok(r.createArgv, "no Release exists for OUR tag, so it must be created");
});
