// @test-group governance
// self-touch-convention.test.mjs — gap-closure-could-not-run-in-task-grant-self-touches-for-ac-and-invoke-evidence
// (c) block of the three-block batch elimination: grant each task its own `tasks/<id>.md` in
// `## Touches` so the executing agent self-checks AC boxes + pastes invoke evidence at completion,
// and outer closure shrinks to one DoD line per task. Covers:
//   AC1  the static self-touch check — a task whose Touches includes `tasks/<id>.md` WITHOUT `(new)`
//        passes; a missing self-file fails; a `(new)` self-file fails (would misjudge the ready
//        pool). Plus the `--self-touch` / `--self-touch-scan` CLI modes.
//   AC4  checkTouchesPair UNAFFECTED — A touches `tasks/A.md`, B touches `tasks/B.md` ⇒ disjoint:true;
//        a shared file ⇒ disjoint:false (two-direction fixtures). Unique self-files must never force
//        serialization.
//   AC5  self-file WITHOUT `(new)` — `taskWorkLanded`'s touch signal does NOT fire (ready pool not
//        misjudged empty); the same self-file WITH `(new)` DOES fire (the regression the convention
//        prevents).
//   AC7  node:test + `// @test-group governance` (this header).
//
// Run: scripts/test.sh plugin/test/self-touch-convention.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { parseTouches, checkTouchesPair, selfTouchCheck, scanReadyTasksSelfTouch, isFixtureTask } from "../scripts/touches-orthogonality-check.ts";
import { taskWorkLanded } from "../scripts/task-status-drift-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CLI = path.join(REPO_ROOT, "plugin", "scripts", "touches-orthogonality-check.ts");

// ── helpers ───────────────────────────────────────────────────────────────────────────────────────

function makeWorkspace(tag, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `self-touch-${tag}-`));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
  return root;
}

function cleanup(root) {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

function taskBody(id, touches, opts = {}) {
  const status = opts.status ?? "ready";
  const symbol = opts.symbol ?? "noSuchSymbolXYZ";
  const role = opts.role ? `role: ${opts.role}\n` : "";
  const labels = opts.labels ? `labels:\n${opts.labels.map((l) => `  - ${l}`).join("\n")}\n` : "";
  return `---
id: ${id}
title: fixture ${id}
status: ${status}
${role}${labels}extra:
  schema: v1
---

## Acceptance Criteria

- [ ] AC1: \`${symbol}\` is implemented

## Touches

${touches}
`;
}

function runCli(root, ...args) {
  const res = spawnSync("node", ["--no-warnings", "--experimental-strip-types", CLI, ...args], {
    encoding: "utf8",
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

// A fake expander (mirrors touches-parser-parity.test.mjs) so checkTouchesPair is unit-tested
// without walking a real tree.
function fakeExpand(mapping) {
  return (globs) => {
    const out = new Set();
    for (const g of globs) for (const f of (mapping[g] || [])) out.add(f);
    return out;
  };
}

// ── AC4: checkTouchesPair UNAFFECTED (two-direction fixtures) ─────────────────────────────────────

test("AC4: unique self-files (A touches tasks/A.md, B touches tasks/B.md) ⇒ disjoint:true", () => {
  const A = parseTouches("## Touches\n- tasks/A.md");
  const B = parseTouches("## Touches\n- tasks/B.md");
  assert.deepEqual(A.globs, ["tasks/A.md"]);
  assert.deepEqual(B.globs, ["tasks/B.md"]);
  const r = checkTouchesPair(A, B, fakeExpand({ "tasks/A.md": ["tasks/A.md"], "tasks/B.md": ["tasks/B.md"] }));
  assert.equal(r.disjoint, true, "unique self-files must stay disjoint");
  assert.deepEqual(r.overlaps, [], "no overlap between A's and B's self-files");
});

test("AC4: a shared file (both touch tasks/A.md) ⇒ disjoint:false (negative direction)", () => {
  const A = parseTouches("## Touches\n- tasks/A.md");
  const B = parseTouches("## Touches\n- tasks/A.md");
  const r = checkTouchesPair(A, B, fakeExpand({ "tasks/A.md": ["tasks/A.md"] }));
  assert.equal(r.disjoint, false, "a shared file must force serialization");
  assert.ok(r.overlaps.includes("tasks/A.md"), "overlap names the shared file");
});

test("AC4: self-file + a shared code file — self-files alone stay disjoint, the shared file still overlaps", () => {
  const A = parseTouches("## Touches\n- tasks/A.md\n- code/shared.ts");
  const B = parseTouches("## Touches\n- tasks/B.md\n- code/shared.ts");
  const r = checkTouchesPair(A, B, fakeExpand({
    "tasks/A.md": ["tasks/A.md"], "tasks/B.md": ["tasks/B.md"], "code/shared.ts": ["code/shared.ts"],
  }));
  assert.equal(r.disjoint, false, "shared code file must force serialization");
  assert.deepEqual(r.overlaps, ["code/shared.ts"], "the unique self-files are NOT the overlap");
});

// ── AC5: self-file WITHOUT `(new)` does NOT fire taskWorkLanded's touch signal ────────────────────

test("AC5: self-file without (new) ⇒ taskWorkLanded does NOT fire; with (new) ⇒ it fires", () => {
  const ws = makeWorkspace("ac5", {
    // The task's own file exists on disk (it IS the task store).
    "tasks/fixture-ac5.md": taskBody("fixture-ac5", "- tasks/fixture-ac5.md"),
  });
  try {
    const noNew = taskBody("fixture-ac5", "- tasks/fixture-ac5.md");
    assert.equal(taskWorkLanded(noNew, ws), false,
      "a self-file WITHOUT (new) must NOT count as landed work (ready pool not misjudged empty)");

    // Negative control: the SAME self-file annotated `(new)` DOES fire — the exact regression the
    // convention prevents (a `(new)` self-file would judge every task "work already landed").
    const withNew = taskBody("fixture-ac5", "- tasks/fixture-ac5.md (new)");
    assert.equal(taskWorkLanded(withNew, ws), true,
      "a self-file WITH (new) MUST count as landed work (the misjudgment the (new) ban prevents)");

    // Backtick form of the self-file (no (new)) also stays inert.
    const bt = taskBody("fixture-ac5", "- `tasks/fixture-ac5.md`");
    assert.equal(taskWorkLanded(bt, ws), false, "backticked self-file without (new) must not fire");
  } finally {
    cleanup(ws);
  }
});

// ── AC1: the static self-touch check ──────────────────────────────────────────────────────────────

test("AC1: selfTouchCheck — self-file without (new) passes; missing / (new) fail", () => {
  // Positive: Touches includes `tasks/<id>.md` with no structural annotation.
  assert.equal(selfTouchCheck(taskBody("x", "- tasks/x.md"), "x").ok, true);
  // Backtick form of the self-file also passes (parser strips backticks).
  assert.equal(selfTouchCheck(taskBody("x", "- `tasks/x.md`"), "x").ok, true);
  // A trailing NON-(new) ASCII annotation is fine (stripped; the path is the grant).
  assert.equal(selfTouchCheck(taskBody("x", "- tasks/x.md (self-file)"), "x").ok, true);

  // Negative: missing self-file entirely.
  const missing = selfTouchCheck(taskBody("x", "- plugin/scripts/foo.ts"), "x");
  assert.equal(missing.ok, false, "no self-file entry → not ok");
  assert.equal(missing.expected, "tasks/x.md");

  // Negative: self-file WITH (new) — the (new) ban.
  assert.equal(selfTouchCheck(taskBody("x", "- tasks/x.md (new)"), "x").ok, false,
    "a (new) self-file must be rejected (would misjudge the ready pool)");

  // Negative: no ## Touches section at all → fail (no grant).
  const noTouches = "---\nid: x\nstatus: ready\n---\n\n## Acceptance Criteria\n\n- [ ] AC1: `noSuchSymbolXYZ` done\n";
  assert.equal(selfTouchCheck(noTouches, "x").ok, false);
});

test("AC1: scanReadyTasksSelfTouch reports ready tasks missing their self-file; skips non-ready + fixtures", () => {
  const ws = makeWorkspace("scan", {
    "tasks/a.md": taskBody("a", "- tasks/a.md"),                       // ok
    "tasks/b.md": taskBody("b", "- plugin/scripts/foo.ts"),            // missing self-file
    "tasks/c.md": taskBody("c", "- tasks/c.md (new)"),                 // (new) → not ok
    "tasks/d.md": taskBody("d", "- tasks/d.md", { status: "todo" }),   // not ready → skipped
    "tasks/e.md": taskBody("e", "- plugin/scripts/foo.ts", { labels: ["fixture"] }), // fixture → skipped
  });
  try {
    const rows = scanReadyTasksSelfTouch(path.join(ws, "tasks"));
    assert.deepEqual(rows.map((r) => r.id), ["a", "b", "c"], "ready, non-fixture tasks scanned in id order; todo + fixture skipped");
    assert.deepEqual(rows.filter((r) => r.ok).map((r) => r.id), ["a"]);
    assert.deepEqual(rows.filter((r) => !r.ok).map((r) => r.id), ["b", "c"]);
  } finally {
    cleanup(ws);
  }
});

test("AC1: a `role: compound` task is recognized as compound — NOT a self-touch false negative", () => {
  // Compound task whose Touches delegate to children (the aggregation convention) — no self-file.
  const compoundBody = taskBody("comp", "- plugin/scripts/foo.ts", { role: "compound" });
  const r = selfTouchCheck(compoundBody, "comp");
  assert.equal(r.ok, false, "a compound genuinely has no self-file entry in its Touches");
  assert.equal(r.compound, true, "…and the checker must recognize it as compound");
  assert.equal(r.expected, "tasks/comp.md");

  // Negative: a primitive task missing its self-file is NOT compound — a real self-touch violation.
  const plainBody = taskBody("plain", "- plugin/scripts/foo.ts");
  const p = selfTouchCheck(plainBody, "plain");
  assert.equal(p.ok, false);
  assert.equal(p.compound, false, "a primitive missing its self-file is a genuine violation, not compound");
});

test("AC1: scanReadyTasksSelfTouch includes a ready compound but does NOT count it as missing", () => {
  const ws = makeWorkspace("compound-scan", {
    "tasks/comp.md": taskBody("comp", "- plugin/scripts/foo.ts", { role: "compound" }), // compound, no self-file
    "tasks/plain.md": taskBody("plain", "- plugin/scripts/foo.ts"),                      // primitive, missing self-file
  });
  try {
    const rows = scanReadyTasksSelfTouch(path.join(ws, "tasks"));
    assert.deepEqual(rows.map((r) => r.id), ["comp", "plain"], "both ready tasks scanned in id order");
    const comp = rows.find((r) => r.id === "comp");
    assert.equal(comp.ok, false);
    assert.equal(comp.compound, true, "compound row flagged compound");
    const plain = rows.find((r) => r.id === "plain");
    assert.equal(plain.ok, false);
    assert.equal(plain.compound, false, "primitive missing row stays a genuine violation");
    // The consumer rule: missing = !ok && !compound — only `plain` is missing.
    assert.deepEqual(rows.filter((r) => !r.ok && !r.compound).map((r) => r.id), ["plain"]);
  } finally {
    cleanup(ws);
  }
});

test("AC1: --self-touch / --self-touch-scan treat a ready compound as convention-exempt (exit 0, no false negative)", () => {
  const ws = makeWorkspace("compound-cli", {
    "tasks/comp.md": taskBody("comp", "- plugin/scripts/foo.ts", { role: "compound" }),
  });
  try {
    const scan = runCli(ws, "--self-touch-scan", "--root", ws);
    assert.equal(scan.status, 0, "a ready compound alone must NOT fail the self-touch scan");
    assert.match(scan.stdout, /COMPOUND/);
    assert.doesNotMatch(scan.stdout, /missing self-file entry — 1/);

    const single = runCli(ws, "--self-touch", path.join(ws, "tasks", "comp.md"), "--root", ws);
    assert.equal(single.status, 0, "the per-candidate --self-touch gate does not flag a compound");
    assert.match(single.stdout, /COMPOUND/);
  } finally {
    cleanup(ws);
  }
});

test("AC1: isFixtureTask recognizes block-list and flow-list fixture labels; false otherwise", () => {
  const block = "---\nid: x\nlabels:\n  - initiative:epicd-engine-port\n  - fixture\n---\n\nbody";
  const flow = "---\nid: y\nlabels: [directive, fixture]\n---\n\nbody";
  const plain = "---\nid: z\nlabels:\n  - gap\n---\n\nbody";
  assert.equal(isFixtureTask(block), true, "block-list fixture label");
  assert.equal(isFixtureTask(flow), true, "flow-list fixture label");
  assert.equal(isFixtureTask(plain), false, "no fixture label");
  assert.equal(isFixtureTask("no frontmatter"), false);
});

test("AC1: --self-touch CLI exits 0 on self-file ok, 1 on missing / (new)", () => {
  const ws = makeWorkspace("cli", {
    "tasks/ok.md": taskBody("ok", "- tasks/ok.md"),
    "tasks/bad.md": taskBody("bad", "- plugin/scripts/foo.ts"),
    "tasks/new.md": taskBody("new", "- tasks/new.md (new)"),
  });
  try {
    const okRun = runCli(ws, "--self-touch", path.join(ws, "tasks", "ok.md"), "--root", ws);
    assert.equal(okRun.status, 0, "self-file ok → exit 0");
    assert.match(okRun.stdout, /SELF-TOUCH .*ok/);

    const badRun = runCli(ws, "--self-touch", path.join(ws, "tasks", "bad.md"), "--root", ws);
    assert.equal(badRun.status, 1, "missing self-file → exit 1");
    assert.match(badRun.stdout, /MISSING tasks\/bad\.md/);

    const newRun = runCli(ws, "--self-touch", path.join(ws, "tasks", "new.md"), "--root", ws);
    assert.equal(newRun.status, 1, "(new) self-file → exit 1");
    assert.match(newRun.stdout, /MISSING tasks\/new\.md/);
  } finally {
    cleanup(ws);
  }
});

test("AC1: --self-touch-scan CLI exits 1 when any ready task is missing its self-file, 0 when all ok", () => {
  const ws = makeWorkspace("scancli", {
    "tasks/a.md": taskBody("a", "- tasks/a.md"),
    "tasks/b.md": taskBody("b", "- plugin/scripts/foo.ts"),
  });
  try {
    const run = runCli(ws, "--self-touch-scan", "--root", ws);
    assert.equal(run.status, 1, "one ready task missing self-file → exit 1");
    assert.match(run.stdout, /ok:      a/);
    assert.match(run.stdout, /MISSING: b/);
    assert.match(run.stdout, /1 missing self-file entry/);

    const ws2 = makeWorkspace("scancli2", { "tasks/a.md": taskBody("a", "- tasks/a.md") });
    try {
      const okRun = runCli(ws2, "--self-touch-scan", "--root", ws2);
      assert.equal(okRun.status, 0, "all ready tasks have self-files → exit 0");
      assert.match(okRun.stdout, /0 missing self-file entry/);
    } finally {
      cleanup(ws2);
    }
  } finally {
    cleanup(ws);
  }
});

// ── AC7 / policy: node:test + @test-group governance is declared in the header ────────────────────
test("AC7: this file imports node:test and declares @test-group governance (policy enforced separately)", () => {
  const src = fs.readFileSync(new URL(import.meta.url), "utf8");
  assert.match(src, /import \{ test \} from "node:test"/, "node:test import present");
  assert.match(src, /@test-group governance/, "governance group declared");
});
