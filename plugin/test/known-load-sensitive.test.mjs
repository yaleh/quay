// @test-group engine
// known-load-sensitive.test.mjs — gap-known-load-sensitive-rule-is-doc-only-no-mechanical-triage
// AC1/AC2: the machine-readable KNOWN-LOAD-SENSITIVE family manifest.
//
// The rule was doc-only (grep plugin/scripts/*.ts = 0 hits); this module parses `// @load-sensitive
// <kind>` header annotations from the canonical test glob and emits the family list. Coverage:
//   - parseLoadSensitiveAnnotation: an explicit `// @load-sensitive <kind>` line → kind; a bare
//     KNOWN-LOAD-SENSITIVE mention does NOT count.
//   - scanFamily: the repo's real family list is non-empty and every member carries a known kind.
//   - hasHeaderClaim: only a line-start KNOWN-LOAD-SENSITIVE claim in the HEADER block counts; a
//     fixture string inside a template literal does not (load-sensitive-release-check.test.mjs is
//     NOT a family member).
//   - checkNoUnannotatedClaims: the AC2 invariant — every header claim must carry @load-sensitive.
//   - CLI --list / --kind / --check.
//
// Run:
//   scripts/test.sh plugin/test/known-load-sensitive.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  parseLoadSensitiveAnnotation,
  hasLoadSensitiveAnnotation,
  hasHeaderClaim,
  scanFamily,
  kindForFile,
  isFamilyMember,
  checkNoUnannotatedClaims,
  parseLoadSensitiveEntry,
  hasLoadSensitiveEntry,
  isSerialGroupFile,
  checkSerialEntries,
  entryLineFor,
  KINDS,
} from "../scripts/known-load-sensitive.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const TS = path.join(REPO_ROOT, "plugin", "scripts", "known-load-sensitive.ts");

function runCli(args, root = REPO_ROOT) {
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", TS, "--root", root, ...args], {
    encoding: "utf8",
  });
}

// ── annotation parsing (AC1) ────────────────────────────────────────────────────────────────────────
test("AC1 — parseLoadSensitiveAnnotation reads an explicit // @load-sensitive <kind> header line", () => {
  const src = `// @test-group lowconc\n// @load-sensitive wall-clock\n// KNOWN-LOAD-SENSITIVE (see ...)\n`;
  assert.equal(parseLoadSensitiveAnnotation(src), "wall-clock");
  assert.equal(hasLoadSensitiveAnnotation(src), true);
});

test("AC1 — a bare KNOWN-LOAD-SENSITIVE mention without @load-sensitive does NOT count", () => {
  const src = `// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md)\n`;
  assert.equal(parseLoadSensitiveAnnotation(src), null);
  assert.equal(hasLoadSensitiveAnnotation(src), false);
});

test("AC2 — every kind is from the documented set", () => {
  for (const kind of KINDS) {
    assert.equal(typeof kind, "string");
    assert.ok(kind.length > 0);
  }
});

// ── header claim (AC2) ──────────────────────────────────────────────────────────────────────────────
test("AC2 — hasHeaderClaim matches a line-start KNOWN-LOAD-SENSITIVE claim in the header block", () => {
  const src = `// @test-group lowconc\n// @load-sensitive wall-clock\n// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — family\n`;
  assert.equal(hasHeaderClaim(src), true);
});

test("AC2 — a fixture string inside a template literal is NOT a header claim (load-sensitive-release-check pattern)", () => {
  // The MARKED_SRC fixture in load-sensitive-release-check.test.mjs lives AFTER the imports, inside
  // a template literal. It must not be treated as a family claim.
  const src = `import { test } from "node:test";\nconst MARKED_SRC = \`// @test-group product\n// KNOWN-LOAD-SENSITIVE — this file is genuinely load-sensitive (HTTP server on an ephemeral port).\nimport { test } from "node:test";\ntest("x", () => {});\n\`;\n`;
  assert.equal(hasHeaderClaim(src), false);
});

test("AC2 — a mid-sentence prose mention of KNOWN-LOAD-SENSITIVE is NOT a header claim", () => {
  const src = `// tests for the red-window-release admission gate — a red window may be released\n// only for files that carry the predeclared KNOWN-LOAD-SENSITIVE marker.\nimport { test } from "node:test";\n`;
  assert.equal(hasHeaderClaim(src), false);
});

// ── real repo family manifest (AC1/AC2) ─────────────────────────────────────────────────────────────
test("AC1 — the real family manifest is non-empty and covers both root-cause kinds", () => {
  const family = scanFamily(REPO_ROOT);
  assert.ok(family.length >= 2, `family must be non-empty; got ${family.length}`);
  const kinds = new Set(family.map((m) => m.kind));
  assert.ok(kinds.has("wall-clock"), "session-liveness/cold-start-skill are wall-clock");
  assert.ok(kinds.has("nested-spawn"), "runner-grouping is nested-spawn");
  for (const m of family) {
    assert.ok(m.rel.endsWith(".test.mjs"), `family member must be a test file: ${m.rel}`);
    assert.ok(KINDS.includes(m.kind), `unknown kind ${m.kind} for ${m.rel}`);
  }
});

test("AC1 — kindForFile resolves the two root causes distinctly (no conflation)", () => {
  const family = scanFamily(REPO_ROOT);
  assert.equal(kindForFile(family, "plugin/test/session-liveness-events.test.mjs"), "wall-clock");
  assert.equal(kindForFile(family, "plugin/test/cold-start-skill.test.mjs"), "wall-clock");
  assert.equal(kindForFile(family, "plugin/test/runner-grouping.test.mjs"), "nested-spawn");
  assert.equal(kindForFile(family, "plugin/test/quay-init-loop-core.test.mjs"), "nested-spawn");
  assert.equal(kindForFile(family, "plugin/test/definitely-not-a-test.test.mjs"), undefined);
  assert.equal(isFamilyMember(family, "plugin/test/runner-grouping.test.mjs"), true);
  assert.equal(isFamilyMember(family, "plugin/test/full-suite-runner.test.mjs"), false);
});

test("AC2 — checkNoUnannotatedClaims passes on the real repo (every header claim is annotated)", () => {
  const violations = checkNoUnannotatedClaims(REPO_ROOT);
  assert.deepEqual(violations, [], `unannotated claims: ${JSON.stringify(violations)}`);
});

// ── CLI (Contract invoke / measure) ─────────────────────────────────────────────────────────────────
test("Contract invoke — --list emits one <rel>\\t<kind> line per family member", () => {
  const r = runCli(["--list"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const lines = r.stdout.trim().split("\n").filter(Boolean);
  assert.ok(lines.length >= 2, `--list must emit ≥2 family members; got ${lines.length}`);
  for (const l of lines) {
    const [rel, kind] = l.split("\t");
    assert.ok(rel.endsWith(".test.mjs"), `rel is a test file: ${l}`);
    assert.ok(KINDS.includes(kind), `kind is known: ${l}`);
  }
});

test("Contract invoke — --kind prints the kind for a family member, empty for a non-member", () => {
  const member = runCli(["--kind", "plugin/test/runner-grouping.test.mjs"]);
  assert.equal(member.status, 0, member.stdout + member.stderr);
  assert.equal(member.stdout.trim(), "nested-spawn");

  const nonMember = runCli(["--kind", "plugin/test/full-suite-runner.test.mjs"]);
  assert.equal(nonMember.status, 0, nonMember.stdout + nonMember.stderr);
  assert.equal(nonMember.stdout.trim(), "");
});

test("Contract invoke — --check exits 0 when the invariant holds", () => {
  const r = runCli(["--check"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.stdout.includes("ok"));
});

// ── hermetic negative control (AC2) ─────────────────────────────────────────────────────────────────
function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kls-root-"));
}

test("AC2 negative control — a hermetic file with a bare KNOWN-LOAD-SENSITIVE header claim (no @load-sensitive) fails --check", () => {
  const root = tmpRoot();
  try {
    const dir = path.join(root, "plugin", "test");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "unannotated.test.mjs"),
      `// @test-group engine\n// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md) — claims family\nimport { test } from "node:test";\ntest("x", () => {});\n`,
    );
    const r = runCli(["--check"], root);
    assert.equal(r.status, 1, "an unannotated header claim must fail --check");
    assert.ok(r.stderr.includes("unannotated"), r.stderr);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2 negative control — adding @load-sensitive to that file makes --check pass", () => {
  const root = tmpRoot();
  try {
    const dir = path.join(root, "plugin", "test");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "annotated.test.mjs"),
      `// @test-group engine\n// @load-sensitive wall-clock\n// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md) — claims family\nimport { test } from "node:test";\ntest("x", () => {});\n`,
    );
    const r = runCli(["--check"], root);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── exit mechanism (gap-load-sensitive-serial-phase-unbounded-growth-measure-first AC4) ──────────────

test("AC4 — parseLoadSensitiveEntry reads an explicit // @load-sensitive-entry <date> <reason> header line", () => {
  const src = `// @test-group serial\n// @load-sensitive heavy\n// @load-sensitive-entry 2026-08-09 real-install e2e; install family flake rotation\n// KNOWN-LOAD-SENSITIVE\nimport { test } from "node:test";\n`;
  const e = parseLoadSensitiveEntry(src);
  assert.ok(e, "entry must parse");
  assert.equal(e.date, "2026-08-09");
  assert.equal(e.reason, "real-install e2e; install family flake rotation");
  assert.ok(hasLoadSensitiveEntry(src), "hasLoadSensitiveEntry must be true");
});

test("AC4 — parseLoadSensitiveEntry rejects a missing date, a bare mention, or an empty reason", () => {
  assert.equal(parseLoadSensitiveEntry(`// @load-sensitive-entry 2026-08-09\nimport { test } from "node:test";\n`), null,
    "missing reason → null");
  assert.equal(parseLoadSensitiveEntry(`// @load-sensitive-entry bad-date reason here\nimport { test } from "node:test";\n`), null,
    "non-ISO date → null");
  assert.equal(parseLoadSensitiveEntry(`// load-sensitive-entry 2026-08-09 reason\nimport { test } from "node:test";\n`), null,
    "bare mention without @ → null");
});

test("AC4 — isSerialGroupFile detects @test-group serial, rejects other groups", () => {
  assert.equal(isSerialGroupFile(`// @test-group serial\n// @load-sensitive heavy\n`), true);
  assert.equal(isSerialGroupFile(`// @test-group lowconc\n// @load-sensitive wall-clock\n`), false);
  assert.equal(isSerialGroupFile(`// @test-group engine\n`), false);
});

test("AC4 — checkSerialEntries fails on a serial-group family member without an entry record", () => {
  const root = tmpRoot();
  try {
    const dir = path.join(root, "plugin", "test");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "no-entry.test.mjs"),
      `// @test-group serial\n// @load-sensitive heavy\n// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md) — claims family\nimport { test } from "node:test";\ntest("x", () => {});\n`,
    );
    const vs = checkSerialEntries(root);
    assert.equal(vs.length, 1, "one violation expected");
    assert.equal(vs[0].rel, "plugin/test/no-entry.test.mjs");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC4 — adding the entry record makes checkSerialEntries pass; --check-exit exits 0", () => {
  const root = tmpRoot();
  try {
    const dir = path.join(root, "plugin", "test");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "with-entry.test.mjs"),
      `// @test-group serial\n// @load-sensitive heavy\n// @load-sensitive-entry 2026-08-09 real-install e2e; install family flake rotation\n// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md) — claims family\nimport { test } from "node:test";\ntest("x", () => {});\n`,
    );
    assert.equal(checkSerialEntries(root).length, 0, "no violations with an entry record");
    const r = runCli(["--check-exit"], root);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC4 — a non-serial family member (lowconc/engine) does NOT require an entry record", () => {
  const root = tmpRoot();
  try {
    const dir = path.join(root, "plugin", "test");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "lowconc-no-entry.test.mjs"),
      `// @test-group lowconc\n// @load-sensitive wall-clock\n// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md) — claims family\nimport { test } from "node:test";\ntest("x", () => {});\n`,
    );
    assert.equal(checkSerialEntries(root).length, 0, "lowconc family members are not subject to the serial-entry invariant");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC4 — --list-entry emits <rel>\\t<date>\\t<reason> sorted oldest-first", () => {
  const root = tmpRoot();
  try {
    const dir = path.join(root, "plugin", "test");
    fs.mkdirSync(dir, { recursive: true });
    const newer = `// @test-group serial\n// @load-sensitive heavy\n// @load-sensitive-entry 2026-08-10 newer admission\n// KNOWN-LOAD-SENSITIVE\nimport { test } from "node:test";\n`;
    const older = `// @test-group serial\n// @load-sensitive heavy\n// @load-sensitive-entry 2026-08-08 older admission\n// KNOWN-LOAD-SENSITIVE\nimport { test } from "node:test";\n`;
    fs.writeFileSync(path.join(dir, "a-newer.test.mjs"), newer);
    fs.writeFileSync(path.join(dir, "b-older.test.mjs"), older);
    const r = runCli(["--list-entry"], root);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const lines = r.stdout.trim().split("\n").filter(Boolean);
    assert.equal(lines.length, 2);
    assert.ok(lines[0].startsWith("plugin/test/b-older.test.mjs\t2026-08-08\tolder admission"),
      "oldest entry must sort first, got: " + lines[0]);
    assert.ok(lines[1].startsWith("plugin/test/a-newer.test.mjs\t2026-08-10\tnewer admission"),
      "newest entry second, got: " + lines[1]);
    // entryLineFor: a member WITHOUT an entry record produces no line.
    const noEntryMember = { rel: "plugin/test/x.test.mjs", kind: "heavy" };
    assert.equal(entryLineFor(noEntryMember), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC4 — the real repo's serial-group family members all carry entry records (--check-exit ok)", () => {
  const r = runCli(["--check-exit"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  // And the review hook surfaces at least one record (the mechanism is not vacuously empty).
  const list = runCli(["--list-entry"]);
  assert.equal(list.status, 0, list.stdout + list.stderr);
  const lines = list.stdout.trim().split("\n").filter(Boolean);
  assert.ok(lines.length >= 1, "at least one serial entry record must exist on the real repo");
});
