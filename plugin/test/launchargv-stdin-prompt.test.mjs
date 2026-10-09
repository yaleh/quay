// @test-group engine
// Regression pin for gap-launchargv-prompt-in-argv-exceeds-max-arg-strlen.
//
// launchArgv put the whole prompt into ONE argv element (`-p <prompt>`). Linux caps a SINGLE argv
// string at MAX_ARG_STRLEN = 131072 bytes (128 KiB) — independent of ARG_MAX, which is the total
// budget. meta-driver's readings JSON measured 1,281,521 bytes, so every semantic round died on
// `spawn E2BIG`.
//
// The fix: an opt-in `promptViaStdin` that keeps `-p` value-less, plus `runAsync`'s optional
// `stdinData`. This test proves the new transport actually carries an over-limit payload, and the
// negative control proves the OLD transport really is the wall being measured (so the test can't
// pass vacuously).

import { test } from "node:test";
import assert from "node:assert/strict";
import { runAsync } from "../scripts/driver-runtime.ts";

const MAX_ARG_STRLEN = 131072;
const OVER_LIMIT = MAX_ARG_STRLEN + 50_000; // comfortably past the single-argument wall
const ECHO_LEN = [process.execPath, "-e", "let n=0;process.stdin.on('data',d=>n+=d.length);process.stdin.on('end',()=>process.stdout.write(String(n)))"];

test(`runAsync(stdinData) carries a ${OVER_LIMIT}-byte payload the child actually receives in full`, async () => {
  const payload = "x".repeat(OVER_LIMIT);
  const r = await runAsync(ECHO_LEN, { timeoutMs: 30_000, stdinData: payload });
  assert.equal(r.error, null, `spawn must not error: ${r.error?.message}`);
  assert.equal(r.status, 0, `child must exit 0, got ${r.status}`);
  assert.equal(Number(r.stdout), OVER_LIMIT, "the child must report EXACTLY the payload length it read — not a truncated prefix");
});

test("negative control: the SAME payload as a single argv element still fails with E2BIG (the wall is real)", async () => {
  const payload = "x".repeat(OVER_LIMIT);
  const r = await runAsync([...ECHO_LEN, payload], { timeoutMs: 30_000 });
  assert.ok(r.error, "an over-limit single argv element must produce a spawn error, not a successful run");
  assert.equal(r.error.code, "E2BIG", `expected E2BIG, got ${r.error.code ?? r.error.message}`);
});

test("below the wall, the argv path still works (the fix did not change the ordinary case)", async () => {
  const small = "y".repeat(1000);
  const r = await runAsync(ECHO_LEN.slice(0, 2).concat([ECHO_LEN[2]]), { timeoutMs: 30_000, stdinData: small });
  assert.equal(r.error, null);
  assert.equal(Number(r.stdout), 1000);
});

test("omitting stdinData keeps stdin closed — a child reading stdin sees EOF immediately, not a hang", async () => {
  // stdio[0] stays "ignore" when stdinData is undefined; a stdin-reading child must therefore
  // finish on its own (EOF) rather than block forever.
  const r = await runAsync(ECHO_LEN, { timeoutMs: 15_000 });
  assert.equal(r.error, null, `must not hang or error: ${r.error?.message}`);
  assert.equal(r.status, 0);
  assert.equal(Number(r.stdout), 0, "no stdin data was supplied, so the child must read 0 bytes");
});
