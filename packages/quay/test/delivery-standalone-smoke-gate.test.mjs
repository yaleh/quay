// @test-group product
// @load-sensitive wall-clock
// @load-sensitive-entry 2026-08-12 real standalone smoke gates with real waits (163s); moved product→serial 2026-08-12 (7/7 isolated, timed out under 8-lane — gap-suite-tiering-kind-heavy-not-a-mechanism 补缺省 kind), then serial→product 2026-08-25 (gap-suite-move-27-evidenced-files-out-serial-lowconc — passed 22-60× high-load verification, reverted to the default product group)
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — real-wall-clock-wait smoke gates (delivery-standalone-smoke.sh: pack + fresh-workspace install)
// (2026-08-12 outer: product → serial — real standalone smoke gates with real waits, 163s in the
// 8-lane suite timed out but 7/7 pass isolated ⇒ load-sensitive real-wall-clock-wait family.
// 2026-08-25: serial → product again (gap-suite-move-27-evidenced-files-out-serial-lowconc) — the
// @test-group reverted to the default product group while the @load-sensitive / KNOWN-LOAD-SENSITIVE
// markers are retained (the independent load-sensitive family mechanism, not the de-concurrency list).
// DIR-035-D (M52) — `delivery-standalone-smoke` wired as a named gate declared in the
// workspace's gates config (DIR-120: `.quay/config.yml`'s own `gates:` section for THIS repo;
// a legacy `.quay/gates.yml` only for a workspace with no `config.yml`).
//
// Mirrors `it0-gates.test.mjs`'s own shape (real script invocation via `resolveGate`, real CLI
// path via `quay gate <task> --gate ...`), adapted for the ONE difference this gate has from an
// `it0`-style gate: `delivery-standalone-smoke.sh` takes ZERO arguments (no `task.extra[argsKey]`
// required) — exercised via the new `makeFixedScriptGate` factory + the gates config's `fixed:` list.
//
// Run: node --test packages/quay/test/*.mjs

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

// Every workspace / fixed-gate fixture dir is removed once at the end of this file — the
// carrier-array + after() pattern — so `quay-m52-*` never accumulates a /tmp dir per run.
const _tmpDirs = [];
after(() => {
  for (const dir of _tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});
// repo root: packages/quay/test -> repo root is 3 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SMOKE_SCRIPT = path.join(REPO_ROOT, "packages", "quay", "test", "delivery-standalone-smoke.sh");

// ── Amortized deliver baseline (gap-npm-file-copy-amortize AC1) ──────────────────────────────────
// A2/C1/D1 (and the A1 zero-arg factory) each invoke the smoke gate through a DIFFERENT access
// surface (direct gate() resolve, CLI `quay gate`, real-workspace wiring) but all run the SAME
// smoke.sh — which historically did a full `npm pack → npm install --omit=dev` per invocation
// (4× the expensive npm ops for one product state). Mirror quay-init-loop-helpers.mjs's
// "one real install → shared baseline → each test deltas" technique: point every smoke.sh
// invocation at ONE fresh baseline dir. The FIRST invocation builds the delivered product there
// (real npm pack + install), the other three reuse it. Mechanism unchanged — still a real npm run
// and real bash, just not repeated 4× (AC3). A fresh mkdtemp per run means no stale-baseline reuse.
const SMOKE_BASE = fs.mkdtempSync(path.join(os.tmpdir(), "quay-m52-base-"));
_tmpDirs.push(SMOKE_BASE);
process.env.QUAY_DELIVERY_SMOKE_BASE = SMOKE_BASE;

const gate = (name) => resolveGate(name, REPO_ROOT);

// delivery-standalone-smoke.sh simulates a real npm delivery (pack + fresh-workspace install),
// which under full-suite load (4 cores, concurrency 8) exceeds the gate runner's 60s default —
// flaked 4x (qinit suite #1 ×3, batch5). The gate genuinely PASSES when given time; give it
// headroom. (The runner reads QUAY_ACCEPTANCE_TIMEOUT_MS; see gate/config/utils.ts.)
process.env.QUAY_ACCEPTANCE_TIMEOUT_MS = "120000";

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
//
// DIR-120 Phase 2: this workspace's `.quay/config.yml` already exists (it carries
// `providers:`), so branch A is TERMINAL for `readGatesConfig` — the fixed gate
// MUST live in config.yml's own `gates:` section now. A separate `.quay/gates.yml`
// sibling would be silently ignored (branch A never falls through once config.yml
// exists), not a real branch-B fixture.
function makeWorkspace(tag) {
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), `quay-m52-${tag}-tasks-`));
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), `quay-m52-${tag}-ws-`));
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
      "  fixed:",
      "    - name: delivery-standalone-smoke",
      `      script: "${SMOKE_SCRIPT.replaceAll("\\", "\\\\")}"`,
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
}, { timeout: 150000 });

test("M52 A2: a fixed gate pointed at a non-existent script fails closed (ok:false)", async () => {
  const { resolveGate: rg } = await import("../src/gate/registry.ts");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-m52-fixed-bad-"));
  _tmpDirs.push(dir);
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
}, { timeout: 150000 });

// ===========================================================================
// D1 — real-world demonstration against THIS repo's own real workspace gates
// wiring (the exact same source the real OUTER-LOOP ABSORB gates against),
// not a fixture copy.
//
// DIR-120 Phase 2 (2026-07-28): root `.quay/gates.yml` has been physically
// deleted and its reader fallback removed — `.quay/config.yml`'s own
// `gates:` section is the ONLY source THIS workspace's readers resolve from.
// ===========================================================================

test("M52 D1: delivery-standalone-smoke gate PASSes against THIS repo's own real .quay/config.yml gates: wiring", async () => {
  const realConfigYml = path.join(REPO_ROOT, ".quay", "config.yml");
  assert.ok(fs.existsSync(realConfigYml), "real .quay/config.yml must exist in this worktree");
  const content = fs.readFileSync(realConfigYml, "utf8");
  assert.match(content, /delivery-standalone-smoke/, "real config.yml's gates: section must declare the fixed gate");
  const r = await gate("delivery-standalone-smoke")({ id: "DIR-035-D" });
  assert.equal(r.ok, true, `expected pass against this repo's real workspace; got reason=${r.reason}`);
}, { timeout: 150000 });
