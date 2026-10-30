// @test-group engine
// codex-plugin-surface.test.mjs — the in-repo guard for AC-931's publish-surface criterion
// (task gap-codex-plugin-publish-surface-plugin-json-mcp-dist).
//
// WHY this test exists: AC-931's criterion (goals/AC-931-*.md) checks that the repo root carries a
// `.codex-plugin/plugin.json` that declares the quay MCP server against the INSTALLED dist
// (`quay.js mcp`) and NOT the dev-tree source (`packages/quay/bin/quay.ts`). That predicate lives
// only in the goal store and is evaluated by the goal driver — a later edit that re-points the
// manifest at the dev-tree source (or drops the declaration / the file) would be invisible until the
// next goal-driver round.
//
// SINGLE SOURCE (ADR-004): this test does NOT restate the predicate. It fetches AC-931's `criterion`
// field VERBATIM from `quay goal show AC-931 --json` (the same store the goal driver evaluates) and
// executes THAT string. Copying the three greps here would be a second home for one rule.
//
// The test carries its OWN negative controls: the same criterion is run against three throwaway
// `.codex-plugin/plugin.json` states — (a) args re-pointed at the dev-tree source, (b) the quay
// declaration removed, (c) the file removed — and each must exit 1 with the LOUD cause on stderr
// (`dev-tree source path present` / `no quay MCP declaration` / `absent`). Without them the positive
// assertion would also pass against a criterion that is trivially green (硬规则 3b / 4).
//
// Run: scripts/test.sh plugin/test/codex-plugin-surface.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const PLUGIN_JSON = path.join(ROOT, ".codex-plugin", "plugin.json");
const QUAY_BIN = path.join(ROOT, "packages", "quay", "bin", "quay.js");

// ── AC-931's criterion, read verbatim from the goal store (never re-typed) ────────────────────
function readAc931Criterion() {
  const res = spawnSync(process.execPath, [QUAY_BIN, "goal", "show", "AC-931", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(res.status, 0, `quay goal show AC-931 --json must exit 0:\n${res.stderr}`);
  const parsed = JSON.parse(res.stdout);
  assert.equal(typeof parsed.criterion, "string", "AC-931 carries no string `criterion` field");
  assert.ok(parsed.criterion.trim().length > 0, "AC-931's `criterion` is blank");
  return parsed.criterion;
}

// The goal store runs a criterion through `bash -c <criterion>` in the workspace root. Reproduce
// that shape exactly: write the criterion verbatim to a scratch file and run `bash <scratch>` with
// cwd = the tree whose `.codex-plugin/plugin.json` is under test. The scratch file is never placed
// in `cwd`, so a positive run against ROOT leaves the repo tree untouched.
function runCriterion(criterion, cwd) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "ac931-criterion-"));
  const script = path.join(scratch, "criterion.sh");
  fs.writeFileSync(script, criterion, "utf8");
  try {
    return spawnSync("bash", [script], { cwd, encoding: "utf8" });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function writePluginJson(tmp, manifest) {
  fs.mkdirSync(path.join(tmp, ".codex-plugin"), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, ".codex-plugin", "plugin.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8",
  );
}

test("AC-931 criterion passes on this repo's .codex-plugin/plugin.json", () => {
  const criterion = readAc931Criterion();
  const res = runCriterion(criterion, ROOT);
  assert.equal(
    res.status,
    0,
    `AC-931 criterion must exit 0 on ${PLUGIN_JSON}\nstdout: ${res.stdout}\nstderr: ${res.stderr}`,
  );
  assert.equal(res.stderr, "", "a passing AC-931 run must not write to stderr");
});

test("the publish surface declares quay against the installed dist, not the dev-tree source (position)", () => {
  const raw = fs.readFileSync(PLUGIN_JSON, "utf8");
  assert.doesNotMatch(
    raw,
    /packages\/quay\/bin\/quay\.ts/,
    "manifest must not reference the dev-tree source path",
  );
  const manifest = JSON.parse(raw);
  const server = manifest.mcpServers?.quay;
  assert.ok(server && typeof server === "object", "manifest must declare mcpServers.quay");
  assert.equal(server.command, "node", "mcpServers.quay.command must be node");
  assert.ok(Array.isArray(server.args), "mcpServers.quay.args must be an array");
  assert.ok(
    server.args.includes("quay.js"),
    `args must point at the installed dist; got ${JSON.stringify(server.args)}`,
  );
  assert.ok(
    server.args.includes("mcp"),
    `args must include the mcp subcommand; got ${JSON.stringify(server.args)}`,
  );
});

test("negative control: re-pointing args at the dev-tree source fails with `dev-tree source path present`", () => {
  const criterion = readAc931Criterion();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ac931-source-path-"));
  try {
    writePluginJson(tmp, {
      name: "quay",
      version: "0.26.0-dev",
      description: "quay MCP server",
      mcpServers: { quay: { command: "node", args: ["packages/quay/bin/quay.ts", "mcp"] } },
    });
    const res = runCriterion(criterion, tmp);
    assert.equal(res.status, 1, `expected exit 1, got ${res.status}\nstdout: ${res.stdout}\nstderr: ${res.stderr}`);
    assert.match(res.stderr, /dev-tree source path present/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("negative control: removing the quay declaration fails with `no quay MCP declaration`", () => {
  const criterion = readAc931Criterion();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ac931-no-quay-"));
  try {
    // The criterion greps the WHOLE file for the substring `quay`, so "declaration removed" means
    // the file must carry no `quay` text at all (a name/description that still says "quay" would
    // keep `grep -q quay` green). Keep the manifest shape, drop every quay-specific token.
    writePluginJson(tmp, {
      name: "example",
      version: "0.26.0-dev",
      description: "a provider-agnostic task board MCP server",
      mcpServers: {},
    });
    const res = runCriterion(criterion, tmp);
    assert.equal(res.status, 1, `expected exit 1, got ${res.status}\nstdout: ${res.stdout}\nstderr: ${res.stderr}`);
    assert.match(res.stderr, /no quay MCP declaration/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("negative control: removing the file fails with `absent`", () => {
  const criterion = readAc931Criterion();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ac931-absent-"));
  try {
    // `.codex-plugin/` exists but `plugin.json` is gone — the exact state the criterion's first
    // `[ ! -f .codex-plugin/plugin.json ]` guard catches.
    fs.mkdirSync(path.join(tmp, ".codex-plugin"), { recursive: true });
    const res = runCriterion(criterion, tmp);
    assert.equal(res.status, 1, `expected exit 1, got ${res.status}\nstdout: ${res.stdout}\nstderr: ${res.stderr}`);
    assert.match(res.stderr, /absent/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
