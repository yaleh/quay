// @test-group engine
// quay-init-laydown-closure.test.mjs — gap-quay-init-closure-shrink-body AC2 (closed-set MEMBERSHIP).
//
// A NEW criterion distinct from the quay-init-closure-ratchet (which only counts files/bytes): this
// pins the closed-set membership assertion over a REAL quay-init laydown — every laid-down path must be
// a member of the SEVEN-item closed set (∪ tasks/ and goals/ descendants), and the retired extension-file copy
// surface (.claude/{skills,workflows,agents}, plugin/scripts) must be ZERO. Read-the-input failure is a
// distinguishable NOT-EVALUATED (hard rule 3b), never conflated with "合格".
//
// Run:
//   scripts/test.sh plugin/test/quay-init-laydown-closure.test.mjs
//   node --test plugin/test/quay-init-laydown-closure.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

import {
  isInClosedSet,
  assertClosure,
  runLaydownPaths,
  runFailureStateReport,
  CLOSED_SET_ALL,
} from "../scripts/quay-init-closure-assertion.ts";

function makeTmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), `qicl-${prefix}-`)); }
function cleanup(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } }

// ── the pure membership function ─────────────────────────────────────────────────────────────────────
test("isInClosedSet admits exactly the seven closed-set members + tasks/ and goals/ descendants", () => {
  for (const m of [".quay/config.yml", ".quay/profiles.yml", ".gitignore", ".claude/launch.settings.json", ".claude/settings.json"]) {
    assert.equal(isInClosedSet(m), true, `${m} must be a closed-set member`);
  }
  assert.equal(isInClosedSet("tasks/TASK-001.md"), true, "a tasks/ descendant must be admitted");
  assert.equal(isInClosedSet("tasks/sub/dir/x.md"), true, "a nested tasks/ descendant must be admitted");
  assert.equal(isInClosedSet("goals/GOAL-001.md"), true, "a goals/ descendant must be admitted");
  assert.equal(isInClosedSet("goals/sub/dir/x.md"), true, "a nested goals/ descendant must be admitted");
  for (const bad of ["plugin/scripts/x.sh", ".claude/workflows/w.js", ".claude/agents/a.md", ".claude/skills/s/SKILL.md", ".mcp.json", ".claude/commands/x.md", ".claude/hooks/h.sh", ".quay/runtime/quay.js", "orchestration/tick.md", "docs/analysis/x.md", "scripts/gates/g.sh"]) {
    assert.equal(isInClosedSet(bad), false, `${bad} must NOT be a closed-set member`);
  }
});

test("assertClosure flags outside-closed-set paths and forbidden copies", () => {
  const v = assertClosure([".quay/config.yml", ".claude/settings.json", "tasks/x.md"]);
  assert.equal(v.ok, true, `a fully-in-set laydown must be ok, got ${JSON.stringify(v)}`);

  const bad = assertClosure([".quay/config.yml", "plugin/scripts/x.sh"]);
  assert.equal(bad.ok, false, "a plugin/scripts copy must violate the closure");
  assert.deepEqual(bad.forbiddenCopies, ["plugin/scripts/x.sh"]);
  assert.deepEqual(bad.outsideClosedSet, ["plugin/scripts/x.sh"]);

  const stray = assertClosure([".gitignore", "orchestration/tick.md"]);
  assert.equal(stray.ok, false, "an outside-closed-set path must violate the closure");
  assert.deepEqual(stray.outsideClosedSet, ["orchestration/tick.md"]);
  assert.deepEqual(stray.forbiddenCopies, []);
});

test("AC3 — the mcp/commands/hooks extension surface is forbidden (file/目录 two-state); the enable surface is not", () => {
  // File vs dir two-state matching (AC-204): `.mcp.json` is a FILE prefix (exact match only, no trailing
  // slash), `.claude/commands/` and `.claude/hooks/` are directory prefixes (dir itself + descendants).
  const v = assertClosure([".mcp.json", ".claude/commands/x.md", ".claude/hooks/h.sh"]);
  assert.ok(v.forbiddenCopies.includes(".mcp.json"), ".mcp.json must be a forbidden copy (exact file match)");
  assert.ok(v.forbiddenCopies.includes(".claude/commands/x.md"), ".claude/commands/x.md must be forbidden (directory prefix)");
  assert.ok(v.forbiddenCopies.includes(".claude/hooks/h.sh"), ".claude/hooks/h.sh must be forbidden (directory prefix)");

  // The enable surface (`.claude/settings.json`) is a closed-set MEMBER, NOT a forbidden copy — 区分
  // enable 面 (settings.json 只写启用/授权) 与实现面 (mcp/commands/hooks 是扩展实现, quay-init 不复制).
  assert.equal(isInClosedSet(".claude/settings.json"), true, ".claude/settings.json must remain a closed-set member");
  const sv = assertClosure([".claude/settings.json"]);
  assert.deepEqual(sv.forbiddenCopies, [], ".claude/settings.json must NOT be a forbidden copy");
  assert.equal(sv.ok, true, "a laydown of only the enable surface must be ok");

  // The file prefix must NOT over-match: a prefix slice would truncate `.mcp.json` to `.mcp.jso`.
  const notMismatch = assertClosure([".mcp.json.bak"]);
  assert.deepEqual(notMismatch.forbiddenCopies, [], ".mcp.json.bak must NOT be treated as the `.mcp.json` file");
});

// ── the REAL laydown must be within the closed set (production carrier, not a fixture) ──────────────
test("AC2 — a real quay-init laydown enumerates only closed-set members (production carrier)", () => {
  const rels = runLaydownPaths(REPO_ROOT);
  assert.ok(rels !== null, "the real laydown must run (NOT-EVALUATED is a failure here)");
  const v = assertClosure(rels);
  assert.equal(v.ok, true, `real laydown violates the closed set: outside=${v.outsideClosedSet} forbidden=${v.forbiddenCopies}`);
});

// ── NOT-EVALUATED (hard rule 3b): unreadable input ≠ 合格 ────────────────────────────────────────────
test("hard rule 3b — runLaydownPaths with NO quay-init.sh ⇒ null (NOT-EVALUATED, never an empty green list)", () => {
  const root = makeTmp("no-init");
  try {
    assert.equal(runLaydownPaths(root), null, "a root without plugin/scripts/quay-init.sh must be NOT-EVALUATED");
  } finally { cleanup(root); }
});

// ── AC5 failure path (gap-quay-init-hard-requires-tmux-session-and-leaves-partial-write) ────────────
test("AC5 — the failure path is covered: a failing quay-init reports every closed-set item's state", () => {
  const report = runFailureStateReport(REPO_ROOT);
  assert.ok(report !== null, "the failing quay-init must run to a non-zero exit (NOT-EVALUATED is a failure here)");
  assert.notEqual(report.exitCode, 0, "a failure-path run must exit non-zero");
  const seen = [...report.written, ...report.unwritten];
  for (const item of CLOSED_SET_ALL) {
    assert.ok(seen.includes(item),
      `the failure report must cover closed-set item: ${item} (written=${report.written} unwritten=${report.unwritten})`);
  }
});

test("hard rule 3b — the CLI exits 3 (NOT-EVALUATED third state) when the laydown cannot run", () => {
  const root = makeTmp("no-init-cli");
  try {
    const checker = path.join(REPO_ROOT, "plugin", "scripts", "quay-init-closure-assertion.ts");
    const res = spawnSync("node", ["--no-warnings", "--experimental-strip-types", checker, "--gate", "--root", root], { encoding: "utf8" });
    assert.equal(res.status, 3, `NOT-EVALUATED must exit 3, got ${res.status}: ${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /NOT-EVALUATED/, "the NOT-EVALUATED third state must be distinguishable");
  } finally { cleanup(root); }
});
