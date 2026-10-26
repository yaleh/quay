// @test-group product
// kernel-path-ref.test.mjs — the kernel leaf `packages/quay/src/kernel/path-ref.ts` and its FIVE
// consumers across the plugin/product boundary.
// (gap-routine-semantic-dedup-scan-normalize-touched; routine semantic-dedup-scan finding
// `normalize-touched`, runId `semantic-dedup-scan-1793051606259`.)
//
// WHAT THIS FILE IS FOR. The finding was "the two plugin copies are byte-identical and the serve copy
// is the same normalization minus trim". The tempting test — "isHubFile('a/b.ts') answers a boolean" —
// passed before the fix too, three times. So the assertions are structural first and behavioral
// second, and the behavioral arm is built to DISCRIMINATE the one thing that actually differed
// between the copies (trim), rather than to re-measure that a normalizer normalizes.
//
//   ① SINGLE-SOURCE — the body lives in exactly one production file (an EXACT set, not "at most N"),
//      and the trimmed near-copy — the form both plugin files used — has zero hits. Both halves of
//      硬规则 2 are run: the non-zero needle is shown to match a known-true sample, and the zero-count
//      needle is shown NOT to match it (a malformed needle would make ① vacuous).
//   ② WIRING — all five consumers import the leaf. A re-inlined body would leave ① red; a consumer
//      that merely kept its own COPY would leave ② red; the pair is what makes "one implementation"
//      mean one implementation.
//   ③ CONTRACT — `normalizePathRef` applies exactly two rules (separators, leading `./`) and NOT
//      trim / `..`-collapse / trailing-slash strip. Those three non-rules are pinned because folding
//      any of them in would silently change one side or the other.
//   ④ PER-CALLER TRIM — the trim difference is REAL and each caller owns it: the plugin side trims
//      (a padded touched path still matches a hub), the serve side does NOT (a padded file ref does
//      not match an artifact key). This is the arm that a "move the body and add .trim() everywhere"
//      shortcut would fail, and it is measured through the two PUBLIC surfaces, not by reading source.
//   ⑤ RUNTIME — both plugin CLIs are SPAWNED, because a deleted module-scope helper is invisible to
//      imports (see the note above ⑤: it caught exactly that on this task's first round).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizePathRef } from "../src/kernel/path-ref.ts";
import { isHubFile } from "../../../plugin/scripts/suite-bucket-hub-list.ts";
import { bucketSetOfFile } from "../src/serve/feat/serve-tests.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");

/** Temp roots ④ creates, removed once after the file. */
const ROOTS = [];
after(() => {
  for (const dir of ROOTS) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  }
});

const readRepoFile = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

/** The exact text of the leaf's return statement. `String.raw` so the two literal backslashes and the
 *  `\.` in the regexes survive verbatim — a needle that has been un-escaped by the test's own string
 *  literal would silently match nothing and make ① vacuous. */
const BODY = String.raw`  return String(p).replace(/\\/g, "/").replace(/^\.\//, "");`;

/** The form the two plugin copies carried: the same body plus `.trim()`. It CONTAINS `BODY` as a
 *  prefix, which is why ①'s exact set also catches a revived copy of it. */
const BODY_TRIMMED = String.raw`  return String(p).replace(/\\/g, "/").replace(/^\.\//, "").trim();`;

/** Production trees the probe scans. `dist` is a BUILT bundle (an inlining artifact, not a second
 *  implementation), and `test`/`archive`/fixtures are outside the probe's surface — the same exclusions
 *  the finding's probe used. */
const SCAN_ROOTS = ["plugin", "packages"];
const SCAN_EXTS = new Set([".ts", ".mjs", ".js"]);
const PROBE_EXCLUDED_SEGMENTS = new Set(["node_modules", "dist", "archive", "test", "__tests__", "fixtures"]);

function walkProductionSources(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (PROBE_EXCLUDED_SEGMENTS.has(entry.name)) continue;
    if (entry.name.startsWith(".")) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walkProductionSources(abs, out);
    else if (entry.isFile()) {
      if (!SCAN_EXTS.has(path.extname(entry.name))) continue;
      if (/\.(test|spec)\.[cm]?[jt]s$/.test(entry.name)) continue;
      out.push(abs);
    }
  }
  return out;
}

/** Files whose TEXT contains `needle`, as repo-relative POSIX paths. */
function filesContaining(needle) {
  const hits = [];
  for (const root of SCAN_ROOTS) {
    for (const abs of walkProductionSources(path.join(REPO_ROOT, root))) {
      if (fs.readFileSync(abs, "utf8").includes(needle)) {
        hits.push(path.relative(REPO_ROOT, abs).split(path.sep).join("/"));
      }
    }
  }
  return hits.sort();
}

/** The finding's three instances + the two byte-identical-predicate siblings unified with them. */
const FORMER_COPIES = [
  "plugin/scripts/suite-bucket-hub-list.ts",
  "plugin/scripts/suite-bucket-select.ts",
  "packages/quay/src/serve/feat/serve-tests.ts",
  "plugin/scripts/deletion-closure-check.ts",
  "plugin/scripts/suite-bucket-drift-check.ts",
];

test("① the body exists exactly ONCE in the production tree — in the leaf, in none of the five former copies", () => {
  const hits = filesContaining(BODY);

  // EXACT set, not `<= 1`: the looser form would tolerate a re-copy in a brand-new sixth site, which
  // is the 硬规则 4c 空转 shape (a criterion that stays true while measuring nothing).
  assert.deepEqual(
    hits,
    ["packages/quay/src/kernel/path-ref.ts"],
    `the body must live in EXACTLY one production file — the kernel leaf; got: ${JSON.stringify(hits)}`,
  );

  const regressed = FORMER_COPIES.filter((f) => hits.includes(f));
  assert.deepEqual(regressed, [], `these files re-introduced a local body: ${JSON.stringify(regressed)}`);

  // 硬规则 2's zero-count half: a zero count is only evidence if the predicate is shown to fire on a
  // known-true sample. The leaf's own file IS that sample for BODY, and must NOT be one for the
  // trimmed spelling — otherwise the two needles do not discriminate and the count above proves
  // nothing about which form is present.
  const leafSrc = readRepoFile("packages/quay/src/kernel/path-ref.ts");
  assert.ok(leafSrc.includes(BODY), "the non-zero needle must match the live leaf — otherwise ①'s exact set is vacuous");
  assert.ok(!leafSrc.includes(BODY_TRIMMED), "the leaf must not carry the trimmed spelling");
});

test("① (zero-count half) the trimmed near-copy has ZERO hits in the production tree", () => {
  assert.deepEqual(filesContaining(BODY_TRIMMED), [], "no production file may re-inline the trimmed body");
});

test("② all five consumers import the kernel leaf", () => {
  const pluginSpecifier = 'from "../../packages/quay/src/kernel/path-ref.ts"';
  for (const rel of FORMER_COPIES.filter((f) => f.startsWith("plugin/"))) {
    assert.ok(readRepoFile(rel).includes(pluginSpecifier), `${rel} must import the kernel leaf across the tree (plugin → kernel)`);
  }
  // The product side imports it IN-PACKAGE (and may never import `plugin/**` — the reverseEdges
  // ratchet — which is why the leaf has to live in kernel/ rather than in the mechanism layer).
  assert.ok(
    readRepoFile("packages/quay/src/serve/feat/serve-tests.ts").includes('from "../../kernel/path-ref.ts"'),
    "packages/quay/src/serve/feat/serve-tests.ts must import the kernel leaf in-package",
  );
});

test("③ contract: exactly the two rules — no trim, no '..' collapse, no trailing-slash strip", () => {
  assert.equal(normalizePathRef("./a/b.ts"), "a/b.ts", "a leading ./ is stripped");
  assert.equal(normalizePathRef(".\\a\\b.ts"), "a/b.ts", "separators become / BEFORE the ./ rule, so `.\\x` is stripped too");
  assert.equal(normalizePathRef("a\\b\\c.ts"), "a/b/c.ts", "backslashes become /");

  // The three NON-rules. Each is pinned because folding it into the leaf would silently change one
  // caller's keys: the serve page's artifact keys are written un-trimmed, and the plugin side's hub
  // match has no `..`/trailing-slash step of its own either.
  assert.equal(normalizePathRef("a.ts  "), "a.ts  ", "trim is the CALLER's step, never the leaf's");
  // Ordering matters and is preserved from the former copies: the `./` rule is applied BEFORE the
  // caller's trim, so a LEADING space (not a trailing one) still shields the `./`. Recorded rather
  // than "fixed" — changing the order would change what the callers already do.
  assert.equal(normalizePathRef("  ./a.ts"), "  ./a.ts", "a leading space shields the ./ rule (normalize → then caller trims)");
  assert.equal(normalizePathRef("a/../b.ts"), "a/../b.ts", "'..' is NOT collapsed (that is gate-script-base's normalizeRel)");
  assert.equal(normalizePathRef("a/b/"), "a/b/", "a trailing '/' is NOT stripped (driver-filters/select-static do that themselves)");
});

test("④ per-caller trim is real: the plugin surface trims, the serve surface does not", () => {
  // Plugin side — a touched path carrying TRAILING whitespace and a leading `./` still names a hub,
  // because suite-bucket-hub-list.ts trims the leaf's answer (HUB_PATTERNS are anchored, so without
  // that trim the padded path would miss).
  assert.equal(isHubFile("./plugin/scripts/full-suite-runner.ts   "), true, "the plugin caller must trim (anchored hub pattern still matches)");
  assert.equal(isHubFile(".\\plugin\\scripts\\full-suite-runner.ts"), true, "the plugin caller must accept windows separators");
  // Negative control: the same surface answers FALSE for a non-hub, so the two `true`s above are the
  // hub decision and not a predicate that always says yes.
  assert.equal(isHubFile("./plugin/scripts/suite-bucket-select.ts"), false, "a non-hub path must NOT match");

  // Serve side — read through the PUBLIC `bucketSetOfFile`, against a real artifact fixture on disk.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kernel-path-ref-"));
  ROOTS.push(root);
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".quay", "suite-bucket-effective.jsonl"),
    JSON.stringify({ file: "pkg/a.test.mjs", buckets: ["P"] }) + "\n",
  );

  assert.deepEqual([...bucketSetOfFile("./pkg/a.test.mjs", root)], ["P"], "the serve caller strips a leading ./");
  assert.deepEqual([...bucketSetOfFile("pkg\\a.test.mjs", root)], ["P"], "the serve caller accepts windows separators");
  // The discriminating arm: the SAME padded input resolves on the plugin side and must NOT resolve
  // here — proving the two callers' policies are genuinely different rather than both passing by
  // sharing whatever the leaf happened to do.
  assert.deepEqual([...bucketSetOfFile(" pkg/a.test.mjs", root)], [], "the serve caller must NOT trim (keys are un-trimmed)");
  assert.deepEqual([...bucketSetOfFile("pkg/b.test.mjs", root)], [], "negative control: an absent key resolves empty");
});

// ── ⑤ THE SPAWN ARM — why ①–④ cannot replace it ──────────────────────────────────────────────────
// ①–④ are measured INSIDE this process. A consumer can be perfectly wired (②) and still be UNRUNNABLE
// in its own PROCESS: this change deleted a module-level `normalizeTouched` that two CLI entry paths
// (`positional.map(normalizeTouched)`) still referenced. No import resolves those references, so ①–④
// stayed green while `node suite-bucket-hub-list.ts <path>` would have died with a
// `ReferenceError: normalizeTouched is not defined`. (Same failure family the kernel-leaf load-avg
// task recorded: a re-export that binds only the export table creates no module-scope binding.)
// Both CLIs are therefore RUN, not imported.
test("⑤ both plugin CLIs still RUN against a positional path (a deleted module-scope helper cannot hide here)", () => {
  const run = (file, args) => spawnSync(process.execPath, ["--experimental-strip-types", file, ...args], {
    cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000,
  });

  const hub = run("plugin/scripts/suite-bucket-hub-list.ts", ["./plugin/scripts/full-suite-runner.ts"]);
  assert.equal(hub.status, 0, `suite-bucket-hub-list.ts must exit 0; stderr=${hub.stderr}`);
  assert.equal(hub.stdout.trim(), "full", "the ./ + trim caller must still classify a hub path as full-suite");

  const sel = run("plugin/scripts/suite-bucket-select.ts", ["./plugin/scripts/full-suite-runner.ts", "--summary"]);
  assert.equal(sel.status, 0, `suite-bucket-select.ts must exit 0; stderr=${sel.stderr}`);
  assert.match(sel.stdout, /buckets=full/, "the select CLI's positional normalization path must still run");
});
