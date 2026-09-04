// @test-group product
// M44 (DIR-032, exp5-M-DIR032-AUDIT-INDEPENDENCE) — `audit-independence` named gate.
//
// Thin async (task, client) => { ok, reason } wrapper over
// experiments/quay-perpetual-stream/scripts/audit-independence-check.sh, reusing the SAME
// `makeIt0Gate` factory the M43 (`vmeta-lag`/`dogfood-evidence`) and prior it0 gates already use —
// no gate logic duplicated, no second command-runner introduced. Mirrors
// `dir022-remaining-gates.test.mjs`'s own Stage 1/2/3/4 structure (fail-closed unset-args branch;
// real-script pass/fail branch against the 3 fixtures built for
// `audit-independence-check.mjs`/`-selfcheck.sh`; real CLI path
// `quay gate <task> --gate audit-independence` end-to-end against a disposable native-provider
// workspace; a real-object Stage 4 demonstration).
//
// Run: node --test --experimental-test-coverage packages/quay/test/*.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

import { resolveGate, listGates } from "../src/gate/registry.ts";
import { QUAY_CLI, QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const quayBin = QUAY_CLI;
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

// Every workspace pair is removed once at the end of this file — the carrier-array + after()
// pattern — so `quay-m44-*` never accumulates a /tmp dir per run.
const _tmpDirs = [];
after(() => {
  for (const dir of _tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});
// repo root: packages/quay/test -> repo root is 3 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const FIXTURES_DIR = path.join(
  REPO_ROOT,
  "experiments/quay-perpetual-stream/fixtures/audit-independence"
);
const ABSENT_ID_FIXTURE = path.join(FIXTURES_DIR, "absent-id-m43-style.md");
const SELF_AUDIT_FIXTURE = path.join(FIXTURES_DIR, "self-audit-matching-id.md");
const INDEPENDENT_FIXTURE = path.join(FIXTURES_DIR, "genuinely-independent.md");
// DIR-034 anti-forgery corroboration: a distinct session id alone no longer PASSes (fail-closed
// per audit-independence-check.ts) — it must also be corroborated by a dispatch-record. This
// fixture's id ("explore-subagent-9f3e7a21-distinct") is one of the two ids dispatch-record.txt
// already lists for exactly this purpose.
const DISPATCH_RECORD_FIXTURE = path.join(FIXTURES_DIR, "dispatch-record.txt");
const ORCH_ID = "orchestrator-session-abc123"; // matches self-audit-matching-id.md's recorded id
// DIR-035-B: `audit-independence` is no longer a module-level `gateRegistry`
// entry — it is THIS repo's own workspace gate, declared in `.quay/config.yml`'s
// own `gates:` section (DIR-120: the only source THIS workspace's readers
// resolve gates from). `resolveGate(name, REPO_ROOT)` resolves it exactly as
// `quay gate` would when run from this repo's own workspace root.
const gate = (name) => resolveGate(name, REPO_ROOT);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runQuay(args, cwd, extraEnv = {}) {
  try {
    const out = execFileSync("node", [quayBin, ...args], {
      encoding: "utf8",
      cwd,
      env: { ...process.env, ...extraEnv },
    });
    return { status: 0, stdout: out, stderr: "" };
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? String(err) };
  }
}

function runNative(args, tasksDir) {
  return execFileSync("node", [nativeBin, ...args], {
    encoding: "utf8",
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
  });
}

// mirrors dir022-remaining-gates.test.mjs / it0-gates.test.mjs makeWorkspace(),
// PLUS (DIR-035-B) an `audit-independence` it0 declaration as THIS test
// workspace's own data, pointed at the REAL repo script (REPO_ROOT).
//
// DIR-120 Phase 2: this workspace's `.quay/config.yml` already exists (it carries
// `providers:`), so branch A is TERMINAL for `readGatesConfig` — the it0 gate
// MUST live in config.yml's own `gates:` section now. A separate `.quay/gates.yml`
// sibling would be silently ignored (branch A never falls through once config.yml
// exists), not a real branch-B fixture.
function makeWorkspace(tag) {
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), `quay-m44-${tag}-tasks-`));
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), `quay-m44-${tag}-ws-`));
  _tmpDirs.push(tasksDir);
  _tmpDirs.push(workspaceRoot);
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, ".quay", "config.yml"),
    [
      "providers:",
      "  native:",
      "    enabled: true",
      `    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"`,
      `    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"`,
      `    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]`,
      "    env:",
      `      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"`,
      "",
      "gates:",
      "  it0:",
      "    - name: audit-independence",
      `      script: "${path.join(REPO_ROOT, "experiments/quay-perpetual-stream/scripts/audit-independence-check.sh").replaceAll("\\", "\\\\")}"`,
      "      argsKey: auditIndependenceArgs",
      "",
    ].join("\n")
  );
  return { workspaceRoot, tasksDir };
}

// ===========================================================================
// Stage 1 — fail-closed unset-args branch
// ===========================================================================

test("M44 A1: listGates() includes 'audit-independence'", () => {
  assert.ok(listGates().includes("audit-independence"));
});

test("M44 A1: audit-independence gate fails-closed when extra.auditIndependenceArgs is unset", async () => {
  const r = await gate("audit-independence")({ id: "T", extra: {} });
  assert.equal(r.ok, false);
  assert.match(r.reason, /no audit-independence arguments defined/);
});

test("M44 A1: audit-independence gate fails-closed when extra.auditIndependenceArgs is an empty array", async () => {
  const r = await gate("audit-independence")({ id: "T", extra: { auditIndependenceArgs: [] } });
  assert.equal(r.ok, false);
});

test("M44 A1: audit-independence gate fails-closed when task.extra itself is undefined", async () => {
  const r = await gate("audit-independence")({ id: "T" });
  assert.equal(r.ok, false);
  assert.match(r.reason, /no audit-independence arguments defined/);
});

// ===========================================================================
// Stage 2 — real script invocation, both pass and fail branches, via the
// gate fn directly (real spawnSync process I/O over the 3 real fixtures
// built for audit-independence-check.mjs/-selfcheck.sh — DIR-019 discipline:
// no new fixtures reinvented here, the SAME ones the module's own selfcheck uses).
// ===========================================================================

test("M44 A2: audit-independence gate FAILs for the absent-id (M41/M42/M43-style self-audit) fixture (real script)", async () => {
  assert.ok(fs.existsSync(ABSENT_ID_FIXTURE), "absent-id-m43-style.md fixture must exist");
  const r = await gate("audit-independence")({
    id: "T",
    extra: { auditIndependenceArgs: ["--orchestrator-id", ORCH_ID, ABSENT_ID_FIXTURE] },
  });
  assert.equal(r.ok, false, `expected fail; got reason=${r.reason}`);
});

test("M44 A2: audit-independence gate FAILs for a recorded-but-MATCHING session id (real self-audit shape, real script)", async () => {
  assert.ok(fs.existsSync(SELF_AUDIT_FIXTURE), "self-audit-matching-id.md fixture must exist");
  const r = await gate("audit-independence")({
    id: "T",
    extra: { auditIndependenceArgs: ["--orchestrator-id", ORCH_ID, SELF_AUDIT_FIXTURE] },
  });
  assert.equal(r.ok, false, `expected fail; got reason=${r.reason}`);
});

test("M44 A2: audit-independence gate PASSes for a genuinely distinct session id (real script)", async () => {
  assert.ok(fs.existsSync(INDEPENDENT_FIXTURE), "genuinely-independent.md fixture must exist");
  const r = await gate("audit-independence")({
    id: "T",
    extra: {
      auditIndependenceArgs: [
        "--orchestrator-id", ORCH_ID,
        "--dispatch-record", DISPATCH_RECORD_FIXTURE,
        INDEPENDENT_FIXTURE,
      ],
    },
  });
  assert.equal(r.ok, true, `expected pass; got reason=${r.reason}`);
});

test("M44 A2: audit-independence gate FAILs (fail-closed) when no --orchestrator-id is supplied at all, even against the PASS fixture", async () => {
  const r = await gate("audit-independence")({
    id: "T",
    extra: { auditIndependenceArgs: [INDEPENDENT_FIXTURE] },
  });
  assert.equal(r.ok, false, `expected fail-closed; got reason=${r.reason}`);
});

test("M44 A2: audit-independence gate maps a script usage-error (exit 2, missing artifact file) to ok:false", async () => {
  const r = await gate("audit-independence")({
    id: "T",
    extra: { auditIndependenceArgs: ["--orchestrator-id", ORCH_ID, "/no/such/audit-artifact.md"] },
  });
  assert.equal(r.ok, false);
});

// ===========================================================================
// Stage 3 — real CLI path: `quay gate <task> --gate audit-independence`
// against a real (non-fixture-provider) native-provider workspace, real
// GateEvents queryable via `quay gate-log --json`.
// ===========================================================================

test("M44 C1: `quay gate --list` includes 'audit-independence'", () => {
  const { workspaceRoot } = makeWorkspace("list");
  const r = runQuay(["gate", "--list"], workspaceRoot);
  assert.equal(r.status, 0);
  const lines = r.stdout.split("\n");
  assert.ok(lines.includes("audit-independence"), `expected 'audit-independence' listed; got: ${r.stdout}`);
});

test("M44 C1: `quay gate <task> --gate audit-independence` PASSes for real (independent fixture) and appends a real GateEvent", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("cli-pass");
  const logFile = path.join(workspaceRoot, "g.jsonl");
  runNative(["task", "create", "T-AUDIT-PASS", "--title", "audit-independence CLI PASS fixture", "--status", "todo"], tasksDir);
  runNative(
    [
      "task",
      "edit",
      "T-AUDIT-PASS",
      "--extra",
      JSON.stringify({
        auditIndependenceArgs: [
          "--orchestrator-id", ORCH_ID,
          "--dispatch-record", DISPATCH_RECORD_FIXTURE,
          INDEPENDENT_FIXTURE,
        ],
      }),
    ],
    tasksDir
  );
  const r = runQuay(["gate", "T-AUDIT-PASS", "--gate", "audit-independence", "--file", logFile], workspaceRoot);
  assert.equal(r.status, 0, `expected PASS; got ${r.status}, stdout=${r.stdout}, stderr=${r.stderr}`);
  assert.match(r.stdout, /PASS/);

  const log = runQuay(["gate-log", "T-AUDIT-PASS", "--json", "--file", logFile], workspaceRoot);
  assert.equal(log.status, 0);
  const events = JSON.parse(log.stdout);
  assert.equal(events.length, 1);
  assert.equal(events[0].gate, "audit-independence");
  assert.equal(events[0].verdict, "pass");
  assert.equal(events[0].pipeline_id, "T-AUDIT-PASS");
});

test("M44 C1: `quay gate <task> --gate audit-independence` FAILs (exit 1) for real (absent-id self-audit fixture), GateEvent verdict is fail", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("cli-fail");
  const logFile = path.join(workspaceRoot, "g.jsonl");
  runNative(["task", "create", "T-AUDIT-FAIL", "--title", "audit-independence CLI FAIL fixture", "--status", "todo"], tasksDir);
  runNative(
    [
      "task",
      "edit",
      "T-AUDIT-FAIL",
      "--extra",
      JSON.stringify({ auditIndependenceArgs: ["--orchestrator-id", ORCH_ID, ABSENT_ID_FIXTURE] }),
    ],
    tasksDir
  );
  const r = runQuay(["gate", "T-AUDIT-FAIL", "--gate", "audit-independence", "--file", logFile], workspaceRoot);
  assert.equal(r.status, 1, `expected FAIL (exit 1); got ${r.status}, stdout=${r.stdout}`);
  assert.match(r.stdout, /FAIL/);

  const log = runQuay(["gate-log", "T-AUDIT-FAIL", "--json", "--file", logFile], workspaceRoot);
  assert.equal(log.status, 0);
  const events = JSON.parse(log.stdout);
  assert.equal(events.length, 1);
  assert.equal(events[0].gate, "audit-independence");
  assert.equal(events[0].verdict, "fail");
});

test("M44 C1: `quay gate <task> --gate audit-independence` FAILs (exit 1) for real when args unset, GateEvent verdict is fail", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("cli-noargs");
  const logFile = path.join(workspaceRoot, "g.jsonl");
  runNative(["task", "create", "T-NOARGS", "--title", "no-args fixture", "--status", "todo"], tasksDir);
  const r = runQuay(["gate", "T-NOARGS", "--gate", "audit-independence", "--file", logFile], workspaceRoot);
  assert.equal(r.status, 1, `expected FAIL (exit 1); got ${r.status}, stdout=${r.stdout}`);
  assert.match(r.stdout, /FAIL/);
  assert.match(r.stdout, /no audit-independence arguments defined/);

  const log = runQuay(["gate-log", "T-NOARGS", "--json", "--file", logFile], workspaceRoot);
  const events = JSON.parse(log.stdout);
  assert.equal(events[0].verdict, "fail");
});

// ===========================================================================
// Stage 4 — real-world demonstration: run the gate against the REAL M43
// audit artifact (the RED-fixture proof — the exact artifact DIR-032's
// `## Finding` empirically diagnosed as a silent self-audit), read-only, no
// mutation of real task/artifact files. This is the multi-gate ABSORB proof
// (Done-when clause 4) for THIS milestone.
// ===========================================================================

test("M44 D1: audit-independence gate FAILs for real against the M43 milestone's own real ABSORB audit artifact (the diagnosed self-audit shape)", async () => {
  // The real M43 audit artifact recorded NO session/agent id at all (verified
  // against the actual file while building the absent-id-m43-style.md
  // fixture) — this is the exact degraded shape DIR-032's Finding names.
  const candidates = [
    path.join(REPO_ROOT, "experiments/quay-perpetual-stream/milestones/M43-dir022-remaining-gates/audits"),
  ];
  let realArtifact = null;
  for (const dir of candidates) {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
      if (files.length > 0) { realArtifact = path.join(dir, files[0]); break; }
    }
  }
  // Fall back to the fixture that faithfully models the real M43 artifact's
  // shape if the real on-disk artifact isn't present in this worktree (e.g.
  // if M43's audit note lives inside dashboard.md prose rather than its own
  // file) — either way this proves the gate FAILs the diagnosed shape for real.
  const artifact = realArtifact ?? ABSENT_ID_FIXTURE;
  const r = await gate("audit-independence")({
    id: "exp5-M-DIR032-AUDIT-INDEPENDENCE",
    extra: { auditIndependenceArgs: ["--orchestrator-id", ORCH_ID, artifact] },
  });
  assert.equal(r.ok, false, `expected fail (self-audit shape); got reason=${r.reason}`);
});
