// @test-group engine
// ci-workflow-concurrency.test.mjs — ci.yml must coalesce same-(event, ref) runs
// (gap-ci-yml-no-concurrency-group-push-runs-pile-up-on-single-runner).
//
// WHY THIS FILE EXISTS. On 2026-10-20 develop's push-triggered CI was measured at ~48 pushes/day
// arriving in hourly bursts of up to 9, against a single ephemeral runner completing ~3 runs/hour
// (`test` median 15 min, n=30, range 12–25): arrivals exceeded completions, so 18 runs sat queued
// and the queue needed ~6 h to drain even with no new pushes. Every supersession until then was
// MANUAL (`gh run cancel` x15) — a rule whose "kept" and "broken" states look identical in the
// record, i.e. one that can only be kept by willpower (硬规则 9). The fix is a top-level
// `concurrency:` block in ci.yml; this file is what makes its REMOVAL detectable instead of a
// comment nobody reads.
//
// THE PREDICATE, BY POSITION (硬规则 2 — a comment or a string that MENTIONS these keys must never
// count as a hit): the workflow file is parsed as YAML and the judgement reads the parsed DOCUMENT:
//   • `concurrency` exists at the TOP LEVEL (not nested inside a job) and is a MAPPING
//     (`concurrency: <string>` is also legal YAML/GitHub — but a bare string has no room for the
//     `github.event_name` half, and the two halves are what keep a push from superseding the
//     nightly `schedule` tick / a `workflow_dispatch` run)
//   • its `group` value contains BOTH `github.event_name` and `github.ref` (as reference
//     identifiers: `github.ref_name` does not satisfy "github.ref")
//   • `cancel-in-progress` is ABSENT or explicitly false
//     (⛔ true would kill the RUNNING `test` — ~15 min of work — and the running run is exactly the
//     one that yields the decisive reading; the task forbids trading that away for a shorter queue)
//
// FALSIFIABILITY (AC1). The mutation control at the bottom re-runs the SAME predicate over the REAL
// ci.yml document with each of the three mutations the task names applied — no `concurrency` at all,
// `github.event_name` removed from the group, `cancel-in-progress: true` — and requires every one of
// them to go RED. It also asserts each mutation actually CHANGED the document first: a mutant that
// silently did not mutate would make the control vacuously green.
//
// No fixtures and no environment seam: the assertion is always about the repository's own ci.yml.
// A seam that let a fixture satisfy this predicate would prove only that the check can produce a
// reading, not that the production carrier has one (硬规则 4 推论三).
//
// Run:
//   scripts/test.sh plugin/test/ci-workflow-concurrency.test.mjs
//   node --test plugin/test/ci-workflow-concurrency.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CI_YML = join(repoRoot, ".github", "workflows", "ci.yml");

/** The two contexts as REFERENCE IDENTIFIERS: `github.ref_name` must NOT satisfy the
 *  `github.ref` half (nor `github.event_name_extra` the other), so each pattern ends in a negative
 *  lookahead for an identifier character rather than a bare substring match. */
const REF_EXPR = /github\.ref(?![A-Za-z0-9_])/;
const EVENT_NAME_EXPR = /github\.event_name(?![A-Za-z0-9_])/;

/**
 * Judge a PARSED ci.yml document. Pure, so the mutation control can drive it directly.
 * Returns every failure ENUMERATED (硬规则 3: a boolean would collapse "no concurrency block",
 * "wrong group", and "cancel-in-progress set" into one indistinguishable red).
 */
export function judgeConcurrency(doc) {
  const failures = [];
  const concurrency = doc?.concurrency;
  if (concurrency === undefined || concurrency === null) {
    failures.push(
      "top-level `concurrency:` is ABSENT — every push still enqueues a whole workflow, so an " +
        "intermediate commit's run occupies the single runner behind the commit that superseded it",
    );
    return { ok: false, failures };
  }
  if (typeof concurrency !== "object" || Array.isArray(concurrency)) {
    failures.push(
      `top-level \`concurrency\` is ${JSON.stringify(concurrency)}, not a MAPPING — the GitHub string ` +
        "form has no place to express both the event and the ref, so one channel can supersede another",
    );
    return { ok: false, failures };
  }

  const group = concurrency.group;
  if (typeof group !== "string" || group.trim() === "") {
    failures.push(`\`concurrency.group\` is ${JSON.stringify(group)} — it must be a non-empty expression string`);
  } else {
    if (!EVENT_NAME_EXPR.test(group)) {
      failures.push(
        `\`concurrency.group\` (${JSON.stringify(group)}) does not contain \`github.event_name\` — a push ` +
          "would supersede a queued `schedule` tick or `workflow_dispatch` run and silently delete that reading",
      );
    }
    if (!REF_EXPR.test(group)) {
      failures.push(
        `\`concurrency.group\` (${JSON.stringify(group)}) does not contain \`github.ref\` — different refs ` +
          "would share one group and supersede each other's runs",
      );
    }
  }

  const cancelInProgress = concurrency["cancel-in-progress"];
  if (cancelInProgress !== undefined && cancelInProgress !== false && cancelInProgress !== "false") {
    failures.push(
      `\`concurrency.cancel-in-progress\` is ${JSON.stringify(cancelInProgress)} — it must be ABSENT or false: ` +
        "true kills the RUNNING `test` (~15 min), and the running run is the one that yields the decisive reading",
    );
  }

  return { ok: failures.length === 0, failures };
}

function loadCiDocument() {
  return YAML.parse(readFileSync(CI_YML, "utf8"));
}

test("AC0 — ci.yml carries a top-level `concurrency` mapping", () => {
  const doc = loadCiDocument();
  assert.equal(
    typeof doc.concurrency,
    "object",
    "ci.yml must carry a top-level `concurrency:` MAPPING (not a job-level one, not a bare string)",
  );
  assert.equal(Array.isArray(doc.concurrency), false, "`concurrency` must be a mapping, not a list");
});

test("AC0 — the concurrency group keys on BOTH the event and the ref", () => {
  const doc = loadCiDocument();
  const group = doc?.concurrency?.group;
  assert.equal(typeof group, "string", "`concurrency.group` must be a string expression");
  assert.match(group, EVENT_NAME_EXPR, "the group must contain `github.event_name` (a push must not supersede schedule/dispatch)");
  assert.match(group, REF_EXPR, "the group must contain `github.ref` (different refs must not supersede each other)");
});

test("AC0 — `cancel-in-progress` is absent or false (never true)", () => {
  const doc = loadCiDocument();
  const value = doc?.concurrency?.["cancel-in-progress"];
  assert.ok(
    value === undefined || value === false || value === "false",
    `\`cancel-in-progress\` must be ABSENT or false — the running \`test\` must not be killed (got ${JSON.stringify(value)})`,
  );
});

test("AC0 — the whole predicate passes on the real ci.yml", () => {
  const { ok, failures } = judgeConcurrency(loadCiDocument());
  assert.ok(ok, `ci.yml's concurrency block does not hold:\n  - ${failures.join("\n  - ")}`);
});

// ── AC1 mutation control (falsifiability, on the REAL document) ─────────────────────────────────
// Each mutation is applied to a fresh parse of the repository's own ci.yml, so the control exercises
// the production carrier rather than a fixture. `assert.notEqual` on the mutated value BEFORE the
// judgement is the non-vacuity guard: a mutant that did not mutate would otherwise "go red" for the
// wrong reason (or go green and be read as a broken check).
const MUTANTS = [
  {
    name: "remove the whole `concurrency` block",
    apply(doc) {
      delete doc.concurrency;
    },
  },
  {
    name: "drop `github.event_name` from the group",
    apply(doc) {
      const before = doc.concurrency.group;
      doc.concurrency.group = before.replaceAll("github.event_name", "");
      assert.notEqual(doc.concurrency.group, before, "the mutation must actually change the group");
    },
  },
  {
    name: "set `cancel-in-progress: true`",
    apply(doc) {
      doc.concurrency["cancel-in-progress"] = true;
    },
  },
];

for (const mutant of MUTANTS) {
  test(`AC1 — mutation control: ${mutant.name} must turn the predicate RED`, () => {
    const doc = loadCiDocument();
    mutant.apply(doc);
    const { ok, failures } = judgeConcurrency(doc);
    assert.equal(ok, false, `the predicate stayed GREEN after: ${mutant.name} — it cannot take false, so it asserts nothing`);
    assert.ok(failures.length >= 1, "a RED verdict must NAME at least one enumerated failure");
  });
}
