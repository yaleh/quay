// @test-group engine
// measure-suite-reporter-wired.test.mjs — AC4 of
// gap-install-suite-cost-instrument-reporter-not-wired: the REAL full suite must
// actually load measure-suite-reporter.mjs. This is the mechanical anti-regression
// guarantee that prevents the "seventh instance" of instrument-exists-but-not-wired.
//
// The reporter EXISTS and its unit tests PASS (measure-suite.test.mjs) — but that only
// proves "the reporter CAN do it in a temp dir", not "it happened in the real suite".
// The failure mode this test kills: someone edits scripts/test.sh (or
// full-suite-runner.ts) and drops the `--test-reporter` wiring; the reporter's unit
// tests stay green, but the real full suite silently stops emitting per-file wall-clock.
// This test reads scripts/test.sh + full-suite-runner.ts and asserts the wiring is
// present, so removing it flips THIS test red.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { readPerFileCpuMs, readPerFileMemPeakKb } from "../scripts/measure-suite-reporter.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");

const WIRING_PATTERN = /test-reporter|measure-suite-reporter/;

test("scripts/test.sh wires measure-suite-reporter.mjs via --test-reporter (AC4 anti-regression)", () => {
  const testSh = readFileSync(join(repoRoot, "scripts", "test.sh"), "utf8");
  const wired = testSh.match(WIRING_PATTERN);
  assert.ok(
    wired,
    "scripts/test.sh must reference --test-reporter / measure-suite-reporter — if this test goes red, the reporter wiring was REMOVED (the 7th instrument-exists-but-not-wired instance)"
  );
  // The reporter flags must be on the REAL suite's node --test invocations, not just
  // mentioned in a comment. Assert the actual invocation carries `--test-reporter=`.
  assert.match(
    testSh,
    /node --test[^\n]*--test-reporter=|\$\{suite_reporter_flags\}|suite_reporter_flags/,
    "a node --test invocation (or the shared flag helper it uses) must pass --test-reporter on the real suite command line"
  );
});

test("full-suite-runner.ts (if present) also references the reporter path (wiring not lost to the runner)", () => {
  const runner = join(repoRoot, "plugin", "scripts", "full-suite-runner.ts");
  if (!existsSync(runner)) {
    // full-suite-runner is a later addition; its absence is not a wiring failure.
    return;
  }
  const src = readFileSync(runner, "utf8");
  // The runner must not actively REMOVE the reporter (e.g. by splicing a bare
  // --test-reporter that overwrites the custom one). It may reference it or not; the
  // hard contract is the scripts/test.sh wiring asserted above. Here we only assert the
  // runner does not strip a custom --test-reporter= path.
  assert.doesNotMatch(src, /--test-reporter=(?!spec)/, "runner must not splice a bare --test-reporter= that would shadow the custom reporter");
});

test("full-suite-runner.ts wires per-file CPU collection (route a: QUAY_PERFILE_CPU_DIR + NODE_OPTIONS --require preload)", () => {
  const runner = join(repoRoot, "plugin", "scripts", "full-suite-runner.ts");
  if (!existsSync(runner)) return;
  const src = readFileSync(runner, "utf8");
  // gap-perfile-cpu-cost-collection AC1 anti-regression: the per-file CPU carrier env (the dir the
  // preload writes each test file's own process.cpuUsage() into) must be set by the runner, else the
  // reporter's `cpu_ms` goes dark on every production round. Mirrors the --test-reporter wiring check.
  assert.match(src, /QUAY_PERFILE_CPU_DIR/, "full-suite-runner.ts must set QUAY_PERFILE_CPU_DIR (the per-file CPU report dir)");
  assert.match(src, /NODE_OPTIONS/, "full-suite-runner.ts must wire NODE_OPTIONS (the --require preload seam)");
  const preload = join(repoRoot, "plugin", "scripts", "per-file-cpu-report.mjs");
  assert.ok(existsSync(preload), "the route (a) preload module must exist next to the reporter");
});

test("readPerFileCpuMs is a shared named export (suite-scheduler.ts reuses it, never a second reader)", () => {
  // gap-suite-scheduler-perfile-cpu-emitter-missing — the __PERFILE__ line has TWO emission points
  // (this reporter's legacy/LPT path + suite-scheduler.ts's own finishFile). The scheduler must import
  // THIS function rather than reimplementing the .cpu read, or the two paths drift apart again.
  assert.equal(typeof readPerFileCpuMs, "function", "measure-suite-reporter.mjs must export readPerFileCpuMs");
});

// ══ gap-perfile-memory-cost-collection-missing — the PEAK-MEMORY dimension (mem_peak_kb) ═══════════
// The memory mirror of the cpu dimension above. AC1 ("the reading is the kernel's peak, not an
// exit-time snapshot") and AC4 ("the reading can take different values — not a constant") are
// behavioural claims about WHICH KERNEL COUNTER the field carries, so they are pinned END-TO-END: a
// real `node --test` subprocess with the real preload seam wired exactly the way full-suite-runner.ts
// wires it, running a fixture that allocates a large object and then RELEASES it. Only a real process
// can be made to have a peak that differs from its exit-time resident set.

/** Spawn `node --test <fixtures...>` with the route (a) preload seam wired the way the runner wires it
 *  (QUAY_PERFILE_CPU_DIR + NODE_OPTIONS --require), and return the per-file `.mem` readings keyed by
 *  fixture absolute path, plus whatever each fixture wrote to $FIXTURE_OUT.
 *
 *  NODE_TEST_* is SCRUBBED from the child env: node:test stamps NODE_TEST_CONTEXT on nested runners and
 *  an inherited value makes the child SKIP its files and report green (silent no-op — the child would
 *  produce no per-file report at all). Same scrub as suite-scheduler.test.mjs's scheduler spawn. */
function runIsolatedFixtures(dir, fixtures, env = {}) {
  const cpuDir = join(dir, "cpu");
  const childEnv = { ...process.env };
  for (const k of Object.keys(childEnv)) {
    if (k.startsWith("NODE_TEST_")) delete childEnv[k];
  }
  childEnv.QUAY_PERFILE_CPU_DIR = cpuDir;
  const preload = join(repoRoot, "plugin", "scripts", "per-file-cpu-report.mjs");
  childEnv.NODE_OPTIONS = `${childEnv.NODE_OPTIONS ? childEnv.NODE_OPTIONS + " " : ""}--require=${preload} --expose-gc`;
  Object.assign(childEnv, env);
  const r = spawnSync(process.execPath, ["--test", ...fixtures], { encoding: "utf8", env: childEnv });
  assert.equal(r.status, 0, `fixture suite should pass (stderr: ${r.stderr})`);
  /** key contract, byte-identical to the preload writer + the reporter reader */
  const memByFile = new Map();
  for (const f of fixtures) {
    const key = crypto.createHash("sha256").update(path.resolve(f)).digest("hex").slice(0, 16);
    const p = join(cpuDir, `${key}.mem`);
    memByFile.set(f, existsSync(p) ? Number(readFileSync(p, "utf8").trim()) : undefined);
  }
  return { memByFile, stderr: r.stderr };
}

test("AC1/AC4 — mem_peak_kb is the kernel PEAK (not an exit-time rss snapshot) and takes real, differing values", () => {
  const dir = mkdtempSync(join(os.tmpdir(), "perfile-mem-"));
  try {
    // The balloon fixture: allocate ~128MB, hold it (snapshot "during"), RELEASE it, gc, settle.
    const big = join(dir, "balloon.test.mjs");
    const bigOut = join(dir, "balloon.json");
    writeFileSync(
      big,
      `import { test } from "node:test";\nimport fs from "node:fs";\n` +
        `test("balloon", async () => {\n` +
        `  const rssBeforeKb = Math.round(process.memoryUsage().rss / 1024);\n` +
        `  let big = Buffer.alloc(128 * 1024 * 1024, 1);\n` +
        `  big.fill(2);\n` +
        `  const rssDuringKb = Math.round(process.memoryUsage().rss / 1024);\n` +
        `  big = null;\n` +
        `  if (global.gc) { global.gc(); global.gc(); }\n` +
        `  await new Promise((r) => setTimeout(r, 200));\n` +
        `  const rssAfterKb = Math.round(process.memoryUsage().rss / 1024);\n` +
        `  fs.writeFileSync(process.env.FIXTURE_OUT, JSON.stringify({ rssBeforeKb, rssDuringKb, rssAfterKb }));\n` +
        `});\n`,
    );
    // The negative control (AC4): a plain assertion-only file that allocates nothing notable.
    const tiny = join(dir, "tiny.test.mjs");
    writeFileSync(
      tiny,
      `import { test } from "node:test";\nimport assert from "node:assert/strict";\n` +
        `test("tiny", () => { const a = []; for (let i = 0; i < 1000; i++) a.push(i); assert.equal(a.length, 1000); });\n`,
    );

    const { memByFile } = runIsolatedFixtures(dir, [big, tiny], { FIXTURE_OUT: bigOut });

    const bigMem = memByFile.get(big);
    const tinyMem = memByFile.get(tiny);
    assert.equal(typeof bigMem, "number", "the balloon fixture must produce a .mem report (else the seam went dark)");
    assert.equal(typeof tinyMem, "number", "the tiny fixture must produce a .mem report");

    const obs = JSON.parse(readFileSync(bigOut, "utf8"));
    // (AC1) The field captures the PEAK: it is at least the resident set observed while the 128MB was
    // still held. A snapshot taken at exit could NOT satisfy this, because by then the memory is gone.
    assert.ok(
      bigMem >= obs.rssDuringKb - 4096,
      `mem_peak_kb (${bigMem}) must be >= the rss observed while the balloon was held (${obs.rssDuringKb}) — it is a peak reading, not a snapshot`,
    );
    // (AC1, the differential) The fixture really did release the memory, and the peak reading is
    // far ABOVE the exit-time resident set. THIS is the assertion that distinguishes
    // resourceUsage().maxRSS from an exit-time memoryUsage().rss — the latter would under-report here.
    assert.ok(
      obs.rssDuringKb - obs.rssAfterKb > 64 * 1024,
      `fixture precondition: releasing the 128MB must drop rss by >64MB (during=${obs.rssDuringKb}KB after=${obs.rssAfterKb}KB) — got ${obs.rssDuringKb - obs.rssAfterKb}KB`,
    );
    assert.ok(
      bigMem - obs.rssAfterKb > 64 * 1024,
      `mem_peak_kb (${bigMem}) must sit >64MB above the EXIT-TIME rss (${obs.rssAfterKb}) — otherwise the field is an exit snapshot (memoryUsage().rss), which is the exact under-report this task exists to kill`,
    );
    // (AC4) The reading takes DIFFERENT values across files — it is a measurement, not a constant.
    assert.ok(
      bigMem - tinyMem > 50 * 1024,
      `the balloon fixture's peak (${bigMem}KB) must exceed the assertion-only fixture's (${tinyMem}KB) by >50MB — a constant would make this a non-measurement (硬规则 4)`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readPerFileMemPeakKb — shared named export reading <key>.mem; absent ⇒ undefined (never a fabricated 0)", () => {
  const dir = mkdtempSync(join(os.tmpdir(), "mem-read-"));
  try {
    const file = join(dir, "x.test.mjs");
    // The key MUST be sha256(path.resolve(file))[:16] — byte-identical to per-file-cpu-report.mjs's writer.
    const key = crypto.createHash("sha256").update(path.resolve(file)).digest("hex").slice(0, 16);
    writeFileSync(join(dir, `${key}.mem`), "185728\n", "utf8");
    process.env.QUAY_PERFILE_CPU_DIR = dir;
    try {
      assert.equal(readPerFileMemPeakKb(file), 185728, "a written .mem report reads back as a number");
      // Absent report ⇒ undefined (the caller then OMITS mem_peak_kb, never fabricates a 0 — 硬规则 3b).
      assert.equal(readPerFileMemPeakKb(join(dir, "absent.test.mjs")), undefined);
      // The two dimensions are independent files: a .cpu-only report leaves the memory field absent.
      writeFileSync(join(dir, `${key}.cpu`), "12.5\n", "utf8");
      assert.equal(readPerFileCpuMs(file), 12.5, "cpu dimension unaffected");
    } finally {
      delete process.env.QUAY_PERFILE_CPU_DIR;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mem_peak_kb source: the preload reads resourceUsage().maxRSS (the kernel peak), never memoryUsage().rss", () => {
  // Positional anti-regression (硬规则 2 — 按位置判定,不按关键词): the differential above proves the
  // BEHAVIOUR; this pins the SOURCE, so a future "simplification" to process.memoryUsage().rss is caught
  // even if the fixture happens not to diverge on that host.
  //
  // ⛔ The file's COMMENTS legitimately NAME `process.memoryUsage().rss` (to explain what the field
  // deliberately is not) — so this check must strip comment lines FIRST and match the CODE only. A bare
  // `assert.doesNotMatch(src, /memoryUsage\(\)\.rss/)` reds on the documentation, not on a regression:
  // the same "命中注释不算命中" distinction 硬规则 2 exists to enforce (it caught this very test).
  const src = readFileSync(join(repoRoot, "plugin", "scripts", "per-file-cpu-report.mjs"), "utf8");
  const code = src
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");
  assert.match(code, /process\.resourceUsage\(\)\.maxRSS/, "the memory reading must come from process.resourceUsage().maxRSS");
  assert.doesNotMatch(
    code,
    /memoryUsage\(\)\.rss/,
    "the preload's CODE must NOT read process.memoryUsage().rss — an exit-time snapshot systematically under-reports the peak (mentions in comments are expected and excluded above)",
  );
  assert.match(code, /memPeakKb|\.mem`/, "the preload must be the writer of the .mem report");
});

test("both __PERFILE__ emission points append mem_peak_kb (reporter legacy path + unified scheduler)", () => {
  // gap-suite-scheduler-perfile-cpu-emitter-missing is the precedent: the __PERFILE__ line has TWO
  // independent emission points, and fixing only one leaves the PRODUCTION default dark. The scheduler
  // path (QUAY_SUITE_SCHEDULER=1, default since 2026-08-31) must carry the field too, and must obtain it
  // from the reporter's shared reader rather than a second hand-rolled read.
  const reporter = readFileSync(join(repoRoot, "plugin", "scripts", "measure-suite-reporter.mjs"), "utf8");
  const scheduler = readFileSync(join(repoRoot, "plugin", "scripts", "suite-scheduler.ts"), "utf8");
  for (const [name, src] of [["measure-suite-reporter.mjs", reporter], ["suite-scheduler.ts", scheduler]]) {
    assert.match(src, /mem_peak_kb=\$\{/, `${name} must append mem_peak_kb to its __PERFILE__ line`);
    assert.match(src, /readPerFileMemPeakKb/, `${name} must read it through the shared readPerFileMemPeakKb`);
  }
  assert.equal(typeof readPerFileMemPeakKb, "function", "measure-suite-reporter.mjs must export readPerFileMemPeakKb");
});
