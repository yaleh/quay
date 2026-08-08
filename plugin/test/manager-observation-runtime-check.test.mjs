// @test-group engine
// manager-observation-runtime-check.test.mjs — gap-c3-has-no-runtime-constraint AC2/AC3:
// the OUTER must never observe/check the MANAGER at RUNTIME. The doc-layer check
// (no-manager-tick-doc-check.ts, gap-manager-productization-five-constraints AC4) only verifies the
// tick DOCS contain no create/drive/check manager STEPS; this checker scans the OUTER session
// transcript for ACTUAL tool calls that observe/check the manager.
//
//   AC2 — runtime constraint landed: outer runtime observation/check actions against the manager are
//         mechanically detected (PANE / TICKLOG / TRANSCRIPT / ANALYZE classes), violations reported.
//   AC3 — negative controls: inner-directed observations, manager→outer publishes, and hearsay
//         (prose mentions) do NOT false-positive.
//
// Run:
//   scripts/test.sh plugin/test/manager-observation-runtime-check.test.mjs
//   node --test plugin/test/manager-observation-runtime-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginDir, "..");

const CHECKER = path.join(pluginDir, "scripts", "manager-observation-runtime-check.ts");
const { DEFAULT_CONFIG, checkTranscriptText } = await import(
  path.join(pluginDir, "scripts", "manager-observation-runtime-check.ts")
);

const MANAGER_ID = "3cc1c0b9-67b9-407c-af0f-7ef6c60684f0";
const INNER_ID = "728a4610-46b5-4c4a-84ea-6ed01667c433";

function toolUse(name, input, ts = "2026-08-08T06:00:00.000Z", sid = "outer-1111") {
  return JSON.stringify({
    type: "assistant",
    timestamp: ts,
    session_id: sid,
    message: { role: "assistant", content: [{ type: "tool_use", id: "call_1", name, input }] },
  });
}

function kindsFor(text, config = DEFAULT_CONFIG) {
  return checkTranscriptText(text, config).map((v) => v.kind);
}

function kindsForInput(name, input, config = DEFAULT_CONFIG) {
  return kindsFor(toolUse(name, input) + "\n", config);
}

// ── AC1: four detection classes (design-note criteria made executable) ────────────────────────────────

test("AC2 — PANE: capture-pane of the manager window flags (kind PANE)", () => {
  const kinds = kindsForInput("Bash", { command: "tmux capture-pane -p -t quay-0:manager > .quay/last-mgr.txt" });
  assert.deepEqual(kinds, ["PANE"]);
});

test("AC2 — PANE: tmux list-panes of the manager session flags (quay-manager independent session)", () => {
  const kinds = kindsForInput("Bash", { command: "tmux list-panes -t quay-manager 2>&1 | head -5" });
  assert.deepEqual(kinds, ["PANE"]);
});

test("AC2 — PANE: the ## Contract current-instance shorthand quay-0:0.0 flags when the operator configures it (NOT a default — window numbering is layout-dependent)", () => {
  // Defaults deliberately exclude `0:0`/`0:0.0`: a real outer scan found `capture-pane -t quay-0:0.0`
  // aimed at the INNER on 2026-08-02 (the inner was window 0 in that layout). The operator adds the
  // current-instance pane to managerTargets when the live topology has the manager at window 0.
  const config = { ...DEFAULT_CONFIG, managerTargets: ["manager", "quay-manager", "0:0", "0:0.0"] };
  const kinds = kindsForInput("Bash", { command: "tmux capture-pane -p -t quay-0:0.0 > /tmp/x" }, config);
  assert.deepEqual(kinds, ["PANE"]);
});

test("AC3 — word-boundary: a window named `managerial` does NOT match the `manager` pattern", () => {
  const kinds = kindsForInput("Bash", { command: "tmux capture-pane -p -t quay-0:managerial > /tmp/x" });
  assert.deepEqual(kinds, []);
});

test("AC3 — a WRITE-heredoc doc that merely MENTIONS the tick-log path does NOT flag as a read (the 2026-08-03 false-positive shape)", () => {
  const command = [
    "cd /home/yale/work/quay",
    "cat > orchestration/manager-loop-tick.md <<'EOF'",
    "# 管理者 tick 指令",
    "写进 `orchestration/manager-tick-log.md`，五列：",
    "EOF",
  ].join("\n");
  const kinds = kindsForInput("Bash", { command });
  assert.deepEqual(kinds, [], "writing a doc whose body mentions the tick-log path is not reading the tick-log");
});

test("AC2 — TICKLOG: Read of the manager tick-log flags (kind TICKLOG)", () => {
  const kinds = kindsForInput("Read", { file_path: "/home/yale/work/quay/orchestration/manager-tick-log.md" });
  assert.deepEqual(kinds, ["TICKLOG"]);
});

test("AC2 — TICKLOG: Bash cat of the manager tick-log flags", () => {
  const kinds = kindsForInput("Bash", { command: "cat orchestration/manager-tick-log.md 2>&1 | tail -20" });
  assert.deepEqual(kinds, ["TICKLOG"]);
});

test("AC2 — TRANSCRIPT: reading the manager's session transcript flags when the manager id is configured", () => {
  const config = { ...DEFAULT_CONFIG, managerSessionIds: [MANAGER_ID] };
  const kinds = kindsForInput(
    "Read",
    { file_path: `/home/yale/.claude/projects/-home-yale-work-quay/${MANAGER_ID}.jsonl` },
    config
  );
  assert.deepEqual(kinds, ["TRANSCRIPT"]);
});

test("AC2 — ANALYZE: task_write creating a task that analyzes manager runtime behavior flags (the 2026-08-08 09:03 incident shape)", () => {
  const kinds = kindsForInput("mcp__quay__task_write", {
    id: "gap-incident",
    title: "分析 manager 周期性 tick-log 追加行为",
  });
  assert.deepEqual(kinds, ["ANALYZE"]);
});

test("AC2 — multiple violations are all reported with line/timestamp/tool/session", () => {
  const text = toolUse("Bash", { command: "tmux capture-pane -p -t quay-0:manager" }) + "\n" +
    toolUse("Read", { file_path: "orchestration/manager-tick-log.md" });
  const vs = checkTranscriptText(text, DEFAULT_CONFIG);
  assert.equal(vs.length, 2);
  assert.deepEqual(vs.map((v) => v.kind).sort(), ["PANE", "TICKLOG"]);
  assert.ok(vs.every((v) => typeof v.line === "number" && v.timestamp && v.tool && v.sessionId));
});

// ── AC3: negative controls ───────────────────────────────────────────────────────────────────────────

test("AC3 — inner-directed observation does NOT flag (capture-pane -t quay-0:inner)", () => {
  const kinds = kindsForInput("Bash", { command: "tmux capture-pane -p -t quay-0:inner > .quay/last-pane.txt" });
  assert.deepEqual(kinds, []);
});

test("AC3 — session-level capture-pane (the tick-doc inner observation) does NOT flag", () => {
  const kinds = kindsForInput("Bash", { command: 'tmux capture-pane -p -t "$TMUX_SESSION" > .quay/last-pane.txt' });
  assert.deepEqual(kinds, []);
});

test("AC3 — outer-window capture-pane does NOT flag", () => {
  const kinds = kindsForInput("Bash", { command: "tmux capture-pane -p -t quay-0:outer- > /tmp/x" });
  assert.deepEqual(kinds, []);
});

test("AC3 — manager→outer publish (inbox-summary) does NOT flag", () => {
  const kinds = kindsForInput("Bash", { command: "bash plugin/scripts/supervisor-bus-identity.sh inbox-summary" });
  assert.deepEqual(kinds, []);
});

test("AC3 — reading the manager's message bus (manager→outer delivery) does NOT flag", () => {
  const kinds = kindsForInput("Read", { file_path: "/home/yale/work/quay/.quay/manager-bus/messages/outer-1.json" });
  assert.deepEqual(kinds, []);
});

test("AC3 — hearsay: prose text mentioning manager observation is NOT evidence (only tool_use blocks inspected)", () => {
  const text = JSON.stringify({
    type: "assistant", timestamp: "2026-08-08T06:00:00.000Z", session_id: "outer-1111",
    message: { role: "assistant", content: [{ type: "text", text: "据转述外层观察了 manager 窗口（capture-pane -t quay-0:manager）。" }] },
  }) + "\n";
  const kinds = kindsFor(text);
  assert.deepEqual(kinds, [], "a prose accusation must not be counted as evidence");
});

test("AC3 — a Bash echo/comment that merely MENTIONS the observation command does NOT flag", () => {
  const kinds = kindsForInput("Bash", { command: "echo 'never capture-pane -t quay-0:manager here'; ls" });
  assert.deepEqual(kinds, []);
});

test("AC3 — reading the inner session transcript does NOT flag as a manager TRANSCRIPT", () => {
  const config = { ...DEFAULT_CONFIG, managerSessionIds: [MANAGER_ID] };
  const kinds = kindsForInput(
    "Read",
    { file_path: `/home/yale/.claude/projects/-home-yale-work-quay/${INNER_ID}.jsonl` },
    config
  );
  assert.deepEqual(kinds, [], "inner transcript is not the manager transcript");
});

test("AC3 — creating a task ABOUT the manager PRODUCT (build, not analyze) does NOT flag", () => {
  const kinds = kindsForInput("task_write", { id: "gap-p", title: "manager productization (C1-C5, SPEC-manager-productization-2026-08-05)" });
  assert.deepEqual(kinds, []);
});

test("AC3 — creating a task analyzing the INNER (not the manager) does NOT flag", () => {
  const kinds = kindsForInput("task_write", { id: "gap-i", title: "分析 inner 的派发行为" });
  assert.deepEqual(kinds, []);
});

test("AC3 — bare manager session-id reference WITHOUT an observation action does NOT flag (no .jsonl path)", () => {
  const config = { ...DEFAULT_CONFIG, managerSessionIds: [MANAGER_ID] };
  const kinds = kindsForInput("Bash", { command: `git log --oneline | grep -q ${MANAGER_ID.slice(0, 8)} && echo yes` }, config);
  assert.deepEqual(kinds, [], "a bare session-id substring in a non-observation command is not evidence");
});

// ── CLI integration ──────────────────────────────────────────────────────────────────────────────────

function runChecker(args) {
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", CHECKER, ...args], { encoding: "utf8" });
}

function writeTranscript(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "morc-"));
  const file = path.join(dir, "outer.jsonl");
  fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
  return { dir, file };
}

test("AC2 — CLI: a transcript with a manager observation exits 1 and reports the violation", () => {
  const { dir, file } = writeTranscript([
    toolUse("Bash", { command: "tmux capture-pane -p -t quay-0:manager > /tmp/x" }),
    toolUse("Bash", { command: "tmux capture-pane -p -t quay-0:inner > /tmp/y" }),
  ]);
  try {
    const r = runChecker(["--transcript", file, "--json"]);
    assert.equal(r.status, 1, `must fail (exit 1):\n${r.stdout}\n${r.stderr}`);
    const j = JSON.parse(r.stdout);
    assert.equal(j.ok, false);
    assert.equal(j.violations.length, 1);
    assert.equal(j.violations[0].kind, "PANE");
    assert.match(j.violations[0].target, /quay-0:manager/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("AC3 — CLI: a clean transcript (inner observation + manager→outer publish only) exits 0", () => {
  const { dir, file } = writeTranscript([
    toolUse("Bash", { command: "tmux capture-pane -p -t quay-0:inner > .quay/last-pane.txt" }),
    toolUse("Bash", { command: "bash plugin/scripts/supervisor-bus-identity.sh inbox-summary" }),
    toolUse("Read", { file_path: "orchestration/tick-log.md" }),
  ]);
  try {
    const r = runChecker(["--transcript", file, "--json"]);
    assert.equal(r.status, 0, `clean transcript must pass:\n${r.stdout}\n${r.stderr}`);
    const j = JSON.parse(r.stdout);
    assert.equal(j.ok, true);
    assert.equal(j.violations.length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("AC2 — CLI: --since filters out violations before the window (retrospective audit window)", () => {
  const { dir, file } = writeTranscript([
    toolUse("Bash", { command: "tmux capture-pane -p -t quay-0:manager" }, "2026-08-08T05:00:00.000Z"),
    toolUse("Bash", { command: "tmux capture-pane -p -t quay-0:manager" }, "2026-08-08T06:00:00.000Z"),
  ]);
  try {
    const r = runChecker(["--transcript", file, "--since", "2026-08-08T05:30:00.000Z", "--json"]);
    assert.equal(r.status, 1);
    const j = JSON.parse(r.stdout);
    assert.equal(j.violations.length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("AC2 — CLI: --report appends a JSONL record for a persistent violation log", () => {
  const { dir, file } = writeTranscript([toolUse("Read", { file_path: "orchestration/manager-tick-log.md" })]);
  const report = path.join(dir, "report.jsonl");
  try {
    const r = runChecker(["--transcript", file, "--report", report]);
    assert.equal(r.status, 1);
    const lines = fs.readFileSync(report, "utf8").trim().split("\n");
    assert.equal(lines.length, 1);
    const rec = JSON.parse(lines[0]);
    assert.equal(rec.checker, "manager-observation-runtime-check");
    assert.equal(rec.violationCount, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("AC2 — missing transcript target is a usage error (exit 2), never a silent pass", () => {
  const r = runChecker([]);
  assert.equal(r.status, 2);
});

test("AC2 — mutation case exists and passes (checker is mutation-tested)", () => {
  const caseFile = path.join(pluginDir, "scripts", "checker-mutation-cases", "manager-observation-runtime-check.sh");
  assert.ok(fs.existsSync(caseFile), "mutation case must exist");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "morc-mut-"));
  try {
    const r = spawnSync("bash", [caseFile, dir], { encoding: "utf8" });
    assert.equal(r.status, 0, `mutation case must pass:\n${r.stdout}\n${r.stderr}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("AC4 — the doc-layer checker (no-manager-tick-doc-check) still passes with the runtime-constraint section present in the outer tick doc", () => {
  // Cross-annotation guard: the runtime constraint's tick-doc section must not be an ACTIONABLE
  // create/drive/check-manager step, so it must not redden the doc-layer checker.
  const docChecker = path.join(pluginDir, "scripts", "no-manager-tick-doc-check.ts");
  const outerTick = path.join(pluginDir, "loop", "orchestrator-loop-tick.md");
  const src = fs.readFileSync(outerTick, "utf8");
  assert.ok(/manager-observation-runtime-check/.test(src), "the outer tick doc must reference the runtime checker");
  const r = spawnSync("node", ["--no-warnings", "--experimental-strip-types", docChecker, "--root", repoRoot, "--json"], { encoding: "utf8" });
  assert.equal(r.status, 0, `doc-layer checker must still pass:\n${r.stdout}\n${r.stderr}`);
  const j = JSON.parse(r.stdout);
  assert.equal(j.ok, true);
});
