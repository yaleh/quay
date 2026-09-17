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
    id: "procps",
    what: "procps (ps/pgrep) — full-suite-runner.ts counts its own runners with `pgrep -c -f`, and the reaper tests shell out to `ps`",
    re: /install[^\n]*\bprocps\b/i,
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

// ── AC-282 载体臂：那一步必须打印【机器可读】的前置状态 marker ──────────────────────────────────
// Why this is a separate assertion from the ones above: those prove the prerequisite is PROVISIONED;
// this one proves the provisioning's *outcome* is OBSERVABLE. `already-present` and `installed-apt`
// have the SAME step conclusion (`success`) and the jobs API reports no per-step duration, so
// "did this runner already have it, or did the job install it again?" is structurally underivable
// from the API — the only carrier of that reading is the step's own stdout. Without a marker,
// goal AC-282 sits on `CAUSE=prereq-provision-not-recorded` forever even on a perfectly
// provisioned runner (hard rule 4 corollary 3: implemented, tests green, production never
// produced the reading ⇒ indistinguishable from not implemented).
const PREREQ_MARKER_RE = /__PREREQ__[ \t]+([A-Za-z0-9_-]+)=([A-Za-z0-9_.-]+)/g;
/** The vocabulary `derivePrereqProvision` (plugin/scripts/ci-runs-collect.ts) accepts. */
const PREREQ_MARKER_VALUES = ["already-present", "installed-apt", "installed-pip", "absent"];

/** marker lines printed by the step(s) that provision the prerequisites. */
function prereqMarkers(text) {
  return [...text.matchAll(PREREQ_MARKER_RE)].map((m) => ({ name: m[1], value: m[2] }));
}

test("AC-282 carrier arm: the prereq step prints a machine-readable __PREREQ__ marker per prerequisite", () => {
  const job = loadJob(readFileSync(CI_YML, "utf8"));
  const text = stepTexts(job).join("\n");
  const markers = prereqMarkers(text);
  const named = new Set(markers.map((m) => m.name));
  const missing = ["pyyaml", "tmux", "procps"].filter((n) => !named.has(n));
  assert.deepEqual(
    missing, [],
    "the provisioning step must print one `__PREREQ__ <name>=<state>` line per prerequisite — " +
    "without it, whether the runner was already provisioned (vs. the job installing it again) " +
    "cannot be derived from the job at all:\n  " + missing.join("\n  "),
  );
  // Every value printed must be one the deriver accepts; an unlisted value would be dropped and
  // silently degrade that prerequisite to `absent` (not evaluated).
  const unknown = markers.filter((m) => !PREREQ_MARKER_VALUES.includes(m.value));
  assert.deepEqual(unknown, [], `marker values outside the derived vocabulary: ${JSON.stringify(unknown)}`);
  // 能取假 — the same predicate must find NOTHING once the marker lines are gone. Without this, a
  // regex that matches everything (or a stepTexts that returns the whole file) would pass above.
  const stripped = text.replace(/^\s*echo\s+"__PREREQ__.*$/gm, "");
  assert.equal(prereqMarkers(stripped).length, 0, "the marker predicate matches something else — it is a tautology");
});

/** A lane-count pin in a suite-launch command, in either spelling. `=8` and ` 8` are both real
 *  (`runner-concurrency.ts` splices both), and a bare `--test-concurrency` with no number is still
 *  a pin attempt. Returns the matched text or null. */
function pinnedConcurrency(runStep) {
  return (/--test-concurrency(=\s*\d+|\s+\d+)?/.exec(runStep) ?? [])[0] ?? null;
}

test("AC: the suite concurrency is HOST-DERIVED — the workflow must not pin a lane count", () => {
  // REVERSED 2026-09-16 (gap-suite-not-robust-at-high-derived-concurrency). The previous task capped
  // this at 16 to dodge three load-shaped failures at concurrency=128. That cap was a literal that
  // only "equalled no limit" on a 16-core dev box (硬规则 4 推论二), and it hid three real DEFECTS IN
  // THE TESTS rather than fixing them: probe-then-bind ephemeral ports (EADDRINUSE), a wall-clock
  // literal waiting for a detached suite's exit marker, and a walk→read race in the dead-code
  // checker's strict-zero scan. All three are now root-caused and fixed at the mechanism (see
  // tasks/gap-suite-not-robust-at-high-derived-concurrency), so the invariant inverts: the launch
  // must NOT state a lane count, and `default_test_concurrency()` reads the host.
  const job = loadJob(readFileSync(CI_YML, "utf8"));
  const runStep = (job.steps ?? []).map((s) => s.run ?? "").find((t) => /scripts\/test\.sh/.test(t));
  assert.ok(runStep, "the `test` job must still invoke scripts/test.sh");
  assert.equal(
    pinnedConcurrency(runStep), null,
    `the suite launch must NOT pin a lane count (host-derived is the invariant); got: ${JSON.stringify(runStep)}`,
  );

  // 能取假 — the SAME predicate must fire on a re-introduced pin, in both spellings. Without this the
  // assertion above would pass on a parser that returns null for everything.
  assert.equal(pinnedConcurrency("bash scripts/test.sh --test-concurrency=16"), "--test-concurrency=16");
  assert.equal(pinnedConcurrency("bash scripts/test.sh --test-concurrency 4"), "--test-concurrency 4");
  assert.equal(pinnedConcurrency("bash scripts/test.sh --groups main"), null);
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
