// worker-driver-suite-oom-attribution.test.mjs —
// gap-full-suite-scope-oom-policy-stops-whole-suite-unattributable (AC4 / AC5).
//
// The defect this closes: a whole-suite TERM caused by a single OOM-killed process leaves NO failing test
// file in the suite log ⇒ `judgeRetryExemption` computed 0-of-N and returned `insufficient-data-fallback`
// ⇒ the driver's stop note said 「infra/contract suspected」 and parked the task, burning 1–2 worker rounds.
// The fix: the runner now lands per-run cgroup evidence (`suite-memory-evidence-<runId>.json`); when
// `oom_kill>0` the red is classified `suite-oom` with the MEASURED peak/limit/phase.
//
// AC4 — a red with evidence ⇒ verdict `suite-oom` (reason names peak + limit); a red WITHOUT evidence ⇒
//        the PRE-CHANGE 「无法归因」 reason, verbatim (so the new branch cannot leak into the old path).
// AC5 — the falsification control: the positive case exercises exactly the evidence read (删掉它 ⇒ 该用例红).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  judgeRetryExemption,
  suiteRunIdFromOutcome,
  readSuiteMemoryEvidence,
  suiteOomReason,
} from "../scripts/worker-driver.ts";

const TASK = "gap-example-task";
const RUN_ID = "mfi-gap-example-task-1700000000000-abc123";

/** A temp root with the `.quay/` carrier the judgment reads. */
function makeRoot({ withEvidence }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-oom-attrib-"));
  const quay = path.join(root, ".quay");
  fs.mkdirSync(quay, { recursive: true });
  const suiteLog = `fan-in-suite-${TASK}~${RUN_ID}~1.log`;
  // The phenomenon's shape: the scope was TERM'd, so the log ends with the abort line and carries NO
  // failing test file (`suite-watchdog` is a pseudo-stage token, not a file).
  fs.writeFileSync(
    path.join(quay, suiteLog),
    ["# tests 0", "# pass 0", "# fail 0", "not ok - suite-watchdog: terminated by an external signal before the suite finished", ""].join("\n"),
    "utf8",
  );
  if (withEvidence) {
    fs.writeFileSync(
      path.join(quay, `suite-memory-evidence-${RUN_ID}.json`),
      JSON.stringify({
        runId: RUN_ID,
        peakBytes: 4 * 1024 * 1024 * 1024, // 4.0 GiB observed peak
        memoryMaxBytes: 3 * 1024 * 1024 * 1024, // MemoryMax=3G
        oom: 2,
        oomKill: 1,
        phase: "main",
        scopeUnit: "run-abc.scope",
        samples: 12,
        capturedAt: "2026-10-10T00:00:00.000Z",
      }),
      "utf8",
    );
  }
  return { root, suiteLog };
}

const outcomeFor = (suiteLog) => ({ mechanical_fan_in: { step: "suite", suiteLog } });

test("AC4 — a red whose per-run evidence shows oom_kill>0 is classified `suite-oom`, naming peak and limit", () => {
  const { root, suiteLog } = makeRoot({ withEvidence: true });
  try {
    const j = judgeRetryExemption(root, TASK, outcomeFor(suiteLog));
    assert.equal(j.verdict, "suite-oom", "an OOM-killed round is its own verdict, not insufficient-data-fallback");
    assert.match(j.reason, /OOM-killed 1 process/, "the reason names the OOM kill count");
    assert.match(j.reason, /phase 'main'/, "the reason names the phase the OOM happened in");
    // peak vs limit — the two readings the stop note must carry (instead of 「基建/契约疑似」).
    assert.match(j.reason, /peak 4096\.0 MiB/, "the reason names the peak in MiB");
    assert.match(j.reason, /MemoryMax 3072\.0 MiB/, "the reason names the MemoryMax limit in MiB");
    assert.equal(j.failingTestFiles.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC4 negative control — a red WITHOUT evidence keeps the PRE-CHANGE 「无法归因」 reason, verbatim", () => {
  const { root, suiteLog } = makeRoot({ withEvidence: false });
  try {
    const j = judgeRetryExemption(root, TASK, outcomeFor(suiteLog));
    assert.equal(j.verdict, "insufficient-data-fallback", "no evidence ⇒ the existing fallback (behaviour unchanged)");
    // ⛔ 逐字不变 — this is the pre-change string (the new branch must not alter the no-evidence path).
    assert.equal(
      j.reason,
      "no failing test file extracted from the suite log (parser extracted 0 of 1 failing lines; pseudo-stage tokens: suite-watchdog)",
      "the no-evidence reason is byte-for-byte the pre-change one",
    );
    assert.doesNotMatch(j.reason, /OOM/i, "the OOM wording must never appear without evidence");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC5 falsification control — the classification reads THIS round's evidence by runId (删掉证据读取 ⇒ 正例红)", () => {
  const { root, suiteLog } = makeRoot({ withEvidence: true });
  try {
    // The runId is derived from the mechanical fan-in suite-log basename (`<stem>~<runId>~<attempt>.log`).
    assert.equal(suiteRunIdFromOutcome(outcomeFor(suiteLog)), RUN_ID, "the runId is extracted from the suite-log basename");
    assert.equal(suiteRunIdFromOutcome({ mechanical_fan_in: { step: "suite", suiteLog: "no-tildes.log" } }), null, "a non-canonical basename ⇒ null (缺值 ≠ 某个 runId)");
    assert.equal(suiteRunIdFromOutcome({}), null);

    const ev = readSuiteMemoryEvidence(root, RUN_ID);
    assert.ok(ev, "the evidence is read for THIS runId");
    assert.equal(ev.oomKill, 1);
    // A DIFFERENT runId must NOT resolve to this file (⛔ not the newest file — a concurrent suite's
    // evidence must never be mis-attributed).
    assert.equal(readSuiteMemoryEvidence(root, "some-other-run"), null, "a foreign runId does not read another round's evidence");
    // …and with the evidence read removed, the SAME outcome resolves to the fallback — the exact reading
    // the `suite-oom` branch depends on (this is what makes the positive case a real test, not an echo).
    assert.equal(judgeRetryExemption(root, TASK, outcomeFor(suiteLog)).verdict, "suite-oom");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("unit — suiteOomReason renders `unknown` for an unrecorded peak/limit (⛔ never a fabricated 0)", () => {
  const reason = suiteOomReason({
    runId: "r",
    peakBytes: null,
    memoryMaxBytes: null,
    oom: 0,
    oomKill: 3,
    phase: "",
    scopeUnit: null,
    samples: 0,
    capturedAt: "",
  });
  assert.match(reason, /OOM-killed 3 process/);
  assert.match(reason, /peak unknown/);
  assert.match(reason, /MemoryMax unset/);
  assert.match(reason, /phase '\?'/);
});
