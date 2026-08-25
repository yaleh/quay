// @test-group engine
// @load-sensitive child-spawn
// @load-sensitive-entry 2026-08-11 child-spawn spawn×9 under suite load (round-215 silent passed=false @7721ms)
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — this harness
// spawns the threshold-scope-check.ts checker as a REAL node child process (~9 spawnSync calls,
// AC1-AC9 each spawn once per fixture). Under full-suite main-phase concurrency those spawns are
// start/schedule-delayed, and round-215 (2026-08-10) showed the exact signature: a silent
// passed=false at 7721ms with ZERO harness output lines (an assertion failure would always write
// FAIL: to fd 2; zero lines = the process died before the harness could report). Solo 4089ms 9/9
// green. Same child-spawn family as relation-sync / create-mcp / proposal-convergence / checker-cost
// (all routed to the concurrency-1 serial phase); this file was left in the default concurrent
// governance body and is now also routed to serial
// (gap-threshold-scope-load-flake-fifth-family-member).
// threshold-scope-check.test.mjs — tasks/gap-quantified-stop-conditions-have-no-scope:
// the driver-doc prose hygiene checker (quantified stop-conditions must name set+window; named
// paths must resolve).
//
// Coverage map (task ACs):
//   AC2  — the bidirectional negative control: `needs-human ≥ 3` (no set, no window) MUST be
//         reported; `窗口内新增 needs-human ≥ 3` MUST NOT. Both directions asserted via --judge
//         fixtures and pasted into the task body.
//   AC3  — a paragraph marked `<!-- unmechanized: -->` / `<!-- unmechanizable: -->` is NOT reported
//         AND the skip is VISIBLE: skippedByMarker is reported (a silent skip is indistinguishable
//         from "no findings").
//   AC4  — matching is by line CONTENT: fenced code blocks and HTML-comment content are stripped.
//   AC9  — the three-layer stale-path judgment, run against the REAL CLAUDE.md: the 18 local
//         references (basename-exists shorthand) are NOT reported; only the genuinely unresolvable
//         path is.
//   AC10 — placeholder patterns (`NNN`, `<...>`, `*`, `{`) are skipped (`tasks/DIR-NNN.md`).
//   AC11 — the negative control: a fabricated reference to a nonexistent file MUST be reported;
//         the same text with a real path MUST NOT.
//   AC8  — this file uses node:test and declares `// @test-group engine` (line 1; was serial).
//   AC6  — the shrink-only ratchet: the real-repo gate exits 0 and its current violation set
//         exactly matches the baseline file (a NEW violation would flip growth=true → exit 1).
//
// Run:
//   scripts/test.sh plugin/test/threshold-scope-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const CHECKER = path.join(REPO_ROOT, "plugin/scripts/threshold-scope-check.ts");
const DATA_FILE = path.join(REPO_ROOT, "docs/analysis/threshold-scope-violations.md");

/** Run the checker against the real repo root (default gate). */
function run(...args) {
  return spawnSync(
    "node",
    ["--no-warnings", "--experimental-strip-types", CHECKER, "--root", REPO_ROOT, ...args],
    { encoding: "utf8" },
  );
}

/** Judge one temp doc (absolute path) with --judge --json; returns the spawnSync result. */
function judgeFile(absPath) {
  return spawnSync(
    "node",
    ["--no-warnings", "--experimental-strip-types", CHECKER, "--judge", absPath, "--json"],
    { encoding: "utf8" },
  );
}

/** Write a temp doc and judge it; returns { res, dir } for cleanup. */
function tmpDoc(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsc-"));
  const f = path.join(dir, "fixture.md");
  fs.writeFileSync(f, text);
  return { res: judgeFile(f), dir };
}

function parseJson(res) {
  assert.equal(res.status, 0, `expected checker to run, got ${res.status}:\n${res.stdout}${res.stderr}`);
  return JSON.parse(res.stdout);
}

// ── AC2: the bidirectional negative control ─────────────────────────────────────────────────────────
test("AC2 — `needs-human ≥ 3` (no set, no window) MUST be reported (+1)", () => {
  const { res, dir } = tmpDoc("停止条件：needs-human 积压 ≥ 3\n");
  try {
    assert.equal(res.status, 1, `expected exit 1 (flagged), got ${res.status}:\n${res.stdout}${res.stderr}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.violations.length, 1, `expected 1 threshold violation, got ${out.violations.length}`);
    assert.ok(out.violations[0].hit.includes("≥"), `hit should carry the threshold, got ${out.violations[0].hit}`);
    assert.equal(out.flagged, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 — `窗口内新增 needs-human ≥ 3` (window named) MUST NOT be reported (back to 0)", () => {
  const { res, dir } = tmpDoc("停止条件：窗口内新增 needs-human ≥ 3\n");
  try {
    assert.equal(res.status, 0, `expected exit 0 (clean), got ${res.status}:\n${res.stdout}${res.stderr}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.violations.length, 0, `expected 0 threshold violations, got ${out.violations.length}`);
    assert.equal(out.flagged, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── AC3: marked paragraphs are skipped AND the skip is visible ──────────────────────────────────────
test("AC3 — a paragraph marked unmechanizable is NOT reported, and skippedByMarker makes the skip visible", () => {
  const { res, dir } = tmpDoc(
    "判断边界（有意不机械化，勿报）：\n" +
      "<!-- unmechanizable: 判断题，无代码可强制。形态是启发式，靠每 tick 复读 -->\n" +
      "停止条件：needs-human 积压 ≥ 3\n",
  );
  try {
    assert.equal(res.status, 0, `marked paragraph must not flag, got ${res.status}:\n${res.stdout}${res.stderr}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.violations.length, 0, `marked paragraph's candidate must be suppressed, got ${out.violations.length}`);
    assert.ok(out.skippedByMarker >= 1, `the skip must be VISIBLE, got skippedByMarker=${out.skippedByMarker}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── AC4: code blocks and HTML comments are stripped (match by line content) ─────────────────────────
test("AC4 — fenced code blocks and HTML-comment content are NOT matched", () => {
  const { res, dir } = tmpDoc(
    "```bash\n" +
      "# 示例命令：needs-human 积压 ≥ 3 时停止\n" +
      "echo hi\n" +
      "```\n" +
      "正文：<!-- needs-human 积压 ≥ 3 这是注释 -->\n" +
      "正常句子。\n",
  );
  try {
    assert.equal(res.status, 0, `code-block/comment content must not flag, got ${res.status}:\n${res.stdout}${res.stderr}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.violations.length, 0);
    assert.equal(out.stalePaths.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── AC10: placeholder patterns are skipped ──────────────────────────────────────────────────────────
test("AC10 — a placeholder path (`tasks/DIR-NNN.md`) is skipped, not reported", () => {
  const { res, dir } = tmpDoc("读取 `tasks/DIR-NNN.md` 与 `docs/<date>.md` 与 `packages/*/test`。\n");
  try {
    assert.equal(res.status, 0, `placeholder paths must be skipped, got ${res.status}:\n${res.stdout}${res.stderr}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.stalePaths.length, 0, `placeholder candidates must be skipped, got ${JSON.stringify(out.stalePaths)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── AC11: the stale-path negative control ───────────────────────────────────────────────────────────
test("AC11 — a reference to a nonexistent file MUST be reported; the same text with a real path MUST NOT", () => {
  const bad = "请核对 `nowhere/exists.js` 与 `scripts/test.sh`。\n";
  const { res: r1, dir: d1 } = tmpDoc(bad);
  try {
    assert.equal(r1.status, 1, `nonexistent-path reference must flag, got ${r1.status}:\n${r1.stdout}${r1.stderr}`);
    const out = JSON.parse(r1.stdout);
    assert.equal(out.stalePaths.length, 1, `expected 1 stale path, got ${out.stalePaths.length}`);
    assert.equal(out.stalePaths[0].path, "nowhere/exists.js");
    // the real path on the SAME line is a local reference — NOT reported
    assert.ok(!out.stalePaths.some((s) => s.path === "scripts/test.sh"), "an existing path must not be reported");
  } finally {
    fs.rmSync(d1, { recursive: true, force: true });
  }

  const good = "请核对 `scripts/test.sh`。\n";
  const { res: r2, dir: d2 } = tmpDoc(good);
  try {
    assert.equal(r2.status, 0, `real-path-only text must be clean, got ${r2.status}:\n${r2.stdout}${r2.stderr}`);
    const out = JSON.parse(r2.stdout);
    assert.equal(out.stalePaths.length, 0);
    assert.equal(out.flagged, false);
  } finally {
    fs.rmSync(d2, { recursive: true, force: true });
  }
});

// ── line-number citations (round-312 false positive) ────────────────────────────────────────────────
test("AC11b — a `path:NNN` LINE-NUMBER citation resolves to its base path: existing path + :NNN stays clean; a genuinely-missing path + :NNN still flags", () => {
  // `orchestration/orchestrator-tick-core.md:16` cites line 16 of a file that EXISTS — the base path
  // resolves, so it must NOT be reported (round-312 red was this false positive: stale-path-ext on
  // CLAUDE.md:19 because the `:16` suffix was treated as part of the path).
  const cited = "请核对 `orchestration/orchestrator-tick-core.md:16` 与 `scripts/test.sh:5`。\n";
  const { res: r1, dir: d1 } = tmpDoc(cited);
  try {
    assert.equal(r1.status, 0, `existing-path + :NNN citation must be clean, got ${r1.status}:\n${r1.stdout}${r1.stderr}`);
    const out = JSON.parse(r1.stdout);
    assert.equal(out.stalePaths.length, 0, `expected 0 stale paths, got ${JSON.stringify(out.stalePaths)}`);
  } finally {
    fs.rmSync(d1, { recursive: true, force: true });
  }

  // A genuinely-missing path carries the line citation the SAME way — the base path is gone, so it
  // must STILL be reported (the citation suffix must not hide a real stale path).
  const missing = "请核对 `nowhere/missing.ts:12`。\n";
  const { res: r2, dir: d2 } = tmpDoc(missing);
  try {
    assert.equal(r2.status, 1, `missing-path + :NNN citation must still flag, got ${r2.status}:\n${r2.stdout}${r2.stderr}`);
    const out = JSON.parse(r2.stdout);
    assert.equal(out.stalePaths.length, 1, `expected 1 stale path, got ${JSON.stringify(out.stalePaths)}`);
    assert.equal(out.stalePaths[0].path, "nowhere/missing.ts", `flagged path must be the base (no :NNN), got ${out.stalePaths[0].path}`);
  } finally {
    fs.rmSync(d2, { recursive: true, force: true });
  }
});

// ── AC9 + three-layer stale-path judgment on the REAL CLAUDE.md ─────────────────────────────────────
test("AC9 — the real CLAUDE.md stale-path run: local references (basename-exists shorthand) are NOT reported; the one unresolvable path is", () => {
  const res = run("--judge", "CLAUDE.md", "--json");
  assert.equal(res.status, 1, `CLAUDE.md carries the known stale path, so --judge must exit 1, got ${res.status}:\n${res.stdout}${res.stderr}`);
  const out = JSON.parse(res.stdout);
  // The 18 local-path class (a shorthand whose basename exists elsewhere) is NOT reported.
  // `OUTER-LOOP.md`, `prepare-milestone.js`, `execute-milestone.js` etc. in CLAUDE.md are all
  // annotated as retired OR basename-resolve — assert none of those appear as stale.
  for (const s of out.stalePaths) {
    assert.ok(s.path !== "OUTER-LOOP.md" && !s.path.includes("prepare-milestone"), `annotated/retired reference must not report: ${s.path}`);
  }
  // The ONE genuinely unresolvable, unannotated path is the current finding.
  const known = out.stalePaths.find((s) => s.path === ".claude/workflows/execute-milestone.js");
  assert.ok(known, `expected the known stale path to be reported, got ${JSON.stringify(out.stalePaths)}`);
});

// ── AC6 + default gate on the real repo (shrink-only ratchet consistency) ───────────────────────────
test("AC6/default — the real-repo gate exits 0 and the current violation set matches the shrink-only baseline", () => {
  const res = run("--json");
  assert.equal(res.status, 0, `default gate must pass (no ratchet growth), got ${res.status}:\n${res.stdout}${res.stderr}`);
  const out = JSON.parse(res.stdout);
  assert.equal(out.mode, "threshold-scope-docs");
  assert.equal(out.scanned.length, 3, `expected 3 scanned docs, got ${out.scanned.length}`);
  assert.equal(out.scanned[0], "plugin/loop/fast-mode-loop-tick.md");
  assert.equal(out.scanned[1], "plugin/loop/orchestrator-loop-tick.md");
  assert.equal(out.scanned[2], "CLAUDE.md");
  // The ## Contract measures: violations / stalePaths array lengths + skippedByMarker count.
  assert.equal(typeof out.violations.length, "number");
  assert.equal(typeof out.stalePaths.length, "number");
  assert.ok(out.skippedByMarker >= 3, `the 3 markers in fast-mode-loop-tick.md must be visible, got ${out.skippedByMarker}`);
  // Ratchet consistency: current keys == baseline entries (a mismatch means growth or un-shrunk debt).
  const current = out.violations.length + out.stalePaths.length;
  assert.equal(out.ratchet.currentCount, current, `ratchet currentCount must equal the violation+stale total`);
  assert.equal(out.ratchet.growth, false, `no growth on the current docs`);
  assert.equal(out.ratchet.currentCount, out.ratchet.baselineCount, `current violation set must match the shrink-only baseline`);
  // The two 2026-08-03 dispatch-freeze shapes (needs-human 积压 ≥3) remain on the current surface.
  // AC38 切分后 注册表 ≥2 stop-condition 退出 canonical plugin/loop/ 扫描面 → 只剩 2 条 `≥` 违例
  // （re-baselined 5969b096 4→3，AC38 doc-split 又收缩 3→2）。
  const thresholdHits = out.violations.filter((v) => v.hit.includes("≥"));
  assert.equal(thresholdHits.length, 2, `expected 2 unscoped count-threshold violations (current surface), got ${thresholdHits.length}`);
});

// ── the ratchet data file exists and is well-formed (the AC5 deliverable) ───────────────────────────
test("AC5 — the violation list is written to docs/analysis/threshold-scope-violations.md with a baseline-count header", () => {
  assert.ok(fs.existsSync(DATA_FILE), "ratchet data file must exist");
  const text = fs.readFileSync(DATA_FILE, "utf8");
  const countMatch = text.match(/^# baseline-count:\s*(\d+)/m);
  assert.ok(countMatch, "baseline-count header missing");
  const entries = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"));
  assert.equal(entries.length, Number(countMatch[1]), `entries (${entries.length}) must equal baseline-count (${countMatch[1]})`);
});
