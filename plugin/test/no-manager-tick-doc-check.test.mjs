// @test-group product
// no-manager-tick-doc-check.test.mjs — gap-manager-productization-five-constraints, AC4 (C3).
//
// Pins the mechanical C3 check (SPEC-manager-productization §3): the OUTER tick docs must contain
// NO create/drive/check manager STEP. Boundary prose (manager 跨项目 / 不属于项目拓扑 / 不建 —
// describing why the outer does NOT manage the manager) is NOT a step and must NOT redden the
// checker. The manager's OWN operating doc (plugin/loop/manager-loop-tick.md) is NOT scanned.
//
// Run:
//   scripts/test.sh plugin/test/no-manager-tick-doc-check.test.mjs
//   node --test plugin/test/no-manager-tick-doc-check.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginDir, "..");
const CHECKER = path.join(pluginDir, "scripts", "no-manager-tick-doc-check.sh");
const TEST_SH = path.join(repoRoot, "scripts", "test.sh");

// R6 carrier-array cleanup (document-store pattern) — no tmpdir leak (test-isolation R6 ratchet).
const _tmpDirs = [];
after(() => {
  for (const d of _tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

function run(args, opts = {}) {
  return spawnSync("bash", args, { encoding: "utf8", cwd: repoRoot, ...opts });
}

function makeTmp(prefix = "quay-nomgr-") {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  _tmpDirs.push(d);
  return d;
}

// Assemble a temp root mirroring the real outer tick docs (the checker's object).
function mirrorTickDocs(target) {
  const root = path.join(target, "root");
  fs.mkdirSync(path.join(root, "orchestration"), { recursive: true });
  fs.mkdirSync(path.join(root, "plugin", "loop"), { recursive: true });
  for (const rel of [
    "orchestration/orchestrator-loop-tick.md",
    "plugin/loop/orchestrator-loop-tick.md",
    "plugin/loop/fast-mode-loop-tick.md",
  ]) {
    fs.copyFileSync(path.join(repoRoot, rel), path.join(root, rel));
  }
  return root;
}

test("AC4 — baseline GREEN on the real outer tick docs (boundary prose is NOT a create/drive/check step)", () => {
  const r = run([CHECKER, repoRoot]);
  assert.equal(r.status, 0, `checker must pass on the real tick docs, got exit ${r.status}:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /CLEAN/, "checker must report CLEAN");
});

test("AC4 — inject a `quay manager start` step ⇒ checker RED (create/drive/check manager step caught)", () => {
  const tmp = makeTmp();
  const root = mirrorTickDocs(tmp);
  fs.appendFileSync(
    path.join(root, "orchestration", "orchestrator-loop-tick.md"),
    "\nquay manager start 拉起管理者会话（人工执行，非外层）。\n"
  );
  const r = run([CHECKER, root]);
  assert.equal(r.status, 1, `injected manager step must redden the checker, got exit ${r.status}:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout + r.stderr, /VIOLATION/, "checker must name the violating line");
  assert.match(r.stdout + r.stderr, /manager start/, "checker must cite the manager-step pattern");
});

test("AC4 — restore (remove the injected step) ⇒ GREEN (the +1 → 0 control direction)", () => {
  const tmp = makeTmp();
  const root = mirrorTickDocs(tmp);
  const f = path.join(root, "orchestration", "orchestrator-loop-tick.md");
  fs.appendFileSync(f, "\nquay manager adopt /x 建项目。\n");
  assert.equal(run([CHECKER, root]).status, 1, "injected adopt step must redden first");
  const clean = fs.readFileSync(f, "utf8").replace(/\nquay manager adopt \/x 建项目。\n/, "\n");
  fs.writeFileSync(f, clean);
  const r = run([CHECKER, root]);
  assert.equal(r.status, 0, `restored tick docs must pass, got exit ${r.status}:\n${r.stdout}\n${r.stderr}`);
});

test("AC4 — the manager's OWN operating doc (plugin/loop/manager-loop-tick.md) is NOT the checker's object", () => {
  // The manager talking about itself is not the OUTER creating/driving/checking it. The checker
  // scans only the three outer tick docs; a manager self-reference must not redden it.
  const tmp = makeTmp();
  const root = mirrorTickDocs(tmp);
  // Add a manager-loop-tick.md (like the shipped product doc) that speaks of the manager driving
  // projects — it must NOT be scanned.
  fs.writeFileSync(
    path.join(root, "plugin", "loop", "manager-loop-tick.md"),
    "# 管理者 tick 指令\n\n每个 tick 驱动项目、检查存活。\n"
  );
  const r = run([CHECKER, root]);
  assert.equal(r.status, 0, `manager's own doc must not redden the outer checker, got exit ${r.status}:\n${r.stdout}\n${r.stderr}`);
});

test("AC4 — the checker is wired into run_static_checks (scripts/test.sh) with the change-tier annotations", () => {
  const src = fs.readFileSync(TEST_SH, "utf8");
  assert.match(src, /no-manager-tick-doc-check/, "scripts/test.sh must invoke no-manager-tick-doc-check");
  const block = src.slice(src.indexOf("== no-manager-tick-doc check"));
  assert.match(block, /@static-tier change/, "the checker must be @static-tier change (scoped-relevant)");
  assert.match(block, /@static-object orchestration\/ plugin\/loop\//, "the checker must carry its object glob");
  assert.match(block, /run_checker "no-manager-tick-doc-check"/, "the checker must be registered via run_checker");
});
