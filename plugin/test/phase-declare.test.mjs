// @test-group lowconc
// phase-declare.test.mjs — gap-adr008-phase-state-mechanization-minimal (ADR-008 minimal
// mechanization: record the phase, let a HUMAN declare a switch, never auto-switch on a threshold).
//
// What this file pins, AC by AC:
//
//   ① AC1 — the carrier is MACHINE-READABLE, not prose. The test never greps a sentence to find the
//      phase: it `JSON.parse`s `.quay/two-phase-state.json` and reads `.phase`, which must be one of
//      the two legal values. (AC1's own verification clause: "grep/parse 可得,不需要在散文段落里搜索".)
//   ② AC2 — a declaration records THREE things: an ISO timestamp, the human's reason verbatim, and a
//      REAL L_D snapshot. "Real" is pinned by a KNOWN ANSWER (a fixture whose doc/code line counts are
//      arithmetically determined by the file sizes written below) plus an INDEPENDENT recomputation
//      from the fixture's own `git diff --numstat` — a self-consistent-but-wrong reading would have to
//      be wrong in exactly the same way twice to pass. A differential control then shows the reading
//      tracks the repository (two different fixtures ⇒ two different readings) rather than being a
//      constant that merely looks like a number.
//   ③ AC2 negative control — `--reason` absent/blank/below the floor is REFUSED: non-zero exit AND no
//      bytes written. The "no bytes written" half is asserted against a PRE-EXISTING carrier's exact
//      contents too, so a writer that opens-then-bails is caught, not just one that never opens.
//   ④ AC3 — the mechanism contains NO auto-switch. The mechanical evidence is the full 2×2 matrix of
//      (requested phase × reading verdict): all four cells must write the REQUESTED phase, including
//      the two where the reading disagrees with the declaration (prose-heavy reading + `convergence`,
//      code-heavy reading + `expansion`). This is the strongest statement a test can make here; the
//      DoD's "人工代码审查" covers the remainder (that no unreachable branch exists either) and is
//      recorded in the task, not asserted by a keyword scan of the source.
//   ⑤ the carrier ACCUMULATES: a second declaration appends to `history` and the top-level fields
//      mirror the last entry — that array is what makes AC4's after-the-fact timestamp comparison
//      possible at all.
//   ⑥ an unparseable carrier is REFUSED rather than silently replaced (hard rule 3b: "could not read
//      the previous state" must never be indistinguishable from "there was no previous state").
//
// Every fixture is a throwaway `git init` repo under os.tmpdir() — the real repo's own history is
// never read or written by this test, so it can never be satisfied by the state of the checkout it
// runs in.
//
// Run: node --no-warnings --experimental-strip-types --test plugin/test/phase-declare.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync, execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "plugin", "scripts", "phase-declare.ts");

const STATE_REL = path.join(".quay", "two-phase-state.json");
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

// ── fixture helpers ──────────────────────────────────────────────────────────────────────────────

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8" });
}

/** `n` lines of filler ending in a newline — git counts exactly `n` added lines for it. */
function lines(n, prefix = "line") {
  return Array.from({ length: n }, (_, i) => `${prefix} ${i}`).join("\n") + "\n";
}

/** A throwaway git repo containing `files` (relative path → contents), all in one commit. */
function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phase-declare-"));
  run("git", ["init", "-q"], dir);
  run("git", ["config", "user.email", "phase-declare-test@example.invalid"], dir);
  run("git", ["config", "user.name", "phase-declare-test"], dir);
  writeFiles(dir, files);
  run("git", ["add", "-A"], dir);
  run("git", ["commit", "-q", "-m", "fixture: initial"], dir);
  return dir;
}

function writeFiles(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, "utf8");
  }
}

/** Commit an additional change on top of an existing fixture repo. */
function commitMore(dir, files, message) {
  writeFiles(dir, files);
  run("git", ["add", "-A"], dir);
  run("git", ["commit", "-q", "-m", message], dir);
}

/** Invoke the CLI. `--root` is always explicit: the test must never depend on cwd. */
function declare(dir, args) {
  return spawnSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", SCRIPT, "--root", dir, ...args],
    { encoding: "utf8" },
  );
}

function carrier(dir) {
  return path.join(dir, STATE_REL);
}

function readState(dir) {
  return JSON.parse(fs.readFileSync(carrier(dir), "utf8"));
}

/** Independent recomputation of the reading from the fixture's OWN numstat — deliberately does not
 *  import the script's own parser (a shared bug would otherwise be invisible). */
function recomputeDocCode(dir, range) {
  const out = run("git", ["diff", "--numstat", range], dir);
  let doc = 0;
  let code = 0;
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const [a, d, p] = line.split("\t");
    const n = (a === "-" ? 0 : Number(a)) + (d === "-" ? 0 : Number(d));
    if (/\.(md|txt)$/i.test(p)) doc += n;
    else code += n;
  }
  return { doc, code };
}

// ── ① AC1 — machine-readable carrier ─────────────────────────────────────────────────────────────

test("AC1: the carrier is parseable JSON whose `.phase` is one of the two legal values", () => {
  const dir = makeRepo({ "impl.ts": lines(20) });
  const r = declare(dir, ["--to", "expansion", "--reason", "fixture: first declaration"]);
  assert.equal(r.status, 0, `declaration must succeed; stderr=${r.stderr}`);

  // No prose search: parse the file and read the field.
  const state = readState(dir);
  assert.equal(state.phase, "expansion");
  assert.ok(["expansion", "convergence"].includes(state.phase));

  // The timestamp is a real ISO-8601 instant close to now (not a literal from the source).
  const t = Date.parse(state.declaredAt);
  assert.ok(Number.isFinite(t), `declaredAt must parse as a date, got ${state.declaredAt}`);
  assert.match(state.declaredAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  assert.ok(Math.abs(Date.now() - t) < 120_000, "declaredAt must be the moment of the call");
});

// ── ② AC2 — timestamp + reason + a REAL reading ──────────────────────────────────────────────────

test("AC2: the reading is a known-answer measurement of the fixture, not a placeholder", () => {
  // Arithmetic is fixed by construction: 40 doc lines, 10 code lines ⇒ ratio 4.0 ⇒ FLAGGED.
  const dir = makeRepo({ "docs/prose.md": lines(40, "prose"), "impl.ts": lines(10, "code") });
  const r = declare(dir, ["--to", "expansion", "--reason", "fixture: known-answer reading"]);
  assert.equal(r.status, 0, r.stderr);

  const { reason, reading } = readState(dir);
  assert.equal(reason, "fixture: known-answer reading", "the human's reason is recorded verbatim");
  assert.equal(reading.docLines, 40);
  assert.equal(reading.codeLines, 10);
  assert.equal(reading.ratio, 4);
  assert.equal(reading.flagged, true);
  assert.match(reading.verdict, /FLAGGED/);
  assert.ok(reading.rule && reading.rule.length > 0, "the reading carries its own provenance");
  assert.equal(reading.head, run("git", ["rev-parse", "HEAD"], dir).trim());

  // Independent recomputation from the fixture's own numstat must agree.
  const independent = recomputeDocCode(dir, reading.range);
  assert.deepEqual(
    { doc: reading.docLines, code: reading.codeLines },
    independent,
    "the recorded numbers must match an independent numstat over the same range",
  );

  // A one-commit repo has less history than the window, so the range is the whole history.
  assert.equal(reading.range, `${EMPTY_TREE}..HEAD`);
  assert.equal(reading.commitCount, 1);
});

test("AC2: the reading is a measurement, not a constant — two fixtures, two readings", () => {
  const proseHeavy = makeRepo({ "a.md": lines(60, "doc"), "b.ts": lines(5, "code") });
  const codeHeavy = makeRepo({ "a.md": lines(5, "doc"), "b.ts": lines(60, "code") });

  assert.equal(declare(proseHeavy, ["--to", "expansion", "--reason", "fixture: prose heavy"]).status, 0);
  assert.equal(declare(codeHeavy, ["--to", "expansion", "--reason", "fixture: code heavy"]).status, 0);

  const a = readState(proseHeavy).reading;
  const b = readState(codeHeavy).reading;
  assert.notDeepEqual(
    { doc: a.docLines, code: a.codeLines },
    { doc: b.docLines, code: b.codeLines },
    "a reading that does not move with the repository is a placeholder, not a measurement",
  );
  assert.equal(a.flagged, true);
  assert.equal(b.flagged, false);
});

test("AC2: --window bounds the measured range to the named trailing commits", () => {
  const dir = makeRepo({ "first.md": lines(30, "first") });
  commitMore(dir, { "second.ts": lines(7, "second") }, "fixture: second commit");

  const r = declare(dir, ["--to", "convergence", "--reason", "fixture: window bound", "--window", "1"]);
  assert.equal(r.status, 0, r.stderr);
  const { reading } = readState(dir);
  assert.equal(reading.range, "HEAD~1..HEAD");
  // Only the SECOND commit's delta is in range: 7 code lines, zero doc lines.
  assert.deepEqual({ doc: reading.docLines, code: reading.codeLines }, recomputeDocCode(dir, "HEAD~1..HEAD"));
  assert.equal(reading.codeLines, 7);
  assert.equal(reading.docLines, 0);
});

// ── ③ AC2 negative control — a reason-less switch is refused, and writes NOTHING ─────────────────

test("AC2 negative control: missing/blank/thin --reason ⇒ non-zero exit and zero bytes written", () => {
  const cases = [
    ["absent", []],
    ["empty", ["--reason", ""]],
    ["whitespace", ["--reason", "   \t  "]],
    ["too short", ["--reason", "换相"]],
  ];
  for (const [label, extra] of cases) {
    const dir = makeRepo({ "impl.ts": lines(12) });
    const r = declare(dir, ["--to", "expansion", ...extra]);
    assert.notEqual(r.status, 0, `${label}: must be refused`);
    assert.ok(!fs.existsSync(carrier(dir)), `${label}: no carrier may be created`);
  }
});

test("AC2 negative control: a refused declaration leaves an EXISTING carrier byte-identical", () => {
  const dir = makeRepo({ "impl.ts": lines(12) });
  assert.equal(declare(dir, ["--to", "expansion", "--reason", "fixture: baseline"]).status, 0);
  const before = fs.readFileSync(carrier(dir));

  const r = declare(dir, ["--to", "convergence"]);
  assert.notEqual(r.status, 0);
  assert.deepEqual(fs.readFileSync(carrier(dir)), before, "a refused call must not touch the carrier");
});

test("usage error: an illegal --to is refused (exit 2) and writes nothing", () => {
  const dir = makeRepo({ "impl.ts": lines(12) });
  for (const bad of ["expanding", "", "EXPANSION"]) {
    const r = declare(dir, ["--to", bad, "--reason", "fixture: illegal phase value"]);
    assert.equal(r.status, 2, `--to ${JSON.stringify(bad)} must be a usage error`);
    assert.ok(!fs.existsSync(carrier(dir)));
  }
  const unknown = declare(dir, ["--to", "expansion", "--reason", "fixture: unknown flag", "--nope"]);
  assert.equal(unknown.status, 2);
  assert.ok(!fs.existsSync(carrier(dir)));
});

// ── ④ AC3 — no auto-switch path: all 4 (requested × verdict) cells honour the HUMAN ──────────────

test("AC3: the reading never chooses the phase — full 2x2 matrix writes the REQUESTED phase", () => {
  const proseHeavy = () => makeRepo({ "a.md": lines(80, "doc"), "b.ts": lines(2, "code") }); // FLAGGED
  const codeHeavy = () => makeRepo({ "a.md": lines(2, "doc"), "b.ts": lines(80, "code") }); // PASS

  const cases = [
    { make: proseHeavy, to: "convergence", flagged: true, note: "reading says expansion-ish, human says convergence" },
    { make: proseHeavy, to: "expansion", flagged: true, note: "reading and human agree" },
    { make: codeHeavy, to: "expansion", flagged: false, note: "reading says convergence-ish, human says expansion" },
    { make: codeHeavy, to: "convergence", flagged: false, note: "reading and human agree" },
  ];
  for (const c of cases) {
    const dir = c.make();
    const r = declare(dir, ["--to", c.to, "--reason", `fixture: matrix ${c.note}`]);
    assert.equal(r.status, 0, r.stderr);
    const state = readState(dir);
    assert.equal(state.reading.flagged, c.flagged, `fixture verdict precondition for: ${c.note}`);
    assert.equal(
      state.phase,
      c.to,
      `the human's --to must decide, never the reading (${c.note})`,
    );
  }
});

// ── ⑤ the carrier accumulates ────────────────────────────────────────────────────────────────────

test("the carrier accumulates history and mirrors the latest declaration at the top level", () => {
  const dir = makeRepo({ "impl.ts": lines(9) });
  assert.equal(declare(dir, ["--to", "expansion", "--reason", "fixture: declare expansion"]).status, 0);
  assert.equal(declare(dir, ["--to", "convergence", "--reason", "fixture: declare convergence"]).status, 0);

  const state = readState(dir);
  assert.equal(state.history.length, 2);
  assert.deepEqual(state.history.map((h) => h.phase), ["expansion", "convergence"]);
  assert.deepEqual(state.history.map((h) => h.reason), [
    "fixture: declare expansion",
    "fixture: declare convergence",
  ]);
  const last = state.history[state.history.length - 1];
  for (const k of ["phase", "declaredAt", "reason"]) {
    assert.equal(state[k], last[k], `top-level ${k} must mirror the latest declaration`);
  }
  // Each entry keeps its OWN reading (the snapshot at that declaration's moment).
  assert.ok(state.history.every((h) => h.reading && typeof h.reading.docLines === "number"));
});

// ── ⑥ an unreadable carrier is refused, never silently replaced ──────────────────────────────────

test("an unparseable carrier is refused (exit 1, bytes unchanged) rather than clobbered", () => {
  const dir = makeRepo({ "impl.ts": lines(9) });
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  const garbage = "{ this is not json";
  fs.writeFileSync(carrier(dir), garbage);

  const r = declare(dir, ["--to", "expansion", "--reason", "fixture: corrupt carrier"]);
  assert.equal(r.status, 1);
  assert.equal(fs.readFileSync(carrier(dir), "utf8"), garbage);
});

// ── the CLI's own contract surface ───────────────────────────────────────────────────────────────

test("--json prints the declaration that was written", () => {
  const dir = makeRepo({ "impl.ts": lines(11), "notes.md": lines(3) });
  const r = declare(dir, ["--to", "convergence", "--reason", "fixture: json output", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const printed = JSON.parse(r.stdout);
  const state = readState(dir);
  assert.equal(printed.phase, "convergence");
  assert.deepEqual(printed, state.history[state.history.length - 1]);
});
