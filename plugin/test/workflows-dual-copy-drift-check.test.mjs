// @test-group engine
// workflows-dual-copy-drift-check.test.mjs — tasks/gap-workflows-dual-copy-drift-unchecked
// (plugin/scripts/workflows-dual-copy-drift-check.ts). 判据1 的 RED/GREEN 负控制 +
// 判据2 能取假 + AC2 现状回放绿。
//
// Coverage map (task ACs):
//   AC1/判据1 — the drift check lands and REDs on drift: a one-sided edit of ONE copy of a
//         dual-copy file must go exit-1 (hard mode); the byte-identical baseline goes exit-0.
//   AC2/判据2 (能取假) — 单边改回放红；现状逐字同回放绿. Both directions proven on hermetic
//         fixtures (a temp root built from minimal dual-copy pairs), PLUS the live-repo replay:
//         after the task's reconciliation, all five real pairs are byte-identical ⇒ GREEN.
//   AC2/硬规则 3a (枚举不布尔) — a file MISSING from one side is a DRIFT state ⇒ RED
//         (a dual-copy file deleted from one dir must not silently stop being covered).
//   AC3/判据3 — the --no-block seam (report-only, exit 0) mirrors the execution-core drift gate's
//         pre-existing-drift window (tick-core-static-check --check-drift --no-block), so a
//         pre-existing drift is VISIBLE without halting unrelated commits until reconciled.
//
// Every fixture is a temp root built from minimal files; nothing is hardcoded to a global count.
//
// Run:
//   scripts/test.sh plugin/test/workflows-dual-copy-drift-check.test.mjs
//   node --test plugin/test/workflows-dual-copy-drift-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHECKER = path.join(__dirname, "..", "scripts", "workflows-dual-copy-drift-check.ts");
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const DUAL_COPY_FILES = ["drain-directives.js", "fan-in-execute.js", "run-routines.js", "execute-suite-fix.js", "pool-quality-judge.js"];

/** Build a hermetic fixture root with all five dual-copy pairs byte-identical. Returns {root,
 *  landed(file)→abs, shipped(file)→abs} so a test can then mutate ONE side. */
function buildFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wfdcd-"));
  const abs = {};
  for (const f of DUAL_COPY_FILES) {
    const landed = path.join(root, ".claude", "workflows", f);
    const shipped = path.join(root, "plugin", "workflows", f);
    fs.mkdirSync(path.dirname(landed), { recursive: true });
    fs.mkdirSync(path.dirname(shipped), { recursive: true });
    const content = `// ${f} — fixture dual-copy baseline\nmodule.exports = { id: "${f}" };\n`;
    fs.writeFileSync(landed, content);
    fs.writeFileSync(shipped, content);
    abs[f] = { landed, shipped };
  }
  return { root, abs };
}

function runChecker(args) {
  return spawnSync(
    "node",
    ["--no-warnings", "--experimental-strip-types", CHECKER, ...args],
    { encoding: "utf8" },
  );
}

test("AC1/判据1: a byte-identical fixture baseline is GREEN (exit 0)", () => {
  const { root } = buildFixture();
  try {
    const res = runChecker(["--root", root]);
    assert.equal(res.status, 0, `byte-identical baseline should be green: ${res.stdout} ${res.stderr}`);
    assert.match(res.stdout, /5 consistent \/ 0 drifted/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2/判据2 能取假: a one-sided edit of ONE copy goes RED (exit 1)", () => {
  const { root, abs } = buildFixture();
  try {
    // 单边改: only the .claude/ (landed) copy of fan-in-execute.js gets a new line.
    fs.writeFileSync(abs["fan-in-execute.js"].landed,
      fs.readFileSync(abs["fan-in-execute.js"].landed, "utf8") + "// one-sided edit\n");
    const res = runChecker(["--root", root]);
    assert.equal(res.status, 1, `a drifted pair must be red: ${res.stdout} ${res.stderr}`);
    assert.match(res.stdout, /4 consistent \/ 1 drifted/);
    assert.match(res.stdout, /DRIFT: \.claude\/workflows\/fan-in-execute\.js/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2/硬规则 3a: a file MISSING from one side is a drift state ⇒ RED (exit 1)", () => {
  const { root, abs } = buildFixture();
  try {
    fs.rmSync(abs["run-routines.js"].shipped); // delete the plugin/ copy entirely
    const res = runChecker(["--root", root]);
    assert.equal(res.status, 1, `a missing side must be red (absent ≠ 合格, 硬规则 3a): ${res.stdout} ${res.stderr}`);
    assert.match(res.stdout, /DRIFT: \.claude\/workflows\/run-routines\.js \(.*\) vs plugin\/workflows\/run-routines\.js \(MISSING lines\)/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC3/判据3: --no-block is report-only — a drifted pair prints RED but exits 0", () => {
  const { root, abs } = buildFixture();
  try {
    fs.writeFileSync(abs["drain-directives.js"].shipped, "// different shipped copy\n");
    const res = runChecker(["--root", root, "--no-block"]);
    assert.equal(res.status, 0, `--no-block must not halt: ${res.stdout} ${res.stderr}`);
    assert.match(res.stdout, /RED — workflows dual-copy drift gate violated/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2 现状回放绿: the live repo's five real dual-copy pairs are byte-identical ⇒ GREEN", () => {
  const res = runChecker(["--root", REPO_ROOT]);
  assert.equal(res.status, 0,
    `the reconciled live repo must be green — the task reconciles the pre-existing fan-in-execute.js drift: ${res.stdout} ${res.stderr}`);
  assert.match(res.stdout, /5 consistent \/ 0 drifted/);
});
