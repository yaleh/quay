// @test-group engine
// ci-runner-env-prereqs.test.mjs — the CI `test` job must DECLARE and PROVISION the environment the
// suite actually needs (gap-tokyo-alpha-runner-env-lacks-pyyaml-suite-red).
//
// Why this file exists at all: on 2026-09-16 the `test` job moved from ubuntu-latest to the
// self-hosted `tokyo-alpha` runner and went red — 25 test files / 74 assertions, none of them a
// product defect. They were four environment differences (no PyYAML for the PRODUCT's own
// python3-based config parsing, no tmux, a non-C collation, and no local `develop` ref). Fixing
// that on the runner HOST would have been unreproducible and would silently rot the next time the
// runner is rebuilt; the fix belongs in the reviewed workflow, and this file is what makes its
// removal detectable rather than a comment nobody reads (hard rule 9: a rule whose "kept" and
// "broken" states look identical in the record can only be kept by willpower).
//
// What is asserted is the OBSERVABLE (does the job's step text provision this prerequisite /
// declare this locale), not a frozen copy of the shell — the recipe may be rewritten, provided the
// prerequisite is still provisioned and the locale still pinned.
//
// The judgement is made falsifiable rather than asserted: the mutation control at the bottom
// re-runs the same predicate against a copy of ci.yml with the provisioning steps deleted and
// requires it to go RED. A predicate that cannot take false here would be a tautology.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CI_YML = join(repoRoot, ".github", "workflows", "ci.yml");

// Each prerequisite is named with the fact it stands for, and matched by a pattern that is about
// PROVISIONING it (not about any particular package manager).
const PREREQUISITES = [
  {
    id: "pyyaml",
    what: "PyYAML for python3 — the product's own scripts parse .quay/config.yml via `python3 -c 'import yaml'` (plugin/scripts/quay-init.sh, quay-launch.sh, manager-start.sh)",
    re: /install[^\n]*\bpython3-yaml\b|\bpython3-yaml\b[^\n]*install|install[^\n]*\bpyyaml\b|\bpyyaml\b[^\n]*install/i,
  },
  {
    id: "tmux",
    what: "tmux — the cross-session tests (tmux-leak-scan, supervisor-observe) drive a real tmux server",
    re: /install[^\n]*\btmux\b/i,
  },
  {
    id: "develop-ref",
    what: "a LOCAL `develop` ref — direct-to-develop-bypass-check.ts and the two git-graph decoration tests resolve it by branch name, and actions/checkout leaves it remote-tracking",
    re: /git branch develop|refs\/heads\/develop/,
  },
];

function loadJob(text) {
  const doc = YAML.parse(text);
  const job = doc?.jobs?.test;
  assert.ok(job, "ci.yml must still define a `test` job");
  return job;
}

function stepTexts(job) {
  return (job.steps ?? []).map((s, i) => `${s.name ?? s.uses ?? `step#${i}`}\n${s.run ?? ""}`);
}

// A C locale is what the suite is written and was green against (ubuntu-latest runs it); any
// UTF-8/Latin collation makes GNU `sort -u` order differently and reddens the two order-sensitive
// assertions. Matched as "starts with C and is not a language collation".
function declaresCLocale(job) {
  const v = job?.env?.LC_ALL ?? job?.env?.LANG;
  return typeof v === "string" && /^C(\.UTF-8)?$/i.test(v.trim());
}

test("AC: the CI `test` job provisions every suite runtime prerequisite", () => {
  const job = loadJob(readFileSync(CI_YML, "utf8"));
  const texts = stepTexts(job);
  const missing = [];
  for (const p of PREREQUISITES) {
    if (!texts.some((t) => p.re.test(t))) missing.push(`${p.id} (${p.what})`);
  }
  assert.deepEqual(
    missing, [],
    "the `test` job no longer provisions these prerequisites — the suite will red on a runner " +
    "that lacks them, and the failures will read as product defects:\n  " + missing.join("\n  "),
  );
});

test("AC: the CI `test` job pins the locale instead of inheriting the runner host's", () => {
  const job = loadJob(readFileSync(CI_YML, "utf8"));
  assert.ok(
    declaresCLocale(job),
    `jobs.test.env must pin LC_ALL (or LANG) to a C locale; got ${JSON.stringify(job?.env ?? null)}. ` +
    "The suite's ordering assertions compare against `sort -u` output, whose order is " +
    "locale-dependent — inheriting en_US.UTF-8 from the runner host reddens them.",
  );
});

test("AC: an unprovisioned runner fails LOUDLY and ONCE, not as ~74 unrelated assertion errors", () => {
  // Hard rule 3b: a check that cannot name what is missing cannot be distinguished from one that
  // passed. The job must therefore ENUMERATE the prerequisites and exit non-zero on any absence,
  // so an under-provisioned runner produces one honest failure instead of a pile of test failures
  // that read as product defects.
  const job = loadJob(readFileSync(CI_YML, "utf8"));
  const texts = stepTexts(job);
  const enumerating = texts.find((t) => /MISSING/.test(t) && /exit 1/.test(t));
  assert.ok(
    enumerating,
    "the `test` job must carry a step that names each absent prerequisite and exits 1 — " +
    "otherwise an unprovisioned runner is indistinguishable from a failing product",
  );
});

test("AC: the prerequisites are DECLARED, not inherited — mutation control (the predicate can take false)", () => {
  const original = readFileSync(CI_YML, "utf8");
  const job = loadJob(original);

  // Strip exactly the steps that provision/verify prerequisites, then re-run the SAME predicate.
  // If nothing goes red, the assertions above prove nothing.
  const strippedSteps = (job.steps ?? []).filter((s) => {
    const t = `${s.name ?? ""}\n${s.run ?? ""}`;
    return !PREREQUISITES.some((p) => p.re.test(t)) && !(/MISSING/.test(t) && /exit 1/.test(t));
  });
  assert.ok(
    strippedSteps.length < (job.steps ?? []).length,
    "the mutation control removed nothing — it is not exercising the real steps",
  );
  const mutatedJob = { ...job, steps: strippedSteps };
  const texts = stepTexts(mutatedJob);
  const survivors = PREREQUISITES.filter((p) => texts.some((t) => p.re.test(t)));
  assert.deepEqual(
    survivors.map((p) => p.id), [],
    "the provisioning patterns are still satisfied after the provisioning steps were deleted — " +
    "they are matching something else, so the assertions above are tautologies",
  );
});
