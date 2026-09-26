// @test-group engine
// perfile-failure-rate.test.mjs — gap-perfile-failure-rate-baseline-step-change
// AC2 (four-state classification pure function, fixture coverage) + AC3 (fail-closed carrier
// resolution). The classification is a PURE function — every state is a DISTINCT value (hard rule
// 3b: "insufficient" must never share an output with "within-baseline"/"new-event").
//
// Coverage:
//   - baselineOf / groupByFile: runs/fails/rate aggregation and chronological grouping.
//   - classifyFailure four states, one fixture each:
//       new-event        fails=0 (the 528/615 majority) — a first red is high-information.
//       within-baseline  fails spread across BOTH halves (long-standing jitter).
//       step-change      fails ALL in the recent half (early half green) — 一直全绿开始红.
//       insufficient     runs < MIN_RUNS — a distinct "cannot judge", NOT new-event.
//   - boundary: runs === MIN_RUNS is judgeable (new-event), runs === MIN_RUNS - 1 is insufficient.
//   - fail-closed CLI: --root → a clean dir with no carrier ⇒ 「载体未找到」 + exit 2 (never an
//     empty baseline that reads "all files never failed").
//   - resolveCarrierRoot single source (semantic-dedup-scan finding
//     `resolve-carrier-root-three-byte-identical-silent-zero`): the definition lives here ONLY; the
//     two psi scripts import it and carry no private copy; deleting the export breaks their link
//     (negative control). Plus the two controls the finding's rationale got wrong — a wrong-but-
//     EXISTING root fails closed in --file mode too, and an existing-but-empty carrier yields the
//     DISTINCT "insufficient", never a silent "new-event".
//
// Run:
//   node --test plugin/test/perfile-failure-rate.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  classifyFailure,
  baselineOf,
  groupByFile,
  resolveCarrierRoot,
  MIN_RUNS,
} from "../scripts/perfile-failure-rate.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const TS = path.join(REPO_ROOT, "plugin", "scripts", "perfile-failure-rate.ts");
const SCRIPTS_DIR = path.join(REPO_ROOT, "plugin", "scripts");

function runCli(args, opts = {}) {
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", TS, ...args], {
    encoding: "utf8",
    ...opts,
  });
}

/** Build a synthetic single-file history: `runs` records, `passed=false` at the given indices. */
function mkHistory(runs, failIdxs = []) {
  const failSet = new Set(failIdxs);
  return Array.from({ length: runs }, (_, i) => ({
    file: "pkg/x.test.mjs",
    passed: !failSet.has(i),
    startedAtMs: 1_000 + i, // strictly increasing ⇒ chronological
  }));
}

// ── baseline aggregation (AC1/AC2 helpers) ──────────────────────────────────────────────────────────
test("baselineOf aggregates {runs, fails, rate} from a file history", () => {
  const b = baselineOf(mkHistory(100, [1, 2, 3]));
  assert.equal(b.runs, 100);
  assert.equal(b.fails, 3);
  assert.ok(Math.abs(b.rate - 0.03) < 1e-9, `rate should be 0.03, got ${b.rate}`);
  assert.deepEqual(baselineOf([]), { runs: 0, fails: 0, rate: 0 });
});

test("groupByFile groups by file and sorts each group chronologically", () => {
  const byFile = groupByFile([
    { file: "b.test.mjs", passed: true, startedAtMs: 3000 },
    { file: "a.test.mjs", passed: false, startedAtMs: 2000 },
    { file: "b.test.mjs", passed: false, startedAtMs: 1000 },
  ]);
  assert.deepEqual([...byFile.keys()].sort(), ["a.test.mjs", "b.test.mjs"]);
  const b = byFile.get("b.test.mjs");
  assert.deepEqual(b.map((r) => r.startedAtMs), [1000, 3000], "chronological order");
});

// ── four-state classification (AC2 — one fixture per state, all distinct) ──────────────────────────
test("AC2 new-event — a file with fails=0 across a judgeable history is a first red (escalate)", () => {
  assert.equal(classifyFailure(mkHistory(60, [])), "new-event");
  // A current failure on such a file is the high-information event — never "within-baseline".
  assert.notEqual(classifyFailure(mkHistory(60, [])), "within-baseline");
});

test("AC2 within-baseline — failures spread across BOTH halves are long-standing jitter (release)", () => {
  // half = ceil(60/2) = 30; fail at 10 (early) and 45 (recent) ⇒ earlyFails>0 and recentFails>0.
  assert.equal(classifyFailure(mkHistory(60, [10, 45])), "within-baseline");
});

test("AC2 step-change — failures ALL in the recent half (early half green) is a 阶跃 (escalate)", () => {
  // half = 30; fails at 40 and 55 are both recent ⇒ earlyFails=0, recentFails=2.
  assert.equal(classifyFailure(mkHistory(60, [40, 55])), "step-change");
});

test("AC2 insufficient — a file below MIN_RUNS cannot be judged (distinct, not new-event)", () => {
  const cls = classifyFailure(mkHistory(10, []));
  assert.equal(cls, "insufficient");
  // 硬规则 3b: insufficient MUST NOT share an output with new-event/within-baseline.
  assert.notEqual(cls, "new-event");
  assert.notEqual(cls, "within-baseline");
  assert.notEqual(cls, "step-change");
});

test("AC2 boundary — runs === MIN_RUNS is judgeable; runs === MIN_RUNS - 1 is insufficient", () => {
  assert.equal(classifyFailure(mkHistory(MIN_RUNS, [])), "new-event", "exactly MIN_RUNS green runs is judgeable");
  assert.equal(classifyFailure(mkHistory(MIN_RUNS - 1, [])), "insufficient", "one run short is not judgeable");
});

test("AC2 minRuns override — the judgeable floor is a parameter, not a hardcoded constant", () => {
  assert.equal(classifyFailure(mkHistory(5, []), { minRuns: 5 }), "new-event", "override raises/lowers the floor");
  assert.equal(classifyFailure(mkHistory(4, []), { minRuns: 5 }), "insufficient");
});

// ── fail-closed carrier resolution (AC3) ─────────────────────────────────────────────────────────────
test("AC3 fail-closed — --root → a clean dir with no carrier exits non-zero with 载体未找到", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "perfile-rate-empty-"));
  try {
    const r = runCli(["--root", dir]);
    assert.equal(r.status, 2, `expected exit 2, got ${r.status}\nstdout: ${r.stdout}`);
    assert.match(r.stderr, /载体未找到/, "must report carrier-not-found, never an empty baseline");
    assert.doesNotMatch(r.stdout, /never-failed/, "must NOT print a baseline summary that reads 'all green'");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC3 fail-closed — a carrier dir that exists but has NO verification-round.jsonl still fails closed", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "perfile-rate-noquay-"));
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  try {
    const r = runCli(["--root", dir]);
    assert.equal(r.status, 2, `expected exit 2, got ${r.status}`);
    assert.match(r.stderr, /载体未找到/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── resolveCarrierRoot: ONE definition (the single-source ratchet) ──────────────────────────────────
// The semantic-dedup-scan finding `resolve-carrier-root-three-byte-identical-silent-zero`
// (byte-identical-body, verdict real-duplication) named THREE sites for this one rule:
// perfile-failure-rate.ts (which already exported it), psi-failure-correlation-check.ts and
// psi-window-join.ts (private copies). The fix is a merge, and these three tests are the executable
// form of it — same shape as the readJsonLines / resolveRoot ratchets in gate-script-base.test.mjs:
// single source, negative control (no private copy + each imports the shared one), and a link
// control proving the import is load-bearing rather than decorative.

/** The two former carriers of a private resolveCarrierRoot copy (the finding's other two files). */
const RESOLVE_CARRIER_ROOT_IMPORTERS = ["psi-failure-correlation-check.ts", "psi-window-join.ts"];

/** The four-line body shape each copy had. Posititional (the exact statement text), so a comment
 *  that merely mentions the env var does NOT count as a hit. */
const CARRIER_BODY_LINES = [
  "if (argRoot) return argRoot;",
  "if (process.env.QUAY_MAIN_CHECKOUT) return process.env.QUAY_MAIN_CHECKOUT;",
  "return repoRoot();",
];

test("resolveCarrierRoot: defined exactly ONCE under plugin/scripts (perfile-failure-rate.ts)", () => {
  const defs = fs
    .readdirSync(SCRIPTS_DIR)
    .filter((f) => f.endsWith(".ts"))
    .filter((f) => /\bfunction resolveCarrierRoot\b/.test(fs.readFileSync(path.join(SCRIPTS_DIR, f), "utf8")));
  assert.deepEqual(
    defs,
    ["perfile-failure-rate.ts"],
    `resolveCarrierRoot must have a single definition; found: ${defs.length ? defs.join(", ") : "none"}`,
  );
});

test("resolveCarrierRoot: neither psi script re-inlines the body, and each IMPORTS the shared one", () => {
  for (const f of RESOLVE_CARRIER_ROOT_IMPORTERS) {
    const src = fs.readFileSync(path.join(SCRIPTS_DIR, f), "utf8");
    const lines = src.split("\n").map((l) => l.trim());
    for (const body of CARRIER_BODY_LINES) {
      assert.equal(
        lines.filter((l) => l === body).length,
        0,
        `${f} re-inlined the resolveCarrierRoot body ("${body}") instead of importing it`,
      );
    }
    // Deleting the private copy without importing the shared one would still pass the counts above,
    // so this half is not redundant — it is the half that distinguishes "merged" from "deleted".
    assert.match(
      src,
      /import \{[^}]*\bresolveCarrierRoot\b[^}]*\} from "\.\/perfile-failure-rate\.ts"/,
      `${f} does not import resolveCarrierRoot from perfile-failure-rate.ts`,
    );
  }
  // ... and the definition site holds the body exactly once (a ratchet on the shared one itself).
  const defLines = fs.readFileSync(path.join(SCRIPTS_DIR, "perfile-failure-rate.ts"), "utf8")
    .split("\n")
    .map((l) => l.trim());
  for (const body of CARRIER_BODY_LINES) {
    assert.equal(defLines.filter((l) => l === body).length, 1, `the single definition must hold "${body}" exactly once`);
  }
});

test("resolveCarrierRoot: deleting the shared export makes a consumer import fail (the mechanism is real)", () => {
  // The "删了不红 ⇒ 假" control: a consumer importing an ABSENT named export must fail to link, and
  // the SAME consumer must link once the export exists. Without this, the ratchet above would pass
  // on a tree where the import line was present but the export had been renamed away.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resolvecarrierroot-negctl-"));
  try {
    fs.writeFileSync(path.join(dir, "perfile-failure-rate.ts"), "export const OTHER = 1;\n");
    fs.writeFileSync(
      path.join(dir, "consumer.ts"),
      'import { resolveCarrierRoot } from "./perfile-failure-rate.ts";\nconsole.log(resolveCarrierRoot);\n',
    );
    const missing = spawnSync("node", ["--experimental-strip-types", "consumer.ts"], { cwd: dir, encoding: "utf8" });
    assert.notEqual(missing.status, 0, "a consumer importing an absent export must fail to link");

    fs.writeFileSync(
      path.join(dir, "perfile-failure-rate.ts"),
      "export function resolveCarrierRoot() { return '/x'; }\n",
    );
    const present = spawnSync("node", ["--experimental-strip-types", "consumer.ts"], { cwd: dir, encoding: "utf8" });
    assert.equal(present.status, 0, "the same consumer links once the export is present");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveCarrierRoot: --root wins over QUAY_MAIN_CHECKOUT; the env is the second fallback", () => {
  // The precedence is the whole content of the shared rule — pin it at the unit level, not only
  // through the CLI, so a future "extraction" that quietly reorders the fallbacks goes red here.
  const prev = process.env.QUAY_MAIN_CHECKOUT;
  try {
    process.env.QUAY_MAIN_CHECKOUT = "/from/env";
    assert.equal(resolveCarrierRoot("/from/arg"), "/from/arg", "--root beats the env");
    assert.equal(resolveCarrierRoot(""), "/from/env", "an EMPTY --root value falls through to the env");
    assert.equal(resolveCarrierRoot(undefined), "/from/env");
    delete process.env.QUAY_MAIN_CHECKOUT;
    assert.equal(resolveCarrierRoot(""), path.resolve(path.join(__dirname, "../..")), "no arg, no env ⇒ repoRoot()");
  } finally {
    if (prev === undefined) delete process.env.QUAY_MAIN_CHECKOUT;
    else process.env.QUAY_MAIN_CHECKOUT = prev;
  }
});

// ── the fail-closed claim, re-checked where the finding's rationale asserted otherwise ──────────────
// The finding's rationale said: "the consumer fails closed only for an ABSENT carrier so a
// wrong-but-existing root yields an empty baseline silently". Both halves were tested rather than
// repeated (hard rule 4 推论四 — an explanation is not a checked conclusion):
//   (i)  a wrong-but-EXISTING root makes the carrier absent too (the carrier is a path UNDER the
//        root), so it takes the same fail-closed path in --file mode as in summary mode — the
//        claim's premise does not hold;
//   (ii) a carrier that genuinely exists but carries no record for the file yields "insufficient",
//        the DISTINCT cannot-judge state — never a silent "new-event" (hard rule 3b).
// Both are pinned below so the disposition ("reviewed; the hazard is already handled") is checkable
// and cannot decay back into a copy-paste someone re-files next round.

test("finding rationale (i) — a wrong-but-EXISTING root fails closed in --file mode too, not silently", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "perfile-rate-wrongroot-"));
  fs.mkdirSync(path.join(dir, "some-other-dir"), { recursive: true });
  try {
    const r = runCli(["--root", path.join(dir, "some-other-dir"), "--file", "pkg/x.test.mjs"]);
    assert.equal(r.status, 2, `expected fail-closed exit 2, got ${r.status}\nstdout: ${r.stdout}`);
    assert.match(r.stderr, /载体未找到/);
    assert.doesNotMatch(r.stdout, /classification/, "must not emit a classification from a wrong root");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("finding rationale (ii) — an existing-but-EMPTY carrier ⇒ insufficient, never a silent new-event", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "perfile-rate-emptycarrier-"));
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".quay", "verification-round.jsonl"), "");
  try {
    const empty = runCli(["--root", dir, "--file", "pkg/x.test.mjs", "--json"]);
    assert.equal(empty.status, 0, "an existing carrier is not a missing carrier");
    const cls = JSON.parse(empty.stdout).classification;
    assert.equal(cls, "insufficient", "0 runs is the cannot-judge state");
    assert.notEqual(cls, "new-event", "a file with 0 recorded runs must NOT read as a first-red new-event");

    // A carrier that HAS records, but none for the queried file, is the same honest state.
    fs.writeFileSync(
      path.join(dir, ".quay", "verification-round.jsonl"),
      JSON.stringify({ perFile: [{ file: "some/other.test.mjs", passed: false, startedAtMs: 1 }] }) + "\n",
    );
    const absentFile = runCli(["--root", dir, "--file", "pkg/x.test.mjs", "--json"]);
    assert.equal(JSON.parse(absentFile.stdout).classification, "insufficient", "queried file absent from the carrier ⇒ cannot judge");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
