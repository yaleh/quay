// QN-042 (DIR-009): regression test for action.js's new deterministic
// mock/file-log delivery mode in deliverTrigger() — a THIRD mode, additive
// to (and independent of) the existing `manda` path and the stdout-print
// degrade path (see src/action.js's own doc comment, and
// docs/proposals/quay-core-scope-expansion-discussion.md §2.3 for the
// original reasoning this directive implements).
//
// This test is deliberately network-independent and does NOT exercise or
// gate on live manda delivery at all — per DIR-008/§2.3's standing
// constraint (see experiments/quay-native-bootstrap/directives/archive/DIR-004-*.md and
// DIR-005-*.md: live manda delivery has repeatedly been shown to be a
// per-session, per-moment fact, not a reliably available one). The whole
// point of this mode is to give action-composition logic a delivery path
// whose correctness can be asserted deterministically, without depending on
// manda being armed in this environment at test time.
//
// Run: node test/action-mock-delivery.test.mjs

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { composePayload, deliverTrigger } from "../src/action.ts";

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

const manifest = {
  action_buttons: [
    { id: "advance", label: "Advance", payload: "Drive task {{id}} forward.", whenStatus: ["todo", "ready"] },
  ],
  status_skill_map: { todo: "quay:author", ready: "quay:execute" },
};

async function main() {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-action-mock-test-"));
  const mockLogPath = path.join(workDir, "nested", "delivery-log.jsonl");

  // Compose a real trigger payload via the existing action-composition code
  // path (not a hand-built fixture object), exactly as the directive
  // requests ("compose a real trigger payload via the existing
  // action-composition code path").
  const payloadObj = composePayload({
    providerManifest: manifest,
    task: { id: "QN-042-fixture", status: "todo" },
    actionId: "advance",
  });

  // --- 1. mockLogPath supplied -> mock mode is selected, distinguishable
  //        return value, regardless of whether manda happens to be armed ---
  const result1 = await deliverTrigger({
    root: workDir,
    channel: "task-QN-042-fixture",
    payloadObj,
    mockLogPath,
  });
  assert(result1.delivered === "mock", `deliverTrigger() with mockLogPath returns delivered:"mock" (got ${JSON.stringify(result1.delivered)})`);
  assert(result1.channel === "task-QN-042-fixture", "mock-mode result carries the channel through");
  assert(result1.mockLogPath === mockLogPath, "mock-mode result echoes back the mockLogPath used");

  // --- 2. the file was actually created, including its parent directory,
  //        which did not exist before this call ---
  assert(fs.existsSync(mockLogPath), "mock delivery log file was created (including its non-existent parent dir)");

  // --- 3. the record is structured JSON-lines, one record per delivery
  //        attempt, with at least channel/payload/timestamp fields ---
  let lines = fs.readFileSync(mockLogPath, "utf8").trim().split("\n").filter(Boolean);
  assert(lines.length === 1, `mock log has exactly 1 line after 1 delivery (got ${lines.length})`);
  let record1 = JSON.parse(lines[0]);
  assert(record1.channel === "task-QN-042-fixture", "record 1: channel field is correct");
  assert(record1.payload === "Drive task QN-042-fixture forward.", "record 1: payload field carries the composed payload");
  assert(record1.taskId === "QN-042-fixture", "record 1: taskId field is present");
  assert(record1.status === "todo", "record 1: status field is present");
  assert(record1.skill === "quay:author", "record 1: skill field is resolved from status_skill_map");
  assert(typeof record1.timestamp === "string" && !Number.isNaN(Date.parse(record1.timestamp)),
    "record 1: timestamp field is present and parses as a valid date");

  // --- 4. a second delivery attempt APPENDS (one record per attempt), does
  //        not overwrite ---
  const payloadObj2 = composePayload({
    providerManifest: manifest,
    task: { id: "QN-042-fixture-2", status: "ready" },
    actionId: "advance",
  });
  const result2 = await deliverTrigger({
    root: workDir,
    channel: "task-QN-042-fixture-2",
    payloadObj: payloadObj2,
    mockLogPath,
  });
  assert(result2.delivered === "mock", "second delivery also returns delivered:\"mock\"");
  lines = fs.readFileSync(mockLogPath, "utf8").trim().split("\n").filter(Boolean);
  assert(lines.length === 2, `mock log has exactly 2 lines after 2 deliveries (got ${lines.length}, confirms append not overwrite)`);
  const record2 = JSON.parse(lines[1]);
  assert(record2.channel === "task-QN-042-fixture-2", "record 2: channel field reflects the second delivery, not a stale/overwritten first record");
  assert(record2.skill === "quay:execute", "record 2: skill field correctly resolves 'ready' status via status_skill_map");
  // Re-parse record 1 to confirm it is untouched by the second append.
  record1 = JSON.parse(lines[0]);
  assert(record1.channel === "task-QN-042-fixture", "record 1 is unchanged after a second, independent append");

  // --- 5. mockLogPath omitted -> NOT mock mode; falls through to whichever
  //        of the two PRE-EXISTING paths (`manda` or stdout-print degrade)
  //        this environment happens to take, unmodified by this task. This
  //        assertion deliberately does NOT gate pass/fail on which of those
  //        two pre-existing paths is actually reachable at test-run time —
  //        per DIR-008/§2.3's standing constraint, live manda reachability
  //        (as distinct from the `manda` binary + `manda events health`
  //        merely being present, which is all mandaAvailable() checks) is a
  //        per-session, per-moment fact, not a reliably available one (this
  //        very run demonstrated the gap: mandaAvailable() returned true in
  //        this sandbox, but the actual `manda send` call still failed with
  //        a connection-refused error — exactly the kind of live-delivery
  //        flakiness this whole mock mode exists to sidestep, not
  //        re-verify). The only thing asserted here is the one fact this
  //        directive requires: omitting mockLogPath must NOT select the mock
  //        mode, i.e. delivered !== "mock". ---
  let result3;
  let threw3 = false;
  try {
    result3 = await deliverTrigger({
      root: workDir,
      channel: "task-QN-042-fixture-3",
      payloadObj,
    });
  } catch {
    // A live manda-send failure (connection refused, etc.) is an existing,
    // pre-DIR-009 code path's own behavior (deliverTrigger does not catch
    // execFileAsync("manda", ["send", ...]) errors) — unrelated to and
    // unchanged by this task. Swallow it here only to keep this specific
    // assertion (mock mode was correctly NOT selected) independent of that
    // pre-existing, unrelated live-delivery flakiness.
    threw3 = true;
  }
  assert(threw3 || result3.delivered !== "mock",
    `omitting mockLogPath never selects the mock mode (delivered was ${threw3 ? "an unrelated manda-send error, not mock" : JSON.stringify(result3.delivered)})`);
  // NOTE: an earlier draft of this test also tried to force a deterministic
  // print-degrade assertion by calling mandaAvailable() directly against a
  // synthetic "bogus" root, expecting it to reliably return false. Re-running
  // this test file multiple times in this same sandbox showed mandaAvailable()
  // itself is NOT deterministic here across runs (observed both `true`, via a
  // successful `manda events health` call, and a `spawn manda ENOENT`
  // rejection depending on transient PATH/process state) — a second, direct
  // demonstration of exactly the live-manda flakiness DIR-004/DIR-005/§2.3
  // already found, this time in the *detection* step rather than the *send*
  // step. That attempted assertion was removed rather than left in as a
  // flaky test, since asserting on mandaAvailable()'s live return value is
  // precisely the anti-pattern this directive instructs against; the
  // try/catch assertion above (which tolerates either pre-existing outcome
  // and only checks that mock mode is never wrongly selected) is the correct,
  // deterministic-in-outcome replacement.

  // --- 6. composePayload edge cases: missing/undefined/empty payload ---
  { // Test: payload field omitted entirely
    let threw = false;
    let errMsg = "";
    try {
      composePayload({
        providerManifest: {
          action_buttons: [{ id: "no-payload", label: "No Payload" }],
        },
        task: { id: "TEST-1", status: "todo" },
        actionId: "no-payload",
      });
    } catch (e) {
      threw = true;
      errMsg = e.message;
    }
    assert(threw, "composePayload throws when button.payload is undefined (field omitted)");
    assert(
      errMsg.includes("no-payload") && errMsg.includes("no payload"),
      `composePayload undefined-payload error names the button and mentions 'no payload' (got: ${errMsg})`,
    );
  }

  { // Test: payload is explicitly null
    let threw = false;
    let errMsg = "";
    try {
      composePayload({
        providerManifest: {
          action_buttons: [{ id: "null-payload", label: "Null", payload: null }],
        },
        task: { id: "TEST-2", status: "todo" },
        actionId: "null-payload",
      });
    } catch (e) {
      threw = true;
      errMsg = e.message;
    }
    assert(threw, "composePayload throws when button.payload is null");
    assert(
      errMsg.includes("null-payload") && errMsg.includes("no payload"),
      `composePayload null-payload error names the button and mentions 'no payload' (got: ${errMsg})`,
    );
  }

  { // Test: payload is an empty string
    let threw = false;
    let errMsg = "";
    try {
      composePayload({
        providerManifest: {
          action_buttons: [{ id: "empty-payload", label: "Empty", payload: "" }],
        },
        task: { id: "TEST-3", status: "todo" },
        actionId: "empty-payload",
      });
    } catch (e) {
      threw = true;
      errMsg = e.message;
    }
    assert(threw, "composePayload throws when button.payload is an empty string");
    assert(
      errMsg.includes("empty-payload") && errMsg.includes("no payload"),
      `composePayload empty-payload error names the button and mentions 'no payload' (got: ${errMsg})`,
    );
  }

  { // Test: payload is whitespace-only string
    let threw = false;
    let errMsg = "";
    try {
      composePayload({
        providerManifest: {
          action_buttons: [{ id: "ws-payload", label: "WS", payload: "   " }],
        },
        task: { id: "TEST-4", status: "todo" },
        actionId: "ws-payload",
      });
    } catch (e) {
      threw = true;
      errMsg = e.message;
    }
    assert(threw, "composePayload throws when button.payload is a whitespace-only string");
    assert(
      errMsg.includes("ws-payload") && errMsg.includes("no payload"),
      `composePayload whitespace-payload error names the button and mentions 'no payload' (got: ${errMsg})`,
    );
  }

  { // Test: valid payload still works (regression guard)
    let threw = false;
    let result;
    try {
      result = composePayload({
        providerManifest: {
          action_buttons: [{ id: "good", label: "Good", payload: "Drive {{id}}." }],
          status_skill_map: { todo: "quay:author" },
        },
        task: { id: "REGRESS-1", status: "todo" },
        actionId: "good",
      });
    } catch (e) {
      threw = true;
    }
    assert(!threw, "composePayload does NOT throw when payload is a valid string (regression guard)");
    assert(result.payload === "Drive REGRESS-1.", `payload substitution works (got: ${result.payload})`);
    assert(result.label === "Good", `label is correct (got: ${result.label})`);
  }

  fs.rmSync(workDir, { recursive: true, force: true });

  console.log(failures === 0
    ? "\nAll QN-042 mock/file-log delivery-mode regression tests passed."
    : `\n${failures} test(s) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
