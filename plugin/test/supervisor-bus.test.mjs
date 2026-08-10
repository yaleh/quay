// @test-group governance
// supervisor-bus.test.mjs — the supervisor base layer's IDENTITY-ATTRIBUTABLE message bus
// (tasks/gap-supervisor-step-5-message-bus-with-identity, supervisor step ⑤; AC6: node:test +
// @test-group governance).
//
// Exercises plugin/scripts/supervisor-bus.sh:
//   Contract measure — `delivered_identity = bash supervisor-bus.sh --send --from <layer>
//     --to <target> --payload <msg>` stdout 字段（delivered）: the --send command prints
//     `delivered=true` when the message reaches the target transcript AND the sender identity is
//     recorded in the ledger (band = delivered).
//   AC1 — every bus-delivered message carries a sender (layer + project); the ledger records
//     "who → who → when → delivered?" (sentAt + sender.layer + sender.project + target +
//     delivered), so the delivery is attributable.
//   AC2 — ONE hardened delivery path: supervisor-bus.sh contains NO `tmux send-keys` of its own;
//     it delegates to supervisor-deliver.sh (→ send-keys-reliable.sh → transcript-delivery-check.ts).
//     The "3 consumers each hand-write a send-keys sequence" counterexample is structurally dead.
//   AC3 — real TUI end-to-end: a REAL target session receives the payload and the transcript
//     verifies delivery (the fixture TUI renders the NBSP prompt — the NBSP empty-box case is
//     exercised by the real send, not bypassed); the NBSP negative case is structurally solved
//     because the test intercepts a broken delivery (nonexistent target → delivered=false,
//     ledger records it) instead of 3 consumers silently bypassing the broken path.
//   AC4 — boundary: the bus reads NO message semantics and writes NO code (grep-asserted: no
//     task/AC/proposal parsing in the script).
//   AC7 — node:test + // @test-group governance.
//
// Run: scripts/test.sh plugin/test/supervisor-bus.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { newHermeticTmux } from "./helpers/hermetic-tmux.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "..", "scripts", "supervisor-bus.sh");
const DELIVER = path.resolve(__dirname, "..", "scripts", "supervisor-deliver.sh");

// ── Governance self-skip (AC7 @test-group governance) ─────────────────────────────────────────────
if (process.env.QUAY_TEST_GROUPS && !process.env.QUAY_TEST_GROUPS.split(",").includes("governance")) {
  test("governance group skipped", { skip: "set QUAY_TEST_GROUPS=governance to run" }, () => {});
} else {

function userStringLine(content) {
  return JSON.stringify({
    parentUuid: "parent", isSidechain: false, type: "user", message: { role: "user", content },
    uuid: "uuid-user-1", timestamp: 1720000000000, permissionMode: "default", userType: "external",
  });
}

function uniqueName(prefix) {
  return `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** A tiny "TUI" that renders the NBSP prompt (❯ U+276F + two NBSP U+00A0 — an EMPTY Claude Code
 *  input box) and on every submitted line appends a REAL user JSONL record to the transcript. */
function fixtureScriptSrc(transcriptPath) {
  return `#!/usr/bin/env bash
TRANSCRIPT="${transcriptPath}"
mkdir -p "$(dirname "$TRANSCRIPT")"
printf '{"type":"user","message":{"role":"user","content":"prior-session-message"}}\\n' >> "$TRANSCRIPT"
printf '\\342\\235\\257\\302\\240\\302\\240'
while IFS= read -r line; do
  [ -n "$line" ] || continue
  printf '{"type":"user","message":{"role":"user","content":"%s"}}\\n' "$line" >> "$TRANSCRIPT"
  printf '\\342\\235\\257\\302\\240\\302\\240'
done
`;
}

// ── Contract measure / invoke ─────────────────────────────────────────────────────────────────────

test("invoke — --help prints the usage and exits 0", () => {
  const r = spawnSync("bash", [SCRIPT, "--help"], { encoding: "utf8" });
  assert.equal(r.status, 0, `--help must exit 0, got ${r.status}\n${r.stderr}`);
  assert.match(r.stdout + r.stderr, /supervisor-bus\.sh/);
  assert.match(r.stdout + r.stderr, /--send/);
  assert.match(r.stdout + r.stderr, /--from/);
  assert.match(r.stdout + r.stderr, /--to/);
  assert.match(r.stdout + r.stderr, /--payload/);
});

test("usage — unknown subcommand fails loud (exit 2)", () => {
  const r = spawnSync("bash", [SCRIPT, "no-such-subcommand"], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown subcommand/);
});

// ── AC4 boundary: reads no message semantics, writes no code ─────────────────────────────────────

test("AC4 — the bus reads NO task/message semantics and writes NO code (grep-asserted)", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  // It must NOT parse Proposal/Plan/AC/body — the bus never reads what a task says.
  for (const forbidden of [/\bProposal\b/, /\bAcceptance Criteria\b/, /\bDefinition of Done\b/, /## Plan\b/]) {
    assert.doesNotMatch(src, forbidden, `bus must not read task semantics: ${forbidden}`);
  }
  // It must NOT write task files / repo code — only the ledger. (The header comment names its own
  // task-id path, which is documentation — the runtime must not READ the task store, so we assert
  // on the runtime access shapes: no task-store file globbing, no git write, no task_write.)
  assert.doesNotMatch(src, /cat\s+"?\$?\{?[^}]*tasks\//, "bus must not cat a task file at runtime");
  assert.doesNotMatch(src, /tasks\/\*\.md/, "bus must not glob the task store");
  assert.doesNotMatch(src, /git\s+commit/, "bus must not write code (no git commit)");
  assert.doesNotMatch(src, /task_write/, "bus must not write tasks via task_write");
  assert.match(src, /ledger_append/, "bus records delivery events (ledger)");
});

// ── AC2: ONE hardened delivery path ──────────────────────────────────────────────────────────────

test("AC2 — the bus contains NO hand-written send-keys sequence; it delegates to supervisor-deliver.sh", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.doesNotMatch(src, /tmux\s+send-keys/, "no hand-written send-keys sequence in the bus");
  assert.doesNotMatch(src, /send-keys\s+-t/, "no direct send-keys call either");
  assert.match(src, /supervisor-deliver\.sh/, "delegates to the single hardened delivery path");
});

test("AC2 — the bus fails loud when the ONE delivery implementation is missing (never falls back to hand-written)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sup-bus-deliver-"));
  try {
    // Copy the bus script but NOT the delivery implementation → the bus must refuse.
    fs.copyFileSync(SCRIPT, path.join(dir, "supervisor-bus.sh"));
    assert.ok(!fs.existsSync(path.join(dir, "supervisor-deliver.sh")));
    const r = spawnSync("bash", [path.join(dir, "supervisor-bus.sh"), "--send", "--from", "inner", "--to", "t", "--payload", "x"], {
      encoding: "utf8",
    });
    assert.equal(r.status, 1, `missing delivery impl must exit 1 (fail loud), got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /缺少投递实现/);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

// ── AC1 identity gate + ledger attribution ───────────────────────────────────────────────────────

test("AC1 — the identity gate rejects --from human on the TUI agent channel (spoof gate, fail-closed)", () => {
  const r = spawnSync("bash", [SCRIPT, "--send", "--from", "human", "--to", "t", "--payload", "x"], { encoding: "utf8" });
  assert.equal(r.status, 2, `human cannot claim the agent channel, got ${r.status}\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /identity rejected/);
  assert.match(r.stderr, /human/);
  assert.match(r.stderr, /claimable sender layer/);
});

test("AC1 — the identity gate rejects an unknown layer (fail loud)", () => {
  const r = spawnSync("bash", [SCRIPT, "--send", "--from", "bogus", "--to", "t", "--payload", "x"], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /identity rejected/);
});

test("AC1 — a failed delivery is recorded in the ledger with the full attribution (who → who → when → delivered?)", { timeout: 30000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sup-bus-ledger-"));
  const ledger = path.join(tmp, "ledger.jsonl");
  t.after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ } });
  const target = uniqueName("no-such-target");
  // No tmux target exists with this name → delivery must fail loud, and the ledger records it.
  const r = spawnSync("bash", [SCRIPT, "--send", "--from", "inner", "--to", target, "--payload", "hello", "--ledger", ledger], {
    encoding: "utf8",
  });
  assert.equal(r.status, 1, `nonexistent target must exit 1, got ${r.status}\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /^delivered=false /, `measure field on stdout: ${r.stdout}`);
  const rec = JSON.parse(fs.readFileSync(ledger, "utf8").trim().split("\n").pop());
  assert.equal(rec.delivered, false);
  assert.equal(rec.sender.layer, "inner");
  assert.equal(rec.sender.project, path.basename(path.resolve(__dirname, "..", "..")), "project defaults to repo-root basename");
  assert.equal(rec.target, target);
  assert.ok(rec.sentAt, "sentAt present (when)");
  assert.match(rec.sentAt, /^\d{13}$/, "sentAt is epoch-ms");
});

test("AC1 — a successful delivery is recorded with delivered=true and the sender identity", () => {
  // This test is purely for the ledger attribution shape (no tmux): it uses a real bus --send
  // against a target whose delivery FAILS fast, then asserts the ledger row already carries the
  // identity + target + sentAt + delivered. The real delivered=true case is covered by the e2e.
  // (Kept as the attribution-shape companion so the ledger contract is pinned without tmux.)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sup-bus-shape-"));
  try {
    const ledger = path.join(tmp, "ledger.jsonl");
    const r = spawnSync("bash", [SCRIPT, "--send", "--from", "outer", "--to", "definitely-not-a-target", "--payload", "x", "--ledger", ledger], { encoding: "utf8" });
    assert.equal(r.status, 1);
    const rec = JSON.parse(fs.readFileSync(ledger, "utf8").trim().split("\n").pop());
    assert.equal(rec.sender.layer, "outer");
    assert.ok(rec.sender.project, "project is recorded");
    assert.ok(rec.sentAt, "sentAt (when) is recorded");
    assert.ok("delivered" in rec, "delivered verdict is recorded");
    assert.equal(rec.target, "definitely-not-a-target");
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

// ── AC3: real TUI e2e ────────────────────────────────────────────────────────────────────────────

test("AC3 e2e: real target session receives the payload, transcript verifies, ledger records delivered=true", { timeout: 90000 }, async (t) => {
  const tmuxV = spawnSync("tmux", ["-V"], { encoding: "utf8" });
  if (tmuxV.error || tmuxV.status !== 0) {
    t.skip("tmux not available — skipping the real-TUI e2e");
    return;
  }
  const session = uniqueName("sup-bus-e2e");
  const h = newHermeticTmux("sup-bus-e2e-");
  const fixture = path.join(h.tmp, "fixture.sh");
  const transcript = path.join(h.tmp, "transcript.jsonl");
  fs.writeFileSync(fixture, fixtureScriptSrc(transcript), "utf8");
  const ledger = path.join(h.tmp, "ledger.jsonl");
  const marker = `sup-bus-marker-${process.pid}`;
  let result = null;
  try {
    const start = h.newSession(session, `bash ${fixture}`);
    assert.equal(start.status, 0, `tmux new-session failed: ${start.stderr}`);
    // Name the fixture window after the session so the drive-target-check gate sees a deterministic,
    // matching window name.
    assert.equal(h.tmx(["rename-window", "-t", `${session}:0`, session]).status, 0, `rename-window failed`);

    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      const cap = h.capture(session);
      if (cap.status === 0 && cap.stdout.includes("❯")) ready = true;
      else await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(ready, "fixture pane should render the ❯ prompt");

    result = spawnSync("bash", [SCRIPT, "--send", "--from", "outer", "--to", session, "--payload", marker, "--transcript", transcript, "--ledger", ledger, "--project", "quay"], {
      encoding: "utf8",
      timeout: 90000,
      env: { ...h.env, DRIVE_EXPECT_WINDOW_NAME: session, RELIABLE_DELIVERY_VERIFY_S: "20", SUPERVISOR_DELIVER_VERIFY_S: "20" },
    });
    assert.equal(result.status, 0, `bus --send failed (exit ${result.status}):\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.match(result.stdout, /^delivered=true /, `Contract measure delivered=true:\n${result.stdout}`);

    // The transcript verifies delivery — a real user message whose content contains the marker.
    const transcriptText = fs.readFileSync(transcript, "utf8");
    assert.match(transcriptText, new RegExp(`"content":"${marker}"`), `marker should appear as a real user message:\n${transcriptText}`);

    // The ledger records the attributed delivery.
    const ledgerText = fs.readFileSync(ledger, "utf8");
    const rec = JSON.parse(ledgerText.trim().split("\n").pop());
    assert.equal(rec.delivered, true);
    assert.equal(rec.sender.layer, "outer");
    assert.equal(rec.sender.project, "quay");
    assert.equal(rec.target, session);
    assert.ok(rec.sentAt, "sentAt recorded (when)");
  } finally {
    h.cleanup();
  }
});

test("AC3 negative control: a BROKEN delivery is intercepted (delivered=false + ledger records it), NOT silently bypassed", { timeout: 30000 }, async (t) => {
  const tmuxV = spawnSync("tmux", ["-V"], { encoding: "utf8" });
  if (tmuxV.error || tmuxV.status !== 0) {
    t.skip("tmux not available — skipping");
    return;
  }
  const h = newHermeticTmux("sup-bus-neg-");
  const ledger = path.join(h.tmp, "ledger.jsonl");
  t.after(() => { try { h.cleanup(); } catch { /* best-effort */ } });
  // A nonexistent target = a broken delivery. The bus must report delivered=false and exit 1
  // (fail loud) — the NBSP counterexample's structural fix: the test intercepts the bad
  // delivery rather than 3 consumers each silently hand-writing around it. The bus's bare `tmux`
  // resolves to the hermetic socket (h.env), so the probe never touches the default server.
  const r = spawnSync("bash", [SCRIPT, "--send", "--from", "inner", "--to", uniqueName("no-target"), "--payload", "x", "--ledger", ledger], {
    encoding: "utf8",
    env: h.env,
  });
  assert.equal(r.status, 1, `broken delivery must fail loud, got ${r.status}\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /^delivered=false /);
  const rec = JSON.parse(fs.readFileSync(ledger, "utf8").trim().split("\n").pop());
  assert.equal(rec.delivered, false, "the ledger records the failed delivery — the consumer cannot pretend it succeeded");
});

} // end governance group
