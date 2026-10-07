// @test-group engine
// start-end-like-ssot.test.mjs — pins the SINGLE definition of fast-mode start/end classification
// (gap-routine-semantic-dedup-scan-is-start-end-like-cross-surface, routine `semantic-dedup-scan`,
// finding `is-start-end-like-cross-surface`).
//
// THE DEFECT THIS FILE EXISTS TO STOP FROM COMING BACK: `plugin/scripts/fast-mode-telemetry.ts`'s
// `aggregate()` and `packages/quay/src/observation.ts`'s `pairInFlight()` each carried a
// byte-identical local copy of `isStartLike`/`isEndLike`. observation.ts DOCUMENTED itself as an
// "EXACT mirror" of the telemetry aggregate, and fast-mode-telemetry.ts documented the same in the
// other direction — but no test named either predicate, so the two readers of the SAME
// `.workflow-events/*.jsonl` store could drift apart silently. The routine's dedup probe saw the
// duplication; nothing saw a DIVERGENCE.
//
// ⛔ WHY IDENTITY ALONE WOULD BE A TAUTOLOGY (硬规则 4): once both consumers re-export the Core
// leaf, `tel.isStartLike === core.isStartLike` is true by construction for any state of the world
// in which the re-export exists — it cannot distinguish "shared" from "shared". The load-bearing
// assertion is therefore the DECLARATION-SITE COUNT (③): it goes red the moment a local copy is
// pasted back into either consumer, which is exactly the mutation that produced this finding. The
// identity check (②) and the behavioral oracle (④) are corroboration, not the measure.
//
// Run:
//   scripts/test.sh plugin/test/start-end-like-ssot.test.mjs
//   node --test plugin/test/start-end-like-ssot.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// REPO_ROOT must resolve to the same directory regardless of where this test lives.
function _findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, ".quay", "config.yml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Cannot find repo root: no .quay/config.yml found upward from " + startDir);
}
const REPO_ROOT = _findRepoRoot(__dirname);

const LEAF_REL = "packages/quay/src/start-end-like.ts";
const CORE_CONSUMER_REL = "packages/quay/src/observation.ts";
const PLUGIN_CONSUMER_REL = "plugin/scripts/fast-mode-telemetry.ts";

/** The two scanned surfaces — the plugin execution path and the Core read path. */
const SCAN_DIRS = ["plugin/scripts", "packages/quay/src"];

/** Declaration predicate — a top-level `function <name>(`, optionally `export function`. */
function declarationRe(name) {
  return new RegExp(`^(?:export\\s+)?function\\s+${name}\\s*\\(`, "m");
}

/**
 * Every `.ts` file under the scanned surfaces whose source DECLARES `name` (by position: a real
 * top-level `function` declaration line), as repo-relative paths sorted for a stable message.
 */
function declarationSites(name) {
  const hits = [];
  for (const rel of SCAN_DIRS) {
    const abs = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    for (const entry of fs.readdirSync(abs, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".ts")) continue;
      const file = path.join(entry.parentPath ?? entry.path, entry.name);
      if (file.endsWith(".test.ts")) continue;
      const src = fs.readFileSync(file, "utf8");
      if (declarationRe(name).test(src)) hits.push(path.relative(REPO_ROOT, file));
    }
  }
  return hits.sort();
}

// ── ① The predicate can fire at all (硬规则 2's zero-count half) ─────────────────────────────────
// A scan that reports "0 extractions elsewhere" is worthless if the predicate could not have
// matched ANYTHING. Dry-run it against a sample known to be true — and against one known to be
// false — before trusting any count below.
test("① the declaration predicate matches a real declaration and rejects a non-declaration", () => {
  assert.equal(declarationRe("isStartLike").test("function isStartLike(e) {\n"), true);
  assert.equal(declarationRe("isStartLike").test("export function isStartLike(e: X) {\n"), true);
  // Known-false samples: a CALL site, a re-export, a comment mention, a differently-named function.
  assert.equal(declarationRe("isStartLike").test("  } else if (isStartLike(e)) {\n"), false);
  assert.equal(declarationRe("isStartLike").test("export { isStartLike, isEndLike };\n"), false);
  assert.equal(declarationRe("isStartLike").test("// mirrors isStartLike in the other file\n"), false);
  assert.equal(declarationRe("isStartLike").test("function isStartLikeX(e) {\n"), false);
});

// ── ②/③ The measure: exactly ONE declaration site, and it is the Core leaf ──────────────────────
for (const name of ["isStartLike", "isEndLike"]) {
  test(`② SSOT — ${name} is DECLARED in exactly one place (${LEAF_REL})`, () => {
    const sites = declarationSites(name);
    assert.deepEqual(
      sites,
      [LEAF_REL],
      `${name} must have exactly ONE declaration point — actual declarations: ` +
        `${JSON.stringify(sites)}. A second entry means a local copy was pasted back into a ` +
        `consumer instead of importing the Core leaf (that is the exact regression this task fixed).`,
    );
  });

  test(`③ the two consumers IMPORT ${name} rather than declaring it`, () => {
    for (const rel of [CORE_CONSUMER_REL, PLUGIN_CONSUMER_REL]) {
      const src = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
      assert.equal(
        declarationRe(name).test(src),
        false,
        `${rel} must not DECLARE ${name} — import it from ${LEAF_REL}`,
      );
      assert.match(
        src,
        new RegExp(`\\b${name}\\b`),
        `${rel} must reference ${name} (it is a consumer of the shared predicate)`,
      );
    }
  });
}

// ── ④ Runtime cross-boundary identity (corroboration) ───────────────────────────────────────────
test("④ both consumers resolve to the SAME function object as the Core leaf", async () => {
  const core = await import(path.join(REPO_ROOT, LEAF_REL));
  const obs = await import(path.join(REPO_ROOT, CORE_CONSUMER_REL));
  const tel = await import(path.join(REPO_ROOT, PLUGIN_CONSUMER_REL));
  for (const name of ["isStartLike", "isEndLike"]) {
    assert.equal(typeof core[name], "function", `leaf must export ${name}`);
    assert.equal(tel[name], core[name], `plugin consumer's ${name} must be the leaf's own function`);
    assert.equal(obs[name], core[name], `Core consumer's ${name} must be the leaf's own function`);
  }
});

// ── ⑤ Behavioral oracle — an independently stated table, asserted through all THREE entry points ─
// The contract, stated as the code actually behaves (NOT as the old doc comments paraphrased it):
//   a truthy `timing` is required FIRST; only then does `eventKind` short-circuit.
//   start-like = timing && (eventKind === "start" || (startedAtMs != null && endedAtMs == null))
//   end-like   = timing && (eventKind === "end"   ||  endedAtMs != null)
// ⚠️ The original doc comments in BOTH consumers said "start-like = eventKind === 'start' OR …",
// omitting the `timing` precondition. This table was written from that paraphrase and went RED on
// the first run ("eventKind start, no timing at all" expected true, got false) — which is the
// clean demonstration that the paraphrase was wrong and that this oracle measures the real thing.
const ORACLE = [
  // [label, event, expectedStartLike, expectedEndLike]
  ["plain start (both markers agree)", { eventKind: "start", timing: { startedAtMs: 1, endedAtMs: null } }, true, false],
  ["plain end", { eventKind: "end", timing: { startedAtMs: 1, endedAtMs: 2 } }, false, true],
  // DEFECT-4's whole point: eventKind absent, classification still works off timing alone.
  ["no eventKind, open timing (hand-edited/legacy)", { timing: { startedAtMs: 1, endedAtMs: null } }, true, false],
  ["no eventKind, closed timing", { timing: { startedAtMs: 1, endedAtMs: 2 } }, false, true],
  // ⚠️ THE PRECONDITION: eventKind WITHOUT a timing object is classified as NEITHER. This is the
  // arm the old doc comments got wrong; it is what stops a future "hoist the eventKind check
  // above the guard" simplification from landing silently.
  ["eventKind start, timing absent", { eventKind: "start" }, false, false],
  ["eventKind end, timing absent", { eventKind: "end" }, false, false],
  ["eventKind start, timing null", { eventKind: "start", timing: null }, false, false],
  ["eventKind end, timing undefined", { eventKind: "end", timing: undefined }, false, false],
  // …but a truthy timing object IS enough for the short-circuit, even if empty.
  ["eventKind start, empty timing object", { eventKind: "start", timing: {} }, true, false],
  // eventKind SHORT-CIRCUITS once timing is present — and it is PER-PREDICATE, not a mode switch:
  // `eventKind: "end"` says nothing about isStartLike, which then falls through to the markers.
  ["eventKind start, timing says closed (isStartLike short-circuits)", { eventKind: "start", timing: { startedAtMs: 1, endedAtMs: 2 } }, true, true],
  ["eventKind end, open timing (only isEndLike short-circuits)", { eventKind: "end", timing: { startedAtMs: 1, endedAtMs: null } }, true, true],
  // The impl-complete boundary: all-null timing ⇒ NEITHER start-like nor end-like.
  ["impl-complete boundary (all-null timing)", { eventKind: "impl-complete", timing: { startedAtMs: null, endedAtMs: null } }, false, false],
  // Malformed / untyped records are never classified (and never thrown on).
  ["empty object", {}, false, false],
  ["unrelated eventKind with timing", { eventKind: "blocked", timing: { startedAtMs: 1, endedAtMs: 2 } }, false, true],
  ["null event", null, false, false],
  ["undefined event", undefined, false, false],
];

test("⑤ both entry points classify the full oracle table identically (parity)", async () => {
  const core = await import(path.join(REPO_ROOT, LEAF_REL));
  const tel = await import(path.join(REPO_ROOT, PLUGIN_CONSUMER_REL));
  const obs = await import(path.join(REPO_ROOT, CORE_CONSUMER_REL));
  for (const [label, ev, wantStart, wantEnd] of ORACLE) {
    for (const [who, mod] of [["leaf", core], ["plugin", tel], ["core-consumer", obs]]) {
      assert.equal(
        mod.isStartLike(ev),
        wantStart,
        `${who}.isStartLike(${label}) must be ${wantStart} (oracle: ${label})`,
      );
      assert.equal(
        mod.isEndLike(ev),
        wantEnd,
        `${who}.isEndLike(${label}) must be ${wantEnd} (oracle: ${label})`,
      );
    }
  }
});

// ── ⑥ The routine's own finding is not re-filed: no second byte-identical body survives ─────────
test("⑥ no consumer carries a copy of the leaf's predicate bodies", () => {
  const leafSrc = fs.readFileSync(path.join(REPO_ROOT, LEAF_REL), "utf8");
  // The two body lines the dedup probe keys on — the timing-marker disjunction and the
  // end-marker presence test. A copy of the predicate necessarily carries both verbatim.
  const needles = [
    "e.timing.startedAtMs != null && e.timing.endedAtMs == null",
    'if (e.eventKind === "end") return true;',
  ];
  for (const needle of needles) {
    assert.ok(leafSrc.includes(needle), `sanity: the leaf must itself contain "${needle}"`);
    for (const rel of [CORE_CONSUMER_REL, PLUGIN_CONSUMER_REL]) {
      const src = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
      assert.equal(
        src.includes(needle),
        false,
        `${rel} must not re-introduce the predicate body line "${needle}" — it was moved to ${LEAF_REL}`,
      );
    }
  }
});
