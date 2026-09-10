// @test-group engine
// task-file-bypass-check.test.mjs — RED/GREEN tests for the task-file-bypass ratchet
// (plugin/scripts/task-file-bypass-check.ts, gap-adr013-gate-blind-spots-and-task-bypass-ratchet).
//
// The one-way ratchet: a `tasks/` path literal used as the argument of a FILE-OPERATION (fs.* /
// readFileSync / writeFileSync / execFileSync / spawnSync / git-show-on-task-path / shell grep-cat-git)
// in a file OUTSIDE the ALLOWLIST is a NEW bypass → the gate goes RED. Positional (按位置不按关键词):
// a `tasks/` string used as a search needle, a path-prefix classification (`t.startsWith("tasks/")`),
// a doc/comment mention, or a call spelled inside a string literal does NOT report.
//
// path→content (gap-b5-input-shape-path-to-content): the JUDGMENT logic is tested as the PURE
// `scanCode(rel, src)` / `scanShell(src)` functions over string content — ZERO spawn, ZERO mkdtemp.
// The CLI shell (main) is exercised IN-PROCESS against the real repo and one COMMITTED fixture tree
// (plugin/test/fixtures/task-file-bypass/plugin/scripts/bad.ts).
//
// Covered here:
//   - RED: a `tasks/` fs read / path.join(..., "tasks", …) write / execFileSync git-show / git-log
//         `-- tasks/` / shell grep-cat-test on tasks/*.md reports a hit.
//   - GREEN: a needle, a startsWith classification, a comment/string mention, a non-first-arg
//         `tasks/` string, and a call spelled inside a string literal do NOT report.
//   - AC5: the gate over the real corpus exits 0 (0 new hits — the allowlist baseline holds).
//   - AC4/AC6: the committed fixture makes --gate go red (exit 1); the allowlist is an exported
//         constant (a data object, not scattered inline logic).
//
// Run:
//   scripts/test.sh plugin/test/task-file-bypass-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { scanCode, scanShell, scanSurface, scan, main, ALLOWLIST } from "../scripts/task-file-bypass-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECKER = path.join(REPO_ROOT, "plugin", "scripts", "task-file-bypass-check.ts");
const FIXTURE_ROOT = path.join(__dirname, "fixtures", "task-file-bypass");

/** Patch process.stdout.write / process.stderr.write (emitVerdict + console.error route through
 *  them), capture the text, restore. `main` returns the exit code. */
function captureStreams(fn) {
  const origOut = process.stdout.write, origErr = process.stderr.write;
  let out = "", err = "";
  process.stdout.write = (s) => { out += s; return true; };
  process.stderr.write = (s) => { err += s; return true; };
  try { return { result: fn(), stdout: out, stderr: err }; }
  finally { process.stdout.write = origOut; process.stderr.write = origErr; }
}

// ── RED (负控): the bypass class must be DETECTED ─────────────────────────────────────────────────
test("RED: a tasks/ fs read (template literal) is a hit", () => {
  const src = 'const t = fs.readFileSync(`tasks/${id}.md`, "utf8");\n';
  assert.equal(scanCode(src).length, 1, JSON.stringify(scanCode(src)));
});

test("RED: a path.join(..., \"tasks\", …) fs write is a hit", () => {
  const src = 'fs.writeFileSync(path.join(root, "tasks", `${t}.md`), body);\n';
  assert.equal(scanCode(src).length, 1, JSON.stringify(scanCode(src)));
});

test("RED: an execFileSync git show on <ref>:tasks/<id>.md is a hit", () => {
  const src = 'const out = execFileSync("git", ["show", `${ref}:tasks/${taskId}.md`], { encoding: "utf8" });\n';
  assert.equal(scanCode(src).length, 1, JSON.stringify(scanCode(src)));
});

test("RED: an execFileSync git log -- tasks/ is a hit", () => {
  const src = 'const out = execFileSync("git", ["log", "--format=%ct", "--", "tasks/"], { encoding: "utf8" });\n';
  assert.equal(scanCode(src).length, 1, JSON.stringify(scanCode(src)));
});

test("RED (shell): a grep over tasks/*.md is a hit", () => {
  const src = 'needs_human=$(grep -lE \'^status: needs-human\' "$root"/tasks/*.md 2>/dev/null | wc -l)\n';
  assert.equal(scanShell(src).length, 1, JSON.stringify(scanShell(src)));
});

test("RED (shell): a [ -f tasks/<id>.md ] existence test is a hit", () => {
  const src = '[ -f "$repo_root/tasks/$id.md" ] || { echo "missing" >&2; exit 2; }\n';
  assert.equal(scanShell(src).length, 1, JSON.stringify(scanShell(src)));
});

// ── GREEN: tolerated patterns must NOT report ────────────────────────────────────────────────────
test("GREEN: a tasks/<id>.md search NEEDLE (no file op on the line) is not a hit", () => {
  const src = 'const needleFile = `tasks/${taskId}.md`;\n';
  assert.equal(scanCode(src).length, 0, JSON.stringify(scanCode(src)));
});

test("GREEN: a path-prefix classification (t.startsWith(\"tasks/\")) is not a hit", () => {
  const src = 'if (t.startsWith("tasks/") && t.endsWith(".md")) { const id = t.slice(6, -3); }\n';
  assert.equal(scanCode(src).length, 0, JSON.stringify(scanCode(src)));
});

test("GREEN: a comment mention of a tasks/ path is not a hit", () => {
  const src = "// the store lives at tasks/*.md — read it through the ABI\n";
  assert.equal(scanCode(src).length, 0, JSON.stringify(scanCode(src)));
});

test("GREEN: a tasks/ string in a NON-first argument is not a hit (the write target is not a task file)", () => {
  const src = 'fs.writeFileSync(path.join(jsonlDir, "test.jsonl"), JSON.stringify({ writes: ["tasks/TEST.md"] }));\n';
  assert.equal(scanCode(src).length, 0, JSON.stringify(scanCode(src)));
});

test("GREEN: a file-op spelled inside a STRING literal is not a hit (it is not a call)", () => {
  const src = "const r7Literal = 'fs.writeFileSync(\"tasks/M-FAKE.md\", taskText);\\n';\n";
  assert.equal(scanCode(src).length, 0, JSON.stringify(scanCode(src)));
});

test("GREEN (shell): a [ -d repo/tasks ] dir-existence check (no slash, no .md) is not a hit", () => {
  const src = '[ -d "${repo_root}/tasks" ] || { echo "not a workspace (no tasks/ dir)" >&2; exit 2; }\n';
  assert.equal(scanShell(src).length, 0, JSON.stringify(scanShell(src)));
});

test("GREEN (shell): a prose mention of \"no tasks/ dir\" is not a hit", () => {
  const src = 'echo "deliver-verify-usage: workspace has no tasks/ dir: ${WS}" >&2\n';
  assert.equal(scanShell(src).length, 0, JSON.stringify(scanShell(src)));
});

test("GREEN (shell): a # comment mentioning tasks/*.md is not a hit", () => {
  const src = "# count new task files via git log --diff-filter=A -- tasks/*.md\n";
  assert.equal(scanShell(src).length, 0, JSON.stringify(scanShell(src)));
});

// ── scan surface ────────────────────────────────────────────────────────────────────────────────
test("scanSurface covers packages/quay/src + plugin, excludes test/vendor", () => {
  const surface = scanSurface(REPO_ROOT);
  assert.ok(surface.includes("packages/quay/src/observation.ts"));
  assert.ok(surface.includes("plugin/scripts/task-file-bypass-check.ts"));
  assert.ok(!surface.some((f) => f.includes("plugin/test/")), "plugin/test excluded");
  assert.ok(!surface.some((f) => f.includes("/vendor/")), "plugin/vendor excluded");
});

// ── AC5: the gate over the REAL corpus exits 0 (the allowlist baseline holds) ────────────────────
test("AC5: --gate over the real corpus exits 0, 0 new hits (in-process, zero spawn)", () => {
  const { result, stdout } = captureStreams(() => main(["node", "task-file-bypass-check.ts", "--gate", "--root", REPO_ROOT, "--json"]));
  assert.equal(result, 0, stdout);
  const out = JSON.parse(stdout);
  assert.equal(out.ok, true);
  assert.equal(out.newHits.length, 0, JSON.stringify(out.newHits));
  assert.ok(out.hits.length >= 20, `expected the allowlisted baseline hits, got ${out.hits.length}`);
});

// ── AC4: a committed fixture with a tasks/ fs call makes the gate go RED (exit 1) ────────────────
test("AC4 negative control: a non-allowlisted tasks/ fs read makes --gate go red (exit 1, in-process)", () => {
  const { result, stdout } = captureStreams(() => main(["node", "task-file-bypass-check.ts", "--gate", "--root", FIXTURE_ROOT, "--json"]));
  assert.equal(result, 1, "gate must go red on a non-allowlisted tasks/ fs read — " + stdout);
  const out = JSON.parse(stdout);
  assert.equal(out.ok, false);
  const v = out.newHits.find((x) => x.file === "plugin/scripts/bad.ts");
  assert.ok(v, "the new hit must be attributed to the fixture file — " + JSON.stringify(out.newHits));
});

// ── AC6: the allowlist is a single exported constant (a data object, one entry per line) ─────────
test("AC6: the allowlist is an exported constant data object, not scattered inline logic", () => {
  assert.equal(typeof ALLOWLIST, "object");
  assert.ok(ALLOWLIST["packages/quay/src/observation.ts"], "the seed entry must be present");
  assert.ok(ALLOWLIST["plugin/scripts/worker-driver.ts"], "the worker-driver entry must be present");
  const src = fs.readFileSync(CHECKER, "utf8");
  assert.ok(src.includes("export const ALLOWLIST"), "the allowlist must be an exported constant");
  assert.ok(src.includes("Record<string, { reason: string; expected: number }>"), "the allowlist must be a typed Record (data, not logic)");
});

// ── scan() core ─────────────────────────────────────────────────────────────────────────────────
test("scan() groups the real corpus with 0 new hits and a populated allowlisted set", () => {
  const r = scan(REPO_ROOT);
  assert.equal(r.newHits.length, 0, JSON.stringify(r.newHits));
  assert.ok(r.allowlistedFiles.has("packages/quay/src/observation.ts"), "observation.ts must be an allowlisted hit file");
});
