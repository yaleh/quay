// @test-group engine
// codex-plugin-surface.test.mjs — the in-repo guard for the codex publish surface, two predicates:
//
//   (1) AC-931's criterion (task gap-codex-plugin-publish-surface-plugin-json-mcp-dist): the repo
//       root carries a `.codex-plugin/plugin.json` that declares the quay MCP server against the
//       INSTALLED dist (`quay.js mcp`) and NOT the dev-tree source (`packages/quay/bin/quay.ts`).
//       That predicate lives ONLY in the goal store and is evaluated by the goal driver — this test
//       fetches it VERBATIM from `quay goal show AC-931 --json` and executes THAT string (ADR-004:
//       never a second copy).
//
//   (2) The codex-INSTALLABLE manifest shape (task gap-codex-plugin-surface-not-installable; layout
//       fixed by gap-codex-plugin-mcp-json-nested-in-wrong-level):
//       `.codex-plugin/plugin.json` must be the codex-legal form — `mcpServers` is a PATH STRING
//       `"./.mcp.json"` (not an inline object), plus `author` and the `interface` block — and
//       `.mcp.json` must live at the PLUGIN PACKAGE ROOT (`.codex-plugin/`'s SIBLING, not inside it —
//       codex resolves the path string relative to the package root) declaring the quay MCP server
//       against the SELF-CONTAINED in-package dist (`vendor/quay/dist/quay.js`), never
//       `~/.claude/plugins/cache/...`. A shared `validateCodexPackage(root)` returns a LOUD failure
//       list, so the positive test can take the value false and the negative controls (inline
//       mcpServers; `.mcp.json` nested back inside `.codex-plugin/`) red on the exact cause.
//
//   The test carries its OWN negative controls: the AC-931 criterion is run against three
//   throwaway `.codex-plugin/plugin.json` states — (a) args re-pointed at the dev-tree source,
//   (b) the quay declaration removed, (c) the file removed — and each must exit 1 with the LOUD
//   cause on stderr. The installable-shape validator is run against an inline-mcpServers manifest
//   and must name `mcpServers is not a path string`; and against the OLD nested layout (`.mcp.json`
//   back inside `.codex-plugin/`) it must name the layout failure. Without them the positive
//   assertions would also pass against a trivially-green check (硬规则 3b / 4).
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
const MCP_JSON = path.join(ROOT, ".mcp.json");
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

// ── the codex-installable package validator: returns a LOUD list of failures (never a boolean) ──
// Reads `.codex-plugin/plugin.json` + the SIBLING `.mcp.json` under `root`. `mcpServers` must be
// the path string "./.mcp.json" (codex resolves it relative to the plugin package root — the SIBLING
// of `.codex-plugin/`, not inside it); the `.mcp.json` must declare mcpServers.quay as stdio against
// the in-package dist (a relative path — an absolute `~/.claude/plugins/cache/...` would break the
// moment the Claude Code cache is cleared). The OLD nested layout (`.codex-plugin/.mcp.json` or
// `.codex-plugin/vendor/`) must be absent — that is the whole gap this validator pins (硬规则 2:
// position, not keyword).
function validateCodexPackage(root) {
  const failures = [];
  const pluginJson = path.join(root, ".codex-plugin", "plugin.json");
  const mcpJson = path.join(root, ".mcp.json");
  const nestedMcpJson = path.join(root, ".codex-plugin", ".mcp.json");
  const nestedVendor = path.join(root, ".codex-plugin", "vendor");

  if (fs.existsSync(nestedMcpJson)) {
    failures.push(".codex-plugin/.mcp.json must not exist (.mcp.json lives at the package root, a SIBLING of .codex-plugin/)");
  }
  if (fs.existsSync(nestedVendor)) {
    failures.push(".codex-plugin/vendor must not exist (the dist lives at the package-root vendor/, not inside .codex-plugin/)");
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(pluginJson, "utf8"));
  } catch (e) {
    return [`${pluginJson} unreadable: ${e.message}`];
  }
  if (typeof manifest.mcpServers !== "string") {
    failures.push("mcpServers is not a path string");
  } else if (manifest.mcpServers !== "./.mcp.json") {
    failures.push(`mcpServers must be "./.mcp.json", got ${JSON.stringify(manifest.mcpServers)}`);
  }
  if (!manifest.author) failures.push("author missing");
  const iface = manifest.interface;
  if (!iface) failures.push("interface missing");
  else {
    if (!iface.displayName) failures.push("interface.displayName missing");
    if (!iface.shortDescription) failures.push("interface.shortDescription missing");
    if (!iface.category) failures.push("interface.category missing");
    if (!Array.isArray(iface.capabilities)) failures.push("interface.capabilities not an array");
  }

  if (!fs.existsSync(mcpJson)) {
    failures.push(".mcp.json missing at the package root");
  } else {
    let mcp;
    try {
      mcp = JSON.parse(fs.readFileSync(mcpJson, "utf8"));
    } catch (e) {
      return failures.concat([`${mcpJson} unreadable: ${e.message}`]);
    }
    const server = mcp.mcpServers?.quay;
    if (!server) failures.push(".mcp.json has no mcpServers.quay");
    else {
      if (server.command !== "node") {
        failures.push(`mcpServers.quay.command must be node, got ${JSON.stringify(server.command)}`);
      }
      if (!Array.isArray(server.args) || server.args[0] !== "vendor/quay/dist/quay.js") {
        failures.push(
          `mcpServers.quay.args[0] must be the in-package relative dist "vendor/quay/dist/quay.js", got ${JSON.stringify(server.args)}`,
        );
      }
      if (!server.args?.includes("mcp")) failures.push("mcpServers.quay.args must include mcp");
    }
  }
  return failures;
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

test("the codex package carries the installable manifest + self-contained .mcp.json (position)", () => {
  const failures = validateCodexPackage(ROOT);
  assert.deepEqual(
    failures,
    [],
    `codex package validation failed:\n  - ${failures.join("\n  - ")}`,
  );
  // Position, not keyword: the .mcp.json must not reference the claude plugin cache anywhere.
  const rawMcp = fs.readFileSync(MCP_JSON, "utf8");
  assert.doesNotMatch(rawMcp, /plugins\/cache/, ".mcp.json must not reference the claude plugin cache");
});

test("negative control: an inline mcpServers object fails validation with `mcpServers is not a path string`", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-inline-mcp-"));
  try {
    writePluginJson(tmp, {
      name: "quay",
      version: "0.28.0-dev",
      author: { name: "quay" },
      mcpServers: { quay: { command: "node", args: ["quay.js", "mcp"] } },
      interface: {
        displayName: "quay",
        shortDescription: "provider-agnostic task board",
        category: "Developer Tools",
        capabilities: ["Interactive"],
      },
    });
    fs.writeFileSync(
      path.join(tmp, ".mcp.json"),
      JSON.stringify(
        { mcpServers: { quay: { command: "node", args: ["vendor/quay/dist/quay.js", "mcp"] } } },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    const failures = validateCodexPackage(tmp);
    assert.ok(
      failures.includes("mcpServers is not a path string"),
      `expected the inline-mcpServers manifest to fail with "mcpServers is not a path string", got ${JSON.stringify(failures)}`,
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("negative control: .mcp.json nested back inside .codex-plugin/ fails validation (the old wrong layout)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-nested-mcp-"));
  try {
    writePluginJson(tmp, {
      name: "quay",
      version: "0.29.0-dev",
      author: { name: "quay" },
      mcpServers: "./.mcp.json",
      interface: {
        displayName: "quay",
        shortDescription: "provider-agnostic task board",
        category: "Developer Tools",
        capabilities: ["Interactive"],
      },
    });
    // The OLD wrong layout: .mcp.json nested INSIDE .codex-plugin/ (and nothing at the package root).
    fs.writeFileSync(
      path.join(tmp, ".codex-plugin", ".mcp.json"),
      JSON.stringify(
        { mcpServers: { quay: { command: "node", args: ["vendor/quay/dist/quay.js", "mcp"] } } },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    const failures = validateCodexPackage(tmp);
    assert.ok(
      failures.includes(".codex-plugin/.mcp.json must not exist (.mcp.json lives at the package root, a SIBLING of .codex-plugin/)"),
      `expected the nested-.mcp.json layout to fail with the layout cause, got ${JSON.stringify(failures)}`,
    );
    assert.ok(
      failures.includes(".mcp.json missing at the package root"),
      `expected the nested-.mcp.json layout to also name the missing root .mcp.json, got ${JSON.stringify(failures)}`,
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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
