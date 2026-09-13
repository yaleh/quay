// @test-group engine
// gitignore-runtime-coverage-check.test.mjs — the anti-drift check binding quay's marked
// runtime-artifact `.gitignore` entries to the manifest quay-init writes into a consumer project.
// (tasks/gap-quay-init-gitignore-misses-quay-runtime-artifacts-outside-dot-quay; AC3 双向控制)
//
// WHY THE BINDING IS THE PRODUCT (not the list): the defect this closes was a consumer project whose
// `.gitignore` lacked `**/.quay-parse-cache.json` / `milestones/fast-mode-telemetry/*.json`, so merely
// READING the task store dirtied the tree and the mechanical fan-in's `ff` failed for every task. The
// pre-existing repair was two hand-added lines in that one project — which leaves the generator (the
// init template) drifting for the next consumer. So this suite pins the CHECK, not the entries:
//   * 判据1 (green on the real repo, NON-VACUOUS) — the real `.gitignore`'s marked set equals the real
//     manifest, AND the set is non-empty. An empty-set comparison would pass vacuously, which is the
//     "a structurally-always-green check is worse than no check" family (硬规则 3b/4) — hence the
//     explicit `> 0` assertion on both sides.
//   * 判据2 (RED side of the AC3 double control) — a temp root whose `.gitignore` marks ONE MORE
//     runtime artifact than the manifest carries exits 1 and NAMES that pattern. This is the exact
//     "someone added a marked entry and did not update what init writes" drift.
//   * 判据3 (the reverse direction) — a manifest entry with no matching marker exits 1 as an
//     unreferenced rule.
//   * 判据4 (能取假 / 硬规则 3b) — an unreadable manifest is NOT-EVALUATED (exit 3) with `--json`
//     status "not-evaluated", i.e. distinguishable from the exit-0 PASS. A checker that conflates
//     "read the inputs and found them consistent" with "could not read the inputs" is the defect.
//   * 判据5 (position, not keyword — 硬规则 2) — prose that MENTIONS the artifact (a comment above a
//     blank line, or a mention inside an unrelated comment) marks nothing; only a marker comment
//     DIRECTLY above a pattern line counts.
//
// Run:
//   scripts/test.sh plugin/test/gitignore-runtime-coverage-check.test.mjs
//   node --test plugin/test/gitignore-runtime-coverage-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  MARKER_TOKEN,
  MANIFEST_REL,
  parseManifest,
  parseMarkedPatterns,
  checkCoverage,
} from "../scripts/gitignore-runtime-coverage-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECKER = path.join(REPO_ROOT, "plugin", "scripts", "gitignore-runtime-coverage-check.ts");

function runChecker(root, extra = []) {
  return spawnSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", CHECKER, "--root", root, ...extra],
    { encoding: "utf8", timeout: 30_000 },
  );
}

/** A hermetic root: `.gitignore` + manifest, both written from the caller's strings. */
function makeRoot({ gitignore, manifest }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gitignore-runtime-coverage-"));
  fs.mkdirSync(path.join(dir, path.dirname(MANIFEST_REL)), { recursive: true });
  if (gitignore !== null) fs.writeFileSync(path.join(dir, ".gitignore"), gitignore);
  if (manifest !== null) fs.writeFileSync(path.join(dir, MANIFEST_REL), manifest);
  return dir;
}

// ── 判据1: the real repo is green, and the green is NOT vacuous ───────────────────────────────────

test("judged-1: quay's own marked .gitignore set equals the manifest, and neither side is empty", () => {
  const r = runChecker(REPO_ROOT);
  assert.equal(r.status, 0, `expected PASS on the real repo, got exit ${r.status}: ${r.stdout}${r.stderr}`);

  const marked = parseMarkedPatterns(fs.readFileSync(path.join(REPO_ROOT, ".gitignore"), "utf8"));
  const manifest = parseManifest(fs.readFileSync(path.join(REPO_ROOT, MANIFEST_REL), "utf8"));
  assert.ok(marked.length > 0, "the marked set on the real .gitignore is EMPTY — the check is passing vacuously");
  assert.ok(manifest.length > 0, "the manifest is EMPTY — the check is passing vacuously");
  assert.deepEqual([...marked].sort(), [...manifest].sort());
  // The two patterns whose absence on a real third-party project blocked a green task's ff.
  assert.ok(marked.includes("**/.quay-parse-cache.json"), "the parse cache (written under <tasksDir>/) must be in the manifest");
  assert.ok(marked.includes("milestones/fast-mode-telemetry/*.json"), "fast-mode telemetry must be in the manifest");
});

// ── 判据2: RED — a marked runtime artifact the manifest does not carry ────────────────────────────

test("judged-2: a marked pattern absent from the manifest REDs and names it (AC3 negative control)", () => {
  const dir = makeRoot({
    gitignore: [
      `# ${MARKER_TOKEN} — quay-init writes this into a consumer .gitignore`,
      "**/.quay-parse-cache.json",
      `# ${MARKER_TOKEN} — quay-init writes this into a consumer .gitignore`,
      "orchestration/new-runtime-ledger.jsonl",
    ].join("\n"),
    manifest: "**/.quay-parse-cache.json\n",
  });
  const r = runChecker(dir);
  assert.equal(r.status, 1, `expected RED, got exit ${r.status}: ${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /orchestration\/new-runtime-ledger\.jsonl/);
  assert.match(r.stdout, /ABSENT from/);

  // The pure judgment (the same one the CLI ran) reports exactly the one drifting pattern.
  const res = checkCoverage(
    parseMarkedPatterns(fs.readFileSync(path.join(dir, ".gitignore"), "utf8")),
    parseManifest(fs.readFileSync(path.join(dir, MANIFEST_REL), "utf8")),
  );
  assert.equal(res.ok, false);
  assert.deepEqual(res.missingFromManifest, ["orchestration/new-runtime-ledger.jsonl"]);
  assert.deepEqual(res.undeclaredInGitignore, []);
});

// ── 判据3: RED — the reverse direction (manifest rule nobody marked) ──────────────────────────────

test("judged-3: a manifest entry with no marker in .gitignore REDs as an unreferenced rule", () => {
  const dir = makeRoot({
    gitignore: `# ${MARKER_TOKEN} — quay-init writes this into a consumer .gitignore\n**/.quay-parse-cache.json\n`,
    manifest: "**/.quay-parse-cache.json\nmilestones/fast-mode-telemetry/*.json\n",
  });
  const r = runChecker(dir);
  assert.equal(r.status, 1, `expected RED, got exit ${r.status}: ${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /milestones\/fast-mode-telemetry\/\*\.json/);
  assert.match(r.stdout, /NOT marked/);
  // Dropping the unmarked rule from the manifest makes the SAME root green — the red was the rule,
  // not the fixture (a one-line discriminating control).
  fs.writeFileSync(path.join(dir, MANIFEST_REL), "**/.quay-parse-cache.json\n");
  assert.equal(runChecker(dir).status, 0, "removing the unmarked rule must turn the same root green");
});

// ── 判据4: NOT-EVALUATED is distinguishable from PASS (硬规则 3b) ──────────────────────────────────

test("judged-4: an unreadable manifest is NOT-EVALUATED (exit 3), never a silent PASS", () => {
  const dir = makeRoot({
    gitignore: `# ${MARKER_TOKEN}\n**/.quay-parse-cache.json\n`,
    manifest: null, // manifest absent
  });
  const r = runChecker(dir);
  assert.equal(r.status, 3, `expected NOT-EVALUATED, got exit ${r.status}: ${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /NOT-EVALUATED/);

  const rj = runChecker(dir, ["--json"]);
  assert.equal(rj.status, 3);
  const parsed = JSON.parse(rj.stdout);
  assert.equal(parsed.status, "not-evaluated");
  assert.equal(parsed.ok, false);
  assert.ok(parsed.message.length > 0);

  // A missing `.gitignore` is NOT-EVALUATED too — not "nothing marked ⇒ covered".
  const dir2 = makeRoot({ gitignore: null, manifest: "**/.quay-parse-cache.json\n" });
  assert.equal(runChecker(dir2).status, 3);
});

test("judged-4b: --json on the green path emits parseable JSON with the two sets", () => {
  const r = runChecker(REPO_ROOT, ["--json"]);
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.status, "pass");
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.marked, parsed.manifest);
  assert.ok(parsed.marked.length > 0);
});

// ── 判据5: position, not keyword (硬规则 2) ───────────────────────────────────────────────────────

test("judged-5: only a marker DIRECTLY above a pattern marks it; prose never does", () => {
  const text = [
    "# This comment MENTIONS the runtime artifact `.quay-parse-cache.json` but is not a marker.",
    "docs/notes.md",
    "",
    `# ${MARKER_TOKEN} — but a BLANK line separates the marker from the pattern, so it marks nothing`,
    "",
    "orchestration/separated.jsonl",
    `# ${MARKER_TOKEN} — quay-init writes this into a consumer .gitignore`,
    "orchestration/adjacent.jsonl",
    "# a plain comment line directly above this one (no marker token)",
    "orchestration/plain.jsonl",
    "   ",
  ].join("\n");
  assert.deepEqual(parseMarkedPatterns(text), ["orchestration/adjacent.jsonl"]);
});

test("judged-5b: a marker above a comment the pattern does not sit under marks nothing", () => {
  // The marker is directly above a COMMENT (which is not a pattern) — the pattern two lines below has
  // an unmarked comment directly above it, so it is NOT marked. Only adjacency to the pattern counts.
  const text = [`# ${MARKER_TOKEN}`, "# a comment, not a pattern", "orchestration/not-marked.jsonl"].join("\n");
  assert.deepEqual(parseMarkedPatterns(text), []);
  assert.deepEqual(parseManifest("# header\n\n**/.quay-parse-cache.json\n# trailing comment\n.workflow-events/\n"), [
    "**/.quay-parse-cache.json",
    ".workflow-events/",
  ]);
});
