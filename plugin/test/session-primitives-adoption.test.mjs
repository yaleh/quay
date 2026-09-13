// @test-group engine
// session-primitives-adoption.test.mjs — did the four shared session primitives actually get ADOPTED
// by this repo, or were they merely copied in? (tasks/gap-ac253-session-primitives-shared-layer-adoption.)
//
// WHY THIS TEST IS STRONGER THAN THE AC-253 CRITERION: the criterion's consumer half is
// `git grep -l -E "(pty-frame|delivery-audit|session-liveness|session-schema)" -- packages/quay/src
// plugin/scripts` and then only requires the result to be NON-EMPTY. So one name appearing once in
// one non-test file satisfies it — copy four modules in, import one, and the machine criterion is
// green while the other three are vendored dead code. SPEC §3.3's intent (GOAL risk 3: 「「有消费者」
// 这一半是防伪」) is that EACH module is really used. This test asks it per module, and rejects the
// two fake shapes AC3 names: the module's own header comment mentioning itself, and a SIBLING
// primitive importing it (delivery-audit.mjs → pty-frame.mjs proves nothing about this repo).
//
// Run: node --test plugin/test/session-primitives-adoption.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const PRIMITIVES_REL = "packages/quay/src/primitives";
const PRIMITIVES_ABS = path.join(REPO_ROOT, PRIMITIVES_REL);
const MANIFEST_ABS = path.join(REPO_ROOT, "plugin", "scripts", "primitives-drift-manifest.json");

const MODULES = ["pty-frame.mjs", "delivery-audit.mjs", "session-liveness.mjs", "session-schema.mjs"];

/**
 * The pinned expectations, per module. Enumerated on purpose: a discovered-only check would silently
 * shrink to nothing if a consumer were deleted, and this test must FAIL when a module loses its last
 * real consumer (that is the "vendored dead code" state the criterion is meant to catch).
 */
const EXPECTED_CONSUMERS = {
  "pty-frame.mjs": ["packages/quay/src/serve-send.ts"],
  "delivery-audit.mjs": ["packages/quay/src/serve-send.ts"],
  "session-liveness.mjs": [
    "packages/quay/src/observation.ts",
    "plugin/scripts/orphan-session-check.ts",
    "plugin/scripts/peer-identity-probe.ts",
    "plugin/scripts/inner-blocked-signal.ts",
  ],
  "session-schema.mjs": ["packages/quay/src/observation.ts"],
};

const SEARCH_DIRS = ["packages/quay/src", "plugin/scripts"];

/** Every .ts/.mjs/.js file under the search dirs, excluding tests and the primitives dir itself. */
function candidateFiles() {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "dist") continue;
        walk(abs);
        continue;
      }
      if (!/\.(ts|mjs|js)$/.test(e.name)) continue;
      if (/\.test\.mjs$/.test(e.name)) continue;
      const rel = path.relative(REPO_ROOT, abs);
      if (rel.startsWith(PRIMITIVES_REL)) continue; // sibling modules never count (AC3)
      out.push(rel);
    }
  };
  for (const d of SEARCH_DIRS) walk(path.join(REPO_ROOT, d));
  return out;
}

/** Files that import `name` via a real module SPECIFIER (position-based, not a keyword hit). */
function importersOf(name) {
  const spec = new RegExp(`(?:from\\s*|import\\s*\\(\\s*)["'\`][^"'\`]*${name.replace(".", "\\.")}["'\`]`);
  return candidateFiles().filter((rel) => spec.test(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8")));
}

test("AC2 — all four primitives are present at packages/quay/src/primitives/<name>.mjs", () => {
  for (const m of MODULES) {
    assert.ok(fs.existsSync(path.join(PRIMITIVES_ABS, m)), `${m} is present in the primitives dir`);
  }
});

test("AC3 — EACH module has ≥1 non-test consumer under packages/quay/src or plugin/scripts (4/4, not 'any non-empty')", () => {
  const report = {};
  for (const m of MODULES) {
    const found = importersOf(m);
    report[m] = found;
    assert.ok(found.length > 0, `${m} has NO non-test importer — it is vendored dead code, not adopted`);
    for (const expected of EXPECTED_CONSUMERS[m]) {
      assert.ok(
        found.includes(expected),
        `${m} must be imported by ${expected}; found: ${found.join(", ")}`,
      );
    }
  }
  // The negative control for the sibling exclusion: delivery-audit.mjs DOES import pty-frame.mjs, and
  // that must not be what satisfies pty-frame's requirement — a product/script file must be in there.
  for (const m of MODULES) {
    assert.ok(
      report[m].some((f) => f.startsWith("packages/quay/src/") || f.startsWith("plugin/scripts/")),
      `${m}: only sibling/primitive importers were found`,
    );
    assert.ok(
      !report[m].every((f) => f.startsWith(PRIMITIVES_REL)),
      `${m}: the primitives dir cannot be its own consumer`,
    );
  }
});

test("AC2 — every copy is byte-identical to the pinned quay-fleet blob (skipped, never faked, when the fleet repo is unreachable)", (t) => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_ABS, "utf8"));
  if (!fs.existsSync(manifest.fleetRepo)) {
    // Honest NOT-EVALUATED: the fleet checkout is not on this machine. ⛔ Do NOT pass — a green here
    // would assert byte-identity for a comparison that never happened (硬规则 3b / 4 推论三).
    t.skip(`fleet repo absent (${manifest.fleetRepo}) — byte-identity NOT-EVALUATED, not proven`);
    return;
  }
  const recorded = manifest.files;
  assert.deepEqual(Object.keys(recorded).sort(), [...MODULES].sort(), "the manifest pins exactly the four modules");
  for (const m of MODULES) {
    const localSha = crypto.createHash("sha256").update(fs.readFileSync(path.join(PRIMITIVES_ABS, m))).digest("hex");
    assert.equal(localSha, recorded[m], `${m}: local copy matches the manifest pin`);
    let blob;
    try {
      blob = execFileSync("git", ["-C", manifest.fleetRepo, "show", `${manifest.fleetSha}:${manifest.fleetSourceDir}/${m}`], { maxBuffer: 16 * 1024 * 1024 });
    } catch (err) {
      t.skip(`pinned SHA ${manifest.fleetSha} unreadable in ${manifest.fleetRepo} — NOT-EVALUATED`);
      return;
    }
    const fleetSha = crypto.createHash("sha256").update(blob).digest("hex");
    assert.equal(fleetSha, recorded[m], `${m}: fleet blob at the pinned SHA matches the pin (no fork)`);
  }
});

test("AC3 — the replaced hand-written copies are GONE (0 hits each; the residual is named, not hidden)", () => {
  const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

  // 1. orphan-session-check.ts: the local field-22 parse (`tail[19]` after the LAST ')') is replaced.
  const orphan = read("plugin/scripts/orphan-session-check.ts");
  assert.equal((orphan.match(/tail\[19\]/g) ?? []).length, 0, "orphan-session-check: local field-22 parse removed");
  assert.match(orphan, /readProcStat/, "orphan-session-check: reads through the shared primitive");

  // 2. inner-blocked-signal.ts: the local `fs.statSync(<transcript>).mtimeMs` read is replaced.
  const inner = read("plugin/scripts/inner-blocked-signal.ts");
  assert.equal(
    (inner.match(/fs\.statSync\(transcriptPath\)\.mtimeMs/g) ?? []).length, 0,
    "inner-blocked-signal: local transcript-mtime read removed",
  );
  assert.match(inner, /readTranscriptMtime/, "inner-blocked-signal: reads the mtime through the shared primitive");

  // 3. peer-identity-probe.ts: the PRODUCTION path routes through the shared reader. The pure
  //    `parseProcStart(content)` helper deliberately REMAINS as the injectable test seam (the shared
  //    reader is pinned to the real /proc and offers no content-injection seam) — this assertion
  //    pins that it is no longer the production read.
  const probe = read("plugin/scripts/peer-identity-probe.ts");
  assert.match(probe, /io === \(fs as unknown as FactIo\)/, "peer-identity-probe: production path branches to the shared reader");
  assert.match(probe, /readProcStat/, "peer-identity-probe: imports the shared primitive");
});

test("AC3 — pty-frame's lane: the repo really has no pre-existing binary-frame consumer (the lane was built, not swapped)", () => {
  // The Plan's step-4 measurement, re-run as a test so the claim cannot silently rot. If a pty.sock
  // consumer ever appears in the repo this assertion flips, which is the signal that the lane below
  // should be re-pointed at it instead.
  // Measured against the tree BEFORE this task, not the working tree: the lane we added is itself a
  // pty.sock consumer, so searching today's files would report our own work as a pre-existing hit and
  // the assertion would be self-defeating. The base = the parent of the commit that ADDED
  // primitives/pty-frame.mjs; before that commit lands (i.e. while this test runs in the task
  // worktree) the tree at HEAD is still the base, which is the same measurement.
  const addCommit = execFileSync(
    "git", ["log", "--diff-filter=A", "--format=%H", "-1", "--", `${PRIMITIVES_REL}/pty-frame.mjs`],
    { cwd: REPO_ROOT, encoding: "utf8" },
  ).trim();
  const base = addCommit ? `${addCommit}^` : "HEAD";
  // `git grep` exits 1 on "no match" — which is the expected outcome here, so it must not be thrown
  // away as an error (nor silently read as "the grep failed": the two are distinguishable by status).
  let grep = "";
  try {
    grep = execFileSync("git", ["grep", "-l", "-E", "pty\\.sock|bg-pty-host", base, "--", "packages", "plugin"], { cwd: REPO_ROOT, encoding: "utf8" });
  } catch (err) {
    assert.equal(err.status, 1, `git grep failed for a reason other than 'no match': ${err.message}`);
  }
  const hits = grep.split("\n").filter((l) => l.trim());
  assert.equal(
    hits.length, 0,
    `no pre-existing pty.sock/bg-pty-host consumer expected in the base tree (${base}); found: ${hits.join(", ")}`,
  );
  // …and the lane that DOES consume the frame codec is serve-send.ts's sendKeysToSession.
  const serveSend = fs.readFileSync(path.join(REPO_ROOT, "packages/quay/src/serve-send.ts"), "utf8");
  assert.match(serveSend, /export function sendKeysToSession/, "the L2 keys lane is exported");
  assert.match(serveSend, /encodeCtrl|encodeData|decodeFrames/, "the lane uses the shared frame codec");
});

test("AC5 负控制 — a FOLDED session record is rejected; the two-dimension record is accepted", async () => {
  const { validateSessionRecord } = await import(
    path.join(PRIMITIVES_ABS, "session-schema.mjs")
  );

  // The AC-001 counter-example, in THIS repo's vocabulary: one top-level `status` standing in for
  // both dimensions. This is the exact fold `claude agents --json` performs (registry `shell` folded
  // into `busy`) and the exact fold this repo's session surface used to render (`alive: boolean`).
  const folded = {
    status: "busy",
    sessionKeyScope: "local-only",
    lifecycle: { value: "working", source: "registry row", observedAt: 1 },
    activity: { value: "busy", source: "registry row", ageSec: 0 },
  };
  const bad = validateSessionRecord(folded);
  assert.equal(bad.valid, false, "a folded top-level `status` must be invalid");
  assert.ok(bad.errors.some((e) => /folded top-level `status`/.test(e)), `the refusal names the fold: ${bad.errors.join(" | ")}`);

  // Drop the fold and supply both dimensions with their own source + timestamp ⇒ valid.
  const { status, ...unfolded } = folded;
  assert.equal(status, "busy", "fixture sanity: the field really was removed");
  const good = validateSessionRecord(unfolded);
  assert.equal(good.valid, true, `the two-dimension record must be valid; errors: ${good.errors.join(" | ")}`);

  // A third reading, so the validator cannot be a constant: dropping ONE dimension's source is
  // invalid too — the value set alone is not what it checks.
  const noSource = { ...unfolded, lifecycle: { ...unfolded.lifecycle, source: "" } };
  assert.equal(validateSessionRecord(noSource).valid, false, "a dimension without a source is invalid");
});

test("AC5 — observation.ts runs the validator at its output boundary and refuses to render a folded record", () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, "packages/quay/src/observation.ts"), "utf8");
  // The consumer is a real gate, not an import kept for show: the validator's verdict decides
  // whether `session` is attached, and the refusal carries the validator's own reasons.
  assert.match(src, /validateSessionRecord\(/, "observation.ts calls the shared validator");
  assert.match(src, /sessionRefusal: verdict\.errors/, "a refused record carries the validator's reasons");
  const sessions = fs.readFileSync(path.join(REPO_ROOT, "packages/quay/src/serve-sessions.ts"), "utf8");
  assert.match(sessions, /状态记录不可用/, "the render surface shows the refusal instead of a folded value");
});
