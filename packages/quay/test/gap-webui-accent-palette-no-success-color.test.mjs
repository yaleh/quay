// @test-group product
// gap-webui-accent-palette-no-success-color — the web UI palette had no independent
// "success/positive" hue: pass/alive/GO shared the single red-orange accent family with
// fail/dead, distinguished only by shade (accent-700 vs accent-800). This task adds a
// `--color-positive-*` (green) family and re-points the positive-semantics branches at it,
// leaving the negative branches in the accent family.
//
// Two layers of verification:
//   AC3 — the new token's HSL hue differs from --color-accent (#ec3013) by ≥ 60° (a genuinely
//         different hue, not another shade of red-orange), computed mechanically from the shipped
//         stylesheet (which webui-modernist-sync.test.mjs pins byte-identical to the design source).
//   AC7 — a REAL server (the same startServer pattern as webui-modernist-sync.test.mjs) renders
//         /dashboard against a fixture with a state:"green" round and a sysGo:true system reading;
//         the response must colour BOTH spots with the positive token and NOT with accent-700.
//
// Run (scoped): node --test packages/quay/test/gap-webui-accent-palette-no-success-color.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

function request(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

// ── AC3 helpers: hex → HSL hue, plus the (circular) hue difference ─────────────────────────────
function hexToHue(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return ((h * 60) % 360 + 360) % 360;
}
function hueDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// ── AC7: a real server rendering /dashboard against a green-round + sysGo:true fixture ──────────
let server, port, originalCwd, workspaceRoot, tasksDir;

before(async () => {
  tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "gap-accent-tasks-"));
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gap-accent-ws-"));
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`);
  execFileSync("git", ["init", "-q"], { cwd: workspaceRoot });
  fs.writeFileSync(path.join(workspaceRoot, "README.md"), "gap-accent fixture workspace\n");
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "add", "."], { cwd: workspaceRoot });
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "commit", "-qm", "fixture init"], { cwd: workspaceRoot });

  // Force readSystem's two mechanism scripts (resource-gate.sh / process-budget.sh) to a
  // deterministic GO verdict via their documented env test-seams — the dashboard's sysGo is
  // `resourceGate.status==="ok" && processBudget.status==="ok" && both verdicts==="GO"`.
  process.env.RESOURCE_GATE_TEST_CPU_AVG10 = "0.5";
  process.env.RESOURCE_GATE_TEST_MEM_AVAIL_MB = "999999";
  process.env.RESOURCE_GATE_TEST_LOAD_OVERRIDE = "0.5";
  process.env.RESOURCE_GATE_TEST_NPROC = "8";
  process.env.RESOURCE_GATE_TEST_NODE_PROCS = "0";

  originalCwd = process.cwd();
  process.chdir(workspaceRoot);
  server = await startServer({ port: 0 });
  port = server.address().port;
});

after(async () => {
  await new Promise((r) => server.close(r));
  if (server.client) await server.client.close();
  process.chdir(originalCwd);
  delete process.env.RESOURCE_GATE_TEST_CPU_AVG10;
  delete process.env.RESOURCE_GATE_TEST_MEM_AVAIL_MB;
  delete process.env.RESOURCE_GATE_TEST_LOAD_OVERRIDE;
  delete process.env.RESOURCE_GATE_TEST_NPROC;
  delete process.env.RESOURCE_GATE_TEST_NODE_PROCS;
  fs.rmSync(tasksDir, { recursive: true, force: true });
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

const roundsFile = () => path.join(workspaceRoot, ".quay", "verification-round.jsonl");

test("AC3: --color-positive-700 is a genuinely different hue (≥60°) from --color-accent", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "src", "webui-modernist.css"), "utf8");
  const accent = css.match(/--color-accent:\s*#([0-9a-fA-F]{6})/);
  const positive = css.match(/--color-positive-700:\s*#([0-9a-fA-F]{6})/);
  assert.ok(accent, "--color-accent hex present in the shipped stylesheet");
  assert.ok(positive, "--color-positive-700 hex present in the shipped stylesheet");
  const a = hexToHue(`#${accent[1]}`);
  const p = hexToHue(`#${positive[1]}`);
  const diff = hueDiff(a, p);
  assert.ok(diff >= 60, `positive-700 hue ${p.toFixed(1)}° vs accent hue ${a.toFixed(1)}° differs by ${diff.toFixed(1)}° (≥ 60 required)`);
});

test("AC7: /dashboard colours the green round + GO with the positive token, not accent-700", async () => {
  fs.writeFileSync(roundsFile(), [
    { round: 1, state: "green", pass: 100, fail: 0, tests: 100, startedAt: "2026-09-01T08:00:00Z" },
    { round: 2, state: "red", pass: 90, fail: 10, tests: 100, startedAt: "2026-09-01T09:00:00Z" },
  ].map((r) => JSON.stringify(r)).join("\n") + "\n");

  const r = await request(port, "/dashboard");
  assert.equal(r.status, 200);
  // The shipped token sheet is inlined, so the new token definition is present in the page.
  assert.ok(r.body.includes("--color-positive-700"), "dashboard inlines the positive token definition");
  // sysGo true → the system-resource card headline reads "⇒ GO", coloured with the positive token.
  assert.ok(r.body.includes("⇒ GO"), "system-resource card renders GO when both gates are GO");
  assert.ok(r.body.includes('color:var(--color-positive-700)">⇒ GO'), "GO uses the positive token");
  assert.ok(!r.body.includes('color:var(--color-accent-700)">⇒ GO'), "GO no longer uses accent-700");
  // 近N轮 strip: the green round's block uses the positive token as its background.
  assert.ok(r.body.includes("background:var(--color-positive-700)"), "green round block uses the positive token");
  assert.ok(!r.body.includes("background:var(--color-accent-700)"), "green round block no longer uses accent-700");
  // The red round's block stays in the accent family — the fix is scoped to positive, not a blanket recolour.
  assert.ok(r.body.includes("background:var(--color-accent-800)"), "red round block still uses accent-800");
});
