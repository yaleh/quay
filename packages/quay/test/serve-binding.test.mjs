// @test-group product
// serve-binding.test.mjs — the ONE definition point for the `quay serve` web binding
// (gap-serve-binding-defaults-three-copies-to-one-definition-point AC2/AC3).
//
// What this pins:
//   · precedence   — an explicit CLI flag > `.quay/config.yml` `serve:` > the fallback;
//   · three-valued — a malformed value is `not-evaluated`, NEVER the fallback (硬规则 3b);
//   · AC2 negative control — the fallback is a LIVE value the resolver READS, not an echoed copy:
//     mutate the single literal in a temp copy of the module and `resolveServeBinding({}).host`
//     must move with it;
//   · AC3 — `quay serve` on a workspace whose config carries a malformed `serve.port` REFUSES:
//     non-zero exit, no carrier (⇒ no successful listen) and no admission lock (⇒ the refusal
//     happened before the lock, hence before any socket existed).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveServeBinding, SERVE_BINDING_FALLBACK } from "../src/serve-binding.ts";
import { QUAY_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "../src/serve-binding.ts");

function tmpWs(config) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "serve-binding-ws-"));
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(ws, ".quay", "config.yml"), config, "utf8");
  return ws;
}

test("the fallback arm: no CLI flag, no config ⇒ the ONE declared fallback", () => {
  const r = resolveServeBinding({});
  assert.equal(r.kind, "resolved");
  assert.equal(r.host, SERVE_BINDING_FALLBACK.host);
  assert.equal(r.port, SERVE_BINDING_FALLBACK.port);
  assert.equal(r.source, "fallback");
  assert.equal(r.detail, "host=fallback, port=fallback");
});

test("precedence: CLI flag > config.serve > fallback, per field", () => {
  const cfg = { serve: { host: "10.1.2.3", port: 4321 } };
  const fromConfig = resolveServeBinding({ config: cfg });
  assert.deepEqual([fromConfig.host, fromConfig.port, fromConfig.source], ["10.1.2.3", 4321, "config"]);

  const cliWins = resolveServeBinding({ config: cfg, cliHost: "192.0.2.9", cliPort: 1 });
  assert.deepEqual([cliWins.host, cliWins.port, cliWins.source], ["192.0.2.9", 1, "cli"]);

  // Per FIELD, not per source: a CLI host with a config port keeps the config port.
  const mixed = resolveServeBinding({ config: cfg, cliHost: "192.0.2.9" });
  assert.deepEqual([mixed.host, mixed.port, mixed.source], ["192.0.2.9", 4321, "cli"]);
  assert.equal(mixed.detail, "host=cli, port=config");
});

test("AC3 unit: every malformed value is `not-evaluated` — never the fallback, never a throw", () => {
  const cases = [
    [{ config: { serve: { port: "abc" } } }, /config\.serve\.port/],
    [{ config: { serve: { port: -1 } } }, /config\.serve\.port/],
    [{ config: { serve: { port: 70000 } } }, /config\.serve\.port/],
    [{ config: { serve: { port: 1.5 } } }, /config\.serve\.port/],
    [{ config: { serve: { host: "" } } }, /config\.serve\.host/],
    [{ config: { serve: { host: 7 } } }, /config\.serve\.host/],
    [{ config: { serve: "0.0.0.0" } }, /config\.serve must be a mapping/],
    [{ cliPort: Number("abc") }, /--port/],
    [{ cliHost: "   " }, /--host/],
  ];
  for (const [input, re] of cases) {
    const r = resolveServeBinding(input);
    assert.equal(r.kind, "not-evaluated", `expected not-evaluated for ${JSON.stringify(input)}, got ${JSON.stringify(r)}`);
    assert.match(r.reason, re);
    // The whole point: a bad value must NOT silently become the fallback.
    assert.equal(r.host, undefined);
    assert.equal(r.port, undefined);
  }
  // …and a LEGAL value is still resolved (the negative control for the control above).
  assert.equal(resolveServeBinding({ config: { serve: { port: 0 } } }).kind, "resolved");
  assert.equal(resolveServeBinding({ config: { serve: { port: 0 } } }).port, 0);
});

test("a config with NO serve: section resolves (the section is OPTIONAL)", () => {
  const r = resolveServeBinding({ config: { providers: {} } });
  assert.equal(r.kind, "resolved");
  assert.equal(r.source, "fallback");
  // …and a present-but-empty section is the same reading, not a refusal.
  assert.equal(resolveServeBinding({ config: { serve: {} } }).kind, "resolved");
});

test("AC2 negative control: the fallback is a LIVE value — mutate the ONE literal and the resolver moves", async () => {
  const src = fs.readFileSync(SRC, "utf8");
  const needle = `host: ${JSON.stringify(SERVE_BINDING_FALLBACK.host)}`;
  // If the needle is gone the control would be vacuous — say so instead of passing.
  assert.ok(src.includes(needle), `the mutation target (${needle}) must exist in serve-binding.ts`);

  const MUTATED = "203.0.113.7";
  const mutated = src.replace(needle, `host: ${JSON.stringify(MUTATED)}`);
  assert.notEqual(mutated, src, "the replacement must actually change the source");

  assert.equal(resolveServeBinding({}).host, SERVE_BINDING_FALLBACK.host, "baseline (unmutated module)");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "serve-binding-mut-"));
  const file = path.join(dir, "serve-binding.ts");
  fs.writeFileSync(file, mutated, "utf8");
  try {
    const mod = await import(pathToFileURL(file).href);
    assert.equal(mod.resolveServeBinding({}).host, MUTATED,
      "changing the single fallback literal changes what the resolver returns — the value is READ, not echoed");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(resolveServeBinding({}).host, SERVE_BINDING_FALLBACK.host, "and the real module is unaffected");
});

test("AC3 live: a malformed serve.port REFUSES the start — non-zero exit, no carrier, no admission lock", () => {
  const ws = tmpWs('providers:\n  native:\n    enabled: true\n    path: "./nope"\nserve:\n  port: abc\n');
  const strip = QUAY_CLI.endsWith(".ts") ? ["--experimental-strip-types"] : [];
  const r = spawnSync(process.execPath, ["--no-warnings", ...strip, QUAY_CLI, "serve"], {
    cwd: ws,
    encoding: "utf8",
    timeout: 60000,
    env: { ...process.env, NODE_OPTIONS: "" },
  });
  try {
    assert.notEqual(r.status, null, "the process must have EXITED, not been killed by the timeout");
    assert.notEqual(r.status, 0, `expected a refusal, got exit ${r.status}\nstdout:${r.stdout}\nstderr:${r.stderr}`);
    assert.match(`${r.stdout}${r.stderr}`, /the web binding could not be resolved/,
      "the refusal names its own cause");
    // The carrier is written only AFTER a successful listen ⇒ its absence is the "no LISTEN socket" reading.
    assert.equal(fs.existsSync(path.join(ws, ".quay", "server.json")), false, "no carrier ⇒ the host never listened");
    // The admission lock is taken AFTER the binding resolves ⇒ its absence proves the refusal returned
    // before the lock, hence before connectProvider / serveControlPlane / listen — no socket could exist.
    assert.equal(fs.existsSync(path.join(ws, ".quay", "server.lock")), false, "no admission lock was taken");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC3 live control: the SAME workspace shape with a LEGAL serve.port is NOT refused by the binding", () => {
  // Not a full server start (no provider behind "./nope") — the reading is that the failure is a
  // DIFFERENT one, i.e. the binding refusal is caused by the VALUE, not by the workspace shape.
  const ws = tmpWs('providers:\n  native:\n    enabled: true\n    path: "./nope"\nserve:\n  port: 47999\n');
  const strip = QUAY_CLI.endsWith(".ts") ? ["--experimental-strip-types"] : [];
  const r = spawnSync(process.execPath, ["--no-warnings", ...strip, QUAY_CLI, "serve"], {
    cwd: ws,
    encoding: "utf8",
    timeout: 60000,
    env: { ...process.env, NODE_OPTIONS: "" },
  });
  try {
    assert.doesNotMatch(`${r.stdout}${r.stderr}`, /the web binding could not be resolved/,
      `a legal value must not be refused by the binding arm\nstdout:${r.stdout}\nstderr:${r.stderr}`);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
