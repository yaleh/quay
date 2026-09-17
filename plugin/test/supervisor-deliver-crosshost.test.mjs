// supervisor-deliver-crosshost.test.mjs — the cross-host half of supervisor-deliver.test.mjs, split
// out by gap-ac281-develop-ci-test-job-wallclock-under-30s (GOAL-022 范围第一条：单文件地板 <30s).
//
// Why: `__PERFILE__` on develop run 35283904638 measured supervisor-deliver.test.mjs at 28.2s — one of
// the 18 CI files above 15s, and of the 27–29s cluster that becomes the new floor once the two >40s
// files are split. `node --test` parallelises only ACROSS files, so the file split is the lever.
//
// ⛔ Split by functional boundary, not "half a test": the five tests here drive the REAL
//    ssh-forwarding path through a hermetic mock-ssh; the nine left in the original drive the LOCAL
//    tmux path through a hermetic tmux. They share no mutable state (each makes its own mkdtemp).
//    `userStringLine` is duplicated verbatim on purpose — it is a pure 6-line JSON wrapper, and a
//    shared module for one trivial helper would add an indirection without removing a source of truth.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { newHermeticTmux } from "./helpers/hermetic-tmux.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "..", "scripts", "supervisor-deliver.sh");
const RELIABLE = path.resolve(__dirname, "..", "scripts", "send-keys-reliable.sh");
const CHECKER = path.resolve(__dirname, "..", "scripts", "transcript-delivery-check.ts");


function userStringLine(content) {
  return JSON.stringify({
    parentUuid: "parent", isSidechain: false, type: "user", message: { role: "user", content },
    uuid: "uuid-user-1", timestamp: 1720000000000, permissionMode: "default", userType: "external",
  });
}

// ── AC2/AC3: cross-host delivery (tasks/gap-supervisor-deliver-cross-host-target-support) ─────────
// The gap: supervisor-deliver.sh:155/157/159 were LOCAL tmux send-keys and the checker read the
// transcript with a LOCAL fs.readFileSync — a target on ANOTHER host (e.g. ad-arm1) structurally
// could not be driven. These tests drive the REAL ssh-forwarding code path with a hermetic mock-ssh
// (SUPERVISOR_DELIVER_SSH → fixtures/mock-ssh.sh) that emulates a remote tmux + transcript: the
// PRODUCTION scripts/checker/classifier run exactly the commands they would against real ssh, the
// mock records each call and materializes a REAL user message in the transcript — so "delivered" is
// still the target-transcript content match, never pane echo (ADR-016, AC3 判据不降级).

function mockSshEnv({ transcript, windowName = "inner", pane = "❯", home } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sup-cross-"));
  const log = path.join(tmp, "mock.log");
  const env = {
    ...process.env,
    SUPERVISOR_DELIVER_SSH: path.resolve(__dirname, "fixtures", "mock-ssh.sh"),
    SUPERVISOR_DELIVER_MOCK_LOG: log,
    SUPERVISOR_DELIVER_MOCK_TRANSCRIPT: transcript || "",
    SUPERVISOR_DELIVER_MOCK_WINDOW: windowName,
    SUPERVISOR_DELIVER_MOCK_PANE: pane,
    SUPERVISOR_DELIVER_MOCK_HOME: home || tmp,
    SUPERVISOR_DELIVER_VERIFY_S: "12",
    SUPERVISOR_DELIVER_CAN_RECEIVE_WAIT_S: "3",
    SUPERVISOR_DELIVER_CAN_RECEIVE_POLL_S: "1",
  };
  return { tmp, log, env };
}

function crossHostSends(log) {
  return log.split("\n").filter((l) => l.includes("tmux send-keys"));
}

test("AC2 cross-host fresh path: <host>:<tmux-target> drives 3 SEPARATE ssh send-keys (C-u / -l / Enter) against the STRIPPED target, and the remote transcript verifies delivered", { timeout: 60000 }, () => {
  const transcript = path.join(os.tmpdir(), `cross-fresh-${process.pid}-${Date.now()}.jsonl`);
  const h = mockSshEnv({ transcript, windowName: "outer" });
  const payload = `cross-fresh-marker-${process.pid} 你好 world`;
  try {
    const r = spawnSync(
      "bash",
      [SCRIPT, "ad-arm1.wan.hwang.men:archguard-0:outer", payload, "--transcript", transcript],
      { encoding: "utf8", timeout: 55000, env: { ...h.env, DRIVE_EXPECT_WINDOW_NAME: "outer" } },
    );
    assert.equal(r.status, 0, `cross-host fresh deliver failed (exit ${r.status}):\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
    assert.match(r.stdout, /已送达/, `adapter should report delivery:\n${r.stdout}`);
    // Three SEPARATE ssh send-keys invocations — the "三次分开调用" contract, forwarded over ssh.
    const log = fs.readFileSync(h.log, "utf8");
    const sends = crossHostSends(log);
    assert.equal(sends.length, 3, `three send-keys ssh calls expected, got ${sends.length}:\n${log}`);
    assert.match(sends[0], / C-u /, `1st send-keys is C-u:\n${sends[0]}`);
    assert.match(sends[1], / -l "/, `2nd send-keys is the literal-text send:\n${sends[1]}`);
    assert.match(sends[2], / Enter /, `3rd send-keys is Enter:\n${sends[2]}`);
    for (const line of log.split("\n")) {
      if (!line) continue;
      assert.match(line, /^HOST=ad-arm1\.wan\.hwang\.men /, `every ssh call goes to the target host:\n${line}`);
      assert.doesNotMatch(line, /ad-arm1\.wan\.hwang\.men:archguard-0/, `tmux target must have the host stripped:\n${line}`);
    }
    // The delivered criterion is the REMOTE transcript's committed content — the payload really
    // landed as a user message (the mock materialized it from the base64-forwarded -l payload).
    const text = fs.readFileSync(transcript, "utf8");
    assert.match(text, new RegExp(`"content":"${payload}"`), `payload should be a real user message in the remote transcript:\n${text}`);
  } finally {
    try { fs.rmSync(transcript, { force: true }); } catch { /* best-effort */ }
    try { fs.rmSync(h.tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

test("AC2 --host <fqdn> flag form drives the same ssh-forwarded delivery", { timeout: 60000 }, () => {
  const transcript = path.join(os.tmpdir(), `cross-flag-${process.pid}-${Date.now()}.jsonl`);
  const h = mockSshEnv({ transcript, windowName: "outer" });
  const payload = `cross-flag-marker-${process.pid} 你好`;
  try {
    const r = spawnSync(
      "bash",
      [SCRIPT, "archguard-0:outer", payload, "--host", "ad-arm1.wan.hwang.men", "--transcript", transcript],
      { encoding: "utf8", timeout: 55000, env: { ...h.env, DRIVE_EXPECT_WINDOW_NAME: "outer" } },
    );
    assert.equal(r.status, 0, `--host deliver failed (exit ${r.status}):\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
    assert.match(r.stdout, /已送达/, `adapter should report delivery:\n${r.stdout}`);
    const log = fs.readFileSync(h.log, "utf8");
    assert.equal(crossHostSends(log).length, 3, `three send-keys ssh calls expected:\n${log}`);
    assert.ok(log.includes("HOST=ad-arm1.wan.hwang.men"), `host from --host reaches ssh:\n${log}`);
    const text = fs.readFileSync(transcript, "utf8");
    assert.match(text, new RegExp(`"content":"${payload}"`), `payload should land in the remote transcript:\n${text}`);
  } finally {
    try { fs.rmSync(transcript, { force: true }); } catch { /* best-effort */ }
    try { fs.rmSync(h.tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

test("AC2/AC3 existing-session cross-host: supervisor-deliver delegates to send-keys-reliable over ssh (remote baseline stat + clear loop + literal send + Enter + remote verify)", { timeout: 60000 }, () => {
  const transcript = path.join(os.tmpdir(), `cross-existing-${process.pid}-${Date.now()}.jsonl`);
  fs.writeFileSync(transcript, `${userStringLine("prior-session-msg")}\n`, "utf8"); // NOT fresh → the 5-step path
  const h = mockSshEnv({ transcript, windowName: "inner" });
  const payload = `cross-existing-marker-${process.pid} 你好`;
  try {
    const r = spawnSync(
      "bash",
      [SCRIPT, "ad-arm1.wan.hwang.men:archguard-0:inner", payload, "--transcript", transcript],
      {
        encoding: "utf8",
        timeout: 55000,
        env: {
          ...h.env,
          DRIVE_EXPECT_WINDOW_NAME: "inner",
          RELIABLE_DELIVERY_VERIFY_S: "12",
          RELIABLE_DELIVERY_FIRST_S: "3",
          RELIABLE_DELIVERY_POLL_S: "1",
          RELIABLE_CLEAR_MAX: "3",
          RELIABLE_STABLE_TIMEOUT_S: "2",
        },
      },
    );
    assert.equal(r.status, 0, `cross-host existing deliver failed (exit ${r.status}):\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
    assert.match(r.stdout, /已送达/, `adapter should report delivery:\n${r.stdout}`);
    const log = fs.readFileSync(h.log, "utf8");
    assert.ok(log.includes("stat -c %s"), `baseline is a REMOTE stat over ssh:\n${log}`);
    assert.ok(log.includes("tmux send-keys -t archguard-0:inner -l "), `literal send over ssh against the stripped target:\n${log}`);
    assert.ok(log.includes("tmux send-keys -t archguard-0:inner Enter"), `Enter over ssh:\n${log}`);
    assert.ok(log.includes("cat "), `verify reads the remote transcript via ssh cat:\n${log}`);
    const text = fs.readFileSync(transcript, "utf8");
    assert.match(text, new RegExp(`"content":"${payload}"`), `payload should land in the remote transcript:\n${text}`);
  } finally {
    try { fs.rmSync(transcript, { force: true }); } catch { /* best-effort */ }
    try { fs.rmSync(h.tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

test("AC3 negative control: cross-host delivered is NOT pane echo — when the payload never materializes in the remote transcript the adapter FAILS (no false delivered from a 'looks idle' pane)", { timeout: 60000 }, () => {
  const transcript = path.join(os.tmpdir(), `cross-neg-${process.pid}-${Date.now()}.jsonl`);
  // MOCK_TRANSCRIPT empty → the mock's tmux still reports a waiting-input pane (capture-pane → ❯),
  // but it NEVER writes the payload to a transcript. A degraded "delivered" (pane echo) would pass;
  // the real criterion (remote transcript content) must FAIL.
  const h = mockSshEnv({ transcript: "", windowName: "outer" });
  const payload = `cross-neg-marker-${process.pid}`;
  try {
    const r = spawnSync(
      "bash",
      [SCRIPT, "ad-arm1.wan.hwang.men:archguard-0:outer", payload, "--transcript", transcript],
      { encoding: "utf8", timeout: 55000, env: { ...h.env, DRIVE_EXPECT_WINDOW_NAME: "outer" } },
    );
    assert.equal(r.status, 1, `undelivered cross-host must fail (exit 1), got ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
    assert.match(r.stderr + r.stdout, /FAIL|未出现|未送达/, `must report the undelivered bound, never a false delivered:\n${r.stdout}\n${r.stderr}`);
    assert.doesNotMatch(r.stdout + r.stderr, /已送达/, `must NOT report delivered when the remote transcript lacks the payload:\n${r.stdout}\n${r.stderr}`);
    assert.ok(!fs.existsSync(transcript), "nothing may land in a transcript the mock did not receive");
  } finally {
    try { fs.rmSync(transcript, { force: true }); } catch { /* best-effort */ }
    try { fs.rmSync(h.tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

test("AC2/AC3 --root cross-host: re-spawn discovery finds the NEW remote transcript NOT in the pre-send snapshot and verifies delivery through it", { timeout: 60000 }, () => {
  // The "remote home" (MOCK_HOME) holds ~/.claude/projects/<slug> with an OLD transcript; the mock
  // writes the NEW transcript on the -l send. --root must snapshot the OLD, send, then discover the
  // NEW (not in the snapshot) on the remote.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sup-cross-root-"));
  const home = path.join(tmp, "remote-home");
  const root = path.join(os.tmpdir(), `cross-root-proj-${process.pid}`);
  const slug = root.replace(/\//g, "-");
  const projDir = path.join(home, ".claude", "projects", slug);
  fs.mkdirSync(projDir, { recursive: true });
  const oldTranscript = path.join(projDir, "old-session.jsonl");
  fs.writeFileSync(oldTranscript, `${userStringLine("old-session-msg")}\n`, "utf8");
  const newTranscript = path.join(projDir, "new-session.jsonl");
  const h = mockSshEnv({ transcript: newTranscript, windowName: "outer", home });
  const payload = `cross-root-marker-${process.pid} 你好`;
  try {
    const r = spawnSync(
      "bash",
      [SCRIPT, "ad-arm1.wan.hwang.men:archguard-0:outer", payload, "--root", root],
      { encoding: "utf8", timeout: 55000, env: { ...h.env, DRIVE_EXPECT_WINDOW_NAME: "outer" } },
    );
    assert.equal(r.status, 0, `--root cross-host deliver failed (exit ${r.status}):\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
    assert.match(r.stdout, /fresh-session/, `--root takes the fresh path:\n${r.stdout}`);
    assert.match(r.stdout, /已送达/, `adapter should report delivery:\n${r.stdout}`);
    assert.ok(fs.existsSync(newTranscript), "the NEW remote transcript was created by the send");
    const newText = fs.readFileSync(newTranscript, "utf8");
    assert.match(newText, new RegExp(`"content":"${payload}"`), `payload should appear in the NEW remote transcript:\n${newText}`);
    const oldText = fs.readFileSync(oldTranscript, "utf8");
    assert.doesNotMatch(oldText, new RegExp(payload), `the OLD remote transcript must NOT receive the payload:\n${oldText}`);
    const log = fs.readFileSync(h.log, "utf8");
    assert.ok(log.includes("ls ~/.claude/projects/"), `--root remote discovery lists the remote transcripts dir:\n${log}`);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

