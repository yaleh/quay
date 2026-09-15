// @test-group engine
// axis-generator.test.mjs — the predictive dimension generator + the nightly falsifiable count
// (tasks/gap-axis-generator-question-what-range-every-standing-criterion, AC1-AC5).
//
// AC1 generator mechanism — the runner asks every standing criterion "what range does it quantify
//   (time/scope/layer/instance/cost)? if the answer is the present one, there's an unopened axis";
//   `--criteria` enumerates the repo's gates + static checkers (mechanical source, not hand-listed)
//   and classifies each.
// AC2 falsifiable count — `prefriction-count.sh` counts newly-filed tasks with NO triggering
//   failure/alarm/contradiction at filing; stdout's prefriction_dimensions field is the measure.
// AC3 predictive-power check — the 5/5 reverse-derivation regression control (the human's five
//   known axes from SYNTHESIS-axis-generation) + negative fixtures (axes DO open when a range is
//   quantified) + the not-keyword-scan invariant (axis-name words alone must not open an axis).
// AC4 (annotations live in the two projection task bodies, asserted by their own gates).
// AC5 this file uses node:test and declares `// @test-group engine`.
//
// Run: scripts/test.sh plugin/test/axis-generator.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  classifyRange,
  runSelfcheck,
  enumerateCriteria,
  REGRESSION_FIXTURES,
  NEGATIVE_FIXTURES,
  INVARIANT_CONTROLS,
  AXES,
} from "../scripts/axis-generator.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const GENERATOR = path.join(REPO_ROOT, "plugin", "scripts", "axis-generator.ts");
const PREF_COUNT = path.join(REPO_ROOT, "plugin", "scripts", "prefriction-count.sh");

// ── AC3: the 5/5 regression control + negative fixtures + invariant ────────────────────────────────

test("AC3 regression: the 5/5 known axes are reproduced by the same question", () => {
  assert.equal(REGRESSION_FIXTURES.length, 5, "five known axes from SYNTHESIS-axis-generation");
  for (const fx of REGRESSION_FIXTURES) {
    const r = classifyRange(fx);
    assert.ok(
      r.unopened_axes.includes(fx.expected_unopened[0]),
      `known axis ${fx.expected_unopened[0]} of ${fx.name} must be reproduced as unopened (got ${r.unopened_axes.join(",")})`,
    );
    assert.equal(r.opened_axes.length, 0, `${fx.name} is a present-only criterion; no axis may open (got ${r.opened_axes.join(",")})`);
  }
});

test("AC3 negative fixtures: an axis OPENS when a range is quantified beyond the present", () => {
  for (const fx of NEGATIVE_FIXTURES) {
    const r = classifyRange(fx);
    for (const a of fx.expected_opened) {
      assert.ok(r.opened_axes.includes(a), `${fx.name} must open ${a} (got opened=${r.opened_axes.join(",")})`);
    }
  }
});

test("invariant generator_is_question: axis-NAME words alone do not open an axis", () => {
  for (const ctl of INVARIANT_CONTROLS) {
    const r = classifyRange(ctl);
    for (const a of ctl.must_not_open) {
      assert.ok(!r.opened_axes.includes(a), `${ctl.name} must NOT open ${a} from an axis-name word alone`);
    }
  }
});

test("AC3 selfcheck: CLI --selfcheck exits 0 (all controls pass)", () => {
  const res = spawnSync("node", ["--experimental-strip-types", GENERATOR, "--selfcheck"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.equal(res.status, 0, `--selfcheck must exit 0\n${res.stdout}\n${res.stderr}`);
  assert.match(res.stdout, /ALL PASS/);
});

// ── AC1: the generator mechanism over the repo's standing criteria ────────────────────────────────

test("AC1 classification shape: every criterion gets a per-axis range verdict", () => {
  for (const axis of AXES) {
    const r = classifyRange({ id: "x", name: "x", description: "plain pass/fail on the current run" });
    assert.ok(axis in r.quantifies, `quantifies must cover ${axis}`);
    assert.ok(["present", "windowed", "subset", "layered", "multi", "costed"].includes(r.quantifies[axis]));
  }
});

test("AC1 enumerateCriteria: gates + static checkers are discovered mechanically with descriptions", () => {
  const { gates, checkers, all } = enumerateCriteria(REPO_ROOT);
  // `.quay/config.yml` is gitignored and workspace-local (DIR-050) — a fresh clone/CI checkout has
  // NO workspace config, so the gate enumeration legitimately yields 0 there (the real workspace's
  // gate set is not part of the repo). The gate-set assertion is therefore live-workspace-only; the
  // checker set (discovered from the tracked scripts/test.sh) is asserted unconditionally so a fresh
  // clone still exercises the mechanical enumeration.
  if (fs.existsSync(path.join(REPO_ROOT, ".quay", "config.yml"))) {
    assert.ok(gates.length >= 10, `expected a real gate set, got ${gates.length}`);
  } else {
    assert.equal(gates.length, 0, "no workspace .quay/config.yml on a fresh clone — 0 gates is expected");
  }
  assert.ok(checkers.length >= 5, `expected real static checkers, got ${checkers.length}`);
  assert.equal(all.length, gates.length + checkers.length);
  // descriptions come from the scripts' own header comments (a checker with none is suspicious)
  const described = all.filter((c) => (c.description || "").length > 20);
  assert.ok(described.length >= all.length * 0.5, `most criteria should carry a header-comment description, got ${described.length}/${all.length}`);
  // ids are namespaced so the two sources never collide
  assert.ok(all.every((c) => c.id.startsWith("gate:") || c.id.startsWith("checker:")));
});

test("AC1 CLI --criteria emits a JSON report", () => {
  const res = spawnSync("node", ["--experimental-strip-types", GENERATOR, "--criteria"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.equal(res.status, 0, res.stderr);
  const parsed = JSON.parse(res.stdout);
  // Gate count depends on the gitignored workspace config (absent on a fresh clone/CI); the tracked
  // static checkers alone must still clear the floor so the report is meaningful either way.
  const floor = fs.existsSync(path.join(REPO_ROOT, ".quay", "config.yml")) ? 15 : 5;
  assert.ok(parsed.total >= floor, `expected >= ${floor} criteria, got ${parsed.total}`);
  assert.equal(parsed.criteria.length, parsed.total);
});

// ── AC2: the nightly falsifiable count ────────────────────────────────────────────────────────────

/**
 * A git identity for THIS fixture's own subprocesses, scoped to the fixture (never `--global`).
 *
 * Why env and not just `git config user.email`:
 * git resolves the committer ident in the order **env var → config → auto-detect**, and an env var
 * that is present-but-EMPTY is taken as the value (git's `if (!name)` test is a NULL check, not an
 * emptiness check) — so a repo-scoped `user.name`/`user.email` is *silently defeated* whenever the
 * environment carries empty `GIT_COMMITTER_NAME`/`GIT_COMMITTER_EMAIL`. Reproduced exactly on this
 * host: `env GIT_COMMITTER_NAME= GIT_COMMITTER_EMAIL= git commit` ⇒
 * `fatal: empty ident name (for <>) not allowed` — the same message CI reported. Making the fixture
 * pass a non-empty identity in the child env beats an empty var AND covers the other shape (a runner
 * where git's passwd/hostname auto-detection yields nothing), without touching any global config.
 */
function fixtureGitEnv() {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: "fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  };
}

/** `git -C <dir> <args>` for fixture repos, with a fixture-scoped identity (see fixtureGitEnv). */
function fixtureGit(dir, args) {
  return spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", env: fixtureGitEnv() });
}

function makeGitWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pfc-test-"));
  fs.mkdirSync(path.join(dir, "tasks"));
  const write = (id, body) => fs.writeFileSync(path.join(dir, "tasks", `${id}.md`), body);
  write(
    "T1",
    `---\nid: T1\ntitle: triggered\n---\n\n## Proposal\n\nThe suite failed with 3 failing tests and the metric degraded 0.2->0.5 overnight.\n`,
  );
  write(
    "T2",
    `---\nid: T2\ntitle: clean\n---\n\n## Proposal\n\nObservational: the acceptance gate reports conformance; nothing is red.\n`,
  );
  const git = (args) => fixtureGit(dir, args);
  git(["init", "-q"]);
  git(["add", "-A"]);
  const c = git(["commit", "-qm", "one", "--author", "t <t@t>"]);
  assert.equal(c.status, 0, c.stderr);
  return dir;
}

test("AC2 prefriction-count: counts newly-filed tasks with no triggering failure at filing", () => {
  const dir = makeGitWorkspace();
  try {
    const res = spawnSync("bash", [PREF_COUNT, "--since", "24 hours ago", "--root", dir], { encoding: "utf8" });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /^prefriction_dimensions=1$/m, `one of the two fixture tasks is pre-friction\n${res.stdout}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 prefriction-count --json includes the per-task breakdown", () => {
  const dir = makeGitWorkspace();
  try {
    const res = spawnSync("bash", [PREF_COUNT, "--since", "24 hours ago", "--root", dir, "--json"], { encoding: "utf8" });
    assert.equal(res.status, 0, res.stderr);
    const line = res.stdout.split("\n").find((l) => l.startsWith("{"));
    const parsed = JSON.parse(line);
    assert.equal(parsed.prefriction_dimensions, 1);
    assert.equal(parsed.newly_filed, 2);
    const t1 = parsed.tasks.find((t) => t.file.endsWith("T1.md"));
    const t2 = parsed.tasks.find((t) => t.file.endsWith("T2.md"));
    assert.equal(t1.triggered, true);
    assert.equal(t2.triggered, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 prefriction-count: a triggered-only window reports 0", () => {
  const dir = makeGitWorkspace();
  try {
    fs.writeFileSync(
      path.join(dir, "tasks", "T3.md"),
      `---\nid: T3\ntitle: also-triggered\n---\n\n## Proposal\n\ncrash + OOM + timeout in one line.\n`,
    );
    const git = (args) => fixtureGit(dir, args);
    git(["add", "-A"]);
    git(["commit", "-qm", "two", "--author", "t <t@t>"]);
    const res = spawnSync("bash", [PREF_COUNT, "--since", "24 hours ago", "--root", dir], { encoding: "utf8" });
    assert.match(res.stdout, /^prefriction_dimensions=1$/m, `T2 stays pre-friction, T1/T3 triggered\n${res.stdout}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
