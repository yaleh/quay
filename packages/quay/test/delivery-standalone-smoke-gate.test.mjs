// DIR-035-D (M52) — `delivery-standalone-smoke` wired as a named `.quay/gates.yml`-declared gate.
//
// Mirrors `it0-gates.test.mjs`'s own shape (real script invocation via `resolveGate`, real CLI
// path via `quay gate <task> --gate ...`), adapted for the ONE difference this gate has from an
// `it0`-style gate: `delivery-standalone-smoke.sh` takes ZERO arguments (no `task.extra[argsKey]`
// required) — exercised via the new `makeFixedScriptGate` factory + `gates.yml`'s `fixed:` list.
//
// Run: node --test packages/quay/test/*.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

import { resolveGate, listGates } from "../src/gate/registry.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const quayBin = path.join(__dirname, "..", "bin", "quay.ts");
const nativeBin = path.join(__dirname, "..", "..", "quay-native", "bin", "quay-native.ts");
const nativeProviderDir = path.dirname(nativeBin);
// repo root: packages/quay/test -> repo root is 3 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SMOKE_SCRIPT = path.join(REPO_ROOT, "packages", "quay", "test", "delivery-standalone-smoke.sh");

const gate = (name) => resolveGate(name, REPO_ROOT);

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

// mirrors it0-gates.test.mjs makeWorkspace(), PLUS a `fixed:` entry pointing at the real
// delivery-standalone-smoke.sh (real process I/O, not a synthetic fixture script).
function makeWorkspace(tag) {
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), `quay-m52-${tag}-tasks-`));
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), `quay-m52-${tag}-ws-`));
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
    ].join("\n")
  );
  fs.writeFileSync(
    path.join(workspaceRoot, ".quay", "gates.yml"),
    [
      "fixed:",
      "  - name: delivery-standalone-smoke",
      `    script: "${SMOKE_SCRIPT.replaceAll("\\", "\\\\")}"`,
      "",
    ].join("\n")
  );
  return { workspaceRoot, tasksDir };
}

// ===========================================================================
// A1 — listGates() + real script invocation (against THIS repo's own workspace).
// ===========================================================================

test("M52 A1: listGates() includes 'delivery-standalone-smoke'", () => {
  assert.ok(listGates().includes("delivery-standalone-smoke"));
});

test("M52 A1: delivery-standalone-smoke gate requires NO task.extra args (zero-arg factory)", async () => {
  // Unlike an it0-style gate, an empty/absent `extra` must NOT fail-closed here — the script
  // itself takes no positional arguments.
  const r = await gate("delivery-standalone-smoke")({ id: "T" });
  assert.equal(typeof r.ok, "boolean");
});

test("M52 A2: delivery-standalone-smoke gate PASSes for real (0 RED, real script, real process I/O)", async () => {
  const r = await gate("delivery-standalone-smoke")({ id: "T", extra: {} });
  assert.equal(r.ok, true, `expected pass (0 RED); got reason=${r.reason}`);
}, { timeout: 60000 });

test("M52 A2: a fixed gate pointed at a non-existent script fails closed (ok:false)", async () => {
  const { resolveGate: rg } = await import("../src/gate/registry.ts");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-m52-fixed-bad-"));
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".quay", "gates.yml"),
    ["fixed:", "  - name: bogus-smoke", '    script: "/no/such/script.sh"', ""].join("\n")
  );
  const r = await rg("bogus-smoke", dir)({ id: "T" });
  assert.equal(r.ok, false);
});

// ===========================================================================
// C1 — real CLI path: `quay gate <task> --gate delivery-standalone-smoke`.
// ===========================================================================

test("M52 C1 [AC2/AC3]: `quay gate --list` includes 'delivery-standalone-smoke'", () => {
  const { workspaceRoot } = makeWorkspace("list");
  const r = runQuay(["gate", "--list"], workspaceRoot);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.split("\n").includes("delivery-standalone-smoke"), `got: ${r.stdout}`);
});

test("M52 C1 [AC2/AC3]: `quay gate <task> --gate delivery-standalone-smoke` PASSes for real and appends a real GateEvent", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("cli-smoke");
  const logFile = path.join(workspaceRoot, "g.jsonl");
  runNative(
    ["task", "create", "T-SMOKE", "--title", "delivery-standalone-smoke CLI fixture", "--status", "todo"],
    tasksDir
  );
  const r = runQuay(
    ["gate", "T-SMOKE", "--gate", "delivery-standalone-smoke", "--file", logFile],
    workspaceRoot
  );
  assert.equal(r.status, 0, `expected PASS; got ${r.status}, stdout=${r.stdout}, stderr=${r.stderr}`);
  assert.match(r.stdout, /PASS/);

  const log = runQuay(["gate-log", "T-SMOKE", "--json", "--file", logFile], workspaceRoot);
  assert.equal(log.status, 0);
  const events = JSON.parse(log.stdout);
  assert.equal(events.length, 1);
  assert.equal(events[0].gate, "delivery-standalone-smoke");
  assert.equal(events[0].verdict, "pass");
  assert.equal(events[0].pipeline_id, "T-SMOKE");
}, { timeout: 60000 });

// ===========================================================================
// D1 — real-world demonstration against THIS repo's own real workspace gates.yml
// (the exact same file the real OUTER-LOOP ABSORB gates against), not a fixture copy.
// ===========================================================================

test("M52 D1: delivery-standalone-smoke gate PASSes against THIS repo's own real .quay/gates.yml wiring", async () => {
  const realGatesYml = path.join(REPO_ROOT, ".quay", "gates.yml");
  assert.ok(fs.existsSync(realGatesYml), "real .quay/gates.yml must exist in this worktree");
  const content = fs.readFileSync(realGatesYml, "utf8");
  assert.match(content, /delivery-standalone-smoke/, "real gates.yml must declare the fixed gate");
  const r = await gate("delivery-standalone-smoke")({ id: "DIR-035-D" });
  assert.equal(r.ok, true, `expected pass against this repo's real workspace; got reason=${r.reason}`);
}, { timeout: 60000 });
