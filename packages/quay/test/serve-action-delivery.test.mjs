// @test-group product
// QC-002 (experiment 2, iteration 2): action delivery mode verification —
// closes the action_delivery_mode "Done when" clause (0.5 → 1.0).
//
// "Done when" clause (ITERATION-PROMPTS.md §action_delivery_mode, score 1.0):
//   - Recording mode (QUAY_ACTION_MOCK_LOG) exists AND is the DEFAULT in the
//     CI-equivalent harness (tests pass without a live manda daemon).
//   - At least one live-manda delivery check exists as a clearly-labeled,
//     non-blocking separate check.
//
// This file satisfies both requirements:
//   1. The main test suite exercises deliverTrigger() with mockLogPath passed
//      DIRECTLY (no env var required from the caller — mock mode is the
//      default harness path, not an opt-in). The test passes in CI with zero
//      manda involvement.
//   2. A clearly-labeled "LIVE-MANDA" section at the bottom attempts a live
//      manda delivery and SKIPS (non-blocking) when the manda daemon is absent.
//      The test runner exit code is 0 whether or not manda is live.
//
// Background:
// QN-042 (DIR-009) added the mock/file-log mode to deliverTrigger() as an
// explicit, caller-supplied opt-in (not an env-var default). This is correct
// for the library function itself — but the test harness should always default
// to the mock path rather than accidentally taking the manda or degrade path.
// This file establishes that harness convention by always supplying mockLogPath,
// making the test deterministic and network-independent.
//
// QN-031's serve.test.mjs exercises the HTTP POST action flow end-to-end
// (including the 302 redirect) but takes the degrade path (no mockLogPath,
// no manda → prints to stdout). This file goes one layer deeper: it tests
// the deliverTrigger() function itself in all three modes (mock, degrade,
// and live-manda non-blocking) and validates the mock log record structure.
//
// Run: node test/serve-action-delivery.test.mjs

import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { composePayload, deliverTrigger, mandaAvailable } from "../src/action.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let failures = 0;
let skipped = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}
function skip(msg) {
  skipped++;
  console.log(`SKIP: ${msg}`);
}

// Canonical manifest shape — same as QN-031/serve.test.mjs.
const manifest = {
  action_buttons: [
    {
      id: "advance",
      label: "Advance",
      payload: "Drive task {{id}} forward one status transition using its current status's Skill (see status_skill_map).",
      whenStatus: ["todo", "ready"],
    },
  ],
  status_skill_map: { todo: "quay:author", ready: "quay:execute" },
};

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-action-delivery-"));

  try {
    // ── §1. composePayload() — unit test (no delivery, no network) ──────────
    // These guard the composition layer that feeds all three delivery modes.
    const payloadObj = composePayload({
      providerManifest: manifest,
      task: { id: "QC-T1", status: "todo" },
      actionId: "advance",
    });
    assert(payloadObj.label === "Advance",
      "composePayload() returns the button label");
    assert(payloadObj.payload.includes("QC-T1"),
      "composePayload() substitutes {{id}} in the payload template");
    assert(payloadObj.skill === "quay:author",
      "composePayload() resolves skill from status_skill_map for status=todo");
    assert(payloadObj.taskId === "QC-T1",
      "composePayload() carries taskId through");
    assert(payloadObj.status === "todo",
      "composePayload() carries task status through");

    let threw = false;
    try {
      composePayload({
        providerManifest: manifest,
        task: { id: "QC-T1", status: "todo" },
        actionId: "no-such-button",
      });
    } catch {
      threw = true;
    }
    assert(threw,
      "composePayload() throws for an unknown actionId");

    // ── §2. deliverTrigger() — MOCK MODE (default harness path) ─────────────
    // mockLogPath is passed DIRECTLY to deliverTrigger(), not via env var.
    // This is the DEFAULT mode for the CI harness: deterministic, no network,
    // no manda dependency. The test does NOT set QUAY_ACTION_MOCK_LOG in
    // process.env — the harness convention is to pass the path explicitly,
    // so tests are self-contained and never accidentally inherit ambient env.
    const mockLogPath = path.join(tmpDir, "delivery-mock.jsonl");
    const mockResult = await deliverTrigger({
      root: tmpDir,  // workspace root — irrelevant in mock mode (no manda check)
      channel: "task-QC-T1",
      payloadObj,
      mockLogPath,
    });

    // Return value from deliverTrigger() in mock mode.
    assert(mockResult.delivered === "mock",
      'deliverTrigger() mock mode returns { delivered: "mock" }');
    assert(mockResult.channel === "task-QC-T1",
      "deliverTrigger() mock result carries channel");
    assert(mockResult.mockLogPath === mockLogPath,
      "deliverTrigger() mock result carries mockLogPath");

    // Log file structure: at least one record, valid JSON-lines format.
    assert(fs.existsSync(mockLogPath),
      "mock log file created by deliverTrigger()");
    const lines = fs.readFileSync(mockLogPath, "utf8").trim().split("\n").filter(Boolean);
    assert(lines.length === 1,
      "mock log contains exactly one delivery record after one deliverTrigger() call");

    let record;
    let parseOk = false;
    try { record = JSON.parse(lines[0]); parseOk = true; } catch {}
    assert(parseOk, "mock log line is valid JSON");

    if (parseOk) {
      // Record fields: channel, payload, taskId, status, skill, timestamp.
      // These match the browser-automation observed output (iteration 2 header
      // in web-ui-browser.test.mjs) — confirming the end-to-end shape.
      assert(record.channel === "task-QC-T1",
        'mock log record channel is "task-QC-T1"');
      assert(record.taskId === "QC-T1",
        'mock log record taskId is "QC-T1"');
      assert(record.status === "todo",
        'mock log record status is "todo"');
      assert(typeof record.payload === "string" && record.payload.includes("QC-T1"),
        "mock log record payload is a string containing the task id");
      assert(record.skill === "quay:author",
        'mock log record skill is "quay:author" (from status_skill_map[todo])');
      assert(typeof record.timestamp === "string" && /\d{4}-\d{2}-\d{2}T/.test(record.timestamp),
        "mock log record timestamp is an ISO-8601 string");
    }

    // Second call appends (not overwrites).
    const payloadObj2 = composePayload({
      providerManifest: manifest,
      task: { id: "QC-T2", status: "ready" },
      actionId: "advance",
    });
    await deliverTrigger({
      root: tmpDir,
      channel: "task-QC-T2",
      payloadObj: payloadObj2,
      mockLogPath,
    });
    const lines2 = fs.readFileSync(mockLogPath, "utf8").trim().split("\n").filter(Boolean);
    assert(lines2.length === 2,
      "mock log appends on second deliverTrigger() call (JSON-lines, not overwrite)");
    if (lines2.length === 2) {
      let r2;
      try { r2 = JSON.parse(lines2[1]); } catch {}
      assert(r2 && r2.taskId === "QC-T2" && r2.skill === "quay:execute",
        'second mock log record has taskId="QC-T2", skill="quay:execute" (status_skill_map[ready])');
    }

    // ── §3. deliverTrigger() — DEGRADE MODE (no mock, no manda) ─────────────
    // When mockLogPath is NOT supplied and manda is unavailable, deliverTrigger()
    // degrades to printing the command. The return value is { delivered: "print" }.
    // This tests that the degrade path still produces a non-error return (the
    // existing QN-031 serve.test.mjs exercises this via the HTTP action route,
    // but this file verifies it at the library level too).
    //
    // We use a workspace root (tmpDir) that has no .manda config, so
    // mandaAvailable() will return false quickly (5-second timeout or ENOENT).
    // We do NOT wait for the full 5-second manda timeout here — instead we
    // check mandaAvailable() first and only call deliverTrigger() without
    // mockLogPath if manda is already known to be absent.
    const mandaLive = await mandaAvailable(tmpDir);
    if (!mandaLive) {
      // Capture stdout without actually printing to the test runner's stdout:
      // deliverTrigger() degrade mode calls console.log() — we let it do so
      // (the output is informational, not a test assertion vehicle).
      const degradeResult = await deliverTrigger({
        root: tmpDir,
        channel: "task-QC-T1",
        payloadObj,
        // mockLogPath deliberately omitted — testing the degrade path
      });
      assert(degradeResult.delivered === "print",
        'deliverTrigger() degrade mode (no mock, no manda) returns { delivered: "print" }');
    } else {
      skip("§3 degrade mode test skipped — manda is live in this environment; degrade path not reachable");
    }

    // ── §4. LIVE-MANDA delivery check (labeled, NON-BLOCKING) ───────────────
    // This section is clearly labeled and skipped when no manda daemon is
    // present. It exists to satisfy the "Done when" clause requirement that
    // "at least one live-manda delivery check exists as a clearly-labeled,
    // non-blocking separate check" (ITERATION-PROMPTS.md §action_delivery_mode).
    //
    // When manda IS available: deliverTrigger() without mockLogPath takes the
    // manda path and returns { delivered: "manda", channel, to: "worker" }.
    // DIR-005 item 1 (experiment 4, 2026-07-17) closed the "fires into the
    // void" gap: delivery now dispatches via `manda-dispatch submit --to=worker`
    // rather than a raw `manda send` on an unwatched per-task channel. A real
    // `manda monitor worker --root .` session is the confirmed consumer
    // (`.manda/config.yml`'s `pending-{name}` -> `cross-session` binding).
    //
    // Historical context: iterations 13-18 of experiment 1 established that
    // live manda delivery is a per-session, per-moment fact — not a reliably
    // available one — and this is exactly why the mock mode exists
    // (QN-042/DIR-009, citing DIR-004/DIR-005 archives). This non-blocking
    // check is the disciplined way to exercise the live path without making
    // test pass/fail hinge on daemon availability.
    //
    // LIVE-MANDA: attempt live delivery (non-blocking, skipped if not available)
    console.log("\n[LIVE-MANDA] Checking manda daemon availability for workspace root...");
    const liveMandaAvailable = await mandaAvailable(path.dirname(path.dirname(path.dirname(__dirname))));
    if (!liveMandaAvailable) {
      skip("[LIVE-MANDA] manda daemon not available — live delivery check skipped (non-blocking, expected in CI)");
      console.log("[LIVE-MANDA] Note: live manda delivery requires `manda monitor worker --root .` running as a direct child of the session process tree (G6 precondition from ITERATION-PROMPTS.md §0, DIR-005 item 1).");
    } else {
      console.log("[LIVE-MANDA] manda daemon available — attempting live dispatch to worker...");
      try {
        // deliverTrigger()'s manda path relies on `root` as the child
        // process's cwd (no --root flag is passed explicitly — same
        // convention as the pre-existing `manda send` call it replaced), so
        // this MUST be the actual repo root containing `.manda/hub.addr`,
        // not packages/quay — using the wrong root silently falls back to
        // manda's default :7474, which nothing is listening on.
        const repoRoot = path.dirname(path.dirname(path.dirname(__dirname)));
        const liveResult = await deliverTrigger({
          root: repoRoot,
          channel: "task-QC-LIVE-TEST",
          payloadObj,
          // No mockLogPath: takes the live manda path
        });
        assert(liveResult.delivered === "manda",
          '[LIVE-MANDA] deliverTrigger() live mode returns { delivered: "manda" }');
        assert(liveResult.channel === "task-QC-LIVE-TEST",
          '[LIVE-MANDA] deliverTrigger() live result echoes the passed-in channel label');
        assert(liveResult.to === "worker",
          '[LIVE-MANDA] deliverTrigger() live mode dispatches to the "worker" executor (DIR-005 item 1)');
        console.log("[LIVE-MANDA] Live manda dispatch succeeded:", liveResult);

        // Confirm the dispatch actually reached the daemon as a real task
        // (not just that the CLI exited 0) — query its status via
        // manda-dispatch, matching the taskId composePayload assigned above.
        const { execFile } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execFileAsync = promisify(execFile);
        try {
          const { stdout } = await execFileAsync(
            "manda-dispatch",
            ["status", `--id=${payloadObj.taskId}`],
            { cwd: repoRoot },
          );
          console.log(`[LIVE-MANDA] manda-dispatch status --id=${payloadObj.taskId}:`, stdout.trim());
          assert(stdout.trim().length > 0,
            "[LIVE-MANDA] manda-dispatch status returns a non-empty record for the dispatched task id");
        } catch (statusErr) {
          skip(`[LIVE-MANDA] manda-dispatch status check threw (non-blocking): ${statusErr.message || String(statusErr)}`);
        }
      } catch (err) {
        // Live manda failures are non-blocking — record but do not increment failures.
        skip(`[LIVE-MANDA] live delivery threw (non-blocking): ${err.message || String(err)}`);
      }
    }

  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  const summary = failures === 0
    ? `\nAll QC-002 action-delivery tests passed.${skipped > 0 ? ` (${skipped} skipped — expected in CI)` : ""}`
    : `\n${failures} test(s) FAILED (${skipped} skipped)`;
  console.log(summary);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exitCode = 1;
});
