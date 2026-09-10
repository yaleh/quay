// @test-group lowconc
// develop-deliver-tgz.test.mjs — gap-develop-deliver-asserts-http-200-but-root-now-302-redirects:
// the develop→deliver verification criterion (`verify_http_surface` inside develop-deliver-tgz.sh)
// had hard-asserted `curl http_code == 200` on `/`, but `/` 302s to `/dashboard` since 01437b3e6 —
// so every post-merge cross-host deliver verification silently exit-1'd on the still-healthy service.
// The criterion now FOLLOWS the redirect and asserts the FINAL code is 200 AND `/dashboard` serves
// a non-empty body carrying the stable `<title>Dashboard</title>` marker.
//
// Coverage map (task ACs):
//   AC3  — the criterion can take FALSE: `--selfcheck` runs hermetic negative controls (root-404,
//          redirect-to-404, empty-body, no-marker) and asserts each fails (exit non-0), so a 404 /
//          redirect-to-404 is NOT accepted as a pass (硬规则 4: 一个结构上不可能取假的量不是测量).
//   AC3+positive — the criterion can take TRUE: 302→dashboard→200 + direct-200 both pass.
//   AC4  — the per-host state record keeps every host's http + usage_verify signals PRESENT and the
//          failure values DISTINCT (verify-fail vs not-evaluated vs 200) — a single-host failure must
//          not drop a key (硬规则 3b).
//   AC5  — a verify failure carries the actual http code in the reason (`code=404`), not a silent
//          exit 1 (the reason line is the one the local loop prints to stdout on a failed host).
//
// This file uses node:test and declares // @test-group lowconc (hermetic-but-load-sensitive: the
// selfcheck spawns short-lived node stub HTTP servers + curl on private sockets).
//
// Run:
//   scripts/test.sh plugin/test/develop-deliver-tgz.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "plugin", "scripts", "develop-deliver-tgz.sh");

// run(): spawn the script with args, return { status, stdout, stderr }.
function run(args) {
  return spawnSync("bash", [SCRIPT, ...args], { encoding: "utf8" });
}

test("AC3+positive — --selfcheck exits 0 and reports PASS (302→dashboard→200 and direct-200 pass)", () => {
  const r = run(["--selfcheck"]);
  assert.equal(r.status, 0, `--selfcheck must exit 0:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /selfcheck: PASS/, "selfcheck must report PASS");
  // positive controls: the redirect criterion accepts the current product shape
  assert.match(r.stdout, /redirect-ok → OK final_code=200 dashboard=ok/,
    "positive control: 302→/dashboard→200 with the marker must pass (the current product shape)");
  assert.match(r.stdout, /direct-ok → OK final_code=200 dashboard=ok/,
    "positive control: a direct 200 with the marker must pass");
});

test("AC3 — the criterion can take FALSE (root-404 / redirect-to-404 / empty-body / no-marker each fail)", () => {
  const r = run(["--selfcheck"]);
  assert.equal(r.status, 0, `--selfcheck must exit 0:\n${r.stdout}\n${r.stderr}`);
  // negative controls: the criterion is not恒绿 — a 404 and a redirect-to-404 both fail.
  assert.match(r.stdout, /root-404 → FAIL reason=root-final-code-not-200 code=404/,
    "negative control: a 404 on / must fail (criterion can take false)");
  assert.match(r.stdout, /redirect-to-404 → FAIL reason=root-final-code-not-200 code=404/,
    "negative control: a 302→/dashboard→404 chain must fail (a redirect to 404 is NOT accepted)");
  assert.match(r.stdout, /empty-body → FAIL reason=dashboard-body-empty code=200/,
    "negative control: a 200 with an empty dashboard body must fail (content, not just status)");
  assert.match(r.stdout, /no-marker → FAIL reason=dashboard-marker-missing code=200/,
    "negative control: a 200 without the <title>Dashboard</title> marker must fail");
});

test("AC4 — the per-host state record keeps every host's http + usage_verify signals present and distinct", () => {
  const r = run(["--selfcheck"]);
  assert.equal(r.status, 0, `--selfcheck must exit 0:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /state-aggregation both-keys=1 distinct-values=1/,
    "state aggregation: a failed host + an ok host + a not-reached host must all appear, with verify-fail / 200 / not-evaluated distinct (no missing key, 硬规则 3b)");
});

test("AC5 — a verify failure carries the actual http code in the reason line (not a silent exit 1)", () => {
  const r = run(["--selfcheck"]);
  assert.equal(r.status, 0, `--selfcheck must exit 0:\n${r.stdout}\n${r.stderr}`);
  // The FAIL verdict lines carry `code=<n>` — the exact token the local host loop prints to stdout
  // when a host's verify fails (`VERIFY FAILED — FAIL reason=… code=<n>`), so the reason is surfaced.
  assert.match(r.stdout, /code=404/, "a failed verdict must carry the received http code (404)");
  assert.match(r.stdout, /reason=root-final-code-not-200/, "the failed verdict must carry the reason");
});

test("arg validation — an unknown flag exits 2 (usage error, not a silent run)", () => {
  const r = run(["--no-such-flag"]);
  assert.equal(r.status, 2, "unknown argument must exit 2");
  assert.match(r.stderr, /unknown arg/, "the usage error must name the bad argument");
});
