// @test-group engine
// config-wiring-check.test.mjs — gap-config-wiring-check-symlink-noop regression coverage
// (M-DIR119-C-CANARY, 2026-07-27). RED-first (ADR-001 / DIR-019): before the fix, the mirror-path
// invocation of both `config-wiring-check.ts` and `concurrent-batch-scheduler.ts` silently no-oped
// (exit 0, no output) because `process.argv[1]` (never resolved through a symlink) could never
// equal `fileURLToPath(import.meta.url)` (always resolved through symlinks by Node's ESM loader).
// This file spawns REAL subprocesses via BOTH invocation paths and asserts they behave identically
// — a direct regression guard, not a unit test of internal logic (which is covered elsewhere).
//
// Run: node --test experiments/quay-perpetual-stream/test/config-wiring-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function run(relPath, args) {
  try {
    const out = execFileSync("node", [relPath, ...args], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout: out };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

// Strip the Node MODULE_TYPELESS_PACKAGE_JSON warning banner — it carries a per-process PID
// (`(node:12345)`) that differs on every invocation, and is orthogonal to the behavior under test.
function normalize(s) {
  return s
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter(
      (line) =>
        !/^\(node:\d+\) \[MODULE_TYPELESS_PACKAGE_JSON\]/.test(line) &&
        !/^Reparsing as ES module/.test(line) &&
        !/^To eliminate this warning/.test(line) &&
        !/^\(Use `node --trace-warnings/.test(line)
    )
    .join("\n");
}

test("config-wiring-check.ts: mirror-path invocation is real, not a silent no-op", () => {
  const mirrorPath = "experiments/quay-perpetual-stream/scripts/config-wiring-check.ts";
  const realPath = "plugin/scripts/config-wiring-check.ts";
  assert.ok(
    fs.lstatSync(path.join(REPO_ROOT, mirrorPath)).isSymbolicLink(),
    "precondition: the mirror path must actually be a symlink for this test to be meaningful"
  );

  const mirror = run(mirrorPath, ["--driver", "both"]);
  const real = run(realPath, ["--driver", "both"]);

  // The historical bug: mirror silently exits 0 with EMPTY stdout regardless of real repo state.
  // Assert the mirror path produced REAL, non-empty output — not a silent pass.
  assert.ok(normalize(mirror.stdout).length > 0, "mirror-path invocation must produce real output, not silence");
  // Both invocation paths must agree exactly: same exit code, same stdout.
  assert.equal(mirror.code, real.code, `mirror exit=${mirror.code} real exit=${real.code} — invocation paths disagree`);
  assert.equal(normalize(mirror.stdout), normalize(real.stdout), "mirror-path and real-path stdout must be byte-identical");
});

test("concurrent-batch-scheduler.ts: mirror-path invocation is real, not a silent no-op", () => {
  const mirrorPath = "experiments/quay-perpetual-stream/scripts/concurrent-batch-scheduler.ts";
  const realPath = "plugin/scripts/concurrent-batch-scheduler.ts";
  assert.ok(
    fs.lstatSync(path.join(REPO_ROOT, mirrorPath)).isSymbolicLink(),
    "precondition: the mirror path must actually be a symlink for this test to be meaningful"
  );

  // No charter args -> usage error (exit 2) is the REAL script's own behavior. The historical bug
  // made the mirror path exit 0 with NO output instead (main() never reached).
  const mirror = run(mirrorPath, []);
  const real = run(realPath, []);

  assert.equal(mirror.code, real.code, `mirror exit=${mirror.code} real exit=${real.code} — invocation paths disagree`);
  assert.equal(mirror.code, 2, "both paths must reach the script's own usage-error exit(2), not silently exit 0");
  assert.equal(normalize(mirror.stderr ?? ""), normalize(real.stderr ?? ""), "mirror-path and real-path stderr must be byte-identical");
});
