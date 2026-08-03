// @test-group engine
// run-identity.test.mjs — DIR-124-B1 (M253): RED/GREEN fixture tests for run-identity.ts
// (canonical RunIdentity factory + CLI, experiments + plugin mirrors).
//
// Byte-identical mirror: experiments/quay-perpetual-stream/test/run-identity.test.mjs
//
// Canonical test placement per the Plan (docs/plans/M253-dir-124-b1.md): plugin/test/ is in
// scripts/test.sh's default glob by location alone; the experiments/test/ copy is invoked by
// explicit path. Path-resolution pin: every direct-module import and CLI-subprocess dispatch in
// this file resolves EXCLUSIVELY against the experiments canonical path
// (experiments/quay-perpetual-stream/scripts/run-identity.ts) — plugin/scripts/run-identity.ts is
// only ever compared byte-for-byte, never imported (matching the Plan's Stage 1 pin).
//
// Run:
//   scripts/test.sh plugin/test/run-identity.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// REPO_ROOT must resolve to the same directory regardless of whether this file lives at
// experiments/quay-perpetual-stream/test/ or plugin/test/ (byte-identical mirror requirement).
function _findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, ".quay", "config.yml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Cannot find repo root: no .quay/config.yml found upward from " + startDir);
}
const REPO_ROOT = _findRepoRoot(__dirname);
const SCRIPTS = path.join(REPO_ROOT, "experiments", "quay-perpetual-stream", "scripts");
const PLUGIN_SCRIPTS = path.join(REPO_ROOT, "plugin", "scripts");
const TMP = os.tmpdir();

const RUN_IDENTITY_TS = path.join(SCRIPTS, "run-identity.ts");
const PLUGIN_RUN_IDENTITY_TS = path.join(PLUGIN_SCRIPTS, "run-identity.ts");

function sha256(s) {
  return createHash("sha256").update(s).digest("hex");
}

// ── CLI subprocess helper (real shell-shaped dispatch, controlled env) ────────────────────────────

function runIdentity(args, opts = {}) {
  const { cwd = REPO_ROOT, env = {} } = opts;
  try {
    const stdout = execFileSync("node", ["--experimental-strip-types", RUN_IDENTITY_TS, ...args], {
      cwd,
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, ...env },
    });
    return { exitCode: 0, stdout, stderr: "" };
  } catch (e) {
    return {
      exitCode: typeof e.status === "number" ? e.status : 1,
      stdout: e.stdout ? e.stdout.toString() : "",
      stderr: e.stderr ? e.stderr.toString() : "",
    };
  }
}

// ── Git-backed fixture workspace (real mint needs a real HEAD for DD3) ─────────────────────────────

function makeGitFixture(taskIds = ["DIR-124-B1"]) {
  const dir = fs.mkdtempSync(path.join(TMP, "run-identity-git-"));
  fs.mkdirSync(path.join(dir, "plugin", "workflows"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".claude", "workflows"), { recursive: true });
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, "charters"), { recursive: true });
  fs.mkdirSync(path.join(dir, "docs", "plans"), { recursive: true });
  const wf = "# workflow fixture\n";
  fs.writeFileSync(path.join(dir, "plugin", "workflows", "execute-milestone.js"), wf);
  fs.writeFileSync(path.join(dir, ".claude", "workflows", "execute-milestone.js"), wf);
  for (const t of taskIds) {
    fs.writeFileSync(path.join(dir, "tasks", `${t}.md`), `# ${t}\n`);
  }
  fs.writeFileSync(path.join(dir, "charters", "M253-dir-124-b1.md"), "# charter\n");
  fs.writeFileSync(path.join(dir, "docs", "plans", "M253-dir-124-b1.md"), "# plan\n");
  execSync("git init -q", { cwd: dir });
  execSync("git config user.email fixture@example.com", { cwd: dir });
  execSync("git config user.name fixture", { cwd: dir });
  execSync("git add -A", { cwd: dir });
  execSync("git commit -q -m fixture", { cwd: dir });
  return dir;
}

function gitHead(cwd) {
  return execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
}

function createInput(overrides = {}) {
  return {
    candidateId: "DIR-124-B1",
    taskIds: ["DIR-124-B1"],
    workflowSourcePath: "plugin/workflows/execute-milestone.js",
    taskFiles: ["tasks/DIR-124-B1.md"],
    charterFile: "charters/M253-dir-124-b1.md",
    planFile: "docs/plans/M253-dir-124-b1.md",
    ...overrides,
  };
}

function makeIdentityJson(overrides = {}) {
  return JSON.stringify({
    schemaVersion: "1",
    runId: "sess::cand::1",
    sessionId: "sess",
    candidateId: "cand",
    taskIds: ["T-1"],
    attempt: 1,
    baseCommit: "base123",
    candidateCommit: null,
    workflowSourcePath: "plugin/workflows/execute-milestone.js",
    workflowSourceHash: "a".repeat(64),
    workflowSourceCommit: "base123",
    runtimeGeneration: "abcdef123456",
    taskHash: "b".repeat(64),
    charterHash: "c".repeat(64),
    planHash: "d".repeat(64),
    materialInputHashes: { "tasks/T-1.md": "e".repeat(64) },
    ...overrides,
  });
}

// ── AC1: single identity-minting entry point; real --create returns a typed RunIdentity ─────────────

test("AC1 — --create mints a typed RunIdentity bound to the real baseCommit + workflow source hash", () => {
  const dir = makeGitFixture();
  const baseCommit = gitHead(dir);
  const res = runIdentity(["--create", JSON.stringify(createInput())], {
    cwd: dir,
    env: { CLAUDE_CODE_SESSION_ID: "session-ac1" },
  });
  fs.rmSync(dir, { recursive: true, force: true });

  assert.equal(res.exitCode, 0, `expected exit 0, got ${res.exitCode}\n${res.stdout}${res.stderr}`);
  const id = JSON.parse(res.stdout);
  assert.equal(id.schemaVersion, "1");
  assert.equal(id.candidateId, "DIR-124-B1");
  assert.deepEqual(id.taskIds, ["DIR-124-B1"]);
  assert.equal(id.attempt, 1, "cold dispatch defaults attempt to 1");
  assert.equal(id.sessionId, "session-ac1");
  assert.equal(id.runId, "session-ac1::DIR-124-B1::1");
  assert.equal(id.baseCommit, baseCommit, "baseCommit is derived from git rev-parse HEAD (DD3)");
  assert.equal(id.candidateCommit, null, "candidateCommit is null until bound (DD4)");
  assert.equal(id.workflowSourcePath, "plugin/workflows/execute-milestone.js");
  assert.match(id.workflowSourceHash, /^[0-9a-f]{64}$/, "workflowSourceHash is sha256 hex");
  assert.equal(id.workflowSourceCommit, baseCommit, "workflow source is committed at fixture HEAD");
  assert.equal(id.runtimeGeneration, sha256(id.workflowSourceHash).slice(0, 12), "DD5 fixed derivation");
  assert.match(id.taskHash, /^[0-9a-f]{64}$/);
  assert.match(id.charterHash, /^[0-9a-f]{64}$/);
  assert.match(id.planHash, /^[0-9a-f]{64}$/);
  assert.ok(id.materialInputHashes["tasks/DIR-124-B1.md"], "task file is a material input");
  assert.ok(id.materialInputHashes["charters/M253-dir-124-b1.md"], "charter is a material input");
  assert.ok(id.materialInputHashes["docs/plans/M253-dir-124-b1.md"], "plan is a material input");
});

test("AC1 — --create output is deterministic sorted-key JSON; two mints serialize byte-identically", () => {
  const dir = makeGitFixture();
  const r1 = runIdentity(["--create", JSON.stringify(createInput())], {
    cwd: dir,
    env: { CLAUDE_CODE_SESSION_ID: "s" },
  });
  const r2 = runIdentity(["--create", JSON.stringify(createInput())], {
    cwd: dir,
    env: { CLAUDE_CODE_SESSION_ID: "s" },
  });
  fs.rmSync(dir, { recursive: true, force: true });

  assert.equal(r1.exitCode, 0, r1.stdout);
  assert.equal(r2.exitCode, 0, r2.stdout);
  assert.equal(r1.stdout, r2.stdout, "same input + same env => byte-identical identity");
  const parsed = JSON.parse(r1.stdout);
  assert.deepEqual(Object.keys(parsed), Object.keys(parsed).sort(), "output keys are sorted");
});

// ── AC2: runId derived from env session + per-dispatch nonce, never caller-asserted ────────────────

test("AC2 — env-set session is used for the runId (env-inherited subprocess, DD2)", () => {
  const dir = makeGitFixture();
  const res = runIdentity(["--create", JSON.stringify(createInput())], {
    cwd: dir,
    env: { CLAUDE_CODE_SESSION_ID: "env-session-xyz" },
  });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(res.exitCode, 0, res.stdout);
  const id = JSON.parse(res.stdout);
  assert.equal(id.sessionId, "env-session-xyz");
  assert.equal(id.runId, "env-session-xyz::DIR-124-B1::1");
});

test("AC2 — a conflicting caller-supplied sessionId is rejected (session-id-conflict), never honored", () => {
  const dir = makeGitFixture();
  const res = runIdentity(["--create", JSON.stringify(createInput({ sessionId: "forged-session" }))], {
    cwd: dir,
    env: { CLAUDE_CODE_SESSION_ID: "real-session" },
  });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(res.exitCode, 1);
  const err = JSON.parse(res.stdout);
  assert.equal(err.code, "session-id-conflict");
  assert.equal(err.ok, false);
});

test("AC2 — a caller-supplied sessionId equal to the env value is honored (no false conflict)", () => {
  const dir = makeGitFixture();
  const res = runIdentity(["--create", JSON.stringify(createInput({ sessionId: "same-session" }))], {
    cwd: dir,
    env: { CLAUDE_CODE_SESSION_ID: "same-session" },
  });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(res.exitCode, 0, res.stdout);
  assert.equal(JSON.parse(res.stdout).sessionId, "same-session");
});

test("AC2 — missing CLAUDE_CODE_SESSION_ID fails closed (missing-session-id), never a placeholder", () => {
  const dir = makeGitFixture();
  const res = runIdentity(["--create", JSON.stringify(createInput())], {
    cwd: dir,
    env: { CLAUDE_CODE_SESSION_ID: "" },
  });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.notEqual(res.exitCode, 0);
  const err = JSON.parse(res.stdout);
  assert.equal(err.code, "missing-session-id");
});

// ── AC3: singleton width-1 and composite width-N from the SAME factory, identical envelope type ─────

test("AC3 — singleton width-1 and composite width-3 share an identical envelope key set + schemaVersion", () => {
  const dir = makeGitFixture(["DIR-124-B1", "DIR-124-B2", "DIR-124-B3"]);
  const singleton = createInput();
  const composite = createInput({
    candidateId: "M253-COMPOSITE",
    taskIds: ["DIR-124-B1", "DIR-124-B2", "DIR-124-B3"],
    taskFiles: ["tasks/DIR-124-B1.md", "tasks/DIR-124-B2.md", "tasks/DIR-124-B3.md"],
  });
  const sRes = runIdentity(["--create", JSON.stringify(singleton)], { cwd: dir, env: { CLAUDE_CODE_SESSION_ID: "s" } });
  const cRes = runIdentity(["--create", JSON.stringify(composite)], { cwd: dir, env: { CLAUDE_CODE_SESSION_ID: "s" } });
  fs.rmSync(dir, { recursive: true, force: true });

  assert.equal(sRes.exitCode, 0, sRes.stdout);
  assert.equal(cRes.exitCode, 0, cRes.stdout);
  const s = JSON.parse(sRes.stdout);
  const c = JSON.parse(cRes.stdout);
  assert.deepEqual(Object.keys(s).sort(), Object.keys(c).sort(), "identical envelope key sets");
  assert.equal(s.schemaVersion, c.schemaVersion);
  assert.equal(s.schemaVersion, "1");
  assert.equal(c.taskIds.length, 3);
  assert.equal(c.runId, "s::M253-COMPOSITE::1");
});

test("AC3 — two distinct candidates in ONE session produce distinct runIds (R1 collision guard)", () => {
  const dir = makeGitFixture(["DIR-124-B1", "DIR-124-B2"]);
  const a = createInput({ candidateId: "DIR-124-B1" });
  const b = createInput({ candidateId: "DIR-124-B2", taskIds: ["DIR-124-B2"], taskFiles: ["tasks/DIR-124-B2.md"] });
  const rA = runIdentity(["--create", JSON.stringify(a)], { cwd: dir, env: { CLAUDE_CODE_SESSION_ID: "one-session" } });
  const rB = runIdentity(["--create", JSON.stringify(b)], { cwd: dir, env: { CLAUDE_CODE_SESSION_ID: "one-session" } });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.notEqual(JSON.parse(rA.stdout).runId, JSON.parse(rB.stdout).runId);
});

// ── AC4: candidateCommit bound at Build-integrate, re-checked at Audit/Gate/Land ────────────────────

test("AC4 — bind then check: matching commit passes; moved commit fails closed (candidate-commit-moved)", () => {
  const unbound = makeIdentityJson();
  const bindRes = runIdentity(["--bind-candidate-commit", unbound, "cand-abc123"]);
  assert.equal(bindRes.exitCode, 0, bindRes.stdout);
  const bound = JSON.parse(bindRes.stdout);
  assert.equal(bound.candidateCommit, "cand-abc123");
  assert.equal(bound.runId, "sess::cand::1", "bind is a pure re-derivation, not a re-mint");

  const okRes = runIdentity(["--check-candidate-commit", JSON.stringify(bound), "cand-abc123"]);
  assert.equal(okRes.exitCode, 0, okRes.stdout);
  assert.equal(JSON.parse(okRes.stdout).ok, true);

  const movedRes = runIdentity(["--check-candidate-commit", JSON.stringify(bound), "cand-moved"]);
  assert.equal(movedRes.exitCode, 1);
  assert.equal(JSON.parse(movedRes.stdout).code, "candidate-commit-moved");
});

test("AC4 — check on an unbound identity fails closed (candidate-commit-unbound)", () => {
  const unbound = makeIdentityJson();
  const res = runIdentity(["--check-candidate-commit", unbound, "anything"]);
  assert.equal(res.exitCode, 1);
  assert.equal(JSON.parse(res.stdout).code, "candidate-commit-unbound");
});

test("AC4 — bind/check with a malformed identity fails closed (invalid-identity), never silently accepted", () => {
  const bindRes = runIdentity(["--bind-candidate-commit", '{"runId":"x","candidateCommit":null}', "abc"]);
  assert.notEqual(bindRes.exitCode, 0);
  assert.equal(JSON.parse(bindRes.stdout).code, "invalid-identity");

  const checkRes = runIdentity(["--check-candidate-commit", '{"candidateCommit":"abc"}', "abc"]);
  assert.notEqual(checkRes.exitCode, 0);
  assert.equal(JSON.parse(checkRes.stdout).code, "invalid-identity");
});

// ── AC5: --selftest passes; mirrors byte-identical; mint-time mirror-drift fail-closed ───────────────

test("AC5 — --selftest passes (experiments canonical path)", () => {
  const res = runIdentity(["--selftest"], { env: { CLAUDE_CODE_SESSION_ID: "selftest-env" } });
  assert.equal(res.exitCode, 0, `selftest failed\n${res.stdout}${res.stderr}`);
});

test("AC5 — --selftest passes from the plugin mirror path (CLI identical from either path)", () => {
  try {
    const stdout = execFileSync("node", ["--experimental-strip-types", PLUGIN_RUN_IDENTITY_TS, "--selftest"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, CLAUDE_CODE_SESSION_ID: "selftest-env" },
    });
    assert.equal(0, 0, stdout);
  } catch (e) {
    assert.fail(`plugin selftest failed: ${e.stdout}${e.stderr}`);
  }
});

test("AC5 — the two run-identity.ts mirrors are byte-identical (diff exit 0)", () => {
  const exp = fs.readFileSync(RUN_IDENTITY_TS, "utf8");
  const plug = fs.readFileSync(PLUGIN_RUN_IDENTITY_TS, "utf8");
  assert.equal(exp, plug, "experiments/ and plugin/ run-identity.ts must be byte-identical");
  const diffOut = execSync(`diff ${RUN_IDENTITY_TS} ${PLUGIN_RUN_IDENTITY_TS}`, { cwd: REPO_ROOT, encoding: "utf8", timeout: 10_000 });
  assert.equal(diffOut, "", "diff exit 0 (empty output)");
});

test("AC5 — mint-time workflow-mirror drift fails closed (mirror-drift), no mint", () => {
  const dir = fs.mkdtempSync(path.join(TMP, "run-identity-drift-"));
  fs.mkdirSync(path.join(dir, "plugin", "workflows"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".claude", "workflows"), { recursive: true });
  fs.writeFileSync(path.join(dir, "plugin", "workflows", "execute-milestone.js"), "content A");
  fs.writeFileSync(path.join(dir, ".claude", "workflows", "execute-milestone.js"), "content B");
  const res = runIdentity(["--create", JSON.stringify(createInput())], {
    cwd: dir,
    env: { CLAUDE_CODE_SESSION_ID: "s" },
  });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(res.exitCode, 1, "drift must fail closed before mint");
  assert.equal(JSON.parse(res.stdout).code, "mirror-drift");
});

// ── Additional fail-closed error modes ──────────────────────────────────────────────────────────────

test("fail-closed — empty taskIds => invalid-task-ids", () => {
  const dir = makeGitFixture();
  const res = runIdentity(["--create", JSON.stringify(createInput({ taskIds: [] }))], { cwd: dir, env: { CLAUDE_CODE_SESSION_ID: "s" } });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(JSON.parse(res.stdout).code, "invalid-task-ids");
});

test("fail-closed — duplicate taskIds => invalid-task-ids", () => {
  const dir = makeGitFixture(["DIR-124-B1"]);
  const res = runIdentity([
    "--create",
    JSON.stringify(createInput({ taskIds: ["DIR-124-B1", "DIR-124-B1"], taskFiles: ["tasks/DIR-124-B1.md", "tasks/DIR-124-B1.md"] })),
  ], { cwd: dir, env: { CLAUDE_CODE_SESSION_ID: "s" } });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(JSON.parse(res.stdout).code, "invalid-task-ids");
});

test("fail-closed — missing task file => material-input-missing", () => {
  const dir = makeGitFixture();
  fs.unlinkSync(path.join(dir, "tasks", "DIR-124-B1.md"));
  const res = runIdentity(["--create", JSON.stringify(createInput())], { cwd: dir, env: { CLAUDE_CODE_SESSION_ID: "s" } });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(JSON.parse(res.stdout).code, "material-input-missing");
});

test("fail-closed — missing workflow source => workflow-source-missing", () => {
  const dir = makeGitFixture();
  const res = runIdentity(["--create", JSON.stringify(createInput({ workflowSourcePath: "plugin/workflows/nonexistent.js" }))], {
    cwd: dir,
    env: { CLAUDE_CODE_SESSION_ID: "s" },
  });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(JSON.parse(res.stdout).code, "workflow-source-missing");
});

test("fail-closed — absolute workflowSourcePath is rejected (workflow-source-path-absolute): the DD6 mirror-parity invariant cannot be bypassed by an absolute path", () => {
  const dir = makeGitFixture();
  const abs = path.join(dir, "plugin", "workflows", "execute-milestone.js");
  const res = runIdentity(["--create", JSON.stringify(createInput({ workflowSourcePath: abs }))], {
    cwd: dir,
    env: { CLAUDE_CODE_SESSION_ID: "s" },
  });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(res.exitCode, 1);
  assert.equal(JSON.parse(res.stdout).code, "workflow-source-path-absolute");
});

test("fail-closed — caller-supplied baseCommit differing from HEAD => base-commit-mismatch", () => {
  const dir = makeGitFixture();
  const res = runIdentity(["--create", JSON.stringify(createInput({ baseCommit: "deadbeef" }))], { cwd: dir, env: { CLAUDE_CODE_SESSION_ID: "s" } });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(JSON.parse(res.stdout).code, "base-commit-mismatch");
});

test("fail-closed — caller-supplied baseCommit equal to HEAD is honored", () => {
  const dir = makeGitFixture();
  const head = gitHead(dir);
  const res = runIdentity(["--create", JSON.stringify(createInput({ baseCommit: head }))], { cwd: dir, env: { CLAUDE_CODE_SESSION_ID: "s" } });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(res.exitCode, 0, res.stdout);
  assert.equal(JSON.parse(res.stdout).baseCommit, head);
});

test("fail-closed — git rev-parse HEAD failure (non-git cwd) => base-commit-unresolved", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "run-identity-nongit-"));
  fs.mkdirSync(path.join(dir, "plugin", "workflows"), { recursive: true });
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, "charters"), { recursive: true });
  fs.mkdirSync(path.join(dir, "docs", "plans"), { recursive: true });
  fs.writeFileSync(path.join(dir, "plugin", "workflows", "execute-milestone.js"), "# workflow\n");
  fs.writeFileSync(path.join(dir, "tasks", "DIR-124-B1.md"), "# task\n");
  fs.writeFileSync(path.join(dir, "charters", "M253-dir-124-b1.md"), "# charter\n");
  fs.writeFileSync(path.join(dir, "docs", "plans", "M253-dir-124-b1.md"), "# plan\n");
  const res = runIdentity(["--create", JSON.stringify(createInput())], { cwd: dir, env: { CLAUDE_CODE_SESSION_ID: "s" } });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(JSON.parse(res.stdout).code, "base-commit-unresolved");
});

test("fail-closed — malformed --create JSON => invalid-json, exit non-zero", () => {
  const res = runIdentity(["--create", "{not valid json"]);
  assert.notEqual(res.exitCode, 0);
  assert.equal(JSON.parse(res.stdout).code, "invalid-json");
});

// ── CLAIM-B1-C7: toBuildManifestRunIdentity projection ──────────────────────────────────────────────

test("C7 — toBuildManifestRunIdentity projects onto build-evidence-manifest's runIdentity shape", async () => {
  const mod = await import(RUN_IDENTITY_TS);
  const singleton = JSON.parse(makeIdentityJson({ candidateId: "M253", taskIds: ["T-1"], attempt: 2, sessionId: "sess" }));
  assert.deepEqual(mod.toBuildManifestRunIdentity(singleton), {
    milestoneId: "M253",
    taskIds: ["T-1"],
    composite: false,
    attempt: 2,
    sessionId: "sess",
  });
  const composite = JSON.parse(makeIdentityJson({ candidateId: "M253", taskIds: ["T-1", "T-2"] }));
  assert.equal(mod.toBuildManifestRunIdentity(composite).composite, true);
  assert.equal(mod.toBuildManifestRunIdentity(composite).milestoneId, "M253");
});

// ── CLAIM-B1-C8: deterministic serialization ────────────────────────────────────────────────────────

test("C8 — serializeIdentity is deterministic and key-insertion-order independent", async () => {
  const mod = await import(RUN_IDENTITY_TS);
  const identity = JSON.parse(makeIdentityJson());
  const s1 = mod.serializeIdentity(identity);

  const reversed = {};
  for (const key of Object.keys(identity).reverse()) reversed[key] = identity[key];
  assert.equal(mod.serializeIdentity(reversed), s1, "top-level key order does not matter");

  const revMih = { ...identity, materialInputHashes: Object.fromEntries(Object.entries(identity.materialInputHashes).reverse()) };
  assert.equal(mod.serializeIdentity(revMih), s1, "nested materialInputHashes key order does not matter");
});

test("C8 — mint twice with the same input serializes byte-identically (in-process factory)", async () => {
  const mod = await import(RUN_IDENTITY_TS);
  const dir = makeGitFixture();
  const savedCwd = process.cwd();
  const savedSession = process.env.CLAUDE_CODE_SESSION_ID;
  try {
    process.env.CLAUDE_CODE_SESSION_ID = "sess-c8";
    process.chdir(dir);
    const id1 = mod.mintRunIdentity(createInput());
    const id2 = mod.mintRunIdentity(createInput());
    assert.equal(mod.serializeIdentity(id1), mod.serializeIdentity(id2));
    assert.equal(id1.runId, "sess-c8::DIR-124-B1::1");
  } finally {
    process.env.CLAUDE_CODE_SESSION_ID = savedSession;
    process.chdir(savedCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
